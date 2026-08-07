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
    # ESPN's public endpoints 403 a custom/unfamiliar User-Agent string but accept curl's default
    # (found empirically while wiring up checkpoint C2 — plain `curl` with no -A flag and
    # `curl/8.x` both return 200; a descriptive UA like "bolao-espn-provider/1.0" or a spoofed
    # Chrome UA both got 403). Not spoofing a browser, just not identifying as an unrecognized
    # custom client either.
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.7.1"})
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
        status = comp.get("status") or {}
        status_type = status.get("type") or {}
        out.append({
            "id": ev.get("id"),
            "date": ev.get("date"),
            "state": status_type.get("state"),
            "statusName": status_type.get("name"),
            "statusDescription": status_type.get("description"),
            "statusShortDetail": status_type.get("shortDetail"),
            "statusDetail": status_type.get("detail"),
            "completed": status_type.get("completed"),
            "homeTeam": normalize_team_name((home.get("team") or {}).get("displayName", ""), aliases),
            "awayTeam": normalize_team_name((away.get("team") or {}).get("displayName", ""), aliases),
            "homeTeamId": (home.get("team") or {}).get("id"),
            "awayTeamId": (away.get("team") or {}).get("id"),
            "homeScore": _safe_int(home.get("score")),
            "awayScore": _safe_int(away.get("score")),
            "homeWinner": home.get("winner") if isinstance(home.get("winner"), bool) else None,
            "awayWinner": away.get("winner") if isinstance(away.get("winner"), bool) else None,
            "venue": (comp.get("venue") or {}).get("fullName"),
            "city": (((comp.get("venue") or {}).get("address")) or {}).get("city", ""),
            # Live-clock/period fields — carried through server-side now (previously read
            # straight off the raw ESPN payload client-side) so the frontend's existing
            # halftime/penalties/clock-pause detection logic can keep working unchanged after
            # migrating off the direct ESPN fetch (checkpoint C2).
            "clockSec": status.get("clock") if isinstance(status.get("clock"), (int, float)) else None,
            "clockStr": status.get("displayClock", ""),
            "period": status.get("period") if isinstance(status.get("period"), int) else None,
            # Minute-by-minute plays (goals/cards/subs) — comp.details only; the richer
            # per-event summary endpoint's keyEvents (fetchEspnEventSummary in the old
            # client-side code) is intentionally NOT fetched here for every match on every sync
            # to avoid an N+1 network fan-out server-side for matches that aren't even live;
            # kept as a documented, not silently dropped, scope reduction — see
            # docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md checkpoint C2 notes.
            "details": normalize_details(comp.get("details")),
        })
    return out


# Campos de `details` REALMENTE consumidos por extractMatchPlays() nos três apps (Copa/BR2026/
# CDB2026): type.text, type.name, scoringPlay, team.id, clock.value, clock.displayValue e
# athletesInvolved[].displayName/.shortName. Nada mais é lido.
#
# Por que normalizar em vez de repassar: repassando o `details` cru da ESPN, o snapshot do BR2026
# saía com 2 MB para 382 partidas (~5,5 KB por partida). O volume não é a jogada em si — é o que
# vem pendurado nela: `links` com URLs de jogador na ESPN, `fullName`, `position`, `jersey`, `id`
# de atleta. Isso (a) é peso que o NAVEGADOR baixa (o snapshot passa a ser servido ao cliente,
# então 2 MB viram 2 MB de download no mobile), (b) infla o histórico do git a cada refresh do
# snapshot no CI e (c) despeja dados pessoais de terceiros (nomes/URLs de atletas) num arquivo
# versionado, sem nenhum consumidor. Um "provider de normalização" que repassa o payload bruto não
# está normalizando.
#
# Whitelist explícita: campo novo que algum app venha a consumir precisa ser adicionado aqui de
# propósito, e o teste de contrato abaixo falha se o conjunto mudar sem intenção.
_DETAIL_ATHLETE_FIELDS = ("displayName", "shortName")


def normalize_details(details) -> list[dict]:
    if not isinstance(details, list):
        return []
    out = []
    for d in details:
        if not isinstance(d, dict):
            continue
        dtype = d.get("type") if isinstance(d.get("type"), dict) else {}
        clock = d.get("clock") if isinstance(d.get("clock"), dict) else {}
        team = d.get("team") if isinstance(d.get("team"), dict) else {}
        athletes = []
        raw_athletes = d.get("athletesInvolved")
        if not isinstance(raw_athletes, list):
            # O endpoint de summary usa participants[].athlete; os apps aceitam os dois formatos,
            # então o snapshot normaliza para o formato único athletesInvolved[].
            raw_athletes = [p.get("athlete") for p in (d.get("participants") or [])
                            if isinstance(p, dict)]
        for a in raw_athletes or []:
            if not isinstance(a, dict):
                continue
            trimmed = {k: a[k] for k in _DETAIL_ATHLETE_FIELDS if a.get(k)}
            if trimmed:
                athletes.append(trimmed)
        entry = {
            "type": {k: dtype[k] for k in ("text", "name") if dtype.get(k)},
            "scoringPlay": d.get("scoringPlay") is True,
            "team": {"id": str(team["id"])} if team.get("id") is not None else {},
            "clock": {k: clock[k] for k in ("value", "displayValue") if clock.get(k) is not None},
        }
        if athletes:
            entry["athletesInvolved"] = athletes
        out.append(entry)
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
            "logo": ((team.get("logos") or [{}])[0] or {}).get("href", ""),
            "rank": stats.get("rank"),
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


