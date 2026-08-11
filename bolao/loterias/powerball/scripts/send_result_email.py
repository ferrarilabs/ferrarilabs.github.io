#!/usr/bin/env python3
"""
send_result_email.py — Bolão Ferrari Lotteries (Powerball / Mega Millions)
Sends result email (PT only) to all participants after lottery drawing.

Supports multiple game types via gameType parameter in draw data:
  - "powerball": Powerball (red ball 1-35)
  - "megamillions": Mega Millions (gold ball 1-25)

Usage:
  python3 send_result_email.py --test-send [gameType]    # preview to admin (default: powerball)
  python3 send_result_email.py --send-all [gameType]     # broadcast to all participants
  python3 send_result_email.py --check-data [gameType]   # validate data before send

Email is sent ONLY if the draw has a completed result with winning tickets and prizes.
Business rule: only play next drawing if jackpot accumulates (configured per draw).
"""

import json, os, sys, time, urllib.request, urllib.parse, re, logging, subprocess
import sys as _sys
from pathlib import Path as _Path
# Formatador USD canônico compartilhado (BATCH 5) — ver bolao/shared/scripts/money.py
_sys.path.insert(0, str(_Path(__file__).parent.parent.parent.parent / "shared" / "scripts"))
import money as _money
from datetime import datetime
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
EMAILJS_URL   = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY   = "GBZFujsJBET6modve"
EMAILJS_SVC   = "service_o4hyzxr"
EMAILJS_TMPL  = "template_xq7yzzb"
ADMIN_EMAIL   = "emferrari@gmail.com"
# ORIGEM CANONICA. `ferrarilabs.github.io` responde 301 para `www.ferrarilabs.com` (CNAME na
# raiz do repo), entao o link antigo custava um salto extra a cada participante -- e alguns
# clientes de email tratam redirecionamento como sinal de phishing. Ver docs/bolao/TEST_ISOLATION.md.
SITE_URL      = "https://www.ferrarilabs.com/bolao/loterias/powerball/"

EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    # NAO trocar para www.ferrarilabs.com sem antes conferir a allowlist de dominios no painel
    # do EmailJS. Estes dois campos nao sao cosmeticos: o EmailJS valida a Origin contra os
    # dominios cadastrados, e um valor nao cadastrado faz a chamada ser recusada. O link visivel
    # ao participante (SITE_URL) ja usa a origem canonica -- estes headers sao outra decisao,
    # com outro risco, e mudam junto com a configuracao do painel.
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao/loterias/powerball/",
}

# ── Logging Setup ────────────────────────────────────────────────────────────
LOG_DIR = Path(__file__).parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / f"send_result_email_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)-8s | %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

logger.info("="*80)
logger.info("POWERBALL EMAIL SCRIPT STARTED")
logger.info("="*80)

# ── Supabase Config ──────────────────────────────────────────────────────────
SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
# CHAVE ANON PUBLICA (corrigida em 2026-08-11).
#
# Aqui existia um JWT MALFORMADO: cabecalho/payload de JWT com a chave publicavel colada no lugar
# da ASSINATURA, e com `ref` "cmhqkkfczatdnssupkni" -- um caractere diferente do projeto real
# ("cmhqkkfczotdnssupkni"). Medido: aquela chave devolve 401 em toda requisicao; esta devolve 200.
#
# O estrago nao era so o log de auditoria "falhando em silencio". Foi esse 401 que derrubou a
# LEITURA de participantes no Supabase e forcou o fallback para o segredo de ambiente -- o
# caminho que continha o defeito de superconjunto que impediu o e-mail do sorteio de 10/08 de
# sair para 15 pessoas. A chave quebrada estava a montante do incidente inteiro.
#
# Publica por construcao: vai em todo config.js servido ao navegador. Nao e segredo.
SUPABASE_ANON_KEY = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"

# ── Email routing overrides (for family/household groups) ──────────────────────
# When a user should receive email at a different address (e.g., a household
# member routed via another participant's inbox). Loaded from the
# POWERBALL_PRIVATE_PARTICIPANT_DATA secret's "_overrides" key (P0.1 PII hotfix,
# 2026-08) — this file is committed to a public repo and must never hardcode a
# real routing-override address.
def _load_email_overrides():
    raw = os.environ.get("POWERBALL_PRIVATE_PARTICIPANT_DATA", "")
    if not raw:
        return {}
    try:
        return json.loads(raw).get("_overrides", {})
    except Exception:
        return {}

PARTICIPANT_EMAIL_OVERRIDES = _load_email_overrides()

# ─── FONTE ÚNICA: js/data.js ────────────────────────────────────────────────────────────────
# Aqui existia uma CÓPIA HARDCODED dos sorteios, mantida à mão em paralelo ao js/data.js.
#
# Ela causou um envio errado real em 2026-08-09: a cópia ia só até o sorteio de 05/08, então
# `get_active_draw()` devolveu 05/08 e os 15 participantes receberam de novo o resultado do sorteio
# ANTERIOR (14-20-59-60-61 | PB 25, $16) em vez do de 08/08 (5-9-35-54-63 | PB 7, $24). A lista de
# destinatários também veio do sorteio errado.
#
# É EXATAMENTE a classe de falha que o CLAUDE.md deste repositório já registra para este mesmo
# arquivo no futebol: "send_result_email.py had silently drifted from the site's own scoring logic
# (CHANGELOG v4.57)". Duas cópias da mesma verdade divergem — é questão de tempo, não de cuidado.
#
# Agora os sorteios vêm do js/data.js, lido pelo Node (o arquivo é JavaScript de verdade: chaves sem
# aspas, comentários, vírgulas finais — nenhum parser JSON dá conta).
def _load_draws_from_data_js():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
    data_js = os.path.join(repo_root, "bolao", "loterias", "powerball", "js", "data.js")
    reader = (
        "const fs=require('fs'),vm=require('vm');const sb={window:{}};vm.createContext(sb);"
        "vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),sb);"
        "process.stdout.write(JSON.stringify(sb.window.POWERBALL_DRAWS||[]));"
    )
    out = subprocess.run(["node", "-e", reader, data_js], capture_output=True, text=True, timeout=20)
    if out.returncode != 0:
        raise RuntimeError(f"não consegui ler data.js: {out.stderr.strip()[:200]}")
    draws = json.loads(out.stdout)
    grouped = {}
    for d in draws:
        grouped.setdefault(d.get("gameType", "powerball"), []).append(d)
    return grouped

