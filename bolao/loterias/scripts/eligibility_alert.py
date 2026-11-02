#!/usr/bin/env python3
"""
AVISO DE ELEGIBILIDADE — "o jackpot passou do limiar e ninguem abriu o bolao".

─── POR QUE EXISTE ─────────────────────────────────────────────────────────────────────────────

Em 2026-10-08 a Powerball ja estava ELEGIVEL (US$516M) e ninguem soube: `lottery_poll.yml`
calculava a elegibilidade, nao avisava ninguem por desenho, e o push do estado era recusado em
silencio. O bolao so abriu em 2026-10-27, com o jackpot em US$716M, porque o Eduardo olhou.

Abrir continua sendo decisao do operador (o sistema RECOMENDA; quem recolhe dinheiro decide).
O que faltava era a recomendacao chegar a alguem. Este modulo decide, a partir do mesmo
`lottery_status.json` que a pagina le, SE ha algo a avisar. Quem avisa e o workflow, abrindo uma
issue atribuida ao operador -- o GitHub notifica por e-mail sem provedor novo nem segredo novo.

─── O QUE E "ALGO A AVISAR" ────────────────────────────────────────────────────────────────────

    ha `nextPool` (algum jogo acima do limiar)  E
    o sorteio corrente NAO e esse pool ja aberto (mesmo jogo, mesma data, em andamento)

E `known=False` quando algum jogo nao pode ser medido: uma fonte fora do ar nao autoriza abrir nem
fechar aviso -- sem isto, uma leitura falha fecharia a issue de um bolao que continua elegivel.

Puro: nao le rede nem escreve nada. Uso no workflow:
    python3 eligibility_alert.py --status <lottery_status.json> --github-output "$GITHUB_OUTPUT"
"""

from __future__ import annotations

import argparse
import json
import sys

LABEL = "bolao-elegivel"
# Estados do sorteio corrente em que o operador JA agiu: o sorteio existe no site. ELIGIBLE aqui e
# o sorteio criado por `open_next_draw.py` ainda sem participantes -- aberto, so vazio.
EM_ANDAMENTO = ("ELIGIBLE", "OPEN", "LOCKED", "AWAITING_RESULT")
# O unico jogo com bolao modelado no site. Pool de outro jogo nunca casa com o sorteio corrente.
JOGO_DO_SITE = "powerball"
PAGINA = "https://www.ferrarilabs.com/bolao/loterias/powerball/"


def _usd(cents) -> str:
    return "—" if cents is None else f"US${cents / 100 / 1e6:,.0f}M"


def chave(game: str, draw_date: str) -> str:
    return f"[bolao:{game}-{draw_date}]"


def decide(doc: dict) -> dict:
    jogos = (doc.get("games") or {}).values()
    if not jogos or any(g.get("error") for g in jogos):
        return {"known": False, "alert": False, "key": "",
                "reason": "algum jogo nao foi medido — nada a afirmar"}

    pool = doc.get("nextPool")
    if not pool:
        return {"known": True, "alert": False, "key": "", "reason": "nenhum jackpot acima do limiar"}

    atual = doc.get("currentDraw") or {}
    aberto = (pool["game"] == JOGO_DO_SITE and atual.get("id") == pool["drawDate"]
              and atual.get("lifecycleState") in EM_ANDAMENTO)
    k = chave(pool["game"], pool["drawDate"])
    if aberto:
        return {"known": True, "alert": False, "key": "",
                "reason": f"bolao de {pool['drawDate']} ja aberto ({atual['lifecycleState']})"}

    jogo = doc["games"].get(pool["game"], {})
    titulo = (f"{k} {pool['label']} acima do limiar: {_usd(pool['jackpotCents'])} "
              f"(sorteio {pool['drawDate']}) — abrir bolao")
    corpo = "\n".join([
        f"O jackpot anunciado da **{pool['label']}** para o sorteio de **{pool['drawDate']}** e "
        f"{_usd(pool['jackpotCents'])} (cash {_usd(jogo.get('cashValueCents'))}), acima do limiar "
        f"de {_usd(doc['threshold']['minJackpotCents'])}.",
        "",
        f"Sorteio corrente no site: `{atual.get('id')}` — {atual.get('lifecycleState')}.",
        f"Fonte: {jogo.get('source')} (lido em {jogo.get('fetchedAt')}).",
        "",
        "Abrir o bolao e decisao do operador. Caminho: `open_next_draw.py` + manifesto em "
        "`bolao/loterias/powerball/operations/` aplicado pelo `powerball_open_draw.yml`.",
        f"Pagina: {PAGINA}",
        "",
        "Esta issue foi aberta por `lottery_poll.yml` e e fechada por ele quando o bolao abrir "
        "ou o jackpot deixar de qualificar.",
    ])
    return {"known": True, "alert": True, "key": k, "title": titulo, "body": corpo,
            "reason": "elegivel e nao aberto"}


def escreve_saida(d: dict, caminho: str) -> None:
    """Formato de GITHUB_OUTPUT; o corpo e multilinha, entao vai com delimitador."""
    with open(caminho, "a", encoding="utf-8") as f:
        f.write(f"known={'true' if d['known'] else 'false'}\n")
        f.write(f"alert={'true' if d['alert'] else 'false'}\n")
        f.write(f"key={d['key']}\n")
        if d["alert"]:
            f.write(f"title={d['title']}\n")
            f.write("body<<__AVISO_FIM__\n" + d["body"] + "\n__AVISO_FIM__\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Decide se ha aviso de elegibilidade a dar")
    ap.add_argument("--status", required=True)
    ap.add_argument("--github-output")
    a = ap.parse_args(argv)
    d = decide(json.load(open(a.status, encoding="utf-8")))
    print(f"aviso: {'SIM' if d['alert'] else 'nao'} — {d['reason']} {d['key']}".rstrip())
    if a.github_output:
        escreve_saida(d, a.github_output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
