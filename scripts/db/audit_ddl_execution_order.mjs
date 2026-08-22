#!/usr/bin/env node
/**
 * MODELO DE EXECUCAO DA DDL — Issue #292.
 *
 * ─── O QUE ESTE GATE IMPEDE ──────────────────────────────────────────────────────────────────
 *
 * Que uma regra de seguranca viva num arquivo que ninguem executa, ou numa posicao da ordem em que
 * ela nao alcanca o objeto que deveria proteger -- e mesmo assim conte como remediacao.
 *
 * Foi o que aconteceu com a Issue #135: `031_codify_bolao_state_public_views_revoke.sql` revoga
 * privilegio de duas views criadas pela migracao `20260813200000`, mas os gates ordenavam TODO
 * `bolao/shared/sql/**` ANTES de `supabase/migrations/**`. O revoke rodava antes do CREATE, nao
 * alcancava nada, e o modelo dizia que as views nascem gravaveis por `anon`. A remediacao existia,
 * estava commitada, tinha Issue fechada -- e nao governava coisa alguma.
 *
 * ─── O QUE ELE VERIFICA ──────────────────────────────────────────────────────────────────────
 *
 * 1. TODO arquivo `.sql` de `supabase/migrations/**` e `bolao/shared/sql/**` esta classificado.
 *    Sem classe -> UNKNOWN -> reprova (fail closed).
 * 2. A classificacao bate com a realidade verificavel: arquivo com prefixo de 14 digitos em
 *    `supabase/migrations` e EXECUTED_BY_CLI; arquivo sem esse prefixo naquele diretorio nao pode
 *    reivindicar execucao pelo CLI.
 * 3. Todo arquivo executavel declara `appliedAt` -- sem instante nao ha ordem, e sem ordem o
 *    defeito da #135 volta.
 * 4. A paridade com o ledger de producao continua declarada e coerente.
 * 5. NENHUM `revoke` de um arquivo executavel fica orfao: se um arquivo revoga privilegio de um
 *    objeto que, NAQUELE PONTO da ordem, ainda nao foi criado, isso e um revoke que nao morde --
 *    exatamente a #135 -- e reprova.
 *
 * O item 5 e o coracao: e o unico que observa SEMANTICA EXECUTAVEL em vez de acreditar no arquivo.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_ddl_execution_order.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadExecutionModel, orderedDdlSources, EXECUTED_CLASSES } from "./ddl_execution_order.mjs";
import { stripSqlComments } from "./secdef_ddl_parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CLASSES = Object.freeze([...EXECUTED_CLASSES, "DOCUMENTATION_ONLY"]);

/** Todo `.sql` que o modelo tem obrigacao de classificar. */
export function ddlInventory({ root = ROOT } = {}) {
  const out = [];
  for (const rel of ["supabase/migrations", "bolao/shared/sql"]) {
    const dir = join(root, rel);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) out.push(`${rel}/${f}`);
  }
  return out;
}

const CREATE_RE = /create\s+(?:or\s+replace\s+)?(?:table|(?:materialized\s+)?view)\s+(?:if\s+not\s+exists\s+)?(?:"?[a-z0-9_]+"?\s*\.\s*)?"?([a-z0-9_]+)"?/gi;
const REVOKE_RE = /revoke\s+[a-z, \t\r\n]+?\s+on\s+(?:table\s+)?((?:"?[a-z0-9_]+"?\s*\.\s*)?"?[a-z0-9_]+"?(?:\s*,\s*(?:"?[a-z0-9_]+"?\s*\.\s*)?"?[a-z0-9_]+"?)*)\s+from\s+[^;]+;/gi;

/**
 * Revokes que, na ordem declarada, incidem sobre relacao ainda inexistente.
 *
 * Deliberadamente so olha RELACAO (`on table`/view). Funcao tem assinatura e um parser proprio;
 * misturar as duas aqui daria falso positivo em cima de sobrecarga.
 */
