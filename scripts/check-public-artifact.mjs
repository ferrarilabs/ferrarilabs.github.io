#!/usr/bin/env node
/**
 * check-public-artifact.mjs — security gate over the REAL generated Pages artifact.
 *
 *   node scripts/check-public-artifact.mjs [--dir _site] [--root .]      (npm run check:public-artifact)
 *
 * A green test suite does not prove the publication boundary is safe; this inspects the bytes that
 * are about to be uploaded. Runs BEFORE upload-pages-artifact in deploy-pages.yml; any finding
 * fails the job, so nothing is deployed. Checks:
 *   A. containment    every file is in the manifest allowlist (artifact ⊆ allowlist) — fail closed
 *   B. completeness   every allowlisted file is present; CNAME is www.ferrarilabs.com
 *   C. forbidden      path denylist (defence in depth, independent of the manifest)
 *   D. content        secrets / token shapes / local paths / PII (context-aware, reuses scripts/pii_detectors.mjs)
 *   E. private links  no public page may link to private repository source (github.com/ferrarilabs/...)
 *   F. closure        every local src/href/url() reference in html/css resolves inside the artifact
 * Findings never print secret values — only path, rule and a masked sample.
 */
import { readFileSync } from "node:fs";
import { extname, join, resolve, dirname, posix } from "node:path";
import { loadManifest, matchesAllowlist, walk } from "./public_site_lib.mjs";
import { scanContent, mask } from "./pii_detectors.mjs";

const GENERATED = new Set([".nojekyll", "deployment-meta.json"]);

const FORBIDDEN_PATH = [
  [/(^|\/)\.git(\/|$)/, ".git"], [/(^|\/)\.github(\/|$)/, ".github"], [/(^|\/)\.claude(\/|$)/, ".claude"],
  [/(^|\/)(CLAUDE|CHATGPT|AGENTS|GEMINI)\.md$/i, "AI instruction file"],
  [/^docs\//, "internal docs/"], [/^scripts\//, "internal scripts/"], [/^supabase\//, "supabase/ (functions, migrations)"],
  [/^workers\//, "workers/ source"], [/^memory\//, "memory/"], [/^model\//, "model/"], [/(^|\/)node_modules(\/|$)/, "node_modules"],
  [/(^|\/)(package(-lock)?|tsconfig|wrangler)\.(json|jsonc)$/, "package/build metadata"],
  [/(^|\/)\.env(\.|$)/, ".env file"], [/\.(pem|key|p12|pfx|crt|cer|jks|keystore)$/i, "key/certificate file"],
  [/\.(py|pyc|sql|sh|bash|zsh|mjs|cjs|ts|tsx|toml|ya?ml|ipynb)$/i, "source/tooling file type"],
  [/\.(log|bak|backup|orig|rej|swp|tmp|map)$/i, "temp/backup/log/sourcemap"], [/~$/, "editor backup"],
  [/(^|\/)(\.DS_Store|\.htaccess|Thumbs\.db)$/, "OS/server metadata"], [/(^|\/)__pycache__(\/|$)/, "__pycache__"],
  [/(^|\/)(email-previews|fixtures?|backups?|logs|evidence|qa|tests?|__tests__|migrations)(\/|$)/i, "preview/fixture/backup/log/test dir"],
  [/\.(md|markdown|txt|rst)$/i, "documentation/text file"], [/\.jsonl$/i, "jsonl operational data"],
  [/(^|\/)(outbox|private-participant-data[^/]*|.*\.local)\.json$/i, "operational/private json"],
  [/\.csv$/i, "csv (only Powerball ticket publications are allowed)", (p) => /^bolao\/loterias\/powerball\/tickets\/[^/]+\/tickets\.csv$/.test(p)],
  [/\.pdf$/i, "pdf (only Powerball ticket publications are allowed)", (p) => /^bolao\/loterias\/powerball\/tickets\/[^/]+\/tickets\.pdf$/.test(p)],
];

const SECRET_RULES = [
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g], ["stripe-live-key", /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g], ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["private-key-block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["env-secret-assignment", /\b(?:SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE\w*|GH_DISPATCH_TOKEN|GITHUB_TOKEN|RESEND_API_KEY|PRIVATE_KEY)\s*[:=]\s*["']?[A-Za-z0-9_\-.]{20,}/g],
  ["local-fs-path", /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Z]:\\Users\\[A-Za-z0-9._-]+\\)/g],
];

const TEXT_EXT = new Set([".html", ".htm", ".js", ".css", ".json", ".svg", ".xml", ".txt", ".csv", ".webmanifest"]);

