# FASE 0 — Mapa de PII

**Regra deste documento:** cita-se apenas *nomes de campo* e *localizações*.
Nenhum valor real, nome de participante, e-mail, telefone ou referência de
transação aparece aqui — nem aparecerá em qualquer artefato desta iniciativa.

Audiências: `PUBLIC` (qualquer visitante) · `ANON_KEY` (quem tem a chave
publicável, que é pública) · `PRIVATE` (secret fora do repositório) ·
`ADMIN` (deveria exigir privilégio) · `GITIGNORED` (local, não versionado).

Endereços de e-mail reais são substituídos por `<ADMIN_EMAIL_ALLOWLISTED>`; o
identificador do projeto Supabase, por `<KNOWN_PROJECT_REF>`.

---

## 0. Repositório não é o site live

Este documento descreve a **árvore do repositório** no commit `0660d99`. Não descreve
o que o site publicado entrega hoje.

```
CURRENT_REPOSITORY_TREE_PII = conforme scanner local (§3, §5 — limpo quanto aos detectores existentes)
LIVE_SITE_PII               = UNVERIFIED nesta fase
```

A existência do GitHub Pages **não** garante que `origin/main` e o artefato publicado
sejam iguais. Um incidente recente de Pages demonstrou que podem divergir. Portanto:

- que a árvore esteja limpa **não** prova que o site live está limpo;
- que o hotfix P0.1 (`1b09afa`) tenha removido PII do commit **não** prova que a
  versão servida ao público reflete essa remoção;
- nenhuma linha deste documento pode ser lida como declaração sobre exposição live.

Verificar `LIVE_SITE_PII` exige buscar o artefato publicado e compará-lo ao commit —
com URL, HTTP status, timestamp, hash live e hash do commit (ver taxonomia
`DEPLOYMENT_STATE` em `PHASE0_INVENTORY.md`). Não foi feito nesta fase.

---

## 1. Campos que armazenam PII

`AUDIENCE_IMPLIED_BY_SOURCE` é a audiência que a **fonte versionada ou documentada**
implica — policy no `.sql`, policy descrita em markdown, ou o simples fato de o arquivo
ser servido publicamente. `PRODUCTION_AUDIENCE` é quem de fato alcança o dado no
sistema em operação.

| Campo | Local | `AUDIENCE_IMPLIED_BY_SOURCE` | `PRODUCTION_AUDIENCE` | Deveria ser |
|---|---|---|---|---|
| `users.name` | `bolao/loterias/powerball/scripts/supabase_setup.sql:7` | `ANON_KEY` (policy `Allow read users`) | `UNVERIFIED` | `ADMIN` |
| `users.email` | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` |
| `users.phone` | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` |
| `users.state` | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` |
| `audit_log.entity_id` | `bolao/loterias/powerball/scripts/supabase_setup.sql:78` | `ANON_KEY` | `UNVERIFIED` | `ADMIN` — pode conter e-mail |
| `audit_log.performed_by` | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` |
| `audit_log.ip_address` (INET) | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` — dado pessoal sob GDPR/LGPD |
| `email_log.recipient_email` | `bolao/loterias/powerball/scripts/supabase_setup.sql:97` | `ANON_KEY` | `UNVERIFIED` | `ADMIN` |
| `email_log.recipient_name` | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` |
| `email_log.metadata` (JSONB) | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` — conteúdo não constrangido |
| `bolao_state.state.entries[].participantEmail` | dentro do JSONB | `ANON_KEY` (policy **documentada**) | `UNVERIFIED` | `ADMIN` — ver D-01 |
| `bolao_state.state.entries[].payerName` | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` |
| `bolao_state.state.entries[].entryName` | idem | `ANON_KEY` | `UNVERIFIED` | pode ser `PUBLIC` (é o nome exibido no ranking) |
| `bolao_state.state.entries[].paymentMethod` / `paymentTo` | idem | `ANON_KEY` | `UNVERIFIED` | `ADMIN` |
| `POWERBALL_DRAWS[].participants[].name` | `bolao/loterias/powerball/js/data.js` | **`PUBLIC`** (repositório aberto + site estático) | `UNVERIFIED` no site live · **`PUBLIC`** no repositório aberto — ver §0 | decisão pendente — ver §4 |
| `…participants[].metodo` / `valor` / `data` / `hora` / `state` | idem | **`PUBLIC`** | `UNVERIFIED` no site live · **`PUBLIC`** no repositório aberto | `ADMIN` |
| `powerball_participants.email` / `tx_id` | doc-only | `ADMIN` / `PARTICIPANT_SELF` (policies documentadas) | `UNVERIFIED` — a tabela pode não existir | `ADMIN` (se implementado) |
| `powerball_audit_log.ip_address` / `user_agent` | doc-only | — | `UNVERIFIED` | `ADMIN` |
| `lottery_participants.*` | branch | deny-by-default (RLS branch-only) | `UNVERIFIED` | `ADMIN`, com `lottery_public_projection` para o público |
| `POWERBALL_PRIVATE_PARTICIPANT_DATA` (nome → e-mail, txId) | variável de ambiente lida pelo código | `PRIVATE` | `UNVERIFIED` — ver bloco abaixo | correto por design |
| `bolao/loterias/powerball/scripts/private-participant-data.local.json` | disco local | `GITIGNORED` | `UNVERIFIED` (fora do repositório) | correto por design |
| `bolao/*/backups/*.json` | disco local | `GITIGNORED` | `UNVERIFIED` (fora do repositório) | conteria `participantEmail` real |

