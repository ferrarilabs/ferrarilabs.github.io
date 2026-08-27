/**
 * test_state_convergence.mjs — o estado remoto autoritativo tem de vencer uma cópia local velha.
 *
 * ─── O DEFEITO, MEDIDO EM PRODUÇÃO (2026-08-27) ─────────────────────────────────────────────
 *
 * Uma entrada histórica do CDB2026 tinha, ao mesmo tempo:
 *
 *     REMOTO : 4/4 palpites das quartas · sem `updatedAt` · createdAt 2026-07-16T20:31:32.467Z
 *     LOCAL  : 0/4 palpites das quartas · sem `updatedAt` · createdAt 2026-07-16T20:31:32.467Z
 *
 * `mergeStates()` decide assim:
 *
 *     remoteTs = e.updatedAt || e.createdAt || "";
 *     localTs  = existing.updatedAt || existing.createdAt || "";
 *     if (remoteTs > localTs) byId[e.id] = e;
 *
 * Sem `updatedAt` dos dois lados, ambos caem no MESMO `createdAt`. A comparação é `>` ESTRITA,
 * então o remoto NUNCA vence — e a cópia velha do `localStorage` sobrevive para sempre. Não é
 * cache de HTTP nem de service worker: recarregar não resolve, e nunca vai resolver.
 *
 * Efeito visível: "Ver palpites" mostrava 25 linhas para essa entrada e 35 para as demais.
 *
 * ─── POR QUE `>=` É A CORREÇÃO, E NÃO UM REMENDO ────────────────────────────────────────────
 *
 * Todo save local carimba `updatedAt: now` (ver `_editingEntry` nos três apps). Então:
 *
 *   · local editado depois  -> local tem carimbo MAIOR -> local vence, como deve
 *   · carimbos IGUAIS       -> o local NÃO foi editado desde então -> o remoto é seguro
 *
 * Empate não significa "os dois são novos": significa "nenhum é mais novo". E aí quem manda é a
 * fonte compartilhada, porque a cópia local só pode ser um espelho — possivelmente defasado — da
 * mesma escrita. Bumpar carimbo até o navegador ceder trataria o sintoma; isto corrige a regra.
 *
 * Hermético: sem rede, sem produção, sem dado de participante.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APPS = ["cdb2026", "br2026", "copa2026"];

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

/** A regra de desempate, isolada — a mesma forma dos três apps. */
function vencedor(remoto, local, estrito) {
  const rt = remoto.updatedAt || remoto.createdAt || "";
  const lt = local.updatedAt || local.createdAt || "";
  return estrito ? (rt > lt ? "REMOTO" : "LOCAL") : (rt >= lt ? "REMOTO" : "LOCAL");
}

const CRIADO = "2026-07-16T20:31:32.467Z";
// Sem palpites reais: contagens e formas, nunca conteudo.
const REMOTO_BOM   = { id: "x", createdAt: CRIADO, nPicks: 4 };
const LOCAL_VELHO  = { id: "x", createdAt: CRIADO, nPicks: 0 };

console.log("\nConvergência de estado — o remoto autoritativo vence a cópia velha\n");
console.log("A. Reprodução do defeito de produção");

test("com `>` estrito e carimbos iguais, o LOCAL velho vence — o defeito", () => {
  A(vencedor(REMOTO_BOM, LOCAL_VELHO, true) === "LOCAL",
    "a reproducao nao reproduz: revise o cenario antes de confiar na correcao");
});

test("com `>=`, o REMOTO vence o empate — a correcao", () => {
  A(vencedor(REMOTO_BOM, LOCAL_VELHO, false) === "REMOTO",
    "a correcao nao resolve o cenario medido em producao");
});

console.log("\nB. A correção não pode atropelar edição local legítima");

test("local editado DEPOIS continua vencendo", () => {
  const local = { id: "x", createdAt: CRIADO, updatedAt: "2026-08-01T10:00:00.000Z" };
  A(vencedor(REMOTO_BOM, local, false) === "LOCAL",
    "a correcao apagaria uma edicao local mais recente — todo save carimba updatedAt");
});

test("remoto mais novo vence, como sempre venceu", () => {
  const remoto = { id: "x", createdAt: CRIADO, updatedAt: "2026-08-20T10:00:00.000Z" };
  const local  = { id: "x", createdAt: CRIADO, updatedAt: "2026-08-01T10:00:00.000Z" };
  A(vencedor(remoto, local, false) === "REMOTO", "");
});

test("local com carimbo e remoto sem: o local, que e mais novo, vence", () => {
  const local = { id: "x", createdAt: CRIADO, updatedAt: "2026-08-01T10:00:00.000Z" };
  A(vencedor({ id: "x", createdAt: CRIADO }, local, false) === "LOCAL", "");
});

console.log("\nC. O invariante permanente vale para todos os caminhos");

for (const cenario of [
  ["aba recarregada", { createdAt: CRIADO }],
  ["aba nova", { createdAt: CRIADO }],
  ["localStorage defasado", { createdAt: CRIADO, updatedAt: undefined }],
  ["outro dispositivo com copia velha", { createdAt: CRIADO }],
  ["recuperacao feita por operador", { createdAt: CRIADO }],
]) {
  const [nome, local] = cenario;
  test(`${nome}: o remoto autoritativo supera a copia local`, () => {
    A(vencedor(REMOTO_BOM, { id: "x", ...local }, false) === "REMOTO",
      `${nome}: a copia velha sobreviveria`);
  });
}

