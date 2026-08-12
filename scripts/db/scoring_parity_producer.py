#!/usr/bin/env python3
"""
SCORING_PARITY evidence producer — Batch H.

Answers exactly one question:

    Does the NORMALIZED migrated representation produce the same scoring outcome as the
    LEGACY representation, when both are fed through the SAME canonical scoring engine?

═══════════════════════════════════════════════════════════════════════════════════════════════
WHAT IS AND IS NOT AUTHORITATIVE HERE

This file contains NO scoring arithmetic. Not a points table, not a tiebreak comparison, not a
threshold. It imports the three applications' own scoring engines and calls them. If a number is
decided anywhere in this file, that is a defect, and the source-of-truth guard in
test_scoring_parity_gate.mjs is written to catch it.

The canonical engines, and what each one's audit proves:

    copa2026   bolao/copa2026/scripts/send_result_email.py
               scoring: score_entry_total / exact_match_count / podium_hits
               ranking: compute_final_payouts   (does the sort AND the tie grouping)
               audit:   audit_scoring.run_static_audit(send_result_email)

    br2026     bolao/br2026/scripts/audit_scoring.py           (score_entry lives IN the audit)
               ranking: bolao/br2026/scripts/send_round_email.rank_entries
               audit:   audit_scoring.run_static_audit()

    cdb2026    bolao/cdb2026/scripts/send_result_email.py
               scoring: score_entry_total / entry_detail  (delegating to its own audit_scoring)
               ranking: compute_final_payouts
               audit:   audit_scoring.run_static_audit()

Note that `audit_scoring.py` is a STATIC SELF-AUDIT of the engine, not a data-driven scorer. It
takes no input data. So it is used here for what it actually is: a precondition. The audit must pass
before any parity result is believed, because comparing two representations through an engine that is
itself wrong would prove only that they are wrong identically.

═══════════════════════════════════════════════════════════════════════════════════════════════
FAIL-CLOSED

Every path that cannot produce a comparison returns a non-PASS status and a non-zero exit. "The audit
did not run" is never PASS. A missing engine, a crash, an unparsable state, an unknown competition,
an empty comparison — all fail. There is no default-true anywhere in this file.

No production connection: the engines are imported with PG*/SUPABASE*/EMAILJS* stripped from the
environment, and none of them performs I/O at import time (asserted by the test suite).
"""

import argparse
import hashlib
import importlib
import json
import os
import sys
import traceback
from pathlib import Path

STATUS_PASS = "PASS_EXACT"
FAIL_SCORE = "FAIL_SCORE"
FAIL_RANKING = "FAIL_RANKING"
FAIL_TIE = "FAIL_TIE_BEHAVIOR"
FAIL_RULE = "FAIL_RULE_SEMANTICS"
INVALID_INPUT = "INVALID_INPUT"
AUDIT_FAILED = "AUDIT_FAILED"
ENGINE_MISSING = "ENGINE_MISSING"
PRODUCER_ERROR = "PRODUCER_ERROR"
# The normalized model cannot REPRESENT this competition's scoring inputs at all. Distinct from a
# comparison failure: nothing was compared, because one side could not be built. Reporting it as
# FAIL_SCORE would send someone hunting for an arithmetic bug that does not exist.
MODEL_GAP = "MODEL_GAP"

NON_PASS = {FAIL_SCORE, FAIL_RANKING, FAIL_TIE, FAIL_RULE, INVALID_INPUT, AUDIT_FAILED,
            ENGINE_MISSING, PRODUCER_ERROR, MODEL_GAP}

COMPETITIONS = ("copa2026", "br2026", "cdb2026")


def _sanitise_env():
    """Strip anything that could give an engine a route to production."""
    for k in list(os.environ):
        if k.startswith(("PG", "SUPABASE", "EMAILJS", "DATABASE_URL")):
            del os.environ[k]


def _load(app, site_root):
    """Import an app's scripts directory in isolation and return its modules.

    Each app has its own `audit_scoring` and `send_result_email`, so sys.modules is cleared of those
    names between apps: leaving copa2026's module cached would silently score cdb2026 with copa's
    engine, and every parity check would pass while measuring the wrong thing.
    """
    path = Path(site_root) / "bolao" / app / "scripts"
    if not path.is_dir():
        raise FileNotFoundError(f"{app}: {path} does not exist")
    for name in ("audit_scoring", "send_result_email", "send_round_email"):
        sys.modules.pop(name, None)
    sys.path.insert(0, str(path))
    try:
        mods = {"audit": importlib.import_module("audit_scoring")}
        if app == "br2026":
            mods["rank"] = importlib.import_module("send_round_email")
        else:
            mods["engine"] = importlib.import_module("send_result_email")
        return mods
    finally:
        sys.path.remove(str(path))


