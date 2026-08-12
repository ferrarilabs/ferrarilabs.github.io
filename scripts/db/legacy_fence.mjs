#!/usr/bin/env node
/**
 * WS5-F4 — the legacy write fence, as a derivable artefact.
 *
 * WHAT THE FENCE IS
 * `CUTOVER_RUNBOOK.md` step 11: "REVOKE direct write on the legacy document from anon". It is the point
 * at which the browser stops being able to write `public.bolao_state` directly, so that everything after
 * it — the final reconciliation, the read cutover, the M16 decomposition — runs against a source that has
 * stopped moving.
 *
 * WHY IT HAD TO BE A PRIVILEGE AND NOT A FLAG
 * `model/migration_choreography.json` states it plainly: *"The fence itself is a database privilege
 * denial, because a stale tab holds the anon key and never re-reads this flag. Treating the flag as the
 * fence is the FS-4 mistake."* A feature flag asks the client to stop. A REVOKE stops it.
 *
 * WHY THIS FILE EXISTS
 * Go/no-go gate GNG-10 — *"is the legacy-document write-denial mechanism designed and modelled?"* — read
 * **NO**, recorded as open blocker WS5-F4. The mechanism was described in prose in three places and
 * existed as an artefact in none, so nothing could generate it, verify it was applied correctly, or
 * reverse it. This is that artefact.
 *
 * THE FOUR RULES THE MODEL ALREADY FIXED, restated here because they constrain every function below:
 *   1. "REVOKE the specific privilege on the specific table — never a wildcard, never REVOKE ALL."
 *   2. Reads survive. Step 11 precedes step 13, so the application still READS the legacy document after
 *      the fence closes. A fence that took SELECT would be a read outage in the middle of a cutover.
 *   3. Rollback is "a GRANT, not a flag flip" — one statement, and it is generated here too.
 *   4. Legacy POLICIES are not modified. *"existing legacy policies are NOT modified while any client
 *      still reads the legacy document"*. The fence removes the privilege; the policies stay exactly as
 *      they are, both because dropping them is not reversible without re-authoring their text and
 *      because they are evidence of what the old application was allowed to do.
 *
 * BOUNDARY: this module builds SQL text and interprets a catalog read. It opens no connection and names
 * no database.
 */

/** The legacy schema. Named once so no statement below can drift onto another one. */
export const LEGACY_SCHEMA = "public";

/**
 * The legacy document, and the nine other tables that share `public` with it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * KPLUS-F055 — THIS LIST WAS WRONG, AND THE VERIFIER IS WHAT CAUGHT IT.
 *
 * Until 2026-08-11 this list held seven tables, measured on the RESTORED BASELINE. The authorized
 * production read then ran the fence's own `fenceVerifySql()` against production and fed the result to
 * `fenceFailures(rows, 'BEFORE_FENCE')`. It returned three failures, all reading *"exists in public but is
 * not in LEGACY_TABLES — a new legacy table appeared and nobody decided whether the fence covers it"*.
 *
 * Production has TEN tables in `public`. The closed-set design is what turned a silent omission into a
 * loud one, and it is the reason the fence was not applied at cutover step 11 against a schema it did not
 * describe. It is worth being precise about what the failure was: not that the fence was wrong about the
 * tables it knew, but that its evidence base was the restore, and the restore is not production. That is
 * the same root cause as KPLUS-F039 and KPLUS-F012.
 *
 * The three additions have clean provenance — on branch `main`, which this branch has never contained
 * (KPLUS-F057, ADR-K10). An earlier reading of this finding said they "appeared outside the migration
 * path" with no provenance; that was wrong, and it was wrong because the search was run against the
 * working tree instead of `git log --all`. There are TWO migration channels writing one production
 * database: `supabase/migrations/` here, and a hand-numbered `bolao/shared/sql/NNN_*.sql` series on
 * `main`. The product team knew about this programme and worked around it deliberately; nothing told this
 * programme about them.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY ONLY `bolao_state` IS STILL FENCED
 *
 * The fence exists to stop the browser writing THE DOCUMENT THIS MIGRATION REPLACES while the cutover is
 * in flight. It is not a general-purpose privilege cleanup, and widening it to "every table anon can
 * write" would silently fold a security decision into a cutover step. Each addition is classified on
 * measured privilege reality, and the reason it is not fenced is recorded next to it:
 *
 *   · `bolao_entry_private`  anon holds NOTHING on it (measured). There is no anon write to fence, so
 *                            fencing it would be a no-op the verifier would then flag as one.
 *   · `live_sports_cache`    anon holds SELECT only (measured). Same: no write to remove.
 *   · `bolao_notif_jobs`     anon holds full INSERT/UPDATE/DELETE. This IS a real exposure — but it is not
 *                            the document the cutover migrates, and revoking it is a security decision
 *                            with its own blast radius (it may be how the notification queue is fed).
 *                            Escalated as KPLUS-F057 rather than fenced as a side effect of a bolão
 *                            cutover. `unfencedExposure()` reports it so it cannot be forgotten.
 */
