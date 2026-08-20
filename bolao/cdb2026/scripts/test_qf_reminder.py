#!/usr/bin/env python3
"""CDB2026 — testes do lembrete das quartas. Offline, hermetico, zero rede.

Toda dependencia externa entra injetada (`rpc`, `issue`, `envia`). Nenhum teste aqui abre
conexao, emite token real, le participante real ou chega perto de um provedor.

    completude    a semantica e a MESMA do app (perna faltando, gol invalido, agregado
                  empatado sem classificado)
    1:1           token que resolve para outra entrada ABORTA o lote
    nao-mutacao   qualquer mudanca no estado autoritativo ABORTA antes do envio
    idempotencia  reserva existente => zero chamadas ao provedor
    incerteza     falha de transporte vira `uncertain`, nunca liberacao da reserva

Uso: python3 bolao/cdb2026/scripts/test_qf_reminder.py
"""
import copy
import os
import sys
from pathlib import Path

os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-nao-usada-offline")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import send_qf_reminder as R   # noqa: E402

pas = fal = 0


def teste(nome, fn):
    global pas, fal
    try:
        fn()
        print(f"  ✓ {nome}")
        pas += 1
    except Exception as e:                      # noqa: BLE001
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}")
        fal += 1


def ok(c, m="falhou"):
    if not c:
        raise AssertionError(m)


TIES = ["t-a", "t-b", "t-c", "t-d"]


def perna(h, a):
    return {"goalsHome": h, "goalsAway": a}


def picks_completos():
    # 2x0 na ida, 0x0 na volta => agregado 2x0, sem empate, `qualified` dispensavel
    return {"matches": {t: {"first": perna(2, 0), "second": perna(0, 0)} for t in TIES},
            "qualified": {}}


def estado(entradas):
    return {"entries": entradas, "deletedIds": [],
            "phases": {"quartas": {"cutoffAt": "2026-08-25T23:00:00Z",
                                   "ties": {t: {} for t in TIES}}}}


def entrada(eid, nome, picks, email="alguem@exemplo.invalid"):
    return {"id": eid, "entryName": nome, "picks": picks,
            "updatedAt": "2026-08-18T00:00:00Z", "participantEmail": email}


# ── COMPLETUDE ───────────────────────────────────────────────────────────────────────────────
def t_completo():
    ok(R.tie_complete("t-a", picks_completos()) is True)


def t_perna_faltando():
    p = picks_completos()
    del p["matches"]["t-a"]["second"]
    ok(R.tie_complete("t-a", p) is False, "perna ausente deveria ser incompleto")


def t_gol_invalido():
    p = picks_completos()
    p["matches"]["t-a"]["first"] = {"goalsHome": 99, "goalsAway": 0}
    ok(R.tie_complete("t-a", p) is False, "gol fora de 0..20 deveria ser incompleto")


def t_gol_booleano():
    # True passaria por isinstance(x, int) em Python. A checagem de bool existe por isso.
    p = picks_completos()
    p["matches"]["t-a"]["first"] = {"goalsHome": True, "goalsAway": 0}
    ok(R.tie_complete("t-a", p) is False, "bool nao e placar")


def t_agregado_empatado_sem_classificado():
    p = {"matches": {"t-a": {"first": perna(1, 1), "second": perna(1, 1)}}, "qualified": {}}
    ok(R.tie_complete("t-a", p) is False, "empate no agregado exige classificado")
    p["qualified"]["t-a"] = "time-x"
    ok(R.tie_complete("t-a", p) is True, "com classificado passa a ser completo")


def t_elegibilidade():
    est = estado([
        entrada("e1", "Completa", picks_completos()),
        entrada("e2", "Incompleta", {"matches": {}, "qualified": {}}),
        entrada("e3", "Sem email", {"matches": {}, "qualified": {}}, email=""),
    ])
    todas, alvos, ties = R.eligible(est)
    ok(len(todas) == 3, f"3 entradas, vi {len(todas)}")
    ok(len(ties) == 4)
    nomes = {a["entryName"] for a in alvos}
    ok(nomes == {"Incompleta"}, f"so a incompleta com e-mail e alvo, vi {nomes}")


def t_topologia_errada_aborta():
    est = estado([entrada("e1", "X", picks_completos())])
    del est["phases"]["quartas"]["ties"]["t-d"]
    try:
        R.eligible(est)
    except RuntimeError as e:
        ok("esperava 4" in str(e))
        return
    raise AssertionError("topologia com 3 confrontos deveria abortar")


# ── FASE A: 1:1 ──────────────────────────────────────────────────────────────────────────────
def _alvo(eid, nome):
    return {"entryId": eid, "entryName": nome, "picksFingerprint": "fp",
            "_addr": "x@exemplo.invalid", "scorelinesSaved": 0, "expectedTies": 4}


