-- =====================================================================
-- FASE 1A — PACOTE DE CONSULTAS READ-ONLY (NÃO EXECUTADO)
-- =====================================================================
--
-- Estado: NOT EXECUTED. Este arquivo é um artefato de revisão. Nenhuma
-- consulta deste pacote foi executada contra banco algum.
--
-- Objetivo: inventariar METADATA do catálogo PostgreSQL e da plataforma.
-- Este pacote NUNCA lê conteúdo de tabela de aplicação.
--
-- ---------------------------------------------------------------------
-- MODELO DE COLETA: TIME_BOUNDED_MULTI_TRANSACTION_OBSERVATION
-- ---------------------------------------------------------------------
-- ISTO NÃO É UM SNAPSHOT ATÔMICO, e não deve ser chamado assim.
--
-- Cada seção roda na SUA PRÓPRIA transação, com o SEU PRÓPRIO snapshot.
-- Duas seções vizinhas podem observar o catálogo em estados diferentes.
-- Se alguém aplicar uma migration no meio da coleta, S03 pode listar uma
-- tabela que S21a já não vê — e nada no resultado denunciaria isso.
--
-- Consequências operacionais, obrigatórias:
--   · executar em janela SEM migration e SEM database deployment;
--   · registrar collection_started_at_utc e collection_ended_at_utc;
--   · registrar collected_at_utc por seção;
--   · uma janela longa aumenta o risco de inconsistência entre seções.
--
-- Cada seção executável é um bloco AUTOCONTIDO:
--
--     BEGIN READ ONLY;
--     SET LOCAL statement_timeout = '30s';
--     SET LOCAL lock_timeout = '2s';
--     SET LOCAL idle_in_transaction_session_timeout = '60s';
--     SHOW transaction_read_only;      -- deve ser 'on'
--     <SELECTs da seção>
--     ROLLBACK;
--
-- POR QUE, e não uma transação única: em PostgreSQL, assim que um
-- statement falha dentro de uma transação, a transação inteira entra em
-- estado ABORTED e todo statement subsequente falha com SQLSTATE 25P02
-- até que se execute ROLLBACK. Com uma transação única, a primeira seção
-- que desse permission denied derrubaria TODAS as seguintes.
--
-- O modelo one-transaction-per-section permanece aprovado. Trocar por
-- uma transação longa "para ficar atômico" NÃO é a correção: seguraria
-- snapshot e impediria vacuum em produção. O custo aceito é a
-- não-atomicidade, e ela é declarada em vez de escondida.
--
-- SAVEPOINT / ROLLBACK TO SAVEPOINT também NÃO é adotado, pelo mesmo
-- motivo: manteria a sessão dentro de uma transação por toda a coleta.
--
-- COMMIT é proibido e está ausente deste pacote.
--
-- Proibido neste pacote, por construção:
--   DDL · DML · MERGE · TRUNCATE · CALL · COPY · CREATE TEMP · COMMIT ·
--   DO/plpgsql · chamada de function da aplicação · leitura de tabela de
--   participante · leitura de segredo · leitura de object key de Storage ·
--   free-text de metadata (proconfig, comando de cron, settings de role,
--   comentários de objeto, labels de enum, EXPRESSÕES DE POLICY,
--   partition bounds, options de FDW/server/user mapping).
--
-- Sobre "não chamar function da aplicação": uma function pode ter efeito
-- colateral mesmo invocada dentro de um SELECT. Este pacote só invoca
-- functions internas do catálogo do PostgreSQL (pg_get_userbyid,
-- pg_get_expr, pg_get_constraintdef, pg_get_indexdef, pg_get_viewdef,
-- pg_get_function_identity_arguments, pg_total_relation_size,
-- pg_relation_size, to_regclass, format_type, aclexplode, acldefault) e
-- funções de string/array/agregação do core (regexp_replace, split_part,
-- substr, string_agg, array_agg, md5, length, unnest). Nenhuma delas
-- pertence à aplicação.
--
-- ---------------------------------------------------------------------
-- SOBRE SANITIZAÇÃO DE EXPRESSÃO — LEIA ANTES DE CONFIAR NA SAÍDA
-- ---------------------------------------------------------------------
-- O padrão
--     regexp_replace(<expr>, '''[^'']*''', '<REDACTED_LITERAL>', 'g')
-- NÃO é um sanitizer universal. Ele não trata:
--   · dollar-quoting ($$...$$, $tag$...$tag$);
--   · aspas simples duplicadas dentro do próprio literal ('' escapado);
--   · identificadores entre aspas DUPLAS que contenham dado real;
--   · literais montados por concatenação (|| ou format());
--   · números, UUIDs e e-mails que não estejam entre aspas.
--
-- Portanto: NUNCA declarar "safe because literals were removed".
--
-- CONSEQUÊNCIA, aplicada na íntegra neste pacote:
-- NENHUMA EXPRESSÃO SAI. Nem sanitizada, nem parcialmente redigida.
-- Não há uso de regexp_replace sobre expressão em nenhuma seção — o
-- padrão acima está documentado aqui como o que foi REJEITADO.
--
-- O que sai no lugar, para todo inventário amplo:
--     STRUCTURAL_FLAGS + LENGTH + HASH + TOPOLOGIA DE COLUNAS
--
-- Topologia de coluna (nomes de coluna de PK/FK/UNIQUE, colunas de
-- índice, colunas de partição) é METADATA de schema e é segura. Slots de
-- expressão saem como o literal '<EXPRESSION>', nunca como o texto.
--
-- Quando a semântica de uma expressão for necessária para uma decisão,
-- o objeto entra em DIRECTED_*_REVIEW_REQUIRED e é lido individualmente
-- em etapa separada e autorizada — nunca em varredura ampla.
--
-- Seções guardadas: S16 (pg_cron), S17 (Storage), S18 (Vault) dependem
-- de objetos que podem não existir. Cada uma começa por um PROBE que
-- retorna NULL quando o objeto está ausente. Só rodar a consulta
-- seguinte se o probe retornar não-nulo — caso contrário registrar
-- SKIPPED_BY_PROBE / CONFIRMED_ABSENT e seguir.
--
-- Total de seções: 37 (PREFLIGHT + 36). A lista canônica está em
-- PHASE1_EXECUTION_RUNBOOK.md §2 e em $defs/section_id do
-- PHASE1_RESULT_SCHEMA.json. As três precisam bater exatamente.
--
-- =====================================================================


-- =====================================================================
-- PREFLIGHT — provar que a sessão consegue abrir transação READ ONLY
-- =====================================================================
-- Se transaction_read_only não for 'on', ABORTAR a coleta inteira.
-- PREFLIGHT é a única seção que NÃO pode estar BLOCKED, SKIPPED nem
-- NOT_RUN numa coleta válida: sem ela não há prova de read-only.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

SHOW transaction_read_only;
-- ^ Resultado esperado: on
--   Qualquer outro valor  => ROLLBACK; e ABORTAR a coleta.

ROLLBACK;


-- =====================================================================
-- S01 · IDENTIDADE DO BANCO
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S01'                                     AS section,
    version()                                 AS pg_version,
    current_database()                        AS database_name,
    current_user                              AS current_role_name,
    session_user                              AS session_role_name,
    current_setting('transaction_read_only')  AS transaction_read_only,
    current_setting('TimeZone')               AS timezone,
    current_setting('search_path')            AS search_path,
    current_setting('server_version_num')     AS server_version_num,
    (now() AT TIME ZONE 'UTC')                AS collected_at_utc;

ROLLBACK;

-- server_version_num importa para S14f: inherit_option e set_option só
-- existem em pg_auth_members a partir do PostgreSQL 16. Em 15 ou
-- anterior, S14f falha e deve ser registrada como BLOCKED com
-- failure_type = SYNTAX_UNSUPPORTED_VERSION.
--
-- O nome do projeto/ref NÃO é coletado aqui. Ele é mascarado no
-- PHASE1_RESULT_SCHEMA.json como project_reference_masked.


