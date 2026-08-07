"""
notification_repository.py — Python mirror of notification_repository.mjs's NotificationRepository
contract (football-hardening readiness follow-up, items 2/5).

Same nine-method interface, same canonical schema, same MemoryNotificationRepository /
FileNotificationRepository pair. See notification_repository.mjs's module docstring for the full
rationale (production = Supabase, filesystem = tests/local dev only) — not repeated here to avoid
the two languages' docs drifting apart; this file's comments only cover Python-specific details.

CANONICAL SCHEMA — identical to the JS side, validated against the SAME JSON Schema file
(bolao/shared/schemas/notification_job.schema.json) — see test_notification_repository_interop.py
for the real cross-language schema-agreement test.
"""
from __future__ import annotations

import json
import os
import random
import string
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

SCHEMA_VERSION = 2

JOB_STATUS = {
    "PENDING": "pending",
    "PROCESSING": "processing",
    "SENT": "sent",
    "FAILED_RETRYABLE": "failed_retryable",
    "FAILED_PERMANENT": "failed_permanent",
    "SUPPRESSED": "suppressed",
    "CANCELLED": "cancelled",
}


def to_canonical(old: dict) -> dict:
    """Old (v1: app/matchId/resultVersion) -> canonical (v2). Pure, no I/O."""
    if old.get("schemaVersion") == SCHEMA_VERSION:
        return old
    return {
        "schemaVersion": SCHEMA_VERSION,
        "jobId": old.get("jobId"),
        "poolId": old.get("app"),
        "eventId": old.get("eventId") or f"{old.get('app')}:{old.get('matchId')}:v{old.get('resultVersion')}",
        "entityId": old.get("matchId"),
        "eventVersion": old.get("resultVersion"),
        "recipient": old.get("recipient"),
        "templateId": old.get("templateId", "default"),
        "templateVersion": old.get("templateVersion", 1),
        "payloadSnapshot": old.get("payloadSnapshot"),
        "idempotencyKey": old.get("idempotencyKey"),
        "status": JOB_STATUS["FAILED_RETRYABLE"] if old.get("status") == "failed" else old.get("status"),
        "attemptCount": old.get("attemptCount", 0),
        "nextAttemptAt": old.get("nextAttemptAt"),
        "lastAttemptAt": old.get("lastAttemptAt"),
        "sentAt": old.get("sentAt"),
        "providerMessageId": old.get("providerMessageId"),
        "lastError": old.get("lastError"),
        "createdAt": old.get("createdAt"),
    }


def from_canonical(job: dict) -> dict:
    """Canonical (v2) -> old (v1), for the three not-yet-migrated production call sites."""
    status = job.get("status")
    return {
        "schemaVersion": 1,
        "jobId": job.get("jobId"),
        "app": job.get("poolId"),
        "matchId": job.get("entityId"),
        "resultVersion": job.get("eventVersion"),
        "recipient": job.get("recipient"),
        "payloadSnapshot": job.get("payloadSnapshot"),
        "idempotencyKey": job.get("idempotencyKey"),
        "status": "failed" if status in (JOB_STATUS["FAILED_RETRYABLE"], JOB_STATUS["FAILED_PERMANENT"]) else status,
        "attemptCount": job.get("attemptCount"),
        "maxAttempts": 5,
        "processingStartedAt": job.get("claimedAt") if status == JOB_STATUS["PROCESSING"] else None,
        "lastAttemptAt": job.get("lastAttemptAt"),
        "sentAt": job.get("sentAt"),
        "providerMessageId": job.get("providerMessageId"),
        "lastError": job.get("lastError"),
        "createdAt": job.get("createdAt"),
    }


def build_idempotency_key(pool_id: str, entity_id: str, recipient: str, event_version) -> str:
    return f"{pool_id}:{entity_id}:{recipient}:v{event_version}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _rand_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}_{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}"


