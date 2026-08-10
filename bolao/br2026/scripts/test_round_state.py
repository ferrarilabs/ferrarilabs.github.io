"""
test_round_state.py — contrato do resolver canônico de rodada do BR2026.

Gates permanentes:
  POSTPONED_ROUND_DOES_NOT_BLOCK_LATER_COMPLETE_ROUND
  DATE_RANGE_ONLY_ROUND_DETECTION_FORBIDDEN
  MISSED_CRON_CATCHUP
  MULTIPLE_MISSED_ROUNDS
  SOURCE_UNAVAILABLE_IS_NOT_COMPLETE

Todos os cenários usam fixtures determinísticas e `now` injetado. Nenhum teste aqui depende da
data corrente, de jogo ao vivo, da ESPN ou de rede — o defeito original passou despercebido
justamente porque a lógica só existia dentro de uma função que precisava de tudo isso para rodar.
"""

import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

os.environ["BOLAO_TEST_RUN"] = "1"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import round_state as R
import build_round_manifest as M

NOW = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)
LONG_AGO = (NOW - timedelta(hours=20)).isoformat()
SETTLED = (NOW - timedelta(minutes=30)).isoformat()
FRESH = (NOW - timedelta(minutes=1)).isoformat()


def rnd(number, ids, replacements=None):
    return {
        "roundNumber": number,
        "canonicalFixtureIds": list(ids),
        "expectedFixtureCount": len(ids),
        "replacements": replacements or {},
    }


def final(observed=None, terminal=None):
    return {"state": "post", "completed": True, "statusName": "STATUS_FULL_TIME",
            "observedAt": observed or FRESH, "terminalAt": terminal or SETTLED}


def postponed(observed=None):
    return {"state": "post", "completed": False, "statusName": "STATUS_POSTPONED",
            "postponed": True, "observedAt": observed or FRESH}


def live(observed=None):
    return {"state": "in", "completed": False, "statusName": "STATUS_SECOND_HALF",
            "observedAt": observed or FRESH}


def pre(observed=None):
    return {"state": "pre", "completed": False, "statusName": "STATUS_SCHEDULED",
            "observedAt": observed or FRESH}


class RoundIndependence(unittest.TestCase):
    """O defeito de produção, como contrato permanente."""

    def setUp(self):
        # R21: 6 finais + 4 adiados (a situação real de 29-31/07).
        self.r21 = rnd(21, [f"21_{i}" for i in range(10)])
        # R22: 10 finais (a rodada de 08-09/08 que ficou invisível).
        self.r22 = rnd(22, [f"22_{i}" for i in range(10)])
        # R23: 10 finais.
        self.r23 = rnd(23, [f"23_{i}" for i in range(10)])

        self.obs = {}
        for i in range(6):
            self.obs[f"21_{i}"] = final()
        for i in range(6, 10):
            self.obs[f"21_{i}"] = postponed()
        for i in range(10):
            self.obs[f"22_{i}"] = final()
            self.obs[f"23_{i}"] = final()

    def test_R21_adiada_espera(self):
        r = R.derive_round_notification_state(self.r21, self.obs, now=NOW)
        self.assertEqual(r["state"], R.ROUND_WAITING_FOR_POSTPONED_MATCH)
        self.assertEqual(r["facts"]["postponedCount"], 4)

    def test_R22_fica_ELEGIVEL_apesar_da_R21_travada(self):
        r = R.derive_round_notification_state(self.r22, self.obs, now=NOW)
        self.assertEqual(r["state"], R.ROUND_READY_TO_NOTIFY,
                         "R21 adiada NAO pode bloquear a R22 — este e o defeito de producao")

    def test_R23_elegivel_independente_da_R21_e_da_R22(self):
        r = R.derive_round_notification_state(self.r23, self.obs, now=NOW)
        self.assertEqual(r["state"], R.ROUND_READY_TO_NOTIFY)

    def test_reconciliacao_descobre_R22_e_R23_e_nao_a_R21(self):
        manifest = {"rounds": [self.r21, self.r22, self.r23]}
        out = R.reconcile(manifest, self.obs, now=NOW)
        nums = [c["roundNumber"] for c in out["candidates"]]
        self.assertEqual(nums, [22, 23], "candidatos devem sair em ordem cronologica, sem a R21")

    def test_adiado_nunca_e_removido_da_rodada_de_origem(self):
        r = R.derive_round_notification_state(self.r21, self.obs, now=NOW)
        self.assertEqual(r["facts"]["expectedCount"], 10,
                         "a rodada continua esperando 10 jogos; adiado nao encolhe a rodada")


