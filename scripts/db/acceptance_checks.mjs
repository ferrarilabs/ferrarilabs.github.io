/**
 * A1–A11 acceptance criteria for the first restore rehearsal, as data.
 *
 * WHY THESE LIVE IN A MODULE
 * `BACKUP_RESTORE_OPERATIONAL_DESIGN.md` §11.4 defines eleven criteria in prose. Prose cannot be
 * executed and cannot be regression-tested. Keeping them here as one exported table means the
 * rehearsal runner, the dry-run validator and the test suite all read the SAME definition — the same
 * single-source-of-truth argument that `draw_provenance_patterns.mjs` settled for the draw invariant.
 *
 * EXPECTED VALUES ARE NOT INVENTED. Every number traces to collected evidence:
 *   · object/constraint/index/policy counts → Phase 1 S03–S13 and the pg_dump TOC (73 entries)
 *   · row counts → captured INSIDE one READ ONLY SERIALIZABLE transaction at dump time and recorded
 *     in the backup MANIFEST.txt. They are read from the manifest at run time, never hard-coded here,
 *     so a future backup cannot silently be checked against a stale expectation.
 *   · policy expression md5s → recorded by DR-1. A8 compares hashes, which proves byte-exact
 *     restoration WITHOUT ever printing a policy expression.
 *
 * SCOPE: schema `public` only. Provider schemas are excluded from the backup by design, so asserting
 * anything about them here would fail for the wrong reason.
 *
 * NO PARTICIPANT DATA. Every query below counts, hashes or inspects catalog metadata. None selects a
 * business column value. `SELECT count(*)` is aggregate and is the only contact with table contents.
 */

/** The seven application tables, in a stable order. */
export const APP_TABLES = [
  "bolao_state",
  "lottery_admin_audit",
  "lottery_draws",
  "lottery_participants",
  "lottery_participations",
  "lottery_payment_transactions",
  "lottery_pools",
];

/**
 * Structural expectations from Phase 1 evidence. A restored copy that disagrees with any of these
 * either restored incompletely or restored something other than what was captured.
 */
export const EXPECTED_STRUCTURE = {
  tables: 7,
  enumTypes: 3,
  functions: 1,          // public.rls_auto_enable()
  policies: 6,           // all on bolao_state
  primaryKeys: 7,
  foreignKeys: 17,
  uniqueConstraints: 0,  // the unique thing is an INDEX, not a constraint — see A5
  uniqueIndexesNotConstraints: 1,
  totalIndexes: 8,       // 7 PK + 1 unique
  userTriggers: 0,       // the 3 declared audit triggers were never applied (R-04)
  rlsEnabled: 7,
  rlsForced: 0,
  views: 0,
  sequences: 2,
};

/**
 * Policy predicate md5s recorded by DR-1. Two distinct predicates across six policies (DR1-F1).
 * A8 compares against these. Presence here is a hash, not an expression — nothing to disclose.
 */
export const EXPECTED_POLICY_MD5 = {
  // 65-char predicate, shared by the first policy generation
  generationA: "b3fa0ec7dede73884f2d17fad17b2cf9",
  // 19-char predicate, shared by the `… bolao state`-suffixed generation
  generationB: "57801f75ec4cb6d17b161c9de81d6ef2",
  emptyString: "d41d8cd98f00b204e9800998ecf8427e", // md5(''), for absent USING / WITH CHECK
};

/**
 * Each check: id, what it proves, and the SQL that proves it. Every query is READ-ONLY.
 * `expect` is evaluated by the runner against the query's single-row result.
 */
