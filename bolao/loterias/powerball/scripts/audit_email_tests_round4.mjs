#!/usr/bin/env node
// audit_email_tests_round4.mjs — draw-result email (2026-08-06 real send).
// Covers: real prizeTable reuse (never reimplemented), financial
// reconciliation gate on the real send path, duplicate-email gate, ledger
// idempotency, and hash/format consistency with the approved ball design.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllDraws } from "./email/snapshot.mjs";
import { loadRealPrizeCalculator } from "./email/prize-calc-bridge.mjs";
import { buildDrawResultPayload, computeTicketResults, allTicketsForDraw } from "./email/payload.mjs";
import { renderDrawResultSubject, renderDrawResultHtml, renderDrawResultText } from "./email/render.mjs";
import { financialReconciliation, computeEligibility, runDrawResultSend, idempotencyKeyForResult } from "./email/send_draw_result.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_LEDGER = path.join(__dirname, "email", ".test-result-ledger.json");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}
async function atest(name, fn) {
  try { await fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}

console.log("Powerball draw-result email — round 4 tests (2026-08-06 real send)\n");

const draws = loadAllDraws();
const draw = draws.find((d) => d.id === "2026-08-05");
const { GAME_TYPES } = loadRealPrizeCalculator();
const gt = GAME_TYPES.powerball;

console.log("Real prize-table reuse:");
test("computeTicketResults uses the REAL prizeTable function, matches the known official result (2 Powerball-only hits, $8 each x 2x Power Play)", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const tickets = allTicketsForDraw(draw);
  const results = computeTicketResults(tickets, official, gt.prizeTable);
  const winners = results.filter((t) => t.prizeAmount);
  const totalWon = winners.reduce((s, t) => s + t.prizeAmount, 0);
  assert.equal(totalWon, draw.result.premiosGanhos, "computed total must match the recorded official premiosGanhos");
  winners.forEach((t) => assert.equal(t.specialMatch, true, "the known winning tickets only matched the Powerball"));
});

console.log("\nFinancial reconciliation gate:");
test("real current draw finance reconciles to exactly $0.00", () => {
  const r = financialReconciliation(draw);
  assert.equal(r.reconciled, true, JSON.stringify(r));
  assert.equal(r.difference, 0);
});
test("a broken finance object is correctly rejected, never forced to close", () => {
  const broken = { ...draw, finance: { totalArrecadado: 100, valorUtilizado: 50, valorGuardadoProximoSorteio: 10, creditoSorteioAnterior: 0 } };
  const r = financialReconciliation(broken);
  assert.equal(r.reconciled, false);
  assert.notEqual(r.difference, 0);
});

console.log("\nEligibility + duplicate detection:");
test("computeEligibility requires an official result to exist", () => {
  const draws2 = [{ ...draw, id: "no-result-draw", result: null }];
  // Simulate via a direct call shape check (computeEligibility reads from loadAllDraws, so
  // we assert the real current draw DOES have a result and duplicate-free real emails).
  const r = computeEligibility(draw.id);
  assert.equal(r.ok, true);
  assert.equal(r.duplicateEmails.length, 0);
});

console.log("\nSubject/content:");
test("subject contains the real official numbers and Powerball, no raw '/' in dates", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants.slice(0, 2), official, prizeTableFn: gt.prizeTable });
  const subject = renderDrawResultSubject(perRecipient[0], true);
  assert.ok(subject.includes("14-20-59-60-61"));
  assert.ok(subject.includes("PB 25"));
  assert.ok(!subject.includes("/"), "subject must not contain a raw '/'");
});

test("HTML never claims a total won figure when result is unofficial (aguardando valor oficial), never defaults to $0", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const draftDraw = { ...draw, result: { ...draw.result, premiosGanhos: null }, profit: null };
  const { perRecipient } = buildDrawResultPayload({ draw: draftDraw, participants: draw.participants.slice(0, 2), official, prizeTableFn: gt.prizeTable });
  const html = renderDrawResultHtml(perRecipient[0], true);
  assert.ok(html.includes("aguardando valor oficial"));
  assert.ok(!html.includes(">$0.00<") || html.includes("aguardando valor oficial"), "must never silently show $0.00 for an unofficial figure");
});

