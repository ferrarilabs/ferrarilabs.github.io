#!/usr/bin/env node
/**
 * FRESCOR DO DADO AO VIVO — todo fetch de snapshot que roda em POLL precisa revalidar.
 *
 * O DEFEITO QUE ISTO IMPEDE (relatado pelo Eduardo em 2026-08-08, com jogo acontecendo):
 * "o hero ao vivo tá com o relógio parado e o placar não atualiza automaticamente e nem os lances
 * do jogo aparecem (gol cartão substituição), isso tudo existia e funcionava".
 *
 * TRÊS sintomas, UMA causa. Depois da migração da ESPN o navegador parou de chamar a ESPN (que
 * mandava `cache-control: max-age=1`) e passou a ler um arquivo estático servido pelo GitHub Pages
 * com `cache-control: max-age=600`. O laço de poll continuou rodando a cada 60 s — e relendo a
 * MESMA cópia em cache por até dez minutos. Relógio parado, placar velho, e os lances (gol, cartão,
 * substituição) invisíveis, porque estavam no snapshot mais novo que o navegador nunca buscava.
 *
 * O dado sempre esteve certo: o normalizador preserva `details` (gol/cartão/jogador/minuto) — foi
 * verificado no arquivo real. O que faltava era o navegador chegar até ele.
 *
 * Por que um teste e não só a correção: o sintoma aparece SOMENTE durante um jogo ao vivo, em
 * produção, depois de dez minutos. Não existe forma barata de alguém notar isso de novo a tempo.
 *
 * `no-cache` (revalidar) e não `no-store` (nunca cachear): o snapshot tem ~900 KB e só muda quando
 * o cron commita. Revalidar devolve 304 barato na maioria dos polls.
 *
 * Uso: node bolao/scripts/audit_live_freshness.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// Apps que fazem POLL de snapshot no navegador. A Copa está arquivada (sem jogo ao vivo para
// acompanhar), mas o fetch dela já usa `no-store` e continua sendo verificado — se alguém remover,
// tem de doer.
const POLLING_APPS = ["copa2026", "br2026", "cdb2026"];

const REVALIDATING = /cache:\s*["'](no-cache|no-store|reload)["']/;

console.log("\nFrescor do dado ao vivo — fetch de snapshot precisa revalidar\n");

for (const app of POLLING_APPS) {
  const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");

  test(`[${app}] todo fetch de snapshot da ESPN revalida (não serve cache velho)`, () => {
    // Linhas que buscam um snapshot: por URL de config (`C.espn.*Url`), por constante
    // (`ESPN_SNAPSHOT_URL`) ou pelo caminho literal do arquivo.
    const offenders = [];
    // Só fetch de SNAPSHOT. Um padrão genérico pegava também as chamadas REST do Supabase e a
    // própria definição do helper `fetchJson` — detector barulhento vira detector desligado.
    //
    // Duas formas no código real: a URL aparece na própria linha (br2026, copa2026), ou é guardada
    // numa variável local dentro da função de snapshot (cdb2026 `fetchEspnCandidates`). As duas são
    // reconhecidas, e a definição genérica do helper é ignorada de propósito.
    const SNAPSHOT_TARGET = /(C\.espn\??\.\w*Url|ESPN_SNAPSHOT_URL|espn-normalized|espn-standings-normalized)/;
    const SNAPSHOT_FNS = ["fetchEspnCandidates", "fetchScoreboard", "fetchStandings", "fetchSchedule"];

    const check = (chunk, label) => {
      chunk.split("\n").forEach((line, i) => {
        if (!/\b(fetchJson|fetch)\s*\(/.test(line)) return;
        if (/^\s*(async\s+)?function fetchJson\b/.test(line)) return;   // a definição do helper
        if (/return await fetch\(url, \{ \.\.\.opts/.test(line)) return; // o corpo do helper
        const win = line + "\n" + (chunk.split("\n")[i + 1] || "");
        if (!REVALIDATING.test(win)) offenders.push(`${label}: ${line.trim().slice(0, 90)}`);
      });
    };

    // (a) linhas com a URL de snapshot explícita
    src.split("\n").forEach((line, i) => {
      if (!SNAPSHOT_TARGET.test(line) || !/\b(fetchJson|fetch)\s*\(/.test(line)) return;
      const win = line + "\n" + (src.split("\n")[i + 1] || "");
      if (!REVALIDATING.test(win)) offenders.push(`${app}/js/app.js:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
    // (b) corpo das funções de snapshot conhecidas
    for (const fn of SNAPSHOT_FNS) {
      const at = src.indexOf(`function ${fn}(`);
      if (at === -1) continue;
      check(src.slice(at, at + 1200), `${app}/js/app.js (${fn})`);
    }
    assert(offenders.length === 0,
      `fetch de snapshot SEM revalidação — o navegador vai servir cache velho por até 10 min ` +
      `(GitHub Pages manda max-age=600) e o placar/relógio ao vivo congelam:\n      ` +
      offenders.join("\n      "));
  });
}

test("[br2026] o laço de poll existe e tem intervalo definido", () => {
  const src = readFileSync(join(ROOT, "bolao/br2026/js/app.js"), "utf8");
  const cfg = readFileSync(join(ROOT, "bolao/br2026/js/config.js"), "utf8");
  assert(/function schedulePoll\(/.test(src), "schedulePoll() sumiu — nada reataria o poll ao vivo");
  assert(/pollIntervalMs/.test(cfg), "pollIntervalMs sumiu da config");
  // Revalidar não adianta se o poll parar quando a aba volta do bfcache.
  assert(/resumeLivePolling/.test(src), "resumeLivePolling() sumiu — o poll não voltaria após focus/bfcache");
});

test("CONTRATO: o normalizador continua preservando os LANCES (gol/cartão/substituição)", () => {
  const prov = readFileSync(join(ROOT, "bolao/shared/scripts/espn_provider.py"), "utf8");
  assert(/["']details["']/.test(prov),
    "`details` saiu do snapshot normalizado — gol, cartão e substituição param de aparecer no jogo ao vivo");
});

test("CONTRATO: o snapshot versionado do BR2026 realmente carrega lances", () => {
  const snap = JSON.parse(readFileSync(join(ROOT, "bolao/br2026/data/espn-normalized.json"), "utf8"));
  const withDetails = (snap.matches || []).filter(m => Array.isArray(m.details) && m.details.length);
  assert(withDetails.length > 0,
    "nenhuma partida do snapshot tem `details` — ou o normalizador parou de trazer, ou o snapshot " +
    "está vazio de lances; nos dois casos o jogo ao vivo perde gol/cartão/substituição");
  const sample = withDetails[0].details[0];
  assert(sample && sample.type && sample.clock,
    "a forma de `details` mudou (esperado type/clock por lance)");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ LIVE FRESHNESS SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
