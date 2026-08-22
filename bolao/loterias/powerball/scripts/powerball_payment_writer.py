#!/usr/bin/env python3
"""
ESCRITOR REAL do razao de pagamentos do Powerball.

─── POR QUE ESTE ARQUIVO PRECISOU EXISTIR ──────────────────────────────────────────────────────

`operator_payments.py` sempre importou `SupabasePaymentWriter` daqui, tarde, dentro de `--apply`.
O arquivo nunca existiu em nenhum branch. Consequencia: o caminho de operador dry-run funcionava e
era testado, e o caminho de ESCRITA morria com `ModuleNotFoundError` na primeira tentativa real.
O `powerball_record_payment.yml` era, na pratica, um simulador.

Encontrado em 2026-08-22, ao procurar onde a integridade de reversao era garantida.

─── A INTEGRIDADE QUE O BANCO NAO CONSEGUE GARANTIR SOZINHO ───────────────────────────────────

O schema ja tem: FK de `reverses_transaction_id`, CHECK de nao-autorreversao, CHECK de reversao com
alvo, e gatilho de imutabilidade. Nada disso prova as duas coisas que mais importam numa reversao:

  1. o valor e exatamente o INVERSO do alvo;
  2. a reversao pertence a MESMA participacao do alvo.

Sem (1), uma reversao de -1,00 sobre um ajuste de +2,00 deixa 1,00 pendurado no razao e ninguem
percebe: as duas linhas existem, o FK esta certo, o CHECK esta satisfeito.
Sem (2), uma reversao pode anular a linha de OUTRA pessoa -- os totais globais fecham e os
individuais mentem, que e a forma mais dificil de enxergar.

`build_request()` nao pode verificar nenhuma das duas: ele e puro de proposito (nao fala com o
banco), e as duas exigem LER o alvo. Entao a verificacao mora aqui, imediatamente antes da escrita,
lendo o alvo real -- e a parte que decide esta isolada em `check_reversal_integrity()`, pura, para
ser testada sem rede.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
TABLE = "lottery_payment_transactions"


class OperatorError(Exception):
    """Mesmo contrato de erro de `operator_payments.py` — invariante violado, entrada invalida."""


def _cents(value) -> int:
    """Centavos inteiros. Comparar dinheiro em float e como -2.00 + 2.00 deixa de dar exatamente 0."""
    return round(float(value) * 100)


def check_reversal_integrity(req: dict, target: dict | None, existing_reversals: list) -> None:
    """As duas invariantes que so podem ser checadas contra o ALVO REAL. Pura: nao fala com a rede.

    Levanta `OperatorError` na primeira violacao. Nunca "corrige" o pedido em silencio: um pedido de
    reversao com valor errado e um erro do operador, e adivinhar o que ele quis dizer e como uma
    correcao financeira vira uma segunda correcao financeira.
    """
    if target is None:
        raise OperatorError("alvo da reversao nao existe — uma reversao sem alvo real nao e uma reversao")

    if target.get("type") == "reversal":
        raise OperatorError("nao se reverte uma reversao — para desfazer, lance um contra-lancamento novo")

    alvo_cents = _cents(target["amount"])
    pedido_cents = _cents(req["amount"])
    if pedido_cents != -alvo_cents:
        raise OperatorError(
            f"valor da reversao precisa ser o inverso exato do alvo: alvo {alvo_cents / 100:+.2f}, "
            f"pedido {pedido_cents / 100:+.2f}. Uma reversao parcial deixa saldo pendurado no razao "
            f"sem que nenhuma constraint perceba.")

    if str(req["participation_id"]) != str(target["participation_id"]):
        raise OperatorError(
            "a reversao precisa pertencer a MESMA participacao do alvo — reverter a linha de outra "
            "pessoa fecha o total global e mente no individual, que e o erro mais dificil de ver.")

    if existing_reversals:
        raise OperatorError(
            f"o alvo ja foi revertido ({len(existing_reversals)} reversao(oes)) — reverter duas vezes "
            f"inverte o sinal em vez de anular")


class SupabasePaymentWriter:
    """Escrita via PostgREST com `service_role`.

    `service_role` e necessario porque a Issue #131 revogou todo CRUD de `anon`/`authenticated`
    nestas tabelas. A credencial vem do ambiente e NUNCA e impressa.
    """

    def __init__(self, url: str = SUPABASE_URL, key: str | None = None):
        self.url = url.rstrip("/")
        self.key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not self.key:
            raise OperatorError("SUPABASE_SERVICE_ROLE_KEY ausente — sem credencial nao ha escrita")

    def _request(self, method: str, path: str, body=None, prefer: str | None = None):
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}", method=method)
        req.add_header("apikey", self.key)
        req.add_header("Authorization", f"Bearer {self.key}")
        req.add_header("Content-Type", "application/json")
        if prefer:
            req.add_header("Prefer", prefer)
        data = json.dumps(body).encode() if body is not None else None
        try:
            with urllib.request.urlopen(req, data, timeout=30) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw.strip() else []
        except urllib.error.HTTPError as ex:
            detalhe = ex.read().decode()[:400]
            # A credencial nao aparece: `detalhe` e corpo de resposta do PostgREST, nao o header.
            raise OperatorError(f"PostgREST {ex.code} em {method} {path}: {detalhe}") from ex

    def _select(self, query: str) -> list:
        return self._request("GET", f"{TABLE}?{query}")

    def list(self, req: dict) -> list:
        q = "select=transaction_id,type,amount,participation_id,reverses_transaction_id&order=created_at"
        if req.get("participation_id"):
            q += f"&participation_id=eq.{req['participation_id']}"
        return self._select(q)

    def insert_transaction(self, req: dict) -> dict:
        # 1. Idempotencia ANTES de qualquer coisa. Reexecutar um dispatch depois de um erro
        #    transitorio nao pode cobrar a pessoa duas vezes.
        ref = req["operator_client_ref"]
        ja = self._select(f"operator_client_ref=eq.{ref}&select=transaction_id,amount,participation_id")
        if ja:
            existente = ja[0]
            if (_cents(existente["amount"]) != _cents(req["amount"])
                    or str(existente["participation_id"]) != str(req["participation_id"])):
                raise OperatorError(
                    "CONFLITO: mesmo operator_client_ref com requisicao semanticamente diferente — "
                    "a chave de idempotencia esta sendo reutilizada para outra intencao")
            return {"applied": False, "already": True, "transaction_id": existente["transaction_id"]}

        # 2. Integridade da reversao contra o alvo REAL.
        if req["txn_type"] == "reversal":
            alvo_id = req["reverses_transaction_id"]
            alvos = self._select(f"transaction_id=eq.{alvo_id}&select=transaction_id,type,amount,participation_id")
            reversoes = self._select(f"reverses_transaction_id=eq.{alvo_id}&select=transaction_id")
            check_reversal_integrity(req, alvos[0] if alvos else None, reversoes)

        linha = {
            "participation_id": req["participation_id"],
            "type": req["txn_type"],
            "amount": req["amount"],
            "source": "operator",
            "operator_client_ref": ref,
        }
        for origem, destino in (("external_reference", "external_reference"), ("method", "method"),
                                ("reason", "reason"), ("reverses_transaction_id", "reverses_transaction_id")):
            if req.get(origem):
                linha[destino] = req[origem]

        criado = self._request("POST", TABLE, [linha], prefer="return=representation")
        return {"applied": True, "transaction_id": criado[0]["transaction_id"]}
