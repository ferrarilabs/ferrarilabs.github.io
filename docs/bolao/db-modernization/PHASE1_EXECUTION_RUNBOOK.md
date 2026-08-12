# FASE 1 — Runbook de execução da coleta read-only

**Estado deste documento:** plano. **Nada aqui foi executado.**
`DATABASE_QUERIES_EXECUTED = 0` na Fase 1A.

Este runbook governa a execução futura de
`docs/bolao/db-modernization/PHASE1_READONLY_QUERY_PACK.sql`. Executar exige
autorização própria e explícita do Eduardo, separada da autorização que produziu
este pacote.

---

## 0. Pré-condições — todas obrigatórias

| # | Pré-condição | Como confirmar | Se falhar |
|---|---|---|---|
| 1 | Autorização explícita para executar contra produção | registro escrito, datado | **parar** |
| 2 | Baseline da Fase 0 protegido em commit | `git log --oneline -- docs/bolao/db-modernization/PHASE0_*.md` mostra o commit dos 7 documentos | **parar** — sem baseline não há contra o quê reconciliar |
| 3 | Hash do query pack conferido | `shasum -a 256` do `.sql` == `query_pack_sha256` planejado | **parar** — pacote adulterado ou desatualizado |
| 4 | Credencial de leitura administrativa disponível **fora do chat** | quem executa a possui | **parar** |
| 5 | Janela sem evento (sem rodada, sem sorteio, sem envio de e-mail em curso) | calendário dos quatro bolões | adiar |
| 6 | **Os quatro artefatos `PHASE1_*` tracked e commitados** | `git ls-files docs/bolao/db-modernization/PHASE1_*` lista os quatro | **parar** |
| 7 | **Árvore de trabalho limpa** | `git status --porcelain` retorna **vazio** | **parar** |
| 8 | **Janela sem migration e sem database deployment** | confirmação de quem opera | **parar** — ver §1.5 |

### Pré-condições 6 e 7 — por que hash de artefato untracked não prova nada

Um arquivo untracked pode ser editado entre o cálculo do hash e a execução sem
deixar qualquer rastro em git. Registrar `query_pack_sha256` de um arquivo que
não está sob controle de versão dá a **aparência** de proveniência sem a
substância. Por isso:

```bash
# 6 — os quatro precisam aparecer
git ls-files docs/bolao/db-modernization/PHASE1_EXECUTION_RUNBOOK.md \
             docs/bolao/db-modernization/PHASE1_LIVE_STATE_TEMPLATE.md \
             docs/bolao/db-modernization/PHASE1_READONLY_QUERY_PACK.sql \
             docs/bolao/db-modernization/PHASE1_RESULT_SCHEMA.json

# 7 — precisa sair VAZIO
git status --porcelain

# provenance a registrar (manifesto = os quatro hashes, ordem alfabética)
cd docs/bolao/db-modernization
shasum -a 256 PHASE1_EXECUTION_RUNBOOK.md PHASE1_LIVE_STATE_TEMPLATE.md \
              PHASE1_READONLY_QUERY_PACK.sql PHASE1_RESULT_SCHEMA.json \
  | tee /dev/stderr | shasum -a 256   # -> phase1_package_manifest_sha256
git rev-parse HEAD                     # -> phase1_artifact_commit
```

Campos correspondentes no schema, todos obrigatórios:
`phase1_artifact_commit`, `phase1_package_manifest_sha256`, `artifact_hashes`
(os quatro individuais, para localizar **qual** divergiu) e
`working_tree_clean_at_collection` (`const true`).

**Depois da execução**, reconferir o hash do query pack e registrar
`query_pack_sha256_verified_after` — que é `const: true` no schema. Não é
opcional e não pode ser `false`: sem a reconferência não há prova de que o
arquivo executado é o arquivo revisado.

> **Estado hoje:** os quatro artefatos estão **untracked**. Pré-condições 6 e 7
> não estão atendidas, e por isso `READY_FOR_PHASE1_LIVE_EXECUTION = NO`
> independentemente da autorização.

> **Pré-condição 2 — ATENDIDA.** Uma versão anterior deste runbook registrava
> que os sete documentos da Fase 0 estavam *untracked*. Isso não é mais verdade:
> eles estão protegidos pelo commit **`a1e40f1`** (`docs(db): establish
> zero-based modernization baseline`). Portanto
> `PHASE0_BASELINE_COMMITTED = YES`, e o SHA completo desse commit é o que deve
> ser preenchido em `phase0_baseline_commit` (`PHASE1_RESULT_SCHEMA.json`).
>
> As demais pré-condições continuam abertas — em especial a **1**, que é
> autorização própria e explícita, separada da que produziu este pacote. Logo
> `READY_FOR_PHASE1_LIVE_EXECUTION = NO`.

### Credenciais — regra absoluta

- Nenhuma credencial é fornecida por este documento.
- **Nenhuma credencial deve ser colada no chat**, em nenhuma hipótese: nem
  `service_role`, nem database password, nem connection string, nem API key.
- Quem executa usa a credencial no seu próprio ambiente e traz de volta
  **apenas as saídas sanitizadas**.
- Se alguma saída contiver credencial (ex.: uma connection string aparecendo num
  setting), ela é redigida **antes** de sair do ambiente de execução.

---

## 1. Contrato de execução

### 1.1 A transação — `ONE_READ_ONLY_TRANSACTION_PER_SECTION`

