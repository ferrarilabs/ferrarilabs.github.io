"""
test_notification_repository.py — real tests for MemoryNotificationRepository and
FileNotificationRepository (Python side), mirroring test_notification_repository.mjs exactly so
Node and Python are proven to behave identically against the shared contract (football-hardening
readiness follow-up, items 2/5).

Run: python3 bolao/shared/scripts/test_notification_repository.py
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from notification_repository import (  # noqa: E402
    MemoryNotificationRepository, FileNotificationRepository,
    to_canonical, from_canonical, build_idempotency_key, JOB_STATUS, SCHEMA_VERSION,
)


def make_repo_suite(repo_factory, label):
    class Suite(unittest.TestCase):
        def test_create_event_and_enqueue_and_claim_and_mark(self):
            repo = repo_factory()
            event, created = repo.create_event({"poolId": "cdb2026", "entityType": "tie", "entityId": "oitavas:tie-1", "eventType": "final_confirmed", "eventVersion": 1, "payloadSnapshot": {"homeScore": 1, "awayScore": 1}})
            self.assertTrue(created)
            dup_event, dup_created = repo.create_event({"poolId": "cdb2026", "entityType": "tie", "entityId": "oitavas:tie-1", "eventType": "final_confirmed", "eventVersion": 1, "payloadSnapshot": {"homeScore": 1, "awayScore": 1}})
            self.assertFalse(dup_created)
            self.assertEqual(dup_event["eventId"], event["eventId"])

            key1 = build_idempotency_key("cdb2026", "oitavas:tie-1", "alfa@example.test", 1)
            key2 = build_idempotency_key("cdb2026", "oitavas:tie-1", "beta@example.test", 1)
            jobs, created_count = repo.enqueue_jobs(event["eventId"], [
                {"poolId": "cdb2026", "recipient": "alfa@example.test", "payloadSnapshot": {"x": 1}, "idempotencyKey": key1},
                {"poolId": "cdb2026", "recipient": "beta@example.test", "payloadSnapshot": {"x": 1}, "idempotencyKey": key2},
            ])
            self.assertEqual(created_count, 2)
            self.assertEqual(len(jobs), 2)
            self.assertEqual(jobs[0]["entityId"], "oitavas:tie-1", "job must carry denormalized entityId")
            self.assertEqual(jobs[0]["eventVersion"], 1, "job must carry denormalized eventVersion")

            dup_jobs, dup_count = repo.enqueue_jobs(event["eventId"], [
                {"poolId": "cdb2026", "recipient": "alfa@example.test", "payloadSnapshot": {"x": 1}, "idempotencyKey": key1},
            ])
            self.assertEqual(dup_count, 0, "enqueueJobs must be idempotent by idempotencyKey")

            claimed = repo.claim_pending_jobs("cdb2026", 50, "test-worker")
            self.assertEqual(len(claimed), 2)
            self.assertTrue(all(j["status"] == JOB_STATUS["PROCESSING"] for j in claimed))

            claimed_again = repo.claim_pending_jobs("cdb2026", 50, "test-worker-2")
            self.assertEqual(len(claimed_again), 0, "a second claim must see zero already-claimed jobs")

            sent = repo.mark_sent(claimed[0]["jobId"], provider_message_id="provider-msg-1")
            self.assertEqual(sent["status"], JOB_STATUS["SENT"])
            self.assertEqual(sent["providerMessageId"], "provider-msg-1")

            failed = repo.mark_retryable_failure(claimed[1]["jobId"], error="simulated provider outage")
            self.assertEqual(failed["status"], JOB_STATUS["FAILED_RETRYABLE"])
            self.assertEqual(failed["lastError"], "simulated provider outage")

        def test_release_stuck_jobs(self):
            repo = repo_factory()
            event, _ = repo.create_event({"poolId": "br2026", "entityType": "round_batch", "entityId": "round:g1,g2", "eventType": "final_confirmed", "eventVersion": 1, "payloadSnapshot": {}})
            repo.enqueue_jobs(event["eventId"], [{"poolId": "br2026", "recipient": "x@example.test", "payloadSnapshot": {}, "idempotencyKey": build_idempotency_key("br2026", "round:g1,g2", "x@example.test", 1)}])
            repo.claim_pending_jobs("br2026", 10, "crashed-worker")
            # Fake clock via now_ms override — 10 real minutes later.
            import time
            future_ms = int(time.time() * 1000) + 10 * 60 * 1000
            recovered = repo.release_stuck_jobs(5 * 60 * 1000, now_ms=future_ms)
            self.assertEqual(recovered, 1)

        def test_find_missing_notifications(self):
            repo = repo_factory()
            event, _ = repo.create_event({"poolId": "copa2026", "entityType": "match", "entityId": "M95", "eventType": "final_confirmed", "eventVersion": 1, "payloadSnapshot": {}})
            missing = repo.find_missing_notifications("copa2026")
            self.assertTrue(any(e["eventId"] == event["eventId"] for e in missing))
            repo.enqueue_jobs(event["eventId"], [{"poolId": "copa2026", "recipient": "y@example.test", "payloadSnapshot": {}, "idempotencyKey": build_idempotency_key("copa2026", "M95", "y@example.test", 1)}])
            missing_after = repo.find_missing_notifications("copa2026")
            self.assertFalse(any(e["eventId"] == event["eventId"] for e in missing_after))

    Suite.__name__ = f"{label}Tests"
    Suite.__qualname__ = Suite.__name__
    return Suite


MemoryTests = make_repo_suite(lambda: MemoryNotificationRepository(), "Memory")


class _FileRepoFactory:
    def __init__(self):
        self._tmpdir = tempfile.TemporaryDirectory()

    def __call__(self):
        d = tempfile.mkdtemp(dir=self._tmpdir.name)
        return FileNotificationRepository(events_path=str(Path(d) / "events.json"), jobs_path=str(Path(d) / "jobs.json"))


_file_factory = _FileRepoFactory()
FileTests = make_repo_suite(_file_factory, "File")


class CanonicalSchemaTests(unittest.TestCase):
    def test_to_canonical_maps_old_names(self):
        old_job = {
            "schemaVersion": 1, "jobId": "job_1", "app": "cdb2026", "matchId": "oitavas:tie-1",
            "recipient": "a@x.test", "resultVersion": 1, "payloadSnapshot": {"x": 1},
            "idempotencyKey": "cdb2026:oitavas:tie-1:a@x.test:v1", "status": "sent", "attemptCount": 1,
            "maxAttempts": 5, "processingStartedAt": None, "lastAttemptAt": "2026-01-01T00:00:00Z",
            "sentAt": "2026-01-01T00:00:00Z", "providerMessageId": "pm-1", "lastError": None,
            "createdAt": "2026-01-01T00:00:00Z",
        }
        canonical = to_canonical(old_job)
        self.assertEqual(canonical["poolId"], "cdb2026")
        self.assertEqual(canonical["entityId"], "oitavas:tie-1")
        self.assertEqual(canonical["eventVersion"], 1)
        self.assertEqual(canonical["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(canonical["providerMessageId"], "pm-1")

    def test_from_canonical_round_trips(self):
        old_job = {"schemaVersion": 1, "jobId": "job_1", "app": "cdb2026", "matchId": "oitavas:tie-1", "recipient": "a@x.test", "resultVersion": 1, "payloadSnapshot": {"x": 1}, "idempotencyKey": "k1", "status": "sent", "attemptCount": 1, "maxAttempts": 5, "processingStartedAt": None, "lastAttemptAt": None, "sentAt": None, "providerMessageId": None, "lastError": None, "createdAt": None}
        canonical = to_canonical(old_job)
        roundtripped = from_canonical(canonical)
        self.assertEqual(roundtripped["app"], "cdb2026")
        self.assertEqual(roundtripped["matchId"], "oitavas:tie-1")
        self.assertEqual(roundtripped["resultVersion"], 1)
        self.assertEqual(roundtripped["status"], "sent")


if __name__ == "__main__":
    unittest.main(verbosity=2)
