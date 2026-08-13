#!/usr/bin/env python3
"""
Núcleo do ciclo de vida das loterias: política, motor de prêmio e livro-razão.

═══ DINHEIRO EM CENTAVOS INTEIROS ═══════════════════════════════════════════════════════════════

Nenhum float. O bolão paga dinheiro real por aposta, e `0.1 + 0.2` não fecha em ponto flutuante.
Toda entrada e saída deste módulo é `int` de centavos.

═══ O LIVRO-RAZÃO NÃO TEM "SALDO" ═══════════════════════════════════════════════════════════════

Saldo é DERIVADO: `sum(entradas)`. Não existe campo mutável de saldo para alguém sobrescrever, e
não existe caminho que reescreva histórico — só `append`. Um saldo guardado como número mutável
perde a razão de ter mudado; um extrato não.

Cada lançamento carrega `idempotencyKey`. Reprocessar o mesmo sorteio não credita de novo: a
chave colide e o `append` vira no-op. É a mesma disciplina do outbox do CDB, pelo mesmo motivo —
lá o retry virava e-mail duplicado, aqui viraria dinheiro duplicado.

═══ NADA AQUI GASTA DINHEIRO ════════════════════════════════════════════════════════════════════

Não há cliente HTTP de pagamento, não há credencial de compra, não há função de comprar bilhete.
`TICKET_PURCHASE` REGISTRA uma compra que o operador já fez — nunca a executa.
"""

import fcntl
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

# parents[0] de um ARQUIVO é o diretório dele, então a raiz do repo é [3] aqui e
# [2] nos scripts que partem de `Path(__file__).parent`. Confundir os dois faz o
# caminho apontar para `bolao/bolao/...`.
RAIZ = Path(__file__).resolve().parents[3]
CONFIG = RAIZ / "bolao" / "loterias" / "config" / "lottery_policy.json"
LEDGER = RAIZ / "bolao" / "loterias" / "config" / "lottery_ledger.jsonl"

TIPOS = {"CONTRIBUTION", "TICKET_PURCHASE", "PRIZE_CREDIT",
         "CARRYOVER_IN", "CARRYOVER_OUT", "OPERATOR_ADJUSTMENT"}

# ══ O SINAL FAZ PARTE DO TIPO ═══════════════════════════════════════════════════════════════
#
# Cada tipo de lançamento tem uma direção que não é opinião: contribuição e prêmio ENTRAM,
# compra de bilhete SAI. Sem esta tabela o livro aceitava:
#
#     PRIZE_CREDIT    de -US$50   -> saldo NEGATIVO por um "prêmio"
#     TICKET_PURCHASE de +US$500  -> comprar bilhete AUMENTAVA o caixa
#
# Nos dois casos o extrato continuava internamente consistente e o saldo derivado era falso —
# a pior combinação, porque a conta fecha. `OPERATOR_ADJUSTMENT` é o único de sinal livre: é
# exatamente para isso que ele existe, e por isso exige motivo como todos os outros.
SINAL = {
    "CONTRIBUTION": +1,
    "PRIZE_CREDIT": +1,
    "CARRYOVER_IN": +1,
    "TICKET_PURCHASE": -1,
    "CARRYOVER_OUT": -1,
    "OPERATOR_ADJUSTMENT": 0,      # 0 = qualquer sinal, deliberadamente
}

# Campos que definem O QUE o lançamento afirma. Se a chave se repete e algum destes muda, não é
# reprocessamento: é outra afirmação com o mesmo nome.
CAMPOS_DA_IDENTIDADE = ("type", "amountCents", "poolId")


class ConflitoDeIdempotencia(ValueError):
    """Mesma chave, conteúdo diferente. Nunca é um no-op silencioso."""


def carrega_config(caminho=None):
    return json.loads(Path(caminho or CONFIG).read_text())


# ══ POLÍTICA DE JACKPOT ═════════════════════════════════════════════════════════════════════
def elegivel(jackpot_cents, cfg=None):
    """
    ESTRITAMENTE MAIOR que o piso. US$500.000.000,00 exatos NÃO qualificam.

    O `>` é a regra, não um detalhe: com `>=`, um jackpot anunciado em exatamente US$500M abriria
    um bolão que a regra do operador não autoriza, e ninguém notaria — a diferença é um centavo
    no limite e um bolão inteiro na prática.
    """
    cfg = cfg or carrega_config()
    t = cfg["threshold"]
    if t["comparison"] != "strictly_greater":
        raise ValueError(f"comparação não suportada: {t['comparison']}")
    if jackpot_cents is None:
        return False
    return int(jackpot_cents) > int(t["minJackpotCents"])


