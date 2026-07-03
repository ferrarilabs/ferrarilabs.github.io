# CHANGELOG

## v4.74 — 2026-07-03

### Fixed — deploy do GitHub Pages falhando ("Deployment failed, try again later")
- Eduardo reportou: "deploy / Deploy GitHub Pages / deploy / Failed in 15 seconds". Causa: duas rotinas de deploy disputando a mesma publicação a cada push — o job automático do GitHub Pages ("pages build and deployment", ativo porque o Source do repo está em "Deploy from a branch") e um workflow customizado `.github/workflows/pages.yml` (adicionado por outra sessão, v4.69) usando `actions/deploy-pages@v4`, que só funciona sem conflito se o Source do repo for "GitHub Actions". Como isso não foi alterado, os dois disparavam pro mesmo commit ao mesmo tempo e um sempre falhava com "Deployment failed, try again later" — confirmado nos logs exatos do job via GitHub Actions.
- Correção: removido `.github/workflows/pages.yml`, voltando ao único caminho de deploy que funcionou a sessão inteira (o automático). Eduardo escolheu essa opção em vez de mexer manualmente nas configurações do GitHub Pages.
- Auditoria de pontuação: mudança é puramente de infraestrutura de deploy, não toca em `data.js`, scoring ou `send_result_email.py`. `audit_scoring.py` re-rodado mesmo assim — 5/5 continuam passando.

## v4.73 — 2026-07-03

### Fixed
- **Relógio mostrava "(+11)" de acréscimo do 1º tempo com o jogo já 10 minutos dentro do 2º tempo (Austrália x Egito)**: `formatMatchClock` não tinha limite pra quanto tempo depois de um marco (45/90/105/120 min) ainda considerava "acréscimo" — como o `clockSeconds` da ESPN é um contador contínuo sem noção de "qual tempo estamos", um valor tipo 55:11 (55 min de jogo, ~10 min dentro do 2º tempo) continuava sendo lido como "45:00 + 10 min de acréscimo do 1º tempo" pra sempre, mesmo estando claramente no 2º tempo. Duas correções: (1) um teto de 8 minutos — além disso, presume-se que já viramos de tempo, mostra o relógio puro sem "(+N)"; (2) mais precisa: quando o app observa diretamente o intervalo (`isHalftime`) perto de um marco, grava isso por partida (`localStorage`) e nunca mais considera aquele marco específico como possível acréscimo em andamento, mesmo poucos minutos depois de retomar o jogo. Verificado com Playwright reproduzindo o cenário exato reportado (55:11 sem ter visto o intervalo → mostra limpo) e mais 3 cenários de regressão (acréscimo real do 1º tempo, retomada logo após intervalo confirmado, acréscimo real do 2º tempo perto dos 90 min) — todos corretos.
- Auditoria de pontuação: mudança é só de exibição do relógio ao vivo. Rodei `audit_scoring.py` mesmo assim — 5/5 continuam passando.

## v4.72 — 2026-07-03

### Fixed — badge gigante era cache, não bug de código
Eduardo mandou foto do laptop mostrando o badge America250 enorme, dominando o hero card. Verificado: o código-fonte atual em `main` já estava correto — testei um checkout limpo de `origin/main` (`021c1ae`) com carregamento totalmente sem cache e o badge renderiza pequeno e certo (34px de altura, exatamente como pretendido). Causa real: dois commits ficaram com o MESMO número de versão "v4.71" — o meu (fix do badge, `7e590ca`) e um fix de layout de navegação de outra sessão que chegou ~1 minuto depois (`021c1ae`) sem bumpar `siteVersion` de novo. Como o cache-busting (`?v=`) depende desse número, o CSS mudou de conteúdo duas vezes sob a mesma URL — o navegador do Eduardo (ou algum cache intermediário) pegou uma cópia inconsistente durante essa janela de transição. Bump pra v4.72 força uma URL de cache-busting garantidamente nova.

## v4.71 — 2026-07-03

### Fixed
- **Badge "America 250" quebrado (Eduardo): "O logo america 250 nao ficou legal, arrume ele"**. Causa: um bug de seletor CSS — `.america250-badge span:first-child` pretendia estilizar só a bandeirinha, mas essa combinação (descendente + `:first-child`) também batia em `.a250-label` ("AMERICA"), já que ele também é o primeiro filho do SEU PRÓPRIO pai (`.a250-text`). Isso fazia "AMERICA" herdar 17px em vez dos 7px pretendidos, com especificidade maior que a regra certa — o texto ficava gigante, colidindo com as estrelas, e "250" quebrava linha. Também investigado: os fogos de artifício não são bug, só estão programados pra só aparecerem no dia 4/jul (`getMonth()===6 && getDate()===4`) — testado forçando a data e confirmado que funcionam normalmente.
- Tentei achar o logo oficial via Wikimedia Commons pra usar em vez de recriar em CSS, mas o sandbox não tem acesso de rede pra esses domínios (403 da política de rede). Eduardo mandou o PNG oficial diretamente — extraí o fundo preto (transparência via luminância), recortei e redimensionei (`bolao/assets/america250-logo.png`), e troquei o badge inteiro (que antes era bandeira+texto+estrelas em CSS) pra usar a imagem oficial de verdade.
- Auditoria de pontuação: mudança é só visual (imagem estática), não mexe em resultado/ranking. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.65 — 2026-07-03

### Fixed — M85 resultado em data.js
- Switzerland 2-0 Algeria (Final) — ESPN já mostrava "post"; data.js ainda estava "Scheduled"

### Added — banner de reabertura com contagem regressiva
- `#reopenBanner`: aparece enquanto o site está fechado (cutoffIso no passado)
- Mostra M86/M87/M88 com status dinâmico (⏳ / 🔴 ao vivo / ✅ concluído)
- Conta regressiva em segundos até o kickoff do M88 (Colombia vs Ghana 21:30 EDT)
- Após M88 kick off: "ao vivo — aguardando resultado"
- Quando resultado do M88 chega no Supabase: "site reabre em instantes" + botão recarregar
- `startReopenPolling()`: verifica config.js a cada 60s; auto-reload quando `auto_reopen.py`
  comitar `cutoffIso = 2026-07-04T12:00:00-04:00` no GitHub Pages
- Informa prazo: palpites R16 disponíveis até 12:00 EDT (4 jul)

### Verified — bracket 100% até a Final
- M89 Canada vs Morocco · M90 Paraguay vs France · M91 Brazil vs Norway
- M92 Mexico vs England · M93 Spain vs Portugal · M94 Belgium vs United States
- M95 W(M87) vs W(M86) · M96 W(M85=Switzerland) vs W(M88) · QF/SF/3rd/Final corretos
- Sem conflitos de chaveamento · Audit 5/5

## v4.62 — 2026-07-03

