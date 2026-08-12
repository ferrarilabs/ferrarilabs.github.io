# FASE 0 — Evidências que faltam

Tudo neste diretório vem do repositório. **Nada prova o estado do banco.**
Este documento lista o que só o Supabase responde, e como coletar sem risco.

## Método — correção registrada

> **A redação anterior deste documento estava errada e foi retirada.** Ela propunha
> usar a publishable/anon key como primeiro passo de descoberta de catálogo,
> classificando Q3, Q4, Q5, Q10, Q11 e Q12 como "alcançáveis com a chave anon".
> Essa classificação não se sustenta.

```
PUBLISHABLE_KEY_CATALOG_DISCOVERY = INSUFFICIENT
```

### Por que a publishable key não serve para inventário

1. **Está sujeita a RLS.** Ela responde como a role `anon`. O que ela enxerga é o
   que as policies permitem à `anon` enxergar — não o que existe.
2. **Não prova que uma tabela está vazia.** Zero linhas retornadas é indistinguível
   de "a tabela tem linhas e nenhuma policy as expõe à `anon`".
3. **Não prova que uma tabela não existe.** Um `404` do PostgREST cobre pelo menos
   três casos distintos: tabela ausente, tabela ausente do schema exposto, e tabela
   presente sem grant para `anon`. A ausência de resposta não é evidência de
   ausência de objeto.
4. **Não fornece inventário PostgreSQL.** O PostgREST expõe um schema de API, não o
   catálogo. Não dá acesso a `information_schema` nem a `pg_catalog`.
5. **Não é fonte adequada para** constraints, triggers, policies, grants, roles,
   índices, functions, sequences, tipos/enums, views materializadas, dependências
   internas, ou qualquer objeto que não seja uma relação exposta e legível por `anon`.

Consequência: nenhuma pergunta deste documento pode ser respondida pela chave anon.
Todas passam a exigir fonte administrativa.

---

## Estrutura da Fase 1 (a executar somente sob autorização própria)

### A · Inspeção read-only por fonte administrativa apropriada

Fontes aceitáveis, em ordem de preferência:

- catálogo PostgreSQL (`information_schema`, `pg_catalog`, `pg_policies`,
  `pg_proc`, `pg_trigger`, `pg_indexes`, `pg_class`, `pg_roles`);
- Supabase dashboard (Database, Authentication → Policies, Backups, Settings);
- APIs administrativas de metadata do Supabase;
- conexão read-only controlada, **apenas quando explicitamente autorizada**, com
  role sem privilégio de escrita.

Restrições que permanecem em vigor em qualquer das fontes: nenhum DDL, nenhum DML,
nenhuma escrita, nenhum teste destrutivo. A capacidade de `DELETE` em
`bolao_state` é determinada **lendo a policy**, nunca executando a operação.

#### A.1 · Inventário read-only obrigatório

O inventário de catálogo desta fase não se limita a tabelas. Escopo completo:

**Estrutura**
- todos os schemas de aplicação (não só `public`);
- tables · views · materialized views;
- sequences · types/enums · extensions;
- constraints e indexes;
- dependências entre objetos, e objetos sem contrapartida versionada.

**Segurança em nível de relação**
- `relrowsecurity` (RLS habilitada?);
- `relforcerowsecurity` (aplicada também ao owner?);
- `pg_policies` — policy a policy, com role, comando e expressão;
- grants de table, sequence e function.

`relrowsecurity` e `relforcerowsecurity` são bits distintos: RLS habilitada mas não
forçada não se aplica ao owner da tabela. Ler só o primeiro produz conclusão errada.

**Código no banco**
- functions e procedures;
- `security_definer` por função — uma função `SECURITY DEFINER` executa com o
  privilégio do owner e é a via clássica de escalada;
- owner de cada função;
- grants de execução por função;
- `search_path` por função — `search_path` mutável numa `SECURITY DEFINER` é
  vulnerabilidade, não estilo;
- triggers.

**Superfície e automação**
- publications e Realtime;
- `pg_cron` / jobs agendados;
- Storage buckets **e suas policies**;
- Edge Functions e respectiva metadata;
- Database Webhooks;
- Vault/secrets — **somente nomes e existência**;
- schemas expostos via PostgREST.

**Nunca extrair, em nenhuma etapa:** dados de participante, e-mails, txIds, valores de
secrets, connection strings, passwords. O inventário coleta **metadata e definição de
objeto**, não conteúdo. Contagem de linhas é aceitável; leitura de linhas não é.

### B · Reconciliação

Confrontar cinco fontes, item a item:

