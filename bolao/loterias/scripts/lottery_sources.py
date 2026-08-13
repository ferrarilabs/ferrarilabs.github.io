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
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")


class ResultadoInvalido(Exception):
    pass


def _agora():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _http(url, timeout=20, tentativas=10, exige=None, backoff=0.4, prazo=90):
    """
    `exige`: trecho que a resposta PRECISA conter para valer.

    ═══ QUANTAS TENTATIVAS, E POR QUÊ ESSE NÚMERO ═══════════════════════════════════════════

    powerball.com serve, de forma intermitente, uma casca sem o conteúdo do sorteio — a mesma
    URL devolve ora a página completa, ora um esqueleto. Isto já era conhecido; o que não
    estava medido era a FREQUÊNCIA.

    Medido em 2026-08-13, várias amostras: a casca vem em torno de metade a 80% das vezes
    (10/12, 6/10, 5/10 em execuções seguidas). Testado contra três variantes de cabeçalho
    (`Accept` atual, `Accept` de navegador, sem `Accept`): não há combinação que resolva — a
    alternância é do servidor, não do cliente.

    Com as três tentativas anteriores, a chance de as três caírem na casca ficava perto de 20%
    a 55%. Ou seja: uma em cada duas a cinco leituras do jackpot FALHAVA, e o sistema concluía
    "fonte oficial indisponível" para uma fonte que estava no ar. Para o resultado, isso entrega
    a latência ao fallback sem motivo — exatamente o que a ordem de precedência existe para
    evitar.

    Dez tentativas com uma pausa curta entre elas levam a probabilidade de falha total para a
    casa de 0,3% no pior caso medido, e o `prazo` impede que uma fonte lenta prenda o processo.
    A pausa também deixa de martelar a origem em laço apertado.
    """
    ultimo, cascas = None, 0
    limite = time.monotonic() + prazo
    for n in range(tentativas):
        if n and time.monotonic() > limite:
            break
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                                   "Accept": "application/json, text/html"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                corpo = r.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            ultimo = e
            time.sleep(backoff)
            continue
        if exige is None or exige in corpo:
            return corpo
        cascas += 1
        # A contagem entra na mensagem: "10 de 10 vieram casca" é diagnóstico; "falhou" não é.
        ultimo = ResultadoInvalido(
            f"CASCA_SEM_CONTEUDO: {cascas} de {n + 1} respostas de {url} vieram sem {exige!r}")
        time.sleep(backoff)
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


# ── MEGA MILLIONS: a fonte oficial é uma API JSON, não a página ─────────────────────────────
#
# `megamillions.com/` serve uma casca de 26 KB sem um único número do sorteio — o conteúdo é
# montado no navegador. Um parser de HTML aqui não teria o que ler, em nenhuma tentativa, e a
# conclusão seria "a fonte oficial não publicou" para sempre.
#
# O que a própria página chama é este endpoint, medido em 2026-08-13:
#
#   POST /cmspages/utilservice.asmx/GetLatestDrawData  ->  {"d": "<json como string>"}
#     Drawing:    PlayDate, N1..N5, MBall, Megaplier (-1 = não se aplica no modelo atual)
#     Jackpot:    CurrentPrizePool / NextPrizePool / CurrentCashValue / NextCashValue
#     PrizeMatrix: MatrixID, MatrixStart, TicketPrice, WhiteBallMax, MegaBallMax, PrizeTiers
#     NextDrawingDate
#
# O corpo vem duplamente codificado: JSON cuja chave "d" é uma STRING de JSON.
MM_API = "https://www.megamillions.com/cmspages/utilservice.asmx/GetLatestDrawData"