**Cada seção abre a sua própria transação.** Não existe uma transação única
cobrindo a coleta inteira. Toda seção executável é um bloco autocontido:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SHOW transaction_read_only;      -- deve ser 'on'
<SELECTs da seção>
ROLLBACK;
```

**Por que, e não uma transação única.** Em PostgreSQL, assim que um statement
falha dentro de uma transação, a transação inteira entra em estado *aborted*:
todo statement seguinte falha com `SQLSTATE 25P02` (*current transaction is
aborted, commands ignored until end of transaction block*) até que se execute
`ROLLBACK`. Com uma transação única, a primeira seção a receber um
`permission denied` — S15c e S18 são as candidatas óbvias — derrubaria **todas**
as seguintes. O runbook prometia isolamento de falha que o modelo transacional
não entregava. Este é o modelo que entrega.

`SAVEPOINT` / `ROLLBACK TO SAVEPOINT` resolveria o mesmo problema e **não foi
adotado**: manteria a sessão dentro de uma única transação durante a coleta
inteira, segurando snapshot e impedindo vacuum, sem ganho algum sobre abrir e
fechar uma transação por seção.

**Se `transaction_read_only` não retornar `on` em QUALQUER seção: executar
`ROLLBACK;` e ABORTAR imediatamente.** Não investigar de dentro da sessão, não
"rodar só a próxima seção para ver". Uma transação que deveria ser read-only e
não é constitui falha de contrato, e a coleta inteira fica inválida
(`read_only_confirmed = false` ⇒ coleta descartada). O PREFLIGHT prova apenas a
sua própria transação; cada seção prova a sua, e registra o resultado em
`section_results[].read_only_confirmed_for_section`.

Por que cada timeout:

| Setting | Valor | Razão |
|---|---|---|
| `statement_timeout` | `30s` | uma consulta de catálogo que passa disso está varrendo algo que não deveria |
| `lock_timeout` | `2s` | **o mais importante**: garante que a coleta nunca fique esperando lock e nunca vire a ponta de uma fila de bloqueio em produção |
| `idle_in_transaction_session_timeout` | `60s` | uma transação aberta segura snapshot e impede vacuum; se quem executa parar para almoçar, a sessão morre sozinha |

`SET LOCAL` é deliberado: o efeito morre com a transação, sem tocar
configuração de sessão nem de role.

### 1.1b O modelo de coleta — `TIME_BOUNDED_MULTI_TRANSACTION_OBSERVATION`

**Esta coleta NÃO é um snapshot atômico, e não pode ser descrita como tal.**

Uma transação por seção significa **37 snapshots independentes**, cada um com o
seu próprio ponto no tempo. Consequências, que precisam estar no relatório e não
só na cabeça de quem executa:

- duas seções vizinhas podem observar o catálogo em estados diferentes;
- se alguém aplicar uma migration no meio da janela, S03 pode listar uma tabela
  que S21a já não enxerga — e **nada no resultado denunciaria isso sozinho**;
- quanto mais longa a janela, maior o risco.

Mitigações obrigatórias:

| Medida | Campo |
|---|---|
| Executar em janela **sem migration e sem database deployment** | pré-condição 8 (§0) |
| Registrar o início da janela | `collection_started_at_utc` |
| Registrar o fim da janela | `collection_ended_at_utc` |
| Registrar o instante de **cada** seção | `section_results[].collected_at_utc` |
| Sinalizar qualquer indício de mudança de catálogo durante a coleta | `catalog_change_observed_during_collection` + warning `CATALOG_MAY_HAVE_CHANGED_DURING_COLLECTION` |

**A correção NÃO é voltar para uma transação longa.** Isso seguraria snapshot e
impediria vacuum em produção durante toda a coleta, e reintroduziria a
propagação de falha (§1.1). O modelo one-transaction-per-section continua
aprovado; o custo aceito é a não-atomicidade, e ela fica **declarada** em vez de
escondida.

### 1.2 Encerramento

**Toda seção termina em `ROLLBACK;`. Nunca `COMMIT;`.** A transação é read-only e
não há o que persistir — o `ROLLBACK` existe para garantir que nada ficou
pendente e que a sessão não permanece em idle-in-transaction. Não há bloco de
encerramento global: a última seção já encerrou a sua própria transação.

### 1.3 O que o pacote nunca faz

DDL · DML · `MERGE` · `TRUNCATE` · `CALL` · `COPY` · `CREATE TEMP` · `COMMIT` ·
criação de view/function/objeto persistente · escrita de arquivo no servidor ·
chamada de function da aplicação · leitura de tabela de participante · leitura
de segredo · leitura de object key de Storage · **free-text de metadata**
(`proconfig`, comando de `cron.job`, `setconfig` de role, comentários de objeto,
labels de enum).

**Sobre não chamar function da aplicação:** uma function pode ter efeito
colateral mesmo invocada dentro de um `SELECT`. `SELECT minha_funcao()` é uma
escrita em potencial. O pacote só invoca funções do core do PostgreSQL
(`pg_get_userbyid`, `pg_get_expr`, `pg_get_constraintdef`, `pg_get_indexdef`,
`pg_get_viewdef`, `pg_get_function_identity_arguments`,
`pg_total_relation_size`, `pg_relation_size`, `to_regclass`, `format_type`,
`aclexplode`, `acldefault`) e funções de string/agregação
(`regexp_replace`, `split_part`, `substr`, `string_agg`, `md5`, `length`,
`unnest`).

`obj_description` **foi removido** da lista de funções permitidas: comentário de
objeto é texto livre escrito por humano e não é seguro em varredura ampla.

### 1.4 Fontes permitidas

`pg_catalog` · `information_schema` · views administrativas conhecidas e
justificadas (`pg_policies`, `pg_publication_tables`, `pg_sequences` — esta
última não usada, ver S08) · tabelas de metadata de plataforma **quando a
consulta não extrai conteúdo de usuário** (`storage.buckets`, `cron.job`,
contagem em `vault.secrets`).

---

## 2. Ordem de execução

Rodar **seção a seção**, cada uma na sua própria transação read-only (§1.1),
salvando cada saída em arquivo separado. Não rodar o arquivo inteiro de uma vez:
cada saída precisa ser rastreável à sua seção, e o operador precisa ver o
resultado de cada `SHOW transaction_read_only`.

Esta é a **lista canônica de seções** — 37 no total (`PREFLIGHT` + 36). Está
congelada e espelhada em `$defs/section_id` do `PHASE1_RESULT_SCHEMA.json`, que
exige exatamente uma entrada por seção em `section_results`. Alterar o query pack
obriga a alterar **SQL, esta tabela, o enum, `minItems`/`maxItems`, as cláusulas
`allOf` e o template — no mesmo patch**.

| # | Seção | Conteúdo | Guarda |
|---|---|---|---|
| 0 | `PREFLIGHT` | prova de read-only | **aborta tudo se falhar** |
| 1 | `S01` | identidade do banco + `server_version_num` | — |
| 2 | `S02` | schemas + **`classification_basis`** | — |
| 3 | `S03` | relações, RLS bits, tamanho, estimativa, **topologia de partição** | — |
| 4 | `S04` | colunas; defaults como flags + length + hash | — |
| 5 | `S05` | constraints de relação + **topologia de colunas** | — |
| 6 | `S05b` | **constraints de DOMAIN** (`conrelid = 0`) | — |
| 7 | `S06` | índices + **topologia de colunas** (key / INCLUDE / `<EXPRESSION>`) | — |
| 8 | `S07` | views e matviews (hash da definição) | — |
| 9 | `S08` | sequences; ownership por **AUTO ou INTERNAL** | — |
| 10 | `S09` | types e enums (contagem + hash de labels) | — |
| 11 | `S10` | extensions | — |
| 12 | `S11` | policies — **sem nenhuma expressão** | — |
| 13 | `S11b` | RLS por relação — **fatos, não conclusão** | — |
| 14 | `S12` | functions (`security_definer`, `search_path`) | — |
| 15 | `S13` | triggers | — |
| 16 | `S14a` | grants de tabela (visão parcial) | — |
| 17 | `S14b` | grants de coluna (visão parcial) | — |
| 18 | `S14c` | grants de routine | — |
| 19 | `S14d` | grants de USAGE | — |
| 20 | `S14e` | roles (`SUPERUSER`, `BYPASSRLS`) | — |
| 21 | `S14f` | membership + **`inherit_option`, `set_option`** | **PG ≥ 16** |
| 22 | `S15a` | publications | — |
| 23 | `S15b` | tabelas das publications | — |
| 24 | `S15c` | subscriptions | pode dar permission denied |
| 25 | `S16` | pg_cron | **PROBE primeiro** |
| 26 | `S17` | Storage buckets | **PROBE primeiro** |
| 27 | `S18` | Vault (só contagem) | **PROBE primeiro** |
| 28 | `S19` | settings por role, whitelist estrita | — |
| 29 | `S20a` | dependências de VIEW (escopo limitado) | — |
| 30 | `S20b` | objetos sem extensão dona | — |
| 31 | `S21a` | CATALOG_ACL_EXPANSION — tabelas/views | — |
| 32 | `S21b` | CATALOG_ACL_EXPANSION — sequences | — |
| 33 | `S21c` | CATALOG_ACL_EXPANSION — schemas | — |
| 34 | `S21d` | CATALOG_ACL_EXPANSION — functions | — |
| 35 | `S21e` | **default privileges** (`pg_default_acl`) | — |
| 36 | `S21f` | **COLUMN ACL** (`pg_attribute.attacl`) | — |

Não há linha de "encerramento": cada seção já encerrou a sua transação com
`ROLLBACK`.

> **S14f exige PostgreSQL ≥ 16.** `inherit_option` e `set_option` só existem em
> `pg_auth_members` a partir da 16. Em 15 ou anterior a consulta falha —
> registrar `BLOCKED` com `failure_type = SYNTAX_UNSUPPORTED_VERSION` e o
> warning `SERVER_VERSION_BELOW_16_ROLE_OPTIONS_UNAVAILABLE`. Conferir
> `server_version_num` (S01) antes. **Não** substituir por uma versão degradada
> em silêncio.

### S21 é `CATALOG_ACL_EXPANSION`, e não "effective ACL"

O nome importa. S21 **não calcula privilégio efetivo**. O que ela faz é enumerar,
a partir do catálogo:

- o ACL explícito do objeto;
- o `acldefault()` hard-wired, quando o ACL é `NULL`;
- a entrada `PUBLIC` (`grantee = 0`);
- a role nomeada de cada entrada.

Privilégio **efetivo** depende ainda de:

| Fator | Onde |
|---|---|
| role membership e herança (`inherit_option`, `set_option`) | S14f |
| atributos de role (`SUPERUSER`, `BYPASSRLS`) | S14e |
| RLS por relação | S11b |
| `USAGE` no schema (sem ele o grant de tabela não é exercitável) | S21c |
| ACL de coluna (mais específico que o de tabela) | S21f |

A derivação final acontece no relatório, cruzando essas seções. **S14 e S21 são
evidência para a derivação, não a derivação.**

### Por que S21 existe, se S14 já lista grants

`information_schema.role_table_grants`, `role_routine_grants`,
`column_privileges` e `role_usage_grants` são **visões parciais**: mostram apenas
privilégios cujo grantor ou grantee esteja entre as *currently enabled roles* da
sessão, e não expõem de forma confiável o que foi concedido a **`PUBLIC`**. Pior:
quando o ACL de um objeto é `NULL`, essas views não mostram o **ACL padrão** que
o PostgreSQL aplica — e o padrão de uma function é `EXECUTE` para `PUBLIC`.

S21 lê o ACL direto do catálogo (`relacl`, `nspacl`, `proacl`, `defaclacl`,
`attacl`) e o expande com `aclexplode(COALESCE(<acl>, acldefault(...)))`. S14
fica como visão cruzada; divergência entre as duas é achado, registrado como
`INFORMATION_SCHEMA_GRANTS_DIVERGE_FROM_CATALOG_ACL`.

Achados nominais a derivar e registrar explicitamente:

| Achado | Origem |
|---|---|
| `PUBLIC_TABLE_PRIVILEGES` | S21a onde `is_public` |
| `PUBLIC_FUNCTION_EXECUTE` | S21d onde `is_public` e `privilege = EXECUTE` |
| `PUBLIC_SCHEMA_USAGE` | S21c onde `is_public` e `privilege = USAGE` |
| `DEFAULT_PRIVILEGES` | S21e, incluindo os que concedem a `PUBLIC` |
| `COLUMN_ACL` | S21f — uma tabela pode não ter grant nenhum e ainda ter uma **coluna** exposta |

Nenhuma consulta de S21 lê senha nem valor de coluna. `pg_authid` e
`rolpassword` não aparecem no pacote e não devem ser acrescentados.

### Topologia de schema — o que passou a sair

Nome de coluna é **metadata de schema**, não conteúdo, e a sua ausência tornava
o inventário inutilizável para decidir qualquer coisa. Passou a sair:

| Seção | Topologia |
|---|---|
| `S05` | `constrained_columns` e `referenced_columns` **na ordem** — uma PK `(a,b)` não é `(b,a)`, e uma FK só é interpretável sabendo qual coluna aponta para qual |
| `S06` | `key_column_names` e `included_column_names` separados; slot de expressão sai como o literal `<EXPRESSION>` |
| `S03` | `partition_parent_*`, `partition_strategy`, `partition_key_column_names` |

O que continua **não** saindo: texto de `CHECK`, de predicado de índice, de
definição de view, e **partition bound** — bounds codificam valores de negócio
(faixas de data, listas de chave) e saem só como comprimento e hash.

### Escopo de S20a

S20a percorre `pg_depend` a partir de `pg_rewrite` — ou seja, cobre dependências
criadas por regras de reescrita: **views e materialized views** sobre as relações
que consultam. **Não é um grafo de dependências completo**: não cobre foreign
keys, `trigger → function`, `default → sequence`, dependências de tipo/domínio/
operador, nem `policy → function`. Por isso a seção se chama *dependências de
view*. Ampliar com segurança é trabalho da Fase 1B.

### Seções guardadas

S16, S17 e S18 dependem de objetos que podem não existir. Probe e consulta ficam
na **mesma transação** da seção. O probe usa `to_regclass(...)`, que retorna
`NULL` quando o objeto está ausente.

- Probe retornou `NULL` → executar o `ROLLBACK` da seção, registrar status
  `SKIPPED_BY_PROBE` + `CONFIRMED_ABSENT` para aquele subsistema, e **não** rodar
  a consulta seguinte.
- Probe retornou valor → rodar a consulta seguinte, e então `ROLLBACK`.

Não envolver em `DO $$ ... $$` nem em plpgsql para "automatizar" o desvio: bloco
anônimo é execução de código, e sai do contrato.

### Quando uma seção falha — isolamento de falha

Falha de permissão é **resultado**, não erro de operação. O procedimento é
mecânico e não admite atalho:

1. **`ROLLBACK;`** — obrigatório e imediato. Sem ele a sessão fica em transação
   *aborted* e **toda** consulta seguinte falha com `25P02`, independentemente de
   ter permissão ou não. É o passo que o desenho anterior não tinha.
2. Registrar `BLOCKED` e **os detalhes da falha no próprio `section_result`**:
   `failure_type`, `required_permission` quando for `PERMISSION_DENIED`,
   `error_message_sanitized` quando houver, `rolled_back = true`,
   `collected_at_utc` e `read_only_confirmed_for_section = true`. Não existe
   `collection_failures` nem `blocked_sections` — os agregados são calculados
   depois, a partir de `section_results`.
3. Abrir uma **nova** `BEGIN READ ONLY` para a seção seguinte, com os mesmos
   `SET LOCAL`, e reconferir `SHOW transaction_read_only`.

Nenhuma seção depende de transação anterior. Uma coleta com seções bloqueadas é
uma coleta válida e incompleta — o que é muito melhor que uma coleta que fingiu
completude.

### Completude: `section_results` é a ÚNICA fonte de verdade

`section_results` é **obrigatório** e precisa conter **exatamente uma** entrada
para cada uma das 37 seções da tabela acima — inclusive as que não rodaram, que
aparecem com status `NOT_RUN`.

**Não existem summaries persistidos.** `collected_sections`, `blocked_sections`,
`skipped_sections` e `not_run_sections` foram **removidos** do JSON canônico:
eram uma segunda fonte da mesma informação, e uma segunda fonte é uma fonte que
pode contradizer a primeira — o schema aceitava, por exemplo, todas as seções
`NOT_RUN` e um summary alegando que tudo fora coletado. O relatório Markdown
**calcula** esses agregados a partir de `section_results`; nada os persiste.

**`collection_failures` também foi removido** pelo mesmo motivo: era uma lista
paralela de falhas que podia contradizer o `status` registrado em
`section_results`. Todo o detalhe da falha — `failure_type`,
`required_permission`, `error_message_sanitized`, `rolled_back` — mora agora no
**próprio `section_result`** da seção bloqueada. `BLOCKED_SECTIONS`, a tabela
de falhas e as contagens de falha do relatório são **derivadas** dele. Nenhuma
segunda estrutura é persistida.

**A propriedade `state` foi removida de `section_result`** (§5.2, teste 22):
`section_result` representa a **execução** da seção, não o estado operacional
de um objeto. Para uma seção `BLOCKED`, `status = BLOCKED` é a única verdade
persistida — `COLLECTION_BLOCKED` pode ser **derivado** disso no relatório ou
no template, quando útil para apresentação, mas nunca é persistido dentro do
`section_result`. `production_state` (incluindo `CONFIRMED_IN_USE`) continua
existindo apenas nos objetos de inventário apropriados (`row_estimates`,
`inventory_bucket.items`, etc.), sujeitos a `confirmed_in_use_requires_evidence`.

O que cada status **exige** (imposto pelo schema, não por convenção):

| Status | Campos obrigatórios |
|---|---|
| `COLLECTED` | `read_only_confirmed_for_section = true` · `row_count_returned` · `output_artifact` · `output_sha256` · `collected_at_utc` |
| `SKIPPED_BY_PROBE` | `read_only_confirmed_for_section = true` · `probe_result = OBJECT_ABSENT` · `rolled_back = true` · `collected_at_utc` |
| `BLOCKED` | `read_only_confirmed_for_section = true` · `rolled_back = true` · `failure_type` · `required_permission` quando `failure_type = PERMISSION_DENIED` · `error_message_sanitized` quando houver · `collected_at_utc` |
| `NOT_RUN` | **proibido** carregar `read_only_confirmed_for_section`, `rolled_back`, `row_count_returned`, `output_artifact` ou `output_sha256` — não houve transação, e não pode fingir que houve |

**`PREFLIGHT` é caso especial e não-negociável:** precisa existir, com
`status = COLLECTED` e `read_only_confirmed_for_section = true`. Sem isso não há
prova de que a sessão era read-only, e **a instância inteira é inválida**.

> Uma coleta pode ser incompleta. O que ela **não pode** ser é silenciosamente
> incompleta. `object_inventories` vazio não significa "coletou tudo e não achou
> nada" — a completude se lê em `section_results`, e em nenhum outro lugar.

### `CONFIRMED_IN_USE` exige evidência anexada

Nenhum objeto pode receber `production_state = CONFIRMED_IN_USE` sem um objeto
`operational_evidence` junto, com `source_type`, `observed_at_utc` e
`evidence_reference_sanitized`. O schema impõe isso onde quer que
`production_state` apareça.

`source_type` ∈ `LIVE_APPLICATION_OBSERVATION` · `RECENT_CORRELATED_WRITE` ·
`WORKFLOW_EXECUTION` · `EDGE_FUNCTION_EXECUTION` · `ADMIN_TELEMETRY` ·
`OWNER_CONFIRMATION_WITH_SUPPORTING_EVIDENCE`.

**O catálogo nunca pode preencher esse objeto** — nenhuma dessas fontes é
derivável de `pg_catalog`, de `information_schema` ou de estimativa de linha.
`evidence_reference_sanitized` é referência (id de run, data de log, nome de
dashboard), nunca linha de log crua, payload, IP ou e-mail.

---

## 3. Sanitização das saídas

### 3.1 O que a redação do SQL **não** garante

O padrão usado no pacote —
`regexp_replace(<expr>, '''[^'']*''', '<REDACTED_LITERAL>', 'g')` —
**não é um sanitizer universal**. Ele não trata:

- dollar-quoting (`$$...$$`, `$tag$...$tag$`);
- aspas simples duplicadas dentro do próprio literal (`''` escapado);
- identificadores entre **aspas duplas** que contenham dado real;
- literais montados por concatenação (`||`, `format()`);
- números, UUIDs e e-mails que não estejam entre aspas.

**Nunca declarar "safe because literals were removed".** Essa frase não é uma
conclusão válida em nenhum ponto desta coleta.

### 3.2 Por isso: NENHUMA expressão sai

Para **todo** inventário amplo o padrão é
`STRUCTURAL_FLAGS` + `LENGTH` + `HASH` (+ topologia de colunas, quando houver).
Nenhuma seção do pacote retorna expressão:

| Seção | O que sai |
|---|---|
| S04 defaults | flags + length + md5 |
| S05 constraints | topologia de colunas + flags + length + md5 |
| S05b domain constraints | flags + length + md5 |
| S06 índices | topologia de colunas (com `<EXPRESSION>`) + flags + length + md5 |
| S07 views | length + md5 |
| S03 partition bounds | length + md5 |
| **S11 policy quals** | **flags + length + md5 — a expressão NÃO sai** |

### 3.3 A exceção de S11 foi ELIMINADA

Uma versão anterior deste runbook abria uma exceção para S11 (`qual` e
`with_check` sanitizados + "segunda camada de redaction" no ambiente de
execução). **Essa exceção foi removida**, e a segunda camada deixou de existir
como mecanismo de segurança.

Motivo: a defesa dependia de um sanitizer que o próprio §3.1 declara
insuficiente, mais um passo manual que ninguém consegue auditar depois. Numa
varredura ampla, sobre um banco que carrega PII de participante, isso é apostar
o dado numa etapa que não deixa prova. Fatos estruturais respondem às perguntas
da fase — "esta policy é incondicional?", "ela se apoia em `auth.uid()`?", "ela
embute literais?" — sem carregar o risco.

Policy cuja **semântica** precise ser analisada recebe
`directed_review_required = true` (`DIRECTED_POLICY_REVIEW_REQUIRED`) e é lida
individualmente em etapa separada e autorizada.

Invariantes verificáveis no resultado, ambas obrigatórias e `const 0`:

```
RAW_POLICY_EXPRESSIONS                = 0
PARTIALLY_REDACTED_POLICY_EXPRESSIONS = 0
```

### 3.4 Regras gerais

| Regra | Aplicação |
|---|---|
| Expressões (qualquer seção) | **não saem** — flags + length + hash |
| Nome de coluna / topologia | metadata de schema, **sai** |
| Partition bound | **não sai** — length + hash |
| Project ref | substituir por `<KNOWN_PROJECT_REF>` |
| E-mails | substituir por `<ADMIN_EMAIL_ALLOWLISTED>` ou `<REDACTED_EMAIL>` |
| Connection strings | redigir integralmente, e reportar como achado |
| Qualquer token/JWT/chave | redigir integralmente, e reportar como achado |
| Nome de participante | não deveria aparecer; se aparecer, é achado P0-CANDIDATE |
| Free-text de metadata | **não coletado por construção** — ver §3.5 |

Contar cada redação aplicada e registrar em `redaction_count`. Com as expressões
inteiramente fora do escopo, esta contagem cobre sobretudo project ref, e-mails
e nomes de setting fora da whitelist de S19.

### 3.5 Free-text de metadata — não coletado

Fontes de texto livre **removidas** do pacote por não admitirem sanitização
confiável em varredura ampla:

| Fonte | Antes | Agora |
|---|---|---|
| `pg_proc.proconfig` (S12) | `proconfig::text` inteiro | `has_proconfig` + apenas o item `search_path=` |
| `cron.job.command` (S16) | `command_masked` | `command_length_chars`, `command_md5`, `command_class` ∈ {`HTTP`,`SQL`,`FUNCTION`,`UNKNOWN`} |
| `pg_db_role_setting.setconfig` (S19) | string inteira sanitizada | um item por linha, whitelist de 4 nomes; o resto vira `SETTING_PRESENT_REDACTED` sem valor |
| `obj_description` (S20b) | comentário do objeto | **removido, sem substituto** |
| **policy `qual` / `with_check` (S11)** | **expressão sanitizada** | **removida — flags + length + hash** |
| `pg_trigger.tgargs` / `tgqual` (S13) | — | só `trigger_argument_count` e `has_when_clause` |
| `pg_class.relpartbound` (S03) | — | só comprimento e hash |
| `pg_type.typdefault` (S05b) | — | não lido |

E os **labels de enum** (S09) também deixaram de sair. A guarda anterior liberava
labels que casassem com `^[A-Za-z][A-Za-z0-9_-]{0,60}$` — regex que aceita
`Eduardo`, `Marcelo`, qualquer nome de pessoa. Isso **não é** proteção contra
PII. Saem apenas `enum_label_count` e `enum_labels_md5`.

Em todos esses casos, se um valor específico for necessário para uma decisão,
ele só pode ser coletado por **revisão dirigida** a um objeto nomeado, em etapa
separada, com justificativa registrada — nunca em varredura ampla.

---

## 4. Evidência administrativa **não** disponível via SQL

Nada nesta seção foi acessado. Nenhuma destas fontes deve ser tocada agora.

Legenda de campos: `SOURCE` · `REQUIRED_PERMISSION` ·
`SENSITIVE_FIELDS_TO_EXCLUDE` · `EVIDENCE_FORMAT` · `MANUAL_OR_AUTOMATED` ·
`BLOCKING_OR_OPTIONAL`.

### 4.1 Metadata do projeto Supabase

- **SOURCE:** Dashboard → Settings → General / Infrastructure
- **REQUIRED_PERMISSION:** Owner ou Administrator da organização
- **SENSITIVE_FIELDS_TO_EXCLUDE:** project ref completo (mascarar), API keys, JWT secret, database password
- **EVIDENCE_FORMAT:** screenshot sanitizado + anotação datada
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** blocking — define o escopo (resolve Q13)

### 4.2 Backups gerenciados

- **SOURCE:** Dashboard → Database → Backups
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** URLs de download de backup, tokens
- **EVIDENCE_FORMAT:** screenshot + tabela datada (frequência, retenção, último backup com sucesso)
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** **blocking — gate G1** (`PHASE0_BACKUP_GATES.md`)

### 4.3 Point-in-Time Recovery

- **SOURCE:** Dashboard → Database → Backups → PITR; Settings → Billing (plano)
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** dados de cobrança
- **EVIDENCE_FORMAT:** habilitado sim/não + janela de retenção + plano, datado
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** **blocking — gate G1**

### 4.4 Edge Functions

- **SOURCE:** Dashboard → Edge Functions; ou `supabase functions list` (CLI, **somente leitura**)
- **REQUIRED_PERMISSION:** Developer ou superior
- **SENSITIVE_FIELDS_TO_EXCLUDE:** código-fonte com segredo embutido, variáveis de ambiente
- **EVIDENCE_FORMAT:** lista de nome, slug, status, verify_jwt
- **MANUAL_OR_AUTOMATED:** manual (CLI aceitável se comprovadamente read-only)
- **BLOCKING_OR_OPTIONAL:** blocking — decide DEC-03 (se já existe superfície de execução server-side, a opção A muda de custo)

### 4.5 Versões de deployment das functions

- **SOURCE:** Dashboard → Edge Functions → *função* → Details
- **REQUIRED_PERMISSION:** Developer ou superior
- **SENSITIVE_FIELDS_TO_EXCLUDE:** payloads de log
- **EVIDENCE_FORMAT:** versão, updated_at, entrypoint por função
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** optional

### 4.6 Secrets de function — **somente nome e existência**

- **SOURCE:** Dashboard → Edge Functions → Secrets; ou `supabase secrets list`
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** **o valor, sempre e sem exceção**
- **EVIDENCE_FORMAT:** lista de nomes + `updated_at`. Nada mais
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** blocking — resolve `SECRET_EXISTENCE`

### 4.7 Database Webhooks

- **SOURCE:** Dashboard → Database → Webhooks
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** headers de autorização, URLs com token embutido
- **EVIDENCE_FORMAT:** nome, tabela, eventos, host de destino (**sem path com token**)
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** blocking — webhook é escrita disparada por dado, e não aparece no SQL versionado

### 4.8 Configuração de Storage

- **SOURCE:** Dashboard → Storage → Configuration / Policies
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** object keys, nomes de arquivo, signed URLs, conteúdo
- **EVIDENCE_FORMAT:** por bucket: público sim/não, limites, contagem de policies
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** optional — a menos que S17 revele bucket público

### 4.9 Schemas expostos pela API

- **SOURCE:** Dashboard → Settings → API → Exposed schemas
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** **anon key, service_role key, JWT secret** — a mesma página os exibe
- **EVIDENCE_FORMAT:** lista de schemas expostos + `db_extra_search_path`, transcrita à mão. **Screenshot desta página é desaconselhado** — captura as chaves junto
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** blocking — é a superfície real de exposição (Q12)

### 4.10 Configuração de Auth

- **SOURCE:** Dashboard → Authentication → Providers / Settings / Users
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** client secrets de OAuth, SMTP password, JWT secret, e **a lista de usuários** (é PII)
- **EVIDENCE_FORMAT:** providers habilitados (só nomes) + **contagem** de usuários. Nunca a lista
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** blocking — Q14 decide DEC-03 e a viabilidade do modelo 3

### 4.11 Domínios customizados

- **SOURCE:** Dashboard → Settings → Custom Domains
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** chaves privadas de certificado
- **EVIDENCE_FORMAT:** domínio configurado sim/não + hostname
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** optional

### 4.12 Scheduled functions (agendamento fora do pg_cron)

- **SOURCE:** Dashboard → Integrations → Cron; e `.github/workflows/` (já inventariado na Fase 0)
- **REQUIRED_PERMISSION:** Owner/Administrator
- **SENSITIVE_FIELDS_TO_EXCLUDE:** texto de comando com credencial
- **EVIDENCE_FORMAT:** nome, schedule, alvo, ativo sim/não
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** blocking — resolve D-08 (o agendamento do backup existe ou não)

### 4.13 Logs e telemetria — a única fonte de `CONFIRMED_IN_USE`

- **SOURCE:** Dashboard → Logs (API / Postgres / Edge Functions); GitHub Actions → histórico de execução
- **REQUIRED_PERMISSION:** Owner/Administrator (Supabase); leitura do repositório (Actions)
- **SENSITIVE_FIELDS_TO_EXCLUDE:** **payloads de request, IPs, e-mails, headers de autorização** — logs são densos em PII
- **EVIDENCE_FORMAT:** agregado apenas: "tabela X recebeu escrita nos últimos N dias", "workflow Y executou com sucesso em *data*". Nunca linhas de log cruas
- **MANUAL_OR_AUTOMATED:** manual
- **BLOCKING_OR_OPTIONAL:** blocking **para qualquer promoção a `CONFIRMED_IN_USE`**; optional para o resto do inventário

> Esta é a fonte que o SQL não consegue substituir. Catálogo prova presença;
> contagem prova volume; **só telemetria prova uso**. Sem 4.13, o resultado
> correto da Fase 1 é `PRESENT_USAGE_UNKNOWN` para praticamente tudo — e isso
> não é uma falha da coleta.

### 4.14 Metadata de GitHub Secrets — somente nome e `updated_at`

- **SOURCE:** GitHub → Settings → Secrets and variables → Actions; ou `gh secret list`
- **REQUIRED_PERMISSION:** admin do repositório
- **SENSITIVE_FIELDS_TO_EXCLUDE:** **o valor — que o GitHub nem expõe**
- **EVIDENCE_FORMAT:** nome + `updated_at`. Nada mais
- **MANUAL_OR_AUTOMATED:** `gh secret list` é read-only e aceitável
- **BLOCKING_OR_OPTIONAL:** blocking — resolve `SECRET_EXISTENCE` de `POWERBALL_PRIVATE_PARTICIPANT_DATA`

### 4.15 Verificação de deployment do site estático

- **SOURCE:** URLs públicas do GitHub Pages + `git show <commit>:<path>`
- **REQUIRED_PERMISSION:** nenhuma (conteúdo público)
- **SENSITIVE_FIELDS_TO_EXCLUDE:** não republicar conteúdo baixado; guardar **hash**, não corpo
- **EVIDENCE_FORMAT:** por artefato: URL, HTTP status, timestamp, hash live, hash do commit → `DEPLOYMENT_STATE`
- **MANUAL_OR_AUTOMATED:** automatizável (fetch + hash), sem credencial
- **BLOCKING_OR_OPTIONAL:** blocking — resolve `LIVE_SITE_PII` e `DEPLOYMENT_STATE` (`PHASE0_PII_MAP.md` §0)

> Este é o item mais barato da lista inteira e o único que não precisa de
> credencial nenhuma. Se algo desta seção puder ser feito primeiro, é este.

### 4.16 Objetos de catálogo **deliberadamente não coletados** nesta fase

Registrados como `evidence_gaps`, com `why_unresolved` explícito. Uma lacuna
registrada é resultado; uma lacuna silenciosa é defeito. **Nenhuma delas bloqueia
a primeira leitura**, desde que esteja registrada.

| `gap_id` | Fonte | Por que fora nesta fase | Futuro |
|---|---|---|---|
| `EVENT_TRIGGERS` | `pg_event_trigger` | não coletado nesta varredura | **coletável no futuro sem corpo de function** — nome, evento, enabled, owner |
| `FDW_SERVER_METADATA` | `pg_foreign_server`, `pg_user_mapping`, `pg_foreign_data_wrapper` | **`srvoptions` e `umoptions` PODEM CONTER CREDENCIAL** (host, user, password de conexão externa) | `UNSAFE_TO_COLLECT_IN_BROAD_SCAN` — só revisão dirigida, e **nunca** as options |
| `DATABASE_LEVEL_ACL` | `pg_database.datacl` | ACL de banco não expandido | ampliável com o mesmo padrão de S21 |
| `TYPE_DOMAIN_PRIVILEGES` | `pg_type.typacl` | S09 registra só `acl_is_default` | ampliável com o mesmo padrão de S21 |
| `REPLICATION_SLOTS` | `pg_replication_slots` | não consultado | avaliar relevância antes de incluir |

> **`FDW_SERVER_METADATA` é o único da lista com motivo de segurança, não de
> escopo.** Options de foreign server e de user mapping são um lugar clássico
> para credencial de conexão externa. Não incluir em varredura ampla, em nenhuma
> forma — nem "sanitizada".

---

## 5. Critério de invalidação da coleta

A coleta inteira é **inválida** — descartada, não corrigida — se qualquer uma
ocorrer:

- `transaction_read_only` ≠ `on` em **qualquer** transação de seção (não só no
  preflight);
- qualquer seção executada fora de uma transação `READ ONLY` própria;
- qualquer statement de DDL executado;
- qualquer statement de DML executado;
- qualquer function da aplicação chamada;
- qualquer `COMMIT`;
- qualquer leitura de conteúdo de tabela de participante;
- qualquer valor de secret lido;
- `query_pack_sha256` diferente entre plano e execução;
- **`query_pack_sha256_verified_after` ausente ou `false`** — sem a reconferência
  pós-execução não há prova de que o arquivo executado é o revisado;
- **`PREFLIGHT` ausente, `NOT_RUN`, `BLOCKED`, ou sem read-only confirmado**;
- **árvore de trabalho suja** ou artefato `PHASE1_*` untracked na coleta;
- qualquer expressão de policy registrada, ainda que parcialmente redigida;
- **qualquer artefato compartilhado sem o `SANITIZED_OUTPUT_EXIT_GATE` (§5.1)
  ter passado** — uma vez que o conteúdo saiu, não há como recolhê-lo.

Coleta inválida não vira `PHASE1_LIVE_STATE.md`. Registra-se o incidente e
recomeça-se.

**Não invalidam a coleta** (são resultado, e devem ser registrados como tal):
seção bloqueada por permissão, seção pulada por probe, seção `NOT_RUN`,
estimativas de linha defasadas, e divergência entre `origin/main` e o baseline
da Fase 0 — esta última é *provenance*, não gate.

---

## 5.1 `SANITIZED_OUTPUT_EXIT_GATE` — pré-condição de SAÍDA

Uma pré-condição de **saída**, não de execução: roda **localmente**, depois da
coleta e **antes** de qualquer artefato ser

- copiado,
- enviado,
- uploadado,
- colado em chat,
- anexado a issue ou PR.

A coleta pode ter sido impecável e ainda assim vazar na hora de compartilhar. É
esse o buraco que este gate fecha.

**Escopo:** TODOS os artefatos produzidos pela coleta — as saídas por seção, a
instância do `PHASE1_RESULT_SCHEMA.json` e o `PHASE1_LIVE_STATE.md`. Nenhum
arquivo fica de fora por parecer inócuo.

### O que bloqueia a saída

| Categoria | Contador |
|---|---|
| endereço de e-mail | `EMAIL_FINDINGS` |
| JWT | `JWT_FINDINGS` |
| connection string `postgres://` / `postgresql://` | `CONNECTION_STRING_FINDINGS` |
| marcador de private key (`BEGIN ... PRIVATE KEY`) | `PRIVATE_KEY_FINDINGS` |
| secret com forma de `service_role` / API key | `API_SECRET_FINDINGS` |
| project ref **não** mascarado | `UNMASKED_PROJECT_REF_FINDINGS` |
| referência de transação/pagamento conhecida | `PAYMENT_REFERENCE_FINDINGS` |
| nome de participante conhecido, quando a lista privada local estiver disponível | `PARTICIPANT_NAME_FINDINGS` |

