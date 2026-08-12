# ADR-006 — `supabase/migrations/` as the single database source of truth

**Status:** Aceito (ratificado pelo operador como decisão A3, 2026-08-07).
**Data:** 2026-08-07/08. **Aplica-se a:** todo o banco de dados de produção.

## Contexto
O ledger de produção (`supabase_migrations.schema_migrations`) contém **uma** linha
(`20260806143644 add_minimal_powerball_schema`). O repositório declara **seis** arquivos de migration
(`001..004`, `supabase_setup.sql` ×2) e **nenhum** deles corresponde a essa linha. Além disso
`public.bolao_state` — a tabela que os três apps realmente usam — não tem DDL versionado em lugar
algum, e o event trigger `ensure_rls` (que liga RLS automaticamente em toda tabela nova) também não.
Consequência: **o repositório não consegue reproduzir a produção.** Ver `DATABASE_RECONCILIATION.md`
R-01, R-03, R-07, R-08.

## Decisão
`supabase/migrations/`, no repositório canônico, passa a ser a **única** fonte de verdade para
evolução do banco. Nomes seguem a convenção do Supabase CLI (`<utc_timestamp>_<descrição>.sql`). O SQL
legado permanece temporariamente como **referência forense** com banner explícito, e nunca como fonte
concorrente.

## Consequências
- Positivas: reprodutibilidade, detecção de drift, CI/CD possível, história auditável.
- Negativas: exige o Supabase CLI (hoje **não instalado**); obriga a resolver a sobreposição entre o
  baseline e a migration já aplicada.
- O baseline capturado **não é executável como commitado** — três literais de policy não entram no Git
  (ver ADR-007).

## Alternativas rejeitadas
- **Manter o SQL legado como fonte:** declara 7 tabelas que a produção não tem e 5 que não existem em
  lugar nenhum. Ativamente enganoso.
- **Insert manual no ledger:** transformaria uma lacuna honesta (provenance ausente) em registro
  desonesto (provenance fabricada). Ver `T3_LEDGER_ADOPTION_ANALYSIS.md`.

## Estado
T1 (criar o diretório) e T2 (baseline) **concluídos**. T3 (registrar no ledger) **não autorizado** —
requer `supabase db pull`, que requer o CLI. R-03 = `MATERIALLY_ADVANCED`.
