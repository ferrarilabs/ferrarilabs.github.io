#!/usr/bin/env python3
"""
Prova do endurecimento pós-incidente do catch-up de comprovantes (CDB2026) — SEM REDE, SEM BANCO.

═══ NENHUM E-MAIL REAL SAI DAQUI ════════════════════════════════════════════════════════════════

  1. `urllib.request.urlopen` é trocado por uma sentinela que LEVANTA para QUALQUER host — este
     teste não fala com PostgREST nem com EmailJS; o banco inteiro é um dublê em memória;
  2. o transporte é uma função local que conta chamadas;
  3. `BOLAO_ALLOW_REAL_SEND` não é definido em lugar nenhum.

═══ O QUE ESTE TESTE PROVA ══════════════════════════════════════════════════════════════════════

  §7  o incidente de 2026-08-16, reproduzido: Bossle e Rodrigo Hajj PULADOS, Nathalia e Aline
      atendidas, `providerCalls = 2`, segunda execução `= 0`;
  §4  `DATE_FILTER_ONLY_DEDUPE = NO` — com os quatro dentro da mesma janela, o resultado é o
      mesmo, porque quem separa é a identidade cross-path, não a data;
  §2  a matriz cross-path inteira (normal↔catch-up, teste de template, legado provado);
  §3  legado sem versão provável FALHA FECHADO e vai para revisão do operador;
  §5  envio real sem escopo explícito é RECUSADO;
  §6  a leitura autoritativa de completude encontra semifinal/final onde a contagem de confrontos
      registrados dizia "só até as quartas".

  §8  MUTAÇÕES: remover a checagem cross-path, ou voltar a decidir só por data/`lastClientRef`,
      deixa a suíte VERMELHA. Sem isso as verificações acima poderiam estar passando por acaso.

═══ LIMITAÇÃO DECLARADA ═════════════════════════════════════════════════════════════════════════

O dublê implementa `cdb_has_accepted_receipt` chamando `receipt_identity.classify_ledger` — a
MESMA regra que a função SQL aplica, mas escrita em Python. Isso prova a decisão e o fluxo; não
prova o corpo do PL/pgSQL. Por isso §9 confere ESTRUTURALMENTE o SQL implantado: lista de
famílias, status que bloqueiam, e a presença das saídas de falha fechada. É a mesma técnica que
`test_entry_saved_confirmation.py` usa para provar a posição do insert dentro de
`cdb_save_my_picks`, e a limitação fica nomeada, não escondida.
"""

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))

import receipt_identity as ID       # noqa: E402
import receipt_catchup_tool as T    # noqa: E402

falhas = []


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


# ── A REDE INTEIRA É PROIBIDA NESTE ARQUIVO ──────────────────────────────────────────────────
def _urlopen_proibido(req, *a, **k):
    alvo = req.full_url if hasattr(req, "full_url") else str(req)
    raise AssertionError(f"TENTATIVA DE REDE DENTRO DO TESTE OFFLINE: {alvo}")


urllib.request.urlopen = _urlopen_proibido


