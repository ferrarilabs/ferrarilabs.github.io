#!/usr/bin/env node
/**
 * PROVENIENCIA DE DDL — todo objeto EXIGIDO tem um arquivo que o cria. Issue #266.
 *
 * ─── DE ONDE VEIO ────────────────────────────────────────────────────────────────────────────
 *
 * A DDL de producao deste repositorio mora em DOIS diretorios, e so um deles e o ledger de
 * migracoes:
 *
 *   · `supabase/migrations/**`  — rastreado por `supabase_migrations.schema_migrations`
 *   · `bolao/shared/sql/**`     — NAO rastreado (arquivos 010_… 030_)
 *
 * Isso nao e drift acidental: `030_br_round_notification_durability.sql` criou
 * `bolao_round_notif_jobs` em resposta ao incidente #221, com o motivo escrito no proprio arquivo.
 * Mas significa que quem raciocina "o ledger descreve a producao" conta menos objetos do que
 * existem — e foi exatamente assim que a Issue #133 nasceu: um grep ancorado em
 * `supabase/migrations/` devolveu 10 tabelas quando producao tem 12, e a base de aceitacao de DR
 * foi construida sobre a contagem incompleta.
 *
 * ─── O QUE ESTE GATE FAZ, E O QUE ELE NAO FAZ ───────────────────────────────────────────────
 *
 * FAZ: prova que cada objeto de `REQUIRED_TABLES`/`REQUIRED_VIEWS` tem pelo menos um arquivo de
 * DDL neste repositorio que o cria, e diz QUAL. Um objeto exigido sem criador e uma restauracao
 * que ninguem consegue reproduzir a partir do codigo.
 *
 * NAO FAZ: falar com producao. E deliberado — o gate roda no CI hermetico, sem credencial, e a
 * pergunta que ele responde ("o repositorio sabe criar o que exige?") nao precisa do banco. A
 * pergunta complementar ("producao tem algo que o repositorio nao sabe criar?") exige leitura de
 * catalogo e continua sendo trabalho de auditoria, registrado na propria Issue #266.
 *
 * Uso: node scripts/db/audit_ddl_provenance.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REQUIRED_TABLES, REQUIRED_VIEWS } from "./acceptance_checks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Os dois diretorios que definem estrutura de producao. Ambos declarados, nenhum implicito. */
export const DDL_SOURCES = [
  { dir: "supabase/migrations", ledger: true,
    why: "ledger de migracoes, rastreado por supabase_migrations.schema_migrations" },
  { dir: "bolao/shared/sql", ledger: false,
    why: "DDL fora do ledger, aplicada a mao; existe por decisao registrada (ver 030_*, incidente #221)" },
];

function sqlFiles() {
  const out = [];
  for (const src of DDL_SOURCES) {
    let names = [];
    try { names = readdirSync(join(ROOT, src.dir)).filter((f) => f.endsWith(".sql")); }
    catch { continue; }  // diretorio ausente e tratado abaixo, na checagem de fontes
    for (const f of names) out.push({ ...src, file: `${src.dir}/${f}`, text: readFileSync(join(ROOT, src.dir, f), "utf8") });
  }
  return out;
}

/**
 * Quais arquivos criam um objeto. Aceita as formas realmente usadas neste repositorio:
 * com/sem `IF NOT EXISTS`, com/sem `OR REPLACE`, com/sem o schema, com/sem aspas.
 * Deliberadamente NAO aceita `DROP` — apagar nao e criar.
 */
export function creatorsOf(objectName, kind, files) {
  const n = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?${kind}\\s+(?:if\\s+not\\s+exists\\s+)?` +
    `(?:"?public"?\\s*\\.\\s*)?"?${n}"?(?![a-z0-9_])`, "i");
  return files.filter((f) => re.test(f.text)).map((f) => f.file);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); fail++; }
};

console.log("\nPROVENIENCIA DE DDL — todo objeto exigido tem criador declarado (Issue #266)\n");

const files = sqlFiles();

// FALHA FECHADO: sem arquivos de DDL nao da para afirmar proveniencia de nada, e "nao consegui
// verificar" nunca pode sair como verde — a mesma licao da Issue #133.
check("as fontes de DDL declaradas existem e tem conteudo", files.length > 0,
  `${files.length} arquivos .sql em ${DDL_SOURCES.map((s) => s.dir).join(" + ")}`);

if (files.length > 0) {
  const semCriador = [];
  const foraDoLedger = [];

  for (const [kind, names] of [["table", REQUIRED_TABLES], ["view", REQUIRED_VIEWS]]) {
    for (const nome of names) {
      const criadores = creatorsOf(nome, kind, files);
      if (criadores.length === 0) { semCriador.push(`${kind} ${nome}`); continue; }
      const noLedger = criadores.some((f) => f.startsWith("supabase/migrations/"));
      if (!noLedger) foraDoLedger.push(`${nome} <- ${criadores.join(", ")}`);
    }
  }

  check("todo objeto EXIGIDO tem pelo menos um arquivo que o cria", semCriador.length === 0,
    semCriador.length ? `sem criador no repositorio: ${semCriador.join("; ")}` : `${REQUIRED_TABLES.length} tabelas + ${REQUIRED_VIEWS.length} views rastreadas`);

  // Objeto fora do ledger NAO reprova: e uma decisao registrada, nao um defeito. Mas some da
  // vista se ninguem o listar, e foi assim que a #133 comecou. Aqui ele fica VISIVEL a cada
  // execucao, com o arquivo que o cria.
  console.log(`\n  ℹ objetos exigidos definidos FORA do ledger de migracoes: ${foraDoLedger.length}`);
  for (const l of foraDoLedger) console.log(`      ${l}`);

  // O inventario completo, para que a resposta a "qual arquivo cria isto?" nunca dependa de grep.
  console.log("\n  inventario:");
  for (const [kind, names] of [["table", REQUIRED_TABLES], ["view", REQUIRED_VIEWS]]) {
    for (const nome of names) {
      const c = creatorsOf(nome, kind, files);
      console.log(`      ${kind.padEnd(5)} ${nome.padEnd(32)} ${c.length ? c.join(", ") : "(NENHUM)"}`);
    }
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ DDL PROVENANCE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
