#!/usr/bin/env python3
"""test_penalty_winner_guard.py — confronto empatado so trava quando a ESPN CONFIRMA os penaltis (#598).

─── O INCIDENTE ────────────────────────────────────────────────────────────────────────────────

2026-11-08, semifinal: ida Vasco 0 x 1 Palmeiras, volta Vasco 2 x 1 Palmeiras -- agregado 2 x 2,
Palmeiras 5 x 4 nos penaltis. O `--auto` das 22:26Z gravou a volta, travou o VASCO e mandou o
e-mail para todos. `_maybe_decide_tie()` confiava em `homeWinner`/`awayWinner` da PRIMEIRA leitura
da ESPN, sem olhar o status; a reconfirmacao de 20 s comparava so o placar.

─── O QUE ESTE ARQUIVO PROVA ───────────────────────────────────────────────────────────────────

`run_auto()` de verdade (bordas substituidas, miolo real), com leituras da ESPN que MUDAM entre a
primeira e a segunda consulta, como numa janela real:
  1. flag de vencedor sem status de penaltis -> a perna NAO e gravada, nada e enviado;
  2. primeira leitura sem penaltis, segunda com -> espera (as duas tem de concordar);
  3. as duas com STATUS_FINAL_PEN e o mesmo vencedor -> grava, trava o time certo, envia;
  4. as duas com penaltis mas vencedores diferentes -> espera;
  5. STATUS_SUSPENDED (contem "PEN") nunca conta como penaltis;
  6. agregado decidido no tempo normal continua travando sem depender de status;
  7. controle negativo: o codigo antes do #598 trava o Vasco no cenario 1.
Sem rede, sem Supabase, sem e-mail.

Uso: python3 bolao/cdb2026/scripts/test_penalty_winner_guard.py
"""
import copy
import importlib.util
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")
_FONTE = (AQUI / "send_result_email.py").read_text()

ok, fail = 0, 0


def carregar(fonte=None):
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("sender_pen", loader=None))
    mod.__file__ = str(AQUI / "send_result_email.py")
    exec(compile(fonte or _FONTE, mod.__file__, "exec"), mod.__dict__)
    return mod


def test(nome, fn):
    global ok, fail
    try:
        fn()
        print(f"  ✓ {nome}")
        ok += 1
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}")
        fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


KICK_1 = "2026-11-01T19:00:00Z"
KICK_2 = "2026-11-08T20:00:00Z"
TIE = "espn-palmeiras_vasco"
ENTRADAS = [
    {"id": "e1", "participantName": "Participante Um", "participantEmail": "e1@exemplo.invalid"},
    {"id": "e2", "participantName": "Participante Dois", "participantEmail": "e2@exemplo.invalid"},
]


def estado(first=(0, 1)):
    """Semifinal como em producao antes da volta: ida Vasco 0 x 1 Palmeiras (orientacao do bolao)."""
    return {
        "espnSync": {"activePhaseId": "semifinal"},
        "entries": [dict(e) for e in ENTRADAS],
        "deletedIds": [],
        "phases": {"semifinal": {"ties": {TIE: {
            "teamA": "Vasco", "teamB": "Palmeiras", "qualifiedTeamId": None,
            "matches": {
                "first": {"kickoff": KICK_1, "homeTeam": "Vasco", "awayTeam": "Palmeiras",
                          "goalsHome": first[0], "goalsAway": first[1], "status": "FINAL"},
                "second": {"kickoff": KICK_2, "homeTeam": "Palmeiras", "awayTeam": "Vasco"},
            },
        }}}},
    }


def ev(home, away, hs, aws, data, status="STATUS_FULL_TIME", hw=False, aw=False):
    return {"homeTeam": home, "awayTeam": away, "homeScore": hs, "awayScore": aws, "dateISO": data,
            "state": "post", "postponed": False, "statusName": status,
            "homeWinner": hw, "awayWinner": aw}


IDA = ev("Palmeiras", "Vasco", 1, 0, KICK_1, hw=True)  # o jogo real da ida, no Allianz


def volta(status, hw=False, aw=False, hs=2, aws=1):
    return ev("Vasco", "Palmeiras", hs, aws, KICK_2, status=status, hw=hw, aw=aw)


