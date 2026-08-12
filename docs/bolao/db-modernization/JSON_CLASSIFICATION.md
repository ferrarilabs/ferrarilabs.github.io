# JSON_CLASSIFICATION — `bolao_state` document model, field by field

**STATUS:** COMPLETE for all three bolão apps. Repo-derived; **no production JSON was read.**
**EVIDENCE BASIS:** `bolao/{copa2026,br2026,cdb2026}/js/app.js` (`emptyState()`, merge functions,
mutation sites), `js/config.js`, `js/data.js`, plus sanitized Phase 1/1B catalog evidence
(`bolao_state` = `id text PK`, `state jsonb NOT NULL`, `updated_at timestamptz`, 3 live rows).
**KNOWN GAPS:** the *instance* contents of production `state` were never read (PII policy), so
cardinalities below are structural, not measured. `deletedIds` growth and `auditLog` occupancy are
unmeasured.
**ASSUMPTIONS:** one row per app, keyed by app slug — supported by 3 live rows and three apps, but
the `id` values themselves were not read.

> Cross-references: `LOGICAL_DATA_MODEL_ASIS.md` §2 (Model A structure),
> `DATABASE_RECONCILIATION.md` R-07 (no versioned DDL), `RLS_ASSUMPTIONS_REVIEW.md` §2.2
> (no DB-level authorization).

---

## 1. The document, as three divergent schemas

There is **one** table and **three different document schemas** in it, with no discriminator
column and no schema version negotiation beyond `meta.version`:

| App | `emptyState()` top-level keys |
|---|---|
| copa2026 | `entries`, `deletedIds`, `paid`, **`results`** *(object)*, `auditLog`, `meta` |
| br2026 | `entries`, `deletedIds`, `paid`, **`results`** *(null)*, **`cutoffAt`**, `auditLog`, `meta` |
| cdb2026 | `entries`, `deletedIds`, `paid`, **`phases`**, **`espnSync`**, `auditLog`, `meta` |

**Finding J-01 — HIGH.** `results` is an *object* in copa2026 and *null* in br2026; cdb2026
replaces it with `phases` entirely. A single `jsonb` column holds three incompatible schemas
distinguished only by which row you read. Nothing in the database can validate any of them
(`LOGICAL_DATA_MODEL_ASIS.md` §2 — no `CHECK`, no schema constraint). A parser reading the wrong
row fails at runtime, not at write time.

**Finding J-02 — MEDIUM.** Four keys (`entries`, `deletedIds`, `paid`, `auditLog`, `meta`) are
common to all three apps and carry identical semantics. This is the **shared core** and is exactly
the part that should normalise first; the divergent keys are tournament-specific and are the part
that justifiably stays JSON.

---

## 2. Field-level classification

Legend — classification / recommendation. `NEEDS_EVIDENCE` is used wherever the repo alone cannot
settle the question, rather than guessing.

### 2.1 Shared core (all three apps)

