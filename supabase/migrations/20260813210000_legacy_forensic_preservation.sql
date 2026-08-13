--
-- PROVENANCE: FINAL_DATA_CERTIFICATION_20260813 · finding G2 · class PLATFORM_SHARED (private)
--
-- 20260813210000_legacy_forensic_preservation.sql
--
-- ═══ WHAT LEGACY RETIREMENT WOULD DESTROY ════════════════════════════════════════════════════
--
-- `bolao.read_document()` reproduces the legacy shape from normalized state, and for cdb2026
-- `bolao.cdb_authoritative_document()` reproduces the stored document leaf-path-for-leaf-path
-- (measured: 1598 / 1598, 0 missing, 0 extra). Neither fact makes `public.bolao_state`
-- disposable, because `cdb_authoritative_document()` reaches parity by *copying the stored
-- document's* legacy-only sections forward. Delete the row and the copy has nothing to read.
--
-- Measured across the three documents, the sections normalized does not model:
--
--     auditLog                    69 records   br2026 7 · cdb2026 43 · copa2026 19   THREE shapes
--     entries[].diagnostics       21 entries   copa2026 only — userAgent, viewport, timezone,
--                                              capturedAt
--     entries[].lastClientRef      2 entries   cdb2026
--     phases.*.scheduleProvenance  1 phase     cdb2026 quartas — class C operator metadata
--     roundEmail                   1 ledger    br2026 — 11 recipients, baselines, sent batches
--     espnSync                     5 flags     cdb2026
--     meta                         3 documents describes the legacy document, not the model
--     residue picks               16 records   cdb2026 — sf-1/sf-2/final-1 across 2 entries
--
-- The forensic manifest registered auditLog as having *two* shapes, both on cdb2026. There is a
-- third. copa2026's 19 records are `{ts, action, entryId, entryName, email, ip, userAgent, screen,
-- platform, lang, changes, changeCount}` — the only auditLog shape on the platform that carries
-- contact and network data, and the reason finding G1 exists. Any model that assumed two shapes
-- would have silently dropped the one that matters most.
--
-- ═══ WHY THREE TABLES AND NOT ONE, AND NOT TWELVE ════════════════════════════════════════════
--
-- `legacy_document_archive` alone discharges the preservation obligation: it stores each document
-- whole and unaltered, so nothing above can be lost, including sections nobody has enumerated yet.
-- It is the safety net, not the answer — a jsonb blob is evidence, not a queryable record.
--
-- The other two exist because two classes of datum have to be *addressable* after retirement:
--
--   · `legacy_audit_event`  — auditLog is the declared LEGACY_RETIREMENT_PREREQUISITE. One row per
--     record, raw payload intact, plus the canonical fields that are deterministic: which key
--     carried the instant (`ts` or `at` — never collapsed), the parsed instant where it parses,
--     action/actor under whichever spelling the shape uses. Nothing is inferred: a record whose
--     instant does not parse keeps `occurred_at` null and its raw string.
--
--   · `legacy_entry_field` — per-entry values the normalized model has no column for, and the raw
--     form of the four it does. `public.bolao_entry_private` holds the canonical contact/payment
--     values and is exact (46/46 rows, every value semantically equal to the document). What it
--     cannot express is that br2026 stores two payerName and one paymentMethod as `""` where the
--     private table stores NULL — a deterministic EMPTY_TO_NULL cleansing whose input survives
--     only in the document. Retirement would make the cleansing unfalsifiable.
--
-- No generic key/value store for the document-level sections: the archive already holds them
-- verbatim, and decomposing `roundEmail` or `scheduleProvenance` into rows would invent a schema
-- for data with one instance each.
--
-- ═══ ACCESS ══════════════════════════════════════════════════════════════════════════════════
--
-- Schema `audit` has USAGE = false for both `anon` and `authenticated` (asserted below), which is
-- what actually closes the door — PostgREST cannot expose what the role cannot enter. RLS is
-- enabled and FORCED with zero policies on all three, so even a future USAGE grant denies every
-- row to every non-BYPASSRLS role. All privileges are revoked explicitly rather than inherited.
-- This is the same posture as `audit.migration_lineage` and `audit.audit_events`.
--
-- ═══ WHAT THIS MIGRATION DOES NOT DO ═════════════════════════════════════════════════════════
--
-- It does not read, write, move or delete one byte of `public.bolao_state`, `bolao.*` or
-- `public.bolao_entry_private`. It does not retire anything. It creates three empty private
-- tables and copies into them. Every source stays exactly where it is, and the backfill is
-- keyed by `audit_run_id` so re-running it against a later run is additive, never destructive.
--

begin;

-- ── 1. whole-document archive ────────────────────────────────────────────────────────────────
create table if not exists audit.legacy_document_archive (
  archive_id        uuid        primary key default gen_random_uuid(),
  audit_run_id      text        not null,
  pool_id           text        not null,
  captured_at       timestamptz not null default now(),
  source_relation   text        not null default 'public.bolao_state',
  source_sha256     text        not null,
  document_octets   integer     not null,
  raw_document      jsonb       not null,
  constraint legacy_document_archive_run_pool_key unique (audit_run_id, pool_id)
);

comment on table audit.legacy_document_archive is
  'Immutable whole-document capture of public.bolao_state, one row per (audit run, pool). '
  'PRIVATE: contains participant email, IP, userAgent and payment metadata verbatim. '
  'Exists so that retiring the legacy row cannot destroy a datum nobody enumerated.';

-- ── 2. auditLog, decomposed, all shapes ──────────────────────────────────────────────────────
create table if not exists audit.legacy_audit_event (
  legacy_audit_event_id uuid        primary key default gen_random_uuid(),
  audit_run_id          text        not null,
  pool_id               text        not null,
  ordinal               integer     not null,
  shape                 text        not null,
  instant_field         text,
  instant_raw           text,
  occurred_at           timestamptz,
  action_raw            text,
  actor_raw             text,
  client_ref            text,
  raw_event             jsonb       not null,
  source_fingerprint    text        not null,
  captured_at           timestamptz not null default now(),
  constraint legacy_audit_event_run_pool_ord_key unique (audit_run_id, pool_id, ordinal),
  constraint legacy_audit_event_shape_chk check (shape in (
    'TS_ACTION_ADMIN_DETAIL',      -- br2026 (7) + cdb2026 (28): {ts, action, admin, detail}
    'TYPE_ACTOR_AT_CLIENTREF',     -- cdb2026 (15): {type, actor, at, clientRef, payload, source}
    'COPA_EDIT_WITH_DIAGNOSTICS',  -- copa2026 (19): + email, ip, userAgent, screen, platform, lang
    'UNCLASSIFIED'
  ))
);

comment on table audit.legacy_audit_event is
  'One row per legacy bolao_state.auditLog record, raw payload preserved intact. '
  'PRIVATE: copa2026 records carry email, ip, userAgent, screen, platform and lang. '
  'instant_field records WHICH key carried the instant (ts or at); the two are never collapsed.';

-- ── 3. per-entry fields, raw and canonical ───────────────────────────────────────────────────
create table if not exists audit.legacy_entry_field (
  legacy_entry_field_id uuid        primary key default gen_random_uuid(),
  audit_run_id          text        not null,
  pool_id               text        not null,
  entry_ref             text        not null,
  field_path            text        not null,
  raw_value             jsonb       not null,
  canonical_value       text,
  cleansing_rule        text        not null,
  captured_at           timestamptz not null default now(),
  constraint legacy_entry_field_run_key unique (audit_run_id, pool_id, entry_ref, field_path),
  constraint legacy_entry_field_rule_chk check (cleansing_rule in (
    'RAW_ONLY',        -- no canonical form is defined for this field
    'IDENTITY',        -- canonical == raw
    'EMPTY_TO_NULL'    -- raw is the empty string; canonical is NULL
  ))
);

comment on table audit.legacy_entry_field is
  'Per-entry legacy values: fields normalized does not model (diagnostics.*, lastClientRef) and '
  'the RAW form of the four it does (participantEmail, payerName, paymentMethod, paymentTo), so '
  'that the EMPTY_TO_NULL cleansing applied into public.bolao_entry_private stays falsifiable. '
  'PRIVATE: contains email, payment metadata and userAgent verbatim.';

-- ── access: fail closed ──────────────────────────────────────────────────────────────────────
alter table audit.legacy_document_archive enable row level security;
alter table audit.legacy_document_archive force row level security;
alter table audit.legacy_audit_event      enable row level security;
alter table audit.legacy_audit_event      force row level security;
alter table audit.legacy_entry_field      enable row level security;
alter table audit.legacy_entry_field      force row level security;

revoke all on audit.legacy_document_archive from public, anon, authenticated;
revoke all on audit.legacy_audit_event      from public, anon, authenticated;
revoke all on audit.legacy_entry_field      from public, anon, authenticated;

-- ═══ BACKFILL ════════════════════════════════════════════════════════════════════════════════

insert into audit.legacy_document_archive
  (audit_run_id, pool_id, source_sha256, document_octets, raw_document)
select
  'FDC-20260813',
  s.id,
  encode(sha256(convert_to(s.state::text, 'UTF8')), 'hex'),
  octet_length(s.state::text),
  s.state
from public.bolao_state s
on conflict (audit_run_id, pool_id) do nothing;

insert into audit.legacy_audit_event
  (audit_run_id, pool_id, ordinal, shape, instant_field, instant_raw, occurred_at,
   action_raw, actor_raw, client_ref, raw_event, source_fingerprint)
select
  'FDC-20260813',
  s.id,
  (a.ord - 1)::int,
  case
    when a.rec ? 'email' and a.rec ? 'ip'        then 'COPA_EDIT_WITH_DIAGNOSTICS'
    when a.rec ? 'type'  and a.rec ? 'at'        then 'TYPE_ACTOR_AT_CLIENTREF'
    when a.rec ? 'ts'    and a.rec ? 'action'    then 'TS_ACTION_ADMIN_DETAIL'
    else 'UNCLASSIFIED'
  end,
  case when a.rec ? 'ts' then 'ts' when a.rec ? 'at' then 'at' else null end,
  coalesce(a.rec ->> 'ts', a.rec ->> 'at'),
  -- parsed only when it actually parses; never inferred, never defaulted
  (case
     when coalesce(a.rec ->> 'ts', a.rec ->> 'at') ~
          '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}(:?\d{2})?|Z)?$'
     then (coalesce(a.rec ->> 'ts', a.rec ->> 'at'))::timestamptz
     else null
   end),
  coalesce(a.rec ->> 'action', a.rec ->> 'type'),
  coalesce(a.rec ->> 'admin',  a.rec ->> 'actor'),
  a.rec ->> 'clientRef',
  a.rec,
  encode(sha256(convert_to(a.rec::text, 'UTF8')), 'hex')
from public.bolao_state s
cross join lateral jsonb_array_elements(coalesce(s.state -> 'auditLog', '[]'::jsonb))
             with ordinality a(rec, ord)
on conflict (audit_run_id, pool_id, ordinal) do nothing;

insert into audit.legacy_entry_field
  (audit_run_id, pool_id, entry_ref, field_path, raw_value, canonical_value, cleansing_rule)
select
  'FDC-20260813', pool_id, entry_ref, field_path, raw_value,
  case
    when jsonb_typeof(raw_value) = 'string' and raw_value #>> '{}' = '' then null
    when jsonb_typeof(raw_value) = 'string' then raw_value #>> '{}'
    else null
  end,
  case
    when jsonb_typeof(raw_value) <> 'string' then 'RAW_ONLY'
    when raw_value #>> '{}' = ''             then 'EMPTY_TO_NULL'
    else 'IDENTITY'
  end
from (
  -- the four fields normalized DOES model — captured RAW so the cleansing stays falsifiable
  select s.id as pool_id, e.value ->> 'id' as entry_ref, f.k as field_path, e.value -> f.k as raw_value
  from public.bolao_state s
  cross join lateral jsonb_array_elements(coalesce(s.state -> 'entries', '[]'::jsonb)) e
  cross join lateral (values ('participantEmail'), ('payerName'), ('paymentMethod'), ('paymentTo'),
                             ('lastClientRef')) f(k)
  where e.value ? f.k
  union all
  -- diagnostics: no normalized column exists at all
  select s.id, e.value ->> 'id', 'diagnostics.' || d.k, e.value -> 'diagnostics' -> d.k
  from public.bolao_state s
  cross join lateral jsonb_array_elements(coalesce(s.state -> 'entries', '[]'::jsonb)) e
  cross join lateral jsonb_object_keys(e.value -> 'diagnostics') d(k)
  where jsonb_typeof(e.value -> 'diagnostics') = 'object'
) src
on conflict (audit_run_id, pool_id, entry_ref, field_path) do nothing;

-- ═══ RECONCILIATION — the migration refuses to commit if the copy is not exact ═══════════════
do $$
declare
  v_src int; v_tgt int; v_bad int;
begin
  -- documents
  select count(*) into v_src from public.bolao_state;
  select count(*) into v_tgt from audit.legacy_document_archive where audit_run_id='FDC-20260813';
  if v_src <> v_tgt then raise exception 'document archive %/% rows', v_tgt, v_src; end if;

  select count(*) into v_bad
  from public.bolao_state s
  join audit.legacy_document_archive a on a.pool_id = s.id and a.audit_run_id='FDC-20260813'
  where a.raw_document is distinct from s.state;
  if v_bad <> 0 then raise exception 'document archive differs from source for % pools', v_bad; end if;

  -- audit events
  select coalesce(sum(jsonb_array_length(coalesce(state->'auditLog','[]'::jsonb))),0) into v_src
  from public.bolao_state;
  select count(*) into v_tgt from audit.legacy_audit_event where audit_run_id='FDC-20260813';
  if v_src <> v_tgt then raise exception 'audit event copy %/% rows', v_tgt, v_src; end if;

  select count(*) into v_bad from audit.legacy_audit_event
  where audit_run_id='FDC-20260813' and shape='UNCLASSIFIED';
  if v_bad <> 0 then raise exception '% auditLog records did not classify into a known shape', v_bad; end if;

  -- every raw_event must still be byte-identical to the array element it came from
  select count(*) into v_bad
  from audit.legacy_audit_event t
  join public.bolao_state s on s.id = t.pool_id
  where t.audit_run_id='FDC-20260813'
    and t.raw_event is distinct from (s.state->'auditLog'->t.ordinal);
  if v_bad <> 0 then raise exception '% audit events drifted from source', v_bad; end if;

  -- entry fields: every captured field must match its source leaf exactly
  select count(*) into v_bad
  from audit.legacy_entry_field t
  join public.bolao_state s on s.id = t.pool_id
  cross join lateral jsonb_array_elements(coalesce(s.state->'entries','[]'::jsonb)) e
  where t.audit_run_id='FDC-20260813'
    and e.value->>'id' = t.entry_ref
    and t.raw_value is distinct from (
      case when t.field_path like 'diagnostics.%'
           then e.value->'diagnostics'->substring(t.field_path from 13)
           else e.value->t.field_path end);
  if v_bad <> 0 then raise exception '% entry fields drifted from source', v_bad; end if;

  -- the EMPTY_TO_NULL claim must be exactly reproducible against public.bolao_entry_private
  select count(*) into v_bad
  from audit.legacy_entry_field t
  join public.bolao_entry_private p on p.pool_id = t.pool_id and p.entry_ref = t.entry_ref
  where t.audit_run_id='FDC-20260813'
    and t.field_path in ('participantEmail','payerName','paymentMethod','paymentTo')
    and t.canonical_value is distinct from (
      case t.field_path
        when 'participantEmail' then p.participant_email
        when 'payerName'        then p.payer_name
        when 'paymentMethod'    then p.payment_method
        when 'paymentTo'        then p.payment_to
      end);
  if v_bad <> 0 then
    raise exception '% canonical values disagree with public.bolao_entry_private', v_bad;
  end if;

  -- access must fail closed
  if has_schema_privilege('anon','audit','USAGE')
     or has_schema_privilege('authenticated','audit','USAGE') then
    raise exception 'audit schema is reachable by a browser role';
  end if;
  if has_table_privilege('anon','audit.legacy_document_archive','SELECT')
     or has_table_privilege('authenticated','audit.legacy_document_archive','SELECT')
     or has_table_privilege('anon','audit.legacy_audit_event','SELECT')
     or has_table_privilege('authenticated','audit.legacy_audit_event','SELECT')
     or has_table_privilege('anon','audit.legacy_entry_field','SELECT')
     or has_table_privilege('authenticated','audit.legacy_entry_field','SELECT') then
    raise exception 'a browser role holds SELECT on a private forensic table';
  end if;
end $$;

commit;
