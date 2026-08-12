#!/usr/bin/env node
/**
 * Target RLS engine (Workstream 12).
 *
 * ONE DEFINITION, FOUR CONSUMERS
 * `model/rls_model.json` holds policies as STRUCTURED PREDICATE OBJECTS rather than SQL strings. That single
 * representation feeds:
 *
 *   1. `renderPolicySql`  — the review-only SQL drafts
 *   2. `authorize`        — an executable evaluator, so authorization is testable without a database
 *   3. `lintPolicies`     — static checks over the policy set
 *   4. `operationMatrix`  — the ALLOW/DENY/TRUSTED_RUNTIME_ONLY matrix, derived rather than typed
 *
 * If policies were SQL strings, the evaluator would need its own parser and the test expectations would be a
 * second, divergent source of truth for authorization. Structured predicates remove that class of drift
 * entirely: a mutant applied to the model changes what the SQL says AND what the evaluator decides, which is
 * exactly what makes mutation testing meaningful here.
 *
 * WHAT THE EVALUATOR IS AND IS NOT
 * It models PostgreSQL's RLS decision procedure for the cases this schema uses: permissive policies OR
 * together per command; a command with no matching policy is denied; `WITH CHECK` gates the post-image of a
 * write; the runtime's BYPASSRLS is modelled explicitly rather than assumed. It does NOT model roles
 * inheriting one another, RESTRICTIVE policies, or column privileges — none of which this design uses, and
 * pretending otherwise would make the harness agree with a database it is not simulating.
 *
 * NOTHING HERE TOUCHES A DATABASE.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadAccessModel, OWN_SUFFIX } from "./validate_access_model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const RLS_MODEL_PATH = join(ROOT, "model", "rls_model.json");

export function loadRlsModel(path = RLS_MODEL_PATH) { return JSON.parse(readFileSync(path, "utf8")); }

export const COMMANDS = ["SELECT", "INSERT", "UPDATE", "DELETE"];
export const VERDICT = {
  ALLOW: "ALLOW", DENY: "DENY", TRUSTED_RUNTIME_ONLY: "TRUSTED_RUNTIME_ONLY",
  FUTURE_OPERATOR_IDENTITY: "FUTURE_OPERATOR_IDENTITY", NOT_APPLICABLE: "NOT_APPLICABLE",
};

/**
 * Evaluate a structured predicate against a row and a caller context.
 *
 * `ctx.ownedParticipantIds` is the set of participant ids the caller's auth identity is linked to. It is a
 * SET, not a single id, because one authenticated user may legitimately own several participant identities
 * (WS12.5) — and historical participants may have no auth linkage at all, in which case the set is empty and
 * every ownership predicate correctly denies.
 */
export function evaluatePredicate(pred, row, ctx) {
  if (pred === null || pred === undefined) return null;      // null means "no predicate supplied"
  switch (pred.kind) {
    case "TRUE": return true;
    case "FALSE": return false;
    case "AND": return pred.operands.every((p) => evaluatePredicate(p, row, ctx) === true);
    case "OR": return pred.operands.some((p) => evaluatePredicate(p, row, ctx) === true);
    case "NOT": return evaluatePredicate(pred.operands[0], row, ctx) !== true;
    case "COLUMN_NOT_NULL": return row[pred.column] !== null && row[pred.column] !== undefined;
    case "COLUMN_IS_NULL": return row[pred.column] === null || row[pred.column] === undefined;
    case "COLUMN_EQUALS": return row[pred.column] === pred.value;
    case "AUTH_UID_EQUALS": {
      // The evaluator models the caller's auth identity as ctx.authUserId; absent means anonymous, which
      // must deny rather than match a row whose column is also absent.
      const uid = ctx.authUserId ?? null;
      return uid !== null && row[pred.column] === uid;
    }
    case "OWNS_PARTICIPANT": {
      const owned = ctx.ownedParticipantIds || new Set();
      const v = row[pred.column];
      return v !== null && v !== undefined && owned.has(v);
    }
    case "OWNS_VIA_ENTRY": {
      // Ownership one hop away: the row names an entry, and the entry names a participant the caller owns.
      const owned = ctx.ownedParticipantIds || new Set();
      const entry = (ctx.entriesById || new Map()).get(row[pred.column]);
      return !!entry && owned.has(entry.participant_id);
    }
    default:
      throw new Error(`unknown predicate kind ${JSON.stringify(pred.kind)} — an unrecognised predicate must not silently evaluate true`);
  }
}

/**
 * The authorization decision.
 *
 * Returns `{allowed, reason, policy}`. `reason` names WHY, because a harness that only says DENY cannot
 * distinguish "no policy exists" from "the ownership predicate rejected this row" — and those are different
 * defects.
 */
