/**
 * round_notification_ledger.mjs — ledger DURÁVEL de notificação POR RODADA (F6).
 *
 * ─── O QUE JÁ EXISTIA, E O QUE FALTAVA ───────────────────────────────────────────────────────
 *
 * A plataforma já tinha infraestrutura de notificação boa e consciente de segurança:
 * `notification_repository.mjs` (contrato + adaptadores memória/arquivo),
 * `durable_notification_repository.mjs` (Supabase via RPC, sem SELECT direto, sem coluna de
 * e-mail) e `bolao/shared/sql/010_notification_durability.sql` (claim atômico com
 * `for update skip locked`, lease, unicidade de idempotência, RLS sem policy para `anon`).
 *
 * Faltavam duas coisas, e as duas são o F6:
 *
 *   1. Aquilo tudo é POR DESTINATÁRIO. Uma "notificação de rodada" é uma unidade de negócio que
 *      abrange N destinatários e tem estado próprio — READY/PARTIAL/SENT dizem respeito à RODADA,
 *      não a um job isolado. Sem essa camada não existe resposta durável para "a rodada 22 foi
 *      comunicada?".
 *   2. Nenhum consumidor em produção. `grep` por essas classes em `bolao/br2026`, `bolao/cdb2026`,
 *      `bolao/copa2026` e `.github/workflows` retornava VAZIO. Era capacidade testada e nunca
 *      usada — o mesmo falso-verde arquitetural do FootballLiveStore.
 *
 * Este módulo é a camada 1. É PURO: recebe um repositório injetado e um relógio, não fala com
 * rede, não conhece Supabase e não conhece EmailJS.
 *
 * ─── IDENTIDADE ──────────────────────────────────────────────────────────────────────────────
 *
 *   rodada:       br2026:round-results:<round>:v1
 *   destinatário: br2026:round-results:<round>:v1#<entryRef>
 *
 * `entryRef` é o id OPACO da entrada. Nunca e-mail, nome, pagador ou transação — nem na chave,
 * nem no payload, nem no log.
 *
 * ─── GARANTIA DE ENTREGA (declarada, não presumida) ──────────────────────────────────────────
 *
 * O EmailJS não expõe consulta por idempotência: não dá para perguntar "você já aceitou a
 * mensagem X?". Portanto, no caso em que o provedor ACEITA e o processo morre antes de persistir,
 * não há como distinguir localmente "enviado" de "não enviado".
 *
 * A garantia honesta é, por destinatário:
 *
 *   - AT_MOST_ONCE até o provedor aceitar;
 *   - UNCERTAIN_AFTER_PROVIDER_ACCEPT na janela entre o aceite e a persistência.
 *
 * NÃO é exactly-once, e este módulo não finge que seja. A mitigação é conservadora: um job que
 * morreu com `SENDING` já registrado NÃO volta para a fila sozinho — vai para
 * `NEEDS_MANUAL_REVIEW`. Reenviar por conta própria porque a transação local se perdeu é
 * exatamente como se manda o mesmo e-mail duas vezes para onze pessoas.
 */

export const ROUND_STATE = Object.freeze({
  READY: "READY",
  CLAIMED: "CLAIMED",
  SENDING: "SENDING",
  PARTIAL: "PARTIAL",
  SENT: "SENT",
  FAILED: "FAILED",
  NEEDS_MANUAL_REVIEW: "NEEDS_MANUAL_REVIEW",
});

export const RECIPIENT_STATE = Object.freeze({
  PENDING: "PENDING",
  SENDING: "SENDING",
  ACCEPTED: "ACCEPTED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  UNCERTAIN: "UNCERTAIN",
});

export const DELIVERY_SEMANTICS = "AT_MOST_ONCE_UNTIL_ACCEPT/UNCERTAIN_AFTER_PROVIDER_ACCEPT";

export function roundKey(round) {
  if (!Number.isInteger(round) || round < 1) throw new Error(`rodada invalida: ${round}`);
  return `br2026:round-results:${round}:v1`;
}

export function recipientKey(round, entryRef) {
  if (!entryRef || /@/.test(String(entryRef))) {
    // Uma chave com "@" quase certamente e um e-mail. A chave vai para log e para o banco.
    throw new Error("entryRef precisa ser um id opaco, nunca um endereco de e-mail");
  }
  return `${roundKey(round)}#${entryRef}`;
}

/** Hash determinístico e estável. Não é criptografia — é detecção de mudança. */
export function stableHash(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, Object.keys(value || {}).sort());
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
}

export function recipientSetHash(entryRefs) {
  return stableHash([...entryRefs].map(String).sort().join("|"));
}

export function fixtureSetHash(fixtureIds) {
  return stableHash([...fixtureIds].map(String).sort().join("|"));
}

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/**
 * Ledger de rodada sobre um repositório injetado.
 *
 * O repositório precisa de: get(key), put(key, record), listByPrefix(prefix), e
 * claimAtomic(key, owner, leaseUntil) devolvendo o registro reivindicado ou null.
 * `MemoryRoundLedgerRepo` abaixo implementa isso; a versão de produção usa as RPCs do
 * 010_notification_durability.sql, cuja atomicidade vem de `for update skip locked` no banco --
 * NUNCA de código sequencial aqui.
 */
