#!/usr/bin/env python3
"""
IDENTIDADE DO JACKPOT — regressão permanente das duas confusões que já custaram caro.

═══ CONFUSÃO 1: O JACKPOT DO SORTEIO JÁ REALIZADO ══════════════════════════════════════════════

    DRAW_RESULT_JACKPOT != NEXT_DRAW_JACKPOT

`powerball.com/draw-result` mostra "Estimated Jackpot: $1.04 Billion" — o prêmio do sorteio de
2026-08-12, que é FATO HISTÓRICO. Medido na mesma hora, o próximo sorteio valia US$20 milhões: o
jackpot foi ganho e o jogo voltou ao piso.

Uma implementação anterior lia aquela página e concluiu que US$1,04 bilhão estava elegível. A
regra abre bolão acima de US$500M — teria aberto um bolão de dinheiro real sobre um jackpot que
não existia mais. O número era plausível, a página era oficial, e nada no sistema discordava.

    NEXT_JACKPOT_DRAW_AT > NOW  para todo registro de jackpot elegível

═══ CONFUSÃO 2: DATA EM UNIDADES DIFERENTES ════════════════════════════════════════════════════

As duas fontes publicam o instante do próximo sorteio em fusos diferentes:

    Powerball      data-drawdateutc="2026-08-16T02:59:00"   (UTC)
    Mega Millions  NextDrawingDate="2026-08-14T23:00:00"    (ET)

Lidas com um `[:10]` cru, a Powerball saía um dia à frente — a NC Lottery imprime "Saturday,
Aug. 15" para o mesmo sorteio que o sistema chamava de 2026-08-16. Isso aparecia na tela do
participante E entrava no desempate por "sorteio mais cedo", que decide qual jogo recebe o bolão.

Este arquivo prova que a data publicada é a data ET do sorteio, nos dois jogos, e que o instante
é guardado à parte.
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

import lottery_core as L      # noqa: E402
import lottery_sources as S   # noqa: E402

falhas = []
CFG = L.carrega_config()


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


# HTML real das duas páginas da powerball.com, reduzido ao que importa. O ponto do teste é que
# as DUAS são oficiais e trazem números diferentes — e só uma delas responde "quanto vale o
# próximo sorteio".
HTML_RESULTADO_JA_SORTEADO = """
<title>Powerball Draw Result - Wed, Aug 12, 2026 | Powerball</title>
<div class="col-12 estimated-jackpot"><span class="prize-label"> Estimated Jackpot: </span>
<span>$1.04 Billion</span></div>
<div class="col-12 cash-value"><span class="prize-label"> Cash Value: </span>
<span>$450.5 Million</span></div>
"""


def html_proximo(instante_utc, valor="$20 Million"):
    return (f'<h4> Next Drawing </h4>'
            f'<div id="nextDraw" data-drawdateutc="{instante_utc}">'
            f'<span> Estimated Jackpot </span>'
            f'<span class="game-jackpot-number">{valor}</span>'
            f'<span> Cash Value </span>'
            f'<span class="game-jackpot-number">$8.7 Million</span></div>')


def main():
    print("IDENTIDADE DO JACKPOT\n")
    agora = datetime.now(timezone.utc)
    futuro = (agora + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S")
    passado = (agora - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S")

    original = S._http
    try:
        # ═══ 1. DRAW_RESULT_JACKPOT != NEXT_DRAW_JACKPOT ════════════════════════════════════
        print("1. o jackpot do sorteio JÁ REALIZADO não é o do próximo")
        S._http = lambda *a, **kw: html_proximo(futuro, "$20 Million")
        proximo = S.jackpot_oficial("powerball", agora=agora)
        checa("o próximo sorteio é lido como US$20M",
              proximo["advertisedAnnuityCents"] == 2000000000,
              str(proximo["advertisedAnnuityCents"]))

        # A página do sorteio realizado anuncia US$1,04 bilhão. Se ela fosse a fonte, o sistema
        # concluiria ELEGÍVEL — e é exatamente o que aconteceu.
        historico = S._cents("1.04 Billion")
        checa("a página do sorteio realizado anuncia US$1,04 bi", historico == 104000000000,
              str(historico))
        checa("DRAW_RESULT_JACKPOT != NEXT_DRAW_JACKPOT",
              historico != proximo["advertisedAnnuityCents"],
              f"histórico={L.dinheiro(historico)} próximo="
              f"{L.dinheiro(proximo['advertisedAnnuityCents'])}")
        checa("o histórico QUALIFICARIA e o próximo NÃO — a diferença é um bolão inteiro",
              L.elegivel(historico, CFG) is True
              and L.elegivel(proximo["advertisedAnnuityCents"], CFG) is False)

        # ═══ 2. NEXT_JACKPOT_DRAW_AT > NOW ══════════════════════════════════════════════════
        print("\n2. todo jackpot utilizável pertence a um sorteio FUTURO")
        instante = datetime.fromisoformat(proximo["nextDrawAt"].replace("Z", "+00:00"))
        checa("NEXT_JACKPOT_DRAW_AT > NOW", instante > agora,
              f"{proximo['nextDrawAt']} vs agora {agora:%Y-%m-%dT%H:%M:%SZ}")

        S._http = lambda *a, **kw: html_proximo(passado, "$1.04 Billion")
        try:
            S.jackpot_oficial("powerball", agora=agora)
            checa("jackpot de sorteio PASSADO é recusado", False, "não levantou")
        except S.JackpotDeSorteioPassado:
            checa("jackpot de sorteio PASSADO é recusado", True)

        # MUTAÇÃO EXIGIDA: trocar a validação de sorteio futuro pela página de resultado.
        # Sem a guarda, o valor histórico entra como se fosse o do próximo sorteio.
        print("\n3. MUTAÇÃO: usar a página de resultado como fonte do próximo jackpot")
        S._http = lambda *a, **kw: HTML_RESULTADO_JA_SORTEADO
        try:
            j = S.jackpot_oficial("powerball", agora=agora)
            pegou = False
            detalhe = f"aceitou {L.dinheiro(j['advertisedAnnuityCents'])} sem data de sorteio"
        except S.ResultadoInvalido as e:
            pegou = True
            detalhe = type(e).__name__
        checa("MUTAÇÃO fica VERMELHA: página de resultado não tem sorteio futuro", pegou,
              detalhe)

        # ═══ 4. DATA EM ET, NOS DOIS JOGOS ══════════════════════════════════════════════════
        print("\n4. a data publicada é a data ET do sorteio, não a UTC")
        # Sábado 2026-08-15 22:59 ET == 2026-08-16 02:59 UTC. A data do sorteio é 15.
        S._http = lambda *a, **kw: html_proximo("2026-08-16T02:59:00")
        pb = S.jackpot_oficial("powerball",
                               agora=datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc))
        checa("Powerball: 2026-08-16T02:59Z é o sorteio de 2026-08-15 (ET)",
              pb["nextDrawDate"] == "2026-08-15", pb["nextDrawDate"])
        checa("  e o instante segue guardado em UTC",
              pb["nextDrawAt"] == "2026-08-16T02:59:00Z", pb["nextDrawAt"])

        # Mega Millions publica em ET; a data não pode ser deslocada.
        mm = S._datas_do_sorteio("2026-08-14T23:00:00", "ET")
        checa("Mega Millions: 2026-08-14T23:00 ET continua sendo 2026-08-14",
              mm["nextDrawDate"] == "2026-08-14", mm["nextDrawDate"])
        checa("  e vira 2026-08-15T03:00Z em UTC", mm["nextDrawAt"] == "2026-08-15T03:00:00Z",
              mm["nextDrawAt"])

        checa("os DOIS jogos publicam a data na MESMA unidade (ET)",
              len(pb["nextDrawDate"]) == len(mm["nextDrawDate"]) == 10
              and pb["nextDrawAt"].endswith("Z") and mm["nextDrawAt"].endswith("Z"))

        # MUTAÇÃO: voltar a fatiar o instante cru. A data da Powerball anda um dia.
        print("\n5. MUTAÇÃO: fatiar o instante cru em vez de converter para ET")
        ingenuo = "2026-08-16T02:59:00"[:10]
        checa("MUTAÇÃO fica VERMELHA: o corte cru dá 2026-08-16, o sorteio é 2026-08-15",
              ingenuo != pb["nextDrawDate"], f"cru={ingenuo} correto={pb['nextDrawDate']}")

        # ═══ 6. O DESEMPATE COMPARA UNIDADES IGUAIS ═════════════════════════════════════════
        print("\n6. desempate por sorteio mais cedo, com as duas datas em ET")
        empate = [{"game": "powerball", "jackpotCents": 60000000000,
                   "drawDate": pb["nextDrawDate"]},
                  {"game": "megamillions", "jackpotCents": 60000000000,
                   "drawDate": mm["nextDrawDate"]}]
        escolhido = L.escolhe_proximo_pool(empate, CFG)
        checa("jackpots iguais -> vence o sorteio mais cedo (MM 14 < PB 15)",
              escolhido["game"] == "megamillions", str(escolhido))
        # Invertido: se a Powerball sortear antes, tem de vencer.
        empate2 = [{"game": "powerball", "jackpotCents": 60000000000, "drawDate": "2026-08-13"},
                   {"game": "megamillions", "jackpotCents": 60000000000,
                    "drawDate": "2026-08-14"}]
        checa("e o inverso também",
              L.escolhe_proximo_pool(empate2, CFG)["game"] == "powerball")
        # Jackpot maior vence antes da data.
        maior = [{"game": "powerball", "jackpotCents": 90000000000, "drawDate": "2026-08-15"},
                 {"game": "megamillions", "jackpotCents": 60000000000,
                  "drawDate": "2026-08-14"}]
        checa("jackpot MAIOR vence a data mais cedo",
              L.escolhe_proximo_pool(maior, CFG)["game"] == "powerball")
    finally:
        S._http = original

    print("\n" + "=" * 78)
    if falhas:
        print(f"JACKPOT_IDENTITY = FALHOU ({len(falhas)})")
        for f in falhas:
            print(f"    - {f}")
        return 1
    print("JACKPOT_IDENTITY = PASS")
    print("  DRAW_RESULT_JACKPOT != NEXT_DRAW_JACKPOT · NEXT_JACKPOT_DRAW_AT > NOW · "
          "datas em ET nos dois jogos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
