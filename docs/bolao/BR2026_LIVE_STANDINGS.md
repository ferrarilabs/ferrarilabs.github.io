# BR2026 — Classificação ao vivo e movimento de ranking

Introduzido em 2026-07-13 (v1.23). Escopo: `bolao/br2026/` apenas. Não altera scoring da Copa,
scoring do CDB2026, ou regras do Brasileirão.

## Por que dois cálculos separados

Existem dois conceitos visualmente parecidos mas **calculados, armazenados e rotulados de forma
totalmente independente**:

| | Movimento de clube (tabela do Brasileirão) | Movimento de participante (ranking do bolão) |
|---|---|---|
| Pergunta que responde | "O time subiu ou caiu na tabela real?" | "O participante subiu ou caiu no ranking do bolão?" |
| Função pura | `calculateLiveStandings()` | `calculateRankingMovement()` |
| Chave de estado | `sessionStorage["bolao_br2026_standings_baseline_v1"]` | nenhuma — recalculado a cada chamada |
| Markup / classes | `standingsMovementHtml()` → `.movement` na tabela `#standingsCard` | `rankMovementHtml()` → `.movement` em `.rank-row .rank-pos` |
| Chaves i18n | `standingsMovement*` | `rankMovement*` |

As duas funções nunca chamam uma à outra e nunca compartilham uma estrutura de estado — apenas a
matéria-prima (o snapshot ESPN congelado, `_standingsBaseline.standings`) é reaproveitada como
insumo de ambas, porque a posição de um participante depende da posição real dos clubes que ele
escolheu. Reaproveitar o dado bruto não é o mesmo que misturar o cálculo.

## Baseline (posição anterior)

Sem um identificador de rodada na API da ESPN usada por este app (`site.api.espn.com`, sem campo
`round`/`matchday`), a definição de baseline usada é uma janela de partidas ao vivo, na ordem de
prioridade realmente disponível nos dados:

1. **Preferencial**: última classificação oficial (`_standings`, 20 times completos) conhecida
   imediatamente **antes** da contagem de partidas ao vivo transicionar de 0 para >0. Congelada em
   `_standingsBaseline` no momento exato dessa transição — nunca atualizada a cada gol, nunca
   recalculada a cada poll.
2. **Se a aba for recarregada no meio de uma janela já aberta**: o snapshot persistido em
   `sessionStorage` é reaproveitado (chave `bolao_br2026_standings_baseline_v1`) — não é
   recriado a partir da classificação atual (que já teria efeitos da janela em andamento), então
   o movimento continua correto após um F5.
3. **Se não existir nenhum snapshot confiável** (ex.: a aba foi aberta pela primeira vez já com uma
   partida em andamento, sem nenhum poll anterior com 0 jogos ao vivo) — a baseline permanece nula
   e a UI mostra explicitamente "indisponível" (`.movement-unavailable`), em vez de inventar uma
   posição anterior.

A janela se encerra (baseline é descartada) quando a contagem de partidas ao vivo volta a 0. A
próxima janela recomeça do zero com a classificação então vigente.

**Limitação documentada**: como a API não expõe rodada/matchday, essa janela é uma aproximação —
se duas partidas da mesma rodada começam em horários bem espaçados e a contagem de jogos ao vivo
chega a cair para 0 entre elas, uma nova baseline pode ser aberta no meio da rodada. Isso é uma
limitação conhecida dos dados disponíveis, não um bug silencioso — está documentada aqui e no
relatório de entrega da mudança.

## Fórmula de movimento

```
movement = previousPosition - livePosition
```

Positivo = subiu. Negativo = caiu. Zero = permaneceu. A mesma fórmula vale para clube
(`previousPosition`/`livePosition`) e para participante (`previousRank`/`rank`, no output de
`calculateRankingMovement`).

## Critérios de classificação (desempate)

