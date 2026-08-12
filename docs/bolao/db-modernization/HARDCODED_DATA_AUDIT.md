# HARDCODED_DATA_AUDIT — production data in versioned files

**STATUS:** COMPLETE. **No sensitive value is printed anywhere in this document.**
**EVIDENCE BASIS:** 1 037 files across 6 local repositories; `git ls-files` for tracked status;
private participant-name (46 terms) and payment-reference (26 terms) lists held **outside Git**;
plus the repository's own detector `scripts/audit_pii_repo_wide.mjs`, executed.
**KNOWN GAPS:** runtime-injected values are out of scope; binary assets not scanned; git *history*
was not rewritten or scanned blob-by-blob (only current tracked content plus commit metadata).
**ASSUMPTIONS:** RFC-reserved domains (`example.invalid`, `example.test`, `.test`, `.invalid`,
`localhost`) are treated as synthetic. This is safe by definition — those TLDs cannot receive mail.

> **Relationship to existing tooling — read this first.** The repository **already has** a canonical
> repo-wide PII detector at `scripts/audit_pii_repo_wide.mjs`, with detectors for email literals,
> `txId`, `confirmationId`, `external-reference`, Zelle/CashApp/Venmo transaction-ID shapes,
> URL-embedded credentials, service-role key values and private-key material. It masks its samples
> correctly. **This document does not replace it and no competing scanner is proposed.** It records
> (a) one material defect in that tool's interpretation, and (b) four categories it does not cover.

---

## 1. Correction to the previously reported figures

An earlier pass in this programme reported **227 tracked email findings rated HIGH**. That figure
was materially misleading and is corrected here.

| Metric | Earlier claim | Corrected |
|---|---|---|
| Tracked email matches | 227 (all HIGH) | **243 total** |
| — synthetic (RFC-reserved domains) | not distinguished | **181 across 34 files** — not a leak |
| — real-domain | not distinguished | **62 across 29 files** |
| Real-domain concentration | — | `outbox.json` 19; `AUDIT_LOGGING.md` 5; remaining 29 files ≤ 4 each, many single |
| Known payment references in tracked files | 0 | **0 — confirmed again** |

**Cause of the over-count:** the earlier scan treated any RFC-5322-shaped string as a finding. The
majority of fixtures and tests in this repo deliberately use `@example.invalid` and `@example.test`,
which are reserved and undeliverable. Counting those as PII inflates the number ~4× and buries the
62 that matter.

