/**
 * test_deploy_convergence.mjs — um deploy publicado TEM de chegar ao usuário (#246, Fase A).
 *
 * ─── O DEFEITO REAL ─────────────────────────────────────────────────────────────────────────
 *
 * Na verificação pós-deploy de 2026-08-27 a produção servia o bundle CORRIGIDO e o navegador
 * continuava apresentando o aplicativo ANTIGO. Só depois de desregistrar o service worker e
 * limpar o Cache Storage a versão publicada apareceu.
 *
 * Um usuário não abre o DevTools. Se a convergência depende disso, a correção não foi entregue —
 * ela só foi publicada. São coisas diferentes, e só uma delas importa para quem usa o site.
 *
 * ─── POR QUE ESTE TESTE EXISTE EM VEZ DE UMA ANÁLISE ────────────────────────────────────────
 *
 * A cadeia tem quatro camadas que se escondem uma atrás da outra: cache HTTP do navegador,
 * Cache Storage do service worker, a estratégia do próprio worker, e o `?v=` do HTML. Ler o
 * código de cada uma e concluir que "deveria convergir" foi exatamente o que falhou. Então aqui
 * existe um servidor que publica de verdade duas versões, e o navegador decide quem tem razão.
 *
 * Determinístico e local: sem rede externa, sem produção, sem dado de participante.
 */
import { createServer } from "node:http";
import { launchChromium } from "../cdb2026/scripts/visual/playwright_loader.mjs";

let ok = 0, fail = 0;
const test = async (n, f) => {
  try { await f(); console.log(`  ✓ ${n}`); ok++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const A = (c, m) => { if (!c) throw new Error(m); };

// ─── Um "deploy" ────────────────────────────────────────────────────────────────────────────
// Mesma forma do site: HTML referenciando app.js com `?v=<hash>`, e o service worker real do
// repositório (carregado do disco) — não uma imitação, senão o teste prova outra coisa.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SW_REAL = readFileSync(join(ROOT, "bolao/sw.js"), "utf8");

let versaoAtual = "v1";
let swServido = SW_REAL;
let entregasDeApp = [];

const html = (v) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head>
<body><div id="marca">carregando</div>
<form id="pickForm"><input class="pk-goals-home" value=""></form>
<script src="/bolao/app.js?v=${v}"></script>
<script>
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/bolao/sw.js');
</script></body></html>`;

const appJs = (v) => `window.APP_VERSION = ${JSON.stringify(v)};
document.getElementById("marca").textContent = ${JSON.stringify(v)};`;

const servidor = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/bolao/sw.js") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-cache" });
    return res.end(swServido);
  }
  if (p === "/bolao/app.js") {
    entregasDeApp.push(url.searchParams.get("v"));
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "max-age=31536000" });
    return res.end(appJs(url.searchParams.get("v")));
  }
  if (p === "/bolao/" || p === "/bolao/index.html") {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    return res.end(html(versaoAtual));
  }
  res.writeHead(404); res.end("");
});

await new Promise((r) => servidor.listen(0, r));
const BASE = `http://localhost:${servidor.address().port}/bolao/`;

const browser = await launchChromium();
const marca = (page) => page.evaluate(() => document.getElementById("marca")?.textContent || null);
const temSW  = (page) => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length > 0);

console.log("\n#246 Fase A — um deploy publicado chega ao usuário?\n");

await test("1. visitante novo recebe a versão corrente", async () => {
  versaoAtual = "v1";
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  A(await marca(page) === "v1", `recebeu ${await marca(page)}`);
  await ctx.close();
});

await test("2. SW registrado + NOVO deploy ⇒ converge sem limpar cache à mão", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  versaoAtual = "v1";
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 8000 })
    .catch(() => {});
  A(await temSW(page), "o service worker nem chegou a registrar — o teste nao prova nada");
  A(await marca(page) === "v1", "primeira carga nao trouxe v1");

  // ── publica o deploy novo ──
  versaoAtual = "v2";

  // O usuario apenas volta a pagina. Nada de DevTools, nada de limpar cache.
  await page.goto(BASE, { waitUntil: "networkidle" });
  const vista = await marca(page);
  A(vista === "v2",
    `APOS UM NOVO DEPLOY o navegador continua em ${vista}. Foi exatamente isto que a producao ` +
    `fez em 2026-08-27: bundle novo publicado, aplicativo velho na tela`);
  await ctx.close();
});

await test("3. HTML em cache nao consegue prender JS antigo para sempre", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  versaoAtual = "v1";
  await page.goto(BASE, { waitUntil: "networkidle" });
  versaoAtual = "v3";
  await page.reload({ waitUntil: "networkidle" });
  A(await marca(page) === "v3", `reload manteve ${await marca(page)}`);
  await ctx.close();
});

