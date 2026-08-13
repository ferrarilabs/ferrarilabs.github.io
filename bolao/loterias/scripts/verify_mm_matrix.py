#!/usr/bin/env python3
"""
Reconfere a matriz de prêmios da Mega Millions contra a fonte OFICIAL, centavo por centavo.

═══ POR QUE ISTO EXISTE ═════════════════════════════════════════════════════════════════════════

`matrixVerified: true` é uma afirmação sobre dinheiro de gente real. Uma bandeira que alguém
levanta uma vez e ninguém reconfere não é verificação — é lembrança, e lembrança envelhece sem
avisar. A matriz anterior era exatamente isso: valores "do modelo pós-abril/2025" com um
comentário ao lado admitindo que não tinham sido conferidos.

Então a bandeira passa a ter um dono: ENQUANTO ESTE SCRIPT PASSAR. Ele busca a matriz vigente em
megamillions.com e compara com `lottery_policy.json` faixa a faixa, multiplicador a multiplicador.
Se a loteria mudar a matriz — como fez em abril/2025, quando o bilhete passou de US$2 para US$5 e
o Megaplier deixou de existir — este script fica vermelho antes de alguém pagar o valor errado.

═══ O QUE A PRIMEIRA CONFERÊNCIA ACHOU (2026-08-13) ═════════════════════════════════════════════

Três faixas em que o valor oficial NÃO é o base vezes o fator:

    4 acertos      base US$599  ->  2X US$1.000   (599x2 = US$1.198)
    1 + Mega Ball  base US$4    ->  2X US$14      (4x2   = US$8)
    0 + Mega Ball  base US$2    ->  2X US$10      (2x2   = US$4)

O modelo `base x multiplicador` errava para os dois lados. Nenhum teste pegaria: a conta estava
certa, a premissa é que estava errada.
"""

import json
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

import lottery_core as L      # noqa: E402
import lottery_sources as S   # noqa: E402

MULTIPLICADORES = ["2", "3", "4", "5", "10"]
falhas = []


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


def matriz_oficial(dados=None):
    """A matriz vigente, como a própria Mega Millions a publica."""
    dados = dados if dados is not None else S._mm_api()
    pm = dados.get("PrizeMatrix") or {}
    if not pm.get("MatrixCurrent"):
        raise RuntimeError(
            f"MATRIZ_NAO_VIGENTE: a fonte devolveu MatrixID={pm.get('MatrixID')} com "
            f"MatrixCurrent={pm.get('MatrixCurrent')} — não dá para conferir contra uma matriz "
            f"que a própria loteria não considera a atual.")
    return pm


def _cents(valor):
    """Dólares da fonte -> centavos inteiros. `599.0` é US$599,00, não 599 centavos."""
    return int(round(float(valor) * 100))


def main():
    print("CONFERÊNCIA DA MATRIZ — Mega Millions\n")
    cfg = L.carrega_config()
    g = cfg["games"]["megamillions"]
    try:
        pm = matriz_oficial()
    except Exception as e:  # noqa: BLE001
        print(f"  FONTE INDISPONÍVEL: {type(e).__name__}: {e}")
        print("\nMM_PRIZE_MATRIX_VERIFIED = INDETERMINADO (fonte oficial fora do ar)")
        # Fonte fora do ar não é matriz errada. Falhar aqui transformaria uma indisponibilidade
        # de rede numa afirmação sobre dinheiro, que é justamente o que este arquivo combate.
        return 2

    print(f"  fonte: MatrixID={pm['MatrixID']}  vigente desde {str(pm['MatrixStart'])[:10]}  "
          f"bilhete US${pm['TicketPrice']}  bolas {pm['WhiteBallMax']}/{pm['MegaBallMax']}\n")

    # ── regras do jogo ──────────────────────────────────────────────────────────────────────
    checa("id da matriz confere", g.get("matrixId") == pm["MatrixID"],
          f"config={g.get('matrixId')} oficial={pm['MatrixID']}")
    checa("data de vigência confere",
          g.get("matrixEffectiveFrom") == str(pm["MatrixStart"])[:10],
          f"config={g.get('matrixEffectiveFrom')} oficial={str(pm['MatrixStart'])[:10]}")
    checa("preço do bilhete confere", g["ticketPriceCents"] == _cents(pm["TicketPrice"]),
          f"config={g['ticketPriceCents']} oficial={_cents(pm['TicketPrice'])} centavos")
    checa("faixa das bolas brancas confere", g["mainRange"] == [1, pm["WhiteBallMax"]],
          f"config={g['mainRange']} oficial=[1, {pm['WhiteBallMax']}]")
    checa("faixa da Mega Ball confere", g["specialRange"] == [1, pm["MegaBallMax"]],
          f"config={g['specialRange']} oficial=[1, {pm['MegaBallMax']}]")

    # ── multiplicadores ─────────────────────────────────────────────────────────────────────
    checa("multiplicadores do modelo atual", g["multiplierValues"] == [2, 3, 4, 5, 10],
          str(g["multiplierValues"]))
    checa("multiplicador é EMBUTIDO (não é Megaplier comprado à parte)",
          bool(g.get("builtInMultiplier")))

    # ── faixas ──────────────────────────────────────────────────────────────────────────────
    print()
    por_chave = {(f["main"], bool(f["special"])): f for f in g["prizeMatrix"]}
    vistas = set()
    for t in pm["PrizeTiers"]:
        chave = (t["TierWhiteBall"], bool(t["TierMegaBall"]))
        vistas.add(chave)
        faixa = por_chave.get(chave)
        if faixa is None:
            checa(f"faixa {chave} existe na config", False, "faixa oficial ausente do arquivo")
            continue
        if t["IsJackpot"]:
            checa(f"{faixa['label']:<16} é jackpot (valor não fixo)",
                  faixa.get("baseCents") is None)
            continue
        checa(f"{faixa['label']:<16} base",
              faixa.get("baseCents") == _cents(t["PrizeAmount"]),
              f"config={faixa.get('baseCents')} oficial={_cents(t['PrizeAmount'])}")
        tabela = faixa.get("byMultiplier") or {}
        for m in MULTIPLICADORES:
            oficial = _cents(t[f"Mega{m}"])
            checa(f"{faixa['label']:<16} {m}X",
                  tabela.get(m) == oficial,
                  f"config={tabela.get(m)} oficial={oficial}")

    faltando = set(por_chave) - vistas
    checa("nenhuma faixa inventada no arquivo", not faltando,
          f"sem correspondente oficial: {sorted(faltando)}" if faltando else "")

    print("\n" + "=" * 78)
    if falhas:
        print(f"MM_PRIZE_MATRIX_VERIFIED = NO ({len(falhas)} divergências)")
        for f in falhas:
            print(f"    - {f}")
        print("\n  A bandeira `matrixVerified` DEVE voltar a false até isto fechar: o motor "
              "estaria creditando dinheiro real com uma tabela que não é a da loteria.")
        return 1
    print("MM_PRIZE_MATRIX_VERIFIED = YES — config idêntica à fonte oficial, centavo por centavo")
    print(f"MM_MATRIX_VERIFIED_FLAG  = {str(bool(g.get('matrixVerified'))).lower()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
