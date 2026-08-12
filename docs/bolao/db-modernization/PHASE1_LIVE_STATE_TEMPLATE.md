# FASE 1 — Estado real (TEMPLATE, NÃO PREENCHIDO)

> **Este é um gabarito.** Nenhum resultado de produção foi coletado. Todos os
> campos marcados `<PREENCHER>` permanecem vazios até que a Fase 1 seja
> autorizada e executada segundo `PHASE1_EXECUTION_RUNBOOK.md`.
>
> Ao executar, copiar para `PHASE1_LIVE_STATE.md` e preencher **este arquivo
> permanece como template**, para que a próxima coleta seja comparável à
> anterior.

---

## Cabeçalho da coleta

```
COLLECTION_ID            = <PREENCHER>
TIMESTAMP_UTC            = <PREENCHER>
PROJECT_REFERENCE_MASKED = <KNOWN_PROJECT_REF>
DATABASE_VERSION         = <PREENCHER>
COLLECTOR_METHOD         = <PREENCHER>
READ_ONLY_CONFIRMED      = <PREENCHER — deve ser true, senão a coleta é inválida>
TRANSACTION_MODEL        = ONE_READ_ONLY_TRANSACTION_PER_SECTION
COLLECTION_MODEL         = TIME_BOUNDED_MULTI_TRANSACTION_OBSERVATION
COLLECTION_STARTED_AT_UTC = <PREENCHER>
COLLECTION_ENDED_AT_UTC   = <PREENCHER>
SERVER_VERSION_NUM       = <PREENCHER — S01; < 160000 significa S14f BLOCKED>
```

> **Esta coleta NÃO é um snapshot atômico.** São 37 snapshots independentes, uma
> por seção, cada uma com o seu próprio ponto no tempo. Duas seções vizinhas
> podem observar o catálogo em estados diferentes, e uma migration aplicada no
> meio da janela produziria inconsistência que o resultado não denuncia sozinho.
> Por isso a execução ocorre em janela **sem migration e sem database
> deployment**, a janela inteira fica registrada acima, e cada seção carrega o
> seu `collected_at_utc`.
>
> A correção **não** é voltar para uma transação longa — isso seguraria snapshot
> e impediria vacuum em produção, e reintroduziria a propagação de falha. O custo
> aceito é a não-atomicidade, declarada em vez de escondida.

```
CATALOG_CHANGE_OBSERVED_DURING_COLLECTION = <PREENCHER — true/false>
```

### Provenance da coleta

Isto é **provenance**, não gate. `origin/main` não precisa coincidir com o
baseline da Fase 0 nem com `HEAD`; divergência é registrada e interpretada,
nunca bloqueia.

```
QUERY_PACK_SHA256                = <PREENCHER — sha256, 64 hex>
QUERY_PACK_SHA256_VERIFIED_AFTER = true   <-- OBRIGATÓRIO. Ausente ou false invalida a coleta.
PHASE1_ARTIFACT_COMMIT           = <PREENCHER — SHA de 40 hex do commit dos 4 artefatos>
PHASE1_PACKAGE_MANIFEST_SHA256   = <PREENCHER — sha256 do manifesto dos 4 hashes>
WORKING_TREE_CLEAN_AT_COLLECTION = true   <-- `git status --porcelain` vazio no início.
PHASE0_BASELINE_COMMIT           = <PREENCHER — SHA de 40 hex do commit a1e40f1,
                                    "docs(db): establish zero-based modernization baseline">
REPOSITORY_HEAD_AT_COLLECTION    = <PREENCHER — SHA de 40 hex>
ORIGIN_MAIN_SHA_AT_COLLECTION    = <PREENCHER — SHA de 40 hex>
```

Hash individual de cada artefato, para localizar **qual** divergiu:

| Artefato | `sha256` |
|---|---|
| `PHASE1_READONLY_QUERY_PACK.sql` | `<PREENCHER>` |
| `PHASE1_EXECUTION_RUNBOOK.md` | `<PREENCHER>` |
| `PHASE1_RESULT_SCHEMA.json` | `<PREENCHER>` |
| `PHASE1_LIVE_STATE_TEMPLATE.md` | `<PREENCHER>` |

> Hash de arquivo **untracked** não prova nada: ele pode ser editado entre o
> cálculo e a execução sem deixar rastro em git. Por isso os quatro artefatos
> precisam estar tracked e commitados, e a árvore limpa, **antes** de executar.

Invariantes (qualquer violação invalida a coleta inteira):

```
PRODUCTION_WRITES          = 0
DDL_DETECTED               = false
DML_DETECTED               = false
APPLICATION_FUNCTION_CALLS = 0
COMMIT_ISSUED              = false
RAW_POLICY_EXPRESSIONS     = 0
PARTIALLY_REDACTED_POLICY_EXPRESSIONS = 0
```

### `SANITIZED_OUTPUT_EXIT_GATE` — preencher ANTES de compartilhar

Pré-condição de **saída**, executada localmente sobre **todos** os artefatos da
coleta (saídas por seção + instância JSON + este documento), depois da coleta e
antes de qualquer cópia, envio, upload, colagem em chat ou anexo a issue/PR.
Procedimento completo em `PHASE1_EXECUTION_RUNBOOK.md` §5.1.

