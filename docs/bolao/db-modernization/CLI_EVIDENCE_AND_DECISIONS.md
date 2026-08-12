# CLI_EVIDENCE_AND_DECISIONS — T3 conclusion, B-02 and B-08 decision support

**STATUS:** T3 recommendation **CONCLUSIVE** (evidence-backed, not inferred). B-02 and B-08 decision
support **COMPLETE**. **Zero production writes.** Ledger verified unchanged before and after every
command: `rows=1, version=20260806143644` throughout.
**EVIDENCE BASIS:** Supabase CLI **2.113.0** installed locally (B-01); `supabase migration fetch
--db-url` executed **read-only** against production, recovering the applied migration's real SQL
(4 404 bytes); `supabase db advisors --type security` executed read-only; repository and git-history
inspection for fee evidence; DR-1 classification for the policy literals.
**KNOWN GAPS:** no scratch Supabase project exists (B-07 blocked on means — see §1), so
`db push`/`db diff`/`migration repair` behaviour was **not** exercised against a live target. Their
semantics below come from the CLI's own documented flags, now verified present, plus the `migration
fetch` result — not from execution.
**ASSUMPTIONS:** none material; every claim cites a command or a file.

---

## 1. B-07 — authorized but BLOCKED ON MEANS, not permission

```
$ supabase projects list
LegacyPlatformAuthRequiredError: Access token not provided. Supply an access token by running
`supabase login` or setting the SUPABASE_ACCESS_TOKEN environment variable.
```

Creating a project requires a **personal access token**, which is a credential only the operator can
mint (dashboard → Account → Access Tokens). `supabase login` is interactive and would use the
operator's own account. **I will not obtain or handle that credential**, so scratch-project creation
cannot proceed in this session.

Two alternative local targets were checked and both are unavailable:

| Alternative | Status |
|---|---|
| `supabase start` (local Supabase stack) | ❌ requires Docker — not installed |
| Local PostgreSQL server | ❌ only libpq **client** tools present; no `postgres` server binary |

**Exact operator action to unblock:** either export `SUPABASE_ACCESS_TOKEN=<token>` into this session,
or create the scratch project manually and supply its pooler DSN. The rehearsal automation is
complete and tested (16/16 guard tests) and will run unchanged once a target exists.

---

## 2. T3 — CONCLUSIVE: the answer is (E), and it is provable

### 2.1 The decisive new evidence

`supabase migration fetch` materialised the **actual SQL recorded in the ledger's `statements`
column**. This settles what migration `20260806143644` really did:

| Object class | In the applied migration | In production | Accounted for? |
|---|---|---|---|
| `lottery_*` tables | **6** | 6 | ✅ |
| Enum types | **3** | 3 | ✅ |
| Primary keys | **6** | 7 | ⚠️ 6 of 7 (the 7th is `bolao_state`) |
| Foreign keys | **17** (inline `REFERENCES`: 11 → `auth.users`, 6 → `lottery_*`) | 17 | ✅ |
| Unique index | **1** | 1 | ✅ |
| **`ENABLE ROW LEVEL SECURITY`** | **0** | **7 tables** | ❌ **NOT from this migration** |
| **`GRANT`** | **0** | **52** | ❌ **NOT from this migration** |
| **Policies** | **0** | **6** | ❌ **NOT from this migration** |
| `bolao_state` | **0** | 1 table | ❌ predates it |
| `rls_auto_enable()` / `ensure_rls` | **0** | both exist | ❌ predates it |

> **This empirically confirms finding R-08.** The migration contains **zero** RLS statements, yet all
> seven tables have RLS enabled. The only mechanism that could have done that is the undeclared
> `postgres`-owned event trigger `ensure_rls`, firing on `ddl_command_end`. R-08 was previously an
> inference from ownership and timing; it is now demonstrated by the absence of the statement that
> would otherwise be responsible.

> **New finding CLI-1 — the 52 grants and 6 policies have no recorded provenance at all.** They are in
> neither the applied migration nor any versioned file. They were applied out-of-band (most likely the
> Supabase `GRANT ALL ON ALL TABLES IN SCHEMA public` template plus manual policy creation). Any
> baseline must capture them explicitly or a rebuilt environment will have RLS on, zero policies, and
> no grants — i.e. a database nothing can read.

### 2.2 Why each option is now decidable

| Option | Verdict, with evidence |
|---|---|
| **A — manual ledger insert** | **REJECT, permanently.** The existing row already carries populated `statements` (proved: `migration fetch` reconstructed 4 404 bytes of real SQL from it). Hand-writing a row would produce the one row in the table whose `statements` is fabricated — directly undermining the drift detection the column exists for. |
| **B — `migration repair`** | **NOT NEEDED for the existing row.** Repair marks a version applied *without* statements. The existing row is already correctly recorded *with* statements, so repair would be a downgrade. Keep in reserve only if a future hand-applied change must be acknowledged. |
| **C — `db pull` single flat baseline** | **REJECT.** It would emit one superset file describing all of production, which **overlaps** the existing row's 6 tables + 3 enums + 17 FKs. Replaying both against an empty database double-creates. `CREATE TABLE IF NOT EXISTS` would mask that for tables, but `CREATE TYPE` has no `IF NOT EXISTS` and would fail — so the collision is real, not theoretical. |
| **D — documented permanent divergence** | Acceptable only as the interim posture, which is where the project stands today. Leaves R-03 open. |
| **E — split baseline around the existing row** | ✅ **RECOMMENDED.** See §2.3. |

### 2.3 Option E — the recommended strategy

Because we now know *exactly* what the recorded migration did, the missing history splits cleanly into
a **before** and an **after**, and neither overlaps it:

| # | File (proposed) | Contents | Why it cannot collide |
|---|---|---|---|
| 1 | `<earlier_ts>_pre_baseline_bolao_state.sql` | `bolao_state` table + PK, `rls_auto_enable()`, `ensure_rls` event trigger | None of these appear in `20260806143644`; all predate it |
| 2 | *(existing, already in the ledger)* `20260806143644_add_minimal_powerball_schema.sql` | 6 tables, 3 enums, 6 PKs, 17 FKs, 1 unique index | Already recorded **with statements**; recovered locally by `migration fetch`; **do not rewrite it** |
| 3 | `<later_ts>_baseline_grants_and_policies.sql` | 52 grants + 6 `bolao_state` policies + explicit RLS enablement | Not in the migration (CLI-1); ordering after it is correct because grants follow object creation |

Replaying 1 → 2 → 3 against an empty database reproduces production **exactly, with no double-create**.
That is the definition of reproducibility R-03 requires, and it is achieved *without* rewriting or
deleting any existing history.

**Timestamp for file 1 must be earlier than `20260806143644`.** A defensible choice is the
`bolao_state` table's creation date if recoverable, otherwise a deliberately early sentinel with a
header stating it represents "everything that predates migration tracking."

### 2.4 Exact future command sequence (⚠ = production write, NOT authorized)

```
# P1 — local only, already done
supabase --version                                   # 2.113.0 ✅

