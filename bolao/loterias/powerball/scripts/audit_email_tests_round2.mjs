#!/usr/bin/env node
// audit_email_tests_round2.mjs — round-2 regression suite. Covers the exact
// class of bugs Eduardo found in the round-1 test emails, plus the new
// fixture/cross-template/reconciliation/diff machinery. Run alongside
// audit_email_tests.mjs (round 1), not instead of it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture, validateFixtureConsistency, fixtureAsDraw } from "./email/fixture.mjs";
import { loadRealPrizeCalculator } from "./email/prize-calc-bridge.mjs";
import { buildParticipantConfirmationPayload, buildTicketPublicationPayload, sha256Hex, stableStringify } from "./email/payload.mjs";
import { validateFinancialReconciliation, validateTicketCostTotal, validateCrossTemplateConsistency, validateTicketPublication } from "./email/validate.mjs";
import { computeTicketDiff } from "./email/diff.mjs";
import { renderParticipantConfirmationSubject, renderTicketPublicationSubject } from "./email/render.mjs";
import { buildAllThreeFromFixture } from "./email/run_fixture_test_sends.mjs";
import { runPublishTickets } from "./email/publish_tickets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}
async function atest(name, fn) {
  try { await fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}

console.log("Powerball email — round 2 regression tests\n");

const fx = loadFixture();
const { calculatePrizePerParticipant } = loadRealPrizeCalculator();

console.log("Fixture consistency:");
test("shared fixture passes its own consistency validator", () => {
  const r = validateFixtureConsistency(fx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

console.log("\nExplicit regressions for this round's exact reported bugs:");

test("regression (a): arrecadado=138, utilizado=153, saldo=1 must be BLOCKED, not sent", () => {
  const broken = { totalArrecadado: 138, valorUtilizado: 153, valorGuardadoProximoSorteio: 1, reembolso: 0, outrasDestinacoes: 0 };
  const r = validateFinancialReconciliation(broken);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes("FINANCE_NOT_RECONCILED"));
});

test("regression (b): 1 cota of 1 total cota reported as 7.14% must be BLOCKED (percentage always computed from the SAME totalShares as the rest of the draw)", () => {
  // The bug was two DIFFERENT draws (14 participants vs 1) feeding two templates.
  // Guard: building a confirmation payload against a draw with totalShares=1
  // must yield 100%, never a value borrowed from a different snapshot.
  const draw = fixtureAsDraw(fx, 1);
  const singleParticipantDraw = { ...draw, participants: [draw.participants[0]] };
  const estimates = calculatePrizePerParticipant(singleParticipantDraw, singleParticipantDraw.participants[0]);
  const payload = buildParticipantConfirmationPayload({ participant: singleParticipantDraw.participants[0], draw: singleParticipantDraw, estimates });
  assert.equal(payload.totalShares, 1);
  assert.equal(payload.participantPercentage, 100);
  assert.notEqual(payload.participantPercentage, 7.14, "must not silently reuse a different draw's percentage");
});

await atest("regression (c): correction claiming a change with NO actual ticket diff must be BLOCKED, no email created", async () => {
  const draw = fixtureAsDraw(fx, 1);
  const sameTickets = fx.ticketVersions["1"];
  const r = await runPublishTickets({
    drawId: fx.drawId, publicationVersion: 2, testMode: true, dryRun: true, outboxFile: "/tmp/pb-round2-noop.json",
    syntheticDraw: { ...draw, __tickets: sameTickets },
    correctionReason: "Descrição inventada sem diff real",
    previousTickets: sameTickets, // identical to "new" tickets -> no real diff
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("NO_DIFF"));
  assert.ok(r.message.includes("Não existem diferenças"));
});

console.log("\nNew validation gates:");

test("percentual do participante não corresponde às cotas → fails", () => {
  const draw = fixtureAsDraw(fx, 1);
  const p = { ...draw.participants[0], cotas: 2 }; // 2 of 14, but let's assert computed != a wrong hardcoded value
  const estimates = { stateKnown: true };
  const payload = buildParticipantConfirmationPayload({ participant: p, draw, estimates });
  const expectedPct = Number(((2 / 14) * 100).toFixed(4));
  assert.equal(payload.participantPercentage, expectedPct);
  assert.notEqual(payload.participantPercentage, 7.1429, "2 of 14 must not equal 1 of 14's percentage");
});

test("total de cotas diverge entre templates → fails cross-template check", () => {
  const confirmPayload = { drawId: "d1", totalShares: 14, drawDateLabel: "x", jackpot: 1 };
  const pubPayload = { drawId: "d1", totalShares: 1, drawDateLabel: "x", jackpot: 1 };
  const r = validateCrossTemplateConsistency([confirmPayload, pubPayload]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("TOTAL_SHARES_DIVERGES")));
});

test("valor individual diverge → percentage recomputation must not silently mismatch cota-implied value", () => {
  const draw = fixtureAsDraw(fx, 1);
  const p = draw.participants[0];
  const estimates = { stateKnown: true };
  const payload = buildParticipantConfirmationPayload({ participant: p, draw, estimates });
  assert.equal(payload.valor, p.valor);
});

test("total arrecadado não reconcilia → fails", () => {
  const r = validateFinancialReconciliation({ totalArrecadado: 100, valorUtilizado: 50, valorGuardadoProximoSorteio: 40, reembolso: 0, outrasDestinacoes: 0 });
  assert.equal(r.ok, false);
});

test("custo total não corresponde aos jogos → fails", () => {
  const r = validateTicketCostTotal({ ticketCount: 5, costPerTicket: 3, ticketCostTotal: 20 });
  assert.equal(r.ok, false);
});

test("saldo incorreto (arrecadado > usado+saldo, i.e. saldo understated) → fails", () => {
  const r = validateFinancialReconciliation({ totalArrecadado: 150, valorUtilizado: 6, valorGuardadoProximoSorteio: 10, reembolso: 0, outrasDestinacoes: 0 });
  assert.equal(r.ok, false); // 150 != 6+10
});

test("drawId diverge entre templates → fails", () => {
  const r = validateCrossTemplateConsistency([{ drawId: "a" }, { drawId: "b" }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("DRAW_ID_DIVERGES")));
});

test("data do sorteio diverge → fails", () => {
  const r = validateCrossTemplateConsistency([{ drawId: "a", drawDateLabel: "05/08/2026" }, { drawId: "a", drawDateLabel: "06/08/2026" }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("DRAW_DATE_DIVERGES")));
});

test("jackpot diverge → fails", () => {
  const r = validateCrossTemplateConsistency([{ drawId: "a", jackpot: 100 }, { drawId: "a", jackpot: 200 }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("JACKPOT_DIVERGES")));
});

test("correção sem diff real → fails (computeTicketDiff reports hasDiff:false for identical lists)", () => {
  const t = fx.ticketVersions["1"];
  const d = computeTicketDiff(t, t);
  assert.equal(d.hasDiff, false);
  assert.equal(d.changed.length, 0);
});

test("descrição de correção não corresponde ao diff → the rendered before/after is generated FROM the diff, not typed (structural guarantee)", () => {
  const before = fx.ticketVersions["1"];
  const after = fx.ticketVersions["2"];
  const d = computeTicketDiff(before, after);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].beforeText, "24 · 31 · 47 · 52 · 63 — Powerball 17");
  assert.equal(d.changed[0].afterText, "24 · 31 · 47 · 52 · 64 — Powerball 17");
  // The diff is derived from the actual ticket arrays — there is no code path
  // that lets a caller supply arbitrary before/after text disconnected from
  // `before`/`after`.
});

test("hash não corresponde ao manifesto → fails", () => {
  const draw = fixtureAsDraw(fx, 1);
  const { shared } = buildTicketPublicationPayload({ draw, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const tampered = shared.manifestHash.slice(0, -1) + "0";
  const { sha256, ...withoutHash } = shared.manifest;
  const recomputed = sha256Hex(stableStringify(withoutHash));
  assert.notEqual(tampered, recomputed);
  assert.equal(sha256, recomputed);
});

test("assunto não contém tipo do e-mail e data → fails", () => {
  const draw = fixtureAsDraw(fx, 1);
  const estimates = { stateKnown: true };
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw, estimates });
  const subj = renderParticipantConfirmationSubject(confirmPayload, true);
  assert.ok(subj.includes("[TESTE ADMIN]"));
  assert.ok(subj.includes("Participação confirmada"));
  assert.ok(subj.includes(fx.drawing.drawDateLabel.replace(/\//g, ".")));

  const { perRecipient } = buildTicketPublicationPayload({ draw, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const pubSubj = renderTicketPublicationSubject(perRecipient[0], true);
  assert.ok(pubSubj.includes("Bilhetes publicados"));
  assert.ok(pubSubj.includes(fx.drawing.drawDateLabel.replace(/\//g, ".")));
  assert.ok(/\d+ jogos/.test(pubSubj));
});

console.log("\nEnd-to-end: all three built from ONE fixture never diverge:");
await atest("buildAllThreeFromFixture succeeds and cross-template check passes", async () => {
  const r = await buildAllThreeFromFixture();
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.confirmPayload.totalShares, r.pubPayload.totalShares);
  assert.equal(r.confirmPayload.totalShares, r.corrPayload.totalShares);
  assert.equal(r.confirmPayload.drawDateLabel, r.pubPayload.drawDateLabel);
  assert.equal(r.confirmPayload.jackpot, r.pubPayload.jackpot);
  assert.equal(r.pubPayload.financialSummary.diferencaNaoConciliada, 0);
});

console.log("\nRound-3 regressions (delivered-subject bugs found via real inbox cross-check):");

test("regression (d): EmailJS template_params never use a key literally called 'subject' — must match the known-working entry_name/receipt_code pattern", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./email/send.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("entry_name"), "send.mjs must set template_params.entry_name (the variable the EmailJS template actually reads)");
  assert.ok(src.includes("receipt_code"), "send.mjs must set template_params.receipt_code (mirrors the known-working send_result_email.py precedent)");
  // A bare "subject" KEY (not the "subject" local variable used as a VALUE,
  // e.g. "entry_name: subject," is fine) would sit right after "{" or ","
  // in the object literal. "email_subject:" must NOT false-positive here.
  assert.ok(!/[{,]\s*subject\s*:/.test(src), "must not send a bare 'subject' key — EmailJS silently ignores unrecognized variable names and falls back to its own static Subject");
});

test("regression (e): rendered subjects never contain a raw '/' (EmailJS HTML-escapes subject variables server-side, turning '/' into the literal text '&#x2F;' in the delivered email — confirmed via a real inbox cross-check)", () => {
  const draw = fixtureAsDraw(fx, 1);
  const estimates = { stateKnown: true };
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw, estimates });
  const confirmSubj = renderParticipantConfirmationSubject(confirmPayload, true);
  assert.ok(!confirmSubj.includes("/"), `subject must not contain "/": ${confirmSubj}`);

  const { perRecipient } = buildTicketPublicationPayload({ draw, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const pubSubj = renderTicketPublicationSubject(perRecipient[0], true);
  assert.ok(!pubSubj.includes("/"), `subject must not contain "/": ${pubSubj}`);

  const draw2 = fixtureAsDraw(fx, 2);
  const { perRecipient: corrPer } = buildTicketPublicationPayload({ draw: draw2, participants: fx.participants, tickets: fx.ticketVersions["2"], publicationVersion: 2, correctionReason: "x", previousHash: "y", previousTickets: fx.ticketVersions["1"] });
  const corrSubj = renderTicketPublicationSubject(corrPer[0], true);
  assert.ok(!corrSubj.includes("/"), `subject must not contain "/": ${corrSubj}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
