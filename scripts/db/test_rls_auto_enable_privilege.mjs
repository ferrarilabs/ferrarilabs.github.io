#!/usr/bin/env node
/**
 * CONTRATO DO GATE DE `rls_auto_enable()` — Issue #270.
 *
 * Um gate verde nao vale nada enquanto ninguem provar que ele fica vermelho. Esta suite escreve
 * conjuntos de DDL sinteticos e exige o veredito certo em cada um.
 *
 * O caso que da nome a Issue e o CASO 3: revogar `anon`, `authenticated` e `service_role` e
 * DEIXAR PUBLIC. E a mutacao que um gate ingenuo aprova — os tres grants nominais sumiram — e que
 * na pratica nao tira o acesso de ninguem, porque todo papel herda PUBLIC. Se algum dia alguem
 * "simplificar" `exposicaoEfetiva()` para olhar so o grant proprio, este teste fica vermelho.
 *
 * Sem rede e sem banco. Uso: node scripts/db/test_rls_auto_enable_privilege.mjs
 */

import { CLIENT_ROLES, exposicaoEfetiva, netGrant, triggerState, dropRecreateRisk, ddlFiles } from "./audit_rls_auto_enable_privilege.mjs";

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const f = (file, text) => ({ file, text });
const G = (role) => `GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO ${role === "PUBLIC" ? "PUBLIC" : `"${role}"`};`;
const R = (role) => `revoke execute on function public.rls_auto_enable() from ${role === "PUBLIC" ? "PUBLIC" : role};`;
const CREATE_TRG = `CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.rls_auto_enable();`;

console.log("\nContrato do gate de rls_auto_enable() (Issue #270)\n");

// ─── EFEITO LIQUIDO, POR ORDEM ─────────────────────────────────────────────────────────────────

test("GRANT sem REVOKE posterior deixa o papel concedido", () => {
  assert(netGrant("anon", [f("001.sql", G("anon"))]).granted, "deveria estar concedido");
});

test("REVOKE depois de GRANT tira o privilegio", () => {
  const r = netGrant("anon", [f("001.sql", G("anon")), f("002.sql", R("anon"))]);
  assert(!r.granted, "deveria estar revogado");
  assert(r.lastRevoke === "002.sql", `revogado por ${r.lastRevoke}`);
});

test("GRANT depois de REVOKE reexpoe (a ordem importa, nao a presenca)", () => {
  assert(netGrant("anon", [f("001.sql", R("anon")), f("002.sql", G("anon"))]).granted, "regrant deveria expor");
});

test("dentro do MESMO arquivo vale o ultimo", () => {
  assert(netGrant("anon", [f("001.sql", `${R("anon")}\n${G("anon")}`)]).granted, "GRANT por ultimo expoe");
  assert(!netGrant("anon", [f("001.sql", `${G("anon")}\n${R("anon")}`)]).granted, "REVOKE por ultimo revoga");
});

// ─── CASO 3 — A ARMADILHA DESTA ISSUE ──────────────────────────────────────────────────────────

test("CASO 3: revogar os tres papeis e DEIXAR PUBLIC nao estabelece menor privilegio", () => {
  const files = [
    f("001.sql", [G("PUBLIC"), G("anon"), G("authenticated"), G("service_role")].join("\n")),
    // A mutacao ingenua: copia a #267 e revoga so os grants nominais.
    f("002.sql", [R("anon"), R("authenticated"), R("service_role")].join("\n")),
  ];
  for (const role of CLIENT_ROLES) {
    assert(!netGrant(role, files).granted, `${role} nao deveria ter grant PROPRIO`);
  }
  const expostos = exposicaoEfetiva(files).filter((e) => e.exposed);
  assert(expostos.length === CLIENT_ROLES.length,
    `os tres papeis continuam expostos por heranca; o gate viu ${expostos.length}`);
  assert(expostos.every((e) => e.via === "heranca de PUBLIC"),
    `motivo errado: ${expostos.map((e) => e.via).join(", ")}`);
});

test("CASO 3b: revogar PUBLIC TAMBEM zera a exposicao", () => {
  const files = [
    f("001.sql", [G("PUBLIC"), G("anon"), G("authenticated"), G("service_role")].join("\n")),
    f("002.sql", [R("PUBLIC"), R("anon"), R("authenticated"), R("service_role")].join("\n")),
  ];
  assert(exposicaoEfetiva(files).every((e) => !e.exposed), "nenhum papel deveria sobrar exposto");
});

