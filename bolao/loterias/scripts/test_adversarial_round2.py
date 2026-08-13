#!/usr/bin/env python3
"""
RODADA 2 — ataque com estratégia DIFERENTE da rodada 1.

A rodada 1 atacou por inspeção dirigida: ler o código, achar a suposição, quebrá-la. Repetir
isso encontraria os mesmos lugares. Esta rodada muda o método de propósito:

    PROPRIEDADES GERADAS   milhares de casos aleatórios, em vez de exemplos escolhidos
    HORÁRIO DE VERÃO       a virada de novembro, que só existe em duas noites por ano
    DIREÇÃO INVERTIDA      na rodada 1 a primária discordava; aqui é a secundária
    ORDEM DOS LANÇAMENTOS  o extrato permutado, não na ordem em que foi escrito
    PATOLOGIAS DE REDE     gzip, 429, redirect, corpo cortado — nenhuma pode virar "sem prêmio"
    TRANSIÇÕES ILEGAIS     o que o ciclo de vida deve RECUSAR, não o que ele aceita

O objetivo não é confirmar a rodada 1. É falsificá-la.
"""

import copy
import io
import json
import os
import random
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

import lottery_core as L        # noqa: E402
import lottery_sources as S     # noqa: E402
import lottery_status as ST     # noqa: E402
import poll_results as P        # noqa: E402

falhas = []
CFG = L.carrega_config()
ET = ZoneInfo("America/New_York")
random.seed(20260813)          # determinístico: um teste que muda de resultado não é portão


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


def livro():
    return Path(tempfile.mkdtemp(prefix="r2-")) / "l.jsonl"


# ══ 1. PROPRIEDADE: o saldo não depende da ORDEM dos lançamentos ════════════════════════════
def secao_ordem():
    print("\n1. PROPRIEDADE: saldo derivado é invariante à ordem (500 permutações)")
    tipos_pos = ["CONTRIBUTION", "PRIZE_CREDIT", "CARRYOVER_IN"]
    divergiu = 0
    for caso in range(500):
        eventos = []
        for i in range(random.randint(2, 8)):
            t = random.choice(tipos_pos + ["TICKET_PURCHASE"])
            v = random.randint(1, 500000)
            eventos.append({"type": t, "idempotencyKey": f"c{caso}-e{i}", "poolId": "p",
                            "amountCents": -v if t == "TICKET_PURCHASE" else v,
                            "reason": "r", "source": "s"})
        saldos = set()
        for _ in range(3):
            ordem = eventos[:]
            random.shuffle(ordem)
            p = livro()
            for e in ordem:
                L.append_ledger(dict(e), p)
            saldos.add(L.saldo(p))
        if len(saldos) != 1:
            divergiu += 1
    checa("500 conjuntos x 3 permutações: saldo idêntico", divergiu == 0,
          f"{divergiu} divergência(s)")

    print("   PROPRIEDADE: reaplicar N vezes em ordem aleatória credita o mesmo")
    p = livro()
    base = [{"type": "PRIZE_CREDIT", "idempotencyKey": f"k{i}", "poolId": "p",
             "amountCents": 100 * (i + 1), "reason": "r", "source": "s"} for i in range(6)]
    for _ in range(20):
        ordem = base[:]
        random.shuffle(ordem)
        for e in ordem:
            L.append_ledger(dict(e), p)
    esperado = sum(e["amountCents"] for e in base)
    checa("20 reaplicações embaralhadas -> saldo = soma única", L.saldo(p) == esperado,
          f"{L.dinheiro(L.saldo(p))} vs {L.dinheiro(esperado)}")
    checa("  e nenhuma linha duplicada", len(L.le_ledger(p)) == len(base))


