#!/usr/bin/env python3
"""
sync_espn.py — Copa2026 thin wrapper around the shared bolao/shared/scripts/espn_provider.py.

Run: python3 bolao/copa2026/scripts/sync_espn.py

Declarative only — see bolao/cdb2026/scripts/sync_espn.py for the same pattern. Copa2026's
tournament concluded 2026-07-19 (Spain champion, CONFIG.archived = true, see CLAUDE.md "Copa do
Mundo 2026 archive") — this snapshot is effectively historical now (final scoreboard state), but
the app's audit report / "ver palpites" detail pages still read match data, so the same
controlled-source discipline applies: no direct browser->ESPN calls remain, even for a concluded,
low-write-traffic archive.
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent / "shared" / "scripts"))
import espn_provider as ep  # noqa: E402

CONFIG = {
    "competition_id": "fifa.world",
    "provider": "espn",
    "kind": "scoreboard",
    "source_url": "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=300&dates=20260611-20260719",
    "output_path": str(HERE.parent / "data" / "espn-normalized.json"),
    "aliases": {},
}

if __name__ == "__main__":
    outcome = ep.run_sync(CONFIG)
    print(f"[copa2026] sync outcome: wrote={outcome.wrote} stale={outcome.stale} reason={outcome.reason} liveUpstream={outcome.liveUpstream}")
    if outcome.problems:
        print(f"[copa2026] problems: {outcome.problems}")
    sys.exit(0)
