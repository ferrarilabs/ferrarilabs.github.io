#!/usr/bin/env python3
"""
test_send_result_email_gating.py — P0.2 fail-closed gate tests for
send_result_email.py's validate_data() and _mask().

Pure unit tests, no network, no real send. Run:
  python3 scripts/test_send_result_email_gating.py
"""
import sys, json, os
from send_result_email import validate_data, _mask, _normalize_name, load_participants_from_private_env

passed, failed = 0, 0

def check(name, cond):
    global passed, failed
    if cond:
        print(f"  ✓ {name}")
        passed += 1
    else:
        print(f"  ✗ {name}")
        failed += 1

print("validate_data() / _mask() fail-closed contract tests\n")

DRAW_OK = {
    "result": {"numbers": [1, 2, 3, 4, 5], "premiosGanhos": 16},
    "winningTickets": ["01-02-03-04-05 — PB 06"],
}

# 1. missing draw entirely
check("1. no draw -> validation error", len(validate_data(None)) > 0)

# 2. participant with no email -> validation error, not silently dropped
participants_missing_email = [{"name": "Someone", "email": ""}]
errors = validate_data(DRAW_OK, participants_missing_email)
check("2. participant with empty email -> MISSING EMAILS error", any("MISSING EMAILS" in e for e in errors))

# 3. all participants have emails -> no missing-email error
participants_ok = [{"name": "Someone", "email": "someone@example.invalid"}]
errors = validate_data(DRAW_OK, participants_ok)
check("3. all participants have emails -> no MISSING EMAILS error", not any("MISSING EMAILS" in e for e in errors))

# 4. no result numbers -> hard error (never send a result email with no result)
draw_no_result = {"result": {"numbers": None}, "winningTickets": []}
errors = validate_data(draw_no_result, participants_ok)
check("4. draw with no result numbers -> validation error", any("Result numbers" in e for e in errors))

# 5. _mask never returns the raw email
real = "real.participant@example.invalid"
masked = _mask(real)
check("5. _mask() never returns the raw email verbatim", masked != real and real not in masked)
check("5b. _mask() preserves length info without exposing content", "len" in masked)

# 6. _mask handles empty/short input without crashing
check("6. _mask('') doesn't crash", _mask("") == "(empty)")
check("6b. _mask('a') doesn't crash", _mask("a") == "*")

# 7. normalization is deterministic
check("7. _normalize_name collapses whitespace/case", _normalize_name("Eduardo   Ferrari") == _normalize_name("eduardo ferrari"))

# 8. private-env loader fails closed on a name collision (never guesses)
os.environ["POWERBALL_PRIVATE_PARTICIPANT_DATA"] = json.dumps({
    "2026-08-05": {
        "Eduardo Ferrari": {"email": "one@example.invalid", "txId": "—"},
        "eduardo  ferrari": {"email": "two@example.invalid", "txId": "—"},
    }
})
result = load_participants_from_private_env("2026-08-05")
del os.environ["POWERBALL_PRIVATE_PARTICIPANT_DATA"]
check("8. private-env loader: colliding names -> empty result, fails closed", result == [])

# 9. private-env loader: env var absent -> empty result, no crash
os.environ.pop("POWERBALL_PRIVATE_PARTICIPANT_DATA", None)
result = load_participants_from_private_env("2026-08-05")
check("9. private-env loader: absent env var -> empty result, no crash", result == [])

# 10. private-env loader: invalid JSON -> empty result, no crash
os.environ["POWERBALL_PRIVATE_PARTICIPANT_DATA"] = "{not valid json"
result = load_participants_from_private_env("2026-08-05")
del os.environ["POWERBALL_PRIVATE_PARTICIPANT_DATA"]
check("10. private-env loader: invalid JSON -> empty result, no crash", result == [])

print(f"\n{passed} passed, {failed} failed.")
if failed:
    sys.exit(1)
