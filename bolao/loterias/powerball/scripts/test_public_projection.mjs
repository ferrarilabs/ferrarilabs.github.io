#!/usr/bin/env node
/**
 * PROJECAO PUBLICA — allowlist, vazamento de PII e semantica financeira (Issue #303-A).
 *
 * O artefato gerado aqui e servido pelo GitHub Pages: qualquer coisa que entre nele e publica para
 * sempre, e o repositorio ja teve dois incidentes de PII (HIST-091/HIST-093).
 *
 * O caso central e o teste de INJECAO: uma coluna sensivel inventada e enfiada nas linhas de
 * entrada, e a suite prova que ela nao alcanca a saida. Um teste que so verifica os campos que
 * esperamos ver nao prova nada sobre o campo que ninguem previu — e o campo que ninguem previu e
 * exatamente o que vaza.
 *
 * Sem rede e sem banco. Uso: node bolao/loterias/powerball/scripts/test_public_projection.mjs
 */

import {
  CAMPOS_PUBLICOS, CAMPOS_DERIVADOS, CAMPOS_APRESENTACAO, NUNCA_PUBLICO,
  projetarSorteio, projetarParticipante, liquidoDaParticipacao, assertSemPII,
} from "./public_projection.mjs";
import { divergencias } from "./generate_public_projection.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ARTEFATO = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "data/public_projection.generated.json");

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                          catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

// Linhas no formato REAL das tabelas, com as colunas sensiveis que elas de fato tem.
const PARTICIPANTES = [
  { participant_id: "u1", display_name: "Fulano de Tal", email: "fulano@example.invalid",
    phone: "+1 555 010 0001", state: "NC", created_by: "op-1" },
];
const PARTICIPACOES = [{ participation_id: "pa1", participant_id: "u1", cotas: 1 }];
const TRANSACOES = [
  { participation_id: "pa1", type: "contribution", amount: "20.00", method: "Zelle",
    paid_at: "2026-07-31T20:52:51Z", external_reference: "SYNTH-ZELLE-9988",
    memo: "BOLAO", reason: null, operator_client_ref: "op:abc" },
];

const entrada = (extra = {}) => ({
  participantes: PARTICIPANTES, participacoes: PARTICIPACOES, transacoes: TRANSACOES, ...extra,
});

console.log("\nProjecao publica do Powerball\n");
console.log("Allowlist:");

test("a saida tem EXATAMENTE os campos publicos, nem um a mais", () => {
  const [linha] = projetarSorteio(entrada());
  eq(JSON.stringify(Object.keys(linha).sort()), JSON.stringify([...CAMPOS_PUBLICOS].sort()), "campos");
});

test("email e phone do participante NAO aparecem", () => {
  const j = JSON.stringify(projetarSorteio(entrada()));
  assert(!j.includes("fulano@example.invalid"), "o e-mail alcancou o artefato publico");
  assert(!j.includes("555"), "o telefone alcancou o artefato publico");
});

test("external_reference, memo e operator_client_ref NAO aparecem", () => {
  const j = JSON.stringify(projetarSorteio(entrada()));
  for (const v of ["SYNTH-ZELLE-9988", "BOLAO", "op:abc"]) {
    assert(!j.includes(v), `valor privado ${v} alcancou o artefato publico`);
  }
});

test("INJECAO: um campo sensivel INVENTADO nao chega a saida", () => {
  // O caso que importa. Se a projecao espalhasse a linha (`...participante`), qualquer coluna nova
  // do banco vazaria por padrao e alguem teria de lembrar de proibi-la.
  const CANARIO = "CANARIO-NAO-DEVE-VAZAR-8842";
  const sujo = entrada({
    participantes: [{ ...PARTICIPANTES[0], ssn: CANARIO, internal_note: CANARIO, whatever_new_column: CANARIO }],
    transacoes: [{ ...TRANSACOES[0], bank_account: CANARIO, coluna_futura: CANARIO }],
    participacoes: [{ ...PARTICIPACOES[0], private_flag: CANARIO }],
  });
  const j = JSON.stringify(projetarSorteio(sujo));
  assert(!j.includes(CANARIO), "um campo desconhecido vazou — a projecao esta espalhando linhas");
});

