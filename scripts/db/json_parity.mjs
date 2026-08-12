#!/usr/bin/env node
/**
 * JSON → relational parity harness (Workstream M).
 *
 * WHAT THIS PROVES
 * The migration decomposes one `bolao_state` jsonb document into ~20 relational tables. The failure
 * that matters is not a crash — it is a SILENT loss: one entry dropped, one payer attribution
 * flipped, one audit line collapsed. Nothing in the app would report it. Money would just be
 * attributed to the wrong person.
 *
 * So the harness is built around three separate, independent claims, because any one of them alone
 * can pass while the migration is still wrong:
 *
 *   1. COVERAGE  — every key present in the document is accounted for by a disposition
 *                  (MOVE / KEEP_JSON / DERIVE / DROP_AFTER_VALIDATION). An unaccounted key is the
 *                  actual mechanism of silent loss: nobody decided to drop it.
 *   2. PARITY    — a set of invariants comparing document to dataset (counts, sums, sets of ids,
 *                  per-entity attribution). These catch loss that coverage cannot see, e.g. two
 *                  entries collapsing into one participant row correctly but losing an entry row.
 *   3. ROUND-TRIP — the dataset is projected BACK to a document and compared against the original
 *                  under an explicit, declared normalisation. Round-trip is the strongest of the
 *                  three and the only one that can catch a field that was moved to the WRONG column.
 *
 * WHY ROUND-TRIP IS NOT EXPECTED TO BE BYTE-EQUAL
 * Some loss is intentional and ratified: `paid` becomes DERIVED, `deletedIds` becomes a per-row
 * column, audit metadata is PII-stripped per B1. Those are declared in LOSSY_BY_DESIGN with the
 * decision that authorises each one. Anything lossy that is NOT on that list is a defect. That
 * distinction is the entire value of the harness — "the round trip differs" is useless; "the round
 * trip differs in a way nobody authorised" is actionable.
 *
 * FIXTURES ARE SYNTHETIC. This module never reads production state.
 *
 * Usage:
 *   node scripts/db/json_parity.mjs --self-test
 *   node scripts/db/json_parity.mjs --state=synthetic_state.json [--json]
 */

import { readFileSync } from "node:fs";
import { parseMoney } from "./financial.mjs";
import { pathToFileURL } from "node:url";

/** Disposition of every key the three apps are known to write. Source: BOLAO_STATE_DECOMPOSITION §2–3. */
export const DISPOSITIONS = {
  "entries": "MOVE",
  "entries[].id": "MOVE",
  "entries[].entryName": "MOVE",
  "entries[].participantEmail": "MOVE",
  "entries[].payerName": "MOVE",
  "entries[].paymentMethod": "MOVE",
  "entries[].picks": "KEEP_JSON",
  "entries[].createdAt": "MOVE",
  "entries[].updatedAt": "MOVE",
  "paid": "DERIVE",
  "deletedIds": "DROP_AFTER_VALIDATION",
  "auditLog": "MOVE",
  "auditLog[].ts": "MOVE",
  "auditLog[].action": "MOVE",
  "auditLog[].admin": "MOVE",
  "auditLog[].detail": "DROP_AFTER_VALIDATION",
  "results": "MOVE",
  "siteVersion": "DROP_AFTER_VALIDATION",
  "lastSync": "MOVE",
};

/**
 * Losses that are AUTHORISED, each with the decision that authorises it.
 * Adding an entry here is a design decision and must cite a decision id — it is deliberately
 * awkward so that "just add it to the allowlist" is never the easy path out of a failing parity run.
 */
export const LOSSY_BY_DESIGN = [
  { path: "paid", decision: "D-1 / U-settlement", why: "settlement becomes derived from payment_allocations; the boolean carried no amount, date, method, reference or actor, so it cannot round-trip and must not" },
  { path: "deletedIds", decision: "§7 tombstone ordering", why: "a tombstone SET becomes a per-row deleted_at; the set itself is redundant once every row carries its own state" },
  { path: "auditLog[].detail", decision: "B1 / ADR-008", why: "audit metadata is PII-stripped; reproducing the original free-text detail would reintroduce exactly what B1 prohibits" },
  { path: "siteVersion", decision: "T-18 class", why: "a deploy artefact, not domain state; it belongs in release metadata, not in a row" },
];

