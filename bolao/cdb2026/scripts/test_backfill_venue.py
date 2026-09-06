#!/usr/bin/env python3
"""test_backfill_venue.py — preencher local NUNCA pode virar reescrever resultado (#393).

─── O QUE ESTA OPERACAO ARRISCA ────────────────────────────────────────────────────────────────

Ela toca pernas de partidas JA JOGADAS, num app que paga dinheiro real por entrada. O jeito de ela
causar dano nao e falhar -- e escrever um campo a mais. Um `status` que volta a SCHEDULED, um
`qualifiedTeamId` que se perde, um placar sobrescrito: qualquer um desses muda quem ganhou.

Por isso a maior parte deste gate verifica AUSENCIA de mudanca, e nao presenca de local.

E a segunda regra em importancia: **curadoria vence provedor**. Um `venue` ja gravado veio do
sorteio oficial, de correcao manual ou de observacao anterior. Sobrescreve-lo com o provedor troca
dado verificado por dado inferido -- e o faz em silencio.

Hermetico: sem rede, sem Supabase. `le_estado`/`_rpc` injetados; o snapshot e um fixture.
"""
import copy
import hashlib
import importlib.util
import io
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "nao-usada")
spec = importlib.util.spec_from_file_location("opcli", AQUI / "operator_cli.py")
OP = importlib.util.module_from_spec(spec); spec.loader.exec_module(OP)

ok = fail = 0
def test(n, f):
    global ok, fail
    try: f(); print(f"  ✓ {n}"); ok += 1
    except AssertionError as e: print(f"  ✗ {n}\n      {e}"); fail += 1
def A(c, m):
    if not c: raise AssertionError(m)

class Args:
    def __init__(self, dry_run=False, actor="teste"): self.dry_run, self.actor = dry_run, actor

SNAP = [
  {"id": "e-ida",   "homeTeam": "Cruzeiro",  "awayTeam": "Atlético-MG", "kickoff": "2026-08-26T00:00:00Z",
   "venue": "Estadio Mineirão", "city": "Belo Horizonte"},
  {"id": "e-volta", "homeTeam": "Atlético-MG", "awayTeam": "Cruzeiro",  "kickoff": "2026-09-02T00:00:00Z",
   "venue": "Arena MRV", "city": "Belo Horizonte"},
  {"id": "e-sem-venue", "homeTeam": "Vasco", "awayTeam": "Vitória", "kickoff": "2026-08-27T00:30:00Z",
   "venue": "", "city": ""},
  # Casa com o confronto da SEMIFINAL do fixture, e com local preenchido. Existe para que a unica
  # coisa que impeca o preenchimento dali seja a AUSENCIA DE DATA -- sem esta entrada, o teste 3
  # passava porque nenhum evento casava os times, e a guarda de kickoff nunca era exercida.
  {"id": "e-semi", "homeTeam": "Grêmio", "awayTeam": "Atlético-MG", "kickoff": "2026-09-20T23:00:00Z",
   "venue": "Arena do Grêmio", "city": "Porto Alegre"},
]

def leg(kick, venue=None, city=None, gh=1, ga=0, st="FINAL"):
    return {"kickoff": kick, "venue": venue, "city": city, "goalsHome": gh, "goalsAway": ga,
            "status": st, "resultSource": "espn-auto", "lockedBy": "admin"}

