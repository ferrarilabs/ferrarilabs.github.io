#!/usr/bin/env node
/**
 * The PostgreSQL projection of the WS10 reports.
 *
 * WHY THIS IS A SECOND FILE AND NOT AN EDIT TO reports_sql.mjs
 * `reports_sql.mjs` holds prototypes written for the SQLite reference store, and the financial parity
 * gate executes them there. Rewriting them in place would make that gate unrunnable at the exact
 * moment its subject changed — the port would be verified by nothing. So the SQLite prototypes stay
 * untouched and green, this file states the same reports against the target schema, and the two are
 * compared to each other. Financial parity remains an independent executable gate, which is a
 * condition of the authorization this file was written under (KPLUS-OP-3).
 *
 * WHAT THIS PORT IS ALLOWED TO CHANGE, AND WHAT IT IS NOT
 * Authorized: column vocabulary, and SQLite dialect constructs with no PostgreSQL spelling. That is
 * all. Not authorized, and not done anywhere below: any change to payment, allocation, settlement,
 * refund/reversal, prize, gross/net or currency semantics; any new rounding rule; any tolerance
 * introduced to obtain parity; any manufactured value; any approximate numeric type for money.
 *
 * WHAT HAPPENS WHEN THE TARGET DOES NOT ANSWER THE QUESTION
 * Twelve of the seventeen reports depend on a value the target schema does not carry, or on a value
 * it splits in two. Guessing which side to use would be choosing a financial interpretation, so those
 * reports are STOPPED here rather than ported: each carries the class of its ambiguity, the exact
 * operator input that would resolve it, and nothing else. A stopped report has no SQL — it cannot be
 * run, so it cannot quietly return a number nobody authorised. See STOPPED below.
 *
 * Every amount below is the target's exact `numeric(14,2)`. The reference store holds the same money
 * as integer minor units; converting between them is exact for a scale-2 currency and introduces no
 * rounding, but the CONVERSION IS THE PARITY GATE'S JOB, not this file's: nothing here scales
 * anything.
 */
import { loadReportsModel } from "./reports_sql.mjs";

/**
 * Ambiguity classes. Each names a question the SQLite reference store answered implicitly and the
 * target schema does not answer at all — so it is an operator question, not an engineering one.
 */
export const AMBIGUITY = {
  LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE: {
    what: "the settlement cascade branches on a per-entry `legacy_asserted` flag; the target has no such column",
    detail:
      "In the reference store `pool_entries.legacy_asserted` is a column. In the target, being legacy-asserted is a property of a PAYMENT — `payments.amount IS NULL`, the rows migrated from bolao_state's `paid` boolean where no amount ever existed (migration_phases.json M9). Those payments cannot be allocated at all, by the model's own rule that a NULL amount can never be allocated, so no allocation row links such a payment to an entry. Deciding which entry a legacy-asserted payment settles therefore requires choosing a linkage rule, and that rule decides whether an entry reads as settled or unpaid.",
    needs: "the authoritative rule linking a legacy-asserted payment to the entry it settles — or a decision that the settlement cascade's legacy_asserted branch is not reproducible on the target and the reports must say so explicitly",
  },
  PRIZE_AMOUNT_IS_SPLIT_GROSS_AND_NET: {
    what: "the reference store has one prize amount; the target has two",
    detail:
      "`prize_allocations.amount_minor` is a single column in the reference store. The target declares `gross_amount` AND `net_amount`. Every report that sums prizes must pick one, and the choice changes what a winner is reported as having won and what a pool is reported as having paid out.",
    needs: "which of gross_amount or net_amount each prize measure means — and whether the answer differs between the participant-facing measure (R-10 'winnings') and the pool reconciliation total (R-15 'prizes awarded')",
  },
};

/**
 * The vocabulary map, stated once so it is reviewable as a table rather than buried in seventeen
 * rewrites. Left: what the reference store calls it. Right: the target column, verified against the
 * migrated catalog. Nothing on the right was chosen — each is the only column of that meaning.
 */
