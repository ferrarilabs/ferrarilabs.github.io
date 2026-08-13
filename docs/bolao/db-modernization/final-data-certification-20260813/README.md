# FINAL DATA CERTIFICATION — 2026-08-13 (`FDC-20260813`)

Sanitized subset of the forensic audit and its post-audit closure. **Counts, tokens, fingerprints
and masked values only — no raw PII, by construction and by sweep.**

The complete evidence set (126 artifacts, including two full production clones and the raw
address/IP working sets) is **deliberately not in Git**. It lives at

    ~/Documents/GitHub/ferrarilabs-work/audits/final-data-certification-20260813/

which is not a repository, with `private/` at mode 700, and is backed up as
`backups/forensic-audit-package-20260813.tar` for operator encryption via the existing
`encrypt_backup.sh`. `EVIDENCE_MANIFEST.md` here lists every artifact with a SHA-256 and a privacy
class, so the private set is verifiable without being published.

## What the audit certified

`FINAL_DATA_AUDIT = PASS_WITH_DOCUMENTED_UNRECOVERABLE_CLIENT_SCOPE` ·
accounting **100.000%** · recoverable preservation **100.000%** · `UNKNOWN = 0` ·
row lineage **100.000%** · field lineage **100.000%**.

Not plain `PASS`: `bolao_copa_2026_state` has been client-only since `8d6dbf98`, so a participant's
browser can hold copa state the server will never receive. Zero surviving instances were found; the
class exists, so the status names it.

## What it changed in production

| Ledger | What |
|---|---|
| `20260813200000` | closed a **live anonymous PII exposure** — `bolao_state_public` was serving 19 copa audit records with email, IP, userAgent, screen, platform and lang, plus 21 entries' diagnostics, to the browser's publishable key |
| `20260813210000` | three private, fail-closed forensic tables so legacy retirement cannot destroy auditLog (69 records, **three** shapes), copa diagnostics, or the raw form of the private entry fields |
| `20260813220000` | fail-closed `cdb_update_entry_picks` — a `service_role`-executable writer that would have written participant picks to the legacy document with **no** normalized mirror |
| `20260813230000` | decision **D-B**: operator-approved correction of one malformed address, raw preserved, no identity merged |

## The two findings that mattered most

1. **The sanitiser named four fields and missed the fifth.** `bolao_state_public` stripped four
   entry keys and was never taught about `diagnostics` (added later to the same objects) or
   `auditLog` (a sibling of `entries`, never in scope of a projection that only rewrites `entries`).
   Q38 had been verified against the base table and the normalized contract, never against the
   view PostgREST actually serves.

2. **The first rebase of `20260813050000` fixed the input and not the write.** It substituted the
   legacy-document read for `cdb_authoritative_document()` — the same substitution the cutover
   applied to the other four writers — but `cdb_save_my_picks` is the one writer whose cutover also
   *added* a mirror call. The result read normalized, validated against normalized, reported
   `NORMALIZED-INPUT` to every detector, and wrote the participant's picks to the legacy document
   alone. Proven on a clone: save returned `{"updated": true}`, `bolao.predictions` stayed 1045,
   `mirrored_at` stayed 0.
