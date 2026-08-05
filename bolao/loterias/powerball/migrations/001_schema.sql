-- Powerball Admin — schema migration (PROPOSAL ONLY, NOT APPLIED TO PRODUCTION)
-- Branch: powerball-admin-supabase-audit
-- Status: draft / dry-run only. Never run this against the production Supabase project.
-- See docs/bolao/loterias/POWERBALL_ADMIN_ARCHITECTURE.md for the design rationale.

-- ============================================================
-- Roles
-- ============================================================
create type lottery_role as enum ('owner', 'admin', 'auditor');

create table if not exists lottery_admin_roles (
  role_id       uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  email_snapshot text not null,
  role          lottery_role not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  unique (user_id, role)
);

-- ============================================================
-- Core entities
-- ============================================================
create type participant_state as enum ('active', 'inactive', 'archived');

create table if not exists lottery_participants (
  participant_id  uuid primary key default gen_random_uuid(),
  display_name    text not null,
  email           text,
  phone           text,
  state           participant_state not null default 'active',
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  archived_at     timestamptz,
  archived_by     uuid references auth.users(id)
);

create table if not exists lottery_pools (
  pool_id       uuid primary key default gen_random_uuid(),
  name          text not null,
  status        text not null default 'open', -- open|closed|archived
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

create table if not exists lottery_draws (
  draw_id           uuid primary key default gen_random_uuid(),
  pool_id           uuid not null references lottery_pools(pool_id),
  draw_date         date not null,
  jackpot_estimate  numeric(14,2),
  cash_value_estimate numeric(14,2),
  status            text not null default 'scheduled', -- scheduled|closed|drawn|archived
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id)
);

create table if not exists lottery_participations (
  participation_id uuid primary key default gen_random_uuid(),
  participant_id    uuid not null references lottery_participants(participant_id),
  pool_id           uuid not null references lottery_pools(pool_id),
  draw_id           uuid references lottery_draws(draw_id),
  cotas             numeric(10,4) not null default 1,
  state             text not null default 'active', -- active|cancelled|archived
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id)
);

create type payment_txn_type as enum ('contribution', 'refund', 'adjustment', 'reversal', 'carryover');

-- Append-only ledger. No UPDATE/DELETE — corrections are new rows referencing reversed_transaction_id.
create table if not exists lottery_payment_transactions (
  transaction_id      uuid primary key default gen_random_uuid(),
  participation_id    uuid not null references lottery_participations(participation_id),
  type                 payment_txn_type not null,
  amount               numeric(14,2) not null,
  external_reference   text,           -- e.g. Zelle/PIX transaction id — never exposed publicly
  reverses_transaction_id uuid references lottery_payment_transactions(transaction_id),
  reason               text,
  proof_object_path    text,           -- path inside powerball-private storage bucket
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id)
);

create table if not exists lottery_tickets (
  ticket_id       uuid primary key default gen_random_uuid(),
  draw_id         uuid not null references lottery_draws(draw_id),
  numbers         integer[] not null,
  powerball       integer not null,
  power_play      boolean not null default false,
  status          text not null default 'draft', -- draft|published|superseded
  version         integer not null default 1,
  superseded_by   uuid references lottery_tickets(ticket_id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id)
);

create table if not exists lottery_ticket_publications (
  publication_id      uuid primary key default gen_random_uuid(),
  draw_id              uuid not null references lottery_draws(draw_id),
  version              integer not null default 1,
  status               text not null default 'draft', -- draft|published|corrected
  manifest_json        jsonb not null,
  manifest_hash        text not null,
  financial_snapshot   jsonb not null,
  participant_snapshot jsonb not null,
  supersedes_publication_id uuid references lottery_ticket_publications(publication_id),
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id)
);

create table if not exists lottery_ticket_publication_items (
  item_id         uuid primary key default gen_random_uuid(),
  publication_id  uuid not null references lottery_ticket_publications(publication_id),
  ticket_id       uuid not null references lottery_tickets(ticket_id),
  created_at      timestamptz not null default now()
);

