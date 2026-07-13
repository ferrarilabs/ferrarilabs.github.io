# Bolão Copa do Brasil 2026 — CHANGELOG

## v2.9 — 2026-07-13

### Fixed — admin só deixava lançar o resultado do jogo de ida, não da volta

Reportado por Eduardo. Causa: `renderAdminResults()` tinha só UM par de campos de placar por
confronto, sem noção de "ida"/"volta" — era pensado como entrada direta do AGREGADO. Na
prática isso obriga o admin a esperar os dois jogos acontecerem e somar o placar de cabeça
antes de conseguir digitar qualquer coisa, e o campo único "parece" ser só do jogo de ida
porque não há onde lançar o segundo placar.

Fix: cada confronto agora tem duas linhas de entrada independentes — **Jogo 1 (ida)** e
**Jogo 2 (volta)** — cada uma salva seu placar assim que aquele jogo termina
(`s.results.legs[tieId].leg1`/`.leg2`, campo novo no estado). Assim que as duas pernas têm
placar salvo, o agregado é calculado automaticamente e aparece um resumo com quem avança
(ou, se o agregado empatar, um seletor manual — mesma regra da CBF sem gol fora de casa já
usada no formulário de palpite: agregado empatado = pênaltis, imprevisível, o admin escolhe).
Só o clique explícito em "Salvar e travar resultado" grava o resultado oficial, que continua
sendo escrito em `s.results.ties[tieId]` **no mesmo formato de sempre** (`goalsA`, `goalsB`,
`advance`, `lockedAt`) — nada mudou na leitura desse dado por `resolveOfficial()`, ranking,
CSV ou qualquer outro consumidor. Destravar o resultado oficial não apaga mais o placar de
cada perna (fica salvo para reaproveitar/corrigir), só o agregado travado.

Também corrigido `mergeStates()`/`state()`/`emptyState()`, que descartavam silenciosamente
`results.legs` num sync remoto (só carregavam `results.ties`) — não afetava nada hoje porque
`database.enabled` ainda é `false` neste app, mas teria apagado o placar por perna assim que
o Supabase fosse ativado.

**Não toca em scoring/pontuação/ranking** — só na forma como o admin chega ao mesmo objeto de
resultado que já existia. `node --check`: OK. `audit_scoring.py`: 5/5, sem impacto. Testado
via Playwright: salvar Jogo 1, salvar Jogo 2, agregado calculado corretamente (inclusive caso
empatado, exigindo escolha manual de quem avança), travar, destravar (pernas sobrevivem),
sem erro de JS em nenhum passo; regressão em Ranking/Jogos/Probabilidades/Palpites limpa.

## v2.8 — 2026-07-13

### Fixed — escudo do time "nas pontas" em vez de flanquear o centro

Mesmo achado do Brasileirão (v1.22): o padrão canônico da Copa (`renderNextMatch()`, nome
fora / escudo dentro, `Time A 🏳 × 🏳 Time B`) não estava sendo seguido em `pick-pos-lbl`
(resumo de palpite no ranking), `leg-teams` (linhas Jogo 1/Jogo 2) e `confronto-header`
(título do confronto) — os três tinham escudo fora / nome dentro. Interessante: o formulário
de palpite (`tie-inputs`/`tie-locked-score`) já usava o padrão certo — a inconsistência era
só nas telas de leitura. Invertido nos três lugares para bater com a Copa.

### Added — aba "Probabilidades"

Faltava esta aba em comparação com o Brasileirão. Diferença de formato: aqui o confronto é
mata-mata ida+volta com placar agregado (não partida única/tabela), então a Copa/Brasileirão
não tinham simulador equivalente pronto para reaproveitar — matemática nova, mesma base
(Poisson bivariado + correção Dixon-Coles, igual aos outros dois apps):

- `bolao/cdb2026/js/data.js`: novo campo `strength` (força aproximada 0-100 de cada um dos
  16 clubes) — **valor inicial estimado, não uma fonte oficial; Eduardo deve revisar antes de
  publicar.** Não alimenta scoring/resultado real.
