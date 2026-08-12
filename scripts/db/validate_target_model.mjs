#!/usr/bin/env node
/**
 * Validator for model/target_model.json.
 *
 * WHY THIS EXISTS
 * The model is the single source of truth for six generated documents. An inconsistency in it
 * propagates silently into all six. This programme has recorded five instances of a check reporting
 * green over a scope that quietly shrank; a hand-authored 21-entity model with no validator would be
 * the sixth.
 *
 * It enforces the invariants that CANNOT be expressed in JSON:
 *   · every FK target resolves to a real entity.column (or an allowlisted external table)
 *   · every entity has exactly one PK
 *   · closed vocabularies are respected (pii/financial/retention/audit/api/conflict)
 *   · NO FLOAT/REAL/DOUBLE anywhere — financial amounts must be exact decimal
 *   · every monetary amount has a currency companion in the same entity
 *   · currency columns carrying unknown history have NO default (U1 policy)
 *   · no cascade on a money-bearing table
 *   · every index references real columns
 *   · identity/self-reference columns cannot create a trivial cycle without a guarding check
 *
 * Usage: node scripts/db/validate_target_model.mjs [--json]
 * Exit: 0 valid · 1 invalid · 2 runner error
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = join(HERE, "..", "..", "model", "target_model.json");

export const VOCAB = {
  pii: ["NONE", "PSEUDONYMOUS_ID", "DIRECT_IDENTIFIER", "CONTACT", "SENSITIVE_SNAPSHOT"],
  financial: ["NONE", "MONETARY_AMOUNT", "CURRENCY_CODE", "EXTERNAL_REFERENCE", "DERIVED_MONETARY"],
  encryption: ["NONE", "AT_REST_PROVIDER", "COLUMN_LEVEL_REQUIRED"],
  retention: ["WITH_PARENT", "RETAIN_5Y_FINANCIAL", "RETAIN_5Y_AUDIT", "RETAIN_24M_AFTER_LAST_USE",
              "RETAIN_90D_PAYLOAD", "REDACT_IN_PLACE", "INDEFINITE_REFERENCE"],
  audit: ["NOT_AUDITED", "CHANGES_AUDITED", "APPEND_ONLY", "IMMUTABLE_AFTER_INSERT"],
  api: ["INTERNAL", "VIA_VIEW", "VIA_RPC_ONLY", "PUBLIC_PROJECTION"],
  conflict: ["LAST_WRITE_WINS", "OPTIMISTIC_VERSION", "APPEND_ONLY_NO_CONFLICT", "OPERATOR_RESOLVES"],
  onDelete: ["RESTRICT", "CASCADE", "SET NULL", "NO ACTION"],
};

export const COLUMN_DEFAULTS = {
  nullable: false, pk: false, unique: false, generated: null, fk: null, onDelete: null,
  pii: "NONE", financial: "NONE", encryption: "NONE", retention: "WITH_PARENT",
  audit: "CHANGES_AUDITED", mutable: true, api: "INTERNAL", conflict: "LAST_WRITE_WINS",
  sourceOfTruth: "THIS_TABLE", legacy: null, legacyPath: null,
};

/** Tables outside the model that FKs may legitimately reference. */
const EXTERNAL_TABLES = new Set(["auth.users.id"]);

/** Money-bearing entities where ON DELETE CASCADE is forbidden. */
const MONEY_DOMAINS = new Set(["financial"]);

