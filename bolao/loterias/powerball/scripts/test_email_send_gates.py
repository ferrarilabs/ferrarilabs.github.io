#!/usr/bin/env python3
"""
CONTRATO DE PRÉ-ENVIO DO EMAIL POWERBALL — nenhum envio parcial, nunca mais.

POR QUE ESTA SUÍTE EXISTE (incidente real, 2026-08-09):

  12:06 UTC — 15 participantes receberam o resultado do sorteio ANTERIOR (05/08) porque o script
              mantinha uma cópia própria dos sorteios que parava ali.
  12:21 UTC — o reenvio, já com o sorteio certo, alcançou 14 de 15: a fonte de CONTATOS tinha um
              participante a menos que a participação canônica, e ninguém comparava as duas.

O segundo caso é o mais insidioso. Um envio parcial **parece bem sucedido**: o workflow fica verde,
o log diz "14 enviados, 0 falharam", e quem ficou de fora só descobre por acaso. Por isso a regra
passou a ser TUDO-OU-NADA, validada ANTES da primeira chamada ao provedor.

REGRA DESTA SUÍTE: ela NUNCA pode alcançar um provedor real. O `send_email()` tem um guard que
recusa qualquer chamada sem plano autorizado, e há teste explícito disso aqui.

Uso: python3 bolao/loterias/powerball/scripts/test_email_send_gates.py
"""
import os
import sys
import unittest
from pathlib import Path

# Marca a execução como teste ANTES de importar: `resolve_send_mode()` usa isto para garantir que
# um runner de teste jamais resolva para produção, mesmo com a env de produção setada.
os.environ["POWERBALL_TEST_RUN"] = "1"

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib.util

spec = importlib.util.spec_from_file_location("sre", HERE / "send_result_email.py")
sre = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(sre)
except SystemExit:
    pass


def draw_with(participants, result=True, draw_id="2026-08-08"):
    canonical = next((d for d in sre.DRAWS["powerball"] if d["id"] == draw_id), None)
    d = dict(canonical) if canonical else {"id": draw_id, "gameType": "powerball"}
    d["participants"] = [{"name": n} for n in participants]
    if not result:
        d["result"] = None
    return d


def contacts(names):
    # `.invalid` é reservado por RFC 2606 — nunca entregável, nem por acidente.
    return [{"name": n, "email": f"{n.lower().replace(' ', '.')}@example.invalid"} for n in names]


class RecipientCompleteness(unittest.TestCase):
    """A regra tudo-ou-nada: o caso exato do 14/15."""

    def test_14_de_15_bloqueia_com_zero_envios(self):
        canonical = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-08")
        expected = [p["name"] for p in canonical["participants"]]
        self.assertEqual(len(expected), 15, "fixture mudou: o sorteio 08/08 deveria ter 15")
        resolved = [n for n in expected if n != "Rodrigo Hajj"]   # o que realmente aconteceu

        plan, status, problems = sre.build_send_plan(canonical, contacts(resolved), "<html>")
        self.assertIsNone(plan, "gerou plano de envio com destinatário faltando")
        self.assertEqual(status, sre.STATUS_RECIPIENTS_INCOMPLETE)
        self.assertTrue(any("Rodrigo Hajj" in p for p in problems),
                        "o problema deve nomear quem ficou sem contato")

    def test_conjunto_completo_passa(self):
        canonical = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-08")
        expected = [p["name"] for p in canonical["participants"]]
        plan, status, problems = sre.build_send_plan(canonical, contacts(expected), "<html>")
        self.assertIsNone(status, f"bloqueou um conjunto completo: {problems}")
        self.assertEqual(plan["expectedRecipients"], plan["resolvedRecipients"])

    def test_contato_extra_que_nao_participa_bloqueia(self):
        canonical = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-08")
        expected = [p["name"] for p in canonical["participants"]]
        plan, status, problems = sre.build_send_plan(
            canonical, contacts(expected + ["Alguem De Outro Sorteio"]), "<html>")
        self.assertEqual(status, sre.STATUS_RECIPIENTS_INCOMPLETE)
        self.assertTrue(any("NÃO participam" in p for p in problems))

    def test_endereco_duplicado_bloqueia(self):
        canonical = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-08")
        expected = [p["name"] for p in canonical["participants"]]
        recips = contacts(expected)
        recips[1]["email"] = recips[0]["email"]          # mesma pessoa receberia duas vezes
        plan, status, problems = sre.build_send_plan(canonical, recips, "<html>")
        self.assertEqual(status, sre.STATUS_CONTENT_FAILED)
        self.assertTrue(any("duplicado" in p for p in problems))