class ReconciliationRecovery(unittest.TestCase):
    def test_MISSED_CRON_CATCHUP(self):
        # A rodada terminou há 20 horas e nenhuma execução presenciou a transição.
        r22 = rnd(22, [f"m{i}" for i in range(10)])
        obs = {f"m{i}": final(observed=FRESH, terminal=LONG_AGO) for i in range(10)}
        out = R.reconcile({"rounds": [r22]}, obs, now=NOW)
        self.assertEqual([c["roundNumber"] for c in out["candidates"]], [22],
                         "o reconciliador nao precisa estar rodando no instante da transicao")

    def test_MULTIPLE_MISSED_ROUNDS_em_ordem(self):
        rounds, obs = [], {}
        for n in (20, 21, 22):
            rounds.append(rnd(n, [f"{n}_{i}" for i in range(10)]))
            for i in range(10):
                obs[f"{n}_{i}"] = final(terminal=LONG_AGO)
        out = R.reconcile({"rounds": rounds}, obs, now=NOW)
        self.assertEqual([c["roundNumber"] for c in out["candidates"]], [20, 21, 22])

    def test_ja_notificada_nao_reaparece(self):
        r22 = rnd(22, [f"s{i}" for i in range(10)])
        obs = {f"s{i}": final(terminal=LONG_AGO) for i in range(10)}
        states = {R.idempotency_key(22): {"status": "SENT"}}
        out = R.reconcile({"rounds": [r22]}, obs, states, now=NOW)
        self.assertEqual(out["candidates"], [])
        self.assertEqual(out["evaluated"][0]["state"], R.ROUND_NOTIFIED)

    def test_claim_de_outra_execucao_bloqueia_candidatura(self):
        r22 = rnd(22, [f"c{i}" for i in range(10)])
        obs = {f"c{i}": final(terminal=LONG_AGO) for i in range(10)}
        states = {R.idempotency_key(22): {"status": "SENDING"}}
        out = R.reconcile({"rounds": [r22]}, obs, states, now=NOW)
        self.assertEqual(out["candidates"], [], "duas execucoes simultaneas nao podem duplicar")


class NeverInferComplete(unittest.TestCase):
    def test_fonte_indisponivel_NAO_e_completa(self):
        r = rnd(22, [f"u{i}" for i in range(10)])
        obs = {f"u{i}": final(terminal=LONG_AGO) for i in range(9)}   # o 10º sem observação
        out = R.derive_round_notification_state(r, obs, now=NOW)
        self.assertEqual(out["state"], R.ROUND_SOURCE_UNAVAILABLE)

    def test_jogo_ao_vivo_mantem_incompleta(self):
        r = rnd(22, [f"l{i}" for i in range(10)])
        obs = {f"l{i}": final(terminal=LONG_AGO) for i in range(9)}
        obs["l9"] = live()
        self.assertEqual(R.derive_round_notification_state(r, obs, now=NOW)["state"],
                         R.ROUND_INCOMPLETE)

    def test_jogo_PRE_mantem_incompleta(self):
        r = rnd(22, [f"p{i}" for i in range(10)])
        obs = {f"p{i}": final(terminal=LONG_AGO) for i in range(9)}
        obs["p9"] = pre()
        self.assertEqual(R.derive_round_notification_state(r, obs, now=NOW)["state"],
                         R.ROUND_INCOMPLETE)

    def test_assentamento_nao_decorrido(self):
        r = rnd(22, [f"t{i}" for i in range(10)])
        just_now = (NOW - timedelta(minutes=1)).isoformat()
        obs = {f"t{i}": final(terminal=just_now) for i in range(10)}
        self.assertEqual(R.derive_round_notification_state(r, obs, now=NOW)["state"],
                         R.ROUND_COMPLETE_UNSETTLED)

    def test_observacao_velha_demais_nao_autoriza_envio(self):
        r = rnd(22, [f"o{i}" for i in range(10)])
        stale = (NOW - timedelta(hours=5)).isoformat()
        obs = {f"o{i}": final(observed=stale, terminal=LONG_AGO) for i in range(10)}
        self.assertEqual(R.derive_round_notification_state(r, obs, now=NOW)["state"],
                         R.ROUND_SOURCE_UNAVAILABLE)

    def test_rejogo_fecha_a_rodada_de_ORIGEM(self):
        # Caso real da R4: dois jogos adiados em 25/02, rejogados em julho com ids novos.
        r4 = rnd(4, [f"o{i}" for i in range(10)], replacements={"o9": "REJOGO"})
        obs = {f"o{i}": final(terminal=LONG_AGO) for i in range(9)}
        obs["o9"] = postponed()
        obs["REJOGO"] = final(terminal=LONG_AGO)
        out = R.derive_round_notification_state(r4, obs, now=NOW)
        self.assertEqual(out["state"], R.ROUND_READY_TO_NOTIFY,
                         "o rejogo satisfaz o jogo canonico sem migrar de rodada")


