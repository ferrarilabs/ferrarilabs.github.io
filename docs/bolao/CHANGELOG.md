# Changelog — Bolão do Ferrari

This file consolidates the full version history. The source of truth for the latest entry is `bolao-teste/CHANGELOG.md`.

---

## Plataforma — o gate de acessibilidade dependia da ESPN estar no ar (2026-08-20, Issue #248)

`bolao/scripts/audit_accessibility.mjs` é um gate de merge **obrigatório** e tinha uma dependência
não declarada da saúde de um terceiro: ele abre os quatro apps num navegador, os apps chamam o
gateway `live-football` implantado, e a suíte reprova em qualquer erro de console. Quando a ESPN
passou a responder 403 ao gateway (incidente #246), o gate ficou vermelho **para todo PR do
repositório, independentemente do que o PR mudava**.

A prova não foi teórica: **#245** (sharding da suíte de testes) e **#247** (UMA linha de
`CHANGE_INTENT.json`, sem nenhuma superfície de código) reprovaram no MESMO check único, pelo mesmo
motivo externo aos dois — ambos com `contrato PASS` e todos os outros ~170 checks verdes.

### O defeito era de arquitetura, não de acessibilidade

Duas perguntas estavam colapsadas num único check:

| pergunta | natureza | onde mora agora |
|---|---|---|
| "a interface é acessível?" | tem de ser determinística | `audit_accessibility.mjs` (gate obrigatório) |
| "a cadeia de dados externa está saudável?" | intrinsecamente não-determinística | `check_live_gateway_health.mjs` (sonda, `requires: "network"`) |

`audit_responsive_matrix.mjs` já mockava essa rota desde sempre — a suíte de acessibilidade era a
exceção, não a regra.

### O que mudou

- **Fixtures canônicos** (`bolao/shared/scripts/live_gateway_fixtures.mjs`): nenhum corpo é escrito
  à mão. Os payloads saem dos **construtores reais da Edge Function**
  (`buildGatewayPayload` / `sourceUnavailablePayload`) e as partidas passam pelo
  `normalizeScoreboard()` real, a partir de um evento cru no formato da ESPN. Um fixture que o
  produto nunca emite testa ficção.
- **Contrato dos fixtures** (`test_live_gateway_fixtures.mjs`, 13 checks, determinístico, gate
  obrigatório): trava as distinções que já custaram incidente — `matches: null` (não sei) nunca
  vira `matches: []` (não há jogo), `STALE` sempre declara motivo, `SOURCE_UNAVAILABLE` responde
  503 e `EMPTY` responde 200.
- **Sonda ao vivo** (`check_live_gateway_health.mjs`): distingue
  `FRESH` / `STALE` / `SOURCE_UNAVAILABLE` / `GATEWAY_DOWN` / `UNKNOWN` por competição e reporta
  competição, HTTP, `x-live-health`, motivo upstream, `observedAt`/idade e carimbo de tempo. A URL
  vem da configuração **do próprio app**, nunca de uma constante local — um monitor apontado para
  um endereço abandonado é a falha mais silenciosa possível. Somente leitura: não escreve no
  Supabase, não envia e-mail, não toca scoring/ranking.
- **Acessibilidade sob degradação**: a suíte agora afirma, de propósito, que `STALE` e
  `SOURCE_UNAVAILABLE` **não** degradam a acessibilidade (landmarks, h1, hierarquia, skip link,
  nomes, labels, `th scope`, `aria-controls`, alvo de toque, overflow) — estados que antes nenhuma
  suíte determinística exercitava.

### Por que isto não é "enfraquecer um portão para ficar verde"

Mockar a rota **sozinho** apagaria o único sinal de degradação viva que a plataforma tinha, no meio
de um incidente aberto. Por isso as duas metades entraram juntas. Nenhuma asserção foi removida,
afrouxada ou pulada: a suíte foi de **65 para 69 checks**, e o teste de "sem erro de console"
continua valendo integralmente no passe `FRESH`.

