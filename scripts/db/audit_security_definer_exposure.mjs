#!/usr/bin/env node
/**
 * DETECTOR DE EXPOSICAO DE FUNCOES SECURITY DEFINER — Issue #273.
 *
 * ─── DE ONDE ELE VEIO ────────────────────────────────────────────────────────────────────────
 *
 * A Issue #270 achou UMA funcao SECURITY DEFINER executavel por todo mundo. A #267 achou outras
 * SETE. As duas foram achadas a mao, e nenhum gate existente teria pego qualquer uma delas. Este
 * detector generaliza a FORMA em vez de continuar caçando caso a caso.
 *
 * ─── O QUE ELE PROCURA ───────────────────────────────────────────────────────────────────────
 *
 * Funcao SECURITY DEFINER, em schema exposto pelo PostgREST, executavel por PUBLIC / anon /
 * authenticated -- ou por `service_role` quando isso for inadequado -- sem ratificacao explicita.
 *
 * SECURITY DEFINER significa rodar com o privilegio do DONO. Marcar uma delas como executavel por
 * cliente as vezes esta certo e as vezes e acidente; a diferenca e se alguem DECIDIU. O detector
 * nao tenta adivinhar: exige `bolao/shared/safety/ratified_rpc_exposure.json` e reprova o resto.
 *
 * ─── CAPACIDADE, NAO NOME ────────────────────────────────────────────────────────────────────
 *
 * Nada aqui classifica por nome. `capabilitiesOf()` le o CORPO e diz o que a funcao toca --
 * identidade, pagamento, notificacao, DDL. A ratificacao tem de declarar essas capacidades, e se
 * o corpo ganhar uma que a entrada nao previa, isso e DERIVA e reprova. Assim, reescrever o corpo
 * de uma RPC ja aprovada para que passe a gravar pagamento nao escapa so porque o nome nao mudou.
 *
 * ─── POR QUE ESTATICO ────────────────────────────────────────────────────────────────────────
 *
 * O CI e hermetico e nao tem credencial. Entao o detector le a DDL do repositorio e calcula o
 * efeito liquido. Isso nao e um consolo: e o modelo CERTO para o cenario de restauracao, onde os
 * defaults do cluster podem nao existir.
 *
 * O modelo foi validado contra a producao em 2026-08-21: 57 funcoes SECURITY DEFINER em `public`,
 * 4 alcancaveis por cliente -- exatamente as mesmas 57 e as mesmas 4 que o catalogo do banco
 * reporta, sem sobra nem falta dos dois lados.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_security_definer_exposure.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveDdl, stripSqlComments } from "./secdef_ddl_parse.mjs";
import { capabilitiesOf, classify, clientExposed, effectiveRoles, CLASSIFICATIONS } from "./secdef_exposure_model.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Schemas que o PostgREST publica. Uma funcao fora deles nao tem rota HTTP. */
export const EXPOSED_SCHEMAS = ["public", "graphql_public"];

/**
 * PISO DE COBERTURA. Se a varredura devolver menos que isto, algo quebrou na leitura da DDL e o
 * gate REPROVA em vez de ficar verde por nao ter olhado nada.
 *
 * Isto ja salvou o detector uma vez: a primeira versao nao removia comentarios SQL, leu um bloco
 * `-- ROLLBACK: -- drop function ...` como remocao real e perdeu DEZESSETE funcoes -- incluindo
 * `submit_entry` e as seis `op_*`. A saida ficava verde justamente por enxergar menos.
 */
export const MIN_EXPECTED_SECDEF = 50;

/** Decisao de cobertura, isolada para que a suite prove que o piso realmente morde. */
export const coverageOk = (n) => n >= MIN_EXPECTED_SECDEF;

/**
 * Fontes de DDL, na ordem em que foram aplicadas.
 *
 * `bolao/shared/sql/**` vem PRIMEIRO: sao os scripts PRE-LEDGER, anteriores ao rastreamento de
 * migracoes (e a origem do achado da #266, de objetos que existem so ali). Depois vem o ledger
 * `supabase/migrations/**`, ordenado pelo timestamp do nome.
 *
 * A ordem nao e detalhe: `cdb_update_entry_picks` recebe GRANT em `025_*` e e revogada por
 * `20260813220000_*`. Invertendo os dois blocos, o detector conclui que ela continua exposta a
 * anon -- e producao mostra que nao esta.
 */
