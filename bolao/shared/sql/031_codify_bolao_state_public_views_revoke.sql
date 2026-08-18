-- 031_codify_bolao_state_public_views_revoke.sql — Issue #135.
--
-- ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────────────────────────
--
-- `public.bolao_state_public` e `public.bolao_state_public_cdb` (duas views sobre `bolao_state`)
-- receberam `GRANT ALL` para `anon`/`authenticated` na criacao
-- (20260811160000_baseline_adopted_grants_and_rls.sql). Toda migracao posterior que tocou essas
-- views (20260812070000, 20260812150000, 20260813100000, 20260813120000, 20260813130000,
-- 20260813200000, entre outras) so redefiniu a projecao SELECT -- NENHUMA delas revoga o
-- INSERT/UPDATE/DELETE original.
--
-- Verificado diretamente contra producao (2026-08-18, read-only, antes desta migracao):
-- `anon`/`authenticated` tem SOMENTE SELECT nas duas views hoje. O estado ao vivo JA e mais
-- seguro do que a historia de migracoes commitadas sugere -- ninguem sabe COMO ou QUANDO o
-- INSERT/UPDATE/DELETE foi fechado, so que esta fechado. Esta migracao nao MUDA nada ao vivo
-- (e um no-op contra o estado atual) -- ela so torna a historia de migracoes capaz de
-- reconstruir "quais privilegios existem e por que", que hoje ela nao consegue.
--
-- O UNICO revoke committed para esses dois objetos ate agora vivia em
-- `docs/bolao/db-modernization/rls-drafts/LEGACY_WRITE_FENCE.draft.sql`, explicitamente marcado
-- "NOT FOR PRODUCTION APPLY".
--
-- NAO INCLUI: `security_invoker = true` nessas views -- avaliado no Issue #135 como um follow-up
-- de menor prioridade que exige teste em staging primeiro (mudar de execucao por definidor para
-- por invocador muda quem e o chamador efetivo contra as policies de RLS de `bolao_state`, e
-- precisa ser confirmado que nao muda o resultado do SELECT para os dois leitores legitimos
-- documentados). Fora do escopo desta migracao.
--
-- ADITIVA NO SENTIDO QUE IMPORTA: nao concede nada, so revoga o que a evidencia ao vivo (2026-08-18)
-- confirma que ja esta revogado. `service_role` nao e tocado.

revoke insert, update, delete on public.bolao_state_public from anon, authenticated;
revoke insert, update, delete on public.bolao_state_public_cdb from anon, authenticated;

-- ROLLBACK (nao deveria ser necessario -- isto e um no-op contra o estado ao vivo. Se algum
-- leitor legitimo dependia do INSERT/UPDATE/DELETE nessas views, o que a evidencia de 2026-08-18
-- contradiz, o rollback seria):
-- grant insert, update, delete on public.bolao_state_public to anon, authenticated;
-- grant insert, update, delete on public.bolao_state_public_cdb to anon, authenticated;
