#!/usr/bin/env python3
"""
sync_espn.py — CDB2026 thin wrapper around the shared bolao/shared/scripts/espn_provider.py.

Run: python3 bolao/cdb2026/scripts/sync_espn.py

Declarative only: this file defines CONFIG (competition id, source URL, app-specific aliases,
output path) and calls run_sync(). All fetch/validate/normalize/atomic-write logic lives in the
shared provider — see checkpoint C2 in docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md.

Output: bolao/cdb2026/data/espn-normalized.json — the ONLY source the frontend
(bolao/cdb2026/js/app.js) reads for live ESPN data as of checkpoint C2. Never emails, never
writes to Supabase, never locks a real result — purely a read-through cache of upstream sports
data.
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent / "shared" / "scripts"))
import espn_provider as ep  # noqa: E402

CONFIG = {
    "competition_id": "bra.copa_do_brazil",
    "provider": "espn",
    "kind": "scoreboard",
    "source_url": "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard?dates=20260101-20261231&limit=500",
    "output_path": str(HERE.parent / "data" / "espn-normalized.json"),
    # App-specific alias found in production 2026-08-01 (see checkpoint A audit) — kept here,
    # not duplicated client-side anymore.
    "aliases": {"Vasco da Gama": "Vasco"},
}

if __name__ == "__main__":
    outcome = ep.run_sync(CONFIG)
    print(f"[cdb2026] sync outcome: wrote={outcome.wrote} stale={outcome.stale} reason={outcome.reason} liveUpstream={outcome.liveUpstream}")
    if outcome.problems:
        print(f"[cdb2026] problems: {outcome.problems}")
    sys.exit(0)  # a stale-but-preserved result is not a hard failure for CI — see run_sync() docstring