export function authorize(model, { entity, command, principal, row = {}, newRow = null, ctx = {} }) {
  if (!COMMANDS.includes(command)) throw new Error(`unknown command ${command}`);

  const principalDef = model.principals[principal];
  if (!principalDef) return { allowed: false, reason: "UNKNOWN_PRINCIPAL", policy: null };

  /**
   * operator_context is NOT a database principal (R-GAP-1). A request arriving "as the operator" cannot be
   * authorized by the database at all, so the evaluator refuses it rather than inventing an outcome. This is
   * deliberately not a convenience: making it ALLOW would be faking an operator principal to make tests pass.
   */
  if (principal === "operator_context") {
    return { allowed: false, reason: "R_GAP_1_NO_DB_VERIFIABLE_OPERATOR", policy: null,
      note: "the database cannot authenticate an operator. Operator actions reach the database as trusted_runtime, carrying an operator id and reason in the audit event." };
  }

  /**
   * migration_role has BYPASSRLS, so it would succeed at anything. It is refused here on a different ground:
   * it must never be reachable from application runtime, so an application-shaped request naming it is a
   * role-confusion attempt, not a legitimate path.
   */
  if (principal === "migration_role") {
    return { allowed: false, reason: "MIGRATION_ROLE_NOT_APPLICATION_RUNTIME", policy: null,
      note: "migration_role holds DDL authority and BYPASSRLS. An application request must never be able to name it." };
  }

  const candidates = model.policies.filter((p) => p.entity === entity && p.principal === principal && p.command === command);
  if (candidates.length === 0) {
    return { allowed: false, reason: "NO_POLICY_FOR_COMMAND", policy: null };
  }

  // Permissive policies OR together, as in PostgreSQL.
  for (const p of candidates) {
    const usingOk = command === "INSERT" ? true : evaluatePredicate(p.using, row, ctx) === true;
    if (!usingOk) continue;
    if (command === "INSERT" || command === "UPDATE") {
      const target = newRow || row;
      const checkOk = p.withCheck === null || p.withCheck === undefined
        ? (command === "INSERT" ? false : true)     // an INSERT policy with no WITH CHECK cannot admit a row
        : evaluatePredicate(p.withCheck, target, ctx) === true;
      if (!checkOk) continue;
    }
    return { allowed: true, reason: "POLICY_MATCHED", policy: p.name };
  }
  return { allowed: false, reason: command === "SELECT" ? "USING_PREDICATE_REJECTED" : "PREDICATE_OR_CHECK_REJECTED",
    policy: candidates.map((p) => p.name).join(",") };
}

/**
 * Derived operation matrix (WS12.3). Derived, not typed: every entity × 4 commands × 5 principals is
 * hundreds of cells, and a hand-maintained table of that size is a table that disagrees with the
 * policies. (The count was written as "21 entities × … = 420" when the model held 21; it holds 26 now,
 * which is exactly why the number is computed rather than stated.)
 */
