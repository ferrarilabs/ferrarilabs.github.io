#!/usr/bin/env node
/**
 * test_report_isolation.mjs — o intake NAO pode voltar a compartilhar runtime com o dinheiro.
 *
 * ─── A AMEACA (T-ENV-01) ────────────────────────────────────────────────────────────────────
 *
 * O Supabase injeta capacidades de projeto em TODA Edge Function hospedada: `SUPABASE_DB_URL`,
 * `SUPABASE_SECRET_KEYS` e o legado `SUPABASE_SERVICE_ROLE_KEY` -- este ultimo IGNORA RLS.
 *
 * Enquanto o intake publico e nao autenticado rodasse no mesmo projeto dos dados de participante,
 * pagamento, scoring e ranking, dizer "um comprometimento do intake nao alcanca participante" seria
 * uma afirmacao sobre o NOSSO codigo, nao sobre a plataforma -- e o nosso codigo nao e a unica coisa
 * que executa ali. Dependencia comprometida, defeito de injecao futuro e cadeia de suprimentos leem
 * a variavel de ambiente sem passar por catraca nenhuma.
 *
 * ─── O QUE ESTE ARQUIVO GARANTE ─────────────────────────────────────────────────────────────
 *
 * Que o roteamento de projeto seja DETERMINISTICO e testavel, em vez de depender de alguem lembrar.
 * O deploy deste repositorio e automatico no merge para `main`: mover a funcao de diretorio nao e
 * cosmetico, e o que decide em QUAL projeto ela aterrissa.
 *
 * O que este arquivo NAO consegue garantir esta dito no fim, em vez de fingido.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
function test(nome, fn) {
  try { fn(); pass++; console.log(`  ✓ ${nome}`); }
  catch (e) { fail++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}

const FN_PRIMARIO = join(RAIZ, "supabase", "functions");
const CFG_PRIMARIO = join(RAIZ, "supabase", "config.toml");
const CFG_SUPORTE = join(RAIZ, "support-intake", "supabase", "config.toml");
const FN_SUPORTE = join(RAIZ, "support-intake", "supabase", "functions");

/**
 * Funcoes que PODEM viver no projeto financeiro. Allowlist, nao denylist: uma funcao nova nasce
 * reprovando ate alguem decidir conscientemente que ela pertence ao projeto que guarda o dinheiro.
 */
const PERMITIDAS_NO_PRIMARIO = ["_shared", "live-football"];

console.log("\nIsolamento de runtime do intake (#321, T-ENV-01)\n");

console.log("1. O projeto financeiro nao hospeda o intake:");

