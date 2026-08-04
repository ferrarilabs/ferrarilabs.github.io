/**
 * classify.mjs — strict-tolerance classifier + FORENSIC-ALLOWLIST.json validator.
 *
 * Verdicts: IDENTICAL / WITHIN_TOLERANCE / FUNCTIONALLY_JUSTIFIED / DIVERGENT / N/A.
 * No "visually close" verdict exists. FUNCTIONALLY_JUSTIFIED requires an approved,
 * non-expired, exact-app-set FORENSIC-ALLOWLIST.json entry -- component+property alone is
 * never sufficient (see validateEntry()). Unused/expired/pending entries never suppress a
 * finding and are reported as their own failure category by the caller.
 */
import { readFileSync } from "node:fs";

// Numeric tolerances in px for geometry/box properties; all others require exact string equality
// (color, font-family, display, etc. have zero tolerance by definition -- a string either matches
// or it doesn't).
const PX_TOLERANCE_ZERO = new Set([
  "fontSize", "lineHeight", "letterSpacing",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "gap", "rowGap", "columnGap",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
]);
const PX_TOLERANCE_ONE = new Set(["width", "minWidth", "maxWidth", "height", "minHeight", "maxHeight"]);
const GEOMETRY_TOLERANCE_ONE = new Set(["x", "y", "width", "height", "top", "right", "bottom", "left"]);

function parsePx(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^(-?\d+(\.\d+)?)px$/);
  return m ? parseFloat(m[1]) : null;
}

export function compareStyleValue(property, a, b) {
  if (a === b) return { equal: true, withinTolerance: false };
  if (PX_TOLERANCE_ZERO.has(property) || PX_TOLERANCE_ONE.has(property)) {
    const pa = parsePx(a), pb = parsePx(b);
    if (pa !== null && pb !== null) {
      const tol = PX_TOLERANCE_ONE.has(property) ? 1 : 0;
      if (Math.abs(pa - pb) <= tol) return { equal: false, withinTolerance: true };
    }
  }
  return { equal: false, withinTolerance: false };
}

export function compareGeometryValue(field, a, b) {
  if (a === b) return { equal: true, withinTolerance: false };
  if (typeof a === "number" && typeof b === "number" && GEOMETRY_TOLERANCE_ONE.has(field)) {
    if (Math.abs(a - b) <= 1) return { equal: false, withinTolerance: true };
  }
  return { equal: false, withinTolerance: false };
}

const REQUIRED_FIELDS = ["component", "property", "apps", "expectedValues", "condition", "approvalStatus", "approvedBy", "expiresAt"];

function isoDateInPast(iso) {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  return isNaN(d.getTime()) ? null : d.getTime() < Date.now();
}

export function validateEntrySchema(entry, index, knownApps) {
  const problems = [];
  for (const f of REQUIRED_FIELDS) {
    if (entry[f] === undefined || entry[f] === null || entry[f] === "") problems.push(`entrada #${index}: campo obrigatório ausente "${f}"`);
  }
  if (problems.length) return problems; // don't cascade further checks on a structurally broken entry
  if (!Array.isArray(entry.apps) || entry.apps.length === 0) problems.push(`entrada #${index} (${entry.component}:${entry.property}): "apps" deve ser um array não vazio`);
  else {
    for (const a of entry.apps) if (!knownApps.includes(a)) problems.push(`entrada #${index} (${entry.component}:${entry.property}): app desconhecido "${a}"`);
  }
  if (typeof entry.expectedValues !== "object") problems.push(`entrada #${index} (${entry.component}:${entry.property}): "expectedValues" deve ser um objeto`);
  else if (Array.isArray(entry.apps)) {
    for (const a of entry.apps) if (!(a in entry.expectedValues)) problems.push(`entrada #${index} (${entry.component}:${entry.property}): "expectedValues" não tem valor para app "${a}"`);
  }
  if (!["approved", "pending"].includes(entry.approvalStatus)) problems.push(`entrada #${index} (${entry.component}:${entry.property}): approvalStatus inválido "${entry.approvalStatus}"`);
  if (entry.approvalStatus === "approved" && !entry.approvedBy) problems.push(`entrada #${index} (${entry.component}:${entry.property}): approved sem approvedBy`);
  const expired = isoDateInPast(entry.expiresAt);
  if (expired === null) problems.push(`entrada #${index} (${entry.component}:${entry.property}): expiresAt inválido "${entry.expiresAt}"`);
  return problems;
}

export function loadAllowlist(path, knownApps) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const schemaProblems = [];
  const map = new Map();
  (raw.entries || []).forEach((entry, i) => {
    const problems = validateEntrySchema(entry, i, knownApps);
    if (problems.length) { schemaProblems.push(...problems); return; }
    const key = `${entry.component}:${entry.property}`;
    map.set(key, { ...entry, used: false });
  });
  return { map, schemaProblems, raw };
}

