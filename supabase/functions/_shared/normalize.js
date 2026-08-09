/**
 * normalize.js — NORMALIZAÇÃO DA ESPN, uma implementação para os dois runtimes.
 *
 * ─── POR QUE ESTE ARQUIVO É `.js` E NÃO `.ts` ───────────────────────────────────────────────
 *
 * O gateway roda em Deno (Supabase Edge Function). Os testes rodam em Node. Se a normalização
 * fosse escrita em TypeScript dentro da função, ela só existiria no runtime que eu NÃO consigo
 * executar localmente — e a única forma de testá-la seria reescrevê-la no teste.
 *
 * Este repositório já pagou caro por exatamente isso: o `drawSelectorLabel` "kept in sync
 * manually" ficou dessincronizado e três testes passaram verde por meses exercitando uma função
 * que não existia mais. Duas cópias da mesma regra sempre divergem; a única questão é quando.
 *
 * ESM puro em `.js`: Deno importa, Node importa, é o MESMO arquivo. Nenhuma cópia.
 *
 * ─── E A VERSÃO PYTHON? ─────────────────────────────────────────────────────────────────────
 *
 * `bolao/shared/scripts/espn_provider.py` normaliza para o snapshot commitado. Ela continua
 * existindo porque o snapshot commitado continua existindo (bootstrap/fallback/auditoria).
 * São dois runtimes com a mesma regra — situação que este repo já trata com teste de interop
 * (ver `test_money_interop.mjs`, que compara três implementações de dinheiro contra a mesma
 * tabela). `test_espn_normalize_interop.mjs` faz o mesmo aqui: alimenta as duas com o MESMO
 * payload cru e falha se saírem diferentes.
 *
 * ─── MINIMIZAÇÃO DE DADOS ───────────────────────────────────────────────────────────────────
 *
 * A whitelist de `details` é deliberada e herdada do provider Python: repassar o `details` cru da
 * ESPN levava o snapshot do BR2026 a 2 MB, carregando URLs de perfil e nomes completos de atletas
 * que nenhum app consome. Campo novo entra aqui de propósito, nunca por acidente.
 */

/** Campos de atleta realmente consumidos por `extractMatchPlays()` nos três apps. Nada além. */
const DETAIL_ATHLETE_FIELDS = ["displayName", "shortName"];

export const SCHEMA_VERSION = 1;

/** Competições permitidas. Id desconhecido é REJEITADO — o gateway nunca vira proxy aberto. */
export const ALLOWED_COMPETITIONS = Object.freeze({
  br2026: "bra.1",
  cdb2026: "bra.copa_do_brasil",
  copa2026: "fifa.world",
});

function safeInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeTeamName(name, aliases) {
  const n = String(name || "").trim();
  return (aliases && aliases[n]) || n;
}

function normalizeDetails(details) {
  // ESPELHA `normalize_details()` de espn_provider.py CAMPO A CAMPO, inclusive na OMISSÃO de
  // chaves vazias. A primeira versão deste arquivo emitia `type.name: null` onde o Python
  // simplesmente não emite a chave — e o teste de interop pegou isso na primeira execução.
  // Parece detalhe estético; não é: o snapshot commitado e a resposta do gateway alimentam o
  // MESMO store no navegador, então uma diferença de forma vira comportamento diferente conforme
  // a origem do dado, que é o pior tipo de bug — intermitente e dependente de infraestrutura.
  if (!Array.isArray(details)) return [];
  const out = [];
  for (const d of details) {
    if (!d || typeof d !== "object") continue;
    const dtype = d.type && typeof d.type === "object" ? d.type : {};
    const clock = d.clock && typeof d.clock === "object" ? d.clock : {};
    const team = d.team && typeof d.team === "object" ? d.team : {};

    // O endpoint de summary usa `participants[].athlete`; os apps aceitam os dois formatos, então
    // normaliza-se para um só — mesma decisão do provider Python.
    let rawAthletes = d.athletesInvolved;
    if (!Array.isArray(rawAthletes)) {
      rawAthletes = (d.participants || []).filter((p) => p && typeof p === "object").map((p) => p.athlete);
    }
    const athletes = [];
    for (const a of rawAthletes || []) {
      if (!a || typeof a !== "object") continue;
      const trimmed = {};
      for (const f of DETAIL_ATHLETE_FIELDS) if (a[f]) trimmed[f] = a[f];
      if (Object.keys(trimmed).length) athletes.push(trimmed);
    }

    const entry = {
      type: Object.fromEntries(["text", "name"].filter((k) => dtype[k]).map((k) => [k, dtype[k]])),
      scoringPlay: d.scoringPlay === true,
      team: team.id !== null && team.id !== undefined ? { id: String(team.id) } : {},
      clock: Object.fromEntries(["value", "displayValue"]
        .filter((k) => clock[k] !== null && clock[k] !== undefined).map((k) => [k, clock[k]])),
    };
    if (athletes.length) entry.athletesInvolved = athletes;
    out.push(entry);
  }
  return out;
}

