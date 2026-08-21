#!/usr/bin/env node
/**
 * EXPOSICAO DAS RPCs DE OPERADOR — a revogacao da Issue #267 nao pode voltar sozinha.
 *
 * ─── O QUE ACONTECEU ─────────────────────────────────────────────────────────────────────────
 *
 * Sete RPCs SECURITY DEFINER de operador — pagamento, remocao de entrada, fases, resultados,
 * e-mail de rodada, identidade da entrada e destinatarios — tinham EXECUTE para `authenticated`,
 * concedido explicitamente por `20260811160000_baseline_adopted_grants_and_rls.sql`.
 *
 * Em Supabase/PostgREST `authenticated` e o papel assumido por QUALQUER requisicao com JWT de
 * usuario. Nao e "usuario cadastrado", e contagem de membros do papel nao prova nao-uso.
 *
 * Foi revogado em producao em 2026-08-21. O problema: o GRANT continua no baseline. Uma
 * reconstrucao a partir das migracoes reaplica o GRANT, e sem esta checagem a exposicao volta em
 * silencio — sem ninguem escrever uma linha errada.
 *
 * ─── O QUE ESTE GATE VERIFICA ────────────────────────────────────────────────────────────────
 *
 * Sobre o REPOSITORIO, nao sobre o banco (o CI e hermetico e nao tem credencial): para cada funcao
 * protegida, se algum arquivo de DDL concede EXECUTE a `anon`/`authenticated`/`PUBLIC`, TEM de
 * existir um arquivo POSTERIOR que revogue. A ordem e a mesma que uma reconstrucao usaria — nome
 * de arquivo, que neste repositorio e o timestamp da migracao.
 *
 * Assim o gate modela o EFEITO LIQUIDO de reaplicar tudo, em vez de proibir o GRANT historico —
 * reescrever o baseline seria reescrever um registro do que a producao era.
 *
 * ─── POR QUE LISTA EXPLICITA, E NAO "capacidade" ─────────────────────────────────────────────
 *
 * A classificacao ideal seria por capacidade (SECURITY DEFINER + muta estado privilegiado). Sem
 * banco no CI isso exigiria interpretar corpo de funcao SQL a partir do texto — e um parser de
 * plpgsql aproximado erraria em silencio, que e pior que uma lista. A lista e explicita, o prefixo
 * `op_` cobre o crescimento natural, e qualquer excecao exige entrada RATIFICADA no contrato.
 *
 * Uso: node scripts/db/audit_operator_rpc_exposure.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DDL_DIRS = ["supabase/migrations", "bolao/shared/sql"];
const EXPOSED_ROLES = ["anon", "authenticated", "public"];

/** As sete revogadas na Issue #267. Nomeadas, nao inferidas. */
export const PROTECTED_FUNCTIONS = [
  "op_confirm_payment", "op_remove_entry", "op_set_phases", "op_set_results",
  "op_set_round_email", "op_update_entry", "resolve_notification_recipients",
];

/**
 * Regra de crescimento: qualquer funcao futura com prefixo `op_` e tratada como operador por
 * padrao. Uma RPC de operador nova nasce protegida em vez de nascer exposta.
 */
export const PROTECTED_PREFIX = /^op_[a-z0-9_]+$/;

/**
 * Excecoes RATIFICADAS. Uma funcao so pode ficar exposta a anon/authenticated se estiver aqui,
 * com dono e motivo. Vazio de proposito: nenhuma RPC de operador deve ser alcancavel por JWT.
 * (As RPCs de participante — submit_entry, cdb_* — nao sao "de operador" e nunca entram na lista
 * protegida, entao nao precisam de excecao.)
 */
export const RATIFIED_EXPOSURES = [];

