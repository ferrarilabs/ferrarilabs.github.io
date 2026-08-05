#!/usr/bin/env node
// send_participant_confirmation_backfill.mjs — one-time backfill: send the
// participant-confirmation email to every CURRENT eligible participant of a
// given draw who hasn't received one yet. Explicitly authorized by Eduardo
// (relayed via the coordinator) for the 2026-08-05 draw, same day as the
// drawing. This is NOT part of the normal per-add trigger (which sends one
// email at the moment a participant is added) — it's a backfill for
// existing participants who were added before this email flow existed.
//
// Ledger: a private, NEVER-COMMITTED JSON file (default
// ~/Desktop/powerball-confirmation-send-<drawId>.json) tracks per-participant
// send status so re-running this script never double-sends. Checked before
// every single send.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAllDraws } from "./snapshot.mjs";
import { eligibleRecipients, validateParticipantConfirmation } from "./validate.mjs";
import { loadRealPrizeCalculator } from "./prize-calc-bridge.mjs";
import { buildParticipantConfirmationPayload } from "./payload.mjs";
import { renderParticipantConfirmationSubject, renderParticipantConfirmationHtml, renderParticipantConfirmationText } from "./render.mjs";
import { sendEmailJob } from "./send.mjs";

const EMAILJS = { publicKey: "GBZFujsJBET6modve", serviceId: "service_o4hyzxr", templateId: "template_xq7yzzb" };
const MAX_RETRIES = 2;
const THROTTLE_MS = 1200;

export function idempotencyKeyForBackfill(participantId) {
  return `powerball:participant-confirmation-backfill:v1:${participantId}`;
}