```
EMAIL_FINDINGS                = <PREENCHER — deve ser 0>
JWT_FINDINGS                  = <PREENCHER — deve ser 0>
CONNECTION_STRING_FINDINGS    = <PREENCHER — deve ser 0>
PRIVATE_KEY_FINDINGS          = <PREENCHER — deve ser 0>
API_SECRET_FINDINGS           = <PREENCHER — deve ser 0>
UNMASKED_PROJECT_REF_FINDINGS = <PREENCHER — deve ser 0>
PAYMENT_REFERENCE_FINDINGS    = <PREENCHER — deve ser 0>
PARTICIPANT_NAME_FINDINGS     = <PREENCHER — deve ser 0>

SANITIZATION_GATE_COMPLETED_AT_UTC = <PREENCHER — obrigatório pelo schema>
SANITIZATION_GATE_SCANNER_SHA256   = <PREENCHER — sha256 do script §5.1.1 efetivamente executado, obrigatório pelo schema>

SANITIZED_OUTPUT_EXIT_GATE_PASSED = <PREENCHER — true só com os oito em zero>
OUTPUT_SHARE_ALLOWED              = <PREENCHER — false enquanto o gate não passar>
```

> As oito categorias acima e as duas linhas de proveniência
> (`sanitization_gate_completed_at_utc`, `sanitization_gate_scanner_sha256`)
> são todas **obrigatórias** em `PHASE1_RESULT_SCHEMA.json` — `{}` ou uma
> categoria ausente falha a validação, porque não prova que o gate rodou.

> **Só contagens.** O scanner nunca imprime o valor encontrado — nem trecho, nem
> forma mascarada, nem contexto. Um scanner que ecoa o achado vira o segundo
> vazamento, porque o log dele é justamente o que se cola em chat para pedir
> ajuda. Registrar apenas `CATEGORY`, `COUNT`, `FILE` e, quando necessário, a
> linha.
>
> Qualquer contador > 0 → `OUTPUT_SHARE_ALLOWED = false`: redigir localmente,
> **reexecutar o gate inteiro** e só então liberar. Não existe liberação parcial
> de "os outros arquivos".

### Modelo transacional

Cada seção roda na **sua própria** transação `BEGIN READ ONLY ... ROLLBACK`. Uma
transação única para a coleta inteira é inválida: em PostgreSQL, após um erro a
transação fica *aborted* (`SQLSTATE 25P02`) e toda seção seguinte falharia,
destruindo o isolamento de falha. O `PREFLIGHT` prova apenas a sua própria
transação — cada seção prova a sua, e o resultado de cada
`SHOW transaction_read_only` é registrado no quadro da seção 0 abaixo.

---

## 0. Resultado por seção — FONTE ÚNICA DE VERDADE

Uma linha por seção da lista canônica (`PHASE1_EXECUTION_RUNBOOK.md` §2,
espelhada em `$defs/section_id` do schema). **Nenhuma linha pode ser omitida**:
seção que não rodou aparece como `NOT_RUN`.

`STATUS` ∈ { `COLLECTED`, `SKIPPED_BY_PROBE`, `BLOCKED`, `NOT_RUN` }.

| Seção | `STATUS` | `read_only` da seção | `collected_at_utc` | Linhas de metadata | Artefato de saída | `sha256` |
|---|---|---|---|---|---|---|
| `PREFLIGHT` | | | | | | |
| `S01` | | | | | | |
| `S02` | | | | | | |
| `S03` | | | | | | |
| `S04` | | | | | | |
| `S05` | | | | | | |
| `S05b` | | | | | | |
| `S06` | | | | | | |
| `S07` | | | | | | |
| `S08` | | | | | | |
| `S09` | | | | | | |
| `S10` | | | | | | |
| `S11` | | | | | | |
| `S11b` | | | | | | |
| `S12` | | | | | | |
| `S13` | | | | | | |
| `S14a` | | | | | | |
| `S14b` | | | | | | |
| `S14c` | | | | | | |
| `S14d` | | | | | | |
| `S14e` | | | | | | |
| `S14f` | | | | | | |
| `S15a` | | | | | | |
| `S15b` | | | | | | |
| `S15c` | | | | | | |
| `S16` | | | | | | |
| `S17` | | | | | | |
| `S18` | | | | | | |
| `S19` | | | | | | |
| `S20a` | | | | | | |
| `S20b` | | | | | | |
| `S21a` | | | | | | |
| `S21b` | | | | | | |
| `S21c` | | | | | | |
| `S21d` | | | | | | |
| `S21e` | | | | | | |
| `S21f` | | | | | | |

```
EXPECTED_SECTIONS = 37
```

### O que cada status exige — imposto pelo schema

| `STATUS` | Campos obrigatórios |
|---|---|
| `COLLECTED` | `read_only = true` · linhas · artefato · `sha256` · `collected_at_utc` |
| `SKIPPED_BY_PROBE` | `read_only = true` · `probe_result = OBJECT_ABSENT` · `rolled_back = true` · `collected_at_utc` |
| `BLOCKED` | `read_only = true` · `rolled_back = true` · `failure_type` · `required_permission` quando `failure_type = PERMISSION_DENIED` · mensagem sanitizada quando houver · `collected_at_utc` |
| `NOT_RUN` | **proibido** carregar `read_only`, `rolled_back`, linhas, artefato ou `sha256` — não houve transação, e não pode fingir que houve |

### Detalhe das seções `BLOCKED` — VISÃO, não segunda fonte

