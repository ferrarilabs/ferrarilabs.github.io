#!/usr/bin/env node
/**
 * check_shared_visual_contract.mjs — static CSS contract-enforcement gate (phase 5 of the
 * platform visual-framework migration).
 *
 * Run:  node bolao/scripts/check_shared_visual_contract.mjs
 *
 * Why this exists: phases 2-4 moved every canonical shared component's base rule out of each
 * app's local `css/styles.css` into `bolao/shared/css/*.css`, one component at a time, by hand.
 * That process is exactly the kind of thing that silently regresses on the next unrelated PR —
 * someone adds a "quick style tweak" straight into `bolao/br2026/css/styles.css` for `.card` or
 * `.topbar` because that's the file they already have open, and the shared framework drifts
 * again without anyone noticing (this is the same failure mode `CLAUDE.md`'s July 2026 audit
 * found for `send_result_email.py` drifting from `app.js` — divergence between two places that
 * are supposed to agree, found only by an actual audit). This script is that audit, automated
 * and cheap enough to run on every change.
 *
 * What it checks: for each app's local CSS file(s), does any rule directly targeting one of the
 * canonical protected selectors also redefine one of the canonical protected properties? If so,
 * that's either a duplicate the app should rely on the shared file for, or an undocumented
 * override that needs a variant class instead of clobbering the shared component's identity.
 *
 * What it deliberately does NOT flag (see isProtectedSelectorToken()/hasVariantSuffix() below):
 *   - Descendant/compound selectors that merely reference a protected class as a scoping
 *     ancestor (e.g. `#adminArea .card`, `.rank-row .points`) — these style something INSIDE or
 *     alongside the component, not the component's own identity.
 *   - Formally suffixed variants (`.game-card--two-leg`, `.ranking-row--compact`) — the whole
 *     point of a variant class is to extend a shared primitive without touching its base rule.
 *   - Rules that only set non-protected properties (layout/behavior properties like `display`,
 *     `flex-direction`, `gap`, `overflow-x`, `width`, `justify-content`, custom properties like
 *     `--nav-cols-desktop`) — those are legitimate structural/token-driven per-app differences,
 *     not the token drift (color/type/spacing/shape) this contract exists to catch.
 *   - `:hover`/`:focus`/`:focus-visible`/`:disabled`/`:active`/`:last-child` etc. pseudo-classes
 *     directly on an otherwise-bare protected selector still count as targeting the base
 *     component's identity and ARE flagged — e.g. `.card:hover { box-shadow: ... }` would be.
 *
 * No dependencies beyond Node's built-in `fs`/`path`/`url` — this repo has no build step
 * (CLAUDE.md), so every script here must run with a bare `node file.mjs`.
 *
 * Exit code: 0 = no violations found (summary printed). 1 = one or more violations found
 * (file:line printed for each, plus a summary).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

// BATCH 8 (2026-08-08): `loterias/powerball` entrou aqui. Ele era o único dos QUATRO apps fora do
// framework compartilhado — mantinha uma cópia manual dos mesmos tokens e das mesmas regras base no
// seu próprio styles.css, e portanto ficava de fora justamente do contrato que existe para impedir
// esse tipo de duplicação. Enquanto esteve fora, "0 violations" nunca significou o que parecia. O
// caminho tem barra porque o Powerball mora um nível mais fundo que os apps de futebol.
const APPS = ["copa2026", "br2026", "cdb2026", "loterias/powerball"];

// Canonical protected selectors — the shared component identities established in
// bolao/shared/css/{navigation,shell,components,forms,admin}.css during phases 2-4. Listed as
// bare class/tag tokens (no leading dot needed in the matcher below, added at match time).
const PROTECTED_SELECTORS = [
  "topbar",
  "tabs",
  "nav",
  "card",
  "status-badge",
  "status-chip",
  "status-pill",
  "team-name",
  "game-score",
  "admin-toolbar",
  "button",
  "btn",
  "form-grid",
];

// Canonical protected properties — the token categories (type, color, shape, spacing) that
// define a shared component's visual identity. Layout/behavior properties (display, flex-*,
// grid-*, width, overflow, position, gap, justify-content, align-items, cursor, transition,
// animation, z-index, etc.) are deliberately NOT in this list: those are legitimate structural
// differences apps are allowed to layer on top of a shared component (e.g. CDB2026's
// `.topbar { width: 100%; overflow-x: hidden; }` iOS side-scroll containment from phase 4).
const PROTECTED_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "border",
  "border-radius",
  "box-shadow",
  "padding",
  "min-height",
];

/** Strip CSS comments (/* ... *\/, non-greedy, multiline) without a real CSS parser. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) || []).length));
}

/**
 * Extremely small top-level-rule splitter: walks the stylesheet tracking brace depth, and for
 * every depth-0 `{ ... }` block records the selector text (everything since the last block
 * closed or the start of the file) and its own body. Deliberately does NOT recurse into
 * `@media`/`@keyframes` blocks as nested rules — instead, when a lower-level `{` is found INSIDE
 * an `@media` block, this treats it as its own rule with the same reporting (so rules inside
 * `@media` are still checked — the shared/local responsive split from phases 2-4 puts real
 * component overrides inside `@media` blocks too, e.g. `.rank-row { ... }` at max-width:900px).
 * `@keyframes` bodies are skipped entirely (their inner `{ }` blocks are keyframe percentages,
 * not selectors, and would produce nonsense "selectors" like "50%").
 */
