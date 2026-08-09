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

import json
import os, sys, time, urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import audit_scoring  # same directory — score_entry() mirrors app.js scoreEntry()

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
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        rows = json.loads(r.read())
        return rows[0]["state"] if rows else {}


def sb_upsert(state):
    if "meta" not in state or not isinstance(state["meta"], dict):
        state["meta"] = {}
    state["meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
    body = json.dumps({"id": STATE_ID, "state": state}).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state", data=body, method="POST",
        headers={
            "apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}",
            "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates",
        }
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status


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


def get_or_open_batch(state, games_by_id):
    round_email = state.setdefault("roundEmail", {})
    pending = round_email.get("pendingBatch")
    if pending:
        return pending, False

    covered = set(round_email.get("sentGameIds") or [])
    candidates = sorted(
        (g for g in games_by_id.values() if g["id"] not in covered),
        key=lambda g: g["date"]
    )
    if not candidates:
        return None, False

    window_start = candidates[0]["date"]
    window_end = window_start + timedelta(days=BATCH_WINDOW_DAYS)
    batch_games = [g for g in candidates if window_start <= g["date"] <= window_end]

    pending = {
        "windowStart": _iso(window_start),
        "windowEnd":   _iso(window_end),
        "gameIds":     [g["id"] for g in batch_games],
    }
    round_email["pendingBatch"] = pending
    return pending, True


def run_auto():
    print("AUTO — running scoring/ranking self-audit before touching anything...")
    audit_ok, _ = audit_scoring.run_static_audit(verbose=True)
    ok2, detail2 = _self_check_rank_entries()
    print(f"  {'✓' if ok2 else '✗ FAIL'} rank_entries() reverse-alpha tiebreak" + (f" — {detail2}" if not ok2 else ""))
    if not (audit_ok and ok2):
        print("\n🛑 SELF-AUDIT FAILED — refusing to send any emails until this is fixed.")
        sys.exit(1)
    print("✓ Self-audit passed.\n")

    print("AUTO — fetching Supabase state...")
    state = sb_fetch()

    now = datetime.now(timezone.utc)
    fetch_from = (now - timedelta(days=FETCH_LOOKBACK_DAYS)).date()
    fetch_to = (now + timedelta(days=FETCH_LOOKAHEAD_DAYS)).date()
    print(f"AUTO — fetching ESPN scoreboard {fetch_from} .. {fetch_to}...")
    games_by_id = fetch_scoreboard_window(fetch_from, fetch_to)
    print(f"  {len(games_by_id)} game(s) in window")

    batch, just_opened = get_or_open_batch(state, games_by_id)
    if batch is None:
        print("No upcoming games found in window. Nothing to do.")
        return

    if just_opened:
        print(f"Opened new round batch: {batch['windowStart']} .. {batch['windowEnd']} "
              f"({len(batch['gameIds'])} games)")
        sb_upsert(state)
        print("Saved pending batch. Will check completion on future runs.")
        return

    # Batch already open from a previous run — re-fetch the exact window (may fall outside
    # the narrow lookback/lookahead window used above if a cron cycle was missed) to check
    # completion reliably.
    win_start = _parse_iso(batch["windowStart"])
    win_end = _parse_iso(batch["windowEnd"])
    if win_start.date() < fetch_from or win_end.date() > fetch_to:
        print("Batch window outside default fetch range — re-fetching exact window...")
        games_by_id = fetch_scoreboard_window(win_start.date(), win_end.date())

    batch_games = [games_by_id[gid] for gid in batch["gameIds"] if gid in games_by_id]
    if len(batch_games) != len(batch["gameIds"]):
        print(f"WARN: only found {len(batch_games)}/{len(batch['gameIds'])} batch games in "
              f"ESPN response — will retry next run.")
        return

    if not all(g["completed"] for g in batch_games):
        pending_count = sum(1 for g in batch_games if not g["completed"])
        print(f"Batch not complete yet — {pending_count}/{len(batch_games)} game(s) still pending.")
        return

    print(f"All {len(batch_games)} game(s) in batch completed. Confirming stability after 20s...")
    time.sleep(20)
    games_confirm = fetch_scoreboard_window(win_start.date(), win_end.date())
    for g in batch_games:
        g2 = games_confirm.get(g["id"])
        if not (g2 and g2["completed"] and g2["goalsHome"] == g["goalsHome"] and g2["goalsAway"] == g["goalsAway"]):
            print(f"  WARN: {g['home']} x {g['away']} not stable across two checks — "
                  f"skipping this cycle, will retry next run.")
            return

    # Runtime sanity check — no batch game may have a future date despite being "completed".
    for g in batch_games:
        if g["date"] > now:
            print(f"  🛑 WARN: {g['home']} x {g['away']} marked completed but dated in the "
                  f"future ({g['date']}) — refusing to trust this batch. Skipping.")
            return
        if not g["home"] or not g["away"]:
            print(f"  🛑 WARN: game {g['id']} missing team name(s) — refusing to trust this batch.")
            return

    print("Stable. Building round summary...")
    standings = fetch_standings()
    if len(standings) < 20:
        print(f"  🛑 WARN: only {len(standings)} teams in standings (expected 20) — "
              f"refusing to send with an incomplete table. Will retry next run.")
        return

    g4 = [t["name"] for t in standings[0:4]]
    z4 = [t["name"] for t in standings[16:20]]
    sa6 = [t["name"] for t in standings[6:12]]

    window_label = _fmt_date_range(win_start, win_end)
    window_label_subject = _fmt_date_range_subject(win_start, win_end)
    results_html = build_round_results_html(batch_games)
    standings_html = build_standings_html(g4, z4, sa6)

    deleted_ids = set(state.get("deletedIds") or [])
    entries = [e for e in state.get("entries", []) if e.get("id") not in deleted_ids]

    round_email = state.setdefault("roundEmail", {})
    baseline = round_email.get("baseline")
    ranked_now = rank_entries(entries, g4, z4, sa6)
    rank_by_id = {r["entry"]["id"]: r for r in ranked_now}

    prev_rank_by_id = {}
    if baseline:
        ranked_prev = rank_entries(entries, baseline["g4"], baseline["z4"], baseline["sa6"])
        prev_rank_by_id = {r["entry"]["id"]: r["rank"] for r in ranked_prev}

    print(f"AUTO — sending to {len(entries)} participant(s)...")
    sent, errors = 0, []
    for e in entries:
        addr = (e.get("participantEmail") or "").strip()
        if "@" not in addr:
            continue
        r = rank_by_id.get(e["id"])
        if not r:
            continue
        movement = None
        if e["id"] in prev_rank_by_id:
            movement = prev_rank_by_id[e["id"]] - r["rank"]
        html = build_participant_email_html(window_label, results_html, standings_html, e,
                                             {"total": r["total"], "rank": r["rank"], "movement": movement})
        subject = f"Rodada {window_label_subject} — resultados e classificação"
        try:
            status = send_email(addr, subject, html)
            print(f"  OK {status} → {addr}")
            sent += 1
            time.sleep(3)
        except Exception as ex:
            errors.append(f"{addr}: {ex}")
            print(f"  ERR → {addr}: {ex}")

    try:
        admin_html = build_admin_summary_html(window_label, results_html, standings_html, sent)
        send_email(ADMIN_EMAIL, f"[BR2026] Rodada {window_label_subject} — email de rodada enviado", admin_html)
    except Exception as ex:
        print(f"  WARN: admin summary email failed: {ex}")

    # Close the batch — only after attempting all sends (same idempotency tradeoff as
    # send_result_email.py: a crash between sending and this point could in theory skip a
    # round's email, never double-send it; retrying past this point is not safe).
    round_email["pendingBatch"] = None
    round_email["baseline"] = {"g4": g4, "z4": z4, "sa6": sa6}
    round_email["sentGameIds"] = list(set((round_email.get("sentGameIds") or []) + batch["gameIds"]))[-2000:]
    history = round_email.get("sentBatches") or []
    history.insert(0, {
        "windowStart": batch["windowStart"], "windowEnd": batch["windowEnd"],
        "sentAt": _iso(now), "gameCount": len(batch_games), "recipientCount": sent,
    })
    round_email["sentBatches"] = history[:50]
    append_audit_log(state, "round-email-sent", {
        "windowStart": batch["windowStart"], "windowEnd": batch["windowEnd"],
        "gameCount": len(batch_games), "recipientCount": sent, "errorCount": len(errors),
    })
    sb_upsert(state)
    print(f"\n✓ AUTO done: {sent} sent, {len(errors)} errors. Batch closed, baseline updated.")


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
    if "--auto" not in args:
        print(__doc__)
        sys.exit(1)
    run_auto()


if __name__ == "__main__":
    main()
