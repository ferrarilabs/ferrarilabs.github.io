-- Powerball Admin — RLS migration (PROPOSAL ONLY, NOT APPLIED TO PRODUCTION)
-- Deny-by-default on every table. No policy = no access under RLS.

alter table lottery_admin_roles enable row level security;
alter table lottery_participants enable row level security;
alter table lottery_pools enable row level security;
alter table lottery_draws enable row level security;
alter table lottery_participations enable row level security;
alter table lottery_payment_transactions enable row level security;
alter table lottery_tickets enable row level security;
alter table lottery_ticket_publications enable row level security;
alter table lottery_ticket_publication_items enable row level security;
alter table lottery_results enable row level security;
alter table lottery_email_jobs enable row level security;
alter table lottery_email_deliveries enable row level security;
alter table lottery_admin_audit enable row level security;

-- Helper: current user's active role, or null.
create or replace function lottery_current_role() returns lottery_role
language sql stable security definer set search_path = public as $$
  select role from lottery_admin_roles
  where user_id = auth.uid() and is_active = true
  order by case role when 'owner' then 1 when 'admin' then 2 else 3 end
  limit 1;
$$;

-- lottery_admin_roles: only owner can read/manage; users can see nothing else about roles.
create policy roles_owner_all on lottery_admin_roles
  for all using (lottery_current_role() = 'owner') with check (lottery_current_role() = 'owner');

-- Internal tables: admin+owner read/write via RPC only (RLS still required as defense in depth;
-- direct table INSERT/UPDATE from anon/authenticated role is not granted — only RPCs, which run
-- as SECURITY DEFINER, bypass RLS deliberately and re-check role themselves).
create policy participants_admin_read on lottery_participants
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy pools_admin_read on lottery_pools
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy draws_admin_read on lottery_draws
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy participations_admin_read on lottery_participations
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy payments_admin_read on lottery_payment_transactions
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy tickets_admin_read on lottery_tickets
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy publications_admin_read on lottery_ticket_publications
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy publication_items_admin_read on lottery_ticket_publication_items
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy results_admin_read on lottery_results
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy email_jobs_admin_read on lottery_email_jobs
  for select using (lottery_current_role() in ('owner','admin','auditor'));

create policy email_deliveries_admin_read on lottery_email_deliveries
  for select using (lottery_current_role() in ('owner','admin','auditor'));

-- Audit log: owner+admin+auditor can read (auditor is read-only everywhere, which is already
-- true here since there is no write policy at all for the audit table — writes only happen via
-- the SECURITY DEFINER RPCs' internal audit-insert helper).
create policy audit_read on lottery_admin_audit
  for select using (lottery_current_role() in ('owner','admin','auditor'));

-- No INSERT/UPDATE/DELETE policies are defined for authenticated/anon on any table above.
-- Deny-by-default: absence of a policy for a command means that command is rejected under RLS.
-- All writes happen exclusively through SECURITY DEFINER RPCs defined in 003_rpcs.sql, which
-- run with elevated privilege specifically to perform the write, but which re-verify auth.uid()
-- and role internally before doing so (see POWERBALL_ADMIN_SECURITY.md).

-- Public projection view — safe subset only, no PII/financial internals.
-- NOTE: does not yet include published-ticket-number/result rows — those are added once the
-- publication manifest shape is finalized against real fixture data (see
-- POWERBALL_ADMIN_ARCHITECTURE.md open items). This view intentionally starts minimal rather
-- than guessing at a join that hasn't been validated.
create or replace view lottery_public_projection as
select
  d.draw_id,
  d.draw_date,
  d.jackpot_estimate,
  d.cash_value_estimate,
  count(distinct pt.participant_id) filter (where pa.state = 'active') as active_participant_count,
  sum(pa.cotas) filter (where pa.state = 'active') as total_cotas
from lottery_draws d
left join lottery_participations pa on pa.draw_id = d.draw_id
left join lottery_participants pt on pt.participant_id = pa.participant_id
group by d.draw_id, d.draw_date, d.jackpot_estimate, d.cash_value_estimate;

comment on view lottery_public_projection is
  'Public-safe projection: never exposes email, transaction_id, internal notes, or audit data.
   Grant select to anon; no other table/view should be granted to anon.';

grant select on lottery_public_projection to anon;
