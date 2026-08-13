--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813170000_public_read_execute_grant.sql
--
-- ═══ THE GRANT THE CATALOG TEST DID NOT NEED AND THE REAL API DID ════════════════════════════
--
-- `public.bolao_state_normalized_public` passed every database-level check — `SET ROLE anon` read
-- three rows — and then returned **HTTP 401** to the real anon key:
--
--     {"code":"42501","message":"permission denied for function read_document"}
--
-- The view is owner-checked rather than security_invoker, so its TABLE access is evaluated as the
-- owner. Function EXECUTE is not: PostgREST's `anon` is refused on `bolao.read_document` because
-- the function's ACL named only `bolao_public_reader` and `service_role`. A `SET ROLE anon` session
-- opened by postgres does not reproduce that, which is precisely why the rule is to test the API
-- and not the catalogue. Cutting over on the catalogue result would have served 401 to every
-- participant on all three products.
--
-- ═══ WHY THIS DOES NOT OPEN A DIRECT CALL PATH ═══════════════════════════════════════════════
--
-- EXECUTE alone is not enough to invoke a function: the caller also needs USAGE on its schema, and
-- anon has none on `bolao` — that refusal happens a level earlier than any ACL and is unchanged
-- here. So the grant lets the VIEW's evaluation succeed while a direct
-- `select bolao.read_document('cdb2026')` from a browser role stays denied. Both are asserted
-- immediately after this migration and again in the security gate.
--
-- The function remains STABLE, read-only, owned by the bounded `bolao_public_reader` (NOLOGIN,
-- NOBYPASSRLS, SELECT on eleven relations, no access to bolao.participants), and its only argument
-- is a pool slug whose three legal values are fixed by the view.
--
-- ═══ CLASSIFICATION ═════════════════════════════════════════════════════════════════════════
--
-- PLATFORM_SHARED · PRIVILEGE. One GRANT EXECUTE. No schema USAGE, no table grant, no new object,
-- no data change.
--
-- ROLLBACK (FULL). REVOKE EXECUTE ON FUNCTION bolao.read_document(text) FROM anon, authenticated.
-- Reverting it makes the public normalized surface return 401 again, so the READ route must go
-- back to legacy first.
--

BEGIN;

GRANT EXECUTE ON FUNCTION bolao.read_document(text) TO anon, authenticated;

COMMIT;
