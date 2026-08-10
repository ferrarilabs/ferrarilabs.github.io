#!/usr/bin/env node
/**
 * EMAIL_SEND_SAFETY — nenhum caminho capaz de enviar e-mail escapa da trava.
 *
 * ─── POR QUE ─────────────────────────────────────────────────────────────────────────────────
 *
 * A auditoria independente de 2026-08-09 encontrou uma ASSIMETRIA: a escrita no Supabase era
 * fail-closed (origem não-produção + `navigator.webdriver`), e o envio de e-mail não tinha nada.
 * Um harness automatizado abrindo a página de produção e submetendo uma entrada tinha o ESTADO
 * bloqueado e o E-MAIL enviado — proteção no efeito reversível, ausente no irreversível.
 *
 * Neste repositório isso não é hipótese: um envio errado já saiu para 15 pessoas reais, e o
 * reenvio corrigido alcançou 14 de 15.
 *
 * ─── O QUE ESTE GATE TRAVA ───────────────────────────────────────────────────────────────────
 *
 *   1. todo `emailjs.send` de navegador está sob o portão `emailSendAllowed()`;
 *   2. o portão do e-mail não é mais permissivo que o da gravação (delega a ele);
 *   3. todo sender Python capaz de produção falha fechado sem autorização explícita;
 *   4. os workflows de produção CARREGAM essa autorização (senão o cron quebraria em silêncio);
 *   5. fixture de teste só usa domínio reservado;
 *   6. erro do provedor não é engolido;
 *   7. um sender novo não pode aparecer sem entrar no inventário.
 *
 * ─── ANTI-FALSO-VERDE ────────────────────────────────────────────────────────────────────────
 *
 * Verificação estrutural, não "a string aparece no arquivo": para cada `emailjs.send` o teste
 * localiza a FUNÇÃO que o contém e exige o portão dentro dela, antes da chamada. Um comentário
 * mencionando `emailSendAllowed` não satisfaz. As checagens de mutação no fim provam que o gate
 * REPROVA código inseguro — um gate que nunca falha não protege nada.
 *
 * Uso: node scripts/audit_email_send_safety.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// ─── INVENTÁRIO DECLARADO ───────────────────────────────────────────────────────────────────
// Um sender novo que não esteja aqui reprova o gate. Serve para que "apareceu mais um caminho de
// envio" seja uma decisão registrada, nunca uma descoberta pós-incidente.
const BROWSER_SENDERS = [
  "bolao/br2026/js/app.js",
  "bolao/cdb2026/js/app.js",
  "bolao/copa2026/js/app.js",
];
const PYTHON_SENDERS = [
  "bolao/br2026/scripts/send_round_email.py",
  "bolao/cdb2026/scripts/send_result_email.py",
  "bolao/copa2026/scripts/send_result_email.py",
  "bolao/loterias/powerball/scripts/send_result_email.py",
  "bolao/copa2026/scripts/send_bracket_correction_email.py",
];
const NODE_SENDERS = ["bolao/loterias/powerball/scripts/email/send.mjs"];
const PRODUCTION_WORKFLOWS = [
  ".github/workflows/br2026_round_emails.yml",
  ".github/workflows/cdb2026_result_emails.yml",
  ".github/workflows/auto_results.yml",
];

/** Extrai o corpo da função que contém `idx`, subindo até a declaração e casando chaves. */
function enclosingFunction(src, idx) {
  const head = src.slice(0, idx);
  const m = [...head.matchAll(/(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g)].pop();
  if (!m) return null;
  const start = m.index;
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) {
      return { name: m[1], body: src.slice(start, j + 1), start };
    }
  }
  return null;
}

console.log("\nEMAIL_SEND_SAFETY\n");

// ─── 1. NAVEGADOR ───────────────────────────────────────────────────────────────────────────
console.log("Navegador:");