/**
 * classify(component, property, valuesByApp, allowlist, opts)
 *   valuesByApp: { copa2026: <value>|null, br2026: <value>|null, cdb2026: <value>|null }
 *   opts.isGeometry: use geometry tolerance (1px) instead of style tolerance table
 * Returns { status, reason }.
 */
// Part 9: opts.naReasonByApp = { app: "LEGITIMATE_NA"|"MISSING_SELECTOR"|"MISSING_FIXTURE"|
// "MISSING_COMPONENT"|"CAPTURE_FAILURE" } -- one entry per app whose value is null/undefined here.
// The gate (main.mjs) fails on any reason other than LEGITIMATE_NA; the generic bucket this
// classifier used to return ("componente não presente...") is never emitted anymore -- every N/A
// carries an explicit, caller-supplied reason code, or defaults to MISSING_COMPONENT if the
// caller didn't supply one (treated as a failure, since an unclassified N/A must never pass
// silently).
export function classify(component, property, valuesByApp, allowlist, opts = {}) {
  const present = Object.entries(valuesByApp).filter(([, v]) => v !== null && v !== undefined);
  if (present.length <= 1) {
    const naReasonByApp = opts.naReasonByApp || {};
    const missingApps = Object.keys(valuesByApp).filter((a) => valuesByApp[a] === null || valuesByApp[a] === undefined);
    const reasons = {};
    for (const app of missingApps) reasons[app] = naReasonByApp[app] || "MISSING_COMPONENT";
    // Worst-reason-wins: if ANY app's absence is unexplained/structural-bug, the whole cell is
    // reported under that reason, not silently averaged into LEGITIMATE_NA.
    const nonLegit = Object.values(reasons).filter((r) => r !== "LEGITIMATE_NA");
    const naReason = nonLegit.length ? nonLegit[0] : "LEGITIMATE_NA";
    return { status: "N/A", reason: `${naReason}: ${JSON.stringify(reasons)}`, naReason, naReasonsByApp: reasons };
  }

  const [, firstVal] = present[0];
  let allIdentical = true, allWithinTolerance = true;
  for (const [, v] of present) {
    const cmp = opts.isGeometry ? compareGeometryValue(property, firstVal, v) : compareStyleValue(property, firstVal, v);
    if (!cmp.equal) allIdentical = false;
    if (!cmp.equal && !cmp.withinTolerance) allWithinTolerance = false;
  }
  if (allIdentical) return { status: "IDENTICAL", reason: null };
  if (allWithinTolerance) return { status: "WITHIN_TOLERANCE", reason: `diferença dentro da tolerância máxima (${opts.isGeometry ? "1px geometria" : "ver TOLERANCES"})` };

  const entry = allowlist.get(`${component}:${property}`);
  if (!entry) return { status: "DIVERGENT", reason: null };

  const presentAppSet = new Set(present.map(([app]) => app));
  const entryAppSet = new Set(entry.apps);
  const sameSet = presentAppSet.size === entryAppSet.size && [...presentAppSet].every((a) => entryAppSet.has(a));
  if (!sameSet) return { status: "DIVERGENT", reason: `ALLOWLIST STALE: conjunto de apps não bate (entrada: ${entry.apps.join(",")}; achado: ${[...presentAppSet].join(",")})` };

  if (entry.approvalStatus !== "approved") return { status: "DIVERGENT", reason: "PENDING APPROVAL: entrada não aprovada não pode converter DIVERGENT em JUSTIFIED" };
  if (isoDateInPast(entry.expiresAt)) return { status: "DIVERGENT", reason: `EXPIRED: expiresAt (${entry.expiresAt}) já passou` };

  // "content-driven" is the one wildcard sentinel this classifier accepts: for properties whose
  // real value is legitimately never fixed (height driven by variable fixture content, e.g.), the
  // allowlist entry documents WHY it varies instead of pinning a value that would go stale on the
  // very next real content change. Every other value must match expectedValues exactly -- this is
  // the ONLY exception, and it must still be typed out explicitly per app, never left blank.
  for (const [app, v] of present) {
    const expected = entry.expectedValues[app];
    if (expected === "content-driven") continue;
    if (String(expected) !== String(v)) {
      return { status: "DIVERGENT", reason: `VALUE DRIFT: valor atual de "${app}" (${v}) não bate com expectedValues (${expected})` };
    }
  }

  entry.used = true;
  return { status: "FUNCTIONALLY_JUSTIFIED", reason: `${entry.condition} [approvedBy: ${entry.approvedBy}; expiresAt: ${entry.expiresAt}]` };
}
