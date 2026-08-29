#!/usr/bin/env node
/**
 * github_client.mjs — the ONLY module that talks to GitHub.
 *
 * Two implementations of one interface, kept together deliberately so they can't drift apart:
 *   - createRealGithubClient(): shells out to `gh` (argument arrays only, never string-interpolated
 *     shell — same convention as scripts/pii_detectors.mjs and scripts/safety/surfaces.mjs).
 *   - createFakeGithubClient(): pure in-memory, used by every test in this vertical slice except
 *     the one deliberate live-integration smoke test. Implements the exact same method surface, so
 *     writer.mjs/reconcile.mjs are tested against the real algorithm, not a stub of it.
 *
 * Interface (both implementations):
 *   searchSentinelIssues(fingerprintText) -> [{number, state, title, body, labels}]
 *   getIssue(number) -> {number, state, title, body, labels, nodeId}
 *   createIssue({title, body, labels}) -> {number, ...}
 *   updateIssueBody(number, body) -> void
 *   addComment(number, body) -> void
 *   closeIssue(number) -> void
 *   reopenIssue(number) -> void
 *   ensureLabel(name) -> void
 *   ensureProjectItem(issueNodeId) -> itemId
 *   getProjectFields(itemId) -> {fieldName: value}
 *   setProjectFields(itemId, {fieldName: value}) -> void   // resolves single-select option IDs by
 *                                                            // NAME at call time, never a cached ID
 */
import { execFileSync } from "node:child_process";

export const SENTINEL_LABEL = "sentinel-managed";
export const PROJECT_TITLE = "Ferrarilabs Engineering";
export const REPO = "ferrarilabs/ferrarilabs.github.io";

// ── real implementation ──────────────────────────────────────────────────────────────────────

const RETRYABLE_RE = /\b(429|502|503|504)\b|ETIMEDOUT|ECONNRESET|ENOTFOUND|network error|timeout/i;
const MAX_ATTEMPTS = 3;

function sleepSync(ms) {
  // Bounded, short (max a few seconds total across all retries) — acceptable to block
  // synchronously in a short-lived CI script rather than thread async control flow through every
  // caller for a rare transient-error path.
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait, intentionally short */ }
}

/**
 * Bounded exponential backoff + jitter, retried ONLY for 429/502/503/504/transient-network
 * classes — never for a 4xx auth/validation error, which is a logic error, not a transient fault,
 * and retrying it risks duplicate side effects instead of surfacing the real problem.
 */
function ghWithRetry(args) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return execFileSync("gh", args, { encoding: "utf8" }).trim();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.stderr || e?.message || e);
      if (!RETRYABLE_RE.test(msg) || attempt === MAX_ATTEMPTS) throw e;
      const backoffMs = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      sleepSync(backoffMs);
    }
  }
  throw lastErr;
}

function gh(args) {
  return ghWithRetry(args);
}
function ghJson(args) { return JSON.parse(gh(args)); }
function ghGraphQL(query, vars = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push("-f", `${k}=${v}`);
  return ghJson(args);
}

let cachedProjectId = null;
function resolveProjectId() {
  if (cachedProjectId) return cachedProjectId;
  const out = ghGraphQL(`query($login:String!){ user(login:$login){ projectsV2(first:20){ nodes { id title } } } }`, { login: REPO.split("/")[0] });
  const nodes = out?.data?.user?.projectsV2?.nodes || [];
  const match = nodes.find((n) => n.title === PROJECT_TITLE);
  if (!match) throw new Error(`github_client: no project titled "${PROJECT_TITLE}" found`);
  cachedProjectId = match.id;
  return cachedProjectId;
}

let cachedFields = null;
function resolveFields() {
  if (cachedFields) return cachedFields;
  const projectId = resolveProjectId();
  const out = ghGraphQL(`query($id:ID!){ node(id:$id){ ... on ProjectV2 { fields(first:30){ nodes { ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }`, { id: projectId });
  cachedFields = out?.data?.node?.fields?.nodes || [];
  return cachedFields;
}

