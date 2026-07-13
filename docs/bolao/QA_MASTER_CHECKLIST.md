# QA Master Checklist — Plataforma Bolão

Checklist cross-app. Para o checklist detalhado e específico da Copa do Mundo, ver
`docs/bolao/QA_CHECKLIST.md`. Conteúdo manual pode ser adicionado **fora** do bloco
`AUTO:QA_MASTER_CHECKLIST` abaixo.

<!-- AUTO:QA_MASTER_CHECKLIST:START -->
Rodar esta checklist para qualquer mudança classificada como `PLATFORM_SHARED`, `SECURITY`,
ou `EMERGENCY_HOTFIX` (ver `PLATFORM_GOVERNANCE.md`). Para mudanças `TOURNAMENT_SPECIFIC` ou
`DATA_ONLY`, as seções A, B e F ainda se aplicam; C, D e E só na medida do relevante.

## A. Pre-change

- [ ] Confirmar branch correta antes de editar (`git status`, `git branch --show-current`).
- [ ] `git status` limpo antes de começar — nenhuma mudança não commitada de terceiros sendo
      sobrescrita sem querer.
- [ ] Backup do estado relevante antes de mudanças destrutivas (ex.: `bolao/backups/`, export
      manual do Supabase se a mudança tocar dados de produção).
- [ ] Listar explicitamente quais dos três aplicativos (`bolao/`, `bolao/br2026/`,
      `bolao/cdb2026/`) são afetados pela mudança.
- [ ] Classificar a mudança em uma categoria de `PLATFORM_GOVERNANCE.md`
      (`PLATFORM_SHARED` / `TOURNAMENT_SPECIFIC` / `DATA_ONLY` / `SECURITY` /
      `EMERGENCY_HOTFIX`).
- [ ] Identificar riscos específicos (a Copa está em produção — qualquer risco lá pesa mais).
- [ ] Ter um plano de rollback definido antes de começar (ver seção "Rollback" em `CLAUDE.md`).

## B. Static checks

- [ ] `node --check` em todo `.js` alterado (não há build step; isso é a única rede de
      segurança sintática).
- [ ] Nenhuma chave de i18n usada em `t()`/`data-i18n` sem entrada correspondente nos três
      objetos de idioma do arquivo `i18n.js` daquele app.
- [ ] Nenhum ID HTML duplicado no `index.html` alterado.
- [ ] Nenhum link ou referência de asset quebrado (`href`, `src` apontando para arquivo
      inexistente).
- [ ] Nenhum asset ausente (`assets/` referenciado no `config.js` mas não commitado).
- [ ] Nenhum segredo (`secret`, `service_role`, senha em texto puro) no diff.
- [ ] Nenhuma chave `service_role` do Supabase em código — só a chave `anon`/`publishable`.
- [ ] Nenhuma senha em texto puro — admin password é sempre hash SHA-256 em
      `config.adminPasswordHash`.
- [ ] Nenhum `TODO`/`FIXME` novo sem justificativa registrada (comentário explicando por quê).
- [ ] Nenhum `console.log` esquecido em código de produção.
- [ ] Nenhum uso novo de `document.write`.
- [ ] Nenhum `innerHTML` com dado de usuário não escapado (`escapeHtml()`/`esc()` sempre antes
      de inserir string vinda de input/localStorage/API externa no DOM).
- [ ] Nenhum bloco `catch` vazio novo sem comentário explicando por que o erro é
      intencionalmente ignorado.
- [ ] Toda chamada `fetch()` nova a uma API externa tem timeout/`AbortController`.
- [ ] Nenhum listener de evento duplicado (mesmo handler registrado duas vezes por engano).

## C. Functional

- [ ] App carrega sem erro no console.
- [ ] Salvar uma nova entrada funciona.
- [ ] Editar/atualizar uma entrada existente funciona (quando aplicável ao app).
- [ ] Ranking calcula e ordena corretamente.
- [ ] Seção de participantes exibe corretamente.
- [ ] Seção de regras exibe o texto correto e atualizado.
- [ ] Seção de pagamento exibe os três métodos com handles corretos.
- [ ] Login/logout admin funciona; `guardAdmin()` bloqueia ações sem sessão válida.
- [ ] Envio de e-mail funciona (quando o app tiver essa feature).
- [ ] Geração de comprovante funciona (quando o app tiver essa feature — hoje só a Copa).
- [ ] Exportação de PDF/impressão funciona (quando aplicável).
- [ ] Exportação de CSV abre corretamente em Excel (checar quebra de linha).
- [ ] Exportação de JSON produz um backup válido e completo (quando aplicável).
- [ ] Master list / relatório administrativo confere com o estado real (quando aplicável).
- [ ] Sincronização com Supabase funciona nos dois sentidos (salvar e carregar).
- [ ] Sync remoto manual (botão "Sync") força atualização corretamente.
- [ ] "Limpar dados" (quando existir) exige confirmação e realmente limpa local + remoto.
- [ ] Logout admin limpa a sessão corretamente.
- [ ] Live scores / atualização automática funciona (quando o app tiver integração ao vivo).
- [ ] Polling de resultados não trava a UI nem duplica chamadas.
- [ ] Cache local (localStorage) não fica desatualizado além do TTL configurado.

