// match_state_machine.mjs — shared match/notification state machine (football-hardening
// checkpoint D). Same 12 states across Copa2026/BR2026/CDB2026; each app's own result-persistence
// and scoring logic is untouched — this module ONLY governs the operational lifecycle of "has
// this match's result been confirmed, persisted, and its notifications sent exactly once."
//
// States (exact set required):
//   scheduled -> live -> final_pending_confirmation -> final_confirmed -> result_persisted
//     -> notifications_pending -> notifications_processing
//       -> notifications_complete | notifications_partial_failure
//   reconciliation_required is reachable from any of the confirmation/persistence/notification
//   states when something needs the reconciler's attention (lost run, stuck job, etc.) and can
//   route back into the pipeline once resolved.
//   postponed / cancelled are terminal-ish side branches from scheduled/live.

export const STATES = Object.freeze([
  "scheduled",
  "live",
  "final_pending_confirmation",
  "final_confirmed",
  "result_persisted",
  "notifications_pending",
  "notifications_processing",
  "notifications_complete",
  "notifications_partial_failure",
  "reconciliation_required",
  "postponed",
  "cancelled",
]);

const TRANSITIONS = Object.freeze({
  scheduled: ["live", "postponed", "cancelled"],
  live: ["final_pending_confirmation", "postponed", "cancelled"],
  final_pending_confirmation: ["final_confirmed", "reconciliation_required"],
  final_confirmed: ["result_persisted", "reconciliation_required"],
  result_persisted: ["notifications_pending", "reconciliation_required"],
  notifications_pending: ["notifications_processing", "reconciliation_required"],
  notifications_processing: ["notifications_complete", "notifications_partial_failure", "reconciliation_required"],
  notifications_partial_failure: ["notifications_processing", "reconciliation_required"],
  reconciliation_required: ["final_pending_confirmation", "final_confirmed", "result_persisted", "notifications_pending", "notifications_processing"],
  // A correction (new result version) can arrive even after notifications fully completed —
  // e.g. a post-match review changes the score. That re-opens the pipeline via
  // reconciliation_required rather than mutating the completed record in place.
  notifications_complete: ["reconciliation_required"],
  postponed: ["scheduled", "cancelled"],
  cancelled: [],
});

export function canTransition(from, to) {
  if (!STATES.includes(from) || !STATES.includes(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

/** Pure function: never mutates the input record, returns a NEW record (append-only history —
 * a correction is a new event, never an in-place mutation of a past transition). Throws on an
 * illegal transition rather than silently coercing the state, so a bug that tries to skip a
 * required step (e.g. straight from live to notifications_complete) fails loudly. */
export function transition(matchRecord, to, clock, meta = {}) {
  if (!canTransition(matchRecord.state, to)) {
    throw new Error(`illegal transition: ${matchRecord.state} -> ${to} (match ${matchRecord.matchId})`);
  }
  const at = clock.nowIso();
  return {
    ...matchRecord,
    state: to,
    updatedAt: at,
    history: [...(matchRecord.history || []), { from: matchRecord.state, to, at, ...meta }],
  };
}

export function newMatchRecord(matchId, clock) {
  return { matchId, state: "scheduled", updatedAt: clock.nowIso(), history: [], resultVersion: 0 };
}
