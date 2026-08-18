#!/usr/bin/env python3
"""test_round_email_durable_ledger.py — BR2026 — exactly-once ENTRE execuções separadas (Issue #221).

POR QUE ESTE ARQUIVO EXISTE
----------------------------
`test_round_delivery_loop.py` já prova que a máquina de estados de `RoundLedger` está correta —
mas reusando o MESMO objeto `RoundLedger` (e o mesmo `repo` Python) entre chamadas de
`_process_round()`. Isso nunca poderia ter pego o incidente real: a rodada 23 do BR2026 foi
enviada 4x para os 11 participantes reais (44 envios em vez de 11) porque cada execução agendada
do GitHub Actions é um PROCESSO NOVO, e o repositório de produção até F8
(`SupabaseStateRoundLedgerRepo`) nunca escrevia de volta no Supabase — só mutava um dict em
memória que morria com o processo. Reusar o objeto Python no teste escondia exatamente esse
defeito: a lógica em memória sempre esteve certa, a PERSISTÊNCIA é que nunca existiu.

Este arquivo modela "execução nova" literalmente: cada `fresh_runner()` constrói um
`RoundLedger(AtomicRoundLedgerRepo(), ...)` NOVO — nenhum objeto Python é reusado entre
"execuções" — e todas as instâncias falam com o MESMO `FakeRoundNotifStore` compartilhado via
`S._ROUND_RPC_CALLER`, que é o "banco" durável. Isso é exatamente o que um runner efêmero do
GitHub Actions faz: processo novo, banco igual.

Executar: python3 bolao/br2026/scripts/test_round_email_durable_ledger.py
NENHUM ENDERECO REAL: só domínios reservados por RFC 2606.
"""
import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "..", "shared", "scripts"))

import send_round_email as S
from round_notification_ledger import (
    RoundLedger, MemoryRoundLedgerRepo, ROUND_STATE, RECIPIENT_STATE,
)
from round_notif_rpc_fake import FakeRoundNotifStore, make_round_rpc_caller

RODADA = 23
FIXTURES = [f"f{i}" for i in range(10)]
N_RECIPIENTS = 11


def entrada(i):
    return {"id": f"e{i}", "entryName": f"Entrada {i}",
            "participantEmail": f"p{i}@example.invalid",
            "picks": {"g4": [], "z4": [], "sa6": []}}


ENTRIES = [entrada(i) for i in range(N_RECIPIENTS)]
TABELA = [{"name": f"T{i}", "points": 40 - i} for i in range(20)]


class Transporte:
    """Limite EXTERNO, thread-safe -- vários "runners" concorrentes podem compartilhar um."""

    def __init__(self, resposta=200):
        self._lock = threading.Lock()
        self.chamadas = []
        self.resposta = resposta

    def __call__(self, url, body, headers):
        with self._lock:
            self.chamadas.append(body)
            n = len(self.chamadas)
        r = self.resposta(n) if callable(self.resposta) else self.resposta
        if isinstance(r, Exception):
            raise r
        return r


def _manifest():
    return {"rounds": [{"roundNumber": RODADA, "canonicalFixtureIds": FIXTURES,
                        "dateRangeUtc": ["2026-08-08T00:00:00+00:00",
                                         "2026-08-09T23:59:59+00:00"]}]}


def _obs():
    return {f: {"_game": {"date": "2026-08-08T20:00Z", "home": "A", "away": "B",
                         "goalsHome": 1, "goalsAway": 0}} for f in FIXTURES}


def _cand():
    return {"roundNumber": RODADA,
            "facts": {"expectedCount": 10, "finalCount": 10, "nonTerminalCount": 0}}


def roda(ledger, transporte, entries=None, dry_run=False):
    """Chama `_process_round` de PRODUCAO -- mesmo andaime minimo de test_round_delivery_loop.py."""
    state = {"entries": entries if entries is not None else ENTRIES, "deletedIds": []}
    S._TRANSPORT = transporte
    try:
        return S._process_round(_cand(), _manifest(), _obs(), state, ledger, dry_run)
    finally:
        S._TRANSPORT = None


