#!/usr/bin/env node
/**
 * audit_critical_functionality.mjs — o Portão de Regressão de Funcionalidade Crítica.
 *
 * ─── POR QUE ESTE GATE EXISTE ───────────────────────────────────────────────────────────────
 *
 * Regressões repetidas em que consertar UM defeito removeu ou quebrou OUTRA função crítica que
 * já funcionava. O hero de futebol sumiu quatro vezes por gatilhos diferentes; o botão
 * "Ver palpites", o card de próxima partida e a superfície do card primário regrediram em
 * patches que "não tinham relação". Todas essas regressões passaram por revisão humana.
 *
 * A lição não é "revisar melhor". É que **o repositório precisa lembrar o invariante**, porque o
 * revisor não lembra — e o autor do patch, por definição, está olhando para outra coisa.
 *
 * ─── O INVARIANTE DE RELEASE ────────────────────────────────────────────────────────────────
 *
 *   Uma capacidade crítica JÁ EXISTENTE não pode sumir, ficar vazia, duplicar, nem perder o
 *   comportamento de estado pretendido como efeito colateral de outra mudança.
 *
 * ─── O QUE ESTE GATE MEDE (E O QUE NÃO MEDE) ────────────────────────────────────────────────
 *
 * Mede SEMÂNTICA, não seletor. Um nó existir não é aprovação:
 *
 *   PRESENT  existe               NONEMPTY  tem conteúdo — montado e VAZIO é FALHA
 *   VISIBLE  é renderizado        UNIQUE    um dono só — duplicata escondida ainda é defeito
 *   OWNER    quem desenhou é o dono canônico, não um renderizador paralelo
 *
 * Não mede pixel, cor, nem texto exato: isso é assunto dos gates visuais e do contrato de texto
 * (`hero-copy-contract`). Aqui a pergunta é uma só — **a capacidade continua existindo e
 * funcionando no estado em que o produto diz que ela deve existir?**
 *
 * O QUE é crítico está em `bolao/shared/safety/critical_functionality.json`, legível por
 * máquina. Este arquivo é só o COMO. Acrescentar capacidade é editar o registro, não este
 * script.
 *
 * ─── HONESTIDADE DO PRÓPRIO GATE ────────────────────────────────────────────────────────────
 *
 * Todo gate precisa provar que morde. As mutações no fim reintroduzem, uma a uma, as regressões
 * reais que já aconteceram (hero escondido, hero vazio, confronto duplicado, ranking removido,
 * suporte removido, classificação removida, "Ver palpites" removido, sumiço só no telefone). Se
 * uma mutação NÃO reprovar, o gate falha — um portão que não morde é pior que nenhum, porque
 * compra confiança que não tem lastro.
 *
 * Sem rede real, sem e-mail, sem palpite tocado: gateway, snapshot, Supabase e `app.js` são
 * todos interceptados.
 *
 * Uso:
 *   node bolao/scripts/audit_critical_functionality.mjs
 *   node bolao/scripts/audit_critical_functionality.mjs --only=cdb2026
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./static_server.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const PORT = 8301;   // único: ver bolao/scripts/test_harness_ports_unique.mjs

const REGISTRO = JSON.parse(
  readFileSync(join(RAIZ, "bolao/shared/safety/critical_functionality.json"), "utf8"));

const SO = (process.argv.find(a => a.startsWith("--only=")) || "").split("=")[1] || null;

let pass = 0, fail = 0;
const falhas = [];
function test(nome, ok, detalhe = "") {
  if (ok) { console.log(`  ✓ ${nome}`); pass++; }
  else { console.log(`  ✗ ${nome}${detalhe ? `\n      ${detalhe}` : ""}`); fail++; falhas.push(nome); }
}

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────
//
// Times e datas são sintéticos. Nenhum e-mail, nome real ou referência de pagamento entra aqui —
// ver a regra de PII em CLAUDE.md e `scripts/test_fixture_privacy.mjs`.
const AGORA = Date.now();
const H = 3600000, D = 86400000;

function jogoAoVivo() {
  return {
    id: "live-1", date: new Date(AGORA - H).toISOString(),
    state: "in", statusName: "STATUS_IN_PROGRESS", statusDescription: "In Progress",
    statusShortDetail: "62'", statusDetail: "62'", completed: false,
    clockSec: 62 * 60, period: 2, clockStr: "62'",
    homeTeam: "Cruzeiro", awayTeam: "Vasco", homeTeamId: "h1", awayTeamId: "a1",
    homeScore: 1, awayScore: 0, venue: "Estádio", city: "Cidade", details: [],
  };
}

function jogoFinal() {
  return {
    id: "final-1", date: new Date(AGORA - 2 * H).toISOString(),
    state: "post", statusName: "STATUS_FINAL", statusDescription: "Final",
    statusShortDetail: "FT", statusDetail: "FT", completed: true,
    clockSec: 5400, period: 2, clockStr: "90'",
    homeTeam: "Palmeiras", awayTeam: "Grêmio", homeTeamId: "h2", awayTeamId: "a2",
    homeScore: 2, awayScore: 1, venue: "Estádio", city: "Cidade", details: [],
  };
}

/**
 * Partidas de HOJE que ainda não começaram. Kickoff no futuro próximo, no MESMO dia BRT — é essa
 * combinação (ao vivo + outras hoje) que reproduz a Issue #379.
 */
