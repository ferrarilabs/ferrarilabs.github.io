# CDB2026 — ciclo de vida do sorteio e invariante de confronto fantasma

**Criado:** 2026-08-07 (hotfix v3.99)
**Suíte:** `bolao/cdb2026/scripts/audit_draw_lifecycle.mjs` (13 checks)

## O invariante

> Enquanto uma fase com sorteio não tiver **sorteio oficial**, `phases[fase].ties` **deve** estar
> vazio. Qualquer confronto ali é fantasma por definição.

Hoje a única fase com gate é `quartas` (`DRAW_GATED_PHASES` em `js/app.js`).

Semifinal e Final **não** entram: elas não têm sorteio. Resolvem deterministicamente a partir dos
vencedores da fase anterior (Batch 4). Há **um** sorteio na Copa do Brasil a partir daqui — o das
quartas. Não existe sorteio de semifinal nem de final.

## Ciclo de vida

```
WAITING_FOR_QUARTERFINAL_DRAW      <- estado atual (quartas.ties = {}, cutoffAt = null)
  -> QUARTERFINAL_DRAW_SCHEDULED
  -> contagem regressiva
  -> sorteio oficial publicado pela CBF
  -> ingestão
  -> validação de proveniência
  -> bracket das quartas travado
  -> palpites/resultados das quartas
  -> semifinal resolvida pelos vencedores das quartas (sem sorteio)
  -> palpites/resultados da semifinal
  -> final resolvida pelos vencedores da semifinal (sem sorteio)
  -> palpites/resultados da final
```

`ENTRY_ROSTER_FROZEN = true` permanentemente. `PICKS_OPEN != REGISTRATION_OPEN`. Os `ENTRY_ID`
existentes seguem por todo o torneio — ver `docs/bolao/CONSISTENCY_MATRIX.md`.

## Quando o sorteio conta como oficial

`phaseDrawIsOfficial(phase)` aceita duas formas, nesta ordem:

1. **`phase.officialDraw.validatedAt`** — proveniência explícita. Campo novo e aditivo, destinado à
   ingestão validada da fonte oficial da CBF (Batch 2/3). É o caminho preferido.
2. **`phase.cutoffAt !== null`** — o admin registrou a fase deliberadamente. Mantido porque é o
   fluxo manual que já existe hoje; sem ele o sanitizador apagaria o sorteio real no instante em que
   fosse cadastrado.

## Onde o invariante é aplicado (quatro chokepoints)

| Ponto | Função | Protege contra |
|---|---|---|
| Leitura / render | `state()` | cache contaminado renderizar confronto fabricado |
| Gravação local | `saveState()` | regravar o fantasma no localStorage |
| Merge | `mergeStates()` | **o ponto onde a contaminação sobrevivia** (união sem tombstone) |
| Payload remoto | `saveRemoteState()` | `applyMutationOverRemote` re-contaminar a produção |

Não é só UI. A suíte tem um check que **falha se alguém remover qualquer um dos quatro**.

`add-tie`/`espn-add-tie` numa fase com gate sem sorteio oficial **lança** `QF_DRAW_NOT_OFFICIAL` —
falha explícita, para o admin não achar que salvou algo que o sanitizador apagaria depois.

## Por que isto foi necessário (incidente de 2026-08-07)

Depois do reparo manual da produção, o navegador do Eduardo continuava mostrando "próxima partida
Bahia × Santos". A produção estava **limpa**. O par é **impossível**: o Bahia foi eliminado na
fase-5 (`Bahia × Remo`, `qualified = B`) e não está entre os 16 times das oitavas.

Três causas somadas mantinham o fantasma vivo no cliente:

1. `mergeStates` faz **união** de ties nas duas direções e **ties não têm tombstone** (entradas têm,
   via `deletedIds`). O remoto nunca conseguia apagar um tie só-local.
2. `healPhantomTies()` é **one-shot**; a flag `healedPhantomTies` já era `true` naquele navegador.
3. Mesmo rodando, ele **pula** fases sem lista curada em `DATA.knownConfrontos` — e quartas não tem
   lista porque o sorteio não aconteceu. A fase mais exposta era a que o healer não tocava.

E o caminho de save também unia ties: **um save de admin naquele navegador devolveria os confrontos
sintéticos à produção.** Era risco ativo, não cosmético.

## Recuperação manual de emergência

O sanitizador é **estreito** de propósito. **Não** existe limpeza automática ampla de localStorage
no startup — apagar estado de um app local-first é destrutivo e não deve acontecer sem intenção.

Se um dispositivo estiver em estado inconsistente além do escopo do invariante, no console em
`https://www.ferrarilabs.com`:

```js
localStorage.removeItem("bolao_cdb2026_state");
location.reload();
```

Perde-se apenas o cache local; entradas e resultados voltam do Supabase no próximo load.

## Dívida conhecida (não escondida)

`ties` continuam sem semântica de **tombstone**. O invariante fecha o vetor concreto (fase com
sorteio pendente), mas um tie fantasma numa fase **já oficial** ainda não pode ser apagado pelo
remoto — o merge continua sendo união ali. Tombstone para ties é a correção estrutural e fica como
trabalho separado; não foi feito neste hotfix para manter o patch cirúrgico e reversível.