### Fixed
- **Relógio ao vivo continuava andando durante o intervalo de verdade (Portugal x Croácia)**: mesmo depois do v4.61 tornar o relógio monotônico (nunca volta pra trás), um relógio genuinamente PAUSADO (intervalo, uma parada longa qualquer) ainda parecia "atrás da extrapolação" pra essa lógica — e como não existe mais nenhum teto (o v4.61 removeu o cap de 150s de propósito, pra resolver o problema de saltos pra trás), o relógio ficava subindo pra sempre durante a pausa inteira, sem se autocorrigir nunca. Corrigido com uma detecção que não depende de adivinhar o texto de status da ESPN pra intervalo: compara o `clockSeconds` bruto entre dois polls reais — se passou bastante tempo real mas o relógio do jogo mal andou, está pausado, e tanto a extrapolação armazenada quanto a interpolação exibida na tela param completamente até o relógio voltar a se mexer de verdade. Compatível com a reescrita monotônica do v4.61 — só entra em ação quando uma pausa real é detectada, sem interferir na lógica de reset de período deles.
- Auditoria de pontuação: mudança é só de exibição do relógio ao vivo, não mexe em resultado/ranking. Rodei `audit_scoring.py` mesmo assim — 5/5 continuam passando.

## v4.64 — 2026-07-03

### Added — odds DraftKings via ESPN (zero custo, zero chamadas novas)

A pesquisa da madrugada revelou que `fetchEspnFixtures()` já traz o campo `competitions[0].odds[0].moneyline.home/away/draw.close.odds` no mesmo JSON que sempre foi buscado — apenas nunca foi lido.

- `americanToImplied()`: converte odds americanas (+135, -550) em probabilidade implícita
- `extractEspnOdds(events)`: varre o payload ESPN e popula `_espnOddsCache` com probabilidades vig-stripped (home + draw + away normalizados para somar 1) para cada jogo identificado no bracket
- Barras de pré-jogo agora têm 3 fontes em prioridade: **1) DraftKings via ESPN** → 2) Polymarket normalizado → 3) ELO+Poisson. DraftKings é publicado 1-2 dias antes do apito para jogos concretos (times definidos).
- Nota "Barras: odds DraftKings via ESPN" aparece na tab Probabilidades quando dados estão carregados.

Dados confirmados para R16: Paraguay 5% / ET 14% / France 81%, Brazil 51% / ET 25% / Norway 23%, Spain 49% / ET 27% / Portugal 24%, etc. Audit: ✓ 5/5.

## v4.63 — 2026-07-02

### Added — Polymarket como fonte de probabilidades

**Tab Probabilidades:** coluna "📈 Mercado" ao lado do nosso Monte Carlo. Preços ao vivo do mercado "World Cup Winner" do Polymarket (event 30615) — mostra o que o mercado de previsão coloca em cada time. Diferença clara: nosso ELO tinha Brasil alto, Polymarket mostra França 34%, Argentina 20%, Brasil 6%. Cache de 60 min (configurável em `config.js`).

**Barras de pré-jogo nos jogos do mata-mata:** agora usam a probabilidade derivada do Polymarket via normalização — P(A avança) = poly_A / (poly_A + poly_B) — em vez do modelo ELO puro. A fatia ET/Pens é estimada como min(22%, 2×min(advA,advB)) para que jogos muito desequilibrados (França vs Paraguai) não aloquem probabilidade absurda de prorrogação. Carregado no init da página, barras já aparecem com dados do mercado desde o primeiro acesso.

`fetchPolymarketOdds()`, `polyMatchProb()`, coluna `.poly-bar` (âmbar) na tabela de probs. Scoring não foi tocado — audit 5/5 passando.

## v4.62 — 2026-07-03

## v4.61 — 2026-07-02

### Fixed — relógio ao vivo monotônico + email em quasi-tempo-real após jogo

**Relógio ao vivo (`mergeLiveClock`):** O antigo guard de `behindBy < 150s` bloqueava a extrapolação apenas para lags pequenos — se o feed da ESPN atrasasse mais de 2m30s (comum na Copa com VAR, transições de período, tab em background), o relógio pulava para trás visivelmente. A nova lógica torna o relógio **monotônico durante o jogo**: nunca volta, independentemente do lag do ESPN. O único momento em que aceita uma queda é quando a diferença parece um reset de período legítimo (clock cai de próximo a um múltiplo de 45 min para perto de 0), cobrindo início do 2T, início da prorrogação e início do 2T da prorrogação.

**Email quasi-tempo-real (`run_auto` + `any_copa_match_live`):** O modo `--auto` agora detecta quando há um jogo ao vivo após não encontrar resultados novos. Nesse caso, em vez de sair e esperar o próximo cron (até 10 min), fica em loop de polling a cada 2 min por até 80 min até o jogo terminar — detectando o final em até ~2 min em vez de até 10. O `timeout-minutes` do workflow foi ajustado para 100 min para comportar esse loop.

## v4.60 — 2026-07-02

## v4.59 — 2026-07-02

### Changed
- **Relógio ao vivo mostra acréscimos e intervalo, estilo Google**: pedido depois de um print do placar do Google (Portugal x Croácia, "46:03 (+4)" no intervalo). Agora, quando o relógio passa de 45/90/105/120 minutos, mostra "(+N)" com os minutos de acréscimo em vez de só continuar contando (ex: "46:03 (+2)"). Durante o intervalo (detectado via status da ESPN), mostra "Intervalo" em vez de um relógio andando — antes o relógio interpolado continuava subindo durante o intervalo todo, o que não fazia sentido (o jogo não está rolando). Aplica no card "ao vivo" do hero e no chip de status da aba Jogos. O cálculo de probabilidade ao vivo (minuto da partida) foi desacoplado do texto exibido, usando o `clockSeconds` bruto diretamente, pra não quebrar com o novo texto "(+N)"/"Intervalo".

## v4.58 — 2026-07-02

### Added — auditoria automática antes de CADA envio de email, não só uma vez
Eduardo, depois da auditoria do v4.57: "acho que a gente deveria fazer isso antes de um email ser enviado, logo depois que o jogo termina... precisa rodar uma auditoria completa pra garantir 1000% de precisão... não quero ouvir os usuários me dizendo de novo que não entendem a pontuação... isso nunca pode quebrar... todo pedido de mudança que eu fizer, revise se a função de pontuação continua funcionando, mesmo que seja só pra dizer que nada mudou." Duas coisas viraram regra permanente:

