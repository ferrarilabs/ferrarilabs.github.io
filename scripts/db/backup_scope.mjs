#!/usr/bin/env node
/**
 * BACKUP SCOPE — the objects a `pg_dump --schema=public` does not carry, and what the backup must do
 * about each one. KPLUS-F012.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * The 2026-08-11 production read counted **7 event triggers in production**. The restored baseline this
 * programme rehearses against holds **0**. Every restore rehearsal so far reported PASS.
 *
 * The design was not naive about this — `backup_contract.json` has always listed `event_triggers_<UTC>.sql`
 * among the companions, and BACKUP_RESTORE_OPERATIONAL_DESIGN.md §2 D captures them. The gap was narrower
 * and worse than "nobody thought of it":
 *
 *   1. the companion was **captured and then never replayed**. Nothing restores it, so a restore is
 *      complete by the contract's own definition while carrying none of them;
 *   2. no acceptance criterion covered it, so A1–A11 could be green with the loss in plain sight;
 *   3. the one place the rehearsal *does* count event triggers, `run_restore_rehearsal.mjs`'s "side
 *      effects" block, exists to prove the scratch cluster **cannot reach anything real** — a containment
 *      check where a count of 0 reads as GOOD. The single number that reveals the loss was being read
 *      with the opposite sign;
 *   4. the design's prose says "the non-provider event trigger", singular. Production has seven.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS AND IS NOT IN SCOPE, AND WHY THE LINE IS WHERE IT IS
 *
 * Event triggers are database-scoped, not schema-scoped, so `--schema=public` excludes all of them
 * regardless of where their function lives. That cuts two ways, and the distinction is the whole design:
 *
 *   APPLICATION_OWNED   the trigger's function is in `public` — ours, versioned by this programme, and
 *                       the reason RLS gets switched on for a new table. MUST be captured and replayed.
 *   PROVIDER_MANAGED    the function lives in a provider schema (`extensions`, `graphql`, `pgrst`…).
 *                       Supabase recreates these itself on any project it manages. Captured for
 *                       ACCOUNTING only, never replayed.
 *
 * Replaying a provider trigger into a bare PostgreSQL target fails outright — the function does not exist
 * — and replaying it into a fresh Supabase project collides with the one the provider already made. So
 * "restore everything for completeness" is not the safe option here; it is the broken one. This is also
 * the brief's instruction: scope is evidence-driven, and unrelated provider-managed objects stay out.
 *
 * NOTE ON THE FUNCTION BODIES. `pg_dump --schema=public` **does** carry `public.rls_auto_enable()` itself.
 * What it drops is the *attachment*. That is exactly the production shape the read found: the function is
 * present in the restored baseline, and nothing is wired to it. Only the attachment needs rebuilding,
 * which is why the companion is small and why replaying it is safe.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY DOES NOT CLAIM
 *
 * Production's seven were **counted, not enumerated** — enumeration is a second production read and this
 * campaign was not authorized to make one. So the APPLICATION_OWNED / PROVIDER_MANAGED split in
 * production is UNKNOWN. `PRODUCTION_EVENT_TRIGGER_FACTS` below records exactly what is known and exactly
 * what is not, and `productionSplitIsKnown()` returns false until an authorized read fills it in. Nothing
 * here infers the split from the local cluster: that inference is the precise error F012 is made of.
 */

import { createHash } from "node:crypto";

