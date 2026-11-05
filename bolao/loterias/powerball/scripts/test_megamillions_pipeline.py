"""
test_megamillions_pipeline.py — um sorteio de Mega Millions do bilhete ao livro-razao.

Monta um sorteio ficticio com uma aposta por combinacao de faixa e multiplicador e exige que TODOS
os calculadores cheguem ao mesmo numero: o motor do livro, o Node que grava o resultado e o que o
e-mail renderiza. Cada um ja teve a sua propria regex; uma aposta "— MB 12 — 3X" que um deles nao
entende some em silencio e vira premio a menos.

Executar: POWERBALL_TEST_RUN=1 python3 test_megamillions_pipeline.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

os.environ["POWERBALL_TEST_RUN"] = "1"
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, "..", "..", "scripts"))

import fetch_and_send_results as F  # noqa: E402
import lottery_core as L  # noqa: E402
import send_result_email as M  # noqa: E402
import settle_draw as SD  # noqa: E402

OFICIAL = {"numbers": [4, 24, 31, 62, 70], "special": 3, "multiplier": 1}
BRANCOS = OFICIAL["numbers"]
OUTROS = [1, 2, 5, 6, 7]
MULTS = [2, 3, 4, 5, 10]
# (brancas certas, Mega Ball certa) de todas as faixas com valor fixo.
FAIXAS = [(5, False), (4, True), (4, False), (3, True), (3, False), (2, True), (1, True), (0, True)]


def linha(certas, bola, mult):
    nums = sorted(BRANCOS[:certas] + OUTROS[:5 - certas])
    return f"{'-'.join(f'{n:02d}' for n in nums)} — MB {3 if bola else 9:02d} — {mult}X"


APOSTAS = [linha(c, b, m) for c, b in FAIXAS for m in MULTS] + [linha(2, False, 10), linha(0, False, 2)]
ESPERADO = 0
for faixa in L.carrega_config()["games"]["megamillions"]["prizeMatrix"]:
    if faixa["baseCents"] is not None:
        ESPERADO += sum(faixa["byMultiplier"][str(m)] for m in MULTS)
ESPERADO //= 100

DRAW = {
    "id": "2030-01-04", "gameType": "megamillions", "previousDrawId": "2030-01-01",
    "drawing": {"name": "Mega Millions Jackpot", "jackpot": 505000000, "cashValue": 213300000,
                "drawDateIso": "2030-01-04T23:00:00-05:00", "drawDateLabel": "04/01/2030 23:00 ET"},
    "participants": [{"name": "Teste", "cotas": 1, "valor": 210, "metodo": "Zelle"}],
    "sharedTickets": {"compradoPor": "Teste", "dataComprovante": "04/01/2030", "valorPorTicket": 5,
                      "series": [{"serial": "T", "qtd": len(APOSTAS), "numeros": APOSTAS}]},
    "finance": {"totalArrecadado": 210, "creditoSorteioAnterior": 0, "valorUtilizado": 210,
                "valorGuardadoProximoSorteio": 0},
    "result": None, "profit": None,
}


class Calculadores(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        real = F.DATA_JS_PATH
        fonte = open(real, encoding="utf-8").read()
        fim = fonte.index("\n];")
        cls.data_js = os.path.join(cls.dir, "data.js")
        with open(cls.data_js, "w", encoding="utf-8") as g:
            g.write(fonte[:fim] + ",\n" + json.dumps(DRAW, ensure_ascii=False) + fonte[fim:])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir)

    def test_a_soma_esperada_cobre_a_matriz_inteira(self):
        self.assertEqual(len(APOSTAS), 42)
        self.assertGreater(ESPERADO, 10_000_000)

    def test_node_do_resultado_igual_ao_motor(self):
        with mock.patch.object(F, "DATA_JS_PATH", self.data_js):
            premio = F.compute_prize_via_node(DRAW["id"], OFICIAL)
        self.assertIsNotNone(premio)
        self.assertEqual(premio["total"], ESPERADO)
        self.assertFalse(premio["jackpotHit"])

    def test_motor_do_livro_e_liquidacao(self):
        draw = json.loads(json.dumps(DRAW))
        draw["result"] = {**OFICIAL, "premiosGanhos": ESPERADO}
        livro = os.path.join(self.dir, "l.jsonl")
        rel = SD.liquida(draw, None, ledger=livro, verificar_ao_vivo=False)
        self.assertEqual(rel["premio"]["totalCents"], ESPERADO * 100)
        tipos = {e["idempotencyKey"].split(":")[0]: e for e in L.le_ledger(livro)}
        self.assertEqual(tipos["tickets"]["amountCents"], -len(APOSTAS) * 500)
        self.assertIn("tickets:megamillions:", tipos["tickets"]["idempotencyKey"])
        self.assertIn("prize:megamillions:", tipos["prize"]["idempotencyKey"])

    def test_aposta_sem_multiplicador_nao_liquida(self):
        draw = json.loads(json.dumps(DRAW))
        draw["sharedTickets"]["series"][0]["numeros"].append("01-02-05-06-07 — MB 03")
        with self.assertRaisesRegex(RuntimeError, "APOSTA_SEM_MULTIPLICADOR"):
            SD.apostas_do_sorteio(draw)

    def test_aposta_sem_multiplicador_nao_grava_resultado(self):
        fonte = open(self.data_js, encoding="utf-8").read().replace(APOSTAS[0], APOSTAS[0].rsplit(" — ", 1)[0])
        ruim = os.path.join(self.dir, "ruim.js")
        open(ruim, "w", encoding="utf-8").write(fonte)
        with mock.patch.object(F, "DATA_JS_PATH", ruim):
            self.assertIsNone(F.compute_prize_via_node(DRAW["id"], OFICIAL))

    def test_e_mail_renderizado_igual_ao_motor(self):
        script = """
