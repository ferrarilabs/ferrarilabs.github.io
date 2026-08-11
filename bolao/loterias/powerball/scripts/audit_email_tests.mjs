#!/usr/bin/env node
// audit_email_tests.mjs — automated test suite for the Powerball email
// architecture (Flow A: participant confirmation, Flow B: ticket publication).
// No network calls are made here (all sends use dryRun / synthetic senders);
// run before any real send, same spirit as audit_scoring.py's self-test gate.

import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRealPrizeCalculator } from "./email/prize-calc-bridge.mjs";
import { loadDrawSnapshot, loadParticipantSnapshot, loadFinancialEstimates } from "./email/snapshot.mjs";
import { validateParticipantConfirmation, validateTicketPublication, eligibleRecipients, isValidEmail } from "./email/validate.mjs";
import { buildParticipantConfirmationPayload, buildTicketPublicationPayload, sha256Hex, stableStringify, manifestToCsv } from "./email/payload.mjs";
import { renderParticipantConfirmationHtml, renderParticipantConfirmationText, renderTicketPublicationHtml } from "./email/render.mjs";
import { enqueueEmailJob, findByIdempotencyKey, idempotencyKeyForParticipant, listJobs } from "./email/outbox.mjs";
import { runParticipantConfirmation } from "./email/send_participant_confirmation.mjs";
import { runPublishTickets, ticketsFromDraw } from "./email/publish_tickets.mjs";
import { buildTextPdf } from "./email/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_OUTBOX = path.join(__dirname, "email", ".test-outbox.json");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}
async function atest(name, fn) {
  try { await fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}

console.log("Powerball email architecture — automated tests\n");

// -------- 1. Prize calc reuse (real function, matrix, not reinvented) --------
console.log("Prize calculation (reused from js/app.js):");
const { calculatePrizePerParticipant, DRAWS } = loadRealPrizeCalculator();
// ─── SELEÇÃO DO SORTEIO ALVO (corrigida 2026-08-09) ─────────────────────────────────────────
//
// O comentário anterior dizia que estes testes miram "the most recent COMPLETED draw with
// participants". O código NÃO fazia isso — filtrava só por `participants.length > 0`. Enquanto o
// sorteio aberto ficava sem participantes, o resultado coincidia com a intenção, e a divergência
// entre o comentário e o código era invisível.
//
// Em 2026-08-09 o sorteio aberto (10/08) ganhou 7 participantes reais. `realDraw` passou a
// apontar para um sorteio SEM bilhetes e SEM resultado, e 6 testes caíram de uma vez — nenhum
// deles por defeito de produto. É a mesma classe do `drawSelectorLabel` "kept in sync manually":
// uma intenção escrita em prosa que nenhum mecanismo garantia.
//
// Agora o predicado é o mesmo que a aplicação usa para "já sorteado" — PRESENÇA DE RESULTADO,
// nunca `status`, que em produção está obsoleto (o 08/08 tem `status: "planejamento"` COM
// resultado oficial gravado).
const isSettled = (d) => !!(d.result && d.result.numbers);
const realDraw = DRAWS.filter((d) => isSettled(d) && d.participants && d.participants.length > 0).slice(-1)[0];
if (!realDraw) {
  console.error("Nenhum sorteio liquidado COM participantes em data.js — sem fixture, estes testes " +
    "não afirmam nada. Falhando em vez de passar vazio.");
  process.exit(1);
}

// ─── DADO PRIVADO SINTÉTICO (2026-08-09) ────────────────────────────────────────────────────
//
// Três testes procuram um participante com e-mail (`isValidEmail(p.email)`) ou com `txId`. Desde
// o hotfix de PII (P0.1), `js/data.js` — que é público — não carrega mais esses campos: eles vêm
// do secret (`POWERBALL_PRIVATE_PARTICIPANT_DATA`) ou de um sidecar local gitignorado.
//
// Consequência: esses testes passavam onde o secret existe (CI) e falhavam com um
// `Cannot read properties of undefined (reading 'name')` em qualquer máquina sem ele. Verde
// dependente de ambiente — e a mensagem de erro não dizia nada sobre a causa real.
//
// Correção: o teste passa a INJETAR um mapa privado sintético, derivado dos próprios
// participantes do sorteio alvo. Assim ele exercita o caminho de merge de verdade
// (`withPrivateFields`), é hermético em qualquer máquina, e não depende do secret nem o expõe.
// Endereços em domínio reservado (.invalid) — nenhum endereço real entra em fixture.
process.env.POWERBALL_PRIVATE_PARTICIPANT_DATA = JSON.stringify({
  [realDraw.id]: Object.fromEntries(realDraw.participants.map((p, i) => [
    p.name,
    { email: `participante${i + 1}@example.invalid`, txId: `EXAMPLE-TXID-${String(i + 1).padStart(4, "0")}` },
  ])),
});

test("known state (NC) returns full estimate matching the real function's own output shape", () => {
  const p = realDraw.participants.find((x) => x.state === "NC");
  const r = calculatePrizePerParticipant(realDraw, p);
  assert.equal(r.stateKnown, true);
  assert.ok(typeof r.lumpSumNet === "number" && r.lumpSumNet > 0);
  assert.ok(typeof r.annuityTotalNet === "number" && r.annuityTotalNet > 0);
});
test("known state (FL, 0% state tax) nets more than an equal-cota NC participant", () => {
  const fl = realDraw.participants.find((x) => x.state === "FL");
  const nc = realDraw.participants.find((x) => x.state === "NC" && x.cotas === fl.cotas);
  const rfl = calculatePrizePerParticipant(realDraw, fl);
  const rnc = calculatePrizePerParticipant(realDraw, nc);
  assert.ok(rfl.lumpSumNet > rnc.lumpSumNet);
});
test("unsupported state returns stateKnown:false and null net figures (no invented numbers)", () => {
  const synthetic = { name: "Synthetic CA", cotas: 1, state: "CA" };
  const draftDraw = { ...realDraw, participants: [...realDraw.participants, synthetic] };
  const r = calculatePrizePerParticipant(draftDraw, synthetic);
  assert.equal(r.stateKnown, false);
  assert.equal(r.lumpSumNet, null);
  assert.equal(r.annuityTotalNet, null);
});
test("missing state (undefined) also returns stateKnown:false", () => {
  const synthetic = { name: "Synthetic NoState", cotas: 1 };
  const draftDraw = { ...realDraw, participants: [...realDraw.participants, synthetic] };
  const r = calculatePrizePerParticipant(draftDraw, synthetic);
  assert.equal(r.stateKnown, false);
});

// -------- 2. Flow A validation / payload --------
// ESTADO INEXISTENTE, de proposito (2026-08-11).
//
// Estes casos usavam "TX" como exemplo de estado NAO suportado. Deixou de ser: entrou um
// participante real do Texas no sorteio de 12/08 e a tabela ganhou `TX: 0` (o Texas nao tem
// imposto de renda estadual) -- produto correto, gate errado. O teste passou a reprovar a
// mudanca certa.
//
// Qualquer sigla de estado REAL pode ganhar participante e suporte a qualquer momento. "ZZ" nao
// e um estado americano e nunca vai ser, entao o caso nao pode apodrecer de novo.
const ESTADO_NAO_SUPORTADO = "ZZ";

console.log("\nFlow A — participant confirmation:");
test("missing state blocks the send with PARTICIPANT_STATE_UNSUPPORTED", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const participant = { name: "Blocked Test", email: "blocked@example.com", cotas: 1, valor: 10, data: "01/01/2026", hora: "—", status: "verificado", state: ESTADO_NAO_SUPORTADO };
  const draftDraw = { ...draw, participants: [...draw.participants, participant] };
  const estimates = calculatePrizePerParticipant(draftDraw, participant);
  const v = validateParticipantConfirmation({ participant, draw, estimates });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("PARTICIPANT_STATE_UNSUPPORTED"));
});
test("invalid email blocks the send", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const participant = { name: "No Email", email: "—", cotas: 1, state: "NC" };
  const estimates = { stateKnown: true, lumpSumNet: 1 };
  const v = validateParticipantConfirmation({ participant, draw, estimates });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("PARTICIPANT_EMAIL_INVALID"));
});
test("valid known-state participant passes validation", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const participant = draw.participants.find((p) => p.state === "NC" && isValidEmail(p.email));
  const estimates = loadFinancialEstimates(realDraw.id, participant.name);
  const v = validateParticipantConfirmation({ participant, draw, estimates });
  assert.equal(v.ok, true);
});
test("payload never includes other participants' data", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const participant = draw.participants[0];
  const estimates = loadFinancialEstimates(realDraw.id, participant.name);
  const payload = buildParticipantConfirmationPayload({ participant, draw, estimates });
  const json = JSON.stringify(payload);
  draw.participants.slice(1).forEach((other) => {
    if (!other.email || other.email === "—") return; // placeholder, not a real leaked value
    assert.ok(!json.includes(other.email) || other.email === participant.email, `leaked ${other.name}'s email`);
  });
});
test("payload contains no transaction id / banking details", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const participant = draw.participants.find((p) => p.txId && p.txId !== "—");
  const estimates = loadFinancialEstimates(realDraw.id, participant.name);
  const payload = buildParticipantConfirmationPayload({ participant, draw, estimates });
  const html = renderParticipantConfirmationHtml(payload, false);
  assert.ok(!html.includes(participant.txId));
  assert.ok(!/txId/i.test(html));
});

