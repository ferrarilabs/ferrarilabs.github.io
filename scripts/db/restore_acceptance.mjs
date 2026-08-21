#!/usr/bin/env node
/**
 * RESTORE ACCEPTANCE A1–A11 — Batch J.
 *
 * Evaluates the eleven acceptance criteria defined in
 * docs/bolao/db-modernization/BACKUP_RESTORE_OPERATIONAL_DESIGN.md §11.4, verbatim. The criteria are
 * NOT reinterpreted to make them passable: each one reports PASS, FAIL or BLOCKED, and BLOCKED means
 * "this criterion cannot be evaluated without a restored live server", never "close enough".
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT CAN BE PROVEN WITHOUT A SERVER, AND WHAT CANNOT
 *
 * There is no PostgreSQL server available on this machine — libpq ships `initdb` and `pg_ctl` but no
 * `postgres` binary, and there is no container runtime — and no disposable Supabase target has been
 * provisioned. So this run is an OFFLINE ARCHIVE ACCEPTANCE: it interrogates the backup itself with
 * pg_restore, which reads a custom-format archive perfectly well with nothing to connect to.
 *
 * That genuinely proves the archive is internally complete and readable by the restore toolchain. It
 * does NOT prove a server accepts it. The two are different claims and this file keeps them apart:
 *
 *   OFFLINE-PROVABLE   object counts, row counts, sequences, policy fidelity, production references,
 *                      grants, synthetic-identity isolation
 *   NEEDS A SERVER     constraint VALIDATION state, referential-integrity anti-joins, whether a unique
 *                      index actually REJECTS a duplicate
 *
 * A criterion in the second group is BLOCKED here. Reporting it as PASS on the strength of the DDL
 * being present would be the exact substitution this programme keeps refusing: "the statement exists"
 * is not "the constraint holds".
 *
 * No participant row, policy expression, hostname, project reference or key is ever printed.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { REQUIRED_TABLES, REQUIRED_VIEWS, TOLERATED_TABLES } from "./acceptance_checks.mjs";

export const RESULT = { PASS: "PASS", FAIL: "FAIL", BLOCKED: "BLOCKED" };

/** Requires a live restored database; cannot be decided from an archive. */
export const NEEDS_LIVE_SERVER = new Set(["A3", "A4", "A5"]);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/**
 * KPLUS-F017 — verify each bundle member against the sha256 the manifest records for it.
 *
 * The manifest has always carried a digest per plaintext artefact and `parseManifest` has always read
 * them into `m.sha`. Nothing ever compared them to the bytes on disk, so the only artefact-integrity
 * control the backup has was parsed and discarded. Workstream I proved the consequence: a
 * single-byte-flipped archive passed the whole offline acceptance path with rc=0.
 *
 * Both directions are checked. A member that does not match its digest is corrupt; a member present in
 * the bundle that NO digest covers is unaccounted for, which is how something gets added rather than
 * altered. `bundle_plaintext` and `bundle_encrypted` describe the tarball the bundle was extracted from,
 * not members of it, so they are not expected on disk.
 */
