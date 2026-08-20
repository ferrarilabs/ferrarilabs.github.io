#!/usr/bin/env node
// GUARDA DA ÁRVORE CANÔNICA — Issue #251.
//
// ─── O QUE ACONTECEU ────────────────────────────────────────────────────────────────────────
//
// Em 2026-08-20, durante uma execução autônoma, o orquestrador rodou
// `git checkout --detach origin/main` DENTRO da árvore canônica de trabalho — a mesma que outras
// sessões usam — tirando-a do branch em que ela estava. Nada se perdeu (a árvore estava limpa e
// nenhum arquivo foi editado) e ela foi restaurada ao estado exato. Mas a árvore canônica é
// compartilhada, e o modo de falha se ela NÃO estivesse limpa é real.
//
// A regra ("todo trabalho de implementação acontece em worktree dedicada") já existia e era
// conhecida. Ela foi violada mesmo assim, por um comando dentro de uma linha composta. Regra que
// só vive em prosa é intenção, não proteção — é o mesmo raciocínio que produziu o safety_check.yml.
//
// ─── A DECISÃO DO EDUARDO (Issue #251) ──────────────────────────────────────────────────────
//
// Proteger contra mutação de AGENTE/AUTOMAÇÃO apenas. NÃO impedir o dono do repositório de
// trabalhar na árvore canônica de propósito. Um portão que briga com quem manda no repositório é
// desativado com `--no-verify` na primeira semana, e aí não protege mais nada.
//
// ─── COMO A ÁRVORE CANÔNICA É IDENTIFICADA ──────────────────────────────────────────────────
//
// Não por caminho fixo. Um caminho hardcoded (`~/Documents/GitHub/ferrarilabs.github.io`) só vale
// numa máquina, e falharia em silêncio — verde — em qualquer outra. A pergunta real é
// estrutural: "esta é a worktree PRINCIPAL do repositório?".
//
//   worktree principal → `git rev-parse --git-dir` === `--git-common-dir`
//   worktree vinculada → git-dir aponta para `<comum>/.git/worktrees/<nome>`
//
// Portátil, determinístico, e continua correto se o repositório for clonado noutro lugar.
//
// ─── O QUE ESTA GUARDA NÃO CONSEGUE FAZER ───────────────────────────────────────────────────
//
// O git oferece ganchos para commit, merge-commit, rebase e push — e é isso que ela cobre.
// NÃO existe gancho `pre-checkout`: `git checkout`, `switch`, `reset`, `clean` e `stash` não
// podem ser interceptados. Ou seja, o comando EXATO que originou a #251 não é bloqueável por
// gancho nenhum. Dizer o contrário seria vender uma proteção que não existe.
//
// O que a guarda faz é impedir o dano PIOR — automação commitando, mesclando, rebaseando ou
// empurrando a partir da árvore canônica — e ficar disponível como asserção explícita
// (`assertSafeToMutate()`) para qualquer script orquestrado chamar antes de mutar.
//
// Uso:
//   node scripts/safety/canonical_tree_guard.mjs --assert [rótulo-da-operação]
//   node scripts/safety/canonical_tree_guard.mjs --explain

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

/** Variável de escape explícita e deliberada. Existe para ser vista no comando, nunca no ambiente. */
export const BYPASS_ENV = "ALLOW_CANONICAL_TREE_WRITE";

/** Marcadores de sessão de agente. Presentes só quando um agente está conduzindo o shell. */
const AGENT_MARKERS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID"];

/**
 * Marcadores de CI. NÃO são "automação" para efeito desta guarda, e isso é deliberado:
 * `bolao_provider_snapshot.yml` COMMITA de verdade a partir de um runner, e o checkout de CI é,
 * estruturalmente, uma worktree principal. Uma guarda que não abrisse esta exceção quebraria a
 * automação de produção que atualiza o snapshot da ESPN — trocar um incidente por outro.
 */
const CI_MARKERS = ["CI", "GITHUB_ACTIONS"];

const truthy = (v) => typeof v === "string" && v !== "" && v !== "0" && v.toLowerCase() !== "false";

