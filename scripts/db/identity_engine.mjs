#!/usr/bin/env node
/**
 * WS8 — participant identity engine: CANDIDATE-ONLY resolution.
 *
 * Builds on scripts/db/identity.mjs (signals, merge, reverseMerge) and adds the three things WS8
 * requires that it did not have: confidence BANDS with risk flags, non-mutating reversible MERGE
 * PLANS, and a red-team suite.
 *
 * THE ONE RULE: nothing here ever merges anything. Every output is a proposal that requires an
 * operator confirmation string. `proposeMerge` returns a plan; executing it is a separate call into
 * identity.mjs's `mergeIdentities`, which refuses without confirmation.
 *
 * Why no numeric score: a score invites a threshold, a threshold invites `if (score > 0.9) merge()`,
 * and that line is how two real people become one. Bands are ordinal labels, so automating on one
 * requires naming it in a diff where a reviewer can see it.
 */

import {
  MATCH_SIGNAL, CONFIDENCE, findDuplicateCandidates, resolveCanonical,
} from "./identity.mjs";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS8.1 — input signals
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Signals this engine adds on top of identity.mjs's five.
 *
 * HASHED_EMAIL exists so an email can be compared without being stored or logged in the clear: the
 * engine receives a hash the caller computed. It is deliberately treated as EXACT_EMAIL-strength
 * only when the caller declares the hash is salted per-deployment — an unsalted hash of a
 * low-entropy value is reversible by dictionary, so it would be a PII store wearing a disguise.
 */
export const EXTRA_SIGNAL = {
  HASHED_EMAIL: "HASHED_EMAIL",
  ALIAS_HISTORY: "ALIAS_HISTORY",
  SHARED_PARTICIPATION_HISTORY: "SHARED_PARTICIPATION_HISTORY",
  AUTH_LINKAGE: "AUTH_LINKAGE",
  PRIOR_MANUAL_MERGE: "PRIOR_MANUAL_MERGE",
};

export const ALL_SIGNALS = { ...MATCH_SIGNAL, ...EXTRA_SIGNAL };

/**
 * Signal strength. Nothing is SUFFICIENT — that is the point, and the test suite asserts it for
 * every signal so a future edit that promotes one is caught.
 *
 *   DISCRIMINATING — narrows strongly, still needs a second signal
 *   SUPPORTING     — corroborates a discriminating signal
 *   CONTEXTUAL     — never evidence of sameness on its own; often evidence of the OPPOSITE
 */
export const STRENGTH = { DISCRIMINATING: "DISCRIMINATING", SUPPORTING: "SUPPORTING", CONTEXTUAL: "CONTEXTUAL" };

