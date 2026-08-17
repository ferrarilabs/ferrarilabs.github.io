/**
 * UMA SÓ VERDADE DE DINHEIRO CORRENTE — teste de comportamento sobre o DOM real.
 *
 * ═══ O DEFEITO QUE ISTO FECHA ═══════════════════════════════════════════════════════════════
 *
 * Depois da liquidação do sorteio de 12/08 a página mostrava, lado a lado:
 *
 *     Guardado p/ próximo sorteio   $1     (Resumo financeiro, do data.js)
 *     Saldo disponível              $39    (painel do livro-razão)
 *
 * Os dois números estavam CERTOS. O `finance` do data.js é um retrato de ANTES dos prêmios; o
 * livro-razão já contabilizou os $38. O problema não é aritmética — é que os dois rótulos
 * afirmam a mesma coisa, "quanto temos agora", com valores diferentes. Ambiguidade sobre
 * dinheiro de dezesseis pessoas custa uma pergunta que ninguém deveria precisar fazer.
 *
 * ═══ POR QUE ISTO ABRE UM NAVEGADOR ═════════════════════════════════════════════════════════
 *
 * A regra é sobre o que a pessoa VÊ. Um teste que chamasse as funções de render e conferisse o
 * retorno provaria que as funções retornam; não provaria que a tela não tem dois saldos. Então
 * ele carrega a página real, com o data.js real, e conta elementos no DOM.
 *
 * O invariante é ESTRUTURAL: exatamente um elemento com `data-current-balance`. Mas um rótulo
 * novo poderia voltar a afirmar "saldo atual" sem o marcador, então o teste também varre os
 * rótulos visíveis atrás de linguagem de saldo corrente. As duas medidas juntas são o portão.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_current_balance_unicity.mjs
 */

import { startStaticServer } from "../../../scripts/static_server.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
// 8214, nao 8213: `bolao/scripts/audit_countdown_layout.mjs` ja declarava 8213 desde 09/08, e
// esta suite chegou em 13/08 com o mesmo numero. O `static_server` recusa reusar porta ocupada
// (de proposito), entao a SEGUNDA a rodar morria com "porta JA ESTA EM USO" — e quem falhava era
// uma suite sem relacao nenhuma com a mudanca em curso. Quem chegou depois cede o numero.
const PORT = 8214;
const PAGINA = "/bolao/loterias/powerball/";

const falhas = [];
function checa(nome, cond, detalhe = "") {
  console.log(`  [${cond ? "PASS" : "FALHA"}] ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!cond) falhas.push(nome);
}

const pw = await import("playwright");
const server = await startStaticServer(PORT, ROOT);

/** Carrega a página e devolve os tiles de dinheiro que ela realmente renderizou. */
async function medir(rotas = {}) {
  const browser = await pw.chromium.launch();
  try {
    // `serviceWorkers: "block"`: a página registra um SW de cache-busting. Sem bloquear, ele
    // pode responder no lugar da rota interceptada e o teste mediria a versão em cache — uma
    // falha que se parece com "a mutação não fez efeito".
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();

    // HERMÉTICO: nada de rede de terceiro.
    //
    // Com o sorteio sem resultado, a página BUSCA o resultado no NY Open Data e grava um
    // override em localStorage — comportamento correto do app, e fatal para este teste: o
    // cenário "antes da liquidação" se liquidava sozinho no meio da medição, e o resultado
    // dependia de a rede estar de pé. Bloquear deixa o estado ser o que o teste declarou.
    await page.route(/data\.ny\.gov/, (route) => route.abort());

    for (const [caminho, corpo] of Object.entries(rotas)) {
      // Casa por PATHNAME, não por glob. Os scripts são carregados com `?v=<sha>` (cache-bust),
      // e um glob terminado em `.js` não casa a query — a interceptação silenciosamente não
      // acontecia e as três mutações "passavam" por não terem sido aplicadas.
      await page.route(
        (url) => url.pathname === caminho,
        (route) => route.fulfill({
          status: 200,
          contentType: caminho.endsWith(".json") ? "application/json" : "text/javascript",
          body: corpo,
        }));
    }
    await page.goto(`http://localhost:${PORT}${PAGINA}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    return await page.evaluate(() => {
      const ler = (el) => ({
        valor: el.querySelector(".v")?.textContent?.trim(),
        rotulo: el.querySelector(".l")?.textContent?.trim(),
        marcado: el.hasAttribute("data-current-balance"),
        fonte: el.getAttribute("data-current-balance"),
      });
      const visivel = (el) => {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
      };
      // Só o que está REALMENTE na tela. Um tile dentro de uma seção `hidden` não confunde
      // ninguém, e contá-lo produziria uma falha que o usuário nunca veria.
      const tiles = [...document.querySelectorAll(".pb-summary-item")]
        .filter(visivel).map(ler);
      return { tiles, marcados: tiles.filter((t) => t.marcado) };
    });
  } finally {
    await browser.close();
  }
}

