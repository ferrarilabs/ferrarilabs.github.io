#!/usr/bin/env node
/**
 * surfaces.mjs — biblioteca do contrato permanente de seguranca de mudanca.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────────────────────
 *
 * A protecao contra regressao neste repositorio dependia de alguem LEMBRAR de dizer, no prompt:
 * "rode npm test", "confira que o hero nao mudou", "confira que o cron nao mudou". Memoria de
 * prompt nao e controle de engenharia — ela falha exatamente na mudanca que parecia nao ter
 * relacao, e os DOIS defeitos achados na auditoria de julho/2026 estavam justamente em codigo
 * que parecia nao ter relacao com o que estava sendo mexido.
 *
 * Este modulo e a parte compartilhada: carregar os registros, casar caminhos, resolver a base de
 * comparacao no git e ler um arquivo num commit anterior. Os tres consumidores
 * (classify.mjs, audit_safety_contract.mjs, check.mjs) usam daqui para nao divergirem — duas
 * implementacoes do mesmo casamento de caminho e a mesma classe de defeito que o contrato
 * existe para pegar.
 *
 * Hermetico por construcao: le o repositorio e chama `git`. Nenhuma rede, nenhum Supabase,
 * nenhuma credencial, nenhum e-mail.
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SURFACES_PATH = join(ROOT, "bolao/shared/safety/critical_surfaces.json");
export const WORKFLOWS_PATH = join(ROOT, "bolao/shared/safety/notification_workflows.json");
export const INTENT_PATH = join(ROOT, "CHANGE_INTENT.json");

export const POLICIES = new Set(["DECLARE_TO_CHANGE", "APPEND_ONLY", "STRUCTURALLY_ENFORCED"]);

// ── registries ────────────────────────────────────────────────────────────────────────────────

export function loadSurfaces() {
  const raw = JSON.parse(readFileSync(SURFACES_PATH, "utf8"));
  if (raw.schemaVersion !== 1) throw new Error(`critical_surfaces.json: schemaVersion ${raw.schemaVersion} desconhecida`);
  return raw;
}

export function loadWorkflows() {
  const raw = JSON.parse(readFileSync(WORKFLOWS_PATH, "utf8"));
  if (raw.schemaVersion !== 1) throw new Error(`notification_workflows.json: schemaVersion ${raw.schemaVersion} desconhecida`);
  return raw;
}

/**
 * CHANGE_INTENT.json e OPCIONAL por design. Uma mudanca comum nao declara nada, e a ausencia do
 * arquivo nao e erro — e o estado normal. Exigir o arquivo sempre transformaria a declaracao em
 * carimbo, e um carimbo nao protege coisa nenhuma.
 */
export function loadIntent() {
  if (!existsSync(INTENT_PATH)) return { declarations: [] };
  const raw = JSON.parse(readFileSync(INTENT_PATH, "utf8"));
  return { declarations: raw.declarations || [] };
}

// ── casamento de caminho ──────────────────────────────────────────────────────────────────────

/**
 * Glob deliberadamente pequeno: `**` (qualquer profundidade), `*` (um segmento). Nada mais.
 * Um motor de glob completo aqui seria superficie nova para um bug num arquivo cujo trabalho e
 * justamente ser confiavel.
 */
export function globToRegex(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") { out += ".*"; i++; if (pattern[i + 1] === "/") i++; }
      else out += "[^/]*";
    } else if (".+?^${}()|[]\\".includes(c)) out += "\\" + c;
    else out += c;
  }
  return new RegExp(out + "$");
}

export function pathMatches(path, patterns) {
  return (patterns || []).some((p) => globToRegex(p).test(path));
}

/** Superficies cujos `paths` casam com o arquivo dado. */
export function surfacesForPath(path, surfaces) {
  return surfaces.filter((s) => pathMatches(path, s.paths));
}

// ── git ───────────────────────────────────────────────────────────────────────────────────────

export function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...opts }).trim();
}

