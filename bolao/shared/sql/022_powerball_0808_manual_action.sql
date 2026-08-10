create or replace function get_bolao_notif_manual_flag(p_idempotency_key text)
returns boolean language sql security definer set search_path = public as $$
  select coalesce((payload_snapshot->>'requiresManualAction')::boolean, false)
    from bolao_notif_jobs where idempotency_key = p_idempotency_key;
$$;
revoke all on function get_bolao_notif_manual_flag(text) from anon, public, authenticated;
grant execute on function get_bolao_notif_manual_flag(text) to service_role;

update bolao_notif_jobs
   set payload_snapshot = payload_snapshot || '{"requiresManualAction": true,
        "manualActionNote": "Entrega parcial historica de 2026-08-08: 14 de 15 entregues (evidencia do Gmail). O catch-up do Rodrigo Hajj e decisao explicita do Eduardo, nunca retry automatico. Remover esta marca quando a decisao for tomada."}'::jsonb
 where idempotency_key = 'powerball:draw-result:2026-08-08:v1';

select payload_snapshot->>'requiresManualAction' as marcado from bolao_notif_jobs
 where idempotency_key = 'powerball:draw-result:2026-08-08:v1';
