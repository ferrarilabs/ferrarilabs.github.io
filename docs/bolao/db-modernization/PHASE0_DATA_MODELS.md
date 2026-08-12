# FASE 0 — Os cinco modelos de dados concorrentes

Nenhum destes foi verificado contra o Supabase real. Ver `PHASE0_EVIDENCE_GAPS.md`.

## Visão geral

Classificação em dois eixos (ver `PHASE0_INVENTORY.md` §"Taxonomia").

| # | Modelo | Estilo | Escopo | `REPOSITORY_STATE` | `PRODUCTION_STATE` |
|---|---|---|---|---|---|
| 1 | `bolao_state` | 1 documento JSONB por app | copa2026, br2026, cdb2026 | `CODE_REFERENCED` | `UNVERIFIED` |
| 2 | `users` / `bolao_types` / `user_bolao_participation` / `audit_log` / `email_log` | relacional raso | Powerball (ingest) | `CODE_REFERENCED` | `UNVERIFIED` |
| 3 | `powerball_draws` / `powerball_participants` / `powerball_audit_log` | relacional por domínio | Powerball | `DOCUMENTATION_ONLY` | `UNVERIFIED` |
| 4 | `lottery_*` (13 tabelas) | relacional completo, RPC-first, RLS deny-by-default | Powerball/loterias | `BRANCH_ONLY` | `UNVERIFIED` |
| 5 | `bolao_events` / `bolao_notification_jobs` / … | outbox + fila de jobs | plataforma | `BRANCH_ONLY` | `UNVERIFIED` |

Nenhum dos cinco cobre todos os domínios. Modelos 1 e 2 coexistem hoje sem
qualquer relação declarada entre si — não há chave estrangeira, tabela de
correspondência, nem processo de reconciliação ligando um participante de
`bolao_state.state.entries[]` a uma linha de `public.users`.

---

## Modelo 1 — `bolao_state` (o único referenciado por código de `main` nos apps de futebol)

```
public.bolao_state
  id          text primary key   -- 'main' | 'br2026' | 'cdb2026'
  state       jsonb              -- TODO o estado do app
  updated_at  timestamptz
```

Forma de `state` (observada em `bolao/copa2026/js/app.js:179`,
`bolao/br2026/js/app.js:92`, `bolao/cdb2026/js/app.js:74`):

```
{ entries: [...], deletedIds: [...], paid: {...}, results: {...},
  auditLog: [...], meta: {...} }        // cdb2026 acrescenta: phases, espnSync
```

Call sites verificados:

| App | Leitura | Escrita | Delete |
|---|---|---|---|
| copa2026 | `bolao/copa2026/js/app.js` (SDK, `createClient` em `218`) | `.upsert()` | — |
| br2026 | `bolao/br2026/js/app.js:115` (REST cru) | `bolao/br2026/js/app.js:143` (`Prefer: resolution=merge-duplicates`) | **`bolao/br2026/js/app.js:2785-2786`** |
| cdb2026 | `bolao/cdb2026/js/app.js:129` e `171` (read-before-merge) | `bolao/cdb2026/js/app.js:188` | **`bolao/cdb2026/js/app.js:3830-3831`** |

Só o copa2026 usa o SDK `@supabase/supabase-js`; br2026 e cdb2026 falam REST cru.
O segundo `SELECT` do cdb2026 (linha 171) foi acrescentado para corrigir o bug de
clobber que o br2026 ainda tem — divergência D-05.

**Propriedades do modelo como documentado:** sem tipos, sem constraints, sem índices
além da PK, sem histórico, sem CAS. A linha inteira é reescrita a cada gravação. O
único limite documentado é um `check (pg_column_size(state) < 1048576)` — um teto de
1 MB por bolão. Que esse `check` exista de fato na tabela é `UNVERIFIED` (Q15, Q16);
se **não** existir, o teto some e o risco muda de natureza, não desaparece.

---

## Modelo 2 — participantes relacionais (`bolao/loterias/powerball/scripts/supabase_setup.sql`, único DDL de `main`)