export const ACCEPTANCE_CHECKS = [
  {
    id: "A1",
    title: "application object counts match the captured baseline",
    why: "an incomplete restore is most visible as a missing object",
    sql: `
      SELECT
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r')                                  AS tables,
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
           WHERE n.nspname='public' AND t.typtype='e')                                  AS enum_types,
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public')                                                    AS functions,
        (SELECT count(*) FROM pg_policies WHERE schemaname='public')                     AS policies,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='v')                                  AS views,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='S')                                  AS sequences`,
    expect: (r, exp) =>
      cmp([["tables", r.tables, exp.tables], ["enum_types", r.enum_types, exp.enumTypes],
           ["functions", r.functions, exp.functions], ["policies", r.policies, exp.policies],
           ["views", r.views, exp.views], ["sequences", r.sequences, exp.sequences]]),
  },
  {
    id: "A2",
    title: "row counts exactly match the backup manifest",
    why: "the manifest counts were captured inside the dump transaction, so equality is provable",
    // Built at run time from APP_TABLES so a table added later cannot be silently omitted.
    sql: `SELECT ${APP_TABLES.map((t) => `(SELECT count(*) FROM public.${t}) AS ${t}`).join(",\n             ")}`,
    expect: (r, _exp, manifestRowCounts) =>
      cmp(APP_TABLES.map((t) => [t, Number(r[t]), manifestRowCounts[t]])),
  },
  {
    id: "A3",
    title: "PK/FK/UNIQUE/CHECK present and VALIDATED",
    why: "a constraint restored NOT VALID enforces nothing on existing rows",
    sql: `
      SELECT
        count(*) FILTER (WHERE contype='p')                       AS pks,
        count(*) FILTER (WHERE contype='f')                       AS fks,
        count(*) FILTER (WHERE contype='u')                       AS uniques,
        count(*) FILTER (WHERE NOT convalidated)                  AS not_valid
      FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'`,
    expect: (r, exp) =>
      cmp([["primary keys", r.pks, exp.primaryKeys], ["foreign keys", r.fks, exp.foreignKeys],
           ["unique constraints", r.uniques, exp.uniqueConstraints], ["NOT VALID constraints", r.not_valid, 0]]),
  },
  {
    id: "A4",
    title: "referential integrity — zero orphans across all 17 FK paths",
    why: "counts can match while relationships are broken; this is the check that proves they are not",
    // Generated: for every FK, an anti-join counting children whose parent is missing.
    dynamic: "orphans",
    expect: (r) => (Number(r.orphans) === 0 ? null : [`orphan rows found across FK paths: ${r.orphans}`]),
  },
  {
    id: "A5",
    title: "indexes restored; the unique index is present and ENFORCING",
    why: "external_reference uniqueness is the constraint that makes double-recording a payment impossible",
    sql: `
      SELECT
        (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')          AS total,
        (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND i.indisunique AND NOT i.indisprimary
             AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid=i.indexrelid)) AS unique_idx,
        (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND NOT i.indisvalid)                                  AS invalid`,
    expect: (r, exp) =>
      cmp([["total indexes", r.total, exp.totalIndexes],
           ["standalone unique indexes", r.unique_idx, exp.uniqueIndexesNotConstraints],
           ["invalid indexes", r.invalid, 0]]),
  },
  {
    id: "A6",
    title: "sequences restored and correctly owned",
    why: "an identity sequence detached from its column silently breaks inserts",
    sql: `
      SELECT count(*) AS seqs,
             count(*) FILTER (WHERE owner_attr IS NULL) AS unowned
      FROM (
        SELECT c.oid,
               (SELECT d.refobjsubid FROM pg_depend d
                  WHERE d.objid=c.oid AND d.classid='pg_class'::regclass
                    AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
                    AND d.refobjsubid>0 LIMIT 1) AS owner_attr
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='S') s`,
    expect: (r, exp) => cmp([["sequences", r.seqs, exp.sequences], ["unowned sequences", r.unowned, 0]]),
  },
  {
    id: "A7",
    title: "RLS state preserved — enabled on all 7, forced on none",
    why: "a plain restore does carry ENABLE ROW LEVEL SECURITY, but that must be confirmed not assumed",
    sql: `
      SELECT count(*) FILTER (WHERE relrowsecurity)      AS enabled,
             count(*) FILTER (WHERE relforcerowsecurity) AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'`,
    expect: (r, exp) => cmp([["RLS enabled", r.enabled, exp.rlsEnabled], ["RLS forced", r.forced, exp.rlsForced]]),
  },
  {
    id: "A8",
    title: "policies restored byte-exact — verified by md5, never by printing",
    why: "DR-1 recorded every predicate hash, so faithful restoration is provable without disclosure",
    sql: `
      SELECT count(*) AS policies,
             count(*) FILTER (WHERE md5(coalesce(qual,'')) IN ($A, $B, $E)
                                AND md5(coalesce(with_check,'')) IN ($A, $B, $E)) AS hash_matched
      FROM pg_policies WHERE schemaname='public'`,
    binds: { A: EXPECTED_POLICY_MD5.generationA, B: EXPECTED_POLICY_MD5.generationB, E: EXPECTED_POLICY_MD5.emptyString },
    expect: (r, exp) =>
      cmp([["policies", r.policies, exp.policies], ["policies with a recognised predicate hash", r.hash_matched, exp.policies]]),
  },
  {
    id: "A9",
    title: "no production reference anywhere in the restored database",
    why: "a rehearsal that quietly points at production is the worst possible outcome",
    sql: `
      SELECT
        (SELECT count(*) FROM pg_foreign_server)                                        AS foreign_servers,
        (SELECT count(*) FROM pg_user_mapping)                                          AS user_mappings,
        (SELECT count(*) FROM pg_subscription)                                          AS subscriptions,
        (SELECT count(*) FROM pg_replication_slots)                                     AS repl_slots,
        (SELECT count(*) FROM pg_db_role_setting)                                       AS role_settings`,
    expect: (r) =>
      cmp([["foreign servers", r.foreign_servers, 0], ["user mappings", r.user_mappings, 0],
           ["subscriptions", r.subscriptions, 0], ["replication slots", r.repl_slots, 0]]),
  },
  {
    id: "A10",
    title: "grant set matches the captured baseline, modulo --no-owner",
    why: "the wide anon grants are part of what must be restorable and reasoned about",
    sql: `
      SELECT count(*) AS grants,
             count(*) FILTER (WHERE grantee='anon' AND privilege_type='TRUNCATE') AS anon_truncate
      FROM (
        SELECT CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
               acl.privilege_type
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
        WHERE n.nspname='public' AND c.relkind='r') g`,
    // anon TRUNCATE must be 0: the 2026-08-07 remediation is part of the captured state.
    expect: (r) => cmp([["anon TRUNCATE grants", r.anon_truncate, 0]]),
  },
  {
    id: "A11",
    title: "synthetic identity isolation — no real auth identity was restored",
    why: "the ratified first-rehearsal rule: prove recoverability without propagating production identities",
    sql: `
      SELECT
        (SELECT count(*) FROM auth.users)                                             AS users,
        (SELECT count(*) FROM auth.users WHERE email IS NOT NULL AND email <> '')      AS with_email,
        (SELECT count(*) FROM auth.users
           WHERE coalesce(raw_user_meta_data::text,'') NOT IN ('', '{}', 'null'))      AS with_metadata`,
    expect: (r) =>
      cmp([["auth.users rows carrying an email", r.with_email, 0],
           ["auth.users rows carrying metadata", r.with_metadata, 0]]),
  },
];

