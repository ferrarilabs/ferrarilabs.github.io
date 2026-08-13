--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813100000_entry_source_identity_and_tombstones.sql
--
-- ═══ THE FIVE ENTRY FACTS THE NORMALIZED MODEL DROPPED ═══════════════════════════════════════
--
-- READ_CUTOVER needs `bolao.read_document()` to emit the `entries` section. The handoff recorded
-- that section as "buildable now — fully populated (46 entries, 1021 predictions)". Row counts
-- are complete; the FIELD contract is not. Measured against the live document, five per-entry
-- facts the public contract carries have no normalized home at all:
--
--   1. `id`          the document's entry id. `pool_entries.pool_entry_id` is NOT it: Q33-A1
--                    minted fresh keys for 25 of 46 entries when it canonicalized identity, and
--                    the only surviving trace is a REGEX-PARSEABLE SUBSTRING of
--                    `audit.migration_lineage.source_path`. Provenance text is not a join key.
--                    And the id is load-bearing three ways over: `paid` is an object KEYED by it,
--                    `deletedIds` is an array OF it, and every browser's localStorage merges
--                    entries BY it. Emitting pool_entry_id instead would silently unpay every
--                    participant and duplicate every entry in every returning browser.
--   2. `entryName`   what the participant typed, and what the public ranking prints.
--                    `participants.display_name` is the Q33-A1 CANONICAL name and matches the
--                    document on only 26 of 46 entries — the other 20 would be renamed in public.
--                    `pool_entries.entry_label` is 'main'/'main-2', a per-participant ordinal.
--   3. `updatedAt`   differs from `createdAt` on 46 of 46 entries, so it is an independent fact
--                    and not a spelling of one already stored. `pool_entries.updated_at` is the
--                    MIGRATION's clock (2026-08-12 for every row), not the participant's. It is
--                    the field `mergeStates()` compares to decide whether the remote entry or the
--                    browser's own copy is newer.
--   4. `createdAt`   already stored, and correctly: it is `pool_entries.submitted_at`, equal as an
--                    instant on 46 of 46. No column needed — recorded here so the next reader does
--                    not add a sixth one by symmetry.
--   5. `demo`        `entries[].diagnostics.demo` is the ONLY publicly-behavioral bit inside
--                    `diagnostics`: copa's `realEntries` filter drops demo entries from the
--                    ranking, the participant list and the scoring input (app.js 1623, 1867, 1998,
--                    3092). The rest of that object — `userAgent`, `timezone`, `viewport`,
--                    `capturedAt` — is forensic device metadata that is PUBLICLY READABLE TODAY on
--                    21 Copa entries through `public.bolao_state_public`, which strips four payment
--                    fields and passes everything else through. It is the same leak class as
--                    `auditLog` and it is not reproduced here: one boolean is normalized, the
--                    forensics stay in legacy where only the operator can reach them.
--
-- `predictions.display_home` / `display_away` are the sixth and seventh, and they belong to the
-- prediction rather than the entry: copa's `picks[m].displayA/displayB` are the side LABELS the
-- participant saw when they picked. On matches 89-104 those labels are the participant's OWN
-- projected bracket, not the tournament's — match 89 reads "Canada × Morocco" because THIS entry
-- sent Canada and Morocco through. They are therefore unrecoverable from `bolao.matches`, whose
-- 10 structural slots deliberately carry no team at all (Q39-A1). The app re-derives them for
-- display and uses the STORED pair only to warn "the teams changed since you picked" — a form-only
-- behavior, and Copa's form is archived. They are stored anyway, because a field that is cheap to
-- preserve and impossible to reconstruct is not a field to drop on the grounds that today's UI
-- happens not to read it.
--
-- ═══ WHY THESE ARE COLUMNS AND NOT A jsonb RESIDUE ═══════════════════════════════════════════
--
-- The obvious shortcut is one `legacy_entry_document jsonb` holding everything unmapped. It is
-- refused: that column would re-admit `participantEmail`, `payerName`, `paymentMethod` and
-- `diagnostics.userAgent` into the normalized model as an opaque blob, and the whole point of the
-- normalized read surface is that a field must be NAMED before it can be served. Five named
-- columns can each be granted, audited and refused individually. A blob cannot.
--
-- ═══ TOMBSTONES ══════════════════════════════════════════════════════════════════════════════
--
-- `bolao.pool_entry_tombstone` exists because copa's `deletedIds` holds 8 ids and
-- `bolao.pool_entries` holds ZERO rows with `deleted_at` set. The deletions were never migrated,
-- so today's projection derives `deletedIds` from `pool_entries.deleted_at` and returns `[]` —
-- correct-looking and wrong, and it would resurrect 8 deleted entries into the public ranking the
-- moment the read path moved. (It is wrong twice: it aggregates `entry_label`, so a soft-deleted
-- entry would have emitted the string "main" where the app expects a uuid.)
--
-- A tombstone is NOT a soft-deleted `pool_entries` row. Materialising one would require inventing a
-- `participant_id` and an `expected_fee_amount` for an entry whose content no longer exists —
-- fabricating a person and a debt to satisfy two NOT NULL constraints. The tombstone records
-- exactly what is known: this pool, this legacy entry id, deleted. Nothing else.
--
-- ═══ CLASSIFICATION ══════════════════════════════════════════════════════════════════════════
--
-- PLATFORM_SHARED · ADDITIVE_DDL only. No ALTER of an existing column, no DROP, no DML. Every
-- added column is nullable with NO DEFAULT, which in PostgreSQL 11+ is a catalogue-only change:
-- no table rewrite, no scan, ACCESS EXCLUSIVE held only long enough to update pg_attribute.
--
-- NO DEFAULT IS DELIBERATE, `is_demo` INCLUDED. A DEFAULT false would assert "not a demo entry"
-- for all 46 rows before anything read the source. NULL means NOT YET OBSERVED and the backfill
-- turns it into a measured false. The projection treats NULL as not-demo, so the intermediate
-- state is safe; the point is that the value gets ASSERTED rather than assumed.
--
-- APPLICATION COMPATIBILITY. TOTAL. The three apps read `public.bolao_state_public`, which is a
-- view over `public.bolao_state`. Nothing here touches either. The columns are empty until a
-- separate, separately-verified backfill fills them.
--
-- ROLLBACK (FULL). DROP the two indexes, the table, and the six columns. Every value is
-- re-derivable from `public.bolao_state` for as long as legacy is retained, and legacy is
-- retained. Once the read path is serving from these columns the class becomes FORWARD_FIX_ONLY,
-- for the ordinary reason: dropping them would empty a live public document.
--
-- PRECHECKS:
--   1. bolao.pool_entries, bolao.predictions and bolao.pools exist
--   2. none of the six columns and neither index already exists
--   3. bolao.pool_entry_tombstone does not exist
--   4. a verified backup exists
-- POSTCHECKS:
--   1. all six columns exist, nullable, no default
--   2. the tombstone table has RLS enabled, FORCE, and zero policies
--   3. both unique indexes report indisvalid = true
--   4. no GRANT to anon or authenticated on anything created here
--   5. row counts unchanged on every existing relation
--

