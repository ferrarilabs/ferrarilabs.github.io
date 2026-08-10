#!/usr/bin/env node
/**
 * audit_live_cache_write_authority.mjs — F8. Só o gateway confiável escreve no cache ao vivo.
 *
 * ─── O INCIDENTE ─────────────────────────────────────────────────────────────────────────────
 *
 * `live_sports_cache` tinha policies de INSERT e UPDATE para `public`, o que inclui `anon`. A
 * anon key é pública por construção — vai no `js/config.js` de todo navegador.
 *
 * A causa raiz não era uma policy esquecida: a Edge Function `live-football` escrevia no cache
 * usando A PRÓPRIA ANON KEY. As policies precisavam ser permissivas para o gateway funcionar.
 *
 * Em 2026-08-10 uma sonda de segurança feita com a anon key substituiu o payload de `br2026` por
 * `{"__probe__": "..."}` — zero partidas. Qualquer pessoa podia apagar o placar ao vivo de todo
 * mundo, e a única barreira era a validação no cliente (F9).
 *
 * O comentário que existia no código dizia que "o pior caso é sobrescrever cache esportivo
 * público por outro dado esportivo público". Estava errado: o pior caso é APAGAR.
 *
 * ─── O QUE ESTE GATE TRAVA ───────────────────────────────────────────────────────────────────
 *
 * 1. A escrita no cache não pode voltar a usar a anon key.
 * 2. Não pode existir fallback silencioso para a anon key quando a credencial privilegiada falta
 *    — a escrita seria negada, o `catch` engoliria, e o cache pararia de atualizar em silêncio.
 * 3. Nenhuma credencial privilegiada pode aparecer em fonte versionada.
 * 4. A migração que removeu as policies tem de continuar no repositório, com rollback.
 *
 * Uso: node bolao/scripts/audit_live_cache_write_authority.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

const FN = "supabase/functions/live-football/index.ts";
const MIG = "bolao/shared/sql/011_live_cache_deny_anon_writes.sql";

const fn = readFileSync(join(ROOT, FN), "utf8");
const code = fn.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

console.log("LIVE_CACHE_WRITE_AUTHORITY (F8)\n");

// ─── 1. A escrita usa credencial privilegiada, não a anon ────────────────────────────────────
{
  const i = code.indexOf("async function writeSharedCache");
  const bloco = i >= 0 ? code.slice(i, code.indexOf("\n}", i)) : "";
  check("writeSharedCache existe", i >= 0);
  check("a escrita NÃO usa a anon key", !/SUPABASE_ANON\b/.test(bloco),
    "writeSharedCache voltou a escrever com a chave pública");
  check("a escrita usa a chave privilegiada", /SUPABASE_WRITE_KEY/.test(bloco));
}

// ─── 2. Sem fallback silencioso ──────────────────────────────────────────────────────────────
{
  check("nenhum fallback da chave de escrita para a anon key",
    !/SUPABASE_WRITE_KEY\s*=\s*[^;]*\?\?\s*SUPABASE_ANON/.test(code),
    "`?? SUPABASE_ANON` parece defensivo e faz o cache parar de atualizar em silêncio");
  check("ausência da credencial é reportada, não engolida",
    /if \(!SUPABASE_WRITE_KEY\)/.test(code) && /console\.error/.test(code),
    "sem guarda explícita, a falta da chave vira um cache que nunca mais atualiza, sem sinal");
}

// ─── 3. A leitura continua pública (dado esportivo é público) ────────────────────────────────
{
  const i = code.indexOf("async function readSharedCache");
  const bloco = i >= 0 ? code.slice(i, code.indexOf("\n}", i)) : "";
  check("a leitura do cache segue com a anon key (dado público)", /SUPABASE_ANON/.test(bloco));
}

// ─── 4. Nenhuma credencial privilegiada em fonte versionada ──────────────────────────────────
{
  const versionados = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean)
    .filter((p) => /\.(ts|js|mjs|json|html|yml|yaml|py)$/.test(p))
    .filter((p) => !p.startsWith(".claude/"));
  const vazando = [];
  for (const p of versionados) {
    let src;
    try { src = readFileSync(join(ROOT, p), "utf8"); } catch { continue; }
    // Um JWT do Supabase por si só NÃO é vazamento: a anon key é pública por desenho e aparece
    // legitimamente em vários scripts. O que importa é o PAPEL dentro do token. Sinalizar todo
    // JWT acusaria a chave pública e ensinaria a ignorar este gate.
    for (const m of src.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\./g)) {
      try {
        const claims = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
        if (claims.role && claims.role !== "anon") vazando.push(`${p} (role=${claims.role})`);
      } catch { /* não é um JWT decodificável — não é evidência de credencial privilegiada */ }
    }
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(src)) vazando.push(`${p} (sb_secret)`);
  }
  check("nenhuma credencial privilegiada em arquivo versionado", vazando.length === 0,
    vazando.slice(0, 3).join(", "));
}

// ─── 5. A migração continua no repositório, com rollback ─────────────────────────────────────
{
  check("migração 011 versionada", existsSync(join(ROOT, MIG)));
  if (existsSync(join(ROOT, MIG))) {
    const sql = readFileSync(join(ROOT, MIG), "utf8");
    const exec = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    check("remove a policy de INSERT para public", /drop policy[\s\S]*live_cache_write/i.test(exec));
    check("remove a policy de UPDATE para public", /drop policy[\s\S]*live_cache_update/i.test(exec));
    check("revoga escrita de anon explicitamente",
      /revoke[\s\S]*insert[\s\S]*update[\s\S]*delete[\s\S]*from anon/i.test(exec));
    check("mantém RLS habilitada", /enable row level security/i.test(exec));
    check("NÃO recria policy de escrita para public no caminho executável",
      !/create policy[\s\S]*live_cache_(write|update)/i.test(exec),
      "o rollback deve viver em comentário, nunca executar por engano");
    check("rollback documentado", /rollback/i.test(sql));
  }
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 LIVE_CACHE_WRITE_AUTHORITY FAILED");
  process.exit(1);
}
console.log("\n✓ LIVE_CACHE_WRITE_AUTHORITY PASSED");
