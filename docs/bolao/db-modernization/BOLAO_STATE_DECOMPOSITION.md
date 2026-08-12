# BOLAO_STATE_DECOMPOSITION — field-by-field migration map

**STATUS:** COMPLETE as a map. **No migration written, no DDL, no production write.**
**EVIDENCE BASIS:** `emptyState()` and the merge/mutation paths in
`bolao/{copa2026,br2026,cdb2026}/js/app.js`; `JSON_CLASSIFICATION.md` (J-01…J-06);
`TARGET_DATA_MODEL.md` (ratified A3/B1/E1/E3); `PERFORMANCE_BASELINE.md` P-01 (TOAST behaviour);
Phase 1 catalog evidence for the current table shape.
**KNOWN GAPS:** the *instance* contents of production `state` were never read (PII policy), so
cardinalities are structural. Entry-fee values per pool are unknown (B-08) and block settlement
backfill. Whether `payerName ≠ entryName` is a product rule is unconfirmed (B-09).
**ASSUMPTIONS:** one row per app keyed by app slug — supported by 3 live rows and 3 apps.

> **NO PARTICIPANT VALUE APPEARS IN THIS DOCUMENT.** Every entry below names a JSON *path* and a
> target *column*. No name, email, payment reference, prediction or score is reproduced.

---

## 1. Disposition vocabulary

| Disposition | Meaning |
|---|---|
| **MOVE** | Becomes a relational column/row. Source is authoritative until cutover. |
| **DERIVE** | Not stored in the target; computed from other columns. Storing it would create a second truth. |
| **KEEP_JSON** | Stays JSON, but as a `jsonb` **column on a relational row**, not a document. |
| **ARCHIVE** | Preserved for audit/history but not part of the live model. |
| **DROP_AFTER_VALIDATION** | Exists only to serve client-side merge; removable once writes are server-mediated. |
| **UNKNOWN** | Cannot be classified without an operator answer. Named, never guessed. |

---

## 2. Shared core — present in all three apps

| # | Source JSON path | Disposition | Target entity.column | Transformation |
|---|---|---|---|---|
| 1 | `entries[]` | **MOVE** | `pool_entries` (one row per element) | 1:1 element→row |
| 2 | `entries[].id` | **MOVE** | `pool_entries.pool_entry_id` | client `uuid()` kept as-is — already a stable surrogate |
| 3 | `entries[].entryName` | **MOVE** → dedup | `participants.display_name` + `pool_entries.participant_id` FK | resolve to a participant; **zero merges on first backfill** |
| 4 | `entries[].participantEmail` | **MOVE** → dedup key | `participants.email` | `lower(trim())` for comparison; stored normalised; **nullable** |
| 5 | `entries[].payerName` | **MOVE** | `payments.payer_participant_id` FK | separate participant resolution; see §5 UNKNOWN-1 |
| 6 | `entries[].paymentMethod` | **MOVE** | `payments.method` (enum/lookup) | map free text → closed set |
| 7 | `entries[].picks` | **KEEP_JSON** (phase 1) → **MOVE** (last) | `pool_entries.picks jsonb`, later `predictions` rows | see §6 — scoring-adjacent, deliberately last |
| 8 | `entries[].createdAt` | **MOVE** | `pool_entries.created_at` | ISO→`timestamptz` |
| 9 | `entries[].updatedAt` | **MOVE** | `pool_entries.updated_at` + `version` | timestamp kept; `version` seeded to 1 |
| 10 | `paid{entryId→bool}` | **DERIVE** | *(none)* | replaced by `SUM(payment_allocations.allocated_amount) >= pool_entries.expected_fee_amount`. See §4. |
| 11 | `deletedIds[]` | **DROP_AFTER_VALIDATION** | `pool_entries.deleted_at` (soft delete) | tombstone set → per-row column; **must be last** (§7) |
| 12 | `auditLog[]` | **MOVE** → immutable | `audit_events` (append-only) | `{ts,action,admin,detail}` → `occurred_at, action, actor_role, safe_metadata`; **PII stripped per B1** |
| 13 | `meta.updatedAt` | **DERIVE** | *(none)* | duplicates the row's own `updated_at` |
| 14 | `meta.version` | **KEEP_JSON** | `bolao_state.state` (legacy) / `sync_state.cursor` | app/schema stamp; not a target entity |

