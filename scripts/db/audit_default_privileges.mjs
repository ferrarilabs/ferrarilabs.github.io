#!/usr/bin/env node
/**
 * DEFAULT PRIVILEGES DE `public` E SUPERFICIE DE API INTENCIONAL — Issue #271.
 *
 * ─── O PROBLEMA ──────────────────────────────────────────────────────────────────────────────
 *
 * Objeto novo em `public` nascia concedido a `anon`, `authenticated` e `service_role` sem nenhum
 * GRANT escrito, para os dois papeis criadores. `public.bolao_round_notif_jobs` prova que nao era
 * teoria: nao tem um unico grant na DDL e mesmo assim `anon` tinha TRUNCATE nela (Issue #276).
 *
 * ─── O QUE ESTE GATE VERIFICA ────────────────────────────────────────────────────────────────
 *
 * 1. Que a revogacao dos defaults de TABLES e SEQUENCES para `postgres` esta na DDL -- nao basta
 *    producao estar certa, uma reconstrucao tem de chegar no mesmo lugar.
 * 2. Que as duas frentes AINDA ABERTAS continuam declaradas com motivo. Um gate que so verificasse
 *    o que foi feito ficaria verde enquanto o que faltou desaparecia do registro.
 * 3. RECONSTRUCAO LIMPA: com os defaults fechados, cada objeto que o Data API serve precisa de
 *    GRANT EXPLICITO na DDL. Sem isso, um rebuild do zero perde o endpoint -- e ninguem descobre
 *    ate um participante abrir o site.
 * 4. Que `cdb_reserve_entry_saved_email` NAO foi ratificada de contrabando. A Issue #274 ainda nao
 *    decidiu se e RPC viva ou privilegio morto; inclui-la aqui a aprovaria por conveniencia.
 * 5. DIVERGENCIA DE RECONSTRUCAO EM FUNCAO: `CREATE FUNCTION` sempre concede EXECUTE a PUBLIC.
 *    Uma funcao alcancavel por cliente cuja DDL nao revogue PUBLIC explicitamente vai nascer
 *    PUBLIC-executavel num rebuild, mesmo que producao hoje nao esteja assim.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_default_privileges.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripSqlComments } from "./secdef_ddl_parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATE_PATH = join(ROOT, "bolao/shared/safety/default_privileges_state.json");

export function ddlSources({ root = ROOT } = {}) {
  const load = (rel, filt) => {
    const dir = join(root, rel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".sql") && filt(f)).sort()
      .map((f) => ({ file: `${rel}/${f}`, text: stripSqlComments(readFileSync(join(dir, f), "utf8")) }));
  };
  return [...load("bolao/shared/sql", () => true), ...load("supabase/migrations", (f) => !f.includes(".reference."))];
}

/** Efeito liquido de `ALTER DEFAULT PRIVILEGES` para um (papel criador, classe de objeto). */
export function defaultExposure(files, creator, objClass, roles = ["anon", "authenticated", "service_role"]) {
  const re = new RegExp(String.raw`alter\s+default\s+privileges\s+for\s+role\s+"?${creator}"?\s+in\s+schema\s+"?public"?\s+(grant|revoke)\s+([a-z, ]+?)\s+on\s+${objClass}\s+(?:to|from)\s+([^;]+);`, "gi");
  let exposed = new Set();
  for (const f of files) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(f.text)) !== null) {
      const [, verb, , rolesRaw] = m;
      for (const r of roles) {
        if (!new RegExp(`\\b${r}\\b`).test(rolesRaw)) continue;
        if (verb.toLowerCase() === "grant") exposed.add(r); else exposed.delete(r);
      }
    }
  }
  return [...exposed].sort();
}

/** Um objeto tem GRANT explicito na DDL? (o que uma reconstrucao limpa precisa.) */
export function hasExplicitGrant(files, name, kind) {
  const re = kind === "function"
    ? new RegExp(String.raw`grant\s+(?:all|execute)[^;]*on\s+function\s+(?:"?public"?\s*\.\s*)?"?${name}"?\s*\(`, "i")
    : new RegExp(String.raw`grant\s+[a-z, ]*select[a-z, ]*\s+on\s+(?:table\s+)?(?:"?public"?\s*\.\s*)?"?${name}"?\b`, "i");
  return files.some((f) => re.test(f.text));
}

