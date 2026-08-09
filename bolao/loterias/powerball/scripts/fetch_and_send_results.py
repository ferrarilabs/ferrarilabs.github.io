#!/usr/bin/env python3
"""
fetch_and_send_results.py — Powerball automatic result fetcher and email sender
Fetches official results from NY Open Data API, updates data.js, and sends emails.

Usage:
  python3 fetch_and_send_results.py                    # check all draws, send if new result
  python3 fetch_and_send_results.py --dry-run          # preview without sending email
  python3 fetch_and_send_results.py --force-resend     # resend last email even if already sent
"""

import json, sys, time, urllib.request, urllib.parse, re
from datetime import datetime, timedelta
import subprocess

POWERBALL_API = "https://data.ny.gov/resource/d6yy-54nr.json"
MEGAMILLIONS_API = "https://data.ny.gov/resource/5xaw-6ayf.json"

# Maps gameType to its API URL and parsing function
GAME_TYPES = {
    "powerball": {
        "api": POWERBALL_API,
        "parse": lambda row: {
            "numbers": sorted(list(map(int, row["winning_numbers"].strip().split()[:5]))),
            "special": int(row["winning_numbers"].strip().split()[5]),
            "multiplier": int(row.get("multiplier", 1))
        }
    },
    "megamillions": {
        "api": MEGAMILLIONS_API,
        "parse": lambda row: {
            "numbers": sorted(list(map(int, row["winning_numbers"].strip().split()[:5]))),
            "special": int(row.get("mega_ball", 1)),
            "multiplier": int(row.get("multiplier", 1))
        }
    }
}

def fetch_official_result(game_type):
    """Fetch latest result from official API."""
    if game_type not in GAME_TYPES:
        print(f"❌ Unknown game type: {game_type}")
        return None

    config = GAME_TYPES[game_type]
    try:
        # A query da Socrata precisa ser CODIFICADA. Sem isto o espaço em "draw_date DESC" vai
        # cru na URL e o urllib recusa antes de qualquer rede:
        #   "URL can't contain control characters ... (found at least ' ')"
        # O erro era capturado pelo `except` abaixo, virava um print de ❌ e o script seguia com
        # exit 0 — então o workflow ficava VERDE tendo falhado em toda execução. Foi assim que o
        # resultado do sorteio de 08/08 nunca foi gravado nem enviado por email.
        # (O navegador funcionava porque o `fetch()` dele codifica o espaço sozinho — por isso a
        # página mostrava o resultado e o cron não.)
        url = f"{config['api']}?" + urllib.parse.urlencode({"$order": "draw_date DESC", "$limit": 1})
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
            if not data:
                return None
            return config["parse"](data[0])
    except Exception as e:
        print(f"❌ API error: {e}")
        return None

def load_data_js():
    """Load data.js content."""
    with open("bolao/loterias/powerball/js/data.js", "r", encoding="utf-8") as f:
        return f.read()