// -------- 3. Outbox idempotency --------
console.log("\nOutbox idempotency:");
if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);
test("new participant enqueues exactly one job", () => {
  const key = idempotencyKeyForParticipant("powerball", "Idem Test", 1);
  const r1 = enqueueEmailJob({ poolId: "powerball", drawId: "x", participantId: "Idem Test", eventType: "participant-added", recipient: "a@example.com", templateId: "participant-added", templateVersion: 1, payloadSnapshot: {}, idempotencyKey: key }, TMP_OUTBOX);
  assert.equal(r1.created, true);
  assert.equal(listJobs(TMP_OUTBOX).length, 1);
});
test("double-click / retry with same idempotencyKey does not duplicate", () => {
  const key = idempotencyKeyForParticipant("powerball", "Idem Test", 1);
  const r2 = enqueueEmailJob({ poolId: "powerball", drawId: "x", participantId: "Idem Test", eventType: "participant-added", recipient: "a@example.com", templateId: "participant-added", templateVersion: 1, payloadSnapshot: {}, idempotencyKey: key }, TMP_OUTBOX);
  assert.equal(r2.created, false);
  assert.equal(listJobs(TMP_OUTBOX).length, 1);
});
test("editing an existing participant (same key) does not trigger a new confirmation job", () => {
  // Editing does not change the idempotency key (participantId + templateVersion) —
  // so enqueueing again after an edit is deduped just like a retry.
  const key = idempotencyKeyForParticipant("powerball", "Idem Test", 1);
  const before = listJobs(TMP_OUTBOX).length;
  enqueueEmailJob({ poolId: "powerball", drawId: "x", participantId: "Idem Test", eventType: "participant-added", recipient: "a@example.com", templateId: "participant-added", templateVersion: 1, payloadSnapshot: { edited: true }, idempotencyKey: key }, TMP_OUTBOX);
  assert.equal(listJobs(TMP_OUTBOX).length, before);
});
if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);