def fresh_runner(store):
    """Um `RoundLedger` NOVO sobre `AtomicRoundLedgerRepo`, apontado para o `store`
    compartilhado -- modela um runner efêmero novo, banco igual. Aponta `S._ROUND_RPC_CALLER`
    para o mesmo `store` a cada chamada (idempotente, seguro para uso sequencial)."""
    S._ROUND_RPC_CALLER = make_round_rpc_caller(store)
    return RoundLedger(S.AtomicRoundLedgerRepo(), now=lambda: int(time.time() * 1000))


def fresh_old_buggy_runner():
    """Modela o repositório de produção ATÉ F8: `put()` nunca sobrevivia ao descarte do
    processo. Um `MemoryRoundLedgerRepo()` NOVO a cada chamada é funcionalmente idêntico ao
    defeito real -- nada persiste entre "execuções", que era exatamente a causa raiz confirmada
    (Issue #221): `SupabaseStateRoundLedgerRepo.put()` só mutava um dict em memória construído
    de um `sb_fetch()` (GET) -- sem NENHUM caminho de escrita de volta ao Supabase."""
    return RoundLedger(MemoryRoundLedgerRepo(), now=lambda: int(time.time() * 1000))


class _Base(unittest.TestCase):
    def setUp(self):
        os.environ["BOLAO_TEST_RUN"] = "1"
        self._orig_fetch_standings = S.fetch_standings
        S.fetch_standings = lambda: TABELA
        self._orig_caller = S._ROUND_RPC_CALLER

    def tearDown(self):
        S.fetch_standings = self._orig_fetch_standings
        S._ROUND_RPC_CALLER = self._orig_caller
        S._TRANSPORT = None


# ── PROVA que o defeito real acontecia -- ANTES de provar que ele foi corrigido ─────────────────
class ProductionIncidentReproduced(_Base):
    def test_old_implementation_resends_every_fresh_runner(self):
        """MODELO DO DEFEITO REAL: 4 execuções agendadas, mesmo resultado do incidente
        (Issue #221 -- run IDs 32092990719/32095864162/32098846982/32101043496, 11
        providerCalls cada, mesma idempotencyKey, round 23)."""
        sends_per_run = []
        for _ in range(4):
            t = Transporte(200)
            roda(fresh_old_buggy_runner(), t)
            sends_per_run.append(len(t.chamadas))
        self.assertEqual(sends_per_run, [N_RECIPIENTS] * 4,
                         f"reprodução do incidente esperava {N_RECIPIENTS} envios em CADA "
                         f"execução (repositório não durável); obteve {sends_per_run}")


