#!/usr/bin/env node
/**
 * Data-quality rule engine for the target model (Workstream E).
 *
 * WHY IT RUNS ON A DATASET OBJECT RATHER THAN SQL
 * Every rule here is expressible as SQL, and eventually will be. But the target tables do not exist
 * yet, and the rules must be reviewable and testable NOW — before the schema is built, while changing
 * them is free. So each rule is a pure function over an in-memory dataset shaped exactly like the
 * target model, and each carries the SQL sketch it will become.
 *
 * NO PRODUCTION ROWS. NO REAL PARTICIPANT VALUES. Fixtures are synthetic and named as such.
 *
 * Every rule declares:
 *   id · title · severity · why (the failure it prevents) · sql (the eventual query) · check(dataset)
 *
 * Usage:
 *   node scripts/db/data_quality.mjs --self-test     # run against built-in synthetic fixtures
 *   node scripts/db/data_quality.mjs --list
 *   node scripts/db/data_quality.mjs --dataset=f.json [--json]
 */

import { readFileSync } from "node:fs";
import { settlementStatus, unappliedBalance, money, sum, cmp, sub, SETTLEMENT } from "./financial.mjs";
import { pathToFileURL } from "node:url";

const S = { CRITICAL: "CRITICAL", HIGH: "HIGH", MEDIUM: "MEDIUM" };

/** Empty dataset shape — every rule tolerates missing collections. */
export const EMPTY = {
  participants: [], participant_identity_links: [],
  competitions: [], competition_editions: [], competition_edition_phases: [],
  pools: [], pool_fee_schedule: [], pool_entries: [],
  payments: [], payment_allocations: [], prize_allocations: [],
  ties: [], matches: [], match_results: [], predictions: [],
  ranking_snapshots: [], sync_state: [],
  audit_events: [], outbox_events: [], outbox_delivery_attempts: [],
};

const ids = (rows, key) => new Set(rows.map((r) => r[key]));
const norm = (s) => String(s ?? "").trim().toLowerCase();

