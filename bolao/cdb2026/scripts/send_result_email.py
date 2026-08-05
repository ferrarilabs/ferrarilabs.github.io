"""
send_result_email.py — Bolão Ferrari Copa do Brasil 2026
Sends a bilingual PT/EN score-update email to all participants after each match (leg) result.

EXATAMENTE igual à Copa do Mundo (bolao/copa2026/scripts/send_result_email.py) em arquitetura,
gates de segurança e formato de e-mail — Eduardo, 2026-08-01: "Tem que ser EXATAMENTE igual copa
do mundo!" A única diferença real é o MODELO DE DADOS: a Copa tem um chaveamento fixo conhecido
de antemão (MATCH_TEAMS, resolução de slots W73/L101); o CDB2026 é mata-mata de ida e volta com
confrontos sorteados fase a fase (não são conhecidos de antemão — ver data.js), então este script
lê os confrontos diretamente de `state.phases[phaseId].ties` em vez de um dicionário de bracket
fixo, e casa cada perna com a ESPN por NOME DE TIME (mesmo mecanismo de autoSyncEspnResults() em
app.js), não por ID numérico de partida fixo.

Reaproveita audit_scoring.py DIRETAMENTE (match_points()/score_entry()) em vez de reimplementar a
fórmula de pontuação uma segunda vez — ver o comentário no topo de audit_scoring.py: isso elimina
por construção o tipo de risco de "drift" que o script da Copa protege (lá, send_result_email.py
é uma reimplementação Python verdadeiramente independente do app.js).

Usage:
  python3 send_result_email.py                                  # send about latest saved leg
  python3 send_result_email.py --update <tieId> <leg> <gH> <gA>  # save leg only, no email
  python3 send_result_email.py --auto                            # check ESPN, save+email new legs
  python3 send_result_email.py --clear-leg <tieId> <leg>         # remove a leg result

--update <tieId> <leg> <goalsHome> <goalsAway>
  Writes the leg result to Supabase and exits. leg: "first"|"second"|"single".

--auto
  Fetches ESPN, detects legs of the ACTIVE phase's ties not yet in Supabase, saves and emails
  each one, in the same run if a tie's 2nd leg completion also decides it. Idempotent.

--clear-leg <tieId> <leg>
  Removes a leg's result from Supabase (sets goalsHome/goalsAway back to null, status SCHEDULED)
  and unlocks the tie (qualifiedTeamId cleared) if it had been locked from that leg's data.
"""

import json, re, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_scoring  # match_points(), score_entry(), MATCH_SCORING, TIE_BONUS, PODIUM_BONUS

# Football-hardening checkpoint F: wires this script's real send path into the shared
# checkpoint-D outbox (bolao/shared/scripts/notification_outbox.py, same on-disk JSON schema and
# idempotency-key format as the JS reconciler's notification_outbox.mjs — see
# test_notification_outbox_interop.mjs). Purely additive duplicate-prevention: it can only ever
# SKIP a send that repeats an idempotency key already recorded as "sent", never suppress a send
# that would have gone out before this change existed, and never alters scoring/ranking/email
# content. See _send_to_all() below for the actual integration point.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "shared" / "scripts"))
import notification_outbox as outbox

# ── Config — mirrors bolao/cdb2026/js/config.js exactly ───────────────────────
SUPABASE_URL   = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY       = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
STATE_ID       = "cdb2026"
EMAILJS_URL    = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY    = "GBZFujsJBET6modve"
EMAILJS_SVC    = "service_o4hyzxr"
EMAILJS_TMPL   = "template_xq7yzzb"
ADMIN_EMAIL    = "emferrari@gmail.com"
SITE_URL       = "https://ferrarilabs.github.io/bolao/cdb2026/"
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard?dates=20260101-20261231&limit=500"

EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao/cdb2026/",
}

# Phase structure — mirrors DATA.phases in bolao/cdb2026/js/data.js exactly (only the
# STRUCTURE is known ahead of time; which teams play in each phase is drawn live and lives in
# Supabase, never here — see data.js's own top-of-file comment).
PHASES = [
    {"id": "fase-1",    "name": "1ª Fase",           "format": "SINGLE_MATCH", "order": 1},
    {"id": "fase-2",    "name": "2ª Fase",            "format": "SINGLE_MATCH", "order": 2},
    {"id": "fase-3",    "name": "3ª Fase",            "format": "SINGLE_MATCH", "order": 3},
    {"id": "fase-4",    "name": "4ª Fase",            "format": "SINGLE_MATCH", "order": 4},
    {"id": "fase-5",    "name": "5ª Fase",            "format": "TWO_LEG",      "order": 5},
    {"id": "oitavas",   "name": "Oitavas de Final",   "format": "TWO_LEG",      "order": 6},
    {"id": "quartas",   "name": "Quartas de Final",   "format": "TWO_LEG",      "order": 7},
    {"id": "semifinal", "name": "Semifinal",          "format": "TWO_LEG",      "order": 8},
    {"id": "final",     "name": "Final",              "format": "SINGLE_MATCH", "order": 9},
]
PHASE_BY_ID = {p["id"]: p for p in PHASES}


def legs_for_format(fmt):
    return ["first", "second"] if fmt == "TWO_LEG" else ["single"]


# ESPN display-name aliases — mirrors CDB_ESPN_NAME_ALIASES in bolao/cdb2026/js/app.js exactly.
# Keep in sync by hand if the ESPN feed adds another nickname mismatch.
ESPN_ALIASES = {"Vasco da Gama": "Vasco"}


def _espn_normalize(name):
    return ESPN_ALIASES.get(name, name)


# ── ESPN helpers ──────────────────────────────────────────────────────────────
def any_cdb_match_live():
    req = urllib.request.Request(ESPN_SCOREBOARD_URL)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
    return any(
        e.get("competitions", [{}])[0].get("status", {}).get("type", {}).get("state") == "in"
        for e in data.get("events", [])
    )


