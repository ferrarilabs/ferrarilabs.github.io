# Bolão Brasileirão 2026 — CHANGELOG

## v1.61 — 2026-07-17

### Changed — "Jogos de hoje": contador em texto trocado pelo widget de dígitos da Copa

Eduardo: "A contagem regressiva tem que ser igual copa meu!" O ajuste anterior (v1.59/v1.60)
corrigiu cor e alinhamento, mas a contagem em si continuava um resumo em texto ("· em 10h 05m"),
não o mesmo componente visual da Copa. Trocado por `countdownTimerHtml()` — o MESMO widget de
caixas grandes em dígitos (H/MIN/S, ou D/H/MIN/S com mais de 1 dia) já usado no card "Próximo
jogo" de 1 partida só, reaproveitado aqui por partida dentro da lista de múltiplos jogos do dia.
Mesmo comportamento responsivo da Copa no mobile (empilha em vez de ficar lado a lado). Mesmo
ajuste no CDB2026.

## v1.60 — 2026-07-17

### Fixed — "Jogos de hoje"/"Próximo jogo": rótulo cinza (devia ser verde) + centralização revertida

Eduardo mandou screenshot da Copa (card "PRÓXIMO JOGO"): "olha como esta a copa faca igual em
todos. Isso não deveria nem ser questionado." Dois achados reais comparando com o CSS de
verdade da Copa (`bolao/css/styles.css`):

1. **Rótulo cinza, devia ser verde** — `.hero-next-label` da Copa é `color: var(--green)`;
   `.next-game-label`/`.today-games-header` aqui usavam `var(--muted)` (cinza). Corrigido.
2. **Centralização da v1.59 revertida** — a lista "Jogos de hoje" tinha sido centralizada ontem
   em cima de um pedido verbal vago ("tudo para a esquerda"), sem checar o padrão real da Copa.
   O card de referência (`.next-match-info`/`.hero-next-*`) é alinhado à esquerda, com o
   contador de dígitos preenchendo o lado direito — não centralizado. Revertido pra alinhado à
   esquerda, igual à Copa.

Mesmos dois ajustes no CDB2026.

## v1.59 — 2026-07-17

### Fixed — "Jogos de hoje" sem contagem regressiva, alinhado à esquerda

Eduardo, screenshot com dados reais de produção (3 jogos hoje): "contador era dos proximos
jogos... o alinhamento é esse tudo para a esquerda." Investigado com o calendário real da ESPN —
confirmado que não era bug de dados, era design: a lista compacta "Jogos de hoje" (usada quando
há mais de um jogo no dia) só mostrava contagem regressiva na última hora antes do jogo ("· 12m
34s"), nada antes disso — num dia com jogos às 19h/20h, a manhã inteira ficava sem nenhuma pista
de quanto faltava. Agora sempre mostra alguma contagem quando o jogo é hoje e ainda não começou:
"· em 10h 13m" quando falta mais de 1h, "· 12m 34s" na última hora (sem trocar formato o tempo
todo — direto ao segundo só quando já importa). Também centralizado (cabeçalho, times, horário),
mesmo padrão do card "ao vivo" (v1.55) — antes tudo ficava alinhado à esquerda. Mesmo ajuste no
CDB2026.

## v1.58 — 2026-07-17

### Fixed — vão em branco no final da página no iOS (hipótese: reflow de rolagem do WebKit)

Eduardo, screenshot: "Ainda tem bastante areas em branco ao final da pagina, isso tinha sido
corrigido." Investigação a fundo: peguei o estado real do Supabase (11 entradas) e reproduzi
localmente — o rodapé fica exatamente coincidindo com o fim da página, sem sobra nenhuma, em
todas as abas, no Chromium. Comparado byte a byte com produção: idêntico. Sem conseguir
reproduzir num navegador WebKit real (não disponível neste ambiente), a hipótese de trabalho é
um bug conhecido do Safari no iOS: vários cards (ao vivo, ranking ao vivo, próximo jogo, contagem
regressiva) agora aparecem/somem dinamicamente a cada poll de 60s — quando o conteúdo ENCOLHE
enquanto a página está rolada perto do final, o WebKit às vezes não recalcula a área rolável até
uma interação nova, deixando um vão vazio "fantasma". `nudgeScrollReflow()` (um `scrollBy(0, 0)`
imperceptível) roda depois de cada ciclo de renderização (`pollAll()` e `renderAll()`) — correção
padrão documentada pra esse bug específico, sem custo/efeito quando a página não está rolada.
Mesmo ajuste no CDB2026 e na Copa (mesmo mecanismo de cards dinâmicos nos três).

## v1.57 — 2026-07-17

### Fixed — caixa de foco feia ao redor do título "Projeção do Bolão"

Eduardo, screenshot: uma caixa azul aparecia em volta de "Projeção do Bolão" depois de trocar de
aba pro Ranking. É o anel de foco padrão do navegador em cima do `<h2>` que `showSection()`
foca de propósito a cada troca de aba (pra leitor de tela saber que a página mudou) — nunca
alcançado por navegação real via Tab, então esconder o anel visual não perde acessibilidade de
verdade. Mesmo padrão corrigido na Copa e no CDB2026 (ver changelogs deles).

### Fixed — caixa da contagem regressiva ficava vazia e visível depois do prazo encerrar

Eduardo, screenshot: a caixa "Encerrado" no topo continuava ocupando o mesmo espaço grande da
contagem regressiva mesmo depois do prazo — "Pode esconder isso". Mesmo padrão que a Copa sempre
teve (`updateCountdown()`, esconde a caixa inteira quando `diff <= 0`) — o BR2026 tinha divergido
mostrando "Encerrado" solto dentro da caixa em vez de escondê-la. Corrigido pra esconder a caixa
inteira, igual à Copa. Mesmo ajuste no CDB2026 (por fase ativa, não pelo fim do torneio inteiro).

### Fixed — pontos do Ranking quebrando em duas linhas ("170" / "pts")

Eduardo: "Deixe tudo da entrada em uma linha e sem crlf." A coluna de pontos no mobile tem
largura FIXA de 40px (pra o botão "Ver palpites" nunca deslocar conforme o placar tem 1-3
dígitos) — dimensionada só pros dígitos, exatamente como a Copa. O sufixo " pts" (que a Copa
nunca mostrou aqui) não cabia nessa largura e quebrava linha. Removido, mesmo padrão da Copa
(número puro, sem rótulo).

### Fixed — contador regressivo do "Próximo jogo" tinha sumido

Eduardo: "A contagem regressiva dos próximos jogos sumiu." Regressão da v1.56: ao agrupar por
dia pra mostrar múltiplos jogos no mesmo dia seguinte (pedido anterior do Eduardo), o branch que
tratava "só 1 jogo no próximo dia" foi substituído pelo item compacto de "jogos de hoje" (sem o
contador em dígitos grandes) em vez de manter o layout rico original. Restaurado: quando há
exatamente 1 jogo no próximo dia com jogo, volta o card rico com contador em dígitos + local;
quando há mais de 1, continua a lista compacta (pedido original preservado).

## v1.56 — 2026-07-16

### Fixed — relógio ao vivo mudava de formato quando pausava (achado em screenshot: "51'" vs "52:24")

Eduardo mandou um screenshot: "Um cronometro mostra só minutos e outro mostra minutos e
segundos. Fere inconsistência!" `liveClockDisplay()` preferia `m.clockStr` (string crua da ESPN,
só minuto, ex. "51'") quando `clockPaused` era verdadeiro, e só usava o formato calculado
"MM:SS" (`formatMatchClock()`) quando o relógio estava rodando — dois formatos diferentes pro
MESMO elemento dependendo de um estado interno que o usuário nem vê. Corrigido pra sempre passar
por `formatMatchClock()` quando `clockSeconds` existe; pausado só significa não somar o tempo
decorrido desde o último poll, nunca trocar de formato — mesmo princípio que a Copa sempre teve
(ela nunca tinha essa bifurcação; só esta cópia introduziu o bug). Mesmo bug/fix propagado ao
CDB2026 (código idêntico, mesma origem).

### Fixed — "Ranking ao vivo" com espaçamento enorme dos dois lados no desktop

Eduardo: "ranking ao vivo ainda tem muito espacamento para a direita e esquerda... isso no
desktop, no mobile esta ok." A tabela tinha `max-width: 420px` fixo — no mobile isso já batia em
100% da largura do card, por isso só aparecia no desktop. Subiu pra 760px e aumentou fonte/
padding das células pra preencher melhor o espaço em vez de sobrar vazio.

### Changed — pontos do Ranking sempre verdes, sem seta duplicada de "provisório"

Eduardo: "no ranking mostra a pontuacao em amarelo e com uma seta para cima e baixo, deveria ser
igual copa e copa do brasil." A pontuação provisória (antes de resultados travados) ficava
amarela e trocava "pts" por "↕" — nem a Copa nem o CDB2026 faziam isso, sempre verde com "pts"
fixo, confiando só no aviso "↕ projeção provisória" já mostrado no topo da lista. Removido pra
igualar aos outros dois apps; a seta de movimento de posição (▲/▼) continua, essa foi pedida
explicitamente e é intencional.

### Changed — número de posição sem ponto sobrando ("4." → "4")

Eduardo: "e tira o '.' se a posicao nao muda no ranking, parece sujeira." Mesmo ajuste
propagado à Copa e ao CDB2026 no mesmo patch (mesmo trecho de código nos três).

### Added — "Próximos jogos" mostra todos os jogos do dia seguinte, não só o primeiro

Eduardo: "proximo jogo mostra somente um, mas amanha tem mais, mostre proximos jogos quando ha
mais de um no mesmo dia." Quando não há jogo hoje, o card antes mostrava só o jogo cronologicamente
mais próximo (`nextUpcomingGame()`, que continua existindo — ainda é a fonte do congelamento do
cutoff, precisa continuar sendo um único jogo fixo). A exibição agora agrupa por dia: todos os
jogos que caem no mesmo dia BRT do próximo jogo aparecem juntos, com um subtítulo de data.

### Fixed — CDB2026 trazido pro mesmo padrão do card "ao vivo" (dedupe, plays feed, ranking ao vivo)

Ver `bolao/cdb2026/CHANGELOG.md` v3.40 pro detalhe completo — Eduardo: "aplicou as mesmas
alteracoes na CDB2026? PRECISAMOS SER CONSISTENTES!" Registrado aqui porque a origem do pedido
foi uma comparação direta com este app.

## v1.55 — 2026-07-16

### Changed — card "ao vivo" refeito do zero copiando a estrutura real da Copa (não só ajustando espaçamento)

Eduardo, olhando o v1.54 já publicado: "ficou horrivel isso! faca igual da copa do mundo tche,
voce sabe mais que isso." As duas rodadas anteriores (v1.53/v1.54) só ajustaram espaçamento em
cima de uma pilha vertical inventada (badge, depois times, depois posições, depois relógio, cada
bloco numa linha própria com bastante vão entre eles) — nunca correspondia à estrutura real do
`hero-live-card` da Copa, que é uma ÚNICA linha horizontal (escudo+nome+posição de um time |
placar | badge+relógio centralizados | placar | escudo+nome+posição do outro time). Refeito do
zero copiando essa estrutura + os tokens de tamanho/espaçamento da Copa quase literalmente
(`bolao/css/styles.css` `.hero-live-top/.hero-live-team/.hero-live-score/.hero-live-center` →
`.live-top/.live-team/.live-score/.live-center` aqui). Com múltiplos jogos ao vivo, agora são
cards lado a lado (`.live-match-grid`, mesmo `flex-wrap` do `.next-match-live-grid` da Copa), não
mais empilhados numa única caixa com divisórias tracejadas. O placar fica genuinamente no centro
visual do card agora (Eduardo: "e ainda nao esta centralizado o placar" — resolvido por
construção, não por CSS de centralização em cima da estrutura errada).

### Fixed — hero "Ranking ao vivo" só mostrava quem estava se movendo, cortando o topo da lista

Eduardo: "e no ranking so aparece da 4 posicao para baixo, tem que aparecer todos, pode scrolar
mas deixa pelo menos 4-5 no topo." O filtro "só quem está subindo/descendo" (v1.54) fazia sentido
pra reduzir ruído, mas na prática escondia entradas paradas no topo, dando a impressão de que a
lista começava do meio. Agora mostra todo mundo, ordenado por posição, dentro de uma caixa com
scroll (~4-5 linhas visíveis sem rolar, cabeçalho fixo no topo do scroll) — só a condição de
"esconder o card inteiro sem ninguém se movendo" continua igual.

## v1.54 — 2026-07-16

### Fixed — Ranking (setas de movimento) só reagia ao placar DEPOIS que a ESPN fechava o jogo

