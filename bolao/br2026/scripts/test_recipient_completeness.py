"""
test_recipient_completeness.py — portão fail-closed de destinatários do BR2026.

RECIPIENT_SET_INCOMPLETE_ZERO_SENDS
PARTIAL_PROVIDER_SEND_NOT_SENT
BLOCKED_SEND_IS_NOT_SUCCESS

Estes três defeitos coexistiam com uma suíte verde porque nenhum teste exercitava o caminho de
envio de `run_auto()` — a lógica de destinatários vivia solta dentro de uma função de 150 linhas
que fala com ESPN e Supabase. Aqui a rede inteira é substituída, e o que se mede é a única coisa
que importa: quantas chamadas o PROVEDOR recebeu.

Executar: BOLAO_TEST_RUN=1 python3 bolao/br2026/scripts/test_recipient_completeness.py
"""

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

os.environ["BOLAO_TEST_RUN"] = "1"   # trava de segurança: nenhum envio real, jamais
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import send_round_email as S


def _game(gid, day, completed=True):
    return {
        "id": gid,
        "date": datetime(2026, 8, 8, 20, 0, tzinfo=timezone.utc) + timedelta(days=day),
        "home": f"Time {gid}A", "away": f"Time {gid}B",
        "completed": completed, "goalsHome": 1, "goalsAway": 0,
    }


def _entry(eid, email):
    return {
        "id": eid, "entryName": f"Entrada {eid}", "participantEmail": email,
        "picks": {"g4": ["A", "B", "C", "D"], "z4": ["Q", "R", "S", "T"], "sa6": ["E", "F", "G", "H", "I", "J"]},
    }


STANDINGS = [{"name": f"T{i:02}", "rank": i, "gd": 20 - i, "gf": 30 - i} for i in range(1, 21)]


class Harness:
    """Substitui TODA fronteira externa de run_auto(). Sem isto o teste tocaria ESPN, Supabase e
    EmailJS — e um teste de segurança de email que alcança o provedor é uma contradição."""

    def __init__(self, entries, games, batch_ids):
        self.entries = entries
        self.games = {g["id"]: g for g in games}
        self.provider_calls = []          # ← a métrica que importa
        self.saved_states = []
        self.state = {
            "entries": entries,
            "roundEmail": {"pendingBatch": {
                "windowStart": "2026-08-08T18:00:00Z",
                "windowEnd": "2026-08-10T06:00:00Z",
                "gameIds": batch_ids,
            }},
        }

    def install(self, transport_result=None, fail_for=None):
        S.sb_fetch = lambda: self.state
        S.sb_upsert = lambda st: (self.saved_states.append(st), 200)[1]
        S.fetch_scoreboard_window = lambda a, b: dict(self.games)
        S.fetch_standings = lambda: list(STANDINGS)
        S.time.sleep = lambda *_: None    # sem o sleep de 20s de confirmação nem o de 3s por envio

        def transport(url, body, headers):
            self.provider_calls.append(body)
            if fail_for is not None and len(self.provider_calls) > fail_for:
                raise RuntimeError("provedor caiu")
            return transport_result or 200
        S._TRANSPORT = transport


class RecipientCompleteness(unittest.TestCase):
    def setUp(self):
        # Guarda e restaura os originais: estes testes reescrevem o módulo inteiro.
        self._orig = {k: getattr(S, k) for k in
                      ("sb_fetch", "sb_upsert", "fetch_scoreboard_window", "fetch_standings", "_TRANSPORT")}
        self._sleep = S.time.sleep

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(S, k, v)
        S.time.sleep = self._sleep

    def _run(self, h):
        try:
            S.run_auto()
        except SystemExit as e:      # a auto-auditoria aborta com exit(1) se falhar
            self.fail(f"run_auto abortou inesperadamente: {e}")

    def test_um_destinatario_sem_email_bloqueia_TODOS_os_envios(self):
        entries = [_entry("e1", "a@x.com"), _entry("e2", "b@x.com"), _entry("e3", "")]
        games = [_game(str(1000 + i), 0) for i in range(10)]
        h = Harness(entries, games, [g["id"] for g in games]); h.install()
        self._run(h)
        self.assertEqual(len(h.provider_calls), 0,
                         "RECIPIENT_SET_INCOMPLETE deve produzir ZERO chamadas ao provedor")

    def test_bloqueio_mantem_o_lote_aberto_para_reprocessar(self):
        entries = [_entry("e1", "a@x.com"), _entry("e2", "naoehemail")]
        games = [_game(str(2000 + i), 0) for i in range(10)]
        h = Harness(entries, games, [g["id"] for g in games]); h.install()
        self._run(h)
        self.assertTrue(h.saved_states, "o bloqueio deve ser registrado no estado")
        self.assertIsNotNone(h.saved_states[-1]["roundEmail"]["pendingBatch"],
                             "o lote NAO pode ser fechado quando o envio foi bloqueado")

    def test_conjunto_completo_envia_para_todos(self):
        entries = [_entry("e1", "a@x.com"), _entry("e2", "b@x.com")]
        games = [_game(str(3000 + i), 0) for i in range(10)]
        h = Harness(entries, games, [g["id"] for g in games]); h.install()
        self._run(h)
        # 2 participantes + 1 resumo ao admin
        self.assertEqual(len(h.provider_calls), 3, "conjunto completo deve enviar a todos + admin")
        self.assertIsNone(h.saved_states[-1]["roundEmail"]["pendingBatch"],
                          "lote deve fechar quando todos receberam")

    def test_envio_parcial_NAO_fecha_o_lote(self):
        entries = [_entry(f"e{i}", f"p{i}@x.com") for i in range(1, 5)]
        games = [_game(str(4000 + i), 0) for i in range(10)]
        h = Harness(entries, games, [g["id"] for g in games])
        h.install(fail_for=2)          # os dois primeiros passam, os demais falham
        self._run(h)
        self.assertIsNotNone(h.saved_states[-1]["roundEmail"]["pendingBatch"],
                             "PARTIAL nunca pode ser tratado como SENT")
        acoes = [a["action"] for a in h.saved_states[-1].get("auditLog", [])]
        self.assertIn("round-email-partial", acoes, "o parcial deve ficar registrado na auditoria")

    def test_envio_bloqueado_pelo_portao_nao_conta_como_enviado(self):
        # send_email() devolve (False, motivo) sem levantar exceção. O código antigo somava isso
        # como sucesso e fechava o lote — a rodada ficava "enviada" sem ninguém receber nada.
        entries = [_entry("e1", "a@x.com"), _entry("e2", "b@x.com")]
        games = [_game(str(5000 + i), 0) for i in range(10)]
        h = Harness(entries, games, [g["id"] for g in games])
        h.install(transport_result=(False, "EMAIL_SEND_BLOCKED: processo de teste"))
        self._run(h)
        self.assertIsNotNone(h.saved_states[-1]["roundEmail"]["pendingBatch"],
                             "envio bloqueado nao pode fechar o lote")

    def test_nenhum_endereco_de_email_no_log_de_auditoria(self):
        entries = [_entry("e1", "segredo@privado.com"), _entry("e2", "")]
        games = [_game(str(6000 + i), 0) for i in range(10)]
        h = Harness(entries, games, [g["id"] for g in games]); h.install()
        self._run(h)
        blob = repr(h.saved_states[-1].get("auditLog", []))
        self.assertNotIn("segredo@privado.com", blob,
                         "o log de auditoria nunca pode conter endereco de participante")


if __name__ == "__main__":
    unittest.main(verbosity=2)
