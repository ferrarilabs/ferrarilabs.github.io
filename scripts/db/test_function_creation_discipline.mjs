#!/usr/bin/env node
/**
 * Testes do gate de disciplina de criacao de funcao (Issue #271, opcao B).
 *
 * Os nove casos exigidos pela autorizacao. Cada um monta a DDL como FIXTURE e chama o gate por
 * injecao -- nenhum toca o repositorio real, entao nenhum pode ficar verde por acidente de estado.
 *
 * O caso 9 e o unico que nao e auto-referente: ele confere o modelo estatico contra ACLs LIDAS de
 * um PostgreSQL 17.10 de verdade (`fixtures/function_replay_expectation.json`). Sem ele, os outros
 * oito provariam apenas que o gate concorda consigo mesmo.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { report, MIN_DISCOVERED_FUNCTIONS } from "./audit_function_creation_discipline.mjs";
import { effectiveExecuteAcl } from "./function_birth_acl.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const ddl = (text) => [{ file: "fixture.sql", text }];
const modelo = ({ classifications = {}, ratified = {}, inherited = [] } = {}) =>
  ({ classifications, ratifiedClientExecutors: ratified, inheritedExposure: inherited });
const kinds = (r) => r.achados.map((a) => a.kind);

console.log("\nDISCIPLINA DE CRIACAO DE FUNCAO EM `public` (Issue #271)\n");

// ── 1 ────────────────────────────────────────────────────────────────────────────────────────
test("1. CREATE FUNCTION sem nenhum REVOKE e pego", () => {
  const r = report({
    files: ddl(`create or replace function public.f_new(p text) returns text language sql as $$ select p $$;`),
    model: modelo({ classifications: { "public.f_new/1": { class: "SERVICE_RPC" } } }),
  });
  assert(kinds(r).includes("NON_CLIENT_REACHABLE"),
    `esperava NON_CLIENT_REACHABLE, veio ${JSON.stringify(kinds(r))}`);
});

// ── 2 ────────────────────────────────────────────────────────────────────────────────────────
test("2. heranca de PUBLIC e pega mesmo sem grant nominal a anon/authenticated", () => {
  // Nenhum papel de cliente e mencionado em lugar nenhum da DDL. Um gate que so le GRANT nao ve
  // nada aqui; a exposicao existe assim mesmo, e vem do nascimento.
  const files = ddl(`create or replace function public.f_pub() returns int language sql as $$ select 1 $$;`);
  const st = effectiveExecuteAcl(files, { birth: { publicExecute: true, roles: [] } });
  const e = st.get("public.f_pub/0");
  assert(e.publicExecute === true, "PUBLIC deveria executar por padrao embutido");
  assert(e.roles.size === 0, "nenhum papel nominal deveria aparecer");

  const r = report({ files, model: modelo({ classifications: { "public.f_pub/0": { class: "INTERNAL_FUNCTION" } } }) });
  assert(kinds(r).includes("NON_CLIENT_REACHABLE"), `PUBLIC herdado nao foi pego: ${JSON.stringify(kinds(r))}`);
  const achado = r.achados.find((a) => a.kind === "NON_CLIENT_REACHABLE");
  assert(/PUBLIC/.test(achado.detail), `o achado deveria nomear PUBLIC: ${achado.detail}`);
});

// ── 3 ────────────────────────────────────────────────────────────────────────────────────────
test("3. CREATE OR REPLACE nao restaura acesso inseguro — mas DROP + CREATE restaura, e isso e pego", () => {
  const preservado = effectiveExecuteAcl(ddl(`
    create or replace function public.f_r() returns int language sql as $$ select 1 $$;
    revoke all on function public.f_r() from public, anon, authenticated;
    create or replace function public.f_r() returns int language sql as $$ select 2 $$;
  `)).get("public.f_r/0");
  assert(preservado.publicExecute === false, "CREATE OR REPLACE nao pode ressuscitar PUBLIC");
  assert(!preservado.roles.has("anon"), "CREATE OR REPLACE nao pode ressuscitar anon");

  const recriado = effectiveExecuteAcl(ddl(`
    create or replace function public.f_r() returns int language sql as $$ select 1 $$;
    revoke all on function public.f_r() from public, anon, authenticated;
    drop function public.f_r();
    create or replace function public.f_r() returns int language sql as $$ select 2 $$;
  `)).get("public.f_r/0");
  assert(recriado.publicExecute === true, "DROP + CREATE tem de renascer com PUBLIC — e o vetor real");
  assert(recriado.roles.has("anon"), "DROP + CREATE tem de renascer com os papeis do default");
});

// ── 4 ────────────────────────────────────────────────────────────────────────────────────────
test("4. RPC de cliente com REVOKE PUBLIC + GRANT exato passa", () => {
  const r = report({
    files: ddl(`
      create or replace function public.f_ok(p text) returns text language sql security definer as $$ select p $$;
      revoke all on function public.f_ok(text) from public;
      revoke all on function public.f_ok(text) from anon, authenticated;
      grant execute on function public.f_ok(text) to anon, authenticated;
    `),
    model: modelo({
      classifications: { "public.f_ok/1": { class: "CLIENT_RPC" } },
      ratified: { "public.f_ok/1": ["anon", "authenticated"] },
    }),
  });
  assert(r.achados.length === 0, `deveria passar limpo, veio ${JSON.stringify(r.achados)}`);
});

// ── 5 ────────────────────────────────────────────────────────────────────────────────────────
test("5. funcao interna SECURITY DEFINER exposta a PUBLIC reprova", () => {
  const r = report({
    files: ddl(`create or replace function public.f_int() returns int language sql security definer as $$ select 1 $$;`),
    model: modelo({ classifications: { "public.f_int/0": { class: "INTERNAL_FUNCTION" } } }),
  });
  assert(kinds(r).includes("NON_CLIENT_REACHABLE"), `interna exposta deveria reprovar: ${JSON.stringify(kinds(r))}`);
});

// ── 6 ────────────────────────────────────────────────────────────────────────────────────────
test("6. funcao so-de-servico exposta a authenticated reprova", () => {
  const r = report({
    files: ddl(`
      create or replace function public.f_svc() returns int language sql security definer as $$ select 1 $$;
      revoke all on function public.f_svc() from public, anon;
      grant execute on function public.f_svc() to service_role;
    `),
    model: modelo({ classifications: { "public.f_svc/0": { class: "SERVICE_RPC" } } }),
  });
  // `authenticated` sobrou do default: revogaram anon e PUBLIC e esqueceram dele. E a forma exata
  // de `_bolao_audit` / `_bolao_touch` (Issue #282).
  const a = r.achados.find((x) => x.kind === "NON_CLIENT_REACHABLE");
  assert(a, `deveria reprovar: ${JSON.stringify(kinds(r))}`);
  assert(/authenticated/.test(a.detail), `deveria nomear authenticated: ${a.detail}`);
});

// ── 7 ────────────────────────────────────────────────────────────────────────────────────────
test("7. funcao de extensao nao e classificada como funcao de aplicacao", () => {
  const r = report({
    files: ddl(`
      create extension if not exists citext with schema public;
      create or replace function public.f_app() returns int language sql as $$ select 1 $$;
      revoke all on function public.f_app() from public, anon, authenticated;
    `),
    model: modelo({ classifications: { "public.f_app/0": { class: "INTERNAL_FUNCTION" } } }),
  });
  assert(r.total === 1, `so a funcao de aplicacao deveria ser descoberta, veio ${r.total}`);
  assert(r.achados.length === 0, `citext nao pode gerar achado: ${JSON.stringify(r.achados)}`);
  // E o motivo tem de ser estrutural, nao uma lista de nomes de citext: uma funcao de extensao
  // chega por CREATE EXTENSION e NUNCA tem CREATE FUNCTION na DDL deste repositorio.
  const st = effectiveExecuteAcl(ddl(`create extension if not exists citext with schema public;`));
  assert(st.size === 0, "CREATE EXTENSION nao pode produzir funcao de aplicacao nenhuma");
});

// ── 8 ────────────────────────────────────────────────────────────────────────────────────────
test("8. zero funcoes descobertas nao pode ficar verde", () => {
  const r = report({ files: ddl("-- nenhuma DDL aqui\n"), model: modelo() });
  assert(r.total === 0, "a fixture nao tem funcao nenhuma");
  assert(r.achados.length === 0, "sem funcoes nao ha achado — e exatamente por isso o piso existe");
  assert(MIN_DISCOVERED_FUNCTIONS > 0, "o piso de descoberta tem de ser positivo");
  assert(r.total < MIN_DISCOVERED_FUNCTIONS,
    "com zero descobertas o gate tem de bater no piso e reprovar, em vez de anunciar sucesso");

  // E o piso tem de estar coerente com a arvore real: se o repositorio tem menos funcoes que o
  // piso, o piso esta alto demais e reprovaria main por engano.
  const real = report({ root: ROOT });
  assert(real.total >= MIN_DISCOVERED_FUNCTIONS,
    `o repositorio real tem ${real.total} funcoes e o piso e ${MIN_DISCOVERED_FUNCTIONS}`);
});

// ── 9 ────────────────────────────────────────────────────────────────────────────────────────
test("9. replay limpo concorda com o gate — conferido contra PostgreSQL 17.10 real", () => {
  const exp = JSON.parse(readFileSync(join(HERE, "fixtures/function_replay_expectation.json"), "utf8"));
  const fixture = readFileSync(join(HERE, "fixtures/function_replay_fixture.sql"), "utf8");
  const st = effectiveExecuteAcl(ddl(fixture));

  const nomes = Object.keys(exp.functions);
  assert(nomes.length >= 5, `a expectativa tem de cobrir as cinco formas, tem ${nomes.length}`);

  for (const nome of nomes) {
    const esperado = exp.functions[nome];
    const achado = [...st.entries()].find(([k]) => k.startsWith(`public.${nome}/`));
    assert(achado, `o modelo nao descobriu ${nome}, que o PostgreSQL real criou`);
    const [, v] = achado;
    assert(v.publicExecute === esperado.publicExecute,
      `${nome}: PUBLIC modelado ${v.publicExecute}, PostgreSQL real ${esperado.publicExecute}`);
    assert(v.roles.has("anon") === esperado.anon,
      `${nome}: anon modelado ${v.roles.has("anon")}, PostgreSQL real ${esperado.anon}`);
    assert(v.roles.has("authenticated") === esperado.authenticated,
      `${nome}: authenticated modelado ${v.roles.has("authenticated")}, PostgreSQL real ${esperado.authenticated}`);
  }
});

// ── o gate contra a arvore real ──────────────────────────────────────────────────────────────
test("o repositorio real passa no gate, e a divida declarada e exatamente a medida", () => {
  const r = report({ root: ROOT });
  assert(r.achados.length === 0, `main deveria estar verde: ${JSON.stringify(r.achados.slice(0, 3))}`);
  assert(r.obsoletas.length === 0, `divida ja quitada ainda declarada: ${r.obsoletas.join(", ")}`);
  assert((r.model.inheritedExposure ?? []).length === 14,
    `a catraca comeca em 14 itens medidos; tem ${(r.model.inheritedExposure ?? []).length}`);
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
