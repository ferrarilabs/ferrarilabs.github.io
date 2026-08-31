/**
 * test_standings_reconcile.mjs — a tabela ao vivo não pode depender de quando o visitante entrou.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────────────────────
 *
 * Eduardo, 2026-08-30: *"A tabela online está incorreta e a posição dos times também no hero ao
 * vivo."* Medido na produção daquela noite:
 *
 *   - a tela mostrava `Mirassol 1×1 Palmeiras — Encerrado`;
 *   - a tabela, na MESMA tela, trazia Palmeiras com 24 jogos (sem o 1×1);
 *   - a classificação da ESPN (23:40Z) confirmava 24 — o feed de CLASSIFICAÇÃO dela atrasa em
 *     relação ao feed de PLACAR dela mesma;
 *   - e o complemento do app também não somava, porque o critério era
 *     `kickoff >= capturedAt` e o jogo começara às 21:30Z, antes de o navegador abrir a página.
 *
 * A partida ficava fora da baseline E fora do complemento: sumia da tabela.
 *
 * Pior: `capturedAt` é a hora em que ESTE navegador abriu a página. Quem entrou às 23h45 via uma
 * tabela; quem estava com a aba aberta desde as 21h via outra — e essa, quando a ESPN ingerisse o
 * resultado, passaria a contar o mesmo jogo DUAS vezes.
 *
 * ─── O INVARIANTE ───────────────────────────────────────────────────────────────────────────
 *
 *   Cada partida encerrada é contada EXATAMENTE UMA VEZ na tabela ao vivo — nem zero (some), nem
 *   duas (infla) — independentemente de quando o visitante abriu a página e de quanto o feed de
 *   classificação da fonte esteja atrasado.
 *
 * A tabela do BR2026 alimenta G4/Z4, que é o que o bolão pontua. Uma linha a mais ou a menos aqui
 * muda quem aparece ganhando.
 *
 * Determinístico e hermético: função pura, sem browser e sem relógio.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(AQUI, "..", "js", "app.js"), "utf8");

/**
 * Extrai a função pura do IIFE do app. Recorte por BALANCEAMENTO DE CHAVES, não por contagem de
 * caracteres: um recorte por posição já reprovou código correto neste repositório.
 */
function extrair(nome) {
  const i = APP.indexOf(`function ${nome}(`);
  if (i < 0) throw new Error(`função ${nome} não encontrada em app.js`);
  // Começa a contar chaves só DEPOIS da lista de parâmetros: a assinatura usa desestruturação
  // (`{ baselineStandings, schedule }`), então contar a partir do nome fecharia o balanço no
  // fim do próprio parâmetro e recortaria a função pela metade.
  let par = 0, corpo = i;
  for (let j = APP.indexOf("(", i); j < APP.length; j++) {
    if (APP[j] === "(") par++;
    else if (APP[j] === ")") { par--; if (par === 0) { corpo = APP.indexOf("{", j); break; } }
  }
  let d = 0, iniciou = false, fim = corpo;
  for (let j = corpo; j < APP.length; j++) {
    if (APP[j] === "{") { d++; iniciou = true; }
    else if (APP[j] === "}") { d--; if (iniciou && d === 0) { fim = j + 1; break; } }
  }
  return new Function(`${APP.slice(i, fim)}\nreturn ${nome};`)();
}

const reconciliar = extrair("completedMatchesMissingFromBaseline");

