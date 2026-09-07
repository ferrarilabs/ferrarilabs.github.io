/**
 * test_broadcast_operations.mjs — modelo operacional de "Onde assistir" (Issue #425).
 *
 * Cobre o que test_where_to_watch.mjs não cobre: a VALIDAÇÃO do arquivo de dados
 * (bolao/shared/data/broadcasts.json) e o DETECTOR de lacunas de cobertura
 * (check_broadcast_coverage.mjs) — as duas peças novas do modelo "descoberta da fonte continua
 * humana; completude e detecção operacional são automatizadas".
 */
import { validate } from "./validate_broadcasts.mjs";
import { upcomingWithoutCoverage, findBroadcast } from "./check_broadcast_coverage.mjs";

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

function entry(over) {
  return {
    espnId: "1", kickoffUtc: "2026-09-20T20:00Z", home: "Flamengo", away: "Vasco",
    channels: ["Globo"], source: "fonte-de-teste.example", confirmedAt: "2026-09-18",
    ...over,
  };
}

console.log("\nOnde assistir — modelo operacional (validação + detector de lacunas)\n");

console.log("A. validate_broadcasts — identidade e integridade do registro");

test("registro completo e único é válido", () => {
  const r = validate({ entries: [entry()] });
  A(r.ok, JSON.stringify(r.errors));
});

test("sem espnId E sem kickoffUtc+home+away completos ⇒ erro (identidade insuficiente)", () => {
  const r = validate({ entries: [entry({ espnId: undefined, kickoffUtc: undefined })] });
  A(!r.ok, "deveria reprovar identidade ambígua");
});

test("channels vazio ⇒ erro", () => {
  const r = validate({ entries: [entry({ channels: [] })] });
  A(!r.ok && r.errors.some((e) => e.includes("channels")), JSON.stringify(r.errors));
});

test("source ausente ⇒ erro — sem evidência não é curadoria", () => {
  const r = validate({ entries: [entry({ source: "" })] });
  A(!r.ok && r.errors.some((e) => e.includes("source")), JSON.stringify(r.errors));
});

test("confirmedAt inválido ⇒ erro", () => {
  const r = validate({ entries: [entry({ confirmedAt: "não é data" })] });
  A(!r.ok && r.errors.some((e) => e.includes("confirmedAt")), JSON.stringify(r.errors));
});

test("dois registros com o MESMO espnId ⇒ duplicata/conflito reprova", () => {
  const r = validate({ entries: [entry({ espnId: "9" }), entry({ espnId: "9", home: "Outro" })] });
  A(!r.ok && r.errors.some((e) => /espnId duplicado/.test(e)), JSON.stringify(r.errors));
});

test("mesma partida (minuto+times) cadastrada duas vezes ⇒ reprova, mesmo sem espnId", () => {
  const r = validate({
    entries: [
      entry({ espnId: undefined, kickoffUtc: "2026-09-20T20:00Z", home: "Santos", away: "Palmeiras" }),
      entry({ espnId: undefined, kickoffUtc: "2026-09-20T20:00Z", home: "Santos", away: "Palmeiras", channels: ["sportv"] }),
    ],
  });
  A(!r.ok, "duas entradas para a mesma partida deveriam colidir");
});

test("NÃO reaproveita entre os dois turnos do mesmo confronto (mando invertido, minutos diferentes)", () => {
  // Ida: Santos x Palmeiras. Volta (mando trocado, outra data): Palmeiras x Santos. São
  // identidades DIFERENTES por construção (minuto muda) — não pode reprovar como duplicata.
  const r = validate({
    entries: [
      entry({ espnId: undefined, kickoffUtc: "2026-09-06T20:00Z", home: "Santos", away: "Palmeiras" }),
      entry({ espnId: undefined, kickoffUtc: "2026-11-01T20:00Z", home: "Palmeiras", away: "Santos", channels: ["Premiere"] }),
    ],
  });
  A(r.ok, `turnos distintos do mesmo confronto não deveriam colidir: ${JSON.stringify(r.errors)}`);
});

test("confirmedAt muito anterior ao kickoff ⇒ AVISO (stale), não erro — transmissão BR muda de última hora", () => {
  const r = validate({ entries: [entry({ confirmedAt: "2026-08-01", kickoffUtc: "2026-09-20T20:00Z" })] });
  A(r.ok, "staleness não deve reprovar o arquivo");
  A(r.warnings.length === 1, `esperado 1 aviso de staleness, veio ${r.warnings.length}`);
});

