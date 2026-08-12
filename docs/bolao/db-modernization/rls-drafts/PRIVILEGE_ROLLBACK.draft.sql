-- NOT FOR PRODUCTION APPLY — generated design artefact.
-- GENERATED FILE — do not edit by hand. Source: scripts/db/privilege_model.mjs
-- Rollback to the MEASURED prior effective state — not the inverse of the forward statements.

REVOKE ALL ON public."bolao_state" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_state" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_state" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_state" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_entry_private" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_entry_private" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_notif_jobs" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_notif_jobs" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_notif_jobs" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_notif_jobs" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."live_sports_cache" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."live_sports_cache" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_admin_audit" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_admin_audit" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_admin_audit" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_admin_audit" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_draws" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_draws" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_draws" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_draws" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_participants" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_participants" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_participants" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_participants" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_participations" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_participations" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_participations" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_participations" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_payment_transactions" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_payment_transactions" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_payment_transactions" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_payment_transactions" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_pools" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_pools" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."lottery_pools" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."lottery_pools" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_state_public" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_state_public" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_state_public" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_state_public" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_state_public" FROM "service_role";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_state_public" TO "service_role";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_state_public_cdb" FROM "anon";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_state_public_cdb" TO "anon";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_state_public_cdb" FROM "authenticated";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_state_public_cdb" TO "authenticated";   -- as measured 2026-08-11
REVOKE ALL ON public."bolao_state_public_cdb" FROM "service_role";
GRANT DELETE, INSERT, SELECT, UPDATE ON public."bolao_state_public_cdb" TO "service_role";   -- as measured 2026-08-11
REVOKE ALL ON "bolao"."classification_snapshots" FROM "service_role";
REVOKE ALL ON "bolao"."competition_edition_phases" FROM "service_role";
REVOKE ALL ON "bolao"."competition_edition_standings" FROM "service_role";
REVOKE ALL ON "bolao"."competition_editions" FROM "service_role";
REVOKE ALL ON "bolao"."competitions" FROM "service_role";
REVOKE ALL ON "bolao"."match_results" FROM "service_role";
REVOKE ALL ON "bolao"."matches" FROM "service_role";
REVOKE ALL ON "bolao"."outbox_delivery_attempts" FROM "service_role";
REVOKE ALL ON "bolao"."outbox_events" FROM "service_role";
REVOKE ALL ON "bolao"."participant_identity_links" FROM "service_role";
REVOKE ALL ON "bolao"."participants" FROM "service_role";
REVOKE ALL ON "bolao"."payment_allocations" FROM "service_role";
REVOKE ALL ON "bolao"."payments" FROM "service_role";
REVOKE ALL ON "bolao"."pool_entries" FROM "service_role";
REVOKE ALL ON "bolao"."pool_fee_schedule" FROM "service_role";
REVOKE ALL ON "bolao"."pools" FROM "service_role";
REVOKE ALL ON "bolao"."predictions" FROM "service_role";
REVOKE ALL ON "bolao"."prize_allocations" FROM "service_role";
REVOKE ALL ON "bolao"."ranking_snapshots" FROM "service_role";
REVOKE ALL ON "bolao"."request_idempotency" FROM "service_role";
REVOKE ALL ON "bolao"."sync_state" FROM "service_role";
REVOKE ALL ON "bolao"."ties" FROM "service_role";