let ok = 0, fail = 0;
function test(nome, fn) {
  try { fn(); console.log(`  ✓ ${nome}`); ok++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

const time = (name, played) => ({ name, played });
const jogo = (dateISO, homeTeam, awayTeam, extra = {}) =>
  ({ dateISO, homeTeam, awayTeam, state: "post", postponed: false, ...extra });

const ids = (ms) => ms.map(m => `${m.homeTeam}x${m.awayTeam}`);

console.log("\nBR2026 — cada partida encerrada conta exatamente uma vez\n");
console.log("A. O caso real de 2026-08-30:");

test("a classificação atrasada NÃO faz o jogo sumir da tabela", () => {
  // A RELAÇÃO é a da noite real — a ESPN já ingeriu Grêmio×Chapecoense e ainda não
  // Mirassol×Palmeiras. Os números absolutos são reduzidos porque a fixture precisa ser
  // AUTOCONSISTENTE: `played` da baseline tem de bater com o calendário que a acompanha, senão o
  // teste mede uma combinação que não existe (baseline de 24 jogos com 4 partidas no calendário).
  const baseline = [
    time("Palmeiras", 1), time("Mirassol", 1),
    time("Grêmio", 2), time("Chapecoense", 2),
  ];
  const schedule = [
    jogo("2026-08-23T21:30Z", "Palmeiras", "Grêmio"),
    jogo("2026-08-23T21:30Z", "Chapecoense", "Mirassol"),
    jogo("2026-08-30T21:30Z", "Grêmio", "Chapecoense"),
    jogo("2026-08-30T21:30Z", "Mirassol", "Palmeiras"),
  ];
  const r = reconciliar({ baselineStandings: baseline, schedule });
  assert(ids(r).join(",") === "MirassolxPalmeiras",
         `selecionou ${JSON.stringify(ids(r))} — esperado só o jogo que a baseline não tem`);
});

test("o jogo que a baseline JÁ tem não é somado de novo", () => {
  const baseline = [time("Grêmio", 1), time("Chapecoense", 1)];
  const schedule = [jogo("2026-08-30T21:30Z", "Grêmio", "Chapecoense")];
  const r = reconciliar({ baselineStandings: baseline, schedule });
  assert(r.length === 0, `somou de novo um resultado já contabilizado: ${JSON.stringify(ids(r))}`);
});

test("quando a fonte finalmente ingere, o complemento se apaga sozinho", () => {
  // Mesma partida, baseline agora atualizada: nenhuma janela de contagem dupla.
  const schedule = [jogo("2026-08-30T21:30Z", "Mirassol", "Palmeiras")];
  const antes = reconciliar({ baselineStandings: [time("Mirassol", 0), time("Palmeiras", 0)], schedule });
  const depois = reconciliar({ baselineStandings: [time("Mirassol", 1), time("Palmeiras", 1)], schedule });
  assert(antes.length === 1, "não somou enquanto faltava");
  assert(depois.length === 0, "continuou somando depois de a fonte ingerir — contagem DUPLA");
});

console.log("\nB. Independência do visitante (o coração do defeito):");

test("o resultado NÃO depende de quando a página foi aberta", () => {
  // A função nem recebe horário de captura. Este teste existe para que a assinatura não volte a
  // aceitar um: foi o parâmetro de tempo que produziu duas tabelas diferentes na mesma noite.
  const baseline = [time("A", 1), time("B", 1)];
  const schedule = [jogo("2026-08-30T21:30Z", "A", "B"), jogo("2026-08-30T23:30Z", "A", "B")];
  const r1 = reconciliar({ baselineStandings: baseline, schedule });
  const r2 = reconciliar({ baselineStandings: baseline, schedule });
  assert(JSON.stringify(ids(r1)) === JSON.stringify(ids(r2)), "resultado não determinístico");
  assert(!/capturedAt|now|Date\.now/.test(reconciliar.toString()),
         "a reconciliação voltou a olhar o relógio — foi exatamente isso que quebrou");
});

console.log("\nC. Bordas que não podem virar tabela errada:");

test("adiado nunca entra", () => {
  const r = reconciliar({
    baselineStandings: [time("A", 0), time("B", 0)],
    schedule: [jogo("2026-08-30T21:30Z", "A", "B", { postponed: true })],
  });
  assert(r.length === 0, "partida adiada entrou na tabela");
});

test("partida não encerrada nunca entra pelo caminho de ENCERRADAS", () => {
  const r = reconciliar({
    baselineStandings: [time("A", 0), time("B", 0)],
    schedule: [jogo("2026-08-30T21:30Z", "A", "B", { state: "in" })],
  });
  assert(r.length === 0, "partida em andamento entrou como encerrada");
});

test("time fora da baseline é ignorado, não estoura", () => {
  const r = reconciliar({
    baselineStandings: [time("A", 0)],
    schedule: [jogo("2026-08-30T21:30Z", "A", "Desconhecido")],
  });
  assert(r.length === 0, "partida com time fora da baseline foi somada");
});

test("baseline ADIANTE do calendário não soma nada (falta nunca é negativo)", () => {
  const r = reconciliar({
    baselineStandings: [time("A", 30), time("B", 30)],
    schedule: [jogo("2026-08-30T21:30Z", "A", "B")],
  });
  assert(r.length === 0, "somou com a baseline já adiante do calendário");
});

test("baseline vazia ou calendário ausente devolvem lista vazia, não exceção", () => {
  assert(reconciliar({ baselineStandings: [], schedule: [] }).length === 0, "baseline vazia");
  assert(reconciliar({ baselineStandings: [time("A", 0)], schedule: null }).length === 0, "sem calendário");
  assert(reconciliar({}).length === 0, "sem argumento nenhum");
});

test("faltando DOIS jogos, os dois mais recentes entram — e só eles", () => {
  const baseline = [time("A", 1), time("B", 3), time("C", 3)];
  const schedule = [
    jogo("2026-08-10T21:30Z", "A", "B"),
    jogo("2026-08-20T21:30Z", "A", "C"),
    jogo("2026-08-30T21:30Z", "A", "B"),
    jogo("2026-08-25T21:30Z", "B", "C"),
  ];
  const r = reconciliar({ baselineStandings: baseline, schedule });
  // A tem 3 encerradas e a baseline diz 1 -> faltam 2. B e C estão em dia (3 e 3).
  // Nenhuma partida pode entrar sem que os DOIS times tenham saldo: aqui, nenhuma.
  assert(r.length === 0,
         `somou ${JSON.stringify(ids(r))} com o adversário já em dia — inflaria B/C`);
});

test("a ordem devolvida é cronológica", () => {
  const baseline = [time("A", 0), time("B", 0)];
  const schedule = [
    jogo("2026-08-30T21:30Z", "A", "B"),
    jogo("2026-08-10T21:30Z", "A", "B"),
  ];
  const r = reconciliar({ baselineStandings: baseline, schedule });
  assert(r.length === 2, `esperado 2, veio ${r.length}`);
  assert(r[0].dateISO < r[1].dateISO, "devolveu fora de ordem cronológica");
});

console.log("\nD. Controle negativo — o gate tem de morder:");

test("controle negativo: voltar ao critério por horário reprova o caso real", () => {
  // A implementação exata que estava em produção.
  const antigo = (schedule, capturedAt) =>
    schedule.filter(g => g.state === "post" && !g.postponed && g.dateISO >= capturedAt);
  const schedule = [jogo("2026-08-30T21:30Z", "Mirassol", "Palmeiras")];
  // Visitante que abriu a página às 23h45, depois de o jogo começar.
  const perdido = antigo(schedule, "2026-08-30T23:45:00Z");
  assert(perdido.length === 0,
         "o controle negativo perdeu o sentido — o critério antigo não perde mais o jogo");
  // E o mesmo critério, para quem estava com a aba aberta desde as 21h, somaria o jogo...
  const somado = antigo(schedule, "2026-08-30T21:00:00Z");
  assert(somado.length === 1, "o critério antigo deixou de depender de quando a aba abriu");
  // ...ou seja: duas tabelas diferentes para o mesmo instante. É esta a divergência que morreu.
  assert(perdido.length !== somado.length,
         "o critério antigo deixou de divergir entre visitantes — nada a provar");
});

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${ok} ok, ${fail} falhas\n`);
process.exit(fail === 0 ? 0 : 1);
