/**
 * test_cache_poisoning.mjs — CACHE_POISON_REJECTED (F9).
 *
 * O conteúdo persistido do gateway é tratado como ENTRADA NÃO CONFIÁVEL. A checagem anterior
 * aceitava qualquer coisa dentro de `matches` desde que `schemaVersion === 1` — e esse número
 * prova apenas que alguém escreveu 1. Enquanto a escrita anônima em `live_sports_cache` não
 * estiver negada (F8, bloqueado por credencial), esta validação é a única barreira no cliente.
 *
 * Regra sob teste: cache inválido é REJEITADO e provoca fallback seguro. Nunca é convertido em
 * lista vazia de partidas — lista vazia significa "sabemos que não há jogo", afirmação forte e
 * falsa nesse caso.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = readFileSync(join(ROOT, "bolao/shared/js/football_live_store.js"), "utf8");
const sandbox = {};
new Function("globalThis", "window", src).call(sandbox, sandbox, undefined);
const S = sandbox.BOLAO_FOOTBALL_LIVE;

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const okMatch = { id: "401841187", state: "post", completed: true,
                  statusName: "STATUS_FULL_TIME", homeScore: 2, awayScore: 0,
                  date: "2026-08-09T22:30Z" };
const good = { schemaVersion: 1, competition: "bra.1", observedAt: "2026-08-09T23:00:00Z",
               matches: [okMatch] };

console.log("CACHE_POISON_REJECTED — payload persistido como entrada não confiável\n");

check("payload legítimo é aceito", S.validateGatewayBody(good, "bra.1").ok);

const poisons = [
  ["schemaVersion desconhecida", { ...good, schemaVersion: 99 }],
  ["schemaVersion ausente", { ...good, schemaVersion: undefined }],
  ["corpo não é objeto", "isto nao e json de verdade"],
  ["corpo nulo", null],
  ["matches não é array", { ...good, matches: { "0": okMatch } }],
  ["matches com objeto arbitrário", { ...good, matches: [{ qualquer: "coisa" }] }],
  ["matches com string solta", { ...good, matches: ["<script>alert(1)</script>"] }],
  ["matches com null", { ...good, matches: [null] }],
  ["matches aninhado", { ...good, matches: [[okMatch]] }],
  ["id ausente", { ...good, matches: [{ ...okMatch, id: undefined }] }],
  ["id vazio", { ...good, matches: [{ ...okMatch, id: "" }] }],
  ["id duplicado", { ...good, matches: [okMatch, { ...okMatch }] }],
  ["state fora do contrato", { ...good, matches: [{ ...okMatch, state: "CANCELADO_PELO_ATACANTE" }] }],
  ["completed não booleano", { ...good, matches: [{ ...okMatch, completed: "sim" }] }],
  ["postponed não booleano", { ...good, matches: [{ ...okMatch, postponed: 1 }] }],
  ["statusName não textual", { ...good, matches: [{ ...okMatch, statusName: { a: 1 } }] }],
  ["placar negativo", { ...good, matches: [{ ...okMatch, homeScore: -5 }] }],
  ["placar absurdo", { ...good, matches: [{ ...okMatch, homeScore: 100000 }] }],
  ["placar NaN", { ...good, matches: [{ ...okMatch, homeScore: NaN }] }],
  ["placar textual inválido", { ...good, matches: [{ ...okMatch, awayScore: "muitos" }] }],
  ["observedAt ausente", { ...good, observedAt: undefined }],
  ["observedAt inválido", { ...good, observedAt: "ontem à tarde" }],
  ["date não textual", { ...good, matches: [{ ...okMatch, date: 12345 }] }],
];

for (const [name, body] of poisons) {
  const r = S.validateGatewayBody(body, "bra.1");
  check(`rejeita: ${name}`, r.ok === false, `aceito com reason=${r.reason}`);
}

// Competição cruzada — dado de outro torneio servido no lugar certo.
{
  const r = S.validateGatewayBody({ ...good, competition: "bra.2" }, "bra.1");
  check("rejeita competição divergente", r.ok === false, `reason=${r.reason}`);
}

// `matches: null` é legítimo: a fonte declarando que NÃO SABE. Diferente de poluído.
{
  const r = S.validateGatewayBody({ ...good, matches: null }, "bra.1");
  check("matches:null continua válido (fonte não sabe ≠ payload poluído)",
        r.ok === true && r.matches === null);
}

// O ponto central: inválido não vira lista vazia.
{
  const r = S.validateGatewayBody({ ...good, matches: [{ lixo: true }] }, "bra.1");
  check("payload inválido NÃO é convertido em lista vazia de partidas",
        r.ok === false && !Array.isArray(r.matches), `matches=${JSON.stringify(r.matches)}`);
}

// E o store, ponta a ponta: cache envenenado não vira estado.
{
  const store = S.createStore({
    competition: "bra.1",
    gatewayUrl: "https://example.invalid/live",
    fetch: async () => ({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, observedAt: "2026-08-09T23:00:00Z",
                           matches: [{ id: "x", state: "AO_VIVO_FALSO", completed: "talvez" }] }) }),
  });
  await store.refresh();
  const st = store.getState();
  store.stop();
  check("store rejeita cache envenenado e não expõe estado ao vivo",
        st.state !== "LIVE_FRESH" && String(st.health.lastError).startsWith("CACHE_INVALIDO"),
        `state=${st.state} err=${st.health.lastError}`);
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
