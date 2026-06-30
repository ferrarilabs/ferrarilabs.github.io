"""
send_result_email.py — Bolão Ferrari Copa 2026
Sends a bilingual PT/EN score-update email to all participants after each match.

Usage:
  python3 send_result_email.py                              # sends to everyone
  python3 send_result_email.py --test                       # sends only to admin
  python3 send_result_email.py --update 75 1 1 B            # save M75 result to Supabase (goalsA=1, goalsB=1, advanceSide=B)
  python3 send_result_email.py --update 75 1 1 B --test     # save + test email

--update <mid> <goalsA> <goalsB> <advanceSide(A|B)>
  Writes the result to Supabase before sending. Use when ESPN sync hasn't run yet.
  advanceSide: "A" = teamA advances, "B" = teamB advances (pênaltis count).

EmailJS subject note:
  The subject line is controlled by the EmailJS template. To make it dynamic,
  open the EmailJS dashboard → Templates → template_xq7yzzb → Subject field
  and set it to:  {{subject}}
  Then the SUBJECT constant below will appear as the email subject.
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

SUBJECT_PT    = "Resultado Parcial — Bolão Ferrari Copa 2026"
SUBJECT_EN    = "Partial Results — Bolão Ferrari Copa 2026"
SUBJECT       = f"{SUBJECT_PT} / {SUBJECT_EN}"

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

# ── Knockout match info (match id → teams) ────────────────────────────────────
# Mirrors data.js exactly — teamA first, teamB second.
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
    # Round of 16 — teams determined as bracket resolves
    "89": ("W73", "W74"),
    "90": ("W75", "W76"),
    "91": ("W77", "W78"),
    "92": ("W79", "W80"),
    "93": ("W81", "W82"),
    "94": ("W83", "W84"),
    "95": ("W85", "W86"),
    "96": ("W87", "W88"),
    # Quarterfinals
    "97": ("W89", "W90"),
    "98": ("W91", "W92"),
    "99": ("W93", "W94"),
    "100": ("W95", "W96"),
    # Semifinals
    "101": ("W97", "W98"),
    "102": ("W99", "W100"),
    # 3rd place
    "103": ("L101", "L102"),
    # Final
    "104": ("W101", "W102"),
}

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
    pA, pB, pS = _parse(pick.get("goalsA")), _parse(pick.get("goalsB")), pick.get("advanceSide", "")
    rA, rB, rS = _parse(result.get("goalsA")), _parse(result.get("goalsB")), result.get("advanceSide", "")
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


def build_html(state, test_mode=False):
    entries     = state.get("entries", [])
    paid        = state.get("paid", {})
    deleted_ids = set(state.get("deletedIds", []))
    results     = {k: v for k, v in state.get("results", {}).items() if v.get("advanceSide")}

    real_entries = [
        e for e in entries
        if e.get("id") not in deleted_ids
        and not (e.get("diagnostics") or {}).get("demo")
    ]

    # Compute scores
    scored = sorted(
        [{"e": e, "total": score_entry_total(e, results)} for e in real_entries],
        key=lambda x: -x["total"]
    )

    # ── Completed matches section ─────────────────────────────────────────────
    match_rows_pt = ""
    match_rows_en = ""
    for mid, result in sorted(results.items(), key=lambda x: int(x[0])):
        teamA, teamB = MATCH_TEAMS.get(mid, ("Time A", "Time B"))
        gA, gB = result["goalsA"], result["goalsB"]
        winner = teamB if result["advanceSide"] == "B" else teamA
        match_rows_pt += (
            f'<tr><td style="padding:7px 10px">M{mid}</td>'
            f'<td style="padding:7px 10px">{teamA} {gA}–{gB} {teamB}</td>'
            f'<td style="padding:7px 10px;color:#16a34a;font-weight:600">✓ {winner}</td></tr>'
        )
        match_rows_en += match_rows_pt  # same data, same language for scores

    # ── Per-match breakdown (most recent match only) ──────────────────────────
    last_mid = sorted(results.keys(), key=int)[-1] if results else None
    breakdown_rows_pt = ""
    breakdown_rows_en = ""
    if last_mid:
        last_result = results[last_mid]
        last_teamA, last_teamB = MATCH_TEAMS.get(last_mid, ("A", "B"))
        breakdown_scored = sorted(
            [
                {
                    "name": item["e"].get("entryName", "?"),
                    "pick": (item["e"].get("picks") or {}).get(last_mid),
                    "pts_match": score_match(
                        (item["e"].get("picks") or {}).get(last_mid) or {},
                        last_result,
                        teamA=last_teamA,
                        teamB=last_teamB,
                    ) if (item["e"].get("picks") or {}).get(last_mid) else (0, "sem palpite", "no pick"),
                }
                for item in scored
            ],
            key=lambda x: -x["pts_match"][0]
        )
        for row in breakdown_scored:
            p = row["pick"]
            pts, det_pt, det_en = row["pts_match"]
            pick_team = last_teamB if p.get("advanceSide") == "B" else last_teamA
            pick_str = f'{int(p["goalsA"])}–{int(p["goalsB"])} ({pick_team})' if p else "—"
            color = pts_color(pts)
            breakdown_rows_pt += (
                f'<tr><td style="padding:6px 10px">{row["name"]}</td>'
                f'<td style="padding:6px 10px;text-align:center">{pick_str}</td>'
                f'<td style="padding:6px 10px;text-align:center;font-weight:700;color:{color}">{pts}</td>'
                f'<td style="padding:6px 10px;font-size:11px;color:#6b7280">{det_pt}</td></tr>'
            )
            breakdown_rows_en += (
                f'<tr><td style="padding:6px 10px">{row["name"]}</td>'
                f'<td style="padding:6px 10px;text-align:center">{pick_str}</td>'
                f'<td style="padding:6px 10px;text-align:center;font-weight:700;color:{color}">{pts}</td>'
                f'<td style="padding:6px 10px;font-size:11px;color:#6b7280">{det_en}</td></tr>'
            )

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

    # ── Assemble HTML ─────────────────────────────────────────────────────────
    test_banner = (
        '<div style="background:#fef3c7;border:2px dashed #f59e0b;padding:12px;border-radius:8px;'
        'text-align:center;margin-bottom:16px;font-weight:700">⚠️ EMAIL DE TESTE / TEST EMAIL</div>'
        if test_mode else ""
    )

    matches_games = len(results)
    remaining = 32 - matches_games

    thead_style = 'style="background:#f1f5f9"'
    th = 'style="padding:8px 10px;text-align:left;font-weight:600;color:#374151"'
    tbl = 'style="width:100%;border-collapse:collapse;background:white;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;margin-bottom:20px"'

    last_match_label_pt = f"Último jogo (M{last_mid})" if last_mid else ""
    last_match_label_en = f"Latest match (M{last_mid})" if last_mid else ""
    last_teamA_str, last_teamB_str = MATCH_TEAMS.get(last_mid, ("A","B")) if last_mid else ("","")
    last_result_str = ""
    if last_mid:
        r = results[last_mid]
        winner_name = last_teamB_str if r["advanceSide"] == "B" else last_teamA_str
        last_result_str = f'{last_teamA_str} {r["goalsA"]}–{r["goalsB"]} {last_teamB_str} · {winner_name} avança / advances'

    html = f"""
