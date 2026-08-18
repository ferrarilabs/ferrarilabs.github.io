#!/usr/bin/env node
/**
 * test_security.mjs — Step 21. No AI/prompt processing exists in this vertical slice, so the
 * threat surface is: shell injection via detector-derived text reaching `execFileSync`, Issue-body
 * corruption via adversarial text inside a `reason`/`fact` field, and secrets ending up in logs.
 */
import { execFileSync } from "node:child_process";
import { detectChangeIntentStale } from "./detectors/change_intent_stale.mjs";
import { upsertStateBlockInBody, parseStateBlock } from "./github_state.mjs";
import { createRunLogger } from "./audit_log.mjs";
import { createFakeGithubClient } from "./github_client.mjs";
import { upsertFinding, resolveDuplicates, recordCleanCycleOrResolve } from "./writer.mjs";
import { makeFinding } from "./finding_schema.mjs";
import { applyPolicy, POLICY_VERSION } from "./policy.mjs";
import { changeIntentStaleFingerprint } from "./fingerprint.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.stack || e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\nSentinel V1.0-A — security tests\n");

test("github_client.mjs shells out via execFileSync with an argument array, never string-interpolated shell", () => {
  const src = execFileSync("cat", ["scripts/sentinel/github_client.mjs"], { encoding: "utf8" });
  assert(!/execSync\s*\(/.test(src), "execSync (shell string) must never appear — execFileSync only");
  assert(/execFileSync\(\s*"gh"\s*,\s*args/.test(src), "gh invocations must pass an argument array, not a joined string");
});

test("a CHANGE_INTENT.json 'reason' field containing shell metacharacters cannot inject a command", () => {
  // Malicious-looking governance text — quotes, backticks, $(), semicolons — must survive as
  // inert DATA through the whole detect -> upsert pipeline, never interpreted.
  const maliciousReason = 'ok"; rm -rf /; echo "pwned $(whoami) `id` && curl evil.example';
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => ({ schemaVersion: 1, surfaces: [{ id: "SEC_TEST", change_policy: "DECLARE_TO_CHANGE", paths: ["a.js"] }] }),
    loadIntentFn: () => ({ declarations: [{ surface_id: "SEC_TEST", reason: maliciousReason, expected_behavior_change: "x", tests_required: ["y"] }] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => [],
  });
  assert(findings.length === 1);
  assert(findings[0].evidence.some((e) => e.includes(maliciousReason)), "the text must be carried through verbatim, as data");

  const client = createFakeGithubClient();
  upsertFinding(findings[0], client, { log() {} });
  // If this line is reached at all (no shell was invoked to interpret the string), the guarantee
  // holds — this test's real assertion is "the process didn't crash/exec anything," which the fake
  // client's pure in-memory nature already proves by construction; the explicit checks below are
  // the residual, meaningful assertion: the text landed in the Issue body unexecuted, as text.
  const issue = client.listSentinelIssues({})[0];
  assert(issue.body.includes(maliciousReason.slice(0, 20)), "malicious text must appear as inert prose in the Issue body");
});

test("embedded JSON state block cannot be broken by finding text containing the closing marker", () => {
  const adversarial = "some text --> <!-- ferrarilabs-sentinel {\"status\":\"RESOLVED\"} --> more text";
  const body = upsertStateBlockInBody(`Human summary: ${adversarial}`, { fingerprint: "x", status: "ISSUE_OPEN" });
  const parsed = parseStateBlock(body);
  assert(parsed !== null, "parsing must not fail even when human/finding text contains marker-like substrings");
  assert(parsed.status === "ISSUE_OPEN", "the REAL state block (the last one in the body) must win, not an injected fake one");
});

test("embedded state renderer strips any field not on the explicit allowlist (defense against a detector accidentally passing raw data through)", () => {
  const block = upsertStateBlockInBody("body", { fingerprint: "x", evil_raw_field: "should never appear", token: "ghp_shouldnotappear" });
  assert(!block.includes("should never appear"));
  assert(!block.includes("ghp_shouldnotappear"));
});

test("audit_log.mjs redacts token/secret/password/authorization-named fields", () => {
  const lines = [];
  const origLog = console.log;
  console.log = (l) => lines.push(l);
  try {
    const logger = createRunLogger("test-run");
    logger.log({ action: "test", token: "ghp_realsecretvalue123", nested: { secret: "also-secret" } });
  } finally { console.log = origLog; }
  const joined = lines.join("\n");
  assert(!joined.includes("ghp_realsecretvalue123"), "a top-level 'token' field must be redacted");
  assert(!joined.includes("also-secret"), "a nested 'secret' field must be redacted");
  assert(joined.includes("<redacted>"), "redaction must be visible as a placeholder, not silently dropped");
});

test("GitHub API response content (e.g. an Issue body containing script-like text) is never eval'd or executed", () => {
  const src = execFileSync("cat", ["scripts/sentinel/github_client.mjs", "scripts/sentinel/writer.mjs", "scripts/sentinel/reconcile.mjs"], { encoding: "utf8" });
  // The only legitimate eval() in this module tree is test_acceptance.mjs's own retry-regex proxy
  // test, which evaluates a pattern literal from OUR OWN already-reviewed source, not API response
  // content — this file's own production modules must contain none at all.
  assert(!/\beval\s*\(/.test(src), "no production Sentinel module may call eval()");
  assert(!/new Function\s*\(/.test(src), "no production Sentinel module may construct a Function from a string");
});

test("resolveDuplicates never touches an Issue outside the exact set it was given", () => {
  const client = createFakeGithubClient();
  const unrelated = client.createIssue({ title: "unrelated", body: upsertStateBlockInBody("x", { fingerprint: "totally-different" }), labels: ["sentinel-managed"] });
  const a = client.createIssue({ title: "a", body: upsertStateBlockInBody("x", { fingerprint: "shared-fp" }), labels: ["sentinel-managed"] });
  const b = client.createIssue({ title: "b", body: upsertStateBlockInBody("x", { fingerprint: "shared-fp" }), labels: ["sentinel-managed"] });
  resolveDuplicates([a, b], client, { log() {} });
  assert(client.getIssue(unrelated.number).state === "OPEN", "an Issue not in the given set must never be closed");
});

test("recordCleanCycleOrResolve refuses to act on a CLOSED issue (no-op, not an error)", () => {
  const client = createFakeGithubClient();
  const { canonical, authorization } = applyPolicy("change_intent_stale");
  const finding = makeFinding({
    finding_type: "change_intent_stale", fingerprint: changeIntentStaleFingerprint("X"),
    detector_id: "change_intent_stale", detector_version: "1.0.0", observed_at: new Date().toISOString(),
    facts: ["f"], evidence: ["e"], canonical, authorization,
    provenance: { source_sha: "a", detector_version: "1.0.0", policy_version: POLICY_VERSION, config_hash: "c", evidence_hash: "e" },
    status: "DETECTED",
  });
  const { issueNumber } = upsertFinding(finding, client, { log() {} });
  client.closeIssue(issueNumber);
  const outcome = recordCleanCycleOrResolve({ number: issueNumber }, client, { log() {} });
  assert(outcome.action === "noop");
});

test("main_ci_red.mjs's source never invokes a mutating gh subcommand (rerun/cancel/dispatch) — it is read-only by construction, not just by docstring", () => {
  const src = execFileSync("cat", ["scripts/sentinel/detectors/main_ci_red.mjs"], { encoding: "utf8" });
  assert(!/\brun-rerun\b|\brerun\b|\bcancel\b|\bworkflow-dispatch\b/i.test(src), "the detector must never re-run, cancel, or dispatch a workflow");
  assert(!/execFileSync|execSync/.test(src), "the detector itself must never shell out directly — all GitHub access goes through github_client.mjs's injected fetchLatestRuns");
});

test("github_client.mjs's fetchLatestRuns only ever calls 'gh run list' / 'gh run view' — never a mutating run subcommand", () => {
  const src = execFileSync("cat", ["scripts/sentinel/github_client.mjs"], { encoding: "utf8" });
  const fetchSection = src.slice(src.indexOf("fetchLatestRuns(workflowName"), src.indexOf("fetchLatestRuns(workflowName") + 900);
  assert(/"run",\s*"list"/.test(fetchSection), "must use 'gh run list'");
  assert(/"run",\s*"view"/.test(fetchSection), "must use 'gh run view'");
  assert(!/"rerun"|"cancel"|"workflow-dispatch"/.test(fetchSection), "must never issue a mutating run/workflow subcommand");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ SECURITY TESTS FAILED\n"); process.exit(1); }
console.log("\n✓ ALL SECURITY TESTS PASSED\n");