test("INJECAO: dez campos aleatorios seguidos, todos barrados", () => {
  for (let i = 0; i < 10; i++) {
    const marca = `CANARIO-${i}-${Math.random().toString(36).slice(2)}`;
    const sujo = entrada({ participantes: [{ ...PARTICIPANTES[0], [`col_${i}`]: marca }] });
    assert(!JSON.stringify(projetarSorteio(sujo)).includes(marca), `col_${i} vazou`);
  }
});

test("a allowlist nao pode crescer sem alguem decidir", () => {
  eq(JSON.stringify([...CAMPOS_PUBLICOS]),
     JSON.stringify(["name", "cotas", "valor", "metodo", "data", "hora", "status", "state"]),
     "o conjunto de campos publicos mudou — isso e decisao de exposicao publica, nao refatoracao");
});

console.log("\nSegunda tranca (assertSemPII varre o artefato pronto):");

test("um e-mail escondido num campo permitido e PEGO", () => {
  // Escapa da checagem por NOME (o campo se chama `name`), nao escapa da checagem por FORMATO.
  let lancou = false;
  try { assertSemPII([{ name: "alguem@example.invalid", cotas: 1 }]); } catch { lancou = true; }
  eq(lancou, true, "e-mail dentro de campo permitido passou batido");
});

test("um campo proibido VAZIO tambem e pego (checagem por nome)", () => {
  let lancou = false;
  try { assertSemPII([{ name: "Fulano", email: "" }]); } catch { lancou = true; }
  eq(lancou, true, "campo proibido com valor vazio passou batido");
});

test("um telefone escondido e pego", () => {
  let lancou = false;
  try { assertSemPII([{ name: "Fulano", metodo: "+1 555 010 0001" }]); } catch { lancou = true; }
  eq(lancou, true, "telefone passou batido");
});

test("a lista de proibidos cobre as colunas sensiveis que as tabelas REALMENTE tem", () => {
  for (const col of ["email", "phone", "external_reference", "memo", "reason", "operator_client_ref"]) {
    assert(NUNCA_PUBLICO.includes(col), `coluna real sensivel ${col} nao esta na segunda tranca`);
  }
});

test("um artefato limpo passa (a tranca nao e um bloqueio geral)", () => {
  assertSemPII([{ name: "Fulano de Tal", cotas: 1, valor: 20, metodo: "Zelle",
                  data: "31/07/2026", hora: "4:52:51 PM", status: "verificado", state: "NC" }]);
});

console.log("\nSemantica financeira:");

test("valor publico e o LIQUIDO do razao daquela participacao", () => {
  const [linha] = projetarSorteio(entrada());
  eq(linha.valor, 20, "valor");
});

test("o ajuste de +2,00 ALHEIO ao bolao, uma vez estornado, soma ZERO", () => {
  // Sem excecao escrita para ninguem: o estorno se anula por aritmetica.
  const com2 = [
    ...TRANSACOES,
    { participation_id: "pa1", type: "adjustment", amount: "2.00" },
    { participation_id: "pa1", type: "reversal", amount: "-2.00" },
  ];
  const [linha] = projetarSorteio(entrada({ transacoes: com2 }));
  eq(linha.valor, 20, "o par ajuste+estorno tem de somar zero no valor publico");
});

test("um ajuste AINDA NAO estornado aparece — a projecao nao esconde nada sozinha", () => {
  const so2 = [...TRANSACOES, { participation_id: "pa1", type: "adjustment", amount: "2.00" }];
  const [linha] = projetarSorteio(entrada({ transacoes: so2 }));
  eq(linha.valor, 22, "a projecao aplicou uma excecao subtrativa em vez de refletir o razao");
});

test("dinheiro somado em centavos, nunca em float", () => {
  const t = [{ participation_id: "pa1", type: "contribution", amount: "0.10", paid_at: "2026-07-31T20:00:00Z" },
             { participation_id: "pa1", type: "contribution", amount: "0.20" }];
  eq(liquidoDaParticipacao(t), 30, "erro de ponto flutuante entrou na projecao");
});

test("tipo de transacao desconhecido FALHA, nao e ignorado", () => {
  let lancou = false;
  try { liquidoDaParticipacao([{ type: "donation", amount: "5.00" }]); } catch { lancou = true; }
  eq(lancou, true, "um tipo novo foi silenciosamente descartado do valor publico");
});

test("metodo/data/hora vem da CONTRIBUICAO, nunca de um ajuste interno", () => {
  const com = [
    { participation_id: "pa1", type: "adjustment", amount: "2.00", method: "AJUSTE-INTERNO",
      paid_at: "2026-08-06T10:00:00Z" },
    ...TRANSACOES,
  ];
  const [linha] = projetarSorteio(entrada({ transacoes: com }));
  eq(linha.metodo, "Zelle", "o metodo publico veio de um lancamento interno");
});