export const SIGNAL_STRENGTH = Object.freeze({
  [ALL_SIGNALS.EXACT_EMAIL]: STRENGTH.DISCRIMINATING,
  [ALL_SIGNALS.HASHED_EMAIL]: STRENGTH.DISCRIMINATING,
  [ALL_SIGNALS.AUTH_LINKAGE]: STRENGTH.DISCRIMINATING,
  [ALL_SIGNALS.PRIOR_MANUAL_MERGE]: STRENGTH.DISCRIMINATING,
  [ALL_SIGNALS.ALIAS_HISTORY]: STRENGTH.SUPPORTING,
  [ALL_SIGNALS.NORMALISED_NAME]: STRENGTH.SUPPORTING,
  [ALL_SIGNALS.FOLDED_NAME]: STRENGTH.SUPPORTING,
  [ALL_SIGNALS.NAME_TOKEN_PERMUTATION]: STRENGTH.SUPPORTING,
  [ALL_SIGNALS.SHARED_PARTICIPATION_HISTORY]: STRENGTH.CONTEXTUAL,
  [ALL_SIGNALS.SHARED_PAYER]: STRENGTH.CONTEXTUAL,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS8.2 — bands and risk flags
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const BAND = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  MANUAL_REVIEW_REQUIRED: "MANUAL_REVIEW_REQUIRED",
};

/**
 * Risk flags. Each one is a concrete reason this pair might be two different people, and any of them
 * forces MANUAL_REVIEW_REQUIRED regardless of how strong the positive evidence looks.
 */
export const RISK = {
  DISTINCT_EMAILS: "DISTINCT_EMAILS",
  PAYER_NOT_PARTICIPANT: "PAYER_NOT_PARTICIPANT",
  SHARED_HOUSEHOLD_PATTERN: "SHARED_HOUSEHOLD_PATTERN",
  SAME_POOL_BOTH_ACTIVE: "SAME_POOL_BOTH_ACTIVE",
  FINANCIAL_HISTORY_BOTH_SIDES: "FINANCIAL_HISTORY_BOTH_SIDES",
  PRIZE_HISTORY_BOTH_SIDES: "PRIZE_HISTORY_BOTH_SIDES",
  ALIAS_COLLISION: "ALIAS_COLLISION",
  PREVIOUSLY_REVERSED: "PREVIOUSLY_REVERSED",
  ALREADY_MERGED: "ALREADY_MERGED",
  MERGE_WOULD_CYCLE: "MERGE_WOULD_CYCLE",
  MULTI_IDENTITY_AUTH_USER: "MULTI_IDENTITY_AUTH_USER",
};

const RISK_WHY = Object.freeze({
  [RISK.DISTINCT_EMAILS]: "both sides have a verified email and the two differ — the single most reliable evidence that these are two people",
  [RISK.PAYER_NOT_PARTICIPANT]: "the link between them is a payment, and paying for someone is the opposite of being them",
  [RISK.SHARED_HOUSEHOLD_PATTERN]: "a shared surname plus a shared payer is the signature of a family, not a duplicate",
  [RISK.SAME_POOL_BOTH_ACTIVE]: "both hold an active entry in the same pool; merging would collapse two competitors into one and change a ranking",
  [RISK.FINANCIAL_HISTORY_BOTH_SIDES]: "both sides have payment history, so a wrong merge misattributes money that a participant can see in their bank statement",
  [RISK.PRIZE_HISTORY_BOTH_SIDES]: "both sides have won a prize; merging changes who was paid what",
  [RISK.ALIAS_COLLISION]: "the matching alias is one that more than one participant has used, so it identifies nobody",
  [RISK.PREVIOUSLY_REVERSED]: "this exact pair was merged before and an operator reversed it — the reversal is a decision, not noise",
  [RISK.ALREADY_MERGED]: "one side is already merged into another identity; propose against the canonical instead",
  [RISK.MERGE_WOULD_CYCLE]: "the merge would make an identity chain point back into itself",
  [RISK.MULTI_IDENTITY_AUTH_USER]: "one auth user is linked to both, which is EXPECTED and permitted — it is not evidence of sameness (WS12-OP-2)",
});

export function riskReason(flag) { return RISK_WHY[flag] || null; }

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Candidate generation
// ─────────────────────────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const surname = (name) => { const t = norm(name).split(" "); return t.length > 1 ? t[t.length - 1] : null; };
const pairKey = (a, b) => [a, b].sort().join("|");

/**
 * Analyse a dataset and return candidate pairs with evidence, a band and risk flags.
 *
 * `dataset` holds: participants, entries, payments, allocations, prizes, aliases, authLinks,
 * mergeHistory (including reversals), and optional emailHashes.
 *
 * Never mutates. Never merges. Returns proposals only.
 */
export function analyseIdentities(dataset = {}) {
  const {
    participants = [], entries = [], payments = [], allocations = [], prizes = [],
    aliases = [], authLinks = [], mergeHistory = [], emailHashes = [], emailHashSalted = false,
  } = dataset;

  const byId = new Map(participants.map((p) => [p.participant_id, p]));
  const base = findDuplicateCandidates(participants, { entries, payments });
  const candidates = new Map();

  const upsert = (a, b, signal, detail) => {
    if (a === b) return;
    const k = pairKey(a, b);
    if (!candidates.has(k)) candidates.set(k, { a: [a, b].sort()[0], b: [a, b].sort()[1], signals: [], evidence: [] });
    const c = candidates.get(k);
    if (!c.signals.includes(signal)) c.signals.push(signal);
    if (detail) c.evidence.push({ signal, detail });
  };

  // Signals already computed by identity.mjs
  for (const cand of base) {
    for (const s of cand.signals || []) upsert(cand.a ?? cand.participantA, cand.b ?? cand.participantB, s, null);
  }

  // HASHED_EMAIL — equal hashes across two identities
  const hashGroups = new Map();
  for (const h of emailHashes) {
    if (!h.hash) continue;
    if (!hashGroups.has(h.hash)) hashGroups.set(h.hash, []);
    hashGroups.get(h.hash).push(h.participant_id);
  }
  for (const [, ids] of hashGroups) {
    for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) {
      upsert(ids[i], ids[k], ALL_SIGNALS.HASHED_EMAIL, { salted: emailHashSalted });
    }
  }

  // ALIAS_HISTORY — a name one identity used matches another's current or historical name.
  // An alias used by MORE THAN ONE participant identifies nobody; it becomes a risk, not evidence.
  const aliasOwners = new Map();
  for (const al of aliases) {
    const key = norm(al.alias);
    if (!key) continue;
    if (!aliasOwners.has(key)) aliasOwners.set(key, new Set());
    aliasOwners.get(key).add(al.participant_id);
  }
  const collidingAliases = new Set([...aliasOwners.entries()].filter(([, s]) => s.size > 2).map(([k]) => k));
  for (const [alias, owners] of aliasOwners) {
    const ids = [...owners];
    for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) {
      upsert(ids[i], ids[k], ALL_SIGNALS.ALIAS_HISTORY, { collides: collidingAliases.has(alias) });
    }
  }
  for (const p of participants) {
    const n = norm(p.display_name);
    if (aliasOwners.has(n)) for (const other of aliasOwners.get(n)) upsert(p.participant_id, other, ALL_SIGNALS.ALIAS_HISTORY, null);
  }

  // AUTH_LINKAGE — the same auth user linked to both. Per WS12-OP-2 this is EXPECTED and permitted,
  // so it is reported as a signal AND raises a risk flag saying it is not evidence of sameness.
  const authGroups = new Map();
  for (const l of authLinks) {
    if (!authGroups.has(l.auth_user_id)) authGroups.set(l.auth_user_id, []);
    authGroups.get(l.auth_user_id).push(l.participant_id);
  }
  for (const [, ids] of authGroups) {
    for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) {
      upsert(ids[i], ids[k], ALL_SIGNALS.AUTH_LINKAGE, null);
    }
  }

  // PRIOR_MANUAL_MERGE — an operator already merged this pair once (and it may since be reversed)
  for (const m of mergeHistory) {
    upsert(m.surviving_participant_id, m.merged_participant_id, ALL_SIGNALS.PRIOR_MANUAL_MERGE,
      { reversed: !!m.reversed_at });
  }

  // SHARED_PARTICIPATION_HISTORY — appeared in the same editions. CONTEXTUAL: a pool is a group of
  // friends, so "they play the same pools" describes everyone in it.
  const editionsOf = new Map();
  for (const e of entries) {
    if (!editionsOf.has(e.participant_id)) editionsOf.set(e.participant_id, new Set());
    editionsOf.get(e.participant_id).add(e.pool_id);
  }
  for (const c of candidates.values()) {
    const ea = editionsOf.get(c.a) || new Set(), eb = editionsOf.get(c.b) || new Set();
    const shared = [...ea].filter((x) => eb.has(x));
    if (shared.length) upsert(c.a, c.b, ALL_SIGNALS.SHARED_PARTICIPATION_HISTORY, { pools: shared.length });
  }

  // ── Band + risk assignment
  const out = [];
  for (const c of candidates.values()) {
    const pa = byId.get(c.a), pb = byId.get(c.b);
    if (!pa || !pb) continue;
    const risks = [];

    const emailA = norm(pa.email), emailB = norm(pb.email);
    if (emailA && emailB && emailA !== emailB) risks.push(RISK.DISTINCT_EMAILS);
    if (pa.canonical_participant_id || pb.canonical_participant_id) risks.push(RISK.ALREADY_MERGED);

    const payerLink = payments.some((p) =>
      (p.payer_participant_id === c.a && allocations.some((al) => al.payment_id === p.payment_id &&
        entries.some((e) => e.pool_entry_id === al.pool_entry_id && e.participant_id === c.b))) ||
      (p.payer_participant_id === c.b && allocations.some((al) => al.payment_id === p.payment_id &&
        entries.some((e) => e.pool_entry_id === al.pool_entry_id && e.participant_id === c.a))));
    if (payerLink) risks.push(RISK.PAYER_NOT_PARTICIPANT);

    const sa = surname(pa.display_name), sb = surname(pb.display_name);
    if (sa && sa === sb && c.signals.includes(ALL_SIGNALS.SHARED_PAYER)) risks.push(RISK.SHARED_HOUSEHOLD_PATTERN);

    const poolsA = new Set(entries.filter((e) => e.participant_id === c.a).map((e) => e.pool_id));
    const bothActive = entries.some((e) => e.participant_id === c.b && poolsA.has(e.pool_id));
    if (bothActive) risks.push(RISK.SAME_POOL_BOTH_ACTIVE);

    const hasMoney = (id) => payments.some((p) => p.payer_participant_id === id) ||
      allocations.some((al) => entries.some((e) => e.pool_entry_id === al.pool_entry_id && e.participant_id === id));
    if (hasMoney(c.a) && hasMoney(c.b)) risks.push(RISK.FINANCIAL_HISTORY_BOTH_SIDES);

    const hasPrize = (id) => prizes.some((z) => z.participant_id === id ||
      entries.some((e) => e.pool_entry_id === z.pool_entry_id && e.participant_id === id));
    if (hasPrize(c.a) && hasPrize(c.b)) risks.push(RISK.PRIZE_HISTORY_BOTH_SIDES);

    if (c.evidence.some((e) => e.signal === ALL_SIGNALS.ALIAS_HISTORY && e.detail?.collides)) risks.push(RISK.ALIAS_COLLISION);
    if (c.evidence.some((e) => e.signal === ALL_SIGNALS.PRIOR_MANUAL_MERGE && e.detail?.reversed)) risks.push(RISK.PREVIOUSLY_REVERSED);
    if (c.signals.includes(ALL_SIGNALS.AUTH_LINKAGE)) risks.push(RISK.MULTI_IDENTITY_AUTH_USER);

    // An unsalted hash match is not a discriminating signal — it is a reversible digest of a
    // low-entropy value, so it is demoted rather than trusted.
    const hashUnsalted = c.evidence.some((e) => e.signal === ALL_SIGNALS.HASHED_EMAIL && e.detail?.salted === false);

    // An unsalted hash is DEMOTED to supporting, not discarded. It is still evidence — two identities
    // whose email digests agree really do share an address — it is just weak evidence, because an
    // unsalted digest of a low-entropy value is recoverable by dictionary and so tells an attacker
    // as much as it tells us. Deleting the signal would lose real information; trusting it at full
    // strength would let a weak match reach HIGH.
    const strengths = c.signals.map((s) => (hashUnsalted && s === ALL_SIGNALS.HASHED_EMAIL)
      ? STRENGTH.SUPPORTING : SIGNAL_STRENGTH[s]).filter(Boolean);
    const discriminating = strengths.filter((s) => s === STRENGTH.DISCRIMINATING).length;
    const supporting = strengths.filter((s) => s === STRENGTH.SUPPORTING).length;

    // AUTH_LINKAGE is discriminating for "the same human controls both", which is NOT the same claim
    // as "these are one participant". WS12-OP-2 says one auth user may legitimately hold several
    // identities, so it must not by itself drive a merge proposal.
    const authOnly = c.signals.filter((s) => SIGNAL_STRENGTH[s] === STRENGTH.DISCRIMINATING)
      .every((s) => s === ALL_SIGNALS.AUTH_LINKAGE);

    let band;
    if (risks.length > 0) band = BAND.MANUAL_REVIEW_REQUIRED;
    else if (discriminating >= 1 && supporting >= 1 && !authOnly) band = BAND.HIGH;
    else if (discriminating >= 1 && !authOnly) band = BAND.MEDIUM;
    else if (supporting >= 2) band = BAND.MEDIUM;
    else band = BAND.LOW;

    out.push({
      a: c.a, b: c.b, signals: [...c.signals].sort(), evidence: c.evidence,
      band, risks: [...new Set(risks)].sort(),
      riskReasons: [...new Set(risks)].sort().map((r) => ({ flag: r, why: RISK_WHY[r] })),
      autoMergeable: false, // invariant, asserted by the suite for every candidate ever produced
      requiresOperatorConfirmation: true,
    });
  }
  return out.sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS8.4 — merge plans
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Records a merge REPOINTS versus records it deliberately LEAVES ALONE.
 *
 * The distinction is the whole reason a merge is reversible. Repointing an ownership pointer is
 * undoable because the old value is recorded in the link. REWRITING a historical fact is not: a
 * payment that says "Bruno paid" is what happened, and editing it to say "Ana paid" destroys the
 * evidence needed to undo the edit.
 */