- Cada perna (ida/volta) tem seus gols esperados calculados a partir da força dos dois times
  + vantagem de mandante (+65 pontos numa escala tipo Elo, valor comum em modelos públicos de
  futebol de clubes — a Copa não usa isso, por ser seleção em sede neutra).
- O placar das duas pernas é combinado (convolução da distribuição completa de placar de cada
  uma) para chegar no agregado, aplicando a regra real da CBF já implementada no site (sem
  gol fora de casa — agregado empatado = pênaltis, tratado como 50/50 por não ser previsível
  por modelo de gols).
- Barra de probabilidade de 2 vias (sem empate — o confronto sempre resolve em alguém
  avançando), mesmo componente visual `.prob-bars`/`.prob-bar` dos outros dois apps.
- Nova seção `#probs` + botão de navegação, ordem igual ao Brasileirão (depois de "Jogos").
- Confrontos já decididos (resultado oficial lançado) mostram quem avançou em vez de uma
  probabilidade — não faz sentido estimar o que já é fato.

Não toca scoring/resultado oficial em nenhum momento — é só uma exibição informativa
calculada em cima da mesma força de time estática, sem gravar nada em `localStorage`/Supabase.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto de scoring. Testado via Playwright
(mock de dado local, sem rede) — aba renderiza sem erro JS, percentuais somam 100%.

## v2.7 — 2026-07-13

### Fixed — topbar quebrava horizontalmente no mobile

Reportado com screenshots: página cortada/deslocada horizontalmente no celular. Mesma causa raiz e mesmo fix do bolão da Copa e do Brasileirão (`bolao/css/styles.css`, `bolao/br2026/css/styles.css`): o seletor de bolão competia por espaço com marca+WhatsApp numa única linha que não cabe em nenhum celular, e `grid-template-columns` sem `minmax(0, 1fr)` não deixava os itens encolherem de verdade. Seletor agora tem linha própria no mobile; grid do topbar/navegação usa `minmax(0, 1fr)`; subtítulo da marca escondido no mobile; `.pick-pts-hint` (dica de pontuação) não força mais `nowrap`.

Não encontrei escudo de time dentro das barras de probabilidade neste bolão (diferente do Brasileirão) — nada a corrigir nessa frente aqui.

QA: 9 larguras testadas (320-1440px), zero overflow horizontal. `python3 bolao/scripts/audit_scoring.py` (bolão da Copa): sem impacto, mudança isolada à Copa do Brasil.

---

## v2.6 — 2026-07-13

### Fixed — fechamento da tarefa "Copa como referência canônica"

- `.admin-toolbar` gap/margin alinhados com a Copa (`8px`/`14px`, era `6px`/`8px`).
- `.admin-row` **mantido** como lista densa — mesma decisão do BR2026, ver
  `docs/bolao/CONSISTENCY_MATRIX.md` item 78.

Ver `docs/bolao/DESIGN_SYSTEM.md` para a tabela de mapeamento completa e a tabela de
validação (sem captura visual real — sem navegador disponível, tudo verificado por CSS).

`audit_scoring.py`: 5/5 — só CSS.

## v2.5 — 2026-07-12

### Fixed — bugs reais reportados testando o site ao vivo

- **Mandante/visitante trocados no jogo de volta**: a linha "Jogo 2" da aba Jogos sempre
  mostrava a mesma ordem do "Jogo 1", mas no jogo de volta o mandante é o outro time (ex.:
  Vasco manda a ida, Fluminense manda a volta). `legHtml()` usava os campos estáticos de
  `tie.leg2` (que só existem pras oitavas) em vez dos nomes já resolvidos do bracket; agora
  inverte `home`/`away` explicitamente pro leg2, funciona em qualquer fase.
- **Escudo só aparecia no cabeçalho do confronto**: as linhas "Jogo 1"/"Jogo 2" individuais
  não tinham escudo, só o cabeçalho do card. Adicionado nas duas.
- **Card "Já enviei meus palpites" não escondia por completo**: o fix anterior só escondia os
  campos, mas o título e o texto explicativo continuavam visíveis mesmo com o card bloqueado
  — mostrava duas mensagens conflitantes na tela. Agora o card inteiro (`#findEntryCard`) fica
  escondido até as oitavas terminarem, com `class="hidden"` já no HTML estático (sem flash
  antes do JS carregar).