export function gitOrNull(args) {
  try { return git(args, { stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
}

/**
 * Base de comparacao. A escolha certa depende de ONDE a mudanca esta:
 *
 *   · SAFETY_BASE_SHA definido  -> respeitado sem discussao (CI de PR passa a base do PR)
 *   · HEAD != origin/main       -> merge-base: compara o RAMO com o tronco
 *   · HEAD == origin/main       -> HEAD~1: num push direto em main o tronco JA e a mudanca,
 *                                  e comparar com ele mesmo daria diff vazio — um falso verde
 *                                  exatamente no fluxo que o Eduardo mais usa.
 */
export function resolveBase() {
  if (process.env.SAFETY_BASE_SHA) {
    const sha = gitOrNull(["rev-parse", "--verify", process.env.SAFETY_BASE_SHA]);
    if (sha) return { sha, how: "SAFETY_BASE_SHA" };
  }
  const head = gitOrNull(["rev-parse", "HEAD"]);
  const origin = gitOrNull(["rev-parse", "--verify", "origin/main"]);
  if (origin && head && origin !== head) {
    const mb = gitOrNull(["merge-base", "HEAD", "origin/main"]);
    if (mb) return { sha: mb, how: "merge-base com origin/main" };
  }
  const parent = gitOrNull(["rev-parse", "--verify", "HEAD~1"]);
  if (parent) return { sha: parent, how: "HEAD~1 (push direto em main)" };
  return { sha: null, how: "sem base — repositorio sem historico anterior" };
}

/** Conteudo de um arquivo num commit. `null` quando o arquivo nao existia la. */
export function readAtRef(ref, path) {
  return gitOrNull(["show", `${ref}:${path}`]);
}

/**
 * Caminhos alterados = commits (base..HEAD) UNIAO arvore de trabalho (rastreados e nao).
 *
 * A uniao importa: rodar so o diff commitado deixaria a edicao ainda nao commitada — o estado em
 * que o desenvolvedor de fato esta quando roda `npm run check` — completamente invisivel.
 */
export function changedPaths(baseSha) {
  const set = new Set();
  const add = (out) => { if (out) out.split("\n").filter(Boolean).forEach((p) => set.add(p)); };
  if (baseSha) add(gitOrNull(["diff", "--name-only", `${baseSha}..HEAD`]));
  add(gitOrNull(["diff", "--name-only", "HEAD"]));
  add(gitOrNull(["diff", "--name-only", "--cached"]));
  add(gitOrNull(["ls-files", "--others", "--exclude-standard"]));
  return [...set].sort();
}

// ── cadeia npm / checks do verify ─────────────────────────────────────────────────────────────

/** Expande `npm test` seguindo os `npm run <x>` aninhados ate os comandos folha. */
export function npmTestChain(pkgJsonText) {
  const scripts = JSON.parse(pkgJsonText).scripts || {};
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const out = [];
    for (const tok of String(scripts[name] || "").split("&&")) {
      const t = tok.trim();
      if (!t) continue;
      const m = /^npm run ([\w:-]+)/.exec(t);
      if (m) out.push(...walk(m[1]));
      else out.push(t);
    }
    return out;
  };
  return walk("test");
}

/** Arquivos de gate invocados pela cadeia do `npm test`. */
export function npmTestFiles(pkgJsonText) {
  const files = new Set();
  for (const cmd of npmTestChain(pkgJsonText)) {
    const m = /(?:^|\s)(?:node|python3)\s+(\S+)/.exec(cmd);
    if (m) files.add(m[1]);
  }
  return files;
}

/** Ids e arquivos declarados em scripts/verify.mjs, lidos do TEXTO (nao importados). */
export function verifyChecks(verifyText) {
  const ids = new Set(), files = new Set();
  const re = /\{\s*id:\s*"([^"]+)"[\s\S]{0,400}?cmd:\s*\[\s*"(?:node|python3)",\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(verifyText))) { ids.add(m[1]); files.add(m[2]); }
  return { ids, files };
}

// ── contagem de assercoes ─────────────────────────────────────────────────────────────────────

/**
 * Conta os PONTOS DE ASSERCAO escritos num arquivo de gate, estaticamente.
 *
 * Nao e a contagem em tempo de execucao (que depende de laco e de dado) e nao tenta ser. Serve a
 * uma pergunta so: este gate passou a afirmar MENOS do que afirmava antes? Um patch que deixa o
 * arquivo no lugar, mantem o nome e apaga metade das verificacoes e invisivel em qualquer outra
 * medida — a suite continua "passando", so que provando menos.
 */
export function assertionCount(text) {
  if (!text) return 0;
  const pats = [
    /\btest\s*\(/g, /\bit\s*\(/g, /\bassert\w*\s*\(/g, /\bcheck\s*\(/g,
    /\bexpect\s*\(/g, /\bdef test_/g, /\bself\.assert\w+\s*\(/g, /\bok\s*\(/g,
  ];
  return pats.reduce((n, p) => n + (text.match(p) || []).length, 0);
}

/** Marcadores de teste desligado. Um skip novo e um gate removido com outro nome. */
export function skipMarkers(text) {
  if (!text) return 0;
  const pats = [
    /\b(?:test|it|describe)\.skip\b/g, /\bxit\s*\(/g, /\bxdescribe\s*\(/g,
    /@unittest\.skip/g, /\bpytest\.mark\.skip/g, /\bskipIf\b/g, /\bTODO_SKIP\b/g,
  ];
  return pats.reduce((n, p) => n + (text.match(p) || []).length, 0);
}
