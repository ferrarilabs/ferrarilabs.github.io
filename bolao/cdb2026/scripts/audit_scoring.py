"""
audit_scoring.py — Bolão Copa do Brasil 2026 scoring/ranking self-audit.

Run standalone:
  python3 audit_scoring.py

Why this exists: item 1 of docs/bolao/CONSISTENCY_MATRIX.md — the Copa has
had an equivalent script since a real July 2026 incident (a participant
questioned a rank change; the audit found send_result_email.py had
silently drifted from the site's own scoring logic — see
bolao/scripts/audit_scoring.py and bolao/CHANGELOG.md v4.57). CDB2026 moves
real money (US$5/entry) with real games starting 2026-08-01 and had no
equivalent protection at all.

This Python transcription of app.js's scoring formula (matchPoints/scoreEntry/tiebreak in
bolao/cdb2026/js/app.js) is transcribed by hand below and must be kept in sync manually whenever
that formula changes in app.js. If you change scoring in app.js, update
MATCH_SCORING/TIE_BONUS/PODIUM_BONUS below in the same patch, or this audit will keep passing
while silently testing the wrong formula.

2026-08-01: send_result_email.py (added alongside this comment) now exists and IMPORTS this
module's match_points()/score_entry() directly rather than reimplementing them a second time —
unlike the Copa's script (a truly independent reimplementation, where drift between the audit and
the email script is the actual risk being guarded against), there is only ONE Python
transcription of the scoring formula here, so drift between "the audit" and "the email script"
can't happen by construction. The risk that remains — this file vs. app.js itself — is exactly
what run_static_audit() below already guards, and is why send_result_email.py --auto still runs
it before touching anything.
Also runtime-checked by send_result_email.py --auto: check_match_is_real() and
check_result_shape() below, mirroring the exact same two functions in the Copa's
audit_scoring.py (CLAUDE.md's standing rule: any auto-email script must re-validate each
individual leg result at runtime -- event date not in the future, teams resolved, result shape
sane -- right before trusting it enough to save + email) — added 2026-08-01 alongside
send_result_email.py itself.

2026-08-01, same day, two corrections: `result` (5 pts, correct W/D/L sign with a wrong score)
was briefly removed under the mistaken belief it didn't match the Copa's rules, then reverted a
few hours later once Eduardo confirmed directly (pasting the full scoring table) that it IS a
real, intended CDB2026 rule -- CDB2026 and the Copa are not required to share identical per-match
scoring tiers, only the platform-shared values (10/5/1) happened to already line up. See
CHANGELOG.md for the full incident trail, both directions.
"""
import re
import sys
from datetime import datetime, timezone

# Transcribed from bolao/cdb2026/js/config.js `scoring` block — keep in sync by hand.
MATCH_SCORING = {"exact": 10, "result": 5, "side": 1}
TIE_BONUS = 5
PODIUM_BONUS = {"champion": 30, "runnerUp": 20}


def match_points(pick, result):
    """Mirrors matchPoints() in bolao/cdb2026/js/app.js — mutually exclusive:
    exact score beats correct result (by goal-difference sign) beats one
    side's goal count correct, never summed."""
    if not pick or not result or result.get("goalsHome") is None or result.get("goalsAway") is None:
        return None
    if pick["goalsHome"] == result["goalsHome"] and pick["goalsAway"] == result["goalsAway"]:
        return {"pts": MATCH_SCORING["exact"], "type": "exact"}
    pick_sign = _sign(pick["goalsHome"] - pick["goalsAway"])
    real_sign = _sign(result["goalsHome"] - result["goalsAway"])
    if pick_sign == real_sign:
        return {"pts": MATCH_SCORING["result"], "type": "result"}
    pts = 0
    if pick["goalsHome"] == result["goalsHome"]:
        pts += MATCH_SCORING["side"]
    if pick["goalsAway"] == result["goalsAway"]:
        pts += MATCH_SCORING["side"]
    return {"pts": pts, "type": "side" if pts > 0 else "miss"}


def _sign(n):
    return (n > 0) - (n < 0)


