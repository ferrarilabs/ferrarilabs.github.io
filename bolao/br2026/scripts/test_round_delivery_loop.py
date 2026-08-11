#!/usr/bin/env python3
"""BR2026 — o LACO DE ENTREGA por destinatario, exercitado de verdade.

POR QUE ESTE ARQUIVO EXISTE
---------------------------
Ate 2026-08-11 este laco NAO EXISTIA. Onde hoje ha entrega havia um comentario
("... envio real por destinatario acontece aqui ...") seguido de `raise NotImplementedError`.
O workflow rodava em --dry-run e toda a suite passava -- porque nenhum teste chegava perto do
unico trecho que importa quando o e-mail sai de verdade.

Os gates que existiam provavam que o LEDGER e consumido, injetando um `send_email` falso; e que
o transporte falha fechado. Nenhum provava o que acontece ENTRE os dois. Foi exatamente essa
lacuna, no app do Powerball, que reenviou e-mail para 15 pessoas reais.

Aqui o transporte e injetado no limite EXTERNO (`_TRANSPORT`), e tudo antes dele -- selecao de
alvos, transicoes do ledger, contagem de chamadas, settle -- e o codigo de producao.

Executar: python3 bolao/br2026/scripts/test_round_delivery_loop.py
NENHUM ENDERECO REAL: so dominios reservados por RFC 2606.
"""
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "..", "shared", "scripts"))

import send_round_email as S
from round_notification_ledger import (
    RoundLedger, MemoryRoundLedgerRepo, ROUND_STATE, RECIPIENT_STATE,
)

RODADA = 22
FIXTURES = [f"f{i}" for i in range(10)]


def entrada(i):
    return {"id": f"e{i}", "entryName": f"Entrada {i}",
            "participantEmail": f"p{i}@example.invalid",
            "picks": {"g4": [], "z4": [], "sa6": []}}


def faz_ledger():
    return RoundLedger(MemoryRoundLedgerRepo(),
                       now=lambda: int(datetime.now(timezone.utc).timestamp() * 1000))


class Transporte:
    """Limite EXTERNO. Registra cada invocacao real e devolve o que o teste mandar."""

    def __init__(self, resposta=200):
        self.chamadas = []
        self.resposta = resposta

    def __call__(self, url, body, headers):
        self.chamadas.append(body)
        r = self.resposta(len(self.chamadas)) if callable(self.resposta) else self.resposta
        if isinstance(r, Exception):
            raise r
        return r


def roda(ledger, entries, transporte, dry_run=False):
    """Chama o _process_round de PRODUCAO, com o minimo de andaime possivel.

    NAO cria o job aqui: `_process_round` chama `ensure_job` com o contentHash REAL, derivado do
    HTML que ele mesmo monta. Pre-criar com um hash de mentira fazia a segunda execucao bater em
    CONTEUDO_MUDOU_EM_JOB_ATIVO -- o andaime brigando com a protecao de imutabilidade, nao um
    defeito de producao.
    """
    cand = {"roundNumber": RODADA,
            "facts": {"expectedCount": 10, "finalCount": 10, "nonTerminalCount": 0}}
    manifest = {"rounds": [{"roundNumber": RODADA, "canonicalFixtureIds": FIXTURES,
                            "dateRangeUtc": ["2026-08-08T00:00:00+00:00",
                                             "2026-08-09T23:59:59+00:00"]}]}
    obs = {f: {"_game": {"date": "2026-08-08T20:00Z", "home": "A", "away": "B",
                         "goalsHome": 1, "goalsAway": 0}} for f in FIXTURES}
    state = {"entries": entries, "deletedIds": []}

    S._TRANSPORT = transporte
    try:
        return S._process_round(cand, manifest, obs, state, ledger, dry_run)
    finally:
        S._TRANSPORT = None


TABELA = [{"name": f"T{i}", "points": 40 - i} for i in range(20)]