DRAWS = _load_draws_from_data_js()

def _mask(value):
    """Never log a raw email — first char + last char + length only (P0.2)."""
    if not value:
        return "(empty)"
    if len(value) <= 2:
        return "*" * len(value)
    return f"{value[0]}{'*' * (len(value) - 2)}{value[-1]} (len {len(value)})"

def get_active_draw(gameType="powerball"):
    """Get the latest completed draw for the given game type."""
    draws = DRAWS.get(gameType, [])
    for draw in reversed(draws):
        if draw.get("result") and draw["result"].get("numbers"):
            return draw
    return None

def load_participants_from_supabase(draw_id):
    """
    Load participant list from Supabase for the given draw.
    Centralizes user management — single source of truth for emails.
    Falls back to the private env var (POWERBALL_PRIVATE_PARTICIPANT_DATA) if Supabase is unavailable.
    """
    logger.info(f"Loading participants from Supabase for draw {draw_id}")
    try:
        # Query: get all users participating in this powerball draw
        # QUERY CODIFICADA. O subselect tem espaços ("SELECT id FROM bolao_types WHERE ...") e ia
        # cru na URL: o urllib recusava antes de qualquer rede e o script caía SEMPRE no fallback
        # do env privado, sem que ninguém percebesse. É a MESMA falha de encoding do
        # fetch_and_send_results.py — terceira ocorrência da mesma causa neste fluxo.
        # Consequência real: a lista de participantes vinha sempre do secret, que estava
        # desatualizado (14 de 15 — faltava quem entrou no sorteio mais recente).
        url = (
            f"{SUPABASE_URL}/rest/v1/user_bolao_participation?"
            + urllib.parse.urlencode({
                "select": "users(id,name,email)",
                "bolao_type_id": "in.(SELECT id FROM bolao_types WHERE code='powerball')",
                "bolao_draw_id": f"eq.{draw_id}",
                "status": "eq.active",
            })
        )
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Content-Type": "application/json"
            }
        )

        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())

        participants = []
        seen_emails = set()

        for record in data:
            if not record.get("users"):
                continue

            user = record["users"]
            name = user.get("name", "")
            email = user.get("email", "")

            if not name or not email:
                continue

            # Apply email overrides (e.g., Tatiana via Gustavo)
            if name in PARTICIPANT_EMAIL_OVERRIDES:
                email = PARTICIPANT_EMAIL_OVERRIDES[name]

            # Skip if email already added (avoid duplicates from household groups)
            if email in seen_emails:
                continue

            seen_emails.add(email)
            participants.append({"name": name, "email": email})

        logger.info(f"✓ Loaded {len(participants)} participants from Supabase for draw {draw_id}")
        audit_log("participants_loaded", "draw", draw_id, "success", {"source": "supabase", "count": len(participants)})
        return participants

    except Exception as e:
        logger.warning(f"⚠ Supabase unavailable: {e}")
        logger.info(f"  Falling back to private participant data (env var)...")
        return load_participants_from_private_env(draw_id)


def _normalize_name(name):
    """Deterministic normalization for the transitional name-based matching key
    (P0.2 gate): trim, collapse internal whitespace, casefold. Matching is by
    name because the private data has no stable participant ID yet — see
    docs/bolao/loterias/POWERBALL_PRIVATE_DATA_SECRET_CONTRACT.md
    (MATCHING_MODEL = TRANSITIONAL_NAME_BASED)."""
    return " ".join((name or "").split()).casefold()

def _expected_names_for_draw(draw_id):
    """Nomes que ESTE sorteio espera, segundo a fonte canonica (data.js).

    Mesma verdade que `expected_membership`, alcancavel a partir do `draw_id` sozinho -- o
    carregador de contatos so recebe o id, e precisa do conjunto esperado para nao resolver
    endereco de quem nao joga este sorteio.
    """
    for lista in DRAWS.values():
        for d in lista:
            if d.get("id") == draw_id:
                return {p["name"].strip() for p in (d.get("participants") or []) if p.get("name")}
    return set()

SUPPLEMENTARY_CONTACTS_ENV = "POWERBALL_PRIVATE_CONTACTS_EXTRA"


def _merge_supplementary_contacts(draw_entries, draw_id):
    """Contatos ADITIVOS, para quem entrou depois da ultima escrita do segredo principal.

    POR QUE ISTO EXISTE
    -------------------
    O segredo `POWERBALL_PRIVATE_PARTICIPANT_DATA` e a fonte canonica de contato, e um segredo do
    GitHub so pode ser ESCRITO, nunca lido. Para acrescentar uma pessoa seria preciso reescrever o
    valor inteiro -- e quem nao tem o conteudo atual apagaria todo mundo no processo.

    Foi exatamente o caso do participante que entrou em 11/08 no sorteio de 12/08: o preflight
    passou a reportar `RESOLVED = 8 de 9, MISSING = [<nome>]`, e o portao TUDO-OU-NADA bloquearia
    o e-mail de resultado para as nove pessoas.

    Aqui entra um segredo SUPLEMENTAR, com formato simples `{"Nome": "email"}`, que so ACRESCENTA:

      - o segredo principal SEMPRE vence em caso de conflito (esta e a fonte canonica);
      - so entram nomes que o sorteio realmente espera (mesma regra do filtro de participacao);
      - a ausencia do suplementar nao muda nada.

    NAO substitui a consolidacao no segredo principal -- e o caminho seguro para acrescentar sem
    poder ler. Quando o principal for reescrito com todo mundo, este pode ficar vazio.
    """
    bruto = (os.environ.get(SUPPLEMENTARY_CONTACTS_ENV) or "").strip()
    if not bruto:
        return draw_entries
    try:
        extra = json.loads(bruto)
    except Exception:
        logger.error(f"❌ {SUPPLEMENTARY_CONTACTS_ENV} nao e JSON valido — ignorado")
        return draw_entries
    if not isinstance(extra, dict):
        logger.error(f"❌ {SUPPLEMENTARY_CONTACTS_ENV} nao e um objeto — ignorado")
        return draw_entries

    esperados = {_normalize_name(n): n for n in _expected_names_for_draw(draw_id)}
    if not esperados:
        return draw_entries

    ja = {_normalize_name(n) for n in (draw_entries or {})}
    entrada = dict(draw_entries or {})
    acrescentados = 0
    for nome, email in extra.items():
        chave = _normalize_name(nome)
        if chave not in esperados:
            continue                      # nao joga este sorteio
        if chave in ja:
            continue                      # o segredo canonico ja resolve; ele vence
        if not isinstance(email, str) or "@" not in email:
            continue
        entrada[esperados[chave]] = {"email": email.strip()}
        acrescentados += 1

    if acrescentados:
        # Nome de exibicao apenas -- nunca o endereco.
        logger.info(f"✓ {acrescentados} contato(s) suplementar(es) aplicado(s) a {draw_id}")
        return entrada
    return draw_entries


