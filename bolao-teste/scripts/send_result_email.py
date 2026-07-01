"""
send_result_email.py — Bolão Ferrari Copa 2026
Sends a bilingual PT/EN score-update email to all participants after each match.

Usage:
  python3 send_result_email.py                              # send about latest saved result
  python3 send_result_email.py --update 75 1 1 B            # save M75 result to Supabase only
  python3 send_result_email.py --auto                       # check ESPN, save+email any new results

--update <mid> <goalsA> <goalsB> <advanceSide(A|B)>
  Writes the result to Supabase and exits. Run without flag to send emails.

--auto
  Fetches ESPN, detects matches not yet in Supabase, saves and emails each one.
  Safe to run repeatedly — idempotent (skips already-saved matches).
"""

import json, sys, time, urllib.request
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL  = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY      = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
EMAILJS_URL   = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY   = "GBZFujsJBET6modve"
EMAILJS_SVC   = "service_o4hyzxr"
EMAILJS_TMPL  = "template_xq7yzzb"
ADMIN_EMAIL   = "emferrari@gmail.com"

EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao-teste/",
}

SCORING = {"exactScore": 10, "advance": 5, "oneTeamGoals": 1}

# ── Match teams — mirrors data.js exactly ─────────────────────────────────────
MATCH_TEAMS = {
    # Round of 32
    "73": ("South Africa", "Canada"),
    "74": ("Brazil", "Japan"),
    "75": ("Germany", "Paraguay"),
    "76": ("Netherlands", "Morocco"),
    "77": ("Ivory Coast", "Norway"),
    "78": ("France", "Sweden"),
    "79": ("Mexico", "Ecuador"),
    "80": ("England", "DR Congo"),
    "81": ("Belgium", "Senegal"),
    "82": ("United States", "Bosnia and Herzegovina"),
    "83": ("Spain", "Austria"),
    "84": ("Portugal", "Croatia"),
    "85": ("Switzerland", "Algeria"),
    "86": ("Australia", "Egypt"),
    "87": ("Argentina", "Cape Verde"),
    "88": ("Colombia", "Ghana"),
    # Round of 16
    "89": ("W73", "W74"), "90": ("W75", "W76"),
    "91": ("W77", "W78"), "92": ("W79", "W80"),
    "93": ("W81", "W82"), "94": ("W83", "W84"),
    "95": ("W85", "W86"), "96": ("W87", "W88"),
    # Quarterfinals
    "97": ("W89", "W90"), "98": ("W91", "W92"),
    "99": ("W93", "W94"), "100": ("W95", "W96"),
    # Semifinals
    "101": ("W97", "W98"), "102": ("W99", "W100"),
    # 3rd place + Final
    "103": ("L101", "L102"), "104": ("W101", "W102"),
}

# ESPN display names that differ from our names
ESPN_ALIASES = {
    "Cote d'Ivoire":               "Ivory Coast",
    "Côte d'Ivoire":               "Ivory Coast",
    "Cabo Verde":                  "Cape Verde",
    "Bosnia-Herzegovina":          "Bosnia and Herzegovina",
    "Bosnia & Herzegovina":        "Bosnia and Herzegovina",
    "Congo DR":                    "DR Congo",
    "Congo, DR":                   "DR Congo",
    "Democratic Republic of Congo": "DR Congo",
    "DRC":                         "DR Congo",
    "USA":                         "United States",
    "México":                      "Mexico",
}

# ── ESPN helpers ──────────────────────────────────────────────────────────────
def _espn_normalize(name):
    return ESPN_ALIASES.get(name, name)


