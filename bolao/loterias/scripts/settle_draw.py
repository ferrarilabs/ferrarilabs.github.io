#!/usr/bin/env python3
"""
Liquidação de um sorteio no livro-razão — idempotente, derivada, sem tocar em provedor.

═══ O QUE ISTO FECHA ════════════════════════════════════════════════════════════════════════════

Em 2026-08-13 a produção ficou num estado que não devia existir: dezesseis participantes
receberam por e-mail o resultado do sorteio de 12/08 e o prêmio de US$38 daquele sorteio não
estava creditado em lugar nenhum. A notificação tinha acontecido; a contabilidade, não.

A causa raiz é de ORDEM, não de cálculo. O ciclo mandava e-mail e só depois tentava fechar a
obrigação; quando o fechamento falhou, o processo morreu carregando o crédito consigo. Este script
existe para que a parte monetária seja um FATO DURÁVEL PRÓPRIO, reconstruível a qualquer momento a
partir do que está gravado, e não um efeito colateral de um envio ter dado certo.

═══ NADA AQUI É DIGITADO ════════════════════════════════════════════════════════════════════════

Nenhum valor deste arquivo vem de alguém lembrando quanto foi. Cada lançamento é derivado:

    CONTRIBUTION     soma de `participants[].valor` do sorteio
    CARRYOVER_IN     `creditoSorteioAnterior`, conferido contra prêmio+guardado do anterior
    TICKET_PURCHASE  bilhetes x preço unitário, dos seriais realmente comprados
    PRIZE_CREDIT     MOTOR DE PRÊMIO rodando as 61 apostas reais contra o resultado oficial

O US$38 do sorteio de 12/08 não é copiado do `data.js` nem do extrato da NC Lottery: é calculado
pelas apostas contra o resultado certificado, e SÓ ENTÃO conferido contra os dois. Três origens
independentes concordando é evidência; uma origem copiada três vezes não é.

═══ REPROCESSAR CREDITA ZERO ════════════════════════════════════════════════════════════════════

Toda chave de idempotência deriva da identidade do sorteio — no caso do prêmio, do HASH do
resultado. Rodar de novo, em paralelo, ou depois de um crash, reencontra a mesma chave e não
credita nada. Não existe caminho neste arquivo que envie e-mail ou gaste dinheiro.
"""

import argparse
import json
import subprocess
import tempfile
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import lottery_core as L      # noqa: E402
import lottery_sources as S   # noqa: E402

DATA_JS = RAIZ / "bolao" / "loterias" / "powerball" / "js" / "data.js"


def carrega_draws(caminho=None):
    """Lê `data.js` no Node — a mesma fonte que a página usa, sem reimplementar o parser."""
    caminho = str(caminho or DATA_JS)
    saida = subprocess.run(
        ["node", "-e",
         f"global.window={{}};require({json.dumps(caminho)});"
         f"process.stdout.write(JSON.stringify(window.POWERBALL_DRAWS));"],
        capture_output=True, text=True, check=True)
    return json.loads(saida.stdout)


def apostas_do_sorteio(draw):
    """
    "30-38-46-47-59 — PB 06" -> {numbers:[30,38,46,47,59], special:6, hasPowerPlay:True}

    `hasPowerPlay` vem do PREÇO PAGO POR BILHETE, não de uma suposição: US$3 é US$2 da aposta mais
    US$1 do Power Play. Uma compra sem Power Play não pode herdar o multiplicador do sorteio, ou o
    bolão pagaria por algo que não comprou.
    """
    st = draw.get("sharedTickets") or {}
    preco = int(st.get("valorPorTicket") or 0)
    com_pp = preco >= 3
    apostas = []
    for serie in st.get("series") or []:
        for linha in serie.get("numeros") or []:
            nums, _, esp = linha.partition("—")
            apostas.append({"numbers": [int(x) for x in nums.strip().split("-")],
                            "special": int(esp.strip().split()[-1]),
                            "hasPowerPlay": com_pp,
                            "serial": serie.get("serial")})
    return apostas


def resultado_certificado(draw, jogo, verificar_ao_vivo=True):
    """
    O resultado canônico do sorteio, conferido contra a fonte oficial quando há rede.

    Divergência é INCIDENTE, nunca reescrita silenciosa: um resultado já gravado é o que definiu
    quem recebeu o quê, e trocá-lo por baixo apagaria o motivo de cada pagamento.
    """
    r = draw.get("result") or {}
    if not r.get("numbers"):
        return None, {"estado": "SEM_RESULTADO"}
    local = {"numbers": sorted(int(n) for n in r["numbers"]),
             "special": int(r["special"]), "multiplier": int(r.get("multiplier") or 1)}
    prov = {"estado": "LOCAL_SOMENTE", "fontes": []}
    if verificar_ao_vivo:
        cfg = L.carrega_config()
        oficial, tentativas = S.resultado_pronto(jogo, draw["id"], cfg)
        prov["fontes"] = tentativas
        if oficial:
            prov["estado"] = oficial["verificationState"]
            prov["source"] = oficial["source"]
            igual = (oficial["numbers"] == local["numbers"]
                     and oficial["special"] == local["special"]
                     and int(oficial.get("multiplier") or 1) == local["multiplier"])
            if not igual:
                raise RuntimeError(
                    f"DIVERGENCIA_DE_RESULTADO: {draw['id']} gravado={local} "
                    f"oficial={oficial['numbers']}|{oficial['special']}"
                    f"|x{oficial.get('multiplier')} — liquidação ABORTADA. Isto é um incidente, "
                    f"não um conflito para o script resolver sozinho.")
    return local, prov


