/**
 * audit_html_table_structure.mjs — gate estrutural de HTML de tabela.
 *
 * Por que este gate existe (incidente 2026-08-10):
 * um replace em massa de `<th` para `<th scope="col"` — feito para satisfazer o gate de
 * acessibilidade — casou também dentro de `<thead>`, produzindo `<th scope="col"ead>` em
 * TODAS as 22 ocorrências de `<thead>` da plataforma. Nenhum gate existente viu: o de
 * acessibilidade só conferia se todo `<th>` tinha `scope`, e todos tinham. O HTML quebrado
 * vivia dentro de template literals em js/app.js (recibos, ranking, tabelas de palpites),
 * então validadores de HTML estático também não alcançavam.
 *
 * Este gate portanto valida o HTML GERADO — o conteúdo dos template literals — e não apenas
 * os arquivos .html. Um gate que só olha .html seria falso-verde para esta plataforma, onde
 * praticamente toda tabela é montada em JS.
 *
 * Uso: node bolao/scripts/audit_html_table_structure.mjs
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TARGETS = [
  "bolao/br2026/js/app.js",
  "bolao/cdb2026/js/app.js",
  "bolao/copa2026/js/app.js",
  "bolao/br2026/index.html",
  "bolao/cdb2026/index.html",
  "bolao/copa2026/index.html",
];

const failures = [];
const stats = { files: 0, tags: 0, tables: 0 };

/**
 * Tag cujo nome é seguido imediatamente por lixo colado no fim de um valor de atributo.
 * Pega exatamente a classe de corrupção do incidente: `<th scope="col"ead>` — atributo
 * entre aspas seguido por letras coladas antes do `>`. Um HTML válido nunca tem isso:
 * depois de fechar aspas de atributo vem espaço, `>` ou `/>`.
 */
const CORRUPT_ATTR = /<[a-zA-Z][^>]*"[a-zA-Z]+\s*>/g;

/** Tag de abertura/fechamento normal. */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

const TABLE_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr", "th", "td"]);
const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "source"]);

/**
 * Remove comentários JS antes de contar tags. Sem isto o gate acusa desbalanceamento por
 * causa de comentários que citam `<table>` em prosa (ex.: br2026/js/app.js:2702) — um falso
 * positivo que, se "corrigido" no código, faria alguém mexer em HTML que estava correto.
 * O `//` só é tratado como comentário quando não é o `//` de um protocolo (`https://`).
 */
function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function check(relPath, source, isJs) {
  stats.files++;
  if (isJs) source = stripJsComments(source);

  // 1. Corrupção de atributo — a regressão exata do incidente.
  for (const m of source.matchAll(CORRUPT_ATTR)) {
    const line = source.slice(0, m.index).split("\n").length;
    failures.push(`${relPath}:${line} tag corrompida (lixo colado após valor de atributo): ${m[0].slice(0, 60)}`);
  }

  // 2. Balanceamento das tags de tabela. Um `<thead>` corrompido vira texto solto e o
  //    `</thead>` correspondente fica órfão — este contador pega isso mesmo que a corrupção
  //    tenha outra forma que a regex acima não preveja.
  const counts = {};
  for (const m of source.matchAll(TAG)) {
    stats.tags++;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const selfClosing = m[3] === "/";
    if (!TABLE_TAGS.has(name)) continue;
    if (selfClosing || VOID_TAGS.has(name)) continue;
    counts[name] = counts[name] || { open: 0, close: 0 };
    counts[name][closing ? "close" : "open"]++;
  }
  if (counts.table) stats.tables += counts.table.open;

  // `tr`/`th`/`td` aparecem legitimamente sem fechamento explícito em HTML tolerante, e
  // template literals podem abrir uma tabela num trecho e fechar noutro. Só exigimos
  // balanceamento das tags de seção, que na prática desta plataforma são sempre emitidas
  // no mesmo literal e cuja assimetria foi justamente o sintoma do bug.
  for (const name of ["thead", "tbody", "tfoot", "table"]) {
    const c = counts[name];
    if (!c) continue;
    if (c.open !== c.close) {
      failures.push(
        `${relPath}: <${name}> desbalanceado — ${c.open} abertura(s) para ${c.close} fechamento(s)`
      );
    }
  }

  // 3. Todo `<th>` precisa de scope (preserva a garantia de acessibilidade que o replace
  //    original tentava obter — sem ela, "consertar" o gate reintroduziria o problema antigo).
  for (const m of source.matchAll(/<th\b([^>]*)>/g)) {
    if (!/\bscope\s*=/.test(m[1])) {
      const line = source.slice(0, m.index).split("\n").length;
      failures.push(`${relPath}:${line} <th> sem scope=: ${m[0].slice(0, 60)}`);
    }
  }
}

for (const rel of TARGETS) {
  let src;
  try {
    src = readFileSync(join(ROOT, rel), "utf8");
  } catch {
    failures.push(`${rel}: arquivo alvo não encontrado (o gate perderia cobertura silenciosamente)`);
    continue;
  }
  check(rel, src, rel.endsWith(".js"));
}

console.log("audit_html_table_structure — validade estrutural de tabelas (HTML estático + gerado)");
console.log(`  arquivos: ${stats.files}  tags analisadas: ${stats.tags}  <table> encontradas: ${stats.tables}`);

if (stats.tables === 0) {
  // Proteção contra falso-verde: se a extração parar de encontrar tabelas, o gate passaria
  // vazio para sempre. Nenhuma tabela = o gate está quebrado, não o código está limpo.
  console.error("\n🛑 FALHOU: nenhuma <table> encontrada — o gate perdeu cobertura.");
  process.exit(1);
}

if (failures.length) {
  console.error(`\n🛑 FALHOU: ${failures.length} problema(s) estrutural(is):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\n✓ NO_MALFORMED_THEAD / VALID_TABLE_STRUCTURE — nenhum problema encontrado.");
