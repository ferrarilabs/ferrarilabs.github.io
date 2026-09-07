#!/usr/bin/env node
/**
 * check_broadcast_coverage.mjs — detector OPERACIONAL de lacunas de "Onde assistir" (Issue #425).
 *
 * Isto NÃO é um gate que reprova o build. Ausência de transmissão confirmada é um estado NORMAL
 * (a maioria dos jogos futuros ainda não tem confirmação de emissora) — falhar `npm run check`
 * por isso seria o tipo de "automação de fachada" que o Eduardo pediu para evitar. O que este
 * script automatiza é a DESCOBERTA da lacuna, não o dado em si: ninguém precisa lembrar de
 * abrir `broadcasts.json` e comparar à mão contra o calendário.
 *
 * O que faz: lê o snapshot real da ESPN (`bolao/br2026/data/espn-normalized.json`, o mesmo que o
 * navegador consome) e a curadoria (`bolao/shared/data/broadcasts.json`), lista as partidas do
 * BR2026 dentro da janela (padrão 21 dias, `--days=N`) que ainda não têm cobertura, e imprime uma
 * tabela ordenada por kickoff — pensada para log de CI: sem cor, sem tabela ANSI, uma linha por
 * partida, fácil de grep.
 *
 * A lógica de associação (id primeiro, minuto+times como fallback) espelha DELIBERADAMENTE
 * `findBroadcast()` em bolao/shared/js/where_to_watch.js — mesma identidade de partida nos dois
 * lados, para que "coberto no navegador" e "coberto no detector" nunca divirjam.
 *
 * Uso: node bolao/shared/scripts/check_broadcast_coverage.mjs [--days=21]
 * Exit code: sempre 0 (relatório, não gate) — a menos que os arquivos de entrada não existam/não
 * parseiem, o que É um erro de infraestrutura do próprio script.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BROADCASTS_FILE = join(HERE, "..", "data", "broadcasts.json");
const BR2026_SNAPSHOT = join(HERE, "..", "..", "br2026", "data", "espn-normalized.json");
const DEFAULT_WINDOW_DAYS = 21;

function norm(s) {
  const out = String(s == null ? "" : s).normalize("NFD");
  let stripped = "";
  for (let i = 0; i < out.length; i++) {
    const code = out.charCodeAt(i);
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

/** Mesma semântica de findBroadcast() em where_to_watch.js — id primeiro, minuto+times fallback. */
export function findBroadcast(match, broadcasts) {
  const id = match.id != null ? String(match.id) : "";
  const minute = utcMinute(match.kickoff);
  for (const b of broadcasts) {
    if (id && b.espnId === id) return b;
    if (!id && minute && utcMinute(b.kickoffUtc) === minute &&
        norm(b.home) === norm(match.home) && norm(b.away) === norm(match.away)) return b;
  }
  return null;
}

export function upcomingWithoutCoverage(fixtures, broadcasts, { now = new Date(), windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const windowEndMs = now.getTime() + windowDays * 86400000;
  const rows = [];
  for (const m of fixtures) {
    if (m.completed) continue;
    const kickoffMs = Date.parse(m.date || "");
    if (!Number.isFinite(kickoffMs)) continue;
    if (kickoffMs < now.getTime() || kickoffMs > windowEndMs) continue;
    const match = { id: m.id, kickoff: m.date, home: m.homeTeam, away: m.awayTeam };
    const covered = findBroadcast(match, broadcasts);
    rows.push({
      espnId: m.id,
      kickoff: m.date,
      home: m.homeTeam,
      away: m.awayTeam,
      status: covered ? `OK (${covered.channels.join(" · ")})` : "MISSING",
      covered: !!covered,
    });
  }
  rows.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  return rows;
}

function parseArgs(argv) {
  const out = { days: DEFAULT_WINDOW_DAYS };
  for (const a of argv) {
    const m = /^--days=(\d+)$/.exec(a);
    if (m) out.days = parseInt(m[1], 10);
  }
  return out;
}

function main() {
  const { days } = parseArgs(process.argv.slice(2));

  let broadcastsDoc, snapshotDoc;
  try {
    broadcastsDoc = JSON.parse(readFileSync(BROADCASTS_FILE, "utf8"));
  } catch (ex) {
    console.error(`🛑 não consegui ler ${BROADCASTS_FILE}: ${ex.message}`);
    process.exit(1);
  }
  try {
    snapshotDoc = JSON.parse(readFileSync(BR2026_SNAPSHOT, "utf8"));
  } catch (ex) {
    console.error(`🛑 não consegui ler ${BR2026_SNAPSHOT}: ${ex.message}`);
    process.exit(1);
  }

  const broadcasts = Array.isArray(broadcastsDoc.entries) ? broadcastsDoc.entries : [];
  const fixtures = Array.isArray(snapshotDoc.matches) ? snapshotDoc.matches : [];
  const rows = upcomingWithoutCoverage(fixtures, broadcasts, { windowDays: days });

  console.log("=".repeat(78));
  console.log(`  BR2026 — cobertura de "Onde assistir" — próximos ${days} dia(s)`);
  console.log("=".repeat(78));
  if (!rows.length) {
    console.log("  Nenhuma partida do BR2026 na janela — nada a relatar.");
  } else {
    for (const r of rows) {
      const marker = r.covered ? "✓" : "✗";
      console.log(`  ${marker} ${r.kickoff}  ${r.espnId.padEnd(10)} ${r.home} × ${r.away}  — ${r.status}`);
    }
  }
  const missing = rows.filter((r) => !r.covered);
  console.log("-".repeat(78));
  console.log(`  total na janela: ${rows.length}   cobertas: ${rows.length - missing.length}   SEM COBERTURA: ${missing.length}`);
  if (missing.length) {
    console.log(`  Ação: confirmar transmissão (fonte específica da partida) e adicionar em`);
    console.log(`  bolao/shared/data/broadcasts.json — ver docs/bolao/BROADCAST_OPERATIONS.md.`);
  }
  console.log("=".repeat(78));
  process.exit(0); // relatório, não gate — ver comentário de topo
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