def payload_hash(matches) -> str:
    """sha256 of the normalized matches list, canonical JSON (sorted keys) so the hash is stable
    regardless of key insertion order. Used to detect "ESPN returned 200 but nothing actually
    changed" without depending on ESPN's own timestamps being reliable."""
    import hashlib
    canonical = json.dumps(matches, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _base_snapshot(*, competition_id: str, provider: str, generated_at: str,
                    source_updated_at: Optional[str], stale: bool, stale_reason: Optional[str],
                    matches, payload_hash_val: Optional[str]) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "competitionId": competition_id,
        "provider": provider,
        "generatedAt": generated_at,
        "sourceUpdatedAt": source_updated_at,
        "stale": stale,
        "staleReason": stale_reason,
        "payloadHash": payload_hash_val,
        "matches": matches,
    }


def build_snapshot(
    *,
    kind: str,  # "scoreboard" | "standings"
    competition_id: str,
    provider: str,
    fetch_result: FetchResult,
    aliases: dict,
    previous: Optional[dict],
) -> tuple[dict, RefreshOutcome]:
    """Pure function: given a fetch result and the previous on-disk snapshot (or None), decides
    whether to write fresh normalized data or preserve-and-mark-stale. No I/O here — makes this
    trivially unit-testable with synthetic FetchResults, no real network or filesystem needed.

    Output shape matches the required cross-app snapshot contract exactly: schemaVersion,
    competitionId, generatedAt, sourceUpdatedAt, stale, staleReason, provider, payloadHash,
    matches."""
    generated_at = now_iso()

    if not fetch_result.ok:
        if previous is None:
            snap = _base_snapshot(
                competition_id=competition_id, provider=provider, generated_at=generated_at,
                source_updated_at=None, stale=True,
                stale_reason=f"fetch failed: {fetch_result.error}", matches=[], payload_hash_val=None,
            )
            return snap, RefreshOutcome(False, True, "fetch failed, no previous snapshot to fall back on", generated_at, None, [fetch_result.error or "unknown error"])
        snap = dict(previous)
        snap["schemaVersion"] = SCHEMA_VERSION
        snap["stale"] = True
        snap["staleReason"] = f"fetch failed: {fetch_result.error}"
        return snap, RefreshOutcome(False, True, "fetch failed, kept last-known-good", generated_at, previous.get("sourceUpdatedAt"), [fetch_result.error or "unknown error"])

    problems = validate_scoreboard_shape(fetch_result.data) if kind == "scoreboard" else validate_standings_shape(fetch_result.data)
    if problems:
        if previous is None:
            snap = _base_snapshot(
                competition_id=competition_id, provider=provider, generated_at=generated_at,
                source_updated_at=fetch_result.fetchedAt, stale=True,
                stale_reason=f"validation failed: {'; '.join(problems)}", matches=[], payload_hash_val=None,
            )
            return snap, RefreshOutcome(False, True, "validation failed, no previous snapshot", generated_at, fetch_result.fetchedAt, problems)
        snap = dict(previous)
        snap["schemaVersion"] = SCHEMA_VERSION
        snap["stale"] = True
        snap["staleReason"] = f"validation failed: {'; '.join(problems)}"
        return snap, RefreshOutcome(False, True, "validation failed, kept last-known-good", generated_at, previous.get("sourceUpdatedAt"), problems)

    normalized = normalize_scoreboard(fetch_result.data, aliases) if kind == "scoreboard" else normalize_standings(fetch_result.data, aliases)
    new_hash = payload_hash(normalized)
    snap = _base_snapshot(
        competition_id=competition_id, provider=provider, generated_at=generated_at,
        source_updated_at=fetch_result.fetchedAt, stale=False, stale_reason=None,
        matches=normalized, payload_hash_val=new_hash,
    )
    return snap, RefreshOutcome(True, False, "refreshed", generated_at, fetch_result.fetchedAt)


def is_schema_compatible(snapshot: Optional[dict]) -> bool:
    """A snapshot written by a future/incompatible schema version must never be silently treated
    as a valid previous-good baseline — that would let a schema migration corrupt the
    last-known-good chain. Only exact match on SCHEMA_VERSION is trusted as previous."""
    if snapshot is None:
        return True  # no previous snapshot at all is trivially "compatible" (nothing to reject)
    return snapshot.get("schemaVersion") == SCHEMA_VERSION


