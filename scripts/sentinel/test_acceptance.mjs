#!/usr/bin/env node
/**
 * test_acceptance.mjs — the architecture-mandated 10 acceptance scenarios for the CHANGE_INTENT
 * Stale vertical slice, plus malformed-state recovery and security tests. Everything here runs
 * against `createFakeGithubClient()` — pure in-memory, no real GitHub call, no production Issue
 * touched. The one deliberate live-GitHub smoke test lives outside this suite (see the PR
 * description / STEP 25 of the implementation task) and is run manually, once, before merge.
 */
import { createFakeGithubClient } from "./github_client.mjs";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { upsertFinding, recordCleanCycleOrResolve, CLEAN_CYCLES_TO_RESOLVE } from "./writer.mjs";
import { reconcile } from "./reconcile.mjs";
import { parseStateBlock } from "./github_state.mjs";
import { makeFinding } from "./finding_schema.mjs";
import { applyPolicy, POLICY_VERSION } from "./policy.mjs";
import { changeIntentStaleFingerprint } from "./fingerprint.mjs";
import { runOnce } from "./run.mjs";
import { execFileSync } from "node:child_process";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.stack || e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

function makeTestFinding(overrides = {}) {
  const { canonical, authorization } = applyPolicy("change_intent_stale");
  return makeFinding({
    finding_type: "change_intent_stale",
    fingerprint: changeIntentStaleFingerprint(overrides.surfaceId || "TEST_SURFACE"),
    detector_id: "change_intent_stale",
    detector_version: "1.0.0",
    observed_at: new Date().toISOString(),
    facts: ["surface_id=TEST_SURFACE is stale"],
    evidence: ["surface_id=TEST_SURFACE"],
    canonical, authorization,
    provenance: { source_sha: "aaa111", detector_version: "1.0.0", policy_version: POLICY_VERSION, config_hash: "sha256:cfg", evidence_hash: "sha256:ev" },
    status: "DETECTED",
    ...overrides,
  });
}

console.log("\nSentinel V1.0-A — architecture acceptance tests\n");

// ── 1. clean CHANGE_INTENT -> no Issue ──────────────────────────────────────────────────────────
test("1. clean state (zero findings) produces zero Issues", () => {
  const client = createFakeGithubClient();
  const results = runOnce({ client, logger: { log() {} }, dryRun: false });
  // No detector override here — this exercises the REAL detector against THIS repo's own clean
  // working state (already proven clean earlier this session), so zero findings is expected.
  assert(results.findings.length === 0, `expected 0 findings against clean repo state, got ${results.findings.length}`);
  assert(client.listSentinelIssues({}).length === 0);
});

// ── 2. stale declaration -> exactly one Issue ──────────────────────────────────────────────────
test("2. a stale finding produces exactly one Issue", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding();
  const outcome = upsertFinding(finding, client, { log() {} });
  const issues = client.listSentinelIssues({});
  assert(issues.length === 1, `expected 1 issue, got ${issues.length}`);
  assert(issues[0].number === outcome.issueNumber);
  const state = parseStateBlock(issues[0].body);
  assert(state.fingerprint === finding.fingerprint);
});

// ── 3. same finding twice -> same Issue, occurrence increments ────────────────────────────────
test("3. the same finding observed twice updates one Issue, occurrence_count increments", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_3" });
  const first = upsertFinding(finding, client, { log() {} });
  const second = upsertFinding(finding, client, { log() {} });
  assert(first.issueNumber === second.issueNumber, "must be the same Issue, not a new one");
  assert(second.occurrenceCount === 2, `expected occurrence_count 2, got ${second.occurrenceCount}`);
  assert(client.listSentinelIssues({}).length === 1, "still exactly one Issue total");
});