> **Uma policy versionada ou documentada não é uma policy aplicada.** Toda coluna
> `AUDIENCE_IMPLIED_BY_SOURCE` que derive de `.sql` ou de markdown é uma leitura de
> *intenção*. A audiência real depende de policies **e** de grants no banco — duas
> camadas distintas, nenhuma das duas verificada. Ver Q6 e Q11 em
> `PHASE0_EVIDENCE_GAPS.md`.

### 1.1 Sobre o secret privado

```
SECRET_REFERENCED_BY_CODE = POWERBALL_PRIVATE_PARTICIPANT_DATA
  (lido por bolao/loterias/powerball/scripts/send_result_email.py e módulos de e-mail)
SECRET_EXISTENCE = UNVERIFIED
```

Nenhuma afirmação de que o GitHub Secret existe, está populado ou é injetado nos
workflows. O repositório só pode provar que o código o lê.

---

## 2. Superfícies públicas geradas a partir de PII

| Arquivo | Gerado por | Contém |
|---|---|---|
| `bolao/copa2026/audit-report.html` | `bolao/copa2026/scripts/generate_audit_report.py` | derivado do estado dos participantes |
| `bolao/copa2026/audit-detail-picks.html` | idem | palpites por participante |
| `bolao/copa2026/audit-detail-governance.html` | idem | trilha de governança |
| `bolao/copa2026/classificacao-geral.html` | `bolao/copa2026/scripts/generate_classificacao_geral.py` | ranking |

Essas URLs foram enviadas por e-mail a participantes reais e precisam continuar
resolvendo (ver CLAUDE.md, seção de arquivamento). Os quatro arquivos são **tracked**
e, portanto, cobertos pelo scanner repo-wide (§3). Uma inspeção estática dirigida foi
executada nesta fase — resultado em §5.

---

## 3. Controles de PII que já existem

| Controle | Onde | Cobre |
|---|---|---|
| `scripts/audit_pii_repo_wide.mjs` | repositório | varre `git ls-files` por e-mails fora de allowlist (`<ADMIN_EMAIL_ALLOWLISTED>`, `.invalid`, `@example.com`, `@email.com`), atribuições literais de `email`/`recipient`/`txId`/`confirmationId`, formatos de ID Zelle/CashApp/Venmo, URLs com token, literal `service_role`, cabeçalhos PEM. Mascara os valores encontrados. |
| `bolao/loterias/powerball/scripts/audit_pii_tests.mjs` | Powerball | testes de regressão de PII |
| `bolao/scripts/security/check_pii_fixtures.py` | branch `security-review-readonly` | `REPO: PROPOSED_ONLY` |
| Hotfix P0.1 | `main` (`1b09afa`) | removeu e-mails e txIds de `bolao/loterias/powerball/js/data.js` |
| Fixtures anonimizadas | `bolao/cdb2026/scripts/fixtures/golden_state.json` | "Participante A", `a@example.invalid` |

