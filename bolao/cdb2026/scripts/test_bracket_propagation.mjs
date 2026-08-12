#!/usr/bin/env node
/**
 * CDB2026 — a semifinal reage ao palpite das quartas SEM salvar.
 *
 * O DEFEITO RELATADO (2026-08-12)
 * -------------------------------
 * O operador preencheu as quartas no formulário real e a semifinal continuou dizendo
 * "Aguardando sorteio oficial". A leitura natural é "a tela travou até eu salvar".
 *
 * DUAS COISAS ESTAVAM ERRADAS, E SÓ UMA É CÓDIGO
 * ----------------------------------------------
 * 1. A MENSAGEM. Semifinal e final NÃO têm sorteio próprio — a composição vem dos vencedores
 *    das quartas. O que falta nelas é o MAPEAMENTO oficial da CBF (qual vencedor ocupa qual
 *    vaga), não um sorteio. Dizer "aguardando sorteio" manda a pessoa esperar algo que não vai
 *    acontecer, e faz parecer defeito de tela o que é ausência de dado.
 *
 * 2. A PROPAGAÇÃO. Com o mapeamento registrado, as vagas precisam reagir ao palpite que está na
 *    TELA, sem salvar e sem ir ao banco. `Salvar entrada` é persistência, não "avançar fase".
 *
 * O QUE ESTE GATE NÃO FAZ
 * -----------------------
 * Não inventa o mapeamento. `qf-1 × qf-2` seria uma convenção de implementação apresentada como
 * chaveamento oficial — a mesma classe de erro que fabricar confronto. Enquanto a CBF não
 * publicar, a fase fica honestamente sem vaga, e este gate exige exatamente isso.
 *
 * HERMÉTICO: estado injetado, sem rede.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(AQUI, "..", "js", "app.js"), "utf8");

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// ── extrai as funções puras do app, sem DOM ────────────────────────────────────────────────
function extrai(nome) {
  const i = APP.indexOf(`function ${nome}(`);
  assert(i >= 0, `função ${nome} não existe mais`);
  let prof = 0, j = APP.indexOf("{", i);
  for (let k = j; k < APP.length; k++) {
    if (APP[k] === "{") prof++;
    else if (APP[k] === "}") { prof--; if (prof === 0) return APP.slice(i, k + 1); }
  }
  throw new Error(`não consegui delimitar ${nome}`);
}

const sandbox = {};
const fonte = [
  "const DERIVED_PHASES = Object.freeze({ semifinal: 'quartas', final: 'semifinal' });",
  "function resolveParticipant(s, side) {",
  "  return { resolved: false, teamName: null, winnerOf: side && side.winnerOf };",
  "}",
  extrai("DERIVED_PHASES_PREDECESSOR_OF_TIE"),
  extrai("resolveParticipantPredicted"),
  "return { resolveParticipantPredicted, DERIVED_PHASES_PREDECESSOR_OF_TIE };",
].join("\n");
Object.assign(sandbox, new Function(fonte)());

const ESTADO = {
  phases: {
    quartas: { ties: {
      "qf-1": { teamA: "Cruzeiro",      teamB: "Atlético-MG" },
      "qf-2": { teamA: "Palmeiras",     teamB: "Santos" },
      "qf-3": { teamA: "Vasco",         teamB: "Vitória" },
      "qf-4": { teamA: "Internacional", teamB: "Grêmio" },
    } },
    semifinal: { ties: {} },
  },
};

console.log("\nCDB2026 — propagação do chaveamento\n");

test("palpite de quartas NA TELA resolve a vaga da semifinal", () => {
  const r = sandbox.resolveParticipantPredicted(
    ESTADO, { winnerOf: "qf-1" }, { qualified: { "qf-1": "A" } });
  assert(r.resolved === true, "não resolveu");
  assert(r.teamName === "Cruzeiro", `resolveu para ${r.teamName}`);
  assert(r.fromPrediction === true, "não marcou que veio de palpite");
});

test("trocar o palpite troca o time na vaga (recomputo imediato)", () => {
  const a = sandbox.resolveParticipantPredicted(ESTADO, { winnerOf: "qf-1" }, { qualified: { "qf-1": "A" } });
  const b = sandbox.resolveParticipantPredicted(ESTADO, { winnerOf: "qf-1" }, { qualified: { "qf-1": "B" } });
  assert(a.teamName === "Cruzeiro" && b.teamName === "Atlético-MG",
    `A=${a.teamName} B=${b.teamName} — mudar o palpite não mudou a vaga`);
});

test("sem palpite, a vaga fica NÃO resolvida (mostra a dependência)", () => {
  const r = sandbox.resolveParticipantPredicted(ESTADO, { winnerOf: "qf-2" }, { qualified: {} });
  assert(r.resolved === false, "resolveu um clube sem a pessoa ter escolhido nada");
  assert(r.winnerOf === "qf-2", "perdeu de quem a vaga depende");
});

test("valor de palpite inválido não vira clube", () => {
  for (const v of ["", "X", null, undefined, "AB"]) {
    const r = sandbox.resolveParticipantPredicted(ESTADO, { winnerOf: "qf-1" }, { qualified: { "qf-1": v } });
    assert(r.resolved === false, `aceitou qualified=${JSON.stringify(v)} como escolha`);
  }
});

test("confronto inexistente não resolve", () => {
  const r = sandbox.resolveParticipantPredicted(
    ESTADO, { winnerOf: "qf-99" }, { qualified: { "qf-99": "A" } });
  assert(r.resolved === false, "resolveu contra um confronto que não existe");
});

// ── o que NÃO pode voltar ───────────────────────────────────────────────────────────────────
// Só CÓDIGO. A primeira versão deste caso reprovou por causa do comentário que eu mesmo escrevi
// no app.js explicando que supor `qf-1 × qf-2` seria fabricar chaveamento. Gate que lê prosa mede
// prosa — é a segunda vez hoje que caio nisso.
const semComentarios = (txt) => txt
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

test("o formulário NÃO inventa vaga sem o mapeamento oficial", () => {
  const i = APP.indexOf("function renderPickForm(");
  const corpo = semComentarios(APP.slice(i, i + 9000));
  assert(/topologyKnown/.test(corpo) && /topologyUnpublished/.test(corpo),
    "o formulário voltou a desenhar fase derivada sem checar se a topologia é conhecida");
  assert(!/["'`]qf-\d+["'`]\s*[,\]}]|slots\s*=\s*\[/.test(corpo),
    "apareceu emparelhamento EMBUTIDO no formulário — convenção de implementação apresentada " +
    "como chaveamento oficial é a mesma classe de erro que fabricar confronto");
});

test("fase derivada não diz mais 'aguardando sorteio' (causa errada)", () => {
  const i = APP.indexOf("function renderPickForm(");
  const corpo = APP.slice(i, i + 9000);
  const iDeriv = corpo.indexOf("DERIVED_PHASES[phase.id]");
  assert(iDeriv > 0, "sumiu o ramo de fase derivada no formulário");
  const ramo = corpo.slice(iDeriv, iDeriv + 1200);
  assert(/topologyUnpublished/.test(ramo) && !/waitingDraw/.test(ramo.slice(0, ramo.indexOf("</div>"))),
    "fase derivada ainda cai em waitingDraw — semifinal não espera sorteio, espera mapeamento");
});

test("a propagação é ligada ao evento, não ao salvar", () => {
  assert(/qualSel\?\.addEventListener\("change", propagar\)/.test(APP),
    "mudar o vencedor da fase anterior não dispara propagação");
  assert(/addEventListener\("input", propagar\)/.test(APP),
    "digitar placar não dispara propagação");
  const i = APP.indexOf("function atualizaFasesDerivadas(");
  assert(i > 0, "sumiu a atualização das fases derivadas");
  const corpo = APP.slice(i, i + 1400);
  assert(!/saveEntry|cdb_save_my_picks|loadRemoteState/.test(corpo),
    "a propagação passou a depender de salvar ou de ir ao banco");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ BRACKET PROPAGATION PASSED\n" : "✗ BRACKET PROPAGATION FAILED\n");
process.exit(fail === 0 ? 0 : 1);
