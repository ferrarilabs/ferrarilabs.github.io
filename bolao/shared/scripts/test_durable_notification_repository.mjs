#!/usr/bin/env node
/**
 * test_durable_notification_repository.mjs — Batch 1: durabilidade + fronteira de autorização.
 *
 * Prova os requisitos do Batch 1 SEM banco real e SEM enviar e-mail:
 *
 *   - idempotência sobrevive a restart de processo/runner
 *   - retry sobrevive a restart
 *   - catch-up sobrevive a restart (lease expirado volta para a fila)
 *   - providerMessageId é persistido
 *   - schemaVersion é persistido
 *   - claim/lease seguro
 *   - concorrência: dois workers nunca pegam o mesmo job
 *   - sem entrega duplicada depois de retry
 *   - `anon` NÃO consegue enumerar destinatário
 *
 * O dublê `FakePostgres` implementa a MESMA semântica da migração
 * `bolao/shared/sql/010_notification_durability.sql`: RLS habilitada e ZERO policies para `anon`,
 * então qualquer acesso direto a tabela é negado; só as RPCs `security definer` funcionam. Um teste
 * de contrato lê o SQL de verdade e falha se a migração ganhar uma policy para `anon` ou uma coluna
 * de contato — é isso que amarra o dublê à realidade.
 *
 * "Restart de runner" é modelado descartando o repositório e o worker e recriando-os contra o MESMO
 * armazenamento — que é exatamente o que um runner efêmero faz: processo novo, banco igual.
 *
 * Uso: node bolao/shared/scripts/test_durable_notification_repository.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DurableNotificationRepository, processClaimedJobs, buildIdempotencyKey,
  assertNoContactData, SCHEMA_VERSION,
} from "./durable_notification_repository.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = join(HERE, "..", "sql", "010_notification_durability.sql");

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/**
 * Postgres falso com a mesma semântica da migração. `storage` é o "banco": sobrevive ao descarte do
 * repositório, que é como modelamos runner efêmero + banco persistente.
 */
class FakePostgres {
  constructor(storage) {
    this.storage = storage;           // { jobs: Map<idempotency_key, row> }
    this.now = () => new Date();
    this.rpcCalls = [];
    this.directTableAccess = 0;       // qualquer uso de .from() é violação
  }
  // Presente de propósito: se o repositório voltar a usar acesso direto, isto conta e o teste falha.
  from() { this.directTableAccess++; throw new Error("RLS: acesso direto a tabela negado para anon"); }

