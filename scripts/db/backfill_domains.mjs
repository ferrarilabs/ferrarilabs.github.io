#!/usr/bin/env node
/**
 * Backfill domain definitions (Workstream 6C).
 *
 * One declaration per domain, each naming its own reconciliation and its own accepted exclusions. Nothing
 * here connects to a database: `read` takes a synthetic legacy document, `write` goes to an in-memory store.
 *
 * WS7.11 — TRANSFORMATION MOVED OUT.
 * These domains previously did their own interpretation inline, which meant two modules could disagree about
 * what a legacy field means with nothing to notice. Transformation now lives in `transformers.mjs`; a domain
 * READS the transformer's already-normalised records and the framework writes them. The domain's remaining
 * jobs are extraction, per-row validation and reconciliation.
 *
 * The transformer's findings are carried through: a FATAL from a money-bearing transformer means the domain
 * yields no rows at all, so the backfill cannot commit money it could not interpret.
 *
 * THE OUTBOX DOMAIN IS DELIBERATELY ABSENT, and that is the interesting decision.
 * The brief asked for it to be challenged, so: there is no historical outbox to backfill. The outbox records
 * INTENT TO NOTIFY. Legacy `bolao_state` holds no record of which emails were owed, attempted, delivered or
 * lost — only, at best, that an entry was marked paid. Manufacturing outbox rows from that would fabricate
 * delivery history, and worse, a replay of those fabricated rows would email real participants about things
 * that happened months ago. The outbox therefore starts EMPTY at M9 and accrues only real intent from M11
 * onward. `OUTBOX_BACKFILL_DECISION` below records this so it is not silently re-litigated.
 */

import { defineDomain } from "./backfill.mjs";
import { parseMoney } from "./financial.mjs";
import { transformAll } from "./transformers.mjs";

const USD = "USD";
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Source registry.
 *
 * Domains are frozen — `defineDomain` returns Object.freeze — so their readers cannot carry mutable state.
 * That is correct: a domain is a declaration. Synthetic sources therefore live in a registry the readers
 * consult, which also means production wiring replaces the registry rather than editing the domains.
 */
const SOURCES = new Map();
const CONFIG = new Map();
/** Cached transformer results for the currently bound legacy document. */
let TRANSFORMED = null;
let TRANSFORM_FINDINGS = [];

export const getSource = (name) => SOURCES.get(name) || [];
export const getConfig = (key) => CONFIG.get(key);

/**
 * Records for a domain, taken from the transformer that owns that interpretation.
 *
 * If the transformer reported a FATAL, this returns NOTHING. That is the WS7.11 contract: a money-bearing
 * backfill must not commit rows derived from a transformation that could not be completed, so an
 * uninterpretable source produces an empty read rather than a partial one.
 */
export function transformedRecords(transformerName) {
  if (!TRANSFORMED) return [];
  const r = TRANSFORMED.results[transformerName];
  if (!r) return [];
  if (!r.ok) return [];
  return r.records;
}

/** Findings from the last transform, so a caller can propagate warnings/unknowns/conflicts. */
export function transformFindings() { return TRANSFORM_FINDINGS; }
export function transformResult(name) { return TRANSFORMED ? TRANSFORMED.results[name] : null; }

export const OUTBOX_BACKFILL_DECISION = Object.freeze({
  decision: "NO_HISTORICAL_BACKFILL",
  why: "the outbox records intent to notify. The legacy document holds no record of which notifications were " +
       "owed, attempted, delivered or lost, so any row created would be invented delivery history.",
  harmIfIgnored: "a replay of fabricated events would email real participants about months-old events",
  alternative: "the outbox starts empty at M9 and accrues real intent from M11 (write-through) onward",
});

/**
 * participants — reads transformParticipants. ZERO merges (OC-6).
 *
 * `validateRow` is retained and is NOT redundant with the transformer: the transformer decides meaning, this
 * decides admissibility at write time. A row that is meaningful but inadmissible must still be caught here.
 */
export const participantsDomain = defineDomain({
  name: "participants", phase: "M2", moneyBearing: false,
  read: () => transformedRecords("transformParticipants"),
  keyOf: (r) => r.identity_key,
  transform: (r) => ({
    identity_key: r.identity_key,
    display_name: r.display_name ?? null,
    email: r.email ?? null,
    state: "active",
    canonical_participant_id: null,
  }),
  validateRow: (out) => {
    const p = [];
    if (!out.identity_key) p.push("no identity key");
    if (!out.display_name && !out.email) p.push("neither a display name nor an email — the row identifies nobody");
    if (out.canonical_participant_id) p.push("a backfilled participant must never arrive already merged");
    return p;
  },
  reconcile: ({ targetRows }) => {
    const findings = [];
    const merged = targetRows.filter((t) => t.row.canonical_participant_id);
    if (merged.length) findings.push(`${merged.length} backfilled participant(s) arrived merged — the identity backfill must produce ZERO merges`);
    return findings;
  },
});

