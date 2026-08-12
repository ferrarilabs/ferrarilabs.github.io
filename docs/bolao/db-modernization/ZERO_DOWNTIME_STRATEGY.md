# ZERO_DOWNTIME_STRATEGY — surviving the migration without an outage

**Workstream L.** Companion to `MIGRATION_PHASING.md` (Workstream K).

Status: **DESIGN ONLY.** No DDL, no deploy, no flag exists as a result of this document.

---

## 0. The constraint that shapes everything

This is a **static site on GitHub Pages with a browser-resident app**. That produces three properties
a server-rendered app does not have, and they drive every decision below:

1. **There is no server-side release boundary.** A deploy replaces files; it does not restart
   sessions. An open tab keeps running the *previous* build indefinitely.
2. **Clients cache aggressively.** Cache-busting is by `?v=` query string, bumped by a bot. Until a
   client reloads, it runs old code against the new database.
3. **The database is reachable directly from the browser** via the anon key. So "old app / new DB"
   is not a transient window measured in seconds — it can last **days**, for as long as someone
   leaves a tab open.

Consequence: **every schema change must be backward-compatible with an arbitrarily old client**, and
"we deployed the fix" is never sufficient evidence that the old path is gone.

---

## 1. Expand / contract, and why contract is always a separate release

| Step | What happens | When it is safe |
|---|---|---|
| **Expand** | add the new nullable column / table / index; write both old and new shapes | always |
| **Migrate** | backfill; validate parity | after expand is deployed everywhere |
| **Contract** | stop writing the old shape; later drop it | only after *no* client reads the old shape |

The contract step is a **separate release from the migrate step**, never bundled. Bundling them is
the single most common way a zero-downtime plan becomes an outage: the moment the old column is
dropped, every still-open tab starts erroring on a read it has been performing successfully all week.

For this platform, "no client reads the old shape" cannot be proven by a deploy. It requires either
telemetry showing zero reads of the old path over a window longer than the longest plausible session,
or an enforced client-version floor (§7).

---

## 2. Schema-change rules

| Change | Safe form | Unsafe form and its failure |
|---|---|---|
| add column | `ADD COLUMN` **nullable**, no default → backfill → set `NOT NULL` via `NOT VALID` then `VALIDATE` | `ADD COLUMN NOT NULL DEFAULT ...` on a large table rewrites it under an `ACCESS EXCLUSIVE` lock; on PG 11+ a constant default avoids the rewrite, but a *volatile* one still rewrites |
| add constraint | `ADD CONSTRAINT ... NOT VALID`, then `VALIDATE CONSTRAINT` in a separate transaction | plain `ADD CONSTRAINT` takes a lock while it scans the whole table |
| add index | `CREATE INDEX CONCURRENTLY` | plain `CREATE INDEX` blocks writes for its full duration |
| drop index | `DROP INDEX CONCURRENTLY` | plain drop takes `ACCESS EXCLUSIVE` |
| rename column | **never rename.** Add the new name, dual-write, migrate readers, drop later | a rename is an instant break for every client mid-session; there is no compatible window at all |
| change type | add a new column of the new type, dual-write, migrate readers, drop later | `ALTER TYPE` rewrites and locks |
| drop column | only in a contract release, after §1's evidence | any client still selecting it errors |
| add enum value | `ALTER TYPE ... ADD VALUE` (non-transactional; cannot be rolled back in the same tx) | old clients receiving an unknown enum value must tolerate it — see FS-5 |

`CREATE INDEX CONCURRENTLY` can **fail and leave an invalid index**. The runbook must check
`pg_index.indisvalid` after every concurrent build and drop-and-retry on failure; an invalid index is
not used by the planner but is still maintained on write, so it is pure cost that looks like a
working index.

---

## 3. Backfill batching

Non-negotiable properties, in order of importance:

1. **Idempotent.** Re-running must be a no-op, keyed on a natural or preserved surrogate id
   (`pool_entry_id` is the client uuid, already stable — this is why it is kept as-is).
2. **Restartable.** A cursor is persisted, so a killed job resumes rather than restarts.
3. **Bounded per transaction.** Batches of 500–2 000 rows, each its own transaction. A single
   long transaction holds `xmin` back, blocking autovacuum across the whole database — on a small
   Supabase instance that is felt everywhere, not just on the table being backfilled.
4. **Throttled.** A sleep between batches. The goal is not speed; the goal is not degrading the live
   app while it runs.
5. **Observable.** Rows processed, rows skipped, current cursor, and estimated remaining, all
   emitted. A backfill you cannot ask "how far along?" is one you cannot make a decision about.

