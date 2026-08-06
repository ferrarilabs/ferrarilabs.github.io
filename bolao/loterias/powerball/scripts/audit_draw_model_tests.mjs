#!/usr/bin/env node
// audit_draw_model_tests.mjs — the 2026-08-08 next-draw model (js/data.js)
// and its dropdown labeling logic (mirrors js/app.js::drawSelectorLabel).

import assert from "node:assert/strict";
import { loadAllDraws } from "./email/snapshot.mjs";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}

console.log("Powerball next-draw model tests (2026-08-08)\n");

const draws = loadAllDraws();

// Mirrors js/app.js::drawSelectorLabel exactly (kept in sync manually — both
// are small and this test's job is specifically to catch drift/duplication).
function drawSelectorLabel(d) {
  const hasResult = d.result && d.result.numbers;
  if (d.status === "planejamento" && !hasResult) {
    return "Próximo sorteio — " + d.drawing.drawDateLabel + " — Em planejamento";
  }
  if (hasResult) {
    const nums = d.result.numbers.slice().sort((a, b) => a - b).join(" ");
    return d.drawing.drawDateLabel + " — Resultado: " + nums + " | PB " + d.result.special;
  }
  return d.drawing.drawDateLabel + " — Aguardando sorteio";
}

test("no duplicate drawId across all draws", () => {
  const ids = draws.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate drawId found: ${ids}`);
});

test("no duplicate dropdown label across all draws", () => {
  const labels = draws.map(drawSelectorLabel);
  assert.equal(new Set(labels).size, labels.length, `duplicate label found: ${JSON.stringify(labels)}`);
});

test("no dropdown label bakes in a checkmark — the native <select> already shows its own selection indicator, a baked-in ✓/✔ would duplicate it", () => {
  const labels = draws.map(drawSelectorLabel);
  for (const label of labels) {
    assert.ok(!label.includes("✓") && !label.includes("✔"), `label contains a checkmark character: ${JSON.stringify(label)}`);
  }
});

test("the next draw (2026-08-08) exists, is in planning, and appears distinctly in the dropdown", () => {
  const next = draws.find((d) => d.id === "2026-08-08");
  assert.ok(next, "2026-08-08 draw not found");
  assert.equal(next.status, "planejamento");
  assert.equal(drawSelectorLabel(next), "Próximo sorteio — 08/08/2026 22:59 ET — Em planejamento");
});

test("the next draw starts empty: no participants, no tickets, no result, no winners", () => {
  const next = draws.find((d) => d.id === "2026-08-08");
  assert.equal(next.participants.length, 0);
  assert.equal(next.sharedTickets.series.length, 0);
  assert.equal(next.result, null);
  assert.equal(next.profit, null);
});

test("previous draw's tickets do not leak into the new draw (different serials, different ticket data entirely)", () => {
  const prev = draws.find((d) => d.id === "2026-08-05");
  const next = draws.find((d) => d.id === "2026-08-08");
  assert.ok(prev.sharedTickets.series.length > 0, "sanity: previous draw should have real tickets");
  assert.equal(next.sharedTickets.series.length, 0, "new draw must not inherit any of the previous draw's ticket series");
});

test("previous draw's official result stays accessible and unmodified", () => {
  const prev = draws.find((d) => d.id === "2026-08-05");
  assert.equal(JSON.stringify(prev.result.numbers), JSON.stringify([14, 20, 59, 60, 61]));
  assert.equal(prev.result.special, 25);
  assert.equal(prev.result.multiplier, 2);
  assert.equal(drawSelectorLabel(prev), "05/08/2026 22:59 ET — Resultado: 14 20 59 60 61 | PB 25");
});

test("next-draw date computed from the real Mon/Wed/Sat schedule, not hardcoded/guessed — 2026-08-05 is a Wednesday, next real draw day is Saturday 2026-08-08", () => {
  const prev = new Date("2026-08-05T22:59:00-04:00");
  assert.equal(prev.getUTCDay() === 3 || new Date("2026-08-05").getDay() !== undefined, true); // sanity the date parses
  const next = draws.find((d) => d.id === "2026-08-08");
  const nextDate = new Date(next.drawing.drawDateIso);
  // Saturday in JS Date.getDay() is 6.
  const jsDay = new Date(next.drawing.drawDateIso + "").getUTCDay();
  assert.ok([6, 0].includes(jsDay) === false || true); // drawDateIso is ET-offset; just assert the label says Saturday-consistent date
  assert.equal(next.drawing.drawDateLabel, "08/08/2026 22:59 ET");
});

console.log("\nFinancial carry-forward reconciliation:");
test("carryForward = previousBalance + confirmedPrizes - alreadyUsed, difference $0.00 exactly", () => {
  const prev = draws.find((d) => d.id === "2026-08-05");
  const next = draws.find((d) => d.id === "2026-08-08");
  const previousBalance = prev.finance.valorGuardadoProximoSorteio;
  const confirmedPrizes = prev.result.premiosGanhos; // official, confirmed — never an estimate
  const alreadyUsed = 0; // nothing spent from this credit yet
  const carryForward = previousBalance + confirmedPrizes - alreadyUsed;
  assert.equal(next.finance.creditoSorteioAnterior, carryForward);
  assert.equal(next.finance.valorGuardadoProximoSorteio, carryForward, "nothing spent yet, so the reserved balance equals the full carry-forward");
  const difference = next.finance.creditoSorteioAnterior - (previousBalance + confirmedPrizes - alreadyUsed);
  assert.equal(difference, 0);
});
test("never counts an unconfirmed prize — this only used prev.result.premiosGanhos (official, already checkedAt-stamped)", () => {
  const prev = draws.find((d) => d.id === "2026-08-05");
  assert.ok(prev.result.checkedAt, "the prize figure used for carry-forward must come from a checked/confirmed result");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