def estado(venue_ida=None):
    return {"entries": [{"id": f"e{i}", "picks": {"matches": {"x": 1}}} for i in range(12)],
            "paid": {f"e{i}": True for i in range(12)},
            "phases": {"quartas": {"ties": {
                "espn-atletico-mg_cruzeiro": {
                    "teamA": "Cruzeiro", "teamB": "Atlético-MG", "qualifiedTeamId": "B",
                    "matches": {"first": leg("2026-08-26T00:00:00Z", venue_ida),
                                "second": leg("2026-09-02T00:00:00Z")}},
                "espn-vasco_vitoria": {
                    "teamA": "Vasco", "teamB": "Vitória", "qualifiedTeamId": "A",
                    "matches": {"first": leg("2026-08-27T00:30:00Z")}}}},
                "semifinal": {"ties": {"espn-x_y": {"teamA": "Grêmio", "teamB": "Atlético-MG",
                    "qualifiedTeamId": None,
                    "matches": {"first": {"kickoff": None, "venue": None, "city": None,
                                          "goalsHome": None, "goalsAway": None, "status": "SCHEDULED"}}}}}}}

def rodar(args, est, snapshot=SNAP):
    rpcs = []; atual = {"e": est}
    def fake_le(): return copy.deepcopy(atual["e"])
    def fake_rpc(tipo, payload, ref, actor="operator-cli"):
        rpcs.append({"tipo": tipo, "payload": payload, "ref": ref})
        p = payload
        m = atual["e"]["phases"][p["phaseId"]]["ties"][p["tieId"]]["matches"][p["leg"]]
        # espelha a semantica do SQL: so preenche o que esta ausente
        if not (m.get("venue") or "").strip(): m["venue"] = p["venue"]
        if not (m.get("city") or "").strip(): m["city"] = p.get("city")
        atual["e"].setdefault("auditLog", []).append({"clientRef": ref, "actor": actor})
        return {}
    o_le, o_rpc, o_snap = OP.le_estado, OP._rpc, OP._carrega_snapshot
    OP.le_estado, OP._rpc, OP._carrega_snapshot = fake_le, fake_rpc, (lambda: snapshot)
    try:
        buf = io.StringIO()
        with redirect_stdout(buf): rc = OP.cmd_backfill_venue(args)
        return rc, buf.getvalue(), rpcs, atual["e"]
    finally:
        OP.le_estado, OP._rpc, OP._carrega_snapshot = o_le, o_rpc, o_snap

def h(o): return hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

print("\nBackfill de local — o que ele preenche e o que se recusa a tocar\n")
print("A. Preenche exatamente o que falta")

def _preenche():
    rc, out, rpcs, fim = rodar(Args(), estado())
    A(rc == 0, f"rc={rc}\n{out}")
    ties = fim["phases"]["quartas"]["ties"]
    ida = ties["espn-atletico-mg_cruzeiro"]["matches"]["first"]
    volta = ties["espn-atletico-mg_cruzeiro"]["matches"]["second"]
    A(ida["venue"] == "Estadio Mineirão", f"ida: {ida['venue']!r}")
    A(volta["venue"] == "Arena MRV", f"volta: {volta['venue']!r} — mando da volta inverte")
    A(all(r["tipo"] == "backfill-venue" for r in rpcs), "usou tipo de mutacao errado")

test("1. pernas sem local recebem o local do provedor, com o mando no lado certo", _preenche)

def _nao_sobrescreve():
    rc, out, rpcs, fim = rodar(Args(), estado(venue_ida="Estádio Curado à Mão"))
    alvos = [r["payload"]["tieId"] + ":" + r["payload"]["leg"] for r in rpcs]
    A("espn-atletico-mg_cruzeiro:first" not in alvos,
      "tentou escrever numa perna que JA tinha local — curadoria tem de vencer o provedor")
    A(fim["phases"]["quartas"]["ties"]["espn-atletico-mg_cruzeiro"]["matches"]["first"]["venue"]
      == "Estádio Curado à Mão", "o local curado foi sobrescrito")

test("2. local ja gravado NUNCA e sobrescrito", _nao_sobrescreve)

def _sem_data_fora():
    _, _, rpcs, _ = rodar(Args(), estado())
    A(not any(r["payload"]["phaseId"] == "semifinal" for r in rpcs),
      "tentou preencher local de perna SEM data — local sem data casa a partida errada (#395)")

test("3. perna sem kickoff fica de fora (a semifinal nao entra)", _sem_data_fora)

