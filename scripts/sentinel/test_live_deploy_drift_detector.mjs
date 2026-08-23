#!/usr/bin/env node
/**
 * Testes do detector de deriva main-vs-producao (Issue #310).
 *
 * Sem rede: a leitura de producao e INJETADA. A propriedade central destes casos e a que a #306
 * ensinou do jeito caro — "nao consegui medir" nunca pode virar "producao divergiu", e tambem
 * nunca pode virar "esta tudo bem".
 */
import assert from "node:assert/strict";
import { detectLiveDeployDrift, classificar, ESTADOS, DETECTOR_ID, MONITORED_FUNCTION } from "./detectors/live_deploy_drift.mjs";
import { liveDeployDriftFingerprint } from "./fingerprint.mjs";

let pass = 0, fail = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); pass++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
}

const detect = (esperado, vivo, alcancavel = true) => detectLiveDeployDrift({
  lerShaEsperado: () => esperado,
  observacaoViva: { alcancavel, sha: vivo },
  observedAt: "2026-08-23T00:00:00.000Z",
});

console.log("\nDetector de deriva main-vs-producao (#310)\n");
console.log("Classificacao pura:");

await test("hashes iguais => LIVE_MATCHES_EXPECTED", () => {
  assert.equal(classificar({ esperado: "abc", vivo: "abc", alcancavel: true }), ESTADOS.LIVE_MATCHES_EXPECTED);
});
await test("hashes diferentes => LIVE_DRIFT", () => {
  assert.equal(classificar({ esperado: "abc", vivo: "xyz", alcancavel: true }), ESTADOS.LIVE_DRIFT);
});
await test("producao sem o header => DEPLOY_PENDING", () => {
  assert.equal(classificar({ esperado: "abc", vivo: null, alcancavel: true }), ESTADOS.DEPLOY_PENDING);
});
await test("producao inalcancavel => UNKNOWN, mesmo que o hash 'batesse'", () => {
  assert.equal(classificar({ esperado: "abc", vivo: null, alcancavel: false }), ESTADOS.UNKNOWN);
  assert.equal(classificar({ esperado: "abc", vivo: "abc", alcancavel: false }), ESTADOS.UNKNOWN,
    "um hash lido de uma resposta que nao chegou nao vale nada");
});
await test("repositorio sem manifesto legivel => UNKNOWN, nao DRIFT", () => {
  assert.equal(classificar({ esperado: null, vivo: "xyz", alcancavel: true }), ESTADOS.UNKNOWN,
    "sem hash esperado nao ha comparacao possivel — acusar deriva seria inventar");
});

console.log("\nUNKNOWN nao vira alarme (a regra que a #306 pagou caro):");

await test("UNKNOWN NAO emite finding", async () => {
  const r = await detect("abc", null, false);
  assert.equal(r.estado, ESTADOS.UNKNOWN);
  assert.equal(r.findings.length, 0, "um alarme dizendo 'producao divergiu' sem ter medido gasta a confianca do alarme real");
});

await test("UNKNOWN tambem NAO conta como recuperacao", async () => {
  const r = await detect("abc", null, false);
  assert.equal(r.confirmedRecoveries.size, 0,
    "ausencia de medida fecharia uma Issue de deriva que continua valendo");
});

console.log("\nFindings:");

await test("LIVE_DRIFT emite exatamente um finding", async () => {
  const r = await detect("abc123", "def456");
  assert.equal(r.estado, ESTADOS.LIVE_DRIFT);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].finding_type, DETECTOR_ID);
  assert.equal(r.findings[0].status, "DETECTED");
});

await test("DEPLOY_PENDING emite finding e se distingue de DRIFT", async () => {
  const r = await detect("abc123", null);
  assert.equal(r.estado, ESTADOS.DEPLOY_PENDING);
  assert.equal(r.findings.length, 1);
  assert.ok(r.findings[0].facts.join(" ").includes("x-deploy-sha"),
    "o finding precisa dizer POR QUE nao da para saber qual codigo esta la");
});

await test("LIVE_MATCHES_EXPECTED nao emite finding e CONFIRMA recuperacao", async () => {
  const r = await detect("abc123", "abc123");
  assert.equal(r.findings.length, 0);
  assert.equal(r.confirmedRecoveries.size, 1, "recuperacao POSITIVAMENTE observada");
  assert.ok(r.confirmedRecoveries.has(liveDeployDriftFingerprint(MONITORED_FUNCTION)));
});

console.log("\nDeduplicacao:");

await test("deriva persistente por varios ciclos e o MESMO fingerprint", async () => {
  const a = await detect("abc", "old1");
  const b = await detect("abc", "old1");
  assert.equal(a.findings[0].fingerprint, b.findings[0].fingerprint);
});

await test("o fingerprint NAO muda quando main avanca", async () => {
  // Se carregasse o hash esperado, cada commit abriria uma Issue nova para o mesmo incidente.
  const a = await detect("hash-de-ontem", "producao-velha");
  const b = await detect("hash-de-hoje", "producao-velha");
  assert.equal(a.findings[0].fingerprint, b.findings[0].fingerprint,
    "um commit nao relacionado abriria uma Issue nova para a mesma deriva");
});

await test("DEPLOY_PENDING e LIVE_DRIFT compartilham fingerprint (mesmo incidente)", async () => {
  const a = await detect("abc", null);
  const b = await detect("abc", "outro");
  assert.equal(a.findings[0].fingerprint, b.findings[0].fingerprint,
    "producao ganhar o header no meio do incidente nao deve abrir uma segunda Issue");
});

console.log("\nDefault seguro:");

await test("sem observacao de producao => UNKNOWN, nao DRIFT", () => {
  // Um chamador que esqueca de passar a observacao nao pode produzir alarme falso.
  const r = detectLiveDeployDrift({ lerShaEsperado: () => "abc" });
  assert.equal(r.estado, ESTADOS.UNKNOWN);
  assert.equal(r.findings.length, 0);
  assert.equal(r.confirmedRecoveries.size, 0);
});

console.log("\nSomente leitura:");

await test("o detector nao expoe nenhum caminho de mutacao", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./detectors/live_deploy_drift.mjs", import.meta.url), "utf-8"));
  // Tokens PRECISOS. "push" cru casava com `findings.push(` — um metodo de array, nao um git push.
  // Um controle que acusa a si mesmo por coincidencia lexica nao mede nada.
  const PROIBIDOS = [
    /\bgit\s+push\b/, /--force\b/, /functions\s+deploy/, /workflow_dispatch/,
    /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i, /supabase\s+db/,
  ];
  for (const re of PROIBIDOS) {
    assert.ok(!re.test(src), `o detector contem um caminho de mutacao: ${re}`);
  }
});

await test("nenhuma credencial e lida pelo detector", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./detectors/live_deploy_drift.mjs", import.meta.url), "utf-8"));
  for (const seg of ["SERVICE_ROLE", "PASSWORD", "SUPABASE_KEY", "ACCESS_TOKEN", "apikey"]) {
    assert.ok(!src.includes(seg), `o detector referencia credencial: ${seg}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) { console.log("✗ LIVE DEPLOY DRIFT DETECTOR FAILED\n"); process.exit(1); }
console.log("✓ LIVE DEPLOY DRIFT DETECTOR OK\n");