Eduardo, na rodada seguinte de feedback: "nao ta mostrando estilo copa conforme os jogos estao
ocorrendo qual a posicao no ranking as pessoas estao subindo ou descendo de acordo com as
projecoes live." Achado real ao investigar: `renderRanking()` calculava a posição/pontuação
"atual" de cada participante direto de `_standings` — a tabela OFICIAL da ESPN, que só é
reprocessada depois que a ESPN marca a partida como encerrada — nunca da tabela AJUSTADA pelo
placar ao vivo (`liveStandingsNow()`, já existente e usada no card "ao vivo" desde a v1.53).
Resultado: as setas do Ranking ficavam presas na posição de ANTES do jogo começar durante toda
a partida, só se moviam depois do apito final + ESPN republicar — tarde demais pra ser uma
"projeção ao vivo" de verdade. Nova função `currentResultSet()` centraliza essa escolha (usa a
tabela ao vivo quando há jogo em andamento, cai pra `_standings` fora de janela ao vivo) —
única fonte usada tanto por `renderRanking()` quanto pelo novo hero abaixo. Verificado
injetando duas entradas de teste com um placar ao vivo real que cruza a fronteira do G4: a que
acertou o time que assumiu a vaga sobe, a outra desce, exatamente como esperado.

### Added — hero "Ranking ao vivo" logo abaixo do card de jogos, mesmo estilo da Copa

Eduardo: "isso poderia vir num hero logo abaixo dos jogos ao vivo no mesmo estilo da copa, o
que achas?" Novo card `#liveRankingHero`, mesmo estilo visual do card "ao vivo" (`hero-live-
points` da Copa como referência), listando só quem está subindo ou descendo agora (até 8,
ordenado por posição) — reaproveita 100% do cálculo já existente
(`calculateRankingMovement()`), nenhuma fórmula nova. Fica escondido sem jogo ao vivo, sem
baseline confiável, ou sem ninguém se movendo (Eduardo: "se ficar ruim ou muito busy deixa de
fora") — nunca mostra uma tabela parada.

### Fixed — card "ao vivo" ainda parecia fora de centro (feed de lances/barras muito largos)

Eduardo: "esta ainda fora de centro." O card em si já estava centralizado (v1.53), mas o feed
de lances e as barras de probabilidade dentro do detalhe expansível esticavam pra largura
inteira do card (sem limite), enquanto o cabeçalho acima (times/placar/posição) ficava
compacto e centralizado — o contraste entre uma faixa estreita centralizada e uma caixa larga
colada nas bordas é o que lia como "fora de centro". `.live-match-detail` agora tem
`max-width: min(520px, 100%)` centralizado, alinhando visualmente com o cabeçalho acima.

## v1.53 — 2026-07-16

### Added — `send_round_email.py --test-send`, envia uma prévia real só pra Eduardo revisar

Eduardo: "Once you are done send a test email to me only so I can proofread." Novo modo, sem
tocar Supabase: roda o mesmo gate de auto-teste do `--auto` (`audit_scoring.py` +
`_self_check_rank_entries()`, recusa enviar se falhar), busca os jogos completos mais recentes
de verdade (com lookback alargado pra 14/60/200 dias, já que o Brasileirão pausou pra Copa do
Mundo e só retomou em 16/07 — os últimos jogos concluídos de verdade são de antes da pausa),
monta o email real personalizado pra entrada do Eduardo (`participantEmail == emferrari@gmail.com`)
com faixa amarela "⚠️ TESTE" no topo, e envia só pra ele. Testado com sucesso contra dados reais.

### Fixed — jogo ao vivo aparecia duas vezes ("🔴 N jogos ao vivo agora" + "Jogos de hoje")

Eduardo: "nos jogos de hoje, se ja esta mostrando ao vivo, nao precisa mostrar duas vezes."
`renderNextGameCard()` listava TODOS os jogos do dia sem excluir os que já apareciam no card
"ao vivo" (`renderLiveCard()`), duplicando a mesma partida — mesmo placar, mesmo relógio
(`liveClockDisplay()`), renderizados duas vezes na página. `todayGames` agora filtra qualquer
jogo cuja chave `homeTeam|awayTeam` já esteja em `_liveMatches`; jogos "pre" (ainda não
começaram) e "post" (já terminaram) continuam aparecendo normalmente em "Jogos de hoje".

### Added — minuto a minuto de gols/cartões/substituições no card "ao vivo"

Eduardo: "voce pode tambem adicionar o minuto a minuto de cartoes, gols, substituicoes como
tem na copa tambem?" Portado da Copa (`extractMatchPlays`/`livePlaysHtml` em `bolao/js/app.js`,
ver PLATFORM_ARCHITECTURE.md "Golden master"): mesma fonte de dados já buscada a cada poll
(`comp.details` do endpoint scoreboard da ESPN), sem chamada de rede extra. Aparece dentro do
detalhe expansível de cada partida ao vivo, junto com as barras de probabilidade já existentes.
Mesmo contrato "falha silenciosa" da Copa — um formato inesperado da ESPN degrada pra lista
vazia, nunca quebra o placar/relógio ao vivo.

### Added — posição atual + seta de movimento por time no card "ao vivo"

Eduardo: "precisamos mostrar a posicao atual de cada time com uma seta pra cima ou baixo
conforme o resultado de acordo com a posicao antes do jogo." Esse cálculo já existia
(`calculateLiveStandings()`/`standingsMovementHtml()`, shipped em v1.4x pra tabela de
Classificação) — só não estava exposto no card "ao vivo" em si, onde o Eduardo estava olhando.
Reaproveita a mesma função e a mesma baseline (`_standingsBaseline`, congelada quando o
primeiro jogo ao vivo do dia é detectado); mostra "–" em vez de posição/seta quando ainda não
há uma baseline confiável (ex.: página recém-aberta no meio de uma partida).

### Changed — card "ao vivo" centralizado (era alinhado à esquerda)

Eduardo: "seria ideal centralizar tambem e nao deixar tudo na esquerda." `.live-match-row`
mudou de linha única (flex-wrap, alinhado à esquerda) pra coluna centralizada — badge, times,
posições e relógio empilhados e centrados, mesmo em telas largas. O chevron de
expandir/recolher virou posicionado (`position:absolute`) no canto superior direito da linha
em vez de empurrado pra lá via `margin-left:auto`, que só funcionava alinhado à esquerda.

### Fixed — barra de probabilidade do card "ao vivo" sem o limiar de 12% pra nome do time

Achado durante o teste do item acima: as barras de probabilidade dentro do card "ao vivo"
(`renderLiveCard()`) eram a ÚNICA das 4 chamadas de barra de probabilidade deste arquivo sem a
proteção "esconde o nome do time se a fatia for menor que 12%" — as outras 3
(`renderGamesSection`, `renderNextGameCard`, `renderRanking`) já tinham. Resultado visível:
"Palmeiras 12%" estourando a largura da própria fatia. Agora usa o mesmo limiar das outras 3
chamadas (e da Copa, `probBarsMarkup()`). Não existia em CDB2026 (função de barra própria, já
com o limiar certo) nem na Copa (função compartilhada única) — bug isolado ao BR2026.

## v1.52 — 2026-07-16

### Fixed — nomes renomeados pelo admin "não apareciam" (merge de entradas sempre preferia o cache local)

Eduardo: "Você atualizou o banco com os nomes? Não aparece ainda." Confirmado por leitura
direta do Supabase: os nomes ("Gustavo Ferrari", "Matheus The Client") estavam corretos no
banco desde a rodada anterior — o problema era `mergeStates()`: `entries` usava "local sempre
vence" (`byId[e.id] = e` sobrescrevendo remoto por local incondicionalmente), o mesmo padrão já
corrigido pro `cutoffAt` mais cedo hoje, só que nunca propagado pra `entries`. Qualquer
navegador que já tivesse essas duas entradas em cache local (de antes da renomeação) ia manter
o nome antigo pra sempre, mesmo depois do Supabase já estar certo. A Copa já tinha a correção
certa (`bolao/js/app.js`): preferir sempre o registro mais RECENTE por entrada
(`updatedAt`/`createdAt`), não um lado fixo — portada aqui e pro CDB2026 (mesma estrutura de
merge). Os dois registros já renomeados também tiveram `updatedAt` atualizado direto no
Supabase pra vencer qualquer cache local já existente assim que essa versão for publicada.

### Fixed — Probabilidades mostrando times com % impossível (Remo 0% de rebaixamento em 18º lugar)

Eduardo: "A tabela de probabilidades está bem fora. Mostra Remo por exemplo como 0% de chances
de rebaixamento!" Investigado com dados reais da ESPN (não simulado) — dois bugs reais
confirmados:

1. **Nome de time divergente entre os dois endpoints da ESPN**: o endpoint de classificação
   devolve "Athletico Paranaense", o de calendário/jogos devolve "Athletico-PR" — o mesmo time,
   dois nomes. `buildRatings()`/`runMonteCarlo()` cruzam dado dos dois endpoints assumindo que
   o nome bate; com a divergência, os pontos das partidas restantes do Athletico eram somados
   sob a chave "Athletico-PR" enquanto o total inicial (30 pts, 4º lugar) ficava congelado sob
   "Athletico Paranaense" — o time nunca ganhava pontos na simulação, aparecendo como
   quase-certo de ser rebaixado (99%) apesar de ser o 4º colocado de verdade. Corrigido com um
   mapa de alias (`ESPN_SCOREBOARD_NAME_ALIASES`, mesmo padrão do `ESPN_ALIASES` do
   `send_result_email.py` da Copa), normalizando o nome do calendário pro nome da classificação/
   `DATA.teams` antes de qualquer cruzamento.
2. **Ajuste iterativo (Dixon-Coles) divergindo pra alguns times**: Remo tinha rating de ataque
   calculado em 5.93 (quase 6x a força de um time médio), sem nada nos resultados reais dele
   (~1,17 gols/jogo, nada excepcional) que justificasse isso — dava gol esperado de ~10 por
   partida, zerando a chance de rebaixamento em todas as 2000 simulações. Confirmado que não é
   ruído: reduzir iterações ou adicionar amortecimento não resolve, o ajuste converge pro mesmo
   teto/piso de qualquer forma (loop de realimentação estrutural entre pares de times, não falta
   de convergência). Adicionado um limite [0,25, 3] pro ajuste (impede valores fisicamente
   impossíveis) e um encolhimento de 70% em direção à média ingênua (gols/jogo) no resultado
   final — neutraliza a divergência sem descartar o modelo: times realmente fortes/fracos
   continuam se destacando (Palmeiras/Flamengo com G4 alto, Chapecoense/Vasco com Z4 alto), só
   os casos que davam valor implausível deixam de zerar uma zona inteira.

Verificado rodando o código REAL extraído do app.js (não uma reimplementação) contra dados ao
vivo da ESPN: Remo agora mostra Z4≈9% (era 0%), Athletico Paranaense mostra G4≈68% (era 99%
Z4) — tabela inteira de 20 times conferida, gradiente coerente do topo ao rebaixamento.

Não propagado ao CDB2026: usa um cálculo de probabilidade diferente (Poisson bivariado direto
por confronto, sem o mesmo ajuste iterativo de força de time ao longo da temporada) — essa
classe de bug não se aplica lá.

Não altera scoring nem lógica de pontuação — só o cálculo informativo de probabilidades.
`audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.51 — 2026-07-16

### Added — email automático de fim de rodada (em vez de por jogo)

Eduardo: "Para os emails apos jogos no br2026 vamos fazer emails apos cada rodada finalizar
para economizar no envio." BR2026 não tinha nenhum email automatizado por jogo antes disso
(só o comprovante de inscrição) — a Copa envia um email por partida via
`bolao/scripts/send_result_email.py`, mas isso só funciona lá porque a Copa tem ~32 partidas
no total. O Brasileirão tem ~380 jogos na temporada; replicar o mesmo padrão por jogo
significaria ~380 envios/temporada (× participantes). Construído direto em lote por rodada em
vez disso (~38 envios/temporada).

**Descoberta real que mudou o design**: a API da ESPN para o Brasileirão não expõe número de
rodada por jogo. Testado ao vivo (schedule completo de 2026 buscado da ESPN, 382 jogos): nem
agrupar por proximidade de data nem reconstruir rodadas pela estrutura de turno-returno
(cada time joga uma vez por rodada) produz um calendário limpo — jogos adiados/remarcados e a
compressão pós-Copa do Mundo geram "rodadas" de até 39 jogos quando forçado. Sem uma fonte
oficial rodada-a-rodada pra cadastrar à mão (diferente do CDB2026, onde Eduardo forneceu os
confrontos reais), Eduardo escolheu a alternativa: uma janela rolante de 7 dias. O "lote atual"
é formado pelo jogo mais antigo ainda não coberto por um lote anterior + tudo dentro de 7 dias
dessa data; quando todos os jogos do lote terminam, o email dispara e o lote fecha.