export const PLAN_REPOINT = Object.freeze([
  { table: "pool_entries", column: "participant_id", why: "ownership of an entry moves to the canonical identity" },
  { table: "participant_identity_links", column: "canonical_participant_id", why: "the link chain is re-anchored" },
]);

export const PLAN_NEVER_REWRITE = Object.freeze([
  { table: "payments", column: "payer_participant_id", why: "who actually sent the money is a historical fact; the merge records the identity relationship instead, so attribution is resolved at READ time through the link" },
  { table: "payment_allocations", column: "*", why: "an allocation binds a specific payment to a specific entry; neither side changes because two identities turned out to be one" },
  { table: "prize_allocations", column: "*", why: "who was paid what already happened" },
  { table: "predictions", column: "*", why: "attached to an entry, which is repointed; the prediction itself is untouched" },
  { table: "audit_events", column: "*", why: "append-only and hash-chained; rewriting one breaks the chain and destroys the record of the merge itself" },
  { table: "match_results", column: "*", why: "unrelated to identity" },
]);

export const PLAN_REFUSAL = {
  SAME_IDENTITY: "SAME_IDENTITY",
  UNKNOWN_PARTICIPANT: "UNKNOWN_PARTICIPANT",
  SOURCE_ALREADY_MERGED: "SOURCE_ALREADY_MERGED",
  TARGET_NOT_CANONICAL: "TARGET_NOT_CANONICAL",
  WOULD_CYCLE: "WOULD_CYCLE",
  BOTH_ACTIVE_IN_POOL: "BOTH_ACTIVE_IN_POOL",
  PAYER_RELATIONSHIP: "PAYER_RELATIONSHIP",
};

