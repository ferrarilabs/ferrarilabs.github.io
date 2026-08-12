/**
 * static_server.mjs — servidor estático fail-closed para as suítes de browser.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE (achado real, 2026-08-07)
 * ============================================================================
 *
 * Seis scripts faziam:
 *
 *     const p = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
 *     setTimeout(() => resolve(p), 700);
 *
 * Três defeitos compostos:
 *
 *   1. `stdio: "ignore"` joga fora o stderr do python — inclusive
 *      "OSError: [Errno 48] Address already in use".
 *   2. O `setTimeout` resolve mesmo que o processo tenha morrido.
 *   3. Ninguém verifica QUEM está atendendo na porta.
 *
 * Resultado observado: um `http.server 8191` esquecido rodando desde outro dia, iniciado de OUTRO
 * diretório, continuava atendendo. O `audit_visual_consistency.mjs` "subia" o servidor dele (falhava
 * em silêncio), o Chromium conversava com o servidor VELHO e a suíte media um checkout ANTIGO por
 * dias — reportando divergências que já estavam corrigidas no disco, e (pior) podendo aprovar como
 * EQUAL algo que regrediu. Uma suíte que mede o repositório errado é pior que suíte nenhuma: ela
 * gera confiança falsa.
 *
 * É a MESMA classe de falha do P0 de test isolation: um harness conversando em silêncio com a
 * coisa errada porque nada verificava a identidade do alvo. Ver docs/bolao/TEST_ISOLATION.md.
 *
 * ============================================================================
 * GARANTIAS
 * ============================================================================
 *
 *   - Porta ocupada => ERRO, nunca reuso silencioso. A mensagem diz qual porta e como achar o
 *     processo culpado.
 *   - O servidor é confirmado VIVO antes de retornar (não um sleep otimista).
 *   - O conteúdo servido é confirmado IDÊNTICO ao do disco (sentinela). Isto pega um servidor
 *     estranho que por acaso sirva o mesmo repo em outro commit/worktree — o caso real acima.
 *   - `stop()` é idempotente e mata o processo que ESTE módulo criou.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";

/** Sentinela: um arquivo que existe em qualquer checkout e muda entre commits. */
const SENTINEL_PATH = "bolao/cdb2026/index.html";