export function operationMatrix(model) {
  const entities = [...new Set(model.policies.map((p) => p.entity))].sort();
  const principals = Object.keys(model.principals);
  const matrix = {};
  for (const e of entities) {
    matrix[e] = {};
    for (const c of COMMANDS) {
      matrix[e][c] = {};
      for (const pr of principals) {
        const pols = model.policies.filter((p) => p.entity === e && p.principal === pr && p.command === c);
        let verdict;
        if (pr === "operator_context") verdict = VERDICT.FUTURE_OPERATOR_IDENTITY;
        else if (pr === "migration_role") verdict = VERDICT.NOT_APPLICABLE;
        else if (!pols.length) verdict = VERDICT.DENY;
        else if (pr === "trusted_runtime") verdict = VERDICT.TRUSTED_RUNTIME_ONLY;
        else verdict = VERDICT.ALLOW;
        matrix[e][c][pr] = { verdict, policies: pols.map((p) => p.name), why: pols[0]?.why ?? null };
      }
    }
  }
  return { entities, principals, matrix };
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL rendering (WS12.13) — review only
// ─────────────────────────────────────────────────────────────────────────────
export const SQL_BANNER = `-- NOT FOR PRODUCTION APPLY
-- TARGET RLS REVIEW DRAFT
-- REQUIRES RESTORE REHEARSAL + EXPLICIT OPERATOR AUTHORIZATION
--
-- GENERATED FILE — do not edit by hand. Source: model/rls_model.json
-- Regenerate: node scripts/db/rls.mjs --write
--
-- This file is outside every active migration path and its name is not CLI-recognisable.`;

/**
 * Render a predicate as SQL.
 *
 * `OWNS_PARTICIPANT` becomes a subquery against a link table rather than a direct auth.uid() comparison,
 * because participant identity and auth identity are DIFFERENT things (WS12.5): one user may own several
 * participants, and a historical participant may have no auth row at all.
 */
export function renderPredicate(pred) {
  if (pred === null || pred === undefined) return null;
  switch (pred.kind) {
    case "TRUE": return "true";
    case "FALSE": return "false";
    case "AND": return `(${pred.operands.map(renderPredicate).join(" AND ")})`;
    case "OR": return `(${pred.operands.map(renderPredicate).join(" OR ")})`;
    case "NOT": return `NOT (${renderPredicate(pred.operands[0])})`;
    case "COLUMN_NOT_NULL": return `${pred.column} IS NOT NULL`;
    case "COLUMN_IS_NULL": return `${pred.column} IS NULL`;
    case "COLUMN_EQUALS": return `${pred.column} = ${typeof pred.value === "string" ? `'${pred.value}'` : pred.value}`;
    // KPLUS-F048. A DIRECT comparison to the caller, not a link-table subquery — this predicate is used ON
    // the link table itself, where a subquery over the same table would be self-referential.
    case "AUTH_UID_EQUALS": return `${pred.column} = auth.uid()`;
    case "OWNS_PARTICIPANT":
      return `${pred.column} IN (SELECT participant_id FROM bolao.participant_auth_links WHERE auth_user_id = auth.uid())`;
    case "OWNS_VIA_ENTRY":
      return `${pred.column} IN (SELECT e.pool_entry_id FROM bolao.pool_entries e ` +
             `WHERE e.participant_id IN (SELECT participant_id FROM bolao.participant_auth_links WHERE auth_user_id = auth.uid()))`;
    default: throw new Error(`cannot render unknown predicate kind ${pred.kind}`);
  }
}

const ROLE_SQL = { anon: "anon", authenticated: "authenticated", trusted_runtime: "service_role" };

/**
 * KPLUS-F031. Which schema each entity actually lives in, read from the canonical model.
 *
 * This file used to write `bolao.<entity>` for every table it touched. Twenty-two of the twenty-five
 * entities are in `bolao`, which is why it went unnoticed; the audit spine — `audit_chain_head`,
 * `audit_events`, `audit_event_details` — is in `audit`. So the RLS draft named three tables that do not
 * exist, and applying it would have stopped at the first of them with `relation "bolao.audit_chain_head"
 * does not exist`. It fails closed rather than mis-targeting an existing table, but the consequence is
 * severe in the same direction as KPLUS-F028: M8 creates those tables with FORCE RLS and zero policies,
 * so if the policy step does not complete, the audit spine is unreachable by every principal.
 *
 * `target_model.json` is the authority on where a table lives, and asking it is what stops a fourth
 * schema from repeating this. An entity the model does not declare is a hard error rather than a
 * silent default back to `bolao` — a default is exactly how this defect survived.
 */
export function entitySchemas(targetModelPath = join(ROOT, "model", "target_model.json")) {
  const t = JSON.parse(readFileSync(targetModelPath, "utf8"));
  const map = new Map();
  for (const e of t.entities || []) map.set(e.name, e.schema);
  return map;
}
export function qualify(entity, schemas) {
  const s = schemas.get(entity);
  if (!s) {
    throw new Error(
      `entity "${entity}" has no schema in target_model.json, so no statement can be written for it. ` +
      `Defaulting to a schema is how KPLUS-F031 happened: three audit tables were addressed as bolao.* ` +
      `and the draft named relations that do not exist.`);
  }
  return `${s}.${entity}`;
}

/** Policies AND privileges — the two halves of the access model, in one reviewable artefact (KPLUS-F029). */
export function renderTargetAclSql(model, accessModel = loadAccessModel()) {
  return renderPolicySql(model) + "\n" + renderGrantSql(accessModel);
}

export function renderPolicySql(model) {
  const entities = [...new Set(model.policies.map((p) => p.entity))].sort();
  const schemas = entitySchemas();
  const L = [SQL_BANNER, ""];
  L.push("-- ============================================================");
  L.push("-- TARGET ROW LEVEL SECURITY — review draft");
  L.push("-- ============================================================");
  L.push("--");
  L.push(`-- Default stance: ${model.meta.defaultStance}`);
  L.push("--");
  L.push("-- operator_context has NO policies here. R-GAP-1: the database cannot authenticate an operator, so");
  L.push("-- operator actions arrive as service_role carrying an operator id and reason in the audit event.");
  L.push("-- Inventing an operator role would be faking authorization the database cannot perform.");
  L.push("--");
  L.push("-- migration_role likewise has no policies: it holds BYPASSRLS and must never be reachable from");
  L.push("-- application runtime.");
  L.push("");
  L.push("-- Ownership is a LINK TABLE, bolao.participant_auth_links, and it is created by DDL-M2 like every");
  L.push("-- other table — with RLS enabled, FORCED, and PUBLIC revoked. KPLUS-F047: it used to appear here as a");
  L.push("-- commented-out prerequisite and existed in no model entry and no migration phase, so applying this");
  L.push("-- draft as generated would have left every ownership predicate below referencing a relation that does");
  L.push("-- not exist. Participant identity and auth identity are DIFFERENT: one user may own several");
  L.push("-- participants, and a historical participant may have no auth row at all.");
  L.push("");

  for (const e of entities) {
    const pols = model.policies.filter((p) => p.entity === e);
    const rel = qualify(e, schemas);
    L.push(`-- ── ${e} ${"─".repeat(Math.max(2, 66 - e.length))}`);
    L.push(`ALTER TABLE ${rel} ENABLE ROW LEVEL SECURITY;`);
    L.push(`ALTER TABLE ${rel} FORCE ROW LEVEL SECURITY;`);
    L.push(`REVOKE ALL ON TABLE ${rel} FROM PUBLIC;`);
    const noDelete = !pols.some((p) => p.command === "DELETE");
    if (noDelete) L.push(`-- No DELETE policy for any principal: nothing in this schema is deleted.`);
    if ((model.appendOnlyEntities || []).includes(e)) {
      L.push(`-- APPEND ONLY: no UPDATE policy for any principal, including the runtime.`);
    }
    for (const p of pols) {
      L.push("");
      L.push(`-- ${p.why}`);
      L.push(`-- ownership: ${p.ownership}`);
      const parts = [`CREATE POLICY ${p.name}`, `  ON ${rel}`, `  FOR ${p.command}`, `  TO ${ROLE_SQL[p.principal] ?? p.principal}`];
      const u = renderPredicate(p.using);
      const w = renderPredicate(p.withCheck);
      if (u !== null) parts.push(`  USING (${u})`);
      if (w !== null) parts.push(`  WITH CHECK (${w})`);
      L.push(parts.join("\n") + ";");
    }
    L.push("");
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

/**
 * The access matrix as Markdown — the artefact `ACCESS_MATRIX.md` has always claimed to be.
 *
 * KPLUS-F049. That file opens with "GENERATED FILE — do not edit by hand. Regenerate: node
 * scripts/db/rls.mjs (matrix section)" and no such section existed. It was hand-maintained while
 * announcing that it was not, which is the most expensive kind of stale: a reader trusts it precisely
 * because it says a machine wrote it. Adding the 26th entity is what surfaced it — the consistency
 * checker caught the count, but the count was only the visible half.
 */
export function renderMatrixMarkdown(model) {
  const m = operationMatrix(model);
  const SYM = { [VERDICT.ALLOW]: "A", [VERDICT.TRUSTED_RUNTIME_ONLY]: "R", [VERDICT.FUTURE_OPERATOR_IDENTITY]: "F",
    [VERDICT.NOT_APPLICABLE]: "—", [VERDICT.DENY]: "·" };
  const cells = m.entities.length * COMMANDS.length * m.principals.length;
  const L = [];
  L.push("<!-- GENERATED FILE — do not edit by hand. Source: model/rls_model.json. Regenerate: node scripts/db/rls.mjs --write -->");
  L.push("");
  L.push("# ACCESS_MATRIX — target row-level access, all entities × all commands × all principals");
  L.push("");
  L.push(`**Workstream 12.** Derived from \`model/rls_model.json\` — ${m.entities.length} entities × ${COMMANDS.length} commands × ${m.principals.length} principals = ${cells} cells.`);
  L.push("A hand-maintained table of that size is a table that disagrees with the policies, so this one is generated.");
  L.push("");
  L.push("Legend: **A** ALLOW · **R** TRUSTED_RUNTIME_ONLY · **F** FUTURE_OPERATOR_IDENTITY · **—** NOT_APPLICABLE · **·** DENY");
  L.push("");
  L.push("Status: **REVIEW DRAFT.** No policy exists in any database as a result of this document.");
  L.push("");
  L.push("| Entity | SELECT<br>an/au/rt/op/mig | INSERT<br>an/au/rt/op/mig | UPDATE<br>an/au/rt/op/mig | DELETE<br>an/au/rt/op/mig |");
  L.push("|---|---|---|---|---|");
  for (const e of m.entities) {
    const col = (c) => m.principals.map((p) => SYM[m.matrix[e][c][p].verdict] ?? "?").join(" ");
    L.push(`| \`${e}\` | ${col("SELECT")} | ${col("INSERT")} | ${col("UPDATE")} | ${col("DELETE")} |`);
  }
  return L.join("\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// KPLUS-F029 — table privileges, derived from the access model
// ─────────────────────────────────────────────────────────────────────────────
/**
 * WHY THIS EXISTS
 *
 * Before this, the migration emitted no `GRANT` anywhere — not one, across twenty-five tables. That is
 * not a conservative default, it is a non-functional one, and it hid behind a category error that is
 * easy to make: **a row-level policy grants nothing.** RLS filters rows among the privileges a role
 * already holds. A table with a permissive `SELECT` policy `USING (true)` and no `GRANT SELECT` denies
 * everyone, exactly as if the policy were absent.
 *
 * So the migration as written produced a schema no application principal could reach. Measured twice,
 * independently: `m_rls_acl_lab` M10 reports `service_role SELECT on bolao.participants: ACL_DENIED`,
 * and the KPLUS-F027 lab could not make its runtime do anything until it issued the grants by hand.
 *
 * WHAT IT EMITS, AND FROM WHERE
 *
 * `model/access_model.json` already declares, per entity and per principal, exactly which commands are
 * intended. This derives the grants from that declaration rather than restating them, so the ACL and the
 * access model cannot disagree — the same reason the policies are derived rather than typed.
 *
 * THE FOUR DECISIONS, each of which could have gone another way (see ADR-K08):
 *
 * 1. `SELECT_OWN` becomes `GRANT SELECT`. There is no row-scoped GRANT in PostgreSQL; row scoping is
 *    precisely what the ownership policy does. The pair is the mechanism: the grant makes the table
 *    reachable, the policy decides which rows come back. Granting nothing instead would make every
 *    ownership policy dead code.
 * 2. `operator` produces NO grant. R-GAP-1: it is not a database principal, and operator actions arrive
 *    as `service_role`. That is only safe if operator never needs more than service — CHECKED here
 *    rather than assumed, and a violation is a hard error.
 * 3. No `DELETE` is ever granted. The model states nothing in this schema is deleted, and no entity
 *    declares the verb; a DELETE grant would be a privilege with no policy behind it and no use case.
 * 4. `REVOKE ALL ... FROM PUBLIC` precedes every grant on the same table, so the statement set is
 *    idempotent and self-contained: replaying it cannot leave a privilege that an earlier run gave and
 *    the model no longer declares.
 */
const GRANT_ROLE_SQL = { anon: "anon", authenticated: "authenticated", service: "service_role" };
/** `SELECT_OWN` is a SELECT grant plus an ownership policy. There is no row-scoped GRANT. */
const GRANT_VERB_SQL = { SELECT: "SELECT", SELECT_OWN: "SELECT", INSERT: "INSERT", UPDATE: "UPDATE" };

/**
 * The grants the access model implies, as data. Rendering is separate so the rules are testable, and so
 * a lab can assert against the same structure the SQL is written from rather than re-parsing SQL.
 *
 * Returns `{ schemaUsage, tables, operatorFolded }`.
 */
export function deriveGrants(accessModel = loadAccessModel(), schemas = entitySchemas()) {
  const tables = [];
  const schemaUsage = new Map();   // schema -> Set(role)
  const operatorFolded = [];

  for (const e of accessModel.entities) {
    const perms = e.permissions || {};
    // Decision 2, enforced. operator is folded into service, which is only sound if it never needs more.
    const op = new Set(perms.operator || []);
    const svc = new Set(perms.service || []);
    const excess = [...op].filter((v) => !svc.has(v));
    if (excess.length) {
      throw new Error(
        `access_model: operator holds ${excess.join(",")} on ${e.name} that service does not. operator is not a ` +
        `database principal (R-GAP-1) and its permissions are exercised as service_role, so an operator ` +
        `permission service lacks cannot be granted to anything. Resolve the model before generating ACLs.`);
    }
    if (op.size) operatorFolded.push(e.name);

    const rel = qualify(e.name, schemas);
    const schema = rel.split(".")[0];
    for (const [principal, role] of Object.entries(GRANT_ROLE_SQL)) {
      const verbs = [...new Set((perms[principal] || []).map((v) => {
        const sql = GRANT_VERB_SQL[v];
        if (!sql) throw new Error(`access_model: unknown permission verb "${v}" on ${e.name}.${principal}`);
        return sql;
      }))].sort();
      if (!verbs.length) continue;
      tables.push({ entity: e.name, relation: rel, schema, principal, role, verbs,
        ownScoped: (perms[principal] || []).some((v) => v.endsWith(OWN_SUFFIX)) });
      if (!schemaUsage.has(schema)) schemaUsage.set(schema, new Set());
      schemaUsage.get(schema).add(role);
    }
  }
  tables.sort((a, b) => a.relation.localeCompare(b.relation) || a.role.localeCompare(b.role));
  return { schemaUsage, tables, operatorFolded };
}

/** The grant statements, as SQL. Appended to the RLS draft — one artefact answers "who may reach what". */
export function renderGrantSql(accessModel = loadAccessModel(), schemas = entitySchemas()) {
  const { schemaUsage, tables, operatorFolded } = deriveGrants(accessModel, schemas);
  const L = [];
  L.push("-- ============================================================");
  L.push("-- TABLE PRIVILEGES — derived from model/access_model.json (KPLUS-F029)");
  L.push("-- ============================================================");
  L.push("--");
  L.push("-- A POLICY GRANTS NOTHING. Row-level security filters rows among the privileges a role already");
  L.push("-- holds; a table with a permissive policy and no GRANT denies everyone. The policies above are");
  L.push("-- therefore only half of the access model, and these statements are the other half.");
  L.push("--");
  L.push("-- Apply AFTER the policies. Order is not strictly required — a grant on a FORCE-RLS table with no");
  L.push("-- policy still yields nothing — but granting last means no window exists in which a privilege is");
  L.push("-- broader than the policy set that is meant to scope it.");
  L.push("--");
  L.push("-- SELECT_OWN in the access model becomes GRANT SELECT here. Row scoping is the ownership policy's");
  L.push("-- job and PostgreSQL has no row-scoped GRANT; the grant and the policy are one mechanism.");
  L.push("--");
  L.push(`-- operator receives NO grant (R-GAP-1: not a database principal). Its permissions on ${operatorFolded.length}`);
  L.push("-- entities are exercised as service_role, and the generator FAILS if operator is ever declared a");
  L.push("-- permission service does not have.");
  L.push("--");
  L.push("-- No DELETE is granted anywhere: nothing in this schema is deleted.");
  L.push("");
  L.push("-- Reaching a table also requires reaching its schema.");
  for (const [schema, roles] of [...schemaUsage].sort()) {
    L.push(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;`);
    L.push(`GRANT USAGE ON SCHEMA ${schema} TO ${[...roles].sort().join(", ")};`);
  }
  L.push("");
  let lastRel = null;
  for (const t of tables) {
    if (t.relation !== lastRel) {
      L.push("");
      L.push(`-- ── ${t.relation}`);
      L.push(`REVOKE ALL ON TABLE ${t.relation} FROM PUBLIC;`);
      lastRel = t.relation;
    }
    L.push(`GRANT ${t.verbs.join(", ")} ON TABLE ${t.relation} TO ${t.role};` +
      (t.ownScoped ? "   -- rows narrowed by the ownership policy above" : ""));
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy fingerprints (WS12.27)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A sanitized, normalized fingerprint per policy.
 *
 * Computed over the STRUCTURED predicate with sorted keys, so whitespace and formatting cannot change it —
 * and no literal from any predicate is emitted, only the digest. That is what makes an
 * EXPECTED_POLICY_HASH vs ACTUAL_POLICY_HASH comparison publishable.
 */
export function policyFingerprint(policy) {
  const sortDeep = (v) => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
    return v;
  };
  const canonical = JSON.stringify(sortDeep({
    entity: policy.entity, principal: policy.principal, command: policy.command,
    using: policy.using ?? null, withCheck: policy.withCheck ?? null,
  }));
  return createHash("sha256").update(canonical).digest("hex");
}

export function policyFingerprints(model) {
  const out = {};
  for (const p of model.policies) out[p.name] = policyFingerprint(p);
  return { policies: out, rollup: createHash("sha256").update(Object.entries(out).sort().map(([k, v]) => `${k}:${v}`).join("\n")).digest("hex") };
}

// ─────────────────────────────────────────────────────────────────────────────
// Linter (WS12.29)
// ─────────────────────────────────────────────────────────────────────────────
/** Every column a structured predicate names, at any depth. */
export function predicateColumns(pred, out = new Set()) {
  if (!pred || typeof pred !== "object") return out;
  if (pred.column) out.add(pred.column);
  for (const p of pred.operands || []) predicateColumns(p, out);
  return out;
}

/** entity -> Set(column), from the canonical target model. */
export function entityColumns(targetModelPath = join(ROOT, "model", "target_model.json")) {
  const t = JSON.parse(readFileSync(targetModelPath, "utf8"));
  const map = new Map();
  for (const e of t.entities || []) map.set(e.name, new Set((e.columns || []).map((c) => c.sql)));
  return map;
}

export function lintPolicies(model, { targetEntities = null, columnsByEntity = null } = {}) {
  const findings = [];
  const F = (severity, code, message) => findings.push({ severity, code, message });
  const names = new Set();

  for (const p of model.policies) {
    const at = `${p.name}`;
    if (names.has(p.name)) F("ERROR", "DUPLICATE_POLICY_NAME", `${at}: two policies share this name`);
    names.add(p.name);

    const expected = `${p.entity}_${p.principal}_${p.command.toLowerCase()}`;
    if (p.name !== expected) F("ERROR", "POLICY_NAME_NONSTANDARD", `${at}: name should be ${expected} — a deterministic name is what makes drift detection possible`);
    if (!COMMANDS.includes(p.command)) F("ERROR", "MISSING_COMMAND_SCOPE", `${at}: command ${p.command} is not one of ${COMMANDS.join("/")}`);
    if (!model.principals[p.principal]) F("ERROR", "UNKNOWN_PRINCIPAL", `${at}: principal ${p.principal} is not in the principal model`);
    if (!p.why || p.why.length < 20) F("ERROR", "POLICY_WITHOUT_RATIONALE", `${at}: no usable rationale`);

    if (p.command !== "INSERT" && (p.using === null || p.using === undefined)) {
      F("ERROR", "POLICY_MISSING_USING", `${at}: a ${p.command} policy needs a USING predicate`);
    }
    if ((p.command === "INSERT" || p.command === "UPDATE") && (p.withCheck === null || p.withCheck === undefined)) {
      F("ERROR", "POLICY_MISSING_WITH_CHECK", `${at}: a ${p.command} policy needs WITH CHECK, or it admits any post-image`);
    }
    if (p.command === "DELETE") {
      F("ERROR", "UNEXPECTED_DELETE_POLICY", `${at}: nothing in this schema is deleted`);
    }

    // anon must never write, anywhere. The anon key is public.
    if (p.principal === "anon" && p.command !== "SELECT") {
      F("ERROR", "UNEXPECTED_ANON_WRITE", `${at}: anon may ${p.command} — the anon key is in the page source, so this grants the internet`);
    }
    // authenticated must never write a financial table directly.
    if (p.principal === "authenticated" && p.command !== "SELECT" && (model.financialEntities || []).includes(p.entity)) {
      F("ERROR", "UNEXPECTED_AUTHENTICATED_FINANCIAL_WRITE", `${at}: authenticated may ${p.command} a financial table; financial writes are server-mediated`);
    }
    // anon must never read a sensitive or internal table.
    /**
     * A published PRICE is public; a PAYMENT never is. pool_fee_schedule is therefore excluded from the
     * no-anon set while staying in the write-restricted one. Using a single "financial" list here reported
     * the public fee as a violation AND missed an anon read of payments entirely.
     */
    if (p.principal === "anon" && ((model.sensitiveEntities || []).includes(p.entity)
        || (model.internalOnlyEntities || []).includes(p.entity)
        || (model.financialNoAnonEntities || []).includes(p.entity))) {
      F("ERROR", "UNEXPECTED_ANON_READ", `${at}: anon may read ${p.entity}, which carries a person's money, data or internal state`);
    }
    // Append-only tables permit no UPDATE from anyone.
    if ((model.appendOnlyEntities || []).includes(p.entity) && p.command === "UPDATE") {
      F("ERROR", "UPDATE_ON_APPEND_ONLY", `${at}: ${p.entity} is append-only; immutability is what makes the record worth keeping`);
    }
    // An authenticated SELECT on a sensitive table must be ownership-scoped.
    if (p.principal === "authenticated" && p.command === "SELECT"
        && ((model.sensitiveEntities || []).includes(p.entity) || (model.financialEntities || []).includes(p.entity))) {
      const scoped = p.using && ["OWNS_PARTICIPANT", "OWNS_VIA_ENTRY"].includes(p.using.kind);
      const restricted = p.using && ["COLUMN_IS_NULL", "COLUMN_NOT_NULL", "AND"].includes(p.using.kind);
      if (!scoped && !restricted) {
        F("ERROR", "MISSING_OWNERSHIP_PREDICATE",
          `${at}: an authenticated read of ${p.entity} has no ownership or restriction predicate. This is finding DR-1 repeated: a policy that scopes rows without consulting the caller is an allowlist, not authorization.`);
      }
      if (p.using && p.using.kind === "TRUE") {
        F("ERROR", "MISSING_OWNERSHIP_PREDICATE", `${at}: predicate is literally true on a sensitive table`);
      }
    }
    // A suspicious static literal in a predicate is the DR-1 pattern.
    const literals = collectLiterals(p.using).concat(collectLiterals(p.withCheck));
    for (const lit of literals) {
      if (typeof lit === "string" && !/^(true|false)$/i.test(lit) && lit.length <= 12 && /^[a-z0-9]+$/i.test(lit)) {
        F("WARN", "SUSPICIOUS_STATIC_LITERAL",
          `${at}: the predicate compares against a short static identifier. DR-1 established that a policy comparing a column to a fixed value scopes ROWS, not PRINCIPALS.`);
      }
    }
  }

  // Every target entity must have at least one policy, or it is unreachable even by the runtime.
  const covered = new Set(model.policies.map((p) => p.entity));
  const target = targetEntities || [...covered];
  for (const e of target) {
    if (!covered.has(e)) F("ERROR", "TABLE_WITHOUT_POLICY", `${e} has no policy at all; with RLS enabled it is unreachable even by the runtime`);
  }
  for (const e of covered) {
    if (targetEntities && !targetEntities.includes(e)) F("ERROR", "POLICY_FOR_UNKNOWN_TABLE", `${e} has policies but is not a target entity`);
  }

  /**
   * KPLUS-F032. Every column a predicate names must exist on the entity it filters.
   *
   * The lint checked policy NAMES, principals, commands, rationales and coverage — every property of a
   * policy except whether the thing it filters on is real. Two `ranking_snapshots` policies filter on
   * `published_at`, a column no version of that table has ever had, and PostgreSQL rejects `CREATE POLICY`
   * on an unknown column. So the RLS draft aborted partway through, and everything after it in the file —
   * the rest of ranking_snapshots, request_idempotency, sync_state, ties, and the entire privilege
   * section — silently never ran.
   *
   * This is the check that turns "the draft is well-formed" into "the draft can be applied". It is
   * deliberately skipped when the caller supplies no column map, so a caller with only the RLS model can
   * still lint the properties that do not need one.
   */
  if (columnsByEntity) {
    for (const p of model.policies) {
      const cols = columnsByEntity.get(p.entity);
      if (!cols) continue;                                  // POLICY_FOR_UNKNOWN_TABLE already covers this
      for (const [slot, pred] of [["USING", p.using], ["WITH CHECK", p.withCheck]]) {
        for (const col of predicateColumns(pred)) {
          if (!cols.has(col)) {
            F("ERROR", "POLICY_COLUMN_NOT_IN_MODEL",
              `${p.name}: the ${slot} predicate filters on ${p.entity}.${col}, which the target model does not ` +
              `declare. CREATE POLICY refuses an unknown column, so this aborts the RLS draft and every ` +
              `statement after it — policies AND privileges — never runs.`);
          }
        }
      }
    }
  }

  return { findings, ok: !findings.some((f) => f.severity === "ERROR") };
}

function collectLiterals(pred) {
  if (!pred) return [];
  if (pred.kind === "COLUMN_EQUALS") return [pred.value];
  if (pred.operands) return pred.operands.flatMap(collectLiterals);
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Drift detection (WS12.28)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compare the RLS policy model against `access_model.json`.
 *
 * The two are different layers — one declares intent per role, the other declares the policies that
 * implement it — so they can disagree. Detecting that is the point: an access model saying anon may read a
 * table while no policy grants it means the documentation and the implementation have parted company.
 */
export function detectDrift(rlsModel, accessModel) {
  const findings = [];
  const map = rlsModel.meta.principalMapping;
  const inverse = Object.fromEntries(Object.entries(map).filter(([, v]) => !v.startsWith("(")).map(([k, v]) => [v, k]));

  const accessByName = new Map(accessModel.entities.map((e) => [e.name, e]));
  const rlsEntities = new Set(rlsModel.policies.map((p) => p.entity));

  for (const name of accessByName.keys()) {
    if (!rlsEntities.has(name)) findings.push({ severity: "ERROR", code: "ENTITY_WITHOUT_POLICIES", message: `${name} is in the access model but has no RLS policies` });
  }
  for (const name of rlsEntities) {
    if (!accessByName.has(name)) findings.push({ severity: "ERROR", code: "POLICY_ENTITY_NOT_IN_ACCESS_MODEL", message: `${name} has policies but is absent from the access model` });
  }

  for (const [name, ae] of accessByName) {
    for (const [accessRole, perms] of Object.entries(ae.permissions || {})) {
      const rlsPrincipal = inverse[accessRole] ?? accessRole;
      // operator maps to an abstraction with no policies by design; skip it rather than report 21 false drifts.
      if (rlsPrincipal === "operator_context") continue;
      for (const perm of perms) {
        const cmd = perm.endsWith("_OWN") ? "SELECT" : perm;
        const has = rlsModel.policies.some((p) => p.entity === name && p.principal === rlsPrincipal && p.command === cmd);
        if (!has) {
          findings.push({ severity: "ERROR", code: "ACCESS_GRANTED_BUT_NO_POLICY",
            message: `access model grants ${accessRole} ${perm} on ${name}, but no RLS policy implements it — with RLS on, the declared access does not exist` });
        }
      }
    }
    for (const p of rlsModel.policies.filter((x) => x.entity === name)) {
      const accessRole = map[p.principal] ?? p.principal;
      const perms = (ae.permissions || {})[accessRole] || [];
      const declared = perms.map((x) => (x.endsWith("_OWN") ? "SELECT" : x));
      if (!declared.includes(p.command)) {
        findings.push({ severity: "ERROR", code: "POLICY_WITHOUT_ACCESS_DECLARATION",
          message: `policy ${p.name} grants ${p.command} to ${p.principal}, which the access model does not declare for ${accessRole}` });
      }
    }
  }
  return { findings, ok: !findings.some((f) => f.severity === "ERROR") };
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const model = loadRlsModel();
  const DOC = join(ROOT, "docs", "bolao", "db-modernization", "rls-drafts", "TARGET_RLS.draft.sql");

  if (argv.includes("--write")) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(dirname(DOC), { recursive: true });
    writeFileSync(DOC, renderTargetAclSql(model));
    console.log(`  wrote ${DOC.replace(ROOT + "/", "")}`);
    const MATRIX = join(ROOT, "docs", "bolao", "db-modernization", "ACCESS_MATRIX.md");
    writeFileSync(MATRIX, renderMatrixMarkdown(model));
    console.log(`  wrote ${MATRIX.replace(ROOT + "/", "")}`);
    process.exit(0);
  }
  if (argv.includes("--check")) {
    let cur = ""; try { cur = readFileSync(DOC, "utf8"); } catch { cur = ""; }
    const stale = cur !== renderTargetAclSql(model);
    console.log(stale ? "  ✗ stale: TARGET_RLS.draft.sql" : "  ✓ fresh: TARGET_RLS.draft.sql");
    process.exit(stale ? 1 : 0);
  }

  const lint = lintPolicies(model);
  const drift = detectDrift(model, loadAccessModel());
  const m = operationMatrix(model);
  const fp = policyFingerprints(model);

  console.log(`\nTarget RLS model\n`);
  console.log(`  policies: ${model.policies.length}   entities: ${m.entities.length}   principals: ${m.principals.length}`);
  console.log(`  fingerprint rollup: ${fp.rollup.slice(0, 16)}`);
  console.log(`\n  lint:  ${lint.findings.length} finding(s)`);
  for (const f of lint.findings) console.log(`      ${f.severity === "ERROR" ? "✗" : "!"} ${f.code}: ${f.message}`);
  console.log(`  drift: ${drift.findings.length} finding(s)`);
  for (const f of drift.findings) console.log(`      ✗ ${f.code}: ${f.message}`);
  const bad = lint.findings.filter((f) => f.severity === "ERROR").length + drift.findings.length;
  console.log(bad ? `\n✗ ${bad} BLOCKING FINDING(S)\n` : "\n✓ RLS MODEL CLEAN\n");
  process.exit(bad ? 1 : 0);
}