export function ddlSources({ root = ROOT } = {}) {
  const load = (rel, filt) => {
    const dir = join(root, rel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".sql") && filt(f)).sort()
      .map((f) => ({ file: `${rel}/${f}`, text: readFileSync(join(dir, f), "utf8") }));
  };
  return [
    ...load("bolao/shared/sql", () => true),
    ...load("supabase/migrations", (f) => !f.includes(".reference.")),
  ];
}

/** Fontes onde um chamador pode viver. Docs e SQL ficam de fora de proposito. */
const CALLER_DIRS = ["bolao", "supabase/functions", "scripts", ".github"];
const CALLER_EXT = /\.(js|mjs|cjs|ts|py|yml|yaml)$/i;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (CALLER_EXT.test(e.name)) out.push(p);
  }
  return out;
}

export function callerFiles({ root = ROOT } = {}) {
  const out = [];
  for (const d of CALLER_DIRS) walk(join(root, d), out);
  return out.map((p) => ({ file: p.replace(`${root}/`, ""), text: readFileSync(p, "utf8") }));
}

/**
 * Evidencia de CHAMADA, nao de mencao.
 *
 * `cdb_save_my_picks` aparece cinco vezes em comentarios de `app.js` explicando o desenho, e uma
 * vez sendo de fato invocada. Contar mencao como chamador faria um privilegio morto parecer vivo
 * para sempre -- que e exatamente o modo de falha que o requisito 5 desta Issue pede para evitar.
 */
