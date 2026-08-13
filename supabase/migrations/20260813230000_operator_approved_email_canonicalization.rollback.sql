--
-- PROVENANCE: POST_FORENSIC_CLOSURE_20260813 · rollback of 20260813230000 (decision D-B)
--
-- Restores the malformed address in the two canonical targets from the RAW value that was never
-- moved, and withdraws the operator decision record.
--
-- The raw value is read back from `audit.legacy_entry_field.raw_value`, which the forward
-- migration deliberately did not touch — the rollback needs no literal and cannot drift from the
-- source. This is only possible because raw and canonical were kept apart.
--
begin;

update public.bolao_entry_private p
   set participant_email = f.raw_value #>> '{}',
       updated_at        = now()
  from audit.legacy_entry_field f
 where f.field_path = 'participantEmail'
   and f.cleansing_rule = 'EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1'
   and f.pool_id = p.pool_id and f.entry_ref = p.entry_ref;

update bolao.participants pa
   set email      = (f.raw_value #>> '{}')::citext,
       updated_at = now()
  from audit.legacy_entry_field f
  join bolao.pool_entries pe on pe.legacy_entry_id::text = f.entry_ref
 where f.field_path = 'participantEmail'
   and f.cleansing_rule = 'EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1'
   and pa.participant_id = pe.participant_id;

update audit.legacy_entry_field
   set canonical_value = raw_value #>> '{}',
       cleansing_rule  = 'IDENTITY'
 where field_path = 'participantEmail'
   and cleansing_rule = 'EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1';

delete from audit.operator_cleansing_decision
 where audit_run_id = 'FDC-20260813' and decision_ref = 'D-B';

commit;