Uma linha para cada seção que aparece como `BLOCKED` na tabela §0 acima, e
**nenhuma** além dessas. Isto é uma **visão** daquela tabela para leitura humana:
no JSON canônico esses campos moram no **próprio `section_result`**.
`collection_failures` foi **removido** — não existe lista paralela de falhas que
possa contradizer o `status` registrado.

| Seção | `failure_type` | `required_permission` | `error_message_sanitized` | `rolled_back` |
|---|---|---|---|---|
| | | | | |

> `required_permission` é nome de privilégio, role ou atributo de role —
> **nunca** credencial, connection string ou valor de secret.
> `rolled_back` é obrigatoriamente `true`.
>
> **`state` não é um campo de `section_result`** (removido de
> `PHASE1_RESULT_SCHEMA.json` — `additionalProperties: false` rejeita a
> propriedade). `status = BLOCKED` já é a verdade completa persistida para a
> seção. Se for útil na leitura humana desta visão, `COLLECTION_BLOCKED` pode
> ser **anotado ao lado**, fora da tabela, como rótulo derivado — nunca como
> coluna do JSON canônico.
>
> `BLOCKED_SECTIONS`, a contagem de falhas e qualquer agregado por
> `failure_type` são **derivados** desta visão ao redigir o relatório — nada
> disso é campo persistido.

**`PREFLIGHT` é não-negociável:** precisa estar `COLLECTED` com `read_only =
true`. Sem isso não há prova de que a sessão era read-only, e **a coleta inteira
é inválida**.

### Summaries — DERIVADOS, não preenchidos à mão

`COLLECTED_SECTIONS`, `BLOCKED_SECTIONS`, `SKIPPED_SECTIONS` e
`NOT_RUN_SECTIONS` foram **removidos do JSON canônico** e não são campos a
preencher: eram uma segunda fonte da mesma informação, e uma segunda fonte é uma
fonte que pode contradizer a primeira. O schema chegava a aceitar todas as seções
`NOT_RUN` junto de um summary alegando coleta completa.

Calcular a partir da tabela acima, ao redigir o relatório:

| Derivado | Como |
|---|---|
| `COLLECTED_SECTIONS` | contar/listar linhas com `STATUS = COLLECTED` |
| `BLOCKED_SECTIONS` | idem para `BLOCKED` |
| `SKIPPED_SECTIONS` | idem para `SKIPPED_BY_PROBE` |
| `NOT_RUN_SECTIONS` | idem para `NOT_RUN` |
| `FAILURE TABLE` / contagens por `failure_type` | a partir do detalhe registrado nas próprias linhas `BLOCKED` (visão acima) |

`collection_failures` foi removido pelo mesmo motivo: era uma lista paralela de
falhas que podia contradizer o `status` da tabela §0.

> Uma coleta pode ser incompleta. O que ela **não pode** ser é silenciosamente
> incompleta. Inventário vazio não significa "coletou tudo e não achou nada" —
> a completude se lê **aqui**, e em nenhum outro lugar.

**Quando uma seção falha:** `ROLLBACK` da seção → registrar `BLOCKED` com
`rolled_back = true` → abrir **nova** transação `READ ONLY` para a seção
seguinte. Sem o `ROLLBACK`, tudo o que vier depois falha com `25P02`, tenha
permissão ou não.

**Se `SERVER_VERSION_NUM < 160000`:** `S14f` fica `BLOCKED` com
`failure_type = SYNTAX_UNSUPPORTED_VERSION` — `inherit_option` e `set_option` só
existem em `pg_auth_members` a partir do PostgreSQL 16. Registrar, não
contornar.

---

## Taxonomia de estado — usar sempre estes códigos

| Código | Significado | Como se ganha |
|---|---|---|
| `CONFIRMED_PRESENT` | O objeto existe | catálogo |
| `CONFIRMED_ABSENT` | O objeto não existe | catálogo, com a consulta tendo rodado |
| `PRESENT_USAGE_UNKNOWN` | Existe; se é exercitado, não se sabe | catálogo **sem** telemetria |
| `CONFIRMED_IN_USE` | Existe **e** é exercitado | **somente** evidência operacional anexada — ver abaixo |
| `UNVERIFIED` | Não se coletou nada a respeito | — |
| `COLLECTION_BLOCKED` | A coleta foi tentada e recusada | permission denied, timeout |

> **`ROWS_PRESENT` foi REMOVIDO desta taxonomia.** Ele era atribuído a partir de
> `pg_class.reltuples`, que é **estimativa do planner** — dependente do último
> `ANALYZE`, podendo estar arbitrariamente defasada, e valendo `-1` em tabela
> nunca analisada. Estimativa não prova linha alguma.
>
> O fato observável passa a ter nome próprio e a viver fora da taxonomia de
> estado:
>
> ```
> ROW_ESTIMATE_PLANNER   = valor bruto de reltuples (-1 = nunca analisada)
> ROW_ESTIMATE_GT_ZERO   = reltuples > 0
> ```
>
> `ROW_ESTIMATE_GT_ZERO = true` significa exatamente isso e nada mais. **Nunca**
> concluir `CONFIRMED_ROWS_PRESENT` a partir dele. E, sobretudo:
> **`PRODUCTION_STATE` não muda por estimativa do planner** — catálogo dá
> `CONFIRMED_PRESENT`, e sem telemetria o valor correto continua sendo
> `PRESENT_USAGE_UNKNOWN`.
>
> ```
> EXACT_BUSINESS_RECONCILIATION = DEFERRED_TO_PHASE1B
> ```
>
> A reconciliação exata de volume (agregados sobre tabelas de aplicação) não é
> feita nesta fase. A Fase 1B poderá usá-la, estritamente sanitizada, mediante
> autorização separada e explícita.

