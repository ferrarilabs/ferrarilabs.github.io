#!/usr/bin/env python3
"""test_result_email_auto_flow.py — o FLUXO do `--auto`, ponta a ponta (incidente de 2026-08-26).

─── O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ─────────────────────────────────────────────────────

Em 2026-08-26 a perna `quartas:espn-atletico-mg_cruzeiro:first` (Cruzeiro 1-1 Atletico-MG) foi
detectada e GRAVADA corretamente, e nenhum participante recebeu e-mail. O ledger ficou com zero
linhas e o vigia da #180 acusou `GAP` -- o vigia funcionou; quem quebrou foi o remetente.

A causa era um contrato entre duas funcoes, nao um erro dentro de nenhuma delas:

    sb_status, state = sb_save_leg(...)      # `sb_save_leg` devolve (status, None) desde 6ecd9fdf
    qualified = _maybe_decide_tie(state, ...)  # e aqui `state["phases"]` estoura TypeError

Gravava, estourava, e morria ANTES de renderizar o e-mail, ANTES de reservar no ledger e ANTES de
chamar o provedor. Placar salvo, ninguem avisado.

─── POR QUE A SUITE ANTIGA NAO PEGOU ───────────────────────────────────────────────────────────

Havia cobertura boa de `_find_new_legs()` e `_maybe_decide_tie()` -- mas sempre como funcoes PURAS,
recebendo um `estado()` montado a mao no teste. Nenhum teste jamais pegou o valor que
`sb_save_leg()` DEVOLVE e passou adiante. O defeito morava exatamente na junta que ninguem
exercitava, e `run_auto()` inteiro nunca foi chamado por teste nenhum (fica atras do `__main__`).

Entao aqui o alvo e a ORQUESTRACAO: `run_auto()` de verdade, com as funcoes de borda substituidas
(ESPN, Supabase, provedor de e-mail, ledger) e com `sb_save_leg`, `sb_lock_tie`, `_maybe_decide_tie`,
`_send_to_all` e `build_html` REAIS. Sem rede, sem Supabase, sem e-mail.

Uso: python3 bolao/cdb2026/scripts/test_result_email_auto_flow.py
"""
import importlib.util
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")

# Compila o TEXTO, como as outras suites deste app: o cache de bytecode invalida por (mtime,
# tamanho), entao mutacao de 1 char por 1 char poderia servir bytecode velho e dar verde falso.
_FONTE = (AQUI / "send_result_email.py").read_text()


def carregar(fonte=None):
    """Carrega o modulo do remetente a partir do TEXTO (permite mutar para o controle negativo)."""
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("sender_auto", loader=None))
    mod.__file__ = str(AQUI / "send_result_email.py")
    exec(compile(fonte or _FONTE, mod.__file__, "exec"), mod.__dict__)
    return mod


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
    except Exception as e:  # noqa: BLE001 — um crash aqui e exatamente o defeito sob teste
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}")
        fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


KICK_1 = "2026-08-26T00:00:00Z"
KICK_2 = "2026-09-02T00:00:00Z"

# Enderecos de participante SINTETICOS, em dominio reservado. Nunca um valor real, nem ficcional
# que pareca real -- ver a regra de fixtures em scripts/test_fixture_privacy.mjs.
ENTRADAS = [
    {"id": "e1", "participantName": "Participante Um", "participantEmail": "e1@exemplo.invalid"},
    {"id": "e2", "participantName": "Participante Dois", "participantEmail": "e2@exemplo.invalid"},
]


def estado(first=None, second=None, qualified=None):
    """Estado do Supabase: fase ativa `quartas`, um confronto de dois jogos, duas entradas."""
    m1 = {"kickoff": KICK_1, "homeTeam": "Cruzeiro", "awayTeam": "Atlético-MG"}
    if first is not None:
        m1.update({"goalsHome": first[0], "goalsAway": first[1], "status": "FINAL",
                   "resultSource": "espn-auto"})
    m2 = {"kickoff": KICK_2, "homeTeam": "Atlético-MG", "awayTeam": "Cruzeiro"}
    if second is not None:
        m2.update({"goalsHome": second[0], "goalsAway": second[1], "status": "FINAL",
                   "resultSource": "espn-auto"})
    return {
        "espnSync": {"activePhaseId": "quartas"},
        "entries": [dict(e) for e in ENTRADAS],
        "deletedIds": [],
        "phases": {"quartas": {"ties": {"espn-atletico-mg_cruzeiro": {
            "teamA": "Cruzeiro", "teamB": "Atlético-MG",
            "qualifiedTeamId": qualified,
            "matches": {"first": m1, "second": m2},
        }}}},
    }


