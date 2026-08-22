#!/usr/bin/env node
/**
 * AUTORIDADE DO `data.js` DO POWERBALL — Issue #130.
 *
 * ─── A DECISAO ───────────────────────────────────────────────────────────────────────────────
 *
 * 2026-08-22, decisao do dono: o banco PostgreSQL/Supabase e o SISTEMA DE REGISTRO de participante,
 * participacao e transacao de pagamento. `data.js` passa a ser PROJECAO DERIVADA, e GitHub Secrets
 * voltam a ser so credencial e configuracao.
 *
 * ─── E O ESTADO DE FATO, QUE E OUTRO ─────────────────────────────────────────────────────────
 *
 * A transicao NAO terminou. Medido em 2026-08-22:
 *
 *     banco     1 sorteio  · 10 participantes · 11 transacoes · 102.00
 *     data.js   5 sorteios · 75 linhas        ·      —        · 888.00
 *
 * Ou seja, hoje `data.js` ainda carrega verdade financeira que o banco NAO tem. Marcar o arquivo
 * como "derivado, nao autoritativo" agora seria escrever uma mentira dentro do proprio artefato --
 * e um artefato que mente sobre a propria autoridade e pior que um sem cabecalho nenhum.
 *
 * Entao este gate faz as duas coisas honestas que cabem hoje:
 *
 *   1. exige que o arquivo DECLARE a decisao e o seu estado transitorio, para que ninguem o leia
 *      achando que a autoridade e permanente;
 *   2. FIXA os agregados de pagamento, para que qualquer edicao manual de valor, cota ou contagem
 *      apareca em revisao em vez de passar junto de uma mudanca visual.
 *
 * Quando a reconciliacao for resolvida e o banco virar autoridade de fato, este gate inverte: passa
 * a exigir que `data.js` seja GERADO e que os agregados batam com o banco, e o pin some.
 *
 * Sem rede e sem banco. Uso: node bolao/loterias/powerball/scripts/audit_data_js_authority.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DATA_JS = "bolao/loterias/powerball/js/data.js";
const PIN = "bolao/shared/safety/powerball_public_projection_pin.json";

/** Marcadores que o cabecalho tem de conter para o leitor saber o que esta lendo. */
export const REQUIRED_MARKERS = Object.freeze([
  "SISTEMA DE REGISTRO", "Issue #130", "PROJECAO",
]);

export function aggregates(text) {
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function("window", text)(win);
  const draws = win.POWERBALL_DRAWS || [];
  return draws.map((d) => {
    const p = d.participants || [];
    return {
      id: d.id,
      participants: p.length,
      cotas: p.reduce((a, x) => a + (Number(x.cotas) || 0), 0),
      valor: Number(p.reduce((a, x) => a + (Number(String(x.valor || 0).replace(/[^0-9.]/g, "")) || 0), 0).toFixed(2)),
      totalArrecadado: (d.finance || {}).totalArrecadado ?? null,
    };
  });
}

export function report({ root = ROOT, text, pin } = {}) {
  const src = text ?? readFileSync(join(root, DATA_JS), "utf8");
  const p = pin ?? JSON.parse(readFileSync(join(root, PIN), "utf8"));
  const header = src.slice(0, 4000);

  const faltando = REQUIRED_MARKERS.filter((m) => !header.includes(m));
  const atual = aggregates(src);
  const fixado = p.draws;

  const drift = [];
  const byId = new Map(atual.map((d) => [d.id, d]));
  for (const f of fixado) {
    const a = byId.get(f.id);
    if (!a) { drift.push(`sorteio ${f.id} sumiu de data.js`); continue; }
    for (const k of ["participants", "cotas", "valor", "totalArrecadado"]) {
      if (a[k] !== f[k]) drift.push(`${f.id}.${k}: fixado=${f[k]} atual=${a[k]}`);
    }
  }
  for (const a of atual) {
    if (!fixado.some((f) => f.id === a.id)) drift.push(`sorteio NOVO ${a.id} nao esta no pin`);
  }
  return { faltando, drift, atual, fixado, pin: p };
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nAutoridade do data.js do Powerball (Issue #130)\n");
  const r = report();

  check("o arquivo declara a decisao de sistema de registro", r.faltando.length === 0,
    r.faltando.length ? `faltam marcadores no cabecalho: ${r.faltando.join(", ")}`
      : "quem abrir o arquivo ve de quem e a autoridade e que ela e transitoria");

  check(`os agregados de pagamento nao mudaram sem revisao (${r.fixado.length} sorteios)`, r.drift.length === 0,
    r.drift.length
      ? "verdade financeira mudou em data.js. Se foi de proposito, atualize o pin NA MESMA mudanca e "
        + "explique por que:\n      " + r.drift.join("\n      ")
      : `${r.fixado.reduce((a, d) => a + d.participants, 0)} linhas de participante, `
        + `${r.fixado.reduce((a, d) => a + d.valor, 0).toFixed(2)} em valor`);

  check("o pin declara qual e a autoridade de hoje e qual e a alvo",
    Boolean(r.pin.authorityToday && r.pin.authorityTarget && r.pin.authorityToday !== r.pin.authorityTarget),
    `hoje=${r.pin.authorityToday} → alvo=${r.pin.authorityTarget}`);

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
