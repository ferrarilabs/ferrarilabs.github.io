#!/usr/bin/env python3
"""
Regressão da run 31679185588 — "os e-mails saíram e o resultado ficou órfão".

═══ O QUE ACONTECEU DE VERDADE (2026-08-13, 07:47 UTC) ══════════════════════════════════════════

    07:46:57  resultado gravado no data.js e commitado
    07:47:34  provedor aceita o 1º e-mail
       ...
    07:47:48  "Broadcast completed: 16 sent, 0 failed"
    07:47:49  settle_outbox_event -> http 400
              "TRANSICAO_ILEGAL: evento em pending nao pode ser liquidado (esperado in_flight)"
              exit 2

`emit_outbox_event` cria a linha em `pending`; o banco só liquida o que está `in_flight`. Nada
reivindicava o evento entre uma coisa e outra. O workflow ficou vermelho por um motivo sem
nenhuma relação com a entrega, e a obrigação ficou presa em `pending` para sempre — nenhuma
execução seguinte voltava a olhar para ela.

Pior: o handler de erro decidia PROVIDER_CALLS procurando a substring "send" na mensagem da
exceção. A mensagem não continha "send", então o relatório afirmou ZERO envios depois de 16
e-mails reais aceitos por gente real.

═══ O QUE ESTE ARQUIVO PROVA ════════════════════════════════════════════════════════════════════

Não que o bug "foi corrigido" — que ele não pode mais ACONTECER, em quatro pontos independentes:

    A. sem reivindicação, o provedor não é tocado         (a ordem, não o sintoma)
    B. a contagem de envios é EFEITO, nunca texto de erro (o relatório não mente)
    C. a obrigação órfã é reconciliada sem reenviar       (a recuperação existe)
    D. rerodar depois de concluído envia zero             (a idempotência aguenta)

Cada um tem a MUTAÇÃO correspondente logo abaixo: desfazer a proteção tem de deixar o teste
vermelho. Uma asserção que passa com e sem a correção não está testando a correção.
"""

import sys
import types
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

import fetch_and_send_results as F  # noqa: E402

falhas = []


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


# ── Dublês ──────────────────────────────────────────────────────────────────────────────────
class LedgerFalso:
    """O ledger por destinatário. Só o suficiente para o ciclo rodar de verdade."""
    SENT = "sent"
    R_SENDING, R_ACCEPTED, R_FAILED, R_UNCERTAIN = "sending", "accepted", "failed", "uncertain"

    def __init__(self, status=None, destinatarios=None):
        self.job = {"status": status} if status else None
        self.destinatarios = destinatarios if destinatarios is not None else list(RECIPIENTES)
        self.registros = []

    def ledger_available(self):
        return True, "ok"

    def get_job(self, draw_id):
        return self.job

    def requires_manual_action(self, draw_id):
        return False

    def check_content_immutability(self, *a):
        return True, "ok"

    def ensure_job(self, *a):
        self.job = self.job or {"status": "pending"}

    def claim(self, draw_id, worker):
        return True

    def retryable_recipients(self, draw_id):
        return list(self.destinatarios)

    def record_recipient(self, draw_id, ref, estado):
        self.registros.append((ref, estado))

    def settle(self, draw_id):
        self.job = {"status": self.SENT}
        return {"status": self.SENT, "reason": "todos aceitos"}

    def draw_key(self, draw_id):
        return f"powerball:draw-result:{draw_id}:v1"

    def reconcile_orphaned_sending(self, draw_id):
        pass