import { allTicketsForDraw, computeTicketResults } from %s;
import fs from "node:fs"; import vm from "node:vm";
const sb = { window: {} }; vm.createContext(sb); vm.runInContext(fs.readFileSync(process.argv[1], "utf8"), sb);
const d = sb.window.POWERBALL_DRAWS.find((x) => x.id === process.argv[2]);
const off = JSON.parse(process.argv[3]);
const r = computeTicketResults(allTicketsForDraw(d), off, sb.window.LOTTERY_GAME_TYPES[d.gameType].prizeTable);
process.stdout.write(JSON.stringify({ n: r.length, total: r.reduce((s, t) => s + (t.prizeAmount || 0), 0) }));
""" % json.dumps(os.path.join(AQUI, "email", "payload.mjs"))
        saida = subprocess.run(["node", "--input-type=module", "-e", script, "--", self.data_js, DRAW["id"], json.dumps(OFICIAL)],
                               capture_output=True, text=True, timeout=30)
        self.assertEqual(saida.returncode, 0, saida.stderr)
        self.assertEqual(json.loads(saida.stdout), {"n": 42, "total": ESPERADO})


class Bilhetes(unittest.TestCase):
    """Bilhetes publicados: lista, manifesto, CSV, correcao e e-mail, com o multiplicador junto."""

    def test_publicacao_mantem_os_bilhetes_e_o_multiplicador(self):
        script = """
import { ticketsFromDraw } from %s;
import { manifestToCsv } from %s;
import { computeTicketDiff } from %s;
import { renderDrawResultText } from %s;
const draw = { sharedTickets: { series: [{ serial: "S", numeros: ["01-02-03-04-70 — MB 24 — 3X", "05-06-07-08-09 — MB 01 — 10X"] }] } };
const t = ticketsFromDraw(draw);
const csv = manifestToCsv({ poolId: "megamillions", drawId: "d", publicationVersion: 1, sha256: "h", tickets: t });
const outro = [{ ...t[0], multiplier: 10 }, t[1]];
const texto = renderDrawResultText({ poolId: "megamillions", official: { numbers: [1, 2, 3, 4, 70], special: 24, multiplier: 1 },
  financialSummary: {}, individualParticipation: { shares: 1, percentage: 100, individualEstimatedPrize: 10 }, tickets: [{ ...t[0], prizeAmount: 10, prizeLabel: "x", mainMatches: 5, specialMatch: true }], ticketCount: 1,
  drawDateLabel: "x", drawDateIso: "2026-11-06T23:00:00-05:00", siteUrl: "x" }, false);
process.stdout.write(JSON.stringify({ t, linhas: csv.trim().split("\\n").map((l) => l.split(",").length),
  semMudanca: computeTicketDiff(t, t).hasDiff, comMudanca: computeTicketDiff(t, outro).hasDiff, texto }));