BEGIN;

-- ─── ENTRY SOURCE IDENTITY ──────────────────────────────────────────────────────────────────

ALTER TABLE bolao.pool_entries ADD COLUMN IF NOT EXISTS legacy_entry_id uuid;
COMMENT ON COLUMN bolao.pool_entries.legacy_entry_id IS
  'The id this entry is known by in the legacy state document. NOT an alternate primary key and not a fallback for pool_entry_id: it is the identifier the PUBLIC contract is keyed on — paid{} keys, deletedIds[] members and every browser localStorage merge — so the read surface must emit it rather than the internal key. Q33-A1 re-minted pool_entry_id for 25 of 46 entries; without this column the only surviving mapping is a substring of audit.migration_lineage.source_path.';

ALTER TABLE bolao.pool_entries ADD COLUMN IF NOT EXISTS display_label text;
COMMENT ON COLUMN bolao.pool_entries.display_label IS
  'The entry name as recorded in the source document (entries[].entryName) — what the participant typed and what the public ranking prints. Deliberately NOT participants.display_name, which is the Q33-A1 canonical identity and differs on 20 of 46 entries; serving the canonical name publicly would rename twenty people''s entries. Deliberately NOT entry_label, which is a per-participant ordinal (main, main-2).';

ALTER TABLE bolao.pool_entries ADD COLUMN IF NOT EXISTS content_updated_at timestamptz;
COMMENT ON COLUMN bolao.pool_entries.content_updated_at IS
  'When the entry''s CONTENT was last modified at source (entries[].updatedAt). Distinct from updated_at, which is this row''s bookkeeping clock and reads 2026-08-12 for every migrated entry. mergeStates() compares this value to decide whether the remote entry or the browser''s own copy is newer, so a row-clock stand-in would make the server always win and silently discard unsynced local edits.';

