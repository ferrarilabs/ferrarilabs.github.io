#!/usr/bin/env node
/**
 * PRIVILEGE MODEL — privilege intent, made explicit, generated and testable.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * KPLUS-F055 found three production tables the model had never seen. KPLUS-F058 found two views anon
 * could write `bolao_state` through, which made the cutover fence bypassable. Both exposures had the same
 * origin, and it was not a migration anybody wrote:
 *
 *   Supabase grants ALL on every relation created in `public` to anon, authenticated and service_role,
 *   by way of ALTER DEFAULT PRIVILEGES. No SQL in either repository asks for it. The product team's own
 *   files grant only SELECT — the write half arrives on its own.
 *
 * So the platform's default is "everything, to everyone, forever", and every object created in `public`
 * by any channel inherits it silently. A privilege model that only describes what the migrations grant
 * describes a fraction of the real access surface.
 *
 * This module makes the intent explicit: what each role SHOULD hold per object class, what production
 * currently holds, the difference, and the SQL that closes it — forward and back.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE DISTINCTION THIS FILE REFUSES TO BLUR
 *
 * `CURRENT_EFFECTIVE` is what `has_table_privilege` returns today. `TARGET_EFFECTIVE` is what the access
 * model says should be true. They are different things and neither is evidence for the other. Production
 * currently grants anon DELETE on `lottery_payment_transactions`; that is a fact about production, not an
 * argument for keeping it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS MEASURED AND WHAT IS NOT — read this before trusting any row below
 *
 * The 2026-08-11 read-only windows measured, in production:
 *   · SELECT/INSERT/UPDATE/DELETE for anon, authenticated, service_role on 10 tables and 2 views;
 *   · EXECUTE on `public.rls_auto_enable()` for anon and authenticated;
 *   · the event-trigger set.
 *
 * They did NOT measure, and nothing here may pretend otherwise:
 *   · TRUNCATE, REFERENCES or TRIGGER on any production relation (PROBE-4 read four privileges);
 *   · any SEQUENCE privilege;
 *   · EXECUTE on any function other than `rls_auto_enable`;
 *   · `pg_default_acl` — **the mechanism itself has never been read in production.**
 *
 * That last one matters most. The default-privilege behaviour described here is inferred from Supabase's
 * documented bootstrap plus the observed effect that every relation in `public` carries anon CRUD. It is
 * a well-supported inference and it is still an inference. `PRODUCTION_EVIDENCE.unmeasured` lists it, and
 * `CONSOLIDATED_READ_PACKAGE` below is the one query set that would settle it.
 */

import { createHash } from "node:crypto";
// No cycle: rls.mjs imports validate_access_model.mjs and nothing from here.
import { loadRlsModel, operationMatrix } from "./rls.mjs";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. ROOT-CAUSE MODEL — where a privilege can come from
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The five distinct sources of an effective privilege. Kept separate because the REMEDY differs for each:
 * you revoke an explicit grant, you alter a default, and you cannot do either to a built-in.
 */
export const PRIVILEGE_SOURCE = Object.freeze({
  EXPLICIT_GRANT: "EXPLICIT_GRANT",
  DEFAULT_PRIVILEGE_INHERITANCE: "DEFAULT_PRIVILEGE_INHERITANCE",
  POSTGRES_BUILTIN: "POSTGRES_BUILTIN",
  PLATFORM_MANAGED: "PLATFORM_MANAGED",
  MIGRATION_GENERATED: "MIGRATION_GENERATED",
});

/**
 * How each object class actually behaves. The `postgresBuiltin` column is the one people get wrong:
 * PostgreSQL grants EXECUTE on functions to PUBLIC by default, and nothing else to anybody.
 */
export const OBJECT_CLASS_BEHAVIOUR = Object.freeze([
  Object.freeze({
    objectClass: "TABLE", relkinds: ["r", "p"],
    postgresBuiltin: "none — a new table grants nothing to anyone but its owner",
    platformDefault: "Supabase: ALL to anon, authenticated, service_role via ALTER DEFAULT PRIVILEGES in schema public",
    inheritedByFutureObjects: true,
    privileges: ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"],
  }),
  Object.freeze({
    objectClass: "VIEW", relkinds: ["v"],
    postgresBuiltin: "none",
    platformDefault: "same as TABLE — ALTER DEFAULT PRIVILEGES ON TABLES covers views, which is exactly how KPLUS-F058 happened",
    inheritedByFutureObjects: true,
    privileges: ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"],
    note: "a view carries its OWNER's authority unless security_invoker=on, so a write privilege on a view is a write privilege on everything it selects from",
  }),
  Object.freeze({
    objectClass: "MATERIALIZED_VIEW", relkinds: ["m"],
    postgresBuiltin: "none",
    platformDefault: "ALTER DEFAULT PRIVILEGES ON TABLES does NOT cover materialized views — PostgreSQL has no defacl object type for them, so they are only ever reachable by explicit grant",
    inheritedByFutureObjects: false,
    privileges: ["SELECT", "REFERENCES"],
  }),
  Object.freeze({
    objectClass: "SEQUENCE", relkinds: ["S"],
    postgresBuiltin: "none",
    platformDefault: "Supabase: ALL to anon, authenticated, service_role",
    inheritedByFutureObjects: true,
    privileges: ["USAGE", "SELECT", "UPDATE"],
    note: "USAGE on a sequence lets a role call nextval and therefore insert into a table whose default depends on it — a write capability that never appears in a table's ACL",
  }),
  Object.freeze({
    objectClass: "FUNCTION", relkinds: [],
    postgresBuiltin: "EXECUTE to PUBLIC — the only built-in default that grants anything, and the one that makes a SECURITY DEFINER function dangerous the moment it is created",
    platformDefault: "Supabase: ALL to anon, authenticated, service_role, on top of the PUBLIC grant",
    inheritedByFutureObjects: true,
    privileges: ["EXECUTE"],
  }),
  Object.freeze({
    objectClass: "FOREIGN_TABLE", relkinds: ["f"],
    postgresBuiltin: "none",
    platformDefault: "not covered by ALTER DEFAULT PRIVILEGES ON TABLES",
    inheritedByFutureObjects: false,
    privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  }),
]);

