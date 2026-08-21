-- 20260821030000_secure_default_privileges_public.sql
-- Issue #271 — objeto novo em `public` nao nasce exposto ao cliente. METADE APLICADA.
--
-- ─── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────────────────────
--
-- `pg_default_acl` de `public` concedia TABLES (`arwdDxtm`), SEQUENCES (`rwU`) e FUNCTIONS (`X`)
-- a `anon`, `authenticated` e `service_role` -- para os DOIS papeis criadores. Ou seja: toda
-- tabela nova nascia com CRUD, TRUNCATE, REFERENCES e TRIGGER para o navegador, sem que ninguem
-- escrevesse um GRANT.
--
-- Nao e teoria. `public.bolao_round_notif_jobs` nao tem UM UNICO `grant` em toda a DDL deste
-- repositorio e mesmo assim `anon` tinha TRUNCATE nela em producao (Issue #276). Veio inteiramente
-- do default.
--
-- ─── O QUE ESTA MIGRACAO FAZ, E O QUE ELA DELIBERADAMENTE NAO FAZ ────────────────────────────
--
-- APLICADO em producao em 2026-08-21: TABLES e SEQUENCES para o papel criador `postgres`.
-- E o papel que realmente cria objeto aqui -- as doze tabelas de `public` sao todas dele.
--
-- NAO APLICADO, e cada um por um motivo diferente e verificado:
--
--   1. FUNCTIONS (qualquer papel criador) -- PARADO NO PORTAO HUMANO.
--
--      `CREATE FUNCTION` concede EXECUTE a PUBLIC por padrao EMBUTIDO do PostgreSQL, e isso NAO E
--      SUPRIMIVEL por default privileges. Medido em cluster PostgreSQL 17.10 efemero, quatro
--      variantes:
--        (a) com os defaults de producao   -> funcao nova nasce `{=X/owner,...}`  PUBLIC=true
--        (b) + `REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` -> a linha armazenada NAO muda, PUBLIC=true
--        (c) revogando os tres papeis      -> a linha e APAGADA, `proacl=NULL`, PUBLIC=true
--        (d) replicando o shape exato de producao (owner explicito) -> PUBLIC=true tambem
--
--      Logo revogar o default de FUNCTIONS tornaria a exposicao PIOR de ler: os grants nominais
--      sumiriam e o acesso efetivo continuaria, por heranca de PUBLIC. E exatamente a forma
--      "parece aplicado e nao faz nada" da Issue #270.
--
--      O controle correto para funcao ja existe neste repositorio e e outro: revogar de PUBLIC
--      explicitamente na propria migracao que cria a funcao -- como
--      `20260812090000_m8m9_trusted_producer_bridge.sql` faz em laco
--      (`execute format('revoke all on function %s from public', f)`). E contrato de migracao,
--      nao default de schema.
--
--   2. `supabase_admin` (as tres classes) -- BLOQUEADO POR PRIVILEGIO.
--
--      O canal `supabase db query --linked` conecta como `postgres`, que NAO e superusuario neste
--      projeto e NAO e membro de `supabase_admin`. A tentativa devolveu, literalmente:
--        `ERROR: 42501: permission denied to change default privileges`
--      Precisa de um canal com privilegio maior. Ver Issue #271.
--
-- ─── EFEITO SOBRE OBJETOS QUE JA EXISTEM: NENHUM ─────────────────────────────────────────────
--
-- `ALTER DEFAULT PRIVILEGES` so vale no momento do CREATE. Confirmado em simulacao (tabelas
-- criadas antes mantiveram os grants depois da revogacao) e medido em producao: 345 combinacoes
-- de objeto x papel comparadas antes e depois, delta NENHUM.
--
-- Consequencia: isto NAO conserta nenhuma das doze tabelas. Quem consertou foi a #276.
--
-- ─── CONTRATO NOVO ───────────────────────────────────────────────────────────────────────────
--
-- A partir daqui, objeto criado por `postgres` em `public` nasce so do dono. Todo objeto que o
-- Data API deve servir precisa de GRANT explicito na SUA propria migracao. As tres views publicas
-- e as RPCs de cliente ja tem o seu, entao nada em producao muda hoje.
--
-- ─── REVERSAO ────────────────────────────────────────────────────────────────────────────────
--
-- `supabase/rollbacks/20260821030000_secure_default_privileges_public.rollback.sql`

begin;

alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;

-- ─── DIVERGENCIA DE RECONSTRUCAO, corrigida no registro ──────────────────────────────────────
--
-- `CREATE FUNCTION` concede EXECUTE a PUBLIC por padrao embutido. As RPCs do CDB2026 revogam isso
-- explicitamente na propria migracao; `submit_entry` nunca revogou. Producao esta correta
-- (proacl sem PUBLIC), mas ela chegou nesse estado por caminho que a DDL nao reproduz -- entao uma
-- reconstrucao do zero entregaria `submit_entry` executavel por PUBLIC, e por heranca por qualquer
-- papel. O gate `audit_default_privileges.mjs` reprova exatamente isso.
--
-- Este statement e NO-OP em producao: revogar privilegio que PUBLIC ja nao tem nao muda nada, e a
-- leitura pos-mudanca confirma `pub=false` antes e depois. Ele existe para que o repositorio
-- REPRODUZA o estado de producao em vez de depender dele.
revoke all on function public.submit_entry("p_pool_id" text, "p_entry_name" text, "p_participant_email" text, "p_picks" jsonb, "p_client_ref" text, "p_lang" text, "p_tie_ref" text) from public;

commit;
