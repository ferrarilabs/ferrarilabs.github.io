#!/usr/bin/env node
/**
 * Emit the read-surface completion migration from the two specs, rather than hand-writing 300 lines
 * of jsonb assembly into a file nobody regenerates.
 *
 * The document shape now has two declarations — `read_surface.mjs` (frozen, M16's) and
 * `read_surface_complete.mjs` (this cutover's) — and the ONE thing that must not happen is a third
 * one living in the migration file. So the migration is generated from both and this script is how.
 *
 * usage: node scripts/db/emit_read_surface_migration.mjs > supabase/migrations/<version>_<name>.sql
 */
import { READ_SURFACE } from "./read_surface.mjs";
import { READ_SURFACE_COMPLETE, POOL_TO_DOC_ID, DOCUMENT_CONTRACT_VERSION, CDB_PHASE_EXTRAS } from "./read_surface_complete.mjs";

/**
 * Every relation the projection reads, and the complete list of what the bounded definer may see.
 * Enumerated rather than derived from a wildcard: a grant list that grows by pattern is a grant list
 * nobody re-reads. `bolao.participants` is absent ON PURPOSE — it holds email and phone, and the
 * public projection takes the entry name from pool_entries.display_label instead, so the PII table is
 * not merely unread but unreachable from this path.
 */
export const PUBLIC_READ_RELATIONS = [
  "pools",
  "pool_entries",
  "pool_entry_tombstone",
  "predictions",
  "classification_predictions",
  "matches",
  "match_results",
  "ties",
  "competition_edition_phases",
  "sync_state",
  "entry_payment_confirmation",
];

/** M16's sections plus this stage's, per product. jsonb normalizes key order, so concatenation is safe. */
export function mergedSections(product) {
  const m16 = READ_SURFACE[product]?.sections ?? {};
  const add = READ_SURFACE_COMPLETE[product]?.sections ?? {};
  const inherit = READ_SURFACE_COMPLETE[product]?.inheritsFromM16 ?? [];
  const kept = Object.fromEntries(Object.entries(m16).filter(([k]) => inherit.includes(k)));
  // M16's `phases` is frozen, so the two fields it cannot carry are merged onto its result rather
  // than edited into its spec: `topology` (class A, gates whether the phase renders at all) and
  // `cutoffAt` at exact precision (M16 spells `.000Z`; the operator writes `Z`, and the app
  // compares the strings). Everything else in `phases` still comes from M16 unchanged.
  if (product === "cdb2026" && kept.phases) {
    kept.phases = kept.phases
      .replace(`'cutoffAt', ${"${isoMs(\"ph.cutoff_at\")}"},`, "")   // no-op guard; replaced below
      .replace(/'cutoffAt', to_char\(ph\.cutoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\),/,
               `'cutoffAt', ${CDB_PHASE_EXTRAS.cutoffAt("ph.cutoff_at")},`)
      .replace(/\|\| CASE WHEN ph\.official_draw IS NOT NULL/,
               `|| ${CDB_PHASE_EXTRAS.topology}\n            || CASE WHEN ph.official_draw IS NOT NULL`);
  }
  const dropped = Object.keys(m16).filter((k) => !inherit.includes(k) && !(k in add));
  if (dropped.length) throw new Error(`${product}: M16 emitted ${dropped.join(", ")} and the complete spec neither inherits nor replaces them — a section cannot silently leave the document`);
  return { ...kept, ...add };
}

