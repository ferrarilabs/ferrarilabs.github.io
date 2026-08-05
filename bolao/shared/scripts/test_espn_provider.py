"""
test_espn_provider.py — unit tests for the shared ESPN provider (checkpoints C/C2/D).

Run: python3 bolao/shared/scripts/test_espn_provider.py

All tests use synthetic fixtures (Time Alfa / Time Beta) and injected fake fetchers — NO real
network calls, no real ESPN data, matching this task's hard constraint of fully deterministic,
synthetic test data.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import espn_provider as ep  # noqa: E402


def fake_opener_ok(payload_json: str):
    def _opener(url, timeout_s):
        return payload_json.encode("utf-8")
    return _opener


def fake_opener_fails(n_times: int, then_json: str = None):
    calls = {"n": 0}
    def _opener(url, timeout_s):
        calls["n"] += 1
        if calls["n"] <= n_times:
            raise ep.FetchError("simulated timeout")
        return (then_json or "{}").encode("utf-8")
    return _opener


def fake_opener_always_timeout():
    def _opener(url, timeout_s):
        raise TimeoutError("simulated timeout: no response within deadline")
    return _opener


SCOREBOARD_FIXTURE = """
{
  "events": [
    {
      "id": "1",
      "date": "2026-08-12T23:30Z",
      "competitions": [{
        "status": {"type": {"state": "post"}},
        "venue": {"fullName": "Estadio Exemplo"},
        "competitors": [
          {"homeAway": "home", "score": "2", "team": {"displayName": "Time Alfa"}},
          {"homeAway": "away", "score": "1", "team": {"displayName": "Time Beta"}}
        ]
      }]
    }
  ]
}
"""

STANDINGS_FIXTURE = """
{
  "children": [{
    "standings": {
      "entries": [
        {"team": {"displayName": "Time Alfa", "abbreviation": "ALF"},
         "stats": [{"name": "points", "value": 30}, {"name": "gamesPlayed", "value": 15}]},
        {"team": {"displayName": "Time Beta", "abbreviation": "BET"},
         "stats": [{"name": "points", "value": 28}, {"name": "gamesPlayed", "value": 15}]}
      ]
    }
  }]
}
"""

MALFORMED_FIXTURE = '{"unexpected": "shape"}'


class FetchJsonTests(unittest.TestCase):
    def test_success_first_try(self):
        r = ep.fetch_json("https://fake/scoreboard", opener=fake_opener_ok(SCOREBOARD_FIXTURE))
        self.assertTrue(r.ok)
        self.assertEqual(r.attempts, 1)
        self.assertIsNotNone(r.fetchedAt)

    def test_retries_then_succeeds(self):
        r = ep.fetch_json(
            "https://fake/scoreboard", retries=3, backoff_s=0,
            opener=fake_opener_fails(2, SCOREBOARD_FIXTURE),
        )
        self.assertTrue(r.ok)
        self.assertEqual(r.attempts, 3)

    def test_exhausts_retries_and_fails(self):
        r = ep.fetch_json(
            "https://fake/scoreboard", retries=2, backoff_s=0,
            opener=fake_opener_fails(99),
        )
        self.assertFalse(r.ok)
        self.assertIsNotNone(r.error)

    def test_timeout_is_treated_as_a_retryable_failure(self):
        r = ep.fetch_json(
            "https://fake/scoreboard", retries=3, backoff_s=0,
            opener=fake_opener_always_timeout(),
        )
        self.assertFalse(r.ok)
        self.assertIn("timeout", r.error.lower())
        self.assertEqual(r.attempts, 3)  # proves it actually retried 3 times, not gave up early


class ValidationTests(unittest.TestCase):
    def test_scoreboard_shape_valid(self):
        import json
        self.assertEqual(ep.validate_scoreboard_shape(json.loads(SCOREBOARD_FIXTURE)), [])

    def test_scoreboard_shape_rejects_malformed(self):
        import json
        problems = ep.validate_scoreboard_shape(json.loads(MALFORMED_FIXTURE))
        self.assertTrue(len(problems) > 0)

    def test_standings_shape_valid(self):
        import json
        self.assertEqual(ep.validate_standings_shape(json.loads(STANDINGS_FIXTURE)), [])

    def test_standings_shape_rejects_malformed(self):
        import json
        problems = ep.validate_standings_shape(json.loads(MALFORMED_FIXTURE))
        self.assertTrue(len(problems) > 0)


class NormalizationTests(unittest.TestCase):
    def test_normalize_scoreboard(self):
        import json
        out = ep.normalize_scoreboard(json.loads(SCOREBOARD_FIXTURE), aliases={})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["homeTeam"], "Time Alfa")
        self.assertEqual(out[0]["awayTeam"], "Time Beta")
        self.assertEqual(out[0]["homeScore"], 2)
        self.assertEqual(out[0]["awayScore"], 1)

    def test_normalize_applies_alias(self):
        import json
        aliased = SCOREBOARD_FIXTURE.replace("Time Alfa", "Alfa FC (alias source name)")
        out = ep.normalize_scoreboard(json.loads(aliased), aliases={"Alfa FC (alias source name)": "Time Alfa"})
        self.assertEqual(out[0]["homeTeam"], "Time Alfa")

    def test_normalize_standings(self):
        import json
        out = ep.normalize_standings(json.loads(STANDINGS_FIXTURE), aliases={})
        self.assertEqual(out[0]["name"], "Time Alfa")
        self.assertEqual(out[0]["points"], 30)


class SnapshotTests(unittest.TestCase):
    def test_fresh_success_writes_non_stale_snapshot(self):
        fr = ep.fetch_json("https://fake", opener=fake_opener_ok(SCOREBOARD_FIXTURE))
        snap, outcome = ep.build_snapshot(kind="scoreboard", competition_id="test.comp", provider="espn", fetch_result=fr, aliases={}, previous=None)
        self.assertTrue(outcome.wrote)
        self.assertFalse(snap["stale"])
        self.assertIsNotNone(snap["generatedAt"])
        self.assertIsNotNone(snap["sourceUpdatedAt"])
        self.assertEqual(len(snap["matches"]), 1)
        self.assertIsNotNone(snap["payloadHash"])
        self.assertEqual(snap["competitionId"], "test.comp")
        self.assertEqual(snap["provider"], "espn")

    def test_fetch_failure_with_no_previous_marks_stale_no_data(self):
        fr = ep.FetchResult(ok=False, error="simulated network failure", attempts=3, fetchedAt=ep.now_iso())
        snap, outcome = ep.build_snapshot(kind="scoreboard", competition_id="test.comp", provider="espn", fetch_result=fr, aliases={}, previous=None)
        self.assertFalse(outcome.wrote)
        self.assertTrue(snap["stale"])
        self.assertEqual(snap["matches"], [])

    def test_fetch_failure_with_previous_preserves_last_known_good_and_marks_stale(self):
        previous = {
            "schemaVersion": 1, "competitionId": "test.comp", "provider": "espn",
            "generatedAt": "2026-08-01T00:00:00Z", "sourceUpdatedAt": "2026-08-01T00:00:00Z",
            "stale": False, "staleReason": None, "payloadHash": "abc123",
            "matches": [{"homeTeam": "Time Alfa", "awayTeam": "Time Beta", "homeScore": 2, "awayScore": 1}],
        }
        fr = ep.FetchResult(ok=False, error="simulated network failure", attempts=3, fetchedAt=ep.now_iso())
        snap, outcome = ep.build_snapshot(kind="scoreboard", competition_id="test.comp", provider="espn", fetch_result=fr, aliases={}, previous=previous)
        self.assertFalse(outcome.wrote)
        self.assertTrue(snap["stale"])
        self.assertIsNotNone(snap["staleReason"])
        # Last-known-good MATCHES + payloadHash are preserved unchanged.
        self.assertEqual(snap["matches"], previous["matches"])
        self.assertEqual(snap["payloadHash"], previous["payloadHash"])

    def test_malformed_payload_with_previous_preserves_last_known_good(self):
        previous = {
            "schemaVersion": 1, "competitionId": "test.comp", "provider": "espn",
            "generatedAt": "2026-08-01T00:00:00Z", "sourceUpdatedAt": "2026-08-01T00:00:00Z",
            "stale": False, "staleReason": None, "payloadHash": "abc123",
            "matches": [{"homeTeam": "Time Alfa", "awayTeam": "Time Beta", "homeScore": 2, "awayScore": 1}],
        }
        fr = ep.fetch_json("https://fake", opener=fake_opener_ok(MALFORMED_FIXTURE))
        snap, outcome = ep.build_snapshot(kind="scoreboard", competition_id="test.comp", provider="espn", fetch_result=fr, aliases={}, previous=previous)
        self.assertFalse(outcome.wrote)
        self.assertTrue(snap["stale"])
        self.assertEqual(snap["matches"], previous["matches"])

    def test_payload_hash_stable_and_changes_with_content(self):
        import json
        m1 = ep.normalize_scoreboard(json.loads(SCOREBOARD_FIXTURE), aliases={})
        h1a = ep.payload_hash(m1)
        h1b = ep.payload_hash(m1)
        self.assertEqual(h1a, h1b)  # stable across repeated calls
        changed = SCOREBOARD_FIXTURE.replace('"score": "2"', '"score": "3"')
        m2 = ep.normalize_scoreboard(json.loads(changed), aliases={})
        self.assertNotEqual(h1a, ep.payload_hash(m2))  # changes when content changes


class SchemaCompatibilityTests(unittest.TestCase):
    def test_no_previous_is_compatible(self):
        self.assertTrue(ep.is_schema_compatible(None))

    def test_matching_schema_version_is_compatible(self):
        self.assertTrue(ep.is_schema_compatible({"schemaVersion": ep.SCHEMA_VERSION}))

    def test_future_schema_version_is_incompatible(self):
        self.assertFalse(ep.is_schema_compatible({"schemaVersion": ep.SCHEMA_VERSION + 1}))

    def test_missing_schema_version_key_is_incompatible(self):
        self.assertFalse(ep.is_schema_compatible({"matches": []}))


class AtomicWriteTests(unittest.TestCase):
    def test_write_then_read_roundtrip(self):
        import tempfile, os
        fr = ep.fetch_json("https://fake", opener=fake_opener_ok(SCOREBOARD_FIXTURE))
        snap, _ = ep.build_snapshot(kind="scoreboard", competition_id="test.comp", provider="espn", fetch_result=fr, aliases={}, previous=None)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "espn-normalized.json")
            ep.write_snapshot_atomic(path, snap)
            back = ep.read_snapshot(path)
            self.assertEqual(back, snap)

    def test_read_snapshot_missing_file_returns_none(self):
        self.assertIsNone(ep.read_snapshot("/nonexistent/path/does-not-exist.json"))

    def test_atomic_write_leaves_no_temp_file_behind_on_success(self):
        import tempfile, os
        fr = ep.fetch_json("https://fake", opener=fake_opener_ok(SCOREBOARD_FIXTURE))
        snap, _ = ep.build_snapshot(kind="scoreboard", competition_id="test.comp", provider="espn", fetch_result=fr, aliases={}, previous=None)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "espn-normalized.json")
            ep.write_snapshot_atomic(path, snap)
            leftover = [f for f in os.listdir(d) if f.startswith(".espn-snapshot-")]
            self.assertEqual(leftover, [])

    def test_atomic_write_never_overwrites_valid_file_with_invalid_payload(self):
        """The exact requirement: a write missing required keys must be rejected BEFORE the
        destination file is ever touched — proven here by writing a good snapshot first, then
        attempting (and expecting to fail) an invalid write, then confirming the original good
        file on disk is completely untouched (byte-identical)."""
        import tempfile, os
        fr = ep.fetch_json("https://fake", opener=fake_opener_ok(SCOREBOARD_FIXTURE))
        good_snap, _ = ep.build_snapshot(kind="scoreboard", competition_id="test.comp", provider="espn", fetch_result=fr, aliases={}, previous=None)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "espn-normalized.json")
            ep.write_snapshot_atomic(path, good_snap)
            with open(path, "rb") as f:
                before_bytes = f.read()

            broken_snap = {"matches": []}  # missing every other required key
            with self.assertRaises(ep.ValidationError):
                ep.write_snapshot_atomic(path, broken_snap)

            with open(path, "rb") as f:
                after_bytes = f.read()
            self.assertEqual(before_bytes, after_bytes)

    def test_atomic_write_rejects_snapshot_missing_required_keys_before_any_disk_write(self):
        import tempfile, os
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "espn-normalized.json")
            with self.assertRaises(ep.ValidationError):
                ep.write_snapshot_atomic(path, {"matches": []})
            self.assertFalse(os.path.exists(path))  # destination never created at all


if __name__ == "__main__":
    unittest.main(verbosity=2)
