#!/usr/bin/env node
/**
 * IDEMPOTENCIA DE MIGRACAO — uma migracao que nao pode ser reaplicada trava o deploy inteiro.
 *
 * ─── O INCIDENTE QUE ORIGINOU ESTE GATE (Issue #306) ────────────────────────────────────────
 *
 * `20260822134050_powerball_payment_system_of_record.sql` usava `add constraint` cru. As
 * constraints ja existiam em producao e a migracao nunca chegou a ser registrada em
 * `supabase_migrations.schema_migrations`. Resultado: a integracao Supabase-GitHub reaplicava o
 * arquivo a CADA push, morria com
 *
 *     ERROR: constraint "..." for relation "..." already exists (SQLSTATE 42710)
 *
 * e ABORTAVA antes de implantar as Edge Functions.
 *
 * O efeito nao ficou no banco: o deploy da Issue #296 ficou preso atras disso por horas, com
 * `main` verde e producao rodando codigo antigo. Ninguem foi avisado -- o check externo aparecia
 * como `Supabase Preview` e a falha dele nao reprova nada no repositorio.
 *
 * O detalhe cruel: no MESMO arquivo, `add column if not exists`, `create ... if not exists`,
 * `create or replace` e `drop trigger if exists` estavam todos corretos. Só duas linhas não eram
 * idempotentes, e elas bastaram.
 *
 * ─── O QUE ESTE GATE EXIGE ──────────────────────────────────────────────────────────────────
 *
 * Todo DDL sob `supabase/migrations/**` tem de ser reaplicavel sem erro. PostgreSQL nao tem
 * `ADD CONSTRAINT IF NOT EXISTS`, entao a forma correta e um `DO $$ ... IF NOT EXISTS ... END $$`
 * (ou `drop ... if exists` antes de criar).
 *
 * Uso: node scripts/db/audit_migration_idempotency.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(RAIZ, "supabase/migrations");

/** Remove comentarios e o corpo de blocos $$...$$ (onde os guards legitimos moram). */
export function stripNoise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/**
 * Statements de DDL que NAO sao reaplicaveis sozinhos.
 *
 * Cada um so e aceito quando esta protegido: dentro de um bloco `DO` com `if not exists`, ou
 * precedido por um `drop ... if exists` do MESMO objeto.
 */
const PERIGOSOS = [
  { nome: "add constraint",  re: /\badd\s+constraint\s+([a-z0-9_]+)/gi,
    porque: "PostgreSQL nao tem ADD CONSTRAINT IF NOT EXISTS — use um DO block com IF NOT EXISTS" },
  { nome: "create trigger",  re: /\bcreate\s+trigger\s+([a-z0-9_]+)/gi,
    porque: "use `drop trigger if exists <nome> on <tabela>;` imediatamente antes" },
  { nome: "create policy",   re: /\bcreate\s+policy\s+"?([a-z0-9_ ]+)"?/gi,
    porque: "use `drop policy if exists` antes, ou um DO block guardado" },
  { nome: "create type",     re: /\bcreate\s+type\s+([a-z0-9_.]+)/gi,
    porque: "use um DO block com IF NOT EXISTS sobre pg_type" },
];

/** O statement esta dentro de um bloco `DO $$ ... $$` que contenha `if not exists`? */
function dentroDeGuard(sql, indice) {
  const blocos = [...sql.matchAll(/\bdo\s+\$\$([\s\S]*?)\$\$/gi)];
  for (const b of blocos) {
    const ini = b.index, fim = b.index + b[0].length;
    if (indice > ini && indice < fim && /if\s+not\s+exists/i.test(b[1])) return true;
  }
  return false;
}

/** Ha um `drop <tipo> if exists <nome>` antes deste ponto? */
function temDropAntes(sql, nome, indice) {
  const antes = sql.slice(0, indice);
  return new RegExp(`drop\\s+\\w+\\s+if\\s+exists\\s+"?${nome}"?`, "i").test(antes);
}