/** A DDL revoga PUBLIC desta funcao? Aceita a forma direta e o laco dinamico. */
export function revokesPublic(files, name) {
  const direto = new RegExp(String.raw`revoke[^;]*on\s+function\s+(?:"?public"?\s*\.\s*)?"?${name}"?\s*\([^)]*\)[^;]*from[^;]*\bpublic\b`, "i");
  const dinamico = /execute\s+format\s*\(\s*'revoke[^']*from\s+public'/i;
  return files.some((f) => direto.test(f.text)) || files.some((f) => dinamico.test(f.text) && f.text.includes(name));
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nDefault privileges de `public` e superficie de API intencional (Issue #271)\n");
  const files = ddlSources();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));

  check("as fontes de DDL existem", files.length > 0, `${files.length} arquivos`);

  // ── 1. o que foi fechado, esta fechado na DDL ────────────────────────────────────────────
  for (const s of state.secured) {
    const exp = defaultExposure(files, s.creator, s.objectClass);
    check(`default ${s.objectClass} de \`${s.creator}\` nao expoe papel de cliente`, exp.length === 0,
      exp.length ? `ainda concede a ${exp.join(", ")} no efeito liquido da DDL` : `revogado por ${s.appliedBy} (producao leu ${s.readBack})`);
  }

  // ── 2. o que ficou aberto continua declarado, com motivo ─────────────────────────────────
  const abertosMalDeclarados = state.open.filter((o) => !o.reason || o.reason.length < 80 || !o.status || !o.correctControl);
  check(`as frentes abertas continuam declaradas com motivo (${state.open.length})`, abertosMalDeclarados.length === 0,
    abertosMalDeclarados.length ? `declaracao incompleta: ${abertosMalDeclarados.map((o) => `${o.creator}/${o.objectClass}`).join(", ")}`
      : state.open.map((o) => `${o.creator}/${o.objectClass}=${o.status}`).join("; "));

  // ── 3. reconstrucao limpa: a API intencional sobrevive ───────────────────────────────────
  const viewsSemGrant = state.intentionalApi.views.filter((v) => !hasExplicitGrant(files, v.name, "view"));
  check(`toda view intencional tem GRANT explicito na DDL (${state.intentionalApi.views.length})`,
    viewsSemGrant.length === 0,
    viewsSemGrant.length ? `um rebuild perderia: ${viewsSemGrant.map((v) => v.name).join(", ")}` : "uma reconstrucao do zero continua servindo as tres");

  const rpcsSemGrant = state.intentionalApi.rpcs.filter((r) => !hasExplicitGrant(files, r.signature, "function"));
  check(`toda RPC intencional tem GRANT explicito na DDL (${state.intentionalApi.rpcs.length})`,
    rpcsSemGrant.length === 0,
    rpcsSemGrant.length ? `um rebuild perderia: ${rpcsSemGrant.map((r) => r.signature).join(", ")}` : "uma reconstrucao do zero continua servindo as tres");

  // ── 4. nada entra na lista por conveniencia ──────────────────────────────────────────────
  const naoRatificaveis = ["cdb_reserve_entry_saved_email"];
  const contrabando = state.intentionalApi.rpcs.filter((r) => naoRatificaveis.some((n) => r.signature.includes(n)));
  check("nenhuma RPC de legitimidade indefinida foi ratificada aqui", contrabando.length === 0,
    contrabando.length ? `${contrabando.map((r) => r.signature).join(", ")} — decisao e da Issue #274, nao desta lista`
      : "cdb_reserve_entry_saved_email continua fora, como manda a Issue #274");

  // ── 5. divergencia de reconstrucao em funcao ─────────────────────────────────────────────
  // `CREATE FUNCTION` sempre concede EXECUTE a PUBLIC. Sem revoke explicito na DDL, um rebuild
  // entrega a funcao PUBLIC-executavel mesmo que producao hoje nao esteja assim.
  const semRevokePublic = state.intentionalApi.rpcs.filter((r) => !revokesPublic(files, r.signature));
  check("toda RPC de cliente revoga PUBLIC explicitamente na DDL", semRevokePublic.length === 0,
    semRevokePublic.length
      ? `sem revoke de PUBLIC — numa reconstrucao limpa nascem PUBLIC-executaveis: ${semRevokePublic.map((r) => r.signature).join(", ")}`
      : "nenhuma depende do estado vivo de producao para nao vazar a PUBLIC");

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
