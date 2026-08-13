<!-- FDC-20260813-140645Z · no raw PII -->

# DATA CLEANSING RULE REGISTRY

Every rule this audit recognises. A transform that is not in this registry did not happen.

| RULE_ID | Ver | Field class | Description | Deterministic | Lossless | Reversible | Input condition | Transformation | Target | Operator approval |
|---|---|---|---|---|---|---|---|---|---|
| `IDENTITY` | 1 | all | value carried unchanged | yes | yes | yes | always | none | normalized / private | no |
| `EMPTY_TO_NULL` | 1 | entry private text | empty string becomes NULL | yes | **yes, given raw preservation** | yes | `raw = ''` | `NULL` | `bolao_entry_private` | no |
| `RAW_ONLY` | 1 | diagnostics, provenance, ledgers | no canonical form defined; raw is the record | yes | yes | n/a | non-string or no defined canonical | none | `legacy_entry_field` / archive | no |
| `TIMESTAMP_CANONICAL_SERIALIZATION` | 1 | `kickoff`, `lockedAt`, `cutoffAt` | same instant re-emitted with the canonical offset | yes | yes | yes (instant preserved) | ISO-8601 with a non-canonical offset | canonical offset | phases / matches / ties | no |
| `INSTANT_PARSE_WITH_PROVENANCE` | 1 | `auditLog.ts` ‖ `.at` | parse to `timestamptz` **and record which key carried it** | yes | yes | yes | matches the strict ISO pattern | `::timestamptz`; unparseable → NULL + raw | `legacy_audit_event` | no |
| `ARRAY_POSITION_TO_ORDINAL` | 1 | br zone picks | array index becomes an explicit ordinal column | yes | yes | yes | `picks.{g4,z4,sa6}[i]` | `ordinal = i` | `classification_predictions` | no |
| `OBJECT_KEY_TO_ROW` | 1 | `paid`, `deletedIds` | map key / array element becomes a row | yes | yes | yes | always | reshape | payment confirmation / tombstone | **KPLUS_OP_4A** |
| `FIELD_RENAME` | 1 | A/B → home/away, `createdAt` → `submitted_at` | rename with no value change | yes | yes | yes | always | rename | normalized | no |

## Rules deliberately NOT defined

| Not defined | Why |
|---|---|
| `EMAIL_CASE_NORMALIZATION` | no address needed it; the private table is byte-identical to the document in all 46 cases. Defining a rule nobody applied invites someone to apply it later |
| `TRIM_WHITESPACE` | measured: **0** values with leading/trailing whitespace |
| `UNICODE_NORMALIZATION` | measured byte-for-byte: the accented club names (`Atlético-MG`, `Grêmio`, `São Paulo`, `Vitória`) are **identical NFC bytes** on both sides. An earlier pass of this audit reported a divergence here; it was an artifact of `json.dumps(ensure_ascii=True)` in the comparator, not of the data, and the byte comparison settled it |
| `BOOLEAN_NORMALIZATION` | `paid` values are already JSON booleans; no `"true"`/`1`/`"yes"` forms exist |
| `KNOWN_APPROVED_ALIAS` | no alias mapping exists on this platform and none was created |
| `INVALID_FORMAT_QUARANTINE` | **defined in the model and used once.** 69/69 instants parse and 19/19 IPs parse, but **1 of 46 addresses is malformed** (trailing comma in the domain). It is quarantined, not transformed — see `EMAIL_AUDIT.md` §3b and decision **D-B** |

## Safe vs unsafe

**SAFE, auto-remediated after rehearsal:** `EMPTY_TO_NULL` (already applied historically, now made
falsifiable), `INSTANT_PARSE_WITH_PROVENANCE`, `RAW_ONLY` capture, `TIMESTAMP_CANONICAL_SERIALIZATION`
(already converged).

**UNSAFE, not attempted:** identity merge · email correction · timezone inference · payer →
participant inference · IP ownership · device ownership · ambiguous timestamp semantics · ambiguous
historical prediction.

**One arose: email correction.** A single address has a trailing comma in its domain. The repair is
one character and still was not made — see `EMAIL_AUDIT.md` §3b. Disposition
`QUARANTINED_WITH_REASON`, operator decision **D-B**.