-- =====================================================================
-- S02 · SCHEMAS  (com a BASE da classificação declarada)
-- =====================================================================
-- A classificação por NOME é heurística, não fato descoberto do
-- catálogo. classification_basis torna isso explícito para quem lê o
-- resultado: SYSTEM_RULE e EXTENSION_OWNED vêm do catálogo;
-- KNOWN_SUPABASE_MANAGED_SCHEMA vem de uma lista mantida à mão;
-- APPLICATION_CANDIDATE é o que sobra — um candidato, não um veredito.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S02'                               AS section,
    n.nspname                           AS schema_name,
    pg_get_userbyid(n.nspowner)         AS schema_owner,
    CASE
      WHEN n.nspname IN ('pg_catalog', 'information_schema')
        OR n.nspname LIKE 'pg\_%'                        THEN 'SYSTEM'
      WHEN n.nspname IN ('auth', 'storage', 'realtime', '_realtime',
                         'graphql', 'graphql_public', 'vault',
                         'extensions', 'supabase_functions',
                         'supabase_migrations', 'pgsodium',
                         'pgsodium_masks', 'net', 'cron',
                         '_analytics', 'pgbouncer')      THEN 'PROVIDER_MANAGED'
      WHEN e.extname IS NOT NULL                         THEN 'EXTENSION'
      ELSE 'APPLICATION'
    END                                 AS schema_class,
    CASE
      WHEN n.nspname IN ('pg_catalog', 'information_schema')
        OR n.nspname LIKE 'pg\_%'                        THEN 'SYSTEM_RULE'
      WHEN n.nspname IN ('auth', 'storage', 'realtime', '_realtime',
                         'graphql', 'graphql_public', 'vault',
                         'extensions', 'supabase_functions',
                         'supabase_migrations', 'pgsodium',
                         'pgsodium_masks', 'net', 'cron',
                         '_analytics', 'pgbouncer')      THEN 'KNOWN_SUPABASE_MANAGED_SCHEMA'
      WHEN e.extname IS NOT NULL                         THEN 'EXTENSION_OWNED'
      ELSE 'APPLICATION_CANDIDATE'
    END                                 AS classification_basis,
    e.extname                           AS owning_extension,
    (n.nspacl IS NULL)                  AS acl_is_default
FROM pg_namespace n
LEFT JOIN pg_extension e ON e.extnamespace = n.oid
ORDER BY schema_class, n.nspname;

ROLLBACK;

-- KNOWN_SUPABASE_MANAGED_SCHEMA é a única base NÃO derivada do catálogo.
-- Se um schema de aplicação tiver, por coincidência, um desses nomes,
-- ele será classificado errado — e a única defesa é esta coluna estar
-- visível no relatório. Um schema APPLICATION_CANDIDATE não está
-- confirmado como da aplicação: é o resíduo da heurística.
--
-- O ACL do schema NÃO sai como texto aqui: sai expandido e classificado
-- em S21c.


