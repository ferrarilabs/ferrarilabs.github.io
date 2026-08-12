#!/usr/bin/env node
/**
 * DATABASE SURFACE INVENTORY — the one place that knows what a database is made of.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE LESSON THIS GENERALIZES
 *
 * Four findings, four object classes, one mistake:
 *
 *   KPLUS-F039  ROLES          `service_role.rolbypassrls` differed from the restore. Roles are
 *                              cluster-global and a database dump does not carry them.
 *   KPLUS-F012  EVENT TRIGGERS `pg_dump --schema=public` carries none. The restore lost the RLS guard
 *                              and every rehearsal was green.
 *   KPLUS-F055  TABLES         the model held seven because the restored baseline held seven.
 *                              Production held ten.
 *   KPLUS-F058  VIEWS          every probe filtered `relkind = 'r'`. Two views carried anon write
 *                              grants that made the cutover fence bypassable.
 *
 * Each was found by asking the catalog a question nobody had asked. Each could have been found earlier by
 * noticing that no question had been asked at all. That is what this file makes impossible: a class with
 * no query is a FAILING COMPLETENESS CHECK, not an absence of findings.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE
 *
 * "We looked and found nothing" and "we never looked" are different states and must never render the
 * same. Every class below carries `coveredBy`, and `completenessFailures()` reports any class whose
 * coverage is missing — INCLUDING classes that are expected to be empty. An empty result is evidence; an
 * absent query is not.
 */

/** Where a class lives, because it decides whether a database-scoped dump can carry it. */
export const SCOPE = Object.freeze({
  CLUSTER: "CLUSTER",     // not carried by a database-level dump — the F039 shape
  DATABASE: "DATABASE",   // carried, but not by a schema-filtered dump — the F012 shape
  SCHEMA: "SCHEMA",       // carried by a schema-filtered dump
});

/**
 * Every object class the inventory must cover.
 *
 * `carriedByPublicSchemaDump` is the field that would have prevented KPLUS-F012 on its own: it is false
 * for event triggers, and a false there means the backup needs a companion or the restore is unfaithful.
 */
