/**
 * test_where_to_watch.mjs — o "Onde assistir" é enriquecimento, e tem de continuar sendo.
 *
 * O que se prova aqui é sobretudo o que a feature NÃO pode fazer: não inventar canal, não quebrar
 * o card quando não sabe, não aparecer duas vezes, não depender de rede e não tocar em nada que
 * decide partida ou countdown. A prova mais importante é a de REMOVIBILIDADE — se apagar este
 * módulo não devolve os apps ao estado anterior, a feature não é opcional de verdade.
 *
 * Hermético: sem rede, sem provedor, sem participante.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MOD = join(ROOT, "bolao", "shared", "js", "where_to_watch.js");

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

// Carrega o IIFE como o navegador faria: sem import/export, só um global.
const src = readFileSync(MOD, "utf8");
const root = {};
new Function("window", `${src}`).call(root, root);
const W = root.BOLAO_WHERE_TO_WATCH;

// As varreduras de isolamento abaixo olham CODIGO, nunca prosa: o cabecalho do modulo cita
// `MutationObserver` e `scoring` justamente para dizer que nao os usa, e um gate que lesse o
// comentario reprovaria a documentacao correta. Mesma tecnica de test_pipeline_monitor.mjs.
const codigo = src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map(l => l.split("//")[0]).join("\n");

console.log("\nOnde assistir — enriquecimento opcional\n");
console.log("A. Contrato de fail safe");

test("sem transmissão conhecida ⇒ string vazia (o card fica idêntico ao de antes)", () => {
  A(W.lineHtml({ id: "000", kickoff: "2026-12-01T20:00Z", home: "X", away: "Y" }) === "", "");
});

test("descritor nulo/vazio/incompleto ⇒ vazio, nunca lança", () => {
  for (const m of [null, undefined, {}, { id: null }, { kickoff: "nao-e-data" }, { home: "A" }]) {
    A(W.lineHtml(m) === "", `lançou ou devolveu conteúdo para ${JSON.stringify(m)}`);
  }
});

test("data ilegível não vira casamento por acaso", () => {
  A(W.lineHtml({ kickoff: "banana", home: "Santos", away: "Palmeiras" }) === "",
    "sem minuto de início não se pode afirmar que é a mesma partida");
});

console.log("\nB. Chave de associação");

test("BR2026 casa pelo id do evento ESPN (chave forte)", () => {
  const html = W.lineHtml({ id: "401913077", kickoff: "2026-09-02T22:30Z", home: "Flamengo", away: "Mirassol" });
  A(/Premiere/.test(html), html);
  A(!/Globo/.test(html), "direito geral de competição não é confirmação: este jogo é Premiere exclusivo");
});

test("id vence mesmo se o nome do time chegar diferente", () => {
  A(/Premiere/.test(W.lineHtml({ id: "401913077", home: "CR Flamengo", away: "Mirassol FC" })), "");
});

test("CDB2026 (sem id) casa por minuto de início + os DOIS times", () => {
  A(/sportv/.test(W.lineHtml({ kickoff: "2026-09-03T00:30Z", home: "Santos", away: "Palmeiras" })), "");
});

test("normalização de nome: 'Vasco' casa com 'Vasco da Gama', acento não importa", () => {
  A(/Premiere/.test(W.lineHtml({ kickoff: "2026-09-03T00:30Z", home: "Vitoria", away: "Vasco da Gama" })),
    "os dois apps normalizam nomes de formas diferentes; a chave tem de aguentar isso");
});

test("mesmo minuto, times de OUTRO confronto ⇒ vazio (não vaza entre jogos simultâneos)", () => {
  A(W.lineHtml({ kickoff: "2026-09-03T00:30Z", home: "Santos", away: "Vasco" }) === "",
    "casou um confronto que não existe — a chave está frouxa demais");
});

test("minuto diferente ⇒ vazio, mesmo com os times certos", () => {
  A(W.lineHtml({ kickoff: "2026-09-10T00:30Z", home: "Santos", away: "Palmeiras" }) === "", "");
});

console.log("\nC. Saída");

test("renderiza UMA linha só, e uma chamada repetida devolve o mesmo (idempotente)", () => {
  const m = { id: "401909110" };
  const a = W.lineHtml(m), b = W.lineHtml(m);
  A(a === b, "chamada repetida divergiu");
  A((a.match(/where-to-watch"/g) || []).length === 1, `linha duplicada: ${a}`);
  A((a.match(/Onde assistir/g) || []).length === 1, `rótulo duplicado: ${a}`);
});

test("HTML é escapado pelo próprio módulo (não depende do esc() de nenhum app)", () => {
  const injetado = { espnId: "TEST-XSS", kickoffUtc: "2027-01-01T00:00Z", home: "A", away: "B",
                     channels: ['<img src=x onerror=alert(1)>'] };
  W.BROADCASTS.push(injetado);
  try {
    const html = W.lineHtml({ id: "TEST-XSS" });
    A(!/<img/.test(html), `markup cru vazou: ${html}`);
    A(/&lt;img/.test(html), `não escapou: ${html}`);
  } finally { W.BROADCASTS.pop(); }
});

test("TV aberta regional é dita de forma honesta, não como cobertura nacional", () => {
  const html = W.lineHtml({ id: "401909111" });
  A(!/Globo/.test(html) || /consulte sua regi/i.test(html),
    "Globo aparece sem a ressalva de praça — isso afirma mais do que a fonte diz");
});

test("todo registro tem canais e fonte — nada entra sem procedência", () => {
  for (const b of W.BROADCASTS) {
    A(Array.isArray(b.channels) && b.channels.length, `${b.espnId} sem canais`);
    A(b.source && b.source.length > 8, `${b.espnId} sem fonte registrada`);
    A(b.espnId || (b.kickoffUtc && b.home && b.away), `${b.espnId} sem chave utilizável`);
  }
});

console.log("\nD. Isolamento — a feature tem de ser removível");

test("o módulo não faz rede: sem fetch/XHR/WebSocket/observer/timer", () => {
  for (const p of ["fetch(", "XMLHttpRequest", "WebSocket", "MutationObserver", "setInterval", "setTimeout", "import("]) {
    A(!codigo.includes(p), `o módulo referencia \`${p}\` — ele não precisa de nada disso`);
  }
});

test("o módulo não toca em nada que decide partida, placar, tempo ou dinheiro", () => {
  const proibidos = ["nextUpcomingGame", "countdownTimerHtml", "fetchSchedule", "_schedule",
                     "supabase", "BOLAO_FOOTBALL_LIVE", "scoring", "localStorage", "sessionStorage"];
  for (const p of proibidos) A(!codigo.includes(p), `o módulo referencia \`${p}\``);
});

test("os apps só o consomem por trás de um guard — ausência do módulo é inofensiva", () => {
  for (const app of ["br2026", "cdb2026"]) {
    const appSrc = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
    const helper = appSrc.match(/function whereToWatchHtml\([^)]*\)\s*\{[\s\S]{0,320}?\n\}/);
    A(helper, `${app}: helper não encontrado`);
    A(/window\.BOLAO_WHERE_TO_WATCH/.test(helper[0]) && /return M \?/.test(helper[0]),
      `${app}: o helper precisa devolver "" quando o módulo não está carregado`);
    // Nenhuma chamada direta ao módulo fora do helper: um único ponto de falha, guardado.
    const diretas = (appSrc.match(/BOLAO_WHERE_TO_WATCH/g) || []).length;
    A(diretas === 1, `${app}: ${diretas} referências ao módulo — deveria haver só a do helper`);
  }
});

test("o `?v=` do módulo é gerido pelo bot (achado F18: compartilhado sem tag fica preso em cache)", () => {
  const cb = readFileSync(join(ROOT, "bolao", "scripts", "cachebust.mjs"), "utf8");
  A(cb.includes('"../shared/js/where_to_watch.js"'),
    "o arquivo saiu de SHARED_FILES — uma atualização de transmissão não chegaria ao navegador");
  for (const app of ["br2026", "cdb2026"]) {
    const html = readFileSync(join(ROOT, "bolao", app, "index.html"), "utf8");
    A(/where_to_watch\.js\?v=[a-f0-9]+/.test(html), `${app}: script sem ?v=`);
  }
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ WHERE TO WATCH FAILED" : "✓ WHERE TO WATCH OK");
process.exit(fail ? 1 : 0);