export function orphanRevokes({ root = ROOT, files } = {}) {
  const src = files ?? orderedDdlSources({ root });
  const existentes = new Set();
  const orfaos = [];
  for (const f of src) {
    // `ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON TABLES FROM ...` nao revoga de uma relacao
    // chamada "tables": e o default do schema. Deixar essa forma no texto faria o detector acusar
    // `tables` e `sequences` como objetos inexistentes -- alarme falso, e alarme falso num gate de
    // seguranca gasta a confianca ate ninguem mais ler a saida.
    const texto = stripSqlComments(f.text)
      .replace(/alter\s+default\s+privileges[^;]*;/gi, " ");
    const eventos = [];
    let m;
    CREATE_RE.lastIndex = 0;
    while ((m = CREATE_RE.exec(texto)) !== null) eventos.push({ at: m.index, kind: "create", rel: m[1] });
    REVOKE_RE.lastIndex = 0;
    while ((m = REVOKE_RE.exec(texto)) !== null) {
      for (const alvo of m[1].split(",").map((t) => t.replace(/["';]/g, "").trim().split(".").pop())) {
        eventos.push({ at: m.index, kind: "revoke", rel: alvo });
      }
    }
    eventos.sort((a, b) => a.at - b.at);
    for (const e of eventos) {
      if (e.kind === "create") { existentes.add(e.rel); continue; }
      if (!existentes.has(e.rel)) orfaos.push({ file: f.file, rel: e.rel });
    }
  }
  return orfaos;
}

export function report({ root = ROOT, model } = {}) {
  const m = model ?? loadExecutionModel({ root });
  // A classificacao vale para o que esta DECLARADO mais o que se descreve sozinho: migracao com
  // prefixo de 14 digitos e derivada do disco (ver `derivedMigrations`). Um arquivo em
  // `supabase/migrations` SEM esse prefixo continua exigindo declaracao -- e o caso do baseline
  // `.reference.sql`, que e DOCUMENTATION_ONLY de proposito.
  const derivadas = new Map(orderedDdlSources({ root })
    .filter((f) => !m.files.some((d) => d.path === f.file))
    .map((f) => [f.file, { path: f.file, class: "EXECUTED_BY_CLI", appliedAt: "derived" }]));
  const declarados = new Map([...derivadas, ...m.files.map((f) => [f.path, f])]);
  const inventario = ddlInventory({ root });

  const semClasse = inventario.filter((p) => {
    const d = declarados.get(p);
    return !d || !CLASSES.includes(d.class);
  });
  const fantasmas = [...declarados.keys()].filter((p) => !existsSync(join(root, p)));
  const semInstante = [...declarados.values()].filter((f) => EXECUTED_CLASSES.includes(f.class) && !f.appliedAt).map((f) => f.path);

  const cliErrado = [...declarados.values()].filter((f) =>
    f.class === "EXECUTED_BY_CLI" && !/^supabase\/migrations\/\d{14}_/.test(f.path)).map((f) => f.path);

  const lp = m.ledgerParity ?? {};
  const ledgerOk = lp.repoMigrations === lp.productionLedgerVersions
    && lp.missingFromProduction === 0 && lp.missingFromRepo === 0;

  return { model: m, inventario, semClasse, fantasmas, semInstante, cliErrado, ledgerOk,
           orfaos: orphanRevokes({ root }) };
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nModelo de execucao da DDL (Issue #292)\n");
  const r = report();

  check(`todo arquivo .sql executavel esta classificado (${r.inventario.length})`, r.semClasse.length === 0,
    r.semClasse.length ? `sem classe valida — UNKNOWN reprova fechado:\n      ${r.semClasse.join("\n      ")}`
      : `${r.model.files.length} declarados, nenhum UNKNOWN`);

  check("nenhum arquivo declarado sumiu do disco", r.fantasmas.length === 0,
    r.fantasmas.length ? `declarado e inexistente: ${r.fantasmas.join(", ")}` : "inventario e manifesto batem");

  check("todo arquivo executavel tem instante de aplicacao", r.semInstante.length === 0,
    r.semInstante.length ? `sem \`appliedAt\`, portanto sem ordem: ${r.semInstante.join(", ")}` : "a ordem e derivavel para todos");

  check("EXECUTED_BY_CLI so para arquivo que o CLI realmente enxerga", r.cliErrado.length === 0,
    r.cliErrado.length ? `nao casa \`supabase/migrations/<14 digitos>_\`: ${r.cliErrado.join(", ")}`
      : "so migracoes com timestamp reivindicam execucao pelo CLI");

  check("a paridade com o ledger de producao continua declarada e coerente", r.ledgerOk,
    r.ledgerOk ? `${r.model.ledgerParity.repoMigrations} migracoes = ${r.model.ledgerParity.productionLedgerVersions} versoes no ledger`
      : `paridade incoerente: ${JSON.stringify(r.model.ledgerParity)}`);

  check("nenhum REVOKE incide sobre relacao ainda inexistente na ordem", r.orfaos.length === 0,
    r.orfaos.length
      ? `revoke que NAO MORDE — o objeto ainda nao existe neste ponto (foi o defeito da #135):\n      `
        + r.orfaos.map((o) => `${o.file} -> ${o.rel}`).join("\n      ")
      : "todo revoke alcanca um objeto que ja existe");

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
