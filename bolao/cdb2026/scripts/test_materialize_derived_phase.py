#!/usr/bin/env python3
"""test_materialize_derived_phase.py — materialização de fase DERIVADA (#410).

─── O QUE ISTO PROTEGE ─────────────────────────────────────────────────────────────────────────

O comando grava estado de torneio em produção num app que movimenta dinheiro real por entrada. O
jeito de ele causar dano não é falhar — é ACERTAR O ALVO ERRADO: materializar cedo demais, inventar
um clube, inventar uma data que a CBF não publicou, ou apagar/duplicar confronto.

Por isso quase todo teste aqui é uma RECUSA. O caminho feliz é um; as guardas são sete.

─── O CASO DE ACEITAÇÃO ────────────────────────────────────────────────────────────────────────

Quartas → Semifinal do CDB2026, derivado (não inventado) da topologia CBF validada em
2026-08-12T19:00:00Z mais os `qualifiedTeamId` persistidos:

    sf-1: winnerOf(gremio_internacional) x winnerOf(atletico-mg_cruzeiro) -> Grêmio x Atlético-MG
    sf-2: winnerOf(vasco_vitoria)        x winnerOf(palmeiras_santos)     -> Vasco  x Palmeiras

Hermético: sem rede, sem Supabase, sem provedor, sem participante. `le_estado`/`_rpc` são injetados.
"""
import importlib.util
import io
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key-nao-usada")
sys.path.insert(0, str(AQUI))

spec = importlib.util.spec_from_file_location("opcli", AQUI / "operator_cli.py")
OP = importlib.util.module_from_spec(spec)
spec.loader.exec_module(OP)

ok = fail = 0


def test(nome, fn):
    global ok, fail
    try:
        fn(); print(f"  ✓ {nome}"); ok += 1
    except AssertionError as e:
        print(f"  ✗ {nome}\n      {e}"); fail += 1
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}"); fail += 1


def A(c, m):
    if not c:
        raise AssertionError(m)


class Args:
    def __init__(self, phase, dry_run=False, actor="teste"):
        self.phase, self.dry_run, self.actor = phase, dry_run, actor


TOPO_OK = {
    "slots": {
        "sf-1": {"sideA": {"winnerOf": "espn-gremio_internacional"},
                 "sideB": {"winnerOf": "espn-atletico-mg_cruzeiro"}},
        "sf-2": {"sideA": {"winnerOf": "espn-vasco_vitoria"},
                 "sideB": {"winnerOf": "espn-palmeiras_santos"}},
    },
    "provenance": {"authority": "CBF", "validatedAt": "2026-08-12T19:00:00Z"},
}


def tie(a, b, qual, placar=True):
    m = {"first": {"goalsHome": 1 if placar else None, "goalsAway": 0},
         "second": {"goalsHome": 0 if placar else None, "goalsAway": 0}}
    return {"teamA": a, "teamB": b, "qualifiedTeamId": qual, "matches": m}


def estado(quartas_ok=True, topo=TOPO_OK, semi_ties=None, ativo="quartas"):
    q = {
        "espn-vasco_vitoria": tie("Vasco", "Vitória", "A"),
        "espn-palmeiras_santos": tie("Palmeiras", "Santos", "A"),
        "espn-atletico-mg_cruzeiro": tie("Cruzeiro", "Atlético-MG", "B"),
        "espn-gremio_internacional": tie("Internacional", "Grêmio", "B" if quartas_ok else None,
                                         placar=quartas_ok),
    }
    semi = {"ties": semi_ties or {}}
    if topo:
        semi["topology"] = topo
    return {
        "espnSync": {"activePhaseId": ativo}, "activePhase": ativo,
        "entries": [{"id": f"e{i}", "picks": {"matches": {}}} for i in range(12)],
        "paid": {f"e{i}": True for i in range(12)},
        "phases": {"quartas": {"ties": q}, "semifinal": semi, "final": {"ties": {}}},
    }