def fetch_espn_results():
    """
    Fetches ESPN scoreboard and returns completed R32 results.
    Returns: dict {match_id_str: {goalsA, goalsB, advanceSide, desc}}
    Skips any match where state != 'post' or no clear winner.
    """
    url = (
        "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/"
        "scoreboard?limit=300&dates=20260611-20260719"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())

    # Index ESPN events by frozenset of normalized team names
    event_map = {}
    for e in data.get("events", []):
        comp  = e.get("competitions", [{}])[0]
        comps = comp.get("competitors", [])
        if len(comps) < 2:
            continue
        names = frozenset(
            _espn_normalize(c.get("team", {}).get("displayName", ""))
            for c in comps
        )
        event_map[names] = (comp, comps)

    found = {}
    for mid, (tA, tB) in MATCH_TEAMS.items():
        if int(mid) > 88:
            continue  # only R32 auto-detection
        key = frozenset({tA, tB})
        if key not in event_map:
            continue
        comp, comps = event_map[key]
        st = comp.get("status", {}).get("type", {})
        if st.get("state") != "post":
            continue

        desc   = st.get("description", "")
        by_name = {}
        for c in comps:
            norm  = _espn_normalize(c.get("team", {}).get("displayName", ""))
            score = _parse(c.get("score") or "0") or 0
            by_name[norm] = (score, c.get("winner", False))

        sA = by_name.get(tA)
        sB = by_name.get(tB)
        if not sA or not sB:
            continue

        gA, winA = sA
        gB, winB = sB

        if winA:
            side = "A"
        elif winB:
            side = "B"
        else:
            # Tie with no winner flag — shouldn't occur in knockout
            print(f"  WARN M{mid}: ESPN shows no winner yet — skipping")
            continue

        found[str(mid)] = {"goalsA": gA, "goalsB": gB, "advanceSide": side, "desc": desc}

    return found


# ── Supabase helpers ──────────────────────────────────────────────────────────
def sb_fetch():
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state?id=eq.main&select=state",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())[0]["state"]


def sb_update_result(mid, goalsA, goalsB, advanceSide):
    """Upsert a single match result into Supabase. advanceSide: 'A' or 'B'."""
    state = sb_fetch()
    results = state.get("results") or {}
    results[str(mid)] = {
        "goalsA": int(goalsA),
        "goalsB": int(goalsB),
        "advanceSide": advanceSide.upper(),
    }
    state["results"] = results
    body = json.dumps({"id": "main", "state": state}).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state",
        data=body,
        method="POST",
        headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status


# ── Scoring ───────────────────────────────────────────────────────────────────
def _parse(v):
    try:
        return int(v) if v is not None and str(v).strip() != "" else None
    except (ValueError, TypeError):
        return None


def score_match(pick, result, teamA="Time A", teamB="Time B"):
    """Returns (pts, detail_pt, detail_en) for one match."""
    pA = _parse(pick.get("goalsA"))
    pB = _parse(pick.get("goalsB"))
    pS = pick.get("advanceSide", "")
    rA = _parse(result.get("goalsA"))
    rB = _parse(result.get("goalsB"))
    rS = result.get("advanceSide", "")
    if pA is None or pB is None or rA is None or rB is None or not rS:
        return 0, "—", "—"
    winner = teamB if rS == "B" else teamA
    pts = 0
    notes_pt, notes_en = [], []

    if pA == rA and pB == rB:
        pts += SCORING["exactScore"]
        notes_pt.append(f"+{SCORING['exactScore']} placar exato")
        notes_en.append(f"+{SCORING['exactScore']} exact score")
    else:
        if pA == rA:
            pts += SCORING["oneTeamGoals"]
            notes_pt.append(f"+{SCORING['oneTeamGoals']} acertou gols de {teamA} ({rA})")
            notes_en.append(f"+{SCORING['oneTeamGoals']} correct goals for {teamA} ({rA})")
        if pB == rB:
            pts += SCORING["oneTeamGoals"]
            notes_pt.append(f"+{SCORING['oneTeamGoals']} acertou gols de {teamB} ({rB})")
            notes_en.append(f"+{SCORING['oneTeamGoals']} correct goals for {teamB} ({rB})")

    if pS == rS:
        pts += SCORING["advance"]
        notes_pt.append(f"+{SCORING['advance']} {winner} avança")
        notes_en.append(f"+{SCORING['advance']} {winner} advances")

    return pts, (", ".join(notes_pt) or "—"), (", ".join(notes_en) or "—")


def score_entry_total(entry, results):
    total = 0
    for mid, result in results.items():
        if not result.get("advanceSide"):
            continue
        pick = (entry.get("picks") or {}).get(mid)
        if not pick:
            continue
        pts, _, _ = score_match(pick, result)
        total += pts
    return total


# ── Email HTML builder ────────────────────────────────────────────────────────
def pts_color(pts):
    if pts >= 10: return "#16a34a"
    if pts >= 5:  return "#ca8a04"
    if pts > 0:   return "#2563eb"
    return "#9ca3af"


