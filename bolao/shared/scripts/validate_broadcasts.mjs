#!/usr/bin/env node
/**
 * validate_broadcasts.mjs — valida bolao/shared/data/broadcasts.json (Issue #425, #431).
 *
 * Desde a #431 o modelo é BROADCAST_SOURCE_MODEL = EPG_CORROBORATED_WITH_CURATED_OVERRIDE (antes
 * CURATED_ONLY): o arquivo mistura registros HUMANOS (sem `origin`, ou `origin: "curated"`) e
 * registros gerados pela grade de TV (`origin: "epg"`, ver epg_broadcasts.mjs). Registro automático
 * é revalidado aqui contra a própria evidência — não basta o pipeline dizer que corroborou:
 *
 *   - `espnId` obrigatório, `evidence[]` não vazio, fonte de EPG conhecida, título do programa,
 *     horários legíveis e `collectedAt`;
 *   - todo canal é um rótulo que o pipeline sabe publicar (streaming sem grade, como Prime Video,
 *     nunca pode vir de `origin: "epg"`) e tem pelo menos uma evidência própria;
 *   - toda evidência cita os dois clubes e está na janela do kickoff.
 *
 * O que vale para os dois tipos: o ARQUIVO em si não pode entrar corrompido, ambíguo ou
 * conflitante em produção:
 *
 *   - identidade específica de partida (espnId, ou kickoffUtc+home+away completos);
 *   - `channels` não vazio e `source` preenchido — sem isso o registro não serve de evidência;
 *   - `confirmedAt` é uma data válida;
 *   - sem duas entradas para a MESMA partida (mesmo espnId, ou mesmo minuto+times) — duplicata
 *     ou conflito;
 *   - sem reaproveitamento acidental do canal de OUTRA partida ou do OUTRO turno do mesmo
 *     confronto (times diferentes ou minuto diferente contam como partidas diferentes, mesmo
 *     que o mesmo confronto apareça duas vezes na temporada);
 *   - alerta (não reprova) quando `confirmedAt` é muito anterior ao `kickoffUtc` — transmissão
 *     brasileira muda de última hora; um registro confirmado 3 semanas antes merece reconferência
 *     mais perto do jogo.
 *
 * Uso: node bolao/shared/scripts/validate_broadcasts.mjs [--file=<path>]
 * Exit 0 = válido (podem existir avisos). Exit 1 = pelo menos um erro — não usar o arquivo assim.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EPG_SOURCES, isAutoChannelLabel, inKickoffWindow, resolveTeamKey } from "./epg_broadcasts.mjs";

const EPG_SOURCE_IDS = new Set(EPG_SOURCES.map((s) => s.id));

/** Regras extras de um registro `origin: "epg"`. Acrescenta em `errors`; nunca afrouxa as comuns. */
function validateAutoEntry(e, tag, errors) {
  if (!(typeof e.espnId === "string" && e.espnId.trim())) {
    errors.push(`${tag}: registro automático (origin=epg) exige 'espnId'`);
  }
  if (!Number.isFinite(Date.parse(e.collectedAt))) {
    errors.push(`${tag}: registro automático exige 'collectedAt' legível`);
  }
  const kickoffMs = Date.parse(e.kickoffUtc);
  if (!Number.isFinite(kickoffMs)) {
    errors.push(`${tag}: registro automático exige 'kickoffUtc' legível`);
  }
  if (!Array.isArray(e.evidence) || e.evidence.length === 0) {
    errors.push(`${tag}: registro automático sem 'evidence' — sem proveniência não publica`);
    return;
  }
  const channels = Array.isArray(e.channels) ? e.channels : [];
  for (const label of channels) {
    if (!isAutoChannelLabel(label)) {
      errors.push(`${tag}: canal "${label}" não pode vir do EPG (fora da allowlist — streaming sem grade só por curadoria)`);
    }
    if (!e.evidence.some((ev) => ev && ev.channel === label)) {
      errors.push(`${tag}: canal "${label}" sem evidência própria`);
    }
  }
  e.evidence.forEach((ev, j) => {
    const etag = `${tag}.evidence[${j}]`;
    if (!ev || typeof ev !== "object") { errors.push(`${etag}: não é objeto`); return; }
    if (!channels.includes(ev.channel)) errors.push(`${etag}: canal "${ev.channel}" não está em 'channels'`);
    if (!EPG_SOURCE_IDS.has(ev.source)) errors.push(`${etag}: fonte desconhecida "${ev.source}"`);
    if (typeof ev.epgChannelId !== "string" || !ev.epgChannelId) errors.push(`${etag}: 'epgChannelId' ausente`);
    if (typeof ev.programmeTitle !== "string" || !ev.programmeTitle.trim()) errors.push(`${etag}: 'programmeTitle' ausente`);
    if (!Array.isArray(ev.matchedTeams) || ev.matchedTeams.length !== 2 || ev.matchedTeams[0] === ev.matchedTeams[1]) {
      errors.push(`${etag}: 'matchedTeams' precisa nomear os DOIS clubes`);
    }
    if (!Number.isFinite(Date.parse(ev.collectedAt))) errors.push(`${etag}: 'collectedAt' ilegível`);
    const start = Date.parse(ev.programmeStart), stop = Date.parse(ev.programmeStop);
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) {
      errors.push(`${etag}: horário do programa ilegível`);
    } else if (Number.isFinite(kickoffMs) && !inKickoffWindow({ start, stop }, kickoffMs)) {
      errors.push(`${etag}: programa ${ev.programmeStart}–${ev.programmeStop} fora da janela do kickoff ${e.kickoffUtc}`);
    }
  });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = join(HERE, "..", "data", "broadcasts.json");
