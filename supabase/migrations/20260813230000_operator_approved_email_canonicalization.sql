--
-- PROVENANCE: POST_FORENSIC_CLOSURE_20260813 · decision D-B · class DATA_ONLY (operator-approved)
--
-- 20260813230000_operator_approved_email_canonicalization.sql
--
-- ═══ ONE ADDRESS, ONE CHARACTER, AND AN EXPLICIT APPROVAL ════════════════════════════════════
--
-- The forensic audit found exactly one malformed address among the 46 stored: a copa2026 entry
-- whose domain ends in a **trailing comma**. It was carried faithfully into
-- `public.bolao_entry_private.participant_email` and `bolao.participants.email`, which is correct —
-- the migration copied the source rather than quietly repairing it, which is why the defect is
-- still attributable to the source and not to the pipeline.
--
-- The audit quarantined it rather than fixing it, because guessing a corrected address is guessing
-- a person's contact point and §34 puts that in the unsafe class with no "unless it's obvious"
-- exception. **The operator has now approved the correction**, and the approval is
-- record-specific: this migration corrects one address, identified by the sha256 of its raw value,
-- and removes one terminal comma. It performs no generic punctuation stripping and would be a
-- no-op against any other value.
--
-- ═══ THE DATA CORROBORATES THE CORRECTION — IT IS NOT A GUESS ════════════════════════════════
--
-- The comma-stripped value is not inferred. The identical mailbox is already present, correctly
-- spelled, on **two other entries in two other pools** (`cdb2026` and `br2026`), and those two
-- resolve to **one** canonical participant — the same person, playing three pools, whose copa
-- entry acquired a stray comma. Fingerprint `b6f29448…` appears three times after this migration
-- and appeared twice before it.
--
-- ═══ WHAT IS NOT DONE, AND WHY EACH ONE MATTERS ══════════════════════════════════════════════
--
-- **The raw historical value is not touched.** It survives in three places, all of which this
-- migration leaves alone: `audit.legacy_entry_field.raw_value`,
-- `audit.legacy_document_archive.raw_document`, and the live `public.bolao_state` document. Raw is
-- evidence; canonical is the operational value. Rewriting the legacy document to make three copies
-- of a string identical would destroy the only proof that the anomaly ever existed.
--
-- **No participant is merged.** After this migration `bolao.participants` holds 26 people over
-- **23** distinct addresses instead of 24 — a third shared-mailbox group. Shared mailbox is not
-- shared identity on this platform (ledger `20260812230000`,
-- `participants_email_is_not_identity`), and the fact that these two rows now look like one person
-- is an observation for the operator, not a licence to merge. `participant_id` is untouched.
--
-- **No delivery claim is made.** copa2026 concluded 2026-07-19 and has no delivery ledger —
-- `roundEmail` is a br2026 structure. Whether messages sent to the malformed address were ever
-- received is `NOT_DETERMINABLE_FROM_AVAILABLE_DATA`, and this migration does not resend anything,
-- does not mark anything delivered, and does not imply either outcome.
--
-- **No entry, prediction, payment confirmation or score is touched.** Two UPDATEs, one row each,
-- one column each.
--

begin;

-- ── the rule, versioned and record-scoped ────────────────────────────────────────────────────
alter table audit.legacy_entry_field drop constraint if exists legacy_entry_field_rule_chk;
alter table audit.legacy_entry_field add constraint legacy_entry_field_rule_chk check (cleansing_rule in (
  'RAW_ONLY',
  'IDENTITY',
  'EMPTY_TO_NULL',
  'EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1'
));

