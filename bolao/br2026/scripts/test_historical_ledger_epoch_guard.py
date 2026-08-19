#!/usr/bin/env python3
"""test_historical_ledger_epoch_guard.py — BR2026 — HISTORICAL_ROUND_RESURRECTION = IMPOSSIVEL.

POR QUE ESTE ARQUIVO EXISTE
----------------------------
Incidente 2026-08-18 ~21:25 UTC, na primeira execução após o rearme do Issue #221: a rodada 22
(concluída e notificada de verdade em 2026-08-11, 11/11 aceitos) foi reenviada para os mesmos 11
participantes reais. Causa raiz: F8 trocou `SupabaseStateRoundLedgerRepo` (lia/escrevia
`bolao_state.roundEmail.ledger`, JSON) por `AtomicRoundLedgerRepo` (tabela
`bolao_round_notif_jobs`) — mas só a rodada 23 (a rodada do #221) foi retroativamente povoada na
tabela nova. A R22 continuou com sua ÚNICA evidência de entrega presa no JSON antigo, que nada
mais lia. Para o reconciliador, "sem linha na tabela nova" e "nunca enviada" eram a MESMA coisa —
e não são.

Este arquivo prova duas coisas separadas, cada uma suficiente sozinha para impedir a recorrência
deste incidente especificamente, mas mantidas as DUAS de propósito (defesa em profundidade — ver
`send_round_email.py`, comentário acima de `EARLIEST_DURABLE_LEDGER_ROUND`):

1. O JSON antigo (`roundEmail.ledger`) voltou a ser lido, permanentemente — resolve a R22
   especificamente, com a evidência real que já existe.
2. Um guardião de época (`apply_historical_ledger_epoch_guard`) bloqueia QUALQUER rodada
   <= EARLIEST_DURABLE_LEDGER_ROUND sem evidência em NENHUMA fonte, mesmo que o item 1 acima (ou
   qualquer outra fonte futura) tenha uma lacuna que ainda não pensamos em cobrir.

Executar: python3 bolao/br2026/scripts/test_historical_ledger_epoch_guard.py
NENHUM ENDERECO REAL: só domínios reservados por RFC 2606.
"""
import inspect
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

os.environ["BOLAO_TEST_RUN"] = "1"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import send_round_email as S
import round_state as ROUNDSTATE
import build_round_manifest as MANIFEST
from round_notif_rpc_fake import FakeRoundNotifStore, make_round_rpc_caller


# ── 1-4: função pura (round_state.py) — sem rede, sem Supabase ──────────────────────────────────
class DeriveStateHonorsHistoricalGap(unittest.TestCase):
    ROUND_DEF = {"roundNumber": 22, "canonicalFixtureIds": ["f1", "f2"]}

    def _obs_tudo_completo(self):
        agora = datetime.now(timezone.utc)
        return {fid: {"completed": True, "state": "post", "statusName": "STATUS_FULL_TIME",
                     "observedAt": agora.isoformat(),
                     "terminalAt": (agora - timedelta(hours=1)).isoformat()}
                for fid in self.ROUND_DEF["canonicalFixtureIds"]}

    def test_gap_bloqueia_mesmo_com_todos_os_jogos_completos(self):
        """O CENÁRIO EXATO do incidente: jogos 100% terminais e assentados — só a origem da
        notificação está em dúvida. Sem o guardião, isto vira ROUND_READY_TO_NOTIFY."""
        res = ROUNDSTATE.derive_round_notification_state(
            self.ROUND_DEF, self._obs_tudo_completo(),
            notification_state={"status": "HISTORICAL_LEDGER_GAP"})
        self.assertEqual(res["state"], ROUNDSTATE.ROUND_HISTORICAL_LEDGER_GAP)
        self.assertNotEqual(res["state"], ROUNDSTATE.ROUND_READY_TO_NOTIFY)

    def test_gap_tem_precedencia_sobre_avaliacao_de_jogos(self):
        """Mesmo com observações VAZIAS (que isoladamente dariam ROUND_SOURCE_UNAVAILABLE), o
        estado do gap é o que sai — a checagem de proveniência de notificação vem antes."""
        res = ROUNDSTATE.derive_round_notification_state(
            self.ROUND_DEF, {}, notification_state={"status": "HISTORICAL_LEDGER_GAP"})
        self.assertEqual(res["state"], ROUNDSTATE.ROUND_HISTORICAL_LEDGER_GAP)

    def test_sem_gap_a_mesma_rodada_fica_pronta_normalmente(self):
        """Controle: sem `notification_state`, a MESMA rodada completa vira candidata
        normalmente — prova que o teste anterior testou o guardião, não outra coisa."""
        res = ROUNDSTATE.derive_round_notification_state(
            self.ROUND_DEF, self._obs_tudo_completo(), notification_state=None)
        self.assertEqual(res["state"], ROUNDSTATE.ROUND_READY_TO_NOTIFY)

    def test_reconcile_nunca_propoe_rodada_em_gap_como_candidata(self):
        manifest = {"rounds": [self.ROUND_DEF]}
        out = ROUNDSTATE.reconcile(
            manifest, self._obs_tudo_completo(),
            notification_states={ROUNDSTATE.idempotency_key(22): {"status": "HISTORICAL_LEDGER_GAP"}})
        self.assertEqual(out["candidates"], [])
        self.assertEqual(out["evaluated"][0]["state"], ROUNDSTATE.ROUND_HISTORICAL_LEDGER_GAP)