/**
 * **ALTER DEFAULT PRIVILEGES IS PER-CREATOR-ROLE.** The single most load-bearing fact in this file.
 *
 * `ALTER DEFAULT PRIVILEGES [FOR ROLE x] IN SCHEMA public ...` only affects objects created BY x. Setting
 * it for `postgres` changes nothing about objects created by `supabase_admin`, and vice versa. A
 * remediation that alters defaults for one role and then declares the class fixed has fixed one creator's
 * objects and left every other creator's untouched — and it will look correct in every test that creates
 * its fixtures as the role that was altered.
 *
 * This programme has TWO channels creating objects (ADR-K10) and does not know, without reading
 * `pg_default_acl`, which roles own the existing defaults. So `CREATOR_ROLES` is a list of candidates to
 * be CONFIRMED, not a list of facts.
 */
export const CREATOR_ROLES = Object.freeze([
  Object.freeze({ role: "postgres", why: "the owner of every relation the 2026-08-11 probe reported", confirmed: true,
    confirmedBy: "view probe — pg_get_userbyid(relowner) = 'postgres' for both views" }),
  Object.freeze({ role: "supabase_admin", why: "the platform's bootstrap role; conventionally the one that sets the initial defaults", confirmed: false,
    howToConfirm: "SELECT defaclrole::regrole FROM pg_default_acl — never read in production" }),
  Object.freeze({ role: "supabase_migrations", why: "may own objects applied through the CLI migration path", confirmed: false,
    howToConfirm: "same query" }),
]);

export const unconfirmedCreatorRoles = () => CREATOR_ROLES.filter((r) => !r.confirmed);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. TARGET PRIVILEGE POLICY — least privilege, stated as intent
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What each role SHOULD hold. Derived from the access model, not from production.
 *
 * `anon` is the load-bearing case: the anon key ships in the page source, so anything anon may do, anyone
 * on the internet may do. It gets SELECT where a browser genuinely reads, and nothing else — writes go
 * through the trusted runtime or a narrow SECURITY DEFINER RPC.
 *
 * RLS IS NOT A SUBSTITUTE. A grant with no policy is inert TODAY and becomes live the moment someone adds
 * a policy or disables RLS; KPLUS-F036 is that exposure sitting in production right now. The grant is the
 * layer a stale browser tab cannot argue with, so the grant is where least privilege is enforced.
 */
export const TARGET_POLICY = Object.freeze({
  SCHEMA: Object.freeze({
    anon: Object.freeze([]),
    authenticated: Object.freeze([]),
    service_role: Object.freeze(["USAGE"]),
    owner: Object.freeze(["ALL"]),
    PUBLIC: Object.freeze([]),
    inheritedByFutureObjects: false,
    why: "a whole privilege class was missing here, and its absence was silent: reaching any object requires USAGE on its schema first, so every grant this model emits inside bolao or audit was inert. Measured on the Q7 from-zero replay — M1 grants service_role EXECUTE on audit.event_hash_v1, has_function_privilege() returned TRUE, and the actual call returned 'permission denied for schema audit'. Only executing as the role exposed it; no ACL-string comparison could have.",
    whyBrowserRolesGetNothing: "anon and authenticated reach normalized data through views and RPCs rather than by traversing these schemas — the same reasoning as TABLE. When a stage creates that read surface, its grant is a separate reviewable decision made with evidence, not inherited from here.",
    whyNoCreate: "CREATE on a schema lets a principal add objects that later grants and default privileges would then apply to.",
  }),
  TABLE: Object.freeze({
    anon: Object.freeze([]),
    authenticated: Object.freeze([]),
    service_role: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
    owner: Object.freeze(["ALL"]),
    PUBLIC: Object.freeze([]),
    inheritedByFutureObjects: false,
    why: "browser roles reach the normalized tables through views and RPCs, never directly. service_role is the trusted runtime. TRUNCATE, REFERENCES and TRIGGER go to nobody but the owner — TRIGGER lets a principal attach code that fires for every writer.",
  }),
  VIEW: Object.freeze({
    anon: Object.freeze(["SELECT"]),
    authenticated: Object.freeze(["SELECT"]),
    service_role: Object.freeze(["SELECT"]),
    owner: Object.freeze(["ALL"]),
    PUBLIC: Object.freeze([]),
    inheritedByFutureObjects: false,
    why: "views are the read surface and only the read surface. KPLUS-F058: a write privilege on a view is a write privilege on everything it selects from, executed with the view owner's authority and bypassing the underlying table's RLS.",
  }),
  MATERIALIZED_VIEW: Object.freeze({
    anon: Object.freeze([]), authenticated: Object.freeze([]), service_role: Object.freeze(["SELECT"]),
    owner: Object.freeze(["ALL"]), PUBLIC: Object.freeze([]), inheritedByFutureObjects: false,
    why: "none exist today. Denied by default so the first one to appear is a deliberate grant rather than an inheritance.",
  }),
  SEQUENCE: Object.freeze({
    anon: Object.freeze([]), authenticated: Object.freeze([]), service_role: Object.freeze(["USAGE", "SELECT"]),
    owner: Object.freeze(["ALL"]), PUBLIC: Object.freeze([]), inheritedByFutureObjects: false,
    why: "USAGE is a write capability wearing a different name: it is what lets nextval() run, so a role with USAGE can insert into any table defaulting from it. service_role gets no UPDATE — resetting a sequence is an operator action.",
  }),
  FUNCTION: Object.freeze({
    anon: Object.freeze([]), authenticated: Object.freeze([]), service_role: Object.freeze([]),
    owner: Object.freeze(["ALL"]), PUBLIC: Object.freeze([]), inheritedByFutureObjects: false,
    why: "EXECUTE is granted per function, deliberately, never by default. PostgreSQL's built-in EXECUTE-to-PUBLIC must be revoked explicitly for every function: it is the one built-in default that hands out a capability, and on a SECURITY DEFINER function it hands out the owner's.",
    exceptions: "narrow RPCs (submit_cdb_entry, resolve_notification_recipients) are granted individually by the migration that creates them, and each such grant is a reviewable line.",
  }),
  FOREIGN_TABLE: Object.freeze({
    anon: Object.freeze([]), authenticated: Object.freeze([]), service_role: Object.freeze([]),
    owner: Object.freeze(["ALL"]), PUBLIC: Object.freeze([]), inheritedByFutureObjects: false,
    why: "none exist. A foreign table reaches outside this database, so it is denied until someone argues for it.",
  }),
});

