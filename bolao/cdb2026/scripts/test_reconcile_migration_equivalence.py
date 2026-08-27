#!/usr/bin/env python3
"""test_reconcile_migration_equivalence.py — a correcao de ambiguidade NAO muda semantica (#352).

Uma correcao de ambiguidade e o lugar classico para uma guarda desaparecer sem ninguem notar: o
diff e ruidoso (`j.` em todo lado) e o olho passa batido. Entao a equivalencia e provada
MECANICAMENTE -- remove-se a qualificacao das duas versoes e elas tem de ficar identicas.
"""
import re, sys
from pathlib import Path

MIG = Path(__file__).resolve().parents[3] / "supabase" / "migrations"
A = (MIG / "20260827090000_reconcile_historical_notif_delivery.sql").read_text()
B = (MIG / "20260827120000_reconcile_historical_qualify_status.sql").read_text()

ok = fail = 0
def test(nome, fn):
    global ok, fail
    try:
        fn(); print("  \u2713 " + nome); ok += 1
    except AssertionError as e:
        print("  \u2717 " + nome + "\n      " + str(e)); fail += 1

def A_(c, m):
    if not c: raise AssertionError(m)

def desqualificar(x):
    x = x[x.index("create or replace function"):]
    x = x.replace("bolao_notif_jobs j", "bolao_notif_jobs")
    x = re.sub(r"\bj\.", "", x)
    x = re.sub(r"\bbolao_notif_jobs\.", "", x)
    return re.sub(r"\s+", " ", x).strip()

print("\nCorrecao de ambiguidade — semantica preservada\n")

test("removida a qualificacao, os dois corpos sao IDENTICOS",
     lambda: A_(desqualificar(A) == desqualificar(B),
                "a correcao mudou mais do que a qualificacao dos identificadores"))

def _guardas():
    for g in ["conjunto mudou", "entry_ref duplicado", "estado nao previsto",
              "reconciliacao parcial nao e permitida", "desfazendo",
              "reason e source_run sao obrigatorios", "delivered_at obrigatorio"]:
        A_(g in B, "guarda perdida na correcao: " + g)
    A_(B.count("raise exception") == A.count("raise exception"), "o numero de guardas mudou")
test("todas as guardas sobreviveram, e sao o mesmo numero", _guardas)

def _honestidade():
    A_("provider_message_id = null" in B, "o id de provedor voltou a ser gravado")
    A_("'providerMessageId', 'UNRECOVERABLE'" in B, "a procedencia perdeu o marcador de irrecuperavel")
    A_("status = 'sent'" in B, "o update deixou de marcar sent")
    A_("sent_at = p_delivered_at" in B, "sent_at deixou de vir do operador")
test("honestidade do dado intacta (NULL, UNRECOVERABLE, sent_at do operador)", _honestidade)

def _assinatura():
    for p in ["p_pool_id", "p_entity_id", "p_expected_rows", "p_reason", "p_source_run", "p_delivered_at"]:
        A_(p in B, "parametro sumiu: " + p)
    A_('"status" text' in B and '"detail" text' in B,
       "o formato de retorno mudou — quem le linha['status'] quebraria")
    A_('to "service_role"' in B, "o grant deixou de ser exclusivo de service_role")
test("assinatura e formato de retorno inalterados", _assinatura)

def _ambiguidade_resolvida():
    corpo = B[B.index("as $$"):]
    for ruim in ["where status =", "where status not in", "and status = 'pending';",
                 "count(distinct entry_ref)"]:
        A_(ruim not in corpo, "referencia ainda ambigua: `" + ruim + "`")
test("nenhuma referencia ambigua sobrou", _ambiguidade_resolvida)

print("\n  %d passed, %d failed\n" % (ok, fail))
print("\u2717 EQUIVALENCIA REPROVADA" if fail else "\u2713 EQUIVALENCIA OK")
sys.exit(1 if fail else 0)