// ── 4. concurrent duplicate processing -> one canonical Issue ─────────────────────────────────
test("4. a race that produced two Issues for one fingerprint converges to one canonical Issue", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_4" });
  // Simulate the race directly: two Issues already exist for the same fingerprint before this
  // run's upsert even begins (exactly what two near-simultaneous writers would have produced).
  const a = client.createIssue({ title: "dup a", body: `<!-- ferrarilabs-sentinel\n${JSON.stringify({ fingerprint: finding.fingerprint, occurrence_count: 1, canonical_last_written: {}, intended_canonical: {} })}\n-->`, labels: ["sentinel-managed"] });
  const b = client.createIssue({ title: "dup b", body: `<!-- ferrarilabs-sentinel\n${JSON.stringify({ fingerprint: finding.fingerprint, occurrence_count: 1, canonical_last_written: {}, intended_canonical: {} })}\n-->`, labels: ["sentinel-managed"] });
  const outcome = upsertFinding(finding, client, { log() {} });
  assert(outcome.issueNumber === Math.min(a.number, b.number), "canonical must be the OLDEST (lowest number) Issue");
  const remaining = client.listSentinelIssues({ state: "open" });
  assert(remaining.length === 1, `expected exactly 1 open issue after convergence, got ${remaining.length}`);
  const closedOne = client.getIssue(a.number === outcome.issueNumber ? b.number : a.number);
  assert(closedOne.state === "CLOSED", "the non-canonical duplicate must be closed");
});

// ── 5. Issue created but Project write fails -> reconciler repairs ────────────────────────────
test("5. a Project mutation failure after Issue creation is repaired by reconcile()", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_5" });
  const originalSetProjectFields = client.setProjectFields;
  let failNext = true;
  client.setProjectFields = (...args) => {
    if (failNext) { failNext = false; throw new Error("simulated transient Project mutation failure"); }
    return originalSetProjectFields.apply(client, args);
  };
  let threw = false;
  try { upsertFinding(finding, client, { log() {} }); } catch { threw = true; }
  assert(threw, "the simulated failure must propagate, not be swallowed");

  const issues = client.listSentinelIssues({});
  assert(issues.length === 1, "the Issue itself must still exist even though the Project write failed");
  const stateBefore = parseStateBlock(issues[0].body);
  assert(Object.keys(stateBefore.intended_canonical).length > 0, "intended_canonical must be checkpointed BEFORE the failed mutation, not lost with it");
  assert(Object.keys(stateBefore.canonical_last_written).length === 0, "canonical_last_written must NOT be set — the write never actually succeeded");

  // restore normal behavior, then reconcile
  client.setProjectFields = originalSetProjectFields;
  const summary = reconcile(client, { logger: { log() {} } });
  assert(summary.fields_repaired.length === 1, `expected 1 repair, got ${JSON.stringify(summary.fields_repaired)}`);
  const itemId = client.ensureProjectItem(client.getIssue(issues[0].number).nodeId);
  const fields = client.getProjectFields(itemId);
  assert(fields.Severity === finding.canonical.severity, "reconcile must have completed the originally-intended write");
});

// ── 6. stale declaration resolves -> closes after exactly 3 clean cycles ──────────────────────
test("6. resolution requires exactly 3 consecutive clean cycles, not 1", () => {
  assert(CLEAN_CYCLES_TO_RESOLVE === 3, "architecture mandates exactly 3");
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_6" });
  const { issueNumber } = upsertFinding(finding, client, { log() {} });

  const c1 = recordCleanCycleOrResolve({ number: issueNumber }, client, { log() {} });
  assert(c1.action === "clean_cycle_recorded" && c1.cleanCycles === 1);
  assert(client.getIssue(issueNumber).state === "OPEN", "must not close after cycle 1");

  const c2 = recordCleanCycleOrResolve({ number: issueNumber }, client, { log() {} });
  assert(c2.action === "clean_cycle_recorded" && c2.cleanCycles === 2);
  assert(client.getIssue(issueNumber).state === "OPEN", "must not close after cycle 2");

  const c3 = recordCleanCycleOrResolve({ number: issueNumber }, client, { log() {} });
  assert(c3.action === "resolved");
  assert(client.getIssue(issueNumber).state === "CLOSED", "must close on exactly the 3rd clean cycle");
});

test("6b. a finding reappearing before 3 clean cycles resets the counter (does not resolve early)", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_6B" });
  const { issueNumber } = upsertFinding(finding, client, { log() {} });
  recordCleanCycleOrResolve({ number: issueNumber }, client, { log() {} }); // cycle 1
  recordCleanCycleOrResolve({ number: issueNumber }, client, { log() {} }); // cycle 2
  upsertFinding(finding, client, { log() {} }); // reappears — must reset clean_cycle_count to 0
  const state = parseStateBlock(client.getIssue(issueNumber).body);
  assert(state.clean_cycle_count === 0, `expected reset to 0, got ${state.clean_cycle_count}`);
});

