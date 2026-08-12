#!/usr/bin/env node
/**
 * WS10.4 — deterministic synthetic fixtures and an executable schema.
 *
 * Runs on `node:sqlite`, so the report prototypes in reports_sql.mjs are REAL SQL that really
 * executes and really returns rows, rather than pseudo-SQL nobody has ever run.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT SQLITE IS AND IS NOT EVIDENCE FOR
 *
 * It IS evidence that: the joins resolve, the grain is what the spec claims, the aggregate does not
 * double-count, the filters select what they say, and the expected values are arithmetically right.
 *
 * It is NOT evidence about PostgreSQL performance. Plan shapes, index selection and cost models
 * differ. Every EXPLAIN result in WS11 is therefore treated as INDICATIVE OF SHAPE ONLY, and no
 * timing from here is a production benchmark. Stating that once, here, is cheaper than qualifying it
 * in fifteen places.
 *
 * MONEY IS INTEGER MINOR UNITS. SQLite's only numeric types are INTEGER and REAL, and REAL is a
 * float — so storing money as REAL would violate the platform's hardest financial rule inside the
 * very fixtures used to verify financial reports. Every amount column is `_minor INTEGER`.
 *
 * No real PII: names are invented, addresses use RFC-reserved domains.
 */

import { DatabaseSync } from "node:sqlite";

export const SCHEMA = `
CREATE TABLE competitions (
  competition_id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE competition_editions (
  competition_edition_id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(competition_id),
  season_year INTEGER NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE participants (
  participant_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  canonical_participant_id TEXT REFERENCES participants(participant_id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE participant_identity_links (
  link_id TEXT PRIMARY KEY,
  surviving_participant_id TEXT NOT NULL REFERENCES participants(participant_id),
  merged_participant_id TEXT NOT NULL REFERENCES participants(participant_id),
  merged_at TEXT NOT NULL,
  reversed_at TEXT
);
CREATE TABLE pools (
  pool_id TEXT PRIMARY KEY,
  competition_edition_id TEXT NOT NULL REFERENCES competition_editions(competition_edition_id),
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE pool_entries (
  pool_entry_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES pools(pool_id),
  participant_id TEXT NOT NULL REFERENCES participants(participant_id),
  entry_label TEXT NOT NULL,
  -- NULL means the fee was never recorded. It is NOT zero, and it must never be read as zero.
  expected_fee_minor INTEGER,
  currency TEXT NOT NULL,
  legacy_asserted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE payments (
  payment_id TEXT PRIMARY KEY,
  payer_participant_id TEXT REFERENCES participants(participant_id),
  payer_name_as_recorded TEXT,
  amount_minor INTEGER,
  currency TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- contribution | refund | reversal | chargeback
  reverses_payment_id TEXT REFERENCES payments(payment_id),
  reason TEXT, actor TEXT,
  external_reference TEXT,
  legacy_asserted INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT NOT NULL
);
CREATE TABLE payment_allocations (
  payment_allocation_id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(payment_id),
  pool_entry_id TEXT NOT NULL REFERENCES pool_entries(pool_entry_id),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  allocated_at TEXT NOT NULL
);
CREATE TABLE prize_allocations (
  prize_allocation_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES pools(pool_id),
  pool_entry_id TEXT REFERENCES pool_entries(pool_entry_id),
  participant_id TEXT REFERENCES participants(participant_id),
  rank INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  declared_at TEXT NOT NULL
);
CREATE TABLE matches (
  match_id TEXT PRIMARY KEY,
  competition_edition_id TEXT NOT NULL REFERENCES competition_editions(competition_edition_id),
  label TEXT NOT NULL,
  kickoff_at TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE match_results (
  -- A SURROGATE primary key, matching model/target_model.json. An earlier version made match_id the
  -- PRIMARY KEY, which mis-modelled an entity that explicitly supports supersession: the target model
  -- carries superseded_by_id and is_official precisely so a corrected result is a NEW row rather than
  -- an in-place edit. That fixture error then propagated into WS11, which classified the index on
  -- match_id REDUNDANT "with the primary key" — a conclusion drawn from a table shape that does not
  -- exist.
  match_result_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(match_id),
  home_goals INTEGER, away_goals INTEGER,
  is_official INTEGER NOT NULL DEFAULT 1,
  superseded_by_id TEXT REFERENCES match_results(match_result_id),
  recorded_at TEXT NOT NULL
);
CREATE TABLE predictions (
  prediction_id TEXT PRIMARY KEY,
  pool_entry_id TEXT NOT NULL REFERENCES pool_entries(pool_entry_id),
  match_id TEXT NOT NULL REFERENCES matches(match_id),
  home_goals INTEGER, away_goals INTEGER,
  submitted_at TEXT NOT NULL
);
CREATE TABLE ranking_snapshots (
  ranking_snapshot_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES pools(pool_id),
  pool_entry_id TEXT NOT NULL REFERENCES pool_entries(pool_entry_id),
  position INTEGER NOT NULL,
  points INTEGER NOT NULL,
  computed_at TEXT NOT NULL
);
CREATE TABLE sync_state (
  sync_state_id TEXT PRIMARY KEY,
  competition_edition_id TEXT NOT NULL REFERENCES competition_editions(competition_edition_id),
  provider TEXT NOT NULL,
  last_success_at TEXT,
  last_attempt_at TEXT
);
CREATE TABLE audit_events (
  -- Column names follow model/target_model.json exactly. An earlier draft of these fixtures invented
  -- subject_table/subject_id/sequence, which made the WS11 index map fiction: an index declared on
  -- aggregate_type cannot be validated against a query that selects subject_table.
  audit_event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  aggregate_type TEXT,
  aggregate_id TEXT,
  correlation_id TEXT
);
CREATE TABLE outbox_events (
  outbox_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,               -- pending | delivered | failed | dead
  created_at TEXT NOT NULL,
  next_attempt_at TEXT
);
CREATE TABLE outbox_delivery_attempts (
  attempt_id TEXT PRIMARY KEY,
  outbox_event_id TEXT NOT NULL REFERENCES outbox_events(outbox_event_id),
  attempted_at TEXT NOT NULL,
  outcome TEXT NOT NULL
);
`;

