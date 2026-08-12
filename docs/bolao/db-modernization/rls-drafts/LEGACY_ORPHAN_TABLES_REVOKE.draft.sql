-- NOT FOR PRODUCTION APPLY
-- ORPHANED LEGACY TABLES — proposed privilege removal (KPLUS-F036)
-- GENERATED FILE — do not edit by hand. Source: scripts/db/legacy_fence.mjs
-- Regenerate: node scripts/db/legacy_fence.mjs --write
--
-- THIS IS A PROPOSAL, NOT PART OF THE BOLAO CUTOVER. These six tables belong to the Powerball
-- product. Narrowing them is that product's access-model decision and needs its owner's
-- authorization; it is generated here because the exposure was found here.
--
-- WHAT IS EXPOSED: anon holds SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER on all six;
-- authenticated holds those plus TRUNCATE. The tables carry display_name, email, phone, payment
-- amounts and external references. The anon key is in the page source.
--
-- WHY IT IS INERT TODAY: all six have RLS enabled with ZERO policies. That denies everyone who is
-- not owner or BYPASSRLS — but the grant is real, and one added policy or one DISABLE ROW LEVEL
-- SECURITY makes it live. TRIGGER additionally lets a principal attach code to a table it does
-- not own.
--
-- WHY THIS IS SAFE TO APPLY: no application code references these tables (the Powerball app is
-- static and holds no database client), and production statistics show zero UPDATE and zero
-- DELETE ever, with the tables never autovacuumed. They were written once and left.
--
-- WHAT WOULD BREAK IF THAT IS WRONG: any browser-role read or write of Powerball data. The
-- rollback below restores every privilege this removes, and RLS already denies all of it, so the
-- observable blast radius of being wrong is a permission error rather than data loss.
--
-- Privileges are NAMED, not REVOKE ALL, so the statement says exactly what it removes.

-- public.lottery_admin_audit
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_admin_audit FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_admin_audit FROM authenticated;
-- public.lottery_draws
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_draws FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_draws FROM authenticated;
-- public.lottery_participants
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_participants FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_participants FROM authenticated;
-- public.lottery_participations
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_participations FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_participations FROM authenticated;
-- public.lottery_payment_transactions
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_payment_transactions FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_payment_transactions FROM authenticated;
-- public.lottery_pools
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_pools FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lottery_pools FROM authenticated;
