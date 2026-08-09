#!/usr/bin/env node
/**
 * PRIVACIDADE DE FIXTURE DE TESTE — nenhum endereço real dentro de teste.
 *
 * POR QUE: um teste que carrega um endereço real tem duas formas de machucar. A óbvia é vazar o
 * endereço num repositório público. A menos óbvia, e pior, é um teste que um dia consiga alcançar
 * o provedor de verdade — aí ele manda email para uma pessoa real durante uma execução de CI.
 * Em 2026-08-09 um envio real errado já saiu para 15 pessoas; a partir daí, "teste não pode ter
 * endereço real" deixou de ser higiene e virou controle.
 *
 * A regra: fixtures usam domínios RESERVADOS — `.invalid` (RFC 2606) é o preferido porque, por
 * definição, nunca resolve. `example.com`/`example.net`/`example.org` e `.test`/`.example`/
 * `.localhost` também são reservados e aceitos.
 *
 * EXCEÇÃO ÚNICA, declarada: o endereço do PRÓPRIO organizador. Ele aparece em fixture de email e é
 * dele; não é dado de terceiro. Fica declarado aqui em vez de escapar por uma regra genérica.
 *
 * Uso: node scripts/test_fixture_privacy.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// Domínios reservados por RFC: nunca entregáveis.
const RESERVED = /@([a-z0-9-]+\.)*(invalid|test|example|localhost)$|@example\.(com|net|org)$/i;

// O organizador. Único endereço real tolerado em fixture, porque é dele.
const OWNER = "emferrari@gmail.com";

// Arquivos que SÃO teste/fixture. É onde a regra vale.
const TEST_PATTERNS = [
  /(^|\/)test_[^/]+\.(mjs|js|py)$/,
  /(^|\/)[^/]+\.test\.(mjs|js)$/,
  /(^|\/)audit_[^/]+_tests?\.(mjs|js|py)$/,
  /(^|\/)fixtures?\//,
  /(^|\/)[^/]*fixture[^/]*\.(json|mjs|js|py)$/i,
];

// O próprio detector e a suíte dele contêm exemplos por construção — mesma razão pela qual o gate
// de PII se auto-exclui.
const SELF_EXCLUDE = new Set([
  "scripts/test_fixture_privacy.mjs",
  "scripts/audit_pii_repo_wide.mjs",
  "scripts/test_audit_pii_repo_wide.mjs",
]);

const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const testFiles = tracked.filter(f => !SELF_EXCLUDE.has(f) && TEST_PATTERNS.some(re => re.test(f)));

console.log("\nPrivacidade de fixture de teste\n");

test("há arquivos de teste para inspecionar (a regra não pode virar vácuo)", () => {
  assert(testFiles.length >= 15,
    `só ${testFiles.length} arquivos casaram os padrões de teste — o detector provavelmente parou ` +
    `de enxergar a suíte, e um gate que não vê nada passa sempre`);
});

test("nenhuma fixture de teste contém endereço de terceiro", () => {
  const offenders = [];
  for (const f of testFiles) {
    let content;
    try { content = readFileSync(f, "utf8"); } catch { continue; }
    const addrs = content.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    for (const a of addrs) {
      if (RESERVED.test(a)) continue;
      if (a.toLowerCase() === OWNER) continue;
      offenders.push(`${f}: <${a.length} chars, domínio ${a.split("@")[1]}>`);
    }
  }
  assert(offenders.length === 0,
    "endereço de terceiro dentro de teste/fixture — se algum dia um teste alcançar o provedor, " +
    "ele manda email para uma pessoa real:\n      " + offenders.join("\n      "));
});

test("o provedor de email é inalcançável a partir de teste (guard no ponto de envio)", () => {
  const src = readFileSync("bolao/loterias/powerball/scripts/send_result_email.py", "utf8");
  assert(/_SEND_AUTHORIZED/.test(src), "sumiu a trava de autorização de envio");
  assert(/if not _SEND_AUTHORIZED\["ok"\]/.test(src),
    "a trava não está mais no início de send_email() — um caminho novo poderia enviar sem plano");
  assert(/PYTEST_CURRENT_TEST|POWERBALL_TEST_RUN/.test(src),
    "sumiu a detecção de execução de teste — um runner poderia resolver modo produção");
});

test("a suíte de gates de envio usa apenas domínios reservados", () => {
  const src = readFileSync("bolao/loterias/powerball/scripts/test_email_send_gates.py", "utf8");
  const addrs = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  for (const a of addrs) {
    assert(RESERVED.test(a), `a suíte de envio usa domínio não reservado: ${a.split("@")[1]}`);
  }
  assert(/example\.invalid/.test(src), "a suíte deveria usar .invalid explicitamente");
});

console.log(`\n  ${pass} passed, ${fail} failed   (${testFiles.length} arquivos de teste inspecionados)`);
if (fail) { console.log("\n✗ FIXTURE PRIVACY FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
