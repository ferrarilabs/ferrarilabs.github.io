# REMEDIATION_PLANS — B2, C6, F1 (three independent, separately committable plans)

**STATUS:** PLANS ONLY. **No code was changed.** No commit, no deployment.
**EVIDENCE BASIS:** exact source lines read from the working tree; `scripts/audit_pii_repo_wide.mjs`
executed to reproduce its current output; workflow YAML read directly.
**KNOWN GAPS:** no test coverage measurement exists for `app.js`; B2's test strategy is therefore
specified rather than plugged into an existing harness.
**ASSUMPTIONS:** each plan ships as its **own** commit. They share no files and must not be combined.

> **Sequencing constraint from the operator:** these may be implemented only *after* the modernization
> documentation package has been independently reviewed and committed. None is implemented here.
> **None touches scoring logic.**

---

# PLAN B2 — Remove the 200-entry audit-log cap

### Root cause
`appendAdminAuditLog()` unconditionally truncates the audit array after every write:

| App | File | Line |
|---|---|---|
| copa2026 | `bolao/copa2026/js/app.js` | 3269 |
| br2026 | `bolao/br2026/js/app.js` | 282 |
| cdb2026 | `bolao/cdb2026/js/app.js` | 671 |

Current statement, identical in all three:
```js
if (s.auditLog.length > 200) s.auditLog.length = 200;
```
Because entries are added with `unshift()` (newest first), assigning `.length` discards the **oldest**
entries. The truncation is a deliberate size guard against `localStorage` quota; the defect is that it
was applied to an *audit* structure, where discarding history is the one unacceptable behaviour.

### Evidence
- `JSON_CLASSIFICATION.md` J-04; `TECHNICAL_DEBT_REPORT.md` T-05; `ARCHITECTURE_DECISION_REVIEW.md` DEC-04.
- ADR-004 accepts "not tamper-proof". It does **not** address silent history loss. Two different
  claims; only one is documented as accepted.

### Affected component
Client-side admin audit log inside `bolao_state.state.auditLog`. **Not** scoring. **Not** the
relational `lottery_admin_audit`.

### Data-loss / security impact
**Active, ongoing, silent, irreversible.** Every admin action beyond the 200th destroys the oldest
record. No counter exists, so the number already lost is **unknown and unknowable**. This is the only
finding in the programme that is losing data continuously. Security impact is evidentiary: the entries
most likely to matter in a dispute (the earliest) are the first destroyed.

### Exact proposed change
Replace the hard truncation with a non-destructive guard. Preferred (Option 1):

```js
// BEFORE
if (s.auditLog.length > 200) s.auditLog.length = 200;

// AFTER — never discard; record pressure instead.
// The audit log is evidence: truncating it silently loses the OLDEST entries
// (unshift puts newest first). Cap removed deliberately — see ADR-004 amendment
// and docs/bolao/db-modernization/REMEDIATION_PLANS.md (B2).
if (s.auditLog.length > AUDIT_LOG_SOFT_LIMIT) {
  s.meta = s.meta || {};
  s.meta.auditLogOverSoftLimit = s.auditLog.length;   // observable, not destructive
}
```
with `const AUDIT_LOG_SOFT_LIMIT = 200;` declared alongside existing constants.

**Why not simply raise the cap:** any finite cap re-introduces the same silent loss later. The correct
long-term fix is the append-only `audit_events` table (DEC-12/B4); this change stops the bleeding
without pre-empting that design.

**Quota risk, addressed honestly:** removing the cap allows unbounded growth in `localStorage` (~5 MB)
and in the `bolao_state.state` JSONB. At ~200 bytes/entry, 5 MB ≈ 25 000 entries — far beyond
realistic admin volume for a seasonal pool. The `meta.auditLogOverSoftLimit` counter makes growth
observable before it becomes a problem, which the current code does not.

### Tests required
1. Unit: append 250 entries → length is 250; the **first** entry appended is still present.
2. Unit: `meta.auditLogOverSoftLimit` is set once past 200 and absent below it.
3. Merge: two states with overlapping audit logs merge without loss and without duplicates
   (exercises `mergeEntriesTombstonesAuditLog`).
4. Regression: `audit_scoring.py` for the affected app still **PASS** (scoring untouched, per standing rule).
5. Manual: admin panel renders a >200-entry log without layout breakage (the UI slices for display).

### Rollback
Revert the single-line change per app. No data migration; no schema change. Entries created while the
cap was absent remain valid and are simply retained. **Fully reversible.**