class Cenario:
    """`run_auto()` real; `leituras` e a lista de candidatos devolvida a cada consulta da ESPN."""

    def __init__(self, mod, st, leituras):
        self.S, self.state, self.leituras = mod, st, leituras
        self.rpc, self.enviados, self.consultas = [], [], 0

    def _sb_rpc(self, op, payload, client_ref):
        self.rpc.append((op, payload))
        tie = self.state["phases"][payload["phaseId"]]["ties"][payload["tieId"]]
        if op == "save-leg":
            leg = payload["leg"]
            tie["matches"][leg].update({"goalsHome": payload["goalsHome"], "goalsAway": payload["goalsAway"],
                                        "status": "FINAL"})
        elif op == "lock-tie":
            tie["qualifiedTeamId"] = payload["qualifiedTeamId"]
        return 200, None

    def _espn(self):
        i = min(self.consultas, len(self.leituras) - 1)
        self.consultas += 1
        return copy.deepcopy(self.leituras[i])

    def rodar(self):
        S = self.S
        real_audit = S.audit_scoring

        class _Audit:
            def __getattr__(self, nome):
                return getattr(real_audit, nome)
            run_static_audit = staticmethod(lambda verbose=False: (True, []))
            check_match_is_real = staticmethod(lambda *a, **k: (True, "ok"))
            check_result_shape = staticmethod(lambda *a, **k: (True, "ok"))

        real_time = S.time

        class _Time:
            def __getattr__(self, nome):
                return getattr(real_time, nome)
            sleep = staticmethod(lambda *_a, **_k: None)

        class _Ledger:
            def reserve(self, *a, **k):
                return {"reserved": [], "failed": []}

            def mark_sent(self, *a, **k):
                return True

        S.audit_scoring = _Audit()
        S._sb_rpc = self._sb_rpc
        S.sb_fetch = lambda: copy.deepcopy(self.state)
        S.fetch_espn_candidates = self._espn
        S.sb_backfill_schedule = lambda *a, **k: 0
        S.any_cdb_match_live = lambda *a, **k: False
        S.time = _Time()
        S._default_ledger = lambda: _Ledger()
        S.send_email = lambda addr, subject, html: (self.enviados.append((addr, subject)), "200")[1]
        S.run_auto()

    def ops(self):
        return [o for o, _ in self.rpc]

    def travou(self):
        return next((p["qualifiedTeamId"] for o, p in self.rpc if o == "lock-tie"), None)


print("\nCDB2026 — vencedor nos penaltis so com confirmacao da ESPN (#598)\n")


def _flag_sem_status():
    # A janela de 22:26Z: jogo acabado, Vasco marcado vencedor da PARTIDA, disputa nao registrada.
    c = Cenario(carregar(), estado(), [[IDA, volta("STATUS_FULL_TIME", hw=True)]])
    c.rodar()
    _assert(c.ops() == [], f"gravou/travou sem status de penaltis: {c.ops()}")
    _assert(c.enviados == [], f"enviou {len(c.enviados)} e-mail(s) sem saber quem avanca")

test("1. flag de vencedor sem status de penaltis -> nada gravado, nada enviado", _flag_sem_status)


def _leituras_discordam_do_status():
    c = Cenario(carregar(), estado(), [[IDA, volta("STATUS_FULL_TIME", hw=True)],
                                       [IDA, volta("STATUS_FINAL_PEN", aw=True)]])
    c.rodar()
    _assert(c.ops() == [] and c.enviados == [], f"seguiu com as duas leituras discordando: {c.ops()}")

test("2. primeira leitura sem penaltis, segunda com -> espera o proximo ciclo", _leituras_discordam_do_status)


def _penaltis_confirmados():
    c = Cenario(carregar(), estado(), [[IDA, volta("STATUS_FINAL_PEN", aw=True)]])
    c.rodar()
    _assert(c.ops() == ["save-leg", "lock-tie"], f"operacoes: {c.ops()}")
    save = next(p for o, p in c.rpc if o == "save-leg")
    _assert((save["goalsHome"], save["goalsAway"]) == (1, 2), f"placar na orientacao do bolao: {save}")
    _assert(c.travou() == "B", f"travou {c.travou()}; o Palmeiras e o teamB")
    _assert(len(c.enviados) == 2, f"enviados: {len(c.enviados)}")