-- =====================================================================
-- S03 · RELAÇÕES + TOPOLOGIA DE PARTIÇÃO
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S03'                               AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS relation_name,
    CASE c.relkind
      WHEN 'r' THEN 'ordinary_table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'f' THEN 'foreign_table'
    END                                 AS relation_kind,
    pg_get_userbyid(c.relowner)         AS relation_owner,
    CASE c.relpersistence
      WHEN 'p' THEN 'permanent'
      WHEN 'u' THEN 'unlogged'
      WHEN 't' THEN 'temporary'
    END                                 AS persistence,
    c.relrowsecurity                    AS rls_enabled,
    c.relforcerowsecurity               AS rls_forced,
    pg_total_relation_size(c.oid)       AS total_bytes,
    pg_relation_size(c.oid)             AS heap_bytes,
    c.reltuples::bigint                 AS row_estimate_planner,
    (c.reltuples > 0)                   AS row_estimate_gt_zero,
    (c.reltuples = -1)                  AS row_estimate_never_analyzed,
    c.relhastriggers                    AS has_triggers,
    (c.relacl IS NULL)                  AS acl_is_default,
    -- TOPOLOGIA DE PARTIÇÃO — filha
    c.relispartition                    AS is_partition,
    parent_n.nspname                    AS partition_parent_schema,
    parent_c.relname                    AS partition_parent_relation,
    -- Partition bound NUNCA sai como texto: um bound codifica VALORES de
    -- negócio (faixas de data, listas de chave). Só comprimento e hash.
    length(pg_get_expr(c.relpartbound, c.oid))
                                        AS partition_bound_length_chars,
    md5(COALESCE(pg_get_expr(c.relpartbound, c.oid), ''))
                                        AS partition_bound_md5,
    -- TOPOLOGIA DE PARTIÇÃO — pai
    (c.relkind = 'p')                   AS is_partitioned_parent,
    CASE pt.partstrat
      WHEN 'r' THEN 'RANGE' WHEN 'l' THEN 'LIST' WHEN 'h' THEN 'HASH'
    END                                 AS partition_strategy,
    pk.cols                             AS partition_key_column_names
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_inherits inh      ON inh.inhrelid = c.oid AND c.relispartition
LEFT JOIN pg_class parent_c    ON parent_c.oid = inh.inhparent
LEFT JOIN pg_namespace parent_n ON parent_n.oid = parent_c.relnamespace
LEFT JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
LEFT JOIN LATERAL (
    SELECT array_agg(
             CASE WHEN k.attnum = 0 THEN '<EXPRESSION>' ELSE att.attname END
             ORDER BY k.ord) AS cols
    FROM unnest(pt.partattrs::smallint[]) WITH ORDINALITY AS k(attnum, ord)
    LEFT JOIN pg_attribute att ON att.attrelid = c.oid
                              AND att.attnum = k.attnum
) pk ON TRUE
WHERE c.relkind IN ('r', 'p', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_toast%'
  AND n.nspname NOT LIKE 'pg\_temp%'
ORDER BY n.nspname, c.relname;

ROLLBACK;

-- SEMÂNTICA DE ESTIMATIVA — regra dura:
-- row_estimate_planner é ESTIMATIVA do PLANNER (pg_class.reltuples),
-- atualizada por ANALYZE/autovacuum. Pode ser -1 em tabela nunca
-- analisada, e pode estar arbitrariamente defasada.
--   · row_estimate_gt_zero = true significa APENAS ROW_ESTIMATE_GT_ZERO.
--     Não significa ROWS_PRESENT, e muito menos CONFIRMED_ROWS_PRESENT.
--   · PRODUCTION_STATE NÃO MUDA por estimativa do planner. Catálogo dá
--     CONFIRMED_PRESENT; sem telemetria o estado correto continua sendo
--     PRESENT_USAGE_UNKNOWN.
--   · EXACT_BUSINESS_RECONCILIATION = DEFERRED_TO_PHASE1B.
--
-- A topologia de partição é metadata de schema (nomes de coluna,
-- estratégia, quem é pai de quem) e é segura. O BOUND não é.


-- =====================================================================
-- S04 · COLUNAS  (defaults como FLAGS + LENGTH + HASH; nunca a expressão)
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S04'                               AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS relation_name,
    a.attnum                            AS column_position,
    a.attname                           AS column_name,
    format_type(a.atttypid, a.atttypmod) AS data_type,
    a.attnotnull                        AS not_null,
    CASE a.attidentity
      WHEN 'a' THEN 'identity_always'
      WHEN 'd' THEN 'identity_by_default'
      ELSE NULL
    END                                 AS identity_kind,
    CASE a.attgenerated
      WHEN 's' THEN 'generated_stored'
      ELSE NULL
    END                                 AS generated_kind,
    (a.attacl IS NOT NULL)              AS has_explicit_column_acl,
    (ad.adbin IS NOT NULL)              AS has_default,
    -- STRUCTURAL_FLAGS: estrutura, nunca conteúdo
    (pg_get_expr(ad.adbin, ad.adrelid) ~* 'now\(\)|current_timestamp|clock_timestamp')
                                        AS default_uses_time_function,
    (pg_get_expr(ad.adbin, ad.adrelid) ~* 'gen_random_uuid|uuid_generate')
                                        AS default_uses_uuid_function,
    (pg_get_expr(ad.adbin, ad.adrelid) ~* 'nextval\(')
                                        AS default_uses_sequence,
    (pg_get_expr(ad.adbin, ad.adrelid) ~* 'current_setting|auth\.')
                                        AS default_uses_session_context,
    (pg_get_expr(ad.adbin, ad.adrelid) LIKE '%''%')
                                        AS default_contains_string_literal,
    (pg_get_expr(ad.adbin, ad.adrelid) LIKE '%$$%')
                                        AS default_contains_dollar_quote,
    length(pg_get_expr(ad.adbin, ad.adrelid))
                                        AS default_length_chars,
    md5(pg_get_expr(ad.adbin, ad.adrelid))
                                        AS default_md5
FROM pg_attribute a
JOIN pg_class c      ON c.oid = a.attrelid
JOIN pg_namespace n  ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p', 'f', 'v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_toast%'
ORDER BY n.nspname, c.relname, a.attnum;

ROLLBACK;

-- has_explicit_column_acl aponta para S21f, onde o ACL de coluna é
-- expandido. Grant de coluna é mais específico que o de tabela e passa
-- despercebido com facilidade.
-- A expressão do default NÃO sai. Se o texto de um default específico
-- for necessário, é revisão dirigida, com justificativa registrada.


-- =====================================================================
-- S05 · CONSTRAINTS DE RELAÇÃO + TOPOLOGIA DE COLUNAS
-- =====================================================================
-- Nomes de coluna de PK/FK/UNIQUE são metadata de schema e são seguros.
-- A ORDEM importa: uma PK (a, b) não é a mesma coisa que (b, a), e uma
-- FK só é interpretável sabendo qual coluna aponta para qual.
-- CHECK continua sem definição: só flags + length + hash.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S05'                               AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS relation_name,
    con.conname                         AS constraint_name,
    CASE con.contype
      WHEN 'p' THEN 'PRIMARY KEY'
      WHEN 'f' THEN 'FOREIGN KEY'
      WHEN 'u' THEN 'UNIQUE'
      WHEN 'c' THEN 'CHECK'
      WHEN 'x' THEN 'EXCLUSION'
      WHEN 't' THEN 'CONSTRAINT TRIGGER'
      ELSE con.contype::text
    END                                 AS constraint_type,
    con.condeferrable                   AS is_deferrable,
    con.condeferred                     AS initially_deferred,
    con.convalidated                    AS is_validated,
    -- TOPOLOGIA
    ck.cols                             AS constrained_columns,
    fn.nspname                          AS references_schema,
    fc.relname                          AS references_relation,
    fk.cols                             AS referenced_columns,
    CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT' ELSE NULL END AS on_update,
    CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT' ELSE NULL END AS on_delete,
    -- STRUCTURAL_FLAGS (relevantes sobretudo para CHECK e EXCLUSION)
    (pg_get_constraintdef(con.oid) LIKE '%''%')
                                        AS definition_contains_string_literal,
    (pg_get_constraintdef(con.oid) LIKE '%$$%')
                                        AS definition_contains_dollar_quote,
    (pg_get_constraintdef(con.oid) ~ '[0-9]{6,}')
                                        AS definition_contains_long_number,
    (pg_get_constraintdef(con.oid) ~* 'in\s*\(')
                                        AS definition_uses_in_list,
    length(pg_get_constraintdef(con.oid))
                                        AS definition_length_chars,
    md5(pg_get_constraintdef(con.oid))  AS definition_md5
FROM pg_constraint con
JOIN pg_class c          ON c.oid = con.conrelid
JOIN pg_namespace n      ON n.oid = c.relnamespace
LEFT JOIN pg_class fc    ON fc.oid = con.confrelid
LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
LEFT JOIN LATERAL (
    SELECT array_agg(att.attname ORDER BY k.ord) AS cols
    FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute att ON att.attrelid = con.conrelid
                         AND att.attnum = k.attnum
) ck ON TRUE
LEFT JOIN LATERAL (
    SELECT array_agg(att.attname ORDER BY k.ord) AS cols
    FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute att ON att.attrelid = con.confrelid
                         AND att.attnum = k.attnum
) fk ON TRUE
WHERE con.conrelid <> 0
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname, con.contype, con.conname;

ROLLBACK;

-- definition_contains_string_literal = true num CHECK sinaliza regra de
-- negócio codificada em literais. Se o texto for necessário, é revisão
-- dirigida — nunca em varredura ampla.


-- =====================================================================
-- S05b · CONSTRAINTS DE DOMAIN
-- =====================================================================
-- Constraints de domain têm conrelid = 0 e contypid <> 0, e por isso
-- ficavam INVISÍVEIS na consulta acima. Um CHECK de domain aplica-se a
-- toda coluna daquele domain em todo o banco: é regra de negócio de
-- alcance amplo, e sumir do inventário é exatamente o tipo de lacuna
-- silenciosa que uma leitura zero-based não pode ter.
-- Definição continua sem sair: só flags + length + hash.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S05b'                              AS section,
    n.nspname                           AS domain_schema,
    t.typname                           AS domain_name,
    format_type(t.typbasetype, t.typtypmod) AS domain_base_type,
    t.typnotnull                        AS domain_not_null,
    pg_get_userbyid(t.typowner)         AS domain_owner,
    con.conname                         AS constraint_name,
    CASE con.contype WHEN 'c' THEN 'CHECK' ELSE con.contype::text END
                                        AS constraint_type,
    con.convalidated                    AS is_validated,
    (pg_get_constraintdef(con.oid) LIKE '%''%')
                                        AS definition_contains_string_literal,
    (pg_get_constraintdef(con.oid) LIKE '%$$%')
                                        AS definition_contains_dollar_quote,
    length(pg_get_constraintdef(con.oid))
                                        AS definition_length_chars,
    md5(pg_get_constraintdef(con.oid))  AS definition_md5
FROM pg_constraint con
JOIN pg_type t      ON t.oid = con.contypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE con.conrelid = 0
  AND con.contypid <> 0
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, t.typname, con.conname;

ROLLBACK;

-- O DEFAULT do domain (t.typdefault) NÃO é lido: é texto livre de valor.


-- =====================================================================
-- S06 · ÍNDICES + TOPOLOGIA DE COLUNAS
-- =====================================================================
-- Nomes de coluna de índice são metadata de schema e são seguros.
-- Slots de expressão saem como o literal '<EXPRESSION>' — o texto da
-- expressão NUNCA sai. Colunas INCLUDE (indnkeyatts < indnatts) saem
-- separadas das key columns: são coisas diferentes e a distinção importa
-- para decidir se um índice cobre uma consulta.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S06'                               AS section,
    n.nspname                           AS schema_name,
    tc.relname                          AS relation_name,
    ic.relname                          AS index_name,
    i.indisunique                       AS is_unique,
    i.indisprimary                      AS is_primary,
    i.indisvalid                        AS is_valid,
    i.indisready                        AS is_ready,
    i.indislive                         AS is_live,
    (i.indpred IS NOT NULL)             AS is_partial,
    (i.indexprs IS NOT NULL)            AS has_expression,
    am.amname                           AS index_method,
    i.indnatts                          AS total_columns,
    i.indnkeyatts                       AS key_column_count,
    topo.key_cols                       AS key_column_names,
    topo.included_cols                  AS included_column_names,
    topo.expression_slot_count          AS expression_slot_count,
    -- STRUCTURAL_FLAGS + HASH; a definição textual não sai
    (pg_get_indexdef(i.indexrelid) LIKE '%''%')
                                        AS definition_contains_string_literal,
    (pg_get_indexdef(i.indexrelid) LIKE '%$$%')
                                        AS definition_contains_dollar_quote,
    length(pg_get_indexdef(i.indexrelid))
                                        AS definition_length_chars,
    md5(pg_get_indexdef(i.indexrelid))  AS definition_md5
FROM pg_index i
JOIN pg_class ic     ON ic.oid = i.indexrelid
JOIN pg_class tc     ON tc.oid = i.indrelid
JOIN pg_namespace n  ON n.oid = tc.relnamespace
JOIN pg_am am        ON am.oid = ic.relam
LEFT JOIN LATERAL (
    SELECT
      array_agg(CASE WHEN k.attnum = 0 THEN '<EXPRESSION>'
                     ELSE att.attname END ORDER BY k.ord)
        FILTER (WHERE k.ord <= i.indnkeyatts)          AS key_cols,
      array_agg(CASE WHEN k.attnum = 0 THEN '<EXPRESSION>'
                     ELSE att.attname END ORDER BY k.ord)
        FILTER (WHERE k.ord > i.indnkeyatts)           AS included_cols,
      COUNT(*) FILTER (WHERE k.attnum = 0)             AS expression_slot_count
    FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord)
    LEFT JOIN pg_attribute att ON att.attrelid = i.indrelid
                             AND att.attnum = k.attnum
) topo ON TRUE
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, tc.relname, ic.relname;

ROLLBACK;

-- is_valid = false  => índice inutilizável (CREATE INDEX CONCURRENTLY
-- que falhou). Achado operacional, não cosmético.
-- Um índice PARCIAL (is_partial) tem um predicado que NÃO sai aqui: se a
-- semântica dele importar, o índice entra em revisão dirigida.