export function createRoundLedger({ repo, now = () => Date.now(), leaseMs = DEFAULT_LEASE_MS, log = () => {} }) {
  function emit(eventType, record, extra) {
    // Só id opaco, hash e transição de estado. Nenhum e-mail, nome ou transação.
    log({
      eventType,
      idempotencyKey: record.idempotencyKey,
      roundNumber: record.roundNumber,
      state: record.state,
      expectedRecipientCount: record.expectedRecipientCount,
      resolvedRecipientCount: record.resolvedRecipientCount,
      contentHash: record.contentHash,
      recipientSetHash: record.recipientSetHash,
      attemptCount: record.attemptCount,
      ...extra,
    });
  }

  return {
    DELIVERY_SEMANTICS,

    /**
     * Cria o job da rodada se ainda não existir. Idempotente por construção.
     *
     * Se já existir com conteúdo ou conjunto de destinatários DIFERENTE, falha alto em vez de
     * mutar silenciosamente um trabalho em andamento — um e-mail já aceito não pode ser
     * retroativamente "sobre outra coisa".
     */
    async ensureJob({ roundNumber, expectedRecipientCount, entryRefs, contentHash, fixtureIds }) {
      const key = roundKey(roundNumber);
      const rsh = recipientSetHash(entryRefs);
      const fsh = fixtureSetHash(fixtureIds);
      const existing = await repo.get(key);

      if (existing) {
        const mudou = existing.contentHash !== contentHash
          || existing.recipientSetHash !== rsh
          || existing.fixtureSetHash !== fsh;
        if (mudou && existing.state !== ROUND_STATE.READY) {
          throw new Error(
            `CONTEUDO_MUDOU_EM_JOB_ATIVO: ${key} está em ${existing.state} com hashes diferentes. ` +
            `Superseda explicitamente (nova versão de chave) em vez de mutar um job em andamento.`
          );
        }
        if (mudou) {
          const atualizado = { ...existing, contentHash, recipientSetHash: rsh, fixtureSetHash: fsh,
                               expectedRecipientCount, updatedAt: now() };
          await repo.put(key, atualizado);
          emit("job_created", atualizado, { recreated: true });
          return atualizado;
        }
        return existing;
      }

      const record = {
        schemaVersion: 1,
        idempotencyKey: key,
        roundNumber,
        state: ROUND_STATE.READY,
        expectedRecipientCount,
        resolvedRecipientCount: entryRefs.length,
        contentHash, recipientSetHash: rsh, fixtureSetHash: fsh,
        recipients: entryRefs.map((ref) => ({ entryRef: ref, state: RECIPIENT_STATE.PENDING,
                                              providerMessageId: null, lastError: null })),
        attemptCount: 0,
        claimedBy: null, leaseUntil: null,
        createdAt: now(), updatedAt: now(), sentAt: null,
      };
      await repo.put(key, record);
      emit("job_created", record);
      return record;
    },

    /**
     * Portão de completude. Antes da PRIMEIRA chamada ao provedor:
     * esperados == resolvidos, senão zero envios e o ledger NÃO vira SENT.
     */
    async assertRecipientCompleteness(roundNumber) {
      const rec = await repo.get(roundKey(roundNumber));
      if (!rec) throw new Error(`job inexistente para a rodada ${roundNumber}`);
      if (rec.expectedRecipientCount !== rec.resolvedRecipientCount) {
        emit("job_blocked", rec, { reason: "RECIPIENT_SET_INCOMPLETE" });
        return { ok: false, reason: "RECIPIENT_SET_INCOMPLETE",
                 expected: rec.expectedRecipientCount, resolved: rec.resolvedRecipientCount };
      }
      return { ok: true };
    },

    /** Reivindicação atômica com lease. Exatamente um vencedor entre concorrentes. */
    async claim(roundNumber, owner) {
      const key = roundKey(roundNumber);
      const claimed = await repo.claimAtomic(key, owner, now() + leaseMs, now());
      if (!claimed) return null;
      emit("job_claimed", claimed, { owner });
      return claimed;
    },

    /** Marca início de envio. A partir daqui, uma morte de processo NÃO permite retry automático. */
    async markSending(roundNumber) {
      const key = roundKey(roundNumber);
      const rec = await repo.get(key);
      const next = { ...rec, state: ROUND_STATE.SENDING, attemptCount: rec.attemptCount + 1, updatedAt: now() };
      await repo.put(key, next);
      emit("job_send_started", next);
      return next;
    },

    async recordRecipient(roundNumber, entryRef, state, { providerMessageId = null, error = null } = {}) {
      const key = roundKey(roundNumber);
      const rec = await repo.get(key);
      const recipients = rec.recipients.map((r) =>
        r.entryRef === entryRef ? { ...r, state, providerMessageId, lastError: error } : r);
      const next = { ...rec, recipients, updatedAt: now() };
      await repo.put(key, next);
      emit(state === RECIPIENT_STATE.ACCEPTED ? "recipient_accepted" : "recipient_failed", next,
           { entryRef, recipientState: state });
      return next;
    },

    /** Deriva o estado da RODADA a partir das disposições por destinatário. */
    async settle(roundNumber) {
      const key = roundKey(roundNumber);
      const rec = await repo.get(key);
      const total = rec.recipients.length;
      const aceitos = rec.recipients.filter((r) => r.state === RECIPIENT_STATE.ACCEPTED).length;
      const incertos = rec.recipients.filter((r) => r.state === RECIPIENT_STATE.UNCERTAIN).length;

      let state;
      if (incertos > 0) state = ROUND_STATE.NEEDS_MANUAL_REVIEW;
      else if (aceitos === total && total > 0) state = ROUND_STATE.SENT;
      else if (aceitos > 0) state = ROUND_STATE.PARTIAL;
      else state = ROUND_STATE.FAILED;

      const next = { ...rec, state, updatedAt: now(),
                     sentAt: state === ROUND_STATE.SENT ? now() : rec.sentAt,
                     claimedBy: null, leaseUntil: null };
      await repo.put(key, next);
      emit(state === ROUND_STATE.SENT ? "job_sent"
           : state === ROUND_STATE.PARTIAL ? "job_partial" : "job_failed", next);
      return next;
    },

    /**
     * Recupera jobs cujo lease expirou (o runner morreu).
     *
     * REGRA CENTRAL DE SEGURANÇA: um job que morreu em SENDING não volta para a fila. Nessa
     * janela o provedor pode ter aceitado sem que a persistência acontecesse, e reenviar seria
     * duplicar. Vai para revisão manual, e os destinatários que estavam em SENDING viram
     * UNCERTAIN.
     */
    async recoverExpiredLeases() {
      const todos = await repo.listByPrefix("br2026:round-results:");
      const recuperados = [];
      for (const rec of todos) {
        if (!rec.leaseUntil || rec.leaseUntil > now()) continue;
        if (rec.state !== ROUND_STATE.CLAIMED && rec.state !== ROUND_STATE.SENDING) continue;

        const morreuEnviando = rec.state === ROUND_STATE.SENDING;
        const recipients = rec.recipients.map((r) =>
          morreuEnviando && r.state === RECIPIENT_STATE.SENDING
            ? { ...r, state: RECIPIENT_STATE.UNCERTAIN }
            : r);
        const next = {
          ...rec,
          recipients,
          state: morreuEnviando ? ROUND_STATE.NEEDS_MANUAL_REVIEW : ROUND_STATE.READY,
          claimedBy: null, leaseUntil: null, updatedAt: now(),
        };
        await repo.put(rec.idempotencyKey, next);
        emit("job_lease_expired", next, { diedWhileSending: morreuEnviando });
        recuperados.push(next);
      }
      return recuperados;
    },

    /** Rodadas ainda não comunicadas. Independentes entre si — nenhuma bloqueia outra. */
    async pendingRounds() {
      const todos = await repo.listByPrefix("br2026:round-results:");
      return todos
        .filter((r) => r.state !== ROUND_STATE.SENT && r.state !== ROUND_STATE.NEEDS_MANUAL_REVIEW)
        .sort((a, b) => a.roundNumber - b.roundNumber);
    },

    async get(roundNumber) {
      return repo.get(roundKey(roundNumber));
    },
  };
}