// Linguagem que AFIRMA ser dinheiro de agora. "histórico"/"antes de" desarma a afirmação.
const DIZ_CORRENTE = /dispon[ií]vel|saldo|guardado p\//i;
const DIZ_HISTORICO = /hist[oó]rico|antes d/i;
const afirmamCorrente = (tiles) =>
  tiles.filter((t) => DIZ_CORRENTE.test(t.rotulo || "") && !DIZ_HISTORICO.test(t.rotulo || ""));

try {
  console.log("\nUNICIDADE DO SALDO CORRENTE\n");

  // ═══ 1. ESTADO REAL DE PRODUÇÃO — 2026-08-12 LIQUIDADO ══════════════════════════════════
  console.log("1. estado real: sorteio 2026-08-12 LIQUIDADO");
  const pos = await medir();

  checa("CURRENT_BALANCE_SOURCES = 1", pos.marcados.length === 1,
        JSON.stringify(pos.marcados.map((m) => `${m.fonte}:${m.rotulo}=${m.valor}`)));
  checa("POST_SETTLEMENT_CURRENT_BALANCE vem do livro-razão",
        pos.marcados[0]?.fonte === "ledger", String(pos.marcados[0]?.fonte));
  checa("VISIBLE_CURRENT_BALANCE = $39", pos.marcados[0]?.valor === "$39",
        String(pos.marcados[0]?.valor));
  checa("o rótulo do saldo corrente fala do PRÓXIMO BOLÃO",
        /pr[oó]ximo bol[aã]o/i.test(pos.marcados[0]?.rotulo || ""),
        String(pos.marcados[0]?.rotulo));

  const ganhos = pos.tiles.find((t) => /ganhos do [uú]ltimo sorteio/i.test(t.rotulo || ""));
  checa("LAST_DRAW_WINNINGS = $38", ganhos?.valor === "$38",
        `${ganhos?.rotulo} = ${ganhos?.valor}`);

  const legado = pos.tiles.filter((t) => t.valor === "$1");
  checa("LEGACY_$1_PRESENT: segue visível (explica de onde o dinheiro veio)",
        legado.length > 0, `${legado.length} tile(s)`);
  checa("POST_SETTLEMENT_LEGACY_CURRENT_BALANCE_VISIBLE = NO",
        legado.every((t) => DIZ_HISTORICO.test(t.rotulo || "")),
        legado.map((t) => t.rotulo).join(" | "));
  checa("nenhum tile de $1 se declara corrente", legado.every((t) => !t.marcado));
  checa('"Guardado p/ próximo sorteio" sumiu depois da liquidação',
        !pos.tiles.some((t) => /guardado p\/ pr[oó]ximo sorteio/i.test(t.rotulo || "")));

  const ambiguos = afirmamCorrente(pos.tiles);
  checa("CURRENT_MONEY_AMBIGUITY = 0", ambiguos.length === 1,
        ambiguos.map((t) => `${t.rotulo}=${t.valor}`).join(" | "));

  // ═══ 2. PRÉ-LIQUIDAÇÃO ══════════════════════════════════════════════════════════════════
  //
  // O data.js real não tem sorteio aberto — todos já têm resultado. A rota devolve a MESMA
  // página com o `result` do último removido, que é o estado em que ela viveu de 11/08 até a
  // madrugada de 13/08. Não é um fixture inventado: é o arquivo de produção menos um campo.
  console.log("\n2. antes da liquidação (sorteio corrente ainda sem resultado)");
  const dataJs = readFileSync(join(ROOT, "bolao/loterias/powerball/js/data.js"), "utf8");
  const marca = dataJs.lastIndexOf("    result: {");
  const fim = dataJs.indexOf("\n    },\n", marca) + "\n    },\n".length;
  if (marca < 0 || fim <= marca) throw new Error("formato do data.js mudou: não achei o result");
  const dataAberto = dataJs.slice(0, marca) + "    result: null,\n" + dataJs.slice(fim);

  const statusReal = JSON.parse(
    readFileSync(join(ROOT, "bolao/loterias/config/lottery_status.json"), "utf8"));
  const statusAberto = JSON.parse(JSON.stringify(statusReal));
  statusAberto.currentDraw.lifecycleState = "AWAITING_RESULT";

  const pre = await medir({
    "/bolao/loterias/powerball/js/data.js": dataAberto,
    "/bolao/loterias/config/lottery_status.json": JSON.stringify(statusAberto),
  });

  checa("CURRENT_BALANCE_SOURCES = 1", pre.marcados.length === 1,
        JSON.stringify(pre.marcados.map((m) => `${m.fonte}:${m.rotulo}=${m.valor}`)));
  checa("PRE_SETTLEMENT_BALANCE vem do sorteio em andamento",
        pre.marcados[0]?.fonte === "pre-settlement", String(pre.marcados[0]?.fonte));
  checa("PRE_SETTLEMENT_BALANCE = $1 (o que sobrou para bilhete)",
        pre.marcados[0]?.valor === "$1", String(pre.marcados[0]?.valor));
  checa("o painel do livro-razão NÃO exibe saldo concorrente antes da liquidação",
        !pre.tiles.some((t) => /saldo dispon[ií]vel para o pr[oó]ximo/i.test(t.rotulo || "")));
  // O valor de `valorGuardadoProximoSorteio` continua visível antes do resultado — ele diz
  // quanto se espera levar adiante. Mas como PROJEÇÃO, não como "já guardado": os prêmios ainda
  // não existem, e ao lado de "Disponível para tickets" (mesmo valor) dois rótulos soavam como
  // "o que temos agora". Rotular o momento é o que remove a ambiguidade sem esconder o número.
  const projecao = pre.tiles.find((t) => /pr[oó]ximo sorteio/i.test(t.rotulo || ""));
  checa("o valor pré-resultado segue visível, como PROJEÇÃO",
        !!projecao && /proje[cç][aã]o/i.test(projecao.rotulo || ""),
        String(projecao?.rotulo));
  checa("a projeção NÃO se declara saldo corrente", projecao && !projecao.marcado);
  checa("'Guardado p/ próximo sorteio' não aparece em nenhum dos dois estados",
        !pre.tiles.some((t) => /guardado p\/ pr[oó]ximo sorteio/i.test(t.rotulo || "")));
  checa("CURRENT_MONEY_AMBIGUITY = 0", afirmamCorrente(pre.tiles).length === 1,
        afirmamCorrente(pre.tiles).map((t) => `${t.rotulo}=${t.valor}`).join(" | "));

  // ═══ 3. MUTAÇÕES — cada uma tem de derrubar o portão ════════════════════════════════════
  //
  // Cada mutação é aplicada ao app.js REAL e recarregada no navegador. Mutar um array em
  // memória provaria que o array mudou; só mutando o código é que se prova que o portão
  // enxerga o defeito no produto.
  console.log("\n3. mutações (cada uma DEVE ficar VERMELHA)");
  const appJs = readFileSync(join(ROOT, "bolao/loterias/powerball/js/app.js"), "utf8");
  const rota = "/bolao/loterias/powerball/js/app.js";

  // (a) restaurar "Guardado p/ próximo sorteio: $1" depois da liquidação
  const mutA = appJs.replace(
    '"Saldo antes dos prêmios (histórico)", false]',
    '"Guardado p/ próximo sorteio", false]');
  if (mutA === appJs) throw new Error("mutação (a) não casou — o alvo mudou de forma");
  const ra = await medir({ [rota]: mutA });
  checa("MUTAÇÃO restaurar 'Guardado p/ próximo sorteio' => RED",
        afirmamCorrente(ra.tiles).length !== 1,
        `${afirmamCorrente(ra.tiles).length} tiles afirmam saldo corrente: ` +
        afirmamCorrente(ra.tiles).map((t) => `${t.rotulo}=${t.valor}`).join(" | "));

  // (b) painel corrente lendo o valor legado em vez do livro-razão
  const mutB = appJs.replace(
    "itens.push([esc(lotDinheiro(f.carryoverAvailableCents)),",
    "itens.push([esc(fmtUsd(1)),");
  if (mutB === appJs) throw new Error("mutação (b) não casou — o alvo mudou de forma");
  const rb = await medir({ [rota]: mutB });
  checa("MUTAÇÃO painel corrente lendo o legado ($1) => RED",
        rb.marcados[0]?.valor !== "$39", `valor exibido = ${rb.marcados[0]?.valor}`);

  // (c) dois elementos afirmando ser o saldo corrente
  const mutC = appJs.replace(
    '? [fmtUsd(disponivel), "Sobra antes do sorteio (histórico)", false]',
    '? [fmtUsd(disponivel), "Disponível para tickets", true]');
  if (mutC === appJs) throw new Error("mutação (c) não casou — o alvo mudou de forma");
  const rc = await medir({ [rota]: mutC });
  checa("MUTAÇÃO dois elementos correntes => RED", rc.marcados.length !== 1,
        `${rc.marcados.length} marcadores: ` +
        rc.marcados.map((m) => `${m.fonte}=${m.valor}`).join(" | "));

  console.log("\n" + "=".repeat(78));
  if (falhas.length) {
    console.log(`CURRENT_BALANCE_UNICITY = FALHOU (${falhas.length})`);
    falhas.forEach((f) => console.log(`    - ${f}`));
    process.exitCode = 1;
  } else {
    console.log("CURRENT_BALANCE_UNICITY = PASS");
    console.log("  CURRENT_BALANCE_SOURCES = 1 · VISIBLE_CURRENT_BALANCE = $39 · " +
                "CURRENT_MONEY_AMBIGUITY = 0");
  }
} finally {
  server.stop();
}
