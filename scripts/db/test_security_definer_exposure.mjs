#!/usr/bin/env node
/**
 * CONTRATO DO DETECTOR DE EXPOSICAO SECURITY DEFINER — Issue #273.
 *
 * Um detector de seguranca verde nao vale nada enquanto ninguem provar que ele fica vermelho.
 * Esta suite monta repositorios sinteticos completos (DDL + manifesto + chamadores) num diretorio
 * temporario e exige o veredito certo em cada um.
 *
 * Sem rede e sem banco. Uso: node scripts/db/test_security_definer_exposure.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { report, coverageOk, MIN_EXPECTED_SECDEF, callersOf, callerFiles, ddlSources } from "./audit_security_definer_exposure.mjs";
import { capabilitiesOf, effectiveRoles, clientExposed, classify, CLASSIFICATIONS } from "./secdef_exposure_model.mjs";
import { resolveDdl, stripSqlComments, parseFunctions } from "./secdef_ddl_parse.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const criados = [];
/** Monta um repositorio sintetico: { "supabase/migrations/001.sql": "...", ... } */
function repo(arquivos, manifest) {
  const root = mkdtempSync(join(tmpdir(), "secdef-"));
  criados.push(root);
  for (const [rel, txt] of Object.entries(arquivos)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, txt);
  }
  mkdirSync(join(root, "bolao/shared/safety"), { recursive: true });
  writeFileSync(join(root, "bolao/shared/safety/ratified_rpc_exposure.json"), JSON.stringify(manifest ?? { ratified: [], publicRelianceBaseline: [] }));
  return root;
}
const FN = (name, extra = "security definer set search_path = public") =>
  `create or replace function public.${name}(p_a text) returns void language plpgsql ${extra} as $$ begin end $$;`;

console.log("\nContrato do detector de exposicao SECURITY DEFINER (Issue #273)\n");

// ── 1. HERANCA DE PUBLIC ──────────────────────────────────────────────────────────────────────

test("1. PUBLIC concedido expoe TODOS os papeis, nao so PUBLIC", () => {
  const eff = effectiveRoles({ explicitGrants: [], publicGranted: true });
  for (const r of ["anon", "authenticated", "service_role", "PUBLIC"]) assert(eff.includes(r), `${r} deveria estar exposto por heranca`);
  assert(clientExposed(eff), "deveria contar como exposicao a cliente");
});

// ── 2. A MUTACAO QUE DEU ORIGEM A ISSUE #270 ─────────────────────────────────────────────────

test("2. revogar anon/authenticated e DEIXAR PUBLIC continua exposto", () => {
  const root = repo({
    "supabase/migrations/001.sql": `${FN("f")}\ngrant execute on function public.f(text) to public;\ngrant execute on function public.f(text) to anon, authenticated;`,
    "supabase/migrations/002.sql": `revoke execute on function public.f(text) from anon;\nrevoke execute on function public.f(text) from authenticated;`,
  });
  const { rows } = report({ root });
  const f = rows.find((r) => r.fn.name === "f");
  assert(f, "funcao nao encontrada");
  assert(clientExposed(f.roles), `ainda deveria estar exposta; roles=${f.roles.join(",")}`);
  assert(f.roles.includes("PUBLIC"), "PUBLIC deveria continuar na lista");
  assert(f.fatal, "sem ratificacao, deveria reprovar");
});

// ── 3. FUNCAO NOVA COM PUBLIC EXECUTE POR PADRAO EMBUTIDO ─────────────────────────────────────

test("3. SECURITY DEFINER nova sem `revoke from public` explicito e detectada", () => {
  const root = repo({ "supabase/migrations/001.sql": FN("nova") });
  const { rows } = report({ root });
  const f = rows.find((r) => r.fn.name === "nova");
  assert(f.publicReliesOnDefault, "deveria ser marcada como dependente do pg_default_acl");
});

test("3b. a mesma funcao COM `revoke from public` explicito nao e marcada", () => {
  const root = repo({ "supabase/migrations/001.sql": `${FN("nova")}\nrevoke all on function public.nova(text) from public;` });
  const { rows } = report({ root });
  assert(!rows.find((r) => r.fn.name === "nova").publicReliesOnDefault, "o revoke explicito deveria limpar a marca");
});

// ── 4. RPC ESTREITA LEGITIMA, RATIFICADA, PASSA ──────────────────────────────────────────────

