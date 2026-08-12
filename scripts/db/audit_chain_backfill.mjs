#!/usr/bin/env node
/**
 * The M10 audit backfill's chain construction (KPLUS-F014).
 *
 * WHY THIS EXISTS AT ALL
 * Appending one audit event is O(1): the BEFORE INSERT trigger reads and advances the single-row chain
 * head. Appending historical events in BULK through that same trigger is not. Every append updates the
 * same head row; inside one transaction each update creates a version the next must traverse. Measured
 * twice, and the second time with the head table already in place: a 200,000-row load did not finish in
 * ten minutes. The application is unaffected — it writes one event per transaction — but the M10 audit
 * backfill moves history in bulk, and `model/migration_choreography.json` already declares its race
 * strategy as APPEND_ONLY_CHAIN_RECOMPUTE: *"the chain is computed in document order"*.
 *
 * THE SHAPE
 *   1. STAGE   — historical events land in a staging table carrying an explicit `ordinal`. Document
 *                order is an input, not something rediscovered from a clock: two legacy events can share
 *                a timestamp and `audit_event_id` is random, so neither can order the chain.
 *   2. CHAIN   — one recursive pass walks the staging rows in ordinal order, setting each row's
 *                `previous_event_hash` to its predecessor's `event_hash` and computing its own hash with
 *                `audit.event_hash_v1(audit.event_canonical_v1(...))` — the SAME functions the append
 *                trigger runs. Not a reimplementation of them. A reimplementation that drifted by one
 *                separator would produce a chain that is internally consistent, verifies against itself,
 *                and is incompatible with every event appended after the migration.
 *   3. PROMOTE — the finished rows are inserted into `audit.audit_events` with ONE named trigger
 *                disabled, so the trigger does not recompute (and thereby destroy) what was just built.
 *                See "THE SUSPENSION" below: it is one trigger, for one statement, under table
 *                ownership — not `session_replication_role`, and not superuser.
 *   4. SEAL    — the chain head is set to the last row's hash and the event count. Until this runs the
 *                head disagrees with the table, and the next live append would chain onto the wrong tail.
 *   5. VERIFY  — the whole chain is re-derived from the stored columns and compared, the linkage is
 *                checked end to end, and the head is checked against the table.
 *
 * WHAT IT NEVER DOES
 * It never UPDATEs `audit.audit_events`. Everything is computed in staging and inserted once. That is
 * not a convenience: `audit_events` is append-only and the whole procedure would otherwise need the
 * refusal triggers suspended around a statement that rewrites audit history — a tool that, once it
 * exists, can be pointed at events that were not part of any backfill.
 *
 * THE SUSPENSION — KPLUS-F027
 * An earlier draft of this procedure suspended triggers with `SET LOCAL session_replication_role =
 * replica`. That worked in the local rehearsal for a reason that does not survive contact with
 * production: the rehearsal owner is a superuser. `session_replication_role` is a SUSET parameter, so a
 * non-superuser migration role cannot set it at all — and it is also far wider than the requirement,
 * because it switches off FOREIGN KEY enforcement across the whole session and every other user trigger
 * with it.
 *
 * Exactly ONE trigger has to stand down, and only for the promoting statement: the BEFORE INSERT
 * `audit_events_compute_chain`. Two measured reasons, neither of them about hash agreement (the bulk
 * pass and the trigger compute identical hashes — see F014-7):
 *   · the trigger chains rows in whatever order the executor emits them, which PostgreSQL does not
 *     promise for a BEFORE trigger, while the bulk chain is defined by `ordinal`; and
 *   · driving the history through it one row at a time does not finish (KPLUS-F014).
 *
 * `ALTER TABLE audit.audit_events DISABLE TRIGGER audit_events_compute_chain` is the narrowest
 * mechanism PostgreSQL offers, and it needs only table ownership:
 *   · foreign keys keep firing — the RI triggers are internal, and disabling THOSE is what would
 *     require superuser (`DISABLE TRIGGER ALL` is refused to a plain owner, proven, not assumed);
 *   · the four append-only refusal triggers keep firing, so no window ever exists in which audit
 *     history can be UPDATEd or DELETEd;
 *   · row-level security is not touched, so FORCE ROW LEVEL SECURITY stays exactly as declared;
 *   · it is transactional — a rolled-back promotion re-arms the trigger with no compensating step; and
 *   · `triggerStateSql()` proves afterwards that every trigger on the table is armed again, so a
 *     promotion that committed with the trigger still down is a failure rather than a silent hole.
 *
 * The role: `model/rls_model.json` already ratifies `migration_role` as a non-superuser holding DDL
 * authority and BYPASSRLS. Ownership covers the DISABLE; BYPASSRLS covers the INSERT past FORCE RLS,
 * which has no policy for any principal but the runtime. `MIGRATION_ROLE_PRIVILEGES` below states that
 * set exactly, and no privilege outside it is required. See ADR-K07.
 *
 * FAIL-CLOSED PRECONDITIONS
 * `preflightSql()` refuses unless the target is genuinely un-chained: the head must be empty and the
 * table must hold no event whose hash the promotion would have to chain onto. A backfill run twice, or
 * run against a target that has already taken live writes, does not silently fork the chain.
 *
 * BOUNDARY: this module builds SQL text. It opens no connection and names no database.
 */

