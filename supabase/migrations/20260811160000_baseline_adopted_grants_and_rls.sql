--
-- PROVENANCE: BASELINE_ADOPTED_AT_CURRENT_STATE
--
-- BASELINE — views, row-level-security enablement, and the measured grant set
--
-- This file is ADOPTED, not EXECUTED. It is recorded in supabase_migrations.schema_migrations
-- via `supabase migration repair --status applied`, which inserts a ledger row and runs no SQL.
-- The objects it declares ALREADY EXIST in production; running it against production would
-- attempt to re-create them. Never `supabase db push` this file at production.
--
-- The 2 views, RLS enablement on the tables the tracked migration did not itself enable, and every ACL and default privilege measured on schema public. Ordered after 20260806143644 because it grants on objects that row creates.
--
-- Derived mechanically by autonomous-campaign/q6_derive_baseline.mjs from the validated
-- pre-migration schema dump (backup set production-pre-migration-20260811-151516), whose surface
-- fingerprint was re-confirmed against production before derivation. The router is fail-closed:
-- every object block in the dump is routed to exactly one destination or the derivation aborts.
--
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: bolao_state_public; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."bolao_state_public" AS
 SELECT "id",
        CASE
            WHEN ("state" ? 'entries'::"text") THEN "jsonb_set"("state", '{entries}'::"text"[], COALESCE(( SELECT "jsonb_agg"((((("t"."e" - 'participantEmail'::"text") - 'payerName'::"text") - 'paymentMethod'::"text") - 'paymentTo'::"text") ORDER BY "t"."ord") AS "jsonb_agg"
               FROM "jsonb_array_elements"(("s"."state" -> 'entries'::"text")) WITH ORDINALITY "t"("e", "ord")), '[]'::"jsonb"))
            ELSE "state"
        END AS "state",
    "updated_at"
   FROM "public"."bolao_state" "s";

--
-- Name: bolao_state_public_cdb; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."bolao_state_public_cdb" AS
 SELECT "id",
    "jsonb_set"("state", '{entries}'::"text"[], COALESCE(( SELECT "jsonb_agg"((((("t"."e" - 'participantEmail'::"text") - 'payerName'::"text") - 'paymentMethod'::"text") - 'txId'::"text") ORDER BY "t"."ord") AS "jsonb_agg"
           FROM "jsonb_array_elements"(COALESCE(("s"."state" -> 'entries'::"text"), '[]'::"jsonb")) WITH ORDINALITY "t"("e", "ord")), '[]'::"jsonb")) AS "state"
   FROM "public"."bolao_state" "s"
  WHERE ("id" = 'cdb2026'::"text");

--
-- Name: bolao_entry_private; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."bolao_entry_private" ENABLE ROW LEVEL SECURITY;

--
-- Name: bolao_notif_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."bolao_notif_jobs" ENABLE ROW LEVEL SECURITY;

--
-- Name: bolao_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."bolao_state" ENABLE ROW LEVEL SECURITY;

--
-- Name: live_sports_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."live_sports_cache" ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