test("CASO 3c: revogar SO PUBLIC nao basta se sobra grant nominal", () => {
  const files = [f("001.sql", [G("PUBLIC"), G("anon")].join("\n")), f("002.sql", R("PUBLIC"))];
  const anon = exposicaoEfetiva(files).find((e) => e.role === "anon");
  assert(anon.exposed && anon.via === "grant proprio", `esperava grant proprio, veio ${anon.via}`);
});

// ─── METADE 2: O GATILHO ───────────────────────────────────────────────────────────────────────

test("gatilho criado e ligado a funcao conta como ACTIVE", () => {
  assert(triggerState([f("001.sql", CREATE_TRG)]).state === "ACTIVE", "deveria estar ativo");
});

test("apagar o gatilho e detectado (zerar exposicao destruindo a funcionalidade)", () => {
  const s = triggerState([f("001.sql", CREATE_TRG), f("002.sql", "DROP EVENT TRIGGER ensure_rls;")]);
  assert(s.state === "ABSENT", `esperava ABSENT, veio ${s.state}`);
});

test("desligar o gatilho e detectado, e religar volta a ACTIVE", () => {
  const base = [f("001.sql", CREATE_TRG)];
  assert(triggerState([...base, f("002.sql", "ALTER EVENT TRIGGER ensure_rls DISABLE;")]).state === "DISABLED", "esperava DISABLED");
  assert(triggerState([...base, f("002.sql", "ALTER EVENT TRIGGER ensure_rls DISABLE;"), f("003.sql", "ALTER EVENT TRIGGER ensure_rls ENABLE;")]).state === "ACTIVE", "esperava ACTIVE");
});

test("um gatilho com o nome certo mas ligado a OUTRA funcao nao conta como ativo", () => {
  const s = triggerState([f("001.sql", "CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.outra_coisa();")]);
  assert(s.state === "ABSENT", `esperava ABSENT, veio ${s.state}`);
});

// ─── VETOR DE VOLTA PELOS DEFAULT PRIVILEGES ───────────────────────────────────────────────────

test("DROP+CREATE e sinalizado (reaplica os default privileges da Issue #271)", () => {
  const r = dropRecreateRisk([f("001.sql", "DROP FUNCTION public.rls_auto_enable();\nCREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger AS $$ BEGIN END $$ LANGUAGE plpgsql;")]);
  assert(r !== null && r.recreatedSameFile, "DROP seguido de CREATE deveria ser risco");
});

test("CREATE OR REPLACE sozinho NAO e risco (preserva a ACL)", () => {
  assert(dropRecreateRisk([f("001.sql", "CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger AS $$ BEGIN END $$ LANGUAGE plpgsql;")]) === null,
    "CREATE OR REPLACE nao deveria ser sinalizado");
});

// ─── O REPOSITORIO DE VERDADE ──────────────────────────────────────────────────────────────────

test("o repositorio real chega ao estado medido em producao", () => {
  const files = ddlFiles();
  assert(files.length > 0, "nenhuma migracao encontrada");
  assert(!netGrant("PUBLIC", files).granted, "PUBLIC continua concedido no efeito liquido");
  assert(exposicaoEfetiva(files).every((e) => !e.exposed), "algum papel de cliente continua exposto");
  assert(triggerState(files).state === "ACTIVE", "o gatilho ensure_rls nao esta ativo na DDL");
});

test("o baseline historico REALMENTE concedia — senao este gate nao guarda nada", () => {
  // Se um dia alguem "limpar" o baseline, o gate passaria por vacuidade. Isto exige que o
  // registro historico continue la, e e o que torna a revogacao posterior significativa.
  const baseline = ddlFiles().filter((x) => x.file.includes("20260811160000_baseline_adopted_grants_and_rls"));
  assert(baseline.length === 1, "o baseline de grants sumiu");
  assert(/GRANT ALL ON FUNCTION "public"\."rls_auto_enable"\(\) TO "anon"/.test(baseline[0].text),
    "o GRANT historico a anon nao esta mais no baseline");
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
