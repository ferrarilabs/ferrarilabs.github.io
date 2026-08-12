#!/usr/bin/env node
/**
 * Report-model validator + index-strategy derivation (Workstreams G and V).
 *
 * WHY THE TWO ARE ONE TOOL
 * An index strategy written independently of the reports is a guess. The whole point of V is that
 * every proposed index traces to a named workload — so the index set is DERIVED from reports.json
 * rather than asserted beside it. Splitting them into two files would let them drift, and a
 * plausible-looking index list nobody can trace to a query is how write cost accumulates with no owner.
 *
 * WHAT IT CHECKS
 *   G · every report declares grain, dimensions, measures, joins, filters, PII, RLS, indexes,
 *       materialization and refresh — a MATVIEW with no refresh story is a stale-data incident waiting
 *   G · every table.column an index references resolves against model/target_model.json
 *   G · financial/contact reports are operator-gated (a FINANCIAL report readable by anon is a breach)
 *   G · no report claims to read a stored settlement flag (settlement is derived, always)
 *   V · redundant indexes: a proposed index whose columns are a LEFT PREFIX of another on the same
 *       table is redundant — PostgreSQL can use the wider one, so the narrow one is pure write cost
 *   V · indexes proposed by reports but absent from the model, and vice versa (drift in both directions)
 *
 * Usage:
 *   node scripts/db/reports_and_indexes.mjs            # validate + derive
 *   node scripts/db/reports_and_indexes.mjs --write    # regenerate the two generated docs
 *   node scripts/db/reports_and_indexes.mjs --check    # fail if the generated docs are stale
 *   node scripts/db/reports_and_indexes.mjs --json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadModel } from "./validate_target_model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const REPORTS_PATH = join(ROOT, "model", "reports.json");
const DOC_REPORTS = join(ROOT, "docs", "bolao", "db-modernization", "REPORTING_MODEL.md");
const DOC_INDEXES = join(ROOT, "docs", "bolao", "db-modernization", "INDEX_STRATEGY.md");

const REQUIRED_FIELDS = ["id", "name", "question", "grain", "dimensions", "measures", "joins",
  "filters", "piiExposure", "rlsRoles", "rlsNotes", "indexes", "materialization", "refresh", "notes"];
export const RLS_ROLES = ["anon", "authenticated", "operator", "service"];
const PII_CLASSES = ["NONE", "PSEUDONYMOUS", "CONTACT", "FINANCIAL"];
const MATERIALIZATIONS = ["QUERY", "VIEW", "MATVIEW"];

export function loadReports() { return JSON.parse(readFileSync(REPORTS_PATH, "utf8")); }

/** Parse "table(col1, col2)" into { table, cols }. */
export function parseIndexSpec(spec) {
  const m = String(spec).match(/^([a-z_]+)\(([^)]*)\)$/);
  if (!m) return null;
  return { table: m[1], cols: m[2].split(",").map((c) => c.trim()).filter(Boolean) };
}

