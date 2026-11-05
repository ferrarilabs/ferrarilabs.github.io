"""
test_megamillions_game.py — o site e a abertura tratam a Mega Millions como o jogo que ela e.

A prizeTable do data.js tem de bater centavo a centavo com a matriz de config/lottery_policy.json
(conferida contra o megamillions.com por verify_mm_matrix.py), e toda aposta de Mega Millions tem
de trazer o proprio multiplicador. Sem ele, a conferencia pagaria o valor base em silencio.

Executar: python3 test_megamillions_game.py
"""

import json
import os
import subprocess
import sys
import unittest
from datetime import date
from unittest import mock

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, "..", "..", "scripts"))

import lottery_core as L  # noqa: E402
import open_next_draw as O  # noqa: E402
import refresh_jackpot as R  # noqa: E402

DATA_JS = os.path.join(AQUI, "..", "js", "data.js")


def no_node(corpo, *args):
    prefixo = ("const fs=require('fs'),vm=require('vm');const sb={window:{}};vm.createContext(sb);"
               "vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),sb);const w=sb.window;"
               "const argv=process.argv.slice(2);")
    saida = subprocess.run(["node", "-e", prefixo + corpo, DATA_JS, *args],
                           capture_output=True, text=True, timeout=20)
    return saida.returncode, saida.stdout, saida.stderr


class PrizeTable(unittest.TestCase):
    def test_todas_as_faixas_e_multiplicadores_batem_com_a_politica(self):
        g = L.carrega_config()["games"]["megamillions"]
        pedidos = []
        for f in g["prizeMatrix"]:
            if f["baseCents"] is None:
                continue
            pedidos.append([f["main"], f["special"], 1, f["label"], f["baseCents"]])
            for m, cents in f["byMultiplier"].items():
                pedidos.append([f["main"], f["special"], int(m), f["label"], cents])
        self.assertEqual(len(pedidos), 8 * 6)
        cod, out, err = no_node(
            "const gt=w.LOTTERY_GAME_TYPES.megamillions;"
            "process.stdout.write(JSON.stringify(JSON.parse(argv[0]).map(p=>gt.prizeTable(p[0],p[1],p[2]))))",
            json.dumps(pedidos))
        self.assertEqual(cod, 0, err)
        for p, r in zip(pedidos, json.loads(out)):
            self.assertEqual((r["label"], r["amount"] * 100), (p[3], p[4]), p)

    def test_jackpot_e_sem_premio(self):
        cod, out, err = no_node(
            "const gt=w.LOTTERY_GAME_TYPES.megamillions;"
            "process.stdout.write(JSON.stringify([gt.prizeTable(5,true,2),gt.prizeTable(2,false,10),gt.prizeTable(0,false,2)]))")
        self.assertEqual(cod, 0, err)
        self.assertEqual(json.loads(out), [{"label": "JACKPOT", "amount": None}, None, None])

    def test_multiplicador_fora_da_matriz_ou_ausente_recusa(self):
        for mult in ("7", "null"):
            cod, _, err = no_node(f"w.LOTTERY_GAME_TYPES.megamillions.prizeTable(3,true,{mult})")
            self.assertNotEqual(cod, 0, mult)
            self.assertIn("MULTIPLICADOR_FORA_DA_MATRIZ", err)

    def test_powerball_continua_com_a_mesma_tabela(self):
        cod, out, err = no_node(
            "const gt=w.LOTTERY_GAME_TYPES.powerball;"
            "process.stdout.write(JSON.stringify([gt.prizeTable(1,true,2),gt.prizeTable(5,false,3),gt.multiplierLabel]))")
        self.assertEqual(cod, 0, err)
        self.assertEqual(json.loads(out), [{"label": "1 + Powerball", "amount": 8},
                                           {"label": "5 acertos", "amount": 2000000}, "Power Play"])