# ══ 2. PROPRIEDADE: a fronteira do limiar, gerada ═══════════════════════════════════════════
def secao_limiar():
    print("\n2. PROPRIEDADE: limiar ESTRITAMENTE > US$500M (2000 valores gerados)")
    piso = int(CFG["threshold"]["minJackpotCents"])
    erros = []
    # Vizinhança exata do piso — onde um `>=` se esconderia.
    for d in range(-3, 4):
        v = piso + d
        if L.elegivel(v, CFG) != (v > piso):
            erros.append(v)
    # E uma nuvem larga.
    for _ in range(2000):
        v = random.randint(0, 3 * piso)
        if L.elegivel(v, CFG) != (v > piso):
            erros.append(v)
    checa("elegível(x) <=> x > piso, sem exceção", not erros, f"{len(erros)} contraexemplo(s)")
    checa("US$500.000.000,00 exatos NÃO qualificam", L.elegivel(piso, CFG) is False)
    checa("um centavo acima qualifica", L.elegivel(piso + 1, CFG) is True)
    checa("None não qualifica (ausência não é zero)", L.elegivel(None, CFG) is False)

    print("   PROPRIEDADE: a seleção escolhe o maior; empate -> sorteio mais cedo")
    ruim = 0
    for _ in range(1000):
        a = random.randint(piso - 10**8, piso + 10**11)
        b = random.randint(piso - 10**8, piso + 10**11)
        da = f"2026-08-{random.randint(10, 28):02d}"
        db = f"2026-08-{random.randint(10, 28):02d}"
        cands = [{"game": "powerball", "jackpotCents": a, "drawDate": da},
                 {"game": "megamillions", "jackpotCents": b, "drawDate": db}]
        esc = L.escolhe_proximo_pool(cands, CFG)
        aptos = [c for c in cands if c["jackpotCents"] > piso]
        if not aptos:
            if esc is not None:
                ruim += 1
            continue
        teto = max(c["jackpotCents"] for c in aptos)
        no_teto = [c for c in aptos if c["jackpotCents"] == teto]
        certo = min(no_teto, key=lambda c: c["drawDate"])
        if esc["game"] != certo["game"]:
            ruim += 1
    checa("1000 pares: sempre o maior jackpot, desempate pela data", ruim == 0,
          f"{ruim} escolha(s) erradas")


# ══ 3. HORÁRIO DE VERÃO ═════════════════════════════════════════════════════════════════════
def secao_dst():
    print("\n3. HORÁRIO DE VERÃO — a virada de novembro de 2026")
    #
    # O DST dos EUA acaba no primeiro domingo de novembro: 2026-11-01. Antes disso o leste está
    # em EDT (-04:00); depois, em EST (-05:00). Um sorteio de 22:59 ET cai em UTC do dia seguinte
    # nos dois regimes, mas com HORAS diferentes — e é exatamente aí que uma conversão com offset
    # fixo erra o dia.
    casos = [
        ("sábado 2026-10-31 22:59 EDT", "2026-11-01T02:59:00", "2026-10-31"),
        ("segunda 2026-11-02 22:59 EST", "2026-11-03T03:59:00", "2026-11-02"),
        ("sábado 2026-03-07 22:59 EST", "2026-03-08T03:59:00", "2026-03-07"),
        ("quarta 2026-03-11 22:59 EDT", "2026-03-12T02:59:00", "2026-03-11"),
    ]
    for rotulo, utc, esperado in casos:
        d = S._datas_do_sorteio(utc, "UTC")
        checa(f"{rotulo} -> {esperado}", d["nextDrawDate"] == esperado, d["nextDrawDate"])

    # ── A MUTAÇÃO PRECISA DISCRIMINAR ───────────────────────────────────────────────────────
    #
    # Primeira tentativa: sorteio da Powerball (22:59) em EST, 2026-11-03T03:59Z. Subtrair 4h dá
    # 23:59 do dia anterior — a MESMA data que a conversão correta por fuso. A "mutação" passava
    # nos dois caminhos e não provava nada. Um teste assim é pior que ausente: ocupa o lugar de
    # um portão sem ser um.
    #
    # O caso que DISCRIMINA é a Mega Millions, que sorteia às 23:00 ET. Em EST isso é 04:00Z do
    # dia seguinte: a conversão por fuso volta para 23:00 do dia certo, e o offset fixo de -4h dá
    # 00:00 — virando o dia e apontando para o sorteio errado.
    UTC_MM_EST = "2026-11-04T04:00:00"     # MM de terça 2026-11-03 23:00 EST
    ingenuo = (datetime.fromisoformat(UTC_MM_EST) - timedelta(hours=4)).strftime("%Y-%m-%d")
    real = S._datas_do_sorteio(UTC_MM_EST, "UTC")["nextDrawDate"]
    checa("MUTAÇÃO: offset fixo de -4h vira o dia em EST (MM às 23:00)", ingenuo != real,
          f"offset fixo={ingenuo} fuso real={real}")
    checa("  e a conversão por fuso acerta o dia do sorteio", real == "2026-11-03", real)

    # Mega Millions publica em ET nos dois regimes.
    for rotulo, et_iso, esperado_utc in [
            ("MM terça 2026-10-27 23:00 EDT", "2026-10-27T23:00:00", "2026-10-28T03:00:00Z"),
            ("MM terça 2026-11-03 23:00 EST", "2026-11-03T23:00:00", "2026-11-04T04:00:00Z")]:
        d = S._datas_do_sorteio(et_iso, "ET")
        checa(f"{rotulo} -> {esperado_utc}", d["nextDrawAt"] == esperado_utc, d["nextDrawAt"])
        checa(f"  e a data ET não desloca", d["nextDrawDate"] == et_iso[:10], d["nextDrawDate"])