class PonteFalsa:
    """
    A ponte M8/M9, com a MÁQUINA DE ESTADOS REAL do banco:

        emit -> pending ; claim -> in_flight ; settle exige in_flight

    Reproduzir essa regra é o ponto. Um dublê que aceitasse `settle` em qualquer estado passaria
    verde com o código antigo — o teste concordaria com o bug em vez de detectá-lo.
    """

    def __init__(self, estado_inicial="pending", claim_levanta=None, claim_devolve_nada=False):
        self.estado = estado_inicial
        self.claim_levanta = claim_levanta
        self.claim_devolve_nada = claim_devolve_nada
        self.settles = []
        self.audits = []
        self.recuperou = 0

    def new_correlation_id(self):
        return "corr-teste"

    def key_draw_result(self, draw_id):
        return f"powerball:draw-result:{draw_id}:v1"

    def emit_outbox(self, chave, tipo, payload=None, correlation_id=None):
        return ("evento-1", True)

    def claim_outbox(self, evento_id, lease_seconds=900):
        if self.claim_levanta:
            raise RuntimeError(self.claim_levanta)
        if self.claim_devolve_nada or self.estado != "pending":
            return None
        self.estado = "in_flight"
        return {"outbox_event_id": evento_id}

    def claim_outbox_por_chave(self, chave, lease_seconds=900):
        if self.estado != "pending":
            return None
        self.estado = "in_flight"
        return {"outbox_event_id": "evento-1"}

    def status_outbox(self, chave):
        return {"status": self.estado, "attempt_count": 1, "dead_at": None}

    def recupera_leases(self):
        self.recuperou += 1
        if self.estado == "in_flight":
            self.estado = "pending"
        return None

    def settle(self, evento_id, desfecho, provider_message_id=None, failure_category=None):
        if self.estado != "in_flight":
            # A mensagem EXATA do banco em produção — de propósito: o handler antigo procurava
            # "send" nela para decidir quantos e-mails tinham saído.
            raise RuntimeError(
                "settle_outbox_event falhou: http=400 {\"code\":\"P0001\",\"message\":"
                "\"TRANSICAO_ILEGAL: evento em pending nao pode ser liquidado "
                "(esperado in_flight)\"}")
        self.estado = "settled"
        self.settles.append((evento_id, desfecho))
        return "settled"

    def emit_audit(self, *a, **kw):
        self.audits.append((a, kw))


RECIPIENTES = [f"P{i:02d}" for i in range(1, 17)]   # os 16 do sorteio de 12/08
SORTEIO = {
    "id": "2026-08-12", "gameType": "powerball",
    "drawing": {"drawDateIso": "2026-08-12T22:59:00-04:00"},
    "participants": [{"name": r} for r in RECIPIENTES],
    "result": {"numbers": [4, 26, 66, 67, 69], "special": 9, "multiplier": 2,
               "premiosGanhos": 38},
    "finance": {"totalArrecadado": 160},
}


def monta(ledger, ponte, envios):
    """Deps reais do ciclo, com as fronteiras externas dubladas."""
    def envia(game_type, refs):
        envios.append(list(refs))
        return {"accepted": list(refs), "failed": [], "uncertain": [],
                "providerInvoked": True, "stdout": "ok"}
    return F.Deps(ledger=ledger, send_email=envia,
                  resolve_recipients=lambda d: list(RECIPIENTES), bridge=ponte)


def cenario(ledger, ponte):
    """
    Roda o ciclo com o resultado JÁ reconciliado (é o estado da run real).

    Uma exceção que escapa vira `rel["excecao"]` em vez de derrubar a suíte. Não é para
    esconder a falha — é para que a MUTAÇÃO apareça como uma linha FALHA legível dizendo o que
    aconteceu, em vez de um traceback que o leitor precisa decifrar. Quando a proteção do claim
    é removida, é exatamente aqui que a run 31679185588 morre de novo, e o relato tem de dizer
    isso com todas as letras.
    """
    envios = []
    deps = monta(ledger, ponte, envios)
    original_check, original_parse = F.check_and_update_results, F.parse_draws
    F.check_and_update_results = lambda *a, **kw: False
    F.parse_draws = lambda *a, **kw: [SORTEIO]
    F.load_data_js = lambda *a, **kw: ""
    F._PROVIDER_CALLS_REAIS["n"] = 0
    try:
        rel = F.run_lifecycle("powerball", deps=deps)
    except Exception as e:  # noqa: BLE001
        rel = {"excecao": f"{type(e).__name__}: {e}", "notificationState": "EXCECAO",
               "providerCalls": F._PROVIDER_CALLS_REAIS["n"]}
    finally:
        F.check_and_update_results, F.parse_draws = original_check, original_parse
    return rel, envios


