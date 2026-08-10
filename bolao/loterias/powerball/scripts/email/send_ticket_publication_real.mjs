#!/usr/bin/env node
// send_ticket_publication_real.mjs — real (non-fixture) "tickets published"
// send for a real draw. Generates real PDF/CSV/JSON evidence files from the
// draw's own actual ticket data, in two places:
//   - scripts/email/generated/ (gitignored, local-only audit trail)
//   - bolao/loterias/powerball/tickets/ (git-tracked, served by GitHub Pages)
// The second copy exists because EmailJS's REST API has no attachment
// mechanism — see the note next to SITE_BASE below — so the email links to
// these public URLs instead of claiming a nonexistent attachment.
// operatorAttestation (proof of PAYMENT, a different artifact) still has no
// public URL — see its own doc comment.
//
// Usage:
//   node send_ticket_publication_real.mjs --draw-id 2026-08-08 --version 1 --dry-run
//   node send_ticket_publication_real.mjs --draw-id 2026-08-08 --version 1
//
// --dry-run renders everything (including writing the real files and running
// the full validation gate) but does not call the EmailJS API. The public
// tickets/ files ARE written even on a dry run (harmless, deterministic
// content) — commit them only once you're ready to actually send.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadDrawSnapshot } from "./snapshot.mjs";
import { eligibleRecipients } from "./validate.mjs";
import { buildTicketPublicationPayload, manifestToCsv } from "./payload.mjs";
import { buildTextPdf, ticketPublicationPdfBlocks } from "./pdf.mjs";
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
  const onlyParticipant = args["only"]; // e.g. --only "Eduardo Ferrari" — put --dry-run LAST on the command line, see parseArgs
  const receiptPath = args["receipt"]; // e.g. --receipt /path/to/comprovante.pdf — the real lottery/bank receipt, copied into the evidence folder alongside the generated files
  if (!drawId) { console.error('Usage: --draw-id <id> --version <n> [--only "Participant Name"] [--receipt <path>] [--dry-run]'); process.exit(1); }
  if (receiptPath && !fs.existsSync(receiptPath)) { console.error(`Receipt file not found: ${receiptPath}`); process.exit(1); }

  const draw = loadDrawSnapshot(drawId);
  if (!draw) { console.error(`Draw ${drawId} not found`); process.exit(1); }
  const tickets = ticketsFromDraw(draw);
  const eligible = eligibleRecipients(draw.participants);

  // Computed ONCE and reused for both the files written to disk below AND the actual
  // send further down (passed through as publishedAtUtc) — otherwise buildTicketPublication
  // Payload's own `new Date().toISOString()` default would run twice a few ms apart,
  // producing two different manifest hashes for byte-identical ticket data. That's exactly
  // what happened on the first version of this fix: the hash quoted in the delivered email
  // didn't match the hash of the file actually hosted at the linked URL.
  const publishedAtUtc = new Date().toISOString();

  const { shared } = buildTicketPublicationPayload({
    draw, participants: eligible, tickets, publicationVersion, publishedAtUtc,
    proofUrl: undefined, // no URL ever exists for this bolão — see operatorAttestation instead
  });

  const outDir = path.join(__dirname, "generated", `${drawId}-v${publicationVersion}`);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "manifest.json");
  const csvPath = path.join(outDir, "tickets.csv");
  const pdfPath = path.join(outDir, "tickets.pdf");

  fs.writeFileSync(jsonPath, JSON.stringify(shared.manifest, null, 2));
  fs.writeFileSync(csvPath, manifestToCsv(shared.manifest));

  // Public, git-tracked copies — EmailJS's REST API has no attachment mechanism (confirmed:
  // send.mjs's request body only ever had `template_params`, never `attachments`), so a real
  // send on 2026-08-10 went out claiming the PDF/CSV were "anexados" when nothing was actually
  // attached (Eduardo caught it reading the delivered email). The fix is to host these files
  // as ordinary static assets on this app's own GitHub Pages path and link to them from the
  // email body instead. The ticket numbers/serials themselves are already public via js/data.js
  // (declared exposure HA-4, scripts/audit_pii_repo_wide.mjs) — publishing the same numbers a
  // second time here as static files is not a new decision, just the same already-accepted risk.
  //
  // IMPORTANT: these files must be committed AND PUSHED before the real send runs, or the links
  // in the email will 404 until the next deploy. This script only writes them; committing/pushing
  // is a separate, visible step (see CLAUDE.md git discipline) — never done silently by this script.
  const publicDir = path.join(__dirname, "..", "..", "tickets", `${drawId}-v${publicationVersion}`);
  fs.mkdirSync(publicDir, { recursive: true });
  const publicJsonPath = path.join(publicDir, "manifest.json");
  const publicCsvPath = path.join(publicDir, "tickets.csv");
  const publicPdfPath = path.join(publicDir, "tickets.pdf");
  fs.writeFileSync(publicJsonPath, JSON.stringify(shared.manifest, null, 2));
  fs.writeFileSync(publicCsvPath, manifestToCsv(shared.manifest));

  const SITE_BASE = "https://www.ferrarilabs.com/bolao/loterias/powerball";
  const ticketsPdfUrl = `${SITE_BASE}/tickets/${drawId}-v${publicationVersion}/tickets.pdf`;
  const ticketsCsvUrl = `${SITE_BASE}/tickets/${drawId}-v${publicationVersion}/tickets.csv`;
  const ticketsManifestUrl = `${SITE_BASE}/tickets/${drawId}-v${publicationVersion}/manifest.json`;

  const pdfBytes = buildTextPdf(ticketPublicationPdfBlocks({
    drawId: draw.id,
    publicationVersion,
    isCorrection: false,
    drawDateLabel: draw.drawing.drawDateLabel,
    manifestHash: shared.manifestHash,
    financialSummary: shared.financialSummary,
    tickets: shared.tickets,
    generatedAtUtc: shared.generatedAtUtc,
  }), { title: "Powerball tickets" });
  fs.writeFileSync(pdfPath, pdfBytes);
  fs.writeFileSync(publicPdfPath, pdfBytes);

  let receiptNote = "";
  if (receiptPath) {
    const receiptBytes = fs.readFileSync(receiptPath);
    const receiptDestName = "comprovante" + path.extname(receiptPath);
    const receiptDestPath = path.join(outDir, receiptDestName);
    fs.writeFileSync(receiptDestPath, receiptBytes);
    const receiptHash = crypto.createHash("sha256").update(receiptBytes).digest("hex");
    console.log(`  - ${receiptDestPath} (real receipt, copied from ${receiptPath})`);
    console.log(`  Receipt SHA-256: ${receiptHash}`);
    receiptNote = ` Comprovante original (PDF da loteria/banco) copiado como ${receiptDestName}, SHA-256 ${receiptHash.slice(0, 16)}…`;
  }

  console.log(`Generated evidence files in ${outDir}:`);
  console.log(`  - ${jsonPath}`);
  console.log(`  - ${csvPath}`);
  console.log(`  - ${pdfPath}`);
  console.log(`  Manifest SHA-256: ${shared.manifestHash}`);
  console.log(`\nPublic (git-tracked) copies in ${publicDir} — COMMIT AND PUSH these before sending, or the links below 404:`);
  console.log(`  - ${publicJsonPath}`);
  console.log(`  - ${publicCsvPath}`);
  console.log(`  - ${publicPdfPath}`);
  console.log(`  PDF:      ${ticketsPdfUrl}`);
  console.log(`  CSV:      ${ticketsCsvUrl}`);
  console.log(`  Manifest: ${ticketsManifestUrl}`);

  const operatorAttestation =
    `Comprovantes de ${tickets.length} bilhetes (séries do sorteio ${draw.id}) colados por Eduardo Ferrari ` +
    `diretamente na conversa e transcritos para js/data.js; cada bilhete conferido individualmente contra o ` +
    `texto colado antes do commit.${receiptNote} Nenhum link público existe para este comprovante — ver nota em ` +
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
  //
  // dry-run gets its OWN file, never the real one (bug found 2026-08-10): a --dry-run
  // still calls enqueueEmailJob (that's how it proves the idempotency key/payload shape
  // without sending), which persisted a "pending" job under the exact idempotency key the
  // REAL send for the same draw-id/version would later reuse — so the real send saw
  // `created: false`, silently treated the recipient as already-deduped, and never called
  // EmailJS at all. Twice, on two different draws, both reported as "FAILED: undefined"
  // (a deduped push has no `ok`/`error` field, so the CLI's `r.ok ? "sent" : "FAILED: " +
  // r.error` prints that for a case that isn't really a failure). Separating the files
  // makes a dry-run structurally unable to block a later real send for the same job.
  const realOutboxFile = path.join(outDir, dryRun ? "outbox.dryrun.json" : "outbox.json");

  const result = await runPublishTickets({
    drawId,
    publicationVersion,
    testMode: false,
    dryRun,
    onlyParticipant,
    operatorAttestation,
    outboxFile: realOutboxFile,
    attachments: [
      { kind: "pdf", filePath: pdfPath },
      { kind: "csv", filePath: csvPath },
      { kind: "json", filePath: jsonPath },
    ],
    ticketsPdfUrl,
    ticketsCsvUrl,
    ticketsManifestUrl,
    publishedAtUtc,
  });

  console.log("\n" + (dryRun ? "DRY RUN RESULT" : "SEND RESULT") + (onlyParticipant ? ` (restricted to: ${onlyParticipant})` : "") + ":");
  console.log("ok:", result.ok);
  if (!result.ok) {
    console.log("errors:", JSON.stringify(result.errors, null, 2));
    process.exit(1);
  }
  console.log("recipients:", result.results.length);
  // A `deduped: true` result (same idempotencyKey already recorded — a legitimate re-run
  // safety net, not a failure) has no `ok`/`error` field. Report it as its own case instead
  // of falling into the FAILED branch and printing the misleading "FAILED: undefined".
  result.results.forEach((r) => console.log(
    `  - ${r.participant}: ${dryRun ? "(dry-run)" : r.deduped ? "already sent (deduped, same idempotency key)" : r.ok ? "sent" : "FAILED: " + r.error}`
  ));
}

main();
