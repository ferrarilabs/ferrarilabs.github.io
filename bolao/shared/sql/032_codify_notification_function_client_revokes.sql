-- 032_codify_notification_function_client_revokes.sql — Issue #284.
--
-- ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────────────────────────
--
-- Doze funcoes de notificacao/canario em `public` sao criadas por `010_notification_durability.sql`,
-- `013_notif_status_by_pool.sql`, `020_notif_recipient_rpcs.sql` e
-- `20260806000000_baseline_adopted_pre_tracking.sql`. Todas concedem `service_role` (quando
-- concedem) e NENHUMA revoga o que o `pg_default_acl` de `public` ja tinha dado no nascimento:
-- `CREATE FUNCTION` faz a funcao nascer executavel por `anon`, `authenticated` e `service_role`
-- sem que ninguem escreva um GRANT (Issue #271).
--
-- Verificado diretamente contra producao (2026-08-21, read-only, antes desta migracao): as doze
-- tem `proacl = {postgres=X/postgres,service_role=X/postgres}`. Ou seja, `anon` e `authenticated`
-- JA NAO executam nenhuma delas ao vivo. Igual ao caso da Issue #135: o estado ao vivo e mais
-- seguro do que a DDL commitada consegue reproduzir, e ninguem sabe COMO nem QUANDO foi fechado --
-- so que esta fechado.
--
-- ─── O QUE ISTO CONSERTA, E NAO E O ESTADO AO VIVO ──────────────────────────────────────────────
--
-- E um NO-OP contra producao. O que ele conserta e a RECONSTRUCAO: hoje, um restore ou um rebuild
-- do zero a partir desta DDL entrega as doze funcoes EXECUTAVEIS por `anon` e `authenticated` --
-- exposicao que producao nao tem. Entre elas esta `get_bolao_notif_recipients`, que e
-- SECURITY DEFINER e devolve `payload_snapshot->'recipients'` de `bolao_notif_jobs`, ou seja,
-- e-mail de participante, contornando a RLS.
--
-- A divergencia foi medida, nao suposta: comparacao papel a papel das 61 funcoes de `public`
-- entre a ACL ao vivo e o replay do modelo deu 49/61 identicas e 12 divergentes, TODAS na mesma
-- direcao (modelo diz que o cliente executa, producao diz que nao). As duas que divergiam no
-- outro sentido -- `_bolao_audit` e `_bolao_touch`, realmente executaveis por `authenticated` ao
-- vivo -- NAO estao aqui: sao a Issue #282 e precisam da sua propria autorizacao.
--
-- ─── ADITIVA NO SENTIDO QUE IMPORTA ─────────────────────────────────────────────────────────────
--
-- Nao concede nada. So revoga de `anon` e `authenticated` o que a evidencia ao vivo de 2026-08-21
-- confirma que ja esta revogado. `service_role` e o dono nao sao tocados, e nenhum corpo de funcao
-- muda.
--
-- ─── PUBLIC NAO APARECE, E ISSO E DELIBERADO ────────────────────────────────────────────────────
--
-- `PUBLIC` e um pseudo-papel, e `REVOKE ... FROM PUBLIC` NAO remove um grant explicito de `anon`
-- ou `authenticated` -- eles tem entrada propria na ACL. Foi exatamente essa confusao que produziu
-- a familia inteira de defeitos #282/#284: `017_n22_narrow_mutations.sql` revoga
-- `from anon, public` e deixa `authenticated` executando ate hoje. Aqui os papeis nomeados sao
-- revogados NOMINALMENTE. As doze ja tem `PUBLIC` ausente ao vivo, e o gate
-- `audit_function_creation_discipline.mjs` modela os quatro concessionarios separadamente.

revoke execute on function public.bolao_notif_health(p_pool_id text) from anon, authenticated;
revoke execute on function public.bolao_notif_status_by_pool(p_pool_id text) from anon, authenticated;
revoke execute on function public.delete_canary_job(p_idempotency_key text) from anon, authenticated;
revoke execute on function public.enqueue_bolao_notif(p_pool_id text, p_entity_id text, p_event_type text, p_event_version integer, p_entry_ref text, p_idempotency_key text, p_payload jsonb, p_template_id text, p_template_version integer, p_max_attempts integer, p_schema_version integer) from anon, authenticated;
revoke execute on function public.get_bolao_notif_content_hash(p_idempotency_key text) from anon, authenticated;
revoke execute on function public.get_bolao_notif_recipients(p_idempotency_key text) from anon, authenticated;
revoke execute on function public.mark_bolao_notif_permanent(p_job_id uuid, p_error text) from anon, authenticated;
revoke execute on function public.mark_bolao_notif_retryable(p_job_id uuid, p_error text) from anon, authenticated;
revoke execute on function public.mark_bolao_notif_sent(p_job_id uuid, p_provider_message_id text) from anon, authenticated;
revoke execute on function public.release_expired_bolao_notif(p_pool_id text) from anon, authenticated;
revoke execute on function public.set_bolao_notif_recipient(p_idempotency_key text, p_entry_ref text, p_state text, p_provider_message_id text, p_error text) from anon, authenticated;
revoke execute on function public.settle_bolao_notif(p_idempotency_key text) from anon, authenticated;

-- ROLLBACK (nao deveria ser necessario -- isto e um no-op contra o estado ao vivo, medido em
-- 2026-08-21. Se alguma dependesse de execucao por papel de cliente, o que a evidencia contradiz):
-- grant execute on function public.<assinatura> to anon, authenticated;
