#!/usr/bin/env node
/**
 * Testes do modelo de execucao da DDL — Issue #292.
 *
 * O caso que importa e o CONTROLE NEGATIVO: desligar a ordenacao corretiva e exigir que o modelo
 * volte a reportar a divergencia. Sem ele, todo o resto seria um gate afirmando que esta tudo bem
 * sobre um modelo que poderia estar cego -- que e literalmente o defeito que a #292 encontrou.
 *
 * Nenhum caso aqui faz grep de prosa. Todos observam SEMANTICA EXECUTAVEL: a ACL que o replay
 * produz, e a posicao real de cada statement na ordem.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { report, orphanRevokes, CLASSES } from "./audit_ddl_execution_order.mjs";
import { orderedDdlSources, loadExecutionModel, EXECUTED_CLASSES } from "./ddl_execution_order.mjs";
import { tablePrivState } from "./client_table_privs_model.mjs";
import { stripSqlComments } from "./secdef_ddl_parse.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** O modelo com a ordem ANTIGA (tudo de shared/sql antes de tudo de migrations). */
function modeloOrdemAntiga() {
  const m = JSON.parse(JSON.stringify(loadExecutionModel({ root: ROOT })));
  for (const f of m.files) if (f.path.startsWith("bolao/shared/sql/")) f.appliedAt = "1970-01-01T00:00:00Z";
  return m;
}
const S = { stripComments: stripSqlComments };

console.log("\nMODELO DE EXECUCAO DA DDL (Issue #292)\n");

test("1. a arvore real passa no gate", () => {
  const r = report({ root: ROOT });
  assert(r.semClasse.length === 0, `sem classe: ${r.semClasse.join(", ")}`);
  assert(r.orfaos.length === 0, `revoke orfao: ${JSON.stringify(r.orfaos)}`);
  assert(r.ledgerOk, "a paridade com o ledger tem de continuar coerente");
});

test("2. classe desconhecida REPROVA fechado", () => {
  const m = loadExecutionModel({ root: ROOT });
  const mutado = { ...m, files: m.files.map((f, i) => (i === 0 ? { ...f, class: "TALVEZ" } : f)) };
  const r = report({ root: ROOT, model: mutado });
  assert(r.semClasse.length === 1, "uma classe invalida tem de virar UNKNOWN e reprovar");
  assert(!CLASSES.includes("TALVEZ"), "TALVEZ nao pode ser uma classe valida");
});

test("3. EXECUTED_BY_CLI so vale para arquivo que o CLI enxerga", () => {
  const m = loadExecutionModel({ root: ROOT });
  const alvo = m.files.find((f) => f.path.startsWith("bolao/shared/sql/"));
  const mutado = { ...m, files: m.files.map((f) => (f === alvo ? { ...f, class: "EXECUTED_BY_CLI" } : f)) };
  const r = report({ root: ROOT, model: mutado });
  assert(r.cliErrado.includes(alvo.path),
    "um arquivo de shared/sql nao pode reivindicar execucao pelo CLI — o CLI so le supabase/migrations/<14 digitos>_");
});

test("4. arquivo executavel sem `appliedAt` reprova — sem instante nao ha ordem", () => {
  const m = loadExecutionModel({ root: ROOT });
  const alvo = m.files.find((f) => EXECUTED_CLASSES.includes(f.class));
  const mutado = { ...m, files: m.files.map((f) => (f === alvo ? { ...f, appliedAt: null } : f)) };
  assert(report({ root: ROOT, model: mutado }).semInstante.includes(alvo.path), "falta de instante tem de reprovar");
});