function jogosDeHojeAindaNaoComecados() {
  return [
    { id: "pre-1", date: new Date(AGORA + 40 * 60_000).toISOString(),
      state: "pre", statusName: "STATUS_SCHEDULED", statusDescription: "Scheduled",
      statusShortDetail: "Scheduled", statusDetail: "Scheduled", completed: false,
      clockSec: 0, period: null, clockStr: "0'",
      homeTeam: "Grêmio", awayTeam: "Chapecoense", homeTeamId: "h3", awayTeamId: "a3",
      homeScore: 0, awayScore: 0, venue: "Estádio", city: "Cidade", details: [] },
    { id: "pre-2", date: new Date(AGORA + 50 * 60_000).toISOString(),
      state: "pre", statusName: "STATUS_SCHEDULED", statusDescription: "Scheduled",
      statusShortDetail: "Scheduled", statusDetail: "Scheduled", completed: false,
      clockSec: 0, period: null, clockStr: "0'",
      homeTeam: "Mirassol", awayTeam: "Bahia", homeTeamId: "h4", awayTeamId: "a4",
      homeScore: 0, awayScore: 0, venue: "Estádio", city: "Cidade", details: [] },
  ];
}

/** Corpo do gateway. `ok:false` devolve 503 — o mesmo que a produção serve quando a fonte cai. */
function corpoGateway(competition, { matches = [], stale = false, ageH = 0 } = {}) {
  const obs = new Date(AGORA - ageH * H).toISOString();
  return {
    schemaVersion: 1, competition, competitionId: competition, provider: "test",
    observedAt: obs, generatedAt: obs, sourceUpdatedAt: obs,
    stale, staleReason: stale ? "STALE_FIXTURE" : null,
    payloadHash: `crit-${competition}-${matches.length}-${stale}`,
    matches,
  };
}

// ─── Estado do bolão (o que a rota do Supabase devolve) ───────────────────────────────────────
//
// Entradas sintéticas existem para que o RANKING e o caminho "Ver palpites" tenham o que
// renderizar. Um ranking vazio passaria em PRESENT e reprovaria em NONEMPTY por motivo errado.
function entradasSinteticas() {
  return [
    { id: "e1", entryName: "Entrada Um", participantEmail: "um@example.invalid",
      picks: {}, createdAt: new Date(AGORA - 30 * D).toISOString() },
    { id: "e2", entryName: "Entrada Dois", participantEmail: "dois@example.invalid",
      picks: {}, createdAt: new Date(AGORA - 29 * D).toISOString() },
  ];
}

const PROVENIENCIA_OK = {
  authority: "CBF", source: "cbf-publication",
  sourceUrl: "https://example.invalid/sorteio",
  scheduledAt: new Date(AGORA - 20 * D).toISOString(),
  publishedAt: new Date(AGORA - 20 * D).toISOString(),
  ingestedAt: new Date(AGORA - 20 * D).toISOString(),
  validatedAt: new Date(AGORA - 20 * D).toISOString(),
  validatedBy: "fixture",
};

function tie(id, a, b, kickoffMs) {
  return {
    id, teamA: a, teamB: b,
    matches: {
      first: { homeTeam: a, awayTeam: b, kickoff: new Date(kickoffMs).toISOString(),
               venue: "Estádio", city: "Cidade", goalsHome: null, goalsAway: null, status: "SCHEDULED" },
      second: { homeTeam: b, awayTeam: a, kickoff: new Date(kickoffMs + 7 * D).toISOString(),
                venue: "Estádio", city: "Cidade", goalsHome: null, goalsAway: null, status: "SCHEDULED" },
    },
  };
}

/**
 * Estado do CDB2026 por cenário de ciclo de vida.
 *   picks_open   sorteio validado + kickoff no FUTURO  -> prazo aberto (kickoff − 1h)
 *   picks_closed sorteio validado + kickoff no PASSADO -> prazo vencido
 *   draw_pending sem proveniência validada             -> aguardando sorteio
 */
function estadoCdb(cenario) {
  const base = { entries: entradasSinteticas(), deletedIds: [], paid: {}, results: {},
                 auditLog: [], meta: {}, espnSync: { activePhaseId: "quartas" }, phases: {} };
  if (cenario === "draw_pending") {
    base.phases.quartas = { cutoffAt: null, cutoffOffsetMs: null, ties: {}, officialDraw: null };
    return base;
  }
  const kickoff = cenario === "picks_open" ? AGORA + 5 * D : AGORA - 5 * D;
  base.phases.quartas = {
    cutoffAt: null, cutoffOffsetMs: null, officialDraw: PROVENIENCIA_OK,
    ties: {
      t1: tie("t1", "Cruzeiro", "Vasco", kickoff),
      t2: tie("t2", "Palmeiras", "Grêmio", kickoff + 2 * H),
    },
  };
  return base;
}

function estadoBr() {
  // O BR2026 fechou as entradas em 2026-07-16: `picks_closed` é o estado real e permanente da
  // produção, e é o que o registro declara para BR_VIEW_PICKS_PATH.
  //
  // `cutoffAt` PRECISA vir explícito. Sem ele, `freezeSeasonCutoff()` congela o prazo no próximo
  // jogo do calendário (amanhã) e o app conclui, corretamente, que as entradas ainda estão
  // abertas — então "Ver palpites" não aparece e o gate reprovaria o PRODUTO por um defeito da
  // FIXTURE. Em produção esse campo está congelado no estado do Supabase; a fixture reproduz isso.
  return { entries: entradasSinteticas(), deletedIds: [], paid: {}, results: {},
           cutoffAt: new Date(AGORA - 40 * D).toISOString(), auditLog: [], meta: {} };
}