function extractRules(css, filePath) {
  const rules = [];
  let depth = 0;
  let buf = "";
  let ruleStart = 0;
  let atKeyframesDepth = -1; // brace depth at which an @keyframes block was opened, else -1
  let line = 1;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\n") line++;

    if (ch === "{") {
      const selectorText = buf.trim();
      if (/@keyframes\b/i.test(selectorText)) {
        atKeyframesDepth = depth;
      } else if (atKeyframesDepth === -1 && !/^@/.test(selectorText.split(/\s+/)[0] || "")) {
        // A normal rule (not an at-rule prelude like `@media (...)`) — record it, then consume
        // its body verbatim so we don't also try to parse its contents as more selectors.
        const bodyStart = i + 1;
        let bodyDepth = 1;
        let j = bodyStart;
        let bodyLine = line;
        for (; j < css.length && bodyDepth > 0; j++) {
          if (css[j] === "\n") bodyLine++;
          if (css[j] === "{") bodyDepth++;
          else if (css[j] === "}") bodyDepth--;
        }
        const body = css.slice(bodyStart, j - 1);
        rules.push({ selectorText, body, file: filePath, line: ruleStartLineFor(css, ruleStart) });
        i = j - 1;
        line = bodyLine;
        buf = "";
        ruleStart = i + 1;
        continue;
      }
      depth++;
      buf = "";
      ruleStart = i + 1;
    } else if (ch === "}") {
      depth--;
      if (depth === atKeyframesDepth) atKeyframesDepth = -1;
      buf = "";
      ruleStart = i + 1;
    } else {
      buf += ch;
    }
  }
  return rules;
}

function ruleStartLineFor(css, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < css.length; i++) if (css[i] === "\n") line++;
  return line;
}

/**
 * Does this single simple/compound selector (already split on whitespace/combinators — i.e. one
 * "token" like `.card.is-live` or `.card:hover` or `#adminArea`) directly represent a protected
 * base class, as opposed to merely including it as one compound class among others that already
 * form a distinct, non-protected identity?
 *
 * Deliberately permissive about compounding with pseudo-classes (`:hover`, `:focus-visible`,
 * `:disabled`, `:last-child`, `:nth-child(...)`, etc.) — those don't change what visual
 * component is being targeted, just which state of it. Anything compounded with another CLASS
 * (`.card.is-live`, `.button.secondary`) is treated as a distinct sub-identity and only flagged
 * if that combination has no variant suffix — see hasVariantSuffix().
 */