- **`bolao/scripts/audit_scoring.py` (novo)**: bateria de 5 checagens estáticas (bracket bate com `data.js`, simulação de torneio completo com bracket perfeito, bônus+4º lugar presentes, validação de placar bate com o site, ordem de desempate correta) rodável isolada (`python3 audit_scoring.py`) ou importada. `send_result_email.py --auto` agora roda essa auditoria ANTES de tocar em qualquer coisa — se falhar, não salva nem envia email nenhum (saída não-zero, falha visível no GitHub Actions).
- **Checagem em tempo real por partida**: além do duplo-check de estabilidade já existente (v4.55), cada resultado "confirmado" agora passa por `check_match_is_real()` (data do evento não pode ser futura; times não podem ainda ser um slot "WN"/"LN" não resolvido) e `check_result_shape()` (placar 0–20, `advanceSide` só A ou B) antes de ser salvo ou disparar email. Isso mira especificamente o problema que já aconteceu antes (ver "Resultados somente do banco de dados" no changelog): um resultado aparecendo pra uma partida que não tinha realmente acontecido ainda.
- Testado com simulação completa: bracket antigo (quebrado, pré-v4.57) reintroduzido numa cópia isolada confirma que a auditoria realmente pega os 9 confrontos errados; teste de integração ponta a ponta simula `run_auto()` inteiro com um resultado real (salva + envia, 1 destinatário) e com um resultado com data no futuro (corretamente bloqueado, zero salvamentos, zero emails).
- **Regra permanente documentada no `CLAUDE.md`**: essa é a parte do site que nunca pode quebrar — tem dinheiro real em jogo. A partir de agora, toda mudança no repositório (relacionada a pontuação ou não) deve rodar `audit_scoring.py` e reportar o resultado explicitamente, mesmo que seja só "nada mudou, auditoria continua passando".

## v4.57 — 2026-07-02

### Fixed — auditoria estilo Big 4 no pipeline de resultado/ranking (Eduardo pediu depois de reclamações sobre o ranking)
Disparado por participantes questionando o ranking (print do WhatsApp da Aline: "Wu tava em 7 atras do ewerton e agora o vini pegou meu lugar" — na verdade só faltava o resultado da Espanha, já resolvido). Eduardo pediu uma auditoria completa dos resultados/ranking, com a exigência de sempre verificar isso antes de qualquer PR daqui pra frente. Todos os problemas encontrados estavam isolados em `send_result_email.py` (o script Python do cron de email) — o site (`app.js`) já estava correto em todos os pontos abaixo, usa uma única fonte de verdade (`scoreEntry()`) em todo lugar (ranking, CSV, master export, email manual do admin).

- **[Crítico] Chaveamento das Oitavas/Quartas estava errado em 9 dos 16 confrontos**: `MATCH_TEAMS` no script tinha pares diferentes do bracket real em `data.js` (ex: M89 estava codificado como "vencedor M73 x vencedor M74", mas o confronto real é "vencedor M73 x vencedor M76"). Isso não geraria um resultado errado — a busca por esse confronto na ESPN simplesmente nunca bateria, então os emails automáticos das Oitavas em diante parariam silenciosamente de funcionar assim que a Fase de Grupos... digo, a Rodada de 32 terminasse (R16 começa 4/jul, faltavam só 2 dias). Corrigido e verificado programaticamente contra `data.js` (todos os 32 confrontos batem agora) e com simulação completa do torneio (bracket "perfeito" resolve o campeão corretamente através das 4 rodadas de mata-mata).
- **[Alto] Pontos de bônus (campeão/vice/3º/4º: 25/15/10/5 pts) nunca eram somados no total do email** — só eram usados como critério de desempate, nunca como pontos de fato. O site já soma esses pontos no total (`scoreEntry`). Assim que alguém acertasse um palpite de pódio (o que só é possível perto da final), o total mostrado no email ficaria MENOR que o total real do site — divergência que só apareceria bem na reta final, quando o dinheiro do prêmio está em jogo.
- **[Alto] 4º lugar computado mas descartado**: as duas funções de resolução de pódio calculavam a variável `fourth` internamente mas nunca a incluíam no dicionário retornado — o bônus de 4º lugar (+5) nunca conseguia ser concedido a ninguém, mesmo que a lógica acima estivesse corrigida.
- **[Baixo] Validação de placar mais permissiva no Python que no site**: `_parse()` aceitava negativos e valores acima de 20 que o formulário do site (`parseScore`) já rejeita — endurecido pra bater exatamente com a mesma regra (dígitos, 0–20).

Todas as correções verificadas com testes automatizados: comparação programática linha a linha entre `MATCH_TEAMS` e `data.js`, simulação de torneio completo com bracket perfeito (campeão resolve corretamente através de 4 rodadas, bônus = 55 pts, total bate com o esperado), e `build_html()` ponta a ponta com múltiplas entradas e resultados mistos.

## v4.56 — 2026-07-02

### Changed
- **Lista de artilheiros dividida em duas colunas, uma pro lado de cada time (Eduardo):** "identado ao lado do time... assim se os dois times fizerem gol você tem um na esquerda e um na direita, tipo o Google." Antes era uma lista única centralizada com uma bandeirinha por linha; agora os gols do time A ficam na coluna esquerda e os do time B na direita, alinhados como os nomes dos times logo acima — quem fez o gol fica óbvio pela posição, sem precisar de bandeira em cada linha.

## v4.55 — 2026-07-02

### Fixed
- **Placar ao vivo podia congelar indefinidamente ("mostrando jogo em andamento a noite toda")**: `extractGoalEvents()` (novo em v4.53, artilheiro + minuto) rodava sem proteção dentro de `mapEspnToLiveScores()` — se a ESPN mandasse qualquer item inesperado dentro de `competitions[].details` (ex: entrada nula no array), a função lançava uma exceção ANTES de `_liveScores` ser atualizado, travando o placar/relógio ao vivo de TODAS as partidas indefinidamente (não só o artilheiro), até a página ser recarregada. Agora `extractGoalEvents()` nunca lança exceção — qualquer formato inesperado só derruba a lista de artilheiros daquela partida, sem afetar placar/relógio. Reproduzido com Playwright (array `details` com entradas nulas/inválidas) — placar ao vivo continua atualizando normalmente.
- **Cron de email automático tinha sido removido sem querer**: um commit anterior (v4.40, 1/jul) trocou o envio automático de emails por um fluxo manual (admin clica "Enviar emails agora" ou dispara o GitHub Action manualmente) — mas isso exige alguém ativo o tempo todo. Restaurado o agendamento automático (`*/10 min` durante a janela de jogos) em `auto_results.yml`, mantendo o disparo manual disponível também.
- **Duplo-check antes de mandar email de resultado**: `send_result_email.py --auto` agora espera 20s e busca a ESPN de novo antes de confirmar um resultado como definitivo — só salva no Supabase e envia email se o placar e o time que avança baterem nas duas consultas. Evita mandar um resultado errado caso a ESPN marque "final" um instante antes de uma correção tardia (VAR, ajuste de estatística).

### Added
- **Barra de probabilidade no card "Próximo jogo" do topo**: até agora só aparecia na aba Jogos (pré-jogo) e no card "ao vivo" — faltava no hero quando não há nenhum jogo rolando, então ninguém via a probabilidade antes do jogo começar de fato. Extraído `preMatchProbBarsHtml()` (compartilhado com a aba Jogos, mesma conta) e adicionado ao card do hero.

## v4.54 — 2026-07-02

### Fixed
- **Banner de "jogo encerrado" mostrava um botão de admin pra todo mundo**: Eduardo pegou um screenshot mostrando o banner com "🔐 Admin → enviar emails" aparecendo para um participante comum. O banner é público (dispara pra qualquer visitante quando um jogo termina), mas o botão navegava pra seção Admin — expondo um fluxo de admin pra todo o bolão. Agora só quem já está logado como admin vê algum botão de ação ali (o de "Enviar emails agora"); todo mundo mais só vê o aviso "Jogo encerrado! M{id} encerrado" e o X pra fechar.

