#!/usr/bin/env python3
"""
who_can_still_podium.py — Quem ainda pode acertar campeão, vice e 3º lugar.

Uso:
  python3 bolao/scripts/who_can_still_podium.py

Para cada entrada salva, resolve o pódio que os PRÓPRIOS palpites dela preveem
(_entry_predicted_podium, a mesma lógica do send_result_email.py) e verifica se
os times previstos para campeão/vice/3º ainda estão vivos — ou seja, ainda não
perderam nenhuma partida real no bracket (results do Supabase). Uma entrada só
conta como "ainda viva" se os três palpites (campeão, vice e 3º) continuarem
todos possíveis.

Esse "ainda vivo" simplifica para "não perdeu nenhuma partida ainda" porque,
até a semifinal terminar, perder qualquer jogo elimina o time por completo —
só os dois perdedores de semifinal ganham mais um jogo (a disputa de 3º).
Antes das semifinais acontecerem essa distinção não importa; se rodar depois
delas, um time que só perdeu a semifinal ainda pode ser 3º, mas não mais
campeão/vice — o script já trata isso corretamente.
"""
import re
import sys

import send_result_email as sre


def _is_unresolved_slot(name):
    """True for a still-raw 'W101'/'L103' placeholder — happens when an entry
    is missing picks for an earlier match in the chain (e.g. a late joiner
    with no R32 picks), so _entry_predicted_podium can't resolve who they'd
    actually predict. Must not be treated as a real, still-alive team name."""
    return bool(re.match(r'^[WL]\d+$', str(name)))


def eliminated_teams(results):
    """Times que já perderam alguma partida real (fora da semifinal, tratado à parte)."""
    out = set()
    for mid in sre.MATCH_TEAMS:
        r = results.get(mid)
        if not r or not r.get("advanceSide"):
            continue
        tA, tB = sre._real_teams(mid, results)
        loser = tB if r["advanceSide"] == "A" else tA
        out.add(loser)
    return out


def semifinal_losers_only(results):
    """Times cuja ÚNICA derrota até agora foi na semifinal (M101/M102) —
    ainda podem ser 3º lugar, mas não mais campeão/vice."""
    out = set()
    for mid in ("101", "102"):
        r = results.get(mid)
        if not r or not r.get("advanceSide"):
            continue
        tA, tB = sre._real_teams(mid, results)
        loser = tB if r["advanceSide"] == "A" else tA
        out.add(loser)
    return out


def main():
    state = sre.sb_fetch()
    results = state.get("results") or {}
    entries = state.get("entries") or []

    eliminated = eliminated_teams(results)
    sf_losers = semifinal_losers_only(results)
    # Fully out: lost anywhere except being exactly a semifinal loser awaiting the 3rd-place game.
    fully_out = eliminated - sf_losers

    alive_for_champion_or_runnerup = lambda team: team is not None and team not in eliminated
    alive_for_third = lambda team: team is not None and team not in fully_out

    still_alive = []
    no_podium_pick = []
    for e in entries:
        pod = sre._entry_predicted_podium(e)
        champ, runner, third = pod["champion"], pod["runnerUp"], pod["third"]
        if (not champ or not runner or not third
                or _is_unresolved_slot(champ) or _is_unresolved_slot(runner) or _is_unresolved_slot(third)):
            no_podium_pick.append(e.get("entryName", e.get("id", "?")))
            continue
        if (alive_for_champion_or_runnerup(champ)
                and alive_for_champion_or_runnerup(runner)
                and alive_for_third(third)):
            still_alive.append((e.get("entryName", e.get("id", "?")), champ, runner, third))

    print(f"Times já eliminados: {', '.join(sorted(eliminated)) or '(nenhum ainda)'}\n")
    print(f"Ainda vivos para acertar campeão + vice + 3º ({len(still_alive)} de {len(entries)} entradas):\n")
    for name, champ, runner, third in sorted(still_alive):
        print(f"  {name:35s} campeão={champ:20s} vice={runner:20s} 3º={third}")

    if no_podium_pick:
        print(f"\nSem palpite de pódio completo (ignoradas): {', '.join(no_podium_pick)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
