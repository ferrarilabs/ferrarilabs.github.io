-- NOT FOR PRODUCTION APPLY
-- ORPHANED LEGACY TABLES — ROLLBACK of the proposed privilege removal (KPLUS-F036)
-- GENERATED FILE — do not edit by hand. Source: scripts/db/legacy_fence.mjs
--
-- Generated from the privilege state MEASURED before the revocation, so it restores what was there
-- and not what the revocation happened to name. KPLUS-F042: anon does not hold TRUNCATE on these
-- tables and authenticated does, so a rollback built from the revocation's own list would have
-- granted anon a privilege it never had.

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.lottery_admin_audit TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_admin_audit TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.lottery_draws TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_draws TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.lottery_participants TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.lottery_participations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_participations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.lottery_payment_transactions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_payment_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.lottery_pools TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_pools TO authenticated;