-- ── the operator decision, as a durable private record ───────────────────────────────────────
create table if not exists audit.operator_cleansing_decision (
  decision_id            uuid        primary key default gen_random_uuid(),
  audit_run_id           text        not null,
  decision_ref           text        not null,
  rule_id                text        not null,
  product                text        not null,
  entity_class           text        not null,
  source_record_token    text        not null,
  participant_token      text,
  raw_fingerprint        text        not null,
  canonical_fingerprint  text        not null,
  raw_preserved_in       text        not null,
  targets_updated        text        not null,
  rows_affected          integer     not null,
  operator_approved      boolean     not null,
  approved_at            timestamptz not null default now(),
  rationale              text        not null,
  constraint operator_cleansing_decision_ref_key unique (audit_run_id, decision_ref)
);

comment on table audit.operator_cleansing_decision is
  'Field-level lineage for cleansing that required explicit operator approval. Holds fingerprints '
  'and tokens only — never a raw or canonical PII value. PRIVATE: audit schema, RLS forced.';

alter table audit.operator_cleansing_decision enable row level security;
alter table audit.operator_cleansing_decision force row level security;
revoke all on audit.operator_cleansing_decision from public, anon, authenticated;

-- ── the correction, bound to ONE record by the fingerprint of its raw value ───────────────────
-- 66f7b533… is the sha256 of the exact malformed value the audit identified. Any other value,
-- including any other address that happens to end in a comma, does not match and is not touched.

update public.bolao_entry_private
   set participant_email = rtrim(participant_email, ','),
       updated_at        = now()
 where encode(sha256(convert_to(participant_email, 'UTF8')), 'hex')
       = '66f7b533e418ec551f00dfb38bb42c61a72c90b0013ec3af595f164c98f9a9c4';

update bolao.participants
   set email      = rtrim(email::text, ',')::citext,
       updated_at = now()
 where encode(sha256(convert_to(email::text, 'UTF8')), 'hex')
       = '66f7b533e418ec551f00dfb38bb42c61a72c90b0013ec3af595f164c98f9a9c4';