const STALE_CONFIRMATION_DAYS = 10;

function norm(s) {
    var out = String(s == null ? "" : s).normalize("NFD");
    var stripped = "";
    for (var i = 0; i < out.length; i++) {
      var code = out.charCodeAt(i);
      if (code >= 0x0300 && code <= 0x036f) continue; // marca diacritica combinante (NFD)
      stripped += out[i];
    }
    return stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

function utcMinute(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toISOString().slice(0, 16);
}

function parseArgs(argv) {
  const out = { file: DEFAULT_FILE };
  for (const a of argv) {
    const m = /^--file=(.+)$/.exec(a);
    if (m) out.file = m[1];
  }
  return out;
}

export function validate(doc) {
  const errors = [];
  const warnings = [];

  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["documento raiz não é um objeto"], warnings: [] };
  }
  const entries = doc.entries;
  if (!Array.isArray(entries)) {
    return { ok: false, errors: ["'entries' precisa ser um array"], warnings: [] };
  }

  const byEspnId = new Map();
  const byMinuteTeams = new Map(); // "<minute>|<normHome>|<normAway>" -> índice
  const now = Date.now();

  entries.forEach((e, i) => {
    const tag = `entries[${i}]` + (e && e.espnId ? ` (espnId=${e.espnId})` : "");

    if (!e || typeof e !== "object") {
      errors.push(`${tag}: entrada não é um objeto`);
      return;
    }

    const hasId = typeof e.espnId === "string" && e.espnId.trim() !== "";
    const hasFallbackIdentity =
      typeof e.kickoffUtc === "string" && e.kickoffUtc.trim() !== "" &&
      typeof e.home === "string" && e.home.trim() !== "" &&
      typeof e.away === "string" && e.away.trim() !== "";
    if (!hasId && !hasFallbackIdentity) {
      errors.push(`${tag}: identidade insuficiente — precisa de 'espnId' OU de ` +
        "'kickoffUtc'+'home'+'away' completos");
    }

    if (!Array.isArray(e.channels) || e.channels.length === 0 ||
        e.channels.some((c) => typeof c !== "string" || !c.trim())) {
      errors.push(`${tag}: 'channels' precisa ser uma lista não vazia de strings não vazias`);
    }

    if (typeof e.source !== "string" || !e.source.trim()) {
      errors.push(`${tag}: 'source' é obrigatório — sem evidência registrada não é curadoria`);
    }

    if (e.origin !== undefined && e.origin !== "curated" && e.origin !== "epg") {
      errors.push(`${tag}: 'origin' desconhecido "${e.origin}" — use "curated" (ou omita) ou "epg"`);
    }
    if (e.origin === "epg") validateAutoEntry(e, tag, errors);

    let confirmedMs = NaN;
    if (typeof e.confirmedAt !== "string" || !Number.isFinite(confirmedMs = Date.parse(e.confirmedAt))) {
      errors.push(`${tag}: 'confirmedAt' precisa ser uma data válida (YYYY-MM-DD)`);
    }

    // Duplicata/conflito por espnId.
    if (hasId) {
      if (byEspnId.has(e.espnId)) {
        errors.push(`${tag}: espnId duplicado — já usado por entries[${byEspnId.get(e.espnId)}]`);
      } else {
        byEspnId.set(e.espnId, i);
      }
    }

    // Duplicata/conflito por (minuto, times) — pega tanto duas entradas sem id quanto uma
    // entrada com id e outra sem id apontando pra MESMA partida (reaproveitamento cruzado).
    if (typeof e.kickoffUtc === "string" && typeof e.home === "string" && typeof e.away === "string") {
      const minute = utcMinute(e.kickoffUtc);
      if (minute) {
        const key = `${minute}|${norm(e.home)}|${norm(e.away)}`;
        if (byMinuteTeams.has(key)) {
          errors.push(`${tag}: mesma partida (minuto+times) já registrada em ` +
            `entries[${byMinuteTeams.get(key)}] — duplicata ou canal reaproveitado`);
        } else {
          byMinuteTeams.set(key, i);
        }
      }
    }

    // Staleness — aviso, não erro. Só quando as duas datas são legíveis.
    if (Number.isFinite(confirmedMs) && typeof e.kickoffUtc === "string") {
      const kickoffMs = Date.parse(e.kickoffUtc);
      if (Number.isFinite(kickoffMs)) {
        const daysBefore = (kickoffMs - confirmedMs) / 86400000;
        if (daysBefore > STALE_CONFIRMATION_DAYS) {
          warnings.push(`${tag}: confirmado ${Math.round(daysBefore)} dias antes do jogo — ` +
            "reconfirmar mais perto da data (transmissão BR pode mudar de última hora)");
        }
      }
    }
  });

  // Curadoria SEM espnId e registro automático da MESMA partida (minuto + clubes por alias). O
  // BR2026 sempre casa por id: a curadoria ficaria invisível e o automático apareceria no lugar
  // dela. A comparação exata por nome acima não pega "Vasco" × "Vasco da Gama" (revisão adversarial
  // do PR #432, S4). Reprova — e como o workflow valida depois do rebase, a corrida também para aqui.
  entries.forEach((c, i) => {
    if (!c || typeof c !== "object" || c.origin === "epg") return;
    if (typeof c.espnId === "string" && c.espnId.trim()) return;
    const minute = utcMinute(c.kickoffUtc);
    if (!minute) return;
    entries.forEach((a, j) => {
      if (!a || typeof a !== "object" || a.origin !== "epg" || utcMinute(a.kickoffUtc) !== minute) return;
      if (resolveTeamKey(c.home) === resolveTeamKey(a.home) && resolveTeamKey(c.away) === resolveTeamKey(a.away)) {
        errors.push(`entries[${i}]: curadoria sem 'espnId' é a mesma partida do registro automático ` +
          `entries[${j}] (espnId=${a.espnId}) — acrescente o espnId à curadoria para ela vencer no navegador`);
      }
    });
  });

  return { ok: errors.length === 0, errors, warnings };
}

function main() {
  const { file } = parseArgs(process.argv.slice(2));
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (ex) {
    console.error(`🛑 não consegui ler/parsear ${file}: ${ex.message}`);
    process.exit(1);
  }

  const { ok, errors, warnings } = validate(doc);

  console.log(`Validando ${file} — ${(doc.entries || []).length} registro(s)`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  🛑 ${e}`);

  if (ok) {
    console.log(`✓ broadcasts.json válido${warnings.length ? ` (${warnings.length} aviso(s))` : ""}.`);
    process.exit(0);
  } else {
    console.log(`🛑 ${errors.length} erro(s) — corrigir antes de publicar.`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
