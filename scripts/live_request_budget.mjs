#!/usr/bin/env node
/**
 * live_request_budget.mjs — requisições/dia ao provedor ao vivo, calculadas do CALENDÁRIO commitado.
 *
 *   node scripts/live_request_budget.mjs [--from 2026-10-01] [--to 2027-01-01]
 *
 * Premissas (as mesmas do plano de polling real, supabase/functions/_shared/polling_plan.js):
 *   · um minuto está "ativo" para uma competição se há partida em [-3h, +1h] do apito (adiadas/canceladas
 *     não contam); dentro do minuto ativo faz-se 60/cadência chamadas `live`, e UMA chamada `live` cobre
 *     as duas competições (live=71-73);
 *   · sincronização do dia: 1 chamada por competição ativa a cada 10 min;
 *   · pior caso de calendário incerto: janela larga 12h–03h59 UTC todos os dias (UNCERTAIN_CALENDAR).
 * É um MODELO sobre o calendário atual; datas mudam (adiamentos, definição dos mata-matas da Copa do Brasil).
 */
import { readFileSync } from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const from = Date.parse(arg("--from", "2026-10-01") + "T00:00:00Z"), to = Date.parse(arg("--to", "2027-01-01") + "T00:00:00Z");
const LB = 3 * 3600e3, LA = 3600e3, MIN = 60e3;
const cal = {};
for (const c of ["br2026", "cdb2026"]) cal[c] = JSON.parse(readFileSync(`bolao/${c}/data/espn-normalized.json`, "utf8")).matches
  .filter((m) => m.date && m.statusName !== "STATUS_POSTPONED" && m.statusName !== "STATUS_CANCELED").map((m) => Date.parse(m.date));
const active = (c, t) => cal[c].some((d) => t >= d - LB && t <= d + LA);

const CAD = [60, 30, 15];
const days = new Map();
for (let t = from; t < to; t += MIN) {
  const k = new Date(t).toISOString().slice(0, 10);
  const d = days.get(k) ?? { liveMin: 0, sync: 0, uncertainMin: 0 };
  const a = ["br2026", "cdb2026"].filter((c) => active(c, t));
  if (a.length) { d.liveMin++; if (Math.floor(t / MIN) % 10 === 0) d.sync += a.length; }
  const h = new Date(t).getUTCHours(); if (h >= 12 || h <= 3) d.uncertainMin++;
  days.set(k, d);
}
const req = (d, cad) => Math.round(d.liveMin * 60 / cad + d.sync);
const matchDays = [...days.entries()].filter(([, d]) => d.liveMin > 0);
const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : 0;
const r = (x) => Math.round(x).toLocaleString("en-US");
console.log(`# Requisições ao provedor — ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)}\n`);
console.log(`dias com janela ativa: ${matchDays.length} de ${days.size}; minutos ativos: ${r(matchDays.reduce((s, [, d]) => s + d.liveMin, 0))}\n`);
console.log("| cadência | dia típico (mediana) | dia cheio (p90) | PIOR dia | total no período | pior mês | Free 100/dia | Pro 7.500/dia |\n|---|---:|---:|---:|---:|---:|---|---|");
for (const cad of CAD) {
  const per = matchDays.map(([k, d]) => [k, req(d, cad)]).sort((a, b) => a[1] - b[1]);
  const vals = per.map((x) => x[1]); const worst = per.at(-1);
  const byMonth = {}; for (const [k, v] of per) byMonth[k.slice(0, 7)] = (byMonth[k.slice(0, 7)] ?? 0) + v;
  const total = vals.reduce((a, b) => a + b, 0), worstMonth = Math.max(...Object.values(byMonth));
  console.log(`| ${cad} s | ${r(pct(vals, 0.5))} | ${r(pct(vals, 0.9))} | ${r(worst[1])} (${worst[0]}) | ${r(total)} | ${r(worstMonth)} | ${worst[1] <= 100 ? "cabe" : `NÃO (pior dia ${(worst[1] / 100).toFixed(0)}x)`} | ${worst[1] <= 7500 ? `cabe (${(100 * worst[1] / 7500).toFixed(0)}% no pior dia)` : "ESTOURA"} |`);
}
const unc = [...days.values()].map((d) => d.uncertainMin);
console.log("\nCalendário INCERTO (janela larga 12h–03h59 UTC, todo dia): minutos/dia =", r(Math.max(...unc)));
for (const cad of CAD) console.log(`  ${cad} s → ${r(Math.max(...unc) * 60 / cad)} req/dia (${(Math.max(...unc) * 60 / cad <= 7500 ? "cabe" : "ESTOURA")} no Pro)`);
console.log("\nMeses (cadência 60 s / 30 s / 15 s):");
const mo = {}; for (const [k, d] of matchDays) { const m = k.slice(0, 7); mo[m] ??= [0, 0, 0]; CAD.forEach((c, i) => { mo[m][i] += req(d, c); }); }
for (const [m, v] of Object.entries(mo)) console.log(`  ${m}: ${v.map(r).join(" / ")}`);
