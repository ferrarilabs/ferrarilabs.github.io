# Powerball — Test Strategy

## What was actually run, and the real output (this branch, this session)

```
$ find bolao/loterias/powerball -name "*.mjs" -o -name "*.js" | xargs -n1 node --check
all OK

$ node --test bolao/loterias/powerball/scripts/tests/email_outbox.test.mjs
✔ não envia duas vezes o mesmo evento — enqueue is idempotent per key
✔ idempotency key format matches spec
✔ não envia sem destinatário — invalid recipient rejected
✔ não envia payload incompleto — missing payloadSnapshot rejected
✔ retry mantém o mesmo snapshot — payload is frozen at enqueue time
✔ retry não duplica — job count stays 1 across claim/fail/retry/claim
✔ não envia antes da hora — result event rejected for a future draw
✔ não envia template errado — unknown event_type rejected
✔ resultado_disponivel requires a well-shaped result
✔ preview é igual ao payload enviado
✔ dry-run sends nothing and leaves jobs pending
✔ erro de um destinatário não bloqueia os demais
✔ não mistura participantes — payload for one recipient never contains another's data
✔ não envia para sorteio errado — job's draw_id matches the snapshot it was built from
✔ respeita rate limit — worker honors rateLimitMs between sends
✔ text/html previews render without throwing for every implemented event type
ℹ tests 16, pass 16, fail 0

$ python3 bolao/loterias/powerball/scripts/audit_scoring.py
✅ AUDIT PASSED — safe to deploy   (12 participants, all emails valid)

$ python3 bolao/copa2026/scripts/audit_scoring.py   → ✓ ALL CHECKS PASSED
$ python3 bolao/br2026/scripts/audit_scoring.py     → ✓ ALL CHECKS PASSED
$ python3 bolao/cdb2026/scripts/audit_scoring.py    → ✓ ALL CHECKS PASSED
```

No test in this suite sends a real email, writes to production Supabase, or touches `main`.
`FakeEmailProvider` (`email_worker.mjs`) never makes a network call — verified by reading its
implementation (no `fetch`/`emailjs` import anywhere in it).

## What exists vs. what the spec's full 19-item test list asks for

Implemented and passing (16 tests, see above), matching the spec's email-behavior list nearly
line for line: no double-send, no wrong-draw, no wrong-template, no cross-participant mixing, no
missing-recipient send, no incomplete-payload send, no early send, retry keeps snapshot, retry
doesn't duplicate, one failure doesn't block others, preview equals sent content, rate limit
honored.

**Not implemented in this branch, stated honestly rather than glossed over:**

- **`unit` / `admin CRUD` / `persistence reload` / `state transitions`** — there is no admin CRUD
  or persistence layer to test yet (Incident 3: it doesn't exist). `POWERBALL_DATA_MODEL.md`
  Part 15 of the state machine is *designed*, not implemented, so there's nothing running to
  exercise transitions against. Testing a design document isn't meaningful; this is filed as
  follow-up work once the data model actually lands.
- **`result calculation` / `golden master`** — `computePrize()`/`prizeTable()` in the live
  `js/app.js` are simple, pure, deterministic functions; a genuine golden-master suite (all 13
  prize tiers, duplicate tickets, corrected results per spec Part 14) is real, valuable work that
  was not built in this pass — time went to the outbox/pipeline (identified as the higher-severity
  gap: Incidents 1/2/3 are P0, prize-calculation correctness has no reported incident against it).
  Flagged as a P1 follow-up, not silently skipped.
- **`security static scan` / `PII scan`** — run manually this session against the new code only
  (see command output in `POWERBALL_SECURITY_REVIEW.md` and above: zero real-looking emails,
  zero secrets, zero transaction IDs in any new file). Not wired into CI as a repeatable gate —
  that would need a real static-analysis tool choice (e.g. `gitleaks`, `semgrep`), which is
  infrastructure the repo doesn't currently have for *any* of its four bolão apps, not just
  Powerball; scoping a repo-wide tool choice is out of scope for a Powerball-only branch.
- **`Playwright mobile/desktop` / `console errors` / `overflow`** — Playwright is available in
  this repo (used by `bolao/scripts/forensic/`, see the separate `forensic-visual-audit-v2`
  branch), but Powerball has no forensic fixture, no golden-master visual baseline, and Part 17
  of this spec (UX/visual alignment to the platform design system) is explicitly sequenced
  *after* functional stabilization — building throwaway Playwright coverage against a page
  layout that's about to change (once Admin is rebuilt) would be wasted effort. Deferred to
  the professionalization follow-up, after Part 17's redesign, not before.

This is a deliberate scope decision, not an oversight: the highest-severity, highest-confidence,
most testable piece of the spec (email correctness/reliability) got real, passing, honestly-scoped
tests; the pieces that require infrastructure this branch cannot stand up without violating its
own "no production changes" constraint (a real backend, a real admin UI, a real deployed worker)
are documented and prioritized instead of faked.
