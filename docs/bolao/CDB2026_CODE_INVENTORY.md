# CDB2026 — Code Inventory

**Escopo:** `bolao/cdb2026/js/app.js` (139 funções top-level, ~3560 linhas, IIFE única).
**Gerado:** 2026-08, Fase 2 (modernização controlada) — item 11 (§7/§21 do mega-prompt).
**Método:** leitura direta do arquivo real (não gerado por ferramenta de análise estática) —
os cabeçalhos de seção (`// ─── Nome ───`) já existentes no arquivo foram usados como o mapa de
módulos lógicos, porque já refletem a intenção original do autor.

Este inventário é a base para `CDB2026_DATA_DICTIONARY.md` (campos que cada seção lê/escreve),
`CDB2026_REQUIREMENTS_TRACEABILITY_MATRIX.md` (qual função implementa qual requisito) e
`CDB2026_RISK_CONTROL_MATRIX.md` (que funções tocam áreas críticas).

## Como ler esta tabela

- **Área** = agrupamento lógico por cabeçalho de seção real do arquivo (não uma proposta de novos
  arquivos — ver `CDB2026_MODERNIZATION_REPORT_2026-08.md` §7 para a avaliação de separação em
  módulos, que ficou como plano, não implementação).
- **Crítica?** = `SIM` se a função participa de scoring, ranking, pagamento, resultado oficial,
  cutoff ou dado histórico (ver regra "Preserve as áreas críticas" do mega-prompt). Funções
  marcadas `SIM` exigem golden master antes/depois de qualquer alteração.

## Aliases (L12–27)

Atalhos de DOM: `$`, `$$`, `esc` (sanitização HTML — ver nota de segurança abaixo).

## Toast (L29–48)

| Função | Linha | Propósito |
|---|---|---|
| `showToast` | 33 | Notificação transitória (sucesso/erro/aviso) |

## i18n (L50–54)

| `applyI18n` | 52 | Aplica `data-i18n`/`data-i18n-html` do DOM ativo — só `pt-BR` existe (ver nota abaixo) |

## State (L56–116) — **CRÍTICA**

| Função | Linha | Propósito | Crítica? |
|---|---|---|---|
| `emptyPhaseState` | 65 | Estrutura vazia de uma fase | não |
| `emptyState` | 66 | Estado inicial completo | não |
| `state` | 76 | Lê o estado atual (localStorage) | SIM |
| `saveState` | 89 | Persiste local + dispara `saveRemoteState` | SIM |

## Supabase (L118–274) — **CRÍTICA**

| `fetchJson` | 111 | Wrapper fetch com timeout | não |
| `loadRemoteState` | 119 | Lê estado remoto na carga | SIM |
| `reloadRemoteIfVisible` | 137 | Recarrega ao voltar para a aba | SIM |
| `debouncedReload` | 143 | Debounce do polling de visibilidade | não |
| `saveRemoteState` | 156 | **Read-merge-write** para Supabase (AUDIT-03) | SIM |
| `mergeStates` | 194 | Reconciliação local×remoto (AUDIT-01/02) | SIM |
| `sha256hex` | 277 | Hash usado no admin | não (segurança) |

## Admin auth (L276–286) e safety (L287–307) — **CRÍTICA**

| `isAdminActive` / `guardAdmin` | 284/285 | Sessão de 30 min, bloqueio de ação | SIM (segurança) |
| `tripleConfirm` | 296 | Confirma ações destrutivas (exclusão) | SIM |
| `appendAdminAuditLog` | 302 | Grava evento no audit log — ver `ADR-004` para os limites desse log | SIM |

## Sections / Cutoff (L308–406) — **CRÍTICA**

| `showSection` | 309 | Troca de aba visível | não |
| `firstKnownKickoffMs` / `effectivePhaseCutoffMs` | 335/365 | Deriva cutoff efetivo (manual vs. auto por 1º jogo) | SIM |
| `entryCutoffMs` / `isPastEntryCutoff` | 371/376 | Cutoff geral de entrada | SIM |
| `isPhaseLocked` | 380 | Trava edição de palpites por fase | SIM |
| `oitavasComplete` / `phaseFullyResolved` | 397/403 | Progresso de fase | não |

## Receipt code / UUID / Logo / Payment icon (L408–464)