# ══ 4. DISCORDÂNCIA NA DIREÇÃO INVERTIDA ════════════════════════════════════════════════════
def secao_discordancia():
    print("\n4. DISCORDÂNCIA — agora a SECUNDÁRIA é quem diverge")
    certo = {"numbers": [4, 26, 66, 67, 69], "special": 9, "multiplier": 2}

    def fonte(fid, jogo, dd):
        if fid == "powerball_official":
            return dict(certo, drawDate=dd, source=fid)
        # secundária e fallback trazem OUTRO resultado
        return {"drawDate": dd, "numbers": [1, 2, 3, 4, 5], "special": 1, "multiplier": 2,
                "source": fid}

    r, _ = S.resultado_pronto("powerball", "2026-08-12", CFG, fonte)
    checa("a PRIMÁRIA decide, mesmo com as outras discordando",
          r and r["numbers"] == certo["numbers"] and r["verificationState"] == "PRIMARY_CONFIRMED",
          str(r and r["numbers"]))
    rec = S.reconcilia(r, "powerball", "2026-08-12", CFG, fonte)
    checa("a discordância vira INCIDENTE (2 fontes)", len(rec["incidentes"]) == 2,
          str(len(rec["incidentes"])))
    checa("o resultado liquidado NÃO é reescrito", r["numbers"] == certo["numbers"])

    # Correção tardia: a primária muda de ideia DEPOIS. Também é incidente, nunca sobrescrita.
    def corrigida(fid, jogo, dd):
        return {"drawDate": dd, "numbers": [7, 8, 9, 10, 11], "special": 3, "multiplier": 2,
                "source": fid}
    rec2 = S.reconcilia(r, "powerball", "2026-08-12", CFG, corrigida)
    checa("primária corrigida DEPOIS também vira incidente", len(rec2["incidentes"]) >= 1)
    checa("  e nada no resultado já liquidado mudou", r["special"] == 9)