Provado por mutação: com um `throw` injetado no `br2026`, `sem erro de console` reprova; com o
skip link removido do `cdb2026`, reprovam 4 checks (2 originais + 2 dos novos estados degradados).

### O que isto NÃO conserta

**#246 continua aberto.** A ESPN continua devolvendo 403 ao gateway e o dado ao vivo continua
indisponível em produção. Esta mudança faz o CI dizer a verdade sobre *qual* sinal está falhando —
não restaura o dado.

Deliberadamente fora de escopo (e não omitido em silêncio): ligar a sonda a um sinal agendado
(detector do Sentinel ou cron) toca `.github/workflows/**`, superfície `NOTIFICATION_WORKFLOWS`
(`DECLARE_TO_CHANGE`), e portanto é uma mudança declarada à parte.

## BR2026 — rodada 22: o laço de entrega não existia (2026-08-11)

Autorizado o envio real das rodadas completas do BR2026, a partir da R22. A auditoria que
precedeu o armamento encontrou um defeito bem maior que o esperado.

### O laço de entrega por destinatário nunca foi escrito

`send_round_email.py` tinha, no lugar da entrega, um comentário
(`# ... envio real por destinatario acontece aqui ...`) seguido de `raise NotImplementedError`.
O workflow rodava em `--dry-run` e **toda a suíte passava**, porque nenhum teste chegava perto
do único trecho que importa quando o e-mail sai. Ter apenas trocado `--dry-run` por `--auto`
teria reivindicado a rodada, marcado `SENDING` e estourado — deixando a R22 num estado órfão
que só uma pessoa destrava.

Implementado o laço real: alvo por destinatário, `SENDING` antes do POST, desfecho registrado
depois, `settle` no fim, e `providerCalls` contando invocação e não intenção.

### Dois defeitos estruturais achados no caminho

- **Entrega parcial era irrecuperável.** `claim_atomic` só aceitava `state == "READY"`, então
  `PARTIAL` e `FAILED` nunca mais podiam ser reivindicados: a retentativa era estruturalmente
  inalcançável e qualquer entrega parcial ficava encalhada para sempre, sem erro nenhum. O
  defeito só aparece na SEGUNDA execução — que era exatamente o que nenhum teste exercitava.
  Corrigido nos dois repositórios Python (`CLAIMABLE_STATES = READY|PARTIAL|FAILED`); a RPC SQL
  da migração 010 já estava correta. `SENT` e `NEEDS_MANUAL_REVIEW` continuam fora.
- **`recover_expired_leases()` não tinha chamador de produção.** Existia, era testado
  isoladamente, e nenhum caminho o executava. Um runner que morresse no meio do envio deixava a
  rodada em `SENDING` para sempre. Agora roda uma vez por execução, antes de escolher candidatos.

### Gates

- Novo `test_round_delivery_loop.py` (12 casos), com o transporte injetado no limite EXTERNO —
  tudo antes dele é código de produção. Cobre: aceito nunca reenvia, só o que falhou é
  retentado, parcial nunca vira `SENT`, exceção após o POST vira `UNCERTAIN`, `SENDING` órfão
  com lease vencido vai para revisão humana, transporte bloqueado não toca no ledger.
- **Um teste falso-verde meu, medido e corrigido durante o trabalho:** a primeira versão de
  "lista vazia não vira difusão" passava pelo motivo errado — o `claim` barrava a segunda
  execução antes de a seleção rodar, então a mutação `... or resolved` continuava verde. E a
  regex do gate de fonte também não pegava (a mutação escreve `] or resolved`). A seleção virou
  função pura (`alvos_reenviaveis`) com teste direto; as duas mutações agora derrubam a suíte.
- Dois gates que exigiam "envio desligado" (`NotImplementedError`, ausência de `--auto` e de
  `BOLAO_ALLOW_REAL_SEND`) foram reescritos para exigir as invariantes do mundo armado, em vez
  de apagados — um bloco com nome de portão e nenhum portão dentro é pior que nenhum portão.

### Auditoria independente da R22 (pré-requisito do envio)

