/**
 * NÚCLEO PORTÁVEL DO PRODUTOR DO CACHE AO VIVO — migração de custo do GitHub Actions.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────
 *
 * Hoje há UM produtor: `bolao/shared/scripts/produce_live_cache.mjs`, executado num runner do
 * GitHub (única origem de egresso que a ESPN/Akamai aceita — Cloudflare e Supabase levam 403).
 * Com o repositório privado, esse runner passa a consumir minutos faturáveis.
 *
 * A parte que exige o runner é SÓ o GET na ESPN. Tudo o que vem depois — validar a forma, normalizar,
 * montar o envelope, decidir se há jogo em andamento, gravar — não depende de onde o byte chegou.
 * Este módulo é essa parte, sem `node:*`, sem `Deno.*`, sem rede e sem relógio próprio, para que
 * os DOIS caminhos executem exatamente o mesmo código:
 *
 *     produtor atual (produce_live_cache.mjs)  ──┐
 *                                                ├──►  buildCacheRecord()  ──►  live_sports_cache
 *     função `live-cache-ingest` (relay)       ──┘
 *
 * Uma implementação. Nenhuma cópia da normalização, nenhuma segunda definição do envelope.
 *
 * ─── O QUE ESTE MÓDULO NUNCA FAZ ────────────────────────────────────────────────────────────
 * Não escreve em lugar nenhum por conta própria (a gravação é injetada), não lê credencial, não
 * toca participante, pagamento, scoring, ranking ou e-mail.
 */
import {
  ALLOWED_COMPETITIONS, buildGatewayPayload, isLive, normalizeScoreboard, validateScoreboardShape,
} from "./normalize.js";
import { espnUrlFor } from "./gateway_core.js";

/**
 * Competições que o gateway serve HOJE. Copa está arquivada e o seu app não chama o gateway.
 * Fonte única: `produce_live_cache.mjs` reexporta daqui.
 */
export const INGEST_COMPETITIONS = Object.freeze(["br2026", "cdb2026"]);

/** Mesma janela do produtor: partida em andamento (-3h) até a hora de ligar antes do apito (+1h). */
export const ACTIVE_LOOKBACK_MS = 3 * 60 * 60_000;
export const ACTIVE_LOOKAHEAD_MS = 60 * 60_000;

/** Corpo máximo aceito pelo ingest. Um scoreboard real tem dezenas de KB. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Transforma o JSON CRU da ESPN no registro de cache. Mesma ordem de decisões do produtor original:
 * forma inválida é falha da fonte e NUNCA vira escrita (o último-bom-conhecido é o que segura o
 * gateway durante uma queda).
 */
export function buildCacheRecord(competition, raw, { now = Date.now() } = {}) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_COMPETITIONS, competition)) {
    return { ok: false, action: "REJECTED", reason: "competicao fora da whitelist fechada" };
  }
  if (raw === null || typeof raw !== "object") {
    return { ok: false, action: "NO_WRITE", reason: "corpo nao e um objeto JSON" };
  }
  const problems = validateScoreboardShape(raw);
  if (problems.length) {
    return { ok: false, action: "NO_WRITE", reason: `forma invalida: ${problems.slice(0, 3).join("; ")}` };
  }
  const observedAt = new Date(now).toISOString();
  const payload = buildGatewayPayload({
    competition, matches: normalizeScoreboard(raw, {}),
    observedAt, servedAt: observedAt, stale: false, staleReason: null,
  });
  return { ok: true, payload, observedAt, matches: payload.matches.length };
}

/**
 * Há motivo para continuar observando? Derivado da PRÓPRIA observação (estado da fonte), não de um
 * calendário em arquivo: a função não tem o repositório, e o estado da fonte é mais verdadeiro que
 * um calendário commitado. Ao vivo, ou apito dentro de [-3h, +1h].
 */
export function isActive(matches, now = Date.now()) {
  return (matches ?? []).some((m) => {
    if (isLive(m)) return true;
    const t = Date.parse(m?.date);
    if (Number.isNaN(t)) return false;
    return t >= now - ACTIVE_LOOKBACK_MS && t <= now + ACTIVE_LOOKAHEAD_MS;
  });
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
 * Manipulador puro do endpoint de ingestão. Não conhece Deno: recebe o pedido já lido e devolve
 * `{status, body}`. A casca (`live-cache-ingest/index.ts`) só traduz de/para Request/Response.
 *
 *   GET  ?plan=1                         → o que o relay deve buscar (URLs vêm de `espnUrlFor`)
 *   POST ?competition=br2026[&dry_run=1] → valida, normaliza, grava (ou só simula)
 *
 * FALHA FECHADA: sem `ingestToken` configurado o endpoint responde 503 e não aceita nada — nunca
 * cai para "aberto". `writeImpl` é injetado; sem credencial de escrita o pedido real é recusado.
 */
export async function handleIngest(req, { ingestToken, writeImpl, now = Date.now() }) {
  if (!ingestToken) return json(503, { error: "ingest nao configurado" });
  const auth = req.headers?.authorization ?? req.headers?.Authorization ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!tokenMatches(provided, ingestToken)) return json(401, { error: "nao autorizado" });

  const params = new URL(req.url, "https://ingest.invalid").searchParams;

  if (req.method === "GET") {
    if (params.get("plan") !== "1") return json(400, { error: "use ?plan=1" });
    return json(200, {
      schemaVersion: 1,
      competitions: INGEST_COMPETITIONS.map((competition) => ({ competition, url: espnUrlFor(competition) })),
    });
  }
  if (req.method !== "POST") return json(405, { error: "metodo nao permitido" });

  const competition = params.get("competition") ?? "";
  if (!INGEST_COMPETITIONS.includes(competition)) return json(400, { error: "competicao desconhecida" });

  const bodyText = req.bodyText ?? "";
  if (new TextEncoder().encode(bodyText).length > MAX_BODY_BYTES) return json(413, { error: "corpo grande demais" });
  let raw;
  try { raw = JSON.parse(bodyText); } catch { return json(400, { action: "NO_WRITE", reason: "corpo nao e JSON" }); }

  const rec = buildCacheRecord(competition, raw, { now });
  if (!rec.ok) return json(422, { action: rec.action, reason: rec.reason });

  const active = isActive(rec.payload.matches, now);
  if (params.get("dry_run") === "1") {
    return json(200, { action: "DRY_RUN", competition, matches: rec.matches, active, observedAt: rec.observedAt });
  }
  if (!writeImpl) return json(503, { error: "credencial de escrita ausente" });
  const written = await writeImpl({ competition, payload: rec.payload, observedAt: rec.observedAt });
  if (!written) return json(502, { action: "WRITE_FAILED", competition });
  return json(200, { action: "WRITTEN", competition, matches: rec.matches, active, observedAt: rec.observedAt });
}