### Regra do scanner — inegociável

O scanner **nunca imprime o valor encontrado**. Nem o trecho, nem uma forma
mascarada dele, nem contexto ao redor. Um scanner que ecoa o achado transforma o
seu próprio log num segundo vazamento, e o log costuma ser exatamente aquilo que
alguém cola em chat para pedir ajuda.

Saída permitida, e só ela:

```
CATEGORY   = <uma das oito acima>
COUNT      = <inteiro>
FILE       = <caminho do artefato>
LINE       = <número da linha, quando necessário para localizar>
```

A lista privada de nomes de participante e referências de pagamento usada na
varredura **não** entra em nenhum artefato e **não** é citada por caminho no
resultado do gate.

### Resultado exigido antes de compartilhar

```
EMAIL_FINDINGS                = 0
JWT_FINDINGS                  = 0
CONNECTION_STRING_FINDINGS    = 0
PRIVATE_KEY_FINDINGS          = 0
API_SECRET_FINDINGS           = 0
UNMASKED_PROJECT_REF_FINDINGS = 0
PAYMENT_REFERENCE_FINDINGS    = 0
PARTICIPANT_NAME_FINDINGS     = 0
```

Se **qualquer** contador for > 0:

```
OUTPUT_SHARE_ALLOWED = false
```