def candidato(home, away, hs, aws, data):
    return {"homeTeam": home, "awayTeam": away, "homeScore": hs, "awayScore": aws, "dateISO": data,
            "phaseId": "quartas", "tieId": "espn-atletico-mg_cruzeiro"}


class LedgerFalso:
    """Ledger em memoria que registra a ORDEM dos eventos — reserva tem de vir antes do provedor."""

    def __init__(self):
        self.eventos = []
        self.entregues = set()

    def reserve(self, phase_id, tie_id, leg, refs):
        self.eventos.append(("reserve", f"{phase_id}:{tie_id}:{leg}", tuple(sorted(refs))))

    def mark_sent(self, phase_id, tie_id, leg, ref, status):
        self.eventos.append(("mark_sent", f"{phase_id}:{tie_id}:{leg}", ref, str(status)))
        self.entregues.add((phase_id, tie_id, leg, ref))

    def already_delivered(self, phase_id, tie_id, leg, ref):
        return (phase_id, tie_id, leg, ref) in self.entregues


class Cenario:
    """Um `run_auto()` completo com as bordas substituidas e o miolo REAL."""

    def __init__(self, mod, estado_inicial, candidatos, ledger=None):
        self.S = mod
        self.state = estado_inicial
        self.candidatos = candidatos
        self.ledger = ledger if ledger is not None else LedgerFalso()
        self.rpc = []          # toda mutacao estreita que o remetente pediu ao servidor
        self.enviados = []     # (destinatario, assunto)
        self.fetches = 0

    # ── bordas ────────────────────────────────────────────────────────────────────────────────
    def _sb_rpc(self, op, payload, client_ref):
        self.rpc.append((op, payload, client_ref))
        # O SERVIDOR aplica a mutacao; e daqui que o processo tem de reaprender o estado.
        tie = self.state["phases"][payload["phaseId"]]["ties"][payload["tieId"]]
        if op == "save-leg":
            leg = payload["leg"]
            home = tie["teamB"] if leg == "second" else tie["teamA"]
            away = tie["teamA"] if leg == "second" else tie["teamB"]
            tie["matches"][leg] = {**tie["matches"].get(leg, {}), "homeTeam": home, "awayTeam": away,
                                   "goalsHome": payload["goalsHome"], "goalsAway": payload["goalsAway"],
                                   "status": "FINAL", "resultSource": payload["resultSource"]}
        elif op == "lock-tie":
            tie["qualifiedTeamId"] = payload["qualifiedTeamId"]
        return 200, None

    def _sb_fetch(self):
        self.fetches += 1
        import copy
        return copy.deepcopy(self.state)

    def rodar(self):
        S = self.S
        # Envolve o modulo REAL de auditoria: so as tres portas de entrada viram no-op. Substitui-lo
        # inteiro esconderia `score_entry()`, que o `build_html()` usa para montar o ranking -- e o
        # ranking e justamente uma das coisas que este teste precisa ver funcionando.
        real_audit = S.audit_scoring

        class _Audit:
            def __getattr__(self, nome):
                return getattr(real_audit, nome)

            run_static_audit = staticmethod(lambda verbose=False: (True, []))
            check_match_is_real = staticmethod(lambda *a, **k: (True, "ok"))
            check_result_shape = staticmethod(lambda *a, **k: (True, "ok"))

        S.audit_scoring = _Audit()
        S._sb_rpc = self._sb_rpc
        S.sb_fetch = self._sb_fetch
        S.fetch_espn_candidates = lambda: [dict(c) for c in self.candidatos]
        S.sb_backfill_schedule = lambda *a, **k: 0
        S.any_cdb_match_live = lambda *a, **k: False
        # So o `sleep` e neutralizado (o fluxo real espera 20s de re-checagem); o resto do modulo
        # `time` continua sendo o de verdade.
        real_time = S.time

        class _Time:
            def __getattr__(self, nome):
                return getattr(real_time, nome)

            sleep = staticmethod(lambda *_a, **_k: None)

        S.time = _Time()
        S._default_ledger = lambda: self.ledger

        def _send_email(addr, subject, html):
            _assert("@" in addr, "destinatario invalido")
            _assert(len(html) > 0, "html vazio")
            self.enviados.append((addr, subject))
            return "200"

        S.send_email = _send_email
        S.run_auto()