test("4. RPC de cliente ratificada, com chamador presente, passa", () => {
  const root = repo({
    "supabase/migrations/001.sql": `${FN("minha_rpc")}\nrevoke all on function public.minha_rpc(text) from public;\ngrant execute on function public.minha_rpc(text) to anon, authenticated;`,
    "bolao/app/app.js": `const r = await cdbRpc("minha_rpc", { p_a: 1 });`,
  }, {
    ratified: [{ key: "public.minha_rpc/1", allowedRoles: ["anon", "authenticated"], classification: "EXPECTED_CLIENT_RPC",
      expectedCaller: "bolao/app/app.js", declaredCapabilities: [] }],
    publicRelianceBaseline: [],
  });
  const { rows } = report({ root });
  const f = rows.find((r) => r.fn.name === "minha_rpc");
  assert(!f.fatal, `deveria passar; achados: ${f.findings.join("; ")}`);
  assert(f.classification === CLASSIFICATIONS.EXPECTED_CLIENT_RPC, `classificou como ${f.classification}`);
});

test("4b. ratificacao NAO cobre papel alem do declarado", () => {
  const root = repo({
    "supabase/migrations/001.sql": `${FN("minha_rpc")}\ngrant execute on function public.minha_rpc(text) to anon, authenticated, service_role;`,
    "bolao/app/app.js": `cdbRpc("minha_rpc", {})`,
  }, {
    ratified: [{ key: "public.minha_rpc/1", allowedRoles: ["anon"], classification: "EXPECTED_CLIENT_RPC",
      expectedCaller: "bolao/app/app.js", declaredCapabilities: [] }],
    publicRelianceBaseline: [],
  });
  const f = report({ root }).rows.find((r) => r.fn.name === "minha_rpc");
  assert(f.fatal, "papel a mais que a ratificacao deveria reprovar");
});

// ── 5. CHAMADOR SUMIU, GRANT FICOU ───────────────────────────────────────────────────────────

test("5. ratificada mas SEM chamador e levantada para revisao, nao aprovada em silencio", () => {
  const root = repo({
    "supabase/migrations/001.sql": `${FN("orfa")}\ngrant execute on function public.orfa(text) to anon;`,
    "bolao/app/app.js": `// so um comentario mencionando orfa, sem chamar`,
  }, {
    ratified: [{ key: "public.orfa/1", allowedRoles: ["anon"], classification: "EXPECTED_CLIENT_RPC",
      expectedCaller: "bolao/app/app.js", declaredCapabilities: [] }],
    publicRelianceBaseline: [],
  });
  const f = report({ root }).rows.find((r) => r.fn.name === "orfa");
  assert(f.classification === CLASSIFICATIONS.UNKNOWN, `deveria ser UNKNOWN, veio ${f.classification}`);
  assert(f.fatal, "privilegio sem chamador nao pode passar calado");
});

test("5b. quarentena com prazo em aberto e VISIVEL mas nao fatal; vencida e fatal", () => {
  const mk = (reviewByIso) => repo({
    "supabase/migrations/001.sql": `${FN("orfa")}\ngrant execute on function public.orfa(text) to anon;`,
    "bolao/app/app.js": `// sem chamada`,
  }, {
    ratified: [{ key: "public.orfa/1", allowedRoles: ["anon"], classification: "UNKNOWN", expectedCaller: "bolao/app/app.js",
      declaredCapabilities: [], quarantine: { reviewIssue: 274, reviewByIso } }],
    publicRelianceBaseline: [],
  });
  const aberta = report({ root: mk("2099-01-01"), now: new Date("2026-08-21") }).rows.find((r) => r.fn.name === "orfa");
  assert(aberta.quarantined && !aberta.fatal, "quarentena no prazo nao deveria reprovar");
  const vencida = report({ root: mk("2026-01-01"), now: new Date("2026-08-21") }).rows.find((r) => r.fn.name === "orfa");
  assert(vencida.fatal, "quarentena VENCIDA tem de reprovar — senao vira permanente em silencio");
});

test("5c. mencao em comentario NAO conta como chamador", () => {
  const files = [{ file: "a.js", text: `// a rpc cdb_save_my_picks grava o palpite` }];
  assert(callersOf("cdb_save_my_picks", files).length === 0, "comentario nao e chamada");
  const reais = [{ file: "b.js", text: `await cdbRpc("cdb_save_my_picks", {})` }];
  assert(callersOf("cdb_save_my_picks", reais).length === 1, "invocacao real deveria contar");
});

// ── 6. VARREDURA VAZIA NAO PODE FICAR VERDE ──────────────────────────────────────────────────

test("6. varredura vazia reprova pelo piso de cobertura", () => {
  const root = repo({ "supabase/migrations/001.sql": "-- nada aqui" });
  const { rows } = report({ root });
  assert(rows.length === 0, `esperava varredura vazia, veio ${rows.length}`);
  assert(!coverageOk(rows.length), "varredura vazia NAO pode passar no piso");
  assert(MIN_EXPECTED_SECDEF > 0, "um piso zero tornaria a checagem decorativa");
});

