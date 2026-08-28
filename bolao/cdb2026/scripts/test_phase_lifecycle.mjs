#!/usr/bin/env node
/**
 * CDB2026 — ciclo de vida da fase de palpite.
 *
 * O DEFEITO QUE ISTO FECHA (2026-08-11, produção)
 * ----------------------------------------------
 * `cutoffAt === null` carregava DOIS significados diferentes, e o app não os distinguia:
 *
 *   a) "a fase ainda nem foi sorteada"
 *   b) "foi sorteada, a CBF ainda não publicou a tabela detalhada"
 *
 * Com o sorteio das quartas já aplicado, o app tratou (b) como (a) e exibiu "Aguardando sorteio
 * oficial" — afirmando que o sorteio não tinha acontecido, com os quatro confrontos em produção.
 *
 * REGRA DE NEGÓCIO (override do Eduardo, 2026-08-11): em (b) o palpite continua FECHADO. Sem
 * data e horário oficiais não existe prazo, e um formulário aberto sem prazo aceitaria palpite
 * depois de a bola rolar. O que muda em (b) não é a abertura — é a MENSAGEM: os confrontos
 * aparecem e a tela diz que falta a CBF publicar as datas.
 *
 * A abertura depende de prazo CONHECIDO, e nada mais abre sem ele.
 *
 * As funções são recortadas do app.js REAL — não reescritas aqui.
 *
 * Uso: node bolao/cdb2026/scripts/test_phase_lifecycle.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(HERE, "..", "js", "app.js");
const src = readFileSync(APP_JS, "utf8");

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };

/** Recorta uma função de nível superior do app.js pelo balanceamento de chaves. */
function cut(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`função ${name} sumiu do app.js`);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") { depth++; started = true; }
    else if (src[j] === "}") { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`não consegui recortar ${name}`);
}

const consts = src.slice(src.indexOf("const OFFICIAL_DRAW_REQUIRED_FIELDS"),
                        src.indexOf("const OFFICIAL_DRAW_REQUIRED_FIELDS") + 200);
const lifecycleConst = src.slice(src.indexOf("const PHASE_LIFECYCLE = Object.freeze("),
                                 src.indexOf("});", src.indexOf("const PHASE_LIFECYCLE = Object.freeze(")) + 3);

const harness = `
${consts}
${lifecycleConst}
${cut("officialDrawProvenanceIsValid")}
${cut("firstKnownKickoffMs")}
${cut("effectivePhaseCutoffMs")}
${cut("phaseLifecycle")}
return { PHASE_LIFECYCLE, phaseLifecycle };
`;
const { PHASE_LIFECYCLE, phaseLifecycle } = new Function(harness)();

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────
const AGORA = Date.parse("2026-08-11T18:00:00Z");
const PROV_OK = {
  authority: "CBF", source: "cbf-publication",
  scheduledAt: "2026-08-11T00:00:00Z",
  ingestedAt: "2026-08-11T16:10:00Z",
  validatedAt: "2026-08-11T17:16:03Z",
};
const tie = (a, b, kickoff = null) => ({
  teamA: a, teamB: b,
  matches: { first: { homeTeam: a, awayTeam: b, kickoff, status: "SCHEDULED" },
             second: { homeTeam: b, awayTeam: a, kickoff: null, status: "SCHEDULED" } },
});
const QUATRO = {
  "espn-gremio_internacional": tie("Internacional", "Grêmio"),
  "espn-atletico-mg_cruzeiro": tie("Cruzeiro", "Atlético-MG"),
  "espn-vasco_vitoria": tie("Vasco", "Vitória"),
  "espn-palmeiras_santos": tie("Palmeiras", "Santos"),
};
const estado = (quartas, activePhaseId = "quartas") => ({
  espnSync: { activePhaseId },
  phases: { oitavas: { ties: {}, cutoffAt: "2026-08-01T20:30:00.000Z" }, quartas, semifinal: { ties: {} } },
});

console.log("\nCDB2026 — ciclo de vida da fase de palpite\n");

// ── O CASO EXATO DE PRODUÇÃO ─────────────────────────────────────────────────────────────────
test("sorteio aplicado + tabela da CBF pendente => estado próprio, palpites FECHADOS", () => {
  // REGRA DE NEGÓCIO (override explícito do Eduardo, 2026-08-11): palpite não abre sem data E
  // horário oficiais. Antes disso este caso abria — e estava errado por um motivo concreto: sem
  // `cutoffMs` não existe prazo para fechar, então o formulário aceitaria palpite depois de a
  // bola rolar. "Aberto sem prazo" é um bolão sem regra.
  //
  // O estado continua sendo PRÓPRIO (não "aguardando sorteio"): o sorteio aconteceu, os quatro
  // confrontos existem, e a tela precisa dizer a verdade sobre o que falta.
  const s = estado({ ties: QUATRO, cutoffAt: null, officialDraw: PROV_OK });
  const lc = phaseLifecycle(s, "quartas", AGORA);
  eq(lc.state, PHASE_LIFECYCLE.DRAW_LOCKED_CUTOFF_PENDING, "estado derivado");
  eq(lc.open, false, "sem data/horário oficial NÃO se abre palpite");
  eq(lc.cutoffKnown, false, "o prazo exato legitimamente ainda não existe");
  eq(lc.ties, 4, "os quatro confrontos oficiais continuam visíveis");
});

