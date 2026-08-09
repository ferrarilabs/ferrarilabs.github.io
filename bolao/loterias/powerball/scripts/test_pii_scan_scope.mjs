#!/usr/bin/env node
/**
 * CONTRATO DO ESCOPO DE VARREDURA DE PII — exercitado, não afirmado.
 *
 * POR QUE: o gate de PII (`audit_pii_tests.mjs`) varria o FILESYSTEM, pulando apenas uma lista
 * fixa de nomes. Isso respondia "existe PII em algum lugar do meu disco?" quando a pergunta certa
 * é "PII pode entrar no artefato público?". Um artefato de e-mail em `scripts/email/generated/` —
 * ignorado pelo Git, não rastreado, nunca publicado, evidência operacional legítima — derrubava o
 * gate. Gate que falha por evidência privada correta acaba desligado, e aí para de proteger.
 *
 * O escopo agora é o que o Git considera publicável:
 *     rastreados + não-rastreados − ignorados
 * (`git ls-files --cached --others --exclude-standard`)
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO: este programa já teve testes que continuavam verdes
 * enquanto o escopo encolhia em silêncio. Restringir a varredura é, por construção, uma mudança
 * que deixa o gate MAIS fácil de passar — exatamente a direção perigosa. Então o escopo precisa
 * de um teste próprio, e esse teste não pode se contentar em conferir que uma função existe ou
 * que a flag `--exclude-standard` aparece no código: ele monta um repositório Git temporário de
 * verdade, com os quatro casos, e verifica o que a enumeração REALMENTE devolve.
 *
 * Nenhum endereço real em fixture: só domínios reservados por RFC 2606 (`.invalid`).
 *
 * Uso: node bolao/loterias/powerball/scripts/test_pii_scan_scope.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { publishableFiles } from "./audit_pii_tests.mjs";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// ─── Repositório temporário com os quatro casos ─────────────────────────────────────────────
const repo = mkdtempSync(join(tmpdir(), "pii-scope-"));
git(repo, "init", "-q");
git(repo, "config", "user.email", "fixture@example.invalid");
git(repo, "config", "user.name", "fixture");

writeFileSync(join(repo, ".gitignore"), "evidencia-privada/\n*.local.json\n");

// 1. rastreado, com endereço
writeFileSync(join(repo, "rastreado-com-email.json"), '{"to":"alguem@example.invalid"}\n');
// 2. rastreado, seguro
writeFileSync(join(repo, "rastreado-seguro.js"), "export const x = 1;\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "fixture");

// 3. NÃO rastreado e NÃO ignorado, com endereço — o caso que `git ls-files` sozinho perderia
writeFileSync(join(repo, "novo-publico.json"), '{"to":"novo@example.invalid"}\n');
// 4. NÃO rastreado e não ignorado, seguro
writeFileSync(join(repo, "novo-seguro.css"), ".a{color:red}\n");
// 5. IGNORADO, com endereço — evidência operacional privada
mkdirSync(join(repo, "evidencia-privada"), { recursive: true });
writeFileSync(join(repo, "evidencia-privada", "outbox.json"), '{"to":"privado@example.invalid"}\n');
// 6. IGNORADO por padrão de nome
writeFileSync(join(repo, "sidecar.local.json"), '{"to":"sidecar@example.invalid"}\n');

const encontrados = new Set(publishableFiles(repo).map((f) => relative(repo, f)));

console.log("\nEscopo da varredura de PII (repositório Git temporário, hermético)\n");

test("arquivo RASTREADO com endereço entra na varredura", () => {
  assert(encontrados.has("rastreado-com-email.json"),
    "arquivo rastreado ficou fora — o gate deixaria PII publicada passar");
});

test("arquivo NÃO RASTREADO e não ignorado entra na varredura", () => {
  assert(encontrados.has("novo-publico.json"),
    "arquivo novo ainda sem `git add` ficou fora — é o caso mais importante de um gate de " +
    "pré-commit, e olhar só o índice (`git ls-files` puro) o perderia");
});

test("arquivo IGNORADO fica FORA da varredura", () => {
  assert(!encontrados.has(join("evidencia-privada", "outbox.json")),
    "evidência privada ignorada entrou na varredura — é o falso positivo que derrubava o gate");
});

test("arquivo ignorado por PADRÃO DE NOME também fica fora", () => {
  assert(!encontrados.has("sidecar.local.json"),
    "a exclusão só funciona para diretório, não para padrão — regra do .gitignore não está sendo " +
    "seguida genericamente");
});

test("arquivos seguros (rastreado e não rastreado) continuam na varredura", () => {
  assert(encontrados.has("rastreado-seguro.js"), "rastreado seguro sumiu da varredura");
    assert(encontrados.has("novo-seguro.css"), "não rastreado seguro sumiu da varredura");
});

test("a varredura não encolheu para 'quase nada' (proteção contra falso-verde)", () => {
  // Um escopo vazio ou minúsculo faria TODO teste de PII passar. Aqui são 4 publicáveis
  // (.gitignore conta como rastreado, então 5 no total).
  assert(encontrados.size >= 5,
    `só ${encontrados.size} arquivos publicáveis no fixture — o enumerador quebrou: ` +
    JSON.stringify([...encontrados]));
});

test("nenhum dos ignorados aparece, sob nenhum caminho", () => {
  for (const f of encontrados) {
    assert(!f.startsWith("evidencia-privada"), `caminho ignorado vazou: ${f}`);
    assert(!f.endsWith(".local.json"), `caminho ignorado vazou: ${f}`);
  }
});

// ─── Contrato sobre o repositório REAL: a varredura tem que cobrir as superfícies públicas ───
test("no repositório real, a varredura cobre as superfícies publicáveis (html/js/json/css/docs)", () => {
  const raiz = new URL("..", import.meta.url).pathname;
  const reais = publishableFiles(raiz).map((f) => relative(raiz, f));
  assert(reais.length >= 50,
    `só ${reais.length} arquivos varridos no app real — cobertura encolheu`);
  for (const ext of [".html", ".js", ".css", ".json", ".md"]) {
    assert(reais.some((f) => f.endsWith(ext)),
      `nenhum arquivo ${ext} na varredura — uma superfície pública inteira ficou de fora`);
  }
  assert(reais.includes(join("js", "data.js")),
    "js/data.js — o arquivo que originou o incidente de PII — não está sendo varrido");
});

rmSync(repo, { recursive: true, force: true });

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ PII SCAN SCOPE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