def fetch_espn_candidates():
    """Mirrors fetchEspnCandidates() in app.js: every scoreboard event, normalized team names,
    scores/winner only when the match is over (state=='post'), or live scores when state=='in'.
    Returns a list of dicts (not indexed by anything — matching is done by the caller via
    homeTeam/awayTeam string equality, exactly like the site's own autoSyncEspnResults())."""
    req = urllib.request.Request(ESPN_SCOREBOARD_URL)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())

    out = []
    for e in data.get("events", []):
        comp = e.get("competitions", [{}])[0]
        comps = comp.get("competitors", [])
        home = next((c for c in comps if c.get("homeAway") == "home"), comps[0] if comps else None)
        away = next((c for c in comps if c.get("homeAway") == "away"), comps[1] if len(comps) > 1 else None)
        if not home or not away:
            continue
        st = comp.get("status", {}).get("type", {})
        ev_state = st.get("state", "pre")
        postponed = ev_state == "post" and st.get("completed") is False
        home_score = _parse(home.get("score")) if (ev_state == "post" and not postponed) else None
        away_score = _parse(away.get("score")) if (ev_state == "post" and not postponed) else None
        out.append({
            "dateISO":   comp.get("date") or e.get("date") or "",
            "homeTeam":  _espn_normalize(home.get("team", {}).get("displayName", "")),
            "awayTeam":  _espn_normalize(away.get("team", {}).get("displayName", "")),
            "state":     ev_state,
            "postponed": postponed,
            "homeScore": home_score,
            "awayScore": away_score,
            "homeWinner": (ev_state == "post" and not postponed and home.get("winner") is True),
            "awayWinner": (ev_state == "post" and not postponed and away.get("winner") is True),
            "venue":     comp.get("venue", {}).get("fullName") or "",
            "city":      comp.get("venue", {}).get("address", {}).get("city") or "",
        })
    return out


RESULT_MATCH_WINDOW_DAYS = 21