  async rpc(fn, args) {
    this.rpcCalls.push(fn);
    const jobs = this.storage.jobs;
    const nowMs = this.now().getTime();
    try {
      if (fn === "enqueue_bolao_notif") {
        const key = args.p_idempotency_key;
        if (jobs.has(key)) return { data: jobs.get(key).job_id, error: null }; // idempotente
        const row = {
          job_id: `job-${jobs.size + 1}`, pool_id: args.p_pool_id, entity_id: args.p_entity_id,
          event_type: args.p_event_type, event_version: args.p_event_version,
          entry_ref: args.p_entry_ref, idempotency_key: key,
          payload_snapshot: args.p_payload, template_id: args.p_template_id,
          template_version: args.p_template_version, schema_version: args.p_schema_version,
          status: "pending", attempt_count: 0, max_attempts: args.p_max_attempts,
          next_attempt_at: nowMs, claimed_by: null, lease_expires_at: null,
          provider_message_id: null, last_error: null, sent_at: null,
        };
        jobs.set(key, row);
        return { data: row.job_id, error: null };
      }
      if (fn === "claim_bolao_notif") {
        const eligible = [...jobs.values()].filter(j =>
          j.pool_id === args.p_pool_id &&
          (j.status === "pending" || j.status === "failed_retryable") &&
          j.next_attempt_at <= nowMs && j.attempt_count < j.max_attempts
        ).sort((a, b) => a.next_attempt_at - b.next_attempt_at)
         .slice(0, Math.max(args.p_limit ?? 10, 1));
        // FOR UPDATE SKIP LOCKED: a transição é atômica, então uma vez em 'processing' outro
        // worker não vê mais o job.
        for (const j of eligible) {
          j.status = "processing"; j.claimed_by = args.p_worker;
          j.claimed_at = nowMs;
          j.lease_expires_at = nowMs + Math.max(args.p_lease_seconds ?? 300, 30) * 1000;
          j.attempt_count += 1; j.last_attempt_at = nowMs;
        }
        return { data: eligible.map(j => ({ ...j })), error: null };
      }
      const byId = id => [...jobs.values()].find(j => j.job_id === id);
      if (fn === "mark_bolao_notif_sent") {
        const j = byId(args.p_job_id);
        if (!j || j.status !== "processing") return { data: false, error: null };
        j.status = "sent"; j.sent_at = nowMs;
        j.provider_message_id = args.p_provider_message_id;
        j.claimed_by = null; j.lease_expires_at = null; j.last_error = null;
        return { data: true, error: null };
      }
      if (fn === "mark_bolao_notif_retryable") {
        const j = byId(args.p_job_id);
        if (!j || j.status !== "processing") return { data: false, error: null };
        j.status = j.attempt_count >= j.max_attempts ? "failed_permanent" : "failed_retryable";
        j.last_error = args.p_error;
        j.next_attempt_at = nowMs + Math.min(2 ** j.attempt_count, 60) * 60000;
        j.claimed_by = null; j.lease_expires_at = null;
        return { data: true, error: null };
      }
      if (fn === "mark_bolao_notif_permanent") {
        const j = byId(args.p_job_id);
        if (!j) return { data: false, error: null };
        j.status = "failed_permanent"; j.last_error = args.p_error;
        j.claimed_by = null; j.lease_expires_at = null;
        return { data: true, error: null };
      }
      if (fn === "release_expired_bolao_notif") {
        let n = 0;
        for (const j of jobs.values()) {
          if (j.pool_id === args.p_pool_id && j.status === "processing" &&
              j.lease_expires_at != null && j.lease_expires_at < nowMs) {
            j.status = j.attempt_count >= j.max_attempts ? "failed_permanent" : "failed_retryable";
            j.claimed_by = null; j.lease_expires_at = null;
            j.last_error = j.last_error ?? "lease expirado";
            j.next_attempt_at = nowMs;   // elegível já
            n++;
          }
        }
        return { data: n, error: null };
      }
      if (fn === "bolao_notif_health") {
        const counts = {};
        for (const j of jobs.values()) if (j.pool_id === args.p_pool_id) counts[j.status] = (counts[j.status] || 0) + 1;
        return { data: Object.entries(counts).map(([status, n]) => ({ status, jobs: n })), error: null };
      }
      return { data: null, error: { message: `função inexistente: ${fn}` } };
    } catch (err) {
      return { data: null, error: { message: err.message } };
    }
  }
}

const newStorage = () => ({ jobs: new Map() });
/** Simula um runner novo: processo/repositório novos, MESMO banco. */
const newRunner = (storage) => {
  const pg = new FakePostgres(storage);
  return { pg, repo: new DurableNotificationRepository(pg, "cdb2026") };
};

// Nenhum e-mail real: `sendFn` é dublê. `resolveRecipient` devolve endereço de domínio reservado.
const RECIPIENTS = { "entry-1": "p1@example.invalid", "entry-2": "p2@example.invalid" };
const resolveRecipient = ref => RECIPIENTS[ref] ?? null;
function fakeSender({ failTimes = 0 } = {}) {
  let calls = 0;
  const sent = [];
  return {
    sent,
    get calls() { return calls; },
    async sendFn({ entityId, recipient }) {
      calls++;
      if (calls <= failTimes) throw new Error("provedor indisponível (simulado)");
      sent.push({ entityId, recipient });
      return { providerMessageId: `pm-${calls}` };
    },
  };
}

console.log("\nBatch 1 — persistência durável + fronteira de autorização\n");

// ── Contrato: a migração REAL precisa manter as garantias ───────────────────
await test("CONTRATO: a migração não concede policy nenhuma para `anon`", () => {
  const sql = readFileSync(SQL_PATH, "utf8");
  const code = sql.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
  assert(!/to\s+anon/i.test(code), "a migração ganhou uma policy/grant para anon — PII volta a vazar");
  assert(/enable row level security/i.test(code), "RLS não está habilitada na tabela de jobs");
});

await test("CONTRATO: a tabela de jobs não tem coluna de contato", () => {
  const sql = readFileSync(SQL_PATH, "utf8");
  // Só linhas de CÓDIGO: o próprio DDL tem um comentário avisando "nunca adicionar coluna de
  // e-mail/telefone aqui", e comparar contra o comentário fazia o teste acusar a si mesmo.
  const create = sql.slice(sql.indexOf("create table if not exists bolao_notif_jobs"), sql.indexOf("create index"))
    .split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
  assert(!/\b(recipient|email|e_mail|phone|telefone|whatsapp)\b/i.test(create),
    `apareceu coluna de contato na tabela de jobs: ${create.match(/\b(recipient|email|e_mail|phone|telefone|whatsapp)\b/i)}`);
  assert(/entry_ref\s+text not null/.test(create), "entry_ref (referência opaca) desapareceu");
});

