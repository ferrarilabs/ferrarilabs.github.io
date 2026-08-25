#!/usr/bin/env node
/**
 * test_worker_isolation.mjs — catracas do Worker de intake (Issue #321).
 *
 * ─── O QUE ESTE ARQUIVO PROTEGE ─────────────────────────────────────────────────────────────
 *
 * A migracao para Cloudflare so vale enquanto a propriedade que a motivou continuar verdadeira: a
 * CREDENCIAL FINANCEIRA NAO EXISTE NESTE RUNTIME. Isso nao e uma frase de documento -- e uma
 * consequencia da lista de bindings, e por isso a lista de bindings e testada.
 *
 * A diferenca entre isto e a catraca antiga (que so proibia REFERENCIAR `service_role` no codigo)
 * e a diferenca entre "nosso codigo nao usa a chave" e "a chave nao esta la".
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(RAIZ, "workers", "user-report-intake");
const SRC = join(DIR, "src");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
function test(nome, fn) {
  try { fn(); pass++; console.log(`  ✓ ${nome}`); }
  catch (e) { fail++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}

/** JSONC -> JSON: o config e comentado de proposito, porque as razoes moram junto das escolhas. */
function lerConfig() {
  const bruto = readFileSync(join(DIR, "wrangler.jsonc"), "utf-8");
  const semComentarios = bruto
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(semComentarios);
}

const cfg = lerConfig();
const fontes = readdirSync(SRC).filter((f) => /\.ts$/.test(f));
const todoFonte = fontes.map((f) => readFileSync(join(SRC, f), "utf-8")).join("\n");

/**
 * CODIGO, sem prosa.
 *
 * Escrevi tres versoes desta suite confundindo MENCAO com USO -- a catraca reprovava porque o
 * comentario EXPLICA por que `passThroughOnException` nao e usado, e porque o cabecalho documenta a
 * migracao do Supabase. Um gate que obriga a apagar a explicacao do risco e pior que gate nenhum.
 * Entao a regra passa a ser: toda checagem de "isto nao pode existir no codigo" mede ESTE texto.
 */
const CODIGO = todoFonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("\nCatracas do Worker de intake (#321)\n");

console.log("1. A credencial financeira NAO EXISTE neste runtime:");

test("nenhum binding de banco de dados de qualquer tipo", () => {
  for (const b of ["d1_databases", "hyperdrive", "vectorize", "r2_buckets", "queues", "services",
                   "mtls_certificates", "dispatch_namespaces", "vpc_services", "browser", "ai"]) {
    ok(!(b in cfg), `binding proibido declarado: ${b} — isto reabriria o raio de alcance`);
  }
});

test("os bindings declarados sao EXATAMENTE os quatro esperados", () => {
  const declarados = ["durable_objects", "ratelimits", "version_metadata"].filter((b) => b in cfg);
  eq(declarados.sort().join(","), "durable_objects,ratelimits,version_metadata", "conjunto de bindings");
  eq(cfg.durable_objects.bindings.length, 1, "um unico Durable Object");
  eq(cfg.durable_objects.bindings[0].name, "ESTADO", "nome do binding de estado");
});

test("nenhum segredo do Supabase e exigido, lido ou mencionado como uso", () => {
  const exigidos = cfg.secrets?.required ?? [];
  for (const s of exigidos) ok(!/^SUPABASE_/.test(s), `segredo do Supabase exigido: ${s}`);
  for (const p of [/env\.SUPABASE_[A-Z_]+/, /process\.env\.SUPABASE_/, /Deno\.env\.get/]) {
    ok(!p.test(CODIGO), `leitura de credencial do Supabase: ${p}`);
  }
});

test("nenhuma referencia ao projeto financeiro como dependencia de runtime", () => {
  ok(!/cmhqkkfczotdnssupkni/.test(CODIGO), "ref do projeto financeiro em codigo executavel");
  ok(!/supabase\.co/.test(CODIGO), "host do Supabase em codigo executavel");
});

console.log("\n2. Saida so para o GitHub:");

