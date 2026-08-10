"""
legacy_round_state.py — adaptador do estado antigo de `roundEmail` para o modelo canônico.

O estado antigo não conhece rodadas. Ele guarda:

    sentGameIds   — ids de jogos já cobertos por algum lote enviado
    sentBatches   — histórico de lotes (janela de datas, contagens)
    pendingBatch  — O lote aberto, único e GLOBAL
    baseline      — classificação usada para calcular movimento no ranking

Sem tradução, a primeira execução do reconciliador trataria TODA rodada histórica como não
notificada e prepararia catch-up para rodadas que já foram comunicadas há semanas. Medido no
dry-run antes desta migração: R17, R18, R19 e R20 apareceram como candidatas — as quatro já
tinham sido enviadas.

A tradução é conservadora por desenho: na dúvida, considera ENVIADA. Um email a menos é um
incômodo; um email duplicado para 11 pessoas com dinheiro real em jogo é um incidente.
"""


def feature_epoch(legacy):
    """Instante a partir do qual o recurso de email de rodada existiu.

    Rodadas encerradas ANTES disto nunca tiveram email e nunca deveriam ter. Sem este limite o
    reconciliador propõe catch-up de rodadas de janeiro — medido: R17 e R18 apareceram como
    candidatas. Reconciliação não é arqueologia; o objetivo é rodada perdida, não a temporada
    inteira.
    """
    batches = legacy.get("sentBatches") or []
    if not batches:
        return None
    return min(b.get("windowStart") for b in batches if b.get("windowStart"))


def migrate(legacy, manifest):
    """(notification_states, relatório). Função pura — não escreve em lugar nenhum."""
    legacy = legacy or {}
    sent_ids = set(legacy.get("sentGameIds") or [])
    pending = legacy.get("pendingBatch") or None

    states, report = {}, {
        "sentGameIdsCount": len(sent_ids),
        "sentBatchesCount": len(legacy.get("sentBatches") or []),
        "roundsMarkedSent": [],
        "roundsMarkedPartial": [],
        "legacyPendingBatchDisposition": "AUSENTE",
    }

    pending_ids = set((pending or {}).get("gameIds") or [])
    epoch = feature_epoch(legacy)
    report["featureEpoch"] = epoch
    report["roundsPreFeature"] = []

    for r in manifest.get("rounds", []):
        n = r["roundNumber"]
        ids = set(r["canonicalFixtureIds"])
        key = f"br2026:round-results:{n}:v1"
        covered = ids & sent_ids

        if epoch and r.get("dateRangeUtc") and r["dateRangeUtc"][1] < epoch:
            # Anterior ao recurso: fora do escopo de reconciliacao, para sempre.
            states[key] = {
                "status": "SENT",
                "source": "PRE_FEATURE",
                "evidence": f"rodada encerrada em {r['dateRangeUtc'][1]}, antes do epoch {epoch}",
            }
            report["roundsPreFeature"].append(n)
            continue

        if not covered:
            continue

        if covered == ids:
            # Todos os jogos da rodada já foram cobertos por um lote enviado.
            states[key] = {
                "status": "SENT",
                "source": "LEGACY_MIGRATION",
                "evidence": "todos os canonicalFixtureIds constam em sentGameIds",
            }
            report["roundsMarkedSent"].append(n)
        else:
            # Cobertura parcial: os lotes antigos por janela de datas cortavam rodadas ao meio.
            # Tratar como SENT evitaria um duplicado, mas esconderia uma rodada de fato não
            # comunicada. PARTIAL exige decisão humana — que é o correto para um caso ambíguo.
            states[key] = {
                "status": "PARTIAL",
                "source": "LEGACY_MIGRATION",
                "evidence": f"{len(covered)}/{len(ids)} jogos cobertos por lotes antigos",
            }
            report["roundsMarkedPartial"].append(n)

    # O lote travado vira EVIDÊNCIA HISTÓRICA, nunca uma trava global. Ele descreve uma rodada
    # que está esperando jogos adiados — condição que o resolver canônico deriva sozinho dos
    # fatos, sem precisar de um cadeado no estado.
    if pending:
        rounds_touched = sorted({
            r["roundNumber"] for r in manifest.get("rounds", [])
            if set(r["canonicalFixtureIds"]) & pending_ids
        })
        report["legacyPendingBatchDisposition"] = (
            f"ARQUIVADO como evidência histórica; cobria a(s) rodada(s) {rounds_touched}; "
            f"deixa de ser trava global"
        )
        report["legacyPendingBatchRounds"] = rounds_touched

    return states, report