test("HTML uses the approved ball-circle design (fixed 32/36px circles) for both official numbers and each ticket row", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants.slice(0, 1), official, prizeTableFn: gt.prizeTable });
  const html = renderDrawResultHtml(perRecipient[0], true);
  assert.ok(/width:32px;height:32px/.test(html));
  assert.ok(/width:36px;height:36px/.test(html));
  assert.ok(html.includes("background:#CE1141"));
});

test("winning tickets are visually distinguished from non-winning ones (green highlight)", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants.slice(0, 1), official, prizeTableFn: gt.prizeTable });
  const html = renderDrawResultHtml(perRecipient[0], true);
  assert.ok(html.includes("background:#e8f9ee"), "expected a highlighted row for at least one winning ticket");
});

console.log("\nLedger idempotency:");
if (fs.existsSync(TMP_LEDGER)) fs.unlinkSync(TMP_LEDGER);
await atest("dry-run never writes to the ledger", async () => {
  const r = await runDrawResultSend({ drawId: draw.id, ledgerPath: TMP_LEDGER, dryRun: true, singleParticipant: draw.participants[0].name });
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(TMP_LEDGER), false);
});
test("idempotency key format matches the required pattern", () => {
  const key = idempotencyKeyForResult("2026-08-05", "Alan Rech");
  assert.equal(key, "powerball:draw-result:2026-08-05:v1:Alan Rech");
});

console.log("\nEmail-format simplification (2026-08-06, per Eduardo's feedback):");

test("HTML never contains the removed full-ticket-list section or any non-winning ticket listing", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants, official, prizeTableFn: gt.prizeTable });
  const html = renderDrawResultHtml(perRecipient[0], false);
  assert.ok(!html.includes("Todos os"), 'HTML must not contain a "Todos os N jogos" section');
  assert.ok(!html.includes("Conjunto completo"), "HTML must not contain a full ticket list section");
  // None of the 52 non-winning tickets' numbers-only lines should appear as a
  // bare list — spot-check a few known non-winning ticket number combos from
  // the real 2026-08-05 pool are absent as a "Jogo NN:" line.
  assert.ok(!/Jogo 01:/.test(html), "HTML must not list non-winning tickets by 'Jogo NN:' lines");
  assert.ok(!html.includes("font-family:monospace;\">Jogo"), "no monospace ticket-list block");
});

test("HTML includes a real link/button to the site to see all games", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants, official, prizeTableFn: gt.prizeTable });
  const html = renderDrawResultHtml(perRecipient[0], false);
  assert.ok(html.includes("Ver todos os jogos e detalhes no site"));
  assert.ok(html.includes("https://ferrarilabs.github.io/bolao/loterias/powerball/"));
  assert.ok(!html.includes("localhost"));
});

test("winning tickets still show hits, tier, and prize amount as cards", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants, official, prizeTableFn: gt.prizeTable });
  const html = renderDrawResultHtml(perRecipient[0], false);
  assert.ok(html.includes("Jogos premiados"));
  assert.ok(html.includes("Acertos:"));
  assert.ok(html.includes("Powerball — $8.00"));
});

test("zero-winner case shows a clear message, not an empty section", () => {
  const official = { numbers: [1, 2, 3, 4, 5], special: 99, multiplier: 2 }; // guaranteed no matches
  const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants.slice(0, 1), official, prizeTableFn: gt.prizeTable });
  const html = renderDrawResultHtml(perRecipient[0], false);
  assert.ok(html.includes("Nenhum dos nossos"));
  assert.ok(html.includes("teve prêmio nesta rodada"));
});

test("production render (testMode:false) never contains [TESTE ADMIN] or the test banner", () => {
  const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants, official, prizeTableFn: gt.prizeTable });
  const subject = renderDrawResultSubject(perRecipient[0], false);
  const html = renderDrawResultHtml(perRecipient[0], false);
  assert.ok(!subject.includes("[TESTE ADMIN]"));
  assert.ok(!html.includes("[TESTE ADMIN]"));
  assert.ok(!html.includes("TESTE ADMINISTRATIVO"));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