- **Scoring:** três implementações concordam nas 11 entradas, pontos e posições — reimplementação
  a partir da regra, o Python que monta o e-mail, e o `scoreEntry`/`rankEntries` do `js/app.js`.
  `SCORE_MISMATCHES = 0`, `RANK_MISMATCHES = 0`.
- **Tabela:** 20 times, ranks 1..20, snapshot não-stale, e idêntica a uma tabela recomputada dos
  215 jogos concluídos do scoreboard — não é tabela velha.
- **Conteúdo:** 10/10 jogos com placar, 11 entradas, sem PII no corpo, sem placeholder, linguagem
  de projeção presente. `contentHash 3c16184814d9cc6a`, o mesmo que o dry-run do Actions calculou.

---

## Powerball — incidente de notificação do sorteio 2026-08-10 (2026-08-11)

Incidente P0: o e-mail de resultado do sorteio de 10/08 não saiu. Quatro execuções agendadas
depois do sorteio terminaram **verdes** (`exit 0`) sem enviar nada.

### Causa raiz (cadeia, não um bug só)

1. **Janela do cron mais estreita que a latência da fonte.** O agendamento cobre da noite do
   sorteio (22:00 UTC) até 06:50 UTC do dia seguinte. O `data.ny.gov` só publicou a linha do
   sorteio de 10/08 **depois** da última execução (07:11 UTC). Não existe execução de
   *catch-up* fora da noite do sorteio: um sorteio que fica pronto tarde nunca é revisitado.
2. **`NOT_READY` sai com `exit 0`** — correto para o caso normal (a maioria das execuções é
   antes do sorteio), mas significa que o modo de falha acima é invisível no painel do Actions.
3. Enquanto 10/08 não tinha resultado, o alvo da notificação era o 08/08, que está em
   `AGUARDA_ACAO_MANUAL` (entrega parcial histórica). O log do ciclo então exibia
   `sorteio avaliado = 2026-08-08` para uma execução cujo alvo anunciado era 10/08.

### Corrigido

- **`send_result_email.py`** — a resolução de contato entre sorteios devolvia a UNIÃO dos
  participantes de todos os sorteios. Para o sorteio de 10/08 (15 participantes) devolveu 16
  contatos, e o portão TUDO-OU-NADA do `build_send_plan` recusou o envio inteiro com
  "1 contato(s) que NÃO participam deste sorteio". **Zero e-mails.** A intenção declarada no
  próprio comentário sempre foi resolver o endereço *dos nomes que este sorteio espera*; o
  código é que não filtrava. Agora filtra pela participação canônica do `data.js`.
- **`recipient_preflight.py`** — verificava apenas `MISSING`, nunca `EXTRA`. Reportou
  `RESOLVED = 15/15 · PASS` para um conjunto que o sender recusaria minutos depois. Um
  preflight que aprova o que o sender bloqueia é um falso verde. Agora verifica os dois lados
  do portão.
- **`fetch_and_send_results.py`** — `providerInvoked` era `True` fixo para qualquer desfecho do
  sender, inclusive para os portões que retornam **antes** de qualquer chamada ao provedor. O
  ciclo afirmou `chamadas ao provedor TENTADAS = 15` com nenhuma chamada feita. Agora o
  desfecho é lido do `STATUS:` que o próprio sender imprime.

### Gates

- `test_cross_draw_resolution.py` — novo caso de regressão para o superconjunto. Os casos
  existentes não pegavam o defeito porque todos usavam um `draw_id` inexistente no `data.js`:
  sem participação canônica não havia o que filtrar. Mutação verificada (some o filtro → vermelho).
- `test_result_pipeline.mjs`, `test_email_send_gates.py` — três expectativas fixas em
  `"2026-08-08"` viraram vermelhas sozinhas quando o resultado de 10/08 foi gravado, acusando de
  erro a escolha correta. Passaram a derivar o alvo (mais recente COM resultado, por data) em vez
  de comparar com um id que apodrece a cada sorteio.

### Não corrigido (registrado)

