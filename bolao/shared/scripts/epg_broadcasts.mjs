/**
 * epg_broadcasts.mjs — "Onde assistir" corroborado pela grade de TV brasileira (Issue #431).
 *
 * BROADCAST_SOURCE_MODEL = EPG_CORROBORATED_WITH_CURATED_OVERRIDE (substitui CURATED_ONLY, #425).
 *
 *     EPGShare BR1/BR2 (XMLTV) → corroborador (este módulo, só em workflow/Node) → próximos jogos
 *     do BR2026 (snapshot ESPN já commitado) → bolao/shared/data/broadcasts.json → where_to_watch.js
 *
 * Biblioteca PURA: nada aqui faz rede ou disco. Quem busca a grade e grava o arquivo é
 * `sync_epg_broadcasts.mjs`; os testes (`test_epg_broadcasts.mjs`) exercitam exatamente estas
 * funções. O navegador nunca carrega este arquivo — XMLTV tem megabytes e não pertence ao cliente.
 *
 * ─── DE ONDE VEM A FILOSOFIA ────────────────────────────────────────────────────────────────
 *
 * Portada do repositório irmão ferrarilabs/FerrariTV (`packages/football/src/corroborate.ts`,
 * `aliases.ts`, `broadcasters.ts`, `apps/api/src/guide.ts`), onde já funciona:
 *
 *   - a ESPN identifica a PARTIDA (id, kickoff, clubes) — nunca a transmissão; para bra.1 o campo
 *     `broadcasts` dela vem vazio (medido na #425);
 *   - a grade de TV é a evidência de transmissão, mas "Futebol" às 21h não prova que ESTA partida
 *     está naquele canal. Só vale quando o programa cita os DOIS clubes e está no horário do jogo.
 *
 * Em relação ao FerrariTV este módulo é deliberadamente MAIS conservador, porque aqui a saída vai
 * direto para a tela sem passar por um "fraco/forte" visível ao usuário:
 *
 *   1. identificação de clube por MAIOR alias casado, com sufixo de estado como identidade —
 *      "Botafogo-SP x Goiás" não conta como Botafogo (o casamento por token do FerrariTV aceitaria);
 *   2. replay, pré-jogo, feminino, base e futsal são recusados por marcador (título, subtítulo OU
 *      categoria) — a grade real de 2026-09-12 tinha "Flamengo x São Paulo - Ao Vivo" no SporTV com
 *      categoria "Futebol Feminino", no mesmo horário em que outra fonte listava só o título;
 *   3. um marcador visto em QUALQUER fonte veta o canal inteiro naquele horário;
 *   4. programa citando três ou mais clubes (rodada dupla, "giro") é ambíguo e recusado;
 *   5. um mesmo programa que corrobore duas partidas é ambíguo e recusado nas duas;
 *   6. só canais de uma allowlist viram transmissão — canal desconhecido nunca é publicado.
 *
 * ─── PRECEDÊNCIA ────────────────────────────────────────────────────────────────────────────
 *
 * Registro humano (sem `origin`, ou `origin: "curated"`) SEMPRE vence e nunca é tocado. Entrada
 * automática leva `origin: "epg"` e `evidence[]` com a proveniência completa. Streaming sem grade
 * (Prime Video, CazéTV quando só no YouTube) nunca é inventado: só entra por curadoria.
 *
 * ─── LAST-KNOWN-GOOD ────────────────────────────────────────────────────────────────────────
 *
 * EPG fora do ar, parcial ou sem o canal nunca remove entrada. Um canal automático só sai quando a
 * grade daquele canal, numa fonte que respondeu, CONTRADIZ positivamente a evidência anterior: há
 * programa no ar no instante do kickoff e ele não corrobora a partida. "Não sei" nunca vira "não é".
 */

export const SOURCE_MODEL = "EPG_CORROBORATED_WITH_CURATED_OVERRIDE";

export const EPG_SOURCES = Object.freeze([
  Object.freeze({ id: "epgshare-br1", url: "https://epgshare01.online/epgshare01/epg_ripper_BR1.xml.gz" }),
  Object.freeze({ id: "epgshare-br2", url: "https://epgshare01.online/epgshare01/epg_ripper_BR2.xml.gz" }),
]);
export const EPG_ALLOWED_HOSTS = Object.freeze(["epgshare01.online"]);

export const AUTO_SOURCE_TEXT =
  "EPG XMLTV epgshare01 (BR1/BR2) — corroboração automática: programa cita os dois clubes no horário do kickoff";

const MIN = 60 * 1000;
/** Um programa de jogo pode abrir até 60 min antes (pré-jogo no mesmo bloco)… */
export const WINDOW_LEAD_MS = 60 * MIN;
/** …e começar no máximo 15 min depois do kickoff (grade atrasada), */
export const WINDOW_LAG_MS = 15 * MIN;
/** …e precisa continuar no ar pelo menos 45 min depois do kickoff — um jogo dura 105+. */
export const MIN_COVER_AFTER_KICKOFF_MS = 45 * MIN;
/**
 * Instante usado para comparar fontes e detectar contradição: 30 min depois do kickoff. No próprio
 * kickoff um "Aquecimento" que termina 5 min atrasado pareceria outro programa no ar.
 */
