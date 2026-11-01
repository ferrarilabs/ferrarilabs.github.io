/**
 * test_espn_leg_matching.mjs — qual perna do bolão um jogo da ESPN é, e de quem são os gols.
 *
 * ─── O DEFEITO (produção, 2026-11-01) ───────────────────────────────────────────────────────
 *
 * Semifinal Palmeiras × Vasco. O bolão tinha Vasco em casa na ida (1/11) e Palmeiras na volta
 * (8/11); a CBF marcou a ida no Allianz. O casamento era por MANDANTE: Palmeiras 1 × 0 Vasco de
 * 1/11 bateu com a volta nominal (Palmeiras em casa, dentro da janela de 21 dias) e foi gravado
 * nela. A ida ficou vazia e saiu e-mail "Vasco × Palmeiras (volta)".
 *
 * Decisão do Eduardo (2026-11-01): o palpite da ida vale para o jogo da data da ida.
 *
 * ─── O QUE ESTE GATE PROVA ──────────────────────────────────────────────────────────────────
 *
 *   1. com as duas pernas datadas, a perna é a de data mais próxima e os gols vão para cada TIME
 *      pelo nome — nunca trocados de lado;
 *   2. sem as duas datas, vale a regra antiga, mas um jogo a menos de 48h de OUTRA perna datada
 *      nunca vira esta perna;
 *   3. PARIDADE: espnEventForLeg() (app.js) e espn_event_for_leg() (send_result_email.py)
 *      respondem igual em todos os cenários — o site e o e-mail não podem discordar.
 *
 * Hermético: sem rede, sem provedor, sem participante. Lê o código-fonte real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CDB = readFileSync(join(ROOT, "bolao", "cdb2026", "js", "app.js"), "utf8");

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

function extrairFuncao(src, nome) {
  const i = src.indexOf(`function ${nome}(`);
  A(i !== -1, `função ${nome}() não encontrada`);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
const janela = CDB.match(/const RESULT_MATCH_WINDOW_DAYS = (\d+);/);
A(janela, "RESULT_MATCH_WINDOW_DAYS não encontrado");
const espnEventForLeg = new Function(`const RESULT_MATCH_WINDOW_DAYS = ${janela[1]};
${extrairFuncao(CDB, "withinResultMatchWindow")}
${extrairFuncao(CDB, "espnEventForLeg")}
return espnEventForLeg;`)();

const LEGS = ["first", "second"];
const tie = (a, b, k1, k2) => ({ teamA: a, teamB: b, matches: { first: k1 ? { kickoff: k1 } : {}, second: k2 ? { kickoff: k2 } : {} } });
const ev = (home, away, hs, as, dateISO) => ({ homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as, dateISO });

// [nome, confronto, perna, candidatos, esperado: null | [gols casa nominal, gols fora nominal, data do evento]]
const SEMI = tie("Vasco", "Palmeiras", "2026-11-01T20:00:00+00:00", "2026-11-08T20:00:00+00:00");
const IDA_REAL = ev("Palmeiras", "Vasco", 1, 0, "2026-11-01T19:00Z");
const QF = tie("Cruzeiro", "Atlético-MG", "2026-08-25T21:00:00-03:00", "2026-09-01T21:00:00-03:00");
const QF_SEM_VOLTA = tie("Cruzeiro", "Atlético-MG", "2026-08-25T21:00:00-03:00", null);
const FINAL = { teamA: "Grêmio", teamB: "Palmeiras", matches: { single: { kickoff: "2026-12-06T20:00:00Z" } } };
const FINAL_SEM_DATA = { teamA: "Grêmio", teamB: "Palmeiras", matches: { single: {} } };
const CENARIOS = [
  ["semi 1/11: Palmeiras 1x0 Vasco é a IDA, Vasco 0 x 1 Palmeiras", SEMI, "first", [IDA_REAL], [0, 1, IDA_REAL.dateISO]],
  ["semi 1/11: o mesmo jogo NÃO é a volta", SEMI, "second", [IDA_REAL], null],
  ["semi 8/11: Vasco 2x0 Palmeiras é a VOLTA, Palmeiras 0 x 2 Vasco", SEMI, "second",
    [IDA_REAL, ev("Vasco", "Palmeiras", 2, 0, "2026-11-08T20:00Z")], [0, 2, "2026-11-08T20:00Z"]],
  ["semi: volta antecipada um dia ainda é a volta", SEMI, "second",
    [ev("Vasco", "Palmeiras", 1, 1, "2026-11-07T21:00Z")], [1, 1, "2026-11-07T21:00Z"]],
  ["mando normal na ida continua igual", QF, "first", [ev("Cruzeiro", "Atlético-MG", 2, 1, "2026-08-25T21:00:00-03:00")], [2, 1, "2026-08-25T21:00:00-03:00"]],
  ["mando normal na volta continua igual", QF, "second", [ev("Atlético-MG", "Cruzeiro", 3, 0, "2026-09-01T21:00:00-03:00")], [3, 0, "2026-09-01T21:00:00-03:00"]],
  ["mando invertido na data da ida -> ida, gols pelo time", QF, "first", [ev("Atlético-MG", "Cruzeiro", 2, 1, "2026-08-25T21:00:00-03:00")], [1, 2, "2026-08-25T21:00:00-03:00"]],
  ["time errado -> nada", QF, "first", [ev("Cruzeiro", "Flamengo", 2, 1, "2026-08-25T21:00:00-03:00")], null],
  ["outra temporada -> nada", QF, "first", [ev("Cruzeiro", "Atlético-MG", 2, 1, "2025-08-25T21:00:00-03:00")], null],
  ["sem data da volta: mando invertido no dia da ida NÃO vira volta", QF_SEM_VOLTA, "second", [ev("Atlético-MG", "Cruzeiro", 2, 1, "2026-08-25T21:00:00-03:00")], null],
  ["sem data da volta: volta de verdade uma semana depois é aceita", QF_SEM_VOLTA, "second", [ev("Atlético-MG", "Cruzeiro", 2, 1, "2026-09-01T21:00:00-03:00")], [2, 1, "2026-09-01T21:00:00-03:00"]],
  ["sem data da volta: mando invertido NÃO vira ida (regra antiga)", QF_SEM_VOLTA, "first", [ev("Atlético-MG", "Cruzeiro", 2, 1, "2026-08-25T21:00:00-03:00")], null],
  ["FINAL jogo único, mando ESPN = lado B: gols pelo time", FINAL, "single",
    [ev("Palmeiras", "Grêmio", 2, 1, "2026-12-06T20:00Z")], [1, 2, "2026-12-06T20:00Z"]],
  ["FINAL jogo único, mando ESPN = lado A", FINAL, "single",
    [ev("Grêmio", "Palmeiras", 0, 0, "2026-12-06T20:00Z")], [0, 0, "2026-12-06T20:00Z"]],
  ["FINAL sem data: mando invertido NÃO é aceito (regra antiga)", FINAL_SEM_DATA, "single",
    [ev("Palmeiras", "Grêmio", 2, 1, "2026-12-06T20:00Z")], null],
  ["FINAL: jogo de outro mês entre os mesmos times -> nada", FINAL, "single",
    [ev("Palmeiras", "Grêmio", 2, 1, "2026-09-06T20:00Z")], null],
];

const legsOf = leg => (leg === "single" ? ["single"] : LEGS);
const js = ([, t, leg, cands]) => {
  const r = espnEventForLeg(cands, t, leg, legsOf(leg), c => c.homeScore != null);
  return r ? [r.goalsHome, r.goalsAway, r.ev.dateISO] : null;
};

console.log("\nCDB2026 — perna da ESPN por par de times e data (2026-11-01)\n");
console.log("A. app.js");
for (const c of CENARIOS) {
  test(c[0], () => {
    const got = js(c);
    A(JSON.stringify(got) === JSON.stringify(c[4]), `esperado ${JSON.stringify(c[4])}, veio ${JSON.stringify(got)}`);
  });
}

console.log("\nB. paridade com send_result_email.py");
const py = spawnSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, "bolao", "cdb2026", "scripts"))})
import send_result_email as S
out = []
for t, leg, cands in json.load(sys.stdin):
    legs = ["single"] if leg == "single" else ["first", "second"]
    ev, gh, ga = S.espn_event_for_leg(cands, t, leg, legs, accept=lambda c: c["homeScore"] is not None)
    out.append([gh, ga, ev["dateISO"]] if ev else None)
print(json.dumps(out))
`], { input: JSON.stringify(CENARIOS.map(([, t, leg, cands]) => [t, leg, cands])), encoding: "utf8",
      env: { ...process.env, BOLAO_TEST_RUN: "1" } });
test("o Python rodou", () => A(py.status === 0, py.stderr.slice(-600)));
if (py.status === 0) {
  const pyOut = JSON.parse(py.stdout.trim().split("\n").pop());
  CENARIOS.forEach((c, i) => test(`paridade: ${c[0]}`, () => {
    A(JSON.stringify(pyOut[i]) === JSON.stringify(js(c)), `app.js ${JSON.stringify(js(c))} x python ${JSON.stringify(pyOut[i])}`);
  }));
}

console.log("\nC. todo casamento por mandante no app passa pela mesma função");
test("nenhum `c.homeTeam === home && c.awayTeam === away` fora de espnEventForLeg", () => {
  const semFuncao = CDB.replace(extrairFuncao(CDB, "espnEventForLeg"), "");
  A(!/homeTeam === (home|decisiveHome) && c\.awayTeam === (away|decisiveAway)/.test(semFuncao),
    "voltou um casamento por mandante fora de espnEventForLeg() — é exatamente o defeito de 2026-11-01");
});

console.log(`\n${fail ? "✗" : "✓"} ${ok} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