def _provedor_sem_venue():
    _, out, rpcs, _ = rodar(Args(), estado())
    A(not any(r["payload"]["tieId"] == "espn-vasco_vitoria" for r in rpcs),
      "gravou local a partir de entrada do provedor SEM venue — isso seria inventar")
    A("sem dado no provedor" in out, out)

test("4. provedor sem venue => nao grava nada para aquela perna", _provedor_sem_venue)

print("\nB. Casamento errado nao pode acontecer")

def _mando_errado():
    trocado = [{**SNAP[0], "homeTeam": "Atlético-MG", "awayTeam": "Cruzeiro"}]
    _, _, rpcs, _ = rodar(Args(), estado(), snapshot=trocado)
    A(not any(r["payload"]["leg"] == "first" and r["payload"]["tieId"] == "espn-atletico-mg_cruzeiro"
              for r in rpcs),
      "casou a IDA com o evento da VOLTA — sao estadios diferentes")

test("5a. mando invertido no provedor => nao casa", _mando_errado)

def _time_errado():
    outro = [{**SNAP[0], "homeTeam": "Santos"}]
    _, _, rpcs, _ = rodar(Args(), estado(), snapshot=outro)
    A(not any(r["payload"]["tieId"] == "espn-atletico-mg_cruzeiro" and r["payload"]["leg"] == "first"
              for r in rpcs), "casou com time diferente")

test("5b. time diferente => nao casa", _time_errado)

def _data_distante():
    longe = [{**SNAP[0], "kickoff": "2026-10-26T00:00:00Z"}]
    _, _, rpcs, _ = rodar(Args(), estado(), snapshot=longe)
    A(not any(r["payload"]["tieId"] == "espn-atletico-mg_cruzeiro" and r["payload"]["leg"] == "first"
              for r in rpcs), "casou evento a dois meses de distancia")

test("5c. mesmo confronto em data distante => nao casa", _data_distante)

print("\nC. O resultado do torneio nao pode mudar")

def _fingerprints():
    e = estado(); antes = copy.deepcopy(e)
    _, _, _, fim = rodar(Args(), e)
    A(h(antes["entries"]) == h(fim["entries"]), "entries mudou")
    A(h(antes["paid"]) == h(fim["paid"]), "paid mudou")
    for tid, t in fim["phases"]["quartas"]["ties"].items():
        o = antes["phases"]["quartas"]["ties"][tid]
        A(t["qualifiedTeamId"] == o["qualifiedTeamId"], f"{tid}: qualifiedTeamId mudou")
        for lg, m in t["matches"].items():
            om = o["matches"][lg]
            for campo in ("kickoff", "goalsHome", "goalsAway", "status", "resultSource", "lockedBy"):
                A(m.get(campo) == om.get(campo), f"{tid}:{lg}: {campo} mudou")

test("6. kickoff/placar/status/classificacao/resultSource/lockedBy/entries/paid intactos", _fingerprints)

def _idempotente():
    e = estado()
    rc1, _, rpcs1, e1 = rodar(Args(), e)
    A(rc1 == 0 and len(rpcs1) >= 2, "primeira execucao nao preencheu")
    rc2, out2, rpcs2, e2 = rodar(Args(), e1)
    A(rc2 == 0, f"rerun rc={rc2}\n{out2}")
    A(rpcs2 == [], f"rerun gravou de novo: {[r['ref'] for r in rpcs2]}")
    A(h(e1) == h(e2), "rerun mudou o estado")

test("7. segunda execucao produz ZERO mutacoes", _idempotente)

print("\nD. Disciplina do comando")

def _dry_run():
    rc, out, rpcs, fim = rodar(Args(dry_run=True), estado())
    A(rc == 0 and rpcs == [], f"dry-run gravou: {rpcs}")
    A("DRY RUN" in out and "Mineirão" in out, "dry-run precisa mostrar o que gravaria")
    A(fim["phases"]["quartas"]["ties"]["espn-atletico-mg_cruzeiro"]["matches"]["first"]["venue"] is None,
      "dry-run alterou estado")