// -------- 4. End-to-end dry runs (no network) --------
console.log("\nEnd-to-end dry runs (no network):");
await atest("runParticipantConfirmation dry-run sends to only the participant's own address", async () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const participant = draw.participants.find((p) => p.state === "NC" && isValidEmail(p.email));
  const r = await runParticipantConfirmation({ drawId: realDraw.id, participantName: participant.name, dryRun: true, outboxFile: TMP_OUTBOX });
  assert.equal(r.ok, true);
  assert.equal(r.job.recipient, participant.email);
});
await atest("runParticipantConfirmation blocks on unsupported state and offers retry action", async () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const synth = { name: "Blocked Synth", email: "blocked2@example.com", cotas: 1, valor: 10, data: "01/01/2026", hora: "—", status: "verificado", state: ESTADO_NAO_SUPORTADO };
  const r = await runParticipantConfirmation({ drawId: realDraw.id, participantName: synth.name, overrideParticipant: synth, dryRun: true, outboxFile: TMP_OUTBOX });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("PARTICIPANT_STATE_UNSUPPORTED"));
  assert.equal(r.retryAction, "Reenviar confirmação de entrada");
});
if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);

// NOTE: the real 2026-08-05 draw's own finance fields do not reconcile
// (totalArrecadado 138 != valorUtilizado 153 + saldo 1) — that's the exact
// bug found in round 1, and the reconciliation gate now correctly blocks it.
// These two structural tests (dedup / eligibility filtering) aren't testing
// reconciliation, so they use a reconciled finance stub on top of the real
// participant list.
const RECONCILED_FINANCE_STUB = { totalArrecadado: 6, valorUtilizado: 6, valorGuardadoProximoSorteio: 0, reembolso: 0, outrasDestinacoes: 0 };

