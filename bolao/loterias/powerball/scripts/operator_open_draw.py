#!/usr/bin/env python3
"""
ABERTURA DE SORTEIO NO BANCO — caminho de operador, server-side.

─── POR QUE ESTE ARQUIVO PRECISOU EXISTIR ──────────────────────────────────────────────────────

Desde o cutover de 2026-08-22 o banco e o sistema de registro e `data.js` e PROJECAO dele
(`generate_public_projection.mjs --check` reprova qualquer divergencia). Mas o unico caminho de
escrita que sobrou foi `operator_payments.py`, que exige um `participation_id` JA EXISTENTE. Nada
criava o sorteio nem as participacoes de um sorteio NOVO -- o backfill historico foi SQL avulso.
Resultado medido em 2026-10-27: o primeiro sorteio depois do cutover nao tinha como entrar no site
sem editar `data.js` a mao, que e exatamente o que o gate proibe.

─── O QUE FAZ ──────────────────────────────────────────────────────────────────────────────────

Le um MANIFESTO versionado (revisado em PR) e, para o sorteio dele:

    1. garante a linha em `lottery_draws`      (mesmo pool do ultimo sorteio)
    2. garante uma participacao por pessoa      (`lottery_participations`)
    3. registra cada contribuicao               (via `SupabasePaymentWriter`, o escritor existente)

Tudo e RESOLVIDO antes de qualquer escrita: um nome que nao casa com exatamente um participante
do banco reprova a execucao inteira com ZERO escritas. Reexecutar e seguro: cada passo procura o
que ja existe antes de inserir, e a contribuicao herda a idempotencia por `operator_client_ref`.

─── O QUE NUNCA FAZ ────────────────────────────────────────────────────────────────────────────

Nao cria participante novo (identidade por nome e fraca -- ver #298; pessoa nova e decisao do
Eduardo, nao inferencia). Nao edita nem apaga linha existente. Nao recebe referencia de pagamento:
o repositorio e PUBLICO e o GitHub imprime inputs de workflow no log, entao o manifesto carrega so o
que ja e publico no site (nome, valor, meio, data/hora).

Uso:
    python3 operator_open_draw.py --manifest ../operations/2026-10-28.json            # dry-run
    python3 operator_open_draw.py --manifest ../operations/2026-10-28.json --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import operator_payments as op  # noqa: E402

OperatorError = op.OperatorError
METODOS = ("Zelle", "Venmo", "Cash App", "Fundo próprio (organizador)")


def _norm(nome: str) -> str:
    """Comparacao de nome sem caixa nem acento. NAO e similaridade: so igualdade normalizada."""
    s = unicodedata.normalize("NFKD", str(nome)).encode("ascii", "ignore").decode()
    return " ".join(s.casefold().split())


def valida_manifesto(m: dict) -> dict:
    """Puro. Reprova cedo o que nao pode virar fato financeiro."""
    op._require(isinstance(m, dict), "manifesto precisa ser um objeto")
    try:
        date.fromisoformat(m.get("draw_date") or "")
    except ValueError as ex:
        raise OperatorError(f"draw_date invalida: {m.get('draw_date')!r}") from ex
    for k in ("jackpot", "cash_value"):
        if m.get(k) is not None:
            op._require(isinstance(m[k], (int, float)) and m[k] > 0, f"{k} invalido: {m[k]!r}")
    entradas = m.get("contributions")
    op._require(isinstance(entradas, list) and entradas, "manifesto sem contribuicoes")
    vistos = set()
    for i, e in enumerate(entradas):
        nome = (e.get("name") or "").strip()
        op._require(nome, f"contribuicao {i}: name vazio")
        op._require(_norm(nome) not in vistos, f"contribuicao {i}: {nome} repetido no manifesto")
        vistos.add(_norm(nome))
        op._amount(e.get("amount"))
        op._require(float(e["amount"]) > 0, f"contribuicao {i}: valor precisa ser positivo")
        op._require(e.get("method") in METODOS, f"contribuicao {i}: metodo desconhecido {e.get('method')!r}")
        try:
            pago = datetime.fromisoformat(e.get("paid_at") or "")
        except ValueError as ex:
            raise OperatorError(f"contribuicao {i}: paid_at invalido {e.get('paid_at')!r}") from ex
        op._require(pago.tzinfo is not None, f"contribuicao {i}: paid_at sem fuso")
        op._require("external_reference" not in e,
                    f"contribuicao {i}: referencia de pagamento NAO entra no manifesto (repo publico)")
    return m


def planeja(m: dict, banco: dict, operador: str) -> dict:
    """Puro: decide TUDO a partir do estado lido. Nenhuma escrita acontece se isto levantar.

    `banco` = {"draws": [...], "participants": [...], "participations": [...]} lido do PostgREST.
    """
    draws = sorted(banco["draws"], key=lambda d: d["draw_date"])
    op._require(draws, "banco sem nenhum sorteio — nao ha pool de onde herdar")
    pools = {d["pool_id"] for d in draws}
    op._require(len(pools) == 1, f"{len(pools)} pools distintos no banco — recuso escolher um")
    pool_id = pools.pop()

    alvo = [d for d in draws if d["draw_date"] == m["draw_date"]]
    op._require(len(alvo) <= 1, f"{len(alvo)} linhas para {m['draw_date']} — duplicata no banco")
    draw = alvo[0] if alvo else None
    op._require(draw or m["draw_date"] > draws[-1]["draw_date"],
                f"{m['draw_date']} e anterior ao ultimo sorteio do banco — nao abro sorteio no passado")

    por_nome: dict[str, list] = {}
    for p in banco["participants"]:
        por_nome.setdefault(_norm(p["display_name"]), []).append(p)

    problemas, itens = [], []
    for e in m["contributions"]:
        candidatos = por_nome.get(_norm(e["name"]), [])
        if len(candidatos) != 1:
            problemas.append(f"{e['name']}: {len(candidatos)} participante(s) no banco com esse nome")
            continue
        pessoa = candidatos[0]
        existentes = [pa for pa in banco["participations"]
                      if draw and pa["draw_id"] == draw["draw_id"]
                      and pa["participant_id"] == pessoa["participant_id"]]
        if len(existentes) > 1:
            problemas.append(f"{e['name']}: {len(existentes)} participacoes no mesmo sorteio")
            continue
        itens.append({"entrada": e, "participant_id": pessoa["participant_id"],
                      "display_name": pessoa["display_name"],
                      "participation_id": existentes[0]["participation_id"] if existentes else None})
    if problemas:
        raise OperatorError("manifesto nao resolve deterministicamente — ZERO escritas:\n  - "
                            + "\n  - ".join(problemas))

    return {"pool_id": pool_id, "draw": draw, "draw_date": m["draw_date"],
            "jackpot": m.get("jackpot"), "cash_value": m.get("cash_value"),
            "operador": operador, "itens": itens}


def requisicao_de_contribuicao(item: dict, participation_id: str, operador: str) -> dict:
    """Mesma construcao e mesma chave de idempotencia de `operator_payments.py`."""
    e = item["entrada"]
    req = op.build_request({
        "operation": "record_payment", "operator": operador, "participation_id": participation_id,
        "amount": e["amount"], "method": e["method"],
        "intent_date": datetime.fromisoformat(e["paid_at"]).date().isoformat(),
    })
    req["paid_at"] = e["paid_at"]
    return req


def resumo(plano: dict) -> str:
    d = plano["draw"]
    linhas = [f"sorteio {plano['draw_date']}: "
              + (f"JA EXISTE ({d['draw_id'][:8]}…)" if d else "CRIAR")
              + f" · pool {plano['pool_id'][:8]}… · jackpot {plano['jackpot']}"]
    for it in plano["itens"]:
        e = it["entrada"]
        pa = it["participation_id"]
        linhas.append(f"  {it['display_name']:<28} {float(e['amount']):>7.2f} {e['method']:<10} "
                      f"participacao {'existe ' + pa[:8] + '…' if pa else 'CRIAR'}")
    total = sum(float(it["entrada"]["amount"]) for it in plano["itens"])
    linhas.append(f"  TOTAL {len(plano['itens'])} contribuicao(oes) = {total:.2f}")
    return "\n".join(linhas)


class SupabaseDrawWriter:
    """Leitura e as duas insercoes estruturais. Contribuicao vai pelo escritor de pagamento."""

    def __init__(self, pagamentos):
        self.pg = pagamentos

    def le(self) -> dict:
        r = self.pg._request
        return {
            "draws": r("GET", "lottery_draws?select=draw_id,pool_id,draw_date&order=draw_date"),
            "participants": r("GET", "lottery_participants?select=participant_id,display_name"),
            "participations": r("GET", "lottery_participations?select=participation_id,participant_id,draw_id"),
        }

    def cria_sorteio(self, plano: dict) -> str:
        linha = {"pool_id": plano["pool_id"], "draw_date": plano["draw_date"]}
        if plano["jackpot"] is not None:
            linha["jackpot_estimate"] = plano["jackpot"]
        if plano["cash_value"] is not None:
            linha["cash_value_estimate"] = plano["cash_value"]
        return self.pg._request("POST", "lottery_draws", [linha], prefer="return=representation")[0]["draw_id"]

    def cria_participacao(self, participant_id: str, pool_id: str, draw_id: str) -> str:
        linha = {"participant_id": participant_id, "pool_id": pool_id, "draw_id": draw_id, "cotas": 1}
        return self.pg._request("POST", "lottery_participations", [linha],
                                prefer="return=representation")[0]["participation_id"]


def aplica(plano: dict, escritor) -> list:
    draw_id = plano["draw"]["draw_id"] if plano["draw"] else escritor.cria_sorteio(plano)
    out = []
    for it in plano["itens"]:
        pa = it["participation_id"] or escritor.cria_participacao(
            it["participant_id"], plano["pool_id"], draw_id)
        res = escritor.pg.insert_transaction(requisicao_de_contribuicao(it, pa, plano["operador"]))
        out.append({"name": it["display_name"], "participation_id": pa, **res})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Abre um sorteio do Powerball no banco (server-side)")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--operator", default=os.environ.get("GITHUB_ACTOR", ""))
    ap.add_argument("--apply", action="store_true", help="sem esta flag o padrao e dry-run")
    a = ap.parse_args(argv)

    try:
        operador = a.operator.strip()
        op._require(operador, "operator (identidade do operador) e obrigatorio")
        m = valida_manifesto(json.load(open(a.manifest, encoding="utf-8")))
        from powerball_payment_writer import SupabasePaymentWriter  # import tardio: so o runner o tem
        escritor = SupabaseDrawWriter(SupabasePaymentWriter())
        plano = planeja(m, escritor.le(), operador)
    except (OperatorError, OSError, json.JSONDecodeError) as ex:
        print(f"REJECTED: {ex}")
        return 2

    print(resumo(plano))
    if not a.apply:
        print("DRY RUN — nada foi gravado. Repita com --apply para executar.")
        return 0

    try:
        resultado = aplica(plano, escritor)
    except OperatorError as ex:
        print(f"FALHOU NO MEIO: {ex}\nReexecutar e seguro: o que ja foi gravado e reconhecido.")
        return 1
    for r in resultado:
        print(f"  {r['name']:<28} {'GRAVADO' if r.get('applied') else 'ja existia'} "
              f"participacao {r['participation_id'][:8]}… txn {r['transaction_id'][:8]}…")
    print(f"APPLIED — {sum(1 for r in resultado if r.get('applied'))} nova(s), "
          f"{sum(1 for r in resultado if r.get('already'))} ja existente(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
