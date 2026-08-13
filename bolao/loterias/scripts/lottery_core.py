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

import json
import hashlib
from datetime import date, datetime, timezone
from pathlib import Path

# parents[0] de um ARQUIVO é o diretório dele, então a raiz do repo é [3] aqui e
# [2] nos scripts que partem de `Path(__file__).parent`. Confundir os dois faz o
# caminho apontar para `bolao/bolao/...`.
RAIZ = Path(__file__).resolve().parents[3]
CONFIG = RAIZ / "bolao" / "loterias" / "config" / "lottery_policy.json"
LEDGER = RAIZ / "bolao" / "loterias" / "config" / "lottery_ledger.jsonl"

TIPOS = {"CONTRIBUTION", "TICKET_PURCHASE", "PRIZE_CREDIT",
         "CARRYOVER_IN", "CARRYOVER_OUT", "OPERATOR_ADJUSTMENT"}


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

        if aposta.get("hasPowerPlay") and faixa.get("powerPlayFixedCents") is not None:
            valor = int(faixa["powerPlayFixedCents"])
        elif faixa["multiplied"]:
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
    if not isinstance(evento["amountCents"], int):
        raise ValueError("amountCents precisa ser int (centavos)")

    p = Path(caminho or LEDGER)
    existentes = {e["idempotencyKey"] for e in le_ledger(p)}
    if evento["idempotencyKey"] in existentes:
        return False, evento

    linha = dict(evento)
    linha.setdefault("eventId", hashlib.sha256(
        evento["idempotencyKey"].encode()).hexdigest()[:16])
    linha.setdefault("recordedAt", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(linha, ensure_ascii=False, sort_keys=True) + "\n")
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
