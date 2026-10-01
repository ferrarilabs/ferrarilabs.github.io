#!/usr/bin/env node
/**
 * actions_minutes_model.mjs — modelo reprodutível de minutos de GitHub Actions (repo PRIVADO).
 *
 *   node scripts/actions_minutes_model.mjs [--month 2026-10]
 *
 * REVISADO após evidência de execuções reais (2026-09-01 → 2026-10-01, API de runs, 8.757 execuções):
 * o produtor tem DOIS agendadores ativos (ver docs/private-repo-migration/actions/PIPELINE_TOPOLOGY_CORRECTION.md):
 *   A. `schedule:` do próprio workflow (de 5 em 5 min, 14h–23h e 0h–2h UTC) — GitHub entrega ~4,7 execuções/dia, 28 % canceladas;
 *   B. cron da Cloudflare (de 5 em 5 min, 24 h) → workflow_dispatch (288/dia, 24 h).
 * Ambos compartilham `concurrency: live-cache-producer` com cancel-in-progress.
 *
 * Fontes: (1) EVIDENCE = números medidos no mês de setembro; (2) o calendário commitado, para a parte
 * dependente de jogos (execução de janela ~5m12s → 6 min faturáveis; fora de janela ~15 s → 1 min);
 * (3) demais workflows: contagens observadas em 31 dias × minutos faturáveis por execução.
 * É um MODELO: a verdade é Settings → Billing → Usage.
 */
import { readFileSync } from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const month = arg("--month", "2026-10");

/** MEDIDO (2026-09-01..2026-10-01, ceil(duração/60) por execução, mínimo 1). */
const EVIDENCE = { dispatchRuns: 8612, dispatchBilledMin: 13583, scheduleRuns: 145, scheduleBilledMin: 231, days: 31, scheduleCancelledPct: 28.3, dispatchCancelledPct: 11.6 };

const dates = [];
for (const a of ["br2026", "cdb2026"]) for (const m of JSON.parse(readFileSync(`bolao/${a}/data/espn-normalized.json`, "utf8")).matches ?? []) if (m.date) dates.push(Date.parse(m.date));
const LB = 3 * 3600e3, LA = 3600e3, SLOT = 300e3;
const [y, mo] = month.split("-").map(Number);
const t0 = Date.UTC(y, mo - 1, 1), t1 = Date.UTC(y, mo, 1);
let slots = 0, inWin = 0;
for (let t = t0; t < t1; t += SLOT) { slots++; if (dates.some((d) => d >= t - LB && d <= t + LA)) inWin++; }
const days = (t1 - t0) / 86400e3, k = 30 / days;          // normaliza para mês de 30 dias
const IN_WIN_BILLED = 6, OUT_WIN_BILLED = 1;              // ~5m12s → 6 min; skip em ~16 s → 1 min
const dispatch24h = (inWin * IN_WIN_BILLED + (slots - inWin) * OUT_WIN_BILLED) * k;
// B': Worker só nas horas da janela do workflow (14–02 UTC), mantendo o resto igual.
const slotsHours = (() => { let n = 0; for (let t = t0; t < t1; t += SLOT) { const h = new Date(t).getUTCHours(); if (h >= 14 || h <= 2) n++; } return n; })();
const dispatchHours = (inWin * IN_WIN_BILLED + (slotsHours - inWin) * OUT_WIN_BILLED) * k;
// B'': despacho só quando há partida na janela derivada do calendário (nenhuma execução fora dela).
const dispatchWindowOnly = inWin * IN_WIN_BILLED * k;
// A: o `schedule:` do GitHub entrega ~EVIDENCE.scheduleRuns/31 por dia, a ~1,6 min faturável em média (mistura de execuções de janela).
const scheduleDup = EVIDENCE.scheduleBilledMin / EVIDENCE.days * 30;