Utilitários puros de exibição — `hashString`, `emailSubjectSafe`, `receiptCode`,
`findEntryByEmailAndCode`, `uuid`, `teamLogoImg`, `payIcon`.

## Phase/tie/match helpers (L465–512) — **CRÍTICA**

| `legsForFormat` | 467 | `TWO_LEG` → `[first,second]` / senão `[single]` | SIM |
| `legTeams` | 479 | Orientação mandante/visitante por perna (AUDIT-05) | SIM |
| `formatBrtTimestamp` | 489 | Timestamp BRT — consolidado Fase 2 §5 (ver `ADR` não aplicável, mudança de baixo risco) | não |
| `aggregateFromMatches` | 496 | Agregado ida+volta oficial | SIM |
| `predictedAggFromPicks` | 504 | Mesmo cálculo a partir do palpite (preview) | SIM |

## Podium (L514–543) — **CRÍTICA**

| `finalTieEntry` / `officialPodium` / `predictedPodium` | 519/524/533 | Campeão/vice a partir do único confronto da Final | SIM |

## Picks / Validation / Render pick form / Save entry (L545–775) — **CRÍTICA**

| `getPickValues` / `validatePicks` | 546/573 | Lê e valida o formulário de palpites | SIM |
| `renderPickForm` | 596 | Renderiza os confrontos abertos | não (visual) |
| `saveEntry` | 721 | Cria/edita entrada, dispara `saveState` + `queueReceipt` | SIM |

## Receipt box / Scoring / Tiebreaker / Email (L777–1118) — **CRÍTICA**

| `renderReceiptBox` | 782 | Botões abrir/baixar comprovante | não |
| `matchPoints` | 812 | Pontuação por partida (10/5/1, mutuamente exclusiva) | SIM |
| `scoreEntry` | 827 | Motor oficial de pontuação de UMA entrada | SIM |
| `getActiveScore` | 869 | Alias de `scoreEntry` | SIM |
| `explainScore` | 889 | Decomposição auditável — deriva de `scoreEntry`, nunca recalcula (§19, Fase 2) | SIM |
| `resultsProgress` | 963 | % de confrontos resolvidos | não |
| `hitChampion`/`hitRunnerUp`/`countExactMatches` | 980–982 | Extraem sinais do `detail` de `scoreEntry` para o desempate | SIM |
| `receiptHtml` | 994 | HTML do comprovante (usa `legTeams`, `formatBrtTimestamp`) | SIM |
| `downloadBlob`/`openReceipt`/`downloadReceipt` | 1045/1058/1068 | Download local do comprovante | não |
| `queueReceipt` | 1083 | Fila de e-mail em memória (ver §6, `CDB2026_MODERNIZATION_REPORT`) | SIM (dinheiro→confiança, não scoring) |
| `sendReceipt` | 1092 | Envio real via EmailJS (participante + admin) | SIM |

## Countdown / Ranking / Participantes / Pagamento / Regras (L1120–1436)

| `renderCountdown` | 1121 | Cronômetro de cutoff | não |
| `rankEntriesBy` | 1164 | Ordenação + cascata de desempate | SIM |
| `renderRanking` | 1181 | Tabela de ranking | não (consome `rankEntriesBy`) |
| `renderPickDisplay` | 1255 | Detalhe "Ver palpites" (usa `legTeams`) | SIM |
| `renderParticipants` / `renderPayment` / `renderPaymentBox` / `renderRules` | 1321/1339/1361/1377 | Telas informativas | não |

## Probabilidades (L1437–1558)

Modelo estatístico (Poisson/Dixon-Coles) só para a UI de prognóstico pré-jogo — `poisson`,
`tauDC`, `matchProb`, `teamStrength`, `eloFromStrength`, `legLambdas`, `tieAdvanceProb`,
`tieProbBarsHtml`, `renderProbsSection`. **Não crítica** — não participa de scoring nem de
resultado oficial, é só uma estimativa exibida antes do jogo acontecer.

## Games / Próxima partida / Footer (L1560–1807)

| `estTimeStr` / `fmtDate` | 1569/1577 | Exibição dual ET+BRT de kickoff (política intencional, ver `CDB2026_MODERNIZATION_REPORT` §A) | SIM (exibição de cutoff) |
| `countdownTimerHtml` / `firstLegKickoffMs` | 1593/1612 | Apoio ao card de próxima partida | não |
| `renderGamesSection` / `findNextUpcomingMatch` / `brtDateKey` / `findAllUpcomingMatchesOnNextDay` / `renderNextTieCard` | 1618–1797 | Renderização da aba Jogos | não |
| `renderFooter` | 1798 | Rodapé com versão + timestamp de sync (usa `formatBrtTimestamp`) | não |