test("nenhum host de saida alem da API do GitHub", () => {
  // As origens de CORS sao allowlist de ENTRADA, nao destino de saida -- e sao verificadas pelo
  // seu proprio caso. Remove-las daqui evita que este check as confunda com um alvo de fetch.
  const semOrigens = CODIGO.replace(/ORIGENS_PERMITIDAS[\s\S]*?\]\);/, "");
  const urls = [...semOrigens.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0].toLowerCase());
  const permitidos = ["https://api.github.com", "https://estado.invalid", "https://placeholder.invalid"];
  for (const u of urls) {
    ok(permitidos.some((p) => u.startsWith(p)), `host de saida nao permitido: ${u}`);
  }
});

test("existe guarda de host, e ela lanca", () => {
  ok(/function exigirHostPermitido/.test(todoFonte), "guarda ausente");
  ok(/DESTINO_NAO_PERMITIDO/.test(todoFonte), "a guarda precisa lancar");
});

console.log("\n3. Interruptor e ativacao em duas chaves:");

test("o interruptor esta versionado como DESLIGADO", () => {
  eq(cfg.vars.REPORT_INTAKE_ENABLED, "false", "o valor no repositorio precisa ser o seguro");
});

test("o interruptor NAO e um segredo (precisa ser auditavel)", () => {
  const exigidos = cfg.secrets?.required ?? [];
  ok(!exigidos.includes("REPORT_INTAKE_ENABLED"),
     "como segredo, ninguem consegue revisar o estado do interruptor no repositorio");
});

