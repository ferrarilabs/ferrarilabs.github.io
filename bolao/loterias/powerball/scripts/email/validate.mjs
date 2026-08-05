// validate.mjs — decisions only, no I/O, no sending.

function isValidEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v !== "—";
}

/**
 * Flow A gate. Returns { ok: true } or { ok: false, errors: [...] }.
 * Blocks (does not guess) when the participant's state is missing/unsupported
 * by the real calculation function (stateKnown === false).
 */
export function validateParticipantConfirmation({ participant, draw, estimates }) {
  const errors = [];
  if (!participant) errors.push("PARTICIPANT_NOT_FOUND");
  if (!draw) errors.push("DRAW_NOT_FOUND");
  if (participant && !isValidEmail(participant.email)) errors.push("PARTICIPANT_EMAIL_INVALID");
  if (participant && (participant.cotas === null || participant.cotas === undefined)) errors.push("PARTICIPANT_COTAS_MISSING");
  if (!estimates) {
    errors.push("ESTIMATES_UNAVAILABLE");
  } else if (estimates.stateKnown === false) {
    errors.push("PARTICIPANT_STATE_UNSUPPORTED");
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/**
 * Flow B gate — mirrors the "publish" button disable conditions from the spec.
 * `draw.result` presence with concluded flag is treated as "already concluded".
 */
export function validateTicketPublication({ draw, participants, tickets, nowIso }) {
  const errors = [];
  if (!draw) { errors.push("DRAW_NOT_FOUND"); return { ok: false, errors }; }
  if (!draw.drawing || !draw.drawing.drawDateIso) errors.push("MISSING_DRAW_DATE");
  if (!tickets || tickets.length === 0) errors.push("NO_TICKETS");
  if (tickets && tickets.some((t) => !t.numbers || t.numbers.length !== 5 || t.special == null)) {
    errors.push("INVALID_TICKET");
  }
  if (!participants || participants.length === 0) errors.push("NO_PARTICIPANTS");
  const invalidRecipients = (participants || []).filter((p) => !isValidEmail(p.email));
  if (invalidRecipients.length > 0) errors.push("PARTICIPANT_EMAIL_INVALID");
  const now = nowIso ? new Date(nowIso) : new Date();
  if (draw.drawing && draw.drawing.drawDateIso && new Date(draw.drawing.drawDateIso) <= now && draw.result && draw.result.numbers) {
    errors.push("DRAW_ALREADY_CONCLUDED");
  }
  if (draw.__stale === true) errors.push("TICKET_DATA_STALE");
  if (draw.finance) {
    const recon = validateFinancialReconciliation(draw.finance);
    if (!recon.ok) errors.push(...recon.errors);
  }
  if (tickets && draw.sharedTickets && draw.sharedTickets.costPerTicket != null && draw.finance) {
    const costCheck = validateTicketCostTotal({ ticketCount: tickets.length, costPerTicket: draw.sharedTickets.costPerTicket, ticketCostTotal: draw.finance.valorUtilizado });
    if (!costCheck.ok) errors.push(...costCheck.errors);
  }
  return {
    ok: errors.length === 0,
    errors,
    invalidRecipients: invalidRecipients.map((p) => p.name),
  };
}

/** Eligibility filter for Flow B recipients: active, cotas>0, valid email, not cancelled. */
export function eligibleRecipients(participants) {
  return (participants || []).filter(
    (p) => isValidEmail(p.email) && Number(p.cotas) > 0 && p.status !== "cancelado"
  );
}

/**
 * Hard reconciliation gate (round-1 bug 2): publication must be BLOCKED
 * whenever totalArrecadado != valorUtilizado + saldoReservado + reembolso +
 * outrasDestinacoes. Never fabricates a balancing number.
 */
export function validateFinancialReconciliation(finance) {
  const f = finance || {};
  const reconciled = (f.valorUtilizado || 0) + (f.valorGuardadoProximoSorteio || 0) + (f.reembolso || 0) + (f.outrasDestinacoes || 0);
  const diff = Number((f.totalArrecadado - reconciled).toFixed(2));
  if (diff !== 0) {
    return { ok: false, errors: [`FINANCE_NOT_RECONCILED: totalArrecadado(${f.totalArrecadado}) != valorUtilizado+saldo+reembolso+outras(${reconciled}), diff=${diff}`], diff };
  }
  return { ok: true, errors: [], diff: 0 };
}

/** ticketCostTotal must equal ticketCount × costPerTicket, exactly. */
export function validateTicketCostTotal({ ticketCount, costPerTicket, ticketCostTotal }) {
  const expected = ticketCount * costPerTicket;
  if (expected !== ticketCostTotal) {
    return { ok: false, errors: [`TICKET_COST_MISMATCH: expected ${ticketCount}×${costPerTicket}=${expected}, got ${ticketCostTotal}`] };
  }
  return { ok: true, errors: [] };
}

/**
 * Cross-template consistency (round-1 bug 1): the three payloads built for
 * confirmation / publication / correction of the SAME poolId+drawId must
 * agree on totalShares, drawDateLabel, and jackpot. Called before any of the
 * three is allowed to send.
 */
export function validateCrossTemplateConsistency(payloads) {
  const errors = [];
  const present = payloads.filter(Boolean);
  if (present.length < 2) return { ok: true, errors: [] };
  const drawIds = new Set(present.map((p) => p.drawId));
  if (drawIds.size > 1) errors.push(`DRAW_ID_DIVERGES: ${[...drawIds].join(", ")}`);
  const totalShares = new Set(present.map((p) => p.totalShares).filter((v) => v !== undefined));
  if (totalShares.size > 1) errors.push(`TOTAL_SHARES_DIVERGES: ${[...totalShares].join(", ")}`);
  const dateLabels = new Set(present.map((p) => p.drawDateLabel).filter(Boolean));
  if (dateLabels.size > 1) errors.push(`DRAW_DATE_DIVERGES: ${[...dateLabels].join(", ")}`);
  const jackpots = new Set(present.map((p) => p.jackpot).filter((v) => v !== undefined));
  if (jackpots.size > 1) errors.push(`JACKPOT_DIVERGES: ${[...jackpots].join(", ")}`);
  return { ok: errors.length === 0, errors };
}

export { isValidEmail };
