/**
 * durable_notification_repository.mjs — repositório DURÁVEL da fila de notificações (Batch 1).
 *
 * Substitui o outbox em ARQUIVO para uso em CI. Num runner do GitHub Actions o sistema de arquivos é
 * EFÊMERO: não sobrevive entre execuções, então retry/catch-up/idempotência em arquivo não são
 * duráveis justamente onde o cron roda. Este repositório persiste no Postgres do Supabase.
 *
 * ============================================================================
 * REGRA DE SEGURANÇA (o motivo do redesenho)
 * ============================================================================
 * O design anterior (supabase_notification_repository.mjs, REJEITADO) fazia SELECT direto na tabela
 * de jobs com a anon key, e por isso exigia uma policy `for select to anon using (true)` numa tabela
 * que guardava o e-mail do participante. A anon key é pública (vai no js/config.js de todo
 * navegador) — isso permitiria enumerar o e-mail de todos.
 *
 * Aqui:
 *   - NENHUM SELECT direto na tabela. Nem um. Todo acesso é via RPC `security definer`.
 *   - A tabela não tem coluna de e-mail: o job guarda `entryRef` (id opaco da entrada).
 *   - O endereço real é resolvido por `resolveRecipient`, injetado pelo chamador confiável, só no
 *     momento do envio. Este módulo nunca lê nem grava endereço.
 *
 * Um teste de contrato (test_durable_notification_repository.mjs) falha se qualquer `.from(...)`
 * ou `.select(...)` reaparecer aqui, ou se um campo com cara de e-mail for persistido.
 *
 * ============================================================================
 * DEPENDÊNCIA
 * ============================================================================
 * A migração `bolao/shared/sql/010_notification_durability.sql` precisa estar aplicada. Enquanto não
 * estiver, todas as chamadas falham com erro do Postgres (função inexistente) — falha ALTA e
 * explícita, nunca silenciosa. Ver HA-2 em supervisor/HUMAN_ACTIONS_REQUIRED.md.
 */

export const SCHEMA_VERSION = 1;

export const JOB_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  SENT: "sent",
  FAILED_RETRYABLE: "failed_retryable",
  FAILED_PERMANENT: "failed_permanent",
  SUPPRESSED: "suppressed",
});

/**
 * Chave de idempotência DURÁVEL. É o que sobrevive à morte do runner e impede envio duplicado.
 * Determinística: os mesmos insumos produzem sempre a mesma chave, então uma segunda execução do
 * mesmo workflow re-enfileira "por cima" do mesmo job em vez de criar um novo.
 *
 * `entryRef` entra na chave — nunca o e-mail. Se o e-mail entrasse aqui, a chave (que é lida em
 * logs e mensagens de erro) viraria mais um lugar por onde PII vaza.
 */
export function buildIdempotencyKey(poolId, entityId, entryRef, eventVersion) {
  return [poolId, entityId, entryRef, `v${eventVersion ?? 1}`].join("|");
}

export class DurableNotificationRepository {
  /**
   * @param {object} client cliente Supabase (só `.rpc()` é usado — ver a regra de segurança acima)
   * @param {string} poolId 'copa2026' | 'br2026' | 'cdb2026'
   */
  constructor(client, poolId) {
    if (!client || typeof client.rpc !== "function") {
      throw new Error("DurableNotificationRepository: cliente precisa expor .rpc()");
    }
    if (!poolId) throw new Error("DurableNotificationRepository: poolId obrigatório");
    this.client = client;
    this.poolId = poolId;
  }

