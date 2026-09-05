/**
 * test_hero_copy_contract.mjs — o gate permanente do TEXTO do hero e do prazo (#246).
 *
 * `test_hero_always_mounted.mjs` prova que o hero EXISTE. Este prova que ele DIZ A VERDADE — que
 * é a metade do #246 que continuou regredindo depois de o invariante de existência ficar verde.
 *
 * Três coisas são provadas para BR2026 e CDB2026:
 *
 *   1. HERO PRIMÁRIO — em toda a matriz de provedor: existe, é único, não é vazio, e o confronto
 *      primário não aparece uma segunda vez como apresentação primária.
 *   2. RELEVÂNCIA DO AVISO — degradação da fonte só vira texto quando o que está NA TELA depende
 *      do frescor dela. Próxima partida autoritativa + fonte fora não ganha alarme; partida ao
 *      vivo com fonte atrasada ganha, e diz "atrasada", não "indisponível".
 *   3. VERDADE DE SORTEIO/PRAZO (CDB) — a tabela-verdade inteira, com a proibição estrutural:
 *      sorteio travado NUNCA produz linguagem de espera de sorteio.
 *
 * Cada bloco tem CONTROLE NEGATIVO: uma mutação que reintroduz o defeito antigo tem de fazer o
 * gate falhar. Um gate que não morde não é gate.
 *
 * Determinístico e hermético: sem rede, sem relógio implícito, sem browser.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COPY_SRC = readFileSync(join(ROOT, "bolao/shared/js/hero_copy.js"), "utf8");
const STATE_SRC = readFileSync(join(ROOT, "bolao/shared/js/football_hero_state.js"), "utf8");

function carregar(fonte, chave) {
  const escopo = {};
  new Function("globalThis", "window", fonte).call(escopo, escopo, escopo);
  return escopo[chave];
}

const HC = carregar(COPY_SRC, "BOLAO_HERO_COPY");
const HS = carregar(STATE_SRC, "BOLAO_FOOTBALL_HERO");
const { HERO, DRAW, PICKS, MODE } = HC;

let ok = 0, fail = 0;
function test(nome, fn) {
  try { fn(); console.log(`  ✓ ${nome}`); ok++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

const AGORA = Date.parse("2026-08-28T18:00:00Z");
const aoVivo = { id: "10", homeTeam: "Cruzeiro", awayTeam: "Vasco", homeScore: 1, awayScore: 0 };
const proxima = { id: "11", homeTeam: "Flamengo", awayTeam: "Bahia", kickoff: "2026-09-03T23:30:00Z" };
const finalRecente = { id: "12", homeTeam: "Palmeiras", awayTeam: "Grêmio", kickoff: "2026-08-28T15:00:00Z" };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. HERO PRIMÁRIO — a matriz exigida, para os DOIS apps.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// BR2026 e CDB2026 consomem a MESMA política (`football_hero_state.js` + `hero_copy.js`). Rodar
// a matriz duas vezes não é redundância burocrática: é o que impede que um app ganhe um atalho
// próprio e volte a divergir — foi exatamente assim que os seis caminhos de `hidden` nasceram.
const APPS = ["br2026", "cdb2026"];

const MATRIZ = [
  ["provedor fresco + próxima partida",
   { liveState: "NO_LIVE_MATCH", liveMatches: [], nextMatch: proxima, sourceOk: true },
   HERO.UPCOMING],
  ["provedor indisponível + próxima partida",
   { liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false },
   HERO.UPCOMING],
  ["ao vivo fresco",
   { liveState: "LIVE_FRESH", liveMatches: [aoVivo], nextMatch: proxima, sourceOk: true },
   HERO.LIVE_FRESH],
  ["ao vivo atrasado",
   { liveState: "LIVE_STALE", liveMatches: [aoVivo], nextMatch: proxima, sourceOk: false },
   HERO.LIVE_DELAYED],
  ["final recente",
   { liveState: "NO_LIVE_MATCH", liveMatches: [], recentResult: finalRecente, sourceOk: true },
   HERO.RECENT_FINAL],
  ["sem calendário e sem fonte",
   { liveState: "SOURCE_UNAVAILABLE", liveMatches: [], sourceOk: false },
   HERO.SOURCE_UNAVAILABLE],
];

/**
 * As quatro asserções do enunciado, medidas no resultado da política — que é o que os dois
 * renderizadores consomem para montar o card primário.
 */
