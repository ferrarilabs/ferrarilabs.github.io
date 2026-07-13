# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

No build step. Push to `main` and GitHub Pages auto-deploys to `ferrarilabs.github.io`.

- Main site: `ferrarilabs.github.io`
- Copa do Mundo 2026: `ferrarilabs.github.io/bolao/`
- Brasileirão 2026: `ferrarilabs.github.io/bolao/br2026/` (not published yet)
- Copa do Brasil 2026: `ferrarilabs.github.io/bolao/cdb2026/` (not published yet)
- Old URL redirect: `ferrarilabs.github.io/bolao/` → `/bolao/`

To preview locally:
```bash
python3 -m http.server 8080
# Open: http://localhost:8080/bolao/
```

## Repository structure

Three independent sub-projects:

**Main site** (`index.html`, `index.pt.html`, `index.es.html`, `index.jp.html`, `styles.css`) — static multilingual personal site about Eduardo Ferrari's work in financial crime/AML/AI compliance. Contact form uses Formspree + Cloudflare Turnstile (keys must be set manually in the HTML).

**Copa do Mundo 2026** (`bolao/`) — bracket pool. Vanilla JS, no framework, no build system. URL: `ferrarilabs.github.io/bolao/`.

**Brasileirão 2026** (`bolao/br2026/`) — G4/Z4 classification picks with live ESPN standings. Not published yet (no link from main site). URL: `ferrarilabs.github.io/bolao/br2026/`.

**Copa do Brasil 2026** (`bolao/cdb2026/`) — knockout-round picks with real teams. Not published yet (no link from main site). URL: `ferrarilabs.github.io/bolao/cdb2026/`.

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
  and `check_result_shape()` in `bolao/scripts/audit_scoring.py`.
- **After every change you make to this repo — whether or not it looks scoring-related —
  run `python3 bolao/scripts/audit_scoring.py` and say so in your summary to Eduardo, even
  if the answer is just "scoring untouched, audit still passes."** Don't assume a change is
  unrelated; the two bugs found in the July 2026 audit were both in code that looked
  unrelated to whatever was being worked on at the time.
- If you change the bracket (`bolao/js/data.js`'s `knockoutMatches`), the scoring formula,
  the tiebreak cascade, or anything in `bolao/scripts/send_result_email.py`, treat
  `audit_scoring.py` failing as a hard blocker — fix it before opening a PR, not after.

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
- See `bolao/docs/DATABASE_SETUP_SUPABASE.md` for SQL setup.

### Release process

1. Edit files under `bolao/`.
2. Bump `siteVersion` in `js/config.js`.
3. Add a CHANGELOG entry in `bolao/CHANGELOG.md`.
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

Also see `bolao/docs/` for low-level setup guides (Supabase SQL, API-Football, deploy steps).

<!-- AUTO:PLATFORM_RULES:START -->
## Platform governance (three apps)

This repo runs **three independent bolão apps** that share one design system and one set of
conventions: `bolao/` (Copa do Mundo 2026, **in production**), `bolao/br2026/` (Brasileirão
2026, not published), and `bolao/cdb2026/` (Copa do Brasil 2026, not published). They do not
share code (no imports between them) but they are audited together.

**Propagation rule — mandatory:**

> Uma alteração visual, de componente, acessibilidade, segurança, banco, email, receipt,
> admin ou infraestrutura feita em um aplicativo deve ser auditada nos demais aplicativos
> antes do encerramento da tarefa.

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

1. `docs/bolao/PROJECT_MEMORY.md`
2. `docs/bolao/ENGINEERING_STANDARD.md`
3. `docs/bolao/PLATFORM_GOVERNANCE.md`
4. `docs/bolao/CONSISTENCY_MATRIX.md`
5. `docs/bolao/QA_MASTER_CHECKLIST.md`
6. `bolao/CHANGELOG.md` (e o `CHANGELOG.md` de cada app afetado)

### Antes de modificar qualquer arquivo

- Identificar a categoria da mudança (`PLATFORM_SHARED` / `TOURNAMENT_SPECIFIC` / `DATA_ONLY` /
  `SECURITY` / `EMERGENCY_HOTFIX` — ver `PLATFORM_GOVERNANCE.md`).
- Identificar quais dos três aplicativos (`bolao/`, `bolao/br2026/`, `bolao/cdb2026/`) são
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

A Copa do Mundo 2026 (`bolao/`) é a referência visual canônica da plataforma. Todo novo
componente ou alteração visual em BR2026 ou CDB2026 deve primeiro localizar o componente
equivalente na Copa e reproduzir seus tokens, dimensões, alinhamento, espaçamento e
responsividade, salvo diferença explicitamente documentada como `TOURNAMENT_SPECIFIC`.

Nenhuma tarefa visual pode ser encerrada apenas com `node --check` (quando disponível). É
obrigatória comparação visual cross-app em desktop e mobile antes de considerar a tarefa
concluída.
<!-- AUTO:PLATFORM_RULES:END -->