| Path | Classification | Recommend | Reasoning |
|---|---|---|---|
| `entries[]` | **TRANSACTIONAL_DATA** | **NORMALIZE** | The pool entry. Append-mostly, individually addressable, merged by id, money-bearing. This is the single strongest normalisation candidate in the system. |
| `entries[].id` | MASTER_DATA (identity) | NORMALIZE → surrogate PK | `uuid()`-generated client-side. Already a stable surrogate; becomes `pool_entries.entry_id`. |
| `entries[].entryName` | **PII** / MASTER_DATA | NORMALIZE → `participants` | Free-text person/team label. Per-entry today ⇒ **PII duplicated per entry per competition.** Must become a FK to a durable participant. |
| `entries[].participantEmail` | **PII** | NORMALIZE → `participants` | Same duplication problem; also the natural dedup key across competitions. |
| `entries[].payerName` | **PII** | NORMALIZE → `participants` or payment actor | Distinct from `entryName` (someone may pay for another). Evidence of a real payer≠participant relationship — see §4. |
| `entries[].paymentMethod` | REFERENCE_DATA | NORMALIZE → enum/lookup | Small closed set (Zelle/Venmo/CashApp/PIX). Belongs in a reference table or enum, not free text. |
| `entries[].picks` | **TRANSACTIONAL_DATA** | **NORMALIZE** (predictions) | The prediction payload. Nested map keyed by tie/match id. Money is computed from this. |
| `entries[].createdAt` | TRANSACTIONAL_DATA | NORMALIZE | Immutable per code comment (line 1235). Becomes `created_at`. |
| `entries[].updatedAt` | TRANSACTIONAL_DATA | NORMALIZE | Drives merge conflict resolution (`remoteTs`/`localTs`, line 374). Becomes `updated_at` + a real version column. |
| `deletedIds[]` | **SYNCHRONIZATION_STATE** (tombstones) | **KEEP_JSON → then REMOVE_LATER** | Tombstone set enabling last-write-wins merge without resurrection. A pure artefact of client-side merge. Once writes are server-mediated, soft-delete columns replace it and this key disappears. **Unbounded growth — never pruned in code.** |
| `paid{entryId→bool}` | **TRANSACTIONAL_DATA** (financial) | **NORMALIZE** | A boolean money flag keyed by entry id. Carries no amount, no date, no reference, no actor. See J-03. |
| `auditLog[]` | **AUDIT_DATA** | **NORMALIZE → immutable events** | `{ts, action, admin, detail}` (line 670), `unshift`ed, **hard-truncated at 200 entries** (line 671). See J-04. |
| `meta.updatedAt` | SYNCHRONIZATION_STATE | DERIVE | Duplicates the table's own `updated_at` column. Should be derived from the row, not stored in the document. |
| `meta.version` | CONFIGURATION | KEEP_JSON | `C.siteVersion` stamp. Legitimately belongs with the document as a schema/app marker. |

**Finding J-03 — CRITICAL (financial fidelity).** `paid` is `{entryId: true|false}`. It records
*that* something was paid and nothing else — no amount, no timestamp, no method, no transaction
reference, no actor. Yet real money is paid out from these pools, and the Powerball governance rule
requires every entry to carry its Zelle/Venmo/CashApp reference. **The bolão apps' financial state
cannot satisfy that rule as currently modelled.** Compare `lottery_payment_transactions`, which
gets this right (amount, type, `external_reference` with a unique index, `paid_at`, provider,
reversal link). The relational model already exists and is *better*; the JSON model is the
regression. This is the strongest single argument for normalising `paid`.

**Finding J-04 — HIGH (audit integrity).** `auditLog` is truncated to the newest 200 entries on
every write. An audit log that silently discards its own history is not an audit log. Combined with
`unshift` (newest-first) and no server-side write, the oldest evidence is destroyed first — exactly
the entries an auditor would want. Must become append-only immutable events with no cap
(`audit_events`). Note the parallel with `DATABASE_RECONCILIATION.md` R-04: the relational audit
table has the *shape* of integrity without enforcement; the JSON audit log has neither.

### 2.2 copa2026-specific

| Path | Classification | Recommend | Reasoning |
|---|---|---|---|
| `results{matchId→result}` | TRANSACTIONAL_DATA (authoritative) | **NORMALIZE** → `results`/`matches` | Real match outcomes; scoring input. Authoritative competition fact, not app state. |

### 2.3 br2026-specific

| Path | Classification | Recommend | Reasoning |
|---|---|---|---|
| `results` (null) | LEGACY_STATE | **REMOVE_LATER** | Initialised `null` and never shaped like copa's object — a copy-paste残 from copa2026. Dead key. |
| `cutoffAt` | CONFIGURATION | NORMALIZE → pool/edition attribute | Entry deadline. A property of the pool, not of the state document. Also exists as `CONFIG.cutoffIso` — see J-05. |

### 2.4 cdb2026-specific