export const PROBE_AFTER_KICKOFF_MS = 30 * MIN;
/** Entrada automática de jogo que já passou há mais que isso sai do arquivo (não afeta a UI). */
export const AUTO_PRUNE_AFTER_MS = 7 * 24 * 60 * MIN;
/** Status ESPN de partida que não vai acontecer no horário registrado (mesma lista de round_state.py). */
export const INACTIVE_STATUS_NAMES = new Set(["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED"]);

// ─── normalização de clube (portada de FerrariTV packages/football/src/aliases.ts) ─────────────

const CORPORATE_TOKENS = new Set(["fc", "ec", "sc", "ac", "cr", "se", "aa", "ca", "cd"]);
const CORPORATE_PHRASES = [
  /\bclube de regatas\b/g, /\bfutebol clube\b/g, /\besporte clube\b/g,
  /\bclube atletico\b/g, /\bassociacao atletica\b/g, /\bsociedade esportiva\b/g,
];

/** Acento, caixa e pontuação somem; tudo que distingue um clube de outro fica. */
export function fold(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeTeamName(value) {
  let cleaned = fold(value);
  for (const phrase of CORPORATE_PHRASES) cleaned = cleaned.replace(phrase, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => !CORPORATE_TOKENS.has(t));
  return (kept.length > 0 ? kept : tokens).join(" ");
}

/**
 * Chave canônica → grafias observadas. Mesma regra do FerrariTV: só grafia vista em provedor ou
 * fonte oficial entra aqui; é evidência, não palpite. Sufixo de estado é IDENTIDADE.
 */
export const TEAM_ALIASES = Object.freeze({
  flamengo: ["Flamengo", "CR Flamengo", "Clube de Regatas do Flamengo", "Flamengo RJ"],
  fluminense: ["Fluminense", "Fluminense FC", "Fluminense RJ"],
  botafogo: ["Botafogo", "Botafogo RJ", "Botafogo de Futebol e Regatas"],
  "botafogo-sp": ["Botafogo-SP", "Botafogo SP"],
  vasco: ["Vasco da Gama", "Vasco", "CR Vasco da Gama"],
  palmeiras: ["Palmeiras", "SE Palmeiras", "Sociedade Esportiva Palmeiras"],
  "sao-paulo": ["São Paulo", "Sao Paulo", "São Paulo FC"],
  corinthians: ["Corinthians", "SC Corinthians Paulista", "Corinthians Paulista"],
  santos: ["Santos", "Santos FC"],
  bragantino: ["Red Bull Bragantino", "RB Bragantino", "Bragantino"],
  gremio: ["Grêmio", "Gremio", "Grêmio FBPA", "Gremio Porto Alegrense"],
  internacional: ["Internacional", "SC Internacional", "Inter de Porto Alegre"],
  "atletico-mg": ["Atlético-MG", "Atletico MG", "Atlético Mineiro", "Clube Atlético Mineiro"],
  "atletico-go": ["Atlético-GO", "Atletico GO", "Atlético Goianiense"],
  "athletico-pr": ["Athletico-PR", "Athletico PR", "Athletico Paranaense", "Atlético Paranaense"],
  cruzeiro: ["Cruzeiro", "Cruzeiro EC"],
  bahia: ["Bahia", "EC Bahia", "Esporte Clube Bahia"],
  vitoria: ["Vitória", "Vitoria", "EC Vitória"],
  fortaleza: ["Fortaleza", "Fortaleza EC"],
  ceara: ["Ceará", "Ceara", "Ceará SC"],
  "sport-recife": ["Sport Recife", "Sport", "Sport Club do Recife"],
  juventude: ["Juventude", "EC Juventude"],
  chapecoense: ["Chapecoense", "Chapecoense AF"],
  criciuma: ["Criciúma", "Criciuma", "Criciúma EC"],
  mirassol: ["Mirassol", "Mirassol FC"],
  goias: ["Goiás", "Goias", "Goiás EC"],
  coritiba: ["Coritiba", "Coritiba FC"],
  avai: ["Avaí", "Avai", "Avaí FC"],
  nautico: ["Náutico", "Nautico"],
  remo: ["Remo", "Clube do Remo"],
  paysandu: ["Paysandu", "Paysandu SC"],
  novorizontino: ["Novorizontino", "Grêmio Novorizontino"],
});

/** alias normalizado → chave canônica. */
const CANONICAL_BY_ALIAS = (() => {
  const index = new Map();
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    index.set(normalizeTeamName(key.replace(/-/g, " ")), key);
    for (const alias of aliases) {
      const n = normalizeTeamName(alias);
      if (n) index.set(n, key);
    }
  }
  return index;
})();