/**
 * Production's event triggers, ENUMERATED — no longer only counted.
 *
 * PROBE-2 (2026-08-11) counted seven and could say nothing about the split. A second authorized read-only
 * probe on the same day ran `eventTriggerCaptureSql()` verbatim and settled it: **exactly one is
 * application-owned.**
 *
 * Two things this enumeration corrects, and both are worth stating rather than quietly amending:
 *
 *   1. **The guard IS attached in production.** `ensure_rls` is present and ENABLED, firing on
 *      `CREATE TABLE`, `CREATE TABLE AS` and `SELECT INTO`. The KPLUS-F012 branch that read *"the guard
 *      has never been active, so a table created outside the migration path lands with RLS off"* is FALSE
 *      for production. It is true only of the RESTORED BASELINE — where the attachment was lost by the
 *      dump, which is the finding itself.
 *   2. **The design prose was right and the count was misread.** BACKUP_RESTORE_OPERATIONAL_DESIGN.md
 *      always said "the non-provider event trigger", singular, and that was accurate: 7 total, 1
 *      non-provider. Reading PROBE-2's `7` as "the design underestimated" was an inference from a count,
 *      and it was wrong. Recorded because inferring structure from a scalar is the habit worth breaking,
 *      not just this instance of it.
 *
 * `classifyEventTrigger()` reproduces this split exactly — `public` → APPLICATION_OWNED, `extensions` →
 * PROVIDER_MANAGED — with no adjustment made after seeing the answer.
 */
export const PRODUCTION_EVENT_TRIGGER_FACTS = Object.freeze({
  count: 7,
  countMeasuredAt: "2026-08-11",
  countSource: "authorized read-only window, PROBE-2: SELECT count(*) FROM pg_event_trigger",
  namesKnown: true,
  namesMeasuredAt: "2026-08-11",
  namesSource: "second authorized read-only probe, backup_scope.eventTriggerCaptureSql() verbatim",
  applicationOwnedCount: 1,
  providerManagedCount: 6,
  applicationOwned: Object.freeze([
    Object.freeze({ name: "ensure_rls", event: "ddl_command_end", enabled: "O",
      function_schema: "public", function_name: "rls_auto_enable",
      tags: "CREATE TABLE,CREATE TABLE AS,SELECT INTO" }),
  ]),
  providerManaged: Object.freeze([
    "issue_graphql_placeholder", "issue_pg_cron_access", "issue_pg_graphql_access",
    "issue_pg_net_access", "pgrst_ddl_watch", "pgrst_drop_watch",
  ]),
  guardIsAttachedInProduction: true,
  restoredBaselineCount: 0,
  restoredBaselineCountSource: "run_restore_rehearsal.mjs side-effects probe, every rehearsal to date",
  whatTheBackupMustCarry:
    "exactly one attachment: ensure_rls. The other six are recreated by the platform and must NOT be " +
    "replayed — into a bare PostgreSQL target their functions do not exist, and into a managed project " +
    "they collide with the ones the provider already made.",
});

export const productionSplitIsKnown = () =>
  PRODUCTION_EVENT_TRIGGER_FACTS.namesKnown &&
  PRODUCTION_EVENT_TRIGGER_FACTS.applicationOwnedCount !== null;

/** Classification of an event trigger with respect to the backup's restore scope. */
export const ET_CLASS = Object.freeze({
  APPLICATION_OWNED: "APPLICATION_OWNED",
  PROVIDER_MANAGED: "PROVIDER_MANAGED",
});

/**
 * Schemas whose functions belong to the platform, not to this application.
 *
 * Listed positively and by name rather than detected by a heuristic: a trigger silently reclassified as
 * "provider" is a trigger silently dropped from the restore, and that failure would look exactly like the
 * one this file exists to fix. Anything not on this list classifies as APPLICATION_OWNED, so the default
 * is to CARRY the object — an unknown schema produces an over-inclusive restore that fails loudly, not an
 * under-inclusive one that passes quietly.
 */
export const PROVIDER_FUNCTION_SCHEMAS = Object.freeze([
  "extensions", "graphql", "graphql_public", "pgbouncer", "pgsodium", "pgsodium_masks",
  "realtime", "storage", "supabase_functions", "supabase_migrations", "vault", "net", "cron",
]);

export const classifyEventTrigger = (functionSchema) =>
  PROVIDER_FUNCTION_SCHEMAS.includes(String(functionSchema ?? "").toLowerCase())
    ? ET_CLASS.PROVIDER_MANAGED
    : ET_CLASS.APPLICATION_OWNED;