def estado_do_jogo(jackpot_cents, cfg=None):
    return "ELIGIBLE" if elegivel(jackpot_cents, cfg) else "BELOW_THRESHOLD"


def escolhe_proximo_pool(candidatos, cfg=None):
    """
    `candidatos`: [{game, jackpotCents, drawDate 'YYYY-MM-DD'}].

    Devolve o escolhido ou None. Respeita `maxActive` e a ordem de desempate configurada — a
    política é DADO (`pools.selection`), não uma cadeia de `if` espalhada pela UI.
    """
    cfg = cfg or carrega_config()
    aptos = [c for c in candidatos if elegivel(c.get("jackpotCents"), cfg)]
    if not aptos:
        return None
    for criterio in cfg["pools"]["selection"]:
        if criterio == "larger_advertised_annuity":
            teto = max(c["jackpotCents"] for c in aptos)
            aptos = [c for c in aptos if c["jackpotCents"] == teto]
        elif criterio == "earlier_draw_date":
            cedo = min(c["drawDate"] for c in aptos)
            aptos = [c for c in aptos if c["drawDate"] == cedo]
        else:
            raise ValueError(f"critério de seleção desconhecido: {criterio}")
        if len(aptos) == 1:
            break
    if cfg["pools"]["maxActive"] < 1:
        return None
    return aptos[0]


# ══ MOTOR DE PRÊMIO ═════════════════════════════════════════════════════════════════════════
def assert_matriz_utilizavel(jogo, cfg=None):
    """
    Matriz não conferida NÃO calcula dinheiro.

    A tabela da Mega Millions em `data.js` era o modelo Megaplier, anterior a abril/2025, e o
    próprio comentário dizia "confirmar valor exato no site oficial". Uma tabela dessas não erra
    de forma visível: ela paga um número plausível e errado. Então o bloqueio é do código, não da
    lembrança de alguém.
    """
    cfg = cfg or carrega_config()
    g = cfg["games"][jogo]
    if not g.get("matrixVerified"):
        raise RuntimeError(
            f"MATRIZ_NAO_CONFERIDA: {jogo} — a tabela de prêmios ainda não foi conferida contra "
            f"a fonte oficial ({g.get('matrixSource')}). Monitorar jackpot e abrir bolão seguem "
            f"liberados; CALCULAR PRÊMIO, não.")

    # MULTIPLICADOR EMBUTIDO EXIGE VALOR EXPLÍCITO.
    #
    # Na Mega Millions o multiplicador não é multiplicação: 4 acertos paga US$599 na base e
    # US$1.000 no 2X (599x2 seriam US$1.198), e 1+Mega Ball paga US$4 na base e US$14 no 2X. A
    # matriz conferida traz cada valor da fonte; esta checagem impede que alguém volte a marcar
    # `multiplied: true` num jogo desses e reintroduza o cálculo errado sem nenhum teste falhar.
    if g.get("builtInMultiplier"):
        faltando = [f["label"] for f in g["prizeMatrix"]
                    if f.get("baseCents") is not None and not f.get("byMultiplier")]
        if faltando:
            raise RuntimeError(
                f"MATRIZ_SEM_VALOR_EXPLICITO: {jogo} tem multiplicador embutido, então cada faixa "
                f"precisa dos valores por multiplicador vindos da fonte. Sem eles: {faltando}")
    return g


