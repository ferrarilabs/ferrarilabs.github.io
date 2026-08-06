#!/usr/bin/env python3
"""
test_bracket_correction_routing.py — P0.2 fail-closed gate tests for
send_bracket_correction_email.py's resolve_routing().

Pure unit tests, no network. Run: python3 scripts/test_bracket_correction_routing.py
"""
import sys
from send_bracket_correction_email import resolve_routing, _mask

passed, failed = 0, 0

def check(name, cond):
    global passed, failed
    if cond:
        print(f"  ✓ {name}")
        passed += 1
    else:
        print(f"  ✗ {name}")
        failed += 1

print("resolve_routing() fail-closed contract tests\n")

# 1. routing missing entirely
resolved, missing, ambiguous = resolve_routing(["Payer A", "Payer B"], {})
check("1. empty routing -> all missing, none resolved", resolved == {} and set(missing) == {"Payer A", "Payer B"} and ambiguous == [])

# 2. routing invalid (no '@')
resolved, missing, ambiguous = resolve_routing(["Payer A"], {"Payer A": ("not-an-email", "")})
check("2. invalid email (no @) -> treated as missing", "Payer A" in missing and resolved == {})

# 3. duplicate name in payers list handled without crash (dict-based, last wins in caller — resolve_routing itself is over a payer set)
resolved, missing, ambiguous = resolve_routing(["Payer A", "Payer A"], {"Payer A": ("a@example.invalid", "")})
check("3. duplicate payer name in input list doesn't crash", "Payer A" in resolved)

# 4. name present in payers but absent from routing dict -> missing
resolved, missing, ambiguous = resolve_routing(["Payer A", "Payer C"], {"Payer A": ("a@example.invalid", "")})
check("4. participant absent from routing -> missing, not silently skipped", missing == ["Payer C"])

# 5. two different payers resolve to the same address -> ambiguous/collision
resolved, missing, ambiguous = resolve_routing(
    ["Payer A", "Payer B"],
    {"Payer A": ("shared@example.invalid", ""), "Payer B": ("shared@example.invalid", "")},
)
check("5. two payers -> same address is flagged as ambiguous", len(ambiguous) == 1)

# 6. fully valid routing -> all resolved, zero missing/ambiguous
resolved, missing, ambiguous = resolve_routing(
    ["Payer A", "Payer B"],
    {"Payer A": ("a@example.invalid", ""), "Payer B": ("b@example.invalid", "cc@example.invalid")},
)
check("6. fully valid routing -> 0 missing, 0 ambiguous, 2 resolved", len(resolved) == 2 and not missing and not ambiguous)

# 7. _mask never returns the raw value
check("7. _mask() never returns the raw input verbatim", _mask("real@example.invalid") != "real@example.invalid" and "real@example.invalid" not in _mask("real@example.invalid"))

print(f"\n{passed} passed, {failed} failed.")
if failed:
    sys.exit(1)
