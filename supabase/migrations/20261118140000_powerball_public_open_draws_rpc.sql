-- PROVENANCE: Powerball/Mega Millions leitura publica do sorteio aberto · 2026-11-18 · class CLIENT_READ_RPC
--
-- 20261118140000_powerball_public_open_draws_rpc.sql
--
-- ═══ POR QUE ISTO EXISTE ═════════════════════════════════════════════════════════════════════
--
-- Desde o cutover de 2026-08-22 o banco e o sistema de registro e `data.js` e projecao dele. Mas
-- o site so via o banco atraves de PR: cada deposito exigia PR do manifesto, workflow de apply e
-- PR automatico do `data.js`, cada um esperando `npm run check`. Em 2026-11-18 tres depositos
-- ficaram horas fora do site porque o check travou na instalacao do Playwright. Pedido do
-- organizador: "ter uma maneira de atualizar tudo no banco e o site le de la sem ter que fazer
-- PR toda hora".
--
-- ═══ O QUE A FUNCAO DEVOLVE ══════════════════════════════════════════════════════════════════
--
-- Para os sorteios de ate 7 dias atras em diante (o aberto, e o recem-sorteado ate o `data.js`
-- ser sincronizado), uma linha por participacao com EXATAMENTE os campos que o site ja publica
-- no `data.js` (`CAMPOS_DERIVADOS` de public_projection.mjs, mais o horario do pagamento):
--
--   draw_date  data do sorteio
--   name       lottery_participants.display_name
--   cotas      lottery_participations.cotas
--   valor      liquido do razao da participacao (contribuicao + ajuste + estorno + ...), a mesma
--              soma de `liquidoDaParticipacao`
--   metodo     meio da contribuicao mais antiga (`contribuicaoPrincipal`)
--   paid_at    horario da contribuicao mais antiga (vira data/hora no site)
--   contribuiu existe contribuicao (define "verificado" x "pendente", como `projetarParticipante`;
--              uma contribuicao sem horario gravado continua sendo pagamento)
--
-- Allowlist por construcao: o SELECT nomeia cada coluna. `email`, `phone`, `external_reference`,
-- `memo`, `reason`, `operator_client_ref`, ids e `proof_object_path` nunca sao lidos. Nada que
-- nao esteja hoje no `data.js` publico sai por aqui.
--
-- ═══ ACESSO ══════════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER porque `anon` nao tem (e continua sem) privilegio nas tabelas `lottery_*`
-- (20260821205500). A funcao e a UNICA porta, so le, e so devolve o recorte acima.
-- `search_path` fixo (pg_catalog, pg_temp) e nomes qualificados: nada resolve por um schema que o chamador controle.
-- PUBLIC revogado; EXECUTE so para anon, authenticated e service_role. Ratificada em
-- bolao/shared/safety/ratified_rpc_exposure.json e function_access_model.json.
--
-- ROLLBACK: supabase/rollbacks/20261118140000_powerball_public_open_draws_rpc.rollback.sql

begin;

create or replace function public.lottery_public_open_draws()
returns table (
  draw_date date,
  name text,
  cotas numeric,
  valor numeric,
  metodo text,
  paid_at timestamptz,
  contribuiu boolean
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select d.draw_date,
         p.display_name,
         pa.cotas,
         coalesce(sum(t.amount), 0),
         (array_agg(t.method order by t.paid_at asc nulls last)
            filter (where t.type = 'contribution'))[1],
         min(t.paid_at) filter (where t.type = 'contribution'),
         coalesce(bool_or(t.type = 'contribution'), false)
    from public.lottery_draws d
    join public.lottery_participations pa on pa.draw_id = d.draw_id
    join public.lottery_participants p on p.participant_id = pa.participant_id
    left join public.lottery_payment_transactions t on t.participation_id = pa.participation_id
   where d.draw_date >= ((now() at time zone 'America/New_York')::date - 7)
   group by d.draw_date, pa.participation_id, p.display_name, pa.cotas
   order by d.draw_date,
            min(t.paid_at) filter (where t.type = 'contribution') asc nulls last,
            p.display_name;
$$;

revoke all on function public.lottery_public_open_draws() from public;
grant execute on function public.lottery_public_open_draws() to anon, authenticated, service_role;

commit;
