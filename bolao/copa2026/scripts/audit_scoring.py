"""
audit_scoring.py — Bolão do Ferrari scoring/ranking self-audit.

Run standalone:
  python3 audit_scoring.py

Run automatically from send_result_email.py:
  --auto refuses to send ANY email until the static self-test suite below
  passes, and each individual match result is re-validated at runtime
  (event date not in the future, teams fully resolved, result shape sane)
  right before it's trusted enough to save + email. See run_static_audit()
  and check_match_is_real() / check_result_shape().

Why this exists: a July 2026 audit (prompted by a participant questioning
a rank change) found send_result_email.py had silently drifted from the
site's own scoring logic — a wrong Round of 16 bracket mapping and missing
podium bonus points (see CHANGELOG v4.57). Eduardo's standing rule after
that: this must be checked before every auto-send, not just once by hand.
There was also an earlier incident (CHANGELOG, "Resultados somente do
banco de dados") where stale/test data on another device populated a
result for a match that hadn't actually happened — check_match_is_real()
guards against that class of bug specifically.
"""
import re
import sys
from datetime import datetime, timezone


def _load_datajs_bracket(datajs_path):
    """Parses bolao/js/data.js's knockoutMatches into {mid: (teamA, teamB)},
    normalizing 'Winner Match N' / 'Loser Match N' to the same 'WN'/'LN'
    shorthand send_result_email.py's MATCH_TEAMS uses."""
    with open(datajs_path) as f:
        src = f.read()
    start = src.index('knockoutMatches: [')
    end = src.index('\n  ]', start)
    block = src[start:end]
    rows = re.findall(r'\{match:"(\d+)",.*?teamA:"([^"]*)",teamB:"([^"]*)"', block)

    def norm(s):
        m = re.match(r'^Winner Match (\d+)$', s)
        if m:
            return f"W{m.group(1)}"
        m = re.match(r'^Loser Match (\d+)$', s)
        if m:
            return f"L{m.group(1)}"
        return s

    return {mid: (norm(a), norm(b)) for mid, a, b in rows}


def check_bracket_matches_datajs(match_teams, datajs_path=None):
    """MATCH_TEAMS must mirror data.js's knockoutMatches exactly, pair by pair."""
    if datajs_path is None:
        from pathlib import Path
        datajs_path = Path(__file__).resolve().parent.parent / "js" / "data.js"
    try:
        datajs = _load_datajs_bracket(datajs_path)
    except Exception as ex:
        return False, f"could not parse data.js at {datajs_path}: {ex}"

    if not datajs:
        return False, "parsed zero matches from data.js — parser may be broken"

    mismatches = []
    for mid in sorted(datajs, key=int):
        expected = set(datajs[mid])
        actual = set(match_teams.get(mid, ()))
        if expected != actual:
            mismatches.append(f"M{mid}: data.js={datajs[mid]} vs MATCH_TEAMS={match_teams.get(mid)}")
    if mismatches:
        return False, f"{len(mismatches)} mismatch(es): " + " | ".join(mismatches)
    if set(datajs) != set(match_teams):
        missing = set(datajs) - set(match_teams)
        extra = set(match_teams) - set(datajs)
        return False, f"key set differs — missing={missing} extra={extra}"
    return True, ""