/**
 * Produce a reversible merge plan. Does not mutate. Does not merge. Returns
 * `{ ok:false, refusals:[...] }` when the merge must not be proposed at all.
 */
export function proposeMerge(dataset, { sourceId, targetId, band = null, evidence = [] }) {
  const { participants = [], entries = [], payments = [], allocations = [], prizes = [],
    predictions = [], mergeHistory = [] } = dataset;
  const byId = new Map(participants.map((p) => [p.participant_id, p]));
  const refusals = [];

  if (sourceId === targetId) refusals.push(PLAN_REFUSAL.SAME_IDENTITY);
  if (!byId.has(sourceId) || !byId.has(targetId)) refusals.push(PLAN_REFUSAL.UNKNOWN_PARTICIPANT);

  const src = byId.get(sourceId), tgt = byId.get(targetId);
  if (src?.canonical_participant_id) refusals.push(PLAN_REFUSAL.SOURCE_ALREADY_MERGED);
  if (tgt?.canonical_participant_id) refusals.push(PLAN_REFUSAL.TARGET_NOT_CANONICAL);

  // A cycle: the target already resolves (transitively) to the source.
  if (byId.has(sourceId) && byId.has(targetId)) {
    try { if (resolveCanonical(participants, targetId) === sourceId) refusals.push(PLAN_REFUSAL.WOULD_CYCLE); }
    catch { refusals.push(PLAN_REFUSAL.WOULD_CYCLE); }
  }

  const poolsSrc = new Set(entries.filter((e) => e.participant_id === sourceId).map((e) => e.pool_id));
  const clash = entries.filter((e) => e.participant_id === targetId && poolsSrc.has(e.pool_id));
  if (clash.length) refusals.push(PLAN_REFUSAL.BOTH_ACTIVE_IN_POOL);

  const payerRel = payments.some((p) =>
    (p.payer_participant_id === sourceId || p.payer_participant_id === targetId) &&
    allocations.some((al) => al.payment_id === p.payment_id && entries.some((e) =>
      e.pool_entry_id === al.pool_entry_id &&
      e.participant_id === (p.payer_participant_id === sourceId ? targetId : sourceId))));
  if (payerRel) refusals.push(PLAN_REFUSAL.PAYER_RELATIONSHIP);

  if (refusals.length) {
    return { ok: false, refusals: [...new Set(refusals)].sort(), sourceId, targetId, mutates: false };
  }

  const affectedEntries = entries.filter((e) => e.participant_id === sourceId).map((e) => e.pool_entry_id);
  const affectedPredictions = predictions.filter((p) => affectedEntries.includes(p.pool_entry_id)).length;
  const paymentsAsPayer = payments.filter((p) => p.payer_participant_id === sourceId).map((p) => p.payment_id);
  const prizesHeld = prizes.filter((z) => z.participant_id === sourceId ||
    affectedEntries.includes(z.pool_entry_id)).length;
  const priorReversal = mergeHistory.some((m) =>
    ((m.surviving_participant_id === targetId && m.merged_participant_id === sourceId) ||
     (m.surviving_participant_id === sourceId && m.merged_participant_id === targetId)) && m.reversed_at);

  return {
    ok: true, mutates: false,
    sourceId, targetId, band, evidence,
    operatorConfirmationRequired: true,
    confirmationPhrase: `MERGE ${sourceId} INTO ${targetId}`,
    recordsAffected: {
      pool_entries: affectedEntries.length,
      predictions_indirectly: affectedPredictions,
      payments_as_payer_NOT_rewritten: paymentsAsPayer.length,
      prizes_NOT_rewritten: prizesHeld,
    },
    repoints: PLAN_REPOINT,
    notRewritten: PLAN_NEVER_REWRITE,
    priorReversalExists: priorReversal,
    warnings: priorReversal
      ? ["this pair was merged and reversed before; the earlier reversal was an operator decision and must be read before repeating the merge"]
      : [],
    reversalPlan: {
      mechanism: "identity.mjs reverseMerge(linkId, confirmation)",
      restores: ["participants.canonical_participant_id = null on the source",
        "pool_entries.participant_id back to the source, from the link's prior_state"],
      requires: ["the participant_identity_links row, which stores prior_state",
        "a separate operator confirmation — a reversal is as deliberate as a merge"],
      whyItWorks: "only repointable pointers were changed, and their prior values are stored in the link. Nothing historical was rewritten, so nothing historical needs reconstructing.",
      financialAttribution: "unchanged by both the merge and the reversal, because payments and allocations were never rewritten. This is the property that makes reversal safe rather than merely possible.",
    },
  };
}

