// fixture.mjs — loads the single shared test fixture ALL THREE templates must
// consume, and validates its internal consistency before anything is allowed
// to render from it. This directly addresses round-1's root cause: templates
// were reading different, non-reconciling snapshots of "the same" draw.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_PATH = path.join(__dirname, "fixtures", "powerball-email-test-fixture.json");

export function loadFixture(fixturePath) {
  const raw = fs.readFileSync(fixturePath || DEFAULT_FIXTURE_PATH, "utf8");
  return JSON.parse(raw);
}

/**
 * Validates the fixture as a whole (not participant/publication specific).
 * Returns { ok, errors }. Every field checked here is the exact class of bug
 * found in round 1's rejected test emails.
 */
export function validateFixtureConsistency(fx) {
  const errors = [];
  if (!fx.poolId) errors.push("FIXTURE_MISSING_POOL_ID");
  if (!fx.drawId) errors.push("FIXTURE_MISSING_DRAW_ID");
  if (!fx.drawing || !fx.drawing.drawDateIso || !fx.drawing.drawDateLabel) errors.push("FIXTURE_MISSING_DRAW_DATE");
  if (!fx.drawing || typeof fx.drawing.jackpot !== "number") errors.push("FIXTURE_MISSING_JACKPOT");

  const totalShares = fx.totalShares;
  const sumShares = (fx.participants || []).reduce((s, p) => s + (p.cotas || 0), 0);
  if (totalShares !== sumShares) errors.push(`FIXTURE_TOTAL_SHARES_MISMATCH (declared ${totalShares}, sum of participants ${sumShares})`);
  (fx.participants || []).forEach((p) => {
    if (p.cotas > totalShares) errors.push(`FIXTURE_PARTICIPANT_SHARES_EXCEED_TOTAL (${p.name})`);
  });

  const f = fx.finance || {};
  const reconciled = (f.valorUtilizado || 0) + (f.valorGuardadoProximoSorteio || 0) + (f.reembolso || 0) + (f.outrasDestinacoes || 0);
  if (f.totalArrecadado !== reconciled) {
    errors.push(`FIXTURE_FINANCE_NOT_RECONCILED (totalArrecadado ${f.totalArrecadado} !== valorUtilizado+saldo+reembolso+outras ${reconciled})`);
  }

  Object.entries(fx.ticketVersions || {}).forEach(([version, tickets]) => {
    const declaredCostTotal = tickets.length * (fx.sharedTickets ? fx.sharedTickets.costPerTicket : 0);
    // Only versions whose ticket count matches the finance-implied count are checked
    // against valorUtilizado; the fixture's "current" version is the highest key.
    if (Number(version) === Math.max(...Object.keys(fx.ticketVersions).map(Number))) {
      if (declaredCostTotal !== f.valorUtilizado) {
        errors.push(`FIXTURE_TICKET_COST_MISMATCH (v${version}: ${tickets.length} tickets × ${fx.sharedTickets.costPerTicket} = ${declaredCostTotal}, but valorUtilizado is ${f.valorUtilizado})`);
      }
    }
    tickets.forEach((t, i) => {
      if (!t.numbers || t.numbers.length !== 5 || t.special == null) errors.push(`FIXTURE_INVALID_TICKET (v${version} #${i + 1})`);
    });
  });

  return { ok: errors.length === 0, errors };
}

/** Draw-shaped view of the fixture for a given ticket version, compatible with payload.mjs builders. */
export function fixtureAsDraw(fx, version) {
  const v = String(version);
  return {
    id: fx.drawId,
    gameType: fx.gameType,
    drawing: fx.drawing,
    participants: fx.participants,
    finance: fx.finance,
    sharedTickets: fx.sharedTickets,
    __tickets: fx.ticketVersions[v],
  };
}