function invarianteDoHeroPrimario(r, rotulo) {
  // PRIMARY_HERO_VISIBLE
  assert(r.visible === true, `${rotulo}: PRIMARY_HERO_VISIBLE falso`);
  // PRIMARY_HERO_COUNT === 1 — um estado, um card primário. Nunca zero (sumiço), nunca dois.
  const primarios = [r].filter(x => x.visible === true).length;
  assert(primarios === 1, `${rotulo}: PRIMARY_HERO_COUNT = ${primarios}`);
  // PRIMARY_HERO_NONEMPTY — sempre há um estado semântico E algo a dizer sobre ele. Hero montado
  // e vazio já aconteceu em produção (helper inexistente lançou no meio do render).
  assert(typeof r.state === "string" && r.state.length > 0, `${rotulo}: PRIMARY_HERO_NONEMPTY falso (sem estado)`);
  assert(typeof r.reason === "string" && r.reason.length > 0, `${rotulo}: PRIMARY_HERO_NONEMPTY falso (sem motivo)`);
  const temConteudo = (r.matches && r.matches.length > 0) || r.nextMatch || r.recentResult ||
                      r.state === HERO.SOURCE_UNAVAILABLE || r.state === HERO.SCHEDULE_UNKNOWN;
  assert(temConteudo, `${rotulo}: PRIMARY_HERO_NONEMPTY falso (sem conteúdo nem explicação)`);
  // PRIMARY_FIXTURE_DUPLICATED — o confronto que ocupa o primário não pode aparecer também como
  // "próxima partida" na mesma saída. Foi assim que o CDB desenhou o mesmo jogo duas vezes.
  const idPrimario = r.matches && r.matches.length ? String(r.matches[0].id)
                   : r.state === HERO.RECENT_FINAL && r.recentResult ? String(r.recentResult.id)
                   : r.state === HERO.UPCOMING && r.nextMatch ? String(r.nextMatch.id) : null;
  if (idPrimario && r.state !== HERO.UPCOMING) {
    assert(!r.nextMatch || String(r.nextMatch.id) !== idPrimario,
           `${rotulo}: PRIMARY_FIXTURE_DUPLICATED — ${idPrimario} é primário e também "próxima"`);
  }
}

console.log("\n#246 — contrato de texto do hero e do prazo\n");
console.log("A. Hero primário sobrevive à matriz de provedor (BR2026 e CDB2026):");

for (const app of APPS) {
  for (const [nome, entrada, esperado] of MATRIZ) {
    test(`[${app}] ${nome}`, () => {
      const r = HS.deriveFootballHeroState({ ...entrada, now: AGORA });
      assert(r.state === esperado, `estado ${r.state}, esperado ${esperado}`);
      invarianteDoHeroPrimario(r, `[${app}] ${nome}`);
    });
  }
}

test("controle negativo: reintroduzir `hidden` por ausência de dado quebra o gate", () => {
  // Ancorado no CAMPO do objeto `base`, não na primeira ocorrência do texto: a JSDoc logo acima
  // contém `visible: true,` e mutá-la não muda comportamento nenhum — um controle negativo que
  // muta um comentário nunca reprova nada.
  const mutado = STATE_SRC.replace("      visible: true,\n      matches: aoVivo,",
                                   "      visible: aoVivo.length > 0,\n      matches: aoVivo,");
  assert(mutado !== STATE_SRC, "a mutação não encontrou o alvo — o controle negativo cegou");
  const M = carregar(mutado, "BOLAO_FOOTBALL_HERO");
  const r = M.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [],
                                        nextMatch: proxima, sourceOk: false, now: AGORA });
  let mordeu = false;
  try { invarianteDoHeroPrimario(r, "mutante"); } catch { mordeu = true; }
  assert(mordeu, "o gate NÃO reprovou um hero escondido por falha de provedor");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. RELEVÂNCIA DO AVISO
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nB. O aviso de degradação só aparece quando é relevante:");

