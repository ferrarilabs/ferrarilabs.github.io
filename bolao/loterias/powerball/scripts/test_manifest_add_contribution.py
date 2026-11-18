#!/usr/bin/env python3
"""test_manifest_add_contribution.py — deposito sem PR (`add_contribution`), 2026-11-18.

Prova que o helper so deixa passar o que ja e publico, e idempotente, nao altera o manifesto
original e recusa a ambiguidade em vez de adivinhar.

Executar: python3 test_manifest_add_contribution.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from manifest_add_contribution import ErroDeposito, acrescenta  # noqa: E402

BASE = {
    "draw_date": "2026-11-20", "jackpot": 629000000, "cash_value": 258800000,
    "contributions": [{"name": "Eduardo Ferrari", "amount": 10, "method": "Fundo próprio (organizador)",
                       "paid_at": "2026-11-18T06:49:06-05:00"}],
}
OK = {"name": "Fulano Sintetico", "amount": 10, "method": "Zelle", "paid_at": "2026-11-18T10:01:20-05:00"}


class Acrescenta(unittest.TestCase):
    def test_acrescenta_e_preserva_original(self):
        antes = json.dumps(BASE)
        novo = acrescenta(BASE, json.dumps(OK))
        self.assertEqual(json.dumps(BASE), antes, "manifesto original foi alterado")
        self.assertEqual(len(novo["contributions"]), 2)
        self.assertEqual(novo["contributions"][-1], OK)
        self.assertEqual(novo["draw_date"], "2026-11-20")

    def test_mesmo_deposito_de_novo_e_idempotente(self):
        uma = acrescenta(BASE, json.dumps(OK))
        duas = acrescenta(uma, json.dumps(OK))
        self.assertEqual(len(duas["contributions"]), 2)

    def test_mesmo_nome_com_outros_dados_recusa(self):
        uma = acrescenta(BASE, json.dumps(OK))
        with self.assertRaises(ErroDeposito):
            acrescenta(uma, json.dumps({**OK, "paid_at": "2026-11-19T09:00:00-05:00"}))
        with self.assertRaises(ErroDeposito):
            acrescenta(uma, json.dumps({**OK, "name": "fulano  sintético"}))  # mesmo nome normalizado

    def test_chave_extra_recusa_referencia_nunca_passa(self):
        for extra in ({"external_reference": "SYNTH-1"}, {"memo": "x"}, {"email": "a@example.invalid"}):
            with self.assertRaises(ErroDeposito):
                acrescenta(BASE, json.dumps({**OK, **extra}))

    def test_campos_invalidos_recusam(self):
        ruins = [
            "nao-json", "[]", json.dumps({k: v for k, v in OK.items() if k != "paid_at"}),
            json.dumps({**OK, "name": "  "}), json.dumps({**OK, "amount": 0}),
            json.dumps({**OK, "amount": "10"}), json.dumps({**OK, "amount": True}),
            json.dumps({**OK, "paid_at": "ontem"}), json.dumps({**OK, "paid_at": "2026-11-18T10:01:20"}),
            json.dumps({**OK, "method": 3}),
        ]
        for r in ruins:
            with self.assertRaises(ErroDeposito, msg=r):
                acrescenta(BASE, r)

    def test_cli_escreve_fora_e_falha_com_codigo(self):
        with tempfile.TemporaryDirectory() as d:
            m, out = os.path.join(d, "m.json"), os.path.join(d, "out.json")
            with open(m, "w", encoding="utf-8") as f:
                json.dump(BASE, f)
            script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest_add_contribution.py")
            r = subprocess.run([sys.executable, script, "--manifest", m, "--add", json.dumps(OK), "--out", out],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            with open(out, encoding="utf-8") as f:
                self.assertEqual(len(json.load(f)["contributions"]), 2)
            with open(m, encoding="utf-8") as f:
                self.assertEqual(len(json.load(f)["contributions"]), 1, "CLI alterou o manifesto de entrada")
            r = subprocess.run([sys.executable, script, "--manifest", m, "--add", '{"memo":"x"}', "--out", out],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertIn("::error::", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
