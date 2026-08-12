#!/usr/bin/env node
/**
 * WS10.3 / WS10.8 — executable SQL prototypes for all 17 reports in model/reports.json.
 *
 * These are real queries that really run (node:sqlite, see report_fixtures.mjs). model/reports.json
 * stays the source of truth for each report's business question, grain, dimensions, measures, joins,
 * filters, PII class, index dependencies and materialization; this file adds the three things it did
 * not carry — ORDERING, USAGE CLASS and SECURITY SURFACE — plus the query itself.
 *
 * A drift checker asserts that every report in the model has a prototype here and vice versa, so the
 * two cannot diverge silently.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * CONVENTIONS THAT APPLY TO EVERY QUERY
 *
 * · Money is INTEGER minor units. No query performs division on money, so no query can round.
 * · `expected_fee_minor IS NULL` means the fee was never recorded. It is never coalesced to 0:
 *   settlement for such an entry is UNKNOWN, and calling it `unpaid` would invent a fee.
 * · Canonical identity is resolved through `canonical_participant_id` wherever a report is BY
 *   participant, so a superseded id returns the surviving identity's history and a merged pair is
 *   never counted twice.
 * · `deleted_at IS NULL` on pool_entries wherever the spec says so.
 * · Grain is asserted by the test suite, not just declared: every report has a test that its output
 *   has exactly one row per the claimed key.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPORTS_MODEL_PATH = join(ROOT, "model", "reports.json");
export function loadReportsModel() { return JSON.parse(readFileSync(REPORTS_MODEL_PATH, "utf8")); }

/**
 * WS10.8 — who may see the result surface.
 *
 * PUBLIC_SAFE       — no PII, no money; safe for an unauthenticated reader
 * AUTHENTICATED_OWNER — the reader's own rows only, resolved through participant_auth_links
 * TRUSTED_RUNTIME   — the service computes it; no client sees the raw result
 * OPERATOR_ONLY     — an operator with a real reason
 */
export const SURFACE = {
  PUBLIC_SAFE: "PUBLIC_SAFE",
  AUTHENTICATED_OWNER: "AUTHENTICATED_OWNER",
  TRUSTED_RUNTIME: "TRUSTED_RUNTIME",
  OPERATOR_ONLY: "OPERATOR_ONLY",
};

export const USAGE = {
  INTERACTIVE: "INTERACTIVE",     // a person waiting on a page
  OPERATIONAL: "OPERATIONAL",     // an operator screen or a periodic job
  BATCH: "BATCH",                 // reconciliation, exports, evidence production
  MONITORING: "MONITORING",       // polled frequently by a machine
};

/**
 * Canonical identity resolution, reused by every by-participant report.
 * A participant with no link resolves to itself; a merged one resolves to its survivor.
 */
const CANON = `
  canon AS (
    SELECT p.participant_id AS raw_id,
           COALESCE(p.canonical_participant_id, p.participant_id) AS canonical_id
    FROM participants p
  )`;

/** Effective allocation per entry, refunds included via their own negative allocation rows. */
const ALLOC = `
  alloc AS (
    SELECT a.pool_entry_id, a.currency, SUM(a.amount_minor) AS allocated_minor
    FROM payment_allocations a GROUP BY a.pool_entry_id, a.currency
  )`;

/**
 * Derived settlement. UNKNOWN comes FIRST so an entry with no recorded fee can never fall through
 * into unpaid — the ordering of these CASE branches is the whole control.
 */
const SETTLEMENT_CASE = `
  CASE
    WHEN e.expected_fee_minor IS NULL THEN 'unknown'
    WHEN e.legacy_asserted = 1 THEN 'legacy_asserted'
    WHEN COALESCE(al.allocated_minor, 0) = 0 THEN 'unpaid'
    WHEN COALESCE(al.allocated_minor, 0) < e.expected_fee_minor THEN 'partially_paid'
    WHEN COALESCE(al.allocated_minor, 0) = e.expected_fee_minor THEN 'settled'
    ELSE 'overpaid'
  END`;

