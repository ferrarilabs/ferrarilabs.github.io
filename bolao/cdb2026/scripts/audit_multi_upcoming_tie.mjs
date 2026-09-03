/**
 * audit_multi_upcoming_tie.mjs — todo confronto simultâneo aparece, exatamente uma vez (CDB2026).
 *
 * ─── O QUE ACONTECEU (2026-09-02) ───────────────────────────────────────────────────────────
 *
 * Dois jogos da Copa do Brasil começaram no MESMO minuto:
 *
 *     401909110  Santos × Palmeiras    2026-09-03T00:30Z
 *     401909111  Vitória × Vasco       2026-09-03T00:30Z
 *
 * A página mostrou UM. `renderNextTieCard()` fazia:
 *
 *     group = confrontos do próximo dia com jogo        // 2
 *     group = group.filter(x => x !== primária)         // 1   (a primária pertence ao hero)
 *     if (group.length > 1) { ...desenha a lista... }   // 1 > 1 é FALSO
 *     card.classList.add("hidden");                     // o 2º some da página inteira
 *
 * Off-by-one puro. Com 3+ confrontos funcionava — por isso passou por gate e por revisão.
 *
 * ─── POR QUE ESTE GATE É DO CDB2026, E NÃO UMA CÓPIA DO BR2026 ──────────────────────────────
 *
 * `bolao/scripts/audit_multi_live_hero.mjs` é ótimo e é BR2026: aponta para
 * `bolao/br2026/js/app.js` e navega `/bolao/br2026/`. O CDB2026 é orientado a CONFRONTO
 * (tie, ida/volta) e usa outros IDs de DOM (`#nextTieCard`, `#liveTieCard`). Copiar aquele
 * arquivo seria fingir que as arquiteturas são a mesma. Compartilha-se o INVARIANTE, não o código:
 *
 *     todo confronto relevante entregue à superfície aparece, exatamente uma vez.
 *
 * ─── POR QUE ESTE GATE NÃO É DE NAVEGADOR (limitação declarada, não escondida) ───────────────
 *
 * Um gate de DOM real foi tentado primeiro. O CDB2026 é local-first e reconstrói
 * `localStorage[storeKey]` no bootstrap: o estado sintético semeado era sobrescrito antes do
 * primeiro render (medido: `phases.quartas.ties` voltava `[]`). Fabricar um estado que
 * sobrevivesse àquele caminho exigiria simular sorteio e roster inteiros — um gate que testaria
 * mais o andaime do que o defeito, e que quebraria a cada mudança de bootstrap.
 *
 * Então este gate ataca o mesmo invariante onde ele REALMENTE mora: o guard de seleção. Ele
 * (a) executa um modelo do guard e (b) prova que o modelo é fiel ao guard REAL do arquivo — o
 * modelo lê o limiar do próprio código-fonte, então não pode divergir dele em silêncio. As duas
 * metades juntas são carregadas de peso: a mutação que restaura o `> 1` reprova o gate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// `--mutate` e a convencao do repo (audit_multi_live_hero.mjs); a forma em portugues fica aceita tambem.
const MUTAR = process.argv.includes("--mutate") || process.argv.includes("--mutar");

let pass = 0, fail = 0;
const test = (n, ok, extra = "") => {
  if (ok) { console.log(`  ✓ ${n}`); pass++; }
  else { console.log(`  ✗ ${n}${extra ? `\n      ${extra}` : ""}`); fail++; }
};

const APP_SRC = readFileSync(join(RAIZ, "bolao/cdb2026/js/app.js"), "utf8");

// A MUTAÇÃO é o defeito original, literalmente.
const ALVO = "  if (group.length) {";
const MUTACAO = "  if (group.length > 1) {";
if (MUTAR && !APP_SRC.includes(ALVO)) {
  console.error("MUTAÇÃO NÃO APLICÁVEL — o padrão sumiu de app.js; o gate mediria o original");
  process.exit(2);
}
const APP = MUTAR ? APP_SRC.replace(ALVO, MUTACAO) : APP_SRC;

const CORPO_DE = (nome, ate) => {
  const i = APP.indexOf(`function ${nome}(`);
  const j = APP.indexOf(`function ${ate}(`);
  return i >= 0 && j > i ? APP.slice(i, j) : "";
};
const CORPO = CORPO_DE("renderNextTieCard", "nextMatchBlockHtml");
const CORPO_BUSCA = CORPO_DE("findAllUpcomingMatchesOnNextDay", "renderNextTieCard");

// ─── Confrontos REAIS do incidente, por EVENT ID ─────────────────────────────────────────────
const CONFRONTOS = [
  { id: "401909110", home: "Santos",  away: "Palmeiras" },
  { id: "401909111", home: "Vitória", away: "Vasco" },
  { id: "401909114", home: "Grêmio",  away: "Internacional" },
  { id: "401909115", home: "Bahia",   away: "Fortaleza" },
];

// O limiar é LIDO do código real — se alguém mexer no guard, o modelo muda junto e a seção A
// denuncia. É isso que impede o modelo de virar uma segunda verdade que concorda consigo mesma.
const LIMIAR = CORPO.includes("if (group.length > 1)") ? 1 : 0;

/** Modelo executável do guard de seleção, derivado do corpo real acima. */
function confrontosRenderizados(simultaneos) {
  const group0 = CONFRONTOS.slice(0, simultaneos);
  if (!group0.length) return { hero: null, lista: [] };
  const primaria = group0[0];                                    // findNextUpcomingMatch()
  const group = group0.filter((x) => x.id !== primaria.id);       // a primária é do hero
  if (!group.length) return { hero: primaria, lista: [] };
  if (group.length > LIMIAR) return { hero: primaria, lista: group };
  return { hero: primaria, lista: [] };                           // card escondido
}