→ redigir **localmente** → **reexecutar o gate inteiro** → só então liberar a
saída. Não há liberação parcial: não se compartilha "o resto dos arquivos"
enquanto um deles estiver sujo.

Com os oito em zero, registrar na instância
`sanitized_output_exit_gate_passed = true` (obrigatório pelo schema),
`sanitization_gate_counts` com as **oito** categorias em `0` (obrigatório —
`{}` ou categoria ausente falha o schema: não prova que o gate rodou),
`sanitization_gate_completed_at_utc` (obrigatório) e
`sanitization_gate_scanner_sha256` (obrigatório — `sha256` de §5.1.1
efetivamente executado).

### 5.1.1 Implementação executável do gate

Script local, reproduzível, sem dependência externa além da stdlib do Python 3.
Roda **depois** da coleta, sobre o diretório de outputs, **antes** de qualquer
compartilhamento. Segue a regra do scanner (§5.1): nunca imprime o valor
encontrado, o trecho, uma forma mascarada dele, ou contexto ao redor — só
`CATEGORY`, `COUNT`, `FILE`, `LINE`.

```bash
cat > /tmp/phase1_sanitization_gate.py <<'PYEOF'
#!/usr/bin/env python3
"""SANITIZED_OUTPUT_EXIT_GATE — PHASE1_EXECUTION_RUNBOOK.md §5.1.1.
Nunca imprime o valor encontrado, o trecho, ou contexto. Só CATEGORY/COUNT/FILE/LINE.
"""
import hashlib
import os
import re
import sys

OUTPUT_DIR = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PHASE1_OUTPUT_DIR")
if not OUTPUT_DIR:
    print("PHASE1_OUTPUT_DIR não definido (argv[1] ou env var).", file=sys.stderr)
    print("OUTPUT_DIRECTORY_STATUS = NOT_PROVIDED")
    print("OUTPUT_SHARE_ALLOWED = false")
    sys.exit(2)

# FAIL CLOSED: diretório inexistente não pode render OUTPUT_SHARE_ALLOWED = true.
# Um scan de zero arquivos por diretório errado é indistinguível, no exit code, de um
# scan limpo — e é exatamente assim que um gate dá licença sem ter olhado nada.
if not os.path.isdir(OUTPUT_DIR):
    print(f"OUTPUT_DIRECTORY_STATUS = INVALID")
    print(f"OUTPUT_DIR = {OUTPUT_DIR}")  # já fornecido pelo operador; nenhum outro path
    print("OUTPUT_SHARE_ALLOWED = false")
    sys.exit(2)

OUTPUT_ROOT = os.path.realpath(OUTPUT_DIR)
MANIFEST_BASENAME = "PHASE1_OUTPUT_MANIFEST"

# Categorias com padrão fixo — não dependem de lista privada.
FIXED_PATTERNS = {
    "email_findings": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "jwt_findings": re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    "connection_string_findings": re.compile(r"postgres(?:ql)?://\S+"),
    "private_key_findings": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    # Só FORMAS DE SEGREDO. O literal nu `service_role` NÃO entra aqui: é um nome de
    # role, aparece legitimamente em saída de catálogo (pg_roles, ACLs, grants) e
    # marcá-lo como secret produz falso positivo em massa justamente nas seções que
    # esta coleta existe para ler. Uma service-role KEY só conta quando o VALOR tem
    # forma de segredo — ver o segundo ramo da alternância.
    "api_secret_findings": re.compile(
        r"\b(?:sb_secret_|sk_live_|sk_test_)[A-Za-z0-9_\-]{8,}\b"
        r"|service[_-]?role[_-]?key\s*[:=]\s*[\"']?[A-Za-z0-9_\-\.]{20,}"
    ),
    # project ref de 20 chars alfanuméricos minúsculos NÃO mascarado (sem
    # <KNOWN_PROJECT_REF> ao redor nem no formato primeiros4...ultimos4).
    # [a-z0-9], não [a-z]: o runbook sempre disse "alfanuméricos minúsculos", e um ref
    # com dígitos — que é o caso comum — passava batido pelo padrão só-letras.
    "unmasked_project_ref_findings": re.compile(
        r"(?<![A-Za-z0-9<])(?!<KNOWN_PROJECT_REF>)[a-z0-9]{20}(?![A-Za-z0-9>])"
    ),
}

# Categorias que dependem de lista privada local — nunca commitada, nunca no output.
PRIVATE_LIST_ENV = {
    "payment_reference_findings": "PHASE1_PRIVATE_PAYMENT_REFS_FILE",
    "participant_name_findings": "PHASE1_PRIVATE_PARTICIPANT_NAMES_FILE",
}

def load_private_terms(env_var):
    """-> (status, terms). Quatro estados; só AVAILABLE libera a saída.

    NOT_CONFIGURED    env var ausente/vazia
    NOT_AVAILABLE     env var aponta para arquivo que não existe
    EMPTY_OR_INVALID  arquivo existe mas não tem NENHUM termo válido
    AVAILABLE         >= 1 termo válido

    O caminho do arquivo e os termos NUNCA são impressos.
    """
    path = os.environ.get(env_var)
    if not path:
        return ("NOT_CONFIGURED", [])
    if not os.path.isfile(path):
        return ("NOT_AVAILABLE", [])
    terms = []
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                terms.append(line)
    if not terms:
        # Arquivo vazio (ou só comentários) não é lista: é ausência de lista com
        # aparência de presença. Marcar AVAILABLE aqui faria o gate reportar
        # count = 0 sem ter comparado contra termo algum.
        return ("EMPTY_OR_INVALID", [])
    return ("AVAILABLE", terms)

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def walk_actual_files(root):
    out = set()
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            out.add(os.path.realpath(os.path.join(dirpath, name)))
    return out

def resolve_manifest(manifest_path):
    """-> (status, [caminhos absolutos], erros). Rejeita tudo que não seja um
    caminho relativo, existente, e contido em OUTPUT_ROOT."""
    errors = []
    resolved = []
    seen = set()
    with open(manifest_path, "r", encoding="utf-8", errors="ignore") as fh:
        for lineno, raw in enumerate(fh, start=1):
            entry = raw.strip()
            if not entry or entry.startswith("#"):
                continue
            if os.path.isabs(entry) or entry.startswith("~"):
                errors.append((lineno, "ABSOLUTE_PATH"))
                continue
            if os.pardir in entry.replace("\\", "/").split("/"):
                errors.append((lineno, "PARENT_TRAVERSAL"))
                continue
            if entry in seen:
                errors.append((lineno, "DUPLICATE_PATH"))
                continue
            seen.add(entry)
            real = os.path.realpath(os.path.join(OUTPUT_ROOT, entry))
            # realpath já resolveu symlinks: containment testado no caminho REAL,
            # então um symlink apontando para fora do OUTPUT_DIR é rejeitado aqui.
            if os.path.commonpath([real, OUTPUT_ROOT]) != OUTPUT_ROOT or real == OUTPUT_ROOT:
                errors.append((lineno, "ESCAPES_OUTPUT_DIR"))
                continue
            if not os.path.isfile(real):
                errors.append((lineno, "MISSING_FILE"))
                continue
            resolved.append(real)
    return ("VALID" if not errors else "INVALID", resolved, errors)

def main():
    counts = {k: 0 for k in list(FIXED_PATTERNS) + list(PRIVATE_LIST_ENV)}
    findings = []  # (category, file, line) — NUNCA o valor casado
    private_status = {}
    blocked = False

    print("OUTPUT_DIRECTORY_STATUS = VALID")

    private_patterns = {}
    for category, env_var in PRIVATE_LIST_ENV.items():
        status, terms = load_private_terms(env_var)
        private_status[category] = status
        if status != "AVAILABLE":
            continue
        if category == "participant_name_findings":
            # Case-insensitive, com borda de palavra: "alice smith" precisa casar com
            # "Alice Smith", e "Ana" não pode casar dentro de "Ananias".
            alt = "|".join(re.escape(t) for t in terms)
            private_patterns[category] = re.compile(
                r"(?<!\w)(?:" + alt + r")(?!\w)", re.IGNORECASE
            )
        else:
            # payment_reference_findings: exact, case-sensitive — o identificador de
            # transação (Zelle/Venmo/CashApp) é emitido com caixa fixa, e afrouxar
            # aqui só aumentaria falso positivo sem cobrir nenhum caso real.
            private_patterns[category] = re.compile(
                "|".join(re.escape(t) for t in terms)
            )

    # --- conjunto de arquivos a escanear: o MANIFEST manda ---------------------
    manifest_path = os.environ.get("PHASE1_OUTPUT_MANIFEST") or os.path.join(
        OUTPUT_ROOT, MANIFEST_BASENAME
    )
    actual = walk_actual_files(OUTPUT_ROOT)
    manifest_real = os.path.realpath(manifest_path)

    if not os.path.isfile(manifest_path):
        print("OUTPUT_MANIFEST_STATUS = MISSING")
        print(f"EXPECTED_FILE_COUNT = 0")
        print(f"SCANNED_FILE_COUNT = 0")
        print(f"ACTUAL_FILE_COUNT = {len(actual)}")
        # Diretório vazio OU manifest ausente: nos dois casos não há como provar que
        # o scan cobriu os outputs da coleta. Fail closed, sem exceção.
        print("OUTPUT_SHARE_ALLOWED = false")
        sys.exit(2)

    print("OUTPUT_MANIFEST_STATUS = PRESENT")
    print(f"OUTPUT_MANIFEST_SHA256 = {sha256_file(manifest_path)}")

    manifest_status, files, manifest_errors = resolve_manifest(manifest_path)
    for lineno, reason in manifest_errors:
        print(f"MANIFEST_REJECTED_ENTRY_LINE = {lineno}")
        print(f"MANIFEST_REJECT_REASON       = {reason}")

    expected_count = len(files)
    print(f"OUTPUT_MANIFEST_VALIDATION = {manifest_status}")
    print(f"EXPECTED_FILE_COUNT = {expected_count}")

    if manifest_status != "VALID":
        blocked = True

    # Nenhum output produzido pode ficar fora do scan: todo arquivo realmente presente
    # no OUTPUT_DIR (exceto o próprio manifest) precisa estar listado.
    unlisted = actual - set(files) - {manifest_real}
    if unlisted:
        print(f"UNLISTED_OUTPUT_FILE_COUNT = {len(unlisted)}")
        blocked = True

    if expected_count == 0:
        # Diretório válido porém vazio (ou manifest sem entradas úteis).
        print("SCANNED_FILE_COUNT = 0")
        print("OUTPUT_SHARE_ALLOWED = false")
        sys.exit(2)

    for path in files:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                for lineno, line in enumerate(fh, start=1):
                    for category, pattern in FIXED_PATTERNS.items():
                        if pattern.search(line):
                            counts[category] += 1
                            findings.append((category, path, lineno))
                    for category, pattern in private_patterns.items():
                        if pattern.search(line):
                            counts[category] += 1
                            findings.append((category, path, lineno))
        except IsADirectoryError:
            continue

    for category in findings:
        cat, path, lineno = category
        print(f"CATEGORY = {cat}")
        print(f"COUNT    = 1")
        print(f"FILE     = {path}")
        print(f"LINE     = {lineno}")
        print("---")

    print("== SUMMARY ==")
    output_share_allowed = not blocked

    scanned_count = len(files)
    print(f"SCANNED_FILE_COUNT = {scanned_count}")
    if scanned_count != expected_count:
        print("FILE_COUNT_MATCH = false")
        output_share_allowed = False
    else:
        print("FILE_COUNT_MATCH = true")

    for category in list(FIXED_PATTERNS) + list(PRIVATE_LIST_ENV):
        print(f"{category.upper()} = {counts[category]}")
        if counts[category] > 0:
            output_share_allowed = False

    for category, status in private_status.items():
        print(f"PRIVATE_TERM_LIST_STATUS[{category}] = {status}")
        if status != "AVAILABLE":
            # Lista requerida indisponível, não configurada ou vazia: o gate NÃO pode
            # silenciosamente marcar 0. count = 0 sem lista não é ausência de achado,
            # é ausência de busca.
            output_share_allowed = False
            print(f"OUTPUT_SHARE_ALLOWED[{category}] = false")

    print(f"OUTPUT_SHARE_ALLOWED = {'true' if output_share_allowed else 'false'}")

    sys.exit(0 if output_share_allowed else 1)

if __name__ == "__main__":
    main()
PYEOF

shasum -a 256 /tmp/phase1_sanitization_gate.py   # -> sanitization_gate_scanner_sha256

# Listas privadas — OBRIGATÓRIAS e NÃO VAZIAS. NUNCA no repo, NUNCA no
# output/log/JSON. Uma entrada por linha, caminho fora do repositório:
export PHASE1_PRIVATE_PARTICIPANT_NAMES_FILE=/path/fora/do/repo/participant_names.txt
export PHASE1_PRIVATE_PAYMENT_REFS_FILE=/path/fora/do/repo/payment_refs.txt

# Manifest dos outputs da coleta — um caminho RELATIVO ao OUTPUT_DIR por linha,
# sem PII, sem path absoluto, sem `..`. Default: <OUTPUT_DIR>/PHASE1_OUTPUT_MANIFEST
export PHASE1_OUTPUT_MANIFEST=/path/para/os/outputs/da/coleta/PHASE1_OUTPUT_MANIFEST

python3 /tmp/phase1_sanitization_gate.py /path/para/os/outputs/da/coleta
echo "exit code: $?"
```