## v4.53 — 2026-07-02

### Added
- **Nome de quem fez o gol e o minuto no placar ao vivo**: pedido depois de um print do placar ao vivo do Google (Espanha x Áustria mostrando "M. Oyarzabal 36'" / "P. Porro 66'" abaixo do placar). O app agora extrai os gols (`competitions[].details`) do mesmo evento da ESPN que já usamos pro placar/relógio — sem chamada de rede extra — e mostra artilheiro + minuto tanto no card "ao vivo" do topo quanto no card do jogo na aba Jogos. Best-effort: se a ESPN não mandar esse detalhe pra uma partida específica, a lista simplesmente não aparece, sem quebrar o resto do card.

## v4.52 — 2026-07-02

### Fixed
- **Posições da tabela de pontuação ao vivo fora de ordem**: o número da "Pos." e a ordem visual das linhas usavam critérios de desempate diferentes quando duas entradas empatavam na pontuação provisória geral — o número da posição desempatava por ordem de cadastro, mas a linha em si era ordenada pelos pontos daquela partida específica, então "Pos. 3" podia aparecer visualmente acima de "Pos. 2". Agora os dois usam exatamente o mesmo critério (pontuação provisória geral, desempatada pelos pontos da partida ao vivo), então a lista sempre aparece em ordem 1, 2, 3... batendo com o número mostrado.

## v4.51 — 2026-07-02

### Added
- **Estimativa própria de probabilidade agora usa estatísticas reais do jogo**: quando o modelo de probabilidade da ESPN não estiver disponível, o app tenta buscar chutes a gol e posse de bola do jogo (via `site.api.espn.com/.../summary`, mesmo domínio já usado pro placar — mais provável de funcionar que a API de probabilidade especializada) e usa isso pra ajustar o cálculo próprio (70% força pré-jogo + 30% domínio do jogo em andamento), em vez de depender só do rating estático dos times + tempo decorrido. Essas estatísticas não aparecem em lugar nenhum da interface — são só um dado de entrada a mais pro cálculo. Se a busca falhar, cai pro cálculo estático de sempre, sem quebrar nada.

## v4.50 — 2026-07-02

### Changed
- **Barra de probabilidade nunca fica totalmente vazia**: em vez de esconder o rótulo inteiro em fatias estreitas (< 12%), agora sempre mostra pelo menos o "N%" — só o nome do time/rótulo é que some quando não cabe. O tooltip ao passar o mouse continua com a informação completa.

## v4.49 — 2026-07-02

### Added
- **Barra de probabilidade também no card "ao vivo" do topo**: antes só aparecia nos cards de jogo da aba Jogos — agora aparece embaixo do placar no card ao vivo do hero também, mesmo cálculo (compartilhado via `liveProbBarsHtml`, sem duplicar lógica).
- **Tentativa de usar o modelo de probabilidade real da ESPN**: além do cálculo próprio (Poisson com base na força dos times), o app agora tenta buscar a probabilidade real da ESPN (`sports.core.api.espn.com/.../probabilities`, o mesmo tipo de modelo que alimenta os placares ao vivo deles) uma vez por ciclo de poll. Se a ESPN não devolver dado válido pra futebol (não documentado, não foi possível confirmar antes do deploy), cai automaticamente pro cálculo próprio — nunca quebra.

### Fixed
- **Texto cortado em fatias estreitas da barra de probabilidade** (ex: "Austria 3%" vazando pra fora da fatia azul): fatias abaixo de 12% agora escondem o texto (mantendo cor + tooltip ao passar o mouse) em vez de estourar o texto pra fora da barra.

## v4.48 — 2026-07-02

### Fixed
- **Relógio ao vivo ainda voltava pra trás a cada refresh da página**: a correção da v4.47 só funcionava enquanto a aba ficava aberta continuamente — o estado que protege contra retrocesso vivia só na memória do JavaScript, então um refresh (F5 / recarregar) zerava tudo e o primeiro poll depois do reload aceitava o valor (atrasado) da ESPN sem nenhuma referência anterior pra comparar. Agora o último relógio conhecido de cada partida é salvo no `localStorage` a cada poll, então mesmo logo após um refresh o app tem uma referência pra continuar contando pra frente em vez de voltar. Testado simulando exatamente esse cenário (tempo real avança, ESPN reporta atrasado, dá refresh) — o relógio não regride mais.

## v4.47 — 2026-07-02

### Fixed
- **Relógio ao vivo "resetando" ao voltar pra aba (durante o jogo da Espanha)**: o cronômetro interpolado podia visivelmente pular pra trás quando o app fazia um poll novo na ESPN logo depois do usuário sair e voltar pra página — o feed gratuito da ESPN atrasa em relação ao tempo real (tipicamente até ~1-2 min, pior logo após retomar). Adicionado `mergeLiveClock()`: se o valor novo da ESPN estiver *pouco* atrasado em relação ao que já estava na tela, o relógio continua contando a partir do valor extrapolado em vez de saltar pra trás. Um salto grande (ex: início do 2º tempo, prorrogação) continua passando normalmente — não é bloqueado.

## v4.46 — 2026-07-02

### Changed
- **Barras de probabilidade pré-jogo (Google-style)**: jogos agendados agora mostram a mesma barra visual colorida que os jogos ao vivo — barra proporcional ao % de vitória de cada time, com "ET/Pen." no meio para mata-mata e "Emp" para fase de grupos
- **Label correto nas barras**: fase de grupos usa "Emp"; mata-mata usa "ET/Pen." — tanto em live quanto pré-jogo
- **Auto-scroll Jogos**: ao clicar na aba Jogos, a lista rola automaticamente até o próximo jogo agendado

### Fixed
- **i18n barras (A1)**: "Emp" hardcoded em português substituído por `t("probDrawShort")` — usuários en-US/es veem "D"/"Emp"
- **90' empatado mata-mata (C2)**: barras ocultas quando relógio ≥ 90 min e jogo empatado em mata-mata (evitava "Emp 100%")
- **ARIA prob-bars (C1)**: `role="meter"` inválido removido; substituído por `role="group"` com `aria-label` localizado
- **Debounce scheduleMC (A3)**: flag `_mcPending` evita múltiplos `setTimeout` enfileirados
- **copaExpectedGoals NaN (M1)**: guard para `total=0` retorna lambdas neutras 1.2/1.2
- **matchProb normalizado (M4)**: probabilidades de vitória/empate/derrota somam exatamente 100%
- **parseMinute (M2/M3)**: string vazia retorna -1 (sem barras); "0:00" retorna 0 (barras mostram no kick-off)
- **probsNoData**: texto atualizado sem referência obsoleta a "início do mata-mata"

## v4.45 — 2026-07-02

