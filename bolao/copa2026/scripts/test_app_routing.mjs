#!/usr/bin/env node
/**
 * COPA-APP-ROUTING — gate.
 *
 * Static, deterministic, no network. What it defends is a property the browser cannot be trusted
 * to keep on its own: copa2026's page is served to anonymous visitors with a public key, so any
 * write path it retains is a write path EVERYONE has.
 *
 *   R1  zero whole-document writers in copa2026 browser code
 *   R2  reads go through the SANITIZED projection
 *   R3  the __sanitized interlock is armed on load
 *   R4  the empty-read write-back is GONE, not repointed
 *   R5  saveState never reaches the network
 *   R6  saveRemoteState fails closed rather than silently vanishing
 *   R7  every privileged mutation site routes to the operator runtime
 *   R8  no faked authentication anywhere
 *   R9  no service_role / secret material in browser code
 *   R10 cross-product isolation — copa code never names another pool
 *   R11 the sanitized view is NOT weakened to feed the admin panel
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = join(HERE, "..", "js");
const app = readFileSync(join(JS, "app.js"), "utf8");
const cfg = readFileSync(join(JS, "config.js"), "utf8");
/**
 * Comments are stripped before any scan. A leakage or hazard check that fires on the WORD in an
 * explanatory comment is a check that gets disabled by the first person it inconveniences — and
 * these files deliberately explain, in prose, exactly what was removed and why. The scanners must
 * read the code, not the documentation of the code.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");

const allJs = readdirSync(JS).filter((f) => f.endsWith(".js"))
  .map((f) => ({ f, src: stripComments(readFileSync(join(JS, f), "utf8")) }));
const appCode = stripComments(app);

const out = [];
const t = (id, name, ok, detail = "") => { out.push({ id, ok: !!ok }); console.log(`  ${ok ? "✓" : "✗"} ${id} ${name}${detail ? `  — ${detail}` : ""}`); };

console.log("COPA2026 app routing — gate\n");

// R1 — the whole point.
const writers = allJs.flatMap(({ f, src }) =>
  src.split("\n").map((l, i) => ({ f, n: i + 1, l }))
     .filter(({ l }) => /\.upsert\(|\.from\([^)]*\)\s*\.\s*(insert|update|delete)\(|method:\s*["']DELETE["']|method:\s*["']PATCH["']/.test(l)));
t("R1", "zero whole-document writers in browser code", writers.length === 0,
  writers.map((w) => `${w.f}:${w.n}`).join(", ") || "none");

// R2 — reads through the sanitized projection.
const readTable = (cfg.match(/readTable:\s*"([^"]+)"/) || [])[1];
// Projeções saneadas conhecidas. `bolao_state_normalized_public` entrou no READ CUTOVER de
// 2026-08-13 (migração 20260813200000_public_projection_pii_closure.sql: "since the read cutover
// all three browsers read bolao_state_normalized_public"). Este gate continuou exigindo o nome
// ANTERIOR e ficou vermelho desde então — medindo o nome da projeção em vez da propriedade dela.
//
// O que precisa ser verdade não é "chama-se X": é que o navegador leia por uma projeção SANEADA e
// que ela seja DIFERENTE da tabela de escrita (é essa diferença que arma o interlock do R3). Um
// nome fixo transforma toda migração legítima de leitura em vermelho, e um gate que fica vermelho
// por motivo legítimo é um gate que se aprende a ignorar.
const PROJECOES_SANEADAS = ["bolao_state_public", "bolao_state_normalized_public"];
t("R2", "readTable points at a sanitized projection (never the raw table)",
  PROJECOES_SANEADAS.includes(readTable), String(readTable));
t("R2b", "the read uses readTable, not the raw table", /\.from\(readTable\)/.test(app));

// R3 — the interlock.
t("R3", "__sanitized is set when the read surface differs from the write table",
  /const sanitizado = readTable !== cfg\.table/.test(app) && /if \(sanitizado\) merged\.__sanitized = true/.test(app));

// R4 — the hazard is deleted, not renamed.
t("R4", "the empty-read write-back is gone", !/await saveRemoteState\(state\(\)\)/.test(appCode));

// R5 — saveState is local-only.
const saveStateBody = (app.match(/function saveState\(s, opts = \{\}\) \{[\s\S]*?\n\}/) || [""])[0];
t("R5", "saveState never calls saveRemoteState", !!saveStateBody && !/saveRemoteState/.test(saveStateBody), `${saveStateBody.split("\n").length} lines`);

// R6 — fail closed, loudly.
const stub = (app.match(/async function saveRemoteState\([^)]*\) \{[\s\S]*?\n\}/) || [""])[0];
t("R6", "saveRemoteState throws instead of silently disappearing", /throw new Error/.test(stub));

// R7 — every privileged mutation names the operator runtime.
const PRIVILEGED = ["commitRealResult", "deleteEntry", "clearAllData", "loadDemoData", "runEspnUpdate"];
const unguarded = PRIVILEGED.filter((fn) => {
  const m = app.match(new RegExp(`function ${fn}\\([^)]*\\) \\{[\\s\\S]{0,400}`));
  return !m || !/operatorOnly\(/.test(m[0]);
});
const paidGuarded = /if \(paidBtn\) \{[\s\S]{0,200}?operatorOnly\(/.test(app);
t("R7", `privileged mutations routed to the operator runtime ${PRIVILEGED.length - unguarded.length + (paidGuarded ? 1 : 0)}/${PRIVILEGED.length + 1}`,
  unguarded.length === 0 && paidGuarded, unguarded.join(", ") || (paidGuarded ? "" : "paid toggle"));

// R8 — no faked authentication. A client-supplied admin claim is not an identity.
const fakes = [/isAdmin\s*:\s*true/, /p_is_admin/, /adminToken/, /"admin"\s*:\s*true/, /x-admin/i]
  .filter((re) => re.test(app));
t("R8", "no client-supplied admin claim is ever sent", fakes.length === 0, fakes.map(String).join(", "));

// R9 — no privileged credential in anything the browser downloads.
const secrets = allJs.filter(({ src }) => /service_role|sb_secret_|SUPABASE_SERVICE_ROLE_KEY/.test(src));
t("R9", "no service_role or secret material in browser code", secrets.length === 0, secrets.map((x) => x.f).join(", "));

// R10 — copa code must not be able to name another product's row.
const stateId = (cfg.match(/stateId:\s*"([^"]+)"/) || [])[1];
const foreign = allJs.filter(({ src }) => /["'](br2026|cdb2026)["']/.test(src));
t("R10", "cross-product isolation — stateId is main and no other pool is named",
  stateId === "main" && foreign.length === 0, `stateId=${stateId} foreign=${foreign.map((x) => x.f).join(",") || "none"}`);

// R11 — the fix must not have been "put the PII back".
const viewSql = readFileSync(join(HERE, "..", "..", "shared", "sql", "015_f10_private_pii_and_public_projection.sql"), "utf8");
const strips = ["participantEmail", "payerName", "paymentMethod", "paymentTo"].filter((f) => viewSql.includes(`- '${f}'`));
t("R11", `bolao_state_public still strips all four PII fields ${strips.length}/4`, strips.length === 4, strips.join(", "));

const bad = out.filter((x) => !x.ok);
console.log(`\n${out.length - bad.length} passaram, ${bad.length} falharam`);
process.exit(bad.length ? 1 : 0);