# ════════════════════════════════════════════════════════════════════════════════════════════
#  DUBLÊ DO BANCO
# ════════════════════════════════════════════════════════════════════════════════════════════
class FakeDB:
    """
    Reproduz a semântica que importa: unicidade de entrega, disjuntor por família, permissão
    nominal, e a pergunta canônica cross-path. Não reproduz o hash exato do Postgres — a
    identidade só precisa ser determinística e consistente dentro do teste.
    """

    def __init__(self, entries, phases=None):
        self.state = {"entries": entries, "deletedIds": [], "phases": phases or {}}
        self.deliveries = []      # {business_key, family, recipient_hash, generation, status}
        self.attestations = []    # {entry_id, picks_version, certainty}
        self.allowances = set()
        self.rpc_calls = []

    # ── utilidades ───────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _hash(addr):
        return hashlib.sha256(addr.strip().lower().encode()).hexdigest()

    def _entry(self, eid):
        if eid in (self.state.get("deletedIds") or []):
            return None
        return next((e for e in self.state["entries"] if e.get("id") == eid), None)

    def seed_delivery(self, entry_id, business_key, family, status="accepted"):
        e = self._entry(entry_id)
        self.deliveries.append({"business_key": business_key, "family": family,
                                "recipient_hash": self._hash(e["participantEmail"]),
                                "generation": 1, "status": status})

    def seed_attestation(self, entry_id, picks_version, certainty):
        self.attestations.append({"entry_id": entry_id, "picks_version": picks_version,
                                  "certainty": certainty})

    # ── a superfície RPC ─────────────────────────────────────────────────────────────────────
    def rpc(self, nome, args):
        self.rpc_calls.append(nome)
        return getattr(self, f"_rpc_{nome}")(args)

    def _rpc_cdb_picks_version(self, args):
        picks = args.get("p_picks") or {}
        canon = {"matches": picks.get("matches") or {}, "qualified": picks.get("qualified") or {}}
        return hashlib.sha256(json.dumps(canon, sort_keys=True,
                                         separators=(",", ":")).encode()).hexdigest()[:16]

    def _rpc_cdb_has_accepted_receipt(self, args):
        eid, versao = args["p_entry_id"], args["p_picks_version"]
        e = self._entry(eid)
        if e is None or not (e.get("participantEmail") or "").strip():
            return [{"accepted": False, "uncertain": True, "paths": [],
                     "reason": "DESTINATARIO_NAO_RESOLVIVEL: falha fechada"}]
        h = self._hash(e["participantEmail"])
        linhas = [d for d in self.deliveries if d["recipient_hash"] == h]
        atest = [a for a in self.attestations if a["entry_id"] == eid]
        d = ID.classify_ledger(linhas, versao, atest)
        return [{"accepted": d.accepted, "uncertain": d.uncertain,
                 "paths": d.paths, "reason": d.reason}]

    def _rpc_reserve_delivery(self, args):
        h = self._hash(args["p_recipient"])
        fam = args.get("p_family") or args["p_business_key"]
        # Disjuntor: outra FAMÍLIA para a mesma pessoa, recente. Sem relógio no dublê, "recente"
        # é "existe" — o suficiente para provar que o caminho não passa por baixo dele.
        if not args.get("p_bypass_anomaly"):
            for d in self.deliveries:
                if (d["recipient_hash"] == h and d["family"] != fam
                        and d["status"] in ("accepted", "claimed")):
                    return [{"reserved": False, "reason": "ANOMALIA_ENVIO_RAPIDO",
                             "delivery_id": None}]
        # UNIQUE(app, business_key, recipient_hash, generation)
        for d in self.deliveries:
            if (d["business_key"] == args["p_business_key"] and d["recipient_hash"] == h
                    and d["generation"] == args.get("p_generation", 1)):
                return [{"reserved": False, "reason": "JA_ENTREGUE: reserva existente",
                         "delivery_id": None}]
        did = f"del-{len(self.deliveries)}"
        self.deliveries.append({"business_key": args["p_business_key"], "family": fam,
                                "recipient_hash": h, "generation": args.get("p_generation", 1),
                                "status": "claimed", "delivery_id": did})
        return [{"reserved": True, "reason": None, "delivery_id": did}]

    def _rpc_settle_delivery(self, args):
        for d in self.deliveries:
            if d.get("delivery_id") == args["p_delivery_id"] and d["status"] != "accepted":
                d["status"] = args["p_status"]
        return args["p_status"]

    def _rpc_cdb_grant_confirmation_allowance(self, args):
        self.allowances.add(args["p_entry_id"])
        return len(self.allowances)

    def _rpc_cdb_close_confirmation_allowance(self, args):
        self.allowances.discard(args["p_entry_id"])
        return 1

    def _rpc_cdb_confirmation_recipient(self, args):
        eid = args["p_entry_id"]
        if eid not in self.allowances:
            return [{"allowed": False, "recipient": None, "entry_name": None}]
        e = self._entry(eid)
        if e is None or not (e.get("participantEmail") or "").strip():
            return [{"allowed": False, "recipient": None, "entry_name": None}]
        return [{"allowed": True, "recipient": e["participantEmail"],
                 "entry_name": e.get("entryName")}]


# ── TRANSPORTE FALSO ─────────────────────────────────────────────────────────────────────────
class Transporte:
    def __init__(self):
        self.calls = []

    def __call__(self, addr, assunto, corpo):
        self.calls.append({"assunto": assunto, "len": len(corpo)})
        return True, "fake-ok", f"fake:{len(self.calls)}"


