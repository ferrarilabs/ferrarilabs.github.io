#!/usr/bin/env node
/**
 * NEGATIVE CONTROLS for the A1–A11 restore acceptance harness — Batch J, STEP 17.
 *
 * A checker only ever observed to pass is indistinguishable from a checker that cannot fail. Every
 * criterion the harness claims to enforce is therefore attacked here with a fixture that breaks exactly
 * that criterion, and the test asserts the harness reports FAIL. A control that fails to break the
 * harness is itself reported as a defect.
 *
 * The fixtures are synthetic and hand-built: no participant data, no real hostnames, no key material,
 * no policy expressions copied from production.
 */

import { evaluate, RESULT, parseManifest, copyRowCounts, policyDigests, verifyManifestClaims, verifyArtefactDigests, loadBundle } from "./restore_acceptance.mjs";
import { REQUIRED_TABLES, REQUIRED_VIEWS } from "./acceptance_checks.mjs";
import { A1_STRUCTURAL_EXPECTED as SE, requiredObjectsVerdict } from "./restore_acceptance.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha = (b) => createHash("sha256").update(b).digest("hex");

let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** A criterion must come back FAIL, and it must be the criterion we attacked. */
function expectFail(name, id, bundle) {
  const a = evaluate(bundle);
  const r = a.results.find((x) => x.id === id);
  check(name, r.result === RESULT.FAIL, r.result === RESULT.FAIL ? `${id} FAIL as required` : `${id} came back ${r.result} — the control did not break the harness`);
}

