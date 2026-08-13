#!/usr/bin/env python3
"""
Conciliação de abertura do livro-razão — a partir do que está gravado, sem arbitrar nada.

═══ POR QUE NÃO REPRODUZO A HISTÓRIA INTEIRA ════════════════════════════════════════════════════

Os cinco sorteios de `data.js` não formam uma cadeia somável. No sorteio 2026-08-03, catorze
participantes pagaram US$20 cada (US$280) cobrindo DOIS sorteios; `valorGuardadoProximoSorteio`
ficou US$142 e, no sorteio seguinte, esse mesmo dinheiro reaparece dentro de `totalArrecadado`
(US$148). Somar os dois campos contaria a mesma nota duas vezes.

Isso não é defeito do registro — o registro é por sorteio e o comentário de cada `finance` explica
o que fez. É uma propriedade do modelo antigo que impede replay ingênuo.

Então a abertura é o SORTEIO CORRENTE, com cada parcela conferida contra sua origem primária:

    contribuições   soma de `participants[].valor`      confere com `totalArrecadado`
    crédito anterior `premiosGanhos` + guardado anterior confere com `creditoSorteioAnterior`
    gasto           tickets x preço unitário            confere com `valorUtilizado`
    guardado        contribuições + crédito - gasto     confere com `valorGuardadoProximoSorteio`

Nenhum número é digitado aqui. Se qualquer identidade não fechar, a conciliação FALHA e o livro
não abre — a UI continua no modelo antigo até alguém explicar a diferença.
"""

import json
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import lottery_core as L  # noqa: E402

DATA_JS = RAIZ / "bolao" / "loterias" / "powerball" / "js" / "data.js"

falhas = []


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


def carrega_draws():
    """Lê `data.js` executando-o no Node — a mesma fonte que a página usa, sem reimplementar."""
    saida = subprocess.run(
        ["node", "-e",
         f"global.window={{}};require({json.dumps(str(DATA_JS))});"
         f"process.stdout.write(JSON.stringify(window.POWERBALL_DRAWS));"],
        capture_output=True, text=True, check=True)
    return json.loads(saida.stdout)


def main():
    print("CONCILIAÇÃO DE ABERTURA — Powerball\n")
    draws = carrega_draws()
    atual = draws[-1]
    anterior = next((d for d in draws if d["id"] == atual.get("previousDrawId")), None)

    print(f"  sorteio corrente = {atual['id']} ({atual.get('gameType')}), "
          f"status={atual.get('status')}, resultado={'sim' if atual.get('result') else 'PENDENTE'}")
    if anterior:
        print(f"  sorteio anterior = {anterior['id']}")

    fin = atual.get("finance") or {}

    # ── contribuições ───────────────────────────────────────────────────────────────────────
    contrib = sum(int(p.get("valor") or 0) for p in atual.get("participants") or [])
    checa("contribuições conferem com totalArrecadado",
          contrib == int(fin.get("totalArrecadado", -1)),
          f"soma dos participantes={contrib} vs totalArrecadado={fin.get('totalArrecadado')}")

    # ── crédito do sorteio anterior ─────────────────────────────────────────────────────────
    premio_ant = int(((anterior or {}).get("result") or {}).get("premiosGanhos") or 0)
    guardado_ant = int(((anterior or {}).get("finance") or {}).get(
        "valorGuardadoProximoSorteio") or 0)
    checa("crédito anterior = prêmio confirmado + guardado do anterior",
          premio_ant + guardado_ant == int(fin.get("creditoSorteioAnterior", -1)),
          f"{premio_ant} + {guardado_ant} = {premio_ant + guardado_ant} vs "
          f"creditoSorteioAnterior={fin.get('creditoSorteioAnterior')}")

    # ── gasto em bilhetes ───────────────────────────────────────────────────────────────────
    st = atual.get("sharedTickets") or {}
    qtd = sum(int(s.get("qtd") or 0) for s in st.get("series") or [])
    preco = int(st.get("valorPorTicket") or 0)
    checa("gasto confere com valorUtilizado",
          qtd * preco == int(fin.get("valorUtilizado", -1)),
          f"{qtd} bilhetes x US${preco} = {qtd * preco} vs valorUtilizado={fin.get('valorUtilizado')}")

    # ── identidade do caixa ─────────────────────────────────────────────────────────────────
    disponivel = contrib + int(fin.get("creditoSorteioAnterior") or 0)
    guardado = disponivel - int(fin.get("valorUtilizado") or 0)
    checa("guardado = disponível - gasto",
          guardado == int(fin.get("valorGuardadoProximoSorteio", -1)),
          f"{disponivel} - {fin.get('valorUtilizado')} = {guardado} vs "
          f"valorGuardadoProximoSorteio={fin.get('valorGuardadoProximoSorteio')}")
    checa("nenhum ajuste pendente", int(fin.get("ajustesPendentes") or 0) == 0)

    print(f"\n  PRIOR_RESERVED_BALANCE = {L.dinheiro(guardado_ant * 100)}"
          f"   (guardado do sorteio {anterior['id'] if anterior else '?'})")
    print(f"  LAST_DRAW_WINNINGS     = {L.dinheiro(premio_ant * 100)}"
          f"   (premiosGanhos oficial do anterior)")
    print(f"  CONTRIBUTIONS          = {L.dinheiro(contrib * 100)}  "
          f"({len(atual.get('participants') or [])} participantes)")
    print(f"  TICKET_SPEND           = {L.dinheiro(qtd * preco * 100)}  ({qtd} bilhetes)")
    print(f"  CURRENT_CARRYOVER      = {L.dinheiro(guardado * 100)}")

    if atual.get("result") is None:
        print(f"\n  ATENÇÃO: o sorteio {atual['id']} ainda NÃO tem resultado gravado. "
              f"O prêmio dele ainda não entrou em lugar nenhum — a abertura reflete o caixa "
              f"ANTES do resultado, que é o estado real de agora.")

    print("\n" + "=" * 78)
    if falhas:
        print(f"OPENING_LEDGER_RECONCILIATION = FALHOU ({len(falhas)}): {falhas}")
        return 1
    print("OPENING_LEDGER_RECONCILIATION = PASS")
    print(f"  abertura proposta: CARRYOVER_IN de {L.dinheiro(guardado * 100)} "
          f"no pool {atual['id']}, procedência = data.js:{atual['id']}.finance")
    return 0


if __name__ == "__main__":
    sys.exit(main())
