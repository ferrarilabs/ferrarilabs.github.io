"""
test_result_email_caixa.py — o caixa do e-mail de resultado e o DESTE sorteio.

Em 2026-11-02 o e-mail saiu com "Prêmio deste sorteio $36" e "Saldo disponível agora $38" (os
números de 31/10) quando o bolão tinha ganho US$432, e com o jackpot "sorteio 2026-11-02" já
passado. O livro-razão não tinha liquidado o sorteio e `lottery_status.json` era de antes dele.

Executar: POWERBALL_TEST_RUN=1 python3 test_result_email_caixa.py
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_and_send_results as F  # noqa: E402
import send_result_email as S  # noqa: E402

DRAW = {"id": "2026-11-02", "gameType": "powerball",
        "finance": {"creditoSorteioAnterior": 38, "valorGuardadoProximoSorteio": 1}}

# Livro como estava no envio de 2026-11-02: nada de 02/11, saldo de 31/10.
LIVRO_SEM_ESTE = [
    {"type": "PRIZE_CREDIT", "poolId": "2026-10-31", "amountCents": 3600},
    {"type": "OPERATOR_ADJUSTMENT", "poolId": "2026-10-31", "amountCents": 200},
]
LIVRO_LIQUIDADO = LIVRO_SEM_ESTE + [
    {"type": "CARRYOVER_OUT", "poolId": "2026-10-31", "amountCents": -3800},
    {"type": "CONTRIBUTION", "poolId": "2026-11-02", "amountCents": 14000},
    {"type": "CARRYOVER_IN", "poolId": "2026-11-02", "amountCents": 3800},
    {"type": "TICKET_PURCHASE", "poolId": "2026-11-02", "amountCents": -17700},
    {"type": "PRIZE_CREDIT", "poolId": "2026-11-02", "amountCents": 43200},
]

STATUS_ANTES_DO_SORTEIO = {
    "funds": {"lastDrawWinningsCents": 3600, "lastDrawId": "2026-10-31",
              "carryoverAvailableCents": 3800},
    "games": {
        "powerball": {"label": "Powerball", "advertisedAnnuityCents": 79300000000,
                      "nextDrawDate": "2026-11-02"},
        "megamillions": {"label": "Mega Millions", "advertisedAnnuityCents": 48200000000,
                         "nextDrawDate": "2026-11-03"},
    },
    "nextPool": {"game": "powerball", "label": "Powerball", "jackpotCents": 79300000000,
                 "drawDate": "2026-11-02"},
}


class CaixaDoSorteio(unittest.TestCase):
    def test_livro_sem_este_sorteio_nao_repete_o_caixa_anterior(self):
        html = S._bloco_proximo_bolao(DRAW, STATUS_ANTES_DO_SORTEIO, LIVRO_SEM_ESTE)
        self.assertNotIn("$36", html)
        self.assertNotIn("$38.00", html)
        self.assertNotIn("Saldo disponível agora", html)
        self.assertIn("ainda está sendo fechado", html)

    def test_livro_liquidado_mostra_premio_e_saldo_deste_sorteio(self):
        html = S._bloco_proximo_bolao(DRAW, STATUS_ANTES_DO_SORTEIO, LIVRO_LIQUIDADO)
        self.assertRegex(html, r"Prêmio deste sorteio.*\$432")
        self.assertRegex(html, r"Saldo disponível agora.*\$433")
        self.assertRegex(html, r"Crédito que entrou do sorteio anterior.*\$38")

    def test_sorteio_sem_premio_mostra_zero_e_nao_o_premio_anterior(self):
        livro = [e for e in LIVRO_LIQUIDADO
                 if not (e["poolId"] == "2026-11-02" and e["type"] == "PRIZE_CREDIT")]
        html = S._bloco_proximo_bolao(DRAW, STATUS_ANTES_DO_SORTEIO, livro)
        self.assertRegex(html, r"Prêmio deste sorteio.*\$0")
        self.assertNotRegex(html, r"Prêmio deste sorteio[^$]*\$36")

    def test_jackpot_e_proximo_bolao_de_data_ja_passada_nao_saem(self):
        html = S._bloco_proximo_bolao(DRAW, STATUS_ANTES_DO_SORTEIO, LIVRO_LIQUIDADO)
        self.assertNotIn("sorteio 2026-11-02", html)
        self.assertIn("Mega Millions", html)
        self.assertIn("sorteio 2026-11-03", html)

    def test_status_atualizado_mostra_o_proximo_sorteio(self):
        doc = json.loads(json.dumps(STATUS_ANTES_DO_SORTEIO))
        doc["games"]["powerball"]["nextDrawDate"] = "2026-11-04"
        doc["nextPool"]["drawDate"] = "2026-11-04"
        html = S._bloco_proximo_bolao(DRAW, doc, LIVRO_LIQUIDADO)
        self.assertIn("sorteio 2026-11-04", html)


class LiquidaAntesDoEmail(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.livro = os.path.join(self.dir, "livro.jsonl")
        self._orig = (F.REPO_ROOT, F.LEDGER_REL)
        F.REPO_ROOT, F.LEDGER_REL = self.dir, "livro.jsonl"

    def tearDown(self):
        F.REPO_ROOT, F.LEDGER_REL = self._orig

    def _grava(self, livro):
        with open(self.livro, "w", encoding="utf-8") as f:
            f.write("".join(json.dumps(e) + "\n" for e in livro))

    def test_ja_liquidado_nao_executa_nada(self):
        self._grava(LIVRO_LIQUIDADO)
        chamadas = []
        r = F.liquida_caixa_antes_do_email("2026-11-02", run=lambda *a, **k: chamadas.append(a))
        self.assertEqual(r, "JA_LIQUIDADO")
        self.assertEqual(chamadas, [])

    def test_sem_lancamentos_liquida_regenera_status_e_faz_commit(self):
        self._grava(LIVRO_SEM_ESTE)
        chamadas = []
        r = F.liquida_caixa_antes_do_email("2026-11-02", run=lambda a, **k: chamadas.append(a))
        self.assertEqual(r, "LIQUIDADO")
        self.assertTrue(chamadas[0][1].endswith("settle_draw.py"))
        self.assertEqual(chamadas[0][2:], ["--draw", "2026-11-02"])
        self.assertTrue(chamadas[1][1].endswith("lottery_status.py"))
        self.assertEqual(chamadas[-1][:4], ["git", "-C", self.dir, "commit"])
        self.assertIn("sorteio de 2026-11-02", chamadas[-1][-1])

    def test_falha_na_liquidacao_nao_impede_o_email(self):
        self._grava(LIVRO_SEM_ESTE)

        def falha(a, **k):
            raise subprocess.CalledProcessError(1, a)
        self.assertEqual(F.liquida_caixa_antes_do_email("2026-11-02", run=falha), "FALHOU")

    def test_deps_de_teste_nunca_liquida_o_livro_real(self):
        self.assertEqual(F.Deps(ledger=object()).liquida_caixa("2026-11-02"), "NAO_EXECUTADO")


if __name__ == "__main__":
    unittest.main(verbosity=2)
