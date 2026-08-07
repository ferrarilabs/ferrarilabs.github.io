#!/usr/bin/env python3
"""
test_result_email_source.py — a fonte de dados do cron de emails de resultado do CDB2026.

O cron passou a consumir o MESMO snapshot normalizado canônico que os três apps leem, em vez de ter
a sua própria implementação de ESPN (que, sem `User-Agent`, era recusada nos runners do GitHub e
deixava o cron vermelho a cada 10 minutos).

Esta suíte cobre os quatro estados exigidos da fonte:

  1. snapshot ATUAL      -> candidatos corretos
  2. snapshot STALE      -> ainda utilizável (resultado finalizado é fato imutável), com aviso
  3. snapshot INVÁLIDO   -> SourceUnavailable (nunca "no chute")
  4. fonte INDISPONÍVEL  -> SourceUnavailable

Nenhuma rede é tocada: `run_sync` é substituído por um dublê. Nenhum email é enviado: nada aqui
chama o caminho de envio.

Uso: python3 bolao/cdb2026/scripts/test_result_email_source.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent / "shared" / "scripts"))

spec = importlib.util.spec_from_file_location("sre_under_test", HERE / "send_result_email.py")
sre = importlib.util.module_from_spec(spec)
sys.modules["sre_under_test"] = sre
spec.loader.exec_module(sre)          # só nível de módulo; run_auto() fica atrás do guard __main__

import espn_provider as ep            # noqa: E402
import sync_espn                      # noqa: E402


def snapshot(matches, *, stale=False, schema=None):
    return {
        "schemaVersion": ep.SCHEMA_VERSION if schema is None else schema,
        "competitionId": "bra.copa_do_brazil",
        "provider": "espn",
        "generatedAt": "2026-08-07T20:00:00Z",
        "sourceUpdatedAt": "2026-08-07T20:00:00Z",
        "stale": stale,
        "staleReason": "fetch_failed" if stale else None,
        "payloadHash": "test",
        "matches": matches,
    }


FINISHED = {
    "id": "1", "date": "2026-08-01T22:00Z", "state": "post", "completed": True,
    "homeTeam": "Vasco da Gama", "awayTeam": "Fluminense",   # alias de propósito
    "homeTeamId": "3454", "awayTeamId": "3445",
    "homeScore": 2, "awayScore": 1, "homeWinner": True, "awayWinner": False,
    "venue": "São Januário", "city": "Rio de Janeiro",
    "clockSec": None, "clockStr": "FT", "period": 2, "details": [],
}
POSTPONED = {**FINISHED, "id": "2", "completed": False, "homeTeam": "Santos", "awayTeam": "Remo",
             "homeScore": 0, "awayScore": 0, "homeWinner": False, "awayWinner": False}
LIVE = {**FINISHED, "id": "3", "state": "in", "completed": False, "homeTeam": "Grêmio",
        "awayTeam": "Mirassol", "homeScore": 1, "awayScore": 0,
        "homeWinner": False, "awayWinner": False}


class SourceTests(unittest.TestCase):
    def setUp(self):
        # Dublê: nenhuma chamada de rede em teste. O cron trata falha de refresh como não-fatal e
        # cai para o snapshot em disco, que é exatamente o que queremos exercitar.
        self._real_run_sync = ep.run_sync
        ep.run_sync = lambda cfg: ep.RefreshOutcome(
            wrote=False, stale=False, reason="stubbed", generatedAt="2026-08-07T20:00:00Z",
            sourceFetchedAt=None, problems=[])
        self._real_path = sync_espn.CONFIG["output_path"]
        self._tmp = tempfile.mkdtemp(prefix="cdb-snap-")
        sync_espn.CONFIG["output_path"] = os.path.join(self._tmp, "espn-normalized.json")

    def tearDown(self):
        ep.run_sync = self._real_run_sync
        sync_espn.CONFIG["output_path"] = self._real_path

    def _write(self, obj):
        with open(sync_espn.CONFIG["output_path"], "w", encoding="utf-8") as f:
            json.dump(obj, f)

    # ── 1. snapshot atual ────────────────────────────────────────────────────
    def test_current_snapshot_yields_candidates(self):
        self._write(snapshot([FINISHED, POSTPONED, LIVE]))
        out = sre.fetch_espn_candidates()
        self.assertEqual(len(out), 3)
        by_home = {c["homeTeam"]: c for c in out}

        fin = by_home["Vasco"]        # alias local aplicado: "Vasco da Gama" -> "Vasco"
        self.assertEqual(fin["state"], "post")
        self.assertFalse(fin["postponed"])
        self.assertEqual((fin["homeScore"], fin["awayScore"]), (2, 1))
        self.assertTrue(fin["homeWinner"])
        self.assertFalse(fin["awayWinner"])
        self.assertEqual(fin["venue"], "São Januário")

    def test_postponed_never_becomes_a_real_zero_zero_result(self):
        # state "post" + completed False = adiado. Placar TEM de ficar None, senão um jogo adiado
        # entra como 0-0 de verdade e dispara email de resultado errado.
        self._write(snapshot([POSTPONED]))
        c = sre.fetch_espn_candidates()[0]
        self.assertTrue(c["postponed"])
        self.assertIsNone(c["homeScore"])
        self.assertIsNone(c["awayScore"])
        self.assertFalse(c["homeWinner"])
        self.assertFalse(c["awayWinner"])

    def test_live_match_carries_no_final_score(self):
        self._write(snapshot([LIVE]))
        c = sre.fetch_espn_candidates()[0]
        self.assertEqual(c["state"], "in")
        self.assertIsNone(c["homeScore"], "partida ao vivo não pode entrar como resultado final")
        self.assertIsNone(c["awayScore"])

    # ── 2. snapshot stale ────────────────────────────────────────────────────
    def test_stale_snapshot_is_still_usable(self):
        # Resultado finalizado é fato imutável: snapshot velho pode ATRASAR a descoberta, nunca
        # produzir resultado errado. Falhar aqui só deixaria o cron vermelho sem ganho.
        self._write(snapshot([FINISHED], stale=True))
        out = sre.fetch_espn_candidates()
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["homeScore"], 2)

    # ── 3. snapshot inválido ─────────────────────────────────────────────────
    def test_missing_matches_key_raises(self):
        self._write({"schemaVersion": ep.SCHEMA_VERSION, "generatedAt": "x"})
        with self.assertRaises(sre.SourceUnavailable):
            sre.fetch_espn_candidates()

    def test_matches_not_a_list_raises(self):
        self._write(snapshot({"nope": True}))
        with self.assertRaises(sre.SourceUnavailable):
            sre.fetch_espn_candidates()

    def test_corrupt_json_raises(self):
        with open(sync_espn.CONFIG["output_path"], "w", encoding="utf-8") as f:
            f.write("{not json")
        with self.assertRaises(sre.SourceUnavailable):
            sre.fetch_espn_candidates()

    def test_incompatible_schema_version_raises(self):
        # Nunca ler "no chute" uma forma que este código não entende — mesma regra do run_sync().
        self._write(snapshot([FINISHED], schema=ep.SCHEMA_VERSION + 99))
        with self.assertRaises(sre.SourceUnavailable):
            sre.fetch_espn_candidates()

    # ── 4. fonte indisponível ────────────────────────────────────────────────
    def test_no_snapshot_at_all_raises(self):
        # Arquivo nem existe e o refresh não produziu nada.
        with self.assertRaises(sre.SourceUnavailable):
            sre.fetch_espn_candidates()

    def test_refresh_exception_falls_back_to_disk(self):
        # run_sync explodindo não pode derrubar o ciclo se há snapshot bom em disco.
        self._write(snapshot([FINISHED]))
        def boom(_cfg):
            raise RuntimeError("TLS handshake recusado")
        ep.run_sync = boom
        out = sre.fetch_espn_candidates()
        self.assertEqual(len(out), 1)

    def test_refresh_exception_and_no_disk_raises(self):
        def boom(_cfg):
            raise RuntimeError("TLS handshake recusado")
        ep.run_sync = boom
        with self.assertRaises(sre.SourceUnavailable):
            sre.fetch_espn_candidates()

    # ── contrato: um único caminho de ESPN ───────────────────────────────────
    def test_no_direct_espn_fetch_remains_in_the_cron(self):
        src = (HERE / "send_result_email.py").read_text(encoding="utf-8")
        body_start = src.index("def fetch_espn_candidates():")
        body_end = src.index("RESULT_MATCH_WINDOW_DAYS", body_start)
        body = src[body_start:body_end]
        self.assertGreater(len(body), 500, "recorte do corpo da função ficou vazio — teste inválido")
        self.assertNotIn("urlopen", body,
                         "o cron voltou a buscar a ESPN direto — deve haver UM caminho canônico")
        self.assertIn("read_snapshot", body, "o cron não lê o snapshot canônico")

    def test_self_audit_gate_still_present(self):
        src = (HERE / "send_result_email.py").read_text(encoding="utf-8")
        self.assertIn("run_static_audit", src, "o gate de self-audit de scoring desapareceu")
        self.assertIn("SELF-AUDIT FAILED", src, "o refuse-to-send do self-audit desapareceu")


if __name__ == "__main__":
    unittest.main(verbosity=2)
