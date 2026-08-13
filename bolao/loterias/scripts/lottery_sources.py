#!/usr/bin/env python3
"""
Adaptadores de resultado oficial — quem decide a latência.

═══ O QUE MUDA ══════════════════════════════════════════════════════════════════════════════════

Antes, `data.js` apontava os DOIS jogos para `data.ny.gov`. O NY Open Data é um conjunto de dados
de AUDITORIA e publica com atraso — então o resultado do bolão ficava represado por uma fonte que
não existe para liberar nada. Quem manda passa a ser a fonte oficial do JOGO; o NY Open Data
reconcilia depois.

    RESULT_READY = a PRIMÁRIA trouxe resultado estruturalmente válido para o sorteio ESPERADO

`esperado` é o ponto. Uma fonte que devolve o sorteio ANTERIOR é o modo de falha real: o corpo é
válido, os números existem, tudo parece certo — e é o resultado errado. Por isso a validação exige
a data bater com a esperada, e não só "veio alguma coisa".

═══ NENHUM RESULTADO CHUTADO ════════════════════════════════════════════════════════════════════

Não há caminho que preencha número ausente, deduza bola especial ou assuma multiplicador. Payload
incompleto é RECUSADO. Um resultado inventado pagaria prêmio inventado.

Os adaptadores são injetáveis (`fetcher`): os testes exercitam validação, staleness e precedência
sem rede.
"""

import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone

USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")


class ResultadoInvalido(Exception):
    pass


def _agora():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _http(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                               "Accept": "application/json, text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


# ══ VALIDAÇÃO ═══════════════════════════════════════════════════════════════════════════════
def valida(bruto, jogo, draw_date_esperada, faixa_principal, faixa_especial):
    """
    Recusa tudo que não seja um resultado completo do sorteio ESPERADO.

    Cada recusa tem motivo próprio: "veio vazio", "veio o sorteio anterior" e "veio com 4 números"
    são causas diferentes, e tratá-las como um erro genérico esconderia justamente a que importa —
    a segunda, que parece sucesso.
    """
    if not isinstance(bruto, dict):
        raise ResultadoInvalido("payload não é objeto")

    d = bruto.get("drawDate")
    if not d:
        raise ResultadoInvalido("sem drawDate")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d)):
        raise ResultadoInvalido(f"drawDate mal formada: {d!r}")
    if str(d) != str(draw_date_esperada):
        raise ResultadoInvalido(
            f"RESULTADO_DESATUALIZADO: fonte trouxe {d}, esperado {draw_date_esperada}")

    nums = bruto.get("numbers")
    if not isinstance(nums, list) or len(nums) != 5:
        raise ResultadoInvalido(f"esperados 5 números, veio {nums!r}")
    try:
        nums = [int(n) for n in nums]
    except (TypeError, ValueError):
        raise ResultadoInvalido(f"números não inteiros: {bruto.get('numbers')!r}") from None
    if len(set(nums)) != 5:
        raise ResultadoInvalido(f"números repetidos: {nums}")
    lo, hi = faixa_principal
    fora = [n for n in nums if not (lo <= n <= hi)]
    if fora:
        raise ResultadoInvalido(f"números fora da faixa {lo}-{hi}: {fora}")

    esp = bruto.get("special")
    if esp is None:
        raise ResultadoInvalido("sem bola especial")
    try:
        esp = int(esp)
    except (TypeError, ValueError):
        raise ResultadoInvalido(f"bola especial não inteira: {esp!r}") from None
    slo, shi = faixa_especial
    if not (slo <= esp <= shi):
        raise ResultadoInvalido(f"bola especial fora da faixa {slo}-{shi}: {esp}")

    mult = bruto.get("multiplier")
    if mult is not None:
        try:
            mult = int(mult)
        except (TypeError, ValueError):
            raise ResultadoInvalido(f"multiplicador inválido: {mult!r}") from None
        if mult < 1:
            raise ResultadoInvalido(f"multiplicador < 1: {mult}")

    return {"game": jogo, "drawDate": str(d), "numbers": sorted(nums), "special": esp,
            "multiplier": mult, "source": bruto.get("source"), "fetchedAt": _agora()}


FAIXAS = {
    "powerball":    {"main": (1, 69), "special": (1, 26)},
    "megamillions": {"main": (1, 70), "special": (1, 24)},
}


# ══ ADAPTADORES ═════════════════════════════════════════════════════════════════════════════
def _do_ny_open_data(texto, jogo):
    linhas = json.loads(texto)
    if not linhas:
        raise ResultadoInvalido("NY Open Data devolveu lista vazia")
    linha = linhas[0]
    partes = str(linha.get("winning_numbers", "")).split()
    if len(partes) < 6 and jogo == "powerball":
        raise ResultadoInvalido(f"winning_numbers incompleto: {linha.get('winning_numbers')!r}")
    if jogo == "powerball":
        nums, esp = partes[:5], partes[5]
    else:
        nums, esp = partes[:5], linha.get("mega_ball")
    return {"drawDate": str(linha.get("draw_date", ""))[:10], "numbers": nums, "special": esp,
            "multiplier": linha.get("multiplier"), "source": "ny_open_data"}


