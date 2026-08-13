"""
send_round_email.py — Bolão Brasileirão 2026 round-completion email.

Sends ONE batched email per round instead of one per game (BR2026 has ~380 games across
38 rounds — emailing per game would mean ~380 sends/season; batching per round cuts that
to ~38). Requested by Eduardo, 2026-07-16 ("vamos fazer emails apos cada rodada finalizar
para economizar no envio").

Why "round" here means a rolling window, not a numbered rodada 1-38: ESPN's site API for
bra.1 does not expose a round/week number per event, and real testing (fetching the full
2026 schedule and trying to reconstruct rounds by date-clustering AND by round-robin
structure) showed the actual calendar is too irregular to trust either approach — postponed
games, mid-week catch-up fixtures around the 2026 World Cup break, etc. produced clusters as
large as 39 games. Eduardo confirmed (2026-07-16) to use a rolling window instead of a
hardcoded round calendar: whichever games are the earliest not-yet-covered by a previous
batch, plus everything within BATCH_WINDOW_DAYS of that game's date, are treated as "the
current round". Once every game in that batch is complete, the batch is emailed and closed.

BATCH_WINDOW_DAYS was originally 7 -- too wide once the season's actual fixture density is
accounted for. Real incident (2026-07-26, Eduardo: "a rodada acabou hoje e o email não foi
enviado"): the round that finished 2026-07-25/26 (10 games) opened a batch with a 7-day
window reaching to 2026-08-01, which also swept in the *next* round's 10 games (2026-07-29,
only ~3 days after the previous round ended) plus 4 rescheduled/postponed games dated the
same week -- so the batch needed all 20 to finish, holding the already-completed round's
email hostage to games that hadn't been played yet. Measured against the entire real 2026
schedule (not guessed): worst-case within-round span across all 41 rounds is 52 hours;
tightest real gap from one round's first game to the next round's first game is 69 hours.
2.5 days (60 hours) sits safely between both with margin on each side.

Usage:
  python3 send_round_email.py --auto        # checks ESPN, sends if a batch just completed,
                                             # idempotent otherwise. Run via
                                             # .github/workflows/br2026_round_emails.yml on a cron.
  python3 send_round_email.py --test-send   # sends a real preview to the admin only (real
                                             # recent results + real standings + Eduardo's own
                                             # entry's actual score/rank), subject line and
                                             # body both marked [TESTE]. Never touches
                                             # Supabase state -- safe to run any time.
"""

import os
import sys
import urllib.error
import json
import os, sys, time, urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, __file__.rsplit("/", 1)[0])
sys.path.insert(0, os.path.join(__file__.rsplit("/", 1)[0], "..", "..", "shared", "scripts"))
import audit_scoring  # same directory — score_entry() mirrors app.js scoreEntry()
import subject_policy as _subject_policy  # politica UNICA de icone de assunto (shared/scripts)

# ── CAMINHO CANONICO (F1/F2/F6) ────────────────────────────────────────────────────────────────
# A janela rolante deixou de decidir elegibilidade. Quem decide agora:
#   build_round_manifest  -> identidade canonica de rodada, com proveniencia oficial
#   round_state           -> resolver por rodada, independente das demais
#   legacy_round_state    -> traducao do estado antigo (evidencia, nunca trava)
#   round_notification_ledger -> disposicao duravel por rodada e por destinatario
import build_round_manifest as MANIFEST
import round_state as ROUNDSTATE
import legacy_round_state as LEGACY
from round_notification_ledger import (
    RoundLedger, MemoryRoundLedgerRepo, ROUND_STATE, RECIPIENT_STATE,
    round_key, recipient_set_hash, fixture_set_hash, stable_hash, DELIVERY_SEMANTICS,
    CLAIMABLE_STATES,
)

# ── Config (mirrors bolao/br2026/js/config.js) ────────────────────────────────
SUPABASE_URL   = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY       = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
STATE_ID       = "br2026"

EMAILJS_URL    = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY    = "GBZFujsJBET6modve"
EMAILJS_SVC    = "service_o4hyzxr"
EMAILJS_TMPL   = "template_xq7yzzb"   # participant — body is only {{{html_message}}}
ADMIN_EMAIL    = "emferrari@gmail.com"

ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard"
ESPN_STANDINGS  = "https://site.api.espn.com/apis/v2/sports/soccer/bra.1/standings"

EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao/br2026/",
}

BATCH_WINDOW_DAYS = 2.5   # how far past the earliest uncovered game a "round" batch extends -- see module docstring
FETCH_LOOKBACK_DAYS = 3
FETCH_LOOKAHEAD_DAYS = 14


