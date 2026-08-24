#!/usr/bin/env node
/**
 * CATRACAS DE SEGURANCA DO INTAKE (Issue #321).
 *
 * Estes casos nao testam comportamento — testam PROPRIEDADES DO CODIGO que nao podem regredir.
 * Cada um existe porque a alternativa e um erro plausivel que alguem cometeria de boa-fe: colocar
 * um segredo no bundle "so para testar", trocar o repo alvo, deixar o CORS em `*` numa depuracao,
 * logar o objeto de erro inteiro para investigar um bug.
 *
 * Uso: node scripts/report/test_report_security_ratchets.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR_FN = join(RAIZ, "support-intake/supabase/functions/user-report-intake");

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                          catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const fontesFn = readdirSync(DIR_FN).filter((f) => /\.(js|ts)$/.test(f));
const srcFn = Object.fromEntries(fontesFn.map((f) => [f, readFileSync(join(DIR_FN, f), "utf-8")]));
const todoFn = Object.values(srcFn).join("\n");

/**
 * Arquivos servidos ao navegador (o "bundle" deste projeto sem build).
 *
 * `supabase/` e `support-intake/` ficam de fora porque sao codigo de SERVIDOR: o alvo desta catraca
 * e "nenhum segredo no que o navegador executa", e a fonte de uma Edge Function nao e isso. O
 * Pages de fato entrega esses caminhos por HTTP (verificado: 200), mas o repositorio e publico,
 * entao servi-los nao revela nada que o `git clone` ja nao revele -- e o que esta la sao NOMES de
 * segredo, nunca valores, o que a catraca 7 cobre separadamente.
 */