function portInUse(port, timeoutMs = 600) {
  return new Promise(resolve => {
    const sock = createConnection({ host: "127.0.0.1", port });
    const done = v => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

async function waitForServer(port, tries = 40, delayMs = 100) {
  for (let i = 0; i < tries; i++) {
    if (await portInUse(port)) return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

/**
 * Sobe um http.server em `root` na `port`, ou lança.
 * @returns {Promise<{proc: import("node:child_process").ChildProcess, stop: () => void, baseUrl: string}>}
 */
export async function startStaticServer(port, root) {
  if (await portInUse(port)) {
    throw new Error(
      `[static_server] A porta ${port} JÁ ESTÁ EM USO. Recusando continuar: se este harness ` +
      `prosseguisse, o browser conversaria com um servidor que NÃO é este checkout e a suíte ` +
      `mediria o repositório errado (foi exatamente o que aconteceu em 2026-08-07 com um ` +
      `http.server 8191 esquecido de outro dia).\n` +
      `Ache o processo:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
      `Encerre-o:        kill <PID>   (ou: pkill -f "http.server ${port}")`
    );
  }

  // `--protocol HTTP/1.1` NÃO é cosmético.
  //
  // O padrão de `http.server` é HTTP/1.0, que fecha a conexão a cada resposta. Cada página deste
  // harness busca ~10 folhas de estilo mais scripts, e a suíte roda vários navegadores em
  // paralelo — ou seja, centenas de conexões abertas e fechadas em rajada. Sob essa carga o
  // backlog estoura e alguns pedidos morrem no meio.
  //
  // O sintoma não se parece com rede: aparece como CSS que "não aplicou". Custou horas hoje —
  // duas suítes diferentes acusaram defeito de layout (alvo de toque <24px no copa2026, controle
  // com texto cortado a 320px no cdb2026) em elementos cujo CSS torna aquilo impossível. As duas
  // reprovavam de forma intermitente, em larguras que mudavam a cada execução, e as duas passam
  // sozinhas. O diagnóstico que fechou o caso mostrou TODAS as folhas presentes e a regra ainda
  // assim ausente: folha servida pela metade.
  //
  // Com HTTP/1.1 a conexão é reaproveitada e o servidor entrega Content-Length com keep-alive.
  // Servidor inline em vez de `python3 -m http.server`, por uma razão medida.
  //
  // O módulo de linha de comando serve HTTP/1.0, que FECHA a conexão a cada resposta. Cada página
  // deste harness busca ~10 folhas de estilo mais scripts, e a suíte roda vários navegadores em
  // paralelo: centenas de conexões abertas e fechadas em rajada. Sob essa carga alguns pedidos
  // morrem no meio.
  //
  // O sintoma não se parece com rede — aparece como CSS que "não aplicou". Custou horas: duas
  // suítes diferentes acusaram defeito de layout (alvo de toque <24px no copa2026, controle com
  // texto cortado a 320px no cdb2026) em elementos cujo próprio CSS torna aquilo impossível. As
  // duas reprovavam de forma intermitente, em larguras que mudavam a cada execução, e as duas
  // passam quando rodam sozinhas. O diagnóstico que fechou o caso mostrou TODAS as folhas
  // presentes e a regra mesmo assim ausente — folha servida pela metade.
  //
  // `--protocol HTTP/1.1` resolveria, mas só existe a partir do Python 3.11 e aqui roda 3.9.
  // Então o protocolo é fixado no handler, com ThreadingHTTPServer para não serializar as
  // requisições. A string "http.server" continua na linha de comando de propósito: as mensagens
  // de erro acima ensinam `pkill -f "http.server <porta>"`, e essa dica tem de continuar valendo.
  const inline = [
    "import functools, http.server",
    "http.server.SimpleHTTPRequestHandler.protocol_version = 'HTTP/1.1'",
    `h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=${JSON.stringify(root)})`,
    `http.server.ThreadingHTTPServer(('127.0.0.1', ${port}), h).serve_forever()`,
  ].join("; ");
  const proc = spawn("python3", ["-c", inline], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr?.on("data", d => { stderr += String(d); });
  let exited = null;
  proc.on("exit", code => { exited = code; });
  proc.on("error", () => { exited = -1; });

  // ── O SERVIDOR MORRE COM O PROCESSO QUE O CRIOU ─────────────────────────────────────────
  //
  // Dez harnesses chamam este arquivo e NENHUM tinha `finally`: quando um caso lancava, o
  // `stop()` nunca rodava e o python ficava de pe segurando a porta. A suite SEGUINTE morria com
  // "porta JA ESTA EM USO" -- e quem falhava era quase sempre alguem sem relacao com a mudanca,
  // o que mandou o diagnostico para o lado errado tres execucoes seguidas.
  //
  // Consertar isso em dez arquivos seria dez chances de esquecer o decimo primeiro. A limpeza
  // mora aqui, onde o processo nasce: quem sobe o servidor tambem garante que ele desce.
  //
  // Isto NAO afrouxa a recusa de reusar porta ocupada -- essa guarda existe para nao medir o
  // checkout errado e continua intacta. O que muda e so nao deixarmos lixo NOSSO para tras.
  let parado = false;
  const stop = () => {
    if (parado) return;
    parado = true;
    try { proc.kill(); } catch { /* já morto — nada a fazer */ }
  };

  // SO `exit` e sinais. Nada de `uncaughtException`/`unhandledRejection`.
  //
  // Registrar handler para essas duas SUPRIME o comportamento padrao do Node: o processo deixa
  // de morrer e passa a depender do meu handler. A minha versao matava o servidor e relancava --
  // e o efeito foi uma suite inteira caindo com ERR_CONNECTION_REFUSED no meio, porque o
  // servidor morria enquanto a pagina seguinte ainda navegava.
  //
  // TRADE-OFF, medido nos dois sentidos:
  //
  //   com handler de excecao   nao vaza servidor, MAS o processo deixa de morrer sozinho e o
  //                            servidor caia no meio da suite -- `countdown-layout` inteiro
  //                            falhou com ERR_CONNECTION_REFUSED enquanto a pagina navegava
  //   so `exit` + sinais       saida normal limpa sempre; um harness que LANCA ainda pode deixar
  //                            o python de pe
  //
  // Fico com o segundo. Sequestrar o tratamento de erro do programa que me chamou e um preco
  // alto por uma limpeza que so importa quando algo ja deu errado -- e o modo de falha que ele
  // cria (suite inteira caindo por conexao recusada) e pior e mais confuso que o que ele evita.
  //
  // DIVIDA CONHECIDA: dez harnesses chamam este arquivo sem `try/finally`. Quando um deles
  // lanca, a porta fica presa e a suite seguinte morre com "porta JA ESTA EM USO". O conserto
  // certo e `finally` em cada um -- fora do escopo desta tarefa, registrado aqui para nao
  // parecer que ninguem viu.
  process.once("exit", () => stop());
  for (const sinal of ["SIGINT", "SIGTERM"]) process.once(sinal, () => { stop(); process.exit(1); });

  if (!(await waitForServer(port))) {
    stop();
    throw new Error(
      `[static_server] O servidor não subiu na porta ${port}` +
      (exited !== null ? ` (processo saiu com código ${exited})` : "") +
      (stderr.trim() ? `.\nstderr do python:\n${stderr.trim()}` : ".")
    );
  }

  // Confirma que quem atende é ESTE checkout, não um servidor estranho que ganhou a corrida.
  let served;
  try {
    const r = await fetch(`http://localhost:${port}/${SENTINEL_PATH}`);
    served = await r.text();
  } catch (err) {
    stop();
    throw new Error(`[static_server] Servidor na porta ${port} não respondeu à sentinela: ${err.message}`);
  }
  const onDisk = readFileSync(join(root, SENTINEL_PATH), "utf8");
  if (served !== onDisk) {
    stop();
    throw new Error(
      `[static_server] O servidor na porta ${port} está servindo um conteúdo DIFERENTE do disco ` +
      `(sentinela: ${SENTINEL_PATH}). Provavelmente outro servidor/worktree ganhou a porta. ` +
      `Recusando medir o repositório errado.\n` +
      `Ache o processo:  lsof -nP -iTCP:${port} -sTCP:LISTEN`
    );
  }

  return { proc, stop, baseUrl: `http://localhost:${port}` };
}