### Added
- **Aba "Probabilidades"**: nova seção com simulação Monte Carlo (2.000 iterações) da Copa do Mundo 2026. Mostra P(Campeão), P(Final) e P(Semi) para cada seleção ainda no torneio, usando modelo Poisson bivariado com os ratings de força das equipes. Botão "Recalcular" + cache de 5 minutos para não sobrecarregar.
- **Barras de probabilidade ao vivo**: durante partidas em andamento, barras animadas (tipo Google) abaixo do placar mostram probabilidades dinâmicas de vitória/empate/derrota conforme o jogo avança e gols são marcados.
- **Hint de probabilidade por jogo**: jogos ainda não disputados mostram um hint discreto (ex: "🎲 Brasil 62% · Emp 21% · Japão 17%") abaixo do local, calculado com as mesmas ratings de força.

## v4.44 — 2026-07-02

### Fixed
- **Banner "jogo encerrado" — botão admin quebrado**: o botão "🔐 Admin → enviar emails" usava `onclick="showSection('admin')"` inline, que era bloqueado pelo CSP (`script-src` sem `'unsafe-inline'`) e também não encontrava a função (dentro do IIFE). Migrado para `data-banner-nav="admin"` com handler no event delegation existente.
- **Botão de salvar em modo edição**: o bloco `finally` de `saveEntry()` sempre restaurava o texto "Salvar entrada", mesmo quando o usuário estava no modo edição de palpites. Agora restaura "Atualizar entrada" se `_editingEntry` ainda estiver ativo (ex: validação falhou e o modo ainda está ativo).
- **Campo de senha admin não limpo após tentativa errada**: ao errar a senha, o campo `#adminPassword` não era apagado, deixando o texto visível para quem pudesse ver a tela. Agora é limpo imediatamente após uma tentativa falha.

## v4.43 — 2026-07-02

### Fixed
- **Countdown sem jitter de tamanho**: horas e minutos agora são sempre 2 dígitos (padStart "0"), igual aos segundos. Somado a `font-variant-numeric: tabular-nums` e `min-width: 2ch` nos dígitos, a caixa do countdown não muda mais de largura a cada segundo.

### Added
- **Versão e última sincronização discreta no rodapé**: rodapé minúsculo (11px, opacity 60%) mostra `v4.43 · sync 02/07 14:32 ET` — útil para confirmar visualmente que o deploy chegou e quando foi a última sincronização com o Supabase.

## v4.42 — 2026-07-02

### Added
- **Notificação automática de jogo encerrado (browser)**: quando o ESPN confirma que um jogo acabou (live → não-live na próxima poll), aparece um banner verde sticky no topo da página com o placar e um botão "📧 Enviar emails agora". Se o admin estiver logado, o sync do ESPN já roda silenciosamente antes de mostrar o botão. Se não estiver logado, o banner mostra um link para a aba Admin.
- **GitHub Actions — disparo manual**: removido o cron de `auto_results.yml`; o workflow agora só dispara via `workflow_dispatch` (botão "Run workflow" no GitHub.com ou app mobile). Roda `send_result_email.py --auto` que sincroniza ESPN → Supabase → envia emails para todos, de forma idempotente (não envia duplicatas).

### Changed
- `runEspnUpdate()` aceita `{ silent: true }` para rodar sem alerts quando chamado automaticamente pela detecção de fim de jogo.

## v4.41 — 2026-07-02

### Added
- **Contador de placares exatos em "Ver palpites"**: no final da tabela de palpites de cada entrada (na aba Ranking), agora mostra quantos placares exatos aquela entrada acertou — o mesmo número usado no primeiro nível do critério de desempate, pra facilitar entender por que uma entrada ficou acima de outra com o mesmo total. Reaproveita `exactMatchCount()`, sem duplicar a lógica.

## v4.40 — 2026-07-02

### Added
- **Critério de desempate no ranking**: definido depois de um print no grupo mostrando dois primeiros lugares empatados. Cascata: (1) pontos totais, (2) mais placares exatos, (3) mais acertos de campeão/vice/3º lugar. Se ainda empatar depois dos três níveis, a posição (e o prêmio daquela colocação) é dividida entre os empatados — igual já acontecia visualmente, só que agora é decisão explícita, não um efeito colateral da ordenação estável. Implementado de forma consistente no ranking do site, no gerador de e-mail em JS (usado pelo botão de admin) e no script Python do cron automático (`send_result_email.py`), incluindo a resolução da árvore do mata-mata para achar o campeão/vice/3º previstos por cada entrada.
- Nova regra no site (`rulesStandingsTie`) documentando o critério, nos três idiomas.

## v4.39 — 2026-07-01

### Fixed
- **Relógio ao vivo correndo**: o cronômetro do card ao vivo agora conta os segundos em tempo real entre polls do ESPN (antes ficava estático mostrando só minutos, atualizava só a cada 60s). ESPN retorna segundos inteiros, mas o relógio avança continuamente via interpolação.
- **Ranking ao vivo mostra posição geral, não posição no jogo**: a tabela de pontuação provisória agora é ordenada pelo total geral provisional (não pelos pontos daquele jogo específico) e exibe a posição real do participante no ranking geral — ex.: "3°" quer dizer 3° no bolão inteiro, não 3° entre quem apostou naquele jogo.
- **Jogo encerrado não fica mais "Em andamento"**: ao término da partida (ESPN confirma FULL_TIME), o card some corretamente e mostra o próximo jogo. Antes ficava mostrando "Em andamento" por até 3 horas após o apito. Novo comportamento: jogo ignorado após 135 min do horário de kickoff sem placar ao vivo confirmado.
- **BUG-04 crítico — entrada manual de resultado reativada**: admin pode agora inserir resultado manualmente para jogos com empate no placar (que vão a pênaltis). Antes `box.innerHTML = ""` desabilitava o painel inteiramente.
- **BUG-01 — pontuação funciona offline/sem sync**: `scoreEntry()` agora usa os resultados hardcoded de data.js como fallback quando o admin ainda não rodou o ESPN sync. M73 (Canadá) e M74 (Brasil) agora pontuam corretamente para usuários com localStorage limpo.
- **BUG-03 — isToday() usa timezone correto**: comparação de "hoje" agora usa `America/New_York` em vez de comparar UTC com local, eliminando o falso "jogo de hoje" quando se está a leste do ET.
- **BUG-05 — autoFill respeita R32 bloqueadas**: ao usar ⚡ Simular ou 🎲 Simular Maluco no modo de edição, os campos R32 (M73–M88) bloqueados para edição não são mais sobrescritos.
- **A11Y-01 — foco se move ao trocar seção**: ao clicar nas abas de navegação, o foco do teclado/leitor de tela vai automaticamente para o primeiro cabeçalho daquela seção.
- **A11Y-02 — aria-label contextual em "Ver palpites"**: o botão agora inclui o nome da entrada no aria-label, facilitando navegação por leitor de tela.
- **SEC-05 — flag() escapado em innerHTML**: todos os usos de `flag()` dentro de templates HTML agora passam por `escapeHtml()` para evitar possível XSS via nomes de times.

## v4.35 — 2026-07-02

