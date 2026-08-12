"""
auto_reopen.py — Bolão Ferrari Copa 2026

Automatically reopens the site in edit-by-code mode after R32 is complete (M88 done).
Called by GitHub Actions after the auto email check.

Conditions to reopen:
  1. M88 is saved in Supabase results
  2. config.js cutoffIso is still the "closed" value (before 2026-07-04)

Action when reopening:
  - Sets r32CutoffIso = now (R32 inputs locked)
  - Sets cutoffIso = 2026-07-04T12:00:00-04:00 (edit window until R16 kickoff)
  - Updates cutoffLabel
  - Bumps siteVersion

Prints "PATCHED" if config was changed, "NO_ACTION" otherwise.
The calling workflow commits and pushes if "PATCHED".
"""

import os
import sys
import json, re, sys, urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY     = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"


# ── PRODMIG-Q38-READ ────────────────────────────────────────────────────────────────────────────
# Este leitor precisa do documento PRIVADO (e-mail, payerName, paymentTo), que a projecao publica
# `bolao_state_public` remove de proposito. Logo nao da para reaponta-lo para a view: ele passa a
# usar a credencial PRIVILEGIADA, do lado servidor.
#
# A chave vem SO do ambiente. Nao e impressa, nao entra em argv (visivel em `ps`), nao vai para
# arquivo nem para log. O unico sinal externo e a sua ausencia.
def _service_key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — leitura do documento privado exige runtime confiavel.")
        sys.exit(2)
    return k

# New window: participants can edit R16+ picks until R16 kickoff
R16_CUTOFF = "2026-07-04T12:00:00-04:00"

# Config.js path relative to this script (scripts/ → js/)
CONFIG_JS = Path(__file__).parent.parent / "js" / "config.js"


def sb_fetch():
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state?id=eq.main&select=state",
        headers={"apikey": _service_key(), "Authorization": f"Bearer {_service_key()}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())[0]["state"]


def m88_done(state):
    results = state.get("results", {})
    return "88" in results and bool(results["88"].get("advanceSide"))


def get_cutoff_iso(config_text):
    m = re.search(r'cutoffIso:\s*"([^"]+)"', config_text)
    return m.group(1) if m else None


def needs_reopen(cutoff_iso):
    """
    True if current cutoffIso is before July 4 2026 (site is closed).
    After reopen sets "2026-07-04T12:..." this will be False.
    Uses ISO string comparison — works because all dates share the same prefix.
    """
    if not cutoff_iso:
        return False
    return cutoff_iso < "2026-07-04"


def bump_version(config_text):
    """Increment the patch version number in siteVersion."""
    m = re.search(r'siteVersion:\s*"v(\d+)\.(\d+)"', config_text)
    if not m:
        return config_text
    major, minor = int(m.group(1)), int(m.group(2))
    return config_text.replace(
        m.group(0), f'siteVersion: "v{major}.{minor + 1}"'
    )


def patch_config(config_text):
    """Apply all reopen patches to config.js content. Returns patched text."""
    now_iso = datetime.now(tz=timezone(timedelta(hours=-4))).strftime("%Y-%m-%dT%H:%M:%S-04:00")

    patches = [
        # r32CutoffIso = now (locks R32 inputs in edit-by-code mode)
        (r'r32CutoffIso:\s*"[^"]+"', f'r32CutoffIso: "{now_iso}"'),
        # cutoffIso = R16 kickoff (opens edit window)
        (r'cutoffIso:\s*"[^"]+"', f'cutoffIso: "{R16_CUTOFF}"'),
        # Update label
        (r'cutoffLabel:\s*"[^"]+"', 'cutoffLabel: "Editável até início da R16 · Edit by code"'),
    ]

    for pattern, replacement in patches:
        config_text = re.sub(pattern, replacement, config_text)

    config_text = bump_version(config_text)
    return config_text


def main():
    print("Checking if R32 reopen is needed...")

    # 1. Check M88 in Supabase
    try:
        state = sb_fetch()
    except Exception as ex:
        print(f"Supabase fetch failed: {ex}")
        print("NO_ACTION")
        return

    if not m88_done(state):
        print("M88 not yet in Supabase — no reopen.")
        print("NO_ACTION")
        return

    print("M88 confirmed done in Supabase.")

    # 2. Read config.js
    if not CONFIG_JS.exists():
        print(f"config.js not found at {CONFIG_JS}")
        print("NO_ACTION")
        return

    config_text = CONFIG_JS.read_text(encoding="utf-8")
    cutoff_iso  = get_cutoff_iso(config_text)
    print(f"Current cutoffIso: {cutoff_iso}")

    if not needs_reopen(cutoff_iso):
        print("Site already open (cutoffIso >= 2026-07-04). Nothing to do.")
        print("NO_ACTION")
        return

    # 3. Patch config.js
    print("Patching config.js for R16 edit window...")
    patched = patch_config(config_text)
    CONFIG_JS.write_text(patched, encoding="utf-8")
    print(f"  r32CutoffIso = now (R32 locked)")
    print(f"  cutoffIso    = {R16_CUTOFF}")
    print(f"  cutoffLabel  = Editável até início da R16")
    print("PATCHED")


if __name__ == "__main__":
    main()