/** Schema holding the migration-time staging table. Dropped when the backfill completes. */
export const STAGING_SCHEMA = "audit_backfill";
export const STAGING_TABLE = `${STAGING_SCHEMA}.audit_events_staging`;

/**
 * The columns the chain covers, in the order `audit.event_canonical_v1` takes them.
 *
 * Exported because the campaign lab asserts this list against the function's actual signature in the
 * database. If a future migration adds a chained column and forgets this module, that assertion fails
 * rather than the backfill quietly hashing over a stale column set.
 */
export const CHAINED_COLUMNS = Object.freeze([
  "audit_event_id", "occurred_at", "actor_user_id", "actor_role", "action", "aggregate_type",
  "aggregate_id", "correlation_id", "request_id", "source", "safe_metadata", "reason",
]);

/** Named-argument call into the shared canonical function, over a row alias. Never positional. */
const canonicalCall = (alias, prevExpr) => `audit.event_canonical_v1(
      p_previous_event_hash => ${prevExpr},
      p_audit_event_id      => ${alias}.audit_event_id,
      p_occurred_at         => ${alias}.occurred_at,
      p_actor_user_id       => ${alias}.actor_user_id,
      p_actor_role          => ${alias}.actor_role,
      p_action              => ${alias}.action,
      p_aggregate_type      => ${alias}.aggregate_type,
      p_aggregate_id        => ${alias}.aggregate_id,
      p_correlation_id      => ${alias}.correlation_id,
      p_request_id          => ${alias}.request_id,
      p_source              => ${alias}.source,
      p_safe_metadata       => ${alias}.safe_metadata,
      p_reason              => ${alias}.reason)`;

/** The hash an already-linked row must carry. Used by the builder and by the verifier alike. */
export const hashExpr = (alias, prevExpr = `${alias}.previous_event_hash`) =>
  `audit.event_hash_v1(${canonicalCall(alias, prevExpr)})`;

/**
 * Staging table.
 *
 * `ordinal` is the document order and is UNIQUE, because a duplicate ordinal makes "the next event"
 * ambiguous and the recursive walk would pick one arbitrarily — producing a chain that depends on the
 * planner. `previous_event_hash` and `event_hash` start NULL and are filled by the chain pass.
 */
export const stagingDdl = () => `CREATE SCHEMA IF NOT EXISTS ${STAGING_SCHEMA};
CREATE TABLE IF NOT EXISTS ${STAGING_TABLE} (
  ordinal             bigint PRIMARY KEY,
  audit_event_id      uuid        NOT NULL UNIQUE,
  occurred_at         timestamptz NOT NULL,
  actor_user_id       uuid,
  actor_role          text,
  action              text        NOT NULL,
  aggregate_type      text        NOT NULL,
  aggregate_id        uuid,
  correlation_id      uuid,
  request_id          uuid,
  source              text        NOT NULL,
  safe_metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reason              text,
  previous_event_hash text,
  event_hash          text,
  CONSTRAINT staging_ordinal_positive CHECK (ordinal >= 1),
  CONSTRAINT staging_action_shape CHECK (action ~ '^[a-z_]+\\.[a-z_]+$')
);`;

export const dropStagingDdl = () => `DROP TABLE IF EXISTS ${STAGING_TABLE}; DROP SCHEMA IF EXISTS ${STAGING_SCHEMA};`;

