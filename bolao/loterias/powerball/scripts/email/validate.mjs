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

export { isValidEmail };