const T = (n) => `2026-0${Math.min(9, 1 + (n % 9))}-1${n % 9}T00:00:00Z`;

/**
 * The fixture set. Deliberately small and hand-checkable — every expected value in
 * test_reports_sql.mjs can be verified by reading this table by eye. A fixture set too large to
 * check by hand can only be verified against the code it is meant to test.
 *
 * Coverage: 2 competitions, 3 editions (two seasons of one competition, for year-over-year), 4 pools
 * in 2 currencies, 5 participants including one merged identity and one payer who holds no entry,
 * 11 entries including one with an UNKNOWN fee and one with no payment at all, and payments covering
 * every funding case: one-to-many, partial, overpayment, third-party, a partial refund, and an
 * unallocated remainder.
 */
export const FIXTURES = {
  competitions: [
    { competition_id: "C1", name: "Copa Sintetica" },
    { competition_id: "C2", name: "Liga Sintetica" },
  ],
  competition_editions: [
    { competition_edition_id: "CE1", competition_id: "C1", season_year: 2026, name: "Copa Sintetica 2026" },
    { competition_edition_id: "CE2", competition_id: "C2", season_year: 2026, name: "Liga Sintetica 2026" },
    { competition_edition_id: "CE3", competition_id: "C2", season_year: 2025, name: "Liga Sintetica 2025" },
  ],
  participants: [
    { participant_id: "pa", display_name: "Ana Sintetica", email: "ana@example.test", canonical_participant_id: null, created_at: T(1), deleted_at: null },
    { participant_id: "pb", display_name: "Bruno Sintetico", email: "bruno@example.test", canonical_participant_id: null, created_at: T(1), deleted_at: null },
    { participant_id: "pc", display_name: "Carla Pagadora", email: "carla@example.test", canonical_participant_id: null, created_at: T(1), deleted_at: null },
    { participant_id: "pd", display_name: "Dina Sintetica", email: "dina@example.test", canonical_participant_id: null, created_at: T(2), deleted_at: null },
    // A superseded identity, merged into Ana. Its entry must appear in ANA's history (R-01) and must
    // never be counted as a separate participant (R-14, aggregate parity).
    { participant_id: "pe", display_name: "Ana S.", email: "ana@example.test", canonical_participant_id: "pa", created_at: T(1), deleted_at: null },
  ],
  participant_identity_links: [
    { link_id: "L1", surviving_participant_id: "pa", merged_participant_id: "pe", merged_at: T(5), reversed_at: null },
  ],
  pools: [
    { pool_id: "P1", competition_edition_id: "CE1", name: "Copa Pool", currency: "USD", status: "concluded" },
    { pool_id: "P2", competition_edition_id: "CE2", name: "Liga Pool 2026", currency: "USD", status: "open" },
    { pool_id: "P3", competition_edition_id: "CE3", name: "Liga Pool 2025", currency: "USD", status: "concluded" },
    { pool_id: "P4", competition_edition_id: "CE1", name: "Copa Pool BRL", currency: "BRL", status: "open" },
  ],
  pool_entries: [
    { pool_entry_id: "e1", pool_id: "P1", participant_id: "pa", entry_label: "Ana 1", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(2), deleted_at: null },
    { pool_entry_id: "e2", pool_id: "P1", participant_id: "pa", entry_label: "Ana 2", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(2), deleted_at: null },
    { pool_entry_id: "e3", pool_id: "P1", participant_id: "pb", entry_label: "Bruno 1", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(2), deleted_at: null },
    { pool_entry_id: "e4", pool_id: "P2", participant_id: "pd", entry_label: "Dina 1", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(3), deleted_at: null },
    { pool_entry_id: "e5", pool_id: "P2", participant_id: "pa", entry_label: "Ana 1", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(3), deleted_at: null },
    { pool_entry_id: "e6", pool_id: "P3", participant_id: "pb", entry_label: "Bruno 1", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(4), deleted_at: null },
    { pool_entry_id: "e7", pool_id: "P3", participant_id: "pa", entry_label: "Ana 1", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(4), deleted_at: null },
    { pool_entry_id: "e8", pool_id: "P4", participant_id: "pd", entry_label: "Dina BRL", expected_fee_minor: 10000, currency: "BRL", legacy_asserted: 0, created_at: T(5), deleted_at: null },
    // Fee never recorded — settlement must be UNKNOWN, never unpaid.
    { pool_entry_id: "e9", pool_id: "P1", participant_id: "pb", entry_label: "Bruno 2", expected_fee_minor: null, currency: "USD", legacy_asserted: 0, created_at: T(2), deleted_at: null },
    // Held by the SUPERSEDED identity — belongs to Ana after canonical resolution.
    { pool_entry_id: "e10", pool_id: "P1", participant_id: "pe", entry_label: "Ana old", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(1), deleted_at: null },
    // No payment at all — the UNPAID row R-07 exists to find.
    { pool_entry_id: "e11", pool_id: "P2", participant_id: "pd", entry_label: "Dina 2", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(3), deleted_at: null },
    // Soft-deleted: must be excluded by every report that filters deleted_at IS NULL.
    { pool_entry_id: "e12", pool_id: "P1", participant_id: "pd", entry_label: "Deleted", expected_fee_minor: 2000, currency: "USD", legacy_asserted: 0, created_at: T(2), deleted_at: T(6) },
  ],
  payments: [
    { payment_id: "y1", payer_participant_id: "pc", payer_name_as_recorded: null, amount_minor: 4000, currency: "USD", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y1", legacy_asserted: 0, paid_at: T(2) },
    { payment_id: "y2", payer_participant_id: "pb", payer_name_as_recorded: null, amount_minor: 500, currency: "USD", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y2", legacy_asserted: 0, paid_at: T(3) },
    { payment_id: "y3", payer_participant_id: "pd", payer_name_as_recorded: null, amount_minor: 2500, currency: "USD", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y3", legacy_asserted: 0, paid_at: T(3) },
    { payment_id: "y4", payer_participant_id: "pa", payer_name_as_recorded: null, amount_minor: 2000, currency: "USD", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y4", legacy_asserted: 0, paid_at: T(3) },
    { payment_id: "y5", payer_participant_id: "pb", payer_name_as_recorded: null, amount_minor: 2000, currency: "USD", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y5", legacy_asserted: 0, paid_at: T(4) },
    { payment_id: "y6", payer_participant_id: "pa", payer_name_as_recorded: null, amount_minor: 2000, currency: "USD", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y6", legacy_asserted: 0, paid_at: T(4) },
    { payment_id: "y7", payer_participant_id: "pd", payer_name_as_recorded: null, amount_minor: 10000, currency: "BRL", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y7", legacy_asserted: 0, paid_at: T(5) },
    { payment_id: "y8", payer_participant_id: "pa", payer_name_as_recorded: null, amount_minor: 2000, currency: "USD", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y8", legacy_asserted: 0, paid_at: T(1) },
    // An unallocated remainder — the payer sent more than has been applied so far.
    { payment_id: "y9", payer_participant_id: "pa", payer_name_as_recorded: null, amount_minor: 1000, currency: "USD", kind: "contribution", reverses_payment_id: null, reason: null, actor: null, external_reference: "SYNTH-REF-Y9", legacy_asserted: 0, paid_at: T(6) },
    // A PARTIAL refund of y4, with reason/actor/timestamp preserved per WS13-OP-3.
    { payment_id: "r1", payer_participant_id: "pa", payer_name_as_recorded: null, amount_minor: -500, currency: "USD", kind: "refund", reverses_payment_id: "y4", reason: "synthetic partial refund", actor: "operator", external_reference: "SYNTH-REF-R1", legacy_asserted: 0, paid_at: T(7) },
  ],
  payment_allocations: [
    { payment_allocation_id: "a1", payment_id: "y1", pool_entry_id: "e1", amount_minor: 2000, currency: "USD", allocated_at: T(2) },
    { payment_allocation_id: "a2", payment_id: "y1", pool_entry_id: "e2", amount_minor: 2000, currency: "USD", allocated_at: T(2) },
    { payment_allocation_id: "a3", payment_id: "y2", pool_entry_id: "e3", amount_minor: 500, currency: "USD", allocated_at: T(3) },
    { payment_allocation_id: "a4", payment_id: "y3", pool_entry_id: "e4", amount_minor: 2500, currency: "USD", allocated_at: T(3) },
    { payment_allocation_id: "a5", payment_id: "y4", pool_entry_id: "e5", amount_minor: 2000, currency: "USD", allocated_at: T(3) },
    { payment_allocation_id: "a6", payment_id: "y5", pool_entry_id: "e6", amount_minor: 2000, currency: "USD", allocated_at: T(4) },
    { payment_allocation_id: "a7", payment_id: "y6", pool_entry_id: "e7", amount_minor: 2000, currency: "USD", allocated_at: T(4) },
    { payment_allocation_id: "a8", payment_id: "y7", pool_entry_id: "e8", amount_minor: 10000, currency: "BRL", allocated_at: T(5) },
    { payment_allocation_id: "a9", payment_id: "y8", pool_entry_id: "e10", amount_minor: 2000, currency: "USD", allocated_at: T(1) },
    // The refund carries its OWN negative allocation, so every SQL sum over allocations is already
    // correct without a special case. A refund with no allocation would have to be apportioned, which
    // financial_evidence.mjs does — but a report should not have to.
    { payment_allocation_id: "a10", payment_id: "r1", pool_entry_id: "e5", amount_minor: -500, currency: "USD", allocated_at: T(7) },
  ],
  prize_allocations: [
    { prize_allocation_id: "z1", pool_id: "P1", pool_entry_id: "e1", participant_id: "pa", rank: 1, amount_minor: 7000, currency: "USD", declared_at: T(8) },
    { prize_allocation_id: "z2", pool_id: "P3", pool_entry_id: "e6", participant_id: "pb", rank: 1, amount_minor: 5000, currency: "USD", declared_at: T(8) },
  ],
  matches: [
    { match_id: "m1", competition_edition_id: "CE1", label: "M1", kickoff_at: T(3), status: "finished" },
    { match_id: "m2", competition_edition_id: "CE1", label: "M2", kickoff_at: T(4), status: "finished" },
    { match_id: "m3", competition_edition_id: "CE2", label: "M3", kickoff_at: T(5), status: "scheduled" },
  ],
  match_results: [
    { match_result_id: "mr1", match_id: "m1", home_goals: 2, away_goals: 1, is_official: 1, superseded_by_id: null, recorded_at: T(3) },
    { match_result_id: "mr2", match_id: "m2", home_goals: 0, away_goals: 0, is_official: 1, superseded_by_id: null, recorded_at: T(4) },
    // A SUPERSEDED result for m1: it must never be counted as the official one. Without a row like
    // this, no test could tell whether a report filters on is_official or merely happens to be right.
    { match_result_id: "mr0", match_id: "m1", home_goals: 1, away_goals: 1, is_official: 0, superseded_by_id: "mr1", recorded_at: T(2) },
  ],
  predictions: [
    { prediction_id: "d1", pool_entry_id: "e1", match_id: "m1", home_goals: 2, away_goals: 1, submitted_at: T(2) },
    { prediction_id: "d2", pool_entry_id: "e1", match_id: "m2", home_goals: 1, away_goals: 0, submitted_at: T(2) },
    { prediction_id: "d3", pool_entry_id: "e2", match_id: "m1", home_goals: 0, away_goals: 0, submitted_at: T(2) },
    { prediction_id: "d4", pool_entry_id: "e3", match_id: "m1", home_goals: 2, away_goals: 1, submitted_at: T(2) },
    { prediction_id: "d5", pool_entry_id: "e10", match_id: "m1", home_goals: 1, away_goals: 1, submitted_at: T(1) },
  ],
  ranking_snapshots: [
    // Explicit instants, NOT the T() helper: T(n) wraps its month at n=9, so T(9) is EARLIER than
    // T(8). Using it here made the "later" snapshot the earlier one and the latest-observation test
    // read the wrong row. A fixture whose ordering is accidental cannot verify an ordering.
    { ranking_snapshot_id: "s1", pool_id: "P1", pool_entry_id: "e1", position: 1, points: 20, computed_at: "2026-07-01T00:00:00Z" },
    { ranking_snapshot_id: "s2", pool_id: "P1", pool_entry_id: "e3", position: 2, points: 10, computed_at: "2026-07-01T00:00:00Z" },
    { ranking_snapshot_id: "s3", pool_id: "P1", pool_entry_id: "e2", position: 3, points: 1, computed_at: "2026-07-01T00:00:00Z" },
    // A strictly LATER snapshot for the same pool — reports must not double-count across observations.
    { ranking_snapshot_id: "s4", pool_id: "P1", pool_entry_id: "e1", position: 1, points: 25, computed_at: "2026-07-15T00:00:00Z" },
    { ranking_snapshot_id: "s5", pool_id: "P1", pool_entry_id: "e3", position: 2, points: 12, computed_at: "2026-07-15T00:00:00Z" },
    { ranking_snapshot_id: "s6", pool_id: "P1", pool_entry_id: "e2", position: 3, points: 3, computed_at: "2026-07-15T00:00:00Z" },
  ],
  sync_state: [
    { sync_state_id: "sy1", competition_edition_id: "CE1", provider: "provider-a", last_success_at: "2026-08-01T00:00:00Z", last_attempt_at: "2026-08-01T00:10:00Z" },
    { sync_state_id: "sy2", competition_edition_id: "CE2", provider: "provider-a", last_success_at: null, last_attempt_at: "2026-08-01T00:10:00Z" },
  ],
  audit_events: [
    { audit_event_id: "ae1", occurred_at: T(1), actor_role: "participant", actor_user_id: null, action: "createEntry", aggregate_type: "pool_entries", aggregate_id: "e1", correlation_id: "SYNTH-CORR-1" },
    { audit_event_id: "ae2", occurred_at: T(2), actor_role: "operator", actor_user_id: "op-1", action: "recordPayment", aggregate_type: "payments", aggregate_id: "y1", correlation_id: "SYNTH-CORR-2" },
    { audit_event_id: "ae3", occurred_at: T(3), actor_role: "operator", actor_user_id: "op-1", action: "allocatePayment", aggregate_type: "payment_allocations", aggregate_id: "a1", correlation_id: "SYNTH-CORR-2" },
    { audit_event_id: "ae4", occurred_at: T(5), actor_role: "operator", actor_user_id: "op-1", action: "mergeParticipantIdentity", aggregate_type: "participants", aggregate_id: "pe", correlation_id: "SYNTH-CORR-3" },
    { audit_event_id: "ae5", occurred_at: T(7), actor_role: "operator", actor_user_id: "op-1", action: "recordPayment", aggregate_type: "payments", aggregate_id: "r1", correlation_id: "SYNTH-CORR-4" },
  ],
  outbox_events: [
    { outbox_event_id: "o1", event_type: "entry_created", status: "delivered", created_at: T(1), next_attempt_at: null },
    { outbox_event_id: "o2", event_type: "entry_created", status: "pending", created_at: T(2), next_attempt_at: T(3) },
    { outbox_event_id: "o3", event_type: "payment_recorded", status: "failed", created_at: T(2), next_attempt_at: T(4) },
    { outbox_event_id: "o4", event_type: "payment_recorded", status: "dead", created_at: T(1), next_attempt_at: null },
    { outbox_event_id: "o5", event_type: "prize_declared", status: "pending", created_at: T(6), next_attempt_at: T(7) },
  ],
  outbox_delivery_attempts: [
    { attempt_id: "t1", outbox_event_id: "o1", attempted_at: T(1), outcome: "success" },
    { attempt_id: "t2", outbox_event_id: "o3", attempted_at: T(2), outcome: "failure" },
    { attempt_id: "t3", outbox_event_id: "o3", attempted_at: T(3), outcome: "failure" },
    { attempt_id: "t4", outbox_event_id: "o4", attempted_at: T(1), outcome: "failure" },
    { attempt_id: "t5", outbox_event_id: "o4", attempted_at: T(2), outcome: "failure" },
    { attempt_id: "t6", outbox_event_id: "o4", attempted_at: T(3), outcome: "failure" },
  ],
};

const TABLE_ORDER = [
  "competitions", "competition_editions", "participants", "participant_identity_links", "pools",
  "pool_entries", "payments", "payment_allocations", "prize_allocations", "matches", "match_results",
  "predictions", "ranking_snapshots", "sync_state", "audit_events", "outbox_events",
  "outbox_delivery_attempts",
];

/** Build an in-memory database with the schema and fixtures loaded. Deterministic. */
export function buildDatabase({ fixtures = FIXTURES, indexes = [] } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  for (const table of TABLE_ORDER) {
    const rows = fixtures[table] || [];
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
    for (const r of rows) stmt.run(...cols.map((c) => (r[c] === undefined ? null : r[c])));
  }
  for (const ix of indexes) db.exec(ix.sql ?? ix);
  return db;
}

export function query(db, sql, params = {}) {
  const stmt = db.prepare(sql);
  return Object.keys(params).length ? stmt.all(params) : stmt.all();
}

/** Format integer minor units as an exact decimal string. No float, ever. */
export function dec(minor) {
  if (minor === null || minor === undefined) return null;
  const neg = minor < 0, abs = Math.abs(minor);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export default { SCHEMA, FIXTURES, buildDatabase, query, dec };
