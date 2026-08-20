#!/usr/bin/env node
// PALAVRA-CHAVE DE FECHAMENTO DENTRO DE UMA NEGAÇÃO — Issue #250.
//
// ─── O DEFEITO QUE ORIGINOU ESTE GATE ────────────────────────────────────────────────────────
//
// Em 2026-08-20 o commit `3556dbce` trazia, de propósito, esta linha:
//
//     "Does NOT fix #246: ESPN still returns 403 and live data is still unavailable"
//
// A frase existia JUSTAMENTE para impedir que a Issue #246 fosse tomada como resolvida. O parser
// do GitHub casou a subcadeia `fix #246`, ignorou a negação — ele é puramente lexical — e FECHOU
// a #246 no merge. Uma Issue de incidente de produção ficou marcada como resolvida sem ninguém
// ter decidido isso, e só voltou porque alguém reparou na ausência dela numa listagem.
//
// O detalhe que torna isto um portão, e não um conselho: a redação que dispara o problema é
// exatamente a que um autor cuidadoso escolhe quando quer deixar claro que algo NÃO terminou. A
// forma segura ("Issue #246 remains unresolved") é menos natural. Confiar em disciplina aqui é
// esperar que a próxima pessoa lembre de uma regra que a linguagem empurra contra.
//
// Mesma família de `audit_commit_message_pii.mjs` (#224): um risco léxico na prosa de commit que
// nenhum humano confere de forma confiável.
//
// ─── ESCOPO ─────────────────────────────────────────────────────────────────────────────────
//
// Forward-only, igual ao gate de PII: varre só os commits NOVOS desde a mesma base que os demais
// gates do contrato usam (`resolveBase()`). Nunca percorre a história inteira — reescrever o
// passado é outra decisão, com outra autorização.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────────────────────
//
// Não reprova `Closes #N` legítimo — fechar automaticamente é um recurso útil e intencional.
// Só reprova quando a MESMA frase nega o verbo que o GitHub vai obedecer mesmo assim.
//
// Uso: node scripts/audit_commit_message_closure_keywords.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolveBase } from "./safety/surfaces.mjs";

/** Exatamente as palavras que o GitHub obedece. Nada de sinônimos "parecidos". */
const CLOSING_KEYWORDS = [
  "close", "closes", "closed",
  "fix", "fixes", "fixed",
  "resolve", "resolves", "resolved",
];

/**
 * Negações em inglês e português — este repositório escreve commits nos dois idiomas, e o parser
 * do GitHub é indiferente ao idioma da negação: ele nem a enxerga.
 */
const NEGATIONS = [
  "not", "no", "never", "without", "nor", "neither", "cannot",
  "nao", "não", "nem", "sem", "nunca",
];

/** Distância máxima, em palavras, entre a negação e a palavra-chave. */
const NEGATION_WINDOW = 4;

/**
 * Referência que o GitHub aceita logo depois da palavra-chave: `#123` ou `owner/repo#123`.
 * A palavra-chave precisa vir COLADA na referência (só espaço entre elas) — é assim que o
 * GitHub fecha. `fix the bug described in #246` não fecha nada, e portanto não é achado aqui.
 */
const REFERENCE = String.raw`(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+`;

const KEYWORD_REF_RE = new RegExp(
  String.raw`\b(${CLOSING_KEYWORDS.join("|")})\b\s*(${REFERENCE})`,
  "gi",
);