// ─── A matriz de estados ─────────────────────────────────────────────────────────────────────
//
// Cada cenário diz (a) o que o gateway responde e (b) em que estado de ciclo de vida o bolão
// está. Os nomes batem com `states` no registro — quem lê o JSON sabe o que foi exercitado.
function cenarios(app) {
  const comuns = [
    { estado: "normal_fresh",        gw: { matches: [] } },
    { estado: "upcoming_fixture",    gw: { matches: [] } },
    { estado: "live_fixture",        gw: { matches: [jogoAoVivo()] } },
    { estado: "recent_final",        gw: { matches: [jogoFinal()] } },
    { estado: "stale_source",        gw: { matches: [], stale: true, ageH: 14 } },
    { estado: "provider_unavailable", gw: null },
    { estado: "schedule_unknown",    gw: null, semSnapshot: true },
  ];
  if (app === "cdb2026") {
    return [
      ...comuns.map(c => ({ ...c, ciclo: "picks_closed" })),
      { estado: "picks_open",   gw: { matches: [] }, ciclo: "picks_open", rosterAberto: true },
      { estado: "picks_closed", gw: { matches: [] }, ciclo: "picks_closed" },
      { estado: "draw_pending", gw: { matches: [] }, ciclo: "draw_pending" },
      { estado: "draw_locked",  gw: { matches: [] }, ciclo: "picks_closed" },
    ];
  }
  return [...comuns.map(c => ({ ...c, ciclo: "picks_closed" })),
          { estado: "picks_closed", gw: { matches: [] }, ciclo: "picks_closed" },
          // Issue #379: o hero mostra o AO VIVO, e os outros jogos de hoje têm de continuar na
          // lista. O mesmo corpo vai para o snapshot porque é dele que sai `_schedule`.
          { estado: "live_and_upcoming_today", ciclo: "picks_closed", comoSnapshot: true,
            gw: { matches: [jogoAoVivo(), ...jogosDeHojeAindaNaoComecados()] } }];
}

// ─── Montagem da página ──────────────────────────────────────────────────────────────────────
async function abrir(browser, app, cenario, { viewport = "desktop", appSrc = null, css = null } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[viewport] });
  const page = await ctx.newPage();

  const estado = app === "cdb2026" ? estadoCdb(cenario.ciclo) : estadoBr();

  // Roster CONGELADO é o estado atual do CDB2026 em produção, e com ele o formulário de palpite
  // legitimamente não aparece para quem não tem entrada carregada. Para exercitar de verdade o
  // ramo "prazo aberto -> formulário existe", o cenário `picks_open` descongela o roster pelo
  // MESMO caminho que o produto usa (a flag de config), em vez de o gate inventar uma exceção.
  if (cenario.rosterAberto) {
    const cfg = readFileSync(join(RAIZ, `bolao/${app}/js/config.js`), "utf8");
    if (!cfg.includes("entryRosterFrozen: true")) {
      throw new Error("fixture obsoleta: `entryRosterFrozen: true` sumiu de " + app + "/js/config.js");
    }
    const patch = cfg.replace("entryRosterFrozen: true", "entryRosterFrozen: false");
    await page.route(`**/${app}/js/config.js*`, r =>
      r.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: patch }));
  }

  if (appSrc) {
    await page.route(`**/${app}/js/app.js*`, r =>
      r.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: appSrc }));
  }
  if (css) {
    await page.route(`**/${app}/css/styles.css*`, r =>
      r.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: css }));
  }
  await page.route("**/rest/v1/**", r =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ state: estado }]) }));

  if (cenario.gw === null) {
    // Fonte fora: exatamente o que o gateway serve hoje em produção (503 + SOURCE_UNAVAILABLE).
    const corpo = JSON.stringify({ schemaVersion: 1, competition: app, provider: "espn",
      observedAt: null, servedAt: new Date().toISOString(), ageSeconds: null,
      stale: true, staleReason: "UPSTREAM_403", status: "SOURCE_UNAVAILABLE", matches: [] });
    await page.route("**/functions/v1/**", r =>
      r.fulfill({ status: 503, contentType: "application/json", body: corpo }));
  } else {
    await page.route("**/functions/v1/**", r =>
      r.fulfill({ status: 200, contentType: "application/json",
                  body: JSON.stringify(corpoGateway(app, cenario.gw)) }));
  }

  if (cenario.comoSnapshot && cenario.gw) {
    // `_schedule` (a lista "jogos de hoje") vem do snapshot commitado, não do gateway. Servir os
    // dois com o MESMO corpo é o que torna o cenário coerente: o que está ao vivo e o que ainda
    // vai começar saem da mesma verdade.
    await page.route("**/data/espn-normalized.json*", r =>
      r.fulfill({ status: 200, contentType: "application/json",
                  body: JSON.stringify(corpoGateway(app, cenario.gw)) }));
  }
  if (cenario.semSnapshot) {
    // Nem fonte ao vivo nem snapshot commitado: o pior caso honesto (`schedule_unknown`).
    await page.route("**/data/espn-normalized.json*", r =>
      r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  }

  if (cenario.comoSnapshot && cenario.gw) {
    // Os confrontos que o cenário AFIRMA existir hoje e ainda não começados. A regra confere
    // contra esta lista, não contra o que a página resolveu — senão ela concordaria consigo mesma.
    const esperados = cenario.gw.matches.filter(m => m.state === "pre")
      .map(m => [m.homeTeam, m.awayTeam]);
    await page.addInitScript(v => { window.__CRIT_ESPERADOS__ = v; }, esperados);
  }
  await page.goto(`http://localhost:${PORT}/bolao/${app}/`, { waitUntil: "networkidle" });
  // O render do hero roda num tick de 1s; 900ms cobre o primeiro passo completo depois do
  // networkidle sem transformar o gate numa espera cega de vários segundos por cenário.
  await page.waitForTimeout(900);
  if (cenario.comoSnapshot) {
    // Cenários que dependem do CALENDÁRIO esperam o `_schedule` chegar ao DOM. O sinal escolhido é
    // a lista de Jogos ter conteúdo: ela depende do calendário e NÃO da regra em teste, então
    // esperar por ela não pressupõe o resultado (esperar pelo próprio card faria o gate concordar
    // consigo mesmo, e travaria sob a mutação em vez de reprovar).
    await page.waitForFunction(
      () => ((document.getElementById("gamesList") || {}).textContent || "").trim().length > 0,
      { timeout: 8000 }).catch(() => {});
  }
  return { ctx, page };
}

