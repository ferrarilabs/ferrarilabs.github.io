#!/usr/bin/env node
/**
 * test_check_public_pages.mjs — prova que scripts/site/check_public_pages.mjs MORDE. Issue #434.
 *
 * Copia as paginas reais do site para um diretorio temporario, confirma que o gate passa na
 * copia intacta, e entao aplica uma mutacao por vez — cada uma e uma regressao plausivel — e
 * exige que o gate reprove com a mensagem certa. Tambem prova o caso inverso que mais importa
 * para nao gerar falso positivo: alt="" (imagem decorativa) PASSA.
 *
 * Toda mutacao confere que de fato alterou o arquivo; uma mutacao que nao casa com nada
 * "passaria" em silencio e esconderia um gate quebrado.
 *
 * Uso: node scripts/site/test_check_public_pages.mjs
 */

import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = join(ROOT, "scripts/site/check_public_pages.mjs");
const FILES = [
  "index.html", "index.pt.html", "index.es.html", "index.jp.html", "insights.html",
  "privacy.html", "privacy.pt.html", "privacy.es.html", "privacy.jp.html",
  "terms.html", "terms.pt.html", "terms.es.html", "terms.jp.html",
  "404.html", "thanks.html",
  "sitemap.xml", "robots.txt", "site.js", "styles.css",
];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "public-site-gate-"));
  for (const f of FILES) cpSync(join(ROOT, f), join(dir, f));
  return dir;
}

function edit(dir, file, fn) {
  const p = join(dir, file);
  const before = readFileSync(p, "utf8");
  const after = fn(before);
  if (after === before) throw new Error(`mutation did not change ${file}`);
  writeFileSync(p, after);
}

