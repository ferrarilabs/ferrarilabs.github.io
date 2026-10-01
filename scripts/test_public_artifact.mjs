#!/usr/bin/env node
/**
 * test_public_artifact.mjs — proves the explicit-allowlist build + artifact gate bite.
 * (1) forbidden / unlisted artifacts are REJECTED, (2) expected production assets are ACCEPTED,
 * (3) the build is fail-closed and deterministic, (4) the deploy workflow wires build → gate → upload.
 * Secret-shaped fixtures are assembled at runtime so this file never contains a live-looking value.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicSite } from "./build-public-site.mjs";
import { checkArtifact, scanText, checkClosure } from "./check-public-artifact.mjs";
import { loadManifest, resolveAllowlist } from "./public_site_lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.error("  ✗", name, "\n     ", e.message); } }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || "expected equal"}: ${a} !== ${b}`); }
function ok(c, m) { if (!c) throw new Error(m || "assertion failed"); }

const tmp = mkdtempSync(join(tmpdir(), "pubart-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const out = join(tmp, "site");
const built = buildPublicSite({ root: ROOT, out });
const rules = (r) => r.findings.map((f) => `${f.file}:${f.rule}`);
/** Fresh copy of the good artifact with `mutate(dir)` applied; returns gate result. */
function gateWith(mutate) {
  const d = join(tmp, "m" + Math.random().toString(36).slice(2)); cpSync(out, d, { recursive: true }); mutate(d);
  return checkArtifact({ dir: d, root: ROOT });
}
const put = (d, rel, body = "x") => { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), body); };