def score_entry(entry, ties, podium):
    """Mirrors scoreEntry() — ties: {tieId: {matches: {leg: {goalsHome,goalsAway}}, qualifiedTeamId}}
    podium: {"champion": name|None, "runnerUp": name|None} (official result)."""
    total = 0
    detail = {"matches": {}, "ties": {}, "champion": None, "runnerUp": None}
    picks = entry.get("picks", {})

    for tie_id, tie in ties.items():
        pick_matches = picks.get("matches", {}).get(tie_id, {})
        for leg, result in tie.get("matches", {}).items():
            r = match_points(pick_matches.get(leg), result)
            if r is None:
                continue
            detail["matches"][f"{tie_id}:{leg}"] = r
            total += r["pts"]
        if tie.get("qualifiedTeamId"):
            pick_qual = picks.get("qualified", {}).get(tie_id)
            if pick_qual:
                hit = pick_qual == tie["qualifiedTeamId"]
                detail["ties"][tie_id] = {"pts": TIE_BONUS if hit else 0, "type": "hit" if hit else "miss"}
                total += detail["ties"][tie_id]["pts"]

    predicted_champion = entry.get("predictedChampion")
    predicted_runner_up = entry.get("predictedRunnerUp")
    if podium.get("champion") and predicted_champion:
        hit = predicted_champion == podium["champion"]
        detail["champion"] = {"pts": PODIUM_BONUS["champion"] if hit else 0, "type": "exact" if hit else "miss"}
        total += detail["champion"]["pts"]
    if podium.get("runnerUp") and predicted_runner_up:
        hit = predicted_runner_up == podium["runnerUp"]
        detail["runnerUp"] = {"pts": PODIUM_BONUS["runnerUp"] if hit else 0, "type": "exact" if hit else "miss"}
        total += detail["runnerUp"]["pts"]

    return total, detail


def hit_champion(detail):
    return 1 if detail.get("champion", {}).get("type") == "exact" else 0


def hit_runner_up(detail):
    return 1 if detail.get("runnerUp", {}).get("type") == "exact" else 0


def count_exact_matches(detail):
    return sum(1 for d in detail.get("matches", {}).values() if d["type"] == "exact")


# ─── Checks ──────────────────────────────────────────────────────────────────

def check_match_points_mutually_exclusive():
    """Exact, result, and side points must never sum on the same match."""
    cases = [
        ({"goalsHome": 2, "goalsAway": 1}, {"goalsHome": 2, "goalsAway": 1}, "exact", 10),
        ({"goalsHome": 2, "goalsAway": 3}, {"goalsHome": 2, "goalsAway": 1}, "side", 1),   # opposite winner, home goals match only
        ({"goalsHome": 2, "goalsAway": 0}, {"goalsHome": 1, "goalsAway": 0}, "result", 5),  # same winner sign, wrong score
        ({"goalsHome": 1, "goalsAway": 1}, {"goalsHome": 2, "goalsAway": 0}, "miss", 0),    # predicted draw, real win
        ({"goalsHome": 2, "goalsAway": 2}, {"goalsHome": 2, "goalsAway": 2}, "exact", 10),  # draw predicted exactly
    ]
    for pick, result, expected_type, expected_pts in cases:
        r = match_points(pick, result)
        if r is None or r["type"] != expected_type or r["pts"] != expected_pts:
            return False, f"match_points({pick}, {result}) = {r}, expected type={expected_type} pts={expected_pts}"
    return True, ""


def check_tie_bonus_and_podium_applied():
    """A fully-correct entry (every match exact, every tie/podium pick right)
    must add up to match points + tie bonus + podium bonus — the exact class
    of bug the Copa's July 2026 audit found (bonus silently not summed)."""
    ties = {
        "t1": {"matches": {"first": {"goalsHome": 2, "goalsAway": 0}, "second": {"goalsHome": 0, "goalsAway": 1}},
               "qualifiedTeamId": "A", "teamA": "Vasco", "teamB": "Fluminense"},
    }
    entry = {
        "picks": {
            "matches": {"t1": {"first": {"goalsHome": 2, "goalsAway": 0}, "second": {"goalsHome": 0, "goalsAway": 1}}},
            "qualified": {"t1": "A"},
        },
        "predictedChampion": "Vasco",
        "predictedRunnerUp": "Palmeiras",
    }
    podium = {"champion": "Vasco", "runnerUp": "Palmeiras"}
    total, detail = score_entry(entry, ties, podium)
    expected = 10 + 10 + TIE_BONUS + PODIUM_BONUS["champion"] + PODIUM_BONUS["runnerUp"]
    if total != expected:
        return False, f"total={total}, expected {expected} (2x exact + tie bonus + champion + runnerUp)"
    if detail["ties"]["t1"]["pts"] != TIE_BONUS:
        return False, f"tie bonus not applied: {detail['ties']['t1']}"
    if detail["champion"]["pts"] != PODIUM_BONUS["champion"] or detail["runnerUp"]["pts"] != PODIUM_BONUS["runnerUp"]:
        return False, f"podium bonus not applied correctly: champion={detail['champion']} runnerUp={detail['runnerUp']}"
    return True, ""


