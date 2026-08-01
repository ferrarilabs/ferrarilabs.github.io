# CDB2026 — Data Lineage

**Gerado:** 2026-08, Fase 2, item 16 (§12 do mega-prompt).
**Objetivo:** para cada dado que acaba influenciando dinheiro real (pontuação, ranking,
pagamento), mostrar de onde ele vem e por onde passa até aparecer na tela ou no recibo.

## 1. Placar de uma partida → pontuação de uma entrada

```
Fonte A: Admin digita manualmente
  renderAdminResultsForTie() (app.js:3040)
    → grava tie.matches[leg].{goalsHome,goalsAway,status:"FINAL"}
    → appendAdminAuditLog(s, "save-leg", {...})
    → saveState(s) → localStorage + saveRemoteState() (Supabase)

Fonte B: ESPN automático
  pollLiveTies() [60s] → fetchLiveTies() → fetchEspnCandidates()
    → GET C.espn.scoreboardUrl (site.api.espn.com, sem chave)
    → guarda !postponed (AUDIT-06) antes de aceitar homeScore/awayScore
  autoSyncEspnResults() [5min, só com admin ativo] (app.js:2711)
    → usa os mesmos candidatos de fetchEspnCandidates()
    → aggregateOrSingleTotals() decide se o agregado é conclusivo
    → withinResultMatchWindow() confirma que é o jogo certo (evita cruzar fixtures)
    → grava tie.matches[leg] igual à Fonte A, mas SEM appendAdminAuditLog dedicado
      por partida individual — só o resultado da fase entra no log quando o tie trava
      (ver GAP em CDB2026_RISK_CONTROL_MATRIX.md)

                    ↓ (tie.matches[leg] tem goalsHome/goalsAway não-nulos, status FINAL)

matchPoints(pick, result) (app.js:812) — para CADA entrada, CADA perna
  compara entry.picks.matches[tieId][leg] (o que o participante apostou)
  contra tie.matches[leg] (o resultado oficial)
  → { pts, type } — nunca soma exact+result+side

                    ↓

scoreEntry(entry, s) (app.js:827) — soma matchPoints de todas as pernas de todos os
  confrontos + tieBonus (se picks.qualified bater com tie.qualifiedTeamId) + bônus de
  pódio (se a Final estiver oficialmente resolvida)
  → { total, detail }

                    ↓                                    ↓

renderRanking() (tabela)                    explainScore(entry, s) (app.js:889)
  via rankEntriesBy()                          → breakdown auditável, DERIVADO do
                                                  mesmo detail acima (nunca recalcula)
```

## 2. Confronto (tie) → de onde os dois times vêm

```
Fonte A: Admin cria manualmente
  renderAdminPhases() → formulário de novo confronto → tie.teamA/teamB

Fonte B: ESPN automático
  seedKnownConfrontos() (app.js:2451) — cruza fetchEspnCandidates() com
    DATA.knownConfrontos (data.js, confrontos historicamente conhecidos por fase)
    para criar ties automaticamente quando a ESPN anuncia o jogo
  espnTieId() gera um id determinístico a partir dos nomes dos times, evitando duplicar
    o mesmo confronto se a sincronização rodar de novo

  Rotinas de correção (rodam uma vez, guardadas por espnSync.* flags — ver ADR-002/
  DATA_DICTIONARY):
    backfillOitavasKickoffs() — preenche kickoff que faltava em confrontos já criados
    healFalseEspnAutoResults() — corrige resultados falsos gravados antes do fix AUDIT-06
    healPhantomTies() — remove confrontos fantasma criados por um bug já corrigido
```

## 3. Entrada (Entry) → recibo, CSV, ranking

```
saveEntry() (app.js:721)
  formulário → validatePicks() → entry = {id, entryName, ..., picks, createdAt}
  s.entries.push(entry) → saveState(s)
  queueReceipt(entry) → sendReceipt(entry) [EmailJS, best-effort, ver
    CDB2026_MODERNIZATION_REPORT_2026-08.md §6]

                    ↓ entry armazenada em s.entries, nunca duplicada/reescrita fora daqui
                      (exceto edição pelo próprio participante via findEntryByEmailAndCode)

renderReceiptBox(entry) → HTML local imediato (sempre disponível, mesmo se o e-mail falhar)
receiptHtml(entry, s) → usa legTeams() para orientação correta por perna (AUDIT-05)
exportCsv() (app.js:3271) → mesma travessia de picks, saída texto (admin, download manual)
renderPickDisplay(entry, detail) → "Ver palpites" no ranking, usa o MESMO detail de
  scoreEntry() (não recalcula) para mostrar pts por linha
```

## 4. Pagamento

```
renderAdminPayments() → clique no botão "Marcar pago/não pago"
  guardAdmin() (sessão admin válida)
  s.paid[entryId] = !antes
  appendAdminAuditLog(s, "toggle-paid", {entryId, entryName, from, to}) — AUDIT-08
  saveState(s, {localOnly:false}) → mergeStates() any-true-wins no próximo merge (AUDIT-02)

                    ↓

renderRanking() mostra o ícone de pago/não-pago por entrada (não afeta pontuação —
  pagamento e pontuação são dados independentes, nunca se cruzam no código)
```

## 5. Onde cada dado É persistido vs. só computado ao vivo

| Dado | Persistido? | Onde |
|---|---|---|
| Placar de partida (`tie.matches[leg]`) | Sim | `s.phases[phaseId].ties[tieId].matches` |
| Classificação (`qualifiedTeamId`) | Sim | idem |
| Pontuação de uma entrada | **Não** | Sempre recomputada por `scoreEntry()` a partir de picks+resultados — nunca gravada |
| Ranking/posição | **Não** | Sempre recomputado por `rankEntriesBy()` |
| Decomposição (`explainScore`) | **Não** | Sempre derivada on-demand |
| Pagamento | Sim | `s.paid[entryId]` |
| Log de auditoria | Sim (com as limitações do `ADR-004`) | `s.auditLog` |

Esta distinção é exatamente por que `audit_integrity.py`'s "score-recompute" é informacional, não
uma checagem de divergência real — não existe pontuação persistida para divergir DE (ver docstring
do próprio script e `CDB2026_DATA_DICTIONARY.md`).
