#!/usr/bin/env node
/**
 * classify.mjs — classificacao de mudanca e CHANGE_SAFETY_REPORT.
 *
 * Responde a pergunta A do contrato ("alguma superficie critica mudou?") e decide quais gates
 * CAROS valem a pena nesta execucao. A pergunta B ("os invariantes ainda valem?") e de
 * audit_safety_contract.mjs, e roda sempre, independente do diff.
 *
 * A separacao importa: classificacao por caminho e uma heuristica de CUSTO, nunca de SEGURANCA.
 * Ela pode decidir rodar mais; nunca pode decidir rodar menos que o nucleo universal. Um
 * classificador com autoridade para pular o essencial e so um jeito caro de escrever `--force`.
 *
 * Uso:
 *   node scripts/safety/classify.mjs
 *   node scripts/safety/classify.mjs --json
 *   node scripts/safety/classify.mjs --json-out=safety-summary.json
 */

import { writeFileSync } from "node:fs";
import { loadSurfaces, loadIntent, resolveBase, changedPaths, pathMatches } from "./surfaces.mjs";

const ARGS = process.argv.slice(2);
const jsonOut = (ARGS.find((a) => a.startsWith("--json-out=")) || "").slice("--json-out=".length);
const asJson = ARGS.includes("--json");

const reg = loadSurfaces();
const intent = loadIntent();
const base = resolveBase();
const changed = changedPaths(base.sha);

// ── superficies tocadas ───────────────────────────────────────────────────────────────────────

const touched = [];
for (const s of reg.surfaces) {
  const hits = changed.filter((p) => pathMatches(p, s.paths));
  if (hits.length) touched.push({ id: s.id, category: s.category, policy: s.change_policy, paths: hits, gates: s.required_gates || [] });
}

const declaredIds = new Set(intent.declarations.map((d) => d.surface_id));
const undeclared = touched.filter((t) => t.policy === "DECLARE_TO_CHANGE" && !declaredIds.has(t.id));

/**
 * Grupos do verify.mjs mais relevantes por categoria tocada.
 *
 * ISTO E RELATORIO, NAO PERMISSAO. `npm run check` roda a suite canonica INTEIRA sempre — este
 * mapa nunca subtrai nada, so aponta onde olhar primeiro quando algo fica vermelho. A separacao
 * e deliberada: classificacao por caminho e uma heuristica de custo, e uma heuristica com
 * autoridade para PULAR gate e so um jeito caro de escrever `--force`. Se um dia o custo obrigar
 * a execucao seletiva, o lugar de decidir isso e aqui, com o nucleo universal preservado.
 */
const EXTRA_GROUPS = {
  VISUAL: ["browser"],
  NOTIFICATION: ["notifications", "provider", "scheduling"],
  PERSISTENCE: ["security"],
  BUSINESS_RULE: ["scoring"],
  QUALITY_INFRA: ["security", "app", "browser", "scoring", "notifications", "provider", "scheduling"],
};
const diffAware = new Set();
for (const t of touched) for (const g of EXTRA_GROUPS[t.category] || []) diffAware.add(g);

// ── relatorio ─────────────────────────────────────────────────────────────────────────────────

const flag = (id) => (touched.some((t) => t.id === id) ? "YES" : "NO");
const anyCategory = (c) => (touched.some((t) => t.category === c) ? "YES" : "NO");