def build_html(state, focus_mid=None):
    """
    Builds result email HTML.
    focus_mid: which match to show in the per-participant breakdown.
               Defaults to the latest completed match in state.
    """
    entries     = state.get("entries", [])
    deleted_ids = set(state.get("deletedIds", []))
    results     = {k: v for k, v in state.get("results", {}).items() if v.get("advanceSide")}

    real_entries = [
        e for e in entries
        if e.get("id") not in deleted_ids
        and not (e.get("diagnostics") or {}).get("demo")
    ]

    scored = sorted(
        [{"e": e, "total": score_entry_total(e, results)} for e in real_entries],
        key=lambda x: -x["total"]
    )

    last_mid = focus_mid or (sorted(results.keys(), key=int)[-1] if results else None)

    # ── Per-match breakdown ───────────────────────────────────────────────────
    breakdown_rows_pt = ""
    breakdown_rows_en = ""
    winner_name = ""
    result_str  = ""
    if last_mid and last_mid in results:
        last_result = results[last_mid]
        last_tA, last_tB = MATCH_TEAMS.get(last_mid, ("A", "B"))
        winner_name = last_tB if last_result["advanceSide"] == "B" else last_tA
        result_str  = f'{last_tA} {last_result["goalsA"]}–{last_result["goalsB"]} {last_tB}'

        breakdown_scored = sorted(
            [{"name": item["e"].get("entryName", "?"),
              "pick": (item["e"].get("picks") or {}).get(last_mid)}
             for item in scored],
            key=lambda x: -(score_match(x["pick"] or {}, last_result,
                                        teamA=last_tA, teamB=last_tB)[0]
                            if x["pick"] else 0)
        )
        for row in breakdown_scored:
            p = row["pick"]
            if p:
                pts, det_pt, det_en = score_match(p, last_result, teamA=last_tA, teamB=last_tB)
                pick_team = last_tB if p.get("advanceSide") == "B" else last_tA
                pick_str  = f'{int(p["goalsA"])}–{int(p["goalsB"])} ({pick_team})'
            else:
                pts, det_pt, det_en = 0, "sem palpite", "no pick"
                pick_str = "—"
            color = pts_color(pts)
            tr = (
                f'<tr><td style="padding:6px 10px">{row["name"]}</td>'
                f'<td style="padding:6px 10px;text-align:center">{pick_str}</td>'
                f'<td style="padding:6px 10px;text-align:center;font-weight:700;color:{color}">{pts}</td>'
            )
            breakdown_rows_pt += tr + f'<td style="padding:6px 10px;font-size:11px;color:#6b7280">{det_pt}</td></tr>'
            breakdown_rows_en += tr + f'<td style="padding:6px 10px;font-size:11px;color:#6b7280">{det_en}</td></tr>'

    # ── Ranking ───────────────────────────────────────────────────────────────
    ranking_rows = ""
    prev_pts = None
    rank = 0
    for i, item in enumerate(scored):
        if item["total"] != prev_pts:
            rank = i + 1
        prev_pts = item["total"]
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(rank, f"{rank}.")
        bg = "#fffbe6" if rank <= 3 else "white"
        ranking_rows += (
            f'<tr style="background:{bg}">'
            f'<td style="padding:7px 10px;text-align:center">{medal}</td>'
            f'<td style="padding:7px 10px">{item["e"].get("entryName","?")}</td>'
            f'<td style="padding:7px 10px;text-align:center;font-weight:700;color:{pts_color(item["total"])}">'
            f'{item["total"]}</td></tr>'
        )

    # ── Assemble ──────────────────────────────────────────────────────────────
    matches_played = len(results)
    label_pt = f"Último jogo (M{last_mid})" if last_mid else ""
    label_en = f"Latest match (M{last_mid})" if last_mid else ""

    thead_style = 'style="background:#f1f5f9"'
    th  = 'style="padding:8px 10px;text-align:left;font-weight:600;color:#374151"'
    tbl = (
        'style="width:100%;border-collapse:collapse;background:white;'
        'border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;'
        'font-size:13px;margin-bottom:20px"'
    )

    html = f"""
<div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1d4ed8,#1e40af);color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:26px;font-weight:700;margin-bottom:4px">🏆 Bolão do Ferrari — Copa 2026</div>
    <div style="opacity:.8;font-size:13px">Atualização de resultados · Results update</div>
  </div>

  <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">

    <!-- ══════════ PORTUGUÊS ══════════ -->
    <div style="font-size:15px;font-weight:700;color:#1d4ed8;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #dbeafe">
      🇧🇷 Português
    </div>

    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">{label_pt}</div>
      <div style="font-size:16px;font-weight:700">{result_str}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ {winner_name + " avança" if winner_name else ""}</div>
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
      Placar exato = 10 pts &nbsp;·&nbsp; Avanço correto = 5 pts &nbsp;·&nbsp; Gols exatos de 1 time = 1 pt <em>(por time, não por gol)</em>
    </div>

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Ranking atual ({matches_played} de 32 jogos)</div>
    <table {tbl}>
      <thead><tr {thead_style}>
        <th {th} style="text-align:center">#</th>
        <th {th}>Entrada</th>
        <th {th} style="text-align:center">Total</th>
      </tr></thead>
      <tbody>{ranking_rows}</tbody>
    </table>

    <div style="height:2px;background:#dbeafe;margin:24px 0"></div>

    <!-- ══════════ ENGLISH ══════════ -->
    <div style="font-size:15px;font-weight:700;color:#1d4ed8;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #dbeafe">
      🇺🇸 English
    </div>

    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">{label_en}</div>
      <div style="font-size:16px;font-weight:700">{result_str}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ {winner_name + " advances" if winner_name else ""}</div>
    </div>

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Scoring — {label_en}</div>
    <table {tbl}>
      <thead><tr {thead_style}>
        <th {th}>Entry</th>
        <th {th} style="text-align:center">Pick</th>
        <th {th} style="text-align:center">Pts</th>
        <th {th}>Details</th>
      </tr></thead>
      <tbody>{breakdown_rows_en}</tbody>
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:-14px;margin-bottom:20px">
      Exact score = 10 pts &nbsp;·&nbsp; Correct advance = 5 pts &nbsp;·&nbsp; Exact goals of 1 team = 1 pt <em>(per team, not per goal)</em>
    </div>

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Current ranking ({matches_played} of 32 matches played)</div>
    <table {tbl}>
      <thead><tr {thead_style}>
        <th {th} style="text-align:center">#</th>
        <th {th}>Entry</th>
        <th {th} style="text-align:center">Total</th>
      </tr></thead>
      <tbody>{ranking_rows}</tbody>
    </table>

    <div style="height:1px;background:#e2e8f0;margin:20px 0"></div>
    <div style="text-align:center;font-size:12px;color:#9ca3af">
      <a href="https://ferrarilabs.github.io/bolao-teste/" style="color:#1d4ed8;text-decoration:none">ferrarilabs.github.io/bolao-teste/</a>
      &nbsp;·&nbsp; Bolão do Ferrari · Copa 2026
    </div>

  </div>
</div>
"""
    return html


