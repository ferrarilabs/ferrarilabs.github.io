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

Generalizado (Issue #428) para tambem cobrir a materializacao de DATA (nao de time -- isso
continua manual, #410/#411) de semifinal/final: secao 4 cobre o portao `fase_esta_pronta()` que
decide se uma fase (draw-based ou derivada) tem confrontos casaveis contra uma fonte de verdade.

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
    R["JANELA_MAX_DIAS"] <= 85,
    f"JANELA_MAX_DIAS={R['JANELA_MAX_DIAS']} — remedido em 2026-09-10 (semifinal ja publicada): "
    "45-85d consistentemente OK, 88-91d ja mostrou UMA resposta vazia (90d) no meio de vizinhos "
    "nao-vazios -- nao ha teto seguro conhecido acima de 85d"))

test("o limite cobre ida E volta de um mata-mata (quartas E semifinal)", lambda: _assert(
    R["JANELA_MAX_DIAS"] >= 60,
    f"JANELA_MAX_DIAS={R['JANELA_MAX_DIAS']} — a semifinal de 2026 publicou ida 01/11 e volta "
    "08/11; medido em 2026-09-10 (~52d de hoje ate a ida), 60d ja foi o primeiro valor a trazer as "
    "DUAS pernas das DUAS chaves (4 eventos) -- janela curta demais acha a ida e perde a volta, ou "
    "nao acha nada, como aconteceu de verdade com 45d nesta materializacao"))

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

# ── 4. FASE (Issue #428: generalizacao para semifinal/final) ──────────────────────────────────
# quartas: precisa de sorteio validado. Fase derivada: `ties` so existe apos materialize-derived-
# phase (#410) ja ter exigido topologia autoritativa -- entao a PROPRIA existencia de `ties` e a
# prova, sem precisar (nem poder) checar um officialDraw que fase derivada nunca tem.

test("quartas SEM sorteio validado nao esta pronta, mesmo com confrontos gravados", lambda: _assert(
    R["fase_esta_pronta"]({"t1": {}}, {"validatedAt": None}, False) is False,
    "quartas tem de esperar o sorteio ser validado -- confrontos sozinhos nao bastam"))

test("quartas COM sorteio validado esta pronta", lambda: _assert(
    R["fase_esta_pronta"]({"t1": {}}, {"validatedAt": "2026-08-11T00:00Z"}, False) is True,
    "sorteio validado + confrontos gravados e o suficiente para quartas"))

test("quartas sem NENHUM confronto nao esta pronta mesmo com sorteio validado", lambda: _assert(
    R["fase_esta_pronta"]({}, {"validatedAt": "2026-08-11T00:00Z"}, False) is False,
    "sem `ties` nao ha o que casar contra a fonte, sorteio validado ou nao"))

test("fase derivada COM confrontos esta pronta SEM officialDraw (nao existe para fase derivada)", lambda: _assert(
    R["fase_esta_pronta"]({"semifinal-1": {}, "semifinal-2": {}}, {}, True) is True,
    "materialize-derived-phase ja exigiu topologia autoritativa antes de gravar `ties` -- exigir "
    "tambem um officialDraw (que fase derivada nunca tem) travaria a fase para sempre"))

test("fase derivada SEM confrontos materializados nao esta pronta", lambda: _assert(
    R["fase_esta_pronta"]({}, {}, True) is False,
    "sem `ties` a fase derivada ainda nao foi materializada (materialize-derived-phase e "
    "operacao MANUAL e separada, #410/#411) -- este script nunca materializa time, so data"))

test("--phase aceita quartas/semifinal/final e nada mais", lambda: (
    lambda: (
        _assert(set(R["FASES_VALIDAS"]) == {"quartas", "semifinal", "final"},
                f"FASES_VALIDAS mudou: {R['FASES_VALIDAS']}"),
        _assert(R["FASES_DERIVADAS"] == {"semifinal": "quartas", "final": "semifinal"},
                "mapa de fase derivada diverge do mesmo mapa em operator_cli.py -- os dois "
                "precisam concordar em qual fase deriva de qual"),
    ))())

print(f"\n  {ok} passed, {fail} failed\n")
print("✓ SCHEDULE RECONCILER PASSED\n" if fail == 0 else "✗ SCHEDULE RECONCILER FAILED\n")
sys.exit(0 if fail == 0 else 1)