def write_snapshot_atomic(path: str, snapshot: dict) -> None:
    """Atomic write: serialize to a temp file in the SAME directory, validate the temp file
    round-trips as valid JSON with the required keys, then os.replace() it over the destination.
    os.replace() is atomic on POSIX and Windows — a reader (or a crashed writer) never observes a
    partially-written file, and a write that fails validation never touches the real path at all,
    so a valid last-known-good snapshot can never be clobbered by a broken one."""
    import os
    import tempfile

    required_keys = {"schemaVersion", "competitionId", "generatedAt", "sourceUpdatedAt",
                      "stale", "staleReason", "provider", "payloadHash", "matches"}
    missing = required_keys - set(snapshot.keys())
    if missing:
        raise ValidationError(f"refusing to write snapshot missing required keys: {sorted(missing)}")

    directory = os.path.dirname(os.path.abspath(path)) or "."
    # Cria o diretório se faltar. Sem isto, `mkstemp(dir=...)` levanta FileNotFoundError num
    # checkout onde `bolao/<app>/data/` ainda não existe — o que é exatamente o caso de um clone
    # novo ou de um app novo. Na branch original o diretório vinha versionado junto com o snapshot,
    # então o bug ficava escondido; reconstruindo o pipeline em cima do main limpo ele apareceu na
    # primeira execução. `exist_ok=True` mantém a operação idempotente.
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".espn-snapshot-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2, sort_keys=False)
            f.write("\n")
        # Validate the temp file actually round-trips before it ever becomes the real file.
        with open(tmp_path, "r", encoding="utf-8") as f:
            reread = json.load(f)
        if set(required_keys) - set(reread.keys()):
            raise ValidationError("temp snapshot failed round-trip validation")
        os.replace(tmp_path, path)  # atomic on POSIX/Windows
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


# Backward-compat alias — earlier checkpoint-C draft name, kept so anything already importing it
# (including its own tests before this revision) still works. New code should call
# write_snapshot_atomic() directly, which is the one with the atomicity + validation guarantee.
def write_snapshot(path: str, snapshot: dict) -> None:
    write_snapshot_atomic(path, snapshot)


def read_snapshot(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def run_sync(config: dict) -> RefreshOutcome:
    """The one driver every per-app wrapper script calls. Each app's own script (e.g.
    bolao/cdb2026/scripts/sync_espn.py) supplies ONLY declarative config — competition id,
    source URL, kind, app-specific aliases, output path — no per-app reimplementation of
    fetch/validate/normalize/write logic, per checkpoint C2's requirement.

    config keys (all required):
      competition_id: str   — e.g. "bra.copa_do_brazil"
      provider: str         — e.g. "espn"
      kind: str             — "scoreboard" | "standings"
      source_url: str
      output_path: str      — where to write bolao/{app}/data/espn-normalized.json
      aliases: dict         — app-specific team-name aliases beyond any shared defaults
      timeout_s, retries, retry_backoff_s: optional, fall back to module defaults
    """
    output_path = config["output_path"]
    previous = read_snapshot(output_path)
    if not is_schema_compatible(previous):
        # A future/incompatible schema on disk must never be trusted as a fallback baseline —
        # treat it the same as "no previous snapshot" rather than silently reading a shape this
        # code doesn't understand.
        previous = None

    fetch_result = fetch_json(
        config["source_url"],
        timeout_s=config.get("timeout_s", DEFAULT_TIMEOUT_S),
        retries=config.get("retries", DEFAULT_RETRIES),
        backoff_s=config.get("retry_backoff_s", DEFAULT_RETRY_BACKOFF_S),
    )
    snapshot, outcome = build_snapshot(
        kind=config["kind"],
        competition_id=config["competition_id"],
        provider=config.get("provider", "espn"),
        fetch_result=fetch_result,
        aliases=config.get("aliases", {}),
        previous=previous,
    )
    # ESCRITA IDEMPOTENTE: se o conteúdo upstream não mudou (mesmo payloadHash) e o snapshot em
    # disco continua válido, NÃO reescrever. Sem isto o `generatedAt` muda a cada execução e o
    # arquivo é reescrito sempre — no CI isso significa um commit novo de ~3,5 MB (os três apps
    # somados) a cada rodada do workflow, inflando o histórico do git indefinidamente para zero
    # informação nova. O marcador de stale continua sendo gravado normalmente quando o estado de
    # frescor MUDA, então uma fonte caindo nunca passa por "sem novidade".
    if (previous
            and not snapshot.get("stale")
            and not previous.get("stale")
            and previous.get("payloadHash")
            and previous.get("payloadHash") == snapshot.get("payloadHash")):
        outcome.wrote = False
        outcome.reason = "unchanged"
        return outcome
    write_snapshot_atomic(output_path, snapshot)
    return outcome
