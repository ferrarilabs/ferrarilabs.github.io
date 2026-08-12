"""
test_recipient_completeness.py — portão fail-closed de destinatários do BR2026, caminho canônico.

RECIPIENT_SET_INCOMPLETE_ZERO_SENDS
DRY_RUN_NEVER_CALLS_PROVIDER
NO_PII_IN_OPERATIONAL_EVENTS

Este arquivo mirava o modelo de lote rolante (`pendingBatch`/`sentBatches`), removido em
2026-08-10 junto com `get_or_open_batch()`. Os INVARIANTES que ele protegia continuam valendo —
mudou o caminho que os implementa, não a regra —, então foi reescrito contra o pipeline canônico
em vez de apagado. Apagar um teste porque a implementação mudou é como se perde cobertura sem
ninguém notar.

O que se mede continua sendo a única coisa que importa: quantas chamadas o PROVEDOR recebeu.

Executar: BOLAO_TEST_RUN=1 python3 bolao/br2026/scripts/test_recipient_completeness.py
"""

import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

os.environ["BOLAO_TEST_RUN"] = "1"   # trava de segurança: nenhum envio real, jamais
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import send_round_email as S
import build_round_manifest as MANIFEST


MANIFESTO = MANIFEST.load()
R22 = next(r for r in MANIFESTO["rounds"] if r["roundNumber"] == 22)
AGORA = datetime.now(timezone.utc)


def _game(fid, completed=True):
    """Jogo no formato que `fetch_scoreboard_window()` devolve."""
    return {
        "id": fid,
        "date": AGORA - timedelta(hours=20),
        "home": f"Casa {fid[-3:]}", "away": f"Fora {fid[-3:]}",
        "completed": completed, "goalsHome": 1, "goalsAway": 0,
        "statusName": "STATUS_FULL_TIME" if completed else "STATUS_SCHEDULED",
        "statusState": "post" if completed else "pre",
    }


def _entry(eid, email):
    return {
        "id": eid, "entryName": f"Entrada {eid}", "participantEmail": email,
        "picks": {"g4": ["T01", "T02", "T03", "T04"], "z4": ["T17", "T18", "T19", "T20"],
                  "sa6": ["T07", "T08", "T09", "T10", "T11", "T12"]},
    }


STANDINGS = [{"name": f"T{i:02}", "rank": i, "gd": 20 - i, "gf": 30 - i} for i in range(1, 21)]


class Harness:
    """Substitui TODA fronteira externa. Um teste de segurança de e-mail que alcança o provedor
    é uma contradição."""

    def __init__(self, entries, r22_completa=True):
        self.provider_calls = []
        self.saved_states = []
        self.state = {"entries": entries, "roundEmail": {
            # Evidência legada mínima: define o epoch para que rodadas antigas fiquem PRE_FEATURE
            # e não virem candidatas.
            "sentBatches": [{"windowStart": "2026-07-16T00:00:00Z"}],
            "sentGameIds": [],
        }}
        self.games = {fid: _game(fid, r22_completa) for fid in R22["canonicalFixtureIds"]}

    def install(self, transport_result=None, fail_for=None):
        S.sb_fetch = lambda: self.state
        setattr(S, _ESCRITOR, lambda st: (self.saved_states.append(json.loads(json.dumps(st, default=str))), 200)[1])
        S.fetch_scoreboard_window = lambda a, b: dict(self.games)
        S.fetch_standings = lambda: list(STANDINGS)
        S.time.sleep = lambda *_: None

        def transport(url, body, headers):
            self.provider_calls.append(body)
            if fail_for is not None and len(self.provider_calls) > fail_for:
                raise RuntimeError("provedor caiu")
            return transport_result or 200
        S._TRANSPORT = transport


# Ponto de escrita do sender. `sb_upsert` foi removido quando o BR2026 trocou gravacao de
# documento inteiro por mutacao estreita; `sb_append_audit` e o que existe hoje. O teste precisa
# apenas garantir que NENHUMA escrita real aconteca -- qual e o nome importa menos que existir um.
_ESCRITOR = next(k for k in ("sb_upsert", "sb_append_audit") if hasattr(S, k))