def rodar(args, est, gravar=True, trilha=True):
    """Executa o comando com estado injetado. Devolve (rc, saida, rpcs, estado_final).

    O `_rpc` falso imita o `cdb_apply_operator_mutation`: aplica a mutacao estreita E registra a
    entrada de auditoria a partir do `client_ref`. `trilha=False` simula um servidor que aplicou a
    escrita sem registrar a trilha — o comando tem de ABORTAR, nao passar batido.
    """
    rpcs = []
    atual = {"e": est}

    def fake_le_estado():
        import copy
        return copy.deepcopy(atual["e"])

    def fake_rpc(tipo, payload, client_ref, actor="operator-cli"):
        rpcs.append({"tipo": tipo, "payload": payload, "clientRef": client_ref})
        if gravar and tipo == "create-tie":
            p = payload
            atual["e"]["phases"][p["phaseId"]].setdefault("ties", {})[p["tieId"]] = {
                "teamA": p["teamA"], "teamB": p["teamB"], "qualifiedTeamId": None,
                "matches": {
                    "first": {"kickoff": p.get("kickoffFirst"), "venue": None, "city": None,
                              "goalsHome": None, "goalsAway": None, "status": "SCHEDULED"},
                    "second": {"kickoff": p.get("kickoffSecond"), "venue": None, "city": None,
                               "goalsHome": None, "goalsAway": None, "status": "SCHEDULED"},
                },
            }
            if trilha:
                atual["e"].setdefault("auditLog", []).append({
                    "type": "materialize-derived-phase", "actor": actor,
                    "clientRef": client_ref, "source": "operator-cli",
                })
        return {}

    orig_le, orig_rpc = OP.le_estado, OP._rpc
    OP.le_estado, OP._rpc = fake_le_estado, fake_rpc
    try:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = OP.cmd_materialize_derived_phase(args)
        return rc, buf.getvalue(), rpcs, atual["e"]
    finally:
        OP.le_estado, OP._rpc = orig_le, orig_rpc


print("\nMaterialização de fase derivada — o que ela RECUSA\n")
print("A. Caminho feliz")


def _feliz():
    rc, out, rpcs, fim = rodar(Args("semifinal"), estado())
    A(rc == 0, f"rc={rc}\n{out}")
    ties = fim["phases"]["semifinal"]["ties"]
    A(len(ties) == 2, f"{len(ties)} confrontos: {sorted(ties)}")
    pares = sorted(tuple(sorted([t["teamA"], t["teamB"]])) for t in ties.values())
    A(pares == [("Atlético-MG", "Grêmio"), ("Palmeiras", "Vasco")], pares)
    A(len([r for r in rpcs if r["tipo"] == "create-tie"]) == 2, rpcs)


test("1. fase decidida + topologia autoritativa => materializa Grêmio×Atlético-MG e Vasco×Palmeiras",
     _feliz)


def _sem_agenda_inventada():
    _, out, rpcs, fim = rodar(Args("semifinal"), estado())
    for r in rpcs:
        A(r["payload"]["kickoffFirst"] is None and r["payload"]["kickoffSecond"] is None,
          f"kickoff inventado no RPC: {r['payload']}")
    for tid, t in fim["phases"]["semifinal"]["ties"].items():
        for leg, m in t["matches"].items():
            for campo in ("kickoff", "venue", "city"):
                A(m[campo] is None, f"{tid}:{leg}.{campo} = {m[campo]!r} — não pode ser inventado")


test("6. confronto conhecido SEM data/hora oficial => kickoff/venue/city nulos (#395)",
     _sem_agenda_inventada)


print("\nB. Guardas — cada uma recusa, nenhuma 'corrige' em silêncio")


def _parcial():
    rc, out, rpcs, _ = rodar(Args("semifinal"), estado(quartas_ok=False))
    A(rc == 2, f"rc={rc}\n{out}")
    A("nao esta inteiramente decidida" in out, out)
    A(rpcs == [], f"gravou apesar de recusar: {rpcs}")


test("2. fase corrente PARCIALMENTE decidida => recusa, sem gravar", _parcial)


