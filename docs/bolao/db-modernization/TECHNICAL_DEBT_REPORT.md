# TECHNICAL_DEBT_REPORT — repository audit

**STATUS:** COMPLETE for the data/persistence surface. **Nothing was deleted or modified.**
**EVIDENCE BASIS:** 1 037 files scanned across 6 local repositories; `git ls-files` for tracked
status; file hashes for divergence; `git grep` for marker comments; Phase 1/1B catalog evidence for
"declared vs. exists".
**KNOWN GAPS:** runtime coverage was not measured, so "unused" below means *no static reference
found*, never *proven dead*. Frontend/CSS debt is out of scope (covered by
`docs/bolao/CONSISTENCY_MATRIX.md`).
**ASSUMPTIONS:** none — every row cites a path.

> Cross-references: `DATABASE_RECONCILIATION.md` (declared-vs-exists), `JSON_CLASSIFICATION.md`
> (JSON parsing duplication), `DEPENDENCY_GRAPH.md` DG-01/DG-02′/DG-03/DG-04.

---

## 1. What is NOT debt (stated first, deliberately)

An audit that only lists problems mis-prices the codebase. These were checked and are clean:

| Checked | Result |
|---|---|
| `TODO` / `FIXME` / `XXX` / `HACK` / `DEPRECATED` in tracked code | **0 occurrences** across all `*.js`, `*.mjs`, `*.py`, `*.sql`. The `CLAUDE.md` standing rule is being honoured. |
| 4 × `audit_scoring.py` (copa/br/cdb/powerball), all different hashes | **NOT duplication.** Repo governance explicitly forbids generalising tournament logic. These are correctly `INTENTIONALLY_DIFFERENT`. |
| Invalid indexes in production | 0 (`S06`) |
| Orphaned sequences | 0 — both owned (`S08`) |
| Production objects requiring drop | 0 (`DATABASE_RECONCILIATION.md` §3.5) |
| Empty `catch` blocks without explanatory comment | none found on the persistence path; the `try/catch` around `localStorage` is deliberately commented (`app.js` ~2621) |

## 2. Debt register

Classification: **ACTIVE** (in use, still debt) · **PROBABLY_ACTIVE** · **LEGACY** (superseded,
still present) · **ORPHAN_CANDIDATE** (no reference found) · **OBSOLETE** (cannot function) ·
**UNKNOWN**.

### 2.1 P0 — blocks the modernization programme

| # | Debt | Evidence path | Class | Why P0 |
|---|---|---|---|---|
| T-01 | **`bolao_state` has no versioned DDL** | production only; prose in `docs/bolao/PROJECT_MEMORY.md` | ACTIVE | The money-bearing table cannot be recreated from the repo. `DATABASE_RECONCILIATION.md` R-07. |
| T-02 | **`rls_auto_enable()` + `ensure_rls` event trigger unversioned** | production only | ACTIVE | Undeclared SECURITY DEFINER firing on all DDL; will make every future migration behave surprisingly. R-08. |
| T-03 | **Migration ledger ↔ repo mapping is broken** | 1 applied (`20260806143644`) vs. 6 declared files, 0 matched | ACTIVE | Any migration designed on `001_schema.sql` targets a schema that does not exist. R-03. |
| T-04 | **Two competing database models in one schema** | `bolao_state` (document) vs. `lottery_*` ×6 (relational), zero FKs between them | ACTIVE | Two persistence paradigms, two audit implementations, two payment concepts. Target model must reconcile them. |
| T-05 | **`auditLog` truncated to 200 entries on every write** | `bolao/cdb2026/js/app.js:671` (and copa/br equivalents) | ACTIVE | Actively destroying audit history *now*. Cheapest possible fix; cost grows daily. `JSON_CLASSIFICATION.md` J-04. |

### 2.2 P1 — high cost if deferred

