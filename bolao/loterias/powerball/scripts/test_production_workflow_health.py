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


if __name__ == "__main__":
    unittest.main(verbosity=2)
