#!/usr/bin/env node
/**
 * RELÓGIO AO VIVO — tem de continuar correndo quando o MESMO snapshot é buscado de novo.
 *
 * O DEFEITO (relatado pelo Eduardo em 2026-08-08, com jogo acontecendo, print anexado):
 * "Relógio e placar ainda estáticos, isso estava funcionando 100% na cdb essa semana porém quebrou
 * novamente."
 *
 * O modelo de relógio foi escrito quando o navegador falava DIRETO com a ESPN. Ali, "buscar" e
 * "observar" eram o mesmo instante, então usar a hora do fetch como âncora da interpolação estava
 * certo. Depois da migração o navegador lê um snapshot que pode ter sido gerado minutos antes — e a
 * premissa deixou de valer sem que nada no código mudasse.
 *
 * A consequência é contraintuitiva e é por isso que este teste existe. Buscando o MESMO snapshot
 * duas vezes seguidas, `clockSeconds` não muda. Com a âncora na hora do fetch,
 * `detectClockPaused()` compara 60 s de tempo real contra 0 s de relógio e conclui, coerentemente,
 * que o jogo está PARADO — e `liveClockDisplay()` para de interpolar. **O relógio congela
 * exatamente porque o poll está funcionando.**
 *
 * A correção é ancorar em `generatedAt` do snapshot (quando o dado foi de fato observado). Dois
 * polls do mesmo snapshot passam a dar o mesmo instante de observação: `realElapsed` é 0, nada é
 * declarado pausado, e o relógio corre continuamente a partir da observação real.
 *
 * Uso: node bolao/scripts/audit_live_clock.test.mjs
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
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

function extractFn(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name}() não encontrada`);
  let p = src.indexOf("(", start), parens = 0, bodyStart = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === "(") parens++;
    else if (src[j] === ")") { parens--; if (parens === 0) { bodyStart = src.indexOf("{", j); break; } }
  }
  let depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`chaves desbalanceadas em ${name}()`);
}

const APPS = ["br2026", "cdb2026"];   // os dois que acompanham jogo ao vivo hoje

console.log("\nRelógio ao vivo — âncora de observação, não de fetch\n");

for (const app of APPS) {
  const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
  const detectClockPaused = new Function(`${extractFn(src, "detectClockPaused")}; return detectClockPaused;`)();

  test(`[${app}] MESMO snapshot buscado de novo NÃO é interpretado como jogo parado`, () => {
    // É este o caso real: dois polls a 60 s de distância, mesmo snapshot, relógio idêntico.
    const observedAt = 1_000_000;                       // generatedAt do snapshot
    const prev  = { clockSeconds: 3120, pollTime: observedAt, period: 2 };
    const fresh = { clockSeconds: 3120, pollTime: observedAt, period: 2 };  // mesma observação
    eq(detectClockPaused(fresh, prev), false,
       "declarou PAUSADO com o mesmo snapshot — o relógio congela na tela justamente porque o poll " +
       "está funcionando. A âncora precisa ser a hora da OBSERVAÇÃO, não a do fetch");
  });

  test(`[${app}] snapshot NOVO com relógio parado de verdade ainda é detectado como pausado`, () => {
    // A correção não pode cegar a detecção real de intervalo/paralisação.
    const prev  = { clockSeconds: 2700, pollTime: 1_000_000, period: 2 };
    const fresh = { clockSeconds: 2700, pollTime: 1_000_000 + 120_000, period: 2 }; // 2 min, 0 s de relógio
    eq(detectClockPaused(fresh, prev), true, "deixou de detectar jogo genuinamente parado");
  });

  test(`[${app}] snapshot novo com relógio andando normalmente NÃO é pausado`, () => {
    const prev  = { clockSeconds: 3000, pollTime: 1_000_000, period: 2 };
    const fresh = { clockSeconds: 3060, pollTime: 1_000_000 + 60_000, period: 2 };
    eq(detectClockPaused(fresh, prev), false, "declarou pausado com relógio andando");
  });

  test(`[${app}] CONTRATO: a âncora do relógio é o generatedAt do snapshot`, () => {
    assert(/observedAt/.test(src),
      "não há âncora de observação — o relógio voltou a assumir que buscar == observar, que é falso " +
      "desde a migração da ESPN");
    assert(/Date\.parse\(snap\.generatedAt/.test(src),
      "`observedAt` não vem do `generatedAt` do snapshot");
    assert(/pollTime: observedAt/.test(src),
      "`pollTime` voltou a receber a hora do fetch em vez da hora da observação");
  });

  test(`[${app}] CONTRATO: existe teto de interpolação (snapshot velho não faz o relógio disparar)`, () => {
    assert(/MAX_INTERPOLATION_MS|maxInterpolation/i.test(src),
      "sumiu o teto de interpolação — com um snapshot muito velho o relógio correria sem limite");
  });
}

// ── MATRIZ DE ESTADOS DO RELÓGIO ────────────────────────────────────────────
// O relógio é montado por `liveClockDisplay()`, que fecha sobre `t()` e sobre o teto de
// interpolação do app. Extrai a função real e roda contra fixtures — nada de reimplementar a
// lógica no teste, que só provaria que duas cópias concordam.
for (const app of APPS) {
  const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
  const ceilingName = app === "br2026" ? "BR_MAX_INTERPOLATION_MS" : "CDB_MAX_INTERPOLATION_MS";
  const ceiling = 180000;
  const fnSrc = extractFn(src, "liveClockDisplay");
  const harness = `
    const ${ceilingName} = ${ceiling};
    const T = { liveHalftime: "Intervalo", livePenalties: "Pênaltis", liveClockStale: "Atualização pendente" };
    function t(k) { return T[k] || k; }
    function formatMatchClock(sec, period) {
      const m = Math.floor(sec / 60), s = sec % 60;
      return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }
    ${fnSrc}
    return liveClockDisplay;`;
  const rawClockOf = new Function(harness)();
  // BR2026 devolve `{ clock, sec, stale }` e CDB2026 devolve a string direto — normaliza aqui em
  // vez de escrever dois conjuntos de asserção quase iguais.
  const clockOf = (m) => { const r = rawClockOf(m); return (r && typeof r === "object") ? r.clock : r; };
  const now = Date.now();
  const fresh = (over) => ({ pollTime: now - 5000, clockSeconds: 0, period: 1, ...over });

  test(`[${app}] 45' do primeiro tempo mostra o minuto, não intervalo`, () => {
    const out = clockOf(fresh({ clockSeconds: 45 * 60, period: 1 }));
    assert(/^4[56]:/.test(String(out)), `esperava ~45:xx, veio ${out}`);
  });

  test(`[${app}] INTERVALO mostra "Intervalo", mesmo com observação velha`, () => {
    const out = clockOf({ pollTime: now - 30 * 60000, clockSeconds: 45 * 60, period: 1, isHalftime: true });
    eq(String(out), "Intervalo",
       "intervalo é estado declarado pela fonte — dado velho não o invalida");
  });

  test(`[${app}] segundo tempo continua contando a partir do minuto da fonte`, () => {
    const out = clockOf(fresh({ clockSeconds: 46 * 60, period: 2 }));
    assert(/^4[67]:/.test(String(out)), `esperava ~46:xx no 2º tempo, veio ${out}`);
  });

  test(`[${app}] 90' não vira "Atualização pendente" com dado fresco`, () => {
    const out = clockOf(fresh({ clockSeconds: 90 * 60, period: 2 }));
    assert(!/pendente/i.test(String(out)), `90' com dado fresco virou estado de stale: ${out}`);
  });

  test(`[${app}] relógio PAUSADO congela e NÃO vira stale`, () => {
    // Pausado é informação real da fonte (paralisação); não é ausência de informação.
    const out = clockOf({ pollTime: now - 30 * 60000, clockSeconds: 70 * 60, period: 2, clockPaused: true });
    assert(!/pendente/i.test(String(out)), `pausado virou stale: ${out}`);
    assert(/^7[01]:/.test(String(out)), `pausado deveria congelar em ~70:xx, veio ${out}`);
  });

  test(`[${app}] FAIL CLOSED: observação velha demais vira "Atualização pendente"`, () => {
    // É a regra central: capar a interpolação impede o relógio de disparar, mas um número
    // congelado continua PARECENDO ao vivo. Passado o teto, diz-se a verdade.
    const out = clockOf({ pollTime: now - (ceiling + 60000), clockSeconds: 30 * 60, period: 1 });
    eq(String(out), "Atualização pendente",
       "com observação além do teto o relógio ainda exibe um minuto inventado");
  });

  test(`[${app}] logo ABAIXO do teto ainda mostra o relógio (não é agressivo demais)`, () => {
    const out = clockOf({ pollTime: now - (ceiling - 10000), clockSeconds: 30 * 60, period: 1 });
    assert(!/pendente/i.test(String(out)), `virou stale antes do teto: ${out}`);
  });

  test(`[${app}] pênaltis são preservados mesmo com dado velho`, () => {
    const out = clockOf({ pollTime: now - 30 * 60000, clockSeconds: 120 * 60, period: 5, isPenalties: true });
    eq(String(out), "Pênaltis", "estado de pênaltis perdido");
  });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ LIVE CLOCK SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
