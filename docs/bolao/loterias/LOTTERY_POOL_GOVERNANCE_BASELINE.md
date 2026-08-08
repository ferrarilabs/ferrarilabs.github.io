# Lottery Pool Governance Baseline

Reusable across Powerball, Mega Millions, and any future lottery pool added to
`bolao/loterias/`. Written from what this Powerball audit found — not aspirational, grounded in a
real incident review (`POWERBALL_INCIDENT_REVIEW.md`).

## The pattern that caused all three Powerball incidents

Every incident this audit found traces to the same shape of mistake: **a commit message claimed a
capability existed, and the actual diff didn't fully deliver it** (Incident 3's admin panel, most
starkly — checkmarked "✅ Admin panel (4 tabs)" against a diff that added one markdown file). This
is a process gap, not a one-off typo. Baseline rule for every lottery pool app:

> **A commit message claiming a user-facing capability ("implements X", "✅ X works") must be
> verifiable by the reviewer without re-deriving it from source — link the specific DOM ID / test
> / manual verification step the message's claim rests on.** If a capability is partially built
> (e.g. "JS logic ready, HTML not yet wired"), say that explicitly in the message; don't check it
> off.

## State machine (proposed, applies to any lottery draw)

```
draft → open → closed → tickets_published → awaiting_result → result_available
  → prizes_calculated → completed
  (any state) → cancelled
```

Rules:
- Ticket data is immutable once a draw leaves `closed` (spec: "não alterar ticket depois de
  closed").
- No result email may be built for `awaiting_result` or earlier (this is exactly what
  `validateEmailEvent()` in `email_pipeline.mjs` enforces today via the draw-date-in-the-future
  check — same rule, narrower implementation).
- `completed` is terminal for prize calculation — no silent recompute after completion; a
  correction must be its own explicit, audited action (`correcao_administrativa` event, already
  reserved in `email_pipeline.mjs`'s `VALID_EVENT_TYPES`).
- A new draw for the same pool cannot be created while the current one is anything other than
  `completed` or `cancelled` — this is the "não criar próximo sorteio duas vezes" rule; currently
  unenforced anywhere (Powerball has no state field on a draw at all — see
  `POWERBALL_DATA_MODEL.md`'s `lottery_draws.status` for the proposed fix).

## Outbox pattern (baseline for every future lottery pool)

`bolao/loterias/powerball/scripts/lib/email_outbox.mjs` +
`email_pipeline.mjs` + `email_worker.mjs` are written generically enough (no Powerball-specific
logic beyond the `LOTTERY_GAME_TYPES` shape already shared across `powerball`/`megamillions` in
`data.js`) to be reused as-is for Mega Millions or any future game — the `pool_id` field already
exists precisely for this. **Do not fork a second copy of this module per lottery** — extend the
event-type list and templates, keep one outbox implementation.

## Data model (baseline)

`POWERBALL_DATA_MODEL.md`'s `lottery_pools`/`lottery_draws`/`lottery_participants`/
`lottery_payments`/`lottery_tickets`/`lottery_results`/`lottery_email_*`/`lottery_admin_audit`
tables are named generically (`lottery_*`, not `powerball_*`) specifically so a second game type
is a new `lottery_pools` row and a `pool_id` foreign key value, never a new table set. This
corrects the original (unapplied) `docs/DATABASE_SETUP_SUPABASE.md` draft, which used
`powerball_participants`/`powerball_audit_log` naming that would have forced a full schema fork
for Mega Millions.

## RLS baseline

Every lottery table: RLS enabled, deny by default, explicit `SELECT`-only public policies for
genuinely public data (draws, tickets, results), admin-only (`auth.jwt() ->> 'is_admin'`) for
everything containing PII or money (participants, payments, email jobs/events, audit log). No
`WITH CHECK (true)` on any writable table, ever — that was the single worst finding in the
original Supabase draft (anyone could forge audit log entries). See
`POWERBALL_SECURITY_REVIEW.md` for the full reasoning.

## Admin baseline

No lottery pool admin panel ships without, at minimum:
1. Every DOM ID referenced by its JS actually existing in the HTML (the literal Incident 3 bug —
   trivially preventable by anyone opening the page and clicking the one button before merging).
2. A real password/secret that exists in config before any login code compares against it
   (Incident 3's second bug: `adminPasswordHash` was referenced but never defined, ever, across
   the file's entire git history).
3. Real backend-verified auth, not a client-side hash comparison, before handling money-adjacent
   data (see Security Review's P0 finding on this).

## Cross-pool propagation

Per this repo's root `CLAUDE.md` platform governance rules (written for the three
football-bracket bolões but the same spirit applies here): a fix found in one lottery pool that's
structural (not game-specific — e.g. the outbox pattern, the admin baseline, the RLS baseline)
should be evaluated for the others before being considered fully resolved. Powerball currently has
no sibling lottery app live, so there is nothing to propagate to yet — this baseline exists so the
first one built afterward doesn't repeat Incidents 1-3 from scratch.