test("8. dry-run mostra e nao grava", _dry_run)

def _trilha():
    def sem_trilha(tipo, payload, ref, actor="x"):
        p = payload
        m = ESTADO["phases"][p["phaseId"]]["ties"][p["tieId"]]["matches"][p["leg"]]
        if not (m.get("venue") or "").strip(): m["venue"] = p["venue"]
        return {}
    global ESTADO
    ESTADO = estado()
    o_le, o_rpc, o_snap = OP.le_estado, OP._rpc, OP._carrega_snapshot
    OP.le_estado = lambda: copy.deepcopy(ESTADO)
    OP._rpc = sem_trilha
    OP._carrega_snapshot = lambda: SNAP
    try:
        buf = io.StringIO()
        with redirect_stdout(buf): rc = OP.cmd_backfill_venue(Args())
        A(rc == 2, f"servidor sem trilha passou batido (rc={rc})")
        A("sem trilha de auditoria" in buf.getvalue(), buf.getvalue()[-400:])
    finally:
        OP.le_estado, OP._rpc, OP._carrega_snapshot = o_le, o_rpc, o_snap

test("9. escrita sem trilha de auditoria no servidor => aborta", _trilha)

def _servidor_que_desvia():
    """O servidor grava local E encosta num campo imutavel. O comando TEM de abortar.

    Este e o unico teste que exercita a verificacao pos-escrita, e por isso ele existe: enquanto o
    servidor falso se comporta bem, aquela verificacao nunca tem nada para pegar e pode ser
    removida sem nenhum teste ficar vermelho. A mutacao encontrou exatamente esse buraco.

    O cenario nao e hipotetico: e o que acontece se a semantica do SQL divergir do que o comando
    espera -- que e a razao de a verificacao existir.
    """
    est = estado()
    def rpc_desviante(tipo, payload, ref, actor="x"):
        p = payload
        m = est["phases"][p["phaseId"]]["ties"][p["tieId"]]["matches"][p["leg"]]
        if not (m.get("venue") or "").strip(): m["venue"] = p["venue"]
        m["status"] = "SCHEDULED"          # <- o desvio: uma perna FINAL voltando a agendada
        est.setdefault("auditLog", []).append({"clientRef": ref, "actor": actor})
        return {}
    o_le, o_rpc, o_snap = OP.le_estado, OP._rpc, OP._carrega_snapshot
    OP.le_estado = lambda: copy.deepcopy(est); OP._rpc = rpc_desviante; OP._carrega_snapshot = lambda: SNAP
    try:
        buf = io.StringIO()
        with redirect_stdout(buf): rc = OP.cmd_backfill_venue(Args())
        saida = buf.getvalue()
        A(rc == 2, f"servidor mexeu em `status` e o comando devolveu {rc} — tinha de abortar")
        A("status MUDOU" in saida, f"nao nomeou o campo que mudou:\n{saida[-400:]}")
    finally:
        OP.le_estado, OP._rpc, OP._carrega_snapshot = o_le, o_rpc, o_snap

test("9b. servidor que toca campo imutavel => aborta e nomeia o campo", _servidor_que_desvia)

def _render_nao_repara():
    app = (AQUI / ".." / "js" / "app.js").resolve().read_text(encoding="utf-8")
    A("backfill-venue" not in app,
      "o app.js referencia `backfill-venue` — renderizar nao pode ser o gatilho que migra dado (#392)")

test("10. renderizacao continua sem reparar dado", _render_nao_repara)

print(f"\n  {ok} passed, {fail} failed\n")
print("✗ BACKFILL VENUE FAILED" if fail else "✓ BACKFILL VENUE OK")
sys.exit(1 if fail else 0)
