#!/usr/bin/env node
/**
 * test_docs_drift.mjs — a documentação canônica não pode descrever uma arquitetura que não existe.
 *
 * ─── O QUE ISTO MEDE, E O QUE DELIBERADAMENTE NÃO MEDE ──────────────────────────────────────
 *
 * Mede **deriva arquitetural**: o documento canônico ainda aponta o runtime certo? A RTM referencia
 * arquivos e testes que existem? O identificador de configuração no doc bate com o do código?
 *
 * NÃO mede prosa. Não há comparação de frase, de pontuação nem de ordem de seção. Um gate que
 * reprova porque alguém melhorou uma explicação treina as pessoas a não melhorarem explicações.
 *
 * A regra de ouro aqui é a mesma que já custou caro três vezes nesta Issue: **menção não é uso**. O
 * histórico PRECISA continuar podendo dizer "antes isto rodava no Supabase" — o que não pode é o
 * documento canônico descrever isso como o alvo ATUAL.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = join(RAIZ, "docs", "bolao");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
function test(nome, fn) {
  try { fn(); pass++; console.log(`  ✓ ${nome}`); }
  catch (e) { fail++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}

const ler = (p) => readFileSync(join(DOCS, p), "utf-8");

console.log("\nDeriva de documentação — canal de reporte (#321)\n");

console.log("1. Os artefatos canônicos existem:");

const CANONICOS = [
  "SECURE_USER_REPORTING.md",
  "USER_REPORT_REQUIREMENTS_TRACEABILITY_MATRIX.md",
  "adr/ADR-021-intake-em-cloudflare-worker.md",
];
for (const d of CANONICOS) {
  test(`existe: ${d}`, () => ok(existsSync(join(DOCS, d)), "artefato canônico ausente"));
}

console.log("\n2. O runtime descrito é o runtime implementado:");

test("o documento canônico nomeia o Cloudflare Worker como runtime ATUAL", () => {
  const t = ler("SECURE_USER_REPORTING.md");
  ok(/\*\*Runtime:\*\*.*Cloudflare Worker/.test(t), "o cabeçalho precisa declarar o runtime atual");
  ok(t.includes("ferrarilabs-support-intake"), "o nome do Worker precisa aparecer");
  ok(t.includes("workers/user-report-intake/"), "o caminho do código precisa aparecer");
});

test("o nome do Worker no doc bate com o do wrangler.jsonc", () => {
  const cfg = readFileSync(join(RAIZ, "workers/user-report-intake/wrangler.jsonc"), "utf-8");
  const m = cfg.match(/"name"\s*:\s*"([^"]+)"/);
  ok(m, "wrangler.jsonc sem `name`");
  ok(ler("SECURE_USER_REPORTING.md").includes(m[1]),
     `o doc não menciona o nome real do Worker (${m[1]})`);
});

test("o doc NÃO descreve a Edge Function do Supabase como alvo atual", () => {
  const t = ler("SECURE_USER_REPORTING.md");
  // Deriva seria o diagrama de fluxo ainda apontando para o runtime antigo. O texto histórico
  // ("antes rodava no Supabase", "a função legada segue inerte") continua permitido e desejável.
  const fluxo = t.slice(t.indexOf("## 2. Fluxo"), t.indexOf("## 3."));
  ok(!/ENDPOINT PÚBLICO\s+supabase\/functions/.test(fluxo),
     "o diagrama canônico ainda aponta para a Edge Function do Supabase");
  ok(/CLOUDFLARE WORKER/.test(fluxo), "o diagrama precisa mostrar o Worker");
});

test("o interruptor e a flag de cliente estão documentados com os papéis certos", () => {
  const t = ler("SECURE_USER_REPORTING.md");
  ok(t.includes("REPORT_INTAKE_ENABLED"), "o interruptor de servidor precisa estar no doc");
  ok(t.includes("reportProblem.enabled"), "a flag de cliente precisa estar no doc");
  ok(/fronteira de segurança|fronteira\b/i.test(t), "o papel de cada gate precisa estar dito");
});

console.log("\n3. A RTM aponta para coisas que existem:");

test("todo caminho de arquivo citado na RTM resolve", () => {
  const t = ler("USER_REPORT_REQUIREMENTS_TRACEABILITY_MATRIX.md");
  // Caminhos com extensão conhecida, dentro de crase.
  const caminhos = [...t.matchAll(/`([A-Za-z0-9_\-./*]+\.(?:ts|mjs|js|py|json|jsonc|md))`/g)]
    .map((m) => m[1])
    .filter((c) => !c.includes("*"));  // padrões glob são descritivos, não referências
  ok(caminhos.length >= 10, `poucos caminhos citados (${caminhos.length}) — a RTM ficaria vaga`);
  const faltando = [];
  for (const c of new Set(caminhos)) {
    const tentativas = [join(RAIZ, c), join(DOCS, c), join(RAIZ, "workers/user-report-intake", c)];
    if (!tentativas.some(existsSync)) faltando.push(c);
  }
  eq(faltando.length, 0, `RTM aponta para arquivo inexistente: ${faltando.join(", ")}`);
});

test("todo requisito tem estado declarado, e nenhum estado e inventado", () => {
  const t = ler("USER_REPORT_REQUIREMENTS_TRACEABILITY_MATRIX.md");
  const linhas = t.split("\n").filter((l) => /^\| R-REPORT-\d{3} \|/.test(l));
  ok(linhas.length >= 24, `esperados >= 24 requisitos, achados ${linhas.length}`);
  const validos = ["IMPLEMENTADO", "PARCIAL", "PENDENTE_PROVISIONAMENTO", "NÃO_IMPLEMENTADO"];
  for (const l of linhas) {
    const celulas = l.split("|").map((c) => c.trim());
    const estado = celulas[celulas.length - 2];
    ok(validos.some((v) => estado.startsWith(v)), `estado inválido em: ${celulas[1]} => "${estado}"`);
  }
});

test("os IDs de requisito nao se repetem", () => {
  const t = ler("USER_REPORT_REQUIREMENTS_TRACEABILITY_MATRIX.md");
  const ids = [...t.matchAll(/^\| (R-REPORT-\d{3}) \|/gm)].map((m) => m[1]);
  eq(ids.length, new Set(ids).size, "ID de requisito duplicado");
});

console.log("\n4. O ADR registra a decisão de plataforma:");

test("o ADR-021 tem as seções que uma decisão de plataforma exige", () => {
  const t = ler("adr/ADR-021-intake-em-cloudflare-worker.md");
  for (const s of ["Contexto", "Decisão", "Alternativas consideradas", "Consequências",
                   "Racional de segurança", "Reversibilidade", "Riscos residuais"]) {
    ok(t.includes(s), `seção ausente no ADR: ${s}`);
  }
});

test("o ADR considera as tres alternativas reais, sem desqualificar a anterior", () => {
  const t = ler("adr/ADR-021-intake-em-cloudflare-worker.md");
  ok(/mesmo projeto Supabase/i.test(t), "alternativa A");
  ok(/projeto Supabase separado/i.test(t), "alternativa B");
  ok(/Cloudflare Worker/i.test(t), "alternativa C");
  ok(/não era irracional|superad|supersede/i.test(t),
     "o ADR precisa registrar que o desenho anterior foi SUPERADO, nao que era irracional");
});

console.log("\n5. Cross-references resolvem:");

test("o doc canônico aponta para o ADR e para a RTM", () => {
  const t = ler("SECURE_USER_REPORTING.md");
  ok(t.includes("ADR-021"), "sem ponteiro para o ADR");
  ok(t.includes("USER_REPORT_REQUIREMENTS_TRACEABILITY_MATRIX"), "sem ponteiro para a RTM");
});

test("nenhum documento canônico aponta para o caminho antigo do intake", () => {
  const antigos = [];
  for (const d of CANONICOS) {
    const t = ler(d);
    // `support-intake/supabase/` foi o caminho intermediario (PR #327) e nao existe mais.
    if (/support-intake\/supabase\/functions/.test(t)) antigos.push(d);
  }
  eq(antigos.length, 0, `aponta para caminho que nao existe mais: ${antigos.join(", ")}`);
});

console.log("\n6. O manifesto de prontidão mede o que existe:");

/**
 * ─── O DEFEITO QUE ORIGINA ESTA SEÇÃO (2026-08-25) ──────────────────────────────────────────
 *
 * `readiness.mjs` é o único artefato que responde "dá para ligar o canal?". Quando o intake migrou
 * do Supabase para o Cloudflare Worker (ADR-021, PR #331), **doze** dos seus itens continuaram
 * lendo `support-intake/supabase/functions/...` — um diretório apagado no mesmo PR.
 *
 * O modo de falha é o pior possível para um relatório de segurança, porque é **silencioso e
 * plausível**: `ler()` devolve `null` para arquivo ausente, `null` vira `""`, `""` não casa com
 * regex nenhuma, e cada item vira `FAIL`. O relatório passou a dizer "o interruptor de servidor não
 * existe", "CORS não é allowlist", "o destino privado não é verificado em runtime" — três coisas
 * que **eram falsas**, sobre controles que estavam íntegros o tempo todo.
 *
 * Um `FAIL` falso não trava nada (o processo sai 0 de propósito) e ensina a ignorar o relatório
 * inteiro. É como se perde um gate sem nunca deletá-lo.
 *
 * Nenhuma catraca pegou porque `readiness.mjs` não roda no `verify.mjs` — e não deve rodar: ele
 * reporta `NOT_READY` por desenho enquanto o dono não provisionar o que só ele provisiona, e
 * vermelho permanente é vermelho que se aprende a ignorar. O que PODE ser gate é outra pergunta,
 * mais fraca e suficiente: **todo caminho que ele lê existe?** Isso é determinístico, é verde hoje,
 * e teria falhado no minuto exato em que o diretório sumiu.
 */
