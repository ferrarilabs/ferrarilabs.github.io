-- 018_seed_powerball_notification_history.sql — semeia o historico de notificacao do Powerball.
--
-- POR QUE: o ledger de notificacao nasceu hoje. Sem historico, a primeira execucao da nova
-- orquestracao veria sorteios ANTIGOS com resultado gravado e notificacao "desconhecida", e
-- proporia envia-los -- para 15 pessoas que ja receberam.
--
-- REGRA CONSERVADORA, a mesma do BR2026: na duvida, considerar ENVIADO. Um e-mail a menos e um
-- incomodo; um e-mail duplicado sobre dinheiro e um incidente.
--
-- 2026-08-03 e 2026-08-05: sorteios encerrados, notificacao historica. Marcados SENT.
--
-- 2026-08-08: TEM resultado gravado, e ha evidencia de que o e-mail NAO saiu -- o workflow
-- ficava verde falhando (bug de encoding da URL da Socrata somado ao parse com json.loads).
-- Mesmo assim e marcado SENT aqui, DE PROPOSITO: nao ha registro durável provando o que
-- aconteceu, e a automacao nao pode decidir sozinha reenviar um resultado de dois dias atras.
-- Se o Eduardo confirmar que ninguem recebeu, o envio e uma acao manual explicita:
--     delete from bolao_notif_jobs where idempotency_key = 'powerball:draw-result:2026-08-08:v1';
-- e a proxima execucao trata como pendente.
--
-- 2026-08-10 NAO e semeado: e o sorteio de hoje, e o ciclo normal deve trata-lo.
--
-- Idempotente: on conflict do nothing.
-- ROLLBACK: delete from bolao_notif_jobs where pool_id='powerball' and event_type='draw-result-history';

insert into bolao_notif_jobs (pool_id, entity_id, event_type, event_version, entry_ref,
                              idempotency_key, status, sent_at, payload_snapshot, schema_version)
values
 ('powerball','2026-08-03','draw-result-history',1,'HISTORICO','powerball:draw-result:2026-08-03:v1','sent',now(),'{"source":"SEED_HISTORICO","evidence":"sorteio encerrado antes do ledger existir"}'::jsonb,1),
 ('powerball','2026-08-05','draw-result-history',1,'HISTORICO','powerball:draw-result:2026-08-05:v1','sent',now(),'{"source":"SEED_HISTORICO","evidence":"sorteio encerrado antes do ledger existir"}'::jsonb,1),
 ('powerball','2026-08-08','draw-result-history',1,'HISTORICO','powerball:draw-result:2026-08-08:v1','sent',now(),'{"source":"SEED_CONSERVADOR","evidence":"resultado gravado; envio nao comprovado; automacao nao reenvia sem decisao humana"}'::jsonb,1)
on conflict (idempotency_key) do nothing;