console.log("\nD. Os três apps usam a MESMA regra (é invariante de plataforma)");

for (const app of APPS) {
  const src = readFileSync(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");

  test(`${app}: o desempate NAO e `.concat("`>` estrito"), () => {
    A(!/if \(remoteTs > localTs\)/.test(codigo),
      `${app}: com \`>\` estrito, dois lados sem \`updatedAt\` colapsam no mesmo \`createdAt\` e a ` +
      `copia velha do localStorage sobrevive para sempre — recarregar nunca resolve`);
  });

  test(`${app}: o remoto vence o empate`, () => {
    A(/if \(remoteTs >= localTs\)/.test(codigo),
      `${app}: empate tem de ir para o remoto — a copia local so pode ser espelho da mesma escrita`);
  });
}

console.log("\nE. Controle negativo");

test("mutação (voltar ao `>` estrito) reintroduz o defeito e é detectada", () => {
  const src = readFileSync(join(ROOT, "bolao/cdb2026/js/app.js"), "utf8");
  const mutado = src.replace("if (remoteTs >= localTs)", "if (remoteTs > localTs)");
  A(mutado !== src, "a mutacao nao alterou nada");
  A(/if \(remoteTs > localTs\)/.test(mutado) && !/if \(remoteTs >= localTs\)/.test(mutado),
    "CONTROLE NEGATIVO: a regressao deveria ser visivel");
  A(vencedor(REMOTO_BOM, LOCAL_VELHO, true) === "LOCAL",
    "CONTROLE NEGATIVO: com a regra antiga o defeito tem de voltar");
});

console.log("\nF. #258 — falha DEPOIS do commit nao pode virar 'Erro ao salvar'");

const APP_CDB = readFileSync(join(ROOT, "bolao/cdb2026/js/app.js"), "utf8");
const COD_CDB = APP_CDB.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");

test("existe uma fronteira de commit: o pos-commit tem `try` proprio", () => {
  const i = COD_CDB.indexOf("saveState(s);");
  A(i > 0, "saveState nao encontrado");
  const depois = COD_CDB.slice(i, i + 900);
  A(/try \{/.test(depois),
    "tudo depois do commit ainda vive no mesmo `try` do save: um defeito de render, uma falha do " +
    "provedor de e-mail ou um elemento ausente mostrariam 'Erro ao salvar' com o dado JA GRAVADO");
});

test("o ramo pos-commit NAO mostra erro de save", () => {
  const i = COD_CDB.indexOf("catch (posCommit)");
  A(i > 0, "nao ha catch dedicado ao pos-commit");
  const ramo = COD_CDB.slice(i, i + 420);
  A(!/t\("saveError"\)/.test(ramo),
    "o ramo pos-commit reporta falha de save — a pessoa reenviaria um palpite ja gravado");
  A(/"success"/.test(ramo), "o pos-commit tem de confirmar que o save deu certo");
  A(/POST_COMMIT_CLIENT_ERROR/.test(ramo), "o pos-commit nao registra diagnostico proprio");
});

test("as duas falhas sao DISTINGUIVEIS por diagnostico", () => {
  A(/SAVE_DIAG\.POST_COMMIT_CLIENT_ERROR/.test(COD_CDB), "sem codigo para dado salvo + erro na tela");
  A(/classificarFalhaDeSave\(err\)/.test(COD_CDB), "a falha real de save nao e classificada");
  A(/SAVE_DIAG\.ENTRY_GONE/.test(COD_CDB), "entrada removida nao tem codigo proprio");
});

console.log("\nG. Diagnostico seguro: conjunto FECHADO, nada de texto do servidor");

test("a taxonomia e um conjunto fechado e congelado", () => {
  A(/const SAVE_DIAG = Object\.freeze\(\{/.test(COD_CDB), "a taxonomia nao e um conjunto fechado");
  for (const c of ["CDB_SAVE_ACCESS_DENIED", "CDB_SAVE_CUTOFF_PASSED", "CDB_SAVE_NETWORK_UNCERTAIN",
                   "CDB_SAVE_POST_COMMIT_CLIENT_ERROR", "CDB_STATE_LOCAL_STALE"]) {
    A(COD_CDB.includes(c), `codigo ausente da taxonomia: ${c}`);
  }
});

test("o que sai para o reporte e SO o enum, nunca o erro original", () => {
  const i = COD_CDB.indexOf("window.__CDB2026_SAVE_DIAGNOSTIC__");
  A(i > 0, "nao ha acessor para o canal de reporte");
  const linha = COD_CDB.slice(i, i + 160);
  A(!/err|message|stack|response/.test(linha),
    "o acessor expoe o erro original — texto de PostgREST pode conter coluna, valor rejeitado e " +
    "ate fragmento do payload");
});

test("o classificador nunca devolve texto do servidor", () => {
  const i = COD_CDB.indexOf("function classificarFalhaDeSave");
  const fn = COD_CDB.slice(i, i + 700);
  A(!/return m\b/.test(fn) && !/return String/.test(fn),
    "o classificador devolveria a mensagem crua");
  const retornos = fn.match(/return SAVE_DIAG\.[A-Z_]+;/g) || [];
  A(retornos.length >= 5, `so ${retornos.length} retornos do conjunto fechado`);
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ STATE CONVERGENCE FAILED" : "✓ STATE CONVERGENCE OK");
process.exit(fail ? 1 : 0);
