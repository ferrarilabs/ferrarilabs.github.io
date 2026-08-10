"""
test_workflow_arming_contract.py — PB-R3 + POWERBALL_NO_FAKE_EMAIL_GATE.

Cobre o que nenhum teste de Python alcanca sozinho: o YAML do workflow. Um ciclo de notificacao
impecavel nao serve de nada se o agendador dispara duas execucoes sobrepostas, se o cron nao cobre
as noites de sorteio, ou se o "envio" que se testou nunca foi capaz de enviar de verdade.

─── PB-R3: CONCORRENCIA ────────────────────────────────────────────────────────────────────────

O claim atomico ja impede envio duplicado. O grupo de concorrencia e a SEGUNDA barreira: sem ele,
seis crons de 10 em 10 minutos podem empilhar execucoes que competem por `contents: write` e
produzem conflito de push -- ruido que esconde falha real.

`cancel-in-progress` tem de ser false. Cancelar uma execucao no meio do transporte e exatamente
como se cria um destinatario em estado desconhecido.

─── NO_FAKE_EMAIL ──────────────────────────────────────────────────────────────────────────────

O oposto do portao de seguranca: garante que o caminho de producao seja REAL. Um teste que
"passa" porque o envio era um no-op nao prova entrega -- prova que nada aconteceu.

Executar: POWERBALL_TEST_RUN=1 python3 test_workflow_arming_contract.py
"""

import os
import re
import sys
import unittest

os.environ["POWERBALL_TEST_RUN"] = "1"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
WF = os.path.join(ROOT, ".github", "workflows", "powerball-results-email.yml")


class PBR3Concorrencia(unittest.TestCase):
    def setUp(self):
        self.src = open(WF, encoding="utf-8").read()

    def test_existe_grupo_de_concorrencia(self):
        self.assertRegex(self.src, r"concurrency:\s*\n\s*group:\s*\S+",
                         "sem grupo de concorrencia, execucoes se empilham")

    def test_nao_cancela_execucao_em_andamento(self):
        m = re.search(r"cancel-in-progress:\s*(\S+)", self.src)
        self.assertIsNotNone(m, "cancel-in-progress tem de ser explicito")
        self.assertEqual(m.group(1), "false",
                         "cancelar no meio do transporte cria destinatario em estado desconhecido")

    def test_cron_cobre_as_tres_noites_de_sorteio(self):
        """Regressao de 2026-08-06: o cron cobria terca+sabado e nunca disparava apos
        segunda ou quarta -- perdeu o sorteio de 08/05 inteiro."""
        crons = re.findall(r"cron:\s*'([^']+)'", self.src)
        dias = set()
        for c in crons:
            dias.update(c.split()[-1].split(","))
        for dia, nome in [("1", "segunda"), ("2", "terca (madrugada de segunda ET)"),
                          ("3", "quarta"), ("4", "quinta (madrugada de quarta ET)"),
                          ("6", "sabado"), ("0", "domingo (madrugada de sabado ET)")]:
            self.assertIn(dia, dias, f"o cron nao cobre {nome}")

    def test_timeout_impede_lease_orfao_eterno(self):
        m = re.search(r"timeout-minutes:\s*(\d+)", self.src)
        self.assertIsNotNone(m, "sem timeout, um runner travado segura o lease ate expirar")
        self.assertLessEqual(int(m.group(1)), 30)

    def test_o_preflight_roda_antes_do_envio(self):
        self.assertLess(self.src.index("recipient_preflight.py"),
                        self.src.index("fetch_and_send_results.py"),
                        "descobrir contato faltando DEPOIS do envio nao serve para nada")

    def test_o_segredo_nunca_e_escrito_em_arquivo_nem_ecoado(self):
        for proibido in ("echo $POWERBALL_PRIVATE", "cat $POWERBALL_PRIVATE",
                         "> participants.json", "POWERBALL_PRIVATE_PARTICIPANT_DATA >"):
            self.assertNotIn(proibido, self.src)


class NoFakeEmail(unittest.TestCase):
    """O caminho de producao tem de ser capaz de enviar de verdade -- e so em producao."""

    def test_o_transporte_padrao_invoca_o_sender_real(self):
        import fetch_and_send_results as F
        import inspect
        src = inspect.getsource(F._default_send_email)
        self.assertIn("SEND_EMAIL_SCRIPT", src,
                      "o transporte padrao nao chama o sender real -- seria um no-op")
        self.assertIn("subprocess.run", src)
        self.assertNotIn("return {\"accepted\": []}", src)

    def test_o_sender_exige_modo_producao_explicito(self):
        import send_result_email as S
        self.assertFalse(S._SEND_AUTHORIZED["ok"],
                         "o sender nao pode nascer autorizado")

    def test_variavel_de_teste_desarma_o_envio(self):
        """POWERBALL_TEST_RUN tem de bloquear envio real -- esta suite inteira depende disso."""
        import send_result_email as S
        import inspect
        src = inspect.getsource(S)
        self.assertIn("POWERBALL_TEST_RUN", src)
        i = src.index("POWERBALL_TEST_RUN")
        self.assertIn("return", src[i:i + 400],
                      "a variavel de teste tem de causar recusa, nao so ser lida")

    def test_o_workflow_declara_o_modo_de_envio_explicitamente(self):
        """Armar e um ato deliberado e visivel no YAML, nunca um efeito colateral.

        Enquanto POWERBALL_EMAIL_MODE nao estiver no ambiente do passo de envio, o workflow roda
        o ciclo inteiro e o sender RECUSA -- que e o estado desarmado correto.
        """
        src = open(WF, encoding="utf-8").read()
        armado = "POWERBALL_EMAIL_MODE" in src
        if armado:
            self.assertRegex(src, r"POWERBALL_EMAIL_MODE:\s*production",
                             "se declarado, tem de ser explicitamente 'production'")
        print(f"\n    ESTADO DO WORKFLOW: {'ARMADO' if armado else 'DESARMADO (sender recusa)'}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