# ── PALPITES E FASES DO TORNEIO (públicos; nenhum PII) ───────────────────────────────────────
#
# Quatro quartas registradas + semifinal e final APENAS como topologia — a forma exata da
# produção em agosto/2026, e a razão de a contagem de confrontos registrados parar em 12.
FASES = {
    "oitavas": {"ties": {f"of-{i}": {"teamA": f"Time{2*i}", "teamB": f"Time{2*i+1}"}
                         for i in range(1, 9)}, "topology": {}},
    "quartas": {"ties": {
        "qf-1": {"teamA": "Internacional", "teamB": "Grêmio"},
        "qf-2": {"teamA": "Cruzeiro", "teamB": "Atlético-MG"},
        "qf-3": {"teamA": "Vasco", "teamB": "Vitória"},
        "qf-4": {"teamA": "Palmeiras", "teamB": "Santos"},
    }, "topology": {}},
    "semifinal": {"ties": {}, "topology": {"slots": {
        "sf-1": {"sideA": {"winnerOf": "qf-1"}, "sideB": {"winnerOf": "qf-2"}},
        "sf-2": {"sideA": {"winnerOf": "qf-3"}, "sideB": {"winnerOf": "qf-4"}},
    }}},
    "final": {"ties": {}, "topology": {}},
}


def picks_completos(gol=2):
    """Palpites que vão até a final — passando por confrontos VIRTUAIS de semi e final."""
    return {
        "matches": {
            "qf-1": {"first": {"goalsHome": gol, "goalsAway": 1},
                     "second": {"goalsHome": 0, "goalsAway": 3}},
            "qf-2": {"first": {"goalsHome": 1, "goalsAway": 0},
                     "second": {"goalsHome": 1, "goalsAway": 1}},
            "qf-3": {"first": {"goalsHome": 2, "goalsAway": 0},
                     "second": {"goalsHome": 1, "goalsAway": 1}},
            "qf-4": {"first": {"goalsHome": 3, "goalsAway": 1},
                     "second": {"goalsHome": 0, "goalsAway": 0}},
            "sf-1": {"first": {"goalsHome": 1, "goalsAway": 1},
                     "second": {"goalsHome": 2, "goalsAway": 0}},
            "sf-2": {"first": {"goalsHome": 2, "goalsAway": 0},
                     "second": {"goalsHome": 3, "goalsAway": 2}},
            "final-1": {"single": {"goalsHome": 2, "goalsAway": 0}},
        },
        "qualified": {"qf-1": "B", "qf-2": "A", "qf-3": "A", "qf-4": "A",
                      "sf-1": "A", "sf-2": "B", "final-1": "A"},
    }


def entrada(eid, nome, dominio, updated_at, gol=2, ref="ref-1"):
    return {"id": eid, "entryName": nome, "participantEmail": f"{eid}@{dominio}",
            "updatedAt": updated_at, "lastClientRef": ref, "picks": picks_completos(gol)}


# Domínio reservado por RFC 2606 — nunca é entregável, nem por acidente de configuração.
DOM = "exemplo.invalid"

BOSSLE = "11111111-1111-4111-8111-111111111111"
RODRIGO = "22222222-2222-4222-8222-222222222222"
NATHALIA = "33333333-3333-4333-8333-333333333333"
ALINE = "44444444-4444-4444-8444-444444444444"


def monta(dias):
    """`dias` = {entry_id: (nome, updatedAt, gol)}. Devolve (db, transporte)."""
    entries = [entrada(eid, nome, DOM, upd, gol) for eid, (nome, upd, gol) in dias.items()]
    return FakeDB(entries, FASES), Transporte()


def catchup(db, transporte, target, **kw):
    return T.Catchup(rpc=db.rpc, estado_fn=lambda: db.state, envia_fn=transporte,
                     target_date=target, **kw)


