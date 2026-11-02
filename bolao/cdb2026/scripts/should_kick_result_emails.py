#!/usr/bin/env python3
"""CDB2026 — decide se o e-mail de resultado precisa ser acionado AGORA.

POR QUE EXISTE
--------------
2026-11-01: o `cdb2026_result_emails.yml` tem cron de 10 em 10 minutos, mas o GitHub o acordou
~4 vezes por dia (01h, 03h, 10h, 20h UTC). Grêmio 2x0 Atlético-MG terminou 23:32Z e nenhuma
execução rodou; o resultado só foi salvo e enviado à mão, 1h30 depois.

Quem tem cadência confiável é o `live_cache_producer.yml`, acordado de 5 em 5 minutos pelo cron da
Cloudflare. Ele chama este script e, se a resposta for KICK, dispara o e-mail de resultado.

REGRA
-----
KICK se existe uma perna SEM placar gravado cujo kickoff está entre 4h atrás e 5 min à frente
(jogo ao vivo ou recém-terminado). O `--auto` que roda em seguida decide sozinho o que gravar e
enviar: se o jogo está ao vivo ele espera o apito; se não há nada novo ele sai em segundos.
Fora dessa janela não aciona nada, então não gera execução à toa.

Lê só a projeção PÚBLICA (anon). Não grava, não envia e-mail.

Uso: python3 should_kick_result_emails.py   → imprime KICK <motivo> ou SKIP <motivo>
"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
BEFORE = timedelta(hours=4)
AHEAD = timedelta(minutes=5)


def _dt(iso):
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def pending_legs(state, now):
    """Pernas sem placar com kickoff em [now-4h, now+5min]. Função pura."""
    out = []
    for phase_id, phase in (state.get("phases") or {}).items():
        ties = (phase or {}).get("ties") or {}
        for tie_id, tie in (ties.items() if isinstance(ties, dict) else []):
            for leg, m in ((tie or {}).get("matches") or {}).items():
                if not isinstance(m, dict) or m.get("goalsHome") is not None:
                    continue
                k = _dt(m.get("kickoff")) if m.get("kickoff") else None
                if k and now - BEFORE <= k <= now + AHEAD:
                    out.append((phase_id, tie_id, leg, m["kickoff"]))
    return out


def main():
    req = urllib.request.Request(
        f"{SUPABASE}/rest/v1/bolao_state_normalized_public?id=eq.cdb2026&select=state",
        headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            state = json.load(r)[0]["state"]
    except Exception as ex:  # leitura falhou: não acionar no escuro; o próximo tick tenta de novo
        print(f"SKIP leitura do estado falhou: {ex}")
        return 0
    legs = pending_legs(state, datetime.now(timezone.utc))
    if legs:
        print("KICK " + "; ".join(f"{p}/{t}/{l}@{k}" for p, t, l, k in legs))
    else:
        print("SKIP nenhuma perna sem placar perto do kickoff")
    return 0


if __name__ == "__main__":
    sys.exit(main())