class MemoryNotificationRepository:
    """Fastest adapter — unit tests only, no I/O at all."""

    def __init__(self):
        self.events: dict[str, dict] = {}
        self.jobs: dict[str, dict] = {}

    def create_event(self, event: dict) -> tuple[dict, bool]:
        for e in self.events.values():
            if (e["poolId"], e["entityId"], e["eventType"], e["eventVersion"]) == (
                event["poolId"], event["entityId"], event["eventType"], event["eventVersion"]
            ):
                return e, False
        record = {**event, "eventId": event.get("eventId") or _rand_id("evt"), "createdAt": _now_iso(), "processedAt": None}
        self.events[record["eventId"]] = record
        return record, True

    def enqueue_jobs(self, event_id: str, job_drafts: list[dict]) -> tuple[list[dict], int]:
        created = []
        new_count = 0
        parent_event = self.events.get(event_id)
        for draft in job_drafts:
            existing = next((j for j in self.jobs.values() if j["idempotencyKey"] == draft["idempotencyKey"]), None)
            if existing:
                created.append(existing)
                continue
            job = {
                "schemaVersion": SCHEMA_VERSION, "jobId": _rand_id("job"), "eventId": event_id,
                "entityId": draft.get("entityId") or (parent_event or {}).get("entityId"),
                "eventVersion": draft.get("eventVersion") or (parent_event or {}).get("eventVersion"),
                "poolId": draft["poolId"], "recipient": draft["recipient"],
                "templateId": draft.get("templateId", "default"), "templateVersion": draft.get("templateVersion", 1),
                "payloadSnapshot": draft["payloadSnapshot"], "idempotencyKey": draft["idempotencyKey"],
                "status": JOB_STATUS["PENDING"], "attemptCount": 0, "nextAttemptAt": _now_iso(),
                "claimedAt": None, "claimedBy": None, "lastAttemptAt": None, "sentAt": None,
                "providerMessageId": None, "lastError": None, "createdAt": _now_iso(),
            }
            self.jobs[job["jobId"]] = job
            created.append(job)
            new_count += 1
        return created, new_count

    def claim_pending_jobs(self, pool_id: str, limit: int = 50, claimed_by: str = "worker") -> list[dict]:
        eligible = [j for j in self.jobs.values() if j["poolId"] == pool_id and j["status"] == JOB_STATUS["PENDING"]][:limit]
        for j in eligible:
            j["status"] = JOB_STATUS["PROCESSING"]
            j["claimedAt"] = _now_iso()
            j["claimedBy"] = claimed_by
        return eligible

    def mark_sent(self, job_id: str, provider_message_id: Optional[str] = None) -> dict:
        j = self._require(job_id)
        j["status"] = JOB_STATUS["SENT"]
        j["sentAt"] = _now_iso()
        j["lastAttemptAt"] = j["sentAt"]
        j["attemptCount"] += 1
        j["providerMessageId"] = provider_message_id
        j["claimedAt"] = None
        j["claimedBy"] = None
        return j

    def mark_retryable_failure(self, job_id: str, error: Optional[str] = None) -> dict:
        j = self._require(job_id)
        j["status"] = JOB_STATUS["FAILED_RETRYABLE"]
        j["lastAttemptAt"] = _now_iso()
        j["attemptCount"] += 1
        j["lastError"] = error or "unknown error"
        j["claimedAt"] = None
        j["claimedBy"] = None
        j["nextAttemptAt"] = _now_iso()
        return j

    def mark_permanent_failure(self, job_id: str, error: Optional[str] = None) -> dict:
        j = self._require(job_id)
        j["status"] = JOB_STATUS["FAILED_PERMANENT"]
        j["lastAttemptAt"] = _now_iso()
        j["attemptCount"] += 1
        j["lastError"] = error or "unknown error"
        j["claimedAt"] = None
        j["claimedBy"] = None
        return j

    def release_stuck_jobs(self, threshold_ms: int, now_ms: Optional[int] = None) -> int:
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        n = 0
        for j in self.jobs.values():
            if j["status"] != JOB_STATUS["PROCESSING"] or not j["claimedAt"]:
                continue
            claimed_ms = datetime.fromisoformat(j["claimedAt"].replace("Z", "+00:00")).timestamp() * 1000
            if now - claimed_ms >= threshold_ms:
                j["status"] = JOB_STATUS["PENDING"]
                j["claimedAt"] = None
                j["claimedBy"] = None
                n += 1
        return n

    def find_missing_notifications(self, pool_id: str) -> list[dict]:
        return [e for e in self.events.values() if e["poolId"] == pool_id and not any(j["eventId"] == e["eventId"] for j in self.jobs.values())]

    def find_unprocessed_final_results(self, pool_id: str) -> list[str]:
        return []

    def _require(self, job_id: str) -> dict:
        if job_id not in self.jobs:
            raise ValueError(f"unknown jobId: {job_id}")
        return self.jobs[job_id]


