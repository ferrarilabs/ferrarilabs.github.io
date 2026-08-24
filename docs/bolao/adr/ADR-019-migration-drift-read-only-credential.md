# ADR-019 — Credencial somente-leitura para detecção de deriva de migração

**Status: SUPERSEDIDO pelo [ADR-020](ADR-020-migration-drift-management-api.md) (2026-08-24).**

Nada aqui foi executado. A DDL abaixo **não deve ser aplicada** — ela existe como registro do
caminho que foi considerado e descartado, e de por quê.

O ADR-020 obtém a mesma observação pela Management API do Supabase, com um token de granularidade
fina restrito a `database_migrations_read`: sem DDL em produção, sem expor `supabase_migrations`
como schema de API, sem papel novo para manter, e com alcance **menor** que o papel proposto aqui.
**Data:** 2026-08-23 · **Issue:** #310-B · **Causa raiz relacionada:** #306

## Contexto

A #306 aconteceu porque uma migração existia em `supabase/migrations/` e produção nunca a aplicou.
O pipeline abortava a cada push, o check que falhava era externo (não reprova nada no repositório),
e a divergência ficou horas invisível.

O detector `migration_drift` compara as duas listas. Ler o disco é trivial; ler
`supabase_migrations.schema_migrations` **não é público** e exige credencial.

## A tentação a recusar

O caminho de menor esforço é usar a `service_role` que já existe como secret. Isso fecharia a Issue
hoje e trocaria um problema de **observabilidade** por um de **superfície de credencial**: a
`service_role` ignora RLS e pode ler e escrever **todas** as tabelas — incluindo participantes,
pagamentos e o razão financeiro. Dar isso a um cron de observabilidade que só precisa de uma lista
de números de versão é desproporcional, e é o tipo de decisão que ninguém revisita depois.

A senha do banco tem o mesmo problema, e pior: é reutilizável fora do CI.

## Decisão proposta

Um papel PostgreSQL dedicado, com `SELECT` **apenas** em `supabase_migrations.schema_migrations`,
exposto via PostgREST, com a chave guardada como `SENTINEL_MIGRATION_READ_KEY`.

### DDL exata (NÃO EXECUTADA)

```sql
-- 1. Papel sem login proprio, usado so como identidade do PostgREST.
create role sentinel_migration_reader nologin;

-- 2. O MINIMO: enxergar o schema e ler UMA tabela. Nada de USAGE em public.
grant usage  on schema supabase_migrations to sentinel_migration_reader;
grant select on supabase_migrations.schema_migrations to sentinel_migration_reader;

-- 3. Garantia explicita de que nada mais foi herdado.
revoke all on all tables    in schema public              from sentinel_migration_reader;
revoke all on all functions in schema public              from sentinel_migration_reader;
revoke all on all sequences in schema public              from sentinel_migration_reader;

-- 4. E que nada futuro sera herdado por default.
alter default privileges in schema public
  revoke all on tables from sentinel_migration_reader;

-- 5. O papel precisa ser assumivel pelo autenticador do PostgREST.
grant sentinel_migration_reader to authenticator;
```

Depois: emitir uma chave JWT com `role = sentinel_migration_reader`, e expor o schema
`supabase_migrations` em `db-schemas` **somente para leitura**.

### Verificação após criação (somente leitura)

```sql
-- Deve devolver exatamente uma linha: a tabela de migracoes.
select table_schema, table_name, privilege_type
  from information_schema.table_privileges
 where grantee = 'sentinel_migration_reader';
```

## Consequências

**A favor:** o detector passa de `UNKNOWN` a medir de verdade; a credencial não alcança nenhum dado
de participante, pagamento ou scoring; vazá-la expõe uma lista de timestamps de migração.

**Contra:** expor `supabase_migrations` no PostgREST aumenta a superfície da API, ainda que apenas
para um papel dedicado. Exige DDL em produção — operação `RED`, autorização separada.

## Alternativas descartadas

| alternativa | por que não |
|---|---|
| `service_role` existente | lê e escreve tudo, inclusive o razão financeiro. Desproporcional. |
| senha do banco | mesmo alcance, e reutilizável fora do CI. |
| expor a tabela ao `anon` | tornaria a lista pública para qualquer visitante. |
| snapshot commitado das versões aplicadas | envelhece em silêncio; detectaria a deriva só depois de alguém atualizar o snapshot — exatamente a dependência humana que a #310 existe para remover. |

## Enquanto não existir

O detector devolve `UNKNOWN`: **nenhum finding** (não dá para afirmar deriva) e **nenhuma
confirmação de recuperação** (não dá para afirmar saúde). As duas afirmações exigem ter medido.

**A Issue #310 permanece ABERTA.** Fechá-la com a parte B em `UNKNOWN` permanente seria repetir o
falso-verde que a reabriu.
