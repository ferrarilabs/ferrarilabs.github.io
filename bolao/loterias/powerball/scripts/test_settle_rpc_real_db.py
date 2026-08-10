"""
test_settle_rpc_real_db.py — executa as RPCs do ledger contra o Postgres REAL.

─── POR QUE ISTO PRECISA EXISTIR ───────────────────────────────────────────────────────────────

Com a migracao 020 a regra de fechamento do job passou a viver em SQL. A matriz de crash roda
em processo e ESPELHA essa regra num banco falso -- entao uma divergencia entre o SQL e o espelho
nao apareceria em lugar nenhum. Foi exatamente assim que o N23 escapou: testes estaticos liam o
texto do SQL e nenhum o EXECUTAVA, e um erro de tipo (42804) deixou jobs presos em `processing`
para sempre, em silencio.

Aqui as funcoes reais rodam no banco real. So execucao revela erro de tipo, cast implicito que
nao existe, e enum que nao aceita texto.

SEGURANCA: tudo acontece sob um pool sintetico (`__test__settle`) que nenhum app usa, com chaves
que carregam o marcador de teste, e e removido no fim. Nunca toca job de competicao real -- ja
causei um incidente de producao nesta sessao sondando com chave que existia de verdade.

Executar: POWERBALL_TEST_RUN=1 python3 test_settle_rpc_real_db.py
"""

import os
import sys
import unittest
import uuid

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import powerball_notification as P

POOL_SINTETICO = "__test__settle"  # `delete_canary_job` so apaga chaves com este prefixo