export const LEGACY_TABLES = Object.freeze([
  Object.freeze({ name: "bolao_state", role: "MIGRATION_SUBJECT", product: "BOLAO", fenced: true,
    why: "the bolão document this migration replaces — the fence's whole purpose" }),
  Object.freeze({ name: "bolao_entry_private", role: "TARGET_ENTITY", product: "BOLAO", fenced: false,
    origin: "main 727e785 · bolao/shared/sql/015_f10_private_pii_and_public_projection.sql",
    why: "F10 stage 1 moved participant PII (e-mail, payer name, payment method) out of bolao_state, where the public anon key could enumerate it. Classified TARGET_ENTITY because it holds exactly what M2/M4 model — but NOT added to the normalized target here: that is a modelling change requiring reconciliation (ADR-K10). anon holds no privilege on it, so there is no browser write for the fence to remove" }),
  Object.freeze({ name: "bolao_notif_jobs", role: "DEFERRED_WITH_REASON", product: "BOLAO", fenced: false,
    origin: "main 876918d · bolao/shared/sql/010_notification_durability.sql",
    why: "a working production notification outbox with leases, idempotency and retry, carrying an OPAQUE entry_ref and never an address. Deferred rather than classified because M9 designs ANOTHER outbox: two live designs for one concern is an architectural decision, not a classification. anon holds full CRUD — a real exposure (RLS state unread) — but it is not the migration subject, and revoking it is a security decision, not a cutover step" }),
  Object.freeze({ name: "live_sports_cache", role: "LEGACY_ONLY", product: "INFRASTRUCTURE", fenced: false,
    origin: "main 41496b4 · applied via `supabase db query`; its DDL is in NO file in version control",
    why: "shared ESPN cache for PUBLIC sports data, deliberately separated from bolao_state, degrading to source on failure. Nothing in the money or scoring spine touches it, so it is not a target entity. anon holds SELECT only, so there is no browser write for the fence to remove" }),
  Object.freeze({ name: "lottery_admin_audit", role: "OTHER_PRODUCT", product: "POWERBALL", fenced: false, why: "Powerball; outside this migration" }),
  Object.freeze({ name: "lottery_draws", role: "OTHER_PRODUCT", product: "POWERBALL", fenced: false, why: "Powerball; outside this migration" }),
  Object.freeze({ name: "lottery_participants", role: "OTHER_PRODUCT", product: "POWERBALL", fenced: false, why: "Powerball; outside this migration" }),
  Object.freeze({ name: "lottery_participations", role: "OTHER_PRODUCT", product: "POWERBALL", fenced: false, why: "Powerball; outside this migration" }),
  Object.freeze({ name: "lottery_payment_transactions", role: "OTHER_PRODUCT", product: "POWERBALL", fenced: false, why: "Powerball; outside this migration" }),
  Object.freeze({ name: "lottery_pools", role: "OTHER_PRODUCT", product: "POWERBALL", fenced: false, why: "Powerball; outside this migration" }),
]);

/**
 * The VIEW surface — and the reason KPLUS-F058 is a fence defect and not a documentation gap.
 *
 * Every probe this campaign ran filtered `relkind = 'r'`, so no artefact here had ever seen a view.
 * `fenceVerifySql()` filtered it too, which means the fence's own verifier was structurally incapable of
 * reporting what follows.
 *
 * Production carries TWO views over `public.bolao_state`, and **anon holds SELECT, INSERT, UPDATE and
 * DELETE on both**. Their source files on `main` grant only SELECT; the write half comes from Supabase's
 * blanket default privileges on `public`, which apply to every relation created in that schema — nobody
 * chose it and nothing recorded it.
 *
 * NIGHT-27 proved on real PostgreSQL what that costs. After the fence revokes anon's writes on the TABLE:
 *
 *   · `UPDATE public.bolao_state_public SET updated_at = now()` — **succeeds, 1 row**
 *   · `DELETE FROM public.bolao_state_public WHERE id = ...`     — **succeeds, 1 row**
 *
 * Both write the underlying `bolao_state`. Two mechanisms line up: the views are auto-updatable on their
 * simple column references (`id`, `updated_at`), and `security_invoker` is off, so a view executes with
 * its OWNER's privileges — which the fence never touched. RLS does not intervene because the table is
 * ENABLE, not FORCE, and the owner is exempt.
 *
 * So the fence closed the front door, the side door stayed open, and the verifier reported success
 * because it was reading `relkind = 'r'`. A privilege denial that can be routed around is not a denial.
 *
 * The views ARE fenced for writes and keep SELECT. That is not the same decision as for the unfenced
 * tables: these views are a projection OF THE MIGRATION SUBJECT ITSELF, so a write through them is a
 * write to the document the cutover is trying to hold still. Their read role is real and must survive —
 * they are how the browser gets state with the PII stripped out.
 */
export const LEGACY_VIEWS = Object.freeze([
  Object.freeze({ name: "bolao_state_public", relkind: "v", role: "PUBLIC_READ_SURFACE", product: "BOLAO", fenced: true,
    origin: "main 727e785 · bolao/shared/sql/015_f10_private_pii_and_public_projection.sql",
    dependsOn: Object.freeze(["public.bolao_state"]),
    why: "the PII-stripped projection of the whole document — strips participantEmail, payerName, paymentMethod and paymentTo from every entry. It is the browser's intended read path under F10, so SELECT must survive; but it projects the MIGRATION SUBJECT, and anon's inherited INSERT/UPDATE/DELETE on it write straight through to bolao_state (NIGHT-27). NOT obsolete: retiring it requires the clients to have moved to the target read path AND F10's remaining stages to have landed" }),
  Object.freeze({ name: "bolao_state_public_cdb", relkind: "v", role: "PUBLIC_READ_SURFACE", product: "BOLAO", fenced: true,
    origin: "main 544b4a1 · bolao/shared/sql/024_cdb2026_public_projection.sql",
    dependsOn: Object.freeze(["public.bolao_state"]),
    why: "the same projection narrowed to id = 'cdb2026' and stripping txId as well. CDB2026 is IN PRODUCTION, so this is a live read path and SELECT must survive. Same inherited write grants, same bypass" }),
]);