await test("CONTRATO: a migração é aditiva (sem drop/truncate/alter destrutivo fora do rollback)", () => {
  const sql = readFileSync(SQL_PATH, "utf8");
  const code = sql.split("\n").filter(l => !/^\s*--/.test(l));
  const bad = code.filter(l => /^\s*(drop|truncate|delete\s+from|revoke)\b/i.test(l));
  eq(bad.length, 0, `statements destrutivos ativos: ${bad.join(" | ")}`);
  const alters = code.filter(l => /^\s*alter table/i.test(l));
  assert(alters.every(l => /bolao_notif_jobs/.test(l)), "alter table em tabela que não é a da feature");
});

await test("CONTRATO: o repositório nunca acessa tabela direto (só RPC)", () => {
  const src = readFileSync(join(HERE, "durable_notification_repository.mjs"), "utf8");
  const code = src.split("\n").filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assert(!/\.from\s*\(/.test(code), "voltou a usar .from() — exigiria policy de select para anon");
  assert(!/\.select\s*\(/.test(code), "voltou a usar .select() direto na tabela");
  assert(/\.rpc\s*\(/.test(code), "o repositório não usa RPC");
});

// ── Fronteira de autorização ────────────────────────────────────────────────
await test("AUTORIZAÇÃO: `anon` não consegue enumerar destinatário (acesso direto negado)", async () => {
  const { pg } = newRunner(newStorage());
  let denied = false;
  try { pg.from("bolao_notif_jobs"); } catch { denied = true; }
  assert(denied, "acesso direto à tabela foi permitido");
  eq(pg.directTableAccess, 1, "a tentativa não foi contabilizada");
});

await test("AUTORIZAÇÃO: nenhuma RPC devolve destinatário — não há e-mail persistido", async () => {
  const storage = newStorage();
  const { repo } = newRunner(storage);
  await repo.enqueue({ entityId: "oitavas:tie-1:first", eventType: "result_confirmed", entryRef: "entry-1" });
  const jobs = await repo.claim({ worker: "w1" });
  const blob = JSON.stringify(jobs);
  assert(!/@/.test(blob), `retorno da RPC contém algo com "@": ${blob.slice(0, 120)}`);
  assert(jobs[0].entry_ref === "entry-1", "entry_ref não veio no claim (o worker precisa dele)");
  // E o próprio armazenamento não guarda endereço.
  assert(!/@/.test(JSON.stringify([...storage.jobs.values()])), "o banco guardou um endereço");
});

await test("AUTORIZAÇÃO: enqueue RECUSA payload com dado de contato", async () => {
  const { repo } = newRunner(newStorage());
  for (const bad of [{ email: "x@y.invalid" }, { participantEmail: "x@y.invalid" },
                     { nested: { payerName: "X" } }, { note: "fale com x@y.invalid" }]) {
    let threw = false;
    try { await repo.enqueue({ entityId: "e", eventType: "t", entryRef: "entry-1", payload: bad }); }
    catch { threw = true; }
    assert(threw, `payload ${JSON.stringify(bad)} foi aceito — PII entraria na fila`);
  }
});

await test("AUTORIZAÇÃO: assertNoContactData aceita payload legítimo", () => {
  assertNoContactData({ homeScore: 2, awayScore: 1, tie: { teamA: "Santos", teamB: "Remo" } }, "ok");
});

// ── Durabilidade ────────────────────────────────────────────────────────────
await test("idempotência: chave é determinística e não contém e-mail", () => {
  const k1 = buildIdempotencyKey("cdb2026", "oitavas:tie-1:first", "entry-1", 1);
  const k2 = buildIdempotencyKey("cdb2026", "oitavas:tie-1:first", "entry-1", 1);
  eq(k1, k2, "chave não é determinística");
  assert(!/@/.test(k1), "a chave de idempotência contém e-mail");
});

await test("idempotência SOBREVIVE a restart: re-enqueue não cria segundo job", async () => {
  const storage = newStorage();
  const a = newRunner(storage);
  const id1 = await a.repo.enqueue({ entityId: "oitavas:tie-1:first", eventType: "result_confirmed", entryRef: "entry-1" });
  // runner morre; banco continua
  const b = newRunner(storage);
  const id2 = await b.repo.enqueue({ entityId: "oitavas:tie-1:first", eventType: "result_confirmed", entryRef: "entry-1" });
  eq(id2, id1, "um segundo job foi criado para a mesma chave");
  eq(storage.jobs.size, 1, "existe mais de um job no banco");
});

await test("schemaVersion e providerMessageId são PERSISTIDOS", async () => {
  const storage = newStorage();
  const { repo } = newRunner(storage);
  await repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1" });
  const jobs = await repo.claim({ worker: "w1" });
  const s = fakeSender();
  await processClaimedJobs({ repo, jobs, resolveRecipient, sendFn: s.sendFn });
  const row = [...storage.jobs.values()][0];
  eq(row.schema_version, SCHEMA_VERSION, "schemaVersion não persistiu");
  eq(row.provider_message_id, "pm-1", "providerMessageId não persistiu");
  eq(row.status, "sent", "status final não é sent");
});

await test("primeira entrega funciona e envia exatamente uma vez", async () => {
  const storage = newStorage();
  const { repo } = newRunner(storage);
  await repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1" });
  const s = fakeSender();
  const r = await processClaimedJobs({ repo, jobs: await repo.claim({ worker: "w1" }), resolveRecipient, sendFn: s.sendFn });
  eq(r.sent, 1, "não enviou"); eq(s.calls, 1, "enviou mais de uma vez");
  eq(s.sent[0].recipient, "p1@example.invalid", "destinatário resolvido errado");
});

await test("execução repetida (workflow rodou 2x) NÃO duplica entrega", async () => {
  const storage = newStorage();
  const a = newRunner(storage);
  await a.repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1" });
  const s = fakeSender();
  await processClaimedJobs({ repo: a.repo, jobs: await a.repo.claim({ worker: "w1" }), resolveRecipient, sendFn: s.sendFn });
  // segunda execução completa, runner novo
  const b = newRunner(storage);
  await b.repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1" });
  const r2 = await processClaimedJobs({ repo: b.repo, jobs: await b.repo.claim({ worker: "w2" }), resolveRecipient, sendFn: s.sendFn });
  eq(r2.sent, 0, "a segunda execução enviou de novo");
  eq(s.calls, 1, "entrega duplicada");
});

await test("retry SOBREVIVE a restart e não duplica", async () => {
  const storage = newStorage();
  const a = newRunner(storage);
  await a.repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1" });
  const s = fakeSender({ failTimes: 1 });
  const r1 = await processClaimedJobs({ repo: a.repo, jobs: await a.repo.claim({ worker: "w1" }), resolveRecipient, sendFn: s.sendFn });
  eq(r1.retryable, 1, "a falha não virou retryable");
  let row = [...storage.jobs.values()][0];
  eq(row.status, "failed_retryable", "status errado após falha");
  eq(row.attempt_count, 1, "tentativa não foi contada de forma durável");

  // runner novo; o backoff já venceu
  const b = new FakePostgres(storage);
  b.now = () => new Date(Date.now() + 3 * 3600 * 1000);
  const repo2 = new DurableNotificationRepository(b, "cdb2026");
  const r2 = await processClaimedJobs({ repo: repo2, jobs: await repo2.claim({ worker: "w2" }), resolveRecipient, sendFn: s.sendFn });
  eq(r2.sent, 1, "o retry não entregou depois do restart");
  eq(s.calls, 2, "número de envios inesperado (duplicata?)");
  row = [...storage.jobs.values()][0];
  eq(row.status, "sent", "não chegou a sent");
  eq(row.attempt_count, 2, "attempt_count não acumulou entre execuções");
});

await test("catch-up: lease expirado volta para a fila (runner morreu no meio)", async () => {
  const storage = newStorage();
  const a = newRunner(storage);
  await a.repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1" });
  await a.repo.claim({ worker: "w-morto", leaseSeconds: 30 });   // reivindica e "morre"
  eq([...storage.jobs.values()][0].status, "processing", "não ficou em processing");

  const b = new FakePostgres(storage);
  b.now = () => new Date(Date.now() + 10 * 60 * 1000);           // lease vencido
  const repo2 = new DurableNotificationRepository(b, "cdb2026");
  eq(await repo2.releaseExpired(), 1, "o lease expirado não foi liberado");
  const s = fakeSender();
  const r = await processClaimedJobs({ repo: repo2, jobs: await repo2.claim({ worker: "w-novo" }), resolveRecipient, sendFn: s.sendFn });
  eq(r.sent, 1, "o job recuperado não foi entregue");
  eq(s.calls, 1, "entrega duplicada no catch-up");
});

await test("lease ATIVO não é roubado por outro worker", async () => {
  const storage = newStorage();
  const a = newRunner(storage);
  await a.repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1" });
  await a.repo.claim({ worker: "w1", leaseSeconds: 300 });
  eq(await a.repo.releaseExpired(), 0, "liberou um lease que ainda estava válido");
  const b = newRunner(storage);
  eq((await b.repo.claim({ worker: "w2" })).length, 0, "outro worker roubou um job em processing");
});

await test("concorrência: dois workers simultâneos nunca pegam o mesmo job", async () => {
  const storage = newStorage();
  const a = newRunner(storage);
  for (const ref of ["entry-1", "entry-2"]) {
    await a.repo.enqueue({ entityId: `e-${ref}`, eventType: "t", entryRef: ref });
  }
  const b = newRunner(storage);
  const [c1, c2] = await Promise.all([
    a.repo.claim({ worker: "w1", limit: 2 }),
    b.repo.claim({ worker: "w2", limit: 2 }),
  ]);
  const ids = [...c1, ...c2].map(j => j.job_id);
  eq(new Set(ids).size, ids.length, `o mesmo job foi reivindicado duas vezes: ${ids}`);
  eq(ids.length, 2, "número total de jobs reivindicados errado");
});

await test("destinatário não resolvível vira falha PERMANENTE (retry não ajudaria)", async () => {
  const storage = newStorage();
  const { repo } = newRunner(storage);
  await repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-fantasma" });
  const s = fakeSender();
  const r = await processClaimedJobs({ repo, jobs: await repo.claim({ worker: "w1" }), resolveRecipient, sendFn: s.sendFn });
  eq(r.permanent, 1, "não marcou permanente");
  eq(s.calls, 0, "tentou enviar sem destinatário");
  eq([...storage.jobs.values()][0].status, "failed_permanent", "status errado");
});

await test("falha parcial: um destinatário falha, o outro é entregue", async () => {
  const storage = newStorage();
  const { repo } = newRunner(storage);
  await repo.enqueue({ entityId: "e-1", eventType: "t", entryRef: "entry-1" });
  await repo.enqueue({ entityId: "e-2", eventType: "t", entryRef: "entry-2" });
  const s = fakeSender({ failTimes: 1 });   // o primeiro envio falha
  const r = await processClaimedJobs({ repo, jobs: await repo.claim({ worker: "w1", limit: 2 }), resolveRecipient, sendFn: s.sendFn });
  eq(r.sent, 1, "o segundo não foi entregue");
  eq(r.retryable, 1, "o primeiro não ficou retryable");
  const statuses = [...storage.jobs.values()].map(j => j.status).sort();
  eq(JSON.stringify(statuses), JSON.stringify(["failed_retryable", "sent"]), `estados finais: ${statuses}`);
});

await test("esgotar max_attempts vira falha permanente (não tenta para sempre)", async () => {
  const storage = newStorage();
  let pg = new FakePostgres(storage);
  let repo = new DurableNotificationRepository(pg, "cdb2026");
  await repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1", maxAttempts: 2 });
  const s = fakeSender({ failTimes: 99 });
  for (let i = 0; i < 4; i++) {
    pg = new FakePostgres(storage);
    pg.now = () => new Date(Date.now() + (i + 1) * 6 * 3600 * 1000);
    repo = new DurableNotificationRepository(pg, "cdb2026");
    await processClaimedJobs({ repo, jobs: await repo.claim({ worker: `w${i}` }), resolveRecipient, sendFn: s.sendFn });
  }
  const row = [...storage.jobs.values()][0];
  eq(row.status, "failed_permanent", "não parou em failed_permanent");
  assert(row.attempt_count <= 2, `tentou mais que max_attempts: ${row.attempt_count}`);
});

await test("health() devolve só contadores, nunca linhas nem entry_ref", async () => {
  const storage = newStorage();
  const { repo } = newRunner(storage);
  await repo.enqueue({ entityId: "e1", eventType: "t", entryRef: "entry-1" });
  const h = await repo.health();
  eq(typeof h.pending, "number", "health não devolveu contador de pending");
  assert(!JSON.stringify(h).includes("entry-1"), "health vazou entry_ref");
});

await test("nenhum e-mail real foi enviado nesta suíte", () => {
  // Todos os destinatários usam o TLD reservado .invalid e todo envio é dublê.
  for (const r of Object.values(RECIPIENTS)) {
    assert(/\.invalid$/.test(r), `destinatário de teste não é reservado: ${r}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ DURABLE PERSISTENCE SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