/**
 * Preconditions, as one query returning one row of named verdicts.
 *
 * Each is a reason to refuse, and each is checked in the database rather than assumed by the caller:
 * a precondition the caller evaluates is a precondition a different caller can forget.
 */
export const preflightSql = () => `SELECT
  (SELECT count(*) FROM audit.audit_events)                                          AS existing_events,
  (SELECT coalesce(event_count, -1) FROM audit.audit_chain_head WHERE singleton)     AS head_count,
  (SELECT (event_hash IS NOT NULL)::int FROM audit.audit_chain_head WHERE singleton) AS head_seeded,
  (SELECT count(*) FROM ${STAGING_TABLE})                                            AS staged,
  (SELECT count(*) FROM ${STAGING_TABLE} WHERE event_hash IS NOT NULL)               AS staged_already_chained,
  (SELECT count(*) FROM (SELECT ordinal FROM ${STAGING_TABLE} EXCEPT
     SELECT generate_series(1, (SELECT count(*) FROM ${STAGING_TABLE}))) g)          AS ordinal_gaps`;

/**
 * Interpret `preflightSql()`. Returns the refusal reasons; an empty array means proceed.
 *
 * Separated from the SQL so the rules are unit-testable without a database, and so a caller cannot
 * "handle" a refusal by not looking at one of the columns.
 */
export function preflightRefusals(row) {
  const n = (k) => Number(row?.[k]);
  const out = [];
  if (n("existing_events") > 0) {
    out.push(`audit.audit_events already holds ${n("existing_events")} event(s) — the bulk builder seeds a ` +
      `chain from its genesis and cannot splice into one that already exists. Append those events instead.`);
  }
  if (n("head_seeded") === 1 || n("head_count") > 0) {
    out.push(`the chain head is already seeded (event_count=${n("head_count")}) — sealing over it would ` +
      `orphan every event the existing head attests to.`);
  }
  if (n("head_count") < 0) out.push("audit.audit_chain_head has no singleton row — the schema is not the migrated target.");
  if (n("staged") === 0) out.push("nothing is staged — a backfill that loads zero events must say so rather than seal an empty chain.");
  if (n("staged_already_chained") > 0) {
    out.push(`${n("staged_already_chained")} staged row(s) already carry an event_hash — the chain pass would ` +
      `overwrite hashes someone else computed, which is how two incompatible chains get merged.`);
  }
  if (n("ordinal_gaps") > 0) {
    out.push(`the staged ordinals are not the contiguous range 1..N (${n("ordinal_gaps")} out of range) — a gap ` +
      `means an event was dropped between extraction and staging, and the chain would attest to the survivors.`);
  }
  return out;
}

/**
 * The chain pass. ONE recursive walk, in ordinal order, over the staging table.
 *
 * Recursion is unavoidable: link N's hash is an input to link N+1's, so there is no set-based
 * formulation. What matters is that it is one pass over the data rather than N passes, and that it
 * touches `audit.audit_events` not at all. The genesis row's predecessor is NULL, which is what
 * `event_canonical_v1` renders as chr(30) — the same as a live genesis event.
 */
export const chainSql = () => `WITH RECURSIVE walk AS (
  SELECT s.ordinal, NULL::text AS previous_event_hash, ${hashExpr("s", "NULL::text")} AS event_hash
    FROM ${STAGING_TABLE} s
   WHERE s.ordinal = 1
  UNION ALL
  SELECT s.ordinal, w.event_hash, ${hashExpr("s", "w.event_hash")}
    FROM walk w
    JOIN ${STAGING_TABLE} s ON s.ordinal = w.ordinal + 1
)
UPDATE ${STAGING_TABLE} t
   SET previous_event_hash = w.previous_event_hash, event_hash = w.event_hash
  FROM walk w
 WHERE t.ordinal = w.ordinal`;

/** The one trigger the promotion has to stand down, and the table it is on. Nothing else is touched. */
export const CHAIN_TRIGGER = "audit_events_compute_chain";
export const AUDIT_EVENTS = "audit.audit_events";

