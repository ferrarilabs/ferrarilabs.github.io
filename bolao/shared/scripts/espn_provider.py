"""
espn_provider.py — shared server-side ESPN fetch/validate/normalize provider.

Football-hardening checkpoint C. Replaces direct browser->ESPN fetches (no CORS guarantee,
documented incidents: cdb2026 "Vasco da Gama" vs "Vasco" name mismatch 2026-08-01, br2026
"Athletico-PR" vs "Athletico Paranaense" name mismatch 2026-07-14 — see
docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md) with a controlled pipeline:

    ESPN endpoint --fetch(timeout+retry)--> raw JSON
                  --validate--> reject malformed/incomplete payloads
                  --normalize--> stable shape, team-name aliasing applied once, server-side
                  --write--> versioned JSON checked into bolao/{app}/data/espn-normalized.json

The frontend (checkpoint F) reads that checked-in JSON, never ESPN directly. If a refresh fails,
the last-known-good file on disk is preserved UNCHANGED except for a `stale: true` marker and a
`staleSince` timestamp — never silently dropped, never silently treated as fresh.

Stdlib only (urllib), no third-party dependencies — same constraint as this repo's other Python
scripts (audit_scoring.py, send_result_email.py) so it runs with a bare `python3` on any machine
that can already run those.

This module NEVER sends email, NEVER writes to Supabase, NEVER writes real results — it only
produces a normalized JSON snapshot of upstream data. Result-locking remains a separate,
human-in-the-loop admin action in each app, unchanged by this module.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

SCHEMA_VERSION = 1
DEFAULT_TIMEOUT_S = 10
DEFAULT_RETRIES = 3
DEFAULT_RETRY_BACKOFF_S = 1.5


class FetchError(Exception):
    """Raised when a fetch exhausts all retries."""


class ValidationError(Exception):
    """Raised when a payload fails shape validation — never written as if it were good data."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass
class FetchResult:
    ok: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    attempts: int = 0
    fetchedAt: Optional[str] = None


def fetch_json(
    url: str,
    *,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    retries: int = DEFAULT_RETRIES,
    backoff_s: float = DEFAULT_RETRY_BACKOFF_S,
    opener: Optional[Callable[[str, float], bytes]] = None,
) -> FetchResult:
    """Fetch a URL as JSON with timeout + retry. `opener` is injectable for tests (no real
    network calls needed to exercise this function's retry/timeout/error-shape logic)."""
    _open = opener or _default_opener
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            raw = _open(url, timeout_s)
            data = json.loads(raw)
            return FetchResult(ok=True, data=data, attempts=attempt, fetchedAt=now_iso())
        except Exception as exc:  # noqa: BLE001 — deliberately broad: any failure retries the same way
            last_err = str(exc)
            if attempt < retries:
                time.sleep(backoff_s * attempt)
    return FetchResult(ok=False, error=last_err, attempts=retries, fetchedAt=now_iso())


def _default_opener(url: str, timeout_s: float) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "bolao-espn-provider/1.0"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:  # noqa: S310 — fixed https ESPN hosts only
        if resp.status != 200:
            raise FetchError(f"HTTP {resp.status}")
        return resp.read()


def validate_scoreboard_shape(data: dict) -> list[str]:
    """Returns a list of validation problems (empty = valid). Mirrors check_result_shape()'s
    philosophy in audit_scoring.py: validate the SHAPE before trusting the content, never trust
    upstream blindly just because the HTTP call succeeded."""
    problems = []
    if not isinstance(data, dict):
        return ["payload is not a JSON object"]
    events = data.get("events")
    if events is None:
        problems.append("missing 'events' key")
    elif not isinstance(events, list):
        problems.append("'events' is not a list")
    else:
        for i, ev in enumerate(events):
            if not isinstance(ev, dict):
                problems.append(f"events[{i}] is not an object")
                continue
            comps = ev.get("competitions")
            if not isinstance(comps, list) or not comps:
                problems.append(f"events[{i}] missing competitions")
                continue
            comp = comps[0]
            competitors = comp.get("competitors") if isinstance(comp, dict) else None
            if not isinstance(competitors, list) or len(competitors) < 2:
                problems.append(f"events[{i}] competitions[0] missing 2 competitors")
    return problems


def validate_standings_shape(data: dict) -> list[str]:
    problems = []
    if not isinstance(data, dict):
        return ["payload is not a JSON object"]
    children = data.get("children")
    if not isinstance(children, list) or not children:
        problems.append("missing/empty 'children'")
        return problems
    entries = (children[0] or {}).get("standings", {}).get("entries")
    if not isinstance(entries, list):
        problems.append("children[0].standings.entries missing or not a list")
    return problems


def normalize_team_name(name: str, aliases: dict) -> str:
    """Single, server-side place team-name aliasing happens now — was duplicated per-app,
    client-side, hand-maintained (CDB_ESPN_NAME_ALIASES, ESPN_SCOREBOARD_NAME_ALIASES). Kept as a
    plain dict lookup (same mechanism, just moved and shared) rather than fuzzy-matching, since
    fuzzy matching a real team name wrong is worse than a clear miss that shows up in validation."""
    return aliases.get(name, name)