def _short_hash(value):
    """Non-reversible short identifier for logs — never the raw name/email."""
    import hashlib
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()[:8]

def load_participants_from_private_env(draw_id):
    """
    Fallback: Load participant emails from the POWERBALL_PRIVATE_PARTICIPANT_DATA
    env var (a GitHub Actions secret injected only in CI) if Supabase is unavailable.

    data.js is PUBLIC (served directly to browsers on GitHub Pages) and no longer
    carries participant email/txId — those fields were removed in the P0.1 PII
    hotfix (2026-08). Emails now live only in this secret, never in a committed
    file. Names/cotas/status still come from data.js (that part is intentionally
    public); this function only supplies the email address per name.
    """
    logger.info(f"Loading participants from private env fallback for draw {draw_id}")
    raw = os.environ.get("POWERBALL_PRIVATE_PARTICIPANT_DATA", "")
    if not raw:
        logger.error("❌ POWERBALL_PRIVATE_PARTICIPANT_DATA not set — cannot fall back")
        audit_log("participants_load_failed", "draw", draw_id, "failed", {"source": "private_env"}, error_msg="env var not set")
        return []

    try:
        private_data = json.loads(raw)
        draw_entries = private_data.get(draw_id, {})

        # RESOLUCAO ENTRE SORTEIOS (2026-08-10).
        #
        # O segredo e {draw_id: {nome: {campos}}}. Quando um sorteio novo e criado no data.js e
        # ninguem acrescenta a entrada correspondente no segredo, este dict vem VAZIO -- e o
        # portao de completude, corretamente, bloqueia o envio inteiro. O sintoma e silencioso:
        # o preflight de 2026-08-10 reportou RESOLVED = 0 de 15 participantes.
        #
        # O e-mail de uma pessoa nao muda entre sorteios. Entao, para os nomes que este sorteio
        # espera e que nao estao na sua propria entrada, procura-se o endereco nas entradas dos
        # outros sorteios.
        #
        # FALHA FECHADA NA AMBIGUIDADE: se o mesmo nome aparece com enderecos DIFERENTES em
        # sorteios diferentes, nao se escolhe um. Nao ha como saber qual e o atual, e adivinhar
        # manda o resultado de dinheiro real para o endereco errado. O nome fica sem resolver e
        # o portao de completude faz o resto.
        if not draw_entries:
            logger.warning(
                f"⚠ Sem entrada propria para o sorteio {draw_id} no segredo — "
                f"resolvendo nomes pelos demais sorteios (endereco estavel por pessoa)")
            por_nome = {}
            ambiguos = set()
            for outro_id, entradas in private_data.items():
                if not isinstance(entradas, dict) or outro_id == draw_id:
                    continue
                for nome, campos in entradas.items():
                    if not isinstance(campos, dict):
                        continue
                    email = campos.get("email")
                    if not email:
                        continue
                    chave = _normalize_name(nome)
                    anterior = por_nome.get(chave)
                    if anterior and anterior[1].get("email") != email:
                        ambiguos.add(chave)
                    por_nome[chave] = (nome, campos)
            for chave in ambiguos:
                por_nome.pop(chave, None)
            if ambiguos:
                logger.error(
                    f"❌ {len(ambiguos)} nome(s) com endereco divergente entre sorteios "
                    f"(hashes: {[_short_hash(c) for c in ambiguos]}) — nao resolvidos de proposito")
            # SO OS NOMES DESTE SORTEIO (2026-08-11).
            #
            # Sem este filtro a resolucao cruzada devolve a UNIAO dos participantes de TODOS os
            # sorteios -- um superconjunto. Em 2026-08-10 ela trouxe 16 contatos para um sorteio de
            # 15 participantes, e o portao TUDO-OU-NADA do `build_send_plan` recusou o envio
            # inteiro com "1 contato(s) que NAO participam deste sorteio". Zero e-mails sairam.
            #
            # A intencao declarada acima sempre foi "para os nomes que ESTE sorteio espera,
            # procura-se o endereco nas entradas dos outros sorteios". O codigo e que nao
            # filtrava: resolvia todo nome que existisse em qualquer outro sorteio.
            #
            # O filtro e por nome esperado, nao por endereco: quem nao joga este sorteio nao pode
            # entrar no conjunto de destinatarios por nenhum caminho.
            esperados = {_normalize_name(n) for n in _expected_names_for_draw(draw_id)}
            if esperados:
                fora = [c for c in por_nome if c not in esperados]
                for chave in fora:
                    por_nome.pop(chave, None)
                if fora:
                    logger.info(
                        f"✓ {len(fora)} contato(s) de outros sorteios descartados — nao participam "
                        f"de {draw_id}")
            draw_entries = {nome: campos for nome, campos in por_nome.values()}
            logger.info(f"✓ {len(draw_entries)} nome(s) resolvidos por referencia cruzada")

        # SUPLEMENTO POR ULTIMO, e so para quem ainda ficou sem contato.
        #
        # A primeira versao aplicava isto ANTES, sobre `private_data`. Efeito medido em producao:
        # o sorteio de 12/08 nao tem entrada propria no segredo, entao o suplemento CRIAVA uma --
        # com uma pessoa so. `draw_entries` deixava de ser vazio, a resolucao entre sorteios era
        # PULADA, e o preflight caiu de 9/9 para 1/10. Acrescentar um contato apagou nove.
        #
        # O suplemento e aditivo de verdade: entra depois de todas as fontes canonicas terem
        # falado, e so onde ainda falta.
        draw_entries = _merge_supplementary_contacts(draw_entries, draw_id)

        # P0.2 gate: collision detection on the normalized matching key BEFORE
        # resolving any participant. Two distinct raw names that normalize to
        # the same key is a fail-closed condition for this draw's private
        # data — never guess which one is authoritative. Logs use a short
        # non-reversible hash, never the raw name.
        normalized_seen = {}
        collisions = []
        for raw_name in draw_entries.keys():
            key = _normalize_name(raw_name)
            if key in normalized_seen and normalized_seen[key] != raw_name:
                collisions.append(key)
            normalized_seen[key] = raw_name

        if collisions:
            logger.error(
                f"❌ Name collision in private data for draw {draw_id}: "
                f"{len(collisions)} normalized-key collision(s) "
                f"(hashes: {[_short_hash(c) for c in collisions]}) — refusing to load."
            )
            audit_log("participants_load_failed", "draw", draw_id, "failed",
                      {"source": "private_env", "reason": "name_collision", "count": len(collisions)})
            return []

        participants = []
        seen_emails = set()

        for name, fields in draw_entries.items():
            email = fields.get("email") if isinstance(fields, dict) else None

            # Apply email overrides (e.g., Tatiana via Gustavo) regardless of what's
            # in the private data for that name, same as the Supabase-loading path above.
            if name in PARTICIPANT_EMAIL_OVERRIDES:
                email = PARTICIPANT_EMAIL_OVERRIDES[name]

            if not email or email == "—":
                print(f"⚠ WARNING: participant (hash {_short_hash(name)}) email not found")
                continue

            if email in seen_emails:
                continue

            seen_emails.add(email)
            participants.append({"name": name, "email": email})

        logger.info(f"✓ Loaded {len(participants)} participants from private env for draw {draw_id}")
        audit_log("participants_loaded", "draw", draw_id, "success", {"source": "private_env", "count": len(participants)})
        return participants

    except Exception as e:
        logger.error(f"❌ Error loading participants from private env: {e}")
        audit_log("participants_load_failed", "draw", draw_id, "failed", {"source": "private_env"}, error_msg=str(e))
        return []

