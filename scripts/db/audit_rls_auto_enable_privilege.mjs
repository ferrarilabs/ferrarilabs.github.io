#!/usr/bin/env node
/**
 * `rls_auto_enable()` — menor privilegio E gatilho vivo, as DUAS metades. Issue #270.
 *
 * ─── O QUE ACONTECEU ─────────────────────────────────────────────────────────────────────────
 *
 * `public.rls_auto_enable()` e SECURITY DEFINER, pertence a `postgres` e sustenta o gatilho de
 * evento `ensure_rls`, que liga RLS em toda tabela nova de `public`. Ela estava executavel por
 * PUBLIC, `anon`, `authenticated` e `service_role`. Revogado em producao em 2026-08-21.
 *
 * ─── POR QUE ESTE GATE TEM DUAS METADES, E NAO UMA ───────────────────────────────────────────
 *
 * Um gate que so verificasse "ninguem executa" passaria com nota maxima se alguem apagasse o
 * gatilho — o jeito mais rapido de zerar exposicao e destruir a funcionalidade. E `ensure_rls` e
 * justamente o que garante que uma tabela criada fora do caminho das migracoes nao nasca com RLS
 * desligada. Entao o invariante tem duas metades e as duas sao verificadas aqui:
 *
 *     SEM EXPOSICAO A CLIENTE   **E**   GATILHO AUTOMATICO AINDA ATIVO
 *
 * ─── A ARMADILHA QUE ESTE GATE MODELA E O DA #267 NAO MODELAVA ───────────────────────────────
 *
 * PUBLIC. Todo papel herda os privilegios de PUBLIC. Enquanto PUBLIC tiver EXECUTE, revogar
 * `anon`/`authenticated`/`service_role` nao tira o acesso de ninguem — `has_function_privilege()`
 * continua `true` para os tres e a revogacao parece aplicada sem ter efeito nenhum. Por isso
 * `exposicaoEfetiva()` trata PUBLIC concedido como exposicao de TODOS os papeis de cliente, em vez
 * de olhar so o grant nominal de cada um.
 *
 * ─── O QUE ELE LE ────────────────────────────────────────────────────────────────────────────
 *
 * O REPOSITORIO, nao o banco: o CI e hermetico e nao tem credencial. Percorre `supabase/migrations`
 * na ordem em que uma reconstrucao aplicaria (nome do arquivo = timestamp) e calcula o EFEITO
 * LIQUIDO. O GRANT historico do baseline continua la de proposito — reescreve-lo seria reescrever
 * o registro do que a producao era; o que precisa ser verdade e que algo POSTERIOR o revogue.
 *
 * ─── O VETOR DE VOLTA ────────────────────────────────────────────────────────────────────────
 *
 * `pg_default_acl` de `public` concede EXECUTE a `anon`/`authenticated`/`service_role` em toda
 * funcao nova, para os DOIS papeis criadores (Issue #271). Default privileges valem no momento do
 * CREATE, entao nao re-concedem nada para uma funcao que ja existe — mas um `DROP FUNCTION`
 * seguido de `CREATE` reaplica os defaults e traz a exposicao de volta sem ninguem escrever um
 * GRANT. `CREATE OR REPLACE` preserva a ACL e e seguro. Este gate distingue os dois casos.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_rls_auto_enable_privilege.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const FUNCTION_NAME = "rls_auto_enable";
export const TRIGGER_NAME = "ensure_rls";

/** Os papeis que um cliente pode assumir via PostgREST. `postgres` e dono e fica de fora. */
export const CLIENT_ROLES = ["anon", "authenticated", "service_role"];

/** Ordem de aplicacao = ordem do nome do arquivo, que neste repositorio e o timestamp. */
export function ddlFiles({ root = ROOT } = {}) {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && !f.includes(".reference.")).sort()
    .map((f) => ({ file: `supabase/migrations/${f}`, text: readFileSync(join(dir, f), "utf8") }));
}

/** `"public"."rls_auto_enable"()` com ou sem aspas, com ou sem schema. Zero argumentos. */
const alvo = String.raw`(?:"?public"?\s*\.\s*)?"?${FUNCTION_NAME}"?\s*\(\s*\)`;
/** PUBLIC nunca vem entre aspas duplas; os papeis nomeados podem vir. */
const papel = (r) => (r === "PUBLIC" ? String.raw`public` : String.raw`"?${r}"?`);

const grantRe  = (r) => new RegExp(String.raw`grant\s+(?:all|execute)[\s\S]{0,40}?on\s+function\s+${alvo}\s+to\s+${papel(r)}`, "i");
const revokeRe = (r) => new RegExp(String.raw`revoke\s+(?:all|execute)[\s\S]{0,40}?on\s+function\s+${alvo}\s+from\s+${papel(r)}`, "i");

/**
 * Efeito liquido de GRANT/REVOKE para UM papel. Dentro do mesmo arquivo vale o ultimo — comparar
 * indices evita concluir "revogado" quando o GRANT vem depois na mesma migracao.
 */
export function netGrant(role, files) {
  let granted = false, lastGrant = null, lastRevoke = null;
  for (const f of files) {
    const g = f.text.search(grantRe(role));
    const r = f.text.search(revokeRe(role));
    if (g === -1 && r === -1) continue;
    if (g > r) { granted = true; lastGrant = f.file; } else { granted = false; lastRevoke = f.file; }
  }
  return { granted, lastGrant, lastRevoke };
}

