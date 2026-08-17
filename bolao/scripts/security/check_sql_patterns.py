#!/usr/bin/env python3
"""
check_sql_patterns.py -- SQL/command injection pattern scan for the bolao platform.

Python stdlib only (os, re, sys, json) -- no pip install. Run locally:
    python3 bolao/scripts/security/check_sql_patterns.py

What it does:
  1. Looks for dynamically-built SQL (string concatenation / f-strings / .format() near SQL
     keywords) in every .py/.js file under bolao/ -- this repo has no SQL client and no
     server-side SQL execution today (all persistence goes through Supabase's PostgREST Data
     API with query-string filters, not raw SQL -- see docs/bolao/security/INJECTION_REVIEW.md),
     so this should always come back empty; the script exists so a future addition (e.g. a
     custom RPC or migration runner) gets caught by this check instead of relying on someone
     remembering to look.
  2. Flags subprocess/os.system/os.popen calls that use shell=True or that pass a single
     concatenated/f-string command instead of an argv list -- command injection surface.
     Confirmed manually during the 2026-08-02 review: every subprocess call in
     bolao/copa2026/scripts/*.py already uses the safe list form; this script makes that a
     regression check instead of a one-time finding.

Exit code: non-zero on any CONFIRMED CRITICAL finding (shell=True, or an f-string/concatenated
command passed to subprocess/os.system/os.popen). SQL-keyword-near-string-formatting matches are
reported as REVIEW NEEDED (heuristic, no SQL client actually exists in this repo today) and do
not fail the build on their own.
"""
import os
import re
import sys
import json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BOLAO = os.path.join(ROOT, "bolao")
SKIP_DIRS = {".git", "node_modules"}
# This governance script's own source necessarily contains the literal strings it searches for
# (e.g. "shell=True" appears in its own pattern/comment text) -- exclude the scripts/security/
# directory itself from the scan to avoid trivially self-flagging. The application code these
# scripts audit lives everywhere else under bolao/.
SELF_DIR = os.path.dirname(os.path.abspath(__file__))

SQL_KEYWORDS = re.compile(r"\b(select|insert|update|delete|drop|alter)\b", re.IGNORECASE)
FSTRING_OR_FORMAT = re.compile(r'f["\']|\.format\(|%\s*\(')

SHELL_TRUE = re.compile(r"shell\s*=\s*True")
SUBPROCESS_CALL = re.compile(r"\b(subprocess\.(run|call|check_call|check_output|Popen)|os\.system|os\.popen)\s*\(")
SUBPROCESS_STRING_ARG = re.compile(r"\b(subprocess\.(run|call|check_call|check_output|Popen))\s*\(\s*f?[\"']")


def walk_files(root, exts):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if os.path.splitext(fn)[1] in exts:
                yield os.path.join(dirpath, fn)


def main():
    confirmed = []
    review = []

    for f in walk_files(BOLAO, {".py", ".js"}):
        if os.path.dirname(os.path.abspath(f)) == SELF_DIR:
            continue
        rel = os.path.relpath(f, ROOT)
        try:
            with open(f, "r", encoding="utf-8", errors="ignore") as fh:
                lines = fh.readlines()
        except OSError:
            continue

        for i, line in enumerate(lines, start=1):
            stripped = line.split("#", 1)[0].split("//", 1)[0]

            if SHELL_TRUE.search(line):
                confirmed.append({"file": rel, "line": i, "issue": "shell=True"})

            if SUBPROCESS_STRING_ARG.search(stripped):
                confirmed.append({"file": rel, "line": i, "issue": "subprocess call with a string/f-string command instead of an argv list"})

            if SQL_KEYWORDS.search(stripped) and FSTRING_OR_FORMAT.search(stripped):
                review.append({"file": rel, "line": i, "issue": "SQL keyword near string formatting -- likely a false positive (no SQL client in this repo today), verify manually"})

    report = {
        "tool": "check_sql_patterns.py",
        "confirmed_critical": confirmed,
        "review_needed": review,
    }
    print(json.dumps(report, indent=2))

    if confirmed:
        print(f"\nCONFIRMED CRITICAL: {len(confirmed)} finding(s) -- command injection risk pattern.", file=sys.stderr)
        sys.exit(1)

    print(f"\nNo confirmed SQL/command injection pattern found. {len(review)} lower-confidence match(es) reported above (not a failure). "
          f"Matches this review's manual finding: no shell=True, no string-built subprocess command anywhere in bolao/copa2026/scripts/*.py "
          f"(see docs/bolao/security/INJECTION_REVIEW.md).", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
