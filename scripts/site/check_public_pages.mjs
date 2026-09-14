#!/usr/bin/env node
/**
 * check_public_pages.mjs — invariantes de SEO, acessibilidade e privacidade do site profissional
 * (www.ferrarilabs.com). Issue #434.
 *
 * ─── POR QUE EXISTE ──────────────────────────────────────────────────────────────────────────
 *
 * O dominio tem duas categorias que nao podem se misturar:
 *
 *   A. o site profissional (index*.html, insights.html, privacy.html, terms.html) — indexavel;
 *   B. os apps /bolao/ e as paginas utilitarias (404, thanks) — noindex.
 *
 * Este gate trata SO a categoria A como SEO publico, e prova que nada da B vaza para o sitemap.
 * Ele tambem trava o consentimento de analytics: o GA4 so pode carregar via site.js, depois do
 * aceite, e `gtag()` precisa existir sempre — as paginas tem handlers inline que o chamam, e um
 * `gtag` indefinido e um ReferenceError a cada clique.
 *
 * Estatico e sem dependencia: le os arquivos, nao abre navegador. O comportamento do site.js e
 * exercitado de verdade num `vm` com DOM minimo (sem escolha / recusado / aceito / storage
 * bloqueado) — nao e uma busca por texto.
 *
 * Uso: node scripts/site/check_public_pages.mjs [--root=<dir>]
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ORIGIN = "https://www.ferrarilabs.com";
const rootArg = process.argv.find((a) => a.startsWith("--root="));
const ROOT = rootArg
  ? rootArg.slice("--root=".length)
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Paginas profissionais indexaveis -> lang esperado do documento. */
const INDEXABLE = {
  "index.html": "en",
  "index.pt.html": "pt-BR",
  "index.es.html": "es",
  "index.jp.html": "ja",
  "insights.html": "en",
  "privacy.html": "en",
  "terms.html": "en",
};
/** Paginas utilitarias na raiz: existem, mas nunca sao SEO publico. */
const NOINDEX = { "404.html": "en", "thanks.html": "en" };
/** Traducoes da mesma pagina: hreflang reciproco + x-default. */
const HREFLANG_GROUP = ["index.html", "index.pt.html", "index.es.html", "index.jp.html"];
const FOOTER_LINKS = ["privacy.html", "terms.html"];
/** Paginas com formulario de contato (Formspree). */
const CONTACT_PAGES = HREFLANG_GROUP;

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ── parsing minimo de HTML ─────────────────────────────────────────────────────────────────────

