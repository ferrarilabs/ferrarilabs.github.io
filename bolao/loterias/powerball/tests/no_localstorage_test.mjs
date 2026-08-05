#!/usr/bin/env node
// Powerball Admin — automated test: fails if any localStorage.getItem/setItem/removeItem
// (or bare localStorage.<anything>) call appears anywhere in the Powerball admin code.
// STATUS: testado e executado — this script itself runs and its output is real (see
// docs/bolao/loterias/POWERBALL_ADMIN_TEST_PLAN.md for the captured run).
//
// Hard rule: zero localStorage for any operational data in the Powerball admin. Only
// sessionStorage/in-memory allowed, and only for the auth session token (enforced by a
// separate check, see sessionstorage_scope_test.mjs).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../admin", import.meta.url).pathname;
const LOCALSTORAGE_RE = /\blocalStorage\s*\.\s*(getItem|setItem|removeItem|clear|key)\b|\bwindow\.localStorage\b|\blocalStorage\[/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html)$/.test(entry)) out.push(p);
  }
  return out;
}

let failures = [];
for (const file of walk(ROOT)) {
  const content = readFileSync(file, "utf8");
  const matches = content.match(LOCALSTORAGE_RE);
  if (matches) failures.push({ file, matches });
}

if (failures.length > 0) {
  console.error("FAIL: localStorage usage found in Powerball admin code:");
  for (const f of failures) console.error(`  ${f.file}: ${f.matches.join(", ")}`);
  process.exit(1);
} else {
  console.log(`PASS: 0 localStorage calls found in ${walk(ROOT).length} files under bolao/loterias/powerball/admin/.`);
  process.exit(0);
}