test("6b. o repositorio real fica acima do piso", () => {
  assert(coverageOk(report({}).rows.length), `o repositorio deveria ter >= ${MIN_EXPECTED_SECDEF} funcoes SECURITY DEFINER`);
});

test("6c. DDL comentada nao pode encolher a varredura (regressao real do detector)", () => {
  // A primeira versao lia `-- drop function if exists submit_entry(...)` dentro de um bloco
  // `-- ROLLBACK:` como remocao real e perdia 17 funcoes -- ficando verde por enxergar menos.
  const root = repo({
    "supabase/migrations/001.sql": `${FN("viva")}\n-- ROLLBACK:\n-- drop function if exists viva(text);`,
  });
  const { rows } = report({ root });
  assert(rows.some((r) => r.fn.name === "viva"), "um drop COMENTADO nao remove a funcao da varredura");
});

// ── 7. search_path E REPORTADO SEPARADO DO EXECUTE ───────────────────────────────────────────

test("7. search_path nao fixado e um achado independente da exposicao", () => {
  const root = repo({ "supabase/migrations/001.sql": FN("sem_path", "security definer") });
  const f = report({ root }).rows.find((r) => r.fn.name === "sem_path");
  assert(f.fn.searchPath === null, "deveria registrar search_path ausente");
  assert(!clientExposed(f.roles), "esta funcao nao tem grant nenhum — nao e exposicao de EXECUTE");
  // Os dois eixos sao ortogonais: privada com search_path solto, e exposta com search_path fixo.
  const root2 = repo({ "supabase/migrations/001.sql": `${FN("com_path")}\ngrant execute on function public.com_path(text) to anon;` });
  const g = report({ root: root2 }).rows.find((r) => r.fn.name === "com_path");
  assert(g.fn.searchPath === "public" && clientExposed(g.roles), "exposta E com search_path fixado deve ser possivel");
});

// ── 8. service_role NAO E SEGURO POR SER PRIVILEGIADO ────────────────────────────────────────

test("8. infraestrutura de banco exposta a service_role REPROVA", () => {
  const infra = { name: "rls_like", secdef: true, returns: "RETURNS event_trigger", body: "begin end",
    effectiveRoles: ["service_role"], capabilities: ["ADMINISTERS_SCHEMA", "EVENT_TRIGGER_ONLY"] };
  const v = classify(infra, { ratified: null });
  assert(v.fatal, "service_role em funcao de infraestrutura tem de reprovar");
  assert(v.classification === CLASSIFICATIONS.UNEXPECTED_EXPOSURE, `veio ${v.classification}`);
});

test("8b. a MESMA funcao so com o dono passa como INTERNAL_INFRASTRUCTURE", () => {
  const v = classify({ name: "rls_like", secdef: true, returns: "RETURNS event_trigger", body: "begin end",
    effectiveRoles: [], capabilities: ["ADMINISTERS_SCHEMA", "EVENT_TRIGGER_ONLY"] }, { ratified: null });
  assert(!v.fatal && v.classification === CLASSIFICATIONS.INTERNAL_INFRASTRUCTURE, `veio ${v.classification}`);
});

test("8c. service_role numa RPC de servico normal e aceito, mas CLASSIFICADO", () => {
  const v = classify({ name: "op_algo", secdef: true, returns: "RETURNS void", body: "update bolao_state set x=1",
    effectiveRoles: ["service_role"] }, { ratified: null });
  assert(v.classification === CLASSIFICATIONS.EXPECTED_SERVICE_RPC, `veio ${v.classification}`);
  assert(!v.fatal, "RPC de servico legitima nao deveria reprovar");
});

// ── CAPACIDADE, NAO NOME ─────────────────────────────────────────────────────────────────────

test("capacidade sai do CORPO: nome inocente que grava pagamento e detectado", () => {
  const caps = capabilitiesOf({ body: "insert into lottery_payment_transactions(a) values (1);", returns: "RETURNS void" });
  assert(caps.includes("WRITES_PAYMENT"), `esperava WRITES_PAYMENT, veio ${caps.join(",")}`);
});

test("DERIVA DE CAPACIDADE: corpo ganha capacidade que a ratificacao nao previa => reprova", () => {
  const v = classify({ name: "rpc", secdef: true, returns: "RETURNS void",
    body: "insert into lottery_payment_transactions(a) values (1);", effectiveRoles: ["anon"] },
    { ratified: { allowedRoles: ["anon"], declaredCapabilities: ["READS_POOL_STATE"], expectedCaller: "x" }, callerFound: true });
  assert(v.fatal && v.classification === CLASSIFICATIONS.UNKNOWN, `esperava UNKNOWN fatal, veio ${v.classification}`);
});

