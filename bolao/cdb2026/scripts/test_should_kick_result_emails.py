#!/usr/bin/env python3
"""Testes do acionador do e-mail de resultado (should_kick_result_emails.py)."""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from should_kick_result_emails import pending_legs  # noqa: E402

NOW = datetime(2026, 11, 1, 23, 40, tzinfo=timezone.utc)


def estado(**legs):
    return {"phases": {"semifinal": {"ties": {"t": {"matches": legs}}}}}


def perna(kickoff, gh=None, ga=None):
    return {"kickoff": kickoff, "goalsHome": gh, "goalsAway": ga}


falhas = 0


def caso(nome, cond):
    global falhas
    print(("ok   " if cond else "FAIL ") + nome)
    falhas += 0 if cond else 1


# O caso real de 2026-11-01: Grêmio x Atlético-MG, kickoff 21:30Z, terminou 23:32Z sem execução.
caso("jogo recém-terminado sem placar aciona",
     len(pending_legs(estado(first=perna("2026-11-01T21:30:00+00:00")), NOW)) == 1)
caso("perna com placar gravado não aciona",
     pending_legs(estado(first=perna("2026-11-01T21:30:00+00:00", 2, 0)), NOW) == [])
caso("jogo ao vivo aciona",
     len(pending_legs(estado(first=perna("2026-11-01T23:00:00Z")), NOW)) == 1)
caso("kickoff daqui a 3 min aciona (a execução espera o jogo)",
     len(pending_legs(estado(first=perna("2026-11-01T23:43:00Z")), NOW)) == 1)
caso("kickoff daqui a 1h não aciona",
     pending_legs(estado(first=perna("2026-11-02T00:40:00Z")), NOW) == [])
caso("kickoff há mais de 4h não aciona",
     pending_legs(estado(first=perna("2026-11-01T19:30:00Z")), NOW) == [])
caso("volta de semana que vem não aciona",
     pending_legs(estado(second=perna("2026-11-07T21:00:00+00:00")), NOW) == [])
caso("perna sem kickoff não aciona",
     pending_legs(estado(first={"goalsHome": None}), NOW) == [])
caso("kickoff ilegível não quebra",
     pending_legs(estado(first=perna("TBD")), NOW) == [])
caso("estado vazio não quebra", pending_legs({}, NOW) == [])
caso("placar 0x0 conta como gravado",
     pending_legs(estado(first=perna("2026-11-01T21:30:00Z", 0, 0)), NOW) == [])

sys.exit(1 if falhas else 0)