-- ── the forensic row keeps its RAW value and gains the canonical one ──────────────────────────
update audit.legacy_entry_field
   set canonical_value = rtrim(raw_value #>> '{}', ','),
       cleansing_rule  = 'EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1'
 where field_path = 'participantEmail'
   and encode(sha256(convert_to(raw_value #>> '{}', 'UTF8')), 'hex')
       = '66f7b533e418ec551f00dfb38bb42c61a72c90b0013ec3af595f164c98f9a9c4';

insert into audit.operator_cleansing_decision
  (audit_run_id, decision_ref, rule_id, product, entity_class, source_record_token,
   participant_token, raw_fingerprint, canonical_fingerprint, raw_preserved_in, targets_updated,
   rows_affected, operator_approved, rationale)
select
  'FDC-20260813', 'D-B', 'EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1',
  'copa2026', 'ENTRY_PRIVATE_CONTACT',
  left(md5(p.entry_ref), 8),
  (select left(md5(pe.participant_id::text), 8) from bolao.pool_entries pe
    where pe.legacy_entry_id::text = p.entry_ref limit 1),
  '66f7b533e418ec551f00dfb38bb42c61a72c90b0013ec3af595f164c98f9a9c4',
  'b6f2944877f487cb344f2e4743f76e9f6657165f6855af9c953903f0202d1618',
  'audit.legacy_entry_field.raw_value; audit.legacy_document_archive.raw_document; public.bolao_state',
  'public.bolao_entry_private.participant_email; bolao.participants.email; audit.legacy_entry_field.canonical_value',
  2, true,
  'Terminal comma in the domain. Operator-approved, record-specific. Same mailbox present '
  'correctly spelled on two other entries resolving to one canonical participant. No identity '
  'merge, no delivery inference, raw preserved in three places.'
from public.bolao_entry_private p
where encode(sha256(convert_to(p.participant_email, 'UTF8')), 'hex')
      = 'b6f2944877f487cb344f2e4743f76e9f6657165f6855af9c953903f0202d1618'
  and p.pool_id = 'main'
  and p.entry_ref = '1a4e70b0-267c-4bdb-a999-a5b28cd3df4c'
on conflict (audit_run_id, decision_ref) do nothing;

-- ── the migration refuses to commit unless every one of these holds ───────────────────────────
do $$
declare n int;
begin
  -- the canonical value is now syntactically valid, and there is exactly one of it
  select count(*) into n from public.bolao_entry_private
   where encode(sha256(convert_to(participant_email,'UTF8')),'hex')
         = 'b6f2944877f487cb344f2e4743f76e9f6657165f6855af9c953903f0202d1618'
     and pool_id = 'main' and entry_ref = '1a4e70b0-267c-4bdb-a999-a5b28cd3df4c';
  if n <> 1 then raise exception 'D-B: private target not corrected (% rows)', n; end if;

  select count(*) into n from bolao.participants
   where encode(sha256(convert_to(email::text,'UTF8')),'hex')
         = '66f7b533e418ec551f00dfb38bb42c61a72c90b0013ec3af595f164c98f9a9c4';
  if n <> 0 then raise exception 'D-B: participants still holds the malformed value'; end if;

  -- no malformed address survives in any canonical target
  select count(*) into n from public.bolao_entry_private
   where participant_email is not null
     and participant_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$';
  if n <> 0 then raise exception 'D-B: % malformed addresses remain in bolao_entry_private', n; end if;

  -- the RAW value is untouched in all three places it lives
  select count(*) into n from audit.legacy_entry_field
   where field_path = 'participantEmail'
     and encode(sha256(convert_to(raw_value #>> '{}','UTF8')),'hex')
         = '66f7b533e418ec551f00dfb38bb42c61a72c90b0013ec3af595f164c98f9a9c4';
  if n <> 1 then raise exception 'D-B: raw forensic value was altered or lost'; end if;

  select count(*) into n from public.bolao_state s, lateral jsonb_array_elements(s.state->'entries') e
   where (e.value->>'participantEmail') like '%,';
  if n <> 1 then raise exception 'D-B: the legacy document was modified — raw evidence must not move'; end if;

  select count(*) into n from audit.legacy_document_archive
   where raw_document::text like '%,\"%' or raw_document::text like '%.com,%';
  if n < 1 then raise exception 'D-B: the archived document no longer carries the raw value'; end if;

  -- identity, ownership and business state are untouched
  if (select count(*) from bolao.participants) <> 26 then raise exception 'D-B: participant count changed'; end if;
  if (select count(*) from bolao.pool_entries) <> 46 then raise exception 'D-B: entry count changed'; end if;
  if (select count(*) from bolao.predictions) <> 1045 then raise exception 'D-B: prediction count changed'; end if;
  if (select count(*) from bolao.classification_predictions) <> 154 then raise exception 'D-B: zone prediction count changed'; end if;
  if (select count(*) from bolao.entry_payment_confirmation) <> 50 then raise exception 'D-B: payment confirmation count changed'; end if;
  if (select count(*) from bolao.participants where canonical_participant_id is not null) <> 0 then
    raise exception 'D-B: a participant merge was asserted — email is not identity';
  end if;

  -- shared mailbox is expected to go 24 -> 23 distinct addresses over the SAME 26 people
  select count(distinct lower(email::text)) into n from bolao.participants where email is not null;
  if n <> 23 then raise exception 'D-B: distinct address count is % (expected 23)', n; end if;

  -- the decision record exists
  if (select count(*) from audit.operator_cleansing_decision
       where audit_run_id='FDC-20260813' and decision_ref='D-B') <> 1 then
    raise exception 'D-B: operator decision lineage row was not written';
  end if;

  -- privacy: the private targets stay private
  if has_schema_privilege('anon','audit','USAGE') or has_schema_privilege('authenticated','audit','USAGE')
     or has_table_privilege('anon','public.bolao_entry_private','SELECT') then
    raise exception 'D-B: a browser role can reach a private contact store';
  end if;
end $$;

commit;
