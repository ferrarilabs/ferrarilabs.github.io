#!/usr/bin/env python3
"""Loterias — decide se o e-mail de resultado (powerball-results-email.yml) precisa ser acionado AGORA.

POR QUE EXISTE
--------------
2026-11-10: o sorteio de Mega Millions foi as 04:00 UTC e o `powerball-results-email.yml` foi acordado
pelo GitHub so 3 vezes naquela noite (00:31, 01:46, 05:12 UTC), contra dezenas de horarios no cron.
O catch-up das 08:00 UTC nem disparou. O resultado ficou disponivel e o e-mail so saiu por reenvio
manual. No 06/11 aconteceu o mesmo (enviado 7h30 depois do sorteio).

Mesma saida do CDB2026 (`bolao/cdb2026/scripts/should_kick_result_emails.py`): o
`live_cache_producer.yml`, acordado de 5 em 5 minutos pela Cloudflare, chama este script e, se a
resposta for KICK, dispara o e-mail de resultado.

REGRA
-----
KICK se existe sorteio COM bilhetes/participantes e SEM resultado gravado no data.js cujo horario
oficial + 10 min de carencia ja passou ha no maximo 24h. O `fetch_and_send_results.py` que roda em
seguida decide sozinho o que gravar e enviar (identidade, tempo, ledger); se a fonte ainda nao
publicou, ele sai em segundos. Fora dessa janela nao aciona nada.

Le so o data.js do checkout. Nao grava, nao envia e-mail, nao chama rede.

Uso: python3 should_kick_result_email.py   → imprime KICK <motivo> ou SKIP <motivo>
"""
import os
import sys
from datetime import datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

GRACE = timedelta(minutes=10)   # o mesmo DRAW_PUBLICATION_GRACE_MINUTES do sender
JANELA = timedelta(hours=24)    # o data.ny.gov ja publicou em ate ~9h; 24h cobre e depois para


def _dt(iso):
    try:
        d = datetime.fromisoformat(str(iso))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def pending_draws(draws, now):
    """Sorteios com bilhetes, sem resultado, entre +10 min e +24h do horario oficial. Função pura."""
    out = []
    for d in draws or []:
        if not (d.get("sharedTickets") or d.get("participants")):
            continue
        if (d.get("result") or {}).get("numbers"):
            continue
        quando = _dt((d.get("drawing") or {}).get("drawDateIso") or d.get("drawDateIso"))
        if quando and quando + GRACE <= now <= quando + JANELA:
            out.append((d.get("id"), d.get("gameType") or "powerball", quando.isoformat()))
    return out


def main():
    import fetch_and_send_results as F
    try:
        draws = F.parse_draws(F.load_data_js())
    except Exception as ex:  # leitura falhou: nao acionar no escuro; o proximo tick tenta de novo
        print(f"SKIP leitura do data.js falhou: {ex}")
        return 0
    if not draws:
        print("SKIP data.js sem POWERBALL_DRAWS legivel")
        return 0
    pend = pending_draws(draws, datetime.now(timezone.utc))
    if pend:
        print("KICK " + "; ".join(f"{g}/{i}@{q}" for i, g, q in pend))
    else:
        print("SKIP nenhum sorteio sem resultado entre 10 min e 24h depois do horario oficial")
    return 0


if __name__ == "__main__":
    sys.exit(main())