-- =====================================================================
-- S07 · VIEWS E MATERIALIZED VIEWS  (metadata; NUNCA o conteúdo)
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S07'                               AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS view_name,
    CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' END
                                        AS view_kind,
    pg_get_userbyid(c.relowner)         AS view_owner,
    (COALESCE(c.reloptions::text, '') LIKE '%security_barrier%')
                                        AS has_security_barrier,
    (COALESCE(c.reloptions::text, '') LIKE '%security_invoker%')
                                        AS has_security_invoker,
    c.relrowsecurity                    AS rls_enabled_on_matview,
    (c.relacl IS NULL)                  AS acl_is_default,
    length(pg_get_viewdef(c.oid))       AS definition_length_chars,
    md5(pg_get_viewdef(c.oid))          AS definition_md5
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname;

ROLLBACK;

-- A DEFINIÇÃO da view sai como hash + comprimento, não como texto: uma
-- definição pode embutir literais de negócio (ex.: filtro por e-mail).
-- reloptions também não sai como texto: só os dois booleanos derivados.
-- Uma view SEM security_invoker executa com os privilégios do OWNER, e
-- pode contornar RLS das tabelas de base. É a pergunta central para
-- qualquer view que exponha dado de participante.


-- =====================================================================
-- S08 · SEQUENCES  (ownership por AUTO **ou** INTERNAL)
-- =====================================================================
-- A versão anterior filtrava deptype = 'a' apenas, e por isso PERDIA as
-- identity sequences: uma sequence criada por GENERATED ... AS IDENTITY
-- é ligada à coluna por dependência INTERNAL ('i'), não AUTO ('a').
-- O efeito era uma sequence de identity aparecer como órfã.
-- Aqui aceitam-se os dois deptypes; o LATERAL com LIMIT 1 garante uma
-- linha por sequence mesmo que haja mais de uma entrada em pg_depend.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S08'                               AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS sequence_name,
    pg_get_userbyid(c.relowner)         AS sequence_owner,
    (c.relacl IS NULL)                  AS acl_is_default,
    s.seqtypid::regtype::text           AS sequence_type,
    s.seqincrement                      AS increment_by,
    s.seqcycle                          AS is_cycled,
    own.owner_schema                    AS owned_by_schema,
    own.owner_relation                  AS owned_by_relation,
    own.owner_column                    AS owned_by_column,
    own.dependency_kind                 AS ownership_dependency_kind
FROM pg_class c
JOIN pg_namespace n   ON n.oid = c.relnamespace
JOIN pg_sequence s    ON s.seqrelid = c.oid
LEFT JOIN LATERAL (
    SELECT owner_n.nspname AS owner_schema,
           owner_c.relname AS owner_relation,
           owner_a.attname AS owner_column,
           CASE d.deptype WHEN 'a' THEN 'AUTO'
                          WHEN 'i' THEN 'INTERNAL_IDENTITY' END
                           AS dependency_kind
    FROM pg_depend d
    JOIN pg_class owner_c      ON owner_c.oid = d.refobjid
    JOIN pg_namespace owner_n  ON owner_n.oid = owner_c.relnamespace
    JOIN pg_attribute owner_a  ON owner_a.attrelid = d.refobjid
                              AND owner_a.attnum = d.refobjsubid
    WHERE d.objid = c.oid
      AND d.classid = 'pg_class'::regclass
      AND d.refclassid = 'pg_class'::regclass
      AND d.deptype IN ('a', 'i')
      AND d.refobjsubid > 0
    ORDER BY d.deptype
    LIMIT 1
) own ON TRUE
WHERE c.relkind = 'S'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname;

ROLLBACK;

-- last_value é deliberadamente omitido: revela volume de escrita
-- histórica e não é necessário para o inventário. Uma sequence com
-- owned_by_relation NULL é candidata a órfã de verdade — e agora essa
-- conclusão é confiável, porque identity sequences deixaram de aparecer
-- como falso positivo.


-- =====================================================================
-- S09 · TYPES E ENUMS  (contagem + hash de labels; NUNCA os labels)
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S09'                               AS section,
    n.nspname                           AS schema_name,
    t.typname                           AS type_name,
    CASE t.typtype
      WHEN 'b' THEN 'base'      WHEN 'c' THEN 'composite'
      WHEN 'd' THEN 'domain'    WHEN 'e' THEN 'enum'
      WHEN 'p' THEN 'pseudo'    WHEN 'r' THEN 'range'
      WHEN 'm' THEN 'multirange'
    END                                 AS type_category,
    pg_get_userbyid(t.typowner)         AS type_owner,
    (t.typacl IS NULL)                  AS acl_is_default,
    COUNT(e.enumlabel)                  AS enum_label_count,
    md5(COALESCE(string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder), ''))
                                        AS enum_labels_md5
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND t.typtype IN ('e', 'd', 'c', 'r')
  AND NOT EXISTS (
      SELECT 1 FROM pg_class rc
      WHERE rc.oid = t.typrelid AND rc.relkind <> 'c'
  )
GROUP BY n.nspname, t.typname, t.typtype, t.typowner, t.typacl
ORDER BY n.nspname, t.typname;

ROLLBACK;

-- POR QUE OS LABELS NÃO SAEM:
-- Uma versão anterior deste pacote liberava labels que casassem com
--     ^[A-Za-z][A-Za-z0-9_-]{0,60}$
-- tratando isso como proteção contra PII. Não é: essa regex aceita
-- 'Eduardo', 'Marcelo', qualquer nome de pessoa. Um enum construído a
-- partir de dado real passaria inteiro.
-- Labels individuais só podem ser coletados por REVISÃO DIRIGIDA a um
-- tipo específico, com justificativa registrada.
--
-- acl_is_default aqui é indício de TYPE_DOMAIN_PRIVILEGES, que NÃO é
-- expandido nesta fase — registrado como evidence gap.


-- =====================================================================
-- S10 · EXTENSIONS
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S10'                               AS section,
    e.extname                           AS extension_name,
    e.extversion                        AS extension_version,
    n.nspname                           AS installed_schema,
    pg_get_userbyid(e.extowner)         AS extension_owner,
    e.extrelocatable                    AS is_relocatable
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

ROLLBACK;


-- =====================================================================
-- S11 · RLS — POLICIES  (NENHUMA EXPRESSÃO SAI)
-- =====================================================================
-- MUDANÇA DELIBERADA: as colunas using_expression_sanitized e
-- with_check_expression_sanitized foram REMOVIDAS.
--
-- Elas dependiam de redação por regexp_replace de literais entre aspas
-- simples, mais uma "segunda camada" manual no ambiente de execução. Isso
-- é frágil por construção: não cobre dollar-quoting, aspas escapadas,
-- identificadores entre aspas duplas nem concatenação — e uma varredura
-- ampla não é o lugar para apostar em sanitizer imperfeito.
--
-- O que sai são FATOS ESTRUTURAIS + comprimento + hash. É suficiente
-- para responder "esta policy é incondicional?", "ela se apoia em
-- auth.uid()?", "ela embute literais?" — que são as perguntas da fase.
--
-- Toda policy cuja SEMÂNTICA precise ser analisada é marcada como
-- DIRECTED_POLICY_REVIEW_REQUIRED e lida individualmente em etapa
-- separada e autorizada.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S11'                               AS section,
    pol.schemaname                      AS schema_name,
    pol.tablename                       AS relation_name,
    pol.policyname                      AS policy_name,
    pol.permissive                      AS permissive_or_restrictive,
    pol.roles::text                     AS applies_to_roles,
    pol.cmd                             AS command,
    (pol.qual IS NOT NULL)              AS has_using_expression,
    (pol.with_check IS NOT NULL)        AS has_with_check_expression,
    -- USING — fatos estruturais
    (COALESCE(pol.qual, '') ~* 'auth\.uid|auth\.role|auth\.jwt')
                                        AS using_references_auth,
    (COALESCE(pol.qual, '') ~* 'current_setting')
                                        AS using_references_current_setting,
    (COALESCE(pol.qual, '') LIKE '%''%')
                                        AS using_contains_string_literal,
    (COALESCE(pol.qual, '') LIKE '%$$%')
                                        AS using_contains_dollar_quote,
    (COALESCE(pol.qual, '') IN ('true', '(true)'))
                                        AS using_is_unconditional,
    length(COALESCE(pol.qual, ''))      AS using_length_chars,
    md5(COALESCE(pol.qual, ''))         AS using_md5,
    -- WITH CHECK — fatos estruturais
    (COALESCE(pol.with_check, '') ~* 'auth\.uid|auth\.role|auth\.jwt')
                                        AS with_check_references_auth,
    (COALESCE(pol.with_check, '') ~* 'current_setting')
                                        AS with_check_references_current_setting,
    (COALESCE(pol.with_check, '') LIKE '%''%')
                                        AS with_check_contains_string_literal,
    (COALESCE(pol.with_check, '') LIKE '%$$%')
                                        AS with_check_contains_dollar_quote,
    (COALESCE(pol.with_check, '') IN ('true', '(true)'))
                                        AS with_check_is_unconditional,
    length(COALESCE(pol.with_check, '')) AS with_check_length_chars,
    md5(COALESCE(pol.with_check, ''))   AS with_check_md5
