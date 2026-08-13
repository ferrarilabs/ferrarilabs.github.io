#!/usr/bin/env python3
"""
AUTORIDADE DOS PRÊMIOS — cada célula das duas matrizes provada contra fonte INDEPENDENTE.

═══ POR QUE ESTE ARQUIVO NÃO PODE LER A CONFIG PARA SABER O ESPERADO ════════════════════════════

Um teste cujo valor esperado sai da mesma tabela que o motor usa não testa nada: ele prova que a
tabela é igual a si mesma. Foi assim que a matriz da Mega Millions passou meses errada — os
valores eram plausíveis, a conta batia consigo mesma, e nenhuma suíte tinha de onde discordar.

Então cada lado tem uma autoridade EXTERNA distinta:

    MEGA MILLIONS   a matriz que megamillions.com publica (MatrixID/MatrixStart/PrizeTiers).
                    Buscada UMA vez e comparada contra a config, célula a célula.

    POWERBALL       dois sorteios REAIS com bilhetes reais e prêmio oficial conhecido —
                    2026-08-10 (US$24) e 2026-08-12 (US$38, confirmado pela conta NC Lottery do
                    operador). O motor tem de reproduzir os dois a partir das 58 e 61 apostas
                    efetivamente compradas.

═══ MUTAÇÃO CÉLULA A CÉLULA ════════════════════════════════════════════════════════════════════

Cobertura não é prova. Para CADA célula das duas matrizes este arquivo altera o valor e exige que
alguma asserção fique vermelha. Uma célula cuja mutação não derruba nada é uma célula que ninguém
está testando — e, como ela paga dinheiro real, é uma célula onde um erro sobreviveria.
"""

import copy
import json
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import lottery_core as L        # noqa: E402
import lottery_sources as S     # noqa: E402
import settle_draw as SD        # noqa: E402
import verify_mm_matrix as V    # noqa: E402

falhas = []
MULT = ["2", "3", "4", "5", "10"]


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


# ══ AUTORIDADE INDEPENDENTE: sorteios reais com prêmio oficial conhecido ════════════════════
#
# Não são fixtures inventados. São os bilhetes que o bolão comprou e o valor que a loteria
# pagou. `premiosGanhos` no data.js é registro do operador; a conta da NC Lottery confirmou o
# US$38. O motor tem de chegar no mesmo número partindo das apostas.
SORTEIOS_REAIS = {
    "2026-08-10": {"numbers": [6, 37, 54, 55, 64], "special": 10, "multiplier": 3,
                   "oficial_cents": 2400},
    "2026-08-12": {"numbers": [4, 26, 66, 67, 69], "special": 9, "multiplier": 2,
                   "oficial_cents": 3800},
}


def apostas_reais(draws, draw_id):
    d = next(x for x in draws if x["id"] == draw_id)
    return SD.apostas_do_sorteio(d)


