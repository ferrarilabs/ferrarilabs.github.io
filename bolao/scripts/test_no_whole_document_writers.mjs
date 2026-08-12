#!/usr/bin/env node
/**
 * PLATFORM-WHOLE-DOC-WRITERS — regression gate.
 *
 * One property, across all three pools and the shared tooling: nothing writes the whole
 * `bolao_state` document. Every mutation goes through a narrow RPC that applies a jsonb path
 * server-side under `for update`.
 *
 * The defect this prevents is not "ugly code". Two whole-document writers with no shared
 * concurrency token silently lose each other's work — a payment mark vanishing because a result
 * was recorded from a stale copy. It was demonstrated, not theorised: see the negative controls in
 * copa_concurrency_proof.mjs and cdb_mutations_proof.mjs, which reproduce the old shape and show it
 * losing an unrelated field.
 *
 * Comments are stripped first. These files deliberately EXPLAIN what was removed, and a scanner
 * that fires on the explanation is a scanner someone disables.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (f === "node_modules" || f.startsWith(".")) return [];
  if (statSync(p).isDirectory()) return walk(p);
  return /\.(js|mjs|py)$/.test(f) && !/\btest_/.test(f) ? [p] : [];
});

const strip = (s, py) => py
  ? s.split("\n").map((l) => l.replace(/#.*$/, "")).join("\n").replace(/"""[\s\S]*?"""/g, " ")
  : s.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");

const PATTERNS = [
  [/\.upsert\s*\(/, "supabase-js .upsert()"],
  [/rest\/v1\/bolao_state["'`]\s*,\s*data=/, "raw POST to bolao_state"],
  [/_req\(\s*["']PATCH["']\s*,\s*f?["'`]\/rest\/v1\/bolao_state/, "raw PATCH of bolao_state"],
  [/rest\/v1\/\$\{table\}\?id=eq\.\$\{stateId\}`[\s\S]{0,120}?method:\s*["']DELETE["']/, "raw DELETE of the state row"],
  // The merge-duplicates header ALONE is not evidence: cdb_entry_access legitimately upserts with
  // it, and flagging that was a false positive that would have taught readers to ignore this gate.
  // The signal is that header within reach of a bolao_state write.
  [/bolao_state[\s\S]{0,400}?resolution=merge-duplicates|resolution=merge-duplicates[\s\S]{0,400}?bolao_state/, "whole-document upsert of bolao_state"],
  [/rest\/v1\/\$\{table\}`[\s\S]{0,200}?resolution=merge-duplicates/, "whole-document upsert via cfg.table"],
];

const hits = [];
for (const f of walk(ROOT)) {
  const src = strip(readFileSync(f, "utf8"), f.endsWith(".py"));
  for (const [re, why] of PATTERNS) {
    const m = src.match(re);
    if (m) hits.push({ file: f.replace(ROOT + "/", ""), why });
  }
}

console.log("platform — no whole-document writers\n");
for (const h of hits) console.log(`  ✗ ${h.file}  — ${h.why}`);
console.log(hits.length ? `\n${hits.length} whole-document writer(s) found` : "  ✓ zero whole-document writers across copa2026, br2026, cdb2026 and shared tooling");
process.exit(hits.length ? 1 : 0);
