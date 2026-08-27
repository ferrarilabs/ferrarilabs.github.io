#!/usr/bin/env python3
"""test_reconcile_result_email_ledger.py — a reconciliação histórica, provada (#352).

Esta ferramenta escreve em produção. Então o que interessa não é que ela funcione: é que ela
RECUSE em todo caso que não seja exatamente o cenário revisado, que seja ATÔMICA, que seja
IDEMPOTENTE, e que não tenha como emitir e-mail.

Dados sintéticos e herméticos. Sem rede, sem Supabase, sem e-mail.

Uso: python3 bolao/cdb2026/scripts/test_reconcile_result_email_ledger.py
"""
import importlib.util
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")
sys.path.insert(0, str(AQUI))

_FONTE = (AQUI / "reconcile_result_email_ledger.py").read_text()
_SQL = (AQUI.parent.parent.parent / "supabase" / "migrations"
        / "20260827090000_reconcile_historical_notif_delivery.sql").read_text()


def carregar(fonte=None):
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("rec", loader=None))
    mod.__file__ = str(AQUI / "reconcile_result_email_ledger.py")
    exec(compile(fonte or _FONTE, mod.__file__, "exec"), mod.__dict__)
    return mod


R = carregar()
L = R._ledger_mod()

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
RUN = "33014485622"
QUANDO = "2026-08-26T21:15:17Z"
EVID = {"source_run": RUN, "delivered_at": QUANDO, "delivered": 12, "errors": 0}
REFS12 = [f"ref-{i:02d}" for i in range(12)]


def estado(res=(1, 1)):
    m = {"kickoff": "2026-08-26T00:00:00Z", "homeTeam": "Cruzeiro", "awayTeam": "Atlético-MG"}
    if res:
        m.update({"goalsHome": res[0], "goalsAway": res[1], "status": "FINAL"})
    return {"phases": {"quartas": {"ties": {
        ALVO[1]: {"teamA": "Cruzeiro", "teamB": "Atlético-MG",
                  "matches": {"first": m, "second": {"kickoff": "2026-09-02T00:00:00Z"}}},
        "espn-palmeiras_santos": {"teamA": "Palmeiras", "teamB": "Santos",
                                  "matches": {"first": dict(m), "second": {}}},
    }}}}


class LedgerFalso:
    def __init__(self, linhas, quebrado=False):
        self.linhas = linhas
        self.quebrado = quebrado

    def status_rows(self):
        if self.quebrado:
            raise RuntimeError("fora do ar")
        return list(self.linhas)


def linhas(refs, status="pending", alvo=ALVO):
    return [(L.idempotency_key(*alvo, r), status) for r in refs]


def pre(lin=None, evid=None, est=None, expect="1-1", alvo=ALVO, quebrado=False):
    return R.preflight(L, alvo[0], alvo[1], alvo[2], expect,
                       evid if evid is not None else EVID,
                       LedgerFalso(lin if lin is not None else linhas(REFS12), quebrado),
                       est if est is not None else estado())


print("\nReconciliação histórica — o que ela RECUSA\n")
print("A. O cenário exato de 2026-08-26:")


def _cenario_exato():
    ev = pre()
    _assert(ev["TARGET_STATUS"] == R.READY, f"{ev['TARGET_STATUS']} — {ev['MOTIVO']}")
    for k, v in [("LEDGER_TOTAL_ROWS", 12), ("LEDGER_PENDING_ROWS", 12), ("LEDGER_SENT_ROWS", 0),
                 ("ENTRY_REFS_UNIQUE", 12), ("PROVIDER_SUCCESS_EVIDENCE", 12),
                 ("PROVIDER_ERROR_EVIDENCE", 0), ("PROPOSED_SENT_COUNT", 12)]:
        _assert(ev[k] == v, f"{k} = {ev[k]}, esperado {v}")
    _assert(ev["TARGET_ENTITY"] == "quartas:espn-atletico-mg_cruzeiro:first", ev["TARGET_ENTITY"])
    _assert(ev["PROVIDER_MESSAGE_ID_RECOVERABLE"] == "NO", "id de provedor nao pode ser dado como recuperavel")
    _assert(ev["SENT_AT_SOURCE"] == QUANDO, ev["SENT_AT_SOURCE"])

test("12 pending + evidência de 12 entregas ⇒ READY, com a entidade exata", _cenario_exato)


print("\nB. Conjunto que não bate ⇒ BLOCKED:")

