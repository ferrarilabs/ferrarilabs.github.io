<!-- FDC-20260813-140645Z · read-only discovery 2026-08-13T14:06:45Z · remediation applied · no raw PII -->

# SOURCE UNIVERSE — FDC-20260813-140645Z

Validated against `FORENSIC_SOURCE_MANIFEST.md` (sha256 `25c50a94…`), not assumed from it.
**Five sources the frozen manifest did not register were found and are appended below.**

## 1. Competitions discovered

| Pool | Competition | Edition | Legacy doc id | Class | Status |
|---|---|---|---|---|---|
| `copa2026` | copa-do-mundo | 2026 | **`main`** | HISTORICAL_REAL | concluded 2026-07-19, archived |
| `br2026` | brasileirao | 2026 | `br2026` | REAL_PRODUCTION | entries closed 2026-07-16, unpublished |
| `cdb2026` | copa-do-brasil | 2026 | `cdb2026` | REAL_PRODUCTION | in production, quartas open |

Discovered from `bolao.competitions` (3), `bolao.competition_editions` (3), `bolao.pools` (3),
`public.bolao_state` ids (3), `audit.migration_lineage.source_pool`, static config and full Git
history. The legacy document id for the World Cup is **`main`**, not `copa2026`; `bolao.read_document`
takes the *pool slug*, so `read_document('main')` returns NULL and `read_document('copa2026')` is
the correct call. A reconciliation that used the document id would have silently compared nothing.

**Adjacent product, registered and excluded with reason:** `public.lottery_*` (Powerball —
`lottery_pools` 1, `lottery_participants` 10, `lottery_participations` 10,
`lottery_payment_transactions` 11, `lottery_draws` 1, `lottery_admin_audit` 1). Real, in
production, real money — and **not represented in `public.bolao_state` at all**, so it is outside
the legacy-retirement scope this audit gates. It shares only the database instance.

`UNKNOWN_COMPETITIONS = 0`.

## 2. Source universe by class

| Class | Source | Measure |
|---|---|---:|
| Legacy document | `public.bolao_state` | 3 rows · **8 554 leaves** (copa 6 553 · cdb 1 598 · br 403) |
| Normalized business | `bolao.*` | 18 populated tables · 1 045 predictions · 154 zone predictions · 46 entries · 26 participants |
| Private | `public.bolao_entry_private` · `public.cdb_entry_access` | 46 · 12 |
| Audit / lineage | `audit.*` | lineage 1 691 · events 28 · **new: archive 3 · legacy events 69 · legacy fields 247** |
| Migration ledger | `supabase_migrations.schema_migrations` | 46 → **48** |
| Repository | `origin/main` @ `23baf6b1` | 58 migration files · 2 unapplied · 6 without `PROVENANCE` |
| Git history | 1 474 commits, all refs | 190 email literals · 29 real-domain · **17 intersect production** |
| Backups | 12 `bolao_state` snapshots + 1 full `pg_dump` + 1 encrypted bundle | **0 backup-only records** |
| Client storage | 31 keys across 3 apps | 4 business-bearing · **0 controlled stores on this machine** |

## 3. UNREGISTERED_SOURCE_DISCOVERED — 5

| # | What | Why the freeze missed it |
|---|---|---|
| 1 | **auditLog has a THIRD shape** — copa2026, 19 records carrying `email`, `ip`, `userAgent`, `screen`, `platform`, `lang` | the manifest registered two shapes, both on cdb2026 |
| 2 | **copa2026 `entries[].diagnostics`** — 21 entries × `{userAgent, viewport, timezone, capturedAt}` | per-entry private fields were enumerated for cdb2026's six names only |
| 3 | **br2026 auditLog** — 7 records | the manifest counted cdb2026's 43 only |
| 4 | **residue picks are 16 records, not 6** — 6 `picks.qualified` + 10 `picks.matches` legs, 26 JSON leaves | the manifest counted the `qualified` slots |
| 5 | **two anon-readable legacy projections** — `bolao_state_public`, `bolao_state_public_cdb` | Q38 was verified against the base table and the normalized contract, never against the F10 sanitisers |

Discovery #1, #2 and #5 compound into finding **G1**: the third auditLog shape is the only one
carrying contact and network data, and it was being served to anonymous callers.

The source freeze is **reissued** at ledger **48** with these five sources registered.

## 4. Gates

```
UNKNOWN_COMPETITIONS      0
UNKNOWN_WRITERS           0     (42 mutating functions, matrix unchanged)
UNKNOWN_LOCALSTORAGE_KEYS 0     (31 keys, every one classified)
SOURCE_WITHOUT_DISPOSITION 0
UNKNOWN                   0
```
