"""
round_state.py — resolver canônico de estado de rodada do BR2026. FUNÇÃO PURA.

Este módulo não fala com rede, banco nem provedor de email. Recebe (rodada do manifesto,
observações, estado de notificação) e devolve um estado. É puro de propósito: o defeito que
originou tudo isto vivia dentro de uma função de 150 linhas que fazia ESPN + Supabase + EmailJS
ao mesmo tempo, e por isso nenhum teste conseguia exercitar a decisão de completude isoladamente.

─── O DEFEITO QUE ISTO SUBSTITUI ───────────────────────────────────────────────────────────

O modelo anterior mantinha UM `pendingBatch` global definido por janela de datas. Em 2026-07-29
abriu um lote com 10 jogos; 4 deles foram adiados indefinidamente. Como o lote só fechava com
`all(completed)`, ele travou — e, sendo global e único, impediu que QUALQUER rodada posterior
fosse sequer avaliada. A R22 terminou 10/10 em 09/08 e ficou invisível atrás da R21.

Aqui cada rodada tem seu próprio ciclo de vida. Uma R21 esperando jogo adiado não impede a R22
de ficar elegível. Ver POSTPONED_ROUND_DOES_NOT_BLOCK_LATER_COMPLETE_ROUND em
test_round_state.py.
"""

from datetime import datetime, timedelta, timezone

# ── Estados canônicos ─────────────────────────────────────────────────────────
ROUND_UNKNOWN = "ROUND_UNKNOWN"
ROUND_INCOMPLETE = "ROUND_INCOMPLETE"
ROUND_WAITING_FOR_POSTPONED_MATCH = "ROUND_WAITING_FOR_POSTPONED_MATCH"
ROUND_SOURCE_UNAVAILABLE = "ROUND_SOURCE_UNAVAILABLE"
ROUND_COMPLETE_UNSETTLED = "ROUND_COMPLETE_UNSETTLED"
ROUND_READY_TO_NOTIFY = "ROUND_READY_TO_NOTIFY"
ROUND_NOTIFICATION_PENDING = "ROUND_NOTIFICATION_PENDING"
ROUND_NOTIFICATION_PARTIAL = "ROUND_NOTIFICATION_PARTIAL"
ROUND_NOTIFIED = "ROUND_NOTIFIED"
ROUND_NOTIFICATION_FAILED = "ROUND_NOTIFICATION_FAILED"

# Janela de assentamento: depois que o último jogo exigido vira terminal, esperamos antes de
# confiar. Placar e status ainda oscilam nos minutos seguintes ao apito final.
SETTLEMENT_WINDOW = timedelta(minutes=5)

# Acima disto a observação é velha demais para decidir o envio de um email irreversível.
MAX_SOURCE_AGE = timedelta(minutes=30)

TERMINAL_FINAL = "FINAL"
TERMINAL_POSTPONED = "POSTPONED"


def terminal_of(obs):
    """Terminal declarado PELA FONTE. Nunca inferido por relógio ou por data passada."""
    if not obs:
        return None
    if obs.get("postponed") or obs.get("statusName") in (
        "STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED"
    ):
        return TERMINAL_POSTPONED
    if obs.get("completed") is True or obs.get("state") == "post":
        return TERMINAL_FINAL
    return None


def _effective_observation(round_def, fixture_id, observations):
    """Observação que vale para um jogo canônico.

    Se o jogo foi adiado e REJOGADO com id novo, a verdade está no rejogo — mas o jogo continua
    pertencendo à rodada de origem. É assim que um adiado da R4 rejogado em julho fecha a R4,
    sem nunca migrar para a rodada de julho.
    """
    replacement = (round_def.get("replacements") or {}).get(fixture_id)
    if replacement and replacement in observations:
        rep = observations[replacement]
        if terminal_of(rep):
            return rep, replacement
    return observations.get(fixture_id), fixture_id


