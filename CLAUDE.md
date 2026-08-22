# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

No build step. Push to `main` and GitHub Pages auto-deploys.

**A origem de produção é `https://www.ferrarilabs.com`** (definida pelo `CNAME` na raiz do repo).
`ferrarilabs.github.io` e o apex `ferrarilabs.com` respondem **301** para lá — nenhuma página de
produção executa neles. Qualquer código que compare `location.origin` com `ferrarilabs.github.io`
está errado para 100% do tráfego real (já causou um incidente: ver `docs/bolao/TEST_ISOLATION.md`).
As URLs abaixo usam o caminho canônico `www.ferrarilabs.com`.

O bump de cache-bust (`?v=`) é feito pelo bot `sync_version.yml`, que **dispara o deploy do Pages
explicitamente** — um push com `GITHUB_TOKEN` não acorda workflow nenhum. Verificar deploy sempre
comparando o `?v=` ao vivo com o do repositório.

- Main site: `www.ferrarilabs.com`
- Bolão root: `www.ferrarilabs.com/bolao/` — redirects to Brasileirão (see below)
- Copa do Mundo 2026: `www.ferrarilabs.com/bolao/copa2026/` (moved here 2026-07-19, v4.159 — see "Copa do Mundo 2026 archive" below)
- Brasileirão 2026: `www.ferrarilabs.com/bolao/br2026/` (not published yet)
- Copa do Brasil 2026: `www.ferrarilabs.com/bolao/cdb2026/` (published 2026-07-19, in production)

To preview locally:
```bash
python3 -m http.server 8080
# Open: http://localhost:8080/bolao/br2026/
```

## Repository structure

Three independent sub-projects:

**Main site** (`index.html`, `index.pt.html`, `index.es.html`, `index.jp.html`, `styles.css`) — static multilingual personal site about Eduardo Ferrari's work in financial crime/AML/AI compliance. Contact form uses Formspree + Cloudflare Turnstile (keys must be set manually in the HTML).

**Copa do Mundo 2026** (`bolao/copa2026/`) — bracket pool, tournament concluded (Spain champion, 2026-07-19) and archived. Vanilla JS, no framework, no build system. URL: `www.ferrarilabs.com/bolao/copa2026/`. See "Copa do Mundo 2026 archive" below.

**Brasileirão 2026** (`bolao/br2026/`) — G4/Z4 classification picks with live ESPN standings. Not published yet (no link from main site). URL: `www.ferrarilabs.com/bolao/br2026/`.

**Copa do Brasil 2026** (`bolao/cdb2026/`) — knockout-round picks with real teams. Published 2026-07-19 (in production, invited by email). URL: `www.ferrarilabs.com/bolao/cdb2026/`.

## Copa do Mundo 2026 archive (v4.157–v4.159, 2026-07-19)

Eduardo, after the Final concluded: "Copa do mundo finalizada! ... Desabilitar os botões todos,
deixar só o vencedor, auditoria e os palpites" (v4.157 — `CONFIG.archived` in `js/config.js`
hides every nav button except Ranking, which already has the podium banner, audit report link,
and "Ver palpites" per-entry detail), then "Deixe o default do site como o Brasileiro agora" —
confirmed he wanted a real redirect, not just the switcher's default option changing (v4.158 had
only done the latter). A real redirect at `bolao/index.html` required moving the whole app so the
archived Ranking would still have a URL of its own — so the entire Copa app (was directly under
`bolao/`) moved to `bolao/copa2026/` (v4.159), matching the `br2026/`/`cdb2026/` folder pattern.

- `bolao/index.html` is now a redirect (meta refresh + JS `location.replace`) to `/bolao/br2026/`.
- `bolao/audit-report.html`, `audit-detail-picks.html`, `audit-detail-governance.html`, and
  `classificacao-geral.html` are redirect stubs pointing into `bolao/copa2026/` — these paths
  were already emailed to real participants before the move and must keep resolving.
- `bolao/sw.js` is left in place unchanged (harmless, generic — no app-specific paths) as a
  safety net for any browser that still has the old `/bolao/`-scoped service worker registered;
  the live app now registers its own copy at `bolao/copa2026/sw.js`.
- The "Copa do Mundo" option in all three apps' "Alternar bolão" switcher now points at
  `/bolao/copa2026/`, not `/bolao/` (pointing at `/bolao/` would loop back to the redirect).