// [workflow, categoria, execuções/31d observadas, min faturáveis/execução]
const OTHERS = [
  ["deploy-pages", "pages", 158, 1], ["sync_version", "pages", 19, 1],
  ["safety_check", "ci", 126, 11.5],
  ["bolao_provider_snapshot", "scheduled-prod", 187, 2], ["br2026_broadcast_epg", "scheduled-prod", 77, 1], ["lottery_poll", "scheduled-prod", 104, 1],
  ["powerball_jackpot_refresh", "scheduled-prod", 112, 1], ["cdb2026_entry_saved_confirmation", "scheduled-prod", 192, 1],
  ["cdb2026_result_emails", "emails", 164, 1.3], ["br2026_round_emails", "emails", 98, 1], ["powerball-results-email", "emails", 126, 1],
  ["cdb2026_operator", "manual", 16, 1], ["cdb2026_result_email_recovery", "manual", 8, 1], ["cdb2026_ledger_reconciliation", "manual", 3, 1],
  ["live_pipeline_monitor", "monitoring", 164, 1], ["cdb2026_schedule_watch", "monitoring", 149, 1], ["cdb2026_result_email_watch", "monitoring", 60, 1],
  ["sentinel", "monitoring", 37, 1], ["br2026_broadcast_coverage", "monitoring", 24, 1],
];
const sum = {}; for (const [, c, n, m] of OTHERS) sum[c] = (sum[c] ?? 0) + n * m;
const others = Object.values(sum).reduce((a, b) => a + b, 0);
const r = (x) => Math.round(x).toLocaleString("en-US");
const measuredMonth = (EVIDENCE.dispatchBilledMin + EVIDENCE.scheduleBilledMin) / EVIDENCE.days * 30;
const live = {
  CURRENT_REAL_ARCHITECTURE: dispatch24h + scheduleDup,                 // A + B, repositório público = não faturado
  PRIVATE_WITHOUT_CHANGES: dispatch24h + scheduleDup,                   // mesmos minutos, agora faturáveis
  PRIVATE_REMOVE_DUPLICATE_GITHUB_SCHEDULE: dispatch24h,                // remove A
  PRIVATE_MATCH_WINDOW_DISPATCH_ONLY: dispatchWindowOnly,               // remove A e despacha só em janela
  PRIVATE_API_FOOTBALL_DIRECT: 0,                                       // Cloudflare → API-Football → ingest: sem runner
};
console.log(`# Modelo de minutos — ${month} (mês normalizado para 30 dias)\n`);
console.log(`calendário: ${dates.length} partidas; slots de 5 min: ${slots}; em janela: ${inWin} (${(inWin * 5 / 60).toFixed(0)} h)`);
console.log(`medido em setembro (30 d): despacho ${r(EVIDENCE.dispatchBilledMin / EVIDENCE.days * 30)} + schedule ${r(scheduleDup)} = ${r(measuredMonth)} min  (modelo p/ setembro: ver --month 2026-09)\n`);
console.log("## live_cache_producer (produtor ao vivo)\n\n| cenário | min/mês |\n|---|---:|");
for (const [n, v] of Object.entries(live)) console.log(`| ${n} | ${r(v)} |`);
console.log(`| (alavanca isolada) Worker só 14–02 UTC, mantendo o schedule | ${r(dispatchHours + scheduleDup)} |`);
console.log(`\nO schedule duplicado (A) responde por ${(100 * scheduleDup / (dispatch24h + scheduleDup)).toFixed(1)} % do produtor; o despacho 24 h fora de janela (execuções de 1 min que só pulam) responde por ${r(dispatch24h - dispatchWindowOnly)} min.\n`);
console.log("## Demais workflows (separados do produtor)\n\n| bloco | min/mês |\n|---|---:|");
for (const [c, v] of Object.entries(sum)) console.log(`| ${c} | ${r(v)} |`);
console.log(`| **subtotal demais workflows** | **${r(others)}** |`);
const levers = others - sum.ci * 0.9 - 164 * 0.5 - 149;
console.log(`| subtotal após alavancas baratas (safety_check só PR-com-paths, monitor só na janela, schedule_watch fora) | ${r(levers)} |\n`);
console.log("## Total repositório privado\n\n| cenário | produtor | demais | TOTAL |\n|---|---:|---:|---:|");
for (const [n, v] of Object.entries(live)) console.log(`| ${n} | ${r(v)} | ${r(others)} | **${r(v + others)}** |`);
console.log(`| PRIVATE_API_FOOTBALL_DIRECT + alavancas baratas | 0 | ${r(levers)} | **${r(levers)}** |`);
