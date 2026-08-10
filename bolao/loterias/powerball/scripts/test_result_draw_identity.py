"""
test_result_draw_identity.py — P0 de 2026-08-10. O resultado precisa ser DAQUELE sorteio.

─── O INCIDENTE ────────────────────────────────────────────────────────────────────────────────

`fetch_and_send_results.py` pedia à API `$order=draw_date DESC&$limit=1`, descartava o
`draw_date` no parse, e aplicava o que voltasse ao último sorteio incompleto. No lugar da
verificação havia um comentário:

    # Check if official result matches the target draw's date
    # For now, assume the latest API result is for the incomplete draw

Reproduzido às 15:11 ET de 2026-08-10: a fonte devolvia o resultado de **08/08**
(`[5,9,35,54,63] PB 7`) e existiam **dois** sorteios incompletos — 08/08 e 08/10. Como
`get_last_incomplete_draw` itera em `reversed(draws)`, o alvo seria o **08/10**: o resultado do
dia 8 seria gravado no sorteio do dia 10, com prêmio calculado contra os bilhetes errados e
e-mail anunciando números que não são daquele sorteio. O 08/08 ficaria sem resultado para sempre.

Dois invariantes independentes, ambos obrigatórios:

  IDENTIDADE — o `draw_date` da fonte tem de ser igual ao `id` do sorteio alvo.
  TEMPO      — `agora >= drawDateIso + carência de publicação`.

Nenhum dos dois substitui o outro: a fonte pode publicar cedo por engano, e a identidade pode
casar num sorteio que ainda não ocorreu.

Executar: POWERBALL_TEST_RUN=1 python3 test_result_draw_identity.py
"""

import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_and_send_results as F

ALVO = "2026-08-10"
ISO = "2026-08-10T22:59:00-04:00"
DEPOIS = datetime.fromisoformat(ISO) + timedelta(minutes=30)
ANTES = datetime.fromisoformat(ISO) - timedelta(hours=4)


def sorteio(draw_id=ALVO, iso=ISO, result=None):
    d = {"id": draw_id, "drawing": {"drawDateIso": iso, "drawDateLabel": "x"},
         "participants": [{"nome": "P"}]}
    if result:
        d["result"] = result
    return d


def fonte(rows):
    """Substitui a rede: devolve linhas cruas como a API da NY Lottery devolveria."""
    def fake(url, timeout=0):
        import io, json
        class R:
            def __enter__(s): return s
            def __exit__(s, *a): return False
            def read(s): return json.dumps(rows).encode()
        return R()
    return fake