export function loadModel(path = MODEL_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function withDefaults(col) {
  return { ...COLUMN_DEFAULTS, ...col };
}

export function validate(model) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  const byName = new Map();
  for (const e of model.entities) {
    if (byName.has(e.name)) E(`duplicate entity name: ${e.name}`);
    byName.set(e.name, e);
  }

  const colKey = (schema, entity, col) => `${schema}.${entity}.${col}`;
  const allCols = new Set();
  for (const e of model.entities) {
    for (const c of e.columns) allCols.add(colKey(e.schema, e.name, c.sql));
  }

  for (const e of model.entities) {
    const cols = e.columns.map(withDefaults);
    const names = cols.map((c) => c.sql);

    // structural
    if (!e.schema) E(`${e.name}: no schema`);
    if (!e.purpose) E(`${e.name}: no purpose — an entity without a stated purpose cannot be reviewed`);
    if (!e.migrationPhase) E(`${e.name}: no migrationPhase`);
    if (!e.rlsIntent) E(`${e.name}: no rlsIntent — every table must declare intended access`);
    if (new Set(names).size !== names.length) E(`${e.name}: duplicate column names`);

    const pks = cols.filter((c) => c.pk);
    if (pks.length === 0) E(`${e.name}: no primary key`);
    if (pks.length > 1) W(`${e.name}: composite PK (${pks.map((c) => c.sql).join(",")}) — intentional?`);
    for (const pk of pks) {
      if (pk.mutable !== false) E(`${e.name}.${pk.sql}: primary key must be mutable:false`);
      if (pk.nullable) E(`${e.name}.${pk.sql}: primary key cannot be nullable`);
    }

    for (const c of cols) {
      const at = `${e.name}.${c.sql}`;

      // NO floating point, anywhere. Financial correctness depends on it.
      if (/\b(float|real|double precision|money)\b/i.test(c.type)) {
        E(`${at}: type "${c.type}" is prohibited — use numeric(14,2) for money; FLOAT/REAL/MONEY are never acceptable`);
      }

      // closed vocabularies
      for (const key of ["pii", "financial", "encryption", "retention", "audit", "api", "conflict"]) {
        if (!VOCAB[key].includes(c[key])) E(`${at}: ${key}="${c[key]}" is not in the closed vocabulary`);
      }
      if (c.onDelete && !VOCAB.onDelete.includes(c.onDelete)) {
        E(`${at}: onDelete="${c.onDelete}" invalid`);
      }

      // FK resolution
      if (c.fk) {
        const parts = c.fk.split(".");
        if (parts.length !== 3) {
          E(`${at}: fk "${c.fk}" must be schema.table.column`);
        } else if (!allCols.has(c.fk) && !EXTERNAL_TABLES.has(c.fk)) {
          E(`${at}: fk target "${c.fk}" does not resolve to any modelled column or allowlisted external table`);
        }
        if (!c.onDelete) E(`${at}: fk without an explicit onDelete — cascade behaviour must never be implicit`);
        // money must not cascade
        if (c.onDelete === "CASCADE" && MONEY_DOMAINS.has(e.domain)) {
          E(`${at}: ON DELETE CASCADE on a financial entity — money-bearing rows must be preserved, not cascaded`);
        }
      }
      if (c.onDelete && !c.fk) E(`${at}: onDelete declared without an fk`);

      // monetary amounts need a currency companion
      if (c.financial === "MONETARY_AMOUNT") {
        if (!/^numeric\(\d+,\d+\)$/.test(c.type)) {
          E(`${at}: MONETARY_AMOUNT must be numeric(p,s), got "${c.type}"`);
        }
        const hasCurrency = cols.some((o) => o.financial === "CURRENCY_CODE");
        if (!hasCurrency) E(`${at}: MONETARY_AMOUNT with no CURRENCY_CODE column in ${e.name} — an amount without a currency is not money`);
      }

      // currency policy (U1): explicit, ISO-4217 shaped, and never silently defaulted
      if (c.financial === "CURRENCY_CODE") {
        if (!/^char\(3\)$/.test(c.type)) E(`${at}: CURRENCY_CODE should be char(3) for ISO-4217, got "${c.type}"`);
        if (c.default) {
          E(`${at}: CURRENCY_CODE must NOT have a default — a defaulted currency lets a future pool silently inherit USD and produce wrong money (U1 policy)`);
        }
      }

      // derived columns must not claim to be stored
      if (c.generated === "DERIVED_VIEW" && c.pk) E(`${at}: a derived column cannot be a primary key`);

      // PII columns need a retention posture other than the default
      if (["DIRECT_IDENTIFIER", "CONTACT"].includes(c.pii) && c.retention === "WITH_PARENT") {
        W(`${at}: PII column inherits WITH_PARENT retention — consider REDACT_IN_PLACE for erasure support`);
      }

      // Audit tables: immutability must be declared, not assumed — EXCEPT in a redactable sidecar,
      // where mutability is the point. A table that declares a `redacted_at` column is asserting
      // that its payload will be updated (nulled) for erasure, and that is precisely how G-02 is
      // satisfied without breaking the hash chain. Warning on it would be a false positive.
      const isRedactable = cols.some((o) => o.sql === "redacted_at");
      if (e.schema === "audit" && !isRedactable && c.mutable !== false && !c.generated) {
        W(`${at}: column in a non-redactable audit table is mutable — audit rows should be immutable after insert`);
      }
    }

    // indexes must reference real columns (expression indexes allowed via parens)
    for (const idx of e.indexes || []) {
      for (const col of idx.cols) {
        const bare = col.replace(/^lower\(|\)$/g, "");
        if (!names.includes(bare) && !col.includes("(")) {
          E(`${e.name}: index references unknown column "${col}"`);
        }
      }
      if (!idx.rationale) E(`${e.name}: index on (${idx.cols.join(",")}) has no rationale — an unjustified index is write cost with no owner`);
    }

    // self-reference needs a guarding check
    for (const c of cols) {
      if (c.fk === colKey(e.schema, e.name, pks[0]?.sql)) {
        const guarded = (e.checks || []).some((k) => k.expr.includes(c.sql));
        if (!guarded) E(`${e.name}.${c.sql}: self-reference without a CHECK preventing a 1-cycle`);
      }
    }

    for (const k of e.checks || []) {
      if (!k.name) E(`${e.name}: unnamed check constraint`);
      if (!k.why) E(`${e.name}.${k.name}: check has no stated reason`);
    }
  }

  // model-level
  if (!model.meta?.currentPoolCurrency) E("meta.currentPoolCurrency missing");
  if (!/^[A-Z]{3}$/.test(model.meta.currentPoolCurrency || "")) E("meta.currentPoolCurrency must be an ISO-4217 code");
  if (!/numeric/i.test(model.meta?.moneyType || "")) E("meta.moneyType must specify an exact decimal type");

  return { errors, warnings };
}

