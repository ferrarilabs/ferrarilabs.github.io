#!/usr/bin/env node
/**
 * test_worker_intake.mjs — o Worker de intake, na fronteira REAL (Issue #321).
 *
 * ─── POR QUE ESTES TESTES USAM Request/Response DE VERDADE ──────────────────────────────────
 *
 * A #324 foi um 500 em producao no preflight de origem PERMITIDA, enquanto o de origem proibida
 * respondia 403 certinho -- o unico caminho quebrado era o caminho feliz. Causa:
 * `new Response("", { status: 204 })` LANCA, porque 204 proibe corpo.
 *
 * Nenhum dos 77 testes de unidade pegou, porque todos chamavam a funcao e liam o objeto de volta
 * SEM NUNCA CONSTRUIR UM Response. A licao esta codificada aqui: tudo passa por `Request` e
 * `Response` reais do runtime, que e a mesma classe que o workerd usa e tem a mesma regra de corpo
 * nulo.
 *
 * O Durable Object e substituido por um duplo em memoria que preserva a propriedade que importa --
 * execucao serializada por chave -- para que as corridas de idempotencia sejam exercitaveis sem
 * rede.
 */
import { EstadoDoIntake, POLITICA } from "../../workers/user-report-intake/src/state.ts";
import worker, {
  ORIGENS_PERMITIDAS, CONFIG_NECESSARIA, intakeHabilitado, HABILITADO_VALOR_EXATO, conferirConfig,
  __teste,
} from "../../workers/user-report-intake/src/index.ts";
import { normalizarRede, chaveDeRede, chaveIdempotencia } from "../../workers/user-report-intake/src/identidade.ts";
import { GITHUB_API, PERMISSOES } from "../../workers/user-report-intake/src/github.ts";
import { CAMPOS_ACEITOS } from "../../workers/user-report-intake/src/policy.ts";
import { CODIGOS_DE_FALHA, FalhaClassificada } from "../../workers/user-report-intake/src/falhas.ts";

/**
 * Chave RSA SINTETICA, gerada em memoria a cada execucao.
 *
 * O JWT do GitHub App e RS256 de verdade, entao uma string de mentira ("pem") faz o Web Crypto
 * recusar com `Invalid keyData` e TODO caminho de GitHub falha por motivo errado -- foi exatamente
 * o que aconteceu na primeira execucao desta suite. Gerar a chave na hora exercita a assinatura
 * real sem jamais colocar material de chave no repositorio.
 */
