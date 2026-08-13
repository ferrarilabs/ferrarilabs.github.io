<!-- FDC-20260813-140645Z · no raw PII -->

# PUBLIC SECURITY RE-CERTIFICATION

## G1 — the finding

Q38 was closed on two true statements that did not cover the surface that mattered: `anon` cannot
read `public.bolao_state` (401) and cannot enter the `bolao` schema. Neither says anything about
the two F10 sanitising **views**, which are owner-evaluated (`security_invoker` unset), granted
SELECT to `anon`, and therefore exposed by PostgREST.

Measured with the browser's real publishable key, before remediation:

```
GET /rest/v1/bolao_state_public?id=eq.main   →  HTTP 200, 141 872 bytes
```

| Leaked | Records | Distinct |
|---|---:|---:|
| `auditLog[].email` | 19 | **10** |
| `auditLog[].ip` | 19 | **8** |
| `auditLog[].userAgent` | 19 | 5 |
| `auditLog[].screen` | 19 | 7 |
| `auditLog[].platform` | 19 | 4 |
| `auditLog[].lang` | 19 | 1 |
| `entries[].diagnostics.{userAgent, viewport, timezone, capturedAt}` | 21 entries | 5 / 19 / 2 / 21 |

Scope: **copa2026 (`main`) only.** br2026 and cdb2026 leaked no PII; cdb2026 exposed only
`lastClientRef`, an idempotency token that is useless without the entry access token.

**Root cause:** the view strips four *named* keys from `entries[]`. `diagnostics` arrived on the
same objects later and was never added; `auditLog` is a **sibling** of `entries` and was therefore
never in scope of a projection that only rewrites `entries`. A sanitiser that enumerates fields
fails silently every time the document grows one — the same failure mode as the hand-enumerated
`mergeStates` base object that lost four cdb2026 fields in a row before it was replaced by a spread.

## The fix

Ledger `20260813200000`. Both views now remove the whole `auditLog` section and strip
`participantEmail, payerName, paymentMethod, paymentTo, txId, diagnostics` from every entry.

Removing `auditLog` is **not a new policy**: `AUDITLOG_PUBLIC_PROJECTION = EXCLUDED` is already the
platform contract, `bolao.read_document()` emits no `auditLog`, and all three browsers have been
reading the normalized surface for a day at 0 BUG / 0 UNKNOWN. The legacy projection had simply
never been told.

**Revoking SELECT was rejected**, because two live readers use these views with the anon key —
`bolao/copa2026/scripts/backup_watch_m88.py` (needs `results`) and
`bolao/br2026/scripts/operator_cli.py` (needs entries for its masked diff). Neither reads `auditLog`
or `diagnostics`. Sanitising keeps both readers and removes 100% of the exposure; revoking would
have removed the exposure and broken both. Their needs are asserted **inside the migration**, which
refuses to commit if copa's `results` or br2026's `roundEmail` stop being projected.

## Re-certification — live API, real publishable key, after remediation

| Endpoint | HTTP | Emails | IPs | Violations |
|---|---:|---:|---:|---|
| `bolao_state` (raw table) | **401** | — | — | — |
| `bolao_entry_private` | **401** | — | — | — |
| `cdb_entry_access` | **401** | — | — | — |
| `bolao_state_public` (3 docs) | 200 | **0** | **0** | **NONE** |
| `bolao_state_public_cdb` (1 doc) | 200 | **0** | **0** | **NONE** |
| `bolao_state_normalized_public` (3 docs) | 200 | **0** | **0** | **NONE** |
| `bolao_notif_jobs` | 200 | 0 | 0 | **0 rows returned** — RLS denies all 25 |
| `legacy_document_archive` | **404** | — | — | schema not exposed |
| `legacy_audit_event` | **404** | — | — | schema not exposed |
| `legacy_entry_field` | **404** | — | — | schema not exposed |

Anon write attempts: `POST`/`DELETE` on `bolao_state_public` → **401**; on `bolao_notif_jobs` →
**401 / 400**; on `bolao_state_normalized_public` → **500** (the view is not auto-updatable, so
there is no write path to authorise).

```
PUBLIC_PII_FINDINGS = 0
Q38 = CLOSED — and now closed against the sanitisers, not only against the base table
```

## Standing items not changed here

- **`bolao_state_normalized_public` holds INSERT/UPDATE/DELETE/TRUNCATE for `anon`.** Inert: the
  view is not auto-updatable (`is_insertable_into = NO`) so every write errors before reaching
  anything. Untidy, not exploitable. Hygiene, not a hotfix.
- **A5** — `authenticated` holds 6 `op_*` EXECUTE plus INSERT/UPDATE/DELETE/TRUNCATE on
  `public.bolao_state`, with `auth.users = 0`. Still zero principals, still not a live path. It is
  now more relevant than before: these grants must not become reachable while the private forensic
  tables exist — they do not touch them, and `audit` USAGE for `authenticated` is false.
- `public.lottery_*` carry broad `anon` grants (Powerball, adjacent product). Out of scope for this
  audit; **registered here so the next reader does not assume they were examined and cleared.**
