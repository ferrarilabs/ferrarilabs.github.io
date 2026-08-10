#!/usr/bin/env python3
"""
fetch_and_send_results.py — Powerball automatic result fetcher and email sender
Fetches official results from NY Open Data API, updates data.js, and sends emails.

Usage:
  python3 fetch_and_send_results.py                    # check all draws, send if new result
  python3 fetch_and_send_results.py --dry-run          # preview without sending email
  python3 fetch_and_send_results.py --force-resend     # resend last email even if already sent
"""

import json, sys, time, urllib.request, urllib.parse, re, os
from datetime import datetime, timedelta
import subprocess

# CAMINHOS ANCORADOS NA RAIZ DO REPO, não no diretório de trabalho.
#
# O workflow roda com `working-directory: bolao/loterias/powerball/scripts`, mas o script abria
# "bolao/loterias/powerball/js/data.js" — caminho relativo à RAIZ. Da pasta scripts isso é
# FileNotFoundError. O bug estava mascarado: a execução morria antes, no encoding da URL, e nunca
# chegava aqui. Consertado o primeiro, este seria o próximo a aparecer.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
DATA_JS_PATH = os.path.join(REPO_ROOT, "bolao", "loterias", "powerball", "js", "data.js")
DATA_JS_REL = "bolao/loterias/powerball/js/data.js"
SEND_EMAIL_SCRIPT = os.path.join(REPO_ROOT, "bolao", "loterias", "powerball", "scripts", "send_result_email.py")

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

# ─── P0, 2026-08-10: NUNCA CONFIAR NO "MAIS RECENTE" ────────────────────────────────────────
#
# O codigo anterior pedia `$order=draw_date DESC&$limit=1`, jogava fora o `draw_date` no parse, e
# aplicava o que voltasse ao ultimo sorteio incompleto. O comentario no lugar da checagem dizia,
# literalmente: "For now, assume the latest API result is for the incomplete draw".
#
# Reproduzido em 2026-08-10 as 15:11 ET: a API devolvia o resultado de 08/08
# ([5,9,35,54,63] PB 7) e havia DOIS sorteios incompletos -- 08/08 e 08/10. Como
# `get_last_incomplete_draw` itera em `reversed(draws)`, o alvo seria o 08/10, e o resultado do
# dia 8 seria gravado no sorteio do dia 10 -- com premio calculado contra os bilhetes errados,
# e-mail anunciando numeros que nao sao daquele sorteio, e o 08/08 ficando sem resultado para
# sempre.
#
# A identidade do sorteio e o `draw_date` da propria fonte, comparado com o `drawDateIso`
# canonico do data.js. Nao por ordenacao, nao por dia da semana, nao por numeros.
DRAW_PUBLICATION_GRACE_MINUTES = 10   # tempo para a fonte oficial publicar apos o sorteio


def _draw_date_key(iso_or_date):
    """Normaliza para YYYY-MM-DD. A fonte devolve '2026-08-08T00:00:00.000' (meia-noite, sem
    fuso); o canonico e '2026-08-10T22:59:00-04:00'. Comparar strings inteiras nunca casaria."""
    return str(iso_or_date)[:10]