def _vencedor_sem_placar():
    """Vencedor gravado mas perna sem placar — decidido "no papel", não no campo.

    Vale como caso separado porque as duas metades da guarda são independentes: um `qualifiedTeamId`
    presente com uma perna em branco significa resultado incompleto, e materializar em cima disso
    propaga um vencedor que a fase ainda não produziu.
    """
    e = estado()
    e["phases"]["quartas"]["ties"]["espn-palmeiras_santos"]["matches"]["second"]["goalsHome"] = None
    rc, out, rpcs, _ = rodar(Args("semifinal"), e)
    A(rc == 2 and rpcs == [], f"rc={rc} rpcs={rpcs}\n{out}")
    A("sem placar" in out, out)


test("2b. vencedor gravado mas perna SEM placar => recusa", _vencedor_sem_placar)


def _sem_topologia():
    rc, out, rpcs, _ = rodar(Args("semifinal"), estado(topo=None))
    A(rc == 2 and rpcs == [], f"rc={rc} rpcs={rpcs}\n{out}")
    A("sem topologia autoritativa" in out, out)


def _topologia_nao_validada():
    ruim = {"slots": TOPO_OK["slots"], "provenance": {"authority": "palpite"}}
    rc, out, rpcs, _ = rodar(Args("semifinal"), estado(topo=ruim))
    A(rc == 2 and rpcs == [], f"aceitou topologia não validada\n{out}")


test("3a. topologia AUSENTE => recusa", _sem_topologia)
test("3b. topologia sem proveniência CBF validada => recusa", _topologia_nao_validada)


def _ja_materializada():
    ja = {"espn-atletico-mg_gremio": tie("Grêmio", "Atlético-MG", None)}
    rc, out, rpcs, fim = rodar(Args("semifinal"), estado(semi_ties=ja))
    A(rc == 0, f"idempotente deve sair 0, veio {rc}\n{out}")
    A(rpcs == [], f"gravou sobre fase já materializada: {rpcs}")
    A(len(fim["phases"]["semifinal"]["ties"]) == 1, "duplicou confronto")


test("4. sucessora JÁ materializada => idempotente, exit 0, nenhuma escrita", _ja_materializada)


def _vencedor_ausente():
    e = estado()
    e["phases"]["quartas"]["ties"]["espn-vasco_vitoria"]["qualifiedTeamId"] = None
    rc, out, rpcs, _ = rodar(Args("semifinal"), e)
    A(rc == 2 and rpcs == [], f"rc={rc} rpcs={rpcs}\n{out}")


def _predecessor_desconhecido():
    topo = {"slots": {"sf-1": {"sideA": {"winnerOf": "espn-nao-existe"},
                               "sideB": {"winnerOf": "espn-vasco_vitoria"}}},
            "provenance": TOPO_OK["provenance"]}
    rc, out, rpcs, _ = rodar(Args("semifinal"), estado(topo=topo))
    A(rc == 2 and rpcs == [], f"aceitou predecessor inexistente\n{out}")
    A("predecessor fora de" in out or "vencedor ausente" in out, out)


test("5a. vencedor ausente na fase anterior => recusa", _vencedor_ausente)
test("5b. topologia apontando predecessor inexistente => recusa", _predecessor_desconhecido)


def _slot_incompleto():
    """Vaga de topologia sem os dois `winnerOf`.

    Duas guardas independentes têm de pegar isto: o slot vira erro de derivação E a contagem final
    (`len(novos) != len(slots)`) não fecha. A segunda é a que sobrevive a um refactor que, um dia,
    troque um `erros.append` por um `continue`.
    """
    topo = {"slots": {"sf-1": {"sideA": {"winnerOf": "espn-vasco_vitoria"}, "sideB": {}},
                      "sf-2": {"sideA": {"winnerOf": "espn-gremio_internacional"},
                               "sideB": {"winnerOf": "espn-atletico-mg_cruzeiro"}}},
            "provenance": TOPO_OK["provenance"]}
    rc, out, rpcs, _ = rodar(Args("semifinal"), estado(topo=topo))
    A(rc == 2, f"materializou uma semifinal pela metade (rc={rc})\n{out}")
    A(rpcs == [], f"gravou o slot bom e engoliu o quebrado: {rpcs}")


test("5c. vaga de topologia incompleta => recusa a fase INTEIRA, não materializa só a metade boa",
     _slot_incompleto)


def _fase_nao_derivada():
    rc, out, _, _ = rodar(Args("quartas"), estado())
    A(rc == 2 and "nao e fase derivada" in out, out)


