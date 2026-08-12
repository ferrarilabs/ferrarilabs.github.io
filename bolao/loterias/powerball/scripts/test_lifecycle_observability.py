"""
test_lifecycle_observability.py — o log tem de responder a noite inteira, sozinho.

Existe porque nesta sessao eu repetidamente NAO consegui responder perguntas basicas a partir do
log do GitHub Actions: se o provedor foi tocado, qual sorteio foi avaliado, quantos destinatarios
foram reivindicados. Uma vez precisei pedir ao Eduardo que conferisse o Gmail porque o stdout do
sender era capturado e descartado.

Cada campo abaixo responde uma pergunta que ja ficou sem resposta. E nenhum deles pode carregar
endereco, segredo ou payload privado.

Executar: POWERBALL_TEST_RUN=1 python3 test_lifecycle_observability.py
"""

# ── DECLARACAO EXPLICITA DE MODO TESTE ───────────────────────────────────────────────────────
#
# Este arquivo exercita run_lifecycle(), que desde a integracao M8/M9 fala com audit_events e
# outbox_events. A ponte FALHA FECHADO sem SUPABASE_SERVICE_ROLE_KEY -- de proposito: em producao,
# "nao consigo registrar" nunca pode virar "nada a registrar".
#
# Entao o teste declara que e teste, em vez de a ponte adivinhar. A mesma convencao ja governa o
# transporte de e-mail (`real_send_allowed()`), e pela mesma razao: autorizacao positiva, nunca
# heuristica negativa.
import os as _os
_os.environ.setdefault("BOLAO_TEST_RUN", "1")

import json
import os
import sys
import unittest

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_and_send_results as F
import powerball_notification as P
from crash_harness import FakeDB

NOMES = [f"P{i:02d}" for i in range(15)]
RESULTADO = {"numbers": [1, 2, 3, 4, 5], "special": 7, "multiplier": 2}


class RegistroDoCiclo(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self._orig = (P._sql, P._rpc, F.check_and_update_results, F.parse_draws, F.load_data_js)
        P._sql, P._rpc = self.db.sql, self.db.rpc
        F.check_and_update_results = lambda *a, **k: False
        F.load_data_js = lambda *a, **k: ""
        F.parse_draws = lambda *a, **k: [{
            "id": "2026-08-10", "drawing": {"drawDateIso": "2026-08-10T22:59:00-04:00"},
            "participants": [{"nome": n} for n in NOMES], "result": RESULTADO}]

    def tearDown(self):
        (P._sql, P._rpc, F.check_and_update_results,
         F.parse_draws, F.load_data_js) = self._orig

    def ciclo(self, modo="ok"):
        def enviar(g, refs):
            if modo == "ok":
                return {"accepted": list(refs), "failed": [], "uncertain": [],
                        "providerInvoked": True}
            return {"accepted": [], "failed": list(refs), "uncertain": [],
                    "stdout": "TRANSPORTE_INCAPAZ_DE_ALVEJAR: ...", "providerInvoked": False}
        return F.run_lifecycle("powerball", deps=F.Deps(ledger=P, send_email=enviar))

    def test_o_registro_responde_todas_as_perguntas_da_noite(self):
        o = self.ciclo().get("obs", {})
        for campo in ("drawEvaluated", "drawTimePassed", "upstreamResultExists",
                      "upstreamResultDate", "resultReconciled", "idempotencyKey",
                      "expectedRecipients", "resolvedRecipients", "claimedRecipients",
                      "providerCallsAttempted", "acceptedCount", "failedCount",
                      "uncertainCount", "finalState"):
            self.assertIn(campo, o, f"o log nao responde: {campo}")

    def test_chamadas_ao_provedor_sao_as_TENTADAS(self):
        """A pergunta que me custou horas: o provedor foi realmente tocado?"""
        o = self.ciclo("recusa").get("obs", {})
        self.assertEqual(o["providerCallsAttempted"], 0)
        self.assertTrue(o["providerRefused"])
        o2 = self.ciclo("ok").get("obs", {})
        self.assertGreater(o2["providerCallsAttempted"], 0)

    def test_contagens_esperada_resolvida_e_reivindicada_sao_distintas(self):
        o = self.ciclo().get("obs", {})
        for c in ("expectedRecipients", "resolvedRecipients", "claimedRecipients"):
            self.assertIsInstance(o[c], int)

    def test_o_registro_nao_carrega_endereco_nem_segredo(self):
        rel = self.ciclo()
        texto = json.dumps(rel.get("obs", {}), ensure_ascii=False)
        self.assertNotIn("@", texto, "o registro contem algo parecido com endereco")
        for proibido in ("apikey", "Bearer", "eyJ", "SERVICE_ROLE", "sb_publishable"):
            self.assertNotIn(proibido, texto, f"o registro contem {proibido}")

    def test_a_chave_de_idempotencia_aparece_no_log(self):
        o = self.ciclo().get("obs", {})
        self.assertEqual(o["idempotencyKey"], "powerball:draw-result:2026-08-10:v1")

    def test_o_registro_e_impresso_de_fato(self):
        """Campo coletado e nao impresso nao ajuda ninguem as 2 da manha."""
        import inspect
        self.assertIn("_imprime_obs(rel)", inspect.getsource(F.main))
        src = inspect.getsource(F._imprime_obs)
        for rotulo in ("sorteio avaliado", "chamadas ao provedor TENTADAS", "estado final"):
            self.assertIn(rotulo, src)

    def test_o_portao_temporal_registra_o_motivo(self):
        o = self.ciclo().get("obs", {})
        self.assertIn("drawTimeReason", o)


if __name__ == "__main__":
    unittest.main(verbosity=2)
