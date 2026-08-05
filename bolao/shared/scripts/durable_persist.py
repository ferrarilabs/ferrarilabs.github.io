"""
durable_persist.py — makes the shared outbox/match-store JSON files ACTUALLY durable across
independent GitHub Actions runs (football-hardening follow-up, section 2 finding).

WHY THIS EXISTS: audited 2026-08 — bolao/shared/scripts/notification_outbox.json and
match_store.json were never committed to git, and no workflow used actions/cache or
actions/upload-artifact/download-artifact. Every workflow run does a fresh actions/checkout@v4.
Result: the outbox/reconciler pipeline built in checkpoints C/D/F had ZERO durability across
separate runs — a second run could never see a job the first run created. This was found via a
real 3-independent-clone test (test_durable_persist.py), not assumed.

FIX: use git itself as the durable store — this repo already has no database and is
git-centric (the cache-bust version bump is already an established "CI commits a generated file
back to the repo" pattern, see .github/workflows/sync_version.yml). After the outbox/match-store
files change, `sync_state()` pulls latest (rebase), stages the given files, commits if there's a
real diff, and pushes — with retry-on-conflict (another concurrent runner pushed first) via
pull --rebase + retry, up to `max_retries` times.

This is deliberately NOT wired into the real production workflows in this pass — see
docs/bolao/FOOTBALL_HARDENING_DURABILITY_AUDIT.md for why (a live money-critical email cron is
not the place to land a first, hastily-reviewed git-push-based locking mechanism) — it is a
tested, working prototype + the concrete fix path, not yet the production wiring.
"""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path


def _run(args, cwd):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


def merge_job_arrays(base: list, ours: list, theirs: list) -> list:
    """JSON-aware union merge for outbox/match-store job arrays, keyed by jobId (outbox) or
    matchId (match store) — same "union entries, local wins for paid/results" strategy CLAUDE.md
    already documents for this repo's Supabase state merge, reused here rather than invented.

    Why this exists: git's own line-based rebase/merge on a pretty-printed JSON array FAILS on
    two concurrent single-item appends (both diffs touch the same `[]` -> `[{...}]` region) —
    confirmed via a real conflicting-push test, not assumed. A real merge needs to understand
    "these are two different array elements," not "these are two conflicting edits to the same
    line."
    """
    def key_of(item):
        return item.get("jobId") or item.get("matchId")

    merged = {}
    for item in base:
        merged[key_of(item)] = item
    for item in ours:
        merged[key_of(item)] = item
    for item in theirs:
        k = key_of(item)
        if k not in merged:
            merged[k] = item  # a genuinely new record from the other side — always keep
        else:
            # Same key on both sides: prefer whichever has progressed further in its own
            # status lifecycle (pending -> processing -> sent/failed) rather than blindly
            # picking one side — mirrors the outbox's own "never resend something already sent"
            # invariant. attemptCount is a reasonable proxy for "more progressed."
            existing = merged[k]
            if item.get("attemptCount", 0) > existing.get("attemptCount", 0) or item.get("status") == "sent":
                merged[k] = item
    # Stable order: by createdAt/updatedAt if present, else insertion order.
    return list(merged.values())