**Finding D-1 — the `paid` boolean cannot be backfilled faithfully.** It records *that* something was
paid and nothing else: no amount, date, method, reference or actor (J-03). Backfilling
`payments`/`payment_allocations` from it would require inventing an amount. **Correct handling:**
create one `payments` row per `paid=true` entry with `amount = NULL` and
`source = 'legacy_bolao_state_boolean'`, allocate nothing, and mark the entry
`settlement_status = 'LEGACY_ASSERTED'` — a fourth state outside the ratified
UNPAID/PARTIALLY_PAID/SETTLED/OVERPAID set, meaning "the legacy system asserted paid; no evidence
survives." **Inventing amounts to fit the model would be the single worst decision available here.**

---

## 3. App-specific keys

| Source | App | Disposition | Target | Note |
|---|---|---|---|---|
| `results{matchId→result}` | copa2026 | **MOVE** | `match_results` | authoritative competition fact |
| `results` (`null`) | br2026 | **DROP_AFTER_VALIDATION** | *(none)* | dead key, copy-paste residue (T-18) |
| `cutoffAt` | br2026 | **MOVE** | `pools.cutoff_at` or `competition_edition_phases.cutoff_at` | resolves the two-sources-of-cutoff problem (J-05) |
| `phases{}.cutoffAt` | cdb2026 | **MOVE** | `competition_edition_phases.cutoff_at` | one home for the deadline |
| `phases{}.cutoffOffsetMs` | cdb2026 | **MOVE** | `competition_edition_phases.cutoff_offset_ms` | exists only post-merge (J-06); **must be captured before cutover or it is lost** |
| `phases{}.ties{}` | cdb2026 | **MOVE** | `ties` + `matches` | a tie contains matches; not the same entity |
| `phases{}.topology` | cdb2026 | **MOVE** | `competition_edition_phases.topology jsonb` | added post-Batch-4; **provenance fields must survive** |
| `espnSync.activePhaseId` | cdb2026 | **MOVE** | `sync_state.active_phase_id` | operator decision that cannot be inferred |
| `espnSync.seededKnownConfrontos` | cdb2026 | **MOVE** | `sync_state.seed_flags jsonb` | one-shot idempotency latch |

**Finding D-2 — `cutoffOffsetMs` is a data-loss risk at cutover.** It is produced by the merge path
but absent from `emptyPhaseState()`, so a freshly-created state lacks it while a merged one has it
(J-06). A backfill reading only `emptyState()`-shaped documents would silently drop it — and the
in-code comment records that this key was *already* dropped once by the merge. **Backfill must read
the live document, not the schema.**

---

## 4. Settlement — derived, never migrated as a flag

```
allocated(entry) := COALESCE(SUM(payment_allocations.allocated_amount WHERE pool_entry_id = entry), 0)
expected(entry)  := pool_entries.expected_fee_amount        -- snapshot, not a lookup
```

| Status | Condition |
|---|---|
| `UNPAID` | `allocated = 0` |
| `PARTIALLY_PAID` | `0 < allocated < expected` |
| `SETTLED` | `allocated = expected` |
| `OVERPAID` | `allocated > expected` |
| `LEGACY_ASSERTED` | legacy `paid=true` with no recoverable amount (D-1) |

**Blocked on B-08:** `expected_fee_amount` requires per-pool fee values only the operator has. Until
then every migrated entry lands `LEGACY_ASSERTED` and settlement is not computable. **This is the
single hardest blocker in the decomposition** — the model is ready and the input is missing.

---

## 5. UNKNOWN — named, not guessed

