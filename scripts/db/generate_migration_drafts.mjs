#!/usr/bin/env node
/**
 * M1–M10 migration draft generator (Workstreams 3, 3A, 35).
 *
 * WHY GENERATED AND NOT HAND-WRITTEN
 * Ten hand-written SQL files would drift from `model/target_model.json` the first time a column changed,
 * and nothing would notice — the model would say one thing and the migration another. Generating them makes
 * drift impossible by construction and gives freshness checking for free (`--check`). It also means WS3A's
 * DDL-quality rules are enforced by the emitter rather than by review: there is no code path that emits a
 * `serial`, a `float` money column, or a bare `timestamp`.
 *
 * WHAT THESE FILES ARE NOT
 * They are REVIEW DRAFTS. Every file opens with a refusal banner, they live outside `supabase/migrations/`,
 * and their names are not CLI-recognisable, so `supabase db push` cannot see them. Executing one requires
 * deliberately copying it somewhere else, which is the point.
 *
 * DDL QUALITY (WS3A) — enforced here, not hoped for:
 *   · every table gets an explicit PK, and PKs are uuid with gen_random_uuid(), never serial
 *   · every FK is explicit and carries an explicit ON DELETE — never an implicit NO ACTION
 *   · nullability is always written out; NOT NULL is never left implied
 *   · money is numeric(14,2) and never float/real/money; every amount has a currency companion
 *   · timestamps are timestamptz; a bare `timestamp` is refused
 *   · CHECK and UNIQUE constraints come from the model, with names
 *   · indexes are CREATE INDEX CONCURRENTLY, outside the transaction, in a separate step
 *   · every table and non-obvious column gets a COMMENT
 *
 * Usage:
 *   node scripts/db/generate_migration_drafts.mjs            # report
 *   node scripts/db/generate_migration_drafts.mjs --write
 *   node scripts/db/generate_migration_drafts.mjs --check
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadModel, withDefaults } from "./validate_target_model.mjs";
import { loadAccessModel } from "./validate_access_model.mjs";
import { TARGET_POLICY, MANAGED_ROLES } from "./privilege_model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const DRAFT_DIR = join(ROOT, "docs", "bolao", "db-modernization", "migration-drafts");

export const BANNER = `-- NOT FOR PRODUCTION APPLY
-- REVIEW DRAFT ONLY
-- REQUIRES M0 + RESTORE REHEARSAL + EXPLICIT OPERATOR AUTHORIZATION
--
-- GENERATED FILE — do not edit by hand.
-- Source: model/target_model.json + model/access_model.json
-- Regenerate: node scripts/db/generate_migration_drafts.mjs --write
--
-- This file is deliberately NOT in supabase/migrations/ and its name is not CLI-recognisable,
-- so \`supabase db push\` cannot see it. Applying it requires copying it elsewhere on purpose.`;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Column types that are NOT built into PostgreSQL and therefore need an extension created first.
 *
 * KPLUS-F004. `pgcrypto` used to be emitted as a hardcoded line, on the reasoning that
 * `gen_random_uuid()` needs it. That reasoning was right and the implementation was a literal, so when
 * the model gained a `citext` column nothing noticed: DDL-M1 created pgcrypto and 14 enums, and DDL-M2
 * then failed against a real server with `type "citext" does not exist`. The sequence was unrunnable
 * from its second phase and every static check still passed, because each phase was individually
 * consistent and the missing dependency was never named in the phase that broke.
 *
 * Keyed by the type as it appears in the model, so adding an extension-backed type to the model brings
 * its extension along instead of breaking a later phase.
 */
export const TYPE_EXTENSIONS = {
  citext: { name: "citext", why: "citext (case-insensitive text) backs the participant email column." },
};

/** Extensions unconditionally required by the generated DDL, independent of any column type. */
export const BASE_EXTENSIONS = [
  { name: "pgcrypto", why: "gen_random_uuid() lives in pgcrypto on the server version in use." },
];

/**
 * The extension set this model actually needs: the unconditional ones, plus one for every
 * extension-backed column type the model declares. Derived, never listed.
 */
/**
 * Schema-level grants, derived from TARGET_POLICY.SCHEMA rather than written out here.
 *
 * Emitted in role order from MANAGED_ROLES so the SQL is deterministic, and roles holding nothing are
 * skipped so an empty grant list produces no statement rather than a syntax error.
 */
export function schemaGrants(policy = TARGET_POLICY.SCHEMA) {
  if (!policy) throw new Error("TARGET_POLICY.SCHEMA is missing — schema USAGE cannot be derived, and without it every grant inside bolao/audit is inert");
  return MANAGED_ROLES.map((role) => [role, policy[role] || []]).filter(([, privs]) => privs.length > 0);
}

