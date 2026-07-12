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
