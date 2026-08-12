--
-- PROVENANCE: BASELINE_ADOPTED_AT_CURRENT_STATE
--
-- BASELINE — row-level-security policies
--
-- This file is ADOPTED, not EXECUTED. It is recorded in supabase_migrations.schema_migrations
-- via `supabase migration repair --status applied`, which inserts a ledger row and runs no SQL.
-- The objects it declares ALREADY EXIST in production; running it against production would
-- attempt to re-create them. Never `supabase db push` this file at production.
--
-- The 7 policies measured in production. The pool-id literals here are classified IDENTIFIER in supabase/migrations/PRIVATE_LITERALS.md (public pool ids, already present in 83+ tracked files), so this file carries no secret.
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
-- Name: bolao_state allow anon insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "allow anon insert" ON "public"."bolao_state" FOR INSERT TO "anon" WITH CHECK (("id" = ANY (ARRAY['main'::"text", 'br2026'::"text", 'cdb2026'::"text"])));

--
-- Name: bolao_state allow anon read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "allow anon read" ON "public"."bolao_state" FOR SELECT TO "anon" USING (("id" = ANY (ARRAY['main'::"text", 'br2026'::"text", 'cdb2026'::"text"])));

--
-- Name: bolao_state allow anon read bolao state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "allow anon read bolao state" ON "public"."bolao_state" FOR SELECT TO "anon" USING (("id" = 'main'::"text"));

--
-- Name: bolao_state allow anon update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "allow anon update" ON "public"."bolao_state" FOR UPDATE TO "anon" USING (("id" = ANY (ARRAY['main'::"text", 'br2026'::"text", 'cdb2026'::"text"]))) WITH CHECK (("id" = ANY (ARRAY['main'::"text", 'br2026'::"text", 'cdb2026'::"text"])));

--
-- Name: bolao_state allow anon update bolao state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "allow anon update bolao state" ON "public"."bolao_state" FOR UPDATE TO "anon" USING (("id" = 'main'::"text")) WITH CHECK (("id" = 'main'::"text"));

--
-- Name: bolao_state allow anon upsert bolao state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "allow anon upsert bolao state" ON "public"."bolao_state" FOR INSERT TO "anon" WITH CHECK (("id" = 'main'::"text"));

--
-- Name: live_sports_cache live_cache_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "live_cache_read" ON "public"."live_sports_cache" FOR SELECT USING (true);