Contrato do script, ponto a ponto:

- recebe o diretório de outputs por `argv[1]` ou `PHASE1_OUTPUT_DIR`; se não for
  fornecido, ou **não for um diretório existente**, imprime
  `OUTPUT_DIRECTORY_STATUS = NOT_PROVIDED|INVALID`, `OUTPUT_SHARE_ALLOWED = false`
  e sai com `2` — **antes** de qualquer varredura. Um diretório inexistente
  produzia `exit 0`: zero arquivos varridos era indistinguível de zero achados;
- o conjunto varrido é o **manifest**, não "o que estiver lá": `PHASE1_OUTPUT_MANIFEST`
  (ou `<OUTPUT_DIR>/PHASE1_OUTPUT_MANIFEST`), um caminho relativo por linha. Cada
  entrada é resolvida com `realpath` e precisa (a) não ser absoluta, (b) não conter
  `..`, (c) não ser duplicata, (d) permanecer **dentro** do `OUTPUT_DIR` depois da
  resolução — o que rejeita symlink escape —, (e) existir e ser arquivo. Qualquer
  rejeição imprime `MANIFEST_REJECTED_ENTRY_LINE` + `MANIFEST_REJECT_REASON`
  (`ABSOLUTE_PATH` / `PARENT_TRAVERSAL` / `DUPLICATE_PATH` / `ESCAPES_OUTPUT_DIR` /
  `MISSING_FILE`) e bloqueia a saída;