// ─── O avaliador ─────────────────────────────────────────────────────────────────────────────
//
// Roda DENTRO da página: PRESENT/VISIBLE/NONEMPTY/UNIQUE/OWNER medidos no DOM real, com layout
// real. `getBoundingClientRect` é o que separa "existe" de "é renderizado" — e foi justamente
// essa distinção que faltou nas duas vezes em que `hidden === false` foi aceito como prova.
const AVALIADOR = `(cap) => {
  const r = { id: cap.id, ok: true, motivos: [] };
  const falha = (m) => { r.ok = false; r.motivos.push(m); };
  const nos = [...document.querySelectorAll(cap.selector)];
  r.count = nos.length;

  const visivel = (el) => {
    if (!el) return false;
    if (el.classList.contains("hidden")) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  };
  const naoVazio = (el) => !!el &&
    ((el.textContent || "").trim().length > 0 || el.querySelector("img, svg, input, button, canvas") !== null);

  if (cap.assert.includes("PRESENT") && nos.length === 0) falha("PRESENT: nenhum no encontrado");
  if (cap.minCount && nos.length < cap.minCount) falha("MIN_COUNT: " + nos.length + " < " + cap.minCount);
  if (cap.assert.includes("UNIQUE") && nos.length > (cap.maxCount || 1))
    falha("UNIQUE: " + nos.length + " ocorrencias");

  if (cap.assert.includes("VISIBLE") && nos.length && !nos.some(visivel))
    falha("VISIBLE: nenhuma ocorrencia renderizada");
  if (cap.assert.includes("NONEMPTY") && nos.length && !nos.some(naoVazio))
    falha("NONEMPTY: no montado e VAZIO");
  if (cap.assert.includes("OWNER") && cap.ownerAttr && nos.length &&
      !nos.some(el => el.getAttribute(cap.ownerAttr) != null))
    falha("OWNER: atributo " + cap.ownerAttr + " ausente");

  if (cap.requiredSections) {
    const vistas = new Set(nos.map(el => el.dataset.section));
    const faltando = cap.requiredSections.filter(s => !vistas.has(s));
    if (faltando.length) falha("SECOES AUSENTES: " + faltando.join(","));
  }
  return r;
}`;

/**
 * Regras nomeadas: capacidades cuja verdade não cabe num seletor.
 * Cada uma responde uma pergunta SEMÂNTICA e devolve {ok, motivo}.
 */
