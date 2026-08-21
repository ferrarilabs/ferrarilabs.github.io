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
import { report, MIN_DISCOVERED_FUNCTIONS, ddlSources } from "./audit_function_creation_discipline.mjs";
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
  // A catraca caiu de 14 para 3 em 2026-08-21, quando a comparacao com a ACL AO VIVO mostrou que
  // onze das quatorze nunca estiveram expostas em producao -- eram divergencia de RECONSTRUCAO, e
  // `032_codify_notification_function_client_revokes.sql` a fechou. Assertar a COMPOSICAO, e nao so
  // o numero: um total certo com os itens errados passaria despercebido.
  const divida = (r.model.inheritedExposure ?? []).map((e) => e.signature).sort();
  const esperada = ["public._bolao_audit/3", "public._bolao_touch/1", "public.delete_canary_job/1"];
  assert(JSON.stringify(divida) === JSON.stringify(esperada),
    `a divida declarada mudou de composicao: ${JSON.stringify(divida)}`);
  // As duas da #282 sao exposicao REAL ao vivo; a terceira e ordem de replay. Classes diferentes,
  // e cada entrada tem de dizer qual e a sua.
  for (const e of r.model.inheritedExposure ?? []) {
    assert(e.whyStillHere && e.whyStillHere.length > 80, `${e.signature} precisa explicar por que continua declarada`);
    assert(e.liveState, `${e.signature} precisa registrar o que producao mede`);
  }
});

// ══ PUBLIC vs PAPEL NOMEADO — a raiz compartilhada de #282 e #284 ═════════════════════════════
//
// `PUBLIC` e um PSEUDO-PAPEL. `REVOKE ... FROM PUBLIC` NAO remove um grant explicito de `anon` ou
// de `authenticated`: eles tem entrada propria na ACL. Uma funcao pode ficar com PUBLIC=false e
// continuar executavel pelos dois papeis de cliente.
//
// Nao e teoria. `017_n22_narrow_mutations.sql` escreve `revoke execute ... from anon, public` em
// `_bolao_audit` e `_bolao_touch`, e producao mede `{postgres=X, authenticated=X, service_role=X}`
// nas duas ate hoje -- `authenticated` sobreviveu ao revoke de PUBLIC porque nunca foi alvo dele.

test("13. grant explicito de anon SOBREVIVE a REVOKE FROM PUBLIC, e o detector ve", () => {
  const st = effectiveExecuteAcl(ddl(`
    create or replace function public.f_pn(p text) returns text language sql security definer as $$ select p $$;
    grant execute on function public.f_pn(text) to anon;
    revoke execute on function public.f_pn(text) from public;
  `));
  const e = st.get("public.f_pn/1");
  assert(e.publicExecute === false, "o revoke de PUBLIC tem de tirar PUBLIC");
  assert(e.roles.has("anon"), "o grant nominal de anon NAO pode ser removido por um revoke de PUBLIC");

  const r = report({
    files: ddl(`
      create or replace function public.f_pn(p text) returns text language sql security definer as $$ select p $$;
      grant execute on function public.f_pn(text) to anon;
      revoke execute on function public.f_pn(text) from public;
    `),
    model: modelo({ classifications: { "public.f_pn/1": { class: "SERVICE_RPC" } } }),
  });
  const a = r.achados.find((x) => x.kind === "NON_CLIENT_REACHABLE");
  assert(a, `o detector tem de acusar anon sobrevivente: ${JSON.stringify(kinds(r))}`);
  assert(/anon/.test(a.detail), `o achado tem de nomear anon: ${a.detail}`);
});

test("14. grant explicito de authenticated SOBREVIVE a REVOKE FROM PUBLIC — a forma exata da #282", () => {
  // Reproduz `017`: revoga de `anon, public` e esquece `authenticated`.
  const st = effectiveExecuteAcl(ddl(`
    create or replace function public.f_au(p jsonb) returns jsonb language sql as $$ select p $$;
    grant execute on function public.f_au(jsonb) to anon, authenticated, service_role;
    revoke execute on function public.f_au(jsonb) from anon, public;
  `));
  const e = st.get("public.f_au/1");
  assert(e.publicExecute === false, "PUBLIC tem de sair");
  assert(!e.roles.has("anon"), "anon foi revogado nominalmente e tem de sair");
  assert(e.roles.has("authenticated"), "authenticated NAO foi alvo do revoke e tem de permanecer — e o defeito da #282");
  assert(e.roles.has("service_role"), "service_role nao foi tocado");

  const r = report({
    files: ddl(`
      create or replace function public.f_au(p jsonb) returns jsonb language sql as $$ select p $$;
      grant execute on function public.f_au(jsonb) to anon, authenticated, service_role;
      revoke execute on function public.f_au(jsonb) from anon, public;
    `),
    model: modelo({ classifications: { "public.f_au/1": { class: "SERVICE_RPC" } } }),
  });
  const a = r.achados.find((x) => x.kind === "NON_CLIENT_REACHABLE");
  assert(a && /authenticated/.test(a.detail), `o detector tem de acusar authenticated: ${JSON.stringify(r.achados)}`);
});

test("15. os quatro concessionarios sao modelados INDEPENDENTEMENTE", () => {
  // PUBLIC, anon, authenticated e service_role nao podem ser achatados num conjunto so: e assim
  // que se produz um 'revogado' que nao revoga nada.
  const st = effectiveExecuteAcl(ddl(`
    create or replace function public.f_ind() returns int language sql as $$ select 1 $$;
    revoke execute on function public.f_ind() from public;
    revoke execute on function public.f_ind() from anon;
  `));
  const e = st.get("public.f_ind/0");
  assert(e.publicExecute === false, "PUBLIC revogado");
  assert(!e.roles.has("anon"), "anon revogado");
  assert(e.roles.has("authenticated"), "authenticated nao foi tocado e continua");
  assert(e.roles.has("service_role"), "service_role nao foi tocado e continua");
});

test("16. a reconstrucao bate com a ACL pretendida em producao para as doze da #284", () => {
  // Producao mede as doze com `{postgres=X, service_role=X}`. Depois de
  // `032_codify_notification_function_client_revokes.sql`, o replay tem de chegar no mesmo lugar --
  // que e o unico motivo daquele arquivo existir (ele e no-op contra o estado ao vivo).
  const doze = ["bolao_notif_health/1", "bolao_notif_status_by_pool/1", "enqueue_bolao_notif/11",
    "get_bolao_notif_content_hash/1", "get_bolao_notif_recipients/1", "mark_bolao_notif_permanent/2",
    "mark_bolao_notif_retryable/2", "mark_bolao_notif_sent/2", "release_expired_bolao_notif/1",
    "set_bolao_notif_recipient/5", "settle_bolao_notif/1"];
  const st = effectiveExecuteAcl(ddlSources({ root: ROOT }));
  for (const sig of doze) {
    const e = st.get(`public.${sig}`);
    assert(e, `${sig} deveria existir no replay`);
    assert(e.publicExecute === false, `${sig}: PUBLIC nao pode executar`);
    assert(!e.roles.has("anon"), `${sig}: anon nao pode executar numa reconstrucao limpa`);
    assert(!e.roles.has("authenticated"), `${sig}: authenticated nao pode executar numa reconstrucao limpa`);
    assert(e.roles.has("service_role"), `${sig}: service_role TEM de continuar — o produtor confiavel a chama`);
  }
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