<div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a">

  {test_banner}

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

    <!-- Resultado do último jogo -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">{last_match_label_pt}</div>
      <div style="font-size:16px;font-weight:700">{last_result_str.split("·")[0].strip() if last_result_str else "—"}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ {winner_name + " avança" if last_mid else ""}</div>
    </div>

    <!-- Pontuação do último jogo -->
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Pontuação — {last_match_label_pt}</div>
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

    <!-- Ranking -->
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Ranking atual ({matches_games} de 32 jogos)</div>
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

    <!-- Latest match result -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">{last_match_label_en}</div>
      <div style="font-size:16px;font-weight:700">{last_result_str.split("·")[0].strip() if last_result_str else "—"}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ {winner_name + " advances" if last_mid else ""}</div>
    </div>

    <!-- Scoring breakdown -->
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Scoring — {last_match_label_en}</div>
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

    <!-- Current ranking -->
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Current ranking ({matches_games} of 32 matches played)</div>
    <table {tbl}>
      <thead><tr {thead_style}>
        <th {th} style="text-align:center">#</th>
        <th {th}>Entry</th>
        <th {th} style="text-align:center">Total</th>
      </tr></thead>
      <tbody>{ranking_rows}</tbody>
    </table>

    <!-- Footer -->
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
def send_email(addr, entry_names, html):
    body = json.dumps({
        "service_id":      EMAILJS_SVC,
        "template_id":     EMAILJS_TMPL,
        "user_id":         EMAILJS_KEY,
        "template_params": {
            "to_email":    addr,
            "entry_name":  entry_names,
            "receipt_code": SUBJECT,
            "html_message": html,
        }
    }).encode()
    req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    test_mode = "--test" in sys.argv
    args = sys.argv[1:]

    # --update <mid> <goalsA> <goalsB> <advanceSide>
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
        print(f"  Supabase upsert status: {status}")

    print("Fetching state from Supabase...")
    state = sb_fetch()

    results = {k: v for k, v in state.get("results", {}).items() if v.get("advanceSide")}
    if not results:
        print("No completed knockout results found in Supabase. Nothing to send.")
        return

    print(f"Completed matches: {sorted(results.keys(), key=int)}")

    # Build subject from last completed match
    last_mid = sorted(results.keys(), key=int)[-1]
    last_r   = results[last_mid]
    last_tA, last_tB = MATCH_TEAMS.get(last_mid, ("A", "B"))
    email_subject = f"Resultado Parcial — M{last_mid}: {last_tA} {last_r['goalsA']}–{last_r['goalsB']} {last_tB}"

    html = build_html(state, test_mode=test_mode)

    entries     = state.get("entries", [])
    deleted_ids = set(state.get("deletedIds", []))

    def valid_email(e):
        em = (e.get("participantEmail") or "").strip()
        return "@" in em and "." in em.split("@")[-1]

    real_entries = [
        e for e in entries
        if e.get("id") not in deleted_ids
        and not (e.get("diagnostics") or {}).get("demo")
        and valid_email(e)
    ]

    if test_mode:
        recipients = {ADMIN_EMAIL: {"addr": ADMIN_EMAIL, "names": email_subject}}
        print(f"\n⚠️  TEST MODE — sending only to {ADMIN_EMAIL}")
    else:
        recipients = {}
        for e in real_entries:
            key = (e.get("participantEmail") or "").strip().lower()
            recipients.setdefault(key, {"addr": e["participantEmail"], "names": email_subject})
        print(f"\nSending to {len(recipients)} recipients...")

    sent, errors = 0, []
    for key, data in recipients.items():
        try:
            status = send_email(data["addr"], data["names"], html)
            print(f"  OK {status} → {data['addr']}  [{data['names']}]")
            sent += 1
            time.sleep(3)
        except Exception as ex:
            errors.append(f"{data['addr']}: {ex}")
            print(f"  ERR → {data['addr']}: {ex}")

    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors")
    for err in errors:
        print(f"  ERROR: {err}")


if __name__ == "__main__":
    main()