// `page.evaluate` passa UM argumento. Receber `(nome, app)` fazia `nome` virar o ARRAY inteiro,
// nenhum `if` casar, e toda regra cair no default — que passava. Todas as regras deste gate
// ficaram silenciosamente verdes até duas mutações denunciarem. Por isso a assinatura desestrutura
// explicitamente, e por isso o default abaixo REPROVA: regra não avaliada é falha, nunca sucesso.
const REGRAS = `([nome, app]) => {
  const txt = (el) => (el ? (el.textContent || "").replace(/\\s+/g, " ").trim() : "");
  const heroId = app === "cdb2026" ? "liveTieCard" : "liveMatchCard";
  const hero = document.getElementById(heroId);

  // A "assinatura" de um confronto: os nomes dos dois times, normalizados e ordenados. Comparar
  // assinaturas (e nao contar cards) e o que pega a MESMA partida desenhada em dois lugares.
  const assinatura = (raiz) => {
    if (!raiz) return null;
    const t = txt(raiz.querySelector(".next-game-teams, .next-match-teams")) || txt(raiz);
    const nomes = t.split(/[x×]/).map(s => s.replace(/[^A-Za-zÀ-ÿ .-]/g, "").trim()).filter(Boolean);
    return nomes.length >= 2 ? nomes.slice(0, 2).map(s => s.toLowerCase()).sort().join("~") : null;
  };

  if (nome === "PRIMARY_FIXTURE_UNIQUE") {
    const prim = hero ? assinatura(hero.querySelector(".next-game-card, .live-hero-idle")) : null;
    if (!prim) return { ok: true, motivo: "sem confronto primario nesta tela" };
    const outros = [...document.querySelectorAll(".next-game-card")]
      .filter(n => !hero.contains(n))
      .filter(n => assinatura(n) === prim);
    return outros.length === 0
      ? { ok: true, motivo: "" }
      : { ok: false, motivo: "o confronto primario aparece tambem em " + outros.length + " card(s) fora do hero" };
  }

  if (nome === "TODAY_FIXTURES_ALL_VISIBLE") {
    // Todo confronto de HOJE que a fonte declarou tem de estar em ALGUM lugar VISIVEL da tela: no
    // hero (se estiver ao vivo) ou na lista de jogos de hoje. Nunca em lugar nenhum.
    //
    // A busca e feita nos containers candidatos, um a um, e nao no innerText do body: o
    // corpo inteiro esconde POR QUE falhou (e o innerText do body ja se mostrou instavel aqui),
    // enquanto a varredura por container diz exatamente onde o confronto deveria estar e nao esta.
    const renderizado = (el) => {
      if (!el || el.classList.contains("hidden")) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const containers = ["liveMatchCard", "nextGameCard", "gamesList"]
      .map(id => document.getElementById(id)).filter(renderizado);
    // NFC nos DOIS lados. "Grêmio" pode chegar aqui em forma decomposta (e + circunflexo
    // combinante) e sair do DOM em forma composta: visualmente identicos, includes falso.
    const nfc = (x) => String(x).normalize("NFC");
    // Duas barras no fonte sao deliberadas: esta funcao vive dentro de um template literal,
    // entao uma barra so viraria um s literal — e o regex passaria a apagar a letra s dos nomes
    // dos times ("Vasco" -> "Va co"), fazendo o gate reprovar por corrupcao propria.
    const texto = nfc(containers.map(el => (el.textContent || "")).join(" ")).replace(/\\s+/g, " ");
    const esperados = (window.__CRIT_ESPERADOS__ || []);
    if (!esperados.length) {
      return { ok: false, motivo: "cenario nao declarou confronto de hoje — regra nao exercitada" };
    }
    const sumiram = esperados.filter(par => !(texto.includes(nfc(par[0])) && texto.includes(nfc(par[1]))));
    return sumiram.length === 0
      ? { ok: true, motivo: "" }
      : { ok: false, motivo: "confronto(s) de hoje ausente(s) de toda superficie visivel: " +
            sumiram.map(p => p.join(" x ")).join(", ") +
            " (containers renderizados: " + containers.map(e => e.id).join(",") + ")" };
  }

  if (nome === "PRIMARY_BEFORE_SECONDARY") {
    const sec = document.getElementById("nextGameCard");
    if (!hero) return { ok: false, motivo: "hero primario ausente" };
    if (!sec) return { ok: true, motivo: "sem painel secundario" };
    // Ordem de documento: o primario tem de vir ANTES. Position.FOLLOWING = o secundario vem depois.
    const depois = !!(hero.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING);
    return depois ? { ok: true, motivo: "" }
                  : { ok: false, motivo: "o painel secundario vem antes do primario" };
  }

  if (nome === "VIEW_PICKS_PATH") {
    const n = document.querySelectorAll("[data-rank-toggle]").length;
    return n > 0 ? { ok: true, motivo: "" }
                 : { ok: false, motivo: "nenhum botao 'Ver palpites' no ranking apos o prazo" };
  }

  if (nome === "HIDDEN_PICKS_ENFORCED") {
    // Antes do prazo o palpite de terceiro nao pode estar na tela, nem por um caminho de detalhe.
    const vazou = document.querySelectorAll("[data-rank-toggle]").length > 0;
    return vazou ? { ok: false, motivo: "'Ver palpites' exposto com o prazo AINDA ABERTO" }
                 : { ok: true, motivo: "" };
  }

  if (nome === "PICK_FORM_MATCHES_LIFECYCLE" || nome === "SAVE_MATCHES_LIFECYCLE") {
    const alvo = document.getElementById(
      nome === "PICK_FORM_MATCHES_LIFECYCLE" ? "pickForm" : "saveEntryBtn");
    const box = document.getElementById("cutoffCountdown");
    // O ciclo de vida derivado pelo PROPRIO app, lido do DOM -- nao uma segunda derivacao aqui,
    // que poderia discordar do produto e reprovar codigo correto.
    const aberto = !!(box && (box.dataset.picksState === "PICKS_OPEN" ||
      /count-grid/.test(box.innerHTML)));
    // O segundo portao, tambem do proprio app: com o roster congelado e sem entrada carregada
    // para edicao, renderNewEntryCard() esconde o card inteiro -- e ai a AUSENCIA do formulario
    // e o comportamento correto, nao regressao. Exigir presenca aqui reprovaria o produto.
    const cartao = document.getElementById("newEntryCard");
    const cartaoAtivo = !!cartao && !cartao.classList.contains("hidden") &&
                        getComputedStyle(cartao).display !== "none";
    if (!aberto) return { ok: true, motivo: "prazo fechado: presenca nao exigida", na: true };
    if (!cartaoAtivo) return { ok: true, motivo: "card de entrada fechado pelo proprio app", na: true };
    if (!alvo) return { ok: false, motivo: "prazo ABERTO, card ativo e o alvo NAO existe" };
    const rect = alvo.getBoundingClientRect();
    const renderizado = !alvo.classList.contains("hidden") &&
                        getComputedStyle(alvo).display !== "none" &&
                        rect.width > 0 && rect.height > 0;
    return renderizado
      ? { ok: true, motivo: "" }
      : { ok: false, motivo: "prazo ABERTO e o alvo nao esta renderizado" };
  }

  if (nome === "HERO_SURVIVES_PROVIDER_FAILURE") {
    if (!hero) return { ok: false, motivo: "hero ausente com a fonte fora" };
    const cs = getComputedStyle(hero);
    const rect = hero.getBoundingClientRect();
    if (hero.classList.contains("hidden") || cs.display === "none" || rect.height === 0)
      return { ok: false, motivo: "hero escondido por falha de provedor" };
    if (txt(hero).length === 0)
      return { ok: false, motivo: "hero montado e VAZIO com a fonte fora" };
    return { ok: true, motivo: "" };
  }

  if (nome === "DEGRADED_KEEPS_AUTHORITATIVE_UPCOMING") {
    if (!hero) return { ok: false, motivo: "hero ausente" };
    const apres = hero.dataset.heroPresentation || "";
    if (apres !== "UPCOMING") return { ok: true, motivo: "sem proxima autoritativa neste cenario" };
    const bloco = hero.querySelector(".next-game-card, .next-match-card");
    return bloco && txt(bloco).length > 0
      ? { ok: true, motivo: "" }
      : { ok: false, motivo: "estado UPCOMING sem o confronto na tela" };
  }

  if (nome === "NO_MOUNTED_BUT_EMPTY") {
    const ids = ["liveTieCard", "liveMatchCard", "rankingList", "gamesList", "standingsCard"];
    const vazios = ids.map(id => document.getElementById(id))
      .filter(el => el && !el.classList.contains("hidden") &&
                    getComputedStyle(el).display !== "none" &&
                    el.getBoundingClientRect().height > 0 &&
                    txt(el).length === 0 && el.children.length === 0)
      .map(el => el.id);
    return vazios.length === 0
      ? { ok: true, motivo: "" }
      : { ok: false, motivo: "container montado e VAZIO: " + vazios.join(",") };
  }

  // Default que REPROVA. Um gate que aprova o que não sabe avaliar compra confiança sem lastro —
  // foi exatamente assim que este arquivo passou verde sem medir nada.
  return { ok: false, motivo: "regra NAO AVALIADA: " + String(nome) + " — gate cego, corrija a regra" };
}`;

