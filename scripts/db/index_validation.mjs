#!/usr/bin/env node
/**
 * WS11 — index validation against the ACTUAL WS10 query prototypes.
 *
 * The rule: no speculative index without an identified workload. Every candidate here is traced to a
 * report that really runs, and any candidate no query needs is classified DEFER or
 * REMOVE_FROM_DRAFT rather than kept because it sounds plausible.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THE EXPLAIN EVIDENCE IS WORTH
 *
 * Plans come from SQLite's `EXPLAIN QUERY PLAN` over the synthetic fixtures. That is evidence about
 * PLAN SHAPE ONLY — whether the planner can use an index at all for a given predicate, and whether a
 * sort disappears. It is NOT evidence about PostgreSQL:
 *
 *   · the two planners have different cost models and different join strategies;
 *   · at 12 fixture rows a seq scan is correct for everything, so an index being unused here says
 *     nothing about production;
 *   · SQLite has no partial-index-on-expression parity with Postgres, no BRIN, no GIN.
 *
 * So a candidate is never promoted to REQUIRED on the strength of a plan. Plans are used for exactly
 * two things, both negative: proving a predicate is INDEXABLE in principle, and catching an index
 * that cannot be used even in the best case (wrong column order, unusable leading column). No timing
 * is recorded anywhere, because a timing from a 12-row table would be read as a benchmark.
 */

import { buildDatabase } from "./report_fixtures.mjs";
import { PROTOTYPES, loadReportsModel } from "./reports_sql.mjs";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS11.2 — classification
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const CLASS = {
  REQUIRED_FOR_CONSTRAINT: "REQUIRED_FOR_CONSTRAINT",
  HIGH_VALUE: "HIGH_VALUE",
  LIKELY_USEFUL: "LIKELY_USEFUL",
  DEFER: "DEFER",
  REDUNDANT: "REDUNDANT",
  REMOVE_FROM_DRAFT: "REMOVE_FROM_DRAFT",
};

export const WRITE_COST = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" };

/**
 * Tables whose write path is hot enough that an extra index is a real cost.
 *
 * `payments`, `predictions` and `outbox_events` are named explicitly because every index on them is
 * maintained on the write path of the operations that matter most: money, the cutoff-bound
 * submission, and the delivery worker's own polling. An index there must earn its place.
 */
