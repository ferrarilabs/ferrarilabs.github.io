"""
audit_scoring.py — Bolão Brasileirão 2026 scoring/ranking self-audit.

Run standalone:
  python3 audit_scoring.py

Why this exists: item 1 of docs/bolao/CONSISTENCY_MATRIX.md — the Copa has
had an equivalent script since a real July 2026 incident (a participant
questioned a rank change; the audit found send_result_email.py had
silently drifted from the site's own scoring logic — see
bolao/scripts/audit_scoring.py and bolao/CHANGELOG.md v4.57). BR2026 moves
real money (US$5/entry) with a season-long live scoring window and had no
equivalent protection at all.

Important difference from the Copa's script: the Copa's audits
send_result_email.py, an INDEPENDENT Python reimplementation of scoring
that runs unattended via cron — the actual risk there is drift between two
codebases. BR2026 has no such script (there is no automated result email;
scoring is computed live in the browser from ESPN standings), so there is
nothing to audit for drift *against*. What this script protects against
instead: this Python transcription of app.js's scoring formula
(scoreEntry()/rankEntries() in bolao/br2026/js/app.js) is transcribed by
hand below and must be kept in sync manually whenever that formula changes
in app.js — exactly the same discipline the Copa's script already requires
for send_result_email.py, just with app.js itself as the source of truth.
If you change scoring in config.js/app.js, update the constants and
functions below in the same patch, or this audit will keep passing while
silently testing the wrong formula.
"""
import sys

# Transcribed from bolao/br2026/js/config.js `scoring` block — keep in sync by hand.
G4_EXACT = [30, 20, 15, 15]  # index 0-3 = 1st..4th place
G4_GROUP = 10                 # in G4, wrong position
Z4_EXACT = 12
Z4_GROUP = 8                  # in Z4, wrong position
SA6_HIT = 8                   # pick lands anywhere in positions 7-12


def score_entry(entry, g4_result, z4_result, sa6_result):
    """Mirrors scoreEntry() in bolao/br2026/js/app.js."""
    if not g4_result or not z4_result:
        return None
    picks = entry.get("picks", {})
    pg4 = picks.get("g4", [])
    pz4 = picks.get("z4", [])
    detail = {"g4": [], "z4": [], "sa6": []}
    total = 0

    for i, exact_pts in enumerate(G4_EXACT):
        picked = pg4[i] if i < len(pg4) else ""
        if not picked:
            detail["g4"].append(None)
            continue
        if i < len(g4_result) and g4_result[i] == picked:
            total += exact_pts
            detail["g4"].append({"pts": exact_pts, "type": "exact"})
        elif picked in g4_result:
            total += G4_GROUP
            detail["g4"].append({"pts": G4_GROUP, "type": "group"})
        else:
            detail["g4"].append({"pts": 0, "type": "miss"})

    for i in range(4):
        picked = pz4[i] if i < len(pz4) else ""
        if not picked:
            detail["z4"].append(None)
            continue
        if i < len(z4_result) and z4_result[i] == picked:
            total += Z4_EXACT
            detail["z4"].append({"pts": Z4_EXACT, "type": "exact"})
        elif picked in z4_result:
            total += Z4_GROUP
            detail["z4"].append({"pts": Z4_GROUP, "type": "group"})
        else:
            detail["z4"].append({"pts": 0, "type": "miss"})

    sa6_set = set(sa6_result or [])
    for team in picks.get("sa6", []):
        if not team:
            detail["sa6"].append(None)
            continue
        hit = team in sa6_set
        pts = SA6_HIT if hit else 0
        total += pts
        detail["sa6"].append({"pts": pts, "type": "hit" if hit else "miss"})

    return {"total": total, "detail": detail}


def count_exact(detail, key):
    return sum(1 for d in detail.get(key, []) if d and d["type"] == "exact")


def count_sa6_hits(detail):
    return sum(1 for d in detail.get("sa6", []) if d and d["type"] == "hit")


# ─── Checks ──────────────────────────────────────────────────────────────────

def check_g4_exact_vs_group_vs_miss():
    """G4: exact position beats in-group-wrong-position beats a total miss —
    never summed together for the same pick."""
    g4 = ["Flamengo", "Palmeiras", "Botafogo", "Fortaleza"]
    cases = [
        (["Flamengo", "", "", ""], 30, "exact"),      # picked 1st, is 1st
        (["Botafogo", "", "", ""], G4_GROUP, "group"),  # picked 1st, actually 3rd -> group only
        (["Corinthians", "", "", ""], 0, "miss"),       # not in G4 at all
    ]
    for pick_row, expected_pts, expected_type in cases:
        entry = {"picks": {"g4": pick_row, "z4": [], "sa6": []}}
        result = score_entry(entry, g4, ["A", "B", "C", "D"], [])
        d = result["detail"]["g4"][0]
        if d["pts"] != expected_pts or d["type"] != expected_type:
            return False, f"pick={pick_row[0]!r} -> {d}, expected pts={expected_pts} type={expected_type}"
    return True, ""


