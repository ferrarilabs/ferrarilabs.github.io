# Powerball — Security Review

Read-only review, per the audit spec's constraint. No migrations applied, no production
Supabase/RLS changes, no secrets touched.

## 1. Currently deployed: no Supabase at all

`bolao/loterias/powerball/js/config.js` and `js/app.js` contain **zero** references to Supabase —
confirmed via `grep -rn "supabase" js/`. The only Supabase-related artifact is
`docs/DATABASE_SETUP_SUPABASE.md`, a schema that was designed but never connected to any running
code. **Current risk from Supabase is zero, because nothing is deployed.** Everything below
reviews the *proposed, unapplied* schema so it doesn't ship with the same flaws if/when someone
wires it up.

## 2. Flaws in the proposed (unapplied) schema

Reading `docs/DATABASE_SETUP_SUPABASE.md`'s SQL directly:

- **`powerball_audit_log`'s `system_insert` policy is `WITH CHECK (true)`** — any anon client
  (which, by definition, is anyone with the publicly-embedded anon key — i.e., anyone who views
  page source) could insert arbitrary rows: fake actor names, fake IP addresses, fake actions.
  An "immutable audit trail" that anyone can forge entries into is not trustworthy. **P0 if this
  schema is ever applied.**
- **No INSERT/UPDATE/DELETE policy exists for `powerball_participants` at all** — only two
  `SELECT` policies (`admin_select`, `self_select`). Under RLS's default-deny, as drafted, *nobody*
  — not even an authenticated admin — could add or edit a participant through this schema. The
  doc's own stated goal ("Participantes: manage participants (add/edit/remove)") is structurally
  impossible with the policies as written.
- **`self_select` depends on `auth.jwt() ->> 'email'`**, which requires real Supabase Auth
  (magic link / OTP / password) to populate a JWT. Nothing in this codebase ever sets up Supabase
  Auth — the doc's own "Security Notes" section says admin auth is "SHA-256 hash in config.js,
  client-side verification only," which is a **different, incompatible auth model** from the one
  the RLS policies assume. As drafted, `self_select` can never fire for anyone (no JWT is ever
  issued), and `admin_select` can never fire either (`auth.jwt() ->> 'is_admin'` requires a JWT
  claim nothing sets). The schema, if applied verbatim, would make the tables **unreadable by
  anyone**, not just secure.
- **Client-side password hash comparison is not authentication** — flagged explicitly in the audit
  spec too. `js/app.js`'s `adminLogin()` hashes the typed password and compares to a constant.
  Even setting aside that the constant doesn't currently exist (Incident 3), a hash embedded in
  client-shipped JS is offline-brute-forceable at unlimited speed by anyone who views source; the
  in-app "5 attempts → 15min lockout" only throttles attempts made *through the UI*, not attempts
  made against the extracted hash directly. This is a design flaw independent of whether the
  modal/hash currently exist.

## 3. PII currently exposed — this one is live today, not proposed

`bolao/loterias/powerball/js/data.js` is served as a plain static file, no auth, to anyone with
the URL. It contains, in plaintext, for every participant across all three draws:

- Full name
- Email address (as of `da774b3`/`8b45c01`, added this session for the current draw)
- Zelle/Venmo/Cash App transaction IDs (`txId` field on each participant row — see `js/data.js`;
  not reproduced here to avoid copying real transaction identifiers into a second file)
- Payment method and exact payment timestamp

**Mitigation already in place**: `index.html:6` sets
`<meta name="robots" content="noindex,nofollow,noarchive">`, and `index.html:105` explicitly warns
"Página privada... não compartilhe este link publicamente" — this is a deliberate
security-by-obscurity design (private URL, not indexed, not linked from the public site), which
the team is evidently already aware of and has accepted as the tradeoff for a small private pool
among people who know each other. **This review does not recommend removing real names/TXIDs from
the live file** — the spec's instruction not to alter real production data without authorization
applies, and obscurity-based privacy for a ~14-person private pool between friends is a
proportionate control, not a gap to silently "fix" by deleting data.

**What *is* worth doing** (not done in this branch — needs Eduardo's decision, flagged in the
Professionalization Report): if this data ever needs to move to Supabase per the schema above, do
it with fixed RLS (see Data Model doc's corrected version) rather than the audit_log/participants
holes found above, and mask transaction IDs in the *email* content going forward (Incident review:
emails currently include full amounts but the txId itself is not emailed back to participants
today — confirmed via `buildResultEmailHtml()`, which never references `txId` — so this specific
"no transaction ID in the public email" requirement from the spec is **already satisfied**).

## 4. CSP

`index.html`'s CSP (`script-src 'self' https://cdn.jsdelivr.net`, `connect-src 'self'
https://data.ny.gov https://api.emailjs.com`) is scoped tightly to what the app actually needs —
no wildcard `*`, no `unsafe-eval`. `style-src 'unsafe-inline'` is present (used for inline
`style="..."` attributes throughout `app.js`'s generated HTML) — same tradeoff the other three
bolão apps make, not unique to Powerball, not flagged as a new finding here.

## 5. Summary

| Finding | Severity | Status |
|---|---|---|
| Client-side-only "admin auth" is not real authentication | P0 | Documented; real fix needs a real backend (see Professionalization Report) |
| Proposed audit_log INSERT policy allows anyone to forge entries | P0 | Documented, schema not applied — fix drafted in Data Model doc |
| Proposed participants table has no working write policy | P1 | Documented, schema not applied — fix drafted in Data Model doc |
| Proposed self_select relies on auth that's never set up | P1 | Documented, schema not applied |
| Real PII (names, emails, txIds) in a public static JS file | P1 (accepted risk) | Existing deliberate design (private URL + noindex), not changed by this branch |
| Transaction IDs never included in outbound emails | ✅ Already correct | Verified, no change needed |
