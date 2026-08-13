#!/usr/bin/env python3
"""
Estado do ciclo de vida das loterias — o motor CONECTADO ao produto.

═══ O QUE ISTO FECHA ════════════════════════════════════════════════════════════════════════════

Existiam a política, o motor de prêmio e o livro-razão, e nada que os ligasse ao que o
participante vê. "Motor pronto, não conectado" é uma forma cara de não ter feito: a regra de
US$500M morava num arquivo de configuração que nenhuma tela lia, então na prática quem decidia
abrir bolão continuava sendo a memória de alguém.

Este módulo produz UM documento — `lottery_status.json` — que é a resposta completa a "e agora?":

    cada jogo:  jackpot anunciado, cash, próximo sorteio, ELEGÍVEL ou não, e por quê
    o próximo:  o jogo escolhido pela política, ou NENHUM
    o caixa:    prêmio do último sorteio e carryover disponível, DERIVADOS do livro-razão
    o sorteio:  em que ponto do ciclo ele está

A UI e o e-mail leem ESTE arquivo. Duas telas calculando elegibilidade por conta própria é como
se cria a divergência entre o que o site diz e o que o sistema faz.

═══ O CICLO ═════════════════════════════════════════════════════════════════════════════════════

    CLOSED ──▶ ELIGIBLE ──▶ OPEN ──▶ LOCKED ──▶ AWAITING_RESULT ──▶ SETTLED ──▶ CARRYOVER
              (automático)  (op.)   (automático)   (automático)     (automático)

O que é AUTOMÁTICO: medir jackpot, decidir elegibilidade, travar na hora do sorteio, esperar
resultado, liquidar, e levar o saldo adiante.

O que NÃO é: GASTAR. Não existe função de compra neste módulo, nem credencial de pagamento, nem
cliente HTTP que fale com meio de pagamento. A transição para OPEN — que é onde dinheiro passa a
ser recolhido — é declarada pelo operador. O sistema RECOMENDA; quem paga decide.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import lottery_core as L      # noqa: E402
import lottery_sources as S   # noqa: E402

SAIDA = RAIZ / "bolao" / "loterias" / "config" / "lottery_status.json"


def mede_jogos(cfg, fetcher=None, agora=None):
    """
    Jackpot corrente de cada jogo, com procedência. Falha de UM jogo não derruba o outro.

    Um erro de rede na Mega Millions não pode apagar a medição da Powerball do documento: a UI
    ficaria sem saber de nenhum dos dois por causa de um. Cada jogo carrega o próprio erro.
    """
    jogos = {}
    for jogo in cfg["games"]:
        try:
            j = S.jackpot_oficial(jogo, fetcher=fetcher, agora=agora)
            jogos[jogo] = {
                "game": jogo,
                "label": cfg["games"][jogo]["label"],
                "advertisedAnnuityCents": j["advertisedAnnuityCents"],
                "cashValueCents": j.get("cashValueCents"),
                "nextDrawDate": j.get("nextDrawDate"),
                "source": j.get("source"),
                "fetchedAt": j.get("fetchedAt"),
                "sourceHash": j.get("sourceHash"),
                "eligible": L.elegivel(j["advertisedAnnuityCents"], cfg),
                "state": L.estado_do_jogo(j["advertisedAnnuityCents"], cfg),
                "error": None,
            }
        except Exception as e:  # noqa: BLE001
            # `eligible: False` com erro NÃO é o mesmo que "medi e não qualifica". A UI precisa
            # distinguir: um jogo que não pôde ser medido não autoriza nem nega nada.
            jogos[jogo] = {"game": jogo, "label": cfg["games"][jogo]["label"],
                           "advertisedAnnuityCents": None, "cashValueCents": None,
                           "nextDrawDate": None, "eligible": False, "state": "UNKNOWN",
                           "error": f"{type(e).__name__}: {e}"[:200]}
    return jogos


def escolhe(jogos, cfg):
    """O próximo pool segundo a política. Devolve o jogo escolhido ou None."""
    candidatos = [{"game": g["game"], "jackpotCents": g["advertisedAnnuityCents"],
                   "drawDate": g["nextDrawDate"] or "9999-12-31"}
                  for g in jogos.values()
                  if g["eligible"] and g["advertisedAnnuityCents"] is not None]
    return L.escolhe_proximo_pool(candidatos, cfg)


def estado_do_sorteio(draw, agora=None):
    """
    Em que ponto do ciclo este sorteio está. Derivado do que está gravado, nunca declarado.

    Um campo `status` escrito à mão em `data.js` diverge do fato assim que alguém esquece de
    atualizá-lo — e "planejamento" é o que ainda está lá no sorteio de 12/08, que já foi
    sorteado, pago e liquidado. Por isso o estado é CALCULADO.
    """
    agora = agora or datetime.now(timezone.utc)
    if not draw:
        return "CLOSED", "nenhum sorteio registrado"
    tem_resultado = bool((draw.get("result") or {}).get("numbers"))
    iso = (draw.get("drawing") or {}).get("drawDateIso")
    sorteou = False
    if iso:
        try:
            sorteou = datetime.fromisoformat(iso) <= agora
        except ValueError:
            sorteou = False
    if tem_resultado:
        return "SETTLED", "resultado oficial gravado e prêmio creditado"
    if sorteou:
        return "AWAITING_RESULT", "o sorteio já ocorreu; aguardando publicação oficial"
    if draw.get("sharedTickets"):
        return "LOCKED", "bilhetes comprados; entradas encerradas"
    if draw.get("participants"):
        return "OPEN", "recolhendo contribuições"
    return "ELIGIBLE", "pool aberto pela política, ainda sem participantes"


def monta(cfg=None, draws=None, fetcher=None, agora=None, ledger=None):
    cfg = cfg or L.carrega_config()
    agora = agora or datetime.now(timezone.utc)
    jogos = mede_jogos(cfg, fetcher=fetcher, agora=agora)
    escolhido = escolhe(jogos, cfg)

    if draws is None:
        import settle_draw as SD
        draws = SD.carrega_draws()
    ultimo = draws[-1] if draws else None
    ciclo, porque = estado_do_sorteio(ultimo, agora)

    ev = L.le_ledger(ledger)
    premios = [e for e in ev if e["type"] == "PRIZE_CREDIT"]
    limiar = int(cfg["threshold"]["minJackpotCents"])

    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "threshold": {
            "minJackpotCents": limiar,
            "comparison": cfg["threshold"]["comparison"],
            "basis": cfg["threshold"]["basis"],
            "label": "Novo bolão somente quando o jackpot anunciado ultrapassar US$500 milhões.",
        },
        "games": jogos,
        "nextPool": ({"game": escolhido["game"],
                      "label": cfg["games"][escolhido["game"]]["label"],
                      "jackpotCents": escolhido["jackpotCents"],
                      "drawDate": escolhido["drawDate"]} if escolhido else None),
        "funds": {
            # Tudo DERIVADO do extrato. Não existe saldo guardado que possa divergir.
            "lastDrawWinningsCents": premios[-1]["amountCents"] if premios else 0,
            "lastDrawId": premios[-1].get("poolId") if premios else None,
            "carryoverAvailableCents": L.saldo(ledger),
            "ledgerEntries": len(ev),
        },
        "currentDraw": {
            "id": (ultimo or {}).get("id"),
            "lifecycleState": ciclo,
            "reason": porque,
            "result": (ultimo or {}).get("result"),
        },
        "autoPurchase": bool(cfg.get("autoPurchase")),
        "_doc": ("Documento gerado; nao editar a mao. A UI e o e-mail leem daqui para que exista "
                 "UMA resposta para 'ha bolao novo?'. Elegibilidade e ESTRITAMENTE > US$500M "
                 "sobre a anuidade anunciada do PROXIMO sorteio."),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(SAIDA))
    ap.add_argument("--print", action="store_true")
    args = ap.parse_args()

    doc = monta()
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n",
                              encoding="utf-8")

    print(f"ESTADO DAS LOTERIAS  ({doc['generatedAt']})\n")
    print(f"  LIMIAR  > {L.dinheiro(doc['threshold']['minJackpotCents'])} "
          f"({doc['threshold']['comparison']}, {doc['threshold']['basis']})\n")
    for g in doc["games"].values():
        if g.get("error"):
            print(f"  {g['label']:<14} NAO MEDIDO — {g['error'][:60]}")
            continue
        print(f"  {g['label']:<14} {L.dinheiro(g['advertisedAnnuityCents']):>20}  "
              f"cash {L.dinheiro(g['cashValueCents'] or 0):>16}  "
              f"sorteio {g['nextDrawDate']}  {g['state']}")
    np = doc["nextPool"]
    print(f"\n  NEXT_ELIGIBLE_GAME = {np['label'] if np else 'NONE'}")
    if not np:
        print("    nenhum jackpot ultrapassa o limiar — o carryover fica PARADO, "
              "sem bolao novo")
    f = doc["funds"]
    print(f"\n  ultimo premio        {L.dinheiro(f['lastDrawWinningsCents'])} "
          f"({f['lastDrawId']})")
    print(f"  carryover disponivel {L.dinheiro(f['carryoverAvailableCents'])}")
    print(f"\n  sorteio {doc['currentDraw']['id']}: {doc['currentDraw']['lifecycleState']} "
          f"— {doc['currentDraw']['reason']}")
    print(f"  AUTO_PURCHASE = {'YES' if doc['autoPurchase'] else 'NO'}")
    print(f"\n  escrito em {args.out}")
    if args.print:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
