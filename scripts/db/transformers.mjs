#!/usr/bin/env node
/**
 * Legacy JSON → normalized record transformers (Workstream 7).
 *
 * SEPARATION OF CONCERNS — the reason these exist separately from the backfill
 * The backfill framework previously did its own transformation inline. That conflated two different jobs:
 * deciding what a legacy field MEANS, and getting rows durably into a target. They fail differently, they
 * are reviewed by different people, and only one of them is pure. So:
 *
 *   SOURCE EXTRACTION → TRANSFORMATION → VALIDATION → BACKFILL WRITE → RECONCILIATION
 *                        ^^^^^^^^^^^^^^   ^^^^^^^^^^
 *                        this module only
 *
 * Every function here is PURE: same input, same output, no I/O, no clock, no randomness, no database. That
 * is what makes a disagreement about interpretation reviewable in a test rather than in a migration window.
 *
 * NOTHING IS SILENTLY DISCARDED. A transformer that cannot interpret a field says so, in one of four
 * categories, and the caller decides. The categories are not interchangeable:
 *
 *   WARNING   interpreted, but something was odd and a human should see it
 *   UNKNOWN   genuinely not knowable from the legacy state. Not a bug — an honest gap
 *   CONFLICT  two pieces of legacy evidence disagree; picking one would be a guess
 *   FATAL     the transformation cannot proceed. For money, ambiguity is ALWAYS fatal
 *
 * WHY MONEY AMBIGUITY IS FATAL RATHER THAN UNKNOWN
 * An UNKNOWN payer can be resolved later by an operator. An UNKNOWN *amount* silently becomes a wrong pool
 * total the moment anything sums it. So a money-bearing transformer that cannot prove a value refuses to
 * emit a record at all, and says why.
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseMoney, formatMoney } from "./financial.mjs";

/**
 * A money amount as the relational model stores it: an exact decimal string in MAJOR units, with no
 * currency attached (the currency travels in its own column). `formatMoney` is the single canonical
 * renderer, so this takes its output rather than performing a second division by 100.
 */
const majorAmount = (m) => formatMoney(m).split(" ")[0];

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const fold = (s) => norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const SEVERITY = { WARNING: "WARNING", UNKNOWN: "UNKNOWN", CONFLICT: "CONFLICT", FATAL: "FATAL" };

export const COVERAGE = {
  MAPPED: "MAPPED",
  DERIVED: "DERIVED",
  ARCHIVED: "ARCHIVED",
  INTENTIONALLY_DROPPED: "INTENTIONALLY_DROPPED",
  UNKNOWN: "UNKNOWN",
};

/**
 * Known legacy shapes, from repository evidence only — no participant data was inspected to build this.
 *
 * The classification matters because the newest parser is NOT automatically safe on an older shape. A field
 * that changed meaning between versions is the worst case: the parser succeeds and produces a wrong answer.
 */
export const LEGACY_VERSIONS = {
  "v4-copa": {
    status: "SUPPORTED",
    evidence: "bolao/copa2026 state: entries[] with picks keyed by match id, paid{} boolean map, deletedIds[], auditLog[], results{} object",
    notes: "the shape the parity harness was built against and is exercised by every fixture",
  },
  "v4-br": {
    status: "SUPPORTED_WITH_WARNINGS",
    evidence: "bolao/br2026 state: same envelope but `results` is null rather than an object (finding T-18)",
    notes: "results:null must read as 'no results recorded', never as an empty object that was written deliberately",
  },
  "v4-cdb": {
    status: "SUPPORTED",
    evidence: "bolao/cdb2026 state: knockout shape; picks carry an advancing team alongside goals",
    notes: "advancement is explicit; it must never be inferred from goals",
  },
  "v3-pre-audit": {
    status: "PARTIAL",
    evidence: "referenced by CHANGELOG history as predating auditLog[]",
    notes: "no audit log exists, so audit backfill for this shape yields nothing. That is a real absence, not a transformation failure.",
  },
  UNKNOWN: {
    status: "UNKNOWN",
    evidence: "any sourceVersion not listed above",
    notes: "fails closed for money-bearing transformers: a shape nobody has characterised may have used a field differently",
  },
};

export function classifyVersion(sourceVersion) {
  const v = LEGACY_VERSIONS[sourceVersion];
  return v ? { version: sourceVersion, ...v } : { version: sourceVersion ?? null, ...LEGACY_VERSIONS.UNKNOWN };
}

/**
 * Detect which characterised legacy shape a state document actually IS, from its structure.
 *
 * KPLUS-F005. The keys of LEGACY_VERSIONS — `v4-copa`, `v4-br`, `v4-cdb` — are analytical labels coined
 * by WS7. They appear NOWHERE in the data. Production `bolao_state` documents carry `meta.version`,
 * whose values are SITE versions (`v4.99`, `v1.47`, `v3.94`), and no `meta.schemaVersion` at all. So a
 * caller threading `state.meta.schemaVersion` into `ctx.sourceVersion` gets `undefined`, every pool
 * classifies UNKNOWN, and all three money-bearing transformers fail closed on 100% of real data. The
 * fail-closed behaviour is correct; what was missing is any way for it to ever pass.
 *
 * The shape is therefore read from STRUCTURE, not from a version string — which is the stronger signal
 * anyway. A site version is a release label that can be bumped without the state shape changing at all,
 * whereas these discriminators ARE the differences the transformers care about:
 *
 *   v4-cdb  `phases` present — the knockout envelope. No other shape has it.
 *   v4-br   `results` present and NULL — finding T-18: "no results recorded", never an empty object.
 *   v4-copa `results` present and an object — the shape every fixture exercises.
 *
 * Deliberately conservative in both directions. Anything that does not match exactly one signature
 * returns UNKNOWN, so an unrecognised or future shape still fails closed for money. And matching more
 * than one signature returns UNKNOWN too, because an ambiguous document is not a characterised one.
 *
 * This detector decides which characterised shape the data is. It does NOT decide anything financial,
 * and it cannot make an uncharacterised shape passable.
 */
export function detectLegacyShape(legacyState) {
  const s = legacyState;
  if (!s || typeof s !== "object" || Array.isArray(s)) {
    return { version: null, detected: false, why: "not a state object", ...LEGACY_VERSIONS.UNKNOWN };
  }
  const has = (k) => Object.prototype.hasOwnProperty.call(s, k);

  const signatures = [
    { version: "v4-cdb", match: has("phases"), why: "`phases` present — the knockout envelope, unique to the Copa do Brasil shape" },
    { version: "v4-br", match: has("results") && s.results === null, why: "`results` present and null — T-18: no results recorded, not an empty object" },
    { version: "v4-copa", match: has("results") && s.results !== null && typeof s.results === "object" && !Array.isArray(s.results), why: "`results` present as an object — the shape the parity harness was built against" },
  ];
  const hits = signatures.filter((x) => x.match);

  if (hits.length === 1) {
    const hit = hits[0];
    return { version: hit.version, detected: true, why: hit.why, ...LEGACY_VERSIONS[hit.version] };
  }
  return {
    version: null, detected: false,
    why: hits.length === 0
      ? "no characterised signature matched — an uncharacterised shape may have used a field differently, so money-bearing transforms must not run"
      : `ambiguous: matched ${hits.map((h) => h.version).join(" and ")} — a document matching two signatures is not a characterised one`,
    ...LEGACY_VERSIONS.UNKNOWN,
  };
}

/** A transformer result. Frozen so a caller cannot quietly amend the findings it was given. */
function result({ records = [], findings = [], coverage = {}, evidence = {} } = {}) {
  const by = (sev) => findings.filter((f) => f.severity === sev);
  return Object.freeze({
    records,
    warnings: by(SEVERITY.WARNING),
    unknowns: by(SEVERITY.UNKNOWN),
    conflicts: by(SEVERITY.CONFLICT),
    fatals: by(SEVERITY.FATAL),
    findings,
    coverage,
    evidence: Object.freeze({ ...evidence, recordCount: records.length, digest: digestRecords(records) }),
    ok: by(SEVERITY.FATAL).length === 0,
  });
}

/**
 * Deterministic digest over records.
 *
 * Keys are sorted at every level and records sorted by their own serialisation, so two runs over the same
 * input agree regardless of object construction order. Without that, the digest would be an artefact of the
 * code path rather than of the data.
 */
export function digestRecords(records) {
  const sortDeep = (v) => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
    return v;
  };
  const lines = records.map((r) => JSON.stringify(sortDeep(r))).sort();
  return sha256(lines.join("\n"));
}

const finding = (severity, code, message, detail = {}) => ({ severity, code, message, ...detail });

/**
 * Coverage precedence, strongest first. A field claimed twice takes the strongest claim.
 * MAPPED means "it becomes a column"; ARCHIVED means "retained but not decomposed yet" — so a field that is
 * both is MAPPED, because it does end up mapped.
 */
export const COVERAGE_PRECEDENCE = [COVERAGE.MAPPED, COVERAGE.DERIVED, COVERAGE.ARCHIVED, COVERAGE.INTENTIONALLY_DROPPED, COVERAGE.UNKNOWN];
export function strongestCoverage(a, b) {
  const ia = COVERAGE_PRECEDENCE.indexOf(a), ib = COVERAGE_PRECEDENCE.indexOf(b);
  if (ia === -1) return b;
  if (ib === -1) return a;
  return ia <= ib ? a : b;
}

/** Guard applied by every money-bearing transformer before it emits anything. */
function moneyVersionGate(ctx, findings) {
  const v = classifyVersion(ctx.sourceVersion);
  if (v.status === "UNKNOWN") {
    findings.push(finding(SEVERITY.FATAL, "UNKNOWN_SOURCE_VERSION",
      `source version ${JSON.stringify(ctx.sourceVersion)} is not characterised. A money-bearing transformation ` +
      `on an uncharacterised shape could misread a field that changed meaning, so it refuses rather than guessing.`));
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY
// ─────────────────────────────────────────────────────────────────────────────
/**
 * transformParticipants — candidate participant records. NEVER merges.
 *
 * One record per distinct identity KEY (normalised email, else normalised name). That is not a merge: it is
 * the minimum grouping needed to have a participant at all, and it is the same key the entry references.
 * Two people sharing a mailbox therefore produce ONE record and a CONFLICT finding — the finding is the
 * point, because the alternative is either silently merging them or silently duplicating one person.
 */
export function transformParticipants(legacyState, ctx = {}) {
  const findings = [];
  const entries = Array.isArray(legacyState?.entries) ? legacyState.entries : [];
  if (!Array.isArray(legacyState?.entries)) {
    findings.push(finding(SEVERITY.WARNING, "NO_ENTRIES_ARRAY", "legacy state has no entries[]; zero participants derived"));
  }

  const byKey = new Map();
  for (const [i, e] of entries.entries()) {
    const email = e?.participantEmail ? norm(e.participantEmail) : null;
    const name = e?.entryName ?? null;
    if (!email && !norm(name)) {
      findings.push(finding(SEVERITY.UNKNOWN, "UNIDENTIFIABLE_ENTRY",
        `entry at index ${i} has neither an email nor a name, so it identifies nobody`, { index: i }));
      continue;
    }
    const key = email ? `e:${email}` : `n:${norm(name)}`;
    if (!byKey.has(key)) {
      byKey.set(key, { identity_key: key, display_name: name, email, state: "active",
        canonical_participant_id: null, observed_names: new Set(name ? [name] : []), entry_count: 0 });
    }
    const rec = byKey.get(key);
    rec.entry_count++;
    if (name) rec.observed_names.add(name);
    // Same mailbox, different names: the shared-mailbox case. Report it; never decide it.
    if (email && name && norm(rec.display_name) !== norm(name)) {
      findings.push(finding(SEVERITY.CONFLICT, "SHARED_EMAIL_DIFFERENT_NAMES",
        `identity key ${key} is claimed by more than one display name. This is a shared mailbox or two people; ` +
        `only an operator can decide, so no merge and no split is performed.`, { identity_key: key }));
    }
  }

  const records = [...byKey.values()]
    .map((r) => ({ ...r, observed_names: [...r.observed_names].sort() }))
    .sort((a, b) => a.identity_key.localeCompare(b.identity_key));

  for (const r of records) {
    if (!r.email) {
      findings.push(finding(SEVERITY.UNKNOWN, "NO_EMAIL",
        `participant ${r.identity_key} has no email, so it can only ever be matched by name`, { identity_key: r.identity_key }));
    }
  }

  return result({
    records, findings,
    coverage: {
      "entries[].entryName": COVERAGE.MAPPED,
      "entries[].participantEmail": COVERAGE.MAPPED,
    },
    evidence: { sourceEntries: entries.length, distinctIdentities: records.length },
  });
}

/**
 * transformParticipantIdentityCandidates — merge CANDIDATES only, never links.
 *
 * Emits evidence for an operator queue. The absence of a `canonical_participant_id` anywhere in the output
 * is the property that matters, and it is asserted by test.
 */
export function transformParticipantIdentityCandidates(legacyState, ctx = {}) {
  const findings = [];
  const base = transformParticipants(legacyState, ctx);
  const people = base.records;
  const records = [];

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      const signals = [];
      if (a.email && b.email && a.email === b.email) signals.push("EXACT_EMAIL");
      const an = [a.display_name, ...a.observed_names].filter(Boolean);
      const bn = [b.display_name, ...b.observed_names].filter(Boolean);
      if (an.some((x) => bn.some((y) => norm(x) === norm(y)))) signals.push("NORMALISED_NAME");
      else if (an.some((x) => bn.some((y) => fold(x) === fold(y)))) signals.push("FOLDED_NAME");
      if (!signals.length) continue;
      records.push({
        a_identity_key: a.identity_key, b_identity_key: b.identity_key,
        signals: signals.sort(),
        confidence: signals.includes("EXACT_EMAIL") && signals.length > 1 ? "strong"
          : signals.includes("EXACT_EMAIL") || signals.includes("NORMALISED_NAME") ? "moderate" : "weak",
        requires_operator_confirmation: true,
        canonical_participant_id: null,
      });
    }
  }
  records.sort((x, y) => x.a_identity_key.localeCompare(y.a_identity_key) || x.b_identity_key.localeCompare(y.b_identity_key));
  if (records.length) {
    findings.push(finding(SEVERITY.UNKNOWN, "MERGE_CANDIDATES_PENDING",
      `${records.length} merge candidate(s) require operator confirmation. None is applied: a migration cannot ` +
      `supply the confirmation a merge requires, and a wrong merge combines two people's money.`));
  }
  return result({ records, findings, coverage: { "entries[].participantEmail": COVERAGE.DERIVED }, evidence: { candidatePairs: records.length } });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPETITION STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Competitions, editions and phases are NOT in the legacy document. It has no competition entity at all,
 * so these are reference data supplied by context — and saying so is more useful than inventing rows from
 * a slug.
 */
export function transformCompetitions(legacyState, ctx = {}) {
  const findings = [];
  const supplied = Array.isArray(ctx.competitions) ? ctx.competitions : [];
  if (!supplied.length) {
    findings.push(finding(SEVERITY.UNKNOWN, "NO_COMPETITION_REFERENCE_DATA",
      "the legacy document contains no competition entity, so competitions must be supplied as reference data"));
  }
  const records = supplied.map((c) => ({ competition_id: c.competition_id, slug: c.slug, name: c.name, kind: c.kind ?? "group_then_knockout" }))
    .sort((a, b) => String(a.competition_id).localeCompare(String(b.competition_id)));
  return result({ records, findings, coverage: {}, evidence: { source: "reference data, not legacy state" } });
}

export function transformCompetitionEditions(legacyState, ctx = {}) {
  const findings = [];
  const supplied = Array.isArray(ctx.editions) ? ctx.editions : [];
  if (!supplied.length) findings.push(finding(SEVERITY.UNKNOWN, "NO_EDITION_REFERENCE_DATA", "editions must be supplied as reference data"));
  const records = supplied.map((e) => ({
    competition_edition_id: e.competition_edition_id, competition_id: e.competition_id,
    season_label: e.season_label, status: e.status ?? "concluded",
  })).sort((a, b) => String(a.competition_edition_id).localeCompare(String(b.competition_edition_id)));
  for (const r of records) {
    if (!r.competition_id) findings.push(finding(SEVERITY.CONFLICT, "EDITION_WITHOUT_COMPETITION", `edition ${r.competition_edition_id} names no competition`));
  }
  return result({ records, findings, evidence: { source: "reference data" } });
}

/**
 * Phases carry the cutoff, which is what makes the prediction lock enforceable. A phase with no cutoff is
 * an UNKNOWN, not a default — defaulting one would silently lock or unlock predictions.
 */
export function transformCompetitionPhases(legacyState, ctx = {}) {
  const findings = [];
  const supplied = Array.isArray(ctx.phases) ? ctx.phases : [];
  if (!supplied.length) findings.push(finding(SEVERITY.UNKNOWN, "NO_PHASE_REFERENCE_DATA", "phases must be supplied as reference data"));
  const records = [];
  for (const p of supplied) {
    if (p.cutoff_at == null) {
      findings.push(finding(SEVERITY.UNKNOWN, "PHASE_WITHOUT_CUTOFF",
        `phase ${p.competition_edition_phase_id} has no cutoff. It is left NULL: defaulting one would silently ` +
        `lock or unlock predictions, which changes who can play.`, { phase: p.competition_edition_phase_id }));
    }
    records.push({
      competition_edition_phase_id: p.competition_edition_phase_id,
      competition_edition_id: p.competition_edition_id,
      slug: p.slug, ordinal: p.ordinal, cutoff_at: p.cutoff_at ?? null,
    });
  }
  records.sort((a, b) => String(a.competition_edition_id).localeCompare(String(b.competition_edition_id)) || (a.ordinal - b.ordinal));
  // Contiguity is a real invariant: a gap means bracket progression cannot be validated.
  const byEdition = new Map();
  for (const r of records) {
    if (!byEdition.has(r.competition_edition_id)) byEdition.set(r.competition_edition_id, []);
    byEdition.get(r.competition_edition_id).push(r.ordinal);
  }
  for (const [ed, ords] of byEdition) {
    const s = [...ords].sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) {
      if (s[i] !== s[i - 1] + 1) findings.push(finding(SEVERITY.CONFLICT, "PHASE_ORDINAL_GAP", `edition ${ed} has a phase-ordinal gap at ${s[i - 1]}→${s[i]}`));
    }
  }
  return result({ records, findings, evidence: { source: "reference data" } });
}

