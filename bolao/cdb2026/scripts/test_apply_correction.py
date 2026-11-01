#!/usr/bin/env python3
"""test_apply_correction.py — o aplicador de correcao (apply_correction.py) contra banco simulado.

Prova: (1) o plano versionado da semifinal de 2026-11-01 leva o estado real daquele dia ao estado
corrigido; (2) banco fora de `expectBefore` aborta ANTES de gravar qualquer coisa; (3) rodar de
novo nao grava nada; (4) nenhum caminho de e-mail e tocado; (5) dry-run nao grava.
Hermetico: sem rede, sem credencial.
"""
import copy
import io
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

os.environ["BOLAO_TEST_RUN"] = "1"
AQUI = Path(__file__).parent
sys.path.insert(0, str(AQUI))
import send_result_email as S  # noqa: E402
import apply_correction as AC  # noqa: E402

PLANO = AQUI.parent / "data" / "corrections" / "2026-11-01-semifinal.json"
ok = fail = 0


def test(nome, f):
    global ok, fail
    try:
        f(); print(f"  ✓ {nome}"); ok += 1
    except BaseException as e:  # SystemExit inclusive
        print(f"  ✗ {nome}\n      {e}"); fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


def estado_de_1_11():
    """As quatro pernas da semifinal exatamente como lidas em producao em 2026-11-01 ~21:05Z."""
    return {"phases": {"semifinal": {"ties": {
        "espn-palmeiras_vasco": {"teamA": "Vasco", "teamB": "Palmeiras", "qualifiedTeamId": None, "matches": {
            "first": {"venue": None, "status": "SCHEDULED", "kickoff": "2026-11-01T20:00:00+00:00",
                      "awayTeam": "Palmeiras", "homeTeam": "Vasco", "goalsAway": None, "goalsHome": None},
            "second": {"city": None, "venue": None, "status": "FINAL", "kickoff": "2026-11-08T20:00:00+00:00",
                       "awayTeam": "Vasco", "homeTeam": "Palmeiras", "goalsAway": 0, "goalsHome": 1,
                       "resultSource": "espn-auto"}}},
        "espn-atletico-mg_gremio": {"teamA": "Grêmio", "teamB": "Atlético-MG", "qualifiedTeamId": None, "matches": {
            "first": {"venue": None, "status": "SCHEDULED", "kickoff": "2026-11-01T20:00:00+00:00",
                      "awayTeam": "Atlético-MG", "homeTeam": "Grêmio", "goalsAway": None, "goalsHome": None},
            "second": {"venue": None, "status": "SCHEDULED", "kickoff": "2026-11-08T20:00:00+00:00",
                       "awayTeam": "Grêmio", "homeTeam": "Atlético-MG", "goalsAway": None, "goalsHome": None}}},
    }}}}


class Banco:
    """Imita cdb_apply_operator_mutation para save-leg, clear-leg e backfill-kickoff (SQL de 20260906161933)."""
    def __init__(self, st):
        self.st, self.rpc, self.refs = st, [], set()

    def fetch(self):
        return copy.deepcopy(self.st)

    def mutate(self, tipo, p, ref):
        self.rpc.append((tipo, p, ref))
        if ref in self.refs:
            return 200, {"applied": False, "reason": "idempotente"}
        self.refs.add(ref)
        tie = self.st["phases"][p["phaseId"]]["ties"][p["tieId"]]
        m = tie["matches"][p["leg"]]
        if tipo == "save-leg":
            m.update({"homeTeam": tie["teamB"] if p["leg"] == "second" else tie["teamA"],
                      "awayTeam": tie["teamA"] if p["leg"] == "second" else tie["teamB"],
                      "goalsHome": p["goalsHome"], "goalsAway": p["goalsAway"], "status": "FINAL",
                      })  # a releitura do servidor nao devolve resultSource (visto em 2026-11-01)
        elif tipo == "clear-leg":
            m.update({"goalsHome": None, "goalsAway": None, "status": "SCHEDULED"})
        elif tipo == "backfill-kickoff":
            # O servidor guarda timestamptz: devolve "+00:00", nao "Z" (visto em 2026-11-01).
            m["kickoff"] = p["kickoff"].replace("Z", "+00:00")
        else:
            raise AssertionError(f"mutacao inesperada {tipo}")
        return 200, {"applied": True}