/**
 * Leva a página até a SEÇÃO dona da capacidade antes de medir.
 *
 * Sem isto, uma capacidade que vive fora da seção de aterrissagem era medida enquanto sua seção
 * estava escondida — e ou reprovava produto correto (VISIBLE num container `display:none`), ou
 * aprovava sem nunca ter olhado. A pergunta certa é a do participante: "clicando na aba, a função
 * está lá?"
 */
async function irParaSecao(page, secao) {
  if (!secao) return;
  const btn = page.locator(`nav.nav button[data-section="${secao}"]`).first();
  if (await btn.count() === 0) return;
  // Aba DESABILITADA é comportamento de produto, não falha: o CDB2026 desabilita "Palpites"
  // quando o prazo está fechado. Forçar o clique aqui mediria uma tela que o participante não
  // consegue abrir — e transformaria uma regra de ciclo de vida correta em vermelho.
  if (await btn.isDisabled()) return;
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(250);
}

// Quantas vezes cada capacidade foi avaliada DE VERDADE (sem cair em "nao aplicavel"). Uma
// capacidade que e sempre nao-aplicavel esta protegida no papel e por ninguem — este contador
// existe para que isso vire vermelho em vez de virar silencio.
const exercidas = new Map();

async function avaliar(page, cap) {
  await irParaSecao(page, cap.section);
  if (cap.rule) {
    const r = await page.evaluate(new Function("return " + REGRAS)(), [cap.rule, cap.app]);
    if (!r.na) exercidas.set(cap.id, (exercidas.get(cap.id) || 0) + 1);
    return { ok: r.ok, motivos: r.ok ? [] : [r.motivo] };
  }
  exercidas.set(cap.id, (exercidas.get(cap.id) || 0) + 1);
  const r = await page.evaluate(new Function("return " + AVALIADOR)(), cap);
  return { ok: r.ok, motivos: r.motivos, count: r.count };
}

async function avaliarRegra(page, nome, app) {
  return page.evaluate(new Function("return " + REGRAS)(), [nome, app]);
}

function seAplica(cap, estado) {
  return cap.states.includes("*") || cap.states.includes(estado);
}

// ─── Execução ────────────────────────────────────────────────────────────────────────────────
async function varrerApp(browser, app) {
  const caps = REGISTRO.capabilities.filter(c => c.app === app);
  console.log(`\n── ${app.toUpperCase()} — contrato de funcionalidade crítica ──`);

  for (const cenario of cenarios(app)) {
    const { ctx, page } = await abrir(browser, app, cenario);
    const aplicaveis = caps.filter(c => seAplica(c, cenario.estado));
    const quebradas = [];
    for (const cap of aplicaveis) {
      const r = await avaliar(page, cap);
      if (!r.ok) quebradas.push(`${cap.id} (${r.motivos.join("; ")})`);
    }
    // Invariantes compartilhados que valem neste estado.
    for (const inv of REGISTRO.shared_invariants) {
      if (!inv.apps.includes(app)) continue;
      if (!(inv.states.includes("*") || inv.states.includes(cenario.estado))) continue;
      if (inv.rule === "MOBILE_PARITY") continue;   // tem passo próprio abaixo
      const r = await avaliarRegra(page, inv.rule, app);
      if (!r.ok) quebradas.push(`${inv.id} (${r.motivo})`);
    }
    test(`[${app}] estado ${cenario.estado}: ${aplicaveis.length} capacidades críticas intactas`,
         quebradas.length === 0, quebradas.join("\n      "));
    await ctx.close();
  }
}

