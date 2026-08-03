-- PROPOSAL ONLY — never executed. Requires a local Supabase/pgTAP stack (see README.md).
-- Scenario #2-4 from README.md: anon should not be able to alter official results, payment
-- status, or cutoff via a well-formed UPDATE to the shared JSON document.
--
-- KNOWN TO FAIL against the RLS policy as currently documented in
-- bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md — this test exists to make that gap visible
-- and regression-testable once ADR-006's short-term hardening (RPC-gated writes, or a stricter
-- WITH CHECK) is implemented. Do not "fix" this test by weakening the assertion — fix the policy.

begin;
select plan(2);

set local role anon;

-- Attempt to flip a payment flag for an entry the caller does not own, by upserting a modified
-- copy of the whole document (this mirrors what a raw HTTP client, not the app's own app.js,
-- could send).
select throws_ok(
  $$
    update public.bolao_state
    set state = jsonb_set(state, '{paid,some-other-entry-id}', 'true'::jsonb)
    where id = 'main'
  $$,
  null,
  null,
  'anon should be rejected (or at minimum have this field-level change reverted server-side) ' ||
  'when writing to state.paid for an entry it does not own -- currently NOT enforced by RLS, ' ||
  'see docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md'
);

select throws_ok(
  $$
    update public.bolao_state
    set state = jsonb_set(state, '{results,73}', '{"goalsA":9,"goalsB":0}'::jsonb)
    where id = 'main'
  $$,
  null,
  null,
  'anon should be rejected when writing to state.results -- currently NOT enforced by RLS'
);

select * from finish();
rollback;
