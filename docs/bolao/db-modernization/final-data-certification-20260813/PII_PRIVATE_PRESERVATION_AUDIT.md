<!-- FDC-20260813-140645Z · no raw PII -->

# PII PRIVATE PRESERVATION AUDIT

## The principle this audit had to prove

> `REMOVED_FROM_PUBLIC` ≠ `DELETED_FROM_HISTORY`

The read cutover removed PII and diagnostics from the public surface. This audit had to show that
each removed value still exists somewhere private and durable — and, where it did not, to build the
smallest structure that makes it so.

## Before and after, per field class

| Field class | Instances | Private target **before** this audit | Private target **now** |
|---|---:|---|---|
| `participantEmail` | 46 | `public.bolao_entry_private` | + `audit.legacy_entry_field` (raw) |
| `payerName` / `paymentMethod` / `paymentTo` | 44 / 45 / 23 | `public.bolao_entry_private` | + raw, incl. the 3 `""` originals |
| `auditLog[].email` (copa) | 19 | **none** | `audit.legacy_audit_event.raw_event` |
| `auditLog[].ip` (copa) | 19 | **none** | `audit.legacy_audit_event.raw_event` |
| `auditLog[].userAgent` / `screen` / `platform` / `lang` (copa) | 19 each | **none** | `audit.legacy_audit_event.raw_event` |
| `entries[].diagnostics.*` (copa) | 84 | **none** | `audit.legacy_entry_field` |
| `entries[].lastClientRef` (cdb) | 2 | **none** | `audit.legacy_entry_field` |
| whole legacy documents | 3 | **legacy row only** | `audit.legacy_document_archive` (verbatim + sha256) |

`PRIVATE_DATA_PRESERVATION_PERCENT = 100.000`.

## The private model, and why it is this small

Three tables, each with a reason it could not be folded into another:

- **`legacy_document_archive`** — the safety net. Whole documents, byte-verified, so no section
  anyone forgot to enumerate can be lost. A blob is evidence, not a queryable record, which is why
  it is not the whole answer.
- **`legacy_audit_event`** — auditLog is the declared retirement prerequisite and must be
  *addressable*, not just archived. Raw payload intact, plus only the canonical fields that are
  deterministic.
- **`legacy_entry_field`** — per-entry values with no normalized column, plus the **raw** form of
  the four that do have one, so the `EMPTY_TO_NULL` cleansing stays falsifiable after retirement.

No generic key/value store was built for `roundEmail`, `scheduleProvenance`, `espnSync`, `meta` or
the residue picks: the archive holds them verbatim and inventing a schema for data with one
instance each is the over-engineering §69 forbids.

## Fail-closed, verified three ways

| Check | Result |
|---|---|
| `audit` schema USAGE for `anon` / `authenticated` | **false / false** |
| RLS on all three tables | **enabled and FORCED**, **0 policies** |
| explicit grants | `revoke all … from public, anon, authenticated` |
| live API, real publishable key | `legacy_document_archive` **404** · `legacy_audit_event` **404** · `legacy_entry_field` **404** |

The migration itself raises if any of the first three regress.

## Financial metadata

Searched and found: `paymentTo` (23, copa only), `payerName` (44), `paymentMethod` (45),
Powerball `txId` (adjacent product). **No amount, currency, settlement, allocation, balance or
prize field exists in any bolão source.**

`paid` is preserved under **KPLUS_OP_4A semantics only** — a source-backed positive "marked
confirmed paid" assertion, 50 rows, nothing inferred. `payerName` / `paymentMethod` / `paymentTo`
are preserved as `PRESERVED_UNMODELLED_WITH_SEMANTICS`: raw, private, **not** converted into
payment accounting. `bolao.payments`, `payment_allocations`, `prize_allocations` remain **0 / 0 / 0**
and KPLUS_OP_4B stays **PARKED**.