test("todo caminho de repositório citado pelo manifesto de prontidão existe", () => {
  const t = readFileSync(join(RAIZ, "scripts/report/readiness.mjs"), "utf-8");

  // Os prefixos sao LIDOS do proprio manifesto, nunca repetidos aqui. Uma primeira versao deste
  // gate escrevia `workers/user-report-intake/src/` a mao e por isso nao mordia: apontar `SRC` para
  // um diretorio morto continuava passando, porque o gate conferia o caminho que ELE achava que o
  // manifesto usava, e nao o que o manifesto usa. Um gate que carrega sua propria copia da verdade
  // valida a copia.
  const constante = (nome) => (t.match(new RegExp(`const ${nome} = "([^"]+)"`)) || [])[1];
  const WORKER_DIR = constante("WORKER");
  ok(WORKER_DIR, "o manifesto precisa declarar `const WORKER`");
  const mSrc = t.match(/const SRC = (?:`\$\{WORKER\}\/([\w.\-/]+)`|"([^"]+)")/);
  ok(mSrc, "o manifesto precisa declarar `const SRC`");
  const SRC_DIR = mSrc[1] ? `${WORKER_DIR}/${mSrc[1]}` : mSrc[2];

  // Literais de caminho: `"a/b/c.ext"` e as formas com template `${SRC}/x.ts` / `${WORKER}/y`.
  const brutos = new Set();
  brutos.add(WORKER_DIR);
  brutos.add(SRC_DIR);
  // Exige `/`: um literal sem barra e nome de arquivo solto (a lista de `fonteDoWorker()`), nao
  // caminho de repositorio. Essa lista e resolvida logo abaixo, contra o diretorio de fonte real.
  for (const m of t.matchAll(/"([\w.\-]+\/[\w.\-/]+\.(?:ts|js|mjs|toml|html|json|jsonc))"/g)) brutos.add(m[1]);

  // `fonteDoWorker()` lista os arquivos do Worker por nome solto; eles moram sob `SRC`.
  const listaFonte = t.match(/const fonteDoWorker = \(\) => \[([^\]]*)\]/);
  if (listaFonte) {
    for (const m of listaFonte[1].matchAll(/"([\w.\-]+)"/g)) {
      brutos.add(`${SRC_DIR}/${m[1]}`);
    }
  }
  for (const m of t.matchAll(/`\$\{SRC\}\/([\w.\-]+)`/g)) brutos.add(`${SRC_DIR}/${m[1]}`);
  for (const m of t.matchAll(/`\$\{WORKER\}\/([\w.\-/]+)`/g)) brutos.add(`${WORKER_DIR}/${m[1]}`);
  for (const m of t.matchAll(/`\$\{dir\}\/\$\{html\}`/g)) void m;   // coberto pela lista de apps

  ok(brutos.size >= 10, `esperava vários caminhos, achei ${brutos.size} — a extração quebrou`);

  const ausentes = [...brutos].filter((p) => !existsSync(join(RAIZ, p)));
  eq(ausentes.length, 0, `o manifesto lê caminho que não existe: ${ausentes.join(", ")}`);
});

