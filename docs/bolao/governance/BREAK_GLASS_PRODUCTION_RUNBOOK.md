# Break-Glass Production Runbook (bolão platform)

Applies to `bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/` (and shared infra) when a
real production incident requires an urgent patch outside the normal review cadence.

## 1. Identify the incident
State explicitly: what broke, when noticed, how noticed (user report / monitoring / audit),
which app(s), which URL(s).

## 2. Classify severity
- SEV1: money/scoring wrong, or site down/unusable for paying participants.
- SEV2: visible bug, no money/scoring impact, workaround exists.
- SEV3: cosmetic / internal tooling only.

## 3. Assess impact
Who is affected (all participants / one app / one browser), for how long, any data
corruption risk, any email/notification already sent with wrong info.

## 4. Minimum patch
Smallest possible diff that resolves the SEV1/SEV2 condition. No refactors, no unrelated
cleanup, no drive-by changes bundled into the same commit.

## 5. Mandatory tests before touching main
- `python3 bolao/<app>/scripts/audit_scoring.py` for every app whose scoring code the patch
  touches, even indirectly.
- `node --check` on every changed `.js` file.
- App-specific regression scripts if they exist (`audit_state_merge.mjs`,
  `audit_golden_master.mjs`, etc).
- Manual smoke test of the specific broken flow.

## 6. Explicit authorization
Eduardo's explicit go-ahead is required before merge/deploy, separate from any authorization
to run local commands. **Local command authorization never implies authorization to merge
into `main`, deploy, write to Supabase, or send participant emails.** State the incident and
the exact patch to Eduardo and get an explicit yes before crossing that line.

## 7. Merge / deploy
Only after step 6. Standard commit message must describe the ACTUAL diff, not just the
narrative motivation — see the incident below for what goes wrong when it doesn't.

## 8. Verification
Confirm in production (or via the real deployed asset) that the fix resolved the incident
and did not regress anything else.

## 9. Rollback plan
State the exact `git revert`/`git checkout <sha> -- <path>` command that undoes this patch
before merging it, not after something goes wrong.

## 10. Postmortem
Root cause, why review didn't catch it, what changes to process/tooling would have caught
it earlier.

---

## Incident record: commit `5a9dad4` shipped undocumented DOM changes to production

**What actually happened (verified against the real commit, not assumed):**

Commit `5a9dad4` ("fix(cdb2026): anchor live-monitoring deadline to kickoff, backfill volta
leg kickoff/venue"), which **is already merged into `origin/main`**, has a commit message
that describes only a timing/deadline fix and an ESPN backfill fix. Its actual diff to
`bolao/cdb2026/js/app.js`, however, also contains:

- `data-visual-role="..."` attributes added to ranking rows/position/name/points, game-stage
  headers, game-score, game-date, game-status, and the CDB2026 game card.
- A genuine DOM **structure** change in the `leg-teams` markup: what used to be plain text
  (`${esc(home)} ${logo} × ${logo} ${esc(away)}`) was rewritten into nested
  `<span data-visual-role="home-team"><span class="team-name" data-visual-role="team-name">`
  wrappers — new elements, not just new attributes, shipped to production.

None of this is mentioned in the commit message. It appears to be forensic-audit
instrumentation work that got committed alongside the real hotfix, undetected, and pushed to
`main`.

**Correction to the initial task brief:** the brief this runbook was written under assumed
`git diff 5a9dad4^ 5a9dad4 -- bolao/cdb2026/js/app.js | grep data-` had already been checked
and returned nothing. Re-running that exact check in this session returns 10 matches. The
premise that the hotfix was clean was false; verify independently before trusting a prior
session's grep result on a file this size.

**Current status:** not fixed. This is a real, already-deployed production incident on
`bolao/cdb2026/`, separate from and predating the pollution this branch
(`forensic-visual-audit-v2`, commit `0b1c0eb`) separately introduced (and which was reverted
in commit `f74b965` on this branch — see CHANGELOG). Per this task's hard constraints, `main`
was not touched. Fixing `5a9dad4`'s production pollution requires a new, explicitly
authorized hotfix branch/PR against `main`, following steps 1–10 above, including a rerun of
`audit_scoring.py` (scoring itself was not touched by the pollution, but any touch to
`app.js` in a money-moving app must re-prove that).

**Suggested minimal patch (not applied, not authorized):** revert the `leg-teams` line and
the ranking/game data-visual-role attributes in `bolao/cdb2026/js/app.js` back to their
pre-`5a9dad4` markup, keeping the real timing/backfill logic changes from that same commit
intact. See `visual-parity-product-fixes` branch for a draft (not merged).