/**
 * Exposicao REAL de cada papel de cliente, ja contando a heranca de PUBLIC.
 *
 * Esta e a funcao que existe por causa da licao desta Issue: um papel esta exposto se tem grant
 * proprio OU se PUBLIC tem. Olhar so o grant nominal foi exatamente o erro que a autorizacao
 * mandou nao repetir.
 */
export function exposicaoEfetiva(files) {
  const pub = netGrant("PUBLIC", files);
  return CLIENT_ROLES.map((role) => {
    const own = netGrant(role, files);
    return {
      role,
      exposed: own.granted || pub.granted,
      via: own.granted && pub.granted ? "grant proprio + PUBLIC" : own.granted ? "grant proprio" : pub.granted ? "heranca de PUBLIC" : null,
      lastGrant: own.lastGrant, publicLastGrant: pub.lastGrant,
    };
  });
}

/** Estado liquido do gatilho: ACTIVE / DISABLED / ABSENT. */
export function triggerState(files) {
  const criado = new RegExp(String.raw`create\s+event\s+trigger\s+"?${TRIGGER_NAME}"?[\s\S]{0,400}?execute\s+(?:function|procedure)\s+${alvo}`, "i");
  const dropado = new RegExp(String.raw`drop\s+event\s+trigger\s+(?:if\s+exists\s+)?"?${TRIGGER_NAME}"?`, "i");
  const desligado = new RegExp(String.raw`alter\s+event\s+trigger\s+"?${TRIGGER_NAME}"?\s+disable`, "i");
  const religado = new RegExp(String.raw`alter\s+event\s+trigger\s+"?${TRIGGER_NAME}"?\s+enable`, "i");
  let state = "ABSENT", origem = null;
  for (const f of files) {
    for (const [re, next] of [[criado, "ACTIVE"], [dropado, "ABSENT"], [desligado, "DISABLED"], [religado, "ACTIVE"]]) {
      const i = f.text.search(re);
      if (i !== -1) { state = next; origem = f.file; }
    }
  }
  return { state, origem };
}

/**
 * `DROP FUNCTION` sem `CREATE` posterior reaplica os default privileges na recriacao. Este e o
 * unico caminho conhecido pelo qual a exposicao volta sem nenhum GRANT escrito.
 */
export function dropRecreateRisk(files) {
  const dropado = new RegExp(String.raw`drop\s+function\s+(?:if\s+exists\s+)?${alvo}`, "i");
  const criado = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+${alvo}`, "i");
  let risco = null;
  for (const f of files) {
    const d = f.text.search(dropado), c = f.text.search(criado);
    if (d === -1) continue;
    // Um DROP seguido de CREATE no MESMO arquivo ainda reaplica os defaults: a ACL some no DROP.
    risco = { file: f.file, recreatedSameFile: c > d };
  }
  return risco;
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nrls_auto_enable(): menor privilegio + gatilho vivo (Issue #270)\n");

  const files = ddlFiles();
  // Falha FECHADO: sem DDL nao da para afirmar nada sobre o efeito liquido.
  check("as fontes de DDL existem", files.length > 0, `${files.length} migracoes`);

  if (files.length) {
    // ─── METADE 1: SEM EXPOSICAO A CLIENTE ───────────────────────────────────────────────────
    const pub = netGrant("PUBLIC", files);
    check("PUBLIC nao tem EXECUTE no efeito liquido da DDL", !pub.granted,
      pub.granted ? `ultimo GRANT em ${pub.lastGrant}, sem REVOKE posterior — TODO papel herda isso`
                  : `revogado em ${pub.lastRevoke ?? "(nunca concedido no repositorio)"}`);

    const expostos = exposicaoEfetiva(files).filter((e) => e.exposed);
    check(`nenhum papel de cliente executa a funcao (${CLIENT_ROLES.length} papeis)`, expostos.length === 0,
      expostos.length ? `exposicao liquida:\n      ${expostos.map((e) => `${e.role} via ${e.via}`).join("\n      ")}`
                      : "anon, authenticated e service_role: sem EXECUTE, direto ou por heranca");

    // ─── METADE 2: GATILHO AUTOMATICO AINDA ATIVO ────────────────────────────────────────────
    // Sem isto, apagar o gatilho passaria no gate acima com nota maxima.
    const trg = triggerState(files);
    check(`o gatilho ${TRIGGER_NAME} continua ativo e ligado a funcao`, trg.state === "ACTIVE",
      trg.state === "ACTIVE" ? `definido em ${trg.origem}` : `estado liquido: ${trg.state} (${trg.origem ?? "nenhuma DDL o cria"})`);

    const risco = dropRecreateRisk(files);
    check("a funcao nao e recriada por DROP+CREATE (reaplicaria os default privileges)", risco === null,
      risco ? `DROP em ${risco.file}${risco.recreatedSameFile ? " com CREATE no mesmo arquivo — a ACL some no DROP e volta pelos defaults" : " sem CREATE posterior"}`
            : "nenhum DROP FUNCTION; CREATE OR REPLACE preserva a ACL");

    // ─── REVERSIBILIDADE ─────────────────────────────────────────────────────────────────────
    const rb = "supabase/rollbacks/20260821010000_rls_auto_enable_least_privilege.rollback.sql";
    let rbText = "";
    try { rbText = readFileSync(join(ROOT, rb), "utf8"); } catch { /* ausencia vira falha abaixo */ }
    check("o rollback existe e restaura os QUATRO grants", 
      CLIENT_ROLES.every((r) => grantRe(r).test(rbText)) && grantRe("PUBLIC").test(rbText),
      rbText ? "PUBLIC + anon + authenticated + service_role" : `${rb} nao encontrado`);
  }

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

// Guardado para que a suite de contrato importe as funcoes puras sem disparar a auditoria.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
