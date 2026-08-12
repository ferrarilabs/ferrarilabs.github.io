# M0_BASELINE_REGISTRATION_DECISION — final decision package

**Status: DECISION PACKAGE. NOTHING EXECUTED.**
`PRODUCTION_WRITES = 0` · `PRODUCTION_MIGRATIONS = 0` · `LEDGER_ROWS_CHANGED = 0` · `PUSH_PERFORMED = NO`

This document exists to be approved or rejected. It contains no command that has been run against
production, and the recommended plan is written so that execution is a review of a written page rather
than improvisation at a prompt.

---

## 1. The truthfulness principle, made mechanical

A ledger row can mean one of two entirely different things:

| Provenance | Meaning |
|---|---|
| `MIGRATION_APPLIED_HISTORICALLY` | this SQL was **executed** against the database at that version |
| `BASELINE_ADOPTED_AT_CURRENT_STATE` | this SQL **describes objects that already existed**; it was never run, and the row exists only to stop the CLI trying to run it |

Conflating them is how a migration history becomes a fabrication. The distinction must survive in the
audit trail, and a promise in a document is not survival — the next person reads the ledger, not this file.

**So the distinction is carried by three independent, verifiable signals that must agree:**

1. **The ledger itself.** `supabase migration repair --status applied` records a version and leaves
   `statements` **NULL**, because there were no statements — nothing was executed. That NULL is usually
   filed as a weakness (true: drift for those versions is not backed by recorded SQL). It is *also* the
   structurally honest discriminator: `statements` present ⇒ executed, absent ⇒ adopted.
2. **The migration file's own header.** Every file carries
   `-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY` or `-- PROVENANCE: BASELINE_ADOPTED_AT_CURRENT_STATE`,
   inside the file whose digest is in the SHA manifest.
3. **The filename.** `..._baseline_adopted_...` appears in the ledger's own `name` column, so
   `supabase migration list` displays the distinction without anyone consulting documentation.

`classifyLedgerProvenance()` in `scripts/db/migration_harness.mjs` cross-checks signals 1 and 2 and fails
on disagreement. It is tested (10 assertions) against the exact expected post-M0 state, including the two
directions of falsehood:

- a file claiming it was **executed** while the ledger holds no statements — the claim the principle forbids;
- a file claiming **adoption** while the ledger holds recorded statements — understating real history.

It also rejects a migration file with **no** header, because leaving the distinction to inference is the
thing being prevented, and an adopted file with **no ledger row**, because that is the dangerous
half-finished state where `db push` would execute a file describing objects that already exist.

---

## 2. Current state

### 2.1 Ledger (`supabase_migrations.schema_migrations`)

Established by read-only inspection during Phase 1 and confirmed by `supabase migration fetch`
(read-only; ledger verified unchanged afterwards).

| Column | Type | Notes |
|---|---|---|
| `version` | `text` | **PRIMARY KEY** |
| `statements` | `text[]` | the decisive column: records the SQL actually executed |
| `name` | `text` | |
| `created_by` | `text` | |
| `idempotency_key` | `text` | **UNIQUE** |
| `rollback` | `text[]` | |

**Contents: exactly one row.**

| version | name | statements | provenance |
|---|---|---|---|
| `20260806143644` | `add_minimal_powerball_schema` | **present** (recovered locally by `migration fetch`) | `MIGRATION_APPLIED_HISTORICALLY` — genuine |

That row is real history and is **retained untouched** by every option below except A.

### 2.2 Repo baseline state

`supabase/migrations/` — **zero CLI-recognised migrations.**