def check_perfect_bracket_simulation(mod):
    """Full mock tournament: an entry that picks the same side to advance in
    every match must have its predicted podium exactly match the real one,
    and its total must equal (match points) + full podium bonus (55)."""
    results = {mid: {"goalsA": 2, "goalsB": 0, "advanceSide": "A"} for mid in mod.MATCH_TEAMS}
    picks = {mid: {"goalsA": 2, "goalsB": 0, "advanceSide": "A"} for mid in mod.MATCH_TEAMS}
    entry = {"id": "audit-perfect", "entryName": "Audit Perfect Bracket", "picks": picks}

    real_pod = mod._podium_from_results(results)
    pred_pod = mod._entry_predicted_podium(entry)
    if real_pod is None:
        return False, "real podium failed to resolve (champion/third missing) — bracket chain broken"
    if real_pod != pred_pod:
        return False, f"perfect-pick entry's predicted podium doesn't match real podium: {pred_pod} vs {real_pod}"

    bonus = mod.podium_bonus_points(entry, results)
    if bonus != 55:
        return False, f"expected full bonus 55 (25+15+10+5), got {bonus}"

    hits = mod.podium_hits(entry, results)
    if hits != 3:
        return False, f"expected 3 podium hits (champion/runnerUp/third, 4th excluded), got {hits}"

    expected_match_pts = 15 * len(mod.MATCH_TEAMS)  # exact score (10) + advance (5) each
    total = mod.score_entry_total(entry, results)
    if total != expected_match_pts + 55:
        return False, f"total={total}, expected {expected_match_pts}+55={expected_match_pts+55}"

    return True, ""


def check_bonus_and_fourth_present(mod):
    """Guards specifically against the two bugs found in the July 2026 audit:
    bonus points missing from score_entry_total, and 4th place dropped from
    the podium dicts."""
    results = {mid: {"goalsA": 1, "goalsB": 0, "advanceSide": "A"} for mid in mod.MATCH_TEAMS}
    picks = {mid: {"goalsA": 1, "goalsB": 0, "advanceSide": "A"} for mid in mod.MATCH_TEAMS}
    entry = {"id": "audit-fourth", "entryName": "Audit Fourth", "picks": picks}

    real_pod = mod._podium_from_results(results)
    if not real_pod or "fourth" not in real_pod or real_pod["fourth"] is None:
        return False, f"_podium_from_results missing 'fourth': {real_pod}"
    pred_pod = mod._entry_predicted_podium(entry)
    if "fourth" not in pred_pod or pred_pod["fourth"] is None:
        return False, f"_entry_predicted_podium missing 'fourth': {pred_pod}"

    without_bonus = sum(
        mod.score_match(picks[mid], results[mid])[0] for mid in mod.MATCH_TEAMS
    )
    with_bonus = mod.score_entry_total(entry, results)
    if with_bonus <= without_bonus:
        return False, (f"score_entry_total ({with_bonus}) should exceed raw match "
                        f"points ({without_bonus}) once podium is decided — bonus not being added")
    return True, ""


def check_partial_podium_bonus(mod):
    """Guards against the bug found 2026-07-19: 3rd-place bonus withheld until the Final was
    ALSO decided, even though M103 alone was already fully resolved. Eduardo: "O email pos jogo
    foi enviado sem o bonus do 3 lugar por que" -- real entries (Simone Hirle #4, Gabriel
    Ferrari) each missed 10 pts because _podium_from_results() required BOTH champion (M104) AND
    third (M103) before returning anything at all. The existing check_bonus_and_fourth_present()
    above always locks the WHOLE bracket (M73-M104) at once, so it never exercised this partial
    state -- this check specifically locks only through M103, leaving M104 undecided."""
    only_up_to_103 = {mid: {"goalsA": 1, "goalsB": 0, "advanceSide": "A"}
                       for mid in mod.MATCH_TEAMS if int(mid) <= 103}
    picks = {mid: {"goalsA": 1, "goalsB": 0, "advanceSide": "A"} for mid in mod.MATCH_TEAMS}
    entry = {"id": "audit-partial", "entryName": "Audit Partial", "picks": picks}

    real_pod = mod._podium_from_results(only_up_to_103)
    if not real_pod:
        return False, "_podium_from_results returned nothing with only M103 decided (M104 still pending) — 3rd/4th bonus would be silently withheld"
    if real_pod.get("third") is None:
        return False, f"_podium_from_results has no 'third' even though M103 is locked: {real_pod}"

    without_bonus = sum(
        mod.score_match(picks[mid], only_up_to_103[mid])[0]
        for mid in mod.MATCH_TEAMS if mid in only_up_to_103
    )
    with_bonus = mod.score_entry_total(entry, only_up_to_103)
    if with_bonus <= without_bonus:
        return False, (f"score_entry_total ({with_bonus}) should exceed raw match points "
                        f"({without_bonus}) once M103 alone is decided — 3rd/4th bonus not applied independently of M104")
    return True, ""