await atest("runPublishTickets: one job per eligible recipient, multi-cota participant still gets exactly one", async () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const dupCotas = { ...draw.participants[0], cotas: 3 };
  // sharedTickets.valorPorTicket nulled out: this test is about idempotency/dedup, not
  // ticket-cost reconciliation — the real draw's 56 real tickets stay attached (still
  // needed so runPublishTickets has real tickets to build payloads from) but with the
  // stubbed-down RECONCILED_FINANCE_STUB they'd otherwise fail the (correctly working,
  // since the costPerTicket field-name fix) cost-consistency check below.
  const patchedDraw = { ...draw, finance: RECONCILED_FINANCE_STUB, result: null, sharedTickets: { ...draw.sharedTickets, valorPorTicket: null }, participants: [dupCotas, ...draw.participants.slice(1)] };
  const r = await runPublishTickets({ drawId: realDraw.id, publicationVersion: 999, testMode: true, dryRun: true, outboxFile: TMP_OUTBOX, syntheticDraw: patchedDraw });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const names = r.results.map((x) => x.participant);
  assert.equal(new Set(names).size, names.length, "duplicate recipient jobs found");
});
if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);

await atest("runPublishTickets excludes cancelled / cota<=0 / invalid-email participants", async () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const cancelled = { ...draw.participants[0], name: "Cancelled Person", email: "cancelled@example.com", status: "cancelado" };
  const zeroCota = { ...draw.participants[1], name: "Zero Cota", email: "zero@example.com", cotas: 0 };
  const badEmail = { ...draw.participants[2], name: "Bad Email", email: "—" };
  const patchedDraw = { ...draw, finance: RECONCILED_FINANCE_STUB, result: null, sharedTickets: { ...draw.sharedTickets, valorPorTicket: null }, participants: [...draw.participants, cancelled, zeroCota, badEmail] };
  const r = await runPublishTickets({ drawId: realDraw.id, publicationVersion: 998, testMode: true, dryRun: true, outboxFile: TMP_OUTBOX, syntheticDraw: patchedDraw });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const names = r.results.map((x) => x.participant);
  assert.ok(!names.includes("Cancelled Person"));
  assert.ok(!names.includes("Zero Cota"));
  assert.ok(!names.includes("Bad Email"));
});
if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);

// This used to assert against the REAL current draw's own finance object,
// unmodified — meaningful back when that object genuinely had the round-1
// bug (totalArrecadado=138 vs valorUtilizado=153+saldo=1, no accounting for
// carried-forward credit). Both root causes are now fixed: js/data.js's
// finance for real draws is complete (creditoSorteioAnterior recorded when a
// draw is funded partly by a prior draw's leftover balance + confirmed
// prize), and validateFinancialReconciliation() was taught to add that field
// into the "funds available" side (2026-08-08, Eduardo's call — see the
// function's own doc comment). So the real draw now correctly RECONCILES,
// which is the desired outcome, not a regression — pinning this test to "the
// current real draw must be broken" would have made it fail forever after a
// legitimate fix, and would silently stop testing anything once the real
// data changed shape again. Guards the original bug directly instead, via a
// synthetic finance object with the exact reported numbers and no
// creditoSorteioAnterior — the actual invariant worth protecting.
test("a draw with the original round-1-bug finance shape (no creditoSorteioAnterior) is correctly BLOCKED", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const brokenDraw = { ...draw, finance: { totalArrecadado: 138, valorUtilizado: 153, valorGuardadoProximoSorteio: 1, reembolso: 0, outrasDestinacoes: 0 } };
  const r = validateTicketPublication({ draw: brokenDraw, participants: draw.participants, tickets: [{ numbers: [1, 2, 3, 4, 5], special: 1 }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("FINANCE_NOT_RECONCILED")));
});