console.log(`\nCDB2026 — confrontos simultâneos${MUTAR ? "  [MUTANTE: restaura o `> 1`]" : ""}\n`);
console.log("A. Contagem: render == dados, para cada quantidade que a arquitetura permite");

for (const n of [0, 1, 2, 3, 4]) {
  const { hero, lista } = confrontosRenderizados(n);
  const ids = [...(hero ? [hero] : []), ...lista].map((v) => v.id);
  const esperados = CONFRONTOS.slice(0, n).map((c) => c.id);
  const semDuplicata = new Set(ids).size === ids.length;
  const todos = esperados.every((id) => ids.includes(id));

  test(`${n} simultâneo(s) ⇒ render=${ids.length} dados=${n}  [${ids.join(" ") || "—"}]`,
    ids.length === n && todos && semDuplicata,
    `esperados ${JSON.stringify(esperados)} · vistos ${JSON.stringify(ids)}`);

  if (n === 2) {
    test("o caso REAL de 2026-09-02: 401909110 E 401909111, os dois, uma vez cada",
      ids.includes("401909110") && ids.includes("401909111") && ids.length === 2,
      `vistos: ${JSON.stringify(ids)} — o off-by-one escondia o segundo`);
  }
}

console.log("\nB. Ordem, duplicidade e ciclo de vida");

test("ordem determinística — dois cálculos idênticos não trocam nada de lugar",
  JSON.stringify(confrontosRenderizados(3).lista.map((x) => x.id)) ===
  JSON.stringify(confrontosRenderizados(3).lista.map((x) => x.id)));

test("a primária nunca é repetida na lista (hero e lista não colidem)",
  (() => { const { hero, lista } = confrontosRenderizados(3);
           return !lista.some((x) => x.id === hero.id); })());

test("confronto FINAL não entra na superfície de PRÓXIMOS (sem card fantasma)",
  /status === "FINAL"/.test(CORPO_BUSCA),
  "o filtro que descarta confronto encerrado sumiu de findAllUpcomingMatchesOnNextDay");

test("apito no passado não entra (a superfície é de PRÓXIMOS, não de histórico)",
  /kickoffMs <= Date\.now\(\)/.test(CORPO_BUSCA),
  "o filtro de futuro sumiu — confronto antigo voltaria a aparecer como próximo");

console.log("\nC. Fidelidade ao código real + controles negativos");

test("o corpo de renderNextTieCard foi encontrado (senão o gate mediria o vazio)",
  CORPO.length > 200, `recorte de ${CORPO.length} caracteres`);

test("nenhum seletor de primeiro-elemento estreita o conjunto",
  !/\bgroup\[0\]/.test(CORPO) && !/group\.slice\(0,\s*1\)/.test(CORPO) && !/group\.find\(/.test(CORPO),
  "um `[0]`/`slice(0,1)`/`find()` voltou a reduzir a lista a um confronto");

test("o guard usa `group.length`, não o `> 1` que escondia o segundo confronto",
  CORPO.includes("if (group.length) {") && !CORPO.includes("if (group.length > 1) {"),
  MUTAR ? "MUTANTE ativo: o `> 1` foi restaurado — é exatamente isto que tem de reprovar"
        : "o limiar voltou a ser off-by-one");

test("a lista vazia continua escondida (os guards de `!group.length` sobreviveram)",
  (CORPO.match(/if \(!group\.length\)/g) || []).length >= 2,
  "sem esses guards, a correção passaria a renderizar card vazio");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (MUTAR) {
  console.log(fail > 0
    ? "✓ MUTANTE DETECTADO — restaurar o `> 1` reprova o gate"
    : "✗ MUTANTE NÃO DETECTADO — este gate não protege nada");
  process.exit(fail > 0 ? 0 : 1);
}
console.log(fail ? "✗ MULTI UPCOMING TIE FAILED" : "✓ MULTI UPCOMING TIE OK");
process.exit(fail ? 1 : 0);