# P2 — recover what is already recorded (READ-ONLY, already done, ledger unchanged)
supabase migration fetch --db-url "<PROD_DSN>"       # ✅ executed; ledger verified unchanged

# P3 — author files 1 and 3 from the captured baseline (local, no production contact)
#      Resolve the policy-literal decision FIRST (see §3) because file 3 contains the policies.

# P4 — verify locally before any production contact
supabase migration list --db-url "<PROD_DSN>"        # read-only: confirm 1 and 3 show as pending
supabase db diff --db-url "<PROD_DSN>" --schema public   # read-only: expect EMPTY once 1+3 exist

# P5 — ⚠ acknowledge files 1 and 3 as already applied (they describe existing objects)
supabase migration repair --status applied <ts_of_file_1>   # ⚠ ledger write
supabase migration repair --status applied <ts_of_file_3>   # ⚠ ledger write
# NOTE: `db push` must NOT be used here — it would EXECUTE the files against production,
# re-creating objects that already exist. Repair records them as applied without executing.
```

**This is where Option B legitimately returns**: not for the existing row, but for the two *new* files
that describe already-existing objects. Repair is exactly right for that, and `db push` would be
exactly wrong.

### 2.5 R-03 closure criteria — updated

| # | Criterion | Status |
|---|---|---|
| 1 | `supabase/migrations/` is the source of truth | ✅ T1 |
| 2 | Gate-passed capture, reconciled object-by-object | ✅ T2 |
| 3 | The recorded migration's real content is known | ✅ **NEW — `migration fetch`** |
| 4 | Pre/post baseline files authored | ⬜ P3 (repo-only; blocked on §3) |
| 5 | Ledger ↔ repo parity via `migration repair` | ⬜ P5 (⚠ needs authorization) |
| 6 | `db diff` empty after adoption | ⬜ P4 |

**R03_STATUS = SUBSTANTIALLY_ADVANCED.** The strategy is now proven rather than chosen, and the
remaining work is two authored files plus two authorized `repair` calls.

---

## 3. B-02 — policy literal classification and redesign

Classification method and results are in `supabase/migrations/PRIVATE_LITERALS.md`; **no literal value
appears anywhere**. Restated with the redesign decision:

| Literal | sha256(12) | Len | Entropy | In private lists | Occurrences in tracked repo | Classification |
|---|---|---|---|---|---|---|
| 1 | `0d6e4079e367` | 4 | 2.00 b/char | NO | **129 files** | `IDENTIFIER` + `LEGACY_AUTHORIZATION_LITERAL` |
| 2 | `3c67c734e8fe` | 6 | 2.25 | NO | **83 files** | same |
| 3 | `2ccfb861d34b` | 7 | 2.52 | NO | **117 files** | same |

None is `SECRET`, `BUSINESS_LITERAL`, PII, or a payment reference. All three are **already public** —
they appear in 83–129 tracked files and therefore in shipped client JavaScript and public URLs.

### 3.1 Redesign decision: **ELIMINATE**, do not externalize

| Option | Verdict |
|---|---|
| Replace with `auth.uid()` / `auth.role()` / `auth.jwt()` logic | ✅ **This is the target.** DR-1 proved all six policies reference **no** caller attribute — they compare `id` against literals, so they scope *rows*, not *principals*. Real authorization requires a caller identity the policies currently never consult. |
| **Eliminate** the literals entirely | ✅ **RECOMMENDED.** Under E1 the base tables leave `public` (removing PostgREST reachability) and under E3 writes go through Edge Functions. The row-allowlist then has no successor and the literals have nothing to parameterise. |
| Externalize to config/GUC | ❌ Over-engineering for three public identifiers, and it adds a runtime lookup to a predicate evaluated per row. |
| Keep as configuration | ❌ Keeps a non-authorizing check looking like authorization. |
| Retain temporarily for compatibility | ⚠️ **Yes, but only until E3 lands.** The row-allowlist is worth keeping as defence-in-depth *beneath* real authorization — never as a substitute. |

**Consequence for T3:** because file 3 of §2.3 contains the six policies, and because the target
eliminates them, there is a real choice — capture them faithfully in the baseline (correct: a baseline
describes production as it is) and then *remove* them in a later migration. **Do not "improve" them
inside the baseline**; that would make the drift untraceable.

---

## 4. B-08 — entry-fee evidence table

**The fee is NOT unknown.** Repository evidence, with git-history verification:

| Pool / app | Fee evidence | Source | Classification |
|---|---|---|---|
| copa2026 | `entryFee: 5` | `bolao/copa2026/js/config.js` | **AUTHORITATIVE** (versioned config) |
| br2026 | `entryFee: 5` | `bolao/br2026/js/config.js` | **AUTHORITATIVE** |
| cdb2026 | `entryFee: 5` | `bolao/cdb2026/js/config.js` | **AUTHORITATIVE** |
| Powerball | per-**cota** model, `US$20` per cota; `cotas: 1` per participation | `powerball/js/data.js` prose + per-entry `cotas` | **PROBABLE** — the amount is prose, not a constant |
| Prize split (all three football pools) | `prizes: { first: 0.70, second: 0.20, third: 0.10 }` | all three `config.js` | **AUTHORITATIVE** |

**Historical change check:** `entryFee` was traced across up to 40 historical revisions of each
`config.js`. **Exactly one distinct value (`5`) in every app's entire history** — the fee has never
changed. That materially simplifies the model: `pool_fee_schedule` is still the right structure (it
must support future re-pricing), but the backfill needs exactly **one** row per football pool.

### 4.1 What remains genuinely UNKNOWN

| # | Unknown | Why it matters | Classification |
|---|---|---|---|
| U1 | **Currency unit of `entryFee: 5`** — no `currency`/`symbol` key sits beside it | R$5 and US$5 differ by ~5×; settlement arithmetic is wrong if guessed | **RESOLVED — USD**, KPLUS-OP-1 (2026-08-10). Tier-1 evidence: `config.js` `entryFee` + the rules text + the pot computation, agreeing across `copa2026`, `br2026` and `cdb2026`. **Scope-limited to those three pools**: a historical pool with no ratified fee still stays UNKNOWN and the backfill refuses it (`RATIFIED_FEES` / `UnknownFee`). |
| U2 | Powerball cota amount is **prose, not a constant** (`US$20` in a comment) | A fee that lives in a comment cannot be validated | **PROBABLE**, needs confirmation |
| U3 | Powerball per-draw variation — data shows `US$2/3/8/16/168` amounts | These look like *payment* amounts (multiple cotas, adjustments), not fee changes | **HISTORICAL**, needs interpretation |
| U4 | Whether any participant ever paid a non-standard amount | Determines whether `OVERPAID`/`PARTIALLY_PAID` occur in history | **UNKNOWN** |

### 4.2 Normalization rule (proposed)

```
pool_fee_schedule: one row per pool
  fee_amount        := 5                     -- football pools, from versioned config
  currency          := 'USD'                 -- U1 RESOLVED (KPLUS-OP-1, 2026-08-10), for the three current pools ONLY
  effective_from    := pool creation date
  effective_to      := NULL (never re-priced; verified across history)
  source            := 'versioned_config'    -- provenance of the value
  confidence        := 'AUTHORITATIVE'