async function paridadeMobile(browser, app) {
  const inv = REGISTRO.shared_invariants.find(i => i.rule === "MOBILE_PARITY");
  const caps = REGISTRO.capabilities.filter(c => c.app === app && c.viewports.includes("mobile"));
  for (const estado of inv.states) {
    const cenario = cenarios(app).find(c => c.estado === estado);
    if (!cenario) continue;
    const desk = await abrir(browser, app, cenario, { viewport: "desktop" });
    const mob = await abrir(browser, app, cenario, { viewport: "mobile" });
    const divergentes = [];
    for (const cap of caps) {
      if (!seAplica(cap, estado)) continue;
      const d = await avaliar(desk.page, cap);
      const m = await avaliar(mob.page, cap);
      // A paridade é sobre a CAPACIDADE, não sobre o layout: uma capacidade que passa no desktop
      // e some no telefone é a regressão que este invariante existe para pegar.
      if (d.ok && !m.ok) divergentes.push(`${cap.id} — desktop OK, mobile: ${m.motivos.join("; ")}`);
      if (!d.ok && !m.ok) divergentes.push(`${cap.id} — quebrada nos DOIS: ${d.motivos.join("; ")}`);
    }
    test(`[${app}] paridade desktop/mobile em ${estado}`, divergentes.length === 0,
         divergentes.join("\n      "));
    await desk.ctx.close(); await mob.ctx.close();
  }
}

// ─── Mutações: a prova de que o gate morde ────────────────────────────────────────────────────
//
// Cada uma reintroduz uma regressão REAL. `alvo` tem de existir no fonte atual — mutação que não
// aplica mediria o código original e passaria verde por engano, que é o modo de falha silencioso
// mais perigoso de um controle negativo.
function mutacoes(RAIZ) {
  const srcBr = readFileSync(join(RAIZ, "bolao/br2026/js/app.js"), "utf8");
  const srcCdb = readFileSync(join(RAIZ, "bolao/cdb2026/js/app.js"), "utf8");
  const cssBr = readFileSync(join(RAIZ, "bolao/br2026/css/styles.css"), "utf8");

  return [
    {
      id: "PRIMARY_HERO_HIDDEN", app: "br2026", cap: "BR_PRIMARY_FOOTBALL_HERO",
      estado: "provider_unavailable",
      appSrc: () => {
        const alvo = "  card.classList.remove(\"hidden\");";
        if (!srcBr.includes(alvo)) return null;
        return srcBr.replace(alvo,
          "  if (!heroMatches.length) { card.classList.add(\"hidden\"); return; }");
      },
    },
    {
      id: "PRIMARY_HERO_EMPTY", app: "br2026", cap: "BR_PRIMARY_FOOTBALL_HERO",
      estado: "upcoming_fixture",
      appSrc: () => {
        const alvo = "    try { html = renderHeroSemAoVivo(heroEstado, proximo); } catch (_) { html = \"\"; }";
        if (!srcBr.includes(alvo)) return null;
        // Hero montado e VAZIO: exatamente o que a exceção do helper inexistente produziu.
        return srcBr.replace(alvo, "    html = \"\";")
                    .replace(/card\.innerHTML = html && html\.trim\(\)[\s\S]*?`;\n/,
                             "    card.innerHTML = \"\";\n");
      },
    },
    {
      id: "DUPLICATE_PRIMARY_FIXTURE", app: "br2026", cap: "BR_PRIMARY_FIXTURE_UNIQUE",
      estado: "upcoming_fixture",
      appSrc: () => {
        // O card legado volta a desenhar a MESMA próxima partida que o hero — o duplicado real.
        const alvo = "function renderNextGameCard()";
        if (!srcBr.includes(alvo)) return null;
        return srcBr.replace(alvo,
          "function renderNextGameCard() {\n"
          + "  const _p = typeof nextUpcomingGame === \"function\" ? nextUpcomingGame() : null;\n"
          + "  const _c = document.getElementById(\"nextGameCard\");\n"
          + "  if (_p && _c) { _c.classList.remove(\"hidden\");\n"
          + "    _c.innerHTML = `<div class=\"next-game-card\"><div class=\"next-game-teams\">"
          + "${_p.homeTeam} × ${_p.awayTeam}</div></div>`; return; }\n"
          + "}\nfunction __renderNextGameCardOriginal()");
      },
    },
    {
      id: "RANKING_REMOVED", app: "cdb2026", cap: "CDB_RANKING", estado: "picks_closed",
      appSrc: () => {
        const alvo = "  const box = $(\"rankingList\");";
        if (!srcCdb.includes(alvo)) return null;
        return srcCdb.replace(alvo, "  const box = $(\"rankingList\"); if (box) { box.innerHTML = \"\"; return; }\n  if (box)");
      },
    },
    {
      id: "SUPPORT_REMOVED", app: "cdb2026", cap: "CDB_SUPPORT_ACTION", estado: "picks_closed",
      html: true,
    },
    {
      id: "STANDINGS_REMOVED", app: "br2026", cap: "BR_STANDINGS", estado: "normal_fresh",
      appSrc: () => {
        const alvo = "  const card = $(\"standingsCard\");";
        if (!srcBr.includes(alvo)) return null;
        return srcBr.replace(alvo,
          "  const card = $(\"standingsCard\"); if (card) { card.innerHTML = \"\"; card.classList.add(\"hidden\"); return; }\n  if (card)");
      },
    },
    {
      id: "VIEW_PICKS_REMOVED", app: "cdb2026", cap: "CDB_VIEW_PICKS_PATH", estado: "picks_closed",
      appSrc: () => {
        const alvo = "  const canViewPicks = isPastEntryCutoff();";
        if (!srcCdb.includes(alvo)) return null;
        return srcCdb.replace(alvo, "  const canViewPicks = false;");
      },
    },
    {
      id: "TODAY_FIXTURE_SWALLOWED", app: "br2026", cap: "BR_TODAY_FIXTURES_ALL_VISIBLE",
      estado: "live_and_upcoming_today",
      appSrc: () => {
        // A regressao exata da #379: a dedupe da primaria volta a ser INCONDICIONAL, e o jogo de
        // hoje some da pagina enquanto outro esta ao vivo.
        const alvo = "  if (_heroApresentaPrimaria) gamesToShow = gamesToShow.filter(g => !_ehPrimaria(g));";
        if (!srcBr.includes(alvo)) return null;
        return srcBr.replace(alvo, "  gamesToShow = gamesToShow.filter(g => !_ehPrimaria(g));");
      },
    },
    {
      id: "MOBILE_ONLY_DISAPPEARANCE", app: "br2026", cap: "BR_SUPPORT_ACTION",
      estado: "normal_fresh", viewport: "mobile",
      css: () => cssBr + "\n@media (max-width: 480px) { #supportWhatsappBtn { display: none; } }\n",
    },
  ];
}