/**
 * THE ENTRY CUTOFF — the one field on a pool that comes from the legacy DOCUMENT, not from reference data.
 *
 * `cutoffAt` is the frozen, shared deadline an entry is late against. `freezeSeasonCutoff()` writes it
 * exactly once (first real kickoff − 1h) and `isPastCutoff()` reads it to disable the pick selects. It is
 * written through `toISOString()`, so the stored instant is always UTC with a `Z`.
 *
 * THREE SOURCE STATES, and collapsing them is how the meaning would be lost:
 *
 *   ABSENT        the key is not in the document. No cutoff was ever frozen for this pool — br2026 is
 *                 the only app that has the key at all.
 *   EXPLICIT_NULL the key is present and null. The app's own empty state is `cutoffAt: null`, so this is
 *                 a real state and not a malformed document: "this pool has a cutoff concept and it has
 *                 not been frozen yet".
 *   VALUE         an ISO-8601 instant.
 *
 * ABSENT and EXPLICIT_NULL both target SQL NULL, because `entry_cutoff_at` is nullable and has no third
 * state — but WHICH one it was is recorded in the findings, so the distinction survives in evidence even
 * though the column cannot carry it.
 *
 * ── WHAT MUST NOT HAPPEN, and it is tempting ────────────────────────────────────────────────────────
 * `config.js` has `cutoffIso`, and `cutoffDate()` reads `state.cutoffAt || C.cutoffIso`. So the running
 * app DOES fall back to a configured constant when the frozen value is missing. That fallback must NOT be
 * migrated into this column. `C.cutoffIso` is CONFIGURATION — its own comment calls it "só o fallback
 * usado antes desse primeiro congelamento" — while `entry_cutoff_at` is STATE. Writing the config
 * constant here would manufacture a frozen deadline for a pool that never froze one, and would destroy
 * the only evidence that it never did. That is precisely what M13's refusal to give this column a DEFAULT
 * or NOT NULL exists to prevent. The fallback stays in the application, where it already works.
 *
 * An unparseable value is a CONFLICT, never a silent NULL: silently nulling it would turn a corrupt
 * deadline into "no deadline", which reopens entries that were closed.
 */
export function readEntryCutoff(legacyState) {
  const has = legacyState !== null && typeof legacyState === "object" && Object.prototype.hasOwnProperty.call(legacyState, "cutoffAt");
  if (!has) return { state: "ABSENT", value: null };
  const raw = legacyState.cutoffAt;
  if (raw === null) return { state: "EXPLICIT_NULL", value: null };
  if (typeof raw !== "string" || !raw.trim()) return { state: "INVALID", value: null, raw: typeof raw };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { state: "INVALID", value: null, raw: "unparseable" };
  // Normalised to a UTC instant. `timestamptz` stores an absolute instant and not the offset it was
  // written in, so `...T22:15:00.000Z` and `...T19:15:00-03:00` are the SAME stored value — the instant
  // is the semantics and the offset is presentation. Emitting the canonical UTC form makes the round trip
  // checkable by string comparison rather than by trusting two parsers to agree.
  return { state: "VALUE", value: new Date(ms).toISOString() };
}

