#!/usr/bin/env node
/**
 * CDB2026 — o site só trava confronto empatado quando a ESPN CONFIRMA os pênaltis (#598).
 *
 * Par do test_penalty_winner_guard.py (o --auto). Aqui é o autoSyncEspnResults() do admin: com o
 * agregado empatado ele travava pelo `winner` da ESPN sem olhar o status — o mesmo defeito que
 * travou o Vasco na semifinal de 2026-11-08 (Vasco 2x1 no jogo, Palmeiras nos pênaltis).
 *
 * Roda a função REAL extraída do app.js e confere que autoSyncEspnResults() a usa e que o
 * candidato da ESPN carrega `penaltiesFinal` a partir do status.
 *
 * Uso: node bolao/cdb2026/scripts/test_penalty_winner_guard.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(AQUI, "..", "js", "app.js"), "utf8");

let ok = 0, fail = 0;
const T = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

function extrair(nome) {
  let i = APP.indexOf(`\nfunction ${nome}(`);
  if (i === -1) i = APP.indexOf(`\nasync function ${nome}(`);
  A(i !== -1, `função ${nome}() não encontrada em app.js`);
  let d = 0, j = i, started = false;
  for (; j < APP.length; j++) {
    if (APP[j] === "{") { d++; started = true; }
    else if (APP[j] === "}") { d--; if (started && d === 0) { j++; break; } }
  }
  return APP.slice(i, j);
}
const lado = new Function(`${extrair("espnPenaltyWinnerSide")}; return espnPenaltyWinnerSide;`)();
const TIE = { teamA: "Vasco", teamB: "Palmeiras" };
const volta = o => ({ homeTeam: "Vasco", awayTeam: "Palmeiras", homeWinner: false, awayWinner: false, penaltiesFinal: false, ...o });

console.log("\nCDB2026 — vencedor nos pênaltis no site (#598)\n");
T("a janela de 22:26Z (Vasco marcado vencedor da partida, sem status de pênaltis) -> não trava",
  () => A(lado(volta({ homeWinner: true }), TIE) === null, "travou sem status de pênaltis"));
T("pênaltis confirmados, Palmeiras vencedor -> B (lado pelo NOME, Palmeiras é visitante real)",
  () => A(lado(volta({ awayWinner: true, penaltiesFinal: true }), TIE) === "B", "lado errado"));
T("pênaltis confirmados com o mando invertido -> continua pelo nome",
  () => A(lado({ homeTeam: "Palmeiras", awayTeam: "Vasco", homeWinner: true, awayWinner: false, penaltiesFinal: true }, TIE) === "B", "lado errado"));
T("os dois flags ligados -> ambíguo, não trava",
  () => A(lado(volta({ homeWinner: true, awayWinner: true, penaltiesFinal: true }), TIE) === null, "travou ambíguo"));
T("nenhum flag -> não trava", () => A(lado(volta({ penaltiesFinal: true }), TIE) === null, "travou sem vencedor"));
T("evento ausente -> não trava", () => A(lado(null, TIE) === null && lado(undefined, TIE) === null, "travou sem evento"));

T("autoSyncEspnResults() decide o empate por espnPenaltyWinnerSide(), não pelo flag cru", () => {
  const corpo = extrair("autoSyncEspnResults");
  A(corpo.includes("qualified = espnPenaltyWinnerSide(ev, tie);"), "o empate não passa pela guarda");
  A(!/ev\?\.homeWinner === true\) qualified/.test(corpo), "voltou a travar pelo flag cru");
});
T("o candidato da ESPN calcula penaltiesFinal por FINAL_PEN/SHOOTOUT/PENALT (nunca 'PEN' solto)", () => {
  const m = APP.match(/penaltiesFinal: evState === "post" && !postponed\s*&& \((.*)\),\n/);
  A(m, "penaltiesFinal ausente do candidato");
  A(/FINAL_PEN/.test(m[1]) && /SHOOTOUT/.test(m[1]) && /PENALT/.test(m[1]), m[1]);
  A(!/includes\("PEN"\)/.test(m[1]), "'PEN' solto casaria com STATUS_SUSPENDED");
});

console.log(`\n${fail ? "✗" : "✓"} ${ok} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
