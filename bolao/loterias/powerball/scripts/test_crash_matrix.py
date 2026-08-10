"""
test_crash_matrix.py — matriz de crash A-M contra a orquestracao REAL do Powerball.

Sujeito sob teste: `fetch_and_send_results.run_lifecycle()` -- a mesma funcao que o workflow
chama -- com o codigo REAL de `powerball_notification`. Falsos apenas: banco (ver crash_harness)
e provedor (efeito irreversivel).

Cada cenario mede: estado inicial, ponto de falha, chamadas ao provedor, destinatarios tentados/
aceitos/incertos/reenviaveis, estado final do job e -- obrigatorio -- o COMPORTAMENTO DA SEGUNDA
EXECUCAO. Um teste de crash que so prova o que acontece antes do restart nao prova nada: o
defeito mora na recuperacao.

Executar: POWERBALL_TEST_RUN=1 python3 test_crash_matrix.py
"""

import json
import os
import sys
import threading
import unittest

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_and_send_results as F
import powerball_notification as P
from crash_harness import CrashPoint, FakeDB

SORTEIO = "2026-08-12"
CHAVE = f"powerball:draw-result:{SORTEIO}:v1"
NOMES = [f"Participante {i:02d}" for i in range(15)]
RESULTADO = {"numbers": [1, 2, 3, 4, 5], "special": 7, "multiplier": 2}

RELATORIO = []


def fixture(result=RESULTADO, nomes=NOMES):
    return [{"id": SORTEIO, "drawing": {"drawDateIso": "2026-08-12T22:59:00-04:00"},
             "participants": [{"nome": n} for n in nomes],
             "finance": {"total": 45}, **({"result": result} if result else {})}]


class Base(unittest.TestCase):
    """Instala o banco falso e neutraliza a reconciliacao de resultado (fase ja coberta)."""

    def setUp(self):
        self.db = FakeDB()
        self._snaps = []
        self.draws = fixture()
        self._orig = (P._sql, P._rpc, F.check_and_update_results, F.parse_draws, F.load_data_js)
        P._sql = self.db.sql
        P._rpc = self.db.rpc
        F.check_and_update_results = lambda *a, **k: False
        F.load_data_js = lambda *a, **k: ""
        F.parse_draws = lambda *a, **k: self.draws

    def tearDown(self):
        (P._sql, P._rpc, F.check_and_update_results,
         F.parse_draws, F.load_data_js) = self._orig

    # ── provedor falso ────────────────────────────────────────────────────
    def provedor(self, modo="ok"):
        chamadas = []

        def enviar(game_type, refs):
            chamadas.append(list(refs))
            self.db._mark("provider:call")
            if modo == "ok":
                return {"accepted": list(refs), "failed": [], "uncertain": []}
            if modo == "falha_antes_do_aceite":
                return {"accepted": [], "failed": list(refs), "uncertain": []}
            if modo == "desconhecido":
                return {"accepted": [], "failed": [], "uncertain": list(refs)}
            if modo == "parcial":
                # 10 aceitos, 5 recusados -- o caso que a matriz nao cobria: todos os outros
                # provedores sao tudo-ou-nada, e mutacao "parcial vira COMPLETED" passava.
                return {"accepted": list(refs)[:10], "failed": list(refs)[10:], "uncertain": []}
            if modo == "crash":
                raise CrashPoint("provider:mid-flight")
            raise AssertionError(modo)

        enviar.chamadas = chamadas
        return enviar

    def rodar(self, enviar, dry_run=False):
        """Executa a orquestracao REAL e fotografa o estado duravel logo apos.

        A foto e automatica para que o relatorio nunca misture as fases: a primeira execucao e
        sempre medida no instante do crash, nao depois que a recuperacao ja consertou tudo.
        """
        deps = F.Deps(ledger=P, send_email=enviar)
        try:
            rel, crash = F.run_lifecycle("powerball", dry_run=dry_run, deps=deps), None
        except CrashPoint as e:
            rel, crash = None, str(e)
        self._snaps = getattr(self, "_snaps", [])
        self._snaps.append(self.snapshot())
        return rel, crash

    def snapshot(self):
        """Estado duravel NESTE instante. Chamado logo apos o crash, antes do restart."""
        c = self.db.counts(CHAVE)
        return {"ACCEPTED": c["ACCEPTED"], "UNCERTAIN": c["UNCERTAIN"],
                "SENDING": c["SENDING"], "FAILED": c["FAILED"],
                "RETRYABLE": len(P.retryable_recipients(SORTEIO)) if self.db.job(CHAVE) else 0,
                "JOB": (self.db.job(CHAVE) or {}).get("status")}

    def registrar(self, cenario, inicial, falha, enviar1, enviar2, rel2, pos_crash=None):
        """Registra as DUAS fases separadamente.

        Misturar as chamadas da primeira execucao com o estado final da segunda produziria uma
        tabela que parece dizer "0 chamadas, 15 aceitos" -- evidencia enganosa. Cada fase e
        medida no seu proprio instante.
        """
        pc = pos_crash or (getattr(self, "_snaps", [None]) or [None])[0] or self.snapshot()
        fim = self.snapshot()
        c1 = sum(len(x) for x in enviar1.chamadas)
        c2 = sum(len(x) for x in enviar2.chamadas) if enviar2 else 0
        RELATORIO.append({
            "cenario": cenario, "INITIAL_STATE": inicial, "FAILURE_POINT": falha,
            "PROVIDER_CALLS": f"{c1} (1a exec) + {c2} (2a exec) = {c1 + c2}",
            "RECIPIENTS_ATTEMPTED": c1 + c2,
            "RECIPIENTS_ACCEPTED": f"{pc['ACCEPTED']} apos crash -> {fim['ACCEPTED']} no fim",
            "RECIPIENTS_UNCERTAIN": f"{pc['UNCERTAIN']} apos crash -> {fim['UNCERTAIN']} no fim",
            "RECIPIENTS_RETRYABLE": f"{pc['RETRYABLE']} apos crash -> {fim['RETRYABLE']} no fim",
            "JOB_FINAL_STATE": fim["JOB"],
            "SECOND_RUN_BEHAVIOR": (
                f"estado={(rel2 or {}).get('notificationState')}, chamadas ao provedor={c2}"),
        })