# ── 5-6: guardião de época (send_round_email.py) — só preenche buraco, nunca sobrescreve ────────
class EpochGuardFillsGapsOnly(unittest.TestCase):
    def _manifest(self, numeros):
        return {"rounds": [{"roundNumber": n} for n in numeros]}

    def test_preenche_apenas_rodadas_sem_nenhum_estado_previo(self):
        manifest = self._manifest([20, 21, 22, 23])
        notif_states = {}
        out = S.apply_historical_ledger_epoch_guard(notif_states, manifest)
        for n in (20, 21, 22, 23):
            key = ROUNDSTATE.idempotency_key(n)
            self.assertEqual(out[key]["status"], "HISTORICAL_LEDGER_GAP", f"R{n} deveria ser preenchida")

    def test_nunca_sobrescreve_estado_ja_resolvido_por_fonte_real(self):
        """Rodadas 19/20 (SENT via legado) e 23 (SENT via backfill) precisam permanecer
        exatamente como estavam — sobrescrever qualquer uma delas com o guardião seria uma
        regressão silenciosa (rodada JÁ notificada voltando a parecer pendente de revisão, o
        que não é perigoso por si, mas mascara a rodada real que precisa de atenção)."""
        manifest = self._manifest([19, 20, 21, 22, 23])
        notif_states = {
            ROUNDSTATE.idempotency_key(19): {"status": "SENT", "source": "LEGACY_BATCH"},
            ROUNDSTATE.idempotency_key(20): {"status": "SENT", "source": "LEGACY_BATCH"},
            ROUNDSTATE.idempotency_key(22): {"status": "SENT", "source": "LEGACY_ROUND_LEDGER_JSON"},
            ROUNDSTATE.idempotency_key(23): {"status": "SENT", "source": "ROUND_LEDGER"},
        }
        antes = json.dumps(notif_states, sort_keys=True)
        out = S.apply_historical_ledger_epoch_guard(dict(notif_states), manifest)
        self.assertEqual(json.dumps({k: v for k, v in out.items() if k != ROUNDSTATE.idempotency_key(21)},
                                    sort_keys=True), antes,
                         "guardião alterou um estado que já veio de fonte real")
        self.assertEqual(out[ROUNDSTATE.idempotency_key(21)]["status"], "HISTORICAL_LEDGER_GAP",
                         "R21 (única sem fonte real) deveria ter sido preenchida")

    def test_rodada_posterior_a_epoca_nunca_e_tocada(self):
        """Rodadas > EARLIEST_DURABLE_LEDGER_ROUND só puderam existir como candidatas depois que
        a tabela nova já existia — "sem linha" ali é sempre "nunca enviada" de verdade. O
        guardião bloquear uma rodada futura legítima seria um novo incidente (silenciar envio
        real), não uma correção."""
        self.assertGreater(30, S.EARLIEST_DURABLE_LEDGER_ROUND)
        manifest = self._manifest([30])
        out = S.apply_historical_ledger_epoch_guard({}, manifest)
        self.assertNotIn(ROUNDSTATE.idempotency_key(30), out)


