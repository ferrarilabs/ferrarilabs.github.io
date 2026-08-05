// match_store.mjs — persisted (file-backed) match state records (football-hardening
// checkpoint D). Deliberately tiny: this is NOT a replacement for each app's own real
// scoring/result state (bolao_copa_2026_state / bolao_state Supabase rows, etc.) — it only
// tracks the OPERATIONAL lifecycle (see match_state_machine.mjs) of "has this match's result
// been confirmed/persisted/notified", so the reconciler has something durable to inspect after
// a lost process run. Same atomic-write discipline as notification_outbox.mjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newMatchRecord, transition } from "./match_state_machine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultMatchStorePath() {
  return path.join(__dirname, "match_store.json");
}

export function readAll(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function writeAll(records, file) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export function getOrCreate(matchId, clock, file = defaultMatchStorePath()) {
  const records = readAll(file);
  if (records[matchId]) return records[matchId];
  const rec = newMatchRecord(matchId, clock);
  records[matchId] = rec;
  writeAll(records, file);
  return rec;
}

export function get(matchId, file = defaultMatchStorePath()) {
  return readAll(file)[matchId] || null;
}

/** Applies a state transition and persists it. Also supports carrying a `resultPayload` +
 * bumping `resultVersion` for the final_confirmed -> result_persisted step, and re-bumping
 * resultVersion again on a correction (a correction is ALWAYS a new version, never an in-place
 * overwrite of the previous payload — see checkpoint D requirement 3). */
export function applyTransition(matchId, to, clock, file = defaultMatchStorePath(), meta = {}) {
  const records = readAll(file);
  const current = records[matchId] || newMatchRecord(matchId, clock);
  const next = transition(current, to, clock, meta);
  if (meta.resultPayload !== undefined) {
    // Only a genuinely DIFFERENT payload counts as a new version — re-passing the same
    // resultPayload on an idempotent/recovery transition (e.g. the reconciler advancing
    // final_confirmed -> result_persisted) must never bump the version, or every reconciler
    // pass would look like a fresh correction and re-trigger notifications for no reason.
    const changed = JSON.stringify(current.resultPayload) !== JSON.stringify(meta.resultPayload);
    next.resultPayload = meta.resultPayload;
    if (changed) next.resultVersion = (current.resultVersion || 0) + 1;
  }
  records[matchId] = next;
  writeAll(records, file);
  return next;
}

export function listByState(state, file = defaultMatchStorePath()) {
  return Object.values(readAll(file)).filter((r) => r.state === state);
}

export function listAll(file = defaultMatchStorePath()) {
  return Object.values(readAll(file));
}
