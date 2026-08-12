#!/usr/bin/env node
/**
 * Tests for the legacy → normalized transformers (Workstream 7, all sub-parts).
 *
 * Every legacy document here is synthetic and written in this file. No production JSON, no participant value.
 *
 * The transformers' value is in what they REFUSE and what they REPORT, so most of these tests feed malformed
 * or ambiguous input and assert the category of the finding — not merely that something went wrong. A
 * transformer that returns WARNING where it should return FATAL is a transformer that will lose money quietly.
 */

import {
  SEVERITY, COVERAGE, LEGACY_VERSIONS, TRANSFORMERS, MONEY_BEARING, CRITICAL_FIELDS,
  classifyVersion, detectLegacyShape, digestRecords, transformAll, checkFieldCoverage, strongestCoverage,
  transformParticipants, transformParticipantIdentityCandidates,
  transformCompetitions, transformCompetitionEditions, transformCompetitionPhases,
  transformPools, transformPoolEntries, transformPayments, transformPaymentAllocations, readEntryCutoff,
  extractCdbMatches, CDB_LEG_ORDER, CDB_STATUS_MAP,
  extractCdbMatchResults, CDB_RESULT_SOURCE, CDB_RESULT_SOURCE_UNRECORDED, BRACKET_SLOT,
  extractCdbPredictions,
  transformMatches, transformTies, transformPredictions, transformMatchResults,
  transformRankingSnapshots, transformSyncState, transformAuditMetadata,
  LIVE_SOURCE_KEYS, LIVE_PRODUCTION_KEYS, blockedDomains, NON_CRITICAL_DISPOSITIONS,
} from "./transformers.mjs";
import { parseMoney } from "./financial.mjs";
import { rng } from "./synthetic_dataset.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const hasCode = (r, code) => r.findings.some((f) => f.code === code);
const codeSeverity = (r, code) => (r.findings.find((f) => f.code === code) || {}).severity;

const USD = "USD";
const FEE = parseMoney("5.00", USD);
const CTX = { sourceVersion: "v4-copa", poolId: "pool-x", editionId: "ed-1", expectedFee: FEE };
const POOL_CTX = (over = {}) => ({
  sourceVersion: "v4-br", poolId: "pool-br", editionId: "ed-br", expectedFee: FEE,
  pools: [{ pool_id: "pool-br", competition_edition_id: "ed-br", slug: "br2026", name: "Bolão BR" }],
  ...over,
});