# ══ 5. PATOLOGIAS DE REDE ═══════════════════════════════════════════════════════════════════
def secao_rede():
    print("\n5. PATOLOGIAS DE REDE — nenhuma pode virar 'sem resultado' ou 'jackpot zero'")
    import urllib.error

    class RespostaFalsa(io.BytesIO):
        def __init__(self, corpo):
            super().__init__(corpo)

    original = S.urllib.request.urlopen
    patologias = {
        "HTTP 429": urllib.error.HTTPError("u", 429, "Too Many", {}, None),
        "HTTP 500": urllib.error.HTTPError("u", 500, "Server Error", {}, None),
        "HTTP 503": urllib.error.HTTPError("u", 503, "Unavailable", {}, None),
        "conexão cortada": ConnectionResetError("peer reset"),
        "timeout": TimeoutError("timed out"),
    }
    try:
        for nome, exc in patologias.items():
            def falha(*a, **kw):
                raise exc
            S.urllib.request.urlopen = falha
            try:
                S.jackpot_oficial("powerball")
                checa(f"{nome} não vira jackpot válido", False, "NÃO levantou")
            except Exception as e:  # noqa: BLE001
                checa(f"{nome} não vira jackpot válido", True, type(e).__name__)

        # 200 com corpo binário (gzip não decodificado) e corpo cortado ao meio.
        for nome, corpo in [("gzip não decodificado", b"\x1f\x8b\x08\x00\x00\x00\x00\x00" * 40),
                            ("corpo cortado", b"<html><div id=\"nextDraw\" data-drawdat")]:
            def ok(*a, **kw):
                class C:
                    def __enter__(s):
                        return RespostaFalsa(corpo)
                    def __exit__(s, *x):
                        return False
                return C()
            S.urllib.request.urlopen = ok
            try:
                j = S.jackpot_oficial("powerball", agora=datetime.now(timezone.utc))
                checa(f"{nome} não vira jackpot válido", False,
                      f"aceitou {j.get('advertisedAnnuityCents')}")
            except Exception as e:  # noqa: BLE001
                checa(f"{nome} não vira jackpot válido", True, type(e).__name__)
    finally:
        S.urllib.request.urlopen = original

    # E o estado do documento NÃO transforma "não medido" em "não qualifica".
    def sempre_falha(jogo):
        raise S.ResultadoInvalido("fonte fora do ar")
    jogos = ST.mede_jogos(CFG, fetcher=lambda j: sempre_falha(j))
    for g in jogos.values():
        checa(f"{g['label']}: fonte fora -> estado UNKNOWN, não BELOW_THRESHOLD",
              g["state"] == "UNKNOWN" and g["error"], f"{g['state']} / {g.get('error', '')[:40]}")
    checa("nenhum pool é escolhido com as duas fontes fora",
          ST.escolhe(jogos, CFG) is None)


# ══ 6. CICLO DE VIDA — o que tem de ser RECUSADO ════════════════════════════════════════════
def secao_ciclo():
    print("\n6. CICLO DE VIDA — estado derivado do que está gravado, nunca declarado")
    agora = datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc)

    def sorteio(**kw):
        base = {"id": "2026-08-12", "status": "planejamento",
                "drawing": {"drawDateIso": "2026-08-12T22:59:00-04:00"}}
        base.update(kw)
        return base

    casos = [
        ("sem nada -> ELIGIBLE", sorteio(), "ELIGIBLE"),
        ("com participantes -> OPEN", sorteio(participants=[{"name": "a"}]), "OPEN"),
        ("com bilhetes -> LOCKED",
         sorteio(participants=[{"name": "a"}], sharedTickets={"series": []}), "LOCKED"),
        ("passou da hora, sem resultado -> AWAITING_RESULT",
         sorteio(drawing={"drawDateIso": "2026-08-12T22:59:00-04:00"}), "AWAITING_RESULT"),
        ("com resultado -> SETTLED",
         sorteio(result={"numbers": [1, 2, 3, 4, 5], "special": 6}), "SETTLED"),
    ]
    for rotulo, d, esperado in casos:
        # AWAITING_RESULT precisa de um "agora" depois do sorteio.
        quando = datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc) if "passou" in rotulo \
            else datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)
        estado, _ = ST.estado_do_sorteio(d, quando)
        checa(f"{rotulo}", estado == esperado, f"veio {estado}")

    # O CAMPO `status` NÃO MANDA. No 12/08 ele ainda diz "planejamento" para um sorteio
    # sorteado, pago e liquidado — derivar dele seria confiar num campo que ninguém atualiza.
    mentiroso = sorteio(status="planejamento",
                        result={"numbers": [1, 2, 3, 4, 5], "special": 6})
    estado, _ = ST.estado_do_sorteio(mentiroso, agora)
    checa("status='planejamento' com resultado gravado -> SETTLED (o campo não manda)",
          estado == "SETTLED", estado)
    invertido = sorteio(status="finalizado")
    estado2, _ = ST.estado_do_sorteio(invertido, datetime(2026, 8, 11, 12, 0,
                                                          tzinfo=timezone.utc))
    checa("status='finalizado' sem resultado NÃO vira SETTLED", estado2 != "SETTLED", estado2)
    checa("sorteio inexistente -> CLOSED", ST.estado_do_sorteio(None, agora)[0] == "CLOSED")