function expectPass(name, id, bundle) {
  const a = evaluate(bundle);
  const r = a.results.find((x) => x.id === id);
  check(name, r.result === RESULT.PASS, r.result === RESULT.PASS ? `${id} PASS` : `${id} = ${r.result}: ${r.why ?? ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A clean synthetic baseline that satisfies every offline-decidable criterion.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Issue #133: era uma lista de SETE escrita a mao aqui, divergente da verdade canonica. Agora vem
// de `acceptance_checks.mjs` — uma fonte so. Uma segunda lista era como o fixture conseguia
// "passar" enquanto descrevia um banco que producao nao tem ha meses.
const TABLES = REQUIRED_TABLES;

/**
 * TOC sintetico. Issue #133: agora emite NOMES DE VERDADE para TABLE e VIEW, porque A1 passou a
 * perguntar "as exigidas estao aqui?" em vez de "quantas sao?". Com nomes de placeholder (`x0`,
 * `x1`) o fixture nao conseguia distinguir um restore canonico de um que perdeu a tabela de PII —
 * que era exatamente o defeito sob teste.
 */
function toc({ tableNames = TABLES, viewNames = REQUIRED_VIEWS,
               types = SE.enumTypes, functions = SE.functions, policies = SE.policies,
               indexes = SE.uniqueIndexes, constraints = SE.primaryKeys, fks = SE.foreignKeys, acl = 9 } = {}) {
  const e = [];
  const named = (kind, names) => { for (const nm of names) e.push({ raw: `1; 0 0 ${kind} public ${nm} owner`, kind, detail: `${kind} public ${nm} owner` }); };
  const push = (kind, n) => { for (let i = 0; i < n; i++) e.push({ raw: `1; 0 0 ${kind} public x owner`, kind, detail: `${kind} public x${i} owner` }); };
  named("TABLE", tableNames); named("VIEW", viewNames);
  push("TYPE", types); push("FUNCTION", functions); push("POLICY", policies);
  push("INDEX", indexes); push("CONSTRAINT", constraints); push("FK", fks); push("ACL", acl);
  for (const nm of tableNames) e.push({ raw: "", kind: "TABLE", detail: `TABLE DATA public ${nm} owner` });
  return e;
}

/** Synthetic policy expressions — invented for this test, never copied from the database. */
const SYNTH_POLICIES = [
  ["bolao_state", "p_read", "(true)"],
  ["lottery_pools", "p_pool_read", "(status = 'open'::text)"],
  ["lottery_participants", "p_part_read", "(auth.uid() = user_id)"],
  ["lottery_participations", "p_partic_read", "(true)"],
  ["lottery_draws", "p_draw_read", "(true)"],
  ["lottery_payment_transactions", "p_txn_read", "(auth.role() = 'service_role'::text)"],
];

function schemaSql({ rlsTables = 7, force = 0, sequences = 0, owners = 0, policies = SYNTH_POLICIES } = {}) {
  const L = [];
  for (const t of TABLES) L.push(`CREATE TABLE "public"."${t}" (id uuid NOT NULL);`);
  for (let i = 0; i < rlsTables; i++) L.push(`ALTER TABLE "public"."${TABLES[i]}" ENABLE ROW LEVEL SECURITY;`);
  for (let i = 0; i < force; i++) L.push(`ALTER TABLE "public"."${TABLES[i]}" FORCE ROW LEVEL SECURITY;`);
  for (let i = 0; i < sequences; i++) L.push(`CREATE SEQUENCE "public"."seq_${i}";`);
  for (let i = 0; i < owners; i++) L.push(`ALTER TABLE "public"."${TABLES[i]}" OWNER TO postgres;`);
  for (const [t, name, expr] of policies) L.push(`CREATE POLICY "${name}" ON "public"."${t}" FOR SELECT USING (${expr});`);
  return L.join("\n") + "\n";
}

function plainSql(rowCounts, { extraTable = null, authUsers = false } = {}) {
  const L = [];
  for (const [t, n] of Object.entries(rowCounts)) {
    L.push(`COPY "public"."${t}" (id) FROM stdin;`);
    for (let i = 0; i < n; i++) L.push(`row${i}`);
    L.push("\\.");
    L.push("");
  }
  if (extraTable) L.push(`COPY "public"."${extraTable}" (id) FROM stdin;`, "x", "\\.", "");
  if (authUsers) L.push(`COPY "auth"."users" (id, email) FROM stdin;`, "1\tsomeone@example.invalid", "\\.", "");
  return L.join("\n");
}

const BASE_COUNTS = { bolao_state: 1, lottery_pools: 2, lottery_participants: 8, lottery_participations: 12,
  lottery_draws: 3, lottery_payment_transactions: 9, lottery_admin_audit: 2 };

const MANIFEST_TEXT = [
  "scope = schema public only; provider schemas excluded",
  "options = --no-owner --no-privileges=false",
  ...Object.entries(BASE_COUNTS).map(([t, n]) => `row_count.${t}|${n}`),
].join("\n");

function baseline(overrides = {}) {
  return {
    manifest: parseManifest(MANIFEST_TEXT),
    toc: toc(),
    plainSql: plainSql(BASE_COUNTS),
    schemaSql: schemaSql(),
    productionRefScan: { filesScanned: 8, operationalReferences: 0 },
    // A custom-format archive carries ownership by design; --no-owner at RESTORE time removes it. This
    // is the shape of a healthy archive, and A10's decisive check is the second number being zero.
    ownershipReplay: { withoutFlag: 12, withFlag: 0 },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nVACUITY — the clean baseline must actually pass the criteria it claims to check");
// ─────────────────────────────────────────────────────────────────────────────────────────────
for (const id of ["A1", "A2", "A6", "A7", "A9", "A10", "A11"]) {
  expectPass(`baseline satisfies ${id}`, id, baseline());
}
{
  // A3/A4/A5 must be BLOCKED offline, and must become decidable when a live catalog is supplied —
  // otherwise "BLOCKED" would just be a permanent excuse.
  const a = evaluate(baseline());
  for (const id of ["A3", "A4", "A5"]) {
    const r = a.results.find((x) => x.id === id);
    check(`${id} is BLOCKED offline, not silently passed`, r.result === RESULT.BLOCKED, r.result);
  }
  const live = evaluate(baseline({ liveCatalog: { notValidConstraints: 0, fkOrphans: 0, duplicateInsertRejected: true, rlsEnabled: 7, rlsForced: 0, realAuthIdentities: 0 }, toc: toc({ constraints: 7, fks: 17, indexes: 1 }) }));
  for (const id of ["A3", "A4"]) {
    const r = live.results.find((x) => x.id === id);
    check(`${id} becomes decidable with a live catalog`, r.result !== RESULT.BLOCKED, r.result);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nNEGATIVE CONTROLS — each fixture breaks one criterion; the harness must say FAIL");
// ─────────────────────────────────────────────────────────────────────────────────────────────

// STEP 17: wrong row count
expectFail("wrong row count (one table short by one row)", "A2",
  baseline({ plainSql: plainSql({ ...BASE_COUNTS, lottery_participations: 11 }) }));
expectFail("wrong row count (one table has an extra row)", "A2",
  baseline({ plainSql: plainSql({ ...BASE_COUNTS, bolao_state: 2 }) }));
expectFail("a manifest table missing from the archive entirely", "A2",
  baseline({ plainSql: plainSql({ ...BASE_COUNTS, lottery_draws: undefined }) }));

// STEP 17: unexpected table
expectFail("unexpected table present in the archive", "A2",
  baseline({ plainSql: plainSql(BASE_COUNTS, { extraTable: "shadow_ledger" }) }));
// Issue #133: era `tables: 8` — uma CONTAGEM. Agora o controle acrescenta uma tabela NAO
// DECLARADA pelo nome, que e a forma real do risco: um dump que traz objeto que ninguem declarou
// pode ser o dump errado.
expectFail("undeclared table present in the archive", "A1",
  baseline({ toc: toc({ tableNames: [...TABLES, "shadow_ledger"] }) }));

// STEP 17: missing index
expectFail("missing unique index", "A1", baseline({ toc: toc({ indexes: SE.uniqueIndexes - 1 }) }));
expectFail("missing primary key", "A1", baseline({ toc: toc({ constraints: SE.primaryKeys - 1 }) }));
expectFail("missing foreign key", "A1", baseline({ toc: toc({ fks: SE.foreignKeys - 1 }) }));
expectFail("missing policy", "A1", baseline({ toc: toc({ policies: SE.policies - 1 }) }));
expectFail("missing enum type", "A1", baseline({ toc: toc({ types: SE.enumTypes - 1 }) }));
expectFail("missing function", "A1", baseline({ toc: toc({ functions: SE.functions - 1 }) }));
{
  // A5 is BLOCKED offline, so the live path is where a missing index must be caught.
  const live = { notValidConstraints: 0, fkOrphans: 0, duplicateInsertRejected: true, rlsEnabled: 7, rlsForced: 0, realAuthIdentities: 0 };
  expectFail("missing index, live target", "A5", baseline({ toc: toc({ indexes: 0 }), liveCatalog: live }));
  expectFail("unique index present but NOT enforcing a duplicate", "A5",
    baseline({ liveCatalog: { ...live, duplicateInsertRejected: false } }));
  expectFail("constraints present but left NOT VALID", "A3", baseline({ liveCatalog: { ...live, notValidConstraints: 3 } }));
  expectFail("referential integrity broken (orphan rows)", "A4", baseline({ liveCatalog: { ...live, fkOrphans: 4 } }));
}

// STEP 17: wrong policy hash
{
  const recorded = SYNTH_POLICIES.map(([, , e]) => createHash("md5").update(e).digest("hex")).join("\n");
  const live = { notValidConstraints: 0, fkOrphans: 0, duplicateInsertRejected: true, rlsEnabled: 7, rlsForced: 0, realAuthIdentities: 0 };
  expectPass("policy digests matching DR-1's recorded set", "A8",
    baseline({ dr1Text: recorded, liveCatalog: { ...live, policyDigests: SYNTH_POLICIES.map(([, , e]) => createHash("md5").update(e).digest("hex")) } }));
  expectFail("wrong policy hash (a predicate was altered)", "A8",
    baseline({ dr1Text: recorded, liveCatalog: { ...live, policyDigests: [createHash("md5").update("(1 = 1)").digest("hex")] } }));
  const a = evaluate(baseline({ dr1Text: recorded }));
  const r = a.results.find((x) => x.id === "A8");
  check("A8 offline is BLOCKED, never assumed PASS", r.result === RESULT.BLOCKED, r.result);
}

// STEP 17: production URL / reference
expectFail("production reference reachable from a restored artefact", "A9",
  baseline({ productionRefScan: { filesScanned: 8, operationalReferences: 1 } }));

// STEP 17: real-looking auth identity
expectFail("real-looking auth identity present in the archive", "A11",
  baseline({ plainSql: plainSql(BASE_COUNTS, { authUsers: true }) }));
expectFail("real auth identities present on a live target", "A11",
  baseline({ liveCatalog: { notValidConstraints: 0, fkOrphans: 0, duplicateInsertRejected: true, rlsEnabled: 7, rlsForced: 0, realAuthIdentities: 5 } }));

// RLS regressions
expectFail("RLS disabled on one table", "A7", baseline({ schemaSql: schemaSql({ rlsTables: 6 }) }));
expectFail("FORCE ROW LEVEL SECURITY unexpectedly set", "A7", baseline({ schemaSql: schemaSql({ force: 1 }) }));

// Ownership / sequences — the two live findings, as regression locks
// BATCH-J-F2, corrected. The archive containing ownership is EXPECTED; what must never happen is the
// archive still emitting ownership after --no-owner, because then the restore cannot be made owner-free.
expectFail("archive still emits ownership WITH --no-owner (restore cannot be owner-free)", "A10",
  baseline({ ownershipReplay: { withoutFlag: 12, withFlag: 12 } }));
expectFail("archive emits even one ownership statement with --no-owner", "A10",
  baseline({ ownershipReplay: { withoutFlag: 12, withFlag: 1 } }));
expectFail("no ownership replay performed at all (A10's decisive check skipped)", "A10",
  baseline({ ownershipReplay: null }));
expectFail("archive holds no ownership at all — not the artefact the contract describes", "A10",
  baseline({ ownershipReplay: { withoutFlag: 0, withFlag: 0 } }));
expectFail("wrong ACL count", "A10", baseline({ toc: toc({ acl: 8 }) }));
expectFail("an unexpected sequence appears in public", "A6", baseline({ schemaSql: schemaSql({ sequences: 2 }) }));

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nMANIFEST CLAIM CONTROLS — an unverifiable claim is itself a finding (STEP 7)");
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const healthy = parseManifest([
    "options = per-artifact; see backup_contract.json v2",
    "acl_treatment = ACLs INCLUDED; ownership PRESENT_IN_ARCHIVE_OMITTED_AT_RESTORE",
    "restore_command = pg_restore --no-owner --single-transaction -d <TARGET>",
  ].join("\n"));
  const r = verifyManifestClaims(healthy, { ownershipReplay: { withoutFlag: 12, withFlag: 0 } });
  check("a truthful per-artifact manifest passes", r.ok, JSON.stringify(r.findings.map((f) => f.claim)));

  // The exact shape of the original manifest must be caught — this is F2's regression lock.
  const f2 = parseManifest([
    "options = --no-owner --no-blobs --quote-all-identifiers",
    "acl_treatment = ACLs INCLUDED (privileges dumped); owner NOT dumped",
  ].join("\n"));
  const r2 = verifyManifestClaims(f2, { ownershipReplay: { withoutFlag: 12, withFlag: 0 } });
  check("the original manifest's shape is rejected (F2 regression lock)", !r2.ok && r2.findings.length === 3,
    `${r2.findings.length} findings: ${r2.findings.map((f) => f.severity).join(",")}`);
  check("the false ownership claim is identified specifically",
    r2.findings.some((f) => f.claim === "ownership" && f.severity === "FALSE_CLAIM"));
  check("the bundle-wide options line is identified as structural",
    r2.findings.some((f) => f.claim === "options" && f.severity === "STRUCTURAL"));
  check("a missing --no-owner restore command is identified",
    r2.findings.some((f) => f.claim === "restore_command" && f.severity === "MISSING_GUARANTEE"));

  // An unverified ownership claim must not pass merely because no replay was supplied.
  const r3 = verifyManifestClaims(f2, {});
  check("an ownership claim with no replay to check it against is not accepted",
    r3.findings.some((f) => f.claim === "ownership"));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nPARSER CONTROLS — the counters must not be fooled by shape");
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const c = copyRowCounts(plainSql({ bolao_state: 0 }));
  check("an empty COPY block counts 0, not 1", c.bolao_state === 0, `got ${c.bolao_state}`);
  const d = policyDigests(schemaSql());
  check("all 6 synthetic policies are found", d.length === 6, `got ${d.length}`);
  check("policy digests never carry the expression text",
    d.every((x) => !("using" in x) && !("expr" in x) && (x.usingMd5 === null || /^[0-9a-f]{32}$/.test(x.usingMd5))));
  const m = parseManifest(MANIFEST_TEXT);
  check("manifest row counts parse", m.rowCounts.lottery_participations === 12, JSON.stringify(m.rowCounts.lottery_participations));
  // TABLE DATA must never be mistaken for a TABLE.
  const a = evaluate(baseline());
  // A evidencia mudou de forma junto com A1 (Issue #133): passou a reportar quantas TABLE nomeadas
  // foram vistas, e `tableCount` continua contando entradas TABLE brutas. O invariante testado
  // segue o mesmo -- TABLE DATA nao pode ser confundida com TABLE.
  check("TABLE DATA entries are not counted as tables",
    a.results.find((x) => x.id === "A1").evidence.includes(`${TABLES.length} tabelas`));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nISSUE #133 — o gate aceitava o unico desastre que existe para detectar");
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  // O defeito, reproduzido nos DOIS sentidos antes de provar a correcao.
  //
  // A versao anterior de A1 comparava CONTAGENS contra `tables: 7`, enquanto producao tem 12.
  // Consequencia medida: um restore CORRETO reprovava, e um restore que apagasse a tabela de PII
  // e outras quatro PASSAVA -- porque sobravam exatamente sete.
  const contagemAntiga = (nomes) => nomes.length === 7;   // o predicado antigo, reproduzido

  const canonico = TABLES;                                 // 12 tabelas reais
  const lossy = TABLES.filter((t) => ![
    "bolao_entry_private", "bolao_notif_jobs", "live_sports_cache",
    "cdb_entry_access", "bolao_round_notif_jobs",
  ].includes(t));                                          // exatamente as 7 antigas

  check("DEFEITO 1/2: o gate ANTIGO reprovava um restore correto",
    contagemAntiga(canonico) === false, `12 tabelas corretas -> contagem 7? ${contagemAntiga(canonico)}`);
  check("DEFEITO 2/2: o gate ANTIGO aceitava um restore que apagou a tabela de PII",
    contagemAntiga(lossy) === true, `restore sem bolao_entry_private -> aceito? ${contagemAntiga(lossy)}`);

  // CASE 1 — restauracao canonica PASSA
  expectPass("CASE 1: restauracao canonica (12 tabelas + 3 views) e aceita", "A1",
    baseline({ toc: toc({ tableNames: canonico }) }));

  // CASE 2 — sem bolao_entry_private REPROVA. O caso que originou a Issue.
  {
    const b = baseline({ toc: toc({ tableNames: canonico.filter((t) => t !== "bolao_entry_private") }) });
    expectFail("CASE 2: restauracao sem bolao_entry_private (PII) e REJEITADA", "A1", b);
    const r = evaluate(b).results.find((x) => x.id === "A1");
    check("CASE 2: e a razao nomeia a tabela de PII",
      /bolao_entry_private/.test(r.why || ""), (r.why || "").slice(0, 90));
  }

  // CASE 3 — outra tabela exigida ausente tambem REPROVA
  expectFail("CASE 3: restauracao sem bolao_round_notif_jobs e REJEITADA", "A1",
    baseline({ toc: toc({ tableNames: canonico.filter((t) => t !== "bolao_round_notif_jobs") }) }));

  // CASE 3b — o mesmo vale para as views de leitura publica
  expectFail("CASE 3b: restauracao sem bolao_state_public e REJEITADA", "A1",
    baseline({ toc: toc({ viewNames: REQUIRED_VIEWS.filter((v) => v !== "bolao_state_public") }) }));

  // CASE 4 — estrutura deprecada/extra segue POLITICA DECLARADA, nunca define a verdade sozinha
  {
    const comExtra = toc({ tableNames: [...canonico, "tabela_deprecada"] });
    const naoDeclarada = requiredObjectsVerdict(comExtra);
    check("CASE 4: extra NAO DECLARADA reprova (nao vira verdade canonica por existir)",
      naoDeclarada.ok === false && /NAO DECLARADAS/.test(naoDeclarada.why || ""), (naoDeclarada.why || "").slice(0, 80));
    const declarada = requiredObjectsVerdict(comExtra, { tolerated: ["tabela_deprecada"] });
    check("CASE 4: a MESMA extra, uma vez DECLARADA como tolerada, deixa de reprovar",
      declarada.ok === true, declarada.why || "aceita");
    const ausente = requiredObjectsVerdict(toc({ tableNames: canonico }), { tolerated: ["tabela_deprecada"] });
    check("CASE 4: tolerada AUSENTE tambem nao reprova — tolerada nao e exigida",
      ausente.ok === true, ausente.why || "aceita");
  }

  // CASE 5 — o diff precisa ser legivel: o que falta, nomeado
  {
    const v = requiredObjectsVerdict(toc({ tableNames: canonico.filter((t) => !["bolao_entry_private", "live_sports_cache"].includes(t)) }));
    check("CASE 5: o diff nomeia TODAS as exigidas ausentes",
      /bolao_entry_private/.test(v.why) && /live_sports_cache/.test(v.why) && v.missingTables.length === 2,
      v.why.slice(0, 100));
  }

  // CASE 6 — sem baseline provavel, FECHA FALHANDO em vez de aprovar
  {
    for (const [rotulo, listas] of [
      ["lista vazia", { required: [] }],
      // `null` explicito, nao `undefined`: undefined dispara o valor padrao do parametro (que e o
      // comportamento correto quando ninguem passa nada). O modo de falha real e a lista chegar
      // vazia ou nula porque o carregamento falhou.
      ["lista nula", { required: null }],
      ["views ausentes", { requiredViews: null }],
    ]) {
      const v = requiredObjectsVerdict(toc({ tableNames: canonico }), listas);
      check(`CASE 6: baseline indisponivel (${rotulo}) FECHA FALHANDO`,
        v.ok === false && /FECHADO/.test(v.why || ""), (v.why || "").slice(0, 70));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nBACKUP CONTRACT — the declared contract must stay consistent with what the checker enforces");
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  // A contract no code reads is a document that drifts. These assertions make backup_contract.json a
  // participant in the gate rather than decoration.
  const C = JSON.parse(readFileSync(new URL("../../model/backup_contract.json", import.meta.url), "utf8"));
  check("contract is at version 3 (the F012 correction)", C.version === 3, `v${C.version}`);

  /**
   * KPLUS-F012 — a companion that is captured and never replayed is a note, not backup scope. The
   * contract now has to say what happens to each member at RESTORE time, and CAPTURE_ONLY has to justify
   * itself. Without this check the v3 vocabulary would be documentation nobody enforces, which is the
   * same shape as the gap it was written to close.
   */
  const companions = C.artifacts.find((a) => a.id === "companions");
  check("every companion member declares a restoreAction", companions
    && Array.isArray(companions.members)
    && companions.members.every((m) => typeof m === "object" && m.restoreAction),
    `${companions?.members?.length ?? 0} member(s)`);
  check("CAPTURE_ONLY members record WHY they are never replayed",
    companions.members.filter((m) => m.restoreAction === "CAPTURE_ONLY").every((m) => (m.captureOnlyWhy || "").length > 40),
    "a member captured, never replayed and never explained is KPLUS-F012 happening again");
  check("the event-trigger companion is REPLAYED and has a named verifier",
    companions.members.some((m) => /event_triggers/.test(m.member) && m.restoreAction === "REPLAY_APPLICATION_OWNED" && /A12/.test(m.verifiedBy || "")),
    "the one omission that must be replayed");
  check("the mandatory restore flag is --no-owner", C.ownershipDoctrine.mandatoryRestoreFlag === "--no-owner");
  check("every artefact declares its ownership behaviour and how to verify it",
    C.artifacts.every((a) => a.ownership && a.ownershipVerification));
  check("ownership vocabulary is closed",
    C.artifacts.every((a) => ["PRESENT_IN_ARCHIVE_OMITTED_AT_RESTORE", "OMITTED", "NOT_APPLICABLE"].includes(a.ownership)));

  const archive = C.artifacts.find((a) => a.id === "custom_archive");
  check("the custom archive does NOT pass --no-owner (pg_dump ignores it there)",
    !/--no-owner/.test(archive.command) && archive.noOwnerFlagOmittedDeliberately === true);
  check("the custom archive's ownership is PRESENT_IN_ARCHIVE_OMITTED_AT_RESTORE",
    archive.ownership === "PRESENT_IN_ARCHIVE_OMITTED_AT_RESTORE");
  for (const id of ["plain_sql", "schema_only"]) {
    const a = C.artifacts.find((x) => x.id === id);
    check(`${id} DOES pass --no-owner (where the flag works)`, /--no-owner/.test(a.command) && a.ownership === "OMITTED");
  }
  check("no artefact command carries the invalid --no-privileges=false",
    C.artifacts.every((a) => !/--no-privileges=/.test(a.command || "")));
  check("the invalid flag is recorded as rejected",
    C.rejectedFlags.some((f) => f.flag === "--no-privileges=false"));
  check("the manifest rules require per-artifact flags and mechanical verifiability",
    C.manifestRules.perArtifactFlags.startsWith("REQUIRED") && !!C.manifestRules.mechanicalVerifiability);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nARTEFACT INTEGRITY — KPLUS-F017: the manifest's digests must actually be checked");
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Workstream I proved the gap empirically: a single-byte-flipped archive passed the entire offline
// acceptance path with rc=0, because `parseManifest` read the sha256 lines into `m.sha` and no code
// anywhere compared them to the bytes on disk. These controls are the regression, and each one is a
// FAILURE case — a verifier only ever seen to pass is the thing that got us here.
{
  const dir = mkdtempSync(join(tmpdir(), "flk-digest-"));
  const write = (n, body) => { writeFileSync(join(dir, n), body); return sha(body); };
  const aBody = "-- artefact a\n", bBody = "-- artefact b\n";
  const manifest = { sha: { "a.sql": write("a.sql", aBody), "b.sql": write("b.sql", bBody), bundle_plaintext: sha("irrelevant") } };

  const clean = verifyArtefactDigests(dir, manifest);
  check("an intact bundle verifies", clean.ok && clean.checked === 2,
    `checked ${clean.checked}/${clean.recorded} — without this the failures below could be vacuous`);
  check("the tarball-level digests are not looked for on disk", !clean.findings.some((f) => f.file === "bundle_plaintext"));

  writeFileSync(join(dir, "b.sql"), bBody + "-- appended after the manifest was written\n");
  const flipped = verifyArtefactDigests(dir, manifest);
  check("a member that no longer matches its digest is DIGEST_MISMATCH",
    !flipped.ok && flipped.findings.some((f) => f.file === "b.sql" && f.reason === "DIGEST_MISMATCH"));

  writeFileSync(join(dir, "b.sql"), bBody);
  writeFileSync(join(dir, "c.sql"), "-- injected, covered by no digest\n");
  const injected = verifyArtefactDigests(dir, manifest);
  check("a member covered by NO digest is PRESENT_BUT_UNRECORDED — tampering adds as well as alters",
    !injected.ok && injected.findings.some((f) => f.file === "c.sql" && f.reason === "PRESENT_BUT_UNRECORDED"));

  rmSync(join(dir, "c.sql"));
  rmSync(join(dir, "a.sql"));
  const absent = verifyArtefactDigests(dir, manifest);
  check("a member the manifest records but the bundle lacks is RECORDED_BUT_ABSENT",
    !absent.ok && absent.findings.some((f) => f.file === "a.sql" && f.reason === "RECORDED_BUT_ABSENT"));

  check("no digest value reaches the finding — only the file and the reason",
    !JSON.stringify(absent.findings).includes(manifest.sha["b.sql"]));

  rmSync(dir, { recursive: true, force: true });
}
{
  // loadBundle must REFUSE, not merely report: integrity is a precondition to interpretation, and every
  // criterion downstream reads these bytes.
  const dir = mkdtempSync(join(tmpdir(), "flk-loadbundle-"));
  const names = { dump: "bolao_public_20260808T005117Z.dump", plain: "bolao_public_20260808T005117Z.sql", schema: "bolao_public_schema_20260808T005117Z.sql" };
  const bodies = { [names.dump]: "not-a-real-archive", [names.plain]: "-- plain\n", [names.schema]: "-- schema\n" };
  for (const [n, b] of Object.entries(bodies)) writeFileSync(join(dir, n), b);
  const mPath = join(dir, "MANIFEST.txt");
  const manifestText = Object.entries(bodies).map(([n, b]) => `sha256.${n} = ${sha(b)}`).join("\n") + "\n";
  writeFileSync(mPath, manifestText);

  writeFileSync(join(dir, names.plain), "-- plain TAMPERED\n");
  let threw = null;
  try { loadBundle(dir, { manifestPath: mPath, verifyDigests: true, pgRestore: "/nonexistent" }); }
  catch (e) { threw = e; }
  check("loadBundle REFUSES a bundle that does not match its manifest",
    !!threw && /does not match its manifest/.test(threw.message) && /DIGEST_MISMATCH/.test(threw.message),
    threw ? "and names the member and the reason" : "it did not refuse");
  check("the refusal does not print the manifest text or a digest",
    !!threw && !threw.message.includes(sha("-- plain\n")));
  rmSync(dir, { recursive: true, force: true });
}

console.log("\nLEAKAGE CONTROL — nothing sensitive may reach the report");
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const a = evaluate(baseline({ plainSql: plainSql(BASE_COUNTS, { authUsers: true }), dr1Text: "deadbeefdeadbeefdeadbeefdeadbeef" }));
  const text = JSON.stringify(a);
  check("no policy expression text in the report", !text.includes("auth.uid()") && !text.includes("'open'"));
  check("no participant row content in the report", !text.includes("@example.invalid") && !/\brow\d+\b/.test(text));
}

console.log(`\n  ${pass} passed · ${fail} failed\n`);
if (fail) { console.error("✗ RESTORE ACCEPTANCE NEGATIVE CONTROLS FAILED — the harness is not proven\n"); process.exit(1); }
console.log("✓ restore acceptance harness is non-vacuous: every criterion it enforces was made to fail\n");