class SettleNoBancoReal(unittest.TestCase):
    """Cada teste cria seu proprio job sintetico e o remove depois."""

    @classmethod
    def setUpClass(cls):
        """Sem credencial privilegiada este gate NAO PODE rodar -- e isso tem de ser barulhento.

        Depois da revogacao do N24 a anon key perdeu execute nas RPCs, entao rodando na maquina
        de desenvolvimento este arquivo pulava os 8 testes e imprimia OK. Um gate que nao executa
        nada e reporta verde e exatamente o falso-verde que esta sessao inteira existe para matar
        -- e eu cheguei a reportar este gate como PASS quando ele nao tinha rodado teste nenhum.

        Onde ele roda de verdade: no passo de canario do GitHub Actions, que tem a credencial.
        Localmente pula, mas dizendo alto que pulou.
        """
        if not P.has_privileged_credential():
            print("\n  ⚠ SETTLE_RPC_REAL_DB = NAO EXECUTADO (sem credencial privilegiada).",
                  "\n    Este gate so tem valor no GitHub Actions. NAO conte como PASS.")
            raise unittest.SkipTest(
                "sem SUPABASE_SERVICE_ROLE_KEY — roda no canario do GitHub Actions")
        ok, motivo = P.ledger_available()
        if not ok:
            raise RuntimeError(f"credencial presente mas ledger inacessivel: {motivo}")

    def setUp(self):
        # Rastreia TODAS as chaves criadas, nao so a atual. Um teste reatribui self.chave num
        # laco, e o cleanup registrado com a chave original deixava as anteriores orfas -- sete
        # jobs sinteticos acumularam no banco antes de eu notar.
        self.chaves = []
        self.chave = self.nova_chave()
        self.addCleanup(self.limpar)

    def nova_chave(self):
        k = f"{POOL_SINTETICO}:draw-result:{uuid.uuid4().hex[:12]}:v1"
        self.chaves.append(k)
        return k

    def limpar(self):
        """Limpeza por RPC, nao pela CLI.

        A primeira versao usava _sql() -- a mesma dependencia de `supabase link` que derrubou
        tres execucoes do workflow. Os 8 testes passavam no runner e a LIMPEZA derrubava o job.
        `delete_canary_job` so aceita chave sintetica: um erro de digitacao aqui nao pode apagar
        notificacao real.
        """
        try:
            for k in self.chaves:
                P._rpc("delete_canary_job", {"p_idempotency_key": k})
        except Exception:
            # Job sintetico orfao nao justifica derrubar o gate; nenhum app le este pool.
            pass

    def criar(self, estados):
        recs = [{"entryRef": f"ref-{i}", "state": e} for i, e in enumerate(estados)]
        P._rpc("enqueue_bolao_notif", {
            "p_pool_id": POOL_SINTETICO, "p_entity_id": "sintetico",
            "p_event_type": "draw-result", "p_event_version": 1, "p_entry_ref": "AGGREGATE",
            "p_idempotency_key": self.chave,
            "p_payload": {"recipients": recs, "contentHash": "x" * 8},
            "p_template_id": "t", "p_template_version": 1,
            "p_max_attempts": 5, "p_schema_version": 1})

    def settle(self):
        r = P._rpc("settle_bolao_notif", {"p_idempotency_key": self.chave})
        return r[0] if isinstance(r, list) else r

    # ── a regra de negocio, executada de verdade ──────────────────────────
    def test_todos_aceitos_conclui(self):
        self.criar(["ACCEPTED"] * 3)
        r = self.settle()
        self.assertEqual(r["status"], "sent")
        self.assertEqual(r["accepted"], 3)

    def test_parcial_nunca_conclui(self):
        """14 de 15 em 08/08. A regra tem de valer no banco, nao so no Python."""
        self.criar(["ACCEPTED"] * 14 + ["PENDING"])
        r = self.settle()
        self.assertEqual(r["status"], "failed_retryable")
        self.assertEqual(r["accepted"], 14)
        self.assertEqual(r["total"], 15)
        self.assertIn("PARTIAL", r["reason"])

    def test_incerto_trava_para_revisao_humana(self):
        self.criar(["ACCEPTED", "UNCERTAIN"])
        r = self.settle()
        self.assertEqual(r["status"], "failed_permanent")
        self.assertIn("revisao humana", r["reason"])

    def test_o_enum_aceita_todos_os_estados_que_a_funcao_produz(self):
        """N23 de novo: o cast text->enum nao e implicito. So executando se descobre."""
        for estados, esperado in [(["ACCEPTED"], "sent"),
                                  (["FAILED"], "failed_retryable"),
                                  (["UNCERTAIN"], "failed_permanent")]:
            self.chave = self.nova_chave()
            self.criar(estados)
            self.assertEqual(self.settle()["status"], esperado)

    # ── validacao de entrada, executada de verdade ────────────────────────
    def test_endereco_de_email_e_recusado_pelo_banco(self):
        self.criar(["PENDING"])
        with self.assertRaises(Exception):
            P._rpc("set_bolao_notif_recipient", {
                "p_idempotency_key": self.chave, "p_entry_ref": "alguem@example.invalid",
                "p_state": "ACCEPTED"})

    def test_estado_invalido_e_recusado_pelo_banco(self):
        self.criar(["PENDING"])
        with self.assertRaises(Exception):
            P._rpc("set_bolao_notif_recipient", {
                "p_idempotency_key": self.chave, "p_entry_ref": "ref-0",
                "p_state": "ENVIADO_TALVEZ"})

    def test_chave_inexistente_levanta_em_vez_de_sucesso_silencioso(self):
        """PostgREST devolve 204 tanto para 'gravou' quanto para 'nada casou'.

        Essa ambiguidade ja causou um incidente neste repo. A funcao tem de LEVANTAR.
        """
        with self.assertRaises(Exception):
            P._rpc("set_bolao_notif_recipient", {
                "p_idempotency_key": "__nao_existe__:v1", "p_entry_ref": "ref-0",
                "p_state": "ACCEPTED"})

    def test_gravar_destinatario_realmente_persiste(self):
        self.criar(["PENDING", "PENDING"])
        P._rpc("set_bolao_notif_recipient", {
            "p_idempotency_key": self.chave, "p_entry_ref": "ref-0",
            "p_state": "ACCEPTED", "p_provider_message_id": "msg-1"})
        recs = P._rpc("get_bolao_notif_recipients", {"p_idempotency_key": self.chave})
        por_ref = {r["entryRef"]: r for r in recs}
        self.assertEqual(por_ref["ref-0"]["state"], "ACCEPTED")
        self.assertEqual(por_ref["ref-0"]["providerMessageId"], "msg-1")
        self.assertEqual(por_ref["ref-1"]["state"], "PENDING", "gravou no destinatario errado")


if __name__ == "__main__":
    unittest.main(verbosity=2)
