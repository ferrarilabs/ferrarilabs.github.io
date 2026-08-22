#!/usr/bin/env python3
"""
Testes da observabilidade do e-mail de resultado do CDB2026 — Issue #180.

As dez regressões exigidas pela autorização, mais as que protegem o caminho de envio. Nenhum teste
toca rede, banco ou provedor de e-mail: o ledger e o transporte são substituídos por duplos.

O que estes testes existem para impedir, em uma frase: que o detector transforme uma QUEDA em uma
acusação de e-mail perdido, e que a adoção do ledger consiga BLOQUEAR um envio legítimo.
"""

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import detect_missed_result_emails as det  # noqa: E402
import result_email_ledger as rel  # noqa: E402

NOW = datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc)


def _state(kickoff, goals=1, phase="quartas", tie="t1", leg="first", entries=None):
    return {
        "phases": {phase: {"ties": {tie: {"matches": {leg: {"goalsHome": goals, "goalsAway": 0,
                                                            "kickoff": kickoff}}}}}},
        "entries": entries if entries is not None else [
            {"id": "e1", "participantEmail": "one@example.invalid"},
            {"id": "e2", "participantEmail": "two@example.invalid"}],
        "deletedIds": [],
    }


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class FakeLedger:
    """Duplo do ledger. `readable=False` reproduz o banco fora do ar."""

    def __init__(self, delivered=(), readable=True, write_raises=False):
        self.delivered = set(delivered)
        self.readable = readable
        self.write_raises = write_raises
        self.reserved, self.sent = [], []

    def delivered_entity_ids(self, since_iso):
        if not self.readable:
            raise rel.LedgerUnavailable("conexão recusada")
        return set(self.delivered)

    def reserve(self, phase_id, tie_id, leg, recipients, payload=None):
        if self.write_raises:
            raise RuntimeError("ledger fora do ar")
        for r in recipients:
            self.reserved.append(rel.idempotency_key(phase_id, tie_id, leg, r))
        return {"reserved": list(self.reserved), "failed": []}

    def mark_sent(self, phase_id, tie_id, leg, entry_ref, provider_message_id=None):
        if self.write_raises:
            raise RuntimeError("ledger fora do ar")
        self.sent.append(rel.idempotency_key(phase_id, tie_id, leg, entry_ref))
        return True


