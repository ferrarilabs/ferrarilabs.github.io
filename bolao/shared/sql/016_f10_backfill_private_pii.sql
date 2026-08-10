-- 016_f10_backfill_private_pii.sql — F10, STAGE 2 (BACKFILL).
--
-- Copia participantEmail/payerName/paymentMethod/paymentTo de cada entrada para
-- `bolao_entry_private`, chaveado pelo `id` OPACO que a entrada ja tem. Nenhuma identidade e
-- inventada; nenhuma associacao e reconstruida por nome ou e-mail.
--
-- NAO REMOVE NADA de bolao_state. Nesta etapa a PII existe nos DOIS lugares de proposito: os
-- clientes antigos continuam funcionando enquanto a migracao acontece. A remocao e a Stage 6,
-- depois de os clientes migrarem e serem verificados.
--
-- Idempotente: on conflict atualiza. Reaplicar nao duplica.
--
-- ROLLBACK: delete from bolao_entry_private;  (bolao_state permanece a fonte, intacta)

insert into bolao_entry_private (pool_id, entry_ref, participant_email, payer_name,
                                 payment_method, payment_to)
select s.id,
       e->>'id',
       nullif(e->>'participantEmail', ''),
       nullif(e->>'payerName', ''),
       nullif(e->>'paymentMethod', ''),
       nullif(e->>'paymentTo', '')
from bolao_state s,
     jsonb_array_elements(coalesce(s.state->'entries', '[]'::jsonb)) e
where e->>'id' is not null
on conflict (pool_id, entry_ref) do update
  set participant_email = excluded.participant_email,
      payer_name        = excluded.payer_name,
      payment_method    = excluded.payment_method,
      payment_to        = excluded.payment_to,
      updated_at        = now();