# Prize table (mirrors prizeTable in data.js exactly)
def get_prize(mainMatches, specialMatch, multiplier):
    if mainMatches == 5 and specialMatch:
        return {"label": "JACKPOT", "amount": None}
    if mainMatches == 5:
        return {"label": "5 acertos", "amount": 2000000}
    if mainMatches == 4 and specialMatch:
        return {"label": "4 + Powerball", "amount": 50000 * multiplier}
    if mainMatches == 4:
        return {"label": "4 acertos", "amount": 100 * multiplier}
    if mainMatches == 3 and specialMatch:
        return {"label": "3 + Powerball", "amount": 100 * multiplier}
    if mainMatches == 3:
        return {"label": "3 acertos", "amount": 7 * multiplier}
    if mainMatches == 2 and specialMatch:
        return {"label": "2 + Powerball", "amount": 7 * multiplier}
    if mainMatches == 1 and specialMatch:
        return {"label": "1 + Powerball", "amount": 4 * multiplier}
    if mainMatches == 0 and specialMatch:
        return {"label": "Powerball", "amount": 4 * multiplier}
    return None



def _derive_winning_tickets(draw):
    """Lista de bilhetes premiados, calculada a partir do sorteio e do resultado.

    Usa a MESMA `prizeTable` do js/data.js (via Node) — a regra de prêmio continua vivendo num
    lugar só. Devolve None se não der para calcular, para o chamador tratar como erro em vez de
    seguir com uma lista vazia que pareceria "nenhum ganhador".
    """
    result = draw.get("result") or {}
    if not result.get("numbers"):
        return None
    repo_root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
    data_js = os.path.join(repo_root, "bolao", "loterias", "powerball", "js", "data.js")
    script = """
const fs=require('fs'),vm=require('vm');const sb={window:{}};vm.createContext(sb);
vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),sb);
const draw = sb.window.POWERBALL_DRAWS.find(d => d.id === process.argv[1]);
if (!draw) { process.exit(1); }
const gt = sb.window.LOTTERY_GAME_TYPES[draw.gameType];
const off = draw.result; const out = [];
(draw.sharedTickets && draw.sharedTickets.series || []).forEach(s => (s.numeros||[]).forEach(str => {
  const m = String(str).match(/^([\\d\\s-]+?)\\s*—\\s*(?:PB|MB)\\s*(\\d+)$/);
  if (!m) return;
  const nums = m[1].trim().split(/[\\s-]+/).map(Number);
  const main = nums.filter(n => off.numbers.indexOf(n) !== -1).length;
  const sp = Number(m[2]) === off.special;
  const r = gt.prizeTable(main, sp, off.multiplier || 1);
  if (r && r.amount) out.push(str);
}));
process.stdout.write(JSON.stringify(out));
"""
    try:
        out = subprocess.run(["node", "-e", script, draw["id"], data_js],
                             capture_output=True, text=True, timeout=20)
        if out.returncode != 0:
            return None
        return json.loads(out.stdout)
    except Exception:
        return None



# ═══════════════════════════════════════════════════════════════════════════════════════════════
# CONTRATO DE PRÉ-ENVIO (P0, 2026-08-09)
#
# Em 2026-08-09 dois envios reais saíram errados: um com o resultado do sorteio ANTERIOR para 15
# pessoas, e o seguinte, já correto, para 14 de 15 — porque a fonte de CONTATOS tinha um a menos
# que a participação canônica do sorteio, e ninguém comparava as duas.
#
# A lição operacional é específica: um envio parcial é PIOR que nenhum envio. Ele parece bem
# sucedido, some do radar, e quem ficou de fora só descobre por acaso. Então a regra passou a ser
# TUDO-OU-NADA: a validação de destinatários acontece ANTES da primeira chamada ao provedor, e
# qualquer divergência resulta em ZERO envios.
#
# Também há um modelo de MODO explícito. Nunca mais um caminho onde "rodou" implica "mandou".
# ═══════════════════════════════════════════════════════════════════════════════════════════════

# Status terminais, legíveis por máquina. Um workflow que "passou" precisa dizer o que fez.
STATUS_SENT                 = "SUCCESS_SENT"
STATUS_NO_ACTION            = "SUCCESS_NO_ACTION"
STATUS_DRAW_NOT_FINAL       = "DRAW_NOT_FINAL"
STATUS_SOURCE_INVALID       = "SOURCE_INVALID"
STATUS_RECIPIENTS_INCOMPLETE = "RECIPIENT_SET_INCOMPLETE"
STATUS_CONTENT_FAILED       = "CONTENT_VALIDATION_FAILED"
STATUS_CONFIG_INVALID       = "CONFIGURATION_INVALID"
STATUS_SEND_DISABLED        = "SEND_DISABLED"
STATUS_DRY_RUN              = "DRY_RUN_OK"