/** Clube desconhecido resolve para o próprio nome normalizado — nunca para o "mais parecido". */
export function resolveTeamKey(name) {
  const n = normalizeTeamName(name);
  return CANONICAL_BY_ALIAS.get(n) ?? n;
}

/**
 * Grafias para procurar clube em TEXTO DE GRADE, dobradas com fold() — a mesma tokenização do texto.
 * Não usa normalizeTeamName(): tirar a frase corporativa de "Clube Atlético Mineiro" deixa só
 * "mineiro", e aí "Campeonato Mineiro: Cruzeiro x Tombense" virava Cruzeiro × Atlético-MG (revisão
 * adversarial do PR #432, S3).
 */
const CANONICAL_BY_FOLDED_ALIAS = (() => {
  const index = new Map();
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    index.set(fold(key.replace(/-/g, " ")), key);
    for (const alias of aliases) {
      const f = fold(alias);
      if (f) index.set(f, key);
    }
  }
  return index;
})();

const UF = new Set(["ac", "al", "am", "ap", "ba", "ce", "df", "es", "go", "ma", "mg", "ms", "mt", "pa",
  "pb", "pe", "pi", "pr", "rj", "rn", "ro", "rr", "rs", "sc", "se", "sp", "to"]);

/**
 * Clubes citados num texto, por MAIOR grafia casada a partir de cada posição.
 *
 * `extra` acrescenta as grafias dos clubes da própria fixture (clube fora da tabela ainda casa
 * pelo nome exato). Uma grafia seguida de sigla de estado que ela mesma não carrega é OUTRO clube
 * ("Botafogo" + "SP", "Atlético" + "GO") e é registrada como desconhecida, nunca como o clube curto.
 */
export function clubsMentioned(text, extra = []) {
  const dict = new Map(CANONICAL_BY_FOLDED_ALIAS);
  for (const name of extra) {
    const n = fold(name);
    if (n && !dict.has(n)) dict.set(n, resolveTeamKey(name));
  }
  const spellings = [...dict.keys()].map((s) => s.split(" ")).sort((a, b) => b.length - a.length);
  // Tokenização SEM tirar sigla corporativa: no título de grade "SC" é quase sempre Santa Catarina.
  const hay = fold(text).split(" ").filter(Boolean);
  const found = new Set();
  const unknown = [];
  let i = 0;
  while (i < hay.length) {
    let best = null;
    for (const words of spellings) {
      if (i + words.length > hay.length) continue;
      let all = true;
      for (let k = 0; k < words.length; k++) if (hay[i + k] !== words[k]) { all = false; break; }
      if (all) { best = words; break; }
    }
    if (!best) { i += 1; continue; }
    const next = hay[i + best.length];
    const carriesUf = UF.has(best[best.length - 1]);
    if (next && UF.has(next) && !carriesUf) {
      unknown.push(`${best.join(" ")} ${next}`);
      i += best.length + 1;
      continue;
    }
    found.add(dict.get(best.join(" ")));
    i += best.length;
  }
  return { keys: found, unknown };
}

// ─── canais: allowlist e nome de exibição (espírito de FerrariTV broadcasters.ts) ───────────────

const OPEN_TV_NOTE = " (TV aberta — consulte sua região)";

/**
 * Ordem de exibição e rótulo apresentado. TV aberta leva a ressalva regional: a grade do EPG é de
 * UMA praça (São Paulo/Rio), e o jogo na Globo de uma praça não é o jogo na Globo de todas.
 * Canais Premiere/SporTV/ESPN numerados preservam o número quando a grade o distingue.
 */
const CHANNEL_RULES = [
  { re: /^(tv )?globo$/, broadcaster: "Globo", label: () => "Globo" + OPEN_TV_NOTE, order: 10 },
  { re: /^record( tv)?$/, broadcaster: "Record", label: () => "Record" + OPEN_TV_NOTE, order: 20 },
  { re: /^band$/, broadcaster: "Band", label: () => "Band" + OPEN_TV_NOTE, order: 30 },
  { re: /^sportv$/, broadcaster: "SporTV", label: () => "SporTV", order: 40 },
  { re: /^sportv ([2-4])$/, broadcaster: "SporTV", label: (m) => `SporTV ${m[1]}`, order: 41 },
  { re: /^premiere( clubes)?$/, broadcaster: "Premiere", label: () => "Premiere", order: 50 },
  { re: /^premiere ([2-9])$/, broadcaster: "Premiere", label: (m) => `Premiere ${m[1]}`, order: 51 },
  { re: /^band ?sports$/, broadcaster: "BandSports", label: () => "BandSports", order: 60 },
  { re: /^espn( brasil)?$/, broadcaster: "ESPN", label: () => "ESPN", order: 70 },
  { re: /^espn ([2-6])$/, broadcaster: "ESPN", label: (m) => `ESPN ${m[1]}`, order: 71 },
  { re: /^caze ?tv$/, broadcaster: "CazéTV", label: () => "CazéTV", order: 80 },
];

