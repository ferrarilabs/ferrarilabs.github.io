# Powerball — Professionalization Report

Branch: `powerball-professionalization-audit`. Base: `origin/main` at the time of this audit
(`da774b3`). No merge, no deploy, no production writes of any kind performed by this branch.

## Findings, prioritized

### P0 — risco de e-mail errado, perda de dados ou alteração indevida

1. **No automatic email trigger exists in production.** Confirmed root cause:
   `sendResultEmail()` only runs from a browser page-load event; zero GitHub Actions/cron for
   Powerball. Real automation was built once (commits `adc4fde`/`dfda53f`) and abandoned on an
   unmerged branch 97 commits behind current `main`. See `POWERBALL_INCIDENT_REVIEW.md` Incident 1.
2. **Manual/"automatic" email content can diverge between browsers.** `localStorage`-based result
   caching with no stability re-check, no shared source of truth. See Incident 2.
3. **Admin panel is entirely non-functional** — HTML for the login modal/panel was never written
   despite commit messages claiming it was; `adminPasswordHash` doesn't exist in `config.js`,
   ever, in the file's whole git history — login can never succeed with any password. See
   Incident 3. Direct consequence, observed this session: participant/payment updates went nowhere
   until a human (Claude, on request) hand-edited `data.js` and committed to `main` directly.
4. **Proposed (unapplied) Supabase audit log policy allows anyone to forge entries**
   (`WITH CHECK (true)` on INSERT) — would defeat the entire point of an audit trail if ever
   applied as drafted. Corrected version in `POWERBALL_DATA_MODEL.md`.
5. **Client-side password-hash comparison is not real authentication** — even once the missing
   modal/hash are fixed, this auth model is fundamentally weak for money-adjacent admin actions.

### P1 — Admin ou automação não confiável

6. Proposed `powerball_participants` schema has no working write policy at all (structurally
   cannot support the "add/edit/remove participant" feature the docs describe it enabling).
7. No idempotency/dedup on payment recording — nothing stops the same Zelle/Venmo confirmation
   being recorded twice by mistake (fixed in the proposed schema via `UNIQUE (participant_id,
   tx_id)`, not yet applied).
8. No ticket-format validation — `parseTicketNumeros()` silently drops malformed ticket strings
   with no warning surfaced anywhere.
9. No draw-status state machine — nothing stops creating a duplicate draw, or editing tickets
   after a draw has closed. Proposed in `POWERBALL_DATA_MODEL.md`/`LOTTERY_POOL_GOVERNANCE_BASELINE.md`.
10. Real PII (names, emails, Zelle/Venmo/Cash App transaction IDs) sits in a public static JS
    file — currently mitigated by `noindex`/private-URL obscurity, which is a proportionate
    control for a ~14-person private pool but not a real access control. Documented, not changed.

### P2 — UX, observabilidade e dívida técnica

11. No structured audit log anywhere (git commit history is the only trail, and it records
    intent via a human-written message, not structured before/after state).
12. Visual/design-system alignment to the other three bolão apps (spec Part 17) not started —
    correctly sequenced after functional stabilization, not before.
13. No golden-master test suite for prize calculation (`computePrize()`/`prizeTable()`) despite
    it being simple, pure, and highly testable — no reported incident against it, so it wasn't
    the highest-value use of this pass's time, but it's real debt.
14. No Playwright/visual regression coverage for Powerball (unlike the other three apps' new
    `bolao/scripts/forensic/` harness) — deferred until Part 17's redesign so it isn't
    coverage of a UI about to be replaced.

### P3 — melhoria futura

15. Text-only email fallback (`renderEmailText()`) exists in the new pipeline but isn't used by
    the live EmailJS template today (which only accepts `html_message`) — worth wiring up for
    accessibility/spam-filter reasons eventually, not urgent.
16. Consider whether Powerball should get its own `CHANGELOG.md` like the other three apps (it
    currently has none) — would have made the "commit message oversold what shipped" pattern in
    Incidents 3 easier to catch in review.

## What this branch actually built (real, tested, local-only)

- 9 documentation files under `docs/bolao/loterias/` (this report, architecture, incident review,
  admin matrix, email reliability, data model, security review, test strategy, plus the
  governance baseline).
- A working, tested email outbox: `email_outbox.mjs`, `email_pipeline.mjs`, `email_worker.mjs`
  (`bolao/loterias/powerball/scripts/lib/`) — 16/16 tests passing
  (`bolao/loterias/powerball/scripts/tests/email_outbox.test.mjs`), zero real emails sent, zero
  real addresses used.
- 5 fictional email HTML previews generated and saved under
  `docs/bolao/loterias/evidence/email-previews/`.
- Proposed (unapplied) SQL schema + corrected RLS policies in `POWERBALL_DATA_MODEL.md`.
- A concrete, git-blame-backed incident review naming the exact commits that oversold what they
  shipped, rather than a generic "admin doesn't work" note.

## What this branch did NOT do (by design, per spec's own prohibitions)

- No merge to `main`, no deploy, no GitHub Pages change.
- No Supabase project created or written to (proposed migrations only).
- No real email sent (FakeEmailProvider only, `@example.invalid` recipients only).
- No workflow file added/modified/activated.
- No real admin UI built (needs the backend from `POWERBALL_DATA_MODEL.md` first — building an
  admin UI with nothing real to persist to would be UI theater, not a fix).
- No PII removed from live production `data.js` (out of scope without Eduardo's explicit
  authorization to alter real production data, per repo governance).

## Confirmation

`origin/main` was not touched by this branch's work. No email was sent to any real address at any
point in this audit. No write of any kind was made to production Supabase (none exists to write
to). This branch is local + pushed to its own remote ref only, per spec.