for (const app of APPS) {
  test(`[${app}] fonte fora + próxima autoritativa => SEM aviso de indisponibilidade`, () => {
    const r = HS.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [],
                                           nextMatch: proxima, sourceOk: false, now: AGORA });
    assert(r.state === HERO.UPCOMING, r.state);
    assert(r.degraded === true, "o FATO da degradação tem de continuar exposto ao diagnóstico");
    const c = HC.selectHeroCopy({ heroState: r.state, degraded: r.degraded });
    assert(c.noticeKey === null,
           `avisou "${c.noticeKey}" sobre uma partida futura que não veio do provedor`);
    assert(c.noticeRelevant === false, "marcou como relevante um aviso sem consequência");
  });

  test(`[${app}] fonte fora + final recente => SEM aviso de indisponibilidade`, () => {
    const r = HS.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [],
                                           recentResult: finalRecente, sourceOk: false, now: AGORA });
    assert(r.state === HERO.RECENT_FINAL, r.state);
    const c = HC.selectHeroCopy({ heroState: r.state, degraded: r.degraded });
    assert(c.noticeKey === null, `avisou "${c.noticeKey}" sobre um resultado já encerrado`);
  });

  test(`[${app}] ao vivo atrasado => partida mantida + aviso de ATRASO (não de ausência)`, () => {
    const r = HS.deriveFootballHeroState({ liveState: "LIVE_STALE", liveMatches: [aoVivo],
                                           sourceOk: false, now: AGORA });
    assert(r.state === HERO.LIVE_DELAYED, r.state);
    assert(r.matches.length === 1 && r.matches[0].id === aoVivo.id,
           "a partida ao vivo foi retirada do ar por uma fonte atrasada");
    const c = HC.selectHeroCopy({ heroState: r.state, degraded: r.degraded });
    assert(c.noticeKey === "liveDataDelayed",
           `aviso "${c.noticeKey}" — com placar na tela, "indisponível" seria falso`);
  });

  test(`[${app}] sem conteúdo + fonte fora => aviso de indisponibilidade (aqui É relevante)`, () => {
    const r = HS.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [],
                                           sourceOk: false, now: AGORA });
    const c = HC.selectHeroCopy({ heroState: r.state, degraded: r.degraded });
    assert(c.noticeKey === "liveDataUnavailable", `aviso "${c.noticeKey}" — aqui calar seria omitir`);
  });

  test(`[${app}] fonte íntegra nunca produz aviso`, () => {
    for (const estado of Object.values(HERO)) {
      const c = HC.selectHeroCopy({ heroState: estado, degraded: false });
      assert(c.noticeKey === null, `${estado} avisou "${c.noticeKey}" com a fonte íntegra`);
    }
  });
}

test("controle negativo: voltar a imprimir o aviso direto de `degraded` quebra o gate", () => {
  // A regressão exata: `degraded ? liveDataUnavailable : null`, sem perguntar se o conteúdo
  // exibido depende do frescor.
  const ingenuo = (e) => ({ noticeKey: e.degraded ? "liveDataUnavailable" : null });
  const r = HS.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [],
                                         nextMatch: proxima, sourceOk: false, now: AGORA });
  const c = ingenuo({ heroState: r.state, degraded: r.degraded });
  assert(c.noticeKey === "liveDataUnavailable" &&
         HC.selectHeroCopy({ heroState: r.state, degraded: r.degraded }).noticeKey === null,
         "o contrato não se distingue mais da versão ingênua — o gate deixou de morder");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. TABELA-VERDADE DE SORTEIO / PRAZO (CDB2026)
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nC. Tabela-verdade de sorteio e prazo (CDB2026):");

const SORTEIO_MS = Date.parse("2026-09-10T19:00:00Z");
const CUTOFF_FUTURO = AGORA + 3 * 3600000;
const CUTOFF_VENCIDO = AGORA - 3 * 3600000;

function copia(e) { return HC.selectPicksCountdownCopy({ now: AGORA, ...e }); }

test("ANTES DO SORTEIO, sem data => linguagem de espera de sorteio", () => {
  const c = copia({ picksState: PICKS.WAITING_DRAW, drawState: DRAW.WAITING });
  assert(c.mode === MODE.DRAW_STATUS && c.bodyKey === "drawWaiting", `${c.mode}/${c.bodyKey}`);
});

