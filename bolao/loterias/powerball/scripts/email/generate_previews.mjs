#!/usr/bin/env node
// Generates the required evidence files under email-previews/ from the SAME
// validated fixture used for the real [TESTE ADMIN] sends
// (fixtures/powerball-email-test-fixture.json) — so the previews Eduardo
// reviews are byte-for-byte what gets sent, not a separately-typed sample.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllThreeFromFixture } from "./run_fixture_test_sends.mjs";
import {
  renderParticipantConfirmationHtml, renderParticipantConfirmationText,
  renderTicketPublicationHtml, renderTicketPublicationText,
} from "./render.mjs";
import { manifestToCsv } from "./payload.mjs";
import { buildTextPdf } from "./pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "..", "email-previews");
fs.mkdirSync(OUT, { recursive: true });

const built = await buildAllThreeFromFixture();
if (!built.ok) {
  console.error("Fixture failed validation, cannot generate previews:", built.stage, built.errors, built.message);
  process.exit(1);
}
const { confirmPayload, pubPayload, corrPayload } = built;

fs.writeFileSync(path.join(OUT, "participant-confirmation-desktop.html"), renderParticipantConfirmationHtml(confirmPayload, true));
fs.writeFileSync(path.join(OUT, "participant-confirmation-text.txt"), renderParticipantConfirmationText(confirmPayload, true));

fs.writeFileSync(path.join(OUT, "tickets-published-desktop.html"), renderTicketPublicationHtml(pubPayload, true));
fs.writeFileSync(path.join(OUT, "tickets-published-text.txt"), renderTicketPublicationText(pubPayload, true));
fs.writeFileSync(path.join(OUT, "manifest-example.json"), JSON.stringify(pubPayload.manifest, null, 2) + "\n");
fs.writeFileSync(path.join(OUT, "manifest-example.csv"), manifestToCsv(pubPayload.manifest));

const pubPdfLines = [
  "Powerball — Bilhetes publicados (FIXTURE SINTÉTICA)",
  `Draw: ${pubPayload.drawId}  Versão: ${pubPayload.publicationVersion}`,
  `Hash SHA-256: ${pubPayload.manifestHash}`,
  "",
  "Resumo financeiro:",
  ...Object.entries(pubPayload.financialSummary).map(([k, v]) => `  ${k}: ${v}`),
  "",
  "Jogos:",
  ...pubPayload.tickets.map((t, i) => `  Jogo ${String(i + 1).padStart(2, "0")}: ${t.numbers.join(" ")}  Powerball ${t.special}`),
];
fs.writeFileSync(path.join(OUT, "tickets-published.pdf"), buildTextPdf(pubPdfLines, { title: "Powerball tickets (fixture)" }));

fs.writeFileSync(path.join(OUT, "tickets-correction-desktop.html"), renderTicketPublicationHtml(corrPayload, true));
fs.writeFileSync(path.join(OUT, "tickets-correction-text.txt"), renderTicketPublicationText(corrPayload, true));

const corrPdfLines = [
  `Powerball — Correção dos bilhetes — Versão ${corrPayload.publicationVersion} (FIXTURE SINTÉTICA)`,
  `Hash anterior: ${corrPayload.previousHash}`,
  `Hash novo: ${corrPayload.manifestHash}`,
  "",
  "O que foi alterado:",
  ...corrPayload.diff.changed.map((c) => `  Jogo ${String(c.index + 1).padStart(2, "0")}: ${c.beforeText} -> ${c.afterText}`),
];
fs.writeFileSync(path.join(OUT, "tickets-correction.pdf"), buildTextPdf(corrPdfLines, { title: "Powerball correction (fixture)" }));

console.log("Previews written to", OUT, "(round 2, fixture-driven)");
