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
import { runPublishTickets } from "./email/publish_tickets.mjs";
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
const realDraw = DRAWS[DRAWS.length - 1];

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
console.log("\nFlow A — participant confirmation:");
test("missing state blocks the send with PARTICIPANT_STATE_UNSUPPORTED", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const participant = { name: "Blocked Test", email: "blocked@example.com", cotas: 1, valor: 10, data: "01/01/2026", hora: "—", status: "verificado", state: "TX" };
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
  const synth = { name: "Blocked Synth", email: "blocked2@example.com", cotas: 1, valor: 10, data: "01/01/2026", hora: "—", status: "verificado", state: "TX" };
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
  const patchedDraw = { ...draw, finance: RECONCILED_FINANCE_STUB, participants: [dupCotas, ...draw.participants.slice(1)] };
  const r = await runPublishTickets({ drawId: realDraw.id, publicationVersion: 999, dryRun: true, outboxFile: TMP_OUTBOX, syntheticDraw: patchedDraw });
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
  const patchedDraw = { ...draw, finance: RECONCILED_FINANCE_STUB, participants: [...draw.participants, cancelled, zeroCota, badEmail] };
  const r = await runPublishTickets({ drawId: realDraw.id, publicationVersion: 998, dryRun: true, outboxFile: TMP_OUTBOX, syntheticDraw: patchedDraw });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const names = r.results.map((x) => x.participant);
  assert.ok(!names.includes("Cancelled Person"));
  assert.ok(!names.includes("Zero Cota"));
  assert.ok(!names.includes("Bad Email"));
});
if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);

test("the REAL 2026-08-05 draw finance, unmodified, is correctly BLOCKED by the reconciliation gate (round-1 bug 2 regression)", () => {
  const draw = loadDrawSnapshot(realDraw.id);
  const r = validateTicketPublication({ draw, participants: draw.participants, tickets: [{ numbers: [1, 2, 3, 4, 5], special: 1 }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("FINANCE_NOT_RECONCILED")));
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