MODE_DISABLED   = "disabled"
MODE_DRY_RUN    = "dry-run"
MODE_PRODUCTION = "production"


def resolve_send_mode(argv=None):
    """Modo de envio, FAIL CLOSED.

    Regras, em ordem:
      - `--dry-run` na linha de comando sempre vence (nunca envia);
      - modo de produção exige DUAS condições positivas e independentes:
        `POWERBALL_EMAIL_MODE=production` E `--send-all` explícito. Uma variável de ambiente
        solta não basta — foi um disparo por conveniência que causou o incidente;
      - rodando sob pytest/CI de teste: nunca produção;
      - qualquer coisa desconhecida ou ausente: dry-run.
    """
    argv = argv if argv is not None else sys.argv
    if "--dry-run" in argv:
        return MODE_DRY_RUN
    env = (os.environ.get("POWERBALL_EMAIL_MODE") or "").strip().lower()
    if env == MODE_DISABLED:
        return MODE_DISABLED
    # Um runner de teste NUNCA pode alcançar produção, mesmo com a env certa.
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("POWERBALL_TEST_RUN"):
        return MODE_DRY_RUN
    if env == MODE_PRODUCTION and "--send-all" in argv:
        return MODE_PRODUCTION
    return MODE_DRY_RUN


def expected_membership(draw):
    """Quem DEVERIA receber, segundo a participação canônica do sorteio.

    É diferente de "para quem conseguimos resolver um contato". Misturar as duas coisas foi
    exatamente o que produziu o envio 14/15.
    """
    return {p["name"].strip() for p in (draw.get("participants") or []) if p.get("name")}


def _sha(*parts):
    import hashlib
    return hashlib.sha256("|".join(str(x) for x in parts).encode("utf-8")).hexdigest()[:16]


def build_send_plan(draw, recipients, html=None):
    """Plano de envio determinístico + TODOS os gates. Nada chama o provedor antes disto.

    Devolve (plan, status, problems). `plan` nunca contém endereço: só contagens e hashes, porque
    ele é impresso em log de workflow.
    """
    problems = []

    # GATE 1/2 — identidade e finalidade do sorteio
    if not draw or not draw.get("id"):
        return None, STATUS_SOURCE_INVALID, ["sorteio alvo não identificado"]
    result = draw.get("result") or {}
    if not result.get("numbers"):
        return None, STATUS_DRAW_NOT_FINAL, [f"sorteio {draw['id']} ainda sem resultado oficial"]

    # GATE 3/4 — consistência do resultado com a fonte canônica (o data.js do site)
    canonical = next((d for d in DRAWS.get(draw.get("gameType", "powerball"), []) if d["id"] == draw["id"]), None)
    if canonical is None:
        problems.append(f"sorteio {draw['id']} não existe na fonte canônica")
    elif (canonical.get("result") or {}).get("numbers") != result.get("numbers"):
        problems.append("resultado divergente entre o alvo do envio e a fonte canônica do site")

    # GATE 5/6 — TUDO-OU-NADA de destinatários
    expected = expected_membership(canonical or draw)
    resolved = {r["name"].strip() for r in (recipients or []) if r.get("name")}
    missing = sorted(expected - resolved)
    extra = sorted(resolved - expected)
    if missing or extra:
        detail = []
        if missing:
            detail.append(f"{len(missing)} participante(s) do sorteio sem contato resolvido: {', '.join(missing)}")
        if extra:
            detail.append(f"{len(extra)} contato(s) que NÃO participam deste sorteio: {', '.join(extra)}")
        return None, STATUS_RECIPIENTS_INCOMPLETE, detail

    # Endereço duplicado enviaria a mesma pessoa duas vezes.
    addrs = [(r.get("email") or "").strip().lower() for r in recipients]
    if len(set(addrs)) != len(addrs):
        problems.append("há endereço de destinatário duplicado")
    if any(not a or "@" not in a for a in addrs):
        problems.append("há destinatário sem endereço válido")

    # GATE 7 — conteúdo bate com o sorteio
    if problems:
        return None, STATUS_CONTENT_FAILED, problems

    # GATE 11 — configuração do provedor
    if not (EMAILJS_KEY and EMAILJS_SVC and EMAILJS_TMPL):
        return None, STATUS_CONFIG_INVALID, ["configuração do EmailJS incompleta"]

    # GATE 8 — identidade de idempotência determinística
    result_hash = _sha(draw["id"], result.get("numbers"), result.get("special"), result.get("multiplier"))
    content_hash = _sha(result_hash, result.get("premiosGanhos"), len(recipients), html or "")
    plan = {
        "logicalSendId": _sha("powerball-result", draw["id"], result_hash),
        "targetDraw": draw["id"],
        "resultHash": result_hash,
        "contentHash": content_hash,
        "expectedRecipients": len(expected),
        "resolvedRecipients": len(resolved),
        "recipientSetHash": _sha(*sorted(expected)),
        "templateId": EMAILJS_TMPL,
    }
    return plan, None, []


def print_send_plan(plan, mode, status=None):
    """Imprime o plano SANITIZADO. Nenhum endereço, nunca."""
    print("\n" + "=" * 60)
    print(f"  PLANO DE ENVIO — modo: {mode}")
    if status:
        print(f"  STATUS: {status}")
    for k in ("targetDraw", "logicalSendId", "resultHash", "contentHash",
              "expectedRecipients", "resolvedRecipients", "recipientSetHash"):
        if plan and k in plan:
            print(f"  {k}: {plan[k]}")
    print("=" * 60 + "\n")


def validate_data(draw, participants=None):
    """Verify data consistency before any send."""
    if not draw:
        return ["❌ No completed draw found"]

    if not participants:
        participants = []

    errors = []

    if not draw.get("result", {}).get("numbers"):
        errors.append("❌ Result numbers not found")

    # `winningTickets` é DERIVÁVEL do sorteio + resultado; exigir que alguém o tenha digitado é
    # transformar dado calculável em pré-requisito manual. Os sorteios antigos, hardcoded, traziam
    # o campo pronto; os que vêm do data.js não — e foi isso que bloqueou o envio correto do 08/08
    # depois que a fonte passou a ser o data.js. Deriva aqui, e só reclama se NEM ASSIM der.
    if not draw.get("winningTickets"):
        derived = _derive_winning_tickets(draw)
        if derived is None:
            errors.append("⚠ No winning tickets marked and could not derive them")
        else:
            draw["winningTickets"] = derived

    missing_emails = [p["name"] for p in participants if not p["email"]]
    if missing_emails:
        errors.append(f"❌ MISSING EMAILS: {', '.join(missing_emails)}")

    if draw.get("result", {}).get("premiosGanhos") == 0:
        errors.append("⚠ Prêmios ganhos = $0 (verify calculation)")

    return errors