# ══ 7. COLETA — buracos de agendador com formatos diferentes ════════════════════════════════
def secao_coleta():
    print("\n7. COLETA — buracos de agendador de formatos diferentes")
    from datetime import date as _d
    res = {"numbers": [4, 26, 66, 67, 69], "special": 9, "multiplier": 2}

    def fonte(fid, jogo, dd):
        if fid != "powerball_official":
            raise RuntimeError("fora do ar")
        return dict(res, drawDate=dd, source=fid)

    # buraco LONGO: nenhuma execução por 9 dias
    arq = livro().with_name("r.jsonl")
    rel = P.coleta("powerball", CFG, arq, fonte, ate=_d(2026, 8, 12), janela_dias=9)
    n_recuperados = len(rel["novos"])
    checa("buraco de 9 dias: recupera todos os sorteios da janela", n_recuperados >= 4,
          f"{n_recuperados} sorteio(s)")
    rel2 = P.coleta("powerball", CFG, arq, fonte, ate=_d(2026, 8, 12), janela_dias=9)
    checa("  e a execução seguinte registra zero", not rel2["novos"])

    # buraco INTERMITENTE: alterna disponível/indisponível
    arq2 = livro().with_name("r2.jsonl")
    estado = {"n": 0}

    def instavel(fid, jogo, dd):
        estado["n"] += 1
        if estado["n"] % 2:
            raise S.ResultadoInvalido("ainda não publicado")
        if fid != "powerball_official":
            raise RuntimeError("fora do ar")
        return dict(res, drawDate=dd, source=fid)
    total = 0
    for _ in range(8):
        total += len(P.coleta("powerball", CFG, arq2, instavel,
                              ate=_d(2026, 8, 12), janela_dias=0)["novos"])
    checa("fonte intermitente: o sorteio entra UMA vez em 8 tentativas", total == 1,
          f"{total} registro(s)")

    # DEPOIS de liquidado, a coleta é no-op
    antes = len(P.le(arq2))
    P.coleta("powerball", CFG, arq2, fonte, ate=_d(2026, 8, 12), janela_dias=0)
    checa("coleta depois da liquidação é NOOP", len(P.le(arq2)) == antes)


def main():
    print("RODADA 2 — ATAQUE ADVERSARIAL COM ESTRATÉGIA DIFERENTE")
    secao_ordem()
    secao_limiar()
    secao_dst()
    secao_discordancia()
    secao_rede()
    secao_ciclo()
    secao_coleta()

    print("\n" + "=" * 78)
    if falhas:
        print(f"ROUND2 = FALHOU ({len(falhas)})")
        for f in falhas:
            print(f"    - {f}")
        return 1
    print("ROUND2 = PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
