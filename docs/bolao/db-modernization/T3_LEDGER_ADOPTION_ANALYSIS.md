# T3_LEDGER_ADOPTION_ANALYSIS — how to adopt the baseline into migration history

**STATUS:** ANALYSIS COMPLETE. **T3 NOT PERFORMED.** Zero rows written to
`supabase_migrations.schema_migrations`. No production write of any kind.
**EVIDENCE BASIS:** read-only inspection of the live ledger's structure and contents; local toolchain
inventory; `DDL_BASELINE_AND_R03_RESOLUTION.md`.
**KNOWN GAPS:** the Supabase CLI is not installed, so no CLI behaviour was *observed* — CLI
consequences below are derived from its documented contract, not from execution here. Supabase's
managed-platform migration UI was not inspected (no console access).
**ASSUMPTIONS:** the project intends to use the Supabase CLI as its migration tool (implied by A3's
choice of `supabase/migrations/`).

---

## 1. Ground truth established by read-only inspection

### 1.1 The ledger

`supabase_migrations.schema_migrations` — 6 columns:

| # | Column | Type | Not null |
|---|---|---|---|
| 1 | `version` | `text` | **YES** — PRIMARY KEY |
| 2 | `statements` | `text[]` | no |
| 3 | `name` | `text` | no |
| 4 | `created_by` | `text` | no |
| 5 | `idempotency_key` | `text` | no — **UNIQUE** |
| 6 | `rollback` | `text[]` | no |

Contents: **exactly one row** — version `20260806143644`, name `add_minimal_powerball_schema`.

**The `statements` column is present and is the decisive detail.** Modern Supabase CLI records the
*applied SQL* in the ledger. A row whose `statements` is `NULL` or hand-written does not correspond to
anything actually executed, which is precisely what makes option A below dishonest rather than merely
untidy.

### 1.2 Local toolchain

| Tool | Status |
|---|---|
| `supabase` CLI | **NOT INSTALLED** |
| `docker` | **NOT INSTALLED** |
| `psql` / `pg_dump` / `pg_restore` | 18.4 |

**Consequence: every officially supported mechanism is currently unavailable.** `supabase migration
repair`, `supabase db pull`, `supabase db push` and `supabase migration list` all require the CLI;
several also want Docker for local diffing. **Installing the CLI is a prerequisite for options B and
C, and that installation is itself outside this programme's current authorization.**

### 1.3 The ordering problem — the real substance of T3

The captured baseline is a **superset** of migration `20260806143644`. It recreates the six
`lottery_*` tables that migration created, **plus** `bolao_state`, `rls_auto_enable()` and
`ensure_rls`, which it did not.

Therefore:

- Replaying baseline **and** `20260806143644` against an empty database **double-creates** and fails.
- Ordering the baseline *after* `20260806143644` is wrong: a baseline must precede everything.
- Ordering it *before* is also wrong while `20260806143644` remains replayable, for the same reason.

**This is why T3 is not a one-line insert.** It is a decision about what migration history *claims*.

> **Defect found and fixed during this analysis:** the baseline file was initially named
> `20260806143644_baseline_current_production_state.sql.template` — reusing the version string that is
> the ledger's existing PRIMARY KEY. That would have collided on insert and falsely asserted the
> baseline *is* that migration. Renamed to `BASELINE_current_production_state.reference.sql`, which the
> CLI does not recognise as a migration at all (it requires `<14-digit-timestamp>_<name>.sql`), so
> `supabase db push` cannot apply it by accident.

---

## 2. Option comparison

### Option A — Manual ledger insert

Hand-write a row into `supabase_migrations.schema_migrations`.

| Dimension | Consequence |
|---|---|
| `supabase migration list` | Shows the version as applied remotely. If no matching local file exists, it reports as remote-only — permanently confusing. |
| `supabase db push` | Skips the version (believes it applied). Masks the fact that nothing ran. |
| Future CI/CD | A pipeline computing pending migrations trusts a row that never corresponded to an execution. |
| Drift detection | **Actively harmed.** Drift compares recorded `statements` against files; a NULL/hand-written `statements` makes drift undetectable while *appearing* tracked. |
| Rollback | `rollback` column empty; no supported path. |
| Audit history | **Worst outcome.** The ledger asserts a migration was applied that never was. An auditor asking "what applied this schema?" gets a fabricated answer. |
| PK collision risk | High — demonstrated above. |

**Verdict: REJECT.** It converts an *honest gap* (R-03: provenance missing) into a *dishonest record*
(provenance fabricated). For a system that pays out real money and is being prepared for external
audit, that trade is strictly negative. This is also why the operator's instruction not to "manually
repair the ledger" is correct.

### Option B — `supabase migration repair --status applied <version>`

The vendor-supported command for marking a migration applied without executing it.

| Dimension | Consequence |
|---|---|
| `migration list` | Consistent — designed for exactly this reconciliation. |
| `db push` | Correctly skips the repaired version. |
| CI/CD | Supported and reproducible; the repair is an explicit, documented act. |
| Drift detection | Works going forward. Does **not** retroactively populate `statements` for the repaired version, so drift for *that* version stays blind. |
| Rollback | Still no rollback content for the baseline. |
| Audit history | Honest — repair is a recognised operation with known semantics, not a fabrication. |
| Blocker | **CLI not installed.** Also still requires deciding the ordering problem (§1.3): repair records a version, it does not resolve the superset overlap. |

