--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260806143644_add_minimal_powerball_schema
--
-- This file was MISSING from the repository while its ledger row existed in production — a recorded
-- version with no file, which `classifyLedgerProvenance()` rejects because it cannot be reviewed,
-- replayed or verified. The body below is not a reconstruction: it is the exact `statements` array
-- recorded in supabase_migrations.schema_migrations for version 20260806143644, read out of
-- production read-only on 2026-08-11 and re-joined on the statement separator.
--
-- It is already applied. Do not re-run it against production; it is here so the repository can
-- replay its own history, which is the whole point of the M0 baseline.
--
do $$ begin
  if not exists (select 1 from pg_type where typname = 'participant_state') then
    create type participant_state as enum ('active', 'cancelled', 'archived');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_txn_type') then
    create type payment_txn_type as enum ('contribution', 'refund', 'adjustment', 'reversal', 'carryover');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lottery_role') then
    create type lottery_role as enum ('owner', 'admin', 'auditor');
  end if;
end $$;

create table if not exists lottery_participants (
  participant_id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email text,
  phone text,
  state participant_state not null default 'active',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  archived_at timestamptz,
  archived_by uuid references auth.users(id)
);

create table if not exists lottery_pools (
  pool_id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'open',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists lottery_draws (
  draw_id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references lottery_pools(pool_id),
  draw_date date not null,
  jackpot_estimate numeric(14,2),
  cash_value_estimate numeric(14,2),
  status text not null default 'scheduled',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists lottery_participations (
  participation_id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references lottery_participants(participant_id),
  pool_id uuid not null references lottery_pools(pool_id),
  draw_id uuid references lottery_draws(draw_id),
  cotas numeric(10,4) not null default 1,
  state text not null default 'active',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists lottery_payment_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  participation_id uuid not null references lottery_participations(participation_id),
  type payment_txn_type not null,
  amount numeric(14,2) not null,
  external_reference text,
  method text,
  provider text,
  paid_at timestamptz,
  memo text,
  source text default 'admin-ui',
  reverses_transaction_id uuid references lottery_payment_transactions(transaction_id),
  reason text,
  proof_object_path text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create unique index if not exists lottery_payment_transactions_external_reference_uidx
  on lottery_payment_transactions (external_reference)
  where external_reference is not null;

create table if not exists lottery_admin_audit (
  audit_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  actor_email_snapshot text,
  actor_role lottery_role,
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text,
  request_id uuid,
  correlation_id uuid,
  source text not null default 'admin-ui',
  server_created_at timestamptz not null default now(),
  client_metadata jsonb,
  previous_entry_hash text,
  entry_hash text not null
);

alter table lottery_participants enable row level security;
alter table lottery_pools enable row level security;
alter table lottery_draws enable row level security;
alter table lottery_participations enable row level security;
alter table lottery_payment_transactions enable row level security;
alter table lottery_admin_audit enable row level security;