/** participant_identity_links — nothing to backfill: no legacy merge history exists. */
export const identityLinksDomain = defineDomain({
  name: "participant_identity_links", phase: "M2", moneyBearing: false,
  read: () => [],
  keyOf: (r) => r.link_id,
  transform: (r) => r,
  reconcile: ({ targetRows }) => targetRows.length
    ? ["identity links were created by a backfill; merges are operator-confirmed only (M17), never migrated"]
    : [],
});

export const competitionEditionsDomain = defineDomain({
  name: "competition_editions", phase: "M3", moneyBearing: false,
  read: () => transformedRecords("transformCompetitionEditions"),
  keyOf: (r) => r.competition_edition_id,
  transform: (r) => ({ ...r }),
  validateRow: (out) => (out.competition_id ? [] : ["edition with no competition"]),
});

export const poolsDomain = defineDomain({
  name: "pools", phase: "M4", moneyBearing: false,
  read: () => transformedRecords("transformPools"),
  keyOf: (r) => r.pool_id,
  transform: (r) => ({ ...r }),
  validateRow: (out) => (out.competition_edition_id ? [] : ["pool with no edition"]),
});

/** pool_entries — reads transformPoolEntries, which owns the fee rule and the tombstone rule. */
export const entriesDomain = defineDomain({
  name: "pool_entries", phase: "M4", moneyBearing: false,
  read: () => transformedRecords("transformPoolEntries"),
  keyOf: (r) => r.pool_entry_id,
  transform: (r) => ({ ...r }),
  validateRow: (out) => {
    const p = [];
    if (!out.pool_entry_id) p.push("no entry id");
    if (!out.identity_key) p.push("entry resolves to no participant");
    if (!String(out.entry_label || "").trim()) p.push("blank entry label — a deliberate second entry becomes indistinguishable from a duplicate");
    if (!out.expected_fee_currency) p.push("no fee currency");
    // KPLUS-F015: the fee reached the database in minor units and nothing objected, because this
    // validator only ever asked whether a currency was PRESENT. A magnitude with no stated unit is not
    // checkable, so the unit is made part of the contract: an exact decimal in MAJOR units, which is
    // what numeric(14,2) means. `500` and `500.00` are both rejected here for a 5.00 fee — the first
    // because a bare integer is the minor-unit representation, the second because it is a hundredfold.
    if (!/^\d+\.\d{2}$/.test(String(out.expected_fee_amount))) {
      p.push(`expected_fee_amount ${JSON.stringify(out.expected_fee_amount)} is not an exact major-unit decimal ` +
             `(numeric(14,2)); a minor-unit integer here overstates every entry's obligation a hundredfold`);
    }
    return p;
  },
  reconcile: ({ source, targetRows }) => {
    const findings = [];
    if (targetRows.length !== source.length) findings.push(`entry count ${targetRows.length} != transformed ${source.length}`);
    return findings;
  },
});

/**
 * payments — MONEY-BEARING. Reads transformPayments, which owns the "never invent an amount" rule.
 *
 * A FATAL from the transformer (an uncharacterised source version, a paid map of the wrong shape) yields no
 * records, so this domain writes nothing rather than writing a partial set of money rows.
 */
export const paymentsDomain = defineDomain({
  name: "payments", phase: "M5", moneyBearing: true,
  read: () => transformedRecords("transformPayments"),
  keyOf: (r) => r.payment_id,
  transform: (r) => ({ ...r }),
  validateRow: (out) => {
    const p = [];
    if (out.amount !== null) p.push("a legacy assertion gained an amount — money was invented");
    if (out.currency !== null) p.push("a legacy assertion gained a currency without an amount");
    if (!out.asserted_for_pool_entry_id) p.push("asserted payment not traceable to an entry");
    return p;
  },
  reconcile: ({ source, targetRows }) => {
    const findings = [];
    if (targetRows.length !== source.length) findings.push(`payment count ${targetRows.length} != transformed ${source.length}`);
    for (const t of targetRows) if (t.row.amount !== null) findings.push(`payment ${t.key} has an amount; legacy assertions must have none`);
    return findings;
  },
});

/** payment_allocations — MONEY-BEARING and deliberately EMPTY: an allocation implies an amount. */
export const allocationsDomain = defineDomain({
  name: "payment_allocations", phase: "M5", moneyBearing: true,
  read: () => [],
  keyOf: (r) => r.allocation_id,
  transform: (r) => r,
  reconcile: ({ targetRows }) => targetRows.length
    ? [`${targetRows.length} allocation(s) were fabricated from legacy paid flags — an allocation implies an amount, and the flags carried none`]
    : [],
});

export const matchesDomain = defineDomain({
  name: "matches", phase: "M6", moneyBearing: false,
  read: () => transformedRecords("transformMatches"),
  keyOf: (r) => r.match_id,
  transform: (r) => ({ ...r }),
  validateRow: (out) => (out.competition_edition_phase_id ? [] : ["match with no phase — no cutoff would apply to it"]),
});

