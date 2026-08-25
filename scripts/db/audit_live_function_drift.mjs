#!/usr/bin/env node
/**
 * DERIVA ENTRE `main` E PRODUCAO (Issue #306).
 *
 * ─── O INCIDENTE ────────────────────────────────────────────────────────────────────────────
 *
 * A Issue #296 entrou em `main` com CI verde e ficou HORAS sem chegar a producao: a integracao
 * Supabase-GitHub morria aplicando uma migracao nao-idempotente e abortava ANTES de implantar as
 * Edge Functions. `main` verde nao era evidencia de producao. Nada avisou -- a divergencia foi
 * encontrada por `curl` manual, por acaso.
 *
 * Um invariante que so vale quando alguem lembra de conferir nao e um invariante.
 *
 * ─── O QUE ESTE GATE FAZ ────────────────────────────────────────────────────────────────────
 *
 * 1. SEMPRE (sem rede, deterministico): recalcula o SHA do codigo-fonte da funcao e exige que
 *    `DEPLOYED_SOURCE_SHA` bata. Editar a funcao sem atualizar o manifesto reprova aqui — o
 *    manifesto nao depende de alguem "lembrar de bumpar".
 *
 * 2. COM REDE (`VERIFY_ALLOW_NETWORK=1`): le o header `x-deploy-sha` de producao e classifica:
 *
 *      LIVE_MATCHES_MAIN  producao roda exatamente este codigo
 *      LIVE_DRIFT         producao roda outro codigo — merge != deploy
 *      DEPLOY_PENDING     producao ainda nao expoe o header (versao anterior a este mecanismo)
 *      UNKNOWN            nao deu para saber (rede, timeout) — nunca confundido com "esta ok"
 *
 * NUNCA muta producao. So le, e so o endpoint publico de dado esportivo.
 *
 * Uso: node scripts/db/audit_live_function_drift.mjs
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Os arquivos que COMPOEM a funcao implantada. Ordem fixa: o hash tem de ser reproduzivel. */
export const FONTES = [
  "supabase/functions/live-football/index.ts",
  "supabase/functions/_shared/gateway_core.js",
  "supabase/functions/_shared/normalize.js",
  "supabase/functions/_shared/freshness_contract.js",
];

const MANIFESTO = "supabase/functions/_shared/deploy_manifest.js";
const ENDPOINT = "https://cmhqkkfczotdnssupkni.supabase.co/functions/v1/live-football?competition=br2026";

export const ESTADOS = Object.freeze({
  LIVE_MATCHES_MAIN: "LIVE_MATCHES_MAIN",
  LIVE_DRIFT: "LIVE_DRIFT",
  DEPLOY_PENDING: "DEPLOY_PENDING",
  UNKNOWN: "UNKNOWN",
});

/**
 * SHA do codigo-fonte da funcao.
 *
 * O proprio manifesto entra no hash com a linha do SHA NEUTRALIZADA — senao o valor dependeria de
 * si mesmo e nenhum ponto fixo existiria.
 */
export function calcularSha(lerArquivo = (rel) => readFileSync(join(RAIZ, rel), "utf-8")) {
  const h = createHash("sha256");
  for (const rel of FONTES) {
    h.update(rel).update("\0").update(lerArquivo(rel)).update("\0");
  }
  const man = lerArquivo(MANIFESTO).replace(/DEPLOYED_SOURCE_SHA\s*=\s*"[^"]*"/, 'DEPLOYED_SOURCE_SHA = "<self>"');
  h.update(MANIFESTO).update("\0").update(man);
  return h.digest("hex").slice(0, 16);
}

// ══ PROCEDENCIA DA FONTE (Issue #334) ═════════════════════════════════════════════════════════
//
// Este gate calculava o hash lendo o DISCO e, quando dava diferenca, mandava o operador colar o
// valor calculado em `deploy_manifest.js`. Enquanto o disco for a arvore canonica em repouso, isso
// esta certo. A #334 mostrou o caso em que nao esta: `safety-contract-mutations` mutava
// `supabase/functions/**` na mesma arvore, em paralelo, e a leitura caia na janela da mutacao.
//
// O resultado nao era so um flake. Era uma INSTRUCAO ERRADA para um humano: gravar o hash de um
// codigo que nunca existiu, deixando o detector de deriva cego -- exatamente a cegueira que a #306
// criou este gate para acabar.
//
// A defesa aqui e a ultima camada (o isolamento da suite de mutacao e a primeira): o hash so pode
// ser RECOMENDADO quando se prova que veio de fonte canonica -- limpa no git E igual ao objeto
// commitado. Sujo, o gate continua reprovando (deriva real nunca e escondida), mas se recusa a
// ditar um valor para o manifesto.

