--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813160000_cdb_schedule_and_topology_mirror.sql
--
-- ═══ THE RECURRING DRIFT PATHS, CLOSED AT THE WRITER ═════════════════════════════════════════
--
-- 20260813140000/150000 mirrored participant pick saves. The parity harness then found four more
-- differences, and none of them was a stale value that a backfill could fix — each had a LIVE
-- WRITER that would recreate it on the next operation:
--
--   phases.<p>.cutoffAt                  set-cutoff                → cutoff_at was NULL
--   phases.<p>.ties.*.matches.*.kickoff  backfill-kickoff          → kickoff_at was NULL
--   phases.<p>.topology.*                cdb_register_bracket_topology / _refresh → absent
--   entries.<id>.updatedAt               cdb_save_my_picks         → fixed in 20260813150000
--
-- The first three all funnel through THREE functions. This migration mirrors all three.
--
-- ═══ WHY THE MIRROR READS THE RESULT, NOT THE PAYLOAD ════════════════════════════════════════
--
-- `cdb_apply_operator_mutation` has TWELVE mutation kinds — set-payment, delete-entry, set-cutoff,
-- set-active-phase, lock-tie, unlock-tie, remove-tie, save-leg, clear-leg, backfill-kickoff,
-- set-official-draw, set-schedule-provenance, create-tie. The obvious implementation is a
-- twelve-branch mirror that interprets each payload.
--
-- It is refused. Twelve branches is twelve chances to interpret a payload differently from the way
-- the function immediately above interpreted it, and the first branch to disagree wins silently —
-- the exact "second business rule engine" failure the pick mirror was written to avoid. A
-- thirteenth kind added later would also silently mirror nothing.
--
-- So the mirror runs ONCE, after the dispatch, and reads `v_state` — the authoritative document
-- the function has just finished computing. It reconciles the normalized model to that. It cannot
-- disagree with legacy semantics because it reads legacy's own output, and a new mutation kind is
-- covered the day it is added without touching this code.
--
-- ═══ SCOPED TO THE AFFECTED PHASE ════════════════════════════════════════════════════════════
--
-- Reading the whole document does not mean writing the whole model. The reconciler takes ONE phase
-- slug and touches only that phase's row, its ties and their matches. Entry-scoped kinds
-- (set-payment, delete-entry) carry no phaseId and are mirrored to their own relations instead.
--
-- WHOLE_DOCUMENT_WRITERS stays 0: no path here rewrites the document or the model wholesale.
--
-- ═══ TOPOLOGY IS CLASS A — PUBLIC BEHAVIOR REQUIRED ══════════════════════════════════════════
--
-- Classified rather than assumed. `bolao/cdb2026/js/app.js` gates on it:
--
--     const valid = !!(topo && topologyProvenanceIsValid(topo.provenance) && topo.slots);
--     if (!valid) return { phaseId, topologyKnown: false, slots: [], ... }
--
-- and `topologyKnown: false` renders NO semifinal slots. So the topology record AND its provenance
-- are load-bearing for what a participant sees — not diagnostics, not forensics, not dead. They
-- must be in the public normalized contract or the semifinal disappears at cutover.
--
-- It is also not PII and not device forensics: it is a sourcing record naming CBF and two named
-- news outlets with quoted passages. Publishing it is what the legacy contract already does.
--
-- STORED AS THE SOURCE RECORD, in one jsonb column, following the pattern
-- `competition_edition_phases.official_draw` already established for an externally-authored draw
-- record. Decomposing `slots` into relational forward-slot rows was considered and refused: the
-- slots name ties (`sf-1`, `sf-2`) that do not exist in `bolao.ties` and that this campaign has
-- twice declined to invent, so a relational model would have to fabricate the very rows the source
-- says are still undetermined. The source record is preserved exactly; nothing is derived from it.
--
-- ═══ scheduleProvenance IS CLASS C ═══════════════════════════════════════════════════════════
--
-- `phases.<p>.scheduleProvenance` — competition, source, fetchedAt, firstKickoff, cutoffRule — is
-- written by the same reconciler but read by NO application code: the only reference in the
-- repository is the script that writes it. Unlike `topology.provenance`, no render gates on it.
-- It is therefore diagnostic, stays in legacy, and is NOT added to the public normalized contract.
-- Recorded here so its absence is a decision rather than an oversight.
--
-- ═══ RESULTS AND PREDICTIONS ARE NOT THIS MIRROR'S DOMAIN ════════════════════════════════════
--
-- `save-leg`/`clear-leg` change `matches.<leg>.goalsHome/goalsAway`, which the read contract serves
-- from `bolao.match_results`. Those ARE reconciled here — but predictions are not touched by any
-- path in this file. Picks belong to the entry mirror, and a schedule sync that could move a
-- participant's prediction would be a bug with a very long tail.
--
-- ═══ NO MIGRATION LINEAGE ════════════════════════════════════════════════════════════════════
--
-- Every write here is a RUNTIME operation. None creates an `audit.migration_lineage` row. Where a
-- reconcile removes a match_result that was originally migrated, its lineage is removed with it so
-- nothing points at a row that no longer exists — the same rule the pick mirror follows.
--
-- ═══ CLASSIFICATION ═════════════════════════════════════════════════════════════════════════
--
-- TOURNAMENT_SPECIFIC (cdb2026) · ADDITIVE_DDL (one nullable jsonb column) + three function
-- replacements. No business rule added or removed; every acceptance check in every mutation kind
-- is untouched and still runs before the mirror is reached. BR and Copa are not referenced.
--
-- ROLLBACK (FULL). Restore the three functions from the .rollback.sql and drop the column. Legacy
-- was the write authority throughout, so no accepted write is at risk; what returns is the drift.
--
-- PRECHECKS: the three functions exist · bolao.pool_entries.legacy_entry_id backfilled ·
--            20260813140000 and 20260813150000 applied · verified backup
-- POSTCHECKS: a set-cutoff, a backfill-kickoff, a topology registration and a pick save each leave
--             legacy and normalized in parity · re-running any of them changes nothing · a forced
--             normalized failure rolls the legacy write back · zero new migration lineage
--

BEGIN;

-- ─── THE SOURCE-RECORDED TOPOLOGY ────────────────────────────────────────────────────────────

