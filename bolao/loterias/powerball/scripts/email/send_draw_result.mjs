#!/usr/bin/env node
// send_draw_result.mjs — sends the draw-result email (official numbers, per-
// ticket hits/prizes via the REAL prizeTable, financial summary) to every
// current eligible participant of a draw who hasn't received this specific
// result email yet. New flow, built 2026-08-06, reusing the approved
// ball-circle visual design from render.mjs unmodified.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAllDraws } from "./snapshot.mjs";
import { eligibleRecipients } from "./validate.mjs";
import { loadRealPrizeCalculator } from "./prize-calc-bridge.mjs";
import { buildDrawResultPayload } from "./payload.mjs";
import { renderDrawResultSubject, renderDrawResultHtml, renderDrawResultText } from "./render.mjs";
import { sendEmailJob } from "./send.mjs";
import { maskEmail } from "./send_participant_confirmation_backfill.mjs";

const EMAILJS = { publicKey: "GBZFujsJBET6modve", serviceId: "service_o4hyzxr", templateId: "template_xq7yzzb" };
const MAX_RETRIES = 2;
const THROTTLE_MS = 1200;

export function idempotencyKeyForResult(drawId, participantId) {
  return `powerball:draw-result:${drawId}:v1:${participantId}`;
}

function loadLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return {};
  try { return JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { return {}; }
}
function saveLedger(ledgerPath, ledger) {
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
}

export function financialReconciliation(draw) {
  const f = draw.finance;
  const totalPaid = (f.totalArrecadado || 0) + (f.creditoSorteioAnterior || 0);
  const totalSpent = f.valorUtilizado || 0;
  const remainingBalance = f.valorGuardadoProximoSorteio || 0;
  const difference = Number((totalPaid - totalSpent - remainingBalance).toFixed(2));
  return { totalPaid, totalSpent, remainingBalance, difference, reconciled: difference === 0 };
}

export function computeEligibility(drawId) {
  const draws = loadAllDraws();
  const draw = draws.find((d) => d.id === drawId);
  if (!draw) return { ok: false, error: `Draw ${drawId} not found` };
  if (!draw.result || !draw.result.numbers) return { ok: false, error: `Draw ${drawId} has no official result recorded yet` };

  const eligible = eligibleRecipients(draw.participants);
  const excluded = draw.participants.filter((p) => !eligible.includes(p)).map((p) => ({
    name: p.name,
    reason: !p.email || p.email === "—" || !p.email.includes("@") ? "INVALID_EMAIL" : (p.status === "cancelado" ? "CANCELLED" : (!(p.cotas > 0) ? "NO_COTAS" : "UNKNOWN")),
  }));
  const emailCounts = {};
  eligible.forEach((p) => { const e = p.email.toLowerCase(); emailCounts[e] = (emailCounts[e] || 0) + 1; });
  const duplicateEmails = Object.entries(emailCounts).filter(([, c]) => c > 1).map(([e]) => e);

  return { ok: true, draw, eligible, excluded, duplicateEmails };
}

export async function runDrawResultSend({ drawId, ledgerPath, dryRun = true, singleParticipant = null }) {
  const elig = computeEligibility(drawId);
  if (!elig.ok) return elig;

  const recon = financialReconciliation(elig.draw);
  if (!recon.reconciled) {
    return { ok: false, stage: "financial-reconciliation", recon, message: "Financial reconciliation failed — real send BLOCKED." };
  }
  if (elig.duplicateEmails.length > 0) {
    return { ok: false, stage: "duplicate-detection", duplicateEmails: elig.duplicateEmails, message: "Duplicate recipient emails detected — real send BLOCKED." };
  }

  const { GAME_TYPES } = loadRealPrizeCalculator();
  const gt = GAME_TYPES[elig.draw.gameType] || GAME_TYPES.powerball;
  const official = { numbers: elig.draw.result.numbers, special: elig.draw.result.special, multiplier: elig.draw.result.multiplier };

  const { perRecipient } = buildDrawResultPayload({ draw: elig.draw, participants: elig.eligible, official, prizeTableFn: gt.prizeTable });

  const ledger = loadLedger(ledgerPath);
  const targets = singleParticipant ? perRecipient.filter((p) => p.participantId === singleParticipant) : perRecipient;

  const results = [];
  for (const payload of targets) {
    const key = idempotencyKeyForResult(drawId, payload.participantId);
    const existing = ledger[payload.participantId];
    if (existing && existing.status === "sent") {
      results.push({ name: payload.participantId, skipped: true, reason: "already sent per ledger" });
      continue;
    }

    const subject = renderDrawResultSubject(payload, false);
    const html = renderDrawResultHtml(payload, false);

    if (dryRun) {
      results.push({ name: payload.participantId, dryRun: true, subject, recipientMasked: maskEmail(payload.recipient) });
      continue;
    }

    let attempt = existing ? existing.attempts : 0;
    let sendResult = null;
    let lastError = null;
    const maxAttempts = 1 + MAX_RETRIES;
    while (attempt < maxAttempts) {
      attempt += 1;
      sendResult = await sendEmailJob({ recipient: payload.recipient }, { ...EMAILJS, htmlMessage: html, subject });
      if (sendResult.ok) break;
      lastError = sendResult.error;
      const retryable = sendResult.providerStatus == null || sendResult.providerStatus >= 500;
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }

    const rec = {
      participantId: payload.participantId,
      nome: payload.participantId,
      recipientMasked: maskEmail(payload.recipient),
      idempotencyKey: key,
      status: sendResult.ok ? "sent" : "failed",
      attempts: attempt,
      providerMessageId: sendResult.providerMessageId || null,
      sentAt: sendResult.ok ? new Date().toISOString() : null,
      lastError: sendResult.ok ? null : lastError,
    };
    ledger[payload.participantId] = rec;
    saveLedger(ledgerPath, ledger);

    results.push({ name: payload.participantId, ok: sendResult.ok, providerStatus: sendResult.providerStatus, error: sendResult.ok ? null : lastError });

    if (!dryRun) await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  return { ok: true, elig, recon, results, ledgerPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const drawId = args[0] || "2026-08-05";
  const dryRun = !args.includes("--send");
  const ledgerPath = path.join(os.homedir(), "Desktop", `powerball-result-send-2026-08-06.json`);
  runDrawResultSend({ drawId, ledgerPath, dryRun }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
