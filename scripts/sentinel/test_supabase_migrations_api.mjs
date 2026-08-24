#!/usr/bin/env node
/**
 * Leitura das migracoes via Management API (Issue #310-B). Sem rede: `fetchImpl` e injetado.
 *
 * O caso que domina esta suite: **401/403 nao pode virar lista vazia**. Um token errado ou sem
 * escopo devolve uma resposta perfeitamente bem formada que nao contem migracao nenhuma. Trata-la
 * como "producao nao aplicou nada" abriria alarme de deriva sobre TODAS as migracoes de uma vez —
 * um falso positivo espetacular, nascido de zero informacao.
 */
import assert from "node:assert/strict";
import {
  reduzirVersoes, classificarResposta, lerVersoesAplicadas, MIGRATIONS_URL, TOKEN_ENV,
} from "./supabase_migrations_api.mjs";

let pass = 0, fail = 0;
async function test(n, fn) {
  try { await fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
}
const resp = (status, body) => ({ status, json: async () => body });

console.log("\nMigracoes via Management API (#310-B)\n");
console.log("Reducao da resposta:");

await test("extrai apenas `version`, ordenado", () => {
  assert.deepEqual(
    reduzirVersoes([{ version: "20260822134050", name: "x", sql: "create table ..." },
                    { version: "20260821205500", name: "y", sql: "alter ..." }]),
    ["20260821205500", "20260822134050"]);
});

await test("o SQL da migracao NAO sai daqui", () => {
  const out = reduzirVersoes([{ version: "20260822134050", name: "x", statements: ["drop table users"] }]);
  assert.equal(JSON.stringify(out).includes("drop table"), false,
    "statement de schema vazou da porta de entrada para dentro do Sentinel");
});

await test("forma inesperada => null (UNKNOWN), nunca lista vazia", () => {
  for (const ruim of [null, undefined, {}, "abc", [{ nope: 1 }], [{ version: "nao-e-timestamp" }], [null]]) {
    assert.equal(reduzirVersoes(ruim), null, `entrada ${JSON.stringify(ruim)} deveria virar UNKNOWN`);
  }
});

await test("lista genuinamente vazia e ACEITA (projeto sem migracao e um estado real)", () => {
  assert.deepEqual(reduzirVersoes([]), []);
});

console.log("\nClassificacao HTTP — toda falha e UNKNOWN:");

await test("200 OK; 401/403/429/5xx/404 nao", () => {
  assert.equal(classificarResposta(200), "OK");
  assert.equal(classificarResposta(401), "UNKNOWN_AUTH");
  assert.equal(classificarResposta(403), "UNKNOWN_AUTH");
  assert.equal(classificarResposta(429), "UNKNOWN_RATE_LIMIT");
  assert.equal(classificarResposta(500), "UNKNOWN_SERVER");
  assert.equal(classificarResposta(404), "UNKNOWN_OTHER");
});

console.log("\nLeitura ponta a ponta (fetch injetado):");

await test("sem token => null, e NENHUMA requisicao e feita", async () => {
  let chamou = false;
  const out = await lerVersoesAplicadas({ token: undefined, fetchImpl: async () => { chamou = true; return resp(200, []); } });
  assert.equal(out, null);
  assert.equal(chamou, false, "tentou falar com a API sem credencial");
});

await test("401 => null (NAO lista vazia)", async () => {
  assert.equal(await lerVersoesAplicadas({ token: "t", fetchImpl: async () => resp(401, { message: "Unauthorized" }) }), null);
});

await test("403 => null — o caso do token sem o escopo certo", async () => {
  assert.equal(await lerVersoesAplicadas({ token: "t", fetchImpl: async () => resp(403, { message: "forbidden" }) }), null);
});

await test("429 tenta de novo e desiste em UNKNOWN", async () => {
  let n = 0;
  const out = await lerVersoesAplicadas({ token: "t", tentativas: 3, esperar: async () => {},
    fetchImpl: async () => { n++; return resp(429, {}); } });
  assert.equal(out, null);
  assert.equal(n, 3, "rate limit precisa de nova tentativa antes de desistir");
});

await test("429 que passa a 200 e aproveitado", async () => {
  let n = 0;
  const out = await lerVersoesAplicadas({ token: "t", tentativas: 3, esperar: async () => {},
    fetchImpl: async () => (++n < 2 ? resp(429, {}) : resp(200, [{ version: "20260101000000" }])) });
  assert.deepEqual(out, ["20260101000000"]);
});

await test("401 NAO tenta de novo (repetir nao conserta credencial)", async () => {
  let n = 0;
  await lerVersoesAplicadas({ token: "t", tentativas: 3, esperar: async () => {},
    fetchImpl: async () => { n++; return resp(401, {}); } });
  assert.equal(n, 1);
});

await test("erro de rede => null", async () => {
  assert.equal(await lerVersoesAplicadas({ token: "t", fetchImpl: async () => { throw new Error("ENOTFOUND"); } }), null);
});

await test("corpo ilegivel => null", async () => {
  assert.equal(await lerVersoesAplicadas({ token: "t",
    fetchImpl: async () => ({ status: 200, json: async () => { throw new Error("bad json"); } }) }), null);
});

console.log("\nSuperficie da credencial:");

await test("o token vai no header Authorization e em nenhum outro lugar", async () => {
  let visto = null;
  await lerVersoesAplicadas({ token: "SEGREDO", fetchImpl: async (url, opts) => { visto = { url, opts }; return resp(200, []); } });
  assert.equal(visto.url, MIGRATIONS_URL, "a URL nao pode carregar credencial");
  assert.equal(visto.url.includes("SEGREDO"), false, "token na URL vazaria em log de acesso");
  assert.equal(visto.opts.headers.Authorization, "Bearer SEGREDO");
});

await test("o modulo nao referencia credencial ampla nenhuma", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("./supabase_migrations_api.mjs", import.meta.url), "utf-8");
  for (const proibido of ["SERVICE_ROLE", "service_role", "PASSWORD", "postgres:", "anon", "SUPABASE_KEY"]) {
    assert.ok(!src.includes(proibido), `referencia credencial ampla: ${proibido}`);
  }
  assert.ok(src.includes("database_migrations_read"), "o escopo minimo pretendido precisa estar escrito");
});

await test("a chave PostgREST do ADR-019 nao e mais lida em lugar nenhum", async () => {
  const fs = await import("node:fs");
  const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf-8");
  assert.ok(!run.includes("SENTINEL_MIGRATION_READ_KEY"),
    "a rota antiga sobreviveu — duas formas de ler a mesma coisa divergem no primeiro dia");
  assert.ok(TOKEN_ENV === "SENTINEL_SUPABASE_MGMT_TOKEN");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ LEITURA DE MIGRACOES REPROVADA\n"); process.exit(1); }
console.log("✓ LEITURA DE MIGRACOES OK\n");