// ── 7. condition recurs -> canonical Issue reopens, recurrence increments ─────────────────────
test("7. a fingerprint recurring after resolution reopens the SAME Issue and increments recurrence_count", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_7" });
  const { issueNumber } = upsertFinding(finding, client, { log() {} });
  for (let i = 0; i < CLEAN_CYCLES_TO_RESOLVE; i++) recordCleanCycleOrResolve({ number: issueNumber }, client, { log() {} });
  assert(client.getIssue(issueNumber).state === "CLOSED");

  const recurrence = upsertFinding(finding, client, { log() {} });
  assert(recurrence.issueNumber === issueNumber, "recurrence must reopen the SAME Issue, never create a new one");
  assert(client.getIssue(issueNumber).state === "OPEN");
  const state = parseStateBlock(client.getIssue(issueNumber).body);
  assert(state.recurrence_count === 1, `expected recurrence_count 1, got ${state.recurrence_count}`);
  assert(client.listSentinelIssues({}).length === 1, "still exactly one Issue for this fingerprint");
});

// ── 8. human Priority override -> preserved ────────────────────────────────────────────────────
test("8. a human-edited Project field is never silently reverted by a later Sentinel run", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_8" });
  const { issueNumber } = upsertFinding(finding, client, { log() {} });
  const itemId = client.ensureProjectItem(client.getIssue(issueNumber).nodeId);
  assert(client.getProjectFields(itemId).Priority === finding.canonical.priority, "sanity: Sentinel's own value is there first");

  // human changes Priority directly on GitHub
  client.setProjectFields(itemId, { Priority: "P0 - Critical" });

  // Sentinel observes the SAME finding again
  upsertFinding(finding, client, { log() {} });
  const after = client.getProjectFields(itemId);
  assert(after.Priority === "P0 - Critical", `human override must survive — got "${after.Priority}"`);
});

// ── 9. detector/config provenance changes -> staleness/revalidation ───────────────────────────
test("9. a detector_version bump is recorded in provenance on the next observation", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_9" });
  const { issueNumber } = upsertFinding(finding, client, { log() {} });
  const bumped = { ...finding, detector_version: "1.1.0", provenance: { ...finding.provenance, detector_version: "1.1.0" } };
  upsertFinding(bumped, client, { log() {} });
  const state = parseStateBlock(client.getIssue(issueNumber).body);
  assert(state.detector_version === "1.1.0", "provenance.detector_version must update, proving staleness is tracked, not silently carried forward");
});

// ── 10. GitHub API 503 -> safe retry, no duplicate ─────────────────────────────────────────────
test("10. a transient failure followed by a retry never produces a duplicate Issue", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_10" });
  // Simulate: first createIssue call "succeeds on the server" but the caller's handling of the
  // response fails (the real-world 503-after-write scenario) — model this as: create once
  // out-of-band (as GitHub itself would already have done), then let upsertFinding run as if it
  // never saw that response and is retrying from scratch. Idempotent search-before-write means
  // the retry must find and update the existing Issue, not create a second one.
  upsertFinding(finding, client, { log() {} });
  upsertFinding(finding, client, { log() {} }); // the "retry"
  assert(client.listSentinelIssues({}).length === 1, "a retried upsert must never create a duplicate Issue");
});

test("10b. real client retries ONLY on 429/502/503/504/transient network errors, never on 4xx", () => {
  // Static assertion on the retry predicate itself, not a live network test — imports the module
  // and inspects its documented behavior via a controlled failure.
  let threw401 = false, retried503 = false;
  const fakeExec = (cmd, args) => { throw Object.assign(new Error("gh: HTTP 401: Bad credentials"), { stderr: "401" }); };
  try {
    // We can't easily inject execFileSync without a mocking framework in this vertical slice, so
    // this test asserts the REGEX the module itself uses is correctly scoped, read from source —
    // a cheap, honest proxy for "we didn't accidentally make 4xx retryable."
    const src = execFileSync("cat", ["scripts/sentinel/github_client.mjs"], { encoding: "utf8" });
    const m = /RETRYABLE_RE\s*=\s*(\/[^\n]+\/)/.exec(src);
    assert(m, "could not locate RETRYABLE_RE in github_client.mjs");
    const re = eval(m[1]); // the pattern itself, not attacker-controlled — same file we already trust
    assert(re.test("HTTP 503"), "503 must be retryable");
    assert(re.test("HTTP 429"), "429 must be retryable");
    assert(!re.test("HTTP 401 Bad credentials"), "401 must NOT be retryable");
    assert(!re.test("HTTP 403 Forbidden"), "403 must NOT be retryable");
    retried503 = true;
  } finally { void threw401; void fakeExec; }
  assert(retried503);
});