export const SURFACE_CLASSES = Object.freeze([
  Object.freeze({ id: "SCHEMAS", scope: SCOPE.DATABASE, carriedByPublicSchemaDump: false,
    sql: "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\\\_%' AND nspname <> 'information_schema' ORDER BY 1",
    why: "a schema nobody modelled can hold anything; `public` was never the whole database" }),
  Object.freeze({ id: "TABLES", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg\\\\_%' ORDER BY 1,2",
    finding: "KPLUS-F055", why: "the model held seven because the RESTORE held seven" }),
  Object.freeze({ id: "PARTITIONED_TABLES", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='p' AND n.nspname NOT LIKE 'pg\\\\_%' ORDER BY 1,2",
    why: "relkind 'p', which a relkind='r' filter misses exactly as it missed views" }),
  Object.freeze({ id: "VIEWS", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='v' AND n.nspname NOT LIKE 'pg\\\\_%' ORDER BY 1,2",
    finding: "KPLUS-F058", why: "a write grant on a view is a write grant on everything it selects from, with the owner's authority" }),
  Object.freeze({ id: "MATERIALIZED_VIEWS", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='m' AND n.nspname NOT LIKE 'pg\\\\_%' ORDER BY 1,2",
    why: "not covered by ALTER DEFAULT PRIVILEGES, so its privileges follow different rules" }),
  Object.freeze({ id: "FOREIGN_TABLES", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='f' AND n.nspname NOT LIKE 'pg\\\\_%' ORDER BY 1,2",
    why: "reaches outside this database entirely" }),
  Object.freeze({ id: "SEQUENCES", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg\\\\_%' ORDER BY 1,2",
    why: "USAGE on a sequence is a write capability that never appears in any table's ACL" }),
  Object.freeze({ id: "FUNCTIONS", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT n.nspname, p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\\\\_%' AND n.nspname <> 'information_schema' ORDER BY 1,2",
    why: "PostgreSQL grants EXECUTE to PUBLIC by default; on a SECURITY DEFINER function that is the owner's authority" }),
  Object.freeze({ id: "TRIGGERS", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal ORDER BY 1,2",
    why: "row triggers enforce invariants the application assumes" }),
  Object.freeze({ id: "EVENT_TRIGGERS", scope: SCOPE.DATABASE, carriedByPublicSchemaDump: false,
    sql: "SELECT e.evtname, e.evtevent, e.evtenabled FROM pg_event_trigger e ORDER BY 1",
    finding: "KPLUS-F012", why: "database-scoped, so --schema=public carries NONE of them. The restore lost the RLS auto-enable guard and nothing noticed" }),
  Object.freeze({ id: "POLICIES", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "SELECT n.nspname, c.relname, p.polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace ORDER BY 1,2,3",
    why: "a policy is what makes a grant reachable; counting grants without policies describes half the access model" }),
  Object.freeze({ id: "EXTENSIONS", scope: SCOPE.DATABASE, carriedByPublicSchemaDump: false,
    sql: "SELECT extname, extversion FROM pg_extension ORDER BY 1",
    why: "an extension can install functions, types and event triggers the schema dump attributes to nobody" }),
  Object.freeze({ id: "ROLES", scope: SCOPE.CLUSTER, carriedByPublicSchemaDump: false,
    sql: "SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname NOT LIKE 'pg\\\\_%' ORDER BY 1",
    finding: "KPLUS-F039", why: "cluster-global and NOT carried by a database dump — the local value is evidence about the restore, never about production" }),
  Object.freeze({ id: "GRANTS", scope: SCOPE.SCHEMA, carriedByPublicSchemaDump: true,
    sql: "effective privilege via has_table_privilege — see privilege_model.verificationSql()",
    why: "ACL text does not account for role membership; effective privilege does" }),
  Object.freeze({ id: "DEFAULT_PRIVILEGES", scope: SCOPE.DATABASE, carriedByPublicSchemaDump: false,
    sql: "SELECT d.defaclrole::regrole, n.nspname, d.defaclobjtype, d.defaclacl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 1,2",
    why: "the mechanism behind KPLUS-F055's and KPLUS-F058's exposures, and PER CREATOR ROLE. NEVER READ IN PRODUCTION." }),
  Object.freeze({ id: "PUBLICATIONS", scope: SCOPE.DATABASE, carriedByPublicSchemaDump: false,
    sql: "SELECT pubname, puballtables FROM pg_publication ORDER BY 1",
    why: "a publication streams rows off this database; expected empty, and empty must be MEASURED" }),
  Object.freeze({ id: "SUBSCRIPTIONS", scope: SCOPE.DATABASE, carriedByPublicSchemaDump: false,
    sql: "SELECT subname, subenabled FROM pg_subscription ORDER BY 1",
    why: "writes arriving from elsewhere would break every assumption about who writes the legacy document" }),
  Object.freeze({ id: "FOREIGN_DATA_WRAPPERS", scope: SCOPE.DATABASE, carriedByPublicSchemaDump: false,
    sql: "SELECT srvname, fdwname FROM pg_foreign_server s JOIN pg_foreign_data_wrapper w ON w.oid=s.srvfdw ORDER BY 1",
    why: "an FDW is an outbound path the restore rehearsal's containment check already looks for" }),
  Object.freeze({ id: "MIGRATION_LEDGER", scope: SCOPE.DATABASE, carriedByPublicSchemaDump: false,
    sql: "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
    why: "which migrations the database believes it has applied. ADR-K10: a second channel exists whose changes never appear here" }),
]);

export const CLASS_IDS = Object.freeze(SURFACE_CLASSES.map((c) => c.id));

/** Classes a `pg_dump --schema=public` cannot carry. Each needs a backup companion or the restore lies. */
export const notCarriedByPublicSchemaDump = () => SURFACE_CLASSES.filter((c) => !c.carriedByPublicSchemaDump);

/**
 * THE COMPLETENESS CHECK.
 *
 * `covered` is the set of class ids an inventory run actually queried. Anything missing is a failure, and
 * the message says which finding that blind spot produced last time — because "you have not looked at
 * VIEWS" lands differently when it comes with "that is how the cutover fence became bypassable".
 */
export function completenessFailures(covered) {
  const seen = new Set(covered ?? []);
  const out = [];
  for (const c of SURFACE_CLASSES) {
    if (!seen.has(c.id)) {
      out.push(`${c.id} was never queried — ${c.why}${c.finding ? ` This blind spot produced ${c.finding}.` : ""}`);
    }
  }
  for (const id of seen) {
    if (!CLASS_IDS.includes(id)) out.push(`${id} was queried but is not a declared surface class — the inventory and the model disagree about what a database is made of`);
  }
  return out;
}

/**
 * Interpret an inventory result. An EMPTY class is `MEASURED_EMPTY`; an unqueried one is `NOT_MEASURED`.
 * Rendering those the same is the whole failure mode.
 */
export function summarize(results) {
  return SURFACE_CLASSES.map((c) => {
    const r = results?.[c.id];
    return {
      id: c.id, scope: c.scope, carriedByPublicSchemaDump: c.carriedByPublicSchemaDump,
      status: r === undefined ? "NOT_MEASURED" : (Array.isArray(r) && r.length === 0 ? "MEASURED_EMPTY" : "MEASURED"),
      count: Array.isArray(r) ? r.length : null,
      finding: c.finding ?? null,
    };
  });
}

export const notMeasured = (results) => summarize(results).filter((s) => s.status === "NOT_MEASURED");