### Added
- **Posição numerada na pontuação ao vivo**: a lista de pontuação provisória (embaixo do placar no hero e no dropdown da aba Jogos) agora mostra o número da posição (1, 2, 3...) de cada entrada, junto com a seta ▲/▼, em vez de só a seta ao lado do nome.

## v4.34 — 2026-07-02

### Added
- **Pontuação ao vivo direto no card do topo**: o card "ao vivo" no hero agora mostra, sempre visível logo abaixo do placar, a lista de quem apostou o quê naquela partida e quantos pontos cada um estaria fazendo com o placar atual (com as setas ▲/▼) — antes isso só existia escondido atrás do botão "Ver pontuação ao vivo" na aba Jogos. Reaproveita a mesma `liveMatchPointsTable()`, sem duplicar lógica.

## v4.33 — 2026-07-02

### Changed
- **Card "ao vivo" do topo redesenhado, estilo Google**: o card de partida ao vivo no hero agora segue o layout do placar ao vivo do Google (referência enviada pelo Eduardo) — bandeira de cada time em um selo arredondado, nome do time embaixo, placar grande dos dois lados, e no centro um badge "AO VIVO" com o cronômetro (MM:SS) sublinhado em vermelho. Antes era um bloco empilhado (badge/placar/times em texto corrido); agora é times-placar-badge-placar-times, igual à referência.

## v4.32 — 2026-07-02

### Added
- **Setas de variação também no placar ao vivo por partida**: o dropdown "🔴 Ver pontuação ao vivo" de cada jogo em andamento agora mostra ▲/▼ ao lado de cada entrada, indicando se ela subiu ou desceu na pontuação provisória *daquela partida* desde a última mudança no placar ao vivo — igual à tabela do Brasileirão em tempo real no Globo Esporte. Reaproveita a mesma lógica de setas do ranking geral (extraída para `computeRankArrows(key, items)`, agora compartilhada entre o ranking oficial e cada partida ao vivo, uma "trilha" de setas por jogo).
- Texto de aviso do placar ao vivo reforçado nos três idiomas: deixa explícito que o banco de dados e o ranking oficial só atualizam quando a partida termina oficialmente — nunca durante o jogo. A pontuação/setas ao vivo são só uma prévia no navegador, nunca gravadas no Supabase.

## v4.31 — 2026-07-01

### Fixed
- **Cache-busting parado desde v4.19**: os `?v=` de `styles.css`/`config.js`/`data.js`/`i18n.js`/`app.js` no `index.html` não eram atualizados desde a v4.19, mesmo com várias releases depois (v4.20–v4.30). Navegadores (principalmente mobile) continuavam servindo os arquivos antigos do cache em vez de buscar a versão nova após cada deploy. Atualizado para `?v=4.31` — provável causa de "não estou vendo as mudanças no celular".
- **Card "Próximo jogo" quebrado no mobile**: o cronômetro (HRS/MIN/SEG) herdava a regra `.count-grid { grid-template-columns: repeat(2, 1fr) }` do breakpoint `max-width:500px` — pensada para o countdown de 4 células (dias/hrs/min/seg) do banner principal — fazendo o cronômetro de 3 células quebrar em 2+1 de forma feia. Adicionado override específico para `.next-match-timer` restaurando 3/4 colunas. Também: o card agora empilha (informação do jogo em cima, cronômetro embaixo, full-width) em telas estreitas em vez de espremer o cronômetro ao lado do nome dos times, evitando que a altura do card varie de forma estranha conforme o tamanho do nome dos times (ex: "Bosnia and Herzegovina").

## v4.27 — 2026-07-01

### Added
- **Pontuação ao vivo por jogo**: nos cards de jogos em andamento (aba Jogos), um botão "🔴 Ver pontuação ao vivo" abre uma lista com cada entrada, seu palpite e quantos pontos ela faria *se o placar atual valesse agora* — provisório, não escreve em `state().results`, só conta oficialmente quando o admin confirmar o resultado. O dropdown fica aberto entre atualizações (a cada poll de 60s) em vez de fechar sozinho.
- **Cronômetro em minutos e segundos**: o badge "🔴 Ao vivo" agora mostra o tempo decorrido da partida como MM:SS (ex: "63:27"), usando o campo `status.clock` (segundos) da ESPN em vez do texto resumido (que só tinha o minuto).
- **Setas de variação no ranking**: cada posição no ranking agora mostra ▲ ou ▼ quando a colocação da entrada mudou desde a última vez que a pontuação oficial mudou (estilo tabela de campeonato). Não pisca em re-renders que não mudam a pontuação (troca de idioma, etc.) — só atualiza quando o placar oficial de fato muda.
- Chaves i18n novas (`liveToggleShow`, `liveEntryCol`, `livePickCol`, `livePointsCol`, `liveProvisionalNote`, `liveNoPicks`, `rankUp`, `rankDown`) nos três idiomas.

## v4.26 — 2026-07-01

### Added
- **Pontos por partida no ranking**: a tabela de palpites ("Ver palpites" em cada entrada do ranking) agora mostra, para cada jogo do mata-mata, o resultado real e quantos pontos a entrada ganhou naquela partida especificamente — não só o total. Colunas novas: "Resultado real" e "Pontos" (destacado em verde quando > 0).
- Chaves i18n `pickRealLabel` e `pickPointsLabel` nos três idiomas.

### Changed
- **Refatoração (sem mudança de comportamento)**: a lógica de pontuação por partida foi extraída de `scoreEntry` para uma função compartilhada `matchPoints(pick, result)`, reutilizada tanto no cálculo do total quanto na nova coluna de pontos — elimina duplicação e garante que os dois lugares nunca divirjam. `scoreEntry` continua retornando exatamente `{ total, bonus }` como antes; verificado que o total por entrada não mudou.

### Fixed (correção de atribuição)
- Sugestão de placar/pontuação ao vivo (v4.25) foi do Alan (participante), não do Eduardo — corrigido em `docs/bolao/BUGS_AND_FEEDBACK.md`.

## v4.25 — 2026-07-01

### Added
- **Placar ao vivo na aba Jogos**: sugestão de usuário — a aba "Jogos" agora busca a fonte ESPN (já usada no sync do admin) a cada 60s, para qualquer visitante, e mostra um badge "🔴 Ao vivo" com o minuto/status do jogo em andamento, sem precisar de login admin. O placar ao vivo é só exibição — não escreve em `state().results`, então não afeta a pontuação até o admin aplicar o resultado oficial (mantém a proteção contra sobrescrita manual já existente).
- **Ranking com auto-atualização**: o ranking (pontuação) agora recarrega do Supabase a cada 90s enquanto a aba está visível, além dos gatilhos existentes (foco/visibilitychange). Participantes veem a pontuação mudar sem precisar trocar de aba ou dar refresh.
- Novas chaves i18n `gameLive` e `gamesLiveNote` nos três idiomas.

## v4.15 — 2026-06-29

