#!/usr/bin/env node
/**
 * Access-model validator + document generator (Workstreams R and S).
 *
 * WHAT IT ENFORCES, AND WHY EACH RULE EXISTS
 * The anon key is printed in the page source. Every rule below follows from that single fact: anything
 * `anon` is permitted to do, anyone on the internet is permitted to do. So:
 *
 *   · anon may never write anything, anywhere
 *   · anon may never read a table carrying money or contact data
 *   · financial and identity tables are service-only for writes
 *   · audit and attempt tables permit no UPDATE for any role, including service
 *   · every entity covers all 21 modelled tables, so a table cannot be forgotten into being unprotected
 *   · every policy's role appears in that entity's permission map, or the two disagree about reality
 *
 * It also cross-checks against model/target_model.json, so an entity that exists in the schema but not in
 * the access model is an ERROR rather than an omission nobody notices. That omission is exactly how
 * production ended up with grants and policies no migration explains.
 *
 * Usage: node scripts/db/validate_access_model.mjs [--write|--check|--json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadModel } from "./validate_target_model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PATH = join(ROOT, "model", "access_model.json");
const DOC = join(ROOT, "docs", "bolao", "db-modernization", "ACCESS_MODEL.md");

export const ROLES = ["anon", "authenticated", "operator", "service"];
export const COMMANDS = ["SELECT", "INSERT", "UPDATE", "DELETE"];
/** A pseudo-permission meaning "SELECT, but only the caller's own rows via an identity predicate". */
export const OWN_SUFFIX = "_OWN";

/**
 * Two distinct financial sets, because "carries money" is not one property.
 *
 * FINANCIAL_WRITE_SERVICE_ONLY — writes must be server-mediated. Includes the fee schedule: changing a
 *   price is a business decision that must be audited.
 * FINANCIAL_NO_ANON — anon gets nothing at all. Deliberately EXCLUDES pool_fee_schedule: the current
 *   entry fee is a PUBLISHED PRICE, not a person's money, and the app must render it before anyone signs
 *   in. Lumping the two together was my own modelling error, caught by this validator: it would have
 *   forced the price behind a login for no benefit, while a participant's actual payment is the thing
 *   that must never be public.
 */
export const FINANCIAL_WRITE_SERVICE_ONLY = new Set(["payments", "payment_allocations", "prize_allocations", "pool_fee_schedule"]);
export const FINANCIAL_NO_ANON = new Set(["payments", "payment_allocations", "prize_allocations"]);
/** Tables carrying contact data or identity linkage. anon gets nothing. */
export const SENSITIVE_TABLES = new Set(["participants", "participant_identity_links", "pool_entries", "predictions"]);
/** Append-only: no UPDATE for anybody. The exception is stated per table and must be justified. */
export const APPEND_ONLY_TABLES = new Set(["audit_events", "outbox_delivery_attempts", "ranking_snapshots"]);

export function loadAccessModel() { return JSON.parse(readFileSync(PATH, "utf8")); }

