// prize-calc-bridge.mjs
//
// Loads the REAL js/data.js + js/app.js source files (unmodified logic) inside a
// Node `vm` sandbox with a minimal DOM shim, and returns the exact
// `calculatePrizePerParticipant` function the public site uses.
//
// This is the single reuse point required by CLAUDE.md: "Reuse the existing
// prize-calculation function as the source of truth — do not reimplement lump
// sum, annuity, or tax logic." No formula is duplicated here.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POWERBALL_DIR = path.join(__dirname, "..", "..");

function makeDomShim() {
  const listeners = {};
  const el = () => ({
    style: {},
    innerHTML: "",
    textContent: "",
    href: "",
    addEventListener: () => {},
    querySelectorAll: () => [],
  });
  return {
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    getElementById: () => el(),
    querySelectorAll: () => [],
    documentElement: { style: { setProperty: () => {} } },
    title: "",
  };
}

/**
 * Returns { calculatePrizePerParticipant, DRAWS, GAME_TYPES } sourced straight
 * from the real site files.
 */
export function loadRealPrizeCalculator() {
  const dataSrc = fs.readFileSync(path.join(POWERBALL_DIR, "js", "data.js"), "utf8");
  const appSrc = fs.readFileSync(path.join(POWERBALL_DIR, "js", "app.js"), "utf8");

  const sandbox = {
    window: {},
    document: makeDomShim(),
    console,
    fetch: () => Promise.reject(new Error("network disabled in test sandbox")),
    localStorage: {
      _store: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
      setItem(k, v) { this._store[k] = String(v); },
    },
    setInterval: () => 0,
    clearInterval: () => {},
    Date,
  };
  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(dataSrc, sandbox, { filename: "data.js" });
  // app.js fires a DOMContentLoaded listener at load; our shim's
  // addEventListener just records it without invoking it, so no rendering runs.
  vm.runInContext(appSrc, sandbox, { filename: "app.js" });

  const calc = sandbox.window.POWERBALL_PRIZE_CALC;
  if (!calc || typeof calc.calculatePrizePerParticipant !== "function") {
    throw new Error(
      "window.POWERBALL_PRIZE_CALC.calculatePrizePerParticipant not found — " +
      "js/app.js must expose it for reuse (see app.js comment near renderTable)."
    );
  }
  return {
    calculatePrizePerParticipant: calc.calculatePrizePerParticipant,
    DRAWS: sandbox.window.POWERBALL_DRAWS,
    GAME_TYPES: sandbox.window.LOTTERY_GAME_TYPES,
  };
}