export const FONTE = Object.freeze({
  CANONICAL: "CANONICAL_COMMITTED_SOURCE",
  DIRTY: "DIRTY_OR_TRANSIENT_WORKTREE",
});

/** Todos os caminhos que entram no hash. */
export const CAMINHOS_DO_HASH = Object.freeze([...FONTES, MANIFESTO]);

/**
 * Quais dos caminhos do hash estao sujos, a partir de um `git status --porcelain`.
 *
 * Pura de proposito: a decisao de seguranca precisa ser exercitavel sem git, sem rede e sem
 * depender de conseguir sujar a arvore no meio de um teste.
 */
export function caminhosSujos(porcelain) {
  const sujos = new Set();
  for (const linha of String(porcelain || "").split("\n")) {
    if (!linha.trim()) continue;
    const bruto = linha.slice(3);
    // Rename vem como `old -> new`: os DOIS lados importam.
    for (const caminho of bruto.split(" -> ")) {
      const limpo = caminho.trim().replace(/^"|"$/g, "");
      if (CAMINHOS_DO_HASH.includes(limpo)) sujos.add(limpo);
    }
  }
  return [...sujos];
}

function gitOuNulo(args) {
  const r = spawnSync("git", args, { cwd: RAIZ, encoding: "utf-8" });
  return r.status === 0 ? r.stdout : null;
}

/** Hash calculado a partir dos OBJETOS COMMITADOS em HEAD, nunca do disco. */
export function calcularShaCanonico(lerNoHead = (rel) => gitOuNulo(["show", `HEAD:${rel}`])) {
  const conteudos = new Map();
  for (const rel of CAMINHOS_DO_HASH) {
    const c = lerNoHead(rel);
    if (c === null || c === undefined) return null;   // caminho ausente em HEAD: nao da para afirmar
    conteudos.set(rel, c);
  }
  return calcularSha((rel) => conteudos.get(rel));
}

/**
 * Decide se o gate pode DITAR um hash para o manifesto.
 *
 * Duas condicoes, e as duas sao necessarias: a arvore tem de estar limpa nos caminhos do hash, e o
 * que esta no disco tem de ser identico ao que esta commitado. A segunda nao e redundante -- ela
 * cobre o caso em que o status mente (indice desatualizado, worktree transitoria, arquivo trocado
 * por fora) e transforma "o git disse que estava limpo" em prova de verdade.
 */
export function podeRecomendarHash({ sujos, shaDisco, shaCommitado }) {
  if (sujos && sujos.length > 0) return { ok: false, motivo: "FONTE_SUJA", sujos };
  if (!shaCommitado) return { ok: false, motivo: "SEM_OBJETO_COMMITADO" };
  if (shaDisco !== shaCommitado) return { ok: false, motivo: "DISCO_DIVERGE_DO_COMMITADO" };
  return { ok: true, motivo: "CANONICAL_COMMITTED_SOURCE" };
}

export function shaDeclarado(src = readFileSync(join(RAIZ, MANIFESTO), "utf-8")) {
  const m = /DEPLOYED_SOURCE_SHA\s*=\s*"([^"]*)"/.exec(src);
  return m ? m[1] : null;
}

/** Classifica producao contra o repositorio. Pura — recebe o que foi observado. */
export function classificarDeriva({ shaEsperado, shaVivo, alcancavel }) {
  if (!alcancavel) return ESTADOS.UNKNOWN;
  if (!shaVivo) return ESTADOS.DEPLOY_PENDING;
  return shaVivo === shaEsperado ? ESTADOS.LIVE_MATCHES_MAIN : ESTADOS.LIVE_DRIFT;
}

