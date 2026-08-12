-- NOT FOR PRODUCTION APPLY
-- LEGACY WRITE FENCE — CUTOVER_RUNBOOK step 11 (WS5-F4)
-- GENERATED FILE — do not edit by hand. Source: scripts/db/legacy_fence.mjs
-- Regenerate: node scripts/db/legacy_fence.mjs --write
--
-- This closes the direct browser write path to the legacy document. Everything after it — the
-- final reconciliation, the read cutover, the M16 decomposition — depends on the source having
-- stopped moving, and this is what stops it.
--
-- PRECONDITIONS, all of which the runbook already requires (do not apply this without them):
--   1. server_writes_enabled=on and the canary widened to SERVER_WRITE_PRIMARY (step 9)
--      — WS5-INV-2: the fence may only close once a working replacement write path exists for
--      every operation it denies.
--   2. minimum_write_version raised AND the CLIENT_TOO_OLD refusal proven distinguishable from
--      a transient error (step 10) — FR-5 / staleClientFenceReady. A fence that denies before
--      the refusal path works gives open tabs an opaque error they retry forever.
--   3. legacy_writes_allowed=false is deployed. That flag is NOT the fence; it renders a clear
--      message instead of an opaque one. Treating it AS the fence is the FS-4 mistake.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   · It does not touch SELECT. Step 11 precedes the read cutover at step 13, so the
--     application still reads this document afterwards.
--   · It does not touch the policies. 'Existing legacy policies are NOT modified while any
--     client still reads the legacy document' — and a dropped policy cannot be restored
--     without re-authoring its text, which is not a rollback.
--   · It does not touch service_role, which mirrors into this document until step 19.
--   · It does not use REVOKE ALL or a wildcard, per the choreography's ACL rule.

-- public.bolao_state — the bolão document this migration replaces — the fence's whole purpose
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bolao_state FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bolao_state FROM authenticated;
-- public.bolao_state_public — the PII-stripped projection of the whole document — strips participantEmail, payerName, paymentMethod and paymentTo from every entry. It is the browser's intended read path under F10, so SELECT must survive; but it projects the MIGRATION SUBJECT, and anon's inherited INSERT/UPDATE/DELETE on it write straight through to bolao_state (NIGHT-27). NOT obsolete: retiring it requires the clients to have moved to the target read path AND F10's remaining stages to have landed
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bolao_state_public FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bolao_state_public FROM authenticated;
-- public.bolao_state_public_cdb — the same projection narrowed to id = 'cdb2026' and stripping txId as well. CDB2026 is IN PRODUCTION, so this is a live read path and SELECT must survive. Same inherited write grants, same bypass
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bolao_state_public_cdb FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bolao_state_public_cdb FROM authenticated;

-- Verify immediately. The expected end state is: no fenced role holds any write privilege on
-- the document, every fenced role still holds SELECT, and service_role is unchanged.
-- SELECT c.relname,
--        r.rolname,
--        has_table_privilege(r.rolname, c.oid, 'SELECT') AS sel,
--        has_table_privilege(r.rolname, c.oid, 'INSERT') AS ins,
--        has_table_privilege(r.rolname, c.oid, 'UPDATE') AS upd,
--        has_table_privilege(r.rolname, c.oid, 'DELETE') AS del
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) r
--  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm')
--  ORDER BY c.relname, r.rolname
