/**
 * test_live_store_lifecycle.mjs — gates adversariais do FootballLiveStore.
 *
 * STOP_DURING_INFLIGHT_REFRESH  (F14)
 * TERMINAL_STATE_NON_REGRESSION (F15)
 *
 * Os dois defeitos que estes testes travam são de CORRIDA e de ORDEM — nenhum deles aparece
 * num teste que só chama métodos em sequência feliz. Por isso o fetch aqui é controlado à mão:
 * o teste decide o instante exato em que a resposta em voo resolve, que é onde o bug vive.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// O módulo é um IIFE de navegador (sem import/export). Carrega no escopo global como o browser faz.
const src = readFileSync(join(ROOT, "bolao/shared/js/football_live_store.js"), "utf8");
const sandbox = {};
new Function("globalThis", "window", src).call(sandbox, sandbox, undefined);
const Store = sandbox.BOLAO_FOOTBALL_LIVE;

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

function match(id, over) {
  return Object.assign({ id, state: "in", completed: false, statusName: "STATUS_FIRST_HALF", date: "2026-08-09T22:00Z" }, over || {});
}
function gatewayBody(matches, observedAt) {
  return { schemaVersion: 1, status: "OK", observedAt, matches, stale: false };
}

// ─── STOP_DURING_INFLIGHT_REFRESH ────────────────────────────────────────────────────────────
{
  console.log("\nSTOP_DURING_INFLIGHT_REFRESH");

  let timers = 0;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const handles = new Set();
  globalThis.setTimeout = (fn, ms) => { timers++; const h = realSetTimeout(fn, ms); handles.add(h); return h; };
  globalThis.clearTimeout = (h) => { if (handles.delete(h)) timers--; return realClearTimeout(h); };

  let resolveInflight;
  const inflight = new Promise((res) => { resolveInflight = res; });

  const store = Store.createStore({
    competition: "bra.1",
    gatewayUrl: "https://example.invalid/live",
    fetch: async () => {
      await inflight;                       // segura a resposta: refresh fica EM VOO
      return { ok: true, status: 200, json: async () => gatewayBody([match("1")], "2026-08-09T22:00:00Z") };
    },
  });

  store.start();
  store.stop();                             // stop ANTES da resposta chegar
  resolveInflight();                        // agora a resposta em voo resolve
  await new Promise((r) => realSetTimeout(r, 20));

  check("stop() antes da resposta: nenhum timer agendado depois", timers === 0, `timers=${timers}`);
  // Um listener que continua inscrito depois do stop mantém viva a árvore inteira do consumidor
  // (closure sobre nós de DOM já descartados). O teste tem de PROVAR que nada mais é notificado.
  let notified = 0;
  const s2 = Store.createStore({
    competition: "x",
    gatewayUrl: "https://example.invalid/live",
    fetch: async () => ({ ok: true, status: 200, json: async () => gatewayBody([match("9")], "2026-08-09T23:00:00Z") }),
  });
  s2.subscribe(() => notified++);
  s2.stop();
  await s2.refresh();   // uma observação nova chegando DEPOIS do stop
  check("stop() zera os listeners: nenhuma notificação após stop", notified === 0, `notificacoes=${notified}`);

  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

// ─── TERMINAL_STATE_NON_REGRESSION ───────────────────────────────────────────────────────────
{
  console.log("\nTERMINAL_STATE_NON_REGRESSION");

  function storeWithSeq(responses) {
    let i = 0;
    return Store.createStore({
      competition: "bra.1",
      gatewayUrl: "https://example.invalid/live",
      fetch: async () => ({ ok: true, status: 200, json: async () => responses[Math.min(i++, responses.length - 1)] }),
    });
  }

  // FINAL(t1) -> LIVE mais NOVO(t2): o ciclo de vida NÃO pode voltar.
  {
    const s = storeWithSeq([
      gatewayBody([match("1", { state: "post", completed: true, statusName: "STATUS_FULL_TIME" })], "2026-08-09T22:05:00Z"),
      gatewayBody([match("1", { state: "in", completed: false, statusName: "STATUS_SECOND_HALF" })], "2026-08-09T22:06:00Z"),
    ]);
    await s.refresh();
    const afterFinal = s.getState().state;
    await s.refresh();
    const afterContradiction = s.getState().state;
    s.stop();
    check("FINAL(t1) -> LIVE(t2 mais novo) = rejeitado", afterFinal === "FINAL" && afterContradiction === "FINAL",
      `t1=${afterFinal} t2=${afterContradiction}`);
  }

  // FINAL -> observação mais nova com PRE
  {
    const s = storeWithSeq([
      gatewayBody([match("1", { state: "post", completed: true, statusName: "STATUS_FULL_TIME" })], "2026-08-09T22:05:00Z"),
      gatewayBody([match("1", { state: "pre", completed: false, statusName: "STATUS_SCHEDULED" })], "2026-08-09T22:07:00Z"),
    ]);
    await s.refresh(); await s.refresh();
    const st = s.getState().state; s.stop();
    check("FINAL -> PRE = rejeitado", st === "FINAL", `estado=${st}`);
  }

  // FINAL -> observação mais nova com HALFTIME
  {
    const s = storeWithSeq([
      gatewayBody([match("1", { state: "post", completed: true, statusName: "STATUS_FULL_TIME" })], "2026-08-09T22:05:00Z"),
      gatewayBody([match("1", { state: "in", completed: false, statusName: "STATUS_HALFTIME" })], "2026-08-09T22:08:00Z"),
    ]);
    await s.refresh(); await s.refresh();
    const st = s.getState().state; s.stop();
    check("FINAL -> HALFTIME = rejeitado", st === "FINAL", `estado=${st}`);
  }

  // Observação ATRASADA com LIVE (a proteção que já existia) continua funcionando.
  {
    const s = storeWithSeq([
      gatewayBody([match("1", { state: "post", completed: true, statusName: "STATUS_FULL_TIME" })], "2026-08-09T22:05:00Z"),
      gatewayBody([match("1", { state: "in", completed: false, statusName: "STATUS_SECOND_HALF" })], "2026-08-09T22:01:00Z"),
    ]);
    await s.refresh(); await s.refresh();
    const st = s.getState().state; s.stop();
    check("FINAL -> LIVE mais VELHO = rejeitado (regra de timestamp)", st === "FINAL", `estado=${st}`);
  }

  // CORREÇÃO LEGÍTIMA: depois do FINAL o provedor corrige o placar. O fato muda, o ciclo não.
  {
    const s = storeWithSeq([
      gatewayBody([match("1", { state: "post", completed: true, statusName: "STATUS_FULL_TIME", homeScore: 1, awayScore: 0 })], "2026-08-09T22:05:00Z"),
      gatewayBody([match("1", { state: "post", completed: true, statusName: "STATUS_FULL_TIME", homeScore: 2, awayScore: 0 })], "2026-08-09T22:30:00Z"),
    ]);
    await s.refresh(); await s.refresh();
    const st = s.getState();
    const m = (st.matches || []).find((x) => x.id === "1");
    s.stop();
    check("correção de placar APÓS FINAL é aceita (fato muda, ciclo não)",
      st.state === "FINAL" && m && m.homeScore === 2, `estado=${st.state} placar=${m && m.homeScore}`);
  }

  // Adiado também é terminal e também não regride.
  {
    const s = storeWithSeq([
      gatewayBody([match("1", { postponed: true, statusName: "STATUS_POSTPONED", state: "post" })], "2026-08-09T18:00:00Z"),
      gatewayBody([match("1", { state: "in", completed: false, statusName: "STATUS_FIRST_HALF" })], "2026-08-09T19:00:00Z"),
    ]);
    await s.refresh(); await s.refresh();
    const st = s.getState().state; s.stop();
    check("POSTPONED -> LIVE mais novo = rejeitado", st === "POSTPONED", `estado=${st}`);
  }
}

// ─── HIERARQUIA DE FONTES: o store e dono do fallback de snapshot (F12) ──────────────────────
{
  console.log("\nSOURCE_HIERARCHY_OWNED_BY_STORE");

  const snapBody = {
    schemaVersion: 1, generatedAt: "2026-08-09T22:00:00Z", staleReason: null,
    matches: [match("77", { state: "in", statusName: "STATUS_FIRST_HALF" })],
  };

  // Gateway 500 -> cai para o snapshot, sem o app decidir nada.
  {
    const s = Store.createStore({
      competition: "bra.1", gatewayUrl: "https://example.invalid/live",
      snapshotUrl: "https://example.invalid/snapshot.json",
      fetch: async (url) => url.includes("snapshot")
        ? { ok: true, status: 200, json: async () => snapBody }
        : { ok: false, status: 500, json: async () => ({}) },
    });
    await s.refresh();
    const st = s.getState(); s.stop();
    check("gateway 500 -> store cai sozinho para o snapshot",
      st.source === "snapshot" && st.state !== "SOURCE_UNAVAILABLE", `source=${st.source} state=${st.state}`);
  }

  // Gateway lanca excecao -> mesmo caminho.
  {
    const s = Store.createStore({
      competition: "bra.1", gatewayUrl: "https://example.invalid/live",
      snapshotUrl: "https://example.invalid/snapshot.json",
      fetch: async (url) => {
        if (url.includes("snapshot")) return { ok: true, status: 200, json: async () => snapBody };
        throw new Error("rede caiu");
      },
    });
    await s.refresh();
    const st = s.getState(); s.stop();
    check("excecao de rede no gateway -> snapshot", st.source === "snapshot", `source=${st.source}`);
  }

  // O snapshot herda a monotonicidade: nao ressuscita jogo encerrado.
  {
    const s = Store.createStore({
      competition: "bra.1", gatewayUrl: "https://example.invalid/live",
      snapshotUrl: "https://example.invalid/snapshot.json",
      fetch: (() => {
        let n = 0;
        return async (url) => {
          if (url.includes("snapshot")) {
            return { ok: true, status: 200, json: async () => ({
              schemaVersion: 1, generatedAt: "2026-08-09T23:00:00Z",
              matches: [match("77", { state: "in", statusName: "STATUS_SECOND_HALF" })] }) };
          }
          n++;
          if (n === 1) {
            return { ok: true, status: 200, json: async () => gatewayBody(
              [match("77", { state: "post", completed: true, statusName: "STATUS_FULL_TIME" })],
              "2026-08-09T22:30:00Z") };
          }
          return { ok: false, status: 500, json: async () => ({}) };
        };
      })(),
    });
    await s.refresh();              // gateway: FINAL
    await s.refresh();              // gateway falha -> snapshot diz "ao vivo", mais novo
    const st = s.getState(); s.stop();
    check("snapshot mais novo NAO ressuscita jogo encerrado", st.state === "FINAL", `state=${st.state}`);
  }

  // Snapshot malformado nao vira observacao.
  {
    const s = Store.createStore({
      competition: "bra.1", gatewayUrl: "https://example.invalid/live",
      snapshotUrl: "https://example.invalid/snapshot.json",
      fetch: async (url) => url.includes("snapshot")
        ? { ok: true, status: 200, json: async () => ({ schemaVersion: 1, generatedAt: "x", matches: [{ lixo: 1 }] }) }
        : { ok: false, status: 500, json: async () => ({}) },
    });
    await s.refresh();
    const st = s.getState(); s.stop();
    check("snapshot malformado e rejeitado, nao promovido",
      st.source !== "snapshot", `source=${st.source} err=${st.health.lastError}`);
  }
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
