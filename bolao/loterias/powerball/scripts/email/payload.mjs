// payload.mjs — pure functions: snapshot + estimates in, payload object out.
// No I/O, no sending, no recipient decisions beyond what's passed in.

import crypto from "node:crypto";

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

export function buildParticipantConfirmationPayload({ participant, draw, estimates, nextDrawDateLabel, siteUrl }) {
  const totalCotas = draw.participants.reduce((s, p) => s + (p.cotas || 0), 0);
  const pct = totalCotas > 0 ? ((participant.cotas || 0) / totalCotas) * 100 : 0;
  return {
    templateId: "participant-added",
    templateVersion: 1,
    poolId: draw.gameType,
    drawId: draw.id,
    participantId: participant.name,
    recipient: participant.email,
    participantName: participant.name,
    entryDate: participant.data,
    entryTime: participant.hora,
    nextDrawDateLabel: nextDrawDateLabel || draw.drawing.drawDateLabel,
    cotas: participant.cotas,
    valor: participant.valor,
    paymentMethod: participant.metodo,
    paymentStatus: participant.status,
    participationPct: Number(pct.toFixed(2)),
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
 * manifest) and one per-recipient payload sharing that same frozen data, so a
 * multi-cota participant still gets exactly one job.
 */
export function buildTicketPublicationPayload({ draw, participants, tickets, publicationVersion, proofUrl, correctionReason, previousHash }) {
  const totalCotas = participants.reduce((s, p) => s + (p.cotas || 0), 0);
  const totalArrecadado = draw.finance.totalArrecadado;
  const valorUsado = draw.finance.valorUtilizado;
  const saldoReservado = draw.finance.valorGuardadoProximoSorteio;
  const valorPorCota = totalCotas > 0 ? Number((totalArrecadado / totalCotas).toFixed(2)) : 0;

  const manifest = {
    poolId: draw.gameType,
    drawId: draw.id,
    publicationVersion,
    publishedAtUtc: new Date().toISOString(),
    tickets: tickets.map((t) => ({ numbers: t.numbers.slice().sort((a, b) => a - b), special: t.special, serial: t.serial || null })),
  };
  const manifestHash = sha256Hex(stableStringify(manifest));
  manifest.sha256 = manifestHash;

  const financialSummary = {
    participantCount: participants.length,
    totalCotas,
    valorPorCota,
    totalArrecadado,
    valorUsado,
    saldoReservado,
    ticketCount: tickets.length,
    totalCost: draw.sharedTickets ? draw.sharedTickets.valorPorTicket * tickets.length : valorUsado,
    powerPlay: draw.sharedTickets ? draw.sharedTickets.valorPorTicket : null,
  };

  const base = {
    templateId: correctionReason ? "tickets-corrected" : "tickets-published",
    templateVersion: 1,
    poolId: draw.gameType,
    drawId: draw.id,
    drawDateLabel: draw.drawing.drawDateLabel,
    publicationVersion,
    manifest,
    manifestHash,
    financialSummary,
    tickets: manifest.tickets,
    proofUrl: proofUrl || null,
    correctionReason: correctionReason || null,
    previousHash: previousHash || null,
    generatedAtUtc: manifest.publishedAtUtc,
  };

  return {
    shared: base,
    perRecipient: participants.map((p) => ({
      ...base,
      recipient: p.email,
      participantId: p.name,
      participantName: p.name,
      individualParticipation: { cotas: p.cotas, valor: p.valor, status: p.status },
    })),
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