# ── 7-9: leitura do JSON legado de rodada — a evidência real da R22 ─────────────────────────────
class LegacyRoundLedgerJson(unittest.TestCase):
    MANIFEST = {"rounds": [{"roundNumber": 22}, {"roundNumber": 23}]}

    def test_traduz_registro_sent_do_json_antigo(self):
        legacy = {"ledger": {"br2026:round-results:22:v1": {
            "state": "SENT", "roundNumber": 22, "sentAt": 1786455734619,
        }}}
        out = S.notification_states_from_legacy_round_ledger_json(legacy, self.MANIFEST)
        self.assertEqual(out["br2026:round-results:22:v1"],
                         {"status": "SENT", "source": "LEGACY_ROUND_LEDGER_JSON"})

    def test_sem_chave_ledger_nao_quebra_e_nao_inventa_estado(self):
        self.assertEqual(S.notification_states_from_legacy_round_ledger_json({}, self.MANIFEST), {})
        self.assertEqual(
            S.notification_states_from_legacy_round_ledger_json({"ledger": {}}, self.MANIFEST), {})

    def test_estado_nao_terminal_no_json_antigo_nao_produz_entrada(self):
        """`_ROUND_LEDGER_STATUS_MAP` só traduz estados terminais (SENT/PARTIAL/SENDING/
        CLAIMED/NEEDS_MANUAL_REVIEW) -- um valor desconhecido tem de ser ignorado, nunca
        interpretado como positivo nem negativo por acidente."""
        legacy = {"ledger": {"br2026:round-results:22:v1": {"state": "ALGO_DESCONHECIDO"}}}
        out = S.notification_states_from_legacy_round_ledger_json(legacy, self.MANIFEST)
        self.assertEqual(out, {})


# ── 10-12: fim-a-fim contra o manifesto e o cenário REAIS do incidente ──────────────────────────
def _game(fid, completed=True):
    agora = datetime.now(timezone.utc)
    return {"id": fid, "date": agora - timedelta(hours=20), "home": "Casa", "away": "Fora",
            "completed": completed, "goalsHome": 1, "goalsAway": 0,
            "statusName": "STATUS_FULL_TIME" if completed else "STATUS_SCHEDULED",
            "statusState": "post" if completed else "pre"}


def _entry(eid):
    return {"id": eid, "entryName": f"Entrada {eid}", "participantEmail": f"{eid}@example.invalid",
            "picks": {"g4": [], "z4": [], "sa6": []}}


STANDINGS = [{"name": f"T{i:02}", "rank": i, "gd": 20 - i, "gf": 30 - i} for i in range(1, 21)]
_ESCRITOR = next(k for k in ("sb_upsert", "sb_append_audit") if hasattr(S, k))


class EndToEndIncidentNowImpossible(unittest.TestCase):
    """Reconstrói o cenário real (manifesto de produção via `build_round_manifest.load()`, R22
    com jogos 100% completos, ZERO linha na tabela nova) e prova que `run_auto()` não a propõe
    mais como candidata — com e sem a evidência do JSON antigo presente, para isolar qual das
    duas defesas está segurando em cada caso."""

    def setUp(self):
        self.manifest = MANIFEST.load()
        self.round22 = next(r for r in self.manifest["rounds"] if r["roundNumber"] == 22)
        self.games = {fid: _game(fid) for fid in self.round22["canonicalFixtureIds"]}
        self.store = FakeRoundNotifStore()   # tabela nova: SEM NENHUMA linha para a R22
        self._orig = {k: getattr(S, k) for k in
                      ("sb_fetch", _ESCRITOR, "fetch_scoreboard_window", "fetch_standings",
                       "_TRANSPORT", "_ROUND_RPC_CALLER", "notification_states_from_atomic")}

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(S, k, v)
        S._TRANSPORT = None

    def _install(self, legacy_round_email):
        state = {"entries": [_entry(f"e{i}") for i in range(11)], "roundEmail": legacy_round_email}
        S.sb_fetch = lambda: state
        setattr(S, _ESCRITOR, lambda *a, **k: 200)
        S.fetch_scoreboard_window = lambda a, b: dict(self.games)
        S.fetch_standings = lambda: list(STANDINGS)
        S._ROUND_RPC_CALLER = make_round_rpc_caller(self.store)
        S.notification_states_from_atomic = lambda: {}
        provider_calls = []
        S._TRANSPORT = lambda url, body, headers: (provider_calls.append(body), 200)[1]
        return provider_calls

    def test_com_evidencia_do_json_antigo_R22_nao_e_candidata_zero_envios(self):
        """Reproduz o estado de produção de verdade: `roundEmail.ledger` tem a R22 como SENT
        (enviada em 2026-08-11), tabela nova vazia."""
        legacy = {"ledger": {"br2026:round-results:22:v1": {
            "state": "SENT", "roundNumber": 22, "sentAt": 1786455734619,
        }}, "sentBatches": [{"windowStart": "2026-07-16T00:00:00Z"}], "sentGameIds": []}
        provider_calls = self._install(legacy)
        out = S.run_auto(dry_run=False)
        self.assertNotIn(22, out["candidates"])
        self.assertEqual(len(provider_calls), 0,
                         "R22 com evidência real no JSON antigo NÃO pode ser reenviada — "
                         "reprodução direta do incidente de 2026-08-18")

    def test_sem_evidencia_nenhuma_R22_e_bloqueada_pelo_guardiao_nao_enviada(self):
        """Cenário mais severo que o incidente real: NENHUMA fonte tem qualquer evidência (nem
        o JSON antigo). Sem o guardião de época, isto enviaria de verdade. Prova a defesa em
        profundidade isoladamente da correção específica da R22."""
        legacy = {"sentBatches": [{"windowStart": "2026-07-16T00:00:00Z"}], "sentGameIds": []}
        provider_calls = self._install(legacy)
        out = S.run_auto(dry_run=False)
        self.assertNotIn(22, out["candidates"])
        self.assertEqual(len(provider_calls), 0,
                         "guardião de época deveria bloquear uma rodada pré-época sem evidência "
                         "em NENHUMA fonte, mesmo sem a correção específica do JSON antigo")

    def test_rodada_realmente_nova_sem_historico_continua_enviando_normalmente(self):
        """Controle final: uma rodada SINTÉTICA > EARLIEST_DURABLE_LEDGER_ROUND, nunca vista
        antes em fonte nenhuma (o caso comum, real, de toda rodada futura), continua elegível
        e envia normalmente -- prova que a correção não travou o caminho comum."""
        manifest_sintetico = {
            "rounds": [{
                "roundNumber": S.EARLIEST_DURABLE_LEDGER_ROUND + 1,
                "canonicalFixtureIds": ["s1", "s2"],
                "dateRangeUtc": ["2020-01-01T00:00:00+00:00", "2020-01-02T00:00:00+00:00"],
            }],
            "officialProvenance": {"anchors": []},
        }
        # `S.MANIFEST` e `MANIFEST` (topo deste arquivo) sao o MESMO objeto de modulo -- salvar
        # a funcao original ANTES de mutar e obrigatorio; `S.MANIFEST.load = MANIFEST.load` no
        # `finally` seria um no-op (leria o proprio lambda que acabou de ser atribuido, porque
        # os dois nomes apontam pro mesmo atributo o tempo todo).
        orig_load, orig_validate = S.MANIFEST.load, S.MANIFEST.validate
        S.MANIFEST.load = lambda: manifest_sintetico
        S.MANIFEST.validate = lambda m: []
        try:
            legacy = {"sentBatches": [{"windowStart": "2020-01-01T00:00:00Z"}], "sentGameIds": []}
            games = {fid: _game(fid) for fid in manifest_sintetico["rounds"][0]["canonicalFixtureIds"]}
            self.games = games
            provider_calls = self._install(legacy)
            out = S.run_auto(dry_run=False)
            self.assertIn(S.EARLIEST_DURABLE_LEDGER_ROUND + 1, out["candidates"])
            self.assertEqual(len(provider_calls), 11, "rodada nova legítima deveria enviar normalmente")
        finally:
            S.MANIFEST.load = orig_load
            S.MANIFEST.validate = orig_validate