class FormatoDaAposta(unittest.TestCase):
    def _parse(self, s):
        cod, out, err = no_node("process.stdout.write(JSON.stringify(w.LOTTERY_TICKETS.parse(argv[0])))", s)
        self.assertEqual(cod, 0, err)
        return json.loads(out)

    def test_powerball_e_mega_millions(self):
        self.assertEqual(self._parse("01-14-27-63-64 — PB 25"),
                         {"numbers": [1, 14, 27, 63, 64], "code": "PB", "special": 25, "multiplier": None})
        self.assertEqual(self._parse("01-14-27-63-70 — MB 24 — 10X"),
                         {"numbers": [1, 14, 27, 63, 70], "code": "MB", "special": 24, "multiplier": 10})

    def test_formato_estranho_nao_vira_aposta(self):
        for s in ("01-14-27-63-64", "01-14-27-63-64 — XX 1", "01-14-27-63-64 — MB 2 — 3"):
            self.assertIsNone(self._parse(s), s)

    def test_toda_aposta_gravada_e_valida_para_o_jogo_do_sorteio(self):
        """Gate de dado: pega linha de bilhete errada antes de ela virar premio errado."""
        cod, out, err = no_node(
            "process.stdout.write(JSON.stringify(w.POWERBALL_DRAWS.flatMap(d=>"
            "((d.sharedTickets||{}).series||[]).flatMap(s=>(s.numeros||[]).map(n=>"
            "({id:d.id,game:d.gameType,linha:n,t:w.LOTTERY_TICKETS.parse(n)}))))))")
        self.assertEqual(cod, 0, err)
        cfg = L.carrega_config()["games"]
        linhas = json.loads(out)
        self.assertGreater(len(linhas), 100)
        for l in linhas:
            t, g = l["t"], cfg[l["game"]]
            self.assertIsNotNone(t, l)
            self.assertEqual(t["code"], "MB" if l["game"] == "megamillions" else "PB", l)
            self.assertEqual(len(set(t["numbers"])), 5, l)
            self.assertTrue(all(g["mainRange"][0] <= n <= g["mainRange"][1] for n in t["numbers"]), l)
            self.assertTrue(g["specialRange"][0] <= t["special"] <= g["specialRange"][1], l)
            if g.get("builtInMultiplier"):
                self.assertIn(t["multiplier"], g["multiplierValues"], l)
            else:
                self.assertIsNone(t["multiplier"], l)


class Abertura(unittest.TestCase):
    def test_calendario_de_cada_jogo(self):
        qua = date(2026, 11, 4)
        self.assertEqual(O.proximo_dia_de_sorteio(qua, "megamillions"), date(2026, 11, 6))
        self.assertEqual(O.proximo_dia_de_sorteio(qua, "powerball"), date(2026, 11, 7))
        self.assertEqual(O.proximo_dia_de_sorteio(date(2026, 11, 6), "megamillions"), date(2026, 11, 10))

    def test_bloco_de_mega_millions(self):
        b = O.bloco_do_sorteio("2026-11-06", "2026-11-04", 16, 505000000, 213300000, "megamillions")
        for trecho in ('gameType: "megamillions"', 'name: "Mega Millions Jackpot"', "valorPorTicket: 5,",
                       'drawDateIso: "2026-11-06T23:00:00-05:00"', 'drawDateLabel: "06/11/2026 23:00 ET"',
                       "creditoSorteioAnterior: 16,", "jackpot: 505000000,", "participants: [],"):
            self.assertIn(trecho, b)
        self.assertNotIn("Powerball", b)

    def test_fuso_acompanha_o_horario_de_verao(self):
        verao = O.bloco_do_sorteio("2026-10-31", "x", 0, None, None)
        inverno = O.bloco_do_sorteio("2026-11-07", "x", 0, None, None)
        self.assertIn('"2026-10-31T22:59:00-04:00"', verao)
        self.assertIn('"2026-11-07T22:59:00-05:00"', inverno)
        self.assertIn("valorPorTicket: 3,", inverno)


class AtualizaJackpot(unittest.TestCase):
    ABERTO = {"id": "2026-11-06", "gameType": "megamillions", "result": None,
              "drawing": {"jackpot": 505000000, "cashValue": 213300000}}

    def _roda(self, resposta):
        with mock.patch.object(R, "carrega_draws", return_value=[self.ABERTO]), \
                mock.patch.object(R, "busca_proximo_mega_millions", return_value=resposta) as mm, \
                mock.patch.object(R, "busca_proximo_sorteio", side_effect=AssertionError("fonte da Powerball")), \
                mock.patch.object(sys, "argv", ["refresh_jackpot.py", "--dry-run"]):
            return R.main(), mm

    def test_mega_millions_usa_a_fonte_dela(self):
        cod, mm = self._roda(("2026-11-06", 505000000, 213300000, None))
        self.assertEqual(cod, 0)
        mm.assert_called_once()

    def test_data_de_outro_sorteio_recusa(self):
        cod, _ = self._roda(("2026-11-10", 900000000, 400000000, None))
        self.assertEqual(cod, 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
