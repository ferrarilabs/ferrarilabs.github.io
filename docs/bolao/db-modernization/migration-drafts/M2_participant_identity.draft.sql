-- NOT FOR PRODUCTION APPLY
-- REVIEW DRAFT ONLY
-- REQUIRES M0 + RESTORE REHEARSAL + EXPLICIT OPERATOR AUTHORIZATION
--
-- GENERATED FILE — do not edit by hand.
-- Source: model/target_model.json + model/access_model.json
-- Regenerate: node scripts/db/generate_migration_drafts.mjs --write
--
-- This file is deliberately NOT in supabase/migrations/ and its name is not CLI-recognisable,
-- so `supabase db push` cannot see it. Applying it requires copying it elsewhere on purpose.

-- ============================================================
-- M2 — participant identity
-- ============================================================
--
-- PURPOSE. participants and participant_identity_links: the identity spine every other domain points at.
--  Created before pools and financial because both reference participant_id.
--
-- DEPENDENCIES: M1
-- TABLES CREATED: bolao.participants, bolao.participant_identity_links, bolao.participant_auth_links
--
-- LOCK RISK. CREATE TABLE / CREATE TYPE take no lock on any existing object, so concurrent traffic is
--  unaffected. FKs do take a brief ACCESS EXCLUSIVE lock on the REFERENCED table while the constraint is
--  registered — participants and pools are referenced here — but that is catalogue-only and does not scan.
--  Every index is built CONCURRENTLY outside the transaction. Expected worst-case lock on a live object: a
--  sub-millisecond catalogue lock on referenced parents.
-- TABLE REWRITE RISK. NONE. This phase creates new tables only; it never ALTERs an existing one, so no
--  rewrite is possible.
-- INDEX BUILD STRATEGY. CREATE INDEX CONCURRENTLY, one statement per index, each outside a transaction
--  block. A concurrent build can fail and leave an INVALID index that is still maintained on write, so the
--  postchecks assert pg_index.indisvalid for every index created here.
-- CONSTRAINT VALIDATION STRATEGY. FKs, UNIQUEs and CHECKs are declared INLINE in CREATE TABLE and are
--  therefore validated immediately. That is correct and deliberate HERE and only here: the table is brand
--  new and empty, so validation scans zero rows and the NOT VALID / VALIDATE two-step would add ceremony
--  with no benefit. Any LATER migration that adds a constraint to a POPULATED table must use ADD CONSTRAINT
--  ... NOT VALID followed by a separate VALIDATE CONSTRAINT, because a plain ADD holds a lock for the whole
--  scan — the static analyser enforces that distinction.
-- RLS EFFECT. Every table is created with RLS ENABLED and ZERO policies, which in PostgreSQL denies all
--  access to everyone except table owners and BYPASSRLS roles. Policies are a separate, later migration.
--  This ordering is deliberate: a table that exists without RLS, even briefly, is an exposure window.
-- ACL EFFECT. No GRANT is issued. Default privileges are revoked from PUBLIC. anon and authenticated
--  receive nothing in this phase. Intended eventual access: participants[anon:none],
--  participant_identity_links[anon:none], participant_auth_links[anon:none]
-- PII EFFECT. Introduces 8 PII-bearing column(s): participants.participant_id:PSEUDONYMOUS_ID,
--  participants.display_name:DIRECT_IDENTIFIER, participants.email:CONTACT, participants.phone:CONTACT,
--  participants.created_by:PSEUDONYMOUS_ID, participant_identity_links.evidence:SENSITIVE_SNAPSHOT,
--  participant_identity_links.merged_by:PSEUDONYMOUS_ID,
--  participant_auth_links.auth_user_id:PSEUDONYMOUS_ID. All are unreadable until a policy grants access.
-- BACKFILL REQUIREMENT. M5-backfill (separate) inserts one participant per distinct normalised email, else
--  normalised name. ZERO merges.
-- APPLICATION COMPATIBILITY. TOTAL — additive.
-- ROLLBACK STRATEGY (FULL). FULL — DROP TABLE; nothing references them yet.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M1 is recorded as applied
--   2. none of the tables this phase creates already exists
--   3. a verified backup exists (restore_rehearsal.mjs preflight green)
--   4. acceptance_checks.mjs structural counts match the recorded expectation
--   5. supabase db diff is EMPTY before starting
-- POSTCHECKS (all READ_ONLY):
--   1. every table exists with RLS enabled and zero policies
--   2. every FK and CHECK reports convalidated = true
--   3. every index reports indisvalid = true
--   4. no GRANT exists to anon or authenticated on any new table
--   5. prePostValidate reports no UNACCOUNTED change
-- FAIL-CLOSED CONDITIONS (stop, do not improvise):
--   · any precheck fails
--   · a table already exists (this phase was partially applied — establish state first)
--   · an index reports indisvalid = false (drop it CONCURRENTLY and retry; do not proceed)
--   · db diff is non-empty afterwards in any way not declared above
--   · any statement errors — the transaction aborts and nothing is left half-created