- manifest **ausente** com a coleta tendo produzido outputs → `OUTPUT_SHARE_ALLOWED
  = false`, `exit 2`. E todo arquivo realmente presente no `OUTPUT_DIR` que **não**
  esteja no manifest é contado em `UNLISTED_OUTPUT_FILE_COUNT` e também bloqueia:
  nenhum output produzido pode ficar fora do scan;
- `EXPECTED_FILE_COUNT` (entradas válidas do manifest) e `SCANNED_FILE_COUNT`
  (arquivos efetivamente lidos) são **sempre** impressos e precisam ser iguais
  (`FILE_COUNT_MATCH`). `SCANNED_FILE_COUNT = 0` — diretório válido porém vazio —
  é falha, `exit 2`. Antes, um diretório vazio liberava a saída;
- detecta as oito categorias: seis por padrão fixo, duas —
  `payment_reference_findings` e `participant_name_findings` — por lista
  privada local carregada de fora do repositório via variável de ambiente;
- nunca imprime o valor casado, o trecho da linha, ou contexto — só
  `CATEGORY`/`COUNT`/`FILE`/`LINE`, um achado por vez, mais um resumo agregado;
- `exit 0` **somente** se todos os contadores estiverem em zero, o manifest for
  válido e completo, `EXPECTED_FILE_COUNT == SCANNED_FILE_COUNT ≥ 1` **e** as duas
  listas privadas estiverem `AVAILABLE`; `exit 1` (achados) ou `exit 2` (falha
  estrutural) caso contrário;
