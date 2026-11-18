#!/usr/bin/env python3
"""Acrescenta UMA contribuicao a um manifesto de abertura, fora do repositorio (no runner).

POR QUE EXISTE
--------------
Desde 2026-11-18 o site le os participantes do sorteio aberto direto do banco. O que ainda exigia
PR por deposito era o MANIFESTO: `powerball_open_draw.yml` so aceitava um arquivo commitado. Com
o input `add_contribution`, o workflow parte do manifesto commitado do sorteio, acrescenta o
deposito novo num arquivo temporario do runner e aplica esse. Nada e commitado; o registro do
deposito fica no banco e no log do workflow, e o manifesto do repositorio e atualizado uma vez,
na sincronizacao antes da compra dos bilhetes.

O QUE ACEITA
------------
Um objeto JSON com EXATAMENTE `name`, `amount`, `method` e `paid_at` -- o que ja e publico no site.
Qualquer outra chave reprova: o input de workflow aparece no log publico do GitHub, entao uma
referencia de pagamento ou um memo jamais pode ter caminho para entrar por aqui.

O resto da validacao (nome casando com exatamente um participante, meio na lista fechada, data
valida, valor) continua em `operator_open_draw.py`, que roda em seguida sobre o resultado.

Uso:
    python3 manifest_add_contribution.py --manifest operations/2026-11-20.json \
        --add '{"name":"Fulano","amount":10,"method":"Zelle","paid_at":"2026-11-18T10:01:20-05:00"}' \
        --out "$RUNNER_TEMP/manifest.json"
"""
import argparse
import json
import sys
import unicodedata
from datetime import datetime

CHAVES = {"name", "amount", "method", "paid_at"}


class ErroDeposito(ValueError):
    pass


def _norm(nome: str) -> str:
    s = unicodedata.normalize("NFKD", nome or "")
    return " ".join("".join(c for c in s if not unicodedata.combining(c)).lower().split())


def acrescenta(manifesto: dict, bruto: str) -> dict:
    """Devolve um manifesto NOVO com a contribuicao acrescentada. Nao altera o original."""
    try:
        item = json.loads(bruto)
    except json.JSONDecodeError as ex:
        raise ErroDeposito(f"add_contribution nao e JSON valido: {ex.msg}") from ex
    if not isinstance(item, dict):
        raise ErroDeposito("add_contribution tem de ser um objeto JSON")
    if set(item) != CHAVES:
        extra, falta = sorted(set(item) - CHAVES), sorted(CHAVES - set(item))
        raise ErroDeposito(f"add_contribution aceita so {sorted(CHAVES)} (sobra {extra}, falta {falta})")
    if not isinstance(item["name"], str) or not item["name"].strip():
        raise ErroDeposito("name vazio")
    if isinstance(item["amount"], bool) or not isinstance(item["amount"], (int, float)) or item["amount"] <= 0:
        raise ErroDeposito(f"amount invalido: {item['amount']!r}")
    if not isinstance(item["method"], str) or not isinstance(item["paid_at"], str):
        raise ErroDeposito("method e paid_at tem de ser texto")
    try:
        pago = datetime.fromisoformat(item["paid_at"])
    except ValueError as ex:
        raise ErroDeposito(f"paid_at invalido: {item['paid_at']!r}") from ex
    if pago.tzinfo is None:
        raise ErroDeposito("paid_at sem fuso horario")

    novo = json.loads(json.dumps(manifesto))
    entradas = novo.get("contributions")
    if not isinstance(entradas, list):
        raise ErroDeposito("manifesto sem lista `contributions`")
    for e in entradas:
        if _norm(e.get("name")) == _norm(item["name"]):
            if e.get("name") == item["name"] and e.get("paid_at") == item["paid_at"] \
                    and e.get("amount") == item["amount"] and e.get("method") == item["method"]:
                return novo  # mesmo deposito de novo: idempotente
            raise ErroDeposito(
                f"{item['name']!r} ja tem contribuicao neste manifesto com outros dados; "
                "segunda cota ou correcao vai pelo manifesto em PR, nao por aqui")
    entradas.append({k: item[k] for k in ("name", "amount", "method", "paid_at")})
    return novo


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--add", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    with open(a.manifest, encoding="utf-8") as f:
        base = json.load(f)
    try:
        novo = acrescenta(base, a.add)
    except ErroDeposito as ex:
        print(f"::error::{ex}")
        return 1
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(novo, f, ensure_ascii=False, indent=2)
    print(f"manifesto efetivo: {len(novo['contributions'])} contribuicao(oes) para {novo.get('draw_date')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