test("REGRESSÃO: nenhum caminho abre palpite sem prazo conhecido", () => {
  // A propriedade que o override exige, afirmada diretamente: se não há cutoff, não há abertura.
  // Vale para qualquer combinação de sorteio/fase — é a invariante, não um caso.
  for (const [rot, st] of [
    ["sorteado + fase corrente", estado({ ties: QUATRO, cutoffAt: null, officialDraw: PROV_OK })],
    ["sorteado + fase não corrente", estado({ ties: QUATRO, cutoffAt: null, officialDraw: PROV_OK }, "semifinal")],
    ["sem sorteio", estado({ ties: QUATRO, cutoffAt: null })],
  ]) {
    const lc = phaseLifecycle(st, "quartas", AGORA);
    eq(lc.open, false, `abriu palpite sem prazo conhecido (${rot})`);
  }
});

// ── A PROPRIEDADE QUE IMPEDE A CORREÇÃO PREGUIÇOSA ───────────────────────────────────────────
test("fase FUTURA sem sorteio (cutoff null) NÃO abre", () => {
  // Se a correção fosse "cutoff null = aberto", a semifinal abriria sozinha, sem confronto.
  const s = estado({ ties: QUATRO, cutoffAt: null, officialDraw: PROV_OK }, "semifinal");
  const lc = phaseLifecycle(s, "semifinal", AGORA);
  eq(lc.state, PHASE_LIFECYCLE.WAITING_FOR_OFFICIAL_DRAW, "semifinal sem sorteio");
  eq(lc.open, false, "uma fase não sorteada NUNCA pode aceitar palpite");
});

test("sorteio com procedência INCOMPLETA não abre nada", () => {
  for (const faltando of ["authority", "source", "scheduledAt", "ingestedAt", "validatedAt"]) {
    const prov = { ...PROV_OK }; delete prov[faltando];
    const s = estado({ ties: QUATRO, cutoffAt: null, officialDraw: prov });
    const lc = phaseLifecycle(s, "quartas", AGORA);
    eq(lc.open, false, `abriu sem o campo de procedência "${faltando}"`);
  }
});

test("autoridade diferente de CBF não abre", () => {
  const s = estado({ ties: QUATRO, cutoffAt: null, officialDraw: { ...PROV_OK, authority: "ESPN" } });
  eq(phaseLifecycle(s, "quartas", AGORA).open, false, "só a CBF tem autoridade sobre este sorteio");
});

test("procedência válida SEM confronto nenhum não abre", () => {
  const s = estado({ ties: {}, cutoffAt: null, officialDraw: PROV_OK });
  const lc = phaseLifecycle(s, "quartas", AGORA);
  eq(lc.state, PHASE_LIFECYCLE.WAITING_FOR_OFFICIAL_DRAW, "sem confronto não há o que palpitar");
  eq(lc.open, false, "formulário vazio é pior que formulário fechado");
});

// ── PRAZO CONHECIDO ──────────────────────────────────────────────────────────────────────────
test("com kickoff publicado, o prazo é kickoff − 1h e os palpites ficam ABERTOS", () => {
  const ties = { ...QUATRO,
    "espn-vasco_vitoria": tie("Vasco", "Vitória", "2026-08-26T23:00:00Z") };
  const s = estado({ ties, cutoffAt: null, officialDraw: PROV_OK });
  const lc = phaseLifecycle(s, "quartas", AGORA);
  eq(lc.state, PHASE_LIFECYCLE.PICKS_OPEN, "prazo conhecido");
  eq(lc.cutoffKnown, true, "cutoff derivado do kickoff");
  eq(lc.cutoffMs, Date.parse("2026-08-26T23:00:00Z") - 3600000, "kickoff − 1h");
});

test("o prazo usa o kickoff MAIS CEDO, não a ordem do objeto", () => {
  const ties = {
    a: tie("A", "B", "2026-08-27T23:00:00Z"),
    b: tie("C", "D", "2026-08-26T22:00:00Z"),   // mais cedo, declarado depois
    c: tie("E", "F", "2026-08-28T23:00:00Z"),
    d: tie("G", "H", "2026-08-29T23:00:00Z"),
  };
  const s = estado({ ties, cutoffAt: null, officialDraw: PROV_OK });
  eq(phaseLifecycle(s, "quartas", AGORA).cutoffMs,
     Date.parse("2026-08-26T22:00:00Z") - 3600000,
     "derivou o prazo da ordem do objeto em vez do jogo mais cedo");
});