# ── A propriedade que o incidente provou faltar ──────────────────────────────────────────────
class FreshRunnerExactlyOnce(_Base):
    def setUp(self):
        super().setUp()
        self.store = FakeRoundNotifStore()

    def test_primeiro_runner_envia_demais_zero(self):
        t1 = Transporte(200)
        r1 = roda(fresh_runner(self.store), t1)
        self.assertEqual(len(t1.chamadas), N_RECIPIENTS)
        self.assertEqual(r1["ledgerState"], ROUND_STATE["SENT"])

        for i in range(3):
            t = Transporte(200)
            roda(fresh_runner(self.store), t)
            self.assertEqual(len(t.chamadas), 0,
                             f"runner fresco #{i+2} reenviou para uma rodada já concluída")

    def test_100_execucoes_sequenciais_zero_duplicatas(self):
        total_calls = 0
        for _ in range(100):
            t = Transporte(200)
            roda(fresh_runner(self.store), t)
            total_calls += len(t.chamadas)
        self.assertEqual(total_calls, N_RECIPIENTS,
                         f"100 execuções deveriam somar {N_RECIPIENTS} chamadas ao todo (só a "
                         f"primeira envia); somaram {total_calls}")

    def test_10_workers_concorrentes_apenas_um_vence_a_corrida(self):
        """Concorrência real via threads, não só chamadas sequenciais.

        `S._TRANSPORT`/`S._ROUND_RPC_CALLER` são globais de módulo -- definidos UMA vez antes
        das threads começarem (não por thread, o que causaria uma corrida na própria variável de
        teste, não no código sob teste). A atomicidade real vem do lock em
        `FakeRoundNotifStore.claim()`, modelando o UPDATE de linha única que o Postgres protege
        nativamente.
        """
        shared_transport = Transporte(200)
        S._TRANSPORT = shared_transport
        S._ROUND_RPC_CALLER = make_round_rpc_caller(self.store)

        resultados_lock = threading.Lock()
        resultados = []

        def worker():
            ledger = RoundLedger(S.AtomicRoundLedgerRepo(), now=lambda: int(time.time() * 1000))
            state = {"entries": ENTRIES, "deletedIds": []}
            antes = len(shared_transport.chamadas)
            S._process_round(_cand(), _manifest(), _obs(), state, ledger, False)
            depois = len(shared_transport.chamadas)
            with resultados_lock:
                resultados.append(depois - antes)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()

        total = sum(resultados)
        self.assertEqual(total, N_RECIPIENTS,
                         f"10 workers concorrentes deveriam somar {N_RECIPIENTS} chamadas ao "
                         f"todo (só um vence a corrida do claim); somaram {total}: {resultados}")

    def test_atomic_round_ledger_repo_claim_atomic_e_atomico_sob_concorrencia(self):
        """O PRIMITIVO em si, isolado de todo o resto do pipeline: duas reivindicações
        concorrentes da MESMA chave nunca podem as duas ter sucesso."""
        repo = S.AtomicRoundLedgerRepo()
        S._ROUND_RPC_CALLER = make_round_rpc_caller(self.store)
        repo.put("br2026:round-results:99:v1", {
            "schemaVersion": 1, "idempotencyKey": "br2026:round-results:99:v1",
            "roundNumber": 99, "state": "READY", "expectedRecipientCount": 1,
            "resolvedRecipientCount": 1, "contentHash": "h", "recipientSetHash": "r",
            "fixtureSetHash": "f", "recipients": [{"entryRef": "e0", "state": "PENDING",
                                                    "providerMessageId": None, "lastError": None}],
            "attemptCount": 0, "claimedBy": None, "leaseUntil": None,
            "createdAt": 0, "updatedAt": 0, "sentAt": None,
        })

        vencedores = []
        lock = threading.Lock()

        def tenta_reivindicar(owner):
            r = repo.claim_atomic("br2026:round-results:99:v1", owner,
                                  int(time.time() * 1000) + 300_000, int(time.time() * 1000))
            if r is not None:
                with lock:
                    vencedores.append(owner)

        threads = [threading.Thread(target=tenta_reivindicar, args=(f"owner-{i}",))
                  for i in range(10)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()

        self.assertEqual(len(vencedores), 1,
                         f"exatamente UM worker deveria reivindicar; venceram {vencedores}")


# ── Parcial / incerto ─────────────────────────────────────────────────────────────────────────
class PartialAndUncertainAcrossRunners(_Base):
    def setUp(self):
        super().setUp()
        self.store = FakeRoundNotifStore()

    def test_parcial_e_retentado_so_pelo_que_falhou_em_runner_novo(self):
        """10 destinatários, 9 aceitos, 1 falha ANTES do provedor aceitar. Próximo runner
        fresco: providerCalls = 1 (só o que falhou). Depois: providerCalls = 0."""
        dez_entries = [entrada(i) for i in range(10)]
        t1 = Transporte(lambda n: 500 if n == 10 else 200)
        r1 = roda(fresh_runner(self.store), t1, entries=dez_entries)
        self.assertEqual(len(t1.chamadas), 10)
        self.assertEqual(r1["ledgerState"], ROUND_STATE["PARTIAL"])
        self.assertEqual(r1["accepted"], 9)
        self.assertEqual(r1["failed"], 1)

        t2 = Transporte(200)
        r2 = roda(fresh_runner(self.store), t2, entries=dez_entries)
        self.assertEqual(len(t2.chamadas), 1, "runner fresco deveria retentar só quem falhou")
        self.assertEqual(r2["ledgerState"], ROUND_STATE["SENT"])

        t3 = Transporte(200)
        roda(fresh_runner(self.store), t3, entries=dez_entries)
        self.assertEqual(len(t3.chamadas), 0, "rodada concluída não pode reenviar num 3º runner")

    def test_incerto_apos_crash_pos_provedor_nunca_e_reenviado_automaticamente(self):
        """Exceção DEPOIS do POST (provedor pode ter aceitado) -- runner seguinte NÃO pode
        reenviar automaticamente, mesmo sendo um processo totalmente novo."""
        uma_entry = [entrada(0)]
        t1 = Transporte(RuntimeError("conexao caiu apos o POST"))
        r1 = roda(fresh_runner(self.store), t1, entries=uma_entry)
        self.assertEqual(r1["uncertain"], 1)
        self.assertEqual(r1["ledgerState"], ROUND_STATE["NEEDS_MANUAL_REVIEW"])

        t2 = Transporte(200)
        roda(fresh_runner(self.store), t2, entries=uma_entry)
        self.assertEqual(len(t2.chamadas), 0,
                         "runner fresco reenviou automaticamente um destinatário INCERTO")

    def test_sending_orfao_e_recuperado_por_um_runner_novo_como_incerto(self):
        """Dono anterior morre entre o POST e o registro do desfecho (SENDING nunca fecha).
        Um runner NOVO precisa recuperar o lease vencido -- não travar para sempre, e não
        reenviar automaticamente."""
        uma_entry = [entrada(0)]
        led = fresh_runner(self.store)
        roda(led, Transporte(200), entries=uma_entry, dry_run=True)   # cria o job com hash real
        led.claim(RODADA, "dono-morto")
        led.mark_sending(RODADA)
        led.record_recipient(RODADA, "e0", RECIPIENT_STATE["SENDING"])

        # lease vencido: o dono nunca mais volta
        reg = led.repo.get(f"br2026:round-results:{RODADA}:v1")
        led.repo.put(f"br2026:round-results:{RODADA}:v1", dict(reg, leaseUntil=1))

        led_novo = fresh_runner(self.store)
        recuperados = led_novo.recover_expired_leases()
        self.assertEqual(len(recuperados), 1, "runner novo não recuperou o lease vencido")
        self.assertEqual(led_novo.get(RODADA)["state"], ROUND_STATE["NEEDS_MANUAL_REVIEW"])

        t = Transporte(200)
        roda(fresh_runner(self.store), t, entries=uma_entry)
        self.assertEqual(len(t.chamadas), 0,
                         "runner novo reenviou para um destinatário INCERTO recuperado")


# ── Fiação de produção -- pega a mutação de volta para o repositório não durável ────────────────
class ProductionWiring(unittest.TestCase):
    """CONTRATO: `run_auto` tem de construir `AtomicRoundLedgerRepo`, nunca um repositório que
    não sobrevive ao descarte do processo. Todos os testes acima provam a PROPRIEDADE contra um
    dublê; este prova que o caminho de produção de fato usa o repositório que tem essa
    propriedade -- sem isto, alguém poderia reverter `run_auto` para `MemoryRoundLedgerRepo()`
    (ou reintroduzir algo como o antigo `SupabaseStateRoundLedgerRepo`) e nenhum teste acima
    perceberia, porque todos constroem o repositório explicitamente."""

    def test_run_auto_usa_o_repositorio_atomico(self):
        import inspect
        fonte = inspect.getsource(S.run_auto)
        codigo = "\n".join(l for l in fonte.split("\n") if not l.strip().startswith("#"))
        self.assertIn("repo = AtomicRoundLedgerRepo()", codigo,
                     "run_auto() deixou de construir AtomicRoundLedgerRepo -- o ledger de "
                     "rodada pode ter voltado a não ser durável entre execuções")
        self.assertNotIn("SupabaseStateRoundLedgerRepo", codigo,
                         "run_auto() voltou a referenciar o repositório não durável removido "
                         "no Issue #221")

    def test_atomic_ledger_available_sonda_a_dependencia_real(self):
        """Sonda a mesma tabela que `AtomicRoundLedgerRepo` de fato usa -- não uma tabela
        diferente (bolao_notif_jobs) que ficaria "disponível" mesmo com a migração 030
        ausente."""
        import inspect
        fonte = inspect.getsource(S.atomic_ledger_available)
        self.assertIn("list_bolao_notif_round_jobs", fonte,
                     "atomic_ledger_available() parou de sondar a dependência real do ledger "
                     "de rodada")


if __name__ == "__main__":
    unittest.main(verbosity=2)