export function callersOf(name, files) {
  const re = new RegExp(String.raw`[\w$]*rpc\s*\(\s*["']${name}["']|/rpc/${name}\b|\bselect\s+(?:public\.)?${name}\s*\(`, "i");
  return files.filter((f) => re.test(f.text)).map((f) => f.file);
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

/** Constroi o relatorio completo. Exportado para que a suite de contrato o exercite inteiro. */
export function report({ root = ROOT, now = new Date(), manifest = null } = {}) {
  const files = ddlSources({ root });
  const state = resolveDdl(files);
  const man = manifest ?? JSON.parse(readFileSync(join(root, "bolao/shared/safety/ratified_rpc_exposure.json"), "utf8"));
  const ratMap = new Map((man.ratified ?? []).map((r) => [r.key, r]));
  const callers = callerFiles({ root });

  const rows = [];
  for (const { fn, roles } of state.values()) {
    if (!EXPOSED_SCHEMAS.includes(fn.schema)) continue;
    if (!fn.secdef) continue;
    const eff = effectiveRoles({
      explicitGrants: [...roles].filter((r) => r !== "PUBLIC"),
      publicGranted: roles.has("PUBLIC"),
    });
    const caps = capabilitiesOf(fn);
    const ratified = ratMap.get(fn.key) ?? null;
    const found = clientExposed(eff) ? callersOf(fn.name, callers) : null;
    const verdict = classify({ ...fn, capabilities: caps, effectiveRoles: eff },
      { ratified, callerFound: found === null ? null : found.length > 0, now });
    rows.push({ fn, roles: eff, caps, ratified, callers: found, ...verdict,
      publicReliesOnDefault: !files.some((f) => new RegExp(String.raw`revoke[^;]*function\s+(?:"?public"?\s*\.\s*)?"?${fn.name}"?\s*\([^)]*\)[^;]*from[^;]*\bpublic\b`, "i").test(stripSqlComments(f.text))) });
  }
  return { rows, files, manifest: man };
}

function main() {
  console.log("\nExposicao de funcoes SECURITY DEFINER em schema exposto (Issue #273)\n");
  const { rows, files, manifest } = report();

  check("as fontes de DDL existem", files.length > 0, `${files.length} arquivos`);
  // FALHA FECHADO: varredura vazia ou encolhida nao pode virar verde.
  check(`a varredura cobre a superficie esperada (piso ${MIN_EXPECTED_SECDEF})`, coverageOk(rows.length),
    `${rows.length} funcoes SECURITY DEFINER em ${EXPOSED_SCHEMAS.join("/")}`);

  const expostas = rows.filter((r) => clientExposed(r.roles));
  console.log(`\n  ── inventario ──────────────────────────────────────────────────────────────`);
  console.log(`     SECURITY DEFINER em schema exposto : ${rows.length}`);
  console.log(`     alcancaveis por cliente            : ${expostas.length}`);
  console.log(`     executaveis por service_role       : ${rows.filter((r) => r.roles.includes("service_role")).length}`);
  console.log("");
  for (const r of expostas) {
    console.log(`     ${r.fn.signature.slice(0, 68)}`);
    console.log(`        schema=${r.fn.schema}  SECURITY DEFINER  roles=${r.roles.join(",")}`);
    console.log(`        search_path=${r.fn.searchPath ?? "(NAO FIXADO)"}`);
    console.log(`        capacidades=${r.caps.join(", ")}`);
    console.log(`        chamador=${r.callers?.length ? r.callers.slice(0, 2).join(", ") : "NENHUM no repositorio"}`);
    console.log(`        classificacao=${r.classification}${r.quarantined ? " (EM QUARENTENA)" : ""}`);
    for (const f of r.findings) console.log(`        ! ${f}`);
    console.log("");
  }

  // ── 1. EXPOSICAO NAO RATIFICADA / DERIVA / CHAMADOR SUMIDO ─────────────────────────────────
  const fatais = rows.filter((r) => r.fatal);
  check("nenhuma exposicao SECURITY DEFINER sem ratificacao valida", fatais.length === 0,
    fatais.length ? fatais.map((r) => `${r.fn.signature.slice(0, 60)} [${r.classification}] ${r.findings.join("; ")}`).join("\n      ")
                  : "toda exposicao a cliente tem entrada ratificada, capacidades declaradas conferem e o chamador existe");

  // ── 2. QUARENTENA: visivel, com prazo, nunca silenciosa ───────────────────────────────────
  const quar = rows.filter((r) => r.quarantined);
  check(`nenhuma quarentena vencida (${quar.length} em aberto)`, quar.every((r) => !r.fatal),
    quar.length ? quar.map((r) => `${r.fn.name} ate ${r.ratified.quarantine.reviewByIso} (Issue #${r.ratified.quarantine.reviewIssue})`).join("; ")
                : "nenhuma");

  // ── 3. CATRACA DO PUBLIC IMPLICITO ────────────────────────────────────────────────────────
  // `CREATE FUNCTION` concede EXECUTE a PUBLIC por padrao embutido. Hoje `pg_default_acl` suprime
  // isso, mas numa restauracao sem esses defaults toda funcao sem revoke explicito vaza.
  const base = new Set(manifest.publicRelianceBaseline ?? []);
  const novas = rows.filter((r) => r.publicReliesOnDefault && !base.has(r.fn.key));
  check("nenhuma funcao NOVA depende do pg_default_acl para nao vazar a PUBLIC", novas.length === 0,
    novas.length ? `sem \`revoke ... from public\` explicito:\n      ${novas.map((r) => r.fn.signature.slice(0, 66)).join("\n      ")}\n      (adicione o revoke; a linha de base pode encolher, nunca crescer)`
                 : `${rows.filter((r) => r.publicReliesOnDefault).length} na linha de base declarada, nenhuma nova`);

  // ── 4. search_path: reportado SEPARADAMENTE do EXECUTE ────────────────────────────────────
  // Sao dois defeitos diferentes. Uma funcao pode estar perfeitamente privada e ainda ser
  // escalavel por search_path mutavel; e uma com search_path fixo pode estar exposta ao mundo.
  // Misturar os dois num contador so esconde qual dos dois esta acontecendo.
  const semPath = rows.filter((r) => !r.fn.searchPath);
  check("todo SECURITY DEFINER tem search_path fixado (endurecimento, independente de EXECUTE)",
    semPath.length === 0,
    semPath.length ? `SECURITY_DEFINER_WITHOUT_PINNED_SEARCH_PATH:\n      ${semPath.map((r) => r.fn.signature.slice(0, 66)).join("\n      ")}`
                   : `${rows.length} funcoes, todas com search_path fixado`);

  // ── 5. INFRAESTRUTURA: nem service_role ───────────────────────────────────────────────────
  const infraExposta = rows.filter((r) => r.classification === CLASSIFICATIONS.UNEXPECTED_EXPOSURE
    && r.caps.some((c) => c === "ADMINISTERS_SCHEMA" || c === "EVENT_TRIGGER_ONLY"));
  check("nenhuma funcao de infraestrutura de banco e executavel por papel de aplicacao",
    infraExposta.length === 0,
    infraExposta.length ? infraExposta.map((r) => `${r.fn.name}: ${r.findings.join("; ")}`).join("\n      ")
                        : "funcoes que executam DDL ou sao gatilho de evento: so o dono");

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