export function createRealGithubClient() {
  return {
    searchSentinelIssues(fingerprintText) {
      const q = `repo:${REPO} is:issue label:${SENTINEL_LABEL} "${fingerprintText}" in:body`;
      const rows = ghJson(["issue", "list", "--repo", REPO, "--search", q, "--state", "all", "--json", "number,state,title,body,labels"]);
      return rows.map((r) => ({ ...r, labels: (r.labels || []).map((l) => l.name) }));
    },
    listSentinelIssues({ state = "all" } = {}) {
      const rows = ghJson(["issue", "list", "--repo", REPO, "--label", SENTINEL_LABEL, "--state", state, "--json", "number,state,title,body,labels", "--limit", "200"]);
      return rows.map((r) => ({ ...r, labels: (r.labels || []).map((l) => l.name) }));
    },
    getIssue(number) {
      const r = ghJson(["issue", "view", String(number), "--repo", REPO, "--json", "number,state,title,body,labels,id"]);
      return { ...r, labels: (r.labels || []).map((l) => l.name), nodeId: r.id };
    },
    createIssue({ title, body, labels }) {
      const out = gh(["issue", "create", "--repo", REPO, "--title", title, "--body", body, ...(labels || []).flatMap((l) => ["--label", l])]);
      const number = Number(out.trim().split("/").pop());
      return this.getIssue(number);
    },
    updateIssueBody(number, body) {
      gh(["issue", "edit", String(number), "--repo", REPO, "--body", body]);
    },
    updateIssueTitle(number, title) {
      gh(["issue", "edit", String(number), "--repo", REPO, "--title", title]);
    },
    addComment(number, body) {
      gh(["issue", "comment", String(number), "--repo", REPO, "--body", body]);
    },
    closeIssue(number) {
      gh(["issue", "close", String(number), "--repo", REPO]);
    },
    reopenIssue(number) {
      gh(["issue", "reopen", String(number), "--repo", REPO]);
    },
    ensureLabel(name) {
      try { gh(["label", "create", name, "--repo", REPO, "--color", "5319E7", "--description", "Managed by Ferrarilabs Engineering Sentinel"]); }
      catch { /* already exists — not an error */ }
    },
    ensureProjectItem(issueNodeId) {
      const projectId = resolveProjectId();
      const out = ghGraphQL(`mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p, contentId:$c}){ item { id } } }`, { p: projectId, c: issueNodeId });
      return out?.data?.addProjectV2ItemById?.item?.id;
    },
    getProjectFields(itemId) {
      const projectId = resolveProjectId();
      const out = ghGraphQL(`query($id:ID!){ node(id:$id){ ... on ProjectV2Item { fieldValues(first:30){ nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } } ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } } ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } } } } } } }`, { id: itemId });
      void projectId;
      const nodes = out?.data?.node?.fieldValues?.nodes || [];
      const result = {};
      for (const n of nodes) {
        const fname = n.field?.name;
        if (!fname) continue;
        result[fname] = n.name ?? n.text ?? n.date ?? null;
      }
      return result;
    },
    setProjectFields(itemId, values) {
      const projectId = resolveProjectId();
      const fields = resolveFields();
      for (const [name, value] of Object.entries(values)) {
        if (value === undefined || value === null) continue;
        const field = fields.find((f) => f.name === name);
        if (!field) throw new Error(`github_client: unknown Project field "${name}" — refusing to invent one`);
        if (field.options) {
          const opt = field.options.find((o) => o.name === value); // resolved by NAME every call, never a cached ID
          if (!opt) throw new Error(`github_client: unknown option "${value}" for field "${name}"`);
          ghGraphQL(`mutation($p:ID!,$i:ID!,$f:ID!,$v:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p, itemId:$i, fieldId:$f, value:{singleSelectOptionId:$v}}){ projectV2Item { id } } }`, { p: projectId, i: itemId, f: field.id, v: opt.id });
        } else {
          ghGraphQL(`mutation($p:ID!,$i:ID!,$f:ID!,$v:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p, itemId:$i, fieldId:$f, value:{text:$v}}){ projectV2Item { id } } }`, { p: projectId, i: itemId, f: field.id, v: String(value) });
        }
      }
    },
    /**
     * Latest runs of `workflowName` on `branch`, most-recent first, normalized to
     * `{ headSha, createdAt, status, conclusion, jobs: [{ name, conclusion }] }` — the exact shape
     * main_ci_red.mjs's detectMainCiRed() expects. Read-only: never re-runs/cancels/dispatches.
     */
    fetchLatestRuns(workflowName, branch, limit = 5) {
      const runs = ghJson([
        "run", "list", "--repo", REPO, "--workflow", workflowName, "--branch", branch,
        "--json", "databaseId,headSha,createdAt,status,conclusion", "--limit", String(limit),
      ]);
      return runs.map((r) => {
        let jobs = [];
        try {
          const detail = ghJson(["run", "view", String(r.databaseId), "--repo", REPO, "--json", "jobs"]);
          jobs = (detail.jobs || []).map((j) => ({ name: j.name, conclusion: j.conclusion }));
        } catch { /* job detail is best-effort — classification still works at the run level without it */ }
        return {
          headSha: r.headSha,
          createdAt: r.createdAt,
          status: r.status === "completed" ? "completed" : r.status,
          conclusion: r.conclusion || null,
          jobs,
        };
      });
    },
  };
}