const norm = (s) => String(s ?? "").trim().toLowerCase();
const authorised = (path) => LOSSY_BY_DESIGN.some((l) => l.path === path);

// ─────────────────────────────────────────────────────────────────────────────
// 1. COVERAGE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Containers whose KEYS are data, not schema — `paid` is keyed by entry id, `results` and `picks` by
 * match id. Descending into them would emit one "unaccounted key" per row (`paid.en-1`, `paid.en-2`,
 * …), so coverage would grow with the data and could never reach zero. That is not a coverage
 * finding; it is a category error about what a key is.
 *
 * Being explicit matters: the alternative — quietly ignoring any path that looks id-shaped — would
 * also swallow a genuinely new schema key that happened to resemble an id. This list is short,
 * reviewable, and each member is opaque for a stated reason.
 */
export const OPAQUE_CONTAINERS = new Set([
  "paid",             // { entryId -> bool }        : replaced wholesale by derived settlement
  "results",          // { matchId -> result }      : one row per key in match_results
  "entries[].picks",  // { matchId -> prediction }  : KEEP_JSON in phase 1, byte-preserved (PAR-12)
]);

/** Enumerate the key paths actually present in a document (arrays collapse to `[]`). */
export function observedPaths(state) {
  const out = new Set();
  const walk = (node, prefix) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const el of node) walk(el, `${prefix}[]`);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.add(p);
      if (OPAQUE_CONTAINERS.has(p)) continue; // its keys are values; the container itself is declared
      walk(v, p);
    }
  };
  walk(state, "");
  return out;
}