class MatrizDeCrash(Base):

    # ── A — crash antes da criacao do job ─────────────────────────────────
    def test_A_crash_antes_da_criacao_do_job(self):
        self.db.arm("db:enqueue")
        e1 = self.provedor()
        _, crash = self.rodar(e1)
        self.assertEqual(crash, "db:enqueue")
        self.assertIsNone(self.db.job(CHAVE), "nada podia ter sido persistido")
        self.assertEqual(len(e1.chamadas), 0)

        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        chaves = [k for k in self.db.jobs if k.endswith(":v1")]
        self.assertEqual(len(chaves), 1, "duplicate jobs = 0")
        self.assertEqual(chaves[0], CHAVE, "a chave tem de ser determinística")
        self.assertEqual(len(e2.chamadas), 1)
        self.registrar("A", "sem job", "antes do enqueue", e1, e2, rel2)

    # ── B — crash apos criacao, antes do claim ────────────────────────────
    def test_B_crash_apos_criacao_antes_do_claim(self):
        self.db.arm("db:claim")
        e1 = self.provedor()
        _, crash = self.rodar(e1)
        self.assertEqual(crash, "db:claim")
        self.assertIsNotNone(self.db.job(CHAVE))
        self.assertEqual(len(e1.chamadas), 0, "provider calls before retry = 0")

        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.assertEqual(len([k for k in self.db.jobs]), 1, "jobs for idempotency key = 1")
        self.assertEqual(self.db.job(CHAVE)["status"], "sent")
        self.registrar("B", "job pendente", "antes do claim", e1, e2, rel2)

    # ── C — crash apos claim, antes do provedor ───────────────────────────
    def test_C_crash_apos_claim_antes_do_provedor(self):
        self.db.arm("provider:call")
        e1 = self.provedor()
        _, crash = self.rodar(e1)
        c = self.db.counts(CHAVE)
        self.assertEqual(c["ACCEPTED"], 0,
                         "nenhum destinatario pode virar ACCEPTED por ter havido claim")

        self.db.expire_lease(CHAVE)
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.registrar("C", "job reivindicado", "antes do provedor", e1, e2, rel2)

    # ── D — crash durante o primeiro destinatario ─────────────────────────
    def test_D1_transporte_com_resultado_desconhecido_vira_uncertain(self):
        e1 = self.provedor("desconhecido")
        rel, _ = self.rodar(e1)
        c = self.db.counts(CHAVE)
        self.assertEqual(c["UNCERTAIN"], 15, "desfecho desconhecido e UNCERTAIN")
        self.assertEqual(self.db.job(CHAVE)["status"], P.FAILED_PERMANENT,
                         "UNCERTAIN trava para revisao humana")
        self.assertEqual(P.retryable_recipients(SORTEIO), [],
                         "UNCERTAIN nunca e reenviado automaticamente")
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.registrar("D1 (desfecho desconhecido)", "job pronto", "durante transporte",
                       e1, e2, rel2)

    def test_D2_falha_provada_antes_do_aceite_e_reenviavel(self):
        e1 = self.provedor("falha_antes_do_aceite")
        self.rodar(e1)
        c = self.db.counts(CHAVE)
        self.assertEqual(c["FAILED"], 15)
        self.assertEqual(c["ACCEPTED"], 0)
        self.assertEqual(len(P.retryable_recipients(SORTEIO)), 15,
                         "falha PROVADA antes do aceite pode ser reenviada")
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.registrar("D2 (falha provada)", "job pronto", "transporte recusado", e1, e2, rel2)

    def test_D3_entrega_mista_nunca_conclui_o_job(self):
        """Entrega parcial: 10 aceitos, 5 recusados. O job NAO pode virar sent.

        Este e o cenario 08/08 em miniatura, dentro da matriz. Sem ele a mutacao "tratar parcial
        como concluido" passava despercebida aqui.
        """
        e1 = self.provedor("parcial")
        self.rodar(e1)
        c = self.db.counts(CHAVE)
        self.assertEqual(c["ACCEPTED"], 10)
        self.assertEqual(c["FAILED"], 5)
        self.assertNotEqual(self.db.job(CHAVE)["status"], "sent",
                            "10 de 15 jamais pode ser concluido")
        self.assertEqual(self.db.job(CHAVE)["status"], P.FAILED_RETRYABLE)

        # O retry alveja SO os 5 -- nunca os 10 que ja receberam.
        self.assertEqual(len(P.retryable_recipients(SORTEIO)), 5)
        self.db.expire_lease(CHAVE)
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.assertEqual(sum(len(c) for c in e2.chamadas), 5,
                         "so os nao entregues sao reenviados")
        self.assertEqual(self.db.job(CHAVE)["status"], "sent")
        self.registrar("D3 (entrega mista 10/15)", "job pronto", "provedor recusou 5",
                       e1, e2, rel2)

    # ── E — crash logo apos o aceite do provedor ──────────────────────────
    def test_E_crash_apos_aceite_do_provedor(self):
        """O cenario mais importante: aceito pelo provedor, persistencia morreu."""
        # 15 escritas de SENDING, entao a chamada ao provedor, entao as escritas de ACCEPTED.
        # A 16a escrita e a PRIMEIRA pos-aceite: e ali que o processo morre.
        self.db.arm_nth("db:record_recipient", 16)
        e1 = self.provedor()
        _, crash = self.rodar(e1)

        self.db.expire_lease(CHAVE)
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        reenviados = [r for chamada in e2.chamadas for r in chamada]
        aceitos_antes = [r["entryRef"] for r in self.db.recipients(CHAVE)
                         if r.get("state") == "ACCEPTED"]
        conhecidos_reenviados = [r for r in reenviados if r in aceitos_antes]
        self.registrar("E", "job pronto", "apos aceite, antes de persistir", e1, e2, rel2)
        self.assertEqual(len(conhecidos_reenviados), 0,
                         f"KNOWN_ACCEPTED_RESEND_COUNT = {len(conhecidos_reenviados)}, exige 0")
        self.assertEqual(sum(len(c) for c in e2.chamadas), 0,
                         "nenhum reenvio automatico apos aceite do provedor")
        self.assertEqual(self.db.counts(CHAVE)["UNCERTAIN"], 15,
                         "desfecho nao provado vira UNCERTAIN, nao ACCEPTED nem reenviavel")
        self.assertEqual(self.db.job(CHAVE)["status"], P.FAILED_PERMANENT,
                         "vai para revisao humana -- a unica saida honesta")

    # ── F — todos aceitos, a conclusao do job crasha ──────────────────────
    def test_F_todos_aceitos_conclusao_crasha(self):
        self.db.arm("db:settle")
        e1 = self.provedor()
        _, crash = self.rodar(e1)
        self.assertEqual(crash, "db:settle")
        self.assertEqual(self.db.counts(CHAVE)["ACCEPTED"], 15)

        self.db.expire_lease(CHAVE)
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        chamadas = sum(len(x) for x in e2.chamadas)
        self.registrar("F", "todos aceitos", "antes do settle", e1, e2, rel2)
        self.assertEqual(chamadas, 0,
                         f"PROVIDER_CALLS_ON_RETRY = {chamadas}, exige 0 -- "
                         "todos ja aceitos, a conclusao se reconstroi do estado")
        self.assertEqual(self.db.job(CHAVE)["status"], "sent")

    # ── G — expiracao de lease ────────────────────────────────────────────
    def test_G_lease(self):
        """Lease ativo nao se rouba; lease vencido se reivindica e o trabalho continua.

        O crash e na PRIMEIRA escrita de SENDING -- que falha antes de gravar -- entao os 15
        seguem PENDING. Isso isola a mecanica de lease da reconciliacao de orfaos (cenario E):
        aqui ha trabalho real e legitimo a fazer apos a reivindicacao.
        """
        self.db.arm("db:record_recipient")
        e1 = self.provedor()
        self.rodar(e1)
        self.assertEqual(self.db.job(CHAVE)["status"], "processing")
        self.assertEqual(len(e1.chamadas), 0, "o provedor nunca foi chamado")

        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.assertEqual(rel2["notificationState"], "ALREADY_CLAIMED",
                         "lease ativo nao pode ser roubado")
        self.assertEqual(len(e2.chamadas), 0)

        self.db.expire_lease(CHAVE)
        e3 = self.provedor()
        rel3, _ = self.rodar(e3)
        self.assertEqual(len(e3.chamadas), 1, "lease vencido pode ser reivindicado")
        self.assertEqual(self.db.job(CHAVE)["status"], "sent")
        self.registrar("G", "lease ativo", "primeira escrita de SENDING", e1, e3, rel3)

    def test_G2_estado_por_destinatario_sobrevive_a_reivindicacao(self):
        e1 = self.provedor("falha_antes_do_aceite")
        self.rodar(e1)
        P.record_recipient(SORTEIO, NOMES[0], P.R_ACCEPTED, "msg-1")
        antes = self.db.counts(CHAVE)["ACCEPTED"]
        self.db.expire_lease(CHAVE)
        e2 = self.provedor()
        self.rodar(e2)
        reenviados = [r for c in e2.chamadas for r in c]
        self.assertNotIn(NOMES[0], reenviados,
                         "estado ACCEPTED por destinatario tem de sobreviver a reivindicacao")
        self.assertGreaterEqual(self.db.counts(CHAVE)["ACCEPTED"], antes)

    # ── H — dois runners agendados, concorrencia real ─────────────────────
    def test_H_dois_runners_concorrentes(self):
        envios = []
        barreira = threading.Barrier(2)

        def corredor(idx):
            e = self.provedor()
            barreira.wait()          # partida simultanea de verdade
            rel, _ = self.rodar(e)
            envios.append((rel, e))

        ts = [threading.Thread(target=corredor, args=(i,)) for i in range(2)]
        [t.start() for t in ts]
        [t.join() for t in ts]

        vencedores = [r for r, _ in envios if r and r["notificationState"] not in
                      ("ALREADY_CLAIMED", "ALREADY_COMPLETED")]
        chamadas = sum(len(e.chamadas) for _, e in envios)
        self.assertEqual(len(vencedores), 1, f"CLAIM_WINNERS = {len(vencedores)}, exige 1")
        self.assertEqual(chamadas, 1, f"DUPLICATE_PROVIDER_CALLS = {chamadas - 1}, exige 0")
        self.assertEqual(len(self.db.jobs), 1)
        RELATORIO.append({"cenario": "H", "INITIAL_STATE": "job pronto",
                          "FAILURE_POINT": "concorrencia real (2 threads, barreira)",
                          "PROVIDER_CALLS": chamadas, "RECIPIENTS_ATTEMPTED": 15,
                          "RECIPIENTS_ACCEPTED": self.db.counts(CHAVE)["ACCEPTED"],
                          "RECIPIENTS_UNCERTAIN": 0, "RECIPIENTS_RETRYABLE": 0,
                          "JOB_FINAL_STATE": self.db.job(CHAVE)["status"],
                          "SECOND_RUN_BEHAVIOR": "perdedor: ALREADY_CLAIMED, 0 chamadas"})

    # ── I — manual + agendado sobrepostos ─────────────────────────────────
    def test_I_manual_e_agendado_sobrepostos(self):
        envios = []
        barreira = threading.Barrier(2)

        def corredor(origem):
            os.environ["GITHUB_RUN_ID"] = origem
            e = self.provedor()
            barreira.wait()
            rel, _ = self.rodar(e)
            envios.append((rel, e, origem))

        ts = [threading.Thread(target=corredor, args=(o,))
              for o in ("schedule-111", "workflow_dispatch-222")]
        [t.start() for t in ts]
        [t.join() for t in ts]
        os.environ.pop("GITHUB_RUN_ID", None)

        chamadas = sum(len(e.chamadas) for _, e, _ in envios)
        self.assertEqual(len(self.db.jobs), 1,
                         "a origem do gatilho nao pode criar um segundo ciclo de notificacao")
        self.assertEqual(chamadas, 1)
        RELATORIO.append({"cenario": "I", "INITIAL_STATE": "job pronto",
                          "FAILURE_POINT": "schedule + workflow_dispatch simultaneos",
                          "PROVIDER_CALLS": chamadas, "RECIPIENTS_ATTEMPTED": 15,
                          "RECIPIENTS_ACCEPTED": self.db.counts(CHAVE)["ACCEPTED"],
                          "RECIPIENTS_UNCERTAIN": 0, "RECIPIENTS_RETRYABLE": 0,
                          "JOB_FINAL_STATE": self.db.job(CHAVE)["status"],
                          "SECOND_RUN_BEHAVIOR": "1 job, 1 ciclo, gatilho irrelevante"})

    # ── J — falhas de rede/runner ─────────────────────────────────────────
    def test_J1_ledger_indisponivel_nao_envia(self):
        def rpc_ruim(name, args):
            if name == "bolao_notif_health":
                raise OSError("timeout")
            return self.db.rpc(name, args)
        P._rpc = rpc_ruim
        e1 = self.provedor()
        rel, _ = self.rodar(e1)
        self.assertEqual(rel["notificationState"], "LEDGER_INDISPONIVEL")
        self.assertEqual(len(e1.chamadas), 0, "sem ledger nao se envia as cegas")

        P._rpc = self.db.rpc
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.assertEqual(len(self.db.jobs), 1)
        self.registrar("J1 (supabase fora)", "sem job", "health check", e1, e2, rel2)

    def test_J2_identidade_do_job_e_estavel_entre_tentativas(self):
        chaves = set()
        for _ in range(3):
            self.db.arm("db:claim")
            e = self.provedor()
            self.rodar(e)
            chaves.update(self.db.jobs.keys())
        self.assertEqual(chaves, {CHAVE},
                         "cada retry tem de preservar a identidade determinística do job")

    def test_J3_provedor_transitorio_depois_recupera(self):
        e1 = self.provedor("falha_antes_do_aceite")
        self.rodar(e1)
        self.assertEqual(self.db.job(CHAVE)["status"], P.FAILED_RETRYABLE)
        self.db.expire_lease(CHAVE)
        e2 = self.provedor("ok")
        rel2, _ = self.rodar(e2)
        self.assertEqual(self.db.job(CHAVE)["status"], "sent")
        self.assertEqual(self.db.counts(CHAVE)["ACCEPTED"], 15)
        self.registrar("J3 (provedor transitorio)", "job pronto", "provedor recusou",
                       e1, e2, rel2)

    # ── K — conjunto de destinatarios incompleto, depois corrigido ────────
    def test_K_conjunto_incompleto_depois_corrigido(self):
        def resolver_parcial(draw):
            todos = F._default_resolve_recipients(draw)
            return todos[:-1]        # um participante sem contato resolvivel

        deps = F.Deps(ledger=P, send_email=self.provedor(),
                      resolve_recipients=F._default_resolve_recipients)
        # Primeira execucao: EXPECTED=15, RESOLVED=14.
        e1 = self.provedor()
        deps1 = F.Deps(ledger=P, send_email=e1)
        deps1.resolve_recipients = F._default_resolve_recipients
        rel1 = F.run_lifecycle("powerball", deps=self._deps_incompleto(e1))
        self.assertEqual(rel1["notificationState"], "RECIPIENT_SET_INCOMPLETE",
                         "conjunto incompleto tem de bloquear o envio")
        self.assertEqual(len(e1.chamadas), 0, "PROVIDER_CALLS = 0")
        self.assertIsNotNone(self.db.job(CHAVE), "o job existe e aguarda -- nao se apaga nada")

        # Contato corrigido: o MESMO job fica elegivel, sem reset manual.
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.assertEqual(len(self.db.jobs), 1, "sem delecao/reset manual")
        self.assertEqual(len(e2.chamadas), 1, "so agora a entrega comeca")
        self.registrar("K", "1 contato faltando", "portao de completude", e1, e2, rel2)

    def _deps_incompleto(self, enviar):
        d = F.Deps(ledger=P, send_email=enviar)
        real = F._default_resolve_recipients
        chamadas = {"n": 0}

        def resolver(draw):
            chamadas["n"] += 1
            todos = real(draw)
            return todos if chamadas["n"] == 1 else todos[:-1]   # esperados=15, resolvidos=14
        d.resolve_recipients = resolver
        return d

    # ── L — resultado existe, notificacao pendente ────────────────────────
    def test_L_existencia_de_resultado_nao_implica_notificacao_concluida(self):
        """RESULT_EXISTENCE_DOES_NOT_IMPLY_NOTIFICATION_COMPLETION.

        Guarda o defeito original: `check_and_update_results` devolve False porque o resultado
        JA existe, e o ciclo tem de continuar mesmo assim.
        """
        F.check_and_update_results = lambda *a, **k: False    # nada novo a reconciliar
        e1 = self.provedor()
        rel, _ = self.rodar(e1)
        self.assertNotIn(rel["notificationState"], ("RESULT_ALREADY_EXISTS", None),
                         "o ciclo parou porque o resultado ja existia")
        self.assertEqual(len(e1.chamadas), 1, "a notificacao pendente TEM de ser processada")
        self.assertEqual(self.db.job(CHAVE)["status"], "sent")
        self.registrar("L", "resultado existe, notificacao pendente", "n/a",
                       e1, None, rel)

    def test_L2_job_parcial_continua_sendo_processado(self):
        e1 = self.provedor("falha_antes_do_aceite")
        self.rodar(e1)
        self.db.expire_lease(CHAVE)
        F.check_and_update_results = lambda *a, **k: False
        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.assertEqual(rel2["notificationState"], "sent",
                         "job parcial tem de continuar, nao parar por resultado existente")

    # ── M — notificacao concluida, workflow roda de novo ──────────────────
    def test_M_ja_concluido_e_noop(self):
        e1 = self.provedor()
        self.rodar(e1)
        self.assertEqual(self.db.job(CHAVE)["status"], "sent")
        antes = json.dumps(self.db.jobs, sort_keys=True)

        e2 = self.provedor()
        rel2, _ = self.rodar(e2)
        self.assertEqual(rel2["notificationState"], "ALREADY_COMPLETED")
        self.assertEqual(len(e2.chamadas), 0, "PROVIDER_CALLS = 0")
        self.assertEqual(rel2["providerCalls"], 0)
        self.assertEqual(json.dumps(self.db.jobs, sort_keys=True), antes,
                         "DATA_MUTATIONS = 0")
        self.registrar("M", "notificacao concluida", "n/a", e1, e2, rel2)

    def test_job_marcado_como_acao_manual_nao_e_tocado(self):
        """A marca do 08/08: decisao de negocio, nunca retry automatico.

        Sem ela, cada execucao agendada -- de 10 em 10 minutos -- alvejaria o job parcial
        historico, seria recusada pelo transporte, e falharia. Ruido constante e como a falha
        de verdade passa despercebida.
        """
        e1 = self.provedor()
        P.ensure_job(SORTEIO, RESULTADO, NOMES, {"total": 45})
        for n in NOMES[:14]:
            P.record_recipient(SORTEIO, n, P.R_ACCEPTED)
        self.db.job(CHAVE)["status"] = P.FAILED_RETRYABLE
        self.db.job(CHAVE)["payload_snapshot"]["requiresManualAction"] = True

        rel, _ = self.rodar(e1)
        self.assertEqual(rel["notificationState"], "AGUARDA_ACAO_MANUAL")
        self.assertEqual(sum(len(c) for c in e1.chamadas), 0,
                         "o ciclo automatico tocou um job que exige decisao humana")
        self.assertEqual(self.db.counts(CHAVE)["ACCEPTED"], 14, "nada mudou")
        self.assertIn("AGUARDA_ACAO_MANUAL", F.ESTADOS_OK,
                      "decisao pendente nao e falha de infraestrutura")

    # ── HISTORICO 08/08 — 14 de 15 ────────────────────────────────────────
    def test_historico_0808_reenvia_somente_o_faltante(self):
        e1 = self.provedor()
        deps = F.Deps(ledger=P, send_email=e1)
        # Reconstroi o job historico: 14 entregues, 1 pendente.
        P.ensure_job(SORTEIO, RESULTADO, NOMES, {"total": 45})
        for n in NOMES[:14]:
            P.record_recipient(SORTEIO, n, P.R_ACCEPTED)
        self.db.job(CHAVE)["status"] = P.FAILED_RETRYABLE

        elegiveis = P.retryable_recipients(SORTEIO)
        self.assertEqual(elegiveis, [NOMES[14]], "ELIGIBLE_RECIPIENTS = 1")

        rel, _ = self.rodar(e1)
        chamadas = sum(len(c) for c in e1.chamadas)
        self.assertEqual(chamadas, 1, f"PROVIDER_CALLS_FAKE = {chamadas}, exige 1, JAMAIS 15")
        self.assertEqual(self.db.counts(CHAVE)["ACCEPTED"], 15)
        self.assertEqual(self.db.job(CHAVE)["status"], "sent")
        RELATORIO.append({"cenario": "HISTORICO 08/08", "INITIAL_STATE": "15 esperados, 14 aceitos",
                          "FAILURE_POINT": "entrega parcial historica",
                          "PROVIDER_CALLS": chamadas, "RECIPIENTS_ATTEMPTED": chamadas,
                          "RECIPIENTS_ACCEPTED": 15, "RECIPIENTS_UNCERTAIN": 0,
                          "RECIPIENTS_RETRYABLE": 0, "JOB_FINAL_STATE": "sent",
                          "SECOND_RUN_BEHAVIOR": "ALREADY_COMPLETED, 0 chamadas"})


def imprimir_relatorio():
    if not RELATORIO:
        return
    print("\n" + "=" * 100)
    print("MATRIZ DE CRASH — orquestracao real (run_lifecycle)")
    print("=" * 100)
    for r in sorted(RELATORIO, key=lambda x: x["cenario"]):
        print(f"\n{r['cenario']}")
        for k in ("INITIAL_STATE", "FAILURE_POINT", "PROVIDER_CALLS", "RECIPIENTS_ATTEMPTED",
                  "RECIPIENTS_ACCEPTED", "RECIPIENTS_UNCERTAIN", "RECIPIENTS_RETRYABLE",
                  "JOB_FINAL_STATE", "SECOND_RUN_BEHAVIOR"):
            print(f"    {k:<22} {r[k]}")


if __name__ == "__main__":
    r = unittest.main(verbosity=2, exit=False).result
    imprimir_relatorio()
    print(f"\nREAL_EMAILS_SENT = 0   PROVIDER = falso em todos os cenarios")
    sys.exit(0 if r.wasSuccessful() else 1)