- **Palpite por confronto reorganizado numa linha só**: time + escudo + placar × placar +
  escudo + time, em vez de nome dos times numa linha e placar numa linha separada abaixo.
  "Quem avança" continua abaixo, numa linha própria.
- **"Quem avança" agora segue a regra real da CBF**: sem critério de gols fora de casa — se o
  agregado tem lado claramente maior, quem avança é automático e o campo fica travado (sem
  edição manual, não faz sentido escolher o que a regra já decide). Se o agregado empata, vai
  pra pênaltis (imprevisível) — o campo destrava e o participante escolhe manualmente. Alternar
  entre os dois estados nunca deixa uma seleção antiga (automática ou manual) inválida sobrar;
  ao editar uma entrada já salva, a escolha manual de um agregado empatado é preservada, só uma
  edição ativa do placar limpa o valor.
- **Alinhamento dos 4 selects de pódio (campeão/vice/semis)**: sem largura fixa, a borda
  direita de cada `<select>` ficava numa posição horizontal diferente dependendo do tamanho do
  nome do time selecionado ("Remo" vs "Athletico-PR"). `width:100%` explícito nos quatro.
- **Botão WhatsApp**: texto visível era só "WhatsApp"; Copa usa "Suporte WhatsApp". Alinhado.
- **Card de pagamento sem ícone**: mesmo fix do BR2026 (ver `bolao/br2026/CHANGELOG.md`
  v1.19) — `cashapp.svg`/`venmo.svg` copiados, `payIcon()` portado, `.pay-grid`/`.pay-card`
  migrados pro layout da Copa.
- **Spinner nativo removido** dos inputs numéricos (mesmo fix nos três apps).

`audit_scoring.py`: 5/5 — a mudança na regra de "quem avança" é só na UI (trava/destrava e
auto-preenche o campo); a lógica de pontuação (`scoreEntry`) já comparava `pick.advance` contra
`res.advance` sem nenhuma suposição sobre como o campo foi preenchido, nada mudou lá.

## v2.4 — 2026-07-12 (WIP — commit parcial)

### Fixed — Copa como referência visual canônica (início; tarefa incompleta)

Início da padronização com a Copa (`bolao/`) como referência visual canônica — ver
`bolao/br2026/CHANGELOG.md` v1.18 para o racional completo (mesma mudança aplicada aos dois
apps). Commit parcial por limitação de créditos da sessão — auditoria completa ainda pendente.

- **`main` max-width**: `860px` → `1140px`, igual à Copa. `.confronto-card` já usava a classe
  `.card` compartilhada, nenhuma mudança necessária lá.

`audit_scoring.py`: 5/5 — só CSS.

## v2.3 — 2026-07-12

### Added — sistema de toast + badge/status unificado + ranking reestruturado (findings Critical/High autorizados)

Mesma rodada aplicada ao BR2026 nesta versão — ver `bolao/br2026/CHANGELOG.md` v1.17 e
`docs/bolao/CONSISTENCY_MATRIX.md` itens 67-69 para o racional completo.

- **Badge/status unificado**: `.paid-badge`/`.unpaid-badge` ganharam `border-radius:999px`/
  `padding:4px 10px`/`font-weight:900` (eram `6px`/`3px 8px`/`700`), mesmo tratamento do
  `.status-chip` da Copa. CDB2026 não tem chip de status de jogo (não tem API ao vivo) —
  gap já catalogado, não resolvido nesta rodada (é feature nova, não harmonização).
- **Sistema de toast portado da Copa**: `showToast()` + CSS `.bolao-toasts`/`.bolao-toast`.
  Convertidos os `alert()`s de confirmação/erro (salvar entrada, "buscar minha entrada",
  admin login/lockout, sync, resultados) — validação de campo obrigatório continua `alert()`.
  O comprovante deixou de duplicar o código no `alert()` de sucesso — `renderReceiptBox()` já
  mostra o código de forma persistente na tela, o toast só confirma o salvamento.
- **Ranking reestruturado**: `.rank-card` empilhado substituído pelo `.rank-row` denso de 1
  linha da Copa + `.picks-detail` expansível por clique (mesmo padrão de `bolao/js/app.js`).