test("participacao sem participante FALHA em vez de emitir linha vazia", () => {
  let lancou = false;
  try {
    projetarSorteio(entrada({ participacoes: [{ participation_id: "pa9", participant_id: "FANTASMA", cotas: 1 }] }));
  } catch { lancou = true; }
  eq(lancou, true, "emitiu uma linha publica para um participante inexistente");
});

test("participante sem contribuicao sai como pendente, com valor zero", () => {
  const [linha] = projetarSorteio(entrada({ transacoes: [] }));
  eq(linha.status, "pendente", "status");
  eq(linha.valor, 0, "valor");
  eq(linha.metodo, null, "metodo");
});

console.log("\nProtecao contra edicao manual (drift):");

test("editar `valor` a mao em data.js faz o --check REPROVAR", () => {
  // A garantia central da #303-A: uma edicao manual nao pode virar verdade financeira.
  const doc = JSON.parse(readFileSync(ARTEFATO, "utf-8"));
  const adulterado = JSON.parse(JSON.stringify(doc.sorteios));
  adulterado[0][0].valor = adulterado[0][0].valor + 5;
  const p = divergencias(adulterado, doc.sorteios);
  assert(p.length > 0, "adulterar o valor passou batido");
  assert(p.some((x) => x.includes("`valor`")), "a divergencia nao apontou o campo alterado");
});

test("editar `cotas` a mao tambem reprova", () => {
  const doc = JSON.parse(readFileSync(ARTEFATO, "utf-8"));
  const adulterado = JSON.parse(JSON.stringify(doc.sorteios));
  adulterado[0][0].cotas = 99;
  assert(divergencias(adulterado, doc.sorteios).length > 0, "adulterar cotas passou batido");
});

test("acrescentar um participante inventado reprova", () => {
  const doc = JSON.parse(readFileSync(ARTEFATO, "utf-8"));
  const adulterado = JSON.parse(JSON.stringify(doc.sorteios));
  adulterado[0].push({ name: "Pessoa Inventada", cotas: 1, valor: 20, metodo: "Zelle" });
  const p = divergencias(adulterado, doc.sorteios);
  assert(p.some((x) => x.includes("NAO no banco")), "um participante sem lastro no banco passou");
});

test("remover um participante reprova", () => {
  const doc = JSON.parse(readFileSync(ARTEFATO, "utf-8"));
  const adulterado = JSON.parse(JSON.stringify(doc.sorteios));
  adulterado[0].shift();
  assert(divergencias(adulterado, doc.sorteios).length > 0, "remover alguem passou batido");
});

test("o artefato commitado esta LIMPO — sem PII e sem campo privado", () => {
  const doc = JSON.parse(readFileSync(ARTEFATO, "utf-8"));
  assertSemPII(doc.sorteios);
  const j = JSON.stringify(doc.sorteios);
  for (const proibido of ["email", "phone", "external_reference", "operator_client_ref", "participant_id"]) {
    assert(!j.includes(proibido), `o artefato commitado carrega \`${proibido}\``);
  }
});

test("o artefato so tem os campos que o BANCO possui", () => {
  const doc = JSON.parse(readFileSync(ARTEFATO, "utf-8"));
  for (const linha of doc.sorteios.flat()) {
    eq(JSON.stringify(Object.keys(linha).sort()), JSON.stringify([...CAMPOS_DERIVADOS].sort()),
       "o artefato ganhou campo que o banco nao e autoridade sobre");
  }
});

test("os campos de apresentacao estao DECLARADOS, nao esquecidos", () => {
  // Todo campo publico e derivado do banco OU declarado como apresentacao. Nenhum fica sem classe.
  const classificados = new Set([...CAMPOS_DERIVADOS, ...CAMPOS_APRESENTACAO]);
  for (const c of CAMPOS_PUBLICOS) {
    assert(classificados.has(c), `campo publico \`${c}\` nao esta nem derivado nem declarado`);
  }
  eq(classificados.size, CAMPOS_PUBLICOS.length, "ha campo classificado que nao e publico");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) { console.log("✗ PROJECAO PUBLICA REPROVADA\n"); process.exit(1); }
console.log("✓ PROJECAO PUBLICA OK\n");
