#!/usr/bin/env node
/**
 * CADENCIA DO PRODUTOR DO CACHE AO VIVO — Issue #259.
 *
 * ─── A DECISAO QUE ESTE TESTE FIXA ───────────────────────────────────────────────────────────
 *
 * O produtor tinha um um cron de 30 em 30 minutos nas horas 3-13 fora da janela de jogo, justificado como "cadencia baixa,
 * so para manter o caminho vivo e visivel". Ele nao entregava nenhuma das duas coisas:
 *
 *   FRESCOR e impossivel por aritmetica. O gateway descarta ultimo-bom-conhecido com mais de
 *   `LAST_KNOWN_GOOD_MAX_AGE_MS` = 10 min. Uma cadencia de 30 min deixa o cache velho demais por
 *   20 de cada 30 minutos, MESMO quando a execucao grava com sucesso. 30 > 10 nunca cabe.
 *
 *   CAMINHO EXERCITADO nao acontece. `produceOne` devolve `SKIPPED_OUT_OF_WINDOW` ANTES de
 *   qualquer rede e antes de tocar na credencial, e entre 03h e 13h UTC o calendario commitado nao
 *   tem NENHUMA partida.
 *
 * ─── POR QUE UM TESTE, E NAO SO APAGAR A LINHA ───────────────────────────────────────────────
 *
 * Porque a linha era plausivel. Ela volta na primeira vez que alguem olhar o 503 fora de janela e
 * pensar "e so agendar mais". Este teste transforma a decisao em algo que reprova, e -- mais
 * importante -- fixa a ARITMETICA, para que qualquer cadencia futura que nao caiba no teto do
 * gateway reprove pelo motivo certo em vez de parecer razoavel.
 *
 * Sem rede. Uso: node bolao/scripts/test_live_producer_cadence.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WF = join(REPO, ".github/workflows/live_cache_producer.yml");
const GATEWAY = join(REPO, "supabase/functions/_shared/gateway_core.js");
const PRODUCER = join(REPO, "bolao/shared/scripts/produce_live_cache.mjs");

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const wf = readFileSync(WF, "utf8");

/** Linhas `- cron: "..."` do bloco `schedule`, sem comentario. */
function crons(text) {
  return [...text.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map((m) => m[1].trim());
}

/** Passo em minutos de um cron cujo campo de minuto e um intervalo (asterisco-barra-N). */
function stepMinutes(cron) {
  const m = cron.split(/\s+/)[0];
  const step = /^\*\/(\d+)$/.exec(m);
  return step ? Number(step[1]) : null;
}

/** Horas UTC que um cron cobre. */
function hoursOf(cron) {
  const h = cron.split(/\s+/)[1];
  const out = new Set();
  for (const part of h.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) { for (let i = +range[1]; i <= +range[2]; i++) out.add(i); continue; }
    if (part === "*") { for (let i = 0; i < 24; i++) out.add(i); continue; }
    if (/^\d+$/.test(part)) out.add(+part);
  }
  return out;
}

const LIVE_HOURS = new Set([...Array(10).keys()].map((i) => i + 14).concat([0, 1, 2])); // 14-23, 0-2

console.log("\nCADENCIA DO PRODUTOR DO CACHE AO VIVO (Issue #259)\n");

// ── 1 ────────────────────────────────────────────────────────────────────────────────────────
test("1. nao existe agendamento fora da janela de jogo", () => {
  const fora = crons(wf).filter((c) => [...hoursOf(c)].some((h) => !LIVE_HOURS.has(h)));
  assert(fora.length === 0, `cron fora da janela 14-23/0-2: ${fora.join(" | ")}`);
});

// ── 2 ────────────────────────────────────────────────────────────────────────────────────────
test("2. a janela de jogo continua agendada, e nas duas metades", () => {
  const cs = crons(wf);
  assert(cs.length >= 2, `esperava pelo menos dois crons de janela, achei ${cs.length}`);
  const cobertas = new Set(cs.flatMap((c) => [...hoursOf(c)]));
  for (const h of LIVE_HOURS) assert(cobertas.has(h), `a hora ${h}h UTC deixou de ser coberta`);
  // A metade da noite (0-2) e a que cobre os kickoffs de 22h/23h que atravessam a meia-noite.
  assert(cs.some((c) => hoursOf(c).has(0)), "a metade apos a meia-noite sumiu");
});

