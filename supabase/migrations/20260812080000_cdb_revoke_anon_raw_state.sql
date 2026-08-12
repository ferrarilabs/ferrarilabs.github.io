-- 20260812080000_cdb_revoke_anon_raw_state.sql
--
-- ═══ O QUE ISTO FECHA ════════════════════════════════════════════════════════════════════════
--
-- Medido em producao com a chave publicavel (a que vai em todo config.js servido ao navegador):
--
--     GET  /rest/v1/bolao_state?id=eq.cdb2026&select=state   -> 200  + participantEmail,
--                                                                      payerName, paymentMethod
--                                                                      dos 12 participantes
--     PATCH /rest/v1/bolao_state?id=eq.<qualquer>             -> 204  (UPDATE permitido)
--
-- Ou seja: qualquer pessoa lia o e-mail, o pagador e o metodo de pagamento de todo mundo, e podia
-- reescrever o documento inteiro do bolao -- palpites, pagamentos, resultados e sorteio oficial.
--
-- ═══ POR QUE SO AGORA ════════════════════════════════════════════════════════════════════════
--
-- Revogar antes teria derrubado o app em producao. A ordem foi cumprida:
--
--   1. projecao sanitizada `bolao_state_public` ja existia
--   2. RPCs seguras criadas (migracao 20260812070000): cdb_my_entry / cdb_save_my_picks
--   3. canario de acesso seguro PASSOU contra producao (14/14)
--   4. navegador cortado para a projecao e deployado
--   5. canario de producao confirmou: leituraRAW=0, PII na rede=0, desktop e mobile
--   6. ENTAO esta revogacao
--
-- ═══ ESCOPO — POR QUE NAO E UM `REVOKE` NA TABELA ════════════════════════════════════════════
--
-- `bolao_state` e COMPARTILHADA por tres bolões. O Copa (`id = 'main'`) ainda le e grava a linha
-- crua pelo navegador; o BR2026 ja usa a projecao. Um `revoke` na tabela derrubaria o Copa.
--
-- Entao a mudanca e nas POLICIES, e cirurgica: sai APENAS `'cdb2026'` das tres policies de anon
-- que listam os tres ids. As policies exclusivas de `'main'` nao sao tocadas, e `'br2026'`
-- permanece por nao ter sido verificado nesta janela -- remover o que nao foi testado seria
-- trocar uma exposicao por uma indisponibilidade.
--
-- EFEITO COLATERAL DELIBERADO: a escrita anonima de documento inteiro do CDB acaba aqui. O app
-- ja se recusa a faze-la (marca `__sanitized`); esta migracao torna a recusa uma garantia do
-- banco em vez de uma gentileza do cliente. Mutacao de operador passa a exigir
-- `cdb_apply_operator_mutation` com service_role; palpite passa por `cdb_save_my_picks`.
--
-- ROLLBACK: recriar as tres policies incluindo 'cdb2026' no array (definicao anterior abaixo,
-- em comentario, para nao depender de memoria).
--
--   CREATE POLICY "allow anon read" ON public.bolao_state FOR SELECT TO anon
--     USING (id = ANY (ARRAY['main','br2026','cdb2026']));
--   CREATE POLICY "allow anon insert" ON public.bolao_state FOR INSERT TO anon
--     WITH CHECK (id = ANY (ARRAY['main','br2026','cdb2026']));
--   CREATE POLICY "allow anon update" ON public.bolao_state FOR UPDATE TO anon
--     USING (id = ANY (ARRAY['main','br2026','cdb2026']))
--     WITH CHECK (id = ANY (ARRAY['main','br2026','cdb2026']));

-- ── SELECT ───────────────────────────────────────────────────────────────────────────────────
drop policy if exists "allow anon read" on public.bolao_state;
create policy "allow anon read" on public.bolao_state
  for select to anon
  using (id = any (array['main'::text, 'br2026'::text]));

-- ── INSERT ───────────────────────────────────────────────────────────────────────────────────
drop policy if exists "allow anon insert" on public.bolao_state;
create policy "allow anon insert" on public.bolao_state
  for insert to anon
  with check (id = any (array['main'::text, 'br2026'::text]));

-- ── UPDATE ───────────────────────────────────────────────────────────────────────────────────
drop policy if exists "allow anon update" on public.bolao_state;
create policy "allow anon update" on public.bolao_state
  for update to anon
  using      (id = any (array['main'::text, 'br2026'::text]))
  with check (id = any (array['main'::text, 'br2026'::text]));

-- As policies exclusivas de 'main' (`allow anon read bolao state`, `allow anon update bolao
-- state`, `allow anon upsert bolao state`) NAO sao tocadas: o Copa depende delas e nao faz parte
-- deste corte.

select 'anon perdeu SELECT/INSERT/UPDATE em bolao_state para cdb2026; main e br2026 intactos'
    as resultado;
