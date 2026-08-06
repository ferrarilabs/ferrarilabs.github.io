#!/usr/bin/env node
// run_fixture_test_sends.mjs — the ONLY path used for the 3 mandated
// [TESTE ADMIN] sends. Loads the single shared fixture
// (fixtures/powerball-email-test-fixture.json), validates its internal
// consistency AND cross-template consistency between all three payloads
// built from it, and only then sends. This is what round 1 was missing:
// confirmation/publication/correction here are built from the exact same
// snapshot, so they cannot disagree on totalShares/date/jackpot.

import { loadFixture, validateFixtureConsistency, fixtureAsDraw } from "./fixture.mjs";
import { loadRealPrizeCalculator } from "./prize-calc-bridge.mjs";
import { validateParticipantConfirmation, validateTicketPublication, validateCrossTemplateConsistency, validateFinancialReconciliation } from "./validate.mjs";
import { buildParticipantConfirmationPayload, buildTicketPublicationPayload } from "./payload.mjs";
import {
  renderParticipantConfirmationSubject, renderParticipantConfirmationHtml, renderParticipantConfirmationText,
  renderTicketPublicationSubject, renderTicketPublicationHtml, renderTicketPublicationText,
} from "./render.mjs";
import { computeTicketDiff } from "./diff.mjs";
import { enqueueEmailJob, recordEmailResult, idempotencyKeyForParticipant, idempotencyKeyForPublication } from "./outbox.mjs";
import { sendEmailJob } from "./send.mjs";

const EMAILJS = { publicKey: "GBZFujsJBET6modve", serviceId: "service_o4hyzxr", templateId: "template_xq7yzzb" };

export async function buildAllThreeFromFixture(fixturePath) {
  const fx = loadFixture(fixturePath);
  const fxCheck = validateFixtureConsistency(fx);
  if (!fxCheck.ok) return { ok: false, stage: "fixture", errors: fxCheck.errors };

  const { calculatePrizePerParticipant } = loadRealPrizeCalculator();
  const testParticipant = fx.participants[0]; // Participante Alfa

  // --- confirmation ---
  const drawV1 = fixtureAsDraw(fx, 1);
  const estimates = calculatePrizePerParticipant(drawV1, testParticipant);
  const confirmValidation = validateParticipantConfirmation({ participant: testParticipant, draw: drawV1, estimates });
  if (!confirmValidation.ok) return { ok: false, stage: "confirmation-validation", errors: confirmValidation.errors };
  const confirmPayload = buildParticipantConfirmationPayload({ participant: testParticipant, draw: drawV1, estimates });

  // --- publication (v1) ---
  const v1Tickets = fx.ticketVersions["1"];
  const pubValidation = validateTicketPublication({ draw: drawV1, participants: fx.participants, tickets: v1Tickets });
  if (!pubValidation.ok) return { ok: false, stage: "publication-validation", errors: pubValidation.errors };
  const { perRecipient: pubPerRecipient } = buildTicketPublicationPayload({
    draw: drawV1, participants: fx.participants, tickets: v1Tickets, publicationVersion: 1, proofUrl: fx.sharedTickets.proofUrl,
  });
  const pubPayload = pubPerRecipient.find((p) => p.participantId === testParticipant.name);

  // --- correction (v2) ---
  const v2Tickets = fx.ticketVersions["2"];
  const diff = computeTicketDiff(v1Tickets, v2Tickets);
  if (!diff.hasDiff) {
    return { ok: false, stage: "correction-diff", errors: ["NO_DIFF"], message: "Não existem diferenças entre as versões 1 e 2. Nenhum e-mail de correção foi criado." };
  }
  const drawV2 = fixtureAsDraw(fx, 2);
  const v2Validation = validateTicketPublication({ draw: drawV2, participants: fx.participants, tickets: v2Tickets });
  if (!v2Validation.ok) return { ok: false, stage: "correction-validation", errors: v2Validation.errors };
  const v1ManifestHash = pubPerRecipient[0].manifestHash;
  const { perRecipient: corrPerRecipient } = buildTicketPublicationPayload({
    draw: drawV2, participants: fx.participants, tickets: v2Tickets, publicationVersion: 2,
    correctionReason: fx.corrections["2"].reason, previousHash: v1ManifestHash, previousTickets: v1Tickets,
  });
  const corrPayload = corrPerRecipient.find((p) => p.participantId === testParticipant.name);

  // --- cross-template consistency gate (round-1 bug 1) ---
  const crossCheck = validateCrossTemplateConsistency([confirmPayload, pubPayload, corrPayload]);
  if (!crossCheck.ok) return { ok: false, stage: "cross-template-consistency", errors: crossCheck.errors };

  // --- reconciliation sanity (round-1 bug 2), re-checked at this layer too ---
  const reconCheck = validateFinancialReconciliation(fx.finance);
  if (!reconCheck.ok) return { ok: false, stage: "financial-reconciliation", errors: reconCheck.errors };

  return { ok: true, fx, confirmPayload, pubPayload, corrPayload, diff };
}

