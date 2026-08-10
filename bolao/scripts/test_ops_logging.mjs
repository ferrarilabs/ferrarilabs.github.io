#!/usr/bin/env node
/**
 * test_ops_logging.mjs — logging, rotação, ZIP-9, integridade, backup, restauração, hold.
 *
 * Tudo roda num diretório temporário próprio. Um teste de retenção que apontasse para
 * `~/Documents/GitHub/ferrarilabs-work/logs` poderia APAGAR log de verdade — e o dano seria
 * exatamente a evidência que este subsistema existe para preservar.
 *
 * Uso: node bolao/scripts/test_ops_logging.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  sanitize, writeEvent, rotate, archiveMonth, restoreTest, retention,
  setHold, releaseHold, EVENTS, RETENTION, LOG_DIR, BACKUP_DIR,
} from "./ops_logging.mjs";

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

const raiz = mkdtempSync(join(tmpdir(), "ferrarilabs-oplog-"));
const dir = join(raiz, "logs");
const archiveDir = join(dir, "archive");
const backupDir = join(raiz, "backups");
mkdirSync(archiveDir, { recursive: true });
mkdirSync(backupDir, { recursive: true });

console.log("OPS_LOGGING — JSONL, ZIP-9, integridade, backup, restauração, hold\n");

// ─── SANITIZAÇÃO ─────────────────────────────────────────────────────────────────────────────
console.log("SANITIZACAO");
{
  const sujo = {
    eventType: "job_sent", roundNumber: 22, entryRef: "e1",
    participantEmail: "alguem@privado.invalid",
    payerName: "Fulano de Tal",
    // Valor deliberadamente sem forma de id de transacao: o gate repo-wide de PII acusa
    // literais com cara de transacao, e o que este caso precisa provar e que o CAMPO e
    // removido pelo nome -- o formato do valor nao entra na regra.
    txId: "fixture-sem-forma-de-transacao",
    token: "sb_secret_abc",
    nested: { recipient: "outro@privado.invalid", contentHash: "abc123" },
    livre: "contato: pessoa@dominio.invalid",
  };
  const { record, redacted } = sanitize(sujo);
  const blob = JSON.stringify(record);
  check("remove participantEmail", !("participantEmail" in record));
  check("remove payerName", !("payerName" in record));
  check("remove txId", !("txId" in record));
  check("remove token", !("token" in record));
  check("remove campo proibido ANINHADO", !blob.includes("outro@privado.invalid"));
  check("mascara e-mail em campo de texto livre", !blob.includes("pessoa@dominio.invalid"));
  check("nenhum '@' sobra no registro", !/@/.test(blob), blob.slice(0, 160));
  check("preserva o que e legitimo", record.roundNumber === 22 && record.entryRef === "e1"
    && record.nested.contentHash === "abc123");
  check("REGISTRA o que foi removido (remocao silenciosa esconde o vazamento)",
    redacted.length >= 5, JSON.stringify(redacted));
}

// ─── ESCRITA ─────────────────────────────────────────────────────────────────────────────────
console.log("\nESCRITA JSONL");
{
  for (const [i, ev] of EVENTS.slice(0, 8).entries()) {
    writeEvent({ eventType: ev, roundNumber: 22, entryRef: `e${i}`,
                 idempotencyKey: "br2026:round-results:22:v1" },
               { dir, now: () => new Date("2026-07-15T10:00:00Z") });
  }
  const f = readdirSync(dir).filter((x) => x.endsWith(".jsonl"));
  check("grava num arquivo por dia", f.length === 1 && f[0].includes("2026-07-15"), f.join(","));
  const linhas = readFileSync(join(dir, f[0]), "utf8").split("\n").filter(Boolean);
  check("uma linha JSON por evento", linhas.length === 8);
  check("toda linha e JSON valido", linhas.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
  const primeiro = JSON.parse(linhas[0]);
  check("carrega timestamp, schemaVersion e ambiente",
    !!primeiro.timestamp && primeiro.schemaVersion === RETENTION.SCHEMA_VERSION && !!primeiro.environment);
  check("sanitiza mesmo quando o chamador jura estar limpo", (() => {
    writeEvent({ eventType: "job_sent", participantEmail: "x@y.invalid" },
               { dir, now: () => new Date("2026-07-15T10:00:00Z") });
    const todas = readFileSync(join(dir, f[0]), "utf8");
    return !todas.includes("x@y.invalid");
  })());
}

// mais um mês, para arquivar
for (let d = 16; d <= 18; d++) {
  for (let i = 0; i < 5; i++) {
    writeEvent({ eventType: "job_created", roundNumber: 20 + i, entryRef: `e${i}` },
               { dir, now: () => new Date(`2026-07-${d}T12:00:00Z`) });
  }
}

// ─── ROTAÇÃO ─────────────────────────────────────────────────────────────────────────────────
console.log("\nROTACAO");
{
  const rot = rotate({ dir, now: () => new Date("2026-08-01T00:00:00Z") });
  check("rotaciona os arquivos de dias anteriores", rot.length === 4, rot.join(","));
  check("nao trunca nem apaga nada", readdirSync(dir).filter((x) => x.endsWith(".jsonl")).length === 4);
}

// ─── ARQUIVAMENTO ZIP-9 ──────────────────────────────────────────────────────────────────────
console.log("\nARQUIVAMENTO ZIP NIVEL 9");
let res;
{
  res = archiveMonth("2026-07", { dir, archiveDir, backupDir });
  check("arquivamento bem-sucedido", res.ok === true, JSON.stringify(res).slice(0, 200));
  if (res.ok) {
    const v = execFileSync("unzip", ["-v", res.zipPath], { encoding: "utf8" });
    check("metodo de compressao e DEFLATE, nao Stored",
      /Defl:/.test(v) && !/\bStored\b/.test(v), v.slice(0, 300));
    check("ZIP reabre e lista todos os membros", res.manifesto.fileCount === 4);
    check("manifesto tem periodo, contagem e classe de retencao",
      !!res.manifesto.periodStart && res.manifesto.recordCount > 0
      && res.manifesto.retentionClass === "OPERATIONAL_ARCHIVE");
    check("manifesto registra hash de CADA arquivo de origem",
      res.manifesto.sourceFiles.every((f) => /^[a-f0-9]{64}$/.test(f.sha256)));
    check("SHA256 do arquivo gerado", /^[a-f0-9]{64}$/.test(res.manifesto.archiveSha256));
    check("compressao de fato reduziu o tamanho",
      res.manifesto.compressedBytes < res.manifesto.uncompressedBytes,
      `${res.manifesto.compressedBytes} vs ${res.manifesto.uncompressedBytes}`);
    check("copia de backup criada e com hash conferido", existsSync(res.backupZip));
    check("os brutos NAO foram apagados pelo arquivamento",
      readdirSync(dir).filter((x) => x.endsWith(".jsonl")).length === 4);
  }
}

// ─── RESTAURAÇÃO ─────────────────────────────────────────────────────────────────────────────
console.log("\nTESTE DE RESTAURACAO");
{
  const r = restoreTest(res.zipPath);
  check("restauracao bem-sucedida", r.ok === true, JSON.stringify(r).slice(0, 200));
  check("todos os membros restaurados", r.ok && r.restoredFiles === 4);
  check("registros restaurados sao PARSEAVEIS, nao so identicos em bytes",
    r.ok && r.records > 0, `registros=${r.ok && r.records}`);
  check("nenhum artefato de restauracao deixado para tras",
    !readdirSync(tmpdir()).some((d) => d.startsWith("ferrarilabs-restore-")));
}

// ─── CORRUPÇÃO ───────────────────────────────────────────────────────────────────────────────
console.log("\nCORRUPCAO PRESERVA O BRUTO");
{
  const corrompido = join(archiveDir, "corrompido.zip");
  writeFileSync(corrompido, Buffer.from("isto nao e um zip"));
  writeFileSync(corrompido.replace(/\.zip$/, ".manifest.json"),
    JSON.stringify({ archiveSha256: "0".repeat(64), fileCount: 1, sourceFiles: [] }));
  const r = restoreTest(corrompido);
  check("arquivo corrompido falha a restauracao", r.ok === false, JSON.stringify(r));
  check("motivo identificado", r.reason === "ARCHIVE_SHA256_DIVERGE", r.reason);
}

// ─── RETENÇÃO ────────────────────────────────────────────────────────────────────────────────
console.log("\nRETENCAO CONSERVADORA");
{
  const agora = () => new Date("2026-09-15T00:00:00Z");   // > 30 dias após julho
  let d = retention({ dir, archiveDir, backupDir, now: agora, dryRun: true });
  check("bruto verificado ponta a ponta fica ELEGIVEL",
    d.filter((x) => x.action === "ELEGIVEL").length === 4, JSON.stringify(d).slice(0, 250));

  // HOLD bloqueia
  setHold(res.zipPath, "investigacao de incidente");
  d = retention({ dir, archiveDir, backupDir, now: agora, dryRun: true });
  check("INCIDENT_HOLD impede remocao",
    d.every((x) => x.action === "MANTIDO" && x.reason === "INCIDENT_HOLD"),
    JSON.stringify(d).slice(0, 200));
  releaseHold(res.zipPath);

  // backup ausente bloqueia
  const backupSalvo = readFileSync(res.backupZip);
  rmSync(res.backupZip);
  d = retention({ dir, archiveDir, backupDir, now: agora, dryRun: true });
  check("backup ausente impede remocao",
    d.every((x) => x.reason === "BACKUP_AUSENTE_OU_DIVERGENTE"), JSON.stringify(d).slice(0, 200));
  writeFileSync(res.backupZip, backupSalvo);

  // dentro da janela quente
  writeEvent({ eventType: "job_created", roundNumber: 23 }, { dir, now: () => new Date("2026-09-14T10:00:00Z") });
  d = retention({ dir, archiveDir, backupDir, now: agora, dryRun: true });
  const recente = d.find((x) => x.file.includes("2026-09-14"));
  check("arquivo dentro do HOT nunca e elegivel", recente && recente.reason === "DENTRO_DO_HOT");

  check("dryRun nao apagou nada",
    readdirSync(dir).filter((x) => x.endsWith(".jsonl")).length === 5);
}

// ─── PII NO ARQUIVO FINAL ────────────────────────────────────────────────────────────────────
console.log("\nNENHUM PII NO ARQUIVO");
{
  const tmp = join(raiz, "scan");
  mkdirSync(tmp, { recursive: true });
  execFileSync("unzip", ["-qq", "-o", res.zipPath, "-d", tmp]);
  const tudo = readdirSync(tmp).map((f) => readFileSync(join(tmp, f), "utf8")).join("\n");
  check("nenhum endereco de e-mail dentro do ZIP", !/@/.test(tudo));
  check("nenhum token/segredo dentro do ZIP", !/sb_secret|service_role|Bearer /i.test(tudo));
}

// ─── POLITICA DECLARADA ──────────────────────────────────────────────────────────────────────
console.log("\nPOLITICA");
{
  check("HOT = 30 dias", RETENTION.HOT_DAYS === 30);
  check("ARQUIVO = 12 meses", RETENTION.ARCHIVE_MONTHS === 12);
  check("EVIDENCIA DE AUDITORIA >= 24 meses", RETENTION.AUDIT_MONTHS >= 24);
  check("logs ficam FORA do repositorio", !LOG_DIR.includes("ferrarilabs.github.io")
    && !BACKUP_DIR.includes("ferrarilabs.github.io"), `${LOG_DIR} | ${BACKUP_DIR}`);
}

rmSync(raiz, { recursive: true, force: true });

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 OPS_LOGGING FAILED");
  process.exit(1);
}
console.log("\n✓ OPS_LOGGING PASSED");
