#!/usr/bin/env node
/**
 * RECONCILIACAO DO BACKFILL HISTORICO DO POWERBALL — Issue #130.
 *
 * ─── O QUE ESTA FERRAMENTA E ─────────────────────────────────────────────────────────────────
 *
 * O estagio de LEITURA E CLASSIFICACAO de uma migracao unica: comparar a historia registrada em
 * `js/data.js` com o que o banco (o sistema de registro, decidido em 2026-08-22) realmente tem, e
 * classificar CADA registro de origem antes que qualquer linha financeira seja escrita.
 *
 * Ela NAO escreve no banco. O plano de import que ela emite e revisavel sem PII.
 *
 * ─── POR QUE CLASSIFICAR EM VEZ DE SO SOMAR ──────────────────────────────────────────────────
 *
 * Porque a diferenca entre "falta importar" e "nao da para saber" e a unica coisa que separa uma
 * migracao de uma invencao de fato financeiro. Somar `888 - 102` e facil e nao autoriza nada: e
 * preciso mostrar, registro a registro, que cada linha proposta corresponde a evidencia
 * determinística.
 *
 * ─── A CHAVE DE LIGACAO, E O SEU LIMITE ──────────────────────────────────────────────────────
 *
 * O unico identificador que existe nos dois lados e o NOME. O banco nao guarda e-mail
 * (`lottery_participants.email` esta nulo nas 10 linhas), e o segredo privado tambem e indexado
 * por nome. Nao existe identidade mais forte para preferir.
 *
 * Nome e uma chave fraca, e a ferramenta trata isso como fato e nao como detalhe: qualquer registro
 * que dependa de correspondencia por primeiro nome, ou que colida, sai como AMBIGUOUS_MAPPING e
 * NUNCA como importavel.
 *
 * ─── PII ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Nenhum nome, e-mail, telefone ou referencia de pagamento sai daqui. Identidade aparece como hash
 * sha256 truncado; o resto e contagem e agregado.
 *
 * Uso:
 *   node backfill_reconcile.mjs --db <json do estado do banco> [--json]
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_JS = join(HERE, "..", "js", "data.js");

export const CLASSES = Object.freeze([
  "ALREADY_PRESENT_EXACT", "MISSING_IMPORTABLE", "CONFLICT_AMOUNT", "CONFLICT_PARTICIPANT",
  "CONFLICT_DRAW", "AMBIGUOUS_MAPPING", "DUPLICATE_SOURCE", "UNSUPPORTED", "UNKNOWN",
]);

/** So esta classe pode ser inserida sob a autorizacao. */
export const IMPORTABLE = "MISSING_IMPORTABLE";

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
export const nameHash = (n) => sha(String(n).trim().toLowerCase());
export const firstHash = (n) => sha(String(n).trim().split(/\s+/)[0].toLowerCase());
export const mask = (h) => `${h.slice(0, 8)}…`;

