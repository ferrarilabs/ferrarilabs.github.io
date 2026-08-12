#!/usr/bin/env node
/**
 * Participant identity engine (Workstream C).
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE
 * No identity is ever merged automatically on the basis of a name or an email. Not "obvious"
 * matches, not exact-email matches, not case-normalised name matches. The engine SUGGESTS
 * candidates; only an operator decision, carried as an explicit confirmation token, can merge.
 *
 * Why so strict, when an exact email match looks safe: entries are family members sharing one
 * mailbox, one person entering under a partner's address, a shared work address used by three
 * colleagues. Every one of those looks like an exact duplicate and is not. A wrong merge combines
 * two people's payments and prize entitlements into one identity — real money, and the reversal is
 * a manual reconstruction. A missed merge costs a fragmented history and nothing else. The two
 * errors are not remotely symmetric, so the engine is deliberately biased toward not merging.
 *
 * That asymmetry is enforced structurally: `mergeIdentities` takes a confirmation object with an
 * operator id and a reason, and throws without one. There is no code path from `findDuplicateCandidates`
 * to `mergeIdentities` — they do not call each other. An "auto-merge high-confidence" convenience
 * function is deliberately absent, because that function is exactly how this control gets bypassed
 * under deadline pressure.
 *
 * REVERSIBILITY
 * A merge is a link row plus a pointer, never a deletion. The superseded participant's row survives
 * intact with `canonical_participant_id` set. Reversal clears the pointer and marks the link
 * reversed — the link is retained, because "this merge happened and was undone" is itself audit
 * history that a deleted row would destroy.
 *
 * Fixtures are synthetic throughout. This module never touches production data.
 */

import { pathToFileURL } from "node:url";

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** Strip accents so "José" and "Jose" compare equal — for SUGGESTION only, never for merging. */
const fold = (s) => norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const MATCH_SIGNAL = {
  EXACT_EMAIL: "EXACT_EMAIL",
  NORMALISED_NAME: "NORMALISED_NAME",
  FOLDED_NAME: "FOLDED_NAME",
  NAME_TOKEN_PERMUTATION: "NAME_TOKEN_PERMUTATION",
  SHARED_PAYER: "SHARED_PAYER",
};

/**
 * Confidence is an ORDINAL LABEL, not a score.
 *
 * A numeric score invites a threshold, a threshold invites automation, and automation is the thing
 * this design forbids. Labels stay non-arithmetic: you cannot write `if (score > 0.9) merge()`
 * against a label without writing the label name, which is reviewable in a diff.
 */
export const CONFIDENCE = { STRONG: "STRONG", MODERATE: "MODERATE", WEAK: "WEAK" };

/**
 * Candidate duplicate detection. Returns SUGGESTIONS for operator review. Never mutates.
 *
 * Deliberately excluded signals, each with the false positive that excludes it:
 *   · same display name alone                → common names; two different real people
 *   · same payment method                    → everyone uses the same two apps
 *   · adjacent createdAt                     → a family registering together in one sitting
 *   · same payer                             → a parent paying for three children (SHARED_PAYER is
 *                                              reported but is WEAK and never sufficient alone)
 */
