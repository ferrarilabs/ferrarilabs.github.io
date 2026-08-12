# FASE 0 — Inventário estático classificado

**Fase:** ZERO_BASED_DISCOVERY
**Fonte:** exclusivamente worktree + git read-only + documentação versionada.
**Estado do banco de produção:** NÃO CONSULTADO. Nenhuma linha deste documento
prova o que existe no Supabase.

Branch: `db-modernization-architecture` · HEAD `0660d99`.

```
BASE_WORKTREE_BEFORE_DOCUMENTS = CLEAN
CURRENT_WORKTREE = 7 UNTRACKED DOCUMENTS (docs/bolao/db-modernization/)
```

## Taxonomia de classificação — eixos independentes

Nenhum eixo deriva de outro. Um descreve o repositório; um descreve o banco de
produção; e, para arquivos estáticos, dois descrevem o **deployment live**.

Formato de célula: `REPO: <x> · PROD: <y>` para objetos de banco;
`REPO: <x> · DEPLOY: <y> · LIVE_AUDIENCE: <z>` para arquivos estáticos.

### Eixo 1 — `REPOSITORY_STATE`

| Código | Significado |
|---|---|
| `CODE_REFERENCED` | O objeto/arquivo existe e é referenciado por código ou workflow versionado |
| `CODE_PRESENT_NOT_REFERENCED` | Existe no repositório; nenhum código ou workflow versionado o invoca |
| `STATIC_SOURCE` | Arquivo estático usado como fonte de dados |
| `DOCUMENTATION_ONLY` | Afirmado em documentação, sem código nem DDL correspondente |
| `BRANCH_ONLY` | Existe apenas em branch não mergeada em `main` |
| `PROPOSED_ONLY` | Proposta explícita, marcada como não executada |
| `CONFLICTING` | Duas fontes do repositório se contradizem |

### Eixo 2 — `PRODUCTION_STATE`

| Código | Significado |
|---|---|
| `CONFIRMED_PRESENT` | Presença do objeto observada por fonte administrativa direta |
| `ROWS_PRESENT` | O objeto tem linhas — fato distinto de estar em uso |
| `CONFIRMED_ABSENT` | Ausência observada por fonte administrativa direta |
| `CONFIRMED_IN_USE` | Presença **e** uso operacional observados — ver regra abaixo |
| `PRESENT_USAGE_UNKNOWN` | Presente; se é exercitado, não se sabe |
| `UNVERIFIED` | Nenhuma evidência de produção foi coletada |

> **Regra dura:** nenhum objeto pode ser classificado como ativo em produção com base
> apenas em código, SQL, workflow, documentação ou branch. Nesta fase, **todo**
> `PRODUCTION_STATE` de objeto de banco é `UNVERIFIED`. As categorias `CONFIRMED_*`,
> `ROWS_PRESENT` e `PRESENT_USAGE_UNKNOWN` só podem ser atribuídas na Fase 1.

> **`CONFIRMED_IN_USE` é a etiqueta mais fácil de atribuir por engano.** Ela **não**
> pode ser atribuída porque:
>
> - o objeto existe;
> - a tabela tem linhas;
> - o catálogo lista o objeto;
> - SQL versionado o referencia.
>
> Catálogo mais contagem provam **`CONFIRMED_PRESENT` + `ROWS_PRESENT`** — e nada
> além disso. Linhas podem ser resíduo de um teste de 2025, de uma importação
> abandonada ou de um sistema desligado.
>
> `CONFIRMED_IN_USE` exige **evidência operacional**, de pelo menos uma destas formas:
>
> - app live observado usando o objeto;
> - escrita recente correlacionada a um evento conhecido;
> - workflow ou Edge Function que comprovadamente o exercita;
> - telemetria ou log administrativo;
> - confirmação humana **apoiada por evidência** — não a lembrança sozinha.
>
> Sem evidência operacional, o objeto para em **`PRESENT_USAGE_UNKNOWN`**. Esta é a
> classificação esperada para a maior parte do que a Fase 1 encontrar.

### Eixo 3 — `DEPLOYMENT_STATE` (somente arquivos estáticos)

| Código | Significado |
|---|---|
| `UNVERIFIED` | Não se comparou o repositório com o artefato publicado |
| `DEPLOYED_MATCH` | O artefato live confere com o commit — ver requisito de evidência |
| `DEPLOYED_STALE` | O artefato live existe e **diverge** do commit |
| `UNPUBLISHED` | Não há artefato live correspondente |

### Eixo 4 — `LIVE_AUDIENCE` (somente arquivos estáticos)

| Código | Significado |
|---|---|
| `UNVERIFIED` | Quem alcança o artefato live não foi verificado |
| `PUBLIC` | Verificado como acessível sem autenticação |

> **`DEPLOYED_MATCH` exige as cinco evidências, todas juntas:**
>
> 1. URL live;
> 2. HTTP status da resposta;
> 3. timestamp da coleta;
> 4. hash do arquivo **live**;
> 5. hash do arquivo correspondente **no commit**.
>
> Faltando qualquer uma, o estado é `UNVERIFIED`. Não existe `DEPLOYED_MATCH`
> presumido.

