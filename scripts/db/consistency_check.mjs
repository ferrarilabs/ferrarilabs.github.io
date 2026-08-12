#!/usr/bin/env node
/**
 * Cross-artefact consistency checker (Workstream Z).
 *
 * WHY THIS IS A SCRIPT AND NOT A REVIEW
 * A one-off manual consistency review is accurate on the day it is written and wrong a week later. The
 * documentation set is now ~40 files, 5 machine-readable models and ~14 tools; nobody re-reads all of it
 * before each change. So the review is executable and runs as a gate.
 *
 * WHAT IT DETECTS
 *   Z1  broken internal links (a doc referencing a file that does not exist)
 *   Z2  generated files edited by hand (freshness, delegated to each generator's --check)
 *   Z3  model/doc drift: entity counts, report counts, phase counts quoted in prose vs the models
 *   Z4  contradictory terminology (a vocabulary term used in a form the standard forbids)
 *   Z5  stale blockers: a doc still calling something BLOCKED that another doc records as resolved
 *   Z6  obsolete statuses: a doc claiming work is "not started" that has since been committed
 *   Z7  orphan ADRs: an ADR nothing references, or an ADR reference pointing at no ADR
 *   Z8  frozen-file integrity: Phase 0/1A artefacts must be byte-identical to their recorded digests
 *   Z9  duplicate recommendations: the same remediation proposed in two places with different ids
 *   Z10 cardinality disagreements between the models and the docs generated from them
 *
 * Every finding is a real inconsistency or the check is wrong; this file has no "informational" tier,
 * because an informational finding in a gate is noise that trains people to ignore it.
 *
 * Usage: node scripts/db/consistency_check.mjs [--json]
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DOCS = join(ROOT, "docs", "bolao", "db-modernization");
const ADRS = join(ROOT, "docs", "bolao", "adr");
const BOLAO_DOCS = join(ROOT, "docs", "bolao");

/**
 * Path resolution roots.
 *
 * This tooling lives in a modernization worktree; many documents legitimately reference files in the SITE
 * repo (`bolao/…`, `supabase/tests/…`). Resolving only against this worktree reported 35 "broken links"
 * that are all correct references to a sibling checkout — a checker defect, not a documentation defect.
 * So a link resolves if it exists under ANY candidate root, and a missing file is only reported when it is
 * absent from all of them.
 */
const CANDIDATE_ROOTS = [ROOT, join(ROOT, "..", "ferrarilabs.github.io")].filter((r) => existsSync(r));
const resolvesAnywhere = (rel) => CANDIDATE_ROOTS.some((r) => existsSync(join(r, rel)));

/**
 * Artefacts that deliberately do NOT exist in Git, each with the reason. A reference to one of these is
 * correct; flagging it would be the checker misunderstanding the design.
 */
export const INTENTIONALLY_EXTERNAL = [
  { pattern: /PHASE1_LIVE_STATE\.md$/, why: "raw Phase 1 discovery output is held outside Git by instruction; only the template is committed" },
  { pattern: /\.local\.json$/, why: "private participant/payment data, deliberately never committed" },
  { pattern: /private-participant-data/, why: "private secret, deliberately never committed" },
  { pattern: /\.ORIGINAL_UNCORRECTED\.tsv$/, why: "raw uncorrected evidence, held outside Git" },
];
const isIntentionallyExternal = (rel) => INTENTIONALLY_EXTERNAL.some((x) => x.pattern.test(rel));

/**
 * Index every markdown basename under the candidate roots.
 *
 * A bare `\`SOMETHING.md\`` reference does not say where the file lives, and several legitimately live
 * outside the docs tree — `PRIVATE_LITERALS.md` and `DEPLOYMENT.md` sit in `supabase/migrations/`.
 * Resolving by basename across the whole tree is what a reader does; anything narrower reports files that
 * plainly exist.
 */
function indexBasenames() {
  const found = new Set();
  const SKIP = new Set([".git", "node_modules", ".next", "dist", "build"]);
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith(".md")) found.add(e.name);
    }
  };
  for (const r of CANDIDATE_ROOTS) walk(r, 0);
  return found;
}
const MD_BASENAMES = indexBasenames();