FROM pg_policies pol
WHERE pol.schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pol.schemaname, pol.tablename, pol.policyname;

ROLLBACK;

-- Invariantes desta seção, verificáveis estaticamente no pacote:
--   RAW_POLICY_EXPRESSIONS                = 0
--   PARTIALLY_REDACTED_POLICY_EXPRESSIONS = 0


-- =====================================================================
-- S11b · RLS — FATOS por relação (sem enum de conclusão)
-- =====================================================================
-- MUDANÇA DELIBERADA: o rótulo
--     RLS_ON_NO_POLICIES__DENIES_ALL_EXCEPT_OWNER
-- foi REMOVIDO. Ele era falso em pelo menos dois casos:
--   · com FORCE RLS habilitado, o OWNER também é barrado — logo "except
--     owner" está errado;
--   · uma role com BYPASSRLS, ou um superusuário, atravessa a policy de
--     qualquer jeito — e essa linha não tem como saber disso.
--
-- Esta seção passa a retornar FATOS, não conclusões. Duas derivadas
-- estritas e bem definidas ficam:
--     default_deny_for_normal_roles = rls_enabled AND policy_count = 0
--     owner_bypasses_rls            = rls_enabled AND NOT rls_forced
-- "normal roles" = roles sem BYPASSRLS e sem superusuário. BYPASSRLS e
-- superusuário são analisados SEPARADAMENTE em S14e, e a conclusão final
-- é derivada no relatório cruzando as duas seções.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S11b'                              AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS relation_name,
    c.relrowsecurity                    AS rls_enabled,
    c.relforcerowsecurity               AS rls_forced,
    COUNT(pol.polname)                  AS policy_count,
    (c.relrowsecurity AND COUNT(pol.polname) = 0)
                                        AS default_deny_for_normal_roles,
    (c.relrowsecurity AND NOT c.relforcerowsecurity)
                                        AS owner_bypasses_rls,
    (NOT c.relrowsecurity AND COUNT(pol.polname) > 0)
                                        AS policies_defined_but_rls_off
FROM pg_class c
JOIN pg_namespace n   ON n.oid = c.relnamespace
LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_toast%'
GROUP BY n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY n.nspname, c.relname;

ROLLBACK;

-- policies_defined_but_rls_off = true é o achado mais traiçoeiro:
-- policies existem, aparecem em S11, e não aplicam nada. Dão a aparência
-- de proteção sem proteger.
-- rls_enabled = false E policy_count = 0 significa que os GRANTS (S21a,
-- S21f) são o único controle — não é "sem proteção" nem "com proteção",
-- é outra camada, e precisa ser lida lá.


-- =====================================================================
-- S12 · FUNCTIONS E PROCEDURES  (metadata; corpo e proconfig NÃO saem)
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S12'                               AS section,
    n.nspname                           AS schema_name,
    p.proname                           AS function_name,
    pg_get_function_identity_arguments(p.oid) AS function_signature,
    CASE p.prokind
      WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure'
      WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window'
    END                                 AS routine_kind,
    pg_get_userbyid(p.proowner)         AS function_owner,
    l.lanname                           AS language,
    CASE p.provolatile
      WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' WHEN 'v' THEN 'volatile'
    END                                 AS volatility,
    p.prosecdef                         AS is_security_definer,
    (p.proconfig IS NOT NULL)           AS has_proconfig,
    -- ÚNICO setting extraído, e estritamente derivado: o search_path.
    -- Nenhum outro item de proconfig sai, nem em forma agregada.
    (SELECT cfg FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
      WHERE cfg LIKE 'search\_path=%' LIMIT 1) AS search_path_setting,
    CASE
      WHEN p.prosecdef AND NOT EXISTS (
             SELECT 1
             FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c2
             WHERE c2 LIKE 'search\_path=%')
        THEN 'SECURITY_DEFINER_WITHOUT_PINNED_SEARCH_PATH'
      WHEN p.prosecdef THEN 'SECURITY_DEFINER_WITH_SEARCH_PATH'
      ELSE 'SECURITY_INVOKER'
    END                                 AS security_finding,
    (p.proacl IS NULL)                  AS acl_is_default_public_execute,
    length(p.prosrc)                    AS body_length_chars,
    md5(p.prosrc)                       AS body_md5
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l  ON l.oid = p.prolang
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, p.proname;

ROLLBACK;

-- Nenhuma function é EXECUTADA. Só se lê pg_proc.
-- proconfig NÃO sai como texto: uma function pode carregar settings
-- arbitrários (inclusive definidos pela aplicação) cujo valor pode
-- conter dado ou segredo.
-- body_md5/body_length permitem detectar drift entre ambientes e casar
-- com o SQL versionado sem despejar o corpo no relatório.
-- SECURITY_DEFINER_WITHOUT_PINNED_SEARCH_PATH é achado de segurança:
-- executa com privilégio do owner e resolve nomes por search_path do
-- chamador. Se aparecer, tratar como P0-CANDIDATE.


-- =====================================================================
-- S13 · TRIGGERS  (metadata; nenhum trigger é disparado)
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S13'                               AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS relation_name,
    t.tgname                            AS trigger_name,
    CASE t.tgenabled
      WHEN 'O' THEN 'enabled_origin'  WHEN 'D' THEN 'DISABLED'
      WHEN 'R' THEN 'enabled_replica' WHEN 'A' THEN 'enabled_always'
    END                                 AS enabled_state,
    (t.tgtype::int & 1) = 1             AS is_row_level,
    (t.tgtype::int & 2) = 2             AS fires_before,
    (t.tgtype::int & 64) = 64           AS fires_instead_of,
    (t.tgtype::int & 4) = 4             AS on_insert,
    (t.tgtype::int & 8) = 8             AS on_delete,
    (t.tgtype::int & 16) = 16           AS on_update,
    (t.tgtype::int & 32) = 32           AS on_truncate,
    tn.nspname                          AS function_schema,
    tp.proname                          AS function_name,
    t.tgnargs                           AS trigger_argument_count,
    (t.tgqual IS NOT NULL)              AS has_when_clause
FROM pg_trigger t
JOIN pg_class c      ON c.oid = t.tgrelid
JOIN pg_namespace n  ON n.oid = c.relnamespace
JOIN pg_proc tp      ON tp.oid = t.tgfoid
JOIN pg_namespace tn ON tn.oid = tp.pronamespace
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname, t.tgname;

ROLLBACK;

-- enabled_state = 'DISABLED' é achado: trigger que existe e não roda.
-- Se for o trigger de updated_at ou de auditoria, o dado está silenciosa-
-- mente errado desde que foi desabilitado.
-- O ARGUMENTO do trigger (tgargs) e a cláusula WHEN (tgqual) NÃO são
-- lidos: podem conter literais. Só a contagem e a presença saem.


-- =====================================================================
-- S14 · GRANTS via information_schema  (VISÃO PARCIAL — ver S21)
-- =====================================================================
-- ATENÇÃO: as views information_schema.role_*_grants são INCOMPLETAS
-- para auditoria de exposição. Mostram apenas privilégios cujo grantor
-- ou grantee esteja entre as roles CURRENTLY ENABLED da sessão, e não
-- expõem de forma confiável o que foi concedido a PUBLIC.
-- Ficam aqui como visão cruzada e como pista de discrepância. A base
-- de catálogo está em S21 (CATALOG_ACL_EXPANSION).

-- S14a · grants de tabela/view
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S14a'                              AS section,
    g.table_schema                      AS schema_name,
    g.table_name                        AS relation_name,
    g.grantee                           AS grantee_role,
    g.grantor                           AS grantor_role,
    g.privilege_type                    AS privilege,
    g.is_grantable                      AS is_grantable
FROM information_schema.role_table_grants g
WHERE g.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY g.table_schema, g.table_name, g.grantee, g.privilege_type;

