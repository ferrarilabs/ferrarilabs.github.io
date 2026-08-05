"""
test_espn_provider.py — unit tests for the shared ESPN provider (checkpoint C/D).

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
        import json
        fr = ep.fetch_json("https://fake", opener=fake_opener_ok(SCOREBOARD_FIXTURE))
        snap, outcome = ep.build_snapshot(kind="scoreboard", source_url="https://fake", fetch_result=fr, aliases={}, previous=None)
        self.assertTrue(outcome.wrote)
        self.assertFalse(snap["stale"])
        self.assertIsNotNone(snap["generatedAt"])
        self.assertIsNotNone(snap["sourceFetchedAt"])
        self.assertEqual(len(snap["data"]), 1)

    def test_fetch_failure_with_no_previous_marks_stale_no_data(self):
        fr = ep.FetchResult(ok=False, error="simulated network failure", attempts=3, fetchedAt=ep.now_iso())
        snap, outcome = ep.build_snapshot(kind="scoreboard", source_url="https://fake", fetch_result=fr, aliases={}, previous=None)
        self.assertFalse(outcome.wrote)
        self.assertTrue(snap["stale"])
        self.assertIsNone(snap["data"])

    def test_fetch_failure_with_previous_preserves_last_known_good_and_marks_stale(self):
        previous = {
            "schemaVersion": 1, "kind": "scoreboard", "sourceUrl": "https://fake",
            "generatedAt": "2026-08-01T00:00:00Z", "sourceFetchedAt": "2026-08-01T00:00:00Z",
            "stale": False, "staleSince": None, "staleReason": None,
            "data": [{"homeTeam": "Time Alfa", "awayTeam": "Time Beta", "homeScore": 2, "awayScore": 1}],
        }
        fr = ep.FetchResult(ok=False, error="simulated network failure", attempts=3, fetchedAt=ep.now_iso())
        snap, outcome = ep.build_snapshot(kind="scoreboard", source_url="https://fake", fetch_result=fr, aliases={}, previous=previous)
        self.assertFalse(outcome.wrote)
        self.assertTrue(snap["stale"])
        # Last-known-good DATA is preserved unchanged, only staleness metadata added.
        self.assertEqual(snap["data"], previous["data"])
        self.assertIsNotNone(snap["staleSince"])

    def test_malformed_payload_with_previous_preserves_last_known_good(self):
        previous = {
            "schemaVersion": 1, "kind": "scoreboard", "sourceUrl": "https://fake",
            "generatedAt": "2026-08-01T00:00:00Z", "sourceFetchedAt": "2026-08-01T00:00:00Z",
            "stale": False, "staleSince": None, "staleReason": None,
            "data": [{"homeTeam": "Time Alfa", "awayTeam": "Time Beta", "homeScore": 2, "awayScore": 1}],
        }
        fr = ep.fetch_json("https://fake", opener=fake_opener_ok(MALFORMED_FIXTURE))
        snap, outcome = ep.build_snapshot(kind="scoreboard", source_url="https://fake", fetch_result=fr, aliases={}, previous=previous)
        self.assertFalse(outcome.wrote)
        self.assertTrue(snap["stale"])
        self.assertEqual(snap["data"], previous["data"])

    def test_write_then_read_roundtrip(self):
        import tempfile, os
        fr = ep.fetch_json("https://fake", opener=fake_opener_ok(SCOREBOARD_FIXTURE))
        snap, _ = ep.build_snapshot(kind="scoreboard", source_url="https://fake", fetch_result=fr, aliases={}, previous=None)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "espn-normalized.json")
            ep.write_snapshot(path, snap)
            back = ep.read_snapshot(path)
            self.assertEqual(back, snap)

    def test_read_snapshot_missing_file_returns_none(self):
        self.assertIsNone(ep.read_snapshot("/nonexistent/path/does-not-exist.json"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