**Verdict: VIABLE, but incomplete.** Good for reconciling a *known* version; it does not by itself
establish a replayable baseline.

### Option C — Baseline adoption via `supabase db pull`

The vendor's documented path for adopting an existing database into migration control. It introspects
the remote schema, writes a `<timestamp>_remote_schema.sql`, and records the corresponding ledger row
consistently.

| Dimension | Consequence |
|---|---|
| `migration list` | Clean: one baseline that local and remote agree on. |
| `db push` | Subsequent migrations apply on top of a coherent starting point. |
| CI/CD | **Best.** A fresh environment can be built from the baseline forward, which is what reproducibility means. |
| Drift detection | **Best.** `db diff` against a real baseline is the mechanism that answers "is production what we intended?" — currently unanswerable (O-27). |
| Rollback | Baseline itself is not rollback-able (correct — you do not roll back a starting point), but everything after it is. |
| Audit history | Honest and vendor-recognised: "history begins here, and here is the introspected proof." |
| Blockers | CLI not installed. Its generated file will differ cosmetically from my `pg_dump` capture — and **it will contain the three policy literals inline**, which collides with the operator restriction unless option A or B of `PRIVATE_LITERALS.md` is settled first. Also omits the `ensure_rls` event trigger unless explicitly handled — the same trap `pg_dump --schema=public` has. |

**Verdict: RECOMMENDED**, with two prerequisites.

### Option D — Leave existing history intact (current state)

Do nothing to the ledger. Keep the baseline as a non-CLI-recognised reference artefact.

| Dimension | Consequence |
|---|---|
| `migration list` | Shows the one real migration. Truthful but incomplete. |
| `db push` | Unaffected — the reference file is invisible to the CLI **by design**. |
| CI/CD | Cannot build a fresh environment from the repo. R-03 stays open. |
| Drift detection | Unavailable. |
| Rollback | Unchanged. |
| Audit history | **Honest.** No false claims. The gap is documented rather than papered over. |
| Risk | **Zero production risk.** |

**Verdict: CORRECT INTERIM POSTURE — and it is exactly where T1/T2 have left the project.**

---

## 3. Recommendation

**Adopt Option C (`supabase db pull` baseline adoption), sequenced behind three prerequisites, and
remain on Option D until they are met. Reject Option A permanently.**

| # | Prerequisite | Why it must come first |
|---|---|---|
| P1 | Install the Supabase CLI (and Docker if local diffing is wanted) | Options B and C are otherwise unavailable. This is a tooling decision the operator has not yet made. |
| P2 | Settle the policy-literal question (`PRIVATE_LITERALS.md` option A or B) | `db pull` writes literals **inline** into a Git-tracked file. Running it before this decision would violate the T2 restriction automatically. Option A (policy redesign) makes the problem vanish; option B (operator lifts the restriction, justified because the values already appear in 83–129 tracked files) makes it moot. |
| P3 | Decide the fate of the existing `20260806143644` row | The superset/ordering problem (§1.3). Cleanest: let `db pull` produce the authoritative baseline, keep the existing row as genuine history, and **never replay both** — fresh environments build from the pulled baseline only. |

**Then, and only then, request T3 authorization** — which at that point is not a hand-written insert
but the ledger row `db pull` writes as a side effect of a supported command.

### Why not just do Option B now and move on
Because `migration repair` would mark a *version* applied without establishing a *replayable
baseline*. R-03's substance is "the repo cannot reproduce production." Repair fixes the ledger's
bookkeeping; only a baseline fixes reproducibility. Doing B alone would let the programme *declare*
R-03 closed while the underlying inability remained — the same category of error as a backup with no
tested restore.

### R-03 closure criteria (unchanged, now precise)
1. `supabase/migrations/` exists and is the designated source of truth ✅ **done (T1)**
2. A capture of production exists, gate-passed, reconciled object-by-object ✅ **done (T2)**
3. A CLI-recognised baseline exists that a fresh environment can be built from ⬜ **needs P1–P3 + C**
4. The ledger and the repo agree (parity check O-29) ⬜ **needs C**

**Current R-03 status: `MATERIALLY_ADVANCED`.** Items 1–2 removed the *evidence* blocker; items 3–4
are a tooling-and-decision blocker, not a discovery one.

## 4. RISKS

- **Installing the CLI changes the deployment surface.** It brings its own opinions about
  `supabase/config.toml`, seed files and local development. Adopt deliberately, not incidentally.
- **`db pull` output will not byte-match the `pg_dump` capture.** Expect cosmetic differences. Treat
  the pulled file as authoritative going forward and keep the `pg_dump` capture as the forensic
  cross-check — divergence between them is itself a useful signal.
- **`db pull` may omit `ensure_rls`** (global event trigger), exactly as `pg_dump --schema=public`
  did. **Verify explicitly after pulling**; this is the single most likely silent gap.