def check_parse_bounds(mod):
    """Score parser must reject exactly what the browser's parseScore() rejects."""
    cases = [
        ("3", 3), (3, 3), ("0", 0), ("20", 20),
        ("-1", None), ("21", None), ("", None), (None, None),
        ("3.5", None), ("abc", None), ("  4  ", 4),
    ]
    for v, expected in cases:
        got = mod._parse(v)
        if got != expected:
            return False, f"_parse({v!r}) = {got!r}, expected {expected!r}"
    return True, ""


def check_tiebreak_order(mod):
    """Sort must be total DESC, then exact-score-count DESC, then podium-hits DESC,
    then (display-only, for entries still fully tied) reverse-alphabetical (Z->A)
    entry name — same cascade as app.js's renderRanking()."""
    results = {"73": {"goalsA": 1, "goalsB": 0, "advanceSide": "A"}}
    entries = [
        {"id": "a", "entryName": "A", "picks": {"73": {"goalsA": 1, "goalsB": 0, "advanceSide": "A"}}},  # 15 pts, 1 exact
        {"id": "b", "entryName": "B", "picks": {"73": {"goalsA": 2, "goalsB": 0, "advanceSide": "A"}}},  # 5+1=6 pts, 0 exact
    ]
    scored = sorted(
        [{"e": e, "total": mod.score_entry_total(e, results), "exact": mod.exact_match_count(e, results),
          "podium": mod.podium_hits(e, results)} for e in entries],
        key=lambda x: (-x["total"], -x["exact"], -x["podium"])
    )
    if scored[0]["e"]["id"] != "a":
        return False, f"expected entry 'a' (higher total) ranked first, got order: {[s['e']['id'] for s in scored]}"

    # Fully-tied entries (same total/exact/podium) must fall back to
    # reverse-alphabetical (Z->A) order, matching app.js's renderRanking().
    tied = [
        {"e": {"entryName": "Roberta"}, "total": 111, "exact": 3, "podium": 1},
        {"e": {"entryName": "Simone Hirle #4"}, "total": 111, "exact": 3, "podium": 1},
        {"e": {"entryName": "Rodrigo Hajj"}, "total": 111, "exact": 3, "podium": 1},
    ]
    tied_sorted = sorted(tied, key=lambda x: (-x["total"], -x["exact"], -x["podium"]))
    i = 0
    while i < len(tied_sorted):
        j = i
        key = (tied_sorted[i]["total"], tied_sorted[i]["exact"], tied_sorted[i]["podium"])
        while j < len(tied_sorted) and (tied_sorted[j]["total"], tied_sorted[j]["exact"], tied_sorted[j]["podium"]) == key:
            j += 1
        tied_sorted[i:j] = sorted(tied_sorted[i:j], key=lambda x: (x["e"].get("entryName") or "").upper(), reverse=True)
        i = j
    tied_names = [x["e"]["entryName"] for x in tied_sorted]
    expected = ["Simone Hirle #4", "Rodrigo Hajj", "Roberta"]
    if tied_names != expected:
        return False, f"expected fully-tied entries in Z->A order {expected}, got {tied_names}"
    return True, ""