def audit_log(action, entity_type, entity_id, status, details=None, error_msg=None):
    """Log action to Supabase audit_log table."""
    try:
        payload = json.dumps({
            "action": action,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "performed_by": "send_result_email.py",
            "status": status,
            "details": details or {},
            "error_message": error_msg
        }).encode()

        url = f"{SUPABASE_URL}/rest/v1/audit_log"
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=5) as r:
            logger.debug(f"✓ Audited: {action} → {entity_type} {entity_id}")
    except Exception as e:
        logger.warning(f"⚠ Audit log failed (continuing): {e}")


def log_email_sent(recipient_email, recipient_name, subject, draw_id, status, details=None, error_msg=None):
    """Log email send to Supabase email_log table."""
    try:
        payload = json.dumps({
            "recipient_email": recipient_email,
            "recipient_name": recipient_name,
            "subject": subject,
            "bolao_type": "powerball",
            "draw_id": draw_id,
            "status": status,
            "error_reason": error_msg,
            "metadata": details or {}
        }).encode()

        url = f"{SUPABASE_URL}/rest/v1/email_log"
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=5) as r:
            logger.info(f"📧 Logged email to {recipient_email}: {status}")
    except Exception as e:
        logger.warning(f"⚠ Email log failed (continuing): {e}")


def fmtUsd(n):
    if n is None or n == 0:
        return "$0"
    # BATCH 5: formato USD canônico `US$ X.XX` (bolao/shared/scripts/money.py). Antes era
    # `${n:,.0f}` acima de 1000 e `${n}` abaixo — duas formas, ambas sem `US`, ambas sem centavos.
    return _money.usd(n)



# ── BOLAS VISUAIS NO EMAIL ────────────────────────────────────────────────────────────────────
# O Eduardo viu o email de resultado e pediu as bolas familiares no lugar do texto corrido
# ("5-9-35-54-63 · Powerball 7 · Power Play 3x").
#
# O caminho de entrega SUPORTA HTML: o EmailJS recebe `html_message` e o email já usa `<div>` com
# estilo inline. Não havia limitação técnica — só ninguém tinha feito.
#
# TÉCNICA: `<table>` com estilo INLINE, espelhando `ballCellHtml()` do render.mjs (que já foi
# validado em preview). Cliente de email não é navegador: flexbox, grid e folha externa são
# inconfiáveis; tabela com largura/altura fixa e `border-radius` é o denominador comum que o Gmail
# web, o Gmail mobile e os clientes genéricos renderizam.
#
# DEGRADAÇÃO: se o `border-radius` cair (cliente muito antigo), sobram quadrados com os números
# legíveis — a informação continua lá. E o `alt`/texto do resumo textual permanece para leitor de
# tela e para o fallback em texto puro.
_BALL_SIZE = 32
_PB_BALL_SIZE = 36
_PB_RED = "#CE1141"


def _ball_cell(value, size, background, color, border=None):
    border_css = f"border:1px solid {border};" if border else ""
    return (
        f'<td style="width:{size}px;height:{size}px;min-width:{size}px;text-align:center;'
        f'vertical-align:middle;padding:0;">'
        f'<div style="width:{size}px;height:{size}px;line-height:{size}px;border-radius:50%;'
        f'background:{background};{border_css}color:{color};font-size:13px;font-weight:bold;'
        f'text-align:center;font-family:Arial,Helvetica,sans-serif;">{value}</div></td>'
    )


def result_balls_html(numbers, special, multiplier, special_label="Powerball"):
    """Linha de bolas do resultado, segura para cliente de email."""
    spacer = '<td style="width:6px;min-width:6px;">&nbsp;</td>'
    cells = "".join(
        _ball_cell(n, _BALL_SIZE, "#f2f2f2", "#1a1a1a", "#cccccc") + spacer
        for n in sorted(numbers)
    )
    cells += _ball_cell(special, _PB_BALL_SIZE, _PB_RED, "#ffffff")
    row = ('<table role="presentation" cellpadding="0" cellspacing="0" '
           f'style="border-collapse:collapse;"><tr>{cells}</tr></table>')
    # Resumo textual ao lado das bolas: acessível a leitor de tela e sobrevive a qualquer
    # degradação de estilo. A informação nunca depende só do desenho.
    plain = f'{"-".join(str(n) for n in sorted(numbers))} · {special_label} {special}'
    caption = (f'<div style="font-size:11px;color:#666;margin-top:6px;">{plain}'
               f' · Power Play <strong>{multiplier}x</strong></div>')
    return row + caption


def build_html(draw):
    """Build result email in Portuguese (PT only)."""
    r = draw["result"]
    game_icon = "🔴" if draw["gameType"] == "powerball" else "🟡"
    game_label = "Powerball" if draw["gameType"] == "powerball" else "Mega Millions"

    nums_sorted = sorted(r["numbers"])
    special_label = "Powerball" if draw["gameType"] == "powerball" else "Mega Ball"
    result_line = f'{"-".join(str(n) for n in nums_sorted)}  ·  {special_label} {r["special"]}  ·  Power Play {r["multiplier"]}x'
    result_balls = result_balls_html(r["numbers"], r["special"], r["multiplier"], special_label)

    header_title = f"{game_icon} Loteria {game_label} — Resultado do Sorteio"
    header_date = draw["drawing"]["drawDateLabel"]
    intro_p1 = f"<p>O sorteio de <strong>{draw['drawing']['drawDateLabel']}</strong> foi finalizado. Confira o resultado oficial e seu resumo:</p>"
    result_label = "Resultado Oficial"
    winning_label = "Bilhetes Premiados"

    prize_section = f"""<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 14px;margin:16px 0;font-size:13px;line-height:1.6">
      <strong style="color:#16a34a">Resumo dos Prêmios</strong><br>
      Total ganho: <strong>{fmtUsd(r["premiosGanhos"])}</strong><br>
      {f"Detalhes: {', '.join(r['breakdown'])}" if r.get("breakdown") else ""}
    </div>"""
    no_prize = "Sem prêmios neste sorteio · Boa sorte na próxima!"

    winning_tickets_html = ""
    if draw.get("winningTickets"):
        winning_tickets_html = "<ul>" + "".join(
            f'<li style="color:#16a34a;font-weight:bold">{t}</li>'
            for t in draw["winningTickets"]
        ) + "</ul>"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.6">