def fetch_official_result(game_type, expected_draw_date):
    """Resultado oficial DAQUELE sorteio, ou None.

    Devolve tambem `drawDate` para que o chamador possa reconferir -- um resultado sem identidade
    e exatamente o que causou este incidente.
    """
    if game_type not in GAME_TYPES:
        print(f"❌ Unknown game type: {game_type}")
        return None, "TIPO_DESCONHECIDO"

    config = GAME_TYPES[game_type]
    alvo = _draw_date_key(expected_draw_date)
    try:
        # Filtro por data EXATA na propria fonte. Se a API mudar a ordenacao, ou passar a incluir
        # sorteios futuros, ou devolver a lista noutra ordem, nada disso muda o resultado aqui.
        #
        # A query da Socrata precisa ser CODIFICADA. Sem isto o espaco vai cru na URL e o urllib
        # recusa antes de qualquer rede -- o erro virava print e o script seguia com exit 0, entao
        # o workflow ficava VERDE tendo falhado. Foi assim que o sorteio de 08/08 nunca foi gravado.
        url = f"{config['api']}?" + urllib.parse.urlencode({
            "$where": f"draw_date between '{alvo}T00:00:00' and '{alvo}T23:59:59'",
            "$limit": 10,
        })
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"❌ API error: {e}")
        return None, "FONTE_INDISPONIVEL"

    exatos = [row for row in data if _draw_date_key(row.get("draw_date")) == alvo]
    if not exatos:
        return None, "NOT_READY"
    if len(exatos) > 1:
        # Dois registros para a mesma data e ambiguidade da fonte, nao um detalhe a resolver
        # escolhendo um. Falha fechada.
        print(f"❌ AMBIGUOUS_UPSTREAM_RESULT: {len(exatos)} registros para {alvo}")
        return None, "AMBIGUOUS_UPSTREAM_RESULT"

    row = exatos[0]
    if not row.get("draw_date"):
        return None, "SEM_DATA_NA_FONTE"
    try:
        parsed = config["parse"](row)
    except Exception as e:
        print(f"❌ resultado malformado na fonte: {e}")
        return None, "RESULTADO_MALFORMADO"
    parsed["drawDate"] = _draw_date_key(row["draw_date"])
    return parsed, "OK"


def validate_result(game_type, result):
    """(ok, motivo). Rejeita payload malformado ANTES de qualquer persistencia."""
    faixa = {"powerball": (69, 26), "megamillions": (70, 25)}[game_type]
    nums = result.get("numbers")
    if not isinstance(nums, list) or len(nums) != 5:
        return False, "esperados 5 numeros brancos"
    if not all(isinstance(n, int) for n in nums):
        return False, "numeros brancos precisam ser inteiros"
    if len(set(nums)) != 5:
        return False, "numeros brancos repetidos"
    if not all(1 <= n <= faixa[0] for n in nums):
        return False, f"numero branco fora da faixa 1..{faixa[0]}"
    esp = result.get("special")
    if not isinstance(esp, int) or not (1 <= esp <= faixa[1]):
        return False, f"bola especial fora da faixa 1..{faixa[1]}"
    mult = result.get("multiplier", 1)
    if not isinstance(mult, int) or not (1 <= mult <= 10):
        return False, "multiplicador fora da faixa 1..10"
    if sorted(nums) != nums:
        return False, "numeros brancos nao estao normalizados"
    return True, None


def draw_has_occurred(draw, now=None):
    """(ocorreu, detalhe). Portao TEMPORAL, independente do portao de identidade.

    Ambos sao obrigatorios: a fonte poderia publicar cedo por engano, e a identidade poderia
    casar num sorteio que ainda nao aconteceu.
    """
    from datetime import datetime, timezone, timedelta
    # `drawDateIso` vive dentro de `drawing` no data.js. Aceita os dois niveis para nao depender
    # da forma exata do documento -- mas EXIGE que exista: sem instante canonico nao ha portao
    # temporal, e sem portao temporal um resultado publicado cedo por engano entraria.
    iso = (draw.get("drawing") or {}).get("drawDateIso") or draw.get("drawDateIso")
    if not iso:
        return False, "sorteio sem drawDateIso canonico (nem em draw.drawing)"
    try:
        quando = datetime.fromisoformat(iso)
    except ValueError:
        return False, f"drawDateIso ilegivel: {iso}"
    agora = now or datetime.now(timezone.utc)
    if quando.tzinfo is None:
        quando = quando.replace(tzinfo=timezone.utc)
    liberado = quando + timedelta(minutes=DRAW_PUBLICATION_GRACE_MINUTES)
    if agora < liberado:
        return False, (f"sorteio em {iso}; liberado a partir de {liberado.isoformat()} "
                       f"(+{DRAW_PUBLICATION_GRACE_MINUTES}min); agora {agora.isoformat()}")
    return True, None


def load_data_js():
    """Load data.js content."""
    with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
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