/**
 * Every legacy relation the fence reasons about, tables and views together.
 *
 * The split exists because they are DIFFERENT KINDS with different rules — a view has no RLS of its own
 * and carries its owner's authority — but the fence has to consider them as one surface, because an
 * attacker does not care which relkind the write goes through.
 */
export const LEGACY_RELATIONS = Object.freeze([...LEGACY_TABLES, ...LEGACY_VIEWS]);

/**
 * The BEFORE matrix, as production actually measured on 2026-08-11 — not as the restored baseline had it.
 *
 * This is the fence's evidence base, and it is a RECORD OF A MEASUREMENT: `[table, role, sel, ins, upd,
 * del]`, the exact row shape `fenceVerifySql()` returns, so it can be diffed against a live read without
 * reshaping. `productionDrift()` is what compares them.
 *
 * It exists so the fence's expected BEFORE and AFTER states are derived from production rather than
 * assumed, and so that the next time production drifts, the drift is a failing check rather than a
 * surprise at step 11.
 */
export const MEASURED_PRODUCTION_PRIVILEGES = Object.freeze([
  Object.freeze(["bolao_entry_private", "anon", "f", "f", "f", "f"]),
  Object.freeze(["bolao_entry_private", "authenticated", "t", "t", "t", "t"]),
  Object.freeze(["bolao_entry_private", "service_role", "t", "t", "t", "t"]),
  Object.freeze(["bolao_notif_jobs", "anon", "t", "t", "t", "t"]),
  Object.freeze(["bolao_notif_jobs", "authenticated", "t", "t", "t", "t"]),
  Object.freeze(["bolao_notif_jobs", "service_role", "t", "t", "t", "t"]),
  Object.freeze(["bolao_state", "anon", "t", "t", "t", "t"]),
  Object.freeze(["bolao_state", "authenticated", "t", "t", "t", "t"]),
  Object.freeze(["bolao_state", "service_role", "t", "t", "t", "t"]),
  Object.freeze(["live_sports_cache", "anon", "t", "f", "f", "f"]),
  Object.freeze(["live_sports_cache", "authenticated", "t", "t", "t", "t"]),
  Object.freeze(["live_sports_cache", "service_role", "t", "t", "t", "t"]),
  ...["lottery_admin_audit", "lottery_draws", "lottery_participants", "lottery_participations",
    "lottery_payment_transactions", "lottery_pools"].flatMap((t) =>
    ["anon", "authenticated", "service_role"].map((r) => Object.freeze([t, r, "t", "t", "t", "t"]))),
  // KPLUS-F058 — the VIEWS, measured 2026-08-11. Their source files grant only SELECT; the write half is
  // Supabase's blanket default privilege on `public`. NIGHT-27 proves those writes reach bolao_state.
  ...["bolao_state_public", "bolao_state_public_cdb"].flatMap((v) =>
    ["anon", "authenticated", "service_role"].map((r) => Object.freeze([v, r, "t", "t", "t", "t"]))),
]);
export const MEASURED_PRODUCTION_AT = "2026-08-11";

/**
 * The closed classification vocabulary for a legacy table (KPLUS-F057 / ADR-K10).
 *
 * `DEFERRED_WITH_REASON` is a real member and not an escape hatch: `bolao_notif_jobs` is a WORKING
 * production outbox while M9 designs another one, and forcing that into TARGET_ENTITY or LEGACY_ONLY
 * would record an architectural decision nobody has taken. A vocabulary with no way to say "this needs a
 * decision" produces classifications that are wrong rather than absent.
 */
export const TABLE_ROLES = Object.freeze([
  "MIGRATION_SUBJECT", "TARGET_ENTITY", "LEGACY_ONLY", "OTHER_PRODUCT", "PROVIDER_MANAGED", "DEFERRED_WITH_REASON",
]);

/**
 * The AFTER matrix the fence is expected to produce, DERIVED from the measured BEFORE rather than written
 * out by hand.
 *
 * Deriving it is the point: a hand-written AFTER matrix can agree with a hand-written fence while both
 * are wrong about production. This applies the fence's own rule — remove WRITE_PRIVILEGES from
 * FENCED_ROLES on fenced tables, change nothing else — to the measured reality, so the expectation and
 * the statements have one source.
 */
export function expectedAfterFence(before = MEASURED_PRODUCTION_PRIVILEGES) {
  return before.map((row) => {
    const [name, role, sel, ins, upd, del] = row;
    const t = LEGACY_RELATIONS.find((x) => x.name === name);
    if (!t || !t.fenced || !FENCED_ROLES.includes(role)) return Object.freeze([name, role, sel, ins, upd, del]);
    // SELECT is preserved deliberately — step 11 precedes the read cutover at step 13.
    return Object.freeze([name, role, sel, "f", "f", "f"]);
  });
}

/**
 * Has production drifted from the matrix the fence was generated against?
 *
 * Returns one finding per difference, in both directions. This is the check that would have caught F055
 * on the day the three tables appeared, instead of at the cutover.
 */
export function productionDrift(observedRows, measured = MEASURED_PRODUCTION_PRIVILEGES) {
  const norm = (rows) => new Map((rows ?? []).map((r) => {
    const a = Array.isArray(r) ? r : [r.relname, r.rolname, r.sel, r.ins, r.upd, r.del];
    const b = (v) => (v === true || v === "t" || v === "true") ? "t" : "f";
    return [`${a[0]}|${a[1]}`, [b(a[2]), b(a[3]), b(a[4]), b(a[5])].join("")];
  }));
  const obs = norm(observedRows), exp = norm(measured);
  if (obs.size === 0) return ["the privilege read returned nothing — drift cannot be assessed against no rows"];
  const out = [];
  for (const [k, v] of exp) {
    if (!obs.has(k)) out.push(`${k.replace("|", " / ")} was measured on ${MEASURED_PRODUCTION_AT} and is absent now — the table or the role is gone`);
    else if (obs.get(k) !== v) out.push(`${k.replace("|", " / ")} changed since ${MEASURED_PRODUCTION_AT}: measured sel/ins/upd/del=${v}, observed=${obs.get(k)}`);
  }
  for (const k of obs.keys()) {
    if (!exp.has(k)) out.push(`${k.replace("|", " / ")} exists now and was not present on ${MEASURED_PRODUCTION_AT} — the legacy surface grew again`);
  }
  return out;
}