export const tiesDomain = defineDomain({
  name: "ties", phase: "M6", moneyBearing: false,
  read: () => transformedRecords("transformTies"),
  keyOf: (r) => r.tie_id,
  transform: (r) => ({ ...r }),
});

/** match_results — reads transformMatchResults, which refuses incomplete results rather than defaulting them. */
export const resultsDomain = defineDomain({
  name: "match_results", phase: "M7", moneyBearing: false,
  read: () => transformedRecords("transformMatchResults"),
  keyOf: (r) => r.match_result_id,
  transform: (r) => ({ ...r }),
  validateRow: (out) => (Number.isInteger(out.home_goals) && Number.isInteger(out.away_goals)
    ? [] : ["a result must have integer goals on both sides"]),
});

/**
 * predictions — deliberately NOT backfilled at M7.
 * picks stay in pool_entries.picks jsonb until M16 because decomposing them changes the scoring input path,
 * and that change is gated on the scoring parity contract.
 */
export const predictionsDomain = defineDomain({
  name: "predictions", phase: "M7", moneyBearing: false,
  read: () => [],
  keyOf: (r) => r.prediction_id,
  transform: (r) => r,
  reconcile: ({ targetRows }) => targetRows.length
    ? ["predictions were backfilled at M7; picks must remain in jsonb until M16, when scoring parity gates the change"]
    : [],
});

/** audit_events — reads transformAuditMetadata, which drops legacy free text per B1/ADR-008. */
export const auditDomain = defineDomain({
  name: "audit_events", phase: "M8", moneyBearing: false,
  read: () => transformedRecords("transformAuditMetadata"),
  keyOf: (r) => r.audit_event_id,
  transform: (r) => ({ ...r }),
  validateRow: (out) => {
    const errs = [];
    if (Object.keys(out.safe_metadata || {}).length !== 0) {
      errs.push("safe_metadata is non-empty; legacy free text must not be carried");
    }
    // KPLUS-F025. The same rule `audit.audit_events.ae_action_shape` enforces, checked here too, so a
    // malformed action is a named domain validation failure rather than a raw CHECK violation halting a
    // batch — and so the rule is testable without a database.
    if (!/^[a-z_]+\.[a-z_]+$/.test(String(out.action ?? ""))) {
      errs.push("action does not match the target vocabulary shape aggregate.past_tense");
    }
    return errs;
  },
});

export const syncStateDomain = defineDomain({
  name: "sync_state", phase: "M6", moneyBearing: false,
  read: () => transformedRecords("transformSyncState"),
  keyOf: (r) => r.sync_state_id,
  transform: (r) => ({ ...r }),
});

export const ALL_DOMAINS = [
  participantsDomain, identityLinksDomain, competitionEditionsDomain, poolsDomain, entriesDomain,
  paymentsDomain, allocationsDomain, matchesDomain, tiesDomain, resultsDomain, predictionsDomain,
  auditDomain, syncStateDomain,
];

/**
 * Bind a synthetic legacy document to the source registry.
 *
 * Test-and-rehearsal wiring only. Production would populate the same registry from real readers, which is
 * why the domains consult a registry rather than closing over data: the domain declarations do not change.
 */
export function bindSyntheticSource(doc, {
  poolId = "pool-x", editionId = "ed-1", expectedFee = parseMoney("5.00", USD),
  sourceVersion = "v4-copa", phases = null, matches = null, ties = null, competitions = null, editions = null,
} = {}) {
  CONFIG.set("poolId", poolId);
  CONFIG.set("editionId", editionId);
  CONFIG.set("expectedFee", expectedFee);
  CONFIG.set("sourceVersion", sourceVersion);

  const ctx = {
    sourceVersion, poolId, editionId, expectedFee,
    competitions: competitions || [{ competition_id: "c-1", slug: "c", name: "Competition" }],
    editions: editions || [{ competition_edition_id: editionId, competition_id: "c-1", season_label: "2026", status: "concluded" }],
    phases: phases || [{ competition_edition_phase_id: `${editionId}-ph-1`, competition_edition_id: editionId, slug: "ph1", ordinal: 1, cutoff_at: "2026-06-05T00:00:00Z" }],
    pools: [{ pool_id: poolId, competition_edition_id: editionId, slug: "pool", name: "Pool", status: "closed" }],
    matches, ties,
    defaultPhaseId: `${editionId}-ph-1`,
    phaseByMatch: {},
  };

  // ONE transform pass feeds every domain, so no two domains can interpret the document differently.
  TRANSFORMED = transformAll(doc, ctx);
  TRANSFORM_FINDINGS = TRANSFORMED.findings;
  return { poolId, editionId, expectedFee, sourceVersion, transformed: TRANSFORMED };
}

/** Clear the registry, so one test's binding cannot leak into another's. */
export function resetSyntheticSource() { SOURCES.clear(); CONFIG.clear(); TRANSFORMED = null; TRANSFORM_FINDINGS = []; }
