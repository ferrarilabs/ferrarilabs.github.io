# ADR-003 — Resultado oficial vs. provisório/ao vivo

**Status:** Aceito (documenta o comportamento existente, confirmado correto pela auditoria de
2026-08 — não é uma mudança).
**Data:** 2026-08.
**Aplica-se a:** `bolao/cdb2026/` (mecanismo específico; BR2026 tem seu próprio modelo de
projeção documentado em `BR2026_PROJECTION_MODEL.md`, não idêntico).

## Contexto

CDB2026 mostra dois tipos de pontuação em momentos diferentes:
1. **Oficial** (`scoreEntry()`, `app.js:827`) — usa `tie.matches[leg].goalsHome/goalsAway` e
   `tie.qualifiedTeamId`, campos que só existem quando um admin (ou a sincronização automática
   da ESPN) os grava como resultado definitivo.
2. **Ao vivo** (`liveScoreEntry()`, `app.js:2106`) — usa `_liveTies` (dados de polling da ESPN a
   cada 60s, nunca persistidos como resultado oficial) para mostrar uma pontuação estimada
   enquanto o jogo está em andamento.

## Decisão

`liveScoreEntry()` **nunca** adiciona o bônus de pódio (campeão/vice), mesmo que o placar ao
vivo da Final sugira um vencedor — só o resultado oficial (`tie.qualifiedTeamId` gravado) libera
esse bônus. Verificado por teste dedicado em `audit_golden_master.mjs`: "live scoring never adds
a podium bonus".

Um resultado só se torna "oficial" por dois caminhos:
- **Admin manual**, em `renderAdminResultsForTie()`/`renderAdminResults()` — o admin digita o
  placar e, se o agregado empatar, escolhe manualmente quem avançou (pênaltis).
- **Automático via ESPN**, em `autoSyncEspnResults()` — quando a ESPN reporta `state === "post"`
  (jogo encerrado) e o campo `winner` de um dos competidores, o sistema pode travar
  `qualifiedTeamId` sozinho, sem clique do admin (ver `espnSyncAutoDisclaimer` em `i18n.js` —
  texto corrigido nesta modernização para descrever esse comportamento com precisão, ver
  `CDB2026_MODERNIZATION_REPORT_2026-08.md`).

## Por que isso importa

Dinheiro real é pago com base no resultado OFICIAL, nunca no ao vivo. Se `liveScoreEntry()`
alguma vez desse bônus de pódio a partir de um placar ainda não confirmado, um jogo com VAR,
prorrogação ou pênaltis em andamento poderia mostrar um "campeão" que muda de time minuto a
minuto — e pior, se esse valor fosse usado para qualquer decisão de pagamento (não é, mas o
risco de um caminho de código futuro confundir os dois é real), pagaria a pessoa errada.

## Consequências

- A tela ao vivo é claramente uma prévia — pontos por partida podem aparecer, pontos de pódio
  nunca aparecem até a Final ser oficialmente resolvida.
- Um jogo adiado/cancelado (`postponed`, ver `AUDIT-06` no `CDB2026_CODE_AUDIT_2026-08.md`) nunca
  vira resultado oficial por engano — a guarda `!postponed` em `fetchEspnCandidates()` impede que
  um placar "0-0" fantasma de um jogo adiado seja gravado como FINAL.
- Esta ADR não muda nenhum comportamento — documenta uma garantia já existente e testada, para
  que uma futura mudança na área de scoring saiba que esse invariante precisa ser preservado.
