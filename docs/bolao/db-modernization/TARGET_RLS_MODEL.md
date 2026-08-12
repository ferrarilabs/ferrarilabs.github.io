# TARGET_RLS_MODEL — row-level security design, test strategy and threat summary

**Workstream 12.** Consolidates WS12.33's four requested documents into one, because splitting a 400-line
design across `TARGET_RLS_MODEL`, `RLS_TEST_STRATEGY`, `RLS_THREAT_SUMMARY` and `POLICY_DRAFT_INDEX` would
duplicate the same rules four times and let them drift.

Cross-references: `ACCESS_MATRIX.md` (generated, all 420 cells), `ACCESS_MODEL.md` (role intent per entity),
`model/rls_model.json` (canonical policies), `docs/bolao/db-modernization/rls-drafts/TARGET_RLS.draft.sql`.

Status: **REVIEW DRAFT. No policy has been created, altered or applied in any database.**
`PRODUCTION_WRITES = 0` · `RLS_CHANGES = 0`

---

## 1. One definition, four consumers

`model/rls_model.json` holds policies as **structured predicate objects**, not SQL strings. That single
representation feeds the SQL emitter, an executable authorization evaluator, the linter, and the derived
420-cell matrix.

This is the load-bearing design choice. Had policies been SQL text, the evaluator would need its own parser
and the test expectations would be a second, divergent source of truth for authorization — the exact drift
this programme has repeatedly been bitten by. With structured predicates, a mutant changes what the SQL says
**and** what the evaluator decides, which is what makes mutation testing meaningful rather than theatrical.

## 2. Principals

| Principal | DB-verifiable | Meaning |
|---|---|---|
| `anon` | yes | the unauthenticated browser holding the public anon key. **Assume hostile**: the key is in the page source, so anything anon may do, anyone on the internet may do |
| `authenticated` | yes | a signed-in Supabase user; `auth.uid()` is testable in a policy. Not used by the platform today, modelled so the design need not be redone |
| `trusted_runtime` | yes | Edge Functions using the service key. **Bypasses RLS by design**, which is precisely why every runtime path must be a narrow audited contract rather than a general-purpose door |
| `operator_context` | **no** | an **architectural abstraction**, not a database principal — see §3 |
| `migration_role` | yes | holds DDL authority and BYPASSRLS. Present in the model specifically so "must never be reachable from application runtime" has something to attach to |

## 3. R-GAP-1 is OPEN, and this model does not paper over it

**There is no database-verifiable operator identity.** `operator_context` therefore has **zero policies**,
and the evaluator refuses it by name with reason `R_GAP_1_NO_DB_VERIFIABLE_OPERATOR`.

Making it ALLOW would have made several tests simpler and would have been a lie: it would assert the database
can authenticate an operator when it cannot. Every `FUTURE_OPERATOR_IDENTITY` cell in the matrix is an honest
statement that the cell is *designed* but not *enforceable* yet.

| Path | Status | Mechanism | Weakness |
|---|---|---|---|
| **A — runtime acts for operator** | AVAILABLE NOW | the operator authenticates to the application; the runtime checks that authority and acts with the service key, recording `{operatorId, reason}` in the audit event | the database verifies the **runtime**, not the operator. A compromised runtime is a compromised operator |
| **B — database-verifiable operator** | FUTURE (operator decision) | operators become real `auth.users` with a claim a policy can test | requires adopting Supabase Auth for operators |

## 4. Ownership: participant identity ≠ auth identity

Ownership predicates render as a subquery against a **link table**, never as a column comparison to
`auth.uid()`:

```sql
participant_id IN (SELECT participant_id FROM bolao.participant_auth_links WHERE auth_user_id = auth.uid())
```

Two reasons, both structural: one authenticated user may legitimately own **several** participant identities;
and a **historical participant may have no auth row at all**. A column comparison would force every historical
participant to acquire an auth user before their own data could be read — or, worse, invite a design where
`participants.auth_user_id` is nullable and the policy silently matches NULL.

An empty ownership set denies everything, which is the correct behaviour for an unlinked historical
participant and is asserted by test.

## 5. What DR-1 taught, and what prevents its recurrence

DR-1 established that all six production policies compare a column against a fixed literal and reference **no
caller attribute** — they scope *rows*, not *principals*, so authorization effectively lives in browser
JavaScript.

Four controls make that pattern unrepresentable here:

1. Every ownership predicate consults `auth.uid()`. A predicate that does not is not an ownership predicate.
2. The linter rejects `MISSING_OWNERSHIP_PREDICATE` on any authenticated read of a sensitive or financial
   entity, including a predicate that is literally `true`.
3. The linter warns `SUSPICIOUS_STATIC_LITERAL` when a predicate compares a column to a short static
   identifier — the DR-1 shape itself.
4. A test scans the rendered SQL for `id = '<short literal>'` and fails on it.

## 6. Anon exposure — challenged table by table

Only **21 of 420** cells are ALLOW, and every one is an anon or authenticated **SELECT** on data that is
public by nature. Nothing is exposed because the legacy frontend happened to read it.

| Exposed to anon | Why it is safe |
|---|---|
| competitions, editions, phases, matches, ties, pools | public facts. A hidden prediction deadline is worse than a public one |
| `pool_fee_schedule` **WHERE effective_to IS NULL** | a **published price** is not a person's money, and the app renders it before sign-in. Historical prices are not public |
| `match_results` **WHERE is_official AND superseded_by_id IS NULL** | only the current result; a superseded one would confuse a reader about which score counts |
| `ranking_snapshots` **WHERE published_at IS NOT NULL** | a published standing; an unpublished computation is a draft |

