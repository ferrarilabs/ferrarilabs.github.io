#!/usr/bin/env node
/**
 * BATCH 9 — auditoria de acessibilidade e responsividade dos QUATRO aplicativos.
 *
 * O que já existia e NÃO é substituído por esta suíte:
 *   · `test_aria_current_nav.mjs`   — `aria-current` na navegação por abas (3 apps de futebol)
 *   · `test_draw_combo.mjs`         — ARIA/teclado do combobox do Powerball
 *   · `test_combo_lifecycle.mjs`    — ciclo de vida de listeners do mesmo combobox
 *   · `audit_visual_consistency`    — estilo computado entre apps
 *
 * O que ESTA suíte adiciona, e que nenhuma delas cobria: as propriedades de acessibilidade da
 * PÁGINA — landmarks, hierarquia de headings, nomes acessíveis, semântica de tabela, foco visível,
 * ordem de foco, alvo de toque — medidas no DOM RENDERIZADO, nos quatro apps, e a matriz responsiva
 * de larguras.
 *
 * ESCOPO É PARTE DO CONTRATO. Três falhas desta sprint tiveram a mesma forma: o número ficou verde
 * enquanto o escopo encolhia em silêncio. Por isso a lista de apps aqui é derivada de
 * `audit_tool_scope.test.mjs` (mesma fonte da verdade) e um app novo faz esta suíte FALHAR até ser
 * deliberadamente incluído — nunca sumir sem ninguém ver.
 *
 * As larguras incluem 899/900/901/902 de propósito: essa família de breakpoint já produziu
 * resultado visual enganoso antes (ver `settleLayout()` em audit_visual_consistency.mjs).
 *
 * Uso: node bolao/scripts/audit_accessibility.mjs
 */

import { launchChromium } from "../cdb2026/scripts/visual/playwright_loader.mjs";
import { startStaticServer } from "./static_server.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PORT = 8205;

// Fonte da verdade única (a mesma de audit_tool_scope.test.mjs) — ver cabeçalho.
const APPS = {
  copa2026: { path: "/bolao/copa2026/", archived: true },
  br2026: { path: "/bolao/br2026/" },
  cdb2026: { path: "/bolao/cdb2026/" },
  "loterias/powerball": { path: "/bolao/loterias/powerball/", singlePage: true },
};

// 899/900/901/902 juntos de propósito: é a borda que já enganou a suíte visual.
// 393 (Pixel 8 / iPhone 15) e 414 (iPhone Plus) faltavam. 1600 fica: ja estava coberto e
// remover largura de uma suite de acessibilidade e perder cobertura sem ganho.
const WIDTHS = [320, 360, 375, 390, 393, 414, 430, 768, 899, 900, 901, 902, 1024, 1280, 1600];

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; failures.push(name); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const server = await startStaticServer(PORT, ROOT);
const browser = await launchChromium();