def parse_draws(content):
    """Lê POWERBALL_DRAWS do data.js usando o NODE, não json.loads.

    Por que: `data.js` é JavaScript de verdade — chaves sem aspas (`id: "..."`), comentários,
    vírgulas finais. `json.loads` NUNCA conseguiu ler isso; a função devolvia None em toda
    execução, o chamador imprimia "❌ Could not parse" e o script terminava com exit 0. Somado ao
    bug de encoding da URL, é por isso que o resultado do sorteio de 08/08 não foi gravado nem
    enviado — e o workflow ficou VERDE o tempo todo.

    O Node já é dependência do repositório e sabe ler JS por construção. Isto aqui é SÓ LEITURA:
    a escrita de volta é cirúrgica (ver write_result_into_data_js).
    """
    import tempfile, os
    reader = (
        "const fs=require('fs');const vm=require('vm');"
        "const src=fs.readFileSync(process.argv[1],'utf8');"
        "const sandbox={window:{}};vm.createContext(sandbox);"
        "vm.runInContext(src,sandbox);"
        "process.stdout.write(JSON.stringify(sandbox.window.POWERBALL_DRAWS||null));"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        out = subprocess.run(["node", "-e", reader, tmp_path],
                             capture_output=True, text=True, timeout=20)
        if out.returncode != 0:
            print(f"❌ Node não conseguiu ler data.js: {out.stderr.strip()[:200]}")
            return None
        return json.loads(out.stdout) if out.stdout.strip() else None
    except Exception as e:
        print(f"❌ Falha ao ler data.js: {e}")
        return None
    finally:
        os.unlink(tmp_path)


def write_result_into_data_js(content, draw_id, result_obj):
    """Escreve o resultado de UM sorteio, preservando o arquivo byte a byte no resto.

    A versão anterior reescrevia o ARRAY INTEIRO com `json.dumps`. Isso apagaria os 57 comentários
    do arquivo (vários explicando decisões de dinheiro: cotas, ajustes pendentes, crédito do sorteio
    anterior) e toda a formatação — num arquivo que guarda bilhete e pagamento reais. Nunca chegou a
    rodar por causa dos outros dois bugs; se tivesse rodado, teria destruído esse contexto.

    Aqui só o `result: null` do sorteio alvo vira o objeto de resultado. Se a âncora não for única e
    inequívoca, NÃO escreve — recusar é melhor que reescrever um arquivo de dinheiro no escuro.
    """
    anchor = f'id: "{draw_id}"'
    idx = content.find(anchor)
    if idx == -1:
        return None, f'sorteio {draw_id} não encontrado no data.js'
    # Começa DEPOIS do próprio id âncora — senão ele mesmo dispara o guard abaixo.
    block = content[idx + len(anchor):]
    rel = block.find("result: null")
    if rel == -1:
        return None, f'sorteio {draw_id} não tem `result: null` para preencher'
    # A âncora precisa pertencer a ESTE sorteio: nenhum id de OUTRO sorteio pode aparecer entre os
    # dois. Id de sorteio é propriedade de nível superior do array (indentação de 4 espaços) — um
    # `id:` aninhado em ticket/participante não conta.
    if re.search(r'\n    id: "', block[:rel]):
        return None, 'a âncora `result: null` pertence a outro sorteio — recusando escrever'
    abs_at = idx + len(anchor) + rel   # `block` começa depois do id âncora — o offset precisa somar isso
    literal = (
        "result: {\n"
        f'      numbers: {json.dumps(result_obj["numbers"])},\n'
        f'      special: {result_obj["special"]},\n'
        f'      multiplier: {result_obj["multiplier"]},\n'
        f'      checkedAt: {json.dumps(result_obj["checkedAt"])},\n'
        f'      premiosGanhos: {result_obj["premiosGanhos"]},\n'
        f'      jackpotHit: {json.dumps(result_obj["jackpotHit"])},\n'
        f'      breakdown: {json.dumps(result_obj["breakdown"], ensure_ascii=False)}\n'
        "    }"
    )
    return content[:abs_at] + literal + content[abs_at + len("result: null"):], None

def get_last_incomplete_draw(draws):
    """Get the last draw that doesn't have a completed result yet and we're participating in."""
    for draw in reversed(draws):
        # Skip if no result yet
        if draw.get("result") is None or draw["result"].get("numbers") is None:
            # Check if we have tickets/participation in this draw
            has_tickets = draw.get("sharedTickets") or draw.get("participants")
            if has_tickets:
                return draw
    return None


def compute_prize_via_node(draw_id, official):
    """Calcula o prêmio usando a prizeTable do PRÓPRIO data.js, via Node.

    Reusar a tabela em vez de reimplementá-la em Python é deliberado: regra de prêmio duplicada em
    dois runtimes é a mesma classe de divergência que já mordeu este repositório (o
    `send_result_email.py` do futebol tinha se afastado em silêncio da lógica do site — ver
    CHANGELOG v4.57 da Copa).
    """
    script = """
const fs=require('fs'),vm=require('vm');const sb={window:{}};vm.createContext(sb);
vm.runInContext(fs.readFileSync('bolao/loterias/powerball/js/data.js','utf8'),sb);
const [drawId, officialJson] = process.argv.slice(1);
const off = JSON.parse(officialJson);
const draw = sb.window.POWERBALL_DRAWS.find(d => d.id === drawId);
if (!draw) { console.error('draw not found'); process.exit(1); }
const gt = sb.window.LOTTERY_GAME_TYPES[draw.gameType];
let total = 0, jackpotHit = false; const counts = {};
(draw.sharedTickets && draw.sharedTickets.series || []).forEach(s => (s.numeros||[]).forEach(str => {
  const m = String(str).match(/^([\\d\\s-]+?)\\s*—\\s*(?:PB|MB)\\s*(\\d+)$/);
  if (!m) return;
  const nums = m[1].trim().split(/[\\s-]+/).map(Number), special = Number(m[2]);
  const main = nums.filter(n => off.numbers.indexOf(n) !== -1).length;
  const sp = special === off.special;
  if (main === 5 && sp) jackpotHit = true;
  const r = gt.prizeTable(main, sp, off.multiplier || 1);
  if (r && r.amount) { total += r.amount; counts[r.label] = (counts[r.label]||0) + 1; }
}));
const breakdown = Object.entries(counts).map(([k,v]) => v + 'x ' + k);
process.stdout.write(JSON.stringify({ total, jackpotHit, breakdown }));
"""
    try:
        out = subprocess.run(["node", "-e", script, draw_id, json.dumps(official)],
                             capture_output=True, text=True, timeout=20)
        if out.returncode != 0:
            print(f"❌ Node falhou ao calcular prêmio: {out.stderr.strip()[:200]}")
            return None
        return json.loads(out.stdout)
    except Exception as e:
        print(f"❌ Erro ao calcular prêmio: {e}")
        return None


def check_and_update_results(game_type, dry_run=False, force_resend=False):
    """Check API for new results and update data.js if found."""
    print(f"\n🔍 Checking {game_type.upper()} for new results...\n")

    # Fetch official result
    official = fetch_official_result(game_type)
    if not official:
        print(f"ℹ️  No result available from API yet")
        return False

    print(f"✓ Official result: {official['numbers']} | Special {official['special']} (Multiplier {official['multiplier']}x)")

    # Load and parse data.js
    content = load_data_js()
    draws = parse_draws(content)
    if not draws:
        print("❌ Could not parse POWERBALL_DRAWS from data.js")
        return False

    # Find the draw that needs a result (and we're participating in)
    target_draw = get_last_incomplete_draw(draws)
    if not target_draw:
        print("ℹ️  No incomplete draw found OR not participating in any incomplete draw")
        return False

    # Double-check we have participation
    has_tickets = target_draw.get("sharedTickets") or target_draw.get("participants")
    if not has_tickets:
        print(f"ℹ️  Draw {target_draw['id']} has no tickets/participation — skipping")
        return False

    print(f"📋 Found incomplete draw we're playing: {target_draw['id']}")

    # Check if official result matches the target draw's date
    # For now, assume the latest API result is for the incomplete draw

    if target_draw.get("result") and target_draw["result"].get("numbers"):
        print(f"ℹ️  Draw {target_draw['id']} already has a result")
        if not force_resend:
            return False

    print(f"\n✏️  Updating draw {target_draw['id']} with official result...")

    # PRÊMIO CALCULADO AQUI, não deixado como placeholder.
    #
    # A versão anterior gravava `premiosGanhos: 0` com o comentário "will be calculated by email
    # script". Só que o site LÊ esse valor e o exibe como afirmação: com 0 ele escreve "Nenhum
    # prêmio nesse sorteio". Ou seja, o placeholder não é neutro — ele vira uma declaração FALSA
    # sobre dinheiro assim que o resultado é gravado. No sorteio de 08/08 dois bilhetes acertaram o
    # Powerball ($4 x3 de Power Play = $12 cada); o site teria dito "nenhum prêmio" com $24 ganhos.
    #
    # O cálculo reusa a MESMA `prizeTable` do data.js (via Node), em vez de reimplementar a tabela
    # de prêmios em Python — duas cópias da regra de prêmio é exatamente o tipo de divergência que
    # este repositório já pagou caro para descobrir noutro lugar.
    prize = compute_prize_via_node(target_draw["id"], official)
    if prize is None:
        print("❌ Não consegui calcular o prêmio — recusando gravar um resultado incompleto")
        return False
    print(f"💰 Prêmios: ${prize['total']} ({', '.join(prize['breakdown']) or 'nenhum'})")

    target_draw["result"] = {
        "numbers": official["numbers"],
        "special": official["special"],
        "multiplier": official["multiplier"],
        "checkedAt": datetime.now().strftime("%d/%m/%Y %H:%M ET"),
        "premiosGanhos": prize["total"],
        "jackpotHit": prize["jackpotHit"],
        "breakdown": prize["breakdown"],
    }

    if dry_run:
        print("🏜️  DRY RUN — Not saving changes")
        return True

    # Escrita CIRÚRGICA — ver write_result_into_data_js sobre por que não se reescreve o array.
    updated_content, err = write_result_into_data_js(content, target_draw["id"], target_draw["result"])
    if err:
        print(f"❌ Não escrevi o data.js: {err}")
        return False

    with open("bolao/loterias/powerball/js/data.js", "w", encoding="utf-8") as f:
        f.write(updated_content)

    print(f"✓ Updated data.js with new result")

    # Commit the change
    try:
        subprocess.run(["git", "add", "bolao/loterias/powerball/js/data.js"], check=True)
        subprocess.run([
            "git", "commit", "-m",
            f"Auto: Add Powerball result {target_draw['id']} ({official['numbers']} | PB{official['special']})"
        ], check=True)
        subprocess.run(["git", "push"], check=True)
        print(f"✓ Committed and pushed data.js")
    except subprocess.CalledProcessError as e:
        print(f"⚠️  Git operation failed: {e}")
        # Continue anyway — send email even if commit failed

    return True

def main():
    dry_run = "--dry-run" in sys.argv
    force_resend = "--force-resend" in sys.argv
    game_type = "powerball"  # Default to powerball for now

    # Check for new results and update if needed
    if check_and_update_results(game_type, dry_run=dry_run, force_resend=force_resend):
        # If result was updated, send email
        if not dry_run:
            print(f"\n📧 Sending result emails...\n")
            subprocess.run([
                "python3",
                "bolao/loterias/powerball/scripts/send_result_email.py",
                "--send-all",
                game_type
            ])
    else:
        if not dry_run:
            print(f"✓ No new results to process")

if __name__ == "__main__":
    main()