for n, rotulo in [(11, "11 linhas"), (13, "13 linhas")]:
    def _conjunto(n=n):
        ev = pre(lin=linhas([f"ref-{i:02d}" for i in range(n)]))
        _assert(ev["TARGET_STATUS"] == R.BLOCKED, f"aceitou {n} linhas: {ev['TARGET_STATUS']}")
    test(f"{rotulo} contra 12 sucessos ⇒ BLOCKED", _conjunto)


def _uma_ja_sent():
    lin = linhas(REFS12[:11]) + linhas(REFS12[11:], status="sent")
    ev = pre(lin=lin)
    _assert(ev["TARGET_STATUS"] == R.BLOCKED,
            f"mistura de pending e sent tem de bloquear: {ev['TARGET_STATUS']}")
    _assert("parcial" in ev["MOTIVO"], ev["MOTIVO"])

test("uma linha já SENT no meio ⇒ BLOCKED (reconciliação parcial não existe)", _uma_ja_sent)


def _todas_sent_e_idempotente():
    ev = pre(lin=linhas(REFS12, status="sent"))
    _assert(ev["TARGET_STATUS"] == R.ALREADY, ev["TARGET_STATUS"])
    _assert(ev["PROPOSED_SENT_COUNT"] == 0, "nao pode propor mudanca quando ja esta tudo sent")

test("todas já SENT ⇒ ALREADY_RECONCILED, zero propostas (idempotente)", _todas_sent_e_idempotente)


def _entry_ref_duplicado():
    lin = linhas(REFS12[:11] + [REFS12[0]])
    ev = pre(lin=lin)
    _assert(ev["TARGET_STATUS"] == R.BLOCKED, ev["TARGET_STATUS"])

test("entry_ref duplicado ⇒ BLOCKED", _entry_ref_duplicado)


def _estado_inesperado():
    lin = linhas(REFS12[:11]) + linhas(REFS12[11:], status="failed_permanent")
    ev = pre(lin=lin)
    _assert(ev["TARGET_STATUS"] == R.BLOCKED, ev["TARGET_STATUS"])

test("linha em estado não previsto ⇒ BLOCKED", _estado_inesperado)


print("\nC. Alvo e evidência:")


def _alvo_errado():
    # Linhas existem, mas para OUTRO confronto das quartas.
    ev = pre(lin=linhas(REFS12, alvo=("quartas", "espn-palmeiras_santos", "first")))
    _assert(ev["TARGET_STATUS"] == R.BLOCKED,
            "linhas de outro confronto nao podem satisfazer este alvo")
    _assert(ev["LEDGER_TOTAL_ROWS"] == 0, ev["LEDGER_TOTAL_ROWS"])

test("linhas de outro confronto não contam para o alvo ⇒ BLOCKED", _alvo_errado)


def _placar_errado():
    ev = pre(expect="2-0")
    _assert(ev["TARGET_STATUS"] == R.BLOCKED, ev["TARGET_STATUS"])
    _assert("placar" in ev["MOTIVO"], ev["MOTIVO"])

test("placar esperado != gravado ⇒ BLOCKED", _placar_errado)


def _evidencia_insuficiente():
    for mudanca, rotulo in [({"delivered": 11}, "11 sucessos"), ({"errors": 1}, "1 erro"),
                            ({"source_run": ""}, "sem run autorizada"),
                            ({"delivered_at": ""}, "sem instante de entrega")]:
        e = dict(EVID); e.update(mudanca)
        ev = pre(evid=e)
        _assert(ev["TARGET_STATUS"] == R.BLOCKED, f"aceitou com {rotulo}: {ev['TARGET_STATUS']}")

test("evidência != 12 sucessos / com erro / sem run / sem instante ⇒ BLOCKED", _evidencia_insuficiente)


def _ledger_ilegivel():
    ev = pre(quebrado=True)
    _assert(ev["TARGET_STATUS"] == R.BLOCKED, ev["TARGET_STATUS"])
    _assert(ev["LEDGER_TOTAL_ROWS"] == 0, "inventou contagem com ledger fora do ar")

test("ledger ilegível ⇒ BLOCKED, sem contagem inventada", _ledger_ilegivel)


print("\nD. Honestidade do dado:")


def _id_de_provedor_nunca_inventado():
    _assert("provider_message_id = null" in _SQL,
            "o SQL tem de gravar NULL — id por destinatario e irrecuperavel")
    _assert("'providerMessageId', 'UNRECOVERABLE'" in _SQL,
            "a procedencia tem de dizer que o id e irrecuperavel, nao omitir")
    _assert('"provider_message_id" "text"' in (AQUI.parent.parent.parent / "supabase" / "migrations"
            / "20260806000000_baseline_adopted_pre_tracking.sql").read_text(),
            "a coluna precisa ser anulavel para `sent` com NULL ser legal")