def t_rotacao_feliz():
    emitidos = {}

    def issue(eid, nota):
        emitidos[eid] = "T" * 40 + eid
        return emitidos[eid]

    def rpc(fn, args):
        ok(fn == "cdb_my_entry")
        eid = args["p_token"][40:]
        return {"id": eid, "entryName": {"e1": "Um", "e2": "Dois"}[eid]}

    p = R.rotate_and_verify([_alvo("e1", "Um"), _alvo("e2", "Dois")],
                            rpc=rpc, issue=issue, verbose=False)
    ok(len(p) == 2)
    ok(p[0]["linkEntryId"] == "e1" and p[1]["linkEntryId"] == "e2")


def t_link_cruzado_aborta():
    """O defeito que mandaria a pessoa editar os palpites de outra pessoa."""
    def issue(eid, nota):
        return "T" * 40 + eid

    def rpc(fn, args):
        return {"id": "OUTRA", "entryName": "Outra"}   # sempre a entrada errada

    try:
        R.rotate_and_verify([_alvo("e1", "Um")], rpc=rpc, issue=issue, verbose=False)
    except RuntimeError as e:
        ok("CROSS_ENTRY_LINK_MISMATCH" in str(e), str(e))
        return
    raise AssertionError("link cruzado deveria abortar o lote")


def t_nome_divergente_aborta():
    def issue(eid, nota):
        return "T" * 40 + eid

    def rpc(fn, args):
        return {"id": "e1", "entryName": "Nome Diferente"}

    try:
        R.rotate_and_verify([_alvo("e1", "Um")], rpc=rpc, issue=issue, verbose=False)
    except RuntimeError as e:
        ok("nome divergente" in str(e))
        return
    raise AssertionError("nome divergente deveria abortar")


def t_link_morto_aborta():
    def issue(eid, nota):
        return "T" * 40 + eid

    def rpc(fn, args):
        return None            # token nao autentica

    try:
        R.rotate_and_verify([_alvo("e1", "Um")], rpc=rpc, issue=issue, verbose=False)
    except RuntimeError as e:
        ok("nao autentica" in str(e))
        return
    raise AssertionError("link morto deveria abortar")


def t_colisao_de_token_aborta():
    def issue(eid, nota):
        return "T" * 45          # MESMO token para todo mundo

    def rpc(fn, args):
        return {"id": "e1", "entryName": "Um"}

    try:
        R.rotate_and_verify([_alvo("e1", "Um"), _alvo("e2", "Dois")],
                            rpc=rpc, issue=issue, verbose=False)
    except RuntimeError as e:
        ok("COLISAO" in str(e) or "MISMATCH" in str(e), str(e))
        return
    raise AssertionError("token repetido deveria abortar")


# ── NAO-MUTACAO ──────────────────────────────────────────────────────────────────────────────
def t_estado_intacto_passa():
    est = estado([entrada("e1", "Um", picks_completos())])
    fp = R.state_fingerprint(est)
    R.assert_state_untouched(fp, {"e1": R.picks_fingerprint(est["entries"][0])},
                             copy.deepcopy(est), verbose=False)


def t_palpite_alterado_aborta():
    est = estado([entrada("e1", "Um", picks_completos())])
    fp = R.state_fingerprint(est)
    por = {"e1": R.picks_fingerprint(est["entries"][0])}
    depois = copy.deepcopy(est)
    depois["entries"][0]["picks"]["matches"]["t-a"]["first"]["goalsHome"] = 7
    try:
        R.assert_state_untouched(fp, por, depois, verbose=False)
    except RuntimeError as e:
        ok("AUTHORITATIVE_STATE_CHANGED" in str(e))
        ok("e1" in str(e), "deveria nomear a entrada culpada")
        return
    raise AssertionError("palpite alterado deveria abortar")


def t_qualified_alterado_aborta():
    est = estado([entrada("e1", "Um", picks_completos())])
    fp = R.state_fingerprint(est)
    depois = copy.deepcopy(est)
    depois["entries"][0]["picks"]["qualified"]["t-a"] = "time-y"
    try:
        R.assert_state_untouched(fp, {"e1": R.picks_fingerprint(est["entries"][0])},
                                 depois, verbose=False)
    except RuntimeError:
        return
    raise AssertionError("qualified alterado deveria abortar")


def t_mudanca_fora_do_lote_tambem_aborta():
    """A impressao digital e GLOBAL de proposito: pagamento/resultado tambem sao protegidos."""
    est = estado([entrada("e1", "Um", picks_completos())])
    est["paid"] = {"e1": True}
    fp = R.state_fingerprint(est)
    depois = copy.deepcopy(est)
    depois["paid"]["e1"] = False
    try:
        R.assert_state_untouched(fp, {"e1": R.picks_fingerprint(est["entries"][0])},
                                 depois, verbose=False)
    except RuntimeError:
        return
    raise AssertionError("mudanca em `paid` deveria abortar")


