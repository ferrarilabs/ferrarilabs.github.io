#!/usr/bin/env node
/**
 * ESCOPO DAS DECISÕES DE ESTADO AO VIVO — o número não pode voltar a crescer.
 *
 * O hero sumiu QUATRO vezes por QUATRO causas. A raiz estrutural era esta: **21 pontos** no código
 * decidiam independentemente se uma partida estava ao vivo. Não havia uma decisão para consertar —
 * havia vinte e uma, e consertar uma deixava as outras vinte.
 *
 * Depois da consolidação: 9. E as 9 restantes NÃO são decisões de estado ao vivo — são consultas
 * de TABELA que leem o mesmo campo para responder outra pergunta:
 *
 *     "qual o próximo jogo?"                  ≠  "esta partida está ao vivo?"
 *     "quais partidas contam na classificação?" ≠  "esta partida está ao vivo?"
 *     "quais confrontos ainda faltam?"          ≠  "esta partida está ao vivo?"
 *
 * Passá-las por um resolvedor de estado ao vivo conflaria as duas perguntas — que é a mesma
 * confusão de categoria que originou todo o problema, só que na direção oposta. Cada uma está
 * listada abaixo com arquivo, motivo e por que é segura.
 *
 * Uso: node bolao/scripts/audit_live_decision_scope.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass=0, fail=0;
const test=(n,f)=>{ try{f();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}\n      ${e.message}`);fail++;} };
const assert=(c,m)=>{ if(!c) throw new Error(m); };

// EXCEÇÕES DECLARADAS. Consulta de tabela/torneio, não de estado ao vivo.
const EXCECOES = {
  "br2026": [
    { padrao: '_schedule.find(g => g.state === "pre"',  motivo: "PRÓXIMO JOGO da tabela — pergunta de agenda, não de estado ao vivo" },
    { padrao: '_schedule.filter(g => g.state === "post" && !g.postponed && g.dateISO >=', motivo: "baseline da classificação: quais jogos já contaram" },
    { padrao: 'if (!m || m.postponed) return;', motivo: "adiado não altera a TABELA ao vivo — regra de classificação" },
    { padrao: '_schedule.filter(g => g.state === "post" && g.homeScore != null', motivo: "jogos com placar para o modelo de força dos times" },
    { padrao: '_schedule.filter(g => g.state === "pre")', motivo: "jogos restantes para a projeção de fim de campeonato" },
    { padrao: '_schedule.filter(g => g.state === "pre" && !g.postponed && brtDateKey', motivo: "lista 'jogos de hoje' — agenda do dia" },
    { padrao: 'if (g.state === "pre" && hasRatings)', motivo: "probabilidade PRÉ-jogo: só faz sentido antes de começar" },
  ],
  "cdb2026": [
    { padrao: 'leg === "second" && state === "pre"', motivo: "progresso do confronto de ida e volta — ciclo de vida do torneio" },
  ],
  "copa2026": [
    { padrao: 'if (hint?.postponed) return', motivo: "rótulo de partida adiada no bracket arquivado" },
  ],
};

console.log("\nEscopo das decisões de estado ao vivo\n");

const RE = /state\s*===\s*["'](in|post|pre)["']|completed\s*===\s*true|\.postponed\b/;
let total = 0;
for (const app of ["br2026", "cdb2026", "copa2026"]) {
  const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
  const linhas = src.split("\n").map((l, i) => ({ n: i + 1, t: l }))
    .filter(({ t }) => { const s = t.trim(); return !s.startsWith("//") && !s.startsWith("*") && RE.test(t); });
  total += linhas.length;

  test(`[${app}] todo ponto restante está declarado como exceção justificada`, () => {
    const decl = EXCECOES[app] || [];
    const naoDeclarados = linhas.filter(({ t }) => !decl.some((e) => t.includes(e.padrao)));
    assert(naoDeclarados.length === 0,
      `decisão de estado NÃO declarada — ou usa o resolvedor canônico, ou entra na lista com motivo:\n      ` +
      naoDeclarados.map(({ n, t }) => `${n}: ${t.trim().slice(0, 90)}`).join("\n      "));
  });

  test(`[${app}] usa os predicados canônicos`, () => {
    if (app === "copa2026" || app === "cdb2026" || app === "br2026") {
      assert(/BOLAO_FOOTBALL_LIVE\.(isLiveMatch|isLiveEvent|isFinalMatch|isFinalEvent|isPostponedMatch)/.test(src),
        "nenhum predicado canônico em uso — a consolidação foi revertida");
    }
  });

  test(`[${app}] carrega o módulo compartilhado`, () => {
    const html = readFileSync(join(ROOT, "bolao", app, "index.html"), "utf8");
    assert(/shared\/js\/football_live_store\.js/.test(html), "o store compartilhado não é carregado");
  });
}

test(`o total NÃO regrediu (era 21 antes da consolidação)`, () => {
  assert(total <= 9, `${total} pontos — subiu em relação aos 9 consolidados`);
  console.log(`      total atual: ${total} (todos declarados como consulta de tabela)`);
});

test("CONSUMER_ISOLATION: nenhum app fala com a ESPN diretamente", () => {
  for (const app of ["br2026", "cdb2026", "copa2026"]) {
    const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
    const chamadas = (src.match(/fetch\w*\([^)]*site\.api\.espn\.com/g) || []);
    assert(chamadas.length === 0, `${app} voltou a chamar a ESPN direto do navegador`);
  }
});

test("SOURCE_HIERARCHY: os apps ativos preferem o gateway", () => {
  // Ate a migracao F12 (2026-08-10) este teste exigia que o PROPRIO app contivesse a consulta ao
  // gateway, a validacao de schema e a distincao entre "nao sabemos" e "nao ha jogo". Exigir isso
  // do app passou a ser exigir a duplicacao que F12 eliminou: agora essas tres coisas vivem no
  // FootballLiveStore compartilhado, uma vez, e o app so consome.
  //
  // O invariante NAO foi afrouxado -- mudou de lugar e ficou mais forte: o app tem de delegar a
  // um store que comprovadamente faz as tres coisas. Quem verifica o store sao
  // test_live_store_lifecycle.mjs, test_cache_poisoning.mjs e audit_football_live_store.mjs;
  // quem verifica que o app realmente instancia o store e audit_shared_store_adoption.mjs.
  const storeSrc = readFileSync(join(ROOT, "bolao/shared/js/football_live_store.js"), "utf8");
  assert(/schemaVersion !== 1/.test(storeSrc), "o store compartilhado nao valida o schema");
  assert(/matches === null/.test(storeSrc),
    'o store nao distingue "nao sabemos" de "nao ha jogo" — e o bug de origem');

  for (const app of ["br2026", "cdb2026"]) {
    const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
    const delega = /createStore\s*\(/.test(src);
    const proprio = /liveGateway/.test(src) && /schemaVersion !== 1/.test(src) && /matches === null/.test(src);
    assert(delega || proprio,
      `${app} nao delega ao store compartilhado NEM implementa a hierarquia corretamente`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ LIVE DECISION SCOPE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
