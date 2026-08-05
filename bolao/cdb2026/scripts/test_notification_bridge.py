"""
test_notification_bridge.py — proves CDB2026's send_result_email.py is actually wired to the
shared checkpoint D/F outbox (football-hardening checkpoint F), not just co-existing with it.

Run: python3 bolao/cdb2026/scripts/test_notification_bridge.py

NO REAL EMAILS: send_email() is monkeypatched to a synthetic in-memory recorder for every check
below — this test never calls the real EmailJS endpoint. NO Supabase writes, no real result
locking. Synthetic fixtures only (Time Alfa / Time Beta participants).
"""
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent / "shared" / "scripts"))
import send_result_email as sre  # noqa: E402
import notification_outbox as outbox  # noqa: E402


SYNTHETIC_STATE = {
    "entries": [
        {"id": "e1", "participantEmail": "alfa@example.test"},
        {"id": "e2", "participantEmail": "beta@example.test"},
    ],
    "deletedIds": [],
}


class NotificationBridgeTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._outbox_path = str(Path(self._tmpdir.name) / "notification_outbox.json")
        # Route the module's default outbox path to our isolated temp file for the duration of
        # each test, so tests never share state and never touch the real repo's outbox file.
        self._orig_default_path = outbox.default_outbox_path
        outbox.default_outbox_path = lambda: self._outbox_path

        self._sent_log = []
        def fake_send_email(addr, subject, html):
            self._sent_log.append((addr, subject))
            return 200
        self._orig_send_email = sre.send_email
        sre.send_email = fake_send_email
        # Section 5 review: production's real time.sleep(3) per-recipient throttle in
        # sre._send_to_all() made these tests take 18-45s each for no real reason -- a
        # test must never depend on real wall-clock sleep. Production code keeps its
        # real throttle untouched; only the TEST's view of time.sleep is a no-op.
        self._orig_sleep = sre.time.sleep
        sre.time.sleep = lambda *_a, **_k: None

    def tearDown(self):
        outbox.default_outbox_path = self._orig_default_path
        sre.send_email = self._orig_send_email
        sre.time.sleep = self._orig_sleep
        self._tmpdir.cleanup()

    def test_first_send_goes_through_and_is_recorded_sent(self):
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial", match_id="oitavas:tie-1:first")
        self.assertEqual(sent, 2)
        self.assertEqual(errors, [])
        self.assertEqual(len(self._sent_log), 2)
        jobs = outbox.read_all(self._outbox_path)
        self.assertEqual(len(jobs), 2)
        self.assertTrue(all(j["status"] == "sent" for j in jobs))

    def test_duplicate_call_same_match_id_is_skipped_not_resent(self):
        sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial", match_id="oitavas:tie-1:first")
        self._sent_log.clear()
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial", match_id="oitavas:tie-1:first")
        self.assertEqual(sent, 0, "a duplicate run must send ZERO new emails")
        self.assertEqual(len(self._sent_log), 0, "send_email() must not be called again for an already-sent idempotency key")
        jobs = outbox.read_all(self._outbox_path)
        self.assertEqual(len(jobs), 2, "no new job records created for the duplicate run")

    def test_different_match_id_sends_independently(self):
        sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial — Ida", match_id="oitavas:tie-1:first")
        self._sent_log.clear()
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial — Volta", match_id="oitavas:tie-1:second")
        self.assertEqual(sent, 2, "a genuinely different match/leg must still send normally")
        self.assertEqual(len(self._sent_log), 2)
        jobs = outbox.read_all(self._outbox_path)
        self.assertEqual(len(jobs), 4, "2 jobs for the first leg + 2 for the second leg, no cross-contamination")

    def test_different_result_version_sends_independently_a_correction_is_not_a_duplicate(self):
        sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "v1", match_id="final:tie-1:single", result_version=1)
        self._sent_log.clear()
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html corrected</p>", "v2 (correction)", match_id="final:tie-1:single", result_version=2)
        self.assertEqual(sent, 2, "a correction (new result_version) must send, not be treated as a duplicate of v1")
        self.assertEqual(len(self._sent_log), 2)

    def test_no_match_id_preserves_old_behavior_zero_outbox_involvement(self):
        # Backward compatibility: a caller that doesn't pass match_id (none exist in this repo
        # after this patch, but the parameter is optional/defaulted, and a future caller might
        # omit it) gets exactly the pre-checkpoint-F behavior — every recipient always sent, no
        # outbox file touched, no job recorded.
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "no match_id")
        self.assertEqual(sent, 2)
        self.assertEqual(outbox.read_all(self._outbox_path), [])

    def test_send_failure_is_recorded_failed_not_silently_swallowed(self):
        def failing_send(addr, subject, html):
            if addr == "alfa@example.test":
                raise RuntimeError("simulated EmailJS outage")
            self._sent_log.append((addr, subject))
            return 200
        sre.send_email = failing_send
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial", match_id="oitavas:tie-2:first")
        self.assertEqual(sent, 1)
        self.assertEqual(len(errors), 1)
        jobs = outbox.read_all(self._outbox_path)
        statuses = {j["recipient"]: j["status"] for j in jobs}
        self.assertEqual(statuses["alfa@example.test"], "failed")
        self.assertEqual(statuses["beta@example.test"], "sent")


if __name__ == "__main__":
    unittest.main(verbosity=2)
