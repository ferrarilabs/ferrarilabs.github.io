--
-- PROVENANCE: FINAL_DATA_CERTIFICATION_20260813 · rollback of 20260813210000
--
-- Drops the three private forensic tables and everything copied into them.
--
-- This is safe ONLY while `public.bolao_state` still exists: every row in these tables is a copy
-- of a row that is still in the legacy document. It stops being safe the moment legacy retirement
-- executes, because these tables become the only surviving copy of auditLog (69 records, three
-- shapes), copa2026's entry diagnostics (21 entries) and the raw form of the private entry fields.
--
-- Do not apply this after retirement.
--

begin;

drop table if exists audit.legacy_entry_field;
drop table if exists audit.legacy_audit_event;
drop table if exists audit.legacy_document_archive;

commit;
