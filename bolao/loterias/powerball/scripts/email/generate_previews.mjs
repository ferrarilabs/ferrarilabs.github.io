#!/usr/bin/env node
// Generates the required evidence files under email-previews/ using fully
// synthetic data (Participante Alfa / Carolina do Norte / REDACTED_PAYMENT_REFERENCE).
// dryRun only — no network calls, no outbox writes against the real file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDrawSnapshot } from "./snapshot.mjs";
import { loadRealPrizeCalculator } from "./prize-calc-bridge.mjs";
import { buildParticipantConfirmationPayload, buildTicketPublicationPayload, manifestToCsv } from "./payload.mjs";
import {
  renderParticipantConfirmationHtml, renderParticipantConfirmationText,
  renderTicketPublicationHtml, renderTicketPublicationText,
} from "./render.mjs";
import { buildTextPdf } from "./pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "..", "email-previews");
fs.mkdirSync(OUT, { recursive: true });

const { calculatePrizePerParticipant, DRAWS } = loadRealPrizeCalculator();
const draw = loadDrawSnapshot(DRAWS[DRAWS.length - 1].id);

const synthParticipant = {
  name: "Participante Alfa",
  email: "participante.alfa@example.invalid",
  cotas: 1,
  valor: 10,
  metodo: "Zelle",
  data: "04/08/2026",
  hora: "9:00 AM",
  txId: "REDACTED_PAYMENT_REFERENCE",
  status: "verificado",
  state: "NC",
};
const draftDraw = { ...draw, participants: [...draw.participants, synthParticipant] };
const estimates = calculatePrizePerParticipant(draftDraw, synthParticipant);
const confirmPayload = buildParticipantConfirmationPayload({ participant: synthParticipant, draw: draftDraw, estimates });

fs.writeFileSync(path.join(OUT, "participant-added-desktop.html"), renderParticipantConfirmationHtml(confirmPayload, true));
fs.writeFileSync(path.join(OUT, "participant-added-text.txt"), renderParticipantConfirmationText(confirmPayload, true));

// Publication / correction previews
const tickets = [
  { numbers: [1, 14, 27, 36, 63], special: 25, serial: "S-EXAMPLE-1" },
  { numbers: [4, 11, 22, 45, 61], special: 9, serial: "S-EXAMPLE-1" },
];
const { shared: pubShared, perRecipient: pubPer } = buildTicketPublicationPayload({
  draw: draftDraw, participants: [synthParticipant], tickets, publicationVersion: 1, proofUrl: "https://example.invalid/proof.jpg",
});
fs.writeFileSync(path.join(OUT, "tickets-published-desktop.html"), renderTicketPublicationHtml(pubPer[0], true));
fs.writeFileSync(path.join(OUT, "tickets-published-text.txt"), renderTicketPublicationText(pubPer[0], true));
fs.writeFileSync(path.join(OUT, "manifest-example.json"), JSON.stringify(pubShared.manifest, null, 2) + "\n");
fs.writeFileSync(path.join(OUT, "manifest-example.csv"), manifestToCsv(pubShared.manifest));

const pdfLines = [
  "Powerball — Bilhetes publicados (EXEMPLO SINTÉTICO)",
  `Draw: ${draftDraw.id}  Versão: 1`,
  `Hash SHA-256: ${pubShared.manifestHash}`,
  "",
  "Resumo financeiro:",
  ...Object.entries(pubShared.financialSummary).map(([k, v]) => `  ${k}: ${v}`),
  "",
  "Tickets:",
  ...pubShared.tickets.map((t, i) => `  #${i + 1}: ${t.numbers.join("-")} — PB ${t.special}`),
];
fs.writeFileSync(path.join(OUT, "tickets-published.pdf"), buildTextPdf(pdfLines, { title: "Powerball tickets (example)" }));

// Correction preview (v2, distinct hash)
const correctedTickets = [
  { numbers: [1, 14, 27, 36, 64], special: 25, serial: "S-EXAMPLE-1" }, // 63 -> 64 typo fix
  { numbers: [4, 11, 22, 45, 61], special: 9, serial: "S-EXAMPLE-1" },
];
const { perRecipient: corrPer } = buildTicketPublicationPayload({
  draw: draftDraw, participants: [synthParticipant], tickets: correctedTickets, publicationVersion: 2,
  correctionReason: "Corrigido número 63→64 no primeiro bilhete (erro de digitação no cadastro).",
  previousHash: pubShared.manifestHash,
});
fs.writeFileSync(path.join(OUT, "tickets-correction-desktop.html"), renderTicketPublicationHtml(corrPer[0], true));
fs.writeFileSync(path.join(OUT, "tickets-correction-text.txt"), renderTicketPublicationText(corrPer[0], true));

console.log("Previews written to", OUT);