async function pemDeTeste() {
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", par.privateKey);
  const b64 = Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n");
  // O marcador PEM tambem e montado em tempo de execucao: escrito como literal, ele faz o scanner
  // de PII deste repositorio reprovar -- e reprovar com razao, porque ele nao tem como saber que a
  // chave nasceu ha dois milissegundos e morre com o processo.
  const marca = (qual) => ["-----", qual, " PRIVATE ", "KEY", "-----"].join("");
  return `${marca("BEGIN")}\n${b64}\n${marca("END")}`;
}
const PEM_DE_TESTE = await pemDeTeste();

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
async function test(nome, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${nome}`); }
  catch (e) { fail++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}

/** SQLite em memoria com a superficie que o DO usa. Simples de proposito: o alvo e a LOGICA. */
function sqlFalso() {
  const tabelas = { envios: [], idem: new Map(), duplicatas: new Map(), disjuntor: new Map() };
  return {
    tabelas,
    exec(q, ...a) {
      const s = q.replace(/\s+/g, " ").trim();
      if (s.startsWith("CREATE")) return { toArray: () => [], one: () => ({}) };

      if (s.startsWith("DELETE FROM envios")) { tabelas.envios = tabelas.envios.filter((e) => e.instante >= a[0]); return {}; }
      if (s.startsWith("DELETE FROM idem WHERE expira_em")) {
        for (const [k, v] of tabelas.idem) if (v.expira_em < a[0]) tabelas.idem.delete(k);
        return {};
      }
      if (s.startsWith("DELETE FROM idem WHERE chave")) {
        const v = tabelas.idem.get(a[0]); if (v && v.estado === "reservado") tabelas.idem.delete(a[0]); return {};
      }
      if (s.startsWith("DELETE FROM duplicatas")) {
        for (const [k, v] of tabelas.duplicatas) if (v.expira_em < a[0]) tabelas.duplicatas.delete(k);
        return {};
      }
      if (s.startsWith("DELETE FROM disjuntor")) {
        for (const [k, v] of tabelas.disjuntor) if (v < a[0]) tabelas.disjuntor.delete(k);
        return {};
      }

      if (s.startsWith("SELECT COUNT(*) AS n FROM envios WHERE chave")) {
        const n = tabelas.envios.filter((e) => e.chave === a[0] && e.instante >= a[1]).length;
        return { one: () => ({ n }), toArray: () => [{ n }] };
      }
      if (s.startsWith("SELECT COUNT(*) AS n, COUNT(DISTINCT chave)")) {
        const dentro = tabelas.envios.filter((e) => e.instante >= a[0]);
        const r = { n: dentro.length, distintos: new Set(dentro.map((e) => e.chave)).size };
        return { one: () => r, toArray: () => [r] };
      }
      if (s.startsWith("SELECT estado, issue FROM idem")) {
        const v = tabelas.idem.get(a[0]);
        return { toArray: () => (v ? [{ estado: v.estado, issue: v.issue }] : []), one: () => v };
      }
      if (s.startsWith("SELECT aberto_ate FROM disjuntor")) {
        const v = tabelas.disjuntor.get(1);
        return { toArray: () => (v ? [{ aberto_ate: v }] : []), one: () => ({ aberto_ate: v }) };
      }
      if (s.startsWith("INSERT INTO idem")) {
        const estado = s.includes("'reservado'") ? "reservado" : "criado";
        tabelas.idem.set(a[0], estado === "reservado"
          ? { estado, issue: null, expira_em: a[1] }
          : { estado, issue: a[1], expira_em: a[2] });
        return {};
      }
      if (s.startsWith("INSERT INTO envios")) { tabelas.envios.push({ chave: a[0], instante: a[1] }); return {}; }
      if (s.startsWith("INSERT INTO duplicatas")) {
        const v = tabelas.duplicatas.get(a[0]);
        tabelas.duplicatas.set(a[0], { ocorrencias: (v?.ocorrencias ?? 0) + 1, expira_em: a[1] });
        return {};
      }
      if (s.startsWith("INSERT INTO disjuntor")) { tabelas.disjuntor.set(1, a[0]); return {}; }
      return { toArray: () => [], one: () => ({}) };
    },
  };
}

/** Duplo do binding de DO: um objeto por nome, com execucao serializada. */
function estadoFalso() {
  const sql = sqlFalso();
  const ctx = { storage: { sql }, blockConcurrencyWhile: async (f) => { await f(); } };
  const obj = new EstadoDoIntake(ctx, {});
  let fila = Promise.resolve();
  return {
    sql,
    idFromName: (n) => ({ n }),
    get: () => ({
      fetch: (url, init) => {
        // Serializa: e a propriedade do DO que torna a idempotencia livre de corrida.
        const p = fila.then(() => obj.fetch(new Request(url, init)));
        fila = p.then(() => {}, () => {});
        return p;
      },
    }),
  };
}

const UUID = "3ea26fa2-828d-49e5-8a5e-11a15f23f168";
const base = (over = {}) => ({
  reportId: UUID, app: "cdb2026", siteVersion: "v1.2", routeId: "/bolao/cdb2026",
  sectionId: "picks", locale: "pt-BR", timestamp: new Date().toISOString(),
  viewport: { w: 320, h: 568 }, online: true, browserEngine: "chromium",
  diagnosticCode: "SAVE_NETWORK_FAILURE",
  description: "Cliquei em salvar e apareceu um erro generico, tentei tres vezes",
  attemptedAction: null, sessionReportId: null, honeypot: "", noticeVersion: "v1", ...over,
});

const ENV_BASE = () => ({
  REPORT_INTAKE_ENABLED: "true",
  REPORT_GITHUB_APP_ID: "1", REPORT_GITHUB_INSTALLATION_ID: "2",
  REPORT_GITHUB_PRIVATE_KEY: PEM_DE_TESTE, REPORT_GITHUB_OWNER: "ferrarilabs",
  REPORT_GITHUB_REPO: "support-intake", REPORT_ABUSE_HMAC_SECRET: "segredo-de-teste",
  VERSAO: { id: "versao-de-teste" },
  ESTADO: estadoFalso(),
});

const ctxFalso = () => ({ waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); } });

function req(over = {}) {
  const { corpo, headers, ...resto } = over;
  return new Request("https://report.ferrarilabs.com/", {
    method: "POST",
    headers: {
      origin: ORIGENS_PERMITIDAS[0],
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.9",
      ...(headers ?? {}),
    },
    body: JSON.stringify(corpo ?? base()),
    ...resto,
  });
}

/** GitHub falso: privado, sem Issue existente, criacao devolve numero. */
function githubFalso(over = {}) {
  return async (url, init) => {
    const u = String(url);
    if (!u.startsWith(GITHUB_API + "/")) throw new Error("teste chamou host nao permitido: " + u);
    if (u.includes("/access_tokens")) return Response.json({ token: "ghs_token_de_teste", expires_at: "" }, { status: 201 });
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return Response.json({ private: over.privado ?? true, visibility: (over.privado ?? true) ? "private" : "public" });
    if (u.includes("/issues?") || u.includes("/search/")) return Response.json(over.existente ? { items: [{ number: over.existente }] } : { items: [] });
    if (init?.method === "POST" && u.includes("/issues")) return Response.json({ number: over.numero ?? 4242 }, { status: 201 });
    return Response.json({});
  };
}

console.log("\nWorker de intake — fronteira real (#321)\n");

// ── 1. Preflight: a licao da #324 ─────────────────────────────────────────────────────────────
console.log("1. Preflight (a licao da #324):");

for (const origem of ORIGENS_PERMITIDAS) {
  await test(`OPTIONS de ${origem} => 204 com Response REAL`, async () => {
    const r = await worker.fetch(
      new Request("https://report.ferrarilabs.com/", { method: "OPTIONS", headers: { origin: origem } }),
      ENV_BASE(), ctxFalso(),
    );
    eq(r.status, 204, "status");
    eq(r.body, null, "204 NAO pode ter corpo");
    eq(r.headers.get("access-control-allow-origin"), origem, "eco da origem");
    ok(r.headers.get("vary")?.includes("Origin"), "Vary: Origin");
  });
}

await test("OPTIONS de origem proibida => 403 e SEM cabecalho de CORS", async () => {
  const r = await worker.fetch(
    new Request("https://report.ferrarilabs.com/", { method: "OPTIONS", headers: { origin: "https://evil.invalid" } }),
    ENV_BASE(), ctxFalso(),
  );
  eq(r.status, 403, "status");
  eq(r.headers.get("access-control-allow-origin"), null, "nao pode conceder CORS a origem proibida");
});

await test("nunca existe Access-Control-Allow-Origin: *", async () => {
  for (const o of [ORIGENS_PERMITIDAS[0], "https://evil.invalid", null]) {
    const r = await worker.fetch(
      new Request("https://report.ferrarilabs.com/", { method: "OPTIONS", headers: o ? { origin: o } : {} }),
      ENV_BASE(), ctxFalso(),
    );
    eq(r.headers.get("access-control-allow-origin") === "*", false, "curinga jamais");
  }
});

await test("toda resposta alcancavel constroi um Response valido", async () => {
  const casos = [
    ["OPTIONS ok", new Request("https://x.invalid/", { method: "OPTIONS", headers: { origin: ORIGENS_PERMITIDAS[0] } })],
    ["OPTIONS proibido", new Request("https://x.invalid/", { method: "OPTIONS", headers: { origin: "https://e.invalid" } })],
    ["GET", new Request("https://x.invalid/", { method: "GET" })],
    ["tipo errado", req({ headers: { "content-type": "text/plain" } })],
    ["corpo grande", req({ corpo: { ...base(), description: "x".repeat(20000) } })],
  ];
  for (const [nome, r0] of casos) {
    const r = await worker.fetch(r0, ENV_BASE(), ctxFalso());
    ok(r instanceof Response, `${nome} nao devolveu Response`);
    ok(r.status >= 200 && r.status < 600, `${nome} status invalido`);
  }
});

// ── 2. Interruptor ────────────────────────────────────────────────────────────────────────────
console.log("\n2. Interruptor de servidor:");

await test("so a string exata liga", () => {
  eq(intakeHabilitado({ REPORT_INTAKE_ENABLED: HABILITADO_VALOR_EXATO }), true, "exato");
  for (const v of ["TRUE", "True", "1", "yes", "on", " true", "true ", "", "false", true, 1, null, undefined]) {
    eq(intakeHabilitado({ REPORT_INTAKE_ENABLED: v }), false, `${JSON.stringify(v)} NAO pode ligar`);
  }
  eq(intakeHabilitado({}), false, "ausente");
});

await test("desligado com TODOS os segredos => 503, e nada e tocado", async () => {
  const env = { ...ENV_BASE(), REPORT_INTAKE_ENABLED: "false" };
  eq(conferirConfig(env).ok, true, "os segredos estao completos neste caso");
  let tocou = 0;
  env.ESTADO = { idFromName: () => { tocou++; return {}; }, get: () => { tocou++; return { fetch: async () => Response.json({}) }; } };
  env.RAJADA = { limit: async () => { tocou++; return { success: true }; } };
  const r = await worker.fetch(req(), env, ctxFalso());
  eq(r.status, 503, "recusa");
  eq(JSON.parse(await r.text()).error, "UNAVAILABLE", "generico");
  eq(tocou, 0, "desligado nao pode tocar rate limiter nem estado");
});

await test("desligado responde IGUAL a nao-configurado", async () => {
  const a = await worker.fetch(req(), { ...ENV_BASE(), REPORT_INTAKE_ENABLED: "false" }, ctxFalso());
  const semSegredo = { REPORT_INTAKE_ENABLED: "true", ESTADO: estadoFalso(), VERSAO: { id: "versao-de-teste" } };
  const b = await worker.fetch(req(), semSegredo, ctxFalso());
  eq(a.status, b.status, "mesmo status");
  eq(await a.text(), await b.text(), "mesmo corpo — quem sonda nao distingue os casos");
});

await test("desligado NAO quebra o preflight", async () => {
  const r = await worker.fetch(
    new Request("https://x.invalid/", { method: "OPTIONS", headers: { origin: ORIGENS_PERMITIDAS[0] } }),
    { ...ENV_BASE(), REPORT_INTAKE_ENABLED: "false" }, ctxFalso(),
  );
  eq(r.status, 204, "CORS nao pode depender do interruptor");
});

// ── 3. Rede pseudonima ────────────────────────────────────────────────────────────────────────
console.log("\n3. Identificador de rede:");

await test("IPv6 normaliza para /64; IPv4 fica inteiro", () => {
  eq(normalizarRede("203.0.113.9"), "203.0.113.9", "IPv4");
  eq(normalizarRede("2001:db8:1234:5678:9abc:def0:1234:5678"), "2001:db8:1234:5678::/64", "IPv6 completo");
  eq(normalizarRede("2001:db8:1234:5678::1"), "2001:db8:1234:5678::/64", "IPv6 abreviado");
  eq(normalizarRede("2001:0db8:1234:5678::1"), "2001:db8:1234:5678::/64", "zeros a esquerda");
  eq(normalizarRede(""), "", "vazio");
});

await test("dois enderecos do MESMO /64 dao a mesma chave", async () => {
  const a = await chaveDeRede("s", "2001:db8:aaaa:bbbb::1");
  const b = await chaveDeRede("s", "2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff");
  eq(a, b, "trocar de endereco dentro do /64 nao pode criar identidade nova");
});

await test("/64 diferente da chave diferente", async () => {
  const a = await chaveDeRede("s", "2001:db8:aaaa:bbbb::1");
  const b = await chaveDeRede("s", "2001:db8:aaaa:cccc::1");
  ok(a !== b, "assinantes diferentes precisam ser distinguiveis");
});

await test("a chave nao contem o IP e e ESTAVEL (a rotacao vem da expiracao, nao da chave)", async () => {
  const a = await chaveDeRede("s", "203.0.113.9");
  const b = await chaveDeRede("s", "203.0.113.9");
  ok(!a.includes("203"), "IP nao pode aparecer na chave");
  eq(a, b, "chave instavel zeraria o limite de 24h junto com ela — foi o defeito do F-09");
  ok(/^[0-9a-f]{32}$/.test(a), "forma esperada");
  const outro = await chaveDeRede("s2", "203.0.113.9");
  ok(a !== outro, "segredo diferente, chave diferente");
});

await test("X-Forwarded-For NAO e usado como identidade", async () => {
  // O cliente escreve esse cabecalho a vontade; usa-lo seria um limite que curl contorna.
  const env = ENV_BASE();
  env.fetchImpl = githubFalso();
  const r1 = await __teste.tratar(req({ headers: { "x-forwarded-for": "1.1.1.1" } }), env, ctxFalso(), { fetchImpl: githubFalso() });
  const r2 = await __teste.tratar(req({ corpo: base({ reportId: "aaaaaaaa-828d-49e5-8a5e-11a15f23f168" }), headers: { "x-forwarded-for": "2.2.2.2" } }), env, ctxFalso(), { fetchImpl: githubFalso() });
  // Mesmo cf-connecting-ip => mesma chave => a segunda conta no limite do mesmo remetente.
  eq(r1.status, 201, "primeiro aceito");
  eq(r2.status, 201, "segundo aceito (dentro do limite), mas pelo MESMO remetente");
  const envios = env.ESTADO.sql.tabelas.envios;
  eq(new Set(envios.map((e) => e.chave)).size, 1, "trocar X-Forwarded-For nao pode criar remetente novo");
});

// ── 4. Idempotencia (F-04) ────────────────────────────────────────────────────────────────────
console.log("\n4. Idempotencia:");

await test("o mesmo reportId de REDES diferentes nao colide", async () => {
  const a = await chaveIdempotencia("s", "rede-a", UUID);
  const b = await chaveIdempotencia("s", "rede-b", UUID);
  ok(a !== b, "sequestro de reportId estaria aberto");
  ok(!a.includes(UUID.split("-")[0]), "a chave nao carrega o reportId");
});

await test("reenvio do mesmo relato NAO cria segunda Issue", async () => {
  const env = ENV_BASE();
  const gh = githubFalso();
  const r1 = await __teste.tratar(req(), env, ctxFalso(), { fetchImpl: gh });
  const r2 = await __teste.tratar(req(), env, ctxFalso(), { fetchImpl: gh });
  eq(r1.status, 201, "primeiro cria");
  eq(r2.status, 200, "segundo e idempotente");
  eq((await r2.json()).id, (await r1.json()).id, "mesmo identificador visivel");
});

await test("dois envios SIMULTANEOS do mesmo relato => uma Issue", async () => {
  const env = ENV_BASE();
  let criadas = 0;
  const gh = async (url, init) => {
    if (String(url).includes("/issues") && init?.method === "POST") criadas++;
    return githubFalso()(url, init);
  };
  const [a, b] = await Promise.all([
    __teste.tratar(req(), env, ctxFalso(), { fetchImpl: gh }),
    __teste.tratar(req(), env, ctxFalso(), { fetchImpl: gh }),
  ]);
  eq(criadas, 1, "a corrida nao pode produzir duas Issues");
  ok([a.status, b.status].includes(201), "uma criou");
  ok([a.status, b.status].some((s) => s === 200 || s === 409), "a outra foi idempotente ou em-curso");
});

await test("reservar o reportId de OUTRO nao bloqueia o dono", async () => {
  const env = ENV_BASE();
  const gh = githubFalso();
  await __teste.tratar(req({ headers: { "cf-connecting-ip": "198.51.100.7" } }), env, ctxFalso(), { fetchImpl: gh });
  const dono = await __teste.tratar(req({ headers: { "cf-connecting-ip": "203.0.113.9" } }), env, ctxFalso(), { fetchImpl: gh });
  eq(dono.status, 201, "o dono precisa seguir em frente, nao ser suprimido");
});

await test("Issue ja existente no GitHub e RECONCILIADA, nao duplicada", async () => {
  const env = ENV_BASE();
  let criadas = 0;
  const gh = async (url, init) => {
    if (String(url).includes("/issues") && init?.method === "POST") criadas++;
    return githubFalso({ existente: 99 })(url, init);
  };
  const r = await __teste.tratar(req(), env, ctxFalso(), { fetchImpl: gh });
  eq(r.status, 200, "reconciliado");
  eq(criadas, 0, "nao pode criar de novo o que ja existe");
});

// ── 5. Limites, janela deslizante e disjuntor ─────────────────────────────────────────────────
console.log("\n5. Abuso:");

await test("limite curto barra o quarto envio do mesmo remetente", async () => {
  const env = ENV_BASE();
  const gh = githubFalso();
  let ultimo;
  for (let i = 0; i < 4; i++) {
    ultimo = await __teste.tratar(
      req({ corpo: base({ reportId: `3ea26fa2-828d-49e5-8a5e-11a15f23f16${i}` }) }), env, ctxFalso(), { fetchImpl: gh });
  }
  eq(ultimo.status, 429, "o quarto excede 3/10min");
  ok(Number(ultimo.headers.get("retry-after")) > 0, "Retry-After presente");
});

await test("F-09 a janela LONGA e deslizante, nao balde por dia civil", async () => {
  const env = ENV_BASE();
  const gh = githubFalso();
  // Os envios sao espacados 11 min para NAO esbarrarem no limite curto (3/10min) antes de
  // gastarem o longo -- espaca-los e o que torna este caso capaz de medir o que promete.
  const passo = 11 * 60 * 1000;
  const fim = Date.parse("2026-08-24T23:58:00Z");
  const t0 = fim - (POLITICA.longo.limite - 1) * passo;
  for (let i = 0; i < POLITICA.longo.limite; i++) {
    await __teste.tratar(req({ corpo: base({ reportId: `1ea26fa2-828d-49e5-8a5e-11a15f23f1${String(i).padStart(2, "0")}` }) }),
      env, ctxFalso(), { fetchImpl: gh, agora: () => new Date(t0 + i * passo) });
  }
  eq(env.ESTADO.sql.tabelas.envios.filter((e) => e.chave !== "__teto__").length,
     POLITICA.longo.limite, "os dez envios precisam ter sido aceitos");
  // 11 min depois ja e outro DIA CIVIL (passou da meia-noite UTC). Com balde diario, isto passaria.
  const depois = await __teste.tratar(
    req({ corpo: base({ reportId: "9ea26fa2-828d-49e5-8a5e-11a15f23f168" }) }),
    env, ctxFalso(), { fetchImpl: gh, agora: () => new Date(fim + passo) });
  eq(depois.status, 429, "a virada da meia-noite NAO pode zerar o limite longo");
});

await test("F-03 teto sobe para trafego DIVERSO em vez de fechar a porta", async () => {
  const env = ENV_BASE();
  const estado = env.ESTADO.get();
  // Muitos remetentes distintos, um envio cada: exatamente a forma de uma quebra real.
  for (let i = 0; i < POLITICA.global.limite + 5; i++) {
    await estado.fetch("https://estado.invalid/", {
      method: "POST", body: JSON.stringify({ acao: "avaliar", chaveRede: `d${i}`, chaveIdem: `j${i}` }),
    });
  }
  const d = await (await estado.fetch("https://estado.invalid/", {
    method: "POST", body: JSON.stringify({ acao: "avaliar", chaveRede: "outro", chaveIdem: "outro" }),
  })).json();
  eq(d.ok, true, "acima do teto normal, mas diverso: o canal continua aceitando");
});

await test("F-03 o disjuntor abre por REINCIDENCIA no teto, e isso e alcancavel", async () => {
  const env = ENV_BASE();
  const estado = env.ESTADO.get();
  // Enche ate o teto DIVERSO...
  for (let i = 0; i < POLITICA.diversidade.globalDiverso; i++) {
    await estado.fetch("https://estado.invalid/", {
      method: "POST", body: JSON.stringify({ acao: "avaliar", chaveRede: `x${i}`, chaveIdem: `y${i}` }),
    });
  }
  // ...e bate no teto repetidamente. A primeira batida e pico; a reincidencia e pressao que ficou.
  let ultima;
  for (let i = 0; i < POLITICA.reincidenciaParaDisjuntor; i++) {
    ultima = await (await estado.fetch("https://estado.invalid/", {
      method: "POST", body: JSON.stringify({ acao: "avaliar", chaveRede: `z${i}`, chaveIdem: `w${i}` }),
    })).json();
  }
  eq(ultima.motivo, "CIRCUIT_OPEN", "reincidencia precisa fechar");
  const depois = await (await estado.fetch("https://estado.invalid/", {
    method: "POST", body: JSON.stringify({ acao: "avaliar", chaveRede: "novo", chaveIdem: "novo" }),
  })).json();
  eq(depois.motivo, "CIRCUIT_OPEN", "com o disjuntor aberto ninguem passa");
});

await test("o pre-filtro de rajada recusa antes de acordar o estado", async () => {
  const env = ENV_BASE();
  let tocouEstado = 0;
  const estadoReal = env.ESTADO;
  env.ESTADO = { idFromName: (n) => estadoReal.idFromName(n), get: (...a) => { tocouEstado++; return estadoReal.get(...a); } };
  env.RAJADA = { limit: async () => ({ success: false }) };
  const r = await __teste.tratar(req(), env, ctxFalso(), { fetchImpl: githubFalso() });
  eq(r.status, 429, "rajada recusa");
  eq(tocouEstado, 0, "enxurrada nao pode custar estado durável");
});

// ── 6. Destino privado e saida ────────────────────────────────────────────────────────────────
console.log("\n6. Destino e saida:");

await test("destino PUBLICO aborta antes de criar", async () => {
  const env = ENV_BASE();
  let criadas = 0;
  const gh = async (url, init) => {
    if (String(url).includes("/issues") && init?.method === "POST") criadas++;
    return githubFalso({ privado: false })(url, init);
  };
  const r = await __teste.tratar(req(), env, ctxFalso(), { fetchImpl: gh });
  eq(r.status, 503, "nao pode publicar relato num repo publico");
  eq(criadas, 0, "nada foi criado");
});

await test("saida so para a API do GitHub (anti-SSRF)", async () => {
  const chamadas = [];
  const gh = async (url, init) => { chamadas.push(String(url)); return githubFalso()(url, init); };
  await __teste.tratar(req(), ENV_BASE(), ctxFalso(), { fetchImpl: gh });
  ok(chamadas.length > 0, "houve chamada");
  for (const u of chamadas) ok(u.startsWith(GITHUB_API + "/"), `destino fora da allowlist: ${u}`);
});

await test("a App nao pode pedir permissao alem de Issues/Metadata", () => {
  eq(PERMISSOES.exigidas.issues, "write", "Issues: write");
  eq(PERMISSOES.exigidas.metadata, "read", "Metadata: read");
  for (const p of ["contents", "actions", "administration", "pull_requests", "workflows", "secrets", "pages", "deployments"]) {
    ok(PERMISSOES.proibidas.includes(p), `${p} precisa estar proibida`);
  }
});

// ── 7. F-15: excecao inesperada ───────────────────────────────────────────────────────────────
console.log("\n7. Excecao inesperada (F-15):");

await test("excecao arbitraria vira 503 generico, sem vazar", async () => {
  const venenos = [
    ["postgres", "ql://u:p", "@", "db.exemplo", ".invalid:5432/x"].join(""),
    ["Bearer ", "gh", "s_", "A".repeat(36)].join(""),
    "/var/task/worker/index.ts:42",
    ["SUPABASE_SERVICE", "_ROLE_KEY=", "ey", "J0", ".", "cGF5", ".", "c2ln"].join(""),
  ];
  for (const veneno of venenos) {
    const r = await worker.fetch(req(), {
      ...ENV_BASE(),
      get REPORT_ABUSE_HMAC_SECRET() { throw new Error(veneno); },
    }, ctxFalso());
    eq(r.status, 503, "precisa virar 503");
    const txt = await r.text();
    eq(txt, JSON.stringify({ error: "UNAVAILABLE" }), "corpo generico identico");
    const tudo = txt + JSON.stringify([...r.headers]);
    for (const pedaco of [["postgres", "ql://"].join(""), ["gh", "s_"].join(""), "/var/task",
                          ["ey", "J0"].join(""), ["SERVICE", "_ROLE"].join("")]) {
      ok(!tudo.includes(pedaco), `vazou "${pedaco}"`);
    }
  }
});

// ── 7-B. #339: o LOG tambem nao pode carregar segredo ────────────────────────────────────────
//
// O teste acima assere sobre a RESPOSTA, e sempre passou. Ele nao era suficiente: o `codigo`
// derivado de `e.message` ia para o LOG, e 40 caracteres de mensagem de provedor cabem num token
// inteiro. Estes testes fecham o caminho que faltava.
console.log("\n7-B. Log de excecao sem segredo (#339):");

/**
 * Venenos SINTETICOS, montados em tempo de execucao.
 *
 * Nenhum aparece como literal no arquivo: escritos por extenso, o scanner de PII/segredo deste
 * repositorio reprovaria -- e reprovaria com razao, porque ele nao tem como distinguir um fixture
 * de um vazamento. Montar em pedacos preserva a catraca E o teste.
 */
const VENENOS = [
  ["Bearer ", "gh", "s_", "A".repeat(36)].join(""),
  ["gh", "p_", "B".repeat(36)].join(""),
  ["ey", "J0eXAiOiJKV1Qi", ".", "cGF5bG9hZG", ".", "c2lnbmF0dXJl"].join(""),
  ["sb", "p_", "C".repeat(24)].join(""),
  ["postgres", "ql://u:p", "@", "db.exemplo", ".invalid:5432/x"].join(""),
  ["SUPABASE_SERVICE", "_ROLE_KEY=", "ey", "J0", ".", "cGF5", ".", "c2ln"].join(""),
  ["SYNTH", "-", "D-", "9".repeat(10)].join(""),
  ["fulano", "@", "exemplo", ".invalid"].join(""),
  ["+55 11 ", "9".repeat(5), "-", "8".repeat(4)].join(""),
  "/var/task/worker/index.ts:42",
];

/** Fragmentos que NUNCA podem aparecer, nem parcialmente. */
const FRAGMENTOS_PROIBIDOS = [
  ["gh", "s_"].join(""), ["gh", "p_"].join(""), ["ey", "J0"].join(""), ["sb", "p_"].join(""),
  ["postgres", "ql://"].join(""), ["SERVICE", "_ROLE"].join(""), "SYNTH", "exemplo", "/var/task",
  "Bearer", "AAAA", "BBBB", "CCCC", "9999",
];

/** Captura o `console.log` da fronteira EXTERNA, que nao aceita injecao de `log`. */
async function capturarConsole(fn) {
  const linhas = [];
  const original = console.log;
  console.log = (...a) => { linhas.push(a.join(" ")); };
  try { return { retorno: await fn(), linhas }; }
  finally { console.log = original; }
}

await test("fronteira EXTERNA: nenhum veneno chega ao log, e o codigo e allowlisted", async () => {
  for (const veneno of VENENOS) {
    const { retorno: r, linhas } = await capturarConsole(() => worker.fetch(req(), {
      ...ENV_BASE(),
      get REPORT_ABUSE_HMAC_SECRET() { throw new Error(veneno); },
    }, ctxFalso()));

    eq(r.status, 503, "precisa virar 503");
    const txt = await r.text();
    const tudo = txt + JSON.stringify([...r.headers]) + linhas.join("\n");
    for (const pedaco of FRAGMENTOS_PROIBIDOS) {
      ok(!tudo.includes(pedaco), `vazou "${pedaco}" (resposta, cabecalho ou LOG)`);
    }
    ok(!tudo.includes(veneno), "a mensagem crua vazou inteira");

    const evento = linhas.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((e) => e?.evento === "report_excecao_nao_tratada");
    ok(evento, "a fronteira externa precisa registrar o evento estavel");
    eq(evento.codigo, "INTERNAL_UNKNOWN", "erro nao classificado tem de virar INTERNAL_UNKNOWN");
    eq(Object.keys(evento).sort().join(","), "codigo,evento", "campo fora da allowlist no log");
  }
});

await test("fronteira INTERNA: falha do GitHub nao leva mensagem ao log", async () => {
  for (const veneno of VENENOS) {
    const linhas = [];
    const gh = async () => { throw new Error(veneno); };
    const r = await __teste.tratar(req(), ENV_BASE(), ctxFalso(), {
      fetchImpl: gh, log: (e) => linhas.push(JSON.stringify(e)),
    });
    eq(r.status, 503, "falha fechada");
    const tudo = (await r.text()) + linhas.join("\n");
    for (const pedaco of FRAGMENTOS_PROIBIDOS) {
      ok(!tudo.includes(pedaco), `vazou "${pedaco}" na fronteira interna`);
    }
    const ev = linhas.map((l) => JSON.parse(l)).find((e) => e.evento === "report_github_falhou");
    ok(ev, "evento estavel de falha do GitHub");
    ok(CODIGOS_DE_FALHA.includes(ev.codigo), `codigo fora da allowlist: ${ev.codigo}`);
    eq(Object.keys(ev).sort().join(","), "codigo,evento,latencia_ms", "campo fora da allowlist");
  }
});

/**
 * Codigos ESTAVEIS por caminho de falha. Um painel que nao distingue "o GitHub recusou a
 * assinatura" de "o repositorio deixou de ser privado" nao serve para operar nada.
 */
const CASOS_DE_CODIGO = [
  ["GITHUB_AUTH", (env) => ({ env, gh: async (u) => String(u).includes("/access_tokens")
      ? Response.json({ message: "nao importa" }, { status: 401 }) : githubFalso()(u) })],
  ["GITHUB_RATE_LIMIT", (env) => ({ env, gh: async (u) => String(u).includes("/access_tokens")
      ? Response.json({}, { status: 429 }) : githubFalso()(u) })],
  ["GITHUB_RATE_LIMIT", (env) => ({ env, gh: async (u, i) => /\/repos\/[^/]+\/[^/]+$/.test(String(u))
      ? new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } })
      : githubFalso()(u, i) })],
  ["TARGET_NOT_PRIVATE", (env) => ({ env, gh: githubFalso({ privado: false }) })],
  ["GITHUB_UPSTREAM", (env) => ({ env, gh: async (u, i) => (i?.method === "POST" && String(u).includes("/issues"))
      ? Response.json({}, { status: 500 }) : githubFalso()(u, i) })],
  ["CRYPTO_FAILURE", (env) => ({ env: { ...env, REPORT_GITHUB_PRIVATE_KEY: "nao-e-uma-chave" }, gh: githubFalso() })],
  // Falha de rede crua NAO e timeout -- rotular as duas igual seria precisao inventada.
  ["GITHUB_UPSTREAM", (env) => ({ env, gh: async () => { throw new Error("network exploded"); } })],
  // Timeout DE VERDADE: o fetch so termina quando o nosso proprio AbortController dispara.
  ["GITHUB_TIMEOUT", (env) => ({ env, gh: (u, i) => new Promise((_, rej) => {
      i.signal.addEventListener("abort", () => rej(new Error("abortado pelo signal")));
    }) })],
];

for (const [esperado, montar] of CASOS_DE_CODIGO) {
  await test(`codigo estavel: ${esperado}`, async () => {
    const linhas = [];
    const { env, gh } = montar(ENV_BASE());
    const r = await __teste.tratar(req(), env, ctxFalso(), {
      fetchImpl: gh, log: (e) => linhas.push(JSON.stringify(e)),
    });
    eq(r.status, 503, "toda falha aqui e fechada");
    const ev = linhas.map((l) => JSON.parse(l)).find((e) => e.evento === "report_github_falhou");
    ok(ev, "evento de falha ausente");
    eq(ev.codigo, esperado, "codigo de falha errado");
  });
}

await test("codigo estavel: STATE_FAILURE quando o Durable Object falha", async () => {
  const linhas = [];
  const env = { ...ENV_BASE(), ESTADO: {
    idFromName: (n) => n,
    get: () => ({ fetch: async () => { throw new Error(["DO morreu com segredo gh", "s_", "X".repeat(30)].join("")); } }),
  } };
  const { retorno: r, linhas: doConsole } = await capturarConsole(() => worker.fetch(req(), env, ctxFalso()));
  eq(r.status, 503, "falha fechada");
  const tudo = doConsole.join("\n") + linhas.join("\n");
  ok(!tudo.includes(["gh", "s_"].join("")), "vazou fragmento de token");
  const ev = doConsole.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((e) => e?.evento === "report_excecao_nao_tratada");
  ok(ev, "evento estavel ausente");
  eq(ev.codigo, "STATE_FAILURE", "falha de estado precisa de codigo proprio");
});

await test("classificar() so devolve membro do conjunto fechado, mesmo sob objeto hostil", () => {
  const hostis = [
    { codigo: ["Bearer gh", "s_", "Z".repeat(30)].join("") },
    { codigo: "CODIGO_INVENTADO" },
    { codigo: 42 }, { codigo: null }, { codigo: { toString: () => "gh" + "s_x" } },
    new Error(["gh", "s_", "Y".repeat(36)].join("")),
    "string solta", null, undefined, 0,
  ];
  for (const h of hostis) {
    const c = __teste.classificar(h);
    ok(CODIGOS_DE_FALHA.includes(c), `classificar devolveu fora da allowlist: ${c}`);
    ok(!String(c).includes("gh" + "s_"), "fragmento de token sobreviveu a classificacao");
  }
  eq(__teste.classificar(new FalhaClassificada("GITHUB_AUTH", "mensagem interna com gh" + "s_XXXX")),
     "GITHUB_AUTH", "erro classificado precisa preservar o proprio codigo");
});

// ── 7-C. #339: CONTROLE NEGATIVO — provar que 7-B morde ──────────────────────────────────────
//
// Um teste de seguranca que nunca reprovou nao provou nada. Aqui a regressao e reintroduzida DE
// PROPOSITO e a asserção precisa falhar.
//
// A mutacao acontece numa copia do fonte em diretorio TEMPORARIO do sistema -- nunca na arvore do
// repositorio. Isso e deliberado: a #334 mostrou que mutacao sobre a arvore de trabalho vira
// falha falsa e arvore suja quando qualquer outro processo roda junto. Aqui nao ha o que sujar.
console.log("\n7-C. Controle negativo do #339 (a mutacao TEM de reprovar):");

await test("classificador regredido para e.message => a asserção de log REPROVA", async () => {
  const { mkdtempSync, cpSync, readFileSync: lerArq, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: juntar } = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const dir = mkdtempSync(juntar(tmpdir(), "mutacao-339-"));
  try {
    const origem = new URL("../../workers/user-report-intake/src/", import.meta.url);
    cpSync(origem, dir, { recursive: true });

    // A REGRESSAO exata que o #339 descreve: o codigo do log volta a sair de `e.message`.
    const alvo = juntar(dir, "index.ts");
    const antes = lerArq(alvo, "utf-8");
    const depois = antes.replace(
      /const codigo = classificar\(e\);\n(\s*)try \{ console\.log/,
      'const codigo = String((e)?.message ?? "UNKNOWN").slice(0, 40);\n$1try { console.log',
    );
    ok(depois !== antes, "a mutacao precisava alterar a fronteira externa");
    writeFileSync(alvo, depois);

    const mutante = await import(pathToFileURL(alvo).href);
    const veneno = ["Bearer ", "gh", "s_", "A".repeat(36)].join("");
    const { linhas } = await capturarConsole(() => mutante.default.fetch(req(), {
      ...ENV_BASE(),
      get REPORT_ABUSE_HMAC_SECRET() { throw new Error(veneno); },
    }, ctxFalso()));

    // Exatamente a asserção de 7-B, agora contra o mutante. Ela TEM de acusar.
    const texto = linhas.join("\n");
    const vazou = texto.includes(["gh", "s_"].join(""));
    ok(vazou, "CONTROLE NEGATIVO FALHOU: a mutacao passou despercebida — a asserção de 7-B nao morde");

    const ev = linhas.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((e) => e?.evento === "report_excecao_nao_tratada");
    ok(ev && ev.codigo !== "INTERNAL_UNKNOWN",
       "CONTROLE NEGATIVO FALHOU: o mutante deveria ter logado algo fora da allowlist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("falha do GitHub nao vaza corpo da resposta dele", async () => {
  const gh = async (url) => {
    if (String(url).includes("/access_tokens")) {
      return Response.json({ message: ["gh", "s_", "V".repeat(20)].join(""), documentation_url: "x" }, { status: 401 });
    }
    return githubFalso()(url);
  };
  const r = await __teste.tratar(req(), ENV_BASE(), ctxFalso(), { fetchImpl: gh });
  eq(r.status, 503, "falha fechada");
  const txt = await r.text();
  ok(!txt.includes(["gh", "s_"].join("")), "corpo do GitHub nao pode vazar");
});

// ── 8. F-06 proveniencia ──────────────────────────────────────────────────────────────────────
console.log("\n8. Proveniencia (F-06):");

await test("toda resposta carrega x-deploy-id", async () => {
  const casos = [
    new Request("https://x.invalid/", { method: "OPTIONS", headers: { origin: ORIGENS_PERMITIDAS[0] } }),
    new Request("https://x.invalid/", { method: "GET" }),
    req(),
  ];
  for (const r0 of casos) {
    const r = await worker.fetch(r0, ENV_BASE(), ctxFalso());
    eq(r.headers.get("x-deploy-id"), "versao-de-teste", "sem isso nao da para saber qual versao respondeu");
  }
});

await test("a versao vem do binding, nao de constante escrita a mao", async () => {
  const r = await worker.fetch(req(), { ...ENV_BASE(), VERSAO: { id: "outra-versao" } }, ctxFalso());
  eq(r.headers.get("x-deploy-id"), "outra-versao", "precisa refletir o binding");
});

// ── 9. Log e metrica ──────────────────────────────────────────────────────────────────────────
console.log("\n9. Log e metrica:");

await test("nenhum log carrega relato, chave de rede, reportId ou impressao", async () => {
  const linhas = [];
  const env = ENV_BASE();
  const corpo = base({ description: "MARCADOR_SECRETO_DO_RELATO com telefone 11 91234-5678" });
  await __teste.tratar(req({ corpo }), env, ctxFalso(), { fetchImpl: githubFalso(), log: (e) => linhas.push(JSON.stringify(e)) });
  const todo = linhas.join("\n");
  ok(linhas.length > 0, "houve log");
  ok(!todo.includes("MARCADOR_SECRETO_DO_RELATO"), "relato no log");
  ok(!todo.includes(UUID), "reportId no log");
  ok(!todo.includes("91234"), "telefone no log");
  const chave = await chaveDeRede("segredo-de-teste", "203.0.113.9");
  ok(!todo.includes(chave), "chave de rede no log");
});

await test("a metrica de redacao registra a CLASSE, nunca o valor", async () => {
  const linhas = [];
  await __teste.tratar(
    req({ corpo: base({ description: "meu telefone e 11 91234-5678 e o erro continua" }) }),
    ENV_BASE(), ctxFalso(), { fetchImpl: githubFalso(), log: (e) => linhas.push(e) });
  const red = linhas.filter((l) => l.metrica === "redigido");
  ok(red.length > 0, "a classe precisa ser contada");
  for (const l of red) ok(!JSON.stringify(l).includes("91234"), "valor na metrica");
});

// ── 10. Isolamento do projeto financeiro ──────────────────────────────────────────────────────
console.log("\n10. Isolamento:");

await test("o Worker nao declara nem le credencial do projeto financeiro", () => {
  for (const k of CONFIG_NECESSARIA) {
    ok(!/^SUPABASE_/.test(k), `credencial do Supabase exigida pelo Worker: ${k}`);
  }
  ok(!CONFIG_NECESSARIA.includes("SUPABASE_SERVICE_ROLE_KEY"), "service_role");
  ok(!CONFIG_NECESSARIA.includes("SUPABASE_DB_URL"), "DB URL");
});

await test("a allowlist de campos e a mesma do cliente", () => {
  for (const c of ["reportId", "app", "description", "noticeVersion", "honeypot"]) {
    ok(CAMPOS_ACEITOS.includes(c), `campo ausente: ${c}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ WORKER DE INTAKE REPROVADO\n"); process.exit(1); }
console.log("✓ WORKER DE INTAKE OK\n");