> **A regra que mais será testada na hora de preencher.** `CONFIRMED_IN_USE`
> **não** se obtém porque o objeto existe, porque a estimativa é maior que zero,
> porque o catálogo o lista, nem porque SQL versionado o referencia. Catálogo dá
> `CONFIRMED_PRESENT` e para aí. Linhas podem ser resíduo de um teste antigo ou
> de uma importação abandonada — têm exatamente a mesma aparência de um sistema
> vivo.
>
> `CONFIRMED_IN_USE` exige uma destas: app live observado usando o objeto;
> escrita recente correlacionada a evento conhecido; workflow ou Edge Function
> que comprovadamente o exercita; telemetria ou log administrativo; confirmação
> humana **apoiada por evidência**.
>
> **Terminar esta fase com a maioria dos objetos em `PRESENT_USAGE_UNKNOWN` é o
> resultado correto**, não uma falha da coleta.

### `CONFIRMED_IN_USE` exige evidência ANEXADA

O schema não aceita mais `CONFIRMED_IN_USE` solto. Todo objeto marcado assim
precisa carregar um bloco de evidência operacional:

```
OPERATIONAL_EVIDENCE:
  source_type                  = <um dos seis abaixo>
  observed_at_utc              = <PREENCHER>
  evidence_reference_sanitized = <PREENCHER>
```

`source_type` ∈ `LIVE_APPLICATION_OBSERVATION` · `RECENT_CORRELATED_WRITE` ·
`WORKFLOW_EXECUTION` · `EDGE_FUNCTION_EXECUTION` · `ADMIN_TELEMETRY` ·
`OWNER_CONFIRMATION_WITH_SUPPORTING_EVIDENCE`.

> **O catálogo nunca preenche esse bloco.** Nenhuma dessas fontes é derivável de
> `pg_catalog`, de `information_schema` ou de estimativa de linha — e é
> exatamente por isso que o campo existe.
>
> `evidence_reference_sanitized` é uma **referência** (id de run de workflow,
> data de log, nome de dashboard), nunca linha de log crua, payload, IP ou
> e-mail. Logs são densos em PII.

---

## 1. Reconciliação — Fase 0 × catálogo real

Uma linha por objeto que a Fase 0 classificou. `REPOSITORY_STATE` vem da
Fase 0 e **não muda** com esta coleta: os eixos são independentes.

> A coluna de linhas é `ROW_ESTIMATE_GT_ZERO` — estimativa do planner, **não**
> contagem, e sem efeito sobre `PRODUCTION_STATE`.

| Objeto | `REPOSITORY_STATE` (Fase 0) | `PRODUCTION_STATE` (coletado) | `ROW_ESTIMATE_GT_ZERO` | Evidência | Divergência |
|---|---|---|---|---|---|
| `public.bolao_state` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | `<seção>` | `<PREENCHER>` |
| `public.users` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | | |
| `public.bolao_types` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | | |
| `public.user_bolao_participation` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | | |
| `public.audit_log` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | | |
| `public.email_log` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | | |
| `powerball_draws` | `DOCUMENTATION_ONLY` | `<PREENCHER>` | | | |
| `powerball_participants` | `DOCUMENTATION_ONLY` | `<PREENCHER>` | | | |
| `powerball_audit_log` | `DOCUMENTATION_ONLY` | `<PREENCHER>` | | | |
| `lottery_*` (13 tabelas) | `BRANCH_ONLY` | `<PREENCHER — uma linha por tabela>` | | | |
| `bolao_events` | `BRANCH_ONLY` | `<PREENCHER>` | | | |
| `bolao_notification_jobs` | `BRANCH_ONLY` | `<PREENCHER>` | | | |
| `bolao_notification_deliveries` | `BRANCH_ONLY` | `<PREENCHER>` | | | |
| `bolao_processing_runs` | `BRANCH_ONLY` | `<PREENCHER>` | | | |
| `lottery_public_projection` (view) | `BRANCH_ONLY` | `<PREENCHER>` | | | |
| RPCs `admin_*` (~18) | `BRANCH_ONLY` | `<PREENCHER>` | | | |
| RPCs de notificação (5) | `BRANCH_ONLY` | `<PREENCHER>` | | | |

### 1.0 Dependências de view (S20a) — escopo limitado

| Objeto dependente | Tipo | Objeto de origem |
|---|---|---|
| `<PREENCHER>` | | |

> S20a cobre apenas dependências via `pg_rewrite` — **views e materialized
> views** sobre as relações que consultam. **Não é um grafo de dependências
> completo**: não cobre foreign keys, `trigger → function`,
> `default → sequence`, dependências de tipo, nem `policy → function`. Ampliar
> é trabalho da Fase 1B. Não tratar a ausência de uma aresta aqui como prova de
> que o objeto não tem dependentes.

### 1.1 Objetos no catálogo **sem** contrapartida no repositório

O achado mais grave possível: objeto em produção fora do controle de versão.

| Objeto | Tipo | Owner | Observação |
|---|---|---|---|
| `<PREENCHER>` | | | |