| # | Question | Why it blocks | Backlog |
|---|---|---|---|
| UNKNOWN-1 | Is `payerName ≠ entryName` a product rule or data entry noise? | Determines whether `payment_allocations` is required or premature | B-09 |
| UNKNOWN-2 | Per-pool entry fee, historically | Blocks all settlement derivation | B-08 |
| UNKNOWN-3 | Is `participantEmail` the identity key? It is **nullable** | Blocks participant dedup; a wrong merge misattributes money | D-07 |
| UNKNOWN-4 | Do prize payouts follow the documented 70/20/10 split in practice? | `prize_allocations` shape unverified | B-16 |
| UNKNOWN-5 | How many `auditLog` entries were already destroyed by the 200-cap? | **Unknowable** — no counter ever existed | J-04 |

---

## 6. Backfill, dual-read and cutover

### 6.1 Order (re-sequenced per DEC-16 — the naive order is unsafe)

| # | Step | Why here |
|---|---|---|
| 0 | **Server-mediated writes exist** (DEC-09/E3) | Dual write from three browser apps **cannot be atomic**. Prerequisite, not a parallel track. |
| 1 | `audit_events` backfill | Additive, append-only, no read path changes. Stops the 200-cap bleeding first. |
| 2 | `participants` backfill, **zero merges** | One participant per historical entry. Under-merge is recoverable; over-merge of money is not. |
| 3 | `pool_entries` + `pools` + editions | Core transactional move |
| 4 | `payments` (`LEGACY_ASSERTED`) | Cannot be faithful until B-08 |
| 5 | `matches`/`ties`/`match_results` | Competition facts |
| 6 | **`predictions` LAST** | Scoring-adjacent; requires parity proof |
| 7 | Retire `deletedIds` | Only safe once writes are server-mediated |

### 6.2 Dual-read

Read from the relational model, **compare against the JSON document on every read**, log divergence,
serve the JSON. Promote to relational-authoritative only after a full competition cycle at zero
divergence (O-30). The JSON stays written throughout — that is what makes rollback possible.

### 6.3 Cutover criteria (all required)

1. Zero dual-read divergence across a complete competition cycle.
2. Scoring parity proven against all four `audit_scoring.py` suites.
3. Row-count and financial reconciliation match between JSON and relational.
4. `audit_events` count ≥ surviving `auditLog` entries in every app.
5. A restore rehearsal has passed on the **relational** schema (not just the current one).
6. B-08 answered, so settlement is computable rather than `LEGACY_ASSERTED`.

### 6.4 Rollback

| Phase | Rollback |
|---|---|
| Steps 1–5 | Stop writing relational; JSON is still authoritative. **Free.** |
| Step 6 (`predictions`) | Revert to `picks jsonb`; scoring reads JSON again |
| Step 7 / read switch | Re-point reads at JSON — possible **only while JSON is still written** |
| **Retiring `bolao_state`** | **POINT OF NO RETURN.** Requires explicit sign-off. |

---

## 7. RISKS

- **Retiring `deletedIds` before writes are server-mediated re-creates the merge problem in SQL.**
  It must be last, and the ordering is not negotiable.
- **`LEGACY_ASSERTED` will be tempting to "clean up" by inventing amounts.** It must survive as an
  honest marker that the legacy system asserted payment without evidence.
- **`bolao_state` is TOAST-dominated** (P-01: 176 kB of 288 kB, full-document rewrite per update). A
  backfill that reads and rewrites documents repeatedly will be slow for structural reasons, not
  because of row count.
- The decomposition assumes the three documents keep their current shapes. J-01 shows they already
  diverge (`results` object vs `null` vs absent); a fourth app would diverge again.

## 8. NEXT DECISION (operator)

1. **B-08 per-pool entry fees** — the hardest blocker; nothing about settlement moves without it.
2. **UNKNOWN-3: is `participantEmail` the dedup key** despite being nullable?
3. **Accept `LEGACY_ASSERTED`** as a permanent fifth settlement state for un-reconstructable history?
4. **UNKNOWN-1:** is payer≠participant a supported rule?
