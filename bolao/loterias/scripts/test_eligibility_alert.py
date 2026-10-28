#!/usr/bin/env python3
"""
Testes do aviso de elegibilidade (`eligibility_alert.py`).

O caso que motivou o modulo e o primeiro: Powerball acima do limiar com o sorteio corrente ja
liquidado (2026-10-08) tem de avisar. Os demais protegem contra os dois erros caros: avisar de
um bolao que ja esta aberto, e fechar o aviso porque uma fonte caiu.
"""

import copy
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import eligibility_alert as ea  # noqa: E402


def doc(**kw):
    d = {
        "threshold": {"minJackpotCents": 50000000000},
        "games": {
            "powerball": {"game": "powerball", "advertisedAnnuityCents": 51600000000,
                          "cashValueCents": 23000000000, "nextDrawDate": "2026-10-10",
                          "source": "https://www.powerball.com/", "fetchedAt": "2026-10-08T15:40:00Z",
                          "eligible": True, "error": None},
            "megamillions": {"game": "megamillions", "advertisedAnnuityCents": 30000000000,
                             "eligible": False, "error": None},
        },
        "nextPool": {"game": "powerball", "label": "Powerball", "jackpotCents": 51600000000,
                     "drawDate": "2026-10-10"},
        "currentDraw": {"id": "2026-08-12", "lifecycleState": "SETTLED"},
    }
    d.update(kw)
    return d


class Decide(unittest.TestCase):
    def test_elegivel_sem_bolao_aberto_avisa(self):
        d = ea.decide(doc())
        self.assertTrue(d["known"] and d["alert"])
        self.assertEqual(d["key"], "[bolao:powerball-2026-10-10]")
        self.assertTrue(d["title"].startswith("[bolao:powerball-2026-10-10] Powerball"))
        self.assertIn("US$516M", d["title"])

    def test_bolao_aberto_nao_avisa(self):
        for estado in ("ELIGIBLE", "OPEN", "LOCKED", "AWAITING_RESULT"):
            d = ea.decide(doc(currentDraw={"id": "2026-10-10", "lifecycleState": estado}))
            self.assertTrue(d["known"], estado)
            self.assertFalse(d["alert"], estado)

    def test_sorteio_aberto_de_outra_data_ainda_avisa(self):
        # O bolao de 10/10 liquidou e o jackpot rolou para 12/10: e um bolao NOVO a decidir.
        d = ea.decide(doc(currentDraw={"id": "2026-10-08", "lifecycleState": "SETTLED"}))
        self.assertTrue(d["alert"])

    def test_abaixo_do_limiar_nao_avisa_mas_e_conhecido(self):
        d = ea.decide(doc(nextPool=None))
        self.assertTrue(d["known"])
        self.assertFalse(d["alert"])

    def test_fonte_fora_do_ar_nao_afirma_nada(self):
        base = doc(nextPool=None)
        base["games"]["powerball"]["error"] = "ResultadoInvalido: casca sem conteudo"
        d = ea.decide(base)
        self.assertFalse(d["known"])
        self.assertFalse(d["alert"])

    def test_mega_millions_elegivel_avisa_mesmo_com_powerball_aberto(self):
        base = doc(nextPool={"game": "megamillions", "label": "Mega Millions",
                             "jackpotCents": 60000000000, "drawDate": "2026-10-10"},
                   currentDraw={"id": "2026-10-10", "lifecycleState": "OPEN"})
        d = ea.decide(base)
        self.assertTrue(d["alert"])
        self.assertEqual(d["key"], "[bolao:megamillions-2026-10-10]")


class Saida(unittest.TestCase):
    def test_github_output_com_corpo_multilinha(self):
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".out") as f:
            caminho = f.name
        try:
            ea.escreve_saida(ea.decide(doc()), caminho)
            txt = open(caminho, encoding="utf-8").read()
            self.assertIn("alert=true\n", txt)
            self.assertIn("key=[bolao:powerball-2026-10-10]\n", txt)
            self.assertIn("body<<__AVISO_FIM__\n", txt)
            self.assertTrue(txt.endswith("__AVISO_FIM__\n"))
        finally:
            os.unlink(caminho)

    def test_status_real_do_repo_e_lido(self):
        caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config",
                               "lottery_status.json")
        import json
        d = ea.decide(json.load(open(caminho, encoding="utf-8")))
        self.assertIn("alert", d)

    def test_decide_nao_altera_a_entrada(self):
        base = doc()
        antes = copy.deepcopy(base)
        ea.decide(base)
        self.assertEqual(base, antes)


if __name__ == "__main__":
    unittest.main(verbosity=1)
