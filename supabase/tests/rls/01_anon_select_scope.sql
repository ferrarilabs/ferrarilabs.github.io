-- PROPOSAL ONLY — never executed. Requires a local Supabase/pgTAP stack (see README.md).
-- Scenario #1 from README.md: anon can select only the 3 known competition rows.
--
-- Intended usage: `supabase test db` (pgTAP). Written to document the expected assertion shape
-- for when this repo adopts a local Supabase testing stack — not runnable today.

begin;
select plan(3);

-- Assumes a seed fixture inserts rows for id in ('main','br2026','cdb2026') plus one
-- out-of-scope row, e.g. id = 'other-app', that anon must NOT be able to read.
set local role anon;

select results_eq(
  $$ select id from public.bolao_state where id = 'main' $$,
  $$ values ('main'::text) $$,
  'anon can read the main (Copa) row'
);

select results_eq(
  $$ select id from public.bolao_state where id = 'other-app' $$,
  $$ select ''::text where false $$,
  'anon cannot read a row outside the 3 known ids'
);

select is(
  (select count(*) from public.bolao_state),
  3::bigint,
  'anon sees exactly 3 rows with an unfiltered select — matches the documented policy ' ||
  '(and matches the empirical production test in docs/bolao/security/SUPABASE_SECURITY_REVIEW.md)'
);

select * from finish();
rollback;