- Reversible: to make Copa the default again, edit `bolao/index.html`'s redirect target back to
  `/bolao/copa2026/` and flip `CONFIG.archived` to `false` in `bolao/copa2026/js/config.js`.

## Bolão app — quick reference

### Script load order

1. `@emailjs/browser@4` (CDN, sync)
2. `@supabase/supabase-js@2` (CDN, sync)
3. `js/config.js` → `window.BOLAO_CONFIG`
4. `js/data.js` → `window.BOLAO_DATA`
5. `js/i18n.js` → `window.BOLAO_I18N`
6. `js/app.js` (defer — all logic in a single IIFE)

### Key files

| File | Purpose |
|---|---|
| `js/config.js` | Runtime config: scoring, payments, Supabase, EmailJS, cutoff date, admin hash |
| `js/data.js` | Fixture data: 72 group + 32 knockout matches, team flags, strength ratings |
| `js/i18n.js` | All UI strings in **3 languages**: `pt-BR`, `es`, `en-US` |
| `js/app.js` | Single IIFE (~1430 lines): all state, rendering, validation, scoring, admin |
| `css/styles.css` | All styles — mobile-first, responsive |
| `index.html` | Single page; sections shown/hidden by JS |

### State

- **localStorage key:** `bolao_copa_2026_state`
- **Supabase table:** `bolao_state`, single row `id = "main"`, column `state jsonb`
- **Draft key:** `sessionStorage["bolao_draft_v4"]` (2-hour expiry)
- **Language key:** `localStorage["bolao_lang"]`
- App is local-first: Supabase failure degrades gracefully.

### Scoring (configured in `js/config.js`)

- Exact score: **10 pts**
- Correct advancement: **5 pts**
- One team's goals correct: **1 pt**
- Bonus: champion **+25**, runner-up **+15**, 3rd **+10**, 4th **+5**
- Prize pool: 70% → 1st, 20% → 2nd, 10% → 3rd

