# Forensic Visual Parity Audit — Evidence Manifest

Package for independent review. All artifacts under this directory. SHA-256 hashes for every
file (as of this manifest) are in `SHA256SUMS.txt` — verify with:

```
shasum -a 256 -c SHA256SUMS.txt
```

## Provenance

- Branch: `forensic-visual-audit-v2`
- Audited commit / tree: see `provenance` block in `verdict.json` (`auditedCommit`,
  `auditedTreeHash`) — `auditedTreeHash` is computed live from `git rev-parse HEAD^{tree}` in
  the worktree that actually rendered the evidence, not just a base commit reference.
- `fixtureVersion` / `harnessVersion`: see the same `verdict.json`, and the `meta` block of
  every other JSON artifact below.
- No absolute `/Users/...` paths appear in any artifact (verified with `grep -r` across this
  directory before packaging). No `__MACOSX` entries in the zip (built with `zip -X`, no
  Finder/AppleDouble metadata).

## Top-level files

| File | Purpose |
|---|---|
| `forensic-visual-report.html` / `index.html` | Human-readable navigable report: every component/state comparison, pixel diffs, montages. |
| `verdict.json` | Machine-readable pass/fail gate result: property counts by status, N/A breakdown by reason, pixel-diff record counts (incl. duplicate check), console error count, provenance. |
| `computed-style-comparison.json` | Per-component/state/property CSS comparison across all 3 apps (IDENTICAL/WITHIN_TOLERANCE/FUNCTIONALLY_JUSTIFIED/DIVERGENT/N/A). |
| `geometry-comparison.json` | Same, for bounding-box width/height. |
| `pixel-diff-summary.json` | Isolated-component pixel diffs (Copa as reference) with record-count/duplicate audit. |
| `fixture-definition.json` | The fictional games/ranking fixture data every app rendered for this audit (no real participant names). |
| `console-errors.json` | Raw console/network errors captured per app, before the part-10 known-baseline filter is applied (the filter itself lives in `main.mjs`). |
| `HOTFIX_5a9dad4_CLASSIFICATION.md` | Per-change classification of the already-merged production commit `5a9dad4` (part 2). |
| `MANIFEST.md` | This file. |
| `SHA256SUMS.txt` | SHA-256 of every file in this directory (verify with `shasum -a 256 -c`). |

## Subdirectories

| Directory | Purpose |
|---|---|
| `diff-images/captures/` | Raw isolated-component and full-page screenshots per app/state/role/viewport. |
| `diff-images/*_vs_*.png` | Pixel-diff overlay images (candidate app vs. Copa reference). |
| `montages/` | Side-by-side (Copa \| BR2026 \| CDB2026) composite screenshots per screen/viewport/state, plus `montage_manifest.json`. |

## Related governance documents (outside this directory, referenced by the report)

- `docs/bolao/governance/BREAK_GLASS_PRODUCTION_RUNBOOK.md` — incident runbook + narrative for
  commit `5a9dad4`.
- `docs/bolao/CONSISTENCY_MATRIX.md`, `docs/bolao/PLATFORM_GOVERNANCE.md` — cross-app design
  system and governance rules this audit checks against.