def resolve_conflict_via_json_merge(repo_dir: str, file_rel_path: str, remote: str, branch: str) -> dict:
    """Called when a plain `git pull --rebase` conflicts on `file_rel_path`. Reads OUR version
    (already committed locally), THEIRS (the remote's current tip), and BASE (merge-base), does
    a JSON-aware array union instead of trusting git's line-based conflict markers, writes the
    merged file, and creates a resolution commit. Returns {ok, reason}."""
    file_path = Path(repo_dir) / file_rel_path
    # Our version is what HEAD (pre-rebase-attempt) had — read it before touching anything.
    show_ours = _run(["git", "show", f"HEAD:{file_rel_path}"], repo_dir)
    if show_ours.returncode != 0:
        return {"ok": False, "reason": f"could not read our version: {show_ours.stderr}"}
    fetch = _run(["git", "fetch", remote, branch], repo_dir)
    if fetch.returncode != 0:
        return {"ok": False, "reason": f"fetch failed: {fetch.stderr}"}
    show_theirs = _run(["git", "show", f"{remote}/{branch}:{file_rel_path}"], repo_dir)
    if show_theirs.returncode != 0:
        return {"ok": False, "reason": f"could not read remote version: {show_theirs.stderr}"}
    merge_base = _run(["git", "merge-base", "HEAD", f"{remote}/{branch}"], repo_dir)
    base_content = "[]"
    if merge_base.returncode == 0:
        show_base = _run(["git", "show", f"{merge_base.stdout.strip()}:{file_rel_path}"], repo_dir)
        if show_base.returncode == 0:
            base_content = show_base.stdout

    try:
        ours = json.loads(show_ours.stdout)
        theirs = json.loads(show_theirs.stdout)
        base = json.loads(base_content)
    except json.JSONDecodeError as e:
        return {"ok": False, "reason": f"could not parse JSON for merge: {e}"}

    merged = merge_job_arrays(base, ours, theirs)

    # Reset to the remote tip (clean slate — no leftover conflicted rebase state) then apply the
    # merged content as a new commit on top.
    reset = _run(["git", "reset", "--hard", f"{remote}/{branch}"], repo_dir)
    if reset.returncode != 0:
        return {"ok": False, "reason": f"reset failed: {reset.stderr}"}
    file_path.write_text(json.dumps(merged, indent=2) + "\n")
    add = _run(["git", "add", file_rel_path], repo_dir)
    if add.returncode != 0:
        return {"ok": False, "reason": f"add failed: {add.stderr}"}
    commit = _run(["git", "commit", "-m", f"merge: JSON-aware union of {file_rel_path}"], repo_dir)
    if commit.returncode != 0:
        return {"ok": False, "reason": f"commit failed: {commit.stderr}"}
    return {"ok": True, "reason": "merged"}


def sync_state(repo_dir: str, files: list[str], commit_message: str, max_retries: int = 5, remote: str = "origin", branch: str = "main") -> dict:
    """Stage `files` and commit LOCALLY first (git pull --rebase requires a clean working tree —
    trying to pull before committing our own in-progress write fails every time, which is
    exactly the bug this comment replaces: an earlier version called pull before add/commit and
    the retry loop just kept hitting the same "unstaged changes" error until it gave up). Then
    rebase onto the latest remote tip and push, retrying (re-rebase + re-push) if a concurrent
    runner's push landed first — this is what makes concurrent independent runners safe: a
    losing push never silently drops its commit, it retries against the new tip. Returns
    {ok, attempts, pushed, reason}."""
    add = _run(["git", "add", *files], repo_dir)
    if add.returncode != 0:
        return {"ok": False, "attempts": 0, "pushed": False, "reason": f"git add failed: {add.stderr}"}

    diff = _run(["git", "diff", "--cached", "--quiet"], repo_dir)
    if diff.returncode == 0:
        return {"ok": True, "attempts": 0, "pushed": False, "reason": "no local changes to persist"}

    commit = _run(["git", "commit", "-m", commit_message], repo_dir)
    if commit.returncode != 0:
        return {"ok": False, "attempts": 0, "pushed": False, "reason": f"git commit failed: {commit.stderr}"}

    for attempt in range(1, max_retries + 1):
        push = _run(["git", "push", remote, f"HEAD:{branch}"], repo_dir)
        if push.returncode == 0:
            return {"ok": True, "attempts": attempt, "pushed": True, "reason": "pushed"}

        # Push rejected — a concurrent runner pushed between our clone and our push. Rebase our
        # local commit onto the new tip and try again.
        rebase = _run(["git", "pull", "--rebase", remote, branch], repo_dir)
        if rebase.returncode != 0:
            # Plain line-based rebase conflicted — confirmed via a real test that this happens
            # even for two DIFFERENT array elements appended concurrently (both diffs touch the
            # same `[]`-adjacent line). Never guess by keeping "ours" or "theirs" wholesale —
            # abort the broken rebase and do a real JSON-aware union merge instead.
            _run(["git", "rebase", "--abort"], repo_dir)
            resolved = False
            for f in files:
                res = resolve_conflict_via_json_merge(repo_dir, f, remote, branch)
                if not res["ok"]:
                    return {"ok": False, "attempts": attempt, "pushed": False, "reason": f"JSON merge failed for {f}: {res['reason']}"}
                resolved = True
            if not resolved:
                return {"ok": False, "attempts": attempt, "pushed": False, "reason": "conflict but no files to merge"}
            # Loop back around and try pushing the merge-resolution commit.
        time.sleep(0.2 * attempt)

    return {"ok": False, "attempts": max_retries, "pushed": False, "reason": "exhausted retries — persistent push conflict"}
