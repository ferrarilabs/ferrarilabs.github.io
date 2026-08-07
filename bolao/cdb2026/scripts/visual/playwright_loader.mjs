/**
 * playwright_loader.mjs — portable Playwright resolution (Fase 2.2 §10).
 *
 * Fase 2.1's visual scripts hard-coded `/opt/node22/lib/node_modules/playwright/index.mjs` — an
 * absolute path specific to this session's sandbox filesystem. Anyone running this outside that
 * exact environment (a teammate's laptop, CI, a different agent session) would get a bare
 * "module not found" with no indication of what to do about it.
 *
 * Resolution order:
 *   1. `import("playwright")` — the normal path once this project has a package.json with
 *      playwright as a dependency and `npm install` has been run. Not true today (this repo has
 *      no package.json at all, by design — see docs/bolao/adr/ADR-001-vanilla-javascript.md,
 *      the SITE itself is framework-free; these Node scripts are dev/audit tooling only and were
 *      never given their own package.json). This is intentionally tried FIRST so the script
 *      starts working automatically the moment that's set up, with no code change needed here.
 *   2. `process.env.PLAYWRIGHT_PATH` — an explicit path to a Playwright install
 *      (`.../node_modules/playwright/index.mjs` or equivalent), for environments that have it
 *      installed somewhere non-standard.
 *   3. A last-resort default matching THIS session's known sandbox layout
 *      (`/opt/node22/lib/node_modules/playwright/index.mjs`), so the scripts keep working
 *      unmodified in the environment they were actually authored and tested in. Anyone running
 *      elsewhere without step 1 or 2 gets a clear error instead of a silent wrong-path failure.
 */
import { existsSync } from "node:fs";

const KNOWN_SANDBOX_FALLBACK = "/opt/node22/lib/node_modules/playwright/index.mjs";

/**
 * Lança o Chromium de forma PORTÁTIL.
 *
 * Por que isto existe: seis scripts faziam
 *
 *     chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium" })
 *
 * O `||` com caminho absoluto é o bug: sem a env var, o launch era FORÇADO para um caminho de
 * outro ambiente (o sandbox onde os scripts foram escritos). Numa máquina onde o Playwright tem
 * seu próprio browser gerenciado, isso falha com "executable doesn't exist" — mesmo com o
 * Playwright instalado e funcionando. Era por isso que as suítes visuais/a11y ficavam
 * "bloqueadas por falta de tooling": o tooling estava lá; o caminho estava errado.
 *
 * Regra correta (a que `audit_structural_parity.mjs` já usava, e a razão de ela ser a única que
 * passava): só passar `executablePath` quando o operador pedir explicitamente. Sem a env var,
 * deixar o Playwright resolver o browser que ele mesmo instalou.
 */
export async function launchChromium(opts = {}) {
  const chromium = await loadChromium();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...opts });
}

export async function loadChromium() {
  try {
    const mod = await import("playwright");
    return mod.chromium;
  } catch (primaryError) {
    const fallback = process.env.PLAYWRIGHT_PATH;
    if (fallback) {
      try {
        const mod = await import(fallback);
        return mod.chromium;
      } catch (fallbackError) {
        throw new Error(
          `Playwright não encontrado via "playwright" nem via PLAYWRIGHT_PATH="${fallback}". ` +
          `Instale com "npm install playwright" ou aponte PLAYWRIGHT_PATH para um index.mjs válido. ` +
          `Erro original: ${fallbackError.message}`
        );
      }
    }
    if (existsSync(KNOWN_SANDBOX_FALLBACK)) {
      console.warn(
        `[playwright_loader] "playwright" não instalado localmente e PLAYWRIGHT_PATH não definido -- ` +
        `usando o fallback conhecido deste sandbox (${KNOWN_SANDBOX_FALLBACK}). Isso NÃO funcionará ` +
        `em outro ambiente -- rode "npm install playwright" ou defina PLAYWRIGHT_PATH para portar.`
      );
      const mod = await import(KNOWN_SANDBOX_FALLBACK);
      return mod.chromium;
    }
    throw new Error(
      `Playwright não encontrado. Instale com "npm install playwright" (ou "npm install -D playwright") ` +
      `ou defina a variável de ambiente PLAYWRIGHT_PATH apontando para um index.mjs válido de uma ` +
      `instalação existente. Erro original: ${primaryError.message}`
    );
  }
}