/** Coleta o estado de acessibilidade do DOM RENDERIZADO (não do template). */
async function collect(appPath, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push(String(e)));
  await page.goto(`http://localhost:${PORT}${appPath}`, { waitUntil: "load" });

  // ── A FOLHA DE ESTILO PRECISA ESTAR APLICADA ANTES DE MEDIR ────────────────────────────────
  //
  // 2026-08-12: este gate acusou `A.audit-report-link` com <24px em 1600px no copa2026. O CSS
  // desse elemento torna isso IMPOSSÍVEL: `min-height:24px` + 6px de padding em cima e embaixo
  // + borda dá ~38px. Uma medição impossível não é um defeito do produto — é a página sendo
  // medida antes do CSS pintar.
  //
  // O sintoma já tinha aparecido em 414px em 2026-08-11 e foi tratado no CSS (inline-flex +
  // min-height). Aquilo era necessário, mas curou o sintoma no lugar errado: a intermitência
  // voltou noutra largura, porque a causa nunca esteve no CSS.
  //
  // `waitUntil:"load"` não garante REGRAS APLICÁVEIS: o <link> pode ter disparado o evento com
  // o CSSOM ainda não montado, e o app carrega CSS com cache-bust `?v=`. Então esperamos a
  // CONDIÇÃO — existir folha com regras legíveis — em vez de esperar o relógio.
  // EXIGE TODAS AS FOLHAS, não "alguma".
  //
  // A primeira versão desta espera aceitava QUALQUER folha com regras. Não bastava, e o
  // diagnóstico provou: a falha veio com
  //
  //     A.audit-report-link [294.8x18.0 min-h=0px disp=inline pad=0px font=15px sheets=9 fonts=loaded]
  //
  // `min-h=0px`, `disp=inline`, `pad=0px`, `font=15px` — NENHUMA regra de `.audit-report-link`
  // aplicada, com nove folhas já presentes. Ou seja: outra folha tinha carregado e satisfeito a
  // condição, enquanto a folha que define este elemento ainda não estava aplicada.
  //
  // "Alguma folha pronta" nunca foi a pergunta certa. A pergunta é se TODO `<link
  // rel=stylesheet>` já virou CSSOM — `link.sheet` só deixa de ser null quando a folha foi
  // baixada E parseada. Um `<link>` com `sheet === null` é exatamente uma regra que ainda não
  // existe para o layout.
  // E A FOLHA DO APP TEM DE ESTAR INTEIRA, não só presente.
  //
  // O diagnóstico fechou o caso: a falha veio com `sheets=9` — TODAS as folhas presentes (8
  // compartilhadas + a do app) — e mesmo assim `min-h=0px disp=inline pad=0px`, enquanto
  // `font=15px/Inter` provava que outras folhas ESTAVAM aplicadas.
  //
  // Folha presente e regra ausente só coexistem de um jeito: a folha foi servida pela metade. O
  // servidor estático local atende a suíte inteira em paralelo, e `.audit-report-link` está na
  // linha 334 de `css/styles.css` — fundo suficiente para desaparecer num corpo truncado. O
  // CSSOM aceita o que chegou e não reclama do que faltou.
  //
  // Por isso a espera olha a CONTAGEM DE REGRAS da última folha (a do app), não sua existência.
  // Truncada, ela tem poucas regras; inteira, tem dezenas. E se depois de recarregar continuar
  // curta, o gate FALHA dizendo isso — em vez de reportar um alvo de toque que nunca foi pequeno.
  const folhaDoAppInteira = () => page.evaluate(() => {
    const links = [...document.querySelectorAll('link[rel~="stylesheet"]')];
    if (!links.length) return { ok: false, regras: 0 };
    const ultima = links[links.length - 1];
    try {
      const n = ultima.sheet ? ultima.sheet.cssRules.length : 0;
      return { ok: links.every(l => l.sheet !== null) && n >= 20, regras: n };
    } catch { return { ok: true, regras: -1 }; }   // cross-origin: não dá para inspecionar
  });

  let css = await folhaDoAppInteira();
  for (let tentativa = 0; tentativa < 3 && !css.ok; tentativa++) {
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(400);
    css = await folhaDoAppInteira();
  }
  if (!css.ok) {
    throw new Error(
      `[a11y] ${appPath} @${width}px: a folha do app veio incompleta (${css.regras} regras) ` +
      `depois de 3 recargas. Medir agora acusaria alvo de toque pequeno num elemento que só ` +
      `está sem CSS — é preciso consertar o servidor estático, não o CSS do app.`);
  }

  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(1400);

  // ── E O LAYOUT PRECISA TER PARADO DE SE MEXER ──────────────────────────────────────────────
  //
  // O app pinta em duas etapas (estado local primeiro, Supabase depois), então há um instante
  // legítimo em que a geometria ainda muda. Exigir duas leituras CONSECUTIVAS IGUAIS distingue
  // "pequeno de verdade" de "medido no meio do repaint": um alvo realmente pequeno mede igual
  // as duas vezes.
  const alvos = () => page.evaluate(() => [...document.querySelectorAll("a[href],button")]
    .map(e => { const r = e.getBoundingClientRect(); return `${e.className}|${Math.round(r.width)}x${Math.round(r.height)}`; })
    .join(";"));
  let anterior = await alvos();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(150);
    const agora = await alvos();
    if (agora === anterior) break;
    anterior = agora;
  }
  const data = await page.evaluate(() => {
    const visible = el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" && r.width > 0 && r.height > 0;
    };
    const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible);
    const levels = heads.map(h => +h.tagName[1]);
    const gaps = [];
    for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) gaps.push(`${levels[i - 1]}→${levels[i]}`);

    const focusable = [...document.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(visible);

    const interactive = [...document.querySelectorAll("button,a[href],[role=button],[role=option],input,select")].filter(visible);
    // WCAG 2.2 SC 2.5.8 (Target Size Minimum) traz uma EXCEÇÃO EXPLÍCITA para alvo "inline": quando
    // ele está dentro de uma frase, ou tem o tamanho limitado pela line-height do texto ao redor.
    // É o caso do link "Admin" no rodapé da Copa — literalmente
    // "v4.176 · sync 08/08, 14:35 ET · Admin", em 11px, com altura igual à line-height do parágrafo.
    // Aumentá-lo para 24px quebraria a linha do rodapé para satisfazer uma regra que a própria
    // norma não aplica aqui. Conferido em captura de tela antes de classificar assim — justamente
    // para não repetir o erro de explicar um número divergente em vez de olhar.
    const isInlineException = e => {
      const cs = getComputedStyle(e);
      if (!/^inline/.test(cs.display)) return false;
      const parent = e.parentElement;
      if (!parent) return false;
      const hasSurroundingText = [...parent.childNodes]
        .some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!hasSurroundingText) return false;
      const lh = parseFloat(getComputedStyle(parent).lineHeight);
      return Number.isFinite(lh) && e.getBoundingClientRect().height <= lh + 1;
    };
    const smallTargets = interactive
      .filter(e => { const r = e.getBoundingClientRect(); return r.height < 24 || r.width < 24; })
      .filter(e => !isInlineException(e))
      // DIAGNÓSTICO JUNTO DA ACUSAÇÃO (2026-08-12).
      //
      // Este gate acusou `A.audit-report-link` com <24px — cujo CSS (`min-height:24px` + padding
      // + borda ≈ 38px) torna isso impossível. Reproduzir custou ~6 execuções de ~2 min cada, e
      // no fim a acusação não dizia o suficiente para decidir entre as hipóteses: CSS não
      // aplicado, fonte não carregada, ou repaint no meio da medição.
      //
      // As três deixam assinaturas DIFERENTES na altura medida e no `min-height` computado. Uma
      // falha que carrega essas duas medidas se explica sozinha na primeira vez que aparecer —
      // que é o que se quer de um defeito raro: não dá para pedir que ele volte na hora certa.
      .map(e => {
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        const nome = `${e.tagName}${e.id ? "#" + e.id : ""}.${(e.className || "").toString().split(" ")[0]}`;
        return `${nome} [${r.width.toFixed(1)}x${r.height.toFixed(1)}` +
               ` min-h=${cs.minHeight} disp=${cs.display} pad=${cs.paddingTop}` +
               ` font=${cs.fontSize}/${cs.fontFamily.split(",")[0]}` +
               ` sheets=${document.styleSheets.length} fonts=${document.fonts.status}]`;
      });

    const namelessControls = [...document.querySelectorAll("button,a[href]")].filter(visible).filter(e =>
      !e.textContent.trim() && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby") &&
      !e.querySelector("img[alt]:not([alt=''])") && !e.getAttribute("title"));

    const fields = [...document.querySelectorAll("input,select,textarea")].filter(visible)
      .filter(e => e.type !== "hidden");
    const unlabeled = fields.filter(e => !(e.labels && e.labels.length) && !e.getAttribute("aria-label") &&
      !e.getAttribute("aria-labelledby") && !e.getAttribute("title"));

    const ths = [...document.querySelectorAll("table th")].filter(visible);
    const thsNoScope = ths.filter(th => !th.getAttribute("scope"));

    // Div/span com handler de clique e sem papel: controle inalcançável por teclado.
    const fakeButtons = [...document.querySelectorAll("div[onclick],span[onclick],li[onclick]")]
      .filter(visible).filter(e => !e.getAttribute("role") && !e.hasAttribute("tabindex"));

    const expandedRefs = [...document.querySelectorAll("[aria-controls]")].filter(visible)
      .filter(e => !document.getElementById(e.getAttribute("aria-controls")));

    return {
      landmarks: { main: document.querySelectorAll("main").length, header: document.querySelectorAll("header").length,
                   footer: document.querySelectorAll("footer").length, nav: document.querySelectorAll("nav").length },
      lang: document.documentElement.lang || "",
      skipLink: !!document.querySelector("a.skip-link"),
      skipTargetExists: (() => { const a = document.querySelector("a.skip-link");
        return a ? !!document.querySelector(a.getAttribute("href")) : null; })(),
      visibleH1: heads.filter(h => h.tagName === "H1").length,
      headingLevels: levels.join(","),
      headingGaps: gaps,
      focusableCount: focusable.length,
      smallTargets, namelessControls: namelessControls.map(e => e.id || e.className || e.tagName),
      unlabeledFields: unlabeled.map(e => e.id || e.name || e.type),
      thsTotal: ths.length, thsNoScope: thsNoScope.length,
      fakeButtons: fakeButtons.length,
      danglingAriaControls: expandedRefs.map(e => e.getAttribute("aria-controls")),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    };
  });
  return { page, ctx, data, consoleErrors };
}