function b64urlJson(s) { try { return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return null; } }

/** Inspect one text file. Returns [{rule, sample}] — samples are masked. */
export function scanText(content, path) {
  const out = [];
  for (const [rule, re] of SECRET_RULES) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(content))) out.push({ rule, sample: mask(m[0]) });
  }
  // A Supabase anon key is a public JWT by design (role=anon); a service_role/other privileged JWT is a leak.
  for (const m of content.matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    const p = b64urlJson(m[1]);
    if (p && p.role && p.role !== "anon") out.push({ rule: "privileged-jwt", sample: mask(m[0]) });
  }
  const r = scanContent(content, { path });
  for (const f of r.findings) out.push({ rule: `pii:${f.detector}`, sample: f.sample });
  if (/github\.com\/ferrarilabs\/|raw\.githubusercontent\.com\/ferrarilabs|api\.github\.com\/repos\/ferrarilabs/.test(content)) {
    out.push({ rule: "private-repo-link", sample: "link into the (soon private) source repository" });
  }
  return out;
}

const REF_RE = /(?:\b(?:src|href|poster)\s*=\s*|url\(\s*|@import\s+)["']?([^"')\s>]+)/gi;

/** F. Local references from html/css must resolve inside the artifact. */
export function checkClosure(files, readText) {
  const set = new Set(files);
  const bad = [];
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (ext !== ".html" && ext !== ".css") continue;
    const text = readText(f); if (text == null) continue;
    for (const m of text.matchAll(REF_RE)) {
      let ref = m[1].trim();
      if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:|javascript:|mailto:|tel:)/i.test(ref) || /[{}$]|\\|%7B/i.test(ref) || ref.includes("<")) continue;
      ref = ref.split("#")[0].split("?")[0];
      if (!ref) continue;
      let target = ref.startsWith("/") ? ref.slice(1) : posix.normalize(posix.join(posix.dirname(f), ref));
      if (target.endsWith("/") || target === "." || target === "") target = posix.join(target, "index.html");
      if (set.has(target) || set.has(posix.join(target, "index.html"))) continue;
      bad.push({ file: f, ref });
    }
  }
  return bad;
}

export function checkArtifact({ dir, root }) {
  dir = resolve(dir); root = resolve(root);
  const manifest = loadManifest(root);
  const files = walk(dir, dir);
  const findings = [];
  const add = (file, rule, detail) => findings.push({ file, rule, detail });

  if (!files.length) add("(artifact)", "empty-artifact", "no files found — wrong --dir?");
  for (const f of files) {
    if (!GENERATED.has(f) && !matchesAllowlist(f, manifest)) add(f, "not-allowlisted", "present in artifact but not in scripts/public-site.manifest.json");
    for (const [re, label, except] of FORBIDDEN_PATH) if (re.test(f) && !(except && except(f))) add(f, "forbidden-path", label);
  }
  const have = new Set(files);
  for (const f of manifest.files) if (!have.has(f)) add(f, "missing-required", "allowlisted file absent from artifact");
  if (have.has("CNAME") && readFileSync(join(dir, "CNAME"), "utf8").trim() !== "www.ferrarilabs.com") add("CNAME", "cname", "must be exactly www.ferrarilabs.com");
  if (!have.has(".nojekyll")) add(".nojekyll", "missing-required", "Pages must not run Jekyll over the artifact");

  const cache = new Map();
  const readText = (f) => { if (!cache.has(f)) cache.set(f, TEXT_EXT.has(extname(f).toLowerCase()) ? readFileSync(join(dir, f), "utf8") : null); return cache.get(f); };
  for (const f of files) {
    const t = readText(f); if (t == null) continue;
    for (const x of scanText(t, f)) add(f, x.rule, x.sample);
  }
  for (const b of checkClosure(files, readText)) add(b.file, "dangling-reference", b.ref);
  return { ok: findings.length === 0, findings, fileCount: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const r = checkArtifact({ dir: a("--dir", "_site"), root: a("--root", ".") });
  if (r.ok) { console.log(`✓ public artifact gate passed — ${r.fileCount} files, 0 findings`); process.exit(0); }
  console.error(`❌ PUBLIC ARTIFACT GATE FAILED — ${r.findings.length} finding(s) in ${r.fileCount} files (values never printed)`);
  for (const f of r.findings.slice(0, 200)) console.error(`  - ${f.file} | ${f.rule} | ${f.detail}`);
  process.exit(1);
}
