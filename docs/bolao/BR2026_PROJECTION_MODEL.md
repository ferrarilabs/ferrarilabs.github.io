# BR2026 — Modelo de Projeção do Bolão

Este documento explica a diferença entre **ranking oficial** e **ranking projetado** no
Brasileirão 2026 (`bolao/br2026/`), a fórmula usada em cada um, o índice de precisão informativo,
o mecanismo de movimento, as limitações conhecidas, os estados tratados e a linguagem obrigatória
na UI. Criado em 2026-07-14 a pedido do Eduardo, depois de uma auditoria confirmando que o motor
de cálculo (`getActiveScore`, `calculateRankingMovement`) já existia de sessões anteriores — este
documento formaliza o que já estava implementado e adiciona o índice de precisão que faltava.

## Ranking oficial vs. ranking projetado

- **Ranking oficial**: existe só depois que o admin trava o resultado final
  (`s.results.locked = true`, com `s.results.g4`/`z4`/`sa6` preenchidos manualmente na aba
  Admin → Resultados, depois do Brasileirão acabar de verdade). A partir daí, `getActiveScore()`
  retorna `{ ...scoreEntry(...), isOfficial: true }` e a pontuação exibida é definitiva — o
  disclaimer de projeção some da UI (ver `renderPickDisplay()`).
- **Ranking projetado**: enquanto `s.results.locked` não é `true`, `getActiveScore()` calcula a
  pontuação usando a classificação **atual** do Brasileirão (via ESPN, `_standings`) no lugar da
  classificação final — G4 = 4 primeiros colocados, SA6 = posições 7-12, Z4 = 4 últimos. Isso é
  literalmente "se o Brasileirão terminasse hoje".

## Fórmula (uma só, nunca duplicada)

**A fórmula oficial de pontuação (`scoreEntry()`, `bolao/br2026/js/app.js`) é usada nos dois
casos, sem exceção** — a única coisa que muda é qual conjunto de nomes de time (`g4Result`/
`z4Result`/`sa6Result`) é passado pra ela: o resultado final travado, ou a tabela ao vivo. Isso
elimina por construção o risco de "duas fórmulas de ranking que podem divergir" — não existe uma
fórmula paralela de projeção, `getActiveScore()` só escolhe a ENTRADA certa pra fórmula real.

```js
function getActiveScore(entry, s) {
  if (s.results?.locked && s.results?.g4 && s.results?.z4) {
    return { ...scoreEntry(entry, s.results.g4, s.results.z4, s.results.sa6), isOfficial: true };
  }
  if (_standings.length >= 20) {
    const g4  = _standings.slice(0,  4).map(tm => tm.name);
    const z4  = _standings.slice(16, 20).map(tm => tm.name);
    const sa6 = _standings.slice(6,  12).map(tm => tm.name);
    return { ...scoreEntry(entry, g4, z4, sa6), isOfficial: false };
  }
  return null;
}
```

`rankEntries()` (usada tanto para o ranking quanto para o movimento) já recebe esses mesmos três
arrays como parâmetro — a mesma ordenação/desempate vale para o ranking oficial e o projetado, sem
lógica separada por caminho.

## Movimento (rodada a rodada)

`calculateRankingMovement({ entries, baseline, live })` compara a posição RANQUEADA (não o
`_standings` bruto) do participante contra um snapshot anterior (`baseline`), retornando
`{ rank, previousRank, movement, status }` por participante. Sem baseline confiável (ex.: página
carregada no meio de uma janela ao vivo), `status: "unavailable"` — nunca inventa um movimento.

**Limitação conhecida, documentada desde antes deste patch** (`docs/bolao/BR2026_LIVE_STANDINGS.md`):
a API da ESPN usada por este app não tem campo de rodada/matchday. O `baseline` aqui é uma janela
de partidas ao vivo (`_standingsBaseline`), não um "snapshot da rodada anterior" no sentido literal
do pedido original. Reaproveitar esse mecanismo já existente e correto é a decisão certa — inventar
um número de rodada que a fonte de dados não tem seria pior que não ter rodada nenhuma.

## Índice de precisão (`accuracyMetrics()`) — só informativo

**Nunca usado em ranking, ordenação, desempate ou pontuação.** Mede o quão perto o palpite
original está da tabela atual, posição a posição, como um número extra pro participante ver — não
decide nada.