- Rótulo do combobox instável na janela entre a hora do sorteio e a gravação do resultado: o
  sufixo `· próximo` some após `Escape`. Reproduzido em `test_combo_lifecycle.mjs` com o 10/08
  ainda sem resultado; não reproduzível com o resultado gravado. Defeito de UI, fora do escopo
  deste patch de notificação — não misturado aqui de propósito.

---

## v4.0-clean — 2026-06-27

Full clean rebuild from scratch. No code carried over from v3.x.

### Added
- Single IIFE `app.js` — no globals leaking, no module bundler required.
- `config.js`, `data.js`, `i18n.js` as plain `window.*` assignments loaded before `app.js`.
- Admin auth: SHA-256 via `crypto.subtle`, per-action `guardAdmin()`, 30-min session, lockout after N attempts.
- Bracket slot resolution propagates across all rounds; auto-advance when score is non-tie.
- Draft: `sessionStorage` with restore offer on page reload; key `bolao_draft_v4`; 2-hour expiry.
- Scoring: called once per entry in `renderRanking`; bonus computed from `finalPodiumForEntry`.
- Supabase: merge-before-save (fetch remote `updated_at` first); local-first with graceful fallback.
- i18n: 3 languages (PT-BR / ES-MX / EN-US), flag button toggle, no dropdown.
- Receipt: Blob URL + `window.open` — no `document.write`.
- EmailJS: `limitRate: { throttle: 30000 }`, HTML only via `html_message` field.
- CSV exports: `\r\n` line endings for Excel compatibility.
- CSP meta tag (default-src, script-src, connect-src, img-src, style-src, base-uri, frame-ancestors).
- `escapeHtml` applied on every user-data DOM insertion.
- WhatsApp group button and QR in payment section and header.
- Countdown timer with seconds.
- Payment section: CashApp, Zelle (with QR), Venmo.
- Games section: all 72 group + 32 knockout matches.
- Admin exports: master CSV, backup CSV, backup JSON, master HTML.
- Demo data loader.
- API-Football cache refresh in admin (disabled by default).
- Polymarket odds in smart simulator config.
- Transparency disclaimer in rules section.
- `noindex,nofollow` robots meta tag.

### Removed from v3.x
- `i18n-repair.js` patch file.
- PayPal payment method.
- All legacy patch files (`FIX_LOG_*`, `QA_CHECKLIST_v3_*`, `RELEASE_LOCK.md`).

---

## v3.3.4-stable-repair — 2025

- Removed visible language dropdown; replaced with flag buttons.
- Added seconds to countdown timer.
- Removed "A / B" score input labels.
- Repaired rules i18n strings.
- Added Supabase reload on browser focus and visibility change.
- Added admin button to clear remote state.

## v3.3.1-db-ui-fixes — 2025

- Desktop/mobile header layout fix.
- Language selector redesigned as flag buttons.
- Games section redesigned.
- Rules scoring table restored.
- Admin demo data restored.
- Optional API-Football refresh added (caches only).

## v3.3-db-ready — 2025

- Optional Supabase remote state adapter (local-first mirror).
- Phase labels polished.
- Supabase setup docs added.

## v3.2.1-rc1 — 2025

- Corrected UK nation flag emojis.
- Removed initial "Time A / Time B" flash.
- Softer score >20 guard while typing.
- Receipt HTML labels use i18n.

## v3.0 — 2025

Clean rebuild from unstable v2. Fixed from Claude audit: CSV CRLF, admin password handling, EmailJS throttle, score validation, receipt Blob URL, simulator guards, HTML escaping, event delegation, scoring performance.

<!-- AUTO:GOVERNANCE_CHANGELOG:START -->
## Platform governance audit — baseline snapshot (Copa v4.125 / BR2026 v1.13 / CDB2026 v1.6)

Introduced platform-level governance documentation and a cross-app consistency audit covering
all three bolão apps (`bolao/`, `bolao/br2026/`, `bolao/cdb2026/`). Documentation only — no
functional code was changed.

