<!-- FDC-20260813-140645Z · no raw PII · counts, tokens and fingerprints only -->

# WORLD CUP / COPA2026 — DATA CERTIFICATION

Pool `copa2026` · legacy document id **`main`** · tournament concluded 2026-07-19 · archived.
Epoch: **HISTORICAL_LEGACY** throughout. `NORMALIZED_RUNTIME` records: **0** (nothing writes copa).

## 1. Exact counts — every class, including the zero-valued ones

| Class | Source | Target | Count |
|---|---|---|---:|
| PARTICIPANTS (logical people, copa) | legacy `entries[]` | `bolao.participants` | **23 entries → 23 participant links** |
| ALIASES | — | — | **0** (no alias record exists on this platform) |
| ENTRIES | `entries[]` | `bolao.pool_entries` | **23** |
| MATCH_PREDICTIONS | `entries[].picks.<matchId>` | `bolao.predictions` | **733** |
| TIE_PREDICTIONS | — | — | **0** (copa is modelled as matches, not ties) |
| CLASSIFICATION/PLACEMENT_PREDICTIONS | — | — | **0** (zone picks are a BR concept) |
| RESULTS | `results{}` | `bolao.match_results` | **95** |
| MATCHES | — | `bolao.matches` | **104** (72 group + 32 knockout) |
| PHASES | — | `bolao.competition_edition_phases` | **8** |
| TIES | — | — | **0** |
| TOPOLOGY | bracket forward slots | `bolao.matches` | migrated (ledger `20260813000000`) |
| EMAIL_SOURCE_RECORDS | `entries[].participantEmail` 23 + `auditLog[].email` 19 | — | **42** |
| EMAIL_PRIVATELY_PRESERVED | `bolao_entry_private` 23 + `audit.legacy_audit_event` 19 | — | **42** |
| IP_SOURCE_RECORDS | `auditLog[].ip` | `audit.legacy_audit_event` | **19** (8 distinct) |
| IP_PRIVATELY_PRESERVED | | | **19** |
| USER_AGENT_RECORDS | `auditLog[].userAgent` 19 + `entries[].diagnostics.userAgent` 21 | | **40** (5 distinct) |
| DEVICE_RECORDS | — | — | **0** (no `device` field ever existed) |
| PLATFORM_RECORDS | `auditLog[].platform` | `audit.legacy_audit_event` | **19** (4 distinct) |
| SCREEN_RECORDS | `auditLog[].screen` | `audit.legacy_audit_event` | **19** (7 distinct) |
| VIEWPORT_RECORDS | `entries[].diagnostics.viewport` | `audit.legacy_entry_field` | **21** (19 distinct) |
| TIMEZONE_RECORDS | `entries[].diagnostics.timezone` | `audit.legacy_entry_field` | **21** (2 distinct) |
| LANGUAGE_RECORDS | `auditLog[].lang` | `audit.legacy_audit_event` | **19** (1 distinct) |
| ENTRY_CREATED_TIMESTAMPS | `entries[].createdAt` | `pool_entries.created_at` | **23 / 23** |
| ENTRY_SUBMITTED_TIMESTAMPS | derived from `createdAt` | `pool_entries.submitted_at` | **23 / 23** |
| ENTRY_UPDATED_TIMESTAMPS | `entries[].updatedAt` | `pool_entries.content_updated_at` | **23 / 23** |
| CLIENT_TIMESTAMPS | `entries[].diagnostics.capturedAt` | `audit.legacy_entry_field` | **21** |
| AUDIT_TIMESTAMPS | `auditLog[].ts` | `legacy_audit_event.occurred_at` | **19 / 19 parsed** |
| AUDIT_EVENTS | `auditLog[]` | `audit.legacy_audit_event` | **19** (all `action = edit`) |
| CHANGE_HISTORY_RECORDS | `auditLog[].changes[]` | inside `raw_event` | **195** before/after pairs |
| PAID_CONFIRMATIONS | `paid{}` | `bolao.entry_payment_confirmation` | **27** |
| TOMBSTONES | `deletedIds[]` | `bolao.pool_entry_tombstone` | **8** |
| DELETED RESULTS | `deletedResults` | — | **0** (empty object in source) |
| STATIC_JS_JSON_RECORDS | `bolao/copa2026/js/data.js` | — | **0 business records** (fixtures, flags, strength ratings only) |
| LOCALSTORAGE_KEYS | `bolao_copa_2026_state`, `bolao_draft_v4`, +8 non-business | — | **10** |
| LOCALSTORAGE_RECOVERED_RECORDS | — | — | **0** |
| LOCALSTORAGE_POTENTIAL_CLIENT_ONLY | see §3 | — | **scope stated, instances 0** |
| BACKUP_ONLY_RECORDS | 5 copa snapshots | — | **0** |
| GIT_HISTORY_ONLY_RECORDS | `send_bracket_correction_email.py` ROUTING | — | **0 unique** (16 name→email pairs, all already in production) |
| MIGRATED_EXACT | | | **5 387 field instances platform-wide; copa 4 187** |
| MIGRATED_CLEANSED | | | **0 for copa** (all 23 entries' private fields non-empty) |
| PRESERVED_PRIVATE | | | **2 536 leaves** (auditLog 2 360 · diagnostics 84 · contact 92) |
| QUARANTINED | | | **0** |
| UNRECOVERABLE | | | **0 known instances** |
| UNKNOWN | | | **0** |

Note on the paid/entry asymmetry: **27 paid keys against 23 live entries.** The four extra keys
address entries that were later tombstoned. They are preserved — `bolao.entry_payment_confirmation`
holds 50 rows platform-wide (27 + 11 + 12), so a confirmation is not dropped because its entry was.
A reconciliation that had joined `paid` to live entries would have "lost" four real confirmations
and called it clean.

Note on entry `picks` counts: 22 entries carry 160 pick leaf-fields and one carries 145 — the same
32 matches, one entry having left three matches unpicked. Not a defect; recorded so the asymmetry
is not later mistaken for loss.

## 2. Field-class presence

| Field class | Status |
|---|---|
| participant canonical ID, entry ID, entry number, source display name | PRESENT |
| email, IP, userAgent, screen, platform, lang, viewport, timezone, capturedAt | PRESENT |
| created / submitted / updated / client / audit timestamps | PRESENT |
| aliases, OS, device, browser-family, locale, server-received timestamp | **ABSENT_IN_SOURCE** — copa never recorded them |
| tie predictions, classification predictions, bracket tie topology | **ABSENT_BY_DESIGN** — copa is match-modelled |
| PDF proof, email/receipt identifiers | **ABSENT_IN_SOURCE** for copa (`roundEmail` is a br2026 structure; copa result mails were sent without a persisted ledger) |
| UNKNOWN | **0** |

## 3. Client-only scope

`bolao_copa_2026_state` is now **CLIENT_ONLY_BY_DESIGN**: since `8d6dbf98` ("the browser stops
writing to the database") copa's browser has no write path at all. Before that commit the class was
SERVER_MIRRORED_WHEN_SUBMITTED. `mergeStates()` keeps the **local** entry whenever
`updatedAt || createdAt || ""` does not sort strictly greater on the remote side — including when
both are absent, because `"" > ""` is false. So a local edit made after that commit can never reach
the server.

Maximum plausible impact: any edit to one of the 23 entries made in a participant's browser after
2026-08-12 that was never reflected server-side. **Surviving instances found: 0** — no Chrome,
Chromium, Brave, Edge or Safari profile on this machine holds Local Storage for the FerrariLabs
origin (§ CLIENT_STORAGE_AUDIT). The scope is stated because it cannot be disproven for browsers
this audit cannot reach, not because evidence of loss exists.

**COPA ACCOUNTING = 100.000%  ·  COPA RECOVERY = 100.000% of everything reachable.**
Certification: `PASS_WITH_DOCUMENTED_UNRECOVERABLE_CLIENT_SCOPE`.