/** The write privileges. DELETE is included: the fence denies writing, and a delete is a write. */
export const WRITE_PRIVILEGES = Object.freeze(["INSERT", "UPDATE", "DELETE"]);
/** Preserved, deliberately and by name. Step 11 precedes the read cutover at step 13. */
export const PRESERVED_PRIVILEGES = Object.freeze(["SELECT"]);

/**
 * Who the fence denies.
 *
 * `anon` is the point of the exercise: the key is in the page source, so anything anon may do, anyone on
 * the internet may do. `authenticated` is included even though it cannot write today — every policy on
 * `bolao_state` is `TO anon`, so RLS already denies it — because the GRANT is real and would become live
 * the moment anyone adds a policy. Revoking a privilege that is currently inert is the KPLUS-F023 lesson:
 * it is the standing grant, not today's reachability, that decides what the next mistake costs.
 *
 * `service_role` is NOT fenced. It mirrors writes into the legacy document until LEGACY_FROZEN at step
 * 19, so revoking it here would break the mirroring the parity harness measures.
 */
export const FENCED_ROLES = Object.freeze(["anon", "authenticated"]);
export const UNFENCED_ROLES = Object.freeze([
  Object.freeze({ role: "service_role", why: "mirrors writes into the legacy document until LEGACY_FROZEN (step 19); fencing it here breaks the mirror the parity harness measures" }),
]);

const fencedTables = () => LEGACY_RELATIONS.filter((t) => t.fenced);
const rel = (t) => `${LEGACY_SCHEMA}.${t}`;

/**
 * Did (table, role) hold any write privilege in the baseline? Used by the over-reach check so that
 * "no writes now" is only a finding when there were writes to lose.
 *
 * An unknown pair returns TRUE — conservative on purpose. If the baseline has never seen this table, the
 * safe reading is that a missing write MIGHT be over-reach and should be reported, rather than assuming
 * the absence is natural. Under-reporting is the failure mode that hides a broken fence.
 */
function baselineWrites(baseline, relname, rolname) {
  const row = (baseline ?? []).find((r) => {
    const a = Array.isArray(r) ? r : [r.relname, r.rolname, r.sel, r.ins, r.upd, r.del];
    return a[0] === relname && a[1] === rolname;
  });
  if (!row) return true;
  const a = Array.isArray(row) ? row : [row.relname, row.rolname, row.sel, row.ins, row.upd, row.del];
  return [a[3], a[4], a[5]].some((v) => v === true || v === "t" || v === "true");
}

/**
 * The fence, as SQL.
 *
 * One REVOKE per (table, role) pair with the privileges named explicitly. Not `REVOKE ALL`, not a
 * wildcard on the schema, and not one statement covering both roles — a per-role statement is what makes
 * a partially-applied fence visible in the verifier rather than ambiguous.
 */
export function renderFenceSql() {
  const L = [];
  L.push("-- NOT FOR PRODUCTION APPLY");
  L.push("-- LEGACY WRITE FENCE — CUTOVER_RUNBOOK step 11 (WS5-F4)");
  L.push("-- GENERATED FILE — do not edit by hand. Source: scripts/db/legacy_fence.mjs");
  L.push("-- Regenerate: node scripts/db/legacy_fence.mjs --write");
  L.push("--");
  L.push("-- This closes the direct browser write path to the legacy document. Everything after it — the");
  L.push("-- final reconciliation, the read cutover, the M16 decomposition — depends on the source having");
  L.push("-- stopped moving, and this is what stops it.");
  L.push("--");
  L.push("-- PRECONDITIONS, all of which the runbook already requires (do not apply this without them):");
  L.push("--   1. server_writes_enabled=on and the canary widened to SERVER_WRITE_PRIMARY (step 9)");
  L.push("--      — WS5-INV-2: the fence may only close once a working replacement write path exists for");
  L.push("--      every operation it denies.");
  L.push("--   2. minimum_write_version raised AND the CLIENT_TOO_OLD refusal proven distinguishable from");
  L.push("--      a transient error (step 10) — FR-5 / staleClientFenceReady. A fence that denies before");
  L.push("--      the refusal path works gives open tabs an opaque error they retry forever.");
  L.push("--   3. legacy_writes_allowed=false is deployed. That flag is NOT the fence; it renders a clear");
  L.push("--      message instead of an opaque one. Treating it AS the fence is the FS-4 mistake.");
  L.push("--");
  L.push("-- WHAT THIS DELIBERATELY DOES NOT DO:");
  L.push("--   · It does not touch SELECT. Step 11 precedes the read cutover at step 13, so the");
  L.push("--     application still reads this document afterwards.");
  L.push("--   · It does not touch the policies. 'Existing legacy policies are NOT modified while any");
  L.push("--     client still reads the legacy document' — and a dropped policy cannot be restored");
  L.push("--     without re-authoring its text, which is not a rollback.");
  L.push("--   · It does not touch service_role, which mirrors into this document until step 19.");
  L.push("--   · It does not use REVOKE ALL or a wildcard, per the choreography's ACL rule.");
  L.push("");
  for (const t of fencedTables()) {
    L.push(`-- ${rel(t.name)} — ${t.why}`);
    for (const role of FENCED_ROLES) {
      L.push(`REVOKE ${WRITE_PRIVILEGES.join(", ")} ON TABLE ${rel(t.name)} FROM ${role};`);
    }
  }
  L.push("");
  L.push("-- Verify immediately. The expected end state is: no fenced role holds any write privilege on");
  L.push("-- the document, every fenced role still holds SELECT, and service_role is unchanged.");
  L.push(`-- ${fenceVerifySql().split("\n").join("\n-- ")}`);
  return L.join("\n") + "\n";
}