def normalize_scoreboard(data: dict, aliases: dict) -> list[dict]:
    events = data.get("events") or []
    out = []
    for ev in events:
        comp = (ev.get("competitions") or [{}])[0]
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        out.append({
            "id": ev.get("id"),
            "date": ev.get("date"),
            "state": ((comp.get("status") or {}).get("type") or {}).get("state"),
            "homeTeam": normalize_team_name((home.get("team") or {}).get("displayName", ""), aliases),
            "awayTeam": normalize_team_name((away.get("team") or {}).get("displayName", ""), aliases),
            "homeScore": _safe_int(home.get("score")),
            "awayScore": _safe_int(away.get("score")),
            "venue": (comp.get("venue") or {}).get("fullName"),
        })
    return out


def normalize_standings(data: dict, aliases: dict) -> list[dict]:
    children = data.get("children") or []
    entries = (children[0] or {}).get("standings", {}).get("entries") if children else []
    out = []
    for e in entries or []:
        team = e.get("team") or {}
        stats = {s.get("name"): s.get("value") for s in (e.get("stats") or []) if isinstance(s, dict)}
        out.append({
            "name": normalize_team_name(team.get("displayName", ""), aliases),
            "abbr": team.get("abbreviation"),
            "points": stats.get("points"),
            "played": stats.get("gamesPlayed"),
            "wins": stats.get("wins"),
            "draws": stats.get("ties"),
            "losses": stats.get("losses"),
            "gf": stats.get("pointsFor"),
            "ga": stats.get("pointsAgainst"),
            "gd": stats.get("pointDifferential"),
        })
    return out


def _safe_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


@dataclass
class RefreshOutcome:
    wrote: bool
    stale: bool
    reason: str
    generatedAt: str
    sourceFetchedAt: Optional[str]
    problems: list[str] = field(default_factory=list)


def build_snapshot(
    *,
    kind: str,  # "scoreboard" | "standings"
    source_url: str,
    fetch_result: FetchResult,
    aliases: dict,
    previous: Optional[dict],
) -> tuple[dict, RefreshOutcome]:
    """Pure function: given a fetch result and the previous on-disk snapshot (or None), decides
    whether to write fresh normalized data or preserve-and-mark-stale. No I/O here — makes this
    trivially unit-testable with synthetic FetchResults, no real network or filesystem needed."""
    generated_at = now_iso()

    if not fetch_result.ok:
        if previous is None:
            snap = {
                "schemaVersion": SCHEMA_VERSION, "kind": kind, "sourceUrl": source_url,
                "generatedAt": generated_at, "sourceFetchedAt": None,
                "stale": True, "staleSince": generated_at, "staleReason": f"fetch failed: {fetch_result.error}",
                "data": None,
            }
            return snap, RefreshOutcome(False, True, "fetch failed, no previous snapshot to fall back on", generated_at, None, [fetch_result.error or "unknown error"])
        snap = dict(previous)
        snap["stale"] = True
        snap["staleSince"] = previous.get("staleSince") or generated_at
        snap["staleReason"] = f"fetch failed: {fetch_result.error}"
        return snap, RefreshOutcome(False, True, "fetch failed, kept last-known-good", generated_at, previous.get("sourceFetchedAt"), [fetch_result.error or "unknown error"])

    problems = validate_scoreboard_shape(fetch_result.data) if kind == "scoreboard" else validate_standings_shape(fetch_result.data)
    if problems:
        if previous is None:
            snap = {
                "schemaVersion": SCHEMA_VERSION, "kind": kind, "sourceUrl": source_url,
                "generatedAt": generated_at, "sourceFetchedAt": fetch_result.fetchedAt,
                "stale": True, "staleSince": generated_at, "staleReason": f"validation failed: {'; '.join(problems)}",
                "data": None,
            }
            return snap, RefreshOutcome(False, True, "validation failed, no previous snapshot", generated_at, fetch_result.fetchedAt, problems)
        snap = dict(previous)
        snap["stale"] = True
        snap["staleSince"] = previous.get("staleSince") or generated_at
        snap["staleReason"] = f"validation failed: {'; '.join(problems)}"
        return snap, RefreshOutcome(False, True, "validation failed, kept last-known-good", generated_at, previous.get("sourceFetchedAt"), problems)

    normalized = normalize_scoreboard(fetch_result.data, aliases) if kind == "scoreboard" else normalize_standings(fetch_result.data, aliases)
    snap = {
        "schemaVersion": SCHEMA_VERSION, "kind": kind, "sourceUrl": source_url,
        "generatedAt": generated_at, "sourceFetchedAt": fetch_result.fetchedAt,
        "stale": False, "staleSince": None, "staleReason": None,
        "data": normalized,
    }
    return snap, RefreshOutcome(True, False, "refreshed", generated_at, fetch_result.fetchedAt)


def write_snapshot(path: str, snapshot: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2, sort_keys=False)
        f.write("\n")


def read_snapshot(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None
