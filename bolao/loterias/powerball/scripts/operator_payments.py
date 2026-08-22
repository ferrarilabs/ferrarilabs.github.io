#!/usr/bin/env python3
"""
OPERACAO DE PAGAMENTO DO POWERBALL — caminho de operador, server-side (Issue #130, Opcao C).

─── A DECISAO QUE ESTE ARQUIVO IMPLEMENTA ───────────────────────────────────────────────────────

O dono decidiu, em 2026-08-22: o banco PostgreSQL/Supabase e o SISTEMA DE REGISTRO autoritativo de
participante, participacao e transacao de pagamento. GitHub Secrets guardam CREDENCIAL e
CONFIGURACAO -- nunca de novo o livro-caixa.

─── POR QUE NAO UM PAINEL NO NAVEGADOR ──────────────────────────────────────────────────────────

Porque o Powerball nao tem usuario autenticado nem caminho de JWT: um portao de admin no navegador
seria um hash de senha do lado do cliente guardando REGISTRO DE DINHEIRO. E porque dar CRUD de
`lottery_*` ao navegador reabriria exatamente o que a Issue #131 fechou em producao.

Aqui a autenticacao e a do GitHub -- conta real, 2FA real -- e a credencial privilegiada nunca sai
do runner. Nenhuma chave de banco entra em codigo de navegador.

─── QUATRO OPERACOES, E SO ELAS ─────────────────────────────────────────────────────────────────

    record_payment    registra uma contribuicao
    correct_payment   NAO edita: insere um `adjustment` que aponta para a original
    void_payment      NAO apaga: insere um `reversal` que aponta para a original
    list_payments     somente leitura

Operacao desconhecida FALHA FECHADO. Nao ha caminho generico de SQL.

─── O QUE O BANCO JA GARANTE, E QUE ESTE ARQUIVO NAO PRECISA REIMPLEMENTAR ─────────────────────

Desde a migracao 20260822134050 o proprio banco recusa: UPDATE de campo financeiro, DELETE de
historico, reversao sem alvo, auto-reversao, reversao dupla e `operator_client_ref` repetido. A
idempotencia NAO mora aqui -- mora num indice unico. Este arquivo constroi a chave; quem a impoe e
o PostgreSQL, que continua impondo mesmo se este script for contornado.

─── PII ─────────────────────────────────────────────────────────────────────────────────────────

`external_reference` (Zelle/Venmo) e mascarado em toda saida. O valor cheio vai para o banco, nunca
para o log do Actions, que e legivel por qualquer pessoa com acesso ao repositorio -- audiencia
maior do que o dado merece.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

OPERATIONS = ("record_payment", "correct_payment", "void_payment", "list_payments")

# Tipos do enum `payment_txn_type` que cada operacao pode emitir. Nao ha outro caminho.
OP_TXN_TYPE = {"record_payment": "contribution", "correct_payment": "adjustment", "void_payment": "reversal"}


class OperatorError(Exception):
    """Erro de contrato: entrada invalida, operacao desconhecida, invariante violado."""


def mask(value: str | None) -> str:
    """Referencia de pagamento em log/UI aparece mascarada. Sempre."""
    if not value:
        return "(none)"
    v = str(value)
    return v[:2] + "…" + v[-2:] if len(v) > 6 else "…"


def operator_client_ref(operation: str, participation_id: str, amount, external_reference: str | None,
                        operator: str, intent_date: str) -> str:
    """Identidade da ACAO do operador.

    Inclui a data da INTENCAO, nao o instante da execucao: reexecutar o mesmo dispatch depois de um
    erro transitorio tem de colidir, e duas intencoes legitimas em dias diferentes nao podem.

    NAO inclui o instante exato nem um contador -- se incluisse, toda reexecucao geraria uma chave
    nova e a idempotencia deixaria de existir justamente no caso em que ela importa.
    """
    material = "|".join([operation, str(participation_id), f"{amount}",
                         external_reference or "", operator, intent_date])
    return "op:" + hashlib.sha256(material.encode()).hexdigest()[:32]


def _require(cond, msg):
    if not cond:
        raise OperatorError(msg)


def _amount(raw) -> float:
    try:
        v = round(float(raw), 2)
    except (TypeError, ValueError) as ex:
        raise OperatorError(f"amount invalido: {raw!r}") from ex
    _require(v != 0, "amount nao pode ser zero")
    return v


def build_request(args: dict) -> dict:
    """Valida e normaliza. NAO fala com o banco -- e o que torna isto testavel sem producao."""
    op = args.get("operation")
    _require(op in OPERATIONS, f"operacao desconhecida: {op!r} — permitidas: {', '.join(OPERATIONS)}")

    operator = (args.get("operator") or "").strip()
    _require(operator, "operator (identidade do operador) e obrigatorio")

    if op == "list_payments":
        return {"operation": op, "operator": operator, "participation_id": args.get("participation_id")}

    participation_id = (args.get("participation_id") or "").strip()
    _require(participation_id, "participation_id e obrigatorio")

    intent_date = (args.get("intent_date") or datetime.now(timezone.utc).date().isoformat())
    amount = _amount(args.get("amount"))
    ext = (args.get("external_reference") or None)

    req = {
        "operation": op,
        "txn_type": OP_TXN_TYPE[op],
        "operator": operator,
        "participation_id": participation_id,
        "amount": amount,
        "external_reference": ext,
        "method": args.get("method") or None,
        "intent_date": intent_date,
        "reason": (args.get("reason") or "").strip() or None,
        "reverses_transaction_id": (args.get("reverses_transaction_id") or "").strip() or None,
        "request_id": args.get("request_id") or None,
        "correlation_id": args.get("correlation_id") or None,
    }

    if op in ("correct_payment", "void_payment"):
        _require(req["reason"], f"{op} exige `reason` — correcao financeira sem motivo nao e auditavel")
    if op == "void_payment":
        _require(req["reverses_transaction_id"],
                 "void_payment exige reverses_transaction_id — uma reversao sem alvo nao e uma reversao")
        _require(req["reverses_transaction_id"] != args.get("transaction_id"),
                 "auto-reversao e incoerente")

    req["operator_client_ref"] = operator_client_ref(
        op, participation_id, amount, ext, operator, intent_date)
    return req


def render(req: dict) -> str:
    """Resumo para o log. Referencia SEMPRE mascarada."""
    if req["operation"] == "list_payments":
        return f"list_payments participation={req.get('participation_id') or '(all)'} by {req['operator']}"
    return (f"{req['operation']} → type={req['txn_type']} amount={req['amount']:.2f} "
            f"participation={req['participation_id']} ref={mask(req.get('external_reference'))} "
            f"client_ref={req['operator_client_ref'][:12]}… by {req['operator']}")


def execute(req: dict, writer, *, dry_run: bool = True) -> dict:
    """Executa via `writer` injetado.

    `writer` e injetado por contrato: nenhum teste alcanca o banco, e o caminho de producao usa o
    escritor real que so o runner consegue construir (a credencial e um secret do Actions).
    """
    if req["operation"] == "list_payments":
        return {"applied": False, "read_only": True, "rows": writer.list(req)}
    if dry_run:
        return {"applied": False, "dry_run": True, "would": render(req)}
    return writer.insert_transaction(req)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Operacao de pagamento do Powerball (server-side)")
    ap.add_argument("--operation", required=True, choices=OPERATIONS)
    ap.add_argument("--participation-id")
    ap.add_argument("--amount")
    ap.add_argument("--external-reference")
    ap.add_argument("--method")
    ap.add_argument("--reason")
    ap.add_argument("--reverses-transaction-id")
    ap.add_argument("--intent-date")
    ap.add_argument("--operator", default=os.environ.get("GITHUB_ACTOR", ""))
    ap.add_argument("--request-id", default=os.environ.get("GITHUB_RUN_ID"))
    ap.add_argument("--apply", action="store_true", help="sem esta flag o padrao e dry-run")
    args = ap.parse_args(argv)

    try:
        req = build_request({k.replace("-", "_"): v for k, v in vars(args).items()})
    except OperatorError as ex:
        print(f"REJECTED: {ex}")
        return 2

    print(render(req))
    if not args.apply:
        print("DRY RUN — nada foi gravado. Repita com --apply para executar.")
        return 0

    from powerball_payment_writer import SupabasePaymentWriter  # import tardio: so o runner o tem
    result = execute(req, SupabasePaymentWriter(), dry_run=False)
    print(json.dumps({k: v for k, v in result.items() if k != "external_reference"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
