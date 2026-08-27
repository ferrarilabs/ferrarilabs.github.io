/**
 * test_hero_always_mounted.mjs — o invariante do #246, provado.
 *
 * O que se prova aqui NÃO é que o hero mostra a coisa certa. É que ele **EXISTE**, em toda
 * combinação de falha de provedor que já derrubou a produção — e em várias que ainda não
 * derrubaram. O conteúdo é secundário; a presença é o invariante.
 *
 * Determinístico e hermético: sem rede, sem ESPN, sem gateway, sem relógio implícito. Se este
 * teste algum dia precisar de internet para passar, ele deixou de ser o gate que o #246 pediu.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC_PATH = join(ROOT, "bolao/shared/js/football_hero_state.js");
const SRC = readFileSync(SRC_PATH, "utf8");

/** Carrega o IIFE de navegador num escopo isolado, como o browser faz. */
function carregar(fonte = SRC) {
  const escopo = {};
  new Function("globalThis", "window", fonte).call(escopo, escopo, escopo);
  return escopo.BOLAO_FOOTBALL_HERO;
}

const H = carregar();
const { HERO } = H;

let ok = 0, fail = 0;
function test(nome, fn) {
  try { fn(); console.log(`  ✓ ${nome}`); ok++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

const AGORA = Date.parse("2026-08-27T01:00:00Z");
const jogoAoVivo = { id: "1", homeTeam: "Cruzeiro", awayTeam: "Atlético-MG", homeScore: 1, awayScore: 1 };
const proxima    = { id: "2", homeTeam: "Vasco", awayTeam: "Vitória", kickoff: "2026-09-02T23:30:00Z" };
const finalHaPouco = { id: "3", homeTeam: "Palmeiras", awayTeam: "Santos", kickoff: "2026-08-27T00:00:00Z" };

/** Toda saída, em qualquer cenário, tem de satisfazer isto. */
function invariante(r, rotulo) {
  assert(r.visible === true, `${rotulo}: hero NÃO visível — este é o defeito do #246`);
  assert(typeof r.state === "string" && r.state.length > 0, `${rotulo}: sem estado semântico`);
  assert(typeof r.reason === "string" && r.reason.length > 0, `${rotulo}: sem motivo legível`);
}

console.log("\n#246 — o hero existe em TODA falha de provedor\n");
console.log("A. Matriz de falha (o hero tem de sobreviver a cada uma):");

const MATRIZ = [
  ["gateway 200 + jogo ao vivo",
   { liveState: "LIVE_FRESH", liveMatches: [jogoAoVivo], sourceOk: true }, HERO.LIVE_FRESH],
  ["gateway 200 + sem jogo + próxima conhecida",
   { liveState: "NO_LIVE_MATCH", liveMatches: [], nextMatch: proxima, sourceOk: true }, HERO.UPCOMING],
  ["gateway 503 SOURCE_UNAVAILABLE",
   { liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false }, HERO.UPCOMING],
  ["timeout de rede",
   { liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false }, HERO.UPCOMING],
  ["payload inválido do gateway",
   { liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false }, HERO.UPCOMING],
  ["cache além do limiar crítico, com jogo ao vivo",
   { liveState: "LIVE_CRITICAL_STALE", liveMatches: [jogoAoVivo], sourceOk: true }, HERO.LIVE_DELAYED],
  ["offline / sem rede",
   { liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false }, HERO.UPCOMING],
  ["snapshot disponível, gateway fora",
   { liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false }, HERO.UPCOMING],
  ["sem ao vivo E sem calendário conhecido",
   { liveState: "NO_LIVE_MATCH", liveMatches: [], sourceOk: true }, HERO.SCHEDULE_UNKNOWN],
  ["fonte fora E sem calendário conhecido",
   { liveState: "SOURCE_UNAVAILABLE", liveMatches: [], sourceOk: false }, HERO.SOURCE_UNAVAILABLE],
];

for (const [rotulo, entrada, esperado] of MATRIZ) {
  test(`${rotulo} ⇒ hero VISÍVEL (${esperado})`, () => {
    const r = H.deriveFootballHeroState({ ...entrada, now: AGORA });
    invariante(r, rotulo);
    assert(r.state === esperado, `estado ${r.state}, esperado ${esperado}`);
  });
}

console.log("\nB. Transições — o hero NUNCA pisca entre estados:");

test("LIVE_FRESH → LIVE_STALE → LIVE_CRITICAL_STALE: sempre visível, mesma partida", () => {
  const ids = [];
  for (const s of ["LIVE_FRESH", "LIVE_STALE", "LIVE_CRITICAL_STALE"]) {
    const r = H.deriveFootballHeroState({ liveState: s, liveMatches: [jogoAoVivo], sourceOk: true, now: AGORA });
    invariante(r, s);
    assert(r.matches.length === 1, `${s}: perdeu a partida`);
    ids.push(r.matches[0].id);
  }
  assert(new Set(ids).size === 1, "a identidade da partida mudou durante a degradação de frescor");
});

test("LIVE → FINAL → UPCOMING: nenhum estado intermediário sem hero", () => {
  const seq = [
    { liveState: "LIVE_FRESH", liveMatches: [jogoAoVivo], sourceOk: true },
    { liveState: "FINAL", liveMatches: [], recentResult: finalHaPouco, sourceOk: true },
    { liveState: "NO_LIVE_MATCH", liveMatches: [], nextMatch: proxima, sourceOk: true },
  ];
  for (const [i, entrada] of seq.entries()) invariante(H.deriveFootballHeroState({ ...entrada, now: AGORA }), `passo ${i}`);
});

test("falhas consecutivas de polling: o hero permanece montado em todas", () => {
  for (let i = 0; i < 10; i++) {
    invariante(H.deriveFootballHeroState({
      liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false, now: AGORA + i * 60000,
    }), `falha ${i + 1}`);
  }
});

console.log("\nC. Honestidade — degradado nunca vira invenção:");

test("fonte fora NUNCA fabrica confronto, placar ou minuto", () => {
  const r = H.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [], sourceOk: false, now: AGORA });
  invariante(r, "fonte fora");
  assert(r.matches.length === 0, "inventou partida ao vivo");
  assert(r.nextMatch === null, "inventou próxima partida");
  assert(r.recentResult === null, "inventou resultado");
  assert(r.degraded === true, "não sinalizou degradação");
});

