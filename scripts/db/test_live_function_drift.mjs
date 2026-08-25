#!/usr/bin/env node
/**
 * Testes do detector de deriva main-vs-producao (Issue #306). Sem rede: as observacoes sao injetadas.
 *
 * O que estes casos protegem: que "nao consegui medir" nunca se pareca com "esta tudo bem", e que
 * o hash mude quando — e so quando — a funcao muda.
 */

import { classificarDeriva, ESTADOS, calcularSha, shaDeclarado, FONTES,
         calcularShaCanonico, caminhosSujos, podeRecomendarHash, CAMINHOS_DO_HASH, FONTE }
  from "./audit_live_function_drift.mjs";
import { spawnSync } from "node:child_process";
import { achados, stripNoise } from "./audit_migration_idempotency.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require_read = (rel) => readFileSync(join(RAIZ, rel), "utf-8");

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                          catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

console.log("\nDetector de deriva main-vs-producao\n");
console.log("Classificacao:");

test("producao com o mesmo hash => LIVE_MATCHES_MAIN", () => {
  eq(classificarDeriva({ shaEsperado: "abc", shaVivo: "abc", alcancavel: true }), ESTADOS.LIVE_MATCHES_MAIN, "estado");
});

test("producao com hash diferente => LIVE_DRIFT", () => {
  eq(classificarDeriva({ shaEsperado: "abc", shaVivo: "xyz", alcancavel: true }), ESTADOS.LIVE_DRIFT, "estado");
});

test("producao sem o header => DEPLOY_PENDING (versao anterior ao mecanismo)", () => {
  eq(classificarDeriva({ shaEsperado: "abc", shaVivo: null, alcancavel: true }), ESTADOS.DEPLOY_PENDING, "estado");
});

test("producao inalcancavel => UNKNOWN, JAMAIS 'combina'", () => {
  // O caso que define o gate: rede caida nao pode virar evidencia de que producao esta certa.
  eq(classificarDeriva({ shaEsperado: "abc", shaVivo: null, alcancavel: false }), ESTADOS.UNKNOWN, "estado");
  eq(classificarDeriva({ shaEsperado: "abc", shaVivo: "abc", alcancavel: false }), ESTADOS.UNKNOWN,
     "um hash lido de uma resposta que nao chegou nao vale nada");
});

test("os quatro estados sao distintos — nenhum colapsa em outro", () => {
  eq(new Set(Object.values(ESTADOS)).size, 4, "estados distintos");
});

console.log("\nHash das fontes:");

test("o manifesto commitado bate com as fontes commitadas", () => {
  eq(shaDeclarado(), calcularSha(), "manifesto desatualizado no repositorio");
});

test("mudar QUALQUER fonte muda o hash", () => {
  for (const alvo of FONTES) {
    const mutado = calcularSha((rel) =>
      require_read(rel) + (rel === alvo ? "\n// mutacao\n" : ""));
    assert(mutado !== calcularSha(), `editar ${alvo} nao mudou o hash — o detector ficaria cego`);
  }
});

test("o hash e ESTAVEL: mesma entrada, mesmo valor", () => {
  eq(calcularSha(), calcularSha(), "hash nao deterministico");
});

test("o hash NAO depende de si mesmo (ponto fixo existe)", () => {
  // Se o SHA do manifesto entrasse cru no hash, mudar o SHA mudaria o hash, e nenhum valor
  // poderia estar correto. A linha e neutralizada — este caso prova que a neutralizacao funciona.
  const comOutroSha = calcularSha((rel) =>
    rel.endsWith("deploy_manifest.js")
      ? require_read(rel).replace(/DEPLOYED_SOURCE_SHA = "[^"]*"/, 'DEPLOYED_SOURCE_SHA = "ffffffffffffffff"')
      : require_read(rel));
  eq(comOutroSha, calcularSha(), "o hash mudou so por trocar o proprio SHA declarado");
});

console.log("\nProcedencia da fonte (Issue #334):");

test("numa arvore limpa, o hash do disco e o hash do OBJETO COMMITADO coincidem", () => {
  // Auto-guardado: so afirma quando os caminhos do hash estao limpos. Numa arvore de trabalho com
  // edicao pendente nesses caminhos a divergencia e o comportamento CERTO, nao uma falha.
  const porcelain = spawnSync("git", ["status", "--porcelain", "--", ...CAMINHOS_DO_HASH],
    { cwd: RAIZ, encoding: "utf-8" }).stdout || "";
  if (caminhosSujos(porcelain).length > 0) { console.log("      (pulado: fontes com edicao pendente)"); return; }
  eq(calcularShaCanonico(), calcularSha(), "disco e HEAD divergem com a arvore limpa");
});

test("o hash canonico ignora o disco por construcao", () => {
  // Injeta um leitor que devolve conteudo diferente do disco: se `calcularShaCanonico` estivesse
  // lendo arquivos em vez dos objetos de git, este caso nao mudaria nada.
  const mutado = calcularShaCanonico((rel) => `conteudo sintetico de ${rel}`);
  assert(mutado !== calcularSha(), "o hash canonico nao reagiu ao conteudo que recebeu");
});

test("caminho ausente em HEAD => sem hash canonico, nunca um palpite", () => {
  eq(calcularShaCanonico(() => null), null, "deveria devolver null quando o objeto nao existe");
});

test("a recusa de recomendar cobre suja, divergente e ausente", () => {
  assert(!podeRecomendarHash({ sujos: [FONTES[0]], shaDisco: "a", shaCommitado: "a" }).ok, "suja");
  assert(!podeRecomendarHash({ sujos: [], shaDisco: "a", shaCommitado: "b" }).ok, "divergente");
  assert(!podeRecomendarHash({ sujos: [], shaDisco: "a", shaCommitado: null }).ok, "ausente");
  const bom = podeRecomendarHash({ sujos: [], shaDisco: "a", shaCommitado: "a" });
  assert(bom.ok && bom.motivo === FONTE.CANONICAL, "limpa e igual deveria recomendar");
});

console.log("\nIdempotencia de migracao (Issue #306, mesma causa raiz):");

test("`add constraint` cru e acusado", () => {
  const sql = "alter table t add constraint c_x check (a is distinct from b);";
  eq(achados(sql, "m.sql").length, 1, "o statement que quebrou o deploy passou batido");
});

test("`add constraint` dentro de DO com IF NOT EXISTS e aceito", () => {
  const sql = `do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'c_x') then
      alter table t add constraint c_x check (a is distinct from b);
    end if;
  end $$;`;
  eq(achados(sql, "m.sql").length, 0, "a forma correta foi acusada — o gate viraria ruido");
});

test("`create trigger` precedido de `drop trigger if exists` e aceito", () => {
  const sql = `drop trigger if exists tg_x on t;\ncreate trigger tg_x after insert on t execute function f();`;
  eq(achados(sql, "m.sql").length, 0, "a forma correta foi acusada");
});

test("`create trigger` sem drop e acusado", () => {
  eq(achados("create trigger tg_x after insert on t execute function f();", "m.sql").length, 1, "passou batido");
});

test("statement dentro de COMENTARIO nao conta", () => {
  eq(achados("-- alter table t add constraint c_x check (true);", "m.sql").length, 0, "comentario acusado");
  eq(achados("/* add constraint c_y check (true) */", "m.sql").length, 0, "bloco de comentario acusado");
  assert(!/add constraint/i.test(stripNoise("-- add constraint c;")), "stripNoise nao removeu o comentario");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) { console.log("✗ DRIFT DETECTOR FAILED\n"); process.exit(1); }
console.log("✓ DRIFT DETECTOR OK\n");