class RecipientCompleteness(unittest.TestCase):
    def setUp(self):
        # `sb_upsert` deixou de existir: a gravacao de documento inteiro do BR2026 foi trocada
        # por mutacao estreita (`sb_append_audit` + RPCs). Substituir o nome aqui NAO afrouxa
        # nada -- estes casos sao sobre RESOLUCAO DE DESTINATARIO, e o que eles precisam e que
        # nenhuma escrita real aconteca durante o teste. Exigir o nome antigo exigiria de volta o
        # upsert de documento inteiro, que e exatamente o que foi removido.
        _escritores = [k for k in ("sb_upsert", "sb_append_audit") if hasattr(S, k)]
        assert _escritores, (
            "nenhum ponto de escrita conhecido em send_round_email — se o nome mudou de novo, "
            "atualize esta lista em vez de deixar o teste gravar de verdade")
        self._orig = {k: getattr(S, k) for k in
                      ["sb_fetch", *_escritores, "fetch_scoreboard_window", "fetch_standings",
                       "_TRANSPORT"]}
        self._sleep = S.time.sleep

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(S, k, v)
        S.time.sleep = self._sleep

    def _dry_run(self, h):
        return S.run_auto(dry_run=True)

    def test_conjunto_completo_fica_elegivel_e_NAO_chama_o_provedor(self):
        h = Harness([_entry("e1", "a@example.invalid"), _entry("e2", "b@example.invalid")])
        h.install()
        out = self._dry_run(h)
        self.assertIn(22, out["candidates"], "R22 completa deveria ser candidata")
        r22 = next(r for r in out["rounds"] if r["round"] == 22)
        self.assertTrue(r22["recipientSetComplete"])
        self.assertTrue(r22["wouldSend"])
        self.assertEqual(len(h.provider_calls), 0, "DRY-RUN nunca pode chamar o provedor")
        self.assertEqual(out["providerCalls"], 0)

    def test_um_destinatario_sem_email_bloqueia_TODOS_os_envios(self):
        h = Harness([_entry("e1", "a@example.invalid"), _entry("e2", "b@example.invalid"),
                     _entry("e3", "")])
        h.install()
        out = self._dry_run(h)
        r22 = next(r for r in out["rounds"] if r["round"] == 22)
        self.assertEqual(r22["blocked"], "RECIPIENT_SET_INCOMPLETE")
        self.assertFalse(r22["wouldSend"])
        self.assertEqual(len(h.provider_calls), 0,
                         "conjunto incompleto deve produzir ZERO chamadas ao provedor")

    def test_email_invalido_conta_como_nao_resolvido(self):
        h = Harness([_entry("e1", "a@example.invalid"), _entry("e2", "naoehemail")])
        h.install()
        out = self._dry_run(h)
        r22 = next(r for r in out["rounds"] if r["round"] == 22)
        self.assertEqual(r22["blocked"], "RECIPIENT_SET_INCOMPLETE")
        self.assertEqual(len(h.provider_calls), 0)

    def test_rodada_incompleta_nao_vira_candidata(self):
        h = Harness([_entry("e1", "a@example.invalid")], r22_completa=False)
        h.install()
        out = self._dry_run(h)
        self.assertNotIn(22, out["candidates"],
                         "rodada com jogos nao terminais nao pode ser candidata")
        self.assertEqual(len(h.provider_calls), 0)

    def test_chave_de_idempotencia_e_canonica_e_sem_PII(self):
        h = Harness([_entry("e1", "a@example.invalid")])
        h.install()
        out = self._dry_run(h)
        r22 = next(r for r in out["rounds"] if r["round"] == 22)
        self.assertEqual(r22["idempotencyKey"], "br2026:round-results:22:v1")
        self.assertNotIn("@", r22["idempotencyKey"])

    def test_dry_run_NAO_persiste_estado(self):
        h = Harness([_entry("e1", "a@example.invalid")])
        h.install()
        self._dry_run(h)
        self.assertEqual(h.saved_states, [],
                         "DRY-RUN nao pode gravar no Supabase")

    def test_nenhum_endereco_de_email_nos_eventos_operacionais(self):
        h = Harness([_entry("e1", "segredo@privado.invalid"), _entry("e2", "b@example.invalid")])
        h.install()
        eventos = []
        orig = S._emit
        S._emit = lambda e: eventos.append(e)
        try:
            self._dry_run(h)
        finally:
            S._emit = orig
        blob = json.dumps(eventos)
        self.assertNotIn("segredo@privado.invalid", blob,
                         "evento operacional nunca pode conter endereco de participante")
        self.assertNotIn("@", blob, "nenhum endereco em evento operacional")


if __name__ == "__main__":
    unittest.main(verbosity=2)
