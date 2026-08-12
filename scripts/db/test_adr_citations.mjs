#!/usr/bin/env node
/**
 * PRODMIG-ADR-1 — every ADR-K citation in this repository must resolve.
 *
 * The defect: 49 citations pointed at decision records that lived only in the campaign's non-Git
 * workspace. Anyone cloning the repo could read "see ADR-K04" and had no way to see ADR-K04. A
 * citation that cannot be followed is a claim of provenance, not provenance.
 *
 * This gate is not a link-checker for its own sake. It fails on:
 *   - a citation naming a record that does not exist (the original defect)
 *   - a mirrored record that has DRIFTED from the campaign original (a silent rewrite of an
 *     accepted decision, which is worse than a missing one)
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIRROR = join(ROOT, "docs", "bolao", "db-modernization", "adr");
const ORIGIN = join(process.env.HOME, "Documents", "GitHub", "ferrarilabs-work",
                    "db-modernization", "autonomous-campaign", "adr");

const files = execFileSync("git", ["-C", ROOT, "grep", "-l", "-E", "ADR-K[0-9]{2}"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);

const cites = new Map();
for (const f of files) {
  const src = readFileSync(join(ROOT, f), "utf8");
  for (const m of src.matchAll(/ADR-K(\d{2})/g)) {
    const id = `ADR-K${m[1]}`;
    if (!cites.has(id)) cites.set(id, new Set());
    cites.get(id).add(f);
  }
}

const present = new Set(readdirSync(MIRROR).filter((f) => /^ADR-K\d{2}/.test(f)).map((f) => f.slice(0, 7)));
const total = [...cites.values()].reduce((n, s) => n + s.size, 0);
const unresolvable = [...cites.keys()].filter((id) => !present.has(id));

console.log("ADR-K citations\n");
console.log(`  distinct ids cited : ${cites.size}`);
console.log(`  citing files       : ${files.length}`);
console.log(`  file-level citations: ${total}`);
console.log(`  records mirrored   : ${present.size}`);
for (const id of unresolvable) console.log(`  ✗ ${id} cited by ${[...cites.get(id)].join(", ")} — NO RECORD`);

// Drift: a mirror that quietly says something else is worse than a missing one.
let drifted = [];
if (existsSync(ORIGIN) && statSync(ORIGIN).isDirectory()) {
  for (const f of readdirSync(MIRROR).filter((x) => /^ADR-K\d{2}/.test(x))) {
    const a = join(MIRROR, f), b = join(ORIGIN, f);
    if (!existsSync(b)) continue;
    if (readFileSync(a, "utf8") !== readFileSync(b, "utf8")) drifted.push(f);
  }
  for (const f of drifted) console.log(`  ✗ ${f} — mirror DIFFERS from the campaign original`);
} else {
  console.log("  · campaign workspace not present here; drift not checked this run");
}

const ok = unresolvable.length === 0 && drifted.length === 0;
console.log(`\n  UNRESOLVABLE = ${unresolvable.length}   DRIFTED = ${drifted.length}`);
console.log(ok ? "  ✓ every ADR-K citation resolves" : "  ✗ ADR citation gate FAILED");
process.exit(ok ? 0 : 1);
