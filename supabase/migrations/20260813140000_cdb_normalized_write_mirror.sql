--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813140000_cdb_normalized_write_mirror.sql
--
-- ═══ THE MIRROR THAT MAKES A LIVE READ CUTOVER SAFE ══════════════════════════════════════════
--
-- `public.cdb_save_my_picks()` writes an accepted pick save to `public.bolao_state` and nowhere
-- else. Its only `bolao.*` write is one outbox row for the confirmation email. So the normalized
-- model is COMPLETE but not CURRENT: measured on 2026-08-13, a save committed at 00:28:27Z moved
-- one entry from 8 picked ties to 15, and `bolao.predictions` still held the 8.
--
-- Routing CDB reads at the normalized surface in that state would make every subsequent save
-- invisible to every reader — the ranking, and the participant's own other devices. The saver
-- would still see their picks, from localStorage, which is what makes it the kind of break that
-- passes a casual test and fails everyone else.
--
-- This migration closes that, and closes ONLY that.
--
-- ═══ WHAT THIS IS NOT ════════════════════════════════════════════════════════════════════════
--
-- NOT WRITE_CUTOVER. `public.bolao_state` remains the write AUTHORITY: it is still the row that is
-- locked, still the row whose acceptance rules decide the save, and still the record the
-- application would be restored from. The normalized side gets a synchronized MIRROR — a
-- derivative, written in the same transaction, never consulted to decide anything.
--
-- Nothing here grants a browser role DML on any normalized table, and no new mutation API is
-- exposed. The trusted function remains the only mutation boundary.
--
-- ═══ ATOMICITY IS THE ENTIRE POINT ═══════════════════════════════════════════════════════════
--
-- The mirror runs INSIDE the existing transaction, between the legacy UPDATE and the existing
-- outbox insert. plpgsql gives that for free — the whole function body is one transaction — and
-- the consequence is the guarantee that matters:
--
--     legacy committed + normalized failed   is impossible
--     normalized committed + legacy failed   is impossible
--
-- A mirror that could half-commit would be worse than no mirror, because the divergence would be
-- silent and permanent. There is deliberately no exception handler around the mirror call: a
-- BEGIN/EXCEPTION block would convert a mirror failure into a successful save with stale
-- normalized state, which is precisely the failure being engineered out. If the mirror cannot
-- represent the save, the save does not happen.
--
-- ═══ IT DECIDES NOTHING ══════════════════════════════════════════════════════════════════════
--
-- Every acceptance rule stays where it is: token ownership, tombstoned entry, unknown entry,
-- client-ref idempotency, identical-picks short circuit, active phase, cutoff readable, cutoff not
-- passed. The mirror is called only AFTER all of them have passed and after the legacy row has
-- been updated. It transforms accepted data; it does not re-interpret it. A second copy of those
-- rules would be a second business-rule engine, and the first one to drift would win silently.
--
-- ═══ REPLACE, BECAUSE THAT IS WHAT LEGACY DOES ═══════════════════════════════════════════════
--
-- The legacy write is `v_entry || jsonb_build_object('picks', p_picks)` — the entry's whole picks
-- object is REPLACED. So the mirror replaces that entry's whole prediction set: a pick removed
-- from the payload is removed from the normalized model, because in the document it is gone.
-- Upserting without deleting would accumulate picks the participant has cleared, and those stale
-- rows would then be scored.
--
-- The replace is scoped to ONE pool entry, by pool_entry_id. It never touches another entry, never
-- touches another pool, and never rewrites the document. WHOLE_DOCUMENT_WRITERS stays 0.
--
-- ═══ TIES THE BRACKET DOES NOT CONTAIN ═══════════════════════════════════════════════════════
--
-- Two entries carry picks for `sf-1`, `sf-2` and `final-1` — slugs absent from the document's own
-- `phases` object and from `bolao.ties`, residue of an earlier bracket. The mirror joins to
-- `bolao.ties` and therefore skips them, exactly as the read projection does. It does NOT invent
-- the ties to preserve the keys. Nothing reads them: `audit_scoring.py` iterates the ties and
-- looks each up in the picks, and the app renders per tie from `phases`.
--
-- This is why the mirror cannot assert "normalized == legacy" as raw JSON. It asserts the thing
-- that is true and checkable: for every tie THAT EXISTS, the normalized pick set equals the
-- accepted one, exactly.
--
-- ═══ RUNTIME WRITES ARE NOT MIGRATION LINEAGE ════════════════════════════════════════════════
--
-- `audit.migration_lineage` is evidence that a row came from a historical source coordinate. A
-- participant saving picks tonight is not that, and writing lineage for it would corrupt the
-- 1:1 migration invariant by mixing operational writes into migration evidence. So the mirror
-- writes NO lineage, and `predictions.mirrored_at` is added to make the distinction measurable
-- rather than inferred:
--
--     migrated, untouched   lineage = 1, mirrored_at IS NULL
--     migrated, re-saved    lineage = 1, mirrored_at IS NOT NULL   (provenance survives the save)
--     created at runtime    lineage = 0, mirrored_at IS NOT NULL
--
-- The invariant is therefore restated, not weakened: every row WITH lineage has exactly one, and
-- no lineage points at a row that no longer exists.
--
-- That last clause is why the delete cascades. When a replace removes a prediction that was
-- originally migrated, its lineage row would otherwise point at nothing — an ORPHANED row, the
-- metric this campaign holds at 0. The lineage goes with it. This does not erase history: legacy
-- retains the source document, which is the actual historical record, and the lineage row's job
-- was to describe a target row that no longer exists.
--
-- ═══ CLASSIFICATION ═════════════════════════════════════════════════════════════════════════
--
-- TOURNAMENT_SPECIFIC (cdb2026 only) · ADDITIVE_DDL + one function replacement. BR and Copa are
-- not touched: the mirror is called from the CDB save path and is scoped by pool.
--
-- The scoring formula, the bracket, the tiebreak cascade and every acceptance rule are unchanged.
-- This migration adds no business rule and removes none.
--
-- APPLICATION COMPATIBILITY. TOTAL. `cdb_save_my_picks` keeps its signature, its return shape,
-- its error vocabulary and its short-circuit behavior. A client cannot tell the mirror exists.
--
-- ROLLBACK (FULL). Restore the previous function body from
-- 20260813140000_cdb_normalized_write_mirror.rollback.sql and drop the mirror function and the
-- column. Accepted legacy writes are never sacrificed by a rollback: the authority never moved.
-- After a rollback the normalized model begins going stale again, so the READ route must go back
-- to legacy first — see the rollback file.
--
-- PRECHECKS: cdb_save_my_picks exists with the expected signature · bolao.predictions exists ·
--            pool_entries.legacy_entry_id is backfilled 46/46 · a verified backup exists
-- POSTCHECKS: an accepted save leaves legacy and normalized in the same logical pick set ·
--             a rejected save writes neither · a forced mirror failure rolls the save back ·
--             no migration lineage row is created by a runtime save
--

