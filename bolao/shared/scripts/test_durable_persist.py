"""
test_durable_persist.py — proves the outbox survives across independent runners with NO shared
memory/workspace (football-hardening section 2 follow-up).

Run: python3 bolao/shared/scripts/test_durable_persist.py

Three REAL, separate `git clone`s of a REAL bare "origin" repo in a temp dir — not three temp
dirs sharing a filesystem, not in-process state. Each "runner" is killed (its Python state
discarded) between steps; the next runner only ever sees what the PREVIOUS one pushed to the
bare repo, exactly like three separate GitHub Actions checkouts of the same remote.

No real emails, no real network beyond local git operations, no Supabase, no ESPN.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import notification_outbox as outbox  # noqa: E402
import durable_persist  # noqa: E402


def run(args, cwd):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{args} failed: {r.stderr}")
    return r


class DurablePersistTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="bolao-durability-")
        self.origin = str(Path(self.tmp) / "origin.git")
        run(["git", "init", "--bare", "-b", "main", self.origin], self.tmp)

        # Seed the bare origin with an initial commit (an empty outbox.json), same as any repo
        # having SOME history before a workflow first runs.
        seed = str(Path(self.tmp) / "seed")
        run(["git", "clone", self.origin, seed], self.tmp)
        (Path(seed) / "outbox.json").write_text("[]\n")
        run(["git", "add", "outbox.json"], seed)
        run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], seed)
        run(["git", "push", "origin", "main"], seed)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fresh_clone(self, name):
        """A brand-new, completely independent clone — simulates a fresh GitHub Actions
        checkout with zero relationship to any previous runner's workspace."""
        d = str(Path(self.tmp) / name)
        run(["git", "clone", self.origin, d], self.tmp)
        run(["git", "config", "user.email", "t@t"], d)
        run(["git", "config", "user.name", "t"], d)
        return d

    def test_three_independent_runners_no_lost_no_duplicate_no_altered_snapshot(self):
        outbox_file_name = "outbox.json"

        # ── Runner A: fresh clone, detects a "final match", creates the event + 2 jobs,
        # persists durably, then terminates completely (nothing carries over in-process). ────
        runner_a_dir = self.fresh_clone("runner-a")
        outbox_path_a = str(Path(runner_a_dir) / outbox_file_name)
        key1 = outbox.idempotency_key("cdb2026", "tie-durability-test", "alfa@example.test", 1)
        key2 = outbox.idempotency_key("cdb2026", "tie-durability-test", "beta@example.test", 1)
        job1, created1 = outbox.enqueue({
            "app": "cdb2026", "matchId": "tie-durability-test", "recipient": "alfa@example.test",
            "resultVersion": 1, "payloadSnapshot": {"homeScore": 2, "awayScore": 1},
            "idempotencyKey": key1,
        }, path=outbox_path_a)
        job2, created2 = outbox.enqueue({
            "app": "cdb2026", "matchId": "tie-durability-test", "recipient": "beta@example.test",
            "resultVersion": 1, "payloadSnapshot": {"homeScore": 2, "awayScore": 1},
            "idempotencyKey": key2,
        }, path=outbox_path_a)
        self.assertTrue(created1 and created2)
        sync_a = durable_persist.sync_state(runner_a_dir, [outbox_file_name], "runner-a: enqueue 2 jobs", remote="origin", branch="main")
        self.assertTrue(sync_a["ok"] and sync_a["pushed"], sync_a)
        # Runner A's workspace is now discarded — the test never reads runner_a_dir again below,
        # simulating the process/VM being torn down.

        # ── Runner B: FRESH clone (zero relation to runner-a's directory), must recover the
        # SAME events/jobs from durable persistence ALONE — not from any in-memory state. ─────
        runner_b_dir = self.fresh_clone("runner-b")
        outbox_path_b = str(Path(runner_b_dir) / outbox_file_name)
        jobs_seen_by_b = outbox.read_all(outbox_path_b)
        self.assertEqual(len(jobs_seen_by_b), 2, "runner B must see BOTH jobs runner A created, from git alone")
        recovered_keys = {j["idempotencyKey"] for j in jobs_seen_by_b}
        self.assertEqual(recovered_keys, {key1, key2})

        # Runner B processes them (simulated send — no real email) and records results.
        sent_log = []
        for j in jobs_seen_by_b:
            sent_log.append(j["recipient"])
            outbox.record_result(j["jobId"], True, path=outbox_path_b)
        self.assertEqual(sorted(sent_log), ["alfa@example.test", "beta@example.test"])
        sync_b = durable_persist.sync_state(runner_b_dir, [outbox_file_name], "runner-b: process 2 jobs", remote="origin", branch="main")
        self.assertTrue(sync_b["ok"] and sync_b["pushed"], sync_b)

        # ── Runner C: another FRESH clone, runs again — must send ZERO duplicate emails. ─────
        runner_c_dir = self.fresh_clone("runner-c")
        outbox_path_c = str(Path(runner_c_dir) / outbox_file_name)
        jobs_seen_by_c = outbox.read_all(outbox_path_c)
        self.assertEqual(len(jobs_seen_by_c), 2, "runner C must see the SAME 2 jobs, not lose or gain any")
        already_sent = [j for j in jobs_seen_by_c if j["status"] == "sent"]
        self.assertEqual(len(already_sent), 2, "runner C must see both jobs already marked 'sent' by runner B")

        # Runner C attempts to enqueue the SAME event again (simulating the workflow's next
        # scheduled tick re-detecting the same final match) — must be idempotent, zero new sends.
        dup_job1, dup_created1 = outbox.enqueue({
            "app": "cdb2026", "matchId": "tie-durability-test", "recipient": "alfa@example.test",
            "resultVersion": 1, "payloadSnapshot": {"homeScore": 2, "awayScore": 1},
            "idempotencyKey": key1,
        }, path=outbox_path_c)
        self.assertFalse(dup_created1, "runner C's re-enqueue of the SAME idempotency key must NOT create a new job")
        self.assertEqual(dup_job1["status"], "sent", "runner C sees the job is already sent — must not resend")

        final_jobs = outbox.read_all(outbox_path_c)
        self.assertEqual(len(final_jobs), 2, "MANDATORY: total job count stays 2 — no lost jobs, no duplicated jobs")

        # Snapshot integrity: payloadSnapshot must be byte-identical to what runner A originally
        # enqueued — never altered by any runner along the way.
        for j in final_jobs:
            self.assertEqual(j["payloadSnapshot"], {"homeScore": 2, "awayScore": 1}, "MANDATORY: snapshot must never be altered across runners")

        # Dependency-on-previous-workspace check: runner C's directory has ZERO filesystem
        # overlap with runner A's or runner B's (different tempdir subpaths, independent git
        # clones) — the ONLY channel of information was the bare origin repo, proven by the
        # fact this test never copies files between runner dirs, only clones from `self.origin`.
        self.assertNotEqual(runner_a_dir, runner_b_dir)
        self.assertNotEqual(runner_b_dir, runner_c_dir)

    def test_concurrent_push_conflict_neither_runner_loses_its_job(self):
        """Two runners clone at the SAME tip, both enqueue a DIFFERENT job, both try to push —
        one wins immediately, the other must rebase-and-retry rather than silently drop its
        commit. Proves the retry path in sync_state() (not just the happy no-conflict path
        exercised above)."""
        outbox_file_name = "outbox.json"
        dir1 = self.fresh_clone("runner-x")
        dir2 = self.fresh_clone("runner-y")  # cloned at the same tip as runner-x

        path1 = str(Path(dir1) / outbox_file_name)
        path2 = str(Path(dir2) / outbox_file_name)
        keyX = outbox.idempotency_key("cdb2026", "tie-concurrent", "x@example.test", 1)
        keyY = outbox.idempotency_key("cdb2026", "tie-concurrent", "y@example.test", 1)
        outbox.enqueue({"app": "cdb2026", "matchId": "tie-concurrent", "recipient": "x@example.test", "resultVersion": 1, "payloadSnapshot": {"v": "x"}, "idempotencyKey": keyX}, path=path1)
        outbox.enqueue({"app": "cdb2026", "matchId": "tie-concurrent", "recipient": "y@example.test", "resultVersion": 1, "payloadSnapshot": {"v": "y"}, "idempotencyKey": keyY}, path=path2)

        # Runner X pushes first (wins immediately).
        result_x = durable_persist.sync_state(dir1, [outbox_file_name], "runner-x: enqueue", remote="origin", branch="main")
        self.assertTrue(result_x["ok"] and result_x["pushed"])
        # Runner Y pushes second — its clone is now BEHIND, must rebase-and-retry, not lose its job.
        result_y = durable_persist.sync_state(dir2, [outbox_file_name], "runner-y: enqueue", remote="origin", branch="main")
        self.assertTrue(result_y["ok"] and result_y["pushed"], result_y)
        self.assertGreater(result_y["attempts"], 1, "runner Y should have needed at least one retry — proves the conflict path actually ran, not just the happy path")

        # A third, fresh clone must see BOTH jobs — neither runner's commit was lost.
        dir3 = self.fresh_clone("runner-z")
        jobs = outbox.read_all(str(Path(dir3) / outbox_file_name))
        self.assertEqual(len(jobs), 2, "MANDATORY: both concurrent runners' jobs survive, none lost")
        self.assertEqual({j["idempotencyKey"] for j in jobs}, {keyX, keyY})


if __name__ == "__main__":
    unittest.main(verbosity=2)
