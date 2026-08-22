#!/usr/bin/env node
/**
 * CRUD DE PAPEL DE CLIENTE NAS TABELAS-BASE PROTEGIDAS DO POWERBALL — Issue #131.
 *
 * ─── O QUE ESTA ABERTO ───────────────────────────────────────────────────────────────────────
 *
 * `anon` e `authenticated` tem SELECT, INSERT, UPDATE e DELETE nas seis tabelas `lottery_*` --
 * que guardam nome, e-mail e telefone de participante e transacao de pagamento real. Nenhum
 * desses privilegios foi escrito por alguem: as tabelas NASCERAM com eles, pelo `pg_default_acl`
 * de `public` (Issue #271).
 *
 * ─── POR QUE UM GATE, SE A RLS SEGURA ────────────────────────────────────────────────────────
 *
 * Aqui a RLS segura MESMO -- diferente da #276, ela aplica policies aos quatro verbos de linha, e
 * o teste efetivo com `SET LOCAL ROLE` devolveu zero linhas para os dois papeis. O problema e que
 * ela e a UNICA coisa segurando: um `CREATE POLICY` para uma feature nova, ou um
 * `DISABLE ROW LEVEL SECURITY` acidental, e o grant que ja esta la vira acesso total, sem que
 * nenhuma linha de codigo tenha mudado.
 *
 * Defesa-em-profundidade sem gate e a que volta sozinha. A #276 documenta o caso: houve uma
 * remediacao em 2026-08-07, e duas semanas depois `anon` tinha TRUNCATE de novo -- em tabelas
 * criadas DEPOIS dela. A remediacao nao alcanca o que ainda nao existe; o gate alcanca.
 *
 * ─── PRIVILEGIO EFETIVO, NAO TEXTO DE GRANT ──────────────────────────────────────────────────
 *
 * `tablePrivState` semeia toda tabela criada antes de `20260821030000` com o default medido em
 * producao, e `structuralExposure` ja ensinou a contar heranca de PUBLIC. E isso que faz o modelo
 * reproduzir a leitura de producao da #131 EXATAMENTE -- anon e authenticated com os quatro
 * verbos nas seis, PUBLIC com nenhum. Um gate que lesse so os statements `GRANT` veria zero.
 *
 * ─── O QUE ESTE GATE NAO FAZ ─────────────────────────────────────────────────────────────────
 *
 * ─── LIMITE, ENQUANTO A DIVIDA ESTIVER MAXIMA ────────────────────────────────────────────────
 *
 * Hoje `pendingRemediation` declara os QUATRO verbos para os DOIS papeis nas SEIS tabelas -- ou
 * seja, a divida esta cheia. Enquanto estiver assim, um `GRANT SELECT ... TO anon` numa destas
 * tabelas NAO reprova, e a razao e que ele nao muda nada: o papel ja tem o privilegio. Nao ha o
 * que alargar.
 *
 * Onde o gate morde HOJE: heranca de PUBLIC (que a divida nunca cobre, porque alcanca papel que
 * ninguem nomeou); tabela protegida NOVA; e -- o mais importante -- o momento em que a revogacao
 * finalmente acontecer, porque a divida quitada TEM de sair do arquivo, e a partir dai qualquer
 * re-concessao reprova. E isso que transforma a remediacao da #131 em algo que nao volta sozinho,
 * que e o defeito documentado na #276 (remediado em 2026-08-07, de volta em 2026-08-21).
 *
 * O limite e declarado aqui em vez de disfarcado: um gate que anunciasse proteger contra algo que
 * so passa a valer depois da remediacao seria pior que um que diz exatamente quando morde.
 *
 * Nao toca em `service_role` (credencial do runtime confiavel, fora da autorizacao da #131). E
 * nao proibe SELECT numa view publica so porque a fonte dela e protegida: a regra e sobre acesso
 * DIRETO a tabela-base. Confundir as duas coisas produz alarme falso, que e como um detector de
 * seguranca perde a audiencia.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_lottery_client_crud.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { orderedDdlSources } from "./ddl_execution_order.mjs";
import { dirname, join } from "node:path";
import { CLIENT_ROLES, tablePrivState } from "./client_table_privs_model.mjs";
import { stripSqlComments } from "./secdef_ddl_parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATE_PATH = "bolao/shared/safety/lottery_client_crud_state.json";

/** Os quatro verbos de linha. Os tres estruturais sao a #276 e ficam fora daqui. */
export const CRUD = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]);

/**
 * Piso de descoberta: se o modelo deixar de enxergar as tabelas protegidas, TODA assercao
 * "nenhuma exposicao alem da declarada" fica trivialmente verdadeira. Gate que fica verde por nao
 * achar nada e pior que gate nenhum.
 */
export const MIN_PROTECTED_TABLES_SEEN = 6;

export function ddlSources({ root = ROOT } = {}) {
  // Issue #292: a ordem e a REAL (por `appliedAt`), nao "todo shared/sql e depois todo migrations".
  // Aquela ordem nao correspondia a nada que tivesse acontecido, e fazia a remediacao da #135 rodar
  // ANTES do CREATE das views que ela protege -- portanto nao proteger nada.
  return orderedDdlSources({ root });
}

