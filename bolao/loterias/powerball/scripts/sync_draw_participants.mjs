/**
 * PARTICIPANTES DE UM SORTEIO NO `data.js`, A PARTIR DO BANCO.
 *
 * Antes, cada contribuicao gravada pelo `powerball_open_draw.yml` exigia um PR feito a mao que
 * reescrevia o array `participants` do sorteio, o `totalArrecadado` e o pin. Os tres sao
 * DERIVADOS do banco; este script os deriva, e o workflow publica o resultado via PR.
 *
 * Escrita cirurgica, como `fetch_and_send_results.py`: so o array `participants` e a linha
 * `totalArrecadado` DO sorteio alvo mudam; comentarios e o resto do arquivo ficam byte a byte.
 *
 * Uso:
 *   node sync_draw_participants.mjs --draw 2026-10-31              # le o banco (service key)
 *   node sync_draw_participants.mjs --draw 2026-10-31 --from rows.json [--data-js f] [--pin f]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { projetarSorteio } from "./public_projection.mjs";
import { lerBanco, lerArquivo } from "./generate_public_projection.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..", "..");
const DATA_JS = join(RAIZ, "bolao/loterias/powerball/js/data.js");
const PIN = join(RAIZ, "bolao/shared/safety/powerball_public_projection_pin.json");
const ORGANIZADOR = "Fundo próprio (organizador)";

/** Linhas publicas do sorteio, na ordem em que as contribuicoes chegaram. */
export function participantesDoSorteio(linhas, drawDate) {
  // No banco, `draw_id` e UUID; o sorteio e identificado pela DATA (`draw_date`).
  const draws = linhas.draws.filter((d) => String(d.draw_date).slice(0, 10) === drawDate);
  if (draws.length !== 1) throw new Error(`sorteio ${drawDate}: ${draws.length} linha(s) em lottery_draws`);
  const participacoes = linhas.participacoes.filter((p) => p.draw_id === draws[0].draw_id);
  if (participacoes.length === 0) throw new Error(`sorteio ${drawDate}: nenhuma participacao no banco`);
  const overrides = {};
  const chegada = new Map();
  for (const pa of participacoes) {
    const ts = linhas.transacoes
      .filter((t) => t.participation_id === pa.participation_id && t.type === "contribution")
      .map((t) => String(t.paid_at)).sort()[0] || "";
    const p = linhas.participantes.find((x) => x.participant_id === pa.participant_id);
    if (p) chegada.set(p.display_name, ts);
  }
  const rows = projetarSorteio({
    participantes: linhas.participantes, participacoes, transacoes: linhas.transacoes, overrides,
  });
  for (const r of rows) if (r.metodo === ORGANIZADOR) r.status = "organizador";
  return rows.sort((a, b) => (chegada.get(a.name) || "").localeCompare(chegada.get(b.name) || "")
    || a.name.localeCompare(b.name, "pt-BR"));
}

// O ICU do Node 20 separa "PM" com U+202F; o data.js usa espaco comum.
const js = (v) => (v === null || v === undefined ? "null"
  : JSON.stringify(typeof v === "string" ? v.replace(/[\u202f\u00a0]/g, " ") : v));
function linhaJs(r) {
  return `      { name: ${js(r.name)}, cotas: ${r.cotas}, valor: ${r.valor}, metodo: ${js(r.metodo)}, ` +
         `data: ${js(r.data)}, hora: ${js(r.hora)}, status: ${js(r.status)}, state: ${js(r.state)} }`;
}

/** Reescreve so o sorteio alvo. Recusa (lanca) se a ancora nao for inequivoca. */
export function aplicarNoDataJs(src, drawId, rows) {
  const ancora = `\n    id: ${JSON.stringify(drawId)},`;
  const ini = src.indexOf(ancora);
  if (ini === -1 || src.indexOf(ancora, ini + 1) !== -1) throw new Error(`sorteio ${drawId}: ancora ausente ou repetida no data.js`);
  const prox = src.indexOf("\n    id: \"", ini + ancora.length);
  const fimBloco = prox === -1 ? src.length : prox;
  const bloco = src.slice(ini, fimBloco);

  const abre = bloco.indexOf("\n    participants: [");
  const fecha = bloco.indexOf("\n    ],", abre);
  if (abre === -1 || fecha === -1) throw new Error(`sorteio ${drawId}: array participants nao encontrado`);
  const corpo = rows.length ? "\n" + rows.map(linhaJs).join(",\n") : "";
  let novo = bloco.slice(0, abre) + "\n    participants: [" + corpo + bloco.slice(fecha);

  const total = rows.reduce((a, r) => a + r.valor, 0);
  const reTotal = /\n      totalArrecadado: [\d.]+,[^\n]*/;
  if (!reTotal.test(novo)) throw new Error(`sorteio ${drawId}: linha totalArrecadado nao encontrada`);
  novo = novo.replace(reTotal,
    `\n      totalArrecadado: ${total}, // ${rows.length} participante(s), soma das contribuicoes no banco`);
  return { src: src.slice(0, ini) + novo + src.slice(fimBloco), total };
}

export function aplicarNoPin(pin, drawId, rows, total) {
  const entrada = { id: drawId, participants: rows.length,
    cotas: rows.reduce((a, r) => a + r.cotas, 0), valor: total, totalArrecadado: total };
  const i = pin.draws.findIndex((d) => d.id === drawId);
  if (i === -1) pin.draws.push(entrada); else pin.draws[i] = { ...pin.draws[i], ...entrada };
  return pin;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const drawId = arg("--draw");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(drawId || "")) { console.log("uso: --draw AAAA-MM-DD [--from f]"); process.exit(2); }
  const dataJs = arg("--data-js") || DATA_JS, pinPath = arg("--pin") || PIN;
  const linhas = arg("--from") ? lerArquivo(arg("--from")) : await lerBanco();
  const rows = participantesDoSorteio(linhas, drawId);
  const { src, total } = aplicarNoDataJs(readFileSync(dataJs, "utf-8"), drawId, rows);
  writeFileSync(dataJs, src);
  const pin = aplicarNoPin(JSON.parse(readFileSync(pinPath, "utf-8")), drawId, rows, total);
  writeFileSync(pinPath, JSON.stringify(pin, null, 2) + "\n");
  console.log(`✓ ${drawId}: ${rows.length} participante(s), US$${total} no data.js e no pin`);
}
