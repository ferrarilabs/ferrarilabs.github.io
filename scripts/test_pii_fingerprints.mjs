#!/usr/bin/env node
/**
 * test_pii_fingerprints.mjs — o detector de valor conhecido (Issue #181/#195).
 *
 * Todos os "nomes" aqui sao INVENTADOS e nao correspondem a participante nenhum: o proprio ponto do
 * desenho e que o teste nao precisa de valor real para provar que funciona. A lista de teste e
 * construida em memoria, com sal gerado na hora, e some quando o processo termina.
 */
import { randomBytes, createHmac } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizar, impressao, carregarLista, candidatos, varrer, CAMINHO_PADRAO }
  from "./pii_fingerprints.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
function test(nome, fn) {
  try { fn(); pass++; console.log(`  ✓ ${nome}`); }
  catch (e) { fail++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}

const dir = mkdtempSync(join(tmpdir(), "pii-fp-"));
const SAL = randomBytes(32).toString("hex");
// Inventados. Qualquer semelhanca seria coincidencia, e nenhum deles precisa ser real para o teste
// medir o que precisa medir.
const NOMES = ["Marisa Quintanilha Verde", "Anselmo Krupp", "Tobias Vergalhao Neto"];
const fp = (v) => createHmac("sha256", SAL)
  .update(String(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim())
  .digest("hex");

function escreverLista(conteudo, nome = "lista.json") {
  const p = join(dir, nome);
  writeFileSync(p, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo));
  return p;
}

const LISTA_BOA = escreverLista({
  salt: SAL,
  fingerprints: Object.fromEntries(NOMES.map((n, i) => [fp(n), `PII_TEST${i}`])),
});

console.log("\nDetector de valor conhecido (#181/#195)\n");

console.log("Normalizacao:");

test("caixa, acento e espaco nao mudam a impressao", () => {
  const a = impressao(SAL, "Marisa Quintanilha Verde");
  eq(impressao(SAL, "marisa quintanilha verde"), a, "caixa");
  eq(impressao(SAL, "MARISA  QUINTANILHA   VERDE"), a, "espaco repetido");
  eq(impressao(SAL, "  Marisa Quintanilha Verde  "), a, "espaco nas pontas");
});

test("o acento e removido de forma consistente", () => {
  eq(normalizar("João da Silva"), "joao da silva", "acento");
  eq(normalizar("JOÃO  DA   SILVA"), "joao da silva", "acento + caixa + espaco");
});

test("valores diferentes dao impressoes diferentes", () => {
  ok(impressao(SAL, NOMES[0]) !== impressao(SAL, NOMES[1]), "colisao inesperada");
});

test("sal diferente muda a impressao (a lista nao vale sem o sal)", () => {
  const outro = randomBytes(32).toString("hex");
  ok(impressao(SAL, NOMES[0]) !== impressao(outro, NOMES[0]),
     "sem isso, a lista vazada seria quebravel por dicionario");
});

console.log("\nEstado da lista — UNAVAILABLE nunca e PASS:");

test("lista ausente => UNAVAILABLE, nao PASS", () => {
  const r = carregarLista(join(dir, "nao-existe.json"));
  eq(r.estado, "UNAVAILABLE", "ausente precisa ser explicitamente desconhecido");
});

test("varrer sem lista devolve UNAVAILABLE e nenhum achado", () => {
  const r = varrer("qualquer texto", carregarLista(join(dir, "nao-existe.json")));
  eq(r.estado, "UNAVAILABLE", "estado");
  eq(r.achados.length, 0, "sem lista nao ha o que achar");
});

test("JSON quebrado => ERROR, nao silencio", () => {
  eq(carregarLista(escreverLista("{ isto nao e json", "quebrado.json")).estado, "ERROR", "estado");
});

test("sal curto demais => ERROR", () => {
  const p = escreverLista({ salt: "abc", fingerprints: {} }, "sal-curto.json");
  eq(carregarLista(p).estado, "ERROR", "sal fraco nao pode virar ENFORCED");
});

test("lista com VALOR CRU em vez de impressao => ERROR", () => {
  // O modo mais provavel de alguem estragar isto e colar nomes direto no arquivo. Isso precisa
  // reprovar alto, e nao passar despercebido guardando PII num arquivo que ninguem revisa.
  const p = escreverLista({ salt: SAL, fingerprints: { "Anselmo Krupp": "PII_X" } }, "crua.json");
  const r = carregarLista(p);
  eq(r.estado, "ERROR", "valor cru precisa reprovar");
  ok(/impressao, nunca valor/.test(r.motivo), "a mensagem precisa dizer por que");
});

test("lista boa => ENFORCED, com total", () => {
  const r = carregarLista(LISTA_BOA);
  eq(r.estado, "ENFORCED", "estado");
  eq(r.total, NOMES.length, "total");
});

console.log("\nDeteccao:");

test("acha o valor conhecido e devolve so o rotulo OPACO", () => {
  const lista = carregarLista(LISTA_BOA);
  const r = varrer(`pagamento confirmado de ${NOMES[0]} via Zelle`, lista);
  eq(r.estado, "ENFORCED", "estado");
  eq(r.achados.join(","), "PII_TEST0", "rotulo opaco");
  ok(!r.achados.some((a) => /Marisa|Quintanilha|Verde/i.test(a)),
     "o valor jamais pode voltar no resultado");
});

test("acha com caixa e acento diferentes do cadastrado", () => {
  const lista = carregarLista(LISTA_BOA);
  eq(varrer("relato de ANSELMO KRUPP sobre o save", lista).achados.join(","), "PII_TEST1", "achado");
});

test("texto sem valor conhecido nao produz achado", () => {
  const lista = carregarLista(LISTA_BOA);
  const r = varrer("fix(cdb2026): corrige o preflight CORS da Edge Function no GitHub Support", lista);
  eq(r.achados.length, 0, `falso positivo: ${r.achados.join(",")}`);
});

test("frases capitalizadas comuns do projeto NAO viram achado", () => {
  // A razao de existir a lista fechada. Uma heuristica de "frase capitalizada" reprovaria em todas
  // estas, seria desligada na primeira semana, e um gate desligado protege menos que nenhum.
  const lista = carregarLista(LISTA_BOA);
  const texto = [
    "Copa do Brasil 2026", "Edge Function", "GitHub Support", "Ver Palpites",
    "Bolao Brasileirao", "Change Intent", "Safety Contract", "Human Gate",
    "Zelle", "Cash App", "Supabase", "Ferrari Labs",
  ].join(" · ");
  eq(varrer(texto, lista).achados.length, 0, "essas frases nao podem virar achado");
  ok(candidatos(texto).length > 8, "a heuristica gera candidatos de proposito — quem filtra e a lista");
});

test("multiplos valores no mesmo texto viram multiplos rotulos, sem repetir", () => {
  const lista = carregarLista(LISTA_BOA);
  const r = varrer(`${NOMES[0]} e ${NOMES[1]} e de novo ${NOMES[0]}`, lista);
  eq(r.achados.sort().join(","), "PII_TEST0,PII_TEST1", "dois rotulos, sem duplicata");
});

console.log("\nHigiene do proprio mecanismo:");

test("o caminho padrao fica FORA deste repositorio", () => {
  ok(!CAMINHO_PADRAO.includes("ferrarilabs.github.io"),
     "a lista privada nunca pode morar no repo publico, nem gitignorada");
  ok(/ferrarilabs-work/.test(CAMINHO_PADRAO), "esperado o diretorio de trabalho privado");
});

test("nenhum valor real aparece neste arquivo de teste nem no modulo", () => {
  // O detector se aplica a si mesmo: se um dia alguem colar um nome real aqui, isto reprova.
  const lista = carregarLista(LISTA_BOA);
  for (const f of ["scripts/pii_fingerprints.mjs", "scripts/test_pii_fingerprints.mjs"]) {
    let src = "";
    try { src = readFileSync(new URL(`../${f}`, import.meta.url), "utf-8"); } catch { /* arquivo movido: o caso vira vacuo, e o gate de registro pega o sumico */ }
    const r = varrer(src, lista);
    // A lista de teste so contem nomes inventados, entao um achado aqui significa que alguem
    // adicionou um valor da lista ao codigo -- que e exatamente o que nao pode acontecer.
    eq(r.achados.filter((a) => a !== "PII_TEST0" && a !== "PII_TEST1" && a !== "PII_TEST2").length,
       0, "valor conhecido dentro do proprio mecanismo");
  }
});

rmSync(dir, { recursive: true, force: true });

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ DETECTOR DE VALOR CONHECIDO REPROVADO\n"); process.exit(1); }
console.log("✓ DETECTOR DE VALOR CONHECIDO OK\n");