- `PRIVATE_TERM_LIST_STATUS` tem **quatro** estados por categoria:
  `NOT_CONFIGURED` (env var ausente), `NOT_AVAILABLE` (arquivo não existe),
  `EMPTY_OR_INVALID` (arquivo existe mas não contém nenhum termo válido) e
  `AVAILABLE` (≥ 1 termo). **Só `AVAILABLE` permite continuar** — os outros três
  forçam `OUTPUT_SHARE_ALLOWED = false`. Um arquivo vazio marcado como
  `AVAILABLE` produzia `count = 0` sem ter comparado contra termo nenhum:
  ausência de busca reportada como ausência de achado;
- `participant_name_findings` casa **case-insensitive** e com borda de palavra
  (`alice smith` casa com `Alice Smith`; `Ana` não casa dentro de `Ananias`).
  `payment_reference_findings` permanece **exato e case-sensitive**, decisão
  deliberada: o identificador de transação (Zelle/Venmo/CashApp) é emitido com
  caixa fixa, e afrouxar só aumentaria falso positivo sem cobrir caso real;
- o literal nu `service_role` **não** conta como `api_secret_findings`. É um nome
  de role e aparece legitimamente na saída de catálogo das seções de ACL/grants —
  marcá-lo como segredo geraria falso positivo em massa justamente onde a coleta
  precisa ler. Contam formas de segredo (`sb_secret_…`, `sk_live_…`, `sk_test_…`)
  e uma atribuição `service_role_key = <valor com forma de segredo>`; JWT tem
  categoria própria;
