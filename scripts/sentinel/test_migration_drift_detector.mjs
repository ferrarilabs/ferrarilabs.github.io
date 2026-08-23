#!/usr/bin/env node
/**
 * Testes do detector de deriva de MIGRACAO (Issue #310-B).
 *
 * Sem rede e sem banco: a lista de versoes aplicadas e injetada. A propriedade central e a mesma
 * que a #306 ensinou caro — "nao consegui medir" nao pode virar nem alarme nem alta medica.
 */
import assert from "node:assert/strict";
import {
  detectMigrationDrift, classificar, ESTADOS, DETECTOR_ID,
  JANELA_DE_DEPLOY_MS, NOME_DE_MIGRACAO,
} from "./detectors/migration_drift.mjs";
import { migrationDriftFingerprint } from "./fingerprint.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                          catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };

const VELHA = JANELA_DE_DEPLOY_MS + 60_000;
const NOVA = 60_000;
const det = (noRepo, aplicadas, idade = VELHA) => detectMigrationDrift({
  lerMigracoesDoRepo: () => ({ versoes: noRepo, idadeMs: () => idade }),
  lerAplicadas: () => aplicadas,
  observedAt: "2026-08-23T00:00:00.000Z",
});

console.log("\nDeriva de migracao (#310-B)\n");
console.log("Classificacao:");

test("tudo aplicado => MIGRATIONS_MATCH", () => {
  assert.equal(classificar({ noRepo: ["1", "2"], aplicadas: ["1", "2"] }).estado, ESTADOS.MIGRATIONS_MATCH);
});

test("pendente ha pouco tempo => DEPLOY_PENDING (janela legitima)", () => {
  const r = classificar({ noRepo: ["1", "2"], aplicadas: ["1"], idadeMs: () => NOVA });
  assert.equal(r.estado, ESTADOS.DEPLOY_PENDING);
  assert.deepEqual(r.pendentes, ["2"]);
});

test("pendente ha muito tempo => LIVE_DRIFT", () => {
  const r = classificar({ noRepo: ["1", "2"], aplicadas: ["1"], idadeMs: () => VELHA });
  assert.equal(r.estado, ESTADOS.LIVE_DRIFT);
});

test("sem leitura de producao => UNKNOWN", () => {
  assert.equal(classificar({ noRepo: ["1"], aplicadas: null }).estado, ESTADOS.UNKNOWN);
});

test("idade desconhecida conta como VELHA (nao adia alarme indefinidamente)", () => {
  const r = classificar({ noRepo: ["1", "2"], aplicadas: ["1"], idadeMs: () => null });
  assert.equal(r.estado, ESTADOS.LIVE_DRIFT);
});

test("migracao aplicada AUSENTE do repo e reportada como orfa", () => {
  const r = classificar({ noRepo: ["1"], aplicadas: ["1", "9"] });
  assert.deepEqual(r.orfas, ["9"]);
  assert.equal(r.estado, ESTADOS.MIGRATIONS_MATCH, "orfa nao e pendencia — e informacao, nao alarme");
});

console.log("\nUNKNOWN nao e saudavel nem doente:");

test("UNKNOWN nao emite finding", () => {
  const r = det(["1", "2"], null);
  assert.equal(r.estado, ESTADOS.UNKNOWN);
  assert.equal(r.findings.length, 0);
});

test("UNKNOWN tambem NAO confirma recuperacao", () => {
  const r = det(["1", "2"], null);
  assert.equal(r.confirmedRecoveries.size, 0,
    "sem credencial, declarar saude fecharia uma Issue de deriva que continua valendo");
});

test("o default de runOnce e null (UNKNOWN), nao lista vazia", () => {
  // Lista vazia significaria "producao nao aplicou NADA" — uma afirmacao forte a partir de zero
  // medicao, e o caminho classico para um detector virar falso-verde ao contrario.
  const r = detectMigrationDrift({
    lerMigracoesDoRepo: () => ({ versoes: ["1"], idadeMs: () => VELHA }),
    lerAplicadas: () => null,
  });
  assert.equal(r.estado, ESTADOS.UNKNOWN);
});

console.log("\nFindings e deduplicacao:");

test("LIVE_DRIFT emite exatamente um finding, listando as pendentes", () => {
  const r = det(["1", "2", "3"], ["1"]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].finding_type, DETECTOR_ID);
  assert.ok(r.findings[0].facts.join(" ").includes("2, 3"));
});

test("MIGRATIONS_MATCH confirma recuperacao e nao emite finding", () => {
  const r = det(["1"], ["1"]);
  assert.equal(r.findings.length, 0);
  assert.equal(r.confirmedRecoveries.size, 1);
  assert.ok(r.confirmedRecoveries.has(migrationDriftFingerprint()));
});

test("DEPLOY_PENDING nao alarma E nao declara saude", () => {
  const r = det(["1", "2"], ["1"], NOVA);
  assert.equal(r.findings.length, 0, "alarmar em toda release seria um alarme que alguem desliga");
  assert.equal(r.confirmedRecoveries.size, 0, "ainda ha migracao nao aplicada — isso nao e saude");
});

test("acumular mais migracoes pendentes NAO abre Issue nova", () => {
  const a = det(["1", "2"], ["1"]);
  const b = det(["1", "2", "3", "4"], ["1"]);
  assert.equal(a.findings[0].fingerprint, b.findings[0].fingerprint,
    "o pipeline parado e o MESMO incidente; cada merge novo nao pode abrir uma Issue");
});

console.log("\nO caso real da #306:");

test("reproduz a #306: migracao no disco, ausente de schema_migrations", () => {
  const r = det(["20260821205500", "20260822110933", "20260822134050"],
                ["20260821205500", "20260822110933"]);
  assert.equal(r.estado, ESTADOS.LIVE_DRIFT);
  assert.deepEqual(r.pendentes, ["20260822134050"]);
  assert.ok(r.findings[0].facts.join(" ").includes("#306"));
});

console.log("\nSomente leitura:");

test("nenhum caminho de mutacao nem credencial ampla no detector", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("./detectors/migration_drift.mjs", import.meta.url), "utf-8");
  for (const re of [/\bgit\s+push\b/, /supabase\s+db/, /migration\s+up/, /SERVICE_ROLE/, /PASSWORD/,
                    /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i]) {
    assert.ok(!re.test(src), `o detector contem caminho proibido: ${re}`);
  }
});

test("o padrao de nome so aceita migracao que o Supabase aplica", () => {
  assert.ok(NOME_DE_MIGRACAO.test("20260822134050_powerball_payment_system_of_record.sql"));
  assert.ok(!NOME_DE_MIGRACAO.test("BASELINE_current_production_state.reference.sql"),
    "um arquivo que o Supabase nunca aplica viraria pendencia eterna");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) { console.log("✗ MIGRATION DRIFT DETECTOR FAILED\n"); process.exit(1); }
console.log("✓ MIGRATION DRIFT DETECTOR OK\n");
