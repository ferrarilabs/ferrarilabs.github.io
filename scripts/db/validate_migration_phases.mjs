#!/usr/bin/env node
/**
 * Migration phase validator + document generator (Workstream K).
 *
 * WHY THE ORDERING INVARIANTS ARE CODE
 * The value of this workstream is not the phase list — it is the six corrections to the naive
 * ordering, each of which prevents a specific, concrete failure (an unaudited backfill, a parity
 * comparison against a moving target, a matview over half-loaded data, a parity proof against a
 * mutating source, an all-or-nothing backfill, an automated money-affecting merge).
 *
 * A prose ordering argument does not survive the next person who finds it convenient to reorder
 * under deadline pressure. So each correction is expressed as an executable invariant over the phase
 * graph, and reordering the phases breaks a test rather than quietly changing the plan.
 *
 * Usage:
 *   node scripts/db/validate_migration_phases.mjs
 *   node scripts/db/validate_migration_phases.mjs --write | --check | --json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PATH = join(ROOT, "model", "migration_phases.json");
const DOC = join(ROOT, "docs", "bolao", "db-modernization", "MIGRATION_PHASING.md");

const REQUIRED = ["id", "name", "dependsOn", "objects", "dataMovement", "backfill", "compatibility",
  "validation", "rollback", "appDependency", "risk", "lockBehavior", "destructive", "notes"];
const RISKS = ["LOW", "MEDIUM", "HIGH"];

export function loadPhases() { return JSON.parse(readFileSync(PATH, "utf8")); }

/** Index of phase position by name, for ordering checks. */
function positions(phases) {
  const byName = new Map(), byId = new Map();
  phases.forEach((p, i) => { byName.set(p.name, i); byId.set(p.id, i); });
  return { byName, byId };
}