> **A árvore estática do repositório não é automaticamente a produção live.** A
> existência do GitHub Pages não garante que `origin/main` e o artefato publicado
> sejam iguais: o build pode ter falhado, ficado para trás, servido de outra branch ou
> de outro caminho, ou estar em cache. **Um incidente recente de Pages demonstrou que
> `main` e o site live podem divergir** — é observação suficiente para tornar a
> presunção inaceitável.
>
> Consequência para esta fase: **nenhum arquivo estático recebe `DEPLOYED_MATCH`
> aqui.** Todos são `DEPLOY: UNVERIFIED · LIVE_AUDIENCE: UNVERIFIED`. Ler o arquivo no
> worktree diz o que o repositório contém, não o que o público recebe.

---

## 1. Arquivos SQL

| Arquivo | Onde | Classificação |
|---|---|---|
| `bolao/loterias/powerball/scripts/supabase_setup.sql` | `main` | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` |
| `bolao/loterias/powerball/migrations/001_schema.sql` | branch `powerball-admin-supabase-audit` | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `bolao/loterias/powerball/migrations/002_rls.sql` | idem | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `bolao/loterias/powerball/migrations/003_rpcs.sql` | idem | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `bolao/loterias/powerball/migrations/004_rpcs_draws_tickets_publications_results_emails.sql` | idem | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `bolao/loterias/powerball/scripts/bootstrap_owner_role.sql` | idem | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `bolao/shared/sql/001_bolao_notification_schema.sql` | branch `football-operational-hardening` | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `bolao/shared/sql/002_claim_bolao_notification_jobs_rpc.sql` | idem | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `supabase/tests/rls/01_anon_select_scope.sql` | branch `security-review-readonly` | `REPO: PROPOSED_ONLY` (cabeçalho: *"PROPOSAL ONLY — never executed"*) `· PROD: UNVERIFIED` |
| `supabase/tests/rls/02_anon_cannot_mass_assign_admin_fields.sql` | idem | `REPO: PROPOSED_ONLY · PROD: UNVERIFIED` |

**Nenhum arquivo `.sql` em `main` além do primeiro.** Não existe diretório de
migrations em `main`; não existe ferramenta de migration versionada.

## 2. Schemas

**Todo DDL versionado de tabelas de aplicação identificado nesta fase aponta para
`public`.** Nenhuma separação por domínio, por sensibilidade ou por audiência
(público/admin) aparece no DDL versionado. Se existem outros schemas no banco real —
inclusive schemas criados fora do controle de versão — isto é `UNVERIFIED`; ver Q1 e
Q12 em `PHASE0_EVIDENCE_GAPS.md`.

## 3. Tabelas citadas, por modelo

### Modelo 1 — `bolao_state` (a tabela que o código dos apps de futebol referencia)

| Tabela | Definição em | Classificação |
|---|---|---|
| `public.bolao_state` (`id text pk`, `state jsonb`, `updated_at timestamptz`) | `bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md` — **DDL só em markdown, não em `.sql`** | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` |

Três linhas lógicas **pretendidas** pelo código: `id = 'main'` (copa2026), `'br2026'`,
`'cdb2026'`. Que a tabela exista, e que contenha essas três linhas, é `UNVERIFIED` (Q2).

### Modelo 2 — participantes relacionais (único DDL de `main`)