class FileNotificationRepository:
    """Local dev / integration tests ONLY, never production — see notification_repository.mjs's
    matching class for the full "why" (no real cross-process atomic lock over a plain file)."""

    def __init__(self, events_path: Optional[str] = None, jobs_path: Optional[str] = None):
        here = Path(__file__).parent
        self.events_path = events_path or str(here / "notification_events.json")
        self.jobs_path = jobs_path or str(here / "notification_jobs.json")

    def _read_all(self, path: str) -> list:
        if not os.path.exists(path):
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return []

    def _write_all(self, path: str, records: list) -> None:
        tmp = f"{path}.tmp-{os.getpid()}-{''.join(random.choices(string.ascii_lowercase, k=6))}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)

    def create_event(self, event: dict) -> tuple[dict, bool]:
        events = self._read_all(self.events_path)
        for e in events:
            if (e["poolId"], e["entityId"], e["eventType"], e["eventVersion"]) == (
                event["poolId"], event["entityId"], event["eventType"], event["eventVersion"]
            ):
                return e, False
        record = {**event, "eventId": event.get("eventId") or _rand_id("evt"), "createdAt": _now_iso(), "processedAt": None}
        events.append(record)
        self._write_all(self.events_path, events)
        return record, True

    def enqueue_jobs(self, event_id: str, job_drafts: list[dict]) -> tuple[list[dict], int]:
        jobs = self._read_all(self.jobs_path)
        events = self._read_all(self.events_path)
        parent_event = next((e for e in events if e["eventId"] == event_id), None)
        created = []
        new_count = 0
        for draft in job_drafts:
            existing = next((j for j in jobs if j["idempotencyKey"] == draft["idempotencyKey"]), None)
            if existing:
                created.append(existing)
                continue
            job = {
                "schemaVersion": SCHEMA_VERSION, "jobId": _rand_id("job"), "eventId": event_id,
                "entityId": draft.get("entityId") or (parent_event or {}).get("entityId"),
                "eventVersion": draft.get("eventVersion") or (parent_event or {}).get("eventVersion"),
                "poolId": draft["poolId"], "recipient": draft["recipient"],
                "templateId": draft.get("templateId", "default"), "templateVersion": draft.get("templateVersion", 1),
                "payloadSnapshot": draft["payloadSnapshot"], "idempotencyKey": draft["idempotencyKey"],
                "status": JOB_STATUS["PENDING"], "attemptCount": 0, "nextAttemptAt": _now_iso(),
                "claimedAt": None, "claimedBy": None, "lastAttemptAt": None, "sentAt": None,
                "providerMessageId": None, "lastError": None, "createdAt": _now_iso(),
            }
            jobs.append(job)
            created.append(job)
            new_count += 1
        self._write_all(self.jobs_path, jobs)
        return created, new_count

    def claim_pending_jobs(self, pool_id: str, limit: int = 50, claimed_by: str = "worker") -> list[dict]:
        jobs = self._read_all(self.jobs_path)
        eligible = [j for j in jobs if j["poolId"] == pool_id and j["status"] == JOB_STATUS["PENDING"]][:limit]
        for j in eligible:
            j["status"] = JOB_STATUS["PROCESSING"]
            j["claimedAt"] = _now_iso()
            j["claimedBy"] = claimed_by
        self._write_all(self.jobs_path, jobs)
        return eligible

    def mark_sent(self, job_id: str, provider_message_id: Optional[str] = None) -> dict:
        return self._update(job_id, lambda j: j.update(
            status=JOB_STATUS["SENT"], sentAt=_now_iso(), lastAttemptAt=j.get("sentAt") or _now_iso(),
            attemptCount=j["attemptCount"] + 1, providerMessageId=provider_message_id, claimedAt=None, claimedBy=None,
        ))

    def mark_retryable_failure(self, job_id: str, error: Optional[str] = None) -> dict:
        return self._update(job_id, lambda j: j.update(
            status=JOB_STATUS["FAILED_RETRYABLE"], lastAttemptAt=_now_iso(), attemptCount=j["attemptCount"] + 1,
            lastError=error or "unknown error", claimedAt=None, claimedBy=None, nextAttemptAt=_now_iso(),
        ))

    def mark_permanent_failure(self, job_id: str, error: Optional[str] = None) -> dict:
        return self._update(job_id, lambda j: j.update(
            status=JOB_STATUS["FAILED_PERMANENT"], lastAttemptAt=_now_iso(), attemptCount=j["attemptCount"] + 1,
            lastError=error or "unknown error", claimedAt=None, claimedBy=None,
        ))

    def release_stuck_jobs(self, threshold_ms: int, now_ms: Optional[int] = None) -> int:
        jobs = self._read_all(self.jobs_path)
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        n = 0
        for j in jobs:
            if j["status"] != JOB_STATUS["PROCESSING"] or not j["claimedAt"]:
                continue
            claimed_ms = datetime.fromisoformat(j["claimedAt"].replace("Z", "+00:00")).timestamp() * 1000
            if now - claimed_ms >= threshold_ms:
                j["status"] = JOB_STATUS["PENDING"]
                j["claimedAt"] = None
                j["claimedBy"] = None
                n += 1
        if n:
            self._write_all(self.jobs_path, jobs)
        return n

    def find_missing_notifications(self, pool_id: str) -> list[dict]:
        events = self._read_all(self.events_path)
        jobs = self._read_all(self.jobs_path)
        return [e for e in events if e["poolId"] == pool_id and not any(j["eventId"] == e["eventId"] for j in jobs)]

    def find_unprocessed_final_results(self, pool_id: str) -> list[str]:
        return []

    def _update(self, job_id: str, mutator) -> dict:
        jobs = self._read_all(self.jobs_path)
        idx = next((i for i, j in enumerate(jobs) if j["jobId"] == job_id), None)
        if idx is None:
            raise ValueError(f"unknown jobId: {job_id}")
        mutator(jobs[idx])
        self._write_all(self.jobs_path, jobs)
        return jobs[idx]