**This is the part of the site that can never be broken — real money is paid out based on it.**
Standing rule from Eduardo (July 2026, after an audit found `send_result_email.py` had
silently drifted from the site's own scoring logic — see CHANGELOG v4.57):

- `send_result_email.py --auto` runs `audit_scoring.py`'s static self-test suite before
  touching anything, and refuses to send any email if it fails. It also re-validates each
  individual match at runtime (event date not in the future, teams fully resolved, result
  shape sane) right before trusting it enough to save + email — see `check_match_is_real()`
  and `check_result_shape()` in `bolao/copa2026/scripts/audit_scoring.py`.
- **After every change you make to this repo — whether or not it looks scoring-related —
  run `python3 bolao/copa2026/scripts/audit_scoring.py`, `python3 bolao/br2026/scripts/audit_scoring.py`,
  and `python3 bolao/cdb2026/scripts/audit_scoring.py`, and say so in your summary to Eduardo, even
  if the answer is just "scoring untouched, audit still passes."** Don't assume a change is
  unrelated; the two bugs found in the July 2026 audit were both in code that looked
  unrelated to whatever was being worked on at the time.
- If you change the bracket (`bolao/copa2026/js/data.js`'s `knockoutMatches`), the scoring
  formula, the tiebreak cascade, or anything in `bolao/copa2026/scripts/send_result_email.py`,
  treat `audit_scoring.py` failing as a hard blocker — fix it before opening a PR, not after.

### Admin

- Password stored as SHA-256 hash in `config.adminPasswordHash`. Plaintext never in source.
- Lockout: 5 failed attempts → 15-min block.
- Session: 30 min, `sessionStorage`, cleared on tab close.
- `guardAdmin()` called on every admin action.

To generate a new hash:
```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("YourPassword"))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")))
```

### Cutoff

- `cutoffIso: "2026-06-28T14:00:00-04:00"` — Sunday June 28 2026 at 2 PM ET.
- Enforcement is client-side only (clock manipulation bypasses it).

### EmailJS

- Template body must contain **only** `{{{html_message}}}` — no other fields.
- Rate limit: 30-second throttle per browser.
- Two templates: participant receipt (`participantTemplateId`) + admin notification (`adminTemplateId`).

### i18n

All UI strings are in `js/i18n.js`. **Three language objects:** `pt-BR`, `es`, `en-US`.
When adding a new key, add it to all three objects. Default fallback is `pt-BR`.

### Supabase

- `database.enabled: true` in config to activate.
- Only anon key used — never the service_role key.
- RLS restricts all operations to `id = 'main'`.
- Merge strategy: union entries, local wins for paid/results.
- See `bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md` for SQL setup.

### Release process

1. Edit files under `bolao/copa2026/` (or `bolao/br2026/`, `bolao/cdb2026/` for those apps).
2. Bump `siteVersion` in that app's `js/config.js`.
3. Add a CHANGELOG entry in that app's `CHANGELOG.md` (e.g. `bolao/copa2026/CHANGELOG.md`).
4. Commit and push to `main`.
5. Run QA checklist from `docs/bolao/QA_CHECKLIST.md`.

### Rollback

```bash
git revert HEAD && git push
# or
git checkout <previous-commit> -- bolao/
git commit -m "Revert bolao to <version>"
git push
```

## Full documentation

All extended documentation is in `docs/bolao/`:

- `PROJECT_CONTEXT.md` — product vision, rules, scoring, tournament facts
- `REQUIREMENTS.md` — all features as implemented
- `ARCHITECTURE.md` — file structure, state shape, key functions, Supabase schema
- `SECURITY.md` — CSP, XSS prevention, admin auth, key exposure, known limitations
- `QA_CHECKLIST.md` — complete test checklist for every deploy
- `BUGS_AND_FEEDBACK.md` — open bugs, fixed bugs, user feedback, wishlist
- `CHANGELOG.md` — consolidated version history
- `ROADMAP.md` — planned and discussed future work
- `PROJECT_MEMORY.md` — permanent project memory: history, architecture, decisions, limitations, bugs, tech debt
- `LESSONS_LEARNED.md` — historical bugs in problem/root-cause/fix/prevention format

Also see `bolao/copa2026/docs/` for low-level setup guides (Supabase SQL, API-Football, deploy steps).

<!-- AUTO:PLATFORM_RULES:START -->
## Platform governance (three apps)

This repo runs **three independent bolão apps** that share one design system and one set of
conventions: `bolao/copa2026/` (Copa do Mundo 2026, **concluded and archived** 2026-07-19 —
no longer the default `/bolao/` destination, see "Copa do Mundo 2026 archive" above),
`bolao/br2026/` (Brasileirão 2026, not published — entries closed 2026-07-16, now the default
`/bolao/` destination), and `bolao/cdb2026/` (Copa do Brasil 2026,
**published 2026-07-19, in production**). They do not share code (no imports between them) but
they are audited together.

**Propagation rule — mandatory:**

> Uma alteração visual, de componente, acessibilidade, segurança, banco, email, receipt, PDF,
> admin ou infraestrutura feita em um aplicativo deve ser auditada nos demais aplicativos
> antes do encerramento da tarefa.

**Golden master rule — mandatory:**

> A Copa do Mundo 2026 (`bolao/copa2026/`) é a referência visual canônica. BR2026 e CDB2026 devem copiar
> seus padrões visuais, não sua lógica de torneio.

Additional rules:

- Correções compartilhadas devem ser propagadas quando fizer sentido.
- Diferenças específicas de torneio (scoring, bracket, regras) devem ser preservadas — não
  generalizar entre apps.
- Quando uma alteração não for propagada, o motivo deve ser registrado (no changelog do app e,
  se for uma decisão de plataforma, em `docs/bolao/CONSISTENCY_MATRIX.md`).
- Nunca alterar scoring ou regras de negócio em nenhum dos três apps sem autorização explícita
  do Eduardo — os três movimentam dinheiro real por entrada.
- O bolão da Copa está em produção e deve receber apenas patches pequenos, testados e
  reversíveis.
- Mudanças no bolão da Copa devem ser avaliadas nos outros dois apps.
- Mudanças nos outros dois apps não devem ser aplicadas automaticamente à Copa sem avaliação
  de risco.

Full detail, change classification categories, and the area-by-area audit:

- `docs/bolao/PLATFORM_GOVERNANCE.md` — governance rules and change classification
- `docs/bolao/CONSISTENCY_MATRIX.md` — area-by-area consistency audit across the three apps
- `docs/bolao/QA_MASTER_CHECKLIST.md` — cross-app QA checklist (pre-change through post-change)

## Permanent rules

### TODA MUDANÇA DEVE RODAR `npm run check` ANTES DE SER CONCLUÍDA

**Comando canônico: `npm run check`.** Nenhuma tarefa está concluída sem ele — `NPM_RUN_CHECK = PASS`.

Isto vale para toda mudança, inclusive as que "não têm relação" com scoring, hero, e-mail ou
banco. Os dois defeitos achados na auditoria de julho/2026 estavam justamente em código que
parecia não ter relação com o que estava sendo mexido.

`npm run check` compõe: classificação da mudança + contrato de segurança + a suíte canônica
(`scripts/verify.mjs`, 150 checks, agregados) + verificação de árvore/evidência. Ele é a única
porta de entrada — não crie um segundo comando canônico e não invente uma suíte paralela.

Variantes: `npm run check -- --with-npm-test` (roda também a cadeia literal do `npm test`);
`npm run check -- --fast` (pula o grupo `browser` — **não vale como verificação final**).

**Superfícies críticas não podem mudar incidentalmente.** Se uma mudar de propósito, o agente
deve, nesta ordem:

1. **declarar** a superfície protegida em `CHANGE_INTENT.json`
   (`surface_id`, `reason`, `expected_behavior_change`, `tests_required`);
2. **explicar por quê**, no changelog do app afetado e no resumo para o Eduardo;
3. **rodar os gates dedicados** da superfície (`required_gates` no registro);
4. **reportar explicitamente** a mudança — nunca deixá-la implícita num diff grande.

O registro canônico é `bolao/shared/safety/critical_surfaces.json` (23 superfícies — o número
estava desatualizado em 22 até a Issue #253 acrescentar `EDGE_FUNCTIONS`) e o manifesto
de notificação é `bolao/shared/safety/notification_workflows.json`. Documentação completa em
`docs/bolao/CHANGE_SAFETY_CONTRACT.md`.

Uma mudança **comum não declara nada** — `CHANGE_INTENT.json` nem precisa existir. A ausência é o
estado normal, e a declaração existe para o caso raro, não para o dia a dia. Depois que a mudança
entra em `main` a declaração fica obsoleta e **deve ser removida** (o check `D3` exige isso).

**Nunca** enfraqueça um gate para deixar um patch verde: remover um check do `verify.mjs`, tirar
um comando da cadeia do `npm test`, introduzir um `skip`, esvaziar as assertions de um gate,
alargar o `ALLOWLIST.json`, estreitar um gatilho de CI ou apagar um cron. Todos esses caminhos
são detectados contra a base do git e todos têm mutação provando que mordem
(`npm run safety:mutations`, 16/16). Se um gate está errado, corrija o gate e diga que corrigiu —
não o silencie.

### Repository is the source of truth (all devices, all sessions)

Every Claude Code session, regardless of device, must read the same repository governance
documents before editing.

The repository is the source of truth. Conversation memory, device history, and prior session
context must never override the current checked-out code and documentation.

Before any edit, Claude must report:

- current branch;
- git status;
- latest commit;
- applications affected;
- change classification;
- cross-app propagation decision.

Mobile sessions are subject to the same audit, testing, documentation, and cross-app
consistency requirements as desktop sessions. Reduced screen size or session duration is not
justification for skipping validation.

### Sempre ler antes de qualquer alteração

1. `docs/bolao/CHANGE_SAFETY_CONTRACT.md` — o contrato permanente e o comando canônico `npm run check`
2. `docs/bolao/PROJECT_MEMORY.md`
3. `docs/bolao/ENGINEERING_STANDARD.md`
4. `docs/bolao/PLATFORM_GOVERNANCE.md`
5. `docs/bolao/CONSISTENCY_MATRIX.md`
6. `docs/bolao/QA_MASTER_CHECKLIST.md`
7. `CHANGELOG.md` de cada app afetado (`bolao/copa2026/CHANGELOG.md`, `bolao/br2026/CHANGELOG.md`, `bolao/cdb2026/CHANGELOG.md`)

### Antes de modificar qualquer arquivo

- Identificar a categoria da mudança (`PLATFORM_SHARED` / `TOURNAMENT_SPECIFIC` / `DATA_ONLY` /
  `SECURITY` / `EMERGENCY_HOTFIX` — ver `PLATFORM_GOVERNANCE.md`).
- Identificar quais dos três aplicativos (`bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/`) são
  afetados.
- Verificar a necessidade de propagação para os demais aplicativos.
- Analisar riscos antes de editar (ver seção "Risk Assessment" em `QA_MASTER_CHECKLIST.md`).

### Nunca

- Reescrever arquivos inteiros quando um patch mínimo resolve.
- Alterar scoring sem autorização explícita do Eduardo.
- Alterar regras de negócio sem autorização explícita do Eduardo.
- Misturar refatoração com correção de bug no mesmo patch.
- Deixar `TODO` novo sem justificativa registrada.
- Deixar `FIXME` novo.
- Deixar `console.log` esquecido em código de produção.
- Deixar bloco `catch` vazio sem comentário explicando por que o erro é intencionalmente
  ignorado.

### Sempre

- Patch mínimo, cirúrgico, reversível.
- QA (rodar `docs/bolao/QA_CHECKLIST.md` e/ou `docs/bolao/QA_MASTER_CHECKLIST.md` conforme a
  categoria da mudança).
- Atualizar o changelog do(s) app(s) alterado(s).
- Atualizar `docs/bolao/CONSISTENCY_MATRIX.md` quando a mudança resolve, cria ou altera uma
  divergência já catalogada.
- Atualizar a documentação relevante junto com o código, no mesmo patch.
- Comparar a implementação equivalente entre os três aplicativos antes de considerar a mudança
  concluída.

Toda alteração visual, de componente, acessibilidade, segurança, banco, email, admin, PDF,
comprovante ou infraestrutura deve ser auditada nos demais aplicativos antes do encerramento da
tarefa — ver a regra de propagação acima.

### Toda vez que um componente visual for alterado

1. Localizar **todas** as ocorrências desse componente na plataforma (nos três apps, e em mais
   de um lugar dentro do mesmo app quando aplicável — ex.: um símbolo de time pode aparecer no
   card de jogo, no formulário de palpites e no ranking).
2. Comparar visualmente todas elas (tamanho, cor, posição, comportamento responsivo).
3. Atualizar todas as ocorrências que deveriam ser iguais.
4. Se alguma ocorrência permanecer diferente de propósito, registrar como
   `INTENTIONALLY_DIFFERENT` em `docs/bolao/CONSISTENCY_MATRIX.md`, com o motivo.

Nunca encerrar uma tarefa que tocou UI sem executar essa comparação — mesmo que a mudança
pareça isolada a um único app.

### Auditoria obrigatória antes de mudanças de maior risco

Antes de qualquer alteração classificada como `PLATFORM_SHARED`, `SECURITY`,
`EMERGENCY_HOTFIX`, mudança visual relevante, alteração de banco, alteração de scoring,
alteração de admin, alteração de email/PDF/comprovante, ou release candidate/produção: ler e
aplicar `docs/bolao/AUDIT_PROTOCOL.md`.

- Para alterações pequenas, executar no mínimo uma auditoria direcionada ao escopo alterado.
- Para alterações grandes, executar auditoria completa (todas as áreas do protocolo).
- Auditoria e implementação são etapas separadas — ver `docs/bolao/ENGINEERING_STANDARD.md`
  ("Audit-first workflow").
- Não corrigir silenciosamente tudo que a auditoria encontrar. Primeiro apresentar os findings
  e o plano; implementar somente os itens autorizados pelo usuário.
- Depois de implementar, executar uma auditoria de regressão direcionada ao que foi alterado.
- Componentes equivalentes entre os três apps devem seguir `docs/bolao/DESIGN_SYSTEM.md`;
  diferenças não corrigidas devem ser registradas como `INTENTIONALLY_DIFFERENT` ou dívida
  técnica, nunca deixadas sem registro.

### Copa do Mundo 2026 é a referência visual canônica

A Copa do Mundo 2026 (`bolao/copa2026/`) é a referência visual canônica da plataforma. Todo novo
componente ou alteração visual em BR2026 ou CDB2026 deve primeiro localizar o componente
equivalente na Copa e reproduzir seus tokens, dimensões, alinhamento, espaçamento e
responsividade, salvo diferença explicitamente documentada como `TOURNAMENT_SPECIFIC`.

Nenhuma tarefa visual pode ser encerrada apenas com `node --check` (quando disponível). É
obrigatória comparação visual cross-app em desktop e mobile antes de considerar a tarefa
concluída.

### Movimento de clube vs. movimento de participante no BR2026

No BR2026, movimento de clube na classificação e movimento de participante no ranking são
conceitos distintos. Ambos devem usar baseline estável, não a atualização anterior, e nunca podem
compartilhar a mesma estrutura de estado por conveniência.

### Projeção do Bolão no BR2026

No BR2026, toda classificação exibida antes do encerramento do Brasileirão deve ser tratada como
projeção. Nunca apresentar pontuação, posição ou vencedor provisório como resultado definitivo.
Ver `docs/bolao/BR2026_PROJECTION_MODEL.md` para a fórmula, o índice de precisão informativo e a
linguagem obrigatória na UI.

### Padronização visual — regras adicionais (2026-07-14)

Complementam as seções acima (não substituem — algumas regras abaixo já estavam parcialmente
cobertas em outro texto deste arquivo; aqui ficam explícitas e diretas):

- Não alterar scoring ou regra de torneio durante uma tarefa de padronização visual, mesmo que
  pareça pequeno ou relacionado — padronização visual e mudança de regra de negócio nunca são o
  mesmo patch.
- Não corrigir um app quebrando outro. Rodar a suíte de testes do app alterado E confirmar que os
  outros dois continuam passando antes de considerar a tarefa concluída.
- Antes de editar um arquivo, registrar (mentalmente ou em nota) o comportamento atual que
  precisa ser preservado — não só o que vai mudar.
- Depois do patch, provar que esse comportamento foi preservado (teste automatizado ou
  verificação manual explícita), não apenas assumir.
- Não copiar lógica de torneio junto com o visual. Reproduzir tokens/estrutura/CSS da Copa é
  sempre correto; copiar sua fórmula de scoring, bracket ou regra de avanço para outro app nunca
  é — cada app preserva sua própria lógica de torneio.
- Toda regressão encontrada durante a tarefa deve ser reportada, mesmo que fora do escopo
  original da mudança — nunca corrigida silenciosamente sem menção, nem ignorada.
- Se um teste falhar, parar e investigar antes de continuar ampliando o diff. Não seguir
  adicionando mudanças novas em cima de uma suíte vermelha.
<!-- AUTO:PLATFORM_RULES:END -->

## Autonomia em `supabase/functions/**` (Edge Functions) — Issue #253

**Merge neste caminho PODE implantar em produção — e pode silenciosamente não implantar.**

A integração do Supabase com o GitHub roda a cada push em `main` (aparece como o check
`Supabase Preview`). Ela chegou a implantar a Edge Function 39 segundos depois do merge do PR #252
(Issue #253), e por isso este documento afirmava um SLA de segundos.

**Esse SLA não existe** (Issue #306). Em 2026-08-22 a Issue #296 entrou em `main` com CI verde e
ficou **horas** sem chegar à produção: a integração aplica as **migrações antes** de implantar as
funções, uma migração não-idempotente falhava com `SQLSTATE 42710`, e o pipeline **abortava antes do
deploy**. O check `Supabase Preview` falhava — mas ele é externo, não reprova nada no repositório, e
ninguém foi avisado. A divergência foi encontrada por `curl` manual.

O que é realmente garantido:

1. o merge **dispara** o pipeline de deploy;
2. o sucesso do deploy **não é** garantido — ele depende de as migrações aplicarem primeiro;
3. o deploy só conta como ocorrido quando **observado**;
4. `main` verde **nunca** é evidência de produção.

> **"merge aconteceu" ≠ "produção implantada".** Só há deploy quando há evidência de deploy.

A evidência é o header `x-deploy-sha`, que a função devolve com o SHA do próprio código-fonte
(`supabase/functions/_shared/deploy_manifest.js`). O gate `live-function-drift`
(`scripts/db/audit_live_function_drift.mjs`) recalcula esse SHA a partir dos arquivos e reprova se o
manifesto não acompanhar; com `VERIFY_ALLOW_NETWORK=1` ele compara com produção e classifica
`LIVE_MATCHES_MAIN` / `LIVE_DRIFT` / `DEPLOY_PENDING` / `UNKNOWN` — e **`UNKNOWN` reprova**, porque
"não consegui medir" jamais pode parecer "está tudo bem".

O gate `migration-idempotency` (`scripts/db/audit_migration_idempotency.mjs`) impede a causa raiz:
uma migração nova que não seja reaplicável trava o pipeline inteiro, inclusive o deploy das funções.

Não existe passo de deploy separado onde pausar: quando funciona, o merge **é** o deploy.

Por isso `supabase/functions/**` (e `supabase/config.toml`) é a superfície `EDGE_FUNCTIONS`,
`DECLARE_TO_CHANGE` — mudar sem declarar reprova em `D2`, com mutação `M34` provando que morde.

Classificação de autonomia (decisão do Eduardo):

| classe | o que é |
|---|---|
| **GREEN** | investigação somente-leitura; testes; documentação; ferramenta local determinística; mudança **exclusivamente de observabilidade** cuja neutralidade sobre o runtime e o contrato de resposta esteja **provada**, não afirmada |
| **YELLOW** | qualquer mudança funcional; comportamento com provedor externo; comportamento de cache; contrato de resposta; qualquer coisa implantável que altere o runtime de produção |
| **RED** | mutação de schema/dado além do cache público aprovado; segredo ou autenticação; qualquer impacto em participante, pagamento, scoring, e-mail ou dado privado |

Claude pode implementar, testar e abrir PR para YELLOW. **Merge e deploy de YELLOW e RED exigem
autorização humana explícita.** GREEN segue a política autônoma normal.

Preservar sempre, salvo autorização explícita em contrário: validação antes da promoção a cache,
o comportamento de falhar honestamente com `SOURCE_UNAVAILABLE`, o contrato de resposta atual e o
teto de 10 minutos de último-bom-conhecido (`LAST_KNOWN_GOOD_MAX_AGE_MS`).

## AI agent PII handling

Added 2026-08-18 after the HIST-091/HIST-093 investigation, where a normal-looking analysis pass
accidentally printed raw participant emails into conversation output twice (a context-window
slicing bug, and an unredacted `%s` commit-subject print). Full detail:
`docs/bolao/SECURITY.md` ("Commit-message PII prevention"); the detection engine itself is
`scripts/pii_detectors.mjs`, run via `npm run pii:check`.

- Never put raw participant PII (email, payment reference, name in a sensitive operational
  context) into a GitHub Issue, PR description, commit message, or this file. Use a redacted
  fingerprint (`mask()` in `scripts/pii_detectors.mjs`) or a neutral alias instead.
- Before printing any git-log/commit-message output that might contain real values (subjects,
  bodies, `%B`/`%s` formats), redact known-sensitive patterns first — do not assume a value is
  safe because it appeared in a "context" snippet rather than a direct print.
- Store raw sensitive working data (extracted values, investigation notes) outside this
  repository — `~/Documents/GitHub/ferrarilabs-work/` on Eduardo's machine, `chmod 600`, never
  `git add`ed. Never inside this repo, gitignored or not.
- Test fixtures needing an email-shaped value use a reserved domain (`.invalid` preferred); a
  payment-ID-shaped fixture uses this repo's declared synthetic prefix (`SYNTH-`/`FIXTURE-`/…) or
  is assembled at runtime. Never a real-looking value, even fictionally — see
  `scripts/test_fixture_privacy.mjs`'s zero-exception rule.
- Classify findings before treating them as a confirmed vulnerability: **FACT** (independently
  verified against current repo/GitHub state), **INFERENCE** (a reasonable read of evidence, not
  independently confirmed), **UNKNOWN** (insufficient evidence either way). Say which one a claim
  is; do not present an inference as a fact.
- A Git history rewrite (removing PII from already-published commits) is a destructive operation
  requiring Eduardo's explicit, separate authorization — never bundle it into a "cleanup" or
  "prevention" task, and never treat a forward-only control as making history remediation
  unnecessary. They are two different decisions (`docs/bolao/adr/ADR-011-forward-only-pii-prevention.md`).

## GitHub Issues governance

GitHub Issues is the canonical engineering work tracker for this repository. This section
integrates with — and never overrides — the `npm run check` gate, the critical-surfaces
contract, and the platform governance rules above; when they conflict, the stricter rule wins.

### Lifecycle for material work

Issue → investigation → root-cause analysis → dedicated branch/worktree → implementation →
tests → PR → review → deployment → validation → close Issue.

"Material work" means anything that isn't a one-line, obviously-safe fix: bug fixes, incidents,
data issues, security findings, features, and any change touching a
`bolao/shared/safety/critical_surfaces.json` surface. Trivial fixes (typos, formatting,
comment-only changes) don't require an Issue first.

### Rules

- Read the complete Issue and all its comments before starting implementation. Do not assume
  the title tells the whole story.
- Investigate before editing — confirm the root cause, don't guess from the symptom.
- Do not silently fix unrelated defects found along the way. Open a separate Issue for them and
  say so in the PR description; do not fold them into the current diff.
- Use a dedicated branch (or `git worktree`, checking `git worktree list` first per the
  `EnterWorktree`/`ExitWorktree` convention already in use in this repo) per Issue — never mix
  unrelated Issues in one branch.
- **Trabalho automatizado nunca muta a worktree PRINCIPAL.** Ela é compartilhada entre sessões.
  Agente cria a sua própria (`git worktree add ../ferrarilabs-auto-issue-<N> -b auto/issue-<N>-<slug>
  origin/main`) e trabalha só lá. Trabalho HUMANO na árvore canônica continua livre — a guarda
  existe para impedir automação acidental, não para brigar com o dono do repositório (Issue #251).
  Ative com `npm run guard:install` (aponta `core.hooksPath` para `.githooks/`); os ganchos barram
  `commit`, `merge-commit`, `rebase` e `push` vindos de sessão de agente na árvore principal, e
  deixam CI passar (`bolao_provider_snapshot.yml` commita de um runner). Escape deliberado e
  visível: `ALLOW_CANONICAL_TREE_WRITE=1 <comando>`. **Limite honesto:** o git não tem gancho
  `pre-checkout`, então `checkout`/`switch`/`reset`/`clean`/`stash` **não** são bloqueáveis — nem
  o comando exato que originou a #251. A guarda impede o dano pior e oferece
  `assertSafeToMutate()` para scripts orquestrados chamarem antes de mutar.
- Reference the Issue number in commit messages when practical (e.g. `fix(cdb2026): ... (#42)`),
  but never fabricate a reference to an Issue that doesn't exist.
- PRs must fill out every section of `.github/pull_request_template.md` — in particular Risk,
  Rollback, Data Impact, and Scoring/Ranking Impact must never be left blank or "N/A" without
  actually having checked.
- `Closes #NNN` in a PR means the Issue is fully resolved by that PR — use `Relates to #NNN`
  for partial work, and leave the Issue open.
- **Nunca escreva uma palavra-chave de fechamento dentro de uma negação** — `does not fix #NNN`,
  `doesn't close #NNN`, `não fix #NNN`. O parser do GitHub é léxico: ele casa `fix #NNN`, ignora
  a negação e FECHA a Issue mesmo assim. Foi assim que a #246 (incidente de produção em aberto)
  foi fechada por um commit escrito justamente para dizer que ela continuava aberta. Escreva com
  o substantivo na frente — `Issue #NNN remains unresolved`, `Related to #NNN; still open`. O
  gate `closure-keyword-gate` (`scripts/audit_commit_message_closure_keywords.mjs`) reprova essa
  redação em mensagens de commit novas; ele não enxerga corpo de PR, então lá a regra é sua.
- Scoring/ranking/entries/payment changes still require Eduardo's explicit authorization
  regardless of whether an Issue exists — an Issue is not itself authorization.

### Historical Issues

Some Issues in this tracker are retrospective reconstructions of problems that were already
found and fixed before Issue-tracking existed here (see `/historical-scan`,
`/historical-review`, `/historical-publish`). For those:

- The Issue body must state explicitly that it is a historical record, and must give the real
  original-occurrence and resolution dates separately from the GitHub-assigned creation
  timestamp — the creation timestamp is not the incident date.
- Root cause must distinguish what was actually documented/observed at the time from what is
  now being inferred with hindsight.
- Never rewrite Git history (no rebase, no amend, no forced timestamp edits) merely to make an
  old commit reference an Issue number that didn't exist yet when the commit was made. The
  Issue links to the commit; the commit does not need to link back.
- Historical Issues are created only through the governed backfill workflow (candidate list →
  human review → explicit approval → `/historical-publish`), never in bulk and never
  speculatively.