def _run_audit(app, mods):
    """Run the app's static self-audit. Returns (ok, summary). Never raises."""
    try:
        audit = mods["audit"]
        if app == "copa2026":
            ok, results = audit.run_static_audit(mods["engine"], verbose=False)
        else:
            ok, results = audit.run_static_audit(verbose=False)
        failed = [name for name, passed, _ in results if not passed]
        return bool(ok), {"checks": len(results), "failed": failed}
    except Exception as ex:
        return False, {"error": f"{type(ex).__name__}: {ex}"}


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# Canonical invocation, per competition. Representation in, canonical output out.
# ═══════════════════════════════════════════════════════════════════════════════════════════════

def _score_copa(mods, state):
    eng = mods["engine"]
    results = state.get("results") or {}
    entries = state.get("entries") or []
    per_entry = []
    for e in entries:
        per_entry.append({
            "entry_id": e.get("id"),
            "total": eng.score_entry_total(e, results),
            "exact": eng.exact_match_count(e, results),
            "podium": eng.podium_hits(e, results),
        })
    payouts = eng.compute_final_payouts(state, results)
    return {"per_entry": per_entry, "ranking": _ranking_from_payouts(payouts)}


def _score_br(mods, state):
    audit, rank_mod = mods["audit"], mods["rank"]
    g4 = state.get("g4") or []
    z4 = state.get("z4") or []
    sa6 = state.get("sa6") or []
    entries = state.get("entries") or []
    per_entry = []
    for e in entries:
        sc = audit.score_entry(e, g4, z4, sa6)
        per_entry.append({
            "entry_id": e.get("id"),
            "total": None if sc is None else sc["total"],
            "detail": None if sc is None else sc["detail"],
        })
    ranked = rank_mod.rank_entries(entries, g4, z4, sa6)
    ranking = [{"entry_id": r["entry"].get("id"), "rank": r["rank"], "total": r["total"]} for r in ranked]
    return {"per_entry": per_entry, "ranking": ranking}


def _score_cdb(mods, state):
    eng = mods["engine"]
    all_ties = eng._all_ties(state)
    podium = eng.official_podium(state.get("phases") or {})
    per_entry = []
    for e in state.get("entries") or []:
        per_entry.append({
            "entry_id": e.get("id"),
            "total": eng.score_entry_total(e, all_ties, podium),
            "detail": eng.entry_detail(e, all_ties, podium),
        })
    payouts = eng.compute_final_payouts(state)
    return {"per_entry": per_entry, "ranking": _ranking_from_payouts(payouts),
            "podium": podium}


def _ranking_from_payouts(payouts):
    """Flatten compute_final_payouts() into a comparable ranking.

    The engine returns {"pot", "payouts": [{"entryName", "rank", "amount", "tied"}, ...]} — one flat
    row per paid entry, identified by DISPLAY NAME rather than id. That is worth knowing rather than
    working around: it means the normalized representation must reconstruct the same entryName, so a
    name lost or altered in transformation shows up here as a ranking difference. Grouping by rank
    also makes tie membership explicit, which is the part a rank-number comparison alone would miss.

    Returns None when the engine returns None — which it does deliberately before the deciding
    matches are locked, or when the pot is zero. None is a real outcome and must compare equal to
    None, not to an empty list: "standings do not exist yet" and "standings are empty" are different
    claims, and collapsing them would let a scenario pass parity by producing no standings at all.

    `amount` is carried through exactly as the engine computed it, including its float division. This
    producer does not round, reformat or re-derive it: both sides run the identical expression on the
    identical pot, so identical inputs give bit-identical outputs, and any difference is a real one.
    """
    if payouts is None:
        return None
    rows = payouts.get("payouts") if isinstance(payouts, dict) else payouts
    by_rank = {}
    for row in rows or []:
        r = row.get("rank")
        slot = by_rank.setdefault(r, {"rank": r, "entry_names": [], "amount": row.get("amount"),
                                      "tied": row.get("tied")})
        slot["entry_names"].append(row.get("entryName"))
        if row.get("amount") != slot["amount"]:
            # Two entries at the same rank must receive the same split. If they do not, the engine's
            # tie handling and its payout arithmetic disagree, and that is a finding rather than
            # something to average away.
            slot["amount_inconsistent"] = True
    out = []
    for r in sorted(by_rank, key=lambda x: (x is None, x)):
        slot = by_rank[r]
        slot["entry_names"] = sorted(n for n in slot["entry_names"] if n is not None)
        out.append(slot)
    return out


SCORERS = {"copa2026": _score_copa, "br2026": _score_br, "cdb2026": _score_cdb}


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# Comparison — exact, with no tolerance
# ═══════════════════════════════════════════════════════════════════════════════════════════════