export function validatePhases(doc) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  const phases = doc.phases;
  const { byName, byId } = positions(phases);

  const ids = new Set();
  for (const p of phases) {
    const at = `${p.id || "?"} ${p.name || "?"}`;
    for (const f of REQUIRED) {
      const v = p[f];
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && f !== "dependsOn" && v.length === 0);
      if (empty) E(`${at}: missing "${f}"`);
    }
    if (ids.has(p.id)) E(`duplicate phase id ${p.id}`);
    ids.add(p.id);
    if (!RISKS.includes(p.risk)) E(`${at}: risk "${p.risk}" not in ${RISKS.join("|")}`);
    if (typeof p.destructive !== "boolean") E(`${at}: destructive must be a boolean`);

    // Dependencies must resolve, and must point BACKWARD in the declared order.
    for (const d of p.dependsOn || []) {
      if (!byId.has(d)) { E(`${at}: depends on unknown phase ${d}`); continue; }
      if (byId.get(d) >= byId.get(p.id)) {
        E(`${at}: depends on ${d}, which is not earlier in the declared order — the declared order must be a valid execution order`);
      }
    }
    // Every phase except the first must depend on something, or it is unanchored.
    if (byId.get(p.id) > 0 && (!p.dependsOn || p.dependsOn.length === 0)) {
      E(`${at}: no dependencies declared — an unanchored phase can be run at any time, which is never what is meant`);
    }

    // OI-7: destructive phases need a real rollback.
    if (p.destructive && /^(none|n\/a)$/i.test(String(p.rollback).trim())) {
      E(`${at}: destructive phase with no rollback`);
    }
    // A phase that moves data must say how it is validated.
    if (!/^none$/i.test(String(p.dataMovement).trim()) && /^(none|n\/a)$/i.test(String(p.validation).trim())) {
      E(`${at}: moves data but declares no validation`);
    }
    // Index creation on a live system must be CONCURRENTLY, or writes block.
    if (/CREATE INDEX(?! CONCURRENTLY)/.test(p.objects + p.lockBehavior) && !/CONCURRENTLY/.test(p.lockBehavior)) {
      E(`${at}: creates an index without CONCURRENTLY — a plain CREATE INDEX blocks writes for its duration`);
    }
  }

  // ── ordering invariants (the actual deliverable) ────────────────────────────
  const backfills = phases.filter((p) => p.name.startsWith("backfill_"));
  const idx = (name) => byName.has(name) ? byName.get(name) : -1;

  // OI-1: audit infrastructure before any backfill.
  const audit = idx("audit_and_outbox_infrastructure");
  if (audit < 0) E("OI-1: no audit_and_outbox_infrastructure phase");
  else for (const b of backfills) {
    if (byName.get(b.name) < audit) {
      E(`OI-1 violated: ${b.id} ${b.name} runs before audit infrastructure — the largest data movement in the programme would be the only unaudited one`);
    }
  }

  // OI-2: write-through before dual-read.
  const wt = idx("write_through_via_server_mediated_writes"), dr = idx("dual_read_comparison");
  if (wt < 0 || dr < 0) E("OI-2: write-through or dual-read phase missing");
  else if (wt > dr) E("OI-2 violated: dual-read precedes write-through — every comparison would report method artefacts, not defects, because the relational copy is stale by construction");

  // OI-3: reporting after cutover.
  const rep = idx("reporting_layer"), cut = idx("cutover");
  if (rep < 0 || cut < 0) E("OI-3: reporting or cutover phase missing");
  else if (rep < cut) E("OI-3 violated: reporting is built before cutover — a matview over a partially backfilled table caches confident wrong numbers");

  // OI-4: freeze before cutover.
  const frz = idx("legacy_freeze_window");
  if (frz < 0) E("OI-4: no legacy_freeze_window phase");
  else if (frz > cut) E("OI-4 violated: the freeze follows cutover — parity cannot be proven against a mutating source");

  // OI-5: backfill decomposed.
  if (backfills.length < 3) E(`OI-5 violated: only ${backfills.length} backfill phase(s) — a single backfill is a single point of failure with no partial-success state`);

  // OI-6: no merge before the post-cutover review phase.
  const review = idx("post_cutover_operator_identity_review");
  if (review < 0) E("OI-6: no post_cutover_operator_identity_review phase");
  else {
    const idBackfill = phases.find((p) => p.name === "identity_backfill_zero_merges");
    if (!idBackfill) E("OI-6: the identity backfill phase must be named to make its zero-merge property visible");
    else if (!/zero merges/i.test(idBackfill.backfill + idBackfill.notes)) {
      E("OI-6 violated: the identity backfill does not declare zero merges");
    }
    for (const p of phases) {
      if (byName.get(p.name) >= review) continue;
      if (/\bmerges?\b/i.test(p.dataMovement) && !/zero|candidate|no merge/i.test(p.dataMovement + p.notes)) {
        E(`OI-6 violated: ${p.id} ${p.name} performs a merge before the operator review phase — a migration cannot supply the operator confirmation a merge requires`);
      }
    }
  }

  // OI-8: scoring parity named by the picks-decomposition phase.
  const picks = phases.find((p) => /picks/i.test(p.name) || /picks/i.test(p.dataMovement));
  if (!picks) W("OI-8: no phase decomposes picks — expected in the final phase");
  else if (!/scoring parity|Workstream N/i.test(picks.validation)) {
    E(`OI-8 violated: ${picks.id} changes the scoring input path without naming scoring parity as its validation`);
  }

  // Every declared correction must be reflected by an invariant, and vice versa.
  const enforced = new Set((doc.orderingInvariants || []).map((i) => i.enforces));
  for (const c of doc.meta.orderingCorrections || []) {
    if (!enforced.has(c.id)) E(`ordering correction ${c.id} has no invariant enforcing it — a correction nobody checks is a comment`);
  }

  return { errors, warnings };
}

const GEN = "<!-- GENERATED FILE — do not edit by hand. Source: model/migration_phases.json. Regenerate: node scripts/db/validate_migration_phases.mjs --write -->";