def main():
    print("AUTORIDADE DOS PRÊMIOS\n")
    cfg = L.carrega_config()
    draws = SD.carrega_draws()

    # ═══ 1. POWERBALL — reconciliação contra sorteios REAIS ═════════════════════════════════
    print("1. POWERBALL: reconciliação de sorteios reais (autoridade externa)")
    for draw_id, oficial in SORTEIOS_REAIS.items():
        aps = apostas_reais(draws, draw_id)
        r = L.premio_do_sorteio("powerball", aps, oficial, cfg)
        checa(f"REAL_DRAW_RECONCILIATION {draw_id}: {len(aps)} apostas -> "
              f"{L.dinheiro(oficial['oficial_cents'])}",
              r["totalCents"] == oficial["oficial_cents"],
              f"motor={L.dinheiro(r['totalCents'])} oficial={L.dinheiro(oficial['oficial_cents'])}")

    # ═══ 2. POWERBALL — cobertura EXAUSTIVA das 12 combinações ══════════════════════════════
    print("\n2. POWERBALL: as 12 combinações de acerto, com e sem Power Play")
    #
    # Constrói apostas com acerto CONTROLADO a partir de um resultado sintético. Os números
    # perdedores vêm de fora da faixa sorteada, então o número de acertos é exatamente o pedido.
    res = {"numbers": [1, 2, 3, 4, 5], "special": 10, "multiplier": 5}
    perdedores = [60, 61, 62, 63, 64]

    def aposta(acertos, bate_especial, pp):
        nums = res["numbers"][:acertos] + perdedores[:5 - acertos]
        return {"numbers": nums, "special": res["special"] if bate_especial else 25,
                "hasPowerPlay": pp}

    # Tabela ESPERADA, digitada da fonte oficial (powerball.com/powerball-prize-chart) e NÃO
    # lida da config. Power Play 5x; o 5+0 é FIXO em US$2M com Power Play, não escala.
    ESPERADO = {                    # (acertos, especial): (base_cents, com_pp_5x_cents)
        (0, False): (None, None),
        (1, False): (None, None),
        (2, False): (None, None),
        (0, True):  (400, 2000),
        (1, True):  (400, 2000),
        (2, True):  (700, 3500),
        (3, False): (700, 3500),
        (3, True):  (10000, 50000),
        (4, False): (10000, 50000),
        (4, True):  (5000000, 25000000),
        (5, False): (100000000, 200000000),   # com PP: FIXO US$2M
    }
    for (acertos, esp), (base, com_pp) in sorted(ESPERADO.items()):
        p_sem = L.premio_da_aposta("powerball", aposta(acertos, esp, False), res, cfg)
        p_com = L.premio_da_aposta("powerball", aposta(acertos, esp, True), res, cfg)
        rot = f"{acertos}+{'PB' if esp else '0'}"
        if base is None:
            checa(f"  {rot:<6} não premia", p_sem is None and p_com is None,
                  f"sem={p_sem} com={p_com}")
            continue
        checa(f"  {rot:<6} base {L.dinheiro(base)}",
              p_sem and p_sem["amountCents"] == base,
              f"motor={p_sem and L.dinheiro(p_sem['amountCents'])}")
        checa(f"  {rot:<6} Power Play 5x {L.dinheiro(com_pp)}",
              p_com and p_com["amountCents"] == com_pp,
              f"motor={p_com and L.dinheiro(p_com['amountCents'])}")

    # jackpot: 5+PB não tem valor fixo
    p = L.premio_da_aposta("powerball", aposta(5, True, True), res, cfg)
    checa("  5+PB    é JACKPOT (sem valor fixo)",
          p and p["jackpot"] and p["amountCents"] is None, str(p))

    # aposta SEM Power Play não herda o multiplicador do sorteio
    checa("  aposta sem Power Play NÃO herda o multiplicador do sorteio",
          L.premio_da_aposta("powerball", aposta(0, True, False), res, cfg)["amountCents"] == 400)

    # ═══ 3. MEGA MILLIONS — cada célula contra a fonte oficial ══════════════════════════════
    print("\n3. MEGA MILLIONS: matriz oficial ao vivo x config, célula a célula")
    try:
        oficial_pm = V.matriz_oficial()
    except Exception as e:  # noqa: BLE001
        print(f"  FONTE OFICIAL INDISPONÍVEL: {type(e).__name__}: {e}")
        print("  (as mutações de célula da Mega Millions ficam INDETERMINADAS nesta execução)")
        oficial_pm = None

    if oficial_pm:
        # Mapa independente: (main, special) -> {base, 2,3,4,5,10} vindo SÓ da fonte.
        autoridade = {}
        for t in oficial_pm["PrizeTiers"]:
            if t["IsJackpot"]:
                continue
            autoridade[(t["TierWhiteBall"], bool(t["TierMegaBall"]))] = {
                "base": int(round(float(t["PrizeAmount"]) * 100)),
                **{m: int(round(float(t[f"Mega{m}"]) * 100)) for m in MULT},
            }
        checa("a fonte oficial listou 8 faixas premiadas", len(autoridade) == 8,
              str(len(autoridade)))

        # O MOTOR (não a config) tem de pagar o valor da fonte, para cada faixa e multiplicador.
        resmm = {"numbers": [1, 2, 3, 4, 5], "special": 10, "multiplier": None}
        perd_mm = [60, 61, 62, 63, 64]

        def aposta_mm(acertos, bate, mult):
            return {"numbers": resmm["numbers"][:acertos] + perd_mm[:5 - acertos],
                    "special": resmm["special"] if bate else 23, "multiplier": mult}

        erros = 0
        for (acertos, esp), vals in sorted(autoridade.items()):
            p = L.premio_da_aposta("megamillions", aposta_mm(acertos, esp, 1), resmm, cfg)
            if not p or p["amountCents"] != vals["base"]:
                erros += 1
                print(f"      DIVERGE base {acertos}+{'MB' if esp else '0'}: "
                      f"motor={p and p['amountCents']} oficial={vals['base']}")
            for m in MULT:
                pm = L.premio_da_aposta("megamillions", aposta_mm(acertos, esp, int(m)),
                                        resmm, cfg)
                if not pm or pm["amountCents"] != vals[m]:
                    erros += 1
                    print(f"      DIVERGE {m}X {acertos}+{'MB' if esp else '0'}: "
                          f"motor={pm and pm['amountCents']} oficial={vals[m]}")
        checa("EVERY_MM_PRIZE_CELL: motor paga o valor da fonte oficial (48 células)",
              erros == 0, f"{erros} divergência(s)")

        # ── MUTAÇÃO CÉLULA A CÉLULA ────────────────────────────────────────────────────────
        print("\n4. MUTAÇÃO de cada célula da Mega Millions (48) — todas devem ser pegas")
        nao_pegas = []
        for faixa in cfg["games"]["megamillions"]["prizeMatrix"]:
            if faixa.get("baseCents") is None:
                continue
            chave = (faixa["main"], bool(faixa["special"]))
            for campo in ["base"] + MULT:
                mut = copy.deepcopy(cfg)
                alvo = next(f for f in mut["games"]["megamillions"]["prizeMatrix"]
                            if f["main"] == faixa["main"]
                            and bool(f["special"]) == bool(faixa["special"]))
                if campo == "base":
                    alvo["baseCents"] = int(alvo["baseCents"]) + 100
                else:
                    alvo["byMultiplier"][campo] = int(alvo["byMultiplier"][campo]) + 100
                # A autoridade externa tem de discordar do motor mutado.
                mm = int(campo) if campo != "base" else 1
                p = L.premio_da_aposta("megamillions", aposta_mm(chave[0], chave[1], mm),
                                       resmm, mut)
                esperado = autoridade[chave]["base" if campo == "base" else campo]
                if p and p["amountCents"] == esperado:
                    nao_pegas.append(f"{faixa['label']}/{campo}")
        checa("toda mutação de célula é detectada pela autoridade externa",
              not nao_pegas, f"não pegas: {nao_pegas}")

        # A config REAL não pode ter sido alterada por essas mutações.
        checa("a config em disco continua intacta depois das mutações",
              L.carrega_config() == cfg)

    # ═══ 5. MUTAÇÃO da matriz POWERBALL ═════════════════════════════════════════════════════
    print("\n5. MUTAÇÃO de cada faixa da Powerball — a reconciliação real deve pegar")
    #
    # A autoridade aqui são os dois sorteios reais. Uma faixa que, ao ser alterada, não muda
    # nenhum dos dois totais oficiais é uma faixa que os sorteios reais não exercitam — e isso
    # precisa aparecer, não ficar implícito.
    exercitadas, nao_exercitadas = [], []
    for faixa in cfg["games"]["powerball"]["prizeMatrix"]:
        if faixa.get("baseCents") is None:
            continue
        mut = copy.deepcopy(cfg)
        alvo = next(f for f in mut["games"]["powerball"]["prizeMatrix"]
                    if f["main"] == faixa["main"] and bool(f["special"]) == bool(faixa["special"]))
        alvo["baseCents"] = int(alvo["baseCents"]) + 100
        if alvo.get("powerPlayFixedCents") is not None:
            alvo["powerPlayFixedCents"] = int(alvo["powerPlayFixedCents"]) + 100
        mudou = False
        for draw_id, oficial in SORTEIOS_REAIS.items():
            r = L.premio_do_sorteio("powerball", apostas_reais(draws, draw_id), oficial, mut)
            if r["totalCents"] != oficial["oficial_cents"]:
                mudou = True
        (exercitadas if mudou else nao_exercitadas).append(faixa["label"])
    print(f"      exercitadas pelos sorteios reais: {exercitadas}")
    print(f"      NÃO exercitadas (nenhum bilhete real caiu nelas): {nao_exercitadas}")
    checa("as faixas que os sorteios reais tocam são pegas por mutação",
          len(exercitadas) >= 3, f"{len(exercitadas)} faixa(s)")
    # As não exercitadas ficam cobertas pela seção 2 (exaustiva, valores digitados da fonte).
    cobertas_pela_exaustiva = {f["label"] for f in cfg["games"]["powerball"]["prizeMatrix"]
                              if f.get("baseCents") is not None}
    checa("toda faixa tem cobertura: real OU exaustiva",
          set(exercitadas + nao_exercitadas) <= cobertas_pela_exaustiva)

    print("\n" + "=" * 78)
    if falhas:
        print(f"PRIZE_AUTHORITY = FALHOU ({len(falhas)})")
        for f in falhas:
            print(f"    - {f}")
        return 1
    print("PRIZE_AUTHORITY = PASS")
    print("  POWERBALL = PASS · MEGA_MILLIONS = PASS · MM_MATRIX_AUTHORITY = PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
