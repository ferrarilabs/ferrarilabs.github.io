#!/usr/bin/env node
/**
 * Testes do gate de CRUD de cliente nas tabelas-base protegidas (Issue #131).
 *
 * O contrato desta suite: o gate tem de MORDER quando um papel de cliente ganha acesso direto, e
 * tem de FICAR QUIETO quando o acesso e uma view publica intencional ou uma RPC. As duas metades
 * importam igualmente -- um detector que reprova a view legitima e desligado na semana seguinte, e
 * a exposicao volta junto.
 */

import { report, CRUD, MIN_PROTECTED_TABLES_SEEN, ddlSources } from "./audit_lottery_client_crud.mjs";
import { tablePrivState } from "./client_table_privs_model.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const TBL = "lottery_participants";
const ddl = (text) => [{ file: "supabase/migrations/29999999999999_fixture.sql", text }];

/** Estado declarado minimo: uma tabela protegida, nenhuma divida, nenhuma ratificacao. */
const estado = (over = {}) => ({
  protectedBaseTables: [TBL],
  pendingRemediation: [],
  ratified: [],
  publicViewsOverProtectedSources: [],
  intendedRpcs: [],
  ...over,
});

// A tabela precisa NASCER antes de 20260821030000 para herdar o default medido -- e o caso real
// das seis. `create table` num arquivo de migracao anterior faz exatamente isso.
const nasceExposta = `create table if not exists public.${TBL} (id uuid primary key);`;
const kinds = (r) => r.achados.map((a) => a.kind);

console.log("\nCRUD DE CLIENTE EM TABELA-BASE PROTEGIDA (Issue #131)\n");

test("1. tabela protegida que nasce com o default e pega, sem nenhum GRANT escrito", () => {
  // Este e o caso que separa este gate de um que le statements: nao existe a palavra GRANT no
  // fixture, e a exposicao esta la.
  const r = report({ files: [{ file: "bolao/shared/sql/001_fixture.sql", text: nasceExposta }], state: estado() });
  assert(!/grant/i.test(nasceExposta), "o fixture nao pode conter GRANT — o ponto do teste e que nao ha nenhum");
  assert(kinds(r).includes("WIDENED"), `esperava WIDENED por heranca de nascimento, veio ${JSON.stringify(kinds(r))}`);
  for (const p of CRUD) assert(r.achados.some((a) => a.priv === p), `${p} deveria aparecer`);
});

test("2. GRANT explicito de SELECT a anon numa tabela protegida reprova", () => {
  const r = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);\ngrant select on table public.${TBL} to anon;`),
    state: estado(),
  });
  const a = r.achados.find((x) => x.role === "anon" && x.priv === "SELECT");
  assert(a, `esperava achado para anon/SELECT, veio ${JSON.stringify(r.achados)}`);
});

test("3. GRANT de INSERT a authenticated reprova", () => {
  const r = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);\ngrant insert on table public.${TBL} to authenticated;`),
    state: estado(),
  });
  assert(r.achados.some((x) => x.role === "authenticated" && x.priv === "INSERT"),
    `esperava achado para authenticated/INSERT, veio ${JSON.stringify(r.achados)}`);
});

test("4. heranca de PUBLIC e pega, e NUNCA e coberta pela divida declarada", () => {
  const r = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);\ngrant select on table public.${TBL} to public;`),
    // A divida declara anon e authenticated com SELECT: mesmo assim PUBLIC tem de reprovar,
    // porque PUBLIC alcanca papeis que a divida nao nomeia.
    state: estado({ pendingRemediation: [{ table: TBL, anon: ["SELECT"], authenticated: ["SELECT"], issue: 131 }] }),
  });
  assert(kinds(r).includes("PUBLIC_INHERITED"), `PUBLIC deveria reprovar mesmo com divida declarada: ${JSON.stringify(kinds(r))}`);
});

test("5. SELECT de anon numa VIEW publica sobre fonte protegida NAO e alarme", () => {
  // A regra e sobre acesso DIRETO a tabela-base. Proibir a view legitima e como o detector morre.
  const r = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);
      revoke all on table public.${TBL} from anon, authenticated;
      create or replace view public.lottery_pool_summary as select id from public.${TBL};
      revoke all on table public.lottery_pool_summary from public;
      grant select on table public.lottery_pool_summary to anon, authenticated;`),
    state: estado(),
  });
  assert(r.achados.length === 0, `a view publica nao pode gerar achado: ${JSON.stringify(r.achados)}`);
});

test("6. RPC que le a tabela protegida NAO e alarme — o gate e sobre privilegio de tabela", () => {
  const r = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);
      revoke all on table public.${TBL} from anon, authenticated;
      create or replace function public.lottery_count() returns bigint language sql security definer
        as $$ select count(*) from public.${TBL} $$;
      grant execute on function public.lottery_count() to anon;`),
    state: estado(),
  });
  assert(r.achados.length === 0, `um GRANT EXECUTE de funcao nao pode virar achado de tabela: ${JSON.stringify(r.achados)}`);
});

test("7. a divida so encolhe: revogar em DDL obriga a tirar a entrada do arquivo", () => {
  const r = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);\nrevoke all on table public.${TBL} from anon, authenticated;`),
    state: estado({ pendingRemediation: [{ table: TBL, anon: [...CRUD], authenticated: [...CRUD], issue: 131 }] }),
  });
  assert(r.quitadas.includes(TBL), `divida quitada deveria ser sinalizada para remocao: ${JSON.stringify(r.quitadas)}`);
});

