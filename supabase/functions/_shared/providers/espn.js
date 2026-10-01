/**
 * Adaptador ESPN — o provedor ATUAL. Não reimplementa nada: delega à normalização canônica que já
 * existe (`normalize.js`), que é também o que a Edge Function `live-football` executa.
 *
 * Mantido como provedor registrado para o produtor em GitHub Actions (`produce_live_cache.mjs`),
 * que continua AUTORIDADE até o cutover, e como fallback de emergência depois dele.
 */
import { normalizeScoreboard, validateScoreboardShape } from "../normalize.js";

export const PROVIDER_ID = "espn";

/** @returns {string[]} problemas de forma; vazio = utilizável. */
export function validateEnvelope(raw) {
  return validateScoreboardShape(raw);
}

/** O corpo da ESPN já é por competição; `competition` é só rótulo. */
export function toCanonicalMatches(raw) {
  return { matches: normalizeScoreboard(raw, {}), unmapped: [] };
}
