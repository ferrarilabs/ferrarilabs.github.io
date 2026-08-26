#!/usr/bin/env python3
"""test_recover_result_email.py — o alvo EXPLÍCITO da recuperação, provado.

A recuperação existe para entregar UMA notificação perdida. O jeito de ela causar dano não é
falhar — é acertar o alvo errado, ou reenviar para quem já recebeu. Os dois produzem exatamente o
incidente que a #221 já custou caro.

Então o que este arquivo prova não é "funciona": é que ela **recusa** em todo caso duvidoso, e que
não existe caminho por onde um alvo vire outro.

Sem rede, sem Supabase, sem e-mail.

Uso: python3 bolao/cdb2026/scripts/test_recover_result_email.py
"""
import importlib.util
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(AQUI.parent.parent / "shared" / "scripts"))

_FONTE_REC = (AQUI / "recover_result_email.py").read_text()


def carregar_rec(fonte=None):
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("rec", loader=None))
    mod.__file__ = str(AQUI / "recover_result_email.py")
    exec(compile(fonte or _FONTE_REC, mod.__file__, "exec"), mod.__dict__)
    return mod


R = carregar_rec()
S = R._carregar_sender()

ok, fail = 0, 0


def test(nome, fn):
    global ok, fail
    try:
        fn(); print(f"  ✓ {nome}"); ok += 1
    except AssertionError as e:
        print(f"  ✗ {nome}\n      {e}"); fail += 1
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}"); fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


ALVO = ("quartas", "espn-atletico-mg_cruzeiro", "first")
OUTRO = "espn-palmeiras_santos"

# Endereços SINTÉTICOS em domínio reservado — nunca um valor real nem parecido com real.
ENTRADAS = [
    {"id": "e1", "participantName": "Um", "participantEmail": "e1@exemplo.invalid"},
    {"id": "e2", "participantName": "Dois", "participantEmail": "e2@exemplo.invalid"},
    {"id": "e3", "participantName": "Tres", "participantEmail": "e3@exemplo.invalid"},
]


def estado(alvo_result=(1, 1), outro_result=(2, 0)):
    def jogo(r, home, away):
        m = {"kickoff": "2026-08-26T00:00:00Z", "homeTeam": home, "awayTeam": away}
        if r is not None:
            m.update({"goalsHome": r[0], "goalsAway": r[1], "status": "FINAL"})
        return m
    return {
        "espnSync": {"activePhaseId": "quartas"},
        "entries": [dict(e) for e in ENTRADAS],
        "deletedIds": [],
        "phases": {"quartas": {"ties": {
            ALVO[1]: {"teamA": "Cruzeiro", "teamB": "Atlético-MG", "qualifiedTeamId": None,
                      "matches": {"first": jogo(alvo_result, "Cruzeiro", "Atlético-MG"),
                                  "second": jogo(None, "Atlético-MG", "Cruzeiro")}},
            OUTRO: {"teamA": "Palmeiras", "teamB": "Santos", "qualifiedTeamId": None,
                    "matches": {"first": jogo(outro_result, "Palmeiras", "Santos"),
                                "second": jogo(None, "Santos", "Palmeiras")}},
        }}},
    }


class LedgerFalso:
    """`status_rows()` devolve `(idempotency_key, status)`, como a RPC real."""

    def __init__(self, linhas=None, quebrado=False):
        self.linhas = linhas or []
        self.quebrado = quebrado
        self.reservas, self.marcados = [], []

    def status_rows(self):
        if self.quebrado:
            raise RuntimeError("ledger fora do ar")
        return list(self.linhas)

    def reserve(self, p, t, l, refs):
        self.reservas.append((f"{p}:{t}:{l}", tuple(sorted(refs))))

    def mark_sent(self, p, t, l, ref, status=None):
        self.marcados.append((f"{p}:{t}:{l}", ref))


def chave(phase, tie, leg, ref):
    from result_email_ledger import idempotency_key
    return idempotency_key(phase, tie, leg, ref)