### Deployment implications
Touches three `js/app.js` files ⇒ `sync_version.yml` will bump `?v=` cache-bust automatically. No DB
change. No API change. Users pick it up on next load. **Three separate commits (one per app) are
preferable** so a per-app regression is independently revertible.

### Cross-cutting requirement
Amend **ADR-004** in the same change set to separate "not tamper-proof" (accepted) from "loses history"
(a defect now fixed). Leaving ADR-004 unamended would leave the repo asserting that this behaviour was
an accepted limitation.

---

# PLAN C6 — Fix the PII detector's email allowlist

### Root cause — **more precise than previously reported**
`scripts/audit_pii_repo_wide.mjs` line 32:
```js
const ALLOWED_EMAIL_SUFFIXES = [".invalid", "@example.com", "@email.com"];
```
The allowlist **already exists**. It has two distinct defects:

**Defect C6-a — missing `.test` (false positives).** RFC 6761 reserves `.test` exactly as it reserves
`.invalid`. The repo's `bolao/shared/scripts/` suite uses `@example.test` and `@x.test`. Reproduced:
the detector reports **82 findings across 13 (file, detector) pairs, and every one is `@example.test`
or `@x.test`**. The tool is **100 % false-positive** — verified, not estimated.

**Defect C6-b — `@email.com` is allowlisted but is a REAL domain (false negatives).** `email.com` is a
live webmail service. Allowlisting it means a genuine address at that domain is silently treated as
synthetic. My independent scan counted 13 real-domain `@email.com` matches that this tool passes over.
**This defect is more dangerous than C6-a**: C6-a produces noise, C6-b produces silence.

### Evidence
`HARDCODED_DATA_AUDIT.md` H-00; detector executed twice with identical output; per-file suffix
inventory confirming the `.test` attribution.

### Affected component
`scripts/audit_pii_repo_wide.mjs` only. A repo-side developer tool. **Zero production impact.**

### Data-loss / security impact
No data loss. Security impact is real but indirect: a gate that always cries wolf stops being read.
C6-b is worse — it can hide a real leak behind an allowlist entry.

### Exact proposed change
```js
// BEFORE
const ALLOWED_EMAIL_SUFFIXES = [".invalid", "@example.com", "@email.com"];

// AFTER
// RFC 2606 / RFC 6761 reserved names only. These TLDs cannot receive mail, so an
// address using them is synthetic by definition.
//   .invalid / .test          — reserved TLDs
//   @example.com/.org/.net    — reserved second-level names
// NOTE: "@email.com" was REMOVED — email.com is a live webmail domain, so
// allowlisting it suppressed real addresses. See REMEDIATION_PLANS.md (C6-b).
const ALLOWED_EMAIL_SUFFIXES = [
  ".invalid", ".test",
  "@example.com", "@example.org", "@example.net",
];
```

### Tests required
1. `@example.test`, `@x.test`, `@foo.invalid`, `@example.org` → **not** flagged.
2. `@gmail.com`, `@email.com` → **flagged** (C6-b regression guard — this is the important one).
3. Full-repo run: expected **0** `email-address` findings from `bolao/shared/scripts/`.
4. Full-repo run after removing `@email.com`: expect **new** findings to appear. **These must be
   triaged, not suppressed** — they are the previously-hidden set, and the change is only complete
   once each is classified.
5. `bolao/loterias/powerball/scripts/audit_pii_tests.mjs` still passes.

### Rollback
Revert one array literal. No state, no data, no deployment coupling.

### Deployment implications
None — developer tooling, not shipped to browsers. Not matched by `sync_version.yml` path filters, so
no cache-bust. **Caveat:** removing `@email.com` will make the detector report findings it previously
did not, so expect the gate to go from "82 noisy" to "N real". That is the point, and it should not be
mistaken for a regression.

---

# PLAN F1 — Cron-window coverage test

### Root cause
Six hand-written cron windows in `.github/workflows/powerball-results-email.yml` encode UTC↔EDT offset
arithmetic by hand. Nothing verifies that the union of windows covers the real event calendar. A
realised defect is recorded **in the file itself**: the schedule previously covered Tuesday and
Saturday only, omitting Monday and Wednesday, so it **silently never fired after any Monday or
Wednesday drawing, including 2026-08-05**. Fixed 2026-08-06 — by inspection, not by a test.

A second instance exists: `auto_results.yml` carries a month filter `* 6-7 *` and is now permanently
dormant (Copa concluded 2026-07-19). Consistent with reality, but nothing asserts it.