function ddlFiles() {
  const out = [];
  for (const dir of DDL_DIRS) {
    let names = [];
    try { names = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".sql")); } catch { continue; }
    for (const f of names.sort()) out.push({ file: `${dir}/${f}`, name: f, text: readFileSync(join(ROOT, dir, f), "utf8") });
  }
  // Ordem de reconstrucao: as migracoes sao aplicadas por nome (timestamp). `bolao/shared/sql`
  // e aplicada a mao, e por isso vem depois — e o pior caso para este gate, o que e o correto:
  // se mesmo assumindo que ela roda por ultimo o estado final for seguro, ele e seguro.
  return out;
}

const grantRe = (fn, role) => new RegExp(
  `grant\\s+(?:all|execute)[^;]{0,200}?\\bfunction\\b[^;]{0,200}?"?${fn}"?\\s*\\([^;]{0,300}?to\\s+"?${role}"?`, "is");
const revokeRe = (fn, role) => new RegExp(
  `revoke\\s+(?:all|execute)[^;]{0,200}?\\bfunction\\b[^;]{0,200}?"?${fn}"?\\s*\\([^;]{0,300}?from\\s+"?${role}"?`, "is");

/** Efeito liquido para (funcao, papel) percorrendo os arquivos na ordem de aplicacao. */
export function netExposure(fn, role, files) {
  let exposed = false, lastGrant = null, lastRevoke = null;
  for (const f of files) {
    // Um arquivo pode conceder e revogar; o que vale e o ultimo no arquivo. Comparar indices
    // evita concluir "revogado" quando o GRANT vem depois no MESMO arquivo.
    const g = f.text.search(grantRe(fn, role));
    const r = f.text.search(revokeRe(fn, role));
    if (g === -1 && r === -1) continue;
    if (g > r) { exposed = true; lastGrant = f.file; }
    else { exposed = false; lastRevoke = f.file; }
  }
  return { exposed, lastGrant, lastRevoke };
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

console.log("\nExposicao das RPCs de operador (Issue #267)\n");

const files = ddlFiles();
// Falha FECHADO: sem DDL nao da para afirmar nada sobre o efeito liquido.
check("as fontes de DDL existem", files.length > 0, `${files.length} arquivos`);

if (files.length) {
  // Descobre funcoes `op_*` definidas no repositorio, para que uma RPC de operador NOVA entre na
  // protecao sem ninguem lembrar de editar a lista.
  const descobertas = new Set(PROTECTED_FUNCTIONS);
  for (const f of files) {
    for (const m of f.text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(/gis)) {
      if (PROTECTED_PREFIX.test(m[1])) descobertas.add(m[1]);
    }
  }

  const expostas = [];
  for (const fn of [...descobertas].sort()) {
    for (const role of EXPOSED_ROLES) {
      const { exposed, lastGrant } = netExposure(fn, role, files);
      if (!exposed) continue;
      if (RATIFIED_EXPOSURES.some((e) => e.function === fn && e.role === role)) continue;
      expostas.push(`${fn} -> ${role} (ultimo GRANT em ${lastGrant}, sem REVOKE posterior)`);
    }
  }

  check(`nenhuma RPC de operador fica exposta apos reaplicar toda a DDL (${descobertas.size} funcoes)`,
    expostas.length === 0,
    expostas.length ? `exposicao liquida:\n      ${expostas.join("\n      ")}` : "efeito liquido: nenhuma exposta a anon/authenticated/PUBLIC");

  check("as sete da Issue #267 continuam cobertas pela lista protegida",
    PROTECTED_FUNCTIONS.every((f) => descobertas.has(f)),
    `${PROTECTED_FUNCTIONS.length} nomeadas + ${descobertas.size - PROTECTED_FUNCTIONS.length} descobertas por prefixo op_`);

  check("toda excecao ratificada tem dono e motivo",
    RATIFIED_EXPOSURES.every((e) => e.function && e.role && e.approvedBy && e.reason),
    RATIFIED_EXPOSURES.length ? `${RATIFIED_EXPOSURES.length} excecao(oes)` : "nenhuma excecao — estado desejado");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ OPERATOR RPC EXPOSURE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