## D. Visual

- [ ] Testado em desktop.
- [ ] Testado em mobile (viewport estreito).
- [ ] Testado em Chrome.
- [ ] Testado em Safari.
- [ ] Alinhamento de elementos consistente com o design system (ver `CONSISTENCY_MATRIX.md`).
- [ ] Altura de botões consistente entre os três apps para o mesmo tipo de botão
      (primary/secondary/danger/small).
- [ ] Padding e margin consistentes com os valores já usados no `styles.css` daquele app.
- [ ] Fontes e pesos consistentes.
- [ ] Cores consistentes com as variáveis CSS (`var(--green)`, `var(--danger-bg)`, etc.) — sem
      cores hardcoded novas fora do sistema de tokens.
- [ ] Nenhum overflow horizontal inesperado.
- [ ] Elementos sticky (ex.: `.sticky-submit`) não sobrepõem conteúdo importante.
- [ ] Modais/diálogos (quando existirem) abrem e fecham corretamente.
- [ ] Tabelas não quebram layout em mobile.
- [ ] Cards mantêm o mesmo raio de borda, padding e sombra do padrão (`border-radius:18px`,
      `padding:18px`, `box-shadow:0 8px 32px rgba(0,0,0,.22)`).
- [ ] Responsividade testada nos breakpoints principais: 900px, 500px, 480px.

## E. Cross-app

- [ ] Comparar a implementação equivalente nos outros dois apps antes de considerar a mudança
      concluída (regra de propagação em `PLATFORM_GOVERNANCE.md`).
- [ ] Se a mudança é `PLATFORM_SHARED` ou `SECURITY`, propagar para os outros dois apps ou
      registrar explicitamente por que não foi propagada.
- [ ] Se a mudança é `TOURNAMENT_SPECIFIC`, confirmar que ela **não** vazou para um arquivo ou
      componente compartilhado por engano.
- [ ] Atualizar `docs/bolao/CONSISTENCY_MATRIX.md` se a mudança resolve, cria ou altera uma
      divergência já catalogada.
- [ ] Atualizar o `CHANGELOG.md` do(s) app(s) alterado(s) (`bolao/CHANGELOG.md`,
      `bolao/br2026/CHANGELOG.md`, `bolao/cdb2026/CHANGELOG.md`).

## F. Post-change

- [ ] `git diff` revisado linha a linha antes de commitar.
- [ ] `node --check` roda limpo em todos os `.js` alterados.
- [ ] Testes funcionais da seção C re-executados após a mudança final.
- [ ] `docs/bolao/CONSISTENCY_MATRIX.md` reflete o estado atual (ou foi explicitamente
      marcado como não afetado).
- [ ] Changelog(s) atualizado(s).
- [ ] Riscos restantes documentados (o que ficou como dívida técnica ou risco aceito).
- [ ] Plano de rollback confirmado e funcional (`git revert HEAD && git push`, ou restauração
      seletiva de `bolao/`, `bolao/br2026/` ou `bolao/cdb2026/`).
- [ ] Se a mudança tocou `bolao/js/data.js` (bracket), scoring/bonus em `bolao/js/config.js`,
      ou `bolao/scripts/send_result_email.py`: `python3 bolao/scripts/audit_scoring.py` foi
      executado e o resultado (passou ou falhou) foi relatado — esta etapa é obrigatória por
      regra do `CLAUDE.md` e não pode ser pulada mesmo que a mudança pareça não relacionada a
      scoring.

## G. Definition of Done

Uma tarefa só termina quando **todos** os itens abaixo forem verdadeiros — não apenas quando o
código "funciona":

- [ ] QA completo (seções A–F relevantes à categoria da mudança já rodadas).
- [ ] Changelog atualizado (`bolao/CHANGELOG.md`, `bolao/br2026/CHANGELOG.md` e/ou
      `bolao/cdb2026/CHANGELOG.md`, conforme o(s) app(s) alterado(s)).