def pre(estado_=None, ledger=None, expect="1-1", alvo=ALVO):
    return R.preflight(S, alvo[0], alvo[1], alvo[2], expect,
                       ledger=ledger if ledger is not None else LedgerFalso(),
                       state=estado_ if estado_ is not None else estado())


print("\nRecuperação com alvo explícito — o que ela RECUSA\n")
print("A. Alvo pronto (o caso histórico):")


def _pronto():
    ev, tie, refs = pre()
    _assert(ev["TARGET_STATUS"] == R.READY, f"{ev['TARGET_STATUS']} — {ev['MOTIVO']}")
    _assert(ev["RESULT"] == "1-1", ev["RESULT"])
    _assert(ev["EXPECTED_RECIPIENT_COUNT"] == 3, ev["EXPECTED_RECIPIENT_COUNT"])
    _assert(ev["RESOLVED_RECIPIENT_COUNT"] == 3, ev["RESOLVED_RECIPIENT_COUNT"])
    _assert(ev["LEDGER_SENT_COUNT"] == 0 and ev["LEDGER_UNCERTAIN_COUNT"] == 0, "ledger sujo")
    _assert(ev["WOULD_SEND_COUNT"] == 3, ev["WOULD_SEND_COUNT"])

test("ledger vazio + resultado gravado => READY_FOR_EXPLICIT_RECOVERY", _pronto)


def _assunto_igual_ao_auto():
    """Prende o assunto da recuperação ao que o `--auto` teria produzido."""
    st = estado()
    tie = st["phases"]["quartas"]["ties"][ALVO[1]]
    rec = R.montar_assunto(S, tie, "first", 1, 1)
    auto = f"Resultado Parcial — {tie['teamA']} × {tie['teamB']}: Cruzeiro 1–1 Atlético-MG"
    _assert(rec == auto, f"assunto divergiu do --auto:\n      rec  = {rec}\n      auto = {auto}")
    padrao = S._subject_policy.assunto("FUTEBOL_RESULTADO_PARCIAL",
                                       f"Resultado Parcial — {tie['teamA']} × {tie['teamB']}")
    _assert(rec != padrao, "a recuperacao caiu no assunto do modo padrao, que nao traz o placar")

test("o assunto é o do --auto (com placar), nunca o do modo padrão", _assunto_igual_ao_auto)


print("\nB. Duplicata — o que já foi entregue não sai de novo:")


def _ja_entregue():
    linhas = [(chave(*ALVO, r), "sent") for r in ("e1", "e2", "e3")]
    ev, _, _ = pre(ledger=LedgerFalso(linhas))
    _assert(ev["TARGET_STATUS"] == R.ALREADY, ev["TARGET_STATUS"])
    _assert(ev["LEDGER_SENT_COUNT"] == 3, ev["LEDGER_SENT_COUNT"])
    _assert(ev["WOULD_SEND_COUNT"] == 0, "ainda mandaria alguem depois de entrega completa")

test("replay após entrega canônica => ALREADY_DELIVERED, WOULD_SEND=0", _ja_entregue)


def _parcial_nao_reenvia_todos():
    linhas = [(chave(*ALVO, "e1"), "sent")]
    ev, _, _ = pre(ledger=LedgerFalso(linhas))
    _assert(ev["TARGET_STATUS"] == R.ALREADY,
            f"entrega PARCIAL tem de parar, nao continuar: {ev['TARGET_STATUS']}")
    _assert(ev["WOULD_SEND_COUNT"] == 2,
            f"o calculo tem de excluir quem ja recebeu (esperado 2, veio {ev['WOULD_SEND_COUNT']})")

test("entrega parcial anterior não dispara reenvio para todo mundo", _parcial_nao_reenvia_todos)


def _ambiguo_para():
    for status in ("processing", "failed_permanent", "suppressed", "coisa_nova"):
        ev, _, _ = pre(ledger=LedgerFalso([(chave(*ALVO, "e1"), status)]))
        _assert(ev["TARGET_STATUS"] == R.UNCERTAIN,
                f"status `{status}` deveria ser ambiguo, virou {ev['TARGET_STATUS']}")