> **CORRECTION (2026-08-09).** An earlier version of this document, and my earlier operator-facing
> summaries, implied these files were in the repository. **They are not. `supabase/` is UNTRACKED —
> nothing under it has ever been committed on any branch.** Verified: `git ls-files supabase/` is empty and
> no commit touches the path. The files exist only in this working tree.
>
> Consequence: R-03 criteria 1 and 2 ("`supabase/migrations/` is the source of truth", "a gate-passed
> capture exists") are satisfied **in a working tree, not in the repository**. A fresh clone has no
> baseline at all. Committing them is therefore part of M0, not a precondition already met.

| File | sha256 (16) | Committed | CLI sees it as |
|---|---|---|---|
| `BASELINE_current_production_state.reference.sql` | `245c1e973cd6606f` | **NO** | **not a migration** — `.reference.sql` does not match `<14-digit>_<snake_case>.sql` |
| `README.md` | `529a7f73742c370e` | **NO** | not a migration |
| `DEPLOYMENT.md` | `0187070cfeba8a99` | **NO** | not a migration |
| `PRIVATE_LITERALS.md` | `61720a9b472f6aba` | **NO** | not a migration |

**Why they are uncommitted is not an oversight.** Measured contents of the reference capture: **6
`CREATE POLICY` statements, all 6 carrying an inline quoted literal**; 1 `CREATE EVENT TRIGGER`
(`ensure_rls` — present, good); 28 `GRANT` statements (the "52 grants" figure from Phase 1 is the
ACL-expanded entry count). Committing the capture, or any file derived from its policy section, is exactly
what the T2 restriction forbids: *no private policy literal committed merely to make the baseline
executable*. That restriction — not tooling — is what has kept these files out of Git.

Verified locally: `node scripts/db/migration_harness.mjs` reports `files: 4 · migrations: 0`.

The reference file's name is deliberate. An earlier draft was
`20260806143644_baseline_current_production_state.sql.template`, reusing the version string that is
already the ledger's primary key — it would have collided on insert *and* falsely asserted the baseline
**is** that migration.

### 2.3 Toolchain

| Tool | State |
|---|---|
| `supabase` CLI | **2.113.0, installed** (`/opt/homebrew/bin/supabase`) |
| `docker` | **NOT installed** → no local database, so `--local` and `db diff --local` are unavailable |
| `psql` / `pg_dump` / `pg_restore` | 18.4 |

### 2.4 Exact mismatch

| # | Production has | Repo can reproduce | Ledger explains |
|---|---|---|---|
| 1 | 6 `lottery_*` tables, 3 enums, 6 PKs, 17 FKs, 1 unique index | ✅ reference capture | ✅ `20260806143644` |
| 2 | `bolao_state` + PK | ✅ reference capture | ❌ **nothing** |
| 3 | `rls_auto_enable()` + `ensure_rls` event trigger | ✅ reference capture | ❌ **nothing** (finding R-08) |
| 4 | RLS enabled on 7 tables | ✅ reference capture | ❌ **nothing** |
| 5 | 52 grants | ✅ reference capture | ❌ **nothing** (CLI-1) |
| 6 | 6 `bolao_state` policies | ✅ reference capture | ❌ **nothing** (CLI-1, DR-1) |

**Rows 2–6 are the whole of M0.** The gap is not evidence — the capture exists and was reconciled
object-by-object. The gap is that **no migration history accounts for them**, so a fresh environment
cannot be built from the repo, and `db diff` has no baseline to answer "is production what we intended?"

**The captured baseline is a SUPERSET of `20260806143644`.** Replaying both against an empty database
double-creates and fails. This is why M0 is not a one-line insert: it is a decision about what history
*claims*.

---

## 3. Options

Every option's write-surface is stated first, because that is what authorization turns on.

### Option A — manual `INSERT` into `supabase_migrations.schema_migrations`

| Dimension | Consequence |
|---|---|
| Mechanism | hand-written `INSERT` of one or more rows |
| Writes production? | **YES — ledger** |
| Ledger rows changed | 1+ inserted; **PK collision risk** if the existing version is reused |
| Production schema changes | none |
| Repo files change | none required — and that is part of the problem |
| Truthful history? | **NO** |
| Creates synthetic history? | **YES** |
| `migration list` | shows a version as applied remotely; with no matching local file it reports remote-only, permanently confusing |
| `db push` | skips the version, masking that nothing ran |
| Drift detection | **actively harmed** — `statements` hand-written or NULL while the row *appears* tracked |
| CI | a pipeline computing pending migrations trusts a row that never corresponded to an execution |
| Rollback | `DELETE` the row; no supported path |
| Failure mode | PK/unique collision, or silent success with a fabricated record |
| Audit | **worst outcome.** "What applied this schema?" gets a fabricated answer |
| Maintenance | the fabrication is invisible and permanent |

**REJECT — permanently.** It converts an *honest gap* (R-03: provenance missing) into a *dishonest record*
(provenance fabricated). For a system paying out real money and being prepared for external audit, that
trade is strictly negative.

### Option B — `supabase migration repair --status applied <version>` on the existing version only

| Dimension | Consequence |
|---|---|
| Mechanism | vendor command marking a version applied without executing it |
| Writes production? | **YES — ledger** |
| Ledger rows changed | the row for the named version |
| Production schema changes | none |
| Repo files change | none |
| Truthful history? | yes, for what it records |
| Creates synthetic history? | no |
| `migration list` | consistent — built for this reconciliation |
| `db push` | correctly skips the repaired version |
| Drift detection | works forward; does **not** retroactively populate `statements` |
| CI | supported and reproducible |
| Rollback | `--status reverted` |
| Failure mode | repairing the wrong version |
| Audit | honest — a recognised operation with known semantics |
| Maintenance | fine |

**INSUFFICIENT ALONE.** `20260806143644` is already correctly recorded; repairing it changes nothing that
matters. Repair records a *version*; it does not establish a *replayable baseline*. R-03's substance is
"the repo cannot reproduce production." Doing B alone would let the programme **declare** R-03 closed while
the inability remained — the same category of error as a backup with no tested restore.

### Option C — `supabase db pull` baseline adoption

| Dimension | Consequence |
|---|---|
| Mechanism | introspect the remote schema into `<ts>_remote_schema.sql` and record the matching ledger row |
| Writes production? | **YES — ledger** (one row, as a side effect) |
| Ledger rows changed | 1 inserted |
| Production schema changes | none |
| Repo files change | **YES** — a new migration file |
| Truthful history? | yes, and vendor-recognised: "history begins here, here is the introspected proof" |
| Creates synthetic history? | no |
| `migration list` | clean: one baseline local and remote agree on |
| `db push` | later migrations apply on a coherent starting point |
| Drift detection | **best** — `db diff` against a real baseline |
| CI | **best** — a fresh environment builds from the baseline forward |
| Rollback | remove the file; `repair --status reverted` |
| Failure mode | **the superset problem is unresolved.** The pulled baseline includes everything `20260806143644` created, so the repo then contains two artefacts that both create the `lottery_*` tables. Replaying both double-creates |
| Audit | honest |
| Maintenance | one large generated file; the existing genuine row sits *before* a baseline that supersedes it, which is backwards |

**VIABLE BUT INFERIOR to E.** Two further problems: `db pull` writes the six policies **inline, including
the three literals**, into a Git-tracked file — which would breach the T2 restriction automatically, with
no warning; and it is known to **omit the `ensure_rls` event trigger**, the same trap
`pg_dump --schema=public` hit (R-08).

### Option D — leave the ledger historically divergent, document permanently

| Dimension | Consequence |
|---|---|
| Mechanism | do nothing; keep the reference file CLI-invisible |
| Writes production? | **NO** |
| Ledger rows changed | 0 |
| Production schema changes | none |
| Repo files change | none |
| Truthful history? | **yes — completely** |
| Creates synthetic history? | no |
| `migration list` | shows the one real migration. Truthful but incomplete |
| `db push` | unaffected; the reference file is invisible **by design** |
| Drift detection | **unavailable** |
| CI | cannot build a fresh environment from the repo. R-03 stays open |
| Rollback | n/a |
| Failure mode | none technically — the failure is strategic |
| Audit | honest; the gap is documented rather than papered over |
| Maintenance | every day R-03 stays open, the window in which production cannot be reproduced continues |

**CORRECT INTERIM POSTURE — and exactly where the project stands.** Not neutral as a permanent choice.

### Option E — split baseline around the existing row *(fully restated, per instruction)*

Because `migration fetch` recovered **exactly what `20260806143644` did**, the missing history splits into
a **before** and an **after**, neither overlapping it.

**Exact mechanics — three files, one of which already exists:**

| # | File | Contents | Why it cannot collide |
|---|---|---|---|
| 1 | `<earlier_ts>_baseline_adopted_pre_tracking.sql` | `bolao_state` + PK, `rls_auto_enable()`, `ensure_rls` event trigger | none of these appear in `20260806143644`; all predate it |
| 2 | *(exists in the ledger, unchanged)* `20260806143644_add_minimal_powerball_schema.sql` | 6 tables, 3 enums, 6 PKs, 17 FKs, 1 unique index | already recorded **with statements**; recovered locally by `migration fetch`; **not rewritten, not deleted, not repaired** |
| 3 | `<later_ts>_baseline_adopted_grants_and_policies.sql` | RLS enablement on 7 tables, 52 grants, 6 `bolao_state` policies | not in the migration (CLI-1); ordering *after* it is correct because grants follow object creation |

Replaying 1 → 2 → 3 against an empty database reproduces production **exactly, with no double-create**.
That is the definition of reproducibility R-03 requires, achieved **without rewriting or deleting any
existing history**.

File 1's timestamp must be earlier than `20260806143644`. Absent a recoverable `bolao_state` creation
date, a deliberately early sentinel with a header stating it represents "everything predating migration
tracking" is defensible — and the `baseline_adopted` name makes the claim explicit in `migration list`.

| Dimension | Consequence |
|---|---|
| Mechanism | author files 1 and 3 locally; then `migration repair --status applied` for each |
| Writes production? | **YES — ledger only.** Exactly 2 rows inserted |
| Ledger rows changed | 2 inserted (`<earlier_ts>`, `<later_ts>`). The existing row is **untouched** |
| Production schema changes | **none** — repair executes no SQL |
| Production data changes | **none** |
| RLS changes | **none** |
| Repo files change | **YES** — 2 new migration files |
| Truthful history? | **yes, and the distinction is machine-checkable** (§1) |
| Creates synthetic history? | **no.** It records that a baseline was *adopted*, and says so in the filename, the file header and the NULL `statements` |
| `migration list` | three versions, local and remote agreeing; two visibly named `baseline_adopted` |
| `db push` | applies nothing (all three recorded). Future migrations apply cleanly on top |
| `db diff` | becomes meaningful — expected **empty** immediately after adoption; non-empty is drift |
| CI | a fresh environment builds by replaying 1 → 2 → 3 |
| Rollback | `migration repair --status reverted <ts>` for each; delete the two files. Ledger returns to one row |
| Failure mode | `db push` used instead of `repair` would **execute** the files and re-create existing objects. Called out explicitly in the plan and fail-closed on |
| Audit | best available: two rows honestly marked adopted, one row genuinely executed, all three cross-checkable |
| Maintenance | three small purposeful files instead of one large generated blob; the genuine migration keeps its real position in history |

**RECOMMENDED.**

### Option F — refinements discovered while preparing this package

Not a separate strategy; **three additions to E**, each fixing a real weakness:

| # | Refinement | Weakness it fixes |
|---|---|---|
| F1 | **`baseline_adopted` in the filename** | E as previously written left the executed-vs-adopted distinction in a repo document. The ledger's `name` column comes from the filename, so the distinction becomes visible in `migration list` itself |
| F2 | **`-- PROVENANCE:` header in every migration file** | gives a second signal, inside a file whose digest is in the SHA manifest, so the claim is tamper-evident |
| F3 | **`classifyLedgerProvenance()` as a postcheck** | turns "repair leaves `statements` NULL" from a documented weakness into a **verifiable discriminator**, and makes agreement between signals a gate rather than a hope |

| F4 | **split file 3 into 3a (literal-free) and 3b (policies)** | file 3 as originally specified mixes RLS enablement and grants — which contain **no literals** — with the 6 policies, which contain **one literal each**. Bundling them makes the entire file un-committable until the literal decision lands. Splitting isolates the blocker to one small file |

F1–F3 are repo-only, already implemented and tested (10 assertions). **The recommendation is E + F1 + F2 + F3 + F4.**

**F4 in detail, and its honest limit.** The split lets the literal-free majority be authored, reviewed and
committed immediately:

| File | Contents | Literals | Committable now |
|---|---|---|---|
| 3a `<later_ts>_baseline_adopted_rls_and_grants.sql` | RLS enablement on 7 tables + 28 GRANT statements | **none** | **YES** |
| 3b `<later_ts2>_baseline_adopted_policies.sql` | the 6 `bolao_state` policies, captured verbatim | **6, inline** | **NO — blocked** |

**The split isolates the blocker; it does not remove it.** Registration must be atomic: if 3b is not
registered, replaying 1 → 2 → 3a omits the six policies, so `db diff` reports them as missing and
**FC-7 halts the run**. So M0 can be *authored* in two tranches but only *completed* once the literal
question is settled. That question is a live operator decision — see §7.

### Rejected without further analysis

| Approach | Why |
|---|---|
| `supabase db push` for files 1 and 3 | would **execute** them, re-creating existing objects. `db push` is exactly wrong here; `repair` is exactly right |
| `supabase migration squash` | rewrites history into one file, destroying the genuine `20260806143644` provenance |
| `DELETE` the existing row and re-baseline cleanly | deletes real history to make bookkeeping tidier — strictly worse than E on every priority |

---

## 4. Recommendation

**Option E + F1 + F2 + F3 — split baseline around the existing row, with the provenance distinction
carried in the filename, the file header and the ledger's own `statements` column, and gated by
`classifyLedgerProvenance()`.**

Against the stated priorities, in order:

| Priority | Why E+F wins |
|---|---|
| 1 · truthful provenance | the only option where every row's meaning is explicit and machine-checkable. Nothing claims execution that was not executed; the one genuinely executed migration keeps its real position, contents and statements |
| 2 · future tooling compatibility | uses only vendor commands. `migration list`, `db push`, `db diff` and future `repair` all behave as designed |
| 3 · auditability | three signals that must agree, cross-checked by a tested gate. "What applied this schema?" answers: one migration executed on 2026-08-06, and two baselines adopted on <date> describing objects that predate tracking |
| 4 · rollback | two `repair --status reverted` calls plus deleting two files returns the ledger to exactly one row. C's rollback is comparable; A's is a manual `DELETE` |
| 5 · operational simplicity | three small purposeful files. Marginally more work than C up front, much less to explain later |
| 6 · minimum production risk | **2 ledger rows. Zero schema, data and RLS changes.** Repair executes no SQL — identical in blast radius to C, and smaller than any approach involving `db push` |

**Why not C**, which is otherwise close: C leaves the superset problem unresolved, writes the three policy
literals inline into a tracked file (breaching the T2 restriction with no warning), omits the
`ensure_rls` event trigger, and places the genuine migration *before* a baseline that supersedes it —
backwards. E resolves all four.

**Why not D**, which is the most truthful: truthfulness is priority 1 and D satisfies it, but D closes
nothing. E is *equally* truthful — that is the point of F1–F3 — while also making the repo reproducible.

---

## 5. Execution plan (NOT EXECUTED)

Every command is classified. Nothing below has been run.

### 5.1 Prechecks — all `READ_ONLY`

| # | Command / check | Class | Pass condition |
|---|---|---|---|
| PC-1 | `node scripts/db/migration_harness.mjs` | READ_ONLY | `files: 4 · migrations: 0`, `MIGRATION SET OK` |
| PC-2 | `shasum -a 256 supabase/migrations/BASELINE_current_production_state.reference.sql` | READ_ONLY | `245c1e97…` — the reviewed capture, unchanged |
| PC-3 | `supabase --version` | READ_ONLY | `2.113.0` |
| PC-4 | `supabase migration list --db-url "<PROD_DSN>"` | READ_ONLY | remote shows **exactly one** version, `20260806143644` |
| PC-5 | read-only ledger query: `version`, `name`, `statements IS NULL`, row count | READ_ONLY | 1 row; `statements` **NOT** NULL. **Print no statement contents** |
| PC-6 | read-only structure check via `acceptance_checks.mjs` `EXPECTED_STRUCTURE` | READ_ONLY | 7 tables, 3 enums, 1 function, 6 policies, 7 PK, 17 FK, 0 unique constraints, 1 unique index, 8 indexes, 0 user triggers, 7 RLS enabled, 0 forced |
| PC-7 | policy body md5s against `EXPECTED_POLICY_MD5` | READ_ONLY | every hash matches a known generation. **Print hashes only, never expressions** |
| PC-8 | `node scripts/db/restore_rehearsal.mjs` | READ_ONLY | all preflight gates green — a verified backup exists before any ledger write |
| PC-9 | full gate suite (12 suites) | READ_ONLY | 431 assertions, 0 failed |
| PC-10 | B-02 policy-literal decision recorded | READ_ONLY | **eliminate-not-externalize** confirmed; file 3 captures policies faithfully and a *later* migration removes them |

### 5.2 Repo authoring — all `REPO_WRITE`, no production contact

| # | Action | Class |
|---|---|---|
| RW-1 | author `<earlier_ts>_baseline_adopted_pre_tracking.sql` from the reference capture: `bolao_state` + PK, `rls_auto_enable()`, `ensure_rls` event trigger. First line `-- PROVENANCE: BASELINE_ADOPTED_AT_CURRENT_STATE` | REPO_WRITE |
| RW-2a | author `<later_ts>_baseline_adopted_rls_and_grants.sql`: RLS enablement on 7 tables + 28 GRANT statements. Same header. **Contains no literals — committable immediately** | REPO_WRITE |
| RW-2b | author `<later_ts2>_baseline_adopted_policies.sql`: the 6 policies captured **as they are**, literals inline, never "improved" — improving them inside a baseline makes the later drift untraceable. **Blocked on T2-LITERAL** | REPO_WRITE (blocked) |
| RW-2c | commit the four existing `supabase/migrations/` files, which have never been committed (§2.2). The reference capture itself carries the 6 inline literals, so it is **also blocked on T2-LITERAL** | REPO_WRITE (blocked) |
| RW-3 | `node scripts/db/migration_harness.mjs` → expect `migrations: 2`, 0 errors, no duplicate version, ordering correct | READ_ONLY |
| RW-4 | `grep -c 'CREATE EVENT TRIGGER' <file 1>` → expect `1`. **The single most likely silent gap** (R-08) | READ_ONLY |
| RW-5 | commit both files with the digests recorded in the SHA manifest | REPO_WRITE |

### 5.3 Pre-write verification — `READ_ONLY`

| # | Command | Class | Pass condition |
|---|---|---|---|
| V-1 | `supabase migration list --db-url "<PROD_DSN>"` | READ_ONLY | the two new versions show **pending** (local, not remote); `20260806143644` shows both |
| V-2 | `supabase db diff --db-url "<PROD_DSN>" --schema public` | READ_ONLY | **empty.** Non-empty here means files 1+2+3 do not describe production — **STOP** |

### 5.4 The only production writes

| # | Command | Class | Effect |
|---|---|---|---|
| W-1 | `supabase migration repair --status applied <earlier_ts> --db-url "<PROD_DSN>"` | **PRODUCTION_LEDGER_WRITE** | inserts 1 row, `statements` NULL. Executes no SQL |
| W-2 | `supabase migration repair --status applied <later_ts> --db-url "<PROD_DSN>"` | **PRODUCTION_LEDGER_WRITE** | inserts 1 row, `statements` NULL. Executes no SQL |

**`PRODUCTION_SCHEMA_WRITE`: none. `PRODUCTION_DATA_WRITE`: none.**

> **`supabase db push` MUST NOT be used.** It would **execute** files 1 and 3 against production and
> re-create objects that already exist. This is the primary failure mode of the whole plan.

Expected output per call: confirmation that the version was repaired. Expected ledger after both:
**3 rows** — one with `statements` present, two with `statements` NULL.

### 5.5 Postchecks — all `READ_ONLY`

| # | Check | Pass condition |
|---|---|---|
| PO-1 | `supabase migration list --db-url "<PROD_DSN>"` | 3 versions, local and remote agreeing on all three |
| PO-2 | `supabase db diff --db-url "<PROD_DSN>" --schema public` | **empty.** Non-empty = the baseline does not describe production — **stop condition, not a warning** |
| PO-3 | read-only ledger snapshot → `classifyLedgerProvenance()` | `CONSISTENT`; `adopted = [<earlier_ts>, <later_ts>]`; `executed = ["20260806143644"]` |
| PO-4 | `acceptance_checks.mjs` `EXPECTED_STRUCTURE` re-run | **byte-identical to PC-6.** Any change means the "ledger-only" claim was false |
| PO-5 | policy md5s re-run | identical to PC-7 |
| PO-6 | three `audit_scoring.py` suites | all PASS — scoring is untouched by construction, and confirmed |
| PO-7 | `node scripts/db/consistency_check.mjs` | 0 errors |

### 5.6 Rollback plan

| # | Step | Class |
|---|---|---|
| RB-1 | `supabase migration repair --status reverted <later_ts> --db-url "<PROD_DSN>"` | **PRODUCTION_LEDGER_WRITE** |
| RB-2 | `supabase migration repair --status reverted <earlier_ts> --db-url "<PROD_DSN>"` | **PRODUCTION_LEDGER_WRITE** |
| RB-3 | `git revert` the commit adding the two files | REPO_WRITE |
| RB-4 | `supabase migration list` → expect **exactly one** remote version, `20260806143644` | READ_ONLY |
| RB-5 | `acceptance_checks.mjs` → identical to PC-6 | READ_ONLY |

Reverse order deliberately: revert the later version first, so the ledger is never in a state where a
baseline claiming to precede a migration outlives the one claiming to follow it.

**No backup restore is required to roll back**, because no schema or data changed. That is the strongest
practical argument for E over anything touching schema.

### 5.7 Fail-closed conditions — STOP, do not continue, do not improvise

| # | Condition | Why it is fatal |
|---|---|---|
| FC-1 | PC-4/PC-5 shows anything other than exactly one row, version `20260806143644` | the ledger is not what this plan was written against |
| FC-2 | PC-5 shows `statements` **NULL** for `20260806143644` | that row would then be adopted-not-executed, contradicting recorded evidence; the whole option analysis needs redoing |
| FC-3 | PC-6 structural counts differ from `EXPECTED_STRUCTURE` | production drifted since Phase 1; the baseline files no longer describe it |
| FC-4 | PC-7 shows a policy hash matching no known generation | policies changed; file 3 would capture something unreviewed |
| FC-5 | PC-8 preflight gates not green | no verified backup — never write a ledger without one, even a schema-neutral write |
| FC-6 | RW-4 finds no `CREATE EVENT TRIGGER` | `ensure_rls` omitted; replay would not reproduce production (R-08) |
| FC-7 | V-2 or PO-2 `db diff` non-empty | the baseline does not describe production. **Non-empty diff is a stop condition, never a warning** |
| FC-8 | PO-3 provenance `INCONSISTENT` | a row's claimed provenance disagrees with the ledger — the exact falsehood the principle forbids |
| FC-9 | PO-4/PO-5 differ from PC-6/PC-7 | something other than the ledger changed; the "ledger-only" claim was false. Roll back immediately |
| FC-10 | any `db push`, `db reset`, `migration squash` or manual `INSERT`/`UPDATE`/`DELETE` on the ledger is proposed mid-execution | outside this plan; requires fresh authorization |
| FC-11 | a `repair` call errors or its effect is ambiguous | **do not retry blindly.** Re-run PC-5 read-only and establish actual state first |

---

## 6. Why M0 blocks M1–M10

M1–M10 introduce tables and backfill them. **None is technically prevented by an unregistered baseline** —
`CREATE TABLE bolao.participants` would succeed today. The block is not mechanical, it is about
verifiability, and it takes three forms:

1. **No reproducible starting point.** Without a baseline, M1's migration applies to a database whose
   prior state no history describes. A fresh environment cannot be built, so M1–M10 cannot be *rehearsed*
   before being applied — and an unrehearsed backfill of money data is not acceptable.
2. **No drift detection.** `db diff` needs a baseline. Without it, Workstream O's `prePostValidate` has no
   authoritative "before", so the UNACCOUNTED-change check — the control that exists precisely because
   production acquired 52 grants and 6 policies nobody recorded — cannot run.
3. **No ordering anchor.** M1's timestamp must sort after the baseline. Choosing it before M0 is decided
   risks a version that sorts *before* a baseline registered later, which inverts history.

| Phase | `BLOCKED_NOW` | What M0 completion enables | What remains blocked after M0 |
|---|---|---|---|
| **M1** schema + reference entities | **YES** | authoring `<ts>_create_bolao_schema.sql` on a known baseline; `db diff` verifies it applied as intended | nothing — M1 becomes executable |
| **M2** identity tables | **YES** (ordering only) | timestamp ordering anchored behind M1 | nothing |
| **M3** pools + entries | **YES** (ordering only) | as M2 | nothing |
| **M4** audit + outbox infrastructure | **YES** (ordering only) | as M2 | nothing |
| **M5** identity backfill, zero merges | **YES** | backfill can be rehearsed against a rebuilt environment | **B-07 scratch project** — a rehearsal needs somewhere to rehearse |
| **M6** financial tables | **YES** (ordering only) | as M2 | nothing |
| **M7** competition fact tables | **YES** (ordering only) | as M2 | nothing |
| **M8** backfill entries | **YES** | rehearsable; `prePostValidate` gains a real "before" | **B-07** |
| **M9** backfill payments (asserted only) | **YES** | as M8 | **B-07**; plus **UNKNOWN-1** (legacy third-party payer identities) remains a *data* unknown that no migration resolves |
| **M10** backfill results, audit, sync | **YES** | as M8 | **B-07** |

**After M0, six of the ten phases are fully unblocked** (M1, M2, M3, M4, M6, M7 — all pure additive DDL).
The four backfills (M5, M8, M9, M10) become *authorable and reviewable* but should not be *applied* until
B-07 provides somewhere to rehearse them. M11 onward additionally needs R-GAP-1 (operator identity) and
L-OP-2 (client floor), which are outside M0's scope.

---

## 7. Other open decisions

| Id | Decision | Class |
|---|---|---|
| **M0 approval** | approve E+F1+F2+F3 and authorize W-1/W-2 | **CRITICAL_PATH** |
| **B-02** policy literals: eliminate vs externalize | **decided: ELIMINATE** — but that is the *target state*, reached by a later migration. It does **not** authorise committing the literals in the baseline. File 3b captures the 6 policies verbatim, literals inline, because a baseline must describe production as it is | **CRITICAL_PATH** |
| **T2-LITERAL** commit the 6 policy literals in file 3b? | The T2 restriction forbids committing a private policy literal merely to make the baseline executable. Evidence for lifting it: all three literals are classified `IDENTIFIER` + `LEGACY_AUTHORIZATION_LITERAL`, none is `SECRET`/PII/a payment reference, and they already appear in **83–129 tracked files** — therefore in shipped client JavaScript and public URLs. Lifting the restriction changes no exposure that does not already exist. The alternative (capture policies by md5 reference only) makes the baseline unreplayable, defeating its purpose | **CRITICAL_PATH — this is now the true M0 blocker, ahead of the two repair calls** |
| **B-07** disposable scratch project | provision, or accept that backfills and restore stay unrehearsed | **PRE-MIGRATION** — blocks M5/M8/M9/M10 rehearsal and DR tests Y-5..Y-13, Y-16 |
| **backup key custody** | confirm the private key is held outside the repo and outside archive storage, and who the second recipient is | **PRE-MIGRATION** — FC-5 requires a verified backup before any ledger write |
| **R-GAP-1** no database-verifiable operator identity | adopt Supabase Auth for operators, or accept that operator authority lives in the server runtime and document it | **PRE-CUTOVER** — every "operator" permission is really "service acting for an operator" until resolved; blocks M11 |
| **Q-OP-1** adopt `age`? | tooling dependency + recipient keypair | **PRE-MIGRATION** (FC-5 depends on a verified backup, not on v2 specifically) |
| **Q-OP-2** second recipient key holder | a single-recipient archive is unrecoverable if that key is lost | **PRE-MIGRATION** |
| **Q-OP-3** archive storage separate from key storage | co-locating them makes the encryption decorative | **PRE-MIGRATION** |
| **Q-OP-4** confirm retention classes against real legal/tax requirements | the table is engineering judgement, not legal advice | **OPTIONAL/FUTURE** |
| **L-OP-1** freeze-window scheduling | must not overlap a prediction cutoff — a freeze then denies entries and affects who can play | **PRE-CUTOVER** (M13) |
| **L-OP-2** soft or hard client floor | a hard floor is a prerequisite for any contract step | **PRE-CUTOVER** (M16/step 11) |
| **L-OP-3** how many consecutive clean parity runs count as evidence | sets the M12 exit criterion | **PRE-CUTOVER** |
| **C-OP-1** who may confirm merges; second approver for prize-affecting merges? | governs M17 | **POST-MIGRATION** |
| **C-OP-2** retention for reversed link rows | design says indefinite; confirm against 5-year financial retention | **POST-MIGRATION** |
| **Y-OP-1** provision scratch for DR tests | same dependency as B-07 | **PRE-MIGRATION** |
| **Y-OP-2** who runs the quarterly DR cycle, and where evidence lives | an unowned recurring test stops recurring | **POST-MIGRATION** |
| **Y-OP-3** is there an RPO/RTO the platform actually needs? | measurement produces numbers; only an operator says whether they suffice | **OPTIONAL/FUTURE** |
| **UNKNOWN-1** legacy third-party payer identities | unresolvable from data; per-payer operator input | **POST-MIGRATION** (M17) |

**Three are on the critical path: T2-LITERAL (the real blocker), B-02 confirmation, and M0 approval.**
T2-LITERAL comes first: without it, neither the reference capture nor file 3b can enter Git, and M0 cannot
be completed no matter how the ledger question is decided.
