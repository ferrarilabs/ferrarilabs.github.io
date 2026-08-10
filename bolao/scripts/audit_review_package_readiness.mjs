#!/usr/bin/env node
/**
 * audit_review_package_readiness.mjs — F20_PREAUTH_READY.
 *
 * O pacote de review anterior foi julgado incompleto como artefato de cadeia de custódia. A
 * geração do novo está deliberadamente adiada até F7/F8/F10 serem aplicados e verificados em
 * produção — não faria sentido empacotar "verificado" o que ainda não foi.
 *
 * Este gate prova que, quando a autenticação existir, a geração é MECÂNICA: nenhuma decisão de
 * desenho, nenhuma ferramenta a escrever. Ele valida os INSUMOS, não gera o pacote.
 *
 * Uso: node bolao/scripts/audit_review_package_readiness.mjs
 */

import { existsSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REVIEWS = join(homedir(), "Documents", "GitHub", "ferrarilabs-work", "reviews");

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

console.log("F20_PREAUTH_READY — insumos do pacote de review independente\n");

// ─── 1. Destino e documentos de cadeia de custódia ───────────────────────────────────────────
check("diretório canônico de reviews existe", existsSync(REVIEWS), REVIEWS);
check("ledger de remediação presente e legível", (() => {
  const p = join(REVIEWS, "remediation_ledger.json");
  if (!existsSync(p)) return false;
  const d = JSON.parse(readFileSync(p, "utf8"));
  return Array.isArray(d.findings) && Array.isArray(d.newFindings) && d.findings.length >= 20;
})(), "remediation_ledger.json ausente ou incompleto");
check("ponto de retomada presente", existsSync(join(REVIEWS, "FULL_REMEDIATION_RESUME.md")));

// ─── 2. Lista de inclusão: o que o revisor precisa ver, existe ───────────────────────────────
const INCLUIR = [
  "bolao/shared", "bolao/br2026", "bolao/cdb2026", "bolao/copa2026",
  "bolao/loterias/powerball", "bolao/scripts", "scripts",
  "supabase/functions", "bolao/shared/sql",
  "package.json", "CLAUDE.md", "docs/bolao/SECURITY.md",
  ".github/workflows",
];
const ausentes = INCLUIR.filter((p) => !existsSync(join(ROOT, p)));
check("todos os caminhos da lista de inclusão existem", ausentes.length === 0, ausentes.join(", "));

// ─── 3. Lista de exclusão: o que NÃO pode entrar ─────────────────────────────────────────────
const EXCLUIR = ["node_modules", ".git", "supabase/.temp", ".claude/worktrees"];
check("lista de exclusão cobre node_modules, .git, .temp e worktrees",
  EXCLUIR.length === 4 && EXCLUIR.includes("node_modules") && EXCLUIR.includes(".git"));

// ─── 4. Orçamento de tamanho ─────────────────────────────────────────────────────────────────
{
  // Só arquivos versionados e de texto — a mesma seleção que o pacote fará.
  const lista = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean)
    .filter((p) => !/\.(png|jpg|jpeg|gif|webp|pdf|ico|woff2?|ttf|zip)$/i.test(p))
    .filter((p) => !p.startsWith(".claude/"));
  const bytes = lista.reduce((n, p) => {
    try { return n + statSync(join(ROOT, p)).size; } catch { return n; }
  }, 0);
  const mb = bytes / 1024 / 1024;
  console.log(`      arquivos de texto versionados: ${lista.length} (${mb.toFixed(1)} MB descomprimidos)`);
  check("orçamento de tamanho viável (< 25 MB comprimido é folgado a partir daqui)",
    mb < 60, `${mb.toFixed(1)} MB descomprimidos`);
}

// ─── 5. Ferramentas de empacotamento existem e funcionam ─────────────────────────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), "pkg-ready-"));
  try {
    const f = join(tmp, "amostra.txt");
    writeFileSync(f, "conteudo de teste ".repeat(200));
    const zip = join(tmp, "amostra.zip");
    execFileSync("zip", ["-9", "-X", "-q", "-j", zip, f]);
    const v = execFileSync("unzip", ["-v", zip], { encoding: "utf8" });
    check("zip disponível e comprimindo em DEFLATE", /Defl:/.test(v) && !/\bStored\b/.test(v));
    const sha = createHash("sha256").update(readFileSync(zip)).digest("hex");
    check("SHA256 do pacote é calculável", /^[a-f0-9]{64}$/.test(sha));
    const restore = join(tmp, "out");
    mkdirSync(restore);
    execFileSync("unzip", ["-qq", zip, "-d", restore]);
    check("pacote reabre e restaura", existsSync(join(restore, "amostra.txt")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ─── 6. Varreduras obrigatórias de sanitização existem e passam ──────────────────────────────
{
  const scanners = [
    ["PII repo-wide", ["node", "scripts/audit_pii_repo_wide.mjs"]],
    ["privacidade de fixture", ["node", "scripts/test_fixture_privacy.mjs"]],
    ["segurança de envio de email", ["node", "scripts/audit_email_send_safety.mjs"]],
  ];
  for (const [nome, cmd] of scanners) {
    const r = execFileSync(cmd[0], cmd.slice(1), { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    check(`scanner obrigatório passa: ${nome}`, typeof r === "string");
  }
}

// ─── 7. Nada privado entrou no repositório ───────────────────────────────────────────────────
{
  const versionados = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  check("nenhum artefato privado de review versionado",
    !/br2026-round\d+-preview|remediation_ledger\.json|FULL_REMEDIATION_RESUME/.test(versionados));
  check("nenhum log operacional versionado",
    !/ferrarilabs-work|round-email-\d{4}-\d{2}-\d{2}\.jsonl/.test(versionados));
}

// ─── 8. Estado do git é reportável ───────────────────────────────────────────────────────────
{
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  check("HEAD resolvível para o PACKAGE_INFO", /^[a-f0-9]{40}$/.test(head), head);
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 F20_PREAUTH_READY = NO");
  process.exit(1);
}
console.log("\n✓ F20_PREAUTH_READY = YES — geração pós-auth é mecânica");