ALTER TABLE bolao.competition_edition_phases ADD COLUMN IF NOT EXISTS bracket_topology jsonb;

COMMENT ON COLUMN bolao.competition_edition_phases.bracket_topology IS
  'The source-recorded bracket topology for this phase: {slots, provenance}, exactly as the CBF draw record was ingested. Public-behavior-required, not diagnostic — cdb2026 renders no slots for a phase whose topology provenance does not validate. Stored as the source record rather than decomposed into forward-slot rows because the slots name ties that do not yet exist, and relational modelling would have to invent them.';

-- ─── THE INVARIANT THE RECONCILER UPSERTS ON ────────────────────────────────────────────────
--
-- A tie has at most one first leg and one second leg. That was always true and was never declared,
-- so `bolao.matches` carried no unique key on (tie_id, leg) and the reconciler's ON CONFLICT had
-- nothing to infer — caught by the disposable run, which failed with "no unique or exclusion
-- constraint matching the ON CONFLICT specification" rather than by review.
--
-- Partial on tie_id IS NOT NULL because Copa's 104 matches have no tie at all: they are single
-- fixtures, not two-legged confrontos, and a global unique would be a constraint on a coincidence.
CREATE UNIQUE INDEX IF NOT EXISTS matches_tie_id_leg_uidx
  ON bolao.matches (tie_id, leg) WHERE tie_id IS NOT NULL;

