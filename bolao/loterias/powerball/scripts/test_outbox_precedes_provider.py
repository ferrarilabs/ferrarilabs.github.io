#!/usr/bin/env python3
"""Powerball — a obrigação existe ANTES do provedor, e o desfecho espelha o ledger.

POR QUE A ORDEM É A PROPRIEDADE, E NÃO A EXISTÊNCIA
--------------------------------------------------
"O ciclo cria um evento de outbox" não diz nada sozinho: criar depois de enviar também satisfaz
essa frase, e é justamente o caso que perde a obrigação. Se o processo morre entre o provedor
aceitar e a linha ser gravada, ficam pessoas avisadas e nenhum registro de que a obrigação foi
cumprida — a próxima execução reabre tudo e reenviar vira possível.

Então o que se afirma aqui é a SEQUÊNCIA:

    emit_outbox  →  provedor  →  settle

E mais: o desfecho do outbox tem de ESPELHAR o do ledger, nunca ser recalculado. Duas fontes de
verdade sobre a mesma entrega divergem, e a divergência aparece como "consta enviado, ninguém
recebeu" — ou o inverso.

INCERTO É TERMINAL. Um destinatário que ficou UNCERTAIN não é retentável: reenviar às cegas foi
o defeito de 08/08, que mandou o mesmo e-mail duas vezes. No outbox isso vira `dead`, que exige
decisão humana em vez de convidar a máquina a tentar de novo.

HERMÉTICO: ledger, transporte e ponte M8/M9 são todos injetados.

Uso: python3 bolao/loterias/powerball/scripts/test_outbox_precedes_provider.py
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("BOLAO_TEST_RUN", "1")
AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

import fetch_and_send_results as F  # noqa: E402

ok, fail = 0, 0


def test(nome, fn):
    global ok, fail
    try:
        fn()
        print(f"  ✓ {nome}")
        ok += 1
    except AssertionError as e:
        print(f"  ✗ {nome}\n      {e}")
        fail += 1
    except Exception as e:
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}")
        fail += 1


class PonteEspia:
    """Registra a ORDEM das operações, que é o que este teste mede."""

    def __init__(self):
        self.ordem = []
        self.liquidacoes = []
        self.auditorias = []

    def new_correlation_id(self):
        return "corr"

    def key_draw_result(self, draw_id):
        return f"powerball:draw-result:{draw_id}:v1"

    def emit_outbox(self, chave, tipo, payload=None, correlation_id=None):
        self.ordem.append("outbox")
        return ("evt", True)

    def emit_audit(self, *a, **kw):
        self.ordem.append("audit")
        self.auditorias.append(a[0] if a else None)

    def settle(self, eid, outcome, **kw):
        self.ordem.append(f"settle:{outcome}")
        self.liquidacoes.append(outcome)
        return "sent" if outcome == "success" else "dead"

    def claim(self, *a, **kw):
        return {"outbox_event_id": "evt"}

    # A REIVINDICAÇÃO FAZ PARTE DO CONTRATO — e este dublê não a tinha.
    #
    # Até 2026-08-13 esta classe não implementava `claim_outbox`, e o ciclo ENGOLIA o
    # AttributeError e seguia para o provedor. O teste passava verde por causa do mesmo defeito
    # que derrubou a run 31679185588: a falha de reivindicação não impedia nada.
    #
    # Agora a reivindicação é um portão, então o dublê precisa modelá-la — e registra a ordem,
    # para que o teste passe a provar também que ela vem ANTES do provedor. Sem lease, dois
    # workers processam a mesma obrigação e nenhum consegue encerrá-la.
    def claim_outbox(self, evento_id, lease_seconds=900):
        self.ordem.append("claim")
        return {"outbox_event_id": evento_id}

    def claim_outbox_por_chave(self, chave, lease_seconds=900):
        self.ordem.append("claim")
        return {"outbox_event_id": "evt"}

    def status_outbox(self, chave):
        return {"status": "pending", "attempt_count": 0, "dead_at": None}

    def recupera_leases(self):
        return None


def cenario(aceitos, falhos=(), incertos=(), status_final=None, recusa_transporte=False):
    """Monta um ciclo completo com ledger e transporte falsos."""
    ponte = PonteEspia()
    alvos = list(aceitos) + list(falhos) + list(incertos)

    class Ledger:
        SENT, PARTIAL = "SENT", "PARTIAL"
        R_SENDING, R_ACCEPTED, R_FAILED, R_UNCERTAIN = "SENDING", "ACCEPTED", "FAILED", "UNCERTAIN"

        def draw_key(self, d):
            return f"k:{d}"

        def ledger_available(self):
            return True, None

        def get_job(self, d):
            return None

        def requires_manual_action(self, d):
            return False

        def check_content_immutability(self, *a):
            return True, None

        def ensure_job(self, *a):
            pass

        def claim(self, d, w):
            return True

        def reconcile_orphaned_sending(self, d):
            pass

        def retryable_recipients(self, d):
            return alvos

        def record_recipient(self, *a):
            pass

        def settle(self, d):
            # Recusa de transporte registra todos como FAILED -- o ledger nao pode devolver SENT.
            if recusa_transporte:
                return {"status": self.PARTIAL, "reason": "transporte recusado"}
            return {"status": status_final or (self.SENT if not (falhos or incertos) else self.PARTIAL),
                    "reason": None}

    def transporte(game, refs):
        if recusa_transporte:
            # O transporte RECUSOU: nenhum provedor foi tocado. Não registra "provider" na ordem
            # justamente porque não houve chamada — é essa a diferença que o teste mede.
            return {"accepted": [], "failed": list(refs), "uncertain": [],
                    "providerInvoked": False,
                    "stdout": "TRANSPORTE_RECUSADO: sem autorizacao explicita"}
        ponte.ordem.append("provider")
        return {"accepted": list(aceitos), "failed": list(falhos),
                "uncertain": list(incertos), "providerInvoked": True}

    deps = F.Deps(ledger=Ledger(), send_email=transporte,
                  resolve_recipients=lambda d: alvos, bridge=ponte)
    rel = F.run_lifecycle("powerball", dry_run=False, deps=deps)
    return ponte, rel


def _assert(c, m):
    if not c:
        raise AssertionError(m)


print("\nPowerball — outbox antes do provedor\n")


def ordem_correta():
    ponte, rel = cenario(aceitos=["a", "b"])
    assert "outbox" in ponte.ordem, f"nenhuma obrigação criada: {ponte.ordem}"
    assert "provider" in ponte.ordem, f"nenhum envio: {ponte.ordem}"
    assert ponte.ordem.index("outbox") < ponte.ordem.index("provider"), (
        f"provedor foi chamado ANTES de a obrigação existir: {ponte.ordem}. Uma queda nesse "
        "intervalo deixa gente avisada sem registro de que a obrigação foi cumprida")
    # A REIVINDICAÇÃO também precede o provedor. `emit` cria a linha em `pending`, e o banco só
    # liquida `in_flight`: enviar sem reivindicar produz entrega que ninguém consegue fechar —
    # foi literalmente a run 31679185588, com 16 e-mails entregues e a obrigação presa.
    assert "claim" in ponte.ordem, f"nada foi reivindicado: {ponte.ordem}"
    assert ponte.ordem.index("claim") < ponte.ordem.index("provider"), (
        f"provedor foi chamado sem lease: {ponte.ordem}")


test("emit_outbox precede o provedor", ordem_correta)


def sem_reivindicacao_nao_envia():
    """Reivindicação impossível => ZERO chamadas ao provedor. O portão, não o registro."""
    class PonteQueNaoReivindica(PonteEspia):
        def claim_outbox(self, evento_id, lease_seconds=900):
            self.ordem.append("claim-falhou")
            raise RuntimeError("banco fora do ar no claim")

    ponte = PonteQueNaoReivindica()

    def transporte(game_type, refs):
        ponte.ordem.append("provider")
        return {"accepted": list(refs), "failed": [], "uncertain": [], "providerInvoked": True}

    class LedgerMinimo:
        SENT = "sent"
        R_SENDING, R_ACCEPTED, R_FAILED, R_UNCERTAIN = "s", "a", "f", "u"
        def ledger_available(self): return True, "ok"
        def get_job(self, d): return None
        def requires_manual_action(self, d): return False
        def check_content_immutability(self, *a): return True, "ok"
        def ensure_job(self, *a): pass
        def claim(self, d, w): return True
        def retryable_recipients(self, d): return ["a", "b"]
        def record_recipient(self, *a): pass
        def settle(self, d): return {"status": "sent", "reason": None}
        def draw_key(self, d): return f"powerball:draw-result:{d}:v1"

    deps = F.Deps(ledger=LedgerMinimo(), send_email=transporte,
                  resolve_recipients=lambda d: ["a", "b"], bridge=ponte)
    rel = F.run_lifecycle("powerball", dry_run=False, deps=deps)
    assert "provider" not in ponte.ordem, (
        f"enviou sem lease: {ponte.ordem} — é a run 31679185588 de novo")
    assert rel.get("providerCalls") == 0, f"providerCalls={rel.get('providerCalls')}"
    assert rel.get("notificationState") == "OUTBOX_CLAIM_FALHOU", rel.get("notificationState")


test("sem reivindicação, o provedor NÃO é tocado", sem_reivindicacao_nao_envia)


def liquida_depois():
    ponte, rel = cenario(aceitos=["a"])
    liq = [i for i, p in enumerate(ponte.ordem) if p.startswith("settle:")]
    assert liq, f"não liquidou: {ponte.ordem}"
    assert ponte.ordem.index("provider") < liq[0], (
        f"liquidou antes de enviar: {ponte.ordem}")


test("a liquidação vem DEPOIS do provedor", liquida_depois)

test("entrega completa -> outbox success", lambda: _assert(
    cenario(aceitos=["a", "b"])[0].liquidacoes == ["success"],
    "desfecho do outbox não espelhou um ledger SENT"))

test("entrega PARCIAL -> retentável, não terminal", lambda: _assert(
    cenario(aceitos=["a"], falhos=["b"])[0].liquidacoes == ["transient_failure"],
    "parcial virou terminal: quem ficou de fora nunca mais receberia"))


def incerto_e_terminal():
    ponte, rel = cenario(aceitos=["a"], incertos=["b"])
    assert ponte.liquidacoes == ["permanent_failure"], (
        f"UNCERTAIN virou retentável ({ponte.liquidacoes}) — reenviar às cegas para um "
        "destinatário incerto foi exatamente o defeito de 08/08")


test("UNCERTAIN -> dead (nunca retentado às cegas)", incerto_e_terminal)


def auditoria_registrada():
    ponte, rel = cenario(aceitos=["a"])
    assert "audit" in ponte.ordem, f"nada auditado: {ponte.ordem}"
    assert any(a and a.startswith("draw.") for a in ponte.auditorias), ponte.auditorias


test("a auditoria registra o desfecho", auditoria_registrada)


def providercalls_conta_efeito():
    ponte, rel = cenario(aceitos=["a", "b"])
    assert rel["providerCalls"] == 2, (
        f"providerCalls={rel['providerCalls']} — tem de contar CHAMADA REAL, não alvo nem "
        "iteração de laço")


test("providerCalls conta o efeito, não a intenção", providercalls_conta_efeito)



def recusa_nao_conta_chamada():
    """§10: `providerCalls` é efeito colateral medido, nunca intenção declarada.

    Este caso existe porque a versão anterior do ciclo atribuía `providerCalls = len(alvos)`
    ANTES de olhar o desfecho. O relatório então afirmava `providerCalls: 1` mesmo quando o
    transporte tinha recusado e nenhum provedor fora tocado — e foi lendo esse número que eu
    tratei, por horas, uma entrega que nunca existiu.
    """
    ponte, rel = cenario(aceitos=["a", "b"], recusa_transporte=True)
    assert rel["providerCalls"] == 0, (
        f"providerCalls={rel['providerCalls']} com o transporte RECUSANDO — o contador está "
        "medindo alvos pretendidos em vez de chamadas que aconteceram")
    assert rel.get("providerRefused") is True, f"recusa não sinalizada: {rel}"


test("transporte RECUSADO -> providerCalls = 0", recusa_nao_conta_chamada)


def recusa_nao_e_terminal():
    ponte, rel = cenario(aceitos=["a"], recusa_transporte=True)
    assert ponte.liquidacoes == ["transient_failure"], (
        f"recusa de transporte virou {ponte.liquidacoes} — não houve provedor, então não houve "
        "tentativa perdida; marcar terminal descartaria a obrigação sem ninguém ter sido avisado")


test("transporte RECUSADO -> obrigação segue retentável", recusa_nao_e_terminal)


print(f"\n  {ok} passed, {fail} failed\n")
print("✓ OUTBOX PRECEDES PROVIDER PASSED\n" if fail == 0 else "✗ OUTBOX PRECEDES PROVIDER FAILED\n")
sys.exit(0 if fail == 0 else 1)
