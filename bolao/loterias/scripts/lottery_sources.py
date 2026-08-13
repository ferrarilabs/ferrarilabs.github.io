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

import hashlib
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


def _http(url, timeout=20, tentativas=3, exige=None):
    """
    `exige`: trecho que a resposta PRECISA conter para valer.

    powerball.com serve, de forma intermitente, uma casca sem o conteúdo do sorteio — a mesma URL
    devolve ora a página completa, ora um esqueleto. Medido em 2026-08-13: a primeira chamada veio
    sem `<title>` utilizável e a seguinte veio completa. Sem esta checagem o parser lê a casca,
    não encontra nada e o pipeline conclui "a fonte oficial não publicou" — que é uma afirmação
    falsa sobre a fonte, e faz o fallback assumir a latência sem motivo.
    """
    ultimo = None
    for n in range(tentativas):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                                   "Accept": "application/json, text/html"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                corpo = r.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            ultimo = e
            continue
        if exige is None or exige in corpo:
            return corpo
        ultimo = ResultadoInvalido(f"resposta sem {exige!r} (casca) na tentativa {n + 1}")
    raise ultimo if isinstance(ultimo, Exception) else ResultadoInvalido("sem resposta utilizável")


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
# ══ FONTES OFICIAIS — parsers escritos contra o HTML REAL, inspecionado ═════════════════════
#
# Nada aqui foi adivinhado. A estrutura abaixo foi lida da página ao vivo em 2026-08-13:
#
#   <title>Powerball Draw Result - Wed, Aug 12, 2026 | Powerball</title>
#   <div class="form-control col white-balls item-powerball"><div> 4 </div></div>   (x5)
#   <div class="form-control col powerball item-powerball"><div> 9 </div></div>
#   <span class="multiplier">2x</span>
#
# O número fica num <div> ANINHADO, não no elemento com a classe. Um parser escrito de cabeça
# casaria o texto direto do elemento com classe e voltaria vazio — foi exatamente o que a
# primeira tentativa fez.
MESES = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
         "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def _data_do_titulo(html):
    """'Powerball Draw Result - Wed, Aug 12, 2026 | Powerball' -> '2026-08-12'."""
    m = re.search(r"<title>([^<]+)</title>", html, re.I)
    if not m:
        return None
    d = re.search(r"([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})", m.group(1))
    if not d:
        return None
    mes = MESES.get(d.group(1).lower()[:3])
    if not mes:
        return None
    return f"{int(d.group(3)):04d}-{mes:02d}-{int(d.group(2)):02d}"


def _bolas(html, classe_branca, classe_especial):
    brancas = re.findall(
        rf'class="[^"]*{classe_branca}[^"]*"[^>]*>\s*<div>\s*(\d{{1,2}})\s*</div>', html)
    esp = re.findall(
        rf'class="[^"]*\b{classe_especial}\b[^"]*"[^>]*>\s*<div>\s*(\d{{1,2}})\s*</div>', html)
    return brancas, esp


def _powerball_oficial(html):
    brancas, esp = _bolas(html, "white-balls item-powerball", "powerball item-powerball")
    mult = re.search(r'class="[^"]*multiplier[^"]*"[^>]*>\s*(\d+)x', html, re.I)
    return {"drawDate": _data_do_titulo(html), "numbers": brancas,
            "special": esp[0] if esp else None,
            "multiplier": int(mult.group(1)) if mult else None,
            "source": "powerball_official"}


def _megamillions_oficial(html):
    brancas, esp = _bolas(html, "white-balls item-megamillions", "megaball item-megamillions")
    mult = re.search(r'class="[^"]*multiplier[^"]*"[^>]*>\s*(\d+)x', html, re.I)
    return {"drawDate": _data_do_titulo(html), "numbers": brancas,
            "special": esp[0] if esp else None,
            "multiplier": int(mult.group(1)) if mult else None,
            "source": "megamillions_official"}


URLS_OFICIAIS = {
    "powerball_official": "https://www.powerball.com/draw-result?gc=powerball",
    "megamillions_official": "https://www.megamillions.com/",
}


def jackpot_oficial(jogo, fetcher=None):
    """
    Jackpot ANUNCIADO EM ANUIDADE + cash value + próximo sorteio, da fonte oficial.

    Devolve centavos INTEIROS. "1.04 Billion" vira 104000000000 — converter para float e
    multiplicar arrastaria erro de arredondamento para uma decisão de US$500M.
    """
    if fetcher is not None:
        return fetcher(jogo)
    url = URLS_OFICIAIS["powerball_official" if jogo == "powerball" else "megamillions_official"]
    html = _http(url, exige="Estimated Jackpot")
    def _cents(txt):
        m = re.search(r"([0-9][0-9.,]*)\s*(Billion|Million)?", txt, re.I)
        if not m:
            return None
        num = m.group(1).replace(",", "")
        escala = {"billion": 10**9, "million": 10**6}.get((m.group(2) or "").lower(), 1)
        inteiro, _, frac = num.partition(".")
        frac = (frac + "00")[:2] if escala == 1 else frac
        if escala == 1:
            return int(inteiro) * 100 + int(frac or 0)
        # US$1.04 Billion -> 1040000000_00 centavos, sem passar por float.
        casas = len(m.group(1).split(".")[1]) if "." in m.group(1) else 0
        return int(num.replace(".", "")) * escala * 100 // (10 ** casas)
    j = re.search(r"Estimated Jackpot[^$]{0,200}?\$\s*([0-9.,]+\s*[A-Za-z]*)", html)
    c = re.search(r"Cash Value[^$]{0,200}?\$\s*([0-9.,]+\s*[A-Za-z]*)", html)
    return {"game": jogo,
            "advertisedAnnuityCents": _cents(j.group(1)) if j else None,
            "cashValueCents": _cents(c.group(1)) if c else None,
            "source": URLS_OFICIAIS["powerball_official" if jogo == "powerball"
                                    else "megamillions_official"],
            "fetchedAt": _agora(),
            "sourceHash": hashlib.sha256(html.encode()).hexdigest()[:16]}


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
    elif fonte in ("powerball_official", "megamillions_official"):
        html = _http(URLS_OFICIAIS[fonte], exige="<title>")
        bruto = (_powerball_oficial if fonte == "powerball_official"
                 else _megamillions_oficial)(html)
    elif fonte == "nc_education_lottery":
        # A NC não expõe endpoint estável e a página muda de forma; escrever um parser sem
        # inspecionar a estrutura real seria adivinhar, e adivinhar resultado é o que a política
        # proíbe. Enquanto isso a primária resolve e o NY reconcilia.
        raise ResultadoInvalido("ADAPTADOR_AUSENTE: nc_education_lottery (estrutura não inspecionada)")
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
