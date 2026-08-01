# CDB2026 — Requirements Traceability Matrix

**Gerado:** 2026-08, Fase 2, item 16 (§11 do mega-prompt).
**Fonte:** requisitos documentados em `CLAUDE.md` ("Scoring", "Admin", "Cutoff"), CHANGELOG do
app, e comentários de autorização explícita de Eduardo encontrados no código
(`app.js`/`i18n.js`). Cada linha aponta para código real e teste real — nenhuma linha descreve
um requisito sem uma implementação e uma verificação encontradas.

| # | Requisito | Origem | Implementação | Teste que verifica |
|---|---|---|---|---|
| R1 | Placar exato vale 10 pts | `CLAUDE.md` "Scoring" | `matchPoints()`, `app.js:812` | `audit_golden_master.mjs` "matchPoints" + `audit_scoring.py` self-test |
| R2 | Resultado certo (sem placar exato) vale 5 pts | `CLAUDE.md` | `matchPoints()` | idem |
| R3 | Um lado do placar certo vale 1 pt, mutuamente exclusivo | `CLAUDE.md` | `matchPoints()` | idem |
| R4 | Classificação certa (avançou/não avançou) vale 5 pts | `CLAUDE.md` | `scoreEntry()`, `app.js:843-850` | `audit_golden_master.mjs` "scoreEntry totals" |
| R5 | Campeão certo vale 30 pts, vice certo vale 20 pts | `CLAUDE.md` | `scoreEntry()`, `officialPodium()`/`predictedPodium()` | idem + `audit_integrity.py` (`check_recompute_matches_golden_master`) |
| R6 | Pontuação ao vivo nunca inclui bônus de pódio antes do resultado oficial | Achado de auditoria, confirmado correto (ver `ADR-003`) | `liveScoreEntry()`, `app.js:2106` | `audit_golden_master.mjs` "live scoring never adds a podium bonus" |
| R7 | Segunda perna (volta) inverte mandante/visitante | Regra real de mata-mata | `legTeams()`, `aggregateFromMatches()` | `audit_state_merge.mjs` "leg 2 home/away is SWAPPED", `audit_golden_master.mjs` "leg2 orientation" |
| R8 | Cutoff de entrada bloqueia novos palpites após o prazo | `CLAUDE.md` "Cutoff" | `isPastEntryCutoff()`, `entryCutoffMs()`, `app.js:371-376` | Verificação manual (client-side apenas — ver limitação abaixo) |
| R9 | Cutoff por fase usa o 1º kickoff conhecido quando disponível, manual como fallback | Comentário `app.js:335-370` | `firstKnownKickoffMs()`, `effectivePhaseCutoffMs()` | Sem teste automatizado dedicado — GAP, ver `CDB2026_RISK_CONTROL_MATRIX.md` |
| R10 | Admin autentica por senha (hash SHA-256), sessão de 30 min, bloqueio após 5 tentativas | `CLAUDE.md` "Admin" | `isAdminActive()`, `guardAdmin()`, `app.js:284-285` + login handler `app.js:3438-3456` | Verificação manual (não coberto por golden master — não é uma função pura extraível) |
| R11 | Toda ação admin que mexe em dinheiro ou dado sensível é auditada | AUDIT-08 (Fase 1, 2026-08) | `appendAdminAuditLog()`, chamada em 7 sites (`toggle-paid`, `delete-entry`, `save-leg`, `lock-tie`, `unlock-tie`, `edit-leg`) | Verificação manual de cada call site — ver `CDB2026_CODE_INVENTORY.md` "Admin auth" |
| R12 | Merge de estado local×remoto não perde marca de pagamento nem entrada concorrente | AUDIT-01/02/03 (Fase 1) | `mergeStates()`, `saveRemoteState()` | `audit_state_merge.mjs`, 7 checks dedicados |
| R13 | Merge de estado NÃO garante contra escrita simultânea verdadeira | Fase 2 §4 — caracterização, não requisito atendido | N/A — limitação documentada, ver `ADR-002` | `audit_state_merge.mjs` "TRUE concurrent writes are NOT fully resolved" (prova o limite, não uma garantia) |
| R14 | Jogo adiado/cancelado nunca vira resultado FINAL 0-0 falso | AUDIT-06 (Fase 1) | guarda `!postponed` em `fetchEspnCandidates()`, `app.js:2385-2407` | Sem teste automatizado (função de rede, não pura) — verificado por leitura de código + dados reais da ESPN citados no comentário |
| R15 | Sincronização ESPN pode travar resultado automaticamente sem clique do admin | v3.16, autorizado por Eduardo 2026-07-14 | `autoSyncEspnResults()`, `app.js:2711` | Sem teste automatizado — GAP, ver `CDB2026_RISK_CONTROL_MATRIX.md` |
| R16 | Recibo por e-mail mostra a orientação correta de cada perna | AUDIT-05 (Fase 1) | `receiptHtml()` usa `legTeams()` | `audit_state_merge.mjs` "leg 2 home/away is SWAPPED" (cobre a função consumida, não o HTML final) |
| R17 | Toda entrada tem um comprovante disponível na página, mesmo se o e-mail falhar | Fase 2 §6 (mensagem corrigida) | `renderReceiptBox()`, `openReceipt()`/`downloadReceipt()` — síncrono, independente do e-mail | Verificação manual (QA de navegador, 2026-08) |
| R18 | Decomposição de pontuação (breakdown) sempre reconcilia com o total oficial | Fase 2 §19 | `explainScore()`, `app.js:889` | `audit_golden_master.mjs`, 4 checks de reconciliação (um por entrada da fixture) + rule version + linha vazia + ruleId |
| R19 | Toda pontuação é rastreável a uma versão de regra | Fase 2 §18/§19 | `SCORING_RULE_VERSION`, `app.js:807` | `audit_golden_master.mjs` "explainScore reports the rule version" |
| R20 | Nenhuma entrada excluída pode "ressuscitar" via merge remoto | Regra de tombstone | `deletedIds`, checado em `mergeStates()` | `audit_state_merge.mjs` "locally-deleted entry is not resurrected by remote" |
| R21 | Timestamps administrativos (recibo, rodapé, CSV, cutoff) usam horário do Brasil | Fase 2 §5 (consolidado) | `formatBrtTimestamp()`, `app.js:489` | `audit_golden_master.mjs` hash de comportamento completo (indireto — não muda) + verificação visual (QA 2026-08) |
| R22 | Kickoff de jogo mostrado ao participante usa ET (primário) + BRT (secundário) | Pedido de Eduardo, 2026-07-17 | `fmtDate()`/`estTimeStr()`, `app.js:1569-1579` | Verificação manual (QA de navegador) |
| R23 | Paridade visual com a plataforma canônica (Copa do Mundo 2026) | Fase 2.1 §6/§7/§8 | Nav de 6 abas primárias + `.nav-secondary` (`index.html`, `css/styles.css` — Fase 2.1 §7); `.sticky-submit` com `pointer-events`/`text-align` do padrão Copa + `env(safe-area-inset-bottom)` + `#entry { padding-bottom }` (`css/styles.css`) | `check_sticky_overlap.mjs` (0%/100% de scroll, 4 larguras obrigatórias) + `capture_evidence.mjs` (84 screenshots, 3 apps × 7 viewports, `docs/bolao/evidence/visual/*/manifest.json`, `overflow_report.json` vazio, `console_errors.json` vazio) |
| R24 | Mutação administrativa dirigida persiste sobre o estado remoto mais recente (não é descartada pelo merge campo-a-campo pensado para participante) | Fase 2.1 §2/§3 | `applyAdminMutation()`/`applyMutationOverRemote()`, `app.js` (perto de `mergeStates()`) | `audit_state_merge.mjs`, seção "Fase 2.1 §3" — 11 mutações administrativas + preservação de alteração remota independente + batch ESPN, todas com remoto ANTIGO / mutação NOVA / resultado esperado NOVO |
| R25 | Fixture golden roda sem WARNING/ERROR/CRITICAL; fixtures negativas são detectadas | Fase 2.1 §10 | `fixtures/golden_state.json` (limpa) + `fixtures/invalid_*.json` (3 fixtures negativas) | `audit_integrity.py --self-test` — "golden_state.json has no WARNING/ERROR/CRITICAL" + "negative fixtures are each caught" |
| R26 | Cache-bust nunca fica desatualizado em relação ao conteúdo dos arquivos críticos | Fase 2.1 §5 | Tag = SHA-256(conteúdo de styles.css+config.js+data.js+i18n.js+app.js), não escolhida à mão | `check_cachebust.mjs` — falha se a tag em `index.html` não bater com o hash do conteúdo atual |

## Requisitos sem teste automatizado (GAPs conhecidos, não corrigidos nesta modernização)

R8, R9, R10, R14, R15, R22 dependem de estado de rede, DOM, ou tempo de execução (`Date.now()`
sem injeção de relógio) e não são funções puras extraíveis pelo mesmo mecanismo usado por
`audit_state_merge.mjs`/`audit_golden_master.mjs`. Cobri-los exigiria um harness de teste E2E
(ex. Playwright com mocks de tempo/rede) — fora do escopo desta modernização (adicionar
infraestrutura de teste nova além do que já existe não estava autorizado como "patch cirúrgico
mínimo"). Registrado aqui para uma decisão futura informada, não escondido.
