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
from pathlib import Path

# Football-hardening checkpoint F: wires this script's real send path into the shared
# checkpoint-D outbox (bolao/shared/scripts/notification_outbox.py, same on-disk JSON schema and
# idempotency-key format as the JS reconciler's notification_outbox.mjs — see
# test_notification_outbox_interop.mjs). Purely additive duplicate-prevention, same pattern as
# bolao/cdb2026/scripts/send_result_email.py's identical wiring: can only ever SKIP a send that
# repeats an already-"sent" idempotency key, never suppress a send that would have gone out
# before this change existed, never alters scoring/ranking/email content. See _send_to_all().
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "shared" / "scripts"))
import notification_outbox as outbox

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL  = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY      = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
EMAILJS_URL   = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY   = "GBZFujsJBET6modve"
EMAILJS_SVC   = "service_o4hyzxr"
EMAILJS_TMPL  = "template_xq7yzzb"
ADMIN_EMAIL   = "emferrari@gmail.com"
CDB_INVITE_URL    = "https://ferrarilabs.github.io/bolao/cdb2026/"
CDB_WHATSAPP_URL  = "https://chat.whatsapp.com/JF7lLG6HNjLIvC8p3Z8EVi?mode=gi_t"

EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao/copa2026/",
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
    "89": ("Canada", "Morocco"),      "90": ("Paraguay", "France"),
    "91": ("Brazil", "Norway"),       "92": ("Mexico", "England"),
    "93": ("Spain", "Portugal"),      "94": ("Belgium", "United States"),
    "95": ("W87", "W86"),             "96": ("W85", "W88"),
    # Quarterfinals
    "97": ("W89", "W90"), "98": ("W93", "W94"),
    "99": ("W91", "W92"), "100": ("W95", "W96"),
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