test("DML comentada dentro do corpo NAO vira capacidade", () => {
  const [fn] = parseFunctions(`create function public.x() returns void language plpgsql as $$ begin -- insert into lottery_payment_transactions(a) values(1);
  end $$;`);
  assert(!capabilitiesOf(fn).includes("WRITES_PAYMENT"), "insert comentado nao e capacidade");
});

// ── ORDEM E DROP ─────────────────────────────────────────────────────────────────────────────

test("DROP FUNCTION destroi a ACL: grant anterior nao sobrevive a recriacao", () => {
  const root = repo({
    "supabase/migrations/001.sql": `${FN("f")}\ngrant execute on function public.f(text) to anon;`,
    "supabase/migrations/002.sql": `drop function if exists public.f(text);\n${FN("f")}`,
  });
  const f = report({ root }).rows.find((r) => r.fn.name === "f");
  assert(!clientExposed(f.roles), `a ACL deveria ter sido destruida pelo drop; roles=${f.roles.join(",")}`);
});

test("stripSqlComments preserva literais e o tamanho do texto", () => {
  const t = "select 'a--b'; -- some\n";
  const s = stripSqlComments(t);
  assert(s.length === t.length, "o tamanho tem de ser preservado (os indices ordenam os eventos)");
  assert(s.includes("'a--b'"), "literal com -- dentro nao pode ser tratado como comentario");
});

// ── ISSUE #274 — o grant de cliente aposentado nao pode voltar ───────────────────────────────
//
// `cdb_reserve_entry_saved_email` tinha EXECUTE para anon/authenticated por um chamador de
// navegador que NUNCA foi escrito: um unico commit em toda a historia, so com SQL, e zero
// ocorrencias no bundle publicado. Revogado em producao em 2026-08-21. Estes testes garantem que
// uma reaplicacao da DDL nao o devolva.

const RESERVE = "public.cdb_reserve_entry_saved_email/1";
const REMEDIACAO_274 = "20260821040000_retire_cdb_reserve_entry_saved_email_client_grant";

/** Papeis efetivos da funcao a partir da DDL real, opcionalmente sem a migracao de remediacao. */
function papeisDaReserve({ semRemediacao = false } = {}) {
  const files = ddlSources().filter((f) => !semRemediacao || !f.file.includes(REMEDIACAO_274));
  const st = resolveDdl(files);
  const e = st.get(RESERVE);
  assert(e, `${RESERVE} nao encontrada na DDL`);
  return effectiveRoles({
    explicitGrants: [...e.roles].filter((r) => r !== "PUBLIC"),
    publicGranted: e.roles.has("PUBLIC"),
  });
}

test("#274.1 anon nao executa a RPC aposentada", () => {
  assert(!papeisDaReserve().includes("anon"), "anon deveria ter perdido EXECUTE");
});

test("#274.2 authenticated nao executa a RPC aposentada", () => {
  assert(!papeisDaReserve().includes("authenticated"), "authenticated deveria ter perdido EXECUTE");
});

test("#274.3 service_role CONTINUA executando", () => {
  // Diferente da #270: isto nao e infraestrutura de banco, e uma RPC de aplicacao cuja familia
  // inteira e chamada por script com credencial privilegiada. Revogar service_role aqui seria
  // copiar a forma de outra remediacao sem o motivo dela.
  assert(papeisDaReserve().includes("service_role"), "service_role tem de continuar podendo executar");
});

test("#274.4 PUBLIC nao recria o acesso por heranca", () => {
  const papeis = papeisDaReserve();
  assert(!papeis.includes("PUBLIC"), "PUBLIC nao pode ter EXECUTE — todo papel herdaria");
  assert(!clientExposed(papeis), `nenhum papel de cliente pode alcancar; veio ${papeis.join(",")}`);
});

test("#274.5 remover a migracao de remediacao FAZ o teste falhar", () => {
  const semRemediacao = papeisDaReserve({ semRemediacao: true });
  assert(semRemediacao.includes("anon") && semRemediacao.includes("authenticated"),
    `sem a remediacao a exposicao TEM de reaparecer; veio ${semRemediacao.join(",")}`);
  assert(clientExposed(semRemediacao), "sem a remediacao a funcao volta a ser alcancavel por cliente");
});

test("#274.6 a funcao NAO esta na lista de RPCs de cliente ratificadas", () => {
  const man = JSON.parse(readFileSync(join(ROOT, "bolao/shared/safety/ratified_rpc_exposure.json"), "utf8"));
  assert(!man.ratified.some((r) => r.key === RESERVE),
    "aposentar o grant nao pode virar ratificacao — ela deixou de ser alcancavel, nao virou API");
  assert(!man.ratified.some((r) => r.quarantine), "nao deve sobrar quarentena aberta");
});

for (const d of criados) { try { rmSync(d, { recursive: true, force: true }); } catch { /* diretorio temporario ja removido */ } }

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
