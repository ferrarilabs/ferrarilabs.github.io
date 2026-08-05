// diff.mjs — the ONLY source of "what changed" for a ticket correction email.
// A correction is never built from a hand-typed description disconnected from
// the data (round-1 bug 3: an email claimed "63→64" while both versions
// actually rendered identically). Every correction payload must embed the
// output of computeTicketDiff, and the rendered "before/after" text is
// generated directly from it, not retyped.

function ticketKey(t) {
  return t.numbers.slice().sort((a, b) => a - b).join("-") + "|" + t.special;
}
function fmtTicket(t) {
  return t.numbers.slice().sort((a, b) => a - b).join(" · ") + " — Powerball " + t.special;
}

/**
 * Positional diff (game #1 vs game #1, #2 vs #2, ...) — matches how the
 * publication email numbers games sequentially. Returns:
 *   { changed: [{ index, before, after }], unchanged: [{index, ticket}], added: [...], removed: [...], hasDiff }
 */
export function computeTicketDiff(previousTickets, newTickets) {
  const changed = [];
  const unchanged = [];
  const maxLen = Math.max(previousTickets.length, newTickets.length);
  for (let i = 0; i < maxLen; i++) {
    const before = previousTickets[i];
    const after = newTickets[i];
    if (before && after) {
      if (ticketKey(before) === ticketKey(after)) {
        unchanged.push({ index: i, ticket: after });
      } else {
        changed.push({ index: i, before, after, beforeText: fmtTicket(before), afterText: fmtTicket(after) });
      }
    } else if (!before && after) {
      changed.push({ index: i, before: null, after, beforeText: null, afterText: fmtTicket(after) });
    } else if (before && !after) {
      changed.push({ index: i, before, after: null, beforeText: fmtTicket(before), afterText: null });
    }
  }
  return { changed, unchanged, hasDiff: changed.length > 0 };
}