def premio_da_aposta(jogo, aposta, resultado, cfg=None):
    """
    `aposta`:    {numbers:[5], special:int, hasPowerPlay:bool?, multiplier:int?}
    `resultado`: {numbers:[5], special:int, multiplier:int}

    Devolve {label, amountCents, jackpot:bool} ou None.

    O multiplicador aplicado NUNCA é inferido do sorteio quando o jogo cobra por ele: na Powerball
    o Power Play é opcional POR APOSTA, então uma aposta sem Power Play recebe o prêmio base ainda
    que o sorteio tenha multiplicador 3x. Inferir do sorteio pagaria a mais por algo que não foi
    comprado.
    """
    g = assert_matriz_utilizavel(jogo, cfg)
    acertos = len(set(aposta["numbers"]) & set(resultado["numbers"]))
    bateu_especial = int(aposta["special"]) == int(resultado["special"])

    for faixa in g["prizeMatrix"]:
        if faixa["main"] != acertos or bool(faixa["special"]) != bateu_especial:
            continue
        if faixa["baseCents"] is None:
            return {"label": faixa["label"], "amountCents": None, "jackpot": True}

        if g.get("builtInMultiplier"):
            # Mega Millions pós-abril/2025: o multiplicador vem NA APOSTA, sorteado por aposta.
            mult = int(aposta.get("multiplier") or 1)
        else:
            # Powerball: só multiplica se ESTA aposta comprou Power Play.
            mult = int(resultado.get("multiplier") or 1) if aposta.get("hasPowerPlay") else 1

        tabela = faixa.get("byMultiplier") or {}
        if aposta.get("hasPowerPlay") and faixa.get("powerPlayFixedCents") is not None:
            valor = int(faixa["powerPlayFixedCents"])
        elif mult > 1 and str(mult) in tabela:
            # Valor EXPLÍCITO da fonte oficial. Sempre vence a conta — ver o comentário sobre a
            # Mega Millions em `assert_matriz_utilizavel`.
            valor = int(tabela[str(mult)])
        elif mult > 1 and tabela:
            raise ValueError(
                f"MULTIPLICADOR_FORA_DA_MATRIZ: {jogo} {faixa['label']} não tem valor oficial "
                f"para {mult}X (a fonte lista {sorted(tabela)}). Não se inventa o valor.")
        elif mult > 1 and faixa.get("multiplied"):
            valor = int(faixa["baseCents"]) * mult
        else:
            valor = int(faixa["baseCents"])
        return {"label": faixa["label"], "amountCents": valor, "jackpot": False}
    return None


def premio_do_sorteio(jogo, apostas, resultado, cfg=None):
    """Soma dos prêmios não-jackpot, mais o detalhamento por aposta."""
    linhas, total = [], 0
    for i, ap in enumerate(apostas):
        p = premio_da_aposta(jogo, ap, resultado, cfg)
        if not p:
            continue
        linhas.append({"index": i, **p})
        if p["amountCents"]:
            total += p["amountCents"]
    return {"totalCents": total, "linhas": linhas}