/**
 * The capture query. Everything needed to REBUILD the attachment, and nothing about the function body —
 * the body comes from the schema dump, and re-capturing it here would create two sources for one object.
 *
 * `evtenabled` is captured because a DISABLED trigger that comes back ENABLED is not a faithful restore;
 * it is a behaviour change wearing a green tick. `evttags` is captured because a tag-filtered trigger
 * restored without its filter fires on statements it never fired on before.
 */
export const eventTriggerCaptureSql = () => `SELECT e.evtname AS name,
       e.evtevent AS event,
       e.evtenabled AS enabled,
       n.nspname AS function_schema,
       p.proname AS function_name,
       coalesce(array_to_string(e.evttags, ','), '') AS tags
  FROM pg_event_trigger e
  JOIN pg_proc p ON p.oid = e.evtfoid
  JOIN pg_namespace n ON n.oid = p.pronamespace
 ORDER BY e.evtname`;

/** `evtenabled` decodes to the ALTER that restores the non-default states. 'O' is the default. */
const ENABLED_STATE = Object.freeze({
  O: { label: "ENABLED", alter: null },
  D: { label: "DISABLED", alter: "DISABLE" },
  R: { label: "ENABLE_REPLICA", alter: "ENABLE REPLICA" },
  A: { label: "ENABLE_ALWAYS", alter: "ENABLE ALWAYS" },
});

const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;
const quoteLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Render one captured row as replayable DDL, or explain why it is not replayed.
 *
 * A PROVIDER_MANAGED row returns `sql: null` and a reason. It is NOT silently skipped: the companion file
 * records it as a comment so the artefact accounts for every trigger that existed, which is what makes a
 * later count comparison meaningful instead of merely equal.
 */
