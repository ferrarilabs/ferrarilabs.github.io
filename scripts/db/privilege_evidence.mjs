#!/usr/bin/env node
/**
 * PRIVILEGE EVIDENCE — the measurements the privilege model reconciles against.
 *
 * Separated from `privilege_model.mjs` on purpose: the model is intent and stays pure, this file is
 * observation and carries a date and a provenance for every row. Mixing them is how "production currently
 * does X" quietly becomes "X is correct".
 *
 * TWO DIFFERENT KINDS OF EVIDENCE LIVE HERE, AND THEY ARE NOT INTERCHANGEABLE:
 *
 *   PRODUCTION   measured 2026-08-11 in an authorized read-only window, on the `public` schema.
 *   LOCAL        measured on the local rehearsal cluster, on the `bolao` target schema. Production has
 *                NO target schema — none of it is deployed — so a local measurement is the only
 *                measurement that can exist, and it is labelled as such rather than presented as a
 *                production fact. This is the KPLUS-F039/F012/F055 lesson applied pre-emptively.
 *
 * COVERAGE IS PARTIAL AND THE GAPS ARE EXPLICIT. The production probe read four privileges
 * (SELECT/INSERT/UPDATE/DELETE), so TRUNCATE, REFERENCES and TRIGGER are UNMEASURED for every production
 * relation. `PRODUCTION_PRIVILEGES_MEASURED` names the four; anything outside that list must reconcile as
 * UNKNOWN_BLOCKING rather than as absent.
 */

/** The four privileges PROBE-4 and the view probe actually read. Everything else is unmeasured. */
export const PRODUCTION_PRIVILEGES_MEASURED = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]);
export const ALL_TABLE_PRIVILEGES = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]);
export const UNMEASURED_IN_PRODUCTION = Object.freeze(ALL_TABLE_PRIVILEGES.filter((p) => !PRODUCTION_PRIVILEGES_MEASURED.includes(p)));

const CRUD = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/**
 * Production `public`, measured 2026-08-11.
 *
 * `inheritedOnly` marks relations whose browser privileges came from Supabase's blanket default rather
 * than from any SQL anyone wrote — the views are the proven case (their source files grant only SELECT),
 * and it changes the diff class from EXPECTED_REVOKE to PLATFORM_DEFAULT because the remedy differs.
 */
export const PRODUCTION_RELATIONS = Object.freeze([
  Object.freeze({ name: "bolao_state", objectClass: "TABLE", scope: "PRODUCTION",
    anon: CRUD, authenticated: CRUD, service_role: CRUD }),
  Object.freeze({ name: "bolao_entry_private", objectClass: "TABLE", scope: "PRODUCTION",
    anon: [], authenticated: CRUD, service_role: CRUD,
    note: "F10 stage 1 revoked anon explicitly — the one relation in public where somebody overrode the platform default on purpose" }),
  Object.freeze({ name: "bolao_notif_jobs", objectClass: "TABLE", scope: "PRODUCTION", inheritedOnly: true,
    anon: CRUD, authenticated: CRUD, service_role: CRUD,
    note: "shared/sql/010 grants nothing to anon; anon's CRUD is the platform default" }),
  Object.freeze({ name: "live_sports_cache", objectClass: "TABLE", scope: "PRODUCTION",
    anon: ["SELECT"], authenticated: CRUD, service_role: CRUD,
    note: "shared/sql/011 explicitly revoked anon's writes — the second deliberate override" }),
  ...["lottery_admin_audit", "lottery_draws", "lottery_participants", "lottery_participations",
    "lottery_payment_transactions", "lottery_pools"].map((n) =>
    Object.freeze({ name: n, objectClass: "TABLE", scope: "PRODUCTION", inheritedOnly: true,
      anon: CRUD, authenticated: CRUD, service_role: CRUD, product: "POWERBALL" })),
  Object.freeze({ name: "bolao_state_public", objectClass: "VIEW", scope: "PRODUCTION", inheritedOnly: true,
    anon: CRUD, authenticated: CRUD, service_role: CRUD,
    note: "shared/sql/015 grants SELECT only. The write half is the platform default, and NIGHT-27 proved it reaches bolao_state — KPLUS-F058" }),
  Object.freeze({ name: "bolao_state_public_cdb", objectClass: "VIEW", scope: "PRODUCTION", inheritedOnly: true,
    anon: CRUD, authenticated: CRUD, service_role: CRUD,
    note: "shared/sql/024 grants SELECT only; same platform default, same bypass" }),
]);

/** Provider-managed relations in `public`. None today — recorded so the class is not silently empty. */
export const PROVIDER_RELATIONS = Object.freeze([]);

/**
 * The normalized target schema, measured on the local rehearsal cluster.
 *
 * Every one grants NOTHING to anon, authenticated or service_role — the migration drafts never issued a
 * GRANT. For the browser roles that is exactly the target policy. For `service_role` it is a real gap:
 * the trusted runtime is supposed to write these tables and currently cannot, which the M10 lab has been
 * recording as "measures where it starts from, not where it ends". The reconciliation turns that
 * observation into an EXPECTED_GRANT with generated SQL.
 */
export const TARGET_RELATIONS = Object.freeze([
  "classification_snapshots", "competition_edition_phases", "competition_edition_standings",
  "competition_editions", "competitions", "match_results", "matches", "outbox_delivery_attempts",
  "outbox_events", "participant_identity_links", "participants", "payment_allocations", "payments",
  "pool_entries", "pool_fee_schedule", "pools", "predictions", "prize_allocations", "ranking_snapshots",
  "request_idempotency", "sync_state", "ties",
].map((n) => Object.freeze({
  name: `bolao.${n}`, objectClass: "TABLE", scope: "LOCAL_TARGET_SCHEMA",
  anon: [], authenticated: [], service_role: [],
  note: "measured on the local rehearsal cluster; production has no target schema, so no production measurement can exist",
})));

export const MEASURED_RELATIONS = Object.freeze([...PRODUCTION_RELATIONS, ...PROVIDER_RELATIONS, ...TARGET_RELATIONS]);

/**
 * Flatten to `{relation, role, privileges}` rows for `reconcile()`.
 *
 * A relation is reported ONLY for the privileges that were actually read. Because production was measured
 * on four of seven, a production row's privilege list is complete for CRUD and silent about the rest —
 * `reconcile()` sees a value and treats it as measured, which is correct for CRUD and would be wrong if
 * the target policy ever asked about TRUNCATE. `unmeasuredProductionPairs()` is what keeps that honest.
 */
export function measuredPrivileges() {
  const out = [];
  for (const r of MEASURED_RELATIONS) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      if (!Object.prototype.hasOwnProperty.call(r, role)) continue;
      out.push({ relation: r.name, role, privileges: r[role] });
    }
  }
  return out;
}

/**
 * The pairs whose UNMEASURED privileges could hide a real exposure.
 *
 * TRIGGER is the sharp one: it lets a principal attach code to a table it does not own, and that code
 * runs for every writer. Nobody has ever read whether anon holds it in production.
 */
export function unmeasuredProductionPairs() {
  const out = [];
  for (const r of PRODUCTION_RELATIONS) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      out.push({ relation: r.name, role, unmeasured: [...UNMEASURED_IN_PRODUCTION],
        why: "PROBE-4 and the view probe read SELECT/INSERT/UPDATE/DELETE only" });
    }
  }
  return out;
}