export const WRITE_SENSITIVE = {
  payments: "every index is maintained inside the money-bearing transaction that WS13 keeps as short as possible",
  payment_allocations: "written in the same transaction as a payment, under a row lock on the payment",
  predictions: "written under a cutoff deadline, when submission volume spikes and latency is most visible",
  outbox_events: "the delivery worker updates status on every attempt, so every index is re-maintained per attempt",
  audit_events: "append-only and written by every single contract; an index here is paid on every mutation in the system",
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS11.1 — query → index map
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Candidate indexes, each traced to the reports that need it and to the predicate that would use it.
 *
 * `cols` uses the TARGET MODEL's column names (model/target_model.json), not the fixture schema's —
 * they were aligned deliberately, because an index declared on `aggregate_type` cannot be validated
 * against a query selecting `subject_table`.
 */
export const CANDIDATES = [
  {
    id: "IX-01", table: "pool_entries", cols: ["participant_id", "pool_id"],
    reports: ["R-01", "R-04"], predicate: "WHERE participant_id = :id (R-01); GROUP BY participant_id, pool_id (R-04)",
    cardinality: "one participant holds 1–5 entries; selective",
    klass: CLASS.HIGH_VALUE, writeCost: WRITE_COST.LOW,
    why: "R-01 is the only INTERACTIVE report with a participant equality filter, so it is the one place a person waits on this lookup. Leading column is the equality, which is the order a composite must be in.",
  },
  {
    id: "IX-02", table: "pool_entries", cols: ["pool_id"], partial: "deleted_at IS NULL",
    reports: ["R-02", "R-14", "R-15"], predicate: "GROUP BY pool_id with deleted_at IS NULL",
    cardinality: "a pool holds tens of entries",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.LOW,
    why: "partial on deleted_at IS NULL because every report filters it and soft-deleted rows are permanently uninteresting to reads. A partial index also stays small as deletions accumulate.",
    note: "the model declares this as pool_entries(pool_id, deleted_at). A PARTIAL index on pool_id is strictly better: deleted_at is not a selective second column, it is a constant in every query that uses it.",
  },
  {
    id: "IX-03", table: "payment_allocations", cols: ["pool_entry_id"],
    reports: ["R-06", "R-07", "R-08", "R-09", "R-15", "R-01", "R-03"],
    predicate: "GROUP BY pool_entry_id — the settlement derivation, which every balance report uses",
    cardinality: "1–3 allocations per entry",
    klass: CLASS.HIGH_VALUE, writeCost: WRITE_COST.MEDIUM,
    why: "seven of the seventeen reports derive settlement, and all of them do it by aggregating allocations per entry. This is the single most-used access path in the read model.",
  },
  {
    id: "IX-04", table: "payment_allocations", cols: ["payment_id"],
    reports: ["R-05", "R-06"], predicate: "SUM(amount) per payment — the unapplied-balance derivation",
    cardinality: "1–5 allocations per payment",
    klass: CLASS.REQUIRED_FOR_CONSTRAINT, writeCost: WRITE_COST.MEDIUM,
    why: "not merely a report path. WS13's allocatePayment holds SELECT ... FOR UPDATE on the payment and then sums its sibling allocations inside the transaction to enforce sum(allocations) <= amount. Without this index that check is a scan performed while holding a row lock on money.",
  },
  {
    id: "IX-05", table: "payments", cols: ["external_reference"], unique: true, partial: "external_reference IS NOT NULL",
    reports: [], predicate: "the idempotency lookup, not a report",
    cardinality: "unique by construction",
    klass: CLASS.REQUIRED_FOR_CONSTRAINT, writeCost: WRITE_COST.MEDIUM,
    why: "this index IS the control that makes double-recording a payment reference impossible. It is required whether or not any report uses it, and a workload-driven review must not classify it DEFER for lack of a reading query.",
  },
  {
    id: "IX-06", table: "payments", cols: ["payer_participant_id"],
    reports: ["R-05", "R-11"], predicate: "GROUP BY payer, and 'everything this person paid'",
    cardinality: "a payer has 1–10 payments",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.MEDIUM,
    why: "R-11 aggregates per payer across all payments. At current volumes a scan is fine; this is here because the access pattern is real, not because the table is large.",
  },
  {
    id: "IX-07", table: "payments", cols: ["paid_at"],
    reports: ["R-05"], predicate: "ORDER BY paid_at DESC",
    cardinality: "n/a — an ordering, not a filter",
    klass: CLASS.DEFER, writeCost: WRITE_COST.MEDIUM,
    why: "R-05 has no date FILTER, only an ORDER BY over the whole table. Sorting tens of rows costs nothing, and an index that exists only to avoid a sort on a small result is a write-path cost with no read benefit. It becomes HIGH_VALUE the moment R-05 gains a date range, and not before.",
  },
  {
    id: "IX-08", table: "payments", cols: ["reverses_payment_id"], partial: "reverses_payment_id IS NOT NULL",
    reports: ["R-05"], predicate: "find the reversal(s) of a payment",
    cardinality: "very few rows are reversals",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.MEDIUM,
    why: "the partial predicate is what makes this cheap: almost no payment is a reversal, so the index stays tiny. WS9's reversal-exceeds-original check reads it per original payment. MEDIUM rather than LOW because a partial index is CHEAP, not free — every insert into payments still evaluates the predicate, inside the money-bearing transaction.",
  },
  {
    id: "IX-09", table: "prize_allocations", cols: ["pool_id"],
    reports: ["R-10", "R-15"], predicate: "SUM(amount) per pool",
    cardinality: "up to 3 prizes per pool",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.LOW,
    why: "R-15 joins prizes per pool for the net cash position. The table is tiny, so this is LIKELY_USEFUL rather than HIGH_VALUE.",
  },
  {
    id: "IX-10", table: "prize_allocations", cols: ["participant_id"],
    reports: ["R-01", "R-10", "R-11"], predicate: "'what has this person won'",
    cardinality: "most participants have won nothing",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.LOW,
    why: "R-11's net position needs winnings per participant. Worth a partial on participant_id IS NOT NULL, since a prize may be recorded against an entry rather than a person.",
  },
  {
    id: "IX-11", table: "predictions", cols: ["pool_entry_id", "match_id"], unique: true,
    reports: ["R-12"], predicate: "the uniqueness constraint, and R-12's per-entry aggregation",
    cardinality: "unique by construction",
    klass: CLASS.REQUIRED_FOR_CONSTRAINT, writeCost: WRITE_COST.HIGH,
    why: "WS13's submitPrediction relies on this unique index so two concurrent submissions for one (entry, subject) cannot both win. It is expensive — predictions is the highest-volume write table and the write happens under a cutoff spike — but the alternative is a lost or duplicated prediction, which is a scoring error.",
    supersedes: ["predictions(pool_entry_id)"],
  },
  {
    id: "IX-12", table: "match_results", cols: ["match_id"],
    reports: ["R-12"], predicate: "every result for a match, including superseded ones",
    cardinality: "one official row per match, plus one per correction",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.LOW,
    why: "match_results has a SURROGATE primary key (match_result_id) and supports supersession via superseded_by_id and is_official, so match_id is an ordinary foreign key and is NOT covered by the primary key. The partial unique index on (match_id) WHERE superseded_by_id IS NULL AND is_official covers only the current official row, so an unconditional lookup for a match's full result history still needs this index.",
    correctionNote: "PREVIOUSLY CLASSIFIED REDUNDANT, wrongly. The claim was that match_id is the primary key — true of the SQLite report fixture at the time, false of the target model. A conclusion drawn from a fixture is only as good as the fixture's fidelity, and this one had invented a shape that cannot represent a corrected result at all.",
  },
  {
    id: "IX-13", table: "ranking_snapshots", cols: ["pool_id", "computed_at"],
    reports: ["R-13", "R-13b"], predicate: "MAX(computed_at) per pool, then fetch that snapshot",
    cardinality: "one snapshot set per pool per observation",
    klass: CLASS.HIGH_VALUE, writeCost: WRITE_COST.LOW,
    why: "R-13b's latest-observation lookup is exactly a (pool_id, computed_at DESC) probe. Without it, finding the current ranking scans every historical snapshot — and ranking is read on every page view.",
  },
  {
    id: "IX-14", table: "ranking_snapshots", cols: ["pool_id", "computed_at", "position"],
    reports: ["R-13"], predicate: "ordered leaderboard read without a sort",
    cardinality: "as IX-13",
    klass: CLASS.REDUNDANT, writeCost: WRITE_COST.LOW,
    why: "a PREFIX overlap with IX-13: (pool_id, computed_at) is a leading subset of (pool_id, computed_at, position), so IX-13 is served by this one and keeping both is a duplicate. If the sort-avoidance is wanted, keep THIS one and drop IX-13 — but keeping both is never right.",
    redundantWith: "IX-13",
    resolution: "keep exactly one. Recommended: IX-13, because position adds a third column to every insert for a sort over at most tens of rows.",
  },
  {
    id: "IX-15", table: "audit_events", cols: ["aggregate_type", "aggregate_id"],
    reports: ["R-16"], predicate: "'what happened to this object'",
    cardinality: "a handful of events per object",
    klass: CLASS.HIGH_VALUE, writeCost: WRITE_COST.HIGH,
    why: "the primary audit lookup path, and currently a full scan in the legacy table. HIGH write cost because audit_events is appended to by every contract in the system, so this index is paid on every mutation — accepted because an audit trail nobody can query is not an audit trail.",
  },
  {
    id: "IX-16", table: "audit_events", cols: ["occurred_at"],
    reports: ["R-16"], predicate: "chronological reads",
    cardinality: "n/a — an ordering",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.HIGH,
    why: "chronological audit reads are the second real access pattern. On an append-only table the values arrive in order, so the index stays dense and cheap to maintain relative to a random-key index.",
  },
  {
    id: "IX-17", table: "audit_events", cols: ["correlation_id"], partial: "correlation_id IS NOT NULL",
    reports: ["R-16"], predicate: "reconstruct one logical operation end to end",
    cardinality: "2–6 events per correlation",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.MEDIUM,
    why: "the incident-investigation path: given one request, show everything it did. The partial predicate keeps it out of the way for events with no correlation.",
  },
  {
    id: "IX-18", table: "audit_events", cols: ["actor_user_id"],
    reports: [], predicate: "'everything this operator did' — declared in the target model, used by no report",
    cardinality: "unknown; there is no authenticated operator principal today",
    klass: CLASS.DEFER, writeCost: WRITE_COST.HIGH,
    why: "R-GAP-1 is open: there is no database-verifiable operator identity, so actor_user_id is not reliably populated. An index on a column that is mostly NULL, on the most write-heavy table in the system, for a query no report issues, is cost without benefit. It becomes LIKELY_USEFUL when a real operator principal exists.",
  },
  {
    id: "IX-19", table: "outbox_events", cols: ["status", "next_attempt_at"], partial: "status IN ('pending','failed')",
    reports: ["R-17"], predicate: "the delivery worker's claim query, and R-17's backlog counts",
    cardinality: "pending is a small fraction of the table",
    klass: CLASS.HIGH_VALUE, writeCost: WRITE_COST.HIGH,
    why: "this is the delivery worker's hot path, polled continuously. The PARTIAL predicate is what makes it affordable: delivered events are the overwhelming majority and are never claimed again, so excluding them keeps the index proportional to the backlog rather than to history.",
  },
  {
    id: "IX-20", table: "sync_state", cols: ["last_success_at"],
    reports: ["R-17"], predicate: "staleness check",
    cardinality: "one row per edition — a handful of rows in total",
    klass: CLASS.REMOVE_FROM_DRAFT, writeCost: WRITE_COST.LOW,
    why: "sync_state holds one row per competition edition, so at most single digits. An index on a table that will never exceed a page is never used by any planner and is pure clutter in the schema. Removing it from the draft is the honest outcome of a workload-driven review.",
  },
  {
    id: "IX-21", table: "competition_editions", cols: ["competition_id"],
    reports: ["R-03", "R-14"], predicate: "join editions to competitions",
    cardinality: "a few editions per competition",
    klass: CLASS.REMOVE_FROM_DRAFT, writeCost: WRITE_COST.LOW,
    why: "reference data measured in single-digit rows. The foreign key does not require an index on the referencing side for correctness, and no planner will use one at this size.",
    note: "an FK index IS worth having where the parent is ever DELETEd, because the FK check scans the child. Competitions are never deleted, so that argument does not apply here.",
  },
  {
    id: "IX-22", table: "pools", cols: ["competition_edition_id"],
    reports: ["R-03", "R-14"], predicate: "join pools to editions",
    cardinality: "1–4 pools per edition",
    klass: CLASS.DEFER, writeCost: WRITE_COST.LOW,
    why: "same reasoning as IX-21, but pools will grow with every future competition while editions will not, so it is DEFER rather than REMOVE_FROM_DRAFT: revisit when the table exceeds a few hundred rows.",
  },
  {
    id: "IX-23", table: "participants", cols: ["canonical_participant_id"], partial: "canonical_participant_id IS NOT NULL",
    reports: ["R-01", "R-05", "R-10", "R-11", "R-14"], predicate: "the canonical-identity resolution CTE used by every by-participant report",
    cardinality: "very few participants are merged",
    klass: CLASS.LIKELY_USEFUL, writeCost: WRITE_COST.LOW,
    why: "identified by WS11 rather than by the report model: five reports resolve canonical identity, and none of the model's declared indexes covers it. The partial predicate makes it near-free, since merges are rare.",
    discoveredBy: "WS11 — absent from model/reports.json's declared index list",
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS11.3 — redundancy detection
// ─────────────────────────────────────────────────────────────────────────────────────────────

const isPrefix = (a, b) => a.length < b.length && a.every((c, i) => c === b[i]);

export function detectRedundancy(candidates = CANDIDATES) {
  const findings = [];
  for (const a of candidates) {
    for (const b of candidates) {
      if (a === b || a.table !== b.table) continue;
      if (isPrefix(a.cols, b.cols)) {
        findings.push({
          kind: "PREFIX_OVERLAP", shorter: a.id, longer: b.id, table: a.table,
          detail: `${a.id} (${a.cols.join(",")}) is a leading subset of ${b.id} (${b.cols.join(",")})`,
          why: "the longer index already serves every query the shorter one does, so keeping both pays two write costs for one read benefit",
        });
      }
      if (a.cols.length === b.cols.length && a.cols.every((c, i) => c === b.cols[i]) && a.id < b.id) {
        findings.push({ kind: "DUPLICATE", a: a.id, b: b.id, table: a.table, detail: "identical column lists" });
      }
    }
    if (a.klass === CLASS.REDUNDANT && !a.redundantWith) {
      findings.push({ kind: "UNEXPLAINED_REDUNDANCY", id: a.id, detail: "classified REDUNDANT with nothing named as the index it duplicates" });
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS11.5 — synthetic EXPLAIN comparison (plan SHAPE only)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Translate a candidate into SQLite DDL. Partial predicates are kept; UNIQUE is kept. */
export function candidateDdl(c) {
  const name = `ix_${c.table}_${c.cols.join("_")}`.slice(0, 60);
  return `CREATE ${c.unique ? "UNIQUE " : ""}INDEX ${name} ON ${c.table} (${c.cols.join(", ")})` +
    (c.partial ? ` WHERE ${c.partial}` : "");
}

export function explain(db, sql, params = {}) {
  const stmt = db.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  const rows = Object.keys(params).length ? stmt.all(params) : stmt.all();
  return rows.map((r) => r.detail);
}

const PLAN_PARAMS = { participant_id: "pa", now: "2026-08-09T00:00:00Z" };

/**
 * Compare each report's plan without candidate indexes against the plan with them.
 * Reports SHAPE changes only: how many scans became index searches, and whether a sort disappeared.
 */
export function comparePlans({ reportIds = Object.keys(PROTOTYPES) } = {}) {
  const bare = buildDatabase();
  const indexed = buildDatabase({ indexes: CANDIDATES
    .filter((c) => c.klass !== CLASS.REDUNDANT && c.klass !== CLASS.REMOVE_FROM_DRAFT)
    .map((c) => ({ sql: candidateDdl(c) })) });

  const out = [];
  for (const id of reportIds) {
    const p = PROTOTYPES[id];
    const params = {};
    for (const n of p.params || []) params[n] = PLAN_PARAMS[n];
    let before, after;
    try { before = explain(bare, p.sql, params); } catch (e) { before = [`ERROR ${e.message}`]; }
    try { after = explain(indexed, p.sql, params); } catch (e) { after = [`ERROR ${e.message}`]; }
    const count = (plan, re) => plan.filter((l) => re.test(l)).length;
    out.push({
      report: id,
      scansBefore: count(before, /SCAN/), scansAfter: count(after, /SCAN/),
      searchesBefore: count(before, /SEARCH/), searchesAfter: count(after, /SEARCH/),
      sortsBefore: count(before, /USE TEMP B-TREE/), sortsAfter: count(after, /USE TEMP B-TREE/),
      improved: count(after, /SEARCH/) > count(before, /SEARCH/) || count(after, /USE TEMP B-TREE/) < count(before, /USE TEMP B-TREE/),
      before, after,
    });
  }
  return out;
}

/** Is this predicate indexable at all? A candidate that cannot be used in the best case is broken. */
export function candidateIsUsable(c) {
  const db = buildDatabase({ indexes: [{ sql: candidateDdl(c) }] });
  const probe = c.partial
    ? `SELECT 1 FROM ${c.table} WHERE ${c.cols[0]} = 'probe' AND ${c.partial}`
    : `SELECT 1 FROM ${c.table} WHERE ${c.cols[0]} = 'probe'`;
  const plan = explain(db, probe);
  return { candidate: c.id, plan, usable: plan.some((l) => /SEARCH/.test(l)) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS11.6 — feedback into the draft artefacts
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The decisions WS11 feeds back. Draft-only: no migration file is edited by this function, and no
 * production index is created anywhere.
 */
export function feedbackToDrafts() {
  const keep = CANDIDATES.filter((c) => [CLASS.REQUIRED_FOR_CONSTRAINT, CLASS.HIGH_VALUE, CLASS.LIKELY_USEFUL].includes(c.klass));
  const drop = CANDIDATES.filter((c) => [CLASS.REDUNDANT, CLASS.REMOVE_FROM_DRAFT].includes(c.klass));
  const defer = CANDIDATES.filter((c) => c.klass === CLASS.DEFER);
  return {
    createConcurrently: keep.map((c) => ({
      id: c.id, ddl: `CREATE ${c.unique ? "UNIQUE " : ""}INDEX CONCURRENTLY ${`ix_${c.table}_${c.cols.join("_")}`.slice(0, 60)} ` +
        `ON bolao.${c.table} (${c.cols.join(", ")})${c.partial ? ` WHERE ${c.partial}` : ""};`,
      klass: c.klass, writeCost: c.writeCost,
    })),
    removeFromDraft: drop.map((c) => ({ id: c.id, table: c.table, cols: c.cols, klass: c.klass, why: c.why })),
    deferred: defer.map((c) => ({ id: c.id, table: c.table, cols: c.cols, why: c.why, revisitWhen: c.why })),
    notes: [
      "every CREATE INDEX must be CONCURRENTLY, and pg_index.indisvalid must be checked after each build: a failed concurrent build leaves an INVALID index that is still maintained on every write while never being used for a read",
      "no index in this list has been created anywhere; this is draft feedback only",
      "write costs are QUALITATIVE. No production measurement exists, and none is claimed.",
    ],
  };
}

/** Cross-check the candidates against model/reports.json's declared index list. */
export function checkModelAlignment() {
  const model = loadReportsModel();
  const declared = new Set();
  for (const r of model.reports) for (const ix of r.indexes || []) declared.add(ix.trim());

  const norm = (s) => s.replace(/\s+/g, "");
  const candidateKeys = new Set(CANDIDATES.map((c) => norm(`${c.table}(${c.cols.join(",")})`)));

  // A declared index is not "missing" if a candidate explicitly SUPERSEDES or REPLACES it — that is a
  // reviewed decision, not an omission. Only genuinely unaccounted-for declarations are reported, so
  // this check keeps its teeth.
  const superseded = new Set();
  for (const c of CANDIDATES) {
    for (const s of c.supersedes || []) superseded.add(norm(s));
    if (c.note) {
      const m = /the model declares this as ([a-z_]+\([^)]*\))/.exec(c.note);
      if (m) superseded.add(norm(m[1]));
    }
  }
  const missing = [], extra = [];
  for (const d of declared) if (!candidateKeys.has(norm(d)) && !superseded.has(norm(d))) missing.push(d);
  for (const c of CANDIDATES) {
    const key = norm(`${c.table}(${c.cols.join(",")})`);
    if (![...declared].some((d) => norm(d) === key)) extra.push({ id: c.id, index: `${c.table}(${c.cols.join(",")})`, discoveredBy: c.discoveredBy || "WS11" });
  }
  return { declared: declared.size, candidates: CANDIDATES.length, missing, extra };
}

export function summary() {
  const byClass = {};
  for (const c of CANDIDATES) (byClass[c.klass] ||= []).push(c.id);
  return {
    total: CANDIDATES.length, byClass,
    writeSensitiveTablesTouched: [...new Set(CANDIDATES.filter((c) => WRITE_SENSITIVE[c.table]).map((c) => c.table))],
    highWriteCost: CANDIDATES.filter((c) => c.writeCost === WRITE_COST.HIGH).map((c) => c.id),
    withoutWorkload: CANDIDATES.filter((c) => (c.reports || []).length === 0).map((c) => ({ id: c.id, klass: c.klass })),
  };
}

export default { CANDIDATES, CLASS, WRITE_COST, detectRedundancy, comparePlans, candidateIsUsable, feedbackToDrafts, checkModelAlignment, summary };