- Nova chave i18n: `viewPicks`.

`audit_scoring.py`: 5/5 — mudança é de apresentação/interação, nenhuma fórmula de scoring ou
critério de desempate foi tocado.

## v2.2 — 2026-07-12

### Fixed — patches mínimos de design system (auditoria de UX cross-app)

Parte dos findings de baixo risco do `docs/bolao/DESIGN_SYSTEM.md`, CSS-only:

- **`h1,h2,h3` normalizado globalmente** — mesma regra da Copa portada (idêntica ao fix
  aplicado no BR2026 na mesma versão desta rodada, ver `bolao/br2026/CHANGELOG.md` v1.16).
- **Botão sticky (`.sticky-submit button`)**: sombra `rgba(0,0,0,.5)` → `rgba(47,229,110,.35)`
  (verde, igual à Copa) — `min-width:200px` já existia.
- Input/select/label e `.rules-table` padding já batiam com a Copa antes desta rodada.

Findings maiores (badge/status, ranking, toast) não implementados nesta rodada — ver
`bolao/CHANGELOG.md` v4.126 para o racional completo.

`audit_scoring.py`: 5/5 (só CSS).

## v2.1 — 2026-07-12

### Fixed — símbolo de time trocado por escudo real; edição só após oitavas

Reportado por Eduardo testando o site ao vivo, logo após o v2.0:

- **Escudo real em vez de bolinha com iniciais**: o badge colorido com abreviação (`teamBadge`)
  foi substituído por `teamLogoImg()` — mesmo nome de função, mesmas classes CSS
  (`.team-logo` 14px / `.match-logo` 22px) e mesmas medidas do `bolao/br2026/js/app.js`. As
  URLs são as mesmas que o BR2026 busca ao vivo do endpoint de standings da ESPN
  (`site.api.espn.com/.../soccer/bra.1/teams` para 14 dos 16 times; Fortaleza e Juventude
  estão na Série B nesta temporada — `bra.2` — verificado time a time, não assumido). Como o
  CDB2026 não tem nenhuma chamada de API ao vivo, as URLs ficam fixas em `DATA.teamLogos`
  (`js/data.js`) em vez de buscadas dinamicamente — mesmo resultado visual do BR2026, sem
  adicionar uma dependência de API nova a um app que hoje é 100% estático. CSP (`img-src`)
  atualizado para permitir `a.espncdn.com`, igual ao BR2026.
- **Edição própria só abre depois das Oitavas**: o card "Buscar minha entrada" ficava sempre
  visível, mesmo antes de qualquer confronto ser resolvido — nesse ponto não há nada de novo
  pra editar (Quartas em diante ainda não têm times definidos), então só confundia quem estava
  enviando a entrada pela primeira vez. Agora o card mostra uma mensagem explicativa e só
  libera o formulário depois que os 8 confrontos das Oitavas tiverem resultado lançado pelo
  admin (`oitavasComplete()`), com a mesma checagem repetida no clique do botão como segunda
  camada.

Aplicada a regra de comparação de componente visual (nova em `CLAUDE.md`): o mesmo bug de
`<img>` sem `width`/`height` explícito existia potencialmente no BR2026 também — ver o
changelog daquele app nesta mesma data.

`audit_scoring.py`: 5/5 (Copa não tocada).

## v2.0 — 2026-07-12

### Novo — palpites por confronto (placar agregado ida+volta), símbolos de time, comprovante

Reformulação pedida por Eduardo: regras similares à Copa do Mundo (placar por jogo, 10/5/1
pts), com a diferença de que os times de Quartas/Semifinal/Final só se definem — e só ficam
liberados para palpite — conforme a fase anterior termina.

- **Palpites por confronto**: além dos 4 palpites de pódio (campeão/vice/2 semifinalistas —
  mantidos travados desde antes do cutoff global, igual à Copa: se o time cai, o bônus é
  perdido, sem chance de trocar depois), agora existe um palpite de **placar agregado**
  (ida+volta) para cada um dos 15 confrontos do bracket (8 oitavas + 4 quartas + 2 semifinal +
  1 final). Pontuação por confronto: 10 pts placar exato / 5 pts quem avança certo / 1 pt um
  dos dois lados do agregado certo — mesmos valores da Copa do Mundo (`bolao/js/config.js`),
  aplicados ao agregado.