# ── ESPN ─────────────────────────────────────────────────────────────────────
def _espn_get(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def fetch_scoreboard_window(date_from, date_to):
    """Games between two datetime.date objects (inclusive), mirrors js fetchScoreboard()
    field usage but keeps the raw ESPN shape needed here (id, date, teams, state, score)."""
    ds = date_from.strftime("%Y%m%d")
    de = date_to.strftime("%Y%m%d")
    data = _espn_get(f"{ESPN_SCOREBOARD}?dates={ds}-{de}&limit=500")
    games = {}
    for e in data.get("events", []):
        comp = (e.get("competitions") or [{}])[0]
        status = (comp.get("status") or {}).get("type", {})
        competitors = comp.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), {})
        away = next((c for c in competitors if c.get("homeAway") == "away"), {})
        games[e["id"]] = {
            "id":        e["id"],
            "date":      datetime.strptime(e["date"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc),
            "home":      home.get("team", {}).get("displayName", ""),
            "away":      away.get("team", {}).get("displayName", ""),
            "completed": bool(status.get("completed")),
            "goalsHome": home.get("score"),
            "goalsAway": away.get("score"),
            # Status bruto preservado: colapsar tudo em `completed` apagava a distincao entre
            # "ainda vai acontecer" e "adiado indefinidamente" -- que e exatamente a distincao
            # que travou a R21 e escondeu a R22. O resolver canonico precisa do nome do status.
            "statusName": status.get("name"),
            "statusState": status.get("state"),
        }
    return games


def fetch_standings():
    """Mirrors fetchStandings() in bolao/br2026/js/app.js — same stat names, same
    rank -> gd -> gf -> name tiebreak, same G4/SA6/Z4 slicing by the caller."""
    data = _espn_get(ESPN_STANDINGS)
    entries = (((data.get("children") or [{}])[0]).get("standings") or {}).get("entries", [])

    def get_stat(stats, *names):
        for nm in names:
            for s in stats:
                if s.get("name") == nm:
                    return s.get("value") or 0
        return 0

    parsed = []
    for e in entries:
        stats = e.get("stats") or []
        name = (e.get("team") or {}).get("displayName", "")
        if not name:
            continue
        parsed.append({
            "name":   name,
            "rank":   get_stat(stats, "rank") or 99,
            "gd":     get_stat(stats, "pointDifferential", "goalDifferential"),
            "gf":     get_stat(stats, "pointsFor", "goalsFor"),
        })
    parsed.sort(key=lambda t: (t["rank"], -t["gd"], -t["gf"], t["name"]))
    return parsed


# ── Scoring / ranking (mirrors app.js scoreEntry()/rankEntries()) ────────────
def count_exact(entry, result, key):
    picks = (entry.get("picks") or {}).get(key, [])
    if not result:
        return 0
    return sum(1 for i, name in enumerate(result) if i < len(picks) and picks[i] == name)


def count_sa6_hits(entry, sa6_result):
    picks = (entry.get("picks") or {}).get("sa6", [])
    sa6_set = set(sa6_result or [])
    return sum(1 for t in picks if t and t in sa6_set)


def rank_entries(entries, g4, z4, sa6):
    """Mirrors rankEntries() in bolao/br2026/js/app.js exactly, including the reverse-alpha
    final tiebreak (b.localeCompare(a), not a.localeCompare(b) — matches the JS as written)."""
    scored = []
    for e in entries:
        sc = audit_scoring.score_entry(e, g4, z4, sa6) or {"total": 0, "detail": None}
        scored.append({"entry": e, **sc})

    def sort_key(item):
        e = item["entry"]
        return (
            -item["total"],
            -count_sa6_hits(e, sa6),
            -count_exact(e, g4, "g4"),
            -count_exact(e, z4, "z4"),
        )
    # Final tiebreak: entryName reverse-alpha, applied as a stable secondary sort since
    # Python's sort_key can't express localeCompare(a,b) direction inline cleanly.
    scored.sort(key=lambda it: it["entry"].get("entryName", ""), reverse=True)
    scored.sort(key=sort_key)

    ranked, rank, prev_key = [], 0, None
    for i, item in enumerate(scored):
        e = item["entry"]
        key = (item["total"], count_sa6_hits(e, sa6), count_exact(e, g4, "g4"), count_exact(e, z4, "z4"))
        if key != prev_key:
            rank = i + 1
            prev_key = key
        ranked.append({**item, "rank": rank})
    return ranked


def _self_check_rank_entries():
    """rank_entries() transcribes app.js rankEntries()'s tiebreak cascade by hand, including
    the final reverse-alpha entryName tiebreak — bolao/br2026/scripts/audit_scoring.py's own
    check_tiebreak_order() explicitly does NOT verify that last step (its docstring says so).
    Since this script trusts rank_entries() enough to put a participant's rank in an email,
    verify the one case the shared audit doesn't cover before sending anything."""
    g4 = ["Flamengo", "Palmeiras", "Botafogo", "Fortaleza"]
    entry_a = {"id": "a", "entryName": "Alice", "picks": {"g4": g4[:], "z4": [], "sa6": []}}
    entry_c = {"id": "c", "entryName": "Carol", "picks": {"g4": g4[:], "z4": [], "sa6": []}}
    ranked = rank_entries([entry_a, entry_c], g4, [], [])
    by_id = {r["entry"]["id"]: r for r in ranked}
    if by_id["a"]["rank"] != by_id["c"]["rank"]:
        return False, f"identical entries should tie in rank, got a={by_id['a']['rank']} c={by_id['c']['rank']}"
    order = [r["entry"]["id"] for r in ranked]
    if order != ["c", "a"]:
        return False, f"reverse-alpha final tiebreak expected [c, a], got {order}"
    return True, ""


# ── Supabase ───────────────────────────────────────────────────────────────────
def sb_fetch():
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state?id=eq.{STATE_ID}&select=state",
        headers={"apikey": _service_key(), "Authorization": f"Bearer {_service_key()}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        rows = json.loads(r.read())
        return rows[0]["state"] if rows else {}


def _service_key():
    """A credencial PRIVILEGIADA, so do ambiente. Nunca impressa, nunca em argv, nunca em arquivo."""
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — gravacao exige runtime confiavel.")
        sys.exit(2)
    return k


def sb_append_audit(action, detail, client_ref):
    """Acrescenta UMA entrada de auditoria, do lado do servidor.

    Isto era `sb_upsert(state)`: regravava o DOCUMENTO INTEIRO, com a chave anon PUBLICA, num cron
    DIARIO, para acrescentar uma linha de log. O unico campo de negocio que mudava era `auditLog`
    (+ meta.updatedAt, que `_bolao_touch` ja faz no servidor).

    Duas consequencias, e as duas eram reais:
      1. era um gravador de documento inteiro sem token de concorrencia -- qualquer coisa gravada
         entre a leitura e o POST sumia;
      2. rodava com a chave que vai em todo navegador, entao nao era "automacao servidor" em
         sentido nenhum -- era o mesmo acesso que qualquer visitante tem.

    Alem disso, desde que as policies do br2026 sairam, este caminho ja estava MORTO: a leitura
    devolvia 0 linhas e a gravacao era negada. Nao esta a ser consertado um job que funcionava.
    """
    k = _service_key()
    body = json.dumps({"p_pool_id": STATE_ID, "p_action": action,
                       "p_detail": detail, "p_client_ref": client_ref}).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/op_append_audit", data=body, method="POST",
        headers={"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        print(f"🛑 HTTP {e.code}: {e.read().decode()[:300]}")
        sys.exit(2)


def append_audit_log(state, action, detail):
    if not isinstance(state.get("auditLog"), list):
        state["auditLog"] = []
    state["auditLog"].insert(0, {
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "action": action, "admin": True, "detail": detail,
    })
    state["auditLog"] = state["auditLog"][:200]


# ── Email content ──────────────────────────────────────────────────────────────
def _fmt_date_range(start, end):
    if start.date() == end.date():
        return start.strftime("%d/%m")
    return f"{start.strftime('%d/%m')}–{end.strftime('%d/%m')}"


def _fmt_date_range_subject(start, end):
    # Subject-only variant: no "/" (the EmailJS template's Subject field renders entry_name/
    # receipt_code through double-brace {{}} interpolation — unlike the body, which correctly
    # uses {{{html_message}}} — so it HTML-escapes "/" to "&#x2F;". A subject line is plain
    # text, never HTML-decoded by mail clients, so the escaped entity showed up literally
    # (Eduardo, 2026-07-24). Using "." instead of "/" sidesteps it without touching the
    # EmailJS dashboard template. Body text keeps the "/" format via _fmt_date_range — HTML
    # rendering there is unaffected.
    if start.date() == end.date():
        return start.strftime("%d.%m")
    return f"{start.strftime('%d.%m')}–{end.strftime('%d.%m')}"


def build_round_results_html(batch_games):
    rows = ""
    for g in sorted(batch_games, key=lambda x: x["date"]):
        rows += (f'<tr><td style="padding:6px 10px;border-bottom:1px solid #2a3a4a">{g["home"]}</td>'
                  f'<td style="padding:6px 10px;border-bottom:1px solid #2a3a4a;text-align:center;color:#6cf">'
                  f'{g["goalsHome"]} × {g["goalsAway"]}</td>'
                  f'<td style="padding:6px 10px;border-bottom:1px solid #2a3a4a">{g["away"]}</td></tr>')
    return f"""<table style="width:100%;border-collapse:collapse;font-size:13px">
  <tbody>{rows}</tbody>
</table>"""


def build_standings_html(g4, z4, sa6):
    def col(title, teams, color):
        items = "".join(f"<li>{t}</li>" for t in teams)
        return f'<div><b style="color:{color}">{title}</b><ol style="margin:4px 0 0;padding-left:18px">{items}</ol></div>'
    return f"""<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
  {col("🏆 G4", g4, "#2fe56e")}
  {col("🟡 Sul-Americana", sa6, "#f59e0b")}
  {col("⬇️ Z4", z4, "#ff6b6b")}
</div>"""


def build_participant_email_html(window_label, results_html, standings_html, entry, rank_info):
    total = rank_info["total"]
    rank = rank_info["rank"]
    movement = rank_info.get("movement")
    if movement is None:
        mov_html = ""
    elif movement > 0:
        mov_html = f' <span style="color:#2fe56e">↑{movement}</span>'
    elif movement < 0:
        mov_html = f' <span style="color:#ff6b6b">↓{abs(movement)}</span>'
    else:
        mov_html = ' <span style="color:#9cb2b9">=</span>'
    return f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d1b26;color:#e0e8f0;padding:24px;border-radius:10px">
<h2 style="margin-top:0;color:#2fe56e">⚽ Rodada {window_label} — resultados</h2>
<p><b>{entry.get("entryName","")}</b>, aqui está o resumo da rodada:</p>
<h3 style="margin-bottom:6px">Jogos da rodada</h3>
{results_html}
<h3 style="margin-bottom:6px;margin-top:20px">Classificação atual</h3>
{standings_html}
<div style="margin-top:20px;padding:14px;background:#07151c;border-radius:8px">
  <b>Seu desempenho</b><br>
  {total} pts — {rank}º lugar geral{mov_html}
</div>
<p style="margin-top:24px;font-size:12px;color:#667">Pontuação provisória, calculada com a tabela atual do Brasileirão — só é definitiva no encerramento da competição.</p>
</div>"""


def build_admin_summary_html(window_label, results_html, standings_html, sent_count):
    return f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d1b26;color:#e0e8f0;padding:24px;border-radius:10px">
<h2 style="margin-top:0;color:#2fe56e">⚽ Rodada {window_label} — email de rodada enviado</h2>
<p>Enviado para {sent_count} participante(s).</p>
<h3 style="margin-bottom:6px">Jogos da rodada</h3>
{results_html}
<h3 style="margin-bottom:6px;margin-top:20px">Classificação atual</h3>
{standings_html}
</div>"""


# ─── AUD-02 (auditoria 2026-08-09): TRANSPORTE REAL FALHA FECHADO ───────────────────────────
#
# O sender do Powerball já tinha trava (`_SEND_AUTHORIZED` + detecção de pytest). Este não tinha
# NADA: bastava executar o script — num teste, numa máquina local, por engano — para o provedor
# ser chamado de verdade e a mensagem chegar em gente real. Este repositório já viveu isso: um
# envio errado saiu para 15 pessoas.
#
# AUTORIZAÇÃO POSITIVA, não heurística negativa. O envio real só acontece quando alguém DECLARA
# que quer, via variável de ambiente, e a declaração vive no workflow de produção — não no código.
# Assim o padrão de qualquer execução não declarada (teste, CI, local, interativa) é: não envia.
#
# `_TRANSPORT` existe para o teste exercitar toda a lógica de montagem/envio sem rede: injetando
# um transporte falso, o caminho inteiro roda e nada sai. Sem ele, um teste que quisesse cobrir
# essa lógica teria de alcançar o provedor — que é exatamente o que não pode acontecer.
_TRANSPORT = None          # teste injeta um callable(url, body, headers) -> (status, texto)
_ALLOW_ENV = "BOLAO_ALLOW_REAL_SEND"
_ALLOW_TOKEN = "I UNDERSTAND"


def real_send_allowed():
    """(permitido, motivo). Fail-closed: só True com autorização explícita e fora de teste."""
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("BOLAO_TEST_RUN"):
        return False, "processo de teste"
    if os.environ.get(_ALLOW_ENV) == _ALLOW_TOKEN:
        return True, None
    return False, f"sem autorizacao explicita ({_ALLOW_ENV})"


def send_email(addr, subject, html):
    # AUD-02: portão ANTES de qualquer chamada ao provedor. Zero chamadas quando bloqueado.
    if _TRANSPORT is None:
        allowed, why = real_send_allowed()
        if not allowed:
            msg = f"EMAIL_SEND_BLOCKED: {why}. Nenhuma mensagem enviada."
            print(f"BLOQUEADO {msg}")
            return False, msg
    body = json.dumps({
        "service_id": EMAILJS_SVC, "template_id": EMAILJS_TMPL, "user_id": EMAILJS_KEY,
        "template_params": {
            "to_email": addr, "entry_name": subject, "receipt_code": subject,
            "html_message": html,
        }
    }).encode()
    # AUD-02: transporte injetável — o teste exercita todo o caminho sem tocar na rede.
    if _TRANSPORT is not None:
        return _TRANSPORT(EMAILJS_URL, body, EMAILJS_HEADERS)
    req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


# ── Batch management ───────────────────────────────────────────────────────────
def _iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def _parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# `get_or_open_batch()` foi REMOVIDA aqui (F6, 2026-08-10).
#
# Ela era o coracao do modelo de janela rolante: um unico `pendingBatch` global definido por
# proximidade de datas. Em 29/07 abriu um lote com 4 jogos adiados indefinidamente e travou --
# e por ser global, impediu que qualquer rodada posterior fosse sequer avaliada. A R22 terminou
# 10/10 em 09/08 e ficou invisivel atras dela por 12 dias.
#
# Elegibilidade agora vem do manifesto canonico + resolver por rodada + ledger duravel. O estado
# legado (`sentBatches`, `sentGameIds`, `pendingBatch`) e traduzido por `legacy_round_state.py`
# como EVIDENCIA historica, para nao reenviar o que ja foi comunicado -- nunca como trava.
#
# Deixar a funcao aqui como codigo morto seria pior que remove-la: ela parece autoritativa.


# ─── SUPABASE: ledger duravel de rodada ────────────────────────────────────────────────────────
#
# Enquanto a migracao 010_notification_durability.sql nao for aplicada em producao (F7, bloqueado
# por credencial administrativa), a disposicao por rodada e persistida dentro do proprio
# `bolao_state`, sob `roundEmail.ledger`. Isso ja e DURAVEL -- sobrevive ao runner efemero do
# GitHub Actions, que era o problema original do outbox em arquivo.
#
# O que ele ainda NAO tem e atomicidade de reivindicacao no banco: o claim aqui e read-modify-write
# sobre um documento JSON. Duas execucoes exatamente simultaneas poderiam ambas reivindicar. O
# workflow usa `concurrency: br2026-round-emails` com `cancel-in-progress: false`, o que serializa
# as execucoes agendadas e reduz muito a janela -- mas nao a fecha. A trava real e o
# `for update skip locked` da RPC, e migrar para ela e a primeira coisa a fazer quando a
# autenticacao existir. Registrado como risco residual, nao como resolvido.
class SupabaseStateRoundLedgerRepo:
    """FALLBACK HISTORICO. Persiste em `bolao_state.roundEmail.ledger` (JSON).

    E duravel -- sobrevive ao runner efemero do GitHub Actions -- mas NAO e atomico: o claim e
    read-modify-write sobre um documento. Duas execucoes exatamente simultaneas poderiam ambas
    reivindicar.

    Desde F7 (2026-08-10) o caminho canonico e `AtomicNotifRepo`, que usa as RPCs do Postgres com
    `for update skip locked`. Este repositorio permanece apenas como leitura de evidencia
    historica e como fallback de DEGRADACAO -- e envio real com ele e PROIBIDO
    (ver `atomic_ledger_available()`).
    """

    def __init__(self, state):
        self._state = state
        self._ledger = state.setdefault("roundEmail", {}).setdefault("ledger", {})

    def get(self, key):
        v = self._ledger.get(key)
        return json.loads(json.dumps(v)) if v is not None else None

    def put(self, key, record):
        self._ledger[key] = json.loads(json.dumps(record))

    def list_by_prefix(self, prefix):
        return [json.loads(json.dumps(v)) for k, v in self._ledger.items() if k.startswith(prefix)]

    def claim_atomic(self, key, owner, lease_until, now_ms):
        rec = self._ledger.get(key)
        if rec is None or (rec.get("leaseUntil") and rec["leaseUntil"] > now_ms):
            return None
        # Mesma regra do repositorio canonico: PARTIAL/FAILED sao retentaveis, SENT e
        # NEEDS_MANUAL_REVIEW nao. Ver CLAIMABLE_STATES em round_notification_ledger.py.
        if rec.get("state") not in CLAIMABLE_STATES:
            return None
        nxt = dict(rec, state="CLAIMED", claimedBy=owner, leaseUntil=lease_until, updatedAt=now_ms)
        self._ledger[key] = nxt
        return json.loads(json.dumps(nxt))


# ─── REPOSITORIO ATOMICO (F7) ──────────────────────────────────────────────────────────────────
#
# Fala com `bolao_notif_jobs` EXCLUSIVAMENTE pelas RPCs `security definer` da migracao 010.
# Nenhum SELECT direto na tabela: a RLS nao tem policy alguma, entao leitura direta com a anon
# key devolve lista vazia -- e um repositorio que "nao encontra nada" e pior que um que falha,
# porque pareceria autorizar reenvio.
#
# A atomicidade do claim vem de `for update skip locked` DENTRO da RPC, no banco. Nunca deste
# codigo Python.
def _ledger_key():
    """Credencial do ledger de notificacao. NUNCA impressa.

    N24 (2026-08-10): as RPCs de notificacao deixaram de ser executaveis por `anon` -- a anon key
    e publica e permitia a qualquer um marcar notificacao como enviada, suprimindo o e-mail de
    resultado. O caminho confiavel usa SUPABASE_SERVICE_ROLE_KEY, que so existe no runner.
    Sem ela a chamada falha FECHADA, que e o desfecho correto: sem credencial nao ha ledger, e
    sem ledger nao se envia.
    """
    return (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip() or ANON_KEY


def _rpc(name, args):
    body = json.dumps(args).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{name}", data=body, method="POST",
        headers={"apikey": _ledger_key(), "Authorization": f"Bearer {_ledger_key()}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def atomic_ledger_available():
    """(disponivel, motivo). Envio real EXIGE isto -- ver REAL_SEND_REQUIRES_ATOMIC_LEDGER."""
    try:
        _rpc("bolao_notif_health", {"p_pool_id": "br2026"})
        return True, None
    except Exception as e:
        return False, f"{type(e).__name__}: {str(e)[:80]}"


# Mapeia o status do banco para o vocabulario do resolver canonico.
_STATUS_MAP = {
    "sent": "SENT", "processing": "SENDING", "pending": "OPEN",
    "failed_retryable": "OPEN", "failed_permanent": "FAILED", "suppressed": "SENT",
}


def notification_states_from_atomic():
    """Estado por rodada lido do ledger ATOMICO. Levanta se indisponivel -- nunca devolve vazio.

    Um dicionario vazio seria interpretado como "nenhuma rodada foi notificada", e o
    reconciliador proporia reenviar a temporada inteira. Falhar alto e a unica resposta segura.
    """
    rows = _rpc("bolao_notif_status_by_pool", {"p_pool_id": "br2026"})
    if rows is None:
        raise RuntimeError("ledger atomico indisponivel: RPC nao respondeu")
    return {r["idempotency_key"]: {"status": _STATUS_MAP.get(r["status"], "OPEN"),
                                   "source": "ATOMIC_LEDGER"}
            for r in rows}


# Estado do ledger de RODADA (JSON, em bolao_state.roundEmail.ledger) traduzido para o
# vocabulario do reconciliador.
_ROUND_LEDGER_STATUS_MAP = {
    ROUND_STATE["SENT"]: "SENT",
    ROUND_STATE["PARTIAL"]: "PARTIAL",
    ROUND_STATE["SENDING"]: "SENDING",
    ROUND_STATE["CLAIMED"]: "SENDING",
    ROUND_STATE["NEEDS_MANUAL_REVIEW"]: "SENDING",   # nunca reenvia sozinho
}


def notification_states_from_round_ledger(ledger, manifest):
    """Disposicao por rodada segundo o ledger que REALMENTE registrou o envio (2026-08-11).

    O ledger atomico (`bolao_notif_status_by_pool`) nao tem linha nenhuma para o BR2026: nada
    enfileira rodada la. Quem registra a entrega e o `RoundLedger` sobre
    `bolao_state.roundEmail.ledger` -- duravel, mas invisivel para o reconciliador.

    Consequencia observada em producao logo apos o envio da R22: a rodada continuava aparecendo
    como ROUND_READY_TO_NOTIFY e como CANDIDATO em toda execucao. O reenvio so nao acontecia
    porque o `claim` recusa estado terminal -- ou seja, a protecao contra duplicata estava
    dependendo do ultimo portao, e nao da primeira decisao.

    Mesclar isto e seguro por construcao: so ACRESCENTA estados terminais, e um estado terminal
    a mais so pode IMPEDIR envio, nunca provocar um.
    """
    estados = {}
    for r in manifest["rounds"]:
        rec = ledger.get(r["roundNumber"])
        if not rec:
            continue
        traduzido = _ROUND_LEDGER_STATUS_MAP.get(rec.get("state"))
        if traduzido:
            estados[rec["idempotencyKey"]] = {"status": traduzido, "source": "ROUND_LEDGER"}
    return estados


def _observations_for_round(round_def, raw_games):
    """Observacoes de uma rodada, incluindo rejogo de jogo adiado."""
    ids = set(round_def["canonicalFixtureIds"]) | set((round_def.get("replacements") or {}).values())
    now_iso = datetime.now(timezone.utc).isoformat()
    obs = {}
    for fid in ids:
        g = raw_games.get(fid)
        if not g:
            continue
        obs[fid] = {
            "state": g.get("statusState") or ("post" if g["completed"] else "in"),
            "completed": g["completed"],
            "statusName": g.get("statusName") or ("STATUS_FULL_TIME" if g["completed"] else "STATUS_UNKNOWN"),
            "observedAt": now_iso,
            "terminalAt": g["date"].isoformat() if g["completed"] else None,
            "_game": g,
        }
    return obs


def _emit(event):
    """Evento operacional estruturado. Sem e-mail, nome, pagador ou transacao."""
    print("EVENT " + json.dumps(event, sort_keys=True, ensure_ascii=False))


def run_auto(dry_run=False):
    """Caminho canonico de reconciliacao de rodada.

    manifesto canonico -> estado por rodada (independente) -> elegibilidade -> conteudo ->
    completude de destinatarios -> hashes -> ledger duravel -> claim -> envio -> disposicao.

    `dry_run=True` percorre TUDO isso e para antes da primeira chamada ao provedor. Nao e um
    caminho paralelo: e o mesmo codigo, o que e o ponto -- um preview que roda por outro caminho
    nao prova nada sobre o caminho que envia.
    """
    modo = "DRY-RUN" if dry_run else "AUTO"
    print(f"{modo} — auto-auditoria de scoring antes de qualquer coisa...")
    audit_ok, _ = audit_scoring.run_static_audit(verbose=not dry_run)
    ok2, detail2 = _self_check_rank_entries()
    if not (audit_ok and ok2):
        print("\n🛑 SELF-AUDIT FAILED — nenhum envio ate isso ser corrigido.")
        sys.exit(1)
    print("✓ Auto-auditoria passou.\n")

    manifest = MANIFEST.load()
    problemas = MANIFEST.validate(manifest)
    if problemas:
        print("🛑 MANIFESTO CANONICO INVALIDO — abortando:", problemas)
        sys.exit(1)
    print(f"✓ Manifesto canonico valido: {len(manifest['rounds'])} rodadas, "
          f"proveniencia oficial com {len(manifest['officialProvenance']['anchors'])} ancoras.\n")

    state = sb_fetch()
    legacy = state.get("roundEmail") or {}

    repo = SupabaseStateRoundLedgerRepo(state)
    ledger = RoundLedger(repo, now=lambda: int(datetime.now(timezone.utc).timestamp() * 1000),
                         log=_emit)

    # ── LEDGER ATOMICO E A FONTE CANONICA (F7) ─────────────────────────────────────────────────
    #
    # O JSON legado permanece como evidencia historica, mas quem responde "esta rodada ja foi
    # notificada?" e o banco. Se o ledger atomico estiver indisponivel, o envio real e PROIBIDO:
    # decidir reenvio a partir de um estado que nao conseguimos ler e como se duplica e-mail para
    # gente real.
    atomic_ok, atomic_why = atomic_ledger_available()
    print(f"LEDGER ATOMICO: {'disponivel' if atomic_ok else 'INDISPONIVEL — ' + str(atomic_why)}")
    if not atomic_ok and not dry_run:
        print("🛑 REAL_SEND_REQUIRES_ATOMIC_LEDGER: envio real bloqueado sem o ledger atomico.")
        sys.exit(1)

    # ── LEASES EXPIRADOS, ANTES DE QUALQUER DECISAO (2026-08-11) ───────────────────────────────
    #
    # `recover_expired_leases()` existia, era testado isoladamente e NENHUM caminho de producao o
    # chamava. Um mecanismo de seguranca que ninguem executa nao e seguranca -- e um comentario
    # caro. Consequencia real: um runner que morresse no meio do envio deixava a rodada em
    # SENDING para sempre. SENDING nao e reivindicavel (e correto: pode ter havido entrega), e
    # como nada recuperava o lease, aquela rodada nunca mais seria tocada por execucao nenhuma.
    #
    # Aqui, uma vez por execucao e antes de escolher candidatos: lease vencido em CLAIMED volta
    # para READY (nada saiu), e lease vencido em SENDING vira NEEDS_MANUAL_REVIEW com os
    # destinatarios pendentes marcados UNCERTAIN -- nunca reenvio automatico.
    recuperados = ledger.recover_expired_leases()
    if recuperados:
        print(f"LEASES EXPIRADOS RECUPERADOS: {len(recuperados)} "
              f"({[r['idempotencyKey'].split(':')[-2] for r in recuperados]})")

    notif_states = {}
    migrated, mig = LEGACY.migrate(legacy, manifest)
    notif_states.update(migrated)
    if atomic_ok:
        notif_states.update(notification_states_from_atomic())
    # POR ULTIMO: o ledger que efetivamente registrou a entrega desta rodada. Ver a docstring --
    # sem isto, uma rodada JA ENVIADA continua sendo proposta como candidata em toda execucao.
    notif_states.update(notification_states_from_round_ledger(ledger, manifest))

    print(f"Migracao do legado: SENT={mig['roundsMarkedSent']} "
          f"PRE_FEATURE={len(mig['roundsPreFeature'])} "
          f"pendingBatch={mig['legacyPendingBatchDisposition']}\n")

    now = datetime.now(timezone.utc)
    relevantes = [r for r in manifest["rounds"]
                  if datetime.fromisoformat(r["dateRangeUtc"][0]) <= now][-RECONCILE_WINDOW:]

    lo = min(datetime.fromisoformat(r["dateRangeUtc"][0]) for r in relevantes).date() - timedelta(days=2)
    raw = fetch_scoreboard_window(lo, (now + timedelta(days=1)).date())

    all_obs = {}
    for r in relevantes:
        all_obs.update(_observations_for_round(r, raw))

    out = ROUNDSTATE.reconcile({"rounds": relevantes}, all_obs, notif_states, now=now)

    print("RECONCILIACAO")
    for e in out["evaluated"]:
        f = e["facts"]
        print(f"  R{e['roundNumber']:<3} {e['state']:<38} "
              f"final={f.get('finalCount','-')}/{f.get('expectedCount','-')} "
              f"adiados={f.get('postponedCount','-')}")
    candidatos = [c["roundNumber"] for c in out["candidates"]]
    print(f"\nCANDIDATOS: {candidatos or 'nenhum'}\n")

    if not out["candidates"]:
        print("Nenhuma rodada elegivel. Nada a fazer.")
        return {"candidates": [], "providerCalls": 0}

    resultados = []
    for cand in out["candidates"]:
        resultados.append(_process_round(cand, manifest, all_obs, state, ledger, dry_run))

    if not dry_run:
        sb_append_audit('round-email', {'rounds': len(resultados)},
                         f"round-email:{datetime.now(timezone.utc).date().isoformat()}")
    return {"candidates": candidatos, "rounds": resultados,
            "providerCalls": sum(r["providerCalls"] for r in resultados)}


RECONCILE_WINDOW = 6   # rodadas recentes avaliadas por execucao


# Estados de destinatario que e SEGURO (re)enviar.
#
# ACCEPTED fica de fora: o provedor ja aceitou, reenviar duplica e-mail de dinheiro real.
# UNCERTAIN fica de fora: pode ter havido entrega; a decisao e humana, nao um retry.
REENVIAVEL = (RECIPIENT_STATE["PENDING"], RECIPIENT_STATE["FAILED"])


def alvos_reenviaveis(resolvidos, estado_por_ref):
    """Quem ainda pode receber, nesta tentativa.

    Funcao PURA e separada de proposito: enquanto a selecao vivia embutida no laco, a unica
    forma de exercita-la era por `_process_round`, e ali o portao de `claim` mascarava o
    resultado -- uma mutacao que trocava a selecao por "manda para todos" continuava verde,
    porque o claim ja tinha barrado a segunda execucao antes de a selecao importar. Um gate que
    nao enxerga a propria mutacao que existe para impedir nao e um gate.

    Lista vazia significa NADA A ENVIAR. Nunca "entao manda para todos": foi esse `or` que
    reenviou o resultado do Powerball para as 15 pessoas do sorteio de 08/08.
    """
    return [e for e in resolvidos if estado_por_ref.get(e["id"]) in REENVIAVEL]


def _process_round(cand, manifest, all_obs, state, ledger, dry_run):
    n = cand["roundNumber"]
    round_def = next(r for r in manifest["rounds"] if r["roundNumber"] == n)

    games = []
    for fid in round_def["canonicalFixtureIds"]:
        eff = (round_def.get("replacements") or {}).get(fid, fid)
        g = (all_obs.get(eff) or all_obs.get(fid) or {}).get("_game")
        if g:
            games.append(g)

    standings = fetch_standings()
    if len(standings) < 20:
        print(f"  R{n}: classificacao incompleta ({len(standings)}/20) — bloqueado.")
        return {"round": n, "wouldSend": False, "providerCalls": 0, "blocked": "STANDINGS_INCOMPLETE"}

    g4 = [t["name"] for t in standings[0:4]]
    z4 = [t["name"] for t in standings[16:20]]
    sa6 = [t["name"] for t in standings[6:12]]

    deleted = set(state.get("deletedIds") or [])
    entries = [e for e in state.get("entries", []) if e.get("id") not in deleted]
    ranked = rank_entries(entries, g4, z4, sa6)
    rank_by_id = {r["entry"]["id"]: r for r in ranked}

    resolved = [e for e in entries
                if "@" in (e.get("participantEmail") or "").strip() and rank_by_id.get(e["id"])]
    entry_refs = [e["id"] for e in resolved]

    results_html = build_round_results_html(games)
    standings_html = build_standings_html(g4, z4, sa6)
    content_hash = stable_hash(results_html + standings_html)

    job = ledger.ensure_job(n, len(entries), entry_refs, content_hash,
                            round_def["canonicalFixtureIds"])

    portao = ledger.assert_recipient_completeness(n)
    if not portao["ok"]:
        print(f"  🛑 R{n}: RECIPIENT_SET_INCOMPLETE "
              f"({portao['resolved']}/{portao['expected']}) — ZERO chamadas ao provedor.")
        return {"round": n, "wouldSend": False, "providerCalls": 0,
                "blocked": "RECIPIENT_SET_INCOMPLETE", "idempotencyKey": job["idempotencyKey"]}

    resumo = {
        "round": n,
        "idempotencyKey": job["idempotencyKey"],
        "ledgerState": job["state"],
        "expectedRecipients": len(entries),
        "resolvedRecipients": len(resolved),
        "recipientSetComplete": True,
        "recipientSetHash": job["recipientSetHash"],
        "contentHash": job["contentHash"],
        "fixtureSetHash": job["fixtureSetHash"],
        "expectedMatches": cand["facts"]["expectedCount"],
        "finalMatches": cand["facts"]["finalCount"],
        "nonTerminalMatches": cand["facts"]["nonTerminalCount"],
        "wouldSend": True,
        "providerCalls": 0,
    }

    if dry_run:
        # PARA AQUI. Nenhuma transicao que sugira entrega, nenhuma chamada ao provedor.
        _emit({"eventType": "dry_run_preflight", **resumo})
        return resumo

    # ── PORTAO DE TRANSPORTE, ANTES DE REIVINDICAR ─────────────────────────────────────────
    #
    # Descobrir que o transporte esta bloqueado DEPOIS do claim/mark_sending deixaria a rodada
    # presa em SENDING sem que uma unica mensagem tivesse sido tentada. SENDING nao e reenviavel
    # por desenho (vira UNCERTAIN), entao seria preciso uma pessoa para destravar uma rodada que
    # nunca chegou perto do provedor. O portao vem antes de qualquer transicao de estado.
    permitido, porque_bloqueio = real_send_allowed()
    if _TRANSPORT is None and not permitido:
        print(f"  R{n}: TRANSPORTE_BLOQUEADO ({porque_bloqueio}) — ZERO chamadas ao provedor, "
              f"ledger intocado.")
        return {**resumo, "wouldSend": False, "providerCalls": 0, "blocked": "TRANSPORT_BLOCKED"}

    if not ledger.claim(n, f"gh-actions-{os.environ.get('GITHUB_RUN_ID', 'local')}"):
        # `claim` recusa por dois motivos MUITO diferentes: outra execucao esta com o lease, ou o
        # job ja esta num estado terminal. Reportar os dois como "ja reivindicada por outra
        # execucao" mandou eu procurar uma corrida que nao existia, logo depois do envio da R22.
        estado = (ledger.get(n) or {}).get("state")
        if estado in (ROUND_STATE["SENT"], ROUND_STATE["NEEDS_MANUAL_REVIEW"]):
            motivo, rotulo = f"ja concluida ({estado})", "ALREADY_COMPLETED"
        else:
            motivo, rotulo = "lease ativo de outra execucao", "ALREADY_CLAIMED"
        print(f"  R{n}: {motivo} — pulando, zero chamadas ao provedor.")
        return {**resumo, "wouldSend": False, "providerCalls": 0, "blocked": rotulo}

    ledger.mark_sending(n)

    # ── ORFAOS DE UMA EXECUCAO ANTERIOR ────────────────────────────────────────────────────
    #
    # Um dono anterior pode ter morrido ENTRE a chamada ao provedor e o registro do desfecho.
    # Nesse caso o destinatario ficou em SENDING e a unica leitura honesta e UNCERTAIN: pode ter
    # recebido. Reenviar "por via das duvidas" e o que duplica e-mail de dinheiro real; e por
    # isso que UNCERTAIN sai do conjunto reenviavel e vai para revisao humana.
    reg = ledger.get(n)
    for r in reg["recipients"]:
        if r["state"] == RECIPIENT_STATE["SENDING"]:
            ledger.record_recipient(n, r["entryRef"], RECIPIENT_STATE["UNCERTAIN"],
                                    error="transporte interrompido: desfecho desconhecido")

    # ── SO QUEM E SEGURO ENVIAR ────────────────────────────────────────────────────────────
    #
    # ACCEPTED nunca reenvia. UNCERTAIN nunca reenvia automaticamente. Sobra PENDING (nunca
    # tentado) e FAILED (falhou de forma reenviavel). Lista vazia NAO significa "manda para
    # todos" -- significa que nao ha nada a fazer, e o job se conclui a partir do estado por
    # destinatario. Essa confusao (`or todos`) foi exatamente o defeito que reenviou o e-mail
    # do Powerball para 15 pessoas.
    reg = ledger.get(n)
    estado_por_ref = {r["entryRef"]: r["state"] for r in reg["recipients"]}
    alvos = alvos_reenviaveis(resolved, estado_por_ref)

    if not alvos:
        final = ledger.settle(n)
        print(f"  R{n}: nada pendente — conclusao reconstruida do estado ({final['state']}).")
        return {**resumo, "wouldSend": False, "providerCalls": 0,
                "ledgerState": final["state"], "accepted": 0, "failed": 0, "uncertain": 0}

    ini = datetime.fromisoformat(round_def["dateRangeUtc"][0])
    fim = datetime.fromisoformat(round_def["dateRangeUtc"][1])
    window_label = _fmt_date_range(ini, fim)
    assunto = _subject_policy.assunto(
        "FUTEBOL_RESULTADO_RODADA",
        f"Rodada {_fmt_date_range_subject(ini, fim)} — resultados e classificação")

    provider_calls = aceitos = falhados = incertos = 0
    print(f"  R{n}: enviando para {len(alvos)} destinatario(s) "
          f"(de {len(resolved)} resolvidos; os demais ja tem desfecho registrado)")

    for e in alvos:
        ref = e["id"]
        html = build_participant_email_html(window_label, results_html, standings_html,
                                            e, rank_by_id[ref])
        # SENDING ANTES da chamada. Se o processo morrer agora, a proxima execucao encontra
        # SENDING e o reconcilia para UNCERTAIN -- nunca para "reenviar".
        ledger.record_recipient(n, ref, RECIPIENT_STATE["SENDING"])
        try:
            saida = send_email((e.get("participantEmail") or "").strip(), assunto, html)
        except Exception as exc:
            # Excecao DEPOIS de POST enviado: nao da para saber se o provedor aceitou.
            provider_calls += 1
            incertos += 1
            ledger.record_recipient(n, ref, RECIPIENT_STATE["UNCERTAIN"],
                                    error=f"{type(exc).__name__}: {str(exc)[:160]}")
            print(f"    ? {rank_by_id[ref]['entry'].get('entryName','')}: INCERTO ({type(exc).__name__})")
            continue

        # `send_email` devolve (False, motivo) quando o portao bloqueia -- ai o provedor NAO foi
        # tocado -- e um status HTTP inteiro quando tocou. Contar a intencao em vez do efeito foi
        # o defeito que fez o ciclo do Powerball relatar 15 chamadas tendo feito zero.
        bloqueado = isinstance(saida, tuple) and saida[0] is False
        if bloqueado:
            falhados += 1
            ledger.record_recipient(n, ref, RECIPIENT_STATE["FAILED"], error=str(saida[1])[:160])
            continue

        provider_calls += 1
        status = saida[0] if isinstance(saida, tuple) else saida
        if isinstance(status, int) and 200 <= status < 300:
            aceitos += 1
            ledger.record_recipient(n, ref, RECIPIENT_STATE["ACCEPTED"], provider_message_id=str(status))
            print(f"    ✓ {rank_by_id[ref]['entry'].get('entryName','')}")
        else:
            falhados += 1
            ledger.record_recipient(n, ref, RECIPIENT_STATE["FAILED"], error=f"HTTP {status}")
            print(f"    ✗ {rank_by_id[ref]['entry'].get('entryName','')}: HTTP {status}")

    final = ledger.settle(n)
    resultado = {**resumo, "providerCalls": provider_calls, "ledgerState": final["state"],
                 "accepted": aceitos, "failed": falhados, "uncertain": incertos}
    _emit({"eventType": "round_send_completed", **resultado})
    print(f"\nNOTIFICATION_RUN app=br2026 round={n} roundComplete=true "
          f"expected={len(entries)} targeted={len(alvos)} providerCalls={provider_calls} "
          f"accepted={aceitos} failed={falhados} uncertain={incertos} "
          f"status={final['state']} key={job['idempotencyKey']}")
    return resultado


def run_test_send():
    """Sends a real preview to ADMIN_EMAIL only, so Eduardo can proofread the actual format
    before it ever reaches participants. Uses real data throughout (recent completed games,
    real standings, Eduardo's own entry's real score/rank) -- never touches Supabase state."""
    print("TEST-SEND — running scoring/ranking self-audit before touching anything...")
    audit_ok, _ = audit_scoring.run_static_audit(verbose=True)
    ok2, detail2 = _self_check_rank_entries()
    print(f"  {'✓' if ok2 else '✗ FAIL'} rank_entries() reverse-alpha tiebreak" + (f" — {detail2}" if not ok2 else ""))
    if not (audit_ok and ok2):
        print("\n🛑 SELF-AUDIT FAILED — refusing to send even a test email until this is fixed.")
        sys.exit(1)
    print("✓ Self-audit passed.\n")

    print("TEST-SEND — fetching Supabase state...")
    state = sb_fetch()

    now = datetime.now(timezone.utc)
    # Use the most recently COMPLETED window as sample content -- the real pending batch
    # (future games) has no results yet, so it wouldn't make a representative preview.
    # Widened lookback (was 14 days) because the season paused for the 2026 World Cup and
    # resumed July 16 -- the last real completed games are from before the break.
    completed = []
    for lookback_days in (14, 60, 200):
        fetch_from = (now - timedelta(days=lookback_days)).date()
        fetch_to = now.date()
        print(f"TEST-SEND — fetching ESPN scoreboard {fetch_from} .. {fetch_to} for sample results...")
        games_by_id = fetch_scoreboard_window(fetch_from, fetch_to)
        completed = sorted([g for g in games_by_id.values() if g["completed"]], key=lambda g: g["date"])
        if completed:
            break
    if not completed:
        print("No completed games found in ESPN's data at all — nothing to preview with.")
        sys.exit(1)
    sample_games = completed[-10:]  # most recent batch-sized slice
    window_start = sample_games[0]["date"]
    window_end = sample_games[-1]["date"]
    print(f"  Using {len(sample_games)} recent game(s) as sample results ({window_start.date()} .. {window_end.date()})")

    standings = fetch_standings()
    if len(standings) < 20:
        print(f"🛑 Only {len(standings)} teams in standings (expected 20) — cannot build a real preview.")
        sys.exit(1)
    g4 = [t["name"] for t in standings[0:4]]
    z4 = [t["name"] for t in standings[16:20]]
    sa6 = [t["name"] for t in standings[6:12]]

    window_label = _fmt_date_range(window_start, window_end) + " (AMOSTRA)"
    window_label_subject = _fmt_date_range_subject(window_start, window_end) + " (AMOSTRA)"
    results_html = build_round_results_html(sample_games)
    standings_html = build_standings_html(g4, z4, sa6)

    deleted_ids = set(state.get("deletedIds") or [])
    entries = [e for e in state.get("entries", []) if e.get("id") not in deleted_ids]
    eduardo = next((e for e in entries if (e.get("participantEmail") or "").strip().lower() == ADMIN_EMAIL.lower()), None)
    if not eduardo:
        print(f"🛑 No entry found with participantEmail == {ADMIN_EMAIL} — cannot build a personalized preview.")
        sys.exit(1)

    ranked_now = rank_entries(entries, g4, z4, sa6)
    r = next((x for x in ranked_now if x["entry"]["id"] == eduardo["id"]), None)

    html = build_participant_email_html(window_label, results_html, standings_html, eduardo,
                                         {"total": r["total"], "rank": r["rank"], "movement": None})
    html = (
        '<div style="background:#f59e0b;color:#000;padding:10px 16px;border-radius:8px;'
        'font-weight:900;margin-bottom:14px;text-align:center">⚠️ TESTE — não é a rodada real. '
        'Resultados de amostra (últimos jogos), não do lote pendente.</div>'
    ) + html
    subject = f"[TESTE] Rodada {window_label_subject} — resultados e classificação"
    status = send_email(ADMIN_EMAIL, subject, html)
    print(f"\n✓ Test email sent to {ADMIN_EMAIL} (HTTP {status}). Supabase untouched.")


def main():
    args = sys.argv[1:]
    if "--test-send" in args:
        run_test_send()
        return
    if "--dry-run" in args:
        run_auto(dry_run=True)
        return
    if "--auto" not in args:
        print(__doc__)
        sys.exit(1)
    run_auto()


if __name__ == "__main__":
    main()
