#!/usr/bin/env python3
"""
check_rate_limit_docs.py -- verifies the rate-limit governance doc stays in sync with config.js.

Python stdlib only (os, re, sys, json). Run locally:
    python3 bolao/scripts/security/check_rate_limit_docs.py

What it does: this repo has no server-side rate limiting (see docs/bolao/security/RATE_LIMIT_POLICY.md
-- everything client-side-only today), so the only thing this script can meaningfully check is
governance drift: does docs/bolao/security/RATE_LIMIT_POLICY.md exist, and does it still mention
the actual numeric values configured in each app's config.js (adminMaxAttempts, adminLockMinutes,
adminSessionMinutes, limitRateMs)? If someone changes a limit in config.js without updating the
policy doc, this catches the drift -- it cannot verify the numbers mean what the doc says (that
needs a human), only that the doc wasn't silently left stale.

Exit code: non-zero if docs/bolao/security/RATE_LIMIT_POLICY.md is missing entirely (a hard
governance gate -- every app with rate-limit-relevant config must have this doc). A config value
that changed without a matching doc update is reported as REVIEW NEEDED, not a hard failure --
this script can't tell if the doc was updated with equivalent wording, only that the exact
literal number moved.
"""
import os
import re
import sys
import json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
POLICY_DOC = os.path.join(ROOT, "docs", "bolao", "security", "RATE_LIMIT_POLICY.md")
APP_CONFIGS = [
    os.path.join(ROOT, "bolao", "copa2026", "js", "config.js"),
    os.path.join(ROOT, "bolao", "br2026", "js", "config.js"),
    os.path.join(ROOT, "bolao", "cdb2026", "js", "config.js"),
]

RELEVANT_KEYS = ["adminMaxAttempts", "adminLockMinutes", "adminSessionMinutes", "limitRateMs"]
KEY_VALUE_RE = re.compile(r'(\w+)\s*:\s*(\d+)')


def extract_values(text):
    found = {}
    for m in KEY_VALUE_RE.finditer(text):
        key, value = m.group(1), m.group(2)
        if key in RELEVANT_KEYS:
            found[key] = value
    return found


def main():
    if not os.path.isfile(POLICY_DOC):
        print(json.dumps({"tool": "check_rate_limit_docs.py", "error": "RATE_LIMIT_POLICY.md missing"}, indent=2))
        print("\nCONFIRMED CRITICAL: docs/bolao/security/RATE_LIMIT_POLICY.md does not exist.", file=sys.stderr)
        sys.exit(1)

    with open(POLICY_DOC, "r", encoding="utf-8") as fh:
        policy_text = fh.read()

    drift = []
    for cfg_path in APP_CONFIGS:
        if not os.path.isfile(cfg_path):
            continue
        rel = os.path.relpath(cfg_path, ROOT)
        with open(cfg_path, "r", encoding="utf-8") as fh:
            cfg_text = fh.read()
        values = extract_values(cfg_text)
        for key, value in values.items():
            # Heuristic: the literal number should appear somewhere in the policy doc's prose
            # (e.g. "30 min", "5 tentativas", "30000"). Not a proof the doc is accurate, just
            # that nobody silently changed the number without touching the doc at all.
            if value not in policy_text:
                drift.append({"app_config": rel, "key": key, "value": value, "note": "value not found anywhere in RATE_LIMIT_POLICY.md text -- doc may be stale"})

    report = {
        "tool": "check_rate_limit_docs.py",
        "policy_doc_exists": True,
        "drift_review_needed": drift,
    }
    print(json.dumps(report, indent=2))

    if drift:
        print(f"\n{len(drift)} possible doc-drift item(s) -- review needed, not a hard failure.", file=sys.stderr)
    else:
        print("\nNo drift detected -- every checked config value has a matching literal in RATE_LIMIT_POLICY.md.", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
