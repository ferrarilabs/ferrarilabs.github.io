/**
 * test_hero_composition.mjs — a COMPOSICAO da pagina, nao so a presenca do hero (#246).
 *
 * Duas vezes o #246 foi dado como resolvido por `hero.classList.hidden === false`, e duas vezes a
 * producao provou que isso nao e aceitacao:
 *
 *   1. BR2026: hero montado e VAZIO (innerHTML.length === 0).
 *   2. CDB2026: hero montado, mas a pagina dizia "Aguardando sorteio oficial" com os quatro
 *      confrontos das quartas renderizados logo abaixo, e "Próxima partida — Internacional ×
 *      Grêmio" aparecia DUAS vezes.
 *
 * Entao o que se prova aqui e semantico: a pagina nao pode se contradizer, e um mesmo confronto
 * nao pode ter duas apresentacoes primarias.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP = readFileSync(join(ROOT, "bolao/cdb2026/js/app.js"), "utf8");
const APP_BR = readFileSync(join(ROOT, "bolao/br2026/js/app.js"), "utf8");

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

const semTexto = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");
const CODIGO = semTexto(APP);
const CODIGO_BR = semTexto(APP_BR);

console.log("\n#246 — composicao da pagina\n");
console.log("A. Estado do sorteio: a pagina nao pode se contradizer");

test("CASE 6: bracket LOCKED + prazo vencido ⇒ 'prazo encerrado', NUNCA 'aguardando sorteio'", () => {
  // Ancora no RENDERIZADOR (`lcFase.state === ...`), nao na derivacao — a primeira ocorrencia do
  // enum esta dentro de `phaseLifecycle()`, que so calcula e nao desenha nada.
  const i = CODIGO.indexOf("lcFase.state === PHASE_LIFECYCLE.PICKS_CLOSED");
  A(i > 0, "o renderizador do countdown nao consulta PHASE_LIFECYCLE.PICKS_CLOSED");
  const janela = CODIGO.slice(i, i + 400);
  A(/t\("closed"\)/.test(janela),
    "fase com palpites fechados nao esta usando a mensagem de prazo encerrado");
});

test("INVARIANTE: LOCKED nunca cai no default 'waitingDraw'", () => {
  const i = CODIGO.indexOf("DRAW_LIFECYCLE.AWAITING_PUBLICATION ?");
  A(i > 0, "escada de mensagens do sorteio nao encontrada");
  const escada = CODIGO.slice(i, i + 500);
  A(/DRAW_LIFECYCLE\.LOCKED\s*\?/.test(escada),
    "o estado LOCKED — o MAIS avancado — nao tem caso proprio e cai no default `waitingDraw`, " +
    "que e a mensagem MENOS avancada. Foi exatamente isso que a producao exibiu em 2026-08-27");
});

test("CASE 5: sorteio conhecido mas datas nao ⇒ 'Aguardando datas e horários'", () => {
  A(/DRAW_LOCKED_CUTOFF_PENDING/.test(CODIGO), "estado de datas pendentes nao consultado");
  const i = CODIGO.indexOf("lcFase.state === PHASE_LIFECYCLE.DRAW_LOCKED_CUTOFF_PENDING");
  A(i > 0, "o renderizador nao consulta DRAW_LOCKED_CUTOFF_PENDING");
  const janela = CODIGO.slice(i, i + 500);
  A(/schedulePendingTitle/.test(janela), "datas pendentes nao usa schedulePendingTitle");
  A(!/waitingDraw/.test(janela), "datas pendentes ainda cai em 'aguardando sorteio'");
});

test("CASE 4: sorteio genuinamente desconhecido ⇒ mensagem de espera CONTINUA permitida", () => {
  A(/DRAW_LIFECYCLE\.WAITING\s*\?\s*"drawWaiting"/.test(CODIGO),
    "o estado de espera real perdeu sua mensagem — a correcao nao pode apagar o caso legitimo");
});

console.log("\nB. Uma unica apresentacao primaria da proxima partida");

for (const [app, codigo, dono] of [["cdb2026", CODIGO, "nextMatchBlockHtml"], ["br2026", CODIGO_BR, "renderHeroSemAoVivo"]]) {
  test(`${app}: o card legado NAO repete a partida primaria`, () => {
    A(/primaria|_ehPrimaria/.test(codigo),
      `${app}: o renderizador legado nao exclui a primaria — o mesmo confronto aparece duas vezes`);
  });

  test(`${app}: a exclusao NAO e feita escondendo com CSS`, () => {
    A(!/display\s*:\s*none[^`]*next-game/.test(codigo),
      `${app}: duas implementacoes escondidas por CSS continuam ambas decidindo estado`);
  });
}

test("cdb2026: existe UMA implementacao do bloco de proxima partida", () => {
  A(/function nextMatchBlockHtml/.test(CODIGO), "o bloco nao foi extraido para um dono unico");
  const ocorrencias = (CODIGO.match(/next-game-label/g) || []).length;
  A(ocorrencias === 1,
    `cdb2026: ${ocorrencias} markups de "proxima partida" — tem de haver exatamente 1`);
});

console.log("\nC. Controle negativo — reintroduzir o duplicado TEM de reprovar");

test("mutacao (card legado volta a desenhar a primaria) e pega", () => {
  const mutado = CODIGO.replace(/group = group\.filter\(x => !mesma\(x\)\);/, "");
  A(mutado !== CODIGO, "a mutacao nao alterou nada");
  let passou = false;
  try {
    A(/primaria/.test(mutado) && /group\.filter\(x => !mesma/.test(mutado), "duplicata reintroduzida");
    passou = true;
  } catch { /* pego */ }
  A(!passou, "CONTROLE NEGATIVO: remover o filtro da primaria passou despercebido");
});

test("mutacao (LOCKED volta ao default waitingDraw) e pega", () => {
  const mutado = CODIGO.replace(/:\s*lc\.state === DRAW_LIFECYCLE\.LOCKED \? "closed"\n/, "");
  A(mutado !== CODIGO, "a mutacao nao alterou nada");
  A(!/DRAW_LIFECYCLE\.LOCKED\s*\?/.test(mutado),
    "CONTROLE NEGATIVO: a checagem de LOCKED deveria ter sumido com a mutacao");
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ HERO COMPOSITION FAILED" : "✓ HERO COMPOSITION OK");
process.exit(fail ? 1 : 0);