| # | Debt | Evidence path | Class | Note |
|---|---|---|---|---|
| T-06 | **Duplicate `supabase_setup.sql`, already diverged** | `bolao/loterias/powerball/scripts/supabase_setup.sql` (200 ln) vs. same path in `ferrarilabs-visual-framework-powerball-admin` (194 ln); 38 differing lines, different SHA; DDL object *sets* identical | LEGACY | Split-brain has begun. Neither copy is marked canonical. R-02. |
| T-07 | **5 declared tables that exist nowhere** (`users`, `user_bolao_participation`, `email_log`, `bolao_types`, `audit_log`) | `…/scripts/supabase_setup.sql` | **OBSOLETE** | Superseded by the `lottery_*` model. Critically, this is the **only** SQL in the *deployed* repo, making that repo actively misleading. Tombstone, do not silently delete. |
| T-08 | **DDL lives on an unmerged branch of a different repo** | `ferrarilabs-visual-framework-powerball-admin` @ `powerball-admin-supabase-audit` | ACTIVE | An auditor reading the deployed repo cannot derive the production schema. R-01. |
| T-09 | **19 `admin_*` RPCs + 13 policies + 3 audit triggers declared, never applied** | `migrations/002_rls.sql`, `003_rpcs.sql`, `004_*.sql` | LEGACY / roadmap | The documented write path does not exist in the DB. Decide: apply, or retire the declaration. R-05. |
| T-10 | **Audit hash chain declared but unenforced** | `lottery_admin_audit` has `entry_hash NOT NULL`; triggers absent | ACTIVE | Schema advertises tamper-evidence it does not have. **Worse than no audit table.** R-04. |
| T-11 | **`paid` boolean is the entire payment model** | `emptyState()` in all 3 apps | ACTIVE | No amount, date, reference, or actor — while `lottery_payment_transactions` models all of it correctly. The JSON model is the regression. J-03. |
| T-12 | **Outbox is a Git-tracked JSON file with real emails** | `bolao/loterias/powerball/scripts/email/outbox.json` (38 email matches) | ACTIVE | Queue + delivery log + versioned artefact in one file. DG-03. |
| T-13 | **No restore path exists** | `backup_daily.py`, `backup.py`, `backup_watch_m88.py` produce `bolao/backups/backup-*.json`; **no script consumes them** | ACTIVE | Backups are untested assertions. DG-01. |
| T-14 | **Real participant PII in tracked fixtures/tests** | `…/fixtures/powerball-email-test-fixture.json`, `bolao/cdb2026/scripts/fixtures/golden_state.json`, `bolao/shared/scripts/test_notification_*` (~40 email matches) | ACTIVE | See `HARDCODED_DATA_AUDIT.md` P3. |

### 2.3 P2 — structural, plan deliberately

| # | Debt | Evidence | Class |
|---|---|---|---|
| T-15 | **Merge/tombstone machinery reimplemented per app** — `mergeEntriesTombstonesAuditLog`, `deletedIds`, `paid` reconciliation duplicated across 12 822 lines of `app.js` (copa 5 058 / br 3 331 / cdb 4 433) | 3 × `js/app.js` | ACTIVE |
| T-16 | **`deletedIds` grows without bound** — never pruned in any code path | `app.js` merge functions | ACTIVE |
| T-17 | **Cutoff defined in two places** — `CONFIG.cutoffIso` (versioned) and `state.cutoffAt` / `phases[].cutoffAt` (runtime), no stated precedence | `js/config.js` + `emptyState()` | ACTIVE (deadlines gate money) |
| T-18 | **`results` key is dead in br2026** — initialised `null`, never shaped like copa's object | `bolao/br2026/js/app.js:92` | **OBSOLETE** (copy-paste residue) |
| T-19 | **`cutoffOffsetMs` exists only after a merge**, absent from `emptyPhaseState()` | `cdb2026/js/app.js:65` vs. `:459` | ACTIVE — this class of bug already occurred once (comment at `:452`) |
| T-20 | **`auto_results.yml` permanently dormant** — month filter `6-7`, Copa archived 2026-07-19 | `.github/workflows/auto_results.yml:6,8` | **LEGACY** — appears active, cannot fire. DG-02′ |
| T-21 | **6 hand-written cron windows with UTC↔EDT arithmetic, untested** — one realised defect already (Mon/Wed never fired, fixed 2026-08-06) | `.github/workflows/powerball-results-email.yml` | ACTIVE. DG-05 |
| T-22 | **ESPN cache refresh is manual-only** while emails run every 10 min | `bolao_provider_snapshot.yml` has no `schedule:` | ACTIVE (deliberate per comment). DG-04 |
| T-23 | **6 RLS policies on `bolao_state` where 3 suffice** — duplicate names suggest two generations stacked; permissive policies OR together, so effective grant is broader than either author intended | `S11` | ACTIVE |
| T-24 | **3 `status`/`state` columns as free `text`** while 3 sibling columns use enums | `lottery_pools.status`, `lottery_draws.status`, `lottery_participations.state` | ACTIVE |
| T-25 | **Every FK column unindexed** — 8 indexes for 7 tables (7 PK + 1 unique) | `S06` | ACTIVE (harmless at 1–11 rows, wrong before first real draw) |

