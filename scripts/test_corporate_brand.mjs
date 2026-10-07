// On-demand typography guard for the corporate site (not part of the bolao test chain).
// Run: node scripts/test_corporate_brand.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const ARIAL = /^(Arial, Helvetica, sans-serif|var\(--(sans|serif)\)|inherit)$/;
const JA = /^Arial, "Hiragino Sans"/; // documented CJK exception for html:lang(ja)

for (const m of css.matchAll(/font-family:\s*([^;]+);/g)) {
  const v = m[1].trim();
  assert.ok(ARIAL.test(v) || JA.test(v), `non-Arial font-family: ${v}`);
}
for (const m of css.matchAll(/--(sans|serif):\s*([^;]+);/g)) {
  const v = m[2].trim();
  assert.ok(/^Arial, /.test(v) || v === "var(--sans)", `--${m[1]} must start with Arial: ${v}`);
}
assert.ok(!/@font-face|fonts\.googleapis/.test(css), "no webfonts");
console.log("corporate brand typography: OK");