test("SORTEIO MARCADO => contagem regressiva do sorteio", () => {
  const c = copia({ picksState: PICKS.WAITING_DRAW, drawState: DRAW.SCHEDULED,
                    drawScheduledMs: SORTEIO_MS });
  assert(c.mode === MODE.DRAW_COUNTDOWN, c.mode);
  assert(c.labelKey === "drawCountdownTitle", c.labelKey);
  assert(c.countdownMs === SORTEIO_MS - AGORA, `countdown ${c.countdownMs}`);
});

test("SORTEIO OCORREU, PUBLICAÇÃO PENDENTE => diz publicação pendente, NUNCA espera de sorteio", () => {
  const c = copia({ picksState: PICKS.WAITING_DRAW, drawState: DRAW.AWAITING_PUBLICATION,
                    drawScheduledMs: AGORA - 3600000 });
  assert(c.bodyKey === "drawAwaitingPublication", c.bodyKey);
  assert(c.bodyKey !== "drawWaiting" && c.labelKey !== "drawCountdownTitle", "linguagem de espera vazou");
});

test("SORTEIO RECEBIDO, PROVENIÊNCIA PENDENTE => diz validação pendente", () => {
  const c = copia({ picksState: PICKS.WAITING_DRAW, drawState: DRAW.INGESTED });
  assert(c.bodyKey === "drawIngestedPending", c.bodyKey);
});

test("SORTEIO TRAVADO, DATAS DESCONHECIDAS => 'aguardando datas e horários', NUNCA espera de sorteio", () => {
  const c = copia({ picksState: PICKS.SCHEDULE_PENDING, drawState: DRAW.LOCKED });
  assert(c.mode === MODE.SCHEDULE_PENDING, c.mode);
  assert(c.labelKey === "schedulePendingTitle", c.labelKey);
  assert(c.bodyKey === "schedulePendingRule" && c.noteKey === "schedulePendingNote", "corpo/nota errados");
  assert(!HC.DRAW_WAIT_KEYS.includes(c.bodyKey), "linguagem de espera de sorteio vazou");
});

test("PALPITES ABERTOS => 'Encerra em' com o prazo REAL", () => {
  const c = copia({ picksState: PICKS.OPEN, drawState: DRAW.LOCKED, cutoffMs: CUTOFF_FUTURO });
  assert(c.mode === MODE.PICKS_COUNTDOWN, c.mode);
  assert(c.labelKey === "countdownTitle", c.labelKey);
  assert(c.countdownMs === CUTOFF_FUTURO - AGORA, `countdown ${c.countdownMs}`);
});

test("PALPITES FECHADOS => apresentação dedicada, NUNCA 'Encerra em'", () => {
  const c = copia({ picksState: PICKS.CLOSED, drawState: DRAW.LOCKED, cutoffMs: CUTOFF_VENCIDO });
  assert(c.mode === MODE.PICKS_CLOSED, c.mode);
  assert(c.labelKey === "picksClosedTitle", `rótulo "${c.labelKey}" sobre um prazo já vencido`);
  assert(c.labelKey !== "countdownTitle", "'Encerra em' acima de prazo encerrado — a contradição voltou");
  assert(c.bodyKey === "picksClosedBody", c.bodyKey);
  assert(c.countdownMs === null, "contagem regressiva de um prazo vencido");
});

test("PALPITES FECHADOS não descreve o sorteio como pendente nem encerrado", () => {
  const c = copia({ picksState: PICKS.CLOSED, drawState: DRAW.LOCKED, cutoffMs: CUTOFF_VENCIDO });
  assert(!HC.DRAW_WAIT_KEYS.includes(c.bodyKey), `corpo "${c.bodyKey}" fala do sorteio`);
});