/** "Premiere 3" ordena depois de "Premiere"; " clubes" (grupo não numérico) não soma nada. */
function numberSuffix(m) {
  return m[1] && /^\d$/.test(m[1]) ? Number(m[1]) / 10 : 0;
}

/** Todos os rótulos que o pipeline automático é capaz de publicar (o validador usa isto). */
const AUTO_LABEL_RE = new RegExp(
  "^(?:(?:Globo|Record|Band)" + OPEN_TV_NOTE.replace(/[()]/g, "\\$&") + "|SporTV(?: [2-4])?|Premiere(?: [2-9])?" +
  "|BandSports|ESPN(?: [2-6])?|CazéTV)$");
export function isAutoChannelLabel(label) {
  return AUTO_LABEL_RE.test(String(label));
}

/**
 * id de canal XMLTV → {broadcaster, label, order} ou null.
 *   "São.Paulo/SP..PREMIERE.HD.3.³.br" → Premiere 3      "Premiere.Clubes.br" → Premiere
 *   "São.Paulo/SP..SporTV.HD.³.br"     → SporTV (o "³" é marca de qualidade da operadora, não número)
 *   "Globo.News.br" → null (GloboNews não transmite jogo; não está na allowlist)
 */
export function resolveChannel(epgChannelId) {
  let s = String(epgChannelId == null ? "" : epgChannelId);
  s = s.replace(/\.br$/i, "");
  s = s.replace(/^[^/]*\/[A-Za-z]{2}\.+/, ""); // prefixo de praça "São.Paulo/SP.."
  // NFKD transforma "³" em "3"; tirar ANTES do fold, senão "SporTV HD ³" vira "SporTV 3".
  s = s.replace(/[¹²³⁰-₟]/g, " ");
  const name = fold(s.replace(/\./g, " ")).split(" ")
    .filter((t) => t && t !== "hd" && t !== "fhd" && t !== "sd").join(" ");
  for (const rule of CHANNEL_RULES) {
    const m = rule.re.exec(name);
    if (m) return { broadcaster: rule.broadcaster, label: rule.label(m), order: rule.order + numberSuffix(m) };
  }
  return null;
}

// ─── XMLTV ─────────────────────────────────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** "20260912160000 -0300" → epoch ms; NaN quando ilegível. */
export function parseXmltvTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2})(\d{2}))?$/.exec(String(value || "").trim());
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!m[7]) return utc;
  const offset = (+m[8] * 60 + +m[9]) * MIN;
  return m[7] === "+" ? utc - offset : utc + offset;
}

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

function firstTag(body, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(body);
  return m ? decodeEntities(m[1]).trim() : null;
}

/**
 * Parser XMLTV mínimo, sem dependência. Só lê o que a corroboração usa. Programa com horário
 * ilegível é descartado (não pode provar janela nenhuma).
 */
export function parseXmltv(xml, sourceId) {
  const text = String(xml || "");
  const programmes = [];
  const channelIds = [];
  for (const m of text.matchAll(/<channel\b([^>]*)>/g)) {
    const a = attrs(m[1]);
    if (a.id) channelIds.push(a.id);
  }
  for (const m of text.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const a = attrs(m[1]);
    const start = parseXmltvTime(a.start);
    const stop = parseXmltvTime(a.stop);
    if (!a.channel || !Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue;
    const categories = [...m[2].matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/g)].map((c) => decodeEntities(c[1]).trim());
    programmes.push({
      source: sourceId,
      channelId: a.channel,
      start,
      stop,
      title: firstTag(m[2], "title") || "",
      subTitle: firstTag(m[2], "sub-title"),
      categories,
    });
  }
  return { source: sourceId, channelCount: channelIds.length, channelIds, programmes };
}

// ─── corroboração ──────────────────────────────────────────────────────────────────────────

/** Recusa por natureza do programa. Casado por token inteiro sobre título+subtítulo+categorias. */
const REJECT_MARKERS = [
  ["vt"], ["reprise"], ["compacto"], ["melhores", "momentos"], ["gols", "da", "rodada"],
  ["giro", "da", "rodada"], ["pre", "hora"], ["pre", "jogo"], ["pos", "jogo"], ["aquecimento"],
  ["feminino"], ["feminina"], ["sub", "15"], ["sub", "17"], ["sub", "20"], ["sub", "23"], ["sub20"],
  ["sub17"], ["futsal"], ["futebol", "de", "salao"], ["beach", "soccer"], ["fut7"], ["society"],
  ["esports"], ["efootball"], ["fifa"],
];

export function rejectMarker(programme) {
  const hay = fold([programme.title, programme.subTitle, ...(programme.categories || [])].join(" ")).split(" ");
  for (const marker of REJECT_MARKERS) {
    for (let i = 0; i + marker.length <= hay.length; i++) {
      let all = true;
      for (let k = 0; k < marker.length; k++) if (hay[i + k] !== marker[k]) { all = false; break; }
      if (all) return marker.join(" ");
    }
  }
  return null;
}