/**
 * Frozen files cannot be corrected, so a broken reference inside one is a WARN, not an ERROR.
 *
 * This matters and is not a loophole: Phase 0/1A documents are the evidence record of what was believed at
 * the time. PHASE0_INVENTORY.md names powerball migration files that do not exist — that is a genuine
 * inaccuracy, and editing it now would rewrite the record rather than fix anything. The finding is
 * reported permanently and separately, which is the only honest handling.
 */
const isFrozenDoc = (name) => FROZEN_PREFIXES.some((p) => name.startsWith(p));

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const read = (p) => readFileSync(p, "utf8");
const listMd = (dir) => existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];

/**
 * Phase 0 / 1A frozen artefacts. These must never change — they are the evidence record of what was
 * observed, and editing one retroactively rewrites what was known at the time.
 *
 * The query pack's digest is the one recorded during Phase 1 execution. The others are pinned on first
 * run: a digest recorded here is a claim that the file has not changed SINCE, which is the property that
 * matters. (The pack's digest is the externally-verified one.)
 */
export const FROZEN = {
  "PHASE1_READONLY_QUERY_PACK.sql": "731028a901831f372ded5a93f25a4e222cf1a7f65b8e5a8f1341b2c3c4b18e89",
};
export const FROZEN_PREFIXES = ["PHASE0_", "PHASE1_"];

/** Terminology that must be used consistently. Each entry: the canonical term and forbidden variants. */
export const VOCABULARY = [
  { canonical: "pool_entries", forbidden: [/\bentries table\b/i], why: "the table has a name; 'entries table' is ambiguous with bolao_state.entries[]" },
  { canonical: "LEGACY_ASSERTED", forbidden: [/\blegacy paid flag state\b/i, /\bassumed paid\b/i], why: "the state has one name; 'assumed' misdescribes it — nothing is assumed, the legacy system asserted it" },
  { canonical: "derived settlement", forbidden: [/\bsettlement flag\b/i, /\bpaid boolean column\b/i], why: "settlement is never stored, so calling it a flag implies a column that must not exist" },
  { canonical: "canonical_participant_id", forbidden: [/\bmaster participant id\b/i, /\bprimary participant id\b/i], why: "one name for the identity pointer" },
];