test("8. ratificacao sem dono ou sem motivo nao passa por ratificacao", () => {
  const r = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);\ngrant select on table public.${TBL} to anon;`),
    state: estado({ ratified: [{ table: TBL, role: "anon", privileges: ["SELECT"] }] }),
  });
  assert(r.ratMalFormada.length === 1, "ratificacao sem reason/ratifiedBy tem de ser rejeitada");
});

test("9. ratificacao completa silencia o achado — e so ela", () => {
  const completa = { table: TBL, role: "anon", privileges: ["SELECT"], reason: "motivo escrito", ratifiedBy: "dono do produto" };
  const r = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);\nrevoke all on table public.${TBL} from anon, authenticated;\ngrant select on table public.${TBL} to anon;`),
    state: estado({ ratified: [completa] }),
  });
  assert(r.ratMalFormada.length === 0, "ratificacao completa nao pode ser rejeitada");
  assert(!r.achados.some((a) => a.priv === "SELECT" && a.role === "anon"), `SELECT ratificado nao deveria aparecer: ${JSON.stringify(r.achados)}`);

  // ... e nao vale para o resto: INSERT continua reprovando.
  const r2 = report({
    files: ddl(`create table public.${TBL} (id uuid primary key);\nrevoke all on table public.${TBL} from anon, authenticated;\ngrant select, insert on table public.${TBL} to anon;`),
    state: estado({ ratified: [completa] }),
  });
  assert(r2.achados.some((a) => a.priv === "INSERT"), "a ratificacao de SELECT nao pode cobrir INSERT");
});

test("10. zero tabelas descobertas nao pode ficar verde", () => {
  const r = report({ files: ddl("-- nada aqui\n"), state: estado() });
  assert(r.achados.length === 0, "sem tabelas nao ha achado — e por isso o piso existe");
  assert(r.vistas.length === 0, "nenhuma tabela protegida deveria ser vista");
  assert(r.vistas.length < MIN_PROTECTED_TABLES_SEEN, "com zero descobertas o gate tem de bater no piso e reprovar");
});

test("11. a arvore real bate com a leitura de producao PÓS-remediacao (2026-08-21)", () => {
  const r = report({ root: ROOT });
  assert(r.achados.length === 0, `main deveria estar verde: ${JSON.stringify(r.achados.slice(0, 3))}`);
  assert(r.quitadas.length === 0, `divida ja quitada ainda declarada: ${r.quitadas.join(", ")}`);
  assert(r.vistas.length === 6, `as seis tabelas tem de estar presentes; vieram ${r.vistas.length}`);
  assert((r.decl.pendingRemediation ?? []).length === 0, "a divida foi quitada em 2026-08-21; nao pode voltar a ser declarada");

  // Producao, lida imediatamente depois da migracao 20260821205500: os dois papeis de cliente sem
  // NENHUM dos quatro verbos nas seis. O modelo tem de dizer o mesmo.
  for (const tbl of r.protegidas) {
    const byRole = r.privs.get(tbl);
    for (const role of ["anon", "authenticated"]) {
      for (const p of CRUD) {
        assert(!byRole.get(role)?.has(p), `${tbl}/${role} nao pode mais ter ${p} (leitura pos-remediacao da #131)`);
      }
    }
    assert(!(byRole.get("PUBLIC")?.size), `${tbl}: PUBLIC continua vazio, como producao mede`);
  }
});

test("12. e o modelo continua fiel a era ANTERIOR — sem a migracao, reproduz a exposicao medida", () => {
  // A paridade com a leitura PRE-remediacao e a evidencia que autorizou a mutacao. Apagar o teste
  // junto com a divida jogaria fora justamente a prova de que o modelo estava certo. Entao ele fica,
  // reconstruindo aquela era: a mesma DDL, menos a migracao que remediou.
  const semRemediacao = ddlSources({ root: ROOT })
    .filter((f) => !f.file.includes("20260821205500_revoke_client_crud_lottery_tables"));
  assert(semRemediacao.length === ddlSources({ root: ROOT }).length - 1, "a migracao de remediacao tem de existir para ser excluida");

  const antes = tablePrivState(semRemediacao);
  const seis = ["lottery_admin_audit", "lottery_draws", "lottery_participants",
    "lottery_participations", "lottery_payment_transactions", "lottery_pools"];
  for (const tbl of seis) {
    const byRole = antes.get(tbl);
    for (const role of ["anon", "authenticated"]) {
      for (const p of CRUD) {
        assert(byRole.get(role)?.has(p), `era anterior: ${tbl}/${role} tinha ${p} em producao, e o modelo tem de reproduzir`);
      }
    }
    assert(!(antes.get(tbl).get("PUBLIC")?.size), `era anterior: ${tbl} tinha PUBLIC vazio`);
  }
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
