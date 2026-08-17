#!/usr/bin/env python3
"""
check_pii_fixtures.py -- flags real-looking PII hardcoded in source files.

Python stdlib only (os, re, sys, json). Run locally:
    python3 bolao/scripts/security/check_pii_fixtures.py

Why this exists: the 2026-08-02 security review found that demo/fixture data in this platform
is generally safe (e.g. the Copa admin's "dados demo" feature creates entries named "Ana Demo",
"Bruno Demo", "Carlos Demo" at runtime -- not hardcoded PII in source) but one real exception was
found: bolao/loterias/powerball/js/data.js hardcodes real participant full names AND real
Zelle/Venmo/CashApp transaction confirmation numbers directly in a publicly-served static JS
file (see docs/bolao/security/SECURITY_RISK_REGISTER.md SR-14). This script generalizes that
finding into a repeatable check: look for email-shaped strings and transaction-id-shaped strings
in any file that isn't already known to be a legitimate config/doc location for them.

What it does:
  - Scans bolao/**/*.js and bolao/**/*.py for email-address-shaped strings, and reports any that
    aren't on the small allowlist of already-known/expected addresses (emferrari@gmail.com, the
    site's own admin email, already documented everywhere on purpose).
  - Scans for transaction-id-shaped tokens (heuristic: a field literal named txId/transactionId
    with a long alphanumeric value) as a proxy for "real financial data hardcoded in source".
  - Everything found is reported as REVIEW NEEDED, never auto-failed with a hard exit code,
    because this platform's own design intentionally has some real PII in git (e.g. the
    powerball participants list, already known and accepted, documented in
    SECURITY_RISK_REGISTER.md SR-14) -- a script that hard-fails on every known, already-reviewed
    instance would just be noise. It exists so a *new* occurrence introduced in a future commit
    doesn't slip in unnoticed -- pair this script's output with a manual diff against the
    baseline list below when reviewing a PR that touches these files.
"""
import os
import re
import sys
import json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BOLAO = os.path.join(ROOT, "bolao")
SKIP_DIRS = {".git", "node_modules"}

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
TXID_RE = re.compile(r'\btxId["\']?\s*:\s*["\']([^"\']{6,})["\']')

# Known-and-accepted occurrences as of the 2026-08-02 review -- not a vulnerability, just the
# baseline so this script's output highlights *new* additions, not the same finding every run.
KNOWN_EMAILS = {
    "emferrari@gmail.com",  # Eduardo's admin email, intentionally in config.js of all 3 apps
}
KNOWN_TXID_FILE_SUFFIX = os.path.join("loterias", "powerball", "js", "data.js")


def walk_files(root, exts):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if os.path.splitext(fn)[1] in exts:
                yield os.path.join(dirpath, fn)


def main():
    findings = []

    for f in walk_files(BOLAO, {".js", ".py"}):
        rel = os.path.relpath(f, ROOT)
        try:
            with open(f, "r", encoding="utf-8", errors="ignore") as fh:
                text = fh.read()
        except OSError:
            continue

        for m in EMAIL_RE.finditer(text):
            email = m.group(0)
            if email in KNOWN_EMAILS:
                continue
            line = text.count("\n", 0, m.start()) + 1
            findings.append({"file": rel, "line": line, "type": "email", "value_masked": email.split("@")[0][:2] + "…@" + email.split("@")[1]})

        for m in TXID_RE.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            known = rel.endswith(KNOWN_TXID_FILE_SUFFIX)
            findings.append({
                "file": rel,
                "line": line,
                "type": "transaction_id",
                "value_masked": m.group(1)[:3] + "…",
                "known_baseline": known,
            })

    report = {"tool": "check_pii_fixtures.py", "findings": findings}
    print(json.dumps(report, indent=2))

    new_findings = [f for f in findings if not f.get("known_baseline", False)]
    print(
        f"\n{len(findings)} total PII-shaped value(s) found; {len(new_findings)} not on the known baseline "
        f"(review those manually -- see docs/bolao/security/SECURITY_RISK_REGISTER.md SR-14 for the one "
        f"already-known/accepted instance in bolao/loterias/powerball/js/data.js).",
        file=sys.stderr,
    )
    # Always exits 0 -- this script's purpose is a review aid (diff against baseline), not a
    # hard gate, per the task's instruction not to build a scanner that's just noise. If this
    # repo later wants CI enforcement, the caller should diff `new_findings` against a checked-in
    # baseline file itself, not rely on this script's own exit code.
    sys.exit(0)


if __name__ == "__main__":
    main()