async function lerProducao() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(ENDPOINT, { signal: ctrl.signal });
    clearTimeout(t);
    // O header vem em QUALQUER status: um 503 SOURCE_UNAVAILABLE tambem e uma resposta desta
    // funcao, e a identidade dela nao depende de a ESPN estar de pe.
    return { alcancavel: true, shaVivo: r.headers.get("x-deploy-sha") };
  } catch {
    return { alcancavel: false, shaVivo: null };
  }
}

async function main() {
  const esperado = calcularSha();
  const declarado = shaDeclarado();

  console.log("\nDeriva entre main e producao (Issue #306)\n");
  console.log(`  hash calculado das fontes : ${esperado}`);
  console.log(`  hash declarado no manifesto: ${declarado}`);

  if (declarado !== esperado) {
    // #334: antes de DITAR um valor, provar de onde ele veio.
    const sujos = caminhosSujos(gitOuNulo(["status", "--porcelain", "--", ...CAMINHOS_DO_HASH]) ?? "");
    const canonico = calcularShaCanonico();
    const veredito = podeRecomendarHash({ sujos, shaDisco: esperado, shaCommitado: canonico });

    console.log(`\n✗ MANIFESTO DESATUALIZADO`);
    console.log(`\n  A funcao mudou e ${MANIFESTO} nao acompanhou. Sem isso, producao passaria a`);
    console.log(`  reportar um hash que nao identifica codigo nenhum, e a deteccao de deriva`);
    console.log(`  ficaria cega exatamente quando ha o que detectar.\n`);

    if (veredito.ok) {
      console.log(`  procedencia: ${FONTE.CANONICAL}`);
      console.log(`  Corrija trocando o valor por:  ${esperado}\n`);
    } else {
      // A deriva NAO e escondida -- o gate continua vermelho. O que se recusa e ditar um valor
      // colhido de uma arvore que ninguem pode provar canonica.
      console.log(`  procedencia: ${FONTE.DIRTY}  (${veredito.motivo})`);
      if (veredito.sujos?.length) {
        console.log(`  caminhos nao commitados: ${veredito.sujos.join(", ")}`);
      }
      console.log(`\n  SOURCE_NOT_CANONICAL`);
      console.log(`  Nao da para recomendar atualizacao do manifesto a partir de uma arvore suja`);
      console.log(`  ou transitoria. Um hash colhido assim pode ser de codigo que nunca existiu --`);
      console.log(`  grava-lo deixaria a deteccao de deriva cega (Issues #306 e #334).\n`);
      console.log(`  O que fazer: commitar (ou descartar) os caminhos acima e rodar de novo. Se`);
      console.log(`  isto apareceu durante um \`npm run check\`, rode este gate isolado:`);
      console.log(`    node scripts/db/audit_live_function_drift.mjs\n`);
    }
    process.exit(1);
  }
  console.log("  ✓ manifesto bate com as fontes");

  if (process.env.VERIFY_ALLOW_NETWORK !== "1") {
    console.log("\n  ○ comparacao com PRODUCAO pulada (defina VERIFY_ALLOW_NETWORK=1 para incluir).");
    console.log("    Isto NAO e um verde sobre producao — e a ausencia da medicao.\n");
    return;
  }

  const { alcancavel, shaVivo } = await lerProducao();
  const estado = classificarDeriva({ shaEsperado: esperado, shaVivo, alcancavel });
  console.log(`\n  producao (x-deploy-sha): ${shaVivo || "(ausente)"}`);
  console.log(`  ESTADO: ${estado}\n`);

  if (estado === ESTADOS.LIVE_MATCHES_MAIN) { console.log("✓ producao roda exatamente este codigo\n"); return; }
  if (estado === ESTADOS.UNKNOWN) {
    console.log("✗ NAO FOI POSSIVEL MEDIR — tratado como falha, nunca como sucesso silencioso\n");
    process.exit(1);
  }
  if (estado === ESTADOS.DEPLOY_PENDING) {
    console.log("✗ producao nao expoe `x-deploy-sha`: roda versao anterior a este mecanismo.");
    console.log("  Isso E deriva — so nao da para dizer QUAL codigo esta la.\n");
    process.exit(1);
  }
  console.log("✗ LIVE_DRIFT — merge nao virou deploy. Producao roda codigo diferente de main.\n");
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