- os caminhos das listas privadas (o valor das variáveis de ambiente) **não**
  são impressos pelo script — só o nome da variável e o status
  `NOT_CONFIGURED`/`NOT_AVAILABLE`/`EMPTY_OR_INVALID`/`AVAILABLE`.

O padrão de `unmasked_project_ref_findings` é heurístico (20 caracteres
alfanuméricos minúsculos contíguos — `[a-z0-9]`, **não** `[a-z]`: o padrão
só-letras deixava passar exatamente o caso comum, um ref com dígitos — fora de
`<KNOWN_PROJECT_REF>` e fora do formato `primeiros4...ultimos4`) porque o
project ref real nunca deve constar em texto neste repositório para servir de
padrão exato — a heurística é deliberadamente ampla e pode gerar falso positivo,
o que é aceitável neste gate (falso positivo custa uma revisão manual; falso
negativo vaza o ref).

### 5.1.2 Testes do scanner — obrigatórios, executados sobre o script real

Executados sobre o script **extraído deste runbook** exatamente como o operador o
extrai (`cat > … <<'PYEOF'`), com fixtures 100% sintéticas. Nenhum nome real,
project ref real, referência de pagamento real ou segredo real entra em fixture.
Numeração contínua da §5.2 (que vai até 31).

| # | Cenário | Esperado |
|---|---|---|
| T32 | `OUTPUT_DIR` inexistente | **FAIL** — `OUTPUT_DIRECTORY_STATUS = INVALID`, exit 2 |
| T33 | `OUTPUT_DIR` válido e vazio | **FAIL** — manifest ausente, exit 2 |
| T34 | Manifest ausente com outputs presentes | **FAIL** — exit 2 |
| T35 | Manifest referencia arquivo inexistente | **FAIL** — `MISSING_FILE` |
| T36 | Manifest com `../` (escape) | **FAIL** — `PARENT_TRAVERSAL` |
| T37 | Manifest válido + outputs limpos + listas válidas | **PASS** — exit 0 |
| T38 | Lista privada de participantes ausente | **FAIL** — `NOT_AVAILABLE` |
| T39 | Lista privada de participantes vazia | **FAIL** — `EMPTY_OR_INVALID` |
| T40 | Lista privada de pagamentos vazia | **FAIL** — `EMPTY_OR_INVALID` |
| T41 | Project ref letras+dígitos (`abcd1234efgh5678ijkl`) | **FAIL** — `UNMASKED_PROJECT_REF_FINDINGS > 0` |
| T42 | `role_name = service_role` (nome de role nu) | `API_SECRET_FINDINGS = 0` |
| T43 | Valor sintético `sb_secret_…` | **FAIL** — `API_SECRET_FINDINGS > 0` |
| T44 | Nome da lista privada com caixa trocada | **FAIL** — `PARTICIPANT_NAME_FINDINGS > 0` |
| T45 | Conjunto limpo + listas não vazias | **PASS** — exit 0 |

T42 e T43 são o par que fixa a correção do `api_secret_findings`: o nome de role
sozinho não é credencial, a forma de segredo é.

### 5.2 Testes adversariais do schema — obrigatórios antes de qualquer execução live

Todos executam contra `PHASE1_RESULT_SCHEMA.json` (JSON Schema Draft 2020-12,
qualquer validador). São testes de **schema**, não de dado real — nenhum deles
lê ou precisa de acesso a produção. Numeração contínua da revisão anterior
(1–21 já cobertos pelas seções de invariantes e completude); os novos:

| # | Instância mínima | Resultado esperado |
|---|---|---|
| 22 | `section_result` com a propriedade `"state"` presente (qualquer valor) | **FAIL** — `additionalProperties: false` rejeita `state`, removida de `$defs/section_result` |
| 23 | Objeto de inventário (`row_estimates[]` ou item de `inventory_bucket.items[]`) com `production_state = "CONFIRMED_IN_USE"` e **sem** `operational_evidence` | **FAIL** — `confirmed_in_use_requires_evidence` |
| 24 | O mesmo objeto, mesmo `production_state = "CONFIRMED_IN_USE"`, **com** `operational_evidence` válido (`source_type`, `observed_at_utc`, `evidence_reference_sanitized`) | **PASS** |
| 25 | Instância completa e válida **sem** `sanitization_gate_counts` | **FAIL** — agora obrigatório no `required` de topo |
| 26 | Instância completa, `sanitization_gate_counts = {}` | **FAIL** — as oito categorias são `required` dentro do objeto |
| 27 | `sanitization_gate_counts` com sete das oito categorias, uma ausente (qualquer uma) | **FAIL** |
| 28 | `sanitization_gate_counts` com as oito presentes, qualquer uma delas `= 1` | **FAIL** — cada categoria é `const: 0` |
| 29 | `sanitization_gate_counts` com as oito presentes e todas `= 0` | **PASS** (quanto a este campo) |
| 30 | Instância completa e válida **sem** `sanitization_gate_completed_at_utc` | **FAIL** — agora obrigatório no `required` de topo |
| 31 | `sanitization_gate_scanner_sha256` presente mas fora do padrão `^[a-f0-9]{64}$` (ex.: maiúsculas, comprimento errado, não-hex) | **FAIL** |

Verificação de disponibilidade de listas privadas (`PRIVATE_TERM_LIST_STATUS`,
`OUTPUT_SHARE_ALLOWED` por categoria): esses dois campos são saída de **texto**
do scanner (§5.1.1), não propriedades do JSON canônico — o schema não os define
e portanto não há teste de schema para ausência/invalidez deles. A garantia
vive no próprio script: categoria com lista indisponível nunca reporta `0`,
sempre reporta `NOT_AVAILABLE` e força `OUTPUT_SHARE_ALLOWED[categoria] =
false`, o que por sua vez impede `sanitized_output_exit_gate_passed = true`
para a coleta inteira.

### 5.3 Invariantes estáticas — reconfirmação após os testes 22–31

Reafirmação do que já valia antes desta revisão, para conferência num único
lugar:

```
37 BEGIN READ ONLY
37 ROLLBACK
37 SHOW transaction_read_only

DDL = 0
DML = 0
CALL = 0
COPY = 0
COMMIT = 0

stale 36-section references = 0

collection_failures property   = absent
blocked_sections property      = absent
collected_sections property    = absent
skipped_sections property      = absent
not_run_sections property      = absent

section_result.state property  = absent   (NOVO NESTA REVISÃO — ver teste 22)
```

---

## 6. Saída da Fase 1

1. Uma saída por seção, sanitizada, com a seção identificada.
2. Uma instância de `PHASE1_RESULT_SCHEMA.json` preenchida e **validada contra o
   schema** (JSON Schema Draft 2020-12), contendo:
   - as invariantes (`production_writes = 0`, `ddl_detected = false`,
     `dml_detected = false`, `application_function_calls = 0`,
     `commit_issued = false`, `read_only_confirmed = true`);
   - `transaction_model = ONE_READ_ONLY_TRANSACTION_PER_SECTION` e
     `collection_model = TIME_BOUNDED_MULTI_TRANSACTION_OBSERVATION`;
   - `section_results` com as **37** entradas, uma por seção, cada uma
     satisfazendo os requisitos do seu status (a fonte única de verdade);
   - a janela: `collection_started_at_utc`, `collection_ended_at_utc`;
   - a provenance de repositório: `phase0_baseline_commit`,
     `repository_head_at_collection`, `origin_main_sha_at_collection`;
   - a provenance do pacote: `query_pack_sha256`,
     `query_pack_sha256_verified_after = true`, `phase1_artifact_commit`,
     `phase1_package_manifest_sha256`, `artifact_hashes`,
     `working_tree_clean_at_collection = true`;
   - `exact_business_reconciliation = DEFERRED_TO_PHASE1B`;
   - `sanitized_output_exit_gate_passed = true` (§5.1).
3. Um `PHASE1_LIVE_STATE.md` preenchido a partir de
   `PHASE1_LIVE_STATE_TEMPLATE.md`.
4. O `SANITIZED_OUTPUT_EXIT_GATE` (§5.1) executado sobre os itens 1–3, com os
   oito contadores em zero. Enquanto ele não passar, nada sai da máquina.

Só depois disso a Fase 2 pode começar. **Nenhuma decisão de arquitetura é tomada
antes** — e nenhum gate de backup é considerado atendido por esta coleta: a
Fase 1 observa, não protege.