ALTER TABLE bolao.pool_entries ADD COLUMN IF NOT EXISTS is_demo boolean;
COMMENT ON COLUMN bolao.pool_entries.is_demo IS
  'The only publicly-behavioral bit of the legacy entries[].diagnostics object: a demo entry is excluded from the ranking, the participant list and the scoring input. NULL means not yet observed from source and is treated as false by the read surface. The rest of diagnostics (userAgent, timezone, viewport, capturedAt) is forensic device metadata and is deliberately NOT normalized — it stays in legacy, reachable only by the operator.';

-- ─── PREDICTION SIDE LABELS ─────────────────────────────────────────────────────────────────

ALTER TABLE bolao.predictions ADD COLUMN IF NOT EXISTS display_home text;
COMMENT ON COLUMN bolao.predictions.display_home IS
  'The home-side label the participant saw when they made this prediction (copa picks[].displayA). On the 10 structural bracket slots this is the participant''s OWN projected team, not the tournament''s, so it is unrecoverable from bolao.matches — whose structural sides carry no team by design (Q39-A1). NULL where the source carried no label.';

ALTER TABLE bolao.predictions ADD COLUMN IF NOT EXISTS display_away text;
COMMENT ON COLUMN bolao.predictions.display_away IS
  'The away-side label the participant saw when they made this prediction (copa picks[].displayB). See display_home.';

-- ─── TOMBSTONES ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bolao.pool_entry_tombstone (
  pool_entry_tombstone_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id                 uuid        NOT NULL,
  legacy_entry_id         uuid        NOT NULL,
  observed_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pool_entry_tombstone_pool_id_fkey
    FOREIGN KEY (pool_id) REFERENCES bolao.pools (pool_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

COMMENT ON TABLE bolao.pool_entry_tombstone IS
  'An entry id the source document records as deleted. NOT a soft-deleted pool_entries row: materialising one would require inventing a participant_id and an expected_fee_amount for an entry whose content no longer exists, fabricating a person and a debt to satisfy two NOT NULL constraints. This records only what is known — pool, legacy entry id, deleted — and is the sole normalized source for the public deletedIds array.';
COMMENT ON COLUMN bolao.pool_entry_tombstone.legacy_entry_id IS
  'The deleted entry''s id in the legacy document. There is deliberately no FK to pool_entries: the whole point is that no such row exists or ever will.';
COMMENT ON COLUMN bolao.pool_entry_tombstone.observed_at IS
  'When this campaign OBSERVED the deletion in the source document — not when the entry was deleted. The document records no deletion timestamp and none is invented here.';

CREATE UNIQUE INDEX IF NOT EXISTS pool_entry_tombstone_pool_id_legacy_entry_id_uidx
  ON bolao.pool_entry_tombstone (pool_id, legacy_entry_id);

ALTER TABLE bolao.pool_entry_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.pool_entry_tombstone FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.pool_entry_tombstone FROM PUBLIC;

-- RLS enabled with ZERO policies denies every non-owner, non-BYPASSRLS role. That is the intended
-- end state, not an unfinished one: nothing reads this table directly. The public read surface
-- reaches it through a function whose own privilege boundary is the thing being granted.

COMMIT;

-- One legacy id per pool, built CONCURRENTLY and therefore outside any transaction block.
-- `pool_entries` is populated (46 rows), and a populated table gets the concurrent build — the
-- fact that 46 rows would lock for microseconds is not the point: the exception is how the habit
-- is lost. `pool_entry_tombstone`'s index above is inside the transaction because that table is
-- created empty in the same statement batch, where CONCURRENTLY is both impossible and pointless.
--
-- Scoped to the pool rather than global because the id space is per-document: three independent
-- apps minted uuids independently, so a global unique would constrain a coincidence rather than a
-- fact. Partial, so the 0-row intermediate state and any future entry with no legacy ancestor are
-- both legal.
--
-- A concurrent build can fail and leave an INVALID index that is still maintained on every write,
-- so the postchecks assert pg_index.indisvalid rather than mere existence.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS pool_entries_pool_id_legacy_entry_id_uidx
  ON bolao.pool_entries (pool_id, legacy_entry_id) WHERE legacy_entry_id IS NOT NULL;
