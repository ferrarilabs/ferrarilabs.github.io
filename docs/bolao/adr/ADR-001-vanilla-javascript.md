# ADR-001 — Vanilla JavaScript, sem framework, sem build step

**Status:** Aceito (retroativo — documenta uma decisão já tomada e em produção desde a v1 dos
três apps; não é uma proposta de mudança).
**Data:** 2026-08 (registrado nesta forma na Fase 2 de modernização; a decisão original é
anterior a este documento).
**Aplica-se a:** `bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/` (decisão de plataforma).

## Contexto

Os três apps rodam inteiramente client-side, publicados via GitHub Pages, sem servidor próprio,
sem etapa de build (`CLAUDE.md`: "No build step. Push to `main` and GitHub Pages auto-deploys").
Cada app é uma única IIFE em `js/app.js` carregada por `<script>` comum, mais `config.js`,
`data.js`, `i18n.js` como globais em `window`.

## Decisão

Não usar React/Vue/Svelte/qualquer framework de UI, nem bundler (webpack/vite/esbuild), nem
TypeScript. HTML gerado via template strings + `innerHTML`, sanitizado manualmente com `esc()`.

## Justificativa (inferida do estado atual do código e da infraestrutura de deploy)

- **Deploy é `git push` puro.** Qualquer build step exigiria CI, que não existe hoje
  (`CLAUDE.md` confirma: sem etapa de build). Adotar um framework exigiria criar essa etapa.
- **Escopo por app é pequeno o bastante para uma IIFE só.** `~3560 linhas` (CDB2026) é grande
  para um arquivo único, mas não inviável — o inventário completo está em
  `CDB2026_CODE_INVENTORY.md`. Não há sinal, na auditoria de 2026-08, de que a ausência de
  framework tenha causado bugs por si (os 9 bugs do AUDIT-01–09 foram todos de lógica —
  merge/orientação/timezone —, não de gerenciamento de estado de UI).
- **Sem framework = sem dependência de build para rodar localmente** (`python3 -m http.server`
  já é suficiente, documentado no `CLAUDE.md` como fluxo de preview).

## Consequências

- **Positivo:** deploy trivial, sem CI, sem `node_modules` em produção, superfície de ataque de
  supply chain menor (só 2 dependências CDN: `@emailjs/browser`, `@supabase/supabase-js`).
- **Negativo:** sem VDOM/diffing, todo `render*()` reconstrói o HTML inteiro do container a cada
  chamada (ver `CDB2026_MODERNIZATION_REPORT_2026-08.md` §C4) — aceito como tradeoff conhecido,
  não um defeito a corrigir nesta modernização.
- **Negativo:** sanitização manual (`esc()`) em vez de escaping automático de um framework —
  risco de XSS existe se um site de interpolação for esquecido. Verificado nesta auditoria
  (Fase 2, achado A10 do sweep de duplicação): todos os pontos de `innerHTML =` encontrados
  usam `esc()` consistentemente, nenhuma exceção encontrada em 2026-08.
- **Negativo:** sem TypeScript — nenhuma checagem de tipo estática; `node --check` só valida
  sintaxe, não tipos. Mitigado pelos scripts de auditoria (`audit_scoring.py`,
  `audit_state_merge.mjs`, `audit_golden_master.mjs`, `audit_integrity.py`) que testam
  comportamento real, não substituem tipagem mas cobrem as áreas de maior risco (scoring, merge,
  orientação de dados).

## Alternativas consideradas

Nenhuma decisão formal de considerar/rejeitar um framework foi encontrada em CHANGELOG ou
comentários do código — esta ADR documenta o status quo observado, não reabre a decisão. Uma
migração de framework está fora do escopo desta modernização (não autorizada, mudaria
comportamento de forma ampla demais para um patch cirúrgico).
