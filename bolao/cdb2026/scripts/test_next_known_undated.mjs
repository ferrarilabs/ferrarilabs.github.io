/**
 * test_next_known_undated.mjs — o confronto CONHECIDO que ainda não tem data (#395)
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────────────────────
 *
 * `findNextUpcomingMatch()` exige `m.kickoff` futuro. Quando as quartas acabaram e a CBF ainda não
 * publicou a tabela da semifinal, ele devolve `null` e o hero imprime "Próxima partida ainda não
 * disponível". Isso é FALSO: a partida é conhecida — falta a data. E o próprio site já a mostra na
 * aba Jogos ("Vasco × Palmeiras"), então duas telas do mesmo produto se contradizem.
 *
 * ─── O QUE ESTE GATE PROTEGE, E POR QUE QUASE TUDO AQUI É UMA NEGAÇÃO ────────────────────────
 *
 * A correção é de APRESENTAÇÃO e o risco dela é inventar informação para preencher a tela: uma data
 * que a CBF não publicou, um contador para essa data, um estádio, uma emissora, ou um clube em uma
 * vaga que ainda depende de um jogo. Qualquer um dos cinco apareceria ao participante com a mesma
 * cara de fato. Por isso a maioria das asserções abaixo verifica AUSÊNCIA.
 *
 * Hermético: sem rede, sem DOM, sem estado de produção. Extrai e executa as funções REAIS do
 * `app.js` — não reimplementa a regra dentro do teste, que é como um gate passa a proteger a sua
 * própria cópia em vez do produto.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = readFileSync(join(ROOT, "bolao", "cdb2026", "js", "app.js"), "utf8");

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

function corpo(nome) {
  const i = SRC.indexOf(`function ${nome}(`);
  A(i !== -1, `função ${nome}() não encontrada em app.js`);
  let d = 0, dentro = false, j = i;
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") { d++; dentro = true; }
    else if (SRC[j] === "}") { d--; if (dentro && d === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}

const FUNCS = ["topologyProvenanceIsValid", "tieQualifiedTeam", "resolveParticipant", "participantLabel",
               "tieDisplayName", "derivedPhaseView", "findNextKnownUndatedPhase",
               "nextMatchBlockHtml"];

const TEXTOS = { winnerOfPrefix: "Vencedor de", toBeDefined: "A definir",
                 nextGameLabel: "Próxima partida", schedulePendingTitle: "Aguardando datas e horários" };

const CONST_TOPO = (SRC.match(/^const TOPOLOGY_REQUIRED_FIELDS = .*$/m) || [])[0];
A(CONST_TOPO, "TOPOLOGY_REQUIRED_FIELDS não encontrada em app.js");

const sandbox = new Function(`
  ${CONST_TOPO}
  const DATA = { phases: [ {id:"oitavas",name:"Oitavas"}, {id:"quartas",name:"Quartas"},
                           {id:"semifinal",name:"Semifinal"}, {id:"final",name:"Final"} ] };
  const t = k => (${JSON.stringify(TEXTOS)})[k] || k;
  const esc = x => String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const teamLogoImg = (team) => '<img data-team="' + esc(team) + '">';
  ${FUNCS.map(corpo).join("\n\n")}
  return { findNextKnownUndatedPhase, nextMatchBlockHtml, derivedPhaseView, DATA };
`)();
const { findNextKnownUndatedPhase, nextMatchBlockHtml } = sandbox;

// Mesma FORMA da proveniência real em produção (lida em 2026-09-05): o `app.js` exige os quatro
// campos de `TOPOLOGY_REQUIRED_FIELDS`, e um fixture com dois passaria a testar uma regra mais
// frouxa que a do produto. Os textos longos das fontes não importam para esta regra e ficam fora.
const PROV = { authority: "CBF", source: "CBF (sorteio oficial de 2026-08-11)",
               ingestedAt: "2026-08-12T19:00:00Z", validatedAt: "2026-08-12T19:00:00Z" };
const TOPO = { provenance: PROV, slots: {
  "sf-1": { sideA: { winnerOf: "espn-gremio_internacional" }, sideB: { winnerOf: "espn-atletico-mg_cruzeiro" } },
  "sf-2": { sideA: { winnerOf: "espn-vasco_vitoria" },        sideB: { winnerOf: "espn-palmeiras_santos" } } } };

const tie = (a, b, q) => ({ teamA: a, teamB: b, qualifiedTeamId: q,
  matches: { first: { goalsHome: 1, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 0 } } });

function estado({ gremioDecidido = true, topo = TOPO, semiTies = {}, } = {}) {
  return { phases: {
    quartas: { ties: {
      "espn-vasco_vitoria": tie("Vasco", "Vitória", "A"),
      "espn-palmeiras_santos": tie("Palmeiras", "Santos", "A"),
      "espn-atletico-mg_cruzeiro": tie("Cruzeiro", "Atlético-MG", "B"),
      "espn-gremio_internacional": tie("Internacional", "Grêmio", gremioDecidido ? "B" : null) } },
    semifinal: topo ? { ties: semiTies, topology: topo } : { ties: semiTies },
    final: { ties: {} } } };
}

console.log("\nConfronto conhecido sem data — o que ele mostra e o que se recusa a inventar\n");
console.log("A. Deriva da topologia, nunca de palpite");

test("semifinal sem data => devolve os DOIS confrontos, na ordem da topologia", () => {
  const r = findNextKnownUndatedPhase(estado());
  A(r && r.phaseId === "semifinal", `veio ${r && r.phaseId}`);
  A(r.items.length === 2, `${r.items.length} confronto(s)`);
  A(r.items[0].aLabel === "Grêmio" && r.items[0].bLabel === "Atlético-MG", JSON.stringify(r.items[0]));
  A(r.items[1].aLabel === "Vasco" && r.items[1].bLabel === "Palmeiras", JSON.stringify(r.items[1]));
});

test("lado ainda não terminal => 'Vencedor de …', NUNCA um clube presumido", () => {
  const r = findNextKnownUndatedPhase(estado({ gremioDecidido: false }));
  const sf1 = r.items[0];
  A(sf1.aLabel.startsWith("Vencedor de"), `rotulou "${sf1.aLabel}" — isso afirma um classificado`);
  A(!/Grêmio$|Internacional$/.test(sf1.aLabel) || sf1.aLabel.includes("×"),
    `"${sf1.aLabel}" parece um clube isolado`);
  A(sf1.aTeam === null, "lado não resolvido não pode carregar escudo");
  A(sf1.bLabel === "Atlético-MG" && sf1.bTeam === "Atlético-MG", "o lado resolvido continua resolvido");
});

test("funciona SEM tie materializado — nenhuma persistência é exigida", () => {
  const e = estado();
  A(Object.keys(e.phases.semifinal.ties).length === 0, "fixture deveria ter semifinal vazia");
  A(findNextKnownUndatedPhase(e).items.length === 2, "não derivou de topologia pura");
});

test("semifinal JÁ materializada mas ainda sem data => continua aparecendo", () => {
  const r = findNextKnownUndatedPhase(estado({ semiTies: {
    "espn-atletico-mg_gremio": { teamA: "Grêmio", teamB: "Atlético-MG", qualifiedTeamId: null,
      matches: { first: { kickoff: null }, second: { kickoff: null } } } } }));
  A(r && r.phaseId === "semifinal", "materializar sem data não pode esconder o confronto");
});

console.log("\nB. O caminho datado sempre vence — as duas semânticas não se misturam");

test("qualquer perna da fase COM data => cede para o caminho cronológico", () => {
  const r = findNextKnownUndatedPhase(estado({ semiTies: {
    "espn-atletico-mg_gremio": { teamA: "Grêmio", teamB: "Atlético-MG",
      matches: { first: { kickoff: "2026-09-20T23:00:00Z" }, second: { kickoff: null } } } } }));
  A(r === null, `devolveu ${r && r.phaseId} — isso duplicaria o confronto no hero e em Jogos`);
});

test("fase já decidida não é 'a próxima'", () => {
  const e = estado();
  e.phases.semifinal.ties = {
    "espn-atletico-mg_gremio": tie("Grêmio", "Atlético-MG", "A"),
    "espn-palmeiras_vasco": tie("Vasco", "Palmeiras", "A") };
  const r = findNextKnownUndatedPhase(e);
  A(!r || r.phaseId !== "semifinal", `voltou para a semifinal decidida (${r && r.phaseId})`);
});

test("sem topologia autoritativa => null (o hero volta a dizer 'não disponível', que aí é verdade)", () => {
  A(findNextKnownUndatedPhase(estado({ topo: null })) === null, "derivou sem topologia");
  A(findNextKnownUndatedPhase(estado({ topo: { slots: TOPO.slots,
      provenance: { authority: "palpite" } } })) === null, "aceitou proveniência não validada");
  A(findNextKnownUndatedPhase(estado({ topo: { slots: TOPO.slots,
      provenance: { ...PROV, validatedAt: undefined } } })) === null, "aceitou proveniência sem validatedAt");
});

console.log("\nC. O que o bloco NUNCA imprime");

const html = nextMatchBlockHtml(findNextKnownUndatedPhase(estado()));

test("mostra os times e diz, com a redação canônica, que a data está pendente", () => {
  A(html.includes("Grêmio") && html.includes("Atlético-MG"), "faltam os times");
  A(html.includes("Vasco") && html.includes("Palmeiras"), "faltou o segundo confronto");
  A(html.includes("Aguardando datas e horários"), "faltou a redação canônica de data pendente");
  A(html.includes("Semifinal"), "faltou o nome da fase");
});

test("sem contador — contagem para data desconhecida é contagem inventada", () => {
  A(!/count-grid|countdown|timer/i.test(html), "há contador no bloco sem data");
});

test("sem data, sem local, sem 'Onde assistir' — todos sairiam de um kickoff inexistente", () => {
  for (const proibido of ["📍", "Onde assistir", "next-game-time"]) {
    A(!html.includes(proibido), `bloco sem data contém "${proibido}"`);
  }
  A(!/\d{2}\/\d{2}|\d{2}:\d{2}/.test(html), `bloco sem data contém algo com cara de data/hora: ${html}`);
});

test("bloco vazio quando não há confronto conhecido", () => {
  A(nextMatchBlockHtml(null) === "", "null deveria render nada");
  A(nextMatchBlockHtml({ undated: true, items: [] }) === "", "lista vazia deveria render nada");
});

test("UM markup só — o caso sem data é MODO do bloco, não um bloco novo", () => {
  // O gate `hero-composition` pegou exatamente isto quando escrevi um segundo bloco: duas
  // implementações do mesmo componente divergem, e foi o que o #358 pagou. Fica registrado aqui
  // também, junto da regra que ele protege.
  A((SRC.match(/next-game-label/g) || []).length === 1,
    "há mais de um markup de próxima partida — o modo sem data não pode ser um bloco separado");
  A(!/function undatedMatchupBlockHtml/.test(SRC), "o bloco duplicado voltou");
});

console.log("\nD. Costura no hero");

test("o fallback entra DEPOIS do caminho datado e ANTES de 'não disponível'", () => {
  const hero = corpo("renderHeroSemAoVivo");
  const iUpcoming = hero.indexOf("S.UPCOMING");
  const iFallback = hero.indexOf("findNextKnownUndatedPhase");
  const iUnknown = hero.indexOf("nextMatchUnknown");
  A(iFallback !== -1, "o hero não chama o fallback — a correção não está ligada");
  A(iUpcoming !== -1 && iUpcoming < iFallback, "o fallback precede o caminho datado");
  A(iFallback < iUnknown, "'não disponível' vem antes do fallback — nunca seria alcançado");
});

test("o fallback não escreve estado", () => {
  const f = corpo("findNextKnownUndatedPhase") + corpo("nextMatchBlockHtml");
  for (const p of ["saveState", "_rpc", "persist", "supabase", "upsert", "createTie", "espn-add-tie"]) {
    A(!f.includes(p), `a derivação referencia \`${p}\` — apresentação não pode gravar`);
  }
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ NEXT KNOWN UNDATED FAILED" : "✓ NEXT KNOWN UNDATED OK");
process.exit(fail ? 1 : 0);