function main() {
  const model = loadModel();
  const { errors, warnings } = validate(model);
  const entities = model.entities.length;
  const columns = model.entities.reduce((n, e) => n + e.columns.length, 0);
  const fks = model.entities.reduce((n, e) => n + e.columns.filter((c) => c.fk).length, 0);
  const indexes = model.entities.reduce((n, e) => n + (e.indexes || []).length, 0);
  const checks = model.entities.reduce((n, e) => n + (e.checks || []).length, 0);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ entities, columns, fks, indexes, checks, errors, warnings,
      verdict: errors.length ? "INVALID" : "VALID" }, null, 2));
    return errors.length ? 1 : 0;
  }

  console.log(`\nTarget model validation\n`);
  console.log(`  entities=${entities}  columns=${columns}  fks=${fks}  indexes=${indexes}  checks=${checks}\n`);
  for (const w of warnings) console.log(`  ! ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  console.log(errors.length === 0 ? "✓ TARGET MODEL VALID\n" : "✗ TARGET MODEL INVALID\n");
  return errors.length ? 1 : 0;
}

// Run-as-main detection by exact module URL. `endsWith("x.mjs")` is wrong: "test_x.mjs"
// also ends with "x.mjs", so importing this module from its own test suite would execute the CLI.
const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  try { process.exit(main()); }
  catch (e) { console.error(`runner error: ${e.message}`); process.exit(2); }
}