class Identidade(unittest.TestCase):
    def setUp(self):
        self._orig = F.urllib.request.urlopen

    def tearDown(self):
        F.urllib.request.urlopen = self._orig

    def test_1_resultado_anterior_ainda_e_o_mais_recente(self):
        """O caso real: alvo 08/10, fonte só tem 08/08. Tem de recusar."""
        F.urllib.request.urlopen = fonte([
            {"draw_date": "2026-08-08T00:00:00.000", "winning_numbers": "05 09 35 54 63 07", "multiplier": "3"}])
        r, status = F.fetch_official_result("powerball", ALVO)
        self.assertIsNone(r, "resultado de outro sorteio nunca pode ser aceito")
        self.assertEqual(status, "NOT_READY")

    def test_2_escolhe_exatamente_a_data_alvo(self):
        F.urllib.request.urlopen = fonte([
            {"draw_date": "2026-08-08T00:00:00.000", "winning_numbers": "05 09 35 54 63 07", "multiplier": "3"},
            {"draw_date": "2026-08-10T00:00:00.000", "winning_numbers": "01 02 03 04 05 06", "multiplier": "2"}])
        r, status = F.fetch_official_result("powerball", ALVO)
        self.assertEqual(status, "OK")
        self.assertEqual(r["drawDate"], ALVO)
        self.assertEqual(r["numbers"], [1, 2, 3, 4, 5])

    def test_3_sorteio_futuro_devolvido_por_engano_e_ignorado(self):
        F.urllib.request.urlopen = fonte([
            {"draw_date": "2026-08-12T00:00:00.000", "winning_numbers": "01 02 03 04 05 06", "multiplier": "2"}])
        r, status = F.fetch_official_result("powerball", ALVO)
        self.assertIsNone(r)
        self.assertEqual(status, "NOT_READY")

    def test_4_antes_da_hora_do_sorteio_recusa(self):
        ok, porque = F.draw_has_occurred(sorteio(), now=ANTES)
        self.assertFalse(ok, "resultado antes da hora oficial nao pode ser aceito")
        self.assertIn("liberado a partir de", porque)

    def test_5_depois_da_hora_com_resultado_valido_e_aceito(self):
        ok, _ = F.draw_has_occurred(sorteio(), now=DEPOIS)
        self.assertTrue(ok)
        F.urllib.request.urlopen = fonte([
            {"draw_date": "2026-08-10T00:00:00.000", "winning_numbers": "01 02 03 04 05 06", "multiplier": "2"}])
        r, status = F.fetch_official_result("powerball", ALVO)
        self.assertEqual(status, "OK")
        valido, motivo = F.validate_result("powerball", r)
        self.assertTrue(valido, motivo)

    def test_6_sem_data_na_fonte_recusa(self):
        F.urllib.request.urlopen = fonte([
            {"winning_numbers": "01 02 03 04 05 06", "multiplier": "2"}])
        r, status = F.fetch_official_result("powerball", ALVO)
        self.assertIsNone(r)

    def test_7_datas_duplicadas_falham_fechado(self):
        F.urllib.request.urlopen = fonte([
            {"draw_date": "2026-08-10T00:00:00.000", "winning_numbers": "01 02 03 04 05 06", "multiplier": "2"},
            {"draw_date": "2026-08-10T00:00:00.000", "winning_numbers": "09 08 07 06 05 04", "multiplier": "3"}])
        r, status = F.fetch_official_result("powerball", ALVO)
        self.assertIsNone(r, "ambiguidade da fonte nao se resolve escolhendo um")
        self.assertEqual(status, "AMBIGUOUS_UPSTREAM_RESULT")

    def test_carencia_de_publicacao_e_aplicada(self):
        """Exatamente no instante do sorteio ainda nao vale: a fonte precisa publicar."""
        no_ponto = datetime.fromisoformat(ISO)
        ok, _ = F.draw_has_occurred(sorteio(), now=no_ponto)
        self.assertFalse(ok)
        ok2, _ = F.draw_has_occurred(sorteio(), now=no_ponto + timedelta(minutes=11))
        self.assertTrue(ok2)

    def test_sorteio_sem_iso_canonico_falha_fechado(self):
        ok, porque = F.draw_has_occurred({"id": ALVO, "participants": [1]}, now=DEPOIS)
        self.assertFalse(ok, "sem instante canonico nao ha portao temporal")


class Validacao(unittest.TestCase):
    def bom(self, **over):
        return dict({"numbers": [1, 2, 3, 4, 5], "special": 7, "multiplier": 2}, **over)

    def test_resultado_bom_passa(self):
        self.assertTrue(F.validate_result("powerball", self.bom())[0])

    def test_quantidade_errada(self):
        self.assertFalse(F.validate_result("powerball", self.bom(numbers=[1, 2, 3]))[0])

    def test_numeros_repetidos(self):
        self.assertFalse(F.validate_result("powerball", self.bom(numbers=[1, 1, 3, 4, 5]))[0])

    def test_fora_da_faixa(self):
        self.assertFalse(F.validate_result("powerball", self.bom(numbers=[1, 2, 3, 4, 70]))[0])

    def test_powerball_fora_da_faixa(self):
        self.assertFalse(F.validate_result("powerball", self.bom(special=27))[0])

    def test_nao_normalizado(self):
        self.assertFalse(F.validate_result("powerball", self.bom(numbers=[5, 4, 3, 2, 1]))[0])

    def test_multiplicador_absurdo(self):
        self.assertFalse(F.validate_result("powerball", self.bom(multiplier=99))[0])


class AutorizacaoDeEnvio(unittest.TestCase):
    def test_12_sem_modo_producao_nao_ha_chamada_ao_provedor(self):
        """O sender do Powerball ja falha fechado; este teste trava a garantia por escrito."""
        import send_result_email as S
        modo = getattr(S, "_SEND_AUTHORIZED", None) or getattr(S, "real_send_allowed", None)
        self.assertIsNotNone(modo, "o sender perdeu a trava de autorizacao explicita")



