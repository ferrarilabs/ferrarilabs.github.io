// Powerball email pipeline — Part 5 of the professionalization audit: separate rendering from
// transport, one function per responsibility, so no single function reaches across "fetch state"
// / "build content" / "send" / "persist" the way today's sendResultEmail() (js/app.js:263-306)
// does. Renderers below take an immutable payload snapshot (built once by buildEmailPayload) and
// never re-read live app state — this is what makes retries safe (retry re-sends the exact
// original content, never recomputed content).

/**
 * loadDrawSnapshot — freezes exactly the fields email content is allowed to depend on, out of a
 * live `draw` object (as shaped by bolao/loterias/powerball/js/data.js). Deliberately narrow:
 * anything not copied here cannot leak into an email even by future accident.
 */
export function loadDrawSnapshot(draw, gameType) {
  if (!draw) throw new Error("loadDrawSnapshot: draw is required");
  if (!gameType) throw new Error("loadDrawSnapshot: gameType is required");
  return Object.freeze({
    drawId: draw.id,
    gameTypeId: draw.gameType,
    gameLabel: gameType.label,
    specialBallLabel: gameType.specialBallLabel,
    drawDateLabel: draw.drawing.drawDateLabel,
    drawDateIso: draw.drawing.drawDateIso,
    jackpot: draw.drawing.jackpot,
    finance: draw.finance ? { ...draw.finance } : null,
  });
}

const VALID_EVENT_TYPES = new Set([
  "abertura_bolao",
  "confirmacao_participacao",
  "confirmacao_pagamento",
  "tickets_publicados",
  "lembrete_sorteio",
  "resultado_disponivel",
  "premio_identificado",
  "sem_premio",
  "proximo_sorteio_criado",
  "correcao_administrativa",
]);

/**
 * validateEmailEvent — part of the "não envia antes da hora" / "não envia payload incompleto"
 * test guarantees. Throws with a specific reason instead of silently no-op'ing (today's code:
 * app.js:276-280 silently `console.warn`s and skips on bad email, no caller ever finds out).
 */
export function validateEmailEvent({ eventType, drawSnapshot, recipient, resultSnapshot }) {
  const errors = [];
  if (!VALID_EVENT_TYPES.has(eventType)) errors.push(`unknown event_type "${eventType}"`);
  if (!drawSnapshot || !drawSnapshot.drawId) errors.push("missing drawSnapshot");
  if (!recipient || !recipient.includes("@")) errors.push(`invalid recipient "${recipient}"`);

  if (eventType === "resultado_disponivel" || eventType === "premio_identificado" || eventType === "sem_premio") {
    if (!resultSnapshot) {
      errors.push(`event_type "${eventType}" requires a resultSnapshot`);
    } else {
      if (!Array.isArray(resultSnapshot.numbers) || resultSnapshot.numbers.length !== 5) {
        errors.push("resultSnapshot.numbers must have exactly 5 numbers");
      }
      if (resultSnapshot.special == null) errors.push("resultSnapshot.special is required");
      // "não envia antes da hora" — a result email must reference a draw date that has already
      // happened. Real incident class this guards against: Incident 2's stale-localStorage
      // mechanism could otherwise let a browser build a "result" email for a draw whose date is
      // still in the future if a bad cache entry existed.
      if (drawSnapshot && new Date(drawSnapshot.drawDateIso).getTime() > Date.now()) {
        errors.push(`draw ${drawSnapshot.drawId} has not happened yet (drawDateIso is in the future)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * buildEmailPayload — the ONE place live data gets read and frozen into something immutable.
 * Everything after this point (render*, enqueue, send) works only off this snapshot.
 */
export function buildEmailPayload({ eventType, drawSnapshot, recipient, resultSnapshot, prizeSnapshot }) {
  const { valid, errors } = validateEmailEvent({ eventType, drawSnapshot, recipient, resultSnapshot });
  if (!valid) throw new Error(`buildEmailPayload: invalid event — ${errors.join("; ")}`);

  return Object.freeze({
    eventType,
    draw: drawSnapshot,
    recipient,
    result: resultSnapshot ? { ...resultSnapshot } : null,
    prize: prizeSnapshot ? { ...prizeSnapshot } : null,
    builtAt: new Date().toISOString(),
  });
}

export function renderEmailSubject(payload) {
  const { eventType, draw } = payload;
  switch (eventType) {
    case "resultado_disponivel":
    case "premio_identificado":
    case "sem_premio":
      return `🎟️ Resultado do Sorteio ${draw.gameLabel} — ${draw.drawDateLabel}`;
    case "lembrete_sorteio":
      return `⏰ Sorteio ${draw.gameLabel} hoje — ${draw.drawDateLabel}`;
    case "confirmacao_pagamento":
      return `✅ Pagamento confirmado — ${draw.gameLabel} ${draw.drawDateLabel}`;
    case "tickets_publicados":
      return `🎫 Tickets publicados — ${draw.gameLabel} ${draw.drawDateLabel}`;
    default:
      return `${draw.gameLabel} — ${draw.drawDateLabel}`;
  }
}

function fmtUsdCents(n) {
  if (n === null || n === undefined) return "—";
  return (n < 0 ? "-" : "") + "US$" + Math.abs(n).toLocaleString("en-US");
}

export function renderEmailHtml(payload) {
  const { eventType, draw, result, prize } = payload;
  const parts = [`<div style="font-family:sans-serif;color:#333;">`];
  parts.push(`<h1 style="color:#CE1141;">${draw.gameLabel} — ${escapeHtml(draw.drawDateLabel)}</h1>`);

  if (eventType === "resultado_disponivel" || eventType === "premio_identificado" || eventType === "sem_premio") {
    const sorted = [...result.numbers].sort((a, b) => a - b);
    parts.push(`<p><strong>Números:</strong> ${sorted.join(" - ")} · ${escapeHtml(draw.specialBallLabel)} ${result.special}</p>`);
    if (prize && prize.jackpotHit) {
      parts.push(`<h2 style="color:#CE1141;">🎉 JACKPOT! 🎉</h2>`);
    } else if (prize && prize.total > 0) {
      parts.push(`<p><strong>Prêmios ganhos:</strong> ${fmtUsdCents(prize.total)}</p>`);
    } else {
      parts.push(`<p><strong>Nenhum prêmio nesse sorteio.</strong></p>`);
    }
  }
  if (draw.finance) {
    parts.push(`<p><small>Total arrecadado: ${fmtUsdCents(draw.finance.totalArrecadado)}</small></p>`);
  }
  parts.push(`</div>`);
  return parts.join("");
}

export function renderEmailText(payload) {
  // Plain-text fallback — not currently used by the live EmailJS template (which only accepts
  // html_message, per config.js), but required by the test matrix (preview must equal what's
  // sent) and cheap to keep in sync since it's derived from the same immutable payload.
  const { eventType, draw, result } = payload;
  const lines = [`${draw.gameLabel} — ${draw.drawDateLabel}`];
  if (result) {
    const sorted = [...result.numbers].sort((a, b) => a - b);
    lines.push(`Números: ${sorted.join(" - ")} | ${draw.specialBallLabel} ${result.special}`);
  }
  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
