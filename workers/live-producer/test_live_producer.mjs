/**
 * Contrato hermetico do relogio do pipeline ao vivo (#246).
 *
 * Este Worker nao e produtor de futebol: ele nao busca ESPN, nao normaliza payload e nao toca
 * Supabase. Sua unica autoridade e disparar um workflow conhecido, num repositorio conhecido.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dispararProdutor } from "./src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ENV = {
  GH_DISPATCH_TOKEN: "TOKEN-DE-TESTE",
  GH_REPO: "ferrarilabs/ferrarilabs.github.io",
  GH_WORKFLOW: "live_cache_producer.yml",
};

let ok = 0;
let fail = 0;
const teste = async (nome, fn) => {
  try { await fn(); console.log(`  ✓ ${nome}`); ok++; }
  catch (erro) { console.log(`  ✗ ${nome}\n      ${erro.message}`); fail++; }
};
const afirma = (condicao, mensagem) => { if (!condicao) throw new Error(mensagem); };

function fetchFalso(status = 200, registro = []) {
  return async (url, opcoes) => {
    registro.push({ url: String(url), opcoes });
    return { status };
  };
}

console.log("\n#246 — Cloudflare acorda o produtor GitHub\n");

await teste("200 da API atual confirma o dispatch", async () => {
  const resultado = await dispararProdutor(ENV, { fetchImpl: fetchFalso(200) });
  afirma(resultado.acao === "DISPARADO", JSON.stringify(resultado));
});

await teste("204 legado tambem confirma o dispatch", async () => {
  const resultado = await dispararProdutor(ENV, { fetchImpl: fetchFalso(204) });
  afirma(resultado.acao === "DISPARADO", JSON.stringify(resultado));
});

await teste("o request mira somente o workflow produtor em main", async () => {
  const registro = [];
  await dispararProdutor(ENV, { fetchImpl: fetchFalso(200, registro) });
  afirma(registro.length === 1, "esperado um unico request");
  const { url, opcoes } = registro[0];
  afirma(url === "https://api.github.com/repos/ferrarilabs/ferrarilabs.github.io/actions/workflows/live_cache_producer.yml/dispatches", url);
  afirma(opcoes.method === "POST", "dispatch nao usou POST");
  afirma(opcoes.headers.authorization === `Bearer ${ENV.GH_DISPATCH_TOKEN}`, "token ausente do header");
  afirma(!url.includes(ENV.GH_DISPATCH_TOKEN), "token vazou para a URL");
  afirma(opcoes.headers["x-github-api-version"] === "2026-03-10", "versao da API divergiu");
  afirma(opcoes.signal instanceof AbortSignal, "request sem timeout/AbortSignal");
  const corpo = JSON.parse(opcoes.body);
  afirma(corpo.ref === "main", "dispatch fora de main");
  afirma(corpo.inputs.dry_run === "false", "cron acionaria dry-run");
  afirma(corpo.inputs.force === "false", "cron ignoraria a janela do calendario");
});

await teste("credencial ausente falha fechado sem tocar a rede", async () => {
  const registro = [];
  const resultado = await dispararProdutor({ ...ENV, GH_DISPATCH_TOKEN: "" }, {
    fetchImpl: fetchFalso(200, registro),
  });
  afirma(resultado.acao === "SEM_CREDENCIAL", JSON.stringify(resultado));
  afirma(registro.length === 0, "tocou a rede sem credencial");
});

for (const alteracao of [
  { GH_REPO: "outro-repo" },
  { GH_REPO: "ferrarilabs/ferrarilabs.github.io/../../outro" },
  { GH_WORKFLOW: "../outro.yml" },
  { GH_WORKFLOW: "live_cache_producer.txt" },
]) {
  await teste(`configuracao invalida falha fechado: ${JSON.stringify(alteracao)}`, async () => {
    const registro = [];
    const resultado = await dispararProdutor({ ...ENV, ...alteracao }, {
      fetchImpl: fetchFalso(200, registro),
    });
    afirma(resultado.acao === "CONFIG_INVALIDA", JSON.stringify(resultado));
    afirma(registro.length === 0, "enviou o token com configuracao invalida");
  });
}

for (const status of [400, 401, 403, 404, 422, 500]) {
  await teste(`HTTP ${status} e recusa visivel sem corpo/segredo no resultado`, async () => {
    const resultado = await dispararProdutor(ENV, { fetchImpl: fetchFalso(status) });
    afirma(resultado.acao === "RECUSADO", JSON.stringify(resultado));
    afirma(resultado.detalhe === `dispatch http ${status}`, resultado.detalhe);
    afirma(!JSON.stringify(resultado).includes(ENV.GH_DISPATCH_TOKEN), "token vazou para o log");
  });
}

await teste("falha de transporte e visivel sem mensagem potencialmente sensivel", async () => {
  const resultado = await dispararProdutor(ENV, {
    fetchImpl: async () => {
      throw Object.assign(new Error("conteudo nao deve ir ao log"), { name: "TimeoutError" });
    },
  });
  afirma(resultado.acao === "RECUSADO", JSON.stringify(resultado));
  afirma(resultado.detalhe === "dispatch TimeoutError", resultado.detalhe);
  afirma(!JSON.stringify(resultado).includes("conteudo"), "mensagem de excecao vazou ao log");
});

await teste("fonte e configuracao nao contem ESPN, Supabase ou token de ingestao", async () => {
  const fonte = readFileSync(join(AQUI, "src/index.ts"), "utf8");
  const config = readFileSync(join(AQUI, "wrangler.jsonc"), "utf8");
  const executavel = `${fonte}\n${config}`
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((linha) => linha.split("//")[0]).join("\n");
  for (const proibido of [
    "site.api.espn.com", "supabase.co", "GATEWAY_URL", "LIVE_PRODUCER_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY", "normalizeScoreboard", "live_sports_cache",
  ]) {
    afirma(!executavel.includes(proibido), `Worker ainda alcanca/reimplementa ${proibido}`);
  }
  afirma(executavel.includes("GH_DISPATCH_TOKEN"), "segredo de dispatch nao declarado");
  afirma(fonte.includes("https://api.github.com"), "Worker deixou de acordar o GitHub");
});

await teste("cron de cinco minutos e unico e workers.dev permanece fechado", async () => {
  const config = readFileSync(join(AQUI, "wrangler.jsonc"), "utf8");
  afirma(/"crons"\s*:\s*\[\s*"\*\/5 \* \* \* \*"\s*\]/.test(config), "cron nao e */5");
  afirma(/"workers_dev"\s*:\s*false/.test(config), "Worker ganhou endpoint publico");
  afirma(/"preview_urls"\s*:\s*false/.test(config), "Worker ganhou preview URL");
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ LIVE PRODUCER DISPATCH FAILED" : "✓ LIVE PRODUCER DISPATCH OK");
process.exit(fail ? 1 : 0);