Varredura confirmou: os quatro `js/data.js` não contêm `@`, e-mail, telefone ou
txId **na árvore do repositório**. O hotfix funcionou para o estado atual do commit
`0660d99`. Se o artefato **live** reflete esse hotfix é outra pergunta — ver §0.

**Cobertura real do `scripts/audit_pii_repo_wide.mjs` — correção registrada.**
Uma redação anterior desta seção afirmava que o scanner "não cobre as páginas HTML
geradas". Isso estava **errado**. O scanner enumera arquivos por `git ls-files`, o que
inclui qualquer arquivo rastreado, independentemente de extensão.

O que é coberto:

- **tracked HTML** — os quatro arquivos de §2 são rastreados e passam pelos sete
  detectores;
- **o log commitado** `bolao/loterias/powerball/logs/send_result_email_20260804_172718.log`
  — também rastreado, também coberto.

O que **não** é coberto:

- **os geradores não possuem gate específico antes de escrever os arquivos.**
  `generate_audit_report.py` e `generate_classificacao_geral.py` escrevem o HTML sem
  consultar nenhum detector de PII. A cobertura do scanner é *posterior* (detecta
  depois de escrito e commitado), não *preventiva*. Este é o achado real de D-11 — não
  "falta cobertura", e sim "falta gate no ponto de geração";
- **arquivos untracked ou gitignored** — `git ls-files` os exclui por construção. Um
  HTML gerado e ainda não commitado, ou qualquer coisa em `bolao/*/backups/`, não é
  examinado;
- **o histórico do Git** — o scanner lê a árvore de trabalho, não os commits. A PII
  removida em `1b09afa` permanece nos commits anteriores e nenhum detector a alcança;
- **o artefato publicado** — o scanner lê o repositório local, nunca busca uma URL. Se
  o site live serve uma versão anterior ao hotfix, nenhum detector deste repositório
  perceberia. `LIVE_SITE_PII = UNVERIFIED` (§0);
- **nomes e dados financeiros permitidos** — não há detector para nome de pessoa nem
  para `metodo`/`valor`/`data`/`hora`/`state`. `POWERBALL_DRAWS[].participants[].name`
  é PII publicada por design atual e passa por todos os detectores sem alarme, com
  método e valor de pagamento ao lado. Um controle não detecta aquilo que a política
  vigente autoriza — ver DEC-06.

---

## 4. Decisão pendente — nome + pagamento no repositório público

Estado atual **na árvore do repositório** (`0660d99`):
`bolao/loterias/powerball/js/data.js` publica, para cada participante, nome completo,
método de pagamento, valor, data, hora e estado (UF). E-mail e txId foram removidos do
commit. O repositório é aberto, então essa exposição é `PUBLIC` de forma verificada; o
que a **versão live** do arquivo contém é `UNVERIFIED` (§0).

Nome sozinho num bolão pode ser aceitável (é o que o ranking mostra). Nome
**combinado com método e valor de pagamento**, num repositório aberto e indexável,
é dado financeiro identificável.

Isto é uma decisão do Eduardo, não uma correção a aplicar. Registrada em
`PHASE0_OPEN_DECISIONS.md` como **DEC-06**.

---

## 5. Inspeção estática dirigida — HTMLs gerados e log commitado

Executada nesta fase, **sem imprimir nenhum valor**: apenas presença/ausência de
padrão e contagem. Nenhum trecho dos arquivos é reproduzido aqui.

