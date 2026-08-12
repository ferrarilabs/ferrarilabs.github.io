--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812230000_participants_email_is_not_identity.sql
--
-- ═══ POR QUE ═══════════════════════════════════════════════════════════════════════════════════
--
-- `participants_email_uidx` era UNIQUE em `email`. Isso codifica uma afirmacao sobre o mundo real:
-- "um endereco de e-mail pertence a no maximo uma pessoa". Essa afirmacao e FALSA para familias,
-- e a decisao Q33-A1 do operador (2026-08-12) a rejeitou explicitamente:
--
--     "Participant identity is person-based.
--      Email identity and payer/payment source are NOT participant identity.
--      One email may correspond to multiple participants."
--
-- Dois pares pai/filho no bolao compartilham uma caixa de correio:
--
--     Fabrizio Marodin  e  Enrico Marodin
--     Samuel Huller     e  Arthur Lopes Huller
--
-- Sao QUATRO pessoas distintas, com palpites proprios e dinheiro proprio. Com o indice UNIQUE, era
-- impossivel representa-las: gravar as duas do par violava a restricao, e gravar so uma teria sido
-- exatamente a fusao de identidades que o RED Q33-A1 existia para impedir.
--
-- ═══ POR QUE RELAXAR E CORRETO, E NAO UMA CONCESSAO ════════════════════════════════════════════
--
-- O proprio `model/target_model.json` declara a razao de ser deste indice:
--
--     "rationale": "dedup candidate lookup; partial because email is nullable and redacted rows
--                   must not block reuse"
--
-- Ou seja: ele existe para PROCURAR candidatos a duplicata, nao para AFIRMAR que e-mail e
-- identidade. A busca continua igualmente rapida com um indice nao-unico. O que se perde e apenas
-- a afirmacao falsa.
--
-- Comparar com ADR-K02, que RECUSOU relaxar `pool_entries_participant_id_pool_id_entry_label_uidx`:
-- la o indice ERA o controle (distingue segunda entrada intencional de duplicata acidental), e a
-- solucao foi desambiguar o rotulo. Aqui o indice nao e o controle de nada — a unicidade da PESSOA
-- e garantida por `participant_id`, nao pelo e-mail.
--
-- ═══ O QUE ISTO NAO FAZ ════════════════════════════════════════════════════════════════════════
--
-- Nao apaga dado. Nao altera linha nenhuma. Nao cria participante. Nao toca em RLS, grant, policy
-- ou em `public.*`. Q38 nao e afetado: `bolao` continua inalcancavel para anon.
--
-- ═══ REVERSIBILIDADE — LEIA ANTES DE TENTAR ════════════════════════════════════════════════════
--
-- Esta migracao e reversivel APENAS ENQUANTO nenhum e-mail for compartilhado por dois
-- participantes vivos. Assim que os pares pai/filho existirem, recriar o indice UNIQUE FALHA com
-- unique_violation — e isso e a prova de que a restricao antiga era incompativel com os dados
-- reais, nao um acidente. Ver o .rollback.sql ao lado.

drop index if exists bolao.participants_email_uidx;

-- Mesmo escopo parcial, mesma coluna, mesma utilidade de busca — sem a afirmacao de unicidade.
create index if not exists participants_email_idx
  on bolao.participants (email)
  where email is not null and redacted_at is null;

comment on index bolao.participants_email_idx is
  'Busca de candidatos a duplicata por e-mail. NAO e unico de proposito: Q33-A1 (2026-08-12) '
  'estabeleceu que identidade de participante e da PESSOA, e que uma caixa de correio pode '
  'pertencer a mais de um participante (dois pares pai/filho no bolao). A unicidade da pessoa e '
  'garantida por participant_id.';

select 'participants.email deixou de ser identidade; unicidade da pessoa fica em participant_id'
    as resultado;
