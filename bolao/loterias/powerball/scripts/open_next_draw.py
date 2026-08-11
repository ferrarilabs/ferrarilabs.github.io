#!/usr/bin/env python3
"""Abre o PROXIMO sorteio do bolao do Powerball.

POR QUE EXISTE
--------------
Abrir sorteio era operacao manual: editar `js/data.js` a mao. Isso acoplou duas coisas que nao
tem relacao nenhuma -- ABRIR o bolao e TER os bilhetes. Na pratica o bolao so passava a existir
quando o Eduardo ja tinha comprado os jogos, entao entre um sorteio e outro nao havia pool aberto
para as pessoas entrarem, e a coleta de participantes competia com o relogio do sorteio.

O modelo real e PROGRESSIVO:

    abre o sorteio  ->  participantes entram  ->  pagamentos confirmam  ->  bilhetes sao
    comprados  ->  numeros sao lancados  ->  sorteio acontece  ->  resultado + e-mail

Zero participantes e um estado VALIDO. Zero bilhetes e um estado VALIDO. O sorteio e o mesmo
objeto do inicio ao fim -- nada aqui recria nada.

O QUE ESTE SCRIPT NUNCA FAZ
---------------------------
Nao inventa participante, e-mail, pagamento, txId, numero de bilhete nem resultado. Esses sao
fatos de negocio; so o Eduardo os tem. O script cria o sorteio VAZIO e correto, e as ferramentas
incrementais preenchem depois.

Uso:
    python3 open_next_draw.py --dry-run     # mostra o diff, nao grava
    python3 open_next_draw.py --apply       # grava
    python3 open_next_draw.py --apply --jackpot 950000000 --cash 410000000
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(AQUI, "..", "js", "data.js")

# Powerball sorteia segunda (0), quarta (2) e sabado (5), 22:59 ET.
DIAS_DE_SORTEIO = (0, 2, 5)
HORA_SORTEIO = "22:59:00-04:00"


def proximo_dia_de_sorteio(depois_de):
    """Primeira data de sorteio ESTRITAMENTE depois de `depois_de`.

    Derivada do calendario real do jogo, nunca de "hoje + 2". Entre um sabado e a segunda ha 2
    dias; entre segunda e quarta, 2; entre quarta e sabado, 3. Somar um intervalo fixo erraria em
    um terco dos casos.
    """
    d = depois_de + timedelta(days=1)
    while d.weekday() not in DIAS_DE_SORTEIO:
        d += timedelta(days=1)
    return d


def carrega_draws():
    leitor = (
        "const fs=require('fs'),vm=require('vm');const sb={window:{}};vm.createContext(sb);"
        "vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),sb);"
        "process.stdout.write(JSON.stringify(sb.window.POWERBALL_DRAWS||[]));"
    )
    out = subprocess.run(["node", "-e", leitor, DATA_JS], capture_output=True, text=True, timeout=20)
    if out.returncode != 0:
        raise RuntimeError(f"nao consegui ler data.js: {out.stderr.strip()[:300]}")
    return json.loads(out.stdout)


def bloco_do_sorteio(draw_id, anterior_id, credito, jackpot, cash):
    """Texto do novo sorteio, no MESMO estilo do arquivo (JS, chaves sem aspas)."""
    dt = date.fromisoformat(draw_id)
    label = f"{dt.strftime('%d/%m/%Y')} 22:59 ET"
    agora = datetime.now().astimezone().replace(microsecond=0).isoformat()
    jackpot_txt = str(jackpot) if jackpot is not None else "null"
    cash_txt = str(cash) if cash is not None else "null"
    return f"""  {{
    id: "{draw_id}",
    gameType: "powerball",
    status: "planejamento",
    createdAt: "{agora}",
    previousDrawId: "{anterior_id}",

    drawing: {{
      name: "Powerball Jackpot",
      // jackpot/cashValue sao publicados pela loteria; ficam null ate serem informados.
      jackpot: {jackpot_txt},
      cashValue: {cash_txt},
      drawDateIso: "{draw_id}T{HORA_SORTEIO}",
      drawDateLabel: "{label}"
    }},

    // BOLAO ABERTO, ainda sem ninguem. Estado valido: participantes entram progressivamente.
    participants: [],

    // Sem bilhetes ainda. Os numeros entram depois da compra -- abrir o bolao nunca dependeu
    // de ja existirem jogos.
    sharedTickets: {{
      compradoPor: null,
      dataComprovante: null,
      valorPorTicket: 3,
      series: []
    }},

    finance: {{
      totalArrecadado: 0,
      // Premio do sorteio anterior + o que ficou guardado. Derivado do que esta gravado, nao
      // arbitrado aqui.
      creditoSorteioAnterior: {credito},
      valorUtilizado: 0,
      valorGuardadoProximoSorteio: 0,
      ajustesPendentes: 0
    }},

    result: null,
    profit: null
  }}"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--jackpot", type=int, default=None)
    p.add_argument("--cash", type=int, default=None)
    p.add_argument("--draw", default=None, help="forca uma data (YYYY-MM-DD); por padrao e derivada")
    a = p.parse_args()
    if not (a.dry_run or a.apply):
        p.error("escolha --dry-run ou --apply")

    draws = carrega_draws()
    if not draws:
        print("🛑 data.js nao tem sorteio nenhum — nao da para derivar o proximo.")
        return 2

    ultimo = draws[-1]
    alvo = a.draw or proximo_dia_de_sorteio(date.fromisoformat(ultimo["id"])).isoformat()

    print("=" * 68)
    print("  POWERBALL — ABERTURA DO PROXIMO SORTEIO")
    print("=" * 68)
    print(f"  ultimo sorteio no data.js   {ultimo['id']}  "
          f"(resultado: {'sim' if (ultimo.get('result') or {}).get('numbers') else 'nao'})")
    print(f"  proximo sorteio derivado    {alvo}  "
          f"({date.fromisoformat(alvo).strftime('%A')})")

    # ── IDEMPOTENCIA ───────────────────────────────────────────────────────────────────────
    ja = next((d for d in draws if d["id"] == alvo), None)
    if ja:
        print(f"\n  ALREADY_OPEN — {alvo} ja existe no data.js.")
        print(f"    participantes  {len(ja.get('participants') or [])}")
        print(f"    series         {len((ja.get('sharedTickets') or {}).get('series') or [])}")
        print(f"    resultado      {'SIM' if (ja.get('result') or {}).get('numbers') else 'nao'}")
        print("    Nada foi alterado. Participantes, pagamentos e bilhetes preservados.")
        print("=" * 68)
        return 0

    # O sorteio anterior tem de estar RESOLVIDO antes de abrir o proximo: abrir por cima de um
    # sorteio sem resultado esconderia o pendente da pagina inicial, que mostra o ultimo da lista.
    if not (ultimo.get("result") or {}).get("numbers"):
        print(f"\n  🛑 BLOQUEADO: {ultimo['id']} ainda nao tem resultado gravado.")
        print("     Abrir o proximo agora tiraria o sorteio pendente da tela inicial.")
        print("=" * 68)
        return 1

    fin = ultimo.get("finance") or {}
    credito = int((ultimo.get("result") or {}).get("premiosGanhos") or 0) + \
        int(fin.get("valorGuardadoProximoSorteio") or 0)

    print(f"\n  credito do anterior         {credito}  "
          f"(premios {(ultimo.get('result') or {}).get('premiosGanhos')} + "
          f"guardado {fin.get('valorGuardadoProximoSorteio')})")
    print(f"  participantes               0   (valido: entram progressivamente)")
    print(f"  bilhetes                    0   (valido: comprados depois)")
    print(f"  resultado                   null")
    print(f"  jackpot                     {a.jackpot if a.jackpot is not None else 'null (a informar)'}")

    bloco = bloco_do_sorteio(alvo, ultimo["id"], credito, a.jackpot, a.cash)

    fonte = open(DATA_JS, encoding="utf-8").read()
    # Fecha o array de sorteios. Ancora no fim do ARRAY, nao no fim do arquivo: depois dele ainda
    # vem a atribuicao de POWERBALL_DATA.
    m = re.search(r"\n\];\s*\n", fonte)
    if not m:
        print("\n  🛑 nao encontrei o fim de POWERBALL_DRAWS — recusando editar as cegas.")
        return 2

    novo = fonte[:m.start()] + ",\n\n" + bloco + fonte[m.start():]

    if a.dry_run:
        print("\n  DRY RUN — nada gravado. Bloco que seria inserido:\n")
        for linha in bloco.split("\n"):
            print("    " + linha)
        print("\n" + "=" * 68)
        return 0

    open(DATA_JS, "w", encoding="utf-8").write(novo)

    # Reler pelo Node: se o arquivo nao for JS valido, e melhor descobrir agora.
    depois = carrega_draws()
    criado = next((d for d in depois if d["id"] == alvo), None)
    if not criado:
        print("\n  🛑 gravei mas nao consigo reler o sorteio — revertendo.")
        open(DATA_JS, "w", encoding="utf-8").write(fonte)
        return 2

    problemas = []
    if criado.get("result") is not None:
        problemas.append("resultado nao e null")
    if (criado.get("sharedTickets") or {}).get("series"):
        problemas.append("herdou bilhetes")
    if criado.get("participants"):
        problemas.append("herdou participantes")
    if criado.get("previousDrawId") != ultimo["id"]:
        problemas.append("previousDrawId errado")
    if len(depois) != len(draws) + 1:
        problemas.append("numero de sorteios inesperado")
    # O sorteio anterior nao pode ter sido tocado.
    anterior_depois = next(d for d in depois if d["id"] == ultimo["id"])
    if json.dumps(anterior_depois, sort_keys=True) != json.dumps(ultimo, sort_keys=True):
        problemas.append("o sorteio anterior foi alterado")

    if problemas:
        print(f"\n  🛑 invariantes violadas: {problemas} — revertendo.")
        open(DATA_JS, "w", encoding="utf-8").write(fonte)
        return 2

    print(f"\n  ✓ ABERTO: {alvo}")
    print(f"    total de sorteios agora   {len(depois)}")
    print(f"    sorteio anterior          intacto")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    sys.exit(main())