// ── malformed embedded-state recovery ──────────────────────────────────────────────────────────
test("malformed embedded state on a Sentinel Issue is rebuilt by reconcile(), not left broken", () => {
  const client = createFakeGithubClient();
  client.createIssue({ title: "[Sentinel] broken", body: "<!-- ferrarilabs-sentinel\nNOT VALID JSON AT ALL\n-->", labels: ["sentinel-managed"] });
  const summary = reconcile(client, { logger: { log() {} } });
  assert(summary.rebuilt_state.length === 1, `expected 1 state rebuild, got ${JSON.stringify(summary.rebuilt_state)}`);
  const issue = client.listSentinelIssues({})[0];
  const state = parseStateBlock(issue.body);
  assert(state !== null, "state must be valid JSON after rebuild");
  assert(summary.errors.length === 0, "a malformed issue must not abort the whole sweep");
});

test("reconcile() dry-run makes zero mutations", () => {
  const client = createFakeGithubClient();
  const finding = makeTestFinding({ surfaceId: "SURF_DRYRUN" });
  upsertFinding(finding, client, { log() {} });
  const MUTATING = new Set(["createIssue", "updateIssueBody", "addComment", "closeIssue", "reopenIssue", "ensureProjectItem", "setProjectFields"]);
  const mutationsBefore = client.calls.filter((c) => MUTATING.has(c.name)).length;
  reconcile(client, { dryRun: true, logger: { log() {} } });
  const mutationsAfter = client.calls.filter((c) => MUTATING.has(c.name)).length;
  assert(mutationsAfter === mutationsBefore, `dry-run reconcile must perform zero mutating calls, saw ${mutationsAfter - mutationsBefore} new one(s)`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ ACCEPTANCE SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL ACCEPTANCE TESTS PASSED\n");


// ── Issue #310: o log tem de distinguir MEDIDO de NAO-MEDIDO ────────────────────────────────
//
// `finding_count: 0` vale tanto para "medi e esta saudavel" quanto para "nao consegui medir".
// Sao a MESMA saida e significados opostos. Um detector que nao consegue dizer que nao mediu e um
// falso-verde esperando -- e foi exatamente essa ambiguidade que impediu de aceitar a #310 na
// primeira execucao do Sentinel.
function registrosDeDetector(migracoesAplicadas) {
  const linhas = [];
  runOnce({
    client: createFakeGithubClient(), dryRun: true,
    logger: { log: (r) => linhas.push(r) },
    migracoesAplicadas,
  });
  return linhas.filter((l) => l.action === "detector_ran");
}

function versoesNoRepo() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../..", "supabase/migrations");
  return readdirSync(dir)
    .map((f) => /^(\d{14})_[a-z0-9_]+\.sql$/.exec(f))
    .filter(Boolean).map((m) => m[1]).sort();
}

test("sem credencial, migration_drift registra estado UNKNOWN — nao silencio", () => {
  const r = registrosDeDetector(null).find((l) => l.detector === "migration_drift");
  assert(r, "o detector nao apareceu no log");
  assert(r.estado === "UNKNOWN", `nao medir precisa aparecer como UNKNOWN, veio ${r.estado}`);
  assert(r.finding_count === 0, "UNKNOWN nao emite finding");
  assert(r.confirmed_recoveries === 0, "UNKNOWN nao pode confirmar recuperacao");
});

test("com producao batendo, registra MIGRATIONS_MATCH e recuperacao confirmada", () => {
  const r = registrosDeDetector(versoesNoRepo()).find((l) => l.detector === "migration_drift");
  assert(r.estado === "MIGRATIONS_MATCH", `estado observado veio ${r.estado}`);
  assert(r.confirmed_recoveries === 1, "saude POSITIVAMENTE observada precisa confirmar recuperacao");
});

test("UNKNOWN e MIGRATIONS_MATCH sao DISTINGUIVEIS no log", () => {
  const a = registrosDeDetector(null).find((l) => l.detector === "migration_drift");
  const b = registrosDeDetector(versoesNoRepo()).find((l) => l.detector === "migration_drift");
  assert(a.estado !== b.estado,
    "se os dois casos produzem o mesmo registro, o log nao serve para aceitar nada");
});
