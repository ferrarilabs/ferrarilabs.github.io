# TEST_STRATEGY — measured state and forward design

**STATUS:** COMPLETE. **Test suites were EXECUTED**, not merely designed. No production write.
**EVIDENCE BASIS:** `package.json` scripts; 49 tracked test/audit scripts; live execution of
`npm run test:scoring` and `npm run test:node` plus individual execution of 8 scripts the `&&` chain
skipped; `.github/workflows/` inspection.
**KNOWN GAPS:** `test:browser` and `test:provider` were **not** run — they need Playwright/Chromium and
network egress, both unavailable in this sandbox (the scoring suite logged `TLS handshake recusado`).
Their status is therefore **UNKNOWN**, not passing.
**ASSUMPTIONS:** none — every claim below comes from an executed command.

> Correction to an earlier framing in this programme: Workstream 9 asked to "design tests". **A
> substantial suite already exists.** The real gap is that **nothing enforces it.** This document
> therefore measures what exists and closes the enforcement gap, rather than designing a suite that
> would duplicate 49 working scripts.

---

## 1. What already exists (and it is better than expected)

`package.json` defines six suites over **49 tracked test/audit scripts**:

| Suite | Scripts | Covers |
|---|---|---|
| `test:scoring` | 5 | 4 × `audit_scoring.py` (copa/br/cdb/powerball) + `audit_integrity.py` + result-email source |
| `test:node` | 13 | test isolation, roster freeze, draw lifecycle, remote-authoritative, draw provenance, CBF ingestion, golden master, state merge, aggregate hero, visual contract, cache-bust ×2, money interop |
| `test:notifications` | 8 | notification repository (js+py), worker, pipeline, outbox interop, durable persist |
| `test:provider` | 2 | ESPN provider, pipeline health |
| `test:browser` | 5 | structural parity, ARIA nav, visual consistency, draw combo, live probability bars |
| `test` | all | aggregate |

Distribution: `cdb2026/scripts` 14 · `shared/scripts` 11 · `powerball/scripts` 9 · `bolao/scripts` 6 ·
`copa2026` 3 · others 6.

**This is a genuinely strong suite for a vanilla-JS project with no framework** — money-path logic,
state-merge semantics, provenance invariants, cross-language (Python↔Node) interop, and visual parity
are all covered. It deserves to be said plainly before the findings below.

## 2. Measured results — 2026-08-08

| Suite | Exit | Result |
|---|---|---|
| `test:scoring` | **0** | ✅ **PASS** — money-affecting logic intact |
| `test:node` | **1** | ❌ **FAIL** — halts at `audit_draw_provenance.mjs` (16 passed, 1 failed) |
| `test:notifications` | — | not run |
| `test:provider` | — | not run (needs network) |
| `test:browser` | — | not run (needs Playwright/Chromium) |

### 2.1 Finding TS-01 — HIGH: the `&&` chain hides 8 passing suites

`test:node` is a single `&&` chain of 13 commands. The 5th fails, so **8 scripts never execute**. Run
individually, **all 8 PASS**:

`audit_cbf_ingestion` ✅ · `audit_golden_master` ✅ · `audit_state_merge` ✅ · `test_aggregate_hero` ✅ ·
`check_shared_visual_contract` ✅ · `cachebust.integration.test` ✅ · `test_money_interop` ✅ ·
`check_cachebust.test` ✅

**Consequence:** one failure makes 8 healthy suites indistinguishable from untested. A developer sees
"test:node FAILED" and learns nothing about state merge, golden master or money interop — the suites
most likely to matter. **Fix: run all, aggregate failures, exit non-zero at the end.** `&&` is the
wrong operator for a test runner.

### 2.2 Finding TS-02 — HIGH: `audit_draw_provenance.mjs` assertion 13 is a false positive

The failing assertion:

```js
assert(!/qualified.*=>.*teamA|derive|autoPair|shuffle|random/i.test(body),
  "apareceu no admin algo que parece derivar/sortear confronto");
```

Evaluated against the current `applyAdminMutation` body (11 694 chars):

