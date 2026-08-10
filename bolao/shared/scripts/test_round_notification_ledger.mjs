/**
 * test_round_notification_ledger.mjs — F6. Matriz de crash, concorrência e idempotência.
 *
 * Cada cenário aqui existe porque o dano correspondente é real: onze pessoas com dinheiro em
 * jogo recebendo o mesmo e-mail duas vezes, ou uma rodada inteira nunca comunicada.
 *
 * O que este arquivo NÃO tenta provar: atomicidade de reivindicação sob concorrência real. O
 * adaptador em memória roda em Node single-threaded, então "atômico" ali é trivial e não prova
 * nada. A atomicidade de verdade é do `for update skip locked` na RPC do Postgres, e está travada
 * pelo contrato estático sobre o SQL no fim deste arquivo.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createRoundLedger, createMemoryRoundLedgerRepo, ROUND_STATE, RECIPIENT_STATE,
  roundKey, recipientKey, recipientSetHash, fixtureSetHash, DELIVERY_SEMANTICS,
} from "./round_notification_ledger.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

const REFS = ["e1", "e2", "e3"];
const FIXTURES = ["401841178", "401841179", "401841180"];

function novoLedger(t0 = 1_000_000) {
  let clock = t0;
  const repo = createMemoryRoundLedgerRepo();
  const eventos = [];
  const ledger = createRoundLedger({ repo, now: () => clock, leaseMs: 60_000,
                                     log: (e) => eventos.push(e) });
  return { ledger, repo, eventos, avanca: (ms) => { clock += ms; }, agora: () => clock };
}

async function jobPronto(l, round = 22, refs = REFS) {
  return l.ledger.ensureJob({
    roundNumber: round, expectedRecipientCount: refs.length, entryRefs: refs,
    contentHash: "conteudo-r" + round, fixtureIds: FIXTURES,
  });
}

console.log("F6 — LEDGER DURAVEL DE NOTIFICACAO POR RODADA\n");

// ─── IDENTIDADE ──────────────────────────────────────────────────────────────────────────────
console.log("IDENTIDADE E PII");
{
  check("chave canonica deterministica", roundKey(22) === "br2026:round-results:22:v1");
  check("mesma rodada -> mesma chave, sempre", roundKey(22) === roundKey(22));
  check("chave nao contem e-mail nem nome", !/[@]/.test(roundKey(22)));
  let recusou = false;
  try { recipientKey(22, "alguem@exemplo.invalid"); } catch { recusou = true; }
  check("entryRef com cara de e-mail e RECUSADO", recusou);
  check("hash de conjunto de destinatarios independe da ordem",
    recipientSetHash(["a", "b", "c"]) === recipientSetHash(["c", "a", "b"]));
  check("hash de conjunto muda quando o conjunto muda",
    recipientSetHash(["a", "b"]) !== recipientSetHash(["a", "b", "c"]));
  check("hash de jogos independe da ordem",
    fixtureSetHash(["1", "2"]) === fixtureSetHash(["2", "1"]));
}

// ─── INDEPENDENCIA ENTRE RODADAS ─────────────────────────────────────────────────────────────
console.log("\nINDEPENDENCIA ENTRE RODADAS");
{
  const l = novoLedger();
  await jobPronto(l, 22);
  await jobPronto(l, 23);
  await l.ledger.claim(22, "w1");
  await l.ledger.markSending(22);
  for (const r of REFS) await l.ledger.recordRecipient(22, r, RECIPIENT_STATE.ACCEPTED);
  await l.ledger.settle(22);

  const r23 = await l.ledger.get(23);
  check("R22 concluida nao altera a R23", r23.state === ROUND_STATE.READY);
  const claim23 = await l.ledger.claim(23, "w1");
  check("R23 pode ser reivindicada de forma independente", !!claim23);
  const pendentes = await l.ledger.pendingRounds();
  check("R22 SENT sai da fila de pendentes", !pendentes.some((p) => p.roundNumber === 22));
}

// ─── IDEMPOTENCIA ────────────────────────────────────────────────────────────────────────────
console.log("\nIDEMPOTENCIA");
{
  const l = novoLedger();
  const a = await jobPronto(l);
  const b = await jobPronto(l);
  check("ensureJob duas vezes nao duplica", a.idempotencyKey === b.idempotencyKey
    && (await l.repo.listByPrefix("br2026:")).length === 1);

  await l.ledger.claim(22, "w1");
  await l.ledger.markSending(22);
  for (const r of REFS) await l.ledger.recordRecipient(22, r, RECIPIENT_STATE.ACCEPTED);
  await l.ledger.settle(22);
  const depois = await jobPronto(l);
  check("rodada ja SENT continua SENT ao ser reavaliada", depois.state === ROUND_STATE.SENT);
}

// ─── IMUTABILIDADE DE CONTEUDO ───────────────────────────────────────────────────────────────
console.log("\nIMUTABILIDADE DE CONTEUDO");
{
  const l = novoLedger();
  await jobPronto(l);
  await l.ledger.claim(22, "w1");
  let falhouAlto = false;
  try {
    await l.ledger.ensureJob({ roundNumber: 22, expectedRecipientCount: 3, entryRefs: REFS,
                               contentHash: "CONTEUDO-DIFERENTE", fixtureIds: FIXTURES });
  } catch (e) { falhouAlto = /CONTEUDO_MUDOU_EM_JOB_ATIVO/.test(e.message); }
  check("conteudo diferente em job ATIVO falha alto, nao muta em silencio", falhouAlto);

  const l2 = novoLedger();
  await jobPronto(l2);
  const atualizado = await l2.ledger.ensureJob({ roundNumber: 22, expectedRecipientCount: 3,
    entryRefs: REFS, contentHash: "outro", fixtureIds: FIXTURES });
  check("job ainda READY pode ter conteudo atualizado", atualizado.contentHash === "outro");
}

// ─── COMPLETUDE DE DESTINATARIOS ─────────────────────────────────────────────────────────────
console.log("\nCOMPLETUDE DE DESTINATARIOS");
{
  const l = novoLedger();
  await l.ledger.ensureJob({ roundNumber: 22, expectedRecipientCount: 4, entryRefs: REFS,
                             contentHash: "c", fixtureIds: FIXTURES });   // 4 esperados, 3 resolvidos
  const portao = await l.ledger.assertRecipientCompleteness(22);
  check("esperados != resolvidos bloqueia", portao.ok === false
    && portao.reason === "RECIPIENT_SET_INCOMPLETE", JSON.stringify(portao));
  const rec = await l.ledger.get(22);
  check("bloqueio NAO deixa o ledger virar SENT", rec.state !== ROUND_STATE.SENT);
}

// ─── ENTREGA PARCIAL ─────────────────────────────────────────────────────────────────────────
console.log("\nENTREGA PARCIAL");
{
  const l = novoLedger();
  await jobPronto(l);
  await l.ledger.claim(22, "w1");
  await l.ledger.markSending(22);
  await l.ledger.recordRecipient(22, "e1", RECIPIENT_STATE.ACCEPTED, { providerMessageId: "pm-1" });
  await l.ledger.recordRecipient(22, "e2", RECIPIENT_STATE.FAILED, { error: "429" });
  await l.ledger.recordRecipient(22, "e3", RECIPIENT_STATE.PENDING);
  const rec = await l.ledger.settle(22);
  check("parcial NUNCA vira SENT", rec.state === ROUND_STATE.PARTIAL, `estado=${rec.state}`);
  check("disposicao por destinatario preservada",
    rec.recipients.find((r) => r.entryRef === "e1").state === RECIPIENT_STATE.ACCEPTED
    && rec.recipients.find((r) => r.entryRef === "e2").state === RECIPIENT_STATE.FAILED);
  check("providerMessageId persistido para quem foi aceito",
    rec.recipients.find((r) => r.entryRef === "e1").providerMessageId === "pm-1");
  const reenviaveis = rec.recipients.filter((r) => r.state !== RECIPIENT_STATE.ACCEPTED);
  check("retry alveja SO quem nao foi aceito", reenviaveis.length === 2
    && !reenviaveis.some((r) => r.entryRef === "e1"));
}

// ─── CLAIM / LEASE ───────────────────────────────────────────────────────────────────────────
console.log("\nCLAIM / LEASE");
{
  const l = novoLedger();
  await jobPronto(l);
  const w1 = await l.ledger.claim(22, "worker-1");
  const w2 = await l.ledger.claim(22, "worker-2");
  check("exatamente um vencedor entre dois claims", !!w1 && w2 === null);
  check("dono do lease registrado", w1.claimedBy === "worker-1");

  l.avanca(30_000);
  const w3 = await l.ledger.claim(22, "worker-3");
  check("lease ATIVO nao pode ser roubado", w3 === null);
}

// ─── MATRIZ DE CRASH ─────────────────────────────────────────────────────────────────────────
console.log("\nMATRIZ DE CRASH");
{
  // 1. Morte ANTES da chamada ao provedor: lease expira, volta para READY, retry seguro.
  const l = novoLedger();
  await jobPronto(l);
  await l.ledger.claim(22, "worker-morto");
  l.avanca(120_000);
  const rec = await l.ledger.recoverExpiredLeases();
  check("crash ANTES do provedor: lease expira e volta para READY",
    rec.length === 1 && rec[0].state === ROUND_STATE.READY, `estado=${rec[0] && rec[0].state}`);
  const reclaim = await l.ledger.claim(22, "worker-novo");
  check("apos recuperacao, outro worker consegue reivindicar", !!reclaim);
}
{
  // 2/3. Morte DEPOIS de SENDING: NAO volta para a fila. Esta e a regra central.
  const l = novoLedger();
  await jobPronto(l);
  await l.ledger.claim(22, "worker-morto");
  await l.ledger.markSending(22);
  await l.ledger.recordRecipient(22, "e1", RECIPIENT_STATE.ACCEPTED, { providerMessageId: "pm-1" });
  await l.ledger.recordRecipient(22, "e2", RECIPIENT_STATE.SENDING);   // provedor pode ter aceito
  l.avanca(120_000);
  const rec = await l.ledger.recoverExpiredLeases();
  check("crash DEPOIS do envio comecar NAO reenfileira automaticamente",
    rec[0].state === ROUND_STATE.NEEDS_MANUAL_REVIEW, `estado=${rec[0].state}`);
  check("destinatario em voo vira UNCERTAIN, nao PENDING",
    rec[0].recipients.find((r) => r.entryRef === "e2").state === RECIPIENT_STATE.UNCERTAIN);
  check("destinatario ja aceito permanece ACCEPTED",
    rec[0].recipients.find((r) => r.entryRef === "e1").state === RECIPIENT_STATE.ACCEPTED);
  const pend = await l.ledger.pendingRounds();
  check("rodada em revisao manual sai da fila automatica",
    !pend.some((p) => p.roundNumber === 22));
}
{
  // 4. Reinicio do runner com o MESMO armazenamento durável: disposicao sobrevive.
  const repo = createMemoryRoundLedgerRepo();
  let clock = 1_000_000;
  const l1 = createRoundLedger({ repo, now: () => clock, leaseMs: 60_000 });
  await l1.ensureJob({ roundNumber: 22, expectedRecipientCount: 3, entryRefs: REFS,
                       contentHash: "c", fixtureIds: FIXTURES });
  await l1.claim(22, "w1");
  await l1.markSending(22);
  await l1.recordRecipient(22, "e1", RECIPIENT_STATE.ACCEPTED, { providerMessageId: "pm-1" });

  // "reinicio": ledger novo, MESMO repositório.
  const l2 = createRoundLedger({ repo, now: () => clock, leaseMs: 60_000 });
  const rec = await l2.get(22);
  check("reinicio do runner preserva a disposicao durável",
    rec.state === ROUND_STATE.SENDING
    && rec.recipients.find((r) => r.entryRef === "e1").state === RECIPIENT_STATE.ACCEPTED);
}
{
  // 5. Execucao DUPLICADA do workflow: a segunda nao consegue reivindicar.
  const l = novoLedger();
  await jobPronto(l);
  const a = await l.ledger.claim(22, "run-A");
  const b = await l.ledger.claim(22, "run-B");
  check("execucao duplicada do workflow: so uma reivindica", !!a && b === null);
}
{
  // 6. Falha permanente do provedor para todos.
  const l = novoLedger();
  await jobPronto(l);
  await l.ledger.claim(22, "w1");
  await l.ledger.markSending(22);
  for (const r of REFS) await l.ledger.recordRecipient(22, r, RECIPIENT_STATE.FAILED, { error: "403" });
  const rec = await l.ledger.settle(22);
  check("falha total vira FAILED, nunca SENT", rec.state === ROUND_STATE.FAILED);
}

// ─── SEMANTICA DECLARADA ─────────────────────────────────────────────────────────────────────
console.log("\nSEMANTICA DE ENTREGA");
{
  check("a garantia declarada NAO afirma exactly-once",
    !/exactly.?once/i.test(DELIVERY_SEMANTICS), DELIVERY_SEMANTICS);
  check("a janela de incerteza apos o aceite esta declarada",
    /UNCERTAIN_AFTER_PROVIDER_ACCEPT/.test(DELIVERY_SEMANTICS), DELIVERY_SEMANTICS);
}

// ─── LOG SANITIZADO ──────────────────────────────────────────────────────────────────────────
console.log("\nLOG SANITIZADO");
{
  const l = novoLedger();
  await jobPronto(l);
  await l.ledger.claim(22, "w1");
  await l.ledger.markSending(22);
  await l.ledger.recordRecipient(22, "e1", RECIPIENT_STATE.ACCEPTED, { providerMessageId: "pm-1" });
  await l.ledger.settle(22);
  const blob = JSON.stringify(l.eventos);
  check("nenhum e-mail no fluxo de eventos", !/@/.test(blob));
  const tipos = l.eventos.map((e) => e.eventType);
  for (const esperado of ["job_created", "job_claimed", "job_send_started", "recipient_accepted"]) {
    check(`evento canonico emitido: ${esperado}`, tipos.includes(esperado), tipos.join(","));
  }
}

// ─── CONTRATO ESTATICO SOBRE O SQL REAL ──────────────────────────────────────────────────────
console.log("\nCONTRATO DE SEGURANCA SOBRE O SQL DE PRODUCAO");
{
  const sqlBruto = readFileSync(join(ROOT, "bolao/shared/sql/010_notification_durability.sql"), "utf8");
  // SQL EXECUTAVEL apenas. O arquivo documenta em prosa a policy que NAO deve existir
  // ("create policy ... to anon"), e um teste que lesse os comentarios acusaria justamente o
  // texto que proibe a coisa proibida.
  const sql = sqlBruto.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  check("claim usa FOR UPDATE SKIP LOCKED (atomicidade e do banco, nao do JS)",
    /for update skip locked/i.test(sql));
  check("idempotencia tem unicidade no banco", /unique \(idempotency_key\)/i.test(sql));
  check("RLS habilitada na tabela de jobs", /enable row level security/i.test(sql));
  check("NENHUMA policy concedida a anon",
    !/create policy[\s\S]*?to\s+anon/i.test(sql));
  check("tabela nao tem coluna de e-mail",
    !/\b(email|e_mail|recipient_email|participant_email)\b\s+text/i.test(sql));
  check("usa referencia opaca de entrada", /entry_ref/.test(sql));
  check("lease tem expiracao", /lease_expires_at/.test(sql));
  check("RPCs sao security definer", /security definer/i.test(sql));
  // O rollback vive no rodape em comentario, de proposito: e instrucao para operador,
  // nao DDL a executar. Por isso e verificado no arquivo BRUTO.
  check("rollback documentado", /rollback/i.test(sqlBruto));
  check("rollback nomeia os objetos criados",
    /drop\s+(table|function|type)/i.test(sqlBruto), "rollback sem drop dos objetos");
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 ROUND_NOTIFICATION_LEDGER FAILED");
  process.exit(1);
}
console.log("\n✓ ROUND_NOTIFICATION_LEDGER PASSED");