| Path | Classification | Recommend | Reasoning |
|---|---|---|---|
| `phases{phaseId→{cutoffAt, ties{}}}` | **CONFIGURATION + TRANSACTIONAL** (mixed) | **SPLIT** | Conflates a schedule (`cutoffAt`, per-phase deadline) with live competition data (`ties`). Two different lifecycles in one subtree. |
| `phases[].cutoffAt` | CONFIGURATION | NORMALIZE → `competition_edition_phases` | Per-phase deadline; reference/config data. |
| `phases[].cutoffOffsetMs` | CONFIGURATION | NORMALIZE | Appears in merge (line 459) but **not** in `emptyPhaseState()` (line 65) — a key that exists only after a merge. See J-06. |
| `phases[].ties{tieId→tie}` | **TRANSACTIONAL_DATA** | **NORMALIZE** → `matches`/`ties` | The bracket. Fixtures, teams, aggregate scores. Authoritative competition structure. |
| `espnSync.activePhaseId` | **SYNCHRONIZATION_STATE** | **KEEP_JSON** (or dedicated sync table) | Explicitly an admin decision that cannot be inferred (code comment lines 69–72). Genuine operator-owned sync cursor. |
| `espnSync.seededKnownConfrontos` | SYNCHRONIZATION_STATE (idempotency latch) | KEEP_JSON → migrate to sync table | One-shot "seed already ran" flag. A migration-idempotency latch living in application state. |

**Finding J-05 — MEDIUM (duplicated truth).** Cutoff exists in **two places**: `CONFIG.cutoffIso`
(versioned, in `js/config.js`) and `state.cutoffAt` / `phases[].cutoffAt` (runtime, in the
document). Two sources for one deadline, one deployable and one mutable, with no stated precedence.
Deadlines gate money.

**Finding J-06 — MEDIUM (schema drift within the document).** `cutoffOffsetMs` is produced by the
merge path but absent from `emptyPhaseState()`. A fresh state and a merged state therefore have
different shapes. The code comment at line 452 records that this key was *previously being silently
discarded* by the merge — i.e. this class of bug already occurred once. Unvalidated `jsonb` cannot
prevent recurrence.

---

## 3. Cross-competition duplication

Values duplicated across every competition, which is the core argument for the participant-master
model:

| Duplicated value | Where | Consequence |
|---|---|---|
| Person identity (`entryName`, `participantEmail`, `payerName`) | Per entry, per app, per year | Same human re-keyed for every competition. No participation history is answerable. PII copied N× per person. |
| `paymentMethod` | Per entry | Reference data stored as free text N× |
| Tombstone/merge machinery (`deletedIds`, merge fns) | Reimplemented in all 3 `app.js` | ~12 800 lines of app.js across 3 apps with structurally identical merge logic |
| `paid` semantics | Per app | Same impoverished boolean, three times |
| `auditLog` shape + 200-cap | All 3 apps | Same defect, three times |

**A person who entered Copa 2026, Brasileirão 2026 and Copa do Brasil 2026 exists as three
unrelated records with no key linking them.** No query can answer "how many pools has this person
entered" or "what have they paid in total". This is the concrete gap the target model must close.

---

## 4. Should-be-relational vs. should-stay-JSON vs. should-be-events vs. should-be-derived

### 4.1 Should become relational entities
`entries` → `pool_entries`; person identity → `participants` (deduplicated, PII stored **once**);
`paid` → payment transactions **+ allocations** (see below); `picks` → `predictions`;
copa `results` → `results`; cdb `phases[].ties` → `matches`; per-phase `cutoffAt` →
`competition_edition_phases`.

**`payerName` is the evidence that `payments` and `payment_allocations` must be separate.** The
document already distinguishes payer from participant, so a payment made by one person can settle
another's entry. A single `paid` boolean on the entry cannot express that; a payment with
allocations can. This confirms the split independently of any target-model preference.

### 4.2 Should remain JSONB
- `espnSync.*` — an external-provider sync cursor whose shape is owned by the provider integration
  and will change with it. Schematising it buys nothing.
- `meta.version` — app/schema stamp.
- `auditLog[].detail` — deliberately heterogeneous per action type. Keep as `jsonb` **inside** a
  relational `audit_events` row (exactly what `lottery_admin_audit.before_snapshot`/`after_snapshot`
  already do). Column-level JSON is right; document-level JSON is not.
- Raw ESPN provider payloads (`bolao/*/data/espn-normalized.json`) — see §5.

### 4.3 Should become immutable events
`auditLog[]` → `audit_events` (append-only, uncapped, hash-chained). Admin mutations
(`mutation.entryId`, `mutation.value` at lines 568/572) are already command-shaped and are the
natural event source. See `ARCHITECTURE_DECISION_REVIEW.md` for whether this justifies event
sourcing (it does not — it justifies an event *log*).