/** Remove comentarios e o CORPO dos <script>, para que JS e comentario nunca contem como markup. */
function markup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)[\s\S]*?(<\/script>)/gi, "$1$2");
}

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function tagSources(html, name) {
  return html.match(new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi")) || [];
}

function attrs(source) {
  const out = {};
  const inner = source.replace(/^<[a-zA-Z0-9]+/, "").replace(/\/?>$/, "");
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

const tags = (html, name) => tagSources(html, name).map(attrs);

function metaValues(html, key) {
  return tags(html, "meta")
    .filter((a) => a.name === key || a.property === key)
    .map((a) => a.content ?? "");
}

function relTokens(a) {
  return (a.rel || "").toLowerCase().split(/\s+/).filter(Boolean);
}

function idsOf(html) {
  return new Set([...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
}

/** URL absoluta do site -> arquivo do repositorio, ou null se nao for do site. */
function urlToFile(url) {
  if (!url.startsWith(ORIGIN + "/")) return null;
  let path = url.slice(ORIGIN.length).split("#")[0].split("?")[0];
  if (path.endsWith("/")) path += "index.html";
  return path.slice(1);
}

/** href/src local -> { file, fragment }; null para externo (http:, mailto:, //host). */
function resolveLocal(fromFile, href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const hashAt = href.indexOf("#");
  const fragment = hashAt >= 0 ? href.slice(hashAt + 1) : "";
  const path = (hashAt >= 0 ? href.slice(0, hashAt) : href).split("?")[0];
  if (path === "") return { file: fromFile, fragment };
  let rel = path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(fromFile), path);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  return { file: posix.normalize(rel), fragment };
}

// ── checks por pagina ─────────────────────────────────────────────────────────────────────────

const canonicals = {};

function commonChecks(file, lang, raw, html) {
  const htmlTag = tags(html, "html")[0] || {};
  if (htmlTag.lang !== lang) fail(file, `<html lang> must be "${lang}", found "${htmlTag.lang ?? ""}"`);

  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  if (titles.length !== 1) fail(file, `expected exactly one <title>, found ${titles.length}`);
  else if (!titles[0][1].trim()) fail(file, "<title> is empty");

  if (!tags(html, "meta").some((a) => "charset" in a)) fail(file, "missing <meta charset>");
  if (!metaValues(html, "viewport").some((c) => /width=device-width/.test(c))) {
    fail(file, "missing <meta name=\"viewport\" content=\"width=device-width, ...\">");
  }
  const desc = metaValues(html, "description");
  if (desc.length !== 1 || !desc[0].trim()) fail(file, "needs exactly one non-empty meta description");

  // alt="" e VALIDO (imagem decorativa); so a AUSENCIA do atributo e erro.
  for (const a of tags(html, "img")) {
    if (!("alt" in a)) fail(file, `<img src="${a.src || "?"}"> has no alt attribute (use alt="" for decorative images)`);
  }

  for (const [tag, attr] of [["a", "href"], ["link", "href"], ["script", "src"], ["img", "src"]]) {
    for (const a of tags(html, tag)) {
      const value = a[attr];
      if (!value) continue;
      const r = resolveLocal(file, value);
      if (!r) continue;
      if (!existsSync(join(ROOT, r.file))) { fail(file, `broken local link ${tag}[${attr}="${value}"]`); continue; }
      if (r.fragment && r.file.endsWith(".html") && !idsOf(markup(read(r.file))).has(r.fragment)) {
        fail(file, `link "${value}" points at #${r.fragment}, which does not exist in ${r.file}`);
      }
    }
  }

  if (/googletagmanager\.com\/gtag\/js|google-analytics\.com\/analytics\.js/i.test(raw)) {
    fail(file, "loads gtag.js directly — Google Analytics must load only through site.js, after consent");
  }
}

function requireSiteJsInHead(file, raw) {
  const head = markup(raw.split(/<\/head>/i)[0]);
  const scripts = tags(head, "script").filter((a) => a.src && resolveLocal(file, a.src)?.file === "site.js");
  if (scripts.length !== 1) {
    fail(file, `must load site.js exactly once in <head> (inline handlers call gtag()), found ${scripts.length}`);
  } else if ("async" in scripts[0] || "defer" in scripts[0]) {
    fail(file, "site.js must load synchronously (no async/defer): gtag() has to exist before any inline handler can fire");
  }
}

function indexableChecks(file, raw, html) {
  if (metaValues(html, "robots").some((c) => /noindex/i.test(c))) fail(file, "indexable page carries noindex");

  const canon = tags(html, "link").filter((a) => relTokens(a).includes("canonical"));
  if (canon.length !== 1) {
    fail(file, `expected exactly one canonical, found ${canon.length}`);
  } else {
    const href = canon[0].href || "";
    if (!href.startsWith(ORIGIN + "/")) fail(file, `canonical must be absolute on ${ORIGIN}, found "${href}"`);
    else if (urlToFile(href) !== file) fail(file, `canonical "${href}" does not point at this file`);
    else canonicals[file] = href;
  }

  for (const key of ["og:title", "og:description", "og:type", "og:url", "og:site_name", "og:locale", "twitter:title", "twitter:description"]) {
    const v = metaValues(html, key);
    if (v.length !== 1 || !v[0].trim()) fail(file, `needs exactly one non-empty ${key}`);
  }
  const ogUrl = metaValues(html, "og:url")[0];
  if (canonicals[file] && ogUrl !== undefined && ogUrl !== canonicals[file]) {
    fail(file, `og:url "${ogUrl}" must equal the canonical "${canonicals[file]}"`);
  }
  const locale = metaValues(html, "og:locale")[0];
  if (locale && !/^[a-z]{2}_[A-Z]{2}$/.test(locale)) fail(file, `og:locale "${locale}" must look like en_US`);
  const card = metaValues(html, "twitter:card");
  if (card.length !== 1 || !["summary", "summary_large_image"].includes(card[0])) {
    fail(file, "needs exactly one twitter:card of summary or summary_large_image");
  }
  // Imagem social so e aceita apontando para um arquivo que existe de verdade.
  for (const key of ["og:image", "twitter:image"]) {
    for (const v of metaValues(html, key)) {
      const target = urlToFile(v);
      if (!target || !existsSync(join(ROOT, target))) fail(file, `${key} "${v}" must be an absolute ${ORIGIN} URL of an existing file`);
    }
  }

  const footer = (html.match(/<footer\b[\s\S]*?<\/footer>/i) || [""])[0];
  for (const link of FOOTER_LINKS) {
    if (!tags(footer, "a").some((a) => a.href && resolveLocal(file, a.href)?.file === link)) {
      fail(file, `footer must link to ${link}`);
    }
  }

  const alternates = tags(html, "link").filter((a) => relTokens(a).includes("alternate") && a.hreflang);
  if (!HREFLANG_GROUP.includes(file) && alternates.length) {
    fail(file, "declares hreflang alternates but has no translated versions (hreflang must point at equivalent pages)");
  }

  requireSiteJsInHead(file, raw);
}

function noindexChecks(file, html) {
  if (!metaValues(html, "robots").some((c) => /noindex/i.test(c))) fail(file, "utility page must carry <meta name=\"robots\" content=\"noindex,...\">");
  if (!tags(html, "a").some((a) => a.href && resolveLocal(file, a.href)?.file === "index.html")) {
    fail(file, "must link back to the home page");
  }
}

function hreflangChecks() {
  const expected = {};
  for (const f of HREFLANG_GROUP) if (canonicals[f]) expected[INDEXABLE[f]] = canonicals[f];
  expected["x-default"] = ORIGIN + "/";
  const want = JSON.stringify(Object.entries(expected).sort());
  for (const f of HREFLANG_GROUP) {
    if (!existsSync(join(ROOT, f))) continue;
    const got = {};
    for (const a of tags(markup(read(f)), "link")) {
      if (relTokens(a).includes("alternate") && a.hreflang) {
        if (a.hreflang in got) fail(f, `duplicate hreflang="${a.hreflang}"`);
        got[a.hreflang] = a.href;
      }
    }
    if (JSON.stringify(Object.entries(got).sort()) !== want) {
      fail(f, `hreflang alternates must be exactly ${want}, found ${JSON.stringify(Object.entries(got).sort())}`);
    }
  }
}

function contactFormChecks(file, html) {
  const forms = tags(html, "form").filter((a) => (a.class || "").split(/\s+/).includes("contact-form"));
  if (forms.length !== 1) { fail(file, `expected one form.contact-form, found ${forms.length}`); return; }
  if (!/^https:\/\/formspree\.io\/f\//.test(forms[0].action || "")) fail(file, "contact form must keep posting to Formspree");
  const form = (html.match(/<form\b[\s\S]*?<\/form>/i) || [""])[0];
  if (!tags(form, "input").some((a) => a.name === "_gotcha")) fail(file, "contact form lost its _gotcha honeypot");
  const status = tags(form, "p").concat(tags(form, "div")).filter((a) => "data-form-status" in a);
  if (status.length !== 1 || status[0]["aria-live"] !== "polite") {
    fail(file, "contact form needs one [data-form-status] element with aria-live=\"polite\"");
  }
}

// ── sitemap e robots ──────────────────────────────────────────────────────────────────────────

function sitemapChecks() {
  if (!existsSync(join(ROOT, "sitemap.xml"))) { fail("sitemap.xml", "missing"); return; }
  const xml = read("sitemap.xml").trim();
  if (!/^<\?xml[^>]*\?>\s*<urlset\s+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"\s*>/.test(xml) || !/<\/urlset>$/.test(xml)) {
    fail("sitemap.xml", "must be an XML declaration followed by a sitemaps.org <urlset>…</urlset>");
  }
  const opens = (xml.match(/<url>/g) || []).length;
  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  if (opens !== blocks.length) fail("sitemap.xml", "unbalanced <url> elements");
  const locs = [];
  for (const b of blocks) {
    const l = [...b.matchAll(/<loc>([^<]*)<\/loc>/g)];
    if (l.length !== 1) { fail("sitemap.xml", "every <url> needs exactly one <loc>"); continue; }
    locs.push(l[0][1].trim());
  }
  const seen = new Set();
  for (const loc of locs) {
    if (seen.has(loc)) fail("sitemap.xml", `duplicate <loc> ${loc}`);
    seen.add(loc);
  }
  const expected = new Set(Object.values(canonicals));
  for (const loc of locs) {
    if (expected.has(loc)) continue;
    const target = urlToFile(loc);
    const isNoindex = target && existsSync(join(ROOT, target))
      && metaValues(markup(read(target)), "robots").some((c) => /noindex/i.test(c));
    fail("sitemap.xml", isNoindex
      ? `lists ${loc}, which is a noindex page`
      : `lists ${loc}, which is not the canonical URL of an indexable professional page`);
  }
  for (const want of expected) if (!seen.has(want)) fail("sitemap.xml", `missing indexable page ${want}`);
}

function robotsChecks() {
  if (!existsSync(join(ROOT, "robots.txt"))) { fail("robots.txt", "missing"); return; }
  const lines = read("robots.txt").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  if (!lines.some((l) => new RegExp(`^sitemap:\\s*${ORIGIN.replace(/\./g, "\\.")}/sitemap\\.xml$`, "i").test(l))) {
    fail("robots.txt", `must declare "Sitemap: ${ORIGIN}/sitemap.xml"`);
  }
  // Tudo que precisa continuar buscavel: as paginas, seus assets, e /bolao/ — uma pagina noindex
  // bloqueada no robots.txt nunca tem o noindex lido pelo crawler.
  const mustCrawl = ["/", "/styles.css", "/site.js", "/bolao/", "/bolao/br2026/", "/bolao/cdb2026/", "/bolao/copa2026/",
    ...Object.keys({ ...INDEXABLE, ...NOINDEX }).map((f) => "/" + f)];
  for (const l of lines) {
    const m = l.match(/^disallow:\s*(.*)$/i);
    if (!m || !m[1]) continue;
    const pattern = new RegExp("^" + m[1].replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
    for (const p of mustCrawl) if (pattern.test(p)) fail("robots.txt", `"Disallow: ${m[1]}" blocks ${p}`);
  }
}

// ── consentimento: comportamento real do site.js ──────────────────────────────────────────────

function runSiteJs({ stored, storageThrows = false }) {
  const store = stored ? { analytics_consent: stored } : {};
  const appended = [];
  const listeners = {};
  const element = (tag) => ({
    tagName: tag, style: {}, offsetHeight: 60, parentNode: { removeChild() {} },
    setAttribute() {}, appendChild() {}, addEventListener() {},
  });
  const document = {
    documentElement: { lang: "en" },
    head: { appendChild: (el) => appended.push(el) },
    body: { style: {}, appendChild: (el) => appended.push(el) },
    cookie: "",
    createElement: element,
    createTextNode: (text) => ({ text }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error("SecurityError"); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error("SecurityError"); store[k] = String(v); },
  };
  const ctx = { document, localStorage, location: { hostname: "www.ferrarilabs.com" }, setTimeout, clearTimeout };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("site.js"), ctx, { filename: "site.js", timeout: 2000 });
  if (listeners.DOMContentLoaded) listeners.DOMContentLoaded();
  const gaRequested = appended.some((el) => el.tagName === "script" && /googletagmanager\.com\/gtag\/js/.test(el.src || ""));
  return { ctx, gaRequested };
}

function consentChecks() {
  if (!existsSync(join(ROOT, "site.js"))) { fail("site.js", "missing"); return; }
  const scenarios = [
    { name: "no choice yet", opts: {}, wantGa: false },
    { name: "declined", opts: { stored: "denied" }, wantGa: false },
    { name: "storage blocked", opts: { storageThrows: true }, wantGa: false },
    { name: "allowed", opts: { stored: "granted" }, wantGa: true },
  ];
  for (const s of scenarios) {
    let run;
    try { run = runSiteJs(s.opts); }
    catch (e) { fail("site.js", `[${s.name}] throws while loading: ${e.message}`); continue; }
    if (typeof run.ctx.gtag !== "function") { fail("site.js", `[${s.name}] window.gtag is not defined — inline gtag() handlers would throw`); continue; }
    try { run.ctx.gtag("event", "contact_form_submit", { event_category: "lead" }); }
    catch (e) { fail("site.js", `[${s.name}] gtag() throws: ${e.message}`); }
    if (run.gaRequested !== s.wantGa) {
      fail("site.js", s.wantGa
        ? `[${s.name}] Google Analytics was not loaded after consent`
        : `[${s.name}] Google Analytics was requested before consent`);
    }
    if (!s.wantGa && (run.ctx.dataLayer || []).length) {
      fail("site.js", `[${s.name}] dataLayer received ${run.ctx.dataLayer.length} entries before consent`);
    }
  }
  const privacy = existsSync(join(ROOT, "privacy.html")) ? read("privacy.html") : "";
  for (const needle of ['data-consent-choice="granted"', 'data-consent-choice="denied"', "data-consent-status"]) {
    if (!privacy.includes(needle)) fail("privacy.html", `must offer the analytics choice controls (${needle})`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────

for (const name of readdirSync(ROOT).filter((n) => n.endsWith(".html"))) {
  if (!(name in INDEXABLE) && !(name in NOINDEX)) {
    fail(name, "unclassified root page — add it to INDEXABLE or NOINDEX in scripts/site/check_public_pages.mjs");
  }
}

for (const [file, lang] of Object.entries(INDEXABLE)) {
  if (!existsSync(join(ROOT, file))) { fail(file, "missing"); continue; }
  const raw = read(file);
  const html = markup(raw);
  commonChecks(file, lang, raw, html);
  indexableChecks(file, raw, html);
  if (CONTACT_PAGES.includes(file)) contactFormChecks(file, html);
}
for (const [file, lang] of Object.entries(NOINDEX)) {
  if (!existsSync(join(ROOT, file))) { fail(file, "missing"); continue; }
  const raw = read(file);
  const html = markup(raw);
  commonChecks(file, lang, raw, html);
  noindexChecks(file, html);
}
hreflangChecks();
sitemapChecks();
robotsChecks();
consentChecks();

if (errors.length) {
  console.log(`✗ public site check FAILED (${errors.length})\n`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ public site check passed — ${Object.keys(INDEXABLE).length} indexable + ${Object.keys(NOINDEX).length} noindex pages, sitemap, robots.txt, analytics consent`);
