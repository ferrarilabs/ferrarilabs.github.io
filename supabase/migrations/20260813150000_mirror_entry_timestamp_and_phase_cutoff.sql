--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813150000_mirror_entry_timestamp_and_phase_cutoff.sql
--
-- ═══ TWO GAPS THE PARITY HARNESS FOUND IN 20260813140000 ═════════════════════════════════════
--
-- The mirror shipped in 20260813140000 mirrors an accepted save's PICKS and nothing else. The
-- leaf-level parity run then reported two entries whose `updatedAt` had drifted, because the
-- legacy save also stamps the entry:
--
--     legacy  entries[03e9fe14].updatedAt = 2026-08-13T00:22:14Z
--     norm    entries[03e9fe14].updatedAt = 2026-08-12T21:31:09.000Z   (stale)
--     legacy  entries[09959213].updatedAt = 2026-08-13T00:28:27Z
--     norm    entries[09959213].updatedAt = <absent>                    (never had one)
--
-- That field is not cosmetic. `mergeStates()` compares it as a STRING to decide whether the
-- server's entry or the browser's own copy is newer, so a stale normalized value makes a
-- returning browser keep its local copy and discard what the server holds. A mirror that keeps
-- the picks current while letting the timestamp rot would produce exactly the staleness it was
-- built to prevent, one indirection further along.
--
-- ═══ THE SECOND-PRECISION SPELLING ═══════════════════════════════════════════════════════════
--
-- The save writes `to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')` — WHOLE
-- SECONDS, no fractional part. Migrated entries carry milliseconds. So the document holds three
-- spellings of the same type and the projection now reproduces all three from the stored instant:
--
--     microseconds present   ...887256Z    (two br entries)
--     milliseconds present   ...829Z       (migrated entries)
--     whole second           ...14Z        (every runtime save)
--
-- Emitting `.000Z` where the document says `Z` is a different string, and string comparison is
-- what mergeStates does. This is not over-fitting: it is the difference between the merge picking
-- the server and the merge picking a stale cache.
--
-- ═══ THE PHASE CUTOFF, AND THE WRITE PATH THIS DOES NOT FIX ══════════════════════════════════
--
-- `phases.quartas.cutoffAt` is `2026-08-25T23:00:00Z` in the document and NULL in
-- `bolao.competition_edition_phases`. That is not cosmetic either — cdb2026's `isPhaseRegistered()`
-- is literally `phase.cutoffAt !== null`, so a null makes the phase UNREGISTERED and the entire
-- quartas phase vanishes from the UI. The value is backfilled here.
--
-- IT IS BACKFILLED, NOT MIRRORED, AND THAT DISTINCTION IS THE POINT. The value was written by
-- `bolao/cdb2026/scripts/reconcile_official_schedule.py`, an operator CLI that updates the legacy
-- document directly. That path does NOT go through `cdb_save_my_picks` and is therefore NOT
-- covered by the mirror. This migration corrects today's drift; it does not close the path. The
-- next official schedule sync will drift again, and that is recorded as the remaining blocker
-- rather than papered over by a one-time UPDATE that makes the parity run look green.
--
-- `scheduleProvenance` — competition, source, fetchedAt, firstKickoff, cutoffRule — comes from the
-- same script and has no normalized home. No application code reads it: the only reference in the
-- repository is the script that writes it. It is therefore classified as an operator-metadata
-- reduction rather than given a column, on the same reasoning as auditLog.
--
-- ═══ CLASSIFICATION ═════════════════════════════════════════════════════════════════════════
--
-- TOURNAMENT_SPECIFIC (cdb2026) · function replacement + one DATA_ONLY correction. No new table,
-- no new grant, no business rule. BR and Copa untouched.
--
-- ROLLBACK (FULL). Restore the 20260813140000 signature and body; the cutoff correction is a value
-- the document already holds, so reverting it re-creates the drift rather than losing anything.
--

BEGIN;