/**
 * The rollback. "Fence rollback — a GRANT, not a flag flip."
 *
 * It restores exactly what the fence removed and nothing else, which is why it is generated from the
 * same two constants rather than written out: a rollback that grants a privilege the fence did not take
 * is how a cutover ends with the browser holding more than it started with.
 */
export function renderFenceRollbackSql() {
  const L = [];
  L.push("-- NOT FOR PRODUCTION APPLY");
  L.push("-- LEGACY WRITE FENCE — ROLLBACK (WS5-F4)");
  L.push("-- GENERATED FILE — do not edit by hand. Source: scripts/db/legacy_fence.mjs");
  L.push("--");
  L.push("-- Reopens the direct browser write path. This is the documented reversal of step 11 and it is");
  L.push("-- one statement per (table, role) — the same pairs the fence closed, and no others.");
  L.push("--");
  L.push("-- Reversing the fence does NOT reverse the cutover. Writes that the replacement path accepted");
  L.push("-- while the fence was closed are in the target schema; reopening the legacy path means both");
  L.push("-- representations take writes again, which is the state the parity harness measures and the");
  L.push("-- state the fence exists to end. Reopen to restore service, then close again deliberately.");
  L.push("");
  for (const t of fencedTables()) {
    for (const role of FENCED_ROLES) {
      L.push(`GRANT ${WRITE_PRIVILEGES.join(", ")} ON TABLE ${rel(t.name)} TO ${role};`);
    }
  }
  return L.join("\n") + "\n";
}

/**
 * One query returning the effective privilege of every app role on every legacy table.
 *
 * `has_table_privilege` is the server's own answer, so the verifier compares intent against PostgreSQL
 * rather than against the SQL that was generated from the intent. Every legacy table is read, not only
 * the fenced one: a fence that also closed something it should not have is a failure, and a verifier
 * that only looks where it expects to find its own work cannot see that.
 */
export const fenceVerifySql = () => `SELECT c.relname,
       r.rolname,
       has_table_privilege(r.rolname, c.oid, 'SELECT') AS sel,
       has_table_privilege(r.rolname, c.oid, 'INSERT') AS ins,
       has_table_privilege(r.rolname, c.oid, 'UPDATE') AS upd,
       has_table_privilege(r.rolname, c.oid, 'DELETE') AS del
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) r
 WHERE n.nspname = '${LEGACY_SCHEMA}' AND c.relkind IN ('r', 'v', 'm')
 ORDER BY c.relname, r.rolname`;

/** Phases the verifier can be asked about. */
export const PHASE = Object.freeze({ BEFORE: "BEFORE_FENCE", AFTER: "AFTER_FENCE" });

/**
 * Interpret `fenceVerifySql()` for a phase. Empty array means the observed state is the expected one.
 *
 * Rows are `[relname, rolname, sel, ins, upd, del]` with booleans as `t`/`f` (psql) or real booleans.
 *
 * BEFORE is checked as well as AFTER, and that is not symmetry for its own sake: if the document is
 * already unwritable before the fence runs, then either the fence was applied twice, or something else
 * closed the path, and in both cases "the fence worked" would be a false reading of an unchanged state.
 */
export function fenceFailures(rows, phase = PHASE.AFTER, baseline = MEASURED_PRODUCTION_PRIVILEGES) {
  const out = [];
  const b = (v) => v === true || v === "t" || v === "true";
  const list = (Array.isArray(rows) ? rows : []).map((r) =>
    Array.isArray(r) ? { relname: r[0], rolname: r[1], sel: r[2], ins: r[3], upd: r[4], del: r[5] } : r);

  if (list.length === 0) return ["the legacy privilege read returned nothing — a fence cannot be verified against no rows"];

  const seenTables = new Set(list.map((r) => r.relname));
  for (const t of LEGACY_RELATIONS) {
    if (!seenTables.has(t.name)) out.push(`${rel(t.name)} is missing from the catalog read — the legacy table set changed and the fence's scope is no longer known`);
  }
  for (const name of seenTables) {
    if (!LEGACY_RELATIONS.some((t) => t.name === name)) {
      out.push(`${rel(name)} exists in ${LEGACY_SCHEMA} but is not in LEGACY_TABLES — a new legacy table appeared and nobody decided whether the fence covers it`);
    }
  }

  for (const r of list) {
    const t = LEGACY_RELATIONS.find((x) => x.name === r.relname);
    if (!t) continue;                                    // already reported above
    const fenced = FENCED_ROLES.includes(r.rolname);
    const writes = [["INSERT", r.ins], ["UPDATE", r.upd], ["DELETE", r.del]].filter(([, v]) => b(v)).map(([k]) => k);

    if (t.fenced && fenced) {
      if (phase === PHASE.AFTER) {
        if (writes.length) out.push(`${r.rolname} still holds ${writes.join(",")} on ${rel(r.relname)} — the fence did not close`);
        if (!b(r.sel)) out.push(`${r.rolname} lost SELECT on ${rel(r.relname)} — the fence took a read privilege, and the application still reads this document until step 13`);
      } else {
        if (!writes.length) out.push(`${r.rolname} already holds no write privilege on ${rel(r.relname)} before the fence ran — the fence would be a no-op and "it worked" would be unreadable from the result`);
      }
    }

    if (!fenced && r.rolname === "service_role" && t.fenced) {
      // service_role mirrors into the document until step 19; the fence must leave it alone in BOTH phases.
      const missing = ["INSERT", "UPDATE"].filter((p) => !b(p === "INSERT" ? r.ins : r.upd));
      if (missing.length) out.push(`service_role lost ${missing.join(",")} on ${rel(r.relname)} — it mirrors into this document until step 19 and the fence must not touch it`);
    }

    /**
     * Over-reach: an unfenced table whose browser writes have gone.
     *
     * KPLUS-F055 exposed a latent defect here. This used to read "no writes on an unfenced table ⇒ the
     * fence over-reached", which was correct only while every unfenced table was a `lottery_*` with full
     * CRUD. Production has `bolao_entry_private` (anon holds NOTHING) and `live_sports_cache` (anon holds
     * SELECT only): both legitimately have no anon write, and both were reported as over-reach the moment
     * the model learned about them. A check that fires on a state the fence never produced is a check
     * that will eventually be silenced rather than believed.
     *
     * So the question is now the right one — did this role LOSE a write it previously held? — answered
     * against the measured baseline instead of an assumption about what unfenced tables look like.
     */
    const hadWrites = baselineWrites(baseline, r.relname, r.rolname);
    if (!t.fenced && phase === PHASE.AFTER && fenced && !writes.length && hadWrites) {
      out.push(`${r.rolname} lost its write privileges on ${rel(r.relname)}, which the fence does not cover — the fence reached beyond the legacy document`);
    }
  }
  return out;
}