ROLLBACK;

-- S14b · grants de coluna (visão parcial; base de catálogo em S21f)
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S14b'                              AS section,
    g.table_schema                      AS schema_name,
    g.table_name                        AS relation_name,
    g.column_name                       AS column_name,
    g.grantee                           AS grantee_role,
    g.privilege_type                    AS privilege,
    g.is_grantable                      AS is_grantable
FROM information_schema.column_privileges g
WHERE g.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY g.table_schema, g.table_name, g.column_name, g.grantee;

ROLLBACK;

-- S14c · grants de routine
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S14c'                              AS section,
    g.routine_schema                    AS schema_name,
    g.routine_name                      AS routine_name,
    g.grantee                           AS grantee_role,
    g.privilege_type                    AS privilege,
    g.is_grantable                      AS is_grantable
FROM information_schema.role_routine_grants g
WHERE g.routine_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY g.routine_schema, g.routine_name, g.grantee;

ROLLBACK;

-- S14d · grants de USAGE (schemas e sequences)
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S14d'                              AS section,
    g.object_schema                     AS schema_name,
    g.object_name                       AS object_name,
    g.object_type                       AS object_type,
    g.grantee                           AS grantee_role,
    g.privilege_type                    AS privilege
FROM information_schema.role_usage_grants g
WHERE g.object_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY g.object_schema, g.object_type, g.object_name, g.grantee;

ROLLBACK;

-- S14e · roles existentes (identificadas por NOME; nenhum token, nenhuma
--        senha — pg_roles.rolpassword nunca é selecionado, pg_authid
--        nunca é consultado)
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S14e'                              AS section,
    r.rolname                           AS role_name,
    r.rolsuper                          AS is_superuser,
    r.rolinherit                        AS inherits,
    r.rolcreaterole                     AS can_create_role,
    r.rolcreatedb                       AS can_create_db,
    r.rolcanlogin                       AS can_login,
    r.rolreplication                    AS is_replication,
    r.rolbypassrls                      AS bypasses_rls,
    r.rolconnlimit                      AS connection_limit,
    (r.rolvaliduntil IS NOT NULL)       AS has_expiry
FROM pg_roles r
ORDER BY r.rolname;

ROLLBACK;

-- is_superuser e bypasses_rls são os dois bits que anulam toda a análise
-- de RLS para a role em questão. S11b registra FATOS de policy; a
-- conclusão de exposição só é válida cruzando com esta seção.
-- NUNCA selecionar rolpassword, e NUNCA consultar pg_authid.

-- S14f · membership entre roles — herança e SET ROLE
--        ATENÇÃO DE VERSÃO: inherit_option e set_option só existem em
--        pg_auth_members a partir do PostgreSQL 16. Em 15 ou anterior
--        esta consulta falha; registrar BLOCKED com failure_type =
--        SYNTAX_UNSUPPORTED_VERSION e seguir (o server_version_num está
--        em S01). Não substituir por uma versão degradada em silêncio.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S14f'                              AS section,
    parent.rolname                      AS granted_role,
    child.rolname                       AS member_role,
    m.admin_option                      AS with_admin_option,
    m.inherit_option                    AS with_inherit_option,
    m.set_option                        AS with_set_option,
    pg_get_userbyid(m.grantor)          AS grantor_role
FROM pg_auth_members m
JOIN pg_roles parent ON parent.oid = m.roleid
JOIN pg_roles child  ON child.oid = m.member
ORDER BY parent.rolname, child.rolname;

ROLLBACK;

-- POR QUE inherit_option E set_option IMPORTAM:
--   · admin_option  = pode conceder a role a terceiros;
--   · inherit_option = os privilégios da role são exercidos AUTOMATICA-
--     MENTE, sem SET ROLE. É o que decide se um membro "já é" a role;
--   · set_option    = pode fazer SET ROLE para assumi-la deliberadamente.
-- Sem os três, não dá para dizer que privilégio uma role realmente
-- exerce — e é por isso que S21 se chama CATALOG_ACL_EXPANSION e não
-- "effective ACL": privilégio efetivo depende desta seção também.


-- =====================================================================
-- S15 · PUBLICATIONS E REALTIME
-- =====================================================================
-- S15a · publications
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S15a'                              AS section,
    p.pubname                           AS publication_name,
    pg_get_userbyid(p.pubowner)         AS publication_owner,
    p.puballtables                      AS for_all_tables,
    p.pubinsert                         AS replicates_insert,
    p.pubupdate                         AS replicates_update,
    p.pubdelete                         AS replicates_delete,
    p.pubtruncate                       AS replicates_truncate
FROM pg_publication p
ORDER BY p.pubname;

ROLLBACK;

-- Uma publication FOR ALL TABLES envia toda escrita de toda tabela ao
-- consumidor de replicação — incluindo PII. É superfície de exposição
-- tanto quanto uma policy permissiva.

-- S15b · tabelas de cada publication
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S15b'                              AS section,
    pt.pubname                          AS publication_name,
    pt.schemaname                       AS schema_name,
    pt.tablename                        AS relation_name
FROM pg_publication_tables pt
ORDER BY pt.pubname, pt.schemaname, pt.tablename;

ROLLBACK;

-- S15c · subscriptions — SOMENTE metadata não sensível.
-- pg_subscription.subconninfo contém a CONNECTION STRING, com
-- credencial. NÃO é selecionada e não deve ser acrescentada.
-- Costuma exigir superusuário e pode retornar permission denied. Se
-- retornar: ROLLBACK, registrar BLOCKED, abrir nova transação.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S15c'                              AS section,
    s.subname                           AS subscription_name,
    s.subenabled                        AS is_enabled,
    s.subslotname                       AS slot_name,
    (s.subconninfo IS NOT NULL)         AS has_conninfo_not_shown
FROM pg_subscription s
ORDER BY s.subname;

ROLLBACK;

-- REPLICATION_SLOTS não é consultado nesta fase (pg_replication_slots) —
-- registrado como evidence gap deferido, não como ausência.


-- =====================================================================
-- S16 · pg_cron / JOBS AGENDADOS   [GUARDADA]
-- =====================================================================
-- Probe e consulta ficam na MESMA transação. Se o probe retornar NULL,
-- executar o ROLLBACK e registrar SKIPPED_BY_PROBE com
-- probe_result = OBJECT_ABSENT, sem rodar a consulta seguinte.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

-- PROBE
SELECT
    'S16_probe'                         AS section,
    to_regclass('cron.job')             AS cron_job_relation,
    (SELECT extversion FROM pg_extension WHERE extname = 'pg_cron')
                                        AS pg_cron_version;

-- Rodar SOMENTE se o probe acima retornou cron.job não-nulo.
-- O TEXTO DO COMANDO NUNCA SAI — nem mascarado. Um comando agendado
-- pode conter literais, nomes, URLs com token ou credencial embutida.
-- Sai identificação, agendamento, comprimento, hash e uma CLASSE
-- derivada por CASE fechado — o CASE retorna só o rótulo, nunca um
-- fragmento do comando.
SELECT
    'S16'                               AS section,
    j.jobid                             AS job_id,
    j.jobname                           AS job_name,
    j.schedule                          AS schedule,
    j.database                          AS target_database,
    j.username                          AS run_as_role,
    j.active                            AS is_active,
    length(j.command)                   AS command_length_chars,
    md5(j.command)                      AS command_md5,
    CASE
      WHEN j.command ~* 'net\.http_|http_post|http_get' THEN 'HTTP'
      WHEN j.command ~* '^\s*(select|call)\s+[a-z_]+\.[a-z_]+\s*\(' THEN 'FUNCTION'
      WHEN j.command ~* '^\s*(select|insert|update|delete|vacuum|analyze|refresh)\b' THEN 'SQL'
      ELSE 'UNKNOWN'
    END                                 AS command_class
FROM cron.job j
ORDER BY j.jobid;

ROLLBACK;

-- Nenhum job é executado. Só se lê o catálogo do pg_cron.
-- NÃO consultar cron.job_run_details em varredura ampla: o histórico de
-- execução pode conter mensagens de erro com dado embutido.


-- =====================================================================
-- S17 · STORAGE   [GUARDADA]  — buckets; NENHUMA object key
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

-- PROBE
SELECT
    'S17_probe'                         AS section,
    to_regclass('storage.buckets')      AS buckets_relation,
    to_regclass('storage.objects')      AS objects_relation_not_read;

