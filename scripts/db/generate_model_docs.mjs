#!/usr/bin/env node
/**
 * Generates every projection of model/target_model.json.
 *
 * WHY GENERATION RATHER THAN PROSE
 * The attribute grid, data dictionary, ERD, constraint matrix, PII matrix and index list are six
 * views of ONE set of facts. Hand-writing them would duplicate ~600 cells across six documents,
 * guaranteed to diverge the first time a column changes — and divergence in a specification is
 * exactly the failure this programme keeps finding elsewhere. One authored source, six generated
 * views, one validator.
 *
 * Generated files carry a DO-NOT-EDIT banner naming this script. `--check` verifies they are
 * up to date without writing, so CI can fail when someone edits a generated file or forgets to
 * regenerate after editing the model.
 *
 * Usage:
 *   node scripts/db/generate_model_docs.mjs            # write
 *   node scripts/db/generate_model_docs.mjs --check    # verify freshness, exit 1 if stale
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadModel, withDefaults, validate } from "./validate_target_model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "..", "..", "docs", "bolao", "db-modernization");
const CHECK = process.argv.includes("--check");

const BANNER = (src) => `<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source of truth: model/target_model.json
     Generator:       scripts/db/generate_model_docs.mjs
     Regenerate:      node scripts/db/generate_model_docs.mjs
     Any hand edit will be overwritten and will fail \`--check\` in CI.
     ${src} -->\n`;

const model = loadModel();
const { errors } = validate(model);
if (errors.length) {
  console.error("refusing to generate from an INVALID model:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const ents = model.entities;
const byDomain = (d) => ents.filter((e) => e.domain === d);
const DOMAINS = [...new Set(ents.map((e) => e.domain))];
const yn = (b) => (b ? "YES" : "NO");
const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const code = (v) => (v === null || v === undefined || v === "" ? "—" : "`" + v + "`");

// ─────────────────────────────────────────────────────────────────────────────
// 1. ATTRIBUTE GRID (Workstream A) — every column, every attribute
// ─────────────────────────────────────────────────────────────────────────────
function attributeGrid() {
  const L = [];
  L.push(BANNER("Workstream A — implementation-grade attribute grid"));
  L.push("# TARGET_ATTRIBUTE_GRID — every column of every target entity\n");
  L.push(`**Model version:** ${model.meta.modelVersion} · **Entities:** ${ents.length} · ` +
         `**Columns:** ${ents.reduce((n, e) => n + e.columns.length, 0)} · ` +
         `**FKs:** ${ents.reduce((n, e) => n + e.columns.filter((c) => c.fk).length, 0)}\n`);
  L.push(`**Currency policy:** ${model.meta.currencyPolicy}\n`);
  L.push(`**Money type:** ${model.meta.moneyType}\n`);
  L.push("**STATUS:** specification only. No executable DDL is generated from this model.\n");
  L.push("> Column attributes omitted from the model take these defaults: `nullable=NO`, `pk=NO`,");
  L.push("> `pii=NONE`, `financial=NONE`, `encryption=NONE`, `retention=WITH_PARENT`,");
  L.push("> `audit=CHANGES_AUDITED`, `mutable=YES`, `api=INTERNAL`, `conflict=LAST_WRITE_WINS`.\n");
  L.push("---\n");

  for (const d of DOMAINS) {
    L.push(`## Domain: ${d}\n`);
    for (const e of byDomain(d)) {
      L.push(`### \`${e.schema}.${e.name}\`\n`);
      L.push(`**Purpose.** ${e.purpose}\n`);
      L.push(`**Owner:** \`${e.owner}\` · **Migration phase:** ${e.migrationPhase}\n`);
      L.push(`**Rollback implication.** ${e.rollbackImplication}\n`);
      L.push(`**RLS intent** — anon: ${e.rlsIntent.anon} · authenticated: ${e.rlsIntent.authenticated} · ` +
             `admin: ${e.rlsIntent.admin} · service: ${e.rlsIntent.service}\n`);

      // core column table
      L.push("| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |");
      L.push("|---|---|---|---|---|---|---|---|---|---|");
      for (const raw of e.columns) {
        const c = withDefaults(raw);
        L.push(`| ${c.logical} | \`${c.sql}\` | \`${c.type}\` | ${yn(c.nullable)} | ${code(c.default)} | ` +
               `${c.pk ? "**PK**" : "—"} | ${code(c.fk)} | ${dash(c.onDelete)} | ` +
               `${c.unique ? (c.unique === true ? "YES" : c.unique) : "—"} | ${yn(c.mutable)} |`);
      }
      L.push("");

      // classification table
      L.push("| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |");
      L.push("|---|---|---|---|---|---|---|---|");
      for (const raw of e.columns) {
        const c = withDefaults(raw);
        L.push(`| \`${c.sql}\` | ${c.pii} | ${c.financial} | ${c.encryption} | ${c.retention} | ` +
               `${c.audit} | ${c.api} | ${c.conflict} |`);
      }
      L.push("");

      // provenance / migration table — only rows that have something to say
      const prov = e.columns.map(withDefaults).filter((c) => c.legacy || c.legacyPath || c.transformation || c.backfill || c.validation || c.generated || c.check || c.notes);
      if (prov.length) {
        L.push("| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |");
        L.push("|---|---|---|---|---|---|---|---|---|");
        for (const c of prov) {
          L.push(`| \`${c.sql}\` | ${dash(c.generated)} | ${dash(c.check)} | ${dash(c.legacy)} | ` +
                 `${code(c.legacyPath)} | ${dash(c.transformation)} | ${dash(c.backfill)} | ` +
                 `${dash(c.validation)} | ${dash(c.notes)} |`);
        }
        L.push("");
      }

      if ((e.indexes || []).length) {
        L.push("**Indexes**\n");
        L.push("| Columns | Unique | Partial condition | Rationale |");
        L.push("|---|---|---|---|");
        for (const i of e.indexes) {
          L.push(`| \`${i.cols.join(", ")}\` | ${yn(i.unique)} | ${code(i.partial)} | ${i.rationale} |`);
        }
        L.push("");
      }
      if ((e.checks || []).length) {
        L.push("**Check constraints**\n");
        L.push("| Name | Expression | Why |");
        L.push("|---|---|---|");
        for (const k of e.checks) L.push(`| \`${k.name}\` | \`${k.expr}\` | ${k.why} |`);
        L.push("");
      }
      L.push("---\n");
    }
  }

  if (model.addedEntitiesRationale) {
    L.push("## Entities added beyond the requested list\n");
    for (const [name, why] of Object.entries(model.addedEntitiesRationale)) {
      L.push(`**\`${name}\`** — ${why}\n`);
    }
  }
  return L.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DATA DICTIONARY (Workstream H)
// ─────────────────────────────────────────────────────────────────────────────
function dataDictionary() {
  const L = [];
  L.push(BANNER("Workstream H — target data dictionary"));
  L.push("# TARGET_DATA_DICTIONARY\n");
  L.push("Business and technical definition of every target field, with classification, ownership,");
  L.push("source and consumer. Generated from the same model as the attribute grid, so the two");
  L.push("cannot disagree.\n");
  L.push(`Cross-links: ratified decisions ${model.meta.ratifiedDecisions.join(", ")} · ` +
         `ADRs ${model.meta.adrs.join(", ")}\n`);
  L.push("---\n");
  L.push("| Entity | Field | Business definition | Technical definition | Allowed values | Owner | Classification | Source of truth | Consumers |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const e of ents) {
    for (const raw of e.columns) {
      const c = withDefaults(raw);
      const allowed = c.check ? c.check : (c.validation || (c.nullable ? "any, or NULL" : "any"));
      const cls = [c.pii !== "NONE" ? `PII:${c.pii}` : null,
                   c.financial !== "NONE" ? `FIN:${c.financial}` : null,
                   c.encryption !== "NONE" ? `ENC:${c.encryption}` : null,
                   `RET:${c.retention}`].filter(Boolean).join(" · ");
      const consumers = c.api === "PUBLIC_PROJECTION" ? "public projection, reports"
                      : c.api === "VIA_VIEW" ? "authenticated views, reports"
                      : c.api === "VIA_RPC_ONLY" ? "RPC only — never a report"
                      : "internal / server only";
      L.push(`| \`${e.name}\` | \`${c.sql}\` | ${c.logical}${c.notes ? " — " + c.notes.replace(/\|/g, "\\|") : ""} | ` +
             `\`${c.type}\`${c.nullable ? " NULL" : " NOT NULL"}${c.generated ? " " + c.generated : ""} | ` +
             `${String(allowed).replace(/\|/g, "\\|")} | ${e.owner} | ${cls} | ` +
             `${c.legacy ? `legacy: ${c.legacy}${c.legacyPath ? " " + c.legacyPath : ""}` : c.sourceOfTruth} | ${consumers} |`);
    }
  }
  return L.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ERD + dependency order (Workstream J)
// ─────────────────────────────────────────────────────────────────────────────
function topoOrder() {
  const deps = new Map(ents.map((e) => [e.name, new Set()]));
  for (const e of ents) {
    for (const c of e.columns) {
      if (!c.fk) continue;
      const [, table] = c.fk.split(".");
      if (table !== e.name && deps.has(table)) deps.get(e.name).add(table);
    }
  }
  const order = [], seen = new Set();
  let guard = 0;
  while (order.length < ents.length && guard++ < 200) {
    for (const e of ents) {
      if (seen.has(e.name)) continue;
      if ([...deps.get(e.name)].every((d) => seen.has(d))) { order.push(e.name); seen.add(e.name); }
    }
  }
  for (const e of ents) if (!seen.has(e.name)) order.push(e.name + " (cycle)");
  return order;
}

function erd() {
  const L = [];
  L.push(BANNER("Workstream J — target ERD and migration dependency order"));
  L.push("# TARGET_ERD — logical model, financial flow, and dependency ordering\n");
  L.push("Generated from the model, so the diagram cannot drift from the attribute grid.\n");
  L.push("---\n");

  L.push("## 1. Logical ERD — full target model\n");
  L.push("```mermaid");
  L.push("erDiagram");
  for (const e of ents) {
    for (const c of e.columns) {
      if (!c.fk) continue;
      const [, table] = c.fk.split(".");
      if (table === e.name) continue;               // self-refs drawn separately
      if (!ents.some((x) => x.name === table)) continue; // external (auth.users)
      const optional = c.nullable ? "|o" : "||";
      L.push(`    ${table} ${optional}--o{ ${e.name} : "${c.sql}"`);
    }
  }
  L.push("```\n");

  L.push("## 2. Self-references and identity graph\n");
  L.push("```mermaid");
  L.push("graph LR");
  for (const e of ents) {
    for (const c of e.columns) {
      if (!c.fk) continue;
      const [, table] = c.fk.split(".");
      if (table === e.name) L.push(`    ${e.name} -->|"${c.sql}"| ${e.name}`);
    }
  }
  L.push("    participants -->|superseded by merge| participant_identity_links");
  L.push("    participant_identity_links -->|reversible| participants");
  L.push("```\n");

  L.push("## 3. Financial flow — inbound and outbound kept separate\n");
  L.push("```mermaid");
  L.push("graph LR");
  L.push("    payer[\"participants (payer)\"] -->|makes| P[payments]");
  L.push("    P -->|allocated via| A[payment_allocations]");
  L.push("    A -->|funds| E[pool_entries]");
  L.push("    F[pool_fee_schedule] -->|snapshotted onto| E");
  L.push("    E -.->|DERIVED settlement| S([\"unpaid / partially_paid / settled / overpaid\"])");
  L.push("    P -.->|DERIVED| U([unapplied_amount])");
  L.push("    POOL[pools] -->|awards| Z[prize_allocations]");
  L.push("    Z -->|to| E");
  L.push("    classDef out fill:#5a4a1a,color:#fff");
  L.push("    class Z out");
  L.push("```\n");
  L.push("Inbound (`payments` → `payment_allocations`) and outbound (`prize_allocations`) never share a");
  L.push("table. Conflating them is the classic accounting modelling error that makes reconciliation");
  L.push("ambiguous.\n");

  L.push("## 4. Competition hierarchy\n");
  L.push("```mermaid");
  L.push("graph TD");
  L.push("    C[competitions] --> CE[competition_editions]");
  L.push("    CE --> CEP[competition_edition_phases]");
  L.push("    CE --> POOL[pools]");
  L.push("    CEP --> T[ties]");
  L.push("    CEP --> M[matches]");
  L.push("    T --> M");
  L.push("    M --> MR[match_results]");
  L.push("    POOL --> PE[pool_entries]");
  L.push("    PE --> PR[predictions]");
  L.push("    M --> PR");
  L.push("    T --> PR");
  L.push("    POOL --> RS[ranking_snapshots]");
  L.push("```\n");

  L.push("## 5. Outbox and audit flow\n");
  L.push("```mermaid");
  L.push("graph LR");
  L.push("    RPC[\"Edge Function RPC\"] -->|writes| DB[(base tables)]");
  L.push("    RPC -->|appends| AE[audit_events]");
  L.push("    AE -.->|sensitive detail, unchained| AED[audit_event_details]");
  L.push("    RPC -->|enqueues| OE[outbox_events]");
  L.push("    OE -->|leased by| W[worker]");
  L.push("    W -->|one row per try| ODA[outbox_delivery_attempts]");
  L.push("    W -.->|external| PROV[email / webhook provider]");
  L.push("    OE -.->|terminal| DEAD([dead — needs a human])");
  L.push("```\n");
  L.push("`audit_event_details` is deliberately OUTSIDE the hash chain: that is what lets PII be");
  L.push("redacted for an erasure request without breaking audit integrity (G-02).\n");

  L.push("## 6. Migration dependency order (topological)\n");
  L.push("Creation order that satisfies every FK. Derived from the model, not hand-sequenced.\n");
  const order = topoOrder();
  L.push("| # | Entity | Phase | Depends on |");
  L.push("|---|---|---|---|");
  order.forEach((name, i) => {
    const e = ents.find((x) => x.name === name);
    if (!e) { L.push(`| ${i + 1} | \`${name}\` | — | — |`); return; }
    const d = [...new Set(e.columns.filter((c) => c.fk).map((c) => c.fk.split(".")[1])
      .filter((t) => t !== e.name && ents.some((x) => x.name === t)))];
    L.push(`| ${i + 1} | \`${e.name}\` | ${e.migrationPhase} | ${d.length ? d.map((x) => "`" + x + "`").join(", ") : "—"} |`);
  });
  L.push("");
  return L.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CONSTRAINT + PII + INDEX matrices (Workstreams B, R, V)
// ─────────────────────────────────────────────────────────────────────────────
function matrices() {
  const L = [];
  L.push(BANNER("Workstreams B / R / V — constraint, PII, RLS and index matrices"));
  L.push("# TARGET_MATRICES — constraints, PII, RLS intent and indexes\n");
  L.push("---\n");

  L.push("## 1. Constraint matrix\n");
  L.push("| Entity | PK | FKs | Unique | Checks | Cascades | Preservation posture |");
  L.push("|---|---|---|---|---|---|---|");
  for (const e of ents) {
    const cols = e.columns.map(withDefaults);
    const pk = cols.filter((c) => c.pk).map((c) => c.sql).join(", ");
    const fks = cols.filter((c) => c.fk).length;
    const uniq = (e.indexes || []).filter((i) => i.unique).length + cols.filter((c) => c.unique === true).length;
    const casc = cols.filter((c) => c.onDelete === "CASCADE").map((c) => c.sql);
    const posture = casc.length === 0 ? "**preserve** (no cascade)" : `cascade on ${casc.join(", ")}`;
    L.push(`| \`${e.name}\` | \`${pk}\` | ${fks} | ${uniq} | ${(e.checks || []).length} | ${casc.length} | ${posture} |`);
  }
  L.push("");
  L.push("### Every cascade, challenged\n");
  L.push("| Entity.column | ON DELETE | Justification |");
  L.push("|---|---|---|");
  for (const e of ents) {
    for (const raw of e.columns) {
      const c = withDefaults(raw);
      if (c.onDelete === "CASCADE") L.push(`| \`${e.name}.${c.sql}\` | CASCADE | ${c.notes || "**UNJUSTIFIED — review**"} |`);
    }
  }
  L.push("");
  L.push("Everything else is `RESTRICT` or `SET NULL`. For money-bearing records preservation beats");
  L.push("cascade: a deleted allocation silently changes settlement, and a deleted payment destroys");
  L.push("financial history. Cascade appears only where the child is fully recomputable.\n");

  L.push("## 2. PII matrix\n");
  L.push("| Entity | Column | PII class | Encryption | Retention | API exposure |");
  L.push("|---|---|---|---|---|---|");
  let piiCount = 0;
  for (const e of ents) {
    for (const raw of e.columns) {
      const c = withDefaults(raw);
      if (c.pii === "NONE") continue;
      piiCount++;
      L.push(`| \`${e.name}\` | \`${c.sql}\` | **${c.pii}** | ${c.encryption} | ${c.retention} | ${c.api} |`);
    }
  }
  L.push("");
  L.push(`**${piiCount} classified PII columns.** Direct identifiers and contact data appear in`);
  L.push("`participants` **only** — that is the point of the participant-master model: PII stored once,");
  L.push("referenced by FK everywhere else.\n");

  L.push("## 3. RLS intent matrix\n");
  L.push("| Entity | anon | authenticated | admin/operator | service runtime |");
  L.push("|---|---|---|---|---|");
  for (const e of ents) {
    L.push(`| \`${e.schema}.${e.name}\` | ${e.rlsIntent.anon} | ${e.rlsIntent.authenticated} | ` +
           `${e.rlsIntent.admin} | ${e.rlsIntent.service} |`);
  }
  L.push("");
  L.push("**No entity grants `anon` any write.** Critical financial and admin writes are server-mediated");
  L.push("(ratified E3), and base tables live outside the PostgREST-exposed schema (ratified E1).\n");

  L.push("## 4. Index recommendations\n");
  L.push("| Entity | Columns | Unique | Partial | Rationale | Write cost |");
  L.push("|---|---|---|---|---|---|");
  let idxCount = 0;
  for (const e of ents) {
    for (const i of e.indexes || []) {
      idxCount++;
      const cost = i.unique ? "insert/update must check uniqueness" : "one extra write per insert/update";
      L.push(`| \`${e.name}\` | \`${i.cols.join(", ")}\` | ${yn(i.unique)} | ${code(i.partial)} | ${i.rationale} | ${cost} |`);
    }
  }
  L.push("");
  L.push(`**${idxCount} indexes across ${ents.length} entities.** Every one carries a rationale — the`);
  L.push("validator rejects an index without one, because an unjustified index is write cost with no owner.\n");
  L.push("### Redundancy pre-check\n");
  const seen = new Map();
  const redundant = [];
  for (const e of ents) {
    for (const i of e.indexes || []) {
      const key = `${e.name}:${i.cols.join(",")}`;
      if (seen.has(key)) redundant.push(key);
      seen.set(key, true);
      // a non-unique index whose columns are a prefix of a unique one is redundant
      for (const j of e.indexes) {
        if (i === j || i.unique || !j.unique) continue;
        if (j.cols.slice(0, i.cols.length).join(",") === i.cols.join(",") && !i.partial && !j.partial) {
          redundant.push(`${e.name}: (${i.cols.join(",")}) is a prefix of unique (${j.cols.join(",")})`);
        }
      }
    }
  }
  L.push(redundant.length === 0
    ? "No exact duplicates and no non-partial index that is a prefix of a unique index. Partial\nindexes that share a column prefix are retained deliberately — the partial condition is what\nmakes them cheaper than the full index, not redundant with it.\n"
    : redundant.map((r) => `- ⚠ ${r}`).join("\n") + "\n");
  return L.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
const OUTPUTS = [
  ["TARGET_ATTRIBUTE_GRID.md", attributeGrid()],
  ["TARGET_DATA_DICTIONARY.md", dataDictionary()],
  ["TARGET_ERD.md", erd()],
  ["TARGET_MATRICES.md", matrices()],
];

let stale = 0;
for (const [name, content] of OUTPUTS) {
  const path = join(DOCS, name);
  const body = content.endsWith("\n") ? content : content + "\n";
  if (CHECK) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (current !== body) { console.log(`  ✗ STALE: ${name}`); stale++; }
    else console.log(`  ✓ fresh: ${name}`);
  } else {
    writeFileSync(path, body);
    console.log(`  wrote ${name} (${body.split("\n").length} lines)`);
  }
}

if (CHECK) {
  console.log(stale === 0 ? "\n✓ all generated docs are up to date\n" : `\n✗ ${stale} generated doc(s) are stale — run the generator\n`);
  process.exit(stale === 0 ? 0 : 1);
}
console.log("\n✓ generated 4 documents from model/target_model.json\n");
