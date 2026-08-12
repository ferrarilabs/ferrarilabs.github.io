-- 20260813020000_cdb_confirmation_recipient_resolution.sql
--
-- ═══ QUEM RESOLVE O DESTINATARIO ═════════════════════════════════════════════════════════════
--
-- O evento criado por `cdb_save_my_picks` carrega SO o `entryId`. Alguem precisa transformar isso
-- num endereco, e esse alguem e o consumidor confiavel -- nunca o navegador.
--
-- O schema `bolao` nao e exposto ao PostgREST (medido: 406 "Invalid schema" para toda chave,
-- inclusive service_role). Entao o consumidor nao consegue ler a permissao nem a linha crua
-- direto: precisa destas duas funcoes em `public`.
--
-- ═══ O PORTAO FICA AQUI DENTRO, NAO NO PYTHON ════════════════════════════════════════════════
--
-- `cdb_confirmation_recipient` so devolve endereco se EXISTIR permissao para aquela entrada. Sem
-- permissao, devolve `allowed=false` e `recipient=null` -- nao devolve o endereco e deixa o
-- chamador decidir.
--
-- A diferenca importa. Se o portao estivesse no consumidor, "nao enviar para outro participante"
-- seria uma promessa do meu codigo, e o meu codigo ja mandou quatro e-mails errados hoje. Aqui,
-- o consumidor e ESTRUTURALMENTE incapaz de obter o endereco de quem nao esta liberado: nao ha
-- caminho, nem por bug, nem por parametro trocado, nem por chamada manual. `OTHER_PARTICIPANT_
-- PROVIDER_CALLS = 0` deixa de depender de disciplina.
--
-- ═══ FECHAMENTO AUTOMATICO ═══════════════════════════════════════════════════════════════════
--
-- `cdb_close_confirmation_allowance` apaga a permissao depois da entrega aceita. A liberacao vale
-- para UMA validacao; ela se consome. Permissao que fica aberta e a que envia o segundo e-mail
-- semanas depois, quando ninguem lembra por que estava ligada.
--
-- Nenhuma das duas e concedida a anon/authenticated. Sao caminho de servidor.
--
-- ROLLBACK: `drop function public.cdb_confirmation_recipient(text)` e
--           `drop function public.cdb_close_confirmation_allowance(text)`. Nada de dado e tocado.

create or replace function public.cdb_confirmation_recipient(p_entry_id text)
  returns table (allowed boolean, recipient text, entry_name text)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_entry jsonb;
begin
  -- PERMISSAO PRIMEIRO. Antes de qualquer leitura de PII.
  if not exists (select 1 from bolao.cdb_confirmation_allowance a where a.entry_id = p_entry_id) then
    return query select false, null::text, null::text;
    return;
  end if;

  select e into v_entry
    from bolao_state s,
         jsonb_array_elements(coalesce(s.state->'entries','[]'::jsonb)) as e
   where s.id = 'cdb2026'
     and e->>'id' = p_entry_id
     and not coalesce(s.state->'deletedIds','[]'::jsonb) ? p_entry_id
   limit 1;

  if v_entry is null then
    return query select false, null::text, null::text;
    return;
  end if;

  if coalesce(v_entry->>'participantEmail','') = '' then
    return query select false, null::text, null::text;
    return;
  end if;

  return query select true, v_entry->>'participantEmail', v_entry->>'entryName';
end;
$$;

revoke all on function public.cdb_confirmation_recipient(text) from public;
revoke all on function public.cdb_confirmation_recipient(text) from anon;
revoke all on function public.cdb_confirmation_recipient(text) from authenticated;
grant execute on function public.cdb_confirmation_recipient(text) to service_role;


create or replace function public.cdb_close_confirmation_allowance(p_entry_id text)
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare v_n integer;
begin
  delete from bolao.cdb_confirmation_allowance a where a.entry_id = p_entry_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.cdb_close_confirmation_allowance(text) from public;
revoke all on function public.cdb_close_confirmation_allowance(text) from anon;
revoke all on function public.cdb_close_confirmation_allowance(text) from authenticated;
grant execute on function public.cdb_close_confirmation_allowance(text) to service_role;


-- Concessao da permissao. Existe como funcao (e nao INSERT direto) porque `bolao` nao e exposto
-- ao PostgREST -- e porque liberar envio para uma pessoa real merece um verbo com nome proprio.
create or replace function public.cdb_grant_confirmation_allowance(p_entry_id text, p_note text)
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
begin
  insert into bolao.cdb_confirmation_allowance (entry_id, note)
  values (p_entry_id, p_note)
  on conflict (entry_id) do nothing;
  return (select count(*)::integer from bolao.cdb_confirmation_allowance);
end;
$$;

revoke all on function public.cdb_grant_confirmation_allowance(text, text) from public;
revoke all on function public.cdb_grant_confirmation_allowance(text, text) from anon;
revoke all on function public.cdb_grant_confirmation_allowance(text, text) from authenticated;
grant execute on function public.cdb_grant_confirmation_allowance(text, text) to service_role;


-- Leitura de verificacao: conta, nunca devolve entry_id nem endereco.
create or replace function public.cdb_confirmation_allowance_count()
  returns integer
  language sql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
  select count(*)::integer from bolao.cdb_confirmation_allowance;
$$;

revoke all on function public.cdb_confirmation_allowance_count() from public;
revoke all on function public.cdb_confirmation_allowance_count() from anon;
revoke all on function public.cdb_confirmation_allowance_count() from authenticated;
grant execute on function public.cdb_confirmation_allowance_count() to service_role;

select 'resolucao de destinatario do comprovante: portao no banco, nao no consumidor' as resultado;