def get_last_incomplete_draw(draws, force_resend=False):
    """Último sorteio em que participamos e que ainda precisa de resultado.

    Com `force_resend`, devolve o último sorteio em que participamos MESMO que já tenha resultado.
    Sem isso o `--force-resend` era inalcançável: a seleção descartava todo sorteio já resolvido,
    então a função devolvia None e o fluxo terminava em "No incomplete draw found" antes de chegar
    à checagem de reenvio. Ou seja, a opção existia na linha de comando e no workflow e não tinha
    como funcionar.
    """
    for draw in reversed(draws):
        has_tickets = draw.get("sharedTickets") or draw.get("participants")
        if not has_tickets:
            continue
        resolved = draw.get("result") is not None and draw["result"].get("numbers") is not None
        if force_resend:
            return draw          # reenvio: o alvo é o último sorteio nosso, resolvido ou não
        if not resolved:
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
vm.runInContext(fs.readFileSync(process.argv[3],'utf8'),sb);
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
        out = subprocess.run(["node", "-e", script, draw_id, json.dumps(official), DATA_JS_PATH],
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

    # ─── ORDEM CORRIGIDA (P0, 2026-08-10) ────────────────────────────────────────────────────
    #
    # Antes: buscava o resultado MAIS RECENTE e so depois procurava o alvo. Agora identifica o
    # ALVO primeiro e pede a fonte por aquele sorteio especifico. A pergunta deixou de ser "qual
    # o ultimo resultado?" e passou a ser "existe resultado PARA ESTE sorteio?".
    content = load_data_js()
    draws = parse_draws(content)
    if not draws:
        print("❌ Could not parse POWERBALL_DRAWS from data.js")
        return False

    target_draw = get_last_incomplete_draw(draws, force_resend=force_resend)
    if not target_draw:
        print("ℹ️  No incomplete draw found OR not participating in any incomplete draw")
        return False

    has_tickets = target_draw.get("sharedTickets") or target_draw.get("participants")
    if not has_tickets:
        print(f"ℹ️  Draw {target_draw['id']} has no tickets/participation — skipping")
        return False

    _lbl = (target_draw.get("drawing") or {}).get("drawDateLabel") or target_draw.get("drawDateLabel", "?")
    print(f"📋 Sorteio alvo: {target_draw['id']}  ({_lbl})")

    # PORTAO 1 — TEMPORAL. Antes da hora oficial + carencia, nao existe resultado legitimo.
    ocorreu, porque = draw_has_occurred(target_draw)
    if not ocorreu:
        print(f"⏳ RESULT_STATUS = DRAW_NOT_OCCURRED_OR_NOT_READY\n   {porque}")
        print("   DATA_MUTATIONS = 0 | EMAILS_SENT = 0")
        return False

    # PORTAO 2 — IDENTIDADE. So o resultado DAQUELE sorteio serve.
    official, status = fetch_official_result(game_type, target_draw["id"])
    if official is None:
        print(f"⏳ RESULT_STATUS = {status}")
        print("   DATA_MUTATIONS = 0 | EMAILS_SENT = 0")
        return False

    if _draw_date_key(official["drawDate"]) != _draw_date_key(target_draw["id"]):
        # Cinto e suspensorio: a consulta ja filtra por data, mas confiar num filtro remoto sem
        # reconferir localmente foi exatamente a classe de erro deste incidente.
        print(f"❌ DRAW_DATE_MISMATCH: fonte={official['drawDate']} alvo={target_draw['id']}")
        return False

    valido, motivo = validate_result(game_type, official)
    if not valido:
        print(f"❌ RESULTADO_INVALIDO: {motivo}")
        return False

    print(f"✓ Resultado oficial DE {official['drawDate']}: {official['numbers']} | "
          f"Special {official['special']} (Multiplier {official['multiplier']}x)")

    # IMUTABILIDADE: resultado ja gravado nao e sobrescrito automaticamente.
    existing_result = target_draw.get("result") if target_draw.get("result") and target_draw["result"].get("numbers") else None
    if existing_result:
        mesmo = (sorted(existing_result.get("numbers") or []) == sorted(official["numbers"])
                 and existing_result.get("special") == official["special"])
        if mesmo:
            print(f"✓ IDEMPOTENTE: {target_draw['id']} ja tem exatamente este resultado. Nada a fazer.")
            return False
        print(f"❌ RESULT_CONFLICT: {target_draw['id']} ja tem resultado DIFERENTE do que a fonte "
              f"devolve agora. NAO sera sobrescrito automaticamente — use o caminho de correcao "
              f"do operador.")
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

    # REENVIO com o resultado JÁ GRAVADO e correto: não há o que escrever — o `result: null` não
    # existe mais, e o guard de escrita (corretamente) recusaria. Segue direto para o email.
    # Sem isto, `--force-resend` chegava até aqui e morria no guard, sem enviar nada.
    if existing_result and existing_result.get("numbers") == official["numbers"] \
            and existing_result.get("special") == official["special"]:
        print("↩️  Resultado já gravado e idêntico ao oficial — nada a escrever, seguindo para o email")
        return True

    # Escrita CIRÚRGICA — ver write_result_into_data_js sobre por que não se reescreve o array.
    updated_content, err = write_result_into_data_js(content, target_draw["id"], target_draw["result"])
    if err:
        print(f"❌ Não escrevi o data.js: {err}")
        return False

    with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
        f.write(updated_content)

    print(f"✓ Updated data.js with new result")

    # Commit the change
    try:
        subprocess.run(["git", "-C", REPO_ROOT, "add", DATA_JS_REL], check=True)
        subprocess.run([
            "git", "-C", REPO_ROOT, "commit", "-m",
            f"Auto: Add Powerball result {target_draw['id']} ({official['numbers']} | PB{official['special']})"
        ], check=True)
        subprocess.run(["git", "-C", REPO_ROOT, "push"], check=True)
        print(f"✓ Committed and pushed data.js")
    except subprocess.CalledProcessError as e:
        print(f"⚠️  Git operation failed: {e}")
        # Continue anyway — send email even if commit failed

    return True

# ─── ORQUESTRACAO (P0, 2026-08-10) ───────────────────────────────────────────────────────────
#
# O `main()` anterior era:
#
#     if check_and_update_results(...):      # gravou o resultado?
#         subprocess.run([... send_result_email ...])   # entao manda o e-mail
#
# Isso e, literalmente, `result exists == notification completed`. Duas execucoes que gravassem
# o resultado -- ou uma que gravasse e outra que lesse o estado antes do push -- mandariam o
# e-mail duas vezes para 15 pessoas. E se o provedor aceitasse e o processo morresse antes do
# commit, nada no sistema saberia que ja tinha enviado.
#
# Agora sao DOIS fatos independentes e duraveis:
#
#     reconciliacao do RESULTADO  -- grava no data.js, idempotente
#     ciclo da NOTIFICACAO        -- job no ledger, com claim atomico e disposicao por
#                                    destinatario
#
# Resultado valido pode ficar gravado com a notificacao pendente (destinatarios incompletos, por
# exemplo). Falha de notificacao NUNCA reverte um resultado oficial.
#
# `deps` existe para o teste exercitar ESTA funcao -- a mesma que o workflow chama -- sem tocar
# em rede, banco ou provedor. Um teste que reimplementasse a orquestracao provaria o teste, nao
# o produto.
class Deps:
    """Fronteiras externas injetaveis. O padrao e a producao."""
    def __init__(self, ledger=None, send_email=None, resolve_recipients=None):
        if ledger is None:
            import powerball_notification as _pn
            ledger = _pn
        self.ledger = ledger
        self.send_email = send_email or _default_send_email
        self.resolve_recipients = resolve_recipients or _default_resolve_recipients


def _default_send_email(game_type, entry_refs):
    """Producao: delega ao sender, que tem os proprios portoes de autorizacao."""
    proc = subprocess.run(["python3", SEND_EMAIL_SCRIPT, "--send-all", game_type],
                          capture_output=True, text=True)
    aceitos = [] if proc.returncode != 0 else list(entry_refs)
    return {"accepted": aceitos, "failed": [] if proc.returncode == 0 else list(entry_refs),
            "uncertain": [], "stdout": proc.stdout[-400:]}


def _default_resolve_recipients(draw):
    """Referencias OPACAS dos participantes. Endereco nunca passa por aqui."""
    return [str(p.get("nome") or p.get("name") or "").strip()
            for p in (draw.get("participants") or [])
            if (p.get("nome") or p.get("name"))]


def run_lifecycle(game_type="powerball", dry_run=False, force_resend=False, deps=None):
    """Ciclo completo: reconcilia resultado, depois trata a notificacao. Devolve o relatorio.

    E ESTA a funcao que o workflow chama. Qualquer caminho de envio passa por aqui.
    """
    deps = deps or Deps()
    rel = {"resultReconciled": False, "notificationState": None, "providerCalls": 0,
           "wouldSend": False, "reason": None}

    # ── FATO 1: RESULTADO ──────────────────────────────────────────────────────────────────
    reconciliou = check_and_update_results(game_type, dry_run=dry_run, force_resend=force_resend)
    rel["resultReconciled"] = bool(reconciliou)

    # O sorteio alvo e seu resultado, LIDOS do estado canonico -- nao do retorno acima. Um
    # resultado reconciliado numa execucao ANTERIOR tem de continuar o ciclo de notificacao;
    # parar aqui porque "nada mudou agora" foi o defeito que deixou notificacao pendente para
    # sempre.
    draws = parse_draws(load_data_js()) or []
    alvo = None
    for d in reversed(draws):
        if not (d.get("participants") or d.get("sharedTickets")):
            continue
        if (d.get("result") or {}).get("numbers"):
            alvo = d
            break
    if not alvo:
        rel["reason"] = "NENHUM_SORTEIO_COM_RESULTADO"
        return rel

    result = alvo["result"]
    draw_id = alvo["id"]

    # ── FATO 2: NOTIFICACAO ────────────────────────────────────────────────────────────────
    disponivel, porque = deps.ledger.ledger_available()
    if not disponivel:
        # Sem ledger nao ha idempotencia duravel. Enviar as cegas e o defeito original.
        rel["notificationState"] = "LEDGER_INDISPONIVEL"
        rel["reason"] = porque
        return rel

    ja = deps.ledger.get_job(draw_id)
    if ja and ja["status"] == deps.ledger.SENT:
        rel["notificationState"] = "ALREADY_COMPLETED"
        rel["reason"] = "notificacao ja concluida para este sorteio"
        return rel

    esperados = deps.resolve_recipients(alvo)
    resolvidos = deps.resolve_recipients(alvo)   # resolucao real de contato acontece no sender
    completo = len(esperados) == len(resolvidos) and len(esperados) > 0

    ok_conteudo, motivo = deps.ledger.check_content_immutability(
        draw_id, result, esperados, alvo.get("finance"))
    if not ok_conteudo:
        rel["notificationState"] = "CONTENT_CONFLICT"
        rel["reason"] = motivo
        return rel

    deps.ledger.ensure_job(draw_id, result, esperados, alvo.get("finance"))

    if not completo:
        rel["notificationState"] = "RECIPIENT_SET_INCOMPLETE"
        rel["reason"] = f"esperados={len(esperados)} resolvidos={len(resolvidos)}"
        return rel

    rel["wouldSend"] = True
    if dry_run:
        rel["notificationState"] = "READY_DRY_RUN"
        return rel

    worker = f"gha-{os.environ.get('GITHUB_RUN_ID', 'local')}"
    reivindicado = deps.ledger.claim(draw_id, worker)
    if not reivindicado:
        # Outra execucao esta com o lease. NOOP, nao erro.
        rel["notificationState"] = "ALREADY_CLAIMED"
        return rel

    # Um dono anterior pode ter morrido no meio do transporte. Antes de decidir para quem
    # enviar, resolve os orfaos: SENDING vira UNCERTAIN, que nao e reenviado automaticamente.
    if hasattr(deps.ledger, "reconcile_orphaned_sending"):
        deps.ledger.reconcile_orphaned_sending(draw_id)

    alvos = deps.ledger.retryable_recipients(draw_id)

    # SEM FALLBACK. Ate 2026-08-10 esta linha era `retryable_recipients(...) or esperados`, e a
    # lista VAZIA -- que significa "todos ja foram aceitos" -- e falsa em Python, entao o `or`
    # caia para TODOS os destinatarios. Um crash depois do aceite e antes do settle reenviava o
    # mesmo e-mail para as 15 pessoas. Era a catastrofe de 08/08 codificada na orquestracao.
    # Nada a reenviar significa nada a reenviar: fecha o job a partir do estado por destinatario.
    if not alvos:
        final = deps.ledger.settle(draw_id)
        rel["notificationState"] = final["status"]
        rel["reason"] = final.get("reason") or "nada pendente: conclusao reconstruida do estado"
        rel["providerCalls"] = 0
        return rel

    for ref in alvos:
        deps.ledger.record_recipient(draw_id, ref, deps.ledger.R_SENDING)
    saida = deps.send_email(game_type, alvos)
    rel["providerCalls"] = len(alvos)
    for ref in saida.get("accepted", []):
        deps.ledger.record_recipient(draw_id, ref, deps.ledger.R_ACCEPTED)
    for ref in saida.get("failed", []):
        deps.ledger.record_recipient(draw_id, ref, deps.ledger.R_FAILED)
    for ref in saida.get("uncertain", []):
        deps.ledger.record_recipient(draw_id, ref, deps.ledger.R_UNCERTAIN)

    final = deps.ledger.settle(draw_id)
    rel["notificationState"] = final["status"]
    rel["reason"] = final.get("reason")
    return rel


# ── SEMANTICA DE SAIDA ─────────────────────────────────────────────────────────────────────────
#
# "Ainda nao ha resultado" e um ESTADO DE NEGOCIO NORMAL, nao uma falha de infraestrutura. O cron
# roda de 10 em 10 minutos por varias horas em cada noite de sorteio; a esmagadora maioria dessas
# execucoes acontece antes do sorteio. Se cada uma delas aparecesse vermelha no GitHub Actions, o
# painel viraria ruido -- e ruido constante e como uma falha DE VERDADE passa despercebida.
#
# O criterio nao e "deu tudo certo?", e "alguem precisa agir?".
ESTADOS_OK = {
    None,                      # nada a fazer ainda
    "READY_DRY_RUN",           # dry-run chegou ate onde podia
    "ALREADY_COMPLETED",       # ja notificado; nova execucao e no-op por desenho
    "ALREADY_CLAIMED",         # outra execucao esta com o lease; nao e conflito
    "sent",                    # concluido
    "NENHUM_SORTEIO_COM_RESULTADO",
}
ESTADOS_ATENCAO = {
    "RECIPIENT_SET_INCOMPLETE",   # falta contato -- alguem tem de arrumar antes do sorteio
    "CONTENT_CONFLICT",           # conteudo divergente de um job ativo
    "LEDGER_INDISPONIVEL",        # sem idempotencia duravel nao se envia
    "failed_retryable",
    "failed_permanent",           # UNCERTAIN: exige revisao humana
}


def main():
    dry_run = "--dry-run" in sys.argv
    force_resend = "--force-resend" in sys.argv
    try:
        rel = run_lifecycle("powerball", dry_run=dry_run, force_resend=force_resend)
    except Exception as e:
        # Excecao inesperada NUNCA vira verde. Foi assim que tres execucoes falharam em
        # 2026-08-10: o ledger tentou usar a CLI do Supabase, que so existe na maquina de
        # desenvolvimento, e o RuntimeError subiu ate aqui sem tratamento nenhum.
        print(f"\n🛑 FALHA INESPERADA: {type(e).__name__}: {e}")
        print("   PROVIDER_CALLS = 0 (a excecao ocorreu antes de qualquer envio)"
              if "send" not in str(e).lower() else "   VERIFICAR se houve chamada ao provedor")
        return 2

    print("\n" + "=" * 60)
    for k in ("resultReconciled", "notificationState", "providerCalls", "wouldSend", "reason"):
        print(f"  {k}: {rel.get(k)}")

    estado = rel.get("notificationState")
    if estado in ESTADOS_ATENCAO:
        print(f"  EXIT: 1 — '{estado}' exige atencao operacional")
        print("=" * 60)
        return 1
    if estado not in ESTADOS_OK:
        # Estado novo que ninguem classificou. Nao se assume que e benigno.
        print(f"  EXIT: 2 — estado NAO CLASSIFICADO: '{estado}'")
        print("=" * 60)
        return 2
    print(f"  EXIT: 0 — '{estado}' e um estado normal, nada a fazer")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