export const RULES = [
  // ── identity ───────────────────────────────────────────────────────────────
  {
    id: "DQ-ID-01", title: "duplicate participant candidate (same normalised email, not merged)",
    severity: S.HIGH,
    why: "two rows for one person fragment history and split their money across identities",
    sql: "SELECT lower(email), count(*) FROM bolao.participants WHERE email IS NOT NULL AND canonical_participant_id IS NULL GROUP BY 1 HAVING count(*)>1",
    check: (d) => {
      const seen = new Map();
      for (const p of d.participants) {
        if (!p.email || p.canonical_participant_id) continue;
        const k = norm(p.email);
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1)
        .map(([k, n]) => `${n} active participants share a normalised email (digest ${k.length}ch)`);
    },
  },
  {
    id: "DQ-ID-02", title: "illegal confirmed merge (participant merged into itself)",
    severity: S.CRITICAL,
    why: "a self-merge creates a 1-cycle and makes the canonical participant unresolvable",
    sql: "SELECT link_id FROM bolao.participant_identity_links WHERE surviving_participant_id = merged_participant_id",
    check: (d) => d.participant_identity_links
      .filter((l) => l.surviving_participant_id === l.merged_participant_id)
      .map((l) => `link ${l.link_id} merges a participant into itself`),
  },
  {
    id: "DQ-ID-03", title: "identity cycle (A→B→A via canonical_participant_id)",
    severity: S.CRITICAL,
    why: "a cycle makes canonical resolution loop forever; reporting would hang or truncate silently",
    sql: "WITH RECURSIVE walk AS (...) -- cycle detection over canonical_participant_id",
    check: (d) => {
      const parent = new Map(d.participants.map((p) => [p.participant_id, p.canonical_participant_id]));
      const out = [];
      for (const start of parent.keys()) {
        let cur = parent.get(start), hops = 0;
        while (cur && hops++ <= parent.size) {
          if (cur === start) { out.push(`cycle reached from ${start} after ${hops} hop(s)`); break; }
          cur = parent.get(cur);
        }
      }
      return [...new Set(out)];
    },
  },
  {
    id: "DQ-ID-04", title: "orphan identity link (references a missing participant)",
    severity: S.HIGH,
    why: "merge provenance that points at nothing cannot be reversed — the merge becomes permanent",
    sql: "SELECT link_id FROM bolao.participant_identity_links l WHERE NOT EXISTS (SELECT 1 FROM bolao.participants p WHERE p.participant_id IN (l.surviving_participant_id, l.merged_participant_id))",
    check: (d) => {
      const P = ids(d.participants, "participant_id");
      return d.participant_identity_links
        .filter((l) => !P.has(l.surviving_participant_id) || !P.has(l.merged_participant_id))
        .map((l) => `link ${l.link_id} references a missing participant`);
    },
  },
  {
    id: "DQ-ID-05", title: "merged participant still referenced as canonical by an entry",
    severity: S.HIGH,
    why: "after a merge, entries must point at the surviving identity or history stays fragmented",
    sql: "SELECT e.pool_entry_id FROM bolao.pool_entries e JOIN bolao.participants p USING (participant_id) WHERE p.canonical_participant_id IS NOT NULL",
    check: (d) => {
      const superseded = new Set(d.participants.filter((p) => p.canonical_participant_id).map((p) => p.participant_id));
      return d.pool_entries.filter((e) => superseded.has(e.participant_id))
        .map((e) => `entry ${e.pool_entry_id} points at a superseded participant`);
    },
  },

  // ── structure ──────────────────────────────────────────────────────────────
  {
    id: "DQ-ST-01", title: "pool without a competition edition", severity: S.HIGH,
    why: "an edition-less pool cannot appear in year-over-year reporting",
    sql: "SELECT pool_id FROM bolao.pools p WHERE NOT EXISTS (SELECT 1 FROM bolao.competition_editions e WHERE e.competition_edition_id=p.competition_edition_id)",
    check: (d) => {
      const E = ids(d.competition_editions, "competition_edition_id");
      return d.pools.filter((p) => !E.has(p.competition_edition_id)).map((p) => `pool ${p.pool_id} has no edition`);
    },
  },
  {
    id: "DQ-ST-02", title: "entry without a pool", severity: S.CRITICAL,
    why: "an entry with no pool has no fee, no ranking and no money boundary",
    sql: "SELECT pool_entry_id FROM bolao.pool_entries e WHERE NOT EXISTS (SELECT 1 FROM bolao.pools p WHERE p.pool_id=e.pool_id)",
    check: (d) => {
      const P = ids(d.pools, "pool_id");
      return d.pool_entries.filter((e) => !P.has(e.pool_id)).map((e) => `entry ${e.pool_entry_id} has no pool`);
    },
  },
  {
    id: "DQ-ST-03", title: "entry without a participant", severity: S.CRITICAL,
    why: "an unattributable entry cannot be scored, billed or reported",
    sql: "SELECT pool_entry_id FROM bolao.pool_entries e WHERE NOT EXISTS (SELECT 1 FROM bolao.participants p WHERE p.participant_id=e.participant_id)",
    check: (d) => {
      const P = ids(d.participants, "participant_id");
      return d.pool_entries.filter((e) => !P.has(e.participant_id)).map((e) => `entry ${e.pool_entry_id} has no participant`);
    },
  },
  {
    id: "DQ-ST-04", title: "duplicate entry identity (same participant, pool and label)",
    severity: S.HIGH,
    why: "multiple entries per pool are ALLOWED, but two with the same label are an accident, not an intent — entry_label is the only discriminator",
    sql: "SELECT participant_id, pool_id, entry_label, count(*) FROM bolao.pool_entries WHERE deleted_at IS NULL GROUP BY 1,2,3 HAVING count(*)>1",
    check: (d) => {
      const seen = new Map();
      for (const e of d.pool_entries) {
        if (e.deleted_at) continue;
        const k = `${e.participant_id}|${e.pool_id}|${norm(e.entry_label)}`;
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1).map(([, n]) => `${n} entries share (participant, pool, label)`);
    },
  },
  {
    id: "DQ-ST-05", title: "entry with a missing or blank label", severity: S.HIGH,
    why: "without a label, a deliberate second entry is indistinguishable from a duplicate",
    sql: "SELECT pool_entry_id FROM bolao.pool_entries WHERE entry_label IS NULL OR btrim(entry_label)=''",
    check: (d) => d.pool_entries.filter((e) => !String(e.entry_label ?? "").trim())
      .map((e) => `entry ${e.pool_entry_id} has no label`),
  },

  // ── financial ──────────────────────────────────────────────────────────────
  {
    id: "DQ-FN-01", title: "duplicate external payment reference", severity: S.CRITICAL,
    why: "the same provider reference recorded twice means one real payment counted twice",
    sql: "SELECT external_reference, count(*) FROM bolao.payments WHERE external_reference IS NOT NULL GROUP BY 1 HAVING count(*)>1",
    check: (d) => {
      const seen = new Map();
      for (const p of d.payments) {
        if (!p.external_reference) continue;
        seen.set(p.external_reference, (seen.get(p.external_reference) || 0) + 1);
      }
      // Never echo the reference itself — it is FINANCIAL/EXTERNAL_REFERENCE class.
      return [...seen.values()].filter((n) => n > 1).map((n) => `an external payment reference appears ${n} times`);
    },
  },
  {
    id: "DQ-FN-02", title: "payment amount sign contradicts its kind", severity: S.CRITICAL,
    why: "a positive refund or a negative contribution corrupts every downstream sum",
    sql: "SELECT payment_id FROM bolao.payments WHERE amount IS NOT NULL AND ((kind IN ('refund','reversal','chargeback') AND amount >= 0) OR (kind NOT IN ('refund','reversal','chargeback') AND amount <= 0))",
    check: (d) => {
      const out = [];
      for (const p of d.payments) {
        if (p.amount == null) continue;
        const outward = ["refund", "reversal", "chargeback"].includes(p.kind);
        if (outward && p.amount.minor >= 0) out.push(`payment ${p.payment_id} kind=${p.kind} must be negative`);
        if (!outward && p.amount.minor <= 0) out.push(`payment ${p.payment_id} kind=${p.kind} must be positive`);
      }
      return out;
    },
  },
  {
    id: "DQ-FN-03", title: "allocation exceeds its payment (over-allocation)", severity: S.CRITICAL,
    why: "you cannot allocate more of a payment than was received; this is the core financial invariant",
    sql: "SELECT p.payment_id FROM bolao.payments p JOIN bolao.payment_allocations a USING (payment_id) GROUP BY p.payment_id, p.amount HAVING sum(a.allocated_amount) > p.amount",
    check: (d) => {
      const out = [];
      for (const p of d.payments) {
        if (p.amount == null) continue;
        const allocs = d.payment_allocations.filter((a) => a.payment_id === p.payment_id);
        if (!allocs.length) continue;
        const u = unappliedBalance({ amount: p.amount }, allocs.map((a) => ({ amount: a.allocated_amount })));
        if (u && u.minor < 0) out.push(`payment ${p.payment_id} is over-allocated by ${-u.minor} minor units`);
      }
      return out;
    },
  },
  {
    id: "DQ-FN-04", title: "allocation to a nonexistent entry or payment", severity: S.CRITICAL,
    why: "an orphan allocation silently changes a settlement that no entry can account for",
    sql: "SELECT allocation_id FROM bolao.payment_allocations a WHERE NOT EXISTS (SELECT 1 FROM bolao.pool_entries e WHERE e.pool_entry_id=a.pool_entry_id) OR NOT EXISTS (SELECT 1 FROM bolao.payments p WHERE p.payment_id=a.payment_id)",
    check: (d) => {
      const E = ids(d.pool_entries, "pool_entry_id"), P = ids(d.payments, "payment_id");
      return d.payment_allocations.filter((a) => !E.has(a.pool_entry_id) || !P.has(a.payment_id))
        .map((a) => `allocation ${a.allocation_id} is orphaned`);
    },
  },
  {
    id: "DQ-FN-05", title: "cross-currency allocation", severity: S.CRITICAL,
    why: "allocating USD to a fee denominated in another currency produces arithmetic that is wrong, not approximate",
    sql: "SELECT a.allocation_id FROM bolao.payment_allocations a JOIN bolao.payments p USING(payment_id) JOIN bolao.pool_entries e USING(pool_entry_id) WHERE a.currency <> p.currency OR a.currency <> e.expected_fee_currency",
    check: (d) => {
      const P = new Map(d.payments.map((p) => [p.payment_id, p]));
      const E = new Map(d.pool_entries.map((e) => [e.pool_entry_id, e]));
      const out = [];
      for (const a of d.payment_allocations) {
        const p = P.get(a.payment_id), e = E.get(a.pool_entry_id);
        if (p?.amount && a.allocated_amount.currency !== p.amount.currency) out.push(`allocation ${a.allocation_id} currency ≠ payment currency`);
        if (e?.expected && a.allocated_amount.currency !== e.expected.currency) out.push(`allocation ${a.allocation_id} currency ≠ entry fee currency`);
      }
      return [...new Set(out)];
    },
  },
  {
    id: "DQ-FN-06", title: "settlement derivation disagrees with a stored status", severity: S.CRITICAL,
    why: "settlement must be DERIVED; a stored value that disagrees means someone cached a stale truth",
    sql: "-- compare a materialised settlement_status against the derived expression",
    check: (d) => {
      const out = [];
      for (const e of d.pool_entries) {
        if (!e.stored_settlement_status || !e.expected) continue;
        const allocs = d.payment_allocations.filter((a) => a.pool_entry_id === e.pool_entry_id);
        const allocated = sum(allocs.map((a) => a.allocated_amount), e.expected.currency);
        const derived = settlementStatus({ expected: e.expected, allocated, legacyAsserted: !!e.legacy_asserted });
        if (derived !== e.stored_settlement_status) {
          out.push(`entry ${e.pool_entry_id}: stored=${e.stored_settlement_status} derived=${derived}`);
        }
      }
      return out;
    },
  },
  {
    id: "DQ-FN-07", title: "impossible entry fee (zero, negative, or missing currency)", severity: S.CRITICAL,
    why: "a zero or currency-less expected fee makes every settlement classification meaningless",
    sql: "SELECT pool_entry_id FROM bolao.pool_entries WHERE expected_fee_amount <= 0 OR expected_fee_currency IS NULL",
    check: (d) => d.pool_entries.filter((e) => !e.expected || e.expected.minor <= 0 || !e.expected.currency)
      .map((e) => `entry ${e.pool_entry_id} has a non-positive or currency-less expected fee`),
  },
  {
    id: "DQ-FN-08", title: "more than one fee schedule in force for a pool", severity: S.HIGH,
    why: "two live prices for one pool makes the snapshotted fee non-deterministic",
    sql: "SELECT pool_id, count(*) FROM bolao.pool_fee_schedule WHERE effective_to IS NULL GROUP BY 1 HAVING count(*)>1",
    check: (d) => {
      const seen = new Map();
      for (const f of d.pool_fee_schedule) {
        if (f.effective_to) continue;
        seen.set(f.pool_id, (seen.get(f.pool_id) || 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1).map(([p, n]) => `pool ${p} has ${n} fee schedules in force`);
    },
  },
  {
    id: "DQ-FN-09", title: "prize allocation exceeds the declared pool prize pool", severity: S.CRITICAL,
    why: "paying out more than was collected is an unrecoverable financial error",
    sql: "SELECT pool_id FROM bolao.prize_allocations GROUP BY pool_id HAVING sum(gross_amount) > (SELECT sum(allocated_amount) ...)",
    check: (d) => {
      const out = [];
      const byPool = new Map();
      for (const z of d.prize_allocations) {
        if (!byPool.has(z.pool_id)) byPool.set(z.pool_id, []);
        byPool.get(z.pool_id).push(z);
      }
      for (const [poolId, prizes] of byPool) {
        const cur = prizes[0].gross.currency;
        const entriesInPool = new Set(d.pool_entries.filter((e) => e.pool_id === poolId).map((e) => e.pool_entry_id));
        const collected = sum(d.payment_allocations.filter((a) => entriesInPool.has(a.pool_entry_id))
          .map((a) => a.allocated_amount), cur);
        const awarded = sum(prizes.map((p) => p.gross), cur);
        if (cmp(awarded, collected) > 0) {
          out.push(`pool ${poolId}: prizes exceed collected by ${sub(awarded, collected).minor} minor units`);
        }
      }
      return out;
    },
  },
  {
    id: "DQ-FN-10", title: "orphan prize allocation, or participant inconsistent with its entry",
    severity: S.HIGH,
    why: "prize_allocations.participant_id is denormalised for reporting; if it drifts, winnings are attributed to the wrong person",
    sql: "SELECT prize_allocation_id FROM bolao.prize_allocations z JOIN bolao.pool_entries e USING (pool_entry_id) WHERE z.participant_id <> e.participant_id",
    check: (d) => {
      const E = new Map(d.pool_entries.map((e) => [e.pool_entry_id, e]));
      const out = [];
      for (const z of d.prize_allocations) {
        const e = E.get(z.pool_entry_id);
        if (!e) { out.push(`prize ${z.prize_allocation_id} references a missing entry`); continue; }
        if (z.participant_id !== e.participant_id) out.push(`prize ${z.prize_allocation_id} participant ≠ entry participant`);
      }
      return out;
    },
  },

  // ── prediction / result ────────────────────────────────────────────────────
  {
    id: "DQ-PR-01", title: "prediction without an entry, or without a subject", severity: S.HIGH,
    why: "an unattached prediction cannot be scored; a subject-less one is uninterpretable",
    sql: "SELECT prediction_id FROM bolao.predictions WHERE (match_id IS NOT NULL) = (tie_id IS NOT NULL) OR pool_entry_id NOT IN (SELECT pool_entry_id FROM bolao.pool_entries)",
    check: (d) => {
      const E = ids(d.pool_entries, "pool_entry_id");
      return d.predictions.filter((p) => !E.has(p.pool_entry_id) || (!!p.match_id === !!p.tie_id))
        .map((p) => `prediction ${p.prediction_id} has no entry or an invalid subject`);
    },
  },
  {
    id: "DQ-PR-02", title: "duplicate prediction for one entry and subject", severity: S.HIGH,
    why: "two predictions for one match means scoring is order-dependent",
    sql: "SELECT pool_entry_id, coalesce(match_id::text,tie_id::text), count(*) FROM bolao.predictions GROUP BY 1,2 HAVING count(*)>1",
    check: (d) => {
      const seen = new Map();
      for (const p of d.predictions) {
        const k = `${p.pool_entry_id}|${p.match_id || p.tie_id}`;
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      return [...seen.values()].filter((n) => n > 1).map((n) => `${n} predictions share (entry, subject)`);
    },
  },
  {
    id: "DQ-PR-03", title: "prediction submitted after the phase cutoff", severity: S.CRITICAL,
    why: "a prediction after lock is a fairness breach and directly affects who wins money",
    sql: "SELECT p.prediction_id FROM bolao.predictions p JOIN bolao.matches m USING(match_id) JOIN bolao.competition_edition_phases f USING(competition_edition_phase_id) WHERE f.cutoff_at IS NOT NULL AND p.submitted_at > f.cutoff_at",
    check: (d) => {
      const M = new Map(d.matches.map((m) => [m.match_id, m]));
      const F = new Map(d.competition_edition_phases.map((f) => [f.competition_edition_phase_id, f]));
      const out = [];
      for (const p of d.predictions) {
        const phaseId = p.match_id ? M.get(p.match_id)?.competition_edition_phase_id : null;
        const f = phaseId ? F.get(phaseId) : null;
        if (f?.cutoff_at && p.submitted_at && new Date(p.submitted_at) > new Date(f.cutoff_at)) {
          out.push(`prediction ${p.prediction_id} submitted after the phase cutoff`);
        }
      }
      return out;
    },
  },
  {
    id: "DQ-PR-04", title: "match result without a match, or conflicting official results",
    severity: S.CRITICAL,
    why: "two official current results for one match makes scoring non-deterministic",
    sql: "SELECT match_id, count(*) FROM bolao.match_results WHERE is_official AND superseded_by_id IS NULL GROUP BY 1 HAVING count(*)>1",
    check: (d) => {
      const M = ids(d.matches, "match_id");
      const out = d.match_results.filter((r) => !M.has(r.match_id)).map((r) => `result ${r.match_result_id} has no match`);
      const seen = new Map();
      for (const r of d.match_results) {
        if (!r.is_official || r.superseded_by_id) continue;
        seen.set(r.match_id, (seen.get(r.match_id) || 0) + 1);
      }
      for (const [m, n] of seen) if (n > 1) out.push(`match ${m} has ${n} official current results`);
      return out;
    },
  },
  {
    id: "DQ-PR-05", title: "missing result for a finished match", severity: S.HIGH,
    why: "a finished match with no result silently freezes scoring and blocks result emails",
    sql: "SELECT match_id FROM bolao.matches m WHERE m.status='finished' AND NOT EXISTS (SELECT 1 FROM bolao.match_results r WHERE r.match_id=m.match_id)",
    check: (d) => {
      const R = ids(d.match_results, "match_id");
      return d.matches.filter((m) => m.status === "finished" && !R.has(m.match_id))
        .map((m) => `finished match ${m.match_id} has no result`);
    },
  },

  // ── competition / ranking ──────────────────────────────────────────────────
  {
    id: "DQ-CP-01", title: "invalid phase transition (non-contiguous ordinals)", severity: S.MEDIUM,
    why: "a gap in phase ordinals means bracket progression cannot be validated",
    sql: "-- window function over ordinal per edition looking for gaps",
    check: (d) => {
      const byEd = new Map();
      for (const f of d.competition_edition_phases) {
        if (!byEd.has(f.competition_edition_id)) byEd.set(f.competition_edition_id, []);
        byEd.get(f.competition_edition_id).push(f.ordinal);
      }
      const out = [];
      for (const [ed, ords] of byEd) {
        const s = [...ords].sort((a, b) => a - b);
        for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1] + 1) out.push(`edition ${ed} has a phase-ordinal gap at ${s[i - 1]}→${s[i]}`);
      }
      return out;
    },
  },
  {
    id: "DQ-CP-02", title: "ranking snapshot inconsistency (duplicate position or missing rule version)",
    severity: S.HIGH,
    why: "a snapshot without its scoring rule version is uninterpretable; duplicate positions make a leaderboard ambiguous",
    sql: "SELECT pool_id, computed_at, position, count(*) FROM bolao.ranking_snapshots GROUP BY 1,2,3 HAVING count(*)>1",
    check: (d) => {
      const out = d.ranking_snapshots.filter((r) => !r.scoring_rule_version)
        .map((r) => `snapshot ${r.ranking_snapshot_id} has no scoring_rule_version`);
      const seen = new Map();
      for (const r of d.ranking_snapshots) {
        const k = `${r.pool_id}|${r.computed_at}|${r.position}`;
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      for (const [, n] of seen) if (n > 1) out.push(`${n} snapshot rows share (pool, computed_at, position)`);
      return out;
    },
  },

  // ── operations ─────────────────────────────────────────────────────────────
  {
    id: "DQ-OP-01", title: "stale sync state", severity: S.HIGH,
    why: "a cursor that has not succeeded recently means the provider snapshot is silently stale — the failure mode that produces no signal",
    sql: "SELECT sync_state_id FROM bolao.sync_state WHERE last_success_at IS NULL OR last_success_at < now() - interval '24 hours'",
    check: (d, opts = {}) => {
      const maxAgeMs = opts.staleSyncMs ?? 24 * 3600 * 1000;
      const now = opts.now ? new Date(opts.now).getTime() : Date.now();
      return d.sync_state.filter((s) => !s.last_success_at || now - new Date(s.last_success_at).getTime() > maxAgeMs)
        .map((s) => `sync_state ${s.sync_state_id} has not succeeded within the freshness window`);
    },
  },
  {
    id: "DQ-OP-02", title: "sync state points at a nonexistent phase or edition", severity: S.MEDIUM,
    why: "a cursor pointing at a deleted object will fail every run with a confusing error",
    sql: "SELECT sync_state_id FROM bolao.sync_state s WHERE s.active_phase_id IS NOT NULL AND NOT EXISTS (...)",
    check: (d) => {
      const F = ids(d.competition_edition_phases, "competition_edition_phase_id");
      const E = ids(d.competition_editions, "competition_edition_id");
      return d.sync_state.filter((s) => (s.active_phase_id && !F.has(s.active_phase_id)) || !E.has(s.competition_edition_id))
        .map((s) => `sync_state ${s.sync_state_id} references a missing domain object`);
    },
  },
  {
    id: "DQ-OB-01", title: "outbox attempt without an event", severity: S.HIGH,
    why: "an orphan attempt makes delivery forensics unreadable",
    sql: "SELECT outbox_delivery_attempt_id FROM bolao.outbox_delivery_attempts a WHERE NOT EXISTS (SELECT 1 FROM bolao.outbox_events e WHERE e.outbox_event_id=a.outbox_event_id)",
    check: (d) => {
      const O = ids(d.outbox_events, "outbox_event_id");
      return d.outbox_delivery_attempts.filter((a) => !O.has(a.outbox_event_id))
        .map((a) => `attempt ${a.outbox_delivery_attempt_id} has no event`);
    },
  },
  {
    id: "DQ-OB-02", title: "sent event with no successful attempt", severity: S.CRITICAL,
    why: "status=sent without evidence of a success is an unverifiable claim of delivery",
    sql: "SELECT outbox_event_id FROM bolao.outbox_events e WHERE e.status='sent' AND NOT EXISTS (SELECT 1 FROM bolao.outbox_delivery_attempts a WHERE a.outbox_event_id=e.outbox_event_id AND a.outcome='success')",
    check: (d) => d.outbox_events.filter((e) => e.status === "sent" &&
        !d.outbox_delivery_attempts.some((a) => a.outbox_event_id === e.outbox_event_id && a.outcome === "success"))
      .map((e) => `event ${e.outbox_event_id} claims sent with no successful attempt`),
  },
  {
    id: "DQ-OB-03", title: "retry count mismatch", severity: S.MEDIUM,
    why: "attempt_count drifting from the actual attempt rows means backoff decisions are made on a wrong number",
    sql: "SELECT e.outbox_event_id FROM bolao.outbox_events e LEFT JOIN bolao.outbox_delivery_attempts a USING(outbox_event_id) GROUP BY 1, e.attempt_count HAVING count(a.*) <> e.attempt_count",
    check: (d) => d.outbox_events.filter((e) =>
        d.outbox_delivery_attempts.filter((a) => a.outbox_event_id === e.outbox_event_id).length !== e.attempt_count)
      .map((e) => `event ${e.outbox_event_id} attempt_count disagrees with its attempt rows`),
  },
  {
    id: "DQ-OB-04", title: "dead event without terminal evidence", severity: S.HIGH,
    why: "a dead event is a LOST notification; without dead_at and a permanent failure it cannot be triaged",
    sql: "SELECT outbox_event_id FROM bolao.outbox_events WHERE status='dead' AND (dead_at IS NULL OR NOT EXISTS (SELECT 1 FROM bolao.outbox_delivery_attempts a WHERE a.outbox_event_id=outbox_event_id AND a.outcome='permanent_failure'))",
    check: (d) => d.outbox_events.filter((e) => e.status === "dead" && (!e.dead_at ||
        !d.outbox_delivery_attempts.some((a) => a.outbox_event_id === e.outbox_event_id && a.outcome === "permanent_failure")))
      .map((e) => `dead event ${e.outbox_event_id} lacks terminal evidence`),
  },
  {
    id: "DQ-AU-01", title: "audit event carrying PII-shaped metadata", severity: S.CRITICAL,
    why: "ratified decision B1 prohibits names, emails, phones and payment references in audit_events",
    sql: "-- pattern scan over safe_metadata for email/phone shapes",
    check: (d) => {
      const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
      const FORBIDDEN_KEYS = /(email|phone|display_name|payer_name|external_reference|memo)/i;
      const out = [];
      for (const e of d.audit_events) {
        const txt = JSON.stringify(e.safe_metadata ?? {});
        if (EMAIL.test(txt)) out.push(`audit ${e.audit_event_id} safe_metadata contains an email-shaped value`);
        for (const k of Object.keys(e.safe_metadata ?? {})) {
          if (FORBIDDEN_KEYS.test(k)) out.push(`audit ${e.audit_event_id} safe_metadata has a prohibited key`);
        }
      }
      return [...new Set(out)];
    },
  },
  {
    id: "DQ-AU-02", title: "audit hash chain broken", severity: S.CRITICAL,
    why: "an audit log whose chain does not verify provides no tamper evidence — worse than none, because the schema advertises it",
    sql: "-- walk previous_event_hash from the genesis row; do NOT order by occurred_at",
    check: (d) => {
      /**
       * The chain is walked by FOLLOWING previous_event_hash, not by sorting on occurred_at.
       *
       * Sorting on occurred_at was wrong and the scale harness proved it: two audit events written in the
       * same transaction legitimately share a timestamp, and any tie makes the sort order arbitrary — so a
       * perfectly intact chain reported ~109 breaks at SCALE-B while verifyChain() called the same data
       * valid. Two checks disagreeing about the same property means one is wrong, and it was this one.
       *
       * A hash chain defines its own order. That is the entire point of it, so the traversal must use it.
       */
      if (!d.audit_events.length) return [];
      const byPrev = new Map();
      const genesis = [];
      for (const e of d.audit_events) {
        if (e.previous_event_hash === null || e.previous_event_hash === undefined) { genesis.push(e); continue; }
        if (!byPrev.has(e.previous_event_hash)) byPrev.set(e.previous_event_hash, []);
        byPrev.get(e.previous_event_hash).push(e);
      }
      const out = [];
      if (genesis.length === 0) return [`no genesis audit event (none with a null previous_event_hash) — the chain has no start, so it cannot be verified`];
      if (genesis.length > 1) out.push(`${genesis.length} genesis audit events — a chain must have exactly one start`);
      const seen = new Set();
      let cur = genesis[0], walked = 0;
      while (cur) {
        if (seen.has(cur.audit_event_id)) { out.push(`audit chain revisits ${cur.audit_event_id} — the links form a cycle`); break; }
        seen.add(cur.audit_event_id);
        walked++;
        const next = byPrev.get(cur.event_hash) || [];
        if (next.length > 1) out.push(`${next.length} audit events claim ${cur.audit_event_id} as their predecessor — the chain forks`);
        cur = next[0];
      }
      if (walked !== d.audit_events.length) {
        out.push(`audit chain reaches ${walked} of ${d.audit_events.length} events — the remainder are unreachable, so a row was removed or its link was rewritten`);
      }
      return out;
    },
  },
];

export function runRules(dataset, opts = {}) {
  const d = { ...EMPTY, ...dataset };
  return RULES.map((r) => {
    let findings = [];
    let error = null;
    try { findings = r.check(d, opts) || []; }
    catch (e) { error = e.message; }
    return { id: r.id, title: r.title, severity: r.severity,
      status: error ? "ERROR" : findings.length ? "FAIL" : "PASS",
      findings, error };
  });
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
// Run-as-main detection by exact module URL. `endsWith("x.mjs")` is wrong: "test_x.mjs"
// also ends with "x.mjs", so importing this module from its own test suite would execute the CLI.
const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  if (argv.includes("--list")) {
    for (const r of RULES) console.log(`${r.id}\t${r.severity}\t${r.title}`);
    process.exit(0);
  }
  const ds = argv.find((a) => a.startsWith("--dataset="));
  const dataset = ds ? JSON.parse(readFileSync(ds.slice("--dataset=".length), "utf8")) : EMPTY;
  const results = runRules(dataset);
  const failed = results.filter((r) => r.status !== "PASS");
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ rules: RULES.length, results, verdict: failed.length ? "FAIL" : "PASS" }, null, 2));
  } else {
    console.log(`\nData-quality rules (${RULES.length})\n`);
    for (const r of results) {
      const icon = r.status === "PASS" ? "✓" : r.status === "ERROR" ? "!" : "✗";
      console.log(`  ${icon} ${r.id} [${r.severity}] ${r.title}`);
      for (const f of r.findings) console.log(`        ${f}`);
      if (r.error) console.log(`        ERROR: ${r.error}`);
    }
    console.log(`\n  ${results.filter((r) => r.status === "PASS").length} pass, ${failed.length} fail/error\n`);
  }
  process.exit(failed.length ? 1 : 0);
}