def busca(jogo, draw_date, fonte, fetcher=None):
    """
    Traz e VALIDA de uma fonte. `fetcher(fonte_id, jogo, draw_date)` é injetável para teste.

    Sem `fetcher`, só `ny_open_data` tem implementação de rede aqui — as oficiais precisam de um
    adaptador escrito contra o formato real de cada uma, e escrever um parser às cegas seria
    exatamente o "resultado chutado" que a política proíbe. Enquanto isso, o pipeline continua
    funcionando com a ordem de precedência e a fonte que existe.
    """
    if fetcher is not None:
        bruto = fetcher(fonte, jogo, draw_date)
    elif fonte == "ny_open_data":
        url = {"powerball": "https://data.ny.gov/resource/d6yy-54nr.json",
               "megamillions": "https://data.ny.gov/resource/5xaw-6ayf.json"}[jogo]
        # `$order=draw_date DESC` tem espaço, e espaço cru numa URL levanta InvalidURL antes de
        # qualquer rede. Precisa ser codificado.
        q = urllib.parse.urlencode({"$order": "draw_date DESC", "$limit": 5})
        bruto = _do_ny_open_data(_http(f"{url}?{q}"), jogo)
    else:
        raise ResultadoInvalido(f"ADAPTADOR_AUSENTE: {fonte} ainda não tem implementação de rede")

    if bruto is None:
        raise ResultadoInvalido(f"{fonte} não devolveu nada")
    bruto.setdefault("source", fonte)
    f = FAIXAS[jogo]
    return valida(bruto, jogo, draw_date, f["main"], f["special"])


def resultado_pronto(jogo, draw_date, cfg, fetcher=None):
    """
    Percorre primária → secundária → fallback e devolve no PRIMEIRO sucesso.

    `verificationState`:
      PRIMARY_CONFIRMED     veio da fonte oficial do jogo — libera cálculo e notificação
      SECONDARY_ONLY        a primária falhou; seguiu com a secundária
      FALLBACK_AUDIT_ONLY   só o conjunto de auditoria respondeu

    Devolve (resultado|None, tentativas) — `tentativas` guarda o motivo de cada recusa, que é o
    que transforma "não saiu ainda" em diagnóstico.
    """
    fontes = cfg["resultSources"][jogo]
    ordem = [("primary", "PRIMARY_CONFIRMED"), ("secondary", "SECONDARY_ONLY"),
             ("fallback", "FALLBACK_AUDIT_ONLY")]
    tentativas = []
    for chave, estado in ordem:
        if chave not in fontes:
            continue
        fid = fontes[chave]["id"]
        try:
            r = busca(jogo, draw_date, fid, fetcher)
            r["verificationState"] = estado
            r["resultHash"] = None    # preenchido pelo chamador com lottery_core.hash_resultado
            tentativas.append({"source": fid, "ok": True})
            return r, tentativas
        except Exception as e:  # noqa: BLE001 — o motivo por fonte É o diagnóstico
            tentativas.append({"source": fid, "ok": False, "motivo": f"{type(e).__name__}: {e}"})
    return None, tentativas


def reconcilia(resultado, jogo, draw_date, cfg, fetcher=None):
    """
    Confere as demais fontes DEPOIS de já ter liquidado. Divergência vira incidente, nunca
    reescrita: um resultado já liquidado pagou prêmio, e trocá-lo em silêncio apagaria o rastro
    de por que alguém recebeu o que recebeu.
    """
    fontes = cfg["resultSources"][jogo]
    achados, incidentes = [], []
    for chave in ("primary", "secondary", "fallback"):
        if chave not in fontes:
            continue
        fid = fontes[chave]["id"]
        if fid == resultado.get("source"):
            continue
        try:
            outro = busca(jogo, draw_date, fid, fetcher)
        except Exception as e:  # noqa: BLE001
            achados.append({"source": fid, "ok": False, "motivo": str(e)})
            continue
        igual = (outro["numbers"] == resultado["numbers"]
                 and outro["special"] == resultado["special"])
        achados.append({"source": fid, "ok": True, "confere": igual})
        if not igual:
            incidentes.append({
                "tipo": "DIVERGENCIA_DE_FONTE", "game": jogo, "drawDate": draw_date,
                "liquidado": {"numbers": resultado["numbers"], "special": resultado["special"]},
                "fonte": fid,
                "trouxe": {"numbers": outro["numbers"], "special": outro["special"]},
            })
    return {"achados": achados, "incidentes": incidentes}