test("os segredos sao declarados por NOME e nenhum valor aparece no config", () => {
  const exigidos = cfg.secrets?.required ?? [];
  ok(exigidos.length >= 4, "os segredos precisam estar declarados por nome");
  const bruto = readFileSync(join(DIR, "wrangler.jsonc"), "utf-8");
  for (const p of [/BEGIN [A-Z ]*PRIVATE KEY/, /eyJ[A-Za-z0-9_-]{8,}\./, /\bgh[pousr]_[A-Za-z0-9]{16,}/,
                   /postgres(?:ql)?:\/\//]) {
    ok(!p.test(bruto), `valor de credencial no config: ${p}`);
  }
  // `vars` so pode conter configuracao nao secreta.
  for (const [k, v] of Object.entries(cfg.vars ?? {})) {
    ok(String(v).length < 64, `var suspeita de carregar segredo: ${k}`);
  }
});

console.log("\n4. Boas praticas de Worker:");

test("compatibility_date definida e nodejs_compat ligado", () => {
  ok(/^\d{4}-\d{2}-\d{2}$/.test(cfg.compatibility_date), "compatibility_date ausente ou malformada");
  ok((cfg.compatibility_flags ?? []).includes("nodejs_compat"), "nodejs_compat");
});

test("observabilidade ligada com captura completa", () => {
  eq(cfg.observability?.enabled, true, "observability");
  eq(cfg.observability?.logs?.head_sampling_rate, 1, "amostragem");
});

/**
 * ─── ESTE TESTE MUDOU DE ASSERCAO EM 2026-08-25, E POR QUE ─────────────────────────────────
 *
 * Ele exigia `workers_dev === false`, codificando o desenho original: endereco de primeira parte
 * (`report.ferrarilabs.com`). Esse endereco exige uma ZONA DNS na Cloudflare, e a conta tem
 * `zones = 0` -- entao a unica forma de satisfazer a assercao era mover o DNS de `ferrarilabs.com`
 * inteiro, arrastando site, GitHub Pages e e-mail para uma migracao alheia a este canal.
 *
 * O dono decidiu explicitamente pelo `workers.dev` como endereco inicial (ADR-021, "Endereco
 * publico"). A assercao antiga passou a proibir a decisao vigente.
 *
 * O gate NAO foi esvaziado -- seria exatamente o caminho proibido pelo contrato de seguranca. Ele
 * foi RE-APONTADO para o invariante que de fato protege, e que e mais forte que o anterior:
 *
 *   um endereco publico so e aceitavel enquanto o interruptor estiver VERSIONADO como desligado.
 *
 * Sem `workers.dev`, "o Worker esta inalcancavel" vinha de graca pela ausencia de rota. Com
 * `workers.dev`, ele passa a depender inteiramente do interruptor -- entao o interruptor vira uma
 * condicao verificada, e nao mais uma preferencia. Um patch futuro que ligue o canal versionando
 * `REPORT_INTAKE_ENABLED: "true"` com endereco publico aberto reprova AQUI.
 */
test("endereco publico exige interruptor versionado DESLIGADO", () => {
  const publico = cfg.workers_dev === true;
  if (publico) {
    eq(cfg.vars?.REPORT_INTAKE_ENABLED, "false",
       "endereco publico com interruptor versionado LIGADO");
  }
  // `preview_urls` continua proibida em qualquer cenario: ela cria enderecos alternativos, nao
  // versionados e fora da CSP, para o MESMO codigo. Um unico endereco auditavel e o objetivo, e
  // isso nao mudou com a decisao de endereco.
  eq(cfg.preview_urls, false, "preview_urls");
});

test("a CSP dos apps nomeia a origem EXATA do Worker, sem curinga", () => {
  // Nasceu junto com a decisao de `workers.dev`, e existe por causa dela: `*.workers.dev` e um
  // dominio COMPARTILHADO por todas as contas Cloudflare do mundo. Um curinga na CSP autorizaria
  // o Worker de qualquer estranho a receber POST das nossas paginas -- o oposto do que a
  // allowlist de origens do proprio Worker garante na outra direcao.
  const APPS = ["bolao/br2026/index.html", "bolao/cdb2026/index.html",
                "bolao/loterias/powerball/index.html"];
  for (const p of APPS) {
    const csp = (readFileSync(join(RAIZ, p), "utf-8").match(/connect-src([^;]*);/) || [])[1] || "";
    ok(!/\*\.workers\.dev/.test(csp), `${p}: curinga em workers.dev`);
    if (cfg.workers_dev === true) {
      ok(/https:\/\/ferrarilabs-support-intake\.[a-z0-9-]+\.workers\.dev/.test(csp),
         `${p}: CSP nao nomeia a origem do Worker`);
    }
  }
});

test("nenhum passThroughOnException e nenhum Math.random em caminho de seguranca", () => {
  ok(!/passThroughOnException/.test(CODIGO), "passThroughOnException esconde defeito");
  ok(!/Math\.random/.test(CODIGO), "Math.random nao e seguro para valor de seguranca");
});

test("a fronteira externa de excecao existe", () => {
  const idx = readFileSync(join(SRC, "index.ts"), "utf-8");
  ok(/export default \{[\s\S]*?try \{[\s\S]*?catch/.test(idx), "o fetch exportado precisa de catch total");
  ok(/report_excecao_nao_tratada/.test(idx), "evento estavel para excecao inesperada");
});

test("o objeto de erro NUNCA e serializado inteiro", () => {
  ok(!/JSON\.stringify\(\s*(e|err|error)\s*\)/.test(CODIGO), "serializar o Error vaza o que ele carrega");
  ok(!/console\.(log|error)\(\s*(e|err|error)\s*\)/.test(CODIGO), "log do erro cru");
  // O que PODE sair e sempre um codigo curto e sanitizado.
  ok(/\.slice\(0, 40\)/.test(CODIGO), "o codigo de erro precisa ser truncado");
});

console.log("\n5. Migracao: o primario para de ser o alvo:");

test("o Worker NAO mora sob supabase/", () => {
  ok(existsSync(join(RAIZ, "workers", "user-report-intake", "src", "index.ts")),
     "o Worker precisa morar em workers/ — o layout comunica a fronteira");
  const sobSupabase = execSync("git ls-files supabase/", { cwd: RAIZ, encoding: "utf-8" })
    .split("\n").filter((p) => p.includes("user-report-intake"));
  eq(sobSupabase.length, 0, `intake sob supabase/: ${sobSupabase.join(", ")}`);
});

test("supabase/functions/ so tem as funcoes do projeto financeiro", () => {
  const dirs = readdirSync(join(RAIZ, "supabase", "functions"), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  eq(dirs.join(","), "_shared,live-football", "allowlist do projeto financeiro");
});

test("o config do primario nao declara o intake", () => {
  const t = readFileSync(join(RAIZ, "supabase", "config.toml"), "utf-8");
  ok(!/^\s*\[functions\.user-report-intake\]/m.test(t), "o manifesto do primario voltou a declarar o intake");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ CATRACAS DO WORKER REPROVADAS\n"); process.exit(1); }
console.log("✓ CATRACAS DO WORKER OK\n");
