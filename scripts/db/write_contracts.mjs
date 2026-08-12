#!/usr/bin/env node
/**
 * Trusted write-contract reference implementation (Workstream 13).
 *
 * WHY A REFERENCE IMPLEMENTATION AND NOT JUST A SPEC
 * WS12 deliberately left business invariants outside RLS — the cutoff needs a trusted clock, the per-payment
 * allocation invariant spans sibling rows, a merge needs operator confirmation. A specification saying "the
 * transaction enforces this" is unfalsifiable. An executable orchestrator over a synthetic store makes every
 * one of those claims testable: concurrency, fault injection and idempotency all become fixtures instead of
 * assertions of intent.
 *
 * THE THREE RULES THAT SHAPE EVERYTHING
 *
 *   1. ONE BUSINESS TRANSACTION IS ONE CONTRACT. An entry without its snapshotted fee is an entry whose
 *      settlement is undefined, so creating one is a single transaction — never three browser writes because
 *      the tables happen to be normalised.
 *
 *   2. THE IDEMPOTENCY RECORD COMMITS INSIDE THE BUSINESS TRANSACTION. Writing it before commit lets a crash
 *      leave a request marked done that never happened; writing it after lets a retry double-write. Same
 *      lesson as the backfill checkpoint, and the same fault-injection fixtures prove it.
 *
 *   3. READ COMMITTED EVERYWHERE. Every conflict in this design is closed by a UNIQUE index or a FOR UPDATE
 *      on exactly the contended row. SERIALIZABLE would serialise requests that do not conflict and still
 *      need the same retry handling, so it is not used anywhere — deliberately, not by omission.
 *
 * NO DATABASE, NO NETWORK, NO DEPLOYMENT. The store is in-memory so failure modes are reproducible.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { parseMoney, money, add, sub, cmp, sum, settlementStatus, unappliedBalance, SETTLEMENT } from "./financial.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const CONTRACTS_PATH = join(ROOT, "model", "write_contracts.json");
export function loadContracts(p = CONTRACTS_PATH) { return JSON.parse(readFileSync(p, "utf8")); }

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export class ContractError extends Error {
  constructor(code, detail = "", meta = {}) { super(`${code}${detail ? ": " + detail : ""}`); this.code = code; this.detail = detail; this.meta = meta; }
}
const fail = (code, detail, meta) => { throw new ContractError(code, detail, meta); };

/** Canonical payload fingerprint: sorted keys, correlation and request id excluded. */
export function payloadFingerprint(payload) {
  const sortDeep = (v) => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => !["request_id", "correlation_id"].includes(k)).map((k) => [k, sortDeep(v[k])]));
    return v;
  };
  return sha256(JSON.stringify(sortDeep(payload)));
}

/** Row fingerprint, for optimistic concurrency on adminCorrection. */
export function rowFingerprint(row) {
  const sorted = Object.fromEntries(Object.keys(row).sort().map((k) => [k, row[k]]));
  return sha256(JSON.stringify(sorted));
}

/**
 * The deterministic global lock order. A fixed order makes deadlock impossible between any two contracts
 * here; without it, allocatePayment (payments → pool_entries) and a hypothetical contract taking them the
 * other way round would deadlock under load.
 */
export const LOCK_ORDER = ["pools", "participants", "participant_identity_links", "payments",
  "pool_entries", "predictions", "prize_allocations", "audit_events", "outbox_events"];