test("provider_message_id fica NULL e a procedência diz UNRECOVERABLE", _id_de_provedor_nunca_inventado)


def _sent_at_nao_e_agora():
    _assert("sent_at = p_delivered_at" in _SQL,
            "sent_at tem de vir do instante da execucao autorizada")
    _assert("raise exception 'reconcile: delivered_at obrigatorio" in _SQL,
            "sem delivered_at a funcao tem de levantar, nao cair em now()")
    _assert("'sentAtSource', 'authorized-run-timestamp'" in _SQL,
            "a procedencia tem de registrar DE ONDE veio o sent_at")

test("sent_at vem da execução autorizada, nunca de now(), e a origem fica registrada", _sent_at_nao_e_agora)


def _procedencia_distingue():
    for campo in ("'reason', p_reason", "'sourceRun', p_source_run", "'reconciledAt'"):
        _assert(campo in _SQL, f"procedencia sem `{campo}` — um sent reconciliado ficaria "
                               "indistinguivel de um sent de tempo real")
    _assert(R.RECONCILIATION_REASON == "historical-ledger-defect-352", R.RECONCILIATION_REASON)

test("um SENT reconciliado carrega procedência e não se confunde com um SENT normal", _procedencia_distingue)


print("\nE. Atomicidade e idempotência (no SQL, onde elas podem existir):")


def _atomico():
    corpo = _SQL[_SQL.index("update bolao_notif_jobs"):]
    _assert(corpo.count("update bolao_notif_jobs") == 1,
            "tem de ser UM update — varios admitem o desfecho 7 sent / 5 pending")
    _assert("get diagnostics v_n = row_count" in _SQL and "desfazendo" in _SQL,
            "contagem divergente tem de levantar, e a excecao desfaz o update inteiro")
    _assert("p_expected_rows" in _SQL, "o operador tem de declarar quantas linhas espera")

test("uma única UPDATE + verificação de row_count ⇒ tudo ou nada", _atomico)


def _idempotente_no_sql():
    _assert("ALREADY_RECONCILED" in _SQL, "segunda execucao tem de devolver ALREADY_RECONCILED")
    _assert("payload_snapshot -> 'reconciliation' is not null" in _SQL,
            "a deteccao de ja-reconciliado tem de olhar a procedencia gravada")
    _assert("and status = 'pending'" in _SQL,
            "o update so pode tocar pending — nunca regredir sent")

test("segunda execução ⇒ ALREADY_RECONCILED, e o update nunca regride SENT", _idempotente_no_sql)


def _nao_cria_nem_apaga():
    for proibido in ("insert into bolao_notif_jobs", "delete from bolao_notif_jobs"):
        _assert(proibido not in _SQL.lower(), f"o SQL nao pode `{proibido}`")
    for imutavel in ("entry_ref =", "job_id =", "idempotency_key =", "entity_id ="):
        # `where ... = ` é leitura; o proibido é aparecer no `set`.
        bloco_set = _SQL[_SQL.index("set status = 'sent'"):_SQL.index("where pool_id = p_pool_id and entity_id = p_entity_id and status")]
        _assert(imutavel not in bloco_set, f"o `set` nao pode alterar `{imutavel}`")

test("não cria, não apaga, e não altera identidade histórica", _nao_cria_nem_apaga)


print("\nF. Garantia dura: esta ferramenta não pode emitir e-mail:")


def _codigo_sem_texto(fonte):
    """Remove docstrings e comentarios antes de varrer.

    O arquivo EXPLICA que nao alcanca provedor, e citar os nomes na explicacao fazia a varredura
    acusar a propria documentacao. Um scanner que dispara no comentario e um scanner que alguem
    desliga — a mesma decisao que `test_no_whole_document_writers.mjs` ja tomou.
    """
    import re
    sem = re.sub(r'"""[\s\S]*?"""', " ", fonte)
    return "\n".join(l.split("#")[0] for l in sem.split("\n"))


def _sem_caminho_de_email():
    codigo = _codigo_sem_texto(_FONTE)
    proibidos = ["send_email", "_send_to_all", "BOLAO_ALLOW_REAL_SEND", "emailjs",
                 "smtp", "recover_result_email"]
    for p in proibidos:
        _assert(p.lower() not in codigo.lower(),
                f"a reconciliacao referencia `{p}` no CODIGO — ela nunca pode alcancar um provedor")
    _assert("send_result_email" in codigo,
            "ela carrega o sender apenas para LER estado (sb_fetch) — se isso mudar, revise")
    # E o SQL, por ser SQL, não tem como enviar nada: a garantia ali é estrutural.
    _assert("http" not in _SQL.lower(), "o SQL nao pode alcancar rede")