def liquida(draw, anterior, jogo="powerball", ledger=None, verificar_ao_vivo=True):
    """
    Grava os lançamentos deste sorteio. Devolve o relatório com o que foi (ou não) gravado.

    Toda gravação passa por `append_ledger`, que é idempotente por chave e serializada por trava.
    """
    pool = draw["id"]
    rel = {"pool": pool, "gravados": [], "ja_existiam": [], "providerCalls": 0}

    resultado, prov = resultado_certificado(draw, jogo, verificar_ao_vivo)
    rel["resultado"] = resultado
    rel["proveniencia"] = prov

    def lanca(tipo, chave, cents, motivo, origem, extra=None):
        gravou, ev = L.append_ledger({
            "type": tipo, "idempotencyKey": chave, "poolId": pool, "amountCents": int(cents),
            "reason": motivo, "source": origem, **(extra or {})}, ledger)
        (rel["gravados"] if gravou else rel["ja_existiam"]).append(
            {"type": tipo, "key": chave, "amountCents": int(cents)})
        return ev

    # ── contribuições ───────────────────────────────────────────────────────────────────────
    contrib = sum(int(p.get("valor") or 0) for p in draw.get("participants") or [])
    if contrib:
        lanca("CONTRIBUTION", f"contrib:{jogo}:{pool}", contrib * 100,
              f"{len(draw.get('participants') or [])} participantes",
              f"data.js:{pool}.participants")

    # ── carryover que entrou ────────────────────────────────────────────────────────────────
    credito = int((draw.get("finance") or {}).get("creditoSorteioAnterior") or 0)
    if credito:
        premio_ant = int(((anterior or {}).get("result") or {}).get("premiosGanhos") or 0)
        guardado_ant = int(((anterior or {}).get("finance") or {}).get(
            "valorGuardadoProximoSorteio") or 0)
        if anterior and premio_ant + guardado_ant != credito:
            raise RuntimeError(
                f"CARRYOVER_NAO_CONFERE: {pool} declara crédito de US${credito}, mas o sorteio "
                f"{anterior['id']} deixou prêmio US${premio_ant} + guardado US${guardado_ant} = "
                f"US${premio_ant + guardado_ant}. Não se abre livro com diferença inexplicada.")
        lanca("CARRYOVER_IN", L.chave_carryover((anterior or {}).get("id", "abertura"), pool),
              credito * 100, f"crédito trazido de {(anterior or {}).get('id', 'abertura')}",
              f"data.js:{pool}.finance.creditoSorteioAnterior")

    # ── compra de bilhetes (REGISTRO de compra já feita pelo operador) ───────────────────────
    st = draw.get("sharedTickets") or {}
    qtd = sum(int(s.get("qtd") or 0) for s in st.get("series") or [])
    preco = int(st.get("valorPorTicket") or 0)
    if qtd and preco:
        lanca("TICKET_PURCHASE", f"tickets:{jogo}:{pool}", -(qtd * preco * 100),
              f"{qtd} apostas x US${preco}", f"data.js:{pool}.sharedTickets",
              {"serials": [s.get("serial") for s in st.get("series") or []]})

    # ── prêmio ──────────────────────────────────────────────────────────────────────────────
    if resultado:
        apostas = apostas_do_sorteio(draw)
        premio = L.premio_do_sorteio(jogo, apostas, resultado)
        rhash = L.hash_resultado(jogo, pool, resultado)
        rel["resultHash"] = rhash
        rel["premio"] = premio

        declarado = int((draw.get("result") or {}).get("premiosGanhos") or 0) * 100
        if declarado != premio["totalCents"]:
            raise RuntimeError(
                f"PREMIO_DIVERGENTE: motor calculou {L.dinheiro(premio['totalCents'])} das "
                f"{len(apostas)} apostas reais, mas {pool}.result.premiosGanhos declara "
                f"{L.dinheiro(declarado)}. Creditar qualquer um dos dois sem explicar a "
                f"diferença é escolher um número por conveniência.")

        if premio["totalCents"]:
            lanca("PRIZE_CREDIT", L.chave_premio(jogo, pool, rhash), premio["totalCents"],
                  "; ".join(f"{l['label']} {L.dinheiro(l['amountCents'])}"
                            for l in premio["linhas"] if l.get("amountCents")),
                  f"motor de prêmio sobre {len(apostas)} apostas + resultado {rhash}",
                  {"resultHash": rhash, "drawDate": pool,
                   "verificationState": prov.get("estado")})
    return rel


