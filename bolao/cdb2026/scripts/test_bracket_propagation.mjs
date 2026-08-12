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
  assert(r.team === "Cruzeiro", `resolveu para ${r.team}`);
  assert(r.fromPrediction === true, "não marcou que veio de palpite");
});

test("trocar o palpite troca o time na vaga (recomputo imediato)", () => {
  const a = sandbox.resolveParticipantPredicted(ESTADO, { winnerOf: "qf-1" }, { qualified: { "qf-1": "A" } });
  const b = sandbox.resolveParticipantPredicted(ESTADO, { winnerOf: "qf-1" }, { qualified: { "qf-1": "B" } });
  assert(a.team === "Cruzeiro" && b.team === "Atlético-MG",
    `A=${a.team} B=${b.team} — mudar o palpite não mudou a vaga`);
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

// O NOME DO CAMPO E CONTRATO COM O RENDERIZADOR, NAO DETALHE INTERNO.
//
// A primeira versao deste gate afirmava `r.teamName` -- o nome que EU tinha escolhido no
// resolvedor. `participantLabel()` le `part.team`. Resultado: o gate passava enquanto a producao
// renderizava "undefined × Vencedor de Cruzeiro × Atlético-MG".
//
// Teste que espelha a implementacao concorda com ela ate quando ela esta errada. Entao aqui o
// campo e amarrado a QUEM O CONSOME: se `participantLabel` mudar de campo, isto reprova.
test("o campo resolvido é o mesmo que participantLabel() lê", () => {
  const corpo = APP.slice(APP.indexOf("function participantLabel("));
  const fim = corpo.indexOf("\n}");
  const usado = /return part\.([a-zA-Z]+);/.exec(corpo.slice(0, fim));
  assert(usado, "não consegui ler qual campo participantLabel() devolve");
  const r = sandbox.resolveParticipantPredicted(
    ESTADO, { winnerOf: "qf-1" }, { qualified: { "qf-1": "A" } });
  assert(r[usado[1]] === "Cruzeiro",
    `participantLabel() lê "${usado[1]}", mas o resolvedor não preenche esse campo ` +
    `(tem: ${Object.keys(r).join(", ")}). É exatamente assim que a tela mostra "undefined".`);
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

// A afirmação é POSICIONAL, não por janela de N caracteres.
//
// A versão anterior recortava 1200 chars a partir do ramo derivado e exigia que `waitingDraw` não
// aparecesse ali. Reorganizar o renderizador moveu o fallback legado para dentro dessa janela e o
// gate reprovou um comportamento correto -- o ramo derivado retorna antes de alcançá-lo.
//
// O que importa é a ORDEM: dentro do ramo derivado, a mensagem de topologia tem de vir e o ramo
// tem de RETORNAR antes de qualquer `waitingDraw`.
test("fase derivada não diz mais 'aguardando sorteio' (causa errada)", () => {
  // Só CÓDIGO: o comentário que explica a diferença entre "sorteio" e "mapeamento" cita as duas
  // chaves, e uma janela que o inclua mede prosa. Sexta vez hoje que caio nisso.
  const i = APP.indexOf("function renderPickForm(");
  const corpo = semComentarios(APP.slice(i, i + 12000));
  const iDeriv = corpo.indexOf("DERIVED_PHASES[phase.id]");
  assert(iDeriv > 0, "sumiu o ramo de fase derivada no formulário");
  const depois = corpo.slice(iDeriv);
  const iTopo = depois.indexOf("topologyUnpublished");
  const iWait = depois.indexOf("waitingDraw");
  assert(iTopo > 0, "o ramo derivado não menciona mais a topologia não publicada");
  assert(iWait === -1 || iTopo < iWait,
    "fase derivada alcança waitingDraw antes de topologyUnpublished — semifinal não espera " +
    "sorteio, espera mapeamento");
  const iReturn = depois.indexOf("return;", iTopo);
  assert(iReturn > 0 && (iWait === -1 || iReturn < iWait),
    "o ramo derivado não retorna antes do fallback legado");
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
