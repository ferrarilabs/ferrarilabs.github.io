#!/usr/bin/env node
/**
 * CONTRATO DO GATE DE DEFAULT PRIVILEGES — Issue #271.
 *
 * O gate so vale se ficar vermelho nos casos certos. Esta suite exercita cada um deles com DDL
 * sintetica, incluindo os dois que custaram mais caro para descobrir: que `ALTER DEFAULT
 * PRIVILEGES` e POR PAPEL CRIADOR (consertar um deixa o outro intacto) e que `CREATE FUNCTION`
 * sempre concede EXECUTE a PUBLIC, o que faz uma reconstrucao limpa divergir de producao.
 *
 * Sem rede e sem banco. Uso: node scripts/db/test_default_privileges.mjs
 */

import { defaultExposure, hasExplicitGrant, revokesPublic, ddlSources } from "./audit_default_privileges.mjs";

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const f = (file, text) => ({ file, text });

const ADP = (verb, creator, cls, roles) =>
  `alter default privileges for role ${creator} in schema public ${verb} all on ${cls} ${verb === "grant" ? "to" : "from"} ${roles};`;

console.log("\nContrato do gate de default privileges (Issue #271)\n");

test("1. default TABLES concedido a papel de cliente e detectado", () => {
  const e = defaultExposure([f("001.sql", ADP("grant", "postgres", "TABLES", "anon, authenticated, service_role"))], "postgres", "TABLES");
  assert(e.length === 3, `esperava 3 papeis expostos, veio ${JSON.stringify(e)}`);
});

test("2. default SEQUENCES concedido e detectado", () => {
  const e = defaultExposure([f("001.sql", ADP("grant", "postgres", "SEQUENCES", "anon"))], "postgres", "SEQUENCES");
  assert(e.includes("anon"), `veio ${JSON.stringify(e)}`);
});

test("3. default FUNCTIONS concedido e detectado", () => {
  const e = defaultExposure([f("001.sql", ADP("grant", "postgres", "FUNCTIONS", "authenticated"))], "postgres", "FUNCTIONS");
  assert(e.includes("authenticated"), `veio ${JSON.stringify(e)}`);
});

test("4. revogar depois de conceder zera a exposicao (a ordem manda)", () => {
  const files = [f("001.sql", ADP("grant", "postgres", "TABLES", "anon, authenticated, service_role")),
                 f("002.sql", ADP("revoke", "postgres", "TABLES", "anon, authenticated, service_role"))];
  assert(defaultExposure(files, "postgres", "TABLES").length === 0, "deveria estar limpo");
});

test("5. A ARMADILHA: consertar `postgres` NAO conserta `supabase_admin`", () => {
  const files = [
    f("001.sql", ADP("grant", "postgres", "TABLES", "anon") + "\n" + ADP("grant", "supabase_admin", "TABLES", "anon")),
    f("002.sql", ADP("revoke", "postgres", "TABLES", "anon")),
  ];
  assert(defaultExposure(files, "postgres", "TABLES").length === 0, "postgres deveria estar limpo");
  assert(defaultExposure(files, "supabase_admin", "TABLES").includes("anon"),
    "supabase_admin TEM de continuar exposto — e o meio-conserto que passa em todo teste local feito como postgres");
});

test("6. RECONSTRUCAO LIMPA: view sem GRANT explicito e detectada", () => {
  assert(!hasExplicitGrant([f("001.sql", "create view public.v as select 1;")], "v", "view"),
    "uma view sem grant nao pode contar como servida");
  assert(hasExplicitGrant([f("001.sql", "grant select on table public.v to anon;")], "v", "view"),
    "com grant explicito deveria contar");
});

test("7. RECONSTRUCAO LIMPA: RPC sem GRANT explicito e detectada", () => {
  assert(!hasExplicitGrant([f("001.sql", "create function public.r() returns int language sql as 'select 1';")], "r", "function"), "sem grant nao conta");
  assert(hasExplicitGrant([f("001.sql", "grant execute on function public.r() to anon;")], "r", "function"), "com grant conta");
});

test("8. PUBLIC em funcao: revoke direto e reconhecido", () => {
  assert(revokesPublic([f("001.sql", "revoke all on function public.r(text) from public;")], "r"), "revoke direto deveria contar");
  assert(!revokesPublic([f("001.sql", "grant execute on function public.r(text) to anon;")], "r"), "so grant nao revoga PUBLIC");
});

test("9. PUBLIC em funcao: o laco DINAMICO tambem e reconhecido", () => {
  // 20260812090000 revoga em laco; um gate que so procurasse a forma direta reprovaria 50 funcoes
  // corretas e ensinaria todo mundo a ignorar a saida.
  const loop = `for f in select ... loop execute format('revoke all on function %s from public', f); end loop; -- r`;
  assert(revokesPublic([f("001.sql", loop)], "r"), "o laco dinamico deveria contar");
});

test("10. o repositorio real passa em todas as condicoes acima", () => {
  const files = ddlSources();
  assert(files.length > 0, "sem DDL");
  assert(defaultExposure(files, "postgres", "TABLES").length === 0, "postgres/TABLES ainda expoe");
  assert(defaultExposure(files, "postgres", "SEQUENCES").length === 0, "postgres/SEQUENCES ainda expoe");
});

test("11. o gate ENXERGA a metade que ficou aberta, em vez de ficar verde sobre ela", () => {
  // O baseline capturado registra os defaults dos DOIS papeis criadores, entao a DDL descreve
  // tambem o que ainda nao foi consertado. Este teste exige que o gate continue vendo isso: um
  // meio-conserto que apagasse a evidencia do outro papel seria pior que nao consertar nada.
  //
  // Quando `supabase_admin` finalmente for fechado (precisa de canal com mais privilegio -- a
  // tentativa deu `ERROR: 42501: permission denied to change default privileges`), este teste
  // falha e obriga a atualizar a declaracao conscientemente.
  const files = ddlSources();
  for (const cls of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
    const sa = defaultExposure(files, "supabase_admin", cls);
    assert(sa.length === 3, `supabase_admin/${cls} deveria continuar visivelmente exposto aos 3 papeis; veio ${JSON.stringify(sa)}`);
  }
  // postgres/FUNCTIONS tambem continua aberto -- mas por DECISAO DE ESCOPO, nao por impossibilidade.
  // A justificativa antiga ("PUBLIC nao e suprimivel") estava errada e foi corrigida em 2026-08-21:
  // a forma GLOBAL do default do criador suprime de fato; a forma por schema e que nao. O que
  // bloqueia e o alcance da forma global (banco inteiro, nao so `public`). Ver
  // `bolao/shared/safety/default_privileges_state.json` e `scripts/db/function_birth_acl.mjs`.
  const pf = defaultExposure(files, "postgres", "FUNCTIONS");
  assert(pf.length === 3, `postgres/FUNCTIONS deveria continuar declarado como aberto; veio ${JSON.stringify(pf)}`);
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
