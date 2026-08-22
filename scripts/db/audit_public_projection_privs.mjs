#!/usr/bin/env node
/**
 * CONTRATO DE PRIVILEGIO DAS PROJECOES PUBLICAS — Issues #282 / #284.
 *
 * ─── O DEFEITO QUE ORIGINOU ESTE GATE ────────────────────────────────────────────────────────
 *
 * `bolao_state_normalized_public` tinha, em producao, `anon` e `authenticated` com os SETE
 * privilegios de relacao. A DDL que a cria escreve
 *
 *     revoke all on table ... from public;
 *     grant select on table ... to anon, authenticated;
 *
 * e isso PARECE limpo. Nao e: `PUBLIC` e um PSEUDO-PAPEL, e revoga-lo nao remove a entrada
 * PROPRIA que `anon` e `authenticated` ganharam no nascimento (Issue #271). Mesma raiz de #282 e
 * #284, aqui numa relacao em vez de numa funcao.
 *
 * ─── E O MODELO NAO VIA ──────────────────────────────────────────────────────────────────────
 *
 * Pior que o defeito: `parseCreateTables` so casava `create table`, entao NENHUMA view era
 * semeada com a ACL de nascimento e o modelo respondia "limpa" para uma view que producao media
 * exposta. O gate que deveria pegar a #282 era estruturalmente cego a ela. O parser foi estendido
 * junto com este gate -- sem isso, tudo aqui passaria vacuamente.
 *
 * ─── O QUE ESTE GATE VERIFICA ────────────────────────────────────────────────────────────────
 *
 * Para cada projecao declarada em `public_projection_privileges.json`:
 *   - papel de cliente NAO tem INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER;
 *   - `PUBLIC` nao tem nenhum deles (alcanca papel que ninguem nomeou);
 *   - o SELECT declarado como intencional CONTINUA presente -- um gate que so subtrai acabaria
 *     aprovando a remocao do proprio endpoint publico.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_public_projection_privs.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tablePrivState } from "./client_table_privs_model.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT = "bolao/shared/safety/public_projection_privileges.json";

export function ddlSources({ root = ROOT } = {}) {
  const load = (rel, filt) => {
    const dir = join(root, rel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".sql") && filt(f)).sort()
      .map((f) => ({ file: `${rel}/${f}`, text: readFileSync(join(dir, f), "utf8") }));
  };
  return [...load("bolao/shared/sql", () => true), ...load("supabase/migrations", (f) => !f.includes(".reference."))];
}

export function report({ root = ROOT, files, contract } = {}) {
  const src = files ?? ddlSources({ root });
  const c = contract ?? JSON.parse(readFileSync(join(root, CONTRACT), "utf8"));
  const estado = tablePrivState(src);

  const proibidos = c.forbiddenForClients;
  // Divida declarada com Issue: producao esta limpa, o replay nao. Ver `knownReplayGap`.
  const comGap = new Set((c.knownReplayGap ?? []).map((g) => g.name));
  const papeis = c.clientRoles;
  const achados = [];
  const semSelect = [];

  for (const proj of c.projections) {
    const byRole = estado.get(proj.name) ?? new Map();
    const pub = byRole.get("PUBLIC") ?? new Set();

    for (const priv of proibidos) {
      if (comGap.has(proj.name)) break; // divida declarada; conferida abaixo como catraca
      if (pub.has(priv)) {
        achados.push({ rel: proj.name, role: "PUBLIC", priv,
          detail: `PUBLIC tem ${priv} em ${proj.name} — alcanca todo papel, inclusive os que a projecao nao pretende servir` });
      }
      for (const role of papeis) {
        if ((byRole.get(role) ?? new Set()).has(priv)) {
          achados.push({ rel: proj.name, role, priv,
            detail: `${role} tem ${priv} em ${proj.name} — projecao publica serve SELECT, nao escrita nem administracao` });
        }
      }
    }

    // O outro lado: o SELECT intencional tem de sobreviver.
    for (const role of papeis) {
      if ((proj.clientsMay ?? []).includes("SELECT") && !(byRole.get(role) ?? new Set()).has("SELECT")) {
        semSelect.push(`${proj.name}/${role}`);
      }
    }
  }
  // Catraca: uma projecao declarada como gap de replay que JA esta limpa tem de sair do arquivo,
  // senao a declaracao vira isencao permanente que ninguem rele.
  const gapQuitado = (c.knownReplayGap ?? []).filter((g) => {
    const byRole = estado.get(g.name) ?? new Map();
    return !proibidos.some((p) => papeis.some((r) => (byRole.get(r) ?? new Set()).has(p))
      || (byRole.get("PUBLIC") ?? new Set()).has(p));
  }).map((g) => g.name);

  return { achados, semSelect, gapQuitado, contract: c, estado };
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nContrato de privilegio das projecoes publicas (Issues #282/#284)\n");
  const r = report();
  const n = r.contract.projections.length;

  check("as projecoes declaradas foram encontradas na DDL", n > 0 && r.estado.size > 0,
    `${n} projecoes declaradas, ${r.estado.size} relacoes modeladas`);

  const escrita = r.achados.filter((a) => a.role !== "PUBLIC");
  check(`nenhum papel de cliente escreve ou administra uma projecao publica (${n})`, escrita.length === 0,
    escrita.length ? escrita.map((a) => a.detail).join("\n      ") : "so SELECT, nas tres");

  const viaPublic = r.achados.filter((a) => a.role === "PUBLIC");
  check("PUBLIC nao tem privilegio de escrita/administracao em projecao publica", viaPublic.length === 0,
    viaPublic.length ? viaPublic.map((a) => a.detail).join("\n      ") : "PUBLIC limpo nas tres");

  check("nenhuma divida de replay ja quitada continua declarada", r.gapQuitado.length === 0,
    r.gapQuitado.length ? `limpo no replay, tem de sair do contrato (Issue #292): ${r.gapQuitado.join(", ")}`
      : `${(r.contract.knownReplayGap ?? []).length} gap(s) declarado(s), todos ainda reais`);

  check("o SELECT intencional continua existindo", r.semSelect.length === 0,
    r.semSelect.length ? `a projecao publica perderia o leitor: ${r.semSelect.join(", ")}` : "o site continua conseguindo ler");

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