class ManifestContract(unittest.TestCase):
    """DATE_RANGE_ONLY_ROUND_DETECTION = FORBIDDEN, como gate permanente."""

    def setUp(self):
        with open(os.path.join(HERE, "..", "data", "round_manifest.json"), encoding="utf-8") as fh:
            self.m = json.load(fh)

    def test_manifesto_commitado_e_integro(self):
        self.assertEqual(M.validate(self.m), [])

    def test_cobre_a_temporada_inteira(self):
        self.assertEqual(len(self.m["rounds"]), 38)
        self.assertEqual(sum(len(r["canonicalFixtureIds"]) for r in self.m["rounds"]), 380)

    def test_nenhum_jogo_em_duas_rodadas(self):
        seen = {}
        for r in self.m["rounds"]:
            for fid in r["canonicalFixtureIds"]:
                self.assertNotIn(fid, seen, f"jogo {fid} em R{seen.get(fid)} e R{r['roundNumber']}")
                seen[fid] = r["roundNumber"]

    def test_identidade_e_por_ID_e_nao_por_data(self):
        # Se a identidade fosse por data, rodadas com intervalos sobrepostos seriam impossíveis.
        # Elas EXISTEM no calendário real (adiados carregam a data original), e é exatamente por
        # isso que agrupar por data não pode voltar a ser canônico.
        overlaps = 0
        rs = sorted(self.m["rounds"], key=lambda r: r["roundNumber"])
        for a, b in zip(rs, rs[1:]):
            if a["dateRangeUtc"][1] >= b["dateRangeUtc"][0]:
                overlaps += 1
        self.assertGreater(overlaps, 0,
                           "o calendario real tem rodadas com datas sobrepostas — agrupar por "
                           "data nao pode voltar a definir identidade de rodada")

    def test_a_rodada_do_incidente_e_a_21_e_a_invisivel_e_a_22(self):
        def round_of(fid):
            return next(r["roundNumber"] for r in self.m["rounds"]
                        if fid in r["canonicalFixtureIds"])
        self.assertEqual(round_of("401841173"), 21, "lote travado de 29-31/07")
        self.assertEqual(round_of("401841187"), 22, "rodada concluida em 09/08")


    def test_PROVENIENCIA_OFICIAL_presente_e_coerente(self):
        """CANONICAL_ROUND_MANIFEST_OFFICIAL_PROVENANCE.

        A particao round-robin prova integridade, nao identidade: um deslocamento uniforme de
        +-1 satisfaz a particao e atribui a rodada errada a todos os 380 jogos. A verdade de
        negocio sao as ancoras oficiais.
        """
        prov = self.m.get("officialProvenance") or {}
        anchors = prov.get("anchors") or []
        self.assertTrue(anchors, "manifesto sem ancora oficial nao tem verdade de negocio")
        for a in anchors:
            self.assertTrue(a.get("sources"), f"ancora {a.get('fixtureId')} sem fonte")
            found = next(r for r in self.m["rounds"]
                         if a["fixtureId"] in r["canonicalFixtureIds"])
            self.assertEqual(found["roundNumber"], a["roundNumber"],
                             f"fonte oficial e manifesto discordam sobre {a['fixtureId']}")

    def test_deslocamento_uniforme_seria_detectado(self):
        import copy
        bad = copy.deepcopy(self.m)
        ids = [r["canonicalFixtureIds"] for r in bad["rounds"]]
        for i, r in enumerate(bad["rounds"]):
            r["canonicalFixtureIds"] = ids[(i + 1) % len(ids)]
        problems = M.validate(bad)
        self.assertTrue(any("CONFLITO DE PROVENIENCIA" in p for p in problems),
                        "um deslocamento de rodada tem de falhar, mesmo com a particao intacta")

    def test_adiamentos_da_R21_corroborados_por_fonte_oficial(self):
        c = (self.m.get("officialProvenance") or {}).get("postponementCorroboration") or {}
        self.assertEqual(c.get("roundNumber"), 21)
        self.assertEqual(len(c.get("postponedFixtureIds") or []), 4)
        r21 = next(r for r in self.m["rounds"] if r["roundNumber"] == 21)
        for fid in c["postponedFixtureIds"]:
            self.assertIn(fid, r21["canonicalFixtureIds"],
                          "jogo adiado citado pela fonte oficial tem de estar na R21")

    def test_proveniencia_registrada(self):
        p = self.m["provenance"]
        for k in ("source", "method", "retrievedAt"):
            self.assertTrue(p.get(k))



