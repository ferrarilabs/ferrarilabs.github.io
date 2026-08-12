#!/usr/bin/env python3
"""CDB2026 — "a fonte nao respondeu nada" nao pode virar "a CBF nao publicou".

O DEFEITO QUE ISTO FECHA (2026-08-12)
------------------------------------
A CBF publicou a tabela completa das quartas. O reconciliador continuou dizendo
`WAITING_FOR_OFFICIAL_SCHEDULE` -- e o vigia continuou VERDE, porque essa espera e um estado de
negocio legitimo. Ninguem tinha por que desconfiar.

Duas causas independentes, e as duas silenciosas:

  1. JANELA. O scoreboard da ESPN devolve LISTA VAZIA, sem erro e sem aviso, quando o intervalo
     `dates=` e largo demais. Medido no mesmo minuto:

         7d -> 0    14d -> 3    21d -> 7    30d -> 8    45d -> 8    60d -> 8    90d -> 0

     O reconciliador pedia 90 dias. Recebia zero. Concluia "nao publicaram" a partir de uma
     resposta que nao dizia isso.

  2. APELIDO. A ESPN publica "Vasco da Gama"; o sorteio oficial registrou "Vasco". Tres dos
     quatro confrontos casavam. Como publicacao PARCIAL e recusada de proposito -- e a recusa
     esta certa, o prazo e o menor kickoff de TODOS --, um unico nome divergente segurava a
     tabela inteira.

Juntas, produziram o pior tipo de falha: tudo verde, nada errado aparente, e a abertura dos
palpites de doze pessoas parada por dias.

HERMETICO: sem rede. Os eventos sao injetados.

Uso: python3 bolao/cdb2026/scripts/test_schedule_reconciler.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")

# Compila o TEXTO ate `def main(` -- carregar o modulo inteiro executaria o CLI. E compilar o
# texto (em vez de importar) evita o cache de bytecode do macOS, que vive fora do repo e invalida
# por (mtime, tamanho): mutacao de 1 char por 1 char pode servir bytecode velho.
_FONTE = (AQUI / "reconcile_official_schedule.py").read_text()
R = {"__name__": "naomain", "__file__": str(AQUI / "reconcile_official_schedule.py")}
exec(compile(_FONTE.split("def main(")[0], R["__file__"], "exec"), R)

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
    except Exception as e:
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}")
        fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


def evento(casa, fora, data="2026-08-26T00:00Z"):
    return {"date": data, "competitions": [{"competitors": [
        {"team": {"displayName": casa}}, {"team": {"displayName": fora}}]}]}


PARES = {
    ("atletico-mg", "cruzeiro"): "t1",
    ("vasco", "vitoria"): "t2",
    ("palmeiras", "santos"): "t3",
    ("gremio", "internacional"): "t4",
}

print("\nCDB2026 — reconciliador da tabela oficial\n")

# ── 1. JANELA ───────────────────────────────────────────────────────────────────────────────
hoje = datetime.now(timezone.utc)

test("janela ALEM do limite caracterizado e RECUSADA com erro explicito", lambda: (
    lambda r: (
        _assert(r[0] is None, "devolveu eventos para uma janela que a fonte esvazia em silencio"),
        _assert("JANELA_LARGA_DEMAIS" in (r[1] or ""),
                f"o erro nao identifica a causa: {r[1]}"),
    ))(R["busca_tabela"](hoje, hoje + timedelta(days=R["JANELA_MAX_DIAS"] + 1))))

test("o limite fica DENTRO da faixa que a fonte atende", lambda: _assert(
    R["JANELA_MAX_DIAS"] <= 60,
    f"JANELA_MAX_DIAS={R['JANELA_MAX_DIAS']} — medido em 2026-08-12, 90d devolve 0 eventos com a "
    "tabela publicada. Passar de 60 volta a zona de silencio"))

test("o limite cobre ida E volta de um mata-mata", lambda: _assert(
    R["JANELA_MAX_DIAS"] >= 21,
    f"JANELA_MAX_DIAS={R['JANELA_MAX_DIAS']} — as quartas de 2026 vao de 25/08 a 03/09; janela "
    "curta demais acha a ida e perde a volta"))

# ── 2. APELIDO ──────────────────────────────────────────────────────────────────────────────
test("'Vasco da Gama' da fonte casa com 'Vasco' do sorteio", lambda: _assert(
    R["casa_confronto"](evento("Vasco da Gama", "Vitória"), PARES)[0] == "t2",
    "o apelido sumiu — tres de quatro confrontos casariam e a tabela inteira ficaria parada, "
    "porque publicacao parcial e recusada"))

test("o apelido vale nos dois mandos", lambda: _assert(
    R["casa_confronto"](evento("Vitória", "Vasco da Gama"), PARES)[0] == "t2",
    "so casou num sentido — a volta inverte o mando"))

test("nomes que ja batem seguem batendo", lambda: _assert(
    R["casa_confronto"](evento("Cruzeiro", "Atlético-MG"), PARES)[0] == "t1",
    "o apelido quebrou o casamento normal"))

# ── 3. O QUE NAO PODE PASSAR ────────────────────────────────────────────────────────────────
test("confronto que NAO existe no sorteio e ignorado", lambda: _assert(
    R["casa_confronto"](evento("Flamengo", "Corinthians"), PARES)[0] is None,
    "aceitou um par que o sorteio oficial nao definiu — chaveamento novo nao entra por aqui"))

test("evento com um time so e ignorado", lambda: _assert(
    R["casa_confronto"]({"date": "x", "competitions": [{"competitors": [
        {"team": {"displayName": "Vasco da Gama"}}]}]}, PARES)[0] is None,
    "aceitou evento malformado"))

test("apelido NAO reescreve o nome do sorteio (a autoridade e o documento oficial)", lambda: _assert(
    all(v == v.lower() and " " not in v for v in R["ESPN_APELIDOS"].values())
    and "vasco" in R["ESPN_APELIDOS"].values(),
    "o mapa de apelidos aponta para o lado errado: ele traduz a FONTE para o SORTEIO, nunca o "
    "contrario — o documento oficial e quem manda no nome do clube"))

print(f"\n  {ok} passed, {fail} failed\n")
print("✓ SCHEDULE RECONCILER PASSED\n" if fail == 0 else "✗ SCHEDULE RECONCILER FAILED\n")
sys.exit(0 if fail == 0 else 1)
