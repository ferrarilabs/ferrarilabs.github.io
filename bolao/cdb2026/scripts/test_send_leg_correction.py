#!/usr/bin/env python3
"""test_send_leg_correction.py — `send_result_email.py --send-leg` (e-mail de correcao de uma perna).

Prova, com provedor, Supabase e ledger simulados (2026-11-01, semifinal Palmeiras x Vasco):
  1. TESTE (--only-entry) envia para UMA entrada, assunto [TESTE], sem tocar o ledger;
  2. --all envia para todos e registra no ledger na identidade (fase, confronto, perna);
  3. --all RECUSA se o ledger ja tiver entrega da perna (nada enviado);
  4. sem modo, com os dois modos, ou perna sem placar -> recusa, nada enviado;
  5. o corpo traz o aviso de correcao, o placar na orientacao do bolao e o palpite de vaga.
Hermetico. Destinatarios em dominio reservado (.test).
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
from result_email_ledger import entity_id  # noqa: E402

NOTA = AQUI.parent / "data" / "corrections" / "2026-11-01-semifinal-email.html"
FIX = json.loads((AQUI / "fixtures" / "cdb_email_parity_state_2026-11-01.json").read_text(encoding="utf-8"))
ok = fail = 0


def test(nome, f):
    global ok, fail
    try:
        f(); print(f"  ✓ {nome}"); ok += 1
    except BaseException as e:  # noqa: BLE001 — SystemExit inclusive
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}"); fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


def estado_corrigido():
    st = copy.deepcopy(FIX)
    for i, e in enumerate(st["entries"]):
        e["participantEmail"] = f"entrada{i:02d}@exemplo.test"
    m = st["phases"]["semifinal"]["ties"]["espn-palmeiras_vasco"]["matches"]
    m["first"].update({"goalsHome": 0, "goalsAway": 1, "status": "FINAL"})
    m["second"].update({"goalsHome": None, "goalsAway": None, "status": "SCHEDULED"})
    return st


class Ledger:
    def __init__(self, entregues=()):
        self.entregues, self.reservas, self.marcados = set(entregues), [], []

    def delivered_entity_ids(self, since_iso):
        return set(self.entregues)

    def reserve(self, phase_id, tie_id, leg, refs, payload=None):
        self.reservas.append((phase_id, tie_id, leg, list(refs)))
        return {"reserved": refs, "failed": []}

    def mark_sent(self, phase_id, tie_id, leg, ref, status=None):
        self.marcados.append((phase_id, tie_id, leg, ref))
        return True


def rodar(estado, ledger, *args):
    enviados = []
    S.sb_fetch = lambda: copy.deepcopy(estado)
    S._default_ledger = lambda: ledger
    S.send_email = lambda addr, subject, html: (enviados.append((addr, subject, html)), 200)[1]
    S.time.sleep = lambda *_: None
    sys.argv = ["send_result_email.py", "--send-leg", "semifinal", "espn-palmeiras_vasco", "first",
                "--note-file", str(NOTA), *args]
    buf = io.StringIO()
    erro = None
    with redirect_stdout(buf):
        try:
            S.main()
        except SystemExit as e:
            erro = e
    return enviados, erro, buf.getvalue()


print("\nCDB2026 — e-mail de correcao de uma perna (--send-leg)\n")
UM = FIX["entries"][0]["entryName"]


def _teste_um_so():
    lg = Ledger()
    env, erro, _ = rodar(estado_corrigido(), lg, "--only-entry", UM)
    _assert(erro is None, f"saiu com erro: {erro}")
    _assert(len(env) == 1 and env[0][0] == "entrada00@exemplo.test", f"destinatarios: {[e[0] for e in env]}")
    _assert("[TESTE]" in env[0][1] and "CORREÇÃO" in env[0][1], env[0][1])
    _assert(lg.reservas == [] and lg.marcados == [], "o teste tocou o ledger")

test("--only-entry: uma entrada, [TESTE], sem ledger", _teste_um_so)


def _todos():
    lg = Ledger()
    env, erro, _ = rodar(estado_corrigido(), lg, "--all")
    _assert(erro is None, f"saiu com erro: {erro}")
    _assert(len(env) == len(FIX["entries"]), f"{len(env)} enviados para {len(FIX['entries'])} entradas")
    _assert(all("[TESTE]" not in e[1] for e in env), "assunto de teste no envio real")
    _assert(len(lg.reservas) == 1 and lg.reservas[0][:3] == ("semifinal", "espn-palmeiras_vasco", "first"), lg.reservas)
    _assert(len(lg.marcados) == len(env), f"marcados {len(lg.marcados)} de {len(env)}")

test("--all: todos, ledger em (semifinal, espn-palmeiras_vasco, first)", _todos)


def _ja_entregue():
    lg = Ledger(entregues={entity_id("semifinal", "espn-palmeiras_vasco", "first")})
    env, erro, _ = rodar(estado_corrigido(), lg, "--all")
    _assert(env == [], f"reenviou: {len(env)}")
    _assert(erro is not None and "ja tem entrega" in str(erro), f"nao recusou: {erro}")

test("--all com entrega ja registrada -> recusa, nada enviado", _ja_entregue)


def _sem_ledger():
    env, erro, _ = rodar(estado_corrigido(), None, "--all")
    _assert(env == [] and erro is not None, "enviou sem ledger para provar que nao e duplicata")

test("--all sem ledger -> recusa", _sem_ledger)


def _sem_modo():
    for extra in ((), ("--all", "--only-entry", UM)):
        env, erro, _ = rodar(estado_corrigido(), Ledger(), *extra)
        _assert(env == [] and erro is not None, f"aceitou {extra}")

test("sem modo ou com os dois modos -> recusa", _sem_modo)


def _sem_placar():
    st = estado_corrigido()
    st["phases"]["semifinal"]["ties"]["espn-palmeiras_vasco"]["matches"]["first"].update({"goalsHome": None, "goalsAway": None})
    env, erro, _ = rodar(st, Ledger(), "--only-entry", UM)
    _assert(env == [] and erro is not None, "enviou correcao de perna sem placar")

test("perna sem placar -> recusa", _sem_placar)


def _corpo():
    env, _, _ = rodar(estado_corrigido(), Ledger(), "--only-entry", UM)
    html = env[0][2]
    _assert("Correção do e-mail anterior" in html, "sem o aviso")
    _assert(html.index("Correção do e-mail anterior") < html.index("Pontuação"), "aviso nao esta no topo")
    _assert("Vasco 0–1 Palmeiras" in html or "Vasco 0 – 1 Palmeiras" in html or "0–1" in html, "placar nominal ausente")
    _assert("Vasco 0–1 Palmeiras" in env[0][1], env[0][1])
    corpo = html[len(NOTA.read_text(encoding="utf-8")):]  # depois do aviso, que cita "sem palpite" ao explicar o erro
    sem = sum(1 for e in FIX["entries"] if not ((e.get("picks") or {}).get("matches") or {}).get("sf-2", {}).get("first"))
    _assert(corpo.count("sem palpite") == sem,
            f"'sem palpite' {corpo.count('sem palpite')}x para {sem} entrada(s) sem palpite da ida: o palpite de vaga sumiu")

test("corpo: aviso no topo, Vasco 0–1 Palmeiras, palpites de vaga", _corpo)

print(f"\n{'✗' if fail else '✓'} {ok} ok, {fail} falha(s)")
sys.exit(1 if fail else 0)