/** @returns {string[]|null} list of mismatch descriptions, or null when everything matches */
function cmp(triples) {
  const bad = triples.filter(([, actual, expected]) => Number(actual) !== Number(expected));
  return bad.length === 0 ? null
    : bad.map(([label, actual, expected]) => `${label}: expected ${expected}, got ${actual}`);
}

/** SQL that counts orphan children across every FK in `public`. Generated, so it cannot go stale. */
export const ORPHAN_COUNT_SQL = `
WITH fk AS (
  SELECT con.conname,
         cl.relname  AS child,
         (SELECT string_agg(quote_ident(a.attname), ',' ORDER BY k.ord)
            FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS child_cols,
         pn.nspname  AS parent_schema,
         pl.relname  AS parent,
         (SELECT string_agg(quote_ident(a.attname), ',' ORDER BY k.ord)
            FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS parent_cols
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_class pl ON pl.oid = con.confrelid
  JOIN pg_namespace pn ON pn.oid = pl.relnamespace
  WHERE con.contype = 'f' AND n.nspname = 'public'
)
SELECT coalesce(sum(cnt), 0) AS orphans FROM (
  SELECT (xpath('/row/c/text()',
           query_to_xml(format(
             'SELECT count(*) AS c FROM public.%I ch WHERE (%s) IS NOT NULL AND NOT EXISTS ' ||
             '(SELECT 1 FROM %I.%I pa WHERE (%s) = (%s))',
             child, prefix('ch', child_cols), parent_schema, parent,
             prefix('pa', parent_cols), prefix('ch', child_cols)),
           false, true, '')))[1]::text::bigint AS cnt
  FROM fk
) t`;

/** Helper documented for the SQL above: prefixes a comma-separated column list with an alias. */
export const PREFIX_FN_SQL = `
CREATE OR REPLACE FUNCTION pg_temp.prefix(alias text, cols text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(alias || '.' || c, ',') FROM unnest(string_to_array(cols, ',')) AS c
$$;`;