/**
 * KPLUS-F027. Stand the chain trigger down, by name.
 *
 * `DISABLE TRIGGER <name>` on a user trigger requires table ownership and nothing more. The internal
 * RI constraint triggers that enforce `actor_user_id -> auth.users` are NOT named here and keep firing;
 * `DISABLE TRIGGER ALL` would take them down too and is refused to a non-superuser owner, which is the
 * privilege boundary this design deliberately stays behind.
 *
 * It takes ACCESS EXCLUSIVE on `audit_events` for the length of the promoting transaction. That is
 * acceptable here and only here: M10 runs before cutover against a table whose entire contents this
 * statement is creating, so there is no concurrent reader to block.
 */
export const disableChainTriggerSql = () => `ALTER TABLE ${AUDIT_EVENTS} DISABLE TRIGGER "${CHAIN_TRIGGER}"`;

/**
 * Re-arm it, in the SAME transaction as the promotion. If the transaction aborts, the DISABLE rolls back
 * with everything else and the trigger was never down outside it; if it commits, this has already run.
 * There is no window in which a committed database has an unarmed chain trigger.
 */
export const enableChainTriggerSql = () => `ALTER TABLE ${AUDIT_EVENTS} ENABLE TRIGGER "${CHAIN_TRIGGER}"`;

/**
 * The minimum privilege set the migration role needs for this procedure — stated so a runbook can grant
 * exactly this and a reviewer can check that nothing wider was asked for.
 *
 * `migration_role` in `model/rls_model.json` already carries both. Nothing here is new, and in
 * particular SUPERUSER is not on the list: it was only ever required by the mechanism this replaced.
 */
export const MIGRATION_ROLE_PRIVILEGES = Object.freeze([
  Object.freeze({
    privilege: "OWNER of audit.audit_events",
    needed_for: "ALTER TABLE ... DISABLE/ENABLE TRIGGER on the one named chain trigger, and the staging schema",
    already_modelled: "model/rls_model.json — migration_role holds DDL authority",
  }),
  Object.freeze({
    privilege: "BYPASSRLS",
    needed_for: "INSERT into audit_events, which carries FORCE ROW LEVEL SECURITY and has an INSERT policy for service_role only",
    already_modelled: "model/rls_model.json — migration_role holds BYPASSRLS",
  }),
]);

/** SUPERUSER is not required. Kept as an assertable constant rather than a sentence in a comment. */
export const REQUIRES_SUPERUSER = false;

/**
 * Promotion. Runs between `disableChainTriggerSql()` and `enableChainTriggerSql()`, in one transaction —
 * otherwise the BEFORE INSERT trigger recomputes every hash against a head that is still empty, and the
 * chain built above is silently replaced by one that links the rows in whatever order the insert happened
 * to emit them. The ORDER BY is therefore not cosmetic even though the hashes are already fixed: it makes
 * the physical order match the chain order, which is what a human reading the table expects.
 *
 * WHAT STAYS ON, because the suspension is one named trigger rather than the whole session:
 *
 * The FOREIGN KEY on `actor_user_id` is enforced at write time, by the internal RI triggers this does not
 * name. `verifySql()` still reports `orphan_actor`, but it is now defence in depth against a future
 * change that widens the suspension, not the only thing standing between the backfill and a dangling
 * actor reference.
 *
 * The append-only refusal triggers stay armed throughout, so the procedure never creates the tool it
 * refuses to build: at no point can a statement in this transaction UPDATE or DELETE audit history.
 *
 * Row-level security is untouched. `audit_events` keeps FORCE ROW LEVEL SECURITY, which binds the owner
 * too, and the migration role gets past it with BYPASSRLS — a ratified role attribute, not a policy
 * written for the migration and not a `NO FORCE` toggle. Weakening the table's RLS declaration to let a
 * migration write would leave the production stance depending on a migration having remembered to put it
 * back.
 */
export const promoteSql = () => `INSERT INTO audit.audit_events (
  ${CHAINED_COLUMNS.join(", ")}, previous_event_hash, event_hash)
SELECT ${CHAINED_COLUMNS.map((c) => `s.${c}`).join(", ")}, s.previous_event_hash, s.event_hash
  FROM ${STAGING_TABLE} s
 ORDER BY s.ordinal`;