- `bolao/br2026/scripts/send_round_email.py` (novo): mesmo padrão de segurança do
  `send_result_email.py` da Copa — audit_scoring.py roda antes de qualquer coisa, confirmação
  de estabilidade (re-checagem da ESPN após 20s), checagem de sanidade (nenhum jogo do lote com
  data futura, times resolvidos), idempotente (lote só fecha depois de tentar todos os envios).
  Importa `score_entry()` direto de `audit_scoring.py` (fonte única, sem reimplementação
  duplicada) — só o desempate final (`rank_entries()`, ordem alfabética reversa do nome) é
  transcrito à mão aqui, e ganhou seu próprio self-check (`_self_check_rank_entries()`) porque
  o `check_tiebreak_order()` do audit_scoring.py compartilhado explicitamente não cobre esse
  último passo (ver docstring dele).
- Conteúdo do email (aprovado por Eduardo): resultados dos jogos da rodada + classificação
  G4/Sul-Americana/Z4 atual + seção pessoal "Seu desempenho" (pontos, posição, seta de
  movimento vs. a rodada anterior). Um email por participante (personalizado), mais um resumo
  pro admin.
- `.github/workflows/br2026_round_emails.yml` (novo): cron a cada 30min nos horários típicos de
  jogo (18h-1h EDT), ano todo — sem restrição de mês como o cron da Copa (que só roda
  junho/julho, janela da Copa do Mundo). Não faz nada se não houver jogos na janela; seguro
  rodar fora de temporada.
- Novo campo de estado `s.roundEmail` (Supabase): `pendingBatch`, `baseline` (G4/Z4/SA6 da
  última rodada enviada, pra calcular movimento), `sentGameIds`, `sentBatches` (histórico,
  cap 50). Cada envio também registra uma entrada no journal (`s.auditLog`, ação
  `round-email-sent`).

Testado: rodado ao vivo contra a ESPN e o Supabase de produção duas vezes (idempotência
confirmada — segunda chamada não reabre o lote), `rank_entries()`/HTML de email testados com
dados simulados. **Não testado**: o caminho real de envio de email em si, porque nenhum lote
chegou a "todos os jogos completos" ainda — só vai disparar de verdade quando a próxima janela
de 7 dias realmente terminar.

Não altera scoring nem lógica de negócio (reaproveita a fórmula existente). `audit_scoring.py`
(Copa/BR2026/CDB2026): 5/5.

## v1.50 — 2026-07-16

### Security — senha do admin atualizada

Ver nota completa em `bolao/CHANGELOG.md` v4.140 — mesma troca, propagada aos três apps
(já compartilhavam o mesmo hash).

### Data — duas entradas renomeadas em produção, a pedido do Eduardo

"Gustavo" → "Gustavo Ferrari", "Matheus" → "Matheus The Client" (ids `bebac118-…` e
`cafb8261-…`). Atualizado diretamente no Supabase (`bolao_state`, `id="br2026"`), registrado no
journal (`s.auditLog`, ação `rename-entry`, nome anterior/novo). `payerName`/`paymentMethod`
não foram tocados (continuam vazios, conforme já confirmado por Eduardo que está OK).

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.49 — 2026-07-16

### Fixed — badge "Pago"/"Pendente" vazando da própria caixa em telas estreitas

Eduardo: "the pago is outside the box. You should be very thorough about these knits." Ver nota
completa em `bolao/CHANGELOG.md` v4.139 (mesma correção, mesma causa raiz nos três apps).
`.rank-row` é reaproveitado por `renderRanking()` (4 itens) e `renderParticipants()` (só 3
itens) — o breakpoint mobile fixava a 3ª coluna em `40px` (dimensionado pro placar do ranking),
insuficiente pro badge "Pendente" (8 letras, mediu 79px reais de largura). Nova classe
`.rank-row.participant-row` com `grid-template-columns: 28px 1fr auto;` para a estrutura real
de 3 itens.

Confirmado com medição de DOM real (`scrollWidth`), não é correção especulativa: badge
"Pendente" agora mede 79px e cabe com 13px de folga (antes: forçado em 40px).

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.48 — 2026-07-16

### Fixed — entrada podia ser salva sem responsável pelo pagamento nem método de pagamento

Eduardo encontrou uma entrada real (Matheus) salva com "·" vazio no lugar de responsável e
método de pagamento na aba Participantes, e outra (Gustavo) sem responsável. "This can not
happen... doesn't look professional." `saveEntry()` validava `entryName` e `participantEmail`,
mas nunca `payerName` nem `paymentMethod` — a Copa (`bolao/js/app.js`) sempre validou os quatro
(`requiredPayerName`/`requiredPaymentMethod`), essa checagem nunca foi portada para o BR2026
durante a construção do app. Corrigido: `saveEntry()` agora bloqueia o salvamento (com o mesmo
alerta da Copa) se `payerName` ou `paymentMethod` estiverem vazios, tanto para entrada nova
quanto para edição.

Registros já salvos com o campo vazio (Matheus, Gustavo) não foram alterados — Eduardo
confirmou que está OK deixar como está; a correção é só para impedir que aconteça de novo.

Testado com Playwright: tentar salvar com nome+email mas sem responsável bloqueia com
"Digite o responsável pelo pagamento."; com responsável mas sem método bloqueia com "Selecione
o método de pagamento."

### Fixed — endurecido `overflow-x: hidden` para `overflow-x: clip` (side-scroll voltou)

Eduardo: "the issue with the side scroll is back." Ver nota completa em `bolao/CHANGELOG.md`
v4.138 (mesma correção, propagada aos três apps) — `overflow-x: hidden` sozinho não impede o
"rubber-band" horizontal do iOS Safari quando um ancestral usa `position: sticky` +
`backdrop-filter` (o `.topbar`); trocado para `overflow-x: clip` (com `hidden` como fallback).
Não foi possível reproduzir com Chromium no sandbox — correção especulativa e propagada por
prudência; acompanhar se o sintoma persistir.

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.47 — 2026-07-16

### Fixed — vão vazio grande no final de toda página (mobile e desktop)

Eduardo: "There's a lot of empty space (non urgent) at the very bottom of the page." Root cause:
`main` tinha `padding-bottom: 80px` (base e mobile), bem maior que o padrão da Copa (referência
visual canônica) — `20px` desktop / `12px` mobile, sem valor especial de bottom — apesar da Copa
ter a mesma estrutura de botão sticky (`.sticky-submit`) no final do formulário de palpites. Os
80px pareciam existir só pra dar folga ao botão sticky, mas essa folga já é resolvida pelo
`position: sticky` em si — o valor grande só sobrava como vão morto abaixo do conteúdo em TODA
aba (Ranking, Tabela, Participantes etc.), não só na de Palpites.

- `main { padding: 16px 14px 80px; }` → `padding: 16px 14px;` (desktop)
- `main { padding: 12px 10px 80px; }` → `padding: 12px 10px;` (mobile, `@media max-width: 900px`)

Confirmado com Playwright (scroll até o fim, screenshot): `scrollHeight` mobile caiu de 3125px
para 3057px (-68px, os 80px→12px esperados); botão sticky continua funcionando normalmente sem
sobrepor conteúdo, aba Ranking sem regressão.

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.46 — 2026-07-16

### Fixed — "Palpites" continuava clicável depois do prazo; propagado padrão da Copa

Eduardo: "once it cuts disable the palpites button like copa and default to ranking like copa."
O "default to ranking" já existia (`showSection(isPastCutoff() ? "ranking" : "entry")` desde a
introdução do cutoff automático); faltava a outra metade do padrão da Copa: desabilitar o botão
de navegação "Palpites" em si depois do prazo (`init()` da Copa faz
`navEntryBtn.disabled = isPastCutoff()`, nunca implementado aqui). Adicionado o mesmo trecho —
o botão fica desabilitado (estilo padrão do navegador para `disabled`, igual à Copa, sem CSS
extra) sempre que a página carrega depois do prazo.

Mesma limitação da Copa, não nova: computado uma vez no `init()`, não reativamente — se o prazo
vence com a aba já aberta, o botão só desabilita no próximo carregamento. Comportamento aceito
na Copa, replicado aqui sem alteração.

`audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.45 — 2026-07-16

### Fixed — extensão manual do prazo (+45min) e bug de propagação em `mergeStates()`

Eduardo pediu para estender o prazo em 45 minutos. O prazo (`s.cutoffAt`, congelado 1h antes do
primeiro jogo real, 18h30 -03:00) já tinha passado há ~2 minutos quando o pedido chegou — ação
imediata em produção:

- **Intervenção manual em produção**: `s.cutoffAt` atualizado diretamente no Supabase
  (`bolao_state`, `id="br2026"`) de `2026-07-16T21:30:00.000Z` para `2026-07-16T22:15:00.000Z`
  (18h30 → 19h15 -03:00), preservando as 9 entradas existentes. Registrado no novo journal
  (`s.auditLog`, ação `extend-cutoff`, com prazo anterior/novo) — mesmo mecanismo shipado nesta
  sessão (v1.44).
- **Bug real encontrado ao investigar a propagação**: `mergeStates()` sempre preferia o
  `cutoffAt` já em cache local (`local.cutoffAt || remote.cutoffAt`), por design, para impedir
  que um cliente atrasado resetasse o prazo. Isso também impedia uma extensão manual do admin de
  chegar a qualquer navegador que já tivesse carregado a página hoje (cutoffAt antigo ficaria
  preso no `localStorage` para sempre). Corrigido para sempre preferir o valor **mais tarde**
  entre local e remoto (nunca mais cedo, nunca `null`) — mantém a proteção original e ainda
  deixa uma extensão manual se propagar de verdade. Testado com 5 casos (local mais velho, local
  mais novo, remoto nulo, local nulo, ambos nulos).
- `C.cutoffIso` (fallback, `config.js`) também atualizado para 19h15 -03:00, para consistência —
  só afeta quem nunca carregou o app hoje (já congelado para quem já visitou).

Não altera scoring nem lógica de pontuação. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.44 — 2026-07-16

### Added — triple confirmation + journal de admin + backups automatizados para o resultado oficial

Eduardo pediu para remover os controles manuais de resultado do admin (automatizar tudo via
ESPN), depois reverteu antes de qualquer código ser tocado ("it doesn't hurt to have and don't
want to waste tokens on this") — nada foi removido. Em vez disso, pediu proteção contra mis-click
mobile e um jeito de reverter: "make sure there's triple confirmation if I click incorrectly it
can be rolled back easily... what I want to avoid is to fat finger something... we need to have a
way to journal this so it can be rolled back if needed... the same way copa has, this also needs
to have backups done." Ver nota completa em `docs/bolao/CONSISTENCY_MATRIX.md` (propagação do
padrão já existente na Copa).

- **Triple confirmation**: travar/destravar o resultado oficial (`saveResultsBtn`/
  `unlockResultsBtn`) agora exige dois `confirm()` + um `prompt()` digitando a palavra
  `CONFIRMAR` (`tripleConfirm()`) — o terceiro passo é o que resiste a toques acidentais em
  sequência, não só repetição de `confirm()`.
- **Journal**: novo `s.auditLog` (mesmo padrão da Copa — `appendAdminAuditLog()`, merge por
  timestamp entre dispositivos, cap de 200, exibido no admin em `renderAdminAuditLog()`)
  registrando `lock-results`/`unlock-results` com o conteúdo antes/depois, o suficiente para
  reverter manualmente se necessário.
- **Backups**: `exportJsonBackup()` já existia (equivalente ao `backupJson()` da Copa). Novo:
  `bolao/scripts/backup.py` e `backup_daily.py` agora cobrem os três apps (`main`/`br2026`/
  `cdb2026`) na mesma execução — o cron diário existente (01:00 AM EDT) passa a fazer backup do
  BR2026 também, sem precisar de entrada de cron nova.

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.43 — 2026-07-16

### Added — card "ao vivo" com expandir/colapsar por jogo (rodada final tem até 10 jogos simultâneos)

Eduardo: "the last round generally all the games happen at the same time" — o Brasileirão tem 20
times, então uma rodada completa pode ter até 10 jogos ao vivo ao mesmo tempo. Antes,
`renderLiveCard()` já suportava múltiplos jogos simultâneos (um bloco `.live-match` por jogo,
empilhados), mas cada um sempre mostrava tudo (placar, relógio, barras de probabilidade) — uma
parede de 10 cards detalhados não se lê bem numa tela de celular.

- Cada jogo ao vivo agora tem estado independente de expandido/colapsado — a linha inteira
  (placar + times + relógio) é o alvo de toque (não só um ícone pequeno), com um chevron
  indicando o estado. Primeira vez que um jogo aparece: expandido por padrão se são só 1-2 jogos
  simultâneos (comportamento igual a antes), colapsado por padrão a partir de 3 — a escolha do
  usuário sempre prevalece depois disso, mesmo com o poll de 60s atualizando o placar.
- Cabeçalho "🔴 N jogos ao vivo agora" aparece quando há mais de 1 jogo simultâneo, pra dar
  contexto de quantos estão rolando.
- Placar, escudos e relógio sempre visíveis (não fazem parte do que expande/colapsa) — só as
  barras de probabilidade (que exigem a tabela de classificação carregada) ficam atrás do toggle.

Verificado com dados reais do Supabase (`br2026_state.json`, 4 entradas reais) e cenários
sintéticos de ESPN via interceptação de rede: 1 jogo ao vivo mantém o comportamento antigo
(expandido, sem cabeçalho); múltiplos jogos simultâneos testados via leitura de código +
verificação end-to-end do cenário de 1 jogo (a mesma função, mesmo caminho de código).

### Fixed — "Ver palpites" aparecia antes do prazo sem fazer nada útil; Pago/Pendente no ranking público

Eduardo, screenshot do CDB2026: "Ver palpites ainda aparece e so deve aparecer apos o cutoff
time. E tambem não precisa pago e pendente, só para o admin." Dois achados reais, propagados
para os dois apps (BR2026 e CDB2026 têm a mesma estrutura):

- **"Ver palpites"**: o botão sempre aparecia no ranking, mesmo antes do prazo de entrada — só
  que clicar nele revelava uma mensagem "escondido até o prazo" (o dado em si já estava
  protegido dentro de `renderPickDisplay()`/`renderPickDisplay()`, sem vazamento real). O botão
  virou um toque morto, sem função, até o prazo passar. Corrigido: o botão (e o painel de
  detalhe associado) só é renderizado quando `isPastCutoff()` (BR2026) /
  `isPastEntryCutoff()` (CDB2026, prazo da fase ativa) já passou — mesmo padrão de proteção,
  agora também na visibilidade, não só no conteúdo.
- **Pago/Pendente no ranking**: a Copa (referência visual canônica) nunca mostrou esse badge na
  linha do ranking — só existe lá na aba Participantes. BR2026 e CDB2026 tinham divergido,
  mostrando o badge nas duas abas. Removido da linha do ranking nos dois apps, igualando à Copa;
  segue existindo em Participantes (info pública/transparente sobre quem já pagou, sem mudança
  aí).

Verificado com estado real (BR2026, 4 entradas reais do Supabase) via Playwright: antes do
prazo, nenhum botão "Ver palpites" aparece e nenhum texto "Pago"/"Pendente" aparece no ranking;
depois do prazo (`cutoffAt` no passado), o botão aparece para todas as entradas e o texto
Pago/Pendente continua ausente.

Não altera scoring nem lógica de negócio de pontuação. `audit_scoring.py` (Copa/BR2026/CDB2026):
5/5.

## v1.42 — 2026-07-16

### Fixed — badge "Pago" divergente da Copa (checkmark); página podia rolar para o lado no mobile

Eduardo, dois achados via screenshot mobile real:

1. **"o look and feel esta um pouco off na Pago e Pendente"**: o badge de pagamento mostrava
   "✓ Pago" (com checkmark) enquanto "Pendente" não tem prefixo nenhum — a Copa (referência visual
   canônica) usa só "Pago", sem checkmark (`paymentPaid` em `bolao/js/i18n.js`). O glyph "✓"
   renderiza com métricas de fonte diferentes do texto latino ao redor (fallback de fonte de
   símbolo), inflando a altura da pílula de forma perceptível no mobile — CSS das duas pílulas
   (`.paid-badge`/`.unpaid-badge`) já era idêntico em padding/cor/border-radius, só o texto
   divergia. Corrigido: `paid: "Pago"` (sem checkmark), igual à Copa, propagado também ao CDB2026
   (mesmo texto, mesmo bug).
2. **"ele faz scroll para o lado tambem, corrija em todos"**: nenhum dos 3 apps tinha
   `overflow-x: hidden` no `html`/`body` — uma rede de segurança padrão da indústria contra
   qualquer elemento (conhecido ou não) forçar rolagem horizontal da página inteira. Confirmado
   via Playwright que a mudança não quebra nenhum scroll interno intencional (`.standings-wrap`,
   `.picks-detail`, `.table-scroll` continuam roláveis normalmente) nem o header sticky.
   Propagado aos 3 apps (Copa, BR2026, CDB2026) e à página `classificacao-geral.html`.

Não altera scoring nem lógica de negócio. `audit_scoring.py`: 5/5.

## v1.41 — 2026-07-15

### Added — comprovante abrível/baixável (item 9 do CONSISTENCY_MATRIX.md); tabela de regras sem cabeçalho extra

Eduardo: "yes please fix everything." BR2026 não tinha NENHUMA confirmação visual pós-salvamento
— só um toast e pulava direto pro Ranking, sem mostrar o código do comprovante nem jeito de
abrir/imprimir/baixar. Portado exatamente da Copa (`openReceipt()`/`downloadReceipt()`, via Blob
URL, nunca `document.write`) e do padrão já usado no CDB2026 (`renderReceiptBox()`): novo
`#receiptBox` na aba Palpites, com código + botões "Abrir comprovante / salvar PDF" e "Baixar
HTML", reaproveitando o `receiptHtml()` já usado no e-mail. Agora, salvar uma **nova** entrada
mostra esse card em vez de pular direto pro Ranking (editar uma entrada existente continua
pulando, como sempre foi).

Também alinhada a tabela de pontuação da aba Regras: tinha um `<thead>` que a Copa não tem
(`.rules-table` da Copa é só `<tbody>`) — removido para bater exatamente.

`audit_scoring.py` (Copa + BR2026): PASSOU (mudança é só de exibição/confirmação, nunca grava
resultado oficial).

## v1.40 — 2026-07-15

### Added — prévia de pagamento no formulário de entrada (paridade com a Copa)