- [ ] `docs/bolao/CONSISTENCY_MATRIX.md` atualizada (reflete o novo estado ou foi explicitamente
      marcada como não afetada).
- [ ] Zero erros no console do navegador (checado em pelo menos desktop + mobile).
- [ ] Zero `TODO` novo sem justificativa registrada.
- [ ] Zero `FIXME` novo.
- [ ] Plano de rollback definido e testável (não só "em teoria dá pra reverter").
- [ ] `git diff` revisado linha a linha antes de commitar.
- [ ] Smoke tests (seção H) executados no(s) app(s) alterado(s).

Se qualquer item acima não se aplica à mudança (ex.: um app sem a feature em questão), marcar
como não aplicável explicitamente — não pular em silêncio.

## H. Smoke Tests

Verificação mínima e rápida de que o app não está quebrado — rodar em qualquer mudança, mesmo
pequena, antes de considerar a tarefa concluída:

- [ ] Página abre sem erro.
- [ ] Sem erros JS no console.
- [ ] Login admin funciona.
- [ ] Logout admin funciona.
- [ ] Ranking renderiza.
- [ ] Salvar entrada funciona.
- [ ] Editar entrada funciona (quando aplicável ao app).
- [ ] Sync com banco (Supabase) funciona.
- [ ] API-Football responde ou reporta "não configurado" corretamente (quando aplicável).
- [ ] Countdown atualiza.
- [ ] Geração de PDF/impressão do comprovante funciona (quando aplicável).
- [ ] Envio de e-mail funciona (quando aplicável).
- [ ] Export CSV funciona.
- [ ] Export JSON funciona (quando aplicável).
- [ ] Backup (script ou export manual) funciona (quando aplicável).

## I. Regression Tests

Após qualquer alteração, verificar que nenhuma destas áreas regrediu — mesmo que a mudança
pareça não relacionada a elas (ver `LESSONS_LEARNED.md`: mais de um bug grave já apareceu em
código "não relacionado" ao que estava sendo alterado):

- [ ] Ranking.
- [ ] Admin (login, ações, sessão, lockout).
- [ ] PDF/impressão de comprovante.
- [ ] E-mail (participante e admin).
- [ ] Comprovante (código, conteúdo, geração).
- [ ] Backup (CSV, JSON, scripts Python).
- [ ] Mobile (layout, alinhamento, sem overflow).
- [ ] Safari (checkbox/click, cache do service worker, bfcache).
- [ ] Chrome.
- [ ] Traduções (três idiomas na Copa; pt-BR em BR2026/CDB2026).
- [ ] Timer/countdown.
- [ ] Pagamentos (handles, QR, marcação de pago).
- [ ] WhatsApp (botão/link de suporte, quando existir no app).
- [ ] Assets (ícones, QR codes, logos — nenhum link quebrado).
- [ ] Favicon.
- [ ] Responsividade (breakpoints principais).
- [ ] Live scores (placar, relógio, período/prorrogação/pênaltis).
- [ ] Polling (não trava a UI, não duplica chamadas, pausa com aba oculta).
- [ ] Supabase (merge local↔remoto nos dois sentidos, tombstones, multi-dispositivo).

## J. Risk Assessment

Antes de qualquer alteração, marcar explicitamente quais destas áreas a mudança toca — isso
alimenta a classificação de categoria em `PLATFORM_GOVERNANCE.md` e decide quais seções deste
checklist são obrigatórias:

- [ ] UI.
- [ ] Backend (scripts Python, GitHub Actions).
- [ ] Banco (Supabase — schema, RLS, merge).
- [ ] APIs externas (ESPN, API-Football, Polymarket).
- [ ] E-mail (EmailJS, templates, script de envio automático).
- [ ] PDF/comprovante.
- [ ] CSS compartilhado (design system usado pelos três apps).
- [ ] JS compartilhado (padrão de código replicado nos três apps — não é o mesmo que código
      importado; ver `PLATFORM_GOVERNANCE.md` sobre a diferença entre "padrão compartilhado" e
      "módulo compartilhado", que não existe nesta plataforma).
- [ ] Scoring (fórmula, bracket, bônus, desempate — nunca alterar sem autorização explícita do
      Eduardo).
- [ ] Admin (autenticação, sessão, lockout, ações administrativas).

Cada área marcada aumenta o escopo de QA exigido (seções B–F, H, I) e determina se a mudança
precisa ser avaliada nos outros dois apps (seção E).

## K. Audit Gate