def derive_round_notification_state(round_def, observations, notification_state=None, now=None):
    """Estado canônico de UMA rodada. Independente de qualquer outra rodada.

    round_def          — entrada do manifesto (roundNumber, canonicalFixtureIds, replacements)
    observations       — {fixtureId: {state, completed, statusName, postponed, observedAt}}
    notification_state — disposição durável desta rodada, se houver
    """
    now = now or datetime.now(timezone.utc)
    ns = notification_state or {}

    # Notificação já resolvida tem precedência: nunca reavaliar para reenviar.
    if ns.get("status") == "SENT":
        return _result(ROUND_NOTIFIED, round_def, reason="notificação já concluída")
    if ns.get("status") == "PARTIAL":
        return _result(ROUND_NOTIFICATION_PARTIAL, round_def,
                       reason="entrega incompleta registrada — requer reprocessamento")
    if ns.get("status") == "SENDING":
        return _result(ROUND_NOTIFICATION_PENDING, round_def,
                       reason="outra execução detém o claim")

    if not round_def or not round_def.get("canonicalFixtureIds"):
        return _result(ROUND_UNKNOWN, round_def, reason="rodada sem conjunto de jogos conhecido")

    expected = round_def["canonicalFixtureIds"]
    if round_def.get("expectedFixtureCount") not in (None, len(expected)):
        return _result(ROUND_UNKNOWN, round_def,
                       reason="manifesto inconsistente: contagem != ids")

    final_ids, postponed_ids, missing_ids, pending_ids = [], [], [], []
    newest_terminal_at = None
    oldest_observed_at = None

    for fid in expected:
        obs, used_id = _effective_observation(round_def, fid, observations)
        if obs is None:
            # AUSENTE NUNCA É FINAL. Foi essa confusão que fez uma fonte fora do ar parecer
            # "rodada encerrada" em incidentes anteriores da plataforma.
            missing_ids.append(fid)
            continue

        seen = _parse(obs.get("observedAt"))
        if seen and (oldest_observed_at is None or seen < oldest_observed_at):
            oldest_observed_at = seen

        t = terminal_of(obs)
        if t == TERMINAL_FINAL:
            final_ids.append(fid)
            at = _parse(obs.get("terminalAt")) or seen
            if at and (newest_terminal_at is None or at > newest_terminal_at):
                newest_terminal_at = at
        elif t == TERMINAL_POSTPONED:
            postponed_ids.append(fid)
        else:
            pending_ids.append(fid)

    facts = {
        "expectedCount": len(expected),
        "finalCount": len(final_ids),
        "postponedCount": len(postponed_ids),
        "missingCount": len(missing_ids),
        "nonTerminalCount": len(pending_ids) + len(missing_ids),
        "postponedIds": postponed_ids,
        "missingIds": missing_ids,
        "pendingIds": pending_ids,
        "lastTerminalAt": newest_terminal_at.isoformat() if newest_terminal_at else None,
    }

    if missing_ids:
        return _result(ROUND_SOURCE_UNAVAILABLE, round_def, facts=facts,
                       reason=f"{len(missing_ids)} jogo(s) sem observação — ausente não é final")

    # Adiado mantém a rodada incompleta e NUNCA é removido dela. Mas isto vale só para ESTA
    # rodada: nenhuma outra é afetada.
    if postponed_ids:
        return _result(ROUND_WAITING_FOR_POSTPONED_MATCH, round_def, facts=facts,
                       reason=f"{len(postponed_ids)} jogo(s) adiado(s)/suspenso(s)")

    if pending_ids:
        return _result(ROUND_INCOMPLETE, round_def, facts=facts,
                       reason=f"{len(pending_ids)} jogo(s) ainda não terminal(is)")

    # Todos terminais e finais a partir daqui.
    if oldest_observed_at and (now - oldest_observed_at) > MAX_SOURCE_AGE:
        return _result(ROUND_SOURCE_UNAVAILABLE, round_def, facts=facts,
                       reason=f"observação mais velha que {MAX_SOURCE_AGE}")

    if newest_terminal_at is None:
        return _result(ROUND_COMPLETE_UNSETTLED, round_def, facts=facts,
                       reason="sem instante de encerramento confiável para medir o assentamento")

    if (now - newest_terminal_at) < SETTLEMENT_WINDOW:
        return _result(ROUND_COMPLETE_UNSETTLED, round_def, facts=facts,
                       reason=f"janela de assentamento de {SETTLEMENT_WINDOW} ainda não decorrida")

    return _result(ROUND_READY_TO_NOTIFY, round_def, facts=facts,
                   reason="todos os jogos finais, assentados e reconfirmados")


def _result(state, round_def, facts=None, reason=""):
    return {
        "state": state,
        "roundNumber": (round_def or {}).get("roundNumber"),
        "idempotencyKey": idempotency_key((round_def or {}).get("roundNumber")),
        "reason": reason,
        "facts": facts or {},
    }


def idempotency_key(round_number):
    """Determinística e estável. NUNCA contém endereço de participante."""
    if round_number is None:
        return None
    return f"br2026:round-results:{round_number}:v1"


def _parse(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


# ── Reconciliação ─────────────────────────────────────────────────────────────
def reconcile(manifest, observations, notification_states=None, now=None):
    """Responde 'quais rodadas concluídas ainda não foram notificadas?'.

    Reconciliador, não observador de transição: não precisa estar rodando no instante em que a
    rodada termina. Um cron perdido, um runner fora do ar ou um provedor caído são recuperados
    na próxima execução, porque o estado é DERIVADO dos fatos, não de ter presenciado a mudança.

    Rodadas são avaliadas de forma INDEPENDENTE. Uma R21 travada em adiamento não impede a R22.
    Candidatos saem em ordem cronológica de rodada.
    """
    notification_states = notification_states or {}
    evaluated, candidates = [], []

    for round_def in manifest.get("rounds", []):
        n = round_def["roundNumber"]
        res = derive_round_notification_state(
            round_def, observations, notification_states.get(idempotency_key(n)), now=now
        )
        evaluated.append(res)
        if res["state"] == ROUND_READY_TO_NOTIFY:
            candidates.append(res)

    candidates.sort(key=lambda r: r["roundNumber"])
    return {"evaluated": evaluated, "candidates": candidates}
