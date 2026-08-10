"""
test_result_email_visual.py — PB-R1: regressao visual do e-mail de resultado.

O e-mail e o unico artefato que 15 pessoas realmente veem. Ele nao roda num navegador: flexbox,
grid e folha de estilo externa sao inconfiaveis em cliente de email, entao o desenho depende de
`<table>` com estilo inline. Uma regressao aqui nao quebra teste nenhum de aplicacao -- so chega
silenciosamente na caixa de entrada de todo mundo.

Executar: POWERBALL_TEST_RUN=1 python3 test_result_email_visual.py
"""

import os
import re
import sys
import unittest

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import send_result_email as S

NUMEROS = [35, 9, 63, 5, 54]     # de proposito fora de ordem
ESPECIAL = 7
MULT = 3


class BolasDoResultado(unittest.TestCase):
    def setUp(self):
        self.html = S.result_balls_html(NUMEROS, ESPECIAL, MULT)

    def test_todas_as_bolas_aparecem(self):
        for n in NUMEROS + [ESPECIAL]:
            self.assertIn(f">{n}</div>", self.html, f"a bola {n} sumiu do e-mail")

    def test_os_numeros_saem_ordenados(self):
        celulas = re.findall(r">(\d+)</div>", self.html)
        brancas = [int(x) for x in celulas[:5]]
        self.assertEqual(brancas, sorted(NUMEROS),
                         "as bolas brancas tem de sair ordenadas, como na loteria")
        self.assertEqual(int(celulas[5]), ESPECIAL, "a Powerball e sempre a ultima")

    def test_a_powerball_e_visualmente_distinta(self):
        self.assertIn(S._PB_RED, self.html, "a Powerball perdeu o vermelho")
        self.assertGreater(S._PB_BALL_SIZE, S._BALL_SIZE,
                           "a Powerball tem de ser maior que as brancas")

    def test_layout_sobrevive_a_cliente_de_email(self):
        self.assertIn("<table", self.html)
        self.assertIn("border-collapse:collapse", self.html)
        for proibido in ("display:flex", "display:grid", "<link", "class=", "@media"):
            self.assertNotIn(proibido, self.html,
                             f"{proibido} nao e confiavel em cliente de email")

    def test_estilo_e_inline(self):
        self.assertNotIn("<style", self.html, "folha embutida e removida pelo Gmail")

    def test_a_informacao_sobrevive_a_perda_total_de_estilo(self):
        """Degradacao: sem CSS, o resumo textual ainda entrega o resultado."""
        sem_estilo = re.sub(r'style="[^"]*"', "", self.html)
        texto = re.sub(r"<[^>]+>", " ", sem_estilo)
        for n in sorted(NUMEROS):
            self.assertIn(str(n), texto)
        self.assertIn("Powerball", texto)
        self.assertIn(str(MULT), texto, "o Power Play tem de sobreviver")

    def test_o_multiplicador_aparece(self):
        self.assertIn(f"{MULT}x", self.html)

    def test_bolas_de_um_digito_nao_desalinham(self):
        h = S.result_balls_html([1, 2, 3, 4, 5], 9, 2)
        larguras = re.findall(r"width:(\d+)px;height:\1px", h)
        self.assertGreaterEqual(len(larguras), 6,
                                "toda bola precisa de largura e altura fixas e iguais")


class LinkDoEmail(unittest.TestCase):
    def test_o_link_usa_a_origem_canonica(self):
        """`ferrarilabs.github.io` responde 301 -- ver docs/bolao/TEST_ISOLATION.md."""
        self.assertIn("www.ferrarilabs.com", S.SITE_URL)
        self.assertNotIn("github.io", S.SITE_URL,
                         "o link do participante nao pode passar por redirecionamento")

    def test_o_corpo_do_email_nao_carrega_origem_que_redireciona(self):
        import inspect
        corpo = inspect.getsource(S.build_html)
        self.assertNotIn("ferrarilabs.github.io", corpo)


if __name__ == "__main__":
    unittest.main(verbosity=2)