test("supabase/functions/ nao contem user-report-intake", () => {
  const dirs = readdirSync(FN_PRIMARIO, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  ok(!dirs.includes("user-report-intake"),
     "user-report-intake voltou para o projeto que guarda participante, pagamento e scoring");
});

test("supabase/functions/ so contem funcoes explicitamente permitidas", () => {
  const dirs = readdirSync(FN_PRIMARIO, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const intrusas = dirs.filter((d) => !PERMITIDAS_NO_PRIMARIO.includes(d));
  eq(intrusas.length, 0,
     `funcao nao declarada no projeto financeiro: ${intrusas.join(", ")} — ` +
     "se ela pertence mesmo ao projeto do dinheiro, adicione-a a PERMITIDAS_NO_PRIMARIO com motivo");
});

test("supabase/config.toml nao declara user-report-intake", () => {
  const t = readFileSync(CFG_PRIMARIO, "utf-8");
  ok(!/^\s*\[functions\.user-report-intake\]/m.test(t),
     "o manifesto do projeto financeiro voltou a declarar o intake");
});

test("nenhum arquivo do intake sobrou sob supabase/", () => {
  const versionados = execSync("git ls-files supabase/", { cwd: RAIZ, encoding: "utf-8" })
    .split("\n").filter(Boolean);
  const sobras = versionados.filter((p) => p.includes("user-report-intake"));
  eq(sobras.length, 0, `sobrou sob o projeto financeiro: ${sobras.join(", ")}`);
});

console.log("\n2. O projeto de suporte tem alvo proprio:");

test("support-intake/supabase/config.toml existe e declara o intake", () => {
  ok(existsSync(CFG_SUPORTE), "falta o manifesto do projeto de suporte");
  const t = readFileSync(CFG_SUPORTE, "utf-8");
  ok(/^\s*\[functions\.user-report-intake\]/m.test(t), "o intake nao esta declarado la");
});

test("o projeto de suporte hospeda o intake e mais nada", () => {
  const dirs = readdirSync(FN_SUPORTE, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  eq(dirs.join(","), "user-report-intake",
     "o projeto de suporte existe para UMA funcao; qualquer outra coisa ali refaz o problema");
});

test("os dois manifestos apontam para projetos DIFERENTES", () => {
  const ref = (p) => (readFileSync(p, "utf-8").match(/^\s*project_id\s*=\s*"([^"]+)"/m) || [])[1];
  const a = ref(CFG_PRIMARIO), b = ref(CFG_SUPORTE);
  ok(a && b, "os dois manifestos precisam declarar project_id");
  ok(a !== b, "o intake voltaria a rodar no projeto financeiro");
});

test("o manifesto de suporte nao carrega segredo nenhum", () => {
  // O alvo e VALOR de credencial, nao a PALAVRA. O manifesto nomeia `service_role` de proposito,
  // num comentario que explica por que NAO ha service_role compartilhado -- proibir a palavra
  // apagaria justamente a documentacao da decisao. Um gate que obriga a esconder o assunto e pior
  // que nenhum; a primeira versao deste caso reprovava por isso e estava errada.
  const t = readFileSync(CFG_SUPORTE, "utf-8");
  const semComentarios = t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  for (const p of [
    /BEGIN [A-Z ]*PRIVATE KEY/,                       // PEM
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,        // JWT
    /\bsb[ps]_[A-Za-z0-9_-]{12,}/,                    // chave nova do Supabase
    /(?:password|secret|service_role|token)\s*=\s*"(?!REPLACE_WITH_)[^"]{8,}"/i,  // atribuicao real
    /postgres(?:ql)?:\/\/[^\s"]+/,                    // string de conexao
  ]) {
    ok(!p.test(semComentarios), `padrao de credencial no manifesto: ${p}`);
  }
});

console.log("\n3. Sem ponte entre os dois projetos:");

test("o intake nao contem FDW, dblink nem credencial compartilhada", () => {
  const dir = join(FN_SUPORTE, "user-report-intake");
  const arquivos = readdirSync(dir).filter((f) => /\.(js|ts)$/.test(f));
  const todo = arquivos.map((f) => readFileSync(join(dir, f), "utf-8")).join("\n");
  // Mesma distincao de sempre: USO, nao MENCAO. O handler NOMEIA `SUPABASE_DB_URL` e
  // `SUPABASE_SECRET_KEYS` numa lista de credenciais PROIBIDAS -- essa mencao e a documentacao do
  // risco T-ENV-01, e apaga-la tornaria o codigo pior. O que nao pode existir e a LEITURA.
  for (const p of [
    /postgres_fdw/i, /dblink/i, /foreign\s+data\s+wrapper/i,
    /postgres(?:ql)?:\/\/[^\s"'`]+/,
    /Deno\.env\.get\(\s*["'`]SUPABASE_/,
    /\benv\.SUPABASE_[A-Z_]+/,
    /process\.env\.SUPABASE_/,
  ]) {
    ok(!p.test(todo), `ponte para o projeto financeiro encontrada: ${p}`);
  }
});

console.log("\n4. O que esta suite NAO prova:");
console.log("   O diretorio que a integracao do Supabase observa e configurado no PAINEL, fora");
console.log("   deste repositorio. Esta suite garante que o repo nao ENTREGA mais o intake pelo");
console.log("   caminho do projeto financeiro; ela nao consegue ler a configuracao do painel nem");
console.log("   deletar a funcao ja implantada la. Os dois passos sao do dono — ver o Human Gate.");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ ISOLAMENTO DE RUNTIME REPROVADO\n"); process.exit(1); }
console.log("✓ ISOLAMENTO DE RUNTIME OK\n");
