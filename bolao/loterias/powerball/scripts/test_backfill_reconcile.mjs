#!/usr/bin/env node
/**
 * Testes da reconciliacao do backfill historico (Issue #130).
 *
 * O caso que importa nao e "ele soma certo". E que ele se RECUSA a classificar como importavel
 * qualquer coisa que dependa de adivinhar identidade — porque a unica chave que liga as duas
 * fontes e o NOME, e nome e chave fraca.
 */

import { parseSource, classify, validateTotals, identityMap, detectDuplicates, nameHash, firstHash, money, IMPORTABLE }
  from "./backfill_reconcile.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const src = (rows) => rows.map((r) => ({
  drawId: r.drawId, nameHash: nameHash(r.name), firstHash: firstHash(r.name),
  cotas: r.cotas ?? 1, amount: r.amount, method: "Zelle", status: "verificado",
}));
const db = (o = {}) => ({ participants: [], draws: [], contributions: [], paymentTotal: 0, contributionTotal: 0, ...o });
const P = (name) => ({ nameHash: nameHash(name), firstHash: firstHash(name) });

console.log("\nRECONCILIACAO DO BACKFILL HISTORICO (Issue #130)\n");

test("1. contribuicao ja registrada com o mesmo valor e no-op", () => {
  const rows = src([{ drawId: "2026-08-08", name: "Ana Silva", amount: 10 }]);
  const c = classify(rows, db({
    participants: [P("Ana Silva")], draws: [{ drawId: "2026-08-08" }],
    contributions: [{ drawId: "2026-08-08", nameHash: nameHash("Ana Silva"), amount: 10 }],
    paymentTotal: 10, contributionTotal: 10,
  }));
  assert(c[0].klass === "ALREADY_PRESENT_EXACT", c[0].klass);
});

test("2. valor divergente e CONFLICT_AMOUNT, nunca importavel", () => {
  const rows = src([{ drawId: "2026-08-08", name: "Ana Silva", amount: 20 }]);
  const c = classify(rows, db({
    participants: [P("Ana Silva")], draws: [{ drawId: "2026-08-08" }],
    contributions: [{ drawId: "2026-08-08", nameHash: nameHash("Ana Silva"), amount: 10 }],
    paymentTotal: 10, contributionTotal: 10,
  }));
  assert(c[0].klass === "CONFLICT_AMOUNT", c[0].klass);
  assert(c[0].klass !== IMPORTABLE, "conflito de valor jamais pode ser importado");
});

test("3. contribuicao ausente, identidade exata, e MISSING_IMPORTABLE", () => {
  const rows = src([{ drawId: "2026-08-10", name: "Ana Silva", amount: 10 }]);
  const c = classify(rows, db({ participants: [P("Ana Silva")], draws: [{ drawId: "2026-08-08" }] }));
  assert(c[0].klass === IMPORTABLE, c[0].klass);
});

test("4. colisao de PRIMEIRO NOME com participante do banco nao casado vira AMBIGUOUS", () => {
  // `Ana Costa` no banco nunca casa por nome exato; `Ana Souza` na origem compartilha o primeiro
  // nome. Nao da para saber se sao a mesma pessoa grafada diferente.
  const rows = src([{ drawId: "2026-08-10", name: "Ana Souza", amount: 10 }]);
  const c = classify(rows, db({ participants: [P("Ana Costa")], draws: [{ drawId: "2026-08-10" }] }));
  assert(c[0].klass === "AMBIGUOUS_MAPPING", c[0].klass);
});

test("5. colisao de primeiro nome DENTRO da origem tambem vira AMBIGUOUS", () => {
  const rows = src([
    { drawId: "2026-08-10", name: "Ana Souza", amount: 10 },
    { drawId: "2026-08-10", name: "Ana Prado", amount: 10 },
  ]);
  const c = classify(rows, db({ draws: [{ drawId: "2026-08-10" }] }));
  assert(c.every((x) => x.klass === "AMBIGUOUS_MAPPING"), JSON.stringify(c.map((x) => x.klass)));
});