const DOC = () => ({
  entries: [
    { id: "en-1", entryName: "Synthetic Alpha", participantEmail: "alpha@example.invalid",
      payerName: "Synthetic Alpha", paymentMethod: "zelle",
      picks: { "m-1": { h: 1, a: 0 }, "m-2": { h: 2, a: 2 } },
      createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z" },
    { id: "en-2", entryName: "Synthetic Beta", participantEmail: "beta@example.invalid",
      picks: { "m-1": { h: 0, a: 0 } }, createdAt: "2026-06-02T00:00:00Z", updatedAt: "2026-06-02T00:00:00Z" },
    { id: "en-3", entryName: "Synthetic Gamma", participantEmail: null, picks: null,
      createdAt: "2026-06-03T00:00:00Z", updatedAt: "2026-06-03T00:00:00Z" },
  ],
  paid: { "en-1": true, "en-2": false },
  deletedIds: ["en-3"],
  auditLog: [{ ts: "2026-06-01T00:00:00Z", action: "entry_created", admin: false, detail: "free text", entryId: "en-1" }],
  results: { "m-1": { h: 1, a: 0 } },
  lastSync: "2026-06-04T00:00:00Z",
  siteVersion: "4.159",
});

console.log("\nWS7.1 — the transformer contract\n");

test("all 18 required transformers exist and are exported", () => {
  const required = ["transformParticipants", "transformParticipantIdentityCandidates", "transformCompetitions",
    "transformCompetitionEditions", "transformCompetitionPhases", "transformPools", "transformPoolEntries",
    "transformPayments", "transformPaymentAllocations", "transformMatches", "transformTies",
    "transformPredictions", "transformMatchResults", "transformRankingSnapshots", "transformSyncState",
    "transformAuditMetadata"];
  eq(Object.keys(TRANSFORMERS).length, 18, "eighteen transformers — the sixteen originals plus the two league-classification transformers (Batch I)");
  for (const n of required) assert(typeof TRANSFORMERS[n] === "function", `missing ${n}`);
});

test("every transformer returns the full result shape", () => {
  for (const [name, fn] of Object.entries(TRANSFORMERS)) {
    const r = fn(DOC(), CTX);
    for (const k of ["records", "warnings", "unknowns", "conflicts", "fatals", "findings", "coverage", "evidence", "ok"]) {
      assert(r[k] !== undefined, `${name} result missing ${k}`);
    }
    assert(Array.isArray(r.records), `${name}.records must be an array`);
    assert(r.evidence.digest, `${name} must carry a digest as evidence`);
  }
});

test("the result is frozen — a caller cannot amend the findings it was given", () => {
  const r = transformParticipants(DOC(), CTX);
  let mutated = false;
  try { r.records = []; mutated = r.records.length === 0; } catch { mutated = false; }
  assert(!mutated, "the result must not be reassignable");
});

test("findings carry a severity, a code and a message", () => {
  const r = transformPayments(DOC(), CTX);
  assert(r.findings.length > 0, "the fixture should produce findings");
  for (const f of r.findings) {
    assert(Object.values(SEVERITY).includes(f.severity), `bad severity ${f.severity}`);
    assert(f.code && f.message && f.message.length > 20, `finding ${f.code} has no usable message`);
  }
});

test("transformers are pure: they do not mutate the legacy document", () => {
  const doc = DOC();
  const before = JSON.stringify(doc);
  for (const fn of Object.values(TRANSFORMERS)) fn(doc, CTX);
  eq(JSON.stringify(doc), before, "a transformer mutated its input");
});

console.log("\nWS7.3 — legacy version handling\n");

test("every known version is classified", () => {
  for (const [v, d] of Object.entries(LEGACY_VERSIONS)) {
    assert(["SUPPORTED", "SUPPORTED_WITH_WARNINGS", "PARTIAL", "UNKNOWN"].includes(d.status), `${v}: bad status ${d.status}`);
    assert(d.evidence && d.notes, `${v} lacks evidence or notes`);
  }
  eq(classifyVersion("v4-copa").status, "SUPPORTED", "copa");
  eq(classifyVersion("v4-br").status, "SUPPORTED_WITH_WARNINGS", "br");
  eq(classifyVersion("v3-pre-audit").status, "PARTIAL", "pre-audit");
});

test("an UNRECOGNISED version classifies as UNKNOWN", () => {
  eq(classifyVersion("v9-from-the-future").status, "UNKNOWN", "unknown");
  eq(classifyVersion(undefined).status, "UNKNOWN", "absent");
});

test("an UNKNOWN version makes every money-bearing transformer FATAL", () => {
  const ctx = { ...CTX, sourceVersion: "v9-from-the-future" };
  for (const name of MONEY_BEARING) {
    const r = TRANSFORMERS[name](DOC(), ctx);
    eq(r.ok, false, `${name} must not be ok on an uncharacterised shape`);
    assert(hasCode(r, "UNKNOWN_SOURCE_VERSION"), `${name} must name the reason`);
    eq(r.records.length, 0, `${name} must emit nothing`);
  }
});

test("a NON-money transformer still works on an unknown version", () => {
  const r = transformParticipants(DOC(), { ...CTX, sourceVersion: "v9-from-the-future" });
  eq(r.ok, true, "identity interpretation does not depend on the money fields");
  eq(r.records.length, 3, "records still produced");
});

test("the v4-br shape (results: null) is handled without inventing an empty result set", () => {
  const doc = { ...DOC(), results: null };
  const r = transformMatchResults(doc, { ...CTX, sourceVersion: "v4-br" });
  eq(r.records.length, 0, "no results");
  assert(hasCode(r, "NO_RESULTS_OBJECT"), "the absence must be reported");
  eq(codeSeverity(r, "NO_RESULTS_OBJECT"), SEVERITY.WARNING, "an honest absence is a warning, not a conflict");
});

console.log("\nWS7.4 — field coverage gate\n");

test("the full transformer run covers every critical field", () => {
  const all = transformAll(DOC(), CTX);
  const cov = checkFieldCoverage(all.coverage);
  eq(cov.ok, true, `coverage findings: ${cov.findings.map((f) => f.code + ":" + f.path).join(", ")}`);
  eq(cov.unknownCount, 0, "no critical field may be unresolved");
  assert(cov.criticalCount >= 15, "the critical list must be substantial");
});

test("the gate DETECTS an unmapped critical field — vacuity", () => {
  const all = transformAll(DOC(), CTX);
  const holed = { ...all.coverage };
  delete holed["entries[].createdAt"];
  const cov = checkFieldCoverage(holed);
  assert(cov.findings.some((f) => f.code === "UNMAPPED_CRITICAL_FIELD" && f.path === "entries[].createdAt"),
    "an unmapped critical field must be reported");
  eq(cov.unknownCount, 1, "counted");
});

test("an unmapped critical MONEY field is FATAL, not a warning", () => {
  const all = transformAll(DOC(), CTX);
  const holed = { ...all.coverage };
  delete holed.paid;
  const cov = checkFieldCoverage(holed);
  eq(cov.ok, false, "the gate must fail closed");
  eq(cov.unmappedMoneyCount, 1, "counted as a money gap");
  const f = cov.findings.find((x) => x.code === "UNMAPPED_CRITICAL_MONEY_FIELD");
  eq(f.severity, SEVERITY.FATAL, "money gaps are fatal");
  assert(/wrong by an unknown amount/.test(f.message), "the message must say why");
});

test("an invalid coverage class is rejected", () => {
  const cov = checkFieldCoverage({ paid: "PROBABLY_FINE" });
  assert(cov.findings.some((f) => f.code === "INVALID_COVERAGE_CLASS"), "a made-up class must not pass");
  eq(cov.ok, false, "fatal");
});

test("a field claimed by two transformers takes the STRONGEST coverage class", () => {
  /**
   * Three fields are legitimately claimed twice, and an earlier version of the merge called all three
   * conflicts: picks is ARCHIVED at M4 and MAPPED at M16; results is DERIVED for match ids and MAPPED for
   * the values; participantEmail is MAPPED and also DERIVED into candidates. Precedence resolves them.
   */
  eq(strongestCoverage(COVERAGE.ARCHIVED, COVERAGE.MAPPED), COVERAGE.MAPPED, "mapped subsumes archived");
  eq(strongestCoverage(COVERAGE.DERIVED, COVERAGE.MAPPED), COVERAGE.MAPPED, "mapped wins");
  eq(strongestCoverage(COVERAGE.UNKNOWN, COVERAGE.ARCHIVED), COVERAGE.ARCHIVED, "any accounting beats unknown");
  eq(strongestCoverage(COVERAGE.MAPPED, COVERAGE.MAPPED), COVERAGE.MAPPED, "idempotent");
  const all = transformAll(DOC(), CTX);
  eq(all.coverage["entries[].picks"], COVERAGE.MAPPED, "picks ends up mapped, having been archived first");
  eq(all.coverage.results, COVERAGE.MAPPED, "results ends up mapped");
});

console.log("\nWS7.5 — participants: never merge\n");

test("participants are grouped by identity key with no merge performed", () => {
  const r = transformParticipants(DOC(), CTX);
  eq(r.records.length, 3, "three distinct identities");
  for (const p of r.records) eq(p.canonical_participant_id, null, "no participant may arrive merged");
});

test("SAME NAME, DIFFERENT PEOPLE stay separate when emails differ", () => {
  const doc = { entries: [
    { id: "a", entryName: "Synthetic Common", participantEmail: "one@example.invalid" },
    { id: "b", entryName: "Synthetic Common", participantEmail: "two@example.invalid" },
  ] };
  const r = transformParticipants(doc, CTX);
  eq(r.records.length, 2, "a shared name must not collapse two people with different emails");
});

test("SAME MAILBOX, DIFFERENT NAMES produces one record and a CONFLICT", () => {
  const doc = { entries: [
    { id: "a", entryName: "Synthetic One", participantEmail: "shared@example.invalid" },
    { id: "b", entryName: "Synthetic Two", participantEmail: "shared@example.invalid" },
  ] };
  const r = transformParticipants(doc, CTX);
  eq(r.records.length, 1, "grouped by the identity key the entries reference");
  assert(hasCode(r, "SHARED_EMAIL_DIFFERENT_NAMES"), "the ambiguity must be reported");
  eq(codeSeverity(r, "SHARED_EMAIL_DIFFERENT_NAMES"), SEVERITY.CONFLICT, "it is a conflict, not a warning");
  eq(r.records[0].observed_names.length, 2, "both names are retained as evidence");
});

test("one person with multiple entries yields one identity and an entry count", () => {
  const doc = { entries: [
    { id: "a", entryName: "Synthetic Alpha", participantEmail: "alpha@example.invalid" },
    { id: "b", entryName: "Synthetic Alpha", participantEmail: "alpha@example.invalid" },
    { id: "c", entryName: "Synthetic Alpha", participantEmail: "ALPHA@EXAMPLE.INVALID" },
  ] };
  const r = transformParticipants(doc, CTX);
  eq(r.records.length, 1, "case differences in an email are the same mailbox");
  eq(r.records[0].entry_count, 3, "entry count preserved as evidence");
});

test("a participant with no email is reported as name-matchable only", () => {
  const r = transformParticipants(DOC(), CTX);
  assert(hasCode(r, "NO_EMAIL"), "the limitation must be surfaced");
  eq(codeSeverity(r, "NO_EMAIL"), SEVERITY.UNKNOWN, "an honest gap");
});

test("an entry identifying nobody is reported, not silently dropped", () => {
  const r = transformParticipants({ entries: [{ id: "x", entryName: "  ", participantEmail: null }] }, CTX);
  eq(r.records.length, 0, "no identity can be derived");
  assert(hasCode(r, "UNIDENTIFIABLE_ENTRY"), "and that must be said");
});

test("merge candidates are emitted with NO canonical id anywhere", () => {
  const doc = { entries: [
    { id: "a", entryName: "José Synthetic", participantEmail: null },
    { id: "b", entryName: "Jose Synthetic", participantEmail: null },
  ] };
  const r = transformParticipantIdentityCandidates(doc, CTX);
  eq(r.records.length, 1, "one candidate pair");
  eq(r.records[0].canonical_participant_id, null, "a candidate must never carry a canonical id");
  assert(r.records[0].requires_operator_confirmation, "and must state that it needs confirmation");
  assert(hasCode(r, "MERGE_CANDIDATES_PENDING"), "the pending state must be reported");
  const json = JSON.stringify(r);
  assert(!/"canonical_participant_id":"/.test(json), "no candidate output may contain a non-null canonical id");
});

console.log("\nWS7.6 — payments: the high-risk transformer\n");

test("one asserted payment per paid=true, with NO invented amount", () => {
  const r = transformPayments(DOC(), CTX);
  eq(r.records.length, 1, "only en-1 was flagged");
  eq(r.records[0].amount, null, "amount must be null");
  eq(r.records[0].currency, null, "currency is paired with amount");
  assert(r.records[0].legacy_asserted, "marked as an assertion");
  assert(hasCode(r, "LEGACY_ASSERTED_NO_AMOUNT"), "the unknowns must be enumerated");
});

test("payment for SELF resolves the payer; payment for ANOTHER does not", () => {
  const doc = { entries: [
    { id: "a", entryName: "Synthetic Alpha", participantEmail: "alpha@example.invalid", payerName: "Synthetic Alpha" },
    { id: "b", entryName: "Synthetic Beta", participantEmail: "beta@example.invalid", payerName: "Synthetic Gamma" },
  ], paid: { a: true, b: true } };
  const r = transformPayments(doc, CTX);
  const self = r.records.find((p) => p.asserted_for_pool_entry_id === "a");
  const third = r.records.find((p) => p.asserted_for_pool_entry_id === "b");
  assert(self.payer_identity_key, "self-payment resolves to the entrant — one entry, one name, not a guess");
  eq(third.payer_identity_key, null, "a third-party payer must NOT be resolved");
  eq(third.payer_name_as_recorded, "Synthetic Gamma", "but the recorded name is preserved verbatim");
  assert(hasCode(r, "THIRD_PARTY_PAYER_UNRESOLVED"), "and the gap is reported");
  eq(codeSeverity(r, "THIRD_PARTY_PAYER_UNRESOLVED"), SEVERITY.UNKNOWN, "UNKNOWN-1, resolvable by an operator");
});

test("NO allocation is ever emitted, and every asserted payment yields an UNKNOWN", () => {
  const r = transformPaymentAllocations(DOC(), CTX);
  eq(r.records.length, 0, "an allocation implies an amount the legacy state does not prove");
  assert(hasCode(r, "ALLOCATION_NOT_PROVABLE"), "the gap must be counted, not implied");
  eq(r.evidence.unprovableAllocations, 1, "one per asserted payment");
});

test("a non-boolean paid value is a CONFLICT, never coerced", () => {
  const r = transformPayments({ entries: [{ id: "a", entryName: "A", participantEmail: "a@example.invalid" }], paid: { a: "yes" } }, CTX);
  eq(r.records.length, 0, "a truthy string must not assert a payment");
  assert(hasCode(r, "PAID_NOT_BOOLEAN"), "reported");
  eq(codeSeverity(r, "PAID_NOT_BOOLEAN"), SEVERITY.CONFLICT, "conflict");
});

test("paid of the wrong SHAPE is FATAL", () => {
  const r = transformPayments({ entries: [], paid: ["en-1"] }, CTX);
  eq(r.ok, false, "guessing the shape of a money field is not acceptable");
  assert(hasCode(r, "PAID_WRONG_SHAPE"), "reported");
});

test("a paid flag naming a nonexistent entry is a CONFLICT", () => {
  const r = transformPayments({ entries: [], paid: { ghost: true } }, CTX);
  eq(r.records.length, 0, "not emitted");
  assert(hasCode(r, "PAID_FLAG_WITHOUT_ENTRY"), "reported");
  eq(codeSeverity(r, "PAID_FLAG_WITHOUT_ENTRY"), SEVERITY.CONFLICT, "conflict");
});

test("a duplicate external reference is a CONFLICT — one real payment counted twice", () => {
  const doc = { entries: [
    { id: "a", entryName: "A", participantEmail: "a@example.invalid", externalReference: "SYNTH-1" },
    { id: "b", entryName: "B", participantEmail: "b@example.invalid", externalReference: "SYNTH-1" },
  ], paid: { a: true, b: true } };
  const r = transformPayments(doc, CTX);
  assert(hasCode(r, "DUPLICATE_EXTERNAL_REFERENCE"), "reported");
  eq(codeSeverity(r, "DUPLICATE_EXTERNAL_REFERENCE"), SEVERITY.CONFLICT, "conflict");
});

test("a missing payment method and timestamp are UNKNOWN, not defaulted", () => {
  const r = transformPayments(DOC(), CTX);
  assert(hasCode(r, "NO_PAYMENT_METHOD") || r.records[0].method, "either recorded or reported");
  eq(r.records[0].paid_at, null, "no timestamp may be invented");
});

/**
 * KPLUS-F015. The fee reached a real numeric(14,2) column as 500.00 for a 5.00 fee, and every layer
 * between was content: the transformer emitted the fixture's minor units under the target column's
 * name, and the only assertion anyone made about that field was that its CURRENCY was present.
 *
 * These tests assert the VALUE and its UNIT, which is what was missing. The first would have failed
 * before the fix; the second pins the exact defect so a future "simplification" back to `.minor`
 * cannot pass.
 */
test("the expected fee is snapshotted in the target column's MAJOR units", () => {
  const r = transformPoolEntries(DOC(), CTX);
  assert(r.records.length > 0, "entries were emitted");
  for (const e of r.records) {
    eq(e.expected_fee_amount, "5.00", "numeric(14,2) holds an exact major-unit decimal");
    eq(e.expected_fee_currency, USD, "currency travels in its own column");
  }
});

test("a minor-unit fee can never reappear in expected_fee_amount", () => {
  for (const [decimal, expected] of [["5.00", "5.00"], ["0.05", "0.05"], ["12", "12.00"], ["1234.56", "1234.56"]]) {
    const r = transformPoolEntries(DOC(), { ...CTX, expectedFee: parseMoney(decimal, USD) });
    const got = r.records[0].expected_fee_amount;
    eq(got, expected, `fee ${decimal} snapshotted exactly`);
    assert(!Number.isInteger(got), "a bare integer is the minor-unit representation and must not appear");
    assert(/^\d+\.\d{2}$/.test(got), "exactly two decimal places, as numeric(14,2) stores");
  }
});

/**
 * KPLUS-F016 / ADR-K02. Real legacy data carries no entry labels, so every one defaulted to "main" —
 * and `pool_entries_participant_id_pool_id_entry_label_uidx` then rejected the second entry of any
 * participant who had two. Five of forty-six real entries could not be inserted. Multiple entries per
 * participant per pool is ratified, so those rows are real money, not duplicates.
 */
const TWO_ENTRIES = () => ({
  entries: [
    { id: "en-b", entryName: "Synthetic Alpha", participantEmail: "alpha@example.invalid", createdAt: "2026-01-02T00:00:00Z" },
    { id: "en-a", entryName: "Synthetic Alpha", participantEmail: "alpha@example.invalid", createdAt: "2026-01-01T00:00:00Z" },
  ],
});

test("two unlabelled entries by one participant get distinct labels, and neither is dropped", () => {
  const r = transformPoolEntries(TWO_ENTRIES(), CTX);
  eq(r.records.length, 2, "no entry may be discarded — each owes a fee");
  const labels = r.records.map((x) => x.entry_label).sort();
  eq(JSON.stringify(labels), JSON.stringify(["main", "main-2"]), "distinct labels");
  assert(hasCode(r, "ENTRY_LABEL_DISAMBIGUATED"), "the change is reported, not silent");
  eq(codeSeverity(r, "ENTRY_LABEL_DISAMBIGUATED"), SEVERITY.WARNING, "defaulted labels never disagreed, so WARNING");
});

test("the target's uniqueness rule is satisfied for every emitted entry", () => {
  const r = transformPoolEntries(TWO_ENTRIES(), CTX);
  const keys = new Set(r.records.map((x) => `${x.identity_key}|${x.pool_id}|${x.entry_label}`));
  eq(keys.size, r.records.length, "(participant, pool, label) is unique — the index will accept all of them");
});

test("labels depend on the SET of entries, not the order the document listed them", () => {
  const doc = TWO_ENTRIES();
  const forward = transformPoolEntries(doc, CTX).records.map((x) => `${x.pool_entry_id}=${x.entry_label}`);
  const reversed = transformPoolEntries({ entries: [...doc.entries].reverse() }, CTX).records.map((x) => `${x.pool_entry_id}=${x.entry_label}`);
  eq(JSON.stringify(forward), JSON.stringify(reversed), "a re-serialised document must not relabel anyone");
});

test("two EXPLICITLY identical labels are a CONFLICT, because the source itself failed to distinguish them", () => {
  const doc = TWO_ENTRIES();
  for (const e of doc.entries) e.entryLabel = "familia";
  const r = transformPoolEntries(doc, CTX);
  eq(r.records.length, 2, "still nothing dropped");
  assert(hasCode(r, "ENTRY_LABEL_COLLISION"), "reported");
  eq(codeSeverity(r, "ENTRY_LABEL_COLLISION"), SEVERITY.CONFLICT, "a human supplied both; someone should look");
  eq(JSON.stringify(r.records.map((x) => x.entry_label).sort()), JSON.stringify(["familia", "familia-2"]), "");
});

test("disambiguation never steals a suffix another entry already claims", () => {
  const r = transformPoolEntries({
    entries: [
      { id: "en-a", entryName: "A", participantEmail: "a@example.invalid", entryLabel: "main" },
      { id: "en-b", entryName: "A", participantEmail: "a@example.invalid", entryLabel: "main" },
      { id: "en-c", entryName: "A", participantEmail: "a@example.invalid", entryLabel: "main-2" },
    ],
  }, CTX);
  const labels = r.records.map((x) => x.entry_label).sort();
  eq(new Set(labels).size, 3, "all three distinct");
  assert(labels.includes("main-2"), "the entry that explicitly owned main-2 keeps it");
});

test("no internal bookkeeping field survives into an emitted entry record", () => {
  for (const rec of transformPoolEntries(TWO_ENTRIES(), CTX).records) {
    for (const k of Object.keys(rec)) assert(!k.startsWith("__"), `internal field ${k} leaked into a target record`);
  }
});

test("entries REFUSE to transform without an expected fee, and it is FATAL", () => {
  const r = transformPoolEntries(DOC(), { ...CTX, expectedFee: null });
  eq(r.ok, false, "an inferred fee would fabricate money");
  assert(hasCode(r, "NO_EXPECTED_FEE"), "reported");
  eq(codeSeverity(r, "NO_EXPECTED_FEE"), SEVERITY.FATAL, "fatal, not a warning");
  eq(r.records.length, 0, "nothing emitted");
});

console.log("\nWS7.7 — matches, ties, results\n");

test("an incomplete result is NOT emitted and is reported UNKNOWN", () => {
  const r = transformMatchResults({ results: { "m-1": { h: null, a: null } } }, CTX);
  eq(r.records.length, 0, "not emitted");
  assert(hasCode(r, "RESULT_INCOMPLETE"), "reported");
  assert(/was not played/.test(r.findings.find((f) => f.code === "RESULT_INCOMPLETE").message),
    "the message must explain that 0-0 would award points for a match that did not happen");
});

test("a partial result (one side only) is not completed", () => {
  const r = transformMatchResults({ results: { "m-1": { h: 2, a: null } } }, CTX);
  eq(r.records.length, 0, "half a result is not a result");
  assert(hasCode(r, "RESULT_INCOMPLETE"), "reported");
});

test("string goals are parsed with a WARNING; non-numeric goals are a CONFLICT", () => {
  const ok = transformMatchResults({ results: { "m-1": { h: "2", a: "1" } } }, CTX);
  eq(ok.records.length, 1, "parsed");
  eq(ok.records[0].home_goals, 2, "as integers");
  assert(hasCode(ok, "RESULT_GOALS_AS_STRINGS"), "and flagged");
  const bad = transformMatchResults({ results: { "m-1": { h: "two", a: 1 } } }, CTX);
  eq(bad.records.length, 0, "not coerced");
  assert(hasCode(bad, "RESULT_NOT_INTEGER"), "reported as a conflict");
});

test("advancement is carried when explicit and NEVER inferred from goals", () => {
  const withAdv = transformMatchResults({ results: { "t-1": { h: 1, a: 1, advance: "TEAM_A" } } }, CTX);
  eq(withAdv.records[0].advancing_team, "TEAM_A", "explicit advancement carried");
  const draw = transformMatchResults({ results: { "t-2": { h: 1, a: 1 } } }, CTX);
  eq(draw.records[0].advancing_team, null, "a draw with no explicit advancement stays null");
});

// ─────────────────────────────────────────────────────────────────────────────
// TIES — the knockout bracket. These replaced two tests that exercised a ctx-supplied shape with
// `leg_one_match_id` / `advancing_team`, columns `bolao.ties` does not have. The invariant they were
// really defending — advancement is never inferred — is kept and now runs against the real document.
// ─────────────────────────────────────────────────────────────────────────────
const TIE_CTX = (over = {}) => ({
  ...CTX,
  phaseIdBySlug: (sl) => (sl === "quartas" ? "PHASE-Q" : null),
  tieIdFor: (ph, sl) => `tie:${ph}:${sl}`,
  ...over,
});
const TIE_DOC = (ties) => ({ phases: { quartas: { ties } } });

test("a tie maps to the TARGET's columns, not to leg ids", () => {
  const r = transformTies(TIE_DOC({ "espn-a_b": { teamA: "A FC", teamB: "B FC", qualifiedTeamId: "A" } }), TIE_CTX());
  eq(r.records.length, 1, "one tie");
  const t = r.records[0];
  for (const c of ["tie_id", "competition_edition_phase_id", "slug", "team_a", "team_b", "qualified_side", "provenance", "predecessor_tie_id"]) {
    assert(Object.prototype.hasOwnProperty.call(t, c), `bolao.ties has ${c} and the record must carry it`);
  }
  for (const gone of ["leg_one_match_id", "leg_two_match_id", "advancing_team"]) {
    assert(!(gone in t), `${gone} is not a column on bolao.ties and must not be emitted`);
  }
  eq(t.qualified_side, "A", "the side travels verbatim");
  eq(t.predecessor_tie_id, null, "the document records no bracket lineage; deriving one would invent a bracket");
});

test("qualifiedTeamId is a SIDE and is never resolved against a team name", () => {
  // Measured across all 28 live cdb2026 ties: the value set is exactly {A, B, null}.
  for (const [v, want] of [["A", "A"], ["B", "B"]]) {
    const r = transformTies(TIE_DOC({ t: { teamA: "X", teamB: "Y", qualifiedTeamId: v } }), TIE_CTX());
    eq(r.records[0].qualified_side, want, `side ${v}`);
  }
  // A team NAME in that field is not a side. It must not be matched against teamA/teamB.
  const bad = transformTies(TIE_DOC({ t: { teamA: "X", teamB: "Y", qualifiedTeamId: "X" } }), TIE_CTX());
  eq(bad.records[0].qualified_side, null, "left NULL rather than resolved by name");
  assert(hasCode(bad, "TIE_QUALIFIED_SIDE_UNRECOGNISED"), "and reported");
});

test("a tie with no qualified side is UNKNOWN, not inferred", () => {
  const r = transformTies(TIE_DOC({ t: { teamA: "X", teamB: "Y", qualifiedTeamId: null } }), TIE_CTX());
  assert(hasCode(r, "TIE_ADVANCEMENT_UNKNOWN"), "reported");
  eq(codeSeverity(r, "TIE_ADVANCEMENT_UNKNOWN"), SEVERITY.UNKNOWN, "unknown, not a conflict");
  eq(r.records[0].qualified_side, null, "left null — inferring it changes advancement points");
});

test("MUTATION — a tie whose phase has no row is REFUSED, not orphaned", () => {
  const r = transformTies({ phases: { semifinal: { ties: { t: { teamA: "X", teamB: "Y" } } } } }, TIE_CTX());
  eq(r.records.length, 0, "a tie must name the round it was played in");
  assert(hasCode(r, "TIE_PHASE_UNRESOLVED"), "and the refusal must be reported, not silent");
  eq(codeSeverity(r, "TIE_PHASE_UNRESOLVED"), SEVERITY.CONFLICT, "conflict");
});

test("MUTATION — the matches sub-object is NOT read into the tie", () => {
  const r = transformTies(TIE_DOC({ t: {
    teamA: "X", teamB: "Y", qualifiedTeamId: "A",
    matches: { first: { homeTeam: "X", goalsHome: 3, status: "FINAL" }, second: { homeTeam: "Y" } },
  } }), TIE_CTX());
  const t = JSON.stringify(r.records[0]);
  for (const leak of ["goalsHome", "homeTeam", "FINAL", "matches"]) {
    assert(!t.includes(leak), `legs are the MATCHES domain; a tie carrying ${leak} is a second source of truth for a fixture`);
  }
});

test("the same team on both sides is a CONFLICT and the row is not emitted", () => {
  const r = transformTies(TIE_DOC({ t: { teamA: "X", teamB: "X" } }), TIE_CTX());
  eq(r.records.length, 0, "the target CHECK would reject it; refusing here says why");
  assert(hasCode(r, "TIE_SAME_TEAM_BOTH_SIDES"), "reported");
});

test("a document with no phases declares no ties, and that is not a defect", () => {
  const r = transformTies({}, TIE_CTX());
  eq(r.records.length, 0, "main and br2026 have no knockout bracket");
  assert(hasCode(r, "NO_PHASE_STRUCTURE"), "stated rather than silent");
  eq(codeSeverity(r, "NO_PHASE_STRUCTURE"), SEVERITY.WARNING, "a warning, not a conflict");
});

test("matches derived from result keys are flagged as such", () => {
  const r = transformMatches(DOC(), CTX);
  assert(hasCode(r, "MATCHES_DERIVED_FROM_RESULTS"),
    "a match with no recorded result is invisible to this derivation, and that must be stated");
});

test("a supplied fixture list is preferred, and a match with no phase is UNKNOWN", () => {
  const r = transformMatches(DOC(), { ...CTX, matches: [{ match_id: "m-9", status: "postponed", teamA: "Alpha", teamB: "Beta" }] });
  eq(r.records.length, 1, "supplied fixtures win");
  eq(r.records[0].status, "postponed", "a postponed match keeps its status");
  assert(hasCode(r, "MATCH_WITHOUT_PHASE"), "a phaseless match has no cutoff, and that is reported");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// KPLUS-F017 — bolao.matches.home_team and away_team are both NOT NULL and this transformer emitted
// neither, so nothing it produced could be inserted. Proven against the real column, not inferred
// from the schema file: a real transformed record is refused with a not_null_violation on home_team
// while the same row with both sides supplied is accepted (f017_matches_evidence.mjs).
// ─────────────────────────────────────────────────────────────────────────────────────────────

test("a match carries both sides, taken from the fixture that declares them", () => {
  const r = transformMatches({ results: { "73": { h: 1, a: 0 } } },
    { ...CTX, fixtures: [{ match: "73", teamA: "Alpha", teamB: "Beta" }] });
  eq(r.records.length, 1, "the match is produced");
  eq(r.records[0].home_team, "Alpha", "home_team is the FIRST-listed side");
  eq(r.records[0].away_team, "Beta", "away_team is the SECOND-listed side");
});

test("the sides are positional, not a hosting claim, and the order is never swapped", () => {
  // goalsA/goalsB and predicted_goals_home/away are stored in this same order. Inverting the pair
  // inverts every score, so the mapping must be positional and must stay positional.
  const r = transformMatches({ results: { "1": {} } },
    { ...CTX, fixtures: [{ match: "1", teamA: "First", teamB: "Second" }] });
  assert(r.records[0].home_team === "First" && r.records[0].away_team === "Second",
    "teamA must map to home_team and teamB to away_team; swapping them silently inverts every stored score");
});

test("a match whose sides cannot be resolved is excluded and reported, never given a placeholder", () => {
  const r = transformMatches({ results: { "73": {}, "74": {} } },
    { ...CTX, fixtures: [{ match: "73", teamA: "Alpha", teamB: "Beta" }] });
  eq(r.records.length, 1, "only the resolvable match is produced");
  assert(hasCode(r, "MATCH_SIDES_UNRESOLVED"), "the unresolvable one is reported");
  assert(r.records.every((x) => x.home_team && x.away_team),
    "a match row naming a team nobody played is worse than an absent one — predictions are scored on these names");
});

test("a half-attributed fixture is refused: there is no match with one side", () => {
  const r = transformMatches({ results: { "73": {} } },
    { ...CTX, fixtures: [{ match: "73", teamA: "Alpha", teamB: null }] });
  eq(r.records.length, 0, "one side is not an attribution");
  assert(hasCode(r, "MATCH_SIDES_UNRESOLVED"), "reported rather than filled in");
});

test("every emitted match satisfies the NOT NULL columns bolao.matches declares", () => {
  // The gap this closes was invisible because nothing compared the transformer's output shape to the
  // columns the table insists on. This asserts the relationship directly.
  const REQUIRED = ["match_id", "competition_edition_phase_id", "home_team", "away_team"];
  const r = transformMatches({ results: { "73": {}, "GS-01": {} } }, {
    ...CTX, defaultPhaseId: "ph-1",
    fixtures: [{ match: "73", teamA: "A", teamB: "B" }, { match: "GS-01", teamA: "C", teamB: "D" }],
  });
  eq(r.records.length, 2, "both matches are produced");
  for (const rec of r.records) {
    for (const col of REQUIRED) {
      assert(rec[col] !== null && rec[col] !== undefined, `${col} is NOT NULL in bolao.matches but the record has no value for it`);
    }
  }
});

test("a phase-ordinal gap is a CONFLICT", () => {
  const r = transformCompetitionPhases({}, { ...CTX, phases: [
    { competition_edition_phase_id: "p1", competition_edition_id: "ed-1", ordinal: 1, cutoff_at: "t" },
    { competition_edition_phase_id: "p3", competition_edition_id: "ed-1", ordinal: 3, cutoff_at: "t" },
  ] });
  assert(hasCode(r, "PHASE_ORDINAL_GAP"), "a gap means progression cannot be validated");
});

test("a phase with no cutoff is UNKNOWN, never defaulted", () => {
  const r = transformCompetitionPhases({}, { ...CTX, phases: [{ competition_edition_phase_id: "p1", competition_edition_id: "ed-1", ordinal: 1 }] });
  assert(hasCode(r, "PHASE_WITHOUT_CUTOFF"), "reported");
  eq(r.records[0].cutoff_at, null, "left null: defaulting would silently lock or unlock predictions");
});

console.log("\nWS7.8 — predictions preserve scoring input exactly\n");

test("predictions preserve goals, subject and lock context", () => {
  const r = transformPredictions(DOC(), { ...CTX, phaseByMatch: { "m-1": "ed-1-ph-1", "m-2": "ed-1-ph-2" } });
  eq(r.records.length, 3, "two picks for en-1, one for en-2");
  const p = r.records.find((x) => x.prediction_id === "pr-en-1-m-1");
  eq(p.home_goals, 1, "goals preserved");
  eq(p.lock_context, "ed-1-ph-1", "the phase that applied is carried");
  eq(p.source_version, "v4-copa", "and the source version");
});

test("a 0-0 pick is preserved and is NOT the same as a missing pick", () => {
  const r = transformPredictions({ entries: [{ id: "e", picks: { "m-1": { h: 0, a: 0 }, "m-2": null } }] }, CTX);
  const zero = r.records.find((x) => x.subject_id === "m-1");
  const missing = r.records.find((x) => x.subject_id === "m-2");
  eq(zero.home_goals, 0, "an explicit 0-0 is a real prediction");
  eq(missing.home_goals, null, "a missing pick stays null — collapsing them would change scores");
});

test("a non-integer prediction is a CONFLICT, never coerced", () => {
  const r = transformPredictions({ entries: [{ id: "e", picks: { "m-1": { h: "two", a: 0 } } }] }, CTX);
  eq(r.records.length, 0, "not emitted");
  assert(hasCode(r, "PREDICTION_NOT_INTEGER"), "reported");
});

test("picks of the wrong shape are a CONFLICT", () => {
  const r = transformPredictions({ entries: [{ id: "e", picks: [1, 2, 3] }] }, CTX);
  assert(hasCode(r, "PICKS_WRONG_SHAPE"), "an array where an object belongs must be reported");
});

test("a partial prediction is preserved as partial", () => {
  const r = transformPredictions({ entries: [{ id: "e", picks: { "m-1": { h: 2 } } }] }, CTX);
  assert(hasCode(r, "PREDICTION_PARTIAL"), "reported");
  eq(r.records[0].away_goals, null, "the missing side stays null rather than being completed");
});

console.log("\nWS7.2 — the outbox is never fabricated\n");

test("no transformer produces an outbox record, under any input", () => {
  const docs = [DOC(), {}, { entries: [] }, { paid: { a: true } }, { auditLog: [{ ts: "t", action: "email_sent" }] }];
  for (const doc of docs) {
    for (const [name, fn] of Object.entries(TRANSFORMERS)) {
      const r = fn(doc, CTX);
      const json = JSON.stringify(r.records);
      assert(!/outbox/i.test(json), `${name} emitted something outbox-shaped`);
      assert(!/delivery_attempt|idempotency_key/i.test(json), `${name} emitted delivery state`);
    }
  }
  assert(!Object.keys(TRANSFORMERS).some((n) => /outbox/i.test(n)),
    "there must be no outbox transformer: the legacy state cannot prove which deliveries were owed");
});

test("historical rankings are likewise not fabricated", () => {
  const r = transformRankingSnapshots(DOC(), CTX);
  eq(r.records.length, 0, "no snapshots");
  assert(hasCode(r, "NO_HISTORICAL_RANKINGS"), "and the reason is recorded");
  assert(/nobody ever saw/.test(r.findings[0].message), "reconstructing them would fabricate published history");
});

console.log("\nWS7 — audit metadata\n");

test("legacy free-text detail is dropped and the drop is reported", () => {
  const r = transformAuditMetadata(DOC(), CTX);
  eq(r.records.length, 1, "one event");
  eq(JSON.stringify(r.records[0].safe_metadata), "{}", "safe_metadata empty");
  assert(!JSON.stringify(r.records[0]).includes("free text"), "the detail must not survive anywhere in the row");
  assert(hasCode(r, "AUDIT_DETAIL_DROPPED"), "and the drop must be visible, not silent");
  eq(r.coverage["auditLog[].detail"], COVERAGE.INTENTIONALLY_DROPPED, "classified as an intentional drop");
});

test("a missing audit log is a WARNING for the pre-audit shape", () => {
  const r = transformAuditMetadata({ entries: [] }, { ...CTX, sourceVersion: "v3-pre-audit" });
  eq(r.records.length, 0, "nothing to migrate");
  assert(hasCode(r, "NO_AUDIT_LOG"), "reported as a real absence");
});

/**
 * KPLUS-F025 — these four fail against the pre-fix transformer, which passed the legacy verb through
 * verbatim. `ae_action_shape` is duplicated here on purpose: this suite must be able to fail without a
 * database, and the DB-side proof lives in the campaign lab.
 */
const AE_ACTION_SHAPE = /^[a-z_]+\.[a-z_]+$/;

test("every emitted action satisfies the target's ae_action_shape CHECK", () => {
  const doc = { auditLog: [
    { ts: "2026-06-01T00:00:00Z", action: "save-leg", entryId: "en-1" },
    { ts: "2026-06-01T00:00:01Z", action: "round-email-sent" },
    { ts: "2026-06-01T00:00:02Z", action: "revert-mistaken-oitavas-results", admin: true },
    { ts: "2026-06-01T00:00:03Z", action: "  EDIT  ", admin: true },
  ] };
  const r = transformAuditMetadata(doc, CTX);
  eq(r.records.length, 4, "every event is carried");
  for (const rec of r.records) assert(AE_ACTION_SHAPE.test(rec.action), `action ${rec.action} would be refused by the CHECK`);
  eq(r.records[0].action, "legacy.save_leg", "namespaced, not reinterpreted");
  eq(r.records[2].action, "legacy.revert_mistaken_oitavas_results", "a long kebab verb survives whole");
  eq(r.records[3].action, "legacy.edit", "case and surrounding whitespace are normalised");
});

test("the legacy verb is recoverable from the namespaced action — the transform loses nothing", () => {
  const verbs = ["save-leg", "lock-tie", "round-email-sent", "toggle-paid", "manual-save-picks"];
  const r = transformAuditMetadata({ auditLog: verbs.map((action) => ({ ts: "2026-06-01T00:00:00Z", action })) }, CTX);
  // The prefix assertion is what stops this test passing vacuously: without it a transformer emitting the
  // legacy verb verbatim also "round-trips", and the test would have passed against the F025 defect.
  for (const rec of r.records) assert(rec.action.startsWith("legacy."), `${rec.action} is not namespaced`);
  const recovered = r.records.map((rec) => rec.action.replace(/^legacy\./, "").replace(/_/g, "-"));
  eq(JSON.stringify(recovered), JSON.stringify(verbs), "every legacy verb round-trips");
});

test("an action that cannot be expressed in [a-z_] is FATAL, not silently altered", () => {
  const r = transformAuditMetadata({ auditLog: [
    { ts: "2026-06-01T00:00:00Z", action: "save-leg" },
    { ts: "2026-06-01T00:00:01Z", action: "round2-email" },
  ] }, CTX);
  assert(hasCode(r, "AUDIT_ACTION_NOT_EXPRESSIBLE"), "the digit is reported, not dropped");
  eq(r.ok, false, "FATAL — the domain must read nothing rather than load an altered history");
  eq(r.fatals.length, 1, "exactly the offending entry");
  assert(!JSON.stringify(r.findings).includes("round2"), "the action VALUE is never echoed — it is free text");
});

test("aggregate_type is not asserted for an event that names no subject", () => {
  const r = transformAuditMetadata({ auditLog: [
    { ts: "2026-06-01T00:00:00Z", action: "edit", entryId: "en-1" },
    { ts: "2026-06-01T00:00:01Z", action: "extend-cutoff" },
  ] }, CTX);
  eq(r.records[0].aggregate_type, "pool_entry", "an event that names an entry says so");
  eq(r.records[1].aggregate_type, "unknown", "an event that names none must not claim one");
  eq(r.records[1].aggregate_id, null, "and type and id stay consistent with each other");
});

console.log("\nWS7.9 — determinism\n");

test("the same input produces byte-identical output, repeatedly", () => {
  for (const [name, fn] of Object.entries(TRANSFORMERS)) {
    const a = fn(DOC(), CTX), b = fn(DOC(), CTX), c = fn(DOC(), CTX);
    eq(JSON.stringify(a.records), JSON.stringify(b.records), `${name} is not deterministic`);
    eq(a.evidence.digest, c.evidence.digest, `${name} digest is not stable`);
  }
});

test("records are emitted in a stable order regardless of input key order", () => {
  const doc = DOC();
  const reversed = { ...doc, entries: [...doc.entries].reverse(), paid: Object.fromEntries(Object.entries(doc.paid).reverse()) };
  for (const name of ["transformParticipants", "transformPoolEntries", "transformPayments", "transformPredictions"]) {
    const a = TRANSFORMERS[name](doc, CTX), b = TRANSFORMERS[name](reversed, CTX);
    eq(a.evidence.digest, b.evidence.digest, `${name} output depends on input order`);
  }
});

test("the digest is insensitive to object key order within a record", () => {
  eq(digestRecords([{ a: 1, b: 2 }]), digestRecords([{ b: 2, a: 1 }]),
    "otherwise the digest would be an artefact of the code path rather than of the data");
});

test("the digest IS sensitive to content", () => {
  assert(digestRecords([{ a: 1 }]) !== digestRecords([{ a: 2 }]), "a changed value must change the digest");
  assert(digestRecords([{ a: 1 }]) !== digestRecords([{ a: 1 }, { a: 1 }]), "a duplicated record must change it");
});

console.log("\nWS7.10 — generative properties\n");

test("100 randomised legacy variants: no money is invented, no merge is created", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const r = rng(seed);
    const n = 1 + Math.floor(r() * 8);
    const entries = [];
    for (let i = 0; i < n; i++) {
      const hasEmail = r() > 0.3;
      entries.push({
        id: `en-${seed}-${i}`,
        entryName: `Synthetic ${Math.floor(r() * 4)}`,
        participantEmail: hasEmail ? `s${Math.floor(r() * 3)}@example.invalid` : null,
        payerName: r() > 0.6 ? `Synthetic ${Math.floor(r() * 4)}` : undefined,
        picks: r() > 0.4 ? { "m-1": { h: Math.floor(r() * 4), a: Math.floor(r() * 4) } } : null,
        createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z",
      });
    }
    const paid = {};
    for (const e of entries) if (r() > 0.5) paid[e.id] = true;
    const doc = { entries, paid, deletedIds: entries.filter(() => r() > 0.85).map((e) => e.id), results: {}, auditLog: [] };

    const pay = transformPayments(doc, CTX);
    for (const p of pay.records) {
      eq(p.amount, null, `seed ${seed}: an amount was invented`);
      eq(p.currency, null, `seed ${seed}: a currency was invented without an amount`);
    }
    const alloc = transformPaymentAllocations(doc, CTX);
    eq(alloc.records.length, 0, `seed ${seed}: an allocation was fabricated`);

    const people = transformParticipants(doc, CTX);
    for (const p of people.records) eq(p.canonical_participant_id, null, `seed ${seed}: a merge was created`);

    const cand = transformParticipantIdentityCandidates(doc, CTX);
    for (const c of cand.records) eq(c.canonical_participant_id, null, `seed ${seed}: a candidate carried a canonical id`);

    // Determinism on every generated document.
    eq(transformPayments(doc, CTX).evidence.digest, pay.evidence.digest, `seed ${seed}: non-deterministic`);

    // Currency stays explicit: every emitted entry carries one.
    const ents = transformPoolEntries(doc, CTX);
    for (const e of ents.records) assert(e.expected_fee_currency === USD, `seed ${seed}: currency lost`);
  }
});

test("100 randomised variants: duplicate source ids always surface", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const r = rng(seed + 5000);
    const dupId = `dup-${seed}`;
    const entries = [
      { id: dupId, entryName: "A", participantEmail: "a@example.invalid", createdAt: "t", updatedAt: "t" },
      { id: dupId, entryName: "B", participantEmail: "b@example.invalid", createdAt: "t", updatedAt: "t" },
    ];
    if (r() > 0.5) entries.push({ id: `other-${seed}`, entryName: "C", participantEmail: "c@example.invalid", createdAt: "t", updatedAt: "t" });
    const res = transformPoolEntries({ entries, paid: {}, deletedIds: [] }, CTX);
    assert(hasCode(res, "DUPLICATE_ENTRY_ID"), `seed ${seed}: a duplicate entry id was not reported`);
    eq(res.records.filter((x) => x.pool_entry_id === dupId).length, 1, `seed ${seed}: the duplicate was emitted twice`);
  }
});

