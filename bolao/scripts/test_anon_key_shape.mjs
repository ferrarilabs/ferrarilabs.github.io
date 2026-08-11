#!/usr/bin/env node
/**
 * PLATAFORMA — a chave anon publicada no código tem de ser a chave REAL do projeto.
 *
 * O DEFEITO QUE ISTO FECHA (2026-08-11)
 * ------------------------------------
 * `send_result_email.py` do Powerball carregava um JWT MALFORMADO como `SUPABASE_ANON_KEY`:
 * cabeçalho e payload de JWT com a chave publicável colada no lugar da ASSINATURA, e com
 * `ref: "cmhqkkfczatdnssupkni"` — um caractere diferente do projeto real
 * (`cmhqkkfczotdnssupkni`).
 *
 * Medido contra produção: aquela chave devolve 401 em toda requisição; a correta devolve 200.
 *
 * O estrago não foi só "o log de auditoria falha em silêncio". Foi esse 401 que derrubou a
 * LEITURA de participantes no Supabase e forçou o fallback para o segredo de ambiente — o caminho
 * que continha o defeito de superconjunto que impediu o e-mail do sorteio de 10/08 de sair para
 * 15 pessoas. Uma chave errada, escondida atrás de três `except` que só logavam um aviso, esteve
 * a montante do incidente inteiro.
 *
 * Por que um gate e não só a correção: o valor certo é feio (não parece uma chave), e o errado
 * parece um JWT respeitável. É exatamente o tipo de coisa que alguém "conserta" de volta.
 *
 * HERMÉTICO: compara formato e consistência entre arquivos. Não faz rede.
 *
 * Uso: node bolao/scripts/test_anon_key_shape.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// Arquivos rastreados que declaram uma chave anon.
// `-i`: a primeira versão usava `[Aa]non_?[Kk]ey`, que NÃO casa com `SUPABASE_ANON_KEY` em caixa
// alta — exatamente como a constante do Powerball é escrita. O gate passava sem nunca ter olhado
// o arquivo que continha o defeito. Medido: reintroduzir o híbrido malformado não derrubava nada.
// Um gate que não enxerga o arquivo que existe para vigiar é pior que nenhum gate.
const arquivos = execFileSync("git", ["grep", "-l", "-i", "-E", "(supabase_)?anon_?key"],
  { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);

const RE_CHAVE = /["']((?:sb_publishable_|sbp_|eyJ)[A-Za-z0-9._-]{10,})["']/g;
const encontradas = new Map();          // valor -> [arquivos]
for (const f of arquivos) {
  const txt = readFileSync(join(ROOT, f), "utf8");
  // Só linhas de CÓDIGO que atribuem a chave — comentários explicando o defeito não contam.
  for (const linha of txt.split("\n")) {
    if (/^\s*(#|\/\/|\*)/.test(linha)) continue;
    if (!/anon_?key/i.test(linha)) continue;
    for (const m of linha.matchAll(RE_CHAVE)) {
      if (!encontradas.has(m[1])) encontradas.set(m[1], []);
      encontradas.get(m[1]).push(f);
    }
  }
}

console.log("\nPlataforma — formato da chave anon publicada\n");

test("existe ao menos uma chave anon declarada (premissa do gate)", () => {
  assert(encontradas.size > 0, "nenhuma chave anon encontrada — o gate perdeu a premissa");
});

test("nenhuma chave é um JWT com assinatura de chave publicável (o híbrido malformado)", () => {
  for (const [chave, fs_] of encontradas) {
    const hibrido = chave.startsWith("eyJ") && /\.sb_publishable_|\.sbp_/.test(chave);
    assert(!hibrido,
      `chave híbrida malformada em ${fs_.join(", ")}: JWT com a chave publicável no lugar da ` +
      "assinatura. Medido em produção: devolve 401 em toda requisição.");
  }
});

test("nenhuma chave aponta para um projeto diferente do real", () => {
  const REF_REAL = "cmhqkkfczotdnssupkni";
  for (const [chave, fs_] of encontradas) {
    if (!chave.startsWith("eyJ")) continue;
    const payload = chave.split(".")[1];
    if (!payload) continue;
    let json;
    try { json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { continue; }
    if (!json.ref) continue;
    assert(json.ref === REF_REAL,
      `chave em ${fs_.join(", ")} aponta para o projeto "${json.ref}", e o real é "${REF_REAL}" ` +
      "— um caractere de diferença é 401 em toda requisição");
  }
});

test("todos os arquivos declaram a MESMA chave anon", () => {
  // Duas chaves diferentes significa que uma delas está errada, e ninguém sabe qual.
  assert(encontradas.size === 1,
    `${encontradas.size} chaves anon diferentes no repositório:\n` +
    [...encontradas].map(([k, f]) => `        ${k.slice(0, 28)}… em ${f.join(", ")}`).join("\n"));
});

test("a chave tem o formato publicável atual do Supabase", () => {
  for (const [chave, fs_] of encontradas) {
    assert(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(chave),
      `chave em ${fs_.join(", ")} não tem o formato publicável esperado: "${chave.slice(0, 30)}…"`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ ANON KEY SHAPE PASSED\n" : "✗ ANON KEY SHAPE FAILED\n");
process.exit(fail === 0 ? 0 : 1);