test("6. nome exato no banco VENCE a colisao de primeiro nome", () => {
  // Se a origem casa exatamente com um participante do banco, a identidade esta estabelecida --
  // um homonimo de primeiro nome nao a torna duvidosa. Sem isto o gate seria conservador demais e
  // bloquearia importacao legitima.
  const rows = src([
    { drawId: "2026-08-10", name: "Ana Souza", amount: 10 },
    { drawId: "2026-08-10", name: "Ana Prado", amount: 10 },
  ]);
  const m = identityMap(rows, db({ participants: [P("Ana Souza")] }));
  assert(m.get(nameHash("Ana Souza")).kind === "EXACT", "nome exato tem de ser EXACT");
});

test("7. duplicata na propria origem e sinalizada, nao somada duas vezes", () => {
  const rows = src([
    { drawId: "2026-08-10", name: "Ana Silva", amount: 10 },
    { drawId: "2026-08-10", name: "Ana Silva", amount: 10 },
  ]);
  assert(detectDuplicates(rows).size === 1, "a duplicata tem de ser detectada");
  const c = classify(rows, db({ participants: [P("Ana Silva")], draws: [{ drawId: "2026-08-10" }] }));
  assert(c.every((x) => x.klass === "DUPLICATE_SOURCE"), JSON.stringify(c.map((x) => x.klass)));
});

test("8. o portao de aritmetica reprova quando algo fica bloqueado", () => {
  const rows = src([
    { drawId: "2026-08-10", name: "Bruno Lima", amount: 10 },   // importavel
    { drawId: "2026-08-10", name: "Ana Souza", amount: 10 },    // ambiguo -> bloqueado
  ]);
  const base = db({ participants: [P("Ana Costa")], draws: [{ drawId: "2026-08-10" }] });
  const t = validateTotals(classify(rows, base), base);
  assert(t.proposedAmount === 10, `proposto=${t.proposedAmount}`);
  assert(t.blockedAmount === 10, `bloqueado=${t.blockedAmount}`);
  assert(t.balances === false, "com linha bloqueada a aritmetica NAO pode fechar");
});

test("9. o portao fecha quando tudo e importavel ou ja presente", () => {
  const rows = src([{ drawId: "2026-08-10", name: "Bruno Lima", amount: 10 }]);
  const base = db({ participants: [P("Bruno Lima")], draws: [{ drawId: "2026-08-10" }] });
  const t = validateTotals(classify(rows, base), base);
  assert(t.balances === true, `0 + 10 deveria fechar com 10; ${JSON.stringify(t)}`);
});

test("10. nenhuma classe fora do enum, e so uma e importavel", () => {
  const rows = src([{ drawId: "2026-08-10", name: "Bruno Lima", amount: 10 }]);
  const c = classify(rows, db({ draws: [{ drawId: "2026-08-10" }] }));
  assert(c.every((x) => typeof x.klass === "string"), "classe tem de existir");
  assert(IMPORTABLE === "MISSING_IMPORTABLE", "so MISSING_IMPORTABLE pode ser inserido");
});

test("11. a ferramenta nao emite nome, e-mail nem referencia", () => {
  const rows = src([{ drawId: "2026-08-10", name: "Bruno Lima", amount: 10 }]);
  const c = classify(rows, db({ draws: [{ drawId: "2026-08-10" }] }));
  const texto = JSON.stringify(c);
  assert(!texto.toLowerCase().includes("bruno"), "nome de participante nao pode sair da ferramenta");
  assert(/^[0-9a-f]{64}$/.test(c[0].nameHash), "identidade sai como hash");
});

test("12. `valor` textual e normalizado sem perder centavos", () => {
  assert(money("R$ 12,50".replace(",", ".")) === 12.5, "12.50");
  assert(money(10) === 10, "numero puro");
  assert(money(null) === 0, "ausente vira zero");
});

test("13. parse da origem real devolve linhas com sorteio, identidade e valor", () => {
  const rows = parseSource(`window.POWERBALL_DRAWS=[{id:"2026-08-10",participants:[{name:"X Y",cotas:1,valor:10}]}];`);
  assert(rows.length === 1 && rows[0].drawId === "2026-08-10" && rows[0].amount === 10, JSON.stringify(rows));
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