const ENTRY_BASE = `
  entry_base AS (
    SELECT e.pool_entry_id, e.pool_id, e.entry_label, e.currency, e.expected_fee_minor,
           e.legacy_asserted, e.created_at,
           c.canonical_id AS participant_id,
           COALESCE(al.allocated_minor, 0) AS allocated_minor,
           ${SETTLEMENT_CASE} AS settlement
    FROM pool_entries e
    JOIN canon c ON c.raw_id = e.participant_id
    LEFT JOIN alloc al ON al.pool_entry_id = e.pool_entry_id
    WHERE e.deleted_at IS NULL
  )`;

const WITH_BASE = `WITH ${CANON}, ${ALLOC}, ${ENTRY_BASE}`;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The 17 prototypes
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const PROTOTYPES = {
  "R-01": {
    name: "participant_history",
    grainKey: ["participant_id", "pool_entry_id", "currency"],
    ordering: "created_at DESC, pool_entry_id",
    usageClass: USAGE.INTERACTIVE,
    surface: SURFACE.AUTHENTICATED_OWNER,
    surfaceWhy: "a participant may see their own history; the operator view is the same query without the owner filter. It carries CONTACT PII, so it is never PUBLIC_SAFE.",
    params: ["participant_id"],
    sql: `${WITH_BASE},
      won AS (SELECT pool_entry_id, currency, SUM(amount_minor) AS won_minor FROM prize_allocations GROUP BY pool_entry_id, currency)
      SELECT b.participant_id, p.display_name, ce.competition_id, po.competition_edition_id,
             b.pool_id, b.pool_entry_id, b.entry_label, b.created_at, b.currency,
             b.expected_fee_minor AS total_expected_fee_minor,
             b.allocated_minor AS total_allocated_minor,
             COALESCE(w.won_minor, 0) AS total_won_minor,
             b.settlement
      FROM entry_base b
      JOIN participants p ON p.participant_id = b.participant_id
      JOIN pools po ON po.pool_id = b.pool_id
      JOIN competition_editions ce ON ce.competition_edition_id = po.competition_edition_id
      LEFT JOIN won w ON w.pool_entry_id = b.pool_entry_id AND w.currency = b.currency
      WHERE b.participant_id = :participant_id
      ORDER BY b.created_at DESC, b.pool_entry_id`,
  },

  "R-02": {
    name: "pool_participation",
    grainKey: ["pool_id", "currency"],
    ordering: "pool_id",
    usageClass: USAGE.INTERACTIVE,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "aggregate counts are harmless, but the same query is the operator's roster view; the participant-facing variant must select no email column at all rather than rely on a policy to hide it",
    params: [],
    sql: `${WITH_BASE}
      SELECT b.pool_id, po.name AS pool_name, b.currency,
             COUNT(*) AS entry_count,
             COUNT(DISTINCT b.participant_id) AS participant_count,
             SUM(CASE WHEN b.settlement = 'settled' THEN 1 ELSE 0 END) AS settled_count,
             SUM(CASE WHEN b.settlement = 'unknown' THEN 1 ELSE 0 END) AS unknown_fee_count
      FROM entry_base b JOIN pools po ON po.pool_id = b.pool_id
      GROUP BY b.pool_id, po.name, b.currency
      ORDER BY b.pool_id`,
  },

  "R-03": {
    name: "competition_history",
    grainKey: ["competition_id", "competition_edition_id"],
    ordering: "competition_id, season_year DESC",
    usageClass: USAGE.INTERACTIVE,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "the model declares collected_total and prizes_awarded_total, so this report carries money and its rlsRoles is operator. A public competition-history view is possible but is a DIFFERENT query without the monetary measures.",
    params: [],
    // The monetary measures are aggregated in SEPARATE CTEs rather than in the same GROUP BY as the
    // entry count. Summing an allocation across a join that has already fanned out by entry would
    // multiply each payment by the number of entries in the edition — the classic double-count, and
    // the reason R-03 needs three scans instead of one.
    sql: `${WITH_BASE},
      coll AS (
        SELECT po.competition_edition_id, SUM(b.allocated_minor) AS collected_minor
        FROM entry_base b JOIN pools po ON po.pool_id = b.pool_id
        GROUP BY po.competition_edition_id
      ),
      pz AS (
        SELECT po.competition_edition_id, SUM(z.amount_minor) AS prizes_minor
        FROM prize_allocations z JOIN pools po ON po.pool_id = z.pool_id
        GROUP BY po.competition_edition_id
      ),
      ent AS (
        SELECT po.competition_edition_id,
               COUNT(b.pool_entry_id) AS entry_count,
               COUNT(DISTINCT b.participant_id) AS distinct_participant_count,
               COUNT(DISTINCT b.pool_id) AS pool_count
        FROM entry_base b JOIN pools po ON po.pool_id = b.pool_id
        GROUP BY po.competition_edition_id
      )
      SELECT c.competition_id, c.name AS competition_name, ce.competition_edition_id, ce.season_year,
             COALESCE(ent.pool_count, 0) AS pool_count,
             COALESCE(ent.entry_count, 0) AS entry_count,
             COALESCE(ent.distinct_participant_count, 0) AS distinct_participant_count,
             COALESCE(coll.collected_minor, 0) AS collected_total_minor,
             COALESCE(pz.prizes_minor, 0) AS prizes_awarded_total_minor
      FROM competitions c
      JOIN competition_editions ce ON ce.competition_id = c.competition_id
      LEFT JOIN ent ON ent.competition_edition_id = ce.competition_edition_id
      LEFT JOIN coll ON coll.competition_edition_id = ce.competition_edition_id
      LEFT JOIN pz ON pz.competition_edition_id = ce.competition_edition_id
      ORDER BY c.competition_id, ce.season_year DESC`,
  },

  "R-04": {
    name: "multiple_entries",
    grainKey: ["participant_id", "pool_id"],
    ordering: "entry_count DESC, participant_id",
    usageClass: USAGE.OPERATIONAL,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "identifies participants by name; used to check whether multiple entries were intended or are a duplicate identity",
    params: [],
    sql: `${WITH_BASE}
      SELECT b.participant_id, p.display_name, b.pool_id, COUNT(*) AS entry_count,
             GROUP_CONCAT(b.entry_label, ' | ') AS labels
      FROM entry_base b JOIN participants p ON p.participant_id = b.participant_id
      GROUP BY b.participant_id, p.display_name, b.pool_id
      HAVING COUNT(*) > 1
      ORDER BY entry_count DESC, b.participant_id`,
  },

  "R-05": {
    name: "payment_history",
    grainKey: ["payment_id"],
    ordering: "paid_at DESC, payment_id",
    usageClass: USAGE.OPERATIONAL,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "carries external_reference, which is a real payment reference. It must never reach a browser, and the AUTHENTICATED_OWNER variant must project a redacted reference rather than the raw one (WS12-OP-1).",
    params: [],
    redactedColumns: ["external_reference"],
    sql: `WITH ${CANON}
      SELECT y.payment_id, COALESCE(c.canonical_id, y.payer_participant_id) AS payer_participant_id,
             p.display_name AS payer_name, y.amount_minor, y.currency, y.kind,
             y.reverses_payment_id, y.paid_at,
             CASE WHEN y.external_reference IS NULL THEN NULL ELSE 'REDACTED' END AS external_reference_redacted,
             (SELECT COALESCE(SUM(a.amount_minor),0) FROM payment_allocations a WHERE a.payment_id = y.payment_id) AS allocated_minor,
             y.amount_minor - (SELECT COALESCE(SUM(a.amount_minor),0) FROM payment_allocations a WHERE a.payment_id = y.payment_id) AS unapplied_minor
      FROM payments y
      LEFT JOIN canon c ON c.raw_id = y.payer_participant_id
      LEFT JOIN participants p ON p.participant_id = COALESCE(c.canonical_id, y.payer_participant_id)
      ORDER BY y.paid_at DESC, y.payment_id`,
  },

  "R-06": {
    name: "payment_allocations",
    grainKey: ["payment_allocation_id"],
    ordering: "allocated_at, payment_allocation_id",
    usageClass: USAGE.OPERATIONAL,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "raw internal allocation metadata stays protected per WS12-OP-1",
    params: [],
    sql: `WITH ${CANON}
      SELECT a.payment_allocation_id, a.payment_id, a.pool_entry_id, e.pool_id,
             c.canonical_id AS participant_id, a.amount_minor, a.currency, a.allocated_at,
             y.kind AS payment_kind
      FROM payment_allocations a
      JOIN pool_entries e ON e.pool_entry_id = a.pool_entry_id
      JOIN canon c ON c.raw_id = e.participant_id
      JOIN payments y ON y.payment_id = a.payment_id
      ORDER BY a.allocated_at, a.payment_allocation_id`,
  },

  "R-07": {
    name: "unpaid_balances",
    grainKey: ["pool_entry_id"],
    ordering: "pool_id, pool_entry_id",
    usageClass: USAGE.OPERATIONAL,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "the point of the report is to contact people who owe money, so it carries email by design",
    params: [],
    sql: `${WITH_BASE}
      SELECT b.pool_id, b.pool_entry_id, b.participant_id, p.display_name, p.email, b.currency,
             b.expected_fee_minor, (b.expected_fee_minor - b.allocated_minor) AS outstanding_minor
      FROM entry_base b JOIN participants p ON p.participant_id = b.participant_id
      WHERE b.settlement = 'unpaid'
      ORDER BY b.pool_id, b.pool_entry_id`,
  },

  "R-08": {
    name: "partial_balances",
    grainKey: ["pool_entry_id"],
    ordering: "pool_id, pool_entry_id",
    usageClass: USAGE.OPERATIONAL,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "shows who has paid part of a fee, naming them by display name and amount. The model declares display_name and NOT email for this report, so no address is projected: chasing a partial payment goes through the operator UI, which can look the address up separately.",
    params: [],
    sql: `${WITH_BASE}
      SELECT b.pool_id, b.pool_entry_id, b.participant_id, p.display_name, b.currency,
             b.expected_fee_minor, b.allocated_minor,
             (b.expected_fee_minor - b.allocated_minor) AS outstanding_minor
      FROM entry_base b JOIN participants p ON p.participant_id = b.participant_id
      WHERE b.settlement = 'partially_paid'
      ORDER BY b.pool_id, b.pool_entry_id`,
  },

  "R-09": {
    name: "overpayments",
    grainKey: ["pool_entry_id"],
    ordering: "pool_id, pool_entry_id",
    usageClass: USAGE.OPERATIONAL,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "an overpayment is money owed back, so it is FINANCIAL. The model declares payment_id and display_name and NOT email, so no address is projected — returning money is an operator action taken through a UI that resolves contact detail on its own.",
    params: [],
    sql: `${WITH_BASE},
      paid_by AS (
        SELECT a.pool_entry_id, MIN(a.payment_id) AS payment_id
        FROM payment_allocations a GROUP BY a.pool_entry_id
      )
      SELECT b.pool_id, b.pool_entry_id, pb.payment_id, b.participant_id, p.display_name, b.currency,
             b.expected_fee_minor, b.allocated_minor,
             (b.allocated_minor - b.expected_fee_minor) AS overpaid_minor
      FROM entry_base b
      JOIN participants p ON p.participant_id = b.participant_id
      LEFT JOIN paid_by pb ON pb.pool_entry_id = b.pool_entry_id
      WHERE b.settlement = 'overpaid'
      ORDER BY b.pool_id, b.pool_entry_id`,
  },

  "R-10": {
    name: "prizes_and_winnings",
    grainKey: ["prize_allocation_id"],
    ordering: "pool_id, rank",
    usageClass: USAGE.INTERACTIVE,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "who won how much is money attributed to a named person. A PUBLIC_SAFE podium exists, but it is a DIFFERENT query projecting rank and display name without amounts — not this one with a policy over it.",
    params: [],
    sql: `WITH ${CANON}
      SELECT z.prize_allocation_id, z.pool_id, z.rank, z.pool_entry_id,
             COALESCE(c.canonical_id, z.participant_id) AS participant_id,
             p.display_name, z.amount_minor, z.currency, z.declared_at
      FROM prize_allocations z
      LEFT JOIN canon c ON c.raw_id = z.participant_id
      LEFT JOIN participants p ON p.participant_id = COALESCE(c.canonical_id, z.participant_id)
      ORDER BY z.pool_id, z.rank`,
  },

  "R-11": {
    name: "participant_net_position",
    grainKey: ["participant_id", "currency"],
    ordering: "participant_id, currency",
    usageClass: USAGE.OPERATIONAL,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "net position across pools is a financial profile of a person",
    params: [],
    // paid_as_payer counts CONTRIBUTIONS plus reversals, so a refund reduces what the payer paid.
    // Summing only contributions would report a refunded payer as having paid money they got back.
    sql: `WITH ${CANON},
      paid AS (
        SELECT COALESCE(c.canonical_id, y.payer_participant_id) AS participant_id, y.currency,
               SUM(y.amount_minor) AS paid_minor
        FROM payments y LEFT JOIN canon c ON c.raw_id = y.payer_participant_id
        WHERE y.payer_participant_id IS NOT NULL AND y.amount_minor IS NOT NULL
        GROUP BY COALESCE(c.canonical_id, y.payer_participant_id), y.currency
      ),
      won AS (
        SELECT COALESCE(c.canonical_id, z.participant_id) AS participant_id, z.currency,
               SUM(z.amount_minor) AS won_minor
        FROM prize_allocations z LEFT JOIN canon c ON c.raw_id = z.participant_id
        WHERE z.participant_id IS NOT NULL
        GROUP BY COALESCE(c.canonical_id, z.participant_id), z.currency
      )
      SELECT p.participant_id, p.display_name, cur.currency,
             COALESCE(paid.paid_minor, 0) AS paid_minor,
             COALESCE(won.won_minor, 0) AS won_minor,
             COALESCE(won.won_minor, 0) - COALESCE(paid.paid_minor, 0) AS net_minor
      FROM participants p
      JOIN (SELECT DISTINCT currency FROM pools) cur
      LEFT JOIN paid ON paid.participant_id = p.participant_id AND paid.currency = cur.currency
      LEFT JOIN won ON won.participant_id = p.participant_id AND won.currency = cur.currency
      WHERE p.canonical_participant_id IS NULL
        AND (paid.paid_minor IS NOT NULL OR won.won_minor IS NOT NULL)
      ORDER BY p.participant_id, cur.currency`,
  },

  "R-12": {
    name: "competition_performance",
    grainKey: ["pool_entry_id"],
    ordering: "pool_id, exact_hits DESC, pool_entry_id",
    usageClass: USAGE.INTERACTIVE,
    surface: SURFACE.PUBLIC_SAFE,
    surfaceWhy: "prediction accuracy with no money and no contact detail; display name only",
    params: [],
    // Counts prediction accuracy against recorded results. It deliberately does NOT compute a score:
    // scoring is the app's own logic and a SQL reimplementation would be a second source of truth for
    // money. This reports hit counts, which is an observation, not a score.
    sql: `${WITH_BASE}
      SELECT b.pool_id, b.pool_entry_id, p.display_name,
             COUNT(d.prediction_id) AS predictions_made,
             SUM(CASE WHEN r.match_id IS NOT NULL AND d.home_goals = r.home_goals AND d.away_goals = r.away_goals THEN 1 ELSE 0 END) AS exact_hits,
             SUM(CASE WHEN r.match_id IS NULL THEN 1 ELSE 0 END) AS awaiting_result
      FROM entry_base b
      JOIN participants p ON p.participant_id = b.participant_id
      LEFT JOIN predictions d ON d.pool_entry_id = b.pool_entry_id
      LEFT JOIN match_results r ON r.match_id = d.match_id AND r.is_official = 1 AND r.superseded_by_id IS NULL
      GROUP BY b.pool_id, b.pool_entry_id, p.display_name
      ORDER BY b.pool_id, exact_hits DESC, b.pool_entry_id`,
  },

  "R-13": {
    name: "ranking_history",
    grainKey: ["pool_id", "pool_entry_id", "computed_at"],
    ordering: "pool_id, computed_at DESC, position",
    usageClass: USAGE.INTERACTIVE,
    surface: SURFACE.PUBLIC_SAFE,
    surfaceWhy: "positions and points; no money, no contact detail",
    params: [],
    sql: `SELECT s.pool_id, s.computed_at, s.pool_entry_id, e.entry_label, s.position, s.points
      FROM ranking_snapshots s JOIN pool_entries e ON e.pool_entry_id = s.pool_entry_id
      WHERE e.deleted_at IS NULL
      ORDER BY s.pool_id, s.computed_at DESC, s.position`,
  },

  "R-13b": {
    name: "ranking_latest",
    grainKey: ["pool_id", "pool_entry_id"],
    ordering: "pool_id, position",
    usageClass: USAGE.INTERACTIVE,
    surface: SURFACE.PUBLIC_SAFE,
    surfaceWhy: "positions and points at the latest observation only; no money, no contact detail",
    params: [],
    derivedFrom: "R-13",
    // The latest observation per pool only. R-13 returns every snapshot, so anything that aggregates
    // over it without this filter double-counts every entry once per observation - the ranking
    // duplication defect the red team tests for.
    sql: `WITH latest AS (SELECT pool_id, MAX(computed_at) AS computed_at FROM ranking_snapshots GROUP BY pool_id)
      SELECT s.pool_id, s.pool_entry_id, e.entry_label, s.position, s.points, s.computed_at
      FROM ranking_snapshots s
      JOIN latest l ON l.pool_id = s.pool_id AND l.computed_at = s.computed_at
      JOIN pool_entries e ON e.pool_entry_id = s.pool_entry_id
      WHERE e.deleted_at IS NULL
      ORDER BY s.pool_id, s.position`,
  },

  "R-14": {
    name: "year_over_year_participation",
    grainKey: ["competition_id", "season_year"],
    ordering: "competition_id, season_year",
    usageClass: USAGE.BATCH,
    surface: SURFACE.PUBLIC_SAFE,
    surfaceWhy: "counts per season, nobody named",
    params: [],
    // COUNT(DISTINCT canonical participant), not raw participant_id: a participant merged between
    // seasons would otherwise be counted as two people, and the year-over-year trend would show
    // growth that is really a duplicate identity.
    sql: `${WITH_BASE}
      SELECT ce.competition_id, ce.season_year,
             COUNT(DISTINCT b.participant_id) AS distinct_participants,
             COUNT(b.pool_entry_id) AS entry_count
      FROM competition_editions ce
      JOIN pools po ON po.competition_edition_id = ce.competition_edition_id
      JOIN entry_base b ON b.pool_id = po.pool_id
      GROUP BY ce.competition_id, ce.season_year
      ORDER BY ce.competition_id, ce.season_year`,
  },

  "R-15": {
    name: "pool_financial_reconciliation",
    grainKey: ["pool_id", "currency"],
    ordering: "pool_id",
    usageClass: USAGE.BATCH,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "the pool's whole financial position",
    params: [],
    // expected_total sums only entries with a RECORDED fee, and the count of excluded entries is
    // returned alongside. A reader must be able to see that the total is not "everything owed".
    sql: `${WITH_BASE},
      prizes AS (SELECT pool_id, currency, SUM(amount_minor) AS prizes_minor FROM prize_allocations GROUP BY pool_id, currency)
      SELECT b.pool_id, b.currency,
             SUM(CASE WHEN b.expected_fee_minor IS NOT NULL THEN b.expected_fee_minor ELSE 0 END) AS expected_total_minor,
             SUM(b.allocated_minor) AS collected_total_minor,
             SUM(CASE WHEN b.expected_fee_minor IS NOT NULL THEN b.expected_fee_minor ELSE 0 END) - SUM(b.allocated_minor) AS outstanding_total_minor,
             COALESCE(z.prizes_minor, 0) AS prizes_awarded_total_minor,
             SUM(b.allocated_minor) - COALESCE(z.prizes_minor, 0) AS net_cash_position_minor,
             SUM(CASE WHEN b.legacy_asserted = 1 THEN 1 ELSE 0 END) AS legacy_asserted_entry_count,
             SUM(CASE WHEN b.expected_fee_minor IS NULL THEN 1 ELSE 0 END) AS unknown_fee_entry_count
      FROM entry_base b
      LEFT JOIN prizes z ON z.pool_id = b.pool_id AND z.currency = b.currency
      GROUP BY b.pool_id, b.currency, z.prizes_minor
      ORDER BY b.pool_id`,
  },

  "R-16": {
    name: "audit_history",
    grainKey: ["audit_event_id"],
    ordering: "occurred_at, audit_event_id",
    usageClass: USAGE.OPERATIONAL,
    surface: SURFACE.OPERATOR_ONLY,
    surfaceWhy: "the audit trail names actors and subjects. It carries no PII by design — redactable detail lives in the audit_event_details sidecar, which this report deliberately does not join.",
    params: [],
    sql: `SELECT a.audit_event_id, a.occurred_at, a.actor_role, a.actor_user_id, a.action,
             a.aggregate_type, a.aggregate_id, a.correlation_id
      FROM audit_events a
      ORDER BY a.occurred_at, a.audit_event_id`,
  },

  "R-17": {
    name: "operational_health",
    grainKey: ["bucket_kind", "bucket_key"],
    ordering: "bucket_kind, bucket_key",
    usageClass: USAGE.MONITORING,
    surface: SURFACE.TRUSTED_RUNTIME,
    surfaceWhy: "operational counters with no PII and no money; polled by a machine, and exposed to operators through a dashboard rather than directly",
    params: ["now"],
    // One row per sync_state plus one per outbox status bucket, which is the declared grain. A NULL
    // last_success_at yields NULL staleness rather than 0: "never succeeded" is not "fresh", and
    // coalescing it to 0 would report a provider that has never worked as perfectly healthy.
    sql: `SELECT 'sync' AS bucket_kind, s.sync_state_id AS bucket_key, s.provider,
             s.last_success_at,
             CASE WHEN s.last_success_at IS NULL THEN NULL
                  ELSE CAST((julianday(:now) - julianday(s.last_success_at)) * 86400 AS INTEGER) END AS staleness_seconds,
             NULL AS event_count
      FROM sync_state s
      UNION ALL
      SELECT 'outbox' AS bucket_kind, o.status AS bucket_key, NULL AS provider,
             MIN(o.created_at) AS last_success_at, NULL AS staleness_seconds,
             COUNT(*) AS event_count
      FROM outbox_events o GROUP BY o.status
      ORDER BY bucket_kind, bucket_key`,
  },
};

