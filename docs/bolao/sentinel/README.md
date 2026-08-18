# Engineering Sentinel V1.0-A + V1.0-B

This is implementation-level documentation for what's actually built (`scripts/sentinel/`,
`.github/workflows/sentinel.yml`). For the full design rationale, see the architecture and design-
review artifacts referenced in ADR-012 through ADR-016 (`docs/bolao/adr/`) — this file doesn't
re-derive that reasoning, only how to operate what exists today.

## What it does

Once a day (plus manual `workflow_dispatch`), Sentinel runs every registered detector and creates
or updates a GitHub Issue in the "Ferrarilabs Engineering" project for anything each one finds. It
never modifies code. It never sends a notification to a participant. It's monitoring, not
enforcement — see "Failure Semantics" below. Two detectors are registered today:

- **CHANGE_INTENT Stale** (V1.0-A) — checks whether `CHANGE_INTENT.json` has a declaration that's
  gone stale — the exact condition that broke `npm run check` for #223.
- **Main CI Red** (V1.0-B) — checks whether the canonical `Safety check` workflow's latest run on
  `main` is red (failure/timed-out/action-required/a hung run stuck past 90 minutes/an
  unrecognized conclusion value). See `scripts/sentinel/detectors/main_ci_red.mjs`.

## How to run it

```bash
# Normal (live GitHub mutation)
node scripts/sentinel/run.mjs

# Preview only — detects, fingerprints, applies policy, shows the intended action, mutates nothing
node scripts/sentinel/run.mjs --dry-run

# Reconciliation sweep (repairs drift on already-created Sentinel Issues; also M1-only)
node scripts/sentinel/reconcile.mjs
node scripts/sentinel/reconcile.mjs --dry-run
```

Both need `gh` authenticated (`GH_TOKEN` env var, or an already-logged-in `gh` CLI session) with at
least `issues: write` on `ferrarilabs/ferrarilabs.github.io`. Project-field writes additionally
need a token with the `project` scope — see "Known gap: Project token" below.

## Finding contract

Every detector produces zero or more objects matching `scripts/sentinel/finding_schema.mjs`.
Mandatory: identity (`fingerprint`, `detector_id`, `detector_version`), evidence (`facts`,
`evidence` — masked/structural only, never raw PII), `canonical` (the only fields the writer ever
reads when setting Project fields), `authorization` (`investigation_level` + `mutation_level`),
`provenance` (the staleness tuple — see ADR-015), `status`. `validateFinding()` refuses anything
missing these, and separately refuses a Finding whose `facts`/`evidence` contain an obvious raw
email address — Sentinel findings must never carry PII.

## The Issue state marker

Every Sentinel-managed Issue has exactly one label (`sentinel-managed`) and one embedded,
machine-readable block in its body:

```
<!-- ferrarilabs-sentinel
{
  "schema_version": 1,
  "fingerprint": "sha256:...",
  "occurrence_count": 3,
  "clean_cycle_count": 0,
  "recurrence_count": 0,
  "intended_canonical": { "severity": "Medium", ... },
  "canonical_last_written": { "severity": "Medium", ... },
  ...
}
-->
```

This block — not a per-fingerprint label, not an external database — **is** Sentinel's state
store (ADR-012). `scripts/sentinel/github_state.mjs` is the only module that reads or writes it.
Human-readable text elsewhere in the Issue body is never touched by a re-write of this block.

Two fields matter for troubleshooting specifically:
- `intended_canonical`: what Sentinel is trying to have set on the Project item. Written *before*
  attempting the Project mutation, specifically so a crash mid-mutation leaves a durable record
  reconciliation can finish later.
- `canonical_last_written`: what's *confirmed* actually set. Compared against GitHub's live value
  on every run to detect a human override (see "Human overrides" below) — a mismatch means a human
  changed it, and Sentinel stops touching that field.

## Resolution lifecycle

A finding stays open as long as its detector keeps observing it. Once the detector stops observing
it, resolution requires a per-detector number of consecutive clean cycles
(`cleanCyclesToResolve()` in `scripts/sentinel/policy.mjs`), never a single one — for CHANGE_INTENT
Stale that's **3 consecutive clean cycles** (mere absence is a weak signal: a single clean run
could just as easily mean the detector had an outage as mean the problem is fixed). If the finding
reappears before the 3rd clean cycle, the counter resets to 0, not to 1 or 2.

Main CI Red is different by design: absence of a red finding is **not** enough on its own (a
CANCELLED or still-IN_PROGRESS run is also "absent from findings" but proves nothing). Its detector
returns `confirmedRecoveries` — a set of fingerprints with an explicit, positively-observed SUCCESS
run — and `run.mjs`'s clean-cycle pass only advances a Main CI Red Issue when its fingerprint is in
that set. Because a CI conclusion is a binary, non-flaky signal once positively confirmed, Main CI
Red resolves after just **1** clean cycle (`clean_cycles_to_resolve: 1` in `RULE_DEFAULTS`), not 3.
See `scripts/sentinel/detectors/main_ci_red.mjs`'s docstring, `test_main_ci_red_acceptance.mjs`,
and ADR-017 for the full reasoning and proof.

