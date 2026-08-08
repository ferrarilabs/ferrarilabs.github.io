#!/usr/bin/env node
// Flow B trigger — "Publicar bilhetes e notificar participantes". CLI equivalent
// of the admin action described in the spec (this app has no web admin panel;
// see send_participant_confirmation.mjs header for the same note).
//
// One job per eligible recipient (active, cotas>0, valid email, not cancelled);
// a multi-cota participant still gets exactly one email because eligibility is
// computed on the participant list, not on cotas.

import fs from "node:fs";
import { loadDrawSnapshot } from "./snapshot.mjs";
import { validateTicketPublication, eligibleRecipients, validateAttachmentsAndLinks } from "./validate.mjs";
import { buildTicketPublicationPayload, manifestToCsv } from "./payload.mjs";
import { renderTicketPublicationSubject, renderTicketPublicationHtml, renderTicketPublicationText } from "./render.mjs";
import { enqueueEmailJob, recordEmailResult, idempotencyKeyForPublication } from "./outbox.mjs";
import { sendEmailJob } from "./send.mjs";
import { buildTextPdf } from "./pdf.mjs";

const EMAILJS = {
  publicKey: "GBZFujsJBET6modve",
  serviceId: "service_o4hyzxr",
  templateId: "template_xq7yzzb",
};

export function ticketsFromDraw(draw) {
  const out = [];
  (draw.sharedTickets ? draw.sharedTickets.series : []).forEach((s) => {
    (s.numeros || []).forEach((str) => {
      const m = str.match(/^([\d\s-]+?)\s*—\s*PB\s*(\d+)$/);
      if (m) out.push({ numbers: m[1].split("-").map(Number), special: Number(m[2]), serial: s.serial });
    });
  });
  return out;
}

export async function runPublishTickets({ drawId, publicationVersion, testMode, overrideRecipient, proofUrl, operatorAttestation, attachments, correctionReason, previousHash, previousTickets, outboxFile, dryRun, syntheticDraw }) {
  const draw = syntheticDraw || loadDrawSnapshot(drawId);
  const tickets = (syntheticDraw && syntheticDraw.__tickets) ? syntheticDraw.__tickets : ticketsFromDraw(draw);
  const participants = draw.participants;
  const eligible = eligibleRecipients(participants);

  const validation = validateTicketPublication({ draw, participants: eligible, tickets });
  if (!validation.ok) return { ok: false, errors: validation.errors, invalidRecipients: validation.invalidRecipients };

  // Production attachment/link gate (Eduardo, round 4) — applies to REAL
  // sends only. The fixture-driven admin test path intentionally uses
  // example.invalid as a documented placeholder and must not be blocked by
  // this; a real (non-test) send with the same placeholder MUST be blocked.
  //
  // operatorAttestation/attachments (Eduardo, 2026-08-08): this app's real
  // proof is never a URL — Eduardo pastes the lottery/bank receipt into the
  // conversation, transcribed into js/data.js there. Both params default to
  // undefined/[] so every EXISTING caller (all current tests, none of which
  // pass either) sees byte-identical behavior to before this change; only a
  // caller that explicitly builds real local PDF/CSV/JSON files and passes
  // them (see scripts/email/send_ticket_publication_real.mjs) uses this path.
  if (!testMode) {
    const attachmentCheck = validateAttachmentsAndLinks(
      { proofUrl, operatorAttestation, attachments: attachments || [] },
      (p) => fs.existsSync(p)
    );
    if (!attachmentCheck.ok) {
      return { ok: false, errors: attachmentCheck.errors, blockedBy: "validateAttachmentsAndLinks" };
    }
  }

  // Correction path: never send from a typed description disconnected from
  // the data — the diff must be real, and if nothing actually changed we
  // block creation of the correction email entirely (round-1 bug 3).
  if (correctionReason) {
    if (!previousTickets) return { ok: false, errors: ["CORRECTION_MISSING_PREVIOUS_TICKETS"] };
    const { computeTicketDiff } = await import("./diff.mjs");
    const diff = computeTicketDiff(previousTickets, tickets);
    if (!diff.hasDiff) {
      return {
        ok: false,
        errors: ["NO_DIFF"],
        message: `Não existem diferenças entre as versões ${publicationVersion} e ${publicationVersion - 1}. Nenhum e-mail de correção foi criado.`,
      };
    }
  }

  const { shared, perRecipient } = buildTicketPublicationPayload({
    draw, participants: eligible, tickets, publicationVersion, proofUrl, correctionReason, previousHash, previousTickets,
  });

  const results = [];
  for (const payload of perRecipient) {
    const idempotencyKey = idempotencyKeyForPublication(draw.gameType, draw.id, publicationVersion, payload.templateVersion) + `:${payload.participantId}`;
    const { job, created } = enqueueEmailJob({
      poolId: draw.gameType,
      drawId: draw.id,
      participantId: payload.participantId,
      eventType: payload.templateId,
      recipient: testMode ? (overrideRecipient || "emferrari@gmail.com") : payload.recipient,
      templateId: payload.templateId,
      templateVersion: payload.templateVersion,
      payloadSnapshot: payload,
      idempotencyKey,
      testMode: !!testMode,
    }, outboxFile);

    if (!created) { results.push({ participant: payload.participantId, deduped: true, job }); continue; }

    const subject = renderTicketPublicationSubject(payload, testMode);
    const html = renderTicketPublicationHtml(payload, testMode);
    const text = renderTicketPublicationText(payload, testMode);

    if (dryRun) { results.push({ participant: payload.participantId, job, subject, html, text, dryRun: true }); continue; }

    const sendResult = await sendEmailJob(job, { ...EMAILJS, htmlMessage: html, subject });
    const recorded = recordEmailResult(job.emailJobId, sendResult, outboxFile);
    results.push({ participant: payload.participantId, ok: sendResult.ok, job: recorded, subject, html, text, error: sendResult.error });

    if (testMode) break; // only one representative test send in test mode
  }

  const csv = manifestToCsv(shared.manifest);
  const pdfLines = [
    `Powerball — ${shared.templateId === "tickets-corrected" ? "CORREÇÃO" : "Bilhetes publicados"}`,
    `Draw: ${draw.id}  Versão: ${publicationVersion}`,
    `Hash SHA-256: ${shared.manifestHash}`,
    "",
    "Resumo financeiro:",
    ...Object.entries(shared.financialSummary).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Tickets:",
    ...shared.tickets.map((t, i) => `  #${i + 1}: ${t.numbers.join("-")} — PB ${t.special}`),
  ];
  const pdf = buildTextPdf(pdfLines, { title: "Powerball tickets" });

  return { ok: true, shared, results, csv, pdf, manifest: shared.manifest };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runPublishTickets({
    drawId: args["draw-id"],
    publicationVersion: Number(args["version"] || 1),
    testMode: !!args["test"],
    overrideRecipient: args["to"],
    proofUrl: args["proof-url"],
  }).then((r) => { console.log(JSON.stringify({ ...r, pdf: r.pdf ? `<${r.pdf.length} bytes>` : undefined }, null, 2)); process.exit(r.ok ? 0 : 1); });
}