/** Reports in the model that have no prototype here, and vice versa. */
export function checkPrototypeCoverage() {
  const model = loadReportsModel();
  const modelIds = model.reports.map((r) => r.id);
  const protoIds = Object.keys(PROTOTYPES);
  const errors = [];
  for (const id of modelIds) if (!PROTOTYPES[id]) errors.push(`report ${id} in the model has no executable prototype`);
  for (const id of protoIds) {
    // R-13b is an additional projection of R-13, declared as derived rather than as a new report.
    if (PROTOTYPES[id].derivedFrom) continue;
    if (!modelIds.includes(id)) errors.push(`prototype ${id} has no report in the model`);
  }
  for (const r of model.reports) {
    const p = PROTOTYPES[r.id];
    if (!p) continue;
    if (p.name !== r.name) errors.push(`${r.id}: prototype name "${p.name}" does not match the model's "${r.name}"`);
    for (const k of ["ordering", "usageClass", "surface", "surfaceWhy", "sql", "grainKey"]) {
      if (!p[k]) errors.push(`${r.id}: prototype is missing ${k}`);
    }
    if (!Object.values(SURFACE).includes(p.surface)) errors.push(`${r.id}: unknown surface ${p.surface}`);
    if (!Object.values(USAGE).includes(p.usageClass)) errors.push(`${r.id}: unknown usage class ${p.usageClass}`);
    // A FINANCIAL or CONTACT report may never be PUBLIC_SAFE.
    if ((r.piiExposure === "FINANCIAL" || r.piiExposure === "CONTACT") && p.surface === SURFACE.PUBLIC_SAFE) {
      errors.push(`${r.id}: piiExposure is ${r.piiExposure} but the surface is PUBLIC_SAFE`);
    }
    if ((r.monetaryMeasures || []).length && p.surface === SURFACE.PUBLIC_SAFE) {
      errors.push(`${r.id}: has monetary measures but is PUBLIC_SAFE`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function runReport(db, id, params = {}) {
  const p = PROTOTYPES[id];
  if (!p) throw new Error(`unknown report ${id}`);
  const stmt = db.prepare(p.sql);
  const needed = p.params || [];
  const bound = {};
  for (const n of needed) {
    if (params[n] === undefined) throw new Error(`report ${id} requires parameter ${n}`);
    bound[n] = params[n];
  }
  return needed.length ? stmt.all(bound) : stmt.all();
}

export default { PROTOTYPES, runReport, checkPrototypeCoverage, SURFACE, USAGE, loadReportsModel };
