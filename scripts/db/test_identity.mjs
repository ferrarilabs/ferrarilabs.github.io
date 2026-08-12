#!/usr/bin/env node
/**
 * Tests for the participant identity engine (Workstream C).
 *
 * The central claim under test is a NEGATIVE one: that no path merges identities without an operator
 * decision. Negative claims need adversarial tests — it is not enough to check that a confirmed merge
 * works. So the suite includes a source-level check that no auto-merge entry point exists, and a
 * check that the strongest possible signal (exact email + identical name) still refuses to merge.
 *
 * Fixtures are synthetic: `example.invalid` addresses, `Synthetic *` names.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MATCH_SIGNAL, CONFIDENCE, MERGE_REFUSAL, MERGE_REPOINT_PLAN, MergeRefused,
  findDuplicateCandidates, resolveCanonical, mergeIdentities, reverseMerge,
  repointAfterMerge, identityHistory, findDuplicateCandidatesPairwise,
} from "./identity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const refusal = (fn) => { try { fn(); } catch (e) { if (e instanceof MergeRefused) return e.code; throw e; } throw new Error("expected a MergeRefused, none thrown"); };

const OP = { operatorId: "operator-1", reason: "confirmed by email exchange with both entrants" };
const T0 = "2026-07-01T00:00:00Z", T1 = "2026-07-02T00:00:00Z";

function state() {
  return {
    participants: [
      { participant_id: "p-1", display_name: "Synthetic Alpha", email: "alpha@example.invalid", aliases: [], canonical_participant_id: null, superseded_at: null },
      { participant_id: "p-2", display_name: "synthetic  alpha", email: "ALPHA@example.invalid", aliases: [], canonical_participant_id: null, superseded_at: null },
      { participant_id: "p-3", display_name: "Synthetic Beta", email: "shared@example.invalid", aliases: [], canonical_participant_id: null, superseded_at: null },
      { participant_id: "p-4", display_name: "Synthetic Gamma", email: "shared@example.invalid", aliases: [], canonical_participant_id: null, superseded_at: null },
      { participant_id: "p-5", display_name: "José Synthetic", email: null, aliases: [], canonical_participant_id: null, superseded_at: null },
      { participant_id: "p-6", display_name: "Jose Synthetic", email: null, aliases: [], canonical_participant_id: null, superseded_at: null },
      { participant_id: "p-7", display_name: "Synthetic Delta", email: "delta@example.invalid", aliases: ["Synthetic D."], canonical_participant_id: null, superseded_at: null },
    ],
    participant_identity_links: [],
  };
}

console.log("\nCandidate detection — suggests, never decides\n");

test("a legitimate duplicate candidate is found with both signals", () => {
  const c = findDuplicateCandidates(state().participants).find((x) => x.a === "p-1" && x.b === "p-2");
  assert(c, "p-1/p-2 (same email, same name modulo case and spacing) must be suggested");
  assert(c.signals.includes(MATCH_SIGNAL.EXACT_EMAIL), "exact email signal");
  assert(c.signals.includes(MATCH_SIGNAL.NORMALISED_NAME), "normalised name signal");
  eq(c.confidence, CONFIDENCE.STRONG, "confidence");
});

test("a shared mailbox with different names is the classic FALSE POSITIVE and stays MODERATE", () => {
  const c = findDuplicateCandidates(state().participants).find((x) => x.a === "p-3" && x.b === "p-4");
  assert(c, "a shared address must still be surfaced for review");
  eq(c.confidence, CONFIDENCE.MODERATE,
    "two different names on one mailbox are probably two real people sharing it — this must never reach STRONG");
  assert(!c.signals.includes(MATCH_SIGNAL.NORMALISED_NAME), "the names differ, so no name signal may be claimed");
});

test("accent-folded names are suggested but only WEAK", () => {
  const c = findDuplicateCandidates(state().participants).find((x) => x.a === "p-5" && x.b === "p-6");
  assert(c, "José/Jose must be suggested");
  assert(c.signals.includes(MATCH_SIGNAL.FOLDED_NAME), "folded name signal");
  eq(c.confidence, CONFIDENCE.WEAK, "a name-only match with no email evidence is weak");
});

test("unrelated participants are not suggested at all", () => {
  const cands = findDuplicateCandidates(state().participants);
  assert(!cands.some((c) => [c.a, c.b].includes("p-7")),
    "Synthetic Delta shares nothing with anyone and must not appear — noise makes operators approve blindly");
});

test("name-token permutation is detected (surname/forename order swapped)", () => {
  const s = state();
  s.participants.push({ participant_id: "p-8", display_name: "Alpha Synthetic", email: null, aliases: [], canonical_participant_id: null });
  const c = findDuplicateCandidates(s.participants).find((x) => [x.a, x.b].includes("p-8") && [x.a, x.b].includes("p-1"));
  assert(c?.signals.includes(MATCH_SIGNAL.NAME_TOKEN_PERMUTATION), "reordered name tokens must be suggested");
});

test("historical aliases participate in detection", () => {
  const s = state();
  s.participants.push({ participant_id: "p-9", display_name: "Synthetic D.", email: null, aliases: [], canonical_participant_id: null });
  const c = findDuplicateCandidates(s.participants).find((x) => [x.a, x.b].includes("p-9") && [x.a, x.b].includes("p-7"));
  assert(c, "a match against a stored ALIAS must be suggested, or a resolved person re-appears as new");
});

test("already-merged identities are excluded from detection", () => {
  const merged = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const cands = findDuplicateCandidates(merged.participants);
  assert(!cands.some((c) => [c.a, c.b].includes("p-2")),
    "re-suggesting a pair an operator already resolved trains them to click through the queue");
});

test("SHARED_PAYER never appears alone as a reason to suggest a pair", () => {
  const s = state();
  const entries = [
    { pool_entry_id: "e-1", participant_id: "p-3" },
    { pool_entry_id: "e-2", participant_id: "p-7" },
  ];
  const payments = [
    { payment_id: "pay-1", payer_participant_id: "p-1", asserted_for_pool_entry_id: "e-1" },
    { payment_id: "pay-2", payer_participant_id: "p-1", asserted_for_pool_entry_id: "e-2" },
  ];
  const c = findDuplicateCandidates(s.participants, { entries, payments }).find((x) =>
    [x.a, x.b].sort().join() === ["p-3", "p-7"].sort().join());
  assert(!c, "a parent funding two children must not make the children look like the same person");
});

test("every candidate is explicitly flagged as not auto-mergeable", () => {
  const bad = findDuplicateCandidates(state().participants).filter((c) => c.autoMergeable !== false || c.requiresOperatorConfirmation !== true);
  eq(bad.length, 0, "a candidate must carry its own prohibition, so no caller can claim it did not know");
});

console.log("\nMerge — operator confirmation is structural, not advisory\n");

test("a merge with no confirmation is refused", () => {
  eq(refusal(() => mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", at: T0, linkId: "l-1" })),
    MERGE_REFUSAL.NO_CONFIRMATION, "refusal code");
});

test("a confirmation missing a reason is refused — an unexplained merge cannot be reviewed", () => {
  eq(refusal(() => mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: { operatorId: "operator-1" }, at: T0, linkId: "l-1" })),
    MERGE_REFUSAL.NO_CONFIRMATION, "refusal code");
});

test("the STRONGEST possible signal still does not authorise a merge", () => {
  const s = state();
  const c = findDuplicateCandidates(s.participants).find((x) => x.a === "p-1" && x.b === "p-2");
  eq(c.confidence, CONFIDENCE.STRONG, "precondition: this is the strongest case the engine can produce");
  eq(refusal(() => mergeIdentities(s, { survivingId: c.a, mergedId: c.b, at: T0, linkId: "l-1" })),
    MERGE_REFUSAL.NO_CONFIRMATION,
    "if STRONG confidence could merge itself, the operator gate would be decorative");
});

test("no auto-merge entry point exists in the module source", () => {
  const src = readFileSync(join(HERE, "identity.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const re of [/export function autoMerge/i, /function mergeIfConfident/i, /confidence\s*===\s*CONFIDENCE\.STRONG\s*\)?\s*\{?\s*(return\s+)?mergeIdentities/i]) {
    assert(!re.test(src), `an auto-merge path matching ${re} exists — this is exactly how the control gets bypassed`);
  }
  assert(!/CONFIDENCE\.STRONG/.test(src.split("export function mergeIdentities")[1] || ""),
    "mergeIdentities must not consult confidence at all; its only authority is the operator confirmation");
});

test("a self-merge is refused", () => {
  eq(refusal(() => mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-1", confirmation: OP, at: T0, linkId: "l-1" })),
    MERGE_REFUSAL.SELF_MERGE, "refusal code");
});

test("merging an unknown participant is refused", () => {
  eq(refusal(() => mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-ghost", confirmation: OP, at: T0, linkId: "l-1" })),
    MERGE_REFUSAL.MISSING_PARTICIPANT, "refusal code");
});

test("a confirmed merge supersedes without deleting, and records full provenance", () => {
  const s = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const m = s.participants.find((p) => p.participant_id === "p-2");
  assert(m, "the merged participant row must SURVIVE — deleting it would destroy the history being consolidated");
  eq(m.canonical_participant_id, "p-1", "canonical pointer");
  eq(m.superseded_at, T0, "superseded_at");
  const l = s.participant_identity_links[0];
  eq(l.confirmed_by, "operator-1", "confirmed_by");
  assert(l.reason, "reason recorded");
  assert(l.prior_state && l.prior_state.email, "prior state must be captured or reversal would have to guess");
});

test("the merge is pure — the input state is not mutated", () => {
  const s0 = state();
  const before = JSON.stringify(s0);
  mergeIdentities(s0, { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  eq(JSON.stringify(s0), before, "mergeIdentities mutated its input");
});

test("the survivor gains the merged identity's name as an alias", () => {
  const s = mergeIdentities(state(), { survivingId: "p-7", mergedId: "p-3", confirmation: OP, at: T0, linkId: "l-1" });
  const surv = s.participants.find((p) => p.participant_id === "p-7");
  assert(surv.aliases.some((a) => a.toLowerCase().includes("beta")),
    "without inheriting the alias, the next duplicate scan re-suggests the pair the operator just resolved");
});

test("merging an already-merged identity is refused, not silently re-pointed", () => {
  const s = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  eq(refusal(() => mergeIdentities(s, { survivingId: "p-3", mergedId: "p-2", confirmation: OP, at: T1, linkId: "l-2" })),
    MERGE_REFUSAL.ALREADY_MERGED, "re-merging would overwrite existing provenance");
});

test("merging INTO a superseded identity is refused", () => {
  const s = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  eq(refusal(() => mergeIdentities(s, { survivingId: "p-2", mergedId: "p-3", confirmation: OP, at: T1, linkId: "l-2" })),
    MERGE_REFUSAL.SURVIVOR_IS_SUPERSEDED, "chaining behind a superseded row buries data a hop deeper");
});

test("a merge that would close a cycle is refused", () => {
  // p-2 → p-1 exists. Merging p-1 into p-2 would make the chain circular.
  const s = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const code = refusal(() => mergeIdentities(s, { survivingId: "p-2", mergedId: "p-1", confirmation: OP, at: T1, linkId: "l-2" }));
  assert([MERGE_REFUSAL.WOULD_CREATE_CYCLE, MERGE_REFUSAL.SURVIVOR_IS_SUPERSEDED].includes(code),
    `a cycle-closing merge must be refused, got ${code}`);
});

console.log("\nCanonical resolution\n");

test("resolution returns the surviving identity and hop count", () => {
  const s = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const r = resolveCanonical(s.participants, "p-2");
  eq(r.participant_id, "p-1", "canonical");
  eq(r.hops, 1, "hops");
});

test("an active identity resolves to itself in zero hops", () => {
  eq(resolveCanonical(state().participants, "p-1").hops, 0, "hops");
});

test("resolution throws on a corrupt cycle instead of looping forever", () => {
  const s = state();
  s.participants.find((p) => p.participant_id === "p-1").canonical_participant_id = "p-2";
  s.participants.find((p) => p.participant_id === "p-2").canonical_participant_id = "p-1";
  let msg = "";
  try { resolveCanonical(s.participants, "p-1"); } catch (e) { msg = e.message; }
  assert(/cycle/i.test(msg), "a cycle must be reported, never hung on — a hang here would stall every report");
});

console.log("\nReversal\n");

test("a reversal restores the prior state exactly and keeps the link as history", () => {
  const merged = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const back = reverseMerge(merged, { linkId: "l-1", confirmation: { operatorId: "operator-2", reason: "the entrants confirmed they are two people" }, at: T1 });
  const p2 = back.participants.find((p) => p.participant_id === "p-2");
  eq(p2.canonical_participant_id, null, "pointer cleared");
  eq(p2.superseded_at, null, "superseded_at cleared");
  eq(p2.email, "ALPHA@example.invalid", "the original email must be restored verbatim, not normalised");
  const p1 = back.participants.find((p) => p.participant_id === "p-1");
  eq(JSON.stringify(p1.aliases), JSON.stringify([]), "the survivor's alias set must return to what it was");
  const l = back.participant_identity_links.find((x) => x.link_id === "l-1");
  assert(l, "the link row must be RETAINED — that a merge happened and was undone is itself history");
  eq(l.reversed_at, T1, "reversed_at");
  eq(l.reversed_by, "operator-2", "reversed_by");
});

test("a reversal also requires operator confirmation", () => {
  const merged = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  eq(refusal(() => reverseMerge(merged, { linkId: "l-1", at: T1 })), MERGE_REFUSAL.NO_CONFIRMATION, "refusal code");
});

test("reversing twice is refused", () => {
  const merged = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const back = reverseMerge(merged, { linkId: "l-1", confirmation: OP, at: T1 });
  eq(refusal(() => reverseMerge(back, { linkId: "l-1", confirmation: OP, at: T1 })), MERGE_REFUSAL.ALREADY_MERGED, "refusal code");
});

test("after reversal the pair becomes a candidate again", () => {
  const merged = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const back = reverseMerge(merged, { linkId: "l-1", confirmation: OP, at: T1 });
  assert(findDuplicateCandidates(back.participants).some((c) => c.a === "p-1" && c.b === "p-2"),
    "a reversed merge must return the pair to the review queue, not hide it forever");
});

test("a merge can be re-applied after reversal", () => {
  const merged = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const back = reverseMerge(merged, { linkId: "l-1", confirmation: OP, at: T1 });
  const again = mergeIdentities(back, { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: "2026-07-03T00:00:00Z", linkId: "l-2" });
  eq(again.participant_identity_links.length, 2, "both the reversed and the new link must be present");
});

console.log("\nRe-pointing and payer-vs-owner\n");

test("entries, payments and prizes follow the surviving identity", () => {
  const d = repointAfterMerge({
    pool_entries: [{ pool_entry_id: "e-1", participant_id: "p-2" }],
    payments: [{ payment_id: "pay-1", payer_participant_id: "p-2" }],
    prize_allocations: [{ prize_allocation_id: "z-1", participant_id: "p-2" }],
  }, { survivingId: "p-1", mergedId: "p-2" });
  eq(d.pool_entries[0].participant_id, "p-1", "entry");
  eq(d.payments[0].payer_participant_id, "p-1", "payment");
  eq(d.prize_allocations[0].participant_id, "p-1", "prize");
});

test("published ranking snapshots and audit events are deliberately NOT re-pointed", () => {
  const d = repointAfterMerge({
    ranking_snapshots: [{ ranking_snapshot_id: "rs-1", participant_id: "p-2" }],
    audit_events: [{ audit_event_id: "a-1", actor_participant_id: "p-2" }],
  }, { survivingId: "p-1", mergedId: "p-2" });
  eq(d.ranking_snapshots[0].participant_id, "p-2",
    "a snapshot records a standing as PUBLISHED; re-pointing it would retroactively rewrite history");
  eq(d.audit_events[0].actor_participant_id, "p-2", "audit rows are immutable");
});

test("payer identity and entry owner stay independent through a merge", () => {
  // Third-party payer p-1 funds p-3's entry; merging p-3 into p-7 must not move the payer.
  const d = repointAfterMerge({
    pool_entries: [{ pool_entry_id: "e-1", participant_id: "p-3" }],
    payments: [{ payment_id: "pay-1", payer_participant_id: "p-1", asserted_for_pool_entry_id: "e-1" }],
  }, { survivingId: "p-7", mergedId: "p-3" });
  eq(d.pool_entries[0].participant_id, "p-7", "the entry follows the merged owner");
  eq(d.payments[0].payer_participant_id, "p-1", "the payer is a different person and must be untouched");
});

test("every re-point rule states an action and a reason", () => {
  const bad = MERGE_REPOINT_PLAN.filter((r) => !["REPOINT", "LEAVE"].includes(r.action) || !r.why);
  eq(bad.length, 0, "a table left out of the plan by accident is a silent data defect");
});

console.log("\nIdentity audit history\n");

test("history lists merges in order with roles and status", () => {
  let s = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  s = mergeIdentities(s, { survivingId: "p-1", mergedId: "p-5", confirmation: OP, at: T1, linkId: "l-2" });
  s = reverseMerge(s, { linkId: "l-1", confirmation: OP, at: "2026-07-03T00:00:00Z" });
  const h = identityHistory(s, "p-1");
  eq(h.length, 2, "both merges");
  eq(h[0].link_id, "l-1", "chronological order");
  eq(h[0].role, "SURVIVOR", "role");
  eq(h[0].status, "REVERSED", "reversed status is visible in history");
  eq(h[1].status, "ACTIVE", "the second merge is still active");
});

test("history from the merged side reports the counterparty", () => {
  const s = mergeIdentities(state(), { survivingId: "p-1", mergedId: "p-2", confirmation: OP, at: T0, linkId: "l-1" });
  const h = identityHistory(s, "p-2");
  eq(h[0].role, "MERGED", "role");
  eq(h[0].counterparty, "p-1", "counterparty");
});

console.log("\nBlocking optimisation must be EXACTLY equal to the pairwise oracle\n");

const sameRelation = (list) => JSON.stringify(list.map((c) => ({ a: c.a, b: c.b, signals: [...c.signals].sort() })));

test("blocked and pairwise agree on the committed fixture", () => {
  // Compares the RELATION (pairs + signal sets). The blocked version additionally carries confidence and
  // the auto-merge prohibition, which the oracle deliberately does not compute.
  eq(sameRelation(findDuplicateCandidates(state().participants)),
     sameRelation(findDuplicateCandidatesPairwise(state().participants)),
     "the optimisation must compute the same relation, not an approximation of it");
});

test("blocked and pairwise agree across many randomised populations", () => {
  // A shared-key-heavy population, which is where the two implementations could most plausibly diverge.
  const mk = (seed) => {
    let x = seed;
    const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const names = ["Synthetic Alpha", "synthetic  alpha", "José Synthetic", "Jose Synthetic",
                   "Alpha Synthetic", "Synthetic Beta", "Synthetic Delta"];
    const emails = [null, "a@example.invalid", "A@EXAMPLE.INVALID", "shared@example.invalid"];
    const out = [];
    const n = 8 + Math.floor(rnd() * 25);
    for (let i = 0; i < n; i++) {
      out.push({
        participant_id: `p-${i}`,
        display_name: names[Math.floor(rnd() * names.length)],
        email: emails[Math.floor(rnd() * emails.length)],
        aliases: rnd() > 0.7 ? [names[Math.floor(rnd() * names.length)]] : [],
        canonical_participant_id: rnd() > 0.9 ? "p-0" : null,
      });
    }
    return out;
  };
  for (let seed = 1; seed <= 60; seed++) {
    const pop = mk(seed);
    const a = findDuplicateCandidates(pop);
    const b = findDuplicateCandidatesPairwise(pop);
    // Compare pair sets and signal sets; signal ORDER may differ because discovery order differs.
    const normalise = (list) => JSON.stringify(list.map((c) => ({ a: c.a, b: c.b, signals: [...c.signals].sort() })));
    eq(normalise(a), normalise(b), `seed ${seed}: blocked and pairwise disagree`);
  }
});

test("confidence is unchanged by the optimisation", () => {
  for (const c of findDuplicateCandidates(state().participants)) {
    const o = findDuplicateCandidatesPairwise(state().participants).find((x) => x.a === c.a && x.b === c.b);
    assert(o, "pair missing from oracle");
    // The oracle has no confidence assigned, so recompute the property that matters: signal equality.
    eq(JSON.stringify([...c.signals].sort()), JSON.stringify([...o.signals].sort()), `${c.a}/${c.b} signals`);
  }
});

test("a pair identical on the normalised name reports ONE name signal, not three", () => {
  const pop = [
    { participant_id: "p-1", display_name: "Synthetic Alpha", email: null, aliases: [], canonical_participant_id: null },
    { participant_id: "p-2", display_name: "synthetic  alpha", email: null, aliases: [], canonical_participant_id: null },
  ];
  const c = findDuplicateCandidates(pop)[0];
  const nameSignals = c.signals.filter((s) => s !== MATCH_SIGNAL.EXACT_EMAIL);
  eq(nameSignals.length, 1, "reporting folded-name and token-permutation as well would inflate confidence for one similarity");
  eq(nameSignals[0], MATCH_SIGNAL.NORMALISED_NAME, "the strongest name signal wins");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ IDENTITY TESTS PASSED\n" : "✗ IDENTITY TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
