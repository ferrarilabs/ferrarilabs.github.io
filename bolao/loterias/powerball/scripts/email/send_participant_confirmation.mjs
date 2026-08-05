#!/usr/bin/env node
// Flow A trigger — CLI (this app has no browser admin panel; participants are
// added via scripts/add_participants.py / add-participant.js, so this mirrors
// that convention rather than inventing a web admin UI for one action).
//
// Usage:
//   node send_participant_confirmation.mjs --draw-id 2026-08-05 --participant "Jane Doe" [--test] [--to override@example.com]
//
// --test sends to POWERBALL_CONFIG.adminEmail (or --to) with [TESTE ADMIN] prefix,
// testMode=true recorded in the outbox, and payload content still describing the
// real participant/synthetic participant passed in — used for the 3 required
// pre-activation test sends with fully synthetic data.

import { loadDrawSnapshot, loadParticipantSnapshot, loadFinancialEstimates } from "./snapshot.mjs";
import { validateParticipantConfirmation } from "./validate.mjs";
import { buildParticipantConfirmationPayload } from "./payload.mjs";
import { renderParticipantConfirmationSubject, renderParticipantConfirmationHtml, renderParticipantConfirmationText } from "./render.mjs";
import { enqueueEmailJob, recordEmailResult, idempotencyKeyForParticipant } from "./outbox.mjs";
import { sendEmailJob } from "./send.mjs";

const EMAILJS = {
  publicKey: "GBZFujsJBET6modve",
  serviceId: "service_o4hyzxr",
  templateId: "template_xq7yzzb",
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

export async function runParticipantConfirmation({ drawId, participantName, testMode, overrideRecipient, overrideParticipant, outboxFile, dryRun }) {
  const draw = loadDrawSnapshot(drawId);
  let participant = loadParticipantSnapshot(drawId, participantName);
  if (overrideParticipant) participant = { ...participant, ...overrideParticipant };
  const estimates = participant && draw ? (overrideParticipant ? computeOverrideEstimates(draw, participant) : loadFinancialEstimates(drawId, participantName)) : null;

  const validation = validateParticipantConfirmation({ participant, draw, estimates });
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, retryAction: "Reenviar confirmação de entrada" };
  }

  const payload = buildParticipantConfirmationPayload({ participant, draw, estimates });
  const templateVersion = payload.templateVersion;
  const idempotencyKey = idempotencyKeyForParticipant(draw.gameType, participant.name, templateVersion);
  const { job, created } = enqueueEmailJob({
    poolId: draw.gameType,
    drawId: draw.id,
    participantId: participant.name,
    eventType: "participant-added",
    recipient: testMode ? (overrideRecipient || "emferrari@gmail.com") : participant.email,
    templateId: "participant-added",
    templateVersion,
    payloadSnapshot: payload,
    idempotencyKey,
    testMode: !!testMode,
  }, outboxFile);

  if (!created) {
    return { ok: true, deduped: true, job };
  }

  const subject = renderParticipantConfirmationSubject(payload, testMode);
  const html = renderParticipantConfirmationHtml(payload, testMode);
  const text = renderParticipantConfirmationText(payload, testMode);

  if (dryRun) {
    return { ok: true, job, subject, html, text, dryRun: true };
  }

  const result = await sendEmailJob(job, { ...EMAILJS, htmlMessage: html, subject });
  const recorded = recordEmailResult(job.emailJobId, result, outboxFile);
  return { ok: result.ok, job: recorded, subject, html, text, providerStatus: result.providerStatus, error: result.error };
}

function computeOverrideEstimates(draw, participant) {
  // Only used for synthetic test payloads where the participant does not exist
  // in real data.js (Flow A test uses "Participante Alfa" / Carolina do Norte).
  // Still reuses the real calculatePrizePerParticipant — just against a synthetic
  // participant object, not synthetic math.
  const { loadRealPrizeCalculator } = importSyncBridge();
  const { calculatePrizePerParticipant } = loadRealPrizeCalculator();
  const draftDraw = { ...draw, participants: [...draw.participants.filter((p) => p.name !== participant.name), participant] };
  return calculatePrizePerParticipant(draftDraw, participant);
}
import { loadRealPrizeCalculator } from "./prize-calc-bridge.mjs";
function importSyncBridge() { return { loadRealPrizeCalculator }; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runParticipantConfirmation({
    drawId: args["draw-id"],
    participantName: args["participant"],
    testMode: !!args["test"],
    overrideRecipient: args["to"],
  }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
