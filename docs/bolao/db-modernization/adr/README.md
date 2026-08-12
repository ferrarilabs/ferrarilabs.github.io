# ADR-K — index

The eleven Campaign K++ decision records, mirrored here **verbatim** so every `ADR-K` citation in
this repository resolves without leaving it.

## Why they are mirrors, not summaries

These were authored in the campaign's non-Git workspace, which is where its operational evidence
lives — restore rehearsals, privilege probes, production measurements. That evidence stays out of
Git. The DECISIONS do not need to: they were scanned before mirroring and contain no credential, no
participant, no payment reference and no PII. Their evidence is cited by filename and digest, never
by value, which is what makes them safe to version and is why summarising them would lose exactly
the part a reviewer needs.

Accepted wording is preserved byte for byte. A decision that is re-argued is a new ADR, not an edit
to an old one.

## Authoritative source

`~/Documents/GitHub/ferrarilabs-work/db-modernization/autonomous-campaign/adr/` — the campaign
workspace. If the two ever diverge, that one is authoritative and this mirror is stale; the check in
`scripts/db/test_adr_citations.mjs` compares them.

## The eleven

| id | decision | status |
|---|---|---|
| [ADR-K01](ADR-K01-audit-chain-and-append-only.md) | server-generated audit hash chain, and append-only enforcement | ACCEPTED |
| [ADR-K02](ADR-K02-entry-label-disambiguation.md) | disambiguating entry labels so a second entry survives the migration | ACCEPTED |
| [ADR-K03](ADR-K03-payment-allocation-integrity.md) | the payment-allocation invariants are enforced by the database, not by the caller | ACCEPTED |
| [ADR-K04](ADR-K04-match-side-attribution.md) | `home_team` / `away_team` are the fixture's first- and second-listed sides | ACCEPTED |
| [ADR-K05](ADR-K05-request-idempotency-store.md) | the request idempotency store | ACCEPTED |
| [ADR-K06](ADR-K06-bulk-audit-chain-construction.md) | bulk audit chain construction for the M10 backfill | ACCEPTED |
| [ADR-K07](ADR-K07-m10-promotion-privilege-model.md) | the M10 promotion's trigger suspension and privilege model | ACCEPTED |
| [ADR-K08](ADR-K08-table-privileges-derived-from-access-model.md) | table privileges, derived from the access model | ACCEPTED |
| [ADR-K09](ADR-K09-deferred-cross-row-invariants.md) | the cross-row invariants, as deferred constraint triggers | ACCEPTED |
| [ADR-K10](ADR-K10-two-migration-channels-on-one-database.md) | Two migration channels write the same production database, and only one of them knows it | UNKNOWN |
| [ADR-K11](ADR-K11-class-ceiling-is-not-a-grant-list.md) | TARGET_POLICY.TABLE is a class CEILING, not a per-table grant list | UNKNOWN |

## Citations

`scripts/db/test_adr_citations.mjs` scans every versioned file for `ADR-K\d\d`, resolves each
against this directory, and fails on any citation that names a record that does not exist.

