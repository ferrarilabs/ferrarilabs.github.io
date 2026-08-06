// snapshot.mjs — pure data loading, no decisions, no side effects.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRealPrizeCalculator } from "./prize-calc-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cache = null;
function real() {
  if (!cache) cache = loadRealPrizeCalculator();
  return cache;
}

// js/data.js is PUBLIC (served directly to browsers on GitHub Pages) and no
// longer carries participant email/txId (P0.1 PII hotfix, 2026-08). Those
// fields now come from either the POWERBALL_PRIVATE_PARTICIPANT_DATA env var
// (CI / secret-backed) or a local-only, gitignored sidecar file (manual runs).
let privateCache = null;
function loadPrivateParticipantData() {
  if (privateCache) return privateCache;
  privateCache = {};

  const raw = process.env.POWERBALL_PRIVATE_PARTICIPANT_DATA;
  if (raw) {
    try {
      privateCache = JSON.parse(raw);
      return privateCache;
    } catch {
      // fall through to local file
    }
  }

  const sidecarPath = path.join(__dirname, "..", "private-participant-data.local.json");
  if (fs.existsSync(sidecarPath)) {
    try {
      privateCache = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    } catch {
      privateCache = {};
    }
  }
  return privateCache;
}

// Deterministic normalization for the transitional name-based matching key
// (P0.2 gate) — trim, collapse internal whitespace, casefold. See
// docs/bolao/loterias/POWERBALL_PRIVATE_DATA_SECRET_CONTRACT.md
// (MATCHING_MODEL = TRANSITIONAL_NAME_BASED).
function normalizeName(name) {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Non-reversible short identifier for logs — never the raw name/email.
function shortHash(value) {
  // Lightweight FNV-1a hash (no crypto import needed) — collision-detection
  // logging only, never a security boundary by itself.
  let h = 0x811c9dc5;
  for (const ch of String(value)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

const collisionCheckedDraws = new Set();

function resolvedPrivateDrawMap(drawId) {
  const drawPrivate = loadPrivateParticipantData()[drawId] || {};

  // Fail-closed collision check, once per draw per process: if two distinct
  // raw keys in the private data normalize to the same matching key, refuse
  // to serve private fields for this draw at all rather than guessing.
  if (!collisionCheckedDraws.has(drawId)) {
    collisionCheckedDraws.add(drawId);
    const seen = new Map();
    const collisions = [];
    for (const rawName of Object.keys(drawPrivate)) {
      const key = normalizeName(rawName);
      if (seen.has(key) && seen.get(key) !== rawName) collisions.push(key);
      seen.set(key, rawName);
    }
    if (collisions.length > 0) {
      console.error(
        `Name collision in private data for draw ${drawId}: ${collisions.length} ` +
        `normalized-key collision(s) (hashes: ${collisions.map(shortHash).join(", ")}) — refusing to serve private fields for this draw.`
      );
      return {};
    }
  }

  return drawPrivate;
}

function withPrivateFields(drawId, participant) {
  if (!participant) return participant;
  const drawPrivate = resolvedPrivateDrawMap(drawId);
  if (Object.keys(drawPrivate).length === 0) return participant;

  const targetKey = normalizeName(participant.name);
  const matchName = Object.keys(drawPrivate).find((n) => normalizeName(n) === targetKey);
  const fields = matchName ? drawPrivate[matchName] : undefined;
  if (!fields) return participant;
  return { ...participant, email: fields.email, txId: fields.txId };
}

/** Loads every draw and a specific draw by id, straight from js/data.js (public fields)
 *  merged with private email/txId from the env var or local sidecar file. */
export function loadDrawSnapshot(drawId) {
  const { DRAWS, GAME_TYPES } = real();
  const draw = DRAWS.find((d) => d.id === drawId);
  if (!draw) return null;
  const gt = GAME_TYPES[draw.gameType] || GAME_TYPES.powerball;
  // Deep freeze-by-clone: callers get an immutable snapshot, never the live object.
  const cloned = JSON.parse(JSON.stringify({ ...draw, gameTypeMeta: { label: gt.label, icon: gt.icon, specialBallLabel: gt.specialBallLabel } }));
  cloned.participants = (cloned.participants || []).map((p) => withPrivateFields(drawId, p));
  return cloned;
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

/** Exposed for tests that want the frozen raw draw list, with private
 *  email/txId merged in per draw (same merge as loadDrawSnapshot). */
export function loadAllDraws() {
  const draws = JSON.parse(JSON.stringify(real().DRAWS));
  return draws.map((draw) => ({
    ...draw,
    participants: (draw.participants || []).map((p) => withPrivateFields(draw.id, p)),
  }));
}
