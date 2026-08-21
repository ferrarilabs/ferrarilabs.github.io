#!/usr/bin/env node
/**
 * CONTRATO DO GATE DE PRIVILEGIO ESTRUTURAL — Issue #276.
 *
 * Um gate verde nao prova nada enquanto ninguem mostrar que ele fica vermelho. Esta suite monta
 * DDL sintetica para cada forma de exposicao e, no teste 6, faz a prova mais forte que existe
 * aqui: remove a migracao de remediacao do conjunto real de arquivos e exige que o modelo
 * reproduza EXATAMENTE a exposicao que foi medida em producao antes da mudanca.
 *
 * Sem rede e sem banco. Uso: node scripts/db/test_client_structural_privs.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripSqlComments } from "./secdef_ddl_parse.mjs";
import { STRUCTURAL_PRIVS, CLIENT_ROLES, RATIFIED_EXCEPTIONS, privsOf, tablePrivState, structuralExposure } from "./client_table_privs_model.mjs";
import { ddlSources, APP_TABLES, report } from "./audit_client_structural_privs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRACAO = "20260821020000_revoke_structural_privs_from_client_roles";

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const f = (file, text) => ({ file, text });
const S = { stripComments: stripSqlComments };
const expo = (files, tables) => structuralExposure(tablePrivState(files, S), tables);

console.log("\nContrato do gate de privilegio estrutural em papel de cliente (Issue #276)\n");

// ── 1-3. TRUNCATE, nas tabelas que a autorizacao nomeia ──────────────────────────────────────

test("1. authenticated TRUNCATE em bolao_state e detectado", () => {
  const e = expo([f("001.sql", "grant all on table public.bolao_state to authenticated;")], ["bolao_state"]);
  assert(e.some((x) => x.role === "authenticated" && x.privilege === "TRUNCATE"), `nao detectou: ${JSON.stringify(e)}`);
});

test("2. authenticated TRUNCATE em bolao_entry_private e detectado", () => {
  const e = expo([f("001.sql", "grant all on table public.bolao_entry_private to authenticated;")], ["bolao_entry_private"]);
  assert(e.some((x) => x.role === "authenticated" && x.privilege === "TRUNCATE"), "nao detectou");
});

test("3. anon TRUNCATE numa tabela de notificacao e detectado", () => {
  const e = expo([f("001.sql", "grant truncate on table public.bolao_notif_jobs to anon;")], ["bolao_notif_jobs"]);
  assert(e.length === 1 && e[0].role === "anon" && e[0].privilege === "TRUNCATE", `veio ${JSON.stringify(e)}`);
});

// ── 4-5. REFERENCES e TRIGGER, cada um por si ────────────────────────────────────────────────

test("4. REFERENCES e detectado sozinho, sem TRUNCATE nenhum", () => {
  const e = expo([f("001.sql", "grant references on table public.bolao_state to anon;")], ["bolao_state"]);
  assert(e.length === 1 && e[0].privilege === "REFERENCES", `veio ${JSON.stringify(e)}`);
});

test("5. TRIGGER e detectado sozinho, sem TRUNCATE nenhum", () => {
  const e = expo([f("001.sql", "grant trigger on table public.bolao_state to authenticated;")], ["bolao_state"]);
  assert(e.length === 1 && e[0].privilege === "TRIGGER", `veio ${JSON.stringify(e)}`);
});

// ── 6. SEM A MIGRACAO, O GATE REPROVA — e reproduz a medicao de producao ─────────────────────

test("6. remover a migracao de remediacao faz o gate reprovar", () => {
  const semRemediacao = ddlSources().filter((x) => !x.file.includes(MIGRACAO));
  assert(semRemediacao.length === ddlSources().length - 1, "a migracao de remediacao nao foi encontrada para remover");
  const e = expo(semRemediacao, APP_TABLES);
  assert(e.length > 0, "sem a remediacao o gate TEM de reprovar");

  // E nao apenas reprovar: reproduzir a medicao real de producao de 2026-08-21.
  const conta = (role, priv) => e.filter((x) => x.role === role && x.privilege === priv).length;
  const medido = {
    "anon/TRUNCATE": 2, "anon/REFERENCES": 10, "anon/TRIGGER": 10,
    "authenticated/TRUNCATE": 11, "authenticated/REFERENCES": 11, "authenticated/TRIGGER": 11,
  };
  for (const [k, esperado] of Object.entries(medido)) {
    const [role, priv] = k.split("/");
    assert(conta(role, priv) === esperado, `${k}: modelo diz ${conta(role, priv)}, producao mediu ${esperado}`);
  }
});

test("6b. COM a migracao, a exposicao e zero", () => {
  assert(report().exposure.length === 0, "o repositorio atual deveria estar limpo");
});

// ── 7. CRUD ESTA FORA DESTE GATE ─────────────────────────────────────────────────────────────

test("7. SELECT/INSERT/UPDATE/DELETE nao sao governados aqui", () => {
  const e = expo([f("001.sql", "grant select, insert, update, delete on table public.bolao_state to anon;")], ["bolao_state"]);
  assert(e.length === 0, `CRUD nao pode disparar este gate; veio ${JSON.stringify(e)}`);
  // ...e continuam sendo lidos pelo modelo, so nao julgados por ele.
  const st = tablePrivState([f("001.sql", "grant select on table public.bolao_state to anon;")], S);
  assert(st.get("bolao_state").get("anon").has("SELECT"), "o modelo deveria registrar SELECT mesmo sem julga-lo");
});

// ── 8. service_role NAO E TOCADO PELA MIGRACAO ───────────────────────────────────────────────

test("8. a migracao de remediacao nao menciona service_role em nenhum statement", () => {
  const sql = readFileSync(join(ROOT, "supabase", "migrations", `${MIGRACAO}.sql`), "utf8");
  const statements = stripSqlComments(sql).split("\n").filter((l) => /^\s*(revoke|grant)\b/i.test(l));
  assert(statements.length === 21, `esperava 21 statements, achei ${statements.length}`);
  const tocaService = statements.filter((l) => /service_role/i.test(l));
  assert(tocaService.length === 0, `a migracao toca service_role: ${tocaService.join(" | ")}`);
  assert(statements.every((l) => /\bfrom\s+(anon|authenticated)\s*;/i.test(l)), "todo statement tem de revogar de anon ou authenticated");
});

test("8b. o rollback e exatamente simetrico e tambem ignora service_role", () => {
  const rb = readFileSync(join(ROOT, "supabase", "rollbacks", `${MIGRACAO}.rollback.sql`), "utf8");
  const g = stripSqlComments(rb).split("\n").filter((l) => /^\s*grant\b/i.test(l));
  assert(g.length === 21, `esperava 21 grants no rollback, achei ${g.length}`);
  assert(!g.some((l) => /service_role/i.test(l)), "o rollback nao pode tocar service_role");
  // A licao do KPLUS-F042 em legacy_fence.mjs: rollback por constante uniforme CONCEDE privilegio
  // que o papel nunca teve. `anon` so pode reaver TRUNCATE nas DUAS tabelas onde realmente tinha.
  const anonTrunc = g.filter((l) => /truncate/i.test(l) && /to\s+anon\s*;/i.test(l));
  assert(anonTrunc.length === 2, `anon deveria reaver TRUNCATE em exatamente 2 tabelas, nao ${anonTrunc.length}`);
});

// ── 9. TABELA JA LIMPA NAO GANHA HISTORIA SINTETICA ──────────────────────────────────────────

test("9. cdb_entry_access e modelada como limpa sem revoke sintetico", () => {
  const sql = readFileSync(join(ROOT, "supabase", "migrations", `${MIGRACAO}.sql`), "utf8");
  const statements = stripSqlComments(sql).split("\n").filter((l) => /^\s*(revoke|grant)\b/i.test(l));
  assert(!statements.some((l) => /cdb_entry_access/i.test(l)), "a migracao nao pode fingir remediar uma tabela que ja estava limpa");
  const { state } = report();
  const byRole = state.get("cdb_entry_access") ?? new Map();
  for (const role of CLIENT_ROLES) {
    const s = byRole.get(role) ?? new Set();
    assert(![...s].some((p) => STRUCTURAL_PRIVS.includes(p)), `${role} nao deveria ter privilegio estrutural em cdb_entry_access`);
  }
});

// ── HERANCA DE PUBLIC E EXPANSAO DE `ALL` ────────────────────────────────────────────────────

test("PUBLIC com o privilegio expoe os papeis de cliente por heranca", () => {
  const e = expo([f("001.sql", "grant truncate on table public.bolao_state to public;")], ["bolao_state"]);
  assert(e.length === CLIENT_ROLES.length, `esperava ${CLIENT_ROLES.length} exposicoes por heranca, veio ${e.length}`);
  assert(e.every((x) => x.via === "heranca de PUBLIC"), `motivo errado: ${e.map((x) => x.via).join(",")}`);
});

test("revogar do papel e DEIXAR PUBLIC continua exposto", () => {
  const e = expo([
    f("001.sql", "grant truncate on table public.bolao_state to public;\ngrant truncate on table public.bolao_state to anon;"),
    f("002.sql", "revoke truncate on table public.bolao_state from anon;"),
  ], ["bolao_state"]);
  assert(e.some((x) => x.role === "anon" && x.via === "heranca de PUBLIC"), "PUBLIC ainda concede — deveria continuar exposto");
});

test("`GRANT ALL` expande para os sete privilegios, incluindo os tres estruturais", () => {
  const p = privsOf("all");
  for (const s of STRUCTURAL_PRIVS) assert(p.includes(s), `ALL deveria incluir ${s}`);
  assert(p.length === 7, `ALL deveria expandir para 7, veio ${p.length}`);
  assert(!privsOf("select, insert").some((x) => STRUCTURAL_PRIVS.includes(x)), "lista nomeada nao pode inventar privilegio estrutural");
});

test("DDL comentada nao conta como grant", () => {
  const e = expo([f("001.sql", "-- grant all on table public.bolao_state to anon;")], ["bolao_state"]);
  assert(e.length === 0, "um grant comentado nao concede nada");
});

test("a lista de excecoes ratificadas esta vazia (preferencia declarada)", () => {
  assert(RATIFIED_EXCEPTIONS.length === 0, `esperava lista vazia, tem ${RATIFIED_EXCEPTIONS.length}`);
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