- Option D indefinitely is not neutral: every day R-03 stays open, the window in which production
  cannot be reproduced continues.

## 5. NEXT DECISION (operator)

1. **Install the Supabase CLI?** (P1) — gates every supported mechanism.
2. **Policy literals: redesign (A) or lift the restriction (B)?** (P2) — evidence supports B; A is
   better long-term.
3. **Confirm the existing `20260806143644` row is retained as genuine history** (P3).
4. Only afterwards: authorize T3 as the ledger write performed *by* `supabase db pull`.

---

## 6. Exact future command sequence (NOT EXECUTED)

Recorded so the eventual execution is a review of a written plan rather than improvisation. **Nothing
below has been run. Steps marked ⚠ write to production and require separate authorization.**

### Phase P1 — tooling (local only, no production contact)
```
brew install supabase/tap/supabase      # or the documented installer for this platform
supabase --version                      # record it in the T3 evidence file
```
Docker is only needed for `supabase db diff --local`; `db pull` against a remote does not require it.
**Do not run `supabase init` in the repo root without checking what it writes** — it creates
`supabase/config.toml` and a `seed.sql`, and `supabase/migrations/` already exists from T1.

### Phase P2 — resolve the literal question BEFORE any pull (blocking)
`supabase db pull` writes policy definitions **inline**, including the three literals. Running it
before `PRIVATE_LITERALS.md`'s option A or B is settled would violate the T2 restriction
automatically, with no warning. Either:
- **A (recommended long-term):** redesign the six policies out of existence first, so there is nothing
  to inline; or
- **B (available now, evidence supports it):** operator lifts the restriction, on the basis that the
  three literals already appear in 83–129 tracked files.

### Phase P3 — baseline adoption ⚠
```
# Link the local project to the remote. Reads only; writes supabase/.temp/ locally.
supabase link --project-ref <REF>

# Introspect the remote schema into a NEW migration and record it as applied.
# THIS IS THE T3 PRODUCTION WRITE: it inserts one row into supabase_migrations.schema_migrations.
supabase db pull                        # ⚠ produces <utc>_remote_schema.sql + ledger row
```
Immediately afterwards, **verify the two things `db pull` is known to miss**:
```
# 1. the event trigger — global, omitted by schema-scoped introspection (finding R-08)
grep -c 'CREATE EVENT TRIGGER' supabase/migrations/*_remote_schema.sql   # expect >= 1, else add manually

# 2. parity between ledger and repo (check O-29)
supabase migration list                 # local and remote columns must agree
```

### Phase P4 — reconcile the pre-existing row ⚠
The ledger already contains `20260806143644 add_minimal_powerball_schema`, and the pulled baseline is
a **superset** of it. Do **not** delete that row: it is genuine history. Instead record, in the T3
evidence file, that the baseline supersedes it and that **a fresh environment builds from the pulled
baseline only — never by replaying both**, which would double-create.

If `migration list` shows the pulled baseline as remote-only, mark it applied with the supported
command rather than an INSERT:
```
supabase migration repair --status applied <pulled_version>    # ⚠ ledger write
```

### Phase P5 — verification (read-only)
```
supabase migration list                                  # ledger ↔ repo parity
supabase db diff --schema public --linked                 # expect EMPTY; non-empty = drift
node scripts/db/restore_rehearsal.mjs                     # preflight still green
```
A non-empty `db diff` immediately after adoption means the baseline does not describe production —
that is a **stop condition**, not a warning.

### What is deliberately absent
No `supabase db push` (nothing to apply — the baseline describes what already exists). No
`supabase db reset` (destructive). No `INSERT INTO supabase_migrations.schema_migrations` anywhere;
Option A is rejected permanently.

## 7. Post-adoption capability matrix

| Capability | Before T3 | After P3–P5 |
|---|---|---|
| `supabase migration list` | 1 remote-only row, no local counterpart | local ↔ remote agree |
| `supabase db push` | would try to apply a baseline describing existing objects | applies only genuinely new migrations |
| `supabase db diff` | meaningless (no baseline) | **drift detection works** — closes O-27 |
| CI/CD | cannot build a fresh environment | can build from baseline forward |
| Rollback | n/a for a baseline | every subsequent migration rollback-able |
| Auditability | provenance fabricated if hand-inserted | vendor-recognised introspection + repair |

## 8. R-03 closure checklist

| # | Criterion | Status |
|---|---|---|
| 1 | `supabase/migrations/` exists as source of truth | ✅ T1 |
| 2 | Gate-passed capture, reconciled object-by-object | ✅ T2 |
| 3 | CLI-recognised baseline a fresh environment can build from | ⬜ P1–P3 |
| 4 | Ledger ↔ repo parity (O-29) | ⬜ P3–P5 |
| 5 | `db diff` empty immediately after adoption | ⬜ P5 |

**R03_STATUS = MATERIALLY_ADVANCED.** Items 1–2 removed the evidence blocker. Items 3–5 are a
tooling-plus-decision blocker, and the command sequence above is now written rather than improvised.