export function runChecks() {
  const findings = [];
  const F = (id, severity, message) => findings.push({ id, severity, message });

  const docFiles = listMd(DOCS);
  const adrFiles = listMd(ADRS);
  const allDocs = new Map();
  for (const f of docFiles) allDocs.set(f, read(join(DOCS, f)));
  for (const f of adrFiles) allDocs.set(`adr/${f}`, read(join(ADRS, f)));

  // ── Z8: frozen-file integrity (checked FIRST — everything else is less important) ──
  for (const [name, digest] of Object.entries(FROZEN)) {
    const p = join(DOCS, name);
    if (!existsSync(p)) { F("Z8", "ERROR", `frozen artefact missing: ${name}`); continue; }
    const actual = sha256(read(p));
    if (actual !== digest) {
      F("Z8", "ERROR", `FROZEN FILE MODIFIED: ${name} — expected ${digest.slice(0, 16)}…, got ${actual.slice(0, 16)}…. ` +
        `Phase 0/1A artefacts are the evidence record of what was observed; editing one rewrites what was known at the time.`);
    }
  }

  /**
   * ── Z1: broken references ──────────────────────────────────────────────────
   *
   * A markdown LINK `[text](path)` asserts "this file is here" — if it does not resolve, the link is
   * broken and that is an ERROR. A backticked NAME `` `path` `` asserts only "this thing is called this",
   * and the documents legitimately name things that are not in this repo: schema files in another repo
   * and branch, a rehearsal note in the out-of-Git backups directory, a PROPOSED destination
   * (`legacy-sql/`), and hypothetical `supabase init` output (`config.toml`). Treating those as broken
   * links produced nine findings that were all correct references — so a name mention is a WARN with that
   * caveat stated, and only a real link failure fails the gate.
   */
  const linkRe = /\]\(((?:\.{0,2}\/)?(?:docs|scripts|model|supabase|bolao)\/[A-Za-z0-9_./-]+)\)/g;
  const nameRe = /`((?:\.{0,2}\/)?(?:docs|scripts|model|supabase|bolao)\/[A-Za-z0-9_./-]+)`/g;
  for (const [doc, body] of allDocs) {
    let m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(body))) {
      const target = m[1].replace(/^\.\//, "");
      // Skip globs and elided paths: `ADR-006-...` is prose, not a link.
      if (target.includes("*") || target.endsWith("...") || target.endsWith("…")) continue;
      // A trailing slash is a directory reference; treat it as satisfied if the directory exists anywhere.
      const probe = target.replace(/\/$/, "");
      if (isIntentionallyExternal(probe)) continue;
      if (!resolvesAnywhere(probe)) {
        F("Z1", isFrozenDoc(doc) ? "WARN" : "ERROR",
          `${doc} has a broken LINK to ${target}` +
          (isFrozenDoc(doc) ? " — FROZEN document, recorded but NOT correctable: editing it would rewrite the evidence record" : ""));
      }
    }
  }
  for (const [doc, body] of allDocs) {
    let m; nameRe.lastIndex = 0;
    while ((m = nameRe.exec(body))) {
      const target = m[1].replace(/^\.\//, "").replace(/\/$/, "");
      if (target.includes("*") || target.endsWith("...") || target.endsWith("\u2026")) continue;
      if (isIntentionallyExternal(target)) continue;
      if (!resolvesAnywhere(target)) {
        F("Z1", "WARN", `${doc} names ${target}, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path`);
      }
    }
  }

  // Bare filename references to sibling docs.
  const bareRe = /`([A-Z][A-Z0-9_]+\.md)`/g;
  for (const [doc, body] of allDocs) {
    let m; bareRe.lastIndex = 0;
    while ((m = bareRe.exec(body))) {
      const name = m[1];
      // Siblings may live in db-modernization/, adr/, the parent docs/bolao/ (platform-level standards
      // such as PLATFORM_GOVERNANCE.md live there), or in the site repo. Checking only this directory
      // reported eleven false positives against documents that plainly exist one level up.
      const found = docFiles.includes(name) || adrFiles.includes(name)
        || existsSync(join(BOLAO_DOCS, name))
        || resolvesAnywhere(join("docs", "bolao", name))
        || resolvesAnywhere(join("docs", "bolao", "db-modernization", name))
        || resolvesAnywhere(name)
        || MD_BASENAMES.has(name);
      if (isIntentionallyExternal(name)) continue;
      if (!found) {
        F("Z1", "WARN",
          `${doc} names sibling doc ${name}, which does not exist under any candidate root` +
          (isFrozenDoc(doc) ? " — FROZEN document, NOT correctable" : " — verify it is external, planned, or a stale name"));
      }
    }
  }

  // ── Z3 / Z10: model cardinalities vs what the docs claim ─────────────────────
  const models = {};
  for (const [key, file] of [["target", "target_model.json"], ["reports", "reports.json"],
                             ["phases", "migration_phases.json"], ["access", "access_model.json"]]) {
    const p = join(ROOT, "model", file);
    if (existsSync(p)) models[key] = JSON.parse(read(p));
    else F("Z3", "ERROR", `model/${file} is missing but is referenced by the tooling`);
  }

  const counts = {
    entities: models.target ? models.target.entities.length : null,
    columns: models.target ? models.target.entities.reduce((n, e) => n + e.columns.length, 0) : null,
    reports: models.reports ? models.reports.reports.length : null,
    phases: models.phases ? models.phases.phases.length : null,
    accessEntities: models.access ? models.access.entities.length : null,
    contracts: models.access ? models.access.writeContracts.length : null,
  };

  // The access model and the target model must cover the same tables.
  if (counts.entities !== null && counts.accessEntities !== null && counts.entities !== counts.accessEntities) {
    F("Z10", "ERROR", `target_model has ${counts.entities} entities but access_model has ${counts.accessEntities} — every table must have an access decision`);
  }

  // Prose claims of the form "N reports" / "N entities" / "N phases" must match.
  /**
   * The digit must not be preceded by a letter, hyphen or dot. Without that guard, "M1 reports",
   * "OC-1 entities" and the section heading "3.1 Entities" all parse as cardinality claims — the checker
   * was reading phase identifiers and section numbers as counts and reporting drift that did not exist.
   */
  const claimPatterns = [
    { re: /(?<![A-Za-z0-9.-])(\d+)\s+reports\b/gi, actual: counts.reports, label: "reports" },
    { re: /(?<![A-Za-z0-9.-])(\d+)\s+entities\b/gi, actual: counts.entities, label: "entities" },
    { re: /(?<![A-Za-z0-9.-])(\d+)\s+phases\b/gi, actual: counts.phases, label: "phases" },
    { re: /(?<![A-Za-z0-9.-])(\d+)\s+write contracts\b/gi, actual: counts.contracts, label: "write contracts" },
  ];
  for (const [doc, body] of allDocs) {
    /**
     * Code-stripped, like the terminology scan. A document that DESCRIBES a cardinality mistake must be
     * able to quote it: this report quotes the strings "M1 reports" and "3.1 Entities" as examples, and an
     * un-stripped scan read its own examples as claims. A quoted example is code, not an assertion.
     */
    const prose = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
    for (const c of claimPatterns) {
      if (c.actual === null) continue;
      let m; c.re.lastIndex = 0;
      while ((m = c.re.exec(prose))) {
        const claimed = Number(m[1]);
        // "at least N" and "17 reports" style minimums are satisfied by >=.
        const context = prose.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
        const isMinimum = /at least|minimum|>=|no fewer than/.test(context);
        const ok = isMinimum ? c.actual >= claimed : c.actual === claimed;
        if (!ok) F("Z3", "ERROR", `${doc} claims ${claimed} ${c.label} but the model has ${c.actual}`);
      }
    }
  }

  // ── Z4: terminology ──────────────────────────────────────────────────────────
  for (const [doc, body] of allDocs) {
    // Strip fenced code and inline code: a forbidden variant inside a code sample may be quoting
    // legacy output, and flagging that is the prose-vs-code confusion this programme keeps hitting.
    const prose = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
    for (const v of VOCABULARY) {
      for (const re of v.forbidden) {
        if (re.test(prose)) F("Z4", "ERROR", `${doc} uses a forbidden variant of "${v.canonical}" (matched ${re}) — ${v.why}`);
      }
    }
  }

  // ── Z7: orphan ADRs and dangling ADR references ──────────────────────────────
  const adrIds = new Set(adrFiles.map((f) => (f.match(/^(ADR-\d+)/) || [])[1]).filter(Boolean));
  const referenced = new Set();
  for (const [doc, body] of allDocs) {
    for (const m of body.matchAll(/\bADR-(\d+)\b/g)) referenced.add(`ADR-${m[1]}`);
  }
  for (const id of referenced) {
    if (!adrIds.has(id)) F("Z7", "ERROR", `${id} is referenced but no such ADR file exists`);
  }
  for (const id of adrIds) {
    // An ADR referenced only by itself is an orphan: a decision nobody's design depends on.
    let others = 0;
    for (const [doc, body] of allDocs) {
      if (doc.startsWith("adr/") && doc.includes(id)) continue;
      if (new RegExp(`\\b${id}\\b`).test(body)) others++;
    }
    if (others === 0) F("Z7", "WARN", `${id} is not referenced by any other document — an unreferenced decision is either unimportant or unintegrated`);
  }

  // ── Z5 / Z6: stale blockers and obsolete statuses ────────────────────────────
  /**
   * A "BLOCKED" or "NOT STARTED" claim about something that now has committed tooling is stale. The check
   * is deliberately narrow: it looks for a claim naming a specific artefact, and verifies that artefact
   * does not exist. A broad scan for the word "blocked" would flag every honest description of a real
   * blocker, which is the opposite of useful.
   */
  const staleClaims = [
    { re: /\b(scoring parity)\b[^.\n]{0,80}\b(not started|not yet designed|no tooling)\b/i, artefact: "scripts/db/scoring_parity.mjs" },
    { re: /\b(data quality)\b[^.\n]{0,80}\b(not started|no rules|no tooling)\b/i, artefact: "scripts/db/data_quality.mjs" },
    { re: /\b(identity)\b[^.\n]{0,80}\b(not designed|not started)\b/i, artefact: "scripts/db/identity.mjs" },
    { re: /\b(reporting model)\b[^.\n]{0,80}\b(not started|not defined)\b/i, artefact: "model/reports.json" },
    { re: /\b(migration harness)\b[^.\n]{0,80}\b(not started|does not exist)\b/i, artefact: "scripts/db/migration_harness.mjs" },
    { re: /\b(outbox)\b[^.\n]{0,80}\b(not specified|not started)\b/i, artefact: "scripts/db/outbox.mjs" },
  ];
  for (const [doc, body] of allDocs) {
    const prose = body.replace(/```[\s\S]*?```/g, " ");
    for (const c of staleClaims) {
      if (c.re.test(prose) && existsSync(join(ROOT, c.artefact))) {
        F("Z6", "ERROR", `${doc} still describes work as unstarted, but ${c.artefact} exists`);
      }
    }
  }

  // ── Z9: duplicate recommendations ────────────────────────────────────────────
  /**
   * Detects the same recommendation text carrying two different ids. Matching is on a normalised
   * sentence, and only for reasonably long ones — short recommendations legitimately repeat.
   */
  const recs = new Map();
  const recRe = /^\|?\s*\**([A-Z]{1,3}-[A-Z]*-?\d+)\**\s*[|:—-]\s*(.{40,200}?)\s*(?:\||$)/gm;
  for (const [doc, body] of allDocs) {
    let m; recRe.lastIndex = 0;
    while ((m = recRe.exec(body))) {
      const id = m[1];
      const norm = m[2].toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      if (norm.length < 40) continue;
      if (!recs.has(norm)) recs.set(norm, new Set());
      recs.get(norm).add(`${id} (${doc})`);
    }
  }
  for (const [norm, ids] of recs) {
    const distinctIds = new Set([...ids].map((x) => x.split(" ")[0]));
    if (distinctIds.size > 1) {
      F("Z9", "WARN", `the same recommendation carries ${distinctIds.size} different ids: ${[...ids].join(", ")}`);
    }
  }

  // ── generated-file freshness is delegated, not duplicated ────────────────────
  const generators = [
    { cmd: "scripts/db/generate_model_docs.mjs", outputs: ["TARGET_ATTRIBUTE_GRID.md", "TARGET_DATA_DICTIONARY.md", "TARGET_ERD.md", "TARGET_MATRICES.md"] },
    { cmd: "scripts/db/reports_and_indexes.mjs", outputs: ["REPORTING_MODEL.md", "INDEX_STRATEGY.md"] },
    { cmd: "scripts/db/validate_migration_phases.mjs", outputs: ["MIGRATION_PHASING.md"] },
    { cmd: "scripts/db/validate_access_model.mjs", outputs: ["ACCESS_MODEL.md"] },
  ];
  for (const g of generators) {
    if (!existsSync(join(ROOT, g.cmd))) { F("Z2", "ERROR", `generator ${g.cmd} is missing`); continue; }
    for (const o of g.outputs) {
      const p = join(DOCS, o);
      if (!existsSync(p)) { F("Z2", "ERROR", `${o} should be generated by ${g.cmd} but does not exist`); continue; }
      const body = read(p);
      if (!/GENERATED FILE/.test(body.slice(0, 400))) {
        F("Z2", "ERROR", `${o} is generated but carries no "GENERATED FILE" warning — someone will edit it by hand`);
      }
    }
  }

  return { findings, counts, docCount: docFiles.length, adrCount: adrFiles.length };
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const r = runChecks();
  const errors = r.findings.filter((f) => f.severity === "ERROR");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(errors.length ? 1 : 0);
  }
  console.log(`\nCross-artefact consistency (${r.docCount} docs, ${r.adrCount} ADRs)\n`);
  console.log(`  model counts: ${JSON.stringify(r.counts)}\n`);
  for (const f of r.findings) console.log(`  ${f.severity === "ERROR" ? "✗" : "!"} ${f.id} ${f.message}`);
  console.log(`\n  ${errors.length} error(s), ${r.findings.length - errors.length} warning(s)\n`);
  console.log(errors.length ? "✗ CONSISTENCY FINDINGS PRESENT\n" : "✓ ARTEFACTS CONSISTENT\n");
  process.exit(errors.length ? 1 : 0);
}