### Added
- `docs/bolao/PLATFORM_GOVERNANCE.md` — change classification categories (`PLATFORM_SHARED`,
  `TOURNAMENT_SPECIFIC`, `DATA_ONLY`, `SECURITY`, `EMERGENCY_HOTFIX`) and propagation rules
  between the three apps.
- `docs/bolao/CONSISTENCY_MATRIX.md` — 60-area audit comparing the three apps (design system,
  admin, security, email/receipts, live scores, i18n, accessibility, CSP, and more).
- `docs/bolao/QA_MASTER_CHECKLIST.md` — cross-app QA checklist (pre-change, static checks,
  functional, visual, cross-app, post-change).
- `AUTO:PLATFORM_RULES` block in `CLAUDE.md` with the mandatory propagation rule.
- `AUTO:PLATFORM_CONTEXT`, `AUTO:MULTI_APP_ARCHITECTURE`, `AUTO:CROSS_APP_QA` blocks in the
  corresponding existing docs, cross-linking to the new governance files.

### Findings summary (see CONSISTENCY_MATRIX.md for detail)
- No Critical divergences found.
- High: BR2026/CDB2026 have no scoring self-audit script equivalent to
  `bolao/scripts/audit_scoring.py`, and no receipt/PDF/email-receipt system for participants
  despite promising "comprovantes" in their own transparency disclaimer.
- Medium: CSV exports in BR2026/CDB2026 use LF instead of the CRLF fix already applied in
  Copa v3.0; no WhatsApp support button or `assets/` folder (payment QR codes) in the two
  newer apps; no `AbortController`/timeout on their `fetch()` calls; CDB2026 has no postponed-
  match detection (BR2026 has it since v1.13); no "clear data" admin action or JSON backup
  export in the two newer apps.

## Governance documentation — permanent memory, lessons learned, DoD/smoke/regression/risk

Documentation-only session. No functional code was changed.

### Added
- `docs/bolao/PROJECT_MEMORY.md` — permanent project memory (history, architecture, per-app
  structure, tech stack, architectural decisions, limitations, database, email, PDF, scoring,
  ranking, admin, APIs, i18n, security, audits performed, historical bugs, tech debt, roadmap),
  extracted entirely from existing docs/code, no invented content.
- `docs/bolao/LESSONS_LEARNED.md` — historical bugs in problem/root-cause/fix/prevention
  format, covering CSV line endings, receipt/PDF flow, EmailJS payload shape, mobile flag/name
  ordering, i18n gaps, admin hash/lockout, hardcoded credentials, event delegation, ranking
  tie-break drift, bonus-scoring drift, popup blockers, Supabase merge strategy, multi-tab/
  bfcache sync, clear-data, API-Football, countdown, mobile layout, Safari/WebKit quirks,
  receipts, backups, localStorage recovery, cross-app consistency drift, and QA process gaps.
- `docs/bolao/QA_MASTER_CHECKLIST.md`: added sections G (Definition of Done), H (Smoke Tests),
  I (Regression Tests), J (Risk Assessment) inside the existing `AUTO:QA_MASTER_CHECKLIST`
  block.
- `CLAUDE.md`: added a "Permanent rules" block inside `AUTO:PLATFORM_RULES` — mandatory reading
  list before any change (`PROJECT_MEMORY.md`, `ENGINEERING_STANDARD.md`,
  `PLATFORM_GOVERNANCE.md`, `CONSISTENCY_MATRIX.md`, `QA_MASTER_CHECKLIST.md`, `CHANGELOG.md`),
  pre-modification checklist, and an explicit never/always list.

### Known gap introduced by this session
- `CLAUDE.md`'s new permanent-rules block and this session's own instructions reference
  `docs/bolao/ENGINEERING_STANDARD.md`, which **does not exist yet**. Tracked as missing
  documentation — see the consistency audit note below and `PROJECT_MEMORY.md`/
  `CONSISTENCY_MATRIX.md` for context. Not created in this session because it wasn't explicitly
  requested as content to author, only as a rule to reference.
<!-- AUTO:GOVERNANCE_CHANGELOG:END -->