- **`js/data.js`**: bracket completo (`DATA.ties`), com Quartas/Semifinal/Final como slots
  `home:null/away:null` que resolvem dinamicamente a partir do resultado do confronto anterior
  (`fromHome`/`fromAway`) — mesmo padrão de resolução de bracket da Copa do Mundo. Datas e
  emparelhamento de Quartas em diante são placeholder até a CBF confirmar o chaveamento real.
- **Reabertura de palpites fase a fase**: cada confronto tem seu próprio `cutoffIso` (1h antes
  do jogo de ida); um confronto só aparece pra palpitar quando os dois times já estão
  resolvidos E o cutoff dele ainda não passou. Participante edita a própria entrada
  (auto-atendimento, ver abaixo) para preencher os confrontos liberados conforme cada fase
  termina.
- **Símbolo do time**: badge circular colorido com abreviação de 3 letras (`teamBadge()`),
  cor determinística por nome de time (sem depender de API externa/logo real, já que o
  CDB2026 não tem integração ao vivo). Aplicado nos jogos, no formulário de palpites e no
  ranking — não só numa barra de probabilidade (a Copa do Brasil nem tem barra de
  probabilidade; ver também o fix equivalente no Brasileirão nesta mesma sessão).
- **Comprovante (novo — antes o app não tinha nenhum)**: código no formato
  `CDB2026-XXXXXXXX-YYYYMMDD`, mesmo algoritmo FNV-32 (`hashString`) da Copa do Mundo. Exibido
  na tela após salvar e incluído no e-mail de confirmação.
- **Editar minha entrada (auto-atendimento)**: campo "e-mail + código do comprovante" na aba
  Palpites — e-mail sozinho não é considerado segredo suficiente (é visível para o admin e
  seria fácil de adivinhar/coletar), então a edição exige os dois.
- **Botão WhatsApp** no topbar, reaproveitando o mesmo grupo/QR/ícone da Copa do Mundo
  (`assets/whatsapp.svg`, `assets/whatsapp-group-qr.png`) — resolve a divergência `MISSING`
  catalogada em `docs/bolao/CONSISTENCY_MATRIX.md` item 34.
- **QR code Zelle** no card de pagamento (`assets/zelle-qr.png`, reaproveitado da Copa) —
  resolve item 36 da matriz.
- **Admin**: export JSON de backup (`💾 JSON`) e botão "Limpar tudo" (`🗑️`) — resolvem itens 16
  e 7 da matriz. Resultado de cada confronto agora é lançado individualmente pelo admin
  (placar agregado + quem avança), não mais como um único "resultado final" travado de uma vez.
- **CSV**: agora usa `\r\n` (CRLF) em vez de `\n` — resolve item 14 da matriz (regressão do bug
  já corrigido na Copa em v3.0); inclui uma coluna por confronto.

### Ainda não implementado (dívida técnica registrada)

- Sem `audit_scoring.py` equivalente para o CDB2026 (item 1 da matriz) — o novo modelo de
  scoring por confronto + bônus de pódio ainda não tem uma suíte de auto-teste dedicada.
- Sem `AbortController`/timeout nas chamadas Supabase (item 50 da matriz).
- Sem badge de status "ao vivo"/"finalizado" nos jogos (item 44 da matriz) — o CDB2026 não tem
  API externa, então o status vem só de o resultado ter sido lançado ou não pelo admin.

## v1.6 — 2026-07-12

### Novo — seção Jogos (Oitavas de Final) + times reais populados

- **Jogos**: nova aba no nav com os 8 confrontos das Oitavas de Final (ida e volta)
  - Exibe stadium, data e horário em BRT para cada jogo
  - Dados estáticos em `js/data.js` (não depende de API externa)
- **Times**: `js/data.js` atualizado com os 16 times reais das Oitavas:
  Athletico-PR, Atlético-MG, Chapecoense, Corinthians, Cruzeiro, Fluminense,
  Fortaleza, Grêmio, Internacional, Juventude, Mirassol, Palmeiras, Remo, Santos, Vasco, Vitória