# ════════════════════════════════════════════════════════════════════════════════════════════
def main():  # noqa: C901 — um roteiro linear de cenários; quebrar em funções esconderia a ordem
    print("PROVA — dedupe cross-path do comprovante (offline, sem rede)\n")

    # ═══ 1. IDENTIDADE CANÔNICA ══════════════════════════════════════════════════════════════
    print("1. a identidade é ENTRADA + VERSÃO, e é a MESMA do caminho de produção")
    import send_entry_saved_confirmation as C
    checa("a chave canônica é literalmente a de produção",
          ID.canonical_business_key("abc123") == C.business_key("abc123"),
          f"{ID.canonical_business_key('abc123')} vs {C.business_key('abc123')}")
    checa("a família canônica é a de produção", ID.CANONICAL_FAMILY == C.FAMILY)
    try:
        ID.canonical_business_key("")
        checa("chave sem versão é recusada", False, "não levantou")
    except ValueError:
        checa("chave sem versão é recusada", True)
    checa("a versão só casa delimitada por ':'",
          ID.key_carries_version("cdb2026:entry-saved-confirmation:deadbeef:v1", "deadbeef")
          and not ID.key_carries_version("cdb2026:entry-saved-confirmation:deadbeefcafe:v1",
                                         "deadbeef"))

    # ═══ 7. O INCIDENTE DE 2026-08-16, REPRODUZIDO ═══════════════════════════════════════════
    print("\n7. reprodução do incidente — datas reais dos quatro participantes")
    db, tr = monta({
        BOSSLE:   ("Bossle",       "2026-08-13T18:00:00Z", 2),
        RODRIGO:  ("Rodrigo Hajj", "2026-08-14T19:30:00Z", 3),
        NATHALIA: ("Nathalia",     "2026-08-16T01:20:00Z", 4),   # 15/08 21:20 NY
        ALINE:    ("Aline",        "2026-08-16T02:05:00Z", 5),   # 15/08 22:05 NY
    })
    # Bossle e Rodrigo já receberam o recibo da versão que está gravada — por caminhos
    # LEGÍTIMOS e DIFERENTES entre si. É exatamente o que o one-off não perguntou.
    v_bossle = db.rpc("cdb_picks_version", {"p_picks": db._entry(BOSSLE)["picks"]})
    v_rodrigo = db.rpc("cdb_picks_version", {"p_picks": db._entry(RODRIGO)["picks"]})
    db.seed_delivery(BOSSLE, ID.canonical_business_key(v_bossle), ID.CANONICAL_FAMILY)
    db.seed_delivery(RODRIGO,
                     f"cdb2026:entry-saved-confirmation-catchup-20260812:{RODRIGO}:{v_rodrigo}:v1",
                     "cdb2026:entry-saved-confirmation-catchup-20260812")

    cat = catchup(db, tr, "2026-08-15")
    todas, elegiveis = cat.medir()
    por_nome = {r["entryName"]: r for r in todas}

    checa("BOSSLE = SKIP_ALREADY_RECEIVED_SAME_VERSION",
          por_nome["Bossle"]["estado"] == "SKIP_ALREADY_RECEIVED_SAME_VERSION",
          por_nome["Bossle"]["estado"])
    checa("RODRIGO = SKIP_ALREADY_RECEIVED_SAME_VERSION",
          por_nome["Rodrigo Hajj"]["estado"] == "SKIP_ALREADY_RECEIVED_SAME_VERSION",
          por_nome["Rodrigo Hajj"]["estado"])
    checa("o motivo do skip é o recibo, NÃO a data",
          all("RECIBO_ACEITO" in por_nome[n]["motivo"] for n in ("Bossle", "Rodrigo Hajj")),
          str([por_nome[n]["motivo"] for n in ("Bossle", "Rodrigo Hajj")]))
    checa("MANIFESTO = [Nathalia, Aline]",
          sorted(r["entryName"] for r in elegiveis) == ["Aline", "Nathalia"],
          str([r["entryName"] for r in elegiveis]))

    stats = cat.enviar(elegiveis)
    checa("PROVIDER_CALLS = 2", stats["providerCalls"] == 2, str(stats))
    checa("NATHALIA_SENDS = 1 e ALINE_SENDS = 1", stats["accepted"] == 2, str(stats))
    checa("BOSSLE_SENDS = 0 e RODRIGO_SENDS = 0", len(tr.calls) == 2, str(len(tr.calls)))

    # Segunda execução, do zero: remede e reenvia o mesmo manifesto congelado.
    cat2 = catchup(db, tr, "2026-08-15")
    todas2, eleg2 = cat2.medir()
    checa("SECOND_RUN_MANIFEST = vazio", eleg2 == [], str([r["entryName"] for r in eleg2]))
    stats2 = cat2.enviar(elegiveis)   # o manifesto ANTIGO, teimosamente reexecutado
    checa("SECOND_RUN_PROVIDER_CALLS = 0", stats2["providerCalls"] == 0, str(stats2))
    checa("nenhuma chamada nova ao transporte", len(tr.calls) == 2, str(len(tr.calls)))

    # ═══ 4. A DATA NÃO É O CONTROLE DE DUPLICATA ═════════════════════════════════════════════
    print("\n4. DATE_FILTER_ONLY_DEDUPE = NO — os quatro na MESMA janela, mesmo resultado")

    def cenario_mesma_janela():
        d, t = monta({
            BOSSLE:   ("Bossle",       "2026-08-16T01:00:00Z", 2),
            RODRIGO:  ("Rodrigo Hajj", "2026-08-16T01:10:00Z", 3),
            NATHALIA: ("Nathalia",     "2026-08-16T01:20:00Z", 4),
            ALINE:    ("Aline",        "2026-08-16T02:05:00Z", 5),
        })
        vb = d.rpc("cdb_picks_version", {"p_picks": d._entry(BOSSLE)["picks"]})
        vr = d.rpc("cdb_picks_version", {"p_picks": d._entry(RODRIGO)["picks"]})
        d.seed_delivery(BOSSLE, ID.canonical_business_key(vb), ID.CANONICAL_FAMILY)
        d.seed_delivery(RODRIGO,
                        f"cdb2026:entry-saved-confirmation-catchup-20260812:{RODRIGO}:{vr}:v1",
                        "cdb2026:entry-saved-confirmation-catchup-20260812")
        return d, t

    dbj, trj = cenario_mesma_janela()
    catj = catchup(dbj, trj, "2026-08-15")
    _, elegj = catj.medir()
    checa("com a data igual para os quatro, o manifesto continua [Nathalia, Aline]",
          sorted(r["entryName"] for r in elegj) == ["Aline", "Nathalia"],
          str([r["entryName"] for r in elegj]))
    sj = catj.enviar(elegj)
    checa("PROVIDER_CALLS = 2 também aqui", sj["providerCalls"] == 2, str(sj))

    # ═══ 2. A MATRIZ CROSS-PATH ══════════════════════════════════════════════════════════════
    print("\n2. matriz cross-path — o mesmo fato por transportes diferentes")

    def um_alvo(seed=None, atest=None):
        d, t = monta({NATHALIA: ("Nathalia", "2026-08-16T01:20:00Z", 4)})
        v = d.rpc("cdb_picks_version", {"p_picks": d._entry(NATHALIA)["picks"]})
        if seed:
            d.seed_delivery(NATHALIA, seed(v)[0], seed(v)[1], seed(v)[2] if len(seed(v)) > 2
                            else "accepted")
        if atest:
            d.seed_attestation(NATHALIA, atest[0](v) if callable(atest[0]) else atest[0], atest[1])
        c = catchup(d, t, "2026-08-15")
        _, el = c.medir()
        st = c.enviar(el)
        return d, t, st, el, v

    # NORMAL_RECEIPT_THEN_CATCHUP
    _, _, st, el, _ = um_alvo(seed=lambda v: (ID.canonical_business_key(v), ID.CANONICAL_FAMILY))
    checa("NORMAL_RECEIPT_THEN_CATCHUP = 0", st["providerCalls"] == 0 and el == [], str(st))

    # TEMPLATE_ACCEPTED_THEN_CATCHUP
    _, _, st, el, _ = um_alvo(seed=lambda v: (
        f"cdb2026:entry-saved-confirmation-template-test:{v}:v3",
        "cdb2026:entry-saved-confirmation-template-test"))
    checa("TEMPLATE_ACCEPTED_THEN_CATCHUP = 0", st["providerCalls"] == 0 and el == [], str(st))

    # LEGACY_PROVABLE_SAME_VERSION_THEN_CATCHUP
    _, _, st, el, _ = um_alvo(atest=(lambda v: v, "PROVEN"))
    checa("LEGACY_PROVABLE_SAME_VERSION_THEN_CATCHUP = 0",
          st["providerCalls"] == 0 and el == [], str(st))

    # Reserva não liquidada e reserva incerta também bloqueiam (falha fechada).
    for status in ("claimed", "uncertain"):
        _, _, st, el, _ = um_alvo(seed=lambda v, s=status: (ID.canonical_business_key(v),
                                                            ID.CANONICAL_FAMILY, s))
        checa(f"reserva '{status}' bloqueia o reenvio (falha fechada)",
              st["providerCalls"] == 0 and el == [], str(st))

    # CATCHUP_THEN_NORMAL_RECEIPT: o catch-up envia; depois o consumidor agendado tenta a chave
    # de produção e tem de bater em JA_ENTREGUE — no BANCO, sem consultar nada em Python.
    d, t = monta({NATHALIA: ("Nathalia", "2026-08-16T01:20:00Z", 4)})
    c = catchup(d, t, "2026-08-15")
    _, el = c.medir()
    st = c.enviar(el)
    checa("catch-up entrega uma vez", st["providerCalls"] == 1, str(st))
    v = d.rpc("cdb_picks_version", {"p_picks": d._entry(NATHALIA)["picks"]})
    reserva = d.rpc("reserve_delivery", {
        "p_app": "cdb2026", "p_business_key": C.business_key(v),
        "p_recipient": d._entry(NATHALIA)["participantEmail"], "p_generation": 1,
        "p_family": C.FAMILY})
    checa("CATCHUP_THEN_NORMAL_RECEIPT = 0 (JA_ENTREGUE no banco)",
          reserva[0]["reserved"] is False and "JA_ENTREGUE" in reserva[0]["reason"],
          str(reserva))
    checa("a colisão foi de CHAVE, não de checagem em Python",
          C.business_key(v) == ID.canonical_business_key(v))

    # SAME_VERSION_AGAIN / SAME_ENTRY_NEW_PICKS_VERSION
    c2 = catchup(d, t, "2026-08-15")
    _, el2 = c2.medir()
    checa("SAME_VERSION_AGAIN = 0", el2 == [] and c2.enviar(el2)["providerCalls"] == 0)

    d._entry(NATHALIA)["picks"] = picks_completos(gol=6)     # previsão materialmente diferente
    d._entry(NATHALIA)["lastClientRef"] = "ref-2"
    c3 = catchup(d, t, "2026-08-15")
    _, el3 = c3.medir()
    st3 = c3.enviar(el3)
    checa("SAME_ENTRY_NEW_PICKS_VERSION = 1", st3["providerCalls"] == 1 and len(el3) == 1,
          str(st3))
    c4 = catchup(d, t, "2026-08-15")
    _, el4 = c4.medir()
    checa("e a versão nova, de novo, = 0", el4 == [] and c4.enviar(el4)["providerCalls"] == 0)

    # Família NÃO declarada não deduplica — o lado ruidoso do erro, de propósito.
    d2, t2 = monta({NATHALIA: ("Nathalia", "2026-08-16T01:20:00Z", 4)})
    v2 = d2.rpc("cdb_picks_version", {"p_picks": d2._entry(NATHALIA)["picks"]})
    d2.seed_delivery(NATHALIA, f"cdb2026:convite-fase:{v2}:v1", "cdb2026:convite-fase")
    _, el5 = catchup(d2, t2, "2026-08-15").medir()
    checa("família não declarada NÃO conta como recibo (falha ruidosa, não silenciosa)",
          len(el5) == 1, str([r["estado"] for r in el5]))

    # ═══ 3. LEGADO SEM VERSÃO PROVÁVEL ═══════════════════════════════════════════════════════
    print("\n3. legado incerto — falha fechada e vai para revisão do operador")
    d3, t3 = monta({NATHALIA: ("Nathalia", "2026-08-16T01:20:00Z", 4)})
    d3.seed_attestation(NATHALIA, None, "UNCERTAIN")
    c5 = catchup(d3, t3, "2026-08-15")
    todas5, el6 = c5.medir()
    checa("LEGACY_UNCERTAIN = SKIP_UNCERTAIN_NEEDS_OPERATOR_REVIEW",
          todas5[0]["estado"] == "SKIP_UNCERTAIN_NEEDS_OPERATOR_REVIEW", todas5[0]["estado"])
    checa("legado incerto não envia", c5.enviar(el6)["providerCalls"] == 0)
    # E a atestação incerta NÃO carrega versão — não se inventa hash histórico.
    checa("UNCERTAIN não carrega picks_version", d3.attestations[0]["picks_version"] is None)

    # RPC ausente/quebrada também bloqueia.
    def rpc_quebrada(nome, args):
        if nome == "cdb_has_accepted_receipt":
            raise RuntimeError("PostgREST 404: function does not exist")
        return d3.rpc(nome, args)

    c6 = T.Catchup(rpc=rpc_quebrada, estado_fn=lambda: d3.state, envia_fn=t3,
                   target_date="2026-08-15")
    todas6, el7 = c6.medir()
    checa("RPC ausente = falha fechada, não liberação",
          todas6[0]["estado"] == "SKIP_UNCERTAIN_NEEDS_OPERATOR_REVIEW" and el7 == [],
          todas6[0]["motivo"])

    # ═══ 5. ESCOPO EXPLÍCITO ═════════════════════════════════════════════════════════════════
    print("\n5. REAL_RUN_WITHOUT_EXPLICIT_SCOPE = REFUSED")
    checa("--enviar sem --target-date é recusado",
          T.main(["--enviar", "--approve", "HUMAN_APPROVED", "--manifest", "/dev/null"]) == 2)
    checa("--enviar sem --approve é recusado",
          T.main(["--enviar", "--target-date", "2026-08-15", "--manifest", "/dev/null"]) == 2)
    checa("--enviar sem --manifest é recusado",
          T.main(["--enviar", "--target-date", "2026-08-15",
                  "--approve", "HUMAN_APPROVED"]) == 2)
    checa("sem ação, imprime ajuda e sai 2", T.main([]) == 2)
    fonte = (AQUI / "receipt_catchup_tool.py").read_text()
    i_target = fonte.index("if args.enviar and not args.target_date")
    i_import = fonte.index("import m8m9")
    checa("a recusa vem ANTES de qualquer fiação de produção", i_target < i_import)

    # ═══ 6. LEITURA AUTORITATIVA ═════════════════════════════════════════════════════════════
    print("\n6. OPERATOR_DIAGNOSTIC_USES_AUTHORITATIVE_STATE = YES")
    snap = T.snapshot_de(
        {"entryName": "Nathalia", "updatedAt": "2026-08-16T01:20:00Z",
         "picks": picks_completos(4)},
        {"phases": FASES})

    # O DIAGNÓSTICO ERRADO, reproduzido: contar confrontos REGISTRADOS. Vai até as quartas e
    # para, porque semifinal e final ainda não foram materializadas pela CBF.
    registrados = sum(len((f or {}).get("ties") or {}) for f in (snap.get("phases") or {}).values())
    ties_registradas = {t for f in (snap.get("phases") or {}).values()
                        for t in ((f or {}).get("ties") or {})}
    palpites_visiveis = [t for t in (snap["picks"]["matches"] or {}) if t in ties_registradas]
    checa("o diagnóstico ERRADO vê 12 confrontos registrados", registrados == 12,
          str(registrados))
    checa("e conclui 'sem palpite de semifinal/final'",
          not any(t.startswith(("sf-", "final-")) for t in palpites_visiveis),
          str(palpites_visiveis))

    # A LEITURA AUTORITATIVA: mesma resolução do comprovante, confrontos virtuais incluídos.
    comp = ID.authoritative_pick_completeness(snap)
    checa("a leitura autoritativa chega até a final", comp["chegaAteFinal"] is True, str(comp))
    checa("última fase com palpite = 'final'", comp["ultimaFaseComPalpite"] == "final",
          str(comp["ultimaFaseComPalpite"]))
    checa("semifinal tem palpite e é reconhecida como VIRTUAL",
          comp["porFase"]["semifinal"]["comPalpite"] == 2
          and comp["porFase"]["semifinal"]["virtual"] is True,
          str(comp["porFase"]["semifinal"]))
    checa("campeão e vice resolvidos", bool(comp["campeao"] and comp["vice"]),
          f"{comp['campeao']} / {comp['vice']}")
    checa("as duas leituras DE FATO discordam (é a regressão histórica)",
          comp["chegaAteFinal"] and not any(t.startswith("sf-") for t in palpites_visiveis))
    checa("o relatório do catch-up usa a leitura autoritativa",
          por_nome["Nathalia"]["bracket"]["chegaAteFinal"] is True
          and por_nome["Nathalia"]["bracket"]["ultimaFaseComPalpite"] == "final",
          str(por_nome["Nathalia"]["bracket"]))

    # ═══ 8. MUTAÇÕES — as verificações acima têm de ser load-bearing ═════════════════════════
    print("\n8. mutações — cada uma tem de deixar o cenário VERMELHO")

    original = ID.has_accepted_receipt
    try:
        # MUTAÇÃO 1: remover a checagem cross-path (sempre "nunca recebeu").
        ID.has_accepted_receipt = lambda eid, v, rpc: ID.Decision(False, False, [], "MUTANTE")
        dm, tm = cenario_mesma_janela()
        _, elm = catchup(dm, tm, "2026-08-15").medir()
        checa("MUTAÇÃO 'sem dedupe cross-path' reabre o incidente (4 alvos)",
              sorted(r["entryName"] for r in elm)
              == ["Aline", "Bossle", "Nathalia", "Rodrigo Hajj"],
              str([r["entryName"] for r in elm]))
        checa("  -> logo, a verificação de §4 é load-bearing", len(elm) == 4)
    finally:
        ID.has_accepted_receipt = original

    # MUTAÇÃO 2: elegibilidade só por data/lastClientRef — o critério dos one-offs.
    dm2, _ = cenario_mesma_janela()
    so_por_data = [e["entryName"] for e in dm2.state["entries"]
                   if e.get("lastClientRef") and T.dia_ny(e["updatedAt"]) == "2026-08-15"]
    checa("MUTAÇÃO 'só data + lastClientRef' também reabre o incidente (4 alvos)",
          sorted(so_por_data) == ["Aline", "Bossle", "Nathalia", "Rodrigo Hajj"],
          str(so_por_data))
    checa("  -> DATE_FILTER_ONLY_DEDUPE = NO está provado, não afirmado", len(so_por_data) == 4)

    # ═══ 9. O SQL IMPLANTADO CASA COM O QUE ESTE TESTE EXERCITA ══════════════════════════════
    print("\n9. paridade estrutural com a migração (a limitação declarada no cabeçalho)")
    sql = (RAIZ / "supabase" / "migrations"
           / "20260816000000_cdb_receipt_identity_is_cross_path.sql").read_text()
    for fam in ID.RECEIPT_FAMILIES:
        checa(f"família registrada no SQL: {fam.split(':')[-1]}", f"'{fam}'" in sql)
    corpo = sql[sql.index("create or replace function public.cdb_has_accepted_receipt"):]
    corpo = corpo[:corpo.index("revoke all on function public.cdb_has_accepted_receipt")]
    checa("o SQL trata 'accepted' como aceito", "r.status = 'accepted'" in corpo)
    checa("o SQL trata 'claimed'/'uncertain' como incerto",
          "in ('claimed', 'uncertain')" in corpo)
    checa("os mesmos status estão no Python",
          ID.STATUS_ACEITO == ("accepted",) and ID.STATUS_INCERTO == ("claimed", "uncertain"))
    checa("o SQL casa a versão delimitada por ':' dos dois lados",
          "'%:' || p_picks_version || ':%'" in corpo)
    checa("o SQL só considera família DECLARADA (join no registro)",
          "join bolao.cdb_receipt_family_registry" in corpo)
    checa("versão ausente -> falha fechada no SQL", "VERSAO_AUSENTE" in corpo)
    checa("destinatário não resolvível -> falha fechada no SQL",
          "DESTINATARIO_NAO_RESOLVIVEL" in corpo)
    checa("o SQL nunca devolve endereço", "returns table (accepted boolean, uncertain boolean, "
          "paths text[], reason text)" in sql and "return query select v_email" not in sql)
    checa("legado UNCERTAIN bloqueia no SQL",
          "certainty = 'UNCERTAIN'" in corpo and "v_unc := true" in corpo)

    # ═══ 10. NENHUM EFEITO COLATERAL ═════════════════════════════════════════════════════════
    print("\n10. nenhum efeito colateral")
    checa("nenhuma permissão ficou aberta", db.allowances == set() and d.allowances == set(),
          f"{db.allowances} {d.allowances}")
    checa("os palpites dos participantes não foram tocados por este arquivo",
          db._entry(BOSSLE)["picks"] == picks_completos(2)
          and db._entry(NATHALIA)["picks"] == picks_completos(4))
    checa("os one-offs estão desarmados",
          all("raise SystemExit(" in (AQUI / "archive" / n).read_text()
              for n in ("receipt_catchup_20260812.py", "receipt_catchup_20260816.py")))
    checa("os one-offs não estão mais no diretório de ferramentas",
          not (AQUI / "receipt_catchup.py").exists()
          and not (AQUI / "receipt_catchup_20260816.py").exists())

    print("\n" + "=" * 78)
    if falhas:
        print(f"FALHOU — {len(falhas)}: {falhas}")
        return 1
    print("CROSS_PATH_VERSION_DEDUPE = YES   DATE_FILTER_ONLY_DEDUPE = NO")
    print("BOSSLE = 0   RODRIGO = 0   NATHALIA = 1   ALINE = 1   SECOND_RUN = 0")
    print("REAL_RUN_WITHOUT_EXPLICIT_SCOPE = REFUSED   REAL_EMAILS_SENT = 0")
    print("TODAS AS VERIFICAÇÕES PASSARAM")
    return 0


if __name__ == "__main__":
    sys.exit(main())