test("status ambíguo (processing/failed_permanent/suppressed/desconhecido) => UNCERTAIN", _ambiguo_para)


def _ledger_ilegivel():
    ev, _, _ = pre(ledger=LedgerFalso(quebrado=True))
    _assert(ev["TARGET_STATUS"] == R.UNCERTAIN, ev["TARGET_STATUS"])
    _assert(ev["LEDGER_SENT_COUNT"] == 0, "inventou contagem com o ledger fora do ar")

test("ledger ilegível => UNCERTAIN, nunca 'pode mandar'", _ledger_ilegivel)


def _pending_bloqueia():
    """A lição de 2026-08-26: reserva sem confirmação NÃO prova ausência de entrega."""
    linhas = [(chave(*ALVO, r), "pending") for r in ("e1", "e2", "e3")]
    ev, _, _ = pre(ledger=LedgerFalso(linhas))
    _assert(ev["TARGET_STATUS"] == R.UNCERTAIN,
            f"`pending` tem de BLOQUEAR — `reserve()` escreve antes do provedor, entao pending nao "
            f"prova que nao entregou. Veio {ev['TARGET_STATUS']}")
    _assert(ev["LEDGER_PENDING_COUNT"] == 3, ev["LEDGER_PENDING_COUNT"])

test("`pending` bloqueia — reserva precede o envio, então não prova não-entrega", _pending_bloqueia)


def _failed_retryable_bloqueia():
    ev, _, _ = pre(ledger=LedgerFalso([(chave(*ALVO, "e1"), "failed_retryable")]))
    _assert(ev["TARGET_STATUS"] == R.UNCERTAIN, ev["TARGET_STATUS"])

test("`failed_retryable` também bloqueia", _failed_retryable_bloqueia)


print("\nC. O alvo não escorrega:")


def _identidade_nao_vaza_para_outro_confronto():
    """Entrega registrada em OUTRO confronto das quartas não pode contar para o alvo."""
    linhas = [(chave("quartas", OUTRO, "first", r), "sent") for r in ("e1", "e2", "e3")]
    ev, _, _ = pre(ledger=LedgerFalso(linhas))
    _assert(ev["TARGET_STATUS"] == R.READY,
            f"o ledger de outro confronto contaminou o alvo: {ev['TARGET_STATUS']}")
    _assert(ev["LEDGER_SENT_COUNT"] == 0, ev["LEDGER_SENT_COUNT"])

test("entrega de OUTRO confronto das quartas não conta para este alvo", _identidade_nao_vaza_para_outro_confronto)


def _prefixo_nao_casa_por_engano():
    """Uma chave cujo `entry_ref` contenha `:` não pode ser lida como do alvo."""
    sent, pend, incerto = R.classificar_ledger(
        [(chave(*ALVO, "e1:extra"), "sent")], chave(*ALVO, ""))
    _assert(not sent, "chave malformada foi contada como entrega")
    _assert(incerto, "chave malformada tem de virar ambigua, nao ser ignorada")

test("chave de ledger malformada vira ambígua, não entrega", _prefixo_nao_casa_por_engano)


def _alvo_inexistente_recusa():
    for phase, tie, leg, motivo in [
        ("semis", ALVO[1], "first", "fase que nao contem o confronto"),
        ("quartas", "confronto-que-nao-existe", "first", "confronto inexistente"),
        ("quartas", ALVO[1], "second", "perna sem resultado gravado"),
        ("fase-inventada", ALVO[1], "first", "fase inexistente"),
    ]:
        ev, _, _ = R.preflight(S, phase, tie, leg, None, ledger=LedgerFalso(), state=estado())
        _assert(ev["TARGET_STATUS"] != R.READY, f"aceitou alvo invalido ({motivo}): {phase}/{tie}/{leg}")

test("fase/confronto/perna inválidos ou sem resultado => recusa", _alvo_inexistente_recusa)