def rodar(banco, *args):
    S.sb_fetch = banco.fetch
    S._sb_rpc = banco.mutate
    S.send_email = lambda *a, **k: (_ for _ in ()).throw(AssertionError("apply_correction tentou enviar e-mail"))
    sys.argv = ["apply_correction.py", str(PLANO), *args]
    buf = io.StringIO()
    with redirect_stdout(buf):
        AC.main()
    return buf.getvalue()


print("\nCDB2026 — aplicador de correcao (semifinal 2026-11-01)\n")


def _plano_leva_ao_estado_certo():
    b = Banco(estado_de_1_11())
    rodar(b, "--apply")
    pv = b.st["phases"]["semifinal"]["ties"]["espn-palmeiras_vasco"]["matches"]
    gr = b.st["phases"]["semifinal"]["ties"]["espn-atletico-mg_gremio"]["matches"]
    _assert((pv["first"]["goalsHome"], pv["first"]["goalsAway"]) == (0, 1), f"ida: {pv['first']}")
    _assert(pv["first"]["homeTeam"] == "Vasco" and pv["first"]["awayTeam"] == "Palmeiras", pv["first"])
    _assert(pv["second"]["goalsHome"] is None and pv["second"]["status"] == "SCHEDULED", f"volta: {pv['second']}")
    _assert(pv["first"]["kickoff"] == "2026-11-01T19:00:00+00:00", pv["first"]["kickoff"])
    _assert(pv["second"]["kickoff"] == "2026-11-08T20:00:00+00:00", "a volta de Vasco x Palmeiras nao devia mudar")
    _assert(gr["first"]["kickoff"] == "2026-11-01T21:30:00+00:00" and gr["second"]["kickoff"] == "2026-11-07T21:00:00+00:00", gr)
    _assert(gr["first"]["goalsHome"] is None and gr["second"]["goalsHome"] is None, "tocou placar do Gremio")
    _assert(len(b.rpc) == 5, f"esperava 5 mutacoes, houve {len(b.rpc)}")

test("plano real + estado real de 1/11 -> ida 0x1 (Vasco x Palmeiras), volta limpa, horarios da ESPN", _plano_leva_ao_estado_certo)


def _idempotente():
    b = Banco(estado_de_1_11())
    rodar(b, "--apply")
    n = len(b.rpc)
    rodar(b, "--apply")
    _assert(len(b.rpc) == n, "a segunda execucao gravou de novo")

test("rodar duas vezes nao grava nada na segunda", _idempotente)


def _diverge_aborta_sem_gravar():
    st = estado_de_1_11()
    st["phases"]["semifinal"]["ties"]["espn-palmeiras_vasco"]["matches"]["second"]["goalsHome"] = 2
    b = Banco(st)
    try:
        rodar(b, "--apply")
    except SystemExit:
        pass
    else:
        raise AssertionError("aplicou com o banco fora do esperado")
    _assert(b.rpc == [], f"gravou antes de abortar: {b.rpc}")

test("banco fora de expectBefore -> aborta e NADA e gravado", _diverge_aborta_sem_gravar)


def _dry_run():
    b = Banco(estado_de_1_11())
    out = rodar(b)
    _assert(b.rpc == [], "dry-run gravou")
    _assert("5 operacao(oes) seriam aplicadas" in out, out)

test("sem --apply nao grava", _dry_run)


def _repetido_para():
    b = Banco(estado_de_1_11())
    b.refs.add(AC._ref(json.loads(PLANO.read_text()), 0, json.loads(PLANO.read_text())["operations"][0]))
    try:
        rodar(b, "--apply")
    except SystemExit as e:
        _assert("repetida" in str(e), str(e))
    else:
        raise AssertionError("seguiu depois de o servidor recusar a operacao como repetida")

test("servidor responde applied:false -> para", _repetido_para)


def _sem_envio_no_fonte():
    fonte = (AQUI / "apply_correction.py").read_text()
    codigo = "\n".join(l.split("#")[0] for l in fonte.split("\n"))
    for proibido in ("send_email", "_send_to_all", "emailjs", "BOLAO_ALLOW_REAL_SEND\"] ="):
        _assert(proibido not in codigo, f"{proibido} aparece no codigo do aplicador")

test("o aplicador nao referencia nenhum caminho de envio", _sem_envio_no_fonte)

print(f"\n{'✗' if fail else '✓'} {ok} ok, {fail} falha(s)")
sys.exit(1 if fail else 0)