-- ─── THE CUTOFF THE SYNC WROTE ONLY TO LEGACY ────────────────────────────────────────────────
-- Read from the document rather than typed, so the value cannot be transcribed wrong, and scoped
-- to phases whose normalized cutoff is NULL so an existing value is never overwritten.
UPDATE bolao.competition_edition_phases ph
   SET cutoff_at = (s.state->'phases'->ph.slug->>'cutoffAt')::timestamptz
  FROM public.bolao_state s, bolao.pools pl
 WHERE s.id = 'cdb2026'
   AND pl.slug = 'cdb2026'
   AND ph.competition_edition_id = pl.competition_edition_id
   AND ph.cutoff_at IS NULL
   AND nullif(s.state->'phases'->ph.slug->>'cutoffAt','') IS NOT NULL;

-- ─── THE MIRROR, NOW CARRYING THE ENTRY STAMP ────────────────────────────────────────────────

DROP FUNCTION IF EXISTS bolao.cdb_mirror_entry_picks(uuid, jsonb);

CREATE OR REPLACE FUNCTION bolao.cdb_mirror_entry_picks(p_pool_entry_id uuid, p_picks jsonb, p_updated_at timestamptz)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $mirror$
declare
  v_now     timestamptz := now();
  v_written integer;
begin
  if p_pool_entry_id is null then
    raise exception 'cdb_mirror_entry_picks: pool_entry_id obrigatorio';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'cdb_mirror_entry_picks: picks precisa ser objeto';
  end if;

  -- The entry stamp. Same transaction, same accepted value the legacy row received.
  update bolao.pool_entries
     set content_updated_at = p_updated_at
   where pool_entry_id = p_pool_entry_id;

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

  -- Read-after-write, asserted before the caller can commit. The subject key is COALESCED into one
  -- text value because PostgreSQL cannot plan a FULL OUTER JOIN on `IS NOT DISTINCT FROM`.
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

  -- And the stamp, asserted too. A mirror that silently failed to move the timestamp would leave
  -- mergeStates preferring a stale browser copy, which is invisible to a pick-set comparison.
  if not exists (select 1 from bolao.pool_entries
                  where pool_entry_id = p_pool_entry_id and content_updated_at = p_updated_at) then
    raise exception 'MIRROR_DIVERGENCE: entry timestamp not mirrored for entry %', p_pool_entry_id;
  end if;

  return v_written;
end $mirror$;

COMMENT ON FUNCTION bolao.cdb_mirror_entry_picks(uuid, jsonb, timestamptz) IS
  'Synchronized normalized mirror of ONE cdb2026 entry''s accepted save: its pick set and its content timestamp. Runs inside the existing cdb_save_my_picks transaction, writes no migration lineage, decides no business rule, and raises MIRROR_DIVERGENCE — failing the whole save — if either the pick set or the stamp does not match what was accepted.';

REVOKE ALL ON FUNCTION bolao.cdb_mirror_entry_picks(uuid, jsonb, timestamptz) FROM PUBLIC;

COMMIT;

