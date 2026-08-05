"""
test_notification_bridge.py — proves Copa2026's send_result_email.py is actually wired to the
shared checkpoint D/F outbox (football-hardening checkpoint F), same pattern as
bolao/cdb2026/scripts/test_notification_bridge.py.

Run: python3 bolao/copa2026/scripts/test_notification_bridge.py

NO REAL EMAILS: send_email() is monkeypatched to a synthetic in-memory recorder for every check
below. NO Supabase writes, no real result locking. Synthetic fixtures only.
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
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial", match_id="M95")
        self.assertEqual(sent, 2)
        self.assertEqual(errors, [])
        jobs = outbox.read_all(self._outbox_path)
        self.assertEqual(len(jobs), 2)
        self.assertTrue(all(j["status"] == "sent" for j in jobs))

    def test_duplicate_call_same_match_id_is_skipped_not_resent(self):
        sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial", match_id="M95")
        self._sent_log.clear()
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "Resultado Parcial", match_id="M95")
        self.assertEqual(sent, 0, "a duplicate run must send ZERO new emails")
        self.assertEqual(len(self._sent_log), 0)
        self.assertEqual(len(outbox.read_all(self._outbox_path)), 2, "no new job records for the duplicate run")

    def test_no_match_id_preserves_old_behavior_zero_outbox_involvement(self):
        sent, errors = sre._send_to_all(SYNTHETIC_STATE, "<p>html</p>", "no match_id")
        self.assertEqual(sent, 2)
        self.assertEqual(outbox.read_all(self._outbox_path), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