console.log("\nBatch 9 — acessibilidade e responsividade dos quatro apps\n");

// ─── ESCOPO: esta suíte precisa provar que cobre os quatro ───────────────────
test("ESCOPO: a suíte cobre exatamente os quatro apps da plataforma", () => {
  const scopeSrc = readFileSync(join(HERE, "audit_tool_scope.test.mjs"), "utf8");
  const expected = [...scopeSrc.match(/const EXPECTED_APPS = \[([\s\S]*?)\]/)[1]
    .matchAll(/["']([^"']+)["']/g)].map(m => m[1]);
  const mine = Object.keys(APPS);
  const missing = expected.filter(a => !mine.includes(a));
  eq(missing.length, 0, `esta suíte não cobre ${missing.join(", ")} — um app não pode sumir daqui em silêncio`);
  eq(mine.length, expected.length, "esta suíte cobre apps que a plataforma não declara");
});

// ─── Semântica de página, por app ───────────────────────────────────────────
const collected = {};
for (const [app, cfg] of Object.entries(APPS)) {
  const { page, ctx, data, consoleErrors } = await collect(cfg.path);
  collected[app] = { data, page, ctx, consoleErrors, cfg };

  test(`[${app}] landmarks: main/header presentes, e um rodapé real`, () => {
    eq(data.landmarks.main, 1, "precisa de exatamente um <main>");
    eq(data.landmarks.header, 1, "precisa de exatamente um <header>");
    assert(data.landmarks.footer >= 1, "sem <footer>: o conteúdo final fica fora de qualquer landmark");
  });

  test(`[${app}] a página tem UM heading de nível 1 visível`, () => {
    eq(data.visibleH1, 1,
      `headings visíveis: [${data.headingLevels}]. Zero h1 deixa o leitor de tela sem título de página; ` +
      `mais de um desfaz a hierarquia.`);
  });

  test(`[${app}] hierarquia de headings sem salto de nível`, () => {
    eq(data.headingGaps.length, 0, `saltos: ${data.headingGaps.join(", ")} (sequência visível: ${data.headingLevels})`);
  });

  test(`[${app}] link "pular para o conteúdo" existe e aponta para algo real`, () => {
    assert(data.skipLink, "sem a.skip-link — usuário de teclado percorre o header inteiro a cada carga");
    eq(data.skipTargetExists, true, "o alvo do skip link não existe no DOM");
  });

  test(`[${app}] idioma declarado no <html>`, () => {
    assert(/^[a-z]{2}(-[A-Z]{2})?$/.test(data.lang), `lang inválido ou ausente: ${JSON.stringify(data.lang)}`);
  });

  test(`[${app}] todo controle visível tem nome acessível`, () => {
    eq(data.namelessControls.length, 0, `sem nome: ${data.namelessControls.join(", ")}`);
  });

  test(`[${app}] todo campo de formulário visível tem label`, () => {
    eq(data.unlabeledFields.length, 0, `sem label: ${data.unlabeledFields.join(", ")}`);
  });

  test(`[${app}] nenhum controle falso (div/span clicável sem papel nem foco)`, () => {
    eq(data.fakeButtons, 0, "há div/span com onclick sem role nem tabindex — inalcançável por teclado");
  });

  test(`[${app}] toda tabela visível tem <th scope>`, () => {
    eq(data.thsNoScope, 0, `${data.thsNoScope} de ${data.thsTotal} <th> sem scope — a associação célula/cabeçalho se perde`);
  });

  test(`[${app}] nenhum aria-controls apontando para id inexistente`, () => {
    eq(data.danglingAriaControls.length, 0, `quebrados: ${data.danglingAriaControls.join(", ")}`);
  });

  test(`[${app}] alvos de toque com pelo menos 24px`, () => {
    eq(data.smallTargets.length, 0, `pequenos demais: ${data.smallTargets.slice(0, 6).join(", ")}`);
  });

  test(`[${app}] sem erro de console (fora o aviso conhecido de frame-ancestors)`, () => {
    const bad = consoleErrors.filter(e => !/frame-ancestors/i.test(e));
    eq(bad.length, 0, bad.slice(0, 2).join(" | "));
  });
}

