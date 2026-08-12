-- =====================================================================
-- BASELINE — CURRENT PRODUCTION STATE (schema public)
-- =====================================================================
-- STATUS: REFERENCE ARTEFACT. NOT A MIGRATION. NOT EXECUTABLE AS COMMITTED.
--         NOT APPLIED. NOT IN LEDGER.
--
-- DELIBERATELY NOT NAMED `<timestamp>_<name>.sql`:
--   The Supabase CLI treats only files matching `<14-digit-timestamp>_<name>.sql`
--   as migrations. This filename does NOT match, so the CLI cannot pick it up and
--   `supabase db push` cannot apply it by accident. That is the intended property.
--
--   An earlier draft of this file was named `20260806143644_baseline_...` — which
--   was a DEFECT: 20260806143644 is the version of the ALREADY-APPLIED migration
--   `add_minimal_powerball_schema` (the ledger's only row, and its PRIMARY KEY).
--   Reusing it would (a) collide on the ledger PK and (b) falsely assert that this
--   baseline *is* that migration. It is not: this baseline is a SUPERSET that
--   includes that migration's effects PLUS bolao_state, rls_auto_enable and
--   ensure_rls, none of which that migration created.
--
-- Purpose: make production's schema reproducible from version control.
-- Describes production EXACTLY AS IT IS at the capture date, including its
-- defects. This is a baseline, not a remediation.
--
-- Provenance
--   captured_at_utc       : 2026-08-07T22:56:29Z
--   server                : PostgreSQL 17.6
--   pg_dump client        : 18.4
--   project               : <KNOWN_PROJECT_REF> (masked)
--   sanitized capture SHA : aada07b4cb6166db140d3c8bf3354fb2b66a8fe28183f32b241d45bb6fb998ce
--   reconciliation        : docs/bolao/db-modernization/DDL_BASELINE_AND_R03_RESOLUTION.md
--
-- WHY IT IS NOT EXECUTABLE AS COMMITTED
--   Six legacy RLS policies on public.bolao_state embed three literal row
--   identifiers. Per operator restriction, privately captured literals are NOT
--   substituted into a Git-tracked file. They appear as psql variables:
--       :'policy_literal_1'  :'policy_literal_2'  :'policy_literal_3'
--   Substitution is DEPLOYMENT-TIME ONLY. See DEPLOYMENT.md in this directory.
--
-- ORDERING PROBLEM THIS FILE CANNOT SOLVE ALONE (see T3 analysis)
--   This baseline recreates objects that migration 20260806143644 also creates.
--   Replaying both against an empty database would double-create. Resolving that
--   is the substance of T3, and the recommended mechanism is `supabase db pull`
--   baseline adoption — NOT a hand-written ledger insert.
--   See docs/bolao/db-modernization/T3_LEDGER_ADOPTION_ANALYSIS.md
--   Classification: all three = IDENTIFIER, already public in tracked repo
--   content. None is a SECRET, PII, payment reference, or credential.
--   See PRIVATE_LITERALS.md.
--
-- DELIBERATELY PRESERVED (do not "tidy" — see reconciliation doc)
--   * wide anon / authenticated / service_role grants  (remediation = LATER migration)
--   * 6 duplicate-generation RLS policies             (T-23)
--   * absence of the 3 declared audit triggers        (R-04 — production has none)
--   * absence of FK indexes                           (T-25)
--
-- RESTORED EXPLICITLY BELOW because pg_dump --schema=public OMITS IT
--   * event trigger `ensure_rls` (global, not schema-scoped) — R-08
--
-- NOT INCLUDED by design: roles, database-level ACL, provider schemas
--   (auth/storage/realtime/vault/...), vault secrets, participant data.
-- =====================================================================

--
-- PostgreSQL database dump
--

\restrict KK9ujODNr74XdetkDydtRf5TFPVu0VujSboeEBteCHhfU7m5GYS42gwb92qQP0o

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: lottery_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."lottery_role" AS ENUM (
    'owner',
    'admin',
    'auditor'
);


ALTER TYPE "public"."lottery_role" OWNER TO "postgres";

--
-- Name: participant_state; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."participant_state" AS ENUM (
    'active',
    'cancelled',
    'archived'
);


ALTER TYPE "public"."participant_state" OWNER TO "postgres";

--
-- Name: payment_txn_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."payment_txn_type" AS ENUM (
    'contribution',
    'refund',
    'adjustment',
    'reversal',
    'carryover'
);


ALTER TYPE "public"."payment_txn_type" OWNER TO "postgres";

--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_table_access_method = "heap";

--
-- Name: bolao_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."bolao_state" (
    "id" "text" NOT NULL,
    "state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bolao_state" OWNER TO "postgres";

--
-- Name: lottery_admin_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."lottery_admin_audit" (
    "audit_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_user_id" "uuid",
    "actor_email_snapshot" "text",
    "actor_role" "public"."lottery_role",
    "action_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "before_snapshot" "jsonb",
    "after_snapshot" "jsonb",
    "reason" "text",
    "request_id" "uuid",
    "correlation_id" "uuid",
    "source" "text" DEFAULT 'admin-ui'::"text" NOT NULL,
    "server_created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_metadata" "jsonb",
    "previous_entry_hash" "text",
    "entry_hash" "text" NOT NULL
);


ALTER TABLE "public"."lottery_admin_audit" OWNER TO "postgres";

--
-- Name: lottery_draws; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."lottery_draws" (
    "draw_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pool_id" "uuid" NOT NULL,
    "draw_date" "date" NOT NULL,
    "jackpot_estimate" numeric(14,2),
    "cash_value_estimate" numeric(14,2),
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."lottery_draws" OWNER TO "postgres";

--
-- Name: lottery_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."lottery_participants" (
    "participant_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "display_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "state" "public"."participant_state" DEFAULT 'active'::"public"."participant_state" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "archived_at" timestamp with time zone,
    "archived_by" "uuid"
);


ALTER TABLE "public"."lottery_participants" OWNER TO "postgres";

--
-- Name: lottery_participations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."lottery_participations" (
    "participation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "pool_id" "uuid" NOT NULL,
    "draw_id" "uuid",
    "cotas" numeric(10,4) DEFAULT 1 NOT NULL,
    "state" "text" DEFAULT 'active'::"text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."lottery_participations" OWNER TO "postgres";

--
-- Name: lottery_payment_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."lottery_payment_transactions" (
    "transaction_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participation_id" "uuid" NOT NULL,
    "type" "public"."payment_txn_type" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "external_reference" "text",
    "method" "text",
    "provider" "text",
    "paid_at" timestamp with time zone,
    "memo" "text",
    "source" "text" DEFAULT 'admin-ui'::"text",
    "reverses_transaction_id" "uuid",
    "reason" "text",
    "proof_object_path" "text",
    "imported_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."lottery_payment_transactions" OWNER TO "postgres";

--
-- Name: lottery_pools; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."lottery_pools" (
    "pool_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."lottery_pools" OWNER TO "postgres";

--
-- Name: bolao_state bolao_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bolao_state"
    ADD CONSTRAINT "bolao_state_pkey" PRIMARY KEY ("id");


--
-- Name: lottery_admin_audit lottery_admin_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_admin_audit"
    ADD CONSTRAINT "lottery_admin_audit_pkey" PRIMARY KEY ("audit_id");


--
-- Name: lottery_draws lottery_draws_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_draws"
    ADD CONSTRAINT "lottery_draws_pkey" PRIMARY KEY ("draw_id");


--
-- Name: lottery_participants lottery_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participants"
    ADD CONSTRAINT "lottery_participants_pkey" PRIMARY KEY ("participant_id");


--
-- Name: lottery_participations lottery_participations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participations"
    ADD CONSTRAINT "lottery_participations_pkey" PRIMARY KEY ("participation_id");


--
-- Name: lottery_payment_transactions lottery_payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_payment_transactions"
    ADD CONSTRAINT "lottery_payment_transactions_pkey" PRIMARY KEY ("transaction_id");


--
-- Name: lottery_pools lottery_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_pools"
    ADD CONSTRAINT "lottery_pools_pkey" PRIMARY KEY ("pool_id");


--
-- Name: lottery_payment_transactions_external_reference_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "lottery_payment_transactions_external_reference_uidx" ON "public"."lottery_payment_transactions" USING "btree" ("external_reference") WHERE ("external_reference" IS NOT NULL);


--
-- Name: lottery_admin_audit lottery_admin_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_admin_audit"
    ADD CONSTRAINT "lottery_admin_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id");


--
-- Name: lottery_draws lottery_draws_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_draws"
    ADD CONSTRAINT "lottery_draws_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_draws lottery_draws_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_draws"
    ADD CONSTRAINT "lottery_draws_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "public"."lottery_pools"("pool_id");


--
-- Name: lottery_draws lottery_draws_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_draws"
    ADD CONSTRAINT "lottery_draws_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_participants lottery_participants_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participants"
    ADD CONSTRAINT "lottery_participants_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_participants lottery_participants_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participants"
    ADD CONSTRAINT "lottery_participants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_participants lottery_participants_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participants"
    ADD CONSTRAINT "lottery_participants_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_participations lottery_participations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participations"
    ADD CONSTRAINT "lottery_participations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_participations lottery_participations_draw_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participations"
    ADD CONSTRAINT "lottery_participations_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "public"."lottery_draws"("draw_id");


--
-- Name: lottery_participations lottery_participations_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participations"
    ADD CONSTRAINT "lottery_participations_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."lottery_participants"("participant_id");


--
-- Name: lottery_participations lottery_participations_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participations"
    ADD CONSTRAINT "lottery_participations_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "public"."lottery_pools"("pool_id");


--
-- Name: lottery_participations lottery_participations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_participations"
    ADD CONSTRAINT "lottery_participations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_payment_transactions lottery_payment_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_payment_transactions"
    ADD CONSTRAINT "lottery_payment_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_payment_transactions lottery_payment_transactions_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_payment_transactions"
    ADD CONSTRAINT "lottery_payment_transactions_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "public"."lottery_participations"("participation_id");


--
-- Name: lottery_payment_transactions lottery_payment_transactions_reverses_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_payment_transactions"
    ADD CONSTRAINT "lottery_payment_transactions_reverses_transaction_id_fkey" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."lottery_payment_transactions"("transaction_id");


--
-- Name: lottery_pools lottery_pools_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_pools"
    ADD CONSTRAINT "lottery_pools_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: lottery_pools lottery_pools_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."lottery_pools"
    ADD CONSTRAINT "lottery_pools_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");


--
-- Name: bolao_state allow anon insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "allow anon insert" ON "public"."bolao_state" FOR INSERT TO "anon" WITH CHECK (("id" = ANY (ARRAY[:'policy_literal_1'::"text", :'policy_literal_2'::"text", :'policy_literal_3'::"text"])));


--
-- Name: bolao_state allow anon read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "allow anon read" ON "public"."bolao_state" FOR SELECT TO "anon" USING (("id" = ANY (ARRAY[:'policy_literal_1'::"text", :'policy_literal_2'::"text", :'policy_literal_3'::"text"])));


--
-- Name: bolao_state allow anon read bolao state; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "allow anon read bolao state" ON "public"."bolao_state" FOR SELECT TO "anon" USING (("id" = :'policy_literal_1'::"text"));


--
-- Name: bolao_state allow anon update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "allow anon update" ON "public"."bolao_state" FOR UPDATE TO "anon" USING (("id" = ANY (ARRAY[:'policy_literal_1'::"text", :'policy_literal_2'::"text", :'policy_literal_3'::"text"]))) WITH CHECK (("id" = ANY (ARRAY[:'policy_literal_1'::"text", :'policy_literal_2'::"text", :'policy_literal_3'::"text"])));


--
-- Name: bolao_state allow anon update bolao state; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "allow anon update bolao state" ON "public"."bolao_state" FOR UPDATE TO "anon" USING (("id" = :'policy_literal_1'::"text")) WITH CHECK (("id" = :'policy_literal_1'::"text"));


--
-- Name: bolao_state allow anon upsert bolao state; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "allow anon upsert bolao state" ON "public"."bolao_state" FOR INSERT TO "anon" WITH CHECK (("id" = :'policy_literal_1'::"text"));


--
-- Name: bolao_state; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."bolao_state" ENABLE ROW LEVEL SECURITY;

--
-- Name: lottery_admin_audit; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."lottery_admin_audit" ENABLE ROW LEVEL SECURITY;

--
-- Name: lottery_draws; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."lottery_draws" ENABLE ROW LEVEL SECURITY;

--
-- Name: lottery_participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."lottery_participants" ENABLE ROW LEVEL SECURITY;

--
-- Name: lottery_participations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."lottery_participations" ENABLE ROW LEVEL SECURITY;

--
-- Name: lottery_payment_transactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."lottery_payment_transactions" ENABLE ROW LEVEL SECURITY;

--
-- Name: lottery_pools; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."lottery_pools" ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "rls_auto_enable"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


--
-- Name: TABLE "bolao_state"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."bolao_state" TO "anon";
GRANT ALL ON TABLE "public"."bolao_state" TO "authenticated";
GRANT ALL ON TABLE "public"."bolao_state" TO "service_role";


--
-- Name: TABLE "lottery_admin_audit"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_admin_audit" TO "anon";
GRANT ALL ON TABLE "public"."lottery_admin_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_admin_audit" TO "service_role";


--
-- Name: TABLE "lottery_draws"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_draws" TO "anon";
GRANT ALL ON TABLE "public"."lottery_draws" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_draws" TO "service_role";


--
-- Name: TABLE "lottery_participants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_participants" TO "anon";
GRANT ALL ON TABLE "public"."lottery_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_participants" TO "service_role";


--
-- Name: TABLE "lottery_participations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_participations" TO "anon";
GRANT ALL ON TABLE "public"."lottery_participations" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_participations" TO "service_role";


--
-- Name: TABLE "lottery_payment_transactions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_payment_transactions" TO "anon";
GRANT ALL ON TABLE "public"."lottery_payment_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_payment_transactions" TO "service_role";


--
-- Name: TABLE "lottery_pools"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lottery_pools" TO "anon";
GRANT ALL ON TABLE "public"."lottery_pools" TO "authenticated";
GRANT ALL ON TABLE "public"."lottery_pools" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- PostgreSQL database dump complete
--

\unrestrict KK9ujODNr74XdetkDydtRf5TFPVu0VujSboeEBteCHhfU7m5GYS42gwb92qQP0o



-- =====================================================================
-- GLOBAL OBJECT OMITTED BY `pg_dump --schema=public`
-- =====================================================================
-- `ensure_rls` is postgres-owned and was undeclared anywhere in version
-- control before this baseline. It fires on EVERY ddl_command_end and calls a
-- SECURITY DEFINER function that auto-enables RLS on newly created tables.
-- That is finding R-08; capturing it here is the fix.
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();

-- =====================================================================
-- DRIFT SINCE CAPTURE — three tables this baseline does not describe
-- KPLUS-F057. Appended 2026-08-11.
-- =====================================================================
--
-- The body above is a FAITHFUL capture of production on 2026-08-07T22:56:29Z. It was not wrong when
-- it was written. Production changed underneath it, through a channel this programme did not know
-- existed, and the authorized read-only window of 2026-08-11 measured TEN tables in `public` where
-- this baseline describes SEVEN.
--
-- ─── WHAT THE CHANNEL IS ─────────────────────────────────────────────────────────────────────
--
-- There are TWO migration mechanisms operating on the same production database:
--
--   A. `supabase/migrations/` on branch `db-modernization-architecture` — what this programme models.
--   B. `bolao/shared/sql/NNN_*.sql` on branch `main` — a hand-numbered series, applied by the
--      product team. Files 010 through 026 exist there. This branch has never contained them.
--
-- The information flow was ONE-WAY. Commit 41496b4 on `main` shows the product team was aware of
-- this programme and worked around it deliberately: the live cache table was created via
-- `supabase db query` rather than `db push` precisely so it would not disturb the modernization
-- migration ledger, and the commit records that "as sete tabelas existentes ficaram intactas
-- (verificado antes e depois)". They knew about us. Nothing told us about them.
--
-- That asymmetry — not carelessness on either side — is the finding. See ADR-018.
--
-- ─── THE THREE TABLES, WITH PROVENANCE ───────────────────────────────────────────────────────
--
-- 1. bolao_entry_private — classification: TARGET_ENTITY (see ADR-018; NOT yet added to the
--    normalized target, deliberately)
--    origin : main, commit 727e785, bolao/shared/sql/015_f10_private_pii_and_public_projection.sql
--    why    : F10 stage 1. `bolao_state.state->'entries'` carried participantEmail, payerName,
--             paymentMethod and paymentTo, and the anon key is public by construction — 46 entries,
--             46 e-mails anonymously enumerable, measured 2026-08-10. This table is where that PII
--             was moved. RLS on, ZERO policies, so anon cannot reach it even to read.
--    measured privileges (2026-08-11): anon NONE · authenticated CRUD · service_role CRUD
--
create table if not exists bolao_entry_private (
  pool_id            text not null,
  entry_ref          text not null,
  participant_email  text,
  payer_name         text,
  payment_method     text,
  payment_to         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (pool_id, entry_ref)
);
--
-- 2. bolao_notif_jobs — classification: DEFERRED_WITH_REASON (overlaps the M9 outbox; see ADR-018)
--    origin : main, commit 876918d, bolao/shared/sql/010_notification_durability.sql
--    why    : durable notification outbox with leases, idempotency and retry. Deliberately carries
--             an OPAQUE `entry_ref` and never an address — its own DDL comment forbids adding an
--             e-mail or phone column, "quebraria a premissa de seguranca desta feature".
--    measured privileges (2026-08-11): anon CRUD · authenticated CRUD · service_role CRUD
--    NOTE: anon holds full CRUD here. The table carries no PII by design, and RLS state was not
--          read, so this is an exposure to assess (KPLUS-F057), not a confirmed incident.
--    Column list is in the source file above; not duplicated here, because a second copy of a
--    definition is a second thing to keep true.
--
-- 3. live_sports_cache — classification: LEGACY_ONLY (not a target entity)
--    origin : main, commit 41496b4 — applied via `supabase db query`. **Its DDL is in NO file in
--             version control.** That is recorded, not guessed: the commit explains why it was
--             applied that way, but the CREATE TABLE text itself was never committed anywhere.
--    why    : shared ESPN cache, public sports data only, kept deliberately separate from
--             bolao_state. A read or write failure degrades to fetching from source.
--    columns OBSERVED from the edge-function client in that commit (NOT authoritative DDL):
--             competition, payload, observed_at, stored_at
--    measured privileges (2026-08-11): anon SELECT only · authenticated CRUD · service_role CRUD
--
-- ─── WHAT IS STILL NOT ENUMERATED ────────────────────────────────────────────────────────────
--
-- PROBE-4 filtered on `relkind = 'r'`, so it saw ORDINARY TABLES ONLY. Commit 727e785 creates a
-- VIEW, `bolao_state_public`. Views in production have never been enumerated by this programme, so
-- the legacy surface above is complete for TABLES and unknown for VIEWS. Recorded as KPLUS-F058
-- rather than left to be discovered at cutover, which is how F057 was found.
--
-- ─── THE DEPENDENCY THAT MATTERS MOST ────────────────────────────────────────────────────────
--
-- F10 is staged, and its Stage 6 REVOKES anon's access to the raw `bolao_state` and is explicitly
-- not yet done ("A revogacao e a Stage 6"). The 2026-08-11 read confirms it: anon still holds
-- SELECT on bolao_state. This programme's transformers read participant e-mail and payer name out
-- of `bolao_state.state->'entries'`. They work TODAY because the PII is still there. When F10's
-- later stages remove it, they break — and nothing in this repository would notice.
-- See ADR-018 and the regression control in scripts/db/test_legacy_fence.mjs.

-- =====================================================================
-- THE VIEW SURFACE — KPLUS-F058. Appended 2026-08-11.
-- =====================================================================
--
-- Every probe this programme had run filtered `relkind = 'r'`, so no artefact here had ever seen a view.
-- A dedicated read-only catalog probe found TWO, both projections of `public.bolao_state`:
--
--   bolao_state_public       cols (id, state, updated_at)  · owner postgres · security_invoker OFF
--                            origin: main 727e785 · shared/sql/015
--                            strips participantEmail, payerName, paymentMethod, paymentTo from entries
--
--   bolao_state_public_cdb   cols (id, state)              · owner postgres · security_invoker OFF
--                            origin: main 544b4a1 · shared/sql/024
--                            same projection where id = 'cdb2026', also strips txId
--
-- Classification for BOTH: PUBLIC_READ_SURFACE. They ARE the browser's read path — F10 created the first
-- so clients could migrate by changing a table name instead of rewriting the app, and CDB2026 (which is
-- in production) reads the second. Neither is obsolete, and neither becomes obsolete merely because the
-- normalized target exists. They may be retired only after the clients read the target path AND F10's
-- remaining stages have landed.
--
-- ─── WHY THIS WAS A DEFECT AND NOT A DOCUMENTATION GAP ───────────────────────────────────────
--
-- `anon` holds SELECT, INSERT, UPDATE **and DELETE** on both. Their own source files grant only SELECT;
-- the write half comes from Supabase's blanket default privileges on `public`, which apply to every
-- relation created in that schema. Nobody chose it and nothing recorded it.
--
-- Both views are auto-updatable on their simple column references, and with `security_invoker` OFF a view
-- executes with its OWNER's privileges. `bolao_state` is ENABLE ROW LEVEL SECURITY, not FORCE, so the
-- owner is exempt from its policies.
--
-- The consequence, measured on real PostgreSQL by NIGHT-27 rather than argued:
--
--   after the fence revoked anon's writes on public.bolao_state,
--     UPDATE public.bolao_state_public SET updated_at = now()  -> SUCCEEDED, 1 row
--     DELETE FROM public.bolao_state_public WHERE id = ...     -> SUCCEEDED, 1 row
--
-- Both wrote the underlying table. The cutover fence closed the front door and left the side door open,
-- and `fenceVerifySql()` — filtering `relkind = 'r'` — reported the fence CLOSED while it was true.
--
-- REMEDIATED: the fence model carries LEGACY_VIEWS, the verifier reads relkind IN ('r','v','m'), and the
-- generated fence revokes the write set on both views while preserving SELECT. NIGHT-27 is 12/12.
--
-- NOTE ON DDL: the view bodies are NOT reproduced here. Their authoritative source is `main`
-- shared/sql/015 and 024, and a second copy is a second thing to keep true. The probe recorded a
-- sha256(16) of each definition instead, which detects change without exposing the expressions:
--   bolao_state_public      798327529c943ea1  (454 bytes)
--   bolao_state_public_cdb  6dd24d9fd9abdeaf  (391 bytes)
--
-- Also measured and worth stating: 15 indexes, 0 materialized views, 0 foreign tables, 0 partitioned
-- tables. The `public` relation surface is now enumerated for every relkind, not just one.