test("degradação é sinalizada quando a fonte falha, mesmo com conteúdo local", () => {
  const r = H.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false, now: AGORA });
  assert(r.state === HERO.UPCOMING, r.state);
  assert(r.degraded === true, "conteúdo local não isenta de dizer que a fonte está fora");
});

test("final antigo demais não segura o hero no passado", () => {
  const antigo = { ...finalHaPouco, kickoff: "2026-08-20T00:00:00Z" };
  const r = H.deriveFootballHeroState({ liveState: "NO_LIVE_MATCH", liveMatches: [], recentResult: antigo, nextMatch: proxima, sourceOk: true, now: AGORA });
  assert(r.state === HERO.UPCOMING, `mostrou final de uma semana atrás: ${r.state}`);
});

console.log("\nD. Controles negativos — a mutação TEM de ser pega:");

function mutacao(nome, de, para, checa) {
  const mutado = SRC.replace(de, para);
  assert(mutado !== SRC, `a mutação '${nome}' não alterou nada`);
  let passou = false;
  try { checa(carregar(mutado)); passou = true; } catch { /* pego, como esperado */ }
  assert(!passou, `CONTROLE NEGATIVO: '${nome}' passou despercebida`);
}

test("mutação (SOURCE_UNAVAILABLE esconde o hero) é reprovada", () => {
  mutacao("esconder em SOURCE_UNAVAILABLE",
    "      visible: true,", "      visible: e.sourceOk !== false,",
    (M) => {
      const r = M.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [], sourceOk: false, now: AGORA });
      invariante(r, "mutado");
    });
});

