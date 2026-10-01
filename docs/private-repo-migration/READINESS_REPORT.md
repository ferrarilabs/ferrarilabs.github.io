# Private repository readiness — GO/NO-GO report

Date 2026-10-01. Baseline `origin/main` = `d6bf335d` (unchanged at finalization). Branch `chore/private-repo-readiness`.
**No repository visibility change, DNS change, secret rotation, merge, production deploy, email or Supabase write was made.**

## What changed (this branch)

1. `scripts/public-site.manifest.json` + `scripts/build-public-site.mjs`: `_site` is built from an explicit allowlist (91 exact files + the Powerball `tickets/*` pattern = 109 files, ~6 MB, deterministic digest). Replaces `rsync` of ~1,299 files.
2. `scripts/check-public-artifact.mjs` (`npm run check:public-artifact`): gate over the real `_site` — containment, completeness, forbidden paths, secret/token/PII content (reusing `pii_detectors.mjs`), private-repo links, dangling html/css references. `scripts/test_public_artifact.mjs` (54 tests, registered in `verify.mjs`/gate registry/`npm test`) proves rejections and acceptances. `scripts/smoke-public-artifact.mjs` serves `_site` over HTTP and drives 21 pages in Chromium (no 4xx/5xx, no page errors; 19 private paths 404).
3. `deploy-pages.yml`: build → gate → upload → deploy; permissions, triggers, concurrency unchanged; no new jobs or setup steps. Declared in `CHANGE_INTENT.json` (remove after merge — check D3).
4. `bolao/copa2026/audit-report.html` (+ generator): removed GitHub source links (would 404 when private).
5. Docs in `docs/private-repo-migration/`, CLAUDE.md deploy note.

## Gate results

| Item | Result |
|---|---|
| Scoring audits (copa2026 / br2026 / cdb2026 `audit_scoring.py`) | pass; scoring untouched |
| `npm run check`: classification, safety contract (37), tree | PASS; non-browser suite 235 pass |
| `npm run check` full suite | **FAIL in this sandbox: 5 checks, all reproduced on the unmodified baseline** (see below) |

Baseline-reproduced failures (not caused by this change; none touches files modified here except the unchanged-app browser suites): `lottery-failure-injection` (runs as root, read-only-file refusal can't happen), `br-live-behavior-parity` and `live-prob-bars` (identical failure on pristine checkout), `accessibility` (66 pass / 3 console-error fails, identical on baseline; third-party hosts blocked), `critical-functionality` (page.goto networkidle timeout on baseline too). `br-round-email-durable-ledger` failed once and passed on re-run; it is also intermittently red on baseline (thread race). These should be re-run in CI/an unrestricted machine before merge.

## Verdicts

PRIVATE REPOSITORY READINESS
- Public artifact model: PASS
- Artifact security gate: PASS
- Corporate website: PASS (pages, assets, sitemap, CNAME, language variants load from `_site`)
- Bolão runtime: PASS (all three apps + Powerball + audit pages load from `_site`; two unlinked debug/test pages removed on purpose)
- Supabase dependency audit: PASS for repo contents; Supabase↔GitHub integration status UNVERIFIED (external console)
- Worker/GitHub token audit: PASS (conditional) — PAT scope/expiry UNVERIFIED
- Anonymous GitHub dependency audit: PASS (one user-facing dependency found and fixed)
- GitHub Actions audit: **FAIL for privatization today** — ~12,000 min/month observed vs 2,000 (Free) / 3,000 (Pro); ~8,640 is the 5-minute Worker dispatch
- Private Pages plan compatibility: **NOT VERIFIED** — PLAN VERIFICATION REQUIRED BEFORE PRIVATIZATION (owner is a personal account; docs say Pages from private repos needs Pro+; the plan could not be read)
- Production URL preservation: PASS (except the two removed pages above)
- Rollback plan: PASS (runbook)
- Full regression suite: FAIL in sandbox (baseline-equivalent); targeted gates PASS

## Blockers
1. Account plan / Pages-from-private eligibility not verified (could take `www.ferrarilabs.com` down).
2. Actions quota: need a decision (cheaper live-producer cadence, plan/payment setup) before the flip.
3. Merge + observe the first allowlist deploy on `main` (not done; Eduardo's call).
4. Unverified externally: Worker PAT repo scope, Supabase GitHub integration, any Cloudflare Git integration.

## Risks accepted / deferred
Stored `sourceUrl` in CDB topology provenance points to a repo doc (404 after flip; not rendered); `canonical` tags to `ferrarilabs.github.io` untouched; Powerball ticket serials intentionally public; full git history was not secret-scanned (recommend gitleaks before the flip); history exposure irreversible; `br2026_round_emails` 21/98 failures and hard-coded `quartas` in `cdb2026_schedule_watch` noted, not fixed.

## Files no longer public
docs/, scripts/, supabase/, workers/, memory/, model/, .claude/, CLAUDE.md, CHATGPT.md, all SQL/Python/shell/mjs tooling, safety registries, CHANGELOGs/READMEs, email previews, logs, outbox, lottery ledger/results/policy JSONL, round_manifest/quartas-draw data, `powerball/debug.html`, `copa2026/preview/`.
## Files intentionally public
Corporate pages + assets, the three Bolão apps' runtime, shared css/js/data, Copa audit pages and redirect stubs, service workers, Powerball app + `lottery_status.json` + public projection + `tickets/*/{manifest.json,tickets.csv,tickets.pdf}`.

## FINAL STATUS: NOT READY FOR PRIVATE
