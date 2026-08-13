#!/usr/bin/env python3
"""
Prova do núcleo das loterias — sem rede, sem banco, sem e-mail, sem compra.

O motor de prêmio da Powerball é conferido contra um sorteio REAL já liquidado (2026-08-12 ainda
não tem resultado; 2026-08-10 tem, com `premiosGanhos` oficial de US$24). Reproduzir um resultado
conhecido a partir dos bilhetes gravados é o que prova que o motor continua o mesmo — uma tabela
de prêmios inventada bate com ela mesma, não com o passado.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import lottery_core as L      # noqa: E402
import lottery_sources as S   # noqa: E402

falhas = []
CFG = L.carrega_config()


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


def draws():
    out = subprocess.run(
        ["node", "-e",
         f"global.window={{}};require({json.dumps(str(RAIZ / 'bolao/loterias/powerball/js/data.js'))});"
         "process.stdout.write(JSON.stringify(window.POWERBALL_DRAWS));"],
        capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def apostas_do_sorteio(d):
    """Converte os bilhetes gravados em apostas. Power Play vem do PREÇO pago, não do sorteio."""
    st = d.get("sharedTickets") or {}
    preco = int(st.get("valorPorTicket") or 0)
    tem_pp = preco >= 3            # US$2 base + US$1 de Power Play
    saida = []
    for serie in st.get("series") or []:
        for linha in serie.get("numeros") or []:
            esq, dir_ = linha.split("—")
            nums = [int(x) for x in esq.strip().split("-")]
            esp = int(dir_.strip().split()[-1])
            saida.append({"numbers": nums, "special": esp, "hasPowerPlay": tem_pp})
    return saida


def main():
    print("PROVA — núcleo das loterias\n")

    # ═══ LIMIAR DE JACKPOT ═══════════════════════════════════════════════════════════════════
    print("1. limiar: estritamente MAIOR que US$500M")
    checa("JACKPOT_499999999 = NOT_ELIGIBLE", L.elegivel(49999999900, CFG) is False)
    checa("JACKPOT_500000000 = NOT_ELIGIBLE", L.elegivel(50000000000, CFG) is False,
          "exatamente US$500M não qualifica")
    checa("JACKPOT_500000001 = ELIGIBLE", L.elegivel(50000000100, CFG) is True)
    checa("jackpot ausente não qualifica", L.elegivel(None, CFG) is False)
    checa("base é anuidade, nunca cash value", CFG["threshold"]["basis"] == "advertised_annuity")
    checa("estado abaixo do limiar", L.estado_do_jogo(42000000000, CFG) == "BELOW_THRESHOLD")
    checa("estado elegível", L.estado_do_jogo(61000000000, CFG) == "ELIGIBLE")

    # ═══ SELEÇÃO DO PRÓXIMO POOL ═════════════════════════════════════════════════════════════
    print("\n2. BOTH_ELIGIBLE_SELECTION")
    pb = {"game": "powerball", "jackpotCents": 55000000000, "drawDate": "2026-08-15"}
    mm = {"game": "megamillions", "jackpotCents": 61000000000, "drawDate": "2026-08-14"}
    checa("os dois elegíveis -> maior jackpot",
          L.escolhe_proximo_pool([pb, mm], CFG)["game"] == "megamillions")
    empate_a = {"game": "powerball", "jackpotCents": 60000000000, "drawDate": "2026-08-15"}
    empate_b = {"game": "megamillions", "jackpotCents": 60000000000, "drawDate": "2026-08-14"}
    checa("empate no jackpot -> sorteio mais cedo",
          L.escolhe_proximo_pool([empate_a, empate_b], CFG)["game"] == "megamillions")
    checa("nenhum elegível -> nenhum pool",
          L.escolhe_proximo_pool([{"game": "powerball", "jackpotCents": 40000000000,
                                   "drawDate": "2026-08-15"}], CFG) is None)
    checa("MAX_ACTIVE_LOTTERY_POOLS = 1", CFG["pools"]["maxActive"] == 1)
    checa("política é dado, não código",
          CFG["pools"]["selection"] == ["larger_advertised_annuity", "earlier_draw_date"])

    # ═══ MOTOR DE PRÊMIO — POWERBALL, CONTRA SORTEIO REAL ════════════════════════════════════
    print("\n3. POWERBALL_PRIZE_ENGINE — reproduz um sorteio real já liquidado")
    d10 = next(d for d in draws() if d["id"] == "2026-08-10")
    res = {"numbers": d10["result"]["numbers"], "special": d10["result"]["special"],
           "multiplier": d10["result"]["multiplier"]}
    calc = L.premio_do_sorteio("powerball", apostas_do_sorteio(d10), res, CFG)
    oficial = int(d10["result"]["premiosGanhos"]) * 100
    checa("total bate com premiosGanhos oficial", calc["totalCents"] == oficial,
          f"calculado={L.dinheiro(calc['totalCents'])} oficial={L.dinheiro(oficial)}")
    rotulos = sorted(l["label"] for l in calc["linhas"])
    checa("detalhamento bate com o breakdown gravado",
          rotulos == sorted(["1 + Powerball", "Powerball"]), str(rotulos))

    print("\n4. faixas e Power Play por APOSTA")
    r = {"numbers": [1, 2, 3, 4, 5], "special": 9, "multiplier": 3}
    com = {"numbers": [1, 2, 3, 4, 5], "special": 9, "hasPowerPlay": True}
    sem = {"numbers": [1, 2, 3, 4, 5], "special": 9, "hasPowerPlay": False}
    checa("5+PB = JACKPOT", L.premio_da_aposta("powerball", com, r, CFG)["jackpot"] is True)
    r2 = dict(r, special=26)
    checa("5+0 com Power Play é FIXO em US$2M (não escala)",
          L.premio_da_aposta("powerball", com, r2, CFG)["amountCents"] == 200000000)
    checa("5+0 sem Power Play = US$1M",
          L.premio_da_aposta("powerball", sem, r2, CFG)["amountCents"] == 100000000)
    so_pb_com = {"numbers": [60, 61, 62, 63, 64], "special": 9, "hasPowerPlay": True}
    so_pb_sem = {"numbers": [60, 61, 62, 63, 64], "special": 9, "hasPowerPlay": False}
    checa("0+PB com Power Play 3x = US$12",
          L.premio_da_aposta("powerball", so_pb_com, r, CFG)["amountCents"] == 1200)
    checa("0+PB SEM Power Play = US$4 (não herda o multiplicador do sorteio)",
          L.premio_da_aposta("powerball", so_pb_sem, r, CFG)["amountCents"] == 400,
          "inferir a opção não comprada pagaria a mais")
    checa("sem faixa = sem prêmio",
          L.premio_da_aposta("powerball", {"numbers": [60, 61, 62, 63, 64], "special": 26,
                                           "hasPowerPlay": True}, r, CFG) is None)

    # ═══ MEGA MILLIONS ═══════════════════════════════════════════════════════════════════════
    print("\n5. MEGA_MILLIONS_CURRENT_MATRIX — modelo pós-abril/2025")
    mmg = CFG["games"]["megamillions"]
    checa("bilhete US$5", mmg["ticketPriceCents"] == 500)
    checa("multiplicador EMBUTIDO por aposta", mmg["builtInMultiplier"] is True)
    checa("valores 2X/3X/4X/5X/10X", mmg["multiplierValues"] == [2, 3, 4, 5, 10])
    # A varredura ignora chaves `_doc`: a prova é ESTRUTURAL. A primeira versão varria o objeto
    # inteiro e acusava a própria documentação, que cita "Megaplier" justamente para explicar que
    # ele acabou — um gate lendo a própria prosa, o mesmo engano que já apareceu neste repositório.
    estrutura = {k: v for k, v in mmg.items() if not k.startswith("_")}
    checa("nenhum campo estrutural de Megaplier", "megaplier" not in json.dumps(estrutura).lower())
    checa("nenhuma faixa depende do multiplicador do SORTEIO",
          all("drawMultiplier" not in f for f in mmg["prizeMatrix"]))
    checa("preço não é o antigo de US$2", mmg["ticketPriceCents"] != 200)
    # A matriz ainda não conferida BLOQUEIA cálculo de dinheiro — de propósito.
    try:
        L.premio_da_aposta("megamillions", {"numbers": [1, 2, 3, 4, 5], "special": 1,
                                            "multiplier": 5}, r, CFG)
        checa("matriz não conferida bloqueia cálculo", False, "não levantou")
    except RuntimeError as e:
        checa("matriz não conferida bloqueia cálculo", "MATRIZ_NAO_CONFERIDA" in str(e))
    # Com a bandeira virada, o multiplicador vem da APOSTA (não do sorteio).
    cfg2 = json.loads(json.dumps(CFG))
    cfg2["games"]["megamillions"]["matrixVerified"] = True
    so_mb = {"numbers": [60, 61, 62, 63, 64], "special": 9, "multiplier": 5}
    checa("0+MB com multiplicador 5X da aposta = US$10",
          L.premio_da_aposta("megamillions", so_mb, r, cfg2)["amountCents"] == 1000)
    so_mb10 = dict(so_mb, multiplier=10)
    checa("o multiplicador é da APOSTA, não do sorteio (10X = US$20)",
          L.premio_da_aposta("megamillions", so_mb10, r, cfg2)["amountCents"] == 2000)

    # ═══ FONTES ══════════════════════════════════════════════════════════════════════════════
    print("\n6. fontes: primária manda, obsoleto é recusado")
    valido = {"drawDate": "2026-08-12", "numbers": [5, 12, 30, 44, 60], "special": 7,
              "multiplier": 3}

    def so_primaria(fonte, jogo, dd):
        if fonte in ("powerball_official", "megamillions_official"):
            return dict(valido, source=fonte)
        raise AssertionError(f"não deveria consultar {fonte}: a primária já respondeu")

    r1, t1 = S.resultado_pronto("powerball", "2026-08-12", CFG, so_primaria)
    checa("PB_PRIMARY_RESULT_SOURCE", r1 and r1["verificationState"] == "PRIMARY_CONFIRMED",
          str(t1))
    checa("não consulta o NY Open Data quando a oficial já respondeu", len(t1) == 1, str(t1))
    r2m, _ = S.resultado_pronto("megamillions", "2026-08-12", CFG, so_primaria)
    checa("MM_PRIMARY_RESULT_SOURCE", r2m and r2m["verificationState"] == "PRIMARY_CONFIRMED")

    def obsoleta(fonte, jogo, dd):
        return {"drawDate": "2026-08-10", "numbers": [6, 37, 54, 55, 64], "special": 10,
                "multiplier": 3, "source": fonte}

    r3, t3 = S.resultado_pronto("powerball", "2026-08-12", CFG, obsoleta)
    checa("PB_STALE_RESULT_REJECTED", r3 is None, str(r3))
    checa("o motivo nomeia a desatualização",
          all("RESULTADO_DESATUALIZADO" in x["motivo"] for x in t3 if not x["ok"]), str(t3))
    r4, _ = S.resultado_pronto("megamillions", "2026-08-12", CFG, obsoleta)
    checa("MM_STALE_RESULT_REJECTED", r4 is None)

    def so_fallback(fonte, jogo, dd):
        if fonte == "ny_open_data":
            return dict(valido, source=fonte)
        raise RuntimeError("fonte oficial fora do ar")

    r5, t5 = S.resultado_pronto("powerball", "2026-08-12", CFG, so_fallback)
    checa("PB_NY_FALLBACK", r5 and r5["verificationState"] == "FALLBACK_AUDIT_ONLY", str(t5))
    checa("o fallback só entra depois das duas primeiras", len(t5) == 3, str(t5))

    print("\n7. validação estrutural — nenhum resultado chutado")
    for nome, payload in [
        ("sem drawDate", {"numbers": [1, 2, 3, 4, 5], "special": 1}),
        ("4 números", {"drawDate": "2026-08-12", "numbers": [1, 2, 3, 4], "special": 1}),
        ("número repetido", {"drawDate": "2026-08-12", "numbers": [1, 1, 3, 4, 5], "special": 1}),
        ("fora da faixa", {"drawDate": "2026-08-12", "numbers": [1, 2, 3, 4, 99], "special": 1}),
        ("sem bola especial", {"drawDate": "2026-08-12", "numbers": [1, 2, 3, 4, 5]}),
        ("especial fora da faixa", {"drawDate": "2026-08-12", "numbers": [1, 2, 3, 4, 5],
                                    "special": 99}),
    ]:
        try:
            S.valida(payload, "powerball", "2026-08-12", (1, 69), (1, 26))
            checa(f"recusa: {nome}", False, "aceitou")
        except S.ResultadoInvalido:
            checa(f"recusa: {nome}", True)

    # ═══ LIVRO-RAZÃO ═════════════════════════════════════════════════════════════════════════
    print("\n8. livro-razão: append-only, saldo derivado, idempotente")
    with tempfile.TemporaryDirectory() as td:
        lz = Path(td) / "l.jsonl"
        base = {"poolId": "2026-08-12", "reason": "teste", "source": "test"}
        L.append_ledger({**base, "type": "CONTRIBUTION", "amountCents": 16000,
                         "idempotencyKey": "c1"}, lz)
        L.append_ledger({**base, "type": "CARRYOVER_IN", "amountCents": 2400,
                         "idempotencyKey": "k1"}, lz)
        L.append_ledger({**base, "type": "TICKET_PURCHASE", "amountCents": -18300,
                         "idempotencyKey": "t1"}, lz)
        checa("saldo derivado = 160 + 24 - 183 = US$1", L.saldo(lz) == 100,
              L.dinheiro(L.saldo(lz)))

        chave = L.chave_premio("powerball", "2026-08-12", "abc123")
        gravou1, _ = L.append_ledger({**base, "type": "PRIZE_CREDIT", "amountCents": 4200,
                                      "idempotencyKey": chave}, lz)
        gravou2, _ = L.append_ledger({**base, "type": "PRIZE_CREDIT", "amountCents": 4200,
                                      "idempotencyKey": chave}, lz)
        checa("primeiro crédito grava", gravou1 is True)
        checa("PRIZE_DOUBLE_CREDIT = 0", gravou2 is False)
        checa("saldo após prêmio = US$43", L.saldo(lz) == 4300, L.dinheiro(L.saldo(lz)))
        # Reprocessar o mesmo sorteio dez vezes não move o caixa.
        for _ in range(10):
            L.append_ledger({**base, "type": "PRIZE_CREDIT", "amountCents": 4200,
                             "idempotencyKey": chave}, lz)
        checa("reprocessar 10x credita zero", L.saldo(lz) == 4300)

        ck = L.chave_carryover("2026-08-12", "2026-08-15")
        a, _ = L.append_ledger({**base, "type": "CARRYOVER_OUT", "amountCents": -4300,
                                "idempotencyKey": ck}, lz)
        b, _ = L.append_ledger({**base, "type": "CARRYOVER_OUT", "amountCents": -4300,
                               "idempotencyKey": ck}, lz)
        checa("CARRYOVER_DOUBLE_APPLY = 0", a is True and b is False)
        checa("saldo zera após transferir", L.saldo(lz) == 0)

        checa("histórico preservado (nada reescrito)", len(L.le_ledger(lz)) == 5,
              f"lançamentos={len(L.le_ledger(lz))}")
        for campo in ("idempotencyKey", "poolId", "amountCents", "reason", "source"):
            try:
                mau = {**base, "type": "CONTRIBUTION", "amountCents": 1, "idempotencyKey": "x"}
                del mau[campo]
                L.append_ledger(mau, lz)
                checa(f"exige '{campo}'", False, "aceitou sem")
            except ValueError:
                checa(f"exige '{campo}'", True)
        try:
            L.append_ledger({**base, "type": "NAO_EXISTE", "amountCents": 1,
                             "idempotencyKey": "z"}, lz)
            checa("recusa tipo inválido", False)
        except ValueError:
            checa("recusa tipo inválido", True)

    # ═══ IDENTIDADE DO RESULTADO ═════════════════════════════════════════════════════════════
    print("\n9. DRAW_RESULT_IDENTITY")
    h1 = L.hash_resultado("powerball", "2026-08-12", valido)
    h2 = L.hash_resultado("powerball", "2026-08-12", dict(valido, numbers=[60, 44, 30, 12, 5]))
    checa("ordem dos números não muda a identidade", h1 == h2)
    h3 = L.hash_resultado("powerball", "2026-08-12", dict(valido, special=8))
    checa("bola especial diferente muda a identidade", h1 != h3)
    h4 = L.hash_resultado("megamillions", "2026-08-12", valido)
    checa("jogo diferente muda a identidade", h1 != h4)

    print("\n10. AUTO_PURCHASE = NO")
    checa("configuração desliga compra automática", CFG["autoPurchase"] is False)
    fontes_py = (AQUI / "lottery_core.py").read_text() + (AQUI / "lottery_sources.py").read_text()
    for proibido in ("requests.post", "stripe", "checkout", "payment", "comprar_bilhete"):
        checa(f"nenhum caminho de compra: '{proibido}'", proibido not in fontes_py.lower())

    print("\n" + "=" * 78)
    if falhas:
        print(f"FALHOU — {len(falhas)}: {falhas}")
        return 1
    print("NÚCLEO DAS LOTERIAS APROVADO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