export function inKickoffWindow(programme, kickoffMs) {
  return programme.start >= kickoffMs - WINDOW_LEAD_MS &&
    programme.start <= kickoffMs + WINDOW_LAG_MS &&
    programme.stop >= kickoffMs + MIN_COVER_AFTER_KICKOFF_MS;
}

function isoMinute(ms) { return new Date(ms).toISOString().slice(0, 16) + "Z"; }
function isoSecond(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }

/**
 * Corrobora UMA partida contra os programas de todas as fontes que responderam.
 *
 * @param {{id:string, kickoffMs:number, home:string, away:string}} fixture
 * @returns {{channels: Array<{label, broadcaster, order, evidence: object[]}>, rejections: object[]}}
 */
export function corroborateFixture(fixture, programmes) {
  const home = resolveTeamKey(fixture.home);
  const away = resolveTeamKey(fixture.away);
  const rejections = [];
  if (!home || !away || home === away) {
    return { channels: [], rejections: [{ reason: "AMBIGUOUS_FIXTURE_IDENTITY" }] };
  }
  const k = fixture.kickoffMs;
  const nearby = programmes.filter((p) => p.stop > k - 3 * 60 * MIN && p.start < k + 3 * 60 * MIN);

  const byLabel = new Map(); // label → {channel, evidence[], vetoedBy}
  for (const p of nearby) {
    const text = [p.title, p.subTitle].filter(Boolean).join(" ");
    const { keys, unknown } = clubsMentioned(text, [fixture.home, fixture.away]);
    const hasHome = keys.has(home), hasAway = keys.has(away);
    if (!hasHome && !hasAway) continue; // "Futebol", "Programação Globo": nem é quase-casamento

    const channel = resolveChannel(p.channelId);
    const base = { source: p.source, epgChannelId: p.channelId, title: p.title, subTitle: p.subTitle,
      start: isoSecond(p.start), stop: isoSecond(p.stop), label: channel ? channel.label : null };

    if (!(hasHome && hasAway)) {
      if (inKickoffWindow(p, k)) rejections.push({ reason: "ONE_TEAM_ONLY", ...base, unknownClubs: unknown });
      continue;
    }
    if (keys.size > 2) { rejections.push({ reason: "MORE_THAN_TWO_CLUBS", ...base }); continue; }
    if (!namesFixture(p, fixture)) { rejections.push({ reason: "NO_MATCH_SEPARATOR", ...base }); continue; }
    if (!inKickoffWindow(p, k)) { rejections.push({ reason: "OUT_OF_KICKOFF_WINDOW", ...base }); continue; }
    if (!channel) { rejections.push({ reason: "CHANNEL_NOT_ALLOWLISTED", ...base }); continue; }

    const slot = byLabel.get(channel.label) || { channel, evidence: [], vetoedBy: null };
    const marker = rejectMarker(p);
    if (marker) {
      slot.vetoedBy = slot.vetoedBy || { reason: "VETOED_BY_MARKER_IN_OTHER_SOURCE", marker, ...base };
      rejections.push({ reason: "REJECTED_MARKER", marker, ...base });
    } else {
      slot.evidence.push({
        channel: channel.label,
        source: p.source,
        epgChannelId: p.channelId,
        programmeTitle: p.title,
        programmeSubTitle: p.subTitle || null,
        programmeCategories: p.categories && p.categories.length ? p.categories : undefined,
        programmeStart: isoSecond(p.start),
        programmeStop: isoSecond(p.stop),
        matchedTeams: [home, away],
      });
    }
    byLabel.set(channel.label, slot);
  }

  // Fontes em desacordo: se outra fonte (ou outro id do mesmo canal) mostra, 30 min depois do
  // kickoff, um programa que NÃO cita os dois clubes, a grade não é unânime — não publica. Caso real
  // de 2026-09-12: ESPN.br era "Sunderland x Arsenal" no BR1 e "Mundo F" no BR2 no mesmo horário.
  const probe = k + PROBE_AFTER_KICKOFF_MS;
  for (const [label, slot] of byLabel) {
    if (slot.vetoedBy || !slot.evidence.length) continue;
    const dissent = nearby.find((p) => p.start <= probe && p.stop > probe &&
      (resolveChannel(p.channelId) || {}).label === label && !namesBoth(p, fixture));
    if (dissent) {
      slot.vetoedBy = { reason: "SOURCE_DISAGREEMENT", source: dissent.source, epgChannelId: dissent.channelId,
        dissentTitle: [dissent.title, dissent.subTitle].filter(Boolean).join(" / "), start: isoSecond(dissent.start) };
    }
  }

  const channels = [];
  for (const [label, slot] of byLabel) {
    if (slot.vetoedBy) {
      if (slot.evidence.length) {
        rejections.push({ reason: slot.vetoedBy.reason, label, marker: slot.vetoedBy.marker,
          source: slot.vetoedBy.source, epgChannelId: slot.vetoedBy.epgChannelId, start: slot.evidence[0].programmeStart,
          title: slot.evidence[0].programmeTitle, dissentTitle: slot.vetoedBy.dissentTitle });
      }
      continue;
    }
    if (!slot.evidence.length) continue;
    // HD e SD do mesmo canal na mesma fonte são o mesmo programa: uma evidência por fonte+início+título.
    const seen = new Set();
    const evidence = slot.evidence.filter((e) => {
      const key = `${e.source}|${e.programmeStart}|${fold(e.programmeTitle)}|${fold(e.programmeSubTitle)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    channels.push({ label, broadcaster: slot.channel.broadcaster, order: slot.channel.order, evidence });
  }
  channels.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return { channels, rejections };
}

function namesBoth(p, fixture) {
  return namesFixture(p, fixture);
}

const MATCH_SEPARATOR = /\s(?:x|×|vs\.?|versus)\s/i;

/**
 * A grade lista confronto como "A x B". Só conta quando UM campo (título ou subtítulo) tem um único
 * separador com um clube de cada lado. "Esporte Espetacular: Bahia e Remo", "Remo: Brasileiro de
 * Remo - Salvador, Bahia" e "Todos os Santos: Missa em São Paulo" citam os dois nomes e não são
 * jogo nenhum (revisão adversarial do PR #432, S3). Na grade real de 2026-09-12, os 249 programas
 * de canais monitorados que citam dois clubes usam o separador — a regra não perde cobertura.
 */
export function namesFixture(p, fixture) {
  const home = resolveTeamKey(fixture.home);
  const away = resolveTeamKey(fixture.away);
  const extra = [fixture.home, fixture.away];
  for (const field of [p.title, p.subTitle]) {
    if (!field) continue;
    const parts = String(field).split(MATCH_SEPARATOR);
    if (parts.length !== 2) continue;
    const left = clubsMentioned(parts[0], extra).keys;
    const right = clubsMentioned(parts[1], extra).keys;
    if ((left.has(home) && !left.has(away) && right.has(away) && !right.has(home)) ||
        (left.has(away) && !left.has(home) && right.has(home) && !right.has(away))) return true;
  }
  return false;
}

/**
 * Corrobora várias partidas e derruba, nas duas, qualquer programa que tenha corroborado mais de
 * uma (identidade ambígua). Devolve Map id → resultado.
 */
export function corroborateFixtures(fixtures, programmes) {
  const results = new Map();
  for (const f of fixtures) results.set(f.id, corroborateFixture(f, programmes));
  const claims = new Map();
  for (const [id, r] of results) {
    for (const c of r.channels) for (const e of c.evidence) {
      const key = `${e.source}|${e.epgChannelId}|${e.programmeStart}`;
      if (!claims.has(key)) claims.set(key, new Set());
      claims.get(key).add(id);
    }
  }
  for (const [key, ids] of claims) {
    if (ids.size < 2) continue;
    for (const id of ids) {
      const r = results.get(id);
      for (const c of r.channels) {
        c.evidence = c.evidence.filter((e) => `${e.source}|${e.epgChannelId}|${e.programmeStart}` !== key);
      }
      r.channels = r.channels.filter((c) => c.evidence.length);
      r.rejections.push({ reason: "PROGRAMME_MATCHES_MULTIPLE_FIXTURES", programme: key, fixtures: [...ids] });
    }
  }
  return results;
}

/**
 * A grade CONTRADIZ positivamente o canal para esta partida? Avaliado POR ITEM DE EVIDÊNCIA, no
 * MESMO `source` e no MESMO `epgChannelId` que corroboraram antes — nunca pelo rótulo. O canal só é
 * contraditado quando TODA evidência dele é contraditada: a fonte respondeu e, naquele id, 30 min
 * depois do kickoff, está no ar um programa real (não placeholder "Programação …") que não é este
 * jogo ao vivo (não cita os dois clubes com separador, ou é replay/feminino/base).
 *
 * Tudo o mais é "não sei" e preserva (revisão adversarial do PR #432, S2): outra praça da Globo com
 * outra grade, HD divergindo do SD, outra fonte discordando, id renomeado, placeholder, fonte fora
 * do ar, grade que termina antes do jogo.
 */
export function channelContradicted(label, fixture, programmes, okSources, previousEvidence) {
  const items = (previousEvidence || []).filter((e) => e && e.channel === label);
  if (!items.length) return false;
  const probe = fixture.kickoffMs + PROBE_AFTER_KICKOFF_MS;
  return items.every((ev) => okSources.has(ev.source) && programmes.some((p) =>
    p.source === ev.source && p.channelId === ev.epgChannelId && p.start <= probe && p.stop > probe &&
    !isPlaceholderTitle(p) && !(namesFixture(p, fixture) && !rejectMarker(p))));
}

function isPlaceholderTitle(p) {
  return /^programacao\b/.test(fold(p.title));
}

// ─── merge com broadcasts.json ─────────────────────────────────────────────────────────────

export function isAutoEntry(e) { return !!e && e.origin === "epg"; }

function utcMinuteOf(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16) : "";
}

/** Existe registro HUMANO para esta partida? id ESPN, ou minuto + os dois clubes por alias. */
export function curatedEntryFor(fixture, entries) {
  const minute = new Date(fixture.kickoffMs).toISOString().slice(0, 16);
  return entries.find((e) => !isAutoEntry(e) && (
    (e.espnId && String(e.espnId) === String(fixture.id)) ||
    (!e.espnId && utcMinuteOf(e.kickoffUtc) === minute &&
      resolveTeamKey(e.home) === resolveTeamKey(fixture.home) &&
      resolveTeamKey(e.away) === resolveTeamKey(fixture.away))
  )) || null;
}

function evidenceKey(e) {
  return [e.channel, e.source, e.epgChannelId, e.programmeStart, e.programmeStop, e.programmeTitle, e.programmeSubTitle || ""].join("|");
}

function channelOrder(label) {
  for (const rule of CHANNEL_RULES) {
    const m = rule.re.exec(fold(label.replace(OPEN_TV_NOTE, "")));
    if (m) return rule.order + numberSuffix(m);
  }
  return 999;
}

/**
 * Funde a corroboração do run atual no documento existente. Nunca lança por dado de fonte; devolve
 * `{doc, changed, report}`.
 *
 * @param {object} existingDoc   broadcasts.json atual (já validado)
 * @param {Array}  fixtures      partidas em escopo: {id, kickoffMs, kickoffUtc, home, away}
 * @param {Map}    results       saída de corroborateFixtures()
 * @param {object} ctx           {now:Date, okSources:Set<string>, programmes:Array,
 *                               snapshotIndex?:Map<espnId,{kickoffUtc,statusName}> — todas as partidas}
 */
export function mergeBroadcasts(existingDoc, fixtures, results, ctx) {
  const now = ctx.now.getTime();
  const nowIso = isoSecond(now);
  const entries = Array.isArray(existingDoc.entries) ? existingDoc.entries : [];
  const curated = entries.filter((e) => !isAutoEntry(e));
  const previousAuto = entries.filter(isAutoEntry);
  const prevById = new Map(previousAuto.map((e) => [String(e.espnId), e]));
  const inScope = new Set(fixtures.map((f) => String(f.id)));
  const report = [];
  const nextAuto = [];

  for (const f of [...fixtures].sort((a, b) => a.kickoffMs - b.kickoffMs)) {
    const r = results.get(f.id) || { channels: [], rejections: [] };
    const stored = prevById.get(String(f.id)) || null;
    // Remarcação (B1 da revisão adversarial do PR #432): evidência colhida para OUTRO horário não
    // prova nada sobre o novo. A entrada anterior é descartada inteira, nunca herdada.
    const rescheduledFrom = stored && utcMinuteOf(stored.kickoffUtc) !== utcMinuteOf(f.kickoffUtc)
      ? stored.kickoffUtc : null;
    const prev = rescheduledFrom ? null : stored;
    const human = curatedEntryFor(f, curated);
    const row = { espnId: String(f.id), kickoffUtc: f.kickoffUtc, home: f.home, away: f.away, rejections: r.rejections };
    if (rescheduledFrom) row.rescheduledFrom = rescheduledFrom;

    if (human) {
      // Curadoria vence sempre. Sem espnId, porém, o BR2026 (que casa por id) não a exibe: o humano
      // continua suprimindo o automático, mas o relatório avisa em vez de contar como cobertura.
      report.push({ ...row, status: human.espnId ? "CURATED_OVERRIDE" : "CURATED_OVERRIDE_WITHOUT_ESPNID",
        channels: human.channels, epgAlsoSaw: r.channels.map((c) => c.label), evidence: [] });
      continue; // entrada automática anterior (se houver) sai: o humano venceu
    }

    const prevEvidence = prev && Array.isArray(prev.evidence) ? prev.evidence : [];
    const byChannel = new Map();
    for (const c of r.channels) byChannel.set(c.label, c.evidence.map((e) => ({ ...e })));
    const kept = [];
    const dropped = [];
    if (prev) {
      for (const label of prev.channels || []) {
        if (byChannel.has(label)) continue;
        if (channelContradicted(label, f, ctx.programmes, ctx.okSources, prevEvidence)) {
          dropped.push(label);
        } else {
          byChannel.set(label, prevEvidence.filter((e) => e.channel === label));
          kept.push(label);
        }
      }
    }

    if (!byChannel.size) {
      if (rescheduledFrom) report.push({ ...row, status: "RESCHEDULED_DROPPED", channels: [], evidence: [] });
      else if (prev) report.push({ ...row, status: "REMOVED_CONTRADICTED", channels: [], dropped, evidence: [] });
      else report.push({ ...row, status: "MISSING", channels: [], evidence: [] });
      continue;
    }

    // Evidência já conhecida mantém o collectedAt original: rodar de novo sem mudança na grade não
    // pode gerar commit.
    const prevCollected = new Map(prevEvidence.map((e) => [evidenceKey(e), e.collectedAt]));
    const labels = [...byChannel.keys()].sort((a, b) => channelOrder(a) - channelOrder(b) || a.localeCompare(b));
    const evidence = [];
    for (const label of labels) {
      for (const e of byChannel.get(label)) {
        const clean = { ...e };
        if (clean.programmeCategories === undefined) delete clean.programmeCategories;
        clean.collectedAt = prevCollected.get(evidenceKey(clean)) || clean.collectedAt || nowIso;
        evidence.push(clean);
      }
    }
    const collectedAt = evidence.map((e) => e.collectedAt).sort()[0];
    const entry = {
      espnId: String(f.id),
      kickoffUtc: f.kickoffUtc,
      home: f.home,
      away: f.away,
      channels: labels,
      origin: "epg",
      source: AUTO_SOURCE_TEXT,
      confirmedAt: collectedAt.slice(0, 10),
      collectedAt,
      evidence,
    };
    const same = prev && JSON.stringify(canonicalAuto(prev)) === JSON.stringify(canonicalAuto(entry));
    const finalEntry = same ? prev : entry;
    nextAuto.push(finalEntry);
    const status = !prev ? "ADDED" : !r.channels.length ? "KEPT_LAST_KNOWN_GOOD" : same ? "UNCHANGED" : "UPDATED";
    report.push({ ...row, status,
      channels: labels, kept, dropped, evidence: finalEntry.evidence });
  }

  // Automáticas fora do escopo deste run (passado recente, além do horizonte, fixture sumida do
  // snapshot): preservadas — exceto jogo que já passou há mais de AUTO_PRUNE_AFTER_MS.
  for (const e of previousAuto) {
    if (inScope.has(String(e.espnId))) continue;
    const kickoff = Date.parse(e.kickoffUtc);
    if (Number.isFinite(kickoff) && kickoff < now - AUTO_PRUNE_AFTER_MS) {
      report.push({ espnId: String(e.espnId), kickoffUtc: e.kickoffUtc, home: e.home, away: e.away,
        status: "PRUNED_PAST", channels: e.channels, evidence: [], rejections: [] });
      continue;
    }
    // B1 (revisão adversarial do PR #432): o snapshot diz que o jogo foi adiado/cancelado/suspenso
    // ou mudou de horário. Canal de outra data é informação errada — sai, com ou sem EPG no ar.
    const snap = ctx.snapshotIndex ? ctx.snapshotIndex.get(String(e.espnId)) : undefined;
    if (snap && (INACTIVE_STATUS_NAMES.has(snap.statusName) || utcMinuteOf(snap.kickoffUtc) !== utcMinuteOf(e.kickoffUtc))) {
      const postponed = INACTIVE_STATUS_NAMES.has(snap.statusName);
      report.push({ espnId: String(e.espnId), kickoffUtc: e.kickoffUtc, home: e.home, away: e.away, outOfScope: true,
        status: postponed ? "POSTPONED_DROPPED" : "RESCHEDULED_DROPPED", statusName: snap.statusName,
        rescheduledFrom: postponed ? undefined : e.kickoffUtc, rescheduledTo: postponed ? undefined : snap.kickoffUtc,
        channels: e.channels, evidence: [], rejections: [] });
      continue;
    }
    if (curated.some((c) => c.espnId && String(c.espnId) === String(e.espnId))) continue;
    nextAuto.push(e);
  }

  nextAuto.sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || String(a.espnId).localeCompare(String(b.espnId)));
  const nextEntries = [...curated, ...nextAuto];
  const changed = JSON.stringify(nextEntries) !== JSON.stringify(entries) || existingDoc.sourceModel !== SOURCE_MODEL;
  const doc = {
    schemaVersion: existingDoc.schemaVersion ?? 1,
    sourceModel: SOURCE_MODEL,
    _comment: existingDoc._comment,
    updatedAt: changed ? nowIso : existingDoc.updatedAt,
    entries: nextEntries,
  };
  if (doc.updatedAt === undefined) delete doc.updatedAt;
  if (doc._comment === undefined) delete doc._comment;
  return { doc, changed, report };
}

function canonicalAuto(e) {
  return { espnId: e.espnId, kickoffUtc: e.kickoffUtc, home: e.home, away: e.away, channels: e.channels,
    evidence: (e.evidence || []).map(evidenceKey) };
}

/** JSON com arrays de primitivos numa linha só — o mesmo estilo que a curadoria já usa no arquivo. */
export function serializeDoc(doc) {
  return JSON.stringify(doc, null, 2)
    .replace(/\[\n\s+((?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)(?:,\n\s+(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null))*)\n\s+\]/g,
      (_, body) => "[" + body.split(/,\n\s+/).join(", ") + "]") + "\n";
}

export { isoMinute };