| Tabela | Linha em `bolao/loterias/powerball/scripts/supabase_setup.sql` | Classificação |
|---|---|---|
| `public.users` | 7 | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` |
| `public.bolao_types` | 23 | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` |
| `public.user_bolao_participation` | 41 | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` |
| `public.audit_log` | 78 | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` |
| `public.email_log` | 97 | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` |

`CODE_REFERENCED` aqui significa apenas que scripts Python versionados nomeiam essas
tabelas — não que a escrita tenha êxito. Ver D-12 (chave malformada).

### Modelo 3 — `powerball_*` (só documentação)

| Tabela | Definição em | Classificação |
|---|---|---|
| `public.powerball_draws` | `bolao/loterias/powerball/docs/DATABASE_SETUP_SUPABASE.md` | `REPO: DOCUMENTATION_ONLY · PROD: UNVERIFIED` |
| `public.powerball_participants` | idem | `REPO: DOCUMENTATION_ONLY · PROD: UNVERIFIED` |
| `public.powerball_audit_log` | idem | `REPO: DOCUMENTATION_ONLY · PROD: UNVERIFIED` |

As policies **documentadas** dependem de `auth.jwt() ->> 'is_admin'` /
`auth.jwt() ->> 'email'`. **Nenhum app deste repositório emite JWT do Supabase Auth**
— os quatro apps usam apenas a chave anon (observação de repositório). Inferência,
não observação de produção: se aplicadas como documentadas, essas policies não seriam
satisfeitas por nenhum cliente existente deste repositório. Ver Q14.

### Modelo 4 — `lottery_*` (branch `powerball-admin-supabase-audit`, 33 commits)

13 tabelas, todas `REPO: BRANCH_ONLY · PROD: UNVERIFIED`: `lottery_admin_roles`, `lottery_participants`,
`lottery_pools`, `lottery_draws`, `lottery_participations`,
`lottery_payment_transactions`, `lottery_tickets`, `lottery_ticket_publications`,
`lottery_ticket_publication_items`, `lottery_results`, `lottery_email_jobs`,
`lottery_email_deliveries`, `lottery_admin_audit` (auditoria encadeada por hash).
Enums: `lottery_role`, `participant_state`, `payment_txn_type`.
View pública sem PII: `lottery_public_projection`, concedida a `anon`.

### Modelo 5 — outbox/notificações (branch `football-operational-hardening`, 19 commits)

`bolao_events`, `bolao_notification_jobs`, `bolao_notification_deliveries`,
`bolao_processing_runs` — todas `REPO: BRANCH_ONLY · PROD: UNVERIFIED`. Enum
`bolao_notification_job_status`. Índices desenhados para claim com
`FOR UPDATE SKIP LOCKED`.

## 4. Views

| View | Onde | Classificação |
|---|---|---|
| `lottery_public_projection` | branch `powerball-admin-supabase-audit` | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |

**Nenhuma view versionada em `main`.** Se existem views não versionadas no banco é
`UNVERIFIED` (Q7).

## 5. Functions / RPCs

| RPC | Onde | Classificação |
|---|---|---|
| `lottery_current_role()` + ~18 RPCs `admin_*` (`admin_create_participant`, `admin_record_payment`, `admin_reverse_payment`, `admin_create_draw`, `admin_publish_tickets`, `admin_record_result`, `admin_enqueue_email`, …) | branch `powerball-admin-supabase-audit` (`003`/`004`) | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `claim_bolao_notification_jobs`, `mark_bolao_notification_sent`, `mark_bolao_notification_retryable_failure`, `mark_bolao_notification_permanent_failure`, `release_stale_bolao_processing` | branch `football-operational-hardening` (`002`) | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |

**Nenhuma function ou RPC versionada em `main`.** Nenhum código de `main` chama
`.rpc(...)`. A existência de functions não versionadas no banco é `UNVERIFIED` (Q7).

## 6. Triggers

**Nenhum trigger versionado em nenhuma branch.** A existência de triggers não
versionados no banco é `UNVERIFIED` (Q7).
Consequência observada no DDL versionado: `public.users.updated_at`
(`bolao/loterias/powerball/scripts/supabase_setup.sql:7`) tem `DEFAULT` mas nenhum
trigger versionado que o mantenha — no schema como versionado, o valor só refletiria a
criação da linha. Classificação: `REPO: CONFLICTING · PROD: UNVERIFIED` (a coluna
promete semântica que o DDL versionado não entrega).

## 7. Policies RLS

> Tudo nesta seção descreve policies **versionadas ou documentadas**. Que a policy em
> vigor no banco corresponda a alguma delas é `PROD: UNVERIFIED` em todos os casos —
> ver Q6 e Q11.

### Em `main` (`bolao/loterias/powerball/scripts/supabase_setup.sql:57-135`)

RLS habilitada nas 5 tabelas. As 9 policies são, na prática, `USING (true)` /
`WITH CHECK (true)`:

- `Allow read users`, `Allow insert users (scripts only)`
- `Allow read bolao_types`
- `Allow read participation`, `Allow insert participation (scripts only)`
- `Allow read audit_log`, `Allow insert audit_log (scripts only)`
- `Allow read email_log`, `Allow insert email_log (scripts only)`

O sufixo **"(scripts only)" é aspiracional, não é enforcement** — os scripts usam a
mesma chave anon que o navegador. Classificação: `REPO: CONFLICTING · PROD: UNVERIFIED`.

### `bolao_state` (documentação copa2026)

`allow anon read / insert / update`. A documentação registra que a policy foi
originalmente `using (id = 'main')` e depois **ampliada** para os três ids. A
documentação diz textualmente que *"anyone with the site's anon key can read/write
the bolão state"*. Classificação: `REPO: CODE_REFERENCED · PROD: UNVERIFIED`. Essa
frase é uma afirmação **da documentação**, não uma observação do banco; é o que torna
D-01 e D-02 candidatos a P0, não o que os confirma.

## 8. Modelos JS/JSON usados como banco estático — `REPO: STATIC_SOURCE · DEPLOY: UNVERIFIED · LIVE_AUDIENCE: UNVERIFIED`

**Correção registrada.** Uma redação anterior tratava esta seção como exceção, dizendo
que para arquivos servidos pelo GitHub Pages "o repositório é a produção" e atribuindo
`PROD: CONFIRMED_IN_USE`. Isso estava errado e foi retirado. A existência do Pages não
garante que `origin/main` e o artefato publicado sejam iguais — e um incidente recente
de Pages demonstrou que podem divergir.

Classificação correta de **todos** os arquivos desta seção nesta fase:

```
REPOSITORY_STATE = STATIC_SOURCE
DEPLOYMENT_STATE = UNVERIFIED
LIVE_AUDIENCE    = UNVERIFIED
```

O que a inspeção estática prova é o conteúdo **no worktree, no commit `0660d99`**. O
que o público recebe ao abrir o site é outra pergunta, e não foi feita nesta fase.
Para promover qualquer linha a `DEPLOYED_MATCH` são necessárias as cinco evidências da
taxonomia (URL live, HTTP status, timestamp, hash live, hash do commit). Qual app está
publicado permanece `OPERATIONAL_STATUS = REQUIRES_OWNER_CONFIRMATION` (DEC-10).

| Arquivo | Entidade | Volume | PII |
|---|---|---|---|
| `bolao/loterias/powerball/js/data.js` | `LOTTERY_GAME_TYPES`, `POWERBALL_DRAWS` (3 sorteios) com `participants`, `sharedTickets.series`, `finance`, `result`, `profit` | 3 sorteios, ~36 linhas de participante | **SIM** — nomes reais + método de pagamento + valor + data/hora + estado |
| `bolao/copa2026/js/data.js` | flags, strength, `groupMatches`, knockout | ~104 partidas | não |
| `bolao/br2026/js/data.js` | `BR2026_DATA.teams` | 20 | não |
| `bolao/cdb2026/js/data.js` | fases, `teamLogos`, strength | ~40 | não |
| `bolao/loterias/powerball/scripts/email/outbox.json` | fila de jobs de e-mail | 19 jobs | sintéticos (`@example.invalid`) + `<ADMIN_EMAIL_ALLOWLISTED>` |
| `bolao/loterias/powerball/scripts/email/manifests/2026-08-05.v2.json` | manifesto de bilhetes + sha256 | ~15 | não |
| `bolao/cdb2026/scripts/fixtures/golden_state.json` | golden master anonimizado | 1 estado | anonimizado por design |
| `bolao/loterias/powerball/scripts/new_participants_template.csv` | template de importação | 2 dummy | não |

**Achado estrutural:** o Powerball **não fala com o Supabase no frontend**. Seu
único store de cliente é `localStorage["powerball_local_results_v1"]`
(`bolao/loterias/powerball/js/app.js:6`), um mapa de override sobre `data.js`.

## 9. Stores de cliente (localStorage / sessionStorage)

Store primário por app — o Supabase é **espelho**, não fonte de verdade:

| App | Chave de estado | Idioma | Admin (session) |
|---|---|---|---|
| copa2026 | `bolao_copa_2026_state` | `bolao_lang` | `adminOk`, `adminUntil`, `adminAttempts`, `adminLockUntil` |
| br2026 | `bolao_br2026_state` | `bolao_br2026_lang` | `br2026_loginAttempts`, `br2026_loginLockUntil`, `br2026_adminUntil` |
| cdb2026 | `bolao_cdb2026_state` | — | `cdb2026_loginAttempts`, `cdb2026_loginLockUntil`, `cdb2026_adminUntil` |
| powerball | `powerball_local_results_v1` | — | — |

Caches e rascunhos: `bolao_draft_v4` (session, 2h), `bolao_api_football_cache`,
`bolao_live_clock_cache`, `br2026_schedule_${siteVersion}`,
`bolao_br2026_standings_baseline_v1`, `*_confirmed_half_boundary`.

## 10. Scripts de importação

| Script | Lê | Escreve | Classificação |
|---|---|---|---|
| `bolao/loterias/powerball/scripts/add_participant_to_supabase.py` | CSV/args | `users`, `bolao_types`, `user_bolao_participation` | `REPO: CODE_PRESENT_NOT_REFERENCED` (invocação manual; nenhum workflow o chama) `· PROD: UNVERIFIED` — ver §20 (chave malformada) |
| `bolao/loterias/powerball/scripts/add_participants.py` | CSV | idem | `REPO: CODE_PRESENT_NOT_REFERENCED · PROD: UNVERIFIED` |
| `bolao/loterias/powerball/scripts/add-participant.js` | args | **texto de `bolao/loterias/powerball/js/data.js`** | `REPO: STATIC_SOURCE · PROD: UNVERIFIED` |
| `scripts/powerball/import_data_to_supabase.mjs` | `data.js` | `lottery_*` (dry-run) | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `bolao/loterias/powerball/scripts/fetch_and_send_results.py` | NY Open Data API | muta `bolao/loterias/powerball/js/data.js`, dispara e-mail | `REPO: CODE_REFERENCED` (`.github/workflows/powerball-results-email.yml`) `· PROD: UNVERIFIED` |

## 11. Scripts que enviam e-mail

Todos via REST do EmailJS (`https://api.emailjs.com/api/v1.0/email/send`), com
`Origin`/`Referer` forjados para `https://ferrarilabs.github.io`. **Nenhum SMTP,
SendGrid, Mailgun ou Resend em lugar nenhum.**