export function lockRank(table) {
  const i = LOCK_ORDER.indexOf(table);
  return i === -1 ? LOCK_ORDER.length : i;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic transactional store
// ─────────────────────────────────────────────────────────────────────────────
/**
 * An in-memory store with snapshot rollback, row locks and unique indexes.
 *
 * `acquire` records the order locks were taken and REFUSES an out-of-order acquisition. That turns the lock
 * ordering rule from documentation into something a test can violate and observe — which is the only way to
 * know the rule is being followed.
 */
export function makeDb({ uniqueIndexes = {} } = {}) {
  let committed = { tables: {}, idempotency: {} };
  let work = null;
  let held = [];
  let lockedBy = new Map();          // key -> txId, so a second transaction's lock attempt is visible
  let txSeq = 0;
  const clone = (s) => JSON.parse(JSON.stringify(s));

  const api = {
    /** Server clock. The ONLY time source any contract may use for a cutoff decision. */
    now: () => new Date("2026-06-10T12:00:00Z").toISOString(),
    _setNow(iso) { api.now = () => iso; },

    begin() {
      if (work) throw new Error("nested transaction");
      work = clone(committed); held = []; api._txId = ++txSeq;
      return api._txId;
    },
    commit() { if (!work) throw new Error("no transaction"); committed = work; work = null; api._release(); },
    rollback() { work = null; api._release(); },
    _release() { for (const k of held) lockedBy.delete(k); held = []; },

    /** Acquire a row lock. Enforces the global order and detects a conflicting holder. */
    acquire(table, id, mode = "FOR UPDATE") {
      const key = `${table}:${id}:${mode === "FOR SHARE" ? "S" : "X"}`;
      const rank = lockRank(table);
      const worst = held.length ? Math.max(...held.map((k) => lockRank(k.split(":")[0]))) : -1;
      if (rank < worst) {
        throw new Error(`LOCK_ORDER_VIOLATION: acquiring ${table} after a later-ranked table. ` +
          `The global order is ${LOCK_ORDER.join(" → ")}; taking locks out of order is how two contracts deadlock.`);
      }
      const holder = lockedBy.get(`${table}:${id}:X`);
      if (mode === "FOR UPDATE" && holder && holder !== api._txId) {
        throw new ContractError("LOCKED", `row ${table}:${id} is locked by another transaction`);
      }
      if (mode === "FOR UPDATE") lockedBy.set(`${table}:${id}:X`, api._txId);
      held.push(key);
      return true;
    },
    heldLocks: () => [...held],
    /**
     * Test helper: mark a row as locked by a DIFFERENT transaction, without opening one here. Needed because
     * simulating two concurrent transactions in one process cannot be done by nesting begin().
     */
    _simulateForeignLock(table, id) { lockedBy.set(`${table}:${id}:X`, -1); },
    _clearForeignLocks() { for (const [k, v] of [...lockedBy]) if (v === -1) lockedBy.delete(k); },

    table(name) {
      const s = work || committed;
      if (!s.tables[name]) s.tables[name] = [];
      return s.tables[name];
    },
    insert(name, row) {
      const t = api.table(name);
      const idx = uniqueIndexes[name] || [];
      for (const cols of idx) {
        const key = JSON.stringify(cols.map((c) => row[c]));
        if (cols.every((c) => row[c] !== null && row[c] !== undefined) &&
            t.some((r) => JSON.stringify(cols.map((c) => r[c])) === key)) {
          fail("DUPLICATE", `unique index (${cols.join(", ")}) on ${name} already holds this value`);
        }
      }
      t.push(row);
      return row;
    },
    update(name, pred, patch) {
      const t = api.table(name);
      const r = t.find(pred);
      if (!r) fail("NOT_FOUND", `${name} row not found`);
      Object.assign(r, patch);
      return r;
    },
    find(name, pred) { return api.table(name).find(pred) || null; },
    all(name, pred = () => true) { return api.table(name).filter(pred); },

    // Idempotency lives in the same store, so `commit` covers it atomically with the business rows.
    idemGet(contract, key) { return (work || committed).idempotency[JSON.stringify([contract, key])] || null; },
    idemPut(contract, key, rec) { (work || committed).idempotency[JSON.stringify([contract, key])] = rec; },
    committedState: () => clone(committed),
  };
  return api;
}

export const UNIQUE_INDEXES = {
  payments: [["external_reference"]],
  predictions: [["pool_entry_id", "subject_id"]],
  prize_allocations: [["pool_id", "rank"]],
  pool_entries: [["participant_id", "pool_id", "entry_label"]],
};

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Run a contract inside one transaction.
 *
 * `faults` injects a throw at a named point, so the five failure windows WS13.22 asks about are reproducible.
 * `mutations` disables a named control, so WS13.23/13.24's mutants can be applied without editing the source.
 */
export function execute(db, contractName, request, { faults = {}, mutations = {} } = {}) {
  const impl = IMPLEMENTATIONS[contractName];
  if (!impl) fail("VALIDATION_FAILED", `unknown contract ${contractName}`);

  const key = request.idempotency_key;
  if (!key && !mutations.allowMissingIdempotencyKey) fail("VALIDATION_FAILED", "idempotency_key is required");
  const fp = mutations.removePayloadFingerprint ? "IGNORED" : payloadFingerprint(request);

  // Pre-transaction idempotency read: a hit replays without opening a transaction at all.
  const existing = db.idemGet(contractName, key);
  if (existing && !mutations.ignoreDuplicateKey) {
    if (existing.fingerprint !== fp) {
      fail("IDEMPOTENCY_CONFLICT",
        "the same idempotency key was used with a different payload. Replaying would be wrong and writing " +
        "again would be a double-write, so neither is done.");
    }
    return { ...existing.response, idempotent_replay: true };
  }

  db.begin();
  try {
    if (faults.beforeMutation) throw new Error("injected fault before mutation");
    const ctx = { db, request, fingerprint: fp, faults, mutations, contractName };
    const response = impl(ctx);

    if (faults.afterMutationBeforeAudit) throw new Error("injected fault after mutation, before audit");
    // Audit and outbox are appended by the implementation; the orchestrator only sequences the faults.
    if (faults.afterAuditBeforeOutbox) throw new Error("injected fault after audit, before outbox");
    if (faults.afterOutboxBeforeIdempotency) throw new Error("injected fault after outbox, before idempotency");

    /**
     * The idempotency record is written HERE — inside the transaction, after the business rows.
     * A mutant can move it before the mutation to prove why that is wrong.
     */
    if (!mutations.markCompleteBeforeCommit) {
      db.idemPut(contractName, key, { fingerprint: fp, response, at: db.now() });
    }
    db.commit();
    if (faults.afterCommitBeforeResponse) {
      // The transaction is durable; the caller never learns. A retry must replay, not rewrite.
      throw new ContractError("INTERNAL", "injected fault after commit, before response");
    }
    return { ...response, idempotent_replay: false };
  } catch (e) {
    db.rollback();
    throw e;
  }
}

/** Shared authorization + actor resolution. */
function authorizeActor(ctx, { requireRuntime = false, requireOperator = false } = {}) {
  const { request, mutations } = ctx;
  const actor = request.actor || {};
  if (!actor.principal) fail("AUTH_REQUIRED", "no principal");
  if (requireRuntime && actor.principal !== "trusted_runtime") {
    fail("FORBIDDEN", `${ctx.contractName} is trusted_runtime only; browser-supplied data is not database authorization`);
  }
  if (requireOperator && !mutations.allowOperatorWithoutEvidence) {
    const ev = actor.operator_evidence;
    if (!ev || !ev.operator_id || !ev.reason || ev.reason.trim().length < 10) {
      fail("FORBIDDEN",
        "this contract requires operator evidence with a stated reason. R-GAP-1: the database cannot verify " +
        "an operator, so the runtime must record whose authority it checked and why — an unexplained " +
        "privileged action is indistinguishable from an unauthorised one when read a year later.");
    }
  }
  return actor;
}

/** Resolve which participant an authenticated caller is acting as (WS12-OP-2: one user may own several). */
function resolveActingParticipant(ctx) {
  const { db, request } = ctx;
  const actor = request.actor;
  if (actor.principal === "trusted_runtime") return actor.acting_participant_id ?? null;
  const links = db.all("participant_auth_links", (l) => l.auth_user_id === actor.auth_user_id);
  if (links.length === 0) fail("FORBIDDEN", "this auth user is linked to no participant");
  if (links.length === 1) return links[0].participant_id;
  if (!actor.acting_participant_id) {
    fail("IDENTITY_AMBIGUOUS",
      `this auth user is linked to ${links.length} participants and the request does not say which one it acts for. ` +
      `Picking one would attribute the write to a person the caller did not name.`);
  }
  if (!links.some((l) => l.participant_id === actor.acting_participant_id)) {
    fail("FORBIDDEN", "the acting participant is not linked to this auth user");
  }
  return actor.acting_participant_id;
}

function appendAudit(ctx, { action, aggregateType, aggregateId, safeMetadata = {}, reason = null, details = null }) {
  const { db, request } = ctx;
  const FORBIDDEN_KEYS = ["email", "external_reference", "payer_name_as_recorded", "memo", "display_name", "phone", "note"];
  for (const k of Object.keys(safeMetadata)) {
    if (FORBIDDEN_KEYS.includes(k)) {
      fail("INTERNAL", `audit safe_metadata may not carry ${k} (B1/ADR-008). Use the redactable sidecar or a reference.`);
    }
  }
  const row = db.insert("audit_events", {
    audit_event_id: `audit-${db.table("audit_events").length + 1}`,
    occurred_at: db.now(), action, aggregate_type: aggregateType, aggregate_id: aggregateId,
    actor_role: request.actor.principal === "trusted_runtime" ? (request.actor.operator_evidence ? "operator" : "service") : "participant",
    actor_operator_id: request.actor.operator_evidence?.operator_id ?? null,
    correlation_id: request.correlation_id ?? null, request_id: request.request_id ?? null,
    reason, safe_metadata: safeMetadata,
  });
  if (details) {
    db.insert("audit_event_details", {
      audit_event_detail_id: `detail-${db.table("audit_event_details").length + 1}`,
      audit_event_id: row.audit_event_id, before_snapshot: details.before ?? null,
      after_snapshot: details.after ?? null, redacted_at: null,
    });
  }
  return row;
}

function appendOutbox(ctx, { type, dedupeKey, aggregateId }) {
  const { db, request } = ctx;
  if (db.all("outbox_events", (e) => e.idempotency_key === dedupeKey).length) return null;   // dedupe
  return db.insert("outbox_events", {
    outbox_event_id: `outbox-${db.table("outbox_events").length + 1}`,
    idempotency_key: dedupeKey, channel: "email", event_type: type,
    aggregate_id: aggregateId, payload: null,                 // references only; address resolved at delivery
    status: "pending", attempt_count: 0, correlation_id: request.correlation_id ?? null, created_at: db.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
const IMPLEMENTATIONS = {
  createEntry(ctx) {
    const { db, request, mutations } = ctx;
    authorizeActor(ctx);
    const pool = db.find("pools", (p) => p.pool_id === request.pool_id);
    if (!pool) fail("NOT_FOUND", "pool");
    db.acquire("pools", pool.pool_id, "FOR SHARE");
    if (pool.status !== "open" && !mutations.allowClosedPool) fail("UNSUPPORTED_STATE", `pool status is ${pool.status}`);

    // Cutoff against the SERVER clock. A client timestamp is never consulted.
    const phases = db.all("competition_edition_phases", (p) => p.competition_edition_id === pool.competition_edition_id);
    const earliest = phases.map((p) => p.cutoff_at).filter(Boolean).sort()[0];
    if (earliest && db.now() > earliest && !mutations.allowAfterCutoff) {
      fail("CUTOFF_PASSED", `entries closed at ${earliest} (server time ${db.now()})`);
    }

    const fees = db.all("pool_fee_schedule", (f) => f.pool_id === pool.pool_id && f.effective_to === null);
    if (fees.length !== 1) fail("FINANCIAL_INVARIANT", `${fees.length} fee schedules in force; exactly one is required`);
    const fee = fees[0];

    // Resolve or create the participant. NEVER merges.
    const email = request.participant_email ? norm(request.participant_email) : null;
    let participant = email ? db.find("participants", (p) => norm(p.email) === email) : null;
    if (!participant) participant = db.find("participants", (p) => norm(p.display_name) === norm(request.display_name) && !p.email);
    if (!participant) {
      db.acquire("participants", `new-${db.table("participants").length + 1}`);
      participant = db.insert("participants", {
        participant_id: `p-${db.table("participants").length + 1}`,
        display_name: request.display_name, email: request.participant_email ?? null,
        state: "active", canonical_participant_id: null, version: 1,
      });
    }
    if (participant.canonical_participant_id) fail("IDENTITY_AMBIGUOUS", "the resolved participant is superseded by a merge");

    const entry = db.insert("pool_entries", {
      pool_entry_id: `e-${db.table("pool_entries").length + 1}`,
      pool_id: pool.pool_id, participant_id: participant.participant_id,
      entry_label: request.entry_label,
      expected_fee_amount: fee.fee_amount, expected_fee_currency: fee.currency,
      state: "submitted", version: 1, created_at: db.now(), deleted_at: null,
    });
    if (!entry.expected_fee_amount || !entry.expected_fee_currency) {
      fail("FINANCIAL_INVARIANT", "an entry without a fee snapshot has undefined settlement");
    }

    appendAudit(ctx, { action: "entry_created", aggregateType: "pool_entry", aggregateId: entry.pool_entry_id,
      safeMetadata: { pool_id: pool.pool_id, fee_currency: fee.currency, label_present: true } });
    appendOutbox(ctx, { type: "participant_receipt", dedupeKey: `entry:${entry.pool_entry_id}:receipt`, aggregateId: entry.pool_entry_id });
    appendOutbox(ctx, { type: "admin_notification", dedupeKey: `entry:${entry.pool_entry_id}:admin`, aggregateId: entry.pool_entry_id });

    return { pool_entry_id: entry.pool_entry_id, settlement_status: "unpaid",
      expected_fee_amount: fee.fee_amount, expected_fee_currency: fee.currency };
  },

  submitPrediction(ctx) {
    const { db, request, mutations } = ctx;
    authorizeActor(ctx);
    const entry = db.find("pool_entries", (e) => e.pool_entry_id === request.pool_entry_id);
    if (!entry) fail("NOT_FOUND", "entry");

    if (request.actor.principal === "authenticated") {
      const acting = resolveActingParticipant(ctx);
      if (entry.participant_id !== acting && !mutations.allowForeignEntry) {
        fail("FORBIDDEN", "this entry belongs to another participant");
      }
    }
    db.acquire("pool_entries", entry.pool_entry_id, "FOR SHARE");
    if (entry.state !== "submitted" || entry.deleted_at) fail("UNSUPPORTED_STATE", "the entry is withdrawn");

    const pool = db.find("pools", (p) => p.pool_id === entry.pool_id);
    const subject = request.subject_kind === "match"
      ? db.find("matches", (m) => m.match_id === request.subject_id)
      : db.find("ties", (t) => t.tie_id === request.subject_id);
    if (!subject) fail("NOT_FOUND", "subject");
    const phase = db.find("competition_edition_phases", (p) => p.competition_edition_phase_id === subject.competition_edition_phase_id);
    if (!phase || phase.competition_edition_id !== pool.competition_edition_id) {
      fail("VALIDATION_FAILED", "the subject does not belong to this pool's competition edition");
    }
    if (phase.cutoff_at && db.now() > phase.cutoff_at && !mutations.allowAfterCutoff) {
      fail("CUTOFF_PASSED", `the phase closed at ${phase.cutoff_at} (server time ${db.now()})`);
    }

    const existing = db.find("predictions", (p) => p.pool_entry_id === entry.pool_entry_id && p.subject_id === request.subject_id);
    if (existing && request.expected_version != null && existing.version !== request.expected_version) {
      fail("STALE_VERSION", `expected version ${request.expected_version}, found ${existing.version}`);
    }
    let row, replaced = false;
    if (existing) {
      replaced = true;
      db.update("predictions", (p) => p === existing, {
        home_goals: request.home_goals ?? null, away_goals: request.away_goals ?? null,
        advancing_team: request.advancing_team ?? null, version: existing.version + 1, updated_at: db.now(),
      });
      row = existing;
    } else {
      row = db.insert("predictions", {
        prediction_id: `pr-${db.table("predictions").length + 1}`,
        pool_entry_id: entry.pool_entry_id, subject_id: request.subject_id, subject_kind: request.subject_kind,
        home_goals: request.home_goals ?? null, away_goals: request.away_goals ?? null,
        advancing_team: request.advancing_team ?? null, version: 1, submitted_at: db.now(),
      });
    }
    appendAudit(ctx, { action: "prediction_submitted", aggregateType: "prediction", aggregateId: row.prediction_id,
      safeMetadata: { pool_entry_id: entry.pool_entry_id, subject_id: request.subject_id, replaced } });
    return { prediction_id: row.prediction_id, replaced, version: row.version };
  },

  recordPayment(ctx) {
    const { db, request, mutations } = ctx;
    authorizeActor(ctx, { requireRuntime: true, requireOperator: request.channel === "operator_manual" });

    const amount = parseMoney(request.amount, request.currency);
    const outward = ["refund", "reversal", "chargeback"].includes(request.kind);
    if (amount.minor === 0) fail("FINANCIAL_INVARIANT", "a zero-amount payment records nothing and would distort settlement");
    if (outward && amount.minor >= 0) fail("FINANCIAL_INVARIANT", `kind ${request.kind} must be negative`);
    if (!outward && amount.minor <= 0) fail("FINANCIAL_INVARIANT", `kind ${request.kind} must be positive`);
    if (request.paid_at > db.now()) fail("VALIDATION_FAILED", "paid_at is in the future by the server clock");

    const payment = db.insert("payments", {
      payment_id: `pay-${db.table("payments").length + 1}`,
      payer_participant_id: request.payer_participant_id ?? null,
      payer_name_as_recorded: request.payer_name_as_recorded ?? null,
      amount: request.amount, currency: request.currency, kind: request.kind,
      method: request.method ?? null, external_reference: request.external_reference ?? null,
      paid_at: request.paid_at, channel: request.channel, created_at: db.now(),
    });
    appendAudit(ctx, { action: "payment_recorded", aggregateType: "payment", aggregateId: payment.payment_id,
      reason: request.actor.operator_evidence?.reason ?? null,
      safeMetadata: { currency: request.currency, kind: request.kind, channel: request.channel,
        has_external_reference: !!request.external_reference } });
    appendOutbox(ctx, { type: "admin_notification", dedupeKey: `payment:${payment.payment_id}:admin`, aggregateId: payment.payment_id });
    return { payment_id: payment.payment_id, unapplied_amount: request.amount };
  },

  allocatePayment(ctx) {
    const { db, request, mutations } = ctx;
    authorizeActor(ctx, { requireRuntime: true, requireOperator: true });

    const payment = db.find("payments", (p) => p.payment_id === request.payment_id);
    if (!payment) fail("NOT_FOUND", "payment");
    // THE critical lock. Two concurrent allocations against one payment must not both pass the balance check.
    db.acquire("payments", payment.payment_id, "FOR UPDATE");
    if (payment.amount === null) fail("FINANCIAL_INVARIANT", "a legacy-asserted payment has no amount to allocate");

    const entry = db.find("pool_entries", (e) => e.pool_entry_id === request.pool_entry_id);
    if (!entry) fail("NOT_FOUND", "entry");
    db.acquire("pool_entries", entry.pool_entry_id, "FOR SHARE");

    if (!(request.currency === payment.currency && request.currency === entry.expected_fee_currency)) {
      fail("FINANCIAL_INVARIANT", "allocation, payment and entry-fee currencies must all agree; converting silently would produce wrong money");
    }
    const alloc = parseMoney(request.allocated_amount, request.currency);
    if (alloc.minor <= 0) fail("FINANCIAL_INVARIANT", "an allocation must be positive");

    const existing = db.all("payment_allocations", (a) => a.payment_id === payment.payment_id);
    const already = sum(existing.map((a) => parseMoney(a.allocated_amount, a.currency)), request.currency);
    const total = add(already, alloc);
    const paymentAmount = parseMoney(payment.amount, payment.currency);
    if (!mutations.allowOverAllocation && cmp(total, paymentAmount) > 0) {
      fail("FINANCIAL_INVARIANT",
        `allocating ${request.allocated_amount} would bring the total to ${total.minor} minor units against a ` +
        `payment of ${paymentAmount.minor}. You cannot allocate more of a payment than was received.`);
    }

    const row = db.insert("payment_allocations", {
      allocation_id: `al-${db.table("payment_allocations").length + 1}`,
      payment_id: payment.payment_id, pool_entry_id: entry.pool_entry_id,
      allocated_amount: request.allocated_amount, currency: request.currency,
      allocated_at: db.now(), note: request.note ?? null,
    });

    // Both figures are DERIVED. Neither is stored anywhere.
    const entryAllocs = db.all("payment_allocations", (a) => a.pool_entry_id === entry.pool_entry_id);
    const allocated = sum(entryAllocs.map((a) => parseMoney(a.allocated_amount, a.currency)), entry.expected_fee_currency);
    const status = settlementStatus({
      expected: parseMoney(entry.expected_fee_amount, entry.expected_fee_currency),
      allocated, legacyAsserted: false,
    });
    const unapplied = sub(paymentAmount, total);

    appendAudit(ctx, { action: "payment_allocated", aggregateType: "payment_allocation", aggregateId: row.allocation_id,
      reason: request.actor.operator_evidence?.reason ?? null,
      safeMetadata: { payment_id: payment.payment_id, pool_entry_id: entry.pool_entry_id, currency: request.currency, resulting_settlement: status } });
    if (status === SETTLEMENT.SETTLED) {
      appendOutbox(ctx, { type: "participant_receipt", dedupeKey: `entry:${entry.pool_entry_id}:settled`, aggregateId: entry.pool_entry_id });
    }
    return { allocation_id: row.allocation_id,
      payment_unapplied_amount: `${Math.floor(Math.abs(unapplied.minor) / 100)}.${String(Math.abs(unapplied.minor) % 100).padStart(2, "0")}`,
      entry_settlement_status: status };
  },

  mergeParticipantIdentity(ctx) {
    const { db, request, mutations } = ctx;
    authorizeActor(ctx, { requireRuntime: true, requireOperator: true });
    const { surviving_participant_id: sid, merged_participant_id: mid } = request;
    if (sid === mid) fail("VALIDATION_FAILED", "a participant cannot be merged into itself — that is a 1-cycle");

    // DETERMINISTIC lock order by id. Two concurrent merges over one pair locking in opposite orders would
    // deadlock; sorting makes that impossible.
    for (const id of [sid, mid].sort()) db.acquire("participants", id, "FOR UPDATE");

    const S = db.find("participants", (p) => p.participant_id === sid);
    const M = db.find("participants", (p) => p.participant_id === mid);
    if (!S || !M) fail("NOT_FOUND", "participant");
    if (M.canonical_participant_id && !mutations.allowAlreadyMerged) {
      fail("CONFLICT", `${mid} is already merged; re-merging would overwrite existing provenance. Reverse the prior merge first.`);
    }
    if (S.canonical_participant_id) fail("CONFLICT", `${sid} is itself superseded; merging into it buries rows a hop deeper`);
    if (request.expected_surviving_canonical !== undefined && S.canonical_participant_id !== (request.expected_surviving_canonical ?? null)) {
      fail("STALE_VERSION", "the survivor's canonical pointer changed since the caller read it");
    }
    // Cycle check: does the survivor already resolve through the merged participant?
    let cur = S.canonical_participant_id, hops = 0;
    while (cur && hops++ < db.table("participants").length) {
      if (cur === mid) fail("IDENTITY_AMBIGUOUS", "this merge would close a cycle in the identity graph");
      cur = db.find("participants", (p) => p.participant_id === cur)?.canonical_participant_id ?? null;
    }

    const link = db.insert("participant_identity_links", {
      link_id: `link-${db.table("participant_identity_links").length + 1}`,
      surviving_participant_id: sid, merged_participant_id: mid,
      confidence: request.confidence, reason: request.actor.operator_evidence?.reason ?? null,
      merged_by: request.actor.operator_evidence?.operator_id ?? null, merged_at: db.now(),
      prior_state: { display_name: M.display_name, email: M.email, aliases: [...(M.aliases || [])] },
      prior_surviving_aliases: [...(S.aliases || [])],
      reversed_at: null, reversed_by: null, revert_reason: null,
    });
    db.update("participants", (p) => p.participant_id === mid,
      { canonical_participant_id: sid, superseded_at: db.now(), state: "superseded", version: (M.version || 1) + 1 });
    const aliases = new Set([...(S.aliases || [])]);
    if (M.display_name && norm(M.display_name) !== norm(S.display_name)) aliases.add(M.display_name);
    db.update("participants", (p) => p.participant_id === sid, { aliases: [...aliases], version: (S.version || 1) + 1 });

    // REPOINT what follows the person; deliberately NOT published snapshots or audit rows.
    const repointed = { pool_entries: 0, payments: 0, prize_allocations: 0 };
    for (const [table, col] of [["pool_entries", "participant_id"], ["payments", "payer_participant_id"], ["prize_allocations", "participant_id"]]) {
      for (const r of db.all(table, (x) => x[col] === mid)) { r[col] = sid; repointed[table]++; }
    }
    const snapshotsBefore = db.all("ranking_snapshots", (r) => r.participant_id === mid).length;

    appendAudit(ctx, { action: "identity_merged", aggregateType: "participant", aggregateId: sid,
      reason: request.actor.operator_evidence?.reason ?? null,
      safeMetadata: { surviving_participant_id: sid, merged_participant_id: mid, confidence: request.confidence,
        repointed, snapshots_left_untouched: snapshotsBefore } });
    return { link_id: link.link_id, repointed };
  },

  reverseParticipantMerge(ctx) {
    const { db, request } = ctx;
    authorizeActor(ctx, { requireRuntime: true, requireOperator: true });
    /**
     * Read the link UNLOCKED to discover the participant ids, then lock PARTICIPANTS FIRST in sorted id
     * order, then the link — matching the global lock order and the merge contract. An earlier draft locked
     * the link first, which would deadlock against a concurrent merge; the store's ordering check caught it.
     */
    const link = db.find("participant_identity_links", (l) => l.link_id === request.link_id);
    if (!link) fail("NOT_FOUND", "link");
    for (const id of [link.surviving_participant_id, link.merged_participant_id].sort()) db.acquire("participants", id, "FOR UPDATE");
    db.acquire("participant_identity_links", link.link_id, "FOR UPDATE");
    // Re-check UNDER the lock: a concurrent reversal may have committed between the unlocked read and here.
    if (link.reversed_at) fail("CONFLICT", "this merge is already reversed");

    const M = db.find("participants", (p) => p.participant_id === link.merged_participant_id);
    const S = db.find("participants", (p) => p.participant_id === link.surviving_participant_id);
    if (!M || !S) fail("NOT_FOUND", "participant");

    db.update("participants", (p) => p === M, {
      canonical_participant_id: null, superseded_at: null, state: "active",
      display_name: link.prior_state.display_name, email: link.prior_state.email,
      aliases: [...link.prior_state.aliases], version: (M.version || 1) + 1,
    });
    // Restored from the SNAPSHOT, not by subtraction — subtraction would drop an alias gained from a
    // different merge in between.
    db.update("participants", (p) => p === S, { aliases: [...link.prior_surviving_aliases], version: (S.version || 1) + 1 });
    db.update("participant_identity_links", (l) => l === link, {
      reversed_at: db.now(), reversed_by: request.actor.operator_evidence?.operator_id ?? null,
      revert_reason: request.actor.operator_evidence?.reason ?? null,
    });
    appendAudit(ctx, { action: "identity_merge_reversed", aggregateType: "participant", aggregateId: link.merged_participant_id,
      reason: request.actor.operator_evidence?.reason ?? null,
      safeMetadata: { link_id: link.link_id, surviving_participant_id: link.surviving_participant_id } });
    return { link_id: link.link_id, restored_participant_id: link.merged_participant_id };
  },

  recordPrize(ctx) {
    const { db, request, mutations } = ctx;
    authorizeActor(ctx, { requireRuntime: true, requireOperator: true });
    const pool = db.find("pools", (p) => p.pool_id === request.pool_id);
    if (!pool) fail("NOT_FOUND", "pool");
    db.acquire("pools", pool.pool_id, "FOR UPDATE");

    const published = db.all("ranking_snapshots", (r) => r.pool_id === pool.pool_id && r.published_at);
    if (!published.length && !mutations.allowUnpublishedRanking) {
      fail("UNSUPPORTED_STATE", "no published final ranking exists for this pool");
    }
    const already = db.all("prize_allocations", (z) => z.pool_id === pool.pool_id && !z.superseded_by_id);
    if (already.length && !mutations.allowDuplicatePrize) fail("DUPLICATE", "prizes are already declared for this pool");

    const entryIds = new Set(db.all("pool_entries", (e) => e.pool_id === pool.pool_id).map((e) => e.pool_entry_id));
    const collected = sum(db.all("payment_allocations", (a) => entryIds.has(a.pool_entry_id))
      .map((a) => parseMoney(a.allocated_amount, a.currency)), request.currency);
    const totalGross = sum(request.allocations.map((a) => parseMoney(a.gross_amount, request.currency)), request.currency);
    if (!mutations.allowPrizeOverCollected && cmp(totalGross, collected) > 0) {
      fail("FINANCIAL_INVARIANT",
        `declared prizes total ${totalGross.minor} minor units against ${collected.minor} collected. ` +
        `Paying out more than was collected is unrecoverable.`);
    }
    const ranks = request.allocations.map((a) => a.rank);
    if (new Set(ranks).size !== ranks.length) fail("VALIDATION_FAILED", "duplicate rank in one declaration");
    for (const a of request.allocations) {
      const entry = db.find("pool_entries", (e) => e.pool_entry_id === a.pool_entry_id);
      if (!entry) fail("NOT_FOUND", `entry ${a.pool_entry_id}`);
      if (entry.participant_id !== a.participant_id) {
        fail("VALIDATION_FAILED", "the prize participant does not match its entry's participant; winnings would be attributed to the wrong person");
      }
    }
    // All rows together: a partial declaration cannot exist.
    const ids = [];
    for (const a of request.allocations) {
      const row = db.insert("prize_allocations", {
        prize_allocation_id: `z-${db.table("prize_allocations").length + 1}`,
        pool_id: pool.pool_id, pool_entry_id: a.pool_entry_id, participant_id: a.participant_id,
        rank: a.rank, gross_amount: a.gross_amount, currency: request.currency,
        published_at: db.now(), paid_amount: null, superseded_by_id: null,
      });
      ids.push(row.prize_allocation_id);
      appendOutbox(ctx, { type: "participant_receipt", dedupeKey: `prize:${row.prize_allocation_id}:receipt`, aggregateId: row.prize_allocation_id });
    }
    appendAudit(ctx, { action: "prize_declared", aggregateType: "prize_allocation", aggregateId: pool.pool_id,
      reason: request.actor.operator_evidence?.reason ?? null,
      safeMetadata: { pool_id: pool.pool_id, currency: request.currency, allocation_count: ids.length } });
    appendOutbox(ctx, { type: "admin_notification", dedupeKey: `pool:${pool.pool_id}:prizes`, aggregateId: pool.pool_id });
    return { prize_allocation_ids: ids,
      total_gross: `${Math.floor(totalGross.minor / 100)}.${String(totalGross.minor % 100).padStart(2, "0")}` };
  },

  adminCorrection(ctx) {
    const { db, request, mutations } = ctx;
    authorizeActor(ctx, { requireRuntime: true, requireOperator: true });
    const model = loadContracts();
    const allow = model.contracts.find((c) => c.name === "adminCorrection").correctableFields;
    /**
     * The MONEY check runs BEFORE the allowlist check. Both refuse, but only this one tells the operator that
     * a monetary correction must be a compensating record — and that is the entire point of the message.
     * Ordering it second returned "not on the allowlist", which is true and useless.
     */
    const MONEY_FIELDS = ["amount", "allocated_amount", "gross_amount", "paid_amount", "expected_fee_amount", "currency", "expected_fee_currency"];
    if (MONEY_FIELDS.includes(request.field)) {
      fail("FINANCIAL_INVARIANT", "a money-bearing field is corrected by a COMPENSATING record, never by a destructive edit");
    }
    const allowed = allow[request.target_entity] || [];
    if (!allowed.includes(request.field) && !mutations.allowAnyField) {
      fail("FORBIDDEN",
        `${request.target_entity}.${request.field} is not on the correctable allowlist. An endpoint that can ` +
        `update anything is a second, unaudited schema.`);
    }

    const pkCol = { pool_entries: "pool_entry_id", participants: "participant_id", pools: "pool_id", matches: "match_id" }[request.target_entity];
    const row = db.find(request.target_entity, (r) => r[pkCol] === request.target_id);
    if (!row) fail("NOT_FOUND", request.target_entity);
    db.acquire(request.target_entity, request.target_id, "FOR UPDATE");

    const before = { ...row };
    if (!mutations.ignoreFingerprint && rowFingerprint(before) !== request.expected_before_fingerprint) {
      fail("STALE_VERSION", "the row changed since the operator read it; overwriting would discard someone else's change");
    }
    if ((row.version || 1) !== request.expected_version) fail("STALE_VERSION", `expected version ${request.expected_version}, found ${row.version || 1}`);

    db.update(request.target_entity, (r) => r === row, { [request.field]: request.new_value, version: (row.version || 1) + 1 });
    appendAudit(ctx, { action: "admin_correction", aggregateType: request.target_entity, aggregateId: request.target_id,
      reason: request.actor.operator_evidence?.reason ?? null,
      safeMetadata: { target_entity: request.target_entity, target_id: request.target_id, field: request.field },
      details: { before, after: { ...row } } });
    appendOutbox(ctx, { type: "admin_notification", dedupeKey: `correction:${request.request_id}`, aggregateId: request.target_id });
    return { corrected: true, new_version: row.version };
  },
};

export { IMPLEMENTATIONS };

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const m = loadContracts();
  console.log(`\nTrusted write contracts\n`);
  console.log(`  contracts: ${m.contracts.length}   error codes: ${Object.keys(m.errors).length}`);
  console.log(`  isolation: ${m.meta.isolationStance.slice(0, 80)}…`);
  console.log(`\n  lock order: ${LOCK_ORDER.join(" → ")}\n`);
  for (const c of m.contracts) {
    console.log(`  ${c.name.padEnd(26)} ${c.principals.join("/").padEnd(30)} audit=${c.audit.required} outbox=${c.outbox.required}`);
  }
  console.log("");
}