-- Rodar SOMENTE se o probe retornou storage.buckets não-nulo.
SELECT
    'S17'                               AS section,
    b.id                                AS bucket_id,
    b.name                              AS bucket_name,
    b.public                            AS is_public,
    b.file_size_limit                   AS file_size_limit,
    b.allowed_mime_types                AS allowed_mime_types,
    b.created_at                        AS created_at,
    b.updated_at                        AS updated_at
FROM storage.buckets b
ORDER BY b.name;

ROLLBACK;

-- Policies de Storage aparecem em S11 (são policies RLS sobre
-- storage.objects e storage.buckets). Filtrar S11 por
-- schema_name = 'storage'.
--
-- PROIBIDO, e deliberadamente ausente deste pacote:
--   SELECT ... FROM storage.objects      -- object keys = nomes de arquivo,
--                                        -- que podem conter nome de pessoa
--   qualquer geração de signed URL
--   qualquer leitura de conteúdo de arquivo


-- =====================================================================
-- S18 · VAULT   [GUARDADA]  — somente existência e contagem
-- =====================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

-- PROBE
SELECT
    'S18_probe'                         AS section,
    (SELECT extversion FROM pg_extension WHERE extname = 'supabase_vault')
                                        AS vault_extension_version,
    to_regclass('vault.secrets')        AS vault_secrets_relation,
    to_regclass('vault.decrypted_secrets') AS decrypted_view_not_read;

-- Rodar SOMENTE se o probe retornou vault.secrets não-nulo.
-- APENAS CONTAGEM. Nunca a coluna secret, nunca decrypted_secret, nunca
-- a view vault.decrypted_secrets, e — nesta varredura ampla — nem os
-- nomes dos secrets.
SELECT
    'S18'                               AS section,
    COUNT(*)                            AS secret_count,
    COUNT(*) FILTER (WHERE s.name IS NOT NULL) AS named_secret_count
FROM vault.secrets s;

ROLLBACK;

-- Se os NOMES dos secrets forem necessários, isso é REVISÃO DIRIGIDA em
-- etapa separada: o nome de um secret pode, ele próprio, ser sensível.
--
-- TERMINANTEMENTE PROIBIDO, e ausente deste pacote:
--   SELECT * FROM vault.decrypted_secrets
--   qualquer referência à coluna decrypted_secret
--   qualquer chamada a vault.create_secret / vault.update_secret


-- =====================================================================
-- S19 · POSTGREST — settings por role, com WHITELIST estrita
-- =====================================================================
-- A configuração autoritativa do PostgREST no Supabase é do painel
-- (Settings -> API), não do banco. Esta consulta é indício, não fonte
-- autoritativa: cruzar com o painel.
--
-- setconfig NÃO sai inteiro. Cada item é expandido e só quatro nomes de
-- setting são liberados com valor; qualquer outro sai como presença, sem
-- nome e sem valor.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S19'                                  AS section,
    COALESCE(r.rolname, '(database-wide)') AS role_name,
    COALESCE(d.datname, '(all databases)') AS database_name,
    CASE
      WHEN split_part(cfg, '=', 1) IN ('pgrst.db_schemas',
                                       'pgrst.db_extra_search_path',
                                       'pgrst.db_anon_role',
                                       'search_path')
        THEN split_part(cfg, '=', 1)
      ELSE '<REDACTED_SETTING_NAME>'
    END                                    AS setting_name,
    CASE
      WHEN split_part(cfg, '=', 1) IN ('pgrst.db_schemas',
                                       'pgrst.db_extra_search_path',
                                       'pgrst.db_anon_role',
                                       'search_path')
        THEN substr(cfg, length(split_part(cfg, '=', 1)) + 2)
      ELSE 'SETTING_PRESENT_REDACTED'
    END                                    AS setting_value
FROM pg_db_role_setting s
CROSS JOIN LATERAL unnest(s.setconfig) AS cfg
LEFT JOIN pg_roles r    ON r.oid = s.setrole
LEFT JOIN pg_database d ON d.oid = s.setdatabase
ORDER BY role_name, database_name, setting_name;

ROLLBACK;

-- NENHUMA API key é coletada aqui — as chaves do PostgREST não vivem no
-- catálogo do Postgres. Um setting fora da whitelist aparece apenas como
-- SETTING_PRESENT_REDACTED: sabe-se que existe, não o que é.


-- =====================================================================
-- S20a · DEPENDÊNCIAS DE VIEW  (escopo LIMITADO — leia a nota)
-- =====================================================================
-- ESCOPO: percorre pg_depend a partir de pg_rewrite, ou seja, cobre as
-- dependências criadas por REGRAS DE REESCRITA — na prática, views e
-- materialized views sobre as relações que consultam.
--
-- ISTO NÃO É UM GRAFO DE DEPENDÊNCIAS COMPLETO. Não cobre:
--   · foreign keys (mas S05 agora dá a topologia de FK);
--   · trigger -> function (S13 dá o par relação/function);
--   · default -> sequence (S08 dá o ownership);
--   · dependências de tipo, domínio, operador, extensão;
--   · dependências de policy -> function.
-- Ampliar com segurança é trabalho da Fase 1B.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S20a'                              AS section,
    dependent_ns.nspname                AS dependent_schema,
    dependent_obj.relname               AS dependent_object,
    CASE dependent_obj.relkind
      WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview'
      WHEN 'i' THEN 'index' WHEN 'S' THEN 'sequence' WHEN 'p' THEN 'partitioned'
      ELSE dependent_obj.relkind::text
    END                                 AS dependent_kind,
    source_ns.nspname                   AS source_schema,
    source_obj.relname                  AS source_object,
    d.deptype                           AS dependency_type
FROM pg_depend d
JOIN pg_rewrite rw        ON rw.oid = d.objid
JOIN pg_class dependent_obj ON dependent_obj.oid = rw.ev_class
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_obj.relnamespace
JOIN pg_class source_obj  ON source_obj.oid = d.refobjid
JOIN pg_namespace source_ns ON source_ns.oid = source_obj.relnamespace
WHERE d.classid = 'pg_rewrite'::regclass
  AND d.refclassid = 'pg_class'::regclass
  AND dependent_obj.oid <> source_obj.oid
  AND source_ns.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY dependent_ns.nspname, dependent_obj.relname,
         source_ns.nspname, source_obj.relname;

ROLLBACK;


-- =====================================================================
-- S20b · OBJETOS DE APLICAÇÃO SEM EXTENSÃO DONA
-- =====================================================================
-- Candidatos a "criados fora do controle de versão". A reconciliação
-- contra o SQL versionado é feita no PHASE1_LIVE_STATE_TEMPLATE.md.
--
-- obj_description foi REMOVIDO: comentário de objeto é texto livre
-- escrito por humano — pode conter nome, e-mail, ticket, senha colada
-- por engano. Não há substituto seguro em varredura ampla.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S20b'                              AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS object_name,
    CASE c.relkind
      WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'  WHEN 'm' THEN 'materialized_view'
      WHEN 'S' THEN 'sequence'
    END                                 AS object_kind,
    pg_get_userbyid(c.relowner)         AS object_owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND NOT EXISTS (
      SELECT 1 FROM pg_depend dep
      WHERE dep.objid = c.oid
        AND dep.refclassid = 'pg_extension'::regclass
        AND dep.deptype = 'e'
  )
ORDER BY n.nspname, c.relname;

ROLLBACK;


-- =====================================================================
-- S21 · CATALOG_ACL_EXPANSION
-- =====================================================================
-- NOME DELIBERADO. Esta seção NÃO calcula "effective privilege", e não
-- deve ser chamada de effective ACL. O que ela faz é enumerar, a partir
-- do catálogo:
--   · o ACL explícito do objeto;
--   · o acldefault() hard-wired, quando o ACL é NULL;
--   · a entrada PUBLIC (grantee = 0);
--   · a role nomeada de cada entrada.
--
-- O privilégio EFETIVO de uma role depende ainda de:
--   · role membership e herança — S14f (inherit_option, set_option);
--   · atributos de role — S14e (SUPERUSER, BYPASSRLS);
--   · RLS por relação — S11/S11b;
--   · USAGE no schema — S21c (sem ele, o grant de tabela não é
--     exercitável).
-- A derivação final é feita no relatório cruzando essas seções. S14 e
-- S21 são EVIDÊNCIA para essa derivação, não a derivação.
--
-- POR QUE S21 EXISTE, SE S14 JÁ LISTA GRANTS: as views de
-- information_schema filtram por currently enabled roles e não expõem
-- PUBLIC de forma confiável; e quando o ACL é NULL não mostram o padrão
-- que o PostgreSQL aplica — sendo que o padrão de uma function é EXECUTE
-- para PUBLIC.
--
-- Nenhuma senha é lida em nenhuma destas consultas.