-- ─── THE PHASE RECONCILER ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION bolao.cdb_mirror_phase(p_phase_slug text, p_phase jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $mirror$
declare
  v_edition uuid;
  v_phase   uuid;
  v_touched integer := 0;
begin
  if p_phase_slug is null or p_phase is null or jsonb_typeof(p_phase) <> 'object' then
    return 0;                       -- an entry-scoped mutation carries no phase; nothing to do.
  end if;

  select pl.competition_edition_id into v_edition from bolao.pools pl where pl.slug = 'cdb2026';
  select ph.competition_edition_phase_id into v_phase
    from bolao.competition_edition_phases ph
   where ph.competition_edition_id = v_edition and ph.slug = p_phase_slug;

  -- A phase the normalized model has never heard of is NOT silently skipped: the read surface
  -- would then serve a document missing a phase the legacy one has.
  if v_phase is null then
    raise exception 'MIRROR_DIVERGENCE: phase % has no normalized row', p_phase_slug;
  end if;

  -- ── phase-level facts ───────────────────────────────────────────────────────────────────────
  update bolao.competition_edition_phases ph
     set cutoff_at        = nullif(p_phase->>'cutoffAt','')::timestamptz,
         cutoff_offset_ms = (p_phase->>'cutoffOffsetMs')::bigint,
         official_draw    = case when jsonb_typeof(p_phase->'officialDraw') = 'object'
                                 then p_phase->'officialDraw' end,
         bracket_topology = case when jsonb_typeof(p_phase->'topology') = 'object'
                                 then p_phase->'topology' end
   where ph.competition_edition_phase_id = v_phase;

  -- ── ties ────────────────────────────────────────────────────────────────────────────────────
  -- A tie the document no longer carries is removed, because remove-tie is a real mutation kind
  -- and a normalized tie that outlived its document entry would be served as a live confronto.
  delete from bolao.matches m
   where m.tie_id in (select ti.tie_id from bolao.ties ti
                       where ti.competition_edition_phase_id = v_phase
                         and not (p_phase->'ties' ? ti.slug));
  delete from bolao.ties ti
   where ti.competition_edition_phase_id = v_phase
     and not (coalesce(p_phase->'ties','{}'::jsonb) ? ti.slug);

  insert into bolao.ties (competition_edition_phase_id, slug, team_a, team_b,
                          qualified_side, locked_at, locked_by)
  select v_phase, t.slug, t.tie->>'teamA', t.tie->>'teamB',
         nullif(t.tie->>'qualifiedTeamId','')::char(1),
         nullif(t.tie->>'lockedAt','')::timestamptz,
         nullif(t.tie->>'lockedBy','')
    from jsonb_each(coalesce(p_phase->'ties','{}'::jsonb)) as t(slug, tie)
  on conflict (competition_edition_phase_id, slug) do update
     set team_a         = excluded.team_a,
         team_b         = excluded.team_b,
         qualified_side = excluded.qualified_side,
         locked_at      = excluded.locked_at,
         locked_by      = excluded.locked_by;

  -- ── legs ────────────────────────────────────────────────────────────────────────────────────
  insert into bolao.matches (tie_id, competition_edition_phase_id, leg,
                             home_team, away_team, kickoff_at, status, venue, city)
  select ti.tie_id, v_phase,
         case lg.key when 'first' then 1 when 'second' then 2 when 'single' then 1 end,
         lg.leg->>'homeTeam', lg.leg->>'awayTeam',
         nullif(lg.leg->>'kickoff','')::timestamptz,
         (case lg.leg->>'status' when 'FINAL' then 'finished' when 'SCHEDULED' then 'scheduled' end)::bolao.match_status,
         lg.leg->>'venue', lg.leg->>'city'
    from jsonb_each(coalesce(p_phase->'ties','{}'::jsonb)) as t(slug, tie)
    join bolao.ties ti on ti.competition_edition_phase_id = v_phase and ti.slug = t.slug
    cross join lateral jsonb_each(coalesce(t.tie->'matches','{}'::jsonb)) as lg(key, leg)
   where case lg.key when 'first' then 1 when 'second' then 2 when 'single' then 1 end is not null
  -- The index is PARTIAL, so its predicate has to be repeated here or PostgreSQL cannot infer it
  -- and reports "no unique or exclusion constraint matching the ON CONFLICT specification".
  on conflict (tie_id, leg) where tie_id is not null do update
     set home_team  = excluded.home_team,
         away_team  = excluded.away_team,
         kickoff_at = excluded.kickoff_at,
         status     = excluded.status,
         venue      = excluded.venue,
         city       = excluded.city;

  -- ── results ─────────────────────────────────────────────────────────────────────────────────
  -- clear-leg removes a score, so a result the document no longer carries must go. Its migration
  -- lineage goes with it: a lineage row describing a target that no longer exists is an orphan,
  -- and ORPHANED is a metric this campaign holds at 0.
  delete from audit.migration_lineage l
   where l.target_relation = 'match_results'
     and l.target_row_id in (
       select mr.match_result_id
         from bolao.match_results mr
         join bolao.matches m on m.match_id = mr.match_id
         join bolao.ties ti on ti.tie_id = m.tie_id
        where ti.competition_edition_phase_id = v_phase
          and (p_phase->'ties'->ti.slug->'matches'
                 ->(case m.leg when 1 then 'first' when 2 then 'second' end)->>'goalsHome') is null);

  delete from bolao.match_results mr
   using bolao.matches m, bolao.ties ti
   where mr.match_id = m.match_id and m.tie_id = ti.tie_id
     and ti.competition_edition_phase_id = v_phase
     and (p_phase->'ties'->ti.slug->'matches'
            ->(case m.leg when 1 then 'first' when 2 then 'second' end)->>'goalsHome') is null;

  insert into bolao.match_results (match_id, goals_home, goals_away, is_official, source)
  select m.match_id,
         (lg.leg->>'goalsHome')::int, (lg.leg->>'goalsAway')::int, true,
         case when lg.leg->>'resultSource' = 'espn-auto' then 'espn' else 'legacy_unrecorded' end
    from jsonb_each(coalesce(p_phase->'ties','{}'::jsonb)) as t(slug, tie)
    join bolao.ties ti on ti.competition_edition_phase_id = v_phase and ti.slug = t.slug
    cross join lateral jsonb_each(coalesce(t.tie->'matches','{}'::jsonb)) as lg(key, leg)
    join bolao.matches m on m.tie_id = ti.tie_id
     and m.leg = case lg.key when 'first' then 1 when 'second' then 2 when 'single' then 1 end
   where (lg.leg->>'goalsHome') is not null and (lg.leg->>'goalsAway') is not null
  on conflict (match_id) where superseded_by_id is null and is_official do update
     set goals_home = excluded.goals_home,
         goals_away = excluded.goals_away,
         source     = excluded.source;

  select count(*) into v_touched from jsonb_each(coalesce(p_phase->'ties','{}'::jsonb));
  return v_touched;
end $mirror$;

COMMENT ON FUNCTION bolao.cdb_mirror_phase(text, jsonb) IS
  'Reconciles the normalized model for ONE cdb2026 phase to the authoritative legacy phase object it is handed. Reads the RESULT of a mutation rather than its payload, so it cannot interpret a payload differently from the function that just applied it and so a new mutation kind is covered without changing this code. Writes no migration lineage; removes lineage alongside any result it removes.';

REVOKE ALL ON FUNCTION bolao.cdb_mirror_phase(text, jsonb) FROM PUBLIC;

-- ─── ENTRY-SCOPED MUTATIONS ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION bolao.cdb_mirror_entry_scoped(p_state jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $mirror$
declare
  v_pool uuid;
  v_n    integer := 0;
begin
  select pl.pool_id into v_pool from bolao.pools pl where pl.slug = 'cdb2026';

  -- `paid` — the KPLUS-OP-4A model. A confirmation is a POSITIVE assertion only, so set-payment
  -- with value=false REMOVES the assertion rather than storing a negative: the legacy contract has
  -- never recorded a stored false, and inventing one here would be a financial claim the source
  -- does not make.
  delete from bolao.entry_payment_confirmation c
   where c.pool_id = v_pool
     and coalesce(p_state->'paid'->>(c.source_entry_key::text), 'false') <> 'true';

  insert into bolao.entry_payment_confirmation
    (pool_id, source_entry_key, pool_entry_id, entry_disposition, confirmed_paid,
     source_relation, source_path, source_fingerprint, migration_run_id, transform_version)
  select v_pool, k.key::uuid, pe.pool_entry_id,
         case when pe.pool_entry_id is not null then 'CURRENT_ENTRY' else 'HISTORICAL_TOMBSTONED' end,
         true, 'public.bolao_state',
         'bolao_state[cdb2026].paid[' || k.key || '] -> entry_payment_confirmation',
         encode(sha256(p_state::text::bytea),'hex'),
         '00000000-0000-0000-0000-000000000000'::uuid, 'runtime-operator-mutation/1'
    from jsonb_each(coalesce(p_state->'paid','{}'::jsonb)) as k(key, value)
    left join bolao.pool_entries pe on pe.pool_id = v_pool and pe.legacy_entry_id = k.key::uuid
   where k.value = 'true'::jsonb
     and (pe.pool_entry_id is not null
          or exists (select 1 from bolao.pool_entry_tombstone t
                      where t.pool_id = v_pool and t.legacy_entry_id = k.key::uuid))
  on conflict (pool_id, source_entry_key) do nothing;

  -- `deletedIds` — tombstones. Additive only: an id that leaves the array is not un-deleted,
  -- because the legacy contract has no un-delete and removing a tombstone would resurrect an entry.
  insert into bolao.pool_entry_tombstone (pool_id, legacy_entry_id)
  select v_pool, d.v::uuid
    from jsonb_array_elements_text(coalesce(p_state->'deletedIds','[]'::jsonb)) as d(v)
  on conflict (pool_id, legacy_entry_id) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $mirror$;

COMMENT ON FUNCTION bolao.cdb_mirror_entry_scoped(jsonb) IS
  'Reconciles cdb2026 entry-scoped normalized facts — payment confirmations and tombstones — to the authoritative document. A paid flag that is no longer true removes the assertion rather than storing a negative, because the legacy contract only ever recorded positives. Tombstones are additive: the document has no un-delete.';

REVOKE ALL ON FUNCTION bolao.cdb_mirror_entry_scoped(jsonb) FROM PUBLIC;

-- ─── ACTIVE PHASE ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION bolao.cdb_mirror_sync_state(p_state jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $mirror$
declare
  v_edition uuid;
begin
  select pl.competition_edition_id into v_edition from bolao.pools pl where pl.slug = 'cdb2026';
  update bolao.sync_state ss
     set active_phase_id = (select ph.competition_edition_phase_id
                              from bolao.competition_edition_phases ph
                             where ph.competition_edition_id = v_edition
                               and ph.slug = p_state->'espnSync'->>'activePhaseId'),
         seed_flags = (p_state->'espnSync') - 'activePhaseId'
   where ss.competition_edition_id = v_edition;
end $mirror$;

COMMENT ON FUNCTION bolao.cdb_mirror_sync_state(jsonb) IS
  'Reconciles bolao.sync_state to the authoritative document''s espnSync/activePhase. Kept separate from the phase reconciler because set-active-phase names no phase to reconcile — it names which phase is active.';

REVOKE ALL ON FUNCTION bolao.cdb_mirror_sync_state(jsonb) FROM PUBLIC;

-- ─── THE ENTRY STAMP, TRUNCATED THE WAY LEGACY TRUNCATES IT ──────────────────────────────────
--
-- 20260813150000 had the mirror store `v_agora` — the raw clock, microseconds and all. But the
-- legacy write does not store the clock: it stores
--
--     to_char(v_agora at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
--
-- which TRUNCATES to whole seconds. So legacy recorded `...01:07:03Z` while the normalized side
-- recorded `...01:07:03.934377`, and the projection faithfully re-emitted the microseconds nobody
-- had written down. Caught by the disposable re-drift run on the very first participant save.
--
-- The mirror records what the authoritative write recorded, not what the clock said at the moment
-- it ran. The truncation belongs here rather than in the projection because it is a fact about the
-- legacy write, not about how a value is displayed.
--
-- It matters beyond formatting: `mergeStates()` compares entry `updatedAt` as a STRING, so a
-- server value carrying extra digits sorts after the browser's copy of the same instant and would
-- make every returning client believe the server was newer than the entry it already holds.
CREATE OR REPLACE FUNCTION bolao.cdb_mirror_entry_picks(p_pool_entry_id uuid, p_picks jsonb, p_updated_at timestamptz)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $mirror$
declare
  v_now     timestamptz := now();
  v_stamp   timestamptz := date_trunc('second', p_updated_at);
  v_written integer;
begin
  if p_pool_entry_id is null then
    raise exception 'cdb_mirror_entry_picks: pool_entry_id obrigatorio';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'cdb_mirror_entry_picks: picks precisa ser objeto';
  end if;

  update bolao.pool_entries set content_updated_at = v_stamp where pool_entry_id = p_pool_entry_id;

  create temporary table _mirror_want (
    match_id uuid, tie_id uuid, goals_home int, goals_away int, side char(1)
  ) on commit drop;

  insert into _mirror_want (match_id, goals_home, goals_away)
  select m.match_id, (lk.value->>'goalsHome')::int, (lk.value->>'goalsAway')::int
    from jsonb_each(coalesce(p_picks->'matches','{}'::jsonb)) as t(slug, legs)
    cross join lateral jsonb_each(t.legs) as lk(key, value)
    join bolao.ties ti on ti.slug = t.slug
    join bolao.matches m on m.tie_id = ti.tie_id
     and m.leg = case lk.key when 'first' then 1 when 'second' then 2 when 'single' then 1 end
   where case lk.key when 'first' then 1 when 'second' then 2 when 'single' then 1 end is not null;

  insert into _mirror_want (tie_id, side)
  select ti.tie_id, qq.value #>> '{}'
    from jsonb_each(coalesce(p_picks->'qualified','{}'::jsonb)) as qq(key, value)
    join bolao.ties ti on ti.slug = qq.key
   where jsonb_typeof(qq.value) = 'string';

  delete from audit.migration_lineage l
   where l.target_relation = 'predictions'
     and l.target_row_id in (
       select p.prediction_id from bolao.predictions p
        where p.pool_entry_id = p_pool_entry_id
          and not exists (select 1 from _mirror_want w
                           where w.match_id is not distinct from p.match_id
                             and w.tie_id   is not distinct from p.tie_id));

  delete from bolao.predictions p
   where p.pool_entry_id = p_pool_entry_id
     and not exists (select 1 from _mirror_want w
                      where w.match_id is not distinct from p.match_id
                        and w.tie_id   is not distinct from p.tie_id);

  insert into bolao.predictions (pool_entry_id, match_id, predicted_goals_home, predicted_goals_away, mirrored_at)
  select p_pool_entry_id, w.match_id, w.goals_home, w.goals_away, v_now
    from _mirror_want w where w.match_id is not null
  on conflict (pool_entry_id, match_id) where match_id is not null
  do update set predicted_goals_home = excluded.predicted_goals_home,
                predicted_goals_away = excluded.predicted_goals_away,
                mirrored_at          = excluded.mirrored_at;

  insert into bolao.predictions (pool_entry_id, tie_id, predicted_qualified_side, mirrored_at)
  select p_pool_entry_id, w.tie_id, w.side, v_now
    from _mirror_want w where w.tie_id is not null
  on conflict (pool_entry_id, tie_id) where tie_id is not null
  do update set predicted_qualified_side = excluded.predicted_qualified_side,
                mirrored_at              = excluded.mirrored_at;

  select count(*) into v_written from _mirror_want;

  if exists (
    select 1 from (select coalesce(w.match_id::text,'') || '|' || coalesce(w.tie_id::text,'') as k,
                          w.goals_home, w.goals_away, w.side from _mirror_want w) w
     full outer join (select coalesce(p.match_id::text,'') || '|' || coalesce(p.tie_id::text,'') as k,
                             p.predicted_goals_home gh, p.predicted_goals_away ga,
                             p.predicted_qualified_side sd
                        from bolao.predictions p where p.pool_entry_id = p_pool_entry_id) g
       on g.k = w.k
     where w.k is null or g.k is null
        or g.gh is distinct from w.goals_home
        or g.ga is distinct from w.goals_away
        or g.sd is distinct from w.side
  ) then
    raise exception 'MIRROR_DIVERGENCE: normalized pick set does not equal the accepted pick set for entry %', p_pool_entry_id;
  end if;

  if not exists (select 1 from bolao.pool_entries
                  where pool_entry_id = p_pool_entry_id and content_updated_at = v_stamp) then
    raise exception 'MIRROR_DIVERGENCE: entry timestamp not mirrored for entry %', p_pool_entry_id;
  end if;

  return v_written;
end $mirror$;

REVOKE ALL ON FUNCTION bolao.cdb_mirror_entry_picks(uuid, jsonb, timestamptz) FROM PUBLIC;

COMMIT;

-- ═══ THE THREE WRITERS, EACH MIRRORING BEFORE IT COMMITS ════════════════════════════════════


-- ── writer 1 of 3: the operator mutation RPC (12 kinds) ──

CREATE OR REPLACE FUNCTION public.cdb_apply_operator_mutation(p_type text, p_payload jsonb, p_actor text, p_client_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_state jsonb;
  v_fase text;
  v_tie text;
  v_agora timestamptz := now();
  v_iso text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_idx int;
  v_entry jsonb;
  v_antes jsonb;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cdb_apply_operator_mutation: actor obrigatorio (auditoria)';
  end if;
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'cdb_apply_operator_mutation: client_ref obrigatorio (idempotencia)';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'cdb_apply_operator_mutation: payload precisa ser objeto';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then
    raise exception 'cdb_apply_operator_mutation: estado do cdb2026 inexistente';
  end if;

  -- IDEMPOTENCIA: a mesma operacao reenviada (clique duplo, retry) nao se aplica duas vezes.
  if exists (select 1 from jsonb_array_elements(coalesce(v_state->'auditLog','[]'::jsonb)) a
              where a->>'clientRef' = p_client_ref) then
    return jsonb_build_object('applied', false, 'reason', 'idempotente');
  end if;

  v_antes := v_state;

  -- ── despacho por tipo ─────────────────────────────────────────────────
  if p_type = 'set-payment' then
    if p_payload->>'entryId' is null then
      raise exception 'set-payment: entryId obrigatorio';
    end if;
    if jsonb_typeof(p_payload->'value') <> 'boolean' then
      raise exception 'set-payment: value precisa ser booleano';
    end if;
    if not exists (select 1 from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) e
                    where e->>'id' = p_payload->>'entryId') then
      raise exception 'set-payment: entrada % inexistente', p_payload->>'entryId';
    end if;
    v_state := jsonb_set(v_state, array['paid', p_payload->>'entryId'], p_payload->'value');

  elsif p_type = 'delete-entry' then
    if p_payload->>'entryId' is null then
      raise exception 'delete-entry: entryId obrigatorio';
    end if;
    -- Lapide, nunca remocao fisica: a entrada some da UI e continua auditavel.
    v_state := jsonb_set(v_state, '{deletedIds}',
                 (select jsonb_agg(distinct x) from (
                    select jsonb_array_elements_text(coalesce(v_state->'deletedIds','[]'::jsonb)) as x
                    union select p_payload->>'entryId') u));

  elsif p_type = 'set-cutoff' then
    v_fase := p_payload->>'phaseId';
    if v_fase is null or v_state->'phases'->v_fase is null then
      raise exception 'set-cutoff: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if p_payload->>'cutoffAt' is not null then
      perform (p_payload->>'cutoffAt')::timestamptz;   -- levanta se nao for instante valido
    end if;
    v_state := jsonb_set(v_state, array['phases', v_fase, 'cutoffAt'],
                 coalesce(p_payload->'cutoffAt', 'null'::jsonb));

  elsif p_type = 'set-active-phase' then
    v_fase := p_payload->>'phaseId';
    if v_fase is not null and v_state->'phases'->v_fase is null then
      raise exception 'set-active-phase: fase % inexistente', v_fase;
    end if;
    -- OS DOIS CAMPOS, e este e um defeito corrigido, nao um enfeite.
    --
    -- `entryCutoffMs()` no js/app.js le `s.espnSync.activePhaseId`, NAO `s.activePhase`. Gravar so
    -- o segundo foi exatamente o incidente que o operator_cli.py documenta: o banco passou a dizer
    -- "quartas", o app continuou em "oitavas" -- cujo prazo ja vencera -- e tratou a entrada como
    -- ENCERRADA. Os confrontos estavam em producao, o formulario existia no DOM, e nenhum
    -- participante via nada. O CLI ja gravava os dois; esta RPC gravava so um.
    v_state := jsonb_set(v_state, '{activePhase}', coalesce(p_payload->'phaseId','null'::jsonb));
    v_state := jsonb_set(v_state, '{espnSync}',
                 coalesce(v_state->'espnSync','{}'::jsonb)
                 || jsonb_build_object('activePhaseId', coalesce(p_payload->'phaseId','null'::jsonb)), true);

  elsif p_type in ('lock-tie','unlock-tie') then
    v_fase := p_payload->>'phaseId'; v_tie := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception '%: confronto %/% inexistente', p_type, v_fase, v_tie;
    end if;
    if p_type = 'lock-tie' then
      -- NUNCA SOBRESCREVER UM CONFRONTO JA TRAVADO.
      --
      -- Quem avanca define pontuacao e premio, e ao travar o resultado ja foi comunicado.
      -- Retravar com o MESMO lado e no-op (retry/reexecucao nao podem virar erro); com lado
      -- DIFERENTE e recusado. Corrigir exige unlock-tie: ato deliberado, nao efeito colateral.
      if v_state->'phases'->v_fase->'ties'->v_tie->>'qualifiedTeamId' is not null then
        if v_state->'phases'->v_fase->'ties'->v_tie->>'qualifiedTeamId'
           is distinct from (p_payload->>'qualifiedTeamId') then
          raise exception 'lock-tie: %/% ja travado com %; use unlock-tie antes de mudar',
            v_fase, v_tie, v_state->'phases'->v_fase->'ties'->v_tie->>'qualifiedTeamId';
        end if;
        return jsonb_build_object('applied', false, 'reason', 'ja travado com o mesmo lado');
      end if;
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie],
        v_state->'phases'->v_fase->'ties'->v_tie
        || jsonb_build_object('locked', true, 'lockedAt', v_iso,
                              'lockedBy', p_actor,
                              'qualifiedTeamId', p_payload->'qualifiedTeamId'));
    else
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie],
        (v_state->'phases'->v_fase->'ties'->v_tie - 'locked' - 'lockedAt' - 'lockedBy'));
    end if;

  elsif p_type = 'remove-tie' then
    v_fase := p_payload->>'phaseId'; v_tie := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception 'remove-tie: confronto %/% inexistente', v_fase, v_tie;
    end if;
    -- Confronto travado guarda resultado oficial: destravar e um ato deliberado e separado.
    if coalesce((v_state->'phases'->v_fase->'ties'->v_tie->>'locked')::boolean,false) then
      raise exception 'remove-tie: confronto %/% esta travado; destrave primeiro', v_fase, v_tie;
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties'],
                 (v_state->'phases'->v_fase->'ties') - v_tie);


  -- ── PLATFORM-WHOLE-DOC-WRITERS: as quatro operacoes que faltavam ──────────────────────────
  --
  -- Ate aqui, gravar um placar do cdb2026 so era possivel reescrevendo o DOCUMENTO INTEIRO --
  -- `send_result_email.py` e `operator_cli.py` liam, mudavam um campo em Python e regravavam o
  -- todo. Duas gravacoes concorrentes de legs diferentes perdiam uma. O contrato abaixo foi
  -- DERIVADO desses dois scripts, campo a campo, nao copiado do copa2026: o cdb tem confronto de
  -- duas maos e o copa nao, e a convencao de mando da volta e do proprio cdb.

  elsif p_type = 'save-leg' then
    v_fase := p_payload->>'phaseId';
    v_tie  := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception 'save-leg: confronto %/% inexistente', coalesce(v_fase,'(nula)'), coalesce(v_tie,'(nulo)');
    end if;
    if p_payload->>'leg' not in ('first','second') then
      raise exception 'save-leg: leg precisa ser first ou second, veio %', coalesce(p_payload->>'leg','(nulo)');
    end if;
    -- Teste de TIPO, nunca de verdade: 0-0 e um placar real e um `if (!goals)` o descartaria.
    if jsonb_typeof(p_payload->'goalsHome') <> 'number' or jsonb_typeof(p_payload->'goalsAway') <> 'number' then
      raise exception 'save-leg: goalsHome e goalsAway precisam ser numeros';
    end if;
    -- MANDO DE CAMPO DA VOLTA. A segunda mao inverte: home=teamB, away=teamA. Isto e regra do
    -- cdb2026 (send_result_email.py sb_save_leg, espelhando renderAdminResults no app.js) e e
    -- calculada AQUI a partir do confronto gravado -- nunca aceita do chamador, senao o cliente
    -- poderia declarar o mando ao contrario e o placar entraria trocado.
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie,'matches',p_payload->>'leg'],
      coalesce(v_state->'phases'->v_fase->'ties'->v_tie->'matches'->(p_payload->>'leg'), '{}'::jsonb)
      || jsonb_build_object(
           'homeTeam', case when p_payload->>'leg' = 'second'
                            then v_state->'phases'->v_fase->'ties'->v_tie->'teamB'
                            else v_state->'phases'->v_fase->'ties'->v_tie->'teamA' end,
           'awayTeam', case when p_payload->>'leg' = 'second'
                            then v_state->'phases'->v_fase->'ties'->v_tie->'teamA'
                            else v_state->'phases'->v_fase->'ties'->v_tie->'teamB' end,
           'goalsHome', p_payload->'goalsHome',
           'goalsAway', p_payload->'goalsAway',
           'status', 'FINAL',
           'resultSource', coalesce(p_payload->>'resultSource','espn-auto')), true);

  elsif p_type = 'clear-leg' then
    -- RETRATACAO, e ela e composta de proposito: limpar o placar sem destravar o confronto
    -- deixaria um classificado apoiado num resultado que nao existe mais. Os dois campos andam
    -- juntos porque o script que isto substitui ja os movia juntos.
    v_fase := p_payload->>'phaseId';
    v_tie  := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception 'clear-leg: confronto %/% inexistente', coalesce(v_fase,'(nula)'), coalesce(v_tie,'(nulo)');
    end if;
    if p_payload->>'leg' not in ('first','second') then
      raise exception 'clear-leg: leg precisa ser first ou second';
    end if;
    if v_state->'phases'->v_fase->'ties'->v_tie->'matches'->(p_payload->>'leg') is not null then
      -- NULL explicito, nao remocao da chave: o app distingue "sem resultado" de "sem jogo".
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie,'matches',p_payload->>'leg'],
        (v_state->'phases'->v_fase->'ties'->v_tie->'matches'->(p_payload->>'leg'))
        || jsonb_build_object('goalsHome', 'null'::jsonb, 'goalsAway', 'null'::jsonb, 'status', 'SCHEDULED'), true);
    end if;
    if coalesce(v_state->'phases'->v_fase->'ties'->v_tie->>'qualifiedTeamId','') <> '' then
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie],
        (v_state->'phases'->v_fase->'ties'->v_tie)
        || jsonb_build_object('qualifiedTeamId','null'::jsonb,'lockedAt','null'::jsonb,'lockedBy','null'::jsonb), true);
    end if;

  elsif p_type = 'backfill-kickoff' then
    -- So o horario. NAO toca placar, status nem classificacao: o backfill de agenda roda depois
    -- que a ESPN publica a tabela detalhada, e um leg ja finalizado nao pode voltar a SCHEDULED
    -- porque a data chegou atrasada.
    v_fase := p_payload->>'phaseId';
    v_tie  := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie->'matches'->(p_payload->>'leg') is null then
      raise exception 'backfill-kickoff: leg %/%/% inexistente', coalesce(v_fase,'(nula)'), coalesce(v_tie,'(nulo)'), coalesce(p_payload->>'leg','(nulo)');
    end if;
    if p_payload->>'kickoff' is null then
      raise exception 'backfill-kickoff: kickoff obrigatorio';
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie,'matches',p_payload->>'leg','kickoff'],
                         to_jsonb(p_payload->>'kickoff'), true);

  elsif p_type = 'set-official-draw' then
    -- A PROVENIENCIA do sorteio, e ela mora DENTRO da fase, nao na raiz do estado. O
    -- operator_cli.py registra que a primeira versao gravou na raiz e os confrontos ficaram
    -- invisiveis, porque `enforceDrawLifecycle` procura `phase.officialDraw`.
    --
    -- O objeto passa INTEIRO e sem interpretacao: authority, source, sourceUrl, corroboratedBy,
    -- bracketHash, ingestedAt, scheduledAt, validatedAt, validatedBy, note. Reescrever qualquer
    -- um deles aqui seria inventar procedencia de sorteio oficial.
    v_fase := p_payload->>'phaseId';
    if v_state->'phases'->v_fase is null then
      raise exception 'set-official-draw: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if jsonb_typeof(p_payload->'officialDraw') <> 'object' then
      raise exception 'set-official-draw: officialDraw precisa ser objeto';
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'officialDraw'], p_payload->'officialDraw', true);

  elsif p_type = 'set-schedule-provenance' then
    -- A procedencia da AGENDA, irma de set-official-draw e deliberadamente separada dela: um
    -- sorteio e uma tabela de horarios sao duas afirmacoes diferentes sobre a mesma fase, com
    -- fontes e instantes diferentes. Fundi-las num campo so perderia qual delas foi atualizada.
    v_fase := p_payload->>'phaseId';
    if v_state->'phases'->v_fase is null then
      raise exception 'set-schedule-provenance: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if jsonb_typeof(p_payload->'scheduleProvenance') <> 'object' then
      raise exception 'set-schedule-provenance: scheduleProvenance precisa ser objeto';
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'scheduleProvenance'],
                         p_payload->'scheduleProvenance', true);

  elsif p_type = 'create-tie' then
    -- O sorteio oficial. Cria o confronto E as duas maos numa transacao so: um confronto sem
    -- `matches` e uma estrutura pela metade que o app renderiza como jogo inexistente.
    --
    -- NAO aceita fragmento de documento. Os campos sao nomeados um a um; o que o payload trouxer
    -- alem disto e ignorado, e o que faltar levanta.
    v_fase := p_payload->>'phaseId';
    v_tie  := p_payload->>'tieId';
    if v_state->'phases'->v_fase is null then
      raise exception 'create-tie: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if v_tie is null or v_tie = '' then
      raise exception 'create-tie: tieId obrigatorio';
    end if;
    if v_state->'phases'->v_fase->'ties'->v_tie is not null then
      raise exception 'create-tie: confronto %/% ja existe — use remove-tie primeiro', v_fase, v_tie;
    end if;
    if coalesce(p_payload->>'teamA','') = '' or coalesce(p_payload->>'teamB','') = '' then
      raise exception 'create-tie: teamA e teamB obrigatorios';
    end if;
    if p_payload->>'teamA' = p_payload->>'teamB' then
      raise exception 'create-tie: um time nao joga contra si mesmo';
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie], jsonb_build_object(
      'teamA', p_payload->'teamA',
      'teamB', p_payload->'teamB',
      -- Sem classificado e sem trava: um confronto recem-sorteado nao tem vencedor. Inventar
      -- qualifiedTeamId aqui seria decidir o jogo no momento do sorteio.
      'qualifiedTeamId', 'null'::jsonb,
      'matches', jsonb_build_object(
        'first',  jsonb_build_object('homeTeam', p_payload->'teamA', 'awayTeam', p_payload->'teamB',
                                     'goalsHome','null'::jsonb,'goalsAway','null'::jsonb,
                                     'status','SCHEDULED','kickoff', coalesce(p_payload->'kickoffFirst','null'::jsonb)),
        -- A volta inverte o mando, mesma regra que save-leg aplica.
        'second', jsonb_build_object('homeTeam', p_payload->'teamB', 'awayTeam', p_payload->'teamA',
                                     'goalsHome','null'::jsonb,'goalsAway','null'::jsonb,
                                     'status','SCHEDULED','kickoff', coalesce(p_payload->'kickoffSecond','null'::jsonb))
      )), true);

  else
    -- Tipo desconhecido NUNCA e aplicado em silencio.
    raise exception 'cdb_apply_operator_mutation: tipo nao suportado: %', p_type;
  end if;

  -- ── auditoria ─────────────────────────────────────────────────────────
  v_state := jsonb_set(v_state, '{auditLog}',
    coalesce(v_state->'auditLog','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'type', p_type, 'actor', p_actor, 'at', v_iso,
      'clientRef', p_client_ref, 'payload', p_payload, 'source', 'server-rpc')));

  -- ─── NORMALIZED MIRROR (20260813160000) ────────────────────────────────────────────────
  --
  -- Same transaction as the authoritative UPDATE below. Reached only AFTER the dispatch above has
  -- accepted the mutation, so every validation still decides; this only reflects the result.
  --
  -- It reads v_state — the document this function has just finished computing — rather than
  -- p_payload. That is deliberate: twelve payload interpretations would be twelve chances to
  -- disagree with the twelve directly above, and a thirteenth mutation kind would silently mirror
  -- nothing. Reading the result cannot disagree with itself.
  --
  -- No exception handler. A mirror that cannot represent an accepted mutation must fail the whole
  -- mutation; a caught error would commit legacy beside a stale normalized model, which is the
  -- divergence being closed.
  perform bolao.cdb_mirror_phase(v_fase, v_state->'phases'->v_fase);
  perform bolao.cdb_mirror_entry_scoped(v_state);
  perform bolao.cdb_mirror_sync_state(v_state);

  update bolao_state set state = v_state, updated_at = v_agora where id = 'cdb2026';

  return jsonb_build_object('applied', true, 'type', p_type,
    'auditLogSize', jsonb_array_length(v_state->'auditLog'));