### 2.4 P3 — hygiene

| # | Debt | Evidence | Class |
|---|---|---|---|
| T-26 | 4 stale local worktrees under `.claude/worktrees/` holding duplicated copies of the whole repo | `git worktree list` | ORPHAN_CANDIDATE |
| T-27 | 7 stashes, several labelled as other sessions' strays | `git stash list` | UNKNOWN — do not touch |
| T-28 | `bolao/backups/*.json` untracked but on disk with PII | filesystem | ACTIVE — confirm gitignored |
| T-29 | `bolao/loterias/powerball/debug.html` — a debug page with participant names | tracked | ORPHAN_CANDIDATE |
| T-30 | `bootstrap_owner_role.sql` exists only in the non-deployed repo | powerball-admin | UNKNOWN |
| T-31 | Two incident-derived docs versioned as permanent architecture (`FASE2.2_CORRECAO_FINAL_REPORT.md`, `POWERBALL_EMAIL_SUBJECT_PREFIX_DEFECT.md`) | `docs/bolao/` | LEGACY — value is historical; should live under an incidents/ prefix |

## 3. Duplication summary

| Concept | Implementations | Verdict |
|---|---|---|
| Scoring | 4 (per competition) | **Correct** — governance requires separation |
| Setup SQL | 2, diverged | **Debt** — T-06 |
| Audit log | 2 (JSON capped / relational unenforced) | **Debt** — T-05, T-10 |
| Payment concept | 2 (`paid` bool / `lottery_payment_transactions`) | **Debt** — T-11 |
| Participant concept | 4+ (per-entry JSON ×3 apps + `lottery_participants`) | **Debt** — the core normalization case |
| State merge machinery | 3 | **Debt** — T-15 |
| Email send path | 2 (browser EmailJS / runner Python) | **Debt** — no shared delivery ledger |
| Backup writers | 3 | Acceptable; **0 readers** is the defect (T-13) |

## 4. RISKS

- **Tombstoning T-07 is the only "deletion-shaped" action recommended, and it is not a deletion.**
  Nothing in this report authorises removing code. Several items (T-26, T-27, T-30) are
  `ORPHAN_CANDIDATE`/`UNKNOWN` precisely because static analysis cannot prove them dead.
- **T-05 is the only item actively losing data every day.** If exactly one thing is fixed from this
  report, it is the 200-entry audit cap.
- Fixing T-25 (missing FK indexes) before the tables carry volume is nearly free; after, it needs
  `CREATE INDEX CONCURRENTLY` and a maintenance window.

## 5. NEXT DECISION (operator)

1. **Which repository is canonical for DDL?** Unblocks T-06, T-08 and gates T-03.
2. **Apply or retire the unapplied `lottery_*` roadmap** (T-09, and the 7 unapplied tables)?
   Determines whether the target model extends or replaces it.
3. **Authorise the `auditLog` cap fix (T-05) as an isolated frontend change?** It touches
   `app.js` in three apps and is therefore outside this programme's "no application code" rule —
   it needs its own authorisation.