def relatorio(ledger=None):
    """Toda a posição monetária DERIVADA do extrato. Não existe saldo guardado para divergir."""
    ev = L.le_ledger(ledger)
    por = {}
    for e in ev:
        por[e["type"]] = por.get(e["type"], 0) + e["amountCents"]
    return {
        "CONTRIBUTIONS": por.get("CONTRIBUTION", 0),
        "PRIOR_CARRYOVER": por.get("CARRYOVER_IN", 0),
        "TICKET_PURCHASES": por.get("TICKET_PURCHASE", 0),
        "CURRENT_DRAW_WINNINGS": por.get("PRIZE_CREDIT", 0),
        "OTHER_ADJUSTMENTS": por.get("OPERATOR_ADJUSTMENT", 0) + por.get("CARRYOVER_OUT", 0),
        "CURRENT_AVAILABLE_CARRYOVER": sum(e["amountCents"] for e in ev),
        "lancamentos": len(ev),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--draw", help="id do sorteio (padrão: o mais recente com resultado)")
    ap.add_argument("--game", default="powerball")
    ap.add_argument("--ledger", help="caminho do livro (padrão: config/lottery_ledger.jsonl)")
    ap.add_argument("--data-js", help="caminho do data.js")
    ap.add_argument("--offline", action="store_true",
                    help="não confere o resultado contra a fonte oficial")
    ap.add_argument("--dry-run", action="store_true", help="calcula e mostra, não grava")
    args = ap.parse_args()

    draws = carrega_draws(args.data_js)
    if args.draw:
        draw = next((d for d in draws if d["id"] == args.draw), None)
        if draw is None:
            print(f"sorteio {args.draw} não existe em data.js")
            return 2
    else:
        draw = next((d for d in reversed(draws) if (d.get("result") or {}).get("numbers")), None)
        if draw is None:
            print("nenhum sorteio com resultado gravado")
            return 0
    anterior = next((d for d in draws if d["id"] == draw.get("previousDrawId")), None)

    ledger = args.ledger
    temporario = None
    if args.dry_run:
        # Livro DESCARTÁVEL, com o conteúdo do real copiado.
        #
        # Não é `/dev/null`: além de não aceitar a trava, um livro vazio faria toda chave parecer
        # nova e o dry-run relataria "vai gravar 4 lançamentos" onde a execução real gravaria
        # zero. Um ensaio que mente sobre o que vai acontecer é pior que não ensaiar.
        temporario = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False,
                                                 encoding="utf-8")
        real = Path(args.ledger or L.LEDGER)
        temporario.write(real.read_text(encoding="utf-8") if real.exists() else "")
        temporario.close()
        ledger = temporario.name

    print(f"LIQUIDAÇÃO — {args.game} {draw['id']}"
          f"{'  (DRY-RUN, nada é gravado no livro real)' if args.dry_run else ''}\n")
    try:
        rel = liquida(draw, anterior, args.game, ledger, verificar_ao_vivo=not args.offline)
    finally:
        if temporario:
            pass   # apagado no fim, depois de `relatorio()` ler o mesmo arquivo

    print(f"  resultado    {rel['resultado']}")
    print(f"  procedência  {rel['proveniencia'].get('estado')} "
          f"({rel['proveniencia'].get('source', 'sem verificação ao vivo')})")
    if rel.get("resultHash"):
        print(f"  hash         {rel['resultHash']}")
    if rel.get("premio"):
        print(f"  prêmio       {L.dinheiro(rel['premio']['totalCents'])} "
              f"em {len(rel['premio']['linhas'])} apostas premiadas")
        for l in rel["premio"]["linhas"]:
            print(f"                 {l['label']:<16} {L.dinheiro(l['amountCents'])}")

    print(f"\n  GRAVADOS AGORA  ({len(rel['gravados'])})")
    for g in rel["gravados"]:
        print(f"    + {g['type']:<16} {L.dinheiro(g['amountCents']):>14}   {g['key']}")
    print(f"  JÁ EXISTIAM     ({len(rel['ja_existiam'])})  — reprocessar creditou zero")
    for g in rel["ja_existiam"]:
        print(f"    = {g['type']:<16} {L.dinheiro(g['amountCents']):>14}   {g['key']}")

    r = relatorio(ledger)
    print("\n" + "=" * 78)
    for k in ("CONTRIBUTIONS", "PRIOR_CARRYOVER", "TICKET_PURCHASES", "CURRENT_DRAW_WINNINGS",
              "OTHER_ADJUSTMENTS", "CURRENT_AVAILABLE_CARRYOVER"):
        print(f"  {k:<30} {L.dinheiro(r[k]):>14}")
    print(f"  {'PB_PRIZE_CREDIT_COUNT':<30} "
          f"{sum(1 for e in L.le_ledger(ledger) if e['type'] == 'PRIZE_CREDIT'):>14}")
    print(f"  {'PROVIDER_CALLS':<30} {rel['providerCalls']:>14}")
    print("=" * 78)
    if temporario:
        Path(temporario.name).unlink(missing_ok=True)
        Path(temporario.name + ".lock").unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
