#!/usr/bin/env node
/**
 * Guarda de ESCOPO das ferramentas de auditoria cross-app.
 *
 * O QUE ISTO IMPEDE, e por que existe:
 *
 * O Batch 8 ampliou `check_shared_visual_contract.mjs` de 3 para 4 apps (o Powerball entrou) e
 * deixou `audit_visual_consistency.mjs` e `audit_structural_parity.mjs` em 3. As três ferramentas
 * continuaram VERDES. Uma regressão real de layout foi para produção no meio disso — a marca do
 * Powerball perdeu o reset do `<h1>` e renderizou ~2x maior — e nenhuma delas podia ter pego,
 * porque a ferramenta que compara geometria de marca entre apps não sabia que o Powerball existia.
 *
 * Três bugs distintos desta mesma sprint têm exatamente essa forma, e vale enumerá-los porque é o
 * padrão, não a coincidência:
 *   1. o gate de PII reportou verde porque o arquivo problemático ainda não estava rastreado, então
 *      `git ls-files` não o entregava ao scanner;
 *   2. o runner agregador reportou 35/0 porque duas suítes hermeticamente offline estavam
 *      declaradas como "requer rede" e viravam skip;
 *   3. esta: uma ferramenta passou a cobrir 4 apps e as outras duas ficaram em 3.
 *
 * Em TODOS OS TRÊS o número era honesto a respeito de um escopo que havia encolhido em silêncio.
 * Nenhum teste falhou; a cobertura é que sumiu. É uma classe de falha própria, e esta suíte é a
 * defesa contra ela: uma ferramenta cross-app não pode divergir de escopo sem que alguém declare o
 * motivo por escrito.
 *
 * COMO DECLARAR uma diferença legítima: acrescente o app em `EXPECTED_APPS` se ele deve ser
 * coberto, ou registre-o em `DECLARED_EXCLUSIONS` com um motivo real. Não existe terceira opção —
 * é esse o ponto.
 *
 * Uso: node bolao/scripts/audit_tool_scope.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Os quatro aplicativos da plataforma. Fonte da verdade deste teste.
const EXPECTED_APPS = ["copa2026", "br2026", "cdb2026", "loterias/powerball"];

// Ferramentas que comparam apps entre si e, portanto, têm escopo que pode encolher em silêncio.
const TOOLS = [
  { file: "bolao/scripts/check_shared_visual_contract.mjs", what: "contrato de CSS compartilhado" },
  { file: "bolao/scripts/audit_visual_consistency.mjs", what: "consistência visual em runtime" },
  { file: "bolao/scripts/audit_structural_parity.mjs", what: "paridade estrutural" },
  { file: "bolao/scripts/audit_accessibility.mjs", what: "acessibilidade + matriz responsiva (Batch 9)" },
];

/**
 * Exclusões DECLARADAS: app que uma ferramenta legitimamente não cobre, com o motivo.
 * Uma entrada aqui é uma decisão registrada, não uma desculpa — e ela precisa continuar verdadeira,
 * senão vira dívida escondida com aparência de conformidade.
 */
const DECLARED_EXCLUSIONS = {
  "bolao/scripts/audit_visual_consistency.mjs": {
    "loterias/powerball": "Batch 8: a migração para o framework compartilhado está feita e no ar, e " +
      "restam 2 diferenças intencionais (altura do topbar sem abas; respiro de 60px no rodapé). " +
      "Incluir o Powerball aqui exige ratificação NOMEADA dessas 2 no ALLOWLIST.json — o allowlist " +
      "recusa auto-aprovação por design. Pendente com o Eduardo em " +
      "supervisor/VISUAL_RATIFICATION_REQUIRED.md. REMOVER esta exclusão assim que ele ratificar.",
  },
  "bolao/scripts/audit_structural_parity.mjs": {
    "loterias/powerball": "A suíte compara a ESTRUTURA de navegação por abas (seções .page, nav, " +
      "aria-current). O Powerball é página única, sem abas e sem seções — não há estrutura " +
      "equivalente para comparar. Diferente das outras exclusões, esta NÃO é temporária: só " +
      "deixaria de valer se o Powerball ganhasse navegação por abas.",
  },
};

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Lê o conjunto de apps que uma ferramenta declara, seja em `APPS = [...]` (array) ou `APPS = {...}` (mapa). */
function declaredApps(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const arr = src.match(/const APPS\s*=\s*\[([\s\S]*?)\]/);
  if (arr) return new Set([...arr[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1]));
  // A chave pode vir com ou sem aspas — `loterias/powerball` PRECISA de aspas (tem barra), e a
  // primeira versão desta regex só casava chave nua. O efeito foi o guard acusar uma suíte que de
  // fato cobria os quatro apps. Falha na direção segura (acusa a menos, nunca a mais), mas
  // continuava sendo um leitor incapaz de ler exatamente o app que motivou o guard.
  const obj = src.match(/const APPS\s*=\s*\{([\s\S]*?)\n\};/);
  if (obj) return new Set([...obj[1].matchAll(/^\s{2}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_/-]+))\s*:/gm)]
    .map(m => m[1] ?? m[2] ?? m[3]));
  throw new Error(`não achei uma declaração APPS em ${file}`);
}

