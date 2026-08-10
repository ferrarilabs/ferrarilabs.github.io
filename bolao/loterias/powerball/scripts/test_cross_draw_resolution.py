"""
test_cross_draw_resolution.py — resolucao de contato entre sorteios.

O segredo e {draw_id: {nome: {campos}}}. Um sorteio novo no data.js sem a entrada correspondente
no segredo produz RESOLVED = 0 e bloqueia o envio inteiro -- silenciosamente, ate alguem olhar o
log. Foi o que o preflight de 2026-08-10 encontrou.

Como o endereco de uma pessoa nao muda entre sorteios, os nomes faltantes sao resolvidos pelas
entradas dos outros sorteios. A propriedade que torna isso seguro, e que estes testes protegem:
ENDERECO DIVERGENTE ENTRE SORTEIOS NAO E RESOLVIDO. Adivinhar mandaria o resultado de dinheiro
real para o endereco errado.

Executar: POWERBALL_TEST_RUN=1 python3 test_cross_draw_resolution.py
"""

import json
import os
import sys
import unittest

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import send_result_email as S

# Fixtures com dominio reservado (RFC 2606) -- nunca um endereco real.
ANA = "ana@example.invalid"
BRUNO = "bruno@example.invalid"


def segredo(d):
    os.environ["POWERBALL_PRIVATE_PARTICIPANT_DATA"] = json.dumps(d)


class ResolucaoEntreSorteios(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("POWERBALL_PRIVATE_PARTICIPANT_DATA", None)

    def nomes(self, participantes):
        return {p.get("name") or p.get("nome") for p in participantes or []}

    def test_entrada_propria_tem_prioridade(self):
        segredo({"2026-08-12": {"Ana": {"email": ANA}},
                 "2026-08-10": {"Ana": {"email": "antigo@example.invalid"}}})
        r = S.load_participants_from_private_env("2026-08-12")
        self.assertEqual([p["email"] for p in r], [ANA],
                         "existindo entrada propria, nao se olha para outros sorteios")

    def test_sorteio_sem_entrada_resolve_pelos_outros(self):
        segredo({"2026-08-08": {"Ana": {"email": ANA}, "Bruno": {"email": BRUNO}}})
        r = S.load_participants_from_private_env("2026-08-12")
        self.assertEqual(self.nomes(r), {"Ana", "Bruno"},
                         "sorteio novo sem entrada no segredo tem de resolver pelos anteriores")

    def test_endereco_divergente_nao_e_resolvido(self):
        """A propriedade central: na duvida, ninguem e escolhido."""
        segredo({"2026-08-05": {"Ana": {"email": ANA}},
                 "2026-08-08": {"Ana": {"email": "outro@example.invalid"}}})
        r = S.load_participants_from_private_env("2026-08-12")
        self.assertEqual(self.nomes(r), set(),
                         "endereco divergente entre sorteios nao pode ser adivinhado")

    def test_divergencia_de_um_nao_derruba_os_demais(self):
        segredo({"2026-08-05": {"Ana": {"email": ANA}, "Bruno": {"email": BRUNO}},
                 "2026-08-08": {"Ana": {"email": "outro@example.invalid"}}})
        r = S.load_participants_from_private_env("2026-08-12")
        self.assertEqual(self.nomes(r), {"Bruno"},
                         "so o nome ambiguo fica de fora")

    def test_endereco_repetido_em_varios_sorteios_e_consistente(self):
        segredo({"2026-08-03": {"Ana": {"email": ANA}},
                 "2026-08-05": {"Ana": {"email": ANA}},
                 "2026-08-08": {"Ana": {"email": ANA}}})
        r = S.load_participants_from_private_env("2026-08-12")
        self.assertEqual([p["email"] for p in r], [ANA],
                         "mesmo endereco repetido nao e divergencia")

    def test_segredo_vazio_nao_inventa_ninguem(self):
        segredo({})
        self.assertEqual(S.load_participants_from_private_env("2026-08-12") or [], [])

    def test_nome_sem_email_nao_e_resolvido(self):
        segredo({"2026-08-08": {"Ana": {"cotas": 2}}})
        self.assertEqual(self.nomes(S.load_participants_from_private_env("2026-08-12")), set())

    def test_fixtures_nao_usam_dominio_real(self):
        """Gate de PII sobre este proprio arquivo: ja flagrei fixture com dominio real duas vezes."""
        src = open(__file__, encoding="utf-8").read()
        import re
        for dominio in set(re.findall(r"@([a-z0-9.\-]+)", src)):
            self.assertTrue(dominio.endswith(".invalid") or dominio.endswith("example.com"),
                            f"fixture usa dominio real: {dominio}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