class LegacyMigration(unittest.TestCase):
    """Sem tradução do estado antigo, o reconciliador reenviaria rodadas já comunicadas."""

    def setUp(self):
        import legacy_round_state as L
        self.L = L
        self.manifest = {"rounds": [
            rnd(19, [f"19_{i}" for i in range(10)]),
            rnd(20, [f"20_{i}" for i in range(10)]),
            rnd(21, [f"21_{i}" for i in range(10)]),
        ]}
        for r, dr in zip(self.manifest["rounds"],
                         [("2026-07-16T00:00:00+00:00", "2026-07-23T00:00:00+00:00"),
                          ("2026-07-25T00:00:00+00:00", "2026-07-26T00:00:00+00:00"),
                          ("2026-07-29T00:00:00+00:00", "2026-07-31T00:00:00+00:00")]):
            r["dateRangeUtc"] = list(dr)

    def test_rodada_totalmente_coberta_vira_SENT(self):
        legacy = {"sentGameIds": [f"19_{i}" for i in range(10)],
                  "sentBatches": [{"windowStart": "2026-07-16T00:00:00Z"}]}
        states, rep = self.L.migrate(legacy, self.manifest)
        self.assertEqual(states[R.idempotency_key(19)]["status"], "SENT")
        self.assertIn(19, rep["roundsMarkedSent"])

    def test_cobertura_parcial_vira_PARTIAL_e_nao_SENT(self):
        legacy = {"sentGameIds": [f"20_{i}" for i in range(6)],
                  "sentBatches": [{"windowStart": "2026-07-16T00:00:00Z"}]}
        states, rep = self.L.migrate(legacy, self.manifest)
        self.assertEqual(states[R.idempotency_key(20)]["status"], "PARTIAL")

    def test_pendingBatch_vira_evidencia_e_nao_trava(self):
        legacy = {"sentGameIds": [], "sentBatches": [{"windowStart": "2026-07-16T00:00:00Z"}],
                  "pendingBatch": {"gameIds": [f"21_{i}" for i in range(10)]}}
        states, rep = self.L.migrate(legacy, self.manifest)
        self.assertIn("ARQUIVADO", rep["legacyPendingBatchDisposition"])
        self.assertNotIn(R.idempotency_key(21), states,
                         "o lote travado NAO pode virar um estado que impeca a rodada")

    def test_rodada_anterior_ao_recurso_nunca_vira_candidata(self):
        legacy = {"sentGameIds": [], "sentBatches": [{"windowStart": "2026-07-25T00:00:00Z"}]}
        states, rep = self.L.migrate(legacy, self.manifest)
        self.assertIn(19, rep["roundsPreFeature"])
        self.assertEqual(states[R.idempotency_key(19)]["source"], "PRE_FEATURE")

    def test_sem_historico_nao_inventa_epoch(self):
        states, rep = self.L.migrate({}, self.manifest)
        self.assertIsNone(rep["featureEpoch"])
        self.assertEqual(rep["roundsPreFeature"], [])

if __name__ == "__main__":
    unittest.main(verbosity=2)