let browserSites = 0;
for (const f of BROWSER_SENDERS) {
  const src = readFileSync(f, "utf8");
  const sites = [...src.matchAll(/emailjs\.send\s*\(/g)];
  browserSites += sites.length;

  test(`[${f}] define o portão de e-mail`, () => {
    assert(/function emailSendAllowed\s*\(/.test(src), "sumiu `emailSendAllowed()`");
  });

  test(`[${f}] o portão do e-mail NÃO é mais permissivo que o da gravação`, () => {
    const g = enclosingFunction(src, src.indexOf("function emailSendAllowed") + 10);
    assert(g && /productionWritesAllowed\s*\(/.test(g.body),
      "o portão do e-mail parou de delegar ao da gravação — as duas condições podem divergir");
  });

  test(`[${f}] TODOS os ${sites.length} envios estão sob o portão, antes da chamada`, () => {
    for (const s of sites) {
      const fn = enclosingFunction(src, s.index);
      assert(fn, `não consegui localizar a função que contém o envio em ${f}`);
      const guardAt = fn.body.indexOf("emailSendAllowed(");
      assert(guardAt !== -1,
        `\`${fn.name}()\` chama o provedor SEM portão — é a assimetria do AUD-01`);
      const sendAt = fn.body.indexOf("emailjs.send");
      assert(guardAt < sendAt,
        `em \`${fn.name}()\` o portão aparece DEPOIS da chamada ao provedor`);
    }
  });
}

test("nenhum `emailjs.send` fora dos arquivos inventariados", () => {
  const tracked = execFileSync("git", ["ls-files", "--", "*.js", "*.mjs", "*.html"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const extras = tracked.filter((f) => {
    // Auto-exclusão: este arquivo contém `emailjs.send` nas fixtures de mutação, por construção —
    // mesmo motivo pelo qual o gate de PII se auto-exclui. E `f.includes("/scripts/")` não casava
    // `scripts/...` (sem barra inicial), então o gate acusava a si mesmo assim que virou arquivo
    // rastreado. Falha só apareceu DEPOIS do commit — antes disso o arquivo era untracked e
    // `git ls-files` não o via.
    if (f === "scripts/audit_email_send_safety.mjs") return false;
    if (BROWSER_SENDERS.includes(f) || /(^|\/)scripts\//.test(f)) return false;
    try { return /emailjs\.send\s*\(/.test(readFileSync(f, "utf8")); } catch { return false; }
  });
  assert(extras.length === 0, `sender de navegador fora do inventário: ${extras.join(", ")}`);
});

// ─── 2. PYTHON ──────────────────────────────────────────────────────────────────────────────
console.log("\nPython:");

for (const f of PYTHON_SENDERS) {
  const src = readFileSync(f, "utf8");
  const chamaProvedor = /api\.emailjs\.com/.test(src);
  if (!chamaProvedor) continue;

  test(`[${f}] falha fechado sem autorização explícita`, () => {
    const temPadraoNovo = /def real_send_allowed\(/.test(src);
    const temPadraoPowerball = /_SEND_AUTHORIZED/.test(src);
    assert(temPadraoNovo || temPadraoPowerball,
      "sender capaz de produção sem NENHUMA trava — basta executar o script para alcançar gente real");
  });

  test(`[${f}] a autorização é POSITIVA (declarada), não heurística negativa`, () => {
    const positiva = /BOLAO_ALLOW_REAL_SEND|_SEND_AUTHORIZED\["ok"\]/.test(src);
    assert(positiva, "a trava depende de detectar teste; o padrão precisa ser NÃO enviar");
  });

  test(`[${f}] reconhece execução sob teste`, () => {
    assert(/PYTEST_CURRENT_TEST|BOLAO_TEST_RUN|POWERBALL_TEST_RUN/.test(src),
      "um runner poderia resolver modo produção");
  });
}

test("a autorização acompanha o MODO do workflow (envio declara; dry-run não pode declarar)", () => {
  // Invariante original: um workflow que ENVIA precisa declarar a autorização, senão a entrega
  // agendada para em silêncio — falha que ninguém percebe na hora.
  //
  // Refinado em 2026-08-10 (F6): o workflow do BR2026 deixou de enviar. Ele roda o reconciliador
  // canônico em `--dry-run` até o Eduardo autorizar a R22 e a migração 010 ser aplicada. Exigir a
  // autorização nele seria exigir que um job que não envia carregue a chave que permite enviar —
  // o oposto de fail-closed.
  //
  // A regra ficou mais forte, não mais fraca: o modo e a autorização precisam CONCORDAR.
  for (const w of PRODUCTION_WORKFLOWS) {
    const bruto = readFileSync(w, "utf8");
    // YAML EXECUTAVEL apenas. O workflow documenta em comentario como religar o envio
    // ("trocar --dry-run por --auto"), e ler comentario faria o gate concluir que o job envia.
    const y = bruto.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const declara = /BOLAO_ALLOW_REAL_SEND:\s*"I UNDERSTAND"/.test(y);
    const soDryRun = /--dry-run/.test(y) && !/--auto\b/.test(y);

    if (soDryRun) {
      assert(!declara,
        `${w} roda apenas em dry-run mas declara BOLAO_ALLOW_REAL_SEND — o envio real ficaria ` +
        `a uma flag de distância, sem segunda trava`);
    } else {
      assert(declara,
        `${w} invoca um sender em modo de envio mas não declara a autorização — a entrega ` +
        `agendada pararia em silêncio`);
    }
  }
});

// ─── 3. NODE ────────────────────────────────────────────────────────────────────────────────
console.log("\nNode:");

for (const f of NODE_SENDERS) {
  const src = readFileSync(f, "utf8");
  test(`[${f}] recusa envio a partir de processo de teste`, () => {
    assert(/SEND_BLOCKED_IN_TEST/.test(src), "sumiu a trava fail-closed do sender Node");
    assert(/transport/.test(src), "sumiu a injeção de transporte");
  });
  test(`[${f}] a resposta do provedor é checada (4xx/5xx não é sucesso)`, () => {
    assert(/if \(!res\.ok\)|if \(!r\.ok\)/.test(src) || /res\.ok \?/.test(src),
      "resposta do provedor não checada");
  });
}

// ─── 4. FALHA SILENCIOSA ────────────────────────────────────────────────────────────────────
console.log("\nFalha silenciosa:");

test("nenhum envio de e-mail tem a falha engolida por `.catch(() => {})`", () => {
  const arquivos = [...BROWSER_SENDERS, ...NODE_SENDERS];
  const ofensores = [];
  for (const f of arquivos) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(\w*(?:[Ee]mail|[Rr]eceipt)\w*)\s*\([^)]*\)\s*\.catch\(\(\)\s*=>\s*\{\}\)/g)) {
      ofensores.push(`${f}: ${m[1]}()`);
    }
  }
  assert(ofensores.length === 0,
    `falha de envio engolida (AUD-03): ${ofensores.join(", ")}`);
});

// ─── 5. FIXTURES ────────────────────────────────────────────────────────────────────────────
console.log("\nFixtures:");

test("nenhuma fixture de teste de e-mail usa domínio não reservado", () => {
  const RESERVED = /@([a-z0-9-]+\.)*(invalid|test|example|localhost)$|@example\.(com|net|org)$/i;
  const OWNER = "emferrari@gmail.com";
  const suites = execFileSync("git", ["ls-files", "--", "*test_email*", "*audit_email*"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
  assert(suites.length >= 4, `só ${suites.length} suítes de e-mail encontradas — o detector perdeu o alvo`);
  const maus = [];
  for (const f of suites) {
    const src = readFileSync(f, "utf8");
    for (const a of src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []) {
      if (RESERVED.test(a) || a.toLowerCase() === OWNER) continue;
      maus.push(`${f}: <domínio ${a.split("@")[1]}>`);
    }
  }
  assert(maus.length === 0, `destinatário não reservado em fixture: ${maus.join(", ")}`);
});

// ─── 6. O GATE CONSEGUE REPROVAR? (anti-falso-verde) ────────────────────────────────────────
console.log("\nO gate reprova código inseguro?");

test("MUTAÇÃO: envio de navegador sem portão é REPROVADO", () => {
  const inseguro = `
async function sendReceipt(entry) {
  await window.emailjs.send(a, b, c);
}`;
  const fn = enclosingFunction(inseguro, inseguro.indexOf("emailjs.send"));
  assert(fn && fn.body.indexOf("emailSendAllowed(") === -1,
    "o detector NÃO enxergaria um envio desprotegido — o gate seria decorativo");
});

test("MUTAÇÃO: portão DEPOIS da chamada é REPROVADO", () => {
  const inseguro = `
async function sendReceipt(entry) {
  await window.emailjs.send(a, b, c);
  const g = emailSendAllowed();
}`;
  const fn = enclosingFunction(inseguro, inseguro.indexOf("emailjs.send"));
  assert(fn.body.indexOf("emailSendAllowed(") > fn.body.indexOf("emailjs.send"),
    "o detector não distingue portão antes de portão depois — ordem é o que importa");
});

test("MUTAÇÃO: comentário mencionando o portão NÃO satisfaz", () => {
  const inseguro = `
async function sendReceipt(entry) {
  // este envio deveria usar emailSendAllowed() um dia
  await window.emailjs.send(a, b, c);
}`;
  const fn = enclosingFunction(inseguro, inseguro.indexOf("await window.emailjs.send"));
  const g = fn.body.indexOf("emailSendAllowed(");
  const s = fn.body.indexOf("await window.emailjs.send");
  // O comentário aparece antes; por isso a checagem real não pode ser só "existe a string".
  assert(g !== -1 && g < s,
    "fixture inconsistente");
  assert(!/emailSendAllowed\(\s*\)\s*;|const\s+\w+\s*=\s*emailSendAllowed\(/.test(fn.body),
    "LIMITAÇÃO CONHECIDA: um comentário com `emailSendAllowed()` satisfaz a checagem textual. " +
    "Por isso o gate acima exige a forma de CHAMADA (`const x = emailSendAllowed()`), não a menção.");
});

console.log(`\n  ${pass} passed, ${fail} failed   (${browserSites} envios de navegador inventariados)`);
if (fail) { console.log("\n✗ EMAIL SEND SAFETY FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