## Admin (L1808–1866) — **CRÍTICA**

| `adminPhasesFormIsDirty` / `adminResultsFormIsDirty` | 1817/1830 | Aviso de alterações não salvas | não |
| `renderAdmin` | 1835 | Shell da tela admin | não |
| `renderAdminAuditLog` | 1846 | Lista o audit log (usa timestamp ET — ver achado de inconsistência) | SIM |

## ESPN sync / Live (L1868–2660) — **CRÍTICA**

Maior bloco do arquivo. `cdbFmtClock`, `formatMatchClock`, `mergeLiveClock`, `detectClockPaused`,
`loadLiveClockCache`/`saveLiveClockCache`, `loadRawClockCache`/`saveRawClockCache`,
`isLegPostponed`, `fetchLiveTies`, `pollLiveTies`, `nudgeScrollReflow`, `liveClockDisplay`,
`liveScoreEntry` (SIM — pontuação ao vivo, nunca inclui bônus de pódio, ver golden master),
`calculateRankingMovement`, `rankMovementHtml`, `renderLiveRankingHero`, `renderLiveTieCard`,
`extractMatchPlays`, `livePlaysHtml`, `fetchEspnEventSummary`, `fetchEspnCandidates` (SIM — grava
confrontos), `existingPairsAcrossPhases`, `espnTieId`, `seedKnownConfrontos`,
`backfillOitavasKickoffs`, `healFalseEspnAutoResults`, `healPhantomTies`, `autoSyncEspn` (SIM),
`aggregateOrSingleTotals`, `withinResultMatchWindow`, `autoSyncEspnResults` (SIM — pode travar
`qualifiedTeamId` sozinho), `autoSyncEspnFull`, `renderAdminEspnSync`, `toLocalDatetimeValue`.

## Admin: Phases / Results / Payments / Entries (L2661–3269) — **CRÍTICA**

| `renderAdminPhases` | 2878 | CRUD de confrontos/fases | SIM |
| `renderAdminResultsForTie` / `renderAdminResults` | 3040/3109 | Lançamento manual de placar/`qualifiedTeamId` | SIM |
| `renderAdminPayments` | 3204 | Toggle de pagamento (ver `CDB2026_MODERNIZATION_REPORT` §5 — any-true-wins) | SIM |
| `renderAdminEntries` | 3237 | Lista/exclusão de entradas | SIM |

## Export / Clear / Render all / Init (L3270–3560)

| `exportCsv` | 3271 | CSV administrativo (usa `legTeams`, `formatBrtTimestamp`) | SIM |
| `exportJsonBackup` | 3311 | Backup manual via download | SIM |
| `clearAllData` | 3321 | Reset total (admin, com `tripleConfirm`) | SIM (destrutivo) |
| `renderAll` | 3357 | Dispara todos os renders | não |
| `init` | 3376 | Bootstrap da aplicação | SIM |

## Nota de segurança — sanitização (`esc`)

`esc(...)` (alias definido em L12–27) é o único ponto de sanitização HTML usado nas dezenas de
`innerHTML =` espalhadas pelo arquivo. Não há um segundo mecanismo paralelo — toda interpolação
de texto controlado pelo usuário (`entryName`, `payerName`, etc.) observada durante este
inventário passa por `esc()` antes de entrar no HTML. Nenhuma exceção foi encontrada durante a
leitura completa do arquivo para este inventário; se uma for encontrada depois, é uma regressão
de severidade CRÍTICA (XSS), não um item de limpeza.

## Nota — i18n de idioma único

Ao contrário da Copa (`pt-BR`/`es`/`en-US`), `bolao/cdb2026/js/i18n.js` só define `pt-BR`
(confirmado por leitura direta do arquivo, 2026-08). Isso é **intencional** — a Copa do Brasil é
uma competição doméstica, diferente da Copa do Mundo — mas não estava registrado como
`INTENTIONALLY_DIFFERENT` antes desta auditoria. Ver `CONSISTENCY_MATRIX.md`.