def _placar_divergente_recusa():
    ev, _, _ = pre(expect="2-0")
    _assert(ev["TARGET_STATUS"] != R.READY, "aceitou alvo com placar diferente do gravado")
    _assert("placar" in ev["MOTIVO"], ev["MOTIVO"])

test("placar esperado != placar gravado => recusa", _placar_divergente_recusa)


def _sem_fallback_para_ultima():
    """A catraca de forma: nada de 'latest' no caminho de recuperação."""
    import re
    proibido = [r"\blatest\b", r"for phase in PHASES", r"activePhaseId"]
    for p in proibido:
        _assert(re.search(p, _FONTE_REC) is None,
                f"o caminho de recuperacao contem `{p}` — inferir alvo e exatamente o que ele nao pode fazer")
    _assert("required=True" in _FONTE_REC, "os argumentos de alvo precisam ser obrigatorios")
    _assert(_FONTE_REC.count("default=") == 0, "nenhum argumento de alvo pode ter default")

test("não existe fallback para 'última perna' no caminho de recuperação", _sem_fallback_para_ultima)


def _nunca_imprime_endereco():
    import re
    for l in _FONTE_REC.split("\n"):
        if "print(" in l and "addr" in l:
            raise AssertionError(f"linha imprime endereco: {l.strip()}")
    _assert("entry_ref=" in _FONTE_REC, "o log precisa identificar por entry_ref")

test("o log identifica por entry_ref e nunca imprime endereço", _nunca_imprime_endereco)


print("\nD. Controle negativo — a garantia de alvo explícito TEM de morder:")


def _mutacao_alvo_implicito():
    """Reintroduz um fallback de 'último confronto' e exige que a suíte acuse.

    A mutação vive só nesta string; o arquivo do repositório nunca é tocado.
    """
    mutado = _FONTE_REC.replace(
        '    if tie_id not in ties:\n        ev["MOTIVO"] = f"confronto inexistente na fase: {tie_id}"\n        return ev, None, None',
        '    if tie_id not in ties:\n        tie_id = sorted(ties)[-1]   # MUTACAO: cai para o "ultimo"\n',
        1)
    _assert(mutado != _FONTE_REC, "a mutacao nao alterou a guarda de confronto inexistente")
    M = carregar_rec(mutado)
    ev, _, _ = M.preflight(S, "quartas", "confronto-que-nao-existe", "first", None,
                           ledger=LedgerFalso(), state=estado())
    _assert(ev["TARGET_STATUS"] == R.READY and ev["TARGET_TIE"] == "confronto-que-nao-existe",
            "CONTROLE NEGATIVO FALHOU: o mutante deveria ter aceitado um alvo inexistente "
            f"caindo para outro confronto — veio {ev['TARGET_STATUS']}")

test("mutante que cai para 'último confronto' aceita alvo inexistente (logo, a guarda real morde)",
     _mutacao_alvo_implicito)


def _mutacao_ignora_sent():
    """Se a checagem de entrega sumir, o replay volta a mandar para todo mundo."""
    mutado = _FONTE_REC.replace('_SENT = {"sent"}', '_SENT = set()', 1)
    _assert(mutado != _FONTE_REC, "a mutacao nao alterou a definicao de entrega")
    M = carregar_rec(mutado)
    linhas = [(chave(*ALVO, r), "sent") for r in ("e1", "e2", "e3")]
    ev, _, _ = M.preflight(S, *ALVO, "1-1", ledger=LedgerFalso(linhas), state=estado())
    _assert(ev["WOULD_SEND_COUNT"] == 3,
            "CONTROLE NEGATIVO FALHOU: sem reconhecer `sent`, o mutante deveria reenviar para todos")

test("mutante que não reconhece `sent` reenviaria para todos (logo, a guarda real morde)",
     _mutacao_ignora_sent)


print(f"\n  {ok} passed, {fail} failed\n")
if fail:
    print("✗ RECUPERACAO COM ALVO EXPLICITO REPROVADA\n")
    sys.exit(1)
print("✓ RECUPERACAO COM ALVO EXPLICITO OK\n")
