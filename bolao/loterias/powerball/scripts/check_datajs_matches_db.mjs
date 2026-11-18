#!/usr/bin/env node
/**
 * TRAVA ANTES DE E-MAIL: o `data.js` tem todo mundo que o banco tem?
 *
 * Desde 2026-11-18 o deposito do dia a dia vai so para o banco (`powerball_open_draw.yml` com
 * `publish_site=false`) e o site le o banco ao vivo. Mas o e-mail dos bilhetes e o de resultado
 * (divisao de premio) ainda leem os participantes do `data.js`. Se a sincronizacao fosse esquecida,
 * quem pagou ficaria sem e-mail e fora da divisao -- sem erro em lugar nenhum.
 *
 * Esta trava compara, para os sorteios escolhidos (ver `sorteiosAConferir`), as linhas da RPC publica
 * `lottery_public_open_draws` (a mesma que o site usa, sem credencial) com o `data.js`:
 *   - alguem no banco e fora do data.js            -> REPROVA
 *   - cotas ou valor diferentes para o mesmo nome  -> REPROVA
 *   - resposta fora de forma                       -> REPROVA
 *   - banco inalcancavel                           -> REPROVA, ou AVISO com `--allow-unknown`
 * O inverso (alguem no data.js e fora do banco) nao e papel desta trava: o `--check` da projecao
 * publica ja cobre o data.js contra o artefato do banco no CI.
 *
 * Uso:
 *   node check_datajs_matches_db.mjs --draw 2026-11-20              # e-mail dos bilhetes
 *   node check_datajs_matches_db.mjs --only-past-draws --allow-unknown   # e-mail de resultado
 *   [--data-js caminho] [--from linhas.json]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATA_JS = join(AQUI, "..", "js", "data.js");
const CONFIG_JS = join(AQUI, "..", "js", "config.js");

/** Carrega os sorteios do data.js num contexto sem `require`, sem rede, sem processo. */
export function sorteiosDoDataJs(src) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { timeout: 2000 });
  const draws = ctx.window.POWERBALL_DRAWS;
  if (!Array.isArray(draws)) throw new Error("data.js sem window.POWERBALL_DRAWS");
  return draws;
}

/** Nome mascarado: o log de CI e publico (mesma regra de generate_public_projection.mjs). */
const mascarar = (nome) => {
  const t = String(nome ?? "");
  return t.length <= 2 ? "…" : `${t.slice(0, 2)}…${t.slice(-1)} (${t.length})`;
};

const fechado = (d) => !!(d.result && d.result.numbers && d.result.numbers.length);
const n = (v) => Number(v);

/**
 * Sorteios a conferir.
 *
 *   drawId  (e-mail dos BILHETES) so aquele sorteio, tenha ou nao resultado. Um deposito ainda nao
 *           sincronizado do sorteio SEGUINTE nao pode travar o e-mail deste.
 *   agora   (e-mail de RESULTADO, ms) so sorteio sem resultado cujo horario ja passou. Aquele
 *           workflow roda quatro vezes por dia mesmo entre sorteios; antes do sorteio nao ha
 *           resultado a enviar, e o deposito pode estar so no banco ate a compra dos bilhetes.
 */
export function sorteiosAConferir(draws, { drawId = null, agora = null } = {}) {
  if (drawId) return draws.filter((d) => d.id === drawId);
  const jaSorteado = (d) => {
    const t = Date.parse((d.drawing && d.drawing.drawDateIso) || "");
    return Number.isFinite(t) && t <= agora;
  };
  return draws.filter((d) => !fechado(d) && (agora === null || jaSorteado(d)));
}

/**
 * Pura: devolve a lista de problemas (vazia = ok).
 *
 * Casa por NOME com contagem: dois participantes com o mesmo nome no mesmo sorteio precisam de
 * duas linhas no data.js, e cotas/valor sao comparados pela soma daquele nome.
 */
