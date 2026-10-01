/**
 * NÚCLEO CANÔNICO DO PRODUTOR DO CACHE AO VIVO — independente de provedor e de runtime.
 *
 *   corpo cru do provedor ──► adaptador (providers/*.js) ──► partidas CANÔNICAS
 *        ──► buildGatewayPayload (o mesmo envelope do gateway) ──► live_sports_cache
 *
 * Sem `node:*`, sem `Deno.*`, sem rede, sem relógio próprio: o mesmo arquivo roda no produtor atual
 * (GitHub Actions, ESPN, AUTORIDADE até o cutover), na Edge Function `live-cache-ingest` e nos testes.
 * Uma implementação do envelope, uma da mesclagem; só o ADAPTADOR conhece o vocabulário do provedor.
 *
 * Nunca escreve por conta própria (a gravação é injetada), nunca lê credencial, nunca toca
 * participante, pagamento, scoring, ranking ou e-mail.
 */
import { ALLOWED_COMPETITIONS, buildGatewayPayload } from "./normalize.js";
import * as espn from "./providers/espn.js";
import * as apiFootball from "./providers/api_football.js";
import { SAFE_PATH, decideCompetition, planApiFootballRequests } from "./polling_plan.js";

/** Competições que o gateway serve HOJE. Copa está arquivada. Fonte única (`produce_live_cache.mjs` reexporta). */
export const INGEST_COMPETITIONS = Object.freeze(["br2026", "cdb2026"]);
export const PROVIDERS = Object.freeze({ espn, api_football: apiFootball });
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** O cache guarda uma janela do calendário, não o torneio inteiro. */
const KEEP_BEFORE_MS = 24 * 3600_000;
const KEEP_AFTER_MS = 36 * 3600_000;

/**
 * Caminho ESPN (produtor atual): corpo cru → registro de cache de UMA competição. Mesma ordem de
 * decisões de sempre: forma inválida é falha da fonte e NUNCA vira escrita (o último-bom-conhecido
 * é o que segura o gateway durante uma queda).
 */
export function buildCacheRecord(competition, raw, { now = Date.now() } = {}) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_COMPETITIONS, competition)) {
    return { ok: false, action: "REJECTED", reason: "competicao fora da whitelist fechada" };
  }
  if (raw === null || typeof raw !== "object") return { ok: false, action: "NO_WRITE", reason: "corpo nao e um objeto JSON" };
  const problems = espn.validateEnvelope(raw);
  if (problems.length) return { ok: false, action: "NO_WRITE", reason: `forma invalida: ${problems.slice(0, 3).join("; ")}` };
  const observedAt = new Date(now).toISOString();
  const payload = buildGatewayPayload({
    competition, matches: espn.toCanonicalMatches(raw).matches,
    observedAt, servedAt: observedAt, stale: false, staleReason: null,
  });
  return { ok: true, payload, observedAt, matches: payload.matches.length };
}

