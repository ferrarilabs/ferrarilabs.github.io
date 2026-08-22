#!/usr/bin/env node
/**
 * DECISAO EXPLICITA DE PRIVILEGIO DE CLIENTE POR TABELA — Issue #271.
 *
 * ─── A ARQUITETURA ACEITA ────────────────────────────────────────────────────────────────────
 *
 * 2026-08-22, decisao do dono: se um default de papel criador gerido pela Supabase nao pode ser
 * alterado por canal suportado de projeto (`supabase_admin` devolve `42501`, e `postgres` nao e
 * superusuario nem membro dele), entao controles compensatorios DETERMINISTAS no nivel da
 * aplicacao sao aceitaveis -- desde que provem que todo objeto criado pela Ferrarilabs e
 * endurecido EXPLICITAMENTE na sua propria migracao.
 *
 * ─── A LACUNA QUE ESTE GATE FECHA ────────────────────────────────────────────────────────────
 *
 * A cobertura por classe de objeto em `public` estava assim:
 *
 *     funcao     61  ✓ audit_function_creation_discipline
 *     view        3  ✓ audit_public_projection_privs
 *     sequencia   0  — VAZIO, medido: toda PK e uuid, nao existe sequencia em `public`
 *     tabela     12  ✗ so as SEIS do Powerball tinham gate de CRUD (#131)
 *
 * Ou seja: `bolao_entry_private`, `bolao_state`, as duas filas de notificacao e o cache podiam
 * ganhar ou manter CRUD de cliente sem que nada exigisse uma decisao escrita.
 *
 * ─── DIVIDA E DECLARADA, NAO PERDOADA ────────────────────────────────────────────────────────
 *
 * Cinco tabelas carregam CRUD de cliente HOJE em producao, medido. `debt: true` nao e permissao --
 * e exposicao registrada com motivo, para deixar de ser invisivel. A RLS esta ligada nas doze e e
 * o que hoje esta na frente do dado; o gate impede que a lista CRESCA e obriga a tabela que ficar
 * limpa a sair dela.
 *
 * `cdb_entry_access` e a prova de que o padrao e alcancavel: `20260812070000` faz
 * `revoke all ... from public, anon, authenticated` na propria criacao, e ela esta limpa.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_table_client_decisions.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { orderedDdlSources } from "./ddl_execution_order.mjs";
import { tablePrivState } from "./client_table_privs_model.mjs";
import { stripSqlComments } from "./secdef_ddl_parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL = "bolao/shared/safety/table_client_decisions.json";
export const CRUD = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]);

export function report({ root = ROOT, files, model } = {}) {
  const m = model ?? JSON.parse(readFileSync(join(root, MODEL), "utf8"));
  const src = files ?? orderedDdlSources({ root });
  const state = tablePrivState(src, { stripComments: stripSqlComments });
  const papeis = m.clientRoles;

  const achados = [];
  const quitadas = [];
  const semDecisao = [];

  for (const [tbl, dec] of Object.entries(m.tables)) {
    const byRole = state.get(tbl) ?? new Map();
    const pub = byRole.get("PUBLIC") ?? new Set();
    let algum = false;

    for (const role of papeis) {
      const tem = byRole.get(role) ?? new Set();
      const permitido = dec[role] ?? [];
      for (const priv of CRUD) {
        if (pub.has(priv)) {
          achados.push({ tbl, role: "PUBLIC", priv,
            detail: `PUBLIC tem ${priv} em ${tbl} — alcanca papel que nenhuma decisao nomeou` });
        }
        if (!tem.has(priv)) continue;
        algum = true;
        if (!permitido.includes(priv)) {
          achados.push({ tbl, role, priv,
            detail: `${role} tem ${priv} em ${tbl}, alem da decisao declarada (${permitido.join(",") || "nenhum"})` });
        }
      }
    }
    if (dec.debt && !algum) quitadas.push(tbl);
    if (!dec.why || dec.why.length < 40) semDecisao.push(tbl);
  }

  // Toda TABELA de aplicacao criada pela DDL precisa de decisao — nada nasce sem dono.
  //
  // O conjunto vem de `create table` na DDL, e nao das chaves de `state`. Duas razoes, as duas
  // aprendidas por falso positivo: `state` tambem carrega VIEW (que tem gate proprio,
  // `audit_public_projection_privs`), e carrega os pseudo-nomes `TABLES`/`SEQUENCES`/`FUNCTIONS`
  // que aparecem em `ALTER DEFAULT PRIVILEGES ... ON TABLES` -- mesma armadilha que a #292 teve de
  // resolver no detector de revoke orfao.
  const criadas = new Set();
  for (const f of src) {
    const texto = stripSqlComments(f.text).replace(/alter\s+default\s+privileges[^;]*;/gi, " ");
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?[a-z0-9_]+"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(/gi;
    let mm;
    while ((mm = re.exec(texto)) !== null) criadas.add(mm[1]);
  }
  const modeladas = new Set(Object.keys(m.tables));
  const naoDeclaradas = [...criadas].filter((t) => !modeladas.has(t)
    && papeis.some((r) => CRUD.some((p) => (state.get(t)?.get(r) ?? new Set()).has(p))));

  return { achados, quitadas, semDecisao, naoDeclaradas, model: m, state };
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nDecisao explicita de privilegio de cliente por tabela (Issue #271)\n");
  const r = report();
  const n = Object.keys(r.model.tables).length;
  const divida = Object.values(r.model.tables).filter((t) => t.debt).length;

  check(`toda tabela de aplicacao tem decisao escrita (${n})`, r.semDecisao.length === 0,
    r.semDecisao.length ? `sem motivo escrito: ${r.semDecisao.join(", ")}` : `${n} tabelas, ${divida} com divida declarada`);

  check("nenhuma tabela com CRUD de cliente ficou sem decisao", r.naoDeclaradas.length === 0,
    r.naoDeclaradas.length ? `alcancavel por cliente e nao declarada: ${r.naoDeclaradas.join(", ")}`
      : "nenhuma tabela nova entrou por baixo do radar");

  const alem = r.achados.filter((a) => a.role !== "PUBLIC");
  check("nenhum papel de cliente tem privilegio alem do decidido", alem.length === 0,
    alem.length ? alem.map((a) => a.detail).join("\n      ") : "o efetivo bate com o declarado, tabela por tabela");

  const viaPublic = r.achados.filter((a) => a.role === "PUBLIC");
  check("PUBLIC nao tem CRUD em tabela de aplicacao", viaPublic.length === 0,
    viaPublic.length ? viaPublic.map((a) => a.detail).join("\n      ") : "PUBLIC limpo nas doze");

  check("nenhuma divida ja quitada continua declarada", r.quitadas.length === 0,
    r.quitadas.length ? `ficou limpa, tem de sair da divida: ${r.quitadas.join(", ")}` : "a catraca esta apertada");

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
