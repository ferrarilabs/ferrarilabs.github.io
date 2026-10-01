#!/usr/bin/env node
/**
 * build-public-site.mjs — builds the GitHub Pages artifact from an EXPLICIT allowlist.
 *
 *   node scripts/build-public-site.mjs [--root .] [--out _site] [--deployment-meta]
 *
 * Replaces the old `rsync -a ./ _site/ --exclude ...` (broad copy + exclusions), which published
 * docs/, scripts/, supabase/, workers/, SQL, Python, AI instructions and QA evidence. Here nothing is
 * copied unless scripts/public-site.manifest.json names it. A missing allowlisted file is a hard error
 * (the app would be broken in production), as is an out-of-tree destination.
 *
 * Output is deterministic: sorted copy order, byte-exact copies, no timestamps — except the optional
 * deployment-meta.json, which CI requests with --deployment-meta (git SHA / run id / time from env).
 */
import { mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { loadManifest, resolveAllowlist } from "./public_site_lib.mjs";

function arg(name, dflt) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; }

export function buildPublicSite({ root, out, deploymentMeta = false, env = process.env }) {
  root = resolve(root); out = resolve(out);
  if (out === root || root.startsWith(out + "/") || out.startsWith(join(root, "bolao"))) throw new Error(`refusing unsafe output dir: ${out}`);
  const manifest = loadManifest(root);
  const { files, missing } = resolveAllowlist(root, manifest);
  if (missing.length) throw new Error(`allowlisted file(s) missing from the repository (would break production):\n  ${missing.join("\n  ")}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const h = createHash("sha256");
  for (const f of files) {
    mkdirSync(dirname(join(out, f)), { recursive: true });
    copyFileSync(join(root, f), join(out, f));
    h.update(f + "\0" + createHash("sha256").update(readFileSync(join(root, f))).digest("hex") + "\n");
  }
  writeFileSync(join(out, ".nojekyll"), "");
  if (deploymentMeta) {
    writeFileSync(join(out, "deployment-meta.json"), JSON.stringify({
      gitSha: env.GITHUB_SHA || "", runId: env.GITHUB_RUN_ID || "", runAttempt: env.GITHUB_RUN_ATTEMPT || "",
      deployedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    }, null, 2) + "\n");
  }
  return { files, digest: h.digest("hex") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = buildPublicSite({ root: arg("--root", "."), out: arg("--out", "_site"), deploymentMeta: process.argv.includes("--deployment-meta") });
    console.log(`public artifact built: ${r.files.length} files, content digest ${r.digest}`);
  } catch (e) { console.error(`BUILD FAILED: ${e.message}`); process.exit(1); }
}