def _mm_api(tentativas=3, timeout=25):
    ultimo = None
    for _ in range(tentativas):
        req = urllib.request.Request(
            MM_API, data=b"{}", method="POST",
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                envelope = json.loads(r.read().decode("utf-8", errors="replace"))
        except Exception as e:  # noqa: BLE001
            ultimo = e
            continue
        if "d" not in envelope:
            ultimo = ResultadoInvalido(f"resposta sem 'd': {list(envelope)}")
            continue
        return json.loads(envelope["d"])
    raise ultimo if isinstance(ultimo, Exception) else ResultadoInvalido("sem resposta utilizável")


def _megamillions_oficial(dados):
    d = dados.get("Drawing") or {}
    # `Megaplier: -1` é o marcador de "não se aplica": desde abril/2025 o multiplicador é sorteado
    # POR APOSTA e vem impresso no bilhete, então NÃO existe multiplicador do SORTEIO. Copiar o -1
    # para o resultado faria a validação recusar (multiplicador < 1) um payload perfeitamente bom.
    mega = d.get("Megaplier")
    return {"drawDate": str(d.get("PlayDate") or "")[:10],
            "numbers": [d.get(f"N{i}") for i in range(1, 6)],
            "special": d.get("MBall"),
            "multiplier": None if (mega is None or int(mega) < 1) else int(mega),
            "source": "megamillions_official"}


# ── NC EDUCATION LOTTERY (secundária) ───────────────────────────────────────────────────────
#
# Renderizada no servidor, com ids estáveis de WebForms. Estrutura lida ao vivo em 2026-08-13:
#
#   <span id="ctl00_MainContent_lblDrawdate" class="drawdate">Wednesday, Aug 12, 2026</span>
#   <span id="ctl00_MainContent_lblBall1" class="ball">4</span>          (Powerball, x5)
#   <span id="ctl00_MainContent_lblPowerball" class="ball powerball">9</span>
#   <span id="ctl00_MainContent_lblPowerplay" class="powerplay">POWER PLAY <span>2x</span></span>
#
#   <span id="ctl00_MainContent_lblNum1" class="ball">1</span>           (Mega Millions, x5)
#   <span id="ctl00_MainContent_lblMegaball" class="ball megaball">17</span>
#
# Os ids diferem entre os dois jogos (`lblBall*` x `lblNum*`) — um parser único e "esperto" que
# casasse só por `class="ball"` pegaria também as bolas dos blocos de OUTROS jogos que a mesma
# página exibe na barra lateral (Cash 5, Fast Play). O id é o que ancora no jogo certo.
URLS_NC = {"powerball": "https://nclottery.com/powerball",
           "megamillions": "https://nclottery.com/mega-millions"}


def _por_id(html, sufixo):
    m = re.search(rf'id="ctl00_MainContent_{sufixo}"[^>]*>\s*([^<]*?)\s*<', html)
    return m.group(1).strip() if m else None


def _nc(html, jogo):
    rotulo = _por_id(html, "lblDrawdate")            # "Wednesday, Aug 12, 2026"
    data = None
    if rotulo:
        d = re.search(r"([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})", rotulo)
        if d and MESES.get(d.group(1).lower()[:3]):
            data = f"{int(d.group(3)):04d}-{MESES[d.group(1).lower()[:3]]:02d}-{int(d.group(2)):02d}"
    if jogo == "powerball":
        nums = [_por_id(html, f"lblBall{i}") for i in range(1, 6)]
        esp = _por_id(html, "lblPowerball")
        # "POWER PLAY <span>2x</span>" — o valor está no <span> ANINHADO, então `_por_id` para no
        # "POWER PLAY" e não vê o número. Mesma armadilha do parser da powerball.com.
        m = re.search(r'id="ctl00_MainContent_lblPowerplay"[^>]*>.*?<span>\s*(\d+)x',
                      html, re.I | re.S)
        mult = int(m.group(1)) if m else None
    else:
        nums = [_por_id(html, f"lblNum{i}") for i in range(1, 6)]
        esp = _por_id(html, "lblMegaball")
        mult = None                                   # multiplicador é POR APOSTA, não do sorteio
    return {"drawDate": data, "numbers": nums, "special": esp, "multiplier": mult,
            "source": "nc_education_lottery"}


URLS_OFICIAIS = {
    "powerball_official": "https://www.powerball.com/draw-result?gc=powerball",
    "megamillions_official": MM_API,
}

# Página do PRÓXIMO sorteio. Não é a mesma da conferência do resultado — ver `jackpot_oficial`.
URL_PB_HOME = "https://www.powerball.com/"


def _cents(txt):
    """
    Texto anunciado -> centavos INTEIROS, sem passar por float em momento algum.

        "20 Million"     ->    2000000000
        "8.7 Million"    ->     870000000
        "1.04 Billion"   ->  104000000000
        "1,040,200,000"  ->  104020000000

    `0.1 + 0.2` não fecha em ponto flutuante, e este número decide se um bolão de dinheiro real
    abre ou não. Arredondamento na casa errada perto de US$500M troca a resposta.
    """
    if txt is None:
        return None
    m = re.search(r"([0-9][0-9.,]*)\s*(Billion|Million|Thousand)?", str(txt), re.I)
    if not m:
        return None
    num = m.group(1).replace(",", "")
    escala = {"billion": 10**9, "million": 10**6, "thousand": 10**3}.get(
        (m.group(2) or "").lower())
    inteiro, _, frac = num.partition(".")
    if escala is None:
        # Valor já em dólares: a vírgula era separador de milhar e a fração são centavos.
        return int(inteiro) * 100 + int((frac + "00")[:2])
    # "1.04 Billion": a fração escala junto — 04 centésimos de bilhão, em aritmética inteira.
    dolares = int(inteiro) * escala + (int(frac) * escala // 10 ** len(frac) if frac else 0)
    return dolares * 100


class JackpotDeSorteioPassado(ResultadoInvalido):
    """O jackpot lido pertence a um sorteio que já aconteceu — não serve para elegibilidade."""


# Todo sorteio das duas loterias acontece à noite no fuso do leste dos EUA, e é a data ET que
# identifica o sorteio em todo o resto do sistema (os ids em `data.js` são "2026-08-12" para um
# sorteio de quarta 22:59 ET).
FUSO_SORTEIO = ZoneInfo("America/New_York")


def _datas_do_sorteio(bruto_iso, fuso_de_origem):
    """
    Normaliza a data do próximo sorteio para a DATA DE CALENDÁRIO NO LESTE (ET).

    ═══ O DEFEITO QUE ISTO FECHA (2026-08-13, rodada adversarial) ═══════════════════════════

    As duas fontes publicam o instante do próximo sorteio em fusos DIFERENTES, e as duas eram
    lidas com um `[:10]` cru:

        Powerball      data-drawdateutc="2026-08-16T02:59:00"   -> "2026-08-16"   (UTC)
        Mega Millions  NextDrawingDate="2026-08-14T23:00:00"    -> "2026-08-14"   (ET)

    O sorteio da Powerball é SÁBADO, 15 de agosto, 22:59 ET — a NC Lottery imprime "Saturday,
    Aug. 15, 10:59 PM". A data lida vinha um dia à frente, porque 22:59 ET já é o dia seguinte
    em UTC. Dois estragos:

      1. VISÍVEL: a página e o e-mail anunciavam "Próximo sorteio 2026-08-16" para um sorteio
         que acontece no dia 15. O participante lê a data errada do próprio bolão.
      2. DINHEIRO: `escolhe_proximo_pool` desempata por "sorteio mais cedo" comparando essas
         strings. Uma delas estava sistematicamente um dia adiantada em relação à outra —
         comparação entre unidades diferentes decidindo qual jogo recebe o bolão.

    O instante continua guardado separadamente (`nextDrawAt`, sempre em UTC) porque é ele que
    responde "esse sorteio já ocorreu?"; a data ET responde "que sorteio é esse?". São perguntas
    diferentes e misturá-las foi a origem do defeito.
    """
    if not bruto_iso:
        return {"nextDrawDate": None, "nextDrawIso": None, "nextDrawAt": None}
    txt = str(bruto_iso).replace("Z", "").split(".")[0]
    quando = datetime.fromisoformat(txt)
    if quando.tzinfo is None:
        quando = quando.replace(
            tzinfo=timezone.utc if fuso_de_origem == "UTC" else FUSO_SORTEIO)
    et = quando.astimezone(FUSO_SORTEIO)
    return {
        "nextDrawDate": et.strftime("%Y-%m-%d"),          # identidade do sorteio (ET)
        "nextDrawIso": et.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "nextDrawAt": quando.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def jackpot_oficial(jogo, fetcher=None, agora=None):
    """
    Jackpot ANUNCIADO EM ANUIDADE do PRÓXIMO sorteio, com cash value e data, da fonte oficial.

    ═══ O DEFEITO QUE ISTO FECHA (2026-08-13) ═══════════════════════════════════════════════

    A versão anterior lia `powerball.com/draw-result?gc=powerball` — a página do sorteio JÁ
    REALIZADO. O "Estimated Jackpot: $1.04 Billion" que ela mostra é o prêmio do sorteio de
    2026-08-12, que é um fato HISTÓRICO. Medido na mesma hora, o próximo sorteio (sábado
    2026-08-15) vale US$20 milhões: o jackpot foi ganho e o jogo voltou ao piso.

    A diferença não é cosmética. A política abre bolão quando o anunciado passa de US$500M.
    Com a leitura antiga o sistema teria concluído "US$1,04 bilhão, ELEGÍVEL" e recomendado
    abrir um bolão sobre um jackpot de US$20 milhões que não existe mais. Um resultado errado
    que parece perfeitamente plausível — a pior categoria.

    ═══ A GUARDA É ESTRUTURAL, NÃO UMA URL CERTA ════════════════════════════════════════════

    Trocar a URL corrigiria hoje e voltaria a quebrar quando a página mudasse. O invariante é:

        jackpot só vale para elegibilidade se pertencer a um sorteio que AINDA NÃO OCORREU.

    Então a data do próximo sorteio é lida junto e conferida contra o relógio. Se vier no
    passado, isto levanta em vez de devolver um número plausível.
    """
    if fetcher is not None:
        return fetcher(jogo)
    agora = agora or datetime.now(timezone.utc)

    if jogo == "megamillions":
        dados = _mm_api()
        jp = dados.get("Jackpot") or {}
        prox = dados.get("NextDrawingDate")
        # `NextPrizePool` é o PRÓXIMO; `CurrentPrizePool` é o do sorteio já realizado. Mesma
        # armadilha da Powerball, só que aqui os dois vêm no mesmo objeto — trocar o campo é
        # ainda mais fácil, e igualmente silencioso.
        #
        # `NextDrawingDate` vem SEM fuso ("2026-08-14T23:00:00") e é horário do leste — é o
        # horário do sorteio, 23:00 ET. Interpretar como UTC atrasaria o instante em 4 horas.
        bruto = {"advertisedAnnuityCents": _cents(jp.get("NextPrizePool")),
                 "cashValueCents": _cents(jp.get("NextCashValue")),
                 **_datas_do_sorteio(prox, "ET"),
                 "source": MM_API,
                 "sourceHash": hashlib.sha256(
                     json.dumps(dados.get("Jackpot"), sort_keys=True).encode()).hexdigest()[:16]}
    else:
        html = _http(URL_PB_HOME, exige="Estimated Jackpot")
        # Estrutura lida da página ao vivo em 2026-08-13:
        #   <h4 ...> Next Drawing </h4> <h5 class="... title-date">Sat, Aug 15, 2026</h5>
        #   <div ... id="nextDraw" data-drawdateutc="2026-08-16T02:59:00.0000000Z">
        #   <span ...> Estimated Jackpot </span>
        #   <span class="game-jackpot-number ...">$20 Million</span>
        #   <span ...> Cash Value </span> <span class="game-jackpot-number ...">$8.7 Million</span>
        def _rotulado(rotulo):
            m = re.search(rotulo + r"\s*</span>\s*<span class=\"game-jackpot-number[^\"]*\">\s*"
                          r"\$?\s*([0-9][0-9.,]*\s*[A-Za-z]*)", html, re.I)
            return m.group(1) if m else None
        iso = re.search(r'data-drawdateutc="([0-9T:.\-]+)', html)
        # O atributo diz UTC no próprio nome: "2026-08-16T02:59:00" é o sorteio de SÁBADO
        # 2026-08-15 às 22:59 ET. Ver `_datas_do_sorteio`.
        bruto = {"advertisedAnnuityCents": _cents(_rotulado("Estimated Jackpot")),
                 "cashValueCents": _cents(_rotulado("Cash Value")),
                 **_datas_do_sorteio(iso.group(1) if iso else None, "UTC"),
                 "source": URL_PB_HOME,
                 "sourceHash": hashlib.sha256(html.encode()).hexdigest()[:16]}

    if bruto["advertisedAnnuityCents"] is None:
        raise ResultadoInvalido(f"JACKPOT_NAO_LIDO: {jogo} em {bruto['source']}")

    return _confere_e_devolve(jogo, bruto, agora)


def jackpot_secundario(jogo, agora=None):
    """
    Jackpot do próximo sorteio pela NC Education Lottery — a MESMA secundária dos resultados.

    ═══ POR QUE UMA SEGUNDA FONTE DE JACKPOT ════════════════════════════════════════════════

    Medido em 2026-08-13: powerball.com devolve a casca sem conteúdo em torno de metade das
    requisições, e nenhuma variação de cabeçalho muda isso. Mesmo com dez tentativas, uma em
    cada seis leituras ainda falhava. Insistir mais na mesma origem instável é tratar sintoma;
    a arquitetura já tem a resposta certa, e é a que os RESULTADOS usam desde o início — quando
    a primária não responde, pergunta-se à secundária.

    A NC é renderizada no servidor e traz os mesmos três dados no cabeçalho, com ids estáveis:

        lblPBJackpot      "$20 Million"
        lblPBCash         "Cash Value $8.7 Million"
        lblPBDrawDateNext "Saturday, Aug. 15, 10:59 PM"
    """
    agora = agora or datetime.now(timezone.utc)
    if jogo != "powerball":
        raise ResultadoInvalido(
            f"ADAPTADOR_AUSENTE: jackpot secundário só implementado para powerball (pedido: "
            f"{jogo}) — a API oficial da Mega Millions é estável e não precisou de segunda via")

    html = _http(URLS_NC["powerball"], exige="lblPBJackpot")
    pref = "ctl00_MainContent_HeaderPowerball_JackpotPowerball_"

    def _campo(sufixo):
        m = re.search(rf'id="{pref}{sufixo}"[^>]*>([^<]*)<', html)
        return m.group(1).strip() if m else None

    quando = _proximo_sorteio_nc(_campo("lblPBDrawDateNext"), agora)
    bruto = {
        "advertisedAnnuityCents": _cents(_campo("lblPBJackpot")),
        "cashValueCents": _cents(_campo("lblPBCash")),
        **_datas_do_sorteio(quando.isoformat() if quando else None, "ET"),
        "source": URLS_NC["powerball"],
        "sourceHash": hashlib.sha256(html.encode()).hexdigest()[:16],
    }
    if bruto["advertisedAnnuityCents"] is None:
        raise ResultadoInvalido(f"JACKPOT_NAO_LIDO: {jogo} em {bruto['source']}")
    return _confere_e_devolve(jogo, bruto, agora)


DIAS_NC = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4,
           "saturday": 5, "sunday": 6}


def _proximo_sorteio_nc(rotulo, agora):
    """
    "Saturday, Aug. 15, 10:59 PM" -> datetime ET.

    O rótulo NÃO traz o ano. Em vez de assumir o ano corrente — que erra na virada de dezembro
    para janeiro, silenciosamente e uma vez por ano — o ano é escolhido como aquele que põe o
    sorteio no FUTURO mais próximo. A data também é conferida contra o dia da semana que o
    próprio rótulo declara: se não bater, o rótulo mudou de forma e é melhor não ler nada do que
    ler errado.
    """
    if not rotulo:
        return None
    m = re.search(r"([A-Za-z]+),\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*"
                  r"(AM|PM)", rotulo, re.I)
    if not m:
        return None
    mes = MESES.get(m.group(2).lower()[:3])
    if not mes:
        return None
    hora = int(m.group(4)) % 12 + (12 if m.group(6).upper() == "PM" else 0)
    agora_et = agora.astimezone(FUSO_SORTEIO)
    for ano in (agora_et.year, agora_et.year + 1):
        try:
            cand = datetime(ano, mes, int(m.group(3)), hora, int(m.group(5)),
                            tzinfo=FUSO_SORTEIO)
        except ValueError:
            continue
        if cand >= agora_et - timedelta(hours=6) and \
                cand.weekday() == DIAS_NC.get(m.group(1).lower(), cand.weekday()):
            return cand
    return None


def _confere_e_devolve(jogo, bruto, agora):
    """A guarda do sorteio futuro, comum às duas fontes de jackpot."""

    # ── A guarda ────────────────────────────────────────────────────────────────────────────
    #
    # Usa `nextDrawAt` — o INSTANTE, sempre em UTC e sempre com "Z" — e não `nextDrawIso`, que é
    # a representação em ET e traz o deslocamento no formato `-0400`. `datetime.fromisoformat`
    # do Python 3.9 recusa esse formato sem dois-pontos, e a guarda passava a levantar
    # `Invalid isoformat string` em TODA leitura: um jackpot perfeitamente válido virava erro.
    # Instante e representação são coisas diferentes; a guarda é sobre o instante.
    prox = bruto.get("nextDrawAt")
    if not prox:
        raise ResultadoInvalido(
            f"JACKPOT_SEM_SORTEIO: {jogo} — sem data do próximo sorteio não há como provar que "
            f"o valor não é de um sorteio passado")
    quando = datetime.fromisoformat(str(prox).replace("Z", "+00:00"))
    if quando.tzinfo is None:
        quando = quando.replace(tzinfo=timezone.utc)
    if quando < agora:
        raise JackpotDeSorteioPassado(
            f"JACKPOT_DE_SORTEIO_PASSADO: {jogo} anunciou "
            f"{bruto['advertisedAnnuityCents']} centavos para o sorteio de {prox}, que já "
            f"ocorreu. Este é o valor HISTÓRICO daquele sorteio, não o do próximo.")

    return {"game": jogo, "fetchedAt": _agora(), **bruto}


def jackpot_pronto(jogo, agora=None, fetcher=None):
    """
    Jackpot do próximo sorteio, com a MESMA precedência dos resultados: oficial, depois NC.

    Devolve `(jackpot, tentativas)`. `verificationState` diz de onde veio, e é isso que permite
    à UI distinguir "medido na fonte oficial" de "medido na secundária" de "não medido" — três
    estados diferentes que não podem virar um só. Um jogo não medido NÃO é um jogo que não
    qualifica.
    """
    if fetcher is not None:
        return fetcher(jogo), [{"source": "fetcher", "ok": True}]
    tentativas = []
    for nome, fn, estado in (("oficial", jackpot_oficial, "PRIMARY_CONFIRMED"),
                             ("nc_education_lottery", jackpot_secundario, "SECONDARY_ONLY")):
        try:
            j = fn(jogo, agora=agora)
            j["verificationState"] = estado
            tentativas.append({"source": nome, "ok": True})
            return j, tentativas
        except Exception as e:  # noqa: BLE001 — o motivo por fonte É o diagnóstico
            tentativas.append({"source": nome, "ok": False,
                               "motivo": f"{type(e).__name__}: {str(e)[:120]}"})
    return None, tentativas


def _do_ny_open_data(texto, jogo, draw_date=None):
    """
    Escolhe a linha do sorteio PEDIDO, não a mais recente.

    As oficiais publicam um sorteio de cada vez — a página mostra o último, e pedir um anterior
    devolve o último de novo (recusado corretamente por `RESULTADO_DESATUALIZADO`). O NY Open Data
    é diferente: devolve uma LISTA. Ler sempre `linhas[0]` jogava fora exatamente a propriedade
    que faz dele um conjunto de auditoria — o histórico — e tornava impossível recuperar um
    sorteio antigo que tivesse escapado da coleta.
    """
    linhas = json.loads(texto)
    if not linhas:
        raise ResultadoInvalido("NY Open Data devolveu lista vazia")
    linha = linhas[0]
    if draw_date:
        alvo = [l for l in linhas if str(l.get("draw_date", ""))[:10] == str(draw_date)]
        if not alvo:
            raise ResultadoInvalido(
                f"NY Open Data não trouxe {draw_date} nas {len(linhas)} linhas consultadas "
                f"(mais recente: {str(linhas[0].get('draw_date', ''))[:10]})")
        linha = alvo[0]
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

    Todo adaptador foi escrito contra a estrutura REAL, inspecionada ao vivo — nenhum contra o
    formato que a fonte "deveria" ter. Adivinhar formato é a versão de infraestrutura de adivinhar
    resultado, e produz o mesmo tipo de erro: silencioso e plausível.
    """
    if fetcher is not None:
        bruto = fetcher(fonte, jogo, draw_date)
    elif fonte == "powerball_official":
        bruto = _powerball_oficial(_http(URLS_OFICIAIS[fonte], exige="<title>"))
    elif fonte == "megamillions_official":
        bruto = _megamillions_oficial(_mm_api())
    elif fonte == "nc_education_lottery":
        bruto = _nc(_http(URLS_NC[jogo], exige="lblDrawdate"), jogo)
    elif fonte == "ny_open_data":
        url = {"powerball": "https://data.ny.gov/resource/d6yy-54nr.json",
               "megamillions": "https://data.ny.gov/resource/5xaw-6ayf.json"}[jogo]
        # `$order=draw_date DESC` tem espaço, e espaço cru numa URL levanta InvalidURL antes de
        # qualquer rede. Precisa ser codificado.
        # `$limit` generoso: a janela de recuperação do coletor é de dias, e o custo de trazer
        # algumas linhas a mais é zero perto do de não conseguir recuperar um sorteio perdido.
        q = urllib.parse.urlencode({"$order": "draw_date DESC", "$limit": 30})
        bruto = _do_ny_open_data(_http(f"{url}?{q}"), jogo, draw_date)
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