### 1.2 Objetos versionados/documentados **ausentes** do catálogo

| Objeto | Origem no repositório | Estado |
|---|---|---|
| `<PREENCHER>` | | `CONFIRMED_ABSENT` |

---

## 2. Reconciliação — evidência externa anterior

O relato de sessão externa anterior (`PHASE0_INVENTORY.md` §19.3) mencionava
seis tabelas `lottery_*` mínimas e uma importação Powerball.

```
SOURCE           = PRIOR_EXTERNAL_SESSION_EVIDENCE
CURRENT_VALIDITY = <PREENCHER: CONFIRMED | CONTRADICTED | PARTIALLY_CONFIRMED>
```

| Pergunta | Resposta coletada |
|---|---|
| Quais tabelas `lottery_*` existem de fato? | `<PREENCHER — lista completa>` |
| Quantas são? | `<PREENCHER>` |
| Correspondem às 13 do DDL branch-only, às 6 do relato, ou a outro conjunto? | `<PREENCHER>` |
| Se existem: foram criadas fora do processo de merge? | `<PREENCHER>` |

> A pergunta é **aberta** — "quais existem?" — e não "as seis do relato
> existem?". Partir da lista do relato enviesa a coleta em direção a
> confirmá-lo. O relato é hipótese a testar, nunca linha de evidência
> (`DO_NOT_USE_AS_SUBSTITUTE_FOR_CATALOG_INSPECTION`).

---

## 3. Reconciliação — branches não mergeadas

| Branch | `BRANCH_HEAD_SHA` | `MERGE_BASE_SHA` | Objetos DDL | Presentes no catálogo? |
|---|---|---|---|---|
| `powerball-admin-supabase-audit` | `<PREENCHER>` | `<PREENCHER>` | 13 tabelas, 3 enums, ~18 RPCs, 1 view | `<PREENCHER>` |
| `football-operational-hardening` | `<PREENCHER>` | `<PREENCHER>` | 4 tabelas, 1 enum, 5 RPCs | `<PREENCHER>` |
| `security-review-readonly` | `<PREENCHER>` | `<PREENCHER>` | 2 pgTAP (`PROPOSED_ONLY`) | `<PREENCHER>` |

Manifesto de evidência de branch (`PHASE0_INVENTORY.md` §19.4) — a gerar nesta
fase, para que estas afirmações deixem de depender do estado local dos refs:

```
BRANCH | BRANCH_HEAD_SHA | MERGE_BASE_SHA | FILE_PATH | FILE_SHA256 | CLASSIFICATION
<PREENCHER>
```

> Uma branch com DDL cujo objeto **está** no catálogo significa aplicação fora
> do processo de merge — governança quebrada, não apenas um schema a mais.

---

## 4. Reconciliação — frontend estático

| Arquivo | `REPOSITORY_STATE` | `DEPLOYMENT_STATE` | `LIVE_AUDIENCE` | URL | HTTP | Timestamp | Hash live | Hash commit |
|---|---|---|---|---|---|---|---|---|
| `bolao/loterias/powerball/js/data.js` | `STATIC_SOURCE` | `<PREENCHER>` | `<PREENCHER>` | | | | | |
| `bolao/copa2026/js/data.js` | `STATIC_SOURCE` | `<PREENCHER>` | `<PREENCHER>` | | | | | |
| `bolao/br2026/js/data.js` | `STATIC_SOURCE` | `<PREENCHER>` | `<PREENCHER>` | | | | | |
| `bolao/cdb2026/js/data.js` | `STATIC_SOURCE` | `<PREENCHER>` | `<PREENCHER>` | | | | | |
| `bolao/copa2026/audit-report.html` | `STATIC_SOURCE` | `<PREENCHER>` | `<PREENCHER>` | | | | | |
| `bolao/copa2026/audit-detail-picks.html` | `STATIC_SOURCE` | `<PREENCHER>` | `<PREENCHER>` | | | | | |
| `bolao/copa2026/audit-detail-governance.html` | `STATIC_SOURCE` | `<PREENCHER>` | `<PREENCHER>` | | | | | |
| `bolao/copa2026/classificacao-geral.html` | `STATIC_SOURCE` | `<PREENCHER>` | `<PREENCHER>` | | | | | |

`DEPLOYMENT_STATE` ∈ { `UNVERIFIED`, `DEPLOYED_MATCH`, `DEPLOYED_STALE`,
`UNPUBLISHED` }. **`DEPLOYED_MATCH` exige as cinco colunas de evidência
preenchidas** (URL, HTTP status, timestamp, hash live, hash do commit).
Faltando uma, o estado é `UNVERIFIED`.

```
CURRENT_REPOSITORY_TREE_PII = conforme scanner local
LIVE_SITE_PII               = <PREENCHER>
```

> Este bloco não precisa de credencial nenhuma e é o mais barato de resolver.
> Ver runbook §4.15.

---

## 5. Reconciliação — workflows e automação