Current data volumes are tiny (tens of entries), so batching is here for **correctness and
restartability**, not throughput. It costs nothing now and is the difference between a recoverable
and an unrecoverable failure at 100× the size (see Workstream W).

---

## 4. Dual-write, and the justification for it

Dual-write is a **liability**: two writes that must both succeed, with no distributed transaction
available across a jsonb document and a set of relational tables in the general case.

It is justified **only at M11**, and only because:

- it is the sole way to hold two representations comparable during a cutover; and
- both targets are in the **same PostgreSQL database**, so a single transaction covers them — this is
  not the classic cross-system dual-write problem, and that distinction is the whole reason it is
  acceptable here.

Rules:

- Both writes in **one transaction**, always. Never "write A, then write B" across a network hop.
- The legacy document remains **authoritative** for the whole dual-write period. If the relational
  write is the one that fails, the transaction aborts and the user sees a normal error — there is no
  state where the two disagree.
- Dual-write is **removed at M16**. A dual-write that outlives its cutover becomes permanent
  complexity that everyone is afraid to delete.

Dual-**read** (M12) is different and carries no such risk: it reads both and records differences.

---

## 5. Feature flags

| Flag | Controls | Default | Kill-switch behaviour |
|---|---|---|---|
| `WRITE_THROUGH_RELATIONAL` | M11 dual-write | off | off → writes go only to the legacy document; relational goes stale, parity job reports it |
| `READ_FROM_RELATIONAL` | M14 authority | off | off → reads return to the legacy document, which is still current because dual-write is still on |
| `LEGACY_WRITES_ENABLED` | M13 freeze | on | off → app is read-only with an explicit UI state |
| `PICKS_FROM_PREDICTIONS` | M16 scoring input | off | off → scoring reads `picks` jsonb, which is retained |

Flags must be **readable by the browser without a deploy** (a small config document, cache-busted),
or a rollback needs a release and stops being a rollback. Every flag defaults to the **old**
behaviour, so a client that fails to fetch the flag document degrades to the pre-migration path
rather than to an untested one.

---

## 6. Failure scenarios

Each is a real sequence, with what actually breaks and what the recovery is.

### FS-1 — Old app, new DB (the dominant case here)

A participant has had the pool open in a tab since before M6. The relational tables now exist; the
document is unchanged. The old app reads and writes `bolao_state` exactly as before.

**Breaks:** nothing, provided every phase through M10 is purely additive — which is why M1–M10
introduce tables and never alter `bolao_state`'s shape.

**Breaks if we get it wrong:** if any phase had renamed or retyped a key inside the document, this tab
would corrupt it on its next save, overwriting the migrated shape with the old one.

**Control:** `bolao_state`'s shape is untouched until M16. Verified by the parity harness's coverage
check: a new key appearing in the document is reported as unaccounted.

### FS-2 — New app, old DB

A client fetches the new build from the CDN, but the migration has not been applied (or was rolled
back). The new code queries `bolao.pool_entries`, which does not exist.

**Breaks:** every read, immediately and visibly.

**Control:** the new build must **feature-detect, not assume**. `READ_FROM_RELATIONAL` defaults to
off, so a new build with no flag document behaves exactly like the old one. The relational read path
is only entered when the flag says the migration is complete.

**Recovery:** none needed — the default is the safe path.

### FS-3 — Rollback after partial cutover

M14 has flipped `READ_FROM_RELATIONAL` on. Twenty minutes later, an operator notices R-15 disagrees
with `poolReconciliation()` for one pool.

**State:** some clients read relationally, some are still on the old build reading the document. Both
representations are being written, because dual-write is still on.

**Recovery:** flip `READ_FROM_RELATIONAL` off. Both representations are current, so this loses
nothing. **This is the entire reason M16 is a separate phase from M14** — the rollback path exists
only while the legacy document is still maintained.

**What makes this unrecoverable:** removing dual-write in the same release as the authority flip. Then
the document is stale, and rollback means restoring a backup and losing every write since cutover.

### FS-4 — Stale browser session writes after the freeze

M13 has set `LEGACY_WRITES_ENABLED=off`. A tab open since yesterday has not re-fetched the flag and
attempts to save an entry.

**Breaks:** the write must be **rejected server-side**, not merely hidden in the UI. A UI-only
freeze is not a freeze — the tab still has the anon key and can write directly.

**Control:** the freeze is enforced by RLS/policy at the database, not by the client. The client-side
flag exists only to render a clear message instead of an opaque error.