--
-- Name: FUNCTION "_bolao_audit"("p_state" "jsonb", "p_action" "text", "p_detail" "jsonb"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."_bolao_audit"("p_state" "jsonb", "p_action" "text", "p_detail" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_bolao_audit"("p_state" "jsonb", "p_action" "text", "p_detail" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_bolao_audit"("p_state" "jsonb", "p_action" "text", "p_detail" "jsonb") TO "service_role";

--
-- Name: FUNCTION "_bolao_touch"("p_state" "jsonb"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."_bolao_touch"("p_state" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_bolao_touch"("p_state" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_bolao_touch"("p_state" "jsonb") TO "service_role";

--
-- Name: FUNCTION "bolao_notif_health"("p_pool_id" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."bolao_notif_health"("p_pool_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bolao_notif_health"("p_pool_id" "text") TO "service_role";

--
-- Name: FUNCTION "bolao_notif_status_by_pool"("p_pool_id" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."bolao_notif_status_by_pool"("p_pool_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bolao_notif_status_by_pool"("p_pool_id" "text") TO "service_role";

--
-- Name: FUNCTION "cdb_apply_operator_mutation"("p_type" "text", "p_payload" "jsonb", "p_actor" "text", "p_client_ref" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."cdb_apply_operator_mutation"("p_type" "text", "p_payload" "jsonb", "p_actor" "text", "p_client_ref" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cdb_apply_operator_mutation"("p_type" "text", "p_payload" "jsonb", "p_actor" "text", "p_client_ref" "text") TO "service_role";

--
-- Name: FUNCTION "cdb_update_entry_picks"("p_entry_id" "text", "p_client_ref" "text", "p_picks" "jsonb"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."cdb_update_entry_picks"("p_entry_id" "text", "p_client_ref" "text", "p_picks" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cdb_update_entry_picks"("p_entry_id" "text", "p_client_ref" "text", "p_picks" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."cdb_update_entry_picks"("p_entry_id" "text", "p_client_ref" "text", "p_picks" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cdb_update_entry_picks"("p_entry_id" "text", "p_client_ref" "text", "p_picks" "jsonb") TO "service_role";

--
-- Name: FUNCTION "claim_bolao_notif"("p_pool_id" "text", "p_worker" "text", "p_limit" integer, "p_lease_seconds" integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."claim_bolao_notif"("p_pool_id" "text", "p_worker" "text", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_bolao_notif"("p_pool_id" "text", "p_worker" "text", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";

--
-- Name: FUNCTION "delete_canary_job"("p_idempotency_key" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."delete_canary_job"("p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_canary_job"("p_idempotency_key" "text") TO "service_role";

--
-- Name: FUNCTION "enqueue_bolao_notif"("p_pool_id" "text", "p_entity_id" "text", "p_event_type" "text", "p_event_version" integer, "p_entry_ref" "text", "p_idempotency_key" "text", "p_payload" "jsonb", "p_template_id" "text", "p_template_version" integer, "p_max_attempts" integer, "p_schema_version" integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."enqueue_bolao_notif"("p_pool_id" "text", "p_entity_id" "text", "p_event_type" "text", "p_event_version" integer, "p_entry_ref" "text", "p_idempotency_key" "text", "p_payload" "jsonb", "p_template_id" "text", "p_template_version" integer, "p_max_attempts" integer, "p_schema_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_bolao_notif"("p_pool_id" "text", "p_entity_id" "text", "p_event_type" "text", "p_event_version" integer, "p_entry_ref" "text", "p_idempotency_key" "text", "p_payload" "jsonb", "p_template_id" "text", "p_template_version" integer, "p_max_attempts" integer, "p_schema_version" integer) TO "service_role";

--
-- Name: FUNCTION "get_bolao_notif_content_hash"("p_idempotency_key" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."get_bolao_notif_content_hash"("p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bolao_notif_content_hash"("p_idempotency_key" "text") TO "service_role";

--
-- Name: FUNCTION "get_bolao_notif_manual_flag"("p_idempotency_key" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."get_bolao_notif_manual_flag"("p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bolao_notif_manual_flag"("p_idempotency_key" "text") TO "service_role";

--
-- Name: FUNCTION "get_bolao_notif_recipients"("p_idempotency_key" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."get_bolao_notif_recipients"("p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bolao_notif_recipients"("p_idempotency_key" "text") TO "service_role";

--
-- Name: FUNCTION "mark_bolao_notif_permanent"("p_job_id" "uuid", "p_error" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."mark_bolao_notif_permanent"("p_job_id" "uuid", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_bolao_notif_permanent"("p_job_id" "uuid", "p_error" "text") TO "service_role";

--
-- Name: FUNCTION "mark_bolao_notif_retryable"("p_job_id" "uuid", "p_error" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."mark_bolao_notif_retryable"("p_job_id" "uuid", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_bolao_notif_retryable"("p_job_id" "uuid", "p_error" "text") TO "service_role";

--
-- Name: FUNCTION "mark_bolao_notif_sent"("p_job_id" "uuid", "p_provider_message_id" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."mark_bolao_notif_sent"("p_job_id" "uuid", "p_provider_message_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_bolao_notif_sent"("p_job_id" "uuid", "p_provider_message_id" "text") TO "service_role";

--
-- Name: FUNCTION "op_confirm_payment"("p_pool_id" "text", "p_entry_ref" "text", "p_paid" boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."op_confirm_payment"("p_pool_id" "text", "p_entry_ref" "text", "p_paid" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."op_confirm_payment"("p_pool_id" "text", "p_entry_ref" "text", "p_paid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."op_confirm_payment"("p_pool_id" "text", "p_entry_ref" "text", "p_paid" boolean) TO "service_role";

--
-- Name: FUNCTION "op_remove_entry"("p_pool_id" "text", "p_entry_ref" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."op_remove_entry"("p_pool_id" "text", "p_entry_ref" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."op_remove_entry"("p_pool_id" "text", "p_entry_ref" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."op_remove_entry"("p_pool_id" "text", "p_entry_ref" "text") TO "service_role";

--
-- Name: FUNCTION "op_set_phases"("p_pool_id" "text", "p_phases" "jsonb"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."op_set_phases"("p_pool_id" "text", "p_phases" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."op_set_phases"("p_pool_id" "text", "p_phases" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."op_set_phases"("p_pool_id" "text", "p_phases" "jsonb") TO "service_role";

--
-- Name: FUNCTION "op_set_results"("p_pool_id" "text", "p_results" "jsonb"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."op_set_results"("p_pool_id" "text", "p_results" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."op_set_results"("p_pool_id" "text", "p_results" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."op_set_results"("p_pool_id" "text", "p_results" "jsonb") TO "service_role";

--
-- Name: FUNCTION "op_set_round_email"("p_pool_id" "text", "p_round_email" "jsonb"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."op_set_round_email"("p_pool_id" "text", "p_round_email" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."op_set_round_email"("p_pool_id" "text", "p_round_email" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."op_set_round_email"("p_pool_id" "text", "p_round_email" "jsonb") TO "service_role";

--
-- Name: FUNCTION "op_update_entry"("p_pool_id" "text", "p_entry_ref" "text", "p_entry_name" "text", "p_participant_email" "text", "p_payer_name" "text", "p_payment_method" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."op_update_entry"("p_pool_id" "text", "p_entry_ref" "text", "p_entry_name" "text", "p_participant_email" "text", "p_payer_name" "text", "p_payment_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."op_update_entry"("p_pool_id" "text", "p_entry_ref" "text", "p_entry_name" "text", "p_participant_email" "text", "p_payer_name" "text", "p_payment_method" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."op_update_entry"("p_pool_id" "text", "p_entry_ref" "text", "p_entry_name" "text", "p_participant_email" "text", "p_payer_name" "text", "p_payment_method" "text") TO "service_role";

--
-- Name: FUNCTION "release_expired_bolao_notif"("p_pool_id" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."release_expired_bolao_notif"("p_pool_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_expired_bolao_notif"("p_pool_id" "text") TO "service_role";

--
-- Name: FUNCTION "resolve_notification_recipients"("p_pool_id" "text", "p_entry_refs" "text"[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."resolve_notification_recipients"("p_pool_id" "text", "p_entry_refs" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_notification_recipients"("p_pool_id" "text", "p_entry_refs" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_notification_recipients"("p_pool_id" "text", "p_entry_refs" "text"[]) TO "service_role";

--
-- Name: FUNCTION "rls_auto_enable"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";

--
-- Name: FUNCTION "set_bolao_notif_recipient"("p_idempotency_key" "text", "p_entry_ref" "text", "p_state" "text", "p_provider_message_id" "text", "p_error" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."set_bolao_notif_recipient"("p_idempotency_key" "text", "p_entry_ref" "text", "p_state" "text", "p_provider_message_id" "text", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_bolao_notif_recipient"("p_idempotency_key" "text", "p_entry_ref" "text", "p_state" "text", "p_provider_message_id" "text", "p_error" "text") TO "service_role";

--
-- Name: FUNCTION "settle_bolao_notif"("p_idempotency_key" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."settle_bolao_notif"("p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_bolao_notif"("p_idempotency_key" "text") TO "service_role";

--
-- Name: FUNCTION "submit_entry"("p_pool_id" "text", "p_entry_name" "text", "p_participant_email" "text", "p_picks" "jsonb", "p_payer_name" "text", "p_payment_method" "text", "p_client_ref" "text"); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."submit_entry"("p_pool_id" "text", "p_entry_name" "text", "p_participant_email" "text", "p_picks" "jsonb", "p_payer_name" "text", "p_payment_method" "text", "p_client_ref" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_entry"("p_pool_id" "text", "p_entry_name" "text", "p_participant_email" "text", "p_picks" "jsonb", "p_payer_name" "text", "p_payment_method" "text", "p_client_ref" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_entry"("p_pool_id" "text", "p_entry_name" "text", "p_participant_email" "text", "p_picks" "jsonb", "p_payer_name" "text", "p_payment_method" "text", "p_client_ref" "text") TO "service_role";

--
-- Name: TABLE "bolao_entry_private"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bolao_entry_private" TO "authenticated";
GRANT ALL ON TABLE "public"."bolao_entry_private" TO "service_role";

--
-- Name: TABLE "bolao_notif_jobs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bolao_notif_jobs" TO "anon";
GRANT ALL ON TABLE "public"."bolao_notif_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."bolao_notif_jobs" TO "service_role";

--
-- Name: TABLE "bolao_state"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."bolao_state" TO "anon";
GRANT ALL ON TABLE "public"."bolao_state" TO "authenticated";
GRANT ALL ON TABLE "public"."bolao_state" TO "service_role";

--
-- Name: TABLE "bolao_state_public"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bolao_state_public" TO "anon";
GRANT ALL ON TABLE "public"."bolao_state_public" TO "authenticated";
GRANT ALL ON TABLE "public"."bolao_state_public" TO "service_role";

--
-- Name: TABLE "bolao_state_public_cdb"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bolao_state_public_cdb" TO "anon";
GRANT ALL ON TABLE "public"."bolao_state_public_cdb" TO "authenticated";
GRANT ALL ON TABLE "public"."bolao_state_public_cdb" TO "service_role";

--
-- Name: TABLE "live_sports_cache"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."live_sports_cache" TO "anon";
GRANT ALL ON TABLE "public"."live_sports_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."live_sports_cache" TO "service_role";

--
-- Name: TABLE "lottery_admin_audit"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_admin_audit" TO "anon";
GRANT ALL ON TABLE "public"."lottery_admin_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_admin_audit" TO "service_role";

--
-- Name: TABLE "lottery_draws"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_draws" TO "anon";
GRANT ALL ON TABLE "public"."lottery_draws" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_draws" TO "service_role";

--
-- Name: TABLE "lottery_participants"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_participants" TO "anon";
GRANT ALL ON TABLE "public"."lottery_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_participants" TO "service_role";

--
-- Name: TABLE "lottery_participations"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_participations" TO "anon";
GRANT ALL ON TABLE "public"."lottery_participations" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_participations" TO "service_role";

--
-- Name: TABLE "lottery_payment_transactions"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_payment_transactions" TO "anon";
GRANT ALL ON TABLE "public"."lottery_payment_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_payment_transactions" TO "service_role";

--
-- Name: TABLE "lottery_pools"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_pools" TO "anon";
GRANT ALL ON TABLE "public"."lottery_pools" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_pools" TO "service_role";

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- PostgreSQL database dump complete
--