export function findDuplicateCandidates(participants, { entries = [], payments = [] } = {}) {
  const active = participants.filter((p) => !p.canonical_participant_id);
  const out = [];

  const pairKey = (a, b) => [a, b].sort().join("|");
  const seen = new Map();
  const addSignal = (a, b, signal) => {
    if (a.participant_id === b.participant_id) return;
    const k = pairKey(a.participant_id, b.participant_id);
    if (!seen.has(k)) {
      seen.set(k, { a: a.participant_id, b: b.participant_id, signals: [] });
      out.push(seen.get(k));
    }
    const rec = seen.get(k);
    if (!rec.signals.includes(signal)) rec.signals.push(signal);
  };

  /**
   * BLOCKING, not a pairwise sweep.
   *
   * The first version compared every participant against every other — O(n²). The scale harness measured it
   * at 947 ms for 1 020 participants, 79% of the entire SCALE-C run, extrapolating to roughly a minute and a
   * half at 10 000. That is the bottleneck the scale model predicted for identity resolution.
   *
   * Every signal this function emits is an EQUALITY on some derived key, which means two participants can
   * only match if they share a key. So candidates are found by bucketing on those keys and comparing only
   * within a bucket. Same signals, same pairs, same confidence — the pairwise version is retained as the
   * test oracle (`findDuplicateCandidatesPairwise`) and a test asserts the two agree exactly.
   *
   * This is not an approximation. It is the same relation computed by grouping instead of scanning.
   */
  const buckets = new Map();
  const addToBucket = (key, participant, signal) => {
    if (!key) return;
    const k = `${signal}|${key}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(participant);
  };
  const tokenKey = (name) => fold(name).split(" ").filter(Boolean).sort().join(" ");

  for (const p of active) {
    if (p.email) addToBucket(norm(p.email), p, MATCH_SIGNAL.EXACT_EMAIL);
    // Aliases participate in EVERY name relation, exactly as a display name does. Bucketing them only
    // under FOLDED_NAME made the two implementations disagree: an alias identical to another
    // participant's display name is a normalised-name match, not merely a folded one.
    for (const n of [p.display_name, ...(p.aliases || [])].filter(Boolean)) {
      addToBucket(norm(n), p, MATCH_SIGNAL.NORMALISED_NAME);
      addToBucket(fold(n), p, MATCH_SIGNAL.FOLDED_NAME);
      addToBucket(tokenKey(n), p, MATCH_SIGNAL.NAME_TOKEN_PERMUTATION);
    }
  }

  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const signal = key.slice(0, key.indexOf("|"));
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        if (a.participant_id === b.participant_id) continue;
        // Signal precedence must match the pairwise version: a pair equal on the normalised name is
        // reported as NORMALISED_NAME and NOT additionally as FOLDED_NAME or a token permutation, because
        // reporting three name signals for one similarity would inflate confidence.
        const an = [a.display_name, ...(a.aliases || [])].filter(Boolean);
        const bn = [b.display_name, ...(b.aliases || [])].filter(Boolean);
        const eqNorm = an.some((x) => bn.some((y) => norm(x) === norm(y)));
        const eqFold = an.some((x) => bn.some((y) => fold(x) === fold(y)));
        if (signal === MATCH_SIGNAL.FOLDED_NAME && eqNorm) continue;
        if (signal === MATCH_SIGNAL.NAME_TOKEN_PERMUTATION && (eqNorm || eqFold)) continue;
        addSignal(a, b, signal);
      }
    }
  }

  // SHARED_PAYER: reported for context, never on its own — a parent funds several children.
  const payerOf = new Map();
  for (const p of payments) {
    const e = entries.find((x) => x.pool_entry_id === p.asserted_for_pool_entry_id);
    if (e && p.payer_participant_id && p.payer_participant_id !== e.participant_id) {
      if (!payerOf.has(p.payer_participant_id)) payerOf.set(p.payer_participant_id, new Set());
      payerOf.get(p.payer_participant_id).add(e.participant_id);
    }
  }
  const byId = new Map(active.map((p) => [p.participant_id, p]));
  for (const funded of payerOf.values()) {
    const list = [...funded].map((id) => byId.get(id)).filter(Boolean);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = pairKey(list[i].participant_id, list[j].participant_id);
        if (seen.has(k)) addSignal(list[i], list[j], MATCH_SIGNAL.SHARED_PAYER);
      }
    }
  }

  for (const c of out) {
    c.confidence = c.signals.includes(MATCH_SIGNAL.EXACT_EMAIL) && c.signals.some((s) =>
        [MATCH_SIGNAL.NORMALISED_NAME, MATCH_SIGNAL.FOLDED_NAME, MATCH_SIGNAL.NAME_TOKEN_PERMUTATION].includes(s))
      ? CONFIDENCE.STRONG
      : c.signals.includes(MATCH_SIGNAL.EXACT_EMAIL) || c.signals.includes(MATCH_SIGNAL.NORMALISED_NAME)
        ? CONFIDENCE.MODERATE
        : CONFIDENCE.WEAK;
    // Stated on every candidate so no caller can claim it did not know.
    c.requiresOperatorConfirmation = true;
    c.autoMergeable = false;
  }
  return out.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}


/**
 * The original O(n²) pairwise implementation, retained as a TEST ORACLE.
 *
 * It is not used in production paths — it is what the blocked implementation is proven equal to. Deleting it
 * would leave the optimisation unverifiable, which is how an optimisation quietly changes behaviour.
 */
export function findDuplicateCandidatesPairwise(participants) {
  const active = participants.filter((p) => !p.canonical_participant_id);
  const out = [];
  const pairKey = (a, b) => [a, b].sort().join("|");
  const seen = new Map();
  const addSignal = (a, b, signal) => {
    if (a.participant_id === b.participant_id) return;
    const k = pairKey(a.participant_id, b.participant_id);
    if (!seen.has(k)) { seen.set(k, { a: a.participant_id, b: b.participant_id, signals: [] }); out.push(seen.get(k)); }
    const rec = seen.get(k);
    if (!rec.signals.includes(signal)) rec.signals.push(signal);
  };
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (a.email && b.email && norm(a.email) === norm(b.email)) addSignal(a, b, MATCH_SIGNAL.EXACT_EMAIL);

      /**
       * ONE name signal per pair — the strongest that applies.
       *
       * Two fixes the equivalence test forced, both on this side:
       *   · alias matching is SYMMETRIC. The original compared only a's aliases against b's names, so a
       *     pair was found or missed depending on which row happened to carry the alias.
       *   · PRECEDENCE is applied uniformly. Once the aliases were compared unconditionally, a pair with
       *     identical display names reported NORMALISED_NAME *and* FOLDED_NAME — two signals for one
       *     similarity, which inflates confidence.
       */
      const aNames = [a.display_name, ...(a.aliases || [])].filter(Boolean);
      const bNames = [b.display_name, ...(b.aliases || [])].filter(Boolean);
      const tokens = (n) => fold(n).split(" ").filter(Boolean).sort().join(" ");
      if (aNames.some((x) => bNames.some((y) => norm(x) === norm(y)))) {
        addSignal(a, b, MATCH_SIGNAL.NORMALISED_NAME);
      } else if (aNames.some((x) => bNames.some((y) => fold(x) === fold(y)))) {
        addSignal(a, b, MATCH_SIGNAL.FOLDED_NAME);
      } else if (aNames.some((x) => bNames.some((y) => tokens(x) && tokens(x) === tokens(y)))) {
        addSignal(a, b, MATCH_SIGNAL.NAME_TOKEN_PERMUTATION);
      }
    }
  }
  return out.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────
/** Follow canonical_participant_id to the surviving identity. Throws on a cycle rather than looping. */
export function resolveCanonical(participants, participantId) {
  const byId = new Map(participants.map((p) => [p.participant_id, p]));
  const path = [];
  let cur = participantId;
  while (true) {
    const p = byId.get(cur);
    if (!p) throw new Error(`participant ${cur} does not exist`);
    if (path.includes(cur)) {
      throw new Error(`identity cycle detected: ${[...path, cur].join(" → ")} — resolution would never terminate`);
    }
    path.push(cur);
    if (!p.canonical_participant_id) return { participant_id: cur, hops: path.length - 1, path };
    cur = p.canonical_participant_id;
    if (path.length > byId.size) throw new Error("identity chain longer than the participant set — corrupt pointers");
  }
}

export const MERGE_REFUSAL = {
  NO_CONFIRMATION: "NO_CONFIRMATION",
  SELF_MERGE: "SELF_MERGE",
  MISSING_PARTICIPANT: "MISSING_PARTICIPANT",
  ALREADY_MERGED: "ALREADY_MERGED",
  SURVIVOR_IS_SUPERSEDED: "SURVIVOR_IS_SUPERSEDED",
  WOULD_CREATE_CYCLE: "WOULD_CREATE_CYCLE",
};

export class MergeRefused extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

/**
 * Merge `mergedId` into `survivingId`. Pure: returns a NEW state, mutates nothing.
 *
 * `confirmation` must carry `{ operatorId, reason }`. This is the entire access-control story of the
 * identity model at the data layer, so it is a hard precondition rather than a defaulted parameter:
 * a default would make the unconfirmed path the easy one.
 */
export function mergeIdentities(state, { survivingId, mergedId, confirmation, at, linkId }) {
  const participants = state.participants.map((p) => ({ ...p }));
  const links = (state.participant_identity_links || []).map((l) => ({ ...l }));

  if (!confirmation || !confirmation.operatorId || !confirmation.reason) {
    throw new MergeRefused(MERGE_REFUSAL.NO_CONFIRMATION,
      "a merge requires an operator id and a stated reason. No name or email match, however exact, " +
      "authorises a merge — shared mailboxes and common names make every such match a possible false positive, " +
      "and a wrong merge combines two people's money.");
  }
  if (survivingId === mergedId) {
    throw new MergeRefused(MERGE_REFUSAL.SELF_MERGE, "a participant cannot be merged into itself — this creates a 1-cycle");
  }
  const S = participants.find((p) => p.participant_id === survivingId);
  const M = participants.find((p) => p.participant_id === mergedId);
  if (!S || !M) throw new MergeRefused(MERGE_REFUSAL.MISSING_PARTICIPANT, `unknown participant ${!S ? survivingId : mergedId}`);
  if (M.canonical_participant_id) {
    throw new MergeRefused(MERGE_REFUSAL.ALREADY_MERGED,
      `${mergedId} is already merged. Re-merging would rewrite existing provenance; reverse the prior merge first.`);
  }
  if (S.canonical_participant_id) {
    throw new MergeRefused(MERGE_REFUSAL.SURVIVOR_IS_SUPERSEDED,
      `${survivingId} is itself superseded. Merging into a superseded identity buries rows one hop further from ` +
      `the canonical record; merge into the canonical survivor instead.`);
  }
  // Cycle pre-check: would the survivor's chain reach the merged participant?
  try {
    const r = resolveCanonical(participants, survivingId);
    if (r.path.includes(mergedId)) {
      throw new MergeRefused(MERGE_REFUSAL.WOULD_CREATE_CYCLE,
        `${survivingId} already resolves through ${mergedId}; this merge would close a cycle`);
    }
  } catch (e) {
    if (e instanceof MergeRefused) throw e;
    throw new MergeRefused(MERGE_REFUSAL.WOULD_CREATE_CYCLE, e.message);
  }

  // The superseded row is PRESERVED, never deleted — deletion would destroy the history the merge
  // is supposed to consolidate, and would make reversal impossible.
  M.canonical_participant_id = survivingId;
  M.superseded_at = at;

  // Aliases accumulate: the surviving identity must still be findable under every name the merged
  // person used, or the next duplicate search will re-suggest a pair that was already resolved.
  const mergedAliases = new Set([...(S.aliases || []), ...(M.aliases || [])]);
  if (M.display_name && norm(M.display_name) !== norm(S.display_name)) mergedAliases.add(M.display_name);
  S.aliases = [...mergedAliases].filter(Boolean);

  links.push({
    link_id: linkId,
    surviving_participant_id: survivingId,
    merged_participant_id: mergedId,
    confirmed_by: confirmation.operatorId,
    reason: confirmation.reason,
    // The pre-merge state of the merged row, so reversal restores exactly what existed rather than
    // guessing. Provenance that cannot reconstruct the prior state is not provenance.
    prior_state: { display_name: M.display_name, email: M.email, aliases: [...(M.aliases || [])] },
    prior_surviving_aliases: [...(state.participants.find((p) => p.participant_id === survivingId).aliases || [])],
    merged_at: at,
    reversed_at: null,
    reversed_by: null,
    reversal_reason: null,
  });

  return { ...state, participants, participant_identity_links: links };
}

/** Reverse a confirmed merge. The link row is RETAINED and marked reversed — that it happened is history. */
export function reverseMerge(state, { linkId, confirmation, at }) {
  if (!confirmation || !confirmation.operatorId || !confirmation.reason) {
    throw new MergeRefused(MERGE_REFUSAL.NO_CONFIRMATION, "reversing a merge also requires an operator id and a reason");
  }
  const participants = state.participants.map((p) => ({ ...p }));
  const links = (state.participant_identity_links || []).map((l) => ({ ...l }));
  const link = links.find((l) => l.link_id === linkId);
  if (!link) throw new MergeRefused(MERGE_REFUSAL.MISSING_PARTICIPANT, `unknown link ${linkId}`);
  if (link.reversed_at) throw new MergeRefused(MERGE_REFUSAL.ALREADY_MERGED, `link ${linkId} is already reversed`);

  const M = participants.find((p) => p.participant_id === link.merged_participant_id);
  const S = participants.find((p) => p.participant_id === link.surviving_participant_id);
  if (!M || !S) throw new MergeRefused(MERGE_REFUSAL.MISSING_PARTICIPANT, "link references a missing participant");

  M.canonical_participant_id = null;
  M.superseded_at = null;
  M.display_name = link.prior_state.display_name;
  M.email = link.prior_state.email;
  M.aliases = [...link.prior_state.aliases];
  // Restore the survivor's alias set as it was, rather than subtracting — subtraction would drop an
  // alias the survivor legitimately gained from a DIFFERENT merge in between.
  S.aliases = [...link.prior_surviving_aliases];

  link.reversed_at = at;
  link.reversed_by = confirmation.operatorId;
  link.reversal_reason = confirmation.reason;

  return { ...state, participants, participant_identity_links: links };
}

/** Rows that must be re-pointed when a merge happens, and the ones that deliberately must not. */
export const MERGE_REPOINT_PLAN = [
  { table: "pool_entries", column: "participant_id", action: "REPOINT", why: "entries follow the person" },
  { table: "payments", column: "payer_participant_id", action: "REPOINT", why: "payments follow the payer" },
  { table: "prize_allocations", column: "participant_id", action: "REPOINT", why: "winnings follow the person" },
  { table: "ranking_snapshots", column: "participant_id", action: "LEAVE",
    why: "a snapshot records the leaderboard AS IT WAS PUBLISHED; re-pointing it would retroactively rewrite a historical standing" },
  { table: "audit_events", column: "actor_participant_id", action: "LEAVE",
    why: "audit rows are immutable; who acted at the time does not change because identities were later consolidated" },
];

/** Apply the re-point plan. Separated from mergeIdentities so the two can be reviewed independently. */
export function repointAfterMerge(dataset, { survivingId, mergedId }) {
  const out = { ...dataset };
  for (const rule of MERGE_REPOINT_PLAN) {
    if (rule.action !== "REPOINT" || !out[rule.table]) continue;
    out[rule.table] = out[rule.table].map((r) =>
      r[rule.column] === mergedId ? { ...r, [rule.column]: survivingId } : r);
  }
  return out;
}

/** Identity audit history for one participant: every merge it was part of, in order. */
export function identityHistory(state, participantId) {
  return (state.participant_identity_links || [])
    .filter((l) => l.surviving_participant_id === participantId || l.merged_participant_id === participantId)
    .sort((a, b) => String(a.merged_at).localeCompare(String(b.merged_at)))
    .map((l) => ({
      link_id: l.link_id,
      role: l.surviving_participant_id === participantId ? "SURVIVOR" : "MERGED",
      counterparty: l.surviving_participant_id === participantId ? l.merged_participant_id : l.surviving_participant_id,
      merged_at: l.merged_at,
      confirmed_by: l.confirmed_by,
      status: l.reversed_at ? "REVERSED" : "ACTIVE",
      reversed_at: l.reversed_at,
    }));
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  console.log("identity engine — merge requires operator confirmation; there is no auto-merge entry point.");
  console.log(`signals: ${Object.keys(MATCH_SIGNAL).join(", ")}`);
  console.log(`refusals: ${Object.keys(MERGE_REFUSAL).join(", ")}`);
  for (const r of MERGE_REPOINT_PLAN) console.log(`  ${r.action.padEnd(7)} ${r.table}.${r.column} — ${r.why}`);
}