def _canon(obj):
    """Stable JSON for hashing and equality. Sorted keys; no floats are introduced."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _hash(obj):
    return hashlib.sha256(_canon(obj).encode("utf-8")).hexdigest()[:16]


def _compare(legacy, normalized):
    """Classify the difference. Order matters: score before ranking before tie before rule, because
    a score difference explains a ranking difference and reporting the ranking would bury the cause.
    """
    lp = {e["entry_id"]: e for e in legacy["per_entry"]}
    np_ = {e["entry_id"]: e for e in normalized["per_entry"]}

    if set(lp) != set(np_):
        only_l = sorted(set(lp) - set(np_))
        only_n = sorted(set(np_) - set(lp))
        return INVALID_INPUT, {"reason": "the two representations do not contain the same entries",
                               "only_legacy": only_l, "only_normalized": only_n}

    score_diffs = []
    for eid in sorted(lp):
        a, b = lp[eid], np_[eid]
        if a.get("total") != b.get("total"):
            score_diffs.append({"entry_id": eid, "legacy_total": a.get("total"), "normalized_total": b.get("total")})
    if score_diffs:
        return FAIL_SCORE, {"differences": score_diffs}

    # Tie-relevant components: exact counts, podium hits, per-match detail. A difference here with
    # equal totals means the tiebreak inputs diverged, which changes rank order without changing a
    # single total — the failure mode a totals-only check cannot see.
    tie_diffs = []
    for eid in sorted(lp):
        a, b = lp[eid], np_[eid]
        for key in ("exact", "podium", "detail"):
            if key in a or key in b:
                if _canon(a.get(key)) != _canon(b.get(key)):
                    tie_diffs.append({"entry_id": eid, "component": key})
    if tie_diffs:
        return FAIL_TIE, {"differences": tie_diffs}

    if _canon(legacy.get("ranking")) != _canon(normalized.get("ranking")):
        return FAIL_RANKING, {"legacy": legacy.get("ranking"), "normalized": normalized.get("ranking")}

    for key in sorted(set(legacy) | set(normalized)):
        if key in ("per_entry", "ranking"):
            continue
        if _canon(legacy.get(key)) != _canon(normalized.get(key)):
            return FAIL_RULE, {"component": key, "legacy": legacy.get(key), "normalized": normalized.get(key)}

    return STATUS_PASS, {}


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# Driver
# ═══════════════════════════════════════════════════════════════════════════════════════════════

def run(scenarios_path, site_root):
    _sanitise_env()
    try:
        payload = json.loads(Path(scenarios_path).read_text("utf-8"))
    except Exception as ex:
        return {"producer": "scoring_parity_producer", "overall_status": PRODUCER_ERROR,
                "error": f"cannot read scenarios: {type(ex).__name__}: {ex}", "results": []}

    scenarios = payload.get("scenarios") or []
    if not scenarios:
        return {"producer": "scoring_parity_producer", "overall_status": INVALID_INPUT,
                "error": "no scenarios supplied; an empty comparison is not a pass", "results": []}

    loaded, audits = {}, {}
    results = []

    for sc in scenarios:
        comp = sc.get("competition")
        sid = sc.get("scenario_id", "(unnamed)")
        row = {"competition": comp, "scenario_id": sid,
               "legacy_audit_status": None, "normalized_audit_status": None,
               "legacy_result_hash": None, "normalized_result_hash": None,
               "score_parity": False, "ranking_parity": False, "rule_parity": False,
               "overall_status": PRODUCER_ERROR, "detail": {}}

        if comp not in COMPETITIONS:
            row["overall_status"] = INVALID_INPUT
            row["detail"] = {"reason": f"unknown competition {comp!r}"}
            results.append(row)
            continue

        try:
            if comp not in loaded:
                loaded[comp] = _load(comp, site_root)
                ok, summary = _run_audit(comp, loaded[comp])
                audits[comp] = (ok, summary)
            audit_ok, audit_summary = audits[comp]
        except Exception as ex:
            row["overall_status"] = ENGINE_MISSING
            row["detail"] = {"error": f"{type(ex).__name__}: {ex}"}
            results.append(row)
            continue

        # The engine's own audit is a PRECONDITION. Two representations agreeing through a broken
        # engine proves only that they are wrong in the same way.
        row["legacy_audit_status"] = "PASS" if audit_ok else "FAIL"
        row["normalized_audit_status"] = row["legacy_audit_status"]
        if not audit_ok:
            row["overall_status"] = AUDIT_FAILED
            row["detail"] = {"audit": audit_summary}
            results.append(row)
            continue

        gap = sc.get("model_gap")
        if gap:
            row["overall_status"] = MODEL_GAP
            row["detail"] = {"reason": gap}
            results.append(row)
            continue

        legacy_state, normalized_state = sc.get("legacy"), sc.get("normalized")
        if legacy_state is None or normalized_state is None:
            row["overall_status"] = INVALID_INPUT
            row["detail"] = {"reason": "a scenario must supply both representations"}
            results.append(row)
            continue

        try:
            legacy_out = SCORERS[comp](loaded[comp], legacy_state)
            normalized_out = SCORERS[comp](loaded[comp], normalized_state)
        except Exception as ex:
            row["overall_status"] = PRODUCER_ERROR
            row["detail"] = {"error": f"{type(ex).__name__}: {ex}",
                             "trace": traceback.format_exc(limit=3).splitlines()[-3:]}
            results.append(row)
            continue

        row["legacy_result_hash"] = _hash(legacy_out)
        row["normalized_result_hash"] = _hash(normalized_out)
        status, detail = _compare(legacy_out, normalized_out)
        row["overall_status"] = status
        row["detail"] = detail
        row["score_parity"] = status not in (FAIL_SCORE, INVALID_INPUT, PRODUCER_ERROR)
        row["ranking_parity"] = status not in (FAIL_SCORE, FAIL_RANKING, FAIL_TIE, INVALID_INPUT, PRODUCER_ERROR)
        row["rule_parity"] = status == STATUS_PASS
        results.append(row)

    by_comp = {}
    for r in results:
        c = r["competition"] or "(unknown)"
        by_comp.setdefault(c, {"scenarios": 0, "passed": 0, "failed": 0})
        by_comp[c]["scenarios"] += 1
        if r["overall_status"] == STATUS_PASS:
            by_comp[c]["passed"] += 1
        else:
            by_comp[c]["failed"] += 1

    failed = [r for r in results if r["overall_status"] != STATUS_PASS]
    covered = {r["competition"] for r in results if r["overall_status"] == STATUS_PASS}
    # A run may declare its scope. Without one, every competition must have passing evidence: a run
    # covering two of three is not a pass, because the uncovered one has no evidence at all and no
    # evidence is not the same as no problem. WITH a declared scope, the requirement applies to exactly
    # the competitions the caller said it was checking — which keeps a scoped run honest instead of
    # letting it look like a full one.
    scope = payload.get("scope")
    expected = tuple(scope) if scope else COMPETITIONS
    missing = [c for c in expected if c not in covered]

    overall = STATUS_PASS
    if failed:
        overall = failed[0]["overall_status"]
    elif missing:
        # Every competition must be exercised. A run covering two of three is not a pass: the
        # uncovered one has no evidence at all, and no evidence is not the same as no problem.
        overall = INVALID_INPUT

    return {
        "producer": "scoring_parity_producer",
        "canonical_engines": {
            "copa2026": "bolao/copa2026/scripts/send_result_email.py (audited by audit_scoring.py)",
            "br2026": "bolao/br2026/scripts/audit_scoring.py score_entry + send_round_email.rank_entries",
            "cdb2026": "bolao/cdb2026/scripts/send_result_email.py (delegating to its audit_scoring.py)",
        },
        "reimplements_scoring": False,
        "tolerance": "ZERO",
        "audits": {c: {"passed": ok, **summary} for c, (ok, summary) in audits.items()},
        "by_competition": by_comp,
        "declared_scope": list(expected),
        "competitions_without_passing_evidence": missing,
        "results": results,
        "scenarios_total": len(results),
        "scenarios_passed": len(results) - len(failed),
        "scenarios_failed": len(failed),
        "overall_status": overall,
        # The shape WS5's promotion evaluator consumes. `checked` counts comparisons actually made.
        "SCORING_PARITY": {"checked": len(results), "mismatches": len(failed) + len(missing)},
    }


def main():
    ap = argparse.ArgumentParser(description="Produce SCORING_PARITY evidence. Reads a scenario "
                                             "bundle, feeds both representations through the canonical engines.")
    ap.add_argument("--scenarios", required=True, help="path to the scenario bundle JSON")
    ap.add_argument("--site-root", required=True, help="path to the ferrarilabs.github.io checkout")
    ap.add_argument("--out", help="write evidence JSON here (stdout if omitted)")
    args = ap.parse_args()

    try:
        evidence = run(args.scenarios, args.site_root)
    except Exception as ex:  # a producer crash is a FAIL, never a silent pass
        evidence = {"producer": "scoring_parity_producer", "overall_status": PRODUCER_ERROR,
                    "error": f"{type(ex).__name__}: {ex}", "results": [],
                    "SCORING_PARITY": {"checked": 0, "mismatches": 1}}

    text = json.dumps(evidence, indent=2, sort_keys=True)
    if args.out:
        Path(args.out).write_text(text + "\n", "utf-8")
    else:
        print(text)

    ok = evidence.get("overall_status") == STATUS_PASS
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