export async function sendAllThreeTestEmails({ fixturePath, outboxFile, recipient = "emferrari@gmail.com", dryRun = false } = {}) {
  const built = await buildAllThreeFromFixture(fixturePath);
  if (!built.ok) return built;

  const { confirmPayload, pubPayload, corrPayload } = built;
  const sends = [];

  async function sendOne(payload, eventType, idKey, subjectFn, htmlFn, textFn) {
    const { job, created } = enqueueEmailJob({
      poolId: payload.poolId, drawId: payload.drawId, participantId: payload.participantId,
      eventType, recipient, templateId: payload.templateId, templateVersion: payload.templateVersion,
      payloadSnapshot: payload, idempotencyKey: idKey, testMode: true,
    }, outboxFile);
    const subject = subjectFn(payload, true);
    const html = htmlFn(payload, true);
    const text = textFn(payload, true);
    if (!created) return { eventType, deduped: true, job, subject };
    if (dryRun) return { eventType, job, subject, html, text, dryRun: true };
    const result = await sendEmailJob(job, { ...EMAILJS, htmlMessage: html, subject });
    const recorded = recordEmailResult(job.emailJobId, result, outboxFile);
    return { eventType, ok: result.ok, job: recorded, subject, providerStatus: result.providerStatus, error: result.error };
  }

  sends.push(await sendOne(
    confirmPayload, "participant-added",
    idempotencyKeyForParticipant(confirmPayload.poolId, confirmPayload.participantId, confirmPayload.templateVersion) + ":fixturetest",
    renderParticipantConfirmationSubject, renderParticipantConfirmationHtml, renderParticipantConfirmationText,
  ));
  sends.push(await sendOne(
    pubPayload, "tickets-published",
    idempotencyKeyForPublication(pubPayload.poolId, pubPayload.drawId, pubPayload.publicationVersion, pubPayload.templateVersion) + `:${pubPayload.participantId}:fixturetest`,
    renderTicketPublicationSubject, renderTicketPublicationHtml, renderTicketPublicationText,
  ));
  sends.push(await sendOne(
    corrPayload, "tickets-corrected",
    idempotencyKeyForPublication(corrPayload.poolId, corrPayload.drawId, corrPayload.publicationVersion, corrPayload.templateVersion) + `:${corrPayload.participantId}:fixturetest`,
    renderTicketPublicationSubject, renderTicketPublicationHtml, renderTicketPublicationText,
  ));

  return { ok: sends.every((s) => s.ok || s.dryRun || s.deduped), sends, fx: built.fx };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  sendAllThreeTestEmails({}).then((r) => {
    console.log(JSON.stringify(r, (k, v) => (k === "html" || k === "text" ? undefined : v), 2));
    process.exit(r.ok ? 0 : 1);
  });
}