export function validateReports(reports, model) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);

  const modelTables = new Map();
  for (const e of model.entities) modelTables.set(e.name, new Set(e.columns.map((c) => c.sql)));
  const modelIndexes = new Set();
  for (const e of model.entities) {
    for (const idx of e.indexes || []) modelIndexes.add(`${e.name}(${idx.cols.join(", ")})`);
  }

  const ids = new Set();
  for (const r of reports.reports) {
    const at = `${r.id || "?"} ${r.name || "?"}`;
    for (const f of REQUIRED_FIELDS) {
      const v = r[f];
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) E(`${at}: missing "${f}"`);
    }
    if (ids.has(r.id)) E(`duplicate report id ${r.id}`);
    ids.add(r.id);

    if (!PII_CLASSES.includes(r.piiExposure)) E(`${at}: piiExposure "${r.piiExposure}" not in ${PII_CLASSES.join("|")}`);
    if (!MATERIALIZATIONS.includes(r.materialization)) E(`${at}: materialization "${r.materialization}" not in ${MATERIALIZATIONS.join("|")}`);

    // A materialized view without a refresh story is a stale-data incident with a scheduled arrival.
    if (r.materialization === "MATVIEW" && (!r.refresh || r.refresh === "n/a")) {
      E(`${at}: MATVIEW with no refresh behaviour — stale results are indistinguishable from wrong results`);
    }
    if (r.materialization !== "MATVIEW" && r.refresh && r.refresh !== "n/a") {
      W(`${at}: declares refresh behaviour but is not a MATVIEW`);
    }

    /**
     * Access control is checked against the STRUCTURED `rlsRoles` list, never against `rlsNotes`.
     *
     * The prose version of this check fired on R-05, whose note reads "never exposed to anon" — the
     * checker read an English sentence saying the opposite of what it concluded. A checker that
     * pattern-matches prose reports noise, so the data it reads is now structured and the prose is
     * documentation only.
     */
    const rolesRaw = r.rlsRoles;
    if (!Array.isArray(rolesRaw) || rolesRaw.length === 0) {
      E(`${at}: rlsRoles must be a non-empty list of ${RLS_ROLES.join("|")}`);
    } else {
      for (const role of rolesRaw) if (!RLS_ROLES.includes(role)) E(`${at}: unknown rls role "${role}"`);
      if (["FINANCIAL", "CONTACT"].includes(r.piiExposure) && !rolesRaw.includes("operator")) {
        E(`${at}: piiExposure=${r.piiExposure} but no operator role — money and contact data are operator-gated`);
      }
      if (rolesRaw.includes("anon") && r.piiExposure !== "NONE") {
        E(`${at}: anon may read a ${r.piiExposure} report — that is a disclosure, not a configuration choice`);
      }
      if (rolesRaw.includes("authenticated") && r.piiExposure === "FINANCIAL") {
        E(`${at}: authenticated may read a FINANCIAL report; financial reads are server-mediated (Workstream R/S)`);
      }
    }

    // Settlement must never be read from a stored flag.
    const blob = JSON.stringify([r.measures, r.filters, r.notes]);
    if (/stored[_ ]settlement|settlement_status\b(?!_derived)|\bpaid\b\s*=\s*true/i.test(blob)
        && !/derived/i.test(blob)) {
      E(`${at}: appears to read a stored settlement value — settlement is always derived from payment_allocations`);
    }

    // Index specs must resolve against the model.
    for (const spec of r.indexes || []) {
      const p = parseIndexSpec(spec);
      if (!p) { E(`${at}: index spec "${spec}" is not of the form table(col, ...)`); continue; }
      const cols = modelTables.get(p.table);
      if (!cols) { E(`${at}: index on unknown table "${p.table}"`); continue; }
      for (const c of p.cols) {
        if (!cols.has(c)) E(`${at}: index ${spec} references unknown column ${p.table}.${c}`);
      }
    }
  }
  return { errors, warnings, modelIndexes };
}

/**
 * Derive the index strategy from the reports (Workstream V).
 *
 * Each entry records which reports justify it. An index no report justifies has no owner and should
 * not exist; write amplification is paid on every INSERT for a read nobody performs.
 */
export function deriveIndexStrategy(reports, model) {
  const byKey = new Map();
  for (const r of reports.reports) {
    for (const spec of r.indexes || []) {
      const p = parseIndexSpec(spec);
      if (!p) continue;
      const key = `${p.table}(${p.cols.join(", ")})`;
      if (!byKey.has(key)) byKey.set(key, { table: p.table, cols: p.cols, workloads: [] });
      byKey.get(key).workloads.push(`${r.id} ${r.name}`);
    }
  }

  const proposals = [...byKey.values()].sort((a, b) => a.table.localeCompare(b.table) || a.cols.join().localeCompare(b.cols.join()));

  // Classify write cost by how hot the table is and how wide the index is.
  const HOT = new Set(["predictions", "payment_allocations", "outbox_events", "outbox_delivery_attempts", "audit_events"]);
  for (const p of proposals) {
    p.unique = false;
    p.partial = null;
    p.ordering = p.cols.length > 1 ? "leading column is the equality predicate; trailing column is the range/sort key" : "single column";
    p.writeCost = HOT.has(p.table) ? (p.cols.length > 1 ? "MODERATE — hot table, composite" : "LOW-MODERATE — hot table, narrow")
                                   : (p.cols.length > 1 ? "LOW — cold table, composite" : "LOW — cold table, narrow");
    p.rationale = `serves ${p.workloads.length} report workload(s): ${p.workloads.join("; ")}`;
  }

  // Redundancy: a proposal whose columns are a LEFT PREFIX of another on the same table.
  const redundant = [];
  for (const a of proposals) {
    for (const b of proposals) {
      if (a === b || a.table !== b.table) continue;
      if (a.cols.length >= b.cols.length) continue;
      const isPrefix = a.cols.every((c, i) => b.cols[i] === c);
      if (isPrefix) {
        redundant.push({
          drop: `${a.table}(${a.cols.join(", ")})`,
          keep: `${b.table}(${b.cols.join(", ")})`,
          why: "the narrow index is a left prefix of the wider one; PostgreSQL can satisfy the narrow lookup from the wider index, so keeping both pays write cost twice for one read path",
        });
      }
    }
  }
  for (const r of redundant) {
    const p = proposals.find((x) => `${x.table}(${x.cols.join(", ")})` === r.drop);
    if (p) p.redundantWith = r.keep;
  }

  // Drift against the model, in both directions.
  const modelIndexes = new Set();
  for (const e of model.entities) for (const idx of e.indexes || []) modelIndexes.add(`${e.name}(${idx.cols.join(", ")})`);
  const proposedKeys = new Set(proposals.map((p) => `${p.table}(${p.cols.join(", ")})`));
  const inReportsNotModel = [...proposedKeys].filter((k) => !modelIndexes.has(k));
  const inModelNotReports = [...modelIndexes].filter((k) => !proposedKeys.has(k));

  return { proposals, redundant, inReportsNotModel, inModelNotReports };
}

