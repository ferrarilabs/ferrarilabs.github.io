/**
 * worktree_isolation.mjs — recuperacao de worktrees isoladas orfas (Issue #334).
 *
 * ─── O BURACO QUE ISTO FECHA ────────────────────────────────────────────────────────────────
 *
 * As suites que mutam arquivos passaram a trabalhar em worktrees git descartaveis, nomeadas com o
 * PID do processo. A limpeza cobre o caminho feliz, a excecao e o Ctrl-C.
 *
 * Nao cobre `SIGKILL`, que nao e interceptavel — e ai o nome com PID vira um problema silencioso:
 * a execucao seguinte tem outro PID, nao colide com a sobra, nao reclama, e a worktree orfa fica no
 * disco para sempre. Um vazamento que ninguem ve e um vazamento que cresce.
 *
 * Entao a recuperacao e ATIVA: antes de comecar, cada suite varre as worktrees da propria familia e
 * remove as que pertencem a processos que nao existem mais. `process.kill(pid, 0)` nao envia sinal
 * nenhum — so pergunta se o processo existe — entao uma execucao concorrente e legitima jamais e
 * removida por engano.
 *
 * A arvore CANONICA nunca e tocada aqui: so caminhos que casam exatamente com o padrao da familia.
 */

import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

/** `.ferrarilabs-<familia>-<pid>-<rotulo>` — o PID no meio e o que torna a recuperacao possivel. */
export const padraoDaFamilia = (familia) => new RegExp(`^\\.ferrarilabs-${familia}-(\\d+)-`);

function processoVivo(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }   // EPERM = existe, mas nao e nosso: vivo.
}

/**
 * Remove worktrees da `familia` cujo processo dono morreu. Devolve os caminhos removidos.
 *
 * Best-effort por desenho: se a remocao falhar (permissao, disco), a suite ainda roda — ela so nao
 * pode SILENCIAR o problema, e por isso os caminhos voltam para quem chamou reportar.
 */
export function limparOrfas(familia, root) {
  const padrao = padraoDaFamilia(familia);
  const lista = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout || "";
  const removidas = [];

  for (const linha of lista.split("\n")) {
    if (!linha.startsWith("worktree ")) continue;
    const caminho = linha.slice("worktree ".length).trim();
    const m = padrao.exec(basename(caminho));
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid || processoVivo(pid)) continue;   // execucao concorrente legitima

    spawnSync("git", ["worktree", "remove", "--force", caminho], { cwd: root, encoding: "utf8" });
    if (existsSync(caminho)) { try { rmSync(caminho, { recursive: true, force: true }); } catch { /* best-effort */ } }
    removidas.push(caminho);
  }

  if (removidas.length) spawnSync("git", ["worktree", "prune"], { cwd: root, encoding: "utf8" });
  return removidas;
}