function render(doc) {
  const L = [GEN, "", "# MIGRATION_PHASING — phase plan, ordering challenge and rollback per phase", "",
    "**Workstream K.** Generated from `model/migration_phases.json`; ordering invariants enforced by",
    "`scripts/db/validate_migration_phases.mjs`.", "",
    `Status: **${doc.meta.status}**`, "",
    "## Why the naive ordering is unsafe", "",
    "The value of this plan is not the phase list — it is these six corrections. Each prevents a specific",
    "concrete failure, and each is enforced by an executable invariant, because a prose ordering argument",
    "does not survive the next person who finds it convenient to reorder.", ""];
  for (const c of doc.meta.orderingCorrections) {
    L.push(`### ${c.id}`, "", `- **Naive.** ${c.naive}`, `- **Corrected.** ${c.corrected}`, `- **Why.** ${c.why}`, "");
  }
  L.push("## Phase order", "", "| Phase | Name | Depends on | Risk | Destructive |", "|---|---|---|---|---|");
  for (const p of doc.phases) {
    L.push(`| ${p.id} | \`${p.name}\` | ${(p.dependsOn || []).join(", ") || "—"} | ${p.risk} | ${p.destructive ? "**yes**" : "no"} |`);
  }
  L.push("", "## Ordering invariants (executable)", "", "| Id | Rule | Enforces |", "|---|---|---|");
  for (const i of doc.orderingInvariants) L.push(`| ${i.id} | ${i.rule} | ${i.enforces} |`);
  L.push("");
  for (const p of doc.phases) {
    L.push(`## ${p.id} — \`${p.name}\``, "", "| | |", "|---|---|",
      `| Depends on | ${(p.dependsOn || []).join(", ") || "—"} |`,
      `| Objects introduced | ${p.objects} |`,
      `| Data movement | ${p.dataMovement} |`,
      `| Backfill | ${p.backfill} |`,
      `| Compatibility | ${p.compatibility} |`,
      `| Validation | ${p.validation} |`,
      `| Rollback | ${p.rollback} |`,
      `| Application dependency | ${p.appDependency} |`,
      `| Risk | **${p.risk}** |`,
      `| Expected lock behaviour | ${p.lockBehavior} |`,
      `| Destructive | ${p.destructive ? "**yes**" : "no"} |`, "",
      `**Notes.** ${p.notes}`, "");
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

function main() {
  const argv = process.argv.slice(2);
  const doc = loadPhases();
  const { errors, warnings } = validatePhases(doc);

  if (argv.includes("--write")) {
    if (errors.length) { console.error("refusing to generate from an invalid phase plan:"); for (const e of errors) console.error(`  ✗ ${e}`); return 1; }
    writeFileSync(DOC, render(doc)); console.log(`  wrote ${DOC.replace(ROOT + "/", "")}`); return 0;
  }
  if (argv.includes("--check")) {
    let cur = ""; try { cur = readFileSync(DOC, "utf8"); } catch { cur = ""; }
    const stale = cur !== render(doc);
    if (stale) console.log(`  ✗ stale: ${DOC.replace(ROOT + "/", "")}`); else console.log(`  ✓ fresh: ${DOC.replace(ROOT + "/", "")}`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    console.log(stale || errors.length ? "\n✗ MIGRATION PHASING STALE OR INVALID\n" : "\n✓ migration phasing doc is up to date\n");
    return stale || errors.length ? 1 : 0;
  }
  if (argv.includes("--json")) { console.log(JSON.stringify({ phases: doc.phases.length, errors, warnings }, null, 2)); return errors.length ? 1 : 0; }

  console.log(`\nMigration phasing (${doc.phases.length} phases, ${doc.orderingInvariants.length} ordering invariants)\n`);
  for (const w of warnings) console.log(`  ! ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  console.log(errors.length ? "✗ MIGRATION PHASING INVALID\n" : "✓ MIGRATION PHASING VALID\n");
  return errors.length ? 1 : 0;
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) { try { process.exit(main()); } catch (e) { console.error(`runner error: ${e.message}`); process.exit(2); } }