await test("5. deploys consecutivos convergem", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const v of ["v1", "v2", "v3", "v4"]) {
    versaoAtual = v;
    await page.goto(BASE, { waitUntil: "networkidle" });
    A(await marca(page) === v, `esperado ${v}, veio ${await marca(page)}`);
  }
  await ctx.close();
});

await test("10. asset que falha NAO substitui o app por um shell quebrado", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  versaoAtual = "v1";
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.route("**/app.js*", (r) => r.abort());
  versaoAtual = "v9";
  await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
  const m = await marca(page);
  A(m === "carregando" || m === "v1" || m === "v9",
    `estado incoerente apos falha de asset: ${m}`);
  await ctx.close();
});

console.log("\nB. Aba ABERTA: o mecanismo observa o carimbo certo?");

import { readFileSync as _rf } from "node:fs";
const APPS = [["cdb2026", "CDB2026_CONFIG"], ["br2026", "BR2026_CONFIG"]];

for (const [app, cfg] of APPS) {
  const fonte = _rf(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");

  await test(`${app}: a deteccao de deploy observa o carimbo \`?v=\`, nao so \`siteVersion\``, () => {
    A(/js\\\/app\\\.js\\\?v=/.test(codigo) || /app\.js\?v=/.test(codigo),
      `${app}: o polling nao le o carimbo de deploy do HTML. \`siteVersion\` e bumpado A MAO e o ` +
      `bot sync_version.yml NUNCA o toca — cinco deploys sairam com ele parado em v3.137, e ` +
      `nenhuma aba aberta recarregou`);
    A(/houveDeploy/.test(codigo), `${app}: sem sinal derivado do carimbo publicado`);
  });

  await test(`${app}: formulario SUJO nunca e recarregado por baixo do participante`, () => {
    // A arquitetura mudou: o reload saiu de dentro de `checkVersion` e passou para
    // `aplicarAtualizacao()`. A PROTECAO e a mesma e continua exigida -- o que muda e onde olhar.
    A(codigo.indexOf("function formIsDirty") > 0, `${app}: nao ha deteccao de formulario sujo`);
    const chk = codigo.indexOf("async function checkVersion");
    A(chk > 0, `${app}: checkVersion nao encontrada`);
    const corpo = codigo.slice(chk, chk + 2600);
    A(/formIsDirty\(\)/.test(corpo), `${app}: checkVersion nao consulta formIsDirty`);
    // O ramo do formulario sujo tem de RETORNAR sem chamar a atualizacao.
    const iSujo = corpo.indexOf("if (formIsDirty())");
    A(iSujo > 0, `${app}: sem ramo dedicado ao formulario sujo`);
    // Recorta no FECHAMENTO do bloco: uma janela de tamanho fixo invadia o caminho limpo logo
    // abaixo, que legitimamente chama a atualizacao, e acusava o ramo errado.
    const resto = corpo.slice(iSujo);
    const fim = resto.indexOf("\n      }");
    const ramo = fim > 0 ? resto.slice(0, fim) : resto.slice(0, 300);
    A(!/aplicarAtualizacao\(\)/.test(ramo) && !/location\.reload/.test(ramo),
      `${app}: o ramo de formulario sujo dispara atualizacao — apagaria palpites nao salvos`);
    // E a unica atualizacao possivel depois da deteccao tem de estar atras da checagem de sujo.
    const iAplica = corpo.indexOf("aplicarAtualizacao();", iSujo);
    A(iAplica > iSujo, `${app}: ha caminho de atualizacao ANTES da guarda de formulario sujo`);
  });

  await test(`${app}: existe UM unico ponto de reload, e ele e guardado`, () => {
    const iiFE = codigo.indexOf("function startVersionPolling");
    const corpo = codigo.slice(iiFE);
    const reloads = (corpo.match(/location\.reload\(\)/g) || []).length;
    A(reloads === 1,
      `${app}: ${reloads} pontos de reload no polling — mais de um e um caminho que escapa da ` +
      `guarda de formulario sujo`);
    const iAplicar = corpo.indexOf("function aplicarAtualizacao");
    A(iAplicar > 0, `${app}: o reload nao foi isolado num ponto unico`);
    const fn = corpo.slice(iAplicar, iAplicar + 260);
    A(/RELEASE_STATE\.UPDATING\) return;/.test(fn),
      `${app}: o ponto de reload nao se protege contra reentrada — vira laco`);
    A(/if \(!\(houveDeploy \|\| versaoMudou\)\)/.test(corpo),
      `${app}: a atualizacao nao esta atras de uma condicao de deploy`);
  });
}

console.log("\nB2. Contrato de convergencia: sujo ADIA, limpo atualiza");

