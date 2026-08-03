# UI Regression Protocol — Bolão do Ferrari

Conteúdo manual pode ser adicionado **fora** do bloco `AUTO:UI_REGRESSION_PROTOCOL` abaixo — o
bloco em si é substituído inteiramente a cada revisão formal deste protocolo. Ver também
`docs/bolao/PLATFORM_DESIGN_SYSTEM.md`, `docs/bolao/PLATFORM_ARCHITECTURE.md`,
`docs/bolao/CONSISTENCY_MATRIX.md`, `docs/bolao/QA_MASTER_CHECKLIST.md` (seção "Visual
Consistency Gate").

<!-- AUTO:UI_REGRESSION_PROTOCOL:START -->
## 1. Componentes canônicos

Ver `docs/bolao/PLATFORM_DESIGN_SYSTEM.md` para a lista completa com seletores/dimensões. Os de
maior risco de regressão silenciosa (mudados sem querer ao mexer em outra coisa):

- Botões (`button`, `.secondary`, `.danger`, `.small-btn`)
- Topbar / nav (`.topbar`, `.nav`, `.nav button`)
- Card (`.card`)
- Form (`label`, `input`, `select`, `.form-grid`)
- Game/team card (`.match-card`, `.teams`, `.team`, `.pill`)
- Ranking row (`.rank-row`, `.picks-detail`)
- Admin toolbar (`.admin-toolbar`, `.admin-row`)
- Payment card (`.pay-grid`, `.pay-card`)

## 2. Apps onde cada componente aparece

| Componente | Copa | BR2026 | CDB2026 |
|---|---|---|---|
| Botões | ✓ | ✓ | ✓ |
| Topbar/nav | ✓ | ✓ | ✓ |
| Card | ✓ | ✓ | ✓ |
| Form (entrada) | ✓ | ✓ | ✓ |
| Game/team card | ✓ (bracket) | ✓ (padrão de jogos) | ✓ (confrontos) |
| Ranking row | ✓ | ✓ | ✓ |
| Admin toolbar | ✓ | ✓ | ✓ |
| Payment card | ✓ | ✓ | ✓ |

## 3. Testes mínimos por componente

- **Botões**: altura/padding/radius/peso de fonte batem com o token documentado; `:disabled`
  visualmente diferente; `:focus-visible` mostra outline; grupo (`.admin-toolbar`) quebra linha
  sem sobrepor.
- **Nav**: nº de colunas do CSS bate com o nº de botões *visíveis* (não total, se algum estiver
  `display:none` deliberadamente); alvo de toque ≥ 44px; item ativo destacado.
- **Card**: `border-radius:18px`, `padding:18px`, sombra presente.
- **Form**: label acima do input; foco muda `border-color`; inputs desabilitados com opacidade
  reduzida; grid de 2 colunas colapsa pra 1 em mobile.
- **Game/team card**: nomes reais sempre (nunca "Time A"/"Time B" — ver
  `docs/bolao/LESSONS_LEARNED.md` "Time A / Time B"); mandante e visitante com largura simétrica;
  sem overflow em 320px.
- **Ranking row**: estrutura de grid de 1 linha (não tabela nem card empilhado); detalhe
  expansível usa `<table>`; nunca revela palpite antes do cutoff (`isPastCutoff()`-equivalente).
- **Admin toolbar**: ação destrutiva sempre com `confirm()`; sessão expira; `guardAdmin()`
  bloqueia sem sessão válida.
- **Payment card**: ícone 40×40px, método + valor + link, mesma estrutura nos 3 apps.

## 4. Viewports

`320px`, `375px`, `390px`, `414px`, `768px`, `900px`, `1200px`, `1440px`, `1600px`. Na prática,
para a maioria das mudanças, o conjunto reduzido `375px`/`390px`/`768px`/`1200px`/`1440px` já
cobre os breakpoints reais do CSS (`480px`, `500px`, `900px`, `901px`); os demais servem para
confirmar que nada quebra *entre* os breakpoints definidos.

## 5. Regras de preservação

Antes de alterar qualquer componente compartilhado, confirmar que a mudança não quebra:

- **Copa**: ranking atual, scoring, live scores, receipts, emails, admin, Supabase, APIs,
  navegação, mobile.
- **BR2026**: projeção, classificação ao vivo, ranking projetado, movimento, Supabase, polling,
  admin, entradas.
- **CDB2026**: fase atual, modelo single/two-leg, agregado, classificado, scoring, admin,
  entradas salvas, migração, Supabase.

Nenhum patch visual é considerado aprovado se algum item desta lista falhar.

## 6. Rollback

`git diff --name-only` antes de commitar; `git checkout -- <arquivo>` reverte um arquivo
específico sem tocar no resto do patch. Para um patch já commitado: `git revert <hash>` (nunca
`git reset --hard` numa branch compartilhada). Ver também a seção "Rollback" de cada
`CHANGELOG.md` por app.

## 7. Como comparar

1. Localizar o componente equivalente na Copa (golden master) — `docs/bolao/
   PLATFORM_DESIGN_SYSTEM.md` tem o seletor/valores.
2. Comparar seletor CSS, estrutura HTML e valores reais (não "parece igual" — ler o CSS/HTML dos
   três apps lado a lado).
3. Se houver Playwright disponível, capturar screenshot nos viewports da seção 4 para os três
   apps e comparar lado a lado — não confiar só em leitura de código para mudanças visuais
   relevantes.
4. Testar teclado (Tab) e leitor de tela minimamente (labels, `aria-live`, foco visível).

## 8. Como registrar diferença intencional

Em `docs/bolao/CONSISTENCY_MATRIX.md`, adicionar uma "Nota manual" com: nome do componente,
motivo da diferença (por que é `TOURNAMENT_SPECIFIC` e não um bug), apps afetados, decisão
(`INTENTIONALLY_DIFFERENT`), e se algo fica pendente para revisão futura.

## 9. Como atualizar a Consistency Matrix

Adicionar/atualizar a "Nota manual" correspondente (fora do bloco `AUTO:CONSISTENCY_MATRIX`, que
só é reescrito inteiro numa auditoria automatizada completa) com: status antes → status depois,
componentes corrigidos, divergências restantes, risco, próxima ação. Nunca marcar como
`CONSISTENT` só porque o CSS "parece parecido" — confirmar valores reais.

## 10. Como validar que uma mudança em um app não quebrou outro

1. Rodar `node --check` em todos os `.js` dos três apps (não só o alterado).
2. Rodar `python3 bolao/copa2026/scripts/audit_scoring.py`, `python3 bolao/br2026/scripts/audit_scoring.py`
   e `python3 bolao/cdb2026/scripts/audit_scoring.py` (obrigatório em toda mudança, mesmo não
   relacionada a scoring — regra do `CLAUDE.md`).
3. Rodar a suíte de testes Playwright completa dos apps que compartilham o componente alterado
   (não só o app onde a mudança foi feita).
4. Comparar visualmente o componente equivalente no(s) app(s) não alterado(s) — confirmar que
   ficou exatamente como estava antes (nenhum CSS/HTML compartilhado por engano entre apps, já
   que os três não importam código um do outro).
<!-- AUTO:UI_REGRESSION_PROTOCOL:END -->

## Ferramentas de regressão visual disponíveis (adicionado 2026-08, branch `fase2.2-correcao-final`)

Conteúdo manual — fora do bloco `AUTO` acima por convenção deste arquivo. A seção 7 ("Como
comparar") e a seção 9 ("Como atualizar a Consistency Matrix") agora têm ferramentas reais que as
executam, em vez de depender só de leitura de código/inspeção manual:

- **`bolao/cdb2026/scripts/visual/capture_evidence.mjs`** — harness Playwright cross-app:
  screenshots reais nos viewports da seção 4, para os três apps, com fixture sintética
  (localStorage) e detecção de overflow horizontal/erros de console. Saída:
  `docs/bolao/evidence/visual/{copa2026,br2026,cdb2026}/*.png` + `manifest.json`.
- **`bolao/cdb2026/scripts/visual/capture_admin_auth_evidence.mjs`** — mesma ideia, mas para as
  telas de admin AUTENTICADO (sessionStorage sintético reproduzindo as chaves exatas que cada
  `isAdminActive()` verifica — nunca a senha real). Copa fica `notApplicable` (arquivada,
  `CONFIG.archived` esconde o botão de nav do Admin).
- **`bolao/scripts/audit_visual_consistency.mjs`** — formaliza a seção 9 ("Como atualizar a
  Consistency Matrix"): lê `getComputedStyle()` de ~26 componentes × 13 propriedades nos três
  apps e classifica cada comparação automaticamente como `EQUAL`/`EQUIVALENT`/`JUSTIFIED`
  (motivo citado, contra uma lista de divergências já documentadas)/`DIVERGENT` (sem
  justificativa — precisa de revisão humana)/`N/A`. Saída:
  `docs/bolao/evidence/visual-comparison/audit_visual_consistency.{json,md}`. Não substitui o
  passo 2 da seção 7 (ler CSS/HTML lado a lado) — é um complemento automatizado, não uma
  autorização para pular a leitura manual quando o resultado for `DIVERGENT`.
- **`bolao/scripts/make_visual_comparison_montages.mjs`** — compõe screenshots já capturados em
  montagens lado a lado (Copa|BR2026|CDB2026, mesma tela/viewport), reaproveitando
  `docs/bolao/evidence/visual/` sem nova captura. Útil para o passo 3 da seção 7 ("capturar
  screenshot... e comparar lado a lado") quando a evidência já existe.
- **`bolao/scripts/test_aria_current_nav.mjs`** — suíte Playwright dedicada ao item "alvo de
  toque/item ativo destacado" da seção 3 ("Nav"): confirma `aria-current="page"` no botão certo
  via mouse E teclado, ausência de `aria-selected`, e nenhuma regressão de overflow — nos três
  apps.

**Exemplo real de uso do fluxo completo** (seções 7+9 aplicadas de ponta a ponta): a correção do
item 8 (`main` padding + `.form-grid`, ver `docs/bolao/CONSISTENCY_MATRIX.md` nota "branch
`fase2.2-correcao-final`") seguiu exatamente esta ordem — leitura de CSS lado a lado (achou a
divergência), `audit_visual_consistency.mjs` ANTES da mudança (confirmou `DIVERGENT`), patch
mínimo, screenshots reais 320/768/1440px antes/depois (achou um bug extra: 3 colunas espremidas
a 768px, invisível só lendo o CSS-fonte porque dependia do valor resolvido do `auto-fill`),
`audit_visual_consistency.mjs` DEPOIS da mudança (confirmou `DIVERGENT`→`EQUAL`), `node --check`
+ `audit_scoring.py` nos três apps, e atualização de `CONSISTENCY_MATRIX.md`/`CHANGELOG.md`.