/**
 * KPLUS-F026. Statistics, before anything reads the promoted table.
 *
 * Found by the seal hanging. Promotion inserts the whole history in one statement, and until the table
 * is analysed the planner still believes it holds the handful of rows it had before — so it costs the
 * tail lookup's anti-join as a nested loop and executes 200,000 x 200,000. Measured: the seal did not
 * finish in twelve minutes without this, and takes 88ms with it, on the same rows and the same query.
 *
 * The same trap KPLUS-F014 records, one level up. There the bulk load was quadratic because of MVCC on
 * the head row; here the bulk load is fast and the two statements that READ it are quadratic, because a
 * plan chosen from stale statistics is chosen for a table that no longer exists. It is a one-line step
 * and it must not be optional: leaving it to autovacuum makes the M10 backfill's runtime depend on
 * whether a background worker happened to visit the table first.
 */
export const analyzeSql = () => "ANALYZE audit.audit_events";

/**
 * Seal the head from what is actually in `audit_events`, not from what staging says should be there.
 *
 * Reading the count and tail back out of the target is the difference between "the head agrees with the
 * table" and "the head agrees with the plan". If promotion lost a row, sealing from staging would record
 * a head that no event carries, and the next append would chain onto a hash that is not in the table.
 */
export const sealSql = () => `UPDATE audit.audit_chain_head h
   SET event_hash = t.tail_hash, event_count = t.n, updated_at = now()
  FROM (SELECT count(*) AS n,
               (SELECT e.event_hash FROM audit.audit_events e
                 WHERE NOT EXISTS (SELECT 1 FROM audit.audit_events s WHERE s.previous_event_hash = e.event_hash)
               ) AS tail_hash
          FROM audit.audit_events) t
 WHERE h.singleton`;

/**
 * Verification, as one row of named counts. Zero everywhere and `linked = events - 1` is a valid chain.
 *
 * `recomputed_mismatch` re-derives every hash from the stored columns using the same shared function, so
 * it detects a row altered after it was written. `genesis`/`open_ends` prove the chain is a single line
 * rather than a forest or a tree. `head_*` prove the seal matches the table — the check that catches a
 * promotion that lost rows and a seal that never ran.
 */
export const verifySql = () => `SELECT
  (SELECT count(*) FROM audit.audit_events)                                        AS events,
  (SELECT count(*) FROM audit.audit_events e WHERE e.event_hash <> ${hashExpr("e")}) AS recomputed_mismatch,
  (SELECT count(*) FROM audit.audit_events WHERE previous_event_hash IS NULL)      AS genesis,
  (SELECT count(*) FROM audit.audit_events e
     WHERE NOT EXISTS (SELECT 1 FROM audit.audit_events s WHERE s.previous_event_hash = e.event_hash)) AS open_ends,
  (SELECT count(*) FROM audit.audit_events e WHERE e.previous_event_hash IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM audit.audit_events p WHERE p.event_hash = e.previous_event_hash))   AS broken_links,
  (SELECT count(*) FROM audit.audit_events e WHERE e.previous_event_hash IS NOT NULL)                  AS linked,
  (SELECT event_count FROM audit.audit_chain_head WHERE singleton)                 AS head_count,
  (SELECT count(*) FROM audit.audit_chain_head h JOIN audit.audit_events e ON e.event_hash = h.event_hash
     WHERE h.singleton) AS head_points_at_an_event,
  (SELECT count(*) FROM audit.audit_chain_head h WHERE h.singleton AND EXISTS
     (SELECT 1 FROM audit.audit_events s WHERE s.previous_event_hash = h.event_hash)) AS head_has_a_successor,
  (SELECT count(*) FROM audit.audit_events e WHERE e.actor_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.actor_user_id))      AS orphan_actor`;

/** Interpret `verifySql()`. Empty array means the chain is sound. */
export function verifyFailures(row) {
  const n = (k) => Number(row?.[k]);
  const out = [];
  const events = n("events");
  if (events === 0) return ["audit.audit_events is empty — there is no chain to verify"];
  if (n("recomputed_mismatch") > 0) out.push(`${n("recomputed_mismatch")} event(s) no longer hash to their recorded value`);
  if (n("genesis") !== 1) out.push(`expected exactly one genesis event, found ${n("genesis")}`);
  if (n("open_ends") !== 1) out.push(`expected exactly one open end, found ${n("open_ends")} — the chain is not a single line`);
  if (n("broken_links") > 0) out.push(`${n("broken_links")} event(s) name a predecessor that is not in the table`);
  if (n("linked") !== events - 1) out.push(`${n("linked")} linked event(s) for ${events} events — expected ${events - 1}`);
  if (n("head_count") !== events) out.push(`the head records ${n("head_count")} event(s); the table holds ${events}`);
  if (n("head_points_at_an_event") !== 1) out.push("the head's event_hash does not identify a row in audit_events");
  if (n("head_has_a_successor") !== 0) out.push("the head is not the tail — an event already follows the hash the head names");
  // Not a chain property. KPLUS-F027 narrowed the suspension to one named trigger, so the FK IS enforced
  // at write time now and this can no longer fail on a promotion that used the documented mechanism. It
  // stays because it is the detector for a future change that widens the suspension back out: a green
  // promotion with orphan actors in it means somebody took the RI triggers down too.
  if (n("orphan_actor") > 0) out.push(`${n("orphan_actor")} event(s) name an actor that is not in auth.users — the foreign key did not fire during promotion, so the suspension was wider than the one named trigger`);
  return out;
}

