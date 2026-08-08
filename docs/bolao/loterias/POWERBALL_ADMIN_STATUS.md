# Powerball — status real do admin (LEIA ANTES DOS OUTROS DOCUMENTOS DESTA PASTA)

**Atualizado:** 2026-08-08 · **Reconciliação da branch `powerball-admin-supabase-audit`**

## O que existe HOJE em produção

**Não existe painel administrativo de Powerball.** Não há rota `admin`, não há autenticação, não há
Supabase ligado ao runtime do Powerball. A persistência operacional continua sendo
`bolao/loterias/powerball/js/data.js` (participantes, sorteios, cotas), editada por commit, mais o
pipeline de email por script.

Os documentos `POWERBALL_ADMIN_*.md` desta pasta descrevem um **projeto**, não o sistema em
produção. Eles foram escritos junto com uma implementação que ficou fora da `main` de propósito
(veja abaixo). Nenhuma tabela, RLS, RPC ou tela descrita neles existe no banco ou no site.

## Por que a implementação não entrou na `main`

A branch `powerball-admin-supabase-audit` entrega um sistema administrativo completo: 13 tabelas,
~17 RPCs `security definer`, RLS deny-by-default, log de auditoria append-only com cadeia de hash,
uma SPA de administração e uma ferramenta de importação do `data.js`. Isso é **modernização
estrutural de banco de dados** do domínio Powerball — exatamente a categoria que o programa de
encerramento não integra, e que pertence ao programa `db-modernization-architecture` (o mesmo que
responde pelo HA-1).

Três motivos concretos, além da classificação:

1. **Nada disso jamais rodou contra um Postgres real.** É o próprio
   `POWERBALL_ADMIN_AUDIT.md` que registra isso com honestidade: o ambiente não tinha Docker, então
   a cadeia de hash, o gatilho append-only e `verify_powerball_audit_chain()` nunca foram
   executados. Os testes correspondentes reportam `SKIPPED (NÃO EXECUTADO)` com exit 2 — corretos
   por recusarem passar em falso, mas ainda assim sem evidência de execução.
2. **A SPA seria publicada.** O site é GitHub Pages: qualquer coisa em
   `bolao/loterias/powerball/admin/` vira URL pública. Publicar uma tela de administração cujo
   schema não existe e cuja RLS nunca foi testada é aumentar superfície sem defesa comprovada.
3. **O dinheiro é real.** Cada entrada do bolão movimenta pagamento de verdade. Trocar a
   persistência operacional é uma mudança de risco alto que precisa de banco provado e autorização
   explícita do Eduardo — não de uma integração de encerramento.

## Disposição por item (reconciliação)

| Item | Disposição |
|---|---|
| `migrations/001_schema.sql`, `002_rls.sql`, `003_rpcs.sql`, `004_rpcs_*.sql`, `scripts/bootstrap_owner_role.sql` | `DB_MODERNIZATION_ONLY` — permanece na branch |
| SPA `bolao/loterias/powerball/admin/**` | `DB_DEPENDENT` — permanece na branch (publicaria rota administrativa sem backend provado) |
| `scripts/powerball/import_data_to_supabase.mjs` | `DB_DEPENDENT` — permanece na branch |
| `tests/rls_negative_test.mjs`, `tests/audit_chain_test.mjs` | `DB_DEPENDENT` — só rodam contra Postgres vivo |
| `tests/no_localstorage_test.mjs`, `tests/sessionstorage_scope_test.mjs` | `DB_DEPENDENT` por assunto — verificam a SPA que não está na `main` |
| 10 documentos `POWERBALL_ADMIN_*` / `POWERBALL_DATA_MIGRATION_PLAN` | **SURVIVING — integrados** (este commit) |
| `scripts/lib/email_outbox.mjs` / `email_pipeline.mjs` / `email_worker.mjs` + teste (branch `powerball-professionalization-audit`) | `SUPERSEDED` — a `main` roda a implementação compartilhada `bolao/shared/scripts/notification_{outbox,worker,pipeline}.mjs`, que já tem o mesmo teto de retentativa (`maxAttempts`, `notification_outbox.mjs:96`) coberto por `npm run test:notifications`. Integrar a segunda implementação recriaria exatamente a divergência que o programa vem eliminando. |
| Correção de privacidade `54425a1` (parar de citar transaction IDs reais num documento) | **JÁ SATISFEITA** — o `js/data.js` atual da `main` não tem mais campo `txId` nenhum (verificado 2026-08-08), e o documento entra aqui já corrigido |
| 9 documentos + 5 previews de email da branch `powerball-professionalization-audit` | **SURVIVING — integrados** (este commit) |
| Branch `powerball-tab-header-consistency` | `DRAINED` — o título da aba na `main` já é idêntico ao da branch |

## Verificação de privacidade feita nesta reconciliação (2026-08-08)

- `scripts/email/outbox.json` na `main`: 2 endereços distintos — o do próprio organizador e um
  fixture `@example.invalid`. Nenhum email de terceiro.
- `js/data.js` na `main`: **zero** endereços de email e **zero** campos de transaction ID. Os dados
  públicos trazem nome, método de pagamento e horário; as referências de pagamento continuam apenas
  no secret privado, conforme a governança de `txId`.
- Todos os 19 documentos e 5 previews integrados aqui: nenhum email de terceiro, nenhum transaction
  ID, nenhum serial de bilhete.

## O que seria preciso para o admin entrar de verdade

Não é trabalho de encerramento; é o programa de banco. Na ordem: subir um Postgres/Supabase de teste
e executar as migrations de verdade; rodar `rls_negative_test.mjs` e `audit_chain_test.mjs` contra
ele até passarem sem SKIP; revisar RLS com o HA-1 resolvido (hoje a anon key lê PII de participante
no `bolao_state`); e só então decidir, com o Eduardo, se a persistência operacional do Powerball
migra do `data.js`. Enquanto isso, os documentos desta pasta valem como projeto e evidência — não
como descrição do que está no ar.