function tokenTargetsProtectedBase(token, protectedName) {
  // Split the compound token into its class/pseudo/id parts, e.g. ".card:hover" -> [".card", ":hover"]
  const parts = token.match(/(\.[-\w]+|:{1,2}[-\w()]+|#[-\w]+|[a-zA-Z][-\w]*)/g) || [];
  const classParts = parts.filter((p) => p.startsWith("."));
  const nonPseudoNonClass = parts.filter((p) => !p.startsWith(".") && !p.startsWith(":"));

  if (nonPseudoNonClass.length > 0) return false; // scoped under/combined with an id or tag — not the bare component

  const target = `.${protectedName}`;
  const hasTarget = classParts.includes(target);
  if (!hasTarget) return false;

  const otherClasses = classParts.filter((c) => c !== target);
  if (otherClasses.length === 0) return true; // bare `.card` (optionally with pseudo-classes)

  // Compounded with other classes — only counts as targeting the protected base if none of the
  // extra classes is a formally declared variant suffix (BEM-style `--variant`) or a documented
  // state-style modifier already established as part of the canonical component itself in
  // bolao/shared/css (e.g. `.status-chip.done/.pending/.live`, `.game-status.live/.post/.pre`).
  // A local app file compounding a protected base with ANY other class is exactly the "quick
  // style tweak" pattern this script exists to catch, so err on flagging it unless it's an
  // explicit variant suffix.
  return !otherClasses.every(hasVariantSuffix);
}

function hasVariantSuffix(classToken) {
  return /--[-\w]+$/.test(classToken);
}

/** Split a selector list on top-level commas (there's no nesting to worry about pre-brace). */
function splitSelectorList(selectorText) {
  return selectorText.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Split a single selector into whitespace/combinator-separated compound tokens. */
function splitCompoundTokens(selector) {
  return selector.split(/\s*[>~+]\s*|\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Parse a rule body into a set of declared property names (lowercased, shorthand-normalized). */
function declaredProperties(body) {
  const props = new Set();
  for (const decl of body.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (prop) props.add(prop);
  }
  return props;
}

function checkFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const css = stripComments(raw);
  const rules = extractRules(css, filePath);
  const violations = [];

  for (const rule of rules) {
    const selectors = splitSelectorList(rule.selectorText);
    const props = declaredProperties(rule.body);
    const protectedPropsHit = PROTECTED_PROPERTIES.filter((p) => props.has(p));
    if (protectedPropsHit.length === 0) continue;

    for (const selector of selectors) {
      const tokens = splitCompoundTokens(selector);
      // Only the LAST compound token of a selector is the actual targeted element — everything
      // before it (`#adminArea .card` -> `#adminArea`, `.card`) is ancestor scoping, not the
      // rule's own identity. Descendant combinators like `#adminArea .card` are exactly the
      // pattern this script must NOT flag (styling something under a card, not the card itself).
      if (tokens.length === 0) continue;
      const lastToken = tokens[tokens.length - 1];
      // If there's more than one token, this rule targets a DESCENDANT of whatever the earlier
      // tokens describe — skip unless the whole selector IS the protected class with no
      // ancestor (tokens.length === 1 handles that case below).
      if (tokens.length > 1) continue;

      for (const protectedName of PROTECTED_SELECTORS) {
        if (tokenTargetsProtectedBase(lastToken, protectedName)) {
          violations.push({
            file: filePath,
            line: rule.line,
            selector,
            protectedName,
            properties: protectedPropsHit,
          });
        }
      }
    }
  }

  return violations;
}

function main() {
  const allViolations = [];
  let filesChecked = 0;

  for (const app of APPS) {
    const cssDir = join(REPO_ROOT, "bolao", app, "css");
    let entries;
    try {
      entries = readdirSync(cssDir).filter((f) => f.endsWith(".css"));
    } catch {
      continue; // app has no css/ dir — nothing to check
    }
    for (const entry of entries) {
      const filePath = join(cssDir, entry);
      filesChecked++;
      allViolations.push(...checkFile(filePath));
    }
  }

  if (allViolations.length > 0) {
    console.error(`✗ SHARED VISUAL CONTRACT VIOLATIONS (${allViolations.length})\n`);
    for (const v of allViolations) {
      const rel = relative(REPO_ROOT, v.file);
      console.error(
        `  ${rel}:${v.line}  selector "${v.selector}" redefines protected .${v.protectedName} ` +
          `propert${v.properties.length > 1 ? "ies" : "y"}: ${v.properties.join(", ")}`
      );
    }
    console.error(
      `\nFix: move the redefined declaration(s) into bolao/shared/css/, or if this is a real ` +
        `per-app difference, express it as a formally suffixed variant class ` +
        `(e.g. .game-card--two-leg) instead of restyling the shared base selector directly.`
    );
    process.exit(1);
  }

  console.log(
    `✓ shared visual contract OK — ${filesChecked} local CSS file(s) checked across ` +
      `${APPS.length} apps, 0 violations against ${PROTECTED_SELECTORS.length} protected ` +
      `selectors × ${PROTECTED_PROPERTIES.length} protected properties.`
  );
}

main();