| Automação | `REPOSITORY_STATE` | Agendado de fato? | Executou? | `PRODUCTION_STATE` |
|---|---|---|---|---|
| `.github/workflows/auto_results.yml` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | `<PREENCHER>` |
| `.github/workflows/br2026_round_emails.yml` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | `<PREENCHER>` |
| `.github/workflows/cdb2026_result_emails.yml` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | `<PREENCHER>` |
| `.github/workflows/powerball-results-email.yml` | `CODE_REFERENCED` | `<PREENCHER>` | `<PREENCHER>` | `<PREENCHER>` |
| `bolao/copa2026/scripts/backup_daily.py` | `CODE_PRESENT_NOT_REFERENCED` | `<PREENCHER — D-08>` | `<PREENCHER>` | `<PREENCHER>` |
| `pg_cron` jobs | — | `<PREENCHER — S16>` | `<PREENCHER>` | `<PREENCHER>` |
| Database Webhooks | — | `<PREENCHER — runbook §4.7>` | `<PREENCHER>` | `<PREENCHER>` |
| Edge Functions | — | `<PREENCHER — runbook §4.4>` | `<PREENCHER>` | `<PREENCHER>` |

**D-08 fecha aqui:** existe ou não um agendamento executando `backup_daily.py`?
`<PREENCHER>`

---

## 6. Achados de segurança

### 6.1 RLS por relação (S11b) — FATOS, não conclusão

| Relação | `rls_enabled` | `rls_forced` | `policy_count` | `default_deny_for_normal_roles` | `owner_bypasses_rls` | `policies_defined_but_rls_off` |
|---|---|---|---|---|---|---|
| `<PREENCHER>` | | | | | | |

> **O rótulo `RLS_ON_NO_POLICIES__DENIES_ALL_EXCEPT_OWNER` foi REMOVIDO.** Ele
> era falso em pelo menos dois casos: com `FORCE RLS` habilitado o **owner
> também é barrado** (logo "except owner" está errado), e uma role com
> `BYPASSRLS` ou um superusuário atravessa a policy de qualquer jeito — coisa
> que uma linha de S11b não tem como saber.
>
> As duas derivadas que ficam são estritas:
>
> ```
> default_deny_for_normal_roles = rls_enabled AND policy_count = 0
> owner_bypasses_rls            = rls_enabled AND NOT rls_forced
> ```
>
> "Normal roles" = roles **sem** `BYPASSRLS` e **sem** superusuário. Esses dois
> atributos são analisados separadamente em S14e, e a conclusão de exposição só
> é válida **cruzando as duas seções**. Nunca ler uma linha desta tabela como
> veredito isolado.

`policies_defined_but_rls_off = true` é o achado mais traiçoeiro: as policies
existem, aparecem em S11, e não aplicam nada.

### 6.1b Policies (S11) — nenhuma expressão foi coletada

| Relação | Policy | Cmd | Roles | `has_using` | `using_is_unconditional` | `references_auth` | `contains_literal` | `directed_review_required` |
|---|---|---|---|---|---|---|---|---|
| `<PREENCHER>` | | | | | | | | |

> As colunas de expressão sanitizada foram **eliminadas** desta fase. Elas
> dependiam de um sanitizer que não cobre dollar-quoting, aspas escapadas,
> identificadores entre aspas duplas nem concatenação — mais uma "segunda camada"
> manual que ninguém consegue auditar depois. Numa varredura ampla sobre um banco
> com PII de participante, isso é apostar o dado numa etapa que não deixa prova.
>
> Policy cuja **semântica** precise ser analisada recebe
> `directed_review_required = true` (`DIRECTED_POLICY_REVIEW_REQUIRED`) e é lida
> individualmente em etapa separada e autorizada.

```
RAW_POLICY_EXPRESSIONS                = 0
PARTIALLY_REDACTED_POLICY_EXPRESSIONS = 0
DIRECTED_POLICY_REVIEW_REQUIRED       = <PREENCHER — lista de policies>
```

### 6.2 Promoção de severidade — D-01 e D-02

Ambos estão em `P0-CANDIDATE` (`PHASE0_DIVERGENCES.md`). Esta coleta decide.

| Item | Pergunta | Resposta | Severidade final |
|---|---|---|---|
| D-01 | `anon` tem `SELECT` em `bolao_state`, e há PII nas linhas? | `<PREENCHER>` | `<P0 ou P2>` |
| D-02 | `anon` tem **grant** de `DELETE` em `bolao_state` **e** policy que o permita? | `<PREENCHER>` | `<P0 ou P2>` |

> D-02 exige as **duas** camadas. Grant sem policy permissiva não autoriza; nem
> policy sem grant. E a resposta vem de **ler** `pg_policies` (S11) e o **ACL
> efetivo do catálogo** (S21a) — jamais de executar a operação. Atenção: a
> resposta **não** pode vir só de `information_schema.role_table_grants` (S14a),
> que é visão parcial e pode omitir um privilégio concedido a `PUBLIC` — e
> `anon` é membro de `PUBLIC`.

### 6.3 `CATALOG_ACL_EXPANSION` — PUBLIC, column ACL e default privileges

Fonte: **S21a–f** (catálogo + `aclexplode`/`acldefault`), não S14.

> **Esta seção NÃO é "effective ACL", e não pode ser descrita assim.** O que ela
> enumera é o ACL do catálogo, o `acldefault()` aplicado quando o ACL é `NULL`,
> a entrada `PUBLIC` e a role nomeada de cada entrada. **Privilégio efetivo**
> depende ainda de role membership e herança (S14f — `inherit_option`,
> `set_option`), atributos de role (S14e — `SUPERUSER`, `BYPASSRLS`), RLS
> (S11b) e `USAGE` no schema (S21c). A derivação final é feita cruzando essas
> seções; S14 e S21 são **evidência para a derivação, não a derivação**.