def within_result_match_window(candidate_date_iso, known_kickoff_iso):
    """Mirrors withinResultMatchWindow() in app.js — guards against matching an unrelated event
    with the same team-name pair from a different round/season window."""
    if not known_kickoff_iso:
        return True
    try:
        c = datetime.fromisoformat(candidate_date_iso.replace("Z", "+00:00"))
        k = datetime.fromisoformat(known_kickoff_iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True
    return abs((c - k).total_seconds()) <= RESULT_MATCH_WINDOW_DAYS * 86400


# ── Supabase helpers ──────────────────────────────────────────────────────────
def sb_fetch():
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state?id=eq.{STATE_ID}&select=state",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())[0]["state"]


def _sb_upsert(state):
    body = json.dumps({"id": STATE_ID, "state": state}).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state",
        data=body, method="POST",
        headers={
            "apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}",
            "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates",
        }
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status


def sb_save_leg(phase_id, tie_id, leg, goals_home, goals_away, source="espn-auto"):
    """Read-modify-write a single leg's result, same field shape the admin UI's save-leg handler
    produces (bolao/cdb2026/js/app.js renderAdminResults() ~line 3352) -- homeTeam/awayTeam per
    the leg's own home/away convention (leg 'second' flips: home=teamB, away=teamA)."""
    state = sb_fetch()
    tie = state["phases"][phase_id]["ties"][tie_id]
    home = tie["teamB"] if leg == "second" else tie["teamA"]
    away = tie["teamA"] if leg == "second" else tie["teamB"]
    tie["matches"][leg] = {
        **(tie["matches"].get(leg) or {}),
        "homeTeam": home, "awayTeam": away,
        "goalsHome": int(goals_home), "goalsAway": int(goals_away),
        "status": "FINAL", "resultSource": source,
    }
    state.setdefault("auditLog", []).insert(0, {
        "ts": datetime.now(timezone.utc).isoformat(), "action": "save-leg", "admin": True,
        "detail": {"phase": phase_id, "tieId": tie_id, "leg": leg, "teamA": home, "teamB": away,
                   "goalsHome": int(goals_home), "goalsAway": int(goals_away), "resultSource": source},
    })
    if len(state["auditLog"]) > 200:
        state["auditLog"] = state["auditLog"][:200]
    state.setdefault("meta", {})["updatedAt"] = datetime.now(timezone.utc).isoformat()
    status = _sb_upsert(state)
    return status, state


def sb_backfill_schedule(espn_candidates):
    """Server-side counterpart of autoSyncEspn()'s backfill pass in app.js (added 5a9dad4,
    2026-08-04) -- that logic only runs client-side when an admin has the panel open, so a leg
    (typically the volta) whose kickoff/venue ESPN has already published stays "Data a definir"
    on the public site until someone happens to open the admin panel. This cron already runs
    every 10 minutes (see .github/workflows/cdb2026_result_emails.yml) checking for score
    results, so backfilling schedule-only fields (kickoff/venue/city -- NEVER
    goalsHome/goalsAway/status/qualifiedTeamId) here on every tick closes that gap without new
    infrastructure. Same withinResultMatchWindow safety anchor as the score-matching path: worst
    case of a wrong team-name match here is a cosmetically wrong date/venue, never a result or a
    payment. Returns the number of legs patched.
    """
    state = sb_fetch()
    patched = 0
    for phase in state.get("phases", {}).values():
        for tie in phase.get("ties", {}).values():
            if not tie.get("teamA") or not tie.get("teamB"):
                continue
            matches = tie.get("matches") or {}
            tie_kickoff_anchor = next((m.get("kickoff") for m in matches.values() if m and m.get("kickoff")), None)
            for leg, m in matches.items():
                if not m or m.get("kickoff") or m.get("goalsHome") is not None:
                    continue  # already scheduled, or already played -- nothing to backfill
                home = tie["teamB"] if leg == "second" else tie["teamA"]
                away = tie["teamA"] if leg == "second" else tie["teamB"]
                ev = next((c for c in espn_candidates
                           if c["homeTeam"] == home and c["awayTeam"] == away and c.get("dateISO")
                           and within_result_match_window(c["dateISO"], m.get("kickoff") or tie_kickoff_anchor)), None)
                if not ev:
                    continue
                matches[leg] = {
                    **m, "kickoff": ev["dateISO"],
                    "venue": ev.get("venue") or m.get("venue"),
                    "city": ev.get("city") or m.get("city"),
                }
                patched += 1
    if not patched:
        return 0
    state.setdefault("auditLog", []).insert(0, {
        "ts": datetime.now(timezone.utc).isoformat(), "action": "backfill-schedule", "admin": True,
        "detail": {"legsPatched": patched, "source": "espn-auto-cron"},
    })
    if len(state["auditLog"]) > 200:
        state["auditLog"] = state["auditLog"][:200]
    state.setdefault("meta", {})["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _sb_upsert(state)
    return patched


def sb_lock_tie(phase_id, tie_id, qualified_side, source="espn-auto"):
    state = sb_fetch()
    tie = state["phases"][phase_id]["ties"][tie_id]
    if tie.get("qualifiedTeamId"):
        return 200, state  # already locked (manual or a previous run) — never overwrite
    locked_at = datetime.now(timezone.utc).isoformat()
    tie["qualifiedTeamId"] = qualified_side
    tie["lockedAt"] = locked_at
    tie["lockedBy"] = source
    state.setdefault("auditLog", []).insert(0, {
        "ts": locked_at, "action": "lock-tie", "admin": True,
        "detail": {"phase": phase_id, "tieId": tie_id, "qualifiedTeamId": qualified_side},
    })
    if len(state["auditLog"]) > 200:
        state["auditLog"] = state["auditLog"][:200]
    state.setdefault("meta", {})["updatedAt"] = datetime.now(timezone.utc).isoformat()
    status = _sb_upsert(state)
    return status, state


def sb_clear_leg(phase_id, tie_id, leg):
    state = sb_fetch()
    tie = state["phases"][phase_id]["ties"][tie_id]
    m = tie["matches"].get(leg)
    had_result = bool(m and m.get("goalsHome") is not None)
    if m:
        m["goalsHome"] = None
        m["goalsAway"] = None
        m["status"] = "SCHEDULED"
    if tie.get("qualifiedTeamId"):
        tie["qualifiedTeamId"] = None
        tie["lockedAt"] = None
        tie["lockedBy"] = None
    state.setdefault("auditLog", []).insert(0, {
        "ts": datetime.now(timezone.utc).isoformat(), "action": "clear-leg", "admin": True,
        "detail": {"phase": phase_id, "tieId": tie_id, "leg": leg},
    })
    state.setdefault("meta", {})["updatedAt"] = datetime.now(timezone.utc).isoformat()
    status = _sb_upsert(state)
    print(f"{tie_id}:{leg} {'removido' if had_result else '(já estava vazio)'}. Confronto destravado se estava. Status: {status}")


def _parse(v):
    """Mirrors app.js's parseScore()/matchPoints() input guard: digits only, 0-20 range."""
    if v is None:
        return None
    s = str(v).strip()
    if not re.match(r'^\d+$', s):
        return None
    n = int(s)
    return n if 0 <= n <= 20 else None


# ── Scoring — reuses audit_scoring.py directly, see module docstring ─────────
def score_entry_total(entry, all_ties, podium):
    total, _ = audit_scoring.score_entry(entry, all_ties, podium)
    return total


def entry_detail(entry, all_ties, podium):
    _, detail = audit_scoring.score_entry(entry, all_ties, podium)
    return detail


def official_podium(all_phases_ties):
    """Champion/runnerUp from the Final phase's single tie — mirrors officialPodium() in app.js."""
    final_ties = all_phases_ties.get("final", {})
    if not final_ties:
        return {"champion": None, "runnerUp": None}
    tie_id = next(iter(final_ties))
    tie = final_ties[tie_id]
    if not tie.get("qualifiedTeamId"):
        return {"champion": None, "runnerUp": None}
    if tie["qualifiedTeamId"] == "A":
        return {"champion": tie["teamA"], "runnerUp": tie["teamB"]}
    return {"champion": tie["teamB"], "runnerUp": tie["teamA"]}


def predicted_podium(entry, all_phases_ties):
    """Mirrors predictedPodium() in app.js — derived from the entry's own qualified-pick on the
    Final phase's tie, never a separate stored field."""
    final_ties = all_phases_ties.get("final", {})
    if not final_ties:
        return {"champion": None, "runnerUp": None}
    tie_id = next(iter(final_ties))
    tie = final_ties[tie_id]
    pick = (entry.get("picks") or {}).get("qualified", {}).get(tie_id)
    if not pick:
        return {"champion": None, "runnerUp": None}
    if pick == "A":
        return {"champion": tie["teamA"], "runnerUp": tie["teamB"]}
    return {"champion": tie["teamB"], "runnerUp": tie["teamA"]}


def exact_match_count(detail):
    return sum(1 for d in detail.get("matches", {}).values() if d["type"] == "exact")


def hit_champion(detail):
    # detail["champion"] is explicitly None (not just absent) whenever the podium bonus doesn't
    # apply yet (audit_scoring.score_entry() always sets the key) — .get(..., {}) doesn't help
    # when the key IS present with value None, so the fallback has to happen after the lookup.
    return 1 if (detail.get("champion") or {}).get("type") == "exact" else 0


def hit_runner_up(detail):
    return 1 if (detail.get("runnerUp") or {}).get("type") == "exact" else 0


# Prêmio do BOLÃO (participantes, não times) — mirrors finalPodiumPayouts()/CONFIG.prizes in
# app.js/config.js exactly (70/20/10%, entryFee $5). Same architecture as Copa's
# compute_final_payouts(): groups genuine ties (same total/champion/runnerUp/exact) and splits
# that position's prize evenly.
PRIZES = {"first": 0.70, "second": 0.20, "third": 0.10}
ENTRY_FEE = 5


def _all_ties(state):
    """{tieId: tie} flattened across every phase — score_entry()/audit_scoring expect this
    shape (mirrors how scoreEntry() in app.js iterates DATA.phases.forEach)."""
    out = {}
    for phase in PHASES:
        out.update(state.get("phases", {}).get(phase["id"], {}).get("ties", {}) or {})
    return out


def compute_final_payouts(state):
    """Only returns a result once the Final phase's tie is locked -- before that the bolão's own
    standings don't exist yet (mirrors Copa's gate on M103+M104 both being locked; CDB2026 has no
    3rd-place match, so there's only the one gate here)."""
    all_ties = _all_ties(state)
    podium = official_podium(state.get("phases", {}))
    if not podium["champion"]:
        return None
    deleted = set(state.get("deletedIds", []))
    entries = [e for e in state.get("entries", []) if e.get("id") not in deleted]
    if not entries:
        return None
    paid_count = sum(1 for e in entries if state.get("paid", {}).get(e.get("id")))
    pot = paid_count * ENTRY_FEE
    if not pot:
        return None

    scored = sorted(
        [{"e": e, "total": score_entry_total(e, all_ties, podium),
          "detail": entry_detail(e, all_ties, podium)} for e in entries],
        key=lambda x: (-x["total"], -hit_champion(x["detail"]), -hit_runner_up(x["detail"]), -exact_match_count(x["detail"])),
    )

    by_rank = {1: [], 2: [], 3: []}
    rank, prev_key = 0, None
    for i, item in enumerate(scored):
        key = (item["total"], hit_champion(item["detail"]), hit_runner_up(item["detail"]), exact_match_count(item["detail"]))
        if key != prev_key:
            rank = i + 1
        prev_key = key
        if rank in by_rank:
            by_rank[rank].append(item)

    payouts = []
    for r, pct_key in ((1, "first"), (2, "second"), (3, "third")):
        group = by_rank[r]
        if not group:
            continue
        amount = (pot * PRIZES[pct_key]) / len(group)
        for item in group:
            payouts.append({"entryName": item["e"].get("entryName", "?"), "rank": r, "amount": amount, "tied": len(group) > 1})
    return {"pot": pot, "payouts": payouts, "podium": podium}


def build_podium_html(payouts_info):
    """PT-only podium reveal — same visual treatment as Copa's build_podium_html(), minus the
    3rd/4th-place team congrats (CDB2026 has no 3rd-place match, only champion/runnerUp) and
    minus the English half (Eduardo, 2026-08-01: "Não precisa versão em inglês")."""
    medal = {1: "🥇", 2: "🥈", 3: "🥉"}
    label_pt = {1: "Campeão", 2: "Vice-campeão", 3: "3º lugar"}
    team_for_rank = {1: payouts_info["podium"].get("champion"), 2: payouts_info["podium"].get("runnerUp"), 3: None}

    def _amount(a):
        s = f"{a:.2f}"
        return s[:-3] if s.endswith(".00") else s

    def _congrats(item):
        team = team_for_rank.get(item["rank"])
        if not team:
            return ""
        name = item["entryName"]
        text = f"Parabéns, {name}! Assim como {team}, você também é {label_pt[item['rank']]} — só que do nosso bolão! 🏆"
        return f'<div style="font-size:11px;color:#374151;margin-top:6px;font-style:italic">{text}</div>'

    def _card(item):
        note = '<div style="font-size:11px;color:#9ca3af;margin-top:4px">Empate — valor dividido entre os empatados</div>' if item["tied"] else ""
        return f"""<div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center">
      <div style="font-size:30px;line-height:1;margin-bottom:6px">{medal[item['rank']]}</div>
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px">{label_pt[item['rank']]}</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">{item['entryName']}</div>
      <div style="font-size:22px;font-weight:900;color:#16a34a">${_amount(item['amount'])}</div>
      {note}
      {_congrats(item)}
    </div>"""

    cards_pt = "".join(_card(p) for p in payouts_info["payouts"])

    return f"""
  <div style="background:linear-gradient(135deg,#78350f,#451a03);border:2px solid #f59e0b;border-radius:14px;padding:22px 18px;margin-bottom:22px;text-align:center">
    <div style="font-size:20px;font-weight:900;color:white;margin-bottom:16px">🏆 Resultado Final do Bolão!</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      {cards_pt}
    </div>
    <div style="font-size:13px;color:#fde68a;margin-bottom:14px">
      Obrigado a todos que participaram! Foi um prazer acompanhar a Copa do Brasil com vocês.
    </div>
    <div style="font-size:11px;color:#fbbf2480">Pote total: ${_amount(payouts_info['pot'])}</div>
  </div>
"""


# ── Email HTML builder ────────────────────────────────────────────────────────
def pts_color(pts):
    if pts >= 10: return "#16a34a"
    if pts >= 5:  return "#ca8a04"
    if pts > 0:   return "#2563eb"
    return "#9ca3af"


def build_html(state, phase_id, tie_id, leg, tie_just_decided):
    """Builds the result email HTML for one leg's completion. tie_just_decided: True when this
    same leg's completion also resolved the tie's qualifiedTeamId THIS run -- folds the tie
    bonus into the per-entry breakdown row, mirroring Copa's match_podium_bonus_note() fold-in
    for M103/M104.

    PT-only — Eduardo, 2026-08-01: "Não precisa versão em inglês" (unlike the Copa's script,
    which stays bilingual PT/EN by its own design — this is a CDB2026-specific choice, not a
    platform-wide one)."""
    entries = state.get("entries", [])
    deleted_ids = set(state.get("deletedIds", []))
    real_entries = [e for e in entries if e.get("id") not in deleted_ids]

    all_ties = _all_ties(state)
    podium = official_podium(state.get("phases", {}))

    def _name_key(item):
        return (item["e"].get("entryName") or "").upper()

    scored = sorted(
        [{"e": e, "total": score_entry_total(e, all_ties, podium), "detail": entry_detail(e, all_ties, podium)} for e in real_entries],
        key=lambda x: (-x["total"], -hit_champion(x["detail"]), -hit_runner_up(x["detail"]), -exact_match_count(x["detail"])),
    )
    i = 0
    while i < len(scored):
        j = i
        key = (scored[i]["total"], hit_champion(scored[i]["detail"]), hit_runner_up(scored[i]["detail"]), exact_match_count(scored[i]["detail"]))
        while j < len(scored) and (scored[j]["total"], hit_champion(scored[j]["detail"]), hit_runner_up(scored[j]["detail"]), exact_match_count(scored[j]["detail"])) == key:
            j += 1
        scored[i:j] = sorted(scored[i:j], key=_name_key, reverse=True)
        i = j

    tie = all_ties[tie_id]
    match = tie["matches"][leg]
    home = tie["teamB"] if leg == "second" else tie["teamA"]
    away = tie["teamA"] if leg == "second" else tie["teamB"]
    result_str = f'{home} {match["goalsHome"]}–{match["goalsAway"]} {away}'
    leg_label_pt = "" if leg == "single" else " (ida)" if leg == "first" else " (volta)"

    winner_name = ""
    if tie_just_decided:
        winner_name = tie["teamA"] if tie["qualifiedTeamId"] == "A" else tie["teamB"]

    # ── Per-entry breakdown for this leg ──────────────────────────────────────
    # No "result" (correct W/D/L sign, wrong score) tier — matches audit_scoring.match_points()
    # exactly, which only ever returns "exact"/"side"/"miss" (see that module's 2026-08-01 fix).
    #
    # Eduardo, 2026-08-02, pasting a sent email as evidence: this table wasn't sorted by its own
    # "Pts" column at all — it inherited `scored`'s order, which is the SEASON-TOTAL ranking
    # (score_entry_total across every match so far), a different key entirely from the points a
    # given entry earned on THIS leg. Fixed by building a fresh list keyed on this leg's own
    # points (descending) with entry name (A→Z) as the tiebreak, computed as its own pass instead
    # of reusing `scored`'s order. Matches the pattern Copa's build_html() already uses
    # (`breakdown_scored`, a separate sort from its own season-ranking `scored`) — CDB2026 was the
    # one that had skipped that separation, not a platform-wide bug.
    breakdown_rows_pt = ""
    breakdown_items = []
    for item in scored:
        entry = item["e"]
        pick = (entry.get("picks") or {}).get("matches", {}).get(tie_id, {}).get(leg)
        result = {"goalsHome": match["goalsHome"], "goalsAway": match["goalsAway"]}
        r = audit_scoring.match_points(pick, result) if pick else None
        pts = r["pts"] if r else 0
        if r:
            # Texto explícito o bastante pra nunca parecer um erro à primeira vista — achado real
            # (Eduardo, 2026-08-01, sobre "+5 resultado certo" sozinho): "Talvez precise ficar
            # mais claro no email qual foi a pontuação e por que pontuou."
            det_pt = {
                "exact":  f"+{audit_scoring.MATCH_SCORING['exact']} placar exato",
                "result": f"+{audit_scoring.MATCH_SCORING['result']} resultado certo (vitória/empate/derrota) — placar não exato",
                "side":   f"+{pts} gols de 1 time certos — placar e resultado diferentes",
                "miss":   "—",
            }[r["type"]]
            pick_str = f'{pick["goalsHome"]}–{pick["goalsAway"]}'
        else:
            det_pt, pick_str = "sem palpite", "—"

        if tie_just_decided:
            qual_pick = (entry.get("picks") or {}).get("qualified", {}).get(tie_id)
            if qual_pick:
                hit = qual_pick == tie["qualifiedTeamId"]
                bonus_pts = audit_scoring.TIE_BONUS if hit else 0
                pts += bonus_pts
                bonus_pt = f"+{audit_scoring.TIE_BONUS} acertou quem avança" if hit else "errou quem avança"
                det_pt = f"{det_pt}, {bonus_pt}" if det_pt != "—" else bonus_pt

        name = entry.get("entryName", "?")
        breakdown_items.append({"name": name, "pts": pts, "pick_str": pick_str, "det_pt": det_pt})

    breakdown_items.sort(key=lambda x: (-x["pts"], x["name"].upper()))
    for b in breakdown_items:
        color = pts_color(b["pts"])
        breakdown_rows_pt += (
            f'<tr><td style="padding:6px 10px">{b["name"]}</td>'
            f'<td style="padding:6px 10px;text-align:center">{b["pick_str"]}</td>'
            f'<td style="padding:6px 10px;text-align:center;font-weight:700;color:{color}">{b["pts"]}</td>'
            f'<td style="padding:6px 10px;font-size:11px;color:#6b7280">{b["det_pt"]}</td></tr>'
        )

    # ── Ranking ───────────────────────────────────────────────────────────────
    ranking_rows = ""
    prev_key = None
    rank = 0
    for i, item in enumerate(scored):
        key = (item["total"], hit_champion(item["detail"]), hit_runner_up(item["detail"]), exact_match_count(item["detail"]))
        if key != prev_key:
            rank = i + 1
        prev_key = key
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(rank, f"{rank}.")
        bg = "#fffbe6" if rank <= 3 else "white"
        ranking_rows += (
            f'<tr style="background:{bg}">'
            f'<td style="padding:7px 10px;text-align:center">{medal}</td>'
            f'<td style="padding:7px 10px">{item["e"].get("entryName","?")}</td>'
            f'<td style="padding:7px 10px;text-align:center;font-weight:700;color:{pts_color(item["total"])}">{item["total"]}</td></tr>'
        )

    matches_played = sum(1 for t in all_ties.values() for m in t.get("matches", {}).values() if m.get("goalsHome") is not None)
    phase_name = PHASE_BY_ID[phase_id]["name"]
    label_pt = f"{phase_name} — {tie['teamA']} × {tie['teamB']}{leg_label_pt}"
    winner_line_pt = f'✓ {winner_name} avança' if winner_name else ""

    thead_style = 'style="background:#f1f5f9"'
    th = 'style="padding:8px 10px;text-align:left;font-weight:600;color:#374151"'
    tbl = 'style="width:100%;border-collapse:collapse;background:white;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;margin-bottom:20px"'

    return f"""
<div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#059669,#065f46);color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:26px;font-weight:700;margin-bottom:4px">🏅 Bolão do Ferrari — Copa do Brasil 2026</div>
    <div style="opacity:.8;font-size:13px">Atualização de resultados</div>
  </div>

  <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">

    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">{label_pt}</div>
      <div style="font-size:16px;font-weight:700">{result_str}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">{winner_line_pt}</div>
    </div>

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Pontuação — {label_pt}</div>
    <table {tbl}>
      <thead><tr {thead_style}>
        <th {th}>Entrada</th>
        <th {th} style="text-align:center">Palpite</th>
        <th {th} style="text-align:center">Pts</th>
        <th {th}>Detalhes</th>
      </tr></thead>
      <tbody>{breakdown_rows_pt}</tbody>
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:-14px;margin-bottom:20px">
      Placar exato = {audit_scoring.MATCH_SCORING['exact']} pts &nbsp;·&nbsp;
      Resultado certo (V/E/D), placar não exato = {audit_scoring.MATCH_SCORING['result']} pts &nbsp;·&nbsp;
      Gols exatos de 1 time = {audit_scoring.MATCH_SCORING['side']} pt <em>(por time, não por gol — só conta se nem o placar nem o resultado bateram)</em> &nbsp;·&nbsp;
      Quem avança = {audit_scoring.TIE_BONUS} pts &nbsp;·&nbsp; Campeão = {audit_scoring.PODIUM_BONUS['champion']} pts &nbsp;·&nbsp; Vice = {audit_scoring.PODIUM_BONUS['runnerUp']} pts
    </div>

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Ranking atual ({matches_played} partidas)</div>
    <table {tbl}>
      <thead><tr {thead_style}>
        <th {th} style="text-align:center">#</th>
        <th {th}>Entrada</th>
        <th {th} style="text-align:center">Total</th>
      </tr></thead>
      <tbody>{ranking_rows}</tbody>
    </table>

    <div style="height:1px;background:#e2e8f0;margin:20px 0"></div>
    <div style="text-align:center;font-size:12px;color:#9ca3af">
      <a href="{SITE_URL}" style="color:#059669;text-decoration:none">ferrarilabs.github.io/bolao/cdb2026/</a>
      &nbsp;·&nbsp; Bolão do Ferrari · Copa do Brasil 2026
    </div>

  </div>
</div>
"""


# ── Email sender — identical mechanism to the Copa's script ──────────────────
def send_email(addr, subject, html):
    addr = addr.strip().rstrip(",").strip()
    body = json.dumps({
        "service_id":  EMAILJS_SVC, "template_id": EMAILJS_TMPL, "user_id": EMAILJS_KEY,
        "template_params": {"to_email": addr, "entry_name": subject, "receipt_code": subject, "html_message": html},
    }).encode()
    req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


def _build_recipients(state):
    deleted_ids = set(state.get("deletedIds", []))
    recipients = {}
    for e in state.get("entries", []):
        if e.get("id") in deleted_ids:
            continue
        addr = (e.get("participantEmail") or "").strip().rstrip(",").strip()
        if "@" not in addr or "." not in addr.split("@")[-1]:
            continue
        recipients.setdefault(addr.lower(), addr)
    return recipients


def _send_to_all(state, html, subject, *, match_id=None, result_version=1):
    """Football-hardening checkpoint F: when `match_id` is supplied (phase:tie:leg, or
    phase:tie:final for the podium email), every recipient's send is routed through the shared
    outbox (bolao/shared/scripts/notification_outbox.py) first. If a job with the SAME
    idempotency key (cdb2026:{match_id}:{recipient}:v{result_version}) is already recorded
    "sent" — e.g. this exact email for this exact leg/version already went out in a prior run
    that then crashed/retried — the send is skipped, not repeated. This can only ever prevent a
    literal duplicate; a recipient with no prior job for this key sends exactly as before
    match_id was introduced (backward compatible: match_id=None keeps the old behavior with zero
    outbox involvement, for any caller that doesn't pass it)."""
    recipients = _build_recipients(state)
    print(f"Sending to {len(recipients)} recipients...")
    sent, errors, skipped = 0, [], 0
    for _, addr in recipients.items():
        job = None
        if match_id is not None:
            key = outbox.idempotency_key("cdb2026", match_id, addr, result_version)
            existing = outbox.find_by_idempotency_key(key)
            if existing and existing.get("status") == "sent":
                print(f"  SKIP (duplicate — already sent, idempotency key {key}) → {addr}")
                skipped += 1
                continue
            job, _created = outbox.enqueue({
                "app": "cdb2026", "matchId": match_id, "recipient": addr, "resultVersion": result_version,
                "payloadSnapshot": {"subject": subject}, "idempotencyKey": key,
            })
        try:
            status = send_email(addr, subject, html)
            print(f"  OK {status} → {addr}  [{subject}]")
            if job is not None:
                outbox.record_result(job["jobId"], True)
            sent += 1
            time.sleep(3)
        except Exception as ex:
            if job is not None:
                outbox.record_result(job["jobId"], False, str(ex))
            errors.append(f"{addr}: {ex}")
            print(f"  ERR → {addr}: {ex}")
    if skipped:
        print(f"  ({skipped} recipient(s) skipped as duplicates via the shared outbox)")
    return sent, errors


# ── Auto mode ─────────────────────────────────────────────────────────────────
def _find_new_legs(state, espn_candidates):
    """Scans ONLY the active phase's ties (mirrors autoSyncEspnResults()' own scope in app.js —
    the phase the admin/ESPN sync currently considers 'live'), returns a list of
    (phase_id, tie_id, leg, goalsHome, goalsAway, event) for legs not yet saved."""
    phase_id = state.get("espnSync", {}).get("activePhaseId")
    if not phase_id or phase_id not in PHASE_BY_ID:
        return []
    fmt = PHASE_BY_ID[phase_id]["format"]
    legs = legs_for_format(fmt)
    ties = state.get("phases", {}).get(phase_id, {}).get("ties", {}) or {}
    found = []
    for tie_id, tie in ties.items():
        if not tie.get("teamA") or not tie.get("teamB"):
            continue
        tie_kickoff_anchor = next((tie["matches"].get(l, {}).get("kickoff") for l in legs if tie["matches"].get(l, {}).get("kickoff")), None)
        for leg in legs:
            m = tie.get("matches", {}).get(leg) or {}
            if m.get("goalsHome") is not None:
                continue  # already saved
            home = tie["teamB"] if leg == "second" else tie["teamA"]
            away = tie["teamA"] if leg == "second" else tie["teamB"]
            ev = next((c for c in espn_candidates
                       if c["homeTeam"] == home and c["awayTeam"] == away and c["homeScore"] is not None
                       and within_result_match_window(c["dateISO"], m.get("kickoff") or tie_kickoff_anchor)), None)
            if not ev:
                continue
            found.append((phase_id, tie_id, leg, ev["homeScore"], ev["awayScore"], ev))
    return found


def _maybe_decide_tie(state, phase_id, tie_id, espn_candidates):
    """After a leg save, checks whether the tie is now fully resolved (both legs have scores) and
    not yet locked -- if so, determines the winner exactly like aggregateOrSingleTotals() +
    autoSyncEspnResults()' penalty-winner fallback in app.js, and locks it. Returns the qualified
    side ('A'/'B') if newly decided this call, else None."""
    tie = state["phases"][phase_id]["ties"][tie_id]
    if tie.get("qualifiedTeamId"):
        return None
    fmt = PHASE_BY_ID[phase_id]["format"]
    legs = legs_for_format(fmt)
    if not all(tie["matches"].get(l, {}).get("goalsHome") is not None for l in legs):
        return None

    if fmt == "TWO_LEG":
        first, second = tie["matches"]["first"], tie["matches"]["second"]
        total_a = first["goalsHome"] + second["goalsAway"]
        total_b = first["goalsAway"] + second["goalsHome"]
    else:
        single = tie["matches"]["single"]
        total_a, total_b = single["goalsHome"], single["goalsAway"]

    if total_a != total_b:
        return "A" if total_a > total_b else "B"

    # Aggregate tied — only decides via penalties if ESPN reports an explicit winner on the
    # decisive leg, never guessed (same as autoSyncEspnResults()).
    decisive_leg = "second" if fmt == "TWO_LEG" else "single"
    decisive_home = tie["teamB"] if decisive_leg == "second" else tie["teamA"]
    decisive_away = tie["teamA"] if decisive_leg == "second" else tie["teamB"]
    anchor = tie["matches"].get(decisive_leg, {}).get("kickoff") or next((tie["matches"].get(l, {}).get("kickoff") for l in legs if tie["matches"].get(l, {}).get("kickoff")), None)
    ev = next((c for c in espn_candidates if c["homeTeam"] == decisive_home and c["awayTeam"] == decisive_away
               and within_result_match_window(c["dateISO"], anchor)), None)
    if ev and ev.get("homeWinner"):
        return "A" if decisive_home == tie["teamA"] else "B"
    if ev and ev.get("awayWinner"):
        return "A" if decisive_away == tie["teamA"] else "B"
    return None  # no explicit penalty-winner signal yet — stays for the admin's manual flow


def run_auto():
    print("AUTO — running scoring/ranking self-audit before touching anything...")
    audit_ok, _ = audit_scoring.run_static_audit(verbose=True)
    if not audit_ok:
        print("\n🛑 SELF-AUDIT FAILED — refusing to send any emails until this is fixed.")
        sys.exit(1)
    print("✓ Self-audit passed.\n")

    print("AUTO — fetching Supabase state...")
    state = sb_fetch()

    print("AUTO — fetching ESPN candidates...")
    try:
        espn = fetch_espn_candidates()
    except Exception as ex:
        print(f"ESPN fetch failed: {ex}")
        sys.exit(1)

    try:
        patched = sb_backfill_schedule(espn)
        if patched:
            print(f"AUTO — backfilled kickoff/venue for {patched} leg(s) missing schedule info.")
            state = sb_fetch()  # re-fetch so downstream logic sees the patched kickoff fields
    except Exception as ex:
        print(f"Schedule backfill failed: {ex} — continuing with result check.")

    new_legs = _find_new_legs(state, espn)

    if not new_legs:
        try:
            live_now = [c for c in espn if c.get("state") == "in"]
            if live_now:
                # Anchored to the live match's REAL kickoff time, not to time.time() at loop
                # start — real incident, 2026-08-04: Athletico-PR x Vitória (CDB2026) kicked off
                # 00:00 UTC; this workflow's own cron tick didn't start running until 00:11:42
                # (ordinary */10 cron granularity, not itself a bug); the OLD `time.time()+80*60`
                # deadline measured 80 minutes from THAT run-start, not from kickoff, so it closed
                # at 01:32:04 — about 4 minutes before the match's real finish (~01:36 UTC,
                # 90min+stoppage+halftime per ESPN's own clock/period data) — and gave up with
                # nothing saved or emailed until manually re-triggered. A cron tick landing a few
                # minutes late (routine — cron fires on a 10-minute grid, kickoff doesn't) was
                # silently eating into a fixed run-relative window instead of the actual match
                # duration. 130min = 90 regulation + ~15 halftime + ~10 stoppage + margin.
                try:
                    anchor_iso = min(c["dateISO"] for c in live_now if c.get("dateISO"))
                    deadline = datetime.fromisoformat(anchor_iso.replace("Z", "+00:00")).timestamp() + 130 * 60
                except (ValueError, TypeError, KeyError):
                    deadline = time.time() + 80 * 60  # dateISO missing/unparseable — old behavior as a fallback, not the norm
                print(f"Jogo ao vivo detectado — monitorando até terminar (poll a cada 2 min, prazo ancorado no kickoff real)...")
                while time.time() < deadline:
                    remaining = int((deadline - time.time()) / 60)
                    print(f"  [{remaining} min restantes] Aguardando 120s...")
                    time.sleep(120)
                    try:
                        espn = fetch_espn_candidates()
                    except Exception as ex:
                        print(f"  ESPN re-fetch falhou: {ex} — continuando loop")
                        continue
                    new_legs = _find_new_legs(state, espn)
                    if new_legs:
                        print(f"  Perna(s) finalizada(s) detectada(s)!")
                        break
                    try:
                        if not any_cdb_match_live():
                            print("  Nenhum jogo ao vivo detectado. Encerrando monitoramento.")
                            break
                    except Exception:
                        pass
                else:
                    print("Monitoramento encerrado por timeout (prazo ancorado no kickoff esgotado). Próximo cron tentará novamente.")
                    return
                if not new_legs:
                    print("Nenhum resultado detectado após monitoramento. Encerrando.")
                    return
            else:
                print("ESPN: nenhum jogo novo ou ao vivo. Nada a fazer.")
                return
        except Exception as ex:
            print(f"Verificação de jogo ao vivo falhou: {ex} — encerrando normalmente.")
            return

    print(f"New legs found: {[(t, l) for _, t, l, *_ in new_legs]}")

    # Stability re-check — same anti-flicker safeguard as the Copa's script: re-fetch ESPN after
    # 20s and require the score to match exactly before trusting it enough to email everyone.
    print("AUTO — re-checking ESPN after 20s to confirm results are stable before emailing...")
    time.sleep(20)
    try:
        espn_confirm = fetch_espn_candidates()
    except Exception as ex:
        print(f"ESPN re-check fetch failed: {ex} — skipping this cycle, will retry next run.")
        return

    confirmed = []
    for phase_id, tie_id, leg, gh, ga, ev in new_legs:
        home, away = ev["homeTeam"], ev["awayTeam"]
        ev2 = next((c for c in espn_confirm if c["homeTeam"] == home and c["awayTeam"] == away and c["homeScore"] is not None), None)
        if not ev2 or ev2["homeScore"] != gh or ev2["awayScore"] != ga:
            print(f"  WARN {tie_id}:{leg}: result not stable across two checks — skipping for now, will retry next run.")
            continue
        real_ok, real_detail = audit_scoring.check_match_is_real(ev2["dateISO"], home, away)
        shape_ok, shape_detail = audit_scoring.check_result_shape({"goalsHome": gh, "goalsAway": ga})
        if not (real_ok and shape_ok):
            print(f"  🛑 WARN {tie_id}:{leg}: failed runtime sanity check — {real_detail} {shape_detail} — skipping, will NOT save or email.")
            continue
        confirmed.append((phase_id, tie_id, leg, gh, ga))

    if not confirmed:
        print("No legs confirmed stable. Nothing to do this cycle.")
        return

    print(f"Confirmed stable: {[(t, l) for _, t, l, *_ in confirmed]}")

    for i, (phase_id, tie_id, leg, gh, ga) in enumerate(confirmed):
        tie_before = state["phases"][phase_id]["ties"][tie_id]
        home = tie_before["teamB"] if leg == "second" else tie_before["teamA"]
        away = tie_before["teamA"] if leg == "second" else tie_before["teamB"]
        print(f"\n[{tie_id}:{leg}] {home} {gh}–{ga} {away}")

        sb_status, state = sb_save_leg(phase_id, tie_id, leg, gh, ga, source="espn-auto")
        print(f"  Supabase (leg save): {sb_status}")

        qualified = _maybe_decide_tie(state, phase_id, tie_id, espn)
        tie_just_decided = False
        if qualified:
            lock_status, state = sb_lock_tie(phase_id, tie_id, qualified, source="espn-auto")
            print(f"  Supabase (lock-tie): {lock_status} → {tie_before['teamA'] if qualified == 'A' else tie_before['teamB']} avança")
            tie_just_decided = True

        state = sb_fetch()  # re-fetch so this leg/lock appears in ranking + resolves final tie
        tie = state["phases"][phase_id]["ties"][tie_id]
        html = build_html(state, phase_id, tie_id, leg, tie_just_decided)
        result_line = f"{home} {gh}–{ga} {away}"
        subj = f"Resultado Parcial — {tie_before['teamA']} × {tie_before['teamB']}: {result_line}"

        if phase_id == "final" and tie_just_decided:
            payouts_info = compute_final_payouts(state)
            if payouts_info:
                html = build_podium_html(payouts_info) + html
                champion = tie["teamA"] if tie["qualifiedTeamId"] == "A" else tie["teamB"]
                subj = f"🏆 Resultado Final do Bolão! · Final Bolão Result! — Campeão: {champion}"
                print(f"  🏆 Tournament complete — including podium/prize block ({len(payouts_info['payouts'])} payouts, pot ${payouts_info['pot']})")

        match_id = f"{phase_id}:{tie_id}:{leg}"
        sent, errors = _send_to_all(state, html, subj, match_id=match_id)
        print(f"  → {sent} sent, {len(errors)} errors")
        for err in errors:
            print(f"    ERROR: {err}")

        if i < len(confirmed) - 1:
            print("  Waiting 10s before next leg...")
            time.sleep(10)

    print(f"\n✓ AUTO done: {len(confirmed)} new leg(s) processed.")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]

    if "--auto" in args:
        run_auto()
        return

    if "--clear-leg" in args:
        idx = args.index("--clear-leg")
        try:
            tie_id, leg = args[idx + 1], args[idx + 2]
        except IndexError:
            print("Usage: --clear-leg <tieId> <leg>")
            sys.exit(1)
        state = sb_fetch()
        phase_id = next((p["id"] for p in PHASES if tie_id in (state.get("phases", {}).get(p["id"], {}).get("ties", {}) or {})), None)
        if not phase_id:
            print(f"Tie {tie_id} not found in any phase.")
            sys.exit(1)
        sb_clear_leg(phase_id, tie_id, leg)
        return

    if "--update" in args:
        idx = args.index("--update")
        try:
            tie_id, leg, gh, ga = args[idx + 1], args[idx + 2], args[idx + 3], args[idx + 4]
        except IndexError:
            print("Usage: --update <tieId> <leg> <goalsHome> <goalsAway>")
            sys.exit(1)
        state = sb_fetch()
        phase_id = next((p["id"] for p in PHASES if tie_id in (state.get("phases", {}).get(p["id"], {}).get("ties", {}) or {})), None)
        if not phase_id:
            print(f"Tie {tie_id} not found in any phase.")
            sys.exit(1)
        tie = state["phases"][phase_id]["ties"][tie_id]
        home = tie["teamB"] if leg == "second" else tie["teamA"]
        away = tie["teamA"] if leg == "second" else tie["teamB"]
        print(f"Saving {tie_id}:{leg}: {home} {gh}–{ga} {away}...")
        status, _ = sb_save_leg(phase_id, tie_id, leg, gh, ga, source="admin")
        print(f"  Supabase: {status}")
        return

    # Default: send about the latest leg result already in Supabase
    print("Fetching state from Supabase...")
    state = sb_fetch()
    latest = None
    for phase in PHASES:
        for tie_id, tie in (state.get("phases", {}).get(phase["id"], {}).get("ties", {}) or {}).items():
            for leg, m in tie.get("matches", {}).items():
                if m.get("goalsHome") is not None:
                    latest = (phase["id"], tie_id, leg)
    if not latest:
        print("No completed leg results in Supabase. Nothing to send.")
        return
    phase_id, tie_id, leg = latest
    tie = state["phases"][phase_id]["ties"][tie_id]
    html = build_html(state, phase_id, tie_id, leg, tie_just_decided=bool(tie.get("qualifiedTeamId")))
    subject = f"Resultado Parcial — {tie['teamA']} × {tie['teamB']}"
    sent, errors = _send_to_all(state, html, subject, match_id=f"{phase_id}:{tie_id}:{leg}")
    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors")
    for err in errors:
        print(f"  ERROR: {err}")


if __name__ == "__main__":
    main()
