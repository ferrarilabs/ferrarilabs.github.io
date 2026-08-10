/**
 * audit_gate_registry.mjs — AUDIT_GATE_REGISTRY_COMPLETE. Meta-gate contra gates órfãos.
 *
 * ─── O DEFEITO DE CLASSE QUE ISTO ELIMINA ────────────────────────────────────────────────────
 *
 * Em 2026-08-10 uma auditoria descobriu 17 arquivos de gate que EXISTIAM no repositório e nunca
 * eram executados por `npm run test:*`. Entre eles gates de segurança de email e de PII do
 * Powerball, e `audit_football_live_store.mjs` — que estava VERMELHO havia commits, tendo pego
 * uma regressão real que nenhuma suíte reportou.
 *
 * O custo não é teórico. Um gate órfão é pior que gate nenhum: ele cria a impressão de cobertura
 * e não entrega nenhuma. Dois defeitos desta sessão passaram por causa disso —
 * `UNSUPPORTED_SCHEMA_<v>` quebrado (N12) e um `?v=` de asset compartilhado desatualizado logo
 * depois de a própria correção de cache-bust ter sido publicada (N13).
 *
 * Resolver "lembrando dos 17 nomes" não resolve: o 18º nasce órfão amanhã. Este gate torna o
 * estado órfão IMPOSSÍVEL DE FICAR SILENCIOSO — todo arquivo de gate descoberto precisa estar
 * classificado no registro, e todo item classificado como executado precisa de fato aparecer nos
 * scripts da suíte.
 *
 * Classificações permitidas (`gate_registry.json`):
 *   REGISTERED_AND_EXECUTED            — roda na suíte agregada; o gate confere isso de verdade
 *   INTENTIONALLY_STANDALONE_WITH_REASON — fora da suíte de propósito, com motivo escrito
 *   NON_GATE_HELPER                    — biblioteca/utilitário, não é gate
 *
 * Uso: node bolao/scripts/audit_gate_registry.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY_PATH = join(ROOT, "bolao/scripts/gate_registry.json");

const CLASSES = new Set([
  "REGISTERED_AND_EXECUTED",
  "INTENTIONALLY_STANDALONE_WITH_REASON",
  "NON_GATE_HELPER",
]);

/** Descoberta determinística: todo arquivo versionado com nome de gate. */
function discover() {
  const out = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n")
    .filter(Boolean)
    .filter(p => /(^|\/)(audit|test|check)_[^/]*\.(mjs|py)$/.test(p))
    .filter(p => !p.startsWith(".claude/"))
    .sort();
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const allScripts = Object.entries(pkg.scripts || {})
  .filter(([name]) => name !== "verify" && name !== "verify:json")
  .map(([, cmd]) => cmd)
  .join(" && ");

const registry = existsSync(REGISTRY_PATH)
  ? JSON.parse(readFileSync(REGISTRY_PATH, "utf8"))
  : { entries: {} };

const discovered = discover();
const failures = [];
const counts = { REGISTERED_AND_EXECUTED: 0, INTENTIONALLY_STANDALONE_WITH_REASON: 0, NON_GATE_HELPER: 0 };

for (const path of discovered) {
  const entry = registry.entries[path];

  if (!entry) {
    failures.push(
      `ÓRFÃO NÃO CLASSIFICADO: ${path}\n` +
      `      Um gate novo não pode nascer invisível. Classifique-o em bolao/scripts/gate_registry.json\n` +
      `      como REGISTERED_AND_EXECUTED (e adicione-o a package.json), ou como\n` +
      `      INTENTIONALLY_STANDALONE_WITH_REASON / NON_GATE_HELPER com motivo escrito.`
    );
    continue;
  }

  if (!CLASSES.has(entry.classification)) {
    failures.push(`${path}: classificação inválida "${entry.classification}"`);
    continue;
  }
  counts[entry.classification]++;

  if (entry.classification === "REGISTERED_AND_EXECUTED") {
    // Prova REAL de execução: o caminho tem de aparecer num script da suíte. Um registro que
    // apenas se declara executado seria exatamente o falso-verde que este gate existe para matar.
    if (!allScripts.includes(path)) {
      failures.push(
        `${path}: classificado REGISTERED_AND_EXECUTED mas NÃO aparece em nenhum script do package.json`
      );
    }
  } else if (!entry.reason || entry.reason.length < 20) {
    failures.push(`${path}: ${entry.classification} exige um motivo escrito e específico`);
  }
}

// Entradas de registro apontando para arquivos que sumiram.
for (const path of Object.keys(registry.entries)) {
  if (!discovered.includes(path)) {
    failures.push(`registro aponta para arquivo inexistente: ${path}`);
  }
}

const orphanCritical = failures.filter(f => f.startsWith("ÓRFÃO NÃO CLASSIFICADO")).length;

console.log("AUDIT_GATE_REGISTRY_COMPLETE — nenhum gate pode existir sem classificação\n");
console.log(`  gates descobertos:                    ${discovered.length}`);
console.log(`  REGISTERED_AND_EXECUTED:              ${counts.REGISTERED_AND_EXECUTED}`);
console.log(`  INTENTIONALLY_STANDALONE_WITH_REASON: ${counts.INTENTIONALLY_STANDALONE_WITH_REASON}`);
console.log(`  NON_GATE_HELPER:                      ${counts.NON_GATE_HELPER}`);
console.log(`  ORPHAN_CRITICAL_GATES:                ${orphanCritical}`);

if (failures.length) {
  console.error(`\n🛑 FALHOU: ${failures.length} problema(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\n✓ AUDIT_GATE_REGISTRY_COMPLETE — todo gate está classificado e o que se declara executado, executa.");