```
PUBLIC_TABLE_PRIVILEGES    = <PREENCHER — S21a onde is_public>
PUBLIC_FUNCTION_EXECUTE    = <PREENCHER — S21d onde is_public e privilege=EXECUTE>
PUBLIC_SCHEMA_USAGE        = <PREENCHER — S21c onde is_public e privilege=USAGE>
PUBLIC_SEQUENCE_PRIVILEGES = <PREENCHER — S21b onde is_public>
COLUMN_ACL                 = <PREENCHER — S21f>
DEFAULT_PRIVILEGES         = <PREENCHER — S21e, incl. os que concedem a PUBLIC>
```

`COLUMN_ACL` (S21f) merece atenção própria: uma tabela pode não ter grant nenhum
e ainda assim ter uma **coluna** exposta. Resultado vazio ali é um resultado
("nenhum ACL de coluna explícito"), não uma seção que deixou de rodar — a
distinção fica na tabela da seção 0.

### 6.3b Herança de role (S14f) — o que decide privilégio efetivo

| Role concedida | Membro | `admin_option` | `inherit_option` | `set_option` |
|---|---|---|---|---|
| `<PREENCHER>` | | | | |

> `admin_option` sozinho não basta. **`inherit_option`** decide se os privilégios
> da role são exercidos automaticamente, sem `SET ROLE` — é o que determina se um
> membro "já é" a role. **`set_option`** decide se ela pode ser assumida
> deliberadamente. Sem os três não se sabe que privilégio uma role realmente
> exerce. Requer PostgreSQL ≥ 16; abaixo disso, S14f fica `BLOCKED`.

| Achado | Por que importa |
|---|---|
| `PUBLIC_TABLE_PRIVILEGES` | privilégio a `PUBLIC` numa tabela de participante é P0-CANDIDATE, independentemente de RLS — grant e policy são camadas distintas, e RLS pode estar desligada, inerte ou contornada por `BYPASSRLS` |
| `PUBLIC_FUNCTION_EXECUTE` | combinado com `SECURITY DEFINER`, é o pior achado que esta coleta pode produzir: qualquer um executa, com o privilégio do owner |
| `PUBLIC_SCHEMA_USAGE` | `USAGE` em schema é a porta: sem ela um grant de tabela não é exercitável; com ela, é |
| `DEFAULT_PRIVILEGES` | explica por que um objeto criado **amanhã** já nasce exposto; não aparece em nenhuma outra seção |

```
INFORMATION_SCHEMA_GRANTS_DIVERGE_FROM_CATALOG_ACL = <PREENCHER — sim/não + detalhe>
```

> Divergência entre S14 e S21 é **achado**, não ruído: significa que a visão que
> se costuma usar para auditar grants estava escondendo alguma coisa.

### 6.4 Outros achados

```
ROLES_WITH_BYPASSRLS                          = <PREENCHER>
SECURITY_DEFINER_WITHOUT_PINNED_SEARCH_PATH   = <PREENCHER>
VIEWS_WITHOUT_SECURITY_INVOKER                = <PREENCHER>
FUNCTIONS_WITH_DEFAULT_PUBLIC_EXECUTE         = <PREENCHER — cruzar com S21d>
DISABLED_TRIGGERS                             = <PREENCHER>
INVALID_INDEXES                               = <PREENCHER>
PUBLICATIONS_FOR_ALL_TABLES                   = <PREENCHER>
PUBLIC_STORAGE_BUCKETS                        = <PREENCHER>
SCHEDULED_JOBS_BY_CLASS                       = <PREENCHER — S16: HTTP/SQL/FUNCTION/UNKNOWN>
```

> `ROLES_WITH_BYPASSRLS` contendo `anon` ou `authenticated` torna toda a análise
> de policies irrelevante para essas roles. Verificar antes de concluir
> qualquer coisa sobre RLS.

---

## 7. Perguntas da Fase 0 — estado final

| # | Pergunta | Resposta | Estado |
|---|---|---|---|
| Q1 | Quais tabelas existem em `public`? | `<PREENCHER>` | |
| Q2 | `bolao_state` existe? Linhas, `id`s, `updated_at`? | `<PREENCHER>` | |
| Q3 | Objetos de `supabase_setup.sql` aplicados? Têm linhas? | `<PREENCHER>` | |
| Q4 | Alguma tabela `powerball_*` existe? | `<PREENCHER>` | |
| Q5 | Quais tabelas `lottery_*` existem? | `<PREENCHER>` | |
| Q6 | Quais policies RLS estão ativas? | `<PREENCHER>` | |
| Q7 | Functions/triggers/views não versionados? | `<PREENCHER>` | |
| Q8 | PITR / backup gerenciado? Retenção? Plano? | `<PREENCHER>` | |
| Q9 | `anon` tem `DELETE` em `bolao_state`? | `<PREENCHER>` | |
| Q10 | `audit_log` / `email_log` têm dados reais? | `<PREENCHER — apenas ROW_ESTIMATE_GT_ZERO; contagem exata é DEFERRED_TO_PHASE1B>` | |
| Q11 | Grants de `anon` e `authenticated`? | `<PREENCHER — S21a/S21d, incluindo o que vem via PUBLIC>` | |
| Q12 | Schemas expostos via PostgREST? | `<PREENCHER>` | |
| Q13 | Outros projetos Supabase? | `<PREENCHER>` | |
| Q14 | Usuários no Supabase Auth? | `<PREENCHER — contagem, nunca a lista>` | |
| Q15 | Tamanho de cada linha de `bolao_state` vs. teto de 1 MB | `<PREENCHER — só `pg_total_relation_size` da relação (S03); tamanho POR LINHA exige ler a tabela: DEFERRED_TO_PHASE1B>` | |
| Q16 | Índices, constraints e FKs reais | `<PREENCHER — S05/S06; definições saem como flags+length+hash, não como texto>` | |
| Q17 | Privilégios concedidos a `PUBLIC`? | `<PREENCHER — S21a–e; ver §6.3>` | |
| Q18 | Default privileges aplicáveis a objetos futuros? | `<PREENCHER — S21e>` | |