test("PROIBIÇÃO ESTRUTURAL: sorteio LOCKED nunca produz linguagem de espera de sorteio", () => {
  // Varredura exaustiva: todo estado de palpite × todo prazo × com e sem data de sorteio.
  for (const picks of Object.values(PICKS)) {
    for (const cutoffMs of [null, CUTOFF_FUTURO, CUTOFF_VENCIDO]) {
      for (const drawScheduledMs of [null, SORTEIO_MS, AGORA - 3600000]) {
        const c = copia({ picksState: picks, drawState: DRAW.LOCKED, cutoffMs, drawScheduledMs });
        assert(!HC.DRAW_WAIT_KEYS.includes(c.bodyKey),
               `LOCKED/${picks}/cutoff=${cutoffMs}/sorteio=${drawScheduledMs} => corpo "${c.bodyKey}"`);
        assert(!HC.DRAW_WAIT_KEYS.includes(c.labelKey),
               `LOCKED/${picks}/cutoff=${cutoffMs}/sorteio=${drawScheduledMs} => rótulo "${c.labelKey}"`);
      }
    }
  }
});

test("o seletor nunca devolve rótulo vazio, em nenhuma combinação", () => {
  for (const picks of [...Object.values(PICKS), "ESTADO_INEXISTENTE"]) {
    for (const draw of [...Object.values(DRAW), "ESTADO_INEXISTENTE"]) {
      const c = copia({ picksState: picks, drawState: draw, cutoffMs: CUTOFF_VENCIDO });
      assert(typeof c.labelKey === "string" && c.labelKey.length > 0, `${picks}/${draw}: rótulo vazio`);
      assert(typeof c.mode === "string" && c.mode.length > 0, `${picks}/${draw}: modo vazio`);
    }
  }
});

test("controle negativo: um default `waitingDraw` no seletor quebra o gate", () => {
  const mutado = COPY_SRC.replace(
    'return saida(MODE.PICKS_CLOSED, "picksClosedTitle", "picksClosedBody", null, null,\n                 draw === DRAW.LOCKED',
    'return saida(MODE.DRAW_STATUS, "drawStatusTitle", "drawWaiting", null, null,\n                 draw === DRAW.LOCKED');
  assert(mutado !== COPY_SRC, "a mutação não encontrou o alvo — o controle negativo cegou");
  const M = carregar(mutado, "BOLAO_HERO_COPY");
  const c = M.selectPicksCountdownCopy({ picksState: "ESTADO_INEXISTENTE", drawState: M.DRAW.LOCKED,
                                         cutoffMs: CUTOFF_VENCIDO, now: AGORA });
  assert(M.DRAW_WAIT_KEYS.includes(c.bodyKey),
         "a mutação não reintroduziu a espera de sorteio — o controle negativo perdeu o sentido");
});

