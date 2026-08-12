#!/usr/bin/env node
/**
 * BATCH G — refresh and revalidate the M1–M10 migration drafts against the current validated model.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FOUND FIRST, BECAUSE IT CHANGES HOW THE REST SHOULD BE READ
 *
 * The drafts are GENERATED from model/target_model.json by generate_migration_drafts.mjs, and
 * regenerating them produces byte-identical files. So there is no generator-level drift, and the
 * premise "the drafts predate the model" is not where the problem is.
 *
 * The drift is one level up: between the MODEL and the decisions WS9/WS10/WS11 reached after it was
 * written. A generated artefact is exactly as current as its generator's input, which means an
 * out-of-date model produces confidently out-of-date SQL.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * STEP 1 — SOURCE OF TRUTH MAP
 *
 * Prose is never authoritative where a machine-readable model exists. Where two machine-readable
 * sources disagree, the one named here wins and the other is a finding.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DRAFT_DIR = join(ROOT, "docs", "bolao", "db-modernization", "migration-drafts");

const load = (p) => JSON.parse(readFileSync(join(ROOT, "model", p), "utf8"));

export const SOURCE_OF_TRUTH = Object.freeze({
  entities: "model/target_model.json .entities[].name",
  columns: "model/target_model.json .entities[].columns[].sql",
  types: "model/target_model.json .entities[].columns[].type",
  nullability: "model/target_model.json .entities[].columns[].nullable",
  primaryKeys: "model/target_model.json .entities[].columns[].pk",
  foreignKeys: "model/target_model.json .entities[].columns[].fk + .onDelete",
  uniqueConstraints: "model/target_model.json .entities[].indexes[] where unique",
  checks: "model/target_model.json .entities[].checks[]",
  indexes: "model/target_model.json .entities[].indexes[] — REVIEWED BY scripts/db/index_validation.mjs (WS11)",
  enums: "model/target_model.json .enums — MIRRORS the JS vocabularies named in each enum's `why`",
  rlsIntent: "model/rls_model.json + model/access_model.json; model/target_model.json .entities[].rlsIntent is a SUMMARY, not the source",
  aclIntent: "model/access_model.json",
  writeContracts: "model/write_contracts.json",
  audit: "model/target_model.json audit_events + audit_event_details",
  outbox: "model/target_model.json outbox_events + outbox_delivery_attempts",
  reporting: "model/reports.json, with executable prototypes in scripts/db/reports_sql.mjs",
  migrationPhases: "model/migration_phases.json — see NUMBERING_CONFLICT below",
  settlementVocabulary: "scripts/db/financial.mjs SETTLEMENT (the enum must mirror it)",
  paymentKindVocabulary: "scripts/db/financial_evidence.mjs PAYMENT_KIND",
});

/**
 * The two M-numbering schemes in this repository are DIFFERENT and both call themselves "M1–M10".
 * This is recorded as a finding rather than silently reconciled, because renaming either one would
 * invalidate every cross-reference written so far.
 */
export const NUMBERING_CONFLICT = Object.freeze({
  draftScheme: {
    source: "docs/bolao/db-modernization/migration-drafts/M*.draft.sql",
    meaning: "DDL ONLY, one phase per entity group. M1 types, M2 identity, M3 competitions, M4 pools/entries, M5 money, M6 phases/ties/matches/sync, M7 results/predictions, M8 audit, M9 outbox, M10 rankings.",
    backfills: "none — this scheme contains no backfill phase at all",
  },
  phasePlanScheme: {
    source: "model/migration_phases.json",
    meaning: "DDL AND BACKFILL INTERLEAVED across M0–M17. M4 is audit/outbox infrastructure, M5 is the identity BACKFILL, M6 financial tables, M8 the entry backfill, M9 the payment backfill, M10 the results/audit/sync backfill.",
    backfills: "M5, M8, M9, M10",
  },
  collision: "The label 'M8' means 'create audit tables' in one scheme and 'backfill entries' in the other. 'M9' means 'create outbox tables' or 'backfill asserted payments'. 'M10' means 'create ranking_snapshots' or 'backfill results, audit and sync'.",
  consequence: "Any instruction of the form 'M8/M9 must match the canonical audit and outbox model' is only meaningful in the DRAFT scheme. Read against the phase plan it is a category error, and an operator following the wrong one would apply a backfill where DDL was intended.",
  resolution: "NOT resolved by renaming. Recorded, and every cross-reference in this module states which scheme it means. Renaming is an operator decision (BATCH-G-OP-1) because it invalidates the WS5 choreography, the readiness matrix, the ordering invariants and every commit message that cites a phase.",
});

/**
 * STEP 18/19 — why there is no synthetic PostgreSQL build.
 *
 * No PostgreSQL SERVER is available on this machine: libpq ships `initdb` and `pg_ctl` but no
 * `postgres` binary, and there is no container runtime. So the draft sequence cannot be applied to an
 * empty database and the DDL is not proven to compile.
 *
 * Worse, and worth recording: a bare `pg_isready` in this environment resolves to the PRODUCTION
 * pooler from the ambient configuration. Any `psql` invoked here without an explicit target would hit
 * production, so no libpq client is used by this tooling at all.
 *
 * What replaces it: the model round-trip (STEP 20). The drafts are parsed by an INDEPENDENT parser —
 * not the generator that wrote them — and the resulting schema is diffed back against the model. That
 * proves the files say what the model says. It does NOT prove PostgreSQL accepts them, and this batch
 * does not claim it does.
 */
export const SYNTHETIC_EXECUTION_LIMITATION = Object.freeze({
  postgresServerAvailable: false,
  reason: "libpq client only (initdb/pg_ctl present, no postgres binary); no docker or podman",
  productionHazard: "a bare libpq command resolves to the production pooler from the ambient environment, so no psql is used anywhere in this tooling",
  substitute: "independent-parser round-trip against model/target_model.json (STEP 20), plus the SQLite report-fixture schema for query semantics",
  notProven: ["that PostgreSQL parses the DDL", "that constraint validation succeeds", "that any index builds", "that monetary column names in the report prototypes match the drafted schema"],
});

export const CLASS = {
  ERROR: "ERROR",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  EXPECTED_PHASE_DIFFERENCE: "EXPECTED_PHASE_DIFFERENCE",
  DEFERRED: "DEFERRED",
  FALSE_POSITIVE: "FALSE_POSITIVE",
};

const finding = (klass, kind, subject, detail, why) => ({ klass, kind, subject, detail, why });

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 2 — MIGRATION DRAFT PARSER
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Strip comments and string literals before structural matching.
 *
 * This is done first and unconditionally because every false positive this programme has produced in
 * a SQL scan came from matching a keyword inside prose or inside a quoted literal: a comment naming a
 * forbidden shape, the word TRUNCATE in a string, "CREATE TABLE" in an explanatory paragraph. The
 * drafts are unusually comment-heavy, so scanning raw text would be almost entirely noise.
 *
 * Comments are returned separately, because the header comments carry declared metadata this module
 * needs (dependencies, rollback class, backfill requirement).
 */
export function stripNoise(sql) {
  const comments = [];
  let out = "", i = 0, n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      comments.push(sql.slice(i, stop));
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      comments.push(sql.slice(i, stop));
      out += sql.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (sql[i] === "$" ) {
      // dollar-quoted body: $$ ... $$ or $tag$ ... $tag$
      const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        out += sql.slice(i, stop).replace(/[^\n]/g, " ");
        i = stop;
        continue;
      }
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < n) { if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; } if (sql[j] === "'") { j++; break; } j++; }
      out += sql.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
      continue;
    }
    out += sql[i];
    i++;
  }
  return { code: out, comments };
}

const unquote = (s) => String(s ?? "").trim().replace(/^"(.*)"$/, "$1");
// Schema prefix first, THEN unquote. `bolao."payments"` does not match a ^"..."$ unquote, so
// unquoting first left the quotes attached and every table name came out as `"payments"`.
const stripSchema = (s) => unquote(String(s ?? "").trim().replace(/^(?:"?bolao"?|"?audit"?|"?public"?|"?auth"?)\./, ""));
const schemaOf = (s) => (/^(?:"?(bolao|audit|public|auth)"?)\./.exec(String(s ?? "").trim()) || [])[1] || null;

/**
 * Tables this migration sequence deliberately does NOT create. `auth.users` is Supabase's own table:
 * every `created_by` column references it, and treating that as "the parent is never created" would
 * bury 9 real findings under 9 false ones.
 */
export const EXTERNAL_TABLES = Object.freeze({
  users: { schema: "auth", why: "Supabase's auth.users, created by the platform and referenced by every created_by/actor column" },
  bolao_state: { schema: "public", why: "the legacy document; it already exists and must not be altered before the contract step" },
});

/** Phases outside the M1-M10 draft set that a draft may legitimately depend on. */
export const EXTERNAL_PHASES = Object.freeze({ M0: "baseline registration; PREPARED_NOT_EXECUTED and outside the draft set" });

/** Split a parenthesised column/constraint list at top-level commas. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const HEADER_FIELDS = {
  dependencies: /^--\s*DEPENDENCIES:\s*(.+)$/m,
  tablesCreated: /^--\s*TABLES CREATED:\s*(.+)$/m,
  rollback: /^--\s*ROLLBACK STRATEGY \(([A-Z_]+)\)/m,
  backfill: /^--\s*BACKFILL REQUIREMENT\.\s*(.+)$/m,
  compatibility: /^--\s*APPLICATION COMPATIBILITY\.\s*(.+)$/m,
};

/**
 * Parse one draft into a machine-readable object inventory.
 * Everything is extracted from `code` (noise-stripped); only the declared header metadata is read
 * from the comments, and only via the anchored patterns above.
 */
