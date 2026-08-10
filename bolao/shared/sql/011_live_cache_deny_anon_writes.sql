-- 011_live_cache_deny_anon_writes.sql — F8.
--
-- POR QUE EXISTE: `live_sports_cache` tinha policies de INSERT e UPDATE concedidas a `public`,
-- o que inclui `anon`. A anon key e PUBLICA por construcao -- ela vai no `js/config.js` servido a
-- todo navegador.
--
-- Isto nao era teorico. Em 2026-08-10, uma sonda de seguranca feita com a anon key substituiu o
-- payload de `br2026` por `{"__probe__": "..."}`: zero partidas, forma invalida. O placar ao vivo
-- de todo mundo ficou apoiado apenas na validacao do lado do cliente ate o gateway reescrever o
-- cache ~13 minutos depois.
--
-- O raciocinio antigo, registrado no proprio codigo da Edge Function, era que "o pior caso e
-- sobrescrever cache esportivo publico por outro dado esportivo publico". Isso subestimava o
-- dano: o pior caso e APAGAR o dado ao vivo de todos.
--
-- PRE-REQUISITO JA APLICADO: a Edge Function `live-football` passou a escrever com
-- SUPABASE_SERVICE_ROLE_KEY (deploy anterior a esta migracao, verificado escrevendo o cache).
-- Sem essa ordem, remover as policies quebraria o dado ao vivo.
--
-- A LEITURA CONTINUA: `live_cache_read` permanece. E dado esportivo publico, e o gateway le com
-- a anon key.
--
-- ROLLBACK: ver o rodape.

drop policy if exists live_cache_write  on public.live_sports_cache;   -- INSERT para public
drop policy if exists live_cache_update on public.live_sports_cache;   -- UPDATE para public

-- Garantia explicita: nenhum DELETE jamais foi concedido, e nao deve passar a existir.
revoke insert, update, delete, truncate on public.live_sports_cache from anon;

-- RLS continua habilitada; sem policy de escrita, toda escrita anonima e negada.
alter table public.live_sports_cache enable row level security;

-- ROLLBACK (so se preciso reverter):
-- create policy live_cache_write  on public.live_sports_cache for insert to public with check (true);
-- create policy live_cache_update on public.live_sports_cache for update to public using (true) with check (true);
-- grant insert, update on public.live_sports_cache to anon;
