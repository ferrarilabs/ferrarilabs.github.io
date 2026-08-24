#!/usr/bin/env node
/**
 * O contrato de gates afetados pelo snapshot continua HONESTO (Issue #316-B).
 *
 * Um contrato de seguranca que aponta para um gate que nao existe, ou que o workflow nao executa,
 * e pior que nenhum: ele afirma protecao que nao acontece. Estes casos amarram as tres pontas —
 * o arquivo do contrato, os gates que ele nomeia, e o workflow que deveria roda-los.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const contrato = JSON.parse(readFileSync(join(RAIZ, "bolao/shared/safety/snapshot_affected_gates.json"), "utf-8"));
const wf = readFileSync(join(RAIZ, ".github/workflows/bolao_provider_snapshot.yml"), "utf-8");
const validador = readFileSync(join(RAIZ, "bolao/scripts/validate_snapshot_before_publish.mjs"), "utf-8");

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                          catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\nGuarda de publicacao do snapshot (#316-B)\n");

test("todo app do contrato declara snapshot e ao menos um gate", () => {
  for (const [app, cfg] of Object.entries(contrato.apps)) {
    assert(typeof cfg.snapshot === "string" && cfg.snapshot.endsWith(".json"), `${app}: snapshot invalido`);
    assert(Array.isArray(cfg.gates) && cfg.gates.length > 0, `${app}: sem gate — o contrato nao protege nada`);
  }
});

test("todo gate nomeado EXISTE no disco", () => {
  for (const [app, cfg] of Object.entries(contrato.apps)) {
    for (const g of cfg.gates) {
      const alvo = g.cmd[g.cmd.length - 1];
      assert(existsSync(join(RAIZ, alvo)), `${app}: gate inexistente -> ${alvo}`);
    }
  }
});

test("todo gate tem motivo escrito e especifico", () => {
  for (const [app, cfg] of Object.entries(contrato.apps)) {
    for (const g of cfg.gates) {
      assert(typeof g.why === "string" && g.why.length > 40, `${app}: gate sem motivo utilizavel`);
    }
  }
});

test("os gates nomeados realmente RENDERIZAM o snapshot commitado", () => {
  // O criterio de inclusao do contrato. Um gate que intercepta a fonte com fixture e
  // deterministico e NAO precisa rodar a cada snapshot — incluir seria custo sem protecao.
  for (const [app, cfg] of Object.entries(contrato.apps)) {
    for (const g of cfg.gates) {
      const src = readFileSync(join(RAIZ, g.cmd[g.cmd.length - 1]), "utf-8");
      assert(/goto\(/.test(src), `${app}: ${g.cmd.at(-1)} nao abre pagina nenhuma`);
      assert(!/route\([^)]*espn-normalized[^)]*\)[\s\S]{0,200}fulfill/.test(src),
        `${app}: ${g.cmd.at(-1)} ESTUBA o snapshot — nao depende do dado, nao pertence a este contrato`);
    }
  }
});

test("o workflow executa o validador ANTES do passo de commit", () => {
  const iVal = wf.indexOf("validate_snapshot_before_publish.mjs");
  const iCommit = wf.indexOf("- name: Commit refreshed snapshot");
  assert(iVal !== -1, "o workflow nao chama o validador — o contrato seria decorativo");
  assert(iCommit !== -1, "passo de commit nao encontrado");
  assert(iVal < iCommit, "o validador roda DEPOIS do commit — o dado ruim ja teria entrado");
});

test("o validador falha FECHADO para app sem contrato", () => {
  assert(/nao tem contrato/.test(validador) && /process\.exit\(1\)/.test(validador),
    "um app novo sem contrato publicaria por omissao — o oposto do lado seguro");
});

test("nenhum PAT amplo foi introduzido no workflow para disparar CI", () => {
  // A saida facil que a Issue proibiu explicitamente.
  assert(!/secrets\.(PAT|GH_PAT|PERSONAL|ADMIN_TOKEN|REPO_TOKEN)/i.test(wf),
    "o workflow passou a usar um token amplo — a correcao era validar antes, nao ampliar credencial");
});

test("a validacao so gasta navegador quando o snapshot MUDOU", () => {
  assert(/steps\.changed\.outputs\.changed == 'true'/.test(wf),
    "os passos de node/playwright nao estao condicionados a mudanca do snapshot");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ GUARDA DE PUBLICACAO REPROVADA\n"); process.exit(1); }
console.log("✓ GUARDA DE PUBLICACAO OK\n");