def any_copa_match_live():
    """Returns the earliest live match's kickoff ISO string if any Copa 2026 match is currently
    in-progress on ESPN, else None. Used both as a truthy "is anything live" check (unchanged call
    sites) AND, since CDB2026 hit a real incident from NOT having this (2026-08-04 — see
    send_result_email.py in bolao/cdb2026/scripts/, same architecture, "EXATAMENTE igual Copa do
    Mundo"), as the anchor for run_auto()'s live-monitoring deadline. Dormant for Copa itself (the
    tournament is concluded, archived, no more live matches are possible), kept in sync purely for
    cross-app consistency in case this code is ever reused."""
    url = (
        "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/"
        "scoreboard?limit=300&dates=20260611-20260719"
    )
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
    live_dates = [
        e.get("competitions", [{}])[0].get("date") or e.get("date")
        for e in data.get("events", [])
        if e.get("competitions", [{}])[0].get("status", {}).get("type", {}).get("state") == "in"
    ]
    live_dates = [d for d in live_dates if d]
    return min(live_dates) if live_dates else None


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
    req = urllib.request.Request(url)
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
        candidates = [(comp, comps, ed) for comp, comps, ed in event_map[key] if ed >= min_date]
        if not candidates:
            continue
        comp, comps, ev_date = candidates[0]

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

        found[str(mid)] = {"goalsA": gA, "goalsB": gB, "advanceSide": side, "desc": desc,
                            "date": ev_date, "teamA": tA, "teamB": tB}

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
    # Update meta.updatedAt so the app's timestamp-based sync guards detect
    # the change and trigger a re-render on all connected browsers.
    if "meta" not in state or not isinstance(state["meta"], dict):
        state["meta"] = {}
    state["meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
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
    if "meta" not in state or not isinstance(state["meta"], dict):
        state["meta"] = {}
    state["meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
    status = _sb_upsert(state)
    if had_result:
        print(f"M{mid} removido do Supabase (tombstone adicionado). Status: {status}")
    else:
        print(f"M{mid} já não existia em results. Tombstone adicionado. Status: {status}")


# ── Scoring ───────────────────────────────────────────────────────────────────
# Mirrors app.js's parseScore() exactly: digits only, 0-20 range. Previously
# this accepted anything int() would (negatives, no upper bound) — a
# malformed value the browser would reject could still be silently scored
# here, another way the site and the email could disagree.
def _parse(v):
    s = str(v).strip() if v is not None else ""
    if not re.match(r'^\d+$', s):
        return None
    n = int(s)
    return n if 0 <= n <= 20 else None


def score_match(pick, result, teamA="Time A", teamB="Time B", mid=None):
    """Returns (pts, detail_pt, detail_en) for one match.

    mid: when "103" or "104", the +5 "advance" note uses match-appropriate wording instead of
    "avança"/"advances" -- Eduardo, 2026-07-19: "fala 'time xyz avança', mas nos dois últimos
    jogos isso não existe (avançar) — a pontuação sim, mas é uma questão apenas de semântica."
    M103 (3rd place) and M104 (Final) are the last matches of the bracket for that side; nobody
    "advances" anywhere from them. Wording only -- the +5 points themselves are unchanged."""
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
        if str(mid) == "103":
            notes_pt.append(f"+{SCORING['advance']} {winner} vence a disputa de 3º lugar")
            notes_en.append(f"+{SCORING['advance']} {winner} wins the 3rd place match")
        elif str(mid) == "104":
            notes_pt.append(f"+{SCORING['advance']} {winner} vence a Final")
            notes_en.append(f"+{SCORING['advance']} {winner} wins the Final")
        else:
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
    total += podium_bonus_points(entry, results)
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
    """Real champion/runner-up (once M104 is decided) and/or 3rd/4th (once M103 is decided) --
    the two halves are independent of each other, since a participant can earn the 3rd-place
    bonus without the champion being known yet, and vice versa.

    Eduardo, 2026-07-19: "O email pos jogo foi enviado sem o bonus do 3 lugar por que" -- M103
    concluded (real result: France 4x6 England) but M104 (Final) hadn't been played yet. This
    function used to require BOTH champion (from M104) AND third (from M103) to be known before
    returning anything at all -- so with only M103 decided, it returned None, and
    podium_bonus_points()/podium_hits() silently paid out ZERO bonus to everyone, including the
    2 real entries (Simone Hirle #4, Gabriel Ferrari) who had correctly predicted England for 3rd.
    Fixed to return as soon as EITHER half is known, with the still-undecided half left as None --
    podium_bonus_points()/podium_hits() already check each of champion/runnerUp/third/fourth
    independently, so a partial result here was always safe to consume, only the gate above was
    wrong."""
    fin, trd = results.get("104"), results.get("103")
    champion = runner_up = third = fourth = None
    if fin and fin.get("advanceSide"):
        tA, tB = _real_teams("104", results)
        champion, runner_up = (tB, tA) if fin["advanceSide"] == "B" else (tA, tB)
    if trd and trd.get("advanceSide"):
        tA, tB = _real_teams("103", results)
        third, fourth = (tB, tA) if trd["advanceSide"] == "B" else (tA, tB)
    if champion or third:
        return {"champion": champion, "runnerUp": runner_up, "third": third, "fourth": fourth}
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

    champion = runner_up = third = fourth = None
    fin_pick, trd_pick = picks.get("104"), picks.get("103")
    if fin_pick:
        a, b = resolve_slot(MATCH_TEAMS["104"][0]), resolve_slot(MATCH_TEAMS["104"][1])
        champion, runner_up = (b, a) if fin_pick.get("advanceSide") == "B" else (a, b)
    if trd_pick:
        a, b = resolve_slot(MATCH_TEAMS["103"][0]), resolve_slot(MATCH_TEAMS["103"][1])
        third, fourth = (b, a) if trd_pick.get("advanceSide") == "B" else (a, b)
    return {"champion": champion, "runnerUp": runner_up, "third": third, "fourth": fourth}


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


# Bonus points for correctly predicting champion/runner-up/3rd/4th — mirrors
# CONFIG.bonus in config.js and the bonus block in app.js's scoreEntry()
# exactly. This was previously entirely missing from the email/CSV pipeline:
# podium_hits() only ever fed the tiebreak order, never added points to the
# total, so once the tournament reaches the final, entries with a correct
# podium pick would show a HIGHER total on the website (which does add these
# points) than in the result emails (which didn't) — the exact kind of
# mismatch that causes "duvidas" about which number is right.
BONUS = {"champion": 25, "runnerUp": 15, "third": 10, "fourth": 5}


def podium_bonus_points(entry, results):
    real_pod = _podium_from_results(results)
    if not real_pod:
        return 0
    pick_pod = _entry_predicted_podium(entry)
    pts = 0
    if pick_pod["champion"] and pick_pod["champion"] == real_pod["champion"]:
        pts += BONUS["champion"]
    if pick_pod["runnerUp"] and pick_pod["runnerUp"] == real_pod["runnerUp"]:
        pts += BONUS["runnerUp"]
    if pick_pod["third"] and pick_pod["third"] == real_pod["third"]:
        pts += BONUS["third"]
    if pick_pod["fourth"] and pick_pod["fourth"] == real_pod["fourth"]:
        pts += BONUS["fourth"]
    return pts


def match_podium_bonus_note(entry, mid, results):
    """Podium bonus contributed by exactly ONE match (M103 -> third+fourth, M104 -> champion+
    runnerUp), plus a human-readable note -- used ONLY to itemize the per-match breakdown row
    shown in build_html() (never for the aggregate total; podium_bonus_points() on the whole
    entry stays the single source of truth for that).

    Eduardo, 2026-07-19, after the correction email: "Email foi mais uma vez incorreto sem o
    bonus." The total in the ranking table WAS already correct (score_entry_total() includes
    podium_bonus_points()) -- but the per-match breakdown row for M103 only ever showed the base
    5 pts ("+5 England avança"), with the +10 podium bonus folded silently into the total further
    down the email with no line connecting the two. Reasonable to read that first table and
    conclude the bonus was still missing. Mirrors the same fold-into-displayed-points design
    already used for the live/provisional preview (liveMatchPoints()), for consistency."""
    if mid not in ("103", "104"):
        return 0, "", ""
    real_pod = _podium_from_results(results)
    if not real_pod:
        return 0, "", ""
    pred = _entry_predicted_podium(entry)
    pts = 0
    notes_pt, notes_en = [], []
    if mid == "103":
        if pred["third"] and real_pod["third"] and pred["third"] == real_pod["third"]:
            pts += BONUS["third"]
            notes_pt.append(f"+{BONUS['third']} bônus 3º lugar")
            notes_en.append(f"+{BONUS['third']} 3rd place bonus")
        if pred["fourth"] and real_pod["fourth"] and pred["fourth"] == real_pod["fourth"]:
            pts += BONUS["fourth"]
            notes_pt.append(f"+{BONUS['fourth']} bônus 4º lugar")
            notes_en.append(f"+{BONUS['fourth']} 4th place bonus")
    else:
        if pred["champion"] and pred["champion"] == real_pod["champion"]:
            pts += BONUS["champion"]
            notes_pt.append(f"+{BONUS['champion']} bônus campeão")
            notes_en.append(f"+{BONUS['champion']} champion bonus")
        if pred["runnerUp"] and pred["runnerUp"] == real_pod["runnerUp"]:
            pts += BONUS["runnerUp"]
            notes_pt.append(f"+{BONUS['runnerUp']} bônus vice-campeão")
            notes_en.append(f"+{BONUS['runnerUp']} runner-up bonus")
    return pts, ", ".join(notes_pt), ", ".join(notes_en)


# Prêmio do BOLÃO (quem ganha dinheiro) — mirrors finalPodiumPayouts() in app.js exactly.
# Eduardo: "Isso tem que estar no email também que será enviado após os dois jogos!"
# (2026-07-18). Do NOT confuse with BONUS/_podium_from_results() above (campeão/vice/3º/4º do
# MUNDIAL, used only for score bonus points) — this is about the top-3 finishers of the BOLÃO's
# own ranking (people, by total points), which had never been computed anywhere before. Prizes
# config mirrors CONFIG.prizes in config.js (70/20/10%); pot is entries paid so far × entryFee
# (Eduardo confirmed 2026-07-18: no more payments expected at this point in the tournament).
PRIZES     = {"first": 0.70, "second": 0.20, "third": 0.10}
ENTRY_FEE  = 5


def compute_final_payouts(state, results):
    """Only returns a result once M103 (3rd place) AND M104 (Final) are both locked -- before
    that the bolão's own final standings don't exist yet. Groups genuine ties (same
    total/exact/podium -- NOT the name-based display tiebreak used to order who's listed first
    within a tied group) and splits that position's prize evenly, per the site's own documented
    rule ("a posição e o prêmio daquela colocação são divididos entre os empatados")."""
    if not (results.get("103", {}).get("advanceSide") and results.get("104", {}).get("advanceSide")):
        return None
    deleted  = set(state.get("deletedIds", []))
    entries  = [e for e in state.get("entries", [])
                if e.get("id") not in deleted and not (e.get("diagnostics") or {}).get("demo")]
    if not entries:
        return None
    paid_count = sum(1 for e in state.get("entries", []) if state.get("paid", {}).get(e.get("id")))
    pot = paid_count * ENTRY_FEE
    if not pot:
        return None

    scored = sorted(
        [{"e": e, "total": score_entry_total(e, results), "exact": exact_match_count(e, results),
          "podium": podium_hits(e, results)} for e in entries],
        key=lambda x: (-x["total"], -x["exact"], -x["podium"]),
    )

    by_rank = {1: [], 2: [], 3: []}
    rank, prev_key = 0, None
    for i, item in enumerate(scored):
        key = (item["total"], item["exact"], item["podium"])
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
            payouts.append({"entryName": item["e"].get("entryName", "?"), "rank": r,
                             "amount": amount, "tied": len(group) > 1})
    return {"pot": pot, "payouts": payouts}


def build_podium_html(payouts_info, real_podium=None):
    """Bilingual PT/EN podium reveal block — prepended to the M104 email only once
    compute_final_payouts() confirms the tournament is fully decided. Kept as a separate
    function (not folded into build_html()) so a normal per-match email is never accidentally
    affected.

    real_podium: _podium_from_results(saved) — the real champion/runnerUp/third TEAMS (not
    picks). Used only for the "Assim como <time>..." congrats line (Eduardo, 2026-07-18): a
    creative pairing between the real World Cup podium and the bolão's own money podium, purely
    cosmetic copy, does not affect payouts/scoring in any way."""
    medal   = {1: "🥇", 2: "🥈", 3: "🥉"}
    label_pt = {1: "Campeão", 2: "Vice-campeão", 3: "3º lugar"}
    label_en = {1: "Champion", 2: "Runner-up", 3: "3rd place"}
    team_for_rank = {1: (real_podium or {}).get("champion"), 2: (real_podium or {}).get("runnerUp"), 3: (real_podium or {}).get("third")}

    def _amount(a):
        s = f"{a:.2f}"
        return s[:-3] if s.endswith(".00") else s

    def _congrats(item, lang):
        team = team_for_rank.get(item["rank"])
        if not team:
            return ""
        name = item["entryName"]
        if lang == "pt":
            text = f"Parabéns, {name}! Assim como {team}, você também é {label_pt[item['rank']]} — só que do nosso bolão! 🏆"
        else:
            text = f"Congrats, {name}! Just like {team}, you're also the {label_en[item['rank']]} — of our bolão! 🏆"
        return f'<div style="font-size:11px;color:#374151;margin-top:6px;font-style:italic">{text}</div>'

    def _card(item, lang_label, tied_note, lang):
        note = f'<div style="font-size:11px;color:#9ca3af;margin-top:4px">{tied_note}</div>' if item["tied"] else ""
        return f"""<div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center">
      <div style="font-size:30px;line-height:1;margin-bottom:6px">{medal[item['rank']]}</div>
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px">{lang_label[item['rank']]}</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">{item['entryName']}</div>
      <div style="font-size:22px;font-weight:900;color:#16a34a">${_amount(item['amount'])}</div>
      {note}
      {_congrats(item, lang)}
    </div>"""

    cards_pt = "".join(_card(p, label_pt, "Empate — valor dividido entre os empatados", "pt") for p in payouts_info["payouts"])
    cards_en = "".join(_card(p, label_en, "Tied — amount split between tied entries", "en") for p in payouts_info["payouts"])

    return f"""
  <div style="background:linear-gradient(135deg,#78350f,#451a03);border:2px solid #f59e0b;border-radius:14px;padding:22px 18px;margin-bottom:22px;text-align:center">
    <div style="font-size:20px;font-weight:900;color:white;margin-bottom:16px">🏆 Resultado Final do Bolão! · 🏆 Final Bolão Result!</div>
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fde68a;margin-bottom:8px">Português</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      {cards_pt}
    </div>
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fde68a;margin-bottom:8px">English</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      {cards_en}
    </div>
    <div style="font-size:13px;color:#fde68a;margin-bottom:14px">
      Obrigado a todos que participaram! Foi um prazer acompanhar a Copa com vocês.<br>
      Thanks to everyone who played! It was a pleasure following the World Cup with you all.
    </div>
    <div style="font-size:11px;color:#fbbf2480">Pote total / Total pot: ${_amount(payouts_info['pot'])}</div>
  </div>
"""


def build_cdb_invite_html():
    """Bilingual PT/EN invite block for the Copa do Brasil 2026 bolão (CDB2026) — appended ONLY
    to the true final email (both M103 and M104 locked, tournament fully decided), right after
    the podium reveal. Eduardo, 2026-07-19: "just send at the end of the last match ... add the
    invite to the new bolao" — same email as the final result, not a separate send. CDB2026 is a
    real, already-open product (not a teaser): real entries, real Supabase/EmailJS, real upcoming
    cutoff (Round of 16 kicks off 2026-08-01) — see CONSISTENCY_MATRIX.md 2026-07-19 publish note.
    Public URL confirmed OK to share directly (Eduardo, 2026-07-19: "You can put the public
    link, no problem")."""
    return f"""
  <div style="max-width:640px;margin:0 auto 22px;background:#ffffff;border:2px solid #059669;border-radius:14px;padding:22px 24px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
    <div style="font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#059669;margin-bottom:6px">
      &#127941; Novo bol&atilde;o &middot; New bol&atilde;o
    </div>
    <h2 style="margin:0 0 10px;font-size:20px;color:#111827">Entre no Bol&atilde;o da Copa do Brasil! &middot; Join the Copa do Brasil bol&atilde;o!</h2>
    <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#374151">
      Como o Brasileir&atilde;o 2026 j&aacute; fechou as entradas, abrimos o <b>Bol&atilde;o da Copa
      do Brasil 2026</b> &mdash; mesmo formato de mata-mata desta Copa, com times reais do futebol
      brasileiro. J&aacute; estamos nas Oitavas de Final, com os primeiros jogos a partir de
      <b>01/08/2026</b> &mdash; ainda d&aacute; tempo de entrar!
    </p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#6b7280">
      Since BR2026 already closed entries, we opened the <b>Copa do Brasil 2026 bol&atilde;o</b>
      &mdash; same knockout format as this one, with real Brazilian club teams. We're already in
      the Round of 16, with the first games starting <b>Aug 1, 2026</b> &mdash; still time to join!
    </p>
    <ul style="margin:0 0 14px;padding-left:18px;font-size:13.5px;line-height:1.7;color:#374151">
      <li>Entrada / Entry: <b>US$5</b> &mdash; mesmo Cash App / Zelle / Venmo de sempre</li>
      <li>Premia&ccedil;&atilde;o / Prizes: 70% 1&ordm; &middot; 20% 2&ordm; &middot; 10% 3&ordm;</li>
    </ul>
    <div style="text-align:center;margin:16px 0 6px">
      <a href="{CDB_INVITE_URL}" style="display:inline-block;background:#059669;color:#ffffff;font-weight:800;font-size:14.5px;text-decoration:none;padding:12px 26px;border-radius:9px">
        Fazer meu palpite &middot; Make my picks &rarr;
      </a>
    </div>
    <div style="text-align:center;font-size:12px;color:#9ca3af">
      <a href="{CDB_INVITE_URL}" style="color:#059669;text-decoration:none">ferrarilabs.github.io/bolao/cdb2026/</a>
      &nbsp;&middot;&nbsp;
      <a href="{CDB_WHATSAPP_URL}" style="color:#059669;text-decoration:none">Grupo do WhatsApp</a>
    </div>
  </div>
"""


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

    # Tiebreak cascade: total -> exact -> podium hits, same as the site's own
    # renderRanking(). Still tied after all three? Display-only 4th level:
    # reverse alphabetical (Z->A) by entry name, uppercased and compared by
    # plain code-point order (no locale collation) -- must match the JS side
    # exactly, since Eduardo asked for both to be identical.
    def _entry_name_key(item):
        return (item["e"].get("entryName") or "").upper()

    scored = sorted(
        [{"e": e, "total": score_entry_total(e, results), "exact": exact_match_count(e, results),
          "podium": podium_hits(e, results)}
         for e in real_entries],
        key=lambda x: (-x["total"], -x["exact"], -x["podium"]),
    )
    # Python's sort is stable, so re-sorting only within each fully-tied group
    # (same total/exact/podium) by reverse name preserves the cascade above
    # while breaking remaining ties Z->A.
    i = 0
    while i < len(scored):
        j = i
        key = (scored[i]["total"], scored[i]["exact"], scored[i]["podium"])
        while j < len(scored) and (scored[j]["total"], scored[j]["exact"], scored[j]["podium"]) == key:
            j += 1
        scored[i:j] = sorted(scored[i:j], key=_entry_name_key, reverse=True)
        i = j

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
            [{"name": item["e"].get("entryName", "?"), "entry": item["e"],
              "pick": (item["e"].get("picks") or {}).get(last_mid)}
             for item in scored],
            key=lambda x: -(score_match(x["pick"] or {}, last_result,
                                        teamA=last_tA, teamB=last_tB, mid=last_mid)[0]
                            if x["pick"] else 0)
        )
        for row in breakdown_scored:
            p = row["pick"]
            if p:
                pts, det_pt, det_en = score_match(p, last_result, teamA=last_tA, teamB=last_tB, mid=last_mid)
                bonus_pts, bonus_pt, bonus_en = match_podium_bonus_note(row["entry"], last_mid, results)
                if bonus_pts:
                    pts += bonus_pts
                    det_pt = f"{det_pt}, {bonus_pt}" if det_pt != "—" else bonus_pt
                    det_en = f"{det_en}, {bonus_en}" if det_en != "—" else bonus_en
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
    # Eduardo, 2026-07-19: nobody "advances" from M103/M104, those are the bracket's last matches.
    winner_verb_pt = "vence a disputa de 3º lugar" if str(last_mid) == "103" else "vence a Final" if str(last_mid) == "104" else "avança"
    winner_verb_en = "wins the 3rd place match" if str(last_mid) == "103" else "wins the Final" if str(last_mid) == "104" else "advances"

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
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ {winner_name + " " + winner_verb_pt if winner_name else ""}</div>
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
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ {winner_name + " " + winner_verb_en if winner_name else ""}</div>
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
      <a href="https://ferrarilabs.github.io/bolao/copa2026/" style="color:#1d4ed8;text-decoration:none">ferrarilabs.github.io/bolao/copa2026/</a>
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


def _send_to_all(state, html, subject, *, match_id=None, result_version=1):
    """Send to all valid recipients. Returns (sent_count, error_list).

    Football-hardening checkpoint F: when `match_id` is supplied, every recipient's send is
    routed through the shared outbox first — a job with the SAME idempotency key
    (copa2026:{match_id}:{recipient}:v{result_version}) already recorded "sent" is skipped, not
    repeated. Backward compatible: match_id=None (the default) is the exact pre-checkpoint-F
    behavior, zero outbox involvement."""
    recipients = _build_recipients(state)
    print(f"Sending to {len(recipients)} recipients...")
    sent, errors, skipped = 0, [], 0
    for _, addr in recipients.items():
        job = None
        if match_id is not None:
            key = outbox.idempotency_key("copa2026", match_id, addr, result_version)
            existing = outbox.find_by_idempotency_key(key)
            if existing and existing.get("status") == "sent":
                print(f"  SKIP (duplicate — already sent, idempotency key {key}) → {addr}")
                skipped += 1
                continue
            job, _created = outbox.enqueue({
                "app": "copa2026", "matchId": match_id, "recipient": addr, "resultVersion": result_version,
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
def run_auto():
    """
    Check ESPN for completed matches not yet in Supabase (all rounds).
    Save + email each new match in chronological order.
    Idempotent — already-saved matches are skipped.
    """
    print("AUTO — running scoring/ranking self-audit before touching anything...")
    import audit_scoring
    audit_ok, _ = audit_scoring.run_static_audit(sys.modules[__name__], verbose=True)
    if not audit_ok:
        print("\n🛑 SELF-AUDIT FAILED — refusing to send any emails until this is fixed.")
        print("This usually means the bracket mapping or scoring logic has drifted from app.js.")
        sys.exit(1)
    print("✓ Self-audit passed.\n")

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

    new_mids = sorted([m for m in espn if m not in saved_ids], key=int)

    if not new_mids:
        # No new completed match yet — check if a game is live and wait for it
        try:
            live_kickoff_iso = any_copa_match_live()
            if live_kickoff_iso:
                # Anchored to the live match's REAL kickoff time, not to time.time() at loop
                # start — see any_copa_match_live()'s docstring and the real CDB2026 incident
                # (2026-08-04) this mirrors the fix for. 130min = 90 regulation + ~15 halftime +
                # ~10 stoppage + margin. Dormant here (Copa concluded, no more live matches).
                try:
                    deadline = datetime.fromisoformat(live_kickoff_iso.replace("Z", "+00:00")).timestamp() + 130 * 60
                except (ValueError, TypeError):
                    deadline = time.time() + 80 * 60  # kickoff iso missing/unparseable — old behavior as a fallback, not the norm
                print("Jogo ao vivo detectado — monitorando até terminar (poll a cada 2 min, prazo ancorado no kickoff real)...")
                while time.time() < deadline:
                    remaining = int((deadline - time.time()) / 60)
                    print(f"  [{remaining} min restantes] Aguardando 120s...")
                    time.sleep(120)
                    try:
                        espn2 = fetch_espn_results(saved_results=saved)
                    except Exception as ex:
                        print(f"  ESPN re-fetch falhou: {ex} — continuando loop")
                        continue
                    new_mids = sorted([m for m in espn2 if m not in saved_ids], key=int)
                    if new_mids:
                        espn = espn2
                        print(f"  Jogo(s) finalizado(s): {[f'M{m}' for m in new_mids]}!")
                        break
                    # Check if still live; if not, exit early
                    try:
                        if not any_copa_match_live():
                            print("  Nenhum jogo ao vivo detectado. Encerrando monitoramento.")
                            break
                    except Exception:
                        pass
                else:
                    print("Monitoramento encerrado por timeout (prazo ancorado no kickoff esgotado). Próximo cron tentará novamente.")
                    return
                if not new_mids:
                    print("Nenhum resultado detectado após monitoramento. Encerrando.")
                    return
            else:
                print("ESPN: nenhum jogo novo ou ao vivo. Nada a fazer.")
                return
        except Exception as ex:
            print(f"Verificação de jogo ao vivo falhou: {ex} — encerrando normalmente.")
            return

    print(f"ESPN completed: {sorted(espn.keys(), key=int)}")

    print(f"New:            {[f'M{m}' for m in new_mids]}")

    # Double-check before trusting a freshly-detected "final" result enough to
    # email everyone: re-fetch ESPN a second time after a short pause and
    # require the score + advanceSide to match exactly. ESPN occasionally
    # flags a match "post" with a winner a beat before a late correction
    # lands (VAR overturn, stat fix) — this catches that instead of emailing
    # a wrong score. A mismatch just skips the match for this run; the next
    # cron tick (10 min later) picks it up once ESPN's data has settled.
    print("AUTO — re-checking ESPN after 20s to confirm result is stable before emailing...")
    time.sleep(20)
    try:
        espn_confirm = fetch_espn_results(saved_results=saved)
    except Exception as ex:
        print(f"ESPN re-check fetch failed: {ex} — skipping this cycle, will retry next run.")
        return

    confirmed_mids = []
    for mid in new_mids:
        r1, r2 = espn[mid], espn_confirm.get(mid)
        if not (r2 and r1["goalsA"] == r2["goalsA"] and r1["goalsB"] == r2["goalsB"] and r1["advanceSide"] == r2["advanceSide"]):
            print(f"  WARN M{mid}: result not stable across two checks ({r1} vs {r2}) — skipping for now, will retry next run.")
            continue

        # Per-match runtime sanity check — guards against the specific failure
        # mode that happened before (CHANGELOG: "Resultados somente do banco
        # de dados"): a result appearing for a match that hasn't actually been
        # played. Never trust a "confirmed stable" result blindly.
        real_ok, real_detail = audit_scoring.check_match_is_real(mid, r2.get("date"), r2.get("teamA"), r2.get("teamB"))
        shape_ok, shape_detail = audit_scoring.check_result_shape(r2)
        if not (real_ok and shape_ok):
            print(f"  🛑 WARN M{mid}: failed runtime sanity check — {real_detail} {shape_detail} — skipping, will NOT save or email.")
            continue

        confirmed_mids.append(mid)

    if not confirmed_mids:
        print("No matches confirmed stable. Nothing to do this cycle.")
        return

    new_mids = confirmed_mids
    print(f"Confirmed stable: {[f'M{m}' for m in new_mids]}")

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

        # M104 (Final) is only the bolão's true final result once M103 (3rd place) is
        # also locked -- compute_final_payouts() enforces that itself. Eduardo, 2026-07-18.
        if mid == "104":
            payouts_info = compute_final_payouts(state, saved)
            if payouts_info:
                real_podium = _podium_from_results(saved)
                html = build_podium_html(payouts_info, real_podium) + html + build_cdb_invite_html()
                subj = f"🏆 Resultado Final do Bolão! · Final Bolão Result! — {tA} {r['goalsA']}–{r['goalsB']} {tB}"
                print(f"  🏆 Tournament complete — including podium/prize block ({len(payouts_info['payouts'])} payouts, pot ${payouts_info['pot']})")
                print(f"  🏅 Also including Copa do Brasil 2026 (CDB2026) invite block")

        sent, errors = _send_to_all(state, html, subj, match_id=f"M{mid}")
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
    sent, errors = _send_to_all(state, html, subject, match_id=f"M{last_mid}")
    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors")
    for err in errors:
        print(f"  ERROR: {err}")


if __name__ == "__main__":
    main()