- **CSS nav**: `repeat(6, 1fr)` → `repeat(7, 1fr)` para acomodar novo botão
- `audit_scoring.py`: 5/5.

---

## v1.5 — 2026-07-12

### Novo — botões de idioma no topbar (padronização com Copa)

- Adicionado `lang-links` ao topbar: PT-BR ativo, ES-MX e EN-US desabilitados
- CSS `.lang-links button` adicionado (pill style, igual Copa e BR2026)
- Desktop: grid `1fr auto auto` → brand | lang | switcher
- Mobile: brand | switcher (row 1) → lang (row 2) → nav (row 3)
- `audit_scoring.py`: 5/5.

---

## v1.4 — 2026-07-12

### Fixed — alinhamento topbar

- `align-items: center` no grid do topbar (desktop e mobile)
- `audit_scoring.py`: 5/5.

---

## v1.3 — 2026-07-12

### Fixed — segurança + CSS (Big Tech QA audit)

- **SEC LOW-1**: whitelist antes de `location.href` no switcher de bolão
- **CSS MOB-3**: `-webkit-backdrop-filter` adicionado (blur do topbar no iOS Safari ≤ 15)
- `audit_scoring.py`: 5/5.

---

## v1.2 — 2026-07-12

### Design — padronização 100% com a Copa do Mundo (auditoria sistemática)

Mesmas 11 correções do BR2026 v1.9, adaptadas para 6 botões no nav (`repeat(6, 1fr)`). `audit_scoring.py`: 5/5.

---

## v1.1 — 2026-07-11

### Fixed
- **Bug crítico de pontuação**: `scoreEntry()` usava `semiSet = new Set(results.semis)` para checar semifinalistas, ignorando campeão e vice-campeão que também chegaram ao Final Four. Corrigido para usar `semifinalistSet` (que inclui todos os 4 finalistas). Palpite no semifinalista que acerta o campeão agora recebe os 10 pts corretos.
- **Email throttle**: `_lastEmailTs` agora é marcado somente *após* o `await emailjs.send()` ter sucesso (com try/catch). Antes, uma falha de rede consumia o throttle de 30s e o usuário não conseguia retentar.
- **iOS Safari — switcher**: `appearance: none; -webkit-appearance: none` adicionados ao `.bolao-switcher select`. No iOS Safari o seletor agora respeita `border-radius: 999px` e a cor de fundo customizada.

## v1.0 — 2026-07-11

### Initial release
- **Palpites**: campeão, vice-campeão e 2 semifinalistas (4 dropdowns com mutual-exclusion)
- **Pontuação**: campeão exato = 30pts · vice exato = 20pts · semifinalista no Final Four = 10pts cada · máx. 70pts
- **Tiebreaker**: campeão acertado → vice acertado → nome Z→A
- **Ranking**: pontuação final quando admin trava resultado; sem ranking provisório (bolão de cup, não de liga)
- **Admin**: lock/unlock de resultados, marcar pagamentos, editar/apagar entradas, CSV export, Sync Supabase
- **EmailJS**: comprovante ao participante + notificação ao admin (mesmos templates dos outros bolões)
- **Supabase**: pronto para habilitar (`database.enabled: true` após criar row `id='cdb2026'`)
- **Bolão switcher**: dropdown no header para navegar entre Copa do Mundo, Brasileirão e Copa do Brasil
- **Melhorias incluídas desde o início**:
  - `preferRemoteResults` no merge de estado (equivalente ao Copa v4.108)
  - `document.hidden` guard no countdown (sem CPU em background)
  - Seção padrão = Ranking quando prazo passou (equivalente ao Copa v4.104)
  - Tiebreaker Z→A (equivalente ao Copa v4.105)
  - Auto-sync 30s quando Supabase habilitado (equivalente ao Copa v4.108)
- **Times**: placeholder com 8 clubes — Eduardo deve atualizar `js/data.js` com os quarterfinalsitas reais após o sorteio
- Não publicado ainda (sem link a partir do site principal)