# ══ IDENTIDADE DO RESULTADO ═════════════════════════════════════════════════════════════════
def hash_resultado(jogo, draw_date, resultado):
    """
    DRAW_RESULT_IDENTITY = jogo + data + hash do resultado certificado.

    Deriva do CONTEÚDO. Se a fonte publicar números diferentes para o mesmo sorteio, o hash muda
    e a divergência aparece como incidente em vez de sobrescrever silenciosamente um resultado já
    liquidado.
    """
    corpo = {"game": jogo, "drawDate": draw_date,
             "numbers": sorted(int(n) for n in resultado["numbers"]),
             "special": int(resultado["special"]),
             "multiplier": int(resultado.get("multiplier") or 1)}
    bruto = json.dumps(corpo, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(bruto.encode()).hexdigest()[:16]


# ══ LIVRO-RAZÃO ═════════════════════════════════════════════════════════════════════════════
def le_ledger(caminho=None):
    p = Path(caminho or LEDGER)
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def append_ledger(evento, caminho=None):
    """
    Acrescenta se a chave de idempotência ainda não existir. Devolve (gravado, evento_efetivo).

    Nunca sobrescreve, nunca reescreve linha anterior. Reprocessar credita zero.
    """
    if evento["type"] not in TIPOS:
        raise ValueError(f"tipo inválido: {evento['type']}")
    for campo in ("idempotencyKey", "poolId", "amountCents", "reason", "source"):
        if not evento.get(campo) and evento.get(campo) != 0:
            raise ValueError(f"lançamento sem '{campo}' — todo movimento precisa de procedência")
    if not isinstance(evento["amountCents"], int) or isinstance(evento["amountCents"], bool):
        raise ValueError("amountCents precisa ser int (centavos)")

    # ── O SINAL TEM DE BATER COM O TIPO ─────────────────────────────────────────────────────
    esperado = SINAL[evento["type"]]
    valor = evento["amountCents"]
    if esperado > 0 and valor < 0:
        raise ValueError(
            f"SINAL_INVALIDO: {evento['type']} é dinheiro que ENTRA e veio {valor} centavos. "
            f"Um crédito negativo derruba o saldo derivado sem que o extrato pareça errado.")
    if esperado < 0 and valor > 0:
        raise ValueError(
            f"SINAL_INVALIDO: {evento['type']} é dinheiro que SAI e veio +{valor} centavos. "
            f"Uma compra que aumenta o caixa é dinheiro que não existe.")

    p = Path(caminho or LEDGER)
    p.parent.mkdir(parents=True, exist_ok=True)

    linha = dict(evento)
    linha.setdefault("eventId", hashlib.sha256(
        evento["idempotencyKey"].encode()).hexdigest()[:16])
    linha.setdefault("recordedAt", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))

    # ── LER-E-DEPOIS-ESCREVER PRECISA DE TRAVA ──────────────────────────────────────────────
    #
    # Conferir a chave e depois acrescentar são duas operações. Entre elas cabe outro processo
    # inteiro: dois workers reprocessando o mesmo sorteio leem "não existe" ao mesmo tempo, e os
    # dois acrescentam. O resultado é prêmio creditado em dobro — a chave de idempotência estaria
    # lá, duplicada, provando que a verificação rodou e não adiantou.
    #
    # `flock` fecha a janela: a checagem e o append acontecem sob a mesma trava exclusiva. O
    # arquivo de trava é separado do livro porque o livro é aberto em modo append por todos, e
    # travar o próprio alvo embaralha as duas responsabilidades.
    trava = p.with_suffix(p.suffix + ".lock")
    with trava.open("a+", encoding="utf-8") as t:
        fcntl.flock(t.fileno(), fcntl.LOCK_EX)
        try:
            existente = next((e for e in le_ledger(p)
                              if e["idempotencyKey"] == evento["idempotencyKey"]), None)
            if existente is not None:
                # ── REPROCESSAR NÃO É REESCREVER ────────────────────────────────────────────
                #
                # Chave repetida com o MESMO conteúdo é reprocessamento: no-op, que é o ponto da
                # idempotência. Chave repetida com conteúdo DIFERENTE é outra coisa — alguém
                # calculou outro valor para o mesmo fato.
                #
                # Antes, os dois casos eram tratados igual: o segundo era descartado em silêncio.
                # Um prêmio recalculado de US$38 para US$58 sob a mesma chave desapareceria sem
                # deixar rastro, e o livro continuaria "consistente". Divergência sobre dinheiro
                # tem de virar incidente, nunca o primeiro valor vencendo por chegar antes.
                divergentes = {c: (existente.get(c), evento.get(c))
                               for c in CAMPOS_DA_IDENTIDADE
                               if existente.get(c) != evento.get(c)}
                if divergentes:
                    raise ConflitoDeIdempotencia(
                        f"CONFLITO_DE_IDEMPOTENCIA: a chave {evento['idempotencyKey']!r} já "
                        f"existe com outro conteúdo — {divergentes} (gravado, novo). Isto é um "
                        f"incidente: ou a chave está sendo reutilizada para outro fato, ou o "
                        f"mesmo fato passou a valer outra coisa.")
                return False, evento
            with p.open("a", encoding="utf-8") as f:
                f.write(json.dumps(linha, ensure_ascii=False, sort_keys=True) + "\n")
                f.flush()
                os.fsync(f.fileno())
        finally:
            fcntl.flock(t.fileno(), fcntl.LOCK_UN)
    return True, linha


def saldo(caminho=None, pool_id=None):
    """Saldo DERIVADO. Não existe campo de saldo guardado para divergir do extrato."""
    return sum(e["amountCents"] for e in le_ledger(caminho)
               if pool_id is None or e.get("poolId") == pool_id)


def resumo(caminho=None):
    """Totais por tipo, mais o saldo. Para a UI e para o e-mail lerem uma fonte só."""
    ev = le_ledger(caminho)
    por_tipo = {}
    for e in ev:
        por_tipo[e["type"]] = por_tipo.get(e["type"], 0) + e["amountCents"]
    return {"lancamentos": len(ev), "porTipo": por_tipo,
            "saldoCents": sum(e["amountCents"] for e in ev)}


def chave_premio(jogo, draw_date, result_hash):
    """Um crédito de prêmio por identidade de resultado. Rerodar credita zero."""
    return f"prize:{jogo}:{draw_date}:{result_hash}"


def chave_carryover(pool_origem, pool_destino):
    return f"carryover:{pool_origem}->{pool_destino}"


def dinheiro(cents):
    return f"US$ {cents / 100:,.2f}"