export function isAgentSession(env = process.env) {
  return AGENT_MARKERS.some((k) => truthy(env[k]));
}

export function isCi(env = process.env) {
  return CI_MARKERS.some((k) => truthy(env[k]));
}

/** `true` quando o diretório é a worktree PRINCIPAL. Estrutural, não por caminho. */
export function isMainWorktree(cwd = process.cwd()) {
  try {
    // stderr silenciado: fora de um repositório o git escreve "not a git repository", e esse é um
    // caminho ESPERADO aqui (falha aberto logo abaixo). Deixar o ruído sair confundiria o log de CI.
    const at = (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const gitDir = at(["rev-parse", "--absolute-git-dir"]);
    const commonDir = at(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    return realpathSync(gitDir) === realpathSync(commonDir);
  } catch {
    // Fora de um repositório git não há árvore canônica a proteger. Falhar ABERTO aqui é correto:
    // esta guarda existe para um caso específico, não para bloquear o que não entende.
    return false;
  }
}

/**
 * A decisão, pura e testável. Recebe tudo por parâmetro para que o teste possa exercitar a matriz
 * inteira sem depender do ambiente real da máquina em que roda.
 */
export function decide({ mainWorktree, agent, ci, bypass }) {
  if (!mainWorktree) return { blocked: false, reason: "worktree vinculada — é exatamente onde o trabalho automatizado deve acontecer" };
  if (!agent) return { blocked: false, reason: "sem marcador de sessão de agente — trabalho humano na árvore canônica é permitido de propósito (decisão da Issue #251)" };
  if (ci) return { blocked: false, reason: "runner de CI — o checkout é uma worktree principal por construção, e workflows commitam legitimamente" };
  if (bypass) return { blocked: false, reason: `escape explícito via ${BYPASS_ENV}` };
  return {
    blocked: true,
    reason: "sessão de agente tentando mutar a árvore canônica — use uma worktree dedicada (git worktree add)",
  };
}

/** Avalia contra o ambiente real. */
export function evaluate({ cwd = process.cwd(), env = process.env } = {}) {
  return decide({
    mainWorktree: isMainWorktree(cwd),
    agent: isAgentSession(env),
    ci: isCi(env),
    bypass: truthy(env[BYPASS_ENV]),
  });
}

/** Lança quando a mutação não é permitida. Para scripts orquestrados chamarem antes de mutar. */
export function assertSafeToMutate(operation = "mutação", opts = {}) {
  const v = evaluate(opts);
  if (v.blocked) {
    const err = new Error(
      `BLOQUEADO: ${operation} na árvore canônica a partir de uma sessão de agente.\n` +
      `  ${v.reason}\n\n` +
      `  A árvore principal é compartilhada com outras sessões. Trabalho automatizado vai para uma\n` +
      `  worktree própria:\n\n` +
      `      git worktree add ../ferrarilabs-auto-issue-<N> -b auto/issue-<N>-<slug> origin/main\n\n` +
      `  Se esta operação for mesmo deliberada e manual, torne isso explícito no comando:\n` +
      `      ${BYPASS_ENV}=1 <comando>\n`,
    );
    err.code = "CANONICAL_TREE_GUARD";
    throw err;
  }
  return v;
}

function main(argv) {
  if (argv.includes("--explain")) {
    const v = evaluate();
    console.log(JSON.stringify({
      mainWorktree: isMainWorktree(), agent: isAgentSession(), ci: isCi(),
      bypass: truthy(process.env[BYPASS_ENV]), ...v,
    }, null, 2));
    return 0;
  }
  if (argv.includes("--assert")) {
    const label = argv[argv.indexOf("--assert") + 1] && !argv[argv.indexOf("--assert") + 1].startsWith("--")
      ? argv[argv.indexOf("--assert") + 1] : "mutação";
    try { assertSafeToMutate(label); }
    catch (e) { console.error(`\n${e.message}`); return 1; }
    return 0;
  }
  console.error("uso: canonical_tree_guard.mjs --assert [rótulo] | --explain");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