Denied to anon entirely: participants, identity links, entries, predictions, payments, allocations, prizes,
audit, audit details, outbox, delivery attempts, sync state.

## 7. Financial writes and reads

All four financial tables are `TRUSTED_RUNTIME_ONLY` for writes. **Browser-supplied data is not database
authorization.**

Reads are stricter than might be expected: an authenticated user cannot read `payments`,
`payment_allocations` or `prize_allocations` **even for their own rows**. Financial reads are served by views
the runtime owns, which can project away `external_reference`, `memo` and `paid_amount` in a way a row policy
cannot. A row policy grants whole rows; a view grants columns.

## 8. Predictions — where each invariant lives

Not everything belongs in RLS. Spreading one invariant across two layers leaves no single place to read it.

| Invariant | Enforced in | Why there |
|---|---|---|
| entry ownership | **RLS** | it is a row-visibility question, exactly what RLS is for |
| cutoff / lock state | **trusted write transaction** | needs a trusted clock, and the phase's `cutoff_at` is not a column on `predictions` |
| pool eligibility | **RLS + FK** | the FK makes an impossible entry unrepresentable; RLS scopes which are visible |
| match validity for the edition | **transaction** | a cross-edition join RLS should not be performing per row |
| exactly one subject (match XOR tie) | **CHECK constraint** | a structural truth about the row, cheapest to state declaratively |
| no duplicate prediction per subject | **UNIQUE index** | the database is the only place this can be raceless |

## 9. Append-only, and the one intentional exception

`audit_events`, `ranking_snapshots` and `outbox_delivery_attempts` have **no UPDATE policy for any
principal, including the runtime**. For the audit log, immutability is the property that makes the hash chain
worth computing.

`audit_event_details` is the single table where runtime UPDATE is intentional: erasure nulls the snapshots in
place. That is the entire reason the sidecar exists — it lets an erasure request be honoured without breaking
the chain.

**No DELETE policy exists anywhere, for any principal.** Nothing in this schema is deleted.

## 10. Test strategy

| Layer | What it proves |
|---|---|
| exhaustive sweep (420 cells) | the evaluator agrees with the derived matrix; expectations come from the model, not a parallel table |
| horizontal isolation | A cannot reach B's participant, entry, prediction or financial rows, and reciprocally |
| public-read narrowness | the *right rows* are visible — a historical fee, a superseded result and a draft snapshot are each denied |
| IDOR (9 cases) | substituting a valid-but-other-user identifier does not grant access |
| financial red team (9 attacks × 2 principals) | no client can record, alter, reassign or forge money |
| prediction red team | submission is server-mediated; an authorization denial is distinguished from a business-rule denial |
| audit/outbox red team (11 attacks × 2 principals) | no client can forge, alter or delete audit or outbox state |
| role confusion | operator_context and migration_role are refused **by name**, with reasons |
| linter vacuity (13 rules) | every static rule fires on a synthetic violation |
| **mutation (14 mutants)** | **every dangerous policy change breaks at least one assertion. 14/14 killed** |

Mutation testing is the part that matters. A harness passing against a correct model proves nothing about
whether it would catch an incorrect one.

## 11. Threat summary

| Threat | Control | Residual risk |
|---|---|---|
| anon writes anything | no anon write policy exists anywhere; linter rejects one; mutant `ALLOW_ANON_INSERT` killed | none at this layer |
| participant enumeration | ownership predicate on every participant read; anon denied entirely | a compromised **runtime** can read everything — it holds the service key |
| cross-user read (IDOR) | ownership predicates; 9 IDOR cases | none at this layer |
| payment tampering | financial writes runtime-only; 9 attacks tested | a buggy runtime contract could still misallocate; covered by the per-payment transaction invariant, not by RLS |
| prediction copying before cutoff | prediction reads are ownership-scoped — a **fairness** control, not only privacy | none at this layer |
| audit forgery | append-only; no client policy; no UPDATE for anyone | a compromised runtime can append a false event. The hash chain makes *alteration* detectable but not *authorship* |
| outbox injection / lease theft | runtime-only; attempts append-only | as above |
| operator impersonation | no operator principal exists to impersonate | **R-GAP-1**: operator authority is enforced outside the database. This is the largest residual risk in the model and it is an open operator decision |
| migration role reachable from the app | refused by name; separate reason code | depends on deployment keeping the migration credential out of runtime config |
| policy drift after deployment | fingerprints + `detectDrift` between access model and policies | drift introduced through the Supabase dashboard is invisible until a snapshot comparison runs — still unscheduled |

## 12. Deliberately not claimed

- **The evaluator is not PostgreSQL.** It models permissive-policy OR-ing, deny-by-default, and `WITH CHECK`
  on the post-image. It does **not** model role inheritance, RESTRICTIVE policies or column privileges — none
  of which this design uses. Claiming otherwise would make the harness agree with a database it is not
  simulating.
- **No policy has been applied.** Every SQL file is a review draft outside all migration paths.
- **`participant_auth_links` does not exist.** It is a prerequisite the drafts reference in a comment; creating
  it is a future migration.
- **A compromised trusted runtime defeats this entire model.** RLS protects against the browser, not against
  the server that holds the service key.

## 13. Open operator decisions

| Id | Decision |
|---|---|
| **R-GAP-1** | Adopt Supabase Auth for operators (path B), or accept that operator authority lives in the runtime and record that acceptance. Blocks M11. |
| **WS12-OP-1** | Confirm that authenticated users should **not** read their own financial rows directly, and that a runtime-owned view is the intended surface. This is stricter than a naive reading of the access model and deserves explicit sign-off. |
| **WS12-OP-2** | Confirm `participant_auth_links` as the ownership mechanism, including whether one auth user may own several participants (the model assumes yes). |