export const VOCABULARY = [
  ["payments.amount_minor", "payments.amount", "nullable in both; a legacy-asserted payment has no amount in either"],
  ["payment_allocations.amount_minor", "payment_allocations.allocated_amount", "the amount of one payment applied to one entry"],
  ["payment_allocations.payment_allocation_id", "payment_allocations.allocation_id", "surrogate key; renamed in the target, aliased back so the report's declared grain is unchanged"],
  ["pool_entries.expected_fee_minor", "pool_entries.expected_fee_amount", "not used by any ported report — every report that reads it also reads legacy_asserted and is stopped"],
  ["pool_entries.currency", "pool_entries.expected_fee_currency", "same reason"],
  ["julianday(a) - julianday(b)) * 86400", "EXTRACT(EPOCH FROM (a - b))", "identical quantity: SQLite's day difference times 86400 is seconds. Truncation is preserved with trunc(), matching SQLite's CAST(... AS INTEGER)"],
  ["GROUP_CONCAT(x, sep)", "string_agg(x, sep)", "not used by any ported report"],
];

const CANON_PG = `
  canon AS (
    SELECT p.participant_id AS raw_id,
           COALESCE(p.canonical_participant_id, p.participant_id) AS canonical_id
    FROM bolao.participants p
  )`;

export const PG_REPORTS = {
  // ── R-05 ───────────────────────────────────────────────────────────────────────────────────
  // Vocabulary only. The unapplied figure stays `amount - SUM(allocated)`, and stays NULL when the
  // amount is NULL, exactly as in the reference store: a legacy-asserted payment has no amount, so it
  // has no unapplied balance either. Reporting it as fully unapplied would invent a debt.
  "R-05": {
    name: "payment_history",
    grainKey: ["payment_id"],
    params: [],
    sql: `WITH ${CANON_PG}
      SELECT y.payment_id, COALESCE(c.canonical_id, y.payer_participant_id) AS payer_participant_id,
             p.display_name AS payer_name, y.amount, y.currency, y.kind,
             y.reverses_payment_id, y.paid_at,
             CASE WHEN y.external_reference IS NULL THEN NULL ELSE 'REDACTED' END AS external_reference_redacted,
             (SELECT COALESCE(SUM(a.allocated_amount),0) FROM bolao.payment_allocations a WHERE a.payment_id = y.payment_id) AS allocated_amount,
             y.amount - (SELECT COALESCE(SUM(a.allocated_amount),0) FROM bolao.payment_allocations a WHERE a.payment_id = y.payment_id) AS unapplied_amount
      FROM bolao.payments y
      LEFT JOIN canon c ON c.raw_id = y.payer_participant_id
      LEFT JOIN bolao.participants p ON p.participant_id = COALESCE(c.canonical_id, y.payer_participant_id)
      ORDER BY y.paid_at DESC, y.payment_id`,
  },

  // ── R-06 ───────────────────────────────────────────────────────────────────────────────────
  // The surrogate key is `allocation_id` in the target. It is aliased back to the name the report
  // model declares as its grain, so the report's contract is unchanged by a column rename.
  "R-06": {
    name: "payment_allocations",
    grainKey: ["payment_allocation_id"],
    params: [],
    sql: `WITH ${CANON_PG}
      SELECT a.allocation_id AS payment_allocation_id, a.payment_id, a.pool_entry_id, e.pool_id,
             c.canonical_id AS participant_id, a.allocated_amount, a.currency, a.allocated_at,
             y.kind AS payment_kind
      FROM bolao.payment_allocations a
      JOIN bolao.pool_entries e ON e.pool_entry_id = a.pool_entry_id
      JOIN canon c ON c.raw_id = e.participant_id
      JOIN bolao.payments y ON y.payment_id = a.payment_id
      ORDER BY a.allocated_at, a.allocation_id`,
  },

  // ── R-17 ───────────────────────────────────────────────────────────────────────────────────
  // No money anywhere in this report. Two dialect translations:
  //   · julianday arithmetic becomes EXTRACT(EPOCH), the same quantity; trunc() preserves SQLite's
  //     CAST-to-INTEGER truncation rather than introducing rounding;
  //   · `bucket_key` is a uuid in one UNION branch and an enum in the other. SQLite is dynamically
  //     typed and accepted that; PostgreSQL requires one type per column, so both are rendered as
  //     text. That changes the type of an identifier column, never a value.
  "R-17": {
    name: "operational_health",
    grainKey: ["bucket_kind", "bucket_key"],
    params: ["now"],
    sql: `SELECT 'sync' AS bucket_kind, s.sync_state_id::text AS bucket_key, s.provider,
             s.last_success_at,
             CASE WHEN s.last_success_at IS NULL THEN NULL
                  ELSE trunc(EXTRACT(EPOCH FROM (:now - s.last_success_at)))::integer END AS staleness_seconds,
             NULL::bigint AS event_count
      FROM bolao.sync_state s
      UNION ALL
      SELECT 'outbox' AS bucket_kind, o.status::text AS bucket_key, NULL::text AS provider,
             MIN(o.created_at) AS last_success_at, NULL::integer AS staleness_seconds,
             COUNT(*) AS event_count
      FROM bolao.outbox_events o GROUP BY o.status
      ORDER BY bucket_kind, bucket_key`,
  },
};