// 2026-08-09: este teste passou a falhar com `DRAW_ALREADY_CONCLUDED` quando a seleção de
// `realDraw` foi corrigida para mirar um sorteio LIQUIDADO. Não é defeito de produto nem do
// alvo novo — é que `validateTicketPublication` guarda o Fluxo B (publicação de bilhetes), que
// por definição roda ANTES do sorteio. Um sorteio já realizado ser bloqueado ali é o
// comportamento certo, e a asserção original ("não é bloqueado") só era compatível com um
// sorteio ainda aberto.
//
// O que este teste quer provar continua válido e vale a pena: as finanças REAIS de um sorteio
// real reconciliam, com `creditoSorteioAnterior` entrando do lado dos fundos disponíveis. Então
// ele exercita o mesmo sorteio real no ESTADO EM QUE O FLUXO B RODA — o dia anterior ao
// sorteio, `result: null` — mantendo 100% dos números reais de finanças e bilhetes. Mesma
// técnica já usada acima (`patchedDraw`), nada sintético no que está sendo verificado.
test("as finanças REAIS de um sorteio real reconciliam (crédito anterior contabilizado) e não bloqueiam a publicação", () => {
  const settled = loadDrawSnapshot(realDraw.id);
  const beforeDrawing = { ...settled, result: null }; // o estado em que o Fluxo B de fato roda
  // Bilhetes reais, não um substituto de 1 bilhete: a checagem de custo por bilhete roda de
  // verdade, e uma contagem falsa divergiria legitimamente do `valorUtilizado` real.
  const tickets = ticketsFromDraw(beforeDrawing);
  const r = validateTicketPublication({ draw: beforeDrawing, participants: beforeDrawing.participants, tickets });
  assert.equal(r.ok, true, r.errors.join("; "));
});

// Contrapartida da correção acima — o bloqueio que ela revelou é uma garantia de segurança real e
// não estava coberta por teste nenhum: publicar bilhetes DEPOIS do resultado anunciaria como
// "apostas em jogo" bilhetes cuja sorte já está decidida.
test("publicar bilhetes de um sorteio JÁ REALIZADO é bloqueado, e especificamente por isso", () => {
  const settled = loadDrawSnapshot(realDraw.id);
  const r = validateTicketPublication({
    draw: settled, participants: settled.participants, tickets: ticketsFromDraw(settled),
  });
  assert.equal(r.ok, false, "um sorteio já realizado não pode passar pelo fluxo de publicação de bilhetes");
  assert.ok(r.errors.some((e) => e.includes("DRAW_ALREADY_CONCLUDED")),
    `bloqueado pelo motivo errado: ${r.errors.join("; ")}`);
  // E o bloqueio NÃO pode ser por finanças — se fosse, o teste acima estaria mascarando um
  // problema financeiro real atrás do motivo "já concluído".
  assert.ok(!r.errors.some((e) => e.includes("FINANCE_NOT_RECONCILED")),
    `as finanças do sorteio real não reconciliam: ${r.errors.join("; ")}`);
});

test("validateTicketPublication blocks when no tickets / no participants / invalid ticket", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  assert.equal(validateTicketPublication({ draw, participants: draw.participants, tickets: [] }).ok, false);
  assert.equal(validateTicketPublication({ draw, participants: [], tickets: [{ numbers: [1, 2, 3, 4, 5], special: 1 }] }).ok, false);
  assert.equal(validateTicketPublication({ draw, participants: draw.participants, tickets: [{ numbers: [1, 2], special: 1 }] }).ok, false);
});

// -------- 5. Financial totals reconciliation --------
console.log("\nFinancial reconciliation:");
test("financial summary totals reconcile against draw.finance (using a reconciled finance stub)", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const reconciledDraw = { ...draw, finance: { totalArrecadado: 6, valorUtilizado: 6, valorGuardadoProximoSorteio: 0, reembolso: 0, outrasDestinacoes: 0 } };
  const tickets = [{ numbers: [1, 2, 3, 4, 5], special: 1 }];
  const { shared } = buildTicketPublicationPayload({ draw: reconciledDraw, participants: draw.participants, tickets, publicationVersion: 1 });
  assert.equal(shared.financialSummary.totalArrecadado, reconciledDraw.finance.totalArrecadado);
  assert.equal(shared.financialSummary.valorUsado, reconciledDraw.finance.valorUtilizado);
  assert.equal(shared.financialSummary.saldoReservado, reconciledDraw.finance.valorGuardadoProximoSorteio);
  assert.equal(shared.financialSummary.diferencaNaoConciliada, 0);
  const sumCotas = draw.participants.reduce((s, p) => s + p.cotas, 0);
  assert.equal(shared.financialSummary.totalShares, sumCotas);
});