### 4.4 Should be derived, not stored
`meta.updatedAt` (duplicates the row's `updated_at`); aggregate tie scores in
`phases[].ties` (computable from match results — code already computes `agg.totalA/totalB` at line
1052); ranking/standings (never store a leaderboard that can be recomputed — snapshot it explicitly
and label it a snapshot); `paid` as a boolean (derivable from allocated payments ≥ entry price).

---

## 5. Other JSON in the repository

| Artefact | Classification | Recommend | Note |
|---|---|---|---|
| `bolao/*/data/espn-normalized.json` | **CACHE** (provider snapshot) | **KEEP_JSON** | Server-side ESPN snapshot the browser reads instead of calling ESPN. Correctly a cache: reproducible, disposable, versioned for determinism. **Contains third-party athlete/club names — not participant PII** (confirmed: only single-token private-list collisions, zero full-name matches). |
| `bolao/backups/backup-*.json` | AUDIT_DATA / **PII-bearing** | not tracked in Git | Full state snapshots incl. participant names + emails. Verify they stay gitignored. |
| `bolao/loterias/powerball/scripts/email/outbox.json` | TRANSACTIONAL_DATA (delivery log) | **NORMALIZE → outbox table** | A real send log **tracked in Git** with real emails. This is the outbox pattern implemented as a versioned file. |
| `bolao/cdb2026/scripts/fixtures/golden_state.json` | REFERENCE_DATA (test fixture) | KEEP_JSON, sanitize | Golden-master fixture containing real-looking emails. |
| `.../fixtures/powerball-email-test-fixture.json` | REFERENCE_DATA (fixture) | KEEP_JSON, sanitize | Real emails in a fixture. |

---

## 6. Recommended normalisation order (design only)

Ordered by risk-adjusted value; **none of this is authorized to implement**, and all of it is
gated on `DATABASE_RECONCILIATION.md` R-03.

| # | Move | Value | Risk | Gate |
|---|---|---|---|---|
| 1 | `auditLog` → `audit_events` | Stops active evidence destruction (200-cap) | **Low** — additive, append-only, no read path changes | none |
| 2 | `paid` → payments + allocations | Closes the financial-fidelity gap (J-03) | Medium — money semantics | Needs pricing/allocation rules from operator |
| 3 | Person identity → `participants` | Enables all cross-competition reporting; de-duplicates PII | Medium — identity resolution across 3 apps needs a dedup key (`participantEmail`, nullable today) | Operator decision on dedup authority |
| 4 | `entries` → `pool_entries` | Core transactional normalisation | **High** — the money-bearing write path | Dual-write + backfill; R-03 |
| 5 | `picks` → `predictions` | Enables set-based scoring in SQL | High — scoring is the untouchable subsystem | Explicit authorization; scoring parity proof |
| 6 | `phases[].ties` / `results` → `matches`/`results` | Competition facts become queryable | Medium | Per-competition |
| 7 | Retire `deletedIds` | Removes client-merge machinery | Low **once** writes are server-mediated | Must be last |

**`picks` (step 5) touches scoring and must never be bundled with anything else.** Per the repo's
standing rule, scoring changes require explicit authorization and a passing `audit_scoring.py`
parity proof.

---

## 7. RISKS

- **Unvalidated `jsonb` + three schemas + client-side writes** means a malformed document is
  accepted by the database and only fails when an app parses it. J-06 shows this already happened.
- **`deletedIds` and `auditLog` are unbounded/lossy respectively.** One grows forever, the other
  discards history. Both are on the hot write path of a 3-row table taking 532 updates.
- **Normalising `entries` while writes remain client-side re-introduces the merge problem in SQL.**
  Server-mediated writes must land before, or with, step 4.

## 8. NEXT DECISION (operator)

1. **Participant dedup authority** — is `participantEmail` the identity key? It is nullable today.
   Without an answer, step 3 cannot start.
2. **Entry pricing / allocation rules** — required for step 2; not derivable from the repo.
3. **Is `payerName ≠ entryName` a supported product rule or an accident?** Determines whether
   `payment_allocations` is required or premature.
