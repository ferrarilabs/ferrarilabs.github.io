# ADR-020 — Deriva de migração via Management API, com token de granularidade fina

**Status:** ACEITO (2026-08-24) · **Supersede:** ADR-019 · **Issue:** #310-B · **Causa raiz:** #306

## Contexto

O detector `migration_drift` precisa saber quais migrações produção realmente aplicou. Ler o disco é
trivial; ler o estado aplicado não é público.

O ADR-019 propunha expor `supabase_migrations` como schema do PostgREST e criar um papel dedicado
com `SELECT` numa tabela. Funcionaria, e custava caro: DDL em produção, um schema interno virando
superfície de API, e mais um papel para manter.

## O que mudou

O Supabase expõe hoje, na Management API:

    GET https://api.supabase.com/v1/projects/{ref}/database/migrations

**Verificado nesta rodada**: a rota responde **401** sem credencial — existe e exige autenticação.
Uma rota inexistente responderia 404.

A credencial pode ser um **token de granularidade fina** restrito a `database_migrations_read`
(escopo de leitura `database:read`).

## Decisão

Usar a Management API. O ADR-019 fica registrado como caminho descartado.

| | ADR-019 (PostgREST) | ADR-020 (Management API) |
|---|---|---|
| DDL em produção | `CREATE ROLE` + `GRANT` + `REVOKE` | **nenhuma** |
| Superfície de API | expõe `supabase_migrations` | **nenhuma mudança** |
| Objeto novo para manter | papel `sentinel_migration_reader` | **nenhum** |
| Alcance da credencial | `SELECT` numa tabela do banco | **só a lista de migrações** |
| Onde vive o segredo | chave JWT do papel | secret do Actions |

## O que o token NÃO pode ser

`service_role`, secret key do Supabase, senha do banco/`postgres`, `anon`, ou credencial de usuário
autenticado. Qualquer um deles alcança dados de participante, pagamento e o razão financeiro — para
uma tarefa que só precisa de uma lista de timestamps. Um teste falha se o módulo passar a referenciar
qualquer um desses nomes.

## Redução na porta de entrada

A rota devolve o **SQL** de cada migração. O detector precisa apenas de `version`, e a resposta é
reduzida a isso imediatamente. Statements de schema nunca circulam pelo Sentinel, nunca entram num
finding e nunca aparecem num log de Actions. Há teste para isso.

## Falhar para UNKNOWN, sempre

`401`, `403`, `429` após tentativas limitadas, erro de rede e corpo malformado ⇒ **`UNKNOWN`**.

O caso que mais importa é `401`/`403`: um token errado ou sem escopo devolve uma resposta
**perfeitamente bem formada** que não contém migração nenhuma. Tratá-la como lista vazia diria
"produção não aplicou nada" e abriria alarme de deriva sobre **todas** as migrações de uma vez — um
falso positivo espetacular nascido de zero informação. `UNKNOWN` também **não** conta como ciclo
limpo: não medir não é sinal de saúde.

Só `429` merece nova tentativa; as demais não melhoram repetindo.

## Provisionamento (ação do dono)

Dashboard → Account → Access Tokens → *Generate new token*, granularidade fina, **apenas**
`database_migrations_read`; escopo do projeto `cmhqkkfczotdnssupkni`. Guardar como secret do Actions
`SENTINEL_SUPABASE_MGMT_TOKEN`.

Não foi criado por agente: emitir token de gestão exige o Dashboard, e substituir por um token amplo
"para destravar" trocaria um problema de observabilidade por um de superfície de credencial.

## Consequências

Enquanto o secret não existir, o detector opera em `UNKNOWN` e **#310 permanece aberta** — fechá-la
com a parte B em `UNKNOWN` permanente repetiria o falso-verde que a reabriu.