export function achados(sql, rel) {
  const limpo = stripNoise(sql);
  const out = [];
  for (const { nome, re, porque } of PERIGOSOS) {
    for (const m of limpo.matchAll(re)) {
      const objeto = (m[1] || "").trim();
      if (dentroDeGuard(limpo, m.index)) continue;
      if (temDropAntes(limpo, objeto, m.index)) continue;
      const linha = limpo.slice(0, m.index).split("\n").length;
      out.push(`${rel}:${linha}  ${nome} ${objeto} — ${porque}`);
    }
  }
  return out;
}

/**
 * So conta o que o Supabase REALMENTE reaplica.
 *
 * O CLI aplica arquivos `<14 digitos>_nome.sql` cuja versao ainda nao esta em
 * `schema_migrations`. Um `BASELINE_....reference.sql` nao casa com o padrao e nunca e executado —
 * cobrar idempotencia dele seria ruido, e um gate ruidoso e um gate que alguem desliga.
 */
const NOME_DE_MIGRACAO = /^\d{14}_[a-z0-9_]+\.sql$/;

/**
 * DEBITO DECLARADO — migracoes historicas que JA APLICARAM com sucesso.
 *
 * O Supabase so executa migracoes ainda nao registradas; uma ja aplicada nunca roda de novo, entao
 * a nao-idempotencia dela nao pode travar deploy nenhum. Reescrever essas linhas hoje mudaria
 * arquivos que ja sao historia, o que o check M4 do contrato proibe — e sem beneficio real.
 *
 * O numero e um TETO e so pode ENCOLHER. Uma migracao NOVA nao entra aqui: ela tem de nascer
 * reaplicavel, porque e exatamente ela que vai rodar.
 */
const DEBITO = {
  "20260811170000_expand_m1_schema_extensions_and_enum_types.sql": 14,
  "20260811160001_baseline_adopted_policies.sql": 7,
  "20260813110000_match_result_advancing_side.sql": 1,
};

function main() {
  const arquivos = readdirSync(DIR).filter((f) => NOME_DE_MIGRACAO.test(f)).sort();
  const porArquivo = new Map();
  for (const f of arquivos) {
    const p = achados(readFileSync(join(DIR, f), "utf-8"), `supabase/migrations/${f}`);
    if (p.length) porArquivo.set(f, p);
  }

  console.log(`\nIdempotencia de migracao — ${arquivos.length} migracao(oes) aplicavel(is)\n`);

  const bloqueios = [];
  for (const [f, p] of porArquivo) {
    const teto = DEBITO[f];
    if (teto === undefined) {
      bloqueios.push(`${f}: migracao NAO declarada com ${p.length} statement(s) nao reaplicavel(is).\n` +
        p.map((x) => `      ${x}`).join("\n"));
    } else if (p.length > teto) {
      bloqueios.push(`${f}: debito CRESCEU (${teto} -> ${p.length}). O teto so pode encolher.`);
    }
  }

  // Um teto que ficou grande demais tambem e defeito: ele autoriza mais do que existe.
  for (const [f, teto] of Object.entries(DEBITO)) {
    const atual = (porArquivo.get(f) || []).length;
    if (atual < teto) {
      bloqueios.push(`${f}: o debito diminuiu para ${atual} mas o teto ainda diz ${teto}. ` +
        `Aperte o teto — um limite frouxo deixa de medir.`);
    }
  }

  if (bloqueios.length) {
    console.log("✗ DDL NAO REAPLICAVEL (trava o deploy inteiro, Issue #306):\n");
    for (const b of bloqueios) console.log("  - " + b);
    console.log(`\n${bloqueios.length} bloqueio(s).\n`);
    process.exit(1);
  }

  const declarados = Object.values(DEBITO).reduce((a, b) => a + b, 0);
  console.log(`✓ nenhuma migracao NOVA e nao-reaplicavel`);
  console.log(`  debito historico declarado: ${declarados} statement(s) em ${Object.keys(DEBITO).length} migracao(oes) ja aplicada(s)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
