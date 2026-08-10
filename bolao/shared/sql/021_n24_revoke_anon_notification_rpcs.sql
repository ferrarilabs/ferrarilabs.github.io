-- 021_n24_revoke_anon_notification_rpcs.sql — N24: tira o ledger de notificacao das maos do publico.
--
-- ─── O DEFEITO ───────────────────────────────────────────────────────────────────────────────
--
-- A migracao 010 criou as RPCs de notificacao sem nenhum grant/revoke explicito. Em Postgres,
-- funcao nova nasce executavel por PUBLIC -- e PUBLIC inclui `anon`. Confirmado em producao:
--
--   mark_bolao_notif_sent        anon  ✗
--   mark_bolao_notif_retryable   anon  ✗
--   mark_bolao_notif_permanent   anon  ✗
--   claim_bolao_notif            anon  ✗
--   enqueue_bolao_notif          anon  ✗
--   release_expired_bolao_notif  anon  ✗
--   set_bolao_notif_recipient    anon  ✗
--   settle_bolao_notif           anon  ✗
--
-- A anon key e PUBLICA: vai dentro de `js/config.js`, servido a todo navegador que abre o site.
-- Qualquer portador podia chamar `mark_bolao_notif_sent` e marcar a notificacao de um sorteio
-- como enviada. O ciclo entao veria ALREADY_COMPLETED e ficaria em no-op para sempre --
-- SUPRIMINDO permanentemente o e-mail de resultado dos 15 participantes, em silencio, sem
-- nenhum erro em lugar nenhum. Nenhum reenvio corrigiria: o proprio mecanismo de idempotencia
-- que protege contra envio duplo viraria a arma.
--
-- ─── ORDEM (importa) ─────────────────────────────────────────────────────────────────────────
--
-- Esta migracao SO pode ser aplicada depois que o runner provou funcionar com a credencial
-- privilegiada. O canario de 2026-08-10 provou, de dentro do GitHub Actions:
--     SERVICE_ROLE_SECRET_PRESENT = YES
--     LEDGER_RPC_FROM_RUNNER      = PASS
--     SERVICE_ROLE_LEDGER_WRITE   = PASS
-- Nunca pode existir um intervalo em que o deployado precise de permissao ja revogada.
--
-- ─── QUEM PERDE O QUE ────────────────────────────────────────────────────────────────────────
--
-- `anon` perde TUDO no ledger de notificacao -- inclusive leitura. Nenhum navegador consome
-- essas RPCs (verificado: zero referencias em bolao/*/js/ e bolao/shared/js/). Os unicos
-- consumidores sao scripts server-side que rodam no GitHub Actions com credencial privilegiada.
-- O padrao e negar; acesso anonimo se justifica, nao se presume.
--
-- ROLLBACK: `grant execute on function <nome>(<assinatura>) to anon;` devolve o acesso. Fazer
-- isso reabre o caminho de supressao descrito acima -- so com motivo escrito.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like '%bolao_notif%' or p.proname = 'delete_canary_job')
  loop
    execute format('revoke all on function %s from anon', f.assinatura);
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('revoke all on function %s from authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end $$;
