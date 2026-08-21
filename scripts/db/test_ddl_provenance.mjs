#!/usr/bin/env node
/**
 * CONTRATO DA PROVENIENCIA DE DDL — Issue #266.
 *
 * Um inventario que sempre diz "tudo certo" e um enfeite. Esta suite prova que o detector
 * DISTINGUE: acha o criador quando ele existe, e NAO acha quando ele nao existe.
 *
 * O caso negativo e o que importa. A Issue #133 nasceu porque um grep ancorado no diretorio
 * errado devolveu menos objetos do que existem, e ninguem tinha como perceber. Aqui, um objeto
 * exigido sem arquivo que o crie reprova, por construcao.
 *
 * Sem rede e sem banco: le apenas arquivos .sql do repositorio.
 *
 * Uso: node scripts/db/test_ddl_provenance.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DDL_SOURCES, creatorsOf } from "./audit_ddl_provenance.mjs";
import { REQUIRED_TABLES, REQUIRED_VIEWS } from "./acceptance_checks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const files = [];
for (const src of DDL_SOURCES) {
  let names = [];
  try { names = readdirSync(join(ROOT, src.dir)).filter((f) => f.endsWith(".sql")); } catch { /* ausente */ }
  for (const f of names) files.push({ ...src, file: `${src.dir}/${f}`, text: readFileSync(join(ROOT, src.dir, f), "utf8") });
}

console.log("\nContrato da proveniencia de DDL (Issue #266)\n");

test("as duas fontes de DDL estao declaradas, e uma delas e o ledger", () => {
  assert(DDL_SOURCES.length === 2, `esperado 2 fontes, veio ${DDL_SOURCES.length}`);
  assert(DDL_SOURCES.filter((s) => s.ledger).length === 1, "exatamente uma fonte e o ledger");
  assert(DDL_SOURCES.every((s) => typeof s.why === "string" && s.why.length > 20),
    "toda fonte precisa de motivo escrito — uma fonte sem motivo vira conhecimento tribal");
});

test("acha o criador de cada objeto EXIGIDO", () => {
  const sem = [];
  for (const [kind, names] of [["table", REQUIRED_TABLES], ["view", REQUIRED_VIEWS]]) {
    for (const n of names) if (creatorsOf(n, kind, files).length === 0) sem.push(`${kind} ${n}`);
  }
  assert(sem.length === 0, `sem criador: ${sem.join("; ")}`);
});

test("NAO inventa criador para um objeto que nao existe", () => {
  assert(creatorsOf("tabela_que_nunca_existiu_xyz", "table", files).length === 0,
    "casou com algo — o detector estaria sempre verde");
});

test("a tabela fora do ledger e atribuida ao arquivo certo", () => {
  const c = creatorsOf("bolao_round_notif_jobs", "table", files);
  assert(c.length > 0, "nao achou criador");
  assert(c.every((f) => f.startsWith("bolao/shared/sql/")),
    `deveria vir apenas de bolao/shared/sql: ${c.join(", ")}`);
  assert(!c.some((f) => f.startsWith("supabase/migrations/")),
    "nao pode ser atribuida ao ledger — e exatamente esse o ponto da Issue #266");
});

test("DROP nao conta como criacao", () => {
  const sintetico = [{ file: "x.sql", text: "drop table public.bolao_state;\ndrop view public.bolao_state_public;" }];
  assert(creatorsOf("bolao_state", "table", sintetico).length === 0, "DROP foi lido como CREATE");
  assert(creatorsOf("bolao_state_public", "view", sintetico).length === 0, "DROP VIEW foi lido como CREATE");
});

test("aceita as formas de CREATE realmente usadas no repositorio", () => {
  const casos = [
    ['create table if not exists cdb_entry_access (', "cdb_entry_access", "table"],
    ['CREATE TABLE "public"."bolao_entry_private" (', "bolao_entry_private", "table"],
    ['create or replace view public.bolao_state_public as', "bolao_state_public", "view"],
    ['CREATE OR REPLACE VIEW public.bolao_state_normalized_public AS', "bolao_state_normalized_public", "view"],
  ];
  for (const [sql, nome, kind] of casos) {
    assert(creatorsOf(nome, kind, [{ file: "s.sql", text: sql }]).length === 1, `nao casou: ${sql}`);
  }
});

test("nome parecido nao casa (prefixo nao e o objeto)", () => {
  const sintetico = [{ file: "x.sql", text: "create table public.bolao_state_backup (id text);" }];
  assert(creatorsOf("bolao_state", "table", sintetico).length === 0,
    "`bolao_state` casou com `bolao_state_backup` — proveniencia por prefixo daria criador errado");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ DDL PROVENANCE CONTRACT FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
