# Football Operational Hardening — Checkpoint H Evidence

Real Playwright captures (Chromium via the `playwright` npm package, Chrome-for-Testing binary
cached at `~/Library/Caches/ms-playwright/chromium-1234/...` from a prior session — no browser
download was needed, `PLAYWRIGHT_CHROMIUM_PATH` env var points at it). Local static server only
(`python3 -m http.server`, started as a separate `spawn()`ed process, never `execSync`
backgrounding). No real emails, no Supabase writes, no real ESPN calls during capture.

## 1. Cross-app visual harness (existing infra, reused not reinvented)

`node bolao/cdb2026/scripts/visual/capture_evidence.mjs` — 112 manifest records across 7
viewports (320/375/390/414/768/1024/1440 width) x 3 apps x up to 6 sections each (Palpites/
Entrada, Ranking, Jogos, Pagamento, Regras, Admin). Manifest: `docs/bolao/evidence/visual/manifest.json`.

```
Manifest entries: 112
  captured:      77
  unavailable:   0
  notApplicable: 35
  failed:        0
```

`node bolao/cdb2026/scripts/visual/check_manifest.mjs` found **2 real, pre-existing violations**,
honestly reported here rather than hidden or silently fixed:

```
✗ cdb2026/Jogos@320x568: captured=true but horizontalOverflow=true
✗ cdb2026/Jogos@375x667: captured=true but horizontalOverflow=true
```

**Confirmed pre-existing, not introduced by this branch**: `git diff dfe9482 5a5bdb7 -- bolao/cdb2026/css/styles.css`
is empty — no CSS changed on this branch at all, and none of checkpoints A-H touched CDB2026's
game-card CSS. This is a real finding from real evidence capture that predates this branch;
flagged here per the platform's "never silently fix or silently ignore a regression found outside
scope" rule, not remediated in this PR (would need its own audit-first workflow per
`docs/bolao/ENGINEERING_STANDARD.md`, and this branch's mandate is operational hardening, not a
new visual bug fix).

## 2. Hardening-specific scenarios (new: `bolao/scripts/capture_hardening_evidence.mjs`)

Screenshots + manifest: `docs/bolao/evidence/hardening/`. Classification taxonomy: EQUAL /
VARIANT_APPROVED / DIVERGENT / MISSING_FIXTURE / MISSING_SELECTOR / CAPTURE_FAILED. The script
exits non-zero if any record is DIVERGENT/MISSING_FIXTURE/MISSING_SELECTOR/CAPTURE_FAILED.

Final run: **15/15 records EQUAL or VARIANT_APPROVED, exit 0.**

| Scenario | Viewports | Result |
|---|---|---|
| CDB2026 aggregate ao vivo (leg 1 done, leg 2 not yet live) | 390x844, 768x1024, 1440x900 | VARIANT_APPROVED — a genuinely live second leg can't be forced without a running ESPN live-poll cycle in a static capture; captured the honest pre-live "aggregate after leg 1" state instead of fabricating a live tick. |
| **CDB2026 final com pênaltis (checkpoint E's mandatory scenario, actually rendered)** | 390x844, 768x1024, 1440x900 | **EQUAL** — `[data-visual-role="tie-aggregate"]` = "Agregado: 1 × 1", `[data-visual-role="tie-penalties"]` = "Pênaltis: 5 × 4", `[data-visual-role="tie-advances"]` = "Classificado: Time Alfa" — three distinct DOM elements, verified via Playwright text-content assertions, never a combined "6×5". |
| BR2026 probabilidades (Participante Alfa/Beta/Nome Muito Longo) | 390x844, 768x1024, 1440x900 | EQUAL |
| Simulated sports-source failure (corrupted `bolao/br2026/data/espn-normalized.json`) | 390x844, 768x1024, 1440x900 | EQUAL — real error state shown (not `/Carregando calendário\.\.\./` alone), confirming checkpoint C/G's fix; snapshot file restored from backup immediately after, verified byte-identical to the committed version afterward. |
| Recovery after a build update (`build-version.json`'s buildId bumped while a tab is open, `FreshnessGuard.checkNow()` invoked) | 390x844, 768x1024, 1440x900 | EQUAL — page navigated to a URL with `?_fresh=simulatedNEWbuild01`, confirming checkpoint G's freshness-guard actually detects and reloads; `build-version.json` restored to its original committed content afterward, verified byte-identical. |

**Real bug found and fixed during this capture session**: the first run of the "final com
pênaltis" scenario scoped its DOM query with an unqualified `.first()` and picked up an unrelated
real confronto ("Remo") that the app's own auto-init logic populates alongside the seeded fixture,
instead of the seeded "Time Alfa × Time Beta" tie — reported as DIVERGENT rather than silently
passing. Fixed by scoping the query to the tie-group containing "Time Alfa" (fictional, can't
collide with a real team name); rerun confirmed EQUAL with the correct values.

## 3. Evidence integrity

Both `bolao/br2026/data/espn-normalized.json` (temporarily corrupted to simulate the source
failure) and `bolao/cdb2026/build-version.json` (temporarily bumped to simulate a new deploy)
were verified **byte-identical to their committed versions** after each capture script completed
— confirmed via `diff <(git show HEAD:<path>) <path>`, both reporting no difference, and no
leftover `.hardening-evidence-backup` file on disk.