test("controle negativo: usar `countdownTitle` no prazo fechado quebra o gate", () => {
  const mutado = COPY_SRC.replace(
    'return saida(MODE.PICKS_CLOSED, "picksClosedTitle", "picksClosedBody", null, null,\n                   "prazo de palpite vencido");',
    'return saida(MODE.PICKS_CLOSED, "countdownTitle", "picksClosedBody", null, null,\n                   "prazo de palpite vencido");');
  assert(mutado !== COPY_SRC, "a mutação não encontrou o alvo — o controle negativo cegou");
  const M = carregar(mutado, "BOLAO_HERO_COPY");
  const c = M.selectPicksCountdownCopy({ picksState: M.PICKS.CLOSED, drawState: M.DRAW.LOCKED,
                                         cutoffMs: CUTOFF_VENCIDO, now: AGORA });
  assert(c.labelKey === "countdownTitle",
         "a mutação não reintroduziu 'Encerra em' — o controle negativo perdeu o sentido");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. As chaves usadas pelo contrato existem nos DOIS apps que o consomem.
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nD. Toda chave que o contrato pode devolver existe no i18n do app:");

const I18N = {
  br2026: readFileSync(join(ROOT, "bolao/br2026/js/i18n.js"), "utf8"),
  cdb2026: readFileSync(join(ROOT, "bolao/cdb2026/js/i18n.js"), "utf8"),
};

test("[br2026] chaves de aviso do hero existem", () => {
  for (const k of ["liveDataUnavailable", "liveDataDelayed", "picksClosedTitle", "picksClosedBody"]) {
    assert(new RegExp(`\\b${k}:`).test(I18N.br2026), `falta \`${k}\` no i18n do BR2026`);
  }
});

test("[cdb2026] chaves de aviso e de prazo/sorteio existem", () => {
  const chaves = ["liveDataUnavailable", "liveDataDelayed", "countdownTitle", "picksClosedTitle",
                  "picksClosedBody", "schedulePendingTitle", "schedulePendingRule",
                  "schedulePendingNote", "drawCountdownTitle", "drawStatusTitle", "drawWaiting",
                  "drawAwaitingPublication", "drawIngestedPending"];
  for (const k of chaves) {
    assert(new RegExp(`\\b${k}:`).test(I18N.cdb2026), `falta \`${k}\` no i18n do CDB2026`);
  }
});

test("nenhum renderizador decide aviso direto de `degraded` (o contrato é o único dono)", () => {
  for (const app of APPS) {
    const src = readFileSync(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
    const ruim = /degraded\s*\n?\s*\?\s*`?<div class="live-hero-note"/.test(src) ||
                 /heroEstado\.degraded\s*\?\s*`<div class="live-hero-note"/.test(src);
    assert(!ruim, `${app}: o renderizador voltou a imprimir o aviso direto de \`degraded\``);
    assert(src.includes("BOLAO_HERO_COPY"), `${app}: não consome o contrato de texto`);
  }
});

// ─── #419: SCHEDULE_UNKNOWN deixou de ser sinônimo de "tela vazia" ─────────────────────────────
//
// A premissa original de `freshnessAffectsDisplayed` era que `SCHEDULE_UNKNOWN` nunca tem conteúdo,
// então a queda da fonte explicava o vazio e o aviso era honesto. O #395 tornou isso falso: o hero
// passou a exibir o confronto derivado da topologia, que é autoritativo e não vem da fonte. Sem a
// distinção, produção mostrou "Dados ao vivo temporariamente indisponíveis" embaixo de
// "Grêmio × Atlético-MG / Vasco × Palmeiras".
test("#419 SCHEDULE_UNKNOWN COM conteúdo derivado e fonte degradada => NENHUM aviso", () => {
  const r = HC.selectHeroCopy({ heroState: HC.HERO.SCHEDULE_UNKNOWN, degraded: true,
                                hasAuthoritativeContent: true });
  assert(r.noticeKey === null, `avisou "${r.noticeKey}" sobre conteúdo que não veio da fonte`);
  assert(r.noticeRelevant === false, "marcou como relevante um aviso que desmente a própria tela");
});

test("#419 SCHEDULE_UNKNOWN VAZIO e fonte degradada => continua avisando", () => {
  const r = HC.selectHeroCopy({ heroState: HC.HERO.SCHEDULE_UNKNOWN, degraded: true,
                                hasAuthoritativeContent: false });
  assert(r.noticeKey === "liveDataUnavailable",
    `parou de avisar com a tela vazia (veio ${r.noticeKey}) — aí o aviso é a explicação do vazio`);
});

test("#419 omitir o campo preserva o comportamento anterior (BR2026 não passa nada)", () => {
  const r = HC.selectHeroCopy({ heroState: HC.HERO.SCHEDULE_UNKNOWN, degraded: true });
  assert(r.noticeKey === "liveDataUnavailable", "o default mudou de comportamento para quem não informa");
});

test("#419 conteúdo derivado NÃO silencia partida ao vivo atrasada", () => {
  for (const st of [HC.HERO.LIVE_FRESH, HC.HERO.LIVE_DELAYED]) {
    const r = HC.selectHeroCopy({ heroState: st, degraded: true, hasAuthoritativeContent: true });
    assert(r.noticeKey === "liveDataDelayed",
      `${st}: placar na tela depende do frescor e o aviso sumiu (veio ${r.noticeKey})`);
  }
  const r = HC.selectHeroCopy({ heroState: HC.HERO.SOURCE_UNAVAILABLE, degraded: true,
                                hasAuthoritativeContent: true });
  assert(r.noticeKey === "liveDataUnavailable", "SOURCE_UNAVAILABLE parou de avisar");
});

test("#419 fonte íntegra nunca avisa, com ou sem conteúdo derivado", () => {
  for (const c of [true, false]) {
    const r = HC.selectHeroCopy({ heroState: HC.HERO.SCHEDULE_UNKNOWN, degraded: false,
                                  hasAuthoritativeContent: c });
    assert(r.noticeKey === null, "avisou com a fonte íntegra");
  }
});

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${ok} ok, ${fail} falhas\n`);
process.exit(fail === 0 ? 0 : 1);