### Added
- **Botão "📧 Email a todos" e "📧 Teste (admin)" no painel admin**: Envia o email de resultado parcial diretamente do browser (funciona no celular). Usa EmailJS já configurado. Botão Teste envia só para o admin; botão principal envia para todos os participantes com email válido. Reusa `scoreEntry`, `resolveSlot` e `escapeHtml` já existentes.

### Updated
- **Resultados**: Match 73 (África do Sul 0–1 Canadá) e Match 74 (Brasil 2–1 Japão) atualizados em `data.js` e Supabase.

---

## v4.13 — 2026-06-28

### Fixed (arquitetural)
- **Resultados somente do banco de dados**: `mergeStates` e `saveRemoteState` agora usam exclusivamente `remote.results` — o localStorage nunca mais contribui com resultados. Se o Supabase não tem um resultado, o app mostra zero. Elimina o bug onde outro dispositivo com localStorage antigo/de-teste populava resultados incorretos no ranking.

---

## v4.12 — 2026-06-28

### Fixed
- **Resultados incorretos (M73/M74/M78)**: Removidos diretamente do Supabase — provavelmente vieram do localStorage de teste de outro dispositivo sincronizado via ESPN sync antes dos jogos começarem.
- **Painel de resultados manuais desativado**: `renderAdminResults()` agora renderiza nada. Resultados só via botão ⚽ ESPN (automático). Para reativar em emergência: trocar `renderAdminResults(s)` por `renderAdminResultsManual(s)` em `renderAdmin()`.

---

## v4.11 — 2026-06-28

### Added
- **Botão ☁️ Sync remoto**: força descarte do localStorage e recarrega do Supabase — corrige dispositivos com entradas de teste persistindo no localStorage depois de tombstones propagados.

### Fixed
- **Proteção de entradas de hoje**: `deleteEntry` agora permite deletar entradas com `diagnostics.demo = true` mesmo sendo de hoje. Entradas reais de hoje continuam protegidas.

---

## v4.10 — 2026-06-28

### Fixed
- **Entradas de participantes não aparecendo**: `loadRemoteState` ignorava entradas do Supabase quando o timestamp local era mais recente (ex: admin tinha salvo algo após o participante). Correção: merge sempre acontece em `loadRemoteState` — entradas são sempre união (com tombstones), nunca descartadas por timestamp.
- **Valor do pot restaurado**: `#potValue` recolocado no cabeçalho do Ranking. Mostra `$N` baseado no número de entradas marcadas como pagas × `CONFIG.entryFee`.
- **Ícones SVG de pagamento**: CashApp, Zelle e Venmo agora usam os arquivos SVG de `assets/` em vez de emoji em todos os cards de pagamento.
- **Ícones admin faltantes**: botões `adminDemoData` (🎭), `adminRefreshFootball` (⚽) e `apiFootballRefreshResults` (🔄) receberam emojis alinhados com o restante da toolbar.

---

## v4.9 — 2026-06-28

### Fixed
- **Deletadas voltando do Supabase**: `mergeStates` era uma união aditiva — nunca removia entradas, só adicionava. Se o Supabase ainda tinha uma entrada deletada, qualquer sync posterior (focus/visibilitychange) trazia ela de volta. Correção: tombstones (`deletedIds[]` no estado). IDs deletados são propagados no merge e filtram entradas tanto no local quanto no remoto. `deleteEntry` agora também salva imediatamente (`forceResults: true`) em vez de usar debounce 400ms, eliminando a janela de corrida.

---

## v4.8 — 2026-06-28

### Fixed
- **Payment marking redesigned**: replaced checkbox + `change` event with a toggle button + `click` event. iOS Safari has a known inconsistency where `change` events on checkboxes inside `<label>` elements can be swallowed in scrollable containers; `click` on a `<button>` is universally reliable.
- **Admin saves no longer debounced**: `saveState` with `forceResults: true` (all admin operations: payment, result entry, ESPN sync, clear) now fires `saveRemoteState` immediately instead of after 400ms. Eliminates the window where backgrounding the app on mobile could cancel the queued `setTimeout` before Supabase received the write.
- **Toggle UX**: payment button shows "Marcar pago" (secondary style) when unpaid, "✓ Pago" (green) when paid. Clicking again toggles back — admin can correct mistakes.

---

## v4.7 — 2026-06-28

