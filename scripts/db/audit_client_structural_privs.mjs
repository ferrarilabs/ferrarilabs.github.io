#!/usr/bin/env node
/**
 * PRIVILEGIO ESTRUTURAL EM PAPEL DE CLIENTE — Issue #276.
 *
 * ─── O QUE ACONTECEU ─────────────────────────────────────────────────────────────────────────
 *
 * `authenticated` tinha TRUNCATE, REFERENCES e TRIGGER em 11 das 12 tabelas de `public` --
 * inclusive `bolao_entry_private` e `bolao_state`. `anon` tinha TRUNCATE em duas. Vieram de
 * `GRANT ALL ON TABLE` no baseline: `ALL` numa tabela inclui os tres. Revogado em producao em
 * 2026-08-21 (migracao 20260821020000).
 *
 * ─── POR QUE ESTE GATE EXISTE, E NAO SO A MIGRACAO ───────────────────────────────────────────
 *
 * Porque ja voltou uma vez. `scripts/db/acceptance_checks.mjs` (A10) exige `anon TRUNCATE = 0`
 * desde a remediacao de 2026-08-07 -- e mesmo assim, em 2026-08-21, `anon` tinha TRUNCATE em
 * `bolao_notif_jobs` e `bolao_round_notif_jobs`. As duas tabelas nasceram DEPOIS daquela
 * remediacao e vieram com `GRANT ALL`. Ninguem escreveu uma linha errada; a remediacao
 * simplesmente nao alcancava o que ainda nao existia.
 *
 * Um gate que so conferisse a migracao nao pegaria isso. Este confere o EFEITO LIQUIDO de toda a
 * DDL, entao a tabela numero treze tambem passa por ele.
 *
 * ─── POR QUE SO TRES PRIVILEGIOS ─────────────────────────────────────────────────────────────
 *
 * A RLS nao cobre estes. Ela aplica policies a SELECT/INSERT/UPDATE/DELETE; TRUNCATE e operacao
 * de tabela inteira. Com RLS ligada e zero policies -- o estado das doze -- TRUNCATE passa. Logo
 * "a RLS esta segurando", valido para os quatro verbos de linha, nao vale para estes tres, e eles
 * eram o unico privilegio sem rede embaixo. SELECT/INSERT/UPDATE/DELETE continuam governados
 * pelos contratos que ja tinham e estao deliberadamente FORA deste gate.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_client_structural_privs.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripSqlComments } from "./secdef_ddl_parse.mjs";
import { REQUIRED_TABLES } from "./acceptance_checks.mjs";
import { STRUCTURAL_PRIVS, CLIENT_ROLES, RATIFIED_EXCEPTIONS, tablePrivState, structuralExposure } from "./client_table_privs_model.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Ordem de aplicacao: `bolao/shared/sql/**` (pre-ledger) e depois `supabase/migrations/**`.
 * Mesma ordem que `audit_security_definer_exposure.mjs` usa e que foi validada contra o catalogo
 * de producao com paridade exata.
 */
export function ddlSources({ root = ROOT } = {}) {
  const load = (rel, filt) => {
    const dir = join(root, rel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".sql") && filt(f)).sort()
      .map((f) => ({ file: `${rel}/${f}`, text: readFileSync(join(dir, f), "utf8") }));
  };
  return [...load("bolao/shared/sql", () => true), ...load("supabase/migrations", (f) => !f.includes(".reference."))];
}

export const APP_TABLES = REQUIRED_TABLES;

export function report({ root = ROOT } = {}) {
  const files = ddlSources({ root });
  const state = tablePrivState(files, { stripComments: stripSqlComments });
  return { files, state, exposure: structuralExposure(state, APP_TABLES) };
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nPrivilegio estrutural (TRUNCATE/REFERENCES/TRIGGER) em papel de cliente (Issue #276)\n");
  const { files, state, exposure } = report();

  // FALHA FECHADO: sem DDL nao da para afirmar nada.
  check("as fontes de DDL existem", files.length > 0, `${files.length} arquivos`);
  check(`a lista de tabelas de aplicacao esta carregada`, APP_TABLES.length >= 12, `${APP_TABLES.length} tabelas`);

  check(`nenhum papel de cliente tem ${STRUCTURAL_PRIVS.join("/")} em tabela de aplicacao`,
    exposure.length === 0,
    exposure.length
      ? `${exposure.length} exposicao(oes):\n      ${exposure.map((e) => `${e.table} -> ${e.role} ${e.privilege} (${e.via})`).join("\n      ")}`
      : `${APP_TABLES.length} tabelas x ${CLIENT_ROLES.length} papeis x ${STRUCTURAL_PRIVS.length} privilegios: tudo limpo`);

  // A lista de excecoes deve permanecer vazia. Se um dia deixar de ser, cada entrada tem de
  // nomear tabela, papel, privilegio, motivo e quem ratificou -- nunca so um nome solto.
  const malformada = RATIFIED_EXCEPTIONS.filter((e) => !e.table || !e.role || !e.privilege || !e.reason || !e.ratifiedBy);
  check(`a lista de excecoes ratificadas esta bem formada (${RATIFIED_EXCEPTIONS.length} entradas)`,
    malformada.length === 0, malformada.length ? `entradas incompletas: ${JSON.stringify(malformada)}` : "preferencialmente vazia, e esta");

  // A remediacao tem de estar na DDL -- nao basta producao estar certa.
  const temMigracao = files.some((f) => f.file.includes("20260821020000_revoke_structural_privs_from_client_roles"));
  check("a migracao de remediacao esta no repositorio", temMigracao,
    temMigracao ? "supabase/migrations/20260821020000_revoke_structural_privs_from_client_roles.sql"
                : "producao ficaria a frente do Git — uma reconstrucao reintroduziria a exposicao");

  // `cdb_entry_access` nunca teve estes privilegios para papel de cliente. Tem de aparecer limpa
  // por historia REAL, sem nenhum revoke sintetico fingindo uma remediacao que nao houve.
  const cdb = state.get("cdb_entry_access") ?? new Map();
  const cdbClienteSujo = CLIENT_ROLES.some((r) => [...(cdb.get(r) ?? new Set())].some((p) => STRUCTURAL_PRIVS.includes(p)));
  check("cdb_entry_access aparece limpa por historia real, sem remediacao sintetica",
    !cdbClienteSujo, "nunca recebeu estes privilegios para anon/authenticated, e nenhum revoke finge o contrario");

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