class EntregaParcialHistorica(unittest.TestCase):
    """POWERBALL_PARTIAL_HISTORICAL_DELIVERY_RECOVERY.

    Caso real: em 2026-08-09 o resultado de 08/08 saiu para 14 dos 15 participantes. O Eduardo
    confirmou pelo Gmail SENT que Rodrigo Hajj nao recebeu. O ledger nao existia entao; o estado
    foi reconstruido dos fatos na migracao 019.

    O que estes testes impedem: uma automacao que, vendo o job incompleto, reenvie para todos.
    Isso entregaria o mesmo e-mail duas vezes a 14 pessoas reais.

    Exercitam as FUNCOES DE PRODUCAO (retryable_recipients / settle) com o banco substituido --
    uma versao que filtra uma lista montada aqui dentro nao provaria nada sobre o codigo que roda.
    """

    LEDGER_0808 = {"rows": [{"r": (
        [{"entryRef": f"Participante {i}", "state": "ACCEPTED",
          "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE", "providerMessageId": None}
         for i in range(14)]
        + [{"entryRef": "Rodrigo Hajj", "state": "PENDING"}])}]}

    def fake_sql(self, retorno):
        """Substitui o acesso ao banco preservando o formato de saida da CLI."""
        import powerball_notification as P
        gravacoes = []

        def _sql(stmt):
            if stmt.strip().lower().startswith("update"):
                gravacoes.append(stmt)
                return ""
            return json.dumps(retorno)

        self._orig_sql = P._sql
        P._sql = _sql
        self.addCleanup(lambda: setattr(P, "_sql", self._orig_sql))
        return gravacoes

    def test_catchup_alveja_somente_quem_nao_recebeu(self):
        import powerball_notification as P
        self.fake_sql(self.LEDGER_0808)
        alvos = P.retryable_recipients("2026-08-08")
        self.assertEqual(alvos, ["Rodrigo Hajj"])
        self.assertEqual(len(alvos), 1, "PROVIDER_CALLS tem de ser 1, jamais 15")

    def test_nenhum_dos_14_entregues_entra_no_retry(self):
        import powerball_notification as P
        self.fake_sql(self.LEDGER_0808)
        alvos = P.retryable_recipients("2026-08-08")
        for i in range(14):
            self.assertNotIn(f"Participante {i}", alvos,
                             "quem ja recebeu jamais pode ser reenviado")

    def test_job_com_um_pendente_nunca_deriva_para_sent(self):
        import powerball_notification as P
        gravacoes = self.fake_sql(self.LEDGER_0808)
        r = P.settle("2026-08-08")
        self.assertEqual(r["accepted"], 14)
        self.assertEqual(r["total"], 15)
        self.assertNotEqual(r["status"], P.SENT, "14 de 15 nunca pode virar SENT")
        self.assertEqual(r["status"], P.FAILED_RETRYABLE)
        self.assertTrue(gravacoes, "settle precisa persistir o estado derivado")
        self.assertNotIn("'sent'::bolao_notif_status", gravacoes[0])

    def test_so_apos_o_15o_aceite_o_job_conclui(self):
        import powerball_notification as P
        completo = {"rows": [{"r": [{"entryRef": f"P{i}", "state": "ACCEPTED"}
                                    for i in range(15)]}]}
        self.fake_sql(completo)
        self.assertEqual(P.settle("2026-08-08")["status"], P.SENT)

    def test_incerto_trava_para_revisao_humana_em_vez_de_reenviar(self):
        import powerball_notification as P
        incerto = {"rows": [{"r": [{"entryRef": "P1", "state": "ACCEPTED"},
                                   {"entryRef": "P2", "state": "UNCERTAIN"}]}]}
        self.fake_sql(incerto)
        r = P.settle("2026-08-08")
        self.assertEqual(r["status"], P.FAILED_PERMANENT)
        self.assertIn("revisao humana", r["reason"])
        self.fake_sql(incerto)
        self.assertNotIn("P2", P.retryable_recipients("2026-08-08"),
                         "UNCERTAIN nunca e reenviado automaticamente")


if __name__ == "__main__":
    unittest.main(verbosity=2)