/**
 * Reports that are NOT ported, and why. A stopped report carries no SQL on purpose: there is no way
 * to run it, so there is no way for it to return a number that rests on an interpretation nobody
 * authorised. `blockedOn` names the operator question, not a preference.
 */
export const STOPPED = {
  "R-01": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE", "PRIZE_AMOUNT_IS_SPLIT_GROSS_AND_NET"],
  "R-02": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE"],
  "R-03": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE", "PRIZE_AMOUNT_IS_SPLIT_GROSS_AND_NET"],
  "R-04": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE"],
  "R-07": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE"],
  "R-08": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE"],
  "R-09": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE"],
  "R-10": ["PRIZE_AMOUNT_IS_SPLIT_GROSS_AND_NET"],
  "R-11": ["PRIZE_AMOUNT_IS_SPLIT_GROSS_AND_NET"],
  "R-12": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE"],
  "R-14": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE"],
  "R-15": ["LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE", "PRIZE_AMOUNT_IS_SPLIT_GROSS_AND_NET"],
};

/**
 * Reports that already spoke PostgreSQL: no money, no reference-store-only vocabulary. They are
 * planned against the target by the same gate as the ported ones, from the original prototypes.
 */
export const ALREADY_PORTABLE = ["R-13", "R-13b", "R-16"];

/** Every report is accounted for exactly once. A report in no bucket is a report nobody decided about. */
export function checkCoverage() {
  const model = loadReportsModel();
  const ids = [...model.reports.map((r) => r.id), "R-13b"];
  const errors = [];
  for (const id of ids) {
    const n = [PG_REPORTS[id] ? 1 : 0, STOPPED[id] ? 1 : 0, ALREADY_PORTABLE.includes(id) ? 1 : 0].reduce((a, b) => a + b, 0);
    if (n === 0) errors.push(`${id} is neither ported, stopped, nor already portable — it has no decision`);
    if (n > 1) errors.push(`${id} appears in more than one bucket`);
  }
  for (const [id, classes] of Object.entries(STOPPED)) {
    for (const c of classes) if (!AMBIGUITY[c]) errors.push(`${id} is stopped on an unknown ambiguity class ${c}`);
  }
  // A ported report must not smuggle in the thing the stop exists to prevent.
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    if (/legacy_asserted/i.test(p.sql)) errors.push(`${id} references legacy_asserted, which the target has no source for`);
    if (/gross_amount|net_amount/.test(p.sql)) errors.push(`${id} picks a side of the prize gross/net split`);
    if (/_minor\b/.test(p.sql)) errors.push(`${id} still speaks the reference store's minor-unit vocabulary`);
    if (/\b(real|float|double precision)\b/i.test(p.sql)) errors.push(`${id} uses an approximate numeric type`);
    if (/\bround\s*\(|\bceil\s*\(|\bfloor\s*\(/i.test(p.sql) && id !== "R-17") errors.push(`${id} introduces a rounding rule`);
  }
  return { ok: errors.length === 0, errors };
}

export default { PG_REPORTS, STOPPED, ALREADY_PORTABLE, AMBIGUITY, VOCABULARY, checkCoverage };