| Fonte | Papel |
|---|---|
| catálogo real | a verdade — **única** fonte que atribui `PRODUCTION_STATE` |
| SQL versionado (`bolao/loterias/powerball/scripts/supabase_setup.sql`) | o que se pretendeu criar |
| documentação (`*_SETUP_SUPABASE.md`, `AUDIT_LOGGING.md`) | o que se afirma existir |
| frontend estático (`bolao/*/js/data.js`, `localStorage`) | o que o produto realmente usa |
| branches não mergeadas (`lottery_*`, `bolao_notification_*`) | o que foi proposto |

Cada objeto do catálogo recebe um par `REPOSITORY_STATE` / `PRODUCTION_STATE` (ver
`PHASE0_INVENTORY.md` §"Taxonomia"). Cada objeto versionado ou documentado que **não**
aparecer no catálogo é registrado como `PROD: CONFIRMED_ABSENT` — essa ausência é um
achado, não uma omissão. Cada objeto que aparecer no catálogo e **não** existir no
repositório é o achado mais grave possível: objeto fora do controle de versão.

**Sexta fonte, de status inferior:** relatos de sessões ou operações anteriores —
notadamente o registrado em `PHASE0_INVENTORY.md` §19.3 sobre criação de tabelas
`lottery_*`. Entram na reconciliação apenas como **hipótese a testar**
(`REQUIRES_PHASE1_RECONFIRMATION`), nunca como linha de evidência, e
`DO_NOT_USE_AS_SUBSTITUTE_FOR_CATALOG_INSPECTION`.

### C · Resíduo manual

O que não puder ser coletado por A: confirmação humana pelo Eduardo, com
screenshots ou exportações **sanitizadas** (sem PII, sem chaves, sem connection
string). Cada item do resíduo é registrado com data e origem.

**Nenhuma credencial é fornecida por este documento, e nenhuma deve ser colada no
chat** — nem service_role, nem database password, nem connection string.

---

## As perguntas — todas exigem fonte administrativa

| # | Pergunta | Fonte (A) | Resolve |
|---|---|---|---|
| Q1 | Quais tabelas existem em `public`? | `information_schema.tables` / Database → Tables | Base de toda a reconciliação |
| Q2 | `bolao_state` existe? Quantas linhas, quais `id`s, qual `updated_at`? | catálogo + SQL Editor | Modelo 1: `PROD: UNVERIFIED` → `CONFIRMED_PRESENT` (+ `ROWS_PRESENT`) ou `CONFIRMED_ABSENT`. **Não** produz `CONFIRMED_IN_USE` — `updated_at` recente é indício a correlacionar, não prova de uso |
| Q3 | Os objetos de `bolao/loterias/powerball/scripts/supabase_setup.sql` foram aplicados? Têm linhas? | catálogo + contagem | Modelo 2: `CONFIRMED_PRESENT` (+ `ROWS_PRESENT`), `PRESENT_USAGE_UNKNOWN` ou `CONFIRMED_ABSENT`. Linhas antigas de uma importação abandonada têm exatamente a mesma aparência de um sistema vivo |
| Q4 | Alguma tabela `powerball_*` existe? | catálogo | Atribui `PRODUCTION_STATE` ao modelo 3 |
| Q5 | Alguma tabela `lottery_*` existe? Quantas, e quais? | catálogo | Atribui `PRODUCTION_STATE` ao modelo 4 — e é onde o relato externo anterior (§19.3) é confirmado ou descartado. **A pergunta é aberta: quais existem?** — não "as seis do relato existem?" |
| Q6 | Quais policies RLS estão ativas, em quais tabelas, para quais roles? | `pg_policies` / Authentication → Policies | D-01, D-02 — hoje baseadas em policy **documentada**, não observada; decide a promoção de `P0-CANDIDATE` a P0 |
| Q7 | Existem functions, triggers ou views não versionados? | `pg_proc`, `pg_trigger`, `pg_views` | Objetos fora do controle de versão |
| Q8 | PITR / backup gerenciado habilitado? Retenção? Plano do projeto? | Database → Backups; Settings → Billing | Gate G1 |
| Q9 | A role `anon` tem `DELETE` em `bolao_state` — grant **e** policy? | leitura de `pg_policies` e de `information_schema.role_table_grants` — **jamais executar a operação** | D-02: decide se o `DELETE` que o cliente emite é de fato autorizado pelo servidor |
| Q10 | `audit_log` / `email_log` têm dados reais? | contagem via catálogo; **não extrair valores** | PII em produção a proteger |
| Q11 | Quais grants existem para `anon` e `authenticated`? | `information_schema.role_table_grants` | Complementa Q6 — grant e policy são camadas distintas |
| Q12 | Quais schemas estão expostos via PostgREST? | Settings → API | Superfície de exposição real |
| Q13 | Existem outros projetos Supabase além de `<KNOWN_PROJECT_REF>` (o ref referenciado pelo código versionado)? | lista de projetos | Escopo da modernização |
| Q14 | Há usuários no Supabase Auth? | Authentication → Users | Esperado zero; decidiria DEC-03 e a viabilidade do modelo 3 |
| Q15 | Tamanho atual de cada linha de `bolao_state` vs. o teto de 1 MB? | SQL Editor: `pg_column_size` | Risco operacional imediato, independente da modernização |
| Q16 | Quais índices, constraints e chaves estrangeiras existem de fato? | `pg_indexes`, `information_schema.table_constraints` | Integridade real vs. pretendida |