/** Repositório em memória. TESTE E DEV APENAS — produção usa as RPCs do Postgres. */
export function createMemoryRoundLedgerRepo() {
  const store = new Map();
  return {
    async get(key) { const v = store.get(key); return v ? JSON.parse(JSON.stringify(v)) : null; },
    async put(key, record) { store.set(key, JSON.parse(JSON.stringify(record))); },
    async listByPrefix(prefix) {
      return [...store.entries()].filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => JSON.parse(JSON.stringify(v)));
    },
    /**
     * Reivindicação atômica. Em memória, "atômico" é trivial porque o Node é single-threaded —
     * e é justamente por isso que este adaptador NÃO prova concorrência. A prova real é o
     * `for update skip locked` da RPC no Postgres; ver o contrato estático em
     * test_round_notification_ledger.mjs.
     */
    async claimAtomic(key, owner, leaseUntil, nowMs) {
      const rec = store.get(key);
      if (!rec) return null;
      const leaseAtivo = rec.leaseUntil && rec.leaseUntil > nowMs;
      if (leaseAtivo) return null;
      if (rec.state !== "READY") return null;
      const next = { ...rec, state: "CLAIMED", claimedBy: owner, leaseUntil, updatedAt: nowMs };
      store.set(key, next);
      return JSON.parse(JSON.stringify(next));
    },
    _dump() { return [...store.values()]; },
  };
}
