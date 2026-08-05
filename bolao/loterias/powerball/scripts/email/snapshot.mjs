// snapshot.mjs — pure data loading, no decisions, no side effects.
import { loadRealPrizeCalculator } from "./prize-calc-bridge.mjs";

let cache = null;
function real() {
  if (!cache) cache = loadRealPrizeCalculator();
  return cache;
}

/** Loads every draw and a specific draw by id, straight from js/data.js. */
export function loadDrawSnapshot(drawId) {
  const { DRAWS, GAME_TYPES } = real();
  const draw = DRAWS.find((d) => d.id === drawId);
  if (!draw) return null;
  const gt = GAME_TYPES[draw.gameType] || GAME_TYPES.powerball;
  // Deep freeze-by-clone: callers get an immutable snapshot, never the live object.
  return JSON.parse(JSON.stringify({ ...draw, gameTypeMeta: { label: gt.label, icon: gt.icon, specialBallLabel: gt.specialBallLabel } }));
}

/** Loads a single participant snapshot (by name, case-sensitive exact match — matches data.js convention). */
export function loadParticipantSnapshot(drawId, participantName) {
  const draw = loadDrawSnapshot(drawId);
  if (!draw) return null;
  const p = draw.participants.find((x) => x.name === participantName);
  return p ? JSON.parse(JSON.stringify(p)) : null;
}

/** Reuses the REAL site prize-calculation function. No formula duplicated here. */
export function loadFinancialEstimates(drawId, participantName) {
  const { calculatePrizePerParticipant } = real();
  const draw = loadDrawSnapshot(drawId);
  if (!draw) return null;
  const p = draw.participants.find((x) => x.name === participantName);
  if (!p) return null;
  return calculatePrizePerParticipant(draw, p);
}

/** Exposed for tests that want the frozen raw draw list. */
export function loadAllDraws() {
  return real().DRAWS;
}