-- S21a · ACL de tabelas, views e materialized views
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S21a'                              AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS relation_name,
    CASE c.relkind
      WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'  WHEN 'm' THEN 'materialized_view'
      WHEN 'f' THEN 'foreign_table'
    END                                 AS object_kind,
    pg_get_userbyid(c.relowner)         AS object_owner,
    (c.relacl IS NULL)                  AS acl_is_default,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
         ELSE pg_get_userbyid(acl.grantee) END AS grantee_role,
    (acl.grantee = 0)                   AS is_public,
    acl.privilege_type                  AS privilege,
    acl.is_grantable                    AS is_grantable,
    pg_get_userbyid(acl.grantor)        AS grantor_role
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(
    COALESCE(c.relacl, acldefault('r', c.relowner))
) AS acl
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_toast%'
ORDER BY n.nspname, c.relname, is_public DESC, grantee_role, privilege;

ROLLBACK;

-- ACHADO A DERIVAR: PUBLIC_TABLE_PRIVILEGES = linhas com is_public.
-- Privilégio a PUBLIC numa tabela de participante é P0-CANDIDATE. Ler
-- junto com S11b (RLS pode estar off, inerte ou não-forced) e S14e
-- (BYPASSRLS/superuser).

-- S21b · ACL de sequences
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S21b'                              AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS sequence_name,
    pg_get_userbyid(c.relowner)         AS object_owner,
    (c.relacl IS NULL)                  AS acl_is_default,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
         ELSE pg_get_userbyid(acl.grantee) END AS grantee_role,
    (acl.grantee = 0)                   AS is_public,
    acl.privilege_type                  AS privilege,
    acl.is_grantable                    AS is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(
    COALESCE(c.relacl, acldefault('s', c.relowner))
) AS acl
WHERE c.relkind = 'S'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname, is_public DESC, grantee_role, privilege;

ROLLBACK;

-- S21c · ACL de schemas
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S21c'                              AS section,
    n.nspname                           AS schema_name,
    pg_get_userbyid(n.nspowner)         AS object_owner,
    (n.nspacl IS NULL)                  AS acl_is_default,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
         ELSE pg_get_userbyid(acl.grantee) END AS grantee_role,
    (acl.grantee = 0)                   AS is_public,
    acl.privilege_type                  AS privilege,
    acl.is_grantable                    AS is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(
    COALESCE(n.nspacl, acldefault('n', n.nspowner))
) AS acl
WHERE n.nspname NOT LIKE 'pg\_toast%'
  AND n.nspname NOT LIKE 'pg\_temp%'
ORDER BY n.nspname, is_public DESC, grantee_role, privilege;

ROLLBACK;

-- ACHADO A DERIVAR: PUBLIC_SCHEMA_USAGE = is_public e privilege='USAGE'.
-- USAGE em schema é a porta: sem ela um grant de tabela não é
-- exercitável; com ela, é.

-- S21d · ACL de functions e procedures
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S21d'                              AS section,
    n.nspname                           AS schema_name,
    p.proname                           AS function_name,
    pg_get_function_identity_arguments(p.oid) AS function_signature,
    p.prosecdef                         AS is_security_definer,
    pg_get_userbyid(p.proowner)         AS object_owner,
    (p.proacl IS NULL)                  AS acl_is_default,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
         ELSE pg_get_userbyid(acl.grantee) END AS grantee_role,
    (acl.grantee = 0)                   AS is_public,
    acl.privilege_type                  AS privilege,
    acl.is_grantable                    AS is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(
    COALESCE(p.proacl, acldefault('f', p.proowner))
) AS acl
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, p.proname, is_public DESC, grantee_role, privilege;

ROLLBACK;

-- ACHADO A DERIVAR: PUBLIC_FUNCTION_EXECUTE = is_public e
-- privilege='EXECUTE'. Combinado com is_security_definer = true, é o
-- achado de maior severidade que esta coleta pode produzir.

-- S21e · DEFAULT PRIVILEGES (o que será aplicado a objetos FUTUROS)
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S21e'                              AS section,
    pg_get_userbyid(da.defaclrole)      AS applies_when_created_by_role,
    COALESCE(n.nspname, '(all schemas)') AS target_schema,
    CASE da.defaclobjtype
      WHEN 'r' THEN 'table'    WHEN 'S' THEN 'sequence'
      WHEN 'f' THEN 'function' WHEN 'T' THEN 'type'
      WHEN 'n' THEN 'schema'
      ELSE da.defaclobjtype::text
    END                                 AS target_object_type,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
         ELSE pg_get_userbyid(acl.grantee) END AS grantee_role,
    (acl.grantee = 0)                   AS is_public,
    acl.privilege_type                  AS privilege,
    acl.is_grantable                    AS is_grantable
FROM pg_default_acl da
LEFT JOIN pg_namespace n ON n.oid = da.defaclnamespace
CROSS JOIN LATERAL aclexplode(da.defaclacl) AS acl
ORDER BY applies_when_created_by_role, target_schema,
         target_object_type, is_public DESC, grantee_role;

ROLLBACK;

-- ACHADO A DERIVAR: DEFAULT_PRIVILEGES. Explica por que um objeto criado
-- AMANHÃ já nasce exposto. Um ALTER DEFAULT PRIVILEGES ... TO PUBLIC não
-- aparece em nenhuma outra seção.

-- S21f · COLUMN ACL
-- Grant de coluna é mais específico que o de tabela e passa despercebido
-- com facilidade: uma tabela pode não ter grant nenhum e ainda assim ter
-- uma COLUNA exposta. attacl só é expandido quando NÃO é NULL — não há
-- acldefault de coluna a aplicar (uma coluna sem ACL próprio herda o
-- comportamento da tabela, já coberto por S21a).
-- Saem NOMES de coluna. NENHUM VALOR de coluna é lido: esta consulta
-- toca apenas pg_attribute, nunca a tabela.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;

SELECT
    'S21f'                              AS section,
    n.nspname                           AS schema_name,
    c.relname                           AS relation_name,
    a.attname                           AS column_name,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
         ELSE pg_get_userbyid(acl.grantee) END AS grantee_role,
    (acl.grantee = 0)                   AS is_public,
    acl.privilege_type                  AS privilege,
    acl.is_grantable                    AS is_grantable
FROM pg_attribute a
JOIN pg_class c      ON c.oid = a.attrelid
JOIN pg_namespace n  ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
WHERE a.attacl IS NOT NULL
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_toast%'
ORDER BY n.nspname, c.relname, a.attnum, is_public DESC, grantee_role;

ROLLBACK;

-- Resultado VAZIO aqui significa "nenhum ACL de coluna explícito", e
-- isso é um resultado — não uma seção que deixou de rodar. A distinção
-- fica registrada em section_results (COLLECTED com row_count 0).


-- =====================================================================
-- FIM DO PACOTE — 37 seções (PREFLIGHT + 36)
-- =====================================================================
-- Não há bloco de encerramento global: cada seção já encerrou a sua
-- própria transação com ROLLBACK. Se alguma sessão ficou aberta por
-- interrupção manual, executar ROLLBACK antes de desconectar.
--
-- COMMIT não aparece neste arquivo e não deve ser introduzido.
--
-- NÃO COLETADO NESTA FASE — registrado como evidence gap deferido, e não
-- como ausência (ver PHASE1_EXECUTION_RUNBOOK.md §4.16):
--   · EVENT_TRIGGERS          (pg_event_trigger) — coletável no futuro
--                              sem corpo de function
--   · FDW_SERVER_METADATA     (pg_foreign_server, pg_user_mapping) — as
--                              options PODEM CONTER CREDENCIAL; não
--                              incluir em varredura ampla
--   · DATABASE_LEVEL_ACL      (pg_database.datacl)
--   · TYPE_DOMAIN_PRIVILEGES  (pg_type.typacl)
--   · REPLICATION_SLOTS       (pg_replication_slots)
--
-- Antes de executar: os QUATRO artefatos PHASE1_* precisam estar
-- tracked, commitados e com `git status --porcelain` limpo. Registrar os
-- hashes dos quatro em phase1_package_manifest_sha256, e reconferir o
-- hash deste arquivo DEPOIS da execução
-- (query_pack_sha256_verified_after = true, obrigatório).
-- =====================================================================