-- ─── SAVE PATH: mirror call carrying the accepted instant ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cdb_save_my_picks(p_token text, p_client_ref text, p_picks jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry_id text;
  v_state    jsonb;
  v_idx      int;
  v_entry    jsonb;
  v_cutoff   timestamptz;
  v_fase     text;
  v_agora    timestamptz := now();
  v_versao   text;
begin
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'cdb_save_my_picks: client_ref obrigatorio (idempotencia)';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'cdb_save_my_picks: picks precisa ser objeto';
  end if;
  if length(p_picks::text) > 20000 then
    raise exception 'cdb_save_my_picks: picks grande demais';
  end if;

  v_entry_id := _cdb_entry_id_from_token(p_token);
  if v_entry_id is null then
    raise exception 'ACESSO_NEGADO';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then
    raise exception 'ACESSO_NEGADO';
  end if;
  if coalesce(v_state->'deletedIds','[]'::jsonb) ? v_entry_id then
    raise exception 'ACESSO_NEGADO';
  end if;

  select ord - 1, e into v_idx, v_entry
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) with ordinality as t(e, ord)
   where e->>'id' = v_entry_id
   limit 1;
  if v_entry is null then
    raise exception 'ACESSO_NEGADO';
  end if;

  -- NENHUM EVENTO PARA SAVE QUE NAO GRAVOU NADA. Os dois ramos abaixo saem ANTES do UPDATE e
  -- antes da criacao da obrigacao. O comprovante confirma um estado gravado novo, nao um clique
  -- no botao Salvar.
  if v_entry->>'lastClientRef' = p_client_ref then
    return jsonb_build_object('updated', false, 'reason', 'idempotente');
  end if;

  if coalesce(v_entry->'picks','null'::jsonb) is not distinct from coalesce(p_picks,'null'::jsonb) then
    return jsonb_build_object('updated', false, 'reason', 'identico');
  end if;

  v_fase := nullif(v_state->'espnSync'->>'activePhaseId','');
  if v_fase is null then
    raise exception 'FASE_FECHADA: nenhuma fase ativa declarada';
  end if;

  begin
    v_cutoff := nullif(v_state->'phases'->v_fase->>'cutoffAt','')::timestamptz;
  exception when others then
    raise exception 'CUTOFF_ILEGIVEL: fase % tem cutoffAt invalido', v_fase;
  end;

  if v_cutoff is null then
    raise exception 'FASE_FECHADA: fase % ainda nao tem prazo oficial publicado', v_fase;
  end if;
  if v_agora >= v_cutoff then
    raise exception 'CUTOFF_PASSADO: fase % fechou em %', v_fase, v_cutoff;
  end if;

  v_entry := v_entry
    || jsonb_build_object('picks', p_picks)
    || jsonb_build_object('updatedAt', to_char(v_agora at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || jsonb_build_object('lastClientRef', p_client_ref);

  update bolao_state
     set state = jsonb_set(state, array['entries', v_idx::text], v_entry),
         updated_at = v_agora
   where id = 'cdb2026';

  -- ─── NORMALIZED WRITE MIRROR (20260813140000, stamp added 20260813150000) ──────────────────
  --
  -- Same transaction as the legacy UPDATE above. Legacy remains the write AUTHORITY; this keeps
  -- the normalized read model from going stale the moment a participant saves.
  --
  -- NO exception handler, deliberately. Catching here would produce a committed legacy write
  -- beside a stale normalized model — the exact silent divergence the mirror exists to prevent.
  --
  -- v_agora is passed rather than re-read: the mirror must record the SAME instant the legacy
  -- entry was stamped with, not the instant the mirror happened to run.
  perform bolao.cdb_mirror_entry_picks(
            (select pe.pool_entry_id
               from bolao.pool_entries pe
               join bolao.pools pl on pl.pool_id = pe.pool_id and pl.slug = 'cdb2026'
              where pe.legacy_entry_id = v_entry_id::uuid),
            p_picks, v_agora);

  -- ── A OBRIGACAO, IDENTIFICADA PELA VERSAO GRAVADA ─────────────────────────────────────────
  --
  -- Forma canonica por LISTA DE PERMISSAO: so `matches` e `qualified` entram. Campo transitorio
  -- que apareca no payload amanha fica de fora sem ninguem precisar proibi-lo, e token/endereco/
  -- PII nunca entram porque nunca estao aqui.
  --
  -- O hash sai do `jsonb`, que ja e canonico: chaves ordenadas, sem espaco em branco, numeros
  -- normalizados. Mesma previsao escrita em outra ordem de propriedades da o MESMO hash.
  if exists (select 1 from bolao.cdb_confirmation_allowance a where a.entry_id = v_entry_id) then
    -- UMA definicao de versao, compartilhada com o teste. Ver `cdb_picks_version` acima.
    v_versao := public.cdb_picks_version(p_picks);

    insert into bolao.outbox_events (idempotency_key, channel, event_type, payload)
    values ('cdb2026:entry-saved-confirmation:' || v_entry_id || ':' || v_versao || ':v1',
            'email',
            'cdb2026.entry_saved_confirmation',
            -- `picksVersion` e hash, nao conteudo: o consumidor precisa dele para montar a chave
            -- de entrega, e um hash nao reidrata palpite nem identifica pessoa.
            jsonb_build_object('entryId', v_entry_id, 'savedAt', v_agora,
                               'picksVersion', v_versao))
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object('updated', true);
end $function$;