// ── CONTROLE NEGATIVO ────────────────────────────────────────────────────────────────────────
test("5. CONTROLE NEGATIVO: desligar a ordem corretiva reintroduz a divergencia da #135", () => {
  const antiga = modeloOrdemAntiga();
  const filesAntigos = orderedDdlSources({ root: ROOT, model: antiga });
  const filesNovos = orderedDdlSources({ root: ROOT });
  assert(filesAntigos.length === filesNovos.length, "o conjunto de arquivos e o mesmo; so a ORDEM muda");
  assert(filesAntigos[0].file !== filesNovos[0].file, "a ordem tem de ser de fato diferente");

  // O efeito observavel: com a ordem antiga, as duas views publicas voltam a nascer gravaveis.
  const antes = tablePrivState(filesAntigos, S);
  const depois = tablePrivState(filesNovos, S);
  for (const view of ["bolao_state_public", "bolao_state_public_cdb"]) {
    for (const role of ["anon", "authenticated"]) {
      const a = antes.get(view)?.get(role) ?? new Set();
      const d = depois.get(view)?.get(role) ?? new Set();
      assert(a.has("INSERT") || a.has("UPDATE") || a.has("DELETE"),
        `ordem ANTIGA: ${view}/${role} tinha de mostrar escrita — era o defeito da #135`);
      for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert(!d.has(p), `ordem NOVA: ${view}/${role} nao pode ter ${p}`);
      }
      assert(d.has("SELECT"), `${view}/${role}: SELECT e intencional e tem de sobreviver`);
    }
  }
});

test("6. CONTROLE NEGATIVO: com a ordem antiga aparecem REVOKES ORFAOS que a ordem real nao tem", () => {
  const orfaosAntigos = orphanRevokes({ root: ROOT, files: orderedDdlSources({ root: ROOT, model: modeloOrdemAntiga() }) });
  const orfaosNovos = orphanRevokes({ root: ROOT });
  assert(orfaosAntigos.length > 0, "a ordem antiga tem de produzir revoke que nao morde");
  assert(orfaosNovos.length === 0, `a ordem real nao pode ter orfao: ${JSON.stringify(orfaosNovos)}`);
});

test("7. remover a codificacao da cerca faz `bolao_state` renascer gravavel por anon", () => {
  // Sem `033_*`, uma reconstrucao devolve a `anon` CRUD sobre o documento que guarda entradas,
  // pagamentos e rateio. Este e o achado 2 da #292, verificado pelo efeito e nao pelo texto.
  const sem = orderedDdlSources({ root: ROOT }).filter((f) => !f.file.includes("033_codify_bolao_state_fence"));
  const st = tablePrivState(sem, S).get("bolao_state")?.get("anon") ?? new Set();
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert(st.has(p), `sem a codificacao, anon voltaria a ter ${p} em bolao_state`);
  }
  const com = tablePrivState(orderedDdlSources({ root: ROOT }), S).get("bolao_state")?.get("anon") ?? new Set();
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert(!com.has(p), `com a codificacao, anon nao pode ter ${p}`);
  }
  // E `authenticated` NAO pode ter sido tocado: producao mede CRUD para ele.
  const auth = tablePrivState(orderedDdlSources({ root: ROOT }), S).get("bolao_state")?.get("authenticated") ?? new Set();
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert(auth.has(p), `authenticated tem de MANTER ${p} — e o que producao mede`);
  }
});

test("8. arvore sintetica sem manifesto ainda funciona (fixtures nao quebram)", () => {
  const s = orderedDdlSources({ root: join(HERE, "fixtures") });
  assert(Array.isArray(s), "uma raiz sem manifesto tem de cair na varredura por diretorio, nao explodir");
});

test("9. um GRANT comentado nao conta como executado", () => {
  // `031_*` carrega o proprio rollback comentado no rodape. Sem strip de comentario, o modelo le
  // aquele `grant` como real e desfaz a remediacao sozinho — foi o que aconteceu ao medir a #292 e
  // e o mesmo defeito que estava no gate da #131 (corrigido junto).
  // O papel do probe NAO pode ser `anon`/`authenticated`/`service_role`: esses sao semeados pela
  // ACL de NASCIMENTO, entao teriam o privilegio de qualquer jeito e o teste nao provaria nada
  // sobre o comentario. Um papel que o default nao concede isola exatamente a variavel.
  const files = [{ file: "x.sql", text: `create table public.t_c (id int);\n-- grant select on table public.t_c to relatorio_ro;\n` }];
  const comStrip = tablePrivState(files, S).get("t_c")?.get("relatorio_ro") ?? new Set();
  assert(!comStrip.has("SELECT"), "um grant comentado NAO pode virar privilegio");
  const semStrip = tablePrivState(files).get("t_c")?.get("relatorio_ro") ?? new Set();
  assert(semStrip.has("SELECT"), "sem o strip ele seria lido — por isso todo chamador tem de passar stripComments");
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
