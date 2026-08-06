// payload.mjs — pure functions: snapshot + estimates in, payload object out.
// No I/O, no sending, no recipient decisions beyond what's passed in.
//
// Round-2 fix: every payload now carries totalShares/drawDateLabel/jackpot in
// the SAME field names so validate.mjs::validateCrossTemplateConsistency can
// compare confirmation/publication/correction payloads for the same draw and
// catch the exact "7.14% vs 100%" class of bug found in round 1.

import crypto from "node:crypto";
import { computeTicketDiff } from "./diff.mjs";

export function sha256Hex(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

/** Deterministic JSON stringify (sorted keys) so the hash is stable. */
export function stableStringify(obj) {
  return JSON.stringify(sortKeys(obj));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = sortKeys(v[k]); return acc; }, {});
  }
  return v;
}
function shortHash(h) {
  return h ? h.slice(0, 12) + "…" + h.slice(-8) : null;
}

export function buildParticipantConfirmationPayload({ participant, draw, estimates, siteUrl }) {
  const totalShares = draw.participants.reduce((s, p) => s + (p.cotas || 0), 0);
  const participantShares = participant.cotas || 0;
  const participantPercentage = totalShares > 0 ? (participantShares / totalShares) * 100 : 0;
  return {
    templateId: "participant-added",
    templateVersion: 2,
    poolId: draw.gameType,
    drawId: draw.id,
    participantId: participant.name,
    recipient: participant.email,
    participantName: participant.name,
    entryDate: participant.data,
    entryTime: participant.hora,
    drawDateLabel: draw.drawing.drawDateLabel,
    drawDateIso: draw.drawing.drawDateIso,
    participantShares,
    totalShares,
    valor: participant.valor,
    paymentMethod: participant.metodo,
    paymentStatus: participant.status,
    participantPercentage: Number(participantPercentage.toFixed(4)),
    state: participant.state,
    jackpot: draw.drawing.jackpot,
    cashValue: draw.drawing.cashValue != null ? draw.drawing.cashValue : Math.round(draw.drawing.jackpot * 0.505),
    estimates,
    siteUrl: siteUrl || "https://ferrarilabs.github.io/bolao/loterias/powerball/",
    generatedAtUtc: new Date().toISOString(),
  };
}

/**
 * Builds the shared publication payload (financial summary + full ticket list +
 * manifest + reconciliation block) and one per-recipient payload sharing that
 * same frozen data, so a multi-cota participant still gets exactly one job.
 *
 * `previousTickets` (when given) drives a REAL diff via computeTicketDiff —
 * correctionReason is only ever shown alongside that computed diff, never as
 * a standalone typed description (round-1 bug 3).
 */
export function buildTicketPublicationPayload({ draw, participants, tickets, publicationVersion, proofUrl, correctionReason, previousHash, previousTickets }) {
  const totalShares = participants.reduce((s, p) => s + (p.cotas || 0), 0);
  const f = draw.finance;
  const totalArrecadado = f.totalArrecadado;
  const valorUsado = f.valorUtilizado;
  const saldoReservado = f.valorGuardadoProximoSorteio;
  const reembolso = f.reembolso || 0;
  const outrasDestinacoes = f.outrasDestinacoes || 0;
  const diferencaNaoConciliada = Number((totalArrecadado - (valorUsado + saldoReservado + reembolso + outrasDestinacoes)).toFixed(2));
  const valorPorCota = totalShares > 0 ? Number((totalArrecadado / totalShares).toFixed(2)) : 0;
  const costPerTicket = draw.sharedTickets ? draw.sharedTickets.costPerTicket : null;
  const ticketCostTotal = costPerTicket != null ? costPerTicket * tickets.length : valorUsado;

  const manifest = {
    poolId: draw.gameType,
    drawId: draw.id,
    publicationVersion,
    publishedAtUtc: new Date().toISOString(),
    tickets: tickets.map((t) => ({ numbers: t.numbers.slice().sort((a, b) => a - b), special: t.special, serial: t.serial || null })),
  };
  const manifestHash = sha256Hex(stableStringify(manifest));
  manifest.sha256 = manifestHash;

  let diff = null;
  if (previousTickets) {
    diff = computeTicketDiff(previousTickets, tickets);
  }

  const isCorrection = !!correctionReason;

  const financialSummary = {
    participantCount: participants.length,
    totalShares,
    valorPorCota,
    totalArrecadado,
    valorUsado,
    saldoReservado,
    reembolso,
    outrasDestinacoes,
    diferencaNaoConciliada,
    ticketCount: tickets.length,
    costPerTicket,
    ticketCostTotal,
  };

  const base = {
    templateId: isCorrection ? "tickets-corrected" : "tickets-published",
    templateVersion: 2,
    poolId: draw.gameType,
    drawId: draw.id,
    drawDateLabel: draw.drawing.drawDateLabel,
    drawDateIso: draw.drawing.drawDateIso,
    jackpot: draw.drawing.jackpot,
    totalShares,
    publicationVersion,
    manifest,
    manifestHash,
    manifestHashShort: shortHash(manifestHash),
    financialSummary,
    tickets: manifest.tickets,
    proofUrl: proofUrl || (draw.sharedTickets ? draw.sharedTickets.proofUrl : null),
    correctionReason: correctionReason || null,
    previousHash: previousHash || null,
    previousHashShort: shortHash(previousHash),
    diff,
    generatedAtUtc: manifest.publishedAtUtc,
  };

  return {
    shared: base,
    perRecipient: participants.map((p) => {
      const shares = p.cotas || 0;
      return {
        ...base,
        recipient: p.email,
        participantId: p.name,
        participantName: p.name,
        individualParticipation: {
          shares,
          valor: p.valor,
          status: p.status,
          percentage: Number(((totalShares > 0 ? shares / totalShares : 0) * 100).toFixed(4)),
        },
      };
    }),
  };
}

export function manifestToCsv(manifest) {
  const rows = [["poolId", "drawId", "publicationVersion", "ticketIndex", "numbers", "special", "serial"]];
  manifest.tickets.forEach((t, i) => {
    rows.push([manifest.poolId, manifest.drawId, manifest.publicationVersion, i + 1, t.numbers.join("-"), t.special, t.serial || ""]);
  });
  rows.push(["sha256", manifest.sha256, "", "", "", "", ""]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