| Alternative | Result |
|---|---|
| `qualified.*=>.*teamA` | no match |
| **`derive`** | **MATCH — matched text `DERIVE`** |
| `autoPair` | no match |
| `shuffle` | no match |
| `random` | no match |
| `Math.random` (whole file) | no match |

The match is the substring `DERIVE` inside the constants **`DERIVED_PHASES`** and
**`TOPOLOGY_PHASE_NOT_DERIVED`**, introduced by in-flight work on `main` (`app.js` +122/−5,
uncommitted). Those are *guard* constants — semantically the opposite of the risk the assertion exists
to catch. Both positive assertions (`register-official-draw`, `QF_DRAW_NOT_OFFICIAL`) still pass, and
`Math.random` is absent from the entire file.

**Therefore the draw-provenance invariant is intact and the test is over-broad.** Root cause: the
assertion is a **case-insensitive substring grep over function source text**, which cannot distinguish
"code that fabricates a pairing" from "a constant or comment containing the word derived".

**Not fixed here** — it is application/test code owned by concurrent in-flight work, outside this
programme's remit. Recorded as backlog item `B-31` with the exact diagnosis so whoever owns it can fix
it in one line (e.g. `\bderive\s*\(` or `autoPair|shuffle|Math\.random` and drop the bare `derive`).

**Generalised lesson:** source-text grepping is a legitimate technique for "this dangerous call must
not appear", but it needs **word-boundary and call-shape anchors**. Six other assertions in the same
file use the same technique and are exposed to the same class of false positive as identifiers evolve.

### 2.3 Finding TS-03 — CRITICAL: no CI job runs any test

`.github/workflows/` contains 7 workflows: 4 scheduled email/result jobs, a provider snapshot, Pages
deploy, and cache-bust sync. **None invokes `npm test` or any test script.**

So the suite runs only when a human remembers. Combined with TS-01, the practical state is: a real
failure can sit on `main` indefinitely — and one is sitting there now. This is the single highest-value
gap in the whole test posture, and it is cheap to close.

## 3. Coverage assessment against the nine requested test classes

| Class | State | Evidence |
|---|---|---|
| **Unit** | ✅ Strong | Scoring suites, money interop, aggregate logic |
| **Integration** | ✅ Strong | Notification pipeline, outbox interop, cross-language repository tests |
| **Regression** | ✅ Strong | Golden master, structural parity, visual consistency, cache-bust |
| **Migration** | ❌ **ABSENT** | No migration exists to test; nothing validates baseline↔production parity (O-29) |
| **Backup** | ⚠️ Partial | Integrity V1–V8 executed **manually once**; not automated, not repeatable-on-demand |
| **Restore** | ❌ **ABSENT** | No restore path exists (DEC-01); rehearsal designed, never run |
| **Performance** | ❌ **ABSENT** | No baseline assertions; `PERFORMANCE_BASELINE.md` is a one-off measurement |
| **Security** | ⚠️ Partial | `audit_pii_repo_wide.mjs` exists but is **100 % false-positive today** (H-00); no RLS/ACL assertions |
| **Chaos** | ❌ **ABSENT** | No failure injection; notably no test that a cron *not firing* is detected (the realised DG-05 defect) |

**Four of nine classes are entirely absent, and all four are database/operations classes** — precisely
the surface this modernization programme concerns. The application layer is well tested; the data layer
is untested.

## 4. Forward design — the gaps only

Only classes absent or broken are designed here. Existing suites need enforcement (§5), not redesign.

### 4.1 Migration tests
- **Baseline parity (O-29):** assert every object in the captured baseline exists in the target with
  matching PK/FK/UNIQUE counts. Runs against a restored copy, never production.
- **Idempotency:** applying a migration twice must fail cleanly or be a no-op — never partially apply.
- **Dual-write divergence (O-30):** the gate that decides whether a read switch is safe. Zero
  divergence required.
- **Rollback:** every migration's rollback must be exercised in the rehearsal target, not assumed.
- **`ensure_rls` awareness:** assert that a newly created table arrives RLS-enabled with zero policies
  (the R-08 surprise) so it is *expected* rather than diagnosed as a broken migration.

