#!/usr/bin/env node
// Correction flow — never overwrites. Reads the previous manifest (if present),
// writes a NEW versioned manifest file (prior file untouched), records the
// correction reason, recomputes the hash via buildTicketPublicationPayload, and
// sends the distinct "tickets-corrected" template.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPublishTickets } from "./publish_tickets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_DIR = path.join(__dirname, "manifests");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

export async function runCorrectTickets({ drawId, newVersion, previousVersion, reason, testMode, overrideRecipient, dryRun, syntheticDraw }) {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  const prevPath = path.join(MANIFEST_DIR, `${drawId}.v${previousVersion}.json`);
  const previousHash = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, "utf8")).sha256 : null;

  const result = await runPublishTickets({
    drawId,
    publicationVersion: newVersion,
    testMode,
    overrideRecipient,
    correctionReason: reason,
    previousHash,
    dryRun,
    syntheticDraw,
  });

  if (result.ok) {
    // Preserve the new version distinctly; the previous file (if any) is never touched.
    const newPath = path.join(MANIFEST_DIR, `${drawId}.v${newVersion}.json`);
    fs.writeFileSync(newPath, JSON.stringify(result.manifest, null, 2) + "\n");
    result.diff = previousHash ? { previousHash, newHash: result.manifest.sha256, changed: previousHash !== result.manifest.sha256 } : null;
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runCorrectTickets({
    drawId: args["draw-id"],
    newVersion: Number(args["version"]),
    previousVersion: Number(args["previous-version"] || (Number(args["version"]) - 1)),
    reason: args["reason"],
    testMode: !!args["test"],
    overrideRecipient: args["to"],
  }).then((r) => { console.log(JSON.stringify({ ...r, pdf: r.pdf ? `<${r.pdf.length} bytes>` : undefined }, null, 2)); process.exit(r.ok ? 0 : 1); });
}