test("3. STATUS_FINAL_PEN nas duas leituras -> grava 1x2, trava Palmeiras (B), envia", _penaltis_confirmados)


def _vencedores_diferentes():
    c = Cenario(carregar(), estado(), [[IDA, volta("STATUS_FINAL_PEN", hw=True)],
                                       [IDA, volta("STATUS_FINAL_PEN", aw=True)]])
    c.rodar()
    _assert(c.ops() == [] and c.enviados == [], f"seguiu com vencedores diferentes: {c.ops()}")

test("4. penaltis nas duas leituras, vencedores diferentes -> espera", _vencedores_diferentes)


def _suspenso_nao_e_penalti():
    c = Cenario(carregar(), estado(), [[IDA, volta("STATUS_SUSPENDED", aw=True)]])
    c.rodar()
    _assert(c.ops() == [] and c.enviados == [], f"tratou STATUS_SUSPENDED como penaltis: {c.ops()}")

test("5. STATUS_SUSPENDED (contem 'PEN') nunca vale como penaltis", _suspenso_nao_e_penalti)


def _ambos_os_flags():
    c = Cenario(carregar(), estado(), [[IDA, volta("STATUS_FINAL_PEN", hw=True, aw=True)]])
    c.rodar()
    _assert(c.ops() == [] and c.enviados == [], f"aceitou os dois flags ligados: {c.ops()}")

test("6. os dois flags ligados -> ambiguo, espera", _ambos_os_flags)


def _tempo_normal_nao_depende_de_status():
    # Volta Vasco 3 x 1: agregado 3 x 2 para o Vasco, sem penaltis.
    c = Cenario(carregar(), estado(), [[IDA, volta("STATUS_FULL_TIME", hs=3, aws=1)]])
    c.rodar()
    _assert(c.ops() == ["save-leg", "lock-tie"] and c.travou() == "A", f"{c.ops()} {c.travou()}")
    _assert(len(c.enviados) == 2, f"enviados: {len(c.enviados)}")

test("7. agregado decidido no tempo normal -> grava e trava sem olhar status", _tempo_normal_nao_depende_de_status)


def _primeira_perna_empatada_nao_espera():
    # Ida 1 x 1 sem volta jogada: nao fecha o confronto, entao nao ha penalti a esperar.
    st = estado()
    st["phases"]["semifinal"]["ties"][TIE]["matches"]["first"].update({"goalsHome": None, "goalsAway": None, "status": "SCHEDULED"})
    c = Cenario(carregar(), st, [[ev("Palmeiras", "Vasco", 1, 1, KICK_1)]])
    c.rodar()
    _assert(c.ops() == ["save-leg"] and len(c.enviados) == 2, f"{c.ops()} {len(c.enviados)}")

test("8. ida empatada nao espera penaltis (confronto ainda aberto)", _primeira_perna_empatada_nao_espera)


def _controle_negativo():
    # O codigo de antes do #598: confia no flag da primeira leitura. Tem de travar o VASCO aqui --
    # prova que o cenario 1 reproduz o incidente, e nao passa por acaso.
    antes = _FONTE.replace(
        "        if _leg_needs_penalty_winner(state, phase_id, tie_id, leg, gh, ga):",
        "        if False:")
    antes = antes.replace(
        "    vencedor = _penalty_winner(ev)\n",
        "    vencedor = (ev['homeTeam'] if ev.get('homeWinner') else ev['awayTeam'] if ev.get('awayWinner') else None) if ev else None\n")
    _assert(antes != _FONTE, "a mutacao nao casou -- o controle negativo nao testa nada")
    c = Cenario(carregar(antes), estado(), [[IDA, volta("STATUS_FULL_TIME", hw=True)]])
    c.rodar()
    _assert(c.travou() == "A", f"o codigo antigo deveria travar o Vasco (A), travou {c.travou()}")

test("9. controle negativo: sem a guarda, o cenario 1 trava o Vasco (o incidente)", _controle_negativo)

print(f"\n{'✗' if fail else '✓'} {ok} ok, {fail} falha(s)")
sys.exit(1 if fail else 0)