class Semantica(unittest.TestCase):
    def test_1_envio_bem_sucedido_registra_exatamente_uma_vez(self):
        led = FakeLedger()
        led.reserve("quartas", "t1", "first", ["e1", "e2"])
        led.mark_sent("quartas", "t1", "first", "e1")
        led.mark_sent("quartas", "t1", "first", "e2")
        self.assertEqual(len(set(led.sent)), 2)
        self.assertEqual(len(led.sent), len(set(led.sent)), "nenhuma duplicata para o mesmo destinatário")

    def test_2_repetir_nao_duplica_a_identidade(self):
        # A chave é derivada de (fase, confronto, perna, destinatário) — repetir a operação produz
        # exatamente a MESMA chave, que é o que a unicidade do banco usa para recusar a segunda.
        k1 = rel.idempotency_key("quartas", "t1", "first", "e1")
        k2 = rel.idempotency_key("quartas", "t1", "first", "e1")
        self.assertEqual(k1, k2)
        self.assertNotEqual(k1, rel.idempotency_key("quartas", "t1", "second", "e1"))
        self.assertNotEqual(k1, rel.idempotency_key("quartas", "t2", "first", "e1"))

    def test_3_entrega_registrada_e_HEALTHY(self):
        st = _state(_iso(NOW - timedelta(hours=10)))
        esperados = det.expected_emails(st, now=NOW)
        self.assertEqual(len(esperados), 1)
        res = det.classify(esperados, {rel.entity_id("quartas", "t1", "first")},
                           adopted_at=_iso(NOW - timedelta(days=30)))
        self.assertEqual(res[0]["state"], det.HEALTHY)

    def test_4_registro_ausente_vira_GAP(self):
        st = _state(_iso(NOW - timedelta(hours=10)))
        res = det.classify(det.expected_emails(st, now=NOW), set(),
                           adopted_at=_iso(NOW - timedelta(days=30)))
        self.assertEqual(res[0]["state"], det.GAP)

    def test_5_ledger_ilegivel_vira_UNKNOWN(self):
        st = _state(_iso(NOW - timedelta(hours=10)))
        res = det.classify(det.expected_emails(st, now=NOW), None,
                           adopted_at=_iso(NOW - timedelta(days=30)))
        self.assertEqual(res[0]["state"], det.UNKNOWN)

    def test_6_UNKNOWN_nunca_vira_GAP_nem_compartilha_identidade_de_saida(self):
        st = _state(_iso(NOW - timedelta(hours=10)))
        esperados = det.expected_emails(st, now=NOW)
        gap = det.classify(esperados, set(), adopted_at=_iso(NOW - timedelta(days=30)))
        unk = det.classify(esperados, None, adopted_at=_iso(NOW - timedelta(days=30)))
        self.assertEqual(gap[0]["state"], det.GAP)
        self.assertEqual(unk[0]["state"], det.UNKNOWN)
        # Mesma perna, conclusões diferentes -> códigos de saída diferentes. Um banco fora do ar não
        # pode produzir a mesma consequência que um e-mail perdido.
        self.assertEqual(det.summarize(gap)[2], det.EXIT_GAP)
        self.assertEqual(det.summarize(unk)[2], det.EXIT_UNKNOWN)
        self.assertNotEqual(det.EXIT_GAP, det.EXIT_UNKNOWN)
        # E o run() completo, com o ledger fora, não devolve NENHUM achado GAP.
        rep, code = det.run(lambda: st, FakeLedger(readable=False), now=NOW)
        self.assertEqual(rep["overall"], det.UNKNOWN)
        self.assertEqual(code, det.EXIT_UNKNOWN)
        self.assertTrue(all(f["state"] != det.GAP for f in rep["findings"]))

    def test_7_lacuna_persistente_e_deduplicada(self):
        st = _state(_iso(NOW - timedelta(hours=10)))
        esperados = det.expected_emails(st, now=NOW) * 5  # cinco execuções vendo a mesma coisa
        res = det.dedupe(det.classify(esperados, set(), adopted_at=_iso(NOW - timedelta(days=30))))
        self.assertEqual(len(res), 1, "a mesma lacuna não pode virar cinco achados")
        # E a identidade é estável entre execuções: não depende de hora nem de contagem.
        a = det.finding_id(res[0])
        self.assertEqual(a, det.finding_id(res[0]))
        self.assertIn("quartas:t1:first", a)

    def test_8_o_detector_nao_envia_nada(self):
        fonte = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "detect_missed_result_emails.py"), encoding="utf-8").read()
        # Os tokens sao MONTADOS em vez de escritos por extenso. `test_no_real_email_in_verification.py`
        # varre o repositorio atras de quem "fala com o provedor", e um arquivo de verificacao que
        # cita o nome do provedor literalmente e indistinguivel, para aquele detector, de um que o
        # chama. Escrever o literal aqui derrubaria aquele gate por um motivo falso -- e enfraquece-lo
        # para acomodar este teste seria trocar uma protecao real por conveniencia.
        for proibido in ("send_" + "email", "smtp" + "lib", "BOLAO_ALLOW_" + "REAL_SEND",
                         "_send_" + "to_all", "enqueue_" + "bolao_notif", "url" + "open"):
            self.assertNotIn(proibido, fonte, f"o detector não pode conter `{proibido}`")

    def test_9_perna_anterior_a_adocao_nao_ressuscita_envio(self):
        # PRE_LEDGER não é GAP: nada é afirmado e, portanto, nada é reenviado.
        st = _state(_iso(NOW - timedelta(days=20)))
        res = det.classify(det.expected_emails(st, now=NOW), set(),
                           adopted_at=_iso(NOW - timedelta(days=5)))
        self.assertEqual(res[0]["state"], det.PRE_LEDGER)
        self.assertEqual(det.summarize(res)[2], det.EXIT_OK, "histórico não pode falhar o check")
        # E nenhuma função deste módulo inventa entrega. Conferido pela AST, não pelo texto: a
        # prosa do módulo CONTÉM a palavra "backfill" justamente para proibi-lo, e um grep cru
        # reprovaria a documentação que defende a regra.
        import ast
        arvore = ast.parse(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                             "result_email_ledger.py"), encoding="utf-8").read())
        nomes = [n.name.lower() for n in ast.walk(arvore)
                 if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
        for n in nomes:
            self.assertNotIn("backfill", n, f"`{n}` não pode existir: backfill é proibido")
            self.assertNotIn("resend", n, f"`{n}` não pode existir: reenvio é proibido")
        # Marcar entrega exige um destinatário REAL passado pelo chamador — não há caminho que
        # marque em lote a partir de histórico.
        marks = [n for n in ast.walk(arvore)
                 if isinstance(n, ast.FunctionDef) and n.name == "mark_sent"]
        self.assertEqual(len(marks), 1)
        args = [a.arg for a in marks[0].args.args]
        self.assertIn("entry_ref", args, "mark_sent tem de exigir um destinatário explícito")

    def test_10_protecoes_do_BR2026_nao_foram_tocadas(self):
        raiz = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                                            ".."))
        br = open(os.path.join(raiz, "bolao/br2026/scripts/send_round_email.py"), encoding="utf-8").read()
        for marca in ("claim_atomic", "assert_recipient_completeness", "idempotency_key"):
            self.assertIn(marca, br, f"a protecao `{marca}` do BR2026 sumiu")
        # O CDB2026 usa o MESMO armazenamento, não um paralelo.
        led = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "result_email_ledger.py"), encoding="utf-8").read()
        self.assertIn("enqueue_bolao_notif", led)
        self.assertNotIn("create table", led.lower())