  async #rpc(fn, args) {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new Error(`${fn} falhou: ${error.message || error}`);
    return data;
  }

  /** Enfileira (idempotente). Devolve o job_id — existente ou novo. */
  async enqueue({ entityId, eventType, eventVersion = 1, entryRef, payload = {},
                  templateId = "default", templateVersion = 1, maxAttempts = 5 }) {
    if (!entryRef) throw new Error("enqueue: entryRef obrigatório (referência opaca, não e-mail)");
    assertNoContactData(payload, "payload");
    return this.#rpc("enqueue_bolao_notif", {
      p_pool_id: this.poolId, p_entity_id: entityId, p_event_type: eventType,
      p_event_version: eventVersion, p_entry_ref: entryRef,
      p_idempotency_key: buildIdempotencyKey(this.poolId, entityId, entryRef, eventVersion),
      p_payload: payload, p_template_id: templateId, p_template_version: templateVersion,
      p_max_attempts: maxAttempts, p_schema_version: SCHEMA_VERSION,
    });
  }

  /** Reivindica jobs com lease. Atômico no banco (FOR UPDATE SKIP LOCKED). */
  async claim({ worker, limit = 10, leaseSeconds = 300 }) {
    if (!worker) throw new Error("claim: worker obrigatório (rastreabilidade do lease)");
    const rows = await this.#rpc("claim_bolao_notif", {
      p_pool_id: this.poolId, p_worker: worker, p_limit: limit, p_lease_seconds: leaseSeconds,
    });
    return Array.isArray(rows) ? rows : [];
  }

  async markSent(jobId, providerMessageId) {
    return this.#rpc("mark_bolao_notif_sent", {
      p_job_id: jobId, p_provider_message_id: providerMessageId ?? null,
    });
  }

  async markRetryable(jobId, error) {
    return this.#rpc("mark_bolao_notif_retryable", { p_job_id: jobId, p_error: String(error ?? "") });
  }

  async markPermanent(jobId, error) {
    return this.#rpc("mark_bolao_notif_permanent", { p_job_id: jobId, p_error: String(error ?? "") });
  }

  /** Devolve à fila jobs cujo lease expirou — é isto que faz o catch-up sobreviver ao restart. */
  async releaseExpired() {
    return this.#rpc("release_expired_bolao_notif", { p_pool_id: this.poolId });
  }

  /** Contadores por status. Só números — nunca linhas, nunca entryRef. */
  async health() {
    const rows = await this.#rpc("bolao_notif_health", { p_pool_id: this.poolId });
    const out = {};
    for (const r of rows || []) out[r.status] = Number(r.jobs);
    return out;
  }
}

/**
 * Guarda contra regressão de PII: recusa persistir qualquer coisa que pareça dado de contato.
 * O ponto todo do redesenho é que a tabela não guarda endereço; se alguém, meses depois, enfiar um
 * `email` no payload "só para facilitar", isto falha ALTO em vez de vazar em silêncio.
 */
// Substring case-insensitive de propósito: `participantEmail` e `payerName` são camelCase, então
// uma regex ancorada em `_`/bordas (a primeira versão disto) deixava os dois passarem — o teste de
// autorização pegou exatamente isso. Chaves legítimas de payload (placar, times, ids de confronto)
// não contêm nenhum destes tokens.
const CONTACT_KEY = /(email|mail|recipient|phone|telefone|whatsapp|payer|destinatario)/i;
export function assertNoContactData(obj, where, path = []) {
  if (obj === null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    if (CONTACT_KEY.test(k)) {
      throw new Error(
        `${where}: campo "${[...path, k].join(".")}" parece dado de contato. A fila durável guarda ` +
        `apenas entryRef (referência opaca); o endereço é resolvido no envio. Ver o cabeçalho de ` +
        `durable_notification_repository.mjs.`
      );
    }
    if (typeof v === "string" && /@[^\s@]+\.[^\s@]+/.test(v)) {
      throw new Error(`${where}: valor em "${[...path, k].join(".")}" parece um endereço de e-mail.`);
    }
    if (v && typeof v === "object") assertNoContactData(v, where, [...path, k]);
  }
}

/**
 * Executor confiável: processa jobs reivindicados. `resolveRecipient(entryRef)` é injetado pelo
 * chamador (que já tem acesso legítimo ao estado) e é o ÚNICO ponto onde um endereço aparece —
 * em memória, no instante do envio, nunca persistido.
 *
 * `sendFn` recebe `{ entityId, payload, recipient }` e deve devolver `{ providerMessageId }`.
 * Em teste, `sendFn` é um dublê: nenhum e-mail real é enviado.
 */
export async function processClaimedJobs({ repo, jobs, resolveRecipient, sendFn }) {
  const result = { sent: 0, retryable: 0, permanent: 0, providerMessageIds: [] };
  for (const job of jobs) {
    let recipient;
    try {
      recipient = await resolveRecipient(job.entry_ref);
    } catch (err) {
      await repo.markRetryable(job.job_id, `falha ao resolver destinatário: ${err.message}`);
      result.retryable++;
      continue;
    }
    if (!recipient) {
      // Entrada sem endereço resolvível não melhora com retry.
      await repo.markPermanent(job.job_id, "destinatário não resolvível para este entry_ref");
      result.permanent++;
      continue;
    }
    try {
      const { providerMessageId } = await sendFn({
        entityId: job.entity_id, payload: job.payload_snapshot, recipient,
      });
      await repo.markSent(job.job_id, providerMessageId);
      result.sent++;
      result.providerMessageIds.push(providerMessageId);
    } catch (err) {
      await repo.markRetryable(job.job_id, err.message);
      result.retryable++;
    }
  }
  return result;
}
