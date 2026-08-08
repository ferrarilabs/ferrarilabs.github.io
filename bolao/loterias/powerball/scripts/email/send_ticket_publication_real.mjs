#!/usr/bin/env node
// send_ticket_publication_real.mjs — real (non-fixture) "tickets published"
// send for a real draw. Generates real local PDF/CSV/JSON evidence files
// from the draw's own actual ticket data (no external hosting needed — see
// validateAttachmentsAndLinks' operatorAttestation doc comment for why),
// then calls runPublishTickets with those files + a written attestation.
//
// Usage:
//   node send_ticket_publication_real.mjs --draw-id 2026-08-08 --version 1 --dry-run
//   node send_ticket_publication_real.mjs --draw-id 2026-08-08 --version 1
//
// --dry-run renders everything (including writing the real attachment files
// and running the full validation gate) but does not call the EmailJS API.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDrawSnapshot } from "./snapshot.mjs";
import { eligibleRecipients } from "./validate.mjs";
import { buildTicketPublicationPayload, manifestToCsv } from "./payload.mjs";
import { buildTextPdf } from "./pdf.mjs";
import { runPublishTickets, ticketsFromDraw } from "./publish_tickets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const drawId = args["draw-id"];
  const publicationVersion = Number(args["version"] || 1);
  const dryRun = process.argv.includes("--dry-run");
  if (!drawId) { console.error("Usage: --draw-id <id> --version <n> [--dry-run]"); process.exit(1); }

  const draw = loadDrawSnapshot(drawId);
  if (!draw) { console.error(`Draw ${drawId} not found`); process.exit(1); }
  const tickets = ticketsFromDraw(draw);
  const eligible = eligibleRecipients(draw.participants);

  const { shared } = buildTicketPublicationPayload({
    draw, participants: eligible, tickets, publicationVersion,
    proofUrl: undefined, // no URL ever exists for this bolão — see operatorAttestation instead
  });

  const outDir = path.join(__dirname, "generated", `${drawId}-v${publicationVersion}`);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "manifest.json");
  const csvPath = path.join(outDir, "tickets.csv");
  const pdfPath = path.join(outDir, "tickets.pdf");

  fs.writeFileSync(jsonPath, JSON.stringify(shared.manifest, null, 2));
  fs.writeFileSync(csvPath, manifestToCsv(shared.manifest));

  const pdfLines = [
    `Powerball — Bilhetes publicados`,
    `Draw: ${draw.id}  Versão: ${publicationVersion}`,
    `Hash SHA-256: ${shared.manifestHash}`,
    "",
    "Resumo financeiro:",
    ...Object.entries(shared.financialSummary).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Tickets:",
    ...shared.tickets.map((t, i) => `  #${i + 1}: ${t.numbers.join("-")} — PB ${t.special}${t.serial ? " [" + t.serial + "]" : ""}`),
  ];
  fs.writeFileSync(pdfPath, buildTextPdf(pdfLines, { title: "Powerball tickets" }));

  console.log(`Generated evidence files in ${outDir}:`);
  console.log(`  - ${jsonPath}`);
  console.log(`  - ${csvPath}`);
  console.log(`  - ${pdfPath}`);
  console.log(`  Manifest SHA-256: ${shared.manifestHash}`);

  const operatorAttestation =
    `Comprovantes de ${tickets.length} bilhetes (séries do sorteio ${draw.id}) colados por Eduardo Ferrari ` +
    `diretamente na conversa e transcritos para js/data.js; cada bilhete conferido individualmente contra o ` +
    `texto colado antes do commit. Nenhum link ou PDF de terceiros existe para este comprovante — ver nota em ` +
    `docs/bolao/loterias/POWERBALL_EMAIL_ARCHITECTURE.md.`;

  // outbox.mjs's own header comment: "scripts/email/outbox.json (git-ignored in
  // practice for real sends; committed here only with ... synthetic test-mode
  // records as evidence)" — but outbox.json was never actually added to .gitignore,
  // and a real send writes each recipient's real email into it (as `recipient`).
  // A first real dry-run confirmed this: it wrote real names+emails for all 15
  // participants into the tracked file (reverted with `git checkout` before
  // committing anything). Pointing this script's outbox at the already-gitignored
  // generated/ directory instead keeps the documented intent — never a real send
  // into the tracked, publicly-committed outbox.json.
  const realOutboxFile = path.join(outDir, "outbox.json");

  const result = await runPublishTickets({
    drawId,
    publicationVersion,
    testMode: false,
    dryRun,
    operatorAttestation,
    outboxFile: realOutboxFile,
    attachments: [
      { kind: "pdf", filePath: pdfPath },
      { kind: "csv", filePath: csvPath },
      { kind: "json", filePath: jsonPath },
    ],
  });

  console.log("\n" + (dryRun ? "DRY RUN RESULT" : "SEND RESULT") + ":");
  console.log("ok:", result.ok);
  if (!result.ok) {
    console.log("errors:", JSON.stringify(result.errors, null, 2));
    process.exit(1);
  }
  console.log("recipients:", result.results.length);
  result.results.forEach((r) => console.log(`  - ${r.participant}: ${dryRun ? "(dry-run)" : r.ok ? "sent" : "FAILED: " + r.error}`));
}

main();
