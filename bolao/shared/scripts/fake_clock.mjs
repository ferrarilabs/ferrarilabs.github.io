// fake_clock.mjs — injectable clock for deterministic tests (football-hardening checkpoint D).
// Every module in this pipeline (state machine, outbox, reconciler) takes a `clock` object
// instead of calling Date.now()/new Date() directly, so tests never depend on real sleep or
// wall-clock timing — they just advance a fake clock and re-invoke the reconciler.

export function makeFakeClock(startIso = "2026-08-12T20:30:00Z") {
  let now = new Date(startIso).getTime();
  return {
    nowMs: () => now,
    nowIso: () => new Date(now).toISOString(),
    advanceMs: (ms) => { now += ms; },
    advanceMinutes: (min) => { now += min * 60000; },
  };
}

export function makeRealClock() {
  return {
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString(),
    advanceMs: () => { throw new Error("real clock cannot be advanced"); },
    advanceMinutes: () => { throw new Error("real clock cannot be advanced"); },
  };
}