class DrawIdentityGates(unittest.TestCase):
    def test_sorteio_sem_resultado_nao_envia(self):
        d = draw_with(["Eduardo Ferrari"], result=False, draw_id="2026-08-10")
        plan, status, _ = sre.build_send_plan(d, contacts(["Eduardo Ferrari"]), "<html>")
        self.assertIsNone(plan)
        self.assertEqual(status, sre.STATUS_DRAW_NOT_FINAL)

    def test_alvo_fora_da_fonte_canonica_bloqueia(self):
        d = {"id": "2026-12-31", "gameType": "powerball",
             "participants": [{"name": "Eduardo Ferrari"}],
             "result": {"numbers": [1, 2, 3, 4, 5], "special": 6, "multiplier": 1}}
        plan, status, problems = sre.build_send_plan(d, contacts(["Eduardo Ferrari"]), "<html>")
        self.assertEqual(status, sre.STATUS_CONTENT_FAILED)
        self.assertTrue(any("canônica" in p for p in problems))

    def test_resultado_divergente_da_fonte_canonica_bloqueia(self):
        canonical = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-08")
        d = dict(canonical)
        d["result"] = dict(canonical["result"])
        d["result"]["numbers"] = [1, 2, 3, 4, 5]      # divergente do site
        names = [p["name"] for p in canonical["participants"]]
        plan, status, problems = sre.build_send_plan(d, contacts(names), "<html>")
        self.assertEqual(status, sre.STATUS_CONTENT_FAILED)
        self.assertTrue(any("divergente" in p for p in problems))

    def test_identidade_de_idempotencia_e_deterministica(self):
        canonical = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-08")
        names = [p["name"] for p in canonical["participants"]]
        a, _, _ = sre.build_send_plan(canonical, contacts(names), "<html>")
        b, _, _ = sre.build_send_plan(canonical, contacts(names), "<html>")
        self.assertEqual(a["logicalSendId"], b["logicalSendId"])
        self.assertEqual(a["contentHash"], b["contentHash"])

    def test_sorteios_diferentes_geram_identidades_diferentes(self):
        d8 = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-08")
        d5 = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-05")
        a, _, _ = sre.build_send_plan(d8, contacts([p["name"] for p in d8["participants"]]), "<html>")
        b, _, _ = sre.build_send_plan(d5, contacts([p["name"] for p in d5["participants"]]), "<html>")
        self.assertNotEqual(a["logicalSendId"], b["logicalSendId"],
                            "dois sorteios com a mesma identidade de envio — foi assim que o "
                            "resultado do sorteio errado saiu como se fosse novo")


class SendModeFailsClosed(unittest.TestCase):
    def test_sem_env_o_modo_e_dry_run(self):
        os.environ.pop("POWERBALL_EMAIL_MODE", None)
        self.assertEqual(sre.resolve_send_mode(["prog", "--send-all"]), sre.MODE_DRY_RUN)

    def test_env_desconhecida_e_dry_run(self):
        os.environ["POWERBALL_EMAIL_MODE"] = "seila"
        self.assertEqual(sre.resolve_send_mode(["prog", "--send-all"]), sre.MODE_DRY_RUN)

    def test_producao_exige_DUAS_condicoes(self):
        os.environ["POWERBALL_EMAIL_MODE"] = "production"
        # Só a env, sem --send-all: não é produção.
        self.assertEqual(sre.resolve_send_mode(["prog"]), sre.MODE_DRY_RUN)

    def test_runner_de_teste_nunca_alcanca_producao(self):
        os.environ["POWERBALL_EMAIL_MODE"] = "production"
        os.environ["POWERBALL_TEST_RUN"] = "1"
        self.assertEqual(sre.resolve_send_mode(["prog", "--send-all"]), sre.MODE_DRY_RUN,
                         "um runner de teste conseguiu resolver modo produção")

    def test_dry_run_vence_tudo(self):
        os.environ["POWERBALL_EMAIL_MODE"] = "production"
        self.assertEqual(sre.resolve_send_mode(["prog", "--send-all", "--dry-run"]), sre.MODE_DRY_RUN)


class ProviderIsolation(unittest.TestCase):
    """A suíte não pode alcançar o provedor nem por acidente."""

    def test_send_email_recusa_sem_plano_autorizado(self):
        sre._SEND_AUTHORIZED["ok"] = False
        ok, msg = sre.send_email("alguem@example.invalid", "assunto", "<html>")
        self.assertFalse(ok)
        self.assertIn("BLOQUEADO", msg)

    def test_authorize_send_recusa_fora_de_producao(self):
        self.assertFalse(sre.authorize_send({"targetDraw": "x"}, sre.MODE_DRY_RUN))
        self.assertFalse(sre.authorize_send(None, sre.MODE_PRODUCTION))

    def test_plano_nao_vaza_endereco(self):
        canonical = next(d for d in sre.DRAWS["powerball"] if d["id"] == "2026-08-08")
        names = [p["name"] for p in canonical["participants"]]
        plan, _, _ = sre.build_send_plan(canonical, contacts(names), "<html>")
        blob = repr(plan)
        self.assertNotIn("@", blob, "o plano de envio contém endereço — ele vai para log de workflow")


class NoParallelDrawSource(unittest.TestCase):
    def test_sorteios_vem_do_data_js(self):
        ids = [d["id"] for d in sre.DRAWS["powerball"]]
        self.assertIn("2026-08-08", ids)
        self.assertIn("2026-08-10", ids, "o script não enxerga o sorteio mais novo do data.js")

    def test_replay_historico_escolhe_o_alvo_certo(self):
        # Com 08/10 em aberto (sem resultado), o alvo tem de continuar sendo 08/08.
        active = sre.get_active_draw("powerball")
        self.assertEqual(active["id"], "2026-08-08",
                         "get_active_draw escolheu o sorteio errado — foi esse cálculo que mandou "
                         "o resultado de 05/08 em 2026-08-09")


if __name__ == "__main__":
    unittest.main(verbosity=2)