test("mutação (sem jogo ao vivo ⇒ esconde) é reprovada", () => {
  mutacao("esconder sem jogo ao vivo",
    "      visible: true,", "      visible: (e.liveMatches || []).length > 0,",
    (M) => {
      const r = M.deriveFootballHeroState({ liveState: "NO_LIVE_MATCH", liveMatches: [], nextMatch: proxima, sourceOk: true, now: AGORA });
      invariante(r, "mutado");
    });
});

test("mutação (falha de fetch limpa o conteúdo) é reprovada", () => {
  mutacao("limpar conteúdo em falha",
    "      nextMatch: proxima,", "      nextMatch: e.sourceOk === false ? null : proxima,",
    (M) => {
      const r = M.deriveFootballHeroState({ liveState: "SOURCE_UNAVAILABLE", liveMatches: [], nextMatch: proxima, sourceOk: false, now: AGORA });
      assert(r.nextMatch !== null, "a próxima partida foi apagada por falha de fonte");
    });
});

console.log("\nE. Nenhum caminho de ocultação sobreviveu no próprio módulo:");

test("o módulo não contém nenhuma via de esconder o hero", () => {
  const codigo = SRC.replace(/\/\*\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");
  for (const proibido of ["classList", "display", "innerHTML", "hidden", "remove()"]) {
    assert(!codigo.includes(proibido),
      `a política referencia \`${proibido}\` — ela decide ESTADO, nunca toca no DOM`);
  }
  // `\s*` casa ZERO espacos, entao o lookahead disparava logo apos os dois-pontos, antes do
  // espaco -- e acusava a linha correta. O quantificador vai DENTRO do lookahead.
  assert(!/visible:(?!\s*true\b)/.test(codigo), "`visible` tem de ser literalmente true, sempre");
  assert(/visible:\s*true\b/.test(codigo), "o campo `visible` sumiu do modulo");
});

console.log("\nF. O renderizador de cada app: nenhum helper inexistente, nenhum hero vazio:");

import { readFileSync as _rf } from "node:fs";

const APPS = [
  ["br2026", "renderHeroSemAoVivo", "liveMatchCard"],
  ["cdb2026", "renderHeroSemAoVivo", "liveTieCard"],
];

for (const [app, fn, cardId] of APPS) {
  const fonte = _rf(join(ROOT, `bolao/${app}/js/app.js`), "utf8");

  test(`${app}: todo helper chamado por ${fn} existe neste app`, () => {
    const i = fonte.indexOf(`function ${fn}`);
    assert(i > 0, `${fn} nao encontrada em ${app}`);
    const corpo = fonte.slice(i, fonte.indexOf("\nfunction ", i + 10));
    const semTexto = corpo.replace(/\/\*\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");
    // So chamadas LIVRES. `x.getTime()` e metodo de objeto e nao se resolve por escopo de modulo;
    // incluir metodos fazia o gate acusar `getTime` como "helper inexistente", que e ruido -- e um
    // gate ruidoso e um gate que alguem desliga. O `(?<![.\w$])` descarta o que vem apos ponto.
    const chamadas = [...semTexto.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
    const embutidas = new Set(["if", "for", "while", "switch", "catch", "return", "typeof",
                               "function", "String", "Number", "Boolean", "Date", "Array", "Object"]);
    for (const c of new Set(chamadas)) {
      if (embutidas.has(c)) continue;
      const definida = new RegExp(`(function\\s+${c}\\b|const\\s+${c}\\s*=|let\\s+${c}\\s*=|var\\s+${c}\\s*=)`).test(fonte);
      assert(definida,
        `${app}: \`${c}()\` e chamada mas NAO existe neste app — foi assim que o hero do BR2026 ` +
        `ficou montado e VAZIO em producao (formatBrtTimestamp so existe no CDB2026)`);
    }
  });

  test(`${app}: o hero nunca pode terminar com innerHTML vazio`, () => {
    const i = fonte.indexOf(`const card = $("${cardId}")`);
    assert(i > 0, `${cardId} nao encontrado em ${app}`);
    // Janela ampliada: o comentario que explica a saude da fonte empurrou o `try` para alem
    // dos 4000 caracteres originais. A protecao nao mudou de lugar; a janela e que era curta.
    const trecho = fonte.slice(i, i + 8000);
    assert(/try\s*\{[^}]*renderHeroSemAoVivo/.test(trecho.replace(/\n/g, " ")),
      `${app}: a montagem do conteudo do hero nao esta protegida — uma excecao de formatacao ` +
      `deixaria o hero montado e vazio, que e o buraco que o #246 proibe`);
    assert(/html\s*&&\s*html\.trim\(\)/.test(trecho) || /fallback/i.test(trecho),
      `${app}: nao ha fallback para conteudo vazio`);
  });
}

console.log("\nG. Honestidade sobre FRESCOR: dado velho tem de se declarar velho");

import { readFileSync as _rf2 } from "node:fs";

for (const app of ["cdb2026", "br2026"]) {
  const fonte = _rf2(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");

  test(`${app}: o sinal DEDICADO de degradacao consulta a saude do gateway`, () => {
    assert(/function fonteEstaDegradada/.test(codigo),
      `${app}: nao ha sinal dedicado — sobrecarregar \`sourceOk\` quebra a RETENCAO: com gateway ` +
      `fora e snapshot utilizavel a partida some da tela em vez de continuar como dado velho`);
    assert(/gatewayStatus === "DEGRADED"/.test(codigo) && /gatewayStatus === "UNREACHABLE"/.test(codigo),
      `${app}: o gateway pode falhar e o store cair para o snapshot; testar so um estado deixa o ` +
      `hero anunciar frescor que ele nao tem. Medido em producao com jogo AO VIVO invisivel`);
  });

  test(`${app}: a apresentacao NAO usa o mesmo sinal da retencao`, () => {
    assert(/sourceOk: !fonteEstaDegradada\(\)/.test(codigo),
      `${app}: a apresentacao tem de usar o sinal dedicado, nao o de ciclo de vida`);
  });

  test(`${app}: o sinal dedicado consulta a IDADE da observacao`, () => {
    assert(/CRITICAL_STALE_AFTER_MS/.test(codigo),
      `${app}: sem checar idade, uma observacao de 13 horas e apresentada como atual`);
    assert(/st\.ageMs > critico/.test(codigo), `${app}: a idade nao e comparada ao limiar critico`);
  });

  test(`${app}: o limiar vem do contrato compartilhado, nao e numero solto`, () => {
    assert(/BOLAO_FOOTBALL_LIVE.*CRITICAL_STALE_AFTER_MS/.test(codigo),
      `${app}: um limiar proprio seria uma terceira fonte de verdade sobre frescor`);
  });
}

test("CENARIO REAL 2026-08-27: gateway fora + snapshot velho ⇒ hero DEGRADADO", () => {
  // Gremio x Internacional estava ao vivo aos 11'. O gateway devolvia UPSTREAM_403, o store caiu
  // para um snapshot de 13,6h, e o hero anunciava `degraded: false`.
  const r = H.deriveFootballHeroState({
    liveState: "NO_LIVE_MATCH", liveMatches: [], nextMatch: proxima,
    sourceOk: false,            // <- o que a correcao passa a produzir
    now: AGORA,
  });
  invariante(r, "cenario real");
  assert(r.degraded === true,
    "o hero apresentaria dado de 13 horas como atual, sem nenhum sinal — pior que nao mostrar, " +
    "porque some com a duvida");
  assert(r.state === HERO.UPCOMING, r.state);
});

test("mutacao (voltar a testar so um estado) e pega", () => {
  const fonte = _rf2(join(ROOT, "bolao/cdb2026/js/app.js"), "utf8");
  const mutado = fonte.replace(/if \(_liveHealth && \(_liveHealth\.gatewayStatus === "DEGRADED" \|\|[\s\S]*?return false;/, "");
  assert(mutado !== fonte, "a mutacao nao alterou nada");
  assert(!/gatewayStatus === "DEGRADED"/.test(mutado),
    "CONTROLE NEGATIVO: remover a checagem de saude do gateway deveria ser visivel");
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ HERO ALWAYS MOUNTED FAILED" : "✓ HERO ALWAYS MOUNTED OK");
process.exit(fail ? 1 : 0);