**Note:** this is precisely the class of gap already documented for the prediction cutoff, which is
*client-side only* and bypassable by clock manipulation. The freeze must not repeat that mistake.

### FS-5 — An old client meets a new enum value

M1 adds a `payment.method` value the old build has never seen. The old build renders it as
`undefined` or throws in a switch with no default.

**Control:** new enum values are only introduced for data the old build never reads. Where that
cannot be guaranteed, the value is added but not *used* until after the client floor (§7) is enforced.

### FS-6 — A concurrent write lands mid-backfill

M8 is halfway through `pool_entries` when a participant edits an entry the batch has already copied.
The relational row is now stale.

**Control:** the backfill is idempotent and re-run to completion after the freeze (M13's catch-up
pass). Parity is only *asserted* against a frozen source — the reason OC-4 moved the freeze before
cutover.

### FS-7 — `CREATE INDEX CONCURRENTLY` fails at M15

The build fails (deadlock, cancellation, disk). PostgreSQL leaves an **invalid** index behind.

**Control:** check `indisvalid` after each build; `DROP INDEX CONCURRENTLY` and retry. An invalid
index is not used for reads but *is* maintained on every write — cost with no benefit, and it looks
like a working index in `\d`.

### FS-8 — Migration succeeds, scoring changes

Everything applies cleanly. A rank shifts because `predictions` decomposition changed how a tie is
resolved.

**Control:** Workstream N. M16 cannot be declared complete unless every score, rank and tie is
byte-identical before and after, computed by the app's own scoring logic on both representations —
never by a SQL reimplementation, which would be a second source of truth for money.

**This is the only failure in the list that money is paid out on.** It is treated as the hard gate.

---

## 7. Client version floor

Because tabs live indefinitely, "everyone has upgraded" is not observable from a deploy. Two options:

| Option | Mechanism | Cost |
|---|---|---|
| **Soft floor** | the app fetches a `minVersion` from the cached-busted config and shows a "please reload" banner below it | a user can ignore it; not sufficient before a contract step |
| **Hard floor** | requests below `minVersion` are rejected server-side, forcing a reload | requires every write to carry a version and to be server-mediated (Workstream S) |

A **hard floor is a prerequisite for any contract step** (dropping a column, removing the legacy
document). Without it, no evidence exists that the old read path is unused, and the drop is a guess.

---

## 8. Sequenced deploy plan

| # | Action | Type | Reversible by |
|---|---|---|---|
| 1 | M1–M10 additive DDL + backfills | DB only | DROP (nothing references the new tables) |
| 2 | deploy build with write-through code, flag **off** | app only | previous build |
| 3 | `WRITE_THROUGH_RELATIONAL=on` | flag | flag off |
| 4 | run M12 parity until N consecutive clean runs | job | stop the job |
| 5 | freeze (`LEGACY_WRITES_ENABLED=off`), catch-up backfill, final parity | flag + job | lift the freeze |
| 6 | deploy build with relational read path, flag **off** | app only | previous build |
| 7 | `READ_FROM_RELATIONAL=on` — **cutover** | flag | flag off (FS-3) |
| 8 | M15 reporting, `CREATE INDEX CONCURRENTLY` | DB only | DROP |
| 9 | enforce the hard client floor | app + server | lower the floor |
| 10 | M16: `PICKS_FROM_PREDICTIONS=on` after N passes; stop dual-write | flag + app | flag off; `picks` is retained |
| 11 | contract: drop the legacy path | **destructive** | restore from backup only |

Every step from 1 to 10 is reversible without a restore. **Step 11 is the first irreversible one**,
and it is deliberately last and separate.

---

## 9. What this design does not claim

- **No measured RPO/RTO.** Workstream Y defines how they will be measured; no number is claimed until
  a rehearsal produces one.
- **No proof that dual-write is unnecessary.** It is justified for M11 only, on the specific ground
  that both targets sit in one database and one transaction.
- **No claim that the freeze window is short.** Its duration depends on the catch-up backfill and the
  parity run, both of which must be measured against production-shaped volumes first.
- **No claim that old clients are gone.** That is unobservable today; §7 is how it becomes observable.

## 10. Open operator decisions

| Id | Decision |
|---|---|
| **L-OP-1** | Freeze window scheduling — it must not overlap any prediction cutoff, since a freeze then denies entries and directly affects who can play. |
| **L-OP-2** | Soft or hard client floor before the contract step, and who communicates the forced reload. |
| **L-OP-3** | How many consecutive clean parity runs (`N`) constitute sufficient evidence at step 4. |
