# FMEA — failure mode and effects analysis

**Workstream X.** Severity, likelihood class, detectability, preventive control, detective control and
recovery for each failure mode the programme has identified.

Status: **ANALYSIS.** Controls marked *(designed)* exist as repo tooling or specification; controls marked
*(missing)* are gaps, and are the useful part of this document.

Scales: **Severity** CATASTROPHIC / MAJOR / MODERATE / MINOR · **Likelihood** LIKELY / POSSIBLE / UNLIKELY /
RARE · **Detectability** OBVIOUS / DETECTABLE / SUBTLE / **SILENT** (produces no signal at all).

> The `SILENT` rows are the ones that matter. A CATASTROPHIC failure that screams is survivable; a MODERATE
> one that produces no signal is how a platform ends up with wrong numbers nobody questions.

---

## X-1 · Identity merged in error (two real people combined)

| | |
|---|---|
| Severity | **CATASTROPHIC** — combines two people's payments and prize entitlements; the wrong person may be paid |
| Likelihood | POSSIBLE — shared mailboxes and common names make convincing false positives |
| Detectability | **SUBTLE** — the merged history looks coherent; only the affected participant notices |
| Preventive | no automatic merge on name or email, ever; `mergeIdentities()` throws without `{operatorId, reason}`; no auto-merge entry point exists and a source scan asserts none appears; confidence is an ordinal label so no threshold can be automated *(designed)* |
| Detective | DQ-ID-01..05; `identityHistory()` per participant; a merge is audited with its reason *(designed)* |
| Recovery | `reverseMerge()` restores `prior_state` exactly; the link row is retained as history *(designed)* |
| Residual | a merge that was wrong and *not noticed* is not detectable by tooling. Mitigation is that merges are rare, operator-confirmed, and reversible. |

## X-2 · Payment allocated to the wrong entry

| | |
|---|---|
| Severity | **MAJOR** — one entry appears settled and another unpaid; a participant may be chased for money they paid |
| Likelihood | POSSIBLE — manual operator action |
| Detectability | DETECTABLE — the affected entry shows the wrong settlement |
| Preventive | `allocate_payment` validates entry existence and currency; per-payment invariant checked inside the transaction *(designed)* |
| Detective | DQ-FN-03/04/05/06; R-07/R-08/R-09 surface impossible states *(designed)* |
| Recovery | compensating allocation; never a delete *(designed)* |
| Residual | an allocation to the wrong entry of the *same* amount is arithmetically consistent and invisible to every automated check. Only the participant's own statement catches it. |

## X-3 · Over-allocation (more allocated than the payment holds)

| | |
|---|---|
| Severity | MAJOR — pool believes it collected money it does not have |
| Likelihood | UNLIKELY |
| Detectability | DETECTABLE |
| Preventive | invariant `SUM(allocations) <= payment.amount` enforced in the transaction, because a CHECK cannot see sibling rows *(designed)* |
| Detective | DQ-FN-03 *(designed)* |
| Recovery | reverse the excess allocation |
| Residual | two concurrent allocations both passing an application-level check — closed by doing the check inside the transaction, not before it |

## X-4 · Duplicate notification sent (participant receives two receipts)

| | |
|---|---|
| Severity | MODERATE — erodes trust; a duplicate payment receipt can look like a double charge |
| Likelihood | LIKELY without an outbox — the current inline send has no idempotency at all |
| Detectability | OBVIOUS to the recipient, **SILENT** to the platform |
| Preventive | outbox `idempotency_key` required at construction, enforced by a UNIQUE INDEX; `sent` is terminal and cannot be re-leased *(designed)* |
| Detective | DQ-OB-02/03; R-17 *(designed)* |
| Recovery | none — an email cannot be recalled. Prevention is the only control that matters. |
| Residual | the provider itself accepting a send twice; the idempotency key is what makes that a no-op |

## X-5 · Notification silently lost (participant receives nothing)

| | |
|---|---|
| Severity | MODERATE |
| Likelihood | LIKELY today — an inline send failure loses the notification with no record it was owed |
| Detectability | **SILENT** — nobody knows a message that was never queued should have existed |
| Preventive | the intent to notify is a durable row committed in the SAME transaction as the business change *(designed)* |
| Detective | R-17 `dead_count > 0` must alert, not merely display; DQ-OB-04 *(designed)* |
| Recovery | replay from `dead`, which is why `dead` is not a terminal state *(designed)* |
| Residual | none once the outbox exists; today this is an open exposure |

## X-6 · Partial migration (backfill dies halfway)

| | |
|---|---|
| Severity | MAJOR |
| Likelihood | POSSIBLE |
| Detectability | DETECTABLE |
| Preventive | per-entity backfills (M8–M10), each idempotent, restartable and individually validated (OC-5) *(designed)* |
| Detective | parity harness; `prePostValidate` flags anything not declared in `expected` *(designed)* |
| Recovery | re-run to completion; delete by source marker; the legacy document is untouched throughout M1–M10 *(designed)* |
| Residual | a backfill that completes but is *wrong* — covered by X-9 |

## X-7 · Backup corruption

| | |
|---|---|
| Severity | **CATASTROPHIC** if it coincides with data loss |
| Likelihood | RARE |
| Detectability | **SILENT until needed** — the defining property of this failure |
| Preventive | authenticated encryption, so a modified archive fails to decrypt rather than producing rubbish; per-object digests *(designed, Q)* |
| Detective | Q1–Q5 verification gates run at backup time, not restore time; recurring DR tests *(designed, Y)* |
| Recovery | previous archive; retention keeps more than one *(designed)* |
| Residual | every archive corrupt simultaneously — mitigated only by having more than one, in more than one place |

