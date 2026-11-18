#!/usr/bin/env node
/**
 * PARTICIPANTES AO VIVO — js/live_participants.js (2026-11-18).
 *
 * O site passou a ler o sorteio aberto direto do banco pela RPC `lottery_public_open_draws` e a
 * usar o data.js como fallback. Este teste prova as regras da mescla, sem rede e sem navegador:
 *
 *   - so sorteios SEM resultado e PRESENTES no data.js mudam;
 *   - resposta fora de forma e recusada INTEIRA (nada de meio banco, meio data.js);
 *   - banco com MENOS participantes que o data.js nao apaga ninguem;
 *   - o formato publico (campos, data/hora, status, state herdado) e o mesmo do data.js;
 *   - nenhum campo privado da RPC chegaria a pagina, mesmo que a RPC um dia devolvesse um;
 *   - a migracao so seleciona colunas publicas e a app escapa o que vem do banco.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_live_participants.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = join(AQUI, "..");
const ROOT = join(APP, "..", "..", "..");

const ctx = { Intl, Date, Number, isFinite, isNaN, setTimeout, clearTimeout, Promise, JSON };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(APP, "js/live_participants.js"), "utf8"), ctx);
const LIVE = ctx.POWERBALL_LIVE;

let pass = 0, fail = 0;
const test = async (nome, fn) => {
  try { await fn(); console.log(`  ✓ ${nome}`); pass++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const ORG = "Fundo próprio (organizador)";
function sorteios() {
  return [
    { id: "2026-11-17", participants: [{ name: "Ana", cotas: 1, valor: 10, metodo: "Zelle", data: "14/11/2026", hora: "9:00:00 AM", status: "verificado", state: "FL" }],
      finance: { totalArrecadado: 10 }, result: { numbers: [1, 2, 3, 4, 5] } },
    { id: "2026-11-20", participants: [{ name: "Eduardo Ferrari", cotas: 1, valor: 10, metodo: ORG, data: "18/11/2026", hora: "6:49:06 AM", status: "organizador", state: "NC" }],
      finance: { totalArrecadado: 10 }, result: null },
  ];
}
const linha = (o) => ({ draw_date: "2026-11-20", name: "Eduardo Ferrari", cotas: 1, valor: 10, metodo: ORG, paid_at: "2026-11-18T11:49:06+00:00", contribuiu: true, ...o });

console.log("\nParticipantes ao vivo (live_participants.js)\n");

await test("mescla o sorteio aberto: acrescenta quem pagou, soma o total, herda o estado", () => {
  const d = sorteios();
  const r = LIVE.mesclar(d, [linha({}), linha({ name: "Ana", metodo: "Zelle", paid_at: "2026-11-18T13:09:32+00:00" })]);
  assert(r.ok, "recusou resposta valida");
  eq([...r.alterados], ["2026-11-20"], "alterados");
  eq(d[1].participants.length, 2, "participantes");
  eq(d[1].finance.totalArrecadado, 20, "total");
  const ana = d[1].participants.find((p) => p.name === "Ana");
  eq(ana.state, "FL", "state herdado do sorteio anterior");
  eq(ana.status, "verificado", "status");
  eq(ana.data, "18/11/2026", "data em ET");
  eq(ana.hora, "8:09:32 AM", "hora em ET, espaco comum");
  eq(d[1].participants.find((p) => p.name === "Eduardo Ferrari").status, "organizador", "organizador");
});

await test("formato publico identico ao do data.js (mesmas chaves, na mesma ordem)", () => {
  const d = sorteios();
  LIVE.mesclar(d, [linha({})]);
  const org = d[1].participants.find((p) => p.name === "Eduardo Ferrari");
  eq(Object.keys(org), ["name", "cotas", "valor", "metodo", "data", "hora", "status", "state"], "chaves");
  eq(org.hora, "6:49:06 AM", "hora igual a do data.js");
});

await test("campo privado que a RPC devolvesse NAO chega a pagina", () => {
  const d = sorteios();
  LIVE.mesclar(d, [linha({ email: "x@example.invalid", external_reference: "SYNTH-1", memo: "m" })]);
  const s = JSON.stringify(d[1].participants);
  assert(!/email|external_reference|memo|example\.invalid|SYNTH-/.test(s), "vazou: " + s);
});

await test("sorteio com resultado fica intocado", () => {
  const d = sorteios();
  const antes = JSON.stringify(d[0]);
  LIVE.mesclar(d, [linha({ draw_date: "2026-11-17", name: "Intruso" })]);
  eq(JSON.stringify(d[0]), antes, "sorteio fechado mudou");
});

await test("sorteio que nao existe no data.js e ignorado", () => {
  const d = sorteios();
  const r = LIVE.mesclar(d, [linha({ draw_date: "2026-11-24" })]);
  eq([...r.alterados], [], "alterados");
});

await test("banco com MENOS participantes que o data.js nao apaga ninguem", () => {
  const d = sorteios();
  d[1].participants.push({ name: "Bia", cotas: 1, valor: 10, metodo: "Zelle", data: "18/11/2026", hora: "9:00:00 AM", status: "verificado", state: null });
  const r = LIVE.mesclar(d, [linha({})]);
  eq([...r.alterados], [], "alterados");
  eq(d[1].participants.length, 2, "participantes");
});

await test("resposta vazia (sem sorteio aberto no banco) nao apaga ninguem", () => {
  const d = sorteios();
  const r = LIVE.mesclar(d, []);
  assert(r.ok, "lista vazia e resposta valida");
  eq(d[1].participants.length, 1, "participantes");
});

for (const [nome, ruim] of [
  ["nao-lista", { draw_date: "2026-11-20" }],
  ["data invalida", [linha({ draw_date: "20/11/2026" })]],
  ["nome vazio", [linha({ name: "  " })]],
  ["cotas zero", [linha({ cotas: 0 })]],
  ["valor nao numerico", [linha({ valor: "dez" })]],
  ["metodo objeto", [linha({ metodo: {} })]],
  ["paid_at numero", [linha({ paid_at: 123 })]],
  ["sem contribuiu", [linha({ contribuiu: undefined })]],
  ["nome com cara de e-mail", [linha({ name: "fulano@example.invalid" })]],
  ["nome com cara de telefone", [linha({ name: "Fulano +1 (704) 555-0100" })]],
  ["null no meio", [linha({}), null]],
]) {
  await test(`recusa resposta fora de forma (${nome}) sem tocar em nada`, () => {
    const d = sorteios();
    const antes = JSON.stringify(d);
    const r = LIVE.mesclar(d, ruim);
    assert(!r.ok, "aceitou");
    eq(JSON.stringify(d), antes, "mudou algo");
  });
}

await test("valor numeric do Postgres em string ('10.00') vira 10", () => {
  const d = sorteios();
  LIVE.mesclar(d, [linha({ valor: "10.00", cotas: "1.0000" })]);
  const org = d[1].participants.find((p) => p.name === "Eduardo Ferrari");
  eq(org.valor, 10, "valor");
  eq(org.cotas, 1, "cotas");
});

await test("participacao sem contribuicao aparece como pendente, sem data", () => {
  const d = sorteios();
  LIVE.mesclar(d, [linha({}), linha({ name: "Caio", metodo: null, paid_at: null, valor: 0, contribuiu: false })]);
  const c = d[1].participants.find((p) => p.name === "Caio");
  eq([c.status, c.data, c.hora, c.metodo], ["pendente", "—", "—", null], "pendente");
});

await test("contribuicao sem horario gravado continua verificada (regra da projecao)", () => {
  const d = sorteios();
  LIVE.mesclar(d, [linha({}), linha({ name: "Davi", metodo: "Zelle", paid_at: null, contribuiu: true })]);
  eq(d[1].participants.find((p) => p.name === "Davi").status, "verificado", "status");
});

await test("sorteio com bilhetes ja comprados fica intocado (deposito tardio nao entra nos jogos)", () => {
  const d = sorteios();
  d[1].sharedTickets = { series: [{ serial: "SYNTH-1" }] };
  const r = LIVE.mesclar(d, [linha({}), linha({ name: "Tardio", metodo: "Zelle" })]);
  eq([...r.alterados], [], "alterados");
  eq(d[1].participants.length, 1, "participantes");
});

await test("buscar: desligado, sem chave ou falha de rede devolvem null (fallback no data.js)", async () => {
  eq(await LIVE.buscar({ enabled: false, url: "u", anonKey: "k" }, () => { throw new Error("nao devia chamar"); }), null, "desligado");
  eq(await LIVE.buscar({ enabled: true, url: "u" }, () => { throw new Error("nao devia chamar"); }), null, "sem chave");
  eq(await LIVE.buscar({ enabled: true, url: "u", anonKey: "k" }, () => Promise.reject(new Error("rede"))), null, "rede");
  eq(await LIVE.buscar({ enabled: true, url: "u", anonKey: "k" }, () => Promise.resolve({ ok: false })), null, "HTTP erro");
});

await test("buscar: fora da origem de producao nao chama o banco (testes e servidor local)", async () => {
  ctx.location = { origin: "http://127.0.0.1:8080" };
  const nunca = () => { throw new Error("nao devia chamar"); };
  eq(await LIVE.buscar({ enabled: true, url: "u", anonKey: "k", origins: ["https://www.ferrarilabs.com"] }, nunca), null, "local");
  ctx.location = { origin: "https://www.ferrarilabs.com" };
  const ok = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  eq([...(await LIVE.buscar({ enabled: true, url: "u", anonKey: "k", origins: ["https://www.ferrarilabs.com"] }, ok))], [], "producao");
  delete ctx.location;
});

await test("config.js de producao: ligado, so na origem canonica, chave publica (nunca service_role)", () => {
  const c = { window: {} };
  vm.createContext(c);
  vm.runInContext(readFileSync(join(APP, "js/config.js"), "utf8"), c);
  const cfg = c.window.POWERBALL_CONFIG.liveDb;
  eq([cfg.enabled, [...cfg.origins]], [true, ["https://www.ferrarilabs.com"]], "liveDb");
  assert(/^sb_publishable_/.test(cfg.anonKey), "chave nao e a publishable");
});

await test("buscar: chama SO a RPC publica, com POST e a chave publica", async () => {
  let chamada;
  const fake = (url, opt) => { chamada = { url, opt }; return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }); };
  const v = await LIVE.buscar({ enabled: true, url: "https://x.supabase.co/", anonKey: "sb_publishable_k" }, fake);
  eq([...v], [], "resposta");
  eq(chamada.url, "https://x.supabase.co/rest/v1/rpc/lottery_public_open_draws", "url");
  eq(chamada.opt.method, "POST", "metodo");
  eq(chamada.opt.headers.apikey, "sb_publishable_k", "apikey");
});

await test("a migracao so le colunas publicas e nunca concede a PUBLIC", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/20261118140000_powerball_public_open_draws_rpc.sql"), "utf8");
  const corpo = sql.slice(sql.indexOf("as $$"), sql.lastIndexOf("$$;"));
  for (const proibido of ["email", "phone", "external_reference", "memo", "reason", "operator_client_ref", "proof_object_path", "provider"]) {
    assert(!new RegExp(`\\b${proibido}\\b`, "i").test(corpo), `corpo le \`${proibido}\``);
  }
  assert(/security definer/i.test(sql) && /set search_path = pg_catalog, pg_temp/.test(sql), "secdef sem search_path fixo");
  assert(/revoke all on function public\.lottery_public_open_draws\(\) from public;/.test(sql), "PUBLIC nao revogado");
  assert(!/grant[^;]*to[^;]*\bpublic\b/i.test(sql), "grant a PUBLIC");
  assert(!/\b(insert|update|delete)\b/i.test(corpo), "corpo muta dado");
});

await test("a tabela de participantes escapa o que pode vir do banco", () => {
  const app = readFileSync(join(APP, "js/app.js"), "utf8");
  for (const campo of ["esc(p.name)", "esc(p.state)", "esc(p.metodo)", "esc(p.data)", "esc(p.hora)"]) {
    assert(app.includes(campo), `renderTable sem ${campo}`);
  }
  const html = readFileSync(join(APP, "index.html"), "utf8");
  assert(/connect-src[^;]*https:\/\/cmhqkkfczotdnssupkni\.supabase\.co/.test(html), "CSP sem a origem do Supabase");
  const tag = (f) => html.indexOf(`<script src="js/${f}`);
  assert(tag("data.js") !== -1 && tag("live_participants.js") > tag("data.js") &&
         tag("live_participants.js") < tag("app.js"), "ordem dos scripts");
});

const TRAVA = await import("./check_datajs_matches_db.mjs");

await test("trava: data.js sincronizado passa", () => {
  eq(TRAVA.divergencias(sorteios(), [linha({})]), [], "problemas");
});

await test("trava: pagou no banco e falta no data.js reprova, com nome mascarado", () => {
  const p = TRAVA.divergencias(sorteios(), [linha({}), linha({ name: "Gustavo Bossle" })]);
  eq(p.length, 1, "problemas");
  assert(!p[0].includes("Gustavo Bossle") && p[0].includes("Gu…e (14)"), "nome nao mascarado: " + p[0]);
});

await test("trava: cotas ou valor diferentes reprovam; sorteio fechado e ignorado", () => {
  eq(TRAVA.divergencias(sorteios(), [linha({ valor: "20.00" })]).length, 1, "valor");
  eq(TRAVA.divergencias(sorteios(), [linha({ cotas: 2 })]).length, 1, "cotas");
  eq(TRAVA.divergencias(sorteios(), [linha({ draw_date: "2026-11-17", name: "Novo" })]), [], "fechado");
});

await test("trava --only-past-draws: antes do sorteio nao confere; depois confere", () => {
  const d = sorteios();
  d[1].drawing = { drawDateIso: "2026-11-20T23:00:00-05:00" };
  const novo = [linha({}), linha({ name: "Gustavo Bossle" })];
  eq(TRAVA.divergencias(d, novo, { agora: Date.parse("2026-11-20T12:00:00-05:00") }), [], "antes do sorteio");
  eq(TRAVA.divergencias(d, novo, { agora: Date.parse("2026-11-20T23:10:00-05:00") }).length, 1, "depois do sorteio");
  eq(TRAVA.divergencias(d, novo).length, 1, "bilhetes: confere sempre");
});

await test("trava --draw: so o sorteio dos bilhetes; outro sorteio atrasado nao trava", () => {
  const d = sorteios();
  d.push({ id: "2026-11-24", participants: [], finance: {}, result: null });
  const linhas = [linha({}), linha({ draw_date: "2026-11-24", name: "Proximo" })];
  eq(TRAVA.divergencias(d, linhas, { drawId: "2026-11-20" }), [], "bilhetes de 20/11");
  eq(TRAVA.divergencias(d, linhas, { drawId: "2026-11-24" }).length, 1, "bilhetes de 24/11");
  eq(TRAVA.divergencias(d, linhas, { drawId: "2026-11-27" }).length, 1, "sorteio ausente do data.js reprova");
});

await test("trava: nome repetido no banco exige as duas linhas no data.js", () => {
  const p = TRAVA.divergencias(sorteios(), [linha({}), linha({})]);
  eq(p.length, 1, "problemas");
  assert(p[0].includes("1 de 2"), p[0]);
});

await test("trava: resposta fora de forma reprova (nao consegui medir nao e ok)", () => {
  eq(TRAVA.divergencias(sorteios(), null).length, 1, "nao-lista");
  eq(TRAVA.divergencias(sorteios(), [{ name: 1 }]).length, 1, "linha ruim");
});

await test("trava: le o data.js REAL sem executar nada alem dele", () => {
  const draws = TRAVA.sorteiosDoDataJs(readFileSync(join(APP, "js/data.js"), "utf8"));
  assert(draws.length > 10 && draws.every((d) => typeof d.id === "string"), "data.js real nao carregou");
});

const { spawnSync } = await import("node:child_process");
const { writeFileSync, mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const SCRIPT = join(AQUI, "check_datajs_matches_db.mjs");
const tmp = mkdtempSync(join(tmpdir(), "pb-live-"));
const cli = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

await test("trava CLI: sem sorteio ja realizado, nao consulta o banco e passa", () => {
  const djs = join(tmp, "data.js");
  writeFileSync(djs, `window.POWERBALL_DRAWS = [{ id: "2099-01-01", drawing: { drawDateIso: "2099-01-01T23:00:00-05:00" }, participants: [], result: null }];`);
  const r = cli(["--only-past-draws", "--data-js", djs, "--from", join(tmp, "nao-existe.json")]);
  eq(r.status, 0, "exit: " + r.stdout);
  assert(r.stdout.includes("banco nao consultado"), r.stdout);
});

await test("trava CLI: banco ilegivel reprova; com --allow-unknown so avisa", () => {
  const djs = join(tmp, "data2.js");
  writeFileSync(djs, `window.POWERBALL_DRAWS = [{ id: "2020-01-01", drawing: { drawDateIso: "2020-01-01T23:00:00-05:00" }, participants: [], result: null }];`);
  const sem = join(tmp, "nao-existe.json");
  eq(cli(["--only-past-draws", "--data-js", djs, "--from", sem]).status, 1, "estrito");
  const r = cli(["--only-past-draws", "--allow-unknown", "--data-js", djs, "--from", sem]);
  eq(r.status, 0, "tolerante");
  assert(r.stdout.includes("::warning::"), r.stdout);
});

await test("trava CLI: divergencia medida reprova mesmo com --allow-unknown", () => {
  const djs = join(tmp, "data3.js");
  writeFileSync(djs, `window.POWERBALL_DRAWS = [{ id: "2020-01-01", drawing: { drawDateIso: "2020-01-01T23:00:00-05:00" }, participants: [], result: null }];`);
  const rows = join(tmp, "rows.json");
  writeFileSync(rows, JSON.stringify([{ draw_date: "2020-01-01", name: "Fulano", cotas: 1, valor: 10 }]));
  const r = cli(["--only-past-draws", "--allow-unknown", "--data-js", djs, "--from", rows]);
  eq(r.status, 1, "exit");
  assert(!r.stdout.includes("Fulano"), "nome sem mascara no log");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ LIVE PARTICIPANTS FAILED\n"); process.exit(1); }
