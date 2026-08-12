# Private policy literals — classification and future treatment

**STATUS:** Classification COMPLETE. **No literal value appears in this file or in any Git-tracked
file.** Values live only in the private capture outside Git.
**METHOD:** each literal was classified programmatically — length, character class, Shannon entropy,
membership in the private participant-name (46 terms) and payment-reference (26 terms) lists, and
occurrence count within tracked repository content. Values were never printed.

## Findings

| Literal | sha256(12) | Len | Charset | Entropy b/char | In participant list | In payment list | Secret-shaped | Occurrences in **tracked** repo | Classification |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `0d6e4079e367` | 4 | lowercase alnum | 2.00 | NO | NO | NO | **129 files** | **IDENTIFIER** |
| 2 | `3c67c734e8fe` | 6 | lowercase alnum | 2.25 | NO | NO | NO | **83 files** | **IDENTIFIER** |
| 3 | `2ccfb861d34b` | 7 | lowercase alnum | 2.52 | NO | NO | NO | **117 files** | **IDENTIFIER** |

**None is** `SECRET`, `PII`, `BUSINESS_LITERAL`, or a payment reference.
**All three are** `IDENTIFIER` — application row keys that are **already public**, appearing in
between 83 and 129 tracked repository files (and, by extension, in published URLs and shipped
client JavaScript).

They are simultaneously `LEGACY_AUTHORIZATION_LITERAL` in *role*: DR-1 established that the six
policies compare these values against the `id` column and reference no caller attribute, so the
literals are the operands of a **row allowlist**, not of an authorization rule.

## Why this matters more than it looks

A short, low-entropy, already-public identifier carries **no confidentiality value**. The reason
these literals were withheld was the query pack's blanket "never emit policy expressions" rule —
which is the correct *default* for a broad automated scan, but is over-broad once each value is
classified individually. **The withholding was procedurally right and substantively unnecessary.**

That does not make substituting them into Git correct *today*: the operator restriction is explicit,
and honouring it costs almost nothing because of the recommendation below.

## Recommended future treatment

| Option | Assessment |
|---|---|
| **A. Policy redesign — RECOMMENDED** | Do not carry these policies forward at all. DR-1 showed they provide **zero authorization** (no `auth.uid`/`auth.role`/`auth.jwt`), and the target model moves base tables out of `public` with authorization enforced in Edge Functions (E3). The literals then have no successor, and the dependency disappears rather than being managed. |
| B. Inline after operator ratification | Defensible on the evidence — the values are already public in 83–129 tracked files, so committing them adds no exposure. Requires the operator to lift the restriction explicitly. Makes the baseline directly executable. |
| C. Deployment-time substitution (current state) | Implemented. Keeps Git clean, at the cost of a non-executable committed baseline plus an out-of-band step. Correct interim posture. |
| D. Move to a config table / GUC | Over-engineering for three public identifiers, and adds a runtime dependency to a policy evaluated on every row. **Not recommended.** |

**Recommendation: C now, A permanently.** Option B is available if an executable baseline is needed
before the policy redesign lands, and the evidence supports it — but it needs the operator to say so.

## The dependency, stated explicitly

`BASELINE_current_production_state.reference.sql` cannot create the six
`public.bolao_state` policies without values for `:'policy_literal_1..3'`. **Every other object in
the baseline** — 7 tables, 3 enum types, 1 function, 24 constraints, 1 unique index, 52 grants, 7
RLS-enable statements, and the `ensure_rls` event trigger — **is fully self-contained and has no
private dependency.** The dependency is confined to 19 occurrences of 3 values inside 6 policy
definitions.