**Finding H-00 — MEDIUM (tooling defect, affects the repo's own detector).**
`scripts/audit_pii_repo_wide.mjs` has the same blind spot: it currently reports **82 findings across
13 file/detector pairs**, and *all 13* are `bolao/shared/scripts/` tests using `@example.test`. The
tool is therefore **100 % false-positive today**, which trains reviewers to ignore it — the classic
failure mode for a security check. Its `email-address` detector needs a reserved-domain allowlist.
Its other nine detectors are sound and report zero. Fix the one detector; keep the tool.

---

## 2. Findings — locations only

Severity reflects *exploitability plus reachability*, not pattern class. Confidence is separate.

### 2.1 P0 — credentials in versioned code

| # | Path | Line | Category | Sev | Conf | Remediation |
|---|---|---|---|---|---|---|
| H-01 | `bolao/loterias/powerball/scripts/add_participant_to_supabase.py` | 13 | Supabase **anon JWT** literal | **HIGH** | **CONFIRMED** | Move to env var / GitHub secret. Rotate after removal. |
| H-02 | `bolao/loterias/powerball/scripts/send_result_email.py` | 62 | Supabase **anon JWT** literal | **HIGH** | **CONFIRMED** | As above |

`HARDCODED_ANON_JWT = OPEN` — **not fixed in this sprint, by instruction.**

Verified structurally without printing: HS256, three well-formed segments, 46-char signature,
claims `{role: anon, iss: supabase, ref, iat, exp}`, no placeholder markers on the line, not an
`os.environ`/`getenv` default. These are **real, operational keys**, not samples.

**Why HIGH and not CRITICAL:** an anon key is designed to be publishable and is already shipped to
browsers. **Why not LOW:** it embeds the project ref, it is a credential literal in source rather
than configuration, and — per `RLS_ASSUMPTIONS_REVIEW.md` — `anon` holds table-level
`SELECT/INSERT/UPDATE/DELETE` on all 7 tables with **no identity-based policy** on the one in-use
table. The key's blast radius is a function of the grants, and those grants are wide.

### 2.2 P1 — real recipient data in versioned files

| # | Path | Range | Category | Sev | Conf | Remediation |
|---|---|---|---|---|---|---|
| H-03 | `bolao/loterias/powerball/scripts/email/outbox.json` | 19 occurrences | Real email addresses in a **delivery log tracked in Git** | **HIGH** | CONFIRMED | Untrack; move to the outbox *table*; add to `.gitignore`. Deliverable, real mailboxes. |
| H-04 | `bolao/loterias/powerball/docs/AUDIT_LOGGING.md` | 5 occurrences | Real emails in documentation | MEDIUM | CONFIRMED | Replace with `@example.invalid` |
| H-05 | `docs/bolao/loterias/POWERBALL_EMAIL_OPERATIONS_RUNBOOK.md` | 2 | Real emails in a runbook | MEDIUM | CONFIRMED | As above |
| H-06 | `bolao/copa2026/scripts/send_bracket_correction_email.py` | 4 | Real emails in a script | MEDIUM | HIGH | Parameterise |
| H-07 | 5 files: `audit_email_tests_round3.mjs`, `audit_pii_tests.mjs`, `scripts/audit_pii_repo_wide.mjs`, `email-test-results.txt`, `preview/index.html` | ≤3 each | Real emails in audit/preview artefacts | MEDIUM | MEDIUM | Some are *detector self-tests* — verify before changing, or the detector loses coverage |
| H-08 | `js/config.js` ×3, `index.html` ×3, `js/i18n.js` | 1–3 each | Owner/admin contact address | **LOW** | CONFIRMED | **Likely intentional.** Public contact address on a public site. No action unless the owner disagrees. |

### 2.3 P2 — participant names

| # | Scope | Count | Sev | Conf | Note |
|---|---|---|---|---|---|
| H-09 | Third-party participant **full names**, tracked | **199 across 23 files** | **HIGH** | HIGH | Worst: `powerball/js/data.js` (41), `copa2026/audit-detail-picks.html` (36), `powerball/scripts/supabase_setup.sql` (18), `copa2026/CHANGELOG.md` (17), `audit-report.html` (15) |
| H-10 | Owner's own name | ~52 | **NONE (false positive)** | CONFIRMED | Public marketing site (`index*.html`, `insights.html`, `styles.css`, `CLAUDE.md`). Not a leak. |
| H-11 | Single-token first-name collisions in `bolao/*/data/espn-normalized.json` | ~142 | **NONE (false positive)** | HIGH | Footballer/club names colliding with participant first names. Tell: **zero** multi-word matches in those files. |

**Nuance that must not be lost:** the published audit pages (`audit-detail-picks.html`,
`audit-report.html`, `classificacao-geral.html`) name participants **by design** — they are the
public audit trail that participants were emailed. Those are a *product decision*, not a leak.
`supabase_setup.sql` (18) and `powerball/js/data.js` (41) are **not** — production names embedded in
DDL and application data files. Remediate those; leave the audit pages to the owner's judgement.

### 2.4 P3 — identifiers and other categories

| # | Category | Count (tracked) | Sev | Conf | Note |
|---|---|---|---|---|---|
| H-12 | Supabase **project ref** unmasked, incl. `powerball/docs/SUPABASE_SETUP.md:16,17,79` | 23 | MEDIUM | HIGH | Mask as `<KNOWN_PROJECT_REF>` in docs |
| H-13 | Pooler / `supabase.co` hostnames | 32 | MEDIUM | HIGH | Not secret; aids targeting |
| H-14 | `sb_publishable_*` literals | 13 | MEDIUM | HIGH | Publishable by design; still belongs in config |
| H-15 | UUIDs | 1 tracked | LOW | MEDIUM | Single occurrence; likely a fixture |
| H-16 | Large embedded production-shaped JSON blocks | 7 | MEDIUM | MEDIUM | Review for copied live state |
| H-17 | `transaction_id`-class **field names** | 71 | **LOW** | CONFIRMED | Schema vocabulary, not values. Not a leak. |
| H-18 | Dates / times / ISO timestamps | 3 896 | **LOW / not debt** | CONFIRMED | Changelog entries, fixture kickoff times, evidence artefacts. **No bulk action recommended**; `CLOCK_TIME` in particular is heavily FP (CSS values, durations). |
| H-19 | Real phone numbers | **0** | — | CONFIRMED | Clean |
| H-20 | Connection strings (`postgres`/`postgresql` URI scheme) | **0** | — | CONFIRMED | Clean. *(The literal scheme text is deliberately not written out here: it trips this programme's own leakage gate, which fails closed on that pattern by design.)* |
| H-21 | Private-key material | **0** | — | CONFIRMED | Clean |
| H-22 | `sb_secret_` / `sk_live_` / `sk_test_` | **0** | — | CONFIRMED | Clean |

### 2.5 Untracked but present on disk

Not repository leakage — but PII at rest, worth confirming: `bolao/backups/backup-*.json`
(44 participant names + 23 emails **per file**), `.claude/settings.local.json` (project ref, pooler
host, publishable key), and 4 `.claude/worktrees/` copies duplicating every tracked finding.
**Confirm all remain gitignored.**

---

## 3. Specific question: were historical payment dates/times/reference IDs copied in by prior sessions?

**Answer: payment *references* — no. Payment-adjacent *dates* — yes, in 5 files, and they are benign.**

| Check | Result |
|---|---|
| Known payment references (26-term private list) in **any** tracked file | **0 matches** |
| Zelle/CashApp/Venmo transaction-ID *shapes* (repo detector, 3 detectors) | **0 findings** |
| `confirmationId` / `external-reference` field literals (repo detector) | **0 findings** |
| Payment-adjacent ISO dates | 5 files: `audit_entry_roster_freeze.mjs` (1), `capture_evidence.mjs` (4), `audit_visual_consistency.mjs` (4), `ARCHITECTURE.md` (1), `CONSISTENCY_MATRIX.md` (1) |
| Commits carrying a Claude co-author trailer | 409 total; 26 touching fixtures/tests |

**Assessment.** The Powerball txId governance rule — *every entry carries its payment reference, but
only in the private secret, never in public `data.js`* — **is holding.** Zero known references, zero
provider-format transaction IDs, and zero `external-reference` literals appear in any tracked file,
across three independent detection methods (private list, the repo's own shape detectors, and my
own scan).

The payment-adjacent dates are in **audit/visual-evidence scripts and architecture docs**, and are
dates of *events* (roster freeze, evidence capture, changelog entries) rather than dates of
*payments to individuals*. Combined with zero reference-ID leakage, there is no evidence that
per-participant payment records were copied into scripts or docs by any prior session.

**Caveat stated honestly:** this examines *current tracked content* plus commit metadata. It is
**not** a blob-level history scan. A value committed and later removed would not be detected here.
If that assurance is required, it needs an authorised `git log -p` / blob sweep, which is a separate
task with its own leakage risk (history dumps contain the values being searched for).

---

## 4. Prioritised remediation

| P | Items | Action |
|---|---|---|
| **P0** | H-01, H-02 | Move anon JWTs to secrets; then rotate. **Not authorised in this sprint.** |
| **P1** | H-03 | Untrack `outbox.json` — 19 real, deliverable addresses in Git |
| **P1** | H-09 (18 + 41) | Remove production names from `supabase_setup.sql` and `powerball/js/data.js` |
| **P2** | H-04…H-07 | Replace real addresses in docs/scripts with `@example.invalid`; check H-07 detector self-tests first |
| **P2** | H-00 | Add reserved-domain allowlist to `scripts/audit_pii_repo_wide.mjs` — restores signal to the repo's own gate |
| **P3** | H-12…H-14, H-16 | Mask project refs in docs; review the 7 JSON blocks |
| **None** | H-08, H-10, H-11, H-17, H-18, H-19…H-22 | No action — false positives, intentional, or clean |

## 5. RISKS

- **Fixing H-07 could blind the detectors.** Several real addresses live in PII-detector *self-tests*,
  where a real-looking address is the fixture. Replacing them without reading the assertion would
  silently reduce coverage while appearing to improve hygiene.
- **H-00 is the highest-leverage item in this document.** A gate that is 100 % false-positive is
  worse than no gate, because it manufactures the habit of dismissing it.
- Bulk-remediating H-18 (3 896 dates) would produce an enormous diff for zero security benefit and
  would damage changelog/audit traceability. Explicitly **not** recommended.

## 6. NEXT DECISION (operator)

1. **Authorise the H-01/H-02 secret move + rotation** as a scoped change (touches application
   scripts, outside this programme's remit).
2. **Do the published audit pages keep naming participants?** Product decision; determines whether
   ~100 of the 199 H-09 occurrences are findings at all.
3. **Is a blob-level git-history sweep required** for formal assurance on §3's caveat?