export function divergencias(draws, linhas, opcoes = {}) {
  if (!Array.isArray(linhas)) return ["resposta do banco nao e lista"];
  for (const l of linhas) {
    if (!l || typeof l.draw_date !== "string" || typeof l.name !== "string") return ["linha do banco fora de forma"];
  }
  const problemas = [];
  const alvo = sorteiosAConferir(draws, opcoes);
  if (opcoes.drawId && alvo.length !== 1) return [`sorteio ${opcoes.drawId}: ${alvo.length} bloco(s) no data.js`];
  for (const d of alvo) {
    const soma = (lista, nome) => lista.filter((x) => x.name === nome)
      .reduce((acc, x) => ({ qtd: acc.qtd + 1, cotas: acc.cotas + n(x.cotas), valor: acc.valor + n(x.valor) }),
        { qtd: 0, cotas: 0, valor: 0 });
    const doBanco = linhas.filter((l) => l.draw_date === d.id);
    const doDataJs = d.participants || [];
    for (const nome of [...new Set(doBanco.map((l) => l.name))]) {
      const b = soma(doBanco, nome), j = soma(doDataJs, nome);
      if (j.qtd < b.qtd) { problemas.push(`${d.id}: ${mascarar(nome)} pagou no banco e NAO esta no data.js (${j.qtd} de ${b.qtd})`); continue; }
      if (j.cotas !== b.cotas) problemas.push(`${d.id}: ${mascarar(nome)} cotas data.js=${j.cotas} banco=${b.cotas}`);
      if (Math.round(j.valor * 100) !== Math.round(b.valor * 100)) problemas.push(`${d.id}: ${mascarar(nome)} valor data.js=${j.valor} banco=${b.valor}`);
    }
  }
  return problemas;
}

async function buscar() {
  const cfgCtx = { window: {} };
  vm.createContext(cfgCtx);
  vm.runInContext(readFileSync(CONFIG_JS, "utf8"), cfgCtx, { timeout: 2000 });
  const cfg = cfgCtx.window.POWERBALL_CONFIG && cfgCtx.window.POWERBALL_CONFIG.liveDb;
  if (!cfg || !cfg.url || !cfg.anonKey) throw new Error("config.js sem liveDb.url/anonKey");
  const r = await fetch(`${cfg.url}/rest/v1/rpc/lottery_public_open_draws`, {
    method: "POST", body: "{}",
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`RPC respondeu HTTP ${r.status}`);
  return r.json();
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const opcoes = { drawId: arg("--draw"), agora: process.argv.includes("--only-past-draws") ? Date.now() : null };
  // `--allow-unknown`: no e-mail de RESULTADO, banco inalcancavel (ou a RPC ainda nao aplicada)
  // vira AVISO e o envio segue como era antes da trava. Divergencia MEDIDA continua reprovando.
  // No e-mail dos bilhetes (manual, com o organizador presente) nao se usa: la "nao consegui medir"
  // reprova.
  const tolerante = process.argv.includes("--allow-unknown");
  let draws;
  try { draws = sorteiosDoDataJs(readFileSync(arg("--data-js") || DATA_JS, "utf8")); }
  catch (e) { console.log(`✗ data.js ilegivel: ${e.message}`); process.exit(1); }
  if (!opcoes.drawId && sorteiosAConferir(draws, opcoes).length === 0) {
    console.log("✓ nenhum sorteio a conferir agora — banco nao consultado");
    process.exit(0);
  }
  let linhas;
  try { linhas = arg("--from") ? JSON.parse(readFileSync(arg("--from"), "utf8")) : await buscar(); }
  catch (e) {
    if (tolerante) {
      console.log(`::warning::trava data.js x banco nao mediu (${e.message}); seguindo como antes da trava`);
      process.exit(0);
    }
    console.log(`✗ nao foi possivel comparar com o banco: ${e.message}`);
    process.exit(1);
  }
  const problemas = divergencias(draws, linhas, opcoes);
  if (problemas.length) {
    console.log("✗ data.js NAO tem todo mundo que o banco tem. Sincronize antes de enviar:");
    console.log("  gh workflow run powerball_open_draw.yml -f manifest=<manifesto> -f apply=true -f publish_site=true\n");
    for (const p of problemas) console.log("  - " + p);
    process.exit(1);
  }
  console.log("✓ data.js tem todo mundo que o banco tem");
}