export function validateAccessModel(doc, model) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  const byName = new Map(doc.entities.map((e) => [e.name, e]));

  // Coverage against the schema: a table absent from the access model is a table nobody decided about.
  const modelled = model.entities.map((e) => e.name);
  for (const name of modelled) {
    if (!byName.has(name)) E(`${name} exists in target_model.json but has no access model — an undecided table is how production acquired policies no migration explains`);
  }
  for (const e of doc.entities) {
    if (!modelled.includes(e.name)) E(`${e.name} has an access model but is not in target_model.json`);
  }

  for (const e of doc.entities) {
    const at = e.name;
    if (e.rlsEnabled !== true) E(`${at}: rlsEnabled must be true — default deny is the stance`);
    if (typeof e.forceRls !== "boolean") E(`${at}: forceRls must be declared explicitly`);
    if (!e.noDelete) E(`${at}: must state why DELETE is not granted (or what replaces it)`);
    if (!e.notes) E(`${at}: no notes — an access decision with no rationale cannot be reviewed`);

    const perms = e.permissions || {};
    for (const role of ROLES) {
      if (!Array.isArray(perms[role])) { E(`${at}: permissions.${role} must be an array (empty means no access)`); continue; }
      for (const p of perms[role]) {
        const bare = p.endsWith(OWN_SUFFIX) ? p.slice(0, -OWN_SUFFIX.length) : p;
        if (!COMMANDS.includes(bare)) E(`${at}: unknown permission "${p}" for ${role}`);
        if (p.endsWith(OWN_SUFFIX) && bare !== "SELECT") E(`${at}: ${p} — only SELECT has an _OWN variant`);
      }
    }

    // ── the anon rules, all consequences of the key being public ──────────────
    const anon = perms.anon || [];
    const anonWrites = anon.filter((p) => p !== "SELECT" && !p.endsWith(OWN_SUFFIX));
    if (anonWrites.length) {
      E(`${at}: anon is granted ${anonWrites.join(", ")} — the anon key is in the page source, so this grants the internet write access`);
    }
    if (anon.length && (FINANCIAL_NO_ANON.has(at) || SENSITIVE_TABLES.has(at))) {
      E(`${at}: anon has access to a table carrying a person's money or contact data`);
    }

    // ── financial and identity writes are service-only ────────────────────────
    if (FINANCIAL_WRITE_SERVICE_ONLY.has(at) || at === "participant_identity_links") {
      for (const role of ["anon", "authenticated", "operator"]) {
        const writes = (perms[role] || []).filter((p) => ["INSERT", "UPDATE", "DELETE"].includes(p));
        if (writes.length) E(`${at}: ${role} may ${writes.join(", ")} — financial and identity writes must be server-mediated so they are audited, transactional and idempotent`);
      }
    }

    // ── append-only ───────────────────────────────────────────────────────────
    if (APPEND_ONLY_TABLES.has(at)) {
      for (const role of ROLES) {
        if ((perms[role] || []).includes("UPDATE")) E(`${at}: ${role} may UPDATE an append-only table — immutability is the property that makes the record worth keeping`);
      }
    }

    // ── DELETE is never granted to anyone ─────────────────────────────────────
    for (const role of ROLES) {
      if ((perms[role] || []).includes("DELETE")) E(`${at}: ${role} may DELETE — nothing in this schema is deleted; see noDelete`);
    }

    // ── policies must agree with the permission map ────────────────────────────
    for (const p of e.policies || []) {
      if (!p.name || !(p.role || p.roles) || !p.commands || !p.predicate || !p.why) E(`${at}: policy ${p.name || "?"} is incomplete (name, role, commands, predicate, why)`);
      // A policy may name several roles: `TO anon, authenticated` is one PostgreSQL policy, and
      // splitting it into two here would misrepresent what will actually be created.
      const pRoles = Array.isArray(p.roles) ? p.roles : [p.role];
      let unknown = false;
      for (const r of pRoles) if (!ROLES.includes(r)) { E(`${at}: policy ${p.name} names unknown role ${r}`); unknown = true; }
      if (unknown) continue;
      for (const r of pRoles) {
        const declared = new Set((perms[r] || []).map((x) => x.endsWith(OWN_SUFFIX) ? x.slice(0, -OWN_SUFFIX.length) : x));
        for (const c of p.commands) {
          if (!declared.has(c)) E(`${at}: policy ${p.name} grants ${c} to ${r}, which the permission map does not list — the two must not disagree about reality`);
        }
      }
      const ownScoped = pRoles.some((r) => (perms[r] || []).some((x) => x.endsWith(OWN_SUFFIX)));
      if (ownScoped && p.commands.includes("SELECT") && p.predicate === "true") {
        E(`${at}: policy ${p.name} claims _OWN scoping but its predicate is 'true' — this is finding DR-1 all over again, an allowlist masquerading as authorization`);
      }
    }
    // A role with permissions but no policy cannot actually do anything (RLS denies by default).
    for (const role of ROLES) {
      if (role === "operator") continue; // operator authority is R-GAP-1 and lives in the server runtime today
      const has = (perms[role] || []).length > 0;
      const covered = (e.policies || []).some((p) => (Array.isArray(p.roles) ? p.roles : [p.role]).includes(role));
      if (has && !covered) W(`${at}: ${role} has permissions but no policy grants them — with RLS on and no matching policy, access is denied`);
    }
  }

  // ── write contracts (S) ───────────────────────────────────────────────────
  const REQUIRED = ["id", "name", "auth", "validation", "transaction", "idempotency", "audit", "outbox", "errors", "retry", "why"];
  const ids = new Set();
  for (const c of doc.writeContracts) {
    const at = `${c.id} ${c.name}`;
    for (const f of REQUIRED) {
      const v = c[f];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) E(`${at}: missing "${f}"`);
    }
    if (ids.has(c.id)) E(`duplicate contract id ${c.id}`);
    ids.add(c.id);
    if (c.transaction && !/one transaction/i.test(c.transaction)) {
      E(`${at}: transaction boundary is not stated as a single transaction — a contract spanning two commits can leave the audit event without its business change`);
    }
    if (!/audit event/i.test(c.transaction || "")) E(`${at}: the transaction does not include an audit event; an unaudited write is invisible afterwards`);
    if (!Array.isArray(c.errors) || c.errors.length < 2) E(`${at}: fewer than two named error cases — a contract with one failure mode has not been thought through`);
  }
  const required = ["create_entry", "submit_prediction", "record_payment", "allocate_payment", "merge_identity", "reverse_merge", "record_prize", "admin_correction"];
  for (const n of required) {
    if (!doc.writeContracts.some((c) => c.name === n)) E(`missing required write contract: ${n}`);
  }

  // Gaps must be honest: each needs a consequence and a decision.
  for (const g of doc.gaps || []) {
    if (!g.consequence || !g.decision) E(`gap ${g.id}: must state a consequence and a decision`);
  }
  return { errors, warnings };
}