/** Mescla observações novas ao cache atual por `id` canônico; poda o que saiu da janela. */
export function mergeMatches(existing, incoming, now = Date.now()) {
  const byId = new Map();
  for (const m of existing ?? []) if (m?.id != null) byId.set(String(m.id), m);
  for (const m of incoming ?? []) if (m?.id != null) byId.set(String(m.id), m);
  return [...byId.values()]
    .filter((m) => { const t = Date.parse(m.date); return Number.isNaN(t) || (t >= now - KEEP_BEFORE_MS && t <= now + KEEP_AFTER_MS); })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Caminho de provedor-por-API (API-Football): aplica UMA observação a UMA competição.
 * `kind`: `live` (só o que está em jogo agora) ou `day` (faixa de datas, traz estados finais/agendados).
 * Partida que estava `in` no cache e some de `live` pode ter acabado: pede-se a sincronização do dia
 * (`followUp`) — nunca se inventa um final.
 */
export function applyObservation({ competition, raw, kind, calendar, existing, identityMap, now = Date.now() }) {
  if (!INGEST_COMPETITIONS.includes(competition)) return { ok: false, action: "REJECTED", reason: "competicao fora da whitelist fechada" };
  if (raw === null || typeof raw !== "object") return { ok: false, action: "NO_WRITE", reason: "corpo nao e um objeto JSON" };
  const problems = apiFootball.validateEnvelope(raw);
  if (problems.length) return { ok: false, action: "NO_WRITE", reason: `forma invalida: ${problems.slice(0, 3).join("; ")}` };
  if (!calendar || !Array.isArray(calendar.matches) || !calendar.matches.length) {
    return { ok: false, action: "NO_WRITE", reason: "calendario indisponivel (identidade nao resolvivel)" };
  }
  const { matches: incoming, unmapped } = apiFootball.toCanonicalMatches(raw, { competition, calendar: calendar.matches, identityMap });
  const prev = existing?.payload?.matches ?? [];
  const merged = mergeMatches(prev, incoming, now);
  const incomingIds = new Set(incoming.map((m) => String(m.id)));
  const vanished = kind === "live" ? prev.filter((m) => m.state === "in" && !incomingIds.has(String(m.id))) : [];
  const observedAt = new Date(now).toISOString();
  const payload = buildGatewayPayload({ competition, matches: merged, observedAt, servedAt: observedAt, stale: false, staleReason: null });
  return { ok: true, payload, observedAt, matches: merged.length, live: merged.filter((m) => m.state === "in").length, unmapped, vanishedLive: vanished.length };
}

/** Comparação em tempo (quase) constante: o token é segredo, `===` vaza o comprimento do prefixo. */
export function tokenMatches(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !expected) return false;
  const a = new TextEncoder().encode(provided), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const json = (status, body) => ({ status, body });

/**
 * Manipulador puro do endpoint de ingestão (a casca Deno só traduz Request/Response).
 *
 *   GET  ?plan=1&provider=api_football
 *        → o que buscar AGORA (ou nada, fora de janela). O Worker só executa: não conhece calendário.
 *   POST ?provider=api_football&kind=live|day&competitions=br2026,cdb2026[&dry_run=1]
 *        → valida, resolve identidade contra o calendário, mescla ao cache, grava (ou só simula)
 *
 * FALHA FECHADA: sem `ingestToken` → 503; sem calendário → NO_WRITE; sem credencial de escrita → 503.
 * Dependências injetadas: `writeImpl`, `readExisting(competition)`, `loadCalendar(competition)`, `identityMap`.
 */
export async function handleIngest(req, { ingestToken, writeImpl, readExisting, loadCalendar, identityMap = {}, now = Date.now() }) {
  if (!ingestToken) return json(503, { error: "ingest nao configurado" });
  const auth = req.headers?.authorization ?? req.headers?.Authorization ?? "";
  if (!tokenMatches(auth.startsWith("Bearer ") ? auth.slice(7) : "", ingestToken)) return json(401, { error: "nao autorizado" });

  const params = new URL(req.url, "https://ingest.invalid").searchParams;
  if (params.get("provider") !== "api_football") return json(400, { error: "provider desconhecido" });
  if (!loadCalendar || !readExisting) return json(503, { error: "dependencias de leitura ausentes" });

  if (req.method === "GET") {
    if (params.get("plan") !== "1") return json(400, { error: "use ?plan=1" });
    const polling = {}, existingByCompetition = {};
    for (const c of INGEST_COMPETITIONS) {
      const existing = (await readExisting(c))?.payload?.matches ?? [];
      existingByCompetition[c] = existing;
      polling[c] = decideCompetition({ calendar: await loadCalendar(c), existingMatches: existing, now });
    }
    const requests = planApiFootballRequests({ now, polling, existingByCompetition });
    return json(200, { schemaVersion: 1, provider: "api_football", poll: requests.length > 0, decisions: polling, requests });
  }
  if (req.method !== "POST") return json(405, { error: "metodo nao permitido" });

  const kind = params.get("kind");
  if (kind !== "live" && kind !== "day") return json(400, { error: "kind invalido" });
  const competitions = (params.get("competitions") ?? "").split(",").filter(Boolean);
  if (!competitions.length || !competitions.every((c) => INGEST_COMPETITIONS.includes(c))) return json(400, { error: "competicao desconhecida" });
  const bodyText = req.bodyText ?? "";
  if (new TextEncoder().encode(bodyText).length > MAX_BODY_BYTES) return json(413, { error: "corpo grande demais" });
  let raw;
  try { raw = JSON.parse(bodyText); } catch { return json(400, { action: "NO_WRITE", reason: "corpo nao e JSON" }); }
  const dry = params.get("dry_run") === "1";

  const results = [], followUp = [];
  let status = 200;
  for (const competition of competitions) {
    const r = applyObservation({ competition, raw, kind, calendar: await loadCalendar(competition), existing: await readExisting(competition), identityMap, now });
    if (!r.ok) { results.push({ competition, action: r.action, reason: r.reason }); status = Math.max(status, 422); continue; }
    if (r.vanishedLive) followUp.push(...planApiFootballRequests({ now, polling: { [competition]: { poll: true } }, forceDaySync: [competition] }).filter((q) => q.kind === "day"));
    const summary = { competition, matches: r.matches, live: r.live, unmapped: r.unmapped.length, observedAt: r.observedAt };
    if (dry) { results.push({ ...summary, action: "DRY_RUN" }); continue; }
    if (!writeImpl) return json(503, { error: "credencial de escrita ausente" });
    const written = await writeImpl({ competition, payload: r.payload, observedAt: r.observedAt });
    results.push({ ...summary, action: written ? "WRITTEN" : "WRITE_FAILED" });
    if (!written) status = Math.max(status, 502);
  }
  return json(status, { results, followUp: followUp.filter((q) => SAFE_PATH.test(q.path)) });
}