test("fase não-derivada (quartas) => recusa — o comando não é um criador de confrontos genérico",
     _fase_nao_derivada)


print("\nC. Efeitos colaterais — o que ele nunca toca")


def _rerun_sem_mutacao():
    e = estado()
    rc1, _, rpcs1, e1 = rodar(Args("semifinal"), e)
    A(rc1 == 0 and len(rpcs1) == 2, "primeira execução falhou")
    rc2, out2, rpcs2, e2 = rodar(Args("semifinal"), e1)
    A(rc2 == 0, f"rerun rc={rc2}\n{out2}")
    A(rpcs2 == [], f"rerun gravou: {rpcs2}")
    A(sorted(e2["phases"]["semifinal"]["ties"]) == sorted(e1["phases"]["semifinal"]["ties"]),
      "rerun alterou os confrontos")


test("7. reexecução após sucesso => nenhuma mutação, nenhum RPC", _rerun_sem_mutacao)


def _nao_toca_o_resto():
    e = estado()
    import copy, json, hashlib
    antes = copy.deepcopy(e)
    _, _, _, fim = rodar(Args("semifinal"), e)
    h = lambda o: hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    A(h(antes["entries"]) == h(fim["entries"]), "entries mudou")
    A(len(fim.get("auditLog") or []) == 2, "a trilha de auditoria deve ter 1 entrada por confronto")
    A(h(antes["paid"]) == h(fim["paid"]), "paid mudou")
    A(h(antes["phases"]["quartas"]) == h(fim["phases"]["quartas"]), "quartas (fase anterior) mudou")
    A(h(antes["phases"]["final"]) == h(fim["phases"]["final"]), "final mudou")
    A(fim["espnSync"]["activePhaseId"] == antes["espnSync"]["activePhaseId"],
      "activePhaseId mudou — materializar NÃO avança fase")


test("8. entries/paid/fase anterior/final/activePhaseId estáveis por fingerprint", _nao_toca_o_resto)


def _sem_email_sem_scoring():
    fonte = (AQUI / "operator_cli.py").read_text()
    i = fonte.index("def cmd_materialize_derived_phase(")
    j = fonte.index("\ndef cmd_open_picks(", i)
    corpo = fonte[i:j]
    codigo = "\n".join(l.split("#")[0] for l in corpo.split("\n"))
    for p in ["send_email", "emailjs", "EMAILJS", "BOLAO_ALLOW_REAL_SEND", "score_entry",
              "audit_scoring", "ranking", "set-payment", "upsert-entry", "set-active-phase"]:
        A(p not in codigo, f"o comando referencia `{p}` — ele só materializa confrontos")


test("não manda e-mail, não recalcula scoring/ranking, não toca entradas/pagamentos, "
     "não avança fase", _sem_email_sem_scoring)


def _dry_run_nao_grava():
    rc, out, rpcs, fim = rodar(Args("semifinal", dry_run=True), estado())
    A(rc == 0, f"rc={rc}\n{out}")
    A(rpcs == [], f"dry-run gravou: {rpcs}")
    A(fim["phases"]["semifinal"]["ties"] == {}, "dry-run materializou")
    A("DRY RUN" in out and "Grêmio" in out and "Atlético-MG" in out,
      "dry-run precisa MOSTRAR exatamente o que gravaria")


test("dry-run mostra os confrontos exatos e não grava nada", _dry_run_nao_grava)


def _trilha_ausente_aborta():
    rc, out, rpcs, _ = rodar(Args("semifinal"), estado(), trilha=False)
    A(len(rpcs) == 2, "o teste precisa que a escrita ocorra para exercer a verificação")
    A(rc == 2, f"servidor sem trilha de auditoria passou batido (rc={rc})\n{out}")
    A("sem trilha de auditoria" in out, out)


test("escrita sem trilha de auditoria no servidor => aborta (evidência é verificada, não assumida)",
     _trilha_ausente_aborta)

print(f"\n  {ok} passed, {fail} failed\n")
print("✗ MATERIALIZE DERIVED PHASE FAILED" if fail else "✓ MATERIALIZE DERIVED PHASE OK")
sys.exit(1 if fail else 0)
