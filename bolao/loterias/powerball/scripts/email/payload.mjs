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
    // Origem CANÔNICA de produção (CNAME). `ferrarilabs.github.io` responde 301 para cá, então o
    // link antigo funcionava — mas era o domínio errado num email que vai para participante, e
    // comparar/usar `github.io` como se fosse produção já causou incidente neste repositório.
    // (Os headers Origin/Referer do send.mjs seguem em github.io de propósito: são a allowlist do
    // EmailJS, não link visível.)
    siteUrl: siteUrl || "https://www.ferrarilabs.com/bolao/loterias/powerball/",
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
export function buildTicketPublicationPayload({ draw, participants, tickets, publicationVersion, proofUrl, operatorAttestation, correctionReason, previousHash, previousTickets, ticketsPdfUrl, ticketsCsvUrl, ticketsManifestUrl, publishedAtUtc, siteUrl }) {
  const totalShares = participants.reduce((s, p) => s + (p.cotas || 0), 0);
  const f = draw.finance;
  const totalArrecadado = f.totalArrecadado;
  const creditoSorteioAnterior = f.creditoSorteioAnterior || 0;
  const valorUsado = f.valorUtilizado;
  const saldoReservado = f.valorGuardadoProximoSorteio;
  const reembolso = f.reembolso || 0;
  const outrasDestinacoes = f.outrasDestinacoes || 0;
  // Same fix as validateFinancialReconciliation() in validate.mjs (Eduardo, 2026-08-08):
  // this display computation had the identical bug — didn't add creditoSorteioAnterior
  // (funds carried forward from a prior draw) into the "available" side, so a fully
  // reconciled draw (150 + 18 = 168 = 168 + 0) showed a fabricated "-$18 não conciliado"
  // in the sent email. Eduardo caught this by reading the actual delivered email.
  const diferencaNaoConciliada = Number(((totalArrecadado + creditoSorteioAnterior) - (valorUsado + saldoReservado + reembolso + outrasDestinacoes)).toFixed(2));
  const valorPorCota = totalShares > 0 ? Number((totalArrecadado / totalShares).toFixed(2)) : 0;
  // js/data.js has always named this field valorPorTicket (never costPerTicket) —
  // confirmed found this the hard way: reading the wrong name here made
  // powerPlay (derived from this being truthy, see render.mjs) silently render
  // as "Não" for every real ticket, when every one of this bolão's tickets is
  // actually always bought WITH Power Play. costPerTicket kept as a fallback
  // in case some future draw source ever does use that name.
  const costPerTicket = draw.sharedTickets ? (draw.sharedTickets.valorPorTicket ?? draw.sharedTickets.costPerTicket ?? null) : null;
  const ticketCostTotal = costPerTicket != null ? costPerTicket * tickets.length : valorUsado;

  const manifest = {
    poolId: draw.gameType,
    drawId: draw.id,
    publicationVersion,
    // Callers that need the SAME manifest (and therefore the same hash) written to disk
    // BEFORE the email is built — e.g. to host the files this send links to — must pass
    // the same publishedAtUtc into both calls. Otherwise two calls a few ms apart each get
    // their own `new Date().toISOString()`, producing two different hashes for identical
    // ticket data — the exact bug found 2026-08-10 (public file hash didn't match the hash
    // quoted in the sent email).
    publishedAtUtc: publishedAtUtc || new Date().toISOString(),
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
    creditoSorteioAnterior,
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
    // Missing from this template until 2026-08-10 (Eduardo, reviewing the actual email as a
    // participant: "não mostra o jackpot... não tem link pro site") — both fields already
    // existed on the OTHER two templates (confirmation, draw-result), just never threaded
    // through this one.
    siteUrl: siteUrl || "https://www.ferrarilabs.com/bolao/loterias/powerball/",
    totalShares,
    publicationVersion,
    manifest,
    manifestHash,
    manifestHashShort: shortHash(manifestHash),
    financialSummary,
    tickets: manifest.tickets,
    proofUrl: proofUrl || (draw.sharedTickets ? draw.sharedTickets.proofUrl : null),
    // Real download links for the full ticket list. EmailJS's REST API has no attachment
    // mechanism (confirmed: send.mjs's request body has no `attachments` field, only
    // template_params) — a 2026-08-10 real send went out claiming the PDF/CSV were
    // "anexados" when nothing was actually attached, caught by Eduardo reading the
    // delivered email. Fixed by hosting the files as static assets under this app's own
    // GitHub Pages path (see send_ticket_publication_real.mjs) and linking to them here
    // instead of claiming an attachment that can't exist over this transport.
    ticketsPdfUrl: ticketsPdfUrl || null,
    ticketsCsvUrl: ticketsCsvUrl || null,
    ticketsManifestUrl: ticketsManifestUrl || null,
    // Reaches the actual email content (render.mjs) — previously this only reached
    // the send-time validation gate (validateAttachmentsAndLinks in publish_tickets.mjs)
    // and never the payload, so the delivered email always said "comprovante não
    // informado" even when a real attestation + real receipt backed the send.
    operatorAttestation: operatorAttestation || null,
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

// ---------------------------------------------------------------------------
// Draw-result email (2026-08-06, real-send). Reuses the REAL prize table
// (gt.prizeTable from js/data.js, passed in — never reimplemented here) to
// compute hits/prizes per ticket, exactly the same logic js/app.js's own
// computePrize() uses for the public page. Financial figures are read
// directly from draw.finance/draw.result/draw.profit — never invented.
// ---------------------------------------------------------------------------

function parseTicketNumeros(str) {
  const m = str.match(/^([\d\s-]+?)\s*—\s*PB\s*(\d+)$/);
  if (!m) return null;
  return { numbers: m[1].split("-").map(Number), special: Number(m[2]) };
}

/** All shared tickets for a draw, flattened, with serial retained. */
export function allTicketsForDraw(draw) {
  const out = [];
  (draw.sharedTickets ? draw.sharedTickets.series : []).forEach((s) => {
    (s.numeros || []).forEach((str) => {
      const parsed = parseTicketNumeros(str);
      if (parsed) out.push({ ...parsed, serial: s.serial });
    });
  });
  return out;
}

/**
 * Computes hits/prize per ticket using the REAL prizeTable function (from
 * js/data.js's LOTTERY_GAME_TYPES.powerball.prizeTable, loaded via
 * prize-calc-bridge.mjs) — identical logic to js/app.js's own computePrize().
 */
export function computeTicketResults(tickets, official, prizeTableFn) {
  return tickets.map((t) => {
    const mainMatches = t.numbers.filter((n) => official.numbers.includes(n)).length;
    const specialMatch = t.special === official.special;
    const prize = prizeTableFn(mainMatches, specialMatch, official.multiplier);
    return {
      ...t,
      mainMatches,
      specialMatch,
      prizeLabel: prize ? prize.label : null,
      prizeAmount: prize ? prize.amount : 0,
      jackpotHit: !!(prize && prize.amount === null),
    };
  });
}

export function buildDrawResultPayload({ draw, participants, official, prizeTableFn, siteUrl }) {
  const totalShares = participants.reduce((s, p) => s + (p.cotas || 0), 0);
  const tickets = allTicketsForDraw(draw);
  const ticketResults = computeTicketResults(tickets, official, prizeTableFn);
  const winningTickets = ticketResults.filter((t) => t.prizeAmount);

  const f = draw.finance;
  const totalWon = draw.result ? draw.result.premiosGanhos : null;
  const totalSpent = f.valorUtilizado;
  const remainingBalance = f.valorGuardadoProximoSorteio;
  // Estimated funds carried into the next draw = balance already reserved +
  // whatever was won this draw (losses are historically covered by the
  // organizer separately, per PARTICIPANT_FRAMEWORK.md convention already
  // visible in this draw's own "Saldo anterior (cobriu -$2...)" entries) —
  // explicitly labeled as an estimate, not asserted as an official carried
  // balance until the next draw entry actually exists in js/data.js.
  const estimatedNextDrawCredit = totalWon != null ? Number((remainingBalance + totalWon).toFixed(2)) : null;

  const base = {
    templateId: "draw-result",
    templateVersion: 1,
    poolId: draw.gameType,
    drawId: draw.id,
    drawDateLabel: draw.drawing.drawDateLabel,
    drawDateIso: draw.drawing.drawDateIso,
    jackpot: draw.drawing.jackpot,
    totalShares,
    official,
    checkedAt: draw.result ? draw.result.checkedAt : null,
    jackpotHit: draw.result ? draw.result.jackpotHit : null,
    tickets: ticketResults,
    winningTickets,
    ticketCount: ticketResults.length,
    financialSummary: {
      participantCount: participants.length,
      totalShares,
      totalArrecadado: f.totalArrecadado,
      totalSpent,
      remainingBalance,
      totalWon,
      lucro: draw.profit ? draw.profit.lucro : (totalWon != null ? Number((totalWon - totalSpent).toFixed(2)) : null),
      estimatedNextDrawCredit,
    },
    proofUrl: draw.sharedTickets ? draw.sharedTickets.proofUrl : null,
    siteUrl: siteUrl || "https://www.ferrarilabs.com/bolao/loterias/powerball/",
    generatedAtUtc: new Date().toISOString(),
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