// ── 3 ────────────────────────────────────────────────────────────────────────────────────────
test("3. toda cadencia agendada cabe no teto de ultimo-bom-conhecido do gateway", () => {
  // A aritmetica que condenou o `*/30`: passo maior que o teto NUNCA entrega frescor.
  const teto = /LAST_KNOWN_GOOD_MAX_AGE_MS\s*=\s*(\d+)\s*\*\s*60_?000/.exec(readFileSync(GATEWAY, "utf8"));
  assert(teto, "nao consegui ler LAST_KNOWN_GOOD_MAX_AGE_MS do gateway");
  const tetoMin = Number(teto[1]);
  assert(tetoMin === 10, `o teto mudou para ${tetoMin} min — reavalie a cadencia junto (Issue #259)`);
  for (const c of crons(wf)) {
    const passo = stepMinutes(c);
    assert(passo !== null, `cron sem passo de minuto reconhecivel: ${c}`);
    assert(passo <= tetoMin,
      `cadencia de ${passo} min nao cabe no teto de ${tetoMin} min — o cache fica velho por ${passo - tetoMin} min de cada ${passo}, mesmo gravando com sucesso`);
  }
});

// ── 4 ────────────────────────────────────────────────────────────────────────────────────────
test("4. a logica de elegibilidade continua intacta, e ainda pula ANTES da rede", () => {
  const src = readFileSync(PRODUCER, "utf8");
  assert(/WINDOW_LOOKBACK_MS\s*=\s*3\s*\*\s*60\s*\*\s*60_?000/.test(src), "WINDOW_LOOKBACK_MS deixou de ser 3h");
  assert(/WINDOW_LOOKAHEAD_MS\s*=\s*60\s*\*\s*60_?000/.test(src), "WINDOW_LOOKAHEAD_MS deixou de ser 1h");
  assert(/SKIPPED_OUT_OF_WINDOW/.test(src), "o caminho de skip sumiu");

  // O skip tem de vir ANTES do fetch: e o que torna uma execucao fora de janela incapaz de
  // exercitar provedor, escrita ou credencial -- o motivo pelo qual o `*/30` nao era um canario.
  const iSkip = src.indexOf("SKIPPED_OUT_OF_WINDOW");
  const iFetch = src.indexOf("fetchImpl(espnUrlFor");
  assert(iSkip !== -1 && iFetch !== -1 && iSkip < iFetch,
    "o skip fora de janela precisa acontecer antes da chamada de rede");
});

// ── 5 ────────────────────────────────────────────────────────────────────────────────────────
test("5. nenhuma promessa de frescor continuo sobrou — e o registro do porque continua", () => {
  // Cuidado com o alvo. Proibir a STRING no arquivo inteiro reprovaria o proprio comentario que
  // explica por que o cron saiu -- e esse comentario e a defesa contra ele voltar. O que nao pode
  // existir e um AGENDAMENTO; citar o agendamento removido, com o motivo, e o oposto de um defeito.
  const bloco = /on:\s*\n\s*schedule:\n([\s\S]*?)\n\s*workflow_dispatch:/.exec(wf);
  assert(bloco, "nao consegui isolar o bloco `schedule:` do workflow");
  assert(!/\*\/30/.test(bloco[1]), `ainda ha um agendamento de 30 min: ${bloco[1].trim()}`);
  assert(!/3-13/.test(bloco[1]), "ainda ha agendamento nas horas 3-13");

  // E a prosa nao pode prometer o que a aritmetica nega.
  assert(/Issue #259/.test(wf), "o workflow precisa registrar por que nao ha cadencia fora da janela");
  assert(/SOURCE_UNAVAILABLE/.test(wf), "o comportamento honesto fora da janela tem de continuar declarado");
  assert(!/mantem o cache fresco fora|frescor continuo|sempre fresco/i.test(wf),
    "o workflow nao pode afirmar frescor fora da janela — o teto de 10 min o desmente");
});

// ── 6 ────────────────────────────────────────────────────────────────────────────────────────
test("6. o caminho de verificacao da #246 continua intacto", () => {
  // O produtor existe por causa da #246 (Akamai bloqueando o egresso do Edge Runtime). Remover
  // cadencia nao pode ter removido o produtor, o dispatch manual nem o alvo de escrita.
  assert(/workflow_dispatch/.test(wf), "o dispatch manual sumiu — e como a #246 e verificada sob demanda");
  assert(/dry_run/.test(wf) && /force/.test(wf), "as entradas dry_run/force do dispatch sumiram");
  assert(/produce_live_cache\.mjs/.test(wf), "o produtor deixou de ser executado");
  assert(/SUPABASE_SERVICE_ROLE_KEY/.test(wf), "a credencial privilegiada de escrita sumiu do ambiente");
  assert(/live_sports_cache/.test(wf), "o alvo de escrita deixou de estar declarado");
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
