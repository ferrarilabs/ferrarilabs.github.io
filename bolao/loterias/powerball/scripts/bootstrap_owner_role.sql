-- Powerball Admin — owner bootstrap (PROPOSAL ONLY, NOT EXECUTED ANYWHERE)
-- Run ONCE by a human with direct SQL access to the target Supabase project, AFTER the
-- target user has already signed up via Supabase Auth (so auth.users has a row for them).
-- This is intentionally NOT a frontend file and NOT callable from the browser — the first
-- owner role cannot be self-granted through the app, by design (see POWERBALL_ADMIN_SECURITY.md
-- section "Bootstrap problem").
--
-- Usage:
--   1. Have emferrari@gmail.com sign up / be invited through Supabase Auth on the target
--      project so a row exists in auth.users.
--   2. Connect with an account that has direct SQL access (Supabase SQL editor, or psql with
--      the project's connection string — never with the anon key).
--   3. Run this script, substituting the email below if bootstrapping a different first owner.
--   4. Verify with the SELECT at the bottom.
--
-- This script is idempotent (safe to re-run) and does not touch any other table.

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = 'emferrari@gmail.com';
  if v_user_id is null then
    raise exception 'No auth.users row for emferrari@gmail.com yet — they must sign up / be invited via Supabase Auth first.';
  end if;

  insert into lottery_admin_roles (user_id, email_snapshot, role, is_active, created_by)
  values (v_user_id, 'emferrari@gmail.com', 'owner', true, v_user_id)
  on conflict (user_id, role) do update set is_active = true, revoked_at = null, revoked_by = null;
end $$;

-- Verification:
select role_id, user_id, email_snapshot, role, is_active, created_at
from lottery_admin_roles
where email_snapshot = 'emferrari@gmail.com';