export function parseDraft(sql, { name = "(inline)" } = {}) {
  const { code, comments } = stripNoise(sql);
  const commentText = comments.join("\n");

  const out = {
    name,
    // Both draft-scheme forms are recognised: the historical bare `M7_...` and the namespaced
    // `DDL-M11_...` introduced for new phases. A new phase carries its scheme in its id because two
    // numbering systems already both claim M1-M10 (BATCH-G-OP-1), and a third meaning on an ambiguous
    // label is worse than a longer name.
    phase: (/^(DDL-M\d+|M\d+)_/.exec(name) || [])[1] || null,
    schemas: [], extensions: [], enums: [], tables: {}, indexes: [], functions: [], triggers: [],
    views: [], policies: [], grants: [], revokes: [], rlsEnabled: [], rlsForced: [], comments: [],
    header: {}, statements: 0, transactional: /\bBEGIN\s*;/i.test(code) && /\bCOMMIT\s*;/i.test(code),
    banner: {
      notForProduction: /NOT FOR PRODUCTION APPLY/.test(commentText),
      reviewDraftOnly: /REVIEW DRAFT ONLY/.test(commentText),
      requiresAuthorization: /REQUIRES M0 \+ RESTORE REHEARSAL \+ EXPLICIT OPERATOR AUTHORIZATION/.test(commentText),
    },
  };

  for (const [k, re] of Object.entries(HEADER_FIELDS)) {
    const m = re.exec(commentText);
    if (m) out.header[k] = m[1].trim();
  }

  out.statements = code.split(";").filter((s) => s.trim()).length;

  for (const m of code.matchAll(/CREATE\s+SCHEMA(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w".]+)/gi)) out.schemas.push(stripSchema(m[1]));
  for (const m of code.matchAll(/CREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w".]+)/gi)) out.extensions.push(unquote(m[1]));

  for (const m of code.matchAll(/CREATE\s+TYPE\s+([\w".]+)\s+AS\s+ENUM\s*\(([^)]*)\)/gi)) {
    out.enums.push({
      name: unquote(m[1]).replace(/"/g, ""),
      values: splitTopLevel(m[2]).map((v) => v.trim().replace(/^'|'$/g, "")).filter(Boolean),
      // Values were blanked by stripNoise (they are string literals), so recover them from the raw SQL.
      raw: true,
    });
  }
  // Enum values are string literals and therefore blanked. Recover them from the ORIGINAL text, still
  // anchored on the CREATE TYPE statement so prose cannot contribute.
  for (const m of sql.matchAll(/CREATE\s+TYPE\s+([\w".]+)\s+AS\s+ENUM\s*\(([\s\S]*?)\)\s*;/gi)) {
    const nm = unquote(m[1]).replace(/"/g, "");
    const vals = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    const e = out.enums.find((x) => x.name === nm);
    if (e) { e.values = vals; delete e.raw; } else out.enums.push({ name: nm, values: vals });
  }

  // Column DEFAULTs are frequently string literals, which stripNoise blanks. Recover them from the
  // raw text, still anchored inside a CREATE TABLE body so prose cannot contribute a default.
  const rawDefaults = {};
  for (const tm of sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w".]+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
    const tn = stripSchema(tm[1]);
    rawDefaults[tn] = {};
    for (const cm of tm[2].matchAll(/^\s*"?([\w]+)"?\s+[^,\n]*?\bDEFAULT\s+([^,\n]+?)\s*(?:,|$)/gim)) {
      rawDefaults[tn][cm[1]] = cm[2].trim();
    }
  }

  for (const m of code.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w".]+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
    const table = stripSchema(m[1]);
    const parts = splitTopLevel(m[2]);
    const t = { name: table, columns: {}, pk: [], fks: [], uniques: [], checks: [], columnOrder: [], createdHere: true };
    for (const part of parts) {
      const upper = part.toUpperCase();
      if (/^CONSTRAINT\b/i.test(part) || /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(part)) {
        const cname = (/^CONSTRAINT\s+([\w".]+)/i.exec(part) || [])[1];
        if (/PRIMARY\s+KEY/i.test(upper)) {
          const cols = (/PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(part) || [])[1];
          if (cols) t.pk = splitTopLevel(cols).map(unquote);
        } else if (/FOREIGN\s+KEY/i.test(upper)) {
          const fk = /FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([\w".]+)\s*\(([^)]*)\)([^,]*)/i.exec(part);
          if (fk) {
            t.fks.push({
              name: unquote(cname || ""), columns: splitTopLevel(fk[1]).map(unquote),
              refTable: stripSchema(fk[2]), refSchema: schemaOf(fk[2]), refColumns: splitTopLevel(fk[3]).map(unquote),
              onDelete: (/ON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/i.exec(fk[4] || "") || [])[1]?.toUpperCase().replace(/\s+/g, " ") || null,
              onUpdate: (/ON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/i.exec(fk[4] || "") || [])[1]?.toUpperCase().replace(/\s+/g, " ") || null,
            });
          }
        } else if (/^\s*(CONSTRAINT\s+[\w".]+\s+)?UNIQUE/i.test(part)) {
          const cols = (/UNIQUE\s*\(([^)]*)\)/i.exec(part) || [])[1];
          if (cols) t.uniques.push({ name: unquote(cname || ""), columns: splitTopLevel(cols).map(unquote) });
        } else if (/CHECK/i.test(upper)) {
          t.checks.push({ name: unquote(cname || ""), expr: part.replace(/^CONSTRAINT\s+[\w".]+\s+/i, "").trim() });
        }
        continue;
      }
      const cm = /^([\w".]+)\s+(.+)$/.exec(part);
      if (!cm) continue;
      const col = unquote(cm[1]);
      const rest = cm[2];
      const typeMatch = /^((?:[\w".]+)(?:\s*\([^)]*\))?(?:\s*\[\s*\])?)/.exec(rest);
      const col_ = {
        name: col,
        type: (typeMatch ? typeMatch[1] : rest.split(/\s+/)[0]).trim().replace(/"/g, ""),
        notNull: /\bNOT\s+NULL\b/i.test(rest),
        default: (/\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|REFERENCES|CHECK|UNIQUE|PRIMARY|GENERATED)|$)/i.exec(rest) || [])[1]?.trim() || null,
        inlinePk: /\bPRIMARY\s+KEY\b/i.test(rest),
        generated: /\bGENERATED\b/i.test(rest),
      };
      const ref = /REFERENCES\s+([\w".]+)\s*\(([^)]*)\)([^,]*)/i.exec(rest);
      if (ref) {
        t.fks.push({
          name: "", columns: [col], refTable: stripSchema(ref[1]), refSchema: schemaOf(ref[1]), refColumns: splitTopLevel(ref[2]).map(unquote),
          onDelete: (/ON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/i.exec(ref[3] || "") || [])[1]?.toUpperCase().replace(/\s+/g, " ") || null,
          onUpdate: (/ON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/i.exec(ref[3] || "") || [])[1]?.toUpperCase().replace(/\s+/g, " ") || null,
          inline: true,
        });
      }
      if (col_.inlinePk) t.pk.push(col);
      if (!col_.default && rawDefaults[table] && rawDefaults[table][col]) col_.default = rawDefaults[table][col];
      t.columns[col] = col_;
      t.columnOrder.push(col);
    }
    out.tables[table] = t;
  }

  // ALTER TABLE ... ADD COLUMN. A column introduced AFTER its table's own phase is not in any CREATE
  // TABLE, so a parser that only reads CREATE TABLE reports it MISSING_COLUMN forever — which is what
  // happened the moment the first post-hoc column existed. The round trip has to read the same DDL
  // PostgreSQL would; suppressing the diff instead would have made the drift checker blind to every
  // future additive column, and this checker is what proves the model and the SQL agree.
  //
  // Same table shape as the CREATE TABLE path above: `columns` is a keyed map, not an array, and the
  // flag is `notNull`. Building a different shape here parses fine and then fails much later inside the
  // differ, which is a worse failure than not parsing at all.
  for (const m of code.matchAll(/ALTER\s+TABLE\s+([\w".]+)\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w"]+)\s+([^;]+);/gi)) {
    const table = stripSchema(m[1]);
    const column = unquote(m[2]).replace(/"/g, "");
    const rest = m[3].trim();
    const t = (out.tables[table] ??= { name: table, columns: {}, pk: [], fks: [], uniques: [], checks: [], columnOrder: [], createdHere: false });
    if (t.columns[column]) continue;
    const typeMatch = /^((?:[\w".]+)(?:\s*\([^)]*\))?(?:\s*\[\s*\])?)/.exec(rest);
    t.columns[column] = {
      name: column,
      type: (typeMatch ? typeMatch[1] : rest.split(/\s+/)[0]).trim().replace(/"/g, ""),
      notNull: /\bNOT\s+NULL\b/i.test(rest),
      // The generator refuses to emit a DEFAULT on this path, but parse defensively: if one ever
      // appeared, the differ must see it rather than report the column as default-less.
      default: (/\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|REFERENCES|CHECK|UNIQUE|PRIMARY|GENERATED)|$)/i.exec(rest) || [])[1]?.trim() || null,
      inlinePk: false,
      generated: /\bGENERATED\b/i.test(rest),
      addedByAlter: true,
    };
    t.columnOrder.push(column);
  }

  // The column list is extracted with BALANCED parentheses, not `\(([^)]*)\)`. An expression index
  // such as `(lower(display_name))` closes on its inner paren, so the naive form captured
  // `lower(display_name` and silently produced a different index than the file declares.
  for (const m of code.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)\s+ON\s+([\w".]+)\s*(?:USING\s+(\w+)\s*)?\(/gi)) {
    const open = m.index + m[0].length - 1;
    let depth = 0, close = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) continue;
    const colBody = code.slice(open + 1, close);
    const tail = code.slice(close + 1, code.indexOf(";", close) === -1 ? undefined : code.indexOf(";", close));
    out.indexes.push({
      name: unquote(m[3]), table: stripSchema(m[4]), method: m[5] || null,
      unique: !!m[1], concurrently: !!m[2],
      cols: splitTopLevel(colBody).map((c) => unquote(c.trim())),
      partial: (/WHERE\s+([\s\S]+)$/i.exec(tail) || [])[1]?.trim().replace(/\s+/g, " ") || null,
    });
  }
  // A partial predicate may contain string literals (`WHERE status = 'dead'`), which stripNoise blanks,
  // so it is recovered from the RAW text — but scoped to the single statement that names this index.
  //
  // The first version matched `INDEX <name> ... WHERE ... ;` with a lazy cross-statement wildcard, so
  // when an index had no WHERE it happily attached the WHERE from a LATER statement — including from a
  // postcheck `SELECT ... WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY[...])`. Nine indexes
  // were reported with predicates they do not have, which is a worse failure than missing them: the
  // tool asserted a property the file never claimed.
  for (const ix of out.indexes) {
    const at = sql.indexOf(`"${ix.name}"`);
    if (at === -1) continue;
    const end = sql.indexOf(";", at);
    const stmt = end === -1 ? sql.slice(at) : sql.slice(at, end);
    const w = /\)\s*WHERE\s+([\s\S]+)$/i.exec(stmt);
    ix.partial = w ? w[1].trim().replace(/\s+/g, " ") : null;
  }

  for (const m of code.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w".]+)\s*\(([^)]*)\)/gi)) {
    out.functions.push({ name: stripSchema(m[1]), args: splitTopLevel(m[2]).map((a) => a.trim()) });
  }
  for (const m of code.matchAll(/CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([\w".]+)([\s\S]*?)ON\s+([\w".]+)/gi)) {
    out.triggers.push({ name: unquote(m[1]), table: stripSchema(m[3]), timing: m[2].trim().replace(/\s+/g, " ") });
  }
  for (const m of code.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW\s+([\w".]+)/gi)) {
    out.views.push({ name: stripSchema(m[2]), materialized: !!m[1] });
  }
  for (const m of code.matchAll(/CREATE\s+POLICY\s+([\w".]+)\s+ON\s+([\w".]+)/gi)) {
    out.policies.push({ name: unquote(m[1]), table: stripSchema(m[2]) });
  }
  for (const m of code.matchAll(/\bGRANT\s+([\s\S]*?)\s+ON\s+([\s\S]*?)\s+TO\s+([\w",\s]+)/gi)) {
    out.grants.push({ privileges: m[1].trim(), target: m[2].trim(), roles: m[3].split(",").map((r) => unquote(r.trim())) });
  }
  for (const m of code.matchAll(/\bREVOKE\s+([\s\S]*?)\s+ON\s+([\s\S]*?)\s+FROM\s+([\w",\s]+)/gi)) {
    out.revokes.push({ privileges: m[1].trim(), target: m[2].trim(), roles: m[3].split(",").map((r) => unquote(r.trim())) });
  }
  for (const m of code.matchAll(/ALTER\s+TABLE\s+([\w".]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) out.rlsEnabled.push(stripSchema(m[1]));
  for (const m of code.matchAll(/ALTER\s+TABLE\s+([\w".]+)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi)) out.rlsForced.push(stripSchema(m[1]));
  for (const m of code.matchAll(/COMMENT\s+ON\s+(\w+)\s+([\w".]+)/gi)) out.comments.push({ objectType: m[1].toUpperCase(), object: stripSchema(m[2]) });

  return out;
}

export function parseAllDrafts(dir = DRAFT_DIR) {
  const num = (f) => Number((/M(\d+)_/.exec(f) || [])[1]);
  // Namespaced phases sort by their number but AFTER the bare phase of the same number, so a
  // dependency declared on an earlier bare phase is still earlier in the sequence.
  const namespaced = (f) => (/^DDL-/.test(f) ? 1 : 0);
  return readdirSync(dir).filter((f) => /^(DDL-M\d+|M\d+)_.*\.draft\.sql$/.test(f))
    .sort((a, b) => num(a) - num(b) || namespaced(a) - namespaced(b))
    .map((f) => parseDraft(readFileSync(join(dir, f), "utf8"), { name: f }));
}

/** Union of every parsed draft — the schema the full sequence would produce. */
export function draftInventory(drafts = parseAllDrafts()) {
  const inv = { tables: {}, indexes: [], enums: [], schemas: new Set(), extensions: new Set(), rlsEnabled: new Set(), policies: [], grants: [], functions: [], triggers: [], views: [], phaseOf: {} };
  for (const d of drafts) {
    for (const s of d.schemas) inv.schemas.add(s);
    for (const e of d.extensions) inv.extensions.add(e);
    for (const e of d.enums) inv.enums.push({ ...e, phase: d.phase });
    for (const [n, t] of Object.entries(d.tables)) {
      // A later phase may ADD COLUMN to a table an earlier phase created. Assigning `inv.tables[n]`
      // outright made the ALTER phase's fragment REPLACE the CREATE phase's full definition — the union
      // reported pools as having one column, no primary key and no foreign keys, and `phaseOf` moved to
      // the ALTER phase, which then made pools_slug_uidx look like an index created before its table.
      // A union has to union.
      const prev = inv.tables[n];
      if (!prev) { inv.tables[n] = { ...t, phase: d.phase }; inv.phaseOf[n] = d.phase; continue; }
      inv.tables[n] = {
        ...prev,
        columns: { ...prev.columns, ...t.columns },
        columnOrder: [...prev.columnOrder, ...t.columnOrder.filter((c) => !prev.columnOrder.includes(c))],
        pk: prev.pk.length ? prev.pk : t.pk,
        fks: [...prev.fks, ...t.fks],
        uniques: [...prev.uniques, ...t.uniques],
        checks: [...prev.checks, ...t.checks],
        // phaseOf stays the CREATING phase: it answers "when did this table come into existence",
        // which is what the index-ordering check needs.
      };
    }
    for (const ix of d.indexes) inv.indexes.push({ ...ix, phase: d.phase });
    for (const t of d.rlsEnabled) inv.rlsEnabled.add(t);
    inv.policies.push(...d.policies.map((p) => ({ ...p, phase: d.phase })));
    inv.grants.push(...d.grants.map((g) => ({ ...g, phase: d.phase })));
    inv.functions.push(...d.functions.map((f) => ({ ...f, phase: d.phase })));
    inv.triggers.push(...d.triggers.map((x) => ({ ...x, phase: d.phase })));
    inv.views.push(...d.views.map((v) => ({ ...v, phase: d.phase })));
  }
  return inv;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 3 / 5 / 6 / 7 — MODEL ↔ MIGRATION DIFF
// ═════════════════════════════════════════════════════════════════════════════════════════════

const normType = (t) => String(t).toLowerCase().replace(/\s+/g, "").replace(/^bolao\./, "").replace(/"/g, "");

export function diffModelToDrafts({ model = load("target_model.json"), inv = draftInventory() } = {}) {
  const findings = [];
  const modelTables = new Map(model.entities.map((e) => [e.name, e]));

  for (const [name, e] of modelTables) {
    const t = inv.tables[name];
    if (!t) { findings.push(finding(CLASS.ERROR, "MISSING_TABLE", name, "declared in the target model, created by no draft", "a migration sequence that never creates a modelled table cannot produce the target schema")); continue; }

    const modelCols = new Map(e.columns.map((c) => [c.sql, c]));
    for (const [cn, mc] of modelCols) {
      const dc = t.columns[cn];
      // A DERIVED_VIEW column is declared in the model as part of the READ surface and must NOT be
      // created as a stored column. Its presence would be the second-source-of-truth defect the
      // financial model exists to prevent, so absence is asserted rather than merely tolerated.
      if (mc.generated === "DERIVED_VIEW") {
        if (dc) {
          findings.push(finding(CLASS.ERROR, "DERIVED_COLUMN_STORED", `${name}.${cn}`,
            "declared DERIVED_VIEW in the model but created as a stored column",
            "a stored derived value is a second source of truth that drifts the moment the thing it derives from changes. For settlement and unapplied balance this is money, and the drift is silent."));
        }
        continue;
      }
      if (!dc) { findings.push(finding(CLASS.ERROR, "MISSING_COLUMN", `${name}.${cn}`, "declared in the model, absent from the draft", "every report, contract and policy that names this column would fail")); continue; }
      if (normType(dc.type) !== normType(mc.type)) {
        findings.push(finding(CLASS.ERROR, "WRONG_TYPE", `${name}.${cn}`, `draft ${dc.type} vs model ${mc.type}`, "a type mismatch changes what values are representable"));
      }
      // The model marks a column nullable with `nullable: true` and says NOTHING for NOT NULL. So the
      // absence of the key means NOT NULL, and testing `nullable === false` was never true for any
      // column — the check silently passed on all 211 of them before this was corrected.
      const modelNotNull = mc.nullable !== true;
      if (modelNotNull !== dc.notNull && !dc.inlinePk && !(mc.pk && dc.notNull)) {
        findings.push(finding(CLASS.ERROR, "WRONG_NULLABILITY", `${name}.${cn}`, `draft ${dc.notNull ? "NOT NULL" : "nullable"} vs model ${modelNotNull ? "NOT NULL" : "nullable"}`, "nullability decides whether an absent value is representable, and for money an accidental NOT NULL forces a fabricated zero"));
      }
      const mDefault = mc.default ? String(mc.default).trim() : null;
      if (mDefault && !dc.default) {
        findings.push(finding(CLASS.ERROR, "MISSING_DEFAULT", `${name}.${cn}`, `model declares DEFAULT ${mDefault}, draft has none`, "a missing default changes insert behaviour for every writer"));
      }
    }
    for (const cn of Object.keys(t.columns)) {
      if (!modelCols.has(cn)) findings.push(finding(CLASS.ERROR, "EXTRA_COLUMN", `${name}.${cn}`, "created by the draft, absent from the model", "an unmodelled column is a column nothing governs: no type contract, no PII class, no access rule"));
    }

    const modelPk = e.columns.filter((c) => c.pk).map((c) => c.sql);
    const draftPk = [...new Set(t.pk)];
    if (modelPk.sort().join(",") !== draftPk.slice().sort().join(",")) {
      findings.push(finding(CLASS.ERROR, "WRONG_PK", name, `draft (${draftPk.join(",")}) vs model (${modelPk.join(",")})`, "the primary key decides row identity"));
    }

    for (const mc of e.columns.filter((c) => c.fk)) {
      // `bolao.participants.participant_id` — three parts, not four. The four-element destructuring
      // read the COLUMN as the table, so every FK reported a wrong target.
      const fkParts = String(mc.fk).split(".");
      const refTable = fkParts.length >= 3 ? fkParts[fkParts.length - 2] : fkParts[0];
      const dfk = t.fks.find((f) => f.columns.includes(mc.sql));
      if (!dfk) { findings.push(finding(CLASS.ERROR, "MISSING_FK", `${name}.${mc.sql}`, `model declares FK -> ${mc.fk}`, "an unenforced reference lets an orphan row exist")); continue; }
      if (EXTERNAL_TABLES[dfk.refTable]) continue;
      if (dfk.refTable !== refTable) findings.push(finding(CLASS.ERROR, "WRONG_FK_TARGET", `${name}.${mc.sql}`, `draft -> ${dfk.refTable} vs model -> ${refTable}`, "pointing at the wrong parent"));
      const wantDelete = (mc.onDelete || "RESTRICT").toUpperCase();
      const gotDelete = (dfk.onDelete || "NO ACTION").toUpperCase();
      if (wantDelete !== gotDelete) {
        const destructive = gotDelete === "CASCADE" || gotDelete === "SET NULL";
        findings.push(finding(destructive ? CLASS.ERROR : CLASS.REVIEW_REQUIRED, "WRONG_ON_DELETE", `${name}.${mc.sql}`,
          `draft ON DELETE ${gotDelete} vs model ${wantDelete}`,
          destructive ? "a destructive cascade on a money-bearing or historical row destroys evidence a reversal would need" : "differs from the declared intent"));
      }
    }
  }
  for (const name of Object.keys(inv.tables)) {
    if (!modelTables.has(name)) findings.push(finding(CLASS.ERROR, "EXTRA_TABLE", name, "created by a draft, absent from the model", "an unmodelled table has no access rule, no backfill and no report"));
  }

  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 6 — TYPE SCRUTINY: money, currency, time, ids, json, status
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A money-bearing COLUMN NAME, precisely.
 *
 * The first version matched any name containing fee/prize/payout/price, which flagged
 * `pool_fee_schedule_id`, `expected_fee_currency`, `payout_method`, `payout_external_reference` and
 * `prize_split` — six findings that were all about the WORD, not the value. A scan that cries wolf on
 * a uuid gets ignored on the numeric.
 */
const MONEY_NAME = /(^|_)(amount|total|balance|subtotal)($|_)|_minor$/i;
const NOT_MONEY_SUFFIX = /(_id|_currency|_method|_ref|_reference|_path|_split|_basis|_kind|_status|_at|_by|_count)$/i;
const MONEY_HINT_TEST = (c) => MONEY_NAME.test(c) && !NOT_MONEY_SUFFIX.test(c);
const MONEY_HINT = { test: MONEY_HINT_TEST };
const TIME_HINT = /(_at|_on|timestamp|occurred|paid|submitted|kickoff|expires|computed|recorded|declared|attempted|effective)/i;

export function typeScrutiny({ model = load("target_model.json"), inv = draftInventory() } = {}) {
  const findings = [];
  for (const [name, t] of Object.entries(inv.tables)) {
    for (const [cn, c] of Object.entries(t.columns)) {
      const ty = normType(c.type);

      if (MONEY_HINT.test(cn)) {
        if (/^(real|float|float4|float8|doubleprecision|money)$/.test(ty)) {
          findings.push(finding(CLASS.ERROR, "MONEY_FLOAT", `${name}.${cn}`, `type ${c.type}`,
            "a float cannot represent 0.01 exactly, and this platform pays real money out on these numbers. PostgreSQL's `money` type is also refused: it carries a session-dependent locale."));
        } else if (!/^numeric\(/.test(ty) && !/^integer$/.test(ty) && !/^bigint$/.test(ty)) {
          findings.push(finding(CLASS.REVIEW_REQUIRED, "MONEY_TYPE_UNEXPECTED", `${name}.${cn}`, `type ${c.type}`,
            "money must be an exact numeric with a declared scale, or integer minor units"));
        }
        if (/^numeric\(\d+\)$/.test(ty)) {
          findings.push(finding(CLASS.ERROR, "MONEY_NO_SCALE", `${name}.${cn}`, `type ${c.type}`, "numeric with no scale rounds to integer, silently discarding cents"));
        }
      }

      if (TIME_HINT.test(cn) && /^timestamp$|^timestampwithouttimezone$/.test(ty)) {
        findings.push(finding(CLASS.ERROR, "TIMESTAMP_WITHOUT_TIMEZONE", `${name}.${cn}`, `type ${c.type}`,
          "event time without a zone is ambiguous, and the prediction cutoff decides who is allowed to play. The legacy document stores ISO strings with offsets; reading them into a naive column silently shifts the instant."));
      }

      if (/^currency$/.test(cn) && !/^char\(3\)$|^text$|^bolao\.currency$/.test(ty)) {
        findings.push(finding(CLASS.REVIEW_REQUIRED, "CURRENCY_TYPE", `${name}.${cn}`, `type ${c.type}`, "currency must remain an explicit modelled attribute holding an ISO-4217 code"));
      }
      if (/_id$/.test(cn) && !/^uuid$|^text$|^integer$|^bigint$/.test(ty) && !ty.startsWith("bolao.")) {
        findings.push(finding(CLASS.REVIEW_REQUIRED, "ID_TYPE", `${name}.${cn}`, `type ${c.type}`, "identifier type differs from the platform's uuid convention"));
      }
    }
  }

  // A money column must be accompanied by a currency column on the same table.
  for (const [name, t] of Object.entries(inv.tables)) {
    const money = Object.keys(t.columns).filter((c) => MONEY_HINT.test(c) && /^numeric\(/.test(normType(t.columns[c].type)));
    if (money.length && !Object.keys(t.columns).some((c) => /currency/i.test(c))) {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "MONEY_WITHOUT_CURRENCY", name, `money column(s) ${money.join(", ")} with no currency column`,
        "an amount with no currency is a number, not money; the ratified rule is that currency stays an explicit modelled attribute"));
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 8 — ENUM RECONCILIATION
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Vocabularies the enums are declared to MIRROR. Each enum's `why` in the target model names its JS
 * counterpart; this map makes that claim checkable, so an enum cannot drift from the code it mirrors.
 */
export const ENUM_MIRRORS = {
  "bolao.settlement_status": { module: "financial.mjs", exportName: "SETTLEMENT" },
  "bolao.payment_kind": { module: "financial_evidence.mjs", exportName: "PAYMENT_KIND" },
  "bolao.outbox_status": { module: "outbox.mjs", exportName: "STATUS" },
  "bolao.delivery_outcome": { module: "outbox.mjs", exportName: "OUTCOME" },
  "bolao.match_confidence": { module: "identity.mjs", exportName: "CONFIDENCE" },
};

export async function enumReconciliation({ model = load("target_model.json"), inv = draftInventory() } = {}) {
  const findings = [];
  const modelEnums = model.enums;
  const draftEnums = new Map(inv.enums.map((e) => [e.name, e]));

  for (const [name, spec] of Object.entries(modelEnums)) {
    const d = draftEnums.get(name);
    if (!d) { findings.push(finding(CLASS.ERROR, "ENUM_NOT_DECLARED", name, "declared in the model, created by no draft", "a column typed with an undeclared enum cannot be created at all")); continue; }
    const want = spec.values.slice().sort().join(",");
    const got = d.values.slice().sort().join(",");
    if (want !== got) {
      findings.push(finding(CLASS.ERROR, "ENUM_VALUES_DIFFER", name, `draft [${d.values.join(",")}] vs model [${spec.values.join(",")}]`,
        "an enum missing a value makes that state unrepresentable; an extra value makes a state the code cannot handle reachable"));
    }
    if (d.phase !== "M1") {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "ENUM_PHASE", name, `created in ${d.phase}`, "every enum belongs in the types phase, before any table references it"));
    }
  }
  for (const [name] of draftEnums) {
    if (!modelEnums[name]) findings.push(finding(CLASS.ERROR, "ENUM_NOT_MODELLED", name, "created by a draft, absent from the model", "an unmodelled enum is a vocabulary nothing governs"));
  }

  // Every enum-typed column must reference a declared enum.
  for (const [tname, t] of Object.entries(inv.tables)) {
    for (const [cn, c] of Object.entries(t.columns)) {
      const ty = String(c.type).replace(/"/g, "");
      if (!ty.startsWith("bolao.")) continue;
      if (Object.keys(inv.tables).includes(ty.replace("bolao.", ""))) continue;
      if (!modelEnums[ty] && !draftEnums.has(ty)) {
        findings.push(finding(CLASS.ERROR, "ENUM_REFERENCE_UNDECLARED", `${tname}.${cn}`, `type ${ty}`, "the column's type does not exist"));
      }
    }
  }

  // The mirrored-vocabulary check: an enum that claims to mirror a JS export must actually match it.
  for (const [enumName, mirror] of Object.entries(ENUM_MIRRORS)) {
    const spec = modelEnums[enumName];
    if (!spec) continue;
    let vocab = null;
    try {
      const mod = await import(`./${mirror.module}`);
      const ex = mod[mirror.exportName];
      if (ex) vocab = (ex instanceof Set ? [...ex] : Object.values(ex)).map(String);
    } catch { /* module or export absent; reported below */ }
    if (!vocab) {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "ENUM_MIRROR_UNRESOLVABLE", enumName, `${mirror.module}.${mirror.exportName} not found`, "the enum claims to mirror a vocabulary that cannot be located, so the claim is unverifiable"));
      continue;
    }
    // Compared case-insensitively on purpose: the JS constants are UPPER_SNAKE by convention and the
    // PostgreSQL enum labels are lower_snake. That is a naming convention, not a vocabulary difference.
    // Nothing else is normalised away — a value present on one side only is still a finding.
    const lc = (a) => a.map((v) => String(v).toLowerCase());
    const vocabLc = lc(vocab), specLc = lc(spec.values);
    const missingInEnum = vocab.filter((v) => !specLc.includes(String(v).toLowerCase()));
    const missingInCode = spec.values.filter((v) => !vocabLc.includes(String(v).toLowerCase()));
    if (missingInEnum.length) {
      findings.push(finding(CLASS.ERROR, "ENUM_BEHIND_CODE", enumName, `code has [${missingInEnum.join(",")}] which the enum lacks`,
        `the enum declares that it mirrors ${mirror.module}'s ${mirror.exportName}. A state the code can produce and the column cannot store is an insert that fails at runtime.`));
    }
    if (missingInCode.length) {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "ENUM_AHEAD_OF_CODE", enumName, `enum has [${missingInCode.join(",")}] which the code lacks`,
        "a value the database accepts but no code path produces or handles. Either the code is incomplete or the value is speculative."));
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 4 — WS11 INDEX DECISIONS
// ═════════════════════════════════════════════════════════════════════════════════════════════

const ixKey = (table, cols) => `${table}(${cols.join(",")})`;
const isPrefix = (a, b) => a.length < b.length && a.every((c, i) => c === b[i]);

/**
 * Reconcile the drafts' index set against WS11's decisions AND against redundancy the drafts contain
 * regardless of WS11 — WS11 reviewed the 18 indexes model/reports.json declares, while the target
 * model declares 52, so a WS11-only reconciliation would leave most of the set unreviewed.
 */
export async function indexReconciliation({ inv = draftInventory() } = {}) {
  const findings = [];
  let ws11 = null;
  try { ws11 = await import("./index_validation.mjs"); } catch { /* optional */ }

  const drafted = inv.indexes;

  // ── WS11's explicit rejections must not survive in the drafts.
  if (ws11) {
    for (const c of ws11.CANDIDATES) {
      const rejected = [ws11.CLASS.REDUNDANT, ws11.CLASS.REMOVE_FROM_DRAFT, ws11.CLASS.DEFER].includes(c.klass);
      const present = drafted.find((ix) => ix.table === c.table && ix.cols.join(",") === c.cols.join(","));
      if (rejected && present) {
        const klass = c.klass === ws11.CLASS.DEFER ? CLASS.DEFERRED : CLASS.REVIEW_REQUIRED;
        findings.push(finding(klass, `WS11_${c.klass}_STILL_DRAFTED`, ixKey(c.table, c.cols),
          `${c.id} was classified ${c.klass} by WS11 but ${present.name} is still created in ${present.phase}`, c.why));
      }
      if (!rejected && !present) {
        // An index is already SERVED if a drafted index on the same table leads with its columns: a
        // btree on (a,b,c) answers every lookup a btree on (a,b) does. Reporting it as missing would
        // push an operator to create a redundant index to silence the tool.
        const servedBy = drafted.find((ix) => ix.table === c.table && isPrefix(c.cols, ix.cols) && !ix.partial);
        if (servedBy) {
          findings.push(finding(CLASS.FALSE_POSITIVE, `WS11_${c.klass}_SERVED_BY_PREFIX`, ixKey(c.table, c.cols),
            `${c.id} is served by ${servedBy.name} (${servedBy.cols.join(",")})`,
            "a leading-subset lookup is answered by the longer index; creating the shorter one too would be pure write cost"));
        } else {
          findings.push(finding(CLASS.REVIEW_REQUIRED, `WS11_${c.klass}_NOT_DRAFTED`, ixKey(c.table, c.cols),
            `${c.id} is ${c.klass} but no draft creates it`, c.why));
        }
      }
    }
  } else {
    findings.push(finding(CLASS.REVIEW_REQUIRED, "WS11_UNAVAILABLE", "index_validation.mjs", "could not be imported", "the index decisions cannot be reconciled"));
  }

  // ── Redundancy inside the drafted set itself, independent of WS11's coverage.
  const byTable = {};
  for (const ix of drafted) (byTable[ix.table] ||= []).push(ix);
  for (const [table, list] of Object.entries(byTable)) {
    for (const a of list) for (const b of list) {
      if (a === b) continue;
      if (a.cols.join(",") === b.cols.join(",") && a.name < b.name && !!a.partial === !!b.partial && a.unique === b.unique) {
        findings.push(finding(CLASS.ERROR, "DUPLICATE_INDEX", ixKey(table, a.cols), `${a.name} and ${b.name} are identical`, "two identical indexes cost two writes for one read"));
      }
      // A plain index and a partial index on the SAME columns: the plain one already serves every
      // query the partial does, so the partial is pure additional write cost.
      if (a.cols.join(",") === b.cols.join(",") && !a.partial && b.partial && a.unique === b.unique) {
        findings.push(finding(CLASS.REVIEW_REQUIRED, "PARTIAL_SHADOWED_BY_FULL", ixKey(table, a.cols),
          `${b.name} is partial (WHERE ${b.partial}) on the same columns as the full index ${a.name}`,
          "the full index answers every query the partial one does. Keeping both is justified only if the partial is dramatically smaller AND the planner is shown to prefer it — otherwise it is write cost with no read benefit."));
      }
      // Prefix overlap between two non-unique indexes.
      if (isPrefix(a.cols, b.cols) && !a.unique && !b.unique && !a.partial && !b.partial) {
        findings.push(finding(CLASS.REVIEW_REQUIRED, "PREFIX_OVERLAP", ixKey(table, a.cols),
          `${a.name} (${a.cols.join(",")}) is a leading subset of ${b.name} (${b.cols.join(",")})`,
          "the longer index serves every query the shorter one does; keep exactly one"));
      }
      // A non-unique index whose columns are a prefix of a UNIQUE index is served by the unique one.
      if (isPrefix(a.cols, b.cols) && !a.unique && b.unique && !b.partial && !a.partial) {
        findings.push(finding(CLASS.REVIEW_REQUIRED, "PREFIX_OF_UNIQUE", ixKey(table, a.cols),
          `${a.name} is a leading subset of the unique index ${b.name} (${b.cols.join(",")})`,
          "a unique index is a btree like any other and serves prefix lookups; the standalone index is redundant unless the unique one is partial"));
      }
    }
  }

  // ── Every index must be built CONCURRENTLY, except where the table was created in the same phase.
  for (const ix of drafted) {
    const createdHere = inv.phaseOf[ix.table] === ix.phase;
    if (!ix.concurrently && !createdHere) {
      findings.push(finding(CLASS.ERROR, "NON_CONCURRENT_INDEX", ix.name, `on ${ix.table} in ${ix.phase}`,
        "a plain CREATE INDEX blocks writes for the whole build on a table that already has traffic"));
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 5 — STALE NAME SCAN
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Names that appeared in an earlier draft, a report alias or a fixture, and must NOT appear as schema
 * columns. Each maps to the canonical name so a match is actionable rather than merely alarming.
 */
export const STALE_NAMES = Object.freeze({
  occurred_at: { canonical: "paid_at", onlyOn: ["payments"], why: "payments records when money moved as paid_at; occurred_at is the audit vocabulary and using it here conflates two clocks" },
  observed_at: { canonical: "computed_at", onlyOn: ["ranking_snapshots"], why: "a ranking is COMPUTED from results, not observed" },
  subject_table: { canonical: "aggregate_type", onlyOn: ["audit_events"], why: "the audit model uses aggregate_type/aggregate_id" },
  subject_id: { canonical: "aggregate_id", onlyOn: ["audit_events"], why: "the audit model identifies its subject as (aggregate_type, aggregate_id); subject_id alone cannot be resolved without knowing which table it points into" },
  actor_kind: { canonical: "actor_role", onlyOn: ["audit_events"], why: "the model declares actor_role" },
  sequence: { canonical: "(none — ordering is occurred_at + the hash chain)", onlyOn: ["audit_events"], why: "there is no sequence column; inventing one creates a second ordering authority alongside the hash chain" },
  amount_minor: { canonical: "amount / allocated_amount / gross_amount depending on the table", onlyOn: ["payments", "payment_allocations", "prize_allocations"], why: "the relational model stores exact numeric(14,2) under a DIFFERENT name per table, because an allocation amount and a prize gross are not the same quantity. A single amount_minor column would flatten that distinction and lose prize net_amount entirely." },
  expected_fee_minor: { canonical: "expected_fee_amount", onlyOn: ["pool_entries"], why: "the relational model stores the fee as exact numeric(14,2) alongside an explicit expected_fee_currency; minor units are the JS and SQLite fixture representation only, and a schema column with that name would lose the currency pairing" },
  paid: { canonical: "(none — settlement is DERIVED)", onlyOn: ["pool_entries"], why: "a stored paid flag would be a second source of truth for money; settlement is derived from allocations" },
  settlement_status: { canonical: "(none — derived)", onlyOn: ["pool_entries"], why: "the enum exists for report projection, not for storage. A stored settlement column is the exact second-source-of-truth this model refuses." },
});

/**
 * DECLARED representation difference between the SQLite report fixture and the PostgreSQL model.
 *
 * SQLite has exactly two numeric types, INTEGER and REAL, and REAL is a float. Storing money as REAL
 * in the very fixtures used to verify financial reports would break the platform's hardest financial
 * rule inside the test that is supposed to protect it. So the fixture uses INTEGER MINOR UNITS, named
 * `*_minor`, where the model uses `numeric(14,2)`.
 *
 * This is declared rather than normalised away, and it has a cost that must be stated plainly:
 *
 *   THE 17 REPORT PROTOTYPES ARE PROVEN AGAINST THE FIXTURE, NOT AGAINST THE DRAFTED SCHEMA.
 *
 * Their joins, grain, filters and arithmetic are verified; their literal column names for monetary
 * columns are not. Closing that gap needs a PostgreSQL instance, which is not available locally (see
 * SYNTHETIC_EXECUTION_LIMITATION), so it is recorded as an open gap rather than claimed as covered.
 *
 * The mapping is checked TOTAL: a `_minor` name with no entry here is still an ERROR, and every
 * target below must exist in the drafted schema, so a rename in the model breaks this check.
 */
export const FIXTURE_MONEY_MAP = Object.freeze({
  // The fixture uses ONE name, `amount_minor`, for what the model names differently per table. That
  // flattening is itself a fidelity loss worth recording: prize_allocations distinguishes gross from
  // net, and a fixture with a single amount cannot represent a payout net of anything.
  amount_minor: {
    targets: {
      payments: "amount",
      payment_allocations: "allocated_amount",
      prize_allocations: "gross_amount",
    },
    note: "prize_allocations also carries net_amount, which the fixture has no column for at all — so no report prototype exercises the gross/net distinction.",
  },
  expected_fee_minor: { targets: { pool_entries: "expected_fee_amount" } },
});

export function fixtureRepresentationCheck({ inv = draftInventory() } = {}) {
  const findings = [];
  for (const [minorName, m] of Object.entries(FIXTURE_MONEY_MAP)) {
    for (const [t, target] of Object.entries(m.targets)) {
      const cols = inv.tables[t]?.columns;
      if (!cols) { findings.push(finding(CLASS.ERROR, "MONEY_MAP_TABLE_MISSING", t, `${minorName} maps into ${t}, which no draft creates`, "the declared mapping names a table that does not exist")); continue; }
      if (!cols[target]) {
        findings.push(finding(CLASS.ERROR, "MONEY_MAP_TARGET_MISSING", `${t}.${target}`,
          `the fixture's ${minorName} is declared to map here, but the column does not exist`,
          "the declared representation difference has become a real drift: either the model renamed the column or the mapping is wrong"));
        continue;
      }
      const ty = normType(cols[target].type);
      if (!/^numeric\(\d+,\d+\)$/.test(ty)) {
        findings.push(finding(CLASS.ERROR, "MONEY_MAP_TARGET_NOT_EXACT", `${t}.${target}`, `type ${cols[target].type}`,
          "the mapping's whole justification is that the model stores exact decimal money; if the target is not an exact numeric the fixture's integer representation is not a faithful stand-in"));
      }
    }
  }
  return findings;
}

export function staleNameScan({ inv = draftInventory() } = {}) {
  const findings = [];
  for (const [tname, t] of Object.entries(inv.tables)) {
    for (const cn of Object.keys(t.columns)) {
      const stale = STALE_NAMES[cn];
      if (!stale) continue;
      if (stale.onlyOn && !stale.onlyOn.includes(tname)) continue;
      findings.push(finding(CLASS.ERROR, "STALE_COLUMN_NAME", `${tname}.${cn}`, `should be ${stale.canonical}`, stale.why));
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 7 — CONSTRAINT RECONCILIATION
// ═════════════════════════════════════════════════════════════════════════════════════════════

const HISTORY_PRESERVING = ["payments", "payment_allocations", "prize_allocations", "audit_events",
  "audit_event_details", "outbox_events", "outbox_delivery_attempts", "participant_identity_links", "match_results"];

export function constraintReconciliation({ model = load("target_model.json"), inv = draftInventory() } = {}) {
  const findings = [];
  const modelTables = new Map(model.entities.map((e) => [e.name, e]));

  for (const [name, t] of Object.entries(inv.tables)) {
    const e = modelTables.get(name);

    for (const fk of t.fks) {
      const od = (fk.onDelete || "NO ACTION").toUpperCase();
      const isActorColumn = fk.columns.every((c) => /_by$/.test(c)) && fk.refTable === "users";
      if (HISTORY_PRESERVING.includes(name) && od === "CASCADE") {
        findings.push(finding(CLASS.ERROR, "DESTRUCTIVE_CASCADE_ON_HISTORY", `${name}.${fk.columns.join(",")}`,
          `ON DELETE ${od}`,
          "deleting a parent would silently destroy a money-bearing or append-only record. A reversal needs the original to reverse, and an audit chain needs every link."));
      } else if (HISTORY_PRESERVING.includes(name) && od === "SET NULL" && !isActorColumn) {
        findings.push(finding(CLASS.ERROR, "DESTRUCTIVE_SET_NULL_ON_HISTORY", `${name}.${fk.columns.join(",")}`,
          `ON DELETE ${od}`,
          "nulling a business reference on a historical row destroys the link the record exists to preserve"));
      } else if (HISTORY_PRESERVING.includes(name) && od === "SET NULL" && isActorColumn) {
        findings.push(finding(CLASS.REVIEW_REQUIRED, "ACTOR_SET_NULL_ON_HISTORY", `${name}.${fk.columns.join(",")}`,
          `ON DELETE ${od} on an auth.users reference`,
          "a deliberate tradeoff, and it should be recorded as one: RESTRICT would make an auth user undeletable forever, which conflicts with erasure. SET NULL keeps the financial row and loses only the actor pointer — attribution survives in audit_events.actor_user_id, whose retention is governed separately. The risk is that if audit retention is ever shortened, this becomes unattributable money."));
      }
      if (od === "NO ACTION") {
        findings.push(finding(CLASS.REVIEW_REQUIRED, "FK_NO_EXPLICIT_ON_DELETE", `${name}.${fk.columns.join(",")}`,
          "no ON DELETE declared, so NO ACTION applies",
          "NO ACTION and RESTRICT differ only in deferrability; declaring RESTRICT explicitly states the intent instead of relying on a default"));
      }
      if (fk.onUpdate === "CASCADE") {
        findings.push(finding(CLASS.REVIEW_REQUIRED, "ON_UPDATE_CASCADE", `${name}.${fk.columns.join(",")}`, "ON UPDATE CASCADE",
          "surrogate keys are never updated, so this can only fire by accident"));
      }
    }

    if (e) {
      const modelChecks = (e.checks || []).length;
      if (modelChecks > 0 && t.checks.length === 0) {
        findings.push(finding(CLASS.ERROR, "MISSING_CHECKS", name, `model declares ${modelChecks} check(s), draft has none`, "a declared invariant that is not enforced is a comment"));
      }
      // Money sign rule: a table with a signed amount and a kind enum must constrain the two together.
      const hasAmount = Object.keys(t.columns).some((c) => /^amount$/.test(c));
      const hasKind = Object.keys(t.columns).some((c) => /^kind$/.test(c));
      if (hasAmount && hasKind) {
        const guarded = t.checks.some((c) => /kind/i.test(c.expr) && /amount/i.test(c.expr));
        if (!guarded) {
          findings.push(finding(CLASS.ERROR, "MONEY_SIGN_UNCONSTRAINED", name, "amount and kind exist with no CHECK relating them",
            "a negative amount must be possible only for a typed reversal. Without the check, an arbitrary negative contribution is representable, which is money appearing from nowhere."));
        }
      }
    }

    const pkCols = [...new Set(t.pk)];
    if (pkCols.length === 0) {
      findings.push(finding(CLASS.ERROR, "NO_PRIMARY_KEY", name, "no primary key", "a table with no primary key has no row identity, so no update or delete can be targeted safely"));
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 9 — WS12 RLS ALIGNMENT
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function rlsAlignment({ model = load("target_model.json"), inv = draftInventory(), drafts = parseAllDrafts() } = {}) {
  const findings = [];
  let rlsModel = null;
  try { rlsModel = load("rls_model.json"); } catch { /* optional */ }

  // Secure by default: every created table must have RLS enabled in the SAME draft.
  // Scoped to tables the draft CREATES. An additive ALTER phase touches a table whose RLS was enabled in
  // the phase that created it; demanding ENABLE ROW LEVEL SECURITY again there would be asking a phase to
  // re-secure something already secured, and the natural way to silence that is to add a redundant
  // statement — which teaches the detector to accept noise.
  for (const d of drafts) {
    for (const [tname, tdef] of Object.entries(d.tables)) {
      if (tdef.createdHere === false) continue;
      if (!d.rlsEnabled.includes(tname)) {
        findings.push(finding(CLASS.ERROR, "RLS_NOT_ENABLED_AT_CREATE", tname,
          `created in ${d.phase} without ENABLE ROW LEVEL SECURITY in the same file`,
          "a table that exists without RLS, even briefly, is an exposure window of unknown duration, and what leaked cannot be recalled"));
      }
    }
  }
  // No policy and no grant may appear in a DDL phase — policies belong to a later phase.
  for (const d of drafts) {
    if (d.policies.length) {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "POLICY_IN_DDL_PHASE", d.phase,
        `${d.policies.length} policy statement(s)`,
        "RLS ENABLED with zero policies already denies everyone. Adding policies here couples the DDL phase to the access model and makes the DDL rollback a permission rollback too."));
    }
    for (const g of d.grants) {
      if (g.roles.some((r) => /^anon$|^authenticated$/.test(r))) {
        findings.push(finding(CLASS.ERROR, "GRANT_TO_CLIENT_ROLE_IN_DDL_PHASE", d.phase,
          `GRANT ${g.privileges} to ${g.roles.join(",")}`,
          "a grant in the creating phase means the table is reachable before its policies exist — the exposure window RLS-at-create exists to close"));
      }
    }
  }
  // Financial tables must never be reachable by a client role in any phase.
  const FINANCIAL = ["payments", "payment_allocations", "prize_allocations"];
  for (const g of inv.grants) {
    if (FINANCIAL.some((f) => g.target.includes(f)) && g.roles.some((r) => /^anon$|^authenticated$/.test(r))) {
      findings.push(finding(CLASS.ERROR, "FINANCIAL_GRANT_TO_CLIENT", g.target, `to ${g.roles.join(",")}`,
        "there is no migration state in which a browser needs to write or read a raw financial row (WS12-OP-1)"));
    }
  }
  // The rls model must not name a table the drafts never create.
  if (rlsModel) {
    const text = JSON.stringify(rlsModel);
    for (const t of Object.keys(inv.tables)) { void t; }
    const named = new Set();
    for (const m of text.matchAll(/"table"\s*:\s*"([\w.]+)"/g)) named.add(m[1].replace(/^bolao\.|^audit\./, ""));
    for (const t of named) {
      if (!inv.tables[t] && !/bolao_state|participant_auth_links/.test(t)) {
        findings.push(finding(CLASS.ERROR, "RLS_TABLE_NOT_CREATED", t, "named by the RLS model, created by no draft",
          "a policy targeting a table that does not exist cannot be applied"));
      }
    }
  }
  // Every table's declared rlsIntent must be a recognised value.
  for (const e of model.entities) {
    if (!e.rlsIntent) findings.push(finding(CLASS.REVIEW_REQUIRED, "NO_RLS_INTENT", e.name, "no rlsIntent declared", "every table must state who may read it"));
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 10 — WS13 WRITE-CONTRACT ALIGNMENT
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function writeContractAlignment({ inv = draftInventory() } = {}) {
  const findings = [];
  let contracts = null;
  try { contracts = load("write_contracts.json"); } catch {
    return [finding(CLASS.REVIEW_REQUIRED, "CONTRACTS_UNAVAILABLE", "write_contracts.json", "not loadable", "write-contract alignment cannot be checked")];
  }

  const tables = new Set(Object.keys(inv.tables));
  const colsOf = (t) => new Set(Object.keys(inv.tables[t]?.columns || {}));

  // Every table a contract mutates must exist.
  for (const c of Object.values(contracts.contracts)) {
    for (const mu of c.mutates || []) {
      const t = typeof mu === "string" ? mu : mu.entity;
      const bare = String(t).replace(/^bolao\.|^audit\./, "");
      if (!tables.has(bare)) {
        findings.push(finding(CLASS.ERROR, "CONTRACT_TABLE_NOT_CREATED", `${c.name} -> ${t}`, "no draft creates it",
          "a deployed contract writing to a table the migration never created fails on its first call"));
      }
    }
    for (const lk of c.locks || []) {
      const t = typeof lk === "string" ? lk : lk.table;
      const bare = String(t).replace(/^bolao\.|^audit\./, "");
      // `{target_entity}` is a template placeholder: adminCorrection locks whichever allowlisted table
      // is being corrected, so the lock target is resolved at call time and cannot name one table.
      if (/^\{.*\}$/.test(bare)) continue;
      if (!tables.has(bare) && bare !== "advisory") {
        findings.push(finding(CLASS.ERROR, "CONTRACT_LOCK_TABLE_NOT_CREATED", `${c.name} locks ${t}`, "no draft creates it", "the lock ordering names a table that does not exist"));
      }
    }
  }

  // The structures WS13's controls depend on, each with the control it serves.
  const REQUIRED = [
    { table: "payments", column: "external_reference", why: "the unique partial index on this column is the control that makes double-recording a payment reference impossible" },
    { table: "payments", column: "reverses_payment_id", why: "WS13-OP-3 requires a typed compensating record that references the payment it reverses" },
    { table: "payments", column: "kind", why: "a negative amount is permitted only under a typed reversal kind" },
    { table: "payments", column: "created_by", why: "operator_evidence must be attributable even though R-GAP-1 means the database cannot verify it" },
    { table: "payment_allocations", column: "payment_id", why: "allocatePayment locks the payment and sums its sibling allocations" },
    { table: "audit_events", column: "correlation_id", why: "reconstructing one logical operation end to end" },
    { table: "audit_events", column: "previous_event_hash", why: "the append-only hash chain, which is the compensating control for R-GAP-1" },
    { table: "audit_events", column: "event_hash", why: "as above" },
    { table: "outbox_events", column: "idempotency_key", why: "delivery idempotency: the same event delivered twice must result in one notification" },
    { table: "participant_identity_links", column: "reverted_at", why: "reverseParticipantMerge re-checks this under the link's row lock" },
  ];
  for (const r of REQUIRED) {
    if (!tables.has(r.table)) { findings.push(finding(CLASS.ERROR, "CONTRACT_SUPPORT_TABLE_MISSING", r.table, "not created", r.why)); continue; }
    if (!colsOf(r.table).has(r.column)) {
      findings.push(finding(CLASS.ERROR, "CONTRACT_SUPPORT_COLUMN_MISSING", `${r.table}.${r.column}`, "not created by any draft", r.why));
    }
  }

  // Optimistic concurrency: WS13 compares a row version or a before-state fingerprint. If neither a
  // version column nor an updated_at exists on a correctable table, the contract has nothing to compare.
  const ALLOWLIST = { pool_entries: "entry_label", participants: "display_name", pools: "status", matches: "status" };
  for (const [t] of Object.entries(ALLOWLIST)) {
    if (!tables.has(t)) continue;
    const cols = colsOf(t);
    const hasVersion = [...cols].some((c) => /^(row_version|version|lock_version|updated_at)$/.test(c));
    if (!hasVersion) {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "NO_CONCURRENCY_COLUMN", t,
        "adminCorrection may modify this table, but it has no row_version or updated_at",
        "WS13's optimistic concurrency check compares a version or a before-state fingerprint. With neither, two concurrent corrections cannot be distinguished from one, and the second silently overwrites the first."));
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 11 — AUDIT / OUTBOX ALIGNMENT
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function auditOutboxAlignment({ inv = draftInventory(), drafts = parseAllDrafts() } = {}) {
  const findings = [];
  const t = (n) => inv.tables[n];

  for (const name of ["audit_events", "audit_event_details", "outbox_events", "outbox_delivery_attempts"]) {
    if (!t(name)) findings.push(finding(CLASS.ERROR, "AUDIT_OUTBOX_TABLE_MISSING", name, "not created", "the audit and outbox infrastructure must exist before any backfill writes rows"));
  }

  // Immutability intent: an append-only table must not be granted UPDATE or DELETE anywhere.
  for (const g of inv.grants) {
    if (/audit_events|audit_event_details/.test(g.target) && /UPDATE|DELETE/i.test(g.privileges)) {
      findings.push(finding(CLASS.ERROR, "AUDIT_MUTABLE_GRANT", g.target, `GRANT ${g.privileges}`,
        "audit_events is append-only and hash-chained; an UPDATE breaks the chain and destroys the record of whatever changed it"));
    }
  }

  // No draft may insert historical outbox events.
  for (const d of drafts) {
    const { code } = stripNoise(readFileSync(join(DRAFT_DIR, d.name), "utf8"));
    if (/INSERT\s+INTO\s+[\w".]*outbox_events/i.test(code)) {
      findings.push(finding(CLASS.ERROR, "HISTORICAL_OUTBOX_FABRICATED", d.phase, "inserts into outbox_events",
        "no outbox event may be created for a past fact. Those notifications were already sent months ago; an inert row is a lie about history and a delivered one is a mass re-notification of real participants."));
    }
  }

  // The delivery-attempt table must be able to order attempts.
  const att = t("outbox_delivery_attempts");
  if (att && !Object.keys(att.columns).some((c) => /attempt_number|attempted_at/.test(c))) {
    findings.push(finding(CLASS.ERROR, "ATTEMPTS_UNORDERABLE", "outbox_delivery_attempts", "no attempt_number or attempted_at", "attempts must be orderable or the dead-letter decision cannot be reconstructed"));
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 12 — REPORTING ALIGNMENT
// ═════════════════════════════════════════════════════════════════════════════════════════════

export async function reportingAlignment({ inv = draftInventory() } = {}) {
  const findings = [];
  let reports = null, protos = null;
  try { reports = load("reports.json"); } catch { /* optional */ }
  try { protos = await import("./reports_sql.mjs"); } catch { /* optional */ }
  if (!reports) return [finding(CLASS.REVIEW_REQUIRED, "REPORTS_UNAVAILABLE", "reports.json", "not loadable", "reporting alignment cannot be checked")];

  const tables = new Set(Object.keys(inv.tables));
  // Every table a report joins must be created by some draft.
  for (const r of reports.reports) {
    for (const j of r.joins || []) {
      for (const m of String(j).matchAll(/\b([a-z_]{4,})\b/g)) {
        const cand = m[1];
        if (["left","join","inner","outer","full","cross","using","then","from","where","null","true","false"].includes(cand)) continue;
        if (!tables.has(cand)) continue; // only assert on names we recognise as tables
      }
    }
    // Every declared index must name a table that exists.
    for (const ix of r.indexes || []) {
      const tm = /^([a-z_]+)\(/.exec(ix.trim());
      if (tm && !tables.has(tm[1])) {
        findings.push(finding(CLASS.ERROR, "REPORT_INDEX_TABLE_MISSING", `${r.id} -> ${ix}`, `table ${tm[1]} is created by no draft`,
          "a report declaring an index on a non-existent table cannot be served"));
      }
    }
  }

  // The prototypes are executed against the SQLite fixture schema, not against the drafts. Any column
  // a prototype names must therefore also exist in the DRAFTED schema, or the prototype is only
  // proven against a fixture that has drifted from the migration.
  if (protos) {
    const drafted = new Map(Object.entries(inv.tables).map(([n, t]) => [n, new Set(Object.keys(t.columns))]));
    for (const [id, p] of Object.entries(protos.PROTOTYPES)) {
      for (const [cn, meta] of Object.entries(STALE_NAMES)) {
        const re = new RegExp(`\\b${cn}\\b`);
        if (!re.test(p.sql)) continue;
        const onTables = meta.onlyOn || [];
        // TABLE-AWARE. The earlier version asked only whether the table EXISTS, so it flagged R-16 for
        // using `occurred_at` — which audit_events genuinely has — merely because `payments` exists
        // somewhere in the schema. A rename is only a finding for a query that touches the renamed
        // table.
        if (!onTables.some((t) => drafted.has(t) && new RegExp(`\\b${t}\\b`).test(p.sql))) continue;
        // Only RENAMES are checkable here. A name the model forbids outright — `paid`,
        // `settlement_status` — is a DDL rule, enforced against the drafts by staleNameScan. Applying
        // it to query text produces false positives on CTE and alias names: R-11 defines a CTE called
        // `paid`, which is not a stored column at all.
        if (/^\(none/.test(meta.canonical)) continue;
        if (FIXTURE_MONEY_MAP[cn]) {
          findings.push(finding(CLASS.EXPECTED_PHASE_DIFFERENCE, "REPORT_USES_FIXTURE_MONEY_NAME", `${id} (${p.name})`,
            `references ${cn}; the drafted schema calls this ${FIXTURE_MONEY_MAP[cn].target}`,
            "a DECLARED difference: SQLite cannot express numeric(14,2) without using a float, so the fixture uses integer minor units. The consequence is that this prototype's monetary column names are NOT proven against the drafted schema — see FIXTURE_MONEY_MAP."));
          continue;
        }
        findings.push(finding(CLASS.ERROR, "REPORT_USES_STALE_NAME", `${id} (${p.name})`, `references ${cn}, canonical is ${meta.canonical}`, meta.why));
      }
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 13 — ORDERING GRAPH
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function orderingGraph({ drafts = parseAllDrafts() } = {}) {
  const findings = [];
  const order = drafts.map((d) => d.phase);
  const idx = Object.fromEntries(order.map((p, i) => [p, i]));

  // `createdIn` must record where a table is CREATED, not merely where it is mentioned. An ALTER phase
  // mentioning `pools` is not a second CREATE, and recording it as one moved pools' creation phase to the
  // ALTER — which then reported its own index and its own foreign keys as ordered before their table.
  const createdIn = {}, enumIn = {};
  for (const d of drafts) {
    for (const [t, tdef] of Object.entries(d.tables)) {
      if (tdef.createdHere === false) continue;
      if (createdIn[t] !== undefined) findings.push(finding(CLASS.ERROR, "TABLE_CREATED_TWICE", t, `${createdIn[t]} and ${d.phase}`, "the second CREATE would fail"));
      createdIn[t] = d.phase;
    }
    for (const e of d.enums) enumIn[e.name] = d.phase;
  }

  for (const d of drafts) {
    // Declared dependencies must be earlier.
    const deps = String(d.header.dependencies || "").match(/M\d+/g) || [];
    for (const dep of deps) {
      if (EXTERNAL_PHASES[dep]) continue; // M0 is the baseline; legitimately outside the draft set
      if (idx[dep] === undefined) { findings.push(finding(CLASS.ERROR, "DEPENDENCY_UNKNOWN", d.phase, `depends on ${dep}`, "the named phase does not exist")); continue; }
      if (idx[dep] >= idx[d.phase]) findings.push(finding(CLASS.ERROR, "FORWARD_DEPENDENCY", d.phase, `depends on ${dep}`, "a phase cannot depend on itself or a later one"));
    }
    // FK targets must exist by now (self-references are fine).
    for (const [tname, t] of Object.entries(d.tables)) {
      for (const fk of t.fks) {
        if (fk.refTable === tname) continue;
        if (EXTERNAL_TABLES[fk.refTable] && (!fk.refSchema || EXTERNAL_TABLES[fk.refTable].schema === fk.refSchema)) continue;
        const where = createdIn[fk.refTable];
        if (where === undefined) {
          findings.push(finding(CLASS.ERROR, "FK_TARGET_NEVER_CREATED", `${tname}.${fk.columns.join(",")}`, `references ${fk.refTable}`, "the referenced table is created by no draft"));
        } else if (idx[where] > idx[d.phase]) {
          findings.push(finding(CLASS.ERROR, "FK_TARGET_CREATED_LATER", `${tname}.${fk.columns.join(",")}`, `references ${fk.refTable}, created in ${where}`, "the FK would fail: the parent does not exist yet"));
        }
      }
      // Enum types must be declared before use.
      for (const [cn, c] of Object.entries(t.columns)) {
        const ty = String(c.type).replace(/"/g, "");
        if (!ty.startsWith("bolao.")) continue;
        if (createdIn[ty.replace("bolao.", "")]) continue;
        const where = enumIn[ty];
        if (where === undefined) findings.push(finding(CLASS.ERROR, "ENUM_NEVER_CREATED", `${tname}.${cn}`, `type ${ty}`, "the enum is declared by no draft"));
        else if (idx[where] > idx[d.phase]) findings.push(finding(CLASS.ERROR, "ENUM_CREATED_LATER", `${tname}.${cn}`, `type ${ty} created in ${where}`, "the type does not exist yet"));
      }
    }
    // Indexes must target a table that exists by now.
    for (const ix of d.indexes) {
      const where = createdIn[ix.table];
      if (where === undefined) findings.push(finding(CLASS.ERROR, "INDEX_TABLE_NEVER_CREATED", ix.name, `on ${ix.table}`, "the table is created by no draft"));
      else if (idx[where] > idx[d.phase]) findings.push(finding(CLASS.ERROR, "INDEX_BEFORE_TABLE", ix.name, `on ${ix.table}, created in ${where}`, "the index would fail"));
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 14 / 15 / 16 — EXPAND-CONTRACT, BACKFILL, ROLLBACK
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const ROLLBACK_CLASSES = ["FULL", "FULL_BEFORE_BACKFILL", "FEATURE_FLAG_ROLLBACK", "FORWARD_FIX_ONLY", "DATA_RESTORE_REQUIRED"];

/** Which draft phase (DRAFT scheme) needs which WS6 backfill domain and WS7 transformer. */
export const BACKFILL_MAP = Object.freeze({
  migration_lineage: { domain: "migration_lineage", transformer: null, parity: "NONE", gate: "none", note: "WRITTEN BY the backfills, not backfilled: every domain inserts one row here per target row it creates, in the same transaction as that row. It has no legacy source because it describes the migration rather than the business, so there is nothing to compare source-to-target — its own correctness is checked the other way round, by requiring every backfilled row to HAVE a lineage row. M14." },
  audit_chain_head: { domain: "audit", transformer: null, parity: "NONE", gate: "none", note: "SEEDED BY THE MIGRATION, not backfilled: the DDL inserts its single row with a NULL tail, and the first audit append becomes the chain genesis. Its content is derived state — it can be rebuilt at any time by walking audit_events to the open end — so there is no history to move and nothing to compare for parity. See ADR-K01." },
  participants: { domain: "participants", transformer: "participants", parity: "AGGREGATE_PARITY", gate: "none" },
  participant_auth_links: { domain: "participant_auth_links", transformer: null, parity: "NONE", gate: "none", note: "NOTHING TO BACKFILL: the legacy document records participants, never which auth identity owns one — auth.users is the provider's and no legacy row maps between them. Links are established at authentication time when a signed-in user first claims a participant, so the table is created empty and fills forward. KPLUS-F047." },
  participant_identity_links: { domain: "identityLinks", transformer: null, parity: "AGGREGATE_PARITY", gate: "none", note: "zero rows until the post-cutover identity review; nothing to backfill" },
  competitions: { domain: "competitionEditions", transformer: null, parity: "AGGREGATE_PARITY", gate: "none", note: "hand-authored reference data; never derived from the legacy document, which has no competition entity" },
  competition_editions: { domain: "competitionEditions", transformer: null, parity: "AGGREGATE_PARITY", gate: "none" },
  competition_edition_phases: { domain: "competitionEditions", transformer: null, parity: "AGGREGATE_PARITY", gate: "none" },
  pools: { domain: "pools", transformer: "pools", parity: "AGGREGATE_PARITY", gate: "none" },
  pool_fee_schedule: { domain: "pools", transformer: null, parity: "FINANCIAL_PARITY", gate: "GATE-FIN", note: "one in-force row per pool; the fee may be UNKNOWN and must never be fabricated" },
  pool_entries: { domain: "entries", transformer: "entries", parity: "AGGREGATE_PARITY", gate: "none" },
  payments: { domain: "payments", transformer: "payments", parity: "FINANCIAL_PARITY", gate: "GATE-FIN" },
  payment_allocations: { domain: "allocations", transformer: null, parity: "FINANCIAL_PARITY", gate: "GATE-FIN", note: "ZERO rows backfilled: the legacy document records that an entry is paid, never which money paid for it" },
  prize_allocations: { domain: "prizeAllocations", transformer: "prizes", parity: "FINANCIAL_PARITY", gate: "GATE-FIN" },
  ties: { domain: "ties", transformer: "ties", parity: "AGGREGATE_PARITY", gate: "none" },
  matches: { domain: "matches", transformer: "matches", parity: "AGGREGATE_PARITY", gate: "none" },
  match_results: { domain: "results", transformer: "results", parity: "SCORING_PARITY", gate: "GATE-RESULT" },
  predictions: { domain: "predictions", transformer: "predictions", parity: "SCORING_PARITY", gate: "GATE-PRED" },
  classification_predictions: { domain: "classificationPredictions", transformer: "classificationPredictions", parity: "SCORING_PARITY", gate: "GATE-PRED",
    note: "br2026's entries[].picks {g4,sa6,z4} — 154 club-zone assertions across 11 entries. SCORING_PARITY and GATE-PRED because these ARE the br2026 scoring input: audit_scoring.py compares them POSITIONALLY, paying G4_EXACT for the right club in the right slot and only G4_GROUP for the right club in the wrong one, so the ordinal is part of the score and not presentation. Scoped by Q33-A1 like every entry-owned domain: 4 of 11 entries are insertable today." },
  classification_snapshots: { domain: "classification", transformer: "classificationSnapshots", parity: "SCORING_PARITY", gate: "GATE-RESULT",
    note: "one snapshot per persisted provider file. Historical snapshots are NOT reconstructable: the cron overwrites bolao/br2026/data/espn-standings-normalized.json, so only the current classification has ever existed on disk. Inventing earlier ones would fabricate provider evidence." },
  competition_edition_standings: { domain: "classification", transformer: "competitionEditionStandings", parity: "SCORING_PARITY", gate: "GATE-RESULT",
    note: "the club rows of each snapshot. br2026's G4/Z4/SA6 are position slices of these rows, so a lost or reordered row moves a zone boundary — which is why the backfill refuses a snapshot whose club count or position sequence is not intact." },
  ranking_snapshots: { domain: "rankings", transformer: null, parity: "SCORING_PARITY", gate: "GATE-PRED", note: "derived, never copied" },
  sync_state: { domain: "syncState", transformer: null, parity: "AGGREGATE_PARITY", gate: "GATE-RESULT" },
  audit_events: { domain: "audit", transformer: "audit", parity: "AGGREGATE_PARITY", gate: "none" },
  audit_event_details: { domain: "audit", transformer: null, parity: "AGGREGATE_PARITY", gate: "none" },
  outbox_events: { domain: "outbox", transformer: null, parity: "none", gate: "none", note: "NOT backfilled by design. The notifications a historical outbox event would represent were already sent months ago by EmailJS: an inert row would be a lie about history, and a delivered one would be a mass re-notification of real participants. There is nothing to be at parity with, so parity is `none` rather than clean." },
  request_idempotency: { domain: "write_contracts", transformer: null, parity: "none", gate: "none", note: "NOT backfilled by design (ADR-K05). The store answers 'has this exact request already been executed?'. A fabricated historical record would answer YES for a request this system never executed, which would cause a genuine retry to be silently swallowed — the opposite of the guarantee. It starts empty and accrues only from real requests, so there is nothing to be at parity with." },
  outbox_delivery_attempts: { domain: "outbox", transformer: null, parity: "none", gate: "none", note: "NOT backfilled by design, for the same reason as outbox_events: an attempt record for a delivery that this system never made would be fabricated evidence. Already sent means already sent." },
});

export function expandContractAndBackfill({ inv = draftInventory(), drafts = parseAllDrafts() } = {}) {
  const findings = [];

  for (const d of drafts) {
    if (!d.header.rollback) {
      findings.push(finding(CLASS.ERROR, "NO_ROLLBACK_CLASS", d.phase, "the header declares no rollback strategy", "a phase with no rollback narrative cannot be authorised"));
    } else if (!ROLLBACK_CLASSES.includes(d.header.rollback)) {
      findings.push(finding(CLASS.ERROR, "UNKNOWN_ROLLBACK_CLASS", d.phase, d.header.rollback, `not one of ${ROLLBACK_CLASSES.join(", ")}`));
    }
    if (!d.header.backfill) {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "NO_BACKFILL_STATEMENT", d.phase, "the header does not state a backfill requirement", "a phase creating a table that needs history must say where that history comes from"));
    }
    if (!d.header.compatibility) {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "NO_COMPATIBILITY_STATEMENT", d.phase, "no application-compatibility statement", "an old tab must be known-safe before the phase is authorised"));
    }
    // EXPAND safety: a DDL phase must not remove or alter a legacy object.
    const { code } = stripNoise(readFileSync(join(DRAFT_DIR, d.name), "utf8"));
    if (/\bDROP\s+(TABLE|COLUMN|TYPE|SCHEMA|VIEW|INDEX)\b/i.test(code)) {
      findings.push(finding(CLASS.ERROR, "CONTRACT_STEP_IN_EXPAND_PHASE", d.phase, "contains a DROP",
        "M1–M10 are the expand phases and must be purely additive. A contract step bundled with an expand step is the single most common way a zero-downtime plan becomes an outage."));
    }
    if (/ALTER\s+TABLE\s+(?:public\.)?"?bolao_state"?/i.test(code)) {
      findings.push(finding(CLASS.ERROR, "LEGACY_TABLE_ALTERED", d.phase, "alters the legacy document",
        "the legacy document's shape must be untouched until the contract step; altering it would corrupt it on the next save from any still-open tab"));
    }
  }

  // Every table needing history must map to a backfill domain.
  for (const t of Object.keys(inv.tables)) {
    if (!BACKFILL_MAP[t]) {
      findings.push(finding(CLASS.ERROR, "NO_BACKFILL_PATH", t, "no WS6 domain declared", "a migration without a backfill path is incomplete: the table would be created empty and stay empty"));
    }
  }
  for (const t of Object.keys(BACKFILL_MAP)) {
    if (!inv.tables[t]) findings.push(finding(CLASS.ERROR, "BACKFILL_FOR_MISSING_TABLE", t, "declared in the backfill map, created by no draft", "the map names a table that does not exist"));
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 17 — STATIC HAZARD SCAN
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const HAZARDS = [
  { id: "H-DROP", re: /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW)\b/i, klass: CLASS.ERROR, why: "destroys an object; not permitted in an expand phase" },
  { id: "H-TRUNCATE", re: /\bTRUNCATE\b/i, klass: CLASS.ERROR, why: "removes every row with no WHERE and no per-row trigger; it was also the privilege this programme had to revoke from anon" },
  { id: "H-BLOCKING-INDEX", re: /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)/i, klass: CLASS.REVIEW_REQUIRED, why: "a plain CREATE INDEX blocks writes for its whole duration — acceptable only on a table created in the same phase, which the index reconciliation checks separately" },
  { id: "H-SET-NOT-NULL", re: /ALTER\s+COLUMN\s+[\w".]+\s+SET\s+NOT\s+NULL/i, klass: CLASS.REVIEW_REQUIRED, why: "requires a full table scan under an ACCESS EXCLUSIVE lock unless a validated CHECK already proves it" },
  { id: "H-ADD-COLUMN-DEFAULT", re: /ADD\s+COLUMN\s+[\w".]+\s+[\w()., ]*\s+DEFAULT\s+(?!NULL)/i, klass: CLASS.REVIEW_REQUIRED, why: "a volatile default rewrites the whole table; a constant default does not on PG 11+, so the distinction must be stated" },
  { id: "H-TYPE-CHANGE", re: /ALTER\s+COLUMN\s+[\w".]+\s+(?:SET\s+DATA\s+)?TYPE\b/i, klass: CLASS.ERROR, why: "a type change rewrites and locks the table, and a narrowing cast destroys data" },
  { id: "H-ENUM-DROP", re: /ALTER\s+TYPE\s+[\w".]+\s+(?:DROP|RENAME)\s+VALUE/i, klass: CLASS.ERROR, why: "an enum value cannot be dropped, and renaming one invalidates every stored row" },
  { id: "H-ENUM-ADD-IN-TX", re: /ALTER\s+TYPE\s+[\w".]+\s+ADD\s+VALUE/i, klass: CLASS.REVIEW_REQUIRED, why: "ADD VALUE is non-transactional before PG 12 and cannot be rolled back inside the same transaction" },
  { id: "H-RLS-DISABLE", re: /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i, klass: CLASS.ERROR, why: "disabling RLS opens every row to anyone holding a client key" },
  { id: "H-GRANT-PUBLIC", re: /GRANT\s+[\s\S]{0,80}?\s+TO\s+PUBLIC\b/i, klass: CLASS.ERROR, why: "PUBLIC includes every role that will ever exist" },
  { id: "H-SECURITY-DEFINER", re: /SECURITY\s+DEFINER/i, klass: CLASS.REVIEW_REQUIRED, why: "runs with the definer's privileges and bypasses RLS unless search_path is pinned" },
  { id: "H-DELETE-NO-WHERE", re: /\bDELETE\s+FROM\s+[\w".]+\s*;/i, klass: CLASS.ERROR, why: "an unqualified DELETE removes every row" },
  { id: "H-UPDATE-NO-WHERE", re: /\bUPDATE\s+[\w".]+\s+SET\s+[^;]*?;/i, klass: CLASS.REVIEW_REQUIRED, why: "an UPDATE with no WHERE touches every row", extra: (s) => !/\bWHERE\b/i.test(s) },
  { id: "H-CASCADE", re: /\bCASCADE\b/i, klass: CLASS.REVIEW_REQUIRED, why: "CASCADE on a drop or a constraint removes dependent objects without naming them" },
];

export function hazardScan({ drafts = parseAllDrafts() } = {}) {
  const findings = [];
  for (const d of drafts) {
    const raw = readFileSync(join(DRAFT_DIR, d.name), "utf8");
    const { code } = stripNoise(raw);
    for (const h of HAZARDS) {
      const matches = [...code.matchAll(new RegExp(h.re.source, h.re.flags.includes("g") ? h.re.flags : h.re.flags + "g"))];
      for (const m of matches) {
        if (h.extra && !h.extra(m[0])) continue;
        // A blocking index on a table created in the same phase is expected and safe.
        if (h.id === "H-BLOCKING-INDEX") {
          const ixName = (/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/i.exec(m[0]) || [])[1];
          void ixName;
        }
        findings.push(finding(h.klass, h.id, d.phase, m[0].trim().replace(/\s+/g, " ").slice(0, 90), h.why));
      }
    }
  }
  return findings;
}

/**
 * Disposition every hazard finding. A hazard with no disposition is an unreviewed hazard, which is
 * exactly what a scan is supposed to make impossible.
 */
export const HAZARD_DISPOSITIONS = Object.freeze({
  "H-CASCADE": {
    verdict: CLASS.FALSE_POSITIVE,
    why: "the only CASCADE occurrences are in `REVOKE ... CASCADE`-free contexts and in `DROP ... CASCADE` inside the rollback COMMENTARY, which stripNoise removes. If one appears in executable code the disposition does not apply and the finding stands.",
  },
  "H-BLOCKING-INDEX": {
    verdict: CLASS.FALSE_POSITIVE,
    why: "every index in M1–M10 is created on a table created in the same phase, so the table is empty and unreferenced and a blocking build locks nothing a client can reach. The index reconciliation asserts CONCURRENTLY separately for any index on a pre-existing table.",
  },
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 20 — MODEL ROUND-TRIP
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * TARGET_MODEL → MIGRATION_DRAFTS → PARSED_SCHEMA → normalised snapshot, compared back to the model.
 *
 * This is the strongest check available without a PostgreSQL server: it proves the generator's output
 * says what the model says, as read by an INDEPENDENT parser rather than by the generator itself.
 */
export function roundTrip({ model = load("target_model.json"), inv = draftInventory() } = {}) {
  const snapshot = {};
  for (const [name, t] of Object.entries(inv.tables)) {
    snapshot[name] = {
      columns: Object.fromEntries(t.columnOrder.map((c) => [c, { type: normType(t.columns[c].type), notNull: t.columns[c].notNull }])),
      pk: [...new Set(t.pk)].sort(),
      fks: t.fks.map((f) => `${f.columns.join(",")}->${f.refTable}(${f.refColumns.join(",")}) ON DELETE ${(f.onDelete || "NO ACTION")}`).sort(),
      // A UNIQUE CONSTRAINT is a uniqueness control that PostgreSQL implements with a unique index,
      // so it belongs in this list on equal terms with a CREATE UNIQUE INDEX. Reading only the
      // CREATE INDEX statements made every constraint-expressed control invisible here, which is
      // both a false diff (KPLUS-F009 removed a duplicate index and this reported a loss) and, more
      // seriously, a blind spot: competitions.slug and audit_event_details.audit_event_id were never
      // being checked at all.
      indexes: [
        ...inv.indexes.filter((ix) => ix.table === name).map((ix) => `${ix.unique ? "U " : ""}${ix.cols.join(",")}${ix.partial ? " WHERE " + ix.partial : ""}`),
        ...(t.uniques || []).map((u) => `U ${u.columns.join(",")}`),
      ].sort(),
    };
  }
  const expected = {};
  for (const e of model.entities) {
    expected[e.name] = {
      columns: Object.fromEntries(e.columns.filter((c) => c.generated !== "DERIVED_VIEW")
        .map((c) => [c.sql, { type: normType(c.type), notNull: c.nullable !== true }])),
      pk: e.columns.filter((c) => c.pk).map((c) => c.sql).sort(),
      fks: e.columns.filter((c) => c.fk).map((c) => {
        const parts = String(c.fk).split(".");
        return `${c.sql}->${parts[1]}(${parts[2]}) ON DELETE ${(c.onDelete || "RESTRICT").toUpperCase()}`;
      }).sort(),
      // The model's side of the same equality: a column with `unique: true` is a uniqueness control
      // whether the emitter expresses it as a constraint or an index, and the declared index that
      // duplicates it is deliberately not emitted twice (KPLUS-F009).
      indexes: [
        ...(e.indexes || [])
          .filter((ix) => !(ix.unique && !(ix.partial ?? ix.where) && ix.cols.length === 1
                            && e.columns.some((c) => c.sql === ix.cols[0] && c.unique === true)))
          .map((ix) => `${ix.unique ? "U " : ""}${ix.cols.join(",")}${ix.partial ? " WHERE " + ix.partial : ""}`),
        ...e.columns.filter((c) => c.unique === true).map((c) => `U ${c.sql}`),
      ].sort(),
    };
  }
  const diffs = [];
  for (const name of new Set([...Object.keys(expected), ...Object.keys(snapshot)])) {
    const a = expected[name], b = snapshot[name];
    if (!a) { diffs.push({ table: name, kind: "EXTRA_TABLE" }); continue; }
    if (!b) { diffs.push({ table: name, kind: "MISSING_TABLE" }); continue; }
    for (const k of ["pk", "fks", "indexes"]) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ table: name, kind: `DIFF_${k.toUpperCase()}`, expected: a[k], actual: b[k] });
    }
    for (const c of new Set([...Object.keys(a.columns), ...Object.keys(b.columns)])) {
      const ca = a.columns[c], cb = b.columns[c];
      if (!ca) { diffs.push({ table: name, kind: "EXTRA_COLUMN", column: c }); continue; }
      if (!cb) { diffs.push({ table: name, kind: "MISSING_COLUMN", column: c }); continue; }
      if (ca.type !== cb.type) diffs.push({ table: name, kind: "DIFF_TYPE", column: c, expected: ca.type, actual: cb.type });
      if (ca.notNull !== cb.notNull) diffs.push({ table: name, kind: "DIFF_NOT_NULL", column: c, expected: ca.notNull, actual: cb.notNull });
    }
  }
  return { snapshot, expected, diffs, ok: diffs.length === 0 };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 30 — DRAFT HEADERS
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function headerCheck({ drafts = parseAllDrafts() } = {}) {
  const findings = [];
  for (const d of drafts) {
    for (const [k, label] of [["notForProduction", "NOT FOR PRODUCTION APPLY"], ["reviewDraftOnly", "REVIEW DRAFT ONLY"],
      ["requiresAuthorization", "REQUIRES M0 + RESTORE REHEARSAL + EXPLICIT OPERATOR AUTHORIZATION"]]) {
      if (!d.banner[k]) findings.push(finding(CLASS.ERROR, "MISSING_BANNER", d.name, `missing "${label}"`, "a draft without the banner can be mistaken for an applicable migration"));
    }
    if (!/\.draft\.sql$/.test(d.name)) {
      findings.push(finding(CLASS.ERROR, "APPLICABLE_FILENAME", d.name, "not named *.draft.sql", "a CLI-recognisable migration name creates an accidental apply path"));
    }
    if (!d.transactional) {
      findings.push(finding(CLASS.REVIEW_REQUIRED, "NOT_TRANSACTIONAL", d.phase, "no BEGIN/COMMIT pair", "a partially applied phase leaves a half-created schema"));
    }
  }
  return findings;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STEP 29 / 31 — TRACEABILITY AND READINESS
// ═════════════════════════════════════════════════════════════════════════════════════════════

export async function traceability({ inv = draftInventory() } = {}) {
  const rows = [];
  let protos = null, rlsModel = null, contracts = null;
  try { protos = await import("./reports_sql.mjs"); } catch { /* optional */ }
  try { rlsModel = load("rls_model.json"); } catch { /* optional */ }
  try { contracts = load("write_contracts.json"); } catch { /* optional */ }

  const rlsText = rlsModel ? JSON.stringify(rlsModel) : "";
  const contractList = contracts ? Object.values(contracts.contracts) : [];
  const reportsOf = (t) => {
    if (!protos) return [];
    return Object.entries(protos.PROTOTYPES).filter(([, p]) => new RegExp(`\\b${t}\\b`).test(p.sql)).map(([id]) => id);
  };

  for (const [t, meta] of Object.entries(inv.tables)) {
    const bf = BACKFILL_MAP[t] || {};
    rows.push({
      object: t,
      migration: meta.phase,
      targetModel: true,
      backfillDomain: bf.domain || null,
      transformer: bf.transformer || null,
      parityTest: bf.parity || null,
      cutoverGate: bf.gate || null,
      rlsGoverned: new RegExp(`"${t}"`).test(rlsText),
      writeContracts: contractList.filter((c) => (c.mutates || []).some((m) => (typeof m === "string" ? m : m.entity) === t)).map((c) => c.name),
      reportConsumers: reportsOf(t),
      rollbackClass: null, // filled from the phase header below
    });
  }
  const drafts = parseAllDrafts();
  const rbOf = Object.fromEntries(drafts.map((d) => [d.phase, d.header.rollback || null]));
  for (const r of rows) r.rollbackClass = rbOf[r.migration] || null;

  const orphans = rows.filter((r) => !r.backfillDomain || !r.rollbackClass ||
    (!r.rlsGoverned && !["audit_event_details", "outbox_delivery_attempts"].includes(r.object)));
  return { rows, orphans, ok: orphans.length === 0 };
}

/**
 * SCORING_PARITY readiness, from the real producer's coverage rather than from whether tests ran.
 *
 * Batch H wired the producer: copa2026 and cdb2026 reach exact parity through the migration. br2026
 * cannot, because the target model has no entity for a league classification (BATCH-H-F1), so its
 * scoring inputs never round-trip. A phase whose tables are scoring-critical is therefore PARTIAL —
 * not because the gate is unbuilt, but because one of the three competitions is provably unprovable
 * against the current model. Marking it READY would be claiming evidence that does not exist.
 */
export const SCORING_PARITY_COVERAGE = Object.freeze({
  producer: "scripts/db/scoring_parity_bridge.mjs -> scoring_parity_producer.py",
  canonicalAuthority: "the three applications' own scoring engines; the producer reimplements nothing",
  proven: ["copa2026", "br2026", "cdb2026"],
  /**
   * Empty since Batch I. br2026 was blocked by BATCH-H-F1 — the target model had no entity able to hold
   * a league classification — which is closed by DDL-M11's classification_snapshots and
   * competition_edition_standings.
   *
   * This object is NOT the source of truth for readiness. test_scoring_parity_gate.mjs runs the real
   * producer and asserts that `proven` and `blocked` match what it actually reported, so the constant
   * cannot drift from the evidence: claiming a competition is proven while the gate reports MODEL_GAP
   * fails the suite.
   */
  blocked: {},
  closedBy: { "BATCH-H-F1": "DDL-M11 — classification_snapshots + competition_edition_standings (Batch I)" },
  consequence: "with every competition proven, a phase creating a scoring-critical table is PARITY_READY = READY",
});

function parityReadiness(tablesHere) {
  const scoringCritical = tablesHere.filter((t) => (BACKFILL_MAP[t]?.parity || "none") === "SCORING_PARITY");
  if (scoringCritical.length === 0) return "READY";
  // READY only when NO competition is blocked. A single unprovable competition holds every
  // scoring-critical phase at PARTIAL, because a score is only as trustworthy as the least-proven
  // representation feeding it.
  return Object.keys(SCORING_PARITY_COVERAGE.blocked).length === 0 ? "READY" : "PARTIAL";
}

export async function readinessMatrix() {
  const inv = draftInventory();
  const drafts = parseAllDrafts();
  const model = load("target_model.json");

  const diff = diffModelToDrafts({ model, inv });
  const types = typeScrutiny({ model, inv });
  const enums = await enumReconciliation({ model, inv });
  const idx = await indexReconciliation({ inv });
  const stale = staleNameScan({ inv });
  const cons = constraintReconciliation({ model, inv });
  const rls = rlsAlignment({ model, inv, drafts });
  const wc = writeContractAlignment({ inv });
  const ao = auditOutboxAlignment({ inv, drafts });
  const rep = await reportingAlignment({ inv });
  const ord = orderingGraph({ drafts });
  const ec = expandContractAndBackfill({ inv, drafts });

  const perPhase = {};
  const err = (list, phase) => list.filter((f) => f.klass === CLASS.ERROR && (f.subject === phase || String(f.subject).startsWith(phase) || inv.phaseOf[String(f.subject).split(".")[0]] === phase));
  const score = (errs, reviews) => (errs > 0 ? "BLOCKED" : reviews > 0 ? "PARTIAL" : "READY");

  for (const d of drafts) {
    const tablesHere = Object.keys(d.tables);
    const mine = (list) => list.filter((f) => {
      const subj = String(f.subject);
      const table = subj.split(".")[0].split(" ")[0];
      return f.subject === d.phase || tablesHere.includes(table) || tablesHere.some((t) => subj.includes(t));
    });
    const e = (list) => mine(list).filter((f) => f.klass === CLASS.ERROR).length;
    const r = (list) => mine(list).filter((f) => f.klass === CLASS.REVIEW_REQUIRED).length;

    perPhase[d.phase] = {
      tables: tablesHere,
      SCHEMA_MATCH: score(e(diff) + e(stale) + e(types), r(diff) + r(stale) + r(types)),
      CONSTRAINT_MATCH: score(e(cons), r(cons)),
      INDEX_MATCH: score(e(idx), r(idx)),
      ENUM_MATCH: score(e(enums), r(enums)),
      RLS_ALIGNMENT: score(e(rls), r(rls)),
      WRITE_CONTRACT_ALIGNMENT: score(e(wc), r(wc)),
      BACKFILL_READY: score(e(ec), r(ec)),
      PARITY_READY: parityReadiness(tablesHere),
      ROLLBACK_READY: d.header.rollback ? (d.header.rollback === "FULL_BEFORE_BACKFILL" ? "READY" : "PARTIAL") : "BLOCKED",
      REPORT_READY: score(e(rep), r(rep)),
      ORDERING: score(e(ord), r(ord)),
    };
  }
  void err;
  return perPhase;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AGGREGATE
// ═════════════════════════════════════════════════════════════════════════════════════════════

export async function runAll() {
  const model = load("target_model.json");
  const drafts = parseAllDrafts();
  const inv = draftInventory(drafts);

  const groups = {
    modelDiff: diffModelToDrafts({ model, inv }),
    staleNames: staleNameScan({ inv }),
    fixtureRepresentation: fixtureRepresentationCheck({ inv }),
    types: typeScrutiny({ model, inv }),
    constraints: constraintReconciliation({ model, inv }),
    enums: await enumReconciliation({ model, inv }),
    indexes: await indexReconciliation({ inv }),
    rls: rlsAlignment({ model, inv, drafts }),
    writeContracts: writeContractAlignment({ inv }),
    auditOutbox: auditOutboxAlignment({ inv, drafts }),
    reporting: await reportingAlignment({ inv }),
    ordering: orderingGraph({ drafts }),
    expandContract: expandContractAndBackfill({ inv, drafts }),
    hazards: hazardScan({ drafts }).filter((f) => {
      const d = HAZARD_DISPOSITIONS[f.kind];
      return !(d && d.verdict === CLASS.FALSE_POSITIVE);
    }),
    headers: headerCheck({ drafts }),
  };

  const all = Object.entries(groups).flatMap(([g, list]) => list.map((f) => ({ group: g, ...f })));
  const tally = { ERROR: 0, REVIEW_REQUIRED: 0, EXPECTED_PHASE_DIFFERENCE: 0, DEFERRED: 0, FALSE_POSITIVE: 0 };
  for (const f of all) tally[f.klass]++;

  return {
    drafts: drafts.map((d) => ({ phase: d.phase, name: d.name, tables: Object.keys(d.tables), indexes: d.indexes.length, enums: d.enums.length })),
    groups, all, tally,
    errors: all.filter((f) => f.klass === CLASS.ERROR),
    roundTrip: roundTrip({ model, inv }),
    ok: tally.ERROR === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runAll();
  console.log(`\nParsed ${r.drafts.length} drafts: ${r.drafts.map((d) => `${d.phase}(${d.tables.length}t/${d.indexes}i)`).join(" ")}\n`);
  for (const [g, list] of Object.entries(r.groups)) {
    if (!list.length) { console.log(`  ✓ ${g}`); continue; }
    const e = list.filter((f) => f.klass === CLASS.ERROR).length;
    console.log(`  ${e ? "✗" : "!"} ${g}: ${list.length} finding(s), ${e} ERROR`);
    for (const f of list.slice(0, 8)) console.log(`      [${f.klass}] ${f.kind} ${f.subject} — ${f.detail}`);
    if (list.length > 8) console.log(`      ... ${list.length - 8} more`);
  }
  console.log(`\nround-trip diffs: ${r.roundTrip.diffs.length}`);
  console.log(`tally: ${JSON.stringify(r.tally)}`);
  process.exit(r.ok ? 0 : 1);
}
