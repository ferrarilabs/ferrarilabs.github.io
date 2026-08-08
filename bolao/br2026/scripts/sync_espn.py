#!/usr/bin/env python3
"""
sync_espn.py — BR2026 thin wrapper around the shared bolao/shared/scripts/espn_provider.py.

Run: python3 bolao/br2026/scripts/sync_espn.py [--standings|--scoreboard]  (default: both)

Declarative only — see bolao/cdb2026/scripts/sync_espn.py for the same pattern. BR2026 needs
BOTH a standings snapshot (G4/Z4 table) and a scoreboard/schedule snapshot (live matches +
calendar), so this wrapper writes two output files, one per kind, both through the same shared
run_sync() driver.
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent / "shared" / "scripts"))
import espn_provider as ep  # noqa: E402

# App-specific alias found in production 2026-07-14 (see checkpoint A audit) — kept here, not
# duplicated client-side anymore.
ALIASES = {"Athletico-PR": "Athletico Paranaense"}

STANDINGS_CONFIG = {
    "competition_id": "bra.1",
    "provider": "espn",
    "kind": "standings",
    "source_url": "https://site.api.espn.com/apis/v2/sports/soccer/bra.1/standings",
    "output_path": str(HERE.parent / "data" / "espn-standings-normalized.json"),
    "aliases": ALIASES,
}

SCOREBOARD_CONFIG = {
    "competition_id": "bra.1",
    "provider": "espn",
    "kind": "scoreboard",
    "source_url": "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard?dates=20260101-20261231&limit=500",
    "output_path": str(HERE.parent / "data" / "espn-normalized.json"),
    "aliases": ALIASES,
}

if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None
    configs = []
    if only in (None, "--standings"):
        configs.append(("standings", STANDINGS_CONFIG))
    if only in (None, "--scoreboard"):
        configs.append(("scoreboard", SCOREBOARD_CONFIG))

    exit_code = 0
    for label, cfg in configs:
        outcome = ep.run_sync(cfg)
        print(f"[br2026:{label}] sync outcome: wrote={outcome.wrote} stale={outcome.stale} reason={outcome.reason} liveUpstream={outcome.liveUpstream}")
        if outcome.problems:
            print(f"[br2026:{label}] problems: {outcome.problems}")
    sys.exit(exit_code)