Ver `docs/bolao/AUDIT_PROTOCOL.md` para o protocolo completo. Esta seção é o checklist
executável do gate de auditoria descrito lá.

Antes da implementação:

- [ ] Escopo auditado.
- [ ] Findings registrados.
- [ ] Severidades atribuídas.
- [ ] Apps afetados identificados.
- [ ] Propagação cross-app avaliada.
- [ ] Itens autorizados pelo usuário.
- [ ] Plano de rollback definido.

Depois da implementação:

- [ ] Cada finding autorizado foi corrigido.
- [ ] Nenhum finding não autorizado foi alterado.
- [ ] Nenhuma regressão nova encontrada.
- [ ] Componentes visuais comparados nos três apps.
- [ ] Auditoria direcionada pós-change executada.
- [ ] Consistency Matrix atualizada.
- [ ] Changelogs atualizados.
- [ ] Resultado dos testes relatado.

## L. Visual Alignment Gate

Para cada tela ou componente alterado, contra `docs/bolao/DESIGN_SYSTEM.md`:

- [ ] Altura de botões consistente.
- [ ] Largura e comportamento de botão documentados.
- [ ] Labels alinhados.
- [ ] Inputs alinhados.
- [ ] Grids não apresentam colunas quebradas.
- [ ] Ações primárias e secundárias têm hierarquia clara.
- [ ] Toolbars quebram linha de forma previsível.
- [ ] Mobile não tem overflow horizontal.
- [ ] Desktop usa largura de maneira adequada.
- [ ] Componentes equivalentes foram comparados nos três apps.
- [ ] Diferenças intencionais foram documentadas.
<!-- AUTO:QA_MASTER_CHECKLIST:END -->

## Nota manual — QA da reformulação do CDB2026 (2026-07-13, v3.0)

Registro de execução deste checklist para a reformulação completa de modelo do CDB2026 (ver
`docs/bolao/CDB2026_RULES_AND_MODEL.md` e `bolao/cdb2026/CHANGELOG.md` v3.0). Categoria:
`TOURNAMENT_SPECIFIC` de maior porte (mudança de modelo de dados + scoring + admin + picks) —
auditoria completa aplicada (seção K, gate completo), não só direcionada.

**Seção B (static checks):** `node --check` limpo em `data.js`/`app.js`/`i18n.js`/`config.js`.
Nenhum segredo/`service_role`/senha em texto puro no diff. Nenhum `TODO`/`FIXME` novo sem
justificativa. Nenhum `console.log` esquecido. Nenhum `innerHTML` com dado de usuário não
escapado (`esc()` em todo lugar novo). Nenhum listener de evento duplicado.

**Seção C/H (funcional/smoke — via Playwright, não manual):**
- Cadastro de confronto (partida única e ida+volta) pelo admin.
- Placar salvo por partida, agregado calculado automaticamente e ao vivo (formulário de
  palpite E painel admin) — nunca digitado.
- Confronto com agregado/placar empatado exige escolha manual de classificado (testado nos
  dois formatos, com os valores exatos do EXEMPLO 1 e EXEMPLO 2 do pedido original — Flamengo ×
  Palmeiras 2×2 nos pênaltis, Corinthians × Grêmio 1×1 nos pênaltis).
- Confronto não-empatado trava automaticamente (sem exigir escolha manual do que a regra já
  decide).
- Pontuação testada em todos os níveis (placar exato / resultado certo / gols de um time /
  bônus de classificado / campeão / vice) — total calculado à mão bateu exatamente (86 pontos
  num cenário misto cobrindo todos os níveis simultaneamente).
- Fase com cutoff no passado bloqueia palpite, mostra nota de prazo encerrado.
- Fase sem confrontos cadastrados mostra "Aguardando sorteio oficial" (Jogos, Palpites,
  Probabilidades — as 3 telas que iteram fases).
- Export CSV/JSON não lançam erro.
- Zero erro de JS em qualquer fluxo testado.

**Seção D (visual):** zero overflow horizontal testado em 9 larguras (320–1440px) na nova tela
de admin "Fases e confrontos". Componentes reaproveitados (card, botão, input, badge) do
design system existente — nenhum componente novo introduzido.

**Seção J (risk assessment):** UI ✓, Scoring ✓ (fórmula mudou, autorizado explicitamente por
Eduardo), Banco — não aplicável (`database.enabled: false`), Admin ✓ (tela nova).