## Recurrence

If a fingerprint is observed again *after* its Issue closed, Sentinel reopens the **same** Issue
(found by the same fingerprint search) and increments `recurrence_count` — it never creates a new
Issue for a fingerprint that already has history.

## Human overrides

If you edit a Sentinel-managed Project field directly (e.g., correct the Priority), Sentinel
detects that on its next run (the live value no longer matches `canonical_last_written`) and stops
touching that specific field going forward — every other field on the same finding is unaffected.
There's no UI to "release" an override in this vertical slice; the practical way to reset one is to
let the finding resolve and recur (a fresh occurrence starts clean) or to edit it back manually.

## Authorization

`investigation_level: "I1"` (deterministic evidence collection — this detector reuses D3's own
logic, no AI involved at all in v1.0-A) and `mutation_level: "M1"` (Issue/Project metadata only) —
see ADR-013. No detector in this codebase may reach `M2` (code/branch/PR) without a separate,
explicit architectural decision; none exists yet.

## Failure semantics

`sentinel.yml` is never a required check. If it fails, times out, or doesn't run, **ordinary PRs
and development are completely unaffected** — see ADR-016. The pre-existing `npm run check` /
safety-contract / PII gates are untouched by Sentinel's existence and keep their own, separately-
established behavior.

## Troubleshooting

- **"Sentinel says a declaration is stale but I just added it"** — check `resolveBase()`'s output
  (the detector reuses the exact same base-resolution the safety contract uses); a declaration is
  only stale relative to a comparison base, and the base moves as commits land.
- **A Sentinel Issue's Project fields never got set** — almost certainly the known Project-token
  gap below. Run `node scripts/sentinel/reconcile.mjs` once the secret exists; it repairs this
  automatically without creating a duplicate Issue.
- **Two Issues exist for what looks like the same problem** — should not happen (idempotent
  upsert + post-create race detection + daily reconciliation all guard against it); if it does,
  `reconcile()`'s duplicate-detection pass will close the newer one as `Duplicate` on its next run.
  File a real Issue (not a Sentinel one) if this recurs, since it would mean one of those three
  layers has a bug.
- **Malformed embedded state** — `parseStateBlock()` never throws; a malformed block returns
  `null`, and `reconcile()`'s next sweep rebuilds it from observable GitHub truth rather than
  leaving the Issue unmanaged.

## Known gap: Project token

The default `GITHUB_TOKEN` GitHub Actions provides can create/label/comment on Issues, but **cannot
write GitHub Projects v2 (org-scoped) fields** — this is a platform limitation, not something a
`permissions:` block can grant. Until a `SENTINEL_PROJECT_TOKEN` repository secret (a fine-grained
PAT or GitHub App installation token with `repo` + `project` scopes) is created, scheduled/dispatched
runs will create/update Issues correctly but Project-field writes will fail; `reconcile.mjs`'s daily
sweep is specifically designed to complete those writes once the secret exists (see `intended_canonical`
above) — this is a known, designed-for gap, not a crash.

## How to add a future detector safely

1. Add `scripts/sentinel/detectors/<name>.mjs`, exporting a `detect<Name>()` function returning an
   array of `makeFinding(...)` objects (see `change_intent_stale.mjs` for the shape). Reuse
   existing logic (safety contract functions, existing audit scripts) — never reimplement a rule
   this repo already has a source of truth for.
2. Add a rule-default entry to `RULE_DEFAULTS` in `scripts/sentinel/policy.mjs` (severity floor,
   priority, work_type, area, investigation/mutation level) — using only existing Project taxonomy
   option names (verify live via `gh api graphql`, never assume).
3. Add a fingerprint function to `scripts/sentinel/fingerprint.mjs`, built only from stable,
   semantic identity fields — never a timestamp, SHA, line number, or run ID.
4. Register the detector in `DETECTORS` in `scripts/sentinel/run.mjs`.
5. Write unit tests (fixture-injected, no real GitHub) plus at least the acceptance scenarios that
   apply from `scripts/sentinel/test_acceptance.mjs`'s pattern.
6. Add every new test file to `bolao/scripts/gate_registry.json` and `scripts/verify.mjs` (the gate
   registry audit will refuse to let it stay invisible) and to `package.json`'s `test:node` chain.
7. If the detector touches a `DECLARE_TO_CHANGE` critical surface (e.g., adds a new scheduled
   workflow), declare it in `CHANGE_INTENT.json` per this repo's own standing governance — Sentinel
   is not exempt from the rules it helps enforce.