test("o manifesto de prontidão não cita mais o runtime abandonado", () => {
  const t = readFileSync(join(RAIZ, "scripts/report/readiness.mjs"), "utf-8");
  // Menção NÃO é uso: os comentários PRECISAM poder contar que isto já morou no Supabase. O que
  // não pode é um `ler()` continuar apontando para lá.
  const usos = [...t.matchAll(/ler\(\s*["'`]([^"'`]*support-intake\/supabase[^"'`]*)/g)].map((m) => m[1]);
  eq(usos.length, 0, `ainda lê o caminho abandonado: ${usos.join(", ")}`);
});

test("os itens OWNER são só os que não têm caminho de API", () => {
  const t = readFileSync(join(RAIZ, "scripts/report/readiness.mjs"), "utf-8");
  const owner = [...t.matchAll(/item\("([\w_]+)",\s*"OWNER"/g)].map((m) => m[1]);
  // Estes dois morreram junto com a arquitetura que os criou (ADR-021 rejeitou o projeto Supabase
  // separado, e o Durable Object substituiu o Redis externo). Mantê-los como `OWNER` travaria o
  // veredito para sempre em recursos que ninguém deve provisionar.
  for (const morto of ["support_supabase_project_created", "redis_configured"]) {
    ok(!owner.includes(morto), `item obsoleto ressuscitado: ${morto}`);
  }
  // `private_repo_verified` é respondido pela API do GitHub — memória de pessoa não é evidência.
  ok(!owner.includes("private_repo_verified"),
     "a visibilidade do repositório é verificável por API; não pode voltar a ser OWNER");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ DERIVA DE DOCUMENTACAO REPROVADA\n"); process.exit(1); }
console.log("✓ DOCUMENTACAO CONSISTENTE COM A ARQUITETURA\n");