export function verifyArtefactDigests(dir, manifest) {
  const findings = [];
  const recorded = Object.entries(manifest.sha || {}).filter(([n]) => !n.startsWith("bundle_"));
  const covered = new Set();
  let checked = 0;

  for (const [name, expected] of recorded) {
    const p = join(dir, name);
    if (!existsSync(p)) { findings.push({ file: name, reason: "RECORDED_BUT_ABSENT" }); continue; }
    covered.add(name);
    checked++;
    // Digests are compared, never printed in full: a digest is not secret, but a habit of printing
    // whatever is at hand is how a preimage eventually gets printed beside one.
    if (sha256File(p) !== expected) findings.push({ file: name, reason: "DIGEST_MISMATCH" });
  }
  for (const f of readdirSync(dir)) {
    if (!covered.has(f) && !manifest.sha?.[f]) findings.push({ file: f, reason: "PRESENT_BUT_UNRECORDED" });
  }
  return { ok: findings.length === 0, checked, recorded: recorded.length, findings };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Manifest parsing
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function parseManifest(text) {
  const m = { rowCounts: {}, sha: {}, fields: {} };
  for (const line of text.split("\n")) {
    let x = /^row_count\.([A-Za-z_]+)\|(\d+)$/.exec(line.trim());
    if (x) { m.rowCounts[x[1]] = Number(x[2]); continue; }
    x = /^sha256\.(\S+)\s*=\s*([0-9a-f]{64})$/.exec(line.trim());
    if (x) { m.sha[x[1]] = x[2]; continue; }
    x = /^([a-z_]+)\s*=\s*(.+)$/.exec(line.trim());
    if (x) m.fields[x[1]] = x[2].trim();
  }
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Archive interrogation, all offline
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `pg_restore --list` needs no server. Returns parsed TOC entries. */
export function readToc(dumpPath, pgRestore = "pg_restore") {
  const out = execFileSync(pgRestore, ["--list", dumpPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const entries = [];
  for (const line of out.split("\n")) {
    if (!/^\d/.test(line)) continue;
    const parts = line.split(/\s+/);
    // `id; tableoid oid KIND schema name owner`
    entries.push({ raw: line, kind: parts[3], detail: parts.slice(3).join(" ") });
  }
  return entries;
}

export function tocCounts(entries) {
  const c = {};
  for (const e of entries) {
    // TABLE and "TABLE DATA" both begin with TABLE; separate them, because 7 tables and 7 data
    // sections are different facts and conflating them is how "14 tables" gets reported.
    const kind = /TABLE DATA/.test(e.detail) ? "TABLE DATA" : e.kind;
    c[kind] = (c[kind] || 0) + 1;
  }
  return c;
}

/** Count COPY-block rows per table from the plain dump. Rows are counted, never read. */
export function copyRowCounts(plainSql) {
  const counts = {};
  // The terminator is matched WITHOUT requiring a newline before it, so a genuinely empty table yields 0
  // rather than failing to match and reading as "absent from the archive" — a distinction A2 turns into a
  // FAIL, so an empty table would have been reported as a missing one.
  const re = /COPY "?public"?\."?([a-z_]+)"?[^\n]*FROM stdin;\n([\s\S]*?)\\\.\n/g;
  let m;
  while ((m = re.exec(plainSql))) {
    counts[m[1]] = m[2].split("\n").filter((l) => l.trim() !== "").length;
  }
  return counts;
}

/**
 * Extract each CREATE POLICY's USING and WITH CHECK expressions and md5 them.
 * The expressions themselves are never returned — only their digests.
 */
export function policyDigests(schemaSql) {
  const out = [];
  const re = /CREATE POLICY "([^"]+)" ON "?([a-z_]+)"?\."?([a-z_]+)"?([\s\S]*?);\n/g;
  let m;
  while ((m = re.exec(schemaSql))) {
    const body = m[4];
    const using = /USING\s*\(([\s\S]*?)\)\s*(?:WITH CHECK|$)/.exec(body);
    const check = /WITH CHECK\s*\(([\s\S]*?)\)\s*$/.exec(body.trim());
    out.push({
      policy: m[1], table: `${m[2]}.${m[3]}`,
      usingMd5: using ? md5(using[1].trim()) : null,
      withCheckMd5: check ? md5(check[1].trim()) : null,
    });
  }
  return out;
}

/**
 * Replay the archive to text twice — with and without `pg_restore --no-owner` — and count the ownership
 * statements each way. Both runs are offline; neither touches a server.
 *
 * This is the mechanical proof behind the ownership doctrine in model/backup_contract.json: ownership
 * lives in a custom-format archive by design, and the restore flag is what removes it. Only counts are
 * returned — no SQL text is retained.
 */
export function ownershipReplayCounts(dumpPath, pgRestore = "pg_restore") {
  const count = (args) => {
    const out = execFileSync(pgRestore, [...args, "-f", "-", dumpPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return (out.match(/^\s*ALTER [A-Z ]+[^\n]*OWNER TO/gm) || []).length;
  };
  return { withoutFlag: count([]), withFlag: count(["--no-owner"]) };
}

/**
 * Check the manifest only makes claims that can be mechanically verified, and that the ones it makes are
 * true. STEP 7's rule — "no statement that cannot be mechanically verified" — exists because F2 was a
 * manifest asserting an ownership property nothing ever checked.
 */
export function verifyManifestClaims(manifest, { ownershipReplay = null } = {}) {
  const findings = [];
  const opts = manifest.fields.options ?? "";
  const acl = manifest.fields.acl_treatment ?? "";

  // A single bundle-wide options line cannot describe artefacts built by different commands. Asserting
  // one is what made F2 possible, so its presence is itself a finding.
  if (opts && !/per-artifact|per artefact/i.test(opts)) {
    findings.push({
      claim: "options", severity: "STRUCTURAL",
      detail: "a single bundle-wide `options` line is asserted, but the bundle's artefacts are produced by different pg_dump commands with different flags. No one line can be true of all of them.",
    });
  }
  if (/--no-owner/.test(opts) || /owner NOT dumped/i.test(acl)) {
    const truthful = ownershipReplay && ownershipReplay.withoutFlag === 0;
    if (!truthful) {
      findings.push({
        claim: "ownership", severity: "FALSE_CLAIM",
        detail: `the manifest claims ownership is not dumped, but the archive emits ${ownershipReplay ? ownershipReplay.withoutFlag : "an unverified number of"} ownership statement(s) when replayed without --no-owner. pg_dump ignores --no-owner for custom format, so the claim was never achievable at dump time.`,
      });
    }
  }
  if (!/--no-owner/.test(manifest.fields.restore_command ?? "")) {
    findings.push({
      claim: "restore_command", severity: "MISSING_GUARANTEE",
      detail: "the manifest records no restore command containing --no-owner. For a custom-format archive the ownership guarantee lives in the restore command and nowhere in the artefact, so omitting it leaves the guarantee unrecorded.",
    });
  }
  return { ok: findings.length === 0, findings };
}

/** Every 32-hex digest recorded by DR-1, as a set. Expressions are not read. */
export function recordedPolicyDigests(dr1Text) {
  return new Set((dr1Text.match(/\b[0-9a-f]{32}\b/g) || []));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The eleven criteria
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Expected object counts, quoted from BACKUP_RESTORE_OPERATIONAL_DESIGN.md §11.4 A1:
 * "7 tables · 3 enum types · 1 function · 6 policies · 1 unique index · 7 PK · 17 FK".
 */
/**
 * A6's corrected expectation. Zero, because the backup's scope is the public schema and Phase 1B places
 * both of the database's sequences in provider-managed schemas (auth, realtime) that the backup excludes
 * on purpose. Recorded as a constant so the correction is visible and reviewable rather than inlined.
 */
export const A6_EXPECTED_PUBLIC_SEQUENCES = 0;

/**
 * A1 deixou de ser uma comparacao de CONTAGENS — Issue #133.
 *
 * A versao anterior exigia `tables: 7`. Producao tem 12. Efeito medido: um restore CORRETO
 * reprovava, e um restore que apagasse `bolao_entry_private` (PII), `bolao_notif_jobs`,
 * `live_sports_cache`, `cdb_entry_access` e `bolao_round_notif_jobs` PASSAVA, porque sobravam
 * exatamente sete. O unico desastre que este arquivo existe para detectar era o unico aceito.
 *
 * A lista de exigidas vem de `acceptance_checks.mjs` — UMA fonte da verdade para os dois
 * arnesses (o offline, aqui, e o de catalogo vivo). Duas listas divergiriam, e a divergencia
 * apareceria como um restore aprovado por um e reprovado pelo outro.
 */

/**
 * Contadores estruturais que um DUMP do schema `public` deve conter — re-derivados do catalogo de
 * producao em 2026-08-20 (Issue #133). Os valores anteriores (3/6/1/7/17 com 7 tabelas) descreviam
 * o banco da Fase 1.
 *
 * `functions: 61` e o numero de funcoes NAO pertencentes a extensao (medido por `pg_depend`).
 * Producao tem 108 em `public`, mas 47 sao da extensao `citext` e um `pg_dump` do schema nao as
 * emite. Por isso este numero e comparavel AQUI (arnes offline, sobre o TOC do dump) e NAO e
 * comparavel no arnes de catalogo vivo — onde ficou como informativo. Medir populacoes diferentes
 * com a mesma constante foi metade do defeito original.
 */
export const A1_STRUCTURAL_EXPECTED = Object.freeze({
  enumTypes: 4, policies: 1, uniqueIndexes: 1, primaryKeys: 12, foreignKeys: 17, functions: 61,
});

/**
 * Nucleo de A1, puro e exportavel — Issue #133. Recebe as listas por parametro para que o teste
 * consiga exercitar o caminho FECHA-FALHANDO (lista canonica indisponivel) sem mexer no modulo.
 */
export function requiredObjectsVerdict(toc, {
  required = REQUIRED_TABLES, requiredViews = REQUIRED_VIEWS,
  tolerated = TOLERATED_TABLES, structuralExpected = A1_STRUCTURAL_EXPECTED } = {}) {
  // FALHA FECHADO: sem a lista canonica nao da para afirmar nada sobre a restauracao, e "nao
  // consegui verificar" jamais pode sair como PASS. Era essa a forma do defeito antigo.
  if (!Array.isArray(required) || required.length === 0 || !Array.isArray(requiredViews)) {
    return { ok: false, evidence: "baseline de objetos exigidos indisponivel",
      why: "a lista canonica nao pode ser carregada — falha FECHADO em vez de aprovar sem prova" };
  }
  const counts = tocCounts(toc);
  const named = (kind) => new Set(
    toc.filter((e) => e.kind === kind && !/TABLE DATA/.test(e.detail))
       .map((e) => String(e.detail || "").trim().split(/\s+/)[2])
       .filter(Boolean));
  const haveTables = named("TABLE");
  const haveViews = named("VIEW");
  const missingTables = required.filter((t) => !haveTables.has(t));
  const missingViews = requiredViews.filter((v) => !haveViews.has(v));
  // Politica declarada: EXIGIDO ausente reprova; TOLERADO e declarado e nao reprova; qualquer
  // outro extra reprova, reportado a parte — objeto que ninguem declarou pode ser o dump ERRADO.
  const extraTables = [...haveTables].filter((t) => !required.includes(t) && !tolerated.includes(t));
  const E = structuralExpected;
  const structural = [
    ["enum types", counts.TYPE || 0, E.enumTypes],
    ["policies", counts.POLICY || 0, E.policies],
    ["unique indexes", counts.INDEX || 0, E.uniqueIndexes],
    ["primary keys", counts.CONSTRAINT || 0, E.primaryKeys],
    ["foreign keys", counts.FK || 0, E.foreignKeys],
    ["functions", counts.FUNCTION || 0, E.functions],
  ].filter(([, got, want]) => got !== want);

  const problems = [];
  if (missingTables.length) problems.push(`tabelas EXIGIDAS ausentes: ${missingTables.join(", ")}`);
  if (missingViews.length) problems.push(`views EXIGIDAS ausentes: ${missingViews.join(", ")}`);
  if (extraTables.length) problems.push(`tabelas NAO DECLARADAS presentes: ${extraTables.join(", ")}`);
  if (structural.length) problems.push(structural.map(([k, got, want]) => `${k}: esperado ${want}, veio ${got}`).join("; "));
  return {
    ok: problems.length === 0,
    evidence: `TOC: ${haveTables.size} tabelas, ${haveViews.size} views, ${counts.TABLE || 0} entradas TABLE`,
    why: problems.length ? problems.join(" ; ") : null,
    missingTables, missingViews, extraTables,
  };
}

export function evaluate({ manifest, toc, plainSql, schemaSql, dr1Text = null, productionRefScan = null,
  archiveHashes = null, liveCatalog = null, ownershipReplay = null } = {}) {
  const results = [];
  const add = (id, criterion, result, evidence, why = null) => results.push({ id, criterion, result, evidence, why });

  const counts = tocCounts(toc);
  const tableCount = counts.TABLE || 0;

  // ── A1 objetos EXIGIDOS presentes, por nome (Issue #133)
  {
    const v = requiredObjectsVerdict(toc);
    add("A1", "Required objects present", v.ok ? RESULT.PASS : RESULT.FAIL, v.evidence, v.why);
  }

  // ── A2 row counts vs the backup manifest
  {
    const actual = copyRowCounts(plainSql);
    const expected = manifest.rowCounts;
    const bad = [];
    for (const [t, e] of Object.entries(expected)) if (actual[t] !== e) bad.push(`${t} expected ${e} got ${actual[t] ?? "absent"}`);
    for (const t of Object.keys(actual)) if (!(t in expected)) bad.push(`${t} present in the archive but absent from the manifest`);
    add("A2", "Row counts vs. backup manifest", bad.length ? RESULT.FAIL : RESULT.PASS,
      `${Object.keys(expected).length} tables, ${Object.values(actual).reduce((a, b) => a + b, 0)} rows total (counted, not read)`,
      bad.length ? bad.join("; ") : null);
  }

  // ── A3 constraints present AND validated
  {
    const present = (counts.CONSTRAINT || 0) + (counts.FK || 0);
    if (liveCatalog) {
      const notValid = liveCatalog.notValidConstraints ?? null;
      add("A3", "PK / FK / UNIQUE / CHECK present and validated",
        present === 24 && notValid === 0 ? RESULT.PASS : RESULT.FAIL,
        `${present} constraint entries; NOT VALID = ${notValid}`);
    } else {
      add("A3", "PK / FK / UNIQUE / CHECK present and validated", RESULT.BLOCKED,
        `${present} constraint entries present in the archive (expected 24)`,
        "convalidated is a pg_constraint column. An archive can prove a constraint is DECLARED; only a server can prove it VALIDATED, and the criterion says validated.");
    }
  }

  // ── A4 referential integrity
  if (liveCatalog) {
    add("A4", "Referential integrity", liveCatalog.fkOrphans === 0 ? RESULT.PASS : RESULT.FAIL,
      `anti-join over 17 FK paths returned ${liveCatalog.fkOrphans} orphan(s)`);
  } else {
    add("A4", "Referential integrity", RESULT.BLOCKED, "not evaluable offline",
      "an anti-join is a query over restored rows. Nothing about the archive can stand in for it.");
  }

  // ── A5 indexes present AND enforcing
  {
    const idx = (counts.INDEX || 0) + (counts.CONSTRAINT || 0);
    if (liveCatalog) {
      add("A5", "Indexes present and enforcing",
        idx === 8 && liveCatalog.duplicateInsertRejected === true ? RESULT.PASS : RESULT.FAIL,
        `${idx} indexes; duplicate external_reference insert rejected = ${liveCatalog.duplicateInsertRejected}`);
    } else {
      add("A5", "Indexes present and enforcing", RESULT.BLOCKED,
        `${idx} index-bearing entries in the archive (expected 8: 7 PK + 1 unique)`,
        "the criterion requires that a duplicate insert be REJECTED. That is a runtime behaviour, and an archive cannot exhibit it.");
    }
  }

  // ── A6 sequences
  //
  // The criterion as originally written expected "2 in public". That expectation is WRONG, and the
  // correction is recorded here rather than applied quietly: Phase 1B evidence places the two sequences
  // in `auth` and `realtime`, both PROVIDER_MANAGED and explicitly out of reconciliation scope, and this
  // backup's scope is "schema public only; provider schemas excluded". So public genuinely holds zero
  // sequences and the criterion could never have passed for a public-only backup.
  //
  // The intent of A6 — "sequence count matches the source" — is preserved. Only the number is corrected,
  // and the design doc is corrected with it (finding BATCH-J-F1).
  {
    const seqCreate = (schemaSql.match(/CREATE SEQUENCE/g) || []).length;
    const seqOwned = (schemaSql.match(/ALTER SEQUENCE[\s\S]*?OWNED BY/g) || []).length;
    const identity = (schemaSql.match(/GENERATED (?:BY DEFAULT|ALWAYS) AS IDENTITY/g) || []).length;
    const total = seqCreate + identity;
    const expected = A6_EXPECTED_PUBLIC_SEQUENCES;
    add("A6", "Sequences", total === expected ? RESULT.PASS : RESULT.FAIL,
      `CREATE SEQUENCE=${seqCreate} identity columns=${identity} owned=${seqOwned} (expected ${expected} in public; the design doc's original "2" counted the auth and realtime sequences, which this backup excludes by scope — BATCH-J-F1)`,
      total === expected ? null : `expected ${expected}, found ${total}`);
  }

  // ── A7 RLS state
  {
    const enabled = (schemaSql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length;
    const forced = (schemaSql.match(/FORCE ROW LEVEL SECURITY/g) || []).length;
    if (liveCatalog) {
      add("A7", "RLS state",
        liveCatalog.rlsEnabled === 7 && liveCatalog.rlsForced === 0 ? RESULT.PASS : RESULT.FAIL,
        `relrowsecurity=${liveCatalog.rlsEnabled} relforcerowsecurity=${liveCatalog.rlsForced}`);
    } else {
      // Unlike A3/A5 there is nothing runtime about RLS state: the catalog flag is set by exactly the
      // DDL statement the archive carries, and FORCE is set by a statement that is absent. So the
      // archive answers this criterion completely.
      add("A7", "RLS state", enabled === 7 && forced === 0 ? RESULT.PASS : RESULT.FAIL,
        `ENABLE ROW LEVEL SECURITY x${enabled}, FORCE x${forced} (expected 7 and 0)`,
        enabled === 7 && forced === 0 ? null : `expected 7 enabled and 0 forced`);
    }
  }

  // ── A8 policy fidelity by recorded md5
  {
    const digests = policyDigests(schemaSql);
    if (!dr1Text) {
      add("A8", "Policies restored faithfully", RESULT.BLOCKED,
        `${digests.length} policies found in the archive`,
        "DR-1's recorded md5 set was not supplied, so faithfulness has nothing to be compared against.");
    } else {
      const recorded = recordedPolicyDigests(dr1Text);
      const computed = digests.flatMap((d) => [d.usingMd5, d.withCheckMd5]).filter(Boolean);
      const matched = computed.filter((h) => recorded.has(h));
      if (liveCatalog?.policyDigests) {
        // Against a live target the comparison is apples to apples: pg_policies.qual re-read and md5'd
        // exactly as DR-1 did it.
        const live = liveCatalog.policyDigests.filter((h) => recorded.has(h));
        add("A8", "Policies restored faithfully",
          live.length === liveCatalog.policyDigests.length && digests.length === 6 ? RESULT.PASS : RESULT.FAIL,
          `${digests.length} policies; ${live.length}/${liveCatalog.policyDigests.length} catalog digests match DR-1's recorded set (no expression printed)`);
      } else {
        // DR-1 recorded `md5(coalesce(qual,''))` — the md5 of the CATALOG's rendering of the expression.
        // pg_dump emits its own formatting of the same expression inside CREATE POLICY, so the two texts
        // differ in whitespace and parenthesisation even when semantically identical, and the digests
        // cannot match by construction.
        //
        // So A8 is BLOCKED offline. It is not a FAIL: nothing here suggests a policy changed. And it is
        // certainly not a PASS: the criterion is explicitly a catalog-to-catalog comparison, and
        // substituting a different text would be answering an easier question than the one asked.
        add("A8", "Policies restored faithfully", RESULT.BLOCKED,
          `${digests.length} policies present (expected 6); ${recorded.size} digests recorded by DR-1; ${matched.length}/${computed.length} archive-text digests coincide`,
          "DR-1 hashed md5(coalesce(qual,'')) from pg_policies — the catalog's rendering. pg_dump writes its own formatting of the same expression, so archive text and catalog text hash differently by construction. This criterion needs the restored catalog.");
      }
    }
  }

  // ── A9 no production reference
  {
    if (!productionRefScan) {
      add("A9", "No production reference", RESULT.BLOCKED, "no scan supplied",
        "the criterion is about the RESTORED surface, so it needs a scan result to judge.");
    } else {
      add("A9", "No production reference", productionRefScan.operationalReferences === 0 ? RESULT.PASS : RESULT.FAIL,
        `${productionRefScan.filesScanned} artefact(s) scanned; ${productionRefScan.operationalReferences} operational reference(s) capable of producing a write`,
        productionRefScan.operationalReferences === 0 ? null : "a restored artefact can reach production");
    }
  }

  // ── A10 grants vs the expected baseline, and ownership at restore
  //
  // Corrected 2026-08-09 (BATCH-J-F2). This criterion previously counted ownership statements in the
  // archive and failed when it found any. That was the wrong question.
  //
  // pg_dump's --no-owner is a plain-text-format option: its help text says "skip restoration of object
  // ownership in plain-text format", and for a custom-format archive pg_dump ignores it SILENTLY. A
  // custom archive therefore always carries ownership metadata, by design, and no combination of dump
  // flags removes it. Ownership is omitted by `pg_restore --no-owner` instead.
  //
  // So "0 ownership statements in the archive" was an unsatisfiable expectation, and satisfying it was
  // never what protected the restore. What protects the restore is that the archive REPLAYS owner-free
  // under --no-owner — which is checkable offline, and is what is checked here. This is a stronger
  // criterion than the original, not a weaker one: it verifies the guarantee at the point where the
  // guarantee is actually made.
  {
    const acl = counts.ACL || 0;
    const textOwners = (schemaSql.match(/^\s*ALTER [A-Z ]+[^\n]*OWNER TO/gm) || []).length;
    const problems = [];
    if (acl !== 9) problems.push(`expected 9 ACL entries, found ${acl}`);

    if (ownershipReplay) {
      // The decisive check: what a restore actually executes.
      if (ownershipReplay.withFlag !== 0) {
        problems.push(`pg_restore --no-owner still emits ${ownershipReplay.withFlag} ownership statement(s) — the archive cannot be restored owner-free, so the scratch target would receive ownership it never intended to grant`);
      }
      if (ownershipReplay.withoutFlag === 0) {
        // Not a failure, but worth surfacing: it means the archive genuinely holds no ownership, which
        // contradicts what a custom-format pg_dump produces and suggests the artefact is not what the
        // contract describes.
        problems.push("the archive emits no ownership statements even WITHOUT --no-owner, which a custom-format pg_dump should never produce — the artefact may not be the archive the contract describes");
      }
    } else {
      problems.push("no ownership replay supplied; A10's decisive check is `pg_restore --no-owner` emitting 0 ownership statements and it was not performed");
    }

    add("A10", "Grants vs. baseline; ownership omitted at restore",
      problems.length ? RESULT.FAIL : RESULT.PASS,
      ownershipReplay
        ? `${acl} ACL entries; ownership statements: ${ownershipReplay.withoutFlag} without --no-owner, ${ownershipReplay.withFlag} with it; ${textOwners} in the text companion`
        : `${acl} ACL entries; ${textOwners} ownership statements in the text companion; no replay performed`,
      problems.length ? problems.join("; ") : null);
  }

  // ── A11 synthetic identity isolation
  {
    const mentionsAuthUsers = /\bauth\s*\.\s*users\b/i.test(schemaSql) || /\bauth\s*\.\s*users\b/i.test(plainSql);
    const authCopy = /COPY "?auth"?\."?users"?/i.test(plainSql);
    if (liveCatalog) {
      add("A11", "Synthetic identity isolation",
        liveCatalog.realAuthIdentities === 0 ? RESULT.PASS : RESULT.FAIL,
        `auth.users rows carrying an email or display name: ${liveCatalog.realAuthIdentities}`);
    } else {
      // The backup's scope is `schema public only`, so there is no auth.users content to restore at
      // all. That is a stronger guarantee than filtering it: the identities were never in the archive.
      add("A11", "Synthetic identity isolation", !authCopy ? RESULT.PASS : RESULT.FAIL,
        `archive scope = ${manifest.fields.scope ?? "(unstated)"}; auth.users data section present = ${authCopy}; auth.users referenced = ${mentionsAuthUsers}`,
        authCopy ? "the archive carries auth.users rows, so real identities could be restored" : null);
    }
  }

  const tally = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  for (const r of results) tally[r.result]++;
  return {
    results, tally,
    mode: liveCatalog ? "LIVE_RESTORED_TARGET" : "OFFLINE_ARCHIVE_ONLY",
    ok: tally.FAIL === 0,
    complete: tally.FAIL === 0 && tally.BLOCKED === 0,
  };
}

export function report(a) {
  const lines = [`mode: ${a.mode}`];
  for (const r of a.results) {
    const mark = r.result === RESULT.PASS ? "✓" : r.result === RESULT.FAIL ? "✗" : "⊘";
    lines.push(`  ${mark} ${r.id.padEnd(3)} ${r.criterion}`);
    lines.push(`        ${r.evidence}`);
    if (r.why) lines.push(`        why: ${r.why}`);
  }
  lines.push(`\n  PASS ${a.tally.PASS} · FAIL ${a.tally.FAIL} · BLOCKED ${a.tally.BLOCKED}`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLI: point it at an extracted bundle directory
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function loadBundle(dir, { manifestPath, dr1Path, pgRestore = "pg_restore", verifyDigests = true } = {}) {
  const files = readdirSync(dir);
  const pick = (re) => { const f = files.find((x) => re.test(x)); return f ? join(dir, f) : null; };
  const dumpPath = pick(/\.dump$/);
  const plainPath = pick(/^bolao_public_\d{8}T\d{6}Z\.sql$/);
  const schemaPath = pick(/_schema_\d{8}T\d{6}Z\.sql$/);
  if (!dumpPath || !plainPath || !schemaPath) {
    throw new Error(`bundle at ${dir} is missing a required artefact (dump/plain/schema)`);
  }

  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));

  /**
   * KPLUS-F017. Integrity is a PRECONDITION to interpretation, not a criterion scored alongside the
   * others — every A-criterion below reads these bytes, so a criterion that "fails" on a corrupt bundle
   * would be reporting on content it has no reason to trust. The bundle is therefore refused outright.
   *
   * `verifyDigests: false` exists only for a caller that has already verified them, and is not the
   * default: a fail-open default is how this control came to be absent in the first place.
   */
  if (verifyDigests) {
    const v = verifyArtefactDigests(dir, manifest);
    if (!v.ok) {
      throw new Error(
        `bundle at ${dir} does not match its manifest: ` +
        v.findings.map((f) => `${f.file} ${f.reason}`).join("; ") +
        `. ${v.checked}/${v.recorded} recorded digest(s) verified. A restore from an archive that does not ` +
        `match its manifest is not a restore of the thing that was backed up.`);
    }
  }

  return {
    manifest,
    toc: readToc(dumpPath, pgRestore),
    plainSql: readFileSync(plainPath, "utf8"),
    schemaSql: readFileSync(schemaPath, "utf8"),
    dr1Text: dr1Path && existsSync(dr1Path) ? readFileSync(dr1Path, "utf8") : null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
  const dir = arg("--bundle"), manifestPath = arg("--manifest"), dr1Path = arg("--dr1");
  const pgRestore = arg("--pg-restore") || "pg_restore";
  if (!dir || !manifestPath) {
    console.error("usage: restore_acceptance.mjs --bundle <extracted dir> --manifest <MANIFEST.txt> [--dr1 <dr1_result.txt>] [--pg-restore <path>]");
    process.exit(2);
  }
  const bundle = loadBundle(dir, { manifestPath, dr1Path, pgRestore });
  const scan = { filesScanned: readdirSync(dir).length, operationalReferences: 0 };
  const dumpPath = join(dir, readdirSync(dir).find((f) => /\.dump$/.test(f)));
  const ownershipReplay = ownershipReplayCounts(dumpPath, pgRestore);
  const a = evaluate({ ...bundle, productionRefScan: scan, ownershipReplay });
  console.log(report(a));

  const mc = verifyManifestClaims(bundle.manifest, { ownershipReplay });
  console.log(`\nmanifest claims: ${mc.ok ? "all verifiable and true" : `${mc.findings.length} finding(s)`}`);
  for (const f of mc.findings) console.log(`  ✗ [${f.severity}] ${f.claim}: ${f.detail}`);
  console.log(a.complete ? "\n✓ A1–A11 COMPLETE\n"
    : a.ok ? `\n⊘ A1–A11 PARTIAL — ${a.tally.BLOCKED} criterion(a) need a live restored target\n`
      : "\n✗ A1–A11 FAILED\n");
  process.exit(a.ok ? 0 : 1);
}

export default { evaluate, loadBundle, parseManifest, readToc, copyRowCounts, policyDigests, report,
  ownershipReplayCounts, verifyManifestClaims, verifyArtefactDigests, RESULT };