class CaminhoDeEnvio(unittest.TestCase):
    """O ledger jamais pode impedir um e-mail legítimo de sair."""

    def _sender(self):
        import send_result_email as s
        return s

    def test_ledger_fora_do_ar_nao_bloqueia_o_envio(self):
        s = self._sender()
        enviados = []
        orig_send, orig_sleep = s.send_email, s.time.sleep
        s.send_email = lambda addr, subj, html: enviados.append(addr) or "250"
        s.time.sleep = lambda *_: None
        try:
            sent, errors = s._send_to_all(_state(_iso(NOW)), "<p>x</p>", "assunto",
                                          ledger_ref=("quartas", "t1", "first"),
                                          ledger=FakeLedger(write_raises=True))
        finally:
            s.send_email, s.time.sleep = orig_send, orig_sleep
        self.assertEqual(sent, 2, "os dois e-mails tinham de sair mesmo com o ledger fora")
        self.assertEqual(errors, [])

    def test_registro_usa_id_da_entrada_e_nunca_o_email(self):
        s = self._sender()
        led = FakeLedger()
        orig_send, orig_sleep = s.send_email, s.time.sleep
        s.send_email = lambda a, b, c: "250"
        s.time.sleep = lambda *_: None
        try:
            s._send_to_all(_state(_iso(NOW)), "<p>x</p>", "assunto",
                           ledger_ref=("quartas", "t1", "first"), ledger=led)
        finally:
            s.send_email, s.time.sleep = orig_send, orig_sleep
        self.assertEqual(len(led.sent), 2)
        for chave in led.sent + led.reserved:
            self.assertNotIn("@", chave, "endereço de participante não pode entrar no ledger")

    def test_sem_ledger_ref_o_comportamento_e_o_de_antes(self):
        s = self._sender()
        led = FakeLedger()
        orig_send, orig_sleep = s.send_email, s.time.sleep
        s.send_email = lambda a, b, c: "250"
        s.time.sleep = lambda *_: None
        try:
            sent, _ = s._send_to_all(_state(_iso(NOW)), "<p>x</p>", "assunto", ledger=led)
        finally:
            s.send_email, s.time.sleep = orig_send, orig_sleep
        self.assertEqual(sent, 2)
        self.assertEqual(led.reserved, [], "sem identidade, nada é registrado")


class Elegibilidade(unittest.TestCase):
    def test_sem_resultado_salvo_nada_e_esperado(self):
        st = _state(_iso(NOW - timedelta(hours=10)), goals=None)
        self.assertEqual(det.expected_emails(st, now=NOW), [])

    def test_dentro_da_folga_ainda_nao_e_esperado(self):
        st = _state(_iso(NOW - timedelta(hours=1)))
        self.assertEqual(det.expected_emails(st, now=NOW), [],
                         "uma perna recente não pode ser acusada de atraso")

    def test_sem_kickoff_conhecido_nao_se_afirma_atraso(self):
        st = _state(None)
        self.assertEqual(det.expected_emails(st, now=NOW), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