<div style="background:#1a237e;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
  <h2 style="margin:0;font-size:22px">{header_title}</h2>
  <p style="margin:6px 0 0;opacity:0.9;font-size:13px">{header_date}</p>
</div>

<div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">

{intro_p1}

<div style="background:white;border:1px solid #cbd5e1;border-radius:6px;padding:14px;margin:16px 0">
  <div style="font-size:11px;color:#666;text-transform:uppercase;margin-bottom:6px">{result_label}</div>
  {result_balls}
</div>

{"" if not draw.get("winningTickets") else f'''<div style="background:white;border:1px solid #cbd5e1;border-radius:6px;padding:14px;margin:16px 0">
  <div style="font-size:11px;color:#666;text-transform:uppercase;margin-bottom:8px">{winning_label}</div>
  {winning_tickets_html}
</div>'''}

{prize_section if r["premiosGanhos"] > 0 else f'<p style="color:#666;font-style:italic">{no_prize}</p>'}

<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">

<p style="font-size:12px;color:#666">
  <a href="{SITE_URL}" style="color:#1a237e;font-weight:bold">Abrir página da loteria</a> para ver todos os detalhes, histórico de sorteios e suas cotas.
</p>

<p style="font-size:11px;color:#999;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px">
Ferrari Lotteries · {game_label}<br>
Resultado conferido: {r["checkedAt"]}
</p>