export function coverage(state) {
  const observed = [...observedPaths(state)];
  const unaccounted = observed.filter((p) => !(p in DISPOSITIONS));
  // A declared key that never appears is not an error — the three apps write different subsets —
  // but it IS worth reporting, because a disposition for a key nobody writes is untested code.
  const declaredUnseen = Object.keys(DISPOSITIONS).filter((p) => !observed.includes(p));
  return { observed, unaccounted, declaredUnseen };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. TRANSFORM (reference implementation of the backfill)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Decompose a document into the target dataset shape used by data_quality.mjs.
 *
 * This is a REFERENCE transform, not the production migration: its purpose is to make the parity
 * invariants executable against something. When the real SQL backfill is written, it must satisfy
 * exactly the same invariants, and any divergence between the two is itself a finding.
 *
 * `expectedFee` is REQUIRED and passed in, never inferred. B-08 established entryFee=5 as
 * authoritative for the current pools and U1 ratified USD, but a historical pool whose fee is
 * unknown must stay unknown — inventing one here would put a fabricated number into every
 * settlement classification downstream.
 */
export function decompose(state, { poolId, editionId, expectedFee, currency = "USD" }) {
  if (!expectedFee) throw new Error("expectedFee is required — an inferred entry fee would fabricate money (B-08)");
  const entries = state.entries || [];
  const deleted = new Set(state.deletedIds || []);
  const paidMap = state.paid || {};

  /** Participants are deduplicated by normalised email, falling back to normalised name. */
  const participants = [];
  const pIndex = new Map();
  const resolveParticipant = (name, email) => {
    const key = email ? `e:${norm(email)}` : `n:${norm(name)}`;
    if (pIndex.has(key)) return pIndex.get(key);
    const id = `p-${pIndex.size + 1}`;
    participants.push({ participant_id: id, display_name: name ?? null, email: email ?? null, canonical_participant_id: null });
    pIndex.set(key, id);
    return id;
  };

  const pool_entries = [], payments = [], payment_allocations = [], audit_events = [];

  for (const e of entries) {
    const participant_id = resolveParticipant(e.entryName, e.participantEmail);
    pool_entries.push({
      pool_entry_id: e.id,
      pool_id: poolId,
      participant_id,
      entry_label: e.entryLabel || "main",
      expected: expectedFee,
      picks: e.picks ?? null,
      created_at: e.createdAt ?? null,
      updated_at: e.updatedAt ?? null,
      version: 1,
      deleted_at: deleted.has(e.id) ? (e.updatedAt ?? e.createdAt ?? null) : null,
      legacy_asserted: paidMap[e.id] === true,
    });

    // D-1: a legacy paid=true becomes a payment with amount NULL — asserted, never invented.
    if (paidMap[e.id] === true) {
      /**
       * Payer resolution, and why it is not simply resolveParticipant(payerName).
       *
       * The payer is identified only by a free-text name (there is no payer email in the document),
       * while the entrant is identified by email. Keying the payer by name therefore mints a SECOND
       * identity for a person who already exists under their email — so an entrant who paid for
       * their own entry gets split in two, and their payment stops being attributable to them.
       * The parity harness caught exactly that.
       *
       * When the normalised payer name equals the entrant's own normalised name, treating them as
       * the same person is not a guess: it is one entry, one name, self-payment. A payer whose name
       * DIFFERS stays a separate identity and remains UNKNOWN-1 — a third party paid, and only an
       * operator can say who they are. Guessing there would misattribute someone's money.
       */
      const selfPaid = !e.payerName || norm(e.payerName) === norm(e.entryName);
      const payer_participant_id = selfPaid ? participant_id : resolveParticipant(e.payerName, null);
      const payment_id = `pay-${payments.length + 1}`;
      payments.push({
        payment_id,
        payer_participant_id,
        // An asserted payment is asserted ABOUT an entry. Without this link the assertion cannot be
        // traced back to what it was asserting, which is how payer attribution was being lost.
        asserted_for_pool_entry_id: e.pool_entry_id ?? e.id,
        payer_name_as_recorded: e.payerName ?? null,
        amount: null, currency,
        kind: "contribution", method: e.paymentMethod ?? null,
        external_reference: null, legacy_asserted: true,
      });
      // Deliberately NO payment_allocations row: an allocation implies an amount, and this payment
      // has none. PAR-07 asserts this absence, so the omission is a tested decision, not an oversight.
    }
  }

  for (const [i, a] of (state.auditLog || []).entries()) {
    audit_events.push({
      audit_event_id: `a-${i + 1}`,
      occurred_at: a.ts ?? null,
      action: a.action ?? null,
      actor_role: a.admin ? "admin" : "system",
      safe_metadata: {}, // B1: original free-text `detail` is deliberately not carried over
      previous_event_hash: i === 0 ? null : `h${i}`,
      event_hash: `h${i + 1}`,
    });
  }

  const match_results = Object.entries(state.results || {}).map(([match_id, r], i) => ({
    match_result_id: `r-${i + 1}`, match_id, is_official: true, superseded_by_id: null, raw: r,
  }));

  const sync_state = state.lastSync
    ? [{ sync_state_id: "s-1", competition_edition_id: editionId, active_phase_id: null, last_success_at: state.lastSync }]
    : [];

  return {
    participants, pool_entries, payments, payment_allocations, audit_events,
    match_results, sync_state,
    pools: [{ pool_id: poolId, competition_edition_id: editionId }],
    competition_editions: [{ competition_edition_id: editionId, competition_id: "c-1" }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PARITY INVARIANTS
// ─────────────────────────────────────────────────────────────────────────────
export const PARITY_INVARIANTS = [
  {
    id: "PAR-01", title: "entry count preserved exactly",
    why: "a dropped entry is a participant silently removed from a pool they paid into",
    check: (s, d) => (s.entries || []).length === d.pool_entries.length
      ? [] : [`document has ${(s.entries || []).length} entries, dataset has ${d.pool_entries.length}`],
  },
  {
    id: "PAR-02", title: "entry id set preserved exactly (no substitution)",
    why: "equal counts can still hide a swapped id, which reattributes an entry to the wrong person",
    check: (s, d) => {
      const a = new Set((s.entries || []).map((e) => e.id));
      const b = new Set(d.pool_entries.map((e) => e.pool_entry_id));
      const missing = [...a].filter((x) => !b.has(x));
      const extra = [...b].filter((x) => !a.has(x));
      return [
        ...missing.map(() => "an entry id present in the document is absent from the dataset"),
        ...extra.map(() => "the dataset contains an entry id not present in the document"),
      ];
    },
  },
  {
    id: "PAR-03", title: "soft-delete state preserved (tombstones neither lost nor invented)",
    why: "losing a tombstone resurrects a withdrawn entry into the ranking and the prize split",
    check: (s, d) => {
      const del = new Set(s.deletedIds || []);
      const out = [];
      for (const e of d.pool_entries) {
        const should = del.has(e.pool_entry_id);
        const is = e.deleted_at !== null;
        if (should !== is) out.push(`entry ${e.pool_entry_id}: tombstone ${should ? "lost" : "invented"}`);
      }
      if (del.size !== d.pool_entries.filter((e) => e.deleted_at).length) {
        out.push("tombstone count differs between document and dataset");
      }
      return out;
    },
  },
  {
    id: "PAR-04", title: "every distinct participant identity is represented",
    why: "over-merging two people into one identity merges their money; under-merging fragments one person's history",
    check: (s, d) => {
      const keys = new Set();
      for (const e of s.entries || []) keys.add(e.participantEmail ? `e:${norm(e.participantEmail)}` : `n:${norm(e.entryName)}`);
      // A THIRD-PARTY payer is an additional identity; a self-payer is not. Counting every payer name
      // would inflate this bound by one per self-payment and let a genuine identity split through —
      // which it did, until PAR-15's fixture exposed it. The bound must mirror the resolution rule.
      for (const e of s.entries || []) {
        if (e.payerName && norm(e.payerName) !== norm(e.entryName)) keys.add(`n:${norm(e.payerName)}`);
      }
      // Still an UPPER bound, not equality: two distinct keys may legitimately be one person
      // (UNKNOWN-1), and only an operator can decide that. What must never happen is MORE
      // participant rows than there are distinct identity keys — that is a split, always a defect.
      return d.participants.length > keys.size
        ? [`dataset has ${d.participants.length} participants but only ${keys.size} distinct identity keys exist — identities were split`]
        : [];
    },
  },
  {
    id: "PAR-05", title: "no participant row without an entry or a payment",
    why: "an orphan identity inflates participant counts in every report",
    check: (s, d) => {
      const used = new Set([
        ...d.pool_entries.map((e) => e.participant_id),
        ...d.payments.map((p) => p.payer_participant_id),
      ]);
      return d.participants.filter((p) => !used.has(p.participant_id))
        .map((p) => `participant ${p.participant_id} is referenced by nothing`);
    },
  },
  {
    id: "PAR-06", title: "legacy paid=true becomes exactly one asserted payment, with no invented amount",
    why: "D-1: fabricating an amount would put a made-up number into the settlement of a real entry",
    check: (s, d) => {
      const paidIds = Object.entries(s.paid || {}).filter(([, v]) => v === true).map(([k]) => k);
      const out = [];
      if (d.payments.length !== paidIds.length) {
        out.push(`${paidIds.length} paid flags produced ${d.payments.length} payments`);
      }
      for (const p of d.payments) {
        if (p.legacy_asserted && p.amount !== null) out.push(`payment ${p.payment_id} invented an amount for a legacy paid flag`);
      }
      for (const id of paidIds) {
        const e = d.pool_entries.find((x) => x.pool_entry_id === id);
        if (e && !e.legacy_asserted) out.push(`entry ${id} lost its legacy paid assertion`);
      }
      return out;
    },
  },
  {
    id: "PAR-07", title: "no allocation is created from a legacy paid flag",
    why: "an allocation implies an amount; a legacy flag has none, so any allocation here is fabricated money",
    check: (s, d) => d.payment_allocations
      .filter((a) => d.payments.find((p) => p.payment_id === a.payment_id)?.legacy_asserted)
      .map((a) => `allocation ${a.allocation_id} was fabricated from a legacy paid flag`),
  },
  {
    id: "PAR-14", title: "payer attribution preserved and traceable to its entry",
    why: "the payer is who actually sent the money; losing the attribution, or attaching the payment to the wrong entry, misstates who has paid and who is owed. Round-trip found this defect with no invariant guarding it — this is that gap closed.",
    check: (s, d) => {
      const out = [];
      for (const p of d.payments) {
        if (!p.asserted_for_pool_entry_id) { out.push(`payment ${p.payment_id} is not traceable to an entry`); continue; }
        const e = d.pool_entries.find((x) => x.pool_entry_id === p.asserted_for_pool_entry_id);
        if (!e) { out.push(`payment ${p.payment_id} points at an entry that does not exist`); continue; }
        const src = (s.entries || []).find((x) => x.id === e.pool_entry_id);
        if (!src) continue;
        if (norm(src.payerName) !== norm(p.payer_name_as_recorded)) {
          out.push(`payment ${p.payment_id}: recorded payer differs from the document's payer for entry ${e.pool_entry_id}`);
        }
        if (norm(src.paymentMethod) !== norm(p.method)) {
          out.push(`payment ${p.payment_id}: payment method differs from the document`);
        }
      }
      return out;
    },
  },
  {
    id: "PAR-15", title: "a self-paying entrant is not split into two identities",
    why: "the payer is named in free text while the entrant is keyed by email; keying the payer by name mints a duplicate identity for the same person and detaches their payment from them",
    check: (s, d) => {
      const out = [];
      for (const p of d.payments) {
        const e = d.pool_entries.find((x) => x.pool_entry_id === p.asserted_for_pool_entry_id);
        if (!e) continue;
        const src = (s.entries || []).find((x) => x.id === e.pool_entry_id);
        if (!src?.payerName) continue;
        const self = norm(src.payerName) === norm(src.entryName);
        if (self && p.payer_participant_id !== e.participant_id) {
          out.push(`entry ${e.pool_entry_id}: self-payment was attributed to a second identity`);
        }
        if (!self && p.payer_participant_id === e.participant_id) {
          out.push(`entry ${e.pool_entry_id}: a third-party payer was collapsed into the entrant`);
        }
      }
      return out;
    },
  },
  {
    id: "PAR-08", title: "audit log line count preserved",
    why: "audit_events is the tamper-evidence record; a collapsed line makes the chain shorter than the history it claims to cover",
    check: (s, d) => (s.auditLog || []).length === d.audit_events.length
      ? [] : [`document has ${(s.auditLog || []).length} audit lines, dataset has ${d.audit_events.length}`],
  },
  {
    id: "PAR-09", title: "audit events carry no free-text detail (B1)",
    why: "carrying `detail` across would reintroduce the PII that ADR-008 exists to keep out",
    check: (s, d) => d.audit_events
      .filter((a) => JSON.stringify(a.safe_metadata ?? {}).length > 2)
      .map((a) => `audit ${a.audit_event_id} carries metadata that must be stripped`),
  },
  {
    id: "PAR-10", title: "audit ordering preserved",
    why: "reordering an audit log destroys causality — the reason anyone reads it",
    check: (s, d) => {
      const src = (s.auditLog || []).map((a) => a.ts ?? null);
      const got = d.audit_events.map((a) => a.occurred_at);
      return JSON.stringify(src) === JSON.stringify(got) ? [] : ["audit event order or timestamps differ from the document"];
    },
  },
  {
    id: "PAR-11", title: "match results preserved key-for-key",
    why: "a lost result freezes scoring; a swapped one changes who wins money",
    check: (s, d) => {
      const a = Object.keys(s.results || {}).sort();
      const b = d.match_results.map((r) => r.match_id).sort();
      return JSON.stringify(a) === JSON.stringify(b) ? [] : ["match result key set differs from the document"];
    },
  },
  {
    id: "PAR-12", title: "picks preserved byte-identically (KEEP_JSON phase)",
    why: "picks are the scoring input; any normalisation of them changes results, so phase 1 must not touch them at all",
    check: (s, d) => {
      const out = [];
      for (const e of s.entries || []) {
        const row = d.pool_entries.find((r) => r.pool_entry_id === e.id);
        if (!row) continue;
        if (JSON.stringify(row.picks ?? null) !== JSON.stringify(e.picks ?? null)) {
          out.push(`entry ${e.id}: picks were altered during decomposition`);
        }
      }
      return out;
    },
  },
  {
    id: "PAR-13", title: "expected fee is uniform and explicit, never inferred",
    why: "B-08: a fee inferred per entry would silently disagree with the pool's own rule",
    check: (s, d) => {
      const cur = d.pool_entries[0]?.expected?.currency;
      const out = [];
      for (const e of d.pool_entries) {
        if (!e.expected) { out.push(`entry ${e.pool_entry_id} has no expected fee`); continue; }
        if (e.expected.currency !== cur) out.push(`entry ${e.pool_entry_id} has a different currency from its pool`);
        if (e.expected.minor <= 0) out.push(`entry ${e.pool_entry_id} has a non-positive expected fee`);
      }
      return out;
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4. ROUND-TRIP
// ─────────────────────────────────────────────────────────────────────────────
/** Project a dataset back into document shape, under the declared normalisation. */
export function recompose(dataset) {
  const P = new Map(dataset.participants.map((p) => [p.participant_id, p]));
  const entries = dataset.pool_entries.map((e) => {
    const p = P.get(e.participant_id);
    // Find the payment by the entry it was asserted FOR, not by payer identity — a third-party payer
    // is a different participant, so matching on identity silently loses their attribution.
    const pay = dataset.payments.find((x) => x.asserted_for_pool_entry_id === e.pool_entry_id);
    const out = {
      id: e.pool_entry_id,
      entryName: p?.display_name ?? null,
      participantEmail: p?.email ?? null,
      picks: e.picks ?? null,
      createdAt: e.created_at ?? null,
      updatedAt: e.updated_at ?? null,
    };
    if (pay?.payer_name_as_recorded) out.payerName = pay.payer_name_as_recorded;
    if (pay?.method) out.paymentMethod = pay.method;
    return out;
  });
  const doc = { entries };
  if (dataset.match_results.length) {
    doc.results = Object.fromEntries(dataset.match_results.map((r) => [r.match_id, r.raw]));
  }
  if (dataset.audit_events.length) {
    doc.auditLog = dataset.audit_events.map((a) => ({ ts: a.occurred_at, action: a.action, admin: a.actor_role === "admin" }));
  }
  if (dataset.sync_state.length) doc.lastSync = dataset.sync_state[0].last_success_at;
  return doc;
}

/** Compare original vs recomposed, classifying each difference as AUTHORISED or a DEFECT. */
export function roundTrip(state, dataset) {
  const back = recompose(dataset);
  const diffs = [];
  const walk = (a, b, path) => {
    const rootKey = path.split(/[.[]/)[0];
    const aIsObj = a && typeof a === "object", bIsObj = b && typeof b === "object";
    if (!aIsObj && !bIsObj) {
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ path, rootKey, kind: "value" });
      return;
    }
    if (Array.isArray(a) !== Array.isArray(b) || (!aIsObj || !bIsObj)) {
      diffs.push({ path, rootKey, kind: "shape" });
      return;
    }
    if (Array.isArray(a)) {
      if (a.length !== b.length) { diffs.push({ path, rootKey, kind: "length" }); return; }
      a.forEach((_, i) => walk(a[i], b[i], `${path}[${i}]`));
      return;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in a)) { diffs.push({ path: p, rootKey: path ? rootKey : k, kind: "added" }); continue; }
      if (!(k in b)) { diffs.push({ path: p, rootKey: path ? rootKey : k, kind: "dropped" }); continue; }
      walk(a[k], b[k], p);
    }
  };
  walk(state, back, "");

  const generic = (p) => p.replace(/\[\d+\]/g, "[]");

  /**
   * An EMPTY container is equivalent however it is spelled.
   *
   * `recompose` emits `auditLog` and `results` only when it has something to put in them, so a document
   * whose `auditLog` is `[]` round-tripped to a document with no `auditLog` key at all — reported as
   * "dropped". A property test caught it. The three spellings (absent, `[]`/`{}`, `null`) all mean the same
   * thing here, and br2026 genuinely stores `results: null` while copa2026 stores an object, so treating
   * them as different would flag a difference between two correct representations of nothing.
   *
   * This is declared rather than silently tolerated, and it is narrow: it applies only when BOTH sides are
   * empty. A container that gained or lost CONTENT is still a difference.
   */
  const CONTAINER_KEYS = new Set(["auditLog", "results", "entries", "deletedIds", "paid"]);
  const isEmptyContainer = (v) =>
    v === undefined || v === null
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
  const bothEmptyContainer = (d) => {
    if (d.path.includes(".") || d.path.includes("[")) return false;   // top-level keys only
    if (!CONTAINER_KEYS.has(d.path)) return false;
    return isEmptyContainer(state[d.path]) && isEmptyContainer(back[d.path]);
  };

  const unauthorised = diffs.filter((d) =>
    !authorised(d.rootKey) && !authorised(generic(d.path)) && !bothEmptyContainer(d));
  return { diffs, unauthorised, recomposed: back };
}

// ─────────────────────────────────────────────────────────────────────────────
export function runParity(state, opts) {
  const dataset = decompose(state, opts);
  const cov = coverage(state);
  const inv = PARITY_INVARIANTS.map((r) => {
    let findings = [], error = null;
    try { findings = r.check(state, dataset) || []; } catch (e) { error = e.message; }
    return { id: r.id, title: r.title, status: error ? "ERROR" : findings.length ? "FAIL" : "PASS", findings, error };
  });
  const rt = roundTrip(state, dataset);
  const failed = inv.filter((r) => r.status !== "PASS");
  return {
    dataset, coverage: cov, invariants: inv, roundTrip: rt,
    verdict: (failed.length || cov.unaccounted.length || rt.unauthorised.length) ? "FAIL" : "PASS",
  };
}

// Run-as-main detection by exact module URL. `endsWith("x.mjs")` is wrong: "test_x.mjs"
// also ends with "x.mjs", so importing this module from its own test suite would execute the CLI.
const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const f = argv.find((a) => a.startsWith("--state="));
  if (!f) { console.error("usage: json_parity.mjs --state=<synthetic_state.json>"); process.exit(2); }
  const state = JSON.parse(readFileSync(f.slice("--state=".length), "utf8"));
  const r = runParity(state, { poolId: "pool-x", editionId: "ed-1", expectedFee: parseMoney("5.00", "USD") });
  if (argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(r.verdict === "PASS" ? 0 : 1); }
  console.log(`\nJSON→relational parity\n`);
  console.log(`  coverage: ${r.coverage.observed.length} paths observed, ${r.coverage.unaccounted.length} unaccounted`);
  for (const p of r.coverage.unaccounted) console.log(`      ✗ no disposition for "${p}"`);
  for (const i of r.invariants) {
    console.log(`  ${i.status === "PASS" ? "✓" : "✗"} ${i.id} ${i.title}`);
    for (const x of i.findings) console.log(`        ${x}`);
  }
  console.log(`  round-trip: ${r.roundTrip.diffs.length} difference(s), ${r.roundTrip.unauthorised.length} unauthorised`);
  for (const d of r.roundTrip.unauthorised) console.log(`      ✗ ${d.kind} at ${d.path}`);
  console.log(`\n  verdict: ${r.verdict}\n`);
  process.exit(r.verdict === "PASS" ? 0 : 1);
}
