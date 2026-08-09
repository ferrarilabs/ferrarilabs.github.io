#!/usr/bin/env node
/**
 * O CRON DO SNAPSHOT COBRE TODOS OS JOGOS DE VERDADE?
 *
 * POR QUE ESTA SUÍTE EXISTE: em 2026-08-09 o Eduardo relatou, pela SEGUNDA vez, que o hero de jogo
 * ao vivo do BR2026 tinha sumido — desta vez com "isso precisa PARAR DE ACONTECER". Estava certo:
 * mesmo sintoma, causa diferente.
 *
 *   1ª vez (2026-08-08): o workflow rodava e terminava verde, mas escrevia num runner efêmero,
 *      sem `contents: write` e sem passo de commit. O snapshot nunca mudava.
 *   2ª vez (2026-08-09): o workflow commitava certo, mas o cron era `*​/10 16-23` e `*​/10 0-5`
 *      (UTC) — **nada entre 06:00 e 16:00 UTC**. Cruzeiro×Mirassol começou às 14:00 UTC, dentro
 *      do ponto cego. O snapshot ficou 468 minutos velho, continuou dizendo `state: "pre"` com o
 *      jogo rolando, e o hero não tinha dado ao vivo para exibir.
 *
 * As janelas vieram dos crons de EMAIL, desenhados para rodada noturna. Ninguém checou se a tabela
 * do Brasileirão tinha jogo de manhã — e domingo tem.
 *
 * A lição que esta suíte transforma em gate: **a cobertura do cron é uma afirmação sobre a tabela
 * de jogos, e afirmação sobre dado tem que ser verificada contra o dado.** Um humano relendo
 * "*​/10 16-23" não consegue ver que falta jogo nenhum; só a comparação com os horários reais
 * revela o buraco. Por isso aqui a fonte é o snapshot normalizado — os jogos de verdade —, não
 * uma lista de horários que alguém digitou.
 *
 * Uso: node bolao/scripts/audit_snapshot_window_coverage.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "bolao_provider_snapshot.yml");
const APPS = ["br2026", "cdb2026"]; // copa2026 está arquivada e fora do schedule, de propósito.

// Uma partida de futebol dura ~2h com intervalo e acréscimos; o pós-jogo ainda muda o snapshot
// (resultado final, cartões tardios). 3h a partir do apito inicial é folgado e honesto.
const MATCH_WINDOW_HOURS = 3;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Horas UTC (0-23) em que o cron do workflow dispara pelo menos uma vez. */
function cronCoveredHours(yaml) {
  const hours = new Set();
  for (const m of yaml.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)) {
    const field = m[1].trim().split(/\s+/)[1]; // campo de HORA
    if (field === "*") { for (let h = 0; h < 24; h++) hours.add(h); continue; }
    for (const part of field.split(",")) {
      const step = part.includes("/") ? parseInt(part.split("/")[1], 10) : 1;
      const range = part.split("/")[0];
      if (range === "*") { for (let h = 0; h < 24; h += step) hours.add(h); continue; }
      const [a, b] = range.split("-").map(Number);
      for (let h = a; h <= (b === undefined ? a : b); h += step) hours.add(h);
    }
  }
  return hours;
}

console.log("\nCobertura do cron do snapshot × jogos reais da tabela\n");

const yaml = readFileSync(WORKFLOW, "utf8");
const covered = cronCoveredHours(yaml);

test("o workflow declara pelo menos um cron", () => {
  assert(covered.size > 0, "nenhum `schedule.cron` encontrado — o snapshot voltaria a congelar");
});

for (const app of APPS) {
  const file = join(ROOT, "bolao", app, "data", "espn-normalized.json");
  if (!existsSync(file)) { console.log(`  (${app}: sem snapshot — nada a verificar)`); continue; }
  const snap = JSON.parse(readFileSync(file, "utf8"));
  const matches = snap.matches || [];

  test(`[${app}] o snapshot tem jogos para conferir`, () => {
    assert(matches.length > 0,
      "snapshot sem jogo nenhum — sem tabela, esta verificação não afirma nada");
  });

  test(`[${app}] TODA hora em que existe jogo ao vivo é coberta pelo cron`, () => {
    const buracos = new Map(); // hora UTC -> exemplo de jogo
    for (const m of matches) {
      if (!m.date) continue;
      const kickoff = new Date(m.date);
      if (isNaN(kickoff)) continue;
      for (let i = 0; i < MATCH_WINDOW_HOURS; i++) {
        const h = (kickoff.getUTCHours() + i) % 24;
        if (!covered.has(h) && !buracos.has(h)) {
          buracos.set(h, `${m.homeTeam} × ${m.awayTeam} (${m.date})`);
        }
      }
    }
    assert(buracos.size === 0,
      "existe jogo acontecendo em hora que o cron NÃO cobre — é exatamente assim que o hero ao " +
      "vivo some:\n      " +
      [...buracos.entries()].sort((a, b) => a[0] - b[0])
        .map(([h, ex]) => `${String(h).padStart(2, "0")}:00 UTC — ex.: ${ex}`).join("\n      "));
  });

  test(`[${app}] o intervalo entre execuções é fino o bastante para um jogo ao vivo`, () => {
    const steps = [...yaml.matchAll(/^\s*-\s*cron:\s*["'](\S+)\s/gm)].map(m => m[1]);
    for (const minField of steps) {
      const step = minField.includes("/") ? parseInt(minField.split("/")[1], 10) : 60;
      assert(step <= 15,
        `cron a cada ${step} min: um gol pode levar ${step} minutos para aparecer na tela`);
    }
  });
}

test("o passo de commit continua existindo (a falha de 2026-08-08)", () => {
  assert(/contents:\s*write/.test(yaml),
    "sem `contents: write` o job escreve num runner efêmero e termina VERDE sem efeito nenhum");
  assert(/git commit/.test(yaml),
    "sem passo de commit o snapshot atualizado morre com o runner");
});

console.log(`\n  ${pass} passed, ${fail} failed   (horas UTC cobertas: ${[...covered].sort((a, b) => a - b).join(",")})`);
if (fail) { console.log("\n✗ SNAPSHOT WINDOW COVERAGE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