const GEN = "<!-- GENERATED FILE — do not edit by hand. Source: model/access_model.json. Regenerate: node scripts/db/validate_access_model.mjs --write -->";

function render(doc) {
  const L = [GEN, "", "# ACCESS_MODEL — target RLS (R) and Edge write contracts (S)", "",
    "Generated from `model/access_model.json`; enforced by `scripts/db/validate_access_model.mjs`.", "",
    `Status: **${doc.meta.status}**`, "",
    "## Stance", "", doc.meta.stance, "",
    "**Principle.** " + doc.meta.principle, "",
    "**Reads.** " + doc.meta.readModelNote, "",
    "## Roles", "", "| Role | Meaning |", "|---|---|"];
  for (const [r, d] of Object.entries(doc.meta.roles)) L.push(`| \`${r}\` | ${d} |`);
  L.push("", "## Permission matrix", "",
    "`—` means no access at all. `SELECT_OWN` means SELECT restricted by an identity-aware predicate.", "",
    "| Table | FORCE RLS | anon | authenticated | operator | service |", "|---|---|---|---|---|---|");
  for (const e of doc.entities) {
    const c = (r) => (e.permissions[r] || []).join(", ") || "—";
    L.push(`| \`${e.name}\` | ${e.forceRls ? "yes" : "no"} | ${c("anon")} | ${c("authenticated")} | ${c("operator")} | ${c("service")} |`);
  }
  L.push("", "## Per-table detail", "");
  for (const e of doc.entities) {
    L.push(`### \`${e.name}\``, "", `**No DELETE.** ${e.noDelete}`, "", `**Notes.** ${e.notes}`, "");
    if ((e.policies || []).length) {
      L.push("| Policy | Role | Commands | Predicate | Why |", "|---|---|---|---|---|");
      for (const p of e.policies) L.push(`| \`${p.name}\` | ${(Array.isArray(p.roles) ? p.roles : [p.role]).join(", ")} | ${p.commands.join(", ")} | \`${p.predicate}\` | ${p.why} |`);
      L.push("");
    }
  }
  L.push("## Known gaps", "");
  for (const g of doc.gaps || []) {
    L.push(`### ${g.id} — ${g.gap}`, "", `- **Detail.** ${g.detail}`, `- **Consequence.** ${g.consequence}`, `- **Decision.** ${g.decision}`, "");
  }
  L.push("## Write contracts", "");
  for (const c of doc.writeContracts) {
    L.push(`### ${c.id} — \`${c.name}\``, "", `**Why.** ${c.why}`, "", "| | |", "|---|---|",
      `| Auth | ${c.auth} |`,
      `| Validation | ${c.validation.map((v) => `\`${v}\``).join("<br>")} |`,
      `| Transaction | ${c.transaction} |`,
      `| Idempotency | ${c.idempotency} |`,
      `| Audit event | ${c.audit} |`,
      `| Outbox | ${c.outbox} |`,
      `| Errors | ${c.errors.map((e) => `\`${e}\``).join(", ")} |`,
      `| Retry | ${c.retry} |`, "");
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

function main() {
  const argv = process.argv.slice(2);
  const doc = loadAccessModel();
  const { errors, warnings } = validateAccessModel(doc, loadModel());

  if (argv.includes("--write")) {
    if (errors.length) { console.error("refusing to generate from an invalid access model:"); for (const e of errors) console.error(`  ✗ ${e}`); return 1; }
    writeFileSync(DOC, render(doc)); console.log(`  wrote ${DOC.replace(ROOT + "/", "")}`); return 0;
  }
  if (argv.includes("--check")) {
    let cur = ""; try { cur = readFileSync(DOC, "utf8"); } catch { cur = ""; }
    const stale = cur !== render(doc);
    console.log(stale ? `  ✗ stale: ${DOC.replace(ROOT + "/", "")}` : `  ✓ fresh: ${DOC.replace(ROOT + "/", "")}`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    console.log(stale || errors.length ? "\n✗ ACCESS MODEL STALE OR INVALID\n" : "\n✓ access model doc is up to date\n");
    return stale || errors.length ? 1 : 0;
  }
  if (argv.includes("--json")) { console.log(JSON.stringify({ entities: doc.entities.length, contracts: doc.writeContracts.length, errors, warnings }, null, 2)); return errors.length ? 1 : 0; }

  console.log(`\nAccess model: ${doc.entities.length} entities, ${doc.writeContracts.length} write contracts, ${doc.gaps.length} gaps\n`);
  for (const w of warnings) console.log(`  ! ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  console.log(errors.length ? "✗ ACCESS MODEL INVALID\n" : "✓ ACCESS MODEL VALID\n");
  return errors.length ? 1 : 0;
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) { try { process.exit(main()); } catch (e) { console.error(`runner error: ${e.message}`); process.exit(2); } }
