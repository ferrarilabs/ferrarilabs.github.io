#!/usr/bin/env node
/**
 * ORDEM DE EXECUCAO DA DDL — Issue #292.
 *
 * ─── O DEFEITO QUE ISTO CORRIGE ──────────────────────────────────────────────────────────────
 *
 * Todo gate de banco montava a "reconstrucao limpa" assim:
 *
 *     [...bolao/shared/sql/** (alfabetico), ...supabase/migrations/** (alfabetico)]
 *
 * Essa ordem nao corresponde a nada que tenha acontecido. `031_codify_bolao_state_public_views_
 * revoke.sql` (Issue #135) entrou em 2026-08-18 e revoga privilegio de duas views criadas pela
 * migracao `20260813200000`, de 2026-08-13. Na ordem REAL o revoke vem depois do CREATE e vale;
 * na ordem MODELADA ele vem antes, nao alcanca objeto nenhum e some. Resultado: a remediacao da
 * #135 parecia aplicada e o modelo dizia que as views nascem gravaveis por `anon`.
 *
 * Nao era um caso isolado -- era todo arquivo de `shared/sql` que corrige algo criado por uma
 * migracao. A correcao e ordenar por QUANDO, nao por ONDE.
 *
 * ─── DE ONDE VEM O "QUANDO" ──────────────────────────────────────────────────────────────────
 *
 * De `bolao/shared/safety/ddl_execution_model.json`, um manifesto REVISAVEL -- nao de uma consulta
 * ao git em tempo de execucao. Duas razoes: o CI pode ser raso (`--depth=1`) e nao ter as datas, e
 * uma ordem que muda sozinha conforme a historia e reescrita nao e determinismo.
 *
 * ─── O QUE O MANIFESTO REGISTRA, E QUE ANTES ERA SUPOSICAO ───────────────────────────────────
 *
 *   EXECUTED_BY_CLI     `supabase/migrations/<14 digitos>_*.sql`. Provado: o ledger de producao
 *                       (`supabase_migrations.schema_migrations`) tem 60 versoes e o repositorio
 *                       tem exatamente as mesmas 60.
 *   MANUAL_ONLY         `bolao/shared/sql/**`. NENHUM workflow, script ou runner os executa; o CLI
 *                       nao os enxerga. Mesmo assim os objetos existem em producao -- foram
 *                       rodados a mao.
 *   DOCUMENTATION_ONLY  nao executavel por desenho (o baseline `.reference.sql`).
 *
 * CONSEQUENCIA que fica registrada em vez de suposta: uma reconstrucao SO com `supabase db push`
 * NAO reproduz producao -- `enqueue_bolao_notif`, `_bolao_audit`, `op_confirm_payment` e
 * `submit_entry` nascem apenas em `shared/sql`. Este modulo nao conserta isso; ele impede que os
 * gates continuem raciocinando sobre uma ordem que nunca existiu.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MODEL_PATH = "bolao/shared/safety/ddl_execution_model.json";

export function loadExecutionModel({ root = ROOT } = {}) {
  return JSON.parse(readFileSync(join(root, MODEL_PATH), "utf8"));
}

/** Classes que uma reconstrucao realmente executa, em alguma forma. */
export const EXECUTED_CLASSES = Object.freeze(["EXECUTED_BY_CLI", "MANUAL_ONLY"]);

/**
 * Os arquivos de DDL na ordem em que foram REALMENTE aplicados.
 *
 * Um arquivo declarado no manifesto que nao existe mais em disco e IGNORADO em silencio aqui --
 * `audit_ddl_execution_order.mjs` e quem reprova por isso. Misturar as duas coisas faria um gate
 * de ordem falhar por um motivo de inventario.
 */
export function orderedDdlSources({ root = ROOT, model } = {}) {
  // ─── ARVORE SINTETICA ────────────────────────────────────────────────────────────────────────
  //
  // Varios testes montam uma arvore de fixture num diretorio temporario e chamam o gate com aquele
  // `root`. La nao existe manifesto -- e nao deveria existir: a fixture E a ordem que o teste quer
  // exercitar. Nesse caso, e SO nesse caso, cai-se na varredura por diretorio.
  //
  // Isto NAO e um fallback silencioso para a arvore real: `audit_ddl_execution_order.mjs` reprova
  // se o manifesto sumir do repositorio, entao a ausencia aqui nunca passa despercebida onde
  // importa.
  if (!model && !existsSync(join(root, MODEL_PATH))) return legacyDirectoryScan(root);
  const m = model ?? loadExecutionModel({ root });
  return [...m.files, ...derivedMigrations(root, m)]
    .filter((f) => EXECUTED_CLASSES.includes(f.class) && f.appliedAt)
    .sort((a, b) => (a.appliedAt < b.appliedAt ? -1 : a.appliedAt > b.appliedAt ? 1 : a.path.localeCompare(b.path)))
    .map((f) => ({ file: f.path, abs: join(root, f.path) }))
    .filter((f) => existsSync(f.abs))
    .map((f) => ({ file: f.file, text: readFileSync(f.abs, "utf8") }));
}

/**
 * Migracoes que se DESCREVEM SOZINHAS, derivadas do disco em vez de declaradas a mao.
 *
 * `supabase/migrations/<14 digitos>_*.sql` nao e ambiguo: o CLI executa esses arquivos, em ordem de
 * timestamp, e o proprio nome carrega o instante. Exigir uma entrada manual para cada migracao nova
 * seria atrito recorrente -- e atrito recorrente termina com alguem colando uma linha sem ler, que e
 * pior do que nao ter manifesto.
 *
 * O manifesto continua obrigatorio para `bolao/shared/sql/**`, que e o conjunto genuinamente
 * ambiguo: sem timestamp, sem runner, e so existe em producao porque alguem rodou a mao.
 *
 * Uma entrada explicita no manifesto SEMPRE vence a derivacao -- e assim que o baseline
 * `.reference.sql` continua marcado DOCUMENTATION_ONLY em vez de virar migracao por acidente.
 */
function derivedMigrations(root, model) {
  const dir = join(root, "supabase/migrations");
  if (!existsSync(dir)) return [];
  const declarados = new Set(model.files.map((f) => f.path));
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const path = `supabase/migrations/${f}`;
    if (declarados.has(path)) continue;
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(f);
    if (!m) continue; // sem timestamp o CLI nao o ve; o gate reprova por falta de classificacao
    out.push({ path, class: "EXECUTED_BY_CLI", appliedAt: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, derived: true });
  }
  return out;
}

/**
 * A ordem ANTIGA (por diretorio), preservada exclusivamente para arvores de fixture.
 *
 * Ela e o defeito que a Issue #292 corrigiu -- nao e uma alternativa aceitavel para o repositorio
 * real, e o nome diz isso de proposito.
 */
function legacyDirectoryScan(root) {
  const load = (rel, filt) => {
    const dir = join(root, rel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".sql") && filt(f)).sort()
      .map((f) => ({ file: `${rel}/${f}`, text: readFileSync(join(dir, f), "utf8") }));
  };
  return [...load("bolao/shared/sql", () => true), ...load("supabase/migrations", (f) => !f.includes(".reference."))];
}
