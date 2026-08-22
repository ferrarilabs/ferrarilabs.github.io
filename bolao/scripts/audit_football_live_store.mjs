#!/usr/bin/env node
/**
 * FOOTBALL LIVE STORE — os cenários de aceitação que definem o LIVE DATA PLANE V2.
 *
 * O hero sumiu QUATRO vezes por QUATRO causas. A investigação achou a raiz estrutural: 21 pontos
 * no código decidiam independentemente se uma partida estava ao vivo. Não havia uma decisão para
 * consertar — havia vinte e uma, e consertar uma deixava as outras vinte.
 *
 * Cada teste aqui corresponde a um cenário de aceitação, não a um detalhe de implementação.
 * Nenhum toca a rede: o transporte é injetado.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sb = {};
new Function("globalThis","window",readFileSync(join(ROOT,"bolao/shared/js/football_live_store.js"),"utf8")).call(sb,sb,undefined);
const { createStore, isLiveMatch, STATE, SOURCE } = sb.BOLAO_FOOTBALL_LIVE;

let pass=0, fail=0;
async function test(n,f){ try{ await f(); console.log(`  ✓ ${n}`); pass++; }catch(e){ console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } }
const assert=(c,m)=>{ if(!c) throw new Error(m); };
const eq=(a,b,m)=>{ if(a!==b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const T0 = 1_800_000_000_000;
const liveAt = (min, obsOffsetMs=0, over={}) => ({
  schemaVersion:1, observedAt:new Date(T0-obsOffsetMs).toISOString(), stale:false, staleReason:null,
  matches:[{ id:"m1", state:"in", homeTeam:"Cruzeiro", awayTeam:"Mirassol", homeScore:1, awayScore:1,
             clockSec:min*60, clockStr:`${min}'`, period:2, date:new Date(T0-min*60000).toISOString(), ...over }],
});
const mk = (resp, nowFn) => {
  let clock = T0;
  const store = createStore({ competition:"br2026", gatewayUrl:"https://gw.test/fn",
    now: nowFn || (()=>clock), fetch: async()=>resp() });
  return { store, setNow:(t)=>{clock=t;} };
};
const okResp = (body,status=200)=>({ ok:status<400, status, json:async()=>body });

console.log("\nFootball Live Store — cenários de aceitação\n");

// ── A decisão única ──
console.log("Decisão canônica:");
await test("isLiveMatch é a ÚNICA decisão: `in` é vivo, terminal não é", ()=>{
  eq(isLiveMatch({state:"in"}), true, "in");
  eq(isLiveMatch({state:"post"}), false, "post");
  eq(isLiveMatch({state:"pre"}), false, "pre");
  eq(isLiveMatch({state:"in", completed:true}), false, "in+completed é terminal");
  eq(isLiveMatch({state:"in", postponed:true}), false, "adiado nunca é ao vivo");
  eq(isLiveMatch(null), false, "nulo");
});

// ── FIRST_VISIT_MID_MATCH ──
console.log("\nFIRST_VISIT_MID_MATCH (o caso que a arquitetura antiga não resolvia):");
await test("navegador NOVO, sem histórico, snapshot velho → hero do gateway", async()=>{
  const { store } = mk(()=>okResp(liveAt(48)));
  // Snapshot commitado com 3 HORAS, dizendo que nada começou.
  store.seedFromSnapshot({ generatedAt:new Date(T0-3*3600_000).toISOString(),
    matches:[{id:"m1",state:"pre",homeTeam:"Cruzeiro",awayTeam:"Mirassol",homeScore:0,awayScore:0}] });
  eq(store.getState().state, STATE.NO_LIVE_MATCH, "com só o snapshot velho não há jogo ao vivo");
  await store.refresh();
  const s = store.getState();
  eq(s.state, STATE.LIVE_FRESH, "o gateway não trouxe o jogo ao vivo");
  eq(s.source, SOURCE.GATEWAY, "fonte");
  eq(s.match.clockSec, 48*60, "minuto");
});

// ── NO_SCHEDULER_3_HOURS ──
await test("NO_SCHEDULER_3_HOURS: snapshot parado 3h não impede a experiência ao vivo", async()=>{
  const { store } = mk(()=>okResp(liveAt(62)));
  store.seedFromSnapshot({ generatedAt:new Date(T0-3*3600_000).toISOString(), matches:[] });
  await store.refresh();
  eq(store.getState().state, STATE.LIVE_FRESH, "o agendador parado quebrou o ao vivo");
});

// ── NO_DEPLOY_SCORE_UPDATE ──
await test("NO_DEPLOY_SCORE_UPDATE: placar muda sem commit nem deploy", async()=>{
  let body = liveAt(48);
  const { store } = mk(()=>okResp(body));
  await store.refresh();
  eq(store.getState().match.homeScore, 1, "placar inicial");
  body = { ...liveAt(51), matches:[{...liveAt(51).matches[0], homeScore:2}] };
  body.observedAt = new Date(T0+60_000).toISOString();
  await store.refresh();
  eq(store.getState().match.homeScore, 2, "o placar não atualizou sem deploy");
});

// ── OUT_OF_ORDER ──
console.log("\nMonotonicidade:");
await test("OUT_OF_ORDER: resposta atrasada com minuto MENOR não retrocede", async()=>{
  const { store } = mk(()=>okResp(liveAt(48)));
  await store.refresh();
  const antiga = liveAt(63); antiga.observedAt = new Date(T0-30_000).toISOString();
  antiga.matches[0].clockSec = 63*60;
  store._ingest({ matches:antiga.matches, observedAt:antiga.observedAt, source:"gateway" });
  eq(store.getState().match.clockSec, 48*60, "observação mais VELHA sobrescreveu a mais nova");
});
await test("observação mais NOVA entra normalmente", async()=>{
  const { store } = mk(()=>okResp(liveAt(48)));
  await store.refresh();
  const nova = liveAt(52); nova.observedAt = new Date(T0+40_000).toISOString();
  store._ingest({ matches:nova.matches, observedAt:nova.observedAt, source:"gateway" });
  eq(store.getState().match.clockSec, 52*60, "a observação nova foi rejeitada");
});

// ── Falhas ──
console.log("\nFalhas de fonte e gateway:");
await test("TEMPORARY_SOURCE_FAILURE: gateway devolve stale → jogo permanece visível", async()=>{
  let body = liveAt(48);
  const { store } = mk(()=>okResp(body));
  await store.refresh();
  body = { ...liveAt(48, 0), stale:true, staleReason:"UPSTREAM_429",
           observedAt:new Date(T0+20_000).toISOString() };
  await store.refresh();
  const s = store.getState();
  assert(s.state===STATE.LIVE_STALE, `estado ${s.state}`);
  assert(s.match, "a partida sumiu numa falha temporária da fonte");
});
await test("GATEWAY_FAILURE: 503 NÃO apaga a observação corrente", async()=>{
  let resp = ()=>okResp(liveAt(48));
  const { store } = mk(()=>resp());
  await store.refresh();
  resp = ()=>okResp({schemaVersion:1, matches:null, status:"SOURCE_UNAVAILABLE"}, 503);
  await store.refresh();
  const s = store.getState();
  assert(s.match, "o hero sumiu quando o gateway falhou — é o bug de origem");
  eq(s.match.clockSec, 48*60, "minuto confirmado preservado");
  assert(s.health.consecutiveFailures>0, "a falha não foi contabilizada");
});
await test("gateway INALCANÇÁVEL (throw) também não apaga", async()=>{
  let boom=false;
  const store = createStore({ competition:"br2026", gatewayUrl:"https://gw.test/fn",
    now:()=>T0, fetch: async()=>{ if(boom) throw new Error("net"); return okResp(liveAt(48)); } });
  await store.refresh(); boom=true; await store.refresh();
  assert(store.getState().match, "perdeu o jogo numa falha de rede");
});
await test("schema DESCONHECIDO é rejeitado explicitamente, não interpretado", async()=>{
  const { store } = mk(()=>okResp({schemaVersion:99, matches:[{id:"x",state:"in"}]}));
  await store.refresh();
  eq(store.getState().health.lastError, "UNSUPPORTED_SCHEMA_99", "erro");
  eq(store.getState().match, null, "interpretou um schema futuro com otimismo");
});

// ── 'sem jogo' vs 'não sei' ──
await test("`matches: []` = sabemos que não há jogo", async()=>{
  const { store } = mk(()=>okResp({schemaVersion:1, matches:[], observedAt:new Date(T0).toISOString(), stale:false}));
  await store.refresh();
  eq(store.getState().state, STATE.NO_LIVE_MATCH, "estado");
});
await test("`matches: null` = NÃO sabemos — nunca vira 'não há jogo'", async()=>{
  const { store } = mk(()=>okResp({schemaVersion:1, matches:null, status:"SOURCE_UNAVAILABLE"}, 503));
  await store.refresh();
  assert(store.getState().state !== STATE.NO_LIVE_MATCH, "colapsou 'não sei' em 'não há jogo'");
});

// ── Terminais ──
console.log("\nTransições terminais:");
await test("FINAL_MONOTONICITY: LIVE → FINAL, e não volta por resposta atrasada", async()=>{
  let body = liveAt(90);
  const { store } = mk(()=>okResp(body));
  await store.refresh();
  body = liveAt(90, 0, {state:"post", completed:true}); body.observedAt=new Date(T0+60_000).toISOString();
  await store.refresh();
  eq(store.getState().state, STATE.FINAL, "não transicionou para final");
  const atrasada = liveAt(88); atrasada.observedAt = new Date(T0+10_000).toISOString();
  store._ingest({matches:atrasada.matches, observedAt:atrasada.observedAt, source:"gateway"});
  eq(store.getState().state, STATE.FINAL, "FINAL regrediu para LIVE por resposta atrasada");
});
await test("POSTPONED nunca aparece como 0-0 ao vivo nem como final", async()=>{
  const { store } = mk(()=>okResp(liveAt(0,0,{state:"post", postponed:true, homeScore:0, awayScore:0})));
  await store.refresh();
  eq(store.getState().state, STATE.POSTPONED, "estado");
});

// ── Frescor ──
console.log("\nGraus de frescor (não colapsados):");
await test("os quatro graus são distinguíveis", async()=>{
  let clock=T0;
  const store = createStore({ competition:"br2026", gatewayUrl:"https://gw.test/fn",
    now:()=>clock, fetch: async()=>okResp(liveAt(48)) });
  await store.refresh();
  // Idades escolhidas contra o contrato de frescor (Issue #296): FRESH ate 10 min,
  // STALE_BUT_USABLE ate 30 min, UNAVAILABLE depois disso. Antes deste contrato os degraus eram
  // 30s e 10 min, herdados da meta operacional -- nao da entrega medida do agendador.
  eq(store.getState().state, STATE.LIVE_FRESH, "fresco");
  clock = T0 + 45_000;    eq(store.getState().state, STATE.LIVE_FRESH, "45s ainda e dado fresco");
  clock = T0 + 9*60_000;  eq(store.getState().state, STATE.LIVE_FRESH, "9 min ainda e fresco");
  clock = T0 + 18*60_000; eq(store.getState().state, STATE.LIVE_STALE, "18 min: atrasado, mas util");
  clock = T0 + 31*60_000; eq(store.getState().state, STATE.LIVE_CRITICAL_STALE, "crítico");
  assert(store.getState().match, "perdeu a partida no estado crítico");
});

await test("o estado do navegador carrega o rotulo do contrato, nao so o nome interno", async()=>{
  let clock=T0;
  const store = createStore({ competition:"br2026", gatewayUrl:"https://gw.test/fn",
    now:()=>clock, fetch: async()=>okResp(liveAt(48)) });
  await store.refresh();
  eq(store.getState().freshness, "FRESH", "aos 0s");
  clock = T0 + 18*60_000; eq(store.getState().freshness, "STALE_BUT_USABLE", "aos 18 min");
  clock = T0 + 31*60_000; eq(store.getState().freshness, "UNAVAILABLE", "aos 31 min");
});

await test("a UI recebe a IDADE para poder dizer 'ha N min', nao so o rotulo", async()=>{
  // Sem `ageMs` o aviso de atraso vira "atrasado" generico -- o dono pediu indicacao util de
  // ultima atualizacao, e "atrasado" sem quanto nao informa nada.
  let clock=T0;
  const store = createStore({ competition:"br2026", gatewayUrl:"https://gw.test/fn",
    now:()=>clock, fetch: async()=>okResp(liveAt(48)) });
  await store.refresh();
  clock = T0 + 18*60_000;
  eq(Math.round(store.getState().ageMs / 60_000), 18, "idade em minutos");
});
await test("NO_INVENTED_CLOCK: o minuto NÃO avança com o relógio local", async()=>{
  let clock=T0;
  const store = createStore({ competition:"br2026", gatewayUrl:"https://gw.test/fn",
    now:()=>clock, fetch: async()=>okResp(liveAt(48)) });
  await store.refresh();
  clock = T0 + 20*60_000;
  eq(store.getState().match.clockSec, 48*60, "inventou tempo de futebol");
});

// ── Polling ──
console.log("\nCiclo de vida do polling:");
await test("POLL_LOOP_SINGLETON: start() duas vezes não cria dois laços", async()=>{
  const { store } = mk(()=>okResp(liveAt(48)));
  store.start(); store.start(); store.start();
  await new Promise(r=>setTimeout(r,50));
  assert(store.timerCount() <= 1, `${store.timerCount()} timers ativos`);
  store.stop();
  eq(store.timerCount(), 0, "stop() não limpou o timer");
});
await test("cadência ADAPTATIVA: ao vivo é mais rápida que ocioso", async()=>{
  const { store } = mk(()=>okResp(liveAt(48)));
  await store.refresh();
  const vivo = store.nextIntervalMs();
  const { store: s2 } = mk(()=>okResp({schemaVersion:1, matches:[], observedAt:new Date(T0).toISOString()}));
  await s2.refresh();
  assert(vivo < s2.nextIntervalMs(), `ao vivo ${vivo}ms não é menor que ocioso ${s2.nextIntervalMs()}ms`);
  assert(vivo <= 15000, `intervalo ao vivo alto demais: ${vivo}ms`);
});
await test("backoff após falhas seguidas (não martelar gateway caído)", async()=>{
  const store = createStore({ competition:"br2026", gatewayUrl:"https://gw.test/fn",
    now:()=>T0, fetch: async()=>{ throw new Error("net"); } });
  await store.refresh(); const a = store.nextIntervalMs();
  await store.refresh(); await store.refresh(); const b = store.nextIntervalMs();
  assert(b >= a, `backoff não cresceu: ${a} → ${b}`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FOOTBALL LIVE STORE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