# ── Email sender ──────────────────────────────────────────────────────────────
def send_email(addr, subject, html):
    addr = addr.strip().rstrip(",").strip()
    body = json.dumps({
        "service_id":      EMAILJS_SVC,
        "template_id":     EMAILJS_TMPL,
        "user_id":         EMAILJS_KEY,
        "template_params": {
            "to_email":     addr,
            "entry_name":   subject,
            "receipt_code": subject,
            "html_message": html,
        }
    }).encode()
    req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


def _build_recipients(state):
    """Returns {email_lower: clean_addr} for real, non-demo, valid-email entries."""
    deleted_ids = set(state.get("deletedIds", []))
    recipients  = {}
    for e in state.get("entries", []):
        if e.get("id") in deleted_ids:
            continue
        if (e.get("diagnostics") or {}).get("demo"):
            continue
        addr = (e.get("participantEmail") or "").strip().rstrip(",").strip()
        if "@" not in addr or "." not in addr.split("@")[-1]:
            continue
        recipients.setdefault(addr.lower(), addr)
    return recipients


def _send_to_all(state, html, subject):
    """Send to all valid recipients. Returns (sent_count, error_list)."""
    recipients = _build_recipients(state)
    print(f"Sending to {len(recipients)} recipients...")
    sent, errors = 0, []
    for _, addr in recipients.items():
        try:
            status = send_email(addr, subject, html)
            print(f"  OK {status} → {addr}  [{subject}]")
            sent += 1
            time.sleep(3)
        except Exception as ex:
            errors.append(f"{addr}: {ex}")
            print(f"  ERR → {addr}: {ex}")
    return sent, errors