class LacoDeEntrega(unittest.TestCase):
    def setUp(self):
        os.environ["BOLAO_TEST_RUN"] = "1"
        self._orig = S.fetch_standings
        S.fetch_standings = lambda: TABELA

    def tearDown(self):
        S.fetch_standings = self._orig
        S._TRANSPORT = None

    # ── o caso feliz ───────────────────────────────────────────────────────────────────────
    def test_envia_uma_vez_para_cada_destinatario(self):
        entries = [entrada(i) for i in range(3)]
        t = Transporte(200)
        r = roda(faz_ledger(), entries, t)
        self.assertEqual(len(t.chamadas), 3, "uma chamada por destinatario")
        self.assertEqual(r["providerCalls"], 3)
        self.assertEqual(r["accepted"], 3)
        self.assertEqual(r["ledgerState"], ROUND_STATE["SENT"])

    def test_dry_run_nao_toca_no_provedor(self):
        t = Transporte(200)
        r = roda(faz_ledger(), [entrada(0)], t, dry_run=True)
        self.assertEqual(len(t.chamadas), 0, "dry-run chamou o provedor")
        self.assertEqual(r["providerCalls"], 0)

    # ── a propriedade que protege dinheiro real ────────────────────────────────────────────
    def test_aceito_nunca_e_reenviado(self):
        """Segunda execucao sobre um job ja concluido faz ZERO chamadas."""
        entries = [entrada(i) for i in range(3)]
        led = faz_ledger()
        roda(led, entries, Transporte(200))

        t2 = Transporte(200)
        r2 = roda(led, entries, t2)
        self.assertEqual(len(t2.chamadas), 0,
                         "reenviou para quem o provedor ja tinha aceitado")
        self.assertEqual(r2["providerCalls"], 0)

    def test_apenas_o_que_falhou_e_reenviado(self):
        """Entrega parcial: a retentativa mira SO quem falhou, nunca o conjunto inteiro."""
        entries = [entrada(i) for i in range(3)]
        led = faz_ledger()
        # a 2a chamada falha
        roda(led, entries, Transporte(lambda i: 500 if i == 2 else 200))

        reg = led.get(RODADA)
        self.assertEqual(reg["state"], ROUND_STATE["PARTIAL"], "parcial virou concluido")

        t2 = Transporte(200)
        r2 = roda(led, entries, t2)
        self.assertEqual(len(t2.chamadas), 1, "a retentativa nao mirou so quem falhou")
        self.assertEqual(r2["accepted"], 1)
        self.assertEqual(led.get(RODADA)["state"], ROUND_STATE["SENT"])

    def test_parcial_nunca_vira_sent(self):
        entries = [entrada(i) for i in range(3)]
        led = faz_ledger()
        r = roda(led, entries, Transporte(lambda i: 500 if i >= 2 else 200))
        self.assertNotEqual(r["ledgerState"], ROUND_STATE["SENT"])
        self.assertEqual(r["accepted"], 1)
        self.assertEqual(r["failed"], 2)

    # ── incerteza ──────────────────────────────────────────────────────────────────────────
    def test_excecao_apos_o_post_vira_incerto_e_nao_reenvia(self):
        entries = [entrada(0)]
        led = faz_ledger()
        r = roda(led, entries, Transporte(RuntimeError("conexao caiu")))
        self.assertEqual(r["uncertain"], 1)
        self.assertEqual(r["providerCalls"], 1, "o POST saiu: tem de contar como chamada")
        self.assertEqual(led.get(RODADA)["state"], ROUND_STATE["NEEDS_MANUAL_REVIEW"])

        t2 = Transporte(200)
        roda(led, entries, t2)
        self.assertEqual(len(t2.chamadas), 0, "INCERTO foi reenviado automaticamente")

    def test_sending_orfao_com_lease_vencido_vira_incerto(self):
        """Dono anterior morreu entre o POST e o registro do desfecho.

        SENDING nao e 'nao tentado': pode ter havido entrega. O lease vence, a recuperacao marca
        UNCERTAIN e manda para revisao humana -- nunca de volta para a fila de reenvio.
        """
        entries = [entrada(0)]
        led = faz_ledger()
        roda(led, entries, Transporte(200), dry_run=True)   # cria o job com o hash REAL
        led.claim(RODADA, "dono-morto")
        led.mark_sending(RODADA)
        led.record_recipient(RODADA, "e0", RECIPIENT_STATE["SENDING"])

        # lease vencido: o dono nunca mais volta
        reg = led.repo.get("br2026:round-results:22:v1")
        led.repo.put("br2026:round-results:22:v1", dict(reg, leaseUntil=1))

        recuperados = led.recover_expired_leases()
        self.assertEqual(len(recuperados), 1, "o lease vencido nao foi recuperado")
        self.assertEqual(led.get(RODADA)["state"], ROUND_STATE["NEEDS_MANUAL_REVIEW"])
        self.assertEqual(led.get(RODADA)["recipients"][0]["state"], RECIPIENT_STATE["UNCERTAIN"])

        t = Transporte(200)
        roda(led, entries, t)
        self.assertEqual(len(t.chamadas), 0, "reenviou para um destinatario INCERTO")

    def test_recuperacao_de_lease_e_chamada_pela_producao(self):
        """CONTRATO: `run_auto` tem de chamar a recuperacao de leases.

        Ela existiu por semanas sem nenhum chamador de producao -- testada isoladamente, verde, e
        inerte. Uma rodada morta em SENDING nunca mais seria tocada.
        """
        import inspect
        fonte = inspect.getsource(S.run_auto)
        codigo = "\n".join(l for l in fonte.split("\n") if not l.strip().startswith("#"))
        self.assertIn("recover_expired_leases()", codigo,
                      "run_auto deixou de recuperar leases expirados")

    # ── o defeito que ja custou 15 e-mails ─────────────────────────────────────────────────
    def test_selecao_de_alvos_nunca_vira_difusao(self):
        """A SELECAO em si, exercitada direto. Sem passar por `_process_round`.

        A primeira versao deste teste chamava o fluxo inteiro duas vezes e conferia que a segunda
        nao enviava nada. Passava -- mas passava pelo motivo ERRADO: o job ja estava em SENT e o
        `claim` barrava a execucao antes de a selecao sequer rodar. Trocar a selecao por
        "manda para todos" mantinha o teste VERDE. Medido, nao suposto: a mutacao `... or resolved`
        nao derrubava nem este teste nem o gate de fonte (cuja regex tambem estava errada).

        Chamando a funcao pura direto, a mutacao aparece.
        """
        entries = [entrada(i) for i in range(3)]
        todos_aceitos = {e["id"]: RECIPIENT_STATE["ACCEPTED"] for e in entries}
        self.assertEqual(S.alvos_reenviaveis(entries, todos_aceitos), [],
                         "todo mundo aceito e mesmo assim alguem foi selecionado")

        um_falhou = dict(todos_aceitos, e1=RECIPIENT_STATE["FAILED"])
        self.assertEqual([e["id"] for e in S.alvos_reenviaveis(entries, um_falhou)], ["e1"],
                         "a selecao tem de mirar SO quem falhou")

        incerto = dict(todos_aceitos, e2=RECIPIENT_STATE["UNCERTAIN"])
        self.assertEqual(S.alvos_reenviaveis(entries, incerto), [],
                         "INCERTO nunca entra numa retentativa automatica")

        pendentes = {e["id"]: RECIPIENT_STATE["PENDING"] for e in entries}
        self.assertEqual(len(S.alvos_reenviaveis(entries, pendentes)), 3,
                         "primeira tentativa tem de mirar todo mundo")

    def test_rodada_ja_concluida_nao_reenvia(self):
        """Idempotencia pelo fluxo completo (a propriedade que o teste acima NAO cobre)."""
        entries = [entrada(i) for i in range(3)]
        led = faz_ledger()
        roda(led, entries, Transporte(200))     # todos aceitos
        t2 = Transporte(200)
        r2 = roda(led, entries, t2)
        self.assertEqual(len(t2.chamadas), 0)
        self.assertEqual(r2["providerCalls"], 0)

    def test_transporte_bloqueado_nao_reivindica_a_rodada(self):
        """Sem autorizacao o ledger fica INTOCADO -- nada de rodada presa em SENDING."""
        entries = [entrada(0)]
        led = faz_ledger()
        led.ensure_job(RODADA, 1, ["e0"], "hash-conteudo", FIXTURES)
        antes = led.get(RODADA)["state"]

        S._TRANSPORT = None      # sem transporte injetado, vale o portao real
        os.environ.pop("BOLAO_ALLOW_REAL_SEND", None)
        cand = {"roundNumber": RODADA,
                "facts": {"expectedCount": 10, "finalCount": 10, "nonTerminalCount": 0}}
        manifest = {"rounds": [{"roundNumber": RODADA, "canonicalFixtureIds": FIXTURES,
                                "dateRangeUtc": ["2026-08-08T00:00:00+00:00",
                                                 "2026-08-09T23:59:59+00:00"]}]}
        obs = {f: {"_game": {"date": "2026-08-08T20:00Z", "home": "A", "away": "B",
                             "goalsHome": 1, "goalsAway": 0}} for f in FIXTURES}
        r = S._process_round(cand, manifest, obs, {"entries": entries, "deletedIds": []},
                             led, False)
        self.assertEqual(r["providerCalls"], 0)
        self.assertEqual(r.get("blocked"), "TRANSPORT_BLOCKED")
        self.assertEqual(led.get(RODADA)["state"], antes, "o ledger foi mexido mesmo bloqueado")

    def test_fixtures_nao_usam_dominio_real(self):
        import re
        src = open(__file__, encoding="utf-8").read()
        for dominio in set(re.findall(r"@([a-z0-9.\-]+)", src)):
            self.assertTrue(dominio.endswith(".invalid"), f"fixture usa dominio real: {dominio}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