test("nenhum caminho de provedor é referenciado pela reconciliação", _sem_caminho_de_email)


print("\nG. Controles negativos — cada garantia, isolada:")


def _mut(descr, de, para, checa):
    mutado = _FONTE.replace(de, para, 1)
    _assert(mutado != _FONTE, f"a mutacao `{descr}` nao alterou nada")
    checa(carregar(mutado))


def _mutacao_alvo_vazio():
    """Sem a guarda de conjunto vazio, um alvo SEM NENHUMA linha é declarado pronto.

    Importa porque é o desfecho de um alvo digitado errado: o confronto existe, o resultado existe,
    mas nenhuma linha de ledger pertence a ele. Declarar READY ali levaria a chamar a RPC pedindo
    para reconciliar zero linhas — uma operação sem objeto, sobre um alvo que ninguém revisou.
    """
    def checa(M):
        ev = M.preflight(L, "quartas", "espn-palmeiras_santos", "first", "1-1", EVID,
                         LedgerFalso(linhas(REFS12)), estado())
        _assert(ev["TARGET_STATUS"] == M.READY,
                "CONTROLE NEGATIVO: sem a guarda de conjunto vazio, um alvo sem linhas deveria passar")
        _assert(ev["LEDGER_TOTAL_ROWS"] == 0, "o alvo errado nao pode ter linhas")
    _mut("alvo sem linhas",
         '    if ev["LEDGER_TOTAL_ROWS"] != ev["PROVIDER_SUCCESS_EVIDENCE"]:\n'
         '        ev["MOTIVO"] = (f"linhas ({ev[\'LEDGER_TOTAL_ROWS\']}) != sucessos de provedor "\n'
         '                        f"({ev[\'PROVIDER_SUCCESS_EVIDENCE\']}) — conjuntos nao batem")\n'
         '        return ev\n'
         '    if ev["LEDGER_TOTAL_ROWS"] == 0:\n'
         '        ev["MOTIVO"] = "nenhuma linha para este alvo"\n'
         '        return ev',
         '    pass', checa)

test("mutação (guardas de conjunto removidas) declara pronto um alvo sem linhas", _mutacao_alvo_vazio)


def _mutacao_sem_evidencia():
    def checa(M):
        e = dict(EVID); e["source_run"] = ""
        ev = M.preflight(L, *ALVO, "1-1", e, LedgerFalso(linhas(REFS12)), estado())
        _assert(ev["TARGET_STATUS"] == M.READY,
                "CONTROLE NEGATIVO: sem exigir run autorizada, `pending` sozinho deveria bastar")
    _mut("sem evidencia",
         '    if not evidencia.get("source_run"):',
         '    if False:', checa)

test("mutação (evidência de run dispensada) trata pending como prova de entrega", _mutacao_sem_evidencia)


def _mutacao_parcial_permitida():
    def checa(M):
        lin = linhas(REFS12[:11]) + linhas(REFS12[11:], status="sent")
        ev = M.preflight(L, *ALVO, "1-1", EVID, LedgerFalso(lin), estado())
        _assert(ev["TARGET_STATUS"] == M.READY,
                "CONTROLE NEGATIVO: sem a guarda de parcial, a mistura deveria passar")
    _mut("parcial permitida",
         '    if ev["LEDGER_SENT_ROWS"]:\n        ev["MOTIVO"] = "reconciliacao parcial nao e permitida — ha linhas ja sent misturadas"\n        return ev',
         '    if False:\n        pass', checa)

test("mutação (guarda de parcial removida) aceita conjunto misto", _mutacao_parcial_permitida)


def _mutacao_id_fabricado():
    """Fabricar `provider_message_id` no SQL tem de ser detectado pela asserção de honestidade."""
    sql_mutado = _SQL.replace("provider_message_id = null", "provider_message_id = 'recuperado'", 1)
    _assert(sql_mutado != _SQL, "a mutacao nao alterou o SQL")
    _assert("provider_message_id = null" not in sql_mutado,
            "CONTROLE NEGATIVO: o mutante fabrica um id de provedor, e a assercao de honestidade "
            "acima (que exige `= null`) reprovaria contra ele")

test("mutação (id de provedor fabricado) seria reprovada pela asserção de honestidade", _mutacao_id_fabricado)


