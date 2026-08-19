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
from round_notif_rpc_fake import FakeRoundNotifStore, make_round_rpc_caller


MANIFESTO = MANIFEST.load()
# A rodada usada aqui precisa estar DENTRO da janela real de reconciliacao (as `RECONCILE_WINDOW`
# mais recentes cujo inicio ja passou) -- por isso continua sendo a 22 e nao uma futura. Desde o
# guardiao de epoca do ledger duravel (2026-08-18, incidente de ressurreicao da R22 -- ver
# ROUND_HISTORICAL_LEDGER_GAP em round_state.py), nenhuma rodada <= EARLIEST_DURABLE_LEDGER_ROUND
# pode virar candidata so por ausencia de linha na tabela nova. Este harness testa COMPLETUDE DE
# DESTINATARIO, nao o guardiao de epoca (que tem seus proprios testes) -- por isso `Harness.
# install()` desliga o guardiao (`S.EARLIEST_DURABLE_LEDGER_ROUND = 0`) para isolar as duas
# preocupacoes.
RODADA_TESTE = 22
RODADA_DEF = next(r for r in MANIFESTO["rounds"] if r["roundNumber"] == RODADA_TESTE)
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
        self.round_notif_store = FakeRoundNotifStore()
        self.state = {"entries": entries, "roundEmail": {
            # Evidência legada mínima: define o epoch para que rodadas antigas fiquem PRE_FEATURE
            # e não virem candidatas.
            "sentBatches": [{"windowStart": "2026-07-16T00:00:00Z"}],
            "sentGameIds": [],
        }}
        self.games = {fid: _game(fid, r22_completa) for fid in RODADA_DEF["canonicalFixtureIds"]}

    def install(self, transport_result=None, fail_for=None):
        S.sb_fetch = lambda: self.state
        setattr(S, _ESCRITOR, lambda st: (self.saved_states.append(json.loads(json.dumps(st, default=str))), 200)[1])
        S.fetch_scoreboard_window = lambda a, b: dict(self.games)
        S.fetch_standings = lambda: list(STANDINGS)
        S.time.sleep = lambda *_: None
        # Fronteira do ledger atômico (F8): sem isto `AtomicRoundLedgerRepo` tentaria RPC de
        # verdade. Um dublê fiel, não um mock que sempre diz "disponível" -- ver
        # round_notif_rpc_fake.py.
        S._ROUND_RPC_CALLER = make_round_rpc_caller(self.round_notif_store)
        # `notification_states_from_atomic()` chama `_rpc()` cru (RPC genérica de
        # `bolao_notif_jobs`, tabela DIFERENTE do ledger de rodada) sem injeção nenhuma -- nunca
        # foi exercitada aqui porque, antes de F8, `atomic_ledger_available()` sempre falhava
        # localmente (sem credencial) e isso desativava a chamada via `if atomic_ok`. `{}` é o
        # valor real esperado em produção: nada enfileira rodada do BR2026 nessa tabela.
        S.notification_states_from_atomic = lambda: {}
        # Guardiao de epoca desligado de proposito: este arquivo testa COMPLETUDE DE
        # DESTINATARIO, e a rodada de teste (22) esta dentro da epoca real -- sem isto, todo
        # teste aqui bloquearia como HISTORICAL_LEDGER_GAP por nao seedar nenhuma fonte
        # historica, o que testaria o guardiao (ja coberto em outro arquivo) em vez do que este
        # arquivo existe para testar.
        S.EARLIEST_DURABLE_LEDGER_ROUND = 0

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
                       "_TRANSPORT", "_ROUND_RPC_CALLER", "notification_states_from_atomic",
                       "EARLIEST_DURABLE_LEDGER_ROUND"]}
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
        self.assertIn(RODADA_TESTE, out["candidates"], "rodada completa deveria ser candidata")
        r22 = next(r for r in out["rounds"] if r["round"] == RODADA_TESTE)
        self.assertTrue(r22["recipientSetComplete"])
        self.assertTrue(r22["wouldSend"])
        self.assertEqual(len(h.provider_calls), 0, "DRY-RUN nunca pode chamar o provedor")
        self.assertEqual(out["providerCalls"], 0)

    def test_um_destinatario_sem_email_bloqueia_TODOS_os_envios(self):
        h = Harness([_entry("e1", "a@example.invalid"), _entry("e2", "b@example.invalid"),
                     _entry("e3", "")])
        h.install()
        out = self._dry_run(h)
        r22 = next(r for r in out["rounds"] if r["round"] == RODADA_TESTE)
        self.assertEqual(r22["blocked"], "RECIPIENT_SET_INCOMPLETE")
        self.assertFalse(r22["wouldSend"])
        self.assertEqual(len(h.provider_calls), 0,
                         "conjunto incompleto deve produzir ZERO chamadas ao provedor")

    def test_email_invalido_conta_como_nao_resolvido(self):
        h = Harness([_entry("e1", "a@example.invalid"), _entry("e2", "naoehemail")])
        h.install()
        out = self._dry_run(h)
        r22 = next(r for r in out["rounds"] if r["round"] == RODADA_TESTE)
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
        r22 = next(r for r in out["rounds"] if r["round"] == RODADA_TESTE)
        self.assertEqual(r22["idempotencyKey"], f"br2026:round-results:{RODADA_TESTE}:v1")
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
