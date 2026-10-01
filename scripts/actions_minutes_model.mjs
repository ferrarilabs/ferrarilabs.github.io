#!/usr/bin/env node
/**
 * actions_minutes_model.mjs — modelo reprodutível de minutos de GitHub Actions (repo PRIVADO).
 *
 *   node scripts/actions_minutes_model.mjs [--month 2026-10]
 *
 * Duas fontes, ambas explícitas:
 *   1. LIVE PRODUCER: calculado do calendário commitado (bolao/{br2026,cdb2026}/data/espn-normalized.json)
 *      e da regra real do produtor (janela [-3h,+1h] por partida, ciclo de ~5,5 min cancelado pelo próximo
 *      despacho, 1 min faturável para execução que só pula a janela). O Worker despacha 24 h por dia.
 *   2. DEMAIS WORKFLOWS: contagens observadas em 31 dias (docs/private-repo-migration/ACTIONS_PRIVATE_REPO_AUDIT.md,
 *      branch chore/private-repo-readiness, via API de runs em 2026-10-01) × minutos faturáveis por execução
 *      (duração observada arredondada para cima ao minuto, supondo 1x para ubuntu).
 * É um MODELO: a verdade é Settings → Billing → Usage. Ele existe para dizer a ORDEM DE GRANDEZA e
 * quais alavancas importam, não para prever a fatura ao minuto.
 */
import { readFileSync } from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const month = arg("--month", "2026-10");

const dates = [];
for (const a of ["br2026", "cdb2026"]) for (const m of JSON.parse(readFileSync(`bolao/${a}/data/espn-normalized.json`, "utf8")).matches ?? []) if (m.date) dates.push(Date.parse(m.date));
const LB = 3 * 3600e3, LA = 3600e3, SLOT = 300e3;
const [y, mo] = month.split("-").map(Number);
const t0 = Date.UTC(y, mo - 1, 1), t1 = Date.UTC(y, mo, 1);
let slots = 0, inWin = 0;
for (let t = t0; t < t1; t += SLOT) { slots++; if (dates.some((d) => d >= t - LB && d <= t + LA)) inWin++; }
const days = (t1 - t0) / 86400e3, k = 30 / days;          // normaliza para mês de 30 dias
const IN_WIN_BILLED = 6, OUT_WIN_BILLED = 1;              // ~5m12s → 6 min; skip em ~16 s → 1 min
const cur = (inWin * IN_WIN_BILLED + (slots - inWin) * OUT_WIN_BILLED) * k;
// Alavanca 0 (só restringir o cron do Worker a 14–02 UTC): remove os despachos que só pulam.
const slotsOnlyWindowHours = (() => { let n = 0; for (let t = t0; t < t1; t += SLOT) { const h = new Date(t).getUTCHours(); if (h >= 14 || h <= 2) n++; } return n; })();
const lever0 = (inWin * IN_WIN_BILLED + (slotsOnlyWindowHours - inWin) * OUT_WIN_BILLED) * k;

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
console.log(`# Modelo de minutos — ${month} (mês normalizado para 30 dias)\n`);
console.log(`calendário: ${dates.length} partidas; slots de 5 min: ${slots}; em janela: ${inWin} (${(inWin * 5 / 60).toFixed(0)} h)\n`);
console.log("| bloco | min/mês |\n|---|---:|");
console.log(`| live_cache_producer HOJE (Worker 24h, ciclo na janela) | ${r(cur)} |`);
console.log(`| live_cache_producer só com cron do Worker restrito a 14–02 UTC (alavanca 0) | ${r(lever0)} |`);
for (const [c, v] of Object.entries(sum)) console.log(`| ${c} | ${r(v)} |`);
console.log(`| **ANTES (privado, sem migrar)** | **${r(cur + others)}** |`);
console.log(`| **DEPOIS da migração do produtor (relay público)** | **${r(others)}** |`);
console.log(`| DEPOIS + alavancas baratas (safety_check só PR-com-paths, monitor só na janela, schedule_watch fora) | ${r(others - sum.ci * 0.9 - 164 * 0.5 - 149)} |`);