function ativosDoNavegador() {
  return execSync("git ls-files '*.js' '*.html' '*.css'", { cwd: RAIZ, encoding: "utf-8" })
    .split("\n").filter(Boolean)
    .filter((p) => !p.startsWith("scripts/") && !p.startsWith("supabase/")
                && !p.startsWith("support-intake/")
                && !/\/scripts\//.test(p) && !/test|audit|check_/.test(p));
}

console.log("\nCatracas de seguranca do intake (#321)\n");

console.log("1. Nenhum segredo de reporte no que vai ao navegador:");
test("nenhum ativo servido menciona segredo do intake", () => {
  const PROIBIDOS = [
    "REPORT_GITHUB_PRIVATE_KEY", "REPORT_GITHUB_APP_ID", "REPORT_GITHUB_INSTALLATION_ID",
    "REPORT_REDIS_REST_TOKEN", "REPORT_REDIS_REST_URL", "REPORT_ABUSE_HMAC_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_DB_URL",
    "BEGIN RSA PRIVATE KEY", "BEGIN PRIVATE KEY",
  ];
  const culpados = [];
  for (const p of ativosDoNavegador()) {
    let s; try { s = readFileSync(join(RAIZ, p), "utf-8"); } catch { continue; }
    for (const t of PROIBIDOS) if (s.includes(t)) culpados.push(`${p} :: ${t}`);
  }
  ok(culpados.length === 0, `segredo referenciado em ativo servido:\n        ${culpados.join("\n        ")}`);
});

console.log("\n2. O endpoint nao alcanca banco, pagamento, scoring:");
test("nenhuma credencial ampla do Supabase e LIDA pela funcao", () => {
  // O alvo e a LEITURA, nao a mencao. `handler.js` NOMEIA essas credenciais de proposito, numa
  // lista de proibidas e num comentario que explica por que a fronteira aqui e de codigo (o
  // Supabase injeta os segredos do projeto em TODAS as funcoes). Proibir a palavra apagaria
  // justamente a documentacao do risco -- e um gate que obriga a esconder o problema e pior que
  // nenhum.
  const LEITURAS = [
    /Deno\.env\.get\(\s*["'`]SUPABASE_/,
    /env\.SUPABASE_[A-Z_]+/,
    /process\.env\.SUPABASE_/,
    /createClient\s*\(/,
    /postgres:\/\//,
  ];
  for (const re of LEITURAS) ok(!re.test(todoFn), `a funcao LE credencial/cliente amplo: ${re}`);
});

test("...e essa distincao morde de verdade (controle negativo)", () => {
  const LEITURA = /Deno\.env\.get\(\s*["'`]SUPABASE_/;
  ok(LEITURA.test('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'), "nao pegaria uma leitura real");
  ok(!LEITURA.test('const PROIBIDAS = ["SUPABASE_SERVICE_ROLE_KEY"]'), "acusaria a lista de proibidas");
});

test("nenhuma tabela financeira/participante e citada", () => {
  for (const t of ["lottery_payment_transactions", "lottery_participants", "lottery_participations",
                   "bolao_state", "cdb_entry_access", "bolao_cdb2026", "picks", "scoring"]) {
    ok(!todoFn.includes(t), `a funcao cita superficie financeira/participante: ${t}`);
  }
});

console.log("\n3. Alvo do reporte nao pode ser repositorio publico:");
test("existe verificacao de visibilidade PRIVADA no runtime", () => {
  ok(srcFn["github.js"].includes("TARGET_REPO_NOT_PRIVATE"), "falta o invariante de alvo privado");
  ok(/private\s*!==\s*true/.test(srcFn["github.js"]), "a checagem nao compara visibilidade de verdade");
});

test("o handler CHAMA a verificacao antes de criar o Issue", () => {
  const h = srcFn["handler.js"];
  const iVerif = h.indexOf("verificarDestinoPrivado");
  const iCriar = h.indexOf("criarIssuePrivado");
  ok(iVerif !== -1 && iCriar !== -1, "faltou uma das duas chamadas");
  ok(iVerif < iCriar, "a verificacao roda DEPOIS de criar — o dado ja teria vazado");
});

test("o repositorio publico nunca e ALVO de criacao de Issue", () => {
  // `ferrarilabs.github.io` aparece legitimamente como ORIGEM de CORS -- e o dominio do site.
  // O que nao pode existir e ele como REPOSITORIO de destino. Sao coisas diferentes no mesmo
  // texto, e confundi-las produziria um gate que obriga a remover a origem correta.
  const ALVO = [
    /repos\/[^"'`]*ferrarilabs\.github\.io/,
    /REPORT_GITHUB_REPO[^\n]*=[^\n]*ferrarilabs\.github\.io/,
    /repo:\s*["'`]ferrarilabs\.github\.io/,
  ];
  for (const re of ALVO) ok(!re.test(todoFn), `repo publico usado como alvo: ${re}`);
  // E a origem de CORS continua onde deve estar.
  ok(/ORIGENS_PERMITIDAS[\s\S]{0,200}ferrarilabs\.github\.io/.test(srcFn["handler.js"]),
     "a origem legitima do site sumiu da allowlist de CORS");
});

console.log("\n4. Cliente nao controla nada estrutural:");
test("titulo, labels e repo vem do servidor, nunca do corpo", () => {
  const h = srcFn["handler.js"];
  ok(/titulo:\s*montarTitulo\(/.test(h), "titulo deveria ser montado pelo servidor");
  ok(/labels:\s*\[/.test(h), "labels deveriam ser literais do servidor");
  // `\b` obrigatorio: sem ele, `repo` casa dentro de `corpo.reportId` e o gate acusa a si mesmo.
  ok(!/corpo\.(title|labels|repo|owner|installation)\b/.test(h), "campo estrutural lido do corpo");
  ok(/corpo\.reportId/.test(h), "premissa do teste: reportId E lido do corpo, e isso e correto");
});

test("CAMPOS_ACEITOS nao contem nada estrutural nem sensivel", () => {
  const lista = /export const CAMPOS_ACEITOS = \[([\s\S]*?)\];/.exec(srcFn["policy.js"])[1];
  for (const proibido of ["title", "labels", "repo", "owner", "installationId", "apiUrl",
                          "redisUrl", "email", "token", "ip", "userAgent", "stack"]) {
    ok(!new RegExp(`"${proibido}"`).test(lista), `campo estrutural/sensivel aceito: ${proibido}`);
  }
});

console.log("\n5. CORS nunca curinga; hosts de saida fixos:");
test("nao existe Allow-Origin: * na funcao", () => {
  ok(!/Allow-Origin"\s*:\s*"\*"/.test(todoFn), "curinga de CORS presente");
  ok(!todoFn.includes('"*"') || !/Access-Control-Allow-Origin[\s\S]{0,40}\*/.test(todoFn),
     "curinga de CORS presente");
});

test("todo host de saida e literal — nenhuma URL vem do payload", () => {
  const urls = todoFn.match(/https:\/\/[a-z0-9.-]+/gi) || [];
  const permitidos = ["https://api.github.com", "https://www.ferrarilabs.com",
                      "https://ferrarilabs.com", "https://ferrarilabs.github.io",
                      "https://placeholder.invalid", "https://redis.invalid"];
  for (const u of new Set(urls)) {
    ok(permitidos.some((p) => u.startsWith(p)), `host de saida inesperado: ${u}`);
  }
  // A URL do Redis vem de env do SERVIDOR, nunca do corpo — SSRF de manual seria deixar o cliente escolher.
  ok(!/fetch\(\s*(corpo|dados|body|payload)\./.test(todoFn), "destino de fetch derivado do payload");
});

console.log("\n6. Nada dinamico, nada executavel:");
test("sem eval, Function, exec, spawn, SQL", () => {
  for (const t of ["eval(", "new Function", "child_process", "execSync", "spawnSync",
                   "Deno.run", "Deno.Command", "SELECT ", "INSERT ", "DELETE FROM"]) {
    ok(!todoFn.includes(t), `construcao dinamica/perigosa na funcao: ${t}`);
  }
});

test("sem escrita em disco baseada em payload", () => {
  for (const t of ["writeFile", "Deno.writeFile", "createWriteStream"]) {
    ok(!todoFn.includes(t), `escrita em disco na funcao: ${t}`);
  }
});

console.log("\n7. Higiene de log:");
test("nada loga corpo, cabecalho cru, erro cru ou segredo", () => {
  const ruim = [
    /console\.log\(\s*(corpo|body|payload|dados|req)\b/,
    /console\.error\(\s*e\s*\)/,
    /console\.log\(\s*e\s*\)/,
    /console\.\w+\([^)]*headers\b/,
    /console\.\w+\([^)]*(token|chavePrivada|PRIVATE_KEY|HMAC)/i,
  ];
  for (const re of ruim) ok(!re.test(todoFn), `log inseguro: ${re}`);
});

test("o erro do GitHub vira CODIGO, nunca corpo de resposta", () => {
  ok(/GITHUB_AUTH_\$\{r\.status\}/.test(srcFn["github.js"]), "auth deveria virar codigo");
  ok(!/await r\.text\(\)/.test(srcFn["github.js"]), "corpo de resposta do GitHub sendo lido/propagado");
});

test("o HMAC de rede e o valor de rede nunca sao logados", () => {
  ok(!/console\.\w+\([^)]*chaveRede/.test(todoFn), "HMAC de rede em log");
  ok(!/console\.\w+\([^)]*valorDeRede/.test(todoFn), "valor de rede em log");
});

console.log("\n8. Diagnostico allowlisted e narrativa nunca automatica em publico:");
test("codigo de diagnostico fora da lista vira UNKNOWN_SAFE_ERROR", () => {
  ok(/UNKNOWN_SAFE_ERROR/.test(srcFn["policy.js"]), "faltou o fallback seguro");
  ok(/DIAGNOSTICOS\.includes/.test(srcFn["policy.js"]), "a allowlist nao e consultada");
});

test("nenhum codigo automatizado publica narrativa no repo publico", () => {
  const suspeitos = execSync("git ls-files 'scripts/**/*.mjs' '.github/workflows/*.yml'", { cwd: RAIZ, encoding: "utf-8" })
    .split("\n").filter(Boolean);
  for (const p of suspeitos) {
    let s; try { s = readFileSync(join(RAIZ, p), "utf-8"); } catch { continue; }
    if (!/support-intake/.test(s)) continue;
    ok(!/gh issue create[\s\S]{0,200}ferrarilabs\.github\.io/.test(s),
       `${p}: parece promover conteudo de intake para o repo publico`);
  }
});

console.log("\n9. Falha fechada:");
test("config incompleta => indisponivel, nunca modo degradado", () => {
  ok(/conferirConfig/.test(srcFn["handler.js"]), "faltou a checagem de config");
  ok(/503/.test(srcFn["handler.js"]), "deveria responder indisponivel");
});

test("limitador ausente => recusa", () => {
  ok(/RATE_STORE_UNAVAILABLE/.test(readFileSync(join(DIR_FN, "abuse.js"), "utf-8")),
     "faltou o caminho de falha fechada do limitador");
});

console.log("\n10. Sem dependencia nova:");
test("a funcao nao importa pacote de terceiro", () => {
  const imports = todoFn.match(/^import[\s\S]*?from\s+["']([^"']+)["']/gm) || [];
  for (const i of imports) {
    const alvo = /from\s+["']([^"']+)["']/.exec(i)[1];
    ok(alvo.startsWith("./") || alvo.startsWith("../") || alvo.startsWith("node:"),
       `dependencia externa no endpoint: ${alvo}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ CATRACAS DE SEGURANCA REPROVADAS\n"); process.exit(1); }
console.log("✓ CATRACAS DE SEGURANCA OK\n");