# ── Fiação de produção -- pega uma futura remoção silenciosa das duas defesas ────────────────────
class ProductionWiringCallsBothDefenses(unittest.TestCase):
    def test_run_auto_mescla_json_antigo_e_aplica_o_guardiao_de_epoca(self):
        fonte = inspect.getsource(S.run_auto)
        codigo = "\n".join(l for l in fonte.split("\n") if not l.strip().startswith("#"))
        self.assertIn("notification_states_from_legacy_round_ledger_json(legacy, manifest)", codigo,
                     "run_auto() parou de mesclar o JSON antigo de rodada -- a R22 voltaria a "
                     "ficar invisível")
        self.assertIn("apply_historical_ledger_epoch_guard(notif_states, manifest)", codigo,
                     "run_auto() parou de aplicar o guardião de época -- a defesa em profundidade "
                     "contra QUALQUER outra lacuna histórica desapareceu")

    def test_guardiao_roda_depois_de_toda_fonte_real_ser_mesclada(self):
        """Ordem importa: se o guardião rodasse ANTES das fontes reais, ele preencheria buracos
        que as fontes reais ainda iriam legitimamente resolver, e dependeria de `.update()` para
        sobrescrever -- um `.update()` de uma fonte real por cima do guardião teria a MESMA
        aparência de "correto" que a ordem atual, mas inverteria a garantia de "só preenche
        buraco, nunca sobrescreve" para "pode ser sobrescrito por engano"."""
        fonte = inspect.getsource(S.run_auto)
        pos_guarda = fonte.index("apply_historical_ledger_epoch_guard(notif_states, manifest)")
        for fonte_real in ("notification_states_from_atomic()",
                           "notification_states_from_legacy_round_ledger_json(legacy, manifest)",
                           "notification_states_from_round_ledger(ledger, manifest)"):
            self.assertLess(fonte.index(fonte_real), pos_guarda,
                            f"{fonte_real} deveria ser mesclada ANTES do guardião de época")


if __name__ == "__main__":
    unittest.main(verbosity=2)