""" % tuple(json.dumps(os.path.join(AQUI, "email", f)) for f in
            ("publish_tickets.mjs", "payload.mjs", "diff.mjs", "render.mjs"))
        saida = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
        self.assertEqual(saida.returncode, 0, saida.stderr)
        r = json.loads(saida.stdout)
        self.assertEqual([(x["special"], x["multiplier"]) for x in r["t"]], [(24, 3), (1, 10)])
        self.assertEqual(set(r["linhas"]), {8})
        self.assertFalse(r["semMudanca"])
        self.assertTrue(r["comMudanca"])
        self.assertIn("Mega Ball: 24", r["texto"])
        self.assertIn("Multiplicador: 3X", r["texto"])
        self.assertNotIn("Power", r["texto"])
        self.assertNotIn("+PB", r["texto"])


class SorteioSemPremio(unittest.TestCase):
    def test_sem_premio_nao_e_erro_de_conteudo(self):
        fonte = open(os.path.join(AQUI, "send_result_email.py"), encoding="utf-8").read()
        self.assertNotIn("Prêmios ganhos = $0", fonte)

    def test_jackpot_passado_de_outro_jogo_nao_sai(self):
        draw = {"id": "2026-11-06", "gameType": "megamillions", "finance": {}}
        doc = {"funds": {}, "games": {
            "powerball": {"label": "Powerball", "advertisedAnnuityCents": 83500000000, "nextDrawDate": "2026-11-04"},
            "megamillions": {"label": "Mega Millions", "advertisedAnnuityCents": 52000000000, "nextDrawDate": "2026-11-10"}},
            "nextPool": {"game": "powerball", "label": "Powerball", "jackpotCents": 83500000000, "drawDate": "2026-11-04"}}
        html = M._bloco_proximo_bolao(draw, doc, [], [])
        self.assertNotIn("2026-11-04", html)
        self.assertIn("2026-11-10", html)


class Validacao(unittest.TestCase):
    def test_mega_ball_vai_ate_24(self):
        base = {"numbers": [1, 2, 3, 4, 5], "multiplier": 1}
        self.assertTrue(F.validate_result("megamillions", {**base, "special": 24})[0])
        self.assertFalse(F.validate_result("megamillions", {**base, "special": 25})[0])
        self.assertTrue(F.validate_result("powerball", {**base, "special": 26})[0])

    def test_linha_real_da_fonte_de_mega_millions(self):
        # Formato medido em data.ny.gov em 2026-11-05: sem coluna de multiplicador.
        linha_real = {"draw_date": "2026-11-03T00:00:00.000", "winning_numbers": "04 24 31 62 70", "mega_ball": "03"}
        r = F.GAME_TYPES["megamillions"]["parse"](linha_real)
        self.assertEqual(r, OFICIAL)
        self.assertTrue(F.validate_result("megamillions", r)[0])

    def test_linha_sem_mega_ball_nao_inventa_bola(self):
        with self.assertRaises(KeyError):
            F.GAME_TYPES["megamillions"]["parse"]({"winning_numbers": "04 24 31 62 70"})


class EmailDoResultado(unittest.TestCase):
    def test_bolas_sem_power_play(self):
        html = M.result_balls_html(OFICIAL["numbers"], 3, 1, "Mega Ball")
        self.assertIn("Mega Ball 3", html)
        self.assertNotIn("Power Play", html)
        self.assertIn(M._MB_GOLD, html)
        self.assertNotIn(M._PB_RED, html)

    def test_powerball_continua_com_power_play(self):
        html = M.result_balls_html([1, 2, 3, 4, 5], 6, 2)
        self.assertIn("Power Play <strong>2x</strong>", html)
        self.assertIn(M._PB_RED, html)

    def test_corpo_inteiro(self):
        draw = json.loads(json.dumps(DRAW))
        draw["result"] = {**OFICIAL, "premiosGanhos": 10, "jackpotHit": False, "breakdown": ["1x Mega Ball"],
                          "checkedAt": "05/01/2030 08:00 ET"}
        # O bloco "proximo bolao" lista os jackpots dos dois jogos de proposito; o resto e so deste.
        with mock.patch.object(M, "_bloco_proximo_bolao", return_value=""):
            html = M.build_html(draw)
        self.assertIn("Mega Millions", html)
        self.assertIn("Mega Ball", html)
        self.assertNotIn("Power Play", html)
        self.assertNotIn("Powerball", html)


if __name__ == "__main__":
    unittest.main(verbosity=1)
