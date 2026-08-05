"""
test_notification_bridge.py — proves BR2026's send_round_email.py is actually wired to the
shared checkpoint D/F outbox (football-hardening checkpoint F), closing this file's own
previously-documented gap ("a crash between sending and closing the batch could in theory skip a
round's email" — batch-level-only idempotency). Same pattern as
bolao/{cdb2026,copa2026}/scripts/test_notification_bridge.py.

Run: python3 bolao/br2026/scripts/test_notification_bridge.py

NO REAL EMAILS: send_email() is monkeypatched to a synthetic in-memory recorder. No Supabase
writes, no real ESPN calls. Synthetic fixtures only (Participante Alfa/Beta).
"""
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent / "shared" / "scripts"))
import send_round_email as sre  # noqa: E402
import notification_outbox as outbox  # noqa: E402


ENTRIES = [
    {"id": "e1", "participantEmail": "alfa@example.test"},
    {"id": "e2", "participantEmail": "beta@example.test"},
]
RANK_BY_ID = {
    "e1": {"total": 42, "rank": 1},
    "e2": {"total": 30, "rank": 2},
}
PREV_RANK_BY_ID = {}


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

    def _send(self, batch_id="round:g1,g2"):
        return sre._send_round_batch_to_entries(
            ENTRIES, RANK_BY_ID, PREV_RANK_BY_ID,
            "12–18 ago", "12-18ago", "<p>results</p>", "<p>standings</p>", batch_id,
        )

    def test_first_batch_send_goes_through_and_is_recorded_sent(self):
        sent, errors = self._send()
        self.assertEqual(sent, 2)
        self.assertEqual(errors, [])
        jobs = outbox.read_all(self._outbox_path)
        self.assertEqual(len(jobs), 2)
        self.assertTrue(all(j["status"] == "sent" for j in jobs))

    def test_the_documented_incident_a_retry_of_the_same_batch_does_not_resend(self):
        """THE scenario this file's own comment warned about: a crash between sending and
        closing the batch. Simulated here by calling the send function TWICE for the exact same
        batch_id (as a retried/re-run cron job would after a crash) — the second call must not
        re-send to anyone who already got it."""
        self._send()
        self._sent_log.clear()
        sent, errors = self._send()  # retry after "crash"
        self.assertEqual(sent, 0, "a retried batch must resend to ZERO already-notified recipients")
        self.assertEqual(len(self._sent_log), 0)
        self.assertEqual(len(outbox.read_all(self._outbox_path)), 2, "no new job records for the retry")

    def test_a_genuinely_different_batch_sends_independently(self):
        self._send(batch_id="round:g1,g2")
        self._sent_log.clear()
        sent, errors = self._send(batch_id="round:g3,g4")
        self.assertEqual(sent, 2, "a different round/batch must still send normally")
        self.assertEqual(len(outbox.read_all(self._outbox_path)), 4)

    def test_partial_failure_within_a_batch_only_retries_the_failed_recipient(self):
        def failing_send(addr, subject, html):
            if addr == "alfa@example.test":
                raise RuntimeError("simulated EmailJS outage")
            self._sent_log.append((addr, subject))
            return 200
        sre.send_email = failing_send
        sent, errors = self._send()
        self.assertEqual(sent, 1)
        self.assertEqual(len(errors), 1)

        # Recover: source is back, retry the same batch.
        sre.send_email = lambda addr, subject, html: (self._sent_log.append((addr, subject)), 200)[1]
        self._sent_log.clear()
        sent2, errors2 = self._send()
        self.assertEqual(sent2, 1, "only the previously-failed recipient sends on retry")
        self.assertEqual(len(self._sent_log), 1)
        self.assertEqual(self._sent_log[0][0], "alfa@example.test")


if __name__ == "__main__":
    unittest.main(verbosity=2)