Continuando a auditoria de consistência (Eduardo: "sem pedir permissao... continue checando
diferencas"). A Copa mostra uma prévia do método de pagamento (`#paymentBox`) assim que o
participante seleciona CashApp/Zelle/Venmo no formulário — handle, QR (Zelle) e link, sem
precisar sair da aba Palpites. BR2026 nunca teve esse recurso. Portado exatamente
(`renderPaymentBox()`, mesmas classes `.pay-card`/`.pay-icon` já usadas na aba Pagamento),
disparado no `change` do select e também ao carregar uma entrada existente para editar.

`audit_scoring.py` (Copa + BR2026): PASSOU.

## v1.39 — 2026-07-15

### Fixed — Pot no lugar errado; barra de estatísticas sem equivalente na Copa removida

Eduardo: "o pot na copa nao esta igual nos outros dois... tudo precisa permanecer 100% igual a
nao ser que nao se aplique." Pot só aparecia como 1 de 3 números numa barra de estatísticas em
Participantes — a Copa não tem essa barra, mostra o Pot num `.pot-box` dedicado no cabeçalho do
Ranking (`#potValue`, atualizado em `renderRanking()`). Portado exatamente: `.pot-box`/
`.section-head-row` adicionados ao cabeçalho do Ranking, `#potValue` calculado com a mesma
fórmula da Copa (pagos × entryFee). A barra de estatísticas (total de entradas/pagas/pot) foi
**removida** — não tem equivalente na Copa, não era diferença específica de torneio, então não
se justificava mantê-la depois da correção anterior desta mesma auditoria.

### Added — audit_scoring.py (item 1 do CONSISTENCY_MATRIX.md)

BR2026 movimenta dinheiro real (US$5/entrada) e não tinha nenhuma proteção automatizada contra
regressão de scoring, ao contrário da Copa (que tem desde o incidente de julho/2026). Novo
`bolao/br2026/scripts/audit_scoring.py`: transcrição em Python da fórmula real de
`scoreEntry()`/`rankEntries()` (G4 exato/grupo/errado, Z4 exato/grupo/errado, SA6, cascata de
desempate), com 5 checagens (mutuamente exclusivo, pick perfeito soma certo, pick em branco não
pontua falso-positivo, sem resultado retorna `None` em vez de 0/crash, ordem de desempate).
Diferença importante em relação ao script da Copa: a Copa audita `send_result_email.py` (uma
reimplementação Python INDEPENDENTE que roda via cron) contra o site — aqui não existe um script
equivalente rodando sem supervisão, então não há "drift entre duas implementações" pra auditar.
O valor deste script é outro: garantir que a transcrição Python abaixo continua batendo com
`app.js` sempre que a fórmula mudar lá — precisa ser atualizado à mão junto de qualquer mudança
de scoring, mesma disciplina que `send_result_email.py` já exige na Copa.

`audit_scoring.py` da Copa: PASSOU (Copa intocada). `audit_scoring.py` do BR2026 (novo): PASSOU.

## v1.38 — 2026-07-15

### Fixed — tela "Participantes" com layout diferente da Copa

Eduardo apontou que Participantes/Ranking tinham "formatos de look and feel diferentes da
Copa". Ranking já usava a mesma estrutura (`.rank-row`); Participantes não — usava um
componente próprio (`.participant-row`, sem ícone, sem método de pagamento visível, spans
separados) nunca alinhado com a Copa (`.rank-row`: ícone 👤 + nome/pagador/método numa linha só
+ chip de status). Reconstruído pra usar exatamente a mesma marcação/classes da Copa. CSS morta
de `.participant-row` removida.

Também corrigido: `.unpaid-badge` usava vermelho/alarme (`rgba(248,113,113,.1)`); a Copa trata
"ainda não pago" como estado neutro (`.status-chip.pending`, cinza) — alinhado.

Mantida como acréscimo intencional (a Copa não tem equivalente, mas não conflita com as linhas
em si baterem exatamente): a barra de estatísticas (total de entradas/pagas/pot) no topo da
tela.

`audit_scoring.py`: PASSOU (mudança é só visual).

## v1.37 — 2026-07-15

### Added — paridade administrativa com o CDB2026 (itens 7/16/50 do CONSISTENCY_MATRIX.md)

Continuação da rodada de auditoria/correção pedida por Eduardo. Verificação contra o código
real (não só a matriz, que estava desatualizada em vários pontos — comprovante, CSV CRLF,
listener de `focus` e QR Zelle já tinham sido resolvidos por outra sessão e não precisaram de
nova correção):

- **Botão "Limpar tudo"** (`clearDataBtn`) e **backup JSON bruto** (`exportJsonBtn`) — portados
  quase literalmente do CDB2026 (`clearAllData()`/`exportJsonBackup()`), únicos itens de paridade
  administrativa que faltavam de verdade.
- **Timeout de rede (`AbortController`)** nas duas chamadas ao Supabase (`loadRemoteState()`/
  `saveRemoteState()`), que usavam `fetch()` cru sem timeout — só as chamadas à ESPN já passavam
  por `fetchJson()`. Também aplicado ao `checkVersion()` da IIFE de auto-reload (escopo isolado,
  sem acesso ao `fetchJson()` do módulo principal — timeout inline equivalente).

`audit_scoring.py`: PASSOU (mudança não toca scoring).

## v1.36 — 2026-07-15

### Fixed — relógio do card "ao vivo" sem detecção de intervalo, andava pra frente e voltava

Eduardo pediu uma auditoria comparando o recurso de jogo ao vivo entre Copa/BR2026/CDB2026 e,
depois, para corrigir tudo pra bater exatamente com a Copa. Achado: `pollAll()`/`renderLiveCard()`
filtravam partida ao vivo só por `state === "in"` — a ESPN mantém esse campo `"in"` durante o
intervalo também (o campo granular que muda é `type.name`, não `state`). Sem nenhuma detecção de
intervalo nem proteção contra o relógio andar pra trás por lag da ESPN, o card mostrava o relógio
subindo até ~46:00 e voltando pra 45:00 a cada poll (60s) durante o intervalo inteiro (~15min),
sem nunca indicar "Intervalo" — um "serrote" visual confuso.

**Correção**: portado quase literalmente da Copa (`bolao/js/app.js`) — `formatMatchClock()`
(relógio consciente de period, acréscimo de até 8min), `mergeLiveClock()` (monotônico, nunca anda
pra trás a não ser que a ESPN sinalize um reset de período legítimo), `detectClockPaused()`
(detecta pausa real comparando dois polls crus). `fetchScoreboard()` agora também extrai
`period`/`isHalftime`/`isPenalties`; `renderLiveCard()` e `renderNextGameCard()` passaram a
compartilhar uma função só (`liveClockDisplay()`) em vez de duplicar a lógica cada um do seu
jeito. Removida `formatClock()` (função antiga, sem mais chamador depois da correção).

Brasileirão nunca tem prorrogação/pênaltis (liga, não mata-mata), mas o tratamento de period
3/4/5 foi mantido mesmo assim, por paridade exata com a Copa (pedido explícito do Eduardo) e
porque não custa nada a mais.

`audit_scoring.py`: PASSOU (mudança é só de exibição ao vivo, nunca grava resultado oficial).

## v1.35 — 2026-07-14

### Added — "Projeção do Bolão": linguagem correta + índice de precisão informativo

Eduardo pediu a transformação completa do ranking numa página de projeção clara ("se o
Brasileirão terminasse hoje"), com auditoria prévia obrigatória. A auditoria (Fase 1) encontrou
que o motor de cálculo já existia de sessões anteriores (`getActiveScore()` já reusa a fórmula
oficial `scoreEntry()` alimentada com a tabela ao vivo; `calculateRankingMovement()` já compara
contra um baseline estável, nunca inventa movimento) — o trabalho real era linguagem/UI e a
métrica de precisão que faltava.

- **Título/subtítulo/disclaimer da seção Ranking** trocados para a linguagem exigida: "Projeção do
  Bolão" / "Se o Brasileirão terminasse hoje" / aviso explícito de que pontuação oficial e
  vencedores só saem depois do encerramento da competição.
- **Novo `accuracyMetrics()`**: índice de precisão 0-100% comparando o palpite original contra a
  tabela atual, posição a posição (G4/Z4) + acerto binário (SA6) — **puramente informativo, nunca
  usado em ranking/ordenação/desempate/pontuação**. Exibido no painel expandido de cada
  participante junto com uma lista das 5 maiores divergências (time, posição palpitada, posição
  atual).
- **Bug real encontrado escrevendo os testes**: o cálculo de distância posicional inicialmente
  comparava a posição REAL do time contra 0 fixo, em vez de contra o SLOT que o participante
  efetivamente escolheu para aquele time — corrigido antes de qualquer teste passar a depender do
  valor errado.
- `docs/bolao/BR2026_PROJECTION_MODEL.md` novo — fórmula, índice de precisão, movimento,
  limitações, estados tratados, linguagem obrigatória.
- Nova regra permanente em `CLAUDE.md`: toda classificação exibida antes do encerramento do
  Brasileirão deve ser tratada como projeção.

### Testado

- 17 testes novos (`test_br2026_projection.js`): linguagem da UI, `accuracyMetrics()` via hook de
  teste exposto (`window.__BR2026_TESTHOOKS__`) — palpite idêntico, posições trocadas em par,
  palpite invertido, time fora do grupo, SA6 parcial, sem palpite, sem classificação carregada, e
  confirmação de que `accuracyIndex` nunca aparece no objeto de ranking.
- Suíte de regressão completa (91 testes entre BR2026 e CDB2026) sem falhas.
- `node --check`; `python3 bolao/scripts/audit_scoring.py` — passou (fórmula oficial intocada).

## v1.34 — 2026-07-14

### Fixed — consistência entre apps + bug real de exposição de palpites

Eduardo reportou três problemas em sequência: email de comprovante diferente do CDB2026,
"Ver palpites" acessível antes do prazo (risco de cópia entre participantes) e "Ver palpites"
com layout inconsistente com a Copa. Auditados e corrigidos os três:

- **[SEGURANÇA — achado real] "Ver palpites" não era protegido pelo prazo de corte.** Diferente
  da Copa (que já tem `hideFuturePicks = !isPastCutoff()`), o painel de detalhe do ranking do
  BR2026 não checava cutoff nenhum — qualquer participante podia expandir o palpite de qualquer
  outro a qualquer momento, mesmo antes do Brasileirão começar. Corrigido: `renderPickDisplay()`
  agora retorna um aviso ("os palpites ficam ocultos até o prazo de entrada encerrar") enquanto
  `!isPastCutoff()`.
- **"Ver palpites" com estrutura visual inconsistente com a Copa.** O BR2026 usava um grid de
  cards de 2-3 colunas (`.picks-display`/`.pick-item`/`.pick-cell`), diferente da Copa, que usa
  `<table>` dentro de `.picks-detail`. Reconstruído para usar a mesma estrutura `<table>` e as
  mesmas classes CSS da Copa (`.picks-detail table/th/td`, `.pick-pts`/`.pick-pts.pos`). CSS morto
  removido (`.picks-display`, `.picks-col*`, `.pick-item`, `.pick-cell*`, `.pick-pts-badge`).
- **Email de comprovante inconsistente com CDB2026/Copa.** Reescrito `sendReceipt()`/nova
  `receiptHtml()` para usar o mesmo layout HTML (tema claro, `.doc`/`.meta`/`.code`/tabela/
  `.notice`) e o mesmo formato de código (`hashString()`/`receiptCode()` → `BR2026-XXXXXXXX-
  YYYYMMDD`) que Copa e CDB2026 já usam. BR2026 também passou a enviar cópia para o admin (Copa e
  CDB2026 já enviavam; BR2026 era o único que não).

### Testado

- 13 testes Playwright novos (`test_urgent_fixes.js`): reprodução e correção do bug de exposição
  de palpites, estrutura `<table>` pós-cutoff, formato do código de recibo, envio duplo
  (participante + admin).
- Suíte de regressão completa (`test_round2_fixes.js`, `test_live_standings.js`,
  `test_auto_cutoff.js`, `test_backfill_kickoffs.js`, `test_seed.js`, `test_cutoff_admin_ui.js`,
  `test_admin_leg_save.js`) — sem regressões.
- `node --check` em todos os JS alterados.
- `python3 bolao/scripts/audit_scoring.py` — passou (scoring não foi tocado).

## v1.33 — 2026-07-14

### Fixed — auditoria estilo Big Tech, rodada 2: itens que Eduardo autorizou explicitamente após ver o relatório

Depois do relatório completo da v1.32, Eduardo pediu explicitamente "corrija tudo e implemente".
Implementado o que não mexe em scoring/regra de negócio nem em comportamento arriscado de
produção:

- **Formulário de resultado oficial sem proteção contra sync em segundo plano**: `resultsFormIsDirty()`
  novo, compara os 14 `<select>` contra `s.results` e pula a reconstrução do painel enquanto o
  admin estiver editando (mesmo princípio de `pickFormIsDirty()`).
- **Formulário de resultado oficial não checava time duplicado dentro do mesmo grupo**: o
  formulário de palpite do participante já bloqueia isso; o formulário OFICIAL do admin (que
  decide a pontuação de todo mundo) não. Adicionada a mesma checagem (`errorDuplicateG4`/`SA6`/`Z4`).
- **Sem botão "Cancelar" ao editar uma entrada**: `_editingEntry` ficava preso indefinidamente se o
  admin saísse da edição sem salvar — e enquanto isso, o sync remoto ficava pausado (risco de
  sobrescrever entrada mais nova de outro dispositivo). Novo banner `#editModeBanner` com botão
  "Cancelar edição", mesmo padrão que a Copa já tem.
- **Sem validação entre `DATA.teams` (lista fixa) e o nome ao vivo da ESPN**: se a ESPN renomear um
  time, quem apostou nele passaria a pontuar zero silenciosamente. Adicionado aviso no console
  (mínimo necessário, sem travar nada) quando um time da tabela ao vivo não bate com a lista fixa.
- **Poll da ESPN não engajava backoff em falha parcial**: agora um dos dois endpoints falhando
  sozinho (não só os dois juntos) já reduz a frequência do poll.
- **Corte provisório G4/SA6/Z4 sem desempate próprio**: um empate de `rank` vindo da ESPN (comum
  logo após uma rodada) podia errar a fronteira entre zonas. Desempate determinístico adicionado:
  saldo de gols → gols pró → nome.
- **Tabela de probabilidades recalculada a cada resync mesmo fora de tela**: agora só roda quando a
  aba Probabilidades está ativa.
- **Alvo de toque mínimo (WCAG) no nav mobile**: `min-height: 44px` — propagado dos 3 apps.

Não implementado nesta rodada (feature-sized, fora do escopo de "corrigir um achado" — fica para
um pedido dedicado se Eduardo quiser): sistema de código de comprovante (BR2026 é o único dos 3
apps sem um, item já rastreado em `CONSISTENCY_MATRIX.md` #8).

`node --check`: OK. `audit_scoring.py`: 5/5 — nenhum valor de pontuação tocado.

## v1.32 — 2026-07-14

### Fixed — auditoria estilo Big Tech: ranking mostrava rank/medalha errados em empate, deploy podia apagar palpite

Eduardo pediu uma auditoria completa nível Big Tech nos 3 apps (arquitetura, bugs, UX, QA,
segurança, mobile, performance, acessibilidade, consistência, produto), com instrução explícita
de reportar achados primeiro e não alterar scoring/regra de negócio sem autorização. Relatório
completo entregue a Eduardo fora deste changelog; aqui só o que foi corrigido nesta rodada
(verificado lendo o código real antes de cada correção, não só confiando no relatório do agente):

- **🔴 Rank/medalha exibidos errados em empate de pontos** (`rankEntries()`): o array já era
  ordenado corretamente pela cascata de desempate completa (total → acertos SA6 → G4 exato → Z4
  exato → nome), mas o número de rank/medalha exibido só avançava quando `item.total` mudava —
  duas entradas com o mesmo total mas desempate diferente apareciam com a MESMA medalha, mesmo
  ordenadas corretamente no array. Afeta diretamente quem aparece como 2º/3º lugar, base do
  rateio de prêmio (70/20/10%). Corrigido usando o mesmo padrão já comprovado da Copa
  (`bolao/js/app.js`): chave composta `${total}:${sa6Hits}:${g4Exact}:${z4Exact}` decide quando o
  rank avança, não só o total. Testado via `window.__BR2026_TESTHOOKS__.rankEntries` com duas
  entradas empatadas no total por fontes de pontos diferentes (uma via Z4 exato, outra via SA6) —
  confirma ranks diferentes agora.
- **`checkVersion()` podia apagar um palpite não salvo:** o poller de deploy (10 min + toda troca
  de aba) não checava se o formulário de palpites tinha dado não salvo antes de forçar
  `location.reload()`. Adicionada a mesma checagem de `pickFormIsDirty()` (duplicada localmente
  porque essa IIFE roda fora do escopo do módulo principal).
- **CSV export usava `\n`, não `\r\n`:** bug já corrigido uma vez na Copa (v3.0) e no CDB2026
  (v2.0), nunca corrigido aqui (`CONSISTENCY_MATRIX.md` item 14, rastreado desde então). Excel no
  Windows renderiza mal um CSV com quebra de linha bare-LF.
- **Coluna "J" (jogos) podia mostrar 1 em vez de 0:** `getStat("gamesPlayed", "GP") || 1` fazia um
  time com 0 jogos de verdade (início de temporada) aparecer com "1" na tabela. A divisão que
  dependia disso (`buildRatings()`) já tinha sua própria proteção independente contra dividir por
  zero — não dependia deste valor errado para funcionar.
- **`aria-expanded` ausente no botão "Ver palpites" do ranking:** leitor de tela não indicava que
  o botão controla uma região expansível nem seu estado atual. Adicionado, sincronizado com o
  toggle de `.picks-detail`.

Achados de maior risco reportados a Eduardo mas não corrigidos automaticamente (fora do escopo
de "patch pequeno e reversível" desta rodada, ou dependem de decisão de produto): admin sem botão
"Cancelar" ao editar uma entrada (bloqueia sync em segundo plano indefinidamente até salvar),
formulário de resultado do admin sem proteção contra sync em segundo plano durante digitação
(mesma classe do bug já corrigido no formulário de palpite, mas no lado do admin), falta checagem
de time duplicado dentro do mesmo grupo no formulário de resultado oficial.

`node --check`: OK. `audit_scoring.py`: 5/5 — scoring (valores de pontos) não tocado, só a
exibição do rank/medalha em caso de empate no total.

## v1.31 — 2026-07-14

### Fixed — cutoff usava data estática defasada, divergindo do calendário real ("Próximo jogo")

Eduardo reportou (screenshot em produção): "Cutoff do BR2026 está incorreto! Deve ser até 1h
antes do início do primeiro jogo". `cutoffIso` (config.js) era um valor **estático**, digitado
manualmente em v1.11 como "domingo 19/jul às 23h59 (2 dias antes do reinício do BR)" — mas nunca
mais atualizado. O calendário real da ESPN (mesmo usado pelo card "Próximo jogo", que já estava
correto) já mostrava o primeiro jogo real como Botafogo x Santos, qui. 16/jul às 19h30 — 3 dias
**antes** do cutoff configurado. As duas informações discordavam na mesma tela.

Mesma classe de bug do CDB2026 v3.12 (ver entrada abaixo/CHANGELOG do CDB2026): um valor calculado
manualmente uma vez, sem mecanismo para acompanhar a realidade, fica defasado silenciosamente.

Corrigido com o mesmo princípio (auto-cálculo, uma vez):

- `nextUpcomingGame()` — novo helper único (usado tanto pelo cutoff quanto pelo card "Próximo
  jogo", que passou a chamá-lo em vez de duplicar a mesma busca) — garante que os dois **nunca
  podem discordar** sobre qual é o próximo jogo.
- `computeSeasonCutoffIso()` / `freezeSeasonCutoff()` — calcula o cutoff como 1h antes do primeiro
  jogo real ainda não realizado, e **congela** o resultado em `s.cutoffAt` (estado compartilhado
  via Supabase) na primeira vez que o calendário carrega. Congelar é necessário: sem isso, o
  "próximo jogo ainda não realizado" avançaria a cada rodada conforme jogos terminam, o que
  reabriria as entradas depois de fechadas — inaceitável, dinheiro real depende disso. Testado
  explicitamente (`test_br_auto_cutoff.js`): o valor não muda mesmo quando um recarregamento
  posterior do calendário mostra um "próximo jogo" mais distante.
- `cutoffIso` em config.js agora é só o fallback usado antes do primeiro congelamento — atualizado
  para o valor real correto (16/jul 18h30) para não mostrar um número errado nesse intervalo.
- `audit_scoring.py`: 5/5 (cutoff não afeta pontuação).

## v1.30 — 2026-07-14

### Fixed — "Próximo jogo" não mostrava contador ao vivo igual à Copa (mesmo achado no CDB2026)

Eduardo reportou: "próximo jogo br nao mostra countdown do proximo jogo igual copa que funciona
bem. Isso tem que ser 100% consistente". O card "Próximo jogo" (fora do caso "jogo hoje") só
mostrava um texto de contador ("6d 01h 13m") — bem menos visível que a caixa de dígitos grandes
que a Copa usa. Adicionada `countdownTimerHtml()`, mesmo algoritmo e mesma marcação
(`.count-grid` + dias/horas/min/seg em caixas, variante de 4 colunas quando há dias) do contador
da Copa (`renderNextMatch()` em `bolao/js/app.js`), substituindo o texto inline pela caixa —
`renderNextGameCard()` já tinha um `setInterval` de 1s próprio, então o contador novo já
atualiza ao vivo sem mudança adicional nesse ponto.

Mesmo achado, mesma correção aplicada ao CDB2026 — ver changelog do CDB2026 v3.11 (lá o gap era
maior: não só faltava a caixa, o card também não tinha nenhum tick de 1s próprio).

12 testes automatizados novos (caixa de dígitos presente, contador atualizando ao vivo com o
schedule da ESPN mockado). `node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v1.29 — 2026-07-14

### Fixed — palpites apagados ao interagir com o formulário (bug crítico, mesmo achado no CDB2026)

Mesmo bug e causa raiz do CDB2026 v3.9 (ver esse changelog para a investigação completa):
`renderAll()` reconstrói `#pickForm` (14 `<select>` de time) toda vez que roda, inclusive quando
um resync em segundo plano dispara sozinho (Supabase, a cada 30s ou em todo `focus`/
`visibilitychange` — abrir qualquer um dos `<select>` pode causar esse ciclo em vários
navegadores/mobile). Uma entrada nova, ainda não salva, não tinha proteção nenhuma contra isso.
Corrigido: `renderAll()` não reconstrói mais o formulário enquanto tiver algum time já
selecionado e ainda não salvo (`pickFormIsDirty()`). Confirmado com Playwright: um `focus`
disparado no meio do preenchimento apagava a seleção ~1s depois; corrigido, sobrevive até salvar.

### Fixed — inconsistências visuais com a Copa (auditoria "estilo big 4")

Eduardo pediu uma auditoria profunda comparando cores/fontes/tamanhos/posicionamento nos 3 apps.
Token a token nos 3 arquivos CSS:
- `--red`: era `#f87171` aqui e no CDB2026, a Copa usa `#ff6b6b` para o mesmo tom semântico
  (badge "ao vivo", não pago) — alinhado à Copa.
- `.section-head`: tinha `margin-bottom: 16px` + um `h2 { font-size: 22px }` que a Copa não tem
  — títulos de seção renderizavam maiores que na Copa. Removida a divergência.
- `input, select`: faltava `appearance: none` no seletor genérico — todo `<select>` sem regra
  própria mostrava a seta nativa do navegador em vez do visual limpo da Copa.

Ver `docs/bolao/DESIGN_SYSTEM.md` para a auditoria completa.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v1.28 — 2026-07-14

### Fixed — CSV/formula injection no export (segurança)

Mesma varredura/mesmo bug da Copa (ver `bolao/CHANGELOG.md` v4.130): `exportCsv()` só escapava
aspas duplas, não os caracteres que disparam interpretação como fórmula no Excel/Sheets
(`=+-@`/tab/CR) em campos de texto livre (`entryName`, `payerName`). Adicionado `csvEscape` (novo
const, mesmo padrão da Copa) e trocado no `.map()` de `exportCsv()`.

### Fixed — blocos `catch` vazios sem comentário

Três `catch {}`/`catch (e) {}` sem o comentário exigido pelo `CLAUDE.md`. Adicionado comentário
explicando a razão do silêncio em cada um (cache de sessionStorage corrompido, storage
indisponível, polling de versão) — sem mudança de comportamento.

Sem mudança de scoring/regras. `audit_scoring.py` (Copa): 5/5.

## v1.27 — 2026-07-14

### Fixed — ordem dos botões do header/nav divergindo da Copa

Eduardo apontou que a ordem dos botões não era a mesma nos três apps. Auditado contra a Copa
(referência visual canônica): dois desalinhamentos reais no `index.html`.

1. **Header**: Copa tem WhatsApp → idioma (PT-BR/ES-MX/EN-US) → seletor de bolão; este app tinha
   idioma → WhatsApp, trocados de posição. Corrigido para bater com a Copa.
2. **Nav**: Copa tem Palpites → Ranking → Participantes → Pagamento → Jogos → Probabilidades →
   Regras → Admin (Participantes/Pagamento ficam ocultos por CSS na Copa, mas a posição no DOM é
   essa). Este app tinha Participantes/Pagamento depois de Probabilidades em vez de logo após
   Ranking. Corrigido — a aba "Tabela" (sem equivalente na Copa) manteve sua posição relativa,
   logo antes de Jogos.

Apenas reordenação de markup (`index.html`) — nenhuma mudança de `app.js`/CSS necessária (nada
depende da ordem do DOM; a navegação usa seletores por `data-section`, não índice). Verificado
via Playwright: zero erros de JS, navegação funcionando normalmente nos três apps depois da
mudança.

### Fixed — ícone do Zelle quebrado (asset ausente)

Auditoria cosmética completa pedida por Eduardo (44 screenshots via Playwright, 3 apps × desktop
+ mobile × todas as seções) encontrou um bug real, não apenas estético: `assets/zelle.svg` nunca
existiu neste app (só na Copa), mas `PAY_ICON_SVG` em `js/app.js` já referenciava esse caminho —
ícone de imagem quebrado no card de pagamento Zelle. Corrigido copiando o SVG da Copa (mesmo
arquivo, sem alteração de conteúdo). Ver `docs/bolao/DESIGN_SYSTEM.md` "Auditoria cosmética
completa" para o restante dos achados (dois itens de layout aguardando decisão do Eduardo, não
implementados nesta rodada).

## v1.26 — 2026-07-13

### Fixed — resync forçado ao voltar de uma aba em segundo plano (bfcache)

Eduardo pediu para garantir que nada fique "em cache" e que tudo reflita o Supabase depois da
sincronização ser ligada. Investigado: o app **já** usa a regra de merge correta (`results`/dados
travados sempre vencem do lado remoto — `preferRemoteResults: true`, mesmo padrão que corrigiu o
bug histórico "resultado real sobrescrito por localStorage de teste" na Copa — ver
`docs/bolao/LESSONS_LEARNED.md` "Supabase — merge/sync"). Remover o `localStorage` inteiramente
não teria corrigido aquele bug (a causa era a regra de merge, não a existência do
`localStorage`) e tornaria o app 100% dependente do Supabase estar no ar — pior para
confiabilidade, e o app já é `local-first` por design.

O que realmente faltava (gap já catalogado em `CONSISTENCY_MATRIX.md` item 23, nunca corrigido
até agora): o listener de `pageshow`/`event.persisted` que a Copa já tem desde a v4.111 — sem
ele, o Safari/iOS pode restaurar uma aba do bfcache (voltar de segundo plano) sem disparar
`visibilitychange` de forma confiável, deixando a página presa no estado em memória do último
carregamento real em vez de rebuscar o Supabase. Adicionado (junto com um listener de `focus`,
que também faltava) — mesmo padrão da Copa, agora `debouncedReload()` cobre
visibilitychange + focus + pageshow, todos debatidos em 60ms para não disparar chamadas
sobrepostas.

Testado (Playwright): carregamento inicial busca o Supabase; simular `pageshow(persisted:true)`
dispara um resync novo; disparar `focus` e `pageshow` juntos gera só uma chamada (debounce
funcionando), não uma rajada.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v1.25 — 2026-07-13

### Changed — Supabase habilitado (`database.enabled: true`)

Eduardo pediu para não deixar dados só em `localStorage`. `database.enabled` ligado
(`js/config.js`), mesmo projeto/tabela Supabase que a Copa já usa (`bolao_state`, linha própria
via `stateId: "br2026"`). `localFallback: true` mantido — a arquitetura local-first com espelho
remoto não foi removida, só passou a sincronizar de fato.

**Ação pendente do lado do Supabase (fora do alcance desta sessão):** as policies de RLS só
liberavam `id='main'` — SQL para estender aos três apps em
`docs/bolao/DATABASE_SETUP_SUPABASE.md` "Múltiplos apps na mesma tabela", precisa ser rodado uma
vez no painel do Supabase por Eduardo. Até lá, o app continua funcionando normalmente em modo
local (testado com a resposta do Supabase mockada como 403 — nenhum erro não tratado, nenhuma
perda de dado local).

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto (mudança de infraestrutura, não de
scoring).

## v1.24 — 2026-07-13

### Fixed — texto confuso na tabela de Regras (parênteses duplicados)

Reportado por Eduardo: linhas como "🥇 1º Lugar (no G4 (posição errada))" — parênteses aninhados
confusos. Causa: `renderRules()` (`bolao/br2026/js/app.js`) já envolve o valor de
`t("rulesInG4")`/`t("rulesInZ4")` em parênteses no template; as strings em `i18n.js` também
traziam seus próprios parênteses (`"no G4 (posição errada)"`), duplicando o nível de aninhamento.
Corrigido removendo os parênteses internos das strings (`"no G4, posição errada"` /
`"no Z4, posição errada"`) — nenhuma mudança de valor de pontos, só de texto. Copa e CDB2026 não
têm o conceito de G4/Z4 (bracket e mata-mata, respectivamente), então o mesmo bug não existe nos
outros dois apps — nada a propagar.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto (só texto).

## v1.23 — 2026-07-13

### Added — classificação ao vivo do Brasileirão + movimento de ranking dos participantes

Pedido de Eduardo, com auditoria obrigatória prévia contra o recurso equivalente da Copa (ver
`docs/bolao/BR2026_LIVE_STANDINGS.md` para o detalhamento completo). Resumo:

- **Tabela do Brasileirão** ganhou uma coluna "Mov." e passa a reordenar por posição ao vivo
  durante uma janela de partidas em andamento, recalculando pontos/saldo com os placares atuais.
  Função pura nova: `calculateLiveStandings({ baselineStandings, liveMatches, completedMatches,
  tieBreakRules })`. Baseline congelada em `sessionStorage` no momento em que a contagem de
  partidas ao vivo passa de 0 para >0 (nunca a cada gol); descartada quando volta a 0. Sem
  baseline confiável, mostra "indisponível" em vez de inventar uma posição anterior.
- **Ranking dos participantes** ganhou setas de movimento (`▲`/`▼`/`•`/`–`) com a mesma lógica.
  Função pura nova: `calculateRankingMovement()`, usando o padrão stateless correto já
  comprovado na Copa (`liveMatchPointsTable()`) — **não** o outro padrão da Copa
  (`computeRankArrows()`, baseline = último render), decisão confirmada explicitamente por
  Eduardo. Reaproveita o mesmo comparador (`rankEntries()`) usado pelo ranking exibido, para que
  baseline e live nunca possam divergir do total realmente mostrado na tela.
- Correções de escopo confirmadas junto: casamento de partida por `ev.id` estável da ESPN (antes
  só por nome de time — string matching); uso do flag `postponed` (já existia, nunca era lido)
  para excluir jogos adiados/cancelados do cálculo ao vivo.
- Higiene de rede: todo `fetch()` do app passa a usar `AbortController` com timeout de 10s;
  `pollAll()` nunca sobrepõe (`_pollInFlight`), não roda com `document.hidden`, e o loop trocou
  de `setInterval` fixo para um `setTimeout` autorreagendado com backoff em falha; foco de aba
  dispara um poll imediato.
- Novas classes CSS `.movement`/`.movement-up/-down/-same/-unavailable` (deliberadamente
  separadas do `.rank-arrow` da Copa — ver design system). Colunas Pos/Mov/Time/Pts da tabela
  agora usam `position: sticky` para nunca saírem de vista em 320–414px; nome de time trunca com
  reticências.
- Setas nunca são só glifo — `<span class="visually-hidden">` com texto completo em todas
  (`"Subiu 3 posições, de 5º para 2º"`, etc.), respeitando `prefers-reduced-motion`.

Testes: 27 testes puros (`calculateLiveStandings`, `zoneForPosition`, `rankEntries`,
`calculateRankingMovement`) + 9 testes de integração ponta a ponta com ESPN mockada — todos
verdes. `node --check` limpo nos 12 arquivos JS dos 3 apps. `audit_scoring.py`: 5/5, Copa
intocada. Scoring do BR2026, CDB2026 e regras do Brasileirão **não foram alterados** — apenas
classificação ao vivo, movimento e consistência do ranking.

## v1.22 — 2026-07-13

### Fixed — escudo do time ainda "nas pontas" em vez de flanquear o centro + token `--gold` ausente

Dois achados reportados por Eduardo depois do fix v1.21 (que só tinha removido o escudo de
*dentro* das barras de probabilidade, mas não corrigiu os outros lugares onde nome+escudo
aparecem em texto corrido):

1. **Escudo nas pontas.** O padrão canônico da Copa (`bolao/js/app.js`, `renderNextMatch()`)
   é nome fora / escudo dentro, flanqueando o "×" central: `Time A 🏳 × 🏳 Time B`. Este app
   fazia o oposto em 6 lugares (`live-teams`, `today-game-teams` ×3 variantes,
   `next-game-teams`): escudo fora, nome dentro. Invertido para bater com a Copa.
2. **`--gold` não definido no `:root`.** `.game-status.postponed` usava `var(--gold)` sem o
   token existir neste app (só Copa e CDB2026 tinham `--gold`) — o texto do badge "adiado"
   ficava sem cor válida. Adicionado `--gold: #f59e0b` (mesmo valor de Copa/CDB2026).

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto de scoring (só CSS/markup).

## v1.21 — 2026-07-13

### Fixed — topbar quebrava horizontalmente no mobile + escudo do time nas barras de probabilidade

Reportado com screenshots: página cortada/deslocada horizontalmente no celular, e as barras de probabilidade (card "Próximo Jogo" e aba Jogos) mostrando o escudo do time junto com o nome, diferente do bolão da Copa.

Dois fixes:
1. **Topbar** — mesma causa raiz do bolão da Copa (`bolao/css/styles.css`): seletor de bolão competindo por espaço com marca+WhatsApp numa linha só, e `grid-template-columns` sem `minmax(0, 1fr)` não deixava os itens encolherem. Mesmo fix: seletor em linha própria, `minmax(0, 1fr)`, subtítulo da marca escondido no mobile. Bônus: `.pick-pts-hint` (texto de dica nos palpites G4/Z4) também estava com `white-space: nowrap`, forçando overflow em telas bem estreitas (320-360px) — removido.
2. **Escudo nas barras de probabilidade** — as três funções que montam as barras ("Próximo Jogo" de hoje, "Próximo Jogo" sem jogo hoje, e a lista da aba Jogos) injetavam `<img>` do escudo do time dentro do texto da barra. Removido — agora mostra só "Time NN%", igual ao bolão da Copa (`probBarsMarkup` em `bolao/js/app.js`), inclusive o mesmo limite de 12% pra esconder o nome em fatias muito estreitas. Escudo ao lado do nome do time no cabeçalho do card (fora da barra) continua igual — não é o mesmo lugar do bug.

QA: 9 larguras testadas (320-1440px), zero overflow horizontal. Rodei `python3 bolao/scripts/audit_scoring.py` (bolão da Copa) — sem impacto, mudança isolada ao Brasileirão.

---

## v1.20 — 2026-07-13

### Fixed — fechamento da tarefa "Copa como referência canônica"

- `.admin-toolbar` gap/margin alinhados com a Copa (`8px`/`14px`, era `6px`/`8px`).
- `.admin-row` (lista de entradas/pagamentos no admin) **mantido** como lista densa em vez de
  virar um card por linha como a Copa — decisão consciente registrada em
  `docs/bolao/CONSISTENCY_MATRIX.md` item 78 (densidade de dados + área admin-only de baixa
  visibilidade), não uma omissão.

Ver `docs/bolao/DESIGN_SYSTEM.md` para a tabela de mapeamento completa desta rodada e a
tabela de validação (com a ressalva de que não houve captura visual real — sem navegador
disponível neste sandbox, tudo verificado por leitura de CSS).

`audit_scoring.py`: 5/5 — só CSS.

## v1.19 — 2026-07-12

### Fixed — bugs reais reportados testando o site ao vivo

- **Tabela do Brasileirão sem V/E/D/GF/GC/SG**: `fetchStandings()` só extraía
  `points`/`gamesPlayed`/`gf`/`ga` da ESPN. Adicionado `wins`/`ties`(`draws`)/`losses`/
  `pointDifferential` (nomes de stat confirmados direto no endpoint real da ESPN) e as colunas
  correspondentes na tabela — padrão J/V/E/D/GP/GC/SG/Pts de tabela de futebol brasileiro.
- **Jogos não alinhavam**: `.game-matchup` era `flex` com `justify-content:center` — o placar/
  hora central não ficava na mesma posição horizontal entre linhas com nomes de time de
  tamanhos diferentes, porque flex empacota pelo conteúdo. Trocado para grid `1fr auto 1fr`
  (mesmo padrão de `.game-teams` na Copa), forçando as duas colunas de time a terem a mesma
  largura — o centro sempre alinha agora, independente do tamanho do nome.
- **Botão WhatsApp**: texto visível era só "WhatsApp"; Copa usa "Suporte WhatsApp". Alinhado.
- **Card de pagamento sem ícone**: `.pay-card` não tinha o ícone por método (CashApp/Zelle/
  Venmo) que a Copa tem — `cashapp.svg`/`venmo.svg` copiados para `assets/`, `payIcon()`
  portado, `zelle.qrImage` configurado (asset já existia). `.pay-grid`/`.pay-card` migrados
  para o mesmo layout/tokens da Copa (3 colunas fixas, ícone + texto em linha, `var(--bg2)`/
  `border-radius:16px`).
- **Spinner nativo removido** dos inputs numéricos (mesmo fix nos três apps).

`audit_scoring.py`: 5/5 — só CSS/apresentação, nenhum dado de standings usado para
scoring/ranking (BR2026 não pontua pela tabela do Brasileirão em si, só pelos palpites de
G4/Z4/SA6 dos participantes).

## v1.18 — 2026-07-12 (WIP — commit parcial)

### Fixed — Copa como referência visual canônica (início; tarefa incompleta)

Início da padronização com a Copa (`bolao/`) como referência visual canônica (nova regra
permanente em `CLAUDE.md`). Commit parcial por limitação de créditos da sessão — ver
`docs/bolao/CONSISTENCY_MATRIX.md`/`DESIGN_SYSTEM.md` para o que ainda falta (auditoria
completa de jogos/times, admin, pagamento, regras, e a tabela de validação visual por
viewport pedidas na tarefa não foram concluídas).

- **`main` max-width**: `860px` → `1140px`, igual à Copa.
- **`.game-card`**: era uma linha de lista plana (só `border-bottom`); agora usa o mesmo
  tratamento de card da Copa (`background`, `border`, `border-radius:16px`, `margin-bottom`).

`audit_scoring.py`: 5/5 — só CSS.

## v1.17 — 2026-07-12

### Added — sistema de toast + badge/status unificado + ranking reestruturado (findings Critical/High autorizados)

Autorização explícita do Eduardo para implementar os 3 findings maiores do
`docs/bolao/DESIGN_SYSTEM.md` que ficaram pendentes na rodada anterior (patch mínimo só CSS).
Ver `docs/bolao/CONSISTENCY_MATRIX.md` itens 67-69 e `bolao/CHANGELOG.md` v4.127.

- **Badge/status unificado**: `.game-status` deixou de ser só texto colorido e virou pílula
  (`border-radius:999px; padding:4px 10px`), mesmo tratamento do `.status-chip` da Copa —
  adicionado `.game-status.live` com a mesma animação de pulso (`@keyframes live-pulse`,
  copiado da Copa, não existia aqui). `.paid-badge`/`.unpaid-badge` ganharam
  `border-radius:999px`/`padding:4px 10px`/`font-weight:900` (eram `6px`/`3px 8px`/`700`).
- **Sistema de toast portado da Copa**: `showToast()` (mesma implementação, copiada de
  `bolao/js/app.js`) + CSS `.bolao-toasts`/`.bolao-toast` (4 variantes: success/error/warn/
  info). Convertidos os `alert()`s de confirmação/erro que não são validação de formulário
  (fluxo de salvar entrada, admin login/lockout, sync, resultados) — validação de campo
  obrigatório continua `alert()`, de propósito, igual à Copa.
- **Ranking reestruturado**: `.rank-card` empilhado (com o detalhe de palpites sempre visível)
  substituído pelo `.rank-row` denso de 1 linha da Copa + `.picks-detail` expansível por clique
  (`data-rank-toggle`/`_openRankDetails`, mesmo padrão de `bolao/js/app.js`). Card de posição/
  nome/pontos/badge de pagamento/botão "Ver palpites" numa linha só; detalhe dos palpites some
  por padrão, mesmo comportamento em mobile (breakpoint 900px com coluna de pontos de largura
  fixa, já usado na Copa desde as rodadas de otimização documentadas em `LESSONS_LEARNED.md`).
- Nova chave i18n: `viewPicks`.

`audit_scoring.py`: 5/5 — mudança é de apresentação/interação, nenhuma fórmula de pontuação ou
critério de desempate foi tocado (o `scored.sort()` que já existia continua idêntico).

## v1.16 — 2026-07-12

### Fixed — patches mínimos de design system (auditoria de UX cross-app)

Parte dos findings de baixo risco do `docs/bolao/DESIGN_SYSTEM.md`, CSS-only:

- **`h1,h2,h3` normalizado globalmente** — antes só existia `.section-head h2`; um `<h3>` fora
  dessa seção (ex.: dentro de um `.card`) caía no tamanho/margem default do navegador,
  diferente da Copa. Mesma regra da Copa portada (`margin:.15em 0 .4em`, `h2:1.25rem`,
  `h3:1.05rem` — sem `h1` explícito, a Copa também não tem).
- **Botão sticky (`.sticky-submit button`)**: sombra `rgba(0,0,0,.5)` → `rgba(47,229,110,.35)`
  (verde, igual à Copa) — `min-width:200px` já existia.
- Input/select/label e `.rules-table` padding já batiam com a Copa antes desta rodada — nenhuma
  mudança necessária aqui (a Copa que migrou para o padrão que este app já tinha).

Findings maiores (badge/status, ranking, toast) não implementados nesta rodada — ver
`bolao/CHANGELOG.md` v4.126 para o racional completo.

`audit_scoring.py`: 5/5 (só CSS).

## v1.15 — 2026-07-12

### Fixed — escudo do time renderizando em tamanho gigante (bug real do fix de v1.14)

Reportado por Eduardo testando o site ao vivo: o fix de v1.14 (escudo no card "Ao vivo"/
"Próximo jogo") usava `teamLogoImg()` gerando `<img class="team-logo">` sem `width`/`height` —
e a classe `.team-logo` no CSS também não tinha essas dimensões definidas (os usos antigos, nas
barras de probabilidade, tinham `width="14" height="14"` como atributo HTML inline direto,
mascarando a lacuna). Resultado: o navegador renderizava a imagem no tamanho nativo do arquivo
da ESPN (bem maior que 14px) nos dois cards novos. Corrigido adicionando `width:14px;
height:14px` diretamente à classe `.team-logo` no CSS — cobre todos os usos, novos e antigos,
sem depender de atributo inline em cada `<img>`.

`audit_scoring.py`: 5/5 (só CSS).

## v1.14 — 2026-07-12

### Fixed — escudo do time só aparecia na barra de probabilidade, não no card do jogo

Reportado por Eduardo: o escudo do time (`_teamLogos`, vindo do standings da ESPN) já era
buscado e usado dentro das barrinhas de probabilidade, mas os dois widgets mais visíveis da
tela — o card "Ao vivo" (`renderLiveCard`) e o card "Hoje tem jogo"/"Próximo jogo"
(`renderNextGameCard`, nos 3 estados: ao vivo, encerrado hoje, e sem jogo hoje) — mostravam só
o nome do time em texto puro, sem nenhum símbolo. A aba Jogos (`renderGamesSection`) já
mostrava o escudo corretamente ao lado do nome — só os widgets do topo da página estavam sem.

- Extraído helper `teamLogoImg(team, cls)` reaproveitando `_teamLogos` (já existente).
- Escudo adicionado nas bordas externas dos nomes de time (mesmo padrão visual da Copa com
  bandeira) em `renderLiveCard`, `renderNextGameCard` (todos os 3 estados) e
  `renderNextGameCard`'s "próximo jogo" (sem jogo hoje).
- Só CSS/markup — nenhuma lógica de scoring, ranking ou dado alterada. `audit_scoring.py`: 5/5.

### Added — botão WhatsApp no topbar

Resolve a divergência `MISSING` catalogada em `docs/bolao/CONSISTENCY_MATRIX.md` item 34 —
reaproveita o mesmo grupo, QR e ícone da Copa do Mundo (`assets/whatsapp.svg`,
`assets/whatsapp-group-qr.png`), não é um grupo novo.

## v1.13 — 2026-07-12

### Fixed — CSS badge para jogos adiados

- `.game-status.postponed { color: var(--gold); }` adicionado (texto "Adiado" em dourado)
- Completa implementação de detecção de jogos adiados via ESPN (`status.type.name === "Postponed" || "Canceled"`)
- `audit_scoring.py`: 5/5.

---

## v1.12 — 2026-07-12

### Novo — botões de idioma no topbar (padronização com Copa)

- Adicionado `lang-links` ao topbar: PT-BR ativo, ES-MX e EN-US desabilitados
- Desktop: grid `1fr auto auto` → brand | lang | switcher
- Mobile: brand | switcher (row 1) → lang (row 2) → nav (row 3)
- `audit_scoring.py`: 5/5.

---

## v1.11 — 2026-07-12

### Fixed — alinhamento topbar + cutoff atualizado

- `align-items: center` no grid do topbar (desktop e mobile)
- `cutoffIso` atualizado para **domingo 19/jul às 23h59 BRT** (2 dias antes do reinício do Brasileirão)
- `audit_scoring.py`: 5/5.

---

## v1.10 — 2026-07-12

### Fixed — segurança + CSS (Big Tech QA audit)

- **SEC LOW-1**: whitelist antes de `location.href` no switcher de bolão
- **CSS MOB-3**: `-webkit-backdrop-filter` adicionado (blur do topbar no iOS Safari ≤ 15)
- `audit_scoring.py`: 5/5.

---

## v1.9 — 2026-07-12

### Design — padronização 100% com a Copa do Mundo (auditoria sistemática)

11 diferenças identificadas por auditoria diff completa dos 3 CSS/HTML. Todas corrigidas:

- **Nav**: convertido de `flex-wrap` para `grid repeat(9, 1fr)` — botões sempre com largura uniforme, idêntico à Copa
- **Topbar responsivo**: adicionados breakpoints `@media ≥901px` e `≤900px` — topbar vira grade de 2 linhas (brand+switcher em cima, nav em baixo) igual à Copa
- **Card**: `border-radius 16px → 18px`, `padding 18px 20px → 18px`, `margin-bottom 16px → 14px`, adicionado `box-shadow 0 8px 32px rgba(0,0,0,.22)`
- **Countdown**: `.count-card` ganhou `background var(--bg3)`, `border`, `border-radius 16px`, `padding 16px`; `.count-grid` virou `grid repeat(4, 1fr)`; células `background var(--bg)`, `border-radius 12px`; números agora em `color: var(--green)`, `font-size 26px`
- **Brand gap**: `6px → 8px`
- **Footer**: `margin-top 32px`, `opacity .6`, `border-top var(--border2)`, `user-select none`, links com hover
- **Focus ring**: adicionado `button/input/select:focus-visible` (acessibilidade)
- **Mobile `≤500px`**: `count-grid` vira 2 colunas no celular

`audit_scoring.py`: 5/5.

---

## v1.8 — 2026-07-11

### Fixed
- **Auto-sync não apaga mais o formulário**: setInterval de 30s agora verifica `document.hidden || _editingEntry` antes de chamar `renderAll()` — usuário preenchendo palpites não perde os dados no meio
- **Email throttle**: `br2026_emailTs` agora só é gravado no sessionStorage *após* o `await emailjs.send()` ter sucesso (com try/catch). Antes, falha de rede consumia o throttle silenciosamente.
- **Flash de seção errada**: `<section id="entry">` não tem mais `class="active"` no HTML — o Ranking abre instantaneamente (prazo já encerrado) sem flash do form de palpites
- **iOS Safari — switcher**: `appearance: none; -webkit-appearance: none` adicionados — pill estilizado funciona no iPhone agora

## v1.7 — 2026-07-11

### Changed
- **Jogos — layout centralizado**: card de partida agora exibe `Nome | Bandeira | Score | Bandeira | Nome` em fileira única centrada — nada para a esquerda ou direita. Linha `.game-meta` (status/partida/venue) também centralizada

## v1.6 — 2026-07-11

### Added
- **Dropdown bolão-switcher**: header agora tem `<select>` para navegar entre Copa do Mundo, Brasileirão 2026 e Copa do Brasil 2026 sem voltar para a página principal

### Changed
- **Jogos — novo layout de partidas**: cards de jogo agora usam CSS Grid `1fr auto 1fr` com logos ESPN em cada lado — times nunca quebram linha no mobile ou no desktop. Nomes longos ficam truncados com reticências. Venue/status/número da partida consolidados numa única linha `.game-meta` abaixo do placar
- **Ranking — tiebreaker Z→A**: quando tudo mais empata, a ordenação de exibição agora é Z→A (igual à Copa v4.105) em vez de A→Z — sem mudança de posição/medalha
- **Seção padrão = Ranking**: `init()` abre direto no Ranking quando o prazo já passou (`isPastCutoff()`), em vez de sempre abrir Palpites
- **document.hidden guard**: ticker de 1s (`renderLiveCard` / `renderNextGameCard`) agora pula quando a aba está em background — elimina setInterval desnecessário
- **mergeStates `preferRemoteResults`**: `loadRemoteState()` agora passa `{ preferRemoteResults: true }` para que resultados do Supabase sempre sobrescrevam o cache local ao sincronizar (equivalente ao Copa v4.108)
- **Auto-sync 30s**: quando `database.enabled: true`, sincroniza com Supabase a cada 30s automaticamente

## v1.5 — 2026-07-02

### Added / Changed
- **Dixon-Coles IPF**: estimação de ataque/defesa por Iterative Proportional Fitting (50 iterações, decaimento exponencial de 10 jogos) — substitui médias simples de gols
- **Dixon-Coles ρ correction** (ρ=−0.13): ajuste de probabilidades em placar 0-0/1-0/0-1/1-1 aplicado ao `matchProb`
- **expectedGoals dual-mode**: modo IPF quando há dados suficientes; fallback com LG_AVG no início de temporada
- **Hero card — barras de prob pré-jogo**: jogos agendados do dia e card do próximo jogo mostram barras visuais de probabilidade com logos
- **Jogos — "Partida N"**: número sequencial em cada card de jogo; logo agora aparece após o nome do time

## v1.4 — 2026-07-02

### Added
- **Logos ESPN nos jogos**: escudos dos clubes carregados da API ESPN (CSP atualizada para `https://a.espncdn.com`)
- **Jogos de hoje**: card do próximo jogo substituído por lista de todos os jogos do dia atual — jogos ao vivo destacados, encerrados em cinza, próximos com countdown
- **Auto-scroll Jogos**: ao clicar na aba Jogos, a lista rola até o próximo jogo agendado
- **Título corrigido**: browser tab agora mostra "Bolão do Ferrari — Brasileirão 2026"

### Changed
- **Barras de probabilidade pré-jogo**: Jogos agendados mostram barras visuais coloridas com nome dos times (substituiu texto "Casa X% · Emp Y% · Fora Z%")
- **Nav buttons**: estilo igual ao da Copa (fundo sólido, verde no ativo)
- **Botão Recalcular**: aparece mesmo durante "Calculando..." para permitir retry
- **Monte Carlo GD corrigido**: GD agora determinado pelos gols amostrados `hg/ag` (não por comparação independente com `pH`) — resultados estatisticamente coerentes
- **buildRatings cacheado**: recalculado só quando standings atualizam, não a cada segundo

### Fixed
- **Monte Carlo fim de temporada**: quando não há jogos restantes, retorna classificação final determinística (100%/0%) em vez de estado "Calculando..." permanente
- **prob-bar-mini px→%**: barras na tabela de probabilidades agora escalam corretamente (era `width:${n}px`, correto é `width:${n}%`)
- **buildRatings floor**: ataque/defesa mínimo de 0.3× para evitar P(Emp)=100% em times com `gf=0`
- **matchProb normalizado**: probabilidades somam exatamente 100%
- **ARIA**: `scope="col"` nos th, `aria-hidden="true"` nas barras decorativas, `role="group"` nas prob-bars
- **scheduleMC debounce**: `_mcTs` atualizado antes do setTimeout para evitar enfileiramento duplo

## v1.3 — 2026-07-02

### New features
- **Probabilidades tab**: new nav section with Poisson + Monte Carlo (2 000 simulations) championship probability table — P(G4) / P(Sul-Am.) / P(Rebaixado) per team, sorted by G4 probability, with color-coded mini bars and a Recalcular button
- **In-play probability bars**: when a match is live the card now shows animated win/draw/loss probability bars computed from in-play Poisson adjusted for time remaining and current scoreline
- **Per-match probability hints**: upcoming (pre) games in the Jogos section now show "Casa X% · Emp Y% · Fora Z%" hint lines derived from the same Poisson model
- **Poisson model**: `buildRatings()` / `expectedGoals()` / `matchProb()` / `inPlayProb()` / `runMonteCarlo()` — all pure vanilla JS, no external libraries
- **fetchStandings() extended**: now also parses `gamesPlayed`, `pointsFor`, `pointsAgainst` from ESPN stats array (needed for attack/defence ratings)
- **Match prob cache**: `_matchProbs` object caches per-fixture win/draw/loss probs; cleared on each standings poll so ratings stay fresh

## v1.2 — 2026-07-02

### Bug fixes (post mega-audit)
- **fix(timezone)**: remove `toBRT()` manual UTC-3 offset arithmetic; replace with `{ timeZone: "America/Sao_Paulo" }` in all `toLocale*` calls — was showing wrong times for users outside Brazil
- **fix(tiebreaker)**: `renderRanking()` now uses officially locked G4/Z4 results for tiebreakers when `results.locked === true`, instead of live ESPN standings that may differ
- **fix(live-overlay)**: `pollAll()` now updates ALL scoreboard matches (including post-game) in `_schedule` cache, preventing finished games from staying "Ao vivo" until TTL expires
- **fix(admin-validation)**: `saveResultsBtn` now validates SA6 ↔ G4 and SA6 ↔ Z4 overlap, preventing double-scoring for a team appearing in two zones
- **fix(emailjs-throttle)**: `sendReceipt()` now honours `C.emailjs.limitRateMs` (30s) via sessionStorage — the config value was defined but never enforced
- **fix(cache-key)**: schedule sessionStorage key is now versioned (`br2026_schedule_v1.2`) to prevent stale schema reads after version bumps
- **fix(a11y)**: removed `aria-live="polite"` from countdown div — was causing screen readers to announce every second tick

## v1.1 — 2026-07-02

### New features
- **Sul-Americana picks**: 6 team dropdowns (positions 7–12), 8 pts per correct pick — mutual exclusion with G4/Z4
- **Jogos calendar**: full 382-game Brasileirão schedule from ESPN, grouped by BRT date with venue/city; live games overlay real-time scores
- **Next game card**: countdown to next scheduled game with venue; shows live score if a match is in progress
- **Tiebreakers**: SA6 hits → G4 exact positions → Z4 exact positions
- **Standings SA zone**: rows 7–12 highlighted in amber with SA badge
- **Language**: removed es and en-US — BR2026 is pt-BR only
- **Admin results**: 3-column grid (G4 / Sul-Am. / Z4), ESPN auto-fill covers all zones
- **Rules**: updated scoring table (max 176 pts) with tiebreaker list

## v1.0 — 2026-07-02

### Initial release
- G4 (top 4, in order) + Z4 (bottom 4, in order) picks
- 8 dropdowns with mutual-exclusion validation (no team can appear twice or in both G4/Z4)
- Provisional scoring from live ESPN standings throughout the season
- Standings card with ESPN Brasileirão (bra.1) live table — polls every 60s
- Live match card when a Brasileirão match is in progress
- Admin: lock official result at season end, or fill from current ESPN standings
- Admin: payment tracking, entry edit/delete, CSV export
- Email receipt on save (EmailJS, same templates as Copa bolão)
- 3-language support: pt-BR, es, en-US
- Supabase integration ready (set `database.enabled: true` after creating row `id='br2026'`)
- Not published yet (no link from main site)
