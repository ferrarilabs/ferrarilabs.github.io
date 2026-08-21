#!/usr/bin/env node
/**
 * CONTRATO DO GATE DE EXPOSICAO — Issue #267.
 *
 * O gate decide por EFEITO LIQUIDO: percorre a DDL na ordem de aplicacao e pergunta se, depois de
 * tudo, a funcao continua executavel por `anon`/`authenticated`/`PUBLIC`. Um gate que so procurasse
 * a palavra GRANT reprovaria o baseline para sempre — e reescrever o baseline seria reescrever o
 * registro do que a producao era.
 *
 * Por isso a ordem importa, e e ela que esta suite exercita: GRANT depois de REVOKE expoe; REVOKE
 * depois de GRANT nao; e dentro do MESMO arquivo vale o ultimo.
 *
 * Sem rede e sem banco.
 *
 * Uso: node scripts/db/test_operator_rpc_exposure.mjs
 */

import { PROTECTED_FUNCTIONS, PROTECTED_PREFIX, RATIFIED_EXPOSURES, netExposure } from "./audit_operator_rpc_exposure.mjs";

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const G = (fn, role) => `GRANT ALL ON FUNCTION "public"."${fn}"("p_a" "text") TO "${role}";`;
const R = (fn, role) => `revoke execute on function public.${fn}(p_a text) from ${role};`;
const f = (name, text) => ({ file: name, name, text });

console.log("\nContrato do gate de exposicao das RPCs de operador (Issue #267)\n");

test("GRANT sem REVOKE posterior => EXPOSTA", () => {
  const r = netExposure("op_x", "authenticated", [f("010.sql", G("op_x", "authenticated"))]);
  assert(r.exposed === true, "deveria estar exposta");
  assert(r.lastGrant === "010.sql", `arquivo errado: ${r.lastGrant}`);
});

test("REVOKE em arquivo POSTERIOR => nao exposta (o caso real da #267)", () => {
  const r = netExposure("op_x", "authenticated", [
    f("010.sql", G("op_x", "authenticated")),
    f("020.sql", R("op_x", "authenticated")),
  ]);
  assert(r.exposed === false, "o REVOKE posterior deveria neutralizar o GRANT do baseline");
  assert(r.lastRevoke === "020.sql", `arquivo errado: ${r.lastRevoke}`);
});

test("GRANT depois do REVOKE => EXPOSTA de novo (a regressao que o gate existe para pegar)", () => {
  const r = netExposure("op_x", "authenticated", [
    f("010.sql", G("op_x", "authenticated")),
    f("020.sql", R("op_x", "authenticated")),
    f("030.sql", G("op_x", "authenticated")),
  ]);
  assert(r.exposed === true, "reconceder depois de revogar tem de reprovar");
  assert(r.lastGrant === "030.sql", `deveria apontar o arquivo que reconcedeu: ${r.lastGrant}`);
});

test("dentro do MESMO arquivo, vale o ultimo", () => {
  const rev = netExposure("op_x", "authenticated", [f("010.sql", G("op_x", "authenticated") + "\n" + R("op_x", "authenticated"))]);
  assert(rev.exposed === false, "GRANT depois REVOKE no mesmo arquivo => revogada");
  const gr = netExposure("op_x", "authenticated", [f("010.sql", R("op_x", "authenticated") + "\n" + G("op_x", "authenticated"))]);
  assert(gr.exposed === true, "REVOKE depois GRANT no mesmo arquivo => exposta");
});

test("papeis sao independentes: revogar de authenticated nao afeta anon", () => {
  const files = [f("010.sql", G("op_x", "authenticated") + "\n" + G("op_x", "anon")),
                 f("020.sql", R("op_x", "authenticated"))];
  assert(netExposure("op_x", "authenticated", files).exposed === false, "authenticated deveria estar revogada");
  assert(netExposure("op_x", "anon", files).exposed === true, "anon NAO foi revogada e deve continuar sinalizada");
});

test("funcoes sao independentes: revogar op_x nao cobre op_y", () => {
  const files = [f("010.sql", G("op_x", "authenticated") + "\n" + G("op_y", "authenticated")),
                 f("020.sql", R("op_x", "authenticated"))];
  assert(netExposure("op_y", "authenticated", files).exposed === true, "op_y continua exposta e tem de aparecer");
});

test("sem DDL nenhuma sobre a funcao => nao inventa exposicao", () => {
  assert(netExposure("op_x", "authenticated", [f("010.sql", "select 1;")]).exposed === false,
    "silencio nao pode virar 'exposta' — geraria alarme falso permanente");
});

test("as sete da Issue #267 estao nomeadas, e o prefixo cobre o crescimento", () => {
  assert(PROTECTED_FUNCTIONS.length === 7, `esperado 7, veio ${PROTECTED_FUNCTIONS.length}`);
  for (const n of ["op_confirm_payment", "op_set_results", "resolve_notification_recipients"]) {
    assert(PROTECTED_FUNCTIONS.includes(n), `faltando: ${n}`);
  }
  assert(PROTECTED_PREFIX.test("op_qualquer_coisa_nova"), "uma RPC de operador nova deve nascer protegida");
  assert(!PROTECTED_PREFIX.test("submit_entry"), "RPC de participante nao pode entrar na lista protegida");
  assert(!PROTECTED_PREFIX.test("cdb_save_my_picks"), "RPC de participante nao pode entrar na lista protegida");
});

test("a lista de excecoes ratificadas esta vazia — nenhuma RPC de operador deve ser alcancavel por JWT", () => {
  assert(RATIFIED_EXPOSURES.length === 0,
    `apareceu excecao sem revisao: ${JSON.stringify(RATIFIED_EXPOSURES)}`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ OPERATOR RPC EXPOSURE CONTRACT FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
