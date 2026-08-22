#!/usr/bin/env node
/**
 * Testes da decisao explicita de privilegio por tabela (Issue #271).
 *
 * O controle negativo e o que faz os outros valerem: uma tabela nova, com CRUD de cliente e SEM
 * decisao declarada, tem de reprovar. Sem isso o gate seria uma lista que concorda consigo mesma.
 */

import { report, CRUD } from "./audit_table_client_decisions.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/**
 * Fixture que comeca DEPOIS de `SECURE_DEFAULTS_FROM`, para a tabela nascer LIMPA.
 *
 * Sem esse arquivo o modelo semeia a ACL de NASCIMENTO (o default de `public` concedia os sete
 * privilegios a anon/authenticated/service_role), e o teste mediria a heranca em vez do GRANT que
 * ele quer isolar. `t_nova` no caso 2 faz o contrario de proposito: nasce ANTES, para reproduzir
 * exatamente como `bolao_round_notif_jobs` ganhou privilegio sem ninguem escrever um GRANT.
 */
const ddl = (text) => [
  { file: "supabase/migrations/20260821030000_secure_default_privileges_public.sql", text: "-- marco de defaults seguros\n" },
  { file: "supabase/migrations/29999999999999_fixture.sql", text },
];
const model = (tables, over = {}) => ({ clientRoles: ["anon", "authenticated"], tables, ...over });

console.log("\nDECISAO DE PRIVILEGIO DE CLIENTE POR TABELA (Issue #271)\n");

test("1. a arvore real passa", () => {
  const r = report({ root: ROOT });
  assert(r.achados.length === 0, JSON.stringify(r.achados.slice(0, 3)));
  assert(r.naoDeclaradas.length === 0, `nao declaradas: ${r.naoDeclaradas.join(", ")}`);
  assert(r.quitadas.length === 0, `divida quitada ainda declarada: ${r.quitadas.join(", ")}`);
});

test("2. CONTROLE NEGATIVO: tabela nova com CRUD de cliente e SEM decisao reprova", () => {
  // Nasce antes de `SECURE_DEFAULTS_FROM`, logo herda a ACL de nascimento — que e exatamente como
  // `bolao_round_notif_jobs` ganhou TRUNCATE sem ninguem escrever um GRANT.
  const r = report({
    files: [{ file: "bolao/shared/sql/001_fixture.sql", text: "create table public.t_nova (id uuid primary key);" }],
    model: model({}),
  });
  assert(r.naoDeclaradas.includes("t_nova"), `esperava t_nova como nao declarada: ${JSON.stringify(r.naoDeclaradas)}`);
});

test("3. privilegio ALEM do decidido reprova, e nomeia papel e verbo", () => {
  const r = report({
    files: ddl(`create table public.t_x (id uuid primary key);
                grant select, insert on table public.t_x to anon;`),
    model: model({ t_x: { anon: ["SELECT"], authenticated: [], why: "so leitura publica, decidido assim para o teste" } }),
  });
  const a = r.achados.find((x) => x.tbl === "t_x" && x.priv === "INSERT" && x.role === "anon");
  assert(a, `esperava achado anon/INSERT: ${JSON.stringify(r.achados)}`);
  assert(!r.achados.some((x) => x.priv === "SELECT"), "SELECT foi decidido e nao pode virar achado");
});

test("4. PUBLIC com CRUD reprova mesmo que a decisao nomeie os papeis", () => {
  const r = report({
    files: ddl(`create table public.t_p (id uuid primary key);
                grant select on table public.t_p to public;`),
    model: model({ t_p: { anon: CRUD, authenticated: CRUD, why: "decisao permissiva de proposito, para o teste" } }),
  });
  assert(r.achados.some((a) => a.role === "PUBLIC"),
    "PUBLIC alcanca papel que a decisao nao nomeou e nunca pode ser coberto por ela");
});

test("5. decisao sem motivo escrito reprova", () => {
  const r = report({
    files: ddl("create table public.t_m (id uuid primary key);"),
    model: model({ t_m: { anon: [], authenticated: [], why: "curto" } }),
  });
  assert(r.semDecisao.includes("t_m"), "decisao precisa de motivo escrito e especifico");
});

test("6. divida que ficou limpa tem de sair do arquivo", () => {
  const r = report({
    files: ddl(`create table public.t_d (id uuid primary key);
                revoke all on table public.t_d from anon, authenticated;`),
    model: model({ t_d: { anon: CRUD, authenticated: CRUD, debt: true, why: "divida declarada para o teste da catraca" } }),
  });
  assert(r.quitadas.includes("t_d"), "a catraca so aperta se a divida quitada precisar sair");
});

test("7. view NAO entra neste gate — ela tem o seu proprio", () => {
  // Confundir os dois produziria alarme falso em cima de `bolao_state_public*`, que sao governadas
  // por `audit_public_projection_privs`.
  const r = report({
    files: ddl(`create view public.v_only as select 1 as a;
                grant select on table public.v_only to anon;`),
    model: model({}),
  });
  assert(!r.naoDeclaradas.includes("v_only"), "view nao pode ser cobrada por este gate");
});

test("8. pseudo-nome de ALTER DEFAULT PRIVILEGES nao vira tabela", () => {
  const r = report({
    files: ddl("alter default privileges for role postgres in schema public grant all on tables to anon;"),
    model: model({}),
  });
  for (const falso of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
    assert(!r.naoDeclaradas.includes(falso), `${falso} e pseudo-nome, nao tabela`);
  }
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
