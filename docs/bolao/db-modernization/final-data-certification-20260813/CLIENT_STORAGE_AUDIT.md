<!-- FDC-20260813-140645Z · no raw PII -->

# CLIENT STORAGE AUDIT

## 1. Contract inventory — 31 keys, every one classified

Full inventory with schema, purpose, read/write/merge path and recoverability class is in
`LOCALSTORAGE_RECOVERY_LEDGER.csv`. Summary:

| | Count |
|---|---:|
| keys discovered (current tree + full Git history) | **31** |
| of which can hold business data | **4** |
| `indexedDB` usage | **0** |
| `storage` event handlers | **0** |
| `UNKNOWN_LOCALSTORAGE_KEYS` | **0** |

The four business keys:

| Key | Product | Store | Recoverability |
|---|---|---|---|
| `bolao_copa_2026_state` | copa2026 | localStorage | **CLIENT_ONLY_BY_DESIGN** since `8d6dbf98` |
| `bolao_br2026_state` | br2026 | localStorage | **SERVER_MIRRORED_WHEN_SUBMITTED** — `submit_entry`, now allowlist-empty, pool closed 2026-07-16 |
| `bolao_cdb2026_state` | cdb2026 | localStorage | **SERVER_MIRRORED_WHEN_SUBMITTED** — `cdb_save_my_picks` |
| `bolao_draft_v4` | copa2026 | sessionStorage | **CLIENT_ONLY_BY_DESIGN** — 2 h expiry, never sent until submit |

Three historical keys (`bolaoLang`, `bolaoAdminOk`, `bolaoAdminUntil`) were superseded by the
`bolao_*` renaming and carried no business data. `br2026_schedule_${siteVersion}` is a
version-templated cache key — recorded as a family, not as one key.

`ALWAYS_SERVER_MIRRORED = 0` · `SERVER_MIRRORED_WHEN_SUBMITTED = 2` ·
`CLIENT_ONLY_BY_DESIGN = 29` · `UNKNOWN = 0`.

## 2. `mergeStates()` forensics — why recoverability is not uniform

All three apps share the entry-freshness rule:

```js
const remoteTs = e.updatedAt || e.createdAt || "";
const localTs  = existing.updatedAt || existing.createdAt || "";
if (remoteTs > localTs) byId[e.id] = e;
```

| Question | Answer |
|---|---|
| CAN_LOCAL_WIN? | **yes** — whenever `remoteTs` does not sort *strictly* greater, as a **string** |
| UNDER_WHAT_CONDITION? | equal instants, equal spellings, or a local `updatedAt` that sorts later |
| CAN_UNDATED_LOCAL_WIN? | **yes** — `"" > ""` is false, so an undated local entry is kept over an undated remote one |
| CAN_CLIENT_ONLY_PICKS_EXIST? | **yes**, for cdb2026 until the participant saves, and for copa2026 **permanently** |
| WHEN_DOES_THE_SERVER_RECEIVE_THEM? | cdb2026: on `cdb_save_my_picks`. br2026: on `submit_entry` (now shut). copa2026: **never** |
| CAN_BROWSER_STATE_DIVERGE_FOREVER? | **yes, for copa2026** |

This is also why entry `updatedAt` is the one timestamp that may never be given a serialization
allowance: the comparison is lexical, so two spellings of the same instant are not equal here even
though they are equal everywhere else.

The audit-log merge is a separate mechanism and was fixed during the read cutover: `auditKey()`
dedupes on `(instant, clientRef)` and `auditStamp()` reads **`ts` or `at`**, because the earlier
version silently discarded every record without `ts` — the defect that forced the READ_CUTOVER
revert `ae0720dd` and its fix `84d2a069`.

## 3. Controlled browser forensics

Scope: only browser storage belonging to the FerrariLabs bolão origins on this machine. No
unrelated origin was accessed and no unrelated profile was read.

| Browser | Profile data present | Local Storage for the FerrariLabs origin |
|---|---|---|
| Google Chrome | directory exists, **empty** | **none** |
| Chromium | `NativeMessagingHosts` only | **none** |
| Brave | directory exists, **empty** | **none** |
| Microsoft Edge | directory exists, **empty** | **none** |
| Safari | `LocalStorage` directory **empty** | **none** |

Six LevelDB stores exist on the machine; all six belong to **Electron applications** (GitHub
Desktop, Claude, Codex), and their `ferrarilabs` string matches are repository paths, not bolão
keys — none contains `bolao_copa_2026_state`, `bolao_br2026_state` or `bolao_cdb2026_state`.

```
CONTROLLED_BROWSER_STORES_FOUND        0
LOCALSTORAGE_RECORDS_RECOVERED         0
LOCALSTORAGE_UNIQUE_RECORDS_RECOVERED  0
```

**No localStorage content was fabricated.** Zero is a measurement, not an assumption.

## 4. PHYSICALLY_UNRECOVERABLE_CLIENT_ONLY

| | |
|---|---|
| Product | copa2026 (primary), cdb2026 (unsaved picks only) |
| Storage key | `bolao_copa_2026_state`, `bolao_draft_v4`, `bolao_cdb2026_state` |
| Field classes | entry picks, entry `updatedAt`, locally-appended `auditLog` records |
| Historical period | copa: from `8d6dbf98` (2026-08-12) onward, permanently. cdb: between a participant's edit and their save |
| Conditions required | a participant's browser holding state that the server never received |
| Evidence | `mergeStates()` semantics above; copa has no write path at all |
| **Known surviving instances** | **0** |
| Maximum plausible impact | bounded by 23 copa entries and 12 cdb entries; **not determinable below that bound**, because it depends on browsers this audit cannot reach |

This **does not** prevent 100% accounting — the fate of the class is known and recorded. It does
prevent an unqualified claim of 100% *recovery*, which is why the certification status is
`PASS_WITH_DOCUMENTED_UNRECOVERABLE_CLIENT_SCOPE` and not plain `PASS`.