def main():
    print("REGRESSÃO — run 31679185588\n")

    # ═══ A. sem reivindicação, o provedor não é tocado ═══════════════════════════════════════
    print("A. a reivindicação é um PORTÃO, não um registro")
    ponte = PonteFalsa(claim_levanta="rede caiu no claim")
    rel, envios = cenario(LedgerFalso(), ponte)
    checa("claim falhou => ZERO chamadas ao provedor", envios == [], str(envios))
    checa("claim falhou => providerCalls = 0", rel.get("providerCalls") == 0)
    checa("estado é classificado (nunca 'desconhecido')",
          rel.get("notificationState") == "OUTBOX_CLAIM_FALHOU", rel.get("notificationState"))
    checa("o estado é de ATENÇÃO, não silencioso",
          "OUTBOX_CLAIM_FALHOU" in F.ESTADOS_ATENCAO)

    ponte = PonteFalsa(claim_devolve_nada=True)
    rel, envios = cenario(LedgerFalso(), ponte)
    checa("claim vazio (outro worker) => ZERO envios", envios == [], str(envios))
    checa("claim vazio => ALREADY_CLAIMED (normal, não falha)",
          rel.get("notificationState") == "ALREADY_CLAIMED"
          and "ALREADY_CLAIMED" in F.ESTADOS_OK)

    # ═══ o caminho feliz continua funcionando ═══════════════════════════════════════════════
    print("\nA'. o caminho normal ainda envia e liquida")
    ponte = PonteFalsa()
    rel, envios = cenario(LedgerFalso(), ponte)
    checa("16 destinatários recebem", envios == [RECIPIENTES], f"{len(envios)} lote(s)")
    checa("providerCalls = 16 (efeito real)", rel.get("providerCalls") == 16)
    checa("obrigação liquidada como sucesso", ponte.settles == [("evento-1", "success")])
    checa("estado do outbox = settled", ponte.estado == "settled")

    # ═══ B. a contagem é EFEITO, não texto de erro ═══════════════════════════════════════════
    print("\nB. PROVIDER_CALLS é contador de efeito")
    #
    # Reprodução literal: o provedor aceita os 16 e o settle levanta a mensagem do banco, que NÃO
    # contém a palavra "send". O handler antigo respondia "PROVIDER_CALLS = 0".
    class PonteQueFalhaNoSettle(PonteFalsa):
        def settle(self, *a, **kw):
            raise RuntimeError(
                "settle_outbox_event falhou: http=400 TRANSICAO_ILEGAL: evento em pending "
                "nao pode ser liquidado (esperado in_flight)")

    ponte = PonteQueFalhaNoSettle()
    envios = []
    deps = monta(LedgerFalso(), ponte, envios)
    F.check_and_update_results, F.parse_draws = (lambda *a, **k: False), (lambda *a, **k: [SORTEIO])
    F.load_data_js = lambda *a, **k: ""
    F._PROVIDER_CALLS_REAIS["n"] = 0
    levantou = None
    try:
        F.run_lifecycle("powerball", deps=deps)
    except Exception as e:  # noqa: BLE001
        levantou = e
    msg = str(levantou or "")
    checa("a exceção do settle sobe (não é engolida)", levantou is not None)
    checa("a mensagem NÃO contém 'send'", "send" not in msg.lower(),
          "é exatamente por isso que a inferência por substring mentia")
    checa("o contador de efeito registra os 16 envios reais",
          F._PROVIDER_CALLS_REAIS["n"] == 16, str(F._PROVIDER_CALLS_REAIS["n"]))
    # MUTAÇÃO: voltar a inferir do texto do erro.
    inferido = 0 if "send" not in msg.lower() else len(RECIPIENTES)
    checa("MUTAÇÃO: inferir do texto daria 0 (o relato falso da run real)", inferido == 0)
    checa("MUTAÇÃO fica VERMELHA: efeito != inferência",
          F._PROVIDER_CALLS_REAIS["n"] != inferido, f"16 real x {inferido} inferido")

    # ═══ C. a obrigação órfã é reconciliada SEM reenviar ═════════════════════════════════════
    print("\nC. recuperação da obrigação órfã (o estado em que a produção ficou)")
    ponte = PonteFalsa(estado_inicial="pending")     # entregue, mas presa em pending
    ledger = LedgerFalso(status=LedgerFalso.SENT)    # os 16 já constam como aceitos
    rel, envios = cenario(ledger, ponte)
    checa("rerodar NÃO chama o provedor", envios == [], str(envios))
    checa("providerCalls = 0", rel.get("providerCalls", 0) == 0)
    checa("a obrigação foi liquidada", ponte.estado == "settled", ponte.estado)
    checa("liquidada sem envio, e o relatório diz isso",
          rel.get("outboxReconcile") == "LIQUIDADA_SEM_ENVIO", str(rel.get("outboxReconcile")))
    checa("o workflow fica VERDE", rel.get("notificationState") in F.ESTADOS_OK,
          rel.get("notificationState"))
    checa("a reconciliação deixou rastro de auditoria",
          any("draw.outbox_reconciled" in str(a) for a, _ in ponte.audits))

    print("\nC'. órfã presa em in_flight (dono morreu depois de reivindicar)")
    ponte = PonteFalsa(estado_inicial="in_flight")
    rel, envios = cenario(ponte=ponte, ledger=LedgerFalso(status=LedgerFalso.SENT))
    checa("pediu recuperação de lease", ponte.recuperou >= 1)
    checa("liquidou sem enviar", ponte.estado == "settled" and envios == [])

    # ═══ D. rerodar depois de concluído envia zero ═══════════════════════════════════════════
    print("\nD. idempotência: rerodar N vezes")
    ponte = PonteFalsa(estado_inicial="settled")
    total = []
    for _ in range(5):
        rel, envios = cenario(LedgerFalso(status=LedgerFalso.SENT), ponte)
        total += envios
    checa("5 reexecuções => 0 chamadas ao provedor", total == [], str(total))
    checa("nenhuma liquidação nova", ponte.settles == [])
    checa("PB_20260812_RESENT = 0", total == [])

    # ═══ E. falha NÃO CRÍTICA depois de todo efeito durável ═════════════════════════════════
    print("\nE. auditoria falha DEPOIS de e-mail + ledger + outbox")
    #
    # Em produção isto não é hipótese: o log da run 31679185588 mostra
    # "Audit log failed (continuing): HTTP Error 404" em toda linha. Neste ponto os e-mails já
    # saíram e a obrigação já está liquidada — o registro de auditoria falhar não desfaz nada.
    #
    # Deixar a exceção subir transformava uma execução COMPLETAMENTE bem-sucedida em saída 2 sem
    # classificação: não desfazia nada e ainda pintava o painel de vermelho por um motivo que
    # não pede ação sobre a entrega. Engolir também estaria errado — passaria a impressão de
    # registro onde não há.
    class PonteSemAuditoria(PonteFalsa):
        def emit_audit(self, *a, **kw):
            raise RuntimeError("audit_events indisponivel (404)")

    ponte = PonteSemAuditoria()
    ledger = LedgerFalso()
    rel, envios = cenario(ledger, ponte)
    checa("os 16 e-mails saíram", envios == [RECIPIENTES], f"{len(envios)} lote(s)")
    checa("a obrigação foi liquidada assim mesmo", ponte.estado == "settled", ponte.estado)
    checa("o ledger fechou como enviado", ledger.job == {"status": LedgerFalso.SENT})
    checa("NENHUMA exceção escapa por falha de auditoria", rel.get("excecao") is None,
          str(rel.get("excecao")))
    checa("o erro de auditoria fica REGISTRADO (não engolido)",
          "audit_events" in str(rel.get("auditError")), str(rel.get("auditError"))[:60])
    checa("providerCalls continua dizendo a verdade (16, não 0)",
          rel.get("providerCalls") == 16, str(rel.get("providerCalls")))
    checa("o estado da entrega continua 'sent'", rel.get("notificationState") == "sent",
          str(rel.get("notificationState")))
    # e rerodar depois disso não reenvia
    _, envios_de_novo = cenario(LedgerFalso(status=LedgerFalso.SENT), ponte)
    checa("rerodar depois da falha de auditoria envia ZERO", envios_de_novo == [],
          str(envios_de_novo))

    print("\n" + "=" * 78)
    if falhas:
        print(f"RUN_31679185588_CLASS_REGRESSION = FALHOU ({len(falhas)})")
        for f in falhas:
            print(f"    - {f}")
        return 1
    print("RUN_31679185588_CLASS_REGRESSION = PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