def _mutacao_email():
    def checa(_M):
        pass
    mutado = _FONTE.replace("import argparse", "import argparse\nfrom send_result_email import send_email", 1)
    codigo = _codigo_sem_texto(mutado)
    _assert("send_email" in codigo,
            "CONTROLE NEGATIVO: a varredura de F, que ignora comentario, deveria acusar este import")

test("mutação (import de send_email) seria acusada pela varredura de caminho de provedor", _mutacao_email)


print("\nG2. O preflight prova o predicado de ESCRITA, nao so o de leitura:")


def _por_entidade(n):
    return lambda L, ent: [{"entity_id": ent, "status": "pending"} for _ in range(n)]


def _predicado_concorda():
    ev = R.preflight(L, *ALVO, "1-1", EVID, LedgerFalso(linhas(REFS12)), estado(),
                     por_entidade=_por_entidade(12))
    _assert(ev["TARGET_STATUS"] == R.READY, f"{ev['TARGET_STATUS']} — {ev.get('MOTIVO')}")
    _assert(ev["WRITE_PREDICATE_ROWS"] == 12, ev.get("WRITE_PREDICATE_ROWS"))

test("leitura 12 e escrita 12 ⇒ READY", _predicado_concorda)


def _predicado_diverge():
    """O caso REAL de 2026-08-27: 12 por prefixo, 0 por entity_id, e a RPC devolveu 400 mudo."""
    ev = R.preflight(L, *ALVO, "1-1", EVID, LedgerFalso(linhas(REFS12)), estado(),
                     por_entidade=_por_entidade(0))
    _assert(ev["TARGET_STATUS"] == R.BLOCKED,
            f"o preflight aprovou o que a escrita nao endereca: {ev['TARGET_STATUS']}")
    _assert("predicado" in ev["MOTIVO"], ev["MOTIVO"])

test("leitura 12 mas escrita 0 ⇒ BLOCKED (o 400 mudo de 2026-08-27)", _predicado_diverge)


def _predicado_ilegivel():
    def explode(L_, ent): raise RuntimeError("fora do ar")
    ev = R.preflight(L, *ALVO, "1-1", EVID, LedgerFalso(linhas(REFS12)), estado(),
                     por_entidade=explode)
    _assert(ev["TARGET_STATUS"] == R.BLOCKED, ev["TARGET_STATUS"])
    _assert(ev["WRITE_PREDICATE_ROWS"] == "ILEGIVEL", "nao pode inventar contagem")

test("predicado de escrita ilegível ⇒ BLOCKED, sem contagem inventada", _predicado_ilegivel)


def _mutacao_predicado():
    """CONTROLE NEGATIVO: sem a checagem, a divergencia volta a passar."""
    fonte = _FONTE.replace("        if len(linhas_ent) != ev[\"LEDGER_TOTAL_ROWS\"]:",
                           "        if False:", 1)
    _assert(fonte != _FONTE, "a mutacao nao alterou nada")
    M = carregar(fonte)
    ev = M.preflight(L, *ALVO, "1-1", EVID, LedgerFalso(linhas(REFS12)), estado(),
                     por_entidade=_por_entidade(0))
    _assert(ev["TARGET_STATUS"] == M.READY,
            "CONTROLE NEGATIVO: sem a checagem, escrita=0 deveria passar")

test("mutação (checagem de predicado removida) deixa a divergência passar", _mutacao_predicado)


def _erro_do_servidor_propagado():
    """Um 400 sem corpo e uma recusa sem explicacao — foi o que o operador viu."""
    codigo = _codigo_sem_texto(_FONTE)
    _assert("e.read()" in codigo, "o corpo da resposta tem de ser lido")
    _assert("HTTP {e.code}" in codigo, "o codigo HTTP tem de aparecer na mensagem")

test("a recusa da RPC chega com a mensagem da guarda, não como 400 mudo", _erro_do_servidor_propagado)


print("\nH. O vigia deriva HEALTHY sozinho, sem regra nova:")


def _vigia_nao_muda():
    det = (AQUI / "detect_missed_result_emails.py").read_text()
    _assert("delivered_entity_ids" in det,
            "o vigia le entregas pelo ledger — reconciliar linhas para `sent` basta para ele virar HEALTHY")
    _assert(R.RECONCILIATION_REASON not in det,
            "o vigia NAO pode conhecer a reconciliacao: se precisasse, o desenho estaria errado")

test("o watchdog não precisa saber que houve reconciliação", _vigia_nao_muda)


print(f"\n  {ok} passed, {fail} failed\n")
if fail:
    print("✗ RECONCILIACAO HISTORICA REPROVADA\n")
    sys.exit(1)
print("✓ RECONCILIACAO HISTORICA OK\n")