</div>
</body>
</html>"""


# Trava de último recurso, no ponto EXATO onde o provedor seria chamado. As checagens de gate
# acontecem antes, mas um caminho novo pode esquecer de passar por elas — este guard não pode ser
# esquecido, porque está no único lugar que fala com o EmailJS. Um teste que tente enviar de
# verdade falha aqui em vez de mandar email para gente real.
_SEND_AUTHORIZED = {"ok": False, "plan": None}


def authorize_send(plan, mode):
    """Libera o provedor. Só o caminho de broadcast, com plano validado E modo produção, chama isto."""
    _SEND_AUTHORIZED["ok"] = (mode == MODE_PRODUCTION and plan is not None)
    _SEND_AUTHORIZED["plan"] = plan
    return _SEND_AUTHORIZED["ok"]


def send_email(addr, subject, html, recipient_name="", draw_id=""):
    """Send via EmailJS. Subject uses "." instead of "/" to avoid HTML escaping in EmailJS template."""
    if not _SEND_AUTHORIZED["ok"]:
        msg = ("BLOQUEADO: chamada ao provedor sem plano de envio autorizado. "
               "Rode pelo caminho de broadcast (gates + modo produção explícito).")
        logger.error(f"❌ {msg}")
        return False, msg
    addr = addr.strip()

    # P0.2: logger writes to both stdout and a log file (which has been
    # accidentally committed before — see POWERBALL_PII_AUDIT.md §3) — never
    # put a raw email in a log line, mask it.
    logger.info(f"📤 Sending email to {_mask(addr)} [{recipient_name}]")

    if not addr or "@" not in addr:
        error = f"Invalid email: {_mask(addr)}"
        logger.error(f"❌ {error}")
        log_email_sent(addr, recipient_name, subject, draw_id, "failed", error_msg=error)
        return False, error

    body = json.dumps({
        "service_id": EMAILJS_SVC,
        "template_id": EMAILJS_TMPL,
        "user_id": EMAILJS_KEY,
        "template_params": {
            "to_email": addr,
            "entry_name": subject,
            "receipt_code": subject,
            "html_message": html,
        }
    }).encode()

    try:
        req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
        with urllib.request.urlopen(req, timeout=20) as r:
            status_code = r.status
            if status_code == 200:
                logger.info(f"✅ Email sent successfully to {_mask(addr)}")
                log_email_sent(addr, recipient_name, subject, draw_id, "sent", details={"http_status": status_code})
                audit_log("email_sent", "email", addr, "success", {"recipient": recipient_name, "draw_id": draw_id})
                return True, f"HTTP {status_code}"
            else:
                error = f"HTTP {status_code}"
                logger.warning(f"⚠ Email failed with {error}")
                log_email_sent(addr, recipient_name, subject, draw_id, "failed", details={"http_status": status_code}, error_msg=error)
                return False, error
    except Exception as e:
        error = str(e)
        logger.error(f"❌ Exception sending to {_mask(addr)}: {error}")
        log_email_sent(addr, recipient_name, subject, draw_id, "failed", error_msg=error)
        audit_log("email_failed", "email", addr, "failed", {"recipient": recipient_name, "error": error}, error_msg=error)
        return False, error


def run_test_send(gameType="powerball"):
    """Send preview to admin only — review before broadcast."""
    draw = get_active_draw(gameType)
    game_label = "Powerball" if gameType == "powerball" else "Mega Millions"

    print("\n" + "="*60)
    print(f"{game_label.upper()} RESULT EMAIL — PREVIEW TO ADMIN")
    print("="*60)

    if not draw:
        print("❌ No completed draw found for " + gameType)
        sys.exit(1)

    # Load ACTUAL participants from Supabase (with private-env fallback)
    participants = load_participants_from_supabase(draw["id"])

    errors = validate_data(draw, participants)
    if errors:
        print("\n⚠️  DATA ISSUES FOUND:\n")
        for err in errors:
            print(f"  {err}")
        print("\n⚠️  Review data in Supabase or the POWERBALL_PRIVATE_PARTICIPANT_DATA secret\n")

    print(f"\n📧 SENDING PREVIEW TO ADMIN: {ADMIN_EMAIL}")
    print(f"   Draw: {draw['drawing']['drawDateLabel']}")
    print(f"   Jackpot: ${draw['drawing']['jackpot']:,}")
    print()

    html = build_html(draw)
    subject = f"[TESTE] {game_label} — {draw['drawing']['drawDateLabel'].replace('/', '.')} — NÃO ENCAMINHAR"

    preview = f"""<div style="background:#fff3cd;border:2px solid #ffc107;padding:14px;border-radius:6px;margin-bottom:20px;font-weight:bold;color:#856404">
    ⚠️ TESTE — Este email foi enviado ao administrador para revisão antes de enviar para todos.
    Se você recebeu, é para REVISAR E APROVAR antes do envio real.
    </div>
    {html}
    """

    ok, msg = send_email(ADMIN_EMAIL, subject, preview, recipient_name="Admin (Preview)", draw_id=draw["id"])

    if ok:
        logger.info(f"✓ Preview enviado com sucesso para {ADMIN_EMAIL}")
        print(f"✓ Preview enviado com sucesso ({msg})")
        print(f"\n📋 Próximos passos:")
        print(f"   1. Confira seu email em {ADMIN_EMAIL}")
        print(f"   2. Revise o resultado, bilhetes premiados e cálculo de prêmios")
        print(f"   3. Se estiver correto, execute:")
        print(f"      python3 send_result_email.py --send-all {gameType}")
        print(f"   4. Se houver erros, corrija os dados e tente novamente\n")
    else:
        print(f"✗ Falha ao enviar preview: {msg}\n")
        sys.exit(1)


def run_send_all(gameType="powerball"):
    """Send to all participants."""
    draw = get_active_draw(gameType)
    game_label = "Powerball" if gameType == "powerball" else "Mega Millions"

    print("\n" + "="*60)
    print(f"{game_label.upper()} RESULT EMAIL — BROADCAST TO ALL PARTICIPANTS")
    print("="*60)

    if not draw:
        print("❌ No completed draw found for " + gameType)
        sys.exit(1)

    # Load ACTUAL participants from Supabase (with private-env fallback)
    recipients = load_participants_from_supabase(draw["id"])
    if not recipients:
        print(f"❌ No participants found (Supabase + private env fallback) for draw {draw['id']}\n")
        sys.exit(1)

    errors = validate_data(draw, recipients)
    if errors:
        print("\n❌ CANNOT SEND — DATA ISSUES FOUND:\n")
        for err in errors:
            print(f"  {err}")
        print(f"\nSTATUS: {STATUS_CONTENT_FAILED}\n")
        sys.exit(1)

    html = build_html(draw)

    # ── CONTRATO DE PRÉ-ENVIO — nada além daqui chama o provedor sem passar por isto ──
    mode = resolve_send_mode()
    plan, gate_status, gate_problems = build_send_plan(draw, recipients, html)
    if gate_status:
        print_send_plan(plan, mode, gate_status)
        for prob in gate_problems:
            print(f"  ❌ {prob}")
        if gate_status == STATUS_RECIPIENTS_INCOMPLETE:
            print("\n  REGRA TUDO-OU-NADA: zero emails enviados. Um envio parcial parece bem")
            print("  sucedido, some do radar, e quem ficou de fora só descobre por acaso.\n")
        print(f"STATUS: {gate_status}")
        sys.exit(1)

    print_send_plan(plan, mode)

    if mode != MODE_PRODUCTION:
        print(f"  WOULD_SEND para {plan['expectedRecipients']} destinatário(s) — nenhum email enviado.")
        print(f"STATUS: {STATUS_DRY_RUN if mode == MODE_DRY_RUN else STATUS_SEND_DISABLED}")
        return

    authorize_send(plan, mode)
    print(f"\n📧 ENVIANDO PARA {len(recipients)} PARTICIPANTES:")
    print()
    subject = f"⚽ Resultado {game_label} — {draw['drawing']['drawDateLabel'].replace('/', '.')}"

    logger.info(f"Starting broadcast to {len(recipients)} participants for draw {draw['id']}")
    audit_log("broadcast_started", "draw", draw['id'], "success", {"total_recipients": len(recipients)})

    sent, failed = 0, []
    for p in recipients:
        name, email = p["name"], p["email"]
        ok, msg = send_email(email, subject, html, recipient_name=name, draw_id=draw['id'])
        status = "✓" if ok else "✗"
        # P0.2: never print a raw email address to stdout/logs, even on send.
        print(f"  {status} {name:<30} {_mask(email)}")

        if ok:
            sent += 1
            time.sleep(2)  # EmailJS rate limit
        else:
            failed.append((name, email, msg))
            logger.warning(f"Email failed for {name} ({_mask(email)}): {msg}")

    print(f"\n{'='*60}")
    logger.info(f"Broadcast completed: {sent} sent, {len(failed)} failed")
    audit_log("broadcast_completed", "draw", draw['id'], "success" if len(failed) == 0 else "partial", {
        "sent": sent,
        "failed": len(failed),
        "total": len(recipients)
    })
    print(f"{'✓' if not failed else '⚠'} {sent} enviados, {len(failed)} falharam")
    print(f"STATUS: {STATUS_SENT if not failed else 'REAL_FAILURE'}")
    if failed:
        print(f"\nFalhas:")
        for name, email, msg in failed:
            print(f"  ✗ {name} ({_mask(email)}): {msg}")
        print()
        # P0.2: never declare success on a partial/silent-failure send.
        sys.exit(1)
    print()


def run_check_data(gameType="powerball"):
    """Validate data before any send."""
    draw = get_active_draw(gameType)
    print(f"\nDATA VALIDATION ({gameType}):")
    errors = validate_data(draw)
    if errors:
        print("\n❌ Problemas encontrados:\n")
        for err in errors:
            print(f"  {err}")
    else:
        print("✓ Todos os dados estão OK")
    print()


def main():
    args = sys.argv[1:]

    # Extract gameType from args (default: powerball)
    gameType = "powerball"
    if len(args) > 1:
        gameType = args[1]
    if gameType not in DRAWS:
        print(f"❌ Unknown game type: {gameType}")
        print(f"Available: {', '.join(DRAWS.keys())}\n")
        sys.exit(1)

    try:
        if "--test-send" in args:
            run_test_send(gameType)
        elif "--send-all" in args:
            run_send_all(gameType)
        elif "--check-data" in args:
            run_check_data(gameType)
        else:
            print(__doc__)
            sys.exit(1)
    finally:
        logger.info("="*80)
        logger.info(f"SCRIPT COMPLETED | Logs saved to: {LOG_FILE}")
        logger.info("="*80)
        print(f"\n📋 Logs: {LOG_FILE}")


if __name__ == "__main__":
    main()