/**
 * KPLUS-F027. Every trigger on `audit_events`, and whether it is armed.
 *
 * Read AFTER the procedure, as a postcondition. `tgenabled` is 'O' for a normal enabled trigger; 'D' is
 * disabled. Internal RI triggers are included deliberately — the point of the check is that the
 * promotion left the table exactly as it found it, and a widened suspension would show up here as an
 * FK trigger that came back disabled.
 */
export const triggerStateSql = () => `SELECT t.tgname, t.tgenabled, t.tgisinternal
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'audit' AND c.relname = 'audit_events'
 ORDER BY t.tgname`;

/**
 * Interpret `triggerStateSql()`. Empty array means every trigger on the table is armed.
 *
 * Rows are `[tgname, tgenabled, tgisinternal]`. An empty result is itself a failure: a table with no
 * triggers at all is not a table that ran this procedure, and reporting "nothing disabled" over zero
 * rows is the vacuity this campaign keeps finding.
 */
export function triggerStateFailures(rows) {
  const out = [];
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return ["audit.audit_events reports no triggers at all — the chain and append-only defences are missing entirely"];
  for (const r of list) {
    const [name, enabled] = Array.isArray(r) ? r : [r?.tgname, r?.tgenabled];
    if (enabled !== "O") out.push(`trigger ${name} is not armed (tgenabled=${enabled}) — the promotion left a defence down`);
  }
  if (!list.some((r) => (Array.isArray(r) ? r[0] : r?.tgname) === CHAIN_TRIGGER)) {
    out.push(`${CHAIN_TRIGGER} is not on the table — the chain would not be maintained on the next live append`);
  }
  return out;
}

/**
 * The whole procedure as an ordered plan, so a runbook and a test execute the same steps.
 *
 * `txn` groups steps that MUST share one transaction. The suspension is expressed as two real
 * statements inside the promote transaction rather than as a flag the caller interprets: a flag can be
 * honoured by any mechanism the caller likes, including the session-wide one KPLUS-F027 removed. Steps
 * with `txn: null` stand alone — `analyze` cannot usefully share a transaction with the insert that made
 * it necessary, and the CONCURRENTLY-free DDL steps have no reason to.
 */
export function backfillPlan() {
  const step = (id, sql, why, txn = null) => Object.freeze({ id, sql, why, txn });
  return Object.freeze([
    step("stage", stagingDdl(), "migration-time staging table, dropped on completion"),
    step("preflight", preflightSql(), "refuse unless the target is genuinely un-chained"),
    step("chain", chainSql(), "one recursive pass in document order, using the trigger's own hash functions"),
    step("suspend_chain_trigger", disableChainTriggerSql(),
      "KPLUS-F027 — stand down ONE named trigger under table ownership. FKs, the append-only refusals and RLS all stay on", "promote"),
    step("promote", promoteSql(), "insert the finished rows without the trigger recomputing them", "promote"),
    step("restore_chain_trigger", enableChainTriggerSql(),
      "re-arm it in the same transaction, so no committed state ever has it down", "promote"),
    step("analyze", analyzeSql(), "KPLUS-F026 — the seal and the verifier both anti-join the promoted table; on stale statistics that plan is quadratic"),
    step("seal", sealSql(), "point the head at the tail the table actually has"),
    step("verify", verifySql(), "re-derive every hash and check the head against the table"),
    step("trigger_state", triggerStateSql(), "KPLUS-F027 — prove the table's defences are all armed again"),
  ]);
}