/** Valor monetario da origem -> numero. `valor` aparece como numero ou string. */
export function money(v) {
  const n = Number(String(v ?? 0).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/** ── ESTAGIO 1: SOURCE PARSE ───────────────────────────────────────────────────────────────── */
export function parseSource(text) {
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function("window", text)(win);
  const draws = win.POWERBALL_DRAWS || [];
  const rows = [];
  for (const d of draws) {
    for (const p of d.participants || []) {
      rows.push({
        drawId: String(d.id),
        nameHash: nameHash(p.name),
        firstHash: firstHash(p.name),
        cotas: Number(p.cotas) || 0,
        amount: money(p.valor),
        method: p.metodo ?? null,
        status: p.status ?? null,
        paidKey: paymentInstant(p.data, p.hora),
      });
    }
  }
  return rows;
}

/**
 * Instante do pagamento, normalizado — a chave de identidade que NAO e nome.
 *
 * `data.js` grava `data` (dd/mm/aaaa) e `hora` (h:mm[:ss] AM/PM, hora local de Nova York). O banco
 * grava `paid_at` com fuso. Normalizando os dois para `AAAA-MM-DD HH:MM:SS` local, o instante vira
 * um identificador comparavel.
 *
 * SO vale com precisao de SEGUNDO. Um horario sem segundos (`6:49 PM`) identifica um minuto
 * inteiro, e um minuto nao e unico o bastante para carregar identidade financeira -- esses saem
 * como `null` e o registro cai para as regras de nome, que nunca autorizam import sozinhas.
 */
export function paymentInstant(data, hora) {
  if (!data || !hora) return null;
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(data).trim());
  const t = /^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(String(hora).trim());
  if (!d || !t) return null; // sem segundos -> nao serve como identidade
  let hh = Number(t[1]) % 12;
  if (/PM/i.test(t[4])) hh += 12;
  return `${d[3]}-${d[2]}-${d[1]} ${String(hh).padStart(2, "0")}:${t[2]}:${t[3]}`;
}

/** ── ESTAGIO 2: NORMALIZE + deteccao de duplicata na propria origem ─────────────────────────── */
export function detectDuplicates(rows) {
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.drawId}|${r.nameHash}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * ── ESTAGIO 3: IDENTITY MAP ─────────────────────────────────────────────────────────────────
 *
 * Devolve, por hash de nome da origem, como ele liga ao banco:
 *   EXACT           existe participante com o mesmo nome exato
 *   NEW_UNAMBIGUOUS nao existe no banco E o primeiro nome nao colide com nada
 *   AMBIGUOUS       o primeiro nome colide com um participante do banco que NAO casou exato,
 *                   ou com outro nome da origem — nao da para decidir sem inventar
 */
export function identityMap(sourceRows, db) {
  const dbExact = new Set(db.participants.map((p) => p.nameHash));

  // ─── IDENTIDADE POR INSTANTE DE PAGAMENTO ──────────────────────────────────────────────────
  //
  // Antes de qualquer raciocinio por nome. O instante com precisao de segundo so vale como
  // identidade se for UNICO DOS DOIS LADOS -- se dois registros de qualquer lado compartilham o
  // mesmo instante, ele nao identifica ninguem e e descartado.
  const srcByInstant = new Map();
  for (const r of sourceRows) {
    if (!r.paidKey) continue;
    if (!srcByInstant.has(r.paidKey)) srcByInstant.set(r.paidKey, new Set());
    srcByInstant.get(r.paidKey).add(r.nameHash);
  }
  const dbByInstant = new Map();
  for (const c of db.contributions) {
    if (!c.paidKey) continue;
    if (!dbByInstant.has(c.paidKey)) dbByInstant.set(c.paidKey, new Set());
    dbByInstant.get(c.paidKey).add(c.nameHash);
  }
  const byInstant = new Map(); // sourceNameHash -> dbNameHash
  for (const [inst, srcSet] of srcByInstant) {
    const dbSet = dbByInstant.get(inst);
    if (!dbSet || srcSet.size !== 1 || dbSet.size !== 1) continue; // ambiguo dos dois lados: descarta
    byInstant.set([...srcSet][0], [...dbSet][0]);
  }

  const map = new Map();
  for (const r of sourceRows) {
    if (map.has(r.nameHash)) continue;
    if (dbExact.has(r.nameHash)) { map.set(r.nameHash, { kind: "EXACT" }); continue; }
    if (byInstant.has(r.nameHash)) {
      map.set(r.nameHash, { kind: "EXACT", via: "PAYMENT_INSTANT", dbNameHash: byInstant.get(r.nameHash) });
      continue;
    }
    // ─── O QUE TORNA UM REGISTRO AMBIGUO, E O QUE NAO TORNA ─────────────────────────────────
    //
    // O risco real e FUNDIR um registro da origem no participante ERRADO do banco. Logo a unica
    // ambiguidade que importa e: sobra algum participante do banco SEM mapeamento cujo primeiro
    // nome colida com este registro?
    //
    // Dois nomes da ORIGEM compartilharem o primeiro nome NAO e ambiguidade -- continuam sendo dois
    // registros distintos, e nenhum dos dois esta sendo fundido em nada. Tratar isso como ambiguo
    // bloqueava importacao legitima (quatro linhas, US$ 40) sem nenhum ganho de seguranca.
    // `dbExact` e o conjunto de nomes QUE O BANCO TEM -- nao "os que ja foram resolvidos". Um
    // participante do banco so esta resolvido se ALGUM registro da origem casou com ele, por nome
    // exato ou por instante de pagamento. Confundir os dois esvaziava o conjunto de nao-resolvidos
    // e desligava o guarda inteiro.
    const dbResolved = new Set([
      ...db.participants.map((p) => p.nameHash).filter((h) => sourceRows.some((x) => x.nameHash === h)),
      ...byInstant.values(),
    ]);
    const dbUnresolvedFirst = new Set(db.participants.filter((p) => !dbResolved.has(p.nameHash)).map((p) => p.firstHash));
    map.set(r.nameHash, dbUnresolvedFirst.has(r.firstHash)
      ? { kind: "AMBIGUOUS", collidesWithDb: true }
      : { kind: "NEW_UNAMBIGUOUS" });
  }
  return map;
}

/** ── ESTAGIO 4: DRY-RUN DIFF ───────────────────────────────────────────────────────────────── */
export function classify(sourceRows, db) {
  const dups = detectDuplicates(sourceRows);
  const idmap = identityMap(sourceRows, db);
  const dbDraws = new Set(db.draws.map((d) => d.drawId));
  // Contribuicoes existentes, por (draw, participante).
  const dbPaid = new Map();
  for (const c of db.contributions) dbPaid.set(`${c.drawId}|${c.nameHash}`, c.amount);

  return sourceRows.map((r) => {
    const id = idmap.get(r.nameHash);
    // Se a identidade veio do instante, a chave de comparacao usa o nome do BANCO, nao o da origem.
    const effHash = id && id.via === "PAYMENT_INSTANT" ? id.dbNameHash : r.nameHash;
    const key = `${r.drawId}|${effHash}`;

    if (dups.has(key)) return { ...r, klass: "DUPLICATE_SOURCE",
      note: "a mesma pessoa aparece mais de uma vez no mesmo sorteio na origem" };

    if (dbPaid.has(key)) {
      const have = dbPaid.get(key);
      return have === r.amount
        ? { ...r, klass: "ALREADY_PRESENT_EXACT", note: "ja registrado com o mesmo valor" }
        : { ...r, klass: "CONFLICT_AMOUNT", note: `banco=${have} origem=${r.amount}` };
    }

    if (id.kind === "AMBIGUOUS") return { ...r, klass: "AMBIGUOUS_MAPPING",
      note: id.collidesWithDb
        ? "primeiro nome colide com um participante do banco que nao casou por nome exato"
        : "primeiro nome colide com outro nome da propria origem" };

    if (!dbDraws.has(r.drawId)) return { ...r, klass: "MISSING_IMPORTABLE",
      note: "sorteio inexistente no banco; exigiria criar draw + participation + contribuicao" };

    return { ...r, klass: "MISSING_IMPORTABLE", note: "contribuicao ausente num sorteio ja existente" };
  });
}

/** ── ESTAGIO 5: VALIDATE TOTALS ────────────────────────────────────────────────────────────── */
export function validateTotals(classified, db) {
  const by = (k) => classified.filter((c) => c.klass === k);
  const sum = (rows) => Number(rows.reduce((a, r) => a + r.amount, 0).toFixed(2));

  const sourceTotal = sum(classified);
  const importable = by(IMPORTABLE);
  const proposed = sum(importable);
  const blocked = classified.filter((c) => !["ALREADY_PRESENT_EXACT", IMPORTABLE].includes(c.klass));

  // A identidade que a autorizacao exige: banco + proposto == origem verificada.
  const expectedAfter = Number((db.paymentTotal + proposed).toFixed(2));
  const balances = Number((db.contributionTotal + proposed).toFixed(2)) === sourceTotal;

  return {
    sourceTotal, sourceRows: classified.length,
    proposedRows: importable.length, proposedAmount: proposed,
    blockedRows: blocked.length, blockedAmount: sum(blocked),
    dbPaymentTotal: db.paymentTotal, dbContributionTotal: db.contributionTotal,
    expectedAfter, balances,
    counts: Object.fromEntries(CLASSES.map((c) => [c, by(c).length])),
  };
}

export function loadSource(path = DATA_JS) {
  const text = readFileSync(path, "utf8");
  return { rows: parseSource(text), sha256: sha(text) };
}

function main() {
  const args = process.argv.slice(2);
  const dbPath = args[args.indexOf("--db") + 1];
  if (!dbPath || args.indexOf("--db") === -1) {
    console.error("uso: node backfill_reconcile.mjs --db <arquivo json do estado do banco> [--json]");
    return 2;
  }
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  const { rows, sha256 } = loadSource();
  const classified = classify(rows, db);
  const totals = validateTotals(classified, db);

  if (args.includes("--json")) {
    console.log(JSON.stringify({ sourceSha256: sha256, totals, classified: classified.map((c) => ({
      drawId: c.drawId, participant: mask(c.nameHash), amount: c.amount, klass: c.klass, note: c.note })) }, null, 2));
    return totals.balances ? 0 : 3;
  }

  console.log(`\nRECONCILIACAO DO BACKFILL HISTORICO (Issue #130)\n`);
  console.log(`  origem sha256          ${sha256.slice(0, 16)}…`);
  console.log(`  registros na origem    ${totals.sourceRows}   total ${totals.sourceTotal.toFixed(2)}`);
  console.log(`  banco: contribuicoes   ${totals.dbContributionTotal.toFixed(2)}   todas as transacoes ${totals.dbPaymentTotal.toFixed(2)}\n`);
  console.log("  classificacao:");
  for (const [k, v] of Object.entries(totals.counts)) if (v) console.log(`    ${k.padEnd(24)}${v}`);
  console.log(`\n  IMPORTAVEL             ${totals.proposedRows} linhas, ${totals.proposedAmount.toFixed(2)}`);
  console.log(`  BLOQUEADO              ${totals.blockedRows} linhas, ${totals.blockedAmount.toFixed(2)}`);
  console.log(`\n  aritmetica fecha?      ${totals.balances ? "SIM" : "NAO"}`);
  if (!totals.balances) {
    console.log(`    ${totals.dbContributionTotal.toFixed(2)} (banco) + ${totals.proposedAmount.toFixed(2)} (proposto) `
      + `= ${(totals.dbContributionTotal + totals.proposedAmount).toFixed(2)} != ${totals.sourceTotal.toFixed(2)} (origem)`);
    console.log(`    A autorizacao exige igualdade EXATA. Sem ela, nenhuma linha financeira e escrita.`);
  }
  return totals.balances ? 0 : 3;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