async function rodarMutacoes(browser) {
  console.log("\n── CONTROLES DE MUTAÇÃO — cada regressão real tem de reprovar ──");
  const muts = mutacoes(RAIZ);
  let mordidas = 0;
  for (const m of muts) {
    const cap = REGISTRO.capabilities.find(c => c.id === m.cap);
    const cenario = cenarios(m.app).find(c => c.estado === m.estado);
    const opts = { viewport: m.viewport || "desktop" };

    if (m.html) {
      // Remoção no HTML: nada a interceptar em app.js — o nó simplesmente não existe. Simulado
      // apagando-o antes de avaliar, que é o mesmo estado final de um `index.html` sem o botão.
      const { ctx, page } = await abrir(browser, m.app, cenario, opts);
      await page.evaluate(() => document.getElementById("supportWhatsappBtn")?.remove());
      const r = await avaliar(page, cap);
      test(`mutação ${m.id} reprova ${m.cap}`, !r.ok,
           r.ok ? "o gate NÃO pegou a remoção — controle negativo cego" : "");
      if (!r.ok) mordidas++;
      await ctx.close();
      continue;
    }

    const src = m.appSrc ? m.appSrc() : null;
    const css = m.css ? m.css() : null;
    if (m.appSrc && src === null) {
      test(`mutação ${m.id} reprova ${m.cap}`, false,
           "MUTAÇÃO NÃO APLICÁVEL — o padrão sumiu do fonte; o controle negativo mediria o original");
      continue;
    }
    const { ctx, page } = await abrir(browser, m.app, cenario, { ...opts, appSrc: src, css });
    const r = await avaliar(page, cap);
    test(`mutação ${m.id} reprova ${m.cap}`, !r.ok,
         r.ok ? "o gate NÃO pegou a regressão — controle negativo cego" : "");
    if (!r.ok) mordidas++;
    await ctx.close();
  }
  return { mordidas, total: muts.length };
}

async function main() {
  const srv = await startStaticServer(PORT, RAIZ);
  const browser = await chromium.launch();
  let mut = { mordidas: 0, total: 0 };
  try {
    console.log("\nPORTÃO DE REGRESSÃO DE FUNCIONALIDADE CRÍTICA");
    console.log(`registro: bolao/shared/safety/critical_functionality.json (${REGISTRO.capabilities.length} capacidades, ${REGISTRO.shared_invariants.length} invariantes compartilhados)`);

    for (const app of ["cdb2026", "br2026"]) {
      if (SO && SO !== app) continue;
      await varrerApp(browser, app);
    }
    console.log("\n── PARIDADE DESKTOP / MOBILE ──");
    for (const app of ["cdb2026", "br2026"]) {
      if (SO && SO !== app) continue;
      await paridadeMobile(browser, app);
    }
    if (!SO) mut = await rodarMutacoes(browser);
  } finally {
    await browser.close();
    srv.stop();
  }

  if (!SO) {
    test(`todos os ${mut.total} controles de mutação mordem`, mut.mordidas === mut.total,
         `${mut.mordidas}/${mut.total} — um controle cego não prova nada`);
    // Cobertura: toda capacidade do registro precisa ter sido avaliada de verdade em pelo menos
    // um cenário. Sem isto, bastaria uma condição sempre falsa para uma capacidade ficar
    // "protegida" e nunca ser medida — o modo de falha silencioso que este gate combate.
    const nuncaExercidas = REGISTRO.capabilities
      .filter(c => (exercidas.get(c.id) || 0) === 0).map(c => c.id);
    test("toda capacidade do registro foi avaliada em ao menos um cenário",
         nuncaExercidas.length === 0,
         `nunca avaliadas: ${nuncaExercidas.join(", ")}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\n  CAPACIDADE CRÍTICA REGREDIU. Isto é um invariante de release:");
    console.log("  uma função que já existia não pode sumir, esvaziar, duplicar ou perder");
    console.log("  comportamento de estado como efeito colateral de outra mudança.");
    console.log("  Corrija a regressão — ou, se a mudança for deliberada, atualize");
    console.log("  bolao/shared/safety/critical_functionality.json e diga por quê no changelog.");
  }
  console.log(fail ? "\n✗ CRITICAL FUNCTIONALITY FAILED\n" : "\n✓ CRITICAL FUNCTIONALITY OK\n");
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