# ── Auto mode ─────────────────────────────────────────────────────────────────
def run_auto():
    """
    Check ESPN for completed R32 matches not yet in Supabase.
    Save + email each new match in chronological order.
    Idempotent: already-saved matches are skipped entirely.
    """
    print("AUTO — fetching ESPN results...")
    try:
        espn = fetch_espn_results()
    except Exception as ex:
        print(f"ESPN fetch failed: {ex}")
        sys.exit(1)

    if not espn:
        print("ESPN: no completed R32 matches found.")
        return

    print(f"ESPN completed: {sorted(espn.keys(), key=int)}")

    state = sb_fetch()
    saved = {k for k, v in state.get("results", {}).items() if v.get("advanceSide")}
    print(f"Supabase has:   {sorted(saved, key=int) if saved else '(none)'}")

    new_mids = sorted([m for m in espn if m not in saved], key=int)
    if not new_mids:
        print("No new matches. Nothing to do.")
        return

    print(f"New:            {[f'M{m}' for m in new_mids]}")

    for i, mid in enumerate(new_mids):
        r      = espn[mid]
        tA, tB = MATCH_TEAMS[mid]
        winner = tB if r["advanceSide"] == "B" else tA
        print(f"\n[M{mid}] {tA} {r['goalsA']}–{r['goalsB']} {tB} → {winner} avança  ({r['desc']})")

        sb_status = sb_update_result(mid, r["goalsA"], r["goalsB"], r["advanceSide"])
        print(f"  Supabase: {sb_status}")

        state   = sb_fetch()  # re-fetch so this result appears in ranking
        html    = build_html(state, focus_mid=mid)
        subject = f"Resultado Parcial — M{mid}: {tA} {r['goalsA']}–{r['goalsB']} {tB}"

        sent, errors = _send_to_all(state, html, subject)
        print(f"  → {sent} sent, {len(errors)} errors")
        for err in errors:
            print(f"    ERROR: {err}")

        if i < len(new_mids) - 1:
            print("  Waiting 10s before next match...")
            time.sleep(10)

    print(f"\n✓ AUTO done: {len(new_mids)} new match(es) processed.")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]

    if "--auto" in args:
        run_auto()
        return

    # --update <mid> <goalsA> <goalsB> <A|B>  →  save only, no email
    if "--update" in args:
        idx = args.index("--update")
        try:
            mid, gA, gB, side = args[idx+1], args[idx+2], args[idx+3], args[idx+4]
        except IndexError:
            print("Usage: --update <mid> <goalsA> <goalsB> <A|B>")
            sys.exit(1)
        tA, tB = MATCH_TEAMS.get(str(mid), ("Time A", "Time B"))
        winner = tB if side.upper() == "B" else tA
        print(f"Saving M{mid}: {tA} {gA}–{gB} {tB} → {winner} avança...")
        status = sb_update_result(mid, gA, gB, side)
        print(f"  Supabase: {status}")
        return

    # Default: send about the latest result already in Supabase
    print("Fetching state from Supabase...")
    state   = sb_fetch()
    results = {k: v for k, v in state.get("results", {}).items() if v.get("advanceSide")}
    if not results:
        print("No completed results in Supabase. Nothing to send.")
        return

    last_mid = sorted(results.keys(), key=int)[-1]
    r        = results[last_mid]
    tA, tB   = MATCH_TEAMS.get(last_mid, ("A", "B"))
    subject  = f"Resultado Parcial — M{last_mid}: {tA} {r['goalsA']}–{r['goalsB']} {tB}"
    html     = build_html(state)

    print(f"Completed matches: {sorted(results.keys(), key=int)}")
    sent, errors = _send_to_all(state, html, subject)
    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors")
    for err in errors:
        print(f"  ERROR: {err}")


if __name__ == "__main__":
    main()
