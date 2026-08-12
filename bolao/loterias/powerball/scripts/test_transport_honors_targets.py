"""
test_transport_honors_targets.py — o TRANSPORTE tem de obedecer a lista de destinatarios.

─── A LACUNA QUE ISTO FECHA ────────────────────────────────────────────────────────────────────

A matriz de crash A-M e o gate de consumidor do ledger injetam um `send_email` falso. Provaram
que o ciclo consome o ledger e calcula o alvo certo. Nunca provaram que o TRANSPORTE REAL respeita
esse alvo.

E nao respeitava. `_default_send_email(game_type, entry_refs)` recebia a lista e a ignorava,
chamando `send_result_email.py --send-all` -- difusao para todos os participantes do sorteio.
Na validacao controlada de 2026-08-10 o ciclo calculou `alvos = ['Rodrigo Hajj']`, reportou
`providerCalls: 1`, e entregou isso a um transporte que teria mirado os 15.

Vinte testes de crash verdes, seis mutacoes capturadas, e o defeito estava depois de todos eles.
Uma fronteira substituida em teste e uma fronteira nao testada.

Executar: POWERBALL_TEST_RUN=1 python3 test_transport_honors_targets.py
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

import os
import sys
import unittest

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_and_send_results as F

TODOS = [f"P{i:02d}" for i in range(15)]


class TransporteObedeceOAlvo(unittest.TestCase):
    def setUp(self):
        self._orig = (F.parse_draws, F.load_data_js, F.subprocess.run)
        F.load_data_js = lambda *a, **k: ""
        F.parse_draws = lambda *a, **k: [{
            "id": "2026-08-08", "participants": [{"nome": n} for n in TODOS],
            "result": {"numbers": [1, 2, 3, 4, 5], "special": 7, "multiplier": 2}}]
        self.invocacoes = []

        class Proc:
            returncode = 0
            stdout = "fingiu enviar"
            stderr = ""

        def fake_run(cmd, **k):
            self.invocacoes.append(cmd)
            return Proc()
        F.subprocess.run = fake_run

    def tearDown(self):
        F.parse_draws, F.load_data_js, F.subprocess.run = self._orig

    def test_alvo_parcial_e_recusado_em_vez_de_difundido(self):
        """O caso real: 14 ja receberam, so o 15o falta."""
        r = F._default_send_email("powerball", ["P14"])
        self.assertEqual(self.invocacoes, [],
                         "o transporte difundiu quando so um destinatario era o alvo")
        self.assertEqual(r["accepted"], [], "nao pode declarar aceite sem enviar")
        self.assertIn("TRANSPORTE_INCAPAZ_DE_ALVEJAR", r["stdout"])

    def test_alvo_vazio_nao_chama_o_provedor(self):
        r = F._default_send_email("powerball", [])
        self.assertEqual(self.invocacoes, [])
        self.assertEqual(r["accepted"], [])

    def test_conjunto_completo_e_difundido(self):
        """Difusao e legitima quando o alvo E todo mundo -- o primeiro envio de um sorteio."""
        r = F._default_send_email("powerball", TODOS)
        self.assertEqual(len(self.invocacoes), 1)
        self.assertIn("--send-all", self.invocacoes[0])
        self.assertEqual(set(r["accepted"]), set(TODOS))

    def test_conjunto_esperado_desconhecido_falha_fechado(self):
        """A condicao era `if esperados and ...`: conjunto vazio DESLIGAVA o guard.

        Descoberto sondando com dados reais -- mockar subprocess.run quebrou `load_data_js`
        (que roda node), `esperados` veio vazio, e o transporte difundiu com alvo de 1 pessoa.
        Nao saber quem deveria receber e a razao mais forte para nao difundir, nao a mais fraca.
        """
        F.parse_draws = lambda *a, **k: []          # nao da para determinar o esperado
        r = F._default_send_email("powerball", ["P14"])
        self.assertEqual(self.invocacoes, [], "difundiu sem saber quem deveria receber")
        self.assertEqual(r["accepted"], [])
        self.assertIn("TRANSPORTE_RECUSADO", r["stdout"])

    def test_a_saida_do_sender_e_ecoada(self):
        """Antes ficava capturada e invisivel: envio real sem rastro nenhum no log."""
        import inspect
        src = inspect.getsource(F._default_send_email)
        self.assertIn("print(proc.stdout", src,
                      "sem eco, nao da para auditar depois se saiu e-mail")

    def test_o_ciclo_nao_declara_aceite_quando_o_transporte_recusa(self):
        import powerball_notification as P
        from crash_harness import FakeDB
        db = FakeDB()
        orig = (P._sql, P._rpc, F.check_and_update_results)
        P._sql, P._rpc = db.sql, db.rpc
        F.check_and_update_results = lambda *a, **k: False
        try:
            deps = F.Deps(ledger=P, send_email=F._default_send_email)
            P.ensure_job("2026-08-08", {"numbers": [1, 2, 3, 4, 5], "special": 7,
                                        "multiplier": 2}, TODOS, None)
            chave = P.draw_key("2026-08-08")
            for n in TODOS[:14]:
                P.record_recipient("2026-08-08", n, P.R_ACCEPTED)
            db.jobs[chave]["status"] = P.FAILED_RETRYABLE
            rel = F.run_lifecycle("powerball", deps=deps)
            self.assertEqual(db.counts(chave)["ACCEPTED"], 14,
                             "o 15o nao pode virar ACCEPTED sem entrega real")
            self.assertNotEqual(db.job(chave)["status"], "sent")
            self.assertEqual(self.invocacoes, [], "difundiu para os 15")
        finally:
            P._sql, P._rpc, F.check_and_update_results = orig


if __name__ == "__main__":
    unittest.main(verbosity=2)