### Fixed
- **Payment checkbox race condition**: the v4.6 `!opts.forceResults` branch only preserved remote `results` but not remote `paid`. A participant submitting an entry after admin marked a payment could silently overwrite `paid: {}` in Supabase, erasing the mark. Fix: now also merges remote `paid` using any-true-wins in the same branch.
- **Payment checkbox UX**: if the admin session expired (30-min timeout) when clicking a payment checkbox, `guardAdmin()` opened the login modal but the checkbox stayed visually checked (a lie — nothing was saved). Fix: checkbox now reverts to its prior state if `guardAdmin()` fails, so admin sees the action was blocked.
- **Payment save hardened**: payment checkbox saves now pass `{ forceResults: true }` to `saveState`, so the save goes through the direct upsert path (no accidental result merge clobbering the admin's fresh paid update).

---

## v4.6 — 2026-06-28

### Fixed (architecture)
- **`saveRemoteState` race condition**: non-admin saves (participant entry submissions) could overwrite admin real results in Supabase when `localAt > remoteAt` caused the merge to be skipped. Fix: when `opts.forceResults` is not set (all non-admin saves), remote results are always merged back into the state before upserting — admin results can never be lost by a participant save.
- **`saveState` / `saveRemoteState`**: added `opts = {}` parameter. Admin operations (`commitRealResult`, `runEspnUpdate`, `applyApiResultsToState`, `clearAllData`) now pass `{ forceResults: true }` to bypass the remote-results-merge, allowing admin to explicitly set or clear results.

### Verified (no bug)
- Cross-checked all writes to `state().results`: only 4 sites, all behind `guardAdmin()` / `isAdminActive()`. Participant `saveEntry` has no write path to `state().results`.

---

## v4.5 — 2026-06-28

### Data
- `data.js`: GS-63 to GS-72 (June 26–27 group stage matches) updated with final scores.
- `data.js`: All Round of 32 team placeholders resolved with actual qualified teams (Paraguay, Norway, France, Sweden, Ecuador, England, DR Congo, Belgium, Senegal, Spain, Austria, Portugal, Croatia, Algeria, Egypt, Cape Verde, Colombia, Ghana).

---

## v4.4 — 2026-06-28

### Added
- **ESPN free results sync** (botão "⚽ ESPN" no admin toolbar): busca todos os jogos encerrados da Copa 2026 via `site.api.espn.com` — sem API key, sem limite de requisições.
  - Cobre **grupo + mata-mata**: resultados de grupos são armazenados em `state().results` e aparecem imediatamente no tab Jogos; mata-mata atualiza o ranking.
  - Não sobrescreve resultados já inseridos manualmente pelo admin.
  - Empates no mata-mata são ignorados automaticamente — admin escolhe o avançado no painel de resultados.
  - Conversão UTC→ET para evitar mismatch de data em jogos noturnos.
- CSP `connect-src` atualizado para incluir `https://site.api.espn.com`.

### Fixed
- `renderGames()`: status badge agora usa `r?.goalsA !== undefined` (antes `r?.advanceSide`) — jogos de grupo sem `advanceSide` agora marcam "Final" corretamente.

---

## v4.3.1 — 2026-06-27

### Fixed
- `renderGames()`: Jogos tab now overlays `state().results` scores on knockout matches — admin-entered results are immediately visible to all participants without refreshing.
- `commitRealResult()`: calls `renderGames()` after saving so the Jogos tab updates instantly when admin enters a knockout score.
- Admin payments checkbox: now calls `renderAdminPayments(state())` after save so the admin panel explicitly re-renders from the saved state, preventing a visual race with the Supabase debounce reload.

---

## v4.3-patch — 2026-06-27

Optional API-Football live results polling added to admin panel.

### Added
- `fetchApiFootballFixtures()`: fetches + caches fixtures from API-Football (10s AbortController timeout).
- `mapApiFootballToMatches()`: matches API fixtures to bracket match IDs by team name normalization + date. Skips unresolved placeholder slots ("Winner Match X", "1st Group H", etc.).
- `applyApiResultsToState()`: applies matched finished results to local+remote state. Never overwrites manual admin results. Skips draws (admin must choose winner).
- `startResultsPolling()` / `stopResultsPolling()`: 5-minute polling interval. Only runs while admin is active.
- `updateApiStatusBar()`: shows last update time, source, and auto-update status in admin panel.
- Admin button: "Atualizar resultados agora" (`#apiFetchResults`) — manual trigger.
- Status bar (`#apiStatusBar`) below admin toolbar: source · last update · auto on/off.
- `visibilitychange` handler: stops polling when tab hidden, resumes when visible + admin active.
- `window.focus` handler: resumes polling when admin active.
- Polling auto-starts on login and on session restore (page reload while admin active).
- 5 new i18n keys per language: `apiFootballRefreshResults`, `apiFootballLastUpdate`, `apiFootballSource`, `apiFootballAutoOn`, `apiFootballAutoOff` (pt-BR, es, en-US).

### Not changed
- Scoring, ranking, receipt, email, Supabase adapter, layout — untouched.
- `apiFootball.enabled=false` or empty `apiKey` → polling never starts, button does nothing.

---

## v4.2-patch — 2026-06-27

Surgical patch on v4.1-patch. Data updates and receipt improvements.

### Fixed / Updated
- `data.js`: All 32 knockout match venues now filled in (was "A confirmar"). Times added in EDT format for matches 74–104.
- `data.js`: Fixed M74 (Brazil vs Japan) kickoff time: 12:00 → 13:00 EDT.
- Sources: NBC Sports schedule + Wikipedia Copa 2026 knockout bracket.

### Added
- Receipt HTML: scoring legend section showing all point values.
- Receipt HTML: manual point verification table (fill-in area for double-checking scores).
- i18n: 12 new keys (`receiptLegendTitle`, `receiptLegendExact`, `receiptLegendAdvance`, `receiptLegendOneTeam`, `receiptLegendChampion`, `receiptLegendRunnerUp`, `receiptLegendThird`, `receiptLegendFourth`, `receiptCheckTitle`, `receiptCheckBy`, `receiptCheckDate`, `receiptCheckTotal`) added to all 3 languages (pt-BR, es, en-US).

### Confirmed (no change needed)
- Supabase already `enabled: true` in `config.js` with correct credentials.

---

## v4.1-patch — 2026-06-27

Surgical patch on v4.0-clean. No architecture changes.

### Fixed
- `mergeStates()`: `paid` now uses "any true wins" (payment confirmed on one device is never overwritten by another). `results` now uses remote-wins (admin is sole source of truth).
- `adminLogin()`: wrapped `sha256Hex()` in try/catch; alerts `adminLoginError` if `crypto.subtle` is unavailable (e.g. HTTP).
- `updateDynamic()`: `saveDraft()` now runs debounced at 400 ms instead of on every keystroke.
- CSP: removed unused `https://api.ipify.org` from `connect-src`.
- Supabase CDN: pinned to `@2.45.4`, added `integrity` (SRI) and `crossorigin="anonymous"`.
- Deleted `js/i18n-repair.js` (not loaded anywhere; legacy artifact).

### Added (optional improvements)
- Duplicate entry name check in `saveEntry()` — prompts confirmation before saving.
- `demo-badge` visual label on demo entries in ranking.
- CSS `:focus-visible` outline on buttons/inputs/selects for keyboard accessibility.
- `<link rel="canonical">` in `index.html`.
- i18n keys: `adminLoginError`, `duplicateEntryConfirm` (pt-BR, es, en-US).

---

## v4.0-clean — 2026-06-27

Full clean rebuild from scratch. No code carried over from v3.x.

### What changed
- Single IIFE `app.js` — no globals, no module bundler required.
- `config.js`, `data.js`, `i18n.js` are plain `window.*` assignments.
- Admin auth: SHA-256 via `crypto.subtle`, per-action `guardAdmin()`, 30-min session, lockout after N attempts.
- Bracket: slot resolution propagates across rounds; auto-advance when score is non-tie.
- Draft: `sessionStorage` with restore offer; key `bolao_draft_v4`.
- Scoring: called once per entry in `renderRanking`; bonus computed from `finalPodiumForEntry`.
- Supabase: merge-before-save (fetch remote `updated_at` first); local-first.
- i18n: 3 languages (PT-BR / ES-MX / EN-US), button toggle, no dropdown.
- Receipt: Blob URL — no `document.write`.
- EmailJS: `limitRate:{throttle:30000}`, HTML only via `html_message` field.
- CSV: `\r\n` line endings for Excel.
- CSP meta tag with all required directives.
- `escapeHtml` applied on every user-data DOM insertion.
- WhatsApp group button and QR in payment section.

### Removed from v3.x
- `i18n-repair.js` — no longer needed.
- PayPal payment method.
- All legacy patch files (`FIX_LOG_*`, `RELEASE_LOCK.md`).

---

## v3.3.4-stable-repair

- Removed visible language dropdown.
- Added timer seconds.
- Removed A/B score labels.
- Repaired rules i18n.
- Added Supabase focus/visibility reload and remote clear.

## v3.3.1-db-ui-fixes

- Desktop/mobile header fix.
- Language selector changed to flag buttons.
- Games view redesigned.
- Rules scoring table restored.
- Admin demo data restored.
- Optional API-Football refresh added as cached data only.

## v3.3-db-ready

- Optional Supabase remote state adapter.
- Local-first remote mirror.
- Phase labels polished.
- Supabase setup docs added.

## v3.2.1-rc1

- Final release-lock patch.
- Corrected UK nation flag emojis.
- Removed initial `Time A` / `Time B` dropdown flash.
- Softer score >20 guard while typing.
- Receipt HTML labels now use i18n.

## v3.0

- Clean rebuild from the unstable v2 branch.
- CSV backups, receipts, admin, ranking, i18n, EmailJS and validation stabilized.