Classificação de todos: `REPO: CODE_REFERENCED · PROD: UNVERIFIED`. `CODE_REFERENCED`
significa que existe workflow versionado que os invoca — **não** que algum e-mail
tenha sido de fato enviado a partir dessa invocação, o que só o histórico de execução
do GitHub Actions e o painel do EmailJS responderiam.

- `bolao/copa2026/scripts/send_result_email.py` (~1222 linhas) — `.github/workflows/auto_results.yml`
- `bolao/copa2026/scripts/send_bracket_correction_email.py` — invocação manual (`REPO: CODE_PRESENT_NOT_REFERENCED`)
- `bolao/cdb2026/scripts/send_result_email.py` (~998 linhas) — `.github/workflows/cdb2026_result_emails.yml`
- `bolao/br2026/scripts/send_round_email.py` (~605 linhas) — `.github/workflows/br2026_round_emails.yml`
- `bolao/loterias/powerball/scripts/send_result_email.py` — `.github/workflows/powerball-results-email.yml`
- `bolao/loterias/powerball/scripts/email/send.mjs` — único chokepoint Node

## 12. Outboxes

| Item | Natureza | Classificação |
|---|---|---|
| `bolao/loterias/powerball/scripts/email/outbox.mjs` + `outbox.json` | outbox em arquivo, idempotente (`idempotencyKey`, `status`, `attemptCount`, `providerMessageId`), **sem worker de retry** — envio é síncrono dentro do CLI | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` |
| `bolao_notification_jobs` + RPCs de claim | outbox durável real, com `SKIP LOCKED` | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| Crons do GitHub Actions (`schedule:` a cada 10/30 min em 4 workflows, `cancel-in-progress: false`) | única assincronia versionada | `REPO: CODE_REFERENCED · PROD: UNVERIFIED` — que o agendamento esteja de fato disparando (Actions habilitado, cron não suspenso por inatividade do repositório) não foi verificado |

Chaves de idempotência observadas:
`powerball:{poolId}:participant-added:{participantId}:v{n}` e
`powerball:{poolId}:{drawId}:tickets-published:v{pubVer}.{tplVer}`.

## 13. Backups versionados

| Item | Evidência | Classificação |
|---|---|---|
| `bolao/copa2026/scripts/backup.py` | snapshot de `bolao_state` (3 ids) + tag git | `REPO: CODE_PRESENT_NOT_REFERENCED · PROD: UNVERIFIED` |
| `bolao/copa2026/scripts/backup_daily.py` | `RETAIN_DAYS = 60` (linha 44), poda em `128`, log em `141` | `REPO: CODE_PRESENT_NOT_REFERENCED · PROD: UNVERIFIED` |
| `bolao/copa2026/scripts/backup_watch_m88.py` | polling até resultado da partida 88 | `REPO: CODE_PRESENT_NOT_REFERENCED · PROD: UNVERIFIED` |
| `bolao/*/backups/` | gitignored; conteria entradas reais com `participantEmail` | `REPO: —` (não versionado) `· PROD: UNVERIFIED` |
| Backup gerenciado / PITR do Supabase | — | `PROD: UNVERIFIED` — nada no repositório evidencia (Q8 / gate G1) |
| **Contradição** | `docs/bolao/CDB2026_BACKUP_AND_RECOVERY.md:31` afirma *"Não há nenhuma rotina (`cron`, Supabase scheduled…)"* enquanto `bolao/copa2026/scripts/backup_daily.py` existe e cobre `cdb2026` | `REPO: CONFLICTING · PROD: UNVERIFIED` |
| Teste de restore | `docs/bolao/CDB2026_BACKUP_AND_RECOVERY.md:36`: *"Nenhum procedimento documentado ou script testa 'pegar um backup e restaurá-lo'"* | **nenhuma evidência de restore executado foi encontrada no repositório** |

`CODE_PRESENT_NOT_REFERENCED` para os três scripts de backup é observação direta:
nenhum arquivo em `.github/workflows/` referencia `backup.py` ou `backup_daily.py`. O
docstring de `backup_daily.py` afirma *"Roda via cron a 01:00 AM EDT"* — cron de
máquina, fora do repositório. Se esse cron existe em alguma máquina é `UNVERIFIED`, e
é exatamente a contradição D-08.

### 13.1 O que `backup_daily.py` é e o que não é

Registro explícito, para que não volte a ser tratado como mecanismo de backup do
banco. `bolao/copa2026/scripts/backup_daily.py`:

- é **snapshot parcial de três blobs `bolao_state`** (`?id=eq.<app>&select=state`,
  para `main`, `br2026`, `cdb2026`);
- usa a **publishable key** (`sb_publishable_…`, linha 31) — logo captura apenas o que
  as policies expõem à role `anon`, não o conteúdo real da tabela;
- **não inclui schema**;
- **não inclui constraints**;
- **não inclui RLS/policies**;
- **não inclui grants, functions, triggers, sequences ou roles**;
- **não inclui as tabelas do modelo 2** (`users`, `bolao_types`,
  `user_bolao_participation`, `audit_log`, `email_log`);
- **não inclui tabelas `lottery_*`**;
- **não pode satisfazer o gate G2** (`PHASE0_BACKUP_GATES.md`);
- pode existir apenas como **proteção suplementar**, nunca como o backup do sistema.

Retenção documentada em `bolao/loterias/powerball/docs/AUDIT_LOGGING.md` (audit 7 anos,
e-mail 2 anos, logs indefinidamente): **nenhum código versionado implementa purga ou
TTL**. Classificação: `REPO: DOCUMENTATION_ONLY · PROD: UNVERIFIED`.

## 14. Campos que armazenam PII

Detalhado em `PHASE0_PII_MAP.md`. Resumo: `users.{name,email,phone,state}`,
`audit_log.{entity_id,ip_address}`, `email_log.{recipient_email,recipient_name}`,
`bolao_state.state.entries[].participantEmail` (dentro de JSONB público),
`POWERBALL_DRAWS[].participants[].{name,metodo,valor,data,hora,state}`, e as
páginas estáticas geradas `bolao/copa2026/audit-report.html`,
`bolao/copa2026/audit-detail-picks.html`,
`bolao/copa2026/audit-detail-governance.html`,
`bolao/copa2026/classificacao-geral.html`.

## 15. Chaves naturais e artificiais — identificadores inconsistentes

| Modelo | Chave do participante | Tipo |
|---|---|---|
| `bolao_state.state.entries[]` | `id` | UUID (gerado no cliente) |
| `POWERBALL_DRAWS[].participants[]` | `name` | **string, sem id** |
| `public.users` | `id` + `name UNIQUE` + `email UNIQUE` | BIGSERIAL + 2 chaves naturais |
| `public.powerball_participants` (doc) | `id` | UUID |
| `bolao/loterias/powerball/scripts/email/outbox.json` | `participantId` | **string de nome de exibição** |

`bolao/loterias/powerball/scripts/email/snapshot.mjs:48` declara literalmente
`MATCHING_MODEL = TRANSITIONAL_NAME_BASED`, e junta
`bolao/loterias/powerball/js/data.js` público com o sidecar privado via
`normalizeName()` (trim + colapso de espaços + lowercase, linhas 49, 78, 99-100).
Classificação: `REPO: CONFLICTING · PROD: UNVERIFIED` — chave natural frágil como
único elo entre dado público e PII.

## 16. Modelos financeiros

| Representação | Onde | Forma |
|---|---|---|
| `paid: { [entryId]: bool }` | copa/br/cdb `state` | mapa booleano |
| `participants[].{metodo, valor, status, data, hora}` | `bolao/loterias/powerball/js/data.js` | objeto por participante |
| `finance{totalArrecadado, valorUtilizado, valorGuardadoProximoSorteio, creditoSorteioAnterior}` | `bolao/loterias/powerball/js/data.js`, por sorteio | **totais derivados** |
| `user_bolao_participation.{shares, status}` | `bolao/loterias/powerball/scripts/supabase_setup.sql` | sem `valor`, sem `metodo` |
| `powerball_participants.tx_id` | doc-only | **única coluna de referência de transação existente** |
| `lottery_payment_transactions` + enum `payment_txn_type` | branch | única proposta com movimento explícito e reversão |

**Não existe partida dobrada em nenhum modelo ativo.** `creditoSorteioAnterior`
existe apenas no terceiro sorteio — o encadeamento de saldo entre sorteios é
implícito e não auditável.

## 17. Fontes de verdade concorrentes

1. `localStorage` vs `bolao_state` (Supabase) — merge read-modify-write sem CAS
   (ADR-002); `bolao/br2026/js/app.js:2785` e `bolao/cdb2026/js/app.js:3830` emitem
   `DELETE` da linha inteira quando acionados pelo admin.
2. `bolao/loterias/powerball/js/data.js` (público, sem PII) vs secret
   `POWERBALL_PRIVATE_PARTICIPANT_DATA` (PII) — unidos por nome normalizado.
3. `bolao/loterias/powerball/js/data.js` vs tabelas `users`/`user_bolao_participation` —
   o mesmo participante em dois lugares, sem reconciliação.
4. Bilhete do Powerball em **três formas**: string formatada
   (`sharedTickets.series[].numeros`), array parseado (`result.numbers`), e linha
   de manifesto (`manifests/*.json` com `serial` + sha256).
5. Auditoria: `state.auditLog[]` (cliente, cap 200 —
   `bolao/copa2026/js/app.js:255-260` e `3212`) vs `public.audit_log` vs
   `public.email_log` vs `bolao/loterias/powerball/scripts/email/outbox.json` vs
   `bolao/copa2026/audit-report.html` gerado.

## 18. Propostas não implementadas

Todos com `PROD: UNVERIFIED`. "Não implementada" aqui significa **não versionada em
`main`** — não é afirmação sobre o banco.

- Modelo 3 (`powerball_*`) — `REPO: DOCUMENTATION_ONLY`.
- Modelo 4 (`lottery_*`, 13 tabelas + RLS + ~18 RPCs) — `REPO: BRANCH_ONLY`.
- Modelo 5 (notificações/outbox, 4 tabelas + 5 RPCs) — `REPO: BRANCH_ONLY`.
- ADR-006 (`docs/bolao/adr/ADR-006-...`, branch `security-review-readonly`) +
  2 arquivos pgTAP — `REPO: PROPOSED_ONLY`.
- `POWERBALL_DATA_MIGRATION_PLAN.md` — `REPO: BRANCH_ONLY`.

## 19. Branches relevantes — estado verificado

> **Correção registrada.** A primeira redação desta seção contava commits contra a
> `main` **local** (`99fb53f`), que estava desatualizada, e por isso afirmava que
> `db-modernization-discovery` e `db-modernization-architecture` estavam 3 commits
> à frente. Isso estava errado. A referência correta é `origin/main`.
>
> Estado verificado: `HEAD` = `origin/main` = `0660d9985f65e1afae684f17632cb4b5d3674e4e`.
> `git merge-base --is-ancestor 0660d998 origin/main` → verdadeiro. Os três commits
> de `bolao/loterias/powerball/js/data.js` **já estão em `origin/main`**; não são trabalho pendente.

### 19.1 Contagem verificada (`git rev-list --count origin/main..<branch>`)

> **Reprodutibilidade — limite registrado.** As contagens abaixo e o conteúdo SQL
> branch-only **não são reproduzíveis a partir do ZIP atual** nem de qualquer cópia que
> não carregue os refs remotos: dependem do estado dos refs locais no momento da
> leitura, e `origin/main` pode ter avançado desde então. Um revisor que receba apenas
> os arquivos não consegue reexecutar estas contagens. O formato de manifesto de §19.4
> existe para eliminar essa dependência — ainda **não** foi gerado.

| Branch | Commits à frente de `origin/main` | Conteúdo de banco | Classificação |
|---|---|---|---|
| `powerball-admin-supabase-audit` | 33 | 4 arquivos de migration + bootstrap de role: 13 tabelas, 3 enums, RLS deny-by-default, ~18 RPCs, 1 view pública | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `football-operational-hardening` | 19 | 2 arquivos SQL: 4 tabelas, 1 enum, 5 RPCs de fila | `REPO: BRANCH_ONLY · PROD: UNVERIFIED` |
| `review/integrate-pr120-pr121` | 21 | herda os pgTAP de `security-review-readonly`; nenhum schema próprio | `REPO: PROPOSED_ONLY · PROD: UNVERIFIED` |
| `security-review-readonly` | 1 | 2 arquivos pgTAP marcados no cabeçalho *"PROPOSAL ONLY — never executed"* + ADR-006 | `REPO: PROPOSED_ONLY · PROD: UNVERIFIED` |
| `db-modernization-discovery` | **0** | nenhum | `REPO: CODE_REFERENCED` (idêntica a `origin/main`) `· PROD: UNVERIFIED` |
| `db-modernization-architecture` | **0** | nenhum | `REPO: CODE_REFERENCED` (idêntica a `origin/main`) `· PROD: UNVERIFIED` |

### 19.2 Separação por natureza da evidência

Este bloco classifica a **natureza da evidência**, não o estado de produção — nenhuma
das etiquetas abaixo é um `PRODUCTION_STATE`.

**OBSERVED_IN_REPOSITORY** — observado diretamente por comando git read-only, sujeito
ao limite de reprodutibilidade de §19.1:

- As contagens de commits da tabela 19.1.
- A existência, o caminho e o conteúdo textual dos arquivos SQL em cada branch.
- Que nenhum commit de DDL está contido em `origin/main`
  (`git branch -a --contains`).
- Que as duas branches nomeadas `db-modernization-*` não contêm trabalho de banco
  algum e são ponteiro-idênticas a `origin/main`.

**BRANCH_ONLY** — existe como texto SQL numa branch, nada além disso:

- `lottery_*` (13 tabelas, 3 enums, ~18 RPCs, `lottery_public_projection`).
- `bolao_events` / `bolao_notification_jobs` / `bolao_notification_deliveries` /
  `bolao_processing_runs` + 5 RPCs.
- `POWERBALL_DATA_MIGRATION_PLAN.md`.

**PROPOSED_ONLY** — proposta que se declara não executada:

- `supabase/tests/rls/01_anon_select_scope.sql` e `02_…mass_assign…sql`.
- ADR-006.

**DOCUMENTATION_ONLY** — afirmado em markdown, sem DDL versionado correspondente:

- `powerball_draws` / `powerball_participants` / `powerball_audit_log`.
- O DDL de `public.bolao_state`, que existe **apenas** dentro de
  `bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md` — não há arquivo `.sql` que o crie.

**HISTORICAL_REPORT** — relato de estado passado, não verificável hoje:

- Afirmações de `POWERBALL_PII_AUDIT.md`, `CDB2026_MODERNIZATION_REPORT.md` e
  demais relatórios sobre o que existia ou foi corrigido em determinado momento.
- A afirmação, em `CDB2026_BACKUP_AND_RECOVERY.md`, de que a ausência de rotina de
  backup foi *"confirmada por ausência de qualquer script de agendamento"* — que o
  código atual contradiz (ver §13).

**INFERENCE** — raciocínio meu a partir do que está no repositório, não observação:

- Que as policies do modelo 3 são insatisfazíveis por dependerem de JWT do Supabase
  Auth que nenhum app emite.
- Que a chave híbrida malformada (§20) provavelmente não autentica, e que portanto
  o modelo 2 pode nunca ter sido exercitado.
- Que o sufixo "(scripts only)" das policies não constitui enforcement.

**`PROD: UNVERIFIED`** — não há, neste documento, nenhuma afirmação sobre o que existe
no banco de produção. Especificamente **não** se afirma:

- que qualquer objeto de `bolao/loterias/powerball/scripts/supabase_setup.sql` foi aplicado;
- que `public.bolao_state` existe, nem quais `id`s contém;
- que os objetos `BRANCH_ONLY` foram ou não aplicados fora do processo de merge;
- que as policies RLS em vigor correspondem às versionadas ou às documentadas;
- que os grants concedidos a `anon` correspondem ao que as policies sugerem;
- que não existem tabelas, views, functions ou triggers fora do controle de versão;
- que os crons do GitHub Actions estão efetivamente disparando;
- que o GitHub Secret referenciado pelo código existe.

Tudo isso é o escopo da Fase 1 (`PHASE0_EVIDENCE_GAPS.md`).

### 19.3 Evidência de operação externa anterior — não é fato atual

Uma operação anterior, separada desta modernização, relatou a criação de seis tabelas
mínimas `lottery_*` e uma importação Powerball.

```
SOURCE = PRIOR_EXTERNAL_SESSION_EVIDENCE
CURRENT_VALIDITY = REQUIRES_PHASE1_RECONFIRMATION
DO_NOT_USE_AS_SUBSTITUTE_FOR_CATALOG_INSPECTION
```

Este relato é registrado porque, se confirmado, mudaria a leitura de §3 Modelo 4 e de
Q5 — seriam objetos aplicados fora do processo de merge, e o subconjunto de seis não
corresponde às 13 tabelas do DDL branch-only. Mas ele **não** é evidência de catálogo:
não foi produzido por esta fase, não é reproduzível a partir deste repositório, e não
substitui a inspeção da Fase 1. Nenhum objeto muda de `PROD: UNVERIFIED` por causa
dele. Nenhum dado de participante ou nome é registrado aqui.

### 19.4 Formato de manifesto de evidência de branch (a gerar na Fase 1 — **não criado**)

Para que a evidência de branch deixe de depender do estado local dos refs, o registro
futuro deve ter uma linha por arquivo SQL relevante, com os campos:

```
BRANCH · BRANCH_HEAD_SHA · MERGE_BASE_SHA · FILE_PATH · FILE_SHA256 · CLASSIFICATION
```

`FILE_SHA256` é o que torna a afirmação verificável por terceiros sem acesso aos refs.
Este manifesto **ainda não existe** e não foi gerado nesta fase.

### 19.5 Regra de leitura desta seção

Uma branch conter DDL prova que **alguém escreveu** aquele DDL. Não prova que ele
foi aplicado, revisado, aprovado ou sequer executado uma vez. Um objeto só sai de
`PROD: UNVERIFIED` mediante evidência administrativa direta do catálogo — não por
aparecer em SQL versionado, em script de setup, em workflow, em documentação, em
relatório histórico ou em relato de sessão anterior.

## 20. Credenciais no código versionado

- URL do projeto Supabase hardcoded em ~12 arquivos.
- Chave `sb_publishable_…` hardcoded nos 3 `js/config.js` de futebol e em ~8 scripts Python.
- **Chave JWT legada (`eyJ…`)** ainda em
  `bolao/loterias/powerball/scripts/add_participant_to_supabase.py:13` e
  `bolao/loterias/powerball/scripts/send_result_email.py:62`, num formato híbrido
  malformado (header/payload JWT com a chave publishable colada no lugar da
  assinatura) — provavelmente não funcional. Classificação:
  `REPO: CONFLICTING · PROD: UNVERIFIED` (se autentica ou não contra o projeto real
  não foi testado).
- Chaves do EmailJS hardcoded em 4 scripts Python.
- Única credencial lida de variável de ambiente:

```
SECRET_REFERENCED_BY_CODE = POWERBALL_PRIVATE_PARTICIPANT_DATA
  (bolao/loterias/powerball/scripts/send_result_email.py e módulos de e-mail)
SECRET_EXISTENCE = UNVERIFIED
```

O código referenciar a variável prova apenas que o código a lê. **Não** prova que o
GitHub Secret foi criado, que está populado, que tem o formato esperado, nem que o
workflow o injeta. Nada neste repositório pode provar isso.

> Nota de escopo: chaves publicáveis serem públicas é por design no modelo
> anon+RLS. O problema não é a chave estar no código — é a RLS por trás dela ser
> permissiva. Ver `PHASE0_DIVERGENCES.md` D-01.