Q15 permanece prioritária: o `check (pg_column_size(state) < 1048576)` é um teto
rígido. Se alguma linha estiver próxima dele, há risco de falha de gravação em
produção hoje, antes de qualquer modernização.

---

## O que permanece sem resposta mesmo após a Fase 1

- Se houve acesso não autorizado no passado (não há log de acesso a consultar).
- O conteúdo histórico dos backups gitignored em `bolao/*/backups/`.
- Se algum backup existente é restaurável — isso é a Fase 3, não a Fase 1.
- Se a PII removida em `1b09afa` foi indexada por terceiros antes da remoção.

---

## Critério de saída da Fase 1

Cada objeto hoje classificado como `PROD: UNVERIFIED` em `PHASE0_INVENTORY.md` deve
receber um `PRODUCTION_STATE` definitivo — `CONFIRMED_PRESENT` (com `ROWS_PRESENT`
quando aplicável), `CONFIRMED_ABSENT` ou `PRESENT_USAGE_UNKNOWN` — com a evidência
anexada: saída de catálogo ou exportação/print do painel, sempre sanitizada e sem PII.

**`CONFIRMED_IN_USE` não é um resultado esperado da Fase 1.** A Fase 1 inspeciona
catálogo; catálogo prova presença e contagem, nunca uso. Promover um objeto a
`CONFIRMED_IN_USE` exige evidência operacional (app live, escrita correlacionada a
evento conhecido, workflow/Edge Function, telemetria, ou confirmação humana apoiada
por evidência) — ver a regra em `PHASE0_INVENTORY.md`. Sair da Fase 1 com muitos
objetos em `PRESENT_USAGE_UNKNOWN` é o resultado correto, não uma falha da fase.

O
`REPOSITORY_STATE` não muda por causa disso: são eixos independentes, e um objeto pode
perfeitamente terminar `REPO: BRANCH_ONLY · PROD: CONFIRMED_PRESENT` — que seria, aliás,
o achado mais importante possível.

Evidência obtida por chave anon **não é aceita** para nenhum desses itens (ver
`PUBLISHABLE_KEY_CATALOG_DISCOVERY = INSUFFICIENT`). Relato de sessão anterior também
não é aceito. O resultado vai para `PHASE1_LIVE_STATE.md`.

Junto disso, a Fase 1 deve produzir:

- o **manifesto de evidência de branch** no formato de `PHASE0_INVENTORY.md` §19.4
  (`BRANCH · BRANCH_HEAD_SHA · MERGE_BASE_SHA · FILE_PATH · FILE_SHA256 ·
  CLASSIFICATION`), para que as afirmações sobre branches deixem de depender do estado
  local dos refs;
- a **confirmação do dono** para `OPERATIONAL_STATUS` dos quatro apps (DEC-10) — o que
  está publicado, quem tem participante ativo, onde há dinheiro em aberto;
- a **verificação do `SECRET_EXISTENCE`** de `POWERBALL_PRIVATE_PARTICIPANT_DATA`;
- o **inventário read-only completo de A.1** — não só tabelas: schemas, views,
  materialized views, sequences, types, extensions, constraints, indexes,
  `relrowsecurity`/`relforcerowsecurity`, policies, functions (com `security_definer`,
  owner, grants e `search_path`), triggers, grants, publications/Realtime, `pg_cron`,
  Storage buckets e policies, Edge Functions, Database Webhooks, nomes de Vault/secrets
  e schemas expostos pelo PostgREST;
- a **verificação de deployment** dos arquivos estáticos — `DEPLOYMENT_STATE` e
  `LIVE_AUDIENCE` por artefato, com URL, HTTP status, timestamp, hash live e hash do
  commit; e, no mesmo passo, `LIVE_SITE_PII` (`PHASE0_PII_MAP.md` §0).

Enquanto isso não acontecer, **nenhuma decisão de arquitetura deve ser tomada** —
notadamente a de se o modelo 2 é um sistema vivo a migrar ou um schema morto a
descartar (ver D-12: a chave malformada sugere que pode nunca ter funcionado).