export function renderEventTriggerDdl(row) {
  const cls = classifyEventTrigger(row.function_schema);
  const name = quoteIdent(row.name);

  if (cls === ET_CLASS.PROVIDER_MANAGED) {
    return {
      class: cls, name: row.name, sql: null,
      note: `-- NOT REPLAYED: ${row.name} executes ${row.function_schema}.${row.function_name}(), which belongs to the platform. ` +
            `Supabase recreates it on any project it manages; replaying it would fail on a bare PostgreSQL target ` +
            `(the function does not exist) and collide on a managed one. Recorded so the trigger count reconciles.`,
    };
  }

  const state = ENABLED_STATE[row.enabled] ?? ENABLED_STATE.O;
  const tags = String(row.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const when = tags.length ? ` WHEN TAG IN (${tags.map(quoteLiteral).join(", ")})` : "";
  const lines = [
    `CREATE EVENT TRIGGER ${name} ON ${row.event}${when}` +
    ` EXECUTE FUNCTION ${quoteIdent(row.function_schema)}.${quoteIdent(row.function_name)}();`,
  ];
  // Restore the non-default enable state. Omitting this is how a DISABLED trigger comes back live.
  if (state.alter) lines.push(`ALTER EVENT TRIGGER ${name} ${state.alter};`);

  return { class: cls, name: row.name, sql: lines.join("\n"), note: null, enabledState: state.label };
}

/**
 * The whole companion artefact, from captured rows. Deterministic: same input, same bytes, so its digest
 * is comparable across runs (the manifest records one per member).
 */
export function renderEventTriggerCompanion(rows, { capturedAt = null } = {}) {
  const list = [...(rows ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const rendered = list.map(renderEventTriggerDdl);
  const app = rendered.filter((r) => r.class === ET_CLASS.APPLICATION_OWNED);
  const prov = rendered.filter((r) => r.class === ET_CLASS.PROVIDER_MANAGED);

  const head = [
    "-- EVENT TRIGGER COMPANION — objects pg_dump --schema=public cannot carry.",
    "-- Event triggers are database-scoped; a schema-scoped dump excludes all of them.",
    `-- captured: ${capturedAt ?? "<UTC>"}`,
    `-- total: ${list.length}  application-owned (replayed): ${app.length}  provider-managed (recorded only): ${prov.length}`,
    "--",
    "-- Replay AFTER the main archive: every function these attach to comes from the schema dump.",
    "",
  ];
  const body = rendered.map((r) => (r.sql ? r.sql : r.note)).join("\n\n");
  const text = head.join("\n") + body + (body ? "\n" : "");

  return {
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
    total: list.length,
    applicationOwned: app.map((r) => r.name),
    providerManaged: prov.map((r) => r.name),
    replayableSql: app.map((r) => r.sql).join("\n"),
  };
}

/**
 * Fidelity verdict: did the restore reproduce the event-trigger state the source had?
 *
 * Compares the APPLICATION_OWNED set only, and compares it as a SET WITH ATTRIBUTES — name, event, enable
 * state and tags — not as a count. A count comparison passes when one trigger is lost and another gained,
 * and passes when a DISABLED trigger returns ENABLED. Both are real restores that are not faithful ones.
 *
 * Provider-managed triggers are reported, never asserted: the target legitimately has a different set of
 * them (a bare cluster has none), and failing on that would make every honest local rehearsal red.
 */
export function eventTriggerFidelity(sourceRows, restoredRows) {
  const key = (r) => [r.name, r.event, r.enabled, String(r.tags ?? "")].join("|");
  const appOnly = (rows) => (rows ?? []).filter((r) => classifyEventTrigger(r.function_schema) === ET_CLASS.APPLICATION_OWNED);

  const src = appOnly(sourceRows), dst = appOnly(restoredRows);
  const srcKeys = new Map(src.map((r) => [key(r), r]));
  const dstKeys = new Map(dst.map((r) => [key(r), r]));
  const srcNames = new Set(src.map((r) => r.name));
  const dstNames = new Set(dst.map((r) => r.name));

  const problems = [];
  for (const r of src) {
    if (!dstNames.has(r.name)) {
      problems.push(`${r.name} is in the source and absent from the restore — the backup did not carry it`);
    } else if (!dstKeys.has(key(r))) {
      const got = dst.find((d) => d.name === r.name);
      problems.push(
        `${r.name} came back with different attributes — source (event=${r.event}, enabled=${r.enabled}, tags=${r.tags || "none"}) ` +
        `vs restored (event=${got.event}, enabled=${got.enabled}, tags=${got.tags || "none"}). A trigger that fires differently is not a faithful restore.`);
    }
  }
  for (const r of dst) {
    if (!srcNames.has(r.name)) problems.push(`${r.name} exists in the restore and not in the source — the target carries an attachment the backup never described`);
  }

  return {
    ok: problems.length === 0,
    problems,
    sourceApplicationOwned: src.length,
    restoredApplicationOwned: dst.length,
    sourceProviderManaged: (sourceRows ?? []).length - src.length,
    restoredProviderManaged: (restoredRows ?? []).length - dst.length,
  };
}

/**
 * The regression control, as a first-class function rather than a comment in a test.
 *
 * Answers: "would the PRE-FIX backup scope have caught this?" It must return false for any source that
 * has application-owned event triggers, because the pre-fix scope replayed none of them. A test asserting
 * this is what stops the fix being quietly reverted — if someone removes the replay step, this returns
 * true again for the empty case and the test that depends on it fails.
 */
export function preFixScopeWouldDetect(sourceRows) {
  const app = (sourceRows ?? []).filter((r) => classifyEventTrigger(r.function_schema) === ET_CLASS.APPLICATION_OWNED);
  // The pre-fix scope restored zero event triggers and asserted nothing about them.
  const restoredUnderPreFixScope = [];
  const verdict = eventTriggerFidelity(sourceRows, restoredUnderPreFixScope);
  return { wouldDetect: !verdict.ok, lostTriggers: app.map((r) => r.name), verdictUnderPreFixScope: verdict };
}

/**
 * The rehearsal's verdict on a restored database, from the names alone.
 *
 * `run_restore_rehearsal.mjs` reads a restored target and a bundle; it does not have the source catalog,
 * so it cannot run the full attribute comparison `eventTriggerFidelity()` does. What it CAN do is hold the
 * restore to what the backup itself declared — and that is the check whose absence was KPLUS-F012.
 *
 * A MISSING companion is a finding, not a pass. That distinction is the entire lesson: the pre-fix
 * rehearsal had no companion in the bundle, found zero event triggers, and reported nothing at all.
 */
export function eventTriggerRestoreVerdict(declaredNames, restoredNames) {
  const restored = new Set(restoredNames ?? []);
  if (declaredNames === null || declaredNames === undefined) {
    return {
      ok: false, verdict: "NO_COMPANION",
      problems: ["the bundle carries no event_triggers companion, so the restore cannot be held to any " +
        "event-trigger claim. pg_dump --schema=public carries none of them, so 'the bundle does not " +
        "mention them' and 'the restore lost them' are the same state — which is exactly how KPLUS-F012 " +
        "stayed invisible across every green rehearsal."],
    };
  }
  const problems = [];
  for (const n of declaredNames) if (!restored.has(n)) problems.push(`${n} is declared by the backup companion and is absent from the restored database — the companion was captured but not replayed`);
  const declared = new Set(declaredNames);
  for (const n of restored) if (!declared.has(n)) problems.push(`${n} exists in the restored database and is not declared by the companion — the target carries an attachment the backup never described`);
  return {
    ok: problems.length === 0,
    verdict: problems.length === 0 ? (declaredNames.length ? "FAITHFUL" : "NONE_DECLARED_NONE_PRESENT") : "UNFAITHFUL",
    problems,
  };
}

/**
 * The full omission inventory, as the contract's data rather than the runbook's prose.
 *
 * `restoreAction` is the field that matters: CAPTURE alone is what F012 was. A row may only say
 * CAPTURE_ONLY when the reason it is not replayed is recorded next to it.
 */
export const DUMP_OMISSIONS = Object.freeze([
  Object.freeze({
    object: "event triggers",
    why: "database-scoped, not schema-scoped — --schema=public excludes all of them",
    captureSql: "backup_scope.eventTriggerCaptureSql()",
    restoreAction: "REPLAY_APPLICATION_OWNED",
    verifiedBy: "A12 — backup_scope.eventTriggerFidelity()",
    consequenceIfMissed: "rls_auto_enable stops running; a table created outside the migration path lands with RLS OFF and nothing switches it on. This is KPLUS-F012.",
  }),
  Object.freeze({
    object: "role attributes (BYPASSRLS, LOGIN, …)",
    why: "roles are cluster-global; a database-level dump does not carry them",
    captureSql: "Phase 1 S14e — roles_reference_<UTC>.csv",
    restoreAction: "CAPTURE_ONLY",
    captureOnlyWhy: "restoring cluster roles into a target that shares no role namespace is not a restore, it is a cluster edit. The capture exists so grants can be reconciled against roles that must pre-exist. KPLUS-F039 is the standing proof that this omission has real consequences: production's service_role has BYPASSRLS and the restored baseline's does not.",
    verifiedBy: "A9 grant reconciliation",
    consequenceIfMissed: "grants reference roles that do not exist; RLS behaves differently because BYPASSRLS differs",
  }),
  Object.freeze({
    object: "supabase_migrations.schema_migrations ledger",
    why: "outside the dumped schema",
    captureSql: "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
    restoreAction: "CAPTURE_ONLY",
    captureOnlyWhy: "the ledger describes what was applied to the SOURCE. Replaying it into a target would assert a migration history the target did not live through.",
    verifiedBy: "manifest member digest",
    consequenceIfMissed: "no way to tell which migrations the backup predates",
  }),
]);

export const replayedOmissions = () => DUMP_OMISSIONS.filter((o) => o.restoreAction.startsWith("REPLAY"));