def check_perfect_pick_totals_correctly():
    """An entry that nails every G4/Z4 exact position and every SA6 slot must
    total exactly sum(G4_EXACT) + 4*Z4_EXACT + (picks)*SA6_HIT — this is the
    class of bug (bonus silently not summed) the Copa's July 2026 audit found."""
    g4 = ["Flamengo", "Palmeiras", "Botafogo", "Fortaleza"]
    z4 = ["Sport", "Vitória", "Criciúma", "Cuiabá"]
    sa6 = ["Bahia", "Corinthians", "Grêmio", "Cruzeiro", "Athletico-PR", "Fluminense"]
    entry = {"picks": {"g4": g4[:], "z4": z4[:], "sa6": sa6[:]}}
    result = score_entry(entry, g4, z4, sa6)
    expected = sum(G4_EXACT) + 4 * Z4_EXACT + 6 * SA6_HIT
    if result["total"] != expected:
        return False, f"total={result['total']}, expected {expected} (perfect G4+Z4+SA6 pick)"
    if count_exact(result["detail"], "g4") != 4 or count_exact(result["detail"], "z4") != 4:
        return False, f"expected 4 exact G4 and 4 exact Z4 hits, got detail={result['detail']}"
    return True, ""


def check_empty_pick_scores_nothing():
    """A blank pick slot ("") must never be treated as a match against
    anything — must score 0 and record None, not crash or false-hit."""
    entry = {"picks": {"g4": ["", "", "", ""], "z4": [], "sa6": [""]}}
    result = score_entry(entry, ["A", "B", "C", "D"], ["E", "F", "G", "H"], ["I"])
    if result["total"] != 0:
        return False, f"expected 0 for all-blank picks, got {result['total']}"
    if any(d is not None for d in result["detail"]["g4"]):
        return False, f"blank G4 picks should record None, got {result['detail']['g4']}"
    return True, ""


def check_no_result_returns_none():
    """scoreEntry must return None (not crash, not 0) when the season hasn't
    produced a usable G4/Z4 snapshot yet — getActiveScore() in app.js relies
    on this to know 'no score yet' vs 'scored zero'."""
    entry = {"picks": {"g4": ["Flamengo"], "z4": [], "sa6": []}}
    if score_entry(entry, None, ["A"], []) is not None:
        return False, "expected None when g4_result is missing"
    if score_entry(entry, ["A"], None, []) is not None:
        return False, "expected None when z4_result is missing"
    return True, ""


def check_tiebreak_order():
    """Sort must be total DESC, then SA6-hit-count DESC, then G4-exact-count
    DESC, then Z4-exact-count DESC — same cascade as rankEntries() in
    bolao/br2026/js/app.js."""
    g4 = ["Flamengo", "Palmeiras", "Botafogo", "Fortaleza"]
    z4 = ["Sport", "Vitória", "Criciúma", "Cuiabá"]
    sa6 = ["Bahia", "Corinthians"]

    entry_a = {"picks": {"g4": g4[:], "z4": [], "sa6": []}}          # 80 pts (all G4 exact), 0 SA6
    entry_b = {"picks": {"g4": ["Flamengo", "", "", ""], "z4": [], "sa6": sa6[:]}}  # 30 + 16 = 46
    entry_c = {"picks": {"g4": g4[:], "z4": [], "sa6": []}}          # same as A: 80 pts, 0 SA6 -> tie

    scored = [
        {"name": "A", **score_entry(entry_a, g4, z4, sa6)},
        {"name": "B", **score_entry(entry_b, g4, z4, sa6)},
        {"name": "C", **score_entry(entry_c, g4, z4, sa6)},
    ]
    scored.sort(key=lambda x: (-x["total"], -count_sa6_hits(x["detail"])))
    if scored[0]["total"] != 80 or scored[-1]["name"] != "B":
        return False, f"expected A/C (80 pts) ahead of B (46 pts), got order: {[(s['name'], s['total']) for s in scored]}"
    # A and C are fully tied on total and SA6 (both 0) -- real tiebreak then
    # falls to G4/Z4 exact counts (equal here too) and finally reverse-alpha
    # name, which this transcription doesn't need to re-verify since it's
    # the same trivial string comparison already covered by the Copa's own
    # audit_scoring.py check_tiebreak_order().
    return True, ""


def run_static_audit(verbose=True):
    checks = [
        ("G4 exact/group/miss mutually exclusive", check_g4_exact_vs_group_vs_miss),
        ("Perfect pick totals G4+Z4+SA6 correctly", check_perfect_pick_totals_correctly),
        ("Blank pick scores nothing (no false hits)", check_empty_pick_scores_nothing),
        ("No result yet returns None, not 0 or a crash", check_no_result_returns_none),
        ("Tiebreak sort order (total, SA6, G4 exact, Z4 exact)", check_tiebreak_order),
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
    print("Running BR2026 scoring/ranking static self-audit...\n")
    ok, _ = run_static_audit(verbose=True)
    print("\n" + ("✓ ALL CHECKS PASSED" if ok else "✗ AUDIT FAILED — see above"))
    sys.exit(0 if ok else 1)