/**
 * KPLUS-F036 — the orphaned Powerball tables, and the privileges nobody uses.
 *
 * THE FENCE DELIBERATELY DOES NOT COVER THESE, and this is a separate artefact for that reason: the six
 * `lottery_*` tables belong to the Powerball product, not to this migration, so narrowing them is that
 * product's access-model decision and not a side effect of a bolão cutover.
 *
 * WHAT IS ACTUALLY EXPOSED, measured rather than characterised:
 *   · `anon` holds SELECT, INSERT, UPDATE, DELETE, REFERENCES and TRIGGER on all six.
 *   · `authenticated` holds all of those plus TRUNCATE.
 *   · The tables carry `display_name`, `email`, `phone` (lottery_participants), `amount` and
 *     `external_reference` (lottery_payment_transactions) and `actor_email_snapshot` (lottery_admin_audit).
 *   · The anon key is in the page source, so anything anon may do, anyone on the internet may do.
 *
 * WHY IT IS INERT TODAY AND WHY THAT IS NOT REASSURING: every one of the six has RLS enabled with ZERO
 * policies, which denies everyone who is neither owner nor BYPASSRLS. The grants are nonetheless real.
 * One added policy, or one `ALTER TABLE … DISABLE ROW LEVEL SECURITY`, makes them live — and KPLUS-F012
 * records that the `rls_auto_enable` guard may never have been active at all. TRIGGER is the sharpest of
 * them: it lets a principal attach code to a table it does not own, which fires for every writer.
 *
 * WHY REVOKING IS SAFE, on evidence and not on preference:
 *   1. No application code in this repository references any `lottery_*` table. The Powerball app at
 *      `bolao/loterias/powerball/` is static — it reads `js/data.js` and holds no database client.
 *   2. Production statistics (`PHASE1B_LIVE_STATE.md`, §2): across all six tables, **zero UPDATE and zero
 *      DELETE, ever**, a handful of scans, and never autovacuumed. `bolao_state` shows 17,829 sequential
 *      scans and 532 updates over the same period. These tables were written once and left.
 *
 * That evidence supports removing the standing grant entirely rather than only its write half. SELECT is
 * revoked too, because nothing reads these tables through a browser role and they hold PII — leaving a
 * read grant would keep the exposure that matters most if a policy is ever added.
 *
 * NOT APPLIED TO PRODUCTION BY THIS CAMPAIGN. This generates the statements and the rollback; applying
 * them is an operator decision about another product, and it is recorded as such.
 */
export const ORPHAN_PRIVILEGES = Object.freeze([
  "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
]);
/**
 * The tables this covers: the six Powerball tables, selected BY PRODUCT and not by "everything the fence
 * does not fence".
 *
 * KPLUS-F055 changed this. `!t.fenced` was a correct definition while `public` held exactly seven tables
 * and the only unfenced ones were Powerball's. Production has ten, so the old predicate would have swept
 * `bolao_entry_private`, `bolao_notif_jobs` and `live_sports_cache` into a REVOKE proposal written for a
 * different product on that product's evidence — the prose above (zero UPDATEs ever, no code references,
 * PII columns) is true of the six and was never measured for the three.
 *
 * A definition that happens to be right about today's data is not the same as a definition that is right.
 */
const orphanTables = () => LEGACY_TABLES.filter((t) => t.product === "POWERBALL");