function gate(dir) {
  const r = spawnSync("node", [GATE, `--root=${dir}`], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

const CASES = [
  { name: "intact copy passes", expect: 0 },
  { name: "decorative image with alt=\"\" passes", expect: 0,
    mutate: (d) => edit(d, "privacy.html", (s) => s.replace("<main>", '<main><img src="styles.css" alt="">')) },
  { name: "image without alt", expect: 1, token: "no alt attribute",
    mutate: (d) => edit(d, "privacy.html", (s) => s.replace("<main>", '<main><img src="styles.css">')) },
  { name: "title removed", expect: 1, token: "exactly one <title>",
    mutate: (d) => edit(d, "index.pt.html", (s) => s.replace(/<title>[\s\S]*?<\/title>/, "")) },
  { name: "empty meta description", expect: 1, token: "meta description",
    mutate: (d) => edit(d, "insights.html", (s) => s.replace(/(<meta name="description" content=")[^"]*"/, '$1"')) },
  { name: "canonical on the github.io origin", expect: 1, token: "canonical must be absolute",
    mutate: (d) => edit(d, "index.es.html", (s) => s.replace('rel="canonical" href="https://www.ferrarilabs.com/', 'rel="canonical" href="https://ferrarilabs.github.io/')) },
  { name: "og:url differs from canonical", expect: 1, token: "og:url",
    mutate: (d) => edit(d, "privacy.html", (s) => s.replace('og:url" content="https://www.ferrarilabs.com/privacy.html"', 'og:url" content="https://www.ferrarilabs.com/"')) },
  { name: "twitter card removed", expect: 1, token: "twitter:card",
    mutate: (d) => edit(d, "terms.html", (s) => s.replace(/\s*<meta name="twitter:card"[^>]*>/, "")) },
  { name: "hreflang no longer reciprocal", expect: 1, token: "hreflang alternates must be exactly",
    mutate: (d) => edit(d, "index.jp.html", (s) => s.replace(/\s*<link rel="alternate" hreflang="es"[^>]*>/, "")) },
  { name: "Insights declares hreflang to non-equivalent pages again", expect: 1, token: "no translated versions",
    mutate: (d) => edit(d, "insights.html", (s) => s.replace('<link rel="canonical"', '<link rel="alternate" hreflang="pt-BR" href="https://www.ferrarilabs.com/index.pt.html" />\n  <link rel="canonical"')) },
  { name: "indexable page gets noindex", expect: 1, token: "carries noindex",
    mutate: (d) => edit(d, "terms.html", (s) => s.replace("<title>", '<meta name="robots" content="noindex" />\n  <title>')) },
  { name: "404 loses noindex", expect: 1, token: "utility page must carry",
    mutate: (d) => edit(d, "404.html", (s) => s.replace(/\s*<meta name="robots"[^>]*>/, "")) },
  { name: "404 loses its link home", expect: 1, token: "link back to the home page",
    // Todo link que resolve para a home some — inclusive "/#about", que tambem e a home.
    mutate: (d) => edit(d, "404.html", (s) => s.replace(/href="\/(#[a-z]+)?"/g, 'href="/insights.html"')) },
  { name: "sitemap lists a noindex page", expect: 1, token: "which is a noindex page",
    mutate: (d) => edit(d, "sitemap.xml", (s) => s.replace("</urlset>", "  <url>\n    <loc>https://www.ferrarilabs.com/thanks.html</loc>\n  </url>\n</urlset>")) },
  { name: "sitemap misses an indexable page", expect: 1, token: "missing indexable page",
    mutate: (d) => edit(d, "sitemap.xml", (s) => s.replace(/\s*<url>\s*<loc>https:\/\/www\.ferrarilabs\.com\/terms\.html<\/loc>\s*<\/url>/, "")) },
  { name: "robots.txt without Sitemap", expect: 1, token: "must declare \"Sitemap:",
    mutate: (d) => edit(d, "robots.txt", (s) => s.replace(/^Sitemap:.*$/m, "")) },
  { name: "robots.txt hides the bolão noindex from crawlers", expect: 1, token: "blocks /bolao/",
    mutate: (d) => edit(d, "robots.txt", (s) => s.replace("Disallow: /docs/", "Disallow: /docs/\nDisallow: /bolao/")) },
  { name: "robots.txt blocks the whole site", expect: 1, token: "blocks /styles.css",
    mutate: (d) => edit(d, "robots.txt", (s) => s.replace("Disallow: /docs/", "Disallow: /")) },
  { name: "gtag.js loaded directly again", expect: 1, token: "loads gtag.js directly",
    mutate: (d) => edit(d, "index.html", (s) => s.replace("</head>", '  <script async src="https://www.googletagmanager.com/gtag/js?id=G-KF98YDJNK7"></script>\n</head>')) },
  { name: "site.js deferred", expect: 1, token: "must load synchronously",
    mutate: (d) => edit(d, "index.es.html", (s) => s.replace('<script src="site.js"></script>', '<script src="site.js" defer></script>')) },
  { name: "site.js missing from a page with gtag() handlers", expect: 1, token: "must load site.js exactly once",
    mutate: (d) => edit(d, "insights.html", (s) => s.replace('<script src="site.js"></script>', "")) },
  { name: "Google Analytics loaded before consent", expect: 1, token: "requested before consent",
    mutate: (d) => edit(d, "site.js", (s) => s.replace("if (readChoice() === 'granted') enableAnalytics();", "enableAnalytics();")) },
  { name: "gtag stub removed", expect: 1, token: "window.gtag is not defined",
    mutate: (d) => edit(d, "site.js", (s) => s.replace("window.gtag = function () {", "window.gtagDisabled = function () {")) },
  { name: "privacy page loses the analytics choice", expect: 1, token: "analytics choice controls",
    mutate: (d) => edit(d, "privacy.html", (s) => s.replace('data-consent-choice="denied"', 'data-choice="denied"')) },
  { name: "footer loses the Privacy link", expect: 1, token: "footer must link to privacy.html",
    mutate: (d) => edit(d, "insights.html", (s) => s.replace('<a href="privacy.html">Privacy</a>', '<a href="index.html">Privacy</a>')) },
  // ── traducoes de Privacy/Terms ──
  { name: "PT home footer sends Privacy to the English document", expect: 1, token: "footer must link to privacy.pt.html",
    mutate: (d) => edit(d, "index.pt.html", (s) => s.replace('<a href="privacy.pt.html">', '<a href="privacy.html">')) },
  { name: "JA terms footer sends Terms to the English document", expect: 1, token: "footer must link to terms.jp.html",
    mutate: (d) => edit(d, "terms.jp.html", (s) => s.replace('<a href="terms.jp.html" aria-current="page">', '<a href="terms.html" aria-current="page">')) },
  { name: "Privacy translation missing (privacy.es.html)", expect: 1, token: "privacy.es.html: missing",
    mutate: (d) => rmSync(join(d, "privacy.es.html")) },
  { name: "Terms translation missing (terms.jp.html)", expect: 1, token: "terms.jp.html: missing",
    mutate: (d) => rmSync(join(d, "terms.jp.html")) },
  { name: "x-default of a translation points at the home instead of the English terms", expect: 1, token: "hreflang alternates must be exactly",
    mutate: (d) => edit(d, "terms.pt.html", (s) => s.replace('hreflang="x-default" href="https://www.ferrarilabs.com/terms.html"', 'hreflang="x-default" href="https://www.ferrarilabs.com/"')) },
  { name: "Privacy hreflang no longer reciprocal", expect: 1, token: "hreflang alternates must be exactly",
    mutate: (d) => edit(d, "privacy.jp.html", (s) => s.replace(/\s*<link rel="alternate" hreflang="pt-BR"[^>]*>/, "")) },
  { name: "hreflang points at the wrong document", expect: 1, token: "hreflang alternates must be exactly",
    mutate: (d) => edit(d, "privacy.es.html", (s) => s.replace('hreflang="ja" href="https://www.ferrarilabs.com/privacy.jp.html"', 'hreflang="ja" href="https://www.ferrarilabs.com/terms.jp.html"')) },
  { name: "English Privacy drops its hreflang block", expect: 1, token: "hreflang alternates must be exactly",
    mutate: (d) => edit(d, "privacy.html", (s) => s.replace(/(\s*<link rel="alternate" hreflang="[^"]*"[^>]*>)+/, "")) },
  { name: "Privacy language switcher points at a home page", expect: 1, token: "lang-switcher must link to exactly",
    mutate: (d) => edit(d, "privacy.pt.html", (s) => s.replace('<a href="privacy.es.html">🇪🇸 ES</a>', '<a href="index.es.html">🇪🇸 ES</a>')) },
  { name: "translation loses its lang-active marker", expect: 1, token: "as lang-active",
    mutate: (d) => edit(d, "terms.es.html", (s) => s.replace('<a href="terms.es.html" class="lang-active">', '<a href="terms.es.html">')) },
  { name: "og:locale does not match the page language", expect: 1, token: "must be es_ES",
    mutate: (d) => edit(d, "privacy.es.html", (s) => s.replace('og:locale" content="es_ES"', 'og:locale" content="en_US"')) },
  { name: "sitemap misses a translation", expect: 1, token: "missing indexable page https://www.ferrarilabs.com/terms.jp.html",
    mutate: (d) => edit(d, "sitemap.xml", (s) => s.replace(/\s*<url>\s*<loc>https:\/\/www\.ferrarilabs\.com\/terms\.jp\.html<\/loc>\s*<\/url>/, "")) },
  { name: "translated Privacy loses the analytics choice", expect: 1, token: "analytics choice controls",
    mutate: (d) => edit(d, "privacy.jp.html", (s) => s.replace("data-consent-status", "data-status")) },
  { name: "broken local link", expect: 1, token: "broken local link",
    mutate: (d) => edit(d, "insights.html", (s) => s.replace('href="index.html#about"', 'href="about.html"')) },
  { name: "anchor target removed", expect: 1, token: "#about, which does not exist",
    mutate: (d) => edit(d, "index.html", (s) => s.replace('id="about"', 'id="about-me"')) },
  { name: "honeypot removed from the contact form", expect: 1, token: "_gotcha",
    mutate: (d) => edit(d, "index.pt.html", (s) => s.replace(/\s*<input type="text" name="_gotcha"[^>]*>/, "")) },
  { name: "form status live region removed", expect: 1, token: "data-form-status",
    mutate: (d) => edit(d, "index.es.html", (s) => s.replace(/\s*<p class="form-status"[^>]*><\/p>/, "")) },
  { name: "unclassified page added at the root", expect: 1, token: "unclassified root page",
    mutate: (d) => writeFileSync(join(d, "landing.html"), "<!DOCTYPE html><html lang=\"en\"><head><title>x</title></head></html>") },
];

let failures = 0;
for (const c of CASES) {
  const dir = fixture();
  try {
    if (c.mutate) c.mutate(dir);
    const r = gate(dir);
    const ok = r.code === c.expect && (!c.token || r.out.includes(c.token));
    if (!ok) {
      failures++;
      console.log(`  ✗ ${c.name} — expected exit ${c.expect}${c.token ? ` mentioning "${c.token}"` : ""}, got exit ${r.code}`);
      console.log(r.out.split("\n").slice(0, 12).map((l) => `      ${l}`).join("\n"));
    } else {
      console.log(`  ✓ ${c.name}`);
    }
  } catch (e) {
    failures++;
    console.log(`  ✗ ${c.name} — ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures) {
  console.log(`\n✗ ${failures}/${CASES.length} public-site gate cases failed`);
  process.exit(1);
}
console.log(`\n✓ ${CASES.length}/${CASES.length} public-site gate cases behave as expected`);