/**
 * Apply a plan to a SYNTHETIC dataset copy, for simulation only. Returns a new dataset; the input is
 * untouched. This exists so WS8.5 can prove reversal restores financial attribution exactly.
 */
export function simulateApply(dataset, plan) {
  if (!plan.ok) throw new Error("cannot apply a refused plan");
  const d = structuredClone(dataset);
  const link = {
    link_id: `link-${plan.sourceId}-${plan.targetId}`,
    surviving_participant_id: plan.targetId,
    merged_participant_id: plan.sourceId,
    prior_state: {
      entries: d.entries.filter((e) => e.participant_id === plan.sourceId).map((e) => e.pool_entry_id),
      canonical_participant_id: null,
    },
    reversed_at: null,
  };
  for (const e of d.entries) if (e.participant_id === plan.sourceId) e.participant_id = plan.targetId;
  const src = d.participants.find((p) => p.participant_id === plan.sourceId);
  if (src) src.canonical_participant_id = plan.targetId;
  d.participant_identity_links = [...(d.participant_identity_links || []), link];
  return { dataset: d, linkId: link.link_id };
}

export function simulateReverse(dataset, linkId) {
  const d = structuredClone(dataset);
  const link = (d.participant_identity_links || []).find((l) => l.link_id === linkId);
  if (!link) throw new Error("unknown link");
  if (link.reversed_at) throw new Error("already reversed");
  for (const id of link.prior_state.entries) {
    const e = d.entries.find((x) => x.pool_entry_id === id);
    if (e) e.participant_id = link.merged_participant_id;
  }
  const src = d.participants.find((p) => p.participant_id === link.merged_participant_id);
  if (src) src.canonical_participant_id = link.prior_state.canonical_participant_id;
  link.reversed_at = "SIMULATED";
  return d;
}

/**
 * Financial attribution fingerprint — who paid, and what each payment was applied to.
 * Used to prove a merge and its reversal leave money exactly where it was.
 */
export function financialAttribution(dataset) {
  const { payments = [], allocations = [], prizes = [] } = dataset;
  return JSON.stringify({
    payments: [...payments].map((p) => ({ id: p.payment_id, payer: p.payer_participant_id ?? null, amount: p.amount_minor ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    allocations: [...allocations].map((a) => ({ p: a.payment_id, e: a.pool_entry_id, amount: a.amount_minor }))
      .sort((a, b) => (a.p + a.e).localeCompare(b.p + b.e)),
    prizes: [...prizes].map((z) => ({ e: z.pool_entry_id ?? null, p: z.participant_id ?? null, amount: z.amount_minor }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

export default { analyseIdentities, proposeMerge, simulateApply, simulateReverse, financialAttribution, BAND, RISK };