const isNegation = (word) => {
  const w = word.toLowerCase().replace(/[^a-zà-ÿ']/g, "");
  if (NEGATIONS.includes(w)) return true;
  // Contrações: doesn't, don't, didn't, won't, isn't, can't, couldn't...
  return /n['’]t$/.test(w);
};

/**
 * Núcleo testável e puro: acha palavra-chave de fechamento sob negação num texto.
 *
 * Fronteira de FRASE importa e é o que segura a precisão. "This is not a refactor. Fixes #248."
 * é uma redação perfeitamente correta: a negação pertence à frase anterior e o `Fixes` é
 * deliberado. Por isso a varredura quebra em `.`, `;`, `!`, `?` e quebra de linha antes de olhar
 * para trás — sem isso, o gate reprovaria commits bem escritos e seria desligado em uma semana.
 */
export function findNegatedClosures(text) {
  const findings = [];
  if (!text) return findings;

  // A quebra de frase exige PONTUAÇÃO SEGUIDA DE ESPAÇO (ou fim), nunca o caractere sozinho.
  // Quebrar em qualquer `.` partia `ferrarilabs.github.io#42` no meio e o gate deixava passar a
  // forma `owner/repo#N` — que o GitHub fecha exatamente igual. Achado pela própria suíte.
  for (const segment of String(text).split(/(?<=[.;!?])\s+|[\r\n]+/)) {
    KEYWORD_REF_RE.lastIndex = 0;
    let m;
    while ((m = KEYWORD_REF_RE.exec(segment)) !== null) {
      const before = segment.slice(0, m.index).trim();
      const words = before ? before.split(/\s+/) : [];
      const window = words.slice(-NEGATION_WINDOW);
      const negation = window.find(isNegation);
      if (!negation) continue;
      findings.push({
        keyword: m[1],
        reference: m[2],
        negation,
        // Trecho curto e já contido no próprio commit — não há dado sensível a mascarar aqui.
        excerpt: `${window.join(" ")} ${m[0]}`.trim().slice(0, 120),
      });
    }
  }
  return findings;
}

function newCommitShas(baseSha, headRef, cwd) {
  const out = execFileSync("git", ["log", `${baseSha}..${headRef}`, "--format=%H"], { cwd, encoding: "utf8" }).trim();
  return out ? out.split("\n") : [];
}

function commitMessage(sha, cwd) {
  return execFileSync("git", ["log", "-1", "--format=%B", sha], { cwd, encoding: "utf8" });
}

/**
 * Base e cwd explícitos (em vez de chamar `resolveBase()` aqui dentro) para que o teste possa
 * apontar isto a um repositório temporário — `resolveBase()` é amarrado à raiz real deste repo.
 * Mesmo motivo pelo qual `scanCommitRange()` existe separada em audit_commit_message_pii.mjs.
 */
export function scanCommitRange(baseSha, { headRef = "HEAD", cwd = process.cwd() } = {}) {
  const commits = newCommitShas(baseSha, headRef, cwd);
  const findings = [];
  for (const sha of commits) {
    for (const f of findNegatedClosures(commitMessage(sha, cwd))) {
      findings.push({ sha: sha.slice(0, 10), ...f });
    }
  }
  return { commits, findings };
}

function main() {
  const { sha: baseSha, how } = resolveBase();
  if (!baseSha) {
    console.log("✓ Nenhuma base anterior — nada novo a varrer.");
    process.exit(0);
  }

  const { commits, findings } = scanCommitRange(baseSha);

  if (findings.length === 0) {
    console.log(`✓ Closure-keyword audit passou — ${commits.length} mensagem(ns) nova(s) desde ${how}, 0 achados.`);
    process.exit(0);
  }

  console.error("❌ PALAVRA-CHAVE DE FECHAMENTO SOB NEGAÇÃO\n");
  for (const f of findings) {
    console.error(`  - ${f.sha} | "${f.negation} ... ${f.keyword} ${f.reference}" | ${f.excerpt}`);
  }
  console.error(
    `\n${findings.length} achado(s) em ${commits.length} mensagem(ns) nova(s) desde ${how}.\n` +
    "O GitHub obedece a palavra-chave e IGNORA a negação: escrito assim, este commit FECHA a Issue\n" +
    "que ele diz não fechar (foi o que aconteceu com a #246 — ver Issue #250).\n\n" +
    "Reescreva com o substantivo na frente, sem a palavra-chave colada na referência:\n" +
    "  ✗ \"does not fix #246\"      ✓ \"Issue #246 remains unresolved\"\n" +
    "  ✗ \"doesn't close #246\"     ✓ \"Related to #246; the incident is still open\"\n" +
    "Use Closes/Fixes/Resolves #N somente quando o fechamento automático for mesmo desejado.",
  );
  process.exit(1);
}

// Só varre quando executado diretamente — importar este módulo (do teste) não pode disparar o
// scan. Mesmo invariante de audit_commit_message_pii.mjs e audit_pii_repo_wide.mjs.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main();
}