create table if not exists lottery_results (
  result_id       uuid primary key default gen_random_uuid(),
  draw_id         uuid not null references lottery_draws(draw_id),
  numbers         integer[] not null,
  powerball       integer not null,
  jackpot_amount  numeric(14,2),
  status          text not null default 'active', -- active|corrected|superseded
  version         integer not null default 1,
  supersedes_result_id uuid references lottery_results(result_id),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create table if not exists lottery_email_jobs (
  job_id          uuid primary key default gen_random_uuid(),
  job_type        text not null, -- participant_added|tickets_published|tickets_corrected|admin_test
  entity_type     text,
  entity_id       uuid,
  recipient_email text not null,
  status          text not null default 'pending', -- pending|processing|sent|failed|cancelled
  attempts        integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create table if not exists lottery_email_deliveries (
  delivery_id         uuid primary key default gen_random_uuid(),
  job_id               uuid not null references lottery_email_jobs(job_id),
  provider_message_id  text,
  delivered_at         timestamptz,
  status               text not null, -- sent|bounced|failed
  raw_response          jsonb,
  created_at            timestamptz not null default now()
);

-- ============================================================
-- Audit log — append-only, hash-chained
-- ============================================================
create table if not exists lottery_admin_audit (
  audit_id            uuid primary key default gen_random_uuid(),
  actor_user_id        uuid references auth.users(id),
  actor_email_snapshot text,
  actor_role           lottery_role,
  action_type          text not null,
  entity_type          text not null,
  entity_id            uuid,
  before_snapshot       jsonb,
  after_snapshot        jsonb,
  reason                text,
  request_id            uuid,
  correlation_id         uuid,
  source                 text not null default 'admin-ui', -- admin-ui|workflow|email-worker|reconciler|migration
  server_created_at       timestamptz not null default now(), -- DB clock only, never trust browser
  client_metadata          jsonb,
  previous_entry_hash       text,
  entry_hash                 text not null
);

comment on table lottery_admin_audit is
  'Append-only, hash-chained audit log. Tamper-evident (a modification breaks the hash chain and
   is detectable by verify_powerball_audit_chain), NOT tamper-proof against someone with direct
   superuser/service_role access to Postgres — a full DB admin could rewrite rows and recompute
   the chain. This is documented honestly per POWERBALL_ADMIN_AUDIT.md.';

-- Block UPDATE/DELETE on the audit log, even for the table owner acting through normal DML.
create or replace function lottery_audit_block_mutation() returns trigger as $$
begin
  raise exception 'lottery_admin_audit is append-only: % is not permitted', TG_OP;
end;
$$ language plpgsql;

create trigger trg_lottery_audit_no_update
  before update on lottery_admin_audit
  for each row execute function lottery_audit_block_mutation();

create trigger trg_lottery_audit_no_delete
  before delete on lottery_admin_audit
  for each row execute function lottery_audit_block_mutation();

-- Compute the hash chain server-side on insert. entry_hash = sha256(previous_entry_hash ||
-- canonical row fields). previous_entry_hash is looked up from the most recent row, not
-- trusted from the client.
create or replace function lottery_audit_compute_hash() returns trigger as $$
declare
  prev_hash text;
begin
  select entry_hash into prev_hash from lottery_admin_audit order by server_created_at desc, audit_id desc limit 1;
  new.previous_entry_hash := prev_hash;
  new.server_created_at := now();
  new.entry_hash := encode(
    digest(
      coalesce(prev_hash, '') || '|' ||
      coalesce(new.actor_user_id::text, '') || '|' ||
      new.action_type || '|' || new.entity_type || '|' || coalesce(new.entity_id::text, '') || '|' ||
      coalesce(new.before_snapshot::text, '') || '|' || coalesce(new.after_snapshot::text, '') || '|' ||
      coalesce(new.reason, '') || '|' || new.server_created_at::text,
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$ language plpgsql;

create trigger trg_lottery_audit_hash
  before insert on lottery_admin_audit
  for each row execute function lottery_audit_compute_hash();

-- ============================================================
-- Integrity verification RPC
-- ============================================================
create or replace function verify_powerball_audit_chain()
returns table(valid boolean, first_broken_audit_id uuid, checked_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  prev_hash text := null;
  computed_hash text;
  n integer := 0;
begin
  for rec in select * from lottery_admin_audit order by server_created_at asc, audit_id asc loop
    n := n + 1;
    computed_hash := encode(
      digest(
        coalesce(prev_hash, '') || '|' ||
        coalesce(rec.actor_user_id::text, '') || '|' ||
        rec.action_type || '|' || rec.entity_type || '|' || coalesce(rec.entity_id::text, '') || '|' ||
        coalesce(rec.before_snapshot::text, '') || '|' || coalesce(rec.after_snapshot::text, '') || '|' ||
        coalesce(rec.reason, '') || '|' || rec.server_created_at::text,
        'sha256'
      ),
      'hex'
    );
    if rec.previous_entry_hash is distinct from prev_hash or rec.entry_hash is distinct from computed_hash then
      return query select false, rec.audit_id, n;
      return;
    end if;
    prev_hash := rec.entry_hash;
  end loop;
  return query select true, null::uuid, n;
end;
$$;