export function maskEmail(email) {
  if (!email || !email.includes("@")) return "—";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0] || "*"}*@${domain}`;
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function loadLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return {};
  try { return JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { return {}; }
}
function saveLedger(ledgerPath, ledger) {
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
}

/** Builds the eligible list + payloads, no sending. Safe to call repeatedly. */
export function computeEligibility(drawId) {
  const draws = loadAllDraws();
  const draw = draws.find((d) => d.id === drawId);
  if (!draw) return { ok: false, error: `Draw ${drawId} not found` };

  const eligible = eligibleRecipients(draw.participants);
  const excluded = draw.participants
    .filter((p) => !eligible.includes(p))
    .map((p) => ({ name: p.name, reason: !p.email || p.email === "—" || !p.email.includes("@") ? "INVALID_EMAIL" : (p.status === "cancelado" ? "CANCELLED" : (!(p.cotas > 0) ? "NO_COTAS" : "UNKNOWN")) }));

  // Duplicate detection among eligible.
  const emailCounts = {};
  const nameCounts = {};
  eligible.forEach((p) => {
    const e = p.email.toLowerCase();
    emailCounts[e] = (emailCounts[e] || 0) + 1;
    nameCounts[p.name] = (nameCounts[p.name] || 0) + 1;
  });
  const duplicateEmails = Object.entries(emailCounts).filter(([, c]) => c > 1).map(([e]) => e);
  const duplicateNames = Object.entries(nameCounts).filter(([, c]) => c > 1).map(([n]) => n);

  // State-support check per participant (blocks estimate, not the whole batch —
  // reported individually).
  const { calculatePrizePerParticipant } = loadRealPrizeCalculator();
  const stateBlocked = [];
  eligible.forEach((p) => {
    const estimates = calculatePrizePerParticipant(draw, p);
    const v = validateParticipantConfirmation({ participant: p, draw, estimates });
    if (!v.ok) stateBlocked.push({ name: p.name, errors: v.errors });
  });

  const totalCotas = eligible.reduce((s, p) => s + (p.cotas || 0), 0);
  const totalValor = eligible.reduce((s, p) => s + (p.valor || 0), 0);

  return {
    ok: true,
    draw,
    eligible,
    excluded,
    duplicateEmails,
    duplicateNames,
    stateBlocked,
    totalCotas,
    totalValor,
  };
}

export function financialReconciliation(draw) {
  const f = draw.finance;
  const totalPaid = (f.totalArrecadado || 0) + (f.creditoSorteioAnterior || 0);
  const totalSpent = f.valorUtilizado || 0;
  const remainingBalance = f.valorGuardadoProximoSorteio || 0;
  const difference = Number((totalPaid - totalSpent - remainingBalance).toFixed(2));
  const sumParticipantValor = draw.participants.reduce((s, p) => s + (p.valor || 0), 0);
  return {
    totalParticipants: draw.participants.length,
    totalShares: draw.participants.reduce((s, p) => s + (p.cotas || 0), 0),
    totalArrecadado: f.totalArrecadado,
    creditoSorteioAnterior: f.creditoSorteioAnterior || 0,
    totalPaid,
    totalSpent,
    remainingBalance,
    difference,
    reconciled: difference === 0,
    sumParticipantValorMatchesArrecadado: sumParticipantValor === f.totalArrecadado,
    sumParticipantValor,
  };
}

export async function runBackfill({ drawId, ledgerPath, dryRun = true, singleParticipant = null }) {
  const elig = computeEligibility(drawId);
  if (!elig.ok) return elig;

  const recon = financialReconciliation(elig.draw);
  if (!recon.reconciled) {
    return { ok: false, stage: "financial-reconciliation", recon, message: "Financial reconciliation failed — real send BLOCKED. Not sending, not papering over." };
  }

  const ledger = loadLedger(ledgerPath);
  const targets = singleParticipant ? elig.eligible.filter((p) => p.name === singleParticipant) : elig.eligible;

  const results = [];
  for (const p of targets) {
    const key = idempotencyKeyForBackfill(p.name);
    const existing = ledger[p.name];
    if (existing && existing.status === "sent") {
      results.push({ name: p.name, skipped: true, reason: "already sent per ledger" });
      continue;
    }

    const { calculatePrizePerParticipant } = loadRealPrizeCalculator();
    const estimates = calculatePrizePerParticipant(elig.draw, p);
    const validation = validateParticipantConfirmation({ participant: p, draw: elig.draw, estimates });
    if (!validation.ok) {
      const rec = { participantId: p.name, nome: p.name, recipientMasked: maskEmail(p.email), idempotencyKey: key, status: "blocked", attempts: (existing ? existing.attempts : 0), providerMessageId: null, sentAt: null, lastError: validation.errors.join(", ") };
      ledger[p.name] = rec;
      saveLedger(ledgerPath, ledger);
      results.push({ name: p.name, ok: false, blocked: true, errors: validation.errors });
      continue;
    }

    const payload = buildParticipantConfirmationPayload({ participant: p, draw: elig.draw, estimates });
    const subject = renderParticipantConfirmationSubject(payload, false); // false = NOT testMode, no "[TESTE ADMIN]"
    const html = renderParticipantConfirmationHtml(payload, false);

    if (dryRun) {
      results.push({ name: p.name, dryRun: true, subject, recipientMasked: maskEmail(p.email) });
      continue;
    }

    let attempt = (existing ? existing.attempts : 0);
    let sendResult = null;
    let lastError = null;
    const maxAttempts = 1 + MAX_RETRIES;
    while (attempt < maxAttempts) {
      attempt += 1;
      sendResult = await sendEmailJob({ recipient: p.email }, { ...EMAILJS, htmlMessage: html, subject });
      if (sendResult.ok) break;
      lastError = sendResult.error;
      const retryable = sendResult.providerStatus == null || sendResult.providerStatus >= 500;
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }

    const rec = {
      participantId: p.name,
      nome: p.name,
      recipientMasked: maskEmail(p.email),
      idempotencyKey: key,
      status: sendResult.ok ? "sent" : "failed",
      attempts: attempt,
      providerMessageId: sendResult.providerMessageId || null,
      sentAt: sendResult.ok ? new Date().toISOString() : null,
      lastError: sendResult.ok ? null : lastError,
    };
    ledger[p.name] = rec;
    saveLedger(ledgerPath, ledger); // write immediately, don't wait for the batch

    results.push({ name: p.name, ok: sendResult.ok, providerStatus: sendResult.providerStatus, error: sendResult.ok ? null : lastError });

    if (!dryRun) await new Promise((r) => setTimeout(r, THROTTLE_MS)); // production throttle
  }

  return { ok: true, elig, recon, results, ledgerPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const drawId = args[0] || "2026-08-05";
  const dryRun = !args.includes("--send");
  const ledgerPath = path.join(os.homedir(), "Desktop", `powerball-confirmation-send-${drawId}.json`);
  runBackfill({ drawId, ledgerPath, dryRun }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
