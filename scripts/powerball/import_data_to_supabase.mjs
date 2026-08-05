#!/usr/bin/env node
// Powerball Admin — data.js -> Supabase migration tool. DRY-RUN ONLY.
// STATUS: testado e executado for the dry-run parse/hash steps below (they touch no network).
// The actual "import" step is NEVER invoked by this script — there is no code path here that
// writes to Supabase. This script only reads js/data.js, normalizes it, computes counts/hashes,
// and prints a diff-shaped report. It does not delete or modify data.js.
//
// Usage: node scripts/powerball/import_data_to_supabase.mjs

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const DATA_JS_PATH = new URL("../../bolao/loterias/powerball/js/data.js", import.meta.url).pathname;

function loadDataJs() {
  const source = readFileSync(DATA_JS_PATH, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  // data.js is a plain browser script that assigns onto `window.*` — running it in a VM
  // sandbox (not eval in this process, not a network call) is the least-risky way to get its
  // real structured data without re-implementing a parser for it by hand and risking drift.
  vm.runInContext(source, sandbox, { filename: DATA_JS_PATH });
  return sandbox.window;
}

function sha256(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function normalize(win) {
  const allDraws = [];
  // Confirmed real shape by inspecting bolao/loterias/powerball/js/data.js directly:
  // `window.<GAME>_DRAWS` is an array of draw objects; `window.POWERBALL_DATA` is just a
  // pointer to the most recent entry of POWERBALL_DRAWS, not a separate collection — so only
  // the `*_DRAWS` arrays are walked, to avoid double-counting the same draw twice.
  for (const key of Object.keys(win)) {
    const val = win[key];
    if (Array.isArray(val) && /_DRAWS$/.test(key)) {
      allDraws.push(...val.map((d) => ({ ...d, _sourceKey: key })));
    }
  }
  let participantCount = 0;
  let paymentTotal = 0;
  let ticketCount = 0;
  for (const draw of allDraws) {
    const participants = draw.participants || [];
    participantCount += participants.length;
    for (const p of participants) {
      const v = Number(p.valor);
      if (!Number.isNaN(v)) paymentTotal += v;
    }
    ticketCount += (draw.tickets || []).length;
  }
  return { drawCount: allDraws.length, participantCount, paymentTotal, ticketCount, allDraws };
}

function main() {
  const win = loadDataJs();
  const sourceHash = sha256(readFileSync(DATA_JS_PATH, "utf8"));
  const normalized = normalize(win);
  const normalizedHash = sha256(normalized.allDraws);

  console.log("=== Powerball data.js -> Supabase — DRY RUN (no writes performed) ===");
  console.log(`source file: ${DATA_JS_PATH}`);
  console.log(`source_data_hash (sha256 of raw file): ${sourceHash}`);
  console.log(`imported_data_hash (sha256 of normalized dry-run output): ${normalizedHash}`);
  console.log(`draws found: ${normalized.drawCount}`);
  console.log(`participant rows found (sum across draws, not deduplicated by person): ${normalized.participantCount}`);
  console.log(`ticket rows found (sum across draws): ${normalized.ticketCount}`);
  console.log(`payment total found (sum of 'valor' fields, USD): ${normalized.paymentTotal.toFixed(2)}`);
  console.log("");
  console.log("This is a DRY RUN. No Supabase connection was opened. No import has been performed.");
  console.log("data.js was not modified or deleted.");
  console.log("Explicit confirmation to actually import was NOT given in this pass — per instructions,");
  console.log("this tool must never proceed past dry-run without that confirmation, which this run did not request.");
}

main();