```
users(id BIGSERIAL, name UNIQUE, email UNIQUE, phone, state, active, created_at, updated_at)
bolao_types(id, code UNIQUE, name, description, created_at)
user_bolao_participation(id, user_id→users, bolao_type_id→bolao_types,
                         bolao_draw_id, shares, status, joined_at,
                         UNIQUE(user_id, bolao_type_id, bolao_draw_id))
audit_log(id, action, entity_type, entity_id, performed_by, details JSONB,
          status, error_message, ip_address INET, created_at)
email_log(id, recipient_email, recipient_name, subject, bolao_type, draw_id,
          template_used, status, emailjs_status_code, emailjs_message_id,
          error_reason, sent_at, metadata JSONB)
```

Índices: `idx_users_{email,name}`, `idx_participation_{user,bolao,draw}`,
`idx_audit_{action,entity,created,status}`, `idx_email_{recipient,draw,status,sent_at}`.

Referenciado por `bolao/loterias/powerball/scripts/add_participant_to_supabase.py`,
`bolao/loterias/powerball/scripts/add_participants.py` e
`bolao/loterias/powerball/scripts/send_result_email.py`
(`load_participants_from_supabase`, com fallback para o secret privado). Referenciar
não é exercitar: ver D-12 — se a chave malformada não autentica, esse caminho cai no
fallback silenciosamente e o modelo 2 pode nunca ter recebido escrita.

**Lacunas em relação ao domínio real:** não há `valor`, não há `metodo`, não há
`tx_id`, não há sorteio como entidade (só `bolao_draw_id` solto, sem tabela), não
há bilhete, não há resultado, não há saldo. `shares` é o `cotas` do
`bolao/loterias/powerball/js/data.js` com outro nome.

---

## Modelo 3 — `powerball_*` (só em markdown)

```
powerball_draws            -- RLS DESABILITADA na própria doc
powerball_participants(id UUID, draw_id, name, email, cotas, valor, metodo,
                       data, hora, tx_id, status)
powerball_audit_log(draw_id, action, actor, details JSONB, ip_address INET, user_agent)
```

Policies: `admin_select` / `self_select` / `system_insert`, baseadas em
`auth.jwt() ->> 'is_admin'` e `auth.jwt() ->> 'email'`.

**Por que é dead-on-arrival:** nenhum dos quatro apps emite JWT do Supabase Auth.
Não há login de usuário em lugar nenhum — o "admin" é um hash SHA-256 conferido no
navegador, guardado em `sessionStorage`. Essas policies nunca seriam satisfeitas.

É, porém, o **único** modelo que dá coluna a `tx_id` — a governança de txId do
Powerball hoje vive inteiramente no secret privado, fora de qualquer schema.

---

## Modelo 4 — `lottery_*` (branch `powerball-admin-supabase-audit`)

O mais completo. 13 tabelas cobrindo participante, pool, sorteio, participação,
transação de pagamento, bilhete, publicação de bilhetes, resultado, job de e-mail,
entrega de e-mail, papéis de admin e auditoria encadeada por hash.

Características arquiteturais que o distinguem dos modelos 1-3:

- RLS **deny-by-default** nas 13 tabelas; `anon` não recebe INSERT/UPDATE/DELETE em nenhuma.
- Toda escrita passa por RPC (`admin_create_participant`, `admin_record_payment`,
  `admin_reverse_payment`, `admin_publish_tickets`, `admin_record_result`,
  `admin_enqueue_email`, …) — o cliente não faz DML direto.
- `lottery_payment_transactions` + enum `payment_txn_type` com **reversão explícita**
  (`admin_reverse_payment`) — a única proposta do repositório que se aproxima de
  movimento financeiro em vez de total derivado.
- `lottery_admin_audit` encadeada por hash — a única proposta com auditoria
  tamper-evident.
- `lottery_public_projection` — view sem PII, o único mecanismo proposto de
  separação entre audiência pública e dado sensível.

**Status honesto:** é uma proposta séria e não avaliada. 33 commits, não mergeada, não
revisada nesta fase. Se foi ou não **aplicada** ao banco fora do processo de merge é
`UNVERIFIED` (Q5) — e existe um relato de sessão externa anterior que sugere criação
parcial de tabelas `lottery_*`, registrado em `PHASE0_INVENTORY.md` §19.3 com
`REQUIRES_PHASE1_RECONFIRMATION`. Não deve ser tratada como decisão tomada nem como
schema inexistente.