# ══════════════════════════════════════════════════════════════════════════════════════════════
print("\nFluxo do --auto: gravar, decidir, registrar, enviar (incidente 2026-08-26)\n")
print("A. PRIMEIRA PERNA — grava, NAO decide o confronto, e ainda assim avisa todo mundo:")

def _primeira_perna():
    c = Cenario(carregar(), estado(),
                [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1)])
    c.rodar()
    ops = [o for o, _, _ in c.rpc]
    _assert("save-leg" in ops, f"a perna nao foi gravada: {ops}")
    _assert("lock-tie" not in ops,
            "travou o confronto com so uma perna jogada — o segundo jogo ainda nao aconteceu")
    _assert(len(c.enviados) == 2,
            f"esperados 2 e-mails (um por participante), saiu {len(c.enviados)} — "
            "ESTE e o incidente de 2026-08-26: resultado salvo e ninguem avisado")

test("grava a perna, nao decide, e envia para todos", _primeira_perna)


def _ref_de_idempotencia():
    c = Cenario(carregar(), estado(), [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1)])
    c.rodar()
    ref = next(r for o, _, r in c.rpc if o == "save-leg")
    _assert(ref == "cdb-results:save-leg:quartas:espn-atletico-mg_cruzeiro:first:1:1",
            f"clientRef fora do formato canonico de producao: {ref}")

test("o clientRef da gravacao e o mesmo que producao registrou na auditoria", _ref_de_idempotencia)


def _assunto_traz_o_placar():
    c = Cenario(carregar(), estado(), [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1)])
    c.rodar()
    assunto = c.enviados[0][1]
    _assert("Cruzeiro 1–1 Atlético-MG" in assunto, f"placar ausente/errado no assunto: {assunto}")

test("o assunto carrega o placar correto, no sentido do mando da ida", _assunto_traz_o_placar)


print("\nB. SEGUNDA PERNA — grava, DECIDE o classificado e envia uma unica vez:")

def _segunda_perna():
    # Ida 1-1; volta em Atletico-MG (mando invertido): Atletico 2-0 => agregado 3-1 para o B.
    c = Cenario(carregar(), estado(first=(1, 1)),
                [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1),
                 candidato("Atlético-MG", "Cruzeiro", 2, 0, KICK_2)])
    c.rodar()
    ops = [o for o, _, _ in c.rpc]
    _assert(ops.count("save-leg") == 1, f"gravou a perna errada ou de mais: {ops}")
    _assert("lock-tie" in ops, f"nao decidiu o confronto com as duas pernas jogadas: {ops}")
    lock = next(p for o, p, _ in c.rpc if o == "lock-tie")
    _assert(lock["qualifiedTeamId"] == "B",
            f"classificado errado: agregado 1-3 favorece o teamB (Atlético-MG), veio {lock['qualifiedTeamId']}")
    _assert(len(c.enviados) == 2, f"esperados 2 e-mails, saiu {len(c.enviados)}")

test("grava a volta, trava o confronto no lado certo e envia uma vez", _segunda_perna)


print("\nC. LEDGER — reserva antes do provedor, marca depois, e nao duplica no replay:")

def _ordem_do_ledger():
    led = LedgerFalso()
    c = Cenario(carregar(), estado(), [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1)], ledger=led)
    c.rodar()
    tipos = [e[0] for e in led.eventos]
    _assert(tipos and tipos[0] == "reserve",
            f"a reserva tem de vir ANTES de qualquer envio; ordem observada: {tipos}")
    _assert(tipos.count("reserve") == 1, f"reservou mais de uma vez: {tipos}")
    _assert(tipos.count("mark_sent") == 2, f"esperadas 2 marcacoes de entrega, veio {tipos}")
    ident = {e[1] for e in led.eventos}
    _assert(ident == {"quartas:espn-atletico-mg_cruzeiro:first"},
            f"identidade do ledger fora do padrao do vigia: {ident}")

test("reserva vem antes do provedor e a entrega e marcada depois", _ordem_do_ledger)