// ─── Teclado: foco visível e ordem de foco ──────────────────────────────────
for (const [app, { page }] of Object.entries(collected)) {
  const kb = await (async () => {
    // A PROPRIEDADE REAL é "o skip link é o primeiro elemento focável em ordem de documento", e é
    // isso que se mede — em vez de apertar Tab e torcer para o foco estar no começo.
    // Motivo: estes apps chamam `.focus()` no heading da seção ativa (ponto de aterrissagem para
    // leitor de tela, ver `h2:focus` em shell.css) e alguns o fazem DEPOIS de carregar dados
    // remotos. Um `blur()` seguido de Tab é uma corrida contra esse foco assíncrono: passava em
    // dois apps e falhava nos outros dois, acusando como defeito de produto um comportamento
    // correto e deliberado. Ordem de documento é determinística e é o que de fato importa.
    await page.evaluate(() => window.scrollTo(0, 0));
    const first = await page.evaluate(() => {
      const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const inTabOrder = [...document.querySelectorAll(sel)].filter(el => {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && el.tabIndex >= 0;
      });
      const el = inTabOrder[0];
      if (!el) return null;
      el.focus();
      return { tag: el.tagName, cls: (el.className || "").toString(), el: true };
    });
    // `.skip-link` vai de `top:-48px` a `top:8px` com `transition: top .15s`. Medir na hora lê a
    // posição no MEIO da animação e conclui, errado, que ele não aparece.
    await page.waitForTimeout(320);
    Object.assign(first || {}, await page.evaluate(() => {
      const el = document.activeElement, cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return { onScreen: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + r.height,
               outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
               shadow: cs.boxShadow !== "none", bg: cs.backgroundColor };
    }));
    // Percorre a ordem de foco. A IDENTIDADE precisa ser do NÓ, não de `tag+id`: numa lista de N
    // botões iguais e sem id, `tag+id` colide e uma navegação perfeitamente normal parece uma
    // armadilha de foco. Marca cada nó visitado com um atributo único.
    const walk = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      walk.push(await page.evaluate((i) => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        el.setAttribute("data-a11y-visit", el.getAttribute("data-a11y-visit") ?? String(i));
        const cs = getComputedStyle(el);
        return { tag: el.tagName, id: el.id, nodeKey: el.getAttribute("data-a11y-visit"),
                 focusRing: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none" };
      }, i));
    }
    return { first, walk: walk.filter(Boolean) };
  })();

  test(`[${app}] o skip link é o PRIMEIRO da ordem de foco e aparece ao ser focado`, () => {
    assert(kb.first, "nenhum elemento focável na página");
    assert(/skip-link/.test(kb.first.cls),
      `o primeiro focável em ordem de documento é <${kb.first.tag} class="${kb.first.cls}">, não o skip link — ` +
      `quem navega por teclado percorre o header inteiro antes de chegar ao conteúdo`);
    assert(kb.first.onScreen, "o skip link recebe foco mas continua fora da tela");
    assert(kb.first.outline || kb.first.shadow || kb.first.bg !== "rgba(0, 0, 0, 0)",
      "o skip link focado não tem indicador visível");
  });

  test(`[${app}] todo elemento na ordem de foco tem indicador visível`, () => {
    const blind = kb.walk.filter(w => !w.focusRing);
    eq(blind.length, 0, `sem anel de foco: ${blind.slice(0, 5).map(w => w.tag + (w.id ? "#" + w.id : "")).join(", ")}`);
  });

  test(`[${app}] a navegação por teclado não fica presa (sai de qualquer elemento)`, () => {
    const distinct = new Set(kb.walk.map(w => w.nodeKey)).size;
    assert(distinct > 1 || kb.walk.length <= 1,
      `25 Tabs visitaram sempre o MESMO nó (${kb.walk[0]?.tag}) — armadilha de foco fora de modal`);
  });
}

// ─── Matriz responsiva ──────────────────────────────────────────────────────
for (const [app, cfg] of Object.entries(APPS)) {
  const bad = [];
  for (const w of WIDTHS) {
    const { ctx, data } = await collect(cfg.path, w);
    if (data.overflow) bad.push(`${w}px (scrollW=${data.scrollW} > clientW=${data.clientW})`);
    if (data.smallTargets.length) bad.push(`${w}px: alvo <24px (${data.smallTargets[0]})`);
    await ctx.close();
  }
  test(`[${app}] sem overflow horizontal nem alvo pequeno em ${WIDTHS.length} larguras (320→1600, inclui 899/900/901/902)`, () => {
    eq(bad.length, 0, bad.join(" | "));
  });
}

for (const { ctx } of Object.values(collected)) await ctx.close();
await browser.close();
server.stop();

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log(`\n✗ ACCESSIBILITY SUITE FAILED\n`); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
