/**
 * public_site_lib.mjs — shared helpers for the explicit public Pages artifact.
 *
 * Model: repository --(explicit allowlist: scripts/public-site.manifest.json)--> _site --(gate)--> Pages.
 * Fail-closed: a file is public ONLY if the manifest names it (or a manifest pattern matches it).
 * Adding a file to the repository never publishes it. See docs/private-repo-migration/.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const MANIFEST_PATH = "scripts/public-site.manifest.json";

export function loadManifest(root) {
  const m = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  if (m.version !== 1 || !Array.isArray(m.files) || !Array.isArray(m.patterns)) throw new Error("invalid public-site manifest");
  for (const f of m.files) {
    if (f.startsWith("/") || f.includes("..") || f.includes("*") || f.endsWith("/")) throw new Error(`manifest entry must be an exact relative file path: ${f}`);
  }
  if (new Set(m.files).size !== m.files.length) throw new Error("manifest has duplicate entries");
  return m;
}

/** Files that the build treats as public, as sorted POSIX-relative paths. Missing exact files are errors. */
export function resolveAllowlist(root, manifest) {
  const out = new Set();
  const missing = [];
  for (const f of manifest.files) { (existsSync(join(root, f)) && statSync(join(root, f)).isFile()) ? out.add(f) : missing.push(f); }
  for (const p of manifest.patterns) {
    const re = new RegExp(p.regex);
    for (const f of walk(join(root, p.root), root)) if (re.test(f)) out.add(f);
  }
  return { files: [...out].sort(), missing };
}

export function matchesAllowlist(relPath, manifest) {
  if (manifest.files.includes(relPath)) return true;
  return manifest.patterns.some((p) => new RegExp(p.regex).test(relPath));
}

/** All files under `dir` (recursive, no symlink following), as POSIX paths relative to `root`. */
export function walk(dir, root) {
  const res = [];
  if (!existsSync(dir)) return res;
  const rec = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) rec(full); else if (st.isFile()) res.push(relative(root, full).split(sep).join("/"));
    }
  };
  rec(dir);
  return res.sort();
}
