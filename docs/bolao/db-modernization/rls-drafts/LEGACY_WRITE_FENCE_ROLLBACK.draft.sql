-- NOT FOR PRODUCTION APPLY
-- LEGACY WRITE FENCE — ROLLBACK (WS5-F4)
-- GENERATED FILE — do not edit by hand. Source: scripts/db/legacy_fence.mjs
--
-- Reopens the direct browser write path. This is the documented reversal of step 11 and it is
-- one statement per (table, role) — the same pairs the fence closed, and no others.
--
-- Reversing the fence does NOT reverse the cutover. Writes that the replacement path accepted
-- while the fence was closed are in the target schema; reopening the legacy path means both
-- representations take writes again, which is the state the parity harness measures and the
-- state the fence exists to end. Reopen to restore service, then close again deliberately.

GRANT INSERT, UPDATE, DELETE ON TABLE public.bolao_state TO anon;
GRANT INSERT, UPDATE, DELETE ON TABLE public.bolao_state TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.bolao_state_public TO anon;
GRANT INSERT, UPDATE, DELETE ON TABLE public.bolao_state_public TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.bolao_state_public_cdb TO anon;
GRANT INSERT, UPDATE, DELETE ON TABLE public.bolao_state_public_cdb TO authenticated;