**Não coberto nesta rodada** (dívida técnica registrada em `CDB2026_RULES_AND_MODEL.md`): jogo
adiado/cancelado/remarcado sem tratamento dedicado; duas abas sincronizando em tempo real (sem
mudança de comportamento em relação ao que já existia); migração de estado antigo (não
aplicável — confirmado que não existem entradas reais).

Confirmado: `bolao/` (Copa) e `bolao/br2026/` (Brasileirão) não foram tocados nesta rodada —
`python3 bolao/scripts/audit_scoring.py` rodado após a mudança, 5/5, sem impacto.

## QA — classificação ao vivo + movimento de ranking (BR2026 v1.23, 2026-07-13)

Classificação: `TOURNAMENT_SPECIFIC` (cálculo da classificação ao vivo do Brasileirão) +
`PLATFORM_SHARED` (componente visual `.movement`, mas não migrado para a Copa/CDB2026 nesta
rodada — ver `CONSISTENCY_MATRIX.md`). Auditoria direcionada ao escopo alterado (não full-scope),
por ser um patch aditivo sem alterar scoring/regras.

**Seção B (static checks):** `node --check` limpo nos 12 arquivos JS dos 3 apps (Copa, BR2026,
CDB2026 — todos, não só o app alterado, por exigência do CLAUDE.md). Nenhum segredo em texto
puro no diff. Nenhum `TODO`/`FIXME` novo sem justificativa. Nenhum `console.log` novo. Nenhum
`innerHTML` com dado não escapado (`esc()`/`esc()` mantido em todo markup novo).

**Seção C/H (funcional — via Playwright, 27 testes puros + 9 de integração, todos verdes):**
- `calculateLiveStandings()`: time ultrapassa ao vivo, time cai, sem partidas → sem movimento,
  troca de posição, empates de pontos/GD/gols-pró, fallback determinístico sem inventar
  critério, `postponed` ignorado, time desconhecido não derruba o cálculo, baseline vazia →
  `null`, pureza dos argumentos, limites de zona (`zoneForPosition`).
- `calculateRankingMovement()`/`rankEntries()`: sobe/cai com ranks distintos, regra de empate
  compartilhado não gera "subida" falsa (mesmo comparador usado no ranking exibido, na baseline
  e no live — sem risco de drift), sem baseline → "indisponível" nunca fabricado, lista vazia,
  entrada única.
- Integração ponta a ponta com ESPN mockada: tabela em ordem oficial + movimento indisponível
  antes de qualquer partida ao vivo; tabela **reordena** por posição ao vivo quando a janela
  abre, seta certa na linha certa, disclaimer visível; ranking do bolão mostra o movimento; ao
  fechar a janela, baseline é apagada do `sessionStorage` e a seta volta a "indisponível" (sem
  ficar presa em um estado obsoleto).

**Seção D (visual — Playwright real, screenshots capturados, não só leitura de CSS):** 320px,
390px, 1440px. Pos/Mov/Time/Pts permanecem visíveis sem scroll horizontal (colunas sticky, bug
encontrado e corrigido nesta própria rodada — `.td-pts` não tinha `left` definido, então não
grudava de fato; corrigido junto com largura fixa de `.td-team` para o offset sticky ser
previsível). Nome de time longo trunca com reticências + `title` com o nome completo. Seta de
ranking não empurra o nome do participante (fica empilhada abaixo da medalha).

**Seção J (risk assessment):** UI ✓ (aditivo, nenhum componente existente removido). Scoring —
não aplicável, nenhuma fórmula de pontos/critério de classificação oficial foi alterada
(`audit_scoring.py` 5/5 após a mudança). Banco — não aplicável (`database.enabled:false` no
BR2026; nenhum campo novo entra no `state()` sincronizável, baseline vive só em
`sessionStorage`). Admin — não aplicável, nenhuma tela admin alterada. Rede — melhorado
(`AbortController`/timeout agora em 100% dos `fetch()` do BR2026, poll não sobrepõe, pausa com
`document.hidden`, backoff em falha).

**Não coberto nesta rodada** (documentado como limitação em
`docs/bolao/BR2026_LIVE_STANDINGS.md`): duas abas simultâneas e interrupção real de rede não
foram testadas E2E (analisadas por revisão de código); cadeia de desempate oficial da CBF além de
pontos/saldo (confronto direto etc.) não está implementada em nenhum lugar do app — documentado
como limitação, não fingido como resolvido; janela de partidas é uma aproximação por ausência de
identificador de rodada na API ESPN usada.

Confirmado: scoring da Copa, scoring do CDB2026 e regras do Brasileirão não foram alterados —
apenas classificação ao vivo, movimento e consistência do ranking do BR2026.