console.log("\nGuarda de escopo das ferramentas de auditoria cross-app\n");

for (const tool of TOOLS) {
  test(`${tool.file} cobre os 4 apps (ou declara por escrito quem falta)`, () => {
    const declared = declaredApps(tool.file);
    const exclusions = DECLARED_EXCLUSIONS[tool.file] || {};
    const missing = EXPECTED_APPS.filter(a => !declared.has(a) && !exclusions[a]);
    assert(missing.length === 0,
      `${tool.file} (${tool.what}) não cobre ${missing.join(", ")} e não declara motivo. ` +
      `Ou inclua o app, ou registre-o em DECLARED_EXCLUSIONS com uma razão real — ` +
      `uma ferramenta cross-app verde com escopo encolhido é pior que uma vermelha.`);
  });
}

test("nenhuma ferramenta declara um app que não existe na plataforma", () => {
  for (const tool of TOOLS) {
    for (const app of declaredApps(tool.file)) {
      assert(EXPECTED_APPS.includes(app), `${tool.file} declara app desconhecido: "${app}"`);
    }
  }
});

test("toda exclusão declarada tem motivo real (não um placeholder)", () => {
  for (const [file, excl] of Object.entries(DECLARED_EXCLUSIONS)) {
    for (const [app, reason] of Object.entries(excl)) {
      assert(typeof reason === "string" && reason.length >= 80,
        `${file} → ${app}: o motivo precisa explicar de verdade, não é um campo para preencher`);
      assert(!/^(tbd|todo|n\/a|pendente)\b/i.test(reason.trim()),
        `${file} → ${app}: motivo é um placeholder`);
    }
  }
});

test("exclusão declarada é REALMENTE uma exclusão (o app não aparece na ferramenta)", () => {
  // Se alguém incluir o app e esquecer de remover a exclusão, a exclusão vira documentação falsa.
  for (const [file, excl] of Object.entries(DECLARED_EXCLUSIONS)) {
    const declared = declaredApps(file);
    for (const app of Object.keys(excl)) {
      assert(!declared.has(app),
        `${file} já cobre "${app}", mas ainda tem uma exclusão declarada para ele — remova a entrada de DECLARED_EXCLUSIONS`);
    }
  }
});

// A regressão concreta que motivou tudo isto: a marca do Powerball carrega o <h1> da página, e sem
// o reset o user-agent aplica 2em + margem de bloco. A regra tem de viver no framework, porque o
// styles.css local do Powerball não existe mais para segurá-la.
test("REGRESSÃO 1eee705: o reset de `.brand h1` vive no framework compartilhado", () => {
  const nav = readFileSync(join(ROOT, "bolao/shared/css/navigation.css"), "utf8");
  const rule = nav.match(/\.brand h1\s*\{([^}]*)\}/);
  assert(rule, "`.brand h1` sumiu de shared/css/navigation.css — um <h1> dentro da marca volta a 2em");
  assert(/margin:\s*0/.test(rule[1]), "`.brand h1` não zera mais a margem");
  assert(/font:\s*inherit/.test(rule[1]), "`.brand h1` não herda mais a tipografia da marca");
});

test("todo app que põe <h1> dentro de .brand está coberto pelo reset compartilhado", () => {
  for (const app of EXPECTED_APPS) {
    const html = readFileSync(join(ROOT, "bolao", app, "index.html"), "utf8");
    const brand = html.match(/<div class="brand"[^>]*>([\s\S]*?)<\/div>/);
    if (!brand || !/<h1[\s>]/.test(brand[1])) continue;      // não usa h1 na marca
    const nav = readFileSync(join(ROOT, "bolao/shared/css/navigation.css"), "utf8");
    assert(/\.brand h1\s*\{/.test(nav),
      `${app} tem <h1> dentro de .brand mas o framework não tem o reset — foi exatamente esta a regressão`);
  }
});

// Regressão do PRÓPRIO leitor: `loterias/powerball` só existe como chave COM aspas (tem barra), e a
// primeira versão da regex lia só chave nua — o guard acusava uma suíte que cobria os 4 apps.
// Um leitor de escopo que não consegue ler o app que motivou o guard é pior que inútil.
test("REGRESSÃO: o leitor entende chave com aspas, com apóstrofo e nua", () => {
  const probe = (body) => {
    const src = `const APPS = {\n${body}\n};`;
    const m = src.match(/const APPS\s*=\s*\{([\s\S]*?)\n\};/);
    return new Set([...m[1].matchAll(/^\s{2}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_/-]+))\s*:/gm)]
      .map(x => x[1] ?? x[2] ?? x[3]));
  };
  const got = probe('  "loterias/powerball": {},\n  \'br2026\': {},\n  copa2026: {},');
  for (const k of ["loterias/powerball", "br2026", "copa2026"]) {
    assert(got.has(k), `o leitor de APPS não enxerga a chave ${k}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ TOOL SCOPE SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