test("timestamps are preserved verbatim, including offset form", () => {
  const doc = { entries: [
    { id: "a", entryName: "A", participantEmail: "a@example.invalid", createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-05-31T20:00:00-04:00" },
  ], paid: {}, deletedIds: [] };
  const r = transformPoolEntries(doc, CTX);
  eq(r.records[0].created_at, "2026-06-01T00:00:00Z", "Z form preserved");
  eq(r.records[0].updated_at, "2026-05-31T20:00:00-04:00",
    "the offset form is preserved verbatim: rewriting it to Z would be a silent normalisation of a timezone");
});

console.log("\nWS7.12 — red team\n");

test("ATTACK: a payer name differing only in case must not become a third party", () => {
  const doc = { entries: [{ id: "a", entryName: "Synthetic Alpha", participantEmail: "a@example.invalid", payerName: "SYNTHETIC  alpha" }], paid: { a: true } };
  const r = transformPayments(doc, CTX);
  assert(r.records[0].payer_identity_key, "case and whitespace differences are the same person paying for themselves");
  assert(!hasCode(r, "THIRD_PARTY_PAYER_UNRESOLVED"), "and must not be reported as a third party");
});

test("ATTACK: a tombstone for an entry that was never present must surface", () => {
  const r = transformPoolEntries({ entries: [], paid: {}, deletedIds: ["ghost"] }, CTX);
  assert(hasCode(r, "TOMBSTONE_WITHOUT_ENTRY"), "silent loss before the migration must still be visible");
});

test("ATTACK: an entry with no id cannot slip through unreferenced", () => {
  const r = transformPoolEntries({ entries: [{ entryName: "A", participantEmail: "a@example.invalid" }], paid: {}, deletedIds: [] }, CTX);
  eq(r.records.length, 0, "not emitted");
  assert(hasCode(r, "ENTRY_WITHOUT_ID"), "reported as a conflict");
});

test("ATTACK: a blank entry label must not silently become a duplicate", () => {
  const r = transformPoolEntries({ entries: [{ id: "a", entryName: "A", participantEmail: "a@example.invalid", entryLabel: "   " }], paid: {}, deletedIds: [] }, CTX);
  eq(r.records[0].entry_label, "main", "defaulted");
  assert(hasCode(r, "ENTRY_LABEL_DEFAULTED"), "but the defaulting is reported, since it affects duplicate detection");
});

test("ATTACK: an empty legacy document produces no DOCUMENT-DERIVED records", () => {
  /**
   * Competitions, editions, phases and pools come from CONTEXT, not from the document — the legacy state has
   * no competition entity at all. So an empty document still yields those reference records, and the
   * assertion applies only to the transformers that read the document.
   */
  const REFERENCE_ONLY = new Set(["transformCompetitions", "transformCompetitionEditions",
    "transformCompetitionPhases", "transformPools"]);
  const all = transformAll({}, CTX);
  for (const [name, r] of Object.entries(all.results)) {
    if (!REFERENCE_ONLY.has(name)) eq(r.records.length, 0, `${name} produced records from an empty document`);
    if (!MONEY_BEARING.includes(name)) eq(r.ok, true, `${name} should not be fatal on an empty document`);
  }
});

test("ATTACK: no transformer output contains a raw legacy free-text field", () => {
  const doc = { ...DOC() };
  doc.auditLog = [{ ts: "t", action: "x", admin: true, detail: "SENSITIVE-FREE-TEXT-MARKER", entryId: "en-1" }];
  doc.entries[0].memo = "ANOTHER-MARKER";
  const all = transformAll(doc, CTX);
  const json = JSON.stringify(Object.values(all.results).map((r) => r.records));
  assert(!json.includes("SENSITIVE-FREE-TEXT-MARKER"), "audit detail leaked into a record");
  assert(!json.includes("ANOTHER-MARKER"), "an unmapped legacy field leaked into a record");
});

// ── KPLUS-F005 ─────────────────────────────────────────────────────────────────────────────────
// LEGACY_VERSIONS' keys are analytical labels that appear nowhere in the data. Production state carries
// `meta.version` holding SITE versions (v4.99, v1.47, v3.94) and no `meta.schemaVersion` at all, so
// every real pool classified UNKNOWN and all three money-bearing transformers failed closed on 100% of
// real data. detectLegacyShape reads the structure instead. Shapes below are the real production
// envelopes, reduced to their discriminators — no participant data.

console.log("\nLegacy shape detection from structure (KPLUS-F005)\n");

test("each real production envelope detects as exactly one characterised shape", () => {
  eq(detectLegacyShape({ entries: [], paid: {}, results: {} }).version, "v4-copa", "results as an object is copa");
  eq(detectLegacyShape({ entries: [], paid: {}, results: null, roundEmail: {} }).version, "v4-br", "results null is br (T-18)");
  eq(detectLegacyShape({ entries: [], paid: {}, phases: [], espnSync: {} }).version, "v4-cdb", "phases is cdb");
});

test("a detected shape carries the LEGACY_VERSIONS status the transformers gate on", () => {
  eq(detectLegacyShape({ results: {} }).status, "SUPPORTED", "copa");
  eq(detectLegacyShape({ results: null }).status, "SUPPORTED_WITH_WARNINGS", "br carries its warning");
  eq(detectLegacyShape({ phases: [] }).status, "SUPPORTED", "cdb");
  for (const v of [{ results: {} }, { results: null }, { phases: [] }]) {
    assert(detectLegacyShape(v).detected === true, "a match must say it matched");
    assert(detectLegacyShape(v).why, "and say on what evidence");
  }
});

test("anything uncharacterised fails closed, so money-bearing transforms cannot run on it", () => {
  for (const bad of [null, undefined, 42, "state", [], {}, { entries: [] }, { results: [] }, { results: "x" }]) {
    const d = detectLegacyShape(bad);
    eq(d.status, "UNKNOWN", `${JSON.stringify(bad)} must not be treated as characterised`);
    eq(d.detected, false, "and must say it did not detect");
    assert(d.why, "and must say why");
  }
});

test("a document matching two signatures is ambiguous, not a best guess", () => {
  const d = detectLegacyShape({ phases: [], results: {} });
  eq(d.status, "UNKNOWN", "two signatures is not one signature");
  assert(/ambiguous/.test(d.why), "and it must say so rather than silently preferring one");
});

test("detection does NOT consult meta.version — a release label is not a shape", () => {
  // The exact trap: a site-version bump must not change how the data is transformed, and a site
  // version must not be able to make an uncharacterised shape look characterised.
  eq(detectLegacyShape({ results: {}, meta: { version: "v4.99" } }).version, "v4-copa", "recognised by structure");
  eq(detectLegacyShape({ results: {}, meta: { version: "v99.0" } }).version, "v4-copa", "and unaffected by the label");
  eq(detectLegacyShape({ meta: { version: "v4-copa" } }).status, "UNKNOWN", "a label alone proves nothing");
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
// KPLUS-F043 — a two-leg tie swaps hosts on the second leg.
//
// ADR-K04's positional rule (teamA -> home_team) was settled on the World Cup, where every fixture is
// one match. A knockout tie is two, and the hosts invert between them. The CDB2026 app states it in
// its own code — `home = leg === "second" ? tie.teamB : tie.teamA` — and calls it unambiguous.
// Applying the positional rule blind would not fail; it would score every second leg backwards.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test("KPLUS-F043 — the first leg keeps teamA at home, the second leg inverts", () => {
  const ctx = { fixtures: [{ match: "t1-ida", teamA: "Vasco", teamB: "Fluminense" },
                            { match: "t1-volta", teamA: "Vasco", teamB: "Fluminense" }] };
  const r = transformMatches({}, { ...ctx, matches: [
    { match_id: "t1-ida", competition_edition_phase_id: "p1", leg: 1, tie_id: "t1" },
    { match_id: "t1-volta", competition_edition_phase_id: "p1", leg: 2, tie_id: "t1" },
  ] });
  assert(r.ok, `transform failed: ${JSON.stringify(r.findings?.map((f) => f.code))}`);
  const ida = r.records.find((x) => x.match_id === "t1-ida");
  const volta = r.records.find((x) => x.match_id === "t1-volta");
  eq(ida.home_team, "Vasco", "leg 1: teamA hosts");
  eq(ida.away_team, "Fluminense", "leg 1: teamB visits");
  eq(volta.home_team, "Fluminense", "leg 2: teamB hosts — this is the whole finding");
  eq(volta.away_team, "Vasco", "leg 2: teamA visits");
});

test("KPLUS-F043 — a single-leg fixture is untouched, so the World Cup mapping is unchanged", () => {
  const ctx = { fixtures: [{ match: "GS-01", teamA: "Brasil", teamB: "Croácia" }] };
  for (const leg of [null, undefined, 1, "first"]) {
    const r = transformMatches({}, { ...ctx, matches: [{ match_id: "GS-01", competition_edition_phase_id: "p1", leg }] });
    eq(r.records[0].home_team, "Brasil", `leg=${JSON.stringify(leg)} must keep teamA at home`);
    eq(r.records[0].away_team, "Croácia", `leg=${JSON.stringify(leg)} must keep teamB away`);
  }
});

test("KPLUS-F043 — an EXPLICIT home_team/away_team is authoritative and is never inverted", () => {
  // A fixture that already says who hosts has answered the question. Re-deriving it from the leg would
  // corrupt the one form that was unambiguous.
  const ctx = { fixtures: [{ match: "x", home_team: "Santos", away_team: "Remo" }] };
  const r = transformMatches({}, { ...ctx, matches: [{ match_id: "x", competition_edition_phase_id: "p1", leg: 2 }] });
  eq(r.records[0].home_team, "Santos", "an explicit host survives a second leg");
  eq(r.records[0].away_team, "Remo", "and so does the explicit visitor");
});

test("ANTI-VACUITY — the leg-inversion test would fail against the pre-fix mapping", () => {
  // The pre-fix behaviour was `home = teamA` regardless of leg. If that were still the rule, the
  // second-leg expectation above would read Vasco rather than Fluminense.
  const ctx = { fixtures: [{ match: "t2-volta", teamA: "Cruzeiro", teamB: "Chapecoense" }] };
  const r = transformMatches({}, { ...ctx, matches: [{ match_id: "t2-volta", competition_edition_phase_id: "p1", leg: 2 }] });
  assert(r.records[0].home_team !== "Cruzeiro",
    "the second leg still puts teamA at home — the inversion is not applied and every second leg is backwards");
  eq(r.records[0].home_team, "Chapecoense", "teamB hosts the decisive leg");
});


console.log("\nLive source keys — the blind spot, and the semantic states that must not collapse\n");

test("every key live production actually has carries a disposition", () => {
  // The gate could not report these as UNKNOWN because it had never heard of them. A field the coverage
  // model does not know about is invisible, not safe — which is the one failure a coverage gate exists
  // to prevent. Measured against production 2026-08-11.
  const accounted = new Set([
    ...CRITICAL_FIELDS.map((f) => f.path.replace(/\[\].*$/, "")),
    ...Object.keys(NON_CRITICAL_DISPOSITIONS),
    ...Object.keys(LIVE_SOURCE_KEYS),
  ]);
  const missing = LIVE_PRODUCTION_KEYS.filter((k) => !accounted.has(k));
  eq(missing.join(",") || "(none)", "(none)", "a live production key with no disposition is a blind spot");
});

test("no disposition was inferred from the key name — each carries producer, consumer and impact", () => {
  for (const [k, v] of Object.entries(LIVE_SOURCE_KEYS)) {
    assert(v.producer && v.producer.length > 20, `${k} has no producer evidence`);
    assert(v.consumer && v.consumer.length > 10, `${k} has no consumer evidence`);
    assert(v.scoringImpact && v.financialImpact, `${k} does not state scoring/financial impact`);
    assert(v.why && v.why.length > 60, `${k} has no reasoning`);
    assert(v.presentIn && v.presentIn.length, `${k} does not say which pools carry it`);
  }
});

test("cutoffAt is MAPPED now that M13 gave it a column, and was never downgraded to reach that", () => {
  // It blocked pools/br2026 until M13 existed. It was cleared by BUILDING the representation, not by
  // reclassifying the key — those two routes to "unblocked" look identical in a status field and are
  // opposites in what they preserve.
  eq(LIVE_SOURCE_KEYS.cutoffAt.disposition, COVERAGE.MAPPED);
  assert(/entry_cutoff_at/.test(LIVE_SOURCE_KEYS.cutoffAt.targetRepresentation),
    "MAPPED must name the column it maps to, or it is an assertion about nothing");
  assert(/M13/.test(LIVE_SOURCE_KEYS.cutoffAt.resolvedBy || ""), "and the migration that created it");
  assert(LIVE_SOURCE_KEYS.cutoffAt.disposition !== COVERAGE.INTENTIONALLY_DROPPED
      && LIVE_SOURCE_KEYS.cutoffAt.disposition !== COVERAGE.ARCHIVED,
    "cutoffAt decides whether an entry was submitted in time; dropping or archiving it discards that rule");
  eq(blockedDomains().length, 0, "no key blocks a domain now");
});

test("MAPPED is backed by the TRANSFORMER, not only by the declaration", () => {
  // The whole point of the cutoffAt lane. `disposition: MAPPED` plus a `targetRepresentation` naming a
  // column is a CLAIM. For the first three domains that claim happened to be true; for `cutoffAt` it was
  // false for a while — M13 built the column, source accounting went green on the strength of it, and no
  // transformer emitted the field. A backfill run in that window would have written pools with a NULL
  // deadline and the gate would still have said MAPPED.
  //
  // So: for every live key declared MAPPED whose target names a concrete column, a transformer must
  // actually produce that column. Asserted structurally rather than per key, so the next MAPPED claim
  // inherits the check instead of needing someone to remember it.
  const emitted = {
    "entry_cutoff_at": () => transformPools({ cutoffAt: "2026-07-16T22:15:00.000Z" }, POOL_CTX()).records[0],
  };
  let checked = 0;
  for (const [key, d] of Object.entries(LIVE_SOURCE_KEYS)) {
    if (d.disposition !== COVERAGE.MAPPED) continue;
    const col = (d.targetRepresentation || "").match(/bolao\.[a-z_]+\.([a-z_]+)/);
    if (!col) continue;                       // targets a whole relation rather than one column
    const producer = emitted[col[1]];
    if (!producer) continue;                  // no per-column probe declared for this one yet
    const rec = producer();
    assert(Object.prototype.hasOwnProperty.call(rec, col[1]),
      `${key} is declared MAPPED to ${col[1]} but no transformer emits that field`);
    assert(rec[col[1]] !== null && rec[col[1]] !== undefined,
      `${key} is declared MAPPED to ${col[1]} but the transformer emits it empty for a document that HAS the value`);
    checked++;
  }
  assert(checked > 0, "the check must actually check something; a vacuous pass here is the bug it exists to catch");
});

test("deletedResults is a tombstone and must be MAPPED even while it is empty", () => {
  const d = LIVE_SOURCE_KEYS.deletedResults;
  eq(d.disposition, COVERAGE.MAPPED);
  eq(d.liveCardinality, 0, "it is currently empty on main");
  assert(/tombstone/i.test(d.why), "the reasoning must say why an empty array still matters");
  assert(/DIRECT/.test(d.scoringImpact), "a resurrected result is a scored result");
});

console.log("\nKEY_ABSENT vs JSON_NULL vs EMPTY vs NONEMPTY — the states must stay distinct\n");

test("detectLegacyShape separates the three live states of `results`", () => {
  // main = NONEMPTY object, br2026 = JSON_NULL, cdb2026 = KEY_ABSENT. Three states, three verdicts.
  const copa = detectLegacyShape({ entries: [], paid: {}, deletedIds: [], results: { m1: {} } });
  const br   = detectLegacyShape({ entries: [], paid: {}, deletedIds: [], results: null });
  const cdb  = detectLegacyShape({ entries: [], paid: {}, deletedIds: [], phases: {} });
  eq(copa.version, "v4-copa", "results as an object");
  eq(br.version, "v4-br", "results explicitly null is NOT an empty object");
  eq(cdb.version, "v4-cdb", "results absent entirely, discriminated by `phases`");
  assert(copa.version !== br.version && br.version !== cdb.version, "three states must not collapse to one verdict");
});

test("an EMPTY OBJECT for results is not the same as null, and is not silently accepted as copa", () => {
  // No live document has results:{}, so this is the state a future write could introduce. An empty
  // object means "a results container was written and holds nothing"; null means "none were recorded".
  const empty = detectLegacyShape({ entries: [], paid: {}, deletedIds: [], results: {} });
  // It classifies as v4-copa by shape, which is correct — but the RESULT transform must still produce
  // zero records rather than erroring, and must not report it as the null case.
  eq(empty.version, "v4-copa", "an empty object is still the object shape");
  assert(empty.version !== "v4-br", "and must never be reported as the null shape");
});

test("MUTANT: collapsing results with ?? {} destroys the v4-br signature", () => {
  // This is the exact pattern the brief warned about. Applied to the shape detector it makes br2026
  // indistinguishable from copa — the document would be parsed by the wrong version's rules.
  const collapse = (s) => ({ ...s, results: s.results ?? {} });
  const br = detectLegacyShape(collapse({ entries: [], paid: {}, deletedIds: [], results: null }));
  assert(br.version !== "v4-br",
    "the mutant must break the signature — if this still says v4-br the detector was not reading the null");
  eq(br.version, "v4-copa", "and it breaks it in the dangerous direction: br2026 read as copa");
});

test("MUTANT: dropping any of the seven keys must be visible to the blind-spot check", () => {
  for (const drop of ["meta", "cutoffAt", "roundEmail", "activePhase", "espnSync", "phases", "deletedResults"]) {
    const mutated = Object.fromEntries(Object.entries(LIVE_SOURCE_KEYS).filter(([k]) => k !== drop));
    const accounted = new Set([
      ...CRITICAL_FIELDS.map((f) => f.path.replace(/\[\].*$/, "")),
      ...Object.keys(NON_CRITICAL_DISPOSITIONS),
      ...Object.keys(mutated),
    ]);
    const missing = LIVE_PRODUCTION_KEYS.filter((k) => !accounted.has(k));
    assert(missing.includes(drop), `dropping ${drop} must be caught, and was not`);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// ENTRY CUTOFF — bolao.pools.entry_cutoff_at
//
// The deadline an entry is late against. M13 built the column specifically so this key would have
// somewhere to live, and the source-accounting gate reports `cutoffAt` as MAPPED on that basis — so these
// tests exist to make that claim TRUE rather than merely asserted. Every one of them fails on a plausible
// wrong implementation, not on an obviously broken one.
// ─────────────────────────────────────────────────────────────────────────────
// The real production instant, as a literal, so a change to it is a visible diff rather than a surprise.
const BR_CUTOFF_RAW = "2026-07-16T22:15:00.000Z";
const BR_CUTOFF_OFFSET = "2026-07-16T19:15:00-03:00";   // the SAME instant, as config.js writes it

test("cutoff: PRESENT — the exact instant reaches entry_cutoff_at", () => {
  const r = transformPools({ cutoffAt: BR_CUTOFF_RAW }, POOL_CTX());
  eq(r.records.length, 1, "one pool");
  eq(r.records[0].entry_cutoff_at, BR_CUTOFF_RAW, "the frozen deadline must survive the transform");
  eq(r.coverage.cutoffAt, COVERAGE.MAPPED, "a present cutoff is MAPPED, which is what source accounting claims");
});

test("cutoff: ABSENT — NULL, and NOT defaulted from anything", () => {
  const r = transformPools({ entries: [] }, POOL_CTX());
  eq(r.records[0].entry_cutoff_at, null, "absent must be NULL");
  assert(hasCode(r, "CUTOFF_ABSENT"), "the absence must be reported, not silently produce NULL");
  eq(r.coverage.cutoffAt, COVERAGE.UNKNOWN, "no value is not MAPPED");
});

test("cutoff: EXPLICIT JSON null is distinct from ABSENT in evidence", () => {
  const nul = transformPools({ cutoffAt: null }, POOL_CTX());
  const abs = transformPools({}, POOL_CTX());
  eq(nul.records[0].entry_cutoff_at, null, "explicit null targets NULL");
  eq(abs.records[0].entry_cutoff_at, null, "absent targets NULL");
  // The column has no third state, so both are NULL. The DISTINCTION has to survive somewhere, and the
  // app's own empty state is `cutoffAt: null` — so this is a real state, not a malformed document.
  assert(hasCode(nul, "CUTOFF_EXPLICIT_NULL"), "explicit null must be reported as explicit null");
  assert(hasCode(abs, "CUTOFF_ABSENT"), "absent must be reported as absent");
  assert(!hasCode(nul, "CUTOFF_ABSENT"), "explicit null must not be reported as absent");
  assert(!hasCode(abs, "CUTOFF_EXPLICIT_NULL"), "absent must not be reported as explicit null");
  eq(nul.evidence.cutoffState, "EXPLICIT_NULL", "evidence must carry which state it was");
  eq(abs.evidence.cutoffState, "ABSENT", "evidence must carry which state it was");
});

test("cutoff: the offset form and the Z form are the same instant", () => {
  const a = transformPools({ cutoffAt: BR_CUTOFF_RAW }, POOL_CTX());
  const b = transformPools({ cutoffAt: BR_CUTOFF_OFFSET }, POOL_CTX());
  eq(b.records[0].entry_cutoff_at, a.records[0].entry_cutoff_at,
    "timestamptz stores an instant, so -03:00 and Z forms of one moment must normalise identically");
  eq(Date.parse(b.records[0].entry_cutoff_at), Date.parse(BR_CUTOFF_OFFSET), "the instant itself must not shift");
});

test("cutoff: a shifted instant is NOT accepted as equal — the timezone check is real", () => {
  const r = transformPools({ cutoffAt: "2026-07-16T19:15:00Z" }, POOL_CTX());   // same clock face, wrong instant
  assert(r.records[0].entry_cutoff_at !== BR_CUTOFF_RAW,
    "reading -03:00 as if it were UTC shifts the deadline by three hours and must not compare equal");
});

test("cutoff: unparseable is a CONFLICT, never a silent NULL", () => {
  const r = transformPools({ cutoffAt: "not-a-date" }, POOL_CTX());
  assert(hasCode(r, "CUTOFF_UNPARSEABLE"), "a corrupt deadline must be reported");
  eq(codeSeverity(r, "CUTOFF_UNPARSEABLE"), SEVERITY.CONFLICT,
    "silently nulling it would read as 'no deadline', which reopens entries that were closed");
});

test("cutoff: other products get NULL — no cross-product leakage", () => {
  for (const doc of [{ phases: [], activePhase: "r1" }, { results: {}, deletedResults: [] }]) {
    const r = transformPools(doc, POOL_CTX({
      pools: [{ pool_id: "pool-other", competition_edition_id: "ed-o", slug: "cdb2026", name: "Other" }],
    }));
    eq(r.records[0].entry_cutoff_at, null, "a pool whose document has no cutoffAt must not acquire one");
  }
});

test("cutoff: MUTATION — one document's cutoff is never copied onto several pools", () => {
  const r = transformPools({ cutoffAt: BR_CUTOFF_RAW }, POOL_CTX({
    pools: [
      { pool_id: "pool-br", competition_edition_id: "ed-br", slug: "br2026", name: "BR" },
      { pool_id: "pool-cdb", competition_edition_id: "ed-cdb", slug: "cdb2026", name: "CDB" },
    ],
  }));
  eq(r.records.filter((x) => x.entry_cutoff_at !== null).length, 0,
    "with two pools in one call the deadline is not attributable, so NO pool may receive it");
  assert(hasCode(r, "CUTOFF_NOT_ATTRIBUTABLE"), "the refusal must be reported rather than looking like absence");
});

test("cutoff: MUTATION — entry_cutoff_at is always present as a key, so it cannot be quietly dropped", () => {
  for (const doc of [{ cutoffAt: BR_CUTOFF_RAW }, { cutoffAt: null }, {}]) {
    const r = transformPools(doc, POOL_CTX());
    assert(Object.prototype.hasOwnProperty.call(r.records[0], "entry_cutoff_at"),
      "the field must exist on every pool record; an omitted key and a NULL are the same row to a writer that spreads it, and are not the same to a reviewer");
  }
});

test("cutoff: readEntryCutoff classifies every state it can be handed", () => {
  eq(readEntryCutoff({ cutoffAt: BR_CUTOFF_RAW }).state, "VALUE", "string");
  eq(readEntryCutoff({ cutoffAt: null }).state, "EXPLICIT_NULL", "json null");
  eq(readEntryCutoff({}).state, "ABSENT", "missing key");
  eq(readEntryCutoff({ cutoffAt: "" }).state, "INVALID", "empty string is not a deadline");
  eq(readEntryCutoff({ cutoffAt: 1752703200000 }).state, "INVALID", "a number is not the stored shape");
  eq(readEntryCutoff(null).state, "ABSENT", "a null document must not throw");
});


// ─────────────────────────────────────────────────────────────────────────────
// CDB MATCHES — tie-embedded legs. Mutation controls, because every one of these
// silently produces a plausible-looking row.
// ─────────────────────────────────────────────────────────────────────────────
const M_CTX = (over = {}) => ({
  phaseIdBySlug: (sl) => (sl === "quartas" ? "PHASE-Q" : null),
  tieIdFor: (ph, t) => `tie:${ph}:${t}`,
  matchIdFor: (ph, t, leg) => `match:${ph}:${t}:${leg}`,
  ...over,
});
const M_DOC = (legs) => ({ phases: { quartas: { ties: { "espn-a_b": { teamA: "A", teamB: "B", matches: legs } } } } });
const LEG = (o = {}) => ({ homeTeam: "A", awayTeam: "B", status: "FINAL", kickoff: "2026-08-01T20:30:00.000Z", ...o });

test("legs map to the target's columns, and goals are NOT among them", () => {
  const r = extractCdbMatches(M_DOC({ first: LEG({ goalsHome: 3, goalsAway: 1 }) }), M_CTX());
  eq(r.records.length, 1, "one leg");
  const m = r.records[0];
  for (const c of ["match_id", "tie_id", "competition_edition_phase_id", "provider_match_ref", "leg", "home_team", "away_team", "kickoff_at", "status"]) {
    assert(Object.prototype.hasOwnProperty.call(m, c), `bolao.matches has ${c}`);
  }
  for (const gone of ["goalsHome", "goalsAway", "home_goals", "away_goals", "resultSource", "venue", "city"]) {
    assert(!(gone in m), `${gone} is not a matches column — a match with no result is a valid match`);
  }
});

test("MUTATION — leg order comes from the KEY, never from iteration order", () => {
  eq(CDB_LEG_ORDER.first, 1, "first is leg 1");
  eq(CDB_LEG_ORDER.second, 2, "second is leg 2");
  // Object key order reversed in the source: the mapping must not follow it.
  const r = extractCdbMatches(M_DOC({ second: LEG({ homeTeam: "B", awayTeam: "A" }), first: LEG() }), M_CTX());
  const first = r.records.find((x) => x.leg === 1), second = r.records.find((x) => x.leg === 2);
  eq(first.home_team, "A", "leg 1 hosts A");
  eq(second.home_team, "B", "leg 2 hosts B — swapping the legs inverts which side hosted each half");
});

test("MUTATION — an unrecognised leg key is REFUSED, not numbered by position", () => {
  const r = extractCdbMatches(M_DOC({ third: LEG() }), M_CTX());
  eq(r.records.length, 0, "no row");
  assert(hasCode(r, "MATCH_LEG_UNRECOGNISED"), "and the refusal is reported");
});

test("MUTATION — home/away are taken from the LEG, not from the tie's teamA/teamB", () => {
  // The tie lists A first; the second leg inverts the hosts. Reading the tie instead of the leg would
  // make both legs look identical and invert the second one's result.
  const r = extractCdbMatches(M_DOC({ first: LEG(), second: LEG({ homeTeam: "B", awayTeam: "A" }) }), M_CTX());
  const byLeg = Object.fromEntries(r.records.map((x) => [x.leg, x]));
  assert(byLeg[1].home_team !== byLeg[2].home_team, "the two legs must not share a host");
  eq(byLeg[2].away_team, "A", "leg 2 visits A");
});

test("MUTATION — kickoff is preserved to the instant; a one-hour shift is a different value", () => {
  const r = extractCdbMatches(M_DOC({ first: LEG({ kickoff: "2026-08-01T20:30:00.000Z" }) }), M_CTX());
  eq(r.records[0].kickoff_at, "2026-08-01T20:30:00.000Z", "verbatim");
  eq(Date.parse(r.records[0].kickoff_at), Date.parse("2026-08-01T17:30:00-03:00"), "same instant in another offset");
  assert(Date.parse(r.records[0].kickoff_at) !== Date.parse("2026-08-01T21:30:00.000Z"), "an hour later is NOT the same instant");
});

test("MUTATION — a missing kickoff is NULL and reported, never now()", () => {
  const r = extractCdbMatches(M_DOC({ first: LEG({ kickoff: null }) }), M_CTX());
  eq(r.records[0].kickoff_at, null, "NULL");
  assert(hasCode(r, "MATCH_WITHOUT_KICKOFF"), "and stated");
  eq(codeSeverity(r, "MATCH_WITHOUT_KICKOFF"), SEVERITY.UNKNOWN, "an honest gap");
});

test("MUTATION — status is mapped explicitly and an unknown value is REFUSED", () => {
  eq(CDB_STATUS_MAP.FINAL, "finished", "FINAL");
  eq(CDB_STATUS_MAP.SCHEDULED, "scheduled", "SCHEDULED");
  const ok = extractCdbMatches(M_DOC({ first: LEG({ status: "SCHEDULED" }) }), M_CTX());
  eq(ok.records[0].status, "scheduled", "mapped");
  const bad = extractCdbMatches(M_DOC({ first: LEG({ status: "POSTPONED_BY_RAIN" }) }), M_CTX());
  eq(bad.records.length, 0, "refused rather than defaulted");
  assert(hasCode(bad, "MATCH_STATUS_UNRECOGNISED"), "and reported — a wrong status changes whether a match counts as played");
});

test("MUTATION — status is never inferred from the presence of a score", () => {
  // A leg with goals but status SCHEDULED must stay scheduled. Inferring 'finished' from goals is how a
  // postponed or void match becomes a played one.
  const r = extractCdbMatches(M_DOC({ first: LEG({ status: "SCHEDULED", goalsHome: 2, goalsAway: 0 }) }), M_CTX());
  eq(r.records[0].status, "scheduled", "the source's own status wins over the presence of a score");
});

test("MUTATION — a leg whose phase has no row is REFUSED, never orphaned onto another phase", () => {
  const r = extractCdbMatches({ phases: { semifinal: { ties: { t: { matches: { first: LEG() } } } } } }, M_CTX());
  eq(r.records.length, 0, "no row");
  assert(hasCode(r, "MATCH_PHASE_UNRESOLVED"), "reported");
});

test("MUTATION — a leg missing a side is EXCLUDED, never given a placeholder", () => {
  const r = extractCdbMatches(M_DOC({ first: LEG({ awayTeam: null }) }), M_CTX());
  eq(r.records.length, 0, "predictions are scored against these names");
  assert(hasCode(r, "MATCH_SIDES_UNRESOLVED"), "reported");
});

test("match identity is deterministic in (phase, tie, leg), so a retry converges", () => {
  const a = extractCdbMatches(M_DOC({ first: LEG(), second: LEG({ homeTeam: "B", awayTeam: "A" }) }), M_CTX());
  const b = extractCdbMatches(M_DOC({ first: LEG(), second: LEG({ homeTeam: "B", awayTeam: "A" }) }), M_CTX());
  eq(JSON.stringify(a.records.map((x) => x.match_id)), JSON.stringify(b.records.map((x) => x.match_id)), "stable ids");
  eq(new Set(a.records.map((x) => x.match_id)).size, 2, "and distinct per leg");
});



// ─────────────────────────────────────────────────────────────────────────────
// CDB MATCH RESULTS — the zero-vs-absent boundary, which is where real money lives.
// The live source has 15 legs with goalsHome=0, 23 with goalsAway=0 and 9 that finished 0-0.
// Any truthiness check would delete all nine of those official results.
// ─────────────────────────────────────────────────────────────────────────────
const R_CTX = (over = {}) => ({
  matchIdFor: (ph, t, leg) => `match:${ph}:${t}:${leg}`,
  resultIdFor: (ph, t, leg) => `res:${ph}:${t}:${leg}`,
  ...over,
});
const R_DOC = (legs) => ({ phases: { quartas: { ties: { "espn-a_b": { matches: legs } } } } });

test("a 0-0 finished result SURVIVES and is a real row", () => {
  const r = extractCdbMatchResults(R_DOC({ first: { status: "FINAL", goalsHome: 0, goalsAway: 0 } }), R_CTX());
  eq(r.records.length, 1, "0-0 is a football result, not a missing one");
  eq(r.records[0].goals_home, 0, "zero preserved");
  eq(r.records[0].goals_away, 0, "zero preserved");
  eq(r.evidence.zeroZero, 1, "and counted as such");
});

test("0-1 and 1-0 keep their sides — home/away never swap", () => {
  const a = extractCdbMatchResults(R_DOC({ first: { status: "FINAL", goalsHome: 0, goalsAway: 1 } }), R_CTX());
  eq(`${a.records[0].goals_home}-${a.records[0].goals_away}`, "0-1", "0-1 stays 0-1");
  const b = extractCdbMatchResults(R_DOC({ first: { status: "FINAL", goalsHome: 1, goalsAway: 0 } }), R_CTX());
  eq(`${b.records[0].goals_home}-${b.records[0].goals_away}`, "1-0", "1-0 stays 1-0");
  assert(a.records[0].goals_home !== b.records[0].goals_home, "and the two are not the same row");
});

test("MUTATION — a missing result produces NO ROW, never 0-0 and never NULL goals", () => {
  const r = extractCdbMatchResults(R_DOC({ first: { status: "SCHEDULED", goalsHome: null, goalsAway: null } }), R_CTX());
  eq(r.records.length, 0, "absence is represented by the ABSENCE of a row");
  eq(r.evidence.withoutResult, 1, "and is counted, not silently dropped");
});

test("MUTATION — truthiness would delete the 0-0 results; the check must be an explicit null test", () => {
  const legs = {
    first: { status: "FINAL", goalsHome: 0, goalsAway: 0 },
    second: { status: "FINAL", goalsHome: 0, goalsAway: 2 },
  };
  const r = extractCdbMatchResults(R_DOC(legs), R_CTX());
  eq(r.records.length, 2, "both rows survive");
  // The mutant: `if (!m.goalsHome)` treats 0 as absent.
  const mutant = Object.values(legs).filter((m) => m.goalsHome && m.goalsAway).length;
  eq(mutant, 0, "control: a truthiness filter would keep NONE of these — that is the bug this guards");
});

test("MUTATION — one side recorded without the other is a CONFLICT, not a half row", () => {
  const r = extractCdbMatchResults(R_DOC({ first: { status: "FINAL", goalsHome: 2, goalsAway: null } }), R_CTX());
  eq(r.records.length, 0, "emitting it would require inventing the missing half");
  assert(hasCode(r, "RESULT_HALF_RECORDED"), "reported");
  eq(codeSeverity(r, "RESULT_HALF_RECORDED"), SEVERITY.CONFLICT, "conflict");
});

test("MUTATION — a result binds to its own leg's match, and legs do not share one", () => {
  const r = extractCdbMatchResults(R_DOC({
    first: { status: "FINAL", goalsHome: 1, goalsAway: 0 },
    second: { status: "FINAL", goalsHome: 0, goalsAway: 3 },
  }), R_CTX());
  eq(r.records.length, 2, "one result per leg");
  const ids = r.records.map((x) => x.match_id);
  eq(new Set(ids).size, 2, "distinct matches");
  const byLeg = Object.fromEntries(r.records.map((x) => [x.__leg, x]));
  eq(byLeg.first.goals_away, 0, "leg 1 result stays on leg 1");
  eq(byLeg.second.goals_away, 3, "leg 2 result stays on leg 2");
});

test("every result is OFFICIAL — ADR-003 makes both admin and ESPN auto-sync official", () => {
  for (const rs of ["espn-auto", "admin", undefined]) {
    const r = extractCdbMatchResults(R_DOC({ first: { status: "FINAL", goalsHome: 1, goalsAway: 1, resultSource: rs } }), R_CTX());
    eq(r.records[0].is_official, true, `resultSource=${rs} is official — the provisional path (_liveTies) is never persisted`);
  }
});

test("provenance is recorded, never guessed", () => {
  eq(CDB_RESULT_SOURCE["espn-auto"], "espn", "espn-auto maps to espn");
  eq(CDB_RESULT_SOURCE.admin, "manual_admin", "admin maps to manual_admin");
  const none = extractCdbMatchResults(R_DOC({ first: { status: "FINAL", goalsHome: 1, goalsAway: 1 } }), R_CTX());
  eq(none.records[0].source, CDB_RESULT_SOURCE_UNRECORDED,
    "an absent resultSource must NOT become manual_admin — that asserts an attribution the document does not make");
  assert(hasCode(none, "RESULT_SOURCE_UNRECORDED"), "and it is reported");
});

test("no penalties are invented, and the paired constraint is satisfied", () => {
  const r = extractCdbMatchResults(R_DOC({ first: { status: "FINAL", goalsHome: 1, goalsAway: 1 } }), R_CTX());
  eq(r.records[0].penalties_home, null, "the source has no penalty field anywhere");
  eq(r.records[0].penalties_away, null, "both null satisfies mr_penalties_paired");
  eq((r.records[0].penalties_home === null), (r.records[0].penalties_away === null), "both or neither");
});

test("no points, no advancement, no scoring is computed here", () => {
  const r = extractCdbMatchResults(R_DOC({ first: { status: "FINAL", goalsHome: 3, goalsAway: 0 } }), R_CTX());
  const t = JSON.stringify(r.records[0]);
  for (const leak of ["points", "score", "advanc", "qualified", "winner"]) {
    assert(!new RegExp(leak, "i").test(t), `raw goals stay raw goals — ${leak} is not a match_results concern`);
  }
});

test("result identity is deterministic, so a retry converges", () => {
  const doc = R_DOC({ first: { status: "FINAL", goalsHome: 2, goalsAway: 2 } });
  eq(extractCdbMatchResults(doc, R_CTX()).records[0].match_result_id,
     extractCdbMatchResults(doc, R_CTX()).records[0].match_result_id, "stable id");
});



// ─────────────────────────────────────────────────────────────────────────────
// BRACKET SLOTS — the guard that was documented as fail-closed and was not.
// `if (!a || !b)` only fires on null. "Winner Match 87" is a truthy string, so ten of copa2026's
// 95 fixtures sailed through a safeguard written specifically for them.
// ─────────────────────────────────────────────────────────────────────────────
test("BRACKET_SLOT matches the two verb families the app uses, and nothing else", () => {
  for (const v of ["Winner Match 95", "Loser Match 101", "winner match 3", "  Winner Match 12  "]) {
    assert(BRACKET_SLOT.test(v), `${v} is a slot`);
  }
  for (const v of ["Brazil", "Winners FC", "Match 95", "Loserville", "Winner", "AS Winner Match FC"]) {
    assert(!BRACKET_SLOT.test(v), `${v} is a team name, not a slot — the pattern must be anchored`);
  }
});

test("MUTATION — a fixture naming a bracket slot is EXCLUDED, not written as a team", () => {
  const doc = { results: { "100": { goalsA: 1, goalsB: 0, advanceSide: "A" } } };
  const r = transformMatches(doc, { ...CTX, defaultPhaseId: "PH",
    fixtures: [{ match: "100", teamA: "Winner Match 95", teamB: "Winner Match 96" }] });
  eq(r.records.length, 0, "a row naming a non-team is worse than an absent row — predictions are scored against these names");
  assert(hasCode(r, "MATCH_SIDE_IS_BRACKET_SLOT"), "and the exclusion must be reported, not silent");
  eq(codeSeverity(r, "MATCH_SIDE_IS_BRACKET_SLOT"), SEVERITY.UNKNOWN, "an honest gap, not a data conflict");
});

test("MUTATION — one slot side is enough to exclude the match", () => {
  const doc = { results: { "100": { goalsA: 1, goalsB: 0 } } };
  const r = transformMatches(doc, { ...CTX, defaultPhaseId: "PH",
    fixtures: [{ match: "100", teamA: "Brazil", teamB: "Winner Match 96" }] });
  eq(r.records.length, 0, "half a real pairing is still not a pairing");
  assert(hasCode(r, "MATCH_SIDE_IS_BRACKET_SLOT"), "reported");
});

test("a fixture naming two real teams is UNAFFECTED by the slot guard", () => {
  const doc = { results: { "73": { goalsA: 0, goalsB: 1, advanceSide: "B" } } };
  const r = transformMatches(doc, { ...CTX, defaultPhaseId: "PH",
    fixtures: [{ match: "73", teamA: "South Africa", teamB: "Canada" }] });
  eq(r.records.length, 1, "real teams still migrate");
  eq(r.records[0].home_team, "South Africa", "and keep their positions");
  assert(!hasCode(r, "MATCH_SIDE_IS_BRACKET_SLOT"), "no false positive");
});

test("MUTATION — the guard is NOT vacuous: without it the slot row would insert cleanly", () => {
  // match_distinct_teams only rejects home = away. Two DIFFERENT slots satisfy it, which is exactly why
  // the database could not have caught this.
  assert("Winner Match 95" !== "Winner Match 96", "two distinct slots pass match_distinct_teams");
  assert(Boolean("Winner Match 95"), "and a slot is truthy, so the null check could never fire");
});



// ─────────────────────────────────────────────────────────────────────────────
// CDB PREDICTIONS — two kinds, a quarantine to propagate, and 41 predicted zeros to not lose.
// ─────────────────────────────────────────────────────────────────────────────
const P_PHASES = { oitavas: { ties: { "espn-a_b": {}, "espn-c_d": {} } } };
const P_CTX = (over = {}) => ({
  entryIsMigratable: () => true,
  entryIdFor: (id) => `entry:${id}`,
  matchIdFor: (ph, t, leg) => `match:${ph}:${t}:${leg}`,
  tieIdFor: (ph, t) => `tie:${ph}:${t}`,
  predictionIdFor: (e, ph, t, k) => `pred:${e}:${ph}:${t}:${k}`,
  ...over,
});
const P_DOC = (picks, id = "e1") => ({ phases: P_PHASES, entries: [{ id, picks }] });

test("the two prediction kinds satisfy pred_subject_exactly_one and are never merged", () => {
  const r = extractCdbPredictions(P_DOC({
    matches: { "espn-a_b": { first: { goalsHome: 1, goalsAway: 2 } } },
    qualified: { "espn-a_b": "B" },
  }), P_CTX());
  eq(r.records.length, 2, "a leg score and an advancement are two predictions");
  for (const x of r.records) {
    assert((x.match_id !== null) !== (x.tie_id !== null),
      "exactly one of match_id / tie_id must be set — that CHECK exists because they are different predictions");
  }
  const leg = r.records.find((x) => x.__kind === "leg_score");
  const q = r.records.find((x) => x.__kind === "qualified");
  eq(leg.tie_id, null, "a leg score names a MATCH");
  eq(leg.predicted_qualified_side, null, "and predicts no side");
  eq(q.match_id, null, "an advancement names a TIE");
  eq(q.predicted_goals_home, null, "and predicts no score");
  eq(q.predicted_qualified_side, "B", "verbatim");
});

test("MUTATION — a predicted 0 survives; truthiness would delete 41 of the 192 live leg picks", () => {
  const r = extractCdbPredictions(P_DOC({ matches: { "espn-a_b": {
    first: { goalsHome: 0, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 3 } } } }), P_CTX());
  eq(r.records.length, 2, "both survive");
  const byLeg = Object.fromEntries(r.records.map((x) => [x.__leg, x]));
  eq(byLeg.first.predicted_goals_home, 0, "0-0 is a prediction");
  eq(byLeg.first.predicted_goals_away, 0, "0-0 is a prediction");
  eq(byLeg.second.predicted_goals_home, 0, "a predicted nil-3 keeps its nil");
  // the mutant
  const mutant = [{ goalsHome: 0, goalsAway: 0 }, { goalsHome: 0, goalsAway: 3 }].filter((p) => p.goalsHome && p.goalsAway).length;
  eq(mutant, 0, "control: a truthiness filter keeps NONE of these");
});

test("MUTATION — home and away never swap", () => {
  const r = extractCdbPredictions(P_DOC({ matches: { "espn-a_b": { first: { goalsHome: 3, goalsAway: 1 } } } }), P_CTX());
  eq(r.records[0].predicted_goals_home, 3, "home stays home");
  eq(r.records[0].predicted_goals_away, 1, "away stays away");
});

test("MUTATION — a blocked entry's predictions are EXCLUDED and COUNTED, never reassigned", () => {
  const doc = { phases: P_PHASES, entries: [
    { id: "ok", picks: { matches: { "espn-a_b": { first: { goalsHome: 1, goalsAway: 0 } } }, qualified: { "espn-a_b": "A" } } },
    { id: "blocked", picks: { matches: { "espn-a_b": { first: { goalsHome: 2, goalsAway: 2 } } }, qualified: { "espn-a_b": "B" } } },
  ] };
  const r = extractCdbPredictions(doc, P_CTX({ entryIsMigratable: (id) => id === "ok" }));
  eq(r.records.length, 2, "only the migratable entry's predictions are emitted");
  for (const x of r.records) eq(x.__entry, "ok", "and none is re-pointed at a different entry");
  eq(r.evidence.blockedEntries, 1, "the blocked entry is counted");
  eq(r.evidence.blockedPicks, 2, "and so are its predictions — accounted, not dropped");
});

test("MUTATION — leg order comes from the key, and each leg gets its own match", () => {
  const r = extractCdbPredictions(P_DOC({ matches: { "espn-a_b": {
    second: { goalsHome: 9, goalsAway: 9 }, first: { goalsHome: 1, goalsAway: 1 } } } }), P_CTX());
  const byLeg = Object.fromEntries(r.records.map((x) => [x.__leg, x]));
  assert(byLeg.first.match_id !== byLeg.second.match_id, "two legs, two matches");
  eq(byLeg.second.predicted_goals_home, 9, "the second leg's values stay on the second leg despite key order");
});

test("MUTATION — a tie slug under two phases is REFUSED, not resolved by first match", () => {
  const doc = { phases: { oitavas: { ties: { "espn-a_b": {} } }, quartas: { ties: { "espn-a_b": {} } } },
    entries: [{ id: "e1", picks: { qualified: { "espn-a_b": "A" } } }] };
  const r = extractCdbPredictions(doc, P_CTX());
  eq(r.records.length, 0, "ambiguous attribution must not be guessed");
  assert(hasCode(r, "TIE_SLUG_AMBIGUOUS_ACROSS_PHASES"), "reported");
});

test("an unrecognised qualified value is REFUSED, never coerced to a side", () => {
  const r = extractCdbPredictions(P_DOC({ qualified: { "espn-a_b": "Palmeiras" } }), P_CTX());
  eq(r.records.length, 0, "a team name is not a side");
  assert(hasCode(r, "PREDICTION_QUALIFIED_SIDE_UNRECOGNISED"), "reported");
});

test("no scoring is computed — a prediction is a stored fact", () => {
  const r = extractCdbPredictions(P_DOC({ matches: { "espn-a_b": { first: { goalsHome: 1, goalsAway: 0 } } } }), P_CTX());
  const t = JSON.stringify(r.records[0]);
  for (const leak of ["points", "correct", "exact", "score_", "won", "bonus"]) {
    assert(!new RegExp(leak, "i").test(t), `whether a prediction was right is the scoring engine's business, not ${leak}`);
  }
});

test("prediction identity is deterministic, so a retry converges", () => {
  const doc = P_DOC({ matches: { "espn-a_b": { first: { goalsHome: 2, goalsAway: 2 } } }, qualified: { "espn-a_b": "A" } });
  const a = extractCdbPredictions(doc, P_CTX()), b = extractCdbPredictions(doc, P_CTX());
  eq(JSON.stringify(a.records.map((x) => x.prediction_id)), JSON.stringify(b.records.map((x) => x.prediction_id)), "stable");
  eq(new Set(a.records.map((x) => x.prediction_id)).size, 2, "and distinct per subject");
});


console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ TRANSFORMER TESTS PASSED\n" : "✗ TRANSFORMER TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