export function readSurfaceCompletionDdl() {
  const L = [];
  L.push("-- The assembled document, per product — now COMPLETE for every section the deployed readers");
  L.push("-- consume, except the one that is refused on purpose. STABLE, and read-only by construction:");
  L.push("-- it is a single SELECT and owns no row. Its security context changes below — see THE BOUNDED");
  L.push("-- OWNER, which is where the M16 comment about SECURITY DEFINER is answered rather than ignored.");
  L.push("CREATE OR REPLACE FUNCTION bolao.read_document(p_pool_slug text)");
  L.push("RETURNS jsonb");
  L.push("LANGUAGE sql");
  L.push("STABLE");
  L.push("SET search_path = pg_catalog, public");
  L.push("AS $read_document$");
  L.push("WITH pool AS (");
  L.push("  SELECT pl.pool_id, pl.competition_edition_id FROM bolao.pools pl WHERE pl.slug = p_pool_slug");
  L.push(")");
  L.push("SELECT CASE p_pool_slug");
  for (const [product, spec] of Object.entries(READ_SURFACE_COMPLETE)) {
    const sections = Object.entries(mergedSections(product));
    L.push(`  WHEN '${spec.poolSlug}' THEN jsonb_build_object(`);
    sections.forEach(([key, sql], i) => {
      L.push(`    '${key}',`);
      L.push(`${sql}${i < sections.length - 1 ? "," : ""}`);
    });
    L.push("  )");
    for (const [k, v] of Object.entries(spec.omitted)) L.push(`  -- omitted for ${product}: ${k} — ${v}`);
  }
  L.push("  ELSE NULL");
  L.push("END");
  L.push("FROM pool;");
  L.push("$read_document$;");
  L.push("");
  L.push(`COMMENT ON FUNCTION bolao.read_document(text) IS 'Normalized read surface: the state document assembled from bolao.* for one pool. Complete for every section the deployed readers consume. auditLog and entries[].diagnostics forensics are deliberately excluded — they are private, not missing. Document contract ${DOCUMENT_CONTRACT_VERSION}.';`);
  L.push("");
  L.push("-- KPLUS-F059: every generated function revokes EXECUTE from PUBLIC.");
  L.push("REVOKE ALL ON FUNCTION bolao.read_document(text) FROM PUBLIC;");
  L.push("");
  L.push("-- bolao.v_state_document is UNCHANGED and stays service_role-only. It is the TRUSTED surface:");
  L.push("-- same shape, no sanitisation promise. The browser gets the public view below instead, and the");
  L.push("-- distinction is the point — a single view serving both audiences is one GRANT away from");
  L.push("-- serving the trusted shape to anon.");
  L.push("");
  L.push("-- ─── THE BOUNDED OWNER ────────────────────────────────────────────────────────────────────");
  L.push("--");
  L.push("-- read_document becomes SECURITY DEFINER, and the whole safety of that turns on WHO defines it.");
  L.push("-- M16 refused SECURITY DEFINER, and it was right to: the function was owned by postgres, which");
  L.push("-- carries BYPASSRLS, so defining it would have handed every caller a surface that ignores every");
  L.push("-- policy in the database — KPLUS-F058's shape exactly.");
  L.push("--");
  L.push("-- The objection is to the OWNER, not to the mechanism. A read surface has to cross a privilege");
  L.push("-- boundary somewhere: anon must not hold rights on bolao.* tables, and something still has to");
  L.push("-- read them. The three ways to do that are (1) grant anon the tables — forbidden, and it would");
  L.push("-- reopen Q38; (2) own the function as postgres — BYPASSRLS, refused above; (3) own it as a role");
  L.push("-- that can do NOTHING except read the eleven relations this projection names. Only (3) makes the");
  L.push("-- blast radius equal to the thing being published.");
  L.push("--");
  L.push("-- bolao_public_reader is NOLOGIN (it is never a session, only a definer), NOSUPERUSER,");
  L.push("-- NOBYPASSRLS, NOINHERIT, and owns no table. It gets USAGE on one schema, SELECT on eleven");
  L.push("-- relations, and one read-only policy on each. It cannot write, cannot reach the finance model,");
  L.push("-- cannot reach audit.*, and cannot read bolao.participants — which is the point worth stating");
  L.push("-- plainly: THE PUBLIC READ PATH NO LONGER TOUCHES THE TABLE THAT HOLDS EMAIL AND PHONE AT ALL.");
  L.push("-- The entry name it needs is pool_entries.display_label, so participants is not in the grant");
  L.push("-- list and a projection that tried to select from it would fail rather than leak.");
  L.push("--");
  L.push("-- FORCE ROW LEVEL SECURITY is why each table needs an explicit policy: under FORCE, even a");
  L.push("-- table's owner is subject to RLS, so a grant alone reads nothing. Each policy is FOR SELECT,");
  L.push("-- TO bolao_public_reader, USING (true) — deliberately unconditional, because the row filtering");
  L.push("-- that matters happens in the projection, and a half-expressed predicate here would be a second");
  L.push("-- place for the public contract to be decided.");
  L.push("DO $bounded_owner$ BEGIN");
  L.push("  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bolao_public_reader') THEN");
  L.push("    CREATE ROLE bolao_public_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;");
  L.push("  END IF;");
  L.push("END $bounded_owner$;");
  L.push("");
  L.push("COMMENT ON ROLE bolao_public_reader IS 'Bounded definer for bolao.read_document(). NOLOGIN, NOBYPASSRLS, owns no table. Holds SELECT on exactly the eleven relations the public projection reads — deliberately NOT bolao.participants, which carries email and phone and which the public read path no longer touches.';");
  L.push("");
  L.push("-- PostgreSQL refuses ALTER FUNCTION ... OWNER TO a role the current user is not a member of.");
  L.push("-- Membership, not inheritance: bolao_public_reader is NOINHERIT, so this lets postgres SET ROLE");
  L.push("-- to it and hand it the function — it does not give postgres the role's privileges implicitly,");
  L.push("-- and postgres already outranks it in every direction that matters.");
  L.push("GRANT bolao_public_reader TO postgres;");
  L.push("");
  L.push("GRANT USAGE ON SCHEMA bolao TO bolao_public_reader;");
  L.push("");
  for (const t of PUBLIC_READ_RELATIONS) {
    L.push(`GRANT SELECT ON TABLE bolao.${t} TO bolao_public_reader;`);
    L.push(`DROP POLICY IF EXISTS ${t}_public_reader_select ON bolao.${t};`);
    L.push(`CREATE POLICY ${t}_public_reader_select ON bolao.${t} FOR SELECT TO bolao_public_reader USING (true);`);
  }
  L.push("");
  L.push("-- ALTER ... OWNER TO additionally requires the INCOMING owner to hold CREATE on the schema —");
  L.push("-- PostgreSQL will not let a role own an object in a schema it could not have created one in.");
  L.push("-- So CREATE is granted for the length of one statement and revoked immediately. Ownership");
  L.push("-- persists; the ability to create does not, and the end state is a definer that can read");
  L.push("-- eleven relations and do nothing else. Leaving CREATE in place would be the easy version and");
  L.push("-- would quietly give the public read path the right to add objects to the schema it reads.");
  L.push("GRANT CREATE ON SCHEMA bolao TO bolao_public_reader;");
  L.push("ALTER FUNCTION bolao.read_document(text) OWNER TO bolao_public_reader;");
  L.push("ALTER FUNCTION bolao.read_document(text) SECURITY DEFINER;");
  L.push("REVOKE CREATE ON SCHEMA bolao FROM bolao_public_reader;");
  L.push("");
  L.push("-- ─── THE PUBLIC SANITIZED SURFACE ─────────────────────────────────────────────────────────");
  L.push("--");
  L.push("-- NOT security_invoker, and that is what keeps anon out of the bolao schema entirely. Under a");
  L.push("-- security_invoker view the caller would need EXECUTE on bolao.read_document and therefore USAGE");
  L.push("-- on schema bolao — a grant the least-privilege rule refuses. With the default (owner-checked)");
  L.push("-- view, anon needs SELECT on this view and nothing else: it cannot NAME a bolao object, which is");
  L.push("-- a refusal one level earlier than RLS and does not depend on a policy being right.");
  L.push("--");
  L.push("-- The view references exactly one object — a STABLE, read-only function whose own authority is");
  L.push("-- the bounded role above — so 'runs as owner' here means 'may read the published projection',");
  L.push("-- not 'may read anything the owner may'.");
  L.push("--");
  L.push("-- It is a whitelist by construction, not a blacklist by subtraction. public.bolao_state_public");
  L.push("-- takes the private document and REMOVES four fields; anything added to the document later is");
  L.push("-- public by default, which is how auditLog's ip/userAgent and entries[].diagnostics' userAgent");
  L.push("-- are readable by anyone today. read_document() names every field it emits, so a new column is");
  L.push("-- private until someone writes it into the projection on purpose.");
  L.push("--");
  L.push("-- updated_at is NULL, not now(): it means 'when the document was last written' and the");
  L.push("-- normalized side does not carry that fact. A synthesised timestamp would let a");
  L.push("-- last-writer-wins client conclude this surface is newer than whatever it holds. The apps");
  L.push("-- select the column and use state.meta.updatedAt instead, which IS derived.");
  L.push("CREATE OR REPLACE VIEW public.bolao_state_normalized_public");
  L.push("WITH (security_invoker = true) AS");
  L.push("SELECT");
  L.push("  d.doc_id                    AS id,");
  L.push("  bolao.read_document(d.slug) AS state,");
  L.push("  NULL::timestamptz           AS updated_at");
  L.push("FROM (VALUES");
  L.push(Object.values(READ_SURFACE_COMPLETE).map((s) => `  ('${s.poolSlug}', '${POOL_TO_DOC_ID[s.poolSlug]}')`).join(",\n"));
  L.push(") AS d(slug, doc_id);");
  L.push("");
  L.push("COMMENT ON VIEW public.bolao_state_normalized_public IS 'Sanitized public read surface in the legacy (id, state, updated_at) contract, so a client readTable can be re-pointed here with no application code change. Emits only whitelisted fields: no email, payer, payment method, payment reference, auth user id, ip, user agent, device metadata, lineage or provenance. updated_at is deliberately NULL.';");
  L.push("");
  L.push("REVOKE ALL ON TABLE public.bolao_state_normalized_public FROM PUBLIC;");
  L.push("");
  L.push("-- ─── LEAST PRIVILEGE ──────────────────────────────────────────────────────────────────────");
  L.push("--");
  L.push("-- anon gets SELECT on ONE view and EXECUTE on ONE function, and nothing else. Specifically it");
  L.push("-- does NOT get: USAGE on the bolao schema, SELECT on any bolao.* table, the trusted");
  L.push("-- v_state_document, any operator RPC, or anything in the finance model. Without schema USAGE,");
  L.push("-- anon cannot name a bolao object even to be refused by RLS — the refusal happens a level");
  L.push("-- earlier, which is the level that does not depend on a policy being right.");
  L.push("--");
  L.push("-- No EXECUTE grant to anon on read_document, and none is needed: the owner-checked view is what");
  L.push("-- calls it. Granting it anyway would require schema USAGE and would hand the browser a callable");
  L.push("-- entry point with a free-text argument, next to a view that already fixes the three legal");
  L.push("-- values. One published surface, one shape.");
  L.push("GRANT SELECT ON TABLE public.bolao_state_normalized_public TO anon, authenticated;");
  L.push("GRANT EXECUTE ON FUNCTION bolao.read_document(text) TO service_role;");
  return L.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(readSurfaceCompletionDdl() + "\n");
