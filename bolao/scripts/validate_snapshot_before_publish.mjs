#!/usr/bin/env node
/**
 * validate_snapshot_before_publish.mjs — o dado gerado prova que serve ANTES de virar commit.
 *
 * ─── O DEFEITO QUE ISTO FECHA (Issue #316-B) ────────────────────────────────────────────────
 *
 * O produtor de snapshot commita em `main` com `GITHUB_TOKEN`, e um push com esse token NAO
 * dispara outro workflow — e a protecao anti-loop do GitHub, deliberada e correta. O efeito
 * colateral e que **nenhum `npm run check` roda nesses commits**: dado gerado entrava em `main` sem
 * verificacao nenhuma.
 *
 * Foi assim que uma combinacao de conteudo passou a estourar a pagina a 320px e ficou vermelha em
 * silencio. Os tres commits de bot seguintes nao tiveram uma unica execucao de CI; o ultimo commit
 * humano antes deles estava verde.
 *
 * ─── POR QUE VALIDAR ANTES, E NAO DISPARAR CI DEPOIS ────────────────────────────────────────
 *
 * Trocar o `GITHUB_TOKEN` por um PAT amplo so para acordar outro workflow resolveria o sintoma
 * criando uma credencial com muito mais alcance do que a tarefa precisa, e abriria cadeia recursiva
 * de workflows. Validar antes de publicar nao precisa de token nenhum, nao encadeia nada, e tem uma
 * propriedade melhor: **o dado ruim nunca entra na historia**, em vez de entrar e ser reportado.
 *
 * ─── ESCOPO ─────────────────────────────────────────────────────────────────────────────────
 *
 * Roda so os gates que o snapshot daquele app consegue afetar (`snapshot_affected_gates.json`), e
 * so quando o snapshot REALMENTE mudou. Rodar a suite inteira de navegador a cada dez minutos seria
 * caro sem proteger mais; rodar nada seria o estado que produziu a #316.
 *
 * Uso: node bolao/scripts/validate_snapshot_before_publish.mjs <app>
 * Saida: exit 0 = pode publicar. exit 1 = NAO publicar (motivo impresso).
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRATO = join(RAIZ, "bolao/shared/safety/snapshot_affected_gates.json");

const app = process.argv[2];
if (!app) { console.error("uso: validate_snapshot_before_publish.mjs <app>"); process.exit(2); }

const contrato = JSON.parse(readFileSync(CONTRATO, "utf-8"));
const cfg = contrato.apps[app];
if (!cfg) {
  // Falha FECHADO: um app sem contrato nao pode publicar por omissao. Se alguem adicionar um app
  // novo e esquecer o contrato, o certo e travar a publicacao, nao liberar por default.
  console.error(`✗ app "${app}" nao tem contrato em snapshot_affected_gates.json.`);
  console.error(`  Apps com contrato: ${Object.keys(contrato.apps).join(", ")}`);
  console.error(`  Publicar sem contrato e exatamente o estado que a Issue #316 documentou.`);
  process.exit(1);
}

// O snapshot mudou de fato? Sem mudanca nao ha risco novo e nao ha por que gastar navegador.
const diff = spawnSync("git", ["diff", "--quiet", "--", cfg.snapshot], { cwd: RAIZ });
const staged = spawnSync("git", ["diff", "--cached", "--quiet", "--", cfg.snapshot], { cwd: RAIZ });
const mudou = diff.status === 1 || staged.status === 1;

console.log(`\nValidacao pre-publicacao — ${app}`);
console.log(`  snapshot: ${cfg.snapshot}`);
if (!mudou) {
  console.log("  inalterado — nada a validar, nada a publicar.\n");
  process.exit(0);
}
console.log(`  MUDOU — rodando ${cfg.gates.length} gate(s) afetado(s) antes de permitir o commit\n`);

let falhou = 0;
for (const g of cfg.gates) {
  const nome = g.cmd[g.cmd.length - 1].split("/").pop();
  process.stdout.write(`  → ${nome} ... `);
  const r = spawnSync(g.cmd[0], g.cmd.slice(1), { cwd: RAIZ, encoding: "utf-8" });
  if (r.status === 0) { console.log("PASS"); continue; }
  falhou++;
  console.log("FAIL");
  console.log(`      motivo declarado: ${g.why}`);
  const saida = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n").filter((l) => /✗|FAIL|overflow|estouro/i.test(l));
  for (const l of saida.slice(0, 8)) console.log(`      ${l.trim()}`);
}

if (falhou) {
  console.log(`\n✗ SNAPSHOT REPROVADO — ${falhou} gate(s) afetado(s) falharam.`);
  console.log(`  O snapshot NAO deve ser commitado. O dado gerado quebra a pagina que ele alimenta,`);
  console.log(`  e publica-lo colocaria em main um defeito que nenhum CI iria reportar depois.\n`);
  process.exit(1);
}
console.log(`\n✓ snapshot validado — publicacao liberada\n`);