end $function$;


-- ── writer 2 of 3: cdb_register_bracket_topology ──

CREATE OR REPLACE FUNCTION public.cdb_register_bracket_topology(p_phase_id text, p_slots jsonb, p_provenance jsonb, p_actor text DEFAULT 'operator'::text, p_client_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_state      jsonb;
  v_pred       text;
  v_pred_ties  jsonb;
  v_n_pred     int;
  v_n_slots    int;
  v_slot       record;
  v_a          text;
  v_b          text;
  v_usados     text[] := '{}';
  v_atual      jsonb;
  v_iso        text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  -- Fase DERIVADA. Semifinal e final nao tem sorteio proprio; as demais tem, e registrar
  -- topologia nelas seria contornar o sorteio.
  v_pred := case p_phase_id when 'semifinal' then 'quartas'
                            when 'final'     then 'semifinal' end;
  if v_pred is null then
    raise exception 'TOPOLOGY_PHASE_NOT_DERIVED: %', p_phase_id;
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'object' then
    raise exception 'TOPOLOGY_MALFORMED: slots ausente ou nao e objeto';
  end if;

  -- Proveniencia: sem ela o app trata a topologia como nao validada.
  if coalesce(p_provenance->>'authority','') <> 'CBF' then
    raise exception 'TOPOLOGY_PROVENANCE: authority deve ser CBF (veio %)',
      coalesce(p_provenance->>'authority','(vazio)');
  end if;
  if coalesce(p_provenance->>'sourceUrl','') = ''
     or coalesce(p_provenance->>'ingestedAt','') = ''
     or coalesce(p_provenance->>'validatedAt','') = '' then
    raise exception 'TOPOLOGY_PROVENANCE: sourceUrl, ingestedAt e validatedAt sao obrigatorios';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then raise exception 'ESTADO_AUSENTE'; end if;

  v_pred_ties := v_state->'phases'->v_pred->'ties';
  if v_pred_ties is null or jsonb_typeof(v_pred_ties) <> 'object' then
    raise exception 'TOPOLOGY_PREDECESSOR_EMPTY: %', v_pred;
  end if;
  select count(*) into v_n_pred from jsonb_object_keys(v_pred_ties);
  if v_n_pred = 0 then raise exception 'TOPOLOGY_PREDECESSOR_EMPTY: %', v_pred; end if;
  if v_n_pred % 2 <> 0 then
    raise exception 'TOPOLOGY_PREDECESSOR_ODD: %: %', v_pred, v_n_pred;
  end if;

  select count(*) into v_n_slots from jsonb_object_keys(p_slots);
  if v_n_slots <> v_n_pred / 2 then
    raise exception 'TOPOLOGY_SLOT_COUNT: esperava % vagas, veio %', v_n_pred / 2, v_n_slots;
  end if;

  for v_slot in select key as slot_id, value as slot from jsonb_each(p_slots) loop
    v_a := v_slot.slot->'sideA'->>'winnerOf';
    v_b := v_slot.slot->'sideB'->>'winnerOf';
    if v_a is null or v_b is null then
      raise exception 'TOPOLOGY_MALFORMED: %.sideA/sideB sem winnerOf', v_slot.slot_id;
    end if;
    if v_a = v_slot.slot_id or v_b = v_slot.slot_id then
      raise exception 'TOPOLOGY_CIRCULAR: % depende de si mesmo', v_slot.slot_id;
    end if;
    if v_a = v_b then
      raise exception 'TOPOLOGY_DUPLICATE_PREDECESSOR: %', v_a;
    end if;
    if v_pred_ties->v_a is null then
      raise exception 'TOPOLOGY_UNKNOWN_TIE: %.sideA -> %', v_slot.slot_id, v_a;
    end if;
    if v_pred_ties->v_b is null then
      raise exception 'TOPOLOGY_UNKNOWN_TIE: %.sideB -> %', v_slot.slot_id, v_b;
    end if;
    if v_a = any(v_usados) then raise exception 'TOPOLOGY_DUPLICATE_PREDECESSOR: %', v_a; end if;
    if v_b = any(v_usados) then raise exception 'TOPOLOGY_DUPLICATE_PREDECESSOR: %', v_b; end if;
    v_usados := v_usados || v_a || v_b;
  end loop;

  -- Idempotencia / imutabilidade: mesma topologia = no-op; diferente com fase ja registrada =
  -- recusa. Mudar o caminho depois que gente palpitou reescreve o significado dos palpites.
  v_atual := v_state->'phases'->p_phase_id->'topology'->'slots';
  if v_atual is not null then
    if v_atual = p_slots then
      return jsonb_build_object('applied', false, 'reason', 'topologia identica ja registrada');
    end if;
    raise exception 'TOPOLOGY_ALREADY_REGISTERED: % ja tem topologia diferente; mudar depois de '
                    'palpites reescreveria o significado deles', p_phase_id;
  end if;

  v_state := jsonb_set(
    v_state,
    array['phases', p_phase_id, 'topology'],
    jsonb_build_object(
      'slots', p_slots,
      'provenance', p_provenance || jsonb_build_object('registeredAt', v_iso, 'actor', p_actor)
    ),
    true
  );

  -- ─── NORMALIZED MIRROR (20260813160000) ────────────────────────────────────────────────
  -- Topology is class A: cdb2026 renders no slots for a phase whose topology provenance does not
  -- validate, so a registration that reached legacy but not the normalized model would make the
  -- phase disappear at read cutover. Same transaction, no exception handler.
  perform bolao.cdb_mirror_phase(p_phase_id, v_state->'phases'->p_phase_id);

  update bolao_state set state = v_state, updated_at = now() where id = 'cdb2026';
  return jsonb_build_object('applied', true, 'phaseId', p_phase_id, 'slots', v_n_slots);
end;
$function$;


-- ── writer 3 of 3: cdb_refresh_topology_provenance ──

CREATE OR REPLACE FUNCTION public.cdb_refresh_topology_provenance(p_phase_id text, p_slots jsonb, p_provenance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_state jsonb;
  v_atual jsonb;
  v_iso   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if coalesce(p_provenance->>'authority','') <> 'CBF' then
    raise exception 'TOPOLOGY_PROVENANCE: authority deve ser CBF';
  end if;
  if coalesce(p_provenance->>'source','') = '' then
    raise exception 'TOPOLOGY_PROVENANCE: campo `source` obrigatorio (o app exige)';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  v_atual := v_state->'phases'->p_phase_id->'topology'->'slots';
  if v_atual is null then
    raise exception 'TOPOLOGY_AUSENTE: registre a topologia antes de refrescar a proveniencia';
  end if;
  -- As VAGAS tem de ser identicas. Esta funcao documenta; nao rechaveia.
  if v_atual <> p_slots then
    raise exception 'TOPOLOGY_SLOTS_DIFEREM: esta funcao so atualiza proveniencia';
  end if;

  v_state := jsonb_set(v_state, array['phases', p_phase_id, 'topology', 'provenance'],
                       p_provenance || jsonb_build_object('refreshedAt', v_iso), true);
  -- ─── NORMALIZED MIRROR (20260813160000) ────────────────────────────────────────────────
  -- Topology is class A: cdb2026 renders no slots for a phase whose topology provenance does not
  -- validate, so a registration that reached legacy but not the normalized model would make the
  -- phase disappear at read cutover. Same transaction, no exception handler.
  perform bolao.cdb_mirror_phase(p_phase_id, v_state->'phases'->p_phase_id);

  update bolao_state set state = v_state, updated_at = now() where id = 'cdb2026';
  return jsonb_build_object('refreshed', true, 'phaseId', p_phase_id);
end;
$function$;