export const BROWSER_ROLES = Object.freeze(["anon", "authenticated"]);
export const TRUSTED_ROLES = Object.freeze(["service_role"]);
export const MANAGED_ROLES = Object.freeze([...BROWSER_ROLES, ...TRUSTED_ROLES]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. WHAT PRODUCTION ACTUALLY SHOWED
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const PRODUCTION_EVIDENCE = Object.freeze({
  measuredAt: "2026-08-11",
  measured: Object.freeze([
    "SELECT/INSERT/UPDATE/DELETE for anon, authenticated, service_role on 10 tables (PROBE-4)",
    "SELECT/INSERT/UPDATE/DELETE for the same roles on 2 views (view probe)",
    "EXECUTE on public.rls_auto_enable() for anon and authenticated (PROBE-3)",
    "the 7 event triggers, enumerated",
    "relation inventory of public by relkind: 10 tables, 2 views, 15 indexes, 0 matviews, 0 foreign tables, 0 partitioned tables",
  ]),
  unmeasured: Object.freeze([
    "TRUNCATE / REFERENCES / TRIGGER on any production relation — PROBE-4 read four privileges, not seven",
    "every SEQUENCE privilege — sequences were never enumerated, let alone their ACLs",
    "EXECUTE on any function except rls_auto_enable",
    "pg_default_acl — THE MECHANISM ITSELF HAS NEVER BEEN READ. The default-privilege behaviour modelled here is inferred from Supabase's documented bootstrap plus the observed effect that every relation in public carries anon CRUD.",
    "which creator role owns the existing default privileges — decisive, because ALTER DEFAULT PRIVILEGES is per-role",
    "PUBLIC's grants on anything",
  ]),
  inferenceStatus: "WELL_SUPPORTED_BUT_UNCONFIRMED",
  whyItMatters: "a remediation that alters defaults FOR ROLE postgres, when the existing defaults belong to supabase_admin, changes nothing and passes every local test that creates fixtures as postgres.",
});

/**
 * The one consolidated read-only package that would settle everything left open. Prepared, NOT executed —
 * this prompt does not authorize production reads.
 */
export const CONSOLIDATED_READ_PACKAGE = Object.freeze([
  Object.freeze({ id: "CR-1", need: "the default-privilege mechanism itself, and which creator role owns it",
    sql: "SELECT d.defaclrole::regrole AS creator, n.nspname, d.defaclobjtype, d.defaclacl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace",
    sensitivity: "role names and ACL strings; no row of any table, no PII",
    unblocks: "the entire DEFAULT PRIVILEGE MIGRATION DESIGN — without it, every ALTER DEFAULT PRIVILEGES below targets a guessed role" }),
  Object.freeze({ id: "CR-2", need: "the remaining three table privileges the first probe did not read",
    sql: "has_table_privilege(role, oid, p) for p in (TRUNCATE, REFERENCES, TRIGGER) across public relations",
    sensitivity: "booleans", unblocks: "the reconciliation matrix's UNKNOWN_BLOCKING rows for tables" }),
  Object.freeze({ id: "CR-3", need: "sequences and their ACLs",
    sql: "SELECT c.relname, c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'",
    sensitivity: "names and ACL strings", unblocks: "sequence rows in the matrix; USAGE is an unrecorded write capability" }),
  Object.freeze({ id: "CR-4", need: "function EXECUTE grants, including PUBLIC, and SECURITY DEFINER flags",
    sql: "SELECT p.proname, p.prosecdef, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'",
    sensitivity: "names, booleans, ACL strings — no function BODY is read", unblocks: "the PUBLIC EXECUTE mutant against real data" }),
]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const DIFF_CLASS = Object.freeze({
  EXPECTED_REVOKE: "EXPECTED_REVOKE",
  EXPECTED_GRANT: "EXPECTED_GRANT",
  PLATFORM_DEFAULT: "PLATFORM_DEFAULT",
  LEGACY_COMPATIBILITY_EXCEPTION: "LEGACY_COMPATIBILITY_EXCEPTION",
  PROVIDER_MANAGED: "PROVIDER_MANAGED",
  UNKNOWN_BLOCKING: "UNKNOWN_BLOCKING",
});

/**
 * Relations that must keep a browser-reachable privilege the target policy would otherwise remove, each
 * with the condition under which the exception ends. An exception with no end condition is a permanent
 * grant with better branding.
 */
export const LEGACY_COMPATIBILITY_EXCEPTIONS = Object.freeze([
  Object.freeze({ relation: "bolao_state", role: "anon", privileges: ["SELECT"],
    until: "cutover step 13 — the read cutover. Until then the browser's source of truth IS this document.",
    finding: "cutover choreography" }),
  Object.freeze({ relation: "bolao_state", role: "authenticated", privileges: ["SELECT"],
    until: "cutover step 13 — the read cutover. authenticated reads the same document as anon today, and removing its read before step 13 is a read outage for signed-in users specifically.",
    finding: "cutover choreography" }),
  Object.freeze({ relation: "bolao_state", role: "service_role", privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    until: "LEGACY_FROZEN at cutover step 19 — the trusted runtime mirrors into this document until then", finding: "KPLUS-F039" }),
  Object.freeze({ relation: "bolao_state_public", role: "anon", privileges: ["SELECT"],
    until: "the F10 retirement gate (see F10_RETIREMENT_GATE) — this is the browser's PII-stripped read path", finding: "KPLUS-F058" }),
  Object.freeze({ relation: "bolao_state_public", role: "authenticated", privileges: ["SELECT"],
    until: "the F10 retirement gate — the same gate as anon; a signed-in browser reads the same PII-stripped projection.",
    finding: "KPLUS-F058" }),
  Object.freeze({ relation: "bolao_state_public_cdb", role: "anon", privileges: ["SELECT"],
    until: "the F10 retirement gate, plus CDB2026's own client migration — CDB2026 is in production", finding: "KPLUS-F058" }),
  Object.freeze({ relation: "bolao_state_public_cdb", role: "authenticated", privileges: ["SELECT"],
    until: "the F10 retirement gate, plus CDB2026's own client migration — CDB2026 has been in production since 2026-07-19.",
    finding: "KPLUS-F058" }),
  Object.freeze({ relation: "live_sports_cache", role: "anon", privileges: ["SELECT"],
    until: "indefinite — the payload is public sports data and the browser reads it directly by design",
    finding: "ADR-K10", permanent: true }),
]);

const exceptionFor = (relation, role) => LEGACY_COMPATIBILITY_EXCEPTIONS.find((e) => e.relation === relation && e.role === role);

/**
 * What the RLS/authorization model actually authorizes the trusted runtime to DO, per target entity.
 *
 * TARGET_POLICY.TABLE is a CLASS ceiling — the most any table of this class may hold. It is not, by
 * itself, a statement that every table needs all of it. Read as a per-table grant list it over-grants
 * badly, and this was measured rather than argued:
 *
 *   · DELETE — authorized on ZERO of the 26 entities. `rls_model.json` sets `noDeleteAnywhere: true`,
 *     contains no DELETE policy at all (its commands are SELECT/INSERT/UPDATE), and `write_contracts.mjs`
 *     does not mention DELETE once.
 *   · INSERT on audit_chain_head — the row is seeded by M8 and thereafter only UPDATEd by the chain
 *     trigger. Nothing inserts it.
 *   · UPDATE on the append-only entities — audit_events, ranking_snapshots, outbox_delivery_attempts,
 *     classification_snapshots, competition_edition_standings, request_idempotency.
 *
 * That is 33 privileges the architecture authorizes nowhere. Granting them would not be harmless:
 * `service_role` holds **BYPASSRLS** in production (measured 2026-08-11), so the absence of a DELETE
 * policy protects nothing at all. A granted DELETE is an unrestricted destructive capability over
 * payments, prize_allocations and audit_events — the exact tables this programme exists to keep intact.
 * The GRANT is the only control, so the GRANT is where least privilege has to be real.
 *
 * Derived from the model rather than transcribed, so it cannot drift from the policies it describes.
 * See ADR-K11.
 */
let _runtimeNeeds = null;
export function runtimeRequiredPrivileges() {
  if (_runtimeNeeds) return _runtimeNeeds;
  const mx = operationMatrix(loadRlsModel());
  _runtimeNeeds = new Map(mx.entities.map((entity) => [entity,
    ["SELECT", "INSERT", "UPDATE", "DELETE"].filter((cmd) => {
      const v = ((mx.matrix[entity] || {})[cmd] || {}).trusted_runtime;
      return v && (v.verdict === "ALLOW" || v.verdict === "TRUSTED_RUNTIME_ONLY");
    })]));
  return _runtimeNeeds;
}

/** The privileges the target policy allows for (objectClass, role), exceptions included. */
export function targetPrivileges(objectClass, role, relation = null) {
  const policy = TARGET_POLICY[objectClass];
  if (!policy) return null;
  const ex = relation ? exceptionFor(relation, role) : null;
  let base = policy[role] ?? [];

  // Narrow the class ceiling to what the authorization model authorizes for THIS relation. Only for the
  // trusted runtime on target-schema tables: browser roles already get nothing, and the legacy `public`
  // relations are governed by the exceptions below, not by the target entity model.
  if (objectClass === "TABLE" && role === "service_role" && relation && relation.includes(".")) {
    const [schema, name] = String(relation).split(".");
    if (schema === "bolao" || schema === "audit") {
      const needs = runtimeRequiredPrivileges().get(name);
      // FAIL CLOSED on an entity the authorization model has never heard of. The first version of this
      // returned the untouched class ceiling — including DELETE — for any relation absent from
      // rls_model.json. That is the wrong direction for a default: a table added to the target model and
      // not yet given an access decision would have been granted MORE than any table that has one, and
      // it would have looked correct because the narrowing "did not apply". An unknown entity gets
      // nothing until somebody decides what it should get.
      base = needs ? base.filter((p) => needs.includes(p)) : [];
    }
  }

  if (!ex) return [...base];
  return [...new Set([...base, ...ex.privileges])].sort();
}

/**
 * One reconciliation row per (relation, role). `current` is `null` where nothing was measured — and that
 * becomes UNKNOWN_BLOCKING rather than an assumed empty set. Guessing "probably none" for an unmeasured
 * privilege is how KPLUS-F058 got its write grants.
 */
export function reconcile(relations, measured) {
  const rows = [];
  const measuredKey = new Map((measured ?? []).map((m) => [`${m.relation}|${m.role}`, m.privileges]));

  for (const rel of relations) {
    for (const role of MANAGED_ROLES) {
      const key = `${rel.name}|${role}`;
      const current = measuredKey.has(key) ? [...measuredKey.get(key)].sort() : null;
      const target = targetPrivileges(rel.objectClass, role, rel.name);
      const ex = exceptionFor(rel.name, role);

      if (rel.providerManaged) {
        rows.push({ relation: rel.name, role, objectClass: rel.objectClass, current, target: null,
          diffClass: DIFF_CLASS.PROVIDER_MANAGED, actionRequired: null, rollbackRequired: null,
          note: "the platform owns this object; changing its privileges is not this programme's decision" });
        continue;
      }
      if (current === null) {
        rows.push({ relation: rel.name, role, objectClass: rel.objectClass, current: null, target,
          diffClass: DIFF_CLASS.UNKNOWN_BLOCKING, actionRequired: null, rollbackRequired: null,
          note: `no production measurement exists for ${rel.objectClass} privileges of ${role}; see CONSOLIDATED_READ_PACKAGE. A rollback cannot restore a state nobody recorded.` });
        continue;
      }

      const toRevoke = current.filter((p) => !target.includes(p));
      const toGrant = target.filter((p) => !current.includes(p));

      let diffClass;
      if (!toRevoke.length && !toGrant.length) diffClass = ex ? DIFF_CLASS.LEGACY_COMPATIBILITY_EXCEPTION : null;
      else if (toRevoke.length && !toGrant.length) {
        // A revoke of exactly the platform's blanket set, on a relation nobody granted it on, is the
        // default-privilege inheritance and is labelled as such — the remedy differs from a plain revoke.
        diffClass = rel.inheritedOnly ? DIFF_CLASS.PLATFORM_DEFAULT : DIFF_CLASS.EXPECTED_REVOKE;
      } else if (toGrant.length && !toRevoke.length) diffClass = DIFF_CLASS.EXPECTED_GRANT;
      else diffClass = DIFF_CLASS.EXPECTED_REVOKE;

      rows.push({
        relation: rel.name, role, objectClass: rel.objectClass, current, target,
        diffClass, actionRequired: toRevoke.length || toGrant.length
          ? [...toRevoke.map((p) => `REVOKE ${p}`), ...toGrant.map((p) => `GRANT ${p}`)] : [],
        rollbackRequired: toRevoke.length || toGrant.length
          ? [...toRevoke.map((p) => `GRANT ${p}`), ...toGrant.map((p) => `REVOKE ${p}`)] : [],
        exception: ex ? { until: ex.until, finding: ex.finding, permanent: !!ex.permanent } : null,
      });
    }
  }
  return rows;
}

export const blockingRows = (rows) => rows.filter((r) => r.diffClass === DIFF_CLASS.UNKNOWN_BLOCKING);

/**
 * The privilege DIMENSION nobody measured, as first-class blocking rows.
 *
 * `reconcile()` compares the privileges it was given, so a production relation whose CRUD was measured
 * looks fully known. It is not: TRUNCATE, REFERENCES and TRIGGER were never read on any production
 * relation, and the target policy grants all three to nobody. Every one of them is therefore a possible
 * EXPECTED_REVOKE that cannot be generated, and — the part that matters — cannot be ROLLED BACK, because
 * a rollback restores a measured prior state and there is none.
 *
 * TRIGGER is the one to care about: it lets a principal attach code to a table it does not own, and that
 * code runs for every writer. Whether anon holds it in production is unknown.
 */
export function unmeasuredDimensionRows(relations, unmeasuredPrivileges) {
  const rows = [];
  // An EMPTY unmeasured list means every dimension was read, so there is nothing to block on. This used
  // to emit one blocking row per (relation, role) regardless — so a caller who had just measured all
  // seven privileges was told 78 dimensions were unmeasured. A gate that fires when the thing it guards
  // against is absent teaches its caller to ignore it, which is how a real blocking row gets waved past.
  if (!unmeasuredPrivileges || !unmeasuredPrivileges.length) return rows;
  for (const r of relations) {
    if (r.scope !== "PRODUCTION" || r.providerManaged) continue;
    for (const role of MANAGED_ROLES) {
      rows.push({
        relation: r.name, role, objectClass: r.objectClass,
        current: null, target: [],
        privilegeDimension: [...unmeasuredPrivileges],
        diffClass: DIFF_CLASS.UNKNOWN_BLOCKING,
        actionRequired: null, rollbackRequired: null,
        note: `${unmeasuredPrivileges.join("/")} were never read in production for this pair. The target policy grants them to nobody, so each is a possible revoke that cannot be generated and cannot be rolled back. See CONSOLIDATED_READ_PACKAGE CR-2.`,
      });
    }
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. GENERATOR
// ─────────────────────────────────────────────────────────────────────────────────────────────

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
/**
 * Qualify a relation name. Target-schema relations already carry their schema (`bolao.payments`), and
 * blindly prefixing produced `public."bolao.payments"` — a single identifier containing a dot, which is a
 * different relation that does not exist. Quote each part instead.
 */
const rel = (n) => String(n).includes(".") ? String(n).split(".").map(q).join(".") : `public.${q(n)}`;

const DEFACL_TYPES = Object.freeze([
  { kw: "TABLES", policyKey: "TABLE", covers: "tables, views and foreign tables — PostgreSQL has one defacl type for all of them" },
  { kw: "SEQUENCES", policyKey: "SEQUENCE", covers: "sequences" },
  { kw: "FUNCTIONS", policyKey: "FUNCTION", covers: "functions and procedures" },
]);

/**
 * The default-privilege statements, emitted PER CREATOR ROLE.
 *
 * Emitting one block per role is the whole point: `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` applies to
 * the CURRENT role only, so an unqualified statement silently fixes whoever happens to run it and leaves
 * every other creator's future objects inheriting the platform default.
 */
export function renderDefaultPrivilegeSql(creatorRoles = CREATOR_ROLES) {
  const L = [];
  L.push("-- NOT FOR PRODUCTION APPLY — generated design artefact.");
  L.push("-- GENERATED FILE — do not edit by hand. Source: scripts/db/privilege_model.mjs");
  L.push("-- Regenerate: node scripts/db/privilege_model.mjs --write");
  L.push("--");
  L.push("-- ALTER DEFAULT PRIVILEGES IS PER-CREATOR-ROLE. Objects created by a role whose defaults were");
  L.push("-- never altered keep inheriting the platform's blanket grant, and every test whose fixtures are");
  L.push("-- created by an altered role will pass while that is true.");
  L.push("--");
  for (const c of creatorRoles) {
    L.push(`-- ${c.role}: ${c.why}${c.confirmed ? "" : "  [UNCONFIRMED — " + c.howToConfirm + "]"}`);
  }
  L.push("");
  for (const c of creatorRoles) {
    L.push(`-- ── creator role: ${c.role} ${c.confirmed ? "" : "(UNCONFIRMED)"}`);
    for (const t of DEFACL_TYPES) {
      const p = TARGET_POLICY[t.policyKey];
      L.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${q(c.role)} IN SCHEMA public REVOKE ALL ON ${t.kw} FROM ${MANAGED_ROLES.map(q).join(", ")}, PUBLIC;`);
      for (const role of MANAGED_ROLES) {
        if (p[role] && p[role].length && p.inheritedByFutureObjects) {
          L.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${q(c.role)} IN SCHEMA public GRANT ${p[role].join(", ")} ON ${t.kw} TO ${q(role)};`);
        }
      }
    }
    L.push("");
  }
  /**
   * KPLUS-F059 — the schema-scoped revoke CANNOT remove PUBLIC's built-in EXECUTE, and it fails silently.
   *
   * Measured on PostgreSQL 17.10 by NIGHT-28's canary, not read in a manual:
   *
   *   ALTER DEFAULT PRIVILEGES FOR ROLE x IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC
   *     -> NO pg_default_acl row is created. A function created afterwards still carries `=X/owner`,
   *        and a probe role can still execute it. The statement succeeds and does nothing.
   *
   *   ALTER DEFAULT PRIVILEGES FOR ROLE x REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC      (no IN SCHEMA)
   *     -> a row IS created with defaclnamespace NULL, and PUBLIC loses EXECUTE.
   *
   * The reason is that PostgreSQL's built-in EXECUTE-to-PUBLIC is a database-wide default, not something
   * recorded at schema scope, so a schema-restricted default ACL has nothing to subtract it from. This is
   * precisely the class of error a SQL review cannot catch: the statement is valid, it returns success,
   * and only a newly created object reveals that nothing happened.
   *
   * The unrestricted form is therefore emitted deliberately, and its wider blast radius is stated rather
   * than hidden: it covers every schema this creator makes functions in, not just `public`.
   */
  L.push("-- ── PUBLIC's built-in EXECUTE — schema-scoped revokes DO NOT remove it (KPLUS-F059).");
  L.push("-- Measured by NIGHT-28: the IN SCHEMA form above creates no pg_default_acl row and new");
  L.push("-- functions remain world-executable. The built-in is database-wide, so the revoke must be too.");
  L.push("-- SCOPE NOTE: these statements are NOT restricted to `public`. They cover every schema the");
  L.push("-- creator makes functions in. That is deliberate — PUBLIC should hold EXECUTE nowhere by");
  L.push("-- default — but it is a wider blast radius than the block above and is called out as such.");
  for (const c of creatorRoles) {
    L.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${q(c.role)} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;${c.confirmed ? "" : "   -- creator UNCONFIRMED"}`);
  }
  L.push("");
  L.push("-- Existing functions still need the explicit REVOKE in the forward SQL: altering a default");
  L.push("-- changes what the NEXT object inherits and never touches one that already exists.");
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

/** Forward SQL for existing objects, derived from the reconciliation rows. */
export function renderForwardSql(rows, { intent = "DESIGN_ARTEFACT", lane = "PRODMIG-Q19" } = {}) {
  const L = [];
  // The banner states the artefact's actual status. It was hard-coded to NOT FOR PRODUCTION APPLY while
  // production was entirely off-limits; once applying became authorized, a file that still said "do not
  // apply" while being applied would be a lie sitting in the evidence directory. Callers must pass the
  // intent explicitly, and the default stays the refusing one.
  //
  // `lane` is a parameter for the same reason `intent` is. The lane name was hard-coded to Q19 because Q19
  // was the only privilege package that had ever existed; Q26 re-runs the identical reconciliation against
  // a 27th relation, and a Q26 file whose own banner says Q19 misfiles itself in the evidence directory.
  // The default stays PRODMIG-Q19 so the applied Q19 package still renders to its recorded digest.
  L.push(intent === "PRODUCTION_APPLY"
    ? `-- AUTHORIZED FOR PRODUCTION APPLY — ${lane} trusted-runtime grants.`
    : "-- NOT FOR PRODUCTION APPLY — generated design artefact.");
  L.push("-- GENERATED FILE — do not edit by hand. Source: scripts/db/privilege_model.mjs");
  L.push("-- Existing-object privilege reconciliation. Statements are derived from the MEASURED current");
  L.push("-- state, so a row nobody measured produces no statement — see UNKNOWN_BLOCKING.");
  L.push("");
  const blocking = blockingRows(rows);
  if (blocking.length) {
    L.push(`-- ${blocking.length} (relation, role) pair(s) are UNKNOWN_BLOCKING and are deliberately absent below:`);
    for (const b of [...new Set(blocking.map((r) => `${r.relation} / ${r.role} (${r.objectClass})`))]) L.push(`--   · ${b}`);
    L.push("-- Generating a REVOKE for an unmeasured privilege would make the rollback unable to restore it.");
    L.push("");
  }
  for (const r of rows) {
    if (!r.actionRequired || !r.actionRequired.length) continue;
    const revokes = r.actionRequired.filter((a) => a.startsWith("REVOKE")).map((a) => a.slice(7));
    const grants = r.actionRequired.filter((a) => a.startsWith("GRANT")).map((a) => a.slice(6));
    if (revokes.length) L.push(`REVOKE ${revokes.join(", ")} ON ${rel(r.relation)} FROM ${q(r.role)};   -- ${r.diffClass}`);
    if (grants.length) L.push(`GRANT ${grants.join(", ")} ON ${rel(r.relation)} TO ${q(r.role)};   -- ${r.diffClass}`);
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

/**
 * Rollback, built from the MEASURED prior state rather than by inverting the forward statements.
 *
 * KPLUS-F042 established this for the orphan proposal and it holds here: a rollback derived from the
 * forward list restores what the change TOOK, which is only the same thing as the prior state when the
 * measurement was complete. Refusing to emit a rollback for an unmeasured pair is the honest behaviour.
 */
export function renderRollbackSql(rows, { intent = "DESIGN_ARTEFACT", lane = "PRODMIG-Q19" } = {}) {
  const L = [];
  L.push(intent === "PRODUCTION_APPLY"
    ? `-- AUTHORIZED FOR PRODUCTION APPLY — ${lane} rollback to the MEASURED prior state.`
    : "-- NOT FOR PRODUCTION APPLY — generated design artefact.");
  L.push("-- GENERATED FILE — do not edit by hand. Source: scripts/db/privilege_model.mjs");
  L.push("-- Rollback to the MEASURED prior effective state — not the inverse of the forward statements.");
  L.push("");
  for (const r of rows) {
    if (!r.current || !r.actionRequired || !r.actionRequired.length) continue;
    L.push(`REVOKE ALL ON ${rel(r.relation)} FROM ${q(r.role)};`);
    if (r.current.length) L.push(`GRANT ${r.current.join(", ")} ON ${rel(r.relation)} TO ${q(r.role)};   -- as measured ${PRODUCTION_EVIDENCE.measuredAt}`);
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

/**
 * Verification queries — effective privilege, never ACL text.
 *
 * SCHEMAS ARE A PARAMETER, and were not. This was pinned to `public`, which was right while `public` was
 * the only schema holding anything — and silently wrong the moment the target schemas held 26 relations.
 * A verification query that cannot see the objects a privilege stage is ABOUT reports a clean matrix for
 * the wrong surface, which is worse than reporting nothing. `public` stays the default so the surface
 * inventory's GRANTS class is unchanged.
 *
 * The relation name is emitted schema-qualified so a caller can feed it straight back into `reconcile()`,
 * where `rel()` re-qualifies it. Bare `relname` collides the moment two schemas hold the same table name.
 */
export const PRIVILEGE_VERBS = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]);

export const verificationSql = (schemas = ["public"]) => `SELECT n.nspname || '.' || c.relname AS relation, c.relkind, r.rolname,
       ${PRIVILEGE_VERBS
    .map((p) => `has_table_privilege(r.rolname, c.oid, '${p}') AS ${p.toLowerCase()}`).join(",\n       ")}
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN (${MANAGED_ROLES.map((r) => `'${r}'`).join(", ")})) r
 WHERE n.nspname IN (${schemas.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(", ")}) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
 ORDER BY 1, r.rolname`;

/** The effective-privilege manifest, with a digest so drift is a diff rather than a discussion. */
export function renderManifest(rows) {
  const body = {
    generated: "deterministic — no timestamp, so the digest changes only when the model does",
    policy: TARGET_POLICY,
    creatorRoles: CREATOR_ROLES,
    evidence: PRODUCTION_EVIDENCE,
    exceptions: LEGACY_COMPATIBILITY_EXCEPTIONS,
    rows: rows.map((r) => ({ relation: r.relation, role: r.role, objectClass: r.objectClass,
      current: r.current, target: r.target, diffClass: r.diffClass, actionRequired: r.actionRequired })),
  };
  const text = JSON.stringify(body, null, 2) + "\n";
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5b. DETECTORS — the specific mistakes this model exists to catch
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * RLS used as a substitute for GRANT discipline.
 *
 * The seductive argument is "the grant is inert, RLS denies everyone anyway". KPLUS-F036 is that argument
 * sitting in production: six tables with full CRUD to anon, held off only by RLS enabled with zero
 * policies. One added policy, or one DISABLE ROW LEVEL SECURITY, and the grant is live — on tables holding
 * participants, payments and payouts.
 *
 * So a relation whose privileges exceed target is a finding REGARDLESS of its RLS state, and a caller who
 * passes RLS state gets told explicitly that it is not a defence.
 */
export function detectRlsSubstitution(rows, rlsState = {}) {
  const out = [];
  for (const r of rows) {
    if (!r.current || !r.target) continue;
    const excess = r.current.filter((p) => !r.target.includes(p));
    if (!excess.length) continue;
    const rls = rlsState[r.relation];
    out.push({
      relation: r.relation, role: r.role, excess,
      rlsEnabled: rls?.enabled ?? null, policyCount: rls?.policies ?? null,
      verdict: "EXCESS_GRANT",
      why: rls?.enabled && rls?.policies === 0
        ? `${r.role} holds ${excess.join(",")} beyond target on ${r.relation}. RLS is enabled with ZERO policies, which is why nobody has noticed — but that is a filter, not a denial, and one added policy or one DISABLE ROW LEVEL SECURITY makes the grant live. The grant is the layer a stale browser tab cannot argue with.`
        : `${r.role} holds ${excess.join(",")} beyond target on ${r.relation}`,
    });
  }
  return out;
}

/**
 * Does the generated default-privilege SQL actually cover a given creator role?
 *
 * The mutant this catches: altering defaults FOR ROLE postgres when the existing defaults belong to
 * supabase_admin. The result changes nothing in production and passes every local test whose fixtures are
 * created by postgres.
 */
export function defaultPrivilegeCoversCreator(sql, role) {
  const forRole = new RegExp(`ALTER DEFAULT PRIVILEGES FOR ROLE "${role}" IN SCHEMA public REVOKE ALL ON (TABLES|SEQUENCES|FUNCTIONS)`, "g");
  const found = new Set([...String(sql).matchAll(forRole)].map((m) => m[1]));
  return { covered: found.size === 3, objectTypes: [...found].sort() };
}

/**
 * Every statement that changes a privilege must have a rollback derived from a MEASURED prior state.
 *
 * A forward statement with no measurement behind it is a one-way door: applying it is easy and undoing it
 * requires knowing what was there, which nobody recorded. KPLUS-F042 established this shape for the orphan
 * proposal; here it is the general rule.
 */
export function rollbackCoverage(rows) {
  const changing = rows.filter((r) => r.actionRequired && r.actionRequired.length);
  const uncovered = changing.filter((r) => r.current === null);
  return { changing: changing.length, uncovered: uncovered.length, complete: uncovered.length === 0,
    uncoveredPairs: uncovered.map((r) => `${r.relation}/${r.role}`) };
}

/**
 * An explicit GRANT that masks an intended default REVOKE.
 *
 * Altering the default stops FUTURE objects inheriting. It does nothing to an object that already carries
 * an explicit grant, and nothing to a migration that issues one afterwards. So a forward plan that revokes
 * a default while some SQL still grants the same privilege explicitly has changed the mechanism and not
 * the outcome.
 */
/**
 * WRITE PRIVILEGE ON A VIEW — the one that arrives by inheritance and is invisible until someone tries it.
 *
 * PRODMIG-Q32-A1 was exactly this, live in production: `bolao_state_public` and `bolao_state_public_cdb`
 * held ALL for `anon` and `authenticated`. No migration granted it. It was inherited from `public`'s
 * default privileges, which hand `arwdDxtm` to those roles on every new relation, and the canonical
 * `grant select` that created the views was additive and never corrected what the object already had.
 *
 * The consequence is specific and worse than it looks. A non-`security_invoker` view executes with the
 * VIEW OWNER's authority. The owner here is `postgres`, which holds BYPASSRLS. So a write through the
 * view bypasses row-level security on the base table completely — measured: a fresh RLS policy set that
 * correctly reduced `anon`'s direct UPDATE to 0 rows still allowed `anon` to UPDATE and DELETE all three
 * documents through the view.
 *
 * This detector exists because the ROOT mechanism cannot be closed from inside this programme:
 * `public`'s default privileges are provider/platform territory shared with another workstream. What can
 * be guaranteed is that the next view to inherit it is NOISY rather than silent.
 *
 * `securityInvoker` is accepted as a mitigation because such a view runs with the CALLER's rights, so
 * the base table's RLS applies normally and the bypass does not exist.
 */
export function detectViewWriteBypass(rows, viewState = {}) {
  const WRITE = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];
  const out = [];
  for (const r of rows) {
    if (r.objectClass !== "VIEW" && r.objectClass !== "MATERIALIZED_VIEW") continue;
    if (!BROWSER_ROLES.includes(r.role)) continue;
    const held = (r.current || []).filter((p) => WRITE.includes(p));
    if (!held.length) continue;
    const v = viewState[r.relation] || {};
    out.push({
      relation: r.relation, role: r.role, privileges: held,
      securityInvoker: v.securityInvoker === true,
      owner: v.owner ?? "(unknown)",
      severity: v.securityInvoker === true ? "REVIEW" : "RLS_BYPASS",
      why: v.securityInvoker === true
        ? "the view is security_invoker, so the caller's rights apply and RLS on the base table is still enforced. Still a write privilege a browser role was never granted deliberately."
        : "the view is NOT security_invoker, so it executes with the owner's authority. If that owner holds BYPASSRLS, this write bypasses row-level security on every table the view selects from.",
    });
  }
  return out;
}

export function detectExplicitGrantMasking(forwardSql, defaultSql) {
  const granted = [...String(forwardSql).matchAll(/^GRANT ([A-Z, ]+) ON ([^ ]+) TO "([^"]+)";/gm)]
    .map((m) => ({ privs: m[1].split(",").map((x) => x.trim()), relation: m[2], role: m[3] }));
  const defaultRevokesAll = /REVOKE ALL ON TABLES FROM [^;]*"anon"/.test(String(defaultSql));
  const out = [];
  for (const g of granted) {
    if (!MANAGED_ROLES.includes(g.role)) continue;
    const policy = TARGET_POLICY.TABLE;
    const allowed = policy[g.role] ?? [];
    const beyond = g.privs.filter((p) => !allowed.includes(p));
    if (beyond.length && defaultRevokesAll) {
      out.push({ relation: g.relation, role: g.role, privileges: beyond,
        why: "the default-privilege plan revokes this class while an explicit GRANT re-adds it — the mechanism changed and the outcome did not" });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6. F10 RETIREMENT GATE
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * When `bolao_state_public` may be dropped.
 *
 * Every condition is a CHECK, not a belief, and the gate is conjunctive: all must hold. The instruction
 * this encodes is that "the normalized tables exist" is not one of them — a replacement existing says
 * nothing about whether anyone has moved to it.
 */
export const F10_RETIREMENT_GATE = Object.freeze([
  Object.freeze({ id: "RG-1", condition: "all browser reads migrated to the target read path",
    evidence: "each of the three apps' source shows no read of bolao_state_public / _cdb", verifiable: "LOCALLY — grep the deployed app sources on main", status: "NOT_MET" }),
  Object.freeze({ id: "RG-2", condition: "no compatibility reader remains",
    evidence: "no view, function or job in any schema selects from it — pg_depend closure is empty apart from the view itself",
    verifiable: "PRODUCTION READ (catalog)", status: "UNKNOWN" }),
  Object.freeze({ id: "RG-3", condition: "no report depends on it",
    evidence: "the 17 reports in REPORTING_MODEL.md name their sources; none names this view", verifiable: "LOCALLY", status: "NOT_MET" }),
  Object.freeze({ id: "RG-4", condition: "no cron/scheduled job depends on it",
    evidence: "cron.job holds no statement referencing it", verifiable: "PRODUCTION READ (catalog)", status: "UNKNOWN" }),
  Object.freeze({ id: "RG-5", condition: "no external consumer depends on it",
    evidence: "the view is reachable through PostgREST with the public anon key, so ANY third party may be reading it and the catalog cannot say. This condition cannot be discharged by a query.",
    verifiable: "NEITHER — needs an announced deprecation window", status: "NOT_MET" }),
  Object.freeze({ id: "RG-6", condition: "the cutover rollback window has expired",
    evidence: "cutover step 21 is the first irreversible step; the view is a rollback path until then", verifiable: "PROCESS", status: "NOT_MET" }),
  Object.freeze({ id: "RG-7", condition: "an evidence window shows ZERO reads",
    evidence: "per-relation read counts over a defined window",
    verifiable: "NOT AVAILABLE — pg_stat_user_tables does not accumulate for views, and OBSERVABILITY_CUTOVER_BASELINE.md records that request volume has no catalog-backed source. Discharging this needs the instrumentation designed there.",
    status: "UNMEASURABLE_TODAY" }),
  Object.freeze({ id: "RG-8", condition: "F10's own remaining stages have landed",
    evidence: "Stage 6 revokes anon's access to the raw bolao_state; until it runs, the view is not yet the ONLY read path and retiring it early would be retiring the wrong one",
    verifiable: "ANOTHER PROGRAMME'S STATE — ADR-K10", status: "NOT_MET" }),
]);

export const f10GateMet = () => F10_RETIREMENT_GATE.every((g) => g.status === "MET");
export const f10GateBlockers = () => F10_RETIREMENT_GATE.filter((g) => g.status !== "MET");

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("privilege_model.mjs")) {
  const { writeFileSync, mkdirSync, readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { MEASURED_RELATIONS, measuredPrivileges, UNMEASURED_IN_PRODUCTION } = await import("./privilege_evidence.mjs");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const DIR = join(ROOT, "docs", "bolao", "db-modernization", "rls-drafts");
  const rows = [...reconcile(MEASURED_RELATIONS, measuredPrivileges()),
    ...unmeasuredDimensionRows(MEASURED_RELATIONS, UNMEASURED_IN_PRODUCTION)];
  const files = [
    [join(DIR, "PRIVILEGE_DEFAULTS.draft.sql"), renderDefaultPrivilegeSql()],
    [join(DIR, "PRIVILEGE_FORWARD.draft.sql"), renderForwardSql(rows)],
    [join(DIR, "PRIVILEGE_ROLLBACK.draft.sql"), renderRollbackSql(rows)],
    [join(ROOT, "model", "privilege_manifest.json"), renderManifest(rows).text],
  ];
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    mkdirSync(DIR, { recursive: true });
    for (const [p, t] of files) { writeFileSync(p, t); console.log(`  wrote ${p.replace(ROOT + "/", "")}`); }
    console.log(`  manifest sha256 ${renderManifest(rows).sha256.slice(0, 16)}…`);
    process.exit(0);
  }
  if (argv.includes("--check")) {
    const stale = files.filter(([p, want]) => { let cur = ""; try { cur = readFileSync(p, "utf8"); } catch { /* absent counts as stale */ } return cur !== want; });
    if (stale.length) { for (const [p] of stale) console.log(`  ✗ stale: ${p.replace(ROOT + "/", "")}`); process.exit(1); }
    console.log("  ✓ fresh: privilege defaults, forward, rollback, manifest");
    process.exit(0);
  }
  console.log(`reconciliation rows: ${rows.length} · UNKNOWN_BLOCKING: ${blockingRows(rows).length}`);
  console.log(`F10 retirement gate: ${f10GateBlockers().length} blocker(s) of ${F10_RETIREMENT_GATE.length}`);
}
