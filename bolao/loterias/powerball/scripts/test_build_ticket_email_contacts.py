#!/usr/bin/env python3
"""Testes do montador de contatos do e-mail de bilhetes: tudo ou nada, nome exato do data.js."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_ticket_email_contacts as B  # noqa: E402

A = "ana@example.invalid"
BR = "bruno@example.invalid"


class Monta(unittest.TestCase):
    def test_completo_usa_o_nome_exato_do_data_js(self):
        mapa, faltando = B.monta("2026-10-28", [{"name": "ana  SILVA", "email": A},
                                                {"name": "Bruno", "email": BR}],
                                 ["Ana Silva", "Bruno"])
        self.assertEqual(faltando, [])
        self.assertEqual(mapa, {"2026-10-28": {"Ana Silva": {"email": A}, "Bruno": {"email": BR}}})

    def test_falta_um_e_reportado(self):
        mapa, faltando = B.monta("2026-10-28", [{"name": "Ana Silva", "email": A}],
                                 ["Ana Silva", "Bruno"])
        self.assertEqual(faltando, ["Bruno"])

    def test_email_invalido_conta_como_faltando(self):
        _, faltando = B.monta("d", [{"name": "Ana", "email": "sem-arroba"}], ["Ana"])
        self.assertEqual(faltando, ["Ana"])

    def test_quem_nao_joga_o_sorteio_nao_entra(self):
        mapa, _ = B.monta("d", [{"name": "Ana", "email": A}, {"name": "Intruso", "email": BR}], ["Ana"])
        self.assertEqual(list(mapa["d"]), ["Ana"])

    def test_main_nao_escreve_nada_se_faltar_alguem(self):
        import tempfile
        saida = os.path.join(tempfile.mkdtemp(), "c.json")
        original_esp, original_load = B.esperados, B.S.load_participants_from_private_env
        B.esperados = lambda d: ["Ana", "Bruno"]
        B.S.load_participants_from_private_env = lambda d: [{"name": "Ana", "email": A}]
        try:
            self.assertEqual(B.main(["--draw", "d", "--out", saida]), 1)
            self.assertFalse(os.path.exists(saida))
        finally:
            B.esperados, B.S.load_participants_from_private_env = original_esp, original_load


if __name__ == "__main__":
    unittest.main(verbosity=1)