### 4.2 Backup tests (automate what was done manually)
Codify V1–V8 from `BACKUP_RESTORE_OPERATIONAL_DESIGN.md` §3 as a script: SHA-256 recomputation,
`pg_restore --list` TOC counts vs. expected (7/3/1/6/24/1), RLS + policy counts in the plain artefact,
event-trigger companion non-empty, `pg_dump` exit 0 with empty stderr. **All offline against the
archive** — no production access, so it is safe to run in CI on a schedule.

### 4.3 Restore tests
Acceptance criteria A1–A11 already specified (`BACKUP_RESTORE_OPERATIONAL_DESIGN.md` §11.4). A8 is the
notable one: compare each restored policy's expression **md5** against the DR-1 hashes — proves
byte-exact restoration without ever printing an expression.

### 4.4 Performance regression tests
Assert against the measured baseline: index count = 8 (fails when someone adds an unreviewed index);
**FK index coverage** (currently 0/17 — the assertion should encode the *intended* target, failing
until fixed); `bolao_state` document size below a ceiling; dead-tuple ratio below a ceiling.

### 4.5 Security tests
- Fix H-00 first (`REMEDIATION_PLANS.md` C6), or every security test inherits a broken detector.
- **ACL drift assertion (O-22):** compare the live privilege set against the captured baseline — the
  tooling and baseline already exist from Phase 1. Cheapest high-value security test available.
- `anon` must hold **no** `TRUNCATE` anywhere in `public`; **no** SECURITY DEFINER function without a
  pinned `search_path`; **no** table with policies while RLS is off.

### 4.6 Chaos tests
- **Cron non-firing** (`REMEDIATION_PLANS.md` F1) — the realised DG-05 defect; the highest-value chaos
  test because absence produces no signal.
- Provider unavailable → snapshot staleness detected, not silently served (DG-04).
- Concurrent state writers → lost-update detection (ADR-002's accepted limitation, currently unproven).
- Outbox worker killed mid-send → no duplicate on retry (needs the idempotency key).

## 5. Enforcement design (the actual fix)

| # | Change | Effort | Value |
|---|---|---|---|
| 1 | Replace `&&` chains with a runner that executes all and aggregates failures | S | Ends TS-01 |
| 2 | CI workflow running `test:scoring` + `test:node` on PR and push | S | Ends TS-03 |
| 3 | Fix assertion 13 (TS-02) | S | Unblocks the chain |
| 4 | Add `test:backup` (offline, §4.2) to the scheduled workflows | M | First data-layer test |
| 5 | Add `test:security` (ACL drift, §4.5) after H-00 is fixed | M | Continuous security |
| 6 | Mark `test:browser`/`test:provider` as environment-dependent and report **SKIPPED**, never silently pass | S | Honest signal |

**Item 6 matters more than its size suggests:** in this sandbox those suites cannot run at all. A
runner that treats "could not run" as "passed" is worse than no runner. The scoring suite already
degrades honestly (it logged `TLS handshake recusado` and reported a stale snapshot rather than
inventing a result) — that behaviour is the model to copy.

## 6. RISKS

- **A failing test is on `main` right now.** It is a false positive (TS-02), but it makes the suite's
  signal unusable until fixed, and it masks 8 passing suites (TS-01).
- **Adding CI enforcement while a false positive exists would block all merges.** Sequence matters:
  fix TS-02, then enforce.
- Four absent test classes are all blocked on things that do not yet exist (a migration, a restore
  path). They cannot be written earlier — but they must not be forgotten once those exist.
- Automating backup tests in CI requires the backup artefact to be reachable from CI, which conflicts
  with "keep backups off-platform". Prefer local/scheduled execution over hosted CI for that suite.

## 7. NEXT DECISION (operator)

1. **Authorize fixing assertion 13** (TS-02) — one-line, app-test code, currently blocking the chain.
2. **Authorize a CI test job** (TS-03) — and decide whether it gates merges or only reports.
3. **Convert `&&` chains to an aggregating runner** (TS-01)?
4. Accept that `test:browser`/`test:provider` status is **UNKNOWN** in constrained environments and
   must report SKIPPED rather than pass.