| Arquivo | Rastreado | E-mail fora da allowlist | Padrão Zelle (11 dígitos) | Padrão Cash App | Material de chave (PEM) |
|---|---|---|---|---|---|
| `bolao/copa2026/audit-report.html` | sim | 0 | 0 | 0 | 0 |
| `bolao/copa2026/audit-detail-picks.html` | sim | 0 | 0 | 0 | 0 |
| `bolao/copa2026/audit-detail-governance.html` | sim | 0 | 0 | 0 | 0 |
| `bolao/copa2026/classificacao-geral.html` | sim | 0 | 0 | 0 | 0 |
| `bolao/loterias/powerball/logs/send_result_email_20260804_172718.log` | sim | 0 | 0 | 0 | 0 |

**Veredito:** nenhum dos cinco arquivos, **na árvore do repositório**, contém e-mail,
referência de transação ou material de chave detectável pelos detectores existentes.
Isto **fecha** a parte detectável de D-11 na árvore e **não** fecha:

- a parte não detectável — as quatro páginas exibem nomes de participante por natureza
  (é o ranking), e nome não é detectado por nenhum detector (§3); se essa exposição é
  aceitável é a decisão DEC-06, não um achado técnico;
- **a versão live** — o que está publicado nessas quatro URLs não foi buscado nem
  comparado. `LIVE_SITE_PII = UNVERIFIED` (§0). As URLs foram enviadas por e-mail a
  participantes reais, então há artefato live a verificar.

## 6. Achados adicionais

- `bolao/loterias/powerball/logs/send_result_email_20260804_172718.log` está
  **commitado**, apesar de o diretório de logs ser gitignored. O comentário em
  `bolao/loterias/powerball/scripts/send_result_email.py:500` registra que isso já
  aconteceu antes ("see POWERBALL_PII_AUDIT.md §3"). Inspecionado em §5: limpo quanto
  aos detectores existentes; o problema remanescente é de processo (um log não deveria
  entrar no versionamento), não de conteúdo conhecido.
- `bolao/loterias/powerball/scripts/email/outbox.json` está commitado com
  `payloadSnapshot` incluindo método de pagamento, status, cotas, valor e UF. Rotulado
  como sintético/test-mode; o único destinatário real presente é
  `<ADMIN_EMAIL_ALLOWLISTED>`, que está na allowlist do scanner.
- `bolao/loterias/powerball/scripts/new_participants_template.csv` contém apenas dados dummy.
- **Correção registrada.** Uma redação anterior afirmava que "nenhum e-mail real"
  existia nestes documentos. Isso era impreciso: nenhum e-mail **de terceiro** foi
  encontrado em arquivos versionados — mas o endereço administrativo real do dono do
  site aparecia literalmente em dois pontos dos próprios documentos desta fase
  (`PHASE0_INVENTORY.md` §8 e `PHASE0_PII_MAP.md` §3), herdado da allowlist do scanner.
  Estar numa allowlist significa "não é um vazamento a corrigir no código", não
  "pode ser reproduzido em documento de auditoria". Ambas as ocorrências foram
  substituídas por `<ADMIN_EMAIL_ALLOWLISTED>`. E-mails sintéticos (`@example.invalid`,
  `@example.com`) permanecem como estão — não identificam ninguém.

---

## 7. Classificação de audiência a decidir na arquitetura-alvo

Três audiências precisarão existir explicitamente no modelo, o que hoje não
acontece em nível de banco em nenhum modelo ativo:

| Audiência | Exemplo de dado |
|---|---|
| `PUBLIC` | nome de exibição da entrada, pontuação, ranking, resultado do sorteio, números do bilhete |
| `PARTICIPANT_SELF` | o próprio e-mail, os próprios pagamentos, o próprio txId |
| `ADMIN` | todos os e-mails, todos os pagamentos, IP, trilha de auditoria |

O modelo 4 (`lottery_public_projection`) é a única proposta existente que separa
`PUBLIC` do resto no nível do banco. `PARTICIPANT_SELF` não tem proposta viável
enquanto não houver autenticação — hoje não há login de participante em lugar
nenhum da plataforma.