def check_scoring_constants_match_config(config_path=None):
    """The perfect-bracket simulation's expected-total math (`15 * len(MATCH_TEAMS)`,
    see check_perfect_bracket_simulation) hardcodes 15 = exactScore(10) + advance(5) as a
    literal instead of reading config.js. Today the two agree; if config.js's scoring values
    were ever changed, this audit would keep reporting PASS while real payouts diverged
    underneath it -- the same class of drift CLAUDE.md's v4.57 postmortem exists to prevent.
    This doesn't rewrite the formula (bigger, riskier change) -- it fails loudly if the
    hardcoded assumption and config.js ever disagree, matching the existing
    check_match_is_real()/check_result_shape() pattern of a static assertion over a full
    rewrite."""
    if config_path is None:
        from pathlib import Path
        config_path = Path(__file__).parent.parent / "js" / "config.js"
    with open(config_path) as f:
        src = f.read()
    m_exact = re.search(r'exactScore:\s*(\d+)', src)
    m_advance = re.search(r'\badvance:\s*(\d+)', src)
    if not m_exact or not m_advance:
        return False, "could not find scoring.exactScore/advance in config.js"
    exact_score, advance = int(m_exact.group(1)), int(m_advance.group(1))
    hardcoded = 15  # kept in sync with check_perfect_bracket_simulation's `15 * len(MATCH_TEAMS)`
    if exact_score + advance != hardcoded:
        return False, (f"config.js scoring (exactScore={exact_score} + advance={advance}="
                        f"{exact_score+advance}) no longer matches the hardcoded per-match "
                        f"total ({hardcoded}) the perfect-bracket simulation assumes")
    return True, ""


def run_static_audit(mod, verbose=True):
    """Runs every check above against the given send_result_email module.
    Returns (all_passed: bool, [(name, ok, detail), ...])."""
    checks = [
        ("Bracket mirrors data.js", lambda: check_bracket_matches_datajs(mod.MATCH_TEAMS)),
        ("Perfect-bracket simulation resolves end-to-end", lambda: check_perfect_bracket_simulation(mod)),
        ("Bonus points + 4th place present and applied", lambda: check_bonus_and_fourth_present(mod)),
        ("Partial podium (M103 only) still applies its own bonus", lambda: check_partial_podium_bonus(mod)),
        ("Score parser bounds match the site's", lambda: check_parse_bounds(mod)),
        ("Tiebreak sort order (total, exact, podium)", lambda: check_tiebreak_order(mod)),
        ("Hardcoded scoring constants match config.js", lambda: check_scoring_constants_match_config()),
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


def check_match_is_real(mid, event_date_str, team_a, team_b):
    """
    Runtime, per-match check right before a result is trusted enough to
    save + email. Catches the historical failure mode: a result appearing
    for a match that hasn't actually been played (stale cache, test data,
    an ESPN glitch, a timezone bug).
    """
    problems = []
    ev_date = None
    try:
        ev_date = datetime.strptime((event_date_str or "")[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        problems.append(f"unparseable event date {event_date_str!r}")
    if ev_date and ev_date.date() > datetime.now(timezone.utc).date():
        problems.append(f"event date {event_date_str} is in the future — match can't have finished yet")
    if re.match(r'^[WL]\d+$', str(team_a)) or re.match(r'^[WL]\d+$', str(team_b)):
        problems.append(f"team slot still unresolved: {team_a!r} vs {team_b!r}")
    if not team_a or not team_b or team_a == team_b:
        problems.append(f"invalid team pairing: {team_a!r} vs {team_b!r}")
    return (not problems), "; ".join(problems)


def check_result_shape(result):
    """The result dict itself must be well-formed before it's trusted."""
    problems = []
    for k in ("goalsA", "goalsB"):
        v = result.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or v < 0 or v > 20:
            problems.append(f"{k}={v!r} out of range/invalid")
    if result.get("advanceSide") not in ("A", "B"):
        problems.append(f"advanceSide={result.get('advanceSide')!r} invalid")
    return (not problems), "; ".join(problems)


if __name__ == "__main__":
    import send_result_email as sre
    print("Running scoring/ranking static self-audit...\n")
    ok, _ = run_static_audit(sre, verbose=True)
    print("\n" + ("✓ ALL CHECKS PASSED" if ok else "✗ AUDIT FAILED — see above"))
    sys.exit(0 if ok else 1)