// ── FRONTEIRA DO PRAZO ───────────────────────────────────────────────────────────────────────
test("FRONTEIRA: −1s aberto, no instante fechado, +1s fechado", () => {
  const kickoff = "2026-08-26T23:00:00Z";
  const ties = { ...QUATRO, "espn-vasco_vitoria": tie("Vasco", "Vitória", kickoff) };
  const s = estado({ ties, cutoffAt: null, officialDraw: PROV_OK });
  const cutoff = Date.parse(kickoff) - 3600000;
  eq(phaseLifecycle(s, "quartas", cutoff - 1000).open, true, "1s antes tem de aceitar");
  eq(phaseLifecycle(s, "quartas", cutoff).open, false, "no instante do prazo já fecha");
  eq(phaseLifecycle(s, "quartas", cutoff + 1000).open, false, "1s depois tem de recusar");
  eq(phaseLifecycle(s, "quartas", cutoff).state, PHASE_LIFECYCLE.PICKS_CLOSED, "estado");
});

test("fase sorteada que NÃO é a corrente fica fechada", () => {
  // Fase histórica: sorteio válido, mas o operador já avançou. Não pode reabrir sozinha.
  const s = estado({ ties: QUATRO, cutoffAt: null, officialDraw: PROV_OK }, "semifinal");
  eq(phaseLifecycle(s, "quartas", AGORA).open, false,
     "uma fase que não é a corrente voltou a aceitar palpite");
});

// ── A UI NÃO PODE CONTRADIZER O ESTADO ───────────────────────────────────────────────────────
test("a UI tem mensagem própria para prazo pendente (não reusa 'aguardando sorteio')", () => {
  assert(/PHASE_LIFECYCLE\.DRAW_LOCKED_CUTOFF_PENDING/.test(src),
    "renderCountdown não trata o estado de prazo pendente");
  // As chaves saíram do app.js e foram para o contrato de texto (#246, v3.138). Exercitar o
  // contrato é mais forte que procurar a string: prova que o estado PRODUZ a mensagem própria e
  // que ela não é a de espera de sorteio.
  const escopo = {};
  new Function("globalThis", "window",
    readFileSync(join(HERE, "..", "..", "shared", "js", "hero_copy.js"), "utf8")).call(escopo, escopo, escopo);
  const HC = escopo.BOLAO_HERO_COPY;
  const c = HC.selectPicksCountdownCopy({ picksState: HC.PICKS.SCHEDULE_PENDING,
    drawState: HC.DRAW.LOCKED, now: AGORA });
  assert(c.labelKey === "schedulePendingTitle" && c.bodyKey === "schedulePendingRule",
    "faltam as chaves de texto do estado sorteado-sem-tabela");
  assert(!HC.DRAW_WAIT_KEYS.includes(c.bodyKey) && !HC.DRAW_WAIT_KEYS.includes(c.labelKey),
    "o estado de prazo pendente voltou a reusar 'aguardando sorteio'");
  const i18nSrc = readFileSync(join(HERE, "..", "js", "i18n.js"), "utf8");
  for (const k of [c.labelKey, c.bodyKey, c.noteKey].filter(Boolean)) {
    assert(new RegExp(`\\b${k}:`).test(i18nSrc), `a chave \`${k}\` não existe no i18n do CDB2026`);
  }
  const i18n = readFileSync(join(HERE, "..", "js", "i18n.js"), "utf8");
  for (const k of ["schedulePendingTitle", "schedulePendingRule", "schedulePendingNote"]) {
    assert(new RegExp(`${k}:`).test(i18n), `chave i18n ausente: ${k}`);
  }
  assert(/1 hora antes do primeiro jogo/.test(i18n),
    "a mensagem não afirma a REGRA do prazo — é o único fato conhecido enquanto a CBF não publica");
  // O texto NÃO pode anunciar abertura enquanto o prazo não existe.
  const bloco = i18n.slice(i18n.indexOf("schedulePendingTitle"), i18n.indexOf("picksOpenTitle"));
  assert(!/palpites abertos/i.test(bloco),
    "a mensagem de espera anuncia palpites abertos — é exatamente o que o override proíbe");
});

test("o portão de entrada deriva do ciclo de vida, não só do relógio", () => {
  const fn = cut("isPastEntryCutoff");
  assert(/activePhaseLifecycle\(\)\.open/.test(fn),
    "isPastEntryCutoff voltou a olhar só o prazo — foi assim que 'sem sorteio' e 'prazo pendente' " +
    "viraram a mesma coisa");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ PHASE LIFECYCLE PASSED\n" : "✗ PHASE LIFECYCLE FAILED\n");
process.exit(fail === 0 ? 0 : 1);
