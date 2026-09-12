#!/usr/bin/env node
/**
 * sync_epg_broadcasts.mjs — atualiza bolao/shared/data/broadcasts.json a partir da grade de TV
 * (EPGShare BR1/BR2), corroborada contra os próximos jogos do BR2026 (Issue #431).
 *
 * Modelo: EPG_CORROBORATED_WITH_CURATED_OVERRIDE — ver o cabeçalho de epg_broadcasts.mjs para as
 * regras de evidência, precedência e last-known-good. Este arquivo só faz I/O em volta delas.
 *
 * Uso:
 *   node bolao/shared/scripts/sync_epg_broadcasts.mjs                 # dry-run: relatório, não grava
 *   node bolao/shared/scripts/sync_epg_broadcasts.mjs --write         # grava se o dado mudou
 *
 * Opções:
 *   --days=N             janela de partidas a partir de agora (padrão 7; a grade cobre ~4 dias)
 *   --epg-dir=DIR        lê BR1/BR2 do disco em vez da rede (BR1.xml[.gz] / epg_ripper_BR1.xml.gz)
 *   --now=ISO            relógio fixo (testes e reprodução de um run)
 *   --file=PATH          broadcasts.json alternativo           --snapshot=PATH  snapshot ESPN alternativo
 *   --summary=PATH       acrescenta o relatório em Markdown (ex.: "$GITHUB_STEP_SUMMARY")
 *   --json-report=PATH   grava o relatório completo em JSON (evidência de validação)
 *
 * Saída:
 *   exit 0 — relatório emitido; arquivo gravado só com --write e só se mudou. EPG totalmente fora do
 *            ar também é exit 0, com o arquivo INTOCADO e um aviso ::warning:: no Actions:
 *            indisponibilidade de terceiro não pode apagar dado nem pintar a main de vermelho.
 *   exit 1 — broadcasts.json atual inválido, resultado da fusão inválido, ou curadoria alterada
 *            pela fusão. Nesses casos NADA é gravado.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  EPG_SOURCES, EPG_ALLOWED_HOSTS, SOURCE_MODEL, PROBE_AFTER_KICKOFF_MS, parseXmltv, corroborateFixtures,
  mergeBroadcasts, serializeDoc, isAutoEntry, resolveChannel,
} from "./epg_broadcasts.mjs";
import { validate } from "./validate_broadcasts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = join(HERE, "..", "data", "broadcasts.json");
const DEFAULT_SNAPSHOT = join(HERE, "..", "..", "br2026", "data", "espn-normalized.json");
const MAX_COMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_XML_BYTES = 300 * 1024 * 1024;
const MIN_PROGRAMMES = 50;
const MIN_CHANNELS = 5;
const FETCH_TIMEOUT_MS = 90 * 1000;
const PAST_GRACE_MS = 3 * 60 * 60 * 1000;

function parseArgs(argv) {
  const out = { write: false, days: 7, epgDir: null, now: null, file: DEFAULT_FILE, snapshot: DEFAULT_SNAPSHOT,
    summary: null, jsonReport: null };
  for (const a of argv) {
    let m;
    if (a === "--write") out.write = true;
    else if ((m = /^--days=(\d+)$/.exec(a))) out.days = Number(m[1]);
    else if ((m = /^--epg-dir=(.+)$/.exec(a))) out.epgDir = m[1];
    else if ((m = /^--now=(.+)$/.exec(a))) out.now = m[1];
    else if ((m = /^--file=(.+)$/.exec(a))) out.file = m[1];
    else if ((m = /^--snapshot=(.+)$/.exec(a))) out.snapshot = m[1];
    else if ((m = /^--summary=(.+)$/.exec(a))) out.summary = m[1];
    else if ((m = /^--json-report=(.+)$/.exec(a))) out.jsonReport = m[1];
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  return out;
}

function decodeGuide(buf) {
  const gz = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const xml = (gz ? gunzipSync(buf, { maxOutputLength: MAX_XML_BYTES }) : buf).toString("utf8");
  if (!/<tv[\s>]/.test(xml.slice(0, 4096))) throw new Error("resposta não é XMLTV (<tv> ausente)");
  return xml;
}

async function fetchGuide(source) {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || !EPG_ALLOWED_HOSTS.includes(url.hostname)) {
    throw new Error(`host fora da allowlist: ${url.hostname}`);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_COMPRESSED_BYTES) throw new Error(`resposta grande demais (${buf.length} bytes)`);
  return decodeGuide(buf);
}

function readGuideFromDir(dir, source) {
  const n = source.id.replace(/^epgshare-br/, "");
  const candidates = [`epg_ripper_BR${n}.xml.gz`, `BR${n}.xml.gz`, `epg_ripper_BR${n}.xml`, `BR${n}.xml`];
  const present = existsSync(dir) ? new Set(readdirSync(dir)) : new Set();
  const hit = candidates.find((c) => present.has(c));
  if (!hit) throw new Error(`arquivo ausente em ${dir}`);
  return decodeGuide(readFileSync(join(dir, hit)));
}

async function loadGuides(opts) {
  const guides = [];
  for (const source of EPG_SOURCES) {
    try {
      const xml = opts.epgDir ? readGuideFromDir(opts.epgDir, source) : await fetchGuide(source);
      const parsed = parseXmltv(xml, source.id);
      if (parsed.programmes.length < MIN_PROGRAMMES || parsed.channelCount < MIN_CHANNELS) {
        throw new Error(`grade suspeita: ${parsed.channelCount} canais, ${parsed.programmes.length} programas`);
      }
      const horizon = Math.max(...parsed.programmes.map((p) => p.stop));
      guides.push({ id: source.id, ok: true, programmes: parsed.programmes, channelCount: parsed.channelCount,
        channelIds: parsed.channelIds, horizon });
    } catch (ex) {
      guides.push({ id: source.id, ok: false, error: String(ex && ex.message || ex), programmes: [] });
    }
  }
  return guides;
}

export function fixturesInScope(snapshot, now, days) {
  const from = now.getTime() - PAST_GRACE_MS;
  const to = now.getTime() + days * 86400000;
  const out = [];
  for (const m of Array.isArray(snapshot.matches) ? snapshot.matches : []) {
    if (m.completed || m.state === "post") continue;
    const kickoffMs = Date.parse(m.date || "");
    if (!Number.isFinite(kickoffMs) || kickoffMs < from || kickoffMs > to) continue;
    if (!m.id || !m.homeTeam || !m.awayTeam) continue;
    out.push({ id: String(m.id), kickoffMs, kickoffUtc: m.date, home: m.homeTeam, away: m.awayTeam });
  }
  return out.sort((a, b) => a.kickoffMs - b.kickoffMs);
}

const REASON_TEXT = {
  ONE_TEAM_ONLY: "programa cita só um dos clubes",
  OUT_OF_KICKOFF_WINDOW: "programa fora da janela do kickoff",
  REJECTED_MARKER: "replay/pré-jogo/feminino/base",
  VETOED_BY_MARKER_IN_OTHER_SOURCE: "outra fonte marca o mesmo horário como replay/feminino/base",
  CHANNEL_NOT_ALLOWLISTED: "canal fora da allowlist",
  MORE_THAN_TWO_CLUBS: "programa cita mais de dois clubes (ambíguo)",
  SOURCE_DISAGREEMENT: "fontes divergem sobre o que passa neste canal",
  PROGRAMME_MATCHES_MULTIPLE_FIXTURES: "programa casa com mais de uma partida (ambíguo)",
  AMBIGUOUS_FIXTURE_IDENTITY: "identidade da partida ambígua",
};

function hhmm(iso) { return iso ? iso.slice(11, 16) + "Z" : "?"; }

function describeRejection(r) {
  const what = REASON_TEXT[r.reason] || r.reason;
  if (r.title !== undefined) {
    const t = [r.title, r.subTitle].filter(Boolean).join(" / ");
    const dissent = r.dissentTitle ? ` × "${r.dissentTitle}" [${r.source} ${r.epgChannelId}]` : "";
    return `${r.reason} (${what}${r.marker ? `: "${r.marker}"` : ""}): "${t}" em ${r.label || r.epgChannelId}` +
      (r.dissentTitle ? dissent : ` [${r.source}]`) + ` ${hhmm(r.start)}`;
  }
  return `${r.reason} (${what})`;
}

/** Canais da allowlist declarados pelas fontes que responderam, mas sem programa no ar no jogo. */
function silentMonitoredChannels(kickoffMs, okGuides) {
  const probe = kickoffMs + PROBE_AFTER_KICKOFF_MS;
  const declared = new Map();
  const airing = new Set();
  for (const g of okGuides) {
    for (const id of g.channelIds || []) {
      const c = resolveChannel(id);
      if (c) declared.set(c.label, c.order);
    }
    for (const p of g.programmes) {
      if (p.start > probe || p.stop <= probe) continue;
      const c = resolveChannel(p.channelId);
      if (c) airing.add(c.label);
    }
  }
  return [...declared.entries()].filter(([l]) => !airing.has(l)).sort((a, b) => a[1] - b[1]).map(([l]) => l);
}