// ─── document generation ─────────────────────────────────────────────────────
const GEN_WARNING = "<!-- GENERATED FILE — do not edit by hand. Source: model/reports.json + model/target_model.json. Regenerate: node scripts/db/reports_and_indexes.mjs --write -->";

function renderReportsDoc(reports) {
  const L = [GEN_WARNING, "", "# REPORTING_MODEL — read model for every platform report", "",
    "**Workstream G.** Generated from `model/reports.json`. Validated by",
    "`scripts/db/reports_and_indexes.mjs`.", "",
    "Status: **DESIGN ONLY.** No view, materialized view or index exists anywhere as a result of this document.", "",
    `${reports.reports.length} reports.`, "",
    "## Summary", "",
    "| Id | Report | Grain | PII | RLS roles | Materialization | Refresh |", "|---|---|---|---|---|---|---|"];
  for (const r of reports.reports) {
    L.push(`| ${r.id} | \`${r.name}\` | ${r.grain} | ${r.piiExposure} | ${r.rlsRoles.join(", ")} | ${r.materialization} | ${r.refresh} |`);
  }
  L.push("", "## Cross-cutting rules", "",
    "- **Settlement is always derived** from `payment_allocations`. No report may read a stored settlement value; the validator rejects it.",
    "- **Canonical identity must be resolved before filtering by participant.** A merged participant's history otherwise appears empty (R-01), and returning-participant counts silently overstate growth (R-14).",
    "- **`LEGACY_ASSERTED` entries are shown beside money, never inside it.** They have no recoverable amount, so any total that folds them in is wrong (R-07, R-15).",
    "- **Per-currency grain** on every money aggregate. Summing across currencies is the error the financial engine refuses (R-11, R-15).",
    "- **Published snapshots are never re-pointed** after an identity merge; R-13 shows history as published.", "");
  for (const r of reports.reports) {
    L.push(`## ${r.id} — \`${r.name}\``, "", `**Question.** ${r.question}`, "", `**Grain.** ${r.grain}`, "",
      "| | |", "|---|---|",
      `| Dimensions | ${r.dimensions.map((d) => `\`${d}\``).join(", ")} |`,
      `| Measures | ${r.measures.map((d) => `\`${d}\``).join(", ")} |`,
      `| Joins | ${r.joins.join(" · ")} |`,
      `| Filters | ${r.filters.map((f) => `\`${f}\``).join(" · ")} |`,
      `| PII exposure | **${r.piiExposure}** |`,
      `| RLS roles | **${r.rlsRoles.join(", ")}** |`,
      `| RLS notes | ${r.rlsNotes} |`,
      `| Indexes | ${r.indexes.map((i) => `\`${i}\``).join(", ") || "none"} |`,
      `| Materialization | **${r.materialization}** |`,
      `| Refresh | ${r.refresh} |`, "",
      `**Notes.** ${r.notes}`, "");
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

function renderIndexDoc(strategy, reports) {
  const L = [GEN_WARNING, "", "# INDEX_STRATEGY — indexes derived from actual report workloads", "",
    "**Workstream V.** Generated from `model/reports.json` + `model/target_model.json`.", "",
    "Status: **PROPOSAL ONLY. No index has been created in production.**", "",
    "Every index below traces to a named report workload. An index no report justifies has no owner:",
    "write amplification is paid on every INSERT for a read nobody performs. That traceability is the",
    "reason this document is generated from the report model rather than written beside it.", "",
    "## Proposals", "",
    "| Table | Columns | Unique | Partial | Write cost | Workloads |", "|---|---|---|---|---|---|"];
  for (const p of strategy.proposals) {
    L.push(`| \`${p.table}\` | \`${p.cols.join(", ")}\` | ${p.unique ? "UNIQUE" : "no"} | ${p.partial || "—"} | ${p.writeCost} | ${p.workloads.join("<br>")} |`);
  }
  L.push("", "### Ordering guidance", "");
  for (const p of strategy.proposals.filter((x) => x.cols.length > 1)) {
    L.push(`- \`${p.table}(${p.cols.join(", ")})\` — ${p.ordering}`);
  }
  L.push("", "## Redundancy findings", "");
  if (!strategy.redundant.length) {
    L.push("None. No proposed index is a left prefix of another on the same table.");
  } else {
    L.push("| Drop | Covered by | Why |", "|---|---|---|");
    for (const r of strategy.redundant) L.push(`| \`${r.drop}\` | \`${r.keep}\` | ${r.why} |`);
  }
  L.push("", "## Drift against `model/target_model.json`", "",
    "Drift is reported in **both** directions deliberately. An index in the model that no report needs is",
    "unowned write cost; a report that needs an index the model does not declare will be slow the day it ships.", "",
    `**Proposed by reports, absent from the model (${strategy.inReportsNotModel.length}):**`, "");
  L.push(strategy.inReportsNotModel.length ? strategy.inReportsNotModel.map((k) => `- \`${k}\``).join("\n") : "- none");
  L.push("", `**Declared in the model, not required by any report (${strategy.inModelNotReports.length}):**`, "");
  L.push(strategy.inModelNotReports.length ? strategy.inModelNotReports.map((k) => `- \`${k}\``).join("\n") : "- none");
  L.push("", "These lists are **informational, not errors**: a model index may legitimately exist to support a",
    "constraint, a foreign-key lookup, or a write path rather than a report. What matters is that no entry on",
    "either list is a surprise. Each one should be either justified or removed before Workstream K applies any",
    "index-creating migration.", "");
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