export function transformPools(legacyState, ctx = {}) {
  const findings = [];
  const supplied = Array.isArray(ctx.pools) ? ctx.pools : (ctx.poolId ? [{ pool_id: ctx.poolId, competition_edition_id: ctx.editionId, slug: "pool", name: "Pool" }] : []);
  if (!supplied.length) findings.push(finding(SEVERITY.UNKNOWN, "NO_POOL_REFERENCE_DATA", "the legacy document has one implicit pool; its identity must be supplied"));

  const cutoff = readEntryCutoff(legacyState);
  if (cutoff.state === "INVALID") {
    findings.push(finding(SEVERITY.CONFLICT, "CUTOFF_UNPARSEABLE",
      `cutoffAt is present but not a parseable instant (${cutoff.raw}). Left NULL would read as "no deadline", ` +
      `which reopens entries that were closed, so this is reported rather than absorbed.`));
  }
  // ONE DOCUMENT IS ONE POOL'S DOCUMENT. `buildRealSource` transforms each legacy pool separately, so the
  // cutoff read above belongs to exactly the pool this call is about. If a caller supplies several pools
  // at once there is no way to say which one the document's deadline belongs to — and applying it to all
  // of them would copy br2026's deadline onto pools that never had one. Fail closed: no pool gets it.
  const attributable = supplied.length === 1;
  if (!attributable && cutoff.state === "VALUE") {
    findings.push(finding(SEVERITY.UNKNOWN, "CUTOFF_NOT_ATTRIBUTABLE",
      `the document carries a cutoffAt but ${supplied.length} pools were supplied in one call, so it cannot ` +
      `be attributed to one of them. Left NULL on all of them rather than copied to all of them.`));
  }

  const records = supplied.map((p) => ({
    pool_id: p.pool_id, competition_edition_id: p.competition_edition_id,
    slug: p.slug ?? "pool", name: p.name ?? "Pool", status: p.status ?? "closed",
    entry_cutoff_at: attributable ? cutoff.value : null,
  })).sort((a, b) => String(a.pool_id).localeCompare(String(b.pool_id)));

  for (const r of records) {
    if (!r.competition_edition_id) findings.push(finding(SEVERITY.CONFLICT, "POOL_WITHOUT_EDITION", `pool ${r.pool_id} names no edition`));
  }
  if (attributable && (cutoff.state === "ABSENT" || cutoff.state === "EXPLICIT_NULL")) {
    findings.push(finding(SEVERITY.WARNING, `CUTOFF_${cutoff.state}`,
      `no frozen entry cutoff for pool ${records[0]?.pool_id}; entry_cutoff_at is NULL. ` +
      `NOT defaulted from config.cutoffIso — that is a pre-freeze display fallback, not this pool's deadline.`));
  }
  return result({
    records, findings,
    coverage: { cutoffAt: cutoff.state === "VALUE" ? COVERAGE.MAPPED : COVERAGE.UNKNOWN },
    evidence: { source: "reference data + cutoffAt from the legacy document", cutoffState: cutoff.state },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRIES
// ─────────────────────────────────────────────────────────────────────────────
/**
 * transformPoolEntries — 1:1 with legacy `entries[]`, preserving the client uuid as the surrogate.
 *
 * The expected fee is REQUIRED from context and never inferred (B-08). Because the fee is money, a missing
 * one is FATAL rather than UNKNOWN: an entry with no expected fee makes every settlement classification
 * meaningless, and a default would put a fabricated number under every one of them.
 */
/**
 * Make `(identity_key, entry_label)` unique within one pool's records, in place.
 *
 * The rule, deliberately minimal: the first record in sorted order keeps its label; each subsequent
 * collision takes `<label>-2`, `-3`, … skipping any suffix that some other entry already claims
 * explicitly. Nothing is dropped and nothing is merged — the count of entries, and therefore the pool's
 * total expected fees, is identical before and after.
 *
 * A collision between two entries that were EXPLICITLY given the same label is reported CONFLICT rather
 * than WARNING: the model's own note says the label is the only thing distinguishing an intentional
 * second entry from an accidental duplicate, so when a human supplied that label twice, the distinction
 * genuinely was not recorded and someone should look. A collision between two DEFAULTED labels is only a
 * WARNING, because the source never carried a label to disagree about.
 */
function disambiguateEntryLabels(records, findings) {
  const taken = new Map(); // identity_key → Set(label)
  for (const r of records) {
    if (!taken.has(r.identity_key)) taken.set(r.identity_key, new Set());
    taken.get(r.identity_key).add(r.entry_label);
  }
  const used = new Map(); // identity_key → Set(label) already assigned in this pass
  for (const r of records) {
    if (!used.has(r.identity_key)) used.set(r.identity_key, new Set());
    const mine = used.get(r.identity_key);
    if (!mine.has(r.entry_label)) { mine.add(r.entry_label); continue; }

    const base = r.entry_label;
    let n = 2, candidate = `${base}-${n}`;
    while (mine.has(candidate) || taken.get(r.identity_key).has(candidate)) candidate = `${base}-${++n}`;
    mine.add(candidate);
    taken.get(r.identity_key).add(candidate);
    findings.push(finding(
      r.__labelDefaulted ? SEVERITY.WARNING : SEVERITY.CONFLICT,
      r.__labelDefaulted ? "ENTRY_LABEL_DISAMBIGUATED" : "ENTRY_LABEL_COLLISION",
      `entry ${r.pool_entry_id} shares (participant, pool, label) with an earlier entry, which the target's ` +
      `uniqueness rule rejects. Its label becomes "${candidate}" so the entry — and the fee it owes — is ` +
      `preserved. ${r.__labelDefaulted
        ? "Both labels were defaulted, so the source never distinguished them."
        : "Both labels were supplied explicitly, so the source itself did not distinguish them."}`,
      { entry_id: r.pool_entry_id }));
    r.entry_label = candidate;
  }
  for (const r of records) delete r.__labelDefaulted;
}

export function transformPoolEntries(legacyState, ctx = {}) {
  const findings = [];
  const entries = Array.isArray(legacyState?.entries) ? legacyState.entries : [];
  if (!Array.isArray(legacyState?.entries)) findings.push(finding(SEVERITY.WARNING, "NO_ENTRIES_ARRAY", "legacy state has no entries[]"));

  if (!moneyVersionGate(ctx, findings)) return result({ records: [], findings });

  if (!ctx.expectedFee) {
    findings.push(finding(SEVERITY.FATAL, "NO_EXPECTED_FEE",
      "no expected fee was supplied. Inferring one would fabricate money (B-08), and an entry with no " +
      "expected fee makes every settlement classification meaningless."));
    return result({ records: [], findings });
  }
  const deleted = new Set(Array.isArray(legacyState?.deletedIds) ? legacyState.deletedIds : []);
  const seenIds = new Set();
  const records = [];

  for (const [i, e] of entries.entries()) {
    if (!e?.id) {
      findings.push(finding(SEVERITY.CONFLICT, "ENTRY_WITHOUT_ID",
        `entry at index ${i} has no id, so it cannot be written idempotently or referenced by a payment`, { index: i }));
      continue;
    }
    if (seenIds.has(e.id)) {
      findings.push(finding(SEVERITY.CONFLICT, "DUPLICATE_ENTRY_ID",
        `entry id ${e.id} appears more than once. Emitting both would make the idempotent write ambiguous, ` +
        `so the duplicate is not emitted.`, { entry_id: e.id }));
      continue;
    }
    seenIds.add(e.id);

    const email = e.participantEmail ? norm(e.participantEmail) : null;
    const identityKey = email ? `e:${email}` : `n:${norm(e.entryName)}`;
    if (!email && !norm(e.entryName)) {
      findings.push(finding(SEVERITY.CONFLICT, "ENTRY_WITHOUT_PARTICIPANT",
        `entry ${e.id} resolves to no participant`, { entry_id: e.id }));
      continue;
    }
    const label = String(e.entryLabel ?? "").trim() || "main";
    if (!String(e.entryLabel ?? "").trim()) {
      findings.push(finding(SEVERITY.WARNING, "ENTRY_LABEL_DEFAULTED",
        `entry ${e.id} had no label; defaulted to "main". Without a label a deliberate second entry is ` +
        `indistinguishable from a duplicate.`, { entry_id: e.id }));
    }
    records.push({
      pool_entry_id: e.id,
      pool_id: ctx.poolId ?? null,
      identity_key: identityKey,
      entry_label: label,
      // Carried only as far as disambiguation, which deletes it: whether a label was defaulted decides
      // the SEVERITY of a collision, and it is not part of the record the target stores.
      __labelDefaulted: !String(e.entryLabel ?? "").trim(),
      // KPLUS-F015: this is the TARGET COLUMN's name, so it must carry the TARGET COLUMN's units.
      // `pool_entries.expected_fee_amount` is numeric(14,2) in MAJOR units — migration_drift.mjs records
      // that "minor units are the JS and SQLite fixture representation only". Emitting `.minor` here put
      // 500.00 under a 5.00 fee: every entry read as owing a hundred times what it owed. The canonical
      // formatter is reused rather than dividing by 100 locally, because a second place that converts
      // money is a second place that can disagree.
      expected_fee_amount: majorAmount(ctx.expectedFee),
      expected_fee_currency: ctx.expectedFee.currency,
      picks: e.picks ?? null,
      created_at: e.createdAt ?? null,
      updated_at: e.updatedAt ?? null,
      deleted_at: deleted.has(e.id) ? (e.updatedAt ?? e.createdAt ?? null) : null,
      state: deleted.has(e.id) ? "withdrawn" : "submitted",
    });
    if (!e.createdAt) findings.push(finding(SEVERITY.UNKNOWN, "ENTRY_WITHOUT_TIMESTAMP", `entry ${e.id} has no createdAt`, { entry_id: e.id }));
  }

  // A tombstone naming an entry that does not exist is evidence something was lost before the migration.
  for (const id of deleted) {
    if (!seenIds.has(id)) {
      findings.push(finding(SEVERITY.WARNING, "TOMBSTONE_WITHOUT_ENTRY",
        `deletedIds names ${id}, which is not present in entries[]. The entry was already gone before this migration.`, { entry_id: id }));
    }
  }

  records.sort((a, b) => String(a.pool_entry_id).localeCompare(String(b.pool_entry_id)));

  // KPLUS-F016 — see ADR-K02. Two entries by one participant in one pool with the same label are ONE row
  // to the target: `pool_entries_participant_id_pool_id_entry_label_uidx` rejects the second. Real legacy
  // data carries no labels at all, so defaulting every one of them to "main" made that collision certain
  // for any participant with a second entry — and multiple entries per participant per pool is a RATIFIED
  // requirement, so the colliding row is a real entry owing a real fee, not a duplicate to be discarded.
  //
  // Disambiguation runs over the SORTED records, so the suffix depends on the SET of entries and not on
  // the order the document happened to list them in: the same pool transformed twice yields the same
  // labels. The first entry keeps the label it had, so an entry that never collided is untouched.
  disambiguateEntryLabels(records, findings);

  return result({
    records, findings,
    coverage: {
      "entries[]": COVERAGE.MAPPED, "entries[].id": COVERAGE.MAPPED, "entries[].entryLabel": COVERAGE.MAPPED,
      "entries[].picks": COVERAGE.ARCHIVED, "entries[].createdAt": COVERAGE.MAPPED,
      "entries[].updatedAt": COVERAGE.MAPPED, "deletedIds": COVERAGE.DERIVED,
    },
    evidence: { sourceEntries: entries.length, tombstones: deleted.size },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY — the highest-risk transformers
// ─────────────────────────────────────────────────────────────────────────────
/**
 * transformPayments — one ASSERTED payment per legacy `paid[entryId] === true`.
 *
 * The legacy boolean carries no amount, currency, date, method, reference or actor. Every one of those is
 * therefore emitted as null and reported UNKNOWN, and the record is marked `legacy_asserted`. Inventing any
 * of them is the failure this transformer exists to prevent.
 *
 * Payer attribution: a payer name identical to the entrant's is self-payment — that is not a guess, it is
 * one entry with one name. A DIFFERENT payer name stays UNKNOWN-1: a third party paid, and only an operator
 * can say who. Guessing would misattribute someone's money.
 */
export function transformPayments(legacyState, ctx = {}) {
  const findings = [];
  if (!moneyVersionGate(ctx, findings)) return result({ records: [], findings });

  const paid = legacyState?.paid;
  if (paid == null) {
    findings.push(finding(SEVERITY.WARNING, "NO_PAID_MAP", "legacy state has no paid{}; zero payments derived"));
    return result({ records: [], findings, coverage: { paid: COVERAGE.DERIVED } });
  }
  if (typeof paid !== "object" || Array.isArray(paid)) {
    findings.push(finding(SEVERITY.FATAL, "PAID_WRONG_SHAPE",
      `paid must be an object keyed by entry id; got ${Array.isArray(paid) ? "an array" : typeof paid}. ` +
      `Guessing its shape in a money-bearing transformation is not acceptable.`));
    return result({ records: [], findings });
  }

  const entries = Array.isArray(legacyState?.entries) ? legacyState.entries : [];
  const entryById = new Map(entries.filter((e) => e?.id).map((e) => [e.id, e]));
  const records = [];
  const externalRefs = new Map();

  for (const key of Object.keys(paid).sort()) {
    const v = paid[key];
    if (v !== true) {
      if (v !== false) {
        findings.push(finding(SEVERITY.CONFLICT, "PAID_NOT_BOOLEAN",
          `paid[${key}] is ${JSON.stringify(v)}, not a boolean. In a money-bearing field a non-boolean is not ` +
          `coerced — a truthy string would silently assert a payment.`, { entry_id: key }));
      }
      continue;
    }
    const e = entryById.get(key);
    if (!e) {
      findings.push(finding(SEVERITY.CONFLICT, "PAID_FLAG_WITHOUT_ENTRY",
        `paid names entry ${key}, which is not in entries[]. A payment assertion that cannot be traced to an ` +
        `entry cannot be reconciled against anything.`, { entry_id: key }));
      continue;
    }
    const selfPaid = !e.payerName || norm(e.payerName) === norm(e.entryName);
    if (!selfPaid) {
      findings.push(finding(SEVERITY.UNKNOWN, "THIRD_PARTY_PAYER_UNRESOLVED",
        `entry ${key} was paid by a differently-named party. The payer is recorded verbatim but NOT resolved ` +
        `to a participant: guessing would misattribute someone's money (UNKNOWN-1).`, { entry_id: key }));
    }
    if (e.externalReference) {
      const prev = externalRefs.get(e.externalReference);
      if (prev) {
        findings.push(finding(SEVERITY.CONFLICT, "DUPLICATE_EXTERNAL_REFERENCE",
          `two entries carry the same external payment reference. Recording both would count one real payment twice.`,
          { entry_id: key, other_entry_id: prev }));
      } else externalRefs.set(e.externalReference, key);
    }

    records.push({
      payment_id: `pay-${key}`,
      asserted_for_pool_entry_id: key,
      payer_identity_key: selfPaid
        ? (e.participantEmail ? `e:${norm(e.participantEmail)}` : `n:${norm(e.entryName)}`)
        : null,
      payer_name_as_recorded: e.payerName ?? null,
      amount: null,
      currency: null,
      kind: "contribution",
      method: e.paymentMethod ?? null,
      external_reference: e.externalReference ?? null,
      paid_at: e.paidAt ?? null,
      legacy_asserted: true,
    });

    findings.push(finding(SEVERITY.UNKNOWN, "LEGACY_ASSERTED_NO_AMOUNT",
      `entry ${key} is asserted paid with no recoverable amount, currency, date or reference. The record is ` +
      `emitted with those fields null and marked legacy_asserted; settlement for it is LEGACY_ASSERTED.`, { entry_id: key }));
    if (!e.paymentMethod) findings.push(finding(SEVERITY.UNKNOWN, "NO_PAYMENT_METHOD", `entry ${key} records no payment method`, { entry_id: key }));
  }

  records.sort((a, b) => a.payment_id.localeCompare(b.payment_id));
  return result({
    records, findings,
    coverage: {
      paid: COVERAGE.DERIVED,
      "entries[].payerName": COVERAGE.MAPPED,
      "entries[].paymentMethod": COVERAGE.MAPPED,
    },
    evidence: { assertedFlags: records.length },
  });
}

/**
 * transformPaymentAllocations — emits NOTHING, always, and says why.
 *
 * An allocation states how much of a payment settled which entry. The legacy state proves neither number.
 * Emitting an allocation of the expected fee would be inventing both the amount and the decision. Every
 * asserted payment therefore produces one UNKNOWN, so the gap is counted rather than implied.
 */
export function transformPaymentAllocations(legacyState, ctx = {}) {
  const findings = [];
  if (!moneyVersionGate(ctx, findings)) return result({ records: [], findings });
  const paid = legacyState?.paid && typeof legacyState.paid === "object" && !Array.isArray(legacyState.paid) ? legacyState.paid : {};
  const asserted = Object.keys(paid).filter((k) => paid[k] === true).sort();
  for (const k of asserted) {
    findings.push(finding(SEVERITY.UNKNOWN, "ALLOCATION_NOT_PROVABLE",
      `entry ${k} is asserted paid, but no allocation is emitted: the legacy state proves neither the amount ` +
      `nor which entry it settled. Allocating the expected fee would invent both.`, { entry_id: k }));
  }
  return result({ records: [], findings, coverage: { paid: COVERAGE.DERIVED }, evidence: { unprovableAllocations: asserted.length } });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPETITION FACTS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * CDB2026's matches live INSIDE its ties, and nothing about the Copa path fits them.
 *
 * `transformMatches` derives matches from RESULT KEYS and attributes teams from a fixture list — the
 * copa2026 shape, where `results` is an object keyed by match id and `data.js` carries the fixtures.
 * cdb2026 has no `results` key at all. Its legs are `phases[<slug>].ties[<slug>].matches.{first,second}`,
 * and each leg NAMES its own `homeTeam` and `awayTeam` explicitly. Measured: 56 legs, 28 first + 28
 * second, all 56 with both sides present and none with the same team twice.
 *
 * So this is a separate extractor rather than a widened generic one. The TARGET semantics are shared —
 * one `bolao.matches` row per leg — and only the SOURCE parsing differs. Forcing cdb2026 through the
 * fixture path would take its teams from a copa2026 file that knows nothing about it.
 *
 * WHAT IS DELIBERATELY NOT READ HERE. `goalsHome`/`goalsAway`/`resultSource` are the MATCH_RESULTS
 * domain: `bolao.matches` has no goal columns, and a match with no recorded result is a valid match.
 * `venue`/`city` have no target column at all — see the accepted-exclusion note in the domain entry.
 *
 * `leg` IS THE ORDER AND IT COMES FROM THE KEY, not from array position: `first` -> 1, `second` -> 2.
 * An unrecognised leg key is refused rather than numbered by iteration order, because swapping the legs
 * of a two-legged tie inverts which side hosted each half.
 */
export const CDB_LEG_ORDER = Object.freeze({ first: 1, second: 2 });

/**
 * Source status -> `bolao.match_status`. Explicit, and fail-closed on anything unlisted.
 *
 * Measured across all 56 live legs the source uses exactly two values: FINAL (48) and SCHEDULED (8).
 * The target enum also offers in_progress, postponed and cancelled; none is inferred, because inferring
 * a status from the presence of a score is how a postponed match becomes a played one.
 */
export const CDB_STATUS_MAP = Object.freeze({ FINAL: "finished", SCHEDULED: "scheduled" });

/**
 * CDB2026 RESULTS — one row per FINISHED leg, and nothing for the rest.
 *
 * `transformMatchResults` reads `state.results`, an object keyed by match id. That is copa2026's shape.
 * cdb2026 has no `results` key at all: a leg's outcome sits on the leg itself, as `goalsHome`/`goalsAway`
 * beside `status`. Measured across all 56 live legs: 48 FINAL, every one carrying BOTH goals; 8 SCHEDULED,
 * every one carrying NEITHER. Zero legs carry exactly one side — so "has a result" is unambiguous.
 *
 * ── RESULT ABSENCE MUST REMAIN ABSENCE, and 0 IS NOT ABSENCE ────────────────────────────────────────
 *
 * The 8 SCHEDULED legs produce NO ROW. Not 0-0, not a row with NULL goals: `goals_home`/`goals_away` are
 * NOT NULL on the target precisely so a result cannot exist without a score. A match with no result is
 * represented by the ABSENCE of a `match_results` row.
 *
 * And this is why every presence test below is an explicit null check rather than truthiness: the live
 * source contains **15 legs with goalsHome = 0, 23 with goalsAway = 0, and 9 that finished 0-0**. Under
 * `if (m.goalsHome)` all nine of those real, official, money-bearing results would vanish. 0-0 is a
 * football result; it is not a missing one.
 *
 * ── OFFICIAL, per ADR-003, and it is BOTH paths ─────────────────────────────────────────────────────
 *
 * ADR-003 (`docs/bolao/adr/ADR-003-official-vs-provisional-results.md`): "Um resultado só se torna
 * 'oficial' por dois caminhos: Admin manual … ou Automático via ESPN (`autoSyncEspnResults()`)." The
 * PROVISIONAL data is `_liveTies`, polled every 60s and **never persisted**. So nothing that reaches
 * `bolao_state` is provisional, and every FINAL leg is official. `is_official = true` for all 48.
 *
 * ── PROVENANCE IS RECORDED, NOT GUESSED ─────────────────────────────────────────────────────────────
 *
 * `resultSource` is 'espn-auto' on 16 of the 48 and ABSENT on the other 32 — those predate the field.
 * `source` is NOT NULL, so a value is required; `manual_admin` would assert an attribution the document
 * does not make. `legacy_unrecorded` states exactly what is known.
 *
 * ── NO EXTRA TIME, NO PENALTIES ─────────────────────────────────────────────────────────────────────
 *
 * Searched every leg for pen/shootout/extra/aet/prorrog: the source has no such field. Both penalty
 * columns are NULL, which is what `mr_penalties_paired` requires (both or neither). Where a CDB tie was
 * decided on penalties the app records that as `qualifiedTeamId` on the TIE — already migrated — not as
 * a score. Inventing a shootout score here would fabricate a result nobody recorded.
 *
 * NO POINTS ARE COMPUTED. Raw goals stay raw goals (M7). Advancement lives on the tie.
 */
export const CDB_RESULT_SOURCE = Object.freeze({ "espn-auto": "espn", admin: "manual_admin" });
export const CDB_RESULT_SOURCE_UNRECORDED = "legacy_unrecorded";

/**
 * CDB2026 PREDICTIONS — two kinds, and the schema already says they are two.
 *
 * `transformPredictions` walks `picks` as an object keyed by MATCH ID and emits `subject_id`,
 * `home_goals`, `away_goals`, `advancing_team`, `lock_context`, `source_version`. That is copa2026's
 * source shape AND a record shape `bolao.predictions` does not have — its columns are `pool_entry_id`,
 * `match_id`, `tie_id`, `predicted_goals_home`, `predicted_goals_away`, `predicted_qualified_side`,
 * `submitted_at`, `locked`. Applied to cdb2026 it would treat the two literal keys "matches" and
 * "qualified" as two match ids.
 *
 * cdb2026's shape is:
 *     picks.matches[<tieSlug>].{first,second}.{goalsHome,goalsAway}   -> a LEG SCORE prediction
 *     picks.qualified[<tieSlug>]                = "A" | "B"           -> a TIE ADVANCEMENT prediction
 *
 * Those map onto `pred_subject_exactly_one CHECK ((match_id IS NOT NULL) <> (tie_id IS NOT NULL))`
 * without coercion: a leg score names a MATCH, an advancement names a TIE. Neither is folded into the
 * other to fit one row shape — the constraint exists because they are genuinely different predictions.
 *
 * ── ZERO IS A PREDICTION ────────────────────────────────────────────────────────────────────────────
 * Measured across the 192 live leg picks: 41 predict goalsHome = 0, 82 predict goalsAway = 0, and 7
 * predict 0-0 outright. None is null. `if (p.goalsHome)` would delete every one of the 41. Every
 * presence test here is an explicit null check, exactly as in the results adapter.
 *
 * ── THE PHASE IS RECOVERED, NOT GUESSED ─────────────────────────────────────────────────────────────
 * A pick names only the tie SLUG, while the tie and match ids are derived from (pool, phase, slug).
 * The phase is recovered from the document's own `phases[].ties` keys. Verified: all 28 tie slugs in
 * cdb2026 are unique across phases, so the recovery is deterministic. A slug appearing under two phases
 * would be refused rather than resolved by first match.
 *
 * NO SCORING. No points, no correctness, no comparison against the actual result. A prediction is a
 * stored fact; whether it was right is the scoring engine's business.
 */
export function extractCdbPredictions(legacyState, ctx = {}) {
  const findings = [];
  const entries = Array.isArray(legacyState?.entries) ? legacyState.entries : [];
  const phases = legacyState?.phases && typeof legacyState.phases === "object" && !Array.isArray(legacyState.phases)
    ? legacyState.phases : null;
  if (!phases) {
    findings.push(finding(SEVERITY.WARNING, "NO_PHASE_STRUCTURE", "no phases object, so no tie-keyed predictions"));
    return result({ records: [], findings, coverage: {}, evidence: { predictions: 0 } });
  }

  // slug -> phase, built from the document. A duplicate slug is refused, never resolved by first match.
  const phaseOfTie = new Map(); const ambiguous = new Set();
  for (const [phaseSlug, phase] of Object.entries(phases)) {
    const ties = phase?.ties && typeof phase.ties === "object" && !Array.isArray(phase.ties) ? phase.ties : null;
    if (!ties) continue;
    for (const tieSlug of Object.keys(ties)) {
      if (phaseOfTie.has(tieSlug)) ambiguous.add(tieSlug); else phaseOfTie.set(tieSlug, phaseSlug);
    }
  }
  for (const t of ambiguous) {
    findings.push(finding(SEVERITY.CONFLICT, "TIE_SLUG_AMBIGUOUS_ACROSS_PHASES",
      `tie slug ${t} appears under more than one phase, so a pick naming it cannot be attributed`, { tie: t }));
  }

  const records = [];
  let blockedEntries = 0, blockedPicks = 0;
  const isMigratable = typeof ctx.entryIsMigratable === "function" ? ctx.entryIsMigratable : () => true;

  for (const e of entries) {
    if (!e?.id) continue;
    const picks = e.picks;
    if (picks == null) continue;
    if (typeof picks !== "object" || Array.isArray(picks)) {
      findings.push(finding(SEVERITY.CONFLICT, "PICKS_WRONG_SHAPE",
        `entry ${e.id} has picks of type ${Array.isArray(picks) ? "array" : typeof picks}`, { entry_id: e.id }));
      continue;
    }
    const legPicks = picks.matches && typeof picks.matches === "object" ? picks.matches : {};
    const qualPicks = picks.qualified && typeof picks.qualified === "object" ? picks.qualified : {};
    const nPicks = Object.values(legPicks).reduce((n, v) => n + Object.keys(v ?? {}).length, 0) + Object.keys(qualPicks).length;

    // An entry whose OWNER is quarantined has no pool_entry row, and pool_entry_id is NOT NULL with an
    // FK. Its predictions are BLOCKED — counted, never reassigned to another entry, never dropped.
    if (!isMigratable(e.id)) { blockedEntries++; blockedPicks += nPicks; continue; }

    for (const tieSlug of Object.keys(legPicks).sort()) {
      const phaseSlug = phaseOfTie.get(tieSlug);
      if (!phaseSlug || ambiguous.has(tieSlug)) {
        findings.push(finding(SEVERITY.CONFLICT, "PREDICTION_TIE_UNRESOLVED",
          `entry ${e.id} predicts tie ${tieSlug}, which resolves to no single phase`, { entry_id: e.id, tie: tieSlug }));
        continue;
      }
      for (const legKey of Object.keys(legPicks[tieSlug] ?? {}).sort()) {
        if (!CDB_LEG_ORDER[legKey]) {
          findings.push(finding(SEVERITY.CONFLICT, "PREDICTION_LEG_UNRECOGNISED",
            `entry ${e.id} predicts a leg keyed "${legKey}"`, { entry_id: e.id, tie: tieSlug, leg: legKey }));
          continue;
        }
        const p = legPicks[tieSlug][legKey] ?? {};
        const gh = p.goalsHome, ga = p.goalsAway;   // explicit null checks — 0 must survive
        const hasH = gh !== null && gh !== undefined, hasA = ga !== null && ga !== undefined;
        if (!hasH && !hasA) continue;               // no prediction for this leg: no row
        if (hasH !== hasA) {
          findings.push(finding(SEVERITY.WARNING, "PREDICTION_PARTIAL",
            `entry ${e.id} predicted one side of ${tieSlug}/${legKey}; preserved as partial rather than completed`,
            { entry_id: e.id, tie: tieSlug, leg: legKey }));
        }
        for (const [v, side] of [[gh, "home"], [ga, "away"]]) {
          if (v !== null && v !== undefined && (!Number.isInteger(v) || v < 0)) {
            findings.push(finding(SEVERITY.CONFLICT, "PREDICTION_NOT_A_COUNT",
              `entry ${e.id} predicted a non-count ${side} score for ${tieSlug}/${legKey}. Coercing would change a prediction.`,
              { entry_id: e.id, tie: tieSlug, leg: legKey }));
          }
        }
        records.push({
          prediction_id: ctx.predictionIdFor?.(e.id, phaseSlug, tieSlug, legKey) ?? null,
          pool_entry_id: ctx.entryIdFor?.(e.id) ?? null,
          match_id: ctx.matchIdFor?.(phaseSlug, tieSlug, legKey) ?? null,
          tie_id: null,
          predicted_goals_home: hasH ? gh : null, predicted_goals_away: hasA ? ga : null,
          predicted_qualified_side: null, locked: false,
          __kind: "leg_score", __phase: phaseSlug, __tie: tieSlug, __leg: legKey, __entry: e.id,
        });
      }
    }

    for (const tieSlug of Object.keys(qualPicks).sort()) {
      const raw = qualPicks[tieSlug];
      if (raw === null || raw === undefined) continue;   // no advancement predicted: no row
      const phaseSlug = phaseOfTie.get(tieSlug);
      if (!phaseSlug || ambiguous.has(tieSlug)) {
        findings.push(finding(SEVERITY.CONFLICT, "PREDICTION_TIE_UNRESOLVED",
          `entry ${e.id} predicts advancement for tie ${tieSlug}, which resolves to no single phase`,
          { entry_id: e.id, tie: tieSlug }));
        continue;
      }
      if (!["A", "B"].includes(String(raw))) {
        findings.push(finding(SEVERITY.CONFLICT, "PREDICTION_QUALIFIED_SIDE_UNRECOGNISED",
          `entry ${e.id} predicted "${raw}" for ${tieSlug}, which is not a side`, { entry_id: e.id, tie: tieSlug }));
        continue;
      }
      records.push({
        prediction_id: ctx.predictionIdFor?.(e.id, phaseSlug, tieSlug, "qualified") ?? null,
        pool_entry_id: ctx.entryIdFor?.(e.id) ?? null,
        match_id: null,
        tie_id: ctx.tieIdFor?.(phaseSlug, tieSlug) ?? null,
        predicted_goals_home: null, predicted_goals_away: null,
        predicted_qualified_side: String(raw), locked: false,
        __kind: "qualified", __phase: phaseSlug, __tie: tieSlug, __leg: null, __entry: e.id,
      });
    }
  }
  records.sort((a, b) => String(a.prediction_id).localeCompare(String(b.prediction_id)));
  return result({
    records, findings,
    coverage: { "entries[].picks.matches": COVERAGE.MAPPED, "entries[].picks.qualified": COVERAGE.MAPPED },
    evidence: {
      predictions: records.length,
      legScore: records.filter((r) => r.__kind === "leg_score").length,
      qualified: records.filter((r) => r.__kind === "qualified").length,
      blockedEntries, blockedPicks,
    },
  });
}

export function extractCdbMatchResults(legacyState, ctx = {}) {
  const findings = [];
  const phases = legacyState?.phases && typeof legacyState.phases === "object" && !Array.isArray(legacyState.phases)
    ? legacyState.phases : null;
  if (!phases) {
    findings.push(finding(SEVERITY.WARNING, "NO_PHASE_STRUCTURE", "no phases object, so no tie-embedded results"));
    return result({ records: [], findings, coverage: {}, evidence: { results: 0 } });
  }
  const records = [];
  let scheduledSkipped = 0;
  for (const [phaseSlug, phase] of Object.entries(phases)) {
    const ties = phase?.ties && typeof phase.ties === "object" && !Array.isArray(phase.ties) ? phase.ties : null;
    if (!ties) continue;
    for (const [tieSlug, tie] of Object.entries(ties)) {
      const legs = tie?.matches && typeof tie.matches === "object" && !Array.isArray(tie.matches) ? tie.matches : null;
      if (!legs) continue;
      for (const [legKey, m] of Object.entries(legs)) {
        if (!CDB_LEG_ORDER[legKey]) continue;   // the match adapter already reports an unknown leg key
        // EXPLICIT null checks. `!= null` catches null and undefined and lets 0 through.
        const gh = m?.goalsHome, ga = m?.goalsAway;
        const hasHome = gh !== null && gh !== undefined, hasAway = ga !== null && ga !== undefined;
        if (!hasHome && !hasAway) { scheduledSkipped++; continue; }   // no result: NO ROW
        if (hasHome !== hasAway) {
          findings.push(finding(SEVERITY.CONFLICT, "RESULT_HALF_RECORDED",
            `tie ${tieSlug} leg ${legKey} records one side's goals and not the other. Emitting it would ` +
            `require inventing the missing half.`, { tie: tieSlug, leg: legKey }));
          continue;
        }
        if (!Number.isInteger(gh) || !Number.isInteger(ga) || gh < 0 || ga < 0) {
          findings.push(finding(SEVERITY.CONFLICT, "RESULT_GOALS_NOT_A_COUNT",
            `tie ${tieSlug} leg ${legKey} has goals that are not non-negative integers`, { tie: tieSlug, leg: legKey }));
          continue;
        }
        const matchId = typeof ctx.matchIdFor === "function" ? ctx.matchIdFor(phaseSlug, tieSlug, legKey) : null;
        if (!matchId) {
          findings.push(finding(SEVERITY.CONFLICT, "RESULT_WITHOUT_MATCH",
            `tie ${tieSlug} leg ${legKey} has a result but resolves to no match`, { tie: tieSlug, leg: legKey }));
          continue;
        }
        const rawSource = m?.resultSource ?? null;
        records.push({
          match_result_id: typeof ctx.resultIdFor === "function" ? ctx.resultIdFor(phaseSlug, tieSlug, legKey) : null,
          match_id: matchId,
          goals_home: gh, goals_away: ga,
          penalties_home: null, penalties_away: null,
          is_official: true,
          source: rawSource ? (CDB_RESULT_SOURCE[String(rawSource)] ?? String(rawSource)) : CDB_RESULT_SOURCE_UNRECORDED,
          superseded_by_id: null,
          __phase: phaseSlug, __tie: tieSlug, __leg: legKey, __rawSource: rawSource,
        });
        if (!rawSource) {
          findings.push(finding(SEVERITY.WARNING, "RESULT_SOURCE_UNRECORDED",
            `tie ${tieSlug} leg ${legKey} records no resultSource; source is ${CDB_RESULT_SOURCE_UNRECORDED} ` +
            `rather than an invented attribution`, { tie: tieSlug, leg: legKey }));
        }
      }
    }
  }
  records.sort((a, b) => String(a.match_result_id).localeCompare(String(b.match_result_id)));
  return result({
    records, findings,
    coverage: { "phases[].ties[].matches[].goalsHome": COVERAGE.MAPPED, "phases[].ties[].matches[].goalsAway": COVERAGE.MAPPED },
    evidence: {
      results: records.length, withoutResult: scheduledSkipped,
      zeroZero: records.filter((r) => r.goals_home === 0 && r.goals_away === 0).length,
    },
  });
}

export function extractCdbMatches(legacyState, ctx = {}) {
  const findings = [];
  const phases = legacyState?.phases && typeof legacyState.phases === "object" && !Array.isArray(legacyState.phases)
    ? legacyState.phases : null;
  if (!phases) {
    findings.push(finding(SEVERITY.WARNING, "NO_PHASE_STRUCTURE", "no phases object, so no tie-embedded legs"));
    return result({ records: [], findings, coverage: {}, evidence: { legs: 0 } });
  }
  const records = [];
  for (const [phaseSlug, phase] of Object.entries(phases)) {
    const ties = phase?.ties && typeof phase.ties === "object" && !Array.isArray(phase.ties) ? phase.ties : null;
    if (!ties) continue;
    const phaseId = typeof ctx.phaseIdBySlug === "function" ? ctx.phaseIdBySlug(phaseSlug) : null;
    if (!phaseId) {
      findings.push(finding(SEVERITY.CONFLICT, "MATCH_PHASE_UNRESOLVED",
        `phase "${phaseSlug}" has legs but no phase row; its matches are not emitted`, { phase: phaseSlug }));
      continue;
    }
    for (const [tieSlug, tie] of Object.entries(ties)) {
      const legs = tie?.matches && typeof tie.matches === "object" && !Array.isArray(tie.matches) ? tie.matches : null;
      if (!legs) continue;
      const tieId = typeof ctx.tieIdFor === "function" ? ctx.tieIdFor(phaseSlug, tieSlug) : null;
      for (const [legKey, m] of Object.entries(legs)) {
        const leg = CDB_LEG_ORDER[legKey];
        if (!leg) {
          findings.push(finding(SEVERITY.CONFLICT, "MATCH_LEG_UNRECOGNISED",
            `tie ${tieSlug} has a leg keyed "${legKey}", which is not first or second. Numbering it by ` +
            `iteration order would invert which side hosted each half.`, { tie: tieSlug, leg: legKey }));
          continue;
        }
        const home = m?.homeTeam ?? null, away = m?.awayTeam ?? null;
        if (!home || !away) {
          findings.push(finding(SEVERITY.CONFLICT, "MATCH_SIDES_UNRESOLVED",
            `tie ${tieSlug} leg ${legKey} does not name both sides. Excluded rather than given a ` +
            `placeholder: predictions are scored against these names.`, { tie: tieSlug, leg: legKey }));
          continue;
        }
        if (home === away) {
          findings.push(finding(SEVERITY.CONFLICT, "MATCH_SAME_TEAM_BOTH_SIDES",
            `tie ${tieSlug} leg ${legKey} names the same team on both sides`, { tie: tieSlug, leg: legKey }));
          continue;
        }
        const rawStatus = m?.status ?? null;
        const status = rawStatus === null || rawStatus === undefined ? "scheduled" : CDB_STATUS_MAP[String(rawStatus)];
        if (rawStatus != null && !status) {
          findings.push(finding(SEVERITY.CONFLICT, "MATCH_STATUS_UNRECOGNISED",
            `tie ${tieSlug} leg ${legKey} has status "${rawStatus}", which maps to no target status. ` +
            `Refused rather than defaulted — a wrong status changes whether a match counts as played.`,
            { tie: tieSlug, leg: legKey, status: String(rawStatus) }));
          continue;
        }
        if (rawStatus == null) {
          findings.push(finding(SEVERITY.WARNING, "MATCH_STATUS_ABSENT",
            `tie ${tieSlug} leg ${legKey} records no status; the target default (scheduled) applies`, { tie: tieSlug }));
        }
        if (!m?.kickoff) {
          findings.push(finding(SEVERITY.UNKNOWN, "MATCH_WITHOUT_KICKOFF",
            `tie ${tieSlug} leg ${legKey} records no kickoff. NULL, never now() — a migration-time instant ` +
            `would claim the match was played during the migration.`, { tie: tieSlug, leg: legKey }));
        }
        records.push({
          match_id: typeof ctx.matchIdFor === "function" ? ctx.matchIdFor(phaseSlug, tieSlug, legKey) : null,
          tie_id: tieId, competition_edition_phase_id: phaseId,
          provider_match_ref: null,
          leg, home_team: home, away_team: away,
          kickoff_at: m?.kickoff ?? null,
          status,
        });
      }
    }
  }
  records.sort((a, b) => String(a.match_id).localeCompare(String(b.match_id)));
  return result({
    records, findings,
    coverage: { "phases[].ties[].matches": COVERAGE.MAPPED },
    evidence: { legs: records.length, finished: records.filter((r) => r.status === "finished").length },
  });
}

/**
 * The two verb families a copa2026 fixture uses when the team is not yet known. Anchored and closed:
 * `app.js` matches exactly `/^Winner/i` and `/^Loser/i` over `/Match\s+(\d+)/i`, and a live scan of all
 * 95 fixtures found these two shapes and no others (18 Winner, 2 Loser, across match ids 95–104).
 */
export const BRACKET_SLOT = /^\s*(winner|loser)\s+match\s+\d+\s*$/i;

export function transformMatches(legacyState, ctx = {}) {
  const findings = [];
  const results = legacyState?.results;
  const supplied = Array.isArray(ctx.matches) ? ctx.matches : null;

  /**
   * KPLUS-F017 — the two sides of the fixture.
   *
   * `bolao.matches.home_team` and `away_team` are both NOT NULL, and this transformer emitted neither,
   * so no match it produced could ever be inserted. Proven against the real column: a real transformed
   * record offered to the real table is refused with a not_null_violation on `home_team`, while the
   * same row with both sides supplied is accepted.
   *
   * The attribution is NOT missing — it is REFERENCE DATA, exactly like competitions, editions and
   * pools, which the model already says are hand-authored and "never derived from bolao_state". Each
   * app's fixture list carries `teamA`/`teamB` keyed by the same match id the state's `results` object
   * is keyed by; all 95 real match ids resolve against it. Reference data enters through `ctx`, so this
   * function reads a fixture index and never a file.
   *
   * POSITIONAL, NOT A HOSTING CLAIM. `home_team` is the first-listed side and `away_team` the second,
   * in the same order as the `goalsA`/`goalsB` those fixtures carry and the
   * `predicted_goals_home`/`predicted_goals_away` a prediction is stored as. Inverting the pair would
   * invert every stored score. It asserts nothing about who hosted — a World Cup is played at neutral
   * grounds, and the fixture list's own venues say so. See ADR-K04.
   *
   * FAIL CLOSED. A match whose sides cannot be resolved is REPORTED and EXCLUDED, never given a
   * placeholder. A match row naming a team nobody played is worse than a match row that is absent:
   * predictions are scored against these names.
   */
  /**
   * KPLUS-F043. The index PRESERVES which form the fixture used.
   *
   * It used to collapse both forms into `{home, away}` at index time — `home: f.home_team ?? f.teamA`.
   * That erased the one distinction the leg rule depends on: a fixture that NAMES its host has answered
   * the question, while a positional `teamA`/`teamB` pair has only said who is listed first, and who
   * hosts then depends on the leg. Collapsing them made every fixture look explicit, so the inversion
   * below could never fire.
   */
  const fixtures = new Map();
  for (const f of Array.isArray(ctx.fixtures) ? ctx.fixtures : []) {
    fixtures.set(String(f.match ?? f.match_id), {
      home_team: f.home_team ?? f.home ?? null,
      away_team: f.away_team ?? f.away ?? null,
      teamA: f.teamA ?? null,
      teamB: f.teamB ?? null,
    });
  }
  /** Both sides, or null — there is no half-attributed match. */
  /**
   * KPLUS-F043 — a two-leg tie inverts its hosts on the second leg, and the positional rule must not
   * be applied blind to it.
   *
   * ADR-K04 settled `teamA` -> `home_team` positionally for the World Cup, where every fixture is a
   * single match. A knockout TIE is a different object: it is two matches, and the hosts swap between
   * them. The CDB2026 app states the rule in its own code and calls it unambiguous —
   * `home = leg === "second" ? tie.teamB : tie.teamA`, with "ida e volta têm mandantes sempre
   * invertidos entre si por definição de mata-mata". That is Tier-2 evidence: application code actually
   * used by that edition.
   *
   * Applying ADR-K04's rule unchanged to a second leg would put the wrong club in `home_team` for every
   * one of them — and predictions are scored against those sides, with `predicted_goals_home` /
   * `predicted_goals_away` ordered to match. It would not fail; it would score the tournament backwards.
   *
   * The inversion applies ONLY to the positional form. A fixture that names `home_team`/`away_team`
   * explicitly has already said who hosts, and re-deriving that from the leg would corrupt the one
   * source that was unambiguous to begin with.
   */
  const SECOND_LEG = new Set([2, "2", "second", "volta"]);
  const sidesOf = (id, fallback = null, leg = null) => {
    const f = fallback && (fallback.home_team ?? fallback.teamA) ? fallback : fixtures.get(String(id));
    if (!f) return null;
    const explicitHome = f.home ?? f.home_team ?? null;
    const explicitAway = f.away ?? f.away_team ?? null;
    if (explicitHome && explicitAway) return { home: explicitHome, away: explicitAway };

    const a = f.teamA ?? null;
    const b = f.teamB ?? null;
    if (!a || !b) return null;
    // A BRACKET SLOT IS NOT A TEAM, and the guard above cannot see one.
    //
    // This function's contract is stated a few lines up: "A match whose sides cannot be resolved is
    // REPORTED and EXCLUDED, never given a placeholder. A match row naming a team nobody played is worse
    // than a match row that is absent: predictions are scored against these names." The check that
    // enforced it was `if (!a || !b)` — which only fires on null. "Winner Match 87" is a truthy string,
    // so it sailed through, `match_distinct_teams` passed (the two slots differ), and the row inserted.
    // Ten of copa2026's 95 fixtures are slot-vs-slot, so the safeguard was silently inert for exactly
    // the rows it was written for.
    //
    // copa2026/js/app.js resolves these at RENDER from `advanceSide`, using this same two-verb
    // vocabulary. Resolving them HERE would reimplement bracket advancement inside the migration and
    // would derive a pairing from qualified teams, which the draw-provenance invariant forbids. So this
    // reports and excludes; what belongs in `home_team` for those ten is PRODMIG-Q39-A1, an operator
    // decision, and the row stays absent until it is taken.
    if (BRACKET_SLOT.test(String(a)) || BRACKET_SLOT.test(String(b))) return { slot: true };
    // Positional form. teamA hosts the first leg, teamB hosts the second.
    return SECOND_LEG.has(leg) ? { home: b, away: a } : { home: a, away: b };
  };
  const attributed = [];
  const keep = (id, base, declaredBy = null) => {
    // `declaredBy` is the supplied fixture object itself, which carries the sides; `base` is the record
    // being built, which does not. Reading the sides off `base` would always miss them. The LEG comes
    // from the record, because it is a property of the match and not of the fixture — KPLUS-F043.
    const sides = sidesOf(id, declaredBy, base?.leg ?? declaredBy?.leg ?? null);
    if (!sides) {
      findings.push(finding(SEVERITY.CONFLICT, "MATCH_SIDES_UNRESOLVED",
        `match ${id} has no fixture naming both sides. It is excluded rather than given a placeholder: ` +
        `predictions are scored against these names, so a fabricated team is a scoring error.`, { match_id: id }));
      return null;
    }
    if (sides.slot) {
      findings.push(finding(SEVERITY.UNKNOWN, "MATCH_SIDE_IS_BRACKET_SLOT",
        `match ${id} names a bracket SLOT ("Winner Match N" / "Loser Match N") where a team belongs. The ` +
        `app resolves these at render from advanceSide; the fixture file never does. Excluded rather than ` +
        `written as a team — see PRODMIG-Q39-A1, which is an operator decision.`, { match_id: id }));
      return null;
    }
    attributed.push(id);
    return { ...base, home_team: sides.home, away_team: sides.away };
  };

  // Prefer supplied fixtures; otherwise derive the match set from result keys, which is all the document has.
  if (supplied) {
    const records = supplied.map((m) => keep(m.match_id, {
      match_id: m.match_id, competition_edition_phase_id: m.competition_edition_phase_id ?? null,
      status: m.status ?? "scheduled", leg: m.leg ?? null, tie_id: m.tie_id ?? null,
    }, m)).filter(Boolean).sort((a, b) => String(a.match_id).localeCompare(String(b.match_id)));
    for (const r of records) {
      if (!r.competition_edition_phase_id) {
        findings.push(finding(SEVERITY.UNKNOWN, "MATCH_WITHOUT_PHASE",
          `match ${r.match_id} has no phase, so no cutoff applies to it`, { match_id: r.match_id }));
      }
    }
    return result({ records, findings, coverage: {}, evidence: { source: "reference fixtures", attributed: attributed.length } });
  }

  if (results == null) {
    findings.push(finding(SEVERITY.WARNING, "NO_RESULTS_OBJECT",
      "results is null or absent (the v4-br shape). That means no results were recorded, not that an empty set was written."));
    return result({ records: [], findings, coverage: { results: COVERAGE.DERIVED } });
  }
  if (typeof results !== "object" || Array.isArray(results)) {
    findings.push(finding(SEVERITY.CONFLICT, "RESULTS_WRONG_SHAPE", `results must be an object keyed by match id; got ${typeof results}`));
    return result({ records: [], findings });
  }
  const records = Object.keys(results).sort().map((m) => keep(m, {
    match_id: m, competition_edition_phase_id: ctx.defaultPhaseId ?? null, status: "finished", leg: null, tie_id: null,
  })).filter(Boolean);
  findings.push(finding(SEVERITY.WARNING, "MATCHES_DERIVED_FROM_RESULTS",
    `${records.length} match(es) were derived from result keys because no fixture list was supplied. A match with ` +
    `no recorded result is therefore invisible to this derivation.`));
  return result({ records, findings, coverage: { results: COVERAGE.DERIVED }, evidence: { derivedFrom: "result keys", attributed: attributed.length } });
}

/**
 * transformTies — two-leg structures. Ties exist only in knockout shapes and are supplied as reference data;
 * the document does not distinguish a tie from a match.
 */
/**
 * transformTies — the knockout bracket, from the document that actually has one.
 *
 * THIS WAS STALE IN BOTH DIRECTIONS. It emitted `leg_one_match_id`, `leg_two_match_id` and
 * `advancing_team` — none of which are columns on `bolao.ties` (M6 has slug, team_a, team_b,
 * qualified_side, provenance, predecessor_tie_id) — and its no-data finding asserted that "the legacy
 * document does not distinguish a tie from a match, so ties cannot be derived from it." cdb2026's
 * document distinguishes them explicitly: `phases[<slug>].ties` is an object keyed by tie id, each value
 * carrying `teamA`, `teamB`, `qualifiedTeamId` and a `matches` sub-object. So the transformer produced
 * rows the target could not accept, for a source it claimed did not exist.
 *
 * `qualifiedTeamId` IS A SIDE, NOT A TEAM. Measured across all 28 live ties: the value set is exactly
 * {A, B, null} — 11 A, 13 B, 4 not yet decided. It never holds a team name, so it maps straight onto
 * `qualified_side char(1)` with no team lookup and no inference. A value outside {A, B} is reported and
 * left NULL rather than guessed: deciding a knockout tie changes advancement points.
 *
 * `matches` IS NOT READ HERE. Legs are the MATCHES domain; a tie that carried its own match data would
 * be a second source of truth for a fixture. `predecessor_tie_id` stays NULL — the document records no
 * bracket lineage, and deriving "who fed this tie" from team names would be inventing a bracket.
 */
export function transformTies(legacyState, ctx = {}) {
  const findings = [];
  const phases = legacyState?.phases && typeof legacyState.phases === "object" && !Array.isArray(legacyState.phases)
    ? legacyState.phases : null;
  if (!phases) {
    findings.push(finding(SEVERITY.WARNING, "NO_PHASE_STRUCTURE",
      "this document has no phases object, so it declares no ties. Not a defect: only the knockout product has them."));
    return result({ records: [], findings, coverage: {}, evidence: { ties: 0 } });
  }

  const records = [];
  const SIDES = new Set(["A", "B"]);
  for (const [phaseSlug, phase] of Object.entries(phases)) {
    const ties = phase?.ties && typeof phase.ties === "object" && !Array.isArray(phase.ties) ? phase.ties : null;
    if (!ties) continue;
    const phaseId = typeof ctx.phaseIdBySlug === "function" ? ctx.phaseIdBySlug(phaseSlug) : null;
    if (!phaseId) {
      findings.push(finding(SEVERITY.CONFLICT, "TIE_PHASE_UNRESOLVED",
        `phase "${phaseSlug}" carries ${Object.keys(ties).length} tie(s) but has no phase row. Its ties are ` +
        `not emitted: a tie must name the round it was played in.`, { phase: phaseSlug }));
      continue;
    }
    for (const [slug, t] of Object.entries(ties)) {
      const teamA = t?.teamA ?? null, teamB = t?.teamB ?? null;
      const raw = t?.qualifiedTeamId ?? null;
      let qualified = null;
      if (raw !== null && raw !== undefined) {
        if (SIDES.has(String(raw))) qualified = String(raw);
        else {
          findings.push(finding(SEVERITY.UNKNOWN, "TIE_QUALIFIED_SIDE_UNRECOGNISED",
            `tie ${slug} records a qualified value that is not a side (A/B). Left NULL rather than resolved ` +
            `against a team name — inferring advancement changes advancement points.`, { tie: slug }));
        }
      }
      if (teamA !== null && teamB !== null && teamA === teamB) {
        findings.push(finding(SEVERITY.CONFLICT, "TIE_SAME_TEAM_BOTH_SIDES",
          `tie ${slug} names the same team on both sides`, { tie: slug }));
        continue;
      }
      records.push({
        tie_id: typeof ctx.tieIdFor === "function" ? ctx.tieIdFor(phaseSlug, slug) : null,
        competition_edition_phase_id: phaseId,
        slug, team_a: teamA, team_b: teamB,
        qualified_side: qualified,
        // Provenance records WHERE the tie came from, not what happened in it.
        provenance: { source: "bolao_state.phases", phase: phaseSlug, tie: slug },
        predecessor_tie_id: null,
      });
      if (qualified === null && raw === null) {
        findings.push(finding(SEVERITY.UNKNOWN, "TIE_ADVANCEMENT_UNKNOWN",
          `tie ${slug} records no qualified side. It is left null: inferring advancement from goals would ` +
          `silently decide a knockout tie and change advancement points.`, { tie: slug }));
      }
    }
  }
  records.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  if (!records.length) {
    findings.push(finding(SEVERITY.WARNING, "NO_TIES", "the phases object declares no ties"));
  }
  return result({
    records, findings,
    coverage: { "phases[].ties": COVERAGE.MAPPED },
    evidence: { ties: records.length, decided: records.filter((r) => r.qualified_side).length },
  });
}

/**
 * transformMatchResults — an unrecorded result stays unrecorded. Treating a missing score as 0-0 would award
 * points for a match that was not played.
 */
export function transformMatchResults(legacyState, ctx = {}) {
  const findings = [];
  const results = legacyState?.results;
  if (results == null) {
    findings.push(finding(SEVERITY.WARNING, "NO_RESULTS_OBJECT", "results is null or absent; no results recorded"));
    return result({ records: [], findings, coverage: { results: COVERAGE.MAPPED } });
  }
  if (typeof results !== "object" || Array.isArray(results)) {
    findings.push(finding(SEVERITY.CONFLICT, "RESULTS_WRONG_SHAPE", `results must be an object; got ${typeof results}`));
    return result({ records: [], findings });
  }
  const records = [];
  for (const matchId of Object.keys(results).sort()) {
    const r = results[matchId];
    const h = r?.h ?? r?.home ?? null;
    const a = r?.a ?? r?.away ?? null;
    if (h === null || a === null) {
      findings.push(finding(SEVERITY.UNKNOWN, "RESULT_INCOMPLETE",
        `match ${matchId} has an incomplete result. It is NOT emitted: treating a missing score as 0-0 would ` +
        `award points for a match that was not played.`, { match_id: matchId }));
      continue;
    }
    if (!Number.isInteger(h) || !Number.isInteger(a)) {
      const hi = typeof h === "string" && /^\d+$/.test(h.trim()) ? Number(h.trim()) : null;
      const ai = typeof a === "string" && /^\d+$/.test(a.trim()) ? Number(a.trim()) : null;
      if (hi === null || ai === null) {
        findings.push(finding(SEVERITY.CONFLICT, "RESULT_NOT_INTEGER",
          `match ${matchId} has non-integer goals (${JSON.stringify(h)}, ${JSON.stringify(a)}). Coercing would invent a score.`,
          { match_id: matchId }));
        continue;
      }
      findings.push(finding(SEVERITY.WARNING, "RESULT_GOALS_AS_STRINGS",
        `match ${matchId} stored goals as strings; parsed as integers`, { match_id: matchId }));
      records.push({ match_result_id: `r-${matchId}`, match_id: matchId, home_goals: hi, away_goals: ai, is_official: true, superseded_by_id: null, advancing_team: r?.advance ?? null });
      continue;
    }
    records.push({
      match_result_id: `r-${matchId}`, match_id: matchId,
      home_goals: h, away_goals: a, is_official: true, superseded_by_id: null,
      advancing_team: r?.advance ?? r?.advancing ?? null,
    });
  }
  records.sort((x, y) => x.match_id.localeCompare(y.match_id));
  return result({ records, findings, coverage: { results: COVERAGE.MAPPED }, evidence: { recordedResults: records.length } });
}

/**
 * transformPredictions — preserves the pick payload EXACTLY.
 *
 * Scoring reads these. So goals are not normalised, not defaulted and not reordered in a way that changes
 * meaning; a missing pick stays missing, distinct from 0-0. `lock_context` carries the phase and cutoff that
 * applied, because a prediction's legitimacy depends on when it was made relative to a cutoff.
 */
export function transformPredictions(legacyState, ctx = {}) {
  const findings = [];
  const entries = Array.isArray(legacyState?.entries) ? legacyState.entries : [];
  const phaseOf = ctx.phaseByMatch instanceof Map ? ctx.phaseByMatch : new Map(Object.entries(ctx.phaseByMatch || {}));
  const records = [];

  for (const e of entries) {
    if (!e?.id) continue;
    const picks = e.picks;
    if (picks == null) continue;
    if (typeof picks !== "object" || Array.isArray(picks)) {
      findings.push(finding(SEVERITY.CONFLICT, "PICKS_WRONG_SHAPE",
        `entry ${e.id} has picks of type ${Array.isArray(picks) ? "array" : typeof picks}; expected an object keyed by match id`, { entry_id: e.id }));
      continue;
    }
    for (const subject of Object.keys(picks).sort()) {
      const p = picks[subject];
      const phase = phaseOf.get(subject) ?? null;
      if (p === null || p === undefined) {
        // A null pick is a real state — the participant did not predict this match. Preserved as such.
        records.push({ prediction_id: `pr-${e.id}-${subject}`, pool_entry_id: e.id, subject_id: subject,
          home_goals: null, away_goals: null, advancing_team: null,
          lock_context: phase, source_version: ctx.sourceVersion ?? null });
        continue;
      }
      const h = p.h ?? p.home ?? null;
      const a = p.a ?? p.away ?? null;
      const num = (x) => (Number.isInteger(x) ? x : (typeof x === "string" && /^\d+$/.test(x.trim()) ? Number(x.trim()) : null));
      const hi = num(h), ai = num(a);
      if ((h !== null && hi === null) || (a !== null && ai === null)) {
        findings.push(finding(SEVERITY.CONFLICT, "PREDICTION_NOT_INTEGER",
          `entry ${e.id} prediction for ${subject} has non-integer goals. Coercing would change a score.`, { entry_id: e.id, subject }));
        continue;
      }
      if (h === null || a === null) {
        findings.push(finding(SEVERITY.WARNING, "PREDICTION_PARTIAL",
          `entry ${e.id} prediction for ${subject} has only one side filled in; preserved as partial rather than completed`, { entry_id: e.id, subject }));
      }
      records.push({
        prediction_id: `pr-${e.id}-${subject}`, pool_entry_id: e.id, subject_id: subject,
        home_goals: hi, away_goals: ai,
        advancing_team: p.advance ?? p.advancing ?? null,
        lock_context: phase, source_version: ctx.sourceVersion ?? null,
      });
    }
  }
  records.sort((x, y) => x.prediction_id.localeCompare(y.prediction_id));
  const dupes = records.map((r) => r.prediction_id).filter((id, i, arr) => arr.indexOf(id) !== i);
  for (const d of new Set(dupes)) {
    findings.push(finding(SEVERITY.CONFLICT, "DUPLICATE_PREDICTION", `two predictions share the id ${d}, making scoring order-dependent`));
  }
  return result({ records, findings, coverage: { "entries[].picks": COVERAGE.MAPPED }, evidence: { predictions: records.length } });
}

/**
 * br2026's zone definitions — the ONE place they are written down.
 *
 * These are POSITION SLICES of the league table, and they are competition rules rather than data:
 *   G4  = positions 1-4    (qualification)
 *   SA6 = positions 7-12   (the "SA6" bonus band)
 *   Z4  = positions 17-20  (relegation)
 *
 * Evidence, identical in both implementations:
 *   bolao/br2026/scripts/send_round_email.py:448-450  standings[0:4] / [6:12] / [16:20]
 *   bolao/br2026/js/app.js:629-631                    slice(0,4) / slice(6,12) / slice(16,20)
 * and `SA6_HIT = 8  # pick lands anywhere in positions 7-12` in br2026/scripts/audit_scoring.py.
 *
 * Because they are pure slices, NO zone membership is stored on a standings row. Storing is_g4/is_z4/
 * is_sa6 would be a second source of truth for a boundary that position already determines, and it is
 * exactly the kind of derived column this model refuses elsewhere for settlement.
 *
 * `from` is 1-based and inclusive, matching how a league table is read by a human.
 */
export const BR2026_ZONES = Object.freeze({
  g4: { from: 1, to: 4, why: "qualification places" },
  sa6: { from: 7, to: 12, why: "the SA6 bonus band; audit_scoring.py names positions 7-12 explicitly" },
  z4: { from: 17, to: 20, why: "relegation places" },
});

/** Slice a position-ordered classification into a zone. Selection only — no scoring, no points. */
export function zoneSlice(orderedRows, zone) {
  const z = BR2026_ZONES[zone];
  if (!z) throw new Error(`unknown zone ${zone}`);
  return orderedRows.filter((r) => r.position >= z.from && r.position <= z.to)
    .sort((a, b) => a.position - b.position);
}

/**
 * Classification snapshot envelope, from the persisted provider snapshot.
 *
 * `legacyState.classification` is the snapshot object sync_espn.py writes to
 * bolao/br2026/data/espn-standings-normalized.json:
 *   { schemaVersion, competitionId, provider, generatedAt, sourceUpdatedAt, stale, staleReason,
 *     payloadHash, matches: [ { name, abbr, logo, rank, points, played, wins, draws, losses,
 *                               gf, ga, gd } ] }
 *
 * The rows array is called `matches` in the file. That is the provider-snapshot envelope's generic
 * name for "the rows", not a football match — worth stating, because reading it as fixtures is exactly
 * how a classification would end up in match_results.
 */
export function transformClassificationSnapshots(legacyState, ctx = {}) {
  const findings = [];
  const snap = legacyState?.classification;
  if (snap == null) {
    findings.push(finding(SEVERITY.WARNING, "NO_CLASSIFICATION",
      "no classification snapshot present; this competition may not have one (only br2026 scores against a league table)"));
    return result({ records: [], findings, coverage: { classification: COVERAGE.MAPPED } });
  }
  if (typeof snap !== "object" || Array.isArray(snap)) {
    findings.push(finding(SEVERITY.CONFLICT, "CLASSIFICATION_WRONG_SHAPE",
      `classification must be a snapshot object; got ${Array.isArray(snap) ? "array" : typeof snap}`));
    return result({ records: [], findings });
  }

  const rows = Array.isArray(snap.matches) ? snap.matches : null;
  if (!rows) {
    findings.push(finding(SEVERITY.CONFLICT, "CLASSIFICATION_NO_ROWS",
      "the snapshot carries no rows array. The app's own contract is to treat this as 'no table this cycle' and invent nothing, so no snapshot row is emitted either."));
    return result({ records: [], findings });
  }

  // An UNKNOWN schema version fails closed for scoring: the row shape decides positions, positions
  // decide zone boundaries, and zone boundaries decide points. Guessing at an unrecognised shape would
  // be guessing at a score.
  const KNOWN_SCHEMA_VERSIONS = ctx.knownClassificationSchemaVersions ?? [1];
  if (snap.schemaVersion == null) {
    findings.push(finding(SEVERITY.FATAL, "CLASSIFICATION_SCHEMA_VERSION_MISSING",
      "the snapshot declares no schemaVersion. The row shape determines position, position determines the zone boundaries, and the boundaries determine points — so an unidentifiable shape must not be scored against."));
  } else if (!KNOWN_SCHEMA_VERSIONS.includes(snap.schemaVersion)) {
    findings.push(finding(SEVERITY.FATAL, "CLASSIFICATION_SCHEMA_VERSION_UNKNOWN",
      `snapshot schemaVersion ${snap.schemaVersion} is not one of the known shapes [${KNOWN_SCHEMA_VERSIONS.join(", ")}]. Fails closed rather than assuming the fields mean what they meant in version ${KNOWN_SCHEMA_VERSIONS[0]}.`,
      { schemaVersion: snap.schemaVersion }));
  }

  if (snap.stale && !snap.staleReason) {
    findings.push(finding(SEVERITY.CONFLICT, "CLASSIFICATION_STALE_WITHOUT_REASON",
      "the snapshot is marked stale but gives no reason, so it cannot be triaged and must not be trusted as authoritative"));
  }
  if (snap.stale) {
    findings.push(finding(SEVERITY.UNKNOWN, "CLASSIFICATION_STALE",
      `the snapshot is stale (${snap.staleReason ?? "no reason given"}): the provider fetch failed and the last known good data was reused. It is imported as evidence but must never be the authoritative table for scoring.`));
  }
  if (!snap.generatedAt) {
    findings.push(finding(SEVERITY.FATAL, "CLASSIFICATION_NO_GENERATED_AT",
      "generatedAt is what orders snapshots, and ordering is the only thing that resolves a correction. Without it there is no way to say which classification is current."));
  }

  const record = {
    classification_snapshot_id: `cs-${ctx.editionId ?? snap.competitionId ?? "edition"}-${snap.generatedAt ?? "unknown"}`,
    competition_edition_id: ctx.editionId ?? null,
    provider: snap.provider ?? null,
    provider_competition_ref: snap.competitionId ?? null,
    source_url: ctx.classificationSourceUrl ?? null,
    schema_version: snap.schemaVersion ?? null,
    generated_at: snap.generatedAt ?? null,
    source_updated_at: snap.sourceUpdatedAt ?? null,
    retrieved_at: ctx.retrievedAt ?? snap.generatedAt ?? null,
    payload_hash: snap.payloadHash ?? null,
    is_stale: !!snap.stale,
    stale_reason: snap.staleReason ?? null,
    club_count: rows.length,
    created_by: null,
  };
  if (!record.competition_edition_id) {
    findings.push(finding(SEVERITY.FATAL, "CLASSIFICATION_NO_EDITION",
      "a classification with no edition is position 1 of nothing. The caller must supply ctx.editionId; it is never guessed from the provider's competition ref, because one provider id spans every season."));
  }
  return result({ records: [record], findings, coverage: { classification: COVERAGE.MAPPED },
    evidence: { clubCount: rows.length, stale: !!snap.stale, schemaVersion: snap.schemaVersion ?? null } });
}

/**
 * The club rows of a classification snapshot.
 *
 * Ordering is the APP's, not the provider's: `rank ASC, gd DESC, gf DESC, name ASC`. The app's own
 * comment records why — an ESPN rank tie "podia errar a fronteira entre zonas" (audit finding,
 * 2026-07-14). So the resolved 1-based `position` is materialised here, and the UNIQUE
 * (snapshot, position) index makes that audit finding something the database enforces.
 *
 * A remaining tie after all four keys is a FATAL: it would mean two clubs genuinely indistinguishable,
 * and any position assignment would be arbitrary — which is a zone boundary decided by chance.
 */
export function transformCompetitionEditionStandings(legacyState, ctx = {}) {
  const findings = [];
  const snap = legacyState?.classification;
  const rows = Array.isArray(snap?.matches) ? snap.matches : null;
  if (!rows) {
    if (snap != null) {
      findings.push(finding(SEVERITY.WARNING, "NO_STANDINGS_ROWS", "no classification rows to transform"));
    }
    return result({ records: [], findings, coverage: { "classification.matches": COVERAGE.MAPPED } });
  }

  const snapshotId = `cs-${ctx.editionId ?? snap.competitionId ?? "edition"}-${snap.generatedAt ?? "unknown"}`;
  const intOrNull = (v, field, club) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") {
      if (Number.isInteger(v)) return v;
      // ESPN serialises stat values as floats (1.0, 47.0). An INTEGRAL float is the same number and is
      // accepted; a genuinely fractional one is refused rather than truncated, because truncating a
      // goal difference could move a club across a zone boundary.
      if (Number.isInteger(Math.round(v)) && Math.abs(v - Math.round(v)) < Number.EPSILON) return Math.round(v);
      findings.push(finding(SEVERITY.CONFLICT, "STANDING_NON_INTEGER",
        `${club}: ${field} is ${v}, which is not a whole number. Rounding it could move a club across a zone boundary.`, { club, field }));
      return null;
    }
    if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
    findings.push(finding(SEVERITY.CONFLICT, "STANDING_NOT_NUMERIC",
      `${club}: ${field} is ${JSON.stringify(v)}; coercing it would invent a league statistic.`, { club, field }));
    return null;
  };

  const parsed = [];
  for (const r of rows) {
    const club = typeof r?.name === "string" ? r.name.trim() : "";
    if (!club) {
      findings.push(finding(SEVERITY.CONFLICT, "STANDING_NO_CLUB_NAME",
        "a classification row has no club name. The club name IS the identity br2026 scoring compares picks against, so a nameless row cannot be scored and must not silently shift the rows below it."));
      continue;
    }
    parsed.push({
      club,
      abbr: typeof r.abbr === "string" ? r.abbr : null,
      provider_rank: intOrNull(r.rank, "rank", club),
      points: intOrNull(r.points, "points", club),
      played: intOrNull(r.played, "played", club),
      wins: intOrNull(r.wins, "wins", club),
      draws: intOrNull(r.draws, "draws", club),
      losses: intOrNull(r.losses, "losses", club),
      gf: intOrNull(r.gf, "gf", club),
      ga: intOrNull(r.ga, "ga", club),
      gd: intOrNull(r.gd, "gd", club),
    });
  }

  const dupNames = parsed.map((p) => norm(p.club)).filter((n, i, a) => a.indexOf(n) !== i);
  for (const d of new Set(dupNames)) {
    findings.push(finding(SEVERITY.CONFLICT, "STANDING_DUPLICATE_CLUB",
      `${d} appears more than once in one snapshot. One club cannot hold two positions, and keeping both would shift every position below them.`));
  }

  // The app's exact ordering. Reproduced, not invented: rank -> goal difference -> goals for -> name.
  const ordered = [...parsed].sort((a, b) =>
    (a.provider_rank ?? 99) - (b.provider_rank ?? 99) ||
    (b.gd ?? 0) - (a.gd ?? 0) ||
    (b.gf ?? 0) - (a.gf ?? 0) ||
    a.club.localeCompare(b.club, "pt-BR"));

  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    if ((a.provider_rank ?? 99) === (b.provider_rank ?? 99) && (a.gd ?? 0) === (b.gd ?? 0) &&
        (a.gf ?? 0) === (b.gf ?? 0) && a.club.localeCompare(b.club, "pt-BR") === 0) {
      findings.push(finding(SEVERITY.FATAL, "STANDING_UNRESOLVED_TIE",
        `${a.club} and ${b.club} are indistinguishable after rank, goal difference, goals for and name. Any position assignment would be arbitrary, and position decides the zone boundary.`));
    }
  }

  const records = ordered.map((p, i) => ({
    standing_id: `st-${snapshotId}-${i + 1}`,
    classification_snapshot_id: snapshotId,
    position: i + 1,
    provider_rank: p.provider_rank,
    club_name: p.club,
    club_abbr: p.abbr,
    points: p.points, played: p.played, wins: p.wins, draws: p.draws, losses: p.losses,
    goals_for: p.gf, goals_against: p.ga, goal_difference: p.gd,
  }));

  for (const r of records) {
    if (r.goals_for !== null && r.goals_against !== null && r.goal_difference !== null &&
        r.goal_difference !== r.goals_for - r.goals_against) {
      findings.push(finding(SEVERITY.CONFLICT, "STANDING_GD_INCONSISTENT",
        `${r.club_name}: goal difference ${r.goal_difference} does not equal ${r.goals_for} - ${r.goals_against}. The source contradicts itself, and preferring one field over the other would be a guess.`,
        { club: r.club_name }));
    }
  }

  // A short table is a FATAL, not a warning: the zones are position slices, so nineteen rows instead of
  // twenty silently moves the relegation boundary up by one place.
  const expected = ctx.expectedClubCount ?? null;
  if (expected != null && records.length !== expected) {
    findings.push(finding(SEVERITY.FATAL, "STANDING_CLUB_COUNT_MISMATCH",
      `${records.length} clubs, expected ${expected}. The zones are position slices, so a missing club moves a zone boundary rather than merely omitting a row.`,
      { got: records.length, expected }));
  }

  return result({ records, findings,
    coverage: { "classification.matches": COVERAGE.MAPPED, "classification.matches[].rank": COVERAGE.DERIVED },
    evidence: { clubs: records.length, orderedBy: "provider_rank, goal_difference DESC, goals_for DESC, club_name" } });
}

/** Ranking snapshots are not in the legacy document — the app recomputed them on demand. */
export function transformRankingSnapshots(legacyState, ctx = {}) {
  const findings = [finding(SEVERITY.UNKNOWN, "NO_HISTORICAL_RANKINGS",
    "the legacy document stores no ranking history; the app recomputed standings on demand. Reconstructing " +
    "snapshots would fabricate published history nobody ever saw.")];
  return result({ records: [], findings, coverage: {}, evidence: { historicalSnapshots: 0 } });
}

/**
 * transformSyncState — what the provider pull has ALREADY DONE, so a re-run neither re-applies nor
 * re-guesses.
 *
 * THIS READ `lastSync` AND THE LIVE DOCUMENT HAS NO SUCH KEY. `LIVE_SOURCE_KEYS.espnSync` declares the
 * mapping — `espnSync` -> `bolao.sync_state`, disposition MAPPED, all five sub-keys — and the transformer
 * produced nothing for it, because it was reading a field that does not exist in production. The source
 * accounting said MAPPED and the transformer said zero rows. That is the same defect class as `cutoffAt`
 * (Q29-F1): a claim about a column, not about a value.
 *
 * WHAT THE FIVE KEYS ACTUALLY ARE, and why they are not interchangeable:
 *
 *   activePhaseId                a POINTER into the edition's phases. Resolved through the phase slug, or
 *                                left NULL if that phase is not in the target — never fabricated, because
 *                                a wrong active phase makes the next sync repair the wrong round.
 *   seededKnownConfrontos        one-off: the known fixtures were seeded
 *   backfilledOitavasKickoffs    one-off: the oitavas kickoff times were backfilled
 *   healedPhantomTies            one-off: phantom ties were removed
 *   healedFalseAutoResults       one-off: falsely auto-filled results were reverted
 *
 * The four booleans are IDEMPOTENCY MARKERS, not settings. `audit_state_merge.mjs` carries a regression
 * test proving all five must survive a merge, because a previous version carried only two through. Losing
 * one lets a healing pass run a second time against data it already repaired.
 *
 * NO TIMESTAMPS EXIST IN THE SOURCE. `last_success_at`, `last_error_at` and `last_error_category` are
 * therefore NULL and reported, never defaulted to `now()` — a migration-time instant would claim the
 * provider synced during the migration, which is exactly backwards from what this row is for.
 */
export function transformSyncState(legacyState, ctx = {}) {
  const findings = [];
  const sync = legacyState?.espnSync && typeof legacyState.espnSync === "object" ? legacyState.espnSync : null;
  // TWO SHAPES, and dropping either loses real state. `espnSync` is what every live document carries
  // (measured 2026-08-11). `lastSync` is the older shape — a bare last-success timestamp — and
  // CRITICAL_FIELDS still lists it precisely so an older document remains accounted for. The previous
  // version of this transformer read ONLY `lastSync` and claimed `lastSync: MAPPED` unconditionally,
  // which covered a field no live document has while producing nothing for the field they all do have.
  const lastSync = legacyState?.lastSync ?? null;
  if (!sync && !lastSync) {
    // Not a defect: main and br2026 have no provider sync of either shape.
    findings.push(finding(SEVERITY.WARNING, "NO_PROVIDER_SYNC_STATE",
      "this pool's document carries neither espnSync nor lastSync; no sync cursor is derived for it"));
    return result({ records: [], findings, coverage: { lastSync: COVERAGE.MAPPED }, evidence: { cursors: 0 } });
  }

  // Every key except the phase pointer is a seed/repair marker. Read the object rather than a fixed list,
  // so a marker added later travels instead of being silently dropped — losing one is what re-runs a
  // repair pass.
  const seed_flags = {};
  for (const [k, v] of Object.entries(sync ?? {})) {
    if (k === "activePhaseId") continue;
    seed_flags[k] = v;
    if (typeof v !== "boolean") {
      findings.push(finding(SEVERITY.WARNING, "NON_BOOLEAN_SEED_FLAG",
        `espnSync.${k} is ${typeof v}, not a boolean. Carried verbatim rather than coerced.`, { key: k }));
    }
  }

  const slug = typeof sync?.activePhaseId === "string" ? sync.activePhaseId : null;
  const resolved = slug && typeof ctx.phaseIdBySlug === "function" ? ctx.phaseIdBySlug(slug) : null;
  if (slug && !resolved) {
    findings.push(finding(SEVERITY.UNKNOWN, "ACTIVE_PHASE_UNRESOLVED",
      `espnSync.activePhaseId names "${slug}", which has no phase row in this edition. Left NULL rather ` +
      `than pointed at a different phase — a wrong active phase makes the next sync repair the wrong round.`,
      { slug }));
  }
  if (sync && !Object.prototype.hasOwnProperty.call(sync, "activePhaseId")) {
    findings.push(finding(SEVERITY.WARNING, "NO_ACTIVE_PHASE", "espnSync records no activePhaseId"));
  }

  if (!lastSync) {
    findings.push(finding(SEVERITY.UNKNOWN, "NO_SYNC_TIMESTAMPS",
      "espnSync carries no last-success, last-error or error-category. All three are NULL: a migration-time " +
      "default would claim the provider synced during the migration."));
  }

  const records = [{
    sync_state_id: ctx.syncStateId ?? null,
    provider: ctx.provider ?? "espn",
    competition_edition_id: ctx.editionId ?? null,
    active_phase_id: resolved,
    cursor: {},
    seed_flags,
    // The older shape's ONE piece of information. NULL when the document does not carry it — never a
    // migration-time instant, which would claim the provider synced during the migration.
    last_success_at: lastSync, last_error_at: null, last_error_category: null,
  }];
  if (!records[0].competition_edition_id) {
    findings.push(finding(SEVERITY.CONFLICT, "SYNC_STATE_WITHOUT_EDITION", "no edition was supplied for the sync cursor"));
  }
  return result({
    records, findings,
    coverage: {
      espnSync: COVERAGE.MAPPED,
      "espnSync.activePhaseId": resolved ? COVERAGE.MAPPED : COVERAGE.UNKNOWN,
      // MAPPED whether or not this document has it: the field is READ, and a document that carries it
      // populates last_success_at. Claiming coverage only when a value happens to be present would make
      // the gate's verdict depend on the fixture rather than on the transformer.
      lastSync: COVERAGE.MAPPED,
    },
    evidence: { cursors: records.length, seedFlags: Object.keys(seed_flags).length, activePhaseSlug: slug, hasLastSync: !!lastSync },
  });
}

/**
 * The legacy audit vocabulary, expressed in the target's vocabulary WITHOUT inventing meaning.
 *
 * KPLUS-F025. `audit.audit_events` carries `CHECK (action ~ '^[a-z_]+\.[a-z_]+$')` — the model's
 * `aggregate.past_tense` shape — and the legacy log's actions are bare kebab-case verbs (`save-leg`,
 * `lock-tie`, `round-email-sent`). Passing them through verbatim, which is what this transformer did,
 * meant every real audit event was refused by the CHECK: the whole domain was unloadable.
 *
 * The obvious repair — map each legacy verb onto the canonical vocabulary — is the wrong one. `edit`
 * does not say which aggregate was edited or what the edit was, so any mapping to `pool_entry.updated`
 * would be a claim the legacy log does not make. The audit log's value is that it is a faithful record;
 * inventing a more precise one is worse than carrying an imprecise one honestly.
 *
 * So the legacy verb is NAMESPACED rather than reinterpreted: `save-leg` becomes `legacy.save_leg`. The
 * namespace says exactly where the event came from, the transform is lossless (strip `legacy.`, `_`→`-`)
 * and no reader can mistake a migrated row for one the new write path produced.
 *
 * FAIL-CLOSED. The CHECK's character class is `[a-z_]` — no digits. A legacy verb containing a digit
 * cannot be namespaced without either dropping the digit (silently conflating `round2` with `round`) or
 * widening a constraint to fit the data. Neither is acceptable, so it is FATAL: the audit domain then
 * reads nothing at all rather than loading a history with a hole in it. None of the 52 real events hit
 * this, which is exactly why it needs a test rather than a note.
 */
const LEGACY_ACTION_NAMESPACE = "legacy";
const SHAPED_ACTION_TOKEN = /^[a-z_]+$/;
export function legacyActionToken(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * transformAuditMetadata — free-text `detail` is INTENTIONALLY_DROPPED per B1/ADR-008.
 *
 * The drop is reported per row rather than silently: an audit backfill that quietly loses the only human
 * explanation of each event should be a visible decision, not a surprise found later.
 */
export function transformAuditMetadata(legacyState, ctx = {}) {
  const findings = [];
  const log = legacyState?.auditLog;
  if (log == null) {
    findings.push(finding(SEVERITY.WARNING, "NO_AUDIT_LOG",
      "no auditLog[] present. In the v3-pre-audit shape this is a real absence, not a transformation failure."));
    return result({ records: [], findings, coverage: { auditLog: COVERAGE.MAPPED } });
  }
  if (!Array.isArray(log)) {
    findings.push(finding(SEVERITY.CONFLICT, "AUDIT_LOG_WRONG_SHAPE", `auditLog must be an array; got ${typeof log}`));
    return result({ records: [], findings });
  }
  const records = [];
  let droppedDetails = 0;
  let unexpressibleActions = 0;
  for (const [i, a] of log.entries()) {
    if (a?.detail) droppedDetails++;
    const token = legacyActionToken(a?.action) || "unknown";
    if (!SHAPED_ACTION_TOKEN.test(token)) {
      // The value is NOT reported — a legacy action string is free text and may carry a name. The index
      // and the offending character class are enough to find it in the source.
      unexpressibleActions++;
      findings.push(finding(SEVERITY.FATAL, "AUDIT_ACTION_NOT_EXPRESSIBLE",
        `audit entry ${i + 1} has an action that cannot be expressed in the target vocabulary's character ` +
        `class [a-z_]. Namespacing it would require dropping characters, which would conflate two distinct ` +
        `legacy actions. The audit domain therefore loads nothing rather than loading an altered history.`,
        { index: i + 1 }));
    }
    records.push({
      audit_event_id: `a-${i + 1}`,
      occurred_at: a?.ts ?? null,
      action: `${LEGACY_ACTION_NAMESPACE}.${token}`,
      actor_role: a?.admin ? "operator" : "system",
      // Claiming `pool_entry` for an event that names no entry asserts a subject the legacy log never
      // recorded. `unknown` is the accurate statement, and it keeps (aggregate_type, aggregate_id)
      // internally consistent instead of pairing a confident type with a NULL id.
      aggregate_type: a?.entryId ? "pool_entry" : "unknown",
      aggregate_id: a?.entryId ?? null,
      safe_metadata: {},
      reason: a?.admin ? "migrated from legacy audit log" : null,
      sequence: i + 1,
    });
    if (!a?.ts) findings.push(finding(SEVERITY.UNKNOWN, "AUDIT_EVENT_WITHOUT_TIMESTAMP", `audit entry ${i + 1} has no ts`, { index: i + 1 }));
    if (!a?.entryId) findings.push(finding(SEVERITY.UNKNOWN, "AUDIT_EVENT_WITHOUT_AGGREGATE", `audit entry ${i + 1} names no entry`, { index: i + 1 }));
  }
  if (droppedDetails) {
    findings.push(finding(SEVERITY.WARNING, "AUDIT_DETAIL_DROPPED",
      `${droppedDetails} audit entr(ies) carried free-text detail, which is intentionally dropped per B1/ADR-008. ` +
      `Carrying it across would reintroduce exactly the PII the audit model exists to keep out.`));
  }
  return result({
    records, findings,
    coverage: { auditLog: COVERAGE.MAPPED, "auditLog[].ts": COVERAGE.MAPPED, "auditLog[].action": COVERAGE.MAPPED,
      "auditLog[].admin": COVERAGE.DERIVED, "auditLog[].detail": COVERAGE.INTENTIONALLY_DROPPED },
    evidence: { auditEntries: records.length, droppedDetails, unexpressibleActions },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
export const TRANSFORMERS = Object.freeze({
  transformParticipants, transformParticipantIdentityCandidates,
  transformCompetitions, transformCompetitionEditions, transformCompetitionPhases,
  transformPools, transformPoolEntries,
  transformPayments, transformPaymentAllocations,
  transformMatches, transformTies, transformPredictions, transformMatchResults,
  transformClassificationSnapshots, transformCompetitionEditionStandings,
  transformRankingSnapshots, transformSyncState, transformAuditMetadata,
});

/** Money-bearing transformers, for the version gate and the fail-closed tests. */
export const MONEY_BEARING = Object.freeze(["transformPoolEntries", "transformPayments", "transformPaymentAllocations"]);

/** Run every transformer and merge coverage. Used by the coverage gate and the integrated scenario. */
export function transformAll(legacyState, ctx = {}) {
  const out = {};
  const coverage = {};
  const findings = [];
  for (const [name, fn] of Object.entries(TRANSFORMERS)) {
    const r = fn(legacyState, ctx);
    out[name] = r;
    for (const [path, cls] of Object.entries(r.coverage || {})) {
      /**
       * A field may legitimately be claimed by two transformers with DIFFERENT classes, and the first
       * version of this merge treated every such case as a conflict. It found three, and all three were
       * legitimate:
       *
       *   entries[].picks   ARCHIVED by transformPoolEntries (kept as jsonb through M15) and MAPPED by
       *                     transformPredictions (decomposed at M16). Both are true, at different phases.
       *   results           DERIVED by transformMatches (match ids come from the keys) and MAPPED by
       *                     transformMatchResults (the values become rows).
       *   participantEmail  MAPPED by transformParticipants and DERIVED by the candidate transformer.
       *
       * So the strongest accounting wins, by the precedence below. What the gate actually cares about is
       * whether a field is ACCOUNTED FOR at all; MAPPED subsumes ARCHIVED, and DERIVED subsumes neither
       * being looked at. A genuine conflict — two transformers both claiming MAPPED with different
       * meanings — is not expressible in this vocabulary and is caught by the record-level tests instead.
       */
      const prev = coverage[path];
      coverage[path] = prev ? strongestCoverage(prev, cls) : cls;
    }
    findings.push(...r.findings.map((f) => ({ ...f, transformer: name })));
  }
  return { results: out, coverage, findings, ok: findings.every((f) => f.severity !== SEVERITY.FATAL) };
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  console.log("\nLegacy → normalized transformers\n");
  console.log(`  transformers: ${Object.keys(TRANSFORMERS).length}`);
  console.log(`  money-bearing: ${MONEY_BEARING.join(", ")}`);
  console.log(`  severities: ${Object.keys(SEVERITY).join(", ")}`);
  console.log(`  coverage classes: ${Object.keys(COVERAGE).join(", ")}\n`);
  for (const [v, d] of Object.entries(LEGACY_VERSIONS)) console.log(`  ${v.padEnd(16)} ${d.status}`);
  console.log("");
}

// ─────────────────────────────────────────────────────────────────────────────
// WS7.4 — FIELD COVERAGE GATE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Critical legacy fields, by domain. "Critical" means: if this field's disposition is unknown, something
 * that matters is being lost or invented.
 *
 * `money` marks the fields where an UNKNOWN disposition is a hard FAIL rather than a reportable gap. That
 * distinction is the whole value of the gate: an unmapped `siteVersion` is untidy, an unmapped `paid` is a
 * pool whose collected total is wrong.
 */

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * LIVE SOURCE KEYS AND THEIR DISPOSITIONS — the blind spot this closes
 *
 * `CRITICAL_FIELDS` was built from an older reading of the state documents. Measured against LIVE
 * production on 2026-08-11 it was wrong in both directions: it names `lastSync`, which no live document
 * has, and it omits SEVEN keys that every live document collection does have. A field the coverage gate
 * has never heard of cannot be reported as UNKNOWN — it is simply invisible, which is the one failure
 * mode a coverage gate exists to prevent.
 *
 * Every disposition below is from producer/consumer evidence in this repository plus the measured
 * production shape. None is inferred from the key's name.
 *
 * NOT_YET_REPRESENTABLE is deliberately NOT one of the allowed dispositions — it is recorded as
 * `blocksDomain`, because "we have nowhere to put it" is a fact about the target model, not a decision
 * about the data, and it must block the affected domain rather than quietly become an exclusion.
 */
export const LIVE_SOURCE_KEYS = Object.freeze({
  meta: Object.freeze({
    presentIn: ["main", "br2026", "cdb2026"], jsonType: "object", subKeys: ["updatedAt", "version"],
    producer: "saveState() in each app writes meta.updatedAt = now() and meta.version = CONFIG.siteVersion on every save",
    consumer: "br2026 app.js:2952 renders meta.updatedAt as the 'last updated' stamp",
    scoringImpact: "none", financialImpact: "none",
    disposition: COVERAGE.DERIVED,
    why: "meta describes the JSON BLOB, not a business entity. updatedAt is re-derivable as max(updated_at) across the pool's normalized rows, and version is the app build that last wrote the document — an artefact of the legacy container. Retained in lineage via the document md5, which changes if either does.",
    targetRepresentation: "derived: max(bolao.pool_entries.updated_at) per pool; the read model computes it rather than storing it",
  }),
  cutoffAt: Object.freeze({
    presentIn: ["br2026"], jsonType: "string (ISO-8601, 24 chars)",
    producer: "freezeSeasonCutoff()/nextUpcomingGame() in br2026 app.js; config.js records that the production value was also updated DIRECTLY in Supabase",
    consumer: "br2026 entry validation — it is the deadline an entry is late against",
    scoringImpact: "none directly", financialImpact: "indirect — a late entry is an entry that should not have been accepted",
    disposition: COVERAGE.MAPPED,
    resolvedBy: "M13 (20260812050000) — bolao.pools.entry_cutoff_at, nullable timestamptz, no default. OP-Q22-1 closed as YELLOW additive schema completion, applied to production 2026-08-11.",
    why: "BUSINESS-SIGNIFICANT, and until M13 it had NO target column. bolao.pools carries status and prize_split; competition_editions carries starts_on/ends_on, which are the EDITION's dates, not the pool's entry deadline. Recording this as an exclusion would discard the rule that decides whether an entry was submitted in time. It blocks the br2026 POOL domain only — entries carry their own created_at and are unaffected.",
    targetRepresentation: "bolao.pools.entry_cutoff_at (M13). Nullable because two source states map to NULL and both mean 'no frozen cutoff': KEY_ABSENT (main, cdb2026 — those pools do not use the mechanism) and JSON_NULL (br2026 pre-freeze). That distinction is preserved in lineage, not in the column; neither state is observable in production today.",
  }),
  roundEmail: Object.freeze({
    presentIn: ["br2026"], jsonType: "object", subKeys: ["baseline", "ledger", "pendingBatch", "sentBatches", "sentGameIds"],
    producer: "bolao/br2026/scripts/send_round_email.py — state.setdefault('roundEmail', {}) at two call sites",
    consumer: "the same script, to avoid re-sending a round it has already sent",
    scoringImpact: "none", financialImpact: "none",
    disposition: COVERAGE.ARCHIVED,
    why: "operational state belonging to a Python dispatch script, not to the domain model. Re-deriving it into outbox_events would FABRICATE delivery records that the outbox never produced — the outbox would then assert it had sent emails it did not send. Archived rather than dropped: the legacy script keeps reading it until cutover, so it must not be removed from legacy either.",
    targetRepresentation: "none. bolao.outbox_events records what the NEW path sends; it does not retroactively claim the old path's history.",
  }),
  activePhase: Object.freeze({
    presentIn: ["cdb2026"], jsonType: "string",
    producer: "cdb2026 knockout progression", consumer: "cdb2026 app.js phase rendering",
    scoringImpact: "none — it selects which phase is displayed, not how points are computed",
    financialImpact: "none",
    disposition: COVERAGE.DERIVED,
    why: "a pointer at one of the rows in `phases`. Once competition_edition_phases carries per-phase status, the active phase is the one whose status says so — storing it twice creates a second source of truth for which phase is current.",
    targetRepresentation: "derived from bolao.competition_edition_phases.status",
  }),
  espnSync: Object.freeze({
    presentIn: ["cdb2026"], jsonType: "object",
    subKeys: ["activePhaseId", "backfilledOitavasKickoffs", "healedFalseAutoResults", "healedPhantomTies", "seededKnownConfrontos"],
    producer: "the cdb2026 ESPN sync and its one-off repair passes",
    consumer: "the same sync, as idempotency markers — audit_state_merge.mjs carries a regression test proving all five flags must survive a merge, because a previous version carried only two through",
    scoringImpact: "none", financialImpact: "none",
    disposition: COVERAGE.MAPPED,
    why: "these are exactly what bolao.sync_state (M6) exists for: a record of what the provider pull has already done, so a re-run neither re-applies nor re-guesses. Four are one-off repair markers and must migrate as such — losing them would let a healing pass run a second time.",
    targetRepresentation: "bolao.sync_state, one row per (edition, sync kind)",
  }),
  phases: Object.freeze({
    presentIn: ["cdb2026"], jsonType: "object (9 phase ids, each with a `ties` map)",
    producer: "cdb2026 app.js:80-83 normalises s.phases and s.phases[id].ties on load",
    consumer: "the whole cdb2026 knockout UI and its scoring",
    scoringImpact: "READ-ONLY EVIDENCE: ties are the unit CDB scores against, so the structure must survive, but no scoring formula is migrated with it",
    financialImpact: "none directly",
    disposition: COVERAGE.MAPPED,
    why: "the knockout envelope. bolao.competition_edition_phases and bolao.ties (M6) were created for precisely this shape, which is why detectLegacyShape() uses the presence of `phases` as the v4-cdb signature.",
    targetRepresentation: "bolao.competition_edition_phases + bolao.ties",
  }),
  deletedResults: Object.freeze({
    presentIn: ["main"], jsonType: "array", liveCardinality: 0,
    producer: "copa2026 send_result_email.py --clear-result, which removes a result and adds its id here",
    consumer: "copa2026 app.js mergeStates(): `for (const mid of resultTombstones) delete mergedResults[mid]`",
    scoringImpact: "DIRECT — a tombstoned result is one that must NOT be scored. Losing the tombstone resurrects a result an admin deliberately removed.",
    financialImpact: "indirect — results drive the ranking that drives the payout",
    disposition: COVERAGE.MAPPED,
    why: "a TOMBSTONE, and tombstones are load-bearing precisely because they are absences. It is currently an EMPTY ARRAY on main, so today's migration carries nothing — but 'currently empty' is not 'safe to ignore', and a non-empty value at cutover must suppress the corresponding result rather than being silently dropped.",
    targetRepresentation: "bolao.match_results supersession (superseded_by_id), or an explicit tombstone row — decided when the results domain backfills",
  }),
});

/** Keys the gate must account for, drawn from live production rather than from an older reading. */
export const LIVE_PRODUCTION_KEYS = Object.freeze([
  "entries", "paid", "deletedIds", "auditLog", "results",
  "meta", "cutoffAt", "roundEmail", "activePhase", "espnSync", "phases", "deletedResults",
]);

/**
 * Which source keys currently BLOCK which backfill domain.
 *
 * A key with no target representation does not get to be an exclusion just because the migration would
 * be easier without it.
 */
export function blockedDomains(keys = LIVE_SOURCE_KEYS) {
  return Object.entries(keys)
    .filter(([, v]) => v.disposition === COVERAGE.UNKNOWN && v.blocksDomain)
    .map(([k, v]) => ({ key: k, domain: v.blocksDomain, why: v.why }));
}

export const CRITICAL_FIELDS = [
  { path: "entries[]", domain: "entries", money: false },
  { path: "entries[].id", domain: "entries", money: false },
  { path: "entries[].entryName", domain: "identity", money: false },
  { path: "entries[].participantEmail", domain: "identity", money: false },
  { path: "entries[].payerName", domain: "payments", money: true },
  { path: "entries[].paymentMethod", domain: "payments", money: true },
  { path: "entries[].picks", domain: "predictions", money: false },
  { path: "entries[].createdAt", domain: "entries", money: false },
  { path: "entries[].updatedAt", domain: "entries", money: false },
  { path: "paid", domain: "payments", money: true },
  { path: "deletedIds", domain: "entries", money: false },
  { path: "entries[].entryLabel", domain: "entries", money: false },
  { path: "auditLog", domain: "competition state", money: false },
  { path: "auditLog[].ts", domain: "competition state", money: false },
  { path: "auditLog[].action", domain: "competition state", money: false },
  { path: "auditLog[].admin", domain: "competition state", money: false },
  { path: "auditLog[].detail", domain: "competition state", money: false },
  { path: "results", domain: "results", money: false },
  // `lastSync` is NOT present in any live production document (measured 2026-08-11). Kept so an older
  // document carrying it is still accounted for, and flagged so nobody reads its presence here as evidence
  // that production has it.
  { path: "lastSync", domain: "competition state", money: false, notInLiveProduction: true },
];

/** Non-critical fields with a recorded disposition, so the gate does not report them as surprises. */
export const NON_CRITICAL_DISPOSITIONS = Object.freeze({
  siteVersion: COVERAGE.INTENTIONALLY_DROPPED,
});

/**
 * Check coverage of every critical field against what the transformers actually claim.
 *
 * Returns findings, and `ok` is false when ANY critical field is UNKNOWN — with money fields reported as
 * FATAL so a caller cannot treat them as advisory.
 */
export function checkFieldCoverage(coverage, { criticalFields = CRITICAL_FIELDS } = {}) {
  const findings = [];
  const valid = new Set(Object.values(COVERAGE));
  const resolved = {};

  for (const f of criticalFields) {
    const cls = coverage[f.path] ?? NON_CRITICAL_DISPOSITIONS[f.path] ?? COVERAGE.UNKNOWN;
    resolved[f.path] = cls;
    if (!valid.has(cls)) {
      findings.push(finding(SEVERITY.FATAL, "INVALID_COVERAGE_CLASS",
        `field ${f.path} is classified ${JSON.stringify(cls)}, which is not a coverage class`, { path: f.path }));
      continue;
    }
    if (cls === COVERAGE.UNKNOWN) {
      findings.push(finding(
        f.money ? SEVERITY.FATAL : SEVERITY.UNKNOWN,
        f.money ? "UNMAPPED_CRITICAL_MONEY_FIELD" : "UNMAPPED_CRITICAL_FIELD",
        f.money
          ? `critical MONEY-BEARING field ${f.path} (${f.domain}) has no disposition. Proceeding would leave a ` +
            `financial total wrong by an unknown amount, so this is a hard failure.`
          : `critical field ${f.path} (${f.domain}) has no disposition. It is neither mapped, derived, archived ` +
            `nor explicitly dropped, so it would be lost without anyone deciding to lose it.`,
        { path: f.path, domain: f.domain }));
    }
  }

  // A path the transformers claim that is not in any list is worth surfacing: it may be a new legacy field.
  for (const path of Object.keys(coverage)) {
    if (criticalFields.some((f) => f.path === path)) continue;
    if (path in NON_CRITICAL_DISPOSITIONS) continue;
    findings.push(finding(SEVERITY.WARNING, "COVERAGE_FOR_UNLISTED_FIELD",
      `a transformer claims coverage for ${path}, which is not in the critical list. If it matters, add it; ` +
      `if it does not, that is worth stating.`, { path }));
  }

  const unmappedMoney = findings.filter((f) => f.code === "UNMAPPED_CRITICAL_MONEY_FIELD");
  return {
    ok: findings.every((f) => f.severity !== SEVERITY.FATAL),
    findings, resolved,
    criticalCount: criticalFields.length,
    unknownCount: Object.values(resolved).filter((c) => c === COVERAGE.UNKNOWN).length,
    unmappedMoneyCount: unmappedMoney.length,
  };
}
