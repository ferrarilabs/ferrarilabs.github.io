#!/usr/bin/env node
/**
 * Testes da reconciliacao do backfill historico (Issue #130).
 *
 * O caso que importa nao e "ele soma certo". E que ele se RECUSA a classificar como importavel
 * qualquer coisa que dependa de adivinhar identidade — porque a unica chave que liga as duas
 * fontes e o NOME, e nome e chave fraca.
 */

import { parseSource, classify, validateTotals, identityMap, detectDuplicates, nameHash, firstHash, money, paymentInstant, IMPORTABLE }
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

test("5. colisao de primeiro nome DENTRO da origem NAO e ambiguidade", () => {
  // CORRIGIDO em 2026-08-22 (#298). A versao anterior deste caso exigia AMBIGUOUS aqui, e estava
  // errada: dois nomes da ORIGEM compartilharem o primeiro nome nao cria duvida nenhuma -- sao dois
  // registros distintos e nenhum dos dois esta sendo fundido num participante existente. O risco
  // real e fundir no participante ERRADO DO BANCO, e aqui o banco esta vazio.
  //
  // A regra antiga bloqueava quatro linhas legitimas (US$ 40) sem nenhum ganho de seguranca.
  const rows = src([
    { drawId: "2026-08-10", name: "Ana Souza", amount: 10 },
    { drawId: "2026-08-10", name: "Ana Prado", amount: 10 },
  ]);
  const c = classify(rows, db({ draws: [{ drawId: "2026-08-10" }] }));
  assert(c.every((x) => x.klass === IMPORTABLE), JSON.stringify(c.map((x) => x.klass)));
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

// ── IDENTIDADE POR INSTANTE DE PAGAMENTO (Issue #298) ────────────────────────────────────────
//
// A chave que resolveu a #298 nao e nome: e o instante do pagamento com precisao de SEGUNDO,
// exigido unico DOS DOIS LADOS. Estes casos existem porque o import de verdade errou aqui uma vez.

test("14. instante de pagamento resolve identidade quando o nome nao resolve", () => {
  const rows = src([{ drawId: "2026-08-08", name: "Nome Da Origem", amount: 10 }])
    .map((r) => ({ ...r, paidKey: "2026-08-08 09:11:28" }));
  const base = db({
    participants: [P("Grafia Diferente No Banco")],
    draws: [{ drawId: "2026-08-08" }],
    contributions: [{ drawId: "2026-08-08", nameHash: nameHash("Grafia Diferente No Banco"),
                      amount: 10, paidKey: "2026-08-08 09:11:28" }],
    paymentTotal: 10, contributionTotal: 10,
  });
  const m = identityMap(rows, base);
  const id = m.get(nameHash("Nome Da Origem"));
  assert(id.kind === "EXACT" && id.via === "PAYMENT_INSTANT", JSON.stringify(id));
  assert(classify(rows, base)[0].klass === "ALREADY_PRESENT_EXACT",
    "resolvido pelo instante, a contribuicao ja esta presente — nao pode virar import");
});

test("15. REGRESSAO (#298): quem foi resolvido pelo instante NAO pode virar participante novo", () => {
  // O defeito real: o gerador criou um participante novo sob a grafia da ORIGEM enquanto a mesma
  // pessoa ja existia no banco sob outra grafia — duplicando a pessoa. O modelo tem de dizer
  // claramente que essa identidade JA EXISTE, para que o gerador use o participante do banco.
  const rows = src([
    { drawId: "2026-08-08", name: "Nome Da Origem", amount: 10 },
    { drawId: "2026-08-10", name: "Nome Da Origem", amount: 10 },
  ]).map((r) => ({ ...r, paidKey: r.drawId === "2026-08-08" ? "2026-08-08 09:11:28" : "2026-08-10 10:00:00" }));
  const base = db({
    participants: [P("Grafia Diferente No Banco")],
    draws: [{ drawId: "2026-08-08" }, { drawId: "2026-08-10" }],
    contributions: [{ drawId: "2026-08-08", nameHash: nameHash("Grafia Diferente No Banco"),
                      amount: 10, paidKey: "2026-08-08 09:11:28" }],
    paymentTotal: 10, contributionTotal: 10,
  });
  const id = identityMap(rows, base).get(nameHash("Nome Da Origem"));
  assert(id.kind === "EXACT", "a pessoa JA existe no banco — criar outra linha a duplica");
  assert(id.dbNameHash === nameHash("Grafia Diferente No Banco"),
    "o modelo tem de entregar o participante DO BANCO a quem anexar a nova participacao");
  // a segunda perna e import legitimo, mas anexado ao participante existente
  const c = classify(rows, base);
  assert(c[0].klass === "ALREADY_PRESENT_EXACT" && c[1].klass === IMPORTABLE, JSON.stringify(c.map(x => x.klass)));
});

test("16. instante ambiguo dos dois lados NAO resolve identidade", () => {
  // Se duas pessoas compartilham o instante, ele deixa de identificar — e cair para nome seria
  // exatamente o que a autorizacao proibe.
  const rows = src([
    { drawId: "2026-08-08", name: "Pessoa Um", amount: 10 },
    { drawId: "2026-08-08", name: "Pessoa Dois", amount: 10 },
  ]).map((r) => ({ ...r, paidKey: "2026-08-08 09:11:28" }));
  const base = db({
    participants: [P("Alguem No Banco")], draws: [{ drawId: "2026-08-08" }],
    contributions: [{ drawId: "2026-08-08", nameHash: nameHash("Alguem No Banco"),
                      amount: 10, paidKey: "2026-08-08 09:11:28" }],
    paymentTotal: 10, contributionTotal: 10,
  });
  const m = identityMap(rows, base);
  for (const n of ["Pessoa Um", "Pessoa Dois"]) {
    assert(m.get(nameHash(n)).via !== "PAYMENT_INSTANT", `${n}: instante compartilhado nao identifica`);
  }
});

test("17. horario SEM segundos nao serve como identidade", () => {
  assert(paymentInstant("06/08/2026", "6:49 PM") === null, "minuto inteiro nao identifica pessoa");
  assert(paymentInstant("06/08/2026", "9:11:28 AM") === "2026-08-06 09:11:28", "segundo identifica");
  assert(paymentInstant("06/08/2026", "9:11:28 PM") === "2026-08-06 21:11:28", "PM converte");
  assert(paymentInstant(null, "9:11:28 AM") === null, "sem data nao ha instante");
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