test("confirmedAt próximo do kickoff ⇒ sem aviso", () => {
  const r = validate({ entries: [entry({ confirmedAt: "2026-09-19", kickoffUtc: "2026-09-20T20:00Z" })] });
  A(r.ok && r.warnings.length === 0, JSON.stringify(r));
});

console.log("\nB. check_broadcast_coverage — detector de lacunas");

const NOW = new Date("2026-09-10T00:00Z");
const fixtures = [
  { id: "10", date: "2026-09-12T20:00Z", homeTeam: "Flamengo", awayTeam: "Vasco", completed: false },
  { id: "11", date: "2026-09-13T20:00Z", homeTeam: "Santos", awayTeam: "Palmeiras", completed: false },
  { id: "12", date: "2026-09-05T20:00Z", homeTeam: "Bahia", awayTeam: "Sport", completed: true }, // já jogou
  { id: "13", date: "2026-11-01T20:00Z", homeTeam: "Grêmio", awayTeam: "Cruzeiro", completed: false }, // fora da janela
];

test("partida futura SEM registro aparece no detector como MISSING", () => {
  const rows = upcomingWithoutCoverage(fixtures, [], { now: NOW, windowDays: 21 });
  const row = rows.find((r) => r.espnId === "10");
  A(row && !row.covered, "jogo sem cobertura deveria aparecer como não coberto");
});

test("partida futura COM registro correto some da lista de faltantes (aparece como OK)", () => {
  const broadcasts = [entry({ espnId: "10", channels: ["Globo"] })];
  const rows = upcomingWithoutCoverage(fixtures, broadcasts, { now: NOW, windowDays: 21 });
  const row = rows.find((r) => r.espnId === "10");
  A(row && row.covered, "jogo coberto deveria aparecer como OK, não MISSING");
  A(row.status.includes("Globo"), row.status);
});

test("registro de OUTRA partida não cobre esta (sem falso positivo)", () => {
  const broadcasts = [entry({ espnId: "999", home: "Time A", away: "Time B" })];
  const rows = upcomingWithoutCoverage(fixtures, broadcasts, { now: NOW, windowDays: 21 });
  const row = rows.find((r) => r.espnId === "10");
  A(row && !row.covered, "registro de outra partida não pode cobrir esta");
});

test("jogo já concluído não aparece no detector (não é 'próximo jogo')", () => {
  const rows = upcomingWithoutCoverage(fixtures, [], { now: NOW, windowDays: 21 });
  A(!rows.some((r) => r.espnId === "12"), "jogo concluído não deveria estar na lista de próximos");
});

test("jogo fora da janela de dias não aparece", () => {
  const rows = upcomingWithoutCoverage(fixtures, [], { now: NOW, windowDays: 21 });
  A(!rows.some((r) => r.espnId === "13"), "jogo em novembro está fora da janela de 21 dias");
});

test("lista sai ordenada por kickoff, não pela ordem de entrada", () => {
  const rows = upcomingWithoutCoverage(fixtures, [], { now: NOW, windowDays: 21 });
  const kickoffs = rows.map((r) => Date.parse(r.kickoff));
  const sorted = [...kickoffs].sort((a, b) => a - b);
  A(JSON.stringify(kickoffs) === JSON.stringify(sorted), "não está ordenado por kickoff");
});

test("findBroadcast do detector casa pela mesma identidade do navegador (id, ou minuto+times)", () => {
  // Sem id no descritor (como o CDB2026, que nunca carrega o id ESPN em memória) — o registro
  // também sem espnId, casando só por minuto+times. Mesma semântica de findBroadcast() em
  // where_to_watch.js: o fallback existe para quando quem PERGUNTA não tem id, não para quando
  // o REGISTRO não tem id.
  const broadcasts = [entry({ espnId: undefined, kickoffUtc: "2026-09-13T20:00Z", home: "Santos", away: "Palmeiras" })];
  const found = findBroadcast({ id: undefined, kickoff: "2026-09-13T20:00Z", home: "Santos", away: "Palmeiras" }, broadcasts);
  A(found, "deveria casar por minuto+times quando nem quem pergunta nem o registro têm id");
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ BROADCAST OPERATIONS FAILED" : "✓ BROADCAST OPERATIONS OK");
process.exit(fail ? 1 : 0);