```
Powerball uses `fee_amount := 20 per cota` with `confidence := 'PROBABLE'` until U2 is confirmed.

**Unknown fees stay UNKNOWN.** `currency` is `NOT NULL` **with no default**, so a backfill physically
cannot proceed without a currency. That is deliberate: a defaulted currency would silently produce wrong
money. U1 is now answered (USD) for the three current pools and **only** those three — the resolution is
enumerated by pool id in `RATIFIED_FEES`, and a pool that is not in it raises `UnknownFee` rather than
inheriting USD. Resolving the question did not turn the rule off. `pool_entries.expected_fee_amount` is likewise `NOT NULL` — an entry whose fee
cannot be established cannot be created, forcing the gap into the open rather than into the arithmetic.

### 4.3 Settlement once fee evidence exists
Unchanged from `TARGET_DATA_MODEL.md` §3.4a: `UNPAID` / `PARTIALLY_PAID` / `SETTLED` / `OVERPAID`
derived from `SUM(allocated) vs expected_fee_amount`, plus `LEGACY_ASSERTED` for legacy `paid=true`
rows with no recoverable amount (`BOLAO_STATE_DECOMPOSITION.md` D-1).

**B-08 is UNBLOCKED.** It was a one-question blocker (U1: currency); KPLUS-OP-1 (2026-08-10) answered it as USD on
Tier-1 evidence, and the money spine has since been loaded on real data for the three current pools
(Workstream B, 29/29). What remains blocking on the financial side is KPLUS-OP-4, which is a different
question — see `OPERATOR_INBOX.md` — not U1.

---

## 5. Vendor security advisor — cross-check, and a caution

```
$ supabase db advisors --db-url "<PROD_DSN>" --type security
No issues found
```

**Supabase's own security advisor gives production a clean bill of health.** That is worth recording
precisely because this programme's Phase 1 found, on the same database:

- `anon` holding `SELECT/INSERT/UPDATE/DELETE` on all 7 tables, exercisable (`PUBLIC` has schema `USAGE`);
- six policies on the money-bearing table that reference **no** caller identity (DR-1);
- authorization living in browser JavaScript rather than in the database (G-04).

**Finding CLI-2 — a passing vendor advisor is not evidence of a safe access model.** The advisor's
headline security rule is "is RLS enabled on exposed tables", and here it is — on all seven. RLS
enabled with *zero policies* (six tables) or with *non-identity-based* policies (one table) satisfies
that rule while leaving the exposure intact. This is the same false-comfort shape recorded four times
already in this programme: **the check was honest about a narrower question than the reader assumes.**
Do not cite "advisors: no issues" as security assurance.

---

## 6. RISKS

- **§2.3 file 3 must capture grants and policies as they are, defects included.** The temptation to fix
  the wide `anon` grants inside the baseline would make the remediation untraceable and would mean the
  baseline no longer describes production.
- **`db push` is the dangerous command here**, not `repair`. Pushing files 1 and 3 would execute them
  against production and attempt to recreate existing objects. §2.4 uses `repair` deliberately.
- ~~**U1 (currency) blocks all settlement backfill** and must not be guessed.~~ **RESOLVED as USD** by KPLUS-OP-1 (2026-08-10),
  scope-limited to the three current pools; any other pool still refuses rather than defaulting.
- `migration fetch` wrote into a temporary workdir, not the repository. The recovered file is
  **evidence**, not yet a committed migration.

## 7. NEXT DECISION (operator)

1. **`SUPABASE_ACCESS_TOKEN` or a scratch DSN** — the only thing between the tested automation and a
   proven restore (B-07).
2. ~~**U1: what currency is `entryFee: 5`?**~~ **Answered: USD** (KPLUS-OP-1, 2026-08-10), for `main`, `br2026` and
   `cdb2026` only. Settlement work proceeded on that basis.
3. **Approve Option E** (split baseline around the existing row) as the R-03 strategy.
4. **Confirm the policies are captured-then-removed**, not improved inside the baseline (B-02).
5. Authorize the two `migration repair` calls in §2.4 P5 when files 1 and 3 are ready.