BEGIN;

CREATE TABLE bolao."participants" (
  "participant_id"                   uuid NOT NULL DEFAULT gen_random_uuid(),
  "display_name"                     text,
  "email"                            citext,
  "phone"                            text,
  "state"                            bolao.participant_state NOT NULL DEFAULT 'active',
  "canonical_participant_id"         uuid,
  "version"                          integer NOT NULL DEFAULT 1,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  "updated_at"                       timestamptz NOT NULL DEFAULT now(),
  "created_by"                       uuid,
  "redacted_at"                      timestamptz,
  "redaction_reason"                 text,
  CONSTRAINT "participants_pkey" PRIMARY KEY ("participant_id"),
  CONSTRAINT "participants_canonical_participant_id_fkey" FOREIGN KEY ("canonical_participant_id") REFERENCES bolao."participants" ("participant_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "participants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES auth."users" ("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "participants_canonical_not_self" CHECK (canonical_participant_id IS NULL OR canonical_participant_id <> participant_id),
  CONSTRAINT "participants_redaction_complete" CHECK (redacted_at IS NULL OR (display_name IS NULL AND email IS NULL AND phone IS NULL)),
  CONSTRAINT "participants_display_name_present_unless_redacted" CHECK (display_name IS NOT NULL OR redacted_at IS NOT NULL)
);

COMMENT ON TABLE bolao."participants" IS 'A durable person who takes part in pools, across competitions and years. PII lives here and ONLY here.';
COMMENT ON COLUMN bolao."participants"."participant_id" IS 'PII class: PSEUDONYMOUS_ID';
COMMENT ON COLUMN bolao."participants"."display_name" IS 'PII class: DIRECT_IDENTIFIER';
COMMENT ON COLUMN bolao."participants"."email" IS 'PII class: CONTACT';
COMMENT ON COLUMN bolao."participants"."phone" IS 'PII class: CONTACT';
COMMENT ON COLUMN bolao."participants"."created_by" IS 'PII class: PSEUDONYMOUS_ID';
-- CHECK participants_canonical_not_self: a row cannot supersede itself — would create a 1-cycle
-- CHECK participants_redaction_complete: a redacted row must not retain PII; makes partial redaction impossible
-- CHECK participants_display_name_present_unless_redacted: display_name was NOT NULL, which made participants_redaction_complete unsatisfiable: that check requires display_name IS NULL once redacted_at is set, so no row could ever be redacted at all (KPLUS-F008, found by workstream F against a real server). The column is now nullable and this check carries the original guarantee exactly — every LIVE participant still must have a name, and NULL is reachable only in the redacted state the model already describes.

ALTER TABLE bolao."participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."participants" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."participants" FROM PUBLIC;

-- updated_at is maintained here, not by callers. The WHEN guard means a no-op write does not
-- advance it, so the column reads as "when this row last actually changed".
CREATE TRIGGER "participants_set_updated_at"
  BEFORE UPDATE ON bolao."participants"
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION bolao.set_updated_at();

CREATE TABLE bolao."participant_identity_links" (
  "link_id"                          uuid NOT NULL DEFAULT gen_random_uuid(),
  "surviving_participant_id"         uuid NOT NULL,
  "merged_participant_id"            uuid NOT NULL,
  "confidence"                       bolao.match_confidence NOT NULL,
  "evidence"                         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reason"                           text NOT NULL,
  "merged_at"                        timestamptz NOT NULL DEFAULT now(),
  "merged_by"                        uuid NOT NULL,
  "reverted_at"                      timestamptz,
  "reverted_by"                      uuid,
  "revert_reason"                    text,
  CONSTRAINT "participant_identity_links_pkey" PRIMARY KEY ("link_id"),
  CONSTRAINT "participant_identity_links_surviving_participant_id_fkey" FOREIGN KEY ("surviving_participant_id") REFERENCES bolao."participants" ("participant_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "participant_identity_links_merged_participant_id_fkey" FOREIGN KEY ("merged_participant_id") REFERENCES bolao."participants" ("participant_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "participant_identity_links_merged_by_fkey" FOREIGN KEY ("merged_by") REFERENCES auth."users" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "participant_identity_links_reverted_by_fkey" FOREIGN KEY ("reverted_by") REFERENCES auth."users" ("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "pil_no_self_merge" CHECK (surviving_participant_id <> merged_participant_id),
  CONSTRAINT "pil_revert_complete" CHECK ((reverted_at IS NULL) = (reverted_by IS NULL)),
  CONSTRAINT "pil_reason_present" CHECK (length(btrim(reason)) > 0)
);

COMMENT ON TABLE bolao."participant_identity_links" IS 'Audited, REVERSIBLE record of every identity merge. Over-merging money is unrecoverable, so the merge itself must be an undoable, attributable act.';
COMMENT ON COLUMN bolao."participant_identity_links"."evidence" IS 'PII class: SENSITIVE_SNAPSHOT';
COMMENT ON COLUMN bolao."participant_identity_links"."merged_by" IS 'PII class: PSEUDONYMOUS_ID';
-- CHECK pil_no_self_merge: merging a row into itself is meaningless and creates a cycle
-- CHECK pil_revert_complete: a revert without an actor is unattributable
-- CHECK pil_reason_present: every merge must carry a written justification

ALTER TABLE bolao."participant_identity_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."participant_identity_links" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."participant_identity_links" FROM PUBLIC;

CREATE TABLE bolao."participant_auth_links" (
  "participant_id"                   uuid NOT NULL,
  "auth_user_id"                     uuid NOT NULL,
  "linked_at"                        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "participant_auth_links_pkey" PRIMARY KEY ("participant_id", "auth_user_id"),
  CONSTRAINT "participant_auth_links_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES bolao."participants" ("participant_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "participant_auth_links_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES auth."users" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

COMMENT ON TABLE bolao."participant_auth_links" IS 'Which auth identities own which participants. KPLUS-F047: this table is RATIFIED (WS12-OP-2), every ownership policy in the RLS model queries it, and write_contracts authorizes against it (''caller owns pool_entry_id via participant_auth_links'') — and it was in no model entry and no migration phase. The RLS draft shipped it as a COMMENTED-OUT prerequisite, so applying the migration as generated would have left every ownership policy referencing a relation that does not exist. Found by NIGHT-1, the first run to apply RLS to a database built from zero.';
COMMENT ON COLUMN bolao."participant_auth_links"."auth_user_id" IS 'PII class: PSEUDONYMOUS_ID';

ALTER TABLE bolao."participant_auth_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."participant_auth_links" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."participant_auth_links" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- dedup candidate lookup; partial because email is nullable and redacted rows must not block reuse
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "participants_email_uidx" ON bolao."participants" (email) WHERE email IS NOT NULL AND redacted_at IS NULL;
-- resolve a superseded identity to its canonical row; unindexed FK would full-scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS "participants_canonical_participant_id_idx" ON bolao."participants" (canonical_participant_id);
-- candidate-match workflow searches by name; expression index avoids a scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS "participants_lower_display_name__idx" ON bolao."participants" (lower(display_name));
-- KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 15,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "participants_created_by_idx" ON bolao."participants" (created_by);
-- a participant may be actively merged into at most ONE survivor; partial so a reverted merge frees it for re-merge
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "participant_identity_links_merged_participant_id_uidx" ON bolao."participant_identity_links" (merged_participant_id) WHERE reverted_at IS NULL;
-- list everything absorbed by a canonical participant
CREATE INDEX CONCURRENTLY IF NOT EXISTS "participant_identity_links_surviving_participant_id_idx" ON bolao."participant_identity_links" (surviving_participant_id);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['participants_email_uidx', 'participants_canonical_participant_id_idx', 'participants_lower_display_name__idx', 'participants_created_by_idx', 'participant_identity_links_merged_participant_id_uidx', 'participant_identity_links_surviving_participant_id_idx']);
-- Expected: zero rows.