// -------- 6. Snapshot immutability --------
console.log("\nSnapshot immutability:");
test("loadDrawSnapshot returns a deep clone, not the live object", () => {
  const a = loadDrawSnapshot(realDraw.id);
  a.participants[0].name = "MUTATED";
  const b = loadDrawSnapshot(realDraw.id);
  assert.notEqual(b.participants[0].name, "MUTATED");
});
test("retry reuses the exact same frozen payloadSnapshot, never recomputes", () => {
  const key = "powerball:test:retry-check:v1";
  const snap = { frozen: true, valor: 123 };
  const r1 = enqueueEmailJob({ poolId: "p", drawId: "d", participantId: "x", eventType: "participant-added", recipient: "a@example.com", templateId: "participant-added", templateVersion: 1, payloadSnapshot: snap, idempotencyKey: key }, TMP_OUTBOX);
  const r2 = enqueueEmailJob({ poolId: "p", drawId: "d", participantId: "x", eventType: "participant-added", recipient: "a@example.com", templateId: "participant-added", templateVersion: 1, payloadSnapshot: { frozen: true, valor: 999 }, idempotencyKey: key }, TMP_OUTBOX);
  assert.equal(r2.job.payloadSnapshot.valor, 123, "retry must not overwrite the original frozen snapshot");
});
if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);

// -------- 7. Hash consistency across HTML/PDF/JSON/CSV --------
console.log("\nManifest hash consistency across formats:");
test("hash in HTML email, CSV, and PDF text all match the manifest's own sha256", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const tickets = [{ numbers: [1, 2, 3, 4, 5], special: 1, serial: "S1" }, { numbers: [6, 7, 8, 9, 10], special: 2, serial: "S1" }];
  const { shared, perRecipient } = buildTicketPublicationPayload({ draw, participants: draw.participants, tickets, publicationVersion: 1 });
  const csv = manifestToCsv(shared.manifest);
  const html = renderTicketPublicationHtml(perRecipient[0], false);
  assert.ok(csv.includes(shared.manifest.sha256)); // full hash in the JSON-manifest-derived CSV
  assert.ok(html.includes(shared.manifestHashShort)); // HTML shows the short form only, per the "Hash presentation" spec
  assert.ok(shared.manifest.sha256.startsWith(shared.manifestHashShort.split("…")[0]));
  // Recomputed independently from the manifest content (minus the hash field itself) must match.
  const { sha256, ...manifestWithoutHash } = shared.manifest;
  assert.equal(sha256Hex(stableStringify(manifestWithoutHash)), sha256);
});

// -------- 8. Correction versioning --------
console.log("\nCorrection versioning:");
test("correction payload carries a distinct templateId and references the previous hash", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const tickets = [{ numbers: [1, 2, 3, 4, 5], special: 1 }];
  const v1 = buildTicketPublicationPayload({ draw, participants: draw.participants, tickets, publicationVersion: 1 });
  const v2 = buildTicketPublicationPayload({ draw, participants: draw.participants, tickets: [{ numbers: [11, 12, 13, 14, 15], special: 9 }], publicationVersion: 2, correctionReason: "Número trocado por erro de digitação", previousHash: v1.shared.manifestHash });
  assert.equal(v2.shared.templateId, "tickets-corrected");
  assert.notEqual(v2.shared.manifestHash, v1.shared.manifestHash);
  assert.equal(v2.shared.previousHash, v1.shared.manifestHash);
});

// -------- 9. PDF sanity --------
console.log("\nPDF output sanity:");
test("buildTextPdf produces bytes recognizable as a PDF", () => {
  const buf = buildTextPdf(["a", "b"], {});
  assert.equal(buf.slice(0, 5).toString("latin1"), "%PDF-");
  assert.ok(buf.toString("latin1").includes("%%EOF"));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