# ── IDEMPOTENCIA / ENVIO ─────────────────────────────────────────────────────────────────────
def t_ja_lembrado_nao_reenvia():
    chamadas = []

    def rpc(fn, args):
        chamadas.append(args["p_business_key"])
        return [{"total": 1, "accepted": 1}]

    ent = R.already_reminded([_alvo("e1", "Um")], rpc=rpc)
    ok(ent == {"e1"})
    ok(chamadas == ["cdb2026:qf-reminder:e1:v1"], chamadas)


def t_uncertain_tambem_bloqueia():
    """Reserva incerta NAO libera reenvio automatico."""
    ok(R.already_reminded([_alvo("e1", "Um")],
                          rpc=lambda f, a: [{"total": 1, "accepted": 0}]) == {"e1"})


def t_ledger_ilegivel_falha_fechado():
    try:
        R.already_reminded([_alvo("e1", "Um")], rpc=lambda f, a: {"lixo": 1})
    except RuntimeError as e:
        ok("sem ledger nao se envia" in str(e))
        return
    raise AssertionError("ledger ilegivel deveria falhar fechado")


def _pronto(eid, nome):
    return {**_alvo(eid, nome), "_token": "T" * 40, "linkEntryId": eid, "linkEntryName": nome}


def t_envio_reserva_antes_do_provedor():
    ordem = []

    def rpc(fn, args):
        ordem.append(fn)
        if fn == "reserve_delivery":
            return [{"reserved": True, "delivery_id": "d1"}]
        return None

    def envia(addr, assunto, html):
        ordem.append("PROVEDOR")
        ok("#t=" in html, "o link pessoal precisa estar no corpo")
        return 200, "ok"

    r = R.send_batch([_pronto("e1", "Um")], "2026-08-25T23:00:00Z", rpc=rpc, envia=envia)
    ok(r["accepted"] == 1 and r["providerCalls"] == 1, r)
    ok(ordem == ["reserve_delivery", "PROVEDOR", "settle_delivery"], ordem)


def t_reserva_recusada_nao_chama_provedor():
    def rpc(fn, args):
        if fn == "reserve_delivery":
            return [{"reserved": False, "reason": "JA_ENTREGUE"}]
        raise AssertionError("nao deveria settle sem reserva")

    def envia(*a):
        raise AssertionError("PROVEDOR NAO PODE SER CHAMADO")

    r = R.send_batch([_pronto("e1", "Um")], "2026-08-25T23:00:00Z", rpc=rpc, envia=envia)
    ok(r["providerCalls"] == 0 and r["skipped"] == 1, r)


def t_falha_de_transporte_vira_uncertain():
    settled = {}

    def rpc(fn, args):
        if fn == "reserve_delivery":
            return [{"reserved": True, "delivery_id": "d1"}]
        settled.update(args)
        return None

    def envia(*a):
        raise OSError("conexao caiu")

    r = R.send_batch([_pronto("e1", "Um")], "2026-08-25T23:00:00Z", rpc=rpc, envia=envia)
    ok(r["uncertain"] == 1 and r["accepted"] == 0, r)
    ok(settled.get("p_status") == "uncertain", settled)


def t_teto_duro():
    """Nunca mais chamadas ao provedor do que alvos congelados."""
    def rpc(fn, args):
        return [{"reserved": True, "delivery_id": "d1"}] if fn == "reserve_delivery" else None
    n = {"c": 0}

    def envia(*a):
        n["c"] += 1
        return 200, "ok"

    R.send_batch([_pronto("e1", "Um"), _pronto("e2", "Dois")],
                 "2026-08-25T23:00:00Z", rpc=rpc, envia=envia)
    ok(n["c"] == 2, f"esperava 2 chamadas, vi {n['c']}")


def t_corpo_sem_pii_de_terceiro():
    html = R.build_html("https://x.invalid/#t=abc", "2026-08-25T23:00:00Z")
    ok("@" not in html.replace("&nbsp;", ""), "o corpo nao carrega endereco de e-mail")
    ok("25/08" in html and "20h00" in html, "o prazo precisa aparecer")


def t_chave_de_negocio_por_entrada():
    ok(R.business_key("e1") != R.business_key("e2"))
    ok(R.business_key("e1").startswith("cdb2026:qf-reminder:"))


print("\nCDB2026 — lembrete das quartas\n")
for nome, fn in list(globals().items()):
    if nome.startswith("t_") and callable(fn):
        teste(nome[2:].replace("_", " "), fn)
print(f"\n  {pas} passed, {fal} failed\n")
sys.exit(1 if fal else 0)
