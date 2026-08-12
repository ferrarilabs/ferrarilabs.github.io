"""
test_production_workflow_health.py — POWERBALL_RECENT_PRODUCTION_WORKFLOW_HEALTH.

─── O QUE ACONTECEU EM 2026-08-10 ──────────────────────────────────────────────────────────────

Tres execucoes do workflow real falharam seguidas. A causa nao era "ainda nao ha resultado":

    RuntimeError: SQL falhou: Cannot find project ref. Have you run supabase link?

`powerball_notification._sql()` executava `npx supabase db query --linked`. O `--linked` depende
de um `supabase link` feito na maquina do DESENVOLVEDOR. No runner do GitHub Actions esse vinculo
nao existe -- entao toda escrita no ledger falhava. O ledger inteiro, testado e verde localmente,
era inoperante em producao.

A licao generaliza: um caminho de PRODUCAO nao pode depender de uma sessao local de
desenvolvimento. Testes locais nunca pegam isso, porque localmente o vinculo existe.

Duas classes de defeito, os dois gates abaixo:

  1. dependencia de CLI de desenvolvedor no caminho de producao
  2. estado de negocio normal reportado como falha de infraestrutura

Executar: POWERBALL_TEST_RUN=1 python3 test_production_workflow_health.py
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

import inspect
import os
import sys
import unittest

os.environ["POWERBALL_TEST_RUN"] = "1"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fetch_and_send_results as F
import powerball_notification as P


class SemDependenciaDeCliLocal(unittest.TestCase):
    """O caminho que o runner percorre nao pode exigir nada que so exista no laptop."""

    CAMINHOS_DE_PRODUCAO = ["ensure_job", "record_recipient", "settle",
                            "retryable_recipients", "check_content_immutability",
                            "reconcile_orphaned_sending"]

    def test_nenhuma_operacao_do_ledger_depende_da_cli_do_supabase(self):
        for nome in self.CAMINHOS_DE_PRODUCAO:
            fn = getattr(P, nome, None)
            self.assertIsNotNone(fn, f"{nome} sumiu do ledger")
            src = inspect.getsource(fn)
            self.assertNotIn("_sql(", src,
                             f"{nome}() usa _sql(), que depende de `supabase link` -- "
                             f"vinculo que NAO existe no GitHub Actions. Foi o que derrubou "
                             f"as tres execucoes de 2026-08-10.")

    def test_a_funcao_de_transporte_privilegiado_nao_e_mais_a_cli(self):
        if not hasattr(P, "_sql"):
            return
        src = inspect.getsource(P._sql)
        if "--linked" in src:
            self.assertIn("DESENVOLVIMENTO", src.upper(),
                          "_sql() ainda usa --linked sem estar marcado como caminho apenas local")

    def test_o_workflow_nao_invoca_a_cli_do_supabase(self):
        """Olha os comandos `run:`, nao o texto do arquivo.

        A primeira versao disto procurava "supabase link" no YAML inteiro -- e casava com o
        COMENTARIO que explica por que essa dependencia foi removida. Gate vermelho por causa da
        propria documentacao do defeito que ele protege. E a terceira vez nesta sessao que eu
        escrevo um gate que le prosa em vez de codigo.
        """
        import yaml
        wf = os.path.join(HERE, "..", "..", "..", "..",
                          ".github", "workflows", "powerball-results-email.yml")
        conf = yaml.safe_load(open(wf, encoding="utf-8"))
        for passo in conf["jobs"]["fetch-and-send"]["steps"]:
            cmd = str(passo.get("run", ""))
            # Dentro de um bloco `run:`, linha iniciada por # tambem e comentario.
            codigo = "\n".join(l for l in cmd.splitlines()
                                if not l.strip().startswith("#"))
            self.assertNotIn("supabase link", codigo,
                             f"passo '{passo.get('name')}' invoca a CLI do Supabase")
            self.assertNotIn("supabase db query", codigo,
                             f"passo '{passo.get('name')}' invoca a CLI do Supabase")


class SemanticaDeSaida(unittest.TestCase):
    """Estado de negocio normal nao pode aparecer como falha de infraestrutura."""

    def test_estados_normais_saem_zero(self):
        for estado in ("READY_DRY_RUN", "ALREADY_COMPLETED", "ALREADY_CLAIMED", "sent", None):
            self.assertIn(estado, F.ESTADOS_OK,
                          f"'{estado}' e um estado normal e nao pode virar vermelho")

    def test_estados_que_exigem_acao_saem_diferente_de_zero(self):
        for estado in ("RECIPIENT_SET_INCOMPLETE", "CONTENT_CONFLICT",
                       "LEDGER_INDISPONIVEL", "failed_permanent"):
            self.assertIn(estado, F.ESTADOS_ATENCAO,
                          f"'{estado}' exige atencao humana e tem de falhar")

    def test_as_duas_listas_nao_se_sobrepoem(self):
        self.assertEqual(F.ESTADOS_OK & F.ESTADOS_ATENCAO, set())

    def test_estado_desconhecido_nunca_vira_verde(self):
        """Um estado novo que ninguem classificou tem de falhar, nao ser presumido benigno."""
        src = inspect.getsource(F.main)
        self.assertIn("NAO CLASSIFICADO", src)
        i = src.index("NAO CLASSIFICADO")
        self.assertIn("return 2", src[i - 200:i + 200])

    def test_excecao_inesperada_nunca_vira_verde(self):
        src = inspect.getsource(F.main)
        self.assertIn("except Exception", src)
        i = src.index("except Exception")
        self.assertIn("return 2", src[i:i + 700],
                      "excecao tem de sair diferente de zero -- foi assim que 3 execucoes "
                      "falharam sem que nada as classificasse")

    def test_o_script_propaga_o_codigo_de_saida(self):
        src = inspect.getsource(F)
        self.assertIn("sys.exit(main())", src,
                      "sem sys.exit(main()) o codigo de retorno e descartado e tudo fica verde")


class GatilhosDoWorkflow(unittest.TestCase):
    """O processador de resultado ao vivo nao roda a cada commit."""

    def setUp(self):
        import yaml
        self.wf = os.path.join(HERE, "..", "..", "..", "..",
                               ".github", "workflows", "powerball-results-email.yml")
        self.conf = yaml.safe_load(open(self.wf, encoding="utf-8"))
        # `on:` vira booleano True no YAML 1.1 -- pegadinha classica.
        self.gatilhos = self.conf.get(True) or self.conf.get("on")

    def test_sem_gatilho_de_push(self):
        """Teste pertence ao push; reconciliador de resultado ao vivo, nao.

        Um push comum nao pode iniciar o processador que fala com a loteria, com o banco e com o
        provedor de e-mail. Se algum dia houver motivo de producao para isso, ele tem de estar
        escrito aqui -- nao presumido.
        """
        self.assertNotIn("push", self.gatilhos,
                         "push dispara o processador de resultado ao vivo sem justificativa")

    def test_schedule_e_dispatch_seguem_configurados(self):
        self.assertIn("schedule", self.gatilhos)
        self.assertIn("workflow_dispatch", self.gatilhos)

    def test_o_modo_de_producao_nao_burla_os_portoes(self):
        """Armar nao pode desativar preflight nem canario."""
        passos = self.conf["jobs"]["fetch-and-send"]["steps"]
        nomes = " ".join(p.get("name", "") for p in passos)
        self.assertIn("Preflight", nomes, "o preflight sumiu do caminho")
        self.assertIn("Canario", nomes, "o canario do ledger sumiu do caminho")
        envio = [p for p in passos if "fetch_and_send_results.py" in str(p.get("run", ""))][0]
        i_envio = passos.index(envio)
        for critico in ("Preflight", "Canario"):
            j = [k for k, p in enumerate(passos) if critico in p.get("name", "")][0]
            self.assertLess(j, i_envio, f"{critico} tem de rodar ANTES do envio")

    def test_nenhum_passo_critico_engole_erro(self):
        """`continue-on-error` no envio ou no canario transformaria defeito em verde."""
        for passo in self.conf["jobs"]["fetch-and-send"]["steps"]:
            nome = passo.get("name", "")
            if "Canario" in nome or "fetch_and_send_results.py" in str(passo.get("run", "")):
                self.assertNotEqual(passo.get("continue-on-error"), True,
                                    f"'{nome}' engole erro")


class SemanticaPreSorteioNoCaminhoAGENDADO(unittest.TestCase):
    """O caminho que o AGENDADOR percorre -- sem --dry-run.

    ─── POR QUE ESTE TESTE FALTAVA ─────────────────────────────────────────────────────────────

    Todos os meus canarios usavam dry_run=true, que retorna em READY_DRY_RUN ANTES do claim e do
    transporte. O agendador nao usa --dry-run: ele segue para o alvejamento, o transporte e o
    settle. Entao o mesmo commit passava no dispatch e falhava no schedule -- e o gate de saude
    do workflow, que so conferia MAPEAMENTOS de codigo de saida, nao tinha como notar.

    Um canario que nao percorre o caminho do agendador nao prova nada sobre o agendador.
    """

    def setUp(self):
        from crash_harness import FakeDB
        import powerball_notification as P
        self.P = P
        self.db = FakeDB()
        self._orig = (P._sql, P._rpc, F.check_and_update_results, F.parse_draws, F.load_data_js)
        P._sql, P._rpc = self.db.sql, self.db.rpc
        F.check_and_update_results = lambda *a, **k: False
        F.load_data_js = lambda *a, **k: ""
        self.nomes = [f"P{i:02d}" for i in range(15)]
        F.parse_draws = lambda *a, **k: [
            {"id": "2026-08-08", "drawing": {"drawDateIso": "2026-08-08T22:59:00-04:00"},
             "participants": [{"nome": n} for n in self.nomes],
             "result": {"numbers": [1, 2, 3, 4, 5], "special": 7, "multiplier": 2}},
            {"id": "2026-08-10", "drawing": {"drawDateIso": "2026-08-10T22:59:00-04:00"},
             "participants": [{"nome": n} for n in self.nomes]}]

    def tearDown(self):
        (self.P._sql, self.P._rpc, F.check_and_update_results,
         F.parse_draws, F.load_data_js) = self._orig

    def test_execucao_agendada_pre_sorteio_com_parcial_historica_sai_zero(self):
        """A falha real de 2026-08-10 23:07 UTC, reproduzida."""
        P = self.P
        chamadas = []
        P.ensure_job("2026-08-08", {"numbers": [1, 2, 3, 4, 5], "special": 7, "multiplier": 2},
                     self.nomes, None)
        chave = P.draw_key("2026-08-08")
        for n in self.nomes[:14]:
            P.record_recipient("2026-08-08", n, P.R_ACCEPTED)
        self.db.job(chave)["status"] = P.FAILED_RETRYABLE
        self.db.job(chave)["payload_snapshot"]["requiresManualAction"] = True

        deps = F.Deps(ledger=P, send_email=lambda g, r: chamadas.append(r) or {})
        rel = F.run_lifecycle("powerball", dry_run=False, deps=deps)   # como o agendador

        self.assertEqual(rel["notificationState"], "AGUARDA_ACAO_MANUAL")
        self.assertIn(rel["notificationState"], F.ESTADOS_OK,
                      "estado de negocio normal nao pode virar run vermelho")
        self.assertEqual(chamadas, [], "tocou o provedor numa execucao pre-sorteio")
        self.assertEqual(rel["providerCalls"], 0)

    def test_provider_calls_conta_invocacao_real_nao_intencao(self):
        """`providerCalls` era len(alvos), atribuido antes do desfecho.

        Reportava 1 quando o transporte tinha recusado e nenhum provedor fora tocado -- foi o que
        me fez ler a validacao controlada como entrega e investigar um envio que nunca houve.
        """
        P = self.P
        P.ensure_job("2026-08-08", {"numbers": [1, 2, 3, 4, 5], "special": 7, "multiplier": 2},
                     self.nomes, None)
        chave = P.draw_key("2026-08-08")
        for n in self.nomes[:14]:
            P.record_recipient("2026-08-08", n, P.R_ACCEPTED)
        self.db.job(chave)["status"] = P.FAILED_RETRYABLE

        recusa = lambda g, refs: {"accepted": [], "failed": list(refs), "uncertain": [],
                                  "stdout": "TRANSPORTE_INCAPAZ_DE_ALVEJAR: ...",
                                  "providerInvoked": False}
        rel = F.run_lifecycle("powerball", dry_run=False, deps=F.Deps(ledger=P, send_email=recusa))
        self.assertEqual(rel["providerCalls"], 0,
                         "contou chamada ao provedor que o transporte recusou")
        self.assertTrue(rel.get("providerRefused"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