function main() {
  const argv = process.argv.slice(2);
  const reports = loadReports();
  const model = loadModel();
  const { errors, warnings } = validateReports(reports, model);
  const strategy = deriveIndexStrategy(reports, model);

  const docs = [[DOC_REPORTS, renderReportsDoc(reports)], [DOC_INDEXES, renderIndexDoc(strategy, reports)]];

  if (argv.includes("--write")) {
    if (errors.length) { console.error("refusing to generate documents from an invalid model:"); for (const e of errors) console.error(`  ✗ ${e}`); return 1; }
    for (const [p, c] of docs) { writeFileSync(p, c); console.log(`  wrote ${p.replace(ROOT + "/", "")}`); }
    return 0;
  }
  if (argv.includes("--check")) {
    let stale = 0;
    for (const [p, c] of docs) {
      let cur = "";
      try { cur = readFileSync(p, "utf8"); } catch { cur = ""; }
      if (cur !== c) { console.log(`  ✗ stale: ${p.replace(ROOT + "/", "")}`); stale++; }
      else console.log(`  ✓ fresh: ${p.replace(ROOT + "/", "")}`);
    }
    if (errors.length) { for (const e of errors) console.log(`  ✗ ${e}`); }
    console.log(stale || errors.length ? "\n✗ REPORT/INDEX DOCS STALE OR INVALID\n" : "\n✓ report and index docs are up to date\n");
    return stale || errors.length ? 1 : 0;
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ reports: reports.reports.length, errors, warnings, strategy }, null, 2));
    return errors.length ? 1 : 0;
  }

  console.log(`\nReport model (${reports.reports.length} reports) + derived index strategy\n`);
  for (const w of warnings) console.log(`  ! ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`  indexes proposed: ${strategy.proposals.length}`);
  console.log(`  redundant: ${strategy.redundant.length}`);
  for (const r of strategy.redundant) console.log(`      drop ${r.drop} (covered by ${r.keep})`);
  console.log(`  in reports not model: ${strategy.inReportsNotModel.length}`);
  console.log(`  in model not reports: ${strategy.inModelNotReports.length}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  console.log(errors.length ? "✗ REPORT MODEL INVALID\n" : "✓ REPORT MODEL VALID\n");
  return errors.length ? 1 : 0;
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  try { process.exit(main()); }
  catch (e) { console.error(`runner error: ${e.message}`); process.exit(2); }
}
