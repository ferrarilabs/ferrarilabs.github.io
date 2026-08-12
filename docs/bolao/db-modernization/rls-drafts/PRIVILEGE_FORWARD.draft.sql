-- NOT FOR PRODUCTION APPLY — generated design artefact.
-- GENERATED FILE — do not edit by hand. Source: scripts/db/privilege_model.mjs
-- Existing-object privilege reconciliation. Statements are derived from the MEASURED current
-- state, so a row nobody measured produces no statement — see UNKNOWN_BLOCKING.

-- 36 (relation, role) pair(s) are UNKNOWN_BLOCKING and are deliberately absent below:
--   · bolao_state / anon (TABLE)
--   · bolao_state / authenticated (TABLE)
--   · bolao_state / service_role (TABLE)
--   · bolao_entry_private / anon (TABLE)
--   · bolao_entry_private / authenticated (TABLE)
--   · bolao_entry_private / service_role (TABLE)
--   · bolao_notif_jobs / anon (TABLE)
--   · bolao_notif_jobs / authenticated (TABLE)
--   · bolao_notif_jobs / service_role (TABLE)
--   · live_sports_cache / anon (TABLE)
--   · live_sports_cache / authenticated (TABLE)
--   · live_sports_cache / service_role (TABLE)
--   · lottery_admin_audit / anon (TABLE)
--   · lottery_admin_audit / authenticated (TABLE)
--   · lottery_admin_audit / service_role (TABLE)
--   · lottery_draws / anon (TABLE)
--   · lottery_draws / authenticated (TABLE)
--   · lottery_draws / service_role (TABLE)
--   · lottery_participants / anon (TABLE)
--   · lottery_participants / authenticated (TABLE)
--   · lottery_participants / service_role (TABLE)
--   · lottery_participations / anon (TABLE)
--   · lottery_participations / authenticated (TABLE)
--   · lottery_participations / service_role (TABLE)
--   · lottery_payment_transactions / anon (TABLE)
--   · lottery_payment_transactions / authenticated (TABLE)
--   · lottery_payment_transactions / service_role (TABLE)
--   · lottery_pools / anon (TABLE)
--   · lottery_pools / authenticated (TABLE)
--   · lottery_pools / service_role (TABLE)
--   · bolao_state_public / anon (VIEW)
--   · bolao_state_public / authenticated (VIEW)
--   · bolao_state_public / service_role (VIEW)
--   · bolao_state_public_cdb / anon (VIEW)
--   · bolao_state_public_cdb / authenticated (VIEW)
--   · bolao_state_public_cdb / service_role (VIEW)
-- Generating a REVOKE for an unmeasured privilege would make the rollback unable to restore it.

REVOKE DELETE, INSERT, UPDATE ON public."bolao_state" FROM "anon";   -- EXPECTED_REVOKE
REVOKE DELETE, INSERT, UPDATE ON public."bolao_state" FROM "authenticated";   -- EXPECTED_REVOKE
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."bolao_entry_private" FROM "authenticated";   -- EXPECTED_REVOKE
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."bolao_notif_jobs" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."bolao_notif_jobs" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."live_sports_cache" FROM "authenticated";   -- EXPECTED_REVOKE
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_admin_audit" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_admin_audit" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_draws" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_draws" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_participants" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_participants" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_participations" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_participations" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_payment_transactions" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_payment_transactions" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_pools" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, SELECT, UPDATE ON public."lottery_pools" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, UPDATE ON public."bolao_state_public" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, UPDATE ON public."bolao_state_public" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, UPDATE ON public."bolao_state_public" FROM "service_role";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, UPDATE ON public."bolao_state_public_cdb" FROM "anon";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, UPDATE ON public."bolao_state_public_cdb" FROM "authenticated";   -- PLATFORM_DEFAULT
REVOKE DELETE, INSERT, UPDATE ON public."bolao_state_public_cdb" FROM "service_role";   -- PLATFORM_DEFAULT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."classification_snapshots" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."competition_edition_phases" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."competition_edition_standings" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."competition_editions" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."competitions" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."match_results" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."matches" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."outbox_delivery_attempts" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."outbox_events" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."participant_identity_links" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."participants" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."payment_allocations" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."payments" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."pool_entries" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."pool_fee_schedule" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."pools" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."predictions" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."prize_allocations" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."ranking_snapshots" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."request_idempotency" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."sync_state" TO "service_role";   -- EXPECTED_GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON "bolao"."ties" TO "service_role";   -- EXPECTED_GRANT