export function renderOrphanRevokeSql() {
  const L = [];
  L.push("-- NOT FOR PRODUCTION APPLY");
  L.push("-- ORPHANED LEGACY TABLES — proposed privilege removal (KPLUS-F036)");
  L.push("-- GENERATED FILE — do not edit by hand. Source: scripts/db/legacy_fence.mjs");
  L.push("-- Regenerate: node scripts/db/legacy_fence.mjs --write");
  L.push("--");
  L.push("-- THIS IS A PROPOSAL, NOT PART OF THE BOLAO CUTOVER. These six tables belong to the Powerball");
  L.push("-- product. Narrowing them is that product's access-model decision and needs its owner's");
  L.push("-- authorization; it is generated here because the exposure was found here.");
  L.push("--");
  L.push("-- WHAT IS EXPOSED: anon holds SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER on all six;");
  L.push("-- authenticated holds those plus TRUNCATE. The tables carry display_name, email, phone, payment");
  L.push("-- amounts and external references. The anon key is in the page source.");
  L.push("--");
  L.push("-- WHY IT IS INERT TODAY: all six have RLS enabled with ZERO policies. That denies everyone who is");
  L.push("-- not owner or BYPASSRLS — but the grant is real, and one added policy or one DISABLE ROW LEVEL");
  L.push("-- SECURITY makes it live. TRIGGER additionally lets a principal attach code to a table it does");
  L.push("-- not own.");
  L.push("--");
  L.push("-- WHY THIS IS SAFE TO APPLY: no application code references these tables (the Powerball app is");
  L.push("-- static and holds no database client), and production statistics show zero UPDATE and zero");
  L.push("-- DELETE ever, with the tables never autovacuumed. They were written once and left.");
  L.push("--");
  L.push("-- WHAT WOULD BREAK IF THAT IS WRONG: any browser-role read or write of Powerball data. The");
  L.push("-- rollback below restores every privilege this removes, and RLS already denies all of it, so the");
  L.push("-- observable blast radius of being wrong is a permission error rather than data loss.");
  L.push("--");
  L.push("-- Privileges are NAMED, not REVOKE ALL, so the statement says exactly what it removes.");
  L.push("");
  for (const t of orphanTables()) {
    L.push(`-- ${rel(t.name)}`);
    for (const role of FENCED_ROLES) {
      L.push(`REVOKE ${ORPHAN_PRIVILEGES.join(", ")} ON TABLE ${rel(t.name)} FROM ${role};`);
    }
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

/**
 * The reversal — derived from the MEASURED prior state, not from the constant the revocation used.
 *
 * KPLUS-F042. The first version generated `GRANT <every privilege> TO <every role>`, mirroring the
 * REVOKE. That is wrong in one direction and only one: revoking a privilege a role does not hold is a
 * no-op, but GRANTING one it never had is a privilege the rollback invents. Measured — `anon` does not
 * hold TRUNCATE on these tables and `authenticated` does, so the constant rollback would have handed
 * `anon` TRUNCATE on six tables holding participants and payment transactions, in the name of restoring
 * them.
 *
 * So this takes the ACL read taken BEFORE the revocation and restores exactly that. A rollback of a
 * privilege change that does not consult the prior state cannot be a rollback; it is a second change.
 * There is no default: being called without the prior state is the bug, so it raises instead.
 */
export function renderOrphanRevokeRollbackSql(priorAclRows) {
  if (!Array.isArray(priorAclRows) || priorAclRows.length === 0) {
    throw new Error(
      "renderOrphanRevokeRollbackSql needs the ACL read taken before the revocation (legacyAclSql()). " +
      "A rollback generated from the revocation's own constant grants back whatever that constant lists, " +
      "including privileges the role never held — KPLUS-F042.");
  }
  const b = (v) => v === true || v === "t" || v === "true";
  const rows = priorAclRows.map((r) => (Array.isArray(r)
    ? { relname: r[0], rolname: r[1], privs: ORPHAN_PRIVILEGES.filter((_, i) => b(r[2 + i])) } : r));
  const L = ["-- NOT FOR PRODUCTION APPLY",
    "-- ORPHANED LEGACY TABLES — ROLLBACK of the proposed privilege removal (KPLUS-F036)",
    "-- GENERATED FILE — do not edit by hand. Source: scripts/db/legacy_fence.mjs",
    "--",
    "-- Generated from the privilege state MEASURED before the revocation, so it restores what was there",
    "-- and not what the revocation happened to name. KPLUS-F042: anon does not hold TRUNCATE on these",
    "-- tables and authenticated does, so a rollback built from the revocation's own list would have",
    "-- granted anon a privilege it never had.",
    ""];
  for (const t of orphanTables()) {
    for (const role of FENCED_ROLES) {
      const held = rows.find((r) => r.relname === t.name && r.rolname === role)?.privs ?? [];
      if (!held.length) { L.push(`-- ${rel(t.name)} / ${role}: held nothing before the revocation — nothing to restore`); continue; }
      L.push(`GRANT ${held.join(", ")} ON TABLE ${rel(t.name)} TO ${role};`);
    }
  }
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

/**
 * The prior state as this campaign measured it on the restored baseline, so the CLI can emit a draft
 * without a database. It is a RECORD of a measurement, and it is checked against the live catalog by
 * `f036_orphan_acl_lab.mjs` — if production differs, the lab fails rather than the draft being wrong
 * quietly.
 */
export const MEASURED_ORPHAN_ACL = Object.freeze(orphanTables().flatMap((t) => FENCED_ROLES.map((role) =>
  Object.freeze([t.name, role, ...ORPHAN_PRIVILEGES.map((p) =>
    (p === "TRUNCATE" && role === "anon") ? "f" : "t")]))));

/**
 * The full privilege set per legacy table per browser role — seven privileges, not the four the fence
 * verifier reads.
 *
 * Kept separate from `fenceVerifySql()` rather than widening it: the fence asks "is the write path
 * closed", this asks "what does a browser role hold at all", and a query that answers both answers
 * neither clearly. Widening the fence's query would also have silently changed the row shape its
 * verdicts parse.
 */
export const legacyAclSql = () => `SELECT c.relname, r.rolname,
       ${ORPHAN_PRIVILEGES.map((p) => `has_table_privilege(r.rolname, c.oid, '${p}') AS ${p.toLowerCase()}`).join(",\n       ")}
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN (${FENCED_ROLES.map((r) => `'${r}'`).join(", ")})) r
 WHERE n.nspname = '${LEGACY_SCHEMA}' AND c.relkind IN ('r', 'v', 'm')
 ORDER BY c.relname, r.rolname`;

/**
 * Interpret `legacyAclSql()` for the orphan proposal. Empty array means the observed state matches.
 *
 * BEFORE, the orphan tables must still hold privileges — otherwise the proposal is a no-op and applying
 * it would prove nothing. AFTER, they must hold none, and the fenced document must be untouched, because
 * this proposal has no business changing the bolão cutover's subject.
 */
export function orphanRevokeFailures(rows, phase = PHASE.AFTER) {
  const b = (v) => v === true || v === "t" || v === "true";
  const list = (Array.isArray(rows) ? rows : []).map((r) =>
    Array.isArray(r) ? { relname: r[0], rolname: r[1], privs: ORPHAN_PRIVILEGES.filter((_, i) => b(r[2 + i])) } : r);
  if (list.length === 0) return ["the legacy ACL read returned nothing — a proposal cannot be verified against no rows"];
  const out = [];
  for (const r of list) {
    const t = LEGACY_RELATIONS.find((x) => x.name === r.relname);
    if (!t) { out.push(`${rel(r.relname)} is not in LEGACY_RELATIONS — the legacy relation set changed`); continue; }
    if (t.fenced) {
      if (!r.privs.includes("SELECT")) out.push(`${r.rolname} lost SELECT on ${rel(r.relname)} — this proposal must not touch the migration subject`);
      continue;
    }
    // KPLUS-F055: unfenced is no longer the same set as Powerball. A bolão table swept in here would be
    // judged against evidence gathered for a different product — see orphanTables().
    if (t.product !== "POWERBALL") continue;
    if (phase === PHASE.AFTER && r.privs.length) {
      out.push(`${r.rolname} still holds ${r.privs.join(",")} on ${rel(r.relname)}`);
    }
    if (phase === PHASE.BEFORE && !r.privs.length) {
      out.push(`${r.rolname} already holds nothing on ${rel(r.relname)} — the proposal is a no-op and applying it would prove nothing`);
    }
  }
  return out;
}

/**
 * What the fence does NOT fix, reported rather than silently fenced (KPLUS-F036).
 *
 * Every legacy table grants full CRUD to `anon` and `authenticated`. On the six Powerball tables that is
 * inert TODAY only because RLS is enabled with zero policies, which denies everyone who is neither the
 * owner nor BYPASSRLS. The grant is nonetheless live, so a single added policy — or one
 * `DISABLE ROW LEVEL SECURITY` — turns full CRUD on participants, payments and payouts back on for the
 * anonymous browser key.
 *
 * It is out of scope for this migration and this function does not fence it. It is computed and returned
 * so that the exposure is a value the lab records, not a sentence in a comment somebody might not read.
 */
export function unfencedExposure(rows) {
  const b = (v) => v === true || v === "t" || v === "true";
  const list = (Array.isArray(rows) ? rows : []).map((r) =>
    Array.isArray(r) ? { relname: r[0], rolname: r[1], sel: r[2], ins: r[3], upd: r[4], del: r[5] } : r);
  const out = [];
  for (const r of list) {
    const t = LEGACY_RELATIONS.find((x) => x.name === r.relname);
    if (!t || t.fenced || !FENCED_ROLES.includes(r.rolname)) continue;
    const writes = [["INSERT", r.ins], ["UPDATE", r.upd], ["DELETE", r.del]].filter(([, v]) => b(v)).map(([k]) => k);
    if (writes.length) out.push({ table: rel(r.relname), role: r.rolname, privileges: writes, product: t.why });
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("legacy_fence.mjs")) {
  const { writeFileSync, mkdirSync, readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const DIR = join(ROOT, "docs", "bolao", "db-modernization", "rls-drafts");
  const FENCE = join(DIR, "LEGACY_WRITE_FENCE.draft.sql");
  const BACK = join(DIR, "LEGACY_WRITE_FENCE_ROLLBACK.draft.sql");
  const ORPH = join(DIR, "LEGACY_ORPHAN_TABLES_REVOKE.draft.sql");
  const ORPH_BACK = join(DIR, "LEGACY_ORPHAN_TABLES_REVOKE_ROLLBACK.draft.sql");
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FENCE, renderFenceSql());
    writeFileSync(BACK, renderFenceRollbackSql());
    writeFileSync(ORPH, renderOrphanRevokeSql());
    writeFileSync(ORPH_BACK, renderOrphanRevokeRollbackSql(MEASURED_ORPHAN_ACL));
    for (const p of [FENCE, BACK, ORPH, ORPH_BACK]) console.log(`  wrote ${p.replace(ROOT + "/", "")}`);
    process.exit(0);
  }
  if (argv.includes("--check")) {
    const stale = [[FENCE, renderFenceSql()], [BACK, renderFenceRollbackSql()],
      [ORPH, renderOrphanRevokeSql()], [ORPH_BACK, renderOrphanRevokeRollbackSql(MEASURED_ORPHAN_ACL)]]
      .filter(([p, want]) => { let cur = ""; try { cur = readFileSync(p, "utf8"); } catch { /* absent counts as stale */ } return cur !== want; });
    for (const [p] of stale) console.log(`  ✗ stale: ${p.replace(ROOT + "/", "")}`);
    if (!stale.length) console.log("  ✓ fresh: legacy fence + orphan-revoke drafts");
    process.exit(stale.length ? 1 : 0);
  }
  console.log(renderFenceSql());
}