---

## Modelo 5 — notificações/outbox (branch `football-operational-hardening`)

```
bolao_events
bolao_notification_jobs        (+ enum bolao_notification_job_status)
bolao_notification_deliveries
bolao_processing_runs
```

RPCs: `claim_bolao_notification_jobs` (com `FOR UPDATE SKIP LOCKED`),
`mark_bolao_notification_sent`, `mark_bolao_notification_retryable_failure`,
`mark_bolao_notification_permanent_failure`, `release_stale_bolao_processing`.

Policies: anon pode INSERT e SELECT, deliberadamente **não** UPDATE nem DELETE.

É o único desenho do repositório com fila durável, claim seguro sob concorrência,
distinção entre falha transitória e permanente, e recuperação de jobs travados.
Resolve exatamente a lacuna que `bolao/loterias/powerball/scripts/email/outbox.json`
(arquivo, sem worker) deixa aberta.

---

## Mapa entidade → formato

### Participante — 5 formas, 3 tipos de chave

| Forma | Chave | Campos | PII |
|---|---|---|---|
| `state.entries[]` | UUID (cliente) | `entryName, payerName, participantEmail, paymentMethod, paymentTo, createdAt, updatedAt, diagnostics, picks` | e-mail dentro do JSONB |
| `POWERBALL_DRAWS[].participants[]` | **nome (string)** | `name, cotas, valor, metodo, data, hora, status, state` | nome + pagamento |
| `users` + `user_bolao_participation` | BIGSERIAL | `name, email, phone, state` + `shares, status, bolao_draw_id` | sim |
| `powerball_participants` (doc) | UUID | + `tx_id` | sim |
| `bolao/loterias/powerball/scripts/email/outbox.json` jobs | **nome de exibição** | `participantId, recipient, payloadSnapshot` | sintético |

Divergência de tipo adicional: `data`/`hora` são strings pt-BR livres
(`"31/07/2026"`, `"4:52:51 PM"`) nas formas 2 e 4, `createdAt` ISO na forma 1, e
`TIMESTAMP` na forma 3.

### Pagamento — 6 formas

`paid{entryId: bool}` · `{metodo, valor, status, data, hora}` ·
`{shares, status}` · `tx_id` (doc-only) · `finance{}` agregado por sorteio ·
`lottery_payment_transactions` (branch).

### Sorteio / partida / resultado

| App | Onde vivem as partidas |
|---|---|
| copa2026 | `bolao/copa2026/js/data.js` — `groupMatches[]` `{match, teamA, teamB, goalsA, goalsB, winner, status}` |
| cdb2026 | **não existem em `bolao/cdb2026/js/data.js`** — vivem em `state.competition.phases[id].ties`, inseridas pelo admin (`TWO_LEG`/`SINGLE_MATCH`) |
| br2026 | não existem — palpites são arrays de nomes de times `{g4, sa6, z4}` |
| powerball | `bolao/loterias/powerball/js/data.js` `{drawing, result:{numbers[], special, multiplier}, profit}`, mais o manifesto, mais strings formatadas |

### Palpites — sem schema compartilhado

`copa: picks[matchId] = {goalsA, goalsB, advanceSide, displayA, displayB}` ·
`cdb: picks = {matches:{tieId:{…}}, qualified:{tieId:team}}` ·
`br: picks = {g4:[], sa6:[], z4:[]}`.

### Auditoria — 5 formas

`state.auditLog[]` (cliente, cap 200) · `public.audit_log` · `public.powerball_audit_log`
(doc) · `public.email_log` ·
`bolao/loterias/powerball/scripts/email/outbox.json` · páginas HTML geradas em
`bolao/copa2026/`.

---

## O que nenhum modelo ativo tem

- Histórico temporal (só estado atual)
- Partida dobrada / movimento financeiro
- Auditoria imutável ou tamper-evident
- Identidade unificada de participante entre apps
- Separação de audiência (público / privado / admin) no nível do banco
- Controle de concorrência (CAS, versionamento otimista)
- Fila durável com retry
- Retenção implementada