export function requiredExtensions(model = loadModel()) {
  const out = new Map(BASE_EXTENSIONS.map((e) => [e.name, e]));
  for (const entity of model.entities || []) {
    for (const col of entity.columns || []) {
      // A type may carry a modifier or an array suffix; the extension is keyed by the base name.
      const base = String(col.type || "").trim().toLowerCase().replace(/\(.*$/, "").replace(/\[\]$/, "");
      const ext = TYPE_EXTENSIONS[base];
      if (ext) out.set(ext.name, ext);
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Phase metadata. Ordering and dependencies come from migration_phases.json's ordering invariants. */
import { readSurfaceDdl } from "./read_surface.mjs";

export const PHASE_META = {
  M1: {
    title: "schema, extensions and enum types",
    purpose: "Create the bolao and audit schemas, the pgcrypto extension gen_random_uuid() depends on, and the 14 enum types every later phase references. Nothing else can be created until the types exist.",
    dependsOn: ["M0"],
    entities: [],
    backfill: "none — reference types only",
    appCompat: "TOTAL. Purely additive; the legacy app does not know these schemas exist.",
    rollback: "FULL — DROP SCHEMA ... RESTRICT and DROP TYPE. Safe because nothing references them yet.",
    rollbackClass: "FULL",
  },
  M2: { title: "participant identity", purpose: "participants and participant_identity_links: the identity spine every other domain points at. Created before pools and financial because both reference participant_id.", dependsOn: ["M1"], backfill: "M5-backfill (separate) inserts one participant per distinct normalised email, else normalised name. ZERO merges.", appCompat: "TOTAL — additive.", rollback: "FULL — DROP TABLE; nothing references them yet.", rollbackClass: "FULL" },
  M3: { title: "competitions and editions", purpose: "Reference data for the three competitions and their editions. Hand-authored rows, never derived from bolao_state, which has no competition entity at all.", dependsOn: ["M2"], backfill: "insert the known competitions and editions as reference data", appCompat: "TOTAL — additive.", rollback: "FULL. DROP TABLE competition_editions then competitions, in that order because the FK points that way. Safe while no pool references an edition, which is true until M4 runs. The reference rows are hand-authored and re-insertable from the same source, so nothing is lost.", rollbackClass: "FULL" },
  M4: { title: "pools, fee schedule and entries", purpose: "pools, pool_fee_schedule and pool_entries. expected_fee_amount is a SNAPSHOT on the entry, so a later price change cannot retroactively alter an existing entry's settlement.", dependsOn: ["M3"], backfill: "M8-backfill copies bolao_state.entries[] 1:1; deletedIds[] becomes deleted_at", appCompat: "TOTAL — additive. anon cannot write these; entry creation becomes server-mediated at M11.", rollback: "FULL before backfill; FORWARD-FIX-ONLY after, because deleting backfilled entries would discard rows the app may already have created through the new path.", rollbackClass: "FULL_BEFORE_BACKFILL" },
  M5: { title: "payments, allocations and prizes", purpose: "The money tables. No stored settlement column exists by design: settlement is derived from payment_allocations, and a stored flag would be a second source of truth for money.", dependsOn: ["M4"], backfill: "M9-backfill creates one asserted payment per legacy paid=true with amount NULL and NO allocation", appCompat: "TOTAL — additive; all writes service-only.", rollback: "FULL before backfill. After backfill DATA-RESTORE-REQUIRED for any allocation an operator has since made, because an allocation records a human decision that cannot be recomputed.", rollbackClass: "FULL_BEFORE_BACKFILL" },
  M6: { title: "phases, ties, matches and sync state", purpose: "Competition structure and the provider sync cursor. cutoff_at lives here and is what makes the prediction lock enforceable server-side.", dependsOn: ["M5"], backfill: "phases and fixtures from reference data; sync_state initialised with no last_success_at", appCompat: "TOTAL — additive.", rollback: "FULL. DROP TABLE sync_state, matches, ties, competition_edition_phases. No dependent rows exist until M7, and every row is re-derivable from reference data or from the provider, so a rollback loses only the sync cursor position — which is designed to be restartable.", rollbackClass: "FULL" },
  M7: { title: "match results and predictions", purpose: "match_results (superseded, never overwritten) and predictions. predictions exists as a table here but stays EMPTY: picks remain in pool_entries.picks jsonb until M16, because decomposing them changes the scoring input path.", dependsOn: ["M6"], backfill: "match_results from bolao_state.results{}. predictions deliberately NOT backfilled here.", appCompat: "TOTAL — additive. Scoring continues to read picks jsonb.", rollback: "FULL — DROP TABLE; predictions is empty and match_results is re-derivable from the document.", rollbackClass: "FULL" },
  M8: { title: "audit events and redactable details", purpose: "The audit spine, created BEFORE any backfill runs (ordering correction OC-1) so the largest data movement in the programme is not the one operation with no trail.", dependsOn: ["M7"], backfill: "auditLog[] with free-text detail DROPPED per B1/ADR-008; hash chain computed in document order", appCompat: "TOTAL — additive.", rollback: "FULL before backfill. After: FORWARD-FIX-ONLY — dropping audit rows destroys the evidence of what the migration itself did.", rollbackClass: "FULL_BEFORE_BACKFILL" },
  M9: { title: "outbox events and delivery attempts", purpose: "Durable notification intent, so a delivery failure becomes a retry rather than a silent loss. Created before write-through (M11) needs it.", dependsOn: ["M8"], backfill: "none — the outbox starts empty; historical notifications are not reconstructable", appCompat: "TOTAL — additive.", rollback: "FULL — DROP TABLE. Any undelivered event is lost, which is why rollback must happen while the outbox is empty.", rollbackClass: "FULL" },
  /**
   * DDL-M11 — deliberately namespaced.
   *
   * This repository already carries TWO numbering schemes both calling themselves M1-M10: the DDL-only
   * draft scheme (this one) and model/migration_phases.json's interleaved DDL-and-backfill scheme
   * M0-M17, where "M11" already means write_through_via_server_mediated_writes. Adding a bare "M11"
   * here would put a third meaning on a label that is already ambiguous (BATCH-G-OP-1).
   *
   * So this phase's id carries its scheme: `DDL-M11`. Existing historical references are left alone;
   * only the NEW artefact is unambiguous, which is the smaller and safer change.
   */
  "DDL-M11": {
    title: "league classification",
    purpose: "classification_snapshots and competition_edition_standings: the league table br2026 scoring consumes. Created because no existing entity can hold it — match_results requires goals, ranking_snapshots is keyed on pool_entry_id (a participant, not a club), and ties/matches are knockout pairings. G4/Z4/SA6 are POSITION SLICES of this table and are therefore derived, never stored.",
    dependsOn: ["M6"],
    backfill: "one snapshot per persisted provider file (bolao/br2026/data/espn-standings-normalized.json). Historical snapshots are NOT reconstructable: the cron overwrites the file, so only the current classification exists and earlier ones were never retained.",
    appCompat: "TOTAL — additive. The browser reads the provider snapshot directly today and continues to; nothing about the app's own path changes.",
    rollback: "FULL before any snapshot is imported — DROP TABLE competition_edition_standings then classification_snapshots, in that order because the FK points that way. After import, FORWARD_FIX_ONLY: a snapshot is provider evidence retrieved at an instant that cannot be re-retrieved, and it is exactly what a past round's zone boundaries were computed against.",
    rollbackClass: "FULL_BEFORE_BACKFILL",
  },

  /**
   * DDL-M12 — namespaced for the same reason DDL-M11 is (BATCH-G-OP-1): a bare `M12` would be a third
   * meaning for a label the two existing numbering schemes already disagree about.
   */
  "DDL-M12": {
    title: "request idempotency",
    purpose: "The request idempotency store. All nine write contracts in model/write_contracts.json specify an idempotency lookup and an idempotency record, and until this phase the target had nowhere to put one — so every retry of a money-bearing request was a possible double-write (KPLUS-F018). Uniqueness on (contract, idempotency_key) lives in the database because check-then-insert races with itself: two concurrent retries both find nothing and both write. Created after the outbox, because exactly-once DELIVERY and exactly-once EFFECT are different guarantees and the delivery side must already exist for the write boundary to be assembled at M11.",
    dependsOn: ["M9"],
    backfill: "none — the store starts empty. Historical requests are not reconstructable and must not be invented: a fabricated record would tell a genuine retry that its request had already been executed.",
    appCompat: "TOTAL — additive. Nothing reads or writes it until server-mediated writes are switched on.",
    rollback: "FULL while empty — DROP TABLE. Once it holds money-bearing records this becomes FORWARD_FIX_ONLY: dropping it converts every in-flight retry into a potential double payment, which is the exact failure the table exists to prevent.",
    rollbackClass: "FULL_BEFORE_BACKFILL",
  },

  M13: {
    title: "pool entry cutoff",
    purpose: "Add bolao.pools.entry_cutoff_at — the frozen instant after which a pool refuses entries and prediction edits. Its source, bolao_state['br2026'].cutoffAt, had no target representation, which blocked the br2026 pool backfill (OP-Q22-1). It belongs on `pools` and not on `competition_editions`: an edition's starts_on/ends_on are the COMPETITION's dates, while an entry window is a pool rule, and one edition may host several pools with different windows.",
    dependsOn: ["M4"],
    alterOnly: true,
    backfill: "the br2026 pool's value comes from bolao_state['br2026'].cutoffAt when the pool domain backfills. main and cdb2026 have no such key and stay NULL.",
    appCompat: "TOTAL — an additive nullable column. The legacy app does not read the target schema.",
    rollback: "FULL. ALTER TABLE bolao.pools DROP COLUMN entry_cutoff_at. Nothing references it and no row carries a value until the pool backfill runs.",
    rollbackClass: "FULL_BEFORE_BACKFILL",
  },

  M14: {
    title: "migration lineage",
    purpose: "audit.migration_lineage — row-level provenance for every application row a backfill creates. The campaign has required since its start that every target row resolve to a SOURCE or an APPROVED_DERIVATION and every source element to a target, and there was nowhere in the database to record either direction. PRODMIG-Q25 could not have met its own lineage criterion without this, which is why the canary stopped before writing rather than deferring lineage.",
    dependsOn: ["M13"],
    backfill: "none — it is written BY the backfills, one row per created target row, in the same transaction.",
    appCompat: "TOTAL — additive, in a schema the legacy app cannot reach.",
    rollback: "FULL while empty. Once a backfill has written lineage this becomes the BACKOUT MECHANISM itself: a run's rows are exactly those naming its migration_run_id, so dropping this table would destroy the ability to reverse the backfill it describes.",
    rollbackClass: "FULL_BEFORE_BACKFILL",
  },

  M15: {
    title: "match location, tie lock provenance and the official draw",
    purpose: "Five additive nullable columns for five live document fields that had nowhere to go: bolao.matches.venue and .city, bolao.ties.locked_at and .locked_by, and bolao.competition_edition_phases.official_draw. All five were found by PRODMIG-M15's FIELD-level read-surface contract, after element-level accounting had reported 56 of 56 matches and 28 of 28 ties migrated — which was true, and was concealing every one of them. official_draw is deliberately NOT folded into the existing `topology` column: a draw EVENT and a bracket SHAPE are different facts, `draw_state` is declared derived from the draw, and hiding the draw inside a column named topology is what produced M15-F2. In the same pass `topology` loses its declared legacyPath `phases{}.topology`, a key none of the three production documents carries.",
    dependsOn: ["M6"],
    alterOnly: true,
    backfill: "a separate step reads the five values out of bolao_state['cdb2026'] — 12 venues, 12 cities, 8 locked_at, 8 locked_by, 1 official_draw. This stage adds the columns and writes nothing.",
    appCompat: "TOTAL. Five additive nullable columns; the legacy app does not read the target schema. ADD COLUMN with no DEFAULT and no NOT NULL is catalogue-only in PostgreSQL 11+, so no table is rewritten and no lock is held for a scan.",
    rollback: "FULL. ALTER TABLE ... DROP COLUMN, five times. Safe while the columns are empty; once the backfill has run, dropping them discards the only normalized copy of operator lock provenance and the official draw record — so after backfill this is FORWARD_FIX_ONLY, for the same reason M8 is.",
    rollbackClass: "FULL_BEFORE_BACKFILL",
  },

  M16: {
    title: "normalized read surface",
    purpose: "bolao.read_document(text) and bolao.v_state_document — the first objects anywhere that return bolao.* in the shape the applications read. GNG-2C's missing DESTINATION: until this existed the normalized -> legacy round trip had no origin, so a read rollback had nothing to roll back FROM and could not be proven. The view deliberately matches public.bolao_state_public's (id, state, updated_at) contract so a client's readTable can be re-pointed at it without an application code change.",
    dependsOn: ["M15"],
    readSurface: true,
    backfill: "none — it reads. It writes nothing and owns no rows.",
    appCompat: "TOTAL, and by construction: no browser role is granted anything. service_role only. Zero of three products are read-routable today, so a browser-reachable surface would be a lossy document one config edit away from being served.",
    rollback: "FULL. DROP VIEW bolao.v_state_document then DROP FUNCTION bolao.read_document(text). Nothing depends on either, no row is owned by either, and no privilege outside the two objects is touched — so a rollback leaves the database bit-identical to the state before the stage.",
    rollbackClass: "FULL",
  },

  M17: {
    title: "classification zone predictions",
    purpose: "bolao.classification_predictions — a home for br2026's entries[].picks {g4:[4], sa6:[6], z4:[4]}, 154 live club-zone assertions that had no normalized representation at all. They cannot live in bolao.predictions: CHECK pred_subject_exactly_one requires a match_id XOR a tie_id and a zone pick has neither. They are equally not classification_snapshots/competition_edition_standings, which model the PROVIDER's observed league table and are an observation rather than a prediction — a queued task proposed exactly that mapping and the schema refutes it. The ordinal column is load-bearing: br2026 scoring compares picks POSITIONALLY and pays a different score for the right club in the wrong position, so an unordered representation would change what every entry scores.",
    dependsOn: ["M7"],
    backfill: "a separate step reads bolao_state['br2026'].entries[].picks. 154 assertions across 11 entries; only the 4 entries not blocked by Q33-A1 are insertable today, so the backfill is scoped and its denominator stated.",
    appCompat: "TOTAL — additive, in a schema the legacy app cannot reach. br2026 continues to score from the document.",
    rollback: "FULL. DROP TABLE bolao.classification_predictions. Every row is re-derivable from bolao_state['br2026'] for as long as legacy is retained, and legacy is retained.",
    rollbackClass: "FULL_BEFORE_BACKFILL",
  },

  M10: { title: "ranking snapshots", purpose: "Published leaderboard history. Append-only: no role may UPDATE a snapshot, because editing a published standing rewrites what participants already acted on.", dependsOn: ["M9"], backfill: "none in this phase; snapshots accrue from the ranking job after cutover", appCompat: "TOTAL — additive.", rollback: "FULL. DROP TABLE ranking_snapshots while it is still empty. Snapshots only begin accruing after cutover, so a rollback at this point discards nothing. Once snapshots exist this becomes FORWARD_FIX_ONLY, because a published standing is history a participant may already have acted on.", rollbackClass: "FULL" },
};

const q = (s) => `"${s}"`;
const fq = (schema, name) => `${schema}.${q(name)}`;

/** Split an FK target `schema.table.column` into parts. */
function fkParts(fk) {
  const bits = fk.split(".");
  return { schema: bits[0], table: bits[1], column: bits[2] };
}

/**
 * Column DDL. Every WS3A rule is enforced here — an emitter that cannot produce a bad column is stronger
 * than a review that might notice one.
 */
function columnDdl(entity, col) {
  const c = withDefaults(col);
  const errors = [];
  if (/\b(serial|bigserial)\b/i.test(c.type)) errors.push(`${entity.name}.${c.sql}: serial is refused — use uuid with gen_random_uuid(), which is stable across restores and does not leak insertion order`);
  if (/\b(float|real|double precision|money)\b/i.test(c.type)) errors.push(`${entity.name}.${c.sql}: ${c.type} is refused for any column, and for money in particular`);
  if (/^timestamp$/i.test(c.type) || /timestamp without time zone/i.test(c.type)) errors.push(`${entity.name}.${c.sql}: bare timestamp is refused — use timestamptz so an instant means one instant`);
  if (c.financial === "MONETARY_AMOUNT" && !/^numeric\(\d+,\d+\)$/.test(c.type)) errors.push(`${entity.name}.${c.sql}: money must be numeric(p,s)`);

  // A DERIVED_VIEW column is not a column at all — it must not be emitted.
  if (c.generated === "DERIVED_VIEW") return { sql: null, derived: true, errors, comment: null };

  const parts = [`  ${q(c.sql).padEnd(34)} ${c.type}`];
  if (!c.nullable) parts.push("NOT NULL");
  if (c.default) parts.push(`DEFAULT ${c.default}`);
  return {
    sql: parts.join(" "),
    derived: false,
    errors,
    comment: c.pii && c.pii !== "NONE" ? `${c.pii}` : null,
    col: c,
  };
}

function tableDdl(entity) {
  const errors = [];
  // A column carrying `addedInPhase` was introduced AFTER this table was created, so it belongs to that
  // later ALTER phase and must not appear here. Without this, adding a column to an already-applied
  // entity silently rewrites its original migration — and `promote_expand_stage.mjs --check` would
  // correctly report the production file as DRIFTED, which is the gate doing its job about a change
  // nobody could then apply.
  const createTimeColumns = entity.columns.filter((c) => !c.addedInPhase);
  const cols = createTimeColumns.map((c) => columnDdl(entity, c));
  for (const c of cols) errors.push(...c.errors);
  const emitted = cols.filter((c) => !c.derived);
  const derived = cols.filter((c) => c.derived);

  const pk = createTimeColumns.map(withDefaults).filter((c) => c.pk);
  if (pk.length === 0) errors.push(`${entity.name}: no primary key`);

  const L = [];
  L.push(`CREATE TABLE ${fq(entity.schema, entity.name)} (`);
  const lines = emitted.map((c) => c.sql);
  lines.push(`  CONSTRAINT ${q(`${entity.name}_pkey`)} PRIMARY KEY (${pk.map((c) => q(c.sql)).join(", ")})`);

  // Explicit FKs with explicit ON DELETE. Emitted NOT VALID so the table scan is a separate,
  // interruptible step — see the VALIDATE block below.
  for (const c of entity.columns.map(withDefaults)) {
    if (!c.fk) continue;
    const t = fkParts(c.fk);
    if (!c.onDelete) { errors.push(`${entity.name}.${c.sql}: FK with no explicit ON DELETE`); continue; }
    if (c.onDelete === "CASCADE" && entity.domain === "financial") errors.push(`${entity.name}.${c.sql}: ON DELETE CASCADE on a financial table`);
    lines.push(`  CONSTRAINT ${q(`${entity.name}_${c.sql}_fkey`)} FOREIGN KEY (${q(c.sql)}) ` +
      `REFERENCES ${t.schema}.${q(t.table)} (${q(t.column)}) ON DELETE ${c.onDelete} ON UPDATE RESTRICT`);
  }
  /**
   * Column-level uniqueness.
   *
   * KPLUS-F009. `if (c.unique)` treated the STRING "PARTIAL_WHERE_NOT_NULL" as a request for a TOTAL
   * unique constraint, because a non-empty string is truthy. Those two are not the same promise and
   * for `participants.email` they actively contradict each other: the declared partial index is
   * `WHERE email IS NOT NULL AND redacted_at IS NULL`, and its stated reason is that a redacted row
   * must not block reuse of its address — which the total constraint then blocks anyway. The
   * concurrency lab hit exactly that (workstream F, F11).
   *
   * So only `unique === true` earns an inline UNIQUE constraint. A partial declaration is enforced by
   * its partial index and by nothing else, which is what the model asked for.
   */
  for (const c of entity.columns.map(withDefaults)) {
    if (c.unique === true) lines.push(`  CONSTRAINT ${q(`${entity.name}_${c.sql}_key`)} UNIQUE (${q(c.sql)})`);
  }
  for (const k of entity.checks || []) {
    lines.push(`  CONSTRAINT ${q(k.name)} CHECK (${k.expr})`);
  }
  L.push(lines.join(",\n"));
  L.push(");");
  L.push("");
  L.push(`COMMENT ON TABLE ${fq(entity.schema, entity.name)} IS ${sqlLit(entity.purpose)};`);
  for (const c of emitted) {
    if (c.comment) L.push(`COMMENT ON COLUMN ${fq(entity.schema, entity.name)}.${q(c.col.sql)} IS ${sqlLit(`PII class: ${c.comment}`)};`);
  }
  for (const d of derived) {
    L.push(`-- ${d.errors.length ? "" : ""}NOTE: ${entity.name}.${withDefaults(d.col || {}).sql || "(derived)"} is DERIVED_VIEW and is deliberately NOT a column.`);
  }
  for (const k of entity.checks || []) {
    L.push(`-- CHECK ${k.name}: ${k.why}`);
  }
  return { sql: L.join("\n"), errors, derivedNames: derived.map((d) => (d.col ? d.col.sql : "?")) };
}

const sqlLit = (s) => `'${String(s ?? "").replace(/'/g, "''")}'`;

/**
 * KPLUS-F013(a) — `updated_at` is maintained by the DATABASE, because the model says it is.
 *
 * The model's own words on `participants.updated_at`: "Maintained by trigger, not by the application
 * — bolao_state's updated_at was app-maintained and therefore unreliable." That was a statement about
 * the database that the database had never been told. Workstream O put it to a real server: a row was
 * updated and `updated_at` did not move, because the generator emitted no triggers at all. Every
 * `updated_at` in the target would have read as its insert time forever — reproducing precisely the
 * unreliability the model cites as its reason for existing, and doing it more completely than the
 * legacy column it replaces, which was at least sometimes written.
 *
 * TWO PROPERTIES, BOTH DELIBERATE:
 *
 *   · The assignment is UNCONDITIONAL, so a client that supplies its own `updated_at` has it
 *     overwritten. A timestamp the caller can choose is not evidence of anything, and the model
 *     classes this column as server-maintained.
 *
 *   · The trigger is gated on `OLD.* IS DISTINCT FROM NEW.*`, so a write that changes nothing does not
 *     advance the timestamp. `updated_at` then means "when this row last actually changed", which is
 *     what every consumer of it assumes. Without the guard, an idempotent re-save — which the sync
 *     paths do routinely — would keep moving a timestamp nobody's data had touched.
 */
export const UPDATED_AT_FUNCTION_DDL = `-- KPLUS-F013(a): updated_at is server-maintained. A client-supplied value is deliberately overwritten.
CREATE OR REPLACE FUNCTION bolao.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION bolao.set_updated_at() IS 'BEFORE UPDATE trigger: stamps updated_at from the server clock, overriding any client-supplied value. Attached only to entities whose model declares an updated_at column.';

-- KPLUS-F023. EXECUTE is revoked from PUBLIC even though this function returns trigger and
-- therefore cannot be called at all. The grant is inert today; it is the DEFAULT that is the
-- defect, because the next function in this schema that returns something callable inherits it
-- silently -- audit.event_canonical_v1 and audit.event_hash_v1 are exactly that case, arriving
-- with KPLUS-F014. Revoking EXECUTE does not affect trigger firing: a trigger runs as part of
-- the table's own machinery, not as a call made by the writing role.
REVOKE ALL ON FUNCTION bolao.set_updated_at() FROM PUBLIC;`;

/** The entities whose model declares `updated_at`. Nothing else gets a trigger — an append-only table
 *  has no update to stamp, and attaching one "for consistency" would assert a mutability it forbids. */
export function entityHasUpdatedAt(entity) {
  return (entity.columns || []).map(withDefaults).some((c) => c.sql === "updated_at");
}

export function updatedAtTriggerDdl(entity) {
  if (!entityHasUpdatedAt(entity)) return null;
  const name = `${entity.name}_set_updated_at`;
  return `-- updated_at is maintained here, not by callers. The WHEN guard means a no-op write does not
-- advance it, so the column reads as "when this row last actually changed".
CREATE TRIGGER ${q(name)}
  BEFORE UPDATE ON ${fq(entity.schema, entity.name)}
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION bolao.set_updated_at();`;
}

/**
 * KPLUS-F013(b)(c) — the audit spine's integrity, enforced by the database.
 *
 * `TARGET_DATA_MODEL.md` states the requirement exactly: "Enforcement: BEFORE UPDATE/BEFORE DELETE
 * triggers that raise; BEFORE INSERT trigger computing the chain." None of it existed. Workstream O
 * measured the consequences: a client-supplied `event_hash` of 'CLIENT-SUPPLIED-NONSENSE' was stored
 * verbatim, and both UPDATE and DELETE on audit rows succeeded. The audit log attested to whatever
 * the writer chose to say, and could be edited afterwards to say something else.
 *
 * WHAT THE CHAIN COVERS, AND WHY THE SIDECAR IS OUT
 * The hash is computed over the NON-PII columns of `audit_events` only. `audit_event_details` — the
 * sidecar holding before/after snapshots — is a different table and is deliberately excluded, which
 * is the whole mechanism behind G-02: PII can be redacted from the sidecar without invalidating a
 * single link in the chain. An audit log you cannot redact and a privacy right you cannot honour are
 * the same problem, and this is how the model resolves it.
 *
 * FINDING THE TAIL WITHOUT TRUSTING A CLOCK
 * The predecessor is not chosen by sorting on `occurred_at`: two events can share a timestamp, and
 * `audit_event_id` is a random uuid, so a sort can disagree with insertion order. The tail is instead
 * the OPEN END of the chain — the one event whose hash nothing references as its predecessor. That is
 * exact, and it depends on no clock and no identifier ordering.
 *
 * TWO INDEPENDENT DEFENCES AGAINST A FORK
 * A fork — two events both claiming the same predecessor — would make the chain a tree and destroy
 * the property it exists for. First defence: the insert serialises on a transaction-scoped advisory
 * lock, so two concurrent writers cannot both read the same open end. Second defence: a UNIQUE index
 * on `previous_event_hash` makes a fork impossible even if the lock were removed. Performance is
 * secondary to integrity at this application's scale, and one global lock on audit writes is a price
 * worth paying for a chain that cannot branch.
 */
export const AUDIT_CHAIN_DDL = `-- KPLUS-F014. The canonical serialisation lives in ONE function, and everything that needs a chain
-- hash calls it: the append trigger below, the bulk chain builder the M10 audit backfill runs, and every
-- verifier. It was previously written out inline in the trigger, which meant the backfill and the
-- verifiers each had to restate it — and a restatement that drifts by one separator produces hashes that
-- look fine, verify fine against themselves, and are incompatible with every event appended afterwards.
-- That is the exact failure mode CLAUDE.md records for send_result_email.py, in the audit spine.
--
-- STABLE, not IMMUTABLE: to_char() over a timestamp depends on DateStyle/lc_time and
-- timezone(text, timestamptz) depends on the zone database, so neither is immutable in PostgreSQL's
-- sense. STABLE is the strongest correct marking and it is sufficient here (this is never indexed).
--
-- The column set and order are fixed. Changing either changes every future hash, which is why the
-- version tag 'v1' is the first field: a future v2 is a deliberate, reviewed migration that can be told
-- apart from a v1 hash, rather than a silent break.
--
-- The parameters are SCALARS rather than an audit.audit_events row, and named. A row-typed parameter
-- would need the table to exist, and these functions are created in M1 — seven phases before it. Named
-- arguments are then mandatory at every call site (see below), so fourteen positional parameters cannot
-- silently shift: transposing two same-typed columns is precisely the mistake that would produce a
-- plausible, self-consistent, wrong chain.
CREATE OR REPLACE FUNCTION audit.event_canonical_v1(
  p_previous_event_hash text,
  p_audit_event_id      uuid,
  p_occurred_at         timestamptz,
  p_actor_user_id       uuid,
  p_actor_role          text,
  p_action              text,
  p_aggregate_type      text,
  p_aggregate_id        uuid,
  p_correlation_id      uuid,
  p_request_id          uuid,
  p_source              text,
  p_safe_metadata       jsonb,
  p_reason              text
) RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, audit, pg_temp
AS $$
  -- chr(31) (unit separator) between fields and chr(30) (record separator) for NULL, both written as
  -- SQL function calls rather than string escapes so nothing depends on how an escape survives
  -- generation. Neither character can appear in these columns' real values, so no combination of values
  -- can be re-parsed as a different combination. safe_metadata is rendered through jsonb, which
  -- normalises key order and whitespace, so a semantically identical payload always hashes the same.
  SELECT concat_ws(chr(31),
    'v1',
    coalesce(p_previous_event_hash, chr(30)),
    p_audit_event_id::text,
    to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor_user_id::text, chr(30)),
    coalesce(p_actor_role, chr(30)),
    p_action,
    p_aggregate_type,
    coalesce(p_aggregate_id::text, chr(30)),
    coalesce(p_correlation_id::text, chr(30)),
    coalesce(p_request_id::text, chr(30)),
    p_source,
    p_safe_metadata::text,
    coalesce(p_reason, chr(30))
  );
$$;
COMMENT ON FUNCTION audit.event_canonical_v1(text, uuid, timestamptz, uuid, text, text, text, uuid, uuid, uuid, text, jsonb, text) IS 'Canonical serialisation of an audit event for hashing, version v1. The single definition — the append trigger, the M10 bulk chain builder and every verifier call this rather than restating it (KPLUS-F014). Covers the non-PII columns of audit_events only; the audit_event_details sidecar is excluded so PII can be redacted without breaking the chain (G-02). Call it with NAMED arguments.';

-- sha256() and convert_to() are both built into pg_catalog. digest() would have meant depending on
-- pgcrypto living in a schema this function's pinned search_path deliberately excludes — and pinning the
-- search_path is not negotiable for a SECURITY-relevant function.
CREATE OR REPLACE FUNCTION audit.event_hash_v1(p_canonical text) RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, audit, pg_temp
AS $$
  SELECT encode(sha256(convert_to(p_canonical, 'UTF8')), 'hex');
$$;
COMMENT ON FUNCTION audit.event_hash_v1(text) IS 'The chain hash of an audit event, over the output of audit.event_canonical_v1(). Given a row whose previous_event_hash is already known, this is the value the append trigger would compute for it — which is what lets the M10 backfill build a chain in bulk that a later live append continues seamlessly.';

-- Unlike the four trigger functions (which return trigger and cannot be called at all), these two ARE
-- callable, so they would inherit EXECUTE from PUBLIC — the silent inheritance KPLUS-F023 warns about,
-- arriving with the first callable function, exactly as predicted. Both are pure functions of their
-- arguments and read no table, so this is hardening rather than an incident; the retrofit of the four
-- existing trigger functions stays a separate change with its own proof.
REVOKE ALL ON FUNCTION audit.event_canonical_v1(text, uuid, timestamptz, uuid, text, text, text, uuid, uuid, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.event_hash_v1(text) FROM PUBLIC;

-- KPLUS-F028, found by the F027 least-privilege lab and NOT by anything that ran before it.
--
-- audit.compute_event_chain() is SECURITY INVOKER. The trigger itself fires as part of the table's
-- machinery and needs no EXECUTE — that part of KPLUS-F023's reasoning is correct. But the two calls
-- INSIDE its body are ordinary function calls, checked against the role performing the INSERT. So the
-- REVOKE above, which is right, took EXECUTE away from the runtime as well as from PUBLIC, and every
-- audit append by a non-superuser runtime fails with "permission denied for function event_hash_v1".
--
-- It passed unnoticed because the local rehearsal writes as a superuser, which is the same asymmetry
-- KPLUS-F013 and KPLUS-F027 both turned on. Proven by F027-8a: service_role's append is refused
-- without these grants and succeeds with them, with nothing else changed.
--
-- The grants are narrow by construction rather than by promise: both functions are IMMUTABLE, take
-- everything they use as arguments, read no table and hold no privilege of their own. Being able to
-- call them buys a caller a SHA-256 of a string it already had. It cannot forge a chain entry with
-- them, because the trigger overwrites any client-supplied hash before the row is stored.
GRANT EXECUTE ON FUNCTION audit.event_canonical_v1(text, uuid, timestamptz, uuid, text, text, text, uuid, uuid, uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION audit.event_hash_v1(text) TO service_role;

-- KPLUS-F013(b). The chain is computed by the server. Any client-supplied
-- event_hash or previous_event_hash is discarded: a hash the caller chooses attests to nothing.
CREATE OR REPLACE FUNCTION audit.compute_event_chain() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, audit, pg_temp
AS $$
DECLARE
  tail_hash text;
BEGIN
  -- The tail is read from the single-row chain head, and SELECT ... FOR UPDATE on that row both gives
  -- the value and serialises concurrent appenders: two writers cannot read the same tail, because the
  -- second waits for the first to commit.
  --
  -- The first version of this function searched audit_events for the OPEN END — the event nothing
  -- points back to. That is exact and needs no extra state, and it is also a scan of the entire audit
  -- log on every single insert. Measured: a 200,000-row bulk load did not finish. Appending to a log
  -- must be O(1), so the tail is now kept where it can be read in one row fetch.
  SELECT h.event_hash INTO tail_hash
  FROM audit.audit_chain_head h
  WHERE h.singleton
  FOR UPDATE;

  NEW.previous_event_hash := tail_hash;

  -- The canonical form and the hash come from the shared functions, not from a copy written out here.
  -- See KPLUS-F014 above: the bulk chain builder must produce byte-identical hashes to this trigger, and
  -- the only way to guarantee that is for both to run the same code. Named arguments, so a column can
  -- never be passed in the wrong slot.
  NEW.event_hash := audit.event_hash_v1(audit.event_canonical_v1(
    p_previous_event_hash => NEW.previous_event_hash,
    p_audit_event_id      => NEW.audit_event_id,
    p_occurred_at         => NEW.occurred_at,
    p_actor_user_id       => NEW.actor_user_id,
    p_actor_role          => NEW.actor_role,
    p_action              => NEW.action,
    p_aggregate_type      => NEW.aggregate_type,
    p_aggregate_id        => NEW.aggregate_id,
    p_correlation_id      => NEW.correlation_id,
    p_request_id          => NEW.request_id,
    p_source              => NEW.source,
    p_safe_metadata       => NEW.safe_metadata,
    p_reason              => NEW.reason
  ));

  -- Advance the head. The row lock taken above is still held, so no other appender can interleave.
  UPDATE audit.audit_chain_head
     SET event_hash = NEW.event_hash, event_count = event_count + 1, updated_at = now()
   WHERE singleton;

  RETURN NEW;
END;
$$;
-- The head must exist before the first append can read it. One row, guarded by its own CHECK.
COMMENT ON FUNCTION audit.compute_event_chain() IS 'BEFORE INSERT on audit.audit_events: links the row to the chain tail and computes event_hash over the non-PII columns of THIS table only. The audit_event_details sidecar is excluded so PII can be redacted without breaking the chain (G-02).';

-- KPLUS-F023. EXECUTE is revoked from PUBLIC even though this function returns trigger and
-- therefore cannot be called at all. The grant is inert today; it is the DEFAULT that is the
-- defect, because the next function in this schema that returns something callable inherits it
-- silently -- audit.event_canonical_v1 and audit.event_hash_v1 are exactly that case, arriving
-- with KPLUS-F014. Revoking EXECUTE does not affect trigger firing: a trigger runs as part of
-- the table's own machinery, not as a call made by the writing role.
REVOKE ALL ON FUNCTION audit.compute_event_chain() FROM PUBLIC;

-- KPLUS-F013(c). Append-only, enforced by the database rather than by convention. Note this is a
-- trigger and not merely a privilege: a privilege protects against roles that lack it, while a trigger
-- also protects against the role that owns the table — which is the role a migration or a compromised
-- service path actually runs as.
CREATE OR REPLACE FUNCTION audit.refuse_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'audit.% is append-only: % is refused (KPLUS-F013c). An audit log that can be rewritten records what someone last wanted it to say.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
COMMENT ON FUNCTION audit.refuse_mutation() IS 'BEFORE UPDATE/DELETE trigger: refuses the operation unconditionally. Append-only enforcement for the audit spine.';

-- KPLUS-F023. EXECUTE is revoked from PUBLIC even though this function returns trigger and
-- therefore cannot be called at all. The grant is inert today; it is the DEFAULT that is the
-- defect, because the next function in this schema that returns something callable inherits it
-- silently -- audit.event_canonical_v1 and audit.event_hash_v1 are exactly that case, arriving
-- with KPLUS-F014. Revoking EXECUTE does not affect trigger firing: a trigger runs as part of
-- the table's own machinery, not as a call made by the writing role.
REVOKE ALL ON FUNCTION audit.refuse_mutation() FROM PUBLIC;`;

/**
 * KPLUS-F019 — the payment-allocation invariants, enforced by the DATABASE.
 *
 * `model/write_contracts.json`'s allocatePayment states three rules about money: the allocated total
 * may not exceed the payment ("checked INSIDE the transaction under FOR UPDATE"), all three
 * currencies must agree, and a legacy-asserted payment cannot be allocated at all. Workstream N put
 * each of them to the real server in raw SQL, with the contract code out of the call path, and the
 * database accepted every violation:
 *
 *   · two transactions each allocated 60.00 of a 100.00 payment and both committed — 120.00 allocated
 *     against 100.00 received, no error raised;
 *   · a BRL allocation of a USD payment against a USD entry was accepted, which is an exchange rate of
 *     1.0 applied to somebody's money and recorded as fact;
 *   · an allocation was accepted against a payment with `amount IS NULL` — the shape the M9 backfill
 *     gives every legacy `paid: true` assertion. That row asserts only that someone said a person had
 *     paid; allocating against it manufactures a settled amount from an assertion that carries none,
 *     which is the precise thing KPLUS-OP-4(a) is unresolved about.
 *
 * WHY A TRIGGER AND NOT A CHECK CONSTRAINT
 * All three span rows — a CHECK sees one row of one table and none of these questions can be answered
 * from one row. The alternative, a stored `allocated_total` on payments with a CHECK against it, adds
 * a second source of truth for money and has to be kept correct by the same writes it is meant to
 * police; the model rejects stored settlement state for exactly this reason ("a stored flag would be a
 * second source of truth for money"). See ADR-K03.
 *
 * WHY THE LOCK IS TAKEN HERE AND NOT LEFT TO THE CALLER
 * The over-allocation above is not a missing check; the contract has the check. It is a missing LOCK
 * in any writer that is not the contract. Taking `FOR UPDATE` on the payment row inside the trigger
 * moves the serialisation from something each caller must remember into something none of them can
 * skip — a psql session, a future service, a well-meant repair script all get it.
 */
export const PAYMENT_ALLOCATION_DDL = `-- KPLUS-F019: the allocation invariants are cross-row, so they live in a trigger, not a CHECK.
CREATE OR REPLACE FUNCTION bolao.check_payment_allocation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pay_amount   numeric;
  pay_currency character(3);
  pay_kind     bolao.payment_kind;
  entry_ccy    character(3);
  allocated    numeric;
BEGIN
  -- FOR UPDATE, not a plain read. This is the serialisation point: concurrent allocations against one
  -- payment queue here, so the total below is computed against a state no other transaction can be
  -- changing. Without it two writers each see the same total and both pass their own check.
  SELECT p.amount, p.currency, p.kind INTO pay_amount, pay_currency, pay_kind
    FROM bolao.payments p WHERE p.payment_id = NEW.payment_id FOR UPDATE;

  IF pay_amount IS NULL THEN
    RAISE EXCEPTION 'payment % carries no amount and cannot be allocated', NEW.payment_id
      USING ERRCODE = 'check_violation',
            HINT = 'A payment with amount IS NULL is a legacy assertion that someone paid, not a record of how much. Allocating against it would invent a settled amount no evidence supports.';
  END IF;

  IF pay_amount <= 0 THEN
    RAISE EXCEPTION 'payment % has a non-positive amount (kind %) and is not allocatable', NEW.payment_id, pay_kind
      USING ERRCODE = 'check_violation',
            HINT = 'Allocations are positive by contract. A refund, reversal or chargeback is recorded as its own payment, not as a negative allocation of another one.';
  END IF;

  IF NEW.allocated_amount IS NULL OR NEW.allocated_amount <= 0 THEN
    RAISE EXCEPTION 'allocated_amount must be positive, got %', NEW.allocated_amount
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.currency <> pay_currency THEN
    RAISE EXCEPTION 'allocation currency % does not match payment currency %', NEW.currency, pay_currency
      USING ERRCODE = 'check_violation',
            HINT = 'Allocating across currencies silently applies an exchange rate of 1.0 to real money.';
  END IF;

  SELECT e.expected_fee_currency INTO entry_ccy
    FROM bolao.pool_entries e WHERE e.pool_entry_id = NEW.pool_entry_id;
  IF entry_ccy IS NOT NULL AND NEW.currency <> entry_ccy THEN
    RAISE EXCEPTION 'allocation currency % does not match the entry fee currency %', NEW.currency, entry_ccy
      USING ERRCODE = 'check_violation';
  END IF;

  -- The row being written is excluded so this is correct for an UPDATE as well as an INSERT.
  SELECT coalesce(sum(a.allocated_amount), 0) INTO allocated
    FROM bolao.payment_allocations a
    WHERE a.payment_id = NEW.payment_id AND a.allocation_id IS DISTINCT FROM NEW.allocation_id;

  IF allocated + NEW.allocated_amount > pay_amount THEN
    RAISE EXCEPTION 'allocating % would take payment % to % of a received %',
      NEW.allocated_amount, NEW.payment_id, allocated + NEW.allocated_amount, pay_amount
      USING ERRCODE = 'check_violation',
            HINT = 'There is deliberately NO cap against the entry fee — exceeding that is OVERPAID, a reportable state. This cap is against the money actually received.';
  END IF;

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION bolao.check_payment_allocation() IS 'BEFORE INSERT/UPDATE trigger on payment_allocations: locks the payment row, then enforces that the payment has a positive amount, that payment, allocation and entry currencies agree, and that the allocated total never exceeds the amount received.';

-- KPLUS-F023. EXECUTE is revoked from PUBLIC even though this function returns trigger and
-- therefore cannot be called at all. The grant is inert today; it is the DEFAULT that is the
-- defect, because the next function in this schema that returns something callable inherits it
-- silently -- audit.event_canonical_v1 and audit.event_hash_v1 are exactly that case, arriving
-- with KPLUS-F014. Revoking EXECUTE does not affect trigger firing: a trigger runs as part of
-- the table's own machinery, not as a call made by the writing role.
REVOKE ALL ON FUNCTION bolao.check_payment_allocation() FROM PUBLIC;`;

/**
 * KPLUS-F020 / KPLUS-D01 — the cross-row facts no single-row control can hold.
 *
 * Workstream N put three invariants to the real server with the contract out of the call path and the
 * database accepted every violation: a snapshot holding positions 1 and 4 with 2 and 3 absent; a
 * snapshot declaring `club_count = 4` while holding two standing rows; and a prize declaration whose
 * gross total exceeded everything the pool had collected.
 *
 * WHY A DEFERRED CONSTRAINT TRIGGER AND NOT A CHECK
 * A CHECK sees one row. "Positions are contiguous 1..N" and "club_count equals the rows that exist" are
 * facts about a SET of rows, and neither is true partway through the insert that creates them — after
 * the first of twenty standings rows the snapshot is, correctly, incomplete. An immediate trigger would
 * therefore reject the legitimate load at row one. `DEFERRABLE INITIALLY DEFERRED` moves the check to
 * COMMIT, which is the first moment the question is even meaningful.
 *
 * WHY IT MATTERS THAT THEY ARE IN THE DATABASE
 * `importClassificationSnapshot` already states the contiguity rule, and BR2026's G4/Z4 zones are
 * SLICES of the position list — a hole moves the boundary, and the bolao is scored on which clubs fall
 * inside it. A rule that lives only in the importer is a rule that a psql session, a repair script or a
 * future service does not have. This is the KPLUS-F019 pattern applied to the next three invariants.
 */
export const SNAPSHOT_INTEGRITY_DDL = `-- KPLUS-F020: contiguity and club_count are facts about a SET of rows, so they are checked at COMMIT.
CREATE OR REPLACE FUNCTION bolao.check_snapshot_completeness() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  snap_id      uuid;
  declared     integer;
  actual       integer;
  distinct_pos integer;
  max_pos      integer;
BEGIN
  -- Both tables carry this column: it is the snapshot's own key and the standings' foreign key, so one
  -- expression serves every table and every operation. OLD is used for DELETE, where NEW is null.
  snap_id := coalesce(NEW.classification_snapshot_id, OLD.classification_snapshot_id);

  SELECT s.club_count INTO declared
    FROM bolao.classification_snapshots s
   WHERE s.classification_snapshot_id = snap_id;
  -- The snapshot itself was removed in this transaction. There is no longer anything to be consistent
  -- with, and raising here would refuse a legitimate teardown rather than catch an inconsistency.
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*), count(DISTINCT st.position), max(st.position)
    INTO actual, distinct_pos, max_pos
    FROM bolao.competition_edition_standings st
   WHERE st.classification_snapshot_id = snap_id;

  IF actual <> declared THEN
    RAISE EXCEPTION 'classification snapshot % declares club_count=% but holds % standing row(s)', snap_id, declared, actual
      USING ERRCODE = 'check_violation',
            HINT = 'club_count is what consumers trust to know whether they received a whole league table. A snapshot that overstates it reports a complete table while a club is missing, and the BR2026 zone slices are taken from that list.';
  END IF;

  -- Contiguity, without sorting: the position CHECK already forces every value positive, so N distinct
  -- positive values whose maximum is N can only be exactly 1..N. Stating it this way means the check is
  -- one aggregate rather than a scan of an ordered sequence looking for a step.
  IF actual > 0 AND (distinct_pos <> actual OR max_pos <> actual) THEN
    RAISE EXCEPTION 'classification snapshot % has non-contiguous positions: % row(s), % distinct position(s), highest position %', snap_id, actual, distinct_pos, max_pos
      USING ERRCODE = 'check_violation',
            HINT = 'Positions must be the contiguous range 1..N because the G4/Z4 zones are slices of it. A gap silently moves the boundary, changing which clubs are recorded as qualified or relegated — and the bolao is scored on that.';
  END IF;

  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION bolao.check_snapshot_completeness() IS 'DEFERRED constraint trigger on classification_snapshots and competition_edition_standings: at COMMIT, club_count must equal the standing rows that exist and their positions must be the contiguous range 1..N. Cross-row facts, so not expressible as a CHECK. See KPLUS-F020 and ADR-K09.';
REVOKE ALL ON FUNCTION bolao.check_snapshot_completeness() FROM PUBLIC;

-- KPLUS-D01 (second half): a pool may not declare more prize money than it collected.
CREATE OR REPLACE FUNCTION bolao.check_prize_pool_solvency() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  p_id     uuid;
  offender record;
BEGIN
  IF TG_TABLE_NAME = 'prize_allocations' THEN
    p_id := coalesce(NEW.pool_id, OLD.pool_id);
  ELSE
    -- payment_allocations: the pool is one hop away, through the entry the payment was applied to.
    SELECT e.pool_id INTO p_id FROM bolao.pool_entries e
     WHERE e.pool_entry_id = coalesce(NEW.pool_entry_id, OLD.pool_entry_id);
  END IF;
  IF p_id IS NULL THEN RETURN NULL; END IF;

  /**
   * Compared PER CURRENCY, not on one total.
   *
   * Summing gross_amount across currencies would compare a number that is not an amount of anything
   * against another number that is not an amount of anything, and the comparison could pass while the
   * pool is insolvent in the currency it actually owes. Grouping makes the check sound without this
   * function having to also decide whether a declaration may mix currencies, which is a separate rule.
   */
  SELECT * INTO offender FROM (
    SELECT coalesce(d.currency, c.currency) AS ccy,
           coalesce(d.declared, 0) AS declared,
           coalesce(c.collected, 0) AS collected
      FROM (SELECT pz.currency, sum(pz.gross_amount) AS declared
              FROM bolao.prize_allocations pz WHERE pz.pool_id = p_id GROUP BY pz.currency) d
      FULL JOIN (SELECT pa.currency, sum(pa.allocated_amount) AS collected
                   FROM bolao.payment_allocations pa
                   JOIN bolao.pool_entries e ON e.pool_entry_id = pa.pool_entry_id
                  WHERE e.pool_id = p_id GROUP BY pa.currency) c ON c.currency = d.currency
  ) t
  WHERE t.declared > t.collected
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'pool % declares % % in prizes but collected only %', p_id, offender.declared, offender.ccy, offender.collected
      USING ERRCODE = 'check_violation',
            HINT = 'Paying out more than was collected is unrecoverable, which is why recordPrize states it as an invariant. Note that a pool whose payments are not yet ALLOCATED to entries reads as having collected nothing — that is the fail-closed direction, and it is the same KPLUS-OP-4(a) dependency that stops the financial reports.';
  END IF;

  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION bolao.check_prize_pool_solvency() IS 'DEFERRED constraint trigger: at COMMIT, per currency, a pool''s declared prize gross may not exceed what its entries collected in allocated payments. recordPrize states this invariant; Workstream N measured the database accepting a violation. See KPLUS-D01 and ADR-K09.';
REVOKE ALL ON FUNCTION bolao.check_prize_pool_solvency() FROM PUBLIC;`;

/** Attached to the one table whose rows decide how much of a received payment is considered settled. */
export function paymentAllocationTriggerDdl(entity) {
  if (entity.schema !== "bolao" || entity.name !== "payment_allocations") return null;
  return `-- The allocation invariants are enforced for EVERY writer, not only for callers that remember
-- to take the payment row lock themselves. See KPLUS-F019 and ADR-K03.
CREATE TRIGGER ${q("payment_allocations_check")}
  BEFORE INSERT OR UPDATE ON ${fq(entity.schema, entity.name)}
  FOR EACH ROW EXECUTE FUNCTION bolao.check_payment_allocation();`;
}

/**
 * KPLUS-F020 / KPLUS-D01. The deferred constraint triggers, attached to every table that can break the
 * invariant — which is not the same as every table the invariant is about.
 *
 * `competition_edition_standings` gets DELETE as well as INSERT/UPDATE: removing a row is exactly how a
 * gap appears, and how club_count starts overstating. `payment_allocations` gets UPDATE and DELETE only:
 * inserting an allocation can only ever INCREASE what a pool collected, so it cannot make a solvent pool
 * insolvent — but lowering or removing one can, and the access model does grant the runtime UPDATE.
 *
 * `CREATE CONSTRAINT TRIGGER` is AFTER and FOR EACH ROW by definition. That means a twenty-row snapshot
 * queues twenty identical checks at commit. Measured rather than assumed — see the F020 lab — and left
 * as is: the aggregate is over one snapshot, and a deduplicating memo would add transaction-local state
 * whose failure mode is silently skipping a check.
 */
export function snapshotIntegrityTriggerDdl(entity) {
  if (entity.schema !== "bolao") return null;
  const T = (name, events, fn, why) => `-- ${why}
CREATE CONSTRAINT TRIGGER ${q(name)}
  AFTER ${events} ON ${fq(entity.schema, entity.name)}
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bolao.${fn}();`;

  switch (entity.name) {
    case "classification_snapshots":
      return T("classification_snapshots_completeness", "INSERT OR UPDATE", "check_snapshot_completeness",
        "KPLUS-F020. Checked at COMMIT: a snapshot is incomplete for most of its own insert, so this cannot be immediate.");
    case "competition_edition_standings":
      return T("competition_edition_standings_completeness", "INSERT OR UPDATE OR DELETE", "check_snapshot_completeness",
        "KPLUS-F020. DELETE included: removing a standing is how a gap appears and how club_count starts to overstate.");
    case "prize_allocations":
      return T("prize_allocations_solvency", "INSERT OR UPDATE", "check_prize_pool_solvency",
        "KPLUS-D01. Checked at COMMIT because recordPrize inserts the whole prize table in one statement group.");
    case "payment_allocations":
      return T("payment_allocations_prize_solvency", "UPDATE OR DELETE", "check_prize_pool_solvency",
        "KPLUS-D01. Not INSERT: an allocation can only raise what a pool collected, so only lowering or removing one can make a declared prize table insolvent.");
    default:
      return null;
  }
}

/**
 * The audit triggers, emitted with the table that carries them.
 *
 * A STATEMENT-level trigger is used alongside the row-level ones so that a bulk `DELETE FROM
 * audit.audit_events` with no matching rows — which fires no row triggers at all — is still refused.
 * Without it, "delete everything" would succeed silently on an empty table and, more importantly,
 * would be reported to a caller as success.
 */
export function auditTriggerDdl(entity) {
  // The chain head is seeded the moment its table exists: the append trigger reads it on every insert,
  // so an empty head table would make the very first audit event fail.
  if (entity.schema === "audit" && entity.name === "audit_chain_head") {
    return `-- One row, created with the table. NULL event_hash means "no events yet"; the first append
-- links to nothing and becomes the genesis of the chain.
INSERT INTO audit."audit_chain_head" (singleton, event_hash) VALUES (true, NULL)
  ON CONFLICT (singleton) DO NOTHING;`;
  }
  if (entity.schema !== "audit" || entity.name !== "audit_events") return null;
  return `-- The chain is built by the server on the way in.
CREATE TRIGGER ${q("audit_events_compute_chain")}
  BEFORE INSERT ON ${fq(entity.schema, entity.name)}
  FOR EACH ROW EXECUTE FUNCTION audit.compute_event_chain();

-- Append-only. Row-level triggers refuse any row that is targeted; the statement-level pair refuses
-- the operation even when it matches nothing, so a bulk delete cannot be reported as a success.
CREATE TRIGGER ${q("audit_events_refuse_update")}
  BEFORE UPDATE ON ${fq(entity.schema, entity.name)}
  FOR EACH ROW EXECUTE FUNCTION audit.refuse_mutation();
CREATE TRIGGER ${q("audit_events_refuse_delete")}
  BEFORE DELETE ON ${fq(entity.schema, entity.name)}
  FOR EACH ROW EXECUTE FUNCTION audit.refuse_mutation();
CREATE TRIGGER ${q("audit_events_refuse_update_stmt")}
  BEFORE UPDATE ON ${fq(entity.schema, entity.name)}
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_mutation();
CREATE TRIGGER ${q("audit_events_refuse_delete_stmt")}
  BEFORE DELETE ON ${fq(entity.schema, entity.name)}
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_mutation();`;
}

/**
 * Index steps. CONCURRENTLY, therefore outside any transaction, therefore a separate section.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THREE DEFECTS FIXED HERE, ALL OF WHICH SILENTLY WEAKENED THE SCHEMA
 *
 * 1. UNIQUENESS WAS DROPPED. `idx.unique` was never read, so every one of the model's unique
 *    indexes was emitted as a plain non-unique index. The controls lost that way are not cosmetic:
 *      · predictions(pool_entry_id, match_id) UNIQUE is what stops two concurrent submissions for
 *        one (entry, match) from both winning — a scoring error, and money is paid on rank;
 *      · payment_allocations(payment_id, pool_entry_id) UNIQUE is the duplicate-allocation control;
 *      · match_results(match_id) UNIQUE WHERE is_official is what prevents two competing official
 *        results for one match;
 *      · outbox_events(idempotency_key) UNIQUE is delivery idempotency;
 *      · participant_identity_links(merged_participant_id) UNIQUE WHERE reverted_at IS NULL stops
 *        one identity being merged twice.
 *    Every WS13 test of these properties passes against the JS reference store, which declares its
 *    own UNIQUE_INDEXES. None of them was testing this DDL.
 *
 * 2. PARTIAL PREDICATES WERE DROPPED, because the emitter read `idx.where` and the model declares
 *    `idx.partial`. A one-word key mismatch turned every partial index into a full one. The
 *    generated comment still SAID "partial", which is worse than silence: the file asserted a
 *    property its own SQL did not have.
 *
 * 3. NAME COLLISIONS SILENTLY DISCARDED INDEXES. The name was derived from the columns alone, so two
 *    indexes on the same columns — e.g. match_results' partial-unique and plain index on match_id,
 *    or pool_entries' plain and partial index on pool_id — produced the same name, and
 *    `IF NOT EXISTS` made the second a no-op. The file appeared to create both.
 *
 * 4. THE FIX FOR (3) DID NOT SURVIVE POSTGRESQL'S IDENTIFIER LIMIT. Uniqueness was enforced on the
 *    name this file writes, but PostgreSQL truncates any identifier over NAMEDATALEN-1 = 63 bytes
 *    and does so WITHOUT ERROR — so two names that differ only past byte 63 arrive at the server as
 *    the same name, `IF NOT EXISTS` sees the first, and the second index is silently never created.
 *    Confirmed against a real PostgreSQL 17.10 catalog (campaign K+ workstream C, KPLUS-F006):
 *    `competition_edition_standings_classification_snapshot_id_position_uidx` (70 bytes) and
 *    `..._classification_snapshot_id_position_club_name_idx` (79 bytes) both truncate to
 *    `competition_edition_standings_classification_snapshot_id_positi`, and only the first existed
 *    in the migrated database. The one that vanished is the covering index the zone-slice scoring
 *    read depends on. Uniqueness is therefore enforced on the name AS THE SERVER WILL STORE IT —
 *    see fitIndexName(). Any name at the limit is disambiguated by a digest of the full name, so it
 *    stays deterministic across regenerations and `--check` does not oscillate.
 */

/** PostgreSQL's NAMEDATALEN-1: the longest identifier that is stored as written rather than cut. */
export const MAX_IDENTIFIER_BYTES = 63;

/**
 * Return a name PostgreSQL will store verbatim, unique among `used`.
 *
 * A name that already fits is returned unchanged, so this fix does not rename the indexes that were
 * always correct. A name that does not fit is shortened to leave room for `_` plus 8 hex digits of
 * the full name's digest — derived from the whole name, so two names that differ only past the cut
 * get different suffixes, which is exactly the case that used to collide.
 */
export function fitIndexName(name, used) {
  let fitted = Buffer.byteLength(name, "utf8") <= MAX_IDENTIFIER_BYTES
    ? name
    : `${name.slice(0, MAX_IDENTIFIER_BYTES - 9)}_${sha256(name).slice(0, 8)}`;
  // A digest collision inside 8 hex digits is not expected; a deterministic fallback is cheaper than
  // reasoning about whether it can happen.
  for (let n = 2; used.has(fitted); n++) {
    fitted = `${fitted.slice(0, MAX_IDENTIFIER_BYTES - String(n).length - 1)}_${n}`;
  }
  return fitted;
}
function indexDdl(entity) {
  const out = [];
  const used = new Set();
  /**
   * A column with `unique: true` already gets an inline UNIQUE constraint above, and PostgreSQL backs
   * every UNIQUE constraint with a unique index. A declared index on that same single column, total
   * and unique, is therefore the SAME index built twice under two names — double the write cost on
   * every insert, for one rule. `outbox_events.idempotency_key` is the live case, and it sits on the
   * delivery hot path. The constraint is kept (it is the declarative form other objects reference)
   * and the duplicate index is not emitted. KPLUS-F009.
   */
  const totalUniqueColumns = new Set(entity.columns.map(withDefaults).filter((c) => c.unique === true).map((c) => c.sql));
  for (const idx of entity.indexes || []) {
    const where0 = idx.partial ?? idx.where ?? null;
    if (idx.unique && !where0 && idx.cols.length === 1 && totalUniqueColumns.has(idx.cols[0])) continue;
    const base = `${entity.name}_${idx.cols.map((c) => c.replace(/[^a-z0-9]/gi, "_")).join("_")}`;
    // A partial predicate may be declared as `partial` (the model's convention) or `where`. Both are
    // accepted, `partial` wins, and neither is silently ignored.
    const where = idx.partial ?? idx.where ?? null;
    let name = `${base}${idx.unique ? "_uidx" : "_idx"}`;
    if (used.has(name)) {
      // Deterministic discriminator so regeneration is stable: partial indexes get _partial, then a
      // numeric suffix. Silently reusing the name would drop the index via IF NOT EXISTS.
      const alt = `${base}${idx.unique ? "_uidx" : "_idx"}${where ? "_partial" : ""}`;
      name = used.has(alt) ? `${alt}_${used.size}` : alt;
    }
    // Uniqueness is decided on the stored form, not the written form — see defect 4 above.
    name = fitIndexName(name, used);
    used.add(name);
    const cols = idx.cols.join(", ");
    out.push({
      name,
      sql: `CREATE ${idx.unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS ${q(name)} ON ${fq(entity.schema, entity.name)} (${cols})${where ? ` WHERE ${where}` : ""};`,
      rationale: idx.rationale,
      unique: !!idx.unique,
      partial: where,
    });
  }
  return out;
}

export function generateDrafts() {
  const model = loadModel();
  const access = loadAccessModel();
  const accessByName = new Map(access.entities.map((e) => [e.name, e]));
  const byPhase = new Map();
  for (const e of model.entities) {
    if (!byPhase.has(e.migrationPhase)) byPhase.set(e.migrationPhase, []);
    byPhase.get(e.migrationPhase).push(e);
  }

  const files = [];
  const allErrors = [];

  for (const phase of Object.keys(PHASE_META)) {
    const meta = PHASE_META[phase];
    const entities = byPhase.get(phase) || [];
    const L = [BANNER, ""];
    L.push(`-- ============================================================`);
    L.push(`-- ${phase} — ${meta.title}`);
    L.push(`-- ============================================================`);
    L.push(`--`);
    L.push(...wrap(`PURPOSE. ${meta.purpose}`));
    L.push(`--`);
    L.push(`-- DEPENDENCIES: ${meta.dependsOn.join(", ")}`);
    L.push(`-- TABLES CREATED: ${entities.length ? entities.map((e) => `${e.schema}.${e.name}`).join(", ") : "none (types only)"}`);
    L.push(`--`);
    L.push(...wrap(`LOCK RISK. CREATE TABLE / CREATE TYPE take no lock on any existing object, so concurrent traffic is unaffected. FKs do take a brief ACCESS EXCLUSIVE lock on the REFERENCED table while the constraint is registered — participants and pools are referenced here — but that is catalogue-only and does not scan. Every index is built CONCURRENTLY outside the transaction. Expected worst-case lock on a live object: a sub-millisecond catalogue lock on referenced parents.`));
    L.push(...wrap(`TABLE REWRITE RISK. NONE. This phase creates new tables only; it never ALTERs an existing one, so no rewrite is possible.`));
    L.push(...wrap(`INDEX BUILD STRATEGY. CREATE INDEX CONCURRENTLY, one statement per index, each outside a transaction block. A concurrent build can fail and leave an INVALID index that is still maintained on write, so the postchecks assert pg_index.indisvalid for every index created here.`));
    L.push(...wrap(`CONSTRAINT VALIDATION STRATEGY. FKs, UNIQUEs and CHECKs are declared INLINE in CREATE TABLE and are therefore validated immediately. That is correct and deliberate HERE and only here: the table is brand new and empty, so validation scans zero rows and the NOT VALID / VALIDATE two-step would add ceremony with no benefit. Any LATER migration that adds a constraint to a POPULATED table must use ADD CONSTRAINT ... NOT VALID followed by a separate VALIDATE CONSTRAINT, because a plain ADD holds a lock for the whole scan — the static analyser enforces that distinction.`));
    const rls = entities.map((e) => accessByName.get(e.name)).filter(Boolean);
    L.push(...wrap(`RLS EFFECT. Every table is created with RLS ENABLED and ZERO policies, which in PostgreSQL denies all access to everyone except table owners and BYPASSRLS roles. Policies are a separate, later migration. This ordering is deliberate: a table that exists without RLS, even briefly, is an exposure window.`));
    L.push(...wrap(`ACL EFFECT. No GRANT is issued. Default privileges are revoked from PUBLIC. anon and authenticated receive nothing in this phase. ${rls.length ? `Intended eventual access: ${rls.map((e) => `${e.name}[anon:${(e.permissions.anon || []).join("/") || "none"}]`).join(", ")}` : ""}`));
    // `!c.addedInPhase` for the same reason `tableDdl` filters it: a column introduced by a LATER
    // ALTER phase is not created here and must not be announced here. Without this the header claimed
    // M6 introduced `ties.locked_by`, a column M15 adds — so adding any PII-bearing column to an
    // already-applied table silently rewrote an earlier phase's banner and made the promoted file
    // report as DRIFTED. The DDL was already right; only the prose was lying.
    const piiCols = entities.flatMap((e) => e.columns.filter((c) => !c.addedInPhase).map(withDefaults).filter((c) => c.pii && c.pii !== "NONE").map((c) => `${e.name}.${c.sql}:${c.pii}`));
    L.push(...wrap(`PII EFFECT. ${piiCols.length ? `Introduces ${piiCols.length} PII-bearing column(s): ${piiCols.join(", ")}. All are unreadable until a policy grants access.` : "No PII-bearing column is introduced."}`));
    L.push(...wrap(`BACKFILL REQUIREMENT. ${meta.backfill}`));
    L.push(...wrap(`APPLICATION COMPATIBILITY. ${meta.appCompat}`));
    L.push(...wrap(`ROLLBACK STRATEGY (${meta.rollbackClass}). ${meta.rollback}`));
    L.push(`--`);
    L.push(`-- PRECHECKS (all READ_ONLY, all must pass):`);
    L.push(`--   1. every dependency in ${meta.dependsOn.join(", ")} is recorded as applied`);
    L.push(`--   2. none of the tables this phase creates already exists`);
    L.push(`--   3. a verified backup exists (restore_rehearsal.mjs preflight green)`);
    L.push(`--   4. acceptance_checks.mjs structural counts match the recorded expectation`);
    L.push(`--   5. supabase db diff is EMPTY before starting`);
    L.push(`-- POSTCHECKS (all READ_ONLY):`);
    L.push(`--   1. every table exists with RLS enabled and zero policies`);
    L.push(`--   2. every FK and CHECK reports convalidated = true`);
    L.push(`--   3. every index reports indisvalid = true`);
    L.push(`--   4. no GRANT exists to anon or authenticated on any new table`);
    L.push(`--   5. prePostValidate reports no UNACCOUNTED change`);
    L.push(`-- FAIL-CLOSED CONDITIONS (stop, do not improvise):`);
    L.push(`--   · any precheck fails`);
    L.push(`--   · a table already exists (this phase was partially applied — establish state first)`);
    L.push(`--   · an index reports indisvalid = false (drop it CONCURRENTLY and retry; do not proceed)`);
    L.push(`--   · db diff is non-empty afterwards in any way not declared above`);
    L.push(`--   · any statement errors — the transaction aborts and nothing is left half-created`);
    L.push("");

    if (phase === "M1") {
      L.push("BEGIN;", "");
      L.push("CREATE SCHEMA IF NOT EXISTS bolao;");
      L.push("CREATE SCHEMA IF NOT EXISTS audit;");
      L.push("COMMENT ON SCHEMA bolao IS 'Domain tables. Deliberately NOT public: leaving public removes PostgREST reachability by default.';");
      L.push("COMMENT ON SCHEMA audit IS 'Append-only audit spine plus its redactable payload sidecar.';");
      L.push("");
      // KPLUS-F004. This was the single hardcoded line `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.
      // The model also declares a `citext` column, and nothing derived the extension set from the types
      // actually used — so DDL-M2 failed on a real PostgreSQL server with `type "citext" does not
      // exist`, and the whole migration sequence was unrunnable from its second phase onward. Static
      // analysis could not see it: every phase was internally consistent and the missing dependency
      // lived in a phase that never mentioned the type.
      //
      // The set is now DERIVED, so a future model change that introduces an extension-backed type
      // brings its extension with it instead of breaking the sequence three phases later.
      for (const ext of requiredExtensions()) {
        L.push(`-- ${ext.why}`);
        L.push(`CREATE EXTENSION IF NOT EXISTS ${ext.name};`);
      }
      L.push("");
      L.push("-- Privileges are revoked from PUBLIC before any object exists, so no object is ever briefly world-readable.");
      L.push("REVOKE ALL ON SCHEMA bolao FROM PUBLIC;");
      L.push("REVOKE ALL ON SCHEMA audit FROM PUBLIC;");
      L.push("");
      // Schema USAGE is DERIVED from the manifest's SCHEMA class rather than hardcoded, for the same
      // reason the extension set is (KPLUS-F004): a hardcoded privilege line is a privilege nobody
      // re-derives when the model changes.
      //
      // That class was missing entirely until the Q7 from-zero replay measured its absence. Without
      // USAGE, every grant this model emits inside bolao or audit is inert — reaching an object
      // requires USAGE on its schema first. M1 grants service_role EXECUTE on audit.event_hash_v1;
      // has_function_privilege() reported true and the actual call returned "permission denied for
      // schema audit". Only executing as the role exposed it.
      L.push("-- Schema USAGE, derived from model/privilege_manifest.json's SCHEMA class. Without this every");
      L.push("-- grant inside these schemas is inert: reaching an object requires USAGE on its schema first.");
      for (const [role, privs] of schemaGrants()) {
        for (const schema of ["bolao", "audit"]) {
          L.push(`GRANT ${privs.join(", ")} ON SCHEMA ${schema} TO ${q(role)};`);
        }
      }
      L.push("");
      const enums = loadModel().enums || {};
      for (const [name, def] of Object.entries(enums)) {
        const bare = name.split(".")[1];
        L.push(`-- ${def.why}`);
        L.push(`CREATE TYPE bolao.${q(bare)} AS ENUM (${def.values.map(sqlLit).join(", ")});`);
      }
      L.push("");
      L.push(UPDATED_AT_FUNCTION_DDL);
      L.push("");
      L.push(AUDIT_CHAIN_DDL);
      L.push("");
      L.push(PAYMENT_ALLOCATION_DDL);
      L.push("");
      L.push(SNAPSHOT_INTEGRITY_DDL);
      L.push("");
      L.push("COMMIT;");
      L.push("");
      L.push("-- NOTE ON ENUMS: ALTER TYPE ... ADD VALUE cannot run inside a transaction block and cannot be");
      L.push("-- rolled back. Adding a value later is therefore its own migration, and removing one is not");
      L.push("-- possible at all — which is why each vocabulary above is closed deliberately rather than casually.");
    } else if (meta.readSurface) {
      // A READ SURFACE phase: functions and views, no table, no row, no column. It is emitted from
      // scripts/db/read_surface.mjs's declarative spec for the same reason every other phase is emitted
      // from the model — a hand-authored read surface is a second definition of the document shape, and
      // the first one to drift wins silently.
      L.push("BEGIN;", "");
      L.push(readSurfaceDdl());
      L.push("");
      L.push("COMMIT;");
    } else if (meta.alterOnly) {
      // An ADDITIVE ALTER phase: columns introduced after their table's own phase already ran.
      // ADD COLUMN with no DEFAULT and no NOT NULL is catalogue-only in PostgreSQL 11+ — it does not
      // rewrite the table and holds ACCESS EXCLUSIVE only long enough to update pg_attribute. A DEFAULT
      // would be the dangerous shape here, and one is deliberately never emitted: see below.
      const added = [];
      for (const e of model.entities) {
        for (const c of e.columns.filter((x) => x.addedInPhase === phase)) added.push({ e, c });
      }
      if (!added.length) allErrors.push(`${phase}: declared alterOnly but no column names it in addedInPhase`);
      L.push("BEGIN;", "");
      for (const { e, c } of added) {
        const d = withDefaults(c);
        if (d.default !== undefined && d.default !== null) {
          // Fail closed rather than emit it. A DEFAULT on a post-hoc column invents a value for every
          // existing row, and for a business field like a deadline that invented value silently decides
          // something real. If a default is ever genuinely wanted it must be argued for, not inherited.
          allErrors.push(`${phase}: ${e.name}.${c.sql} declares a DEFAULT; a post-hoc additive column must not fabricate a value for existing rows`);
        }
        if (d.nullable === false) {
          allErrors.push(`${phase}: ${e.name}.${c.sql} is NOT NULL; adding a NOT NULL column to a populated table requires a backfill and a separate validate step`);
        }
        L.push(`ALTER TABLE ${fq(e.schema, e.name)} ADD COLUMN IF NOT EXISTS ${q(c.sql)} ${c.type};`);
        if (c.purpose) L.push(`COMMENT ON COLUMN ${fq(e.schema, e.name)}.${q(c.sql)} IS ${sqlLit(c.purpose)};`);
        for (const [k, label] of [["sourceEvidence", "SOURCE"], ["timezoneSemantics", "TIMEZONE"],
                                  ["nullSemantics", "NULL"], ["mutability", "MUTABILITY"], ["noDefault", "NO DEFAULT"]]) {
          if (c[k]) L.push(...wrap(`${label}. ${c[k]}`));
        }
        L.push("");
      }
      L.push("COMMIT;");
    } else {
      L.push("BEGIN;", "");
      for (const e of entities) {
        const t = tableDdl(e);
        allErrors.push(...t.errors.map((x) => `${phase}: ${x}`));
        L.push(t.sql, "");
        L.push(`ALTER TABLE ${fq(e.schema, e.name)} ENABLE ROW LEVEL SECURITY;`);
        L.push(`ALTER TABLE ${fq(e.schema, e.name)} FORCE ROW LEVEL SECURITY;`);
        L.push(`REVOKE ALL ON TABLE ${fq(e.schema, e.name)} FROM PUBLIC;`);
        const trg = updatedAtTriggerDdl(e);
        if (trg) L.push("", trg);
        const aud = auditTriggerDdl(e);
        if (aud) L.push("", aud);
        const alloc = paymentAllocationTriggerDdl(e);
        if (alloc) L.push("", alloc);
        const snap = snapshotIntegrityTriggerDdl(e);
        if (snap) L.push("", snap);
        L.push("");
      }
      L.push("COMMIT;");
      L.push("");
      const idx = entities.flatMap((e) => indexDdl(e));
      if (idx.length) {
        L.push("-- ============================================================");
        L.push("-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)");
        L.push("-- ============================================================");
        for (const i of idx) {
          L.push(`-- ${i.rationale}`);
          L.push(i.sql);
        }
        L.push("");
        L.push("-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is");
        L.push("-- still maintained on every write: pure cost that looks like a working index in \\d.");
        L.push("--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid");
        L.push("--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY[" + idx.map((i) => sqlLit(i.name)).join(", ") + "]);");
        L.push("-- Expected: zero rows.");
      }
    }
    L.push("");
    const body = L.join("\n").replace(/\n+$/, "") + "\n";
    // {schema, name}, not name alone. This used to export bare names, which made
    // `promote_expand_stage.mjs` print "entities undefined.undefined" on every promotion — it had always
    // read `e.schema`/`e.name`. That was dismissed as a cosmetic log for five stages. It is not cosmetic:
    // anything deriving object identity from this list (a backout, a drop order, a verification query)
    // would silently assume schema `bolao`, and M8 puts three tables in `audit`.
    files.push({ phase, name: `${phase}_${meta.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.draft.sql`, body, digest: sha256(body), entities: entities.map((e) => ({ schema: e.schema, name: e.name })), meta });
  }

  return { files, errors: allErrors };
}

function wrap(text, width = 108) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "--";
  for (const w of words) {
    if ((cur + " " + w).length > width) { lines.push(cur.trimEnd()); cur = "--  " + w; }
    else cur += " " + w;
  }
  // trimEnd on every emitted line: an empty trailing token produced a line ending in a space, which
  // `git diff --check` reports. A generator must not emit whitespace its own gate rejects.
  if (cur.trim() !== "--") lines.push(cur.trimEnd());
  return lines;
}

function main() {
  const argv = process.argv.slice(2);
  const { files, errors } = generateDrafts();

  if (argv.includes("--write")) {
    if (errors.length) { console.error("refusing to generate from a model with DDL-quality errors:"); for (const e of errors) console.error(`  ✗ ${e}`); return 1; }
    mkdirSync(DRAFT_DIR, { recursive: true });
    for (const f of files) { writeFileSync(join(DRAFT_DIR, f.name), f.body); console.log(`  wrote ${f.name}`); }
    return 0;
  }
  if (argv.includes("--check")) {
    let stale = 0;
    for (const f of files) {
      const p = join(DRAFT_DIR, f.name);
      let cur = ""; try { cur = readFileSync(p, "utf8"); } catch { cur = ""; }
      if (cur !== f.body) { console.log(`  ✗ stale: ${f.name}`); stale++; } else console.log(`  ✓ fresh: ${f.name}`);
    }
    // A draft file present on disk that the generator does not produce is an orphan hand edit.
    if (existsSync(DRAFT_DIR)) {
      const known = new Set(files.map((f) => f.name));
      for (const n of readdirSync(DRAFT_DIR).filter((x) => x.endsWith(".draft.sql"))) {
        if (!known.has(n)) { console.log(`  ✗ orphan draft not produced by the generator: ${n}`); stale++; }
      }
    }
    for (const e of errors) console.log(`  ✗ ${e}`);
    console.log(stale || errors.length ? "\n✗ MIGRATION DRAFTS STALE OR INVALID\n" : "\n✓ migration drafts are up to date\n");
    return stale || errors.length ? 1 : 0;
  }
  if (argv.includes("--json")) { console.log(JSON.stringify({ files: files.map(({ body, ...r }) => r), errors }, null, 2)); return errors.length ? 1 : 0; }

  console.log(`\nMigration drafts (${files.length} phases)\n`);
  for (const f of files) {
    console.log(`  ${f.phase.padEnd(4)} ${String(f.body.split("\n").length).padStart(4)} lines  ${f.digest.slice(0, 12)}  ${f.entities.map((e) => `${e.schema}.${e.name}`).join(", ") || "(types only)"}`);
  }
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`\n  ${errors.length} DDL-quality error(s)\n`);
  return errors.length ? 1 : 0;
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) { try { process.exit(main()); } catch (e) { console.error(`runner error: ${e.message}`); process.exit(2); } }