/**
 * Valida a FORMA do payload cru antes de confiar nele.
 *
 * Isto é o que impede envenenamento de cache: uma resposta HTTP 200 com corpo malformado NÃO pode
 * virar "último bom conhecido". Só promove a LAST_KNOWN_GOOD o que passa por aqui.
 *
 * @returns {string[]} lista de problemas; vazia = payload utilizável
 */
export function validateScoreboardShape(data) {
  const problems = [];
  if (!data || typeof data !== "object") { problems.push("payload não é objeto"); return problems; }
  if (!Array.isArray(data.events)) { problems.push("`events` ausente ou não é lista"); return problems; }
  // Lista vazia é LEGÍTIMA (dia sem jogo) e não é problema de forma — quem distingue "sem jogo"
  // de "fonte falhou" é o chamador, pelo status HTTP, nunca pelo tamanho da lista.
  for (const ev of data.events.slice(0, 5)) {
    const comp = (ev?.competitions || [])[0];
    if (!comp) { problems.push("evento sem `competitions[0]`"); break; }
    if (!Array.isArray(comp.competitors)) { problems.push("competição sem `competitors`"); break; }
  }
  return problems;
}

/** Normaliza o scoreboard cru da ESPN para o schema canônico já usado pelo snapshot commitado. */
export function normalizeScoreboard(data, aliases = {}) {
  const events = (data && data.events) || [];
  const out = [];
  for (const ev of events) {
    const comp = (ev?.competitions || [])[0] || {};
    const competitors = comp.competitors || [];
    const home = competitors.find((c) => c?.homeAway === "home");
    const away = competitors.find((c) => c?.homeAway === "away");
    if (!home || !away) continue; // evento sem os dois lados é inútil, não é erro

    const status = comp.status || {};
    const st = status.type || {};
    const venue = comp.venue || {};

    out.push({
      id: ev?.id ?? null,
      date: ev?.date ?? null,
      state: st.state ?? null,
      statusName: st.name ?? null,
      statusDescription: st.description ?? null,
      statusShortDetail: st.shortDetail ?? null,
      statusDetail: st.detail ?? null,
      completed: typeof st.completed === "boolean" ? st.completed : null,
      homeTeam: normalizeTeamName(home.team?.displayName || "", aliases),
      awayTeam: normalizeTeamName(away.team?.displayName || "", aliases),
      homeTeamId: home.team?.id ?? null,
      awayTeamId: away.team?.id ?? null,
      homeScore: safeInt(home.score),
      awayScore: safeInt(away.score),
      homeWinner: typeof home.winner === "boolean" ? home.winner : null,
      awayWinner: typeof away.winner === "boolean" ? away.winner : null,
      venue: venue.fullName ?? null,
      city: venue.address?.city ?? "",
      clockSec: typeof status.clock === "number" ? status.clock : null,
      clockStr: status.displayClock ?? "",
      period: Number.isInteger(status.period) ? status.period : null,
      details: normalizeDetails(comp.details),
    });
  }
  return out;
}

/** Uma partida está ao vivo segundo a FONTE (nunca inferido por relógio local). */
export function isLive(m) {
  return m?.state === "in";
}

/**
 * Monta a resposta do gateway. Mesmo schema do snapshot commitado, mais os campos que só o
 * gateway pode informar (idade real da observação, se veio de cache degradado).
 */
export function buildGatewayPayload({ competition, matches, observedAt, servedAt, stale, staleReason }) {
  const served = servedAt || new Date().toISOString();
  const ageSeconds = observedAt
    ? Math.max(0, Math.round((Date.parse(served) - Date.parse(observedAt)) / 1000))
    : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    competition,
    provider: "espn",
    observedAt: observedAt ?? null,
    servedAt: served,
    ageSeconds,
    stale: !!stale,
    staleReason: staleReason ?? null,
    matches: matches || [],
  };
}

/** Resposta explícita de fonte indisponível. NUNCA uma lista vazia com `stale:false`. */
export function sourceUnavailablePayload(competition, reason) {
  return {
    schemaVersion: SCHEMA_VERSION,
    competition,
    provider: "espn",
    observedAt: null,
    servedAt: new Date().toISOString(),
    ageSeconds: null,
    stale: true,
    staleReason: reason || "SOURCE_UNAVAILABLE",
    status: "SOURCE_UNAVAILABLE",
    matches: null, // `null`, não `[]` — "não sei" é diferente de "não há jogo"
  };
}