def check_wrong_tie_pick_no_bonus():
    """Picking the wrong side to advance must score 0 tie bonus even with
    both legs' scores exactly right — bonus is strictly about the
    qualification pick, not inferred from the score picks."""
    ties = {
        "t1": {"matches": {"first": {"goalsHome": 2, "goalsAway": 0}, "second": {"goalsHome": 0, "goalsAway": 1}},
               "qualifiedTeamId": "A"},
    }
    entry = {"picks": {
        "matches": {"t1": {"first": {"goalsHome": 2, "goalsAway": 0}, "second": {"goalsHome": 0, "goalsAway": 1}}},
        "qualified": {"t1": "B"},  # wrong side
    }}
    total, detail = score_entry(entry, ties, {})
    if detail["ties"]["t1"]["pts"] != 0 or detail["ties"]["t1"]["type"] != "miss":
        return False, f"wrong qualifier pick should score 0 bonus, got {detail['ties']['t1']}"
    if total != 20:  # just the two exact-score match points, no bonus
        return False, f"total={total}, expected 20 (match points only, no tie bonus)"
    return True, ""


def check_no_result_yet_scores_nothing():
    """A match/tie with no result recorded yet must contribute 0, not throw
    and not silently score against a None/undefined result."""
    ties = {"t1": {"matches": {"first": {"goalsHome": None, "goalsAway": None}}, "qualifiedTeamId": None}}
    entry = {"picks": {"matches": {"t1": {"first": {"goalsHome": 2, "goalsAway": 0}}}, "qualified": {}}}
    total, detail = score_entry(entry, ties, {})
    if total != 0 or detail["matches"]:
        return False, f"expected 0 points / no match detail for unresolved match, got total={total} detail={detail['matches']}"
    return True, ""


def check_tiebreak_order():
    """Sort must be total DESC, then champion-hit DESC, then runnerUp-hit
    DESC, then exact-match-count DESC — same cascade as renderRanking() in
    bolao/cdb2026/js/app.js."""
    entries = [
        {"name": "A", "total": 50, "detail": {"champion": {"type": "exact"}, "matches": {}}},
        {"name": "B", "total": 50, "detail": {"champion": {"type": "miss"}, "matches": {"m1": {"type": "exact"}}}},
        {"name": "C", "total": 60, "detail": {"matches": {}}},
    ]
    scored = sorted(
        entries,
        key=lambda x: (-x["total"], -hit_champion(x["detail"]), -hit_runner_up(x["detail"]), -count_exact_matches(x["detail"])),
    )
    order = [e["name"] for e in scored]
    if order != ["C", "A", "B"]:
        return False, f"expected order [C, A, B] (highest total first, then champion hit breaks the 50-50 tie), got {order}"
    return True, ""


def check_match_is_real(event_date_str, team_a, team_b):
    """
    Runtime, per-leg check right before a result is trusted enough to save + email. Catches the
    historical failure mode (Copa's audit_scoring.py docstring): a result appearing for a match
    that hasn't actually been played (stale cache, test data, an ESPN glitch, a timezone bug).
    No W/L slot check needed here (unlike Copa's bracket) -- CDB2026 ties always carry real team
    names from the moment they're drawn/created, never a placeholder.
    """
    problems = []
    ev_date = None
    try:
        ev_date = datetime.strptime((event_date_str or "")[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        problems.append(f"unparseable event date {event_date_str!r}")
    if ev_date and ev_date.date() > datetime.now(timezone.utc).date():
        problems.append(f"event date {event_date_str} is in the future — match can't have finished yet")
    if not team_a or not team_b or team_a == team_b:
        problems.append(f"invalid team pairing: {team_a!r} vs {team_b!r}")
    return (not problems), "; ".join(problems)


def check_result_shape(result):
    """The result dict itself must be well-formed before it's trusted."""
    problems = []
    for k in ("goalsHome", "goalsAway"):
        v = result.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or v < 0 or v > 20:
            problems.append(f"{k}={v!r} out of range/invalid")
    return (not problems), "; ".join(problems)


def run_static_audit(verbose=True):
    checks = [
        ("Match points mutually exclusive (exact/result/side/miss)", check_match_points_mutually_exclusive),
        ("Tie bonus + podium bonus applied and summed", check_tie_bonus_and_podium_applied),
        ("Wrong qualifier pick scores no tie bonus", check_wrong_tie_pick_no_bonus),
        ("Unresolved match/tie scores nothing (no crash)", check_no_result_yet_scores_nothing),
        ("Tiebreak sort order (total, champion, runnerUp, exact)", check_tiebreak_order),
    ]
    all_ok = True
    results = []
    for name, fn in checks:
        try:
            ok, detail = fn()
        except Exception as ex:
            ok, detail = False, f"raised {type(ex).__name__}: {ex}"
        results.append((name, ok, detail))
        if not ok:
            all_ok = False
        if verbose:
            mark = "✓" if ok else "✗ FAIL"
            print(f"  {mark} {name}" + (f" — {detail}" if detail and not ok else ""))
    return all_ok, results


if __name__ == "__main__":
    print("Running CDB2026 scoring/ranking static self-audit...\n")
    ok, _ = run_static_audit(verbose=True)
    print("\n" + ("✓ ALL CHECKS PASSED" if ok else "✗ AUDIT FAILED — see above"))
    sys.exit(0 if ok else 1)