- **G4/Z4** (times com posição própria: 1-4 e 17-20): distância = `|slot palpitado − posição real
  do time dentro do mesmo grupo hoje|`. 0 = acertou a posição exata. Se o time não está mais no
  grupo, a distância é o tamanho do grupo (pior caso, "fora do grupo").
- **SA6** (conjunto de 6 times sem posição própria — meio de tabela, posições 7-12): só
  acerto/erro binário, não tem "distância" própria (não existe ordem dentro do miolo classificado).
- **`accuracyIndex`**: média entre a precisão posicional normalizada (`1 − distância total /
  distância máxima possível`) e a taxa de acerto do SA6, quando ambos existirem. `null` quando não
  há nenhum palpite comparável ainda (nunca fabrica um número).
- Métricas auxiliares retornadas: `exactPositions`, `onePositionAway`, `twoPositionsAway`,
  `totalPositionDistance`, `averageDeviation`, `largestDeviation`.

## UI e linguagem obrigatória

- Título da seção: **"Projeção do Bolão"** (`rankingTitle`).
- Subtítulo: **"Se o Brasileirão terminasse hoje"** (`rankingSubtitle`).
- Disclaimer visível: **"Esta classificação é uma projeção baseada na tabela atual do
  Brasileirão. A pontuação oficial e os vencedores serão definidos somente após o encerramento da
  competição."** (`projectionDisclaimer`).
- Nunca usar: "pontuação final", "campeão atual", "resultado definitivo" pra descrever o estado
  projetado. Sempre usar: "pontuação projetada", "posição projetada", "líder provisório", "se
  terminasse hoje".
- Ao expandir "Ver palpites" de uma entrada (`renderPickDisplay()`), enquanto não oficial: mostra
  `accuracyIndexLabel`/`accuracyExactLabel` + tabela "Maiores divergências" (até 5, ordenadas por
  distância decrescente) com time, posição palpitada e posição atual real.
- Uma vez `isOfficial: true`, a seção de precisão/divergências some (não faz mais sentido —
  pontuação já é definitiva).

## Estados tratados

| Estado | Comportamento |
|---|---|
| Campeonato ainda não iniciado / sem standings | `getActiveScore()` retorna `null`; ranking mostra placeholder existente |
| Classificação incompleta (< 20 times com rank) | Mesma coisa — `_standings.length >= 20` é o guard já existente |
| Rodada em andamento (polling ao vivo) | Projeção recalcula a cada ciclo de poll (60s) |
| Rodada encerrada | Sem mudança de comportamento — a tabela ESPN em si já reflete o resultado |
| API offline | `_standings` fica com o último valor bom conhecido (poll falha silenciosamente, sem apagar dado) |
| Participante sem palpite em algum grupo | `accuracyMetrics()` ignora slots vazios, nunca fabrica distância |
| Empate no ranking | Mesmo desempate cascata de `rankEntries()`, oficial e projetado |
| Novo participante sem baseline | `calculateRankingMovement()` retorna `status: "unavailable"` pra ele |
| Resultado oficial travado pelo admin | `isOfficial: true` — disclaimer/precisão somem, pontuação vira definitiva |

## Limitações

1. Baseline de movimento é por janela ao vivo, não por número de rodada literal (ESPN não fornece
   esse campo — ver acima).
2. `accuracyIndex` não tem significado fora do contexto interno do app — não é uma métrica
   padronizada da indústria, é só uma forma de dar feedback extra ao participante.
3. SA6 não tem conceito de "posição" própria — o índice trata isso como binário por design, não
   por limitação técnica.

## Testes

`test_br2026_projection.js` (scratchpad, roda via `node test_br2026_projection.js` com o servidor
local em `:8080`): linguagem da UI (título/subtítulo/disclaimer), `accuracyMetrics()` via
`window.__BR2026_TESTHOOKS__.accuracyMetrics` — palpite idêntico (100%), posições trocadas em par
(distância 1 uniforme), palpite totalmente invertido (baixa precisão), time fora do grupo
(distância máxima), SA6 parcial (acerto binário), sem palpite nenhum (`null`, nunca fabricado),
sem classificação carregada (`null`, nunca fabricado), e confirmação de que `rankEntries()` nunca
expõe `accuracyIndex` no objeto de ranking (nunca poderia afetar ordenação por acidente).
