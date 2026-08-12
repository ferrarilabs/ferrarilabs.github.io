"""
test_ledger_actual_consumer.py — POWERBALL_NOTIFICATION_LEDGER_ACTUAL_CONSUMER.

─── POR QUE ESTE GATE EXISTE ───────────────────────────────────────────────────────────────────

Nesta plataforma ja aconteceu duas vezes: uma biblioteca correta, testada, importada -- e nunca
chamada em producao. O FootballLiveStore ficou meses assim. Um gate que procurasse
`import powerball_notification` teria dado verde o tempo todo.

Entao aqui nada e verificado por import, comentario, ou casamento de string. O ledger e
substituido por um DUBLE QUE SO OBSERVA, a orquestracao real e executada, e no fim se pergunta:
esta funcao REALMENTE chamou o ledger, nos pontos certos, na ordem certa?

Se alguem reescrever `run_lifecycle` para enviar direto sem passar pelo ledger, as chamadas
esperadas somem e este teste fica vermelho -- que e exatamente o unico jeito de nao repetir o
envio duplicado para 15 pessoas.

Executar: POWERBALL_TEST_RUN=1 python3 test_ledger_actual_consumer.py
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
import powerball_notification as P
from crash_harness import FakeDB

SORTEIO = "2026-08-12"
NOMES = [f"Participante {i:02d}" for i in range(15)]


class LedgerEspiao:
    """Delega tudo ao ledger REAL e anota o que foi chamado. Nao reimplementa nada."""

    def __init__(self):
        self.chamadas = []
        for nome in ("SENT", "FAILED_RETRYABLE", "FAILED_PERMANENT", "PENDING",
                     "R_PENDING", "R_SENDING", "R_ACCEPTED", "R_FAILED", "R_UNCERTAIN"):
            setattr(self, nome, getattr(P, nome))

    def __getattr__(self, nome):
        alvo = getattr(P, nome)
        if not callable(alvo):
            return alvo

        def espiao(*a, **k):
            self.chamadas.append(nome)
            return alvo(*a, **k)
        return espiao


class ConsumidorReal(unittest.TestCase):

    def setUp(self):
        self.db = FakeDB()
        self._orig = (P._sql, P._rpc, F.check_and_update_results, F.parse_draws, F.load_data_js)
        P._sql, P._rpc = self.db.sql, self.db.rpc
        F.check_and_update_results = lambda *a, **k: False
        F.load_data_js = lambda *a, **k: ""
        F.parse_draws = lambda *a, **k: [{
            "id": SORTEIO, "drawing": {"drawDateIso": "2026-08-12T22:59:00-04:00"},
            "participants": [{"nome": n} for n in NOMES], "finance": {"total": 45},
            "result": {"numbers": [1, 2, 3, 4, 5], "special": 7, "multiplier": 2}}]

    def tearDown(self):
        (P._sql, P._rpc, F.check_and_update_results,
         F.parse_draws, F.load_data_js) = self._orig

    def executar(self, dry_run=False):
        espiao = LedgerEspiao()
        deps = F.Deps(ledger=espiao,
                      send_email=lambda g, refs: {"accepted": list(refs),
                                                  "failed": [], "uncertain": []})
        rel = F.run_lifecycle("powerball", dry_run=dry_run, deps=deps)
        return rel, espiao.chamadas

    def test_o_ciclo_real_consome_o_ledger_em_todos_os_pontos(self):
        rel, chamadas = self.executar()
        for exigida in ("ledger_available", "get_job", "check_content_immutability",
                        "ensure_job", "claim", "retryable_recipients",
                        "record_recipient", "settle"):
            self.assertIn(exigida, chamadas,
                          f"run_lifecycle nao chama {exigida}() -- o ledger deixou de ser o "
                          f"caminho real de notificacao")

    def test_a_ordem_e_a_correta(self):
        """Reivindicar depois de enviar, ou enviar antes de checar imutabilidade, e inutil."""
        _, c = self.executar()
        pos = lambda n: c.index(n)
        self.assertLess(pos("ledger_available"), pos("ensure_job"),
                        "o job nao pode ser criado sem o ledger estar disponivel")
        self.assertLess(pos("check_content_immutability"), pos("ensure_job"),
                        "imutabilidade se checa ANTES de gravar")
        self.assertLess(pos("ensure_job"), pos("claim"),
                        "nao se reivindica um job que ainda nao existe")
        self.assertLess(pos("claim"), pos("record_recipient"),
                        "nada se envia sem a reivindicacao exclusiva")
        self.assertLess(pos("retryable_recipients"), pos("record_recipient"),
                        "o alvo se decide ANTES de tocar no provedor")
        self.assertLess(pos("record_recipient"), pos("settle"),
                        "o job so fecha depois das disposicoes por destinatario")

    def test_nenhum_envio_acontece_sem_claim(self):
        """Prova de comportamento: sem reivindicacao, zero chamadas ao provedor."""
        chamadas_provedor = []

        class SemClaim(LedgerEspiao):
            def claim(self, *a, **k):
                return None                      # outro runner esta com o lease

        deps = F.Deps(ledger=SemClaim(),
                      send_email=lambda g, refs: chamadas_provedor.append(refs) or
                      {"accepted": [], "failed": [], "uncertain": []})
        rel = F.run_lifecycle("powerball", deps=deps)
        self.assertEqual(rel["notificationState"], "ALREADY_CLAIMED")
        self.assertEqual(chamadas_provedor, [], "enviou sem ter reivindicado o job")

    def test_ledger_indisponivel_impede_qualquer_envio(self):
        chamadas_provedor = []

        class ForaDoAr(LedgerEspiao):
            def ledger_available(self):
                return False, "simulado"

        deps = F.Deps(ledger=ForaDoAr(),
                      send_email=lambda g, refs: chamadas_provedor.append(refs) or {})
        rel = F.run_lifecycle("powerball", deps=deps)
        self.assertEqual(rel["notificationState"], "LEDGER_INDISPONIVEL")
        self.assertEqual(chamadas_provedor, [],
                         "sem ledger nao ha idempotencia -- enviar as cegas e o defeito original")

    def test_dry_run_nao_reivindica_nem_envia(self):
        rel, c = self.executar(dry_run=True)
        self.assertEqual(rel["notificationState"], "READY_DRY_RUN")
        self.assertNotIn("claim", c, "dry-run nao pode consumir o lease de ninguem")
        self.assertNotIn("record_recipient", c)


if __name__ == "__main__":
    unittest.main(verbosity=2)