---

## 8. Lacunas, bloqueios e o que continua desconhecido

| `gap_id` | Descrição | Por que não resolvida | Fonte que resolve | Bloqueante |
|---|---|---|---|---|
| `<PREENCHER>` | | | | |

Permanece desconhecido mesmo após esta fase:

- se houve acesso não autorizado no passado (não há log de acesso a consultar);
- o conteúdo histórico dos backups gitignored em `bolao/*/backups/`;
- se algum backup existente é restaurável — isso é a Fase 3, não a Fase 1;
- se a PII removida em `1b09afa` foi indexada por terceiros antes da remoção.

Deliberadamente **não coletado** nesta fase, e portanto ainda desconhecido —
cada item só pode ser obtido por revisão dirigida a um objeto nomeado, com
justificativa registrada:

| Item | Onde estaria | Por que não saiu |
|---|---|---|
| Corpo de function | S12 | só `body_length_chars` + `body_md5` |
| `proconfig` completo | S12 | pode carregar settings da aplicação com dado/segredo |
| Texto de comando do `pg_cron` | S16 | pode conter URL com token; mascarar literais não basta |
| `setconfig` fora da whitelist | S19 | sai como `SETTING_PRESENT_REDACTED` |
| Comentários de objeto | S20b | texto livre humano; removido sem substituto |
| Labels de enum | S09 | só contagem + hash; a regex anterior aceitava nomes de pessoa |
| Definição de view | S07 | só comprimento + md5 |
| Defaults, CHECK, indexdef | S04/S05/S06 | flags estruturais + comprimento + hash |
| Nomes de secrets do Vault | S18 | só contagem; o nome pode ser sensível |
| Contagem exata de linhas | — | `EXACT_BUSINESS_RECONCILIATION = DEFERRED_TO_PHASE1B` |
| Grafo de dependências completo | S20a | S20a cobre só dependências de **view** (`pg_rewrite`) |
| **Expressões de policy** | S11 | removidas por inteiro; sanitizer imperfeito não é defesa em varredura ampla |
| Partition bounds | S03 | codificam valores de negócio; só comprimento e hash |
| Argumento e cláusula WHEN de trigger | S13 | só contagem e presença |
| Default de domain | S05b | texto livre de valor |

Objetos de catálogo **deliberadamente não coletados** nesta fase (runbook §4.16),
registrados como `evidence_gaps` e não como ausência:

| `gap_id` | Motivo |
|---|---|
| `EVENT_TRIGGERS` | fora do escopo; coletável no futuro sem corpo de function |
| `FDW_SERVER_METADATA` | **motivo de segurança**: `srvoptions`/`umoptions` podem conter credencial de conexão externa. `UNSAFE_TO_COLLECT_IN_BROAD_SCAN` |
| `DATABASE_LEVEL_ACL` | `pg_database.datacl` não expandido |
| `TYPE_DOMAIN_PRIVILEGES` | `pg_type.typacl` — S09 registra só `acl_is_default` |
| `REPLICATION_SLOTS` | avaliar relevância antes de incluir |

```
REDACTION_COUNT   = <PREENCHER — project ref, e-mails, settings fora da whitelist>
```

Os contadores de seção são **derivados** da tabela da seção 0, não campos a
preencher — ver "Summaries — DERIVADOS" lá.

---

## 9. O que esta fase **não** autoriza

Preencher este documento não autoriza nada além de si mesmo. Em particular:

- **Nenhum gate de backup é atendido por esta coleta.** A Fase 1 observa; não
  protege. G1–G8 continuam como estão em `PHASE0_BACKUP_GATES.md`.
- **Nenhuma decisão de arquitetura é tomada.** DEC-01 a DEC-10 permanecem
  abertas; esta coleta apenas as torna decidíveis.
- **Nenhuma correção é aplicada**, por mais óbvia que pareça um achado. Achado
  e correção são etapas separadas, e a correção depende de autorização própria.
- **Nenhuma migração**, nenhum DDL, nenhum backfill — os gates de backup
  continuam sendo bloqueador duro.

```
PHASE1_COLLECTION_COMPLETE = <PREENCHER — só true se NOT_RUN_SECTIONS estiver vazio>
READY_FOR_PHASE2           = <PREENCHER — false enquanto houver lacuna bloqueante>
```

> `PHASE1_COLLECTION_COMPLETE` é lido da seção 0, nunca do volume de resultados.
> Seções `BLOCKED` ou `SKIPPED_BY_PROBE` **não** impedem a completude — são
> resultado. Seções `NOT_RUN` impedem.
