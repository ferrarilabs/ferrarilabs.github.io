#!/usr/bin/env python3
"""Atualiza o jackpot do sorteio ABERTO a partir da fonte oficial.

POR QUE EXISTE
--------------
Um sorteio recem-aberto nao tem premio: a loteria so anuncia o proximo jackpot depois do sorteio
anterior. Como o bolao abre ANTES disso, a pagina publica ficava mostrando "a anunciar" -- o que e
honesto no minuto zero e vira DEFEITO assim que o valor oficial existe e ninguem o copiou.

Editar isso a mao acopla o produto ao operador estar acordado. Este script fecha o ciclo.

IDENTIDADE ANTES DE TUDO
------------------------
A fonte publica "Next Drawing" com UMA data. Se essa data nao for exatamente a do sorteio aberto
no data.js, o script RECUSA. Copiar "o jackpot mais recente" para o sorteio errado e a mesma
classe de erro que, do lado do resultado, mandou os numeros do sorteio anterior para 15 pessoas.

NUNCA inventa valor. Sem dado oficial legivel, sai sem tocar em nada.

Uso:
    python3 refresh_jackpot.py --dry-run
    python3 refresh_jackpot.py --apply
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(AQUI, "..", "js", "data.js")

FONTE_URL = "https://www.powerball.com/"
FONTE_ID = "powerball_official"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")

MESES = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def _texto(html):
    t = re.sub(r"<[^>]+>", "|", html)
    t = re.sub(r"\s+", " ", t)
    return re.sub(r"\|+", "|", t)


def _milhoes(txt):
    """'$975 Million' -> 975000000 ; '$1.2 Billion' -> 1200000000."""
    m = re.search(r"\$([0-9]+(?:\.[0-9]+)?)\s*(Million|Billion)", txt, re.I)
    if not m:
        return None
    v = float(m.group(1))
    return int(round(v * (1_000_000_000 if m.group(2).lower() == "billion" else 1_000_000)))


def busca_proximo_sorteio():
    """(draw_id, jackpot, cash, erro). Le a seção 'Next Drawing' da fonte oficial."""
    # COMPRESSAO: a fonte responde `Content-Encoding: br` (brotli) MESMO pedindo `identity` ou
    # `gzip, deflate`. O Python 3.11 da biblioteca padrao nao descomprime brotli, e o urllib nao
    # descomprime nada sozinho -- entao o HTML chegava como bytes binarios, nenhuma secao era
    # encontrada, e o script dizia UPSTREAM_NOT_READY. Indistinguivel da fonte estar fora do ar,
    # que e o pior tipo de erro: silencioso e com diagnostico errado.
    #
    # O `curl --compressed` resolve gzip/deflate/br e existe tanto no macOS quanto no runner
    # ubuntu. E a dependencia mais barata disponivel; um pacote brotli novo so para isto seria
    # mais superficie por nenhum ganho.
    html = None
    try:
        out = subprocess.run(
            ["curl", "-sS", "--compressed", "--max-time", "25", "-A", UA, FONTE_URL],
            capture_output=True, text=True, timeout=30)
        if out.returncode == 0 and out.stdout:
            html = out.stdout
    except Exception:
        html = None

    if html is None:                      # fallback: urllib com o que a stdlib sabe abrir
        req = urllib.request.Request(FONTE_URL, headers={
            "User-Agent": UA, "Accept-Encoding": "gzip, deflate"})
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                bruto = r.read()
                enc = (r.headers.get("Content-Encoding") or "").lower()
            if "gzip" in enc:
                import gzip
                bruto = gzip.decompress(bruto)
            elif "deflate" in enc:
                import zlib
                bruto = zlib.decompress(bruto, -zlib.MAX_WBITS)
            elif enc:
                return None, None, None, f"CODIFICACAO_NAO_SUPORTADA: {enc}"
            html = bruto.decode("utf-8", "ignore")
        except Exception as e:
            return None, None, None, f"FONTE_INDISPONIVEL: {type(e).__name__}"

    t = _texto(html)
    i = t.find("Next Drawing")
    if i < 0:
        return None, None, None, "SECAO_NEXT_DRAWING_AUSENTE"

    # A partir de "Next Drawing" e ate "Winners" fica o cartao do PROXIMO sorteio. Limitar a
    # janela e o que impede pegar o jackpot de outro bloco da pagina.
    fim = t.find("Winners", i)
    bloco = t[i:fim if fim > i else i + 1500]

    md = re.search(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})", bloco)
    if not md:
        return None, None, None, "DATA_DO_PROXIMO_SORTEIO_ILEGIVEL"
    mes = MESES.get(md.group(2))
    if not mes:
        return None, None, None, f"MES_DESCONHECIDO: {md.group(2)}"
    draw_id = f"{md.group(4)}-{mes:02d}-{int(md.group(3)):02d}"

    # `[\s|]*` e nao `\|\s*`: o texto achatado vem como "Estimated Jackpot | |$975 Million",
    # com pipes E espacos entre o rotulo e o valor. Exigir exatamente um pipe fazia o valor
    # oficial ser ilegivel e o script reportar UPSTREAM_NOT_READY com a fonte no ar.
    mj = re.search(r"Estimated Jackpot[\s|]*(\$[0-9.]+\s*(?:Million|Billion))", bloco, re.I)
    mc = re.search(r"Cash Value[\s|]*(\$[0-9.]+\s*(?:Million|Billion))", bloco, re.I)
    jackpot = _milhoes(mj.group(1)) if mj else None
    cash = _milhoes(mc.group(1)) if mc else None
    if jackpot is None:
        return draw_id, None, None, "JACKPOT_ILEGIVEL"
    return draw_id, jackpot, cash, None


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


def bloco_do_sorteio(fonte, draw_id):
    """(inicio, fim) do objeto daquele sorteio no texto do data.js."""
    m = re.search(r'\n  \{\s*\n\s*id: "' + re.escape(draw_id) + r'"', fonte)
    if not m:
        return None
    ini = m.start()
    prox = re.search(r'\n  \{\s*\n\s*id: "', fonte[m.end():])
    fim = m.end() + prox.start() if prox else fonte.find("\n];", m.end())
    return (ini, fim)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--apply", action="store_true")
    a = p.parse_args()
    if not (a.dry_run or a.apply):
        p.error("escolha --dry-run ou --apply")

    draws = carrega_draws()
    abertos = [d for d in draws if not (d.get("result") or {}).get("numbers")]

    print("=" * 68)
    print("  POWERBALL — ATUALIZACAO DE JACKPOT DO SORTEIO ABERTO")
    print("=" * 68)

    if not abertos:
        print("  NENHUM_SORTEIO_ABERTO — nada a atualizar.")
        print("  PROVIDER_CALLS = 0 | DATA_MUTATIONS = 0")
        print("=" * 68)
        return 0
    aberto = abertos[-1]

    draw_id, jackpot, cash, erro = busca_proximo_sorteio()
    print(f"  sorteio aberto no data.js   {aberto['id']}")
    print(f"  proximo sorteio na fonte    {draw_id or '?'}")

    if erro:
        # Indisponibilidade temporaria da fonte NAO e falha operacional: o proximo ciclo tenta de
        # novo. Sair vermelho aqui encheria o painel de ruido e esconderia falha de verdade.
        print(f"  UPSTREAM_NOT_READY = {erro}")
        print("  DATA_MUTATIONS = 0")
        print("=" * 68)
        return 0

    # PORTAO DE IDENTIDADE. Fail-closed.
    if draw_id != aberto["id"]:
        print(f"  🛑 DRAW_ID_MISMATCH: a fonte anuncia {draw_id}, o sorteio aberto e {aberto['id']}.")
        print("     Recusando: copiar jackpot de outro sorteio e afirmar valor errado de dinheiro.")
        print("  DATA_MUTATIONS = 0")
        print("=" * 68)
        return 1

    atual = (aberto.get("drawing") or {}).get("jackpot")
    atual_cash = (aberto.get("drawing") or {}).get("cashValue")
    print(f"  jackpot oficial             {jackpot:,}")
    print(f"  cash value oficial          {cash:,}" if cash else "  cash value oficial          (nao publicado)")
    print(f"  jackpot no data.js          {atual if atual is not None else 'null'}")

    if atual == jackpot and atual_cash == cash:
        print("\n  NO_CHANGE — o data.js ja tem exatamente estes valores.")
        print("  DATA_MUTATIONS = 0")
        print("=" * 68)
        return 0

    fonte_txt = open(DATA_JS, encoding="utf-8").read()
    faixa = bloco_do_sorteio(fonte_txt, aberto["id"])
    if not faixa:
        print(f"\n  🛑 nao encontrei o bloco de {aberto['id']} no data.js — recusando editar as cegas.")
        return 2
    ini, fim = faixa
    bloco = fonte_txt[ini:fim]

    agora = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    novo_bloco = re.sub(r"(\n      jackpot: )[^,\n]+(,)", rf"\g<1>{jackpot}\g<2>", bloco, count=1)
    novo_bloco = re.sub(r"(\n      cashValue: )[^,\n]+(,)",
                        rf"\g<1>{cash if cash is not None else 'null'}\g<2>", novo_bloco, count=1)
    if novo_bloco == bloco:
        print("\n  🛑 as ancoras de jackpot/cashValue nao casaram — recusando editar as cegas.")
        return 2

    # Proveniencia: sem ela, "de onde veio esse numero?" so tem resposta na memoria de alguem.
    prov = (f'\n      jackpotSource: "{FONTE_ID}",'
            f'\n      jackpotFetchedAt: "{agora}",'
            f'\n      jackpotDrawId: "{aberto["id"]}",')
    if "jackpotSource:" in novo_bloco:
        novo_bloco = re.sub(r'\n      jackpotSource: "[^"]*",', f'\n      jackpotSource: "{FONTE_ID}",', novo_bloco)
        novo_bloco = re.sub(r'\n      jackpotFetchedAt: "[^"]*",', f'\n      jackpotFetchedAt: "{agora}",', novo_bloco)
    else:
        novo_bloco = re.sub(r"(\n      cashValue: [^,\n]+,)", r"\1" + prov, novo_bloco, count=1)

    if a.dry_run:
        print("\n  DRY RUN — nada gravado. Mudaria para:")
        print(f"    jackpot: {jackpot}\n    cashValue: {cash}\n    jackpotSource: {FONTE_ID}")
        print("=" * 68)
        return 0

    open(DATA_JS, "w", encoding="utf-8").write(fonte_txt[:ini] + novo_bloco + fonte_txt[fim:])

    depois = carrega_draws()
    d2 = next((d for d in depois if d["id"] == aberto["id"]), None)
    problemas = []
    if not d2:
        problemas.append("sorteio sumiu")
    else:
        if (d2.get("drawing") or {}).get("jackpot") != jackpot:
            problemas.append("jackpot nao gravou")
        if len(d2.get("participants") or []) != len(aberto.get("participants") or []):
            problemas.append("mexeu nos participantes")
        if json.dumps(d2.get("sharedTickets"), sort_keys=True) != json.dumps(aberto.get("sharedTickets"), sort_keys=True):
            problemas.append("mexeu nos bilhetes")
        if d2.get("result") is not None:
            problemas.append("criou resultado")
    if len(depois) != len(draws):
        problemas.append("mudou o numero de sorteios")
    if problemas:
        print(f"\n  🛑 invariantes violadas: {problemas} — revertendo.")
        open(DATA_JS, "w", encoding="utf-8").write(fonte_txt)
        return 2

    print(f"\n  ✓ ATUALIZADO: {aberto['id']} — jackpot {jackpot:,}"
          + (f", cash {cash:,}" if cash else ""))
    print("    participantes, bilhetes e resultado intocados.")
    print("  DATA_MUTATIONS = 1")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    sys.exit(main())
