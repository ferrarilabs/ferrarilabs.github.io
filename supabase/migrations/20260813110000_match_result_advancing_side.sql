--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813110000_match_result_advancing_side.sql
--
-- ═══ THE SIDE THAT ADVANCED IS NOT A FUNCTION OF THE SCORE ═══════════════════════════════════
--
-- Copa's `results` object carries `advanceSide` on all 32 knockout matches. It cannot be derived
-- from `goals_home`/`goals_away`, and production proves it twice over:
--
--   match 96  0 × 0  advanceSide A     a draw has no higher score
--   match 103 4 × 6  advanceSide B     and a 4-6 "draw" is a penalty shootout written as a total
--
-- A read surface that computed the advancing side from the goals would have to invent a
-- tie-break rule the document never recorded, and would get match 96 wrong by construction.
-- So it is stored as what it is: an independently recorded outcome.
--
-- ═══ WHY IT LIVES ON match_results AND NOT ON matches ════════════════════════════════════════
--
-- It is an OUTCOME, and `bolao.match_results` is where outcomes live — including the supersede
-- chain, so a corrected result carries its own corrected advancing side rather than mutating a
-- fact on the fixture. `bolao.matches` describes the fixture, which exists before anyone plays.
--
-- ═══ WHY NOT REUSE ties.qualified_side ══════════════════════════════════════════════════════
--
-- `bolao.ties.qualified_side` answers the same question for CDB, where a tie is two legs and the
-- aggregate decides who goes through. Copa's knockout has no ties at all — all 28 tie rows are
-- CDB's — so the Copa answer has nowhere to sit on that model. Generalising `ties` to cover
-- single-match knockouts to avoid one column would import CDB's tournament shape into Copa's,
-- which the platform governance rule forbids in exactly those words.
--
-- ═══ THE ENUM IS THE DOCUMENT'S, DELIBERATELY ═══════════════════════════════════════════════
--
-- 'A' and 'B' are sides of the fixture as the document numbers them, not home/away. The CHECK is
-- a closed two-value vocabulary: a third value must be an argued migration, not a stray write.
-- NULL means the source recorded no advancing side — true of all 63 group-stage results, where
-- the concept does not apply. NULL is therefore MEANINGFUL here and not merely unfilled.
--
-- ═══ CLASSIFICATION ═════════════════════════════════════════════════════════════════════════
--
-- PLATFORM_SHARED · ADDITIVE_DDL only. One nullable column, no DEFAULT: catalogue-only in
-- PostgreSQL 11+, no rewrite, no scan. The CHECK is added NOT VALID and validated separately, so
-- the ADD does not hold a lock for a full-table scan even though the table is 48 rows today and
-- the distinction would not be observable. The two-step is used because the static analyser
-- enforces it on populated tables and a 48-row exception is how a 48-million-row habit starts.
--
-- APPLICATION COMPATIBILITY. TOTAL. The apps read public.bolao_state_public; nothing here is
-- reachable from it. The column is empty until a separate, separately-verified backfill fills it.
--
-- ROLLBACK (FULL). ALTER TABLE bolao.match_results DROP COLUMN advance_side. Every value is
-- re-derivable from public.bolao_state['main'].results for as long as legacy is retained.
--
-- PRECHECKS: bolao.match_results exists · the column does not · a verified backup exists
-- POSTCHECKS: column exists nullable with no default · the CHECK reports convalidated = true ·
--             row count on match_results unchanged · no new GRANT
--

BEGIN;

ALTER TABLE bolao.match_results ADD COLUMN IF NOT EXISTS advance_side character(1);

COMMENT ON COLUMN bolao.match_results.advance_side IS
  'Which side of the fixture the source recorded as advancing: A or B as the document numbers them, not home/away. NOT derivable from the goals — production holds a 0-0 that advanced A and a 4-6 that advanced B, the latter being a penalty shootout written as a total. NULL means the source recorded no advancing side, which is the correct and permanent answer for every group-stage result.';

ALTER TABLE bolao.match_results
  ADD CONSTRAINT mr_advance_side_known CHECK (advance_side IS NULL OR advance_side IN ('A','B')) NOT VALID;

COMMIT;

-- Validated outside the creating transaction: VALIDATE CONSTRAINT takes only SHARE UPDATE
-- EXCLUSIVE and does not block reads or writes, whereas a plain ADD CONSTRAINT would have held
-- ACCESS EXCLUSIVE for the whole scan.
ALTER TABLE bolao.match_results VALIDATE CONSTRAINT mr_advance_side_known;
