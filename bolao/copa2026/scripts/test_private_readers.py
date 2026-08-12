#!/usr/bin/env python3
"""PRODMIG-Q38-READ — gate.

Static, no network. It defends one property: nothing reads the PRIVATE `bolao_state` document with
the public anon key. That key ships in every browser, so a script holding it holds nothing a visitor
does not also hold.

  P1  no script reads raw bolao_state with the anon key
  P2  every raw-bolao_state reader fails closed without SUPABASE_SERVICE_ROLE_KEY
  P3  narrow readers use the SANITIZED view, not privilege they do not need
  P4  the backup readers enforce an explicit pool allow-list
      (service_role bypasses RLS, so the list stops being advice and becomes the only barrier)
  P5  no privileged credential is ever printed
  P6  the sanitized view is still stripped — the fix must not have been "read the private doc anyway"
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = [f for f in sorted(os.listdir(HERE)) if f.endswith(".py") and not f.startswith("test_")]

resultados = []


def check(nome, ok, detalhe=""):
    resultados.append(ok)
    print(f"  {'✓' if ok else '✗'} {nome}{('  — ' + detalhe) if detalhe else ''}")


def src(f):
    return open(os.path.join(HERE, f), encoding="utf-8").read()


def strip_comments(s):
    """A gate that fires on the word in a comment is a gate people disable."""
    return "\n".join(re.sub(r"#.*$", "", l) for l in s.split("\n"))


print("COPA2026 private readers — gate\n")

anon_names = re.compile(r"\b(ANON_KEY|SUPABASE_ANON)\b")
raw_read = re.compile(r"rest/v1/(bolao_state)\b(?!_public)")

# P1 / P2 -------------------------------------------------------------------------------------
leaky, unguarded = [], []
for f in SCRIPTS:
    code = strip_comments(src(f))
    if not raw_read.search(code):
        continue
    # Which key does the header next to that read use? Look at every headers= block in the file.
    headers = re.findall(r"headers\s*=\s*\{[^}]*\}", code, re.S)
    if any(anon_names.search(h) for h in headers):
        leaky.append(f)
    # The PROPERTY is "this file refuses to run without the privileged credential", not the name of
    # the helper that enforces it. operator_cli.py spells it `_key()`; checking for one spelling
    # would fail a file that is already correct and pass a file that merely copied the name.
    requires_secret = "SUPABASE_SERVICE_ROLE_KEY" in code
    fails_closed = re.search(r"sys\.exit\(2\)|SystemExit", code) is not None
    if not (requires_secret and fails_closed):
        unguarded.append(f)

check("P1 no script reads raw bolao_state with the anon key", not leaky, ", ".join(leaky) or "none")
check("P2 every raw reader fails closed without the service key", not unguarded, ", ".join(unguarded) or "none")

# P3 ------------------------------------------------------------------------------------------
narrow = "backup_watch_m88.py"
code = strip_comments(src(narrow))
check("P3 the results-only reader uses the sanitized view",
      "bolao_state_public" in code and not raw_read.search(code),
      "reads bolao_state_public")

# P4 ------------------------------------------------------------------------------------------
missing = [f for f in ("backup.py", "backup_daily.py") if "ALLOWED_POOLS" not in src(f)]
check("P4 backup readers enforce an explicit pool allow-list", not missing, ", ".join(missing) or "both enforce")

# P5 ------------------------------------------------------------------------------------------
printed = []
for f in SCRIPTS:
    for line in strip_comments(src(f)).split("\n"):
        if "print" in line and re.search(r"_service_key\(\)|SERVICE_ROLE_KEY", line) and "ausente" not in line:
            printed.append(f"{f}: {line.strip()[:60]}")
check("P5 no privileged credential is ever printed", not printed, "; ".join(printed) or "none")

# P6 ------------------------------------------------------------------------------------------
view = os.path.join(HERE, "..", "..", "shared", "sql", "015_f10_private_pii_and_public_projection.sql")
sql = open(view, encoding="utf-8").read()
strips = [x for x in ("participantEmail", "payerName", "paymentMethod", "paymentTo") if f"- '{x}'" in sql]
check(f"P6 the sanitized view still strips all four PII fields {len(strips)}/4", len(strips) == 4, ", ".join(strips))

falhas = [x for x in resultados if not x]
print(f"\n{len(resultados) - len(falhas)} passaram, {len(falhas)} falharam")
sys.exit(1 if falhas else 0)