### Evidence
`DEPENDENCY_GRAPH.md` DG-05 (realised defect) and DG-02′ (dormant schedule);
`OBSERVABILITY_MODEL.md` O-06/O-01. 13 `cron` entries across 4 scheduled workflows.

### Affected component
CI configuration only. A **new** test file; no existing behaviour changes.

### Data-loss / security impact
No data loss. Operational impact is high and proven: participants did not receive result emails for at
least one real drawing, and the failure was invisible because a cron that does not fire emits nothing.
This is the canonical "absence" failure that `OBSERVABILITY_MODEL.md` §1 identifies as the dominant
class in this system.

### Exact proposed change
Add `bolao/scripts/cron_coverage.test.mjs` (Node, no dependencies, matching the existing
`cachebust.integration.test.mjs` convention):

1. Parse every `.github/workflows/*.yml`, extracting `cron:` entries (**must handle YAML list syntax
   `    - cron: '...'`** — the exact pattern my own earlier grep missed, which is itself evidence that
   this parsing is error-prone and belongs in a tested helper).
2. Expand each 5-field expression into the UTC minutes it fires over a representative window.
3. For each declared event calendar, assert coverage:
   - **Powerball**: draws Mon/Wed/Sat 22:59 ET → assert a firing exists within a configurable lag
     after each draw, converted to UTC **with DST handled explicitly**.
   - **CDB2026 / BR2026**: assert daily coverage of the declared evening kickoff windows.
4. Assert every scheduled workflow is either covered **or** explicitly listed in a
   `DORMANT_WORKFLOWS` allowlist with a written reason — `auto_results.yml` goes there, which converts
   DG-02′ from undocumented dead weight into an asserted decision.
5. Fail with a message naming the uncovered event date and the workflow.

**Deliberately excluded:** any network call, any GitHub API access, any check of whether runs actually
*happened*. That is O-01 (runtime heartbeat) and is a separate, later piece of work. F1 is a static
test of the configuration and must stay hermetic.

### Tests required
The deliverable *is* a test. It needs self-verification:
1. Against the current (fixed) Powerball schedule → **PASS**.
2. Against the historical buggy schedule (Tue/Sat only, as a fixture string) → **FAIL**, naming Monday
   and Wednesday. **This is the acceptance criterion**: the test must demonstrably catch the bug that
   actually occurred.
3. Against `auto_results.yml` → PASS only because it is in `DORMANT_WORKFLOWS`; removing it from the
   allowlist must FAIL.
4. DST boundary: a draw date on each side of a US DST transition.

### Rollback
Delete the new file. Nothing else references it. **Zero risk.**

### Deployment implications
None to production. Should be wired into CI as a required check; until then it is developer-run. Not
path-matched by `sync_version.yml`, so no cache-bust.

---

## Commit plan — five separate commits, in this order

| # | Commit | Files | Risk | Depends on |
|---|---|---|---|---|
| 1 | `test(ci): assert cron windows cover the real event calendar` (F1) | 1 new test | **None** | — |
| 2 | `fix(tooling): correct PII detector email allowlist (RFC-reserved only)` (C6) | 1 file, 1 array | **None** | — |
| 3 | `fix(cdb2026): stop truncating the admin audit log` (B2) | `cdb2026/js/app.js` | Low | doc package committed |
| 4 | `fix(br2026): stop truncating the admin audit log` (B2) | `br2026/js/app.js` | Low | 3 |
| 5 | `fix(copa2026): stop truncating the admin audit log` (B2) + ADR-004 amendment | `copa2026/js/app.js`, ADR-004 | Low | 4 |

Commits 1 and 2 are zero-risk, repo-side only, and touch nothing shipped to browsers — they could
proceed first once the documentation package is committed. Commits 3–5 touch shipped application code
and each triggers a cache-bust, so they are separated per app for independent revertibility.

## RISKS
- **C6-b will surface previously-hidden findings.** Triage them; do not re-add `@email.com`.
- **B2 removes a quota guard.** The soft-limit counter is the compensating control; without it, do not
  ship the change.
- **F1 could become a flaky test** if it computes "now" instead of a fixed representative window. Pin
  the window; never use the wall clock.

## NEXT DECISION (operator)
1. **Approve B2's cap removal in favour of a soft-limit counter** (vs. simply raising the cap)?
2. **Approve removing `@email.com` from the allowlist**, accepting that new findings will appear?
3. **Should F1 become a required CI check**, or developer-run initially?