console.log("accepts the real production artifact");
test("real artifact passes the gate", () => { const r = checkArtifact({ dir: out, root: ROOT }); ok(r.ok, JSON.stringify(r.findings.slice(0, 5))); });
test("expected runtime assets present", () => {
  for (const f of ["index.html", "CNAME", ".nojekyll", "styles.css", "sitemap.xml", "financial-crimes/index.html", "small-business/index.html",
    "bolao/index.html", "bolao/sw.js", "bolao/br2026/index.html", "bolao/br2026/data/espn-standings-normalized.json", "bolao/cdb2026/js/app.js",
    "bolao/copa2026/audit-report.html", "bolao/loterias/powerball/index.html", "bolao/loterias/config/lottery_status.json", "bolao/shared/js/football_live_store.js"])
    ok(built.files.includes(f) || f === "CNAME" || f === ".nojekyll", `missing ${f}`);
  eq(readFileSync(join(out, "CNAME"), "utf8").trim(), "www.ferrarilabs.com", "CNAME");
});
test("Powerball ticket publications (emailed links) stay public", () => ok(built.files.some((f) => /powerball\/tickets\/.+\/tickets\.pdf$/.test(f)) && built.files.some((f) => /tickets\.csv$/.test(f))));
test("a public Supabase anon JWT is accepted (role=anon)", () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b({ alg: "HS256" })}.${b({ role: "anon", iss: "supabase" })}.${"s".repeat(20)}`;
  eq(scanText(`const k="${jwt}";`, "x.js").length, 0, "anon jwt flagged");
});

console.log("rejects forbidden / unlisted content");
for (const [rel, why] of [
  ["docs/bolao/SECURITY.md", "internal docs"], ["scripts/audit.mjs", "scripts"], [".github/workflows/x.yml", ".github"], [".claude/settings.json", ".claude"],
  ["CLAUDE.md", "AI instructions"], ["CHATGPT.md", "AI instructions"], ["supabase/migrations/001.sql", "migrations"], ["supabase/functions/x/index.ts", "functions"],
  ["workers/live-producer/src/index.ts", "worker source"], ["memory/notes.md", "memory"], ["model/x.json", "model"], ["bolao/br2026/scripts/run.py", "python"],
  ["bolao/shared/sql/001.sql", "sql"], ["tools/deploy.sh", "shell"], [".env", "env"], [".env.local", "env"], ["keys/server.pem", "pem"],
  ["package.json", "package metadata"], ["bolao/loterias/powerball/scripts/email/outbox.json", "outbox"], ["bolao/loterias/powerball/email-previews/a.html", "previews"],
  ["bolao/loterias/config/lottery_ledger.jsonl", "ledger"], ["bolao/br2026/data/export.csv", "csv"], ["bolao/br2026/CHANGELOG.md", "changelog"],
  ["bolao/br2026/js/app.js.bak", "backup"], ["bolao/br2026/js/app.js.map", "sourcemap"], ["bolao/loterias/powerball/logs/run.log", "log"], [".git/config", ".git"],
  ["bolao/br2026/js/brand_new_file.js", "unlisted-but-innocent js (fail closed)"],
]) test(`rejects ${rel} (${why})`, () => { const r = gateWith((d) => put(d, rel)); ok(!r.ok && rules(r).some((x) => x.startsWith(rel + ":")), rules(r).join(",")); });

const join2 = (...p) => p.join("");
const TOKENS = {
  "github-token": join2("gh", "p_", "A".repeat(36)),
  "aws-access-key": join2("AK", "IA", "B".repeat(16)),
  "private-key-block": join2("-----BEGIN ", "PRIVATE KEY-----"),
  "local-fs-path": join2("/Us", "ers/someone/project"),
  "private-repo-link": join2("https://github", ".com/ferrarilabs/ferrarilabs.github.io/blob/main/x.py"),
};
for (const [rule, val] of Object.entries(TOKENS)) test(`content gate flags ${rule}`, () => {
  const r = gateWith((d) => { const f = join(d, "bolao/br2026/js/config.js"); writeFileSync(f, readFileSync(f, "utf8") + `\n// ${val}\n`); });
  ok(rules(r).some((x) => x.endsWith(":" + rule)), rules(r).join(","));
});
test("content gate flags a privileged (service_role) JWT", () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b({ alg: "HS256" })}.${b({ role: "service_role" })}.${"s".repeat(20)}`;
  ok(scanText(`k="${jwt}"`, "x.js").some((x) => x.rule === "privileged-jwt"));
});
test("content gate flags a real-looking personal email (runtime-assembled)", () => {
  const addr = join2("some", "one", "@", "email", ".com");
  ok(scanText(`contact ${addr}`, "x.html").some((x) => x.rule === "pii:email-address"));
});
test("reserved-domain addresses are not false positives", () => eq(scanText("a" + "@" + "x.invalid", "x.html").length, 0));
test("missing allowlisted file is detected", () => { const r = gateWith((d) => rmSync(join(d, "bolao/br2026/js/app.js"))); ok(rules(r).includes("bolao/br2026/js/app.js:missing-required")); });
test("dangling local reference is detected", () => {
  const r = gateWith((d) => { const f = join(d, "index.html"); writeFileSync(f, readFileSync(f, "utf8") + '<img src="/assets/nope.png">'); });
  ok(rules(r).includes("index.html:dangling-reference"), rules(r).join(","));
});
test("closure check ignores external/data/anchor/templated refs", () =>
  eq(checkClosure(["a.html"], () => '<a href="https://x.y/z"><a href="#a"><img src="data:image/png;base64,AA"><a href="mailto:a@b.invalid"><a href="${base}/x">').length, 0));
test("wrong CNAME is rejected", () => { const r = gateWith((d) => writeFileSync(join(d, "CNAME"), "ferrarilabs.github.io\n")); ok(rules(r).includes("CNAME:cname")); });
test("empty artifact is rejected", () => { const e = join(tmp, "empty"); mkdirSync(e); ok(!checkArtifact({ dir: e, root: ROOT }).ok); });

console.log("build is fail-closed and deterministic");
test("two builds yield an identical digest", () => eq(buildPublicSite({ root: ROOT, out: join(tmp, "b2") }).digest, built.digest));
test("unlisted repo files are never copied (fail closed)", () => {
  const root = join(tmp, "fakeroot"); const m = loadManifest(ROOT); const { files } = resolveAllowlist(ROOT, m);
  for (const f of files) { mkdirSync(dirname(join(root, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(root, f)); }
  mkdirSync(join(root, "scripts"), { recursive: true }); copyFileSync(join(ROOT, "scripts/public-site.manifest.json"), join(root, "scripts/public-site.manifest.json"));
  for (const j of ["docs/secret.md", "bolao/br2026/js/new_module.js", "CLAUDE.md", "supabase/migrations/1.sql", "bolao/loterias/powerball/tickets/draft/notes.txt"]) { mkdirSync(dirname(join(root, j)), { recursive: true }); writeFileSync(join(root, j), "x"); }
  const r = buildPublicSite({ root, out: join(tmp, "fakeout") });
  ok(!r.files.some((f) => /secret|new_module|CLAUDE|migrations|notes\.txt/.test(f)), r.files.join(","));
});
test("build refuses when an allowlisted file is missing", () => {
  const root = join(tmp, "emptyroot"); mkdirSync(join(root, "scripts"), { recursive: true }); copyFileSync(join(ROOT, "scripts/public-site.manifest.json"), join(root, "scripts/public-site.manifest.json"));
  let threw = false; try { buildPublicSite({ root, out: join(tmp, "o3") }); } catch (e) { threw = /missing/.test(e.message); } ok(threw);
});
test("build refuses unsafe output dir", () => { let t = false; try { buildPublicSite({ root: ROOT, out: ROOT }); } catch { t = true; } ok(t); });
test("manifest rejects wildcard / traversal / directory entries", () => {
  for (const bad of ["docs/*", "../x", "bolao/", "/etc/passwd"]) {
    const root = join(tmp, "mf" + bad.length); mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/public-site.manifest.json"), JSON.stringify({ version: 1, files: [bad], patterns: [] }));
    let t = false; try { loadManifest(root); } catch { t = true; } ok(t, bad);
  }
});

console.log("deploy workflow wiring");
const wf = readFileSync(join(ROOT, ".github/workflows/deploy-pages.yml"), "utf8");
test("no broad rsync copy of the repository", () => ok(!/rsync/.test(wf)));
test("order: build → gate → upload → deploy", () => {
  const i = ["build-public-site.mjs", "check-public-artifact.mjs", "upload-pages-artifact", "deploy-pages@"].map((k) => wf.indexOf(k));
  ok(i.every((x) => x > 0) && i.every((x, k) => k === 0 || x > i[k - 1]), i.join(","));
});
test("uploads only _site, permissions unchanged (least privilege)", () => {
  ok(/path:\s*_site\s*$/m.test(wf)); ok(/contents:\s*read/.test(wf) && /pages:\s*write/.test(wf) && /id-token:\s*write/.test(wf));
  ok(!/contents:\s*write/.test(wf)); ok(/workflow_dispatch:/.test(wf) && /branches:\s*\n\s*-\s*main/.test(wf));
});
test("deployment-meta.json is still produced", () => ok(/--deployment-meta/.test(wf)));

console.log(`\n${failed ? "❌" : "✓"} public artifact tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
