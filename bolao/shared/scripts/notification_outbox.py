"""
notification_outbox.py — Python port of bolao/shared/scripts/notification_outbox.mjs, same JSON
schema and same idempotency-key format (football-hardening checkpoint F).

WHY THIS EXISTS: checkpoint D built the shared match-state-machine/outbox/reconciler pipeline in
JS. Checkpoint F's job is to actually WIRE that pipeline into each app's real operational flow —
but Copa2026's and CDB2026's real result-email automation (send_result_email.py) is Python, not
JS, and is a live, money-critical, audit-gated script (CLAUDE.md: "refuses to send any email if
[audit_scoring.py's self-test] fails"). Rewriting it wholesale to call into Node would be exactly
the kind of large, risky, non-reversible change CLAUDE.md's platform governance prohibits for a
script in production ("patches pequenos, testados e reversíveis").

So instead: this module speaks the EXACT SAME on-disk JSON contract as notification_outbox.mjs
(same field names: jobId, app, matchId, recipient, resultVersion, payloadSnapshot,
idempotencyKey, status, attemptCount, ...) so a job enqueued by one language is readable, claimable,
and completable by the other. That's the real integration point: both languages share ONE outbox,
enforcing the SAME duplicate-prevention guarantee, without either language needing to call into
the other's runtime.

send_result_email.py (both apps) gets one new, additive, off-by-default-until-called function:
check_idempotent_before_send() — a duplicate-prevention safety net that can only ever SKIP a send
that's a literal repeat of an already-recorded idempotency key; it can never suppress a send that
would have gone out before this change existed. See each script's own integration comment.
"""
from __future__ import annotations

import json
import os
import time
import random
import string
from datetime import datetime, timezone
from typing import Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_outbox_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "notification_outbox.json")


def read_all(path: str) -> list:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def _write_all(jobs: list, path: str) -> None:
    tmp = f"{path}.tmp-{os.getpid()}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=6))}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(jobs, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)  # atomic on POSIX/Windows, same discipline as espn_provider.py


def idempotency_key(app: str, match_id: str, recipient: str, result_version) -> str:
    # MUST stay byte-for-byte identical to notification_outbox.mjs's idempotencyKey() format —
    # this is the entire cross-language interoperability contract. Covered by
    # test_notification_outbox_interop.mjs, which enqueues from Python and reads from Node (and
    # vice versa) and asserts the keys collide correctly.
    return f"{app}:{match_id}:{recipient}:v{result_version}"


def find_by_idempotency_key(key: str, path: Optional[str] = None) -> Optional[dict]:
    path = path or default_outbox_path()
    for job in read_all(path):
        if job.get("idempotencyKey") == key:
            return job
    return None


def enqueue(job: dict, path: Optional[str] = None) -> tuple[dict, bool]:
    """Same contract as notification_outbox.mjs's enqueue(): returns (job, created). A job with
    an idempotencyKey that already exists on disk (written by either language) is returned
    unchanged, created=False — this IS the duplicate-prevention mechanism."""
    path = path or default_outbox_path()
    jobs = read_all(path)
    existing = next((j for j in jobs if j.get("idempotencyKey") == job["idempotencyKey"]), None)
    if existing:
        return existing, False
    record = {
        "jobId": f"job_{int(time.time() * 1000)}_{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}",
        "app": job["app"],
        "matchId": job["matchId"],
        "recipient": job["recipient"],
        "resultVersion": job["resultVersion"],
        "payloadSnapshot": job["payloadSnapshot"],
        "idempotencyKey": job["idempotencyKey"],
        "status": "pending",
        "attemptCount": 0,
        "maxAttempts": job.get("maxAttempts", 5),
        "processingStartedAt": None,
        "lastAttemptAt": None,
        "sentAt": None,
        "lastError": None,
        "createdAt": _now_iso(),
    }
    jobs.append(record)
    _write_all(jobs, path)
    return record, True


def record_result(job_id: str, ok: bool, error: Optional[str] = None, path: Optional[str] = None) -> dict:
    path = path or default_outbox_path()
    jobs = read_all(path)
    idx = next((i for i, j in enumerate(jobs) if j.get("jobId") == job_id), None)
    if idx is None:
        raise ValueError(f"unknown jobId: {job_id}")
    j = jobs[idx]
    j["attemptCount"] = j.get("attemptCount", 0) + 1
    j["lastAttemptAt"] = _now_iso()
    j["processingStartedAt"] = None
    j["status"] = "sent" if ok else "failed"
    j["lastError"] = None if ok else (error or "unknown error")
    if ok:
        j["sentAt"] = j["lastAttemptAt"]
    jobs[idx] = j
    _write_all(jobs, path)
    return j