// ── fake implementation, for tests ───────────────────────────────────────────────────────────

export function createFakeGithubClient(initial = {}) {
  let nextNumber = initial.nextNumber ?? 1000;
  const issues = new Map(); // number -> issue
  const projectItems = new Map(); // itemId -> {issueNumber, fields}
  let nextItemId = 1;
  let workflowRuns = initial.workflowRuns || []; // seeded by tests; fetchLatestRuns() below just returns this
  const calls = []; // audit trail for assertions

  function record(name, args) { calls.push({ name, args }); }

  return {
    calls,
    _issues: issues, // test introspection only
    _projectItems: projectItems,

    searchSentinelIssues(fingerprintText) {
      record("searchSentinelIssues", { fingerprintText });
      return [...issues.values()]
        .filter((i) => (i.labels || []).includes("sentinel-managed") && (i.body || "").includes(fingerprintText))
        .map((i) => ({ ...i }));
    },
    getIssue(number) {
      record("getIssue", { number });
      const i = issues.get(number);
      if (!i) throw new Error(`fake client: no issue #${number}`);
      return { ...i };
    },
    createIssue({ title, body, labels }) {
      const number = nextNumber++;
      const issue = { number, nodeId: `node-${number}`, state: "OPEN", title, body, labels: labels || [] };
      issues.set(number, issue);
      record("createIssue", { number, title });
      return { ...issue };
    },
    updateIssueBody(number, body) {
      const i = issues.get(number);
      if (!i) throw new Error(`fake client: no issue #${number}`);
      i.body = body;
      record("updateIssueBody", { number });
    },
    updateIssueTitle(number, title) {
      const i = issues.get(number);
      if (!i) throw new Error(`fake client: no issue #${number}`);
      i.title = title;
      record("updateIssueTitle", { number, title });
    },
    addComment(number, body) {
      record("addComment", { number, body });
    },
    closeIssue(number) {
      const i = issues.get(number);
      if (i) i.state = "CLOSED";
      record("closeIssue", { number });
    },
    reopenIssue(number) {
      const i = issues.get(number);
      if (i) i.state = "OPEN";
      record("reopenIssue", { number });
    },
    listSentinelIssues({ state = "all" } = {}) {
      record("listSentinelIssues", { state });
      return [...issues.values()]
        .filter((i) => (i.labels || []).includes("sentinel-managed"))
        .filter((i) => state === "all" || i.state === state.toUpperCase())
        .map((i) => ({ ...i }));
    },
    ensureLabel() { /* no-op, labels are just strings in the fake */ },
    ensureProjectItem(issueNodeId) {
      const existing = [...projectItems.entries()].find(([, v]) => v.issueNodeId === issueNodeId);
      if (existing) return existing[0];
      const itemId = `item-${nextItemId++}`;
      projectItems.set(itemId, { issueNodeId, fields: {} });
      record("ensureProjectItem", { issueNodeId, itemId });
      return itemId;
    },
    getProjectFields(itemId) {
      record("getProjectFields", { itemId });
      return { ...(projectItems.get(itemId)?.fields || {}) };
    },
    setProjectFields(itemId, values) {
      const item = projectItems.get(itemId);
      if (!item) throw new Error(`fake client: no project item ${itemId}`);
      Object.assign(item.fields, values);
      record("setProjectFields", { itemId, values });
    },
    fetchLatestRuns(workflowName, branch) {
      record("fetchLatestRuns", { workflowName, branch });
      return workflowRuns.map((r) => ({ ...r }));
    },
    _setWorkflowRuns(runs) { workflowRuns = runs; }, // test introspection only
  };
}
