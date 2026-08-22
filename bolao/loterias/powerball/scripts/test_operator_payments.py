#!/usr/bin/env python3
"""
Testes do caminho de operador de pagamento do Powerball (Issue #130).

Nenhum teste alcanca o banco: `execute()` recebe um escritor INJETADO, e o escritor real so e
importado dentro de `main()` com `--apply`. Isso e estrutural, nao disciplina -- nao existe caminho
por onde uma execucao de teste crie um pagamento de producao.

O que estes casos protegem, em uma frase: que dinheiro nao seja corrigido apagando o passado, e que
reexecutar um dispatch nao cobre a pessoa duas vezes.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import operator_payments as op  # noqa: E402


class FakeWriter:
    """Escritor duplo. Reproduz o indice unico do banco -- nao mais que isso."""

    def __init__(self):
        self.rows = []

    def insert_transaction(self, req):
        ref = req["operator_client_ref"]
        if any(r["operator_client_ref"] == ref for r in self.rows):
            existing = next(r for r in self.rows if r["operator_client_ref"] == ref)
            if existing["amount"] != req["amount"] or existing["participation_id"] != req["participation_id"]:
                raise AssertionError("CONFLITO: mesmo operator_client_ref com requisicao semantica diferente")
            return {"applied": False, "already": True, "transaction_id": existing["transaction_id"]}
        row = {**req, "transaction_id": f"txn-{len(self.rows)+1}"}
        self.rows.append(row)
        return {"applied": True, "transaction_id": row["transaction_id"]}

    def list(self, req):
        return [{"transaction_id": r["transaction_id"], "amount": r["amount"]} for r in self.rows]


BASE = {"operation": "record_payment", "participation_id": "p-1", "amount": "10.00",
        "external_reference": "REDACTED_PAYMENT_REFERENCE", "operator": "someone", "intent_date": "2026-08-22"}


class Allowlist(unittest.TestCase):
    def test_operacao_desconhecida_falha_fechado(self):
        with self.assertRaises(op.OperatorError):
            op.build_request({**BASE, "operation": "delete_everything"})

    def test_as_quatro_operacoes_sao_exatamente_essas(self):
        self.assertEqual(op.OPERATIONS, ("record_payment", "correct_payment", "void_payment", "list_payments"))
        # Nenhuma operacao pode emitir um tipo fora do enum do banco.
        self.assertEqual(set(op.OP_TXN_TYPE.values()), {"contribution", "adjustment", "reversal"})

    def test_operador_e_obrigatorio(self):
        with self.assertRaises(op.OperatorError):
            op.build_request({**BASE, "operator": ""})

    def test_amount_zero_e_invalido(self):
        with self.assertRaises(op.OperatorError):
            op.build_request({**BASE, "amount": "0"})


class AppendOnly(unittest.TestCase):
    def test_correcao_insere_ajuste_e_nao_edita(self):
        r = op.build_request({**BASE, "operation": "correct_payment", "reason": "valor digitado errado"})
        self.assertEqual(r["txn_type"], "adjustment")

    def test_anulacao_insere_reversao_e_nao_apaga(self):
        r = op.build_request({**BASE, "operation": "void_payment", "reason": "pagamento nao compensou",
                              "reverses_transaction_id": "txn-1"})
        self.assertEqual(r["txn_type"], "reversal")

    def test_correcao_e_anulacao_exigem_motivo(self):
        for o in ("correct_payment", "void_payment"):
            with self.assertRaises(op.OperatorError, msg=o):
                op.build_request({**BASE, "operation": o, "reverses_transaction_id": "txn-1", "reason": ""})

    def test_anulacao_sem_alvo_e_recusada(self):
        with self.assertRaises(op.OperatorError):
            op.build_request({**BASE, "operation": "void_payment", "reason": "x"})

    def test_nenhuma_operacao_produz_update_ou_delete(self):
        fonte = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "operator_payments.py"), encoding="utf-8").read().lower()
        for proibido in ("update lottery_payment", "delete from lottery_payment", "truncate"):
            self.assertNotIn(proibido, fonte, f"o caminho de operador nao pode conter `{proibido}`")


class Idempotencia(unittest.TestCase):
    def test_mesma_requisicao_gera_a_mesma_chave(self):
        a = op.build_request(dict(BASE))["operator_client_ref"]
        b = op.build_request(dict(BASE))["operator_client_ref"]
        self.assertEqual(a, b, "reexecutar o mesmo dispatch tem de colidir — e o ponto da chave")

    def test_requisicao_diferente_gera_chave_diferente(self):
        a = op.build_request(dict(BASE))["operator_client_ref"]
        for campo, valor in (("amount", "11.00"), ("participation_id", "p-2"),
                             ("external_reference", "ZELLE-XYZ-99999"), ("intent_date", "2026-08-23")):
            self.assertNotEqual(a, op.build_request({**BASE, campo: valor})["operator_client_ref"],
                                f"mudar {campo} tem de mudar a chave")

    def test_reexecucao_nao_duplica_pagamento(self):
        w = FakeWriter()
        r = op.build_request(dict(BASE))
        first = op.execute(r, w, dry_run=False)
        second = op.execute(r, w, dry_run=False)
        self.assertTrue(first["applied"])
        self.assertFalse(second["applied"], "a segunda execucao nao pode criar transacao")
        self.assertEqual(len(w.rows), 1)

    def test_mesma_chave_com_semantica_diferente_e_conflito_duro(self):
        # So alcancavel se alguem forjar a chave; o contrato exige que isso NAO vire pagamento novo.
        w = FakeWriter()
        r1 = op.build_request(dict(BASE))
        op.execute(r1, w, dry_run=False)
        r2 = {**op.build_request({**BASE, "amount": "999.00"}), "operator_client_ref": r1["operator_client_ref"]}
        with self.assertRaises(AssertionError):
            op.execute(r2, w, dry_run=False)
        self.assertEqual(len(w.rows), 1, "nenhum estado de pagamento novo pode ter sido criado")

    def test_a_idempotencia_nao_depende_do_cliente(self):
        # A chave e derivada no servidor a partir da requisicao; nao ha entrada de CLI que a defina.
        self.assertNotIn("--operator-client-ref",
                         open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                           "operator_payments.py"), encoding="utf-8").read())


class Seguranca(unittest.TestCase):
    def test_dry_run_e_o_padrao(self):
        w = FakeWriter()
        out = op.execute(op.build_request(dict(BASE)), w)
        self.assertFalse(out["applied"])
        self.assertEqual(len(w.rows), 0, "sem --apply nada pode ser gravado")

    def test_referencia_e_mascarada_em_toda_saida(self):
        r = op.build_request(dict(BASE))
        texto = op.render(r)
        self.assertNotIn("REDACTED_PAYMENT_REFERENCE", texto, "referencia de pagamento nao entra em log")
        self.assertIn("…", op.mask("REDACTED_PAYMENT_REFERENCE"))

    def test_nenhuma_credencial_no_modulo(self):
        fonte = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "operator_payments.py"), encoding="utf-8").read()
        for proibido in ("SERVICE_ROLE_KEY", "sb_publishable", "eyJ"):
            self.assertNotIn(proibido, fonte, f"`{proibido}` nao pode aparecer no caminho de operador")

    def test_o_escritor_real_so_e_importado_sob_apply(self):
        fonte = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "operator_payments.py"), encoding="utf-8").read()
        i_apply = fonte.index("if not args.apply")
        i_import = fonte.index("from powerball_payment_writer import")
        self.assertLess(i_apply, i_import,
                        "o escritor real tem de ser importado DEPOIS do portao de --apply")


if __name__ == "__main__":
    unittest.main(verbosity=2)