## X-8 · Restore produces a different schema than expected

| | |
|---|---|
| Severity | MAJOR |
| Likelihood | POSSIBLE — version skew is the usual cause |
| Detectability | DETECTABLE |
| Preventive | toolchain and server versions recorded in the manifest; restore-compatibility note *(designed, Q)* |
| Detective | P5/P6/P7/P11; unexpected-object detection *(designed)* |
| Recovery | restore with a matching client major version |
| Residual | an archive whose producing version was never recorded — the reason Q5 exists |

## X-9 · Policy / ACL drift (the programme's founding finding)

| | |
|---|---|
| Severity | **CATASTROPHIC** — a wrong grant exposes participant data or money to the internet |
| Likelihood | LIKELY without a control; it has ALREADY HAPPENED (RLS, 52 grants and 6 policies with no recorded provenance) |
| Detectability | **SILENT** — nothing in the app behaves differently when anon gains a privilege |
| Preventive | every schema change through a migration; access model validated against the schema so an undecided table is an error *(designed, O/R)* |
| Detective | `prePostValidate` treats any undeclared diff as UNACCOUNTED; a new grant is CRITICAL regardless of intent; policy bodies compared by hash *(designed)* |
| Recovery | REVOKE; re-baseline deliberately |
| Residual | drift introduced through the Supabase dashboard, which no migration sees. Only periodic snapshot comparison catches it — **this must be scheduled, and currently is not** *(missing)* |

## X-10 · Stale frontend running against a migrated database

| | |
|---|---|
| Severity | MODERATE |
| Likelihood | **LIKELY** — tabs live indefinitely on a static site; a deploy does not restart sessions |
| Detectability | OBVIOUS to the user, SILENT to the platform |
| Preventive | all changes additive through M10; flags default to OLD behaviour so a client that cannot fetch config degrades to the pre-migration path *(designed, L)* |
| Detective | none today — there is no telemetry of client versions in use *(missing)* |
| Recovery | user reloads; hard client floor forces it |
| Residual | the contract step (dropping the legacy path) cannot be justified without the client floor. This is L-OP-2. |

## X-11 · Provider sync fails silently (stale results)

| | |
|---|---|
| Severity | MAJOR — scoring freezes; results emails do not go out; participants see a stale leaderboard |
| Likelihood | POSSIBLE |
| Detectability | **SILENT** — the platform's single worst failure mode, because a stale snapshot looks exactly like "no matches finished recently" |
| Preventive | `sync_state.last_success_at` per provider; the cron already tolerates an unreachable source without failing *(designed)* |
| Detective | DQ-OP-01; R-17 `staleness_seconds` — **must alert, not merely display** *(designed, alerting missing)* |
| Recovery | re-run the sync; the cursor is restartable |
| Residual | a provider returning *stale but well-formed* data. Freshness of the provider's own content is not observable from here. |

## X-12 · Operator error (wrong result, wrong correction)

| | |
|---|---|
| Severity | **MAJOR** — a wrong result changes every score in the pool |
| Likelihood | POSSIBLE |
| Detectability | DETECTABLE — participants notice score changes quickly |
| Preventive | `admin_correction` limited to an ALLOWLIST of fields; results are superseded, never overwritten; every privileged action requires a stated reason *(designed)* |
| Detective | audit chain; `result_corrected` events; R-16 *(designed)* |
| Recovery | supersede with a corrected row; the correction history explains why a score changed *(designed)* |
| Residual | a plausible wrong result that nobody questions |

## X-13 · Scoring parity failure (migration changes a score)

| | |
|---|---|
| Severity | **CATASTROPHIC** — money is paid on these numbers |
| Likelihood | POSSIBLE — jsonb key order, string-vs-integer goals, missing-vs-zero picks and timezone-offset timestamps are all real hazards |
| Detectability | **SUBTLE** — a changed rank looks like a legitimate result of a recorded match |
| Preventive | scoring parity contract N-1..N-8: parity proved at the input boundary and the function left untouched; no scoring reimplementation, asserted by source scan *(designed)* |
| Detective | the three `audit_scoring.py` suites; M16 cannot complete unless parity holds *(designed)* |
| Recovery | `picks` jsonb is RETAINED through M16, so the old input path remains available *(designed)* |
| Residual | a parity harness that passes on synthetic fixtures but not on production-shaped data. Mitigation: N must run on production-shaped volumes before M16 is declared complete. |

---

## Gaps this analysis exposes

| Gap | Failure modes affected | Action |
|---|---|---|
| **No scheduled snapshot comparison** for policy/ACL drift | X-9 | schedule `prePostValidate` against a stored reference snapshot; dashboard changes are invisible otherwise |
| **No alerting** on `dead_count` or `staleness_seconds` — only a report someone must look at | X-5, X-11 | wire R-17 to an alert; a silent failure with a dashboard is still a silent failure |
| **No client-version telemetry** | X-10 | required before any contract step (L-OP-2) |
| **Parity not yet run on production-shaped data** | X-13 | prerequisite for M16 |

Three of the four gaps are about **detecting silent failures**, which is consistent with the pattern across
this table: the controls that exist are mostly preventive, and the weakest area is noticing when something
went wrong anyway.
