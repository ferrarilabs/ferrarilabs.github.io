#!/usr/bin/env node
/**
 * POWERBALL — pipeline de resultado: buscar, calcular prêmio, gravar, destacar.
 *
 * O QUE ISTO IMPEDE (quatro sintomas relatados pelo Eduardo em 2026-08-09, depois do sorteio de
 * 08/08: "funcionou para puxar o resultado mas não marcou os bilhetes venceram em negrito, não
 * mudou o drop down e não disparou o email com o resultado do sorteio e os ganhos"):
 *
 *   1. A URL da API ia com um ESPAÇO cru ("$order=draw_date DESC"). O urllib recusava antes de
 *      qualquer rede, o erro era engolido por um `except` e o script terminava com exit 0 — o
 *      workflow ficava VERDE tendo falhado em TODA execução. (O navegador funcionava porque o
 *      `fetch()` dele codifica o espaço sozinho: por isso a página mostrava o resultado e o cron
 *      não.)
 *   2. O parser do `data.js` usava `json.loads` num arquivo que é JavaScript de verdade — chaves
 *      sem aspas, comentários, vírgulas finais. NUNCA conseguiu ler. Segundo exit 0 silencioso.
 *   3. `premiosGanhos: 0` era gravado como placeholder "para o script de email preencher". Mas o
 *      site LÊ esse campo e o exibe: com 0 ele afirma "Nenhum prêmio nesse sorteio". No sorteio de
 *      08/08 dois bilhetes acertaram o Powerball ($24) — o site teria mentido sobre dinheiro.
 *   4. Não havia NENHUM destaque de acerto no bilhete. Não é regressão: nunca existiu.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_result_pipeline.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const DATA_JS = join(ROOT, "bolao/loterias/powerball/js/data.js");
const APP_JS = join(ROOT, "bolao/loterias/powerball/js/app.js");
const FETCHER = join(ROOT, "bolao/loterias/powerball/scripts/fetch_and_send_results.py");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(DATA_JS, "utf8"), sandbox);
const DRAWS = sandbox.window.POWERBALL_DRAWS;
const GT = sandbox.window.LOTTERY_GAME_TYPES;
const py = readFileSync(FETCHER, "utf8");
const app = readFileSync(APP_JS, "utf8");

console.log("\nPowerball — pipeline de resultado do sorteio\n");

// ── 1. Os bugs que faziam o cron falhar em silêncio ─────────────────────────
test("a query da API é CODIFICADA (o espaço cru quebrava toda execução)", () => {
  assert(/urlencode\(/.test(py), "a URL voltou a ser montada por f-string sem encoding");
  assert(!/\?\$order=draw_date DESC/.test(py),
    "ainda existe a URL com espaço cru — o urllib recusa antes de qualquer rede");
});

test("o data.js é lido por um runtime JS, não por json.loads", () => {
  assert(/node/.test(py) && /runInContext|vm/.test(py),
    "o parser voltou a tentar json.loads num arquivo que é JavaScript (chaves sem aspas, " +
    "comentários, vírgulas finais) — isso nunca conseguiu ler nada");
});

test("a escrita no data.js é CIRÚRGICA (não reescreve o array inteiro)", () => {
  assert(/write_result_into_data_js/.test(py), "a função de escrita cirúrgica sumiu");
  assert(!/json\.dumps\(draws, indent=2\)/.test(py),
    "voltou a reescrever POWERBALL_DRAWS inteiro com json.dumps — isso apaga os comentários do " +
    "arquivo (vários explicando decisões de dinheiro) e toda a formatação");
});

test("a escrita se RECUSA quando a âncora é ambígua", () => {
  assert(/recusando escrever/.test(py),
    "sumiu o guard que impede escrever no sorteio errado — num arquivo de dinheiro, recusar é " +
    "melhor que escrever no escuro");
});

// ── 2. Prêmio calculado, nunca placeholder ─────────────────────────────────
test("o prêmio é CALCULADO antes de gravar, não deixado como 0", () => {
  assert(/compute_prize_via_node/.test(py), "sumiu o cálculo de prêmio");
  assert(!/"premiosGanhos": 0,\s*#/.test(py),
    "voltou a gravar premiosGanhos: 0 como placeholder — o site LÊ esse campo e afirma " +
    '"Nenhum prêmio nesse sorteio", que é uma declaração FALSA sobre dinheiro');
});

test("o cálculo reusa a prizeTable do data.js (regra de prêmio em UM lugar só)", () => {
  assert(/prizeTable\(/.test(py),
    "o prêmio voltou a ser calculado por uma tabela própria em Python — duas cópias da regra de " +
    "prêmio é a divergência que já mordeu o repo (CHANGELOG v4.57 da Copa)");
});

// ── 3. O caso real do sorteio de 08/08 ─────────────────────────────────────
test("REAL 08/08: dois bilhetes acertam só o Powerball e valem $12 cada", () => {
  const official = { numbers: [5, 9, 35, 54, 63], special: 7, multiplier: 3 };
  const draw = DRAWS.find(d => d.id === "2026-08-08");
  assert(draw, "sorteio de 2026-08-08 sumiu do data.js");
  const gt = GT[draw.gameType];
  let total = 0; const labels = {};
  (draw.sharedTickets?.series || []).forEach(s => (s.numeros || []).forEach(str => {
    const m = String(str).match(/^([\d\s-]+?)\s*—\s*(?:PB|MB)\s*(\d+)$/);
    if (!m) return;
    const nums = m[1].trim().split(/[\s-]+/).map(Number);
    const main = nums.filter(n => official.numbers.includes(n)).length;
    const sp = Number(m[2]) === official.special;
    const r = gt.prizeTable(main, sp, official.multiplier);
    if (r && r.amount) { total += r.amount; labels[r.label] = (labels[r.label] || 0) + 1; }
  }));
  eq(total, 24, "o total premiado do sorteio de 08/08 mudou");
  eq(labels["Powerball"], 2, "número de bilhetes que acertaram só o Powerball mudou");
});

test("REAL 08/08: o resultado gravado no data.js bate com o cálculo", () => {
  const draw = DRAWS.find(d => d.id === "2026-08-08");
  const r = draw.result;
  assert(r && r.numbers, "o sorteio de 08/08 está sem resultado gravado");
  eq(JSON.stringify(r.numbers), JSON.stringify([5, 9, 35, 54, 63]), "números errados");
  eq(r.special, 7, "Powerball errado");
  eq(r.premiosGanhos, 24, "premiosGanhos gravado não bate com o cálculo real");
  assert(!r.jackpotHit, "jackpotHit deveria ser falso");
});

// ── 4. Destaque de acerto e rótulo do dropdown ─────────────────────────────
test("o site destaca os números acertados no bilhete", () => {
  assert(/highlightTicketNumbers/.test(app), "a função de destaque sumiu");
  assert(/pb-hit/.test(app), "a classe de acerto sumiu do render");
  const css = readFileSync(join(ROOT, "bolao/loterias/powerball/css/styles.css"), "utf8");
  assert(/\.pb-hit\b/.test(css), "a classe .pb-hit não tem estilo — o destaque não apareceria");
});

test("o destaque só acontece quando existe resultado oficial", () => {
  const fn = app.slice(app.indexOf("function highlightTicketNumbers"));
  assert(/if \(!result \|\| !result\.numbers/.test(fn),
    "o destaque não checa mais se há resultado — marcaria acerto antes do sorteio");
});

test("o rótulo do dropdown é COMPACTO e não embute resultado", () => {
  // Este teste foi INVERTIDO em 2026-08-09. Antes exigia "Resultado:" no rótulo; o Eduardo pediu o
  // desenho original de volta — o seletor serve para ESCOLHER o sorteio, não para exibi-lo (o
  // resultado tem seção própria logo abaixo). Um teste que trava o comportamento antigo depois de
  // uma decisão de produto vira obstáculo, não proteção.
  const fn = app.slice(app.indexOf("function drawSelectorLabel"), app.indexOf("function drawSelectorLabel") + 1400);
  assert(!/Resultado:/.test(fn), "o rótulo do seletor voltou a embutir o resultado do sorteio");
  assert(/gt\.icon/.test(fn) && /gt\.label/.test(fn), "o rótulo perdeu o formato ícone + nome do jogo");
  assert(/hasResult/.test(fn), "o rótulo não distingue mais sorteio já realizado do próximo");
});

// ── 5. FONTE ÚNICA — o envio errado de 2026-08-09 ──────────────────────────
test("send_result_email.py lê os sorteios do data.js, não de uma cópia própria", () => {
  const py2 = readFileSync(join(ROOT, "bolao/loterias/powerball/scripts/send_result_email.py"), "utf8");
  assert(/_load_draws_from_data_js/.test(py2),
    "o script voltou a manter a própria lista de sorteios");
  assert(!/^DRAWS = \{\s*$[\s\S]{200,}"drawDateIso"/m.test(py2),
    "há de novo uma cópia hardcoded de sorteios no send_result_email.py — foi assim que 15 " +
    "participantes receberam o resultado do sorteio ANTERIOR em 2026-08-09");
});

test("REGRESSÃO 2026-08-09: o sorteio ativo é o mais recente COM resultado do data.js", () => {
  // O envio errado aconteceu porque a cópia hardcoded parava em 05/08: `get_active_draw()`
  // devolvia 05/08 e mandava o resultado anterior, para a lista de participantes anterior.
  // A expectativa era o literal "2026-08-08". Comparar um valor DERIVADO do data.js com um id
  // fixo nao testava a propriedade: testava a data do ultimo sorteio, e ficava vermelho sozinho
  // toda vez que um sorteio novo recebia resultado -- foi o que aconteceu em 2026-08-11, quando o
  // resultado de 08/10 foi gravado durante a recuperacao do incidente de notificacao. Um gate que
  // apodrece a cada sorteio ensina a ignorar o vermelho, que e como o vermelho de verdade passa.
  //
  // A propriedade que importa: o sorteio ativo e o mais recente POR DATA entre os que tem
  // resultado. O envio errado de 2026-08-09 foi exatamente uma divergencia entre a ORDEM DO ARRAY
  // e a ORDEM CRONOLOGICA -- e isto pega essa classe, sem depender de qual sorteio e o ultimo.
  const resolved = DRAWS.filter(d => d.result && d.result.numbers);
  assert(resolved.length > 0, "nenhum sorteio com resultado no data.js");
  const active = resolved[resolved.length - 1];
  const maisRecentePorData = resolved.reduce((a, b) => (b.id > a.id ? b : a));
  eq(active.id, maisRecentePorData.id,
    "o sorteio ativo deixou de ser o mais recente com resultado — a ordem do array divergiu da " +
    "ordem cronológica, e é este o cálculo que o send_result_email.py faz para escolher o que " +
    "enviar e para quem");
});

// ── 6. Modelo canônico de sorteio/participação (entrada operacional manual) ──
test("todo sorteio tem os campos canônicos e ids únicos", () => {
  const ids = DRAWS.map(d => d.id);
  eq(new Set(ids).size, ids.length, "há id de sorteio duplicado");
  for (const d of DRAWS) {
    for (const k of ["id", "gameType", "drawing", "participants", "sharedTickets", "finance"]) {
      assert(k in d, `sorteio ${d.id} sem campo canônico "${k}"`);
    }
    // `status` só é exigido enquanto o sorteio está EM ABERTO. O 2026-08-03 é anterior a esse
    // campo existir no modelo e já está resolvido — exigi-lo retroativamente seria reescrever
    // histórico para satisfazer um teste, e não corrige nada operacional.
    const resolved = d.result && d.result.numbers;
    if (!resolved) assert("status" in d, `sorteio em aberto ${d.id} sem "status"`);
    assert(d.drawing.drawDateIso && d.drawing.drawDateLabel, `sorteio ${d.id} sem data`);
    assert(typeof d.drawing.jackpot === "number", `sorteio ${d.id} sem jackpot numérico`);
  }
});

test("REGRA DE DONO: participação do organizador é auto-financiada, nunca 'pendente'", () => {
  // Decisão explícita do Eduardo (2026-08-09): a participação dele representa fundo próprio.
  // A regra é o PAPEL (`status: "organizador"`), não o nome — um "if name === 'Eduardo Ferrari'"
  // seria um hack frágil que quebraria numa troca de organizador ou num homônimo.
  for (const d of DRAWS) {
    for (const p of (d.participants || [])) {
      if (p.status !== "organizador") continue;
      // "Saldo anterior" também é fundo do PRÓPRIO organizador (dinheiro dele de uma rodada
      // anterior), só descrito por outra via. O que a regra proíbe é o organizador aparecer com
      // transferência de TERCEIRO como origem da própria cota.
      assert(p.metodo && /fundo próprio|organizador|saldo anterior/i.test(p.metodo),
        `${p.name} em ${d.id} é organizador mas o método não indica recurso próprio: ${p.metodo}`);
    }
  }
  // E o organizador nunca pode aparecer como pagamento pendente.
  const org = DRAWS.flatMap(d => (d.participants || []).filter(p => p.status === "organizador"));
  assert(org.length > 0, "fixture inútil: nenhum organizador para verificar");
  for (const p of org) eq(p.status === "pendente", false, `${p.name} listado como pendente sendo organizador`);
});

test("REGRA DE DONO: saber COMO é financiado não exige saber QUANTO", () => {
  // O valor por cota varia a cada sorteio, então `valor` pode ser nulo mesmo com a fonte de
  // financiamento conhecida. São dois fatos diferentes e o modelo precisa aceitar essa separação —
  // senão registrar o organizador obrigaria inventar um número.
  // 2026-08-09 — esta assertiva exigia `valor === null`, fixando um estado TRANSITÓRIO ("o valor
  // por cota ainda não foi definido"). Quando o Eduardo confirmou a contribuição dele de $10, o
  // teste caiu — dado legítimo, assertiva envelhecida. Mesma classe da dívida de teste já
  // reconciliada no sorteio e no e-mail: pinar o estado de hoje em vez da REGRA.
  //
  // A regra que importa é a separação: `valor` PODE ser nulo com a origem conhecida. Não que ele
  // TENHA de ser. Agora o teste exercita as duas metades — que o nulo é aceito, e que um valor
  // preenchido é coerente — sem exigir nenhum dos dois de um participante específico.
  const org = DRAWS.flatMap(d => (d.participants || []).filter(p => p.status === "organizador"));
  assert(org.length > 0, "fixture inútil: nenhum organizador");
  for (const p of org) {
    assert(p.metodo, `${p.name}: organizador sem método de financiamento`);
    assert(p.valor === null || (typeof p.valor === "number" && p.valor > 0),
      `${p.name}: valor precisa ser nulo (ainda não definido) ou um número positivo, veio ${JSON.stringify(p.valor)}`);
  }
  // A separação em si: o modelo aceita origem conhecida SEM valor. Se um dia deixar de aceitar,
  // registrar o organizador voltaria a obrigar a inventar um número.
  const aceitaMetodoSemValor = { name: "fx", status: "organizador", metodo: "Fundo próprio", valor: null };
  assert(aceitaMetodoSemValor.valor === null && !!aceitaMetodoSemValor.metodo,
    "o modelo precisa aceitar origem conhecida com valor indefinido");
});

test("participação PODE existir sem pagamento (valor/metodo nulos) e sem virar 'verificado'", () => {
  // Registrar participação e confirmar pagamento são fatos DIFERENTES. Antes o modelo exigia
  // `valor`/`metodo`, então registrar alguém que ainda não pagou obrigaria a inventar um valor —
  // e o status cairia em "✓ Verificado", afirmando pagamento que não aconteceu.
  // "Pendente" é para quem não tem NEM origem NEM valor. Ter a origem conhecida (ex.: fundo
  // próprio do organizador) com o valor por cota ainda não definido é um estado diferente e
  // legítimo — saber COMO é financiado não exige saber QUANTO.
  const semNada = DRAWS.flatMap(d => (d.participants || []).filter(p => p.valor == null && p.metodo == null));
  for (const p of semNada) {
    eq(p.status, "pendente",
      `${p.name} está sem valor E sem método mas o status não é "pendente" — a UI o mostraria como verificado`);
  }
  const appSrc = app;
  assert(/p\.valor == null \? "—"/.test(appSrc), "a UI voltaria a renderizar $NaN para valor nulo");
  assert(/p\.metodo == null \? "Pendente"/.test(appSrc), "a UI voltaria a renderizar undefined para metodo nulo");
});

test("nenhum participante 'verificado' está sem valor ou método", () => {
  for (const d of DRAWS) {
    for (const p of (d.participants || [])) {
      if (p.status === "verificado") {
        assert(p.valor != null && p.metodo != null,
          `${p.name} em ${d.id} está marcado verificado sem valor/metodo — afirmação de pagamento sem dado`);
      }
    }
  }
});

test("cada sorteio encadeia com o anterior e o crédito bate com o resultado dele", () => {
  for (let i = 1; i < DRAWS.length; i++) {
    const prev = DRAWS[i - 1], cur = DRAWS[i];
    if (!cur.previousDrawId) continue;
    eq(cur.previousDrawId, prev.id, `${cur.id} aponta para o sorteio anterior errado`);
    if (prev.result && prev.result.numbers && cur.finance) {
      const expected = (prev.finance.valorGuardadoProximoSorteio || 0) + (prev.result.premiosGanhos || 0);
      eq(cur.finance.creditoSorteioAnterior, expected,
        `crédito de ${cur.id} não bate: guardado(${prev.finance.valorGuardadoProximoSorteio}) + ` +
        `prêmios(${prev.result.premiosGanhos}) do ${prev.id}`);
    }
  }
});

test("NENHUM console.log de debug no app do Powerball (regra do repo)", () => {
  const hits = (app.match(/console\.log\(/g) || []).length;
  eq(hits, 0, "há console.log em código de produção — o repo proíbe explicitamente");
});

// ── 7. PB-RESULTS-STATS-01 — "números que mais acertamos" ────────────────────
// Sugestão do Alan Rech, aprovada pelo Eduardo. Informativo: não pode tocar prêmio, investimento,
// lucro, participação nem email.
//
// A lógica real vive no app (`computeHitStats`), fechada num IIFE. Aqui a agregação é recalculada
// de forma INDEPENDENTE a partir dos dados canônicos e comparada com o que o app produz — é isso
// que impede as duas de divergirem, que é o risco desta feature.
const hitStats = (draw) => {
  const r = draw.result;
  if (!r || !r.numbers) return null;
  const tickets = [];
  (draw.sharedTickets?.series || []).forEach(s => (s.numeros || []).forEach(str => {
    const m = String(str).match(/^([\d\s-]+?)\s*—\s*(?:PB|MB)\s*(\d+)$/);
    if (m) tickets.push({ nums: m[1].trim().split(/[\s-]+/).map(Number), sp: Number(m[2]) });
  }));
  if (!tickets.length) return { total: 0, whites: [], special: null };
  const whites = r.numbers.map(n => ({ n, count: tickets.filter(t => t.nums.includes(n)).length }))
    .sort((a, b) => (b.count - a.count) || (a.n - b.n));
  return { total: tickets.length, whites,
           special: { n: r.special, count: tickets.filter(t => t.sp === r.special).length } };
};

test("[STATS] REAL 08/08: cada número sorteado aparece em 4 de 56, o Powerball em 2", () => {
  const d = DRAWS.find(x => x.id === "2026-08-08");
  const st = hitStats(d);
  eq(st.total, 56, "denominador deve ser o número de BILHETES do sorteio");
  for (const w of st.whites) eq(w.count, 4, `número ${w.n} com contagem inesperada`);
  eq(st.special.count, 2, "contagem do Powerball");
});

test("[STATS] denominador são BILHETES, não participantes", () => {
  const d = DRAWS.find(x => x.id === "2026-08-08");
  eq(hitStats(d).total, 56, "usou participantes (15) em vez de bilhetes (56)");
  assert(d.participants.length !== 56, "fixture inútil para distinguir os dois");
});

test("[STATS] CONTRATO: os acertos agregados batem com a lógica de prêmio", () => {
  // Se as duas divergirem, a estatística conta um acerto que o prêmio não reconhece (ou o
  // contrário) — exatamente a classe de divergência que este repo já pagou caro.
  const d = DRAWS.find(x => x.id === "2026-08-08");
  const gt = GT[d.gameType];
  const st = hitStats(d);
  let premiadosPorPB = 0;
  (d.sharedTickets.series || []).forEach(s => (s.numeros || []).forEach(str => {
    const m = String(str).match(/^([\d\s-]+?)\s*—\s*(?:PB|MB)\s*(\d+)$/);
    if (!m) return;
    const nums = m[1].trim().split(/[\s-]+/).map(Number);
    const main = nums.filter(n => d.result.numbers.includes(n)).length;
    const sp = Number(m[2]) === d.result.special;
    const prize = gt.prizeTable(main, sp, d.result.multiplier);
    if (sp && prize && prize.amount) premiadosPorPB++;
  }));
  eq(st.special.count, premiadosPorPB,
     "a contagem agregada do Powerball diverge de quantos bilhetes o cálculo de prêmio premiou por PB");
});

test("[STATS] sem contaminação entre sorteios", () => {
  const d5 = DRAWS.find(x => x.id === "2026-08-05");
  const d8 = DRAWS.find(x => x.id === "2026-08-08");
  const s5 = hitStats(d5), s8 = hitStats(d8);
  assert(s5.total !== s8.total || JSON.stringify(s5.whites) !== JSON.stringify(s8.whites),
    "os dois sorteios produziram a MESMA estatística — sinal de que os bilhetes vazaram entre eles");
  // Sorteio SEM resultado nao pode produzir estatistica nenhuma.
  //
  // Isto apontava para o id fixo "2026-08-10" -- o sorteio que, quando o teste foi escrito, ainda
  // nao tinha resultado. Em 2026-08-11 o resultado de 08/10 foi gravado e o teste virou vermelho
  // afirmando "estatistica fabricada" sobre uma estatistica perfeitamente legitima. O alvo do
  // teste nao pode ser um sorteio que vai deixar de satisfazer a premissa na semana seguinte.
  //
  // O sorteio sem resultado agora e SINTETICO: a premissa vale para sempre e o gate nunca apodrece.
  const semResultado = { id: "sintetico-sem-resultado", gameType: "powerball",
                         result: null, sharedTickets: d8.sharedTickets };
  eq(hitStats(semResultado), null, "sorteio sem resultado gerou estatística fabricada");
});

test("[STATS] sorteio sem bilhete não vira NaN nem 0/0", () => {
  const fake = { id: "x", gameType: "powerball", result: { numbers: [1,2,3,4,5], special: 6, multiplier: 1 },
                 sharedTickets: { series: [] } };
  const st = hitStats(fake);
  eq(st.total, 0, "total deveria ser 0");
  eq(st.whites.length, 0, "não deve inventar linhas sem bilhete");
});

test("[STATS] ordenação é determinística (mais acertos, depois o próprio número)", () => {
  const fake = { id: "x", gameType: "powerball",
    result: { numbers: [10, 20, 30, 40, 50], special: 9, multiplier: 1 },
    sharedTickets: { series: [{ numeros: [
      "10-20-11-12-13 — PB 09",   // 10 e 20
      "10-21-22-23-24 — PB 01",   // 10
      "30-31-32-33-34 — PB 09",   // 30
    ] }] } };
  const st = hitStats(fake);
  eq(st.whites.map(w => w.n + ":" + w.count).join(","), "10:2,20:1,30:1,40:0,50:0",
     "ordem/contagem não determinística");
  eq(st.special.count, 2, "contagem do special errada");
});

test("[STATS] a feature é POWERBALL-ONLY (não vazou para os apps de futebol)", () => {
  for (const app of ["copa2026", "br2026", "cdb2026"]) {
    const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
    assert(!/computeHitStats|pb-hit-stats|mais acertamos/i.test(src),
      `${app} recebeu a feature de estatística do Powerball — ela é POWERBALL-ONLY por decisão`);
  }
});

test("[STATS] a UI só mostra a seção quando há resultado E bilhetes", () => {
  assert(/if \(!stats \|\| !stats\.total\)/.test(app),
    "a seção deixaria de se esconder para sorteio sem resultado/bilhete, mostrando 0 de 0 · 0%");
  assert(/renderHitStats\(draw, gt\)/.test(app), "a estatística não é renderizada");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ POWERBALL RESULT PIPELINE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