const setOf = (m, k) => m?.get(k) ?? new Set();

export function report({ root = ROOT, files, state } = {}) {
  const src = files ?? ddlSources({ root });
  const decl = state ?? JSON.parse(readFileSync(join(root, STATE_PATH), "utf8"));
  // `stripComments` NAO e opcional aqui, mesmo que o parametro tenha default. Sem ele, um GRANT
  // COMENTADO e lido como executavel -- e varios arquivos de codificacao carregam o seu rollback
  // comentado no rodape, exatamente nessa forma. Defeito meu, introduzido no PR #287 e achado ao
  // medir a paridade da #292: o gate teria acreditado num `grant` que ninguem executa.
  const privs = tablePrivState(src, { stripComments: stripSqlComments });

  const protegidas = decl.protectedBaseTables ?? [];
  const pendente = new Map((decl.pendingRemediation ?? []).map((p) => [p.table, p]));
  const ratificado = decl.ratified ?? [];

  const vistas = protegidas.filter((t) => privs.has(t));
  const achados = [];

  for (const tbl of protegidas) {
    const byRole = privs.get(tbl) ?? new Map();
    const pub = setOf(byRole, "PUBLIC");
    const p = pendente.get(tbl);

    for (const role of CLIENT_ROLES) {
      const own = setOf(byRole, role);
      for (const priv of CRUD) {
        const viaOwn = own.has(priv);
        const viaPublic = pub.has(priv);
        if (!viaOwn && !viaPublic) continue;

        // Heranca de PUBLIC nunca entra na divida declarada: a divida nomeia papel, e PUBLIC
        // alcanca papel que ninguem listou.
        if (viaPublic) {
          achados.push({ table: tbl, role, priv, kind: "PUBLIC_INHERITED",
            detail: `${priv} alcanca ${role} por heranca de PUBLIC — nunca coberto por pendingRemediation` });
          continue;
        }
        if (ratificado.some((r) => r.table === tbl && r.role === role && (r.privileges ?? []).includes(priv))) continue;
        if ((p?.[role] ?? []).includes(priv)) continue;

        achados.push({ table: tbl, role, priv, kind: "WIDENED",
          detail: `${role} ganhou ${priv} em ${tbl} sem ratificacao e alem da divida declarada` });
      }
    }
  }

  // Divida quitada tem de sair do arquivo, senao a lista vira isencao permanente.
  const quitadas = [];
  for (const [tbl, p] of pendente) {
    const byRole = privs.get(tbl) ?? new Map();
    const sobra = CLIENT_ROLES.flatMap((role) =>
      (p[role] ?? []).filter((priv) => setOf(byRole, role).has(priv)).map((priv) => `${role}:${priv}`));
    if (!sobra.length) quitadas.push(tbl);
  }

  // Ratificacao sem dono e sem motivo nao e ratificacao.
  const ratMalFormada = ratificado.filter((r) => !r.table || !r.role || !(r.privileges ?? []).length || !r.reason || !r.ratifiedBy);

  return { protegidas, vistas, achados, quitadas, ratMalFormada, decl, privs };
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nCRUD de papel de cliente nas tabelas-base protegidas do Powerball (Issue #131)\n");
  const r = report();

  check("o modelo enxerga as tabelas-base protegidas", r.vistas.length >= MIN_PROTECTED_TABLES_SEEN,
    r.vistas.length >= MIN_PROTECTED_TABLES_SEEN
      ? `${r.vistas.length} de ${r.protegidas.length} presentes na DDL`
      : `so ${r.vistas.length} de ${r.protegidas.length} — modelo cego ou arvore errada; piso e ${MIN_PROTECTED_TABLES_SEEN}`);

  const alargou = r.achados.filter((a) => a.kind === "WIDENED");
  check("nenhum papel de cliente ganhou CRUD alem da divida declarada", alargou.length === 0,
    alargou.length ? alargou.map((a) => a.detail).join("\n      ") : `divida inalterada em ${r.decl.pendingRemediation.length} tabelas`);

  const viaPublic = r.achados.filter((a) => a.kind === "PUBLIC_INHERITED");
  check("PUBLIC nao tem CRUD em tabela-base protegida", viaPublic.length === 0,
    viaPublic.length ? viaPublic.map((a) => a.detail).join("\n      ") : "PUBLIC continua sem nenhum dos quatro verbos");

  check("nenhuma divida ja quitada continua declarada", r.quitadas.length === 0,
    r.quitadas.length ? `revogado em producao/DDL, tem de sair de ${STATE_PATH}: ${r.quitadas.join(", ")}` : "a catraca esta apertada");

  check("toda ratificacao nomeia dono, motivo e privilegios", r.ratMalFormada.length === 0,
    r.ratMalFormada.length ? `incompleta: ${r.ratMalFormada.map((x) => `${x.table}/${x.role}`).join(", ")}`
      : `${(r.decl.ratified ?? []).length} ratificacao(oes) — nenhuma exceção silenciosa`);

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
