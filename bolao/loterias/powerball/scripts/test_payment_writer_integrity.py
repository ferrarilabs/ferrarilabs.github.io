#!/usr/bin/env python3
"""
INTEGRIDADE DE REVERSAO — as duas invariantes que o banco nao consegue garantir.

O schema ja tem FK do alvo, CHECK de nao-autorreversao, CHECK de reversao-com-alvo e gatilho de
imutabilidade. Nenhum deles prova:

  1. o valor e o INVERSO EXATO do alvo;
  2. a reversao pertence a MESMA participacao do alvo.

Uma reversao de -1,00 sobre um ajuste de +2,00 satisfaz TODAS as constraints existentes e deixa
1,00 pendurado. Uma reversao apontada para a linha de outra pessoa tambem satisfaz todas elas: o
total global fecha e o individual mente.

`build_request()` nao pode checar nenhuma das duas — e puro de proposito e as duas exigem ler o
alvo. Por isso a verificacao mora no escritor, e a PARTE QUE DECIDE esta isolada numa funcao pura,
testada aqui sem rede e sem banco.

Uso: python3 bolao/loterias/powerball/scripts/test_payment_writer_integrity.py
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from powerball_payment_writer import check_reversal_integrity, OperatorError  # noqa: E402

ALVO = {"transaction_id": "t-alvo", "type": "adjustment", "amount": "2.00", "participation_id": "p-1"}


def pedido(**kw):
    base = {"amount": -2.00, "participation_id": "p-1", "reverses_transaction_id": "t-alvo",
            "txn_type": "reversal"}
    base.update(kw)
    return base


class ValorInverso(unittest.TestCase):
    def test_inverso_exato_passa(self):
        check_reversal_integrity(pedido(), ALVO, [])

    def test_reversao_parcial_e_recusada(self):
        # O caso silencioso: satisfaz FK e os dois CHECKs, e deixa 1,00 pendurado.
        with self.assertRaises(OperatorError) as ctx:
            check_reversal_integrity(pedido(amount=-1.00), ALVO, [])
        self.assertIn("inverso exato", str(ctx.exception))

    def test_reversao_maior_que_o_alvo_e_recusada(self):
        with self.assertRaises(OperatorError):
            check_reversal_integrity(pedido(amount=-3.00), ALVO, [])

    def test_mesmo_sinal_do_alvo_e_recusado(self):
        # +2,00 "revertendo" +2,00 DOBRA o valor em vez de anular.
        with self.assertRaises(OperatorError):
            check_reversal_integrity(pedido(amount=2.00), ALVO, [])

    def test_comparacao_em_centavos_nao_em_float(self):
        # 0.1+0.2 != 0.3 em float. Um alvo de 0,10 revertido por -0,10 tem de passar sempre.
        check_reversal_integrity(pedido(amount=-0.10), {**ALVO, "amount": "0.10"}, [])
        with self.assertRaises(OperatorError):
            check_reversal_integrity(pedido(amount=-0.11), {**ALVO, "amount": "0.10"}, [])

    def test_alvo_negativo_e_revertido_por_positivo(self):
        check_reversal_integrity(pedido(amount=5.00), {**ALVO, "amount": "-5.00"}, [])


class MesmaParticipacao(unittest.TestCase):
    def test_participacao_diferente_e_recusada(self):
        # Fecha o total global e mente no individual — o erro mais dificil de enxergar.
        with self.assertRaises(OperatorError) as ctx:
            check_reversal_integrity(pedido(participation_id="p-OUTRA"), ALVO, [])
        self.assertIn("MESMA participacao", str(ctx.exception))

    def test_participacao_igual_como_string_ou_uuid_passa(self):
        check_reversal_integrity(pedido(participation_id="p-1"), {**ALVO, "participation_id": "p-1"}, [])


class AlvoInvalido(unittest.TestCase):
    def test_alvo_inexistente_e_recusado(self):
        with self.assertRaises(OperatorError):
            check_reversal_integrity(pedido(), None, [])

    def test_reverter_uma_reversao_e_recusado(self):
        with self.assertRaises(OperatorError):
            check_reversal_integrity(pedido(amount=2.00), {**ALVO, "type": "reversal", "amount": "-2.00"}, [])

    def test_alvo_ja_revertido_e_recusado(self):
        # Reverter duas vezes INVERTE o sinal em vez de anular.
        with self.assertRaises(OperatorError) as ctx:
            check_reversal_integrity(pedido(), ALVO, [{"transaction_id": "t-rev-1"}])
        self.assertIn("ja foi revertido", str(ctx.exception))


class FalhaFechado(unittest.TestCase):
    def test_nenhuma_violacao_e_corrigida_em_silencio(self):
        """O checador nunca ajusta o pedido — so aceita ou levanta."""
        p = pedido(amount=-1.00)
        antes = dict(p)
        with self.assertRaises(OperatorError):
            check_reversal_integrity(p, ALVO, [])
        self.assertEqual(p, antes, "o checador mutou o pedido em vez de recusa-lo")

    def test_o_caso_real_da_reclassificacao_de_2026_08_22(self):
        """O ajuste de +2,00 alheio ao bolao, revertido por -2,00 na mesma participacao."""
        real = {"transaction_id": "60571944-a9ea-4e85-b4d9-7cfce6fb76a0", "type": "adjustment",
                "amount": "2.00", "participation_id": "part-x"}
        check_reversal_integrity(
            pedido(amount=-2.00, participation_id="part-x",
                   reverses_transaction_id=real["transaction_id"]), real, [])


class ImportTardioResolve(unittest.TestCase):
    """REGRESSAO do defeito que originou este arquivo (achado 2026-08-22).

    `operator_payments.main()` importa `SupabasePaymentWriter` TARDE, so quando `--apply` e usado.
    O import tardio e correto (o escritor precisa de credencial que so o runner tem), mas ele torna
    a ausencia do modulo INVISIVEL para toda a suite: dry-run passava, os testes passavam, e o
    caminho de escrita morria com ModuleNotFoundError na primeira tentativa real. O
    `powerball_record_payment.yml` era, na pratica, um simulador.

    Um gate que so exercita o caminho testavel nao prova que o caminho de producao existe.
    """

    def test_o_modulo_do_escritor_existe_e_expoe_a_classe(self):
        import powerball_payment_writer as w
        self.assertTrue(hasattr(w, "SupabasePaymentWriter"))

    def test_o_import_tardio_de_operator_payments_resolve_de_verdade(self):
        # A MESMA linha de `main()`, executada aqui. Se o modulo sumir de novo, isto reprova.
        import importlib
        m = importlib.import_module("powerball_payment_writer")
        self.assertTrue(callable(getattr(m, "SupabasePaymentWriter")))

    def test_o_escritor_recusa_construir_sem_credencial(self):
        from powerball_payment_writer import SupabasePaymentWriter
        with self.assertRaises(OperatorError):
            SupabasePaymentWriter(key="")

    def test_o_escritor_implementa_o_contrato_que_execute_invoca(self):
        from powerball_payment_writer import SupabasePaymentWriter
        for metodo in ("insert_transaction", "list"):
            self.assertTrue(callable(getattr(SupabasePaymentWriter, metodo, None)),
                            f"o escritor real nao implementa {metodo}() — execute() o chamaria e quebraria")


if __name__ == "__main__":
    unittest.main(verbosity=2)