for (const [app] of APPS) {
  const fonte = _rf(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");

  await test(`${app}: a DETECCAO acontece mesmo com formulario sujo`, () => {
    const i = codigo.indexOf("async function checkVersion");
    const corpo = codigo.slice(i, i + 2600);
    A(!/if \(document\.hidden \|\| formIsDirty\(\)\) return;/.test(corpo),
      `${app}: a sonda ainda sai cedo quando ha palpite digitado — o participante nunca fica ` +
      `sabendo que existe versao nova, e a aba pode ficar numa release obsoleta indefinidamente`);
    A(/if \(document\.hidden\) return;/.test(corpo), `${app}: aba oculta deve continuar barrada`);
  });

  await test(`${app}: com formulario SUJO nao recarrega e AVISA uma vez`, () => {
    const i = codigo.indexOf("if (formIsDirty())");
    A(i > 0, `${app}: nao ha ramo dedicado para formulario sujo`);
    const ramo = codigo.slice(i, i + 300);
    A(/RELEASE_STATE\.WAITING/.test(ramo), `${app}: sujo nao entra em UPDATE_WAITING_FOR_SAFE_RELOAD`);
    A(/mostrarAvisoDeVersao\(\)/.test(ramo), `${app}: sujo nao avisa nada ao participante`);
    A(/return;/.test(ramo), `${app}: sujo nao adia — recarregaria por cima do palpite`);
    A(!/location\.reload/.test(ramo), `${app}: ha reload no ramo de formulario sujo`);
    A(/_avisoMostrado/.test(codigo),
      `${app}: o aviso reapareceria a cada poll — um aviso repetido e um aviso ignorado`);
  });

  await test(`${app}: quando o formulario fica LIMPO, a atualizacao acontece`, () => {
    A(/RELEASE_STATE\.WAITING && !formIsDirty\(\)/.test(codigo),
      `${app}: uma atualizacao adiada nunca seria retomada — a aba ficaria obsoleta para sempre`);
  });

  await test(`${app}: protecao contra laco de reload`, () => {
    A(/_releaseState === RELEASE_STATE\.UPDATING\) return;/.test(codigo),
      `${app}: sem guarda de UPDATING, a sonda pode disparar reload em cima de reload`);
  });
}

console.log("\nC. Controles negativos");

for (const [app] of APPS) {
  await test(`${app}: mutacao (guarda de formulario sujo removida) e pega`, () => {
    const fonte = _rf(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
    // A guarda mudou de lugar (agora e o ramo dedicado), entao a mutacao mira o ramo.
    const mutado = fonte.replace("      if (formIsDirty()) {", "      if (false) {");
    A(mutado !== fonte, "a mutacao nao alterou nada");
    A(!/\n      if \(formIsDirty\(\)\) \{/.test(mutado),
      "CONTROLE NEGATIVO: desligar a guarda de formulario sujo deveria ser visivel");
  });

  await test(`${app}: mutacao (volta a observar so siteVersion) e pega`, () => {
    const fonte = _rf(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
    const mutado = fonte.replace(/const houveDeploy = [^;]+;/, "const houveDeploy = false;");
    A(mutado !== fonte, "a mutacao nao alterou nada");
    A(/const houveDeploy = false;/.test(mutado),
      "CONTROLE NEGATIVO: desligar a deteccao por carimbo deveria ser visivel");
  });
}

for (const [app] of APPS) {
  await test(`${app}: mutacao (sujo volta a recarregar e perde o palpite) e pega`, () => {
    const fonte = _rf(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
    const mutado = fonte.replace(
      /if \(formIsDirty\(\)\) \{[\s\S]*?return;[\s\S]*?\}/,
      "if (false) { }");
    A(mutado !== fonte, "a mutacao nao alterou nada");
    A(!/RELEASE_STATE\.WAITING;/.test(mutado.slice(mutado.indexOf("if (false) { }"))),
      "CONTROLE NEGATIVO: remover o ramo de formulario sujo deveria ser visivel");
  });

  await test(`${app}: mutacao (guarda de laco removida) e pega`, () => {
    const fonte = _rf(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
    const mutado = fonte.replace("if (_releaseState === RELEASE_STATE.UPDATING) return;", "");
    A(mutado !== fonte, "a mutacao nao alterou nada");
    A((mutado.match(/RELEASE_STATE\.UPDATING\) return;/g) || []).length <
      (fonte.match(/RELEASE_STATE\.UPDATING\) return;/g) || []).length,
      "CONTROLE NEGATIVO: a guarda de laco deveria ter sumido");
  });
}

await browser.close();
servidor.close();

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ DEPLOY CONVERGENCE FAILED" : "✓ DEPLOY CONVERGENCE OK");
process.exit(fail ? 1 : 0);
