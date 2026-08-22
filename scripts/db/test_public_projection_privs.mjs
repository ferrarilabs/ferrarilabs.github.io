#!/usr/bin/env node
/**
 * Testes do contrato de privilegio das projecoes publicas e da remediacao #282/#284.
 *
 * As catorze regressoes exigidas pela autorizacao. Os casos 1-5 cobrem a semantica de papel
 * (PUBLIC vs nomeado) no lado das FUNCOES; 6-12 no lado da RELACAO; 13 e o controle negativo; 14
 * confere o replay contra a ACL pretendida em producao.
 *
 * O caso 13 e o unico que prova que os outros valem alguma coisa: ele REMOVE a migracao corretiva
 * do conjunto de arquivos e exige que o modelo volte a acusar o defeito. Um teste que so afirma o
 * estado bom passaria igual se o modelo estivesse cego -- que foi exatamente o que aconteceu com
 * `bolao_state_normalized_public` ate 2026-08-22, quando `parseCreateTables` nao casava view
 * nenhuma e o modelo respondia "limpa" para uma view que producao media exposta.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { report, ddlSources } from "./audit_public_projection_privs.mjs";
import { tablePrivState } from "./client_table_privs_model.mjs";
import { effectiveExecuteAcl } from "./function_birth_acl.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MIGRACAO = "20260822110933_revoke_dead_client_grants_282_284";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const ddl = (text) => [{ file: "supabase/migrations/29999999999999_fixture.sql", text }];

const real = () => ddlSources({ root: ROOT });
const semRemediacao = () => real().filter((f) => !f.file.includes(MIGRACAO));

console.log("\nPROJECOES PUBLICAS E REMEDIACAO #282/#284\n");

// ── 1-2: PUBLIC nao limpa papel nomeado (relacao) ────────────────────────────────────────────
test("1. REVOKE FROM PUBLIC nao remove um grant explicito de authenticated (relacao)", () => {
  const st = tablePrivState(ddl(`
    create view public.v_x as select 1 as a;
    grant insert on table public.v_x to authenticated;
    revoke all on table public.v_x from public;
  `));
  const r = st.get("v_x");
  assert(!(r.get("PUBLIC") ?? new Set()).has("INSERT"), "PUBLIC tem de sair");
  assert((r.get("authenticated") ?? new Set()).has("INSERT"),
    "o grant nominal de authenticated NAO pode ser removido por um revoke de PUBLIC");
});

test("2. REVOKE FROM PUBLIC nao remove um grant explicito de anon (relacao)", () => {
  const st = tablePrivState(ddl(`
    create view public.v_y as select 1 as a;
    grant update on table public.v_y to anon;
    revoke all on table public.v_y from public;
  `));
  assert((st.get("v_y").get("anon") ?? new Set()).has("UPDATE"),
    "o grant nominal de anon sobrevive ao revoke de PUBLIC");
});

// ── 3-5: os dois helpers ─────────────────────────────────────────────────────────────────────
const fnState = (files) => effectiveExecuteAcl(files);

test("3. EXECUTE de authenticated em _bolao_audit e DETECTADO quando existe", () => {
  const st = fnState(semRemediacao());
  const e = st.get("public._bolao_audit/3");
  assert(e, "_bolao_audit tem de existir no replay");
  assert(e.roles.has("authenticated"),
    "sem a migracao corretiva, o modelo TEM de enxergar authenticated com EXECUTE — era o defeito da #282");
});

test("4. EXECUTE de authenticated em _bolao_touch e DETECTADO quando existe", () => {
  const e = fnState(semRemediacao()).get("public._bolao_touch/1");
  assert(e && e.roles.has("authenticated"), "sem a migracao, authenticated executa _bolao_touch");
});

test("5. os dois helpers continuam executaveis por service_role/postgres depois da remediacao", () => {
  // A remediacao nao pode ter cortado o caminho legitimo. Os chamadores sao RPCs de operador
  // SECURITY DEFINER de `postgres`, cujo corpo roda COMO postgres.
  const st = fnState(real());
  for (const sig of ["public._bolao_audit/3", "public._bolao_touch/1"]) {
    const e = st.get(sig);
    assert(e, `${sig} tem de existir`);
    assert(!e.roles.has("authenticated"), `${sig}: authenticated tem de ter saido`);
    assert(!e.roles.has("anon"), `${sig}: anon nao pode ter entrado`);
    assert(e.publicExecute === false, `${sig}: PUBLIC nao pode executar`);
    assert(e.roles.has("service_role"), `${sig}: service_role TEM de continuar — e o caminho do runtime confiavel`);
  }
});

// ── 6: SELECT intencional ────────────────────────────────────────────────────────────────────
test("6. o SELECT de bolao_state_normalized_public continua intencional e presente", () => {
  const r = report({ root: ROOT });
  assert(r.semSelect.length === 0, `a projecao publica perderia leitor: ${r.semSelect.join(", ")}`);
  const decl = r.contract.projections.find((p) => p.name === "bolao_state_normalized_public");
  assert(decl && decl.clientsMay.includes("SELECT"), "SELECT tem de estar declarado como intencional");
  const st = tablePrivState(real());
  for (const role of ["anon", "authenticated"]) {
    assert((st.get("bolao_state_normalized_public").get(role) ?? new Set()).has("SELECT"),
      `${role} tem de manter SELECT — e o endpoint publico do site`);
  }
});

// ── 7-12: cada verbo proibido, um por um ─────────────────────────────────────────────────────
for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
  const n = { INSERT: 7, UPDATE: 8, DELETE: 9, TRUNCATE: 10, REFERENCES: 11, TRIGGER: 12 }[priv];
  test(`${n}. ${priv} de cliente na projecao publica reprova o contrato`, () => {
    // (a) o estado real NAO tem o privilegio
    const st = tablePrivState(real());
    const byRole = st.get("bolao_state_normalized_public");
    for (const role of ["anon", "authenticated"]) {
      assert(!(byRole.get(role) ?? new Set()).has(priv),
        `${role} nao pode ter ${priv} depois da remediacao`);
    }
    // (b) e se tivesse, o gate acusaria — provado injetando o grant
    const injetado = [...real(), { file: "supabase/migrations/29999999999999_inject.sql",
      text: `grant ${priv.toLowerCase()} on table public.bolao_state_normalized_public to anon;` }];
    const r = report({ root: ROOT, files: injetado });
    assert(r.achados.some((a) => a.rel === "bolao_state_normalized_public" && a.priv === priv && a.role === "anon"),
      `o gate tem de acusar ${priv} concedido a anon`);
  });
}

// ── 13: controle negativo ────────────────────────────────────────────────────────────────────
test("13. remover a migracao corretiva REINTRODUZ o defeito e reprova", () => {
  // Nao e um grep de prosa: o conjunto de arquivos perde a migracao e o MODELO recalcula.
  const antes = real().length, depois = semRemediacao().length;
  assert(depois === antes - 1, `a migracao ${MIGRACAO} tem de existir para poder ser removida`);

  // relacao: os seis verbos voltam
  const r = report({ root: ROOT, files: semRemediacao() });
  const naView = r.achados.filter((a) => a.rel === "bolao_state_normalized_public");
  assert(naView.length > 0, "sem a migracao, a projecao publica volta a violar o contrato");
  for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
    assert(naView.some((a) => a.priv === priv), `${priv} tem de reaparecer como achado`);
  }
  // funcoes: authenticated volta
  const st = fnState(semRemediacao());
  assert(st.get("public._bolao_audit/3").roles.has("authenticated"), "o defeito da funcao tem de reaparecer");
});

// ── 14: replay concorda com a ACL pretendida em producao ─────────────────────────────────────
test("14. o replay limpo concorda com a ACL pretendida em producao", () => {
  // Medido ao vivo em 2026-08-22, depois da remediacao:
  //   _bolao_audit / _bolao_touch    -> PUBLIC=false anon=false authenticated=false service_role=true
  //   bolao_state_normalized_public  -> anon e authenticated com MAINTAIN,SELECT apenas
  const fn = fnState(real());
  for (const sig of ["public._bolao_audit/3", "public._bolao_touch/1"]) {
    const e = fn.get(sig);
    assert(e.publicExecute === false && !e.roles.has("anon") && !e.roles.has("authenticated") && e.roles.has("service_role"),
      `${sig}: replay diverge da ACL medida em producao`);
  }
  const st = tablePrivState(real()).get("bolao_state_normalized_public");
  for (const role of ["anon", "authenticated"]) {
    const s = st.get(role) ?? new Set();
    assert(s.has("SELECT"), `${role}: SELECT tem de sobreviver ao replay`);
    for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      assert(!s.has(priv), `${role}: ${priv} nao deveria existir no replay`);
    }
  }
  const r = report({ root: ROOT });
  assert(r.achados.length === 0 && r.gapQuitado.length === 0, "o contrato tem de estar verde na arvore real");
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