const report = {
  schemaVersion: 1,
  BASE_SHA: base.sha,
  BASE_RESOLUTION: base.how,
  HEAD_SHA: process.env.GITHUB_SHA || null,
  CHANGED_PATHS: changed.length,
  CRITICAL_SURFACES_CHANGED: touched.map((t) => t.id),
  UNDECLARED_CRITICAL_CHANGES: undeclared.map((t) => t.id),
  AUTHORIZED_CRITICAL_CHANGES: intent.declarations.map((d) => ({
    surface: d.surface_id, reason: d.reason, gates: d.tests_required,
  })),
  TEST_INFRASTRUCTURE_CHANGED: anyCategory("QUALITY_INFRA"),
  HERO_CHANGED: flag("LIVE_MATCH_HEROES"),
  STANDARD_LOOK_AND_FEEL_CHANGED: (flag("SHARED_DESIGN_TOKENS") === "YES" || flag("SHARED_VISUAL_FRAMEWORK") === "YES" || flag("APP_STYLESHEETS") === "YES") ? "YES" : "NO",
  SCORING_CHANGED: (flag("SCORING_CONSTANTS") === "YES" || flag("SCORING_ENGINES") === "YES") ? "YES" : "NO",
  RANKING_RULES_CHANGED: flag("RANKING_AND_TIEBREAK"),
  EMAIL_LOGIC_CHANGED: (flag("NOTIFICATION_EXACTLY_ONCE") === "YES" || flag("EMAIL_SUBJECT_POLICY") === "YES") ? "YES" : "NO",
  EMAIL_TRIGGER_CHANGED: flag("NOTIFICATION_WORKFLOWS"),
  CRON_CHANGED: flag("NOTIFICATION_WORKFLOWS"),
  SUPABASE_CHANGED: anyCategory("PERSISTENCE"),
  MIGRATIONS_CHANGED: flag("SUPABASE_MIGRATIONS"),
  SECURITY_BOUNDARY_CHANGED: flag("SECURITY_BOUNDARY"),
  GATES_CHANGED: (anyCategory("QUALITY_INFRA") === "YES") ? "YES" : "NO",
  DIFF_AWARE_GROUPS: [...diffAware],
  REQUIRED_GATES: [...new Set(touched.flatMap((t) => t.gates))].sort(),
};

if (asJson || jsonOut) {
  const text = JSON.stringify(report, null, 2) + "\n";
  if (jsonOut) writeFileSync(jsonOut, text);
  if (asJson) console.log(text);
} else {
  console.log("\nCHANGE_SAFETY_REPORT\n");
  console.log(`  BASE_SHA = ${report.BASE_SHA ? report.BASE_SHA.slice(0, 12) : "<nenhuma>"} (${report.BASE_RESOLUTION})`);
  console.log(`  CHANGED_PATHS = ${report.CHANGED_PATHS}\n`);
  console.log("  CRITICAL_SURFACES_CHANGED =");
  if (!touched.length) console.log("  - none");
  for (const t of touched) console.log(`  - ${t.id}  [${t.policy}]  ${t.paths.length} arquivo(s)`);
  console.log("");
  for (const k of ["TEST_INFRASTRUCTURE_CHANGED", "HERO_CHANGED", "STANDARD_LOOK_AND_FEEL_CHANGED",
    "SCORING_CHANGED", "RANKING_RULES_CHANGED", "EMAIL_LOGIC_CHANGED", "EMAIL_TRIGGER_CHANGED",
    "CRON_CHANGED", "SUPABASE_CHANGED", "MIGRATIONS_CHANGED", "SECURITY_BOUNDARY_CHANGED", "GATES_CHANGED"])
    console.log(`  ${k} = ${report[k]}`);
  if (report.AUTHORIZED_CRITICAL_CHANGES.length) {
    console.log("\n  AUTHORIZED_CRITICAL_CHANGES =");
    for (const a of report.AUTHORIZED_CRITICAL_CHANGES) console.log(`  - ${a.surface}: ${a.reason}\n      gates: ${(a.gates || []).join(", ")}`);
  }
  if (report.DIFF_AWARE_GROUPS.length) console.log(`\n  DIFF_AWARE_GROUPS = ${report.DIFF_AWARE_GROUPS.join(", ")}`);
  console.log("");
}

// A classificacao NUNCA reprova sozinha — quem reprova mudanca nao declarada e o meta-gate
// (D2), que roda sempre. Dois lugares capazes de dar o mesmo veredito divergem com o tempo, e o
// mais fraco vira o efetivo.
process.exit(0);