export function missingReason(row, guides) {
  const okGuides = guides.filter((g) => g.ok);
  if (!okGuides.length) return "EPG_UNAVAILABLE — nenhuma fonte respondeu";
  const horizon = Math.max(...okGuides.map((g) => g.horizon));
  const kickoff = Date.parse(row.kickoffUtc);
  if (Number.isFinite(kickoff) && kickoff + 45 * 60 * 1000 > horizon) {
    return `BEYOND_EPG_HORIZON — a grade atual vai até ${new Date(horizon).toISOString().slice(0, 16)}Z`;
  }
  const silent = silentMonitoredChannels(kickoff, okGuides);
  const silentNote = silent.length ? ` · sem grade no horário: ${silent.join(", ")}` : "";
  if (row.rejections && row.rejections.length) {
    const lines = [...new Set(row.rejections.map(describeRejection))];
    return lines.slice(0, 4).join("; ") + (lines.length > 4 ? `; (+${lines.length - 4})` : "") + silentNote;
  }
  return "NO_PROGRAMME_NAMING_BOTH_CLUBS — nenhum programa das emissoras monitoradas cita os dois clubes perto do kickoff" + silentNote;
}

function renderReport({ now, guides, report, changed, wrote, dryRun, curatedCount }) {
  const text = [];
  const md = [];
  text.push("=".repeat(78));
  text.push(`  BR2026 — "Onde assistir" via EPG (${SOURCE_MODEL}) — ${now.toISOString()}`);
  text.push("=".repeat(78));
  md.push(`## BR2026 — "Onde assistir" via EPG`, "", `Modelo: \`${SOURCE_MODEL}\` · run: ${now.toISOString()}`, "");
  md.push("| fonte | estado | canais | programas | grade até |", "|---|---|---|---|---|");
  for (const g of guides) {
    const line = g.ok
      ? `OK — ${g.channelCount} canais, ${g.programmes.length} programas, até ${new Date(g.horizon).toISOString().slice(0, 16)}Z`
      : `FALHOU — ${g.error}`;
    text.push(`  fonte ${g.id}: ${line}`);
    md.push(g.ok
      ? `| ${g.id} | OK | ${g.channelCount} | ${g.programmes.length} | ${new Date(g.horizon).toISOString().slice(0, 16)}Z |`
      : `| ${g.id} | **FALHOU** | — | — | ${g.error.replace(/\|/g, "/")} |`);
  }
  text.push("-".repeat(78));
  md.push("", "| kickoff (UTC) | espnId | partida | status | canais | evidência / motivo |", "|---|---|---|---|---|---|");
  for (const r of report) {
    const match = `${r.home} × ${r.away}`;
    const channels = (r.channels || []).join(" · ");
    let detail;
    if (r.status === "MISSING") detail = missingReason(r, guides);
    else if (r.status === "CURATED_OVERRIDE") {
      detail = "registro humano vence" + (r.epgAlsoSaw && r.epgAlsoSaw.length ? ` (EPG também viu: ${r.epgAlsoSaw.join(" · ")})` : "");
    } else if (r.status === "REMOVED_CONTRADICTED") detail = `grade contradiz: ${(r.dropped || []).join(" · ")}`;
    else if (r.status === "PRUNED_PAST") detail = "jogo passado há mais de 7 dias";
    else {
      detail = (r.evidence || []).map((e) =>
        `"${[e.programmeTitle, e.programmeSubTitle].filter(Boolean).join(" / ")}" ${e.channel} [${e.source} ${e.epgChannelId}] ${hhmm(e.programmeStart)}–${hhmm(e.programmeStop)}`).join("; ");
      if (r.kept && r.kept.length) detail += ` · mantido (last-known-good): ${r.kept.join(" · ")}`;
      if (r.dropped && r.dropped.length) detail += ` · removido (grade contradiz): ${r.dropped.join(" · ")}`;
    }
    const mark = r.status === "MISSING" || r.status === "REMOVED_CONTRADICTED" ? "✗" : "✓";
    text.push(`  ${mark} ${r.kickoffUtc}  ${String(r.espnId).padEnd(10)} ${match}  — ${r.status}${channels ? ` → ${channels}` : ""}`);
    text.push(`      ${detail}`);
    md.push(`| ${r.kickoffUtc} | ${r.espnId} | ${match} | ${r.status} | ${channels || "—"} | ${detail.replace(/\|/g, "/")} |`);
  }
  const count = (s) => report.filter((r) => r.status === s).length;
  const covered = report.filter((r) => ["ADDED", "UPDATED", "UNCHANGED", "KEPT_LAST_KNOWN_GOOD", "CURATED_OVERRIDE"].includes(r.status)).length;
  const inWindow = report.filter((r) => r.status !== "PRUNED_PAST").length;
  const tail = `partidas: ${inWindow} · cobertas: ${covered} (curadoria ${count("CURATED_OVERRIDE")}, EPG ${covered - count("CURATED_OVERRIDE")}) · sem cobertura: ${count("MISSING") + count("REMOVED_CONTRADICTED")} · registros curados no arquivo: ${curatedCount}`;
  const writeLine = dryRun ? `dry-run — arquivo NÃO gravado (mudaria: ${changed ? "sim" : "não"})`
    : wrote ? "broadcasts.json GRAVADO" : "broadcasts.json inalterado";
  text.push("-".repeat(78), `  ${tail}`, `  ${writeLine}`, "=".repeat(78));
  md.push("", `**${tail}**`, "", writeLine, "");
  return { text: text.join("\n"), md: md.join("\n") };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const now = opts.now ? new Date(opts.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error(`--now inválido: ${opts.now}`);

  const originalText = readFileSync(opts.file, "utf8");
  const existing = JSON.parse(originalText);
  const pre = validate(existing);
  if (!pre.ok) {
    console.error(`🛑 ${opts.file} atual é inválido — nada será gravado:\n  ${pre.errors.join("\n  ")}`);
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(opts.snapshot, "utf8"));
  const fixtures = fixturesInScope(snapshot, now, opts.days);
  const guides = await loadGuides(opts);
  const okSources = new Set(guides.filter((g) => g.ok).map((g) => g.id));
  const programmes = guides.flatMap((g) => g.programmes);
  const curatedCount = (existing.entries || []).filter((e) => !isAutoEntry(e)).length;

  let doc = existing, changed = false, report;
  if (!okSources.size) {
    // Nenhuma fonte: não há o que fundir. O arquivo fica exatamente como está (last-known-good).
    report = fixtures.map((f) => ({ espnId: f.id, kickoffUtc: f.kickoffUtc, home: f.home, away: f.away,
      status: "MISSING", channels: [], evidence: [], rejections: [] }));
    const note = "EPG indisponível (todas as fontes falharam) — broadcasts.json preservado sem alteração";
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${note}` : `⚠ ${note}`);
  } else {
    const results = corroborateFixtures(fixtures, programmes);
    ({ doc, changed, report } = mergeBroadcasts(existing, fixtures, results, { now, okSources, programmes }));

    const beforeCurated = JSON.stringify((existing.entries || []).filter((e) => !isAutoEntry(e)));
    const afterCurated = JSON.stringify(doc.entries.filter((e) => !isAutoEntry(e)));
    if (beforeCurated !== afterCurated) {
      console.error("🛑 a fusão alterou registros curados — recusado, nada será gravado");
      process.exit(1);
    }
    const post = validate(doc);
    if (!post.ok) {
      console.error(`🛑 resultado da fusão é inválido — nada será gravado:\n  ${post.errors.join("\n  ")}`);
      process.exit(1);
    }
  }

  let wrote = false;
  if (opts.write && changed) {
    const tmp = `${opts.file}.tmp-${process.pid}`;
    writeFileSync(tmp, serializeDoc(doc));
    renameSync(tmp, opts.file);
    wrote = true;
  }

  const rendered = renderReport({ now, guides, report, changed, wrote, dryRun: !opts.write, curatedCount });
  console.log(rendered.text);
  if (opts.summary) appendFileSync(opts.summary, rendered.md + "\n");
  if (opts.jsonReport) {
    writeFileSync(opts.jsonReport, JSON.stringify({
      now: now.toISOString(), sourceModel: SOURCE_MODEL, changed, wrote,
      sources: guides.map((g) => ({ id: g.id, ok: g.ok, error: g.error || null, channels: g.channelCount || 0,
        programmes: g.programmes.length, horizon: g.ok ? new Date(g.horizon).toISOString() : null })),
      matches: report.map((r) => ({ ...r, missingReason: r.status === "MISSING" ? missingReason(r, guides) : undefined })),
    }, null, 2) + "\n");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((ex) => {
    console.error(`🛑 sync_epg_broadcasts falhou: ${ex && ex.stack || ex}`);
    process.exit(1);
  });
}