BEGIN;

-- ─── THE RUNTIME MARKER ──────────────────────────────────────────────────────────────────────

ALTER TABLE bolao.predictions ADD COLUMN IF NOT EXISTS mirrored_at timestamptz;

COMMENT ON COLUMN bolao.predictions.mirrored_at IS
  'When this row was last written by the runtime mirror rather than by a migration. NULL means the row has only ever been migrated. It exists so "migrated row" and "runtime row" are a measured distinction rather than an inferred one, which is what lets the migration lineage invariant stay exact while ordinary saves deliberately write no lineage.';

-- ─── THE MIRROR ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION bolao.cdb_mirror_entry_picks(p_pool_entry_id uuid, p_picks jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $mirror$
declare
  v_now      timestamptz := now();
  v_written  integer;
begin
  -- Fail closed on a caller that did not resolve an entry. The save path always has one; a NULL
  -- here would silently mirror nothing and report success.
  if p_pool_entry_id is null then
    raise exception 'cdb_mirror_entry_picks: pool_entry_id obrigatorio';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'cdb_mirror_entry_picks: picks precisa ser objeto';
  end if;

  -- The accepted pick set, resolved to normalized subjects. Ties absent from the bracket resolve
  -- to nothing and are skipped here exactly as the read projection skips them.
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

  -- REPLACE, step 1: drop this entry's predictions that the accepted payload no longer contains.
  -- Scoped to one pool_entry_id and to nothing else.
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

  -- REPLACE, step 2: upsert the accepted set. ON CONFLICT keeps prediction_id stable, so a row
  -- that was migrated keeps its lineage across every future save instead of losing provenance the
  -- first time its owner edits a score.
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

  -- READ-AFTER-WRITE, asserted before the caller can commit. Not a post-hoc report: if the
  -- normalized set is not exactly the accepted set for every tie that exists, the save fails and
  -- takes the legacy write with it. This is the assertion that makes the mirror trustworthy
  -- enough to route reads at, so it runs on every save and not only in tests.
  -- The subject key is COALESCED into a single text value rather than joined with
  -- `IS NOT DISTINCT FROM`. A prediction's subject is a match XOR a tie, so one of the two columns
  -- is always NULL and the natural way to write this is a null-safe join — but PostgreSQL cannot
  -- plan a FULL OUTER JOIN on a non-equality condition and raises
  -- "FULL JOIN is only supported with merge-joinable or hash-joinable join conditions".
  -- Caught by the disposable-environment tests, which is the reason they exist: this assertion is
  -- the mirror's own safety check, and a safety check that always raises is indistinguishable from
  -- a mirror that never works.
  if exists (
    select 1 from (select coalesce(w.match_id::text,'') || '|' || coalesce(w.tie_id::text,'') as k,
                          w.goals_home, w.goals_away, w.side from _mirror_want w) w
     full outer join (select coalesce(p.match_id::text,'') || '|' || coalesce(p.tie_id::text,'') as k,
                             p.predicted_goals_home gh, p.predicted_goals_away ga,
                             p.predicted_qualified_side sd
                        from bolao.predictions p where p.pool_entry_id = p_pool_entry_id) g
       on g.k = w.k
     where w.k is null
        or g.k is null
        or g.gh is distinct from w.goals_home
        or g.ga is distinct from w.goals_away
        or g.sd is distinct from w.side
  ) then
    raise exception 'MIRROR_DIVERGENCE: normalized pick set does not equal the accepted pick set for entry %', p_pool_entry_id;
  end if;

  return v_written;
end $mirror$;

COMMENT ON FUNCTION bolao.cdb_mirror_entry_picks(uuid, jsonb) IS
  'Synchronized normalized mirror of ONE cdb2026 entry''s accepted pick set. Called inside the existing cdb_save_my_picks transaction, after the authoritative legacy write. Replaces exactly that entry''s predictions, writes no migration lineage, decides no business rule, and raises MIRROR_DIVERGENCE — failing the whole save — if the normalized set does not equal the accepted set.';

REVOKE ALL ON FUNCTION bolao.cdb_mirror_entry_picks(uuid, jsonb) FROM PUBLIC;

-- No GRANT to anon or authenticated. The only caller is cdb_save_my_picks, which is SECURITY
-- DEFINER owned by postgres and therefore evaluates this as its own definer. A browser role that
-- could call the mirror directly would be able to rewrite a pick set without passing a single
-- acceptance rule.

COMMIT;

-- ─── SAVE PATH: the mirror call, injected after the authoritative legacy write ───────────────

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

  -- ─── NORMALIZED WRITE MIRROR (20260813140000) ──────────────────────────────────────────────
  --
  -- Same transaction as the legacy UPDATE above, deliberately. The legacy row is still the write
  -- AUTHORITY and is still the row locked FOR UPDATE; this keeps the normalized read model from
  -- going stale the moment a participant saves, which is the one thing that made a live CDB read
  -- cutover unsafe.
  --
  -- NO exception handler. If the mirror cannot represent this save, the save must not happen:
  -- catching here would produce a committed legacy write beside a stale normalized model, which
  -- is exactly the silent divergence the mirror exists to prevent.
  --
  -- The entry is resolved by legacy_entry_id because pool_entry_id is NOT the document's entry id
  -- — Q33-A1 re-minted 25 of 46. A missing resolution raises rather than skipping: an entry the
  -- normalized model cannot name is an entry whose saves would silently stop propagating.
  perform bolao.cdb_mirror_entry_picks(
            (select pe.pool_entry_id
               from bolao.pool_entries pe
               join bolao.pools pl on pl.pool_id = pe.pool_id and pl.slug = 'cdb2026'
              where pe.legacy_entry_id = v_entry_id::uuid),
            p_picks);

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
