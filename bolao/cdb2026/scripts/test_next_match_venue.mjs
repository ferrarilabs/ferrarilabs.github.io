/**
 * test_next_match_venue.mjs — o LOCAL do jogo no card de próxima partida do CDB2026.
 *
 * ─── O DEFEITO (produção, 2026-09-03) ───────────────────────────────────────────────────────
 *
 * O card da volta das quartas — Grêmio × Internacional, evento ESPN 401909114 — não mostrava
 * "📍 Arena do Grêmio, Porto Alegre". Não era o renderizador: ele já imprimia o local quando
 * havia um. Era o DADO. Estado de produção lido na superfície normalizada:
 *
 *     [quartas] espn-gremio_internacional  second
 *       kickoff 2026-09-03T23:00:00+00:00   venue null   city null   status SCHEDULED
 *
 * As 8 pernas de `quartas` estavam com venue/city null; as de `oitavas`, não. A diferença é como
 * o confronto nasceu: oitavas veio da criação por ESPN (que grava local junto), quartas veio da
 * ingestão do sorteio oficial da CBF (`quartas-draw-2026.json`, que por desenho não tem estádio —
 * sorteia-se confronto, não local) e recebeu kickoff depois.
 *
 * E aí o LATCH: o backfill de agenda em `autoSyncEspn()` era guardado por `if (m.kickoff) return`,
 * então quem gravasse a data primeiro fixava o local no que soubesse naquele instante — para
 * sempre. O snapshot da ESPN carregava "Arena do Grêmio"/"Porto Alegre" desde 2026-08-22 e não
 * tinha por onde entrar.
 *
 * ─── AS DUAS CORREÇÕES QUE ESTE GATE PROTEGE ────────────────────────────────────────────────
 *
 *   1. o latch: o backfill passou a distinguir "falta agenda" de "tem agenda, falta local", e
 *      quando só falta o local NUNCA remarca o kickoff já gravado;
 *   2. o enriquecimento de apresentação (`withProviderSchedule()`): o descritor de partida passa
 *      a carregar venue/city/id vindos da observação que o app JÁ tem em memória — sem rede,
 *      sem gravar estado, e sem jamais contradizer um local já armazenado.
 *
 * Hermético: sem rede, sem provedor, sem participante. Lê o código-fonte real dos apps.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CDB = readFileSync(join(ROOT, "bolao", "cdb2026", "js", "app.js"), "utf8");
const BR = readFileSync(join(ROOT, "bolao", "br2026", "js", "app.js"), "utf8");

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

// `venueLineHtml` é idêntica nos dois apps de propósito (mesma linha, mesmo componente). Extrai a
// implementação REAL do CDB2026 e executa-a — nada de reimplementar a regra dentro do teste.
function extrairFuncao(src, nome) {
  const i = src.indexOf(`function ${nome}(`);
  A(i !== -1, `função ${nome}() não encontrada`);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

// Varreduras de isolamento olham CÓDIGO, nunca prosa (mesma técnica de test_where_to_watch.mjs):
// os comentários deste repo citam de propósito o que o código NÃO faz.
const soCodigo = src => src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map(l => l.split("//")[0]).join("\n");

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const venueLineHtml = new Function("esc", `${extrairFuncao(CDB, "locationText")}\n${extrairFuncao(CDB, "venueLineHtml")}; return venueLineHtml;`)(esc);
const gameCardVenueHtml = new Function("esc", `${extrairFuncao(CDB, "locationText")}\n${extrairFuncao(CDB, "gameCardVenueHtml")}; return gameCardVenueHtml;`)(esc);

console.log("\nCDB2026 — local (📍) no card de próxima partida\n");
console.log("A. Semântica da linha de local");

test("venue + city ⇒ os dois, na ordem 'estádio, cidade'", () => {
  const html = venueLineHtml({ venue: "Arena do Grêmio", city: "Porto Alegre" });
  A(html.includes("📍 Arena do Grêmio, Porto Alegre"),
    `caso de aceitação de produção falhou: ${html}`);
});

test("só venue ⇒ só o venue, sem vírgula solta", () => {
  const html = venueLineHtml({ venue: "Maracanã", city: null });
  A(html.includes("📍 Maracanã"), html);
  A(!html.includes(","), `vírgula sem cidade: ${html}`);
});

test("só city ⇒ NENHUMA linha (cidade sem estádio não é o que o card promete)", () => {
  A(venueLineHtml({ venue: null, city: "Porto Alegre" }) === "", "city sozinha virou linha");
});

test("nem venue nem city ⇒ nenhuma linha", () => {
  A(venueLineHtml({ venue: null, city: null }) === "", "linha vazia renderizada");
  A(venueLineHtml({}) === "", "objeto vazio renderizou linha");
  A(venueLineHtml(null) === "", "nulo renderizou linha");
});

test("não duplica quando a cidade já está dentro do nome do estádio", () => {
  const html = venueLineHtml({ venue: "Arena Porto Alegre", city: "Porto Alegre" });
  A(html.split("Porto Alegre").length - 1 === 1, `cidade impressa duas vezes: ${html}`);
});

test("placeholder 'A confirmar' não vira local (mesma guarda da Copa, referência visual)", () => {
  A(venueLineHtml({ venue: "A confirmar", city: "Porto Alegre" }) === "", "placeholder virou local");
});

test("o local é escapado (nome de estádio é dado de provedor, não literal de código)", () => {
  const html = venueLineHtml({ venue: '<img src=x onerror=alert(1)>', city: null });
  A(!html.includes("<img"), `HTML cru chegou ao DOM: ${html}`);
  A(html.includes("&lt;img"), `não escapou: ${html}`);
});

console.log("\nB. O 📍 é o padrão canônico — e agora é UMA implementação por app");

test("CDB2026: nenhum card monta a linha de local à mão (venueLineHtml / gameCardVenueHtml)", () => {
  const linha = CDB.match(/class="next-game-venue"/g) || [];
  A(linha.length === 1, `${linha.length} montagens de .next-game-venue — deveria haver só a de venueLineHtml()`);
  const chip = CDB.match(/class="game-card__venue pill"/g) || [];
  A(chip.length === 1, `${chip.length} montagens do chip — deveria haver só a de gameCardVenueHtml()`);
});

test("BR2026: idem — as três montagens à mão viraram uma só (regra de propagação)", () => {
  const soltos = BR.match(/class="next-game-venue"/g) || [];
  A(soltos.length === 1, `${soltos.length} montagens da linha — deveria haver só a de venueLineHtml()`);
  A(/function venueLineHtml\(/.test(BR), "BR2026 não recebeu o helper — propagação incompleta");
});

test("os dois apps imprimem o 📍, como a Copa do Mundo 2026 (hero-next-venue)", () => {
  for (const [nome, src] of [["cdb2026", CDB], ["br2026", BR]]) {
    A(extrairFuncao(src, "venueLineHtml").includes("📍"), `${nome}: linha de local sem o marcador canônico`);
  }
  A(extrairFuncao(CDB, "gameCardVenueHtml").includes("📍"), "cdb2026: chip da aba Jogos sem o marcador");
});

test("o chip da aba Jogos usa exatamente o MESMO texto da linha do card", () => {
  const loc = { venue: "Arena do Grêmio", city: "Porto Alegre" };
  const linha = venueLineHtml(loc), chip = gameCardVenueHtml(loc);
  A(linha.includes("Arena do Grêmio, Porto Alegre"), linha);
  A(chip.includes("Arena do Grêmio, Porto Alegre"), chip);
  A(venueLineHtml({}) === "" && gameCardVenueHtml({}) === "", "ausência tem de ser vazia nos dois");
});

test("a ordem do card é times → data/fase → 📍 local → 📺 onde assistir → countdown", () => {
  // No template do card primário do CDB2026 as duas linhas de enriquecimento vêm nesta ordem e
  // ANTES do bloco de countdown, que fecha `.next-game-info-block`.
  const bloco = CDB.slice(CDB.indexOf("function nextMatchBlockHtml"));
  const iVenue = bloco.indexOf("venueLineHtml(resolveLocation(");
  const iTv = bloco.indexOf("whereToWatchHtml(");
  const iTimer = bloco.indexOf("${timerHtml}");
  A(iVenue !== -1 && iTv !== -1 && iTimer !== -1, "template do card primário não reconhecido");
  A(iVenue < iTv, "📺 antes de 📍");
  A(iTv < iTimer, "countdown antes do enriquecimento");
});

console.log("\nC. NENHUMA escrita nova — reparar dado não pode ser efeito de renderizar");

// Rascunhei primeiro a correção "certa" (desfazer o latch de `if (m.kickoff) return` em
// autoSyncEspn) e ela funcionava. Mas autoSyncEspn() só roda dentro de renderAdmin(): abrir a tela
// de admin passaria a REPARAR dado de produção como efeito colateral. Gatilho implícito, e quem
// renderiza não pode ser quem migra. O local passou a ser resolvido inteiramente na LEITURA, e os
// dois escritores de estado voltaram a ser byte-a-byte (em código) o que já estava em `main`.
function grabAsync(src, nome) {
  const i = src.indexOf(`async function ${nome}(`);
  A(i !== -1, `${nome}() não encontrada`);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

// Toda função deste app que chega a `saveState` — é nelas que uma escrita nova apareceria.
const ESCRITORES = ["autoSyncEspn", "autoSyncEspnResults"];

test("nenhum escritor de estado consulta o enriquecimento de leitura", () => {
  // Esta é a barreira que impede a correção de voltar a ser uma gravação: se `resolveLocation` ou
  // `providerScheduleFor` aparecerem dentro de um caminho que grava, o local persistido volta a
  // depender de alguém abrir uma tela.
  for (const nome of ESCRITORES) {
    const corpo = soCodigo(grabAsync(CDB, nome));
    for (const p of ["resolveLocation", "providerScheduleFor", "withProviderSchedule", "locationText"]) {
      A(!corpo.includes(p), `${nome}() referencia \`${p}\` — enriquecimento de leitura vazou para o caminho de escrita`);
    }
  }
});

test("os escritores só gravam agenda em perna SEM data (nenhuma escrita nova de local)", () => {
  const corpo = soCodigo(grabAsync(CDB, "autoSyncEspn"));
  // Uma única atribuição de `venue:` no corpo inteiro: a do bloco que preenche perna sem kickoff,
  // que já existia. Uma segunda seria exatamente a gravação que este branch não pode ter.
  const venues = (corpo.match(/\bvenue:/g) || []).length;
  A(venues === 2, `${venues} atribuições de venue: em autoSyncEspn — esperadas 2 (criação de confronto + backfill sem data)`);
  A(!/saveState\(/.test(soCodigo(extrairFuncao(CDB, "resolveLocation"))), "resolveLocation grava");
});

test("o backfill de agenda continua saindo em perna que já tem data (latch preservado de propósito)", () => {
  A(/if \(!m \|\| m\.kickoff \|\| m\.goalsHome != null\) return;/.test(CDB),
    "a guarda original sumiu — abrir o admin voltaria a gravar local");
  A(!/faltaLocal/.test(CDB), "sobrou resíduo da tentativa de backfill de local no caminho de escrita");
});

test("o caminho de LEITURA não grava nada em lugar nenhum", () => {
  const leitura = [extrairFuncao(CDB, "providerScheduleFor"), extrairFuncao(CDB, "withProviderSchedule"),
                   extrairFuncao(CDB, "resolveLocation"), extrairFuncao(CDB, "locationText"),
                   extrairFuncao(CDB, "venueLineHtml"), extrairFuncao(CDB, "gameCardVenueHtml")]
                   .map(soCodigo).join("\n");
  for (const p of ["saveState", "localStorage", "sessionStorage", "supabase", "mutation", "fetch(", "XMLHttpRequest"]) {
    A(!leitura.includes(p), `o caminho de leitura referencia \`${p}\` — ele só resolve apresentação`);
  }
});

test("resolveLocation(): o local ARMAZENADO vence o do provedor", () => {
  const fn = soCodigo(extrairFuncao(CDB, "resolveLocation"));
  A(/const stored = m && m\.venue/.test(fn), "não prioriza o armazenado");
  A(fn.indexOf("stored") < fn.indexOf("providerScheduleFor"), "consulta o provedor antes do armazenado");
});

test("as TRÊS superfícies de local passam pelo mesmo resolvedor de leitura", () => {
  // Só CHAMADAS (dentro de um renderizador de local), nunca a própria definição.
  const usos = (CDB.match(/Html\(resolveLocation\(m, home, away\)\)/g) || []).length;
  A(usos === 3, `${usos} chamadas — esperadas 3 (card primário, lista de hoje, aba Jogos)`);
});

console.log("\nD. Enriquecimento de apresentação — sem rede, sem estado, sem segunda fonte");

test("providerScheduleFor() lê a observação JÁ carregada, não faz rede própria", () => {
  const fn = extrairFuncao(CDB, "providerScheduleFor");
  A(fn.includes("_liveStore"), "não lê o store compartilhado — de onde viria o local?");
  for (const p of ["fetch(", "XMLHttpRequest", "WebSocket", "MutationObserver", "setInterval", "setTimeout"]) {
    A(!fn.includes(p), `o enriquecimento referencia \`${p}\` — ele não pode buscar nada`);
  }
});

test("o enriquecimento NUNCA grava estado", () => {
  const fn = extrairFuncao(CDB, "providerScheduleFor") + extrairFuncao(CDB, "withProviderSchedule");
  for (const p of ["saveState", "localStorage", "supabase", "mutation"]) {
    A(!fn.includes(p), `o enriquecimento referencia \`${p}\` — ele é só apresentação`);
  }
});

test("local ARMAZENADO vence o do provedor (o provedor só preenche buraco)", () => {
  A(/const venue = m\.venue \|\| extra\.venue \|\| null;/.test(CDB),
    "o provedor pode estar sobrescrevendo um local curado pelo admin");
  A(/const city\s*=\s*m\.city\s*\|\| extra\.city\s*\|\| null;/.test(CDB), "idem para a cidade");
});

test("fail safe: sem store/observação/casamento, o descritor volta INTACTO", () => {
  const fn = extrairFuncao(CDB, "withProviderSchedule");
  A(/if \(!extra\) return desc;/.test(fn), "sem enriquecimento o descritor tem de ser o mesmo objeto");
  A(extrairFuncao(CDB, "providerScheduleFor").includes("catch"), "erro no enriquecimento pode derrubar o card");
});

test("casa pelos DOIS times COM o mando no lado certo — ida e volta não se confundem", () => {
  const fn = extrairFuncao(CDB, "providerScheduleFor");
  A(fn.includes("m.homeTeam") && fn.includes("m.awayTeam"), "não compara os dois lados");
  A(/!==\s*home/.test(fn) && /!==\s*away/.test(fn), "não exige mandante e visitante nas posições certas");
});

test("os dois construtores de descritor enriquecem — hero E lista de jogos de hoje", () => {
  A(/return best \? withProviderSchedule\(best\) : null;/.test(CDB),
    "findNextUpcomingMatch() (hero) sem enriquecimento");
  A(/all\.push\(withProviderSchedule\(\{/.test(CDB),
    "findAllUpcomingMatchesOnNextDay() (lista) sem enriquecimento");
});

test("jogos SIMULTÂNEOS são enriquecidos um a um — cada um com o seu local", () => {
  // O enriquecimento acontece dentro do `map`/`push` por partida, nunca uma vez por dia: dois
  // jogos no mesmo minuto casam com eventos distintos porque a chave inclui os dois times.
  const i = CDB.indexOf("all.push(withProviderSchedule({");
  A(i !== -1, "o enriquecimento saiu de dentro do laço por partida");
  const antes = CDB.slice(i - 900, i);
  A(antes.includes("legsForFormat"), "o enriquecimento não está mais por perna/partida");
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ CDB NEXT MATCH VENUE FAILED" : "✓ CDB NEXT MATCH VENUE OK");
process.exit(fail ? 1 : 0);