`calculateLiveStandings()` reordena os times a cada partida da janela usando, por padrão,
`["points", "goalDifference"]`. Esses são exatamente os dois critérios já usados em outro lugar
deste mesmo app (`runMonteCarlo()`'s comparador de simulação) — **não foi inventado nenhum
critério novo**. Um terceiro critério opcional (`goalsFor`) existe na função mas não é usado pelo
pipeline ao vivo por padrão, porque não há nenhuma implementação anterior no código que o use como
critério de desempate real (só o `goalsFor` do array `tieBreakRules` explícito, para quem quiser
testá-lo).

**Limitação documentada**: o app não implementa a cadeia completa de desempate oficial da CBF
(confronto direto, cartões, sorteio, etc.) em nenhum lugar — nem na tabela oficial (que apenas
reflete a ordem já resolvida pela ESPN), nem aqui. Quando `points` e `goalDifference` empatam, a
função preserva a ordem da baseline (determinística, estável) em vez de usar `Math.random()` (que
existe em `runMonteCarlo()`, mas ali é ruído intencional de simulação, não uma regra de
classificação, e usá-lo aqui produziria uma ordem diferente a cada render).

## Ranking dos participantes

`calculateRankingMovement({ entries, baseline, live })` usa o padrão **stateless**
(oficial-vs-provisório recomputado do zero a cada chamada) — o mesmo padrão já comprovado correto
em `liveMatchPointsTable()` da Copa (`bolao/js/app.js`), e **não** o outro padrão da Copa,
`computeRankArrows()`/`_rankArrowState`, cujo baseline é "o último render" (um `Map` em memória de
sessão que reseta ao recarregar a página) — o que viola o requisito de baseline estável. Eduardo
confirmou explicitamente divergir do padrão com falha e usar o correto no BR2026.

`baseline`/`live` são conjuntos de resultado (`{g4, z4, sa6}` — nomes de times por posição), não
snapshots de ranking prontos: ambos passam pela mesma função `rankEntries()` usada pelo ranking
exibido normalmente, garantindo que baseline-rank e live-rank nunca possam divergir da pontuação
realmente mostrada na tela (essa era exatamente a classe de bug do CHANGELOG v4.57 da Copa — duas
implementações do mesmo cálculo que silenciosamente divergem).

**Regra de empate compartilhado**: o ranking já existente do BR2026 usa "número de posição só
avança quando o total muda" (confirmado como comportamento intencional em auditoria anterior, não
um bug). Isso é preservado: sair de um grupo empatado em 1º para um 1º isolado não gera "subiu"
falso, porque o número de posição nominal (1) não mudou. Testado explicitamente (ver `Testes`).

Quando os resultados estão oficialmente travados (`s.results.locked`), não há mais "janela ao
vivo" — o movimento de ranking não é calculado nem exibido.

### `currentResultSet()` — "resultado atual" usa a tabela AO VIVO, não a tabela oficial parada (2026-07-16)

Bug real encontrado em auditoria: `renderRanking()` originalmente montava seu `live: {g4,z4,sa6}`
direto de `_standings` (a tabela oficial da ESPN, que só é reprocessada depois que a ESPN marca a
partida como `"post"` e republica) — nunca de `liveStandingsNow()` (a tabela já ajustada pelo
placar em andamento, existente desde a v1.4x só pro card ao vivo/tabela de classificação). Efeito
prático: durante o jogo inteiro, as setas do Ranking ficavam presas na posição de ANTES do apito
inicial, e só se moviam depois do jogo acabar E a ESPN atualizar — nunca durante a partida, que é
exatamente quando "projeção ao vivo" deveria significar algo.

`currentResultSet()` (em `app.js`, logo após `liveStandingsNow()`) é agora a única fonte de
"resultado atual" usada tanto por `renderRanking()` quanto pelo hero `renderLiveRankingHero()`
(v1.54, abaixo): prefere `liveStandingsNow()` quando há uma janela ao vivo com baseline confiável,
cai pra `_standings` (tabela oficial) fora de uma janela ativa. `rankingBaselineResultSet()`
continua intocada — ela já usava a baseline congelada corretamente, o bug era só do lado "atual".

## Hero "Ranking ao vivo" (v1.54, ajustado v1.55)

Card `#liveRankingHero`, renderizado logo abaixo do card "ao vivo" (`renderLiveRankingHero()`),
mesmo estilo visual da Copa (`hero-live-points`). Não introduz cálculo novo: reaproveita
`calculateRankingMovement()` + `currentResultSet()` + `rankEntries()`. Decide visibilidade:

- escondido sem jogo ao vivo (`_liveMatches.length === 0`);
- escondido sem baseline confiável (mesma regra de `renderLiveCard`'s badges de posição);
- escondido quando ninguém está subindo/descendo no momento (placar ao vivo ainda não cruzou
  nenhuma fronteira G4/SA6/Z4 que afete alguma entrada) — nunca mostra uma tabela parada sem
  nada de interessante. Pedido explícito de Eduardo: "se ficar ruim ou muito busy deixa de fora".

**v1.54 filtrava a lista pra mostrar só quem estava `"up"`/`"down"` (até 8) — corrigido em v1.55**
(Eduardo: "no ranking so aparece da 4 posicao para baixo, tem que aparecer todos, pode scrolar
mas deixa pelo menos 4-5 no topo"): o filtro escondia entradas paradas no topo, dando a impressão
de que a lista começava do meio da classificação. Agora mostra TODAS as entradas, ordenadas por
posição, dentro de `.live-ranking-scroll` (`max-height` de ~4-5 linhas, `overflow-y: auto`,
cabeçalho `position: sticky`) — a condição "esconder o card inteiro sem nenhum mover" continua
igual, só a lista DENTRO do card deixou de ser filtrada.

## Identificação de partidas

`pollAll()` casa eventos da ESPN com o cache `_schedule` pelo `id` estável do evento
(`ev.id`, já presente nos dois endpoints ESPN usados) como critério primário; a comparação por
nome de time (usada exclusivamente antes desta mudança) permanece como *fallback* defensivo para
linhas que o id ainda não alcançou.

Apenas partidas cujo estado é `"in"` (ao vivo) ou `"post"` sem a flag `postponed` entram no
cálculo — a flag `postponed` (já computada em `fetchSchedule()`, mas até então não usada em
lugar nenhum) agora é checada dentro de `calculateLiveStandings()` para excluir defensivamente
qualquer partida adiada/cancelada que por algum motivo chegue nos argumentos da função.

## Rede / polling

Reaproveita o `pollAll()` existente — não há um segundo loop. Mudanças:

- todo `fetch()` do BR2026 passa por `fetchJson()`, que aplica `AbortController` com timeout de
  10s;
- `pollAll()` nunca sobrepõe: se um poll ainda está em andamento (`_pollInFlight`), o próximo é
  ignorado, não enfileirado;
- `pollAll()` não faz nenhum trabalho de rede quando `document.hidden` é verdadeiro;
- o loop de repetição trocou de `setInterval` fixo para um `setTimeout` que se
  reagenda (`schedulePoll()`), com backoff (até 4× o intervalo normal) quando ambos os fetches do
  poll falham, resetando ao normal no primeiro sucesso;
- ao voltar o foco da aba (`visibilitychange`), um poll imediato é disparado em vez de esperar o
  resto do intervalo pausado.

## Estado / snapshots

- `sessionStorage["bolao_br2026_standings_baseline_v1"]`: `{ capturedAt, standings: [...] }` — só
  isso. Nunca entra no `state()` principal (`bolao_br2026_state`), nunca é sincronizado com o
  Supabase, nunca é exportado no CSV. É puramente derivado/efêmero — pode ser apagado a qualquer
  momento sem perda de dado real (o próximo poll durante uma janela ativa recria uma baseline
  válida, ou marca "indisponível" até a próxima janela).
- Ranking de participantes não tem snapshot algum — é recomputado inteiramente a cada
  `renderRanking()`, por design (ver seção acima).

## Mobile

Na tabela (`#standingsCard`), as colunas `#`, `Mov.`, `Time` e `Pts` usam `position: sticky` com
offsets fixos (`left: 0 / 32px / 72px / 200px` em telas ≤899px; `200px→292px` acima de 900px, onde
o nome do time ganha mais largura) — essas quatro colunas nunca saem de vista, mesmo com
`overflow-x: auto` rolando as colunas secundárias (J/V/E/D/GP/GC/SG). Nomes de time truncam com
reticências (`.td-team-name`, `title` com o nome completo) para que a largura da coluna — e,
portanto, o offset sticky das colunas seguintes — seja previsível.

No ranking (`.rank-row`), o glifo de movimento fica abaixo do número/medalha dentro da mesma
célula de 48px (`.rank-pos` vira flex-column), não ao lado — evita empurrar o nome do participante
para fora da tela em 320px.

## Acessibilidade

Nenhuma seta é só glifo. Cada `.movement` carrega um `<span class="visually-hidden">` com o texto
completo (ex. "Subiu 3 posições, de 5º para 2º") mais um `title` com o mesmo texto — a cor nunca é
o único portador da informação. `prefers-reduced-motion: no-preference` liga uma transição de cor
suave; quem prefere menos movimento não recebe nenhuma animação.

## Testes

Cobertura executada nesta entrega (Playwright, ver `docs/bolao/QA_MASTER_CHECKLIST.md` para o
resultado consolidado):

- 17 testes puros de `calculateLiveStandings` / `zoneForPosition` (vitória vira ultrapassagem,
  derrota vira queda, sem partidas → sem movimento, troca de posição, empate de 3 vias, fallback
  determinístico sem inventar critério, desempate por saldo, desempate opcional por gols pró,
  determinismo entre chamadas repetidas, `postponed` ignorado, jogo duplicado não é deduplicado
  internamente — contrato do chamador, time desconhecido não derruba o cálculo, baseline vazia
  retorna `null`, pureza/imutabilidade dos argumentos, limites de zona).
- 10 testes puros de `rankEntries` / `calculateRankingMovement` (sobe/cai com ranks distintos,
  participante não afetado permanece, regra de empate compartilhado não gera subida falsa, mesmo
  conjunto baseline/live → "same", empate total resolvido deterministicamente por nome, sem
  baseline → "unavailable" nunca fabricado, lista vazia, entrada única, mesmo comparador usado em
  todo lugar).
- 9 testes de integração ponta a ponta (mock das respostas da ESPN): tabela em ordem oficial e
  movimento indisponível antes de qualquer partida ao vivo; tabela **reordenada** por posição ao
  vivo quando a janela abre, com seta de subida visível na linha certa; disclaimer exibido;
  ranking do bolão mostra o glifo de movimento; ao fechar a janela, a baseline é apagada do
  `sessionStorage` e o movimento volta a "indisponível" (sem seta obsoleta ficando presa).

Não foram escritos testes E2E cobrindo duas abas simultâneas nem interrupção de rede real (fora do
escopo razoável de um teste automatizado neste ambiente) — analisados por revisão de código:
`_pollInFlight` evita sobreposição dentro de uma aba; entre abas, cada uma mantém seu próprio
`sessionStorage` (não compartilhado), então cada aba calcula sua própria baseline de forma
independente e consistente consigo mesma — não há corrida de dados compartilhados porque não há
estado compartilhado entre abas.

## O que NÃO foi alterado

- Pontuação da Copa do Mundo 2026 (`bolao/js/config.js`, `audit_scoring.py` — reexecutado, 5/5
  passou).
- Pontuação do CDB2026 (`bolao/cdb2026/js/config.js`).
- Regras oficiais do Brasileirão (pontos por vitória/empate, zonas G4/SA/Z4) — inalteradas.
- O padrão de setas de ranking já existente na Copa (`computeRankArrows`/`_rankArrowState`) —
  identificado como tecnicamente imperfeito nesta auditoria, mas fora de escopo desta mudança;
  registrado como dívida técnica conhecida, não corrigido aqui.

## v1.56 — relógio, hero de ranking, ponto sobrando (2026-07-16)

- **Relógio ao vivo mudando de formato quando pausado** (screenshot de Eduardo: "51'" vs
  "52:24") — `liveClockDisplay()` preferia a string crua da ESPN (`m.clockStr`, só minuto) ao
  pausar, e o formato calculado "MM:SS" (`formatMatchClock()`) ao rodar. Corrigido pra sempre
  passar por `formatMatchClock()` quando `clockSeconds` existe — pausado só significa não somar
  o tempo decorrido desde o último poll. Mesmo bug/fix propagado ao CDB2026 (código idêntico).
- **Hero "Ranking ao vivo" com `max-width: 420px`** deixava um vão enorme dos dois lados em
  telas largas (mobile já batia em 100% do card). Subiu pra 760px + fonte/padding maiores.
- **Pontos do Ranking normal** (não o hero) deixaram de ficar amarelos com "↕" quando
  provisórios — nem Copa nem CDB2026 faziam isso; removido pra igualar.
- **Número de posição sem ponto sobrando** ("4." → "4") — mesmo ajuste na Copa e no CDB2026.

Ver `docs/bolao/CONSISTENCY_MATRIX.md` (nota de 2026-07-16, "PRECISAMOS SER CONSISTENTES!") pro
contexto completo desta rodada, incluindo o CDB2026 sendo trazido ao mesmo padrão do card ao
vivo.