def _sem_pii_no_ledger():
    led = LedgerFalso()
    c = Cenario(carregar(), estado(), [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1)], ledger=led)
    c.rodar()
    texto = repr(led.eventos)
    _assert("@" not in texto,
            f"endereco de participante vazou para o ledger — ele e evidencia operacional lida em Issue: {texto}")
    refs = {e[2] for e in led.eventos if e[0] == "mark_sent"}
    _assert(refs == {"e1", "e2"}, f"o ledger tem de referenciar o ID da entrada: {refs}")

test("o ledger recebe o id da entrada, nunca o e-mail", _sem_pii_no_ledger)


def _replay_nao_duplica():
    """Segunda execucao com a perna JA gravada: nada novo e descoberto, nada e reenviado."""
    led = LedgerFalso()
    st = estado()
    c1 = Cenario(carregar(), st, [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1)], ledger=led)
    c1.rodar()
    c2 = Cenario(carregar(), st, [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1)], ledger=led)
    c2.rodar()
    _assert(len(c2.enviados) == 0,
            f"o replay reenviou {len(c2.enviados)} e-mail(s) — foi assim que a #221 mandou a rodada 23 quatro vezes")
    _assert([o for o, _, _ in c2.rpc].count("save-leg") == 0,
            "o replay regravou uma perna ja FINAL")

test("rodar de novo com a perna ja gravada nao reenvia nem regrava", _replay_nao_duplica)


print("\nD. CONTROLE NEGATIVO — a regressao de 2026-08-26 TEM de reprovar:")

def _controle_negativo():
    """Reintroduz o contrato quebrado no TEXTO e exige que o cenario A falhe.

    Se este caso parar de falhar, o teste inteiro perdeu o sentido e precisa ser reescrito -- nao
    removido. A mutacao vive so nesta string; o arquivo do repositorio nunca e tocado.
    """
    mutado = _FONTE.replace(
        'sb_status, _ = sb_save_leg(phase_id, tie_id, leg, gh, ga, source="espn-auto")',
        'sb_status, state = sb_save_leg(phase_id, tie_id, leg, gh, ga, source="espn-auto")', 1)
    _assert(mutado != _FONTE, "a mutacao nao alterou a chamada — o alvo do controle negativo mudou de forma")
    # E remove a releitura que a correcao introduziu, restaurando o comportamento de producao quebrada.
    marca = "        state = sb_fetch()\n\n        qualified = _maybe_decide_tie("
    _assert(marca in mutado, "a releitura pos-gravacao sumiu do fonte — reveja este controle negativo")
    mutado = mutado.replace(marca, "        qualified = _maybe_decide_tie(", 1)

    c = Cenario(carregar(mutado), estado(), [candidato("Cruzeiro", "Atlético-MG", 1, 1, KICK_1)])
    try:
        c.rodar()
    except TypeError:
        # Exatamente o que producao fez: estourou depois de gravar e antes de qualquer e-mail.
        _assert([o for o, _, _ in c.rpc].count("save-leg") == 1,
                "o mutante nem chegou a gravar — o controle negativo nao esta exercitando o caminho certo")
        _assert(len(c.enviados) == 0, "o mutante enviou e-mail; a regressao nao foi reproduzida")
        return
    raise AssertionError(
        "CONTROLE NEGATIVO FALHOU: a regressao de 2026-08-26 foi reintroduzida e o fluxo passou "
        "assim mesmo — este teste nao protege mais nada")

test("restaurar `state = sb_save_leg(...)` sem releitura quebra o fluxo, como em producao", _controle_negativo)


def _fonte_nao_confia_no_retorno():
    """Catraca de forma: ninguem pode voltar a atribuir `state` a partir de um gravador estreito."""
    import re
    for nome in ("sb_save_leg", "sb_lock_tie", "sb_clear_leg"):
        _assert(re.search(rf"^\s*status,\s*_\s*=\s*_sb_rpc", _FONTE, re.M) is not None or True, "")
        padrao = rf"^\s*\w+,\s*state\s*=\s*{nome}\("
        achado = re.search(padrao, _FONTE, re.M)
        _assert(achado is None,
                f"`{nome}()` e mutacao ESTREITA e devolve (status, None): atribuir `state` a partir "
                f"dela recria o incidente de 2026-08-26. Releia com sb_fetch().")

test("nenhum chamador atribui `state` a partir de um gravador de mutacao estreita", _fonte_nao_confia_no_retorno)


print(f"\n  {ok} passed, {fail} failed\n")
if fail:
    print("✗ FLUXO DO --auto REPROVADO\n")
    sys.exit(1)
print("✓ FLUXO DO --auto OK\n")
