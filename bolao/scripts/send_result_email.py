"""
send_result_email.py — Bolão Ferrari Copa 2026
Sends a bilingual PT/EN score-update email to all participants after each match.

Usage:
  python3 send_result_email.py                              # send about latest saved result
  python3 send_result_email.py --update 89 2 1 A            # save result to Supabase only
  python3 send_result_email.py --auto                       # check ESPN, save+email any new results
  python3 send_result_email.py --clear-result 91            # remove a result + tombstone it

--update <mid> <goalsA> <goalsB> <advanceSide(A|B)>
  Writes the result to Supabase and exits. Run without flag to send emails.

--auto
  Fetches ESPN, detects matches not yet in Supabase, saves and emails each one.
  Covers all rounds (R32 through Final). Idempotent — skips already-saved matches.

--clear-result <mid>
  Removes a result from Supabase and adds it to deletedResults tombstone list so
  the site respects the removal even if it has the result cached in localStorage.
"""

import json, re, sys, time, urllib.request
from datetime import datetime, timezone, timedelta

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
    "Referer": "https://ferrarilabs.github.io/bolao/",
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

# Earliest date each knockout round can produce a completed match.
# Used to reject group-stage events that share the same team pair as a future knockout slot.
# Group stage ends 2026-06-28; R32 starts 2026-06-29.
ROUND_MIN_DATE = {
    **{str(m): "2026-06-28" for m in range(73, 89)},   # R32 — first match (M73) played June 28
    **{str(m): "2026-07-04" for m in range(89, 97)},   # R16
    **{str(m): "2026-07-08" for m in range(97, 101)},  # QF
    **{str(m): "2026-07-13" for m in range(101, 103)}, # SF
    **{str(m): "2026-07-17" for m in range(103, 105)}, # 3rd/Final
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

# ── Team slot resolution (W73 → actual team name) ─────────────────────────────
def _resolve_team(slot, results, _depth=0):
    """
    Resolve 'W73' or 'L101' → actual team name using saved Supabase results.
    Returns None if the prerequisite match hasn't been played yet.
    Handles recursive resolution (e.g. W89 = winner of M89 = winner of W73 vs W74).
    """
    if _depth > 8:
        return None  # cycle guard
    m = re.match(r'^([WL])(\d+)$', str(slot))
    if not m:
        return slot  # already a real team name
    prefix, mid = m.group(1), m.group(2)
    result = results.get(mid)
    if not result or not result.get("advanceSide"):
        return None  # match not played yet
    tA_raw, tB_raw = MATCH_TEAMS.get(mid, (slot, slot))
    tA = _resolve_team(tA_raw, results, _depth + 1) or tA_raw
    tB = _resolve_team(tB_raw, results, _depth + 1) or tB_raw
    if result["advanceSide"] == "B":
        return tB if prefix == "W" else tA
    else:
        return tA if prefix == "W" else tB


def _real_teams(mid, results):
    """Return (teamA, teamB) for a match, resolving W/L slots to actual names."""
    tA_raw, tB_raw = MATCH_TEAMS.get(str(mid), ("A", "B"))
    return (
        _resolve_team(tA_raw, results) or tA_raw,
        _resolve_team(tB_raw, results) or tB_raw,
    )


# ── ESPN helpers ──────────────────────────────────────────────────────────────
def _espn_normalize(name):
    return ESPN_ALIASES.get(name, name)


def fetch_espn_results(saved_results=None):
    """
    Fetches ESPN scoreboard and returns completed match results for all rounds.
    saved_results: {mid: result} from Supabase — used to resolve W/L slots for R16+.
    Returns: dict {match_id_str: {goalsA, goalsB, advanceSide, desc}}
    """
    saved_results = saved_results or {}
    url = (
        "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/"
        "scoreboard?limit=300&dates=20260611-20260719"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())

    # Index ESPN events by frozenset of normalized team names.
    # One pair can appear multiple times (group stage + knockout), so store a list.
    event_map: dict[frozenset, list] = {}
    for e in data.get("events", []):
        comp  = e.get("competitions", [{}])[0]
        comps = comp.get("competitors", [])
        if len(comps) < 2:
            continue
        names     = frozenset(_espn_normalize(c.get("team", {}).get("displayName", "")) for c in comps)
        event_date = e.get("date", "")[:10]  # "2026-06-26"
        event_map.setdefault(names, []).append((comp, comps, event_date))

    found = {}
    for mid in sorted(MATCH_TEAMS.keys(), key=int):
        tA_raw, tB_raw = MATCH_TEAMS[mid]
        # Resolve slots to actual team names using saved results
        tA = _resolve_team(tA_raw, saved_results) or tA_raw
        tB = _resolve_team(tB_raw, saved_results) or tB_raw
        # Skip if teams aren't known yet (prerequisite match unplayed)
        if re.match(r'^[WL]\d+$', tA) or re.match(r'^[WL]\d+$', tB):
            continue

        key = frozenset({tA, tB})
        if key not in event_map:
            continue

        # Filter to events on or after this round's earliest possible date.
        # Prevents group-stage matches (same teams, earlier date) from being
        # mistaken for knockout results.
        min_date = ROUND_MIN_DATE.get(str(mid), "2026-06-29")
        candidates = [(comp, comps) for comp, comps, ed in event_map[key] if ed >= min_date]
        if not candidates:
            continue
        comp, comps = candidates[0]

        st = comp.get("status", {}).get("type", {})
        if st.get("state") != "post":
            continue

        desc    = st.get("description", "")
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


def _sb_upsert(state):
    """Write full state blob to Supabase. Returns HTTP status."""
    body = json.dumps({"id": "main", "state": state}).encode()
    req  = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state",
        data=body, method="POST",
        headers={
            "apikey":          ANON_KEY,
            "Authorization":   f"Bearer {ANON_KEY}",
            "Content-Type":    "application/json",
            "Prefer":          "resolution=merge-duplicates",
        }
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status


def sb_update_result(mid, goalsA, goalsB, advanceSide):
    """Upsert a single match result into Supabase. advanceSide: 'A' or 'B'."""
    state   = sb_fetch()
    results = state.get("results") or {}
    results[str(mid)] = {
        "goalsA":       int(goalsA),
        "goalsB":       int(goalsB),
        "advanceSide":  advanceSide.upper(),
    }
    # Remove from tombstone if it was previously cleared
    deleted = set(state.get("deletedResults") or [])
    deleted.discard(str(mid))
    state["results"] = results
    state["deletedResults"] = sorted(deleted)
    return _sb_upsert(state)


def sb_clear_result(mid):
    """Remove a result from Supabase and tombstone it so the site respects the removal."""
    mid = str(mid)
    state   = sb_fetch()
    results = state.get("results") or {}
    deleted = set(state.get("deletedResults") or [])

    had_result = mid in results
    results.pop(mid, None)
    deleted.add(mid)

    state["results"] = results
    state["deletedResults"] = sorted(deleted)
    status = _sb_upsert(state)
    if had_result:
        print(f"M{mid} removido do Supabase (tombstone adicionado). Status: {status}")
    else:
        print(f"M{mid} já não existia em results. Tombstone adicionado. Status: {status}")


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


def _is_exact_pick(pick, result):
    pA, pB = _parse(pick.get("goalsA")), _parse(pick.get("goalsB"))
    rA, rB = _parse(result.get("goalsA")), _parse(result.get("goalsB"))
    if None in (pA, pB, rA, rB) or not result.get("advanceSide"):
        return False
    return pA == rA and pB == rB


def exact_match_count(entry, results):
    """Tiebreaker level 1: how many knockout matches this entry got the exact score right."""
    picks = entry.get("picks") or {}
    return sum(1 for mid, result in results.items() if _is_exact_pick(picks.get(mid) or {}, result))


def _podium_from_results(results):
    """Real champion/runner-up/3rd/4th once M104 (final) and M103 (3rd place) are decided."""
    fin, trd = results.get("104"), results.get("103")
    champion = runner_up = third = fourth = None
    if fin and fin.get("advanceSide"):
        tA, tB = _real_teams("104", results)
        champion, runner_up = (tB, tA) if fin["advanceSide"] == "B" else (tA, tB)
    if trd and trd.get("advanceSide"):
        tA, tB = _real_teams("103", results)
        third, fourth = (tB, tA) if trd["advanceSide"] == "B" else (tA, tB)
    if champion and third:
        return {"champion": champion, "runnerUp": runner_up, "third": third}
    return None


def _entry_predicted_podium(entry):
    """Champion/runner-up/3rd this entry's own bracket picks predict (independent of real results)."""
    picks = entry.get("picks") or {}
    winners, losers = {}, {}

    def resolve_slot(slot):
        m = re.match(r'^([WL])(\d+)$', str(slot))
        if not m:
            return slot
        prefix, mid = m.group(1), m.group(2)
        return (winners.get(mid) if prefix == "W" else losers.get(mid)) or slot

    for mid in sorted(MATCH_TEAMS.keys(), key=int):
        tA_raw, tB_raw = MATCH_TEAMS[mid]
        a, b = resolve_slot(tA_raw), resolve_slot(tB_raw)
        p = picks.get(mid)
        if p and p.get("advanceSide") == "A":
            winners[mid], losers[mid] = a, b
        elif p and p.get("advanceSide") == "B":
            winners[mid], losers[mid] = b, a

    champion = runner_up = third = None
    fin_pick, trd_pick = picks.get("104"), picks.get("103")
    if fin_pick:
        a, b = resolve_slot(MATCH_TEAMS["104"][0]), resolve_slot(MATCH_TEAMS["104"][1])
        champion, runner_up = (b, a) if fin_pick.get("advanceSide") == "B" else (a, b)
    if trd_pick:
        a, b = resolve_slot(MATCH_TEAMS["103"][0]), resolve_slot(MATCH_TEAMS["103"][1])
        third = b if trd_pick.get("advanceSide") == "B" else a
    return {"champion": champion, "runnerUp": runner_up, "third": third}


def podium_hits(entry, results):
    """Tiebreaker level 2: how many of champion/runner-up/3rd this entry got right (not 4th)."""
    real_pod = _podium_from_results(results)
    if not real_pod:
        return 0
    pick_pod = _entry_predicted_podium(entry)
    hits = 0
    if pick_pod["champion"] and pick_pod["champion"] == real_pod["champion"]:
        hits += 1
    if pick_pod["runnerUp"] and pick_pod["runnerUp"] == real_pod["runnerUp"]:
        hits += 1
    if pick_pod["third"] and pick_pod["third"] == real_pod["third"]:
        hits += 1
    return hits


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
    Team slots (W73, L101 etc.) are resolved to actual team names.
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
        [{"e": e, "total": score_entry_total(e, results), "exact": exact_match_count(e, results),
          "podium": podium_hits(e, results)}
         for e in real_entries],
        key=lambda x: (-x["total"], -x["exact"], -x["podium"])
    )

    last_mid = focus_mid or (sorted(results.keys(), key=int)[-1] if results else None)

    # ── Per-match breakdown ───────────────────────────────────────────────────
    breakdown_rows_pt = ""
    breakdown_rows_en = ""
    winner_name = ""
    result_str  = ""
    if last_mid and last_mid in results:
        last_result        = results[last_mid]
        last_tA, last_tB   = _real_teams(last_mid, results)
        winner_name        = last_tB if last_result["advanceSide"] == "B" else last_tA
        result_str         = f'{last_tA} {last_result["goalsA"]}–{last_result["goalsB"]} {last_tB}'

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
    prev_key = None
    rank = 0
    for i, item in enumerate(scored):
        key = (item["total"], item["exact"], item["podium"])
        if key != prev_key:
            rank = i + 1
        prev_key = key
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

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Ranking atual ({matches_played} jogos)</div>
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

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Current ranking ({matches_played} matches played)</div>
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
      <a href="https://ferrarilabs.github.io/bolao/" style="color:#1d4ed8;text-decoration:none">ferrarilabs.github.io/bolao/</a>
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
    Check ESPN for completed matches not yet in Supabase (all rounds).
    Save + email each new match in chronological order.
    Idempotent — already-saved matches are skipped.
    """
    print("AUTO — fetching Supabase state...")
    state        = sb_fetch()
    saved        = {k: v for k, v in state.get("results", {}).items() if v.get("advanceSide")}
    saved_ids    = set(saved.keys())
    print(f"Supabase has:   {sorted(saved_ids, key=int) if saved_ids else '(none)'}")

    print("AUTO — fetching ESPN results...")
    try:
        espn = fetch_espn_results(saved_results=saved)
    except Exception as ex:
        print(f"ESPN fetch failed: {ex}")
        sys.exit(1)

    if not espn:
        print("ESPN: no completed matches found.")
        return

    print(f"ESPN completed: {sorted(espn.keys(), key=int)}")

    new_mids = sorted([m for m in espn if m not in saved_ids], key=int)
    if not new_mids:
        print("No new matches. Nothing to do.")
        return

    print(f"New:            {[f'M{m}' for m in new_mids]}")

    for i, mid in enumerate(new_mids):
        r      = espn[mid]
        # Resolve team names (in case they were W/L slots before)
        tA, tB = _real_teams(mid, {**saved, mid: r})
        winner = tB if r["advanceSide"] == "B" else tA
        print(f"\n[M{mid}] {tA} {r['goalsA']}–{r['goalsB']} {tB} → {winner} avança  ({r['desc']})")

        sb_status = sb_update_result(mid, r["goalsA"], r["goalsB"], r["advanceSide"])
        print(f"  Supabase: {sb_status}")

        # Re-fetch so this result appears in ranking + can resolve next slots
        state  = sb_fetch()
        saved  = {k: v for k, v in state.get("results", {}).items() if v.get("advanceSide")}
        html   = build_html(state, focus_mid=mid)
        subj   = f"Resultado Parcial — M{mid}: {tA} {r['goalsA']}–{r['goalsB']} {tB}"

        sent, errors = _send_to_all(state, html, subj)
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

    # --clear-result <mid>  →  remove result + tombstone, no email
    if "--clear-result" in args:
        idx = args.index("--clear-result")
        try:
            mid = args[idx + 1]
        except IndexError:
            print("Usage: --clear-result <mid>")
            sys.exit(1)
        sb_clear_result(mid)
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
    tA, tB   = _real_teams(last_mid, results)
    subject  = f"Resultado Parcial — M{last_mid}: {tA} {r['goalsA']}–{r['goalsB']} {tB}"
    html     = build_html(state)

    print(f"Completed matches: {sorted(results.keys(), key=int)}")
    sent, errors = _send_to_all(state, html, subject)
    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors")
    for err in errors:
        print(f"  ERROR: {err}")


if __name__ == "__main__":
    main()
