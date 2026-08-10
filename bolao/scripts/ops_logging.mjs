#!/usr/bin/env node
/**
 * ops_logging.mjs — logging operacional estruturado, rotação, arquivamento e retenção.
 *
 * ─── ONDE ISTO VIVE, E POR QUÊ ───────────────────────────────────────────────────────────────
 *
 * Logs operacionais NÃO entram no Git e NÃO entram na árvore publicada. Um log commitado vira
 * histórico permanente e imutável — e este log descreve notificações a pessoas reais. Ficam em
 * `~/Documents/GitHub/ferrarilabs-work/logs`, com arquivos e backups em `.../backups`.
 *
 * ─── O QUE NUNCA PODE ENTRAR ─────────────────────────────────────────────────────────────────
 *
 * endereço de e-mail, nome de participante, nome de pagador, id de transação, token, PAT,
 * material de service-role. O que entra é id opaco de entrada, número de rodada, chave de
 * idempotência (que por contrato não contém PII), estado de job, disposição do provedor,
 * carimbos, saúde de fonte e metadados de execução.
 *
 * `sanitize()` não é decoração: ele REMOVE o campo e registra a remoção. Um log que confia no
 * chamador para não vazar acaba vazando — basta um campo novo.
 *
 * ─── SEQUÊNCIA DE ARQUIVAMENTO ───────────────────────────────────────────────────────────────
 *
 * Nada é apagado antes de: hash do bruto → ZIP nível 9 → reabrir → conferir membros → conferir
 * hash de cada membro → manifesto → SHA256 do arquivo → cópia de backup → verificar backup →
 * teste de restauração. Se qualquer passo falhar, o bruto FICA. Perder log por otimismo de
 * automação é perder justamente a evidência de que algo deu errado.
 *
 * Uso:
 *   node bolao/scripts/ops_logging.mjs rotate
 *   node bolao/scripts/ops_logging.mjs archive [--month=YYYY-MM]
 *   node bolao/scripts/ops_logging.mjs retention
 *   node bolao/scripts/ops_logging.mjs restore-test <archive.zip>
 *   node bolao/scripts/ops_logging.mjs hold <archive.zip> "motivo"
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync,
  statSync, unlinkSync, rmSync, renameSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, basename } from "node:path";

export const WORK = join(homedir(), "Documents", "GitHub", "ferrarilabs-work");
export const LOG_DIR = join(WORK, "logs");
export const ARCHIVE_DIR = join(LOG_DIR, "archive");
export const BACKUP_DIR = join(WORK, "backups");

export const RETENTION = Object.freeze({
  HOT_DAYS: 30,              // JSONL cru, imediatamente legível
  ARCHIVE_MONTHS: 12,        // ZIP nível 9
  AUDIT_MONTHS: 24,          // evidência compacta de notificação
  SCHEMA_VERSION: 1,
});

/** Campos que jamais podem ser persistidos, por nome. */
const PROIBIDOS = [
  "email", "participantEmail", "participant_email", "to_email", "recipient",
  "payerName", "payer_name", "name", "participantName",
  "txId", "transactionId", "transaction_id", "receiptCode",
  "token", "apiKey", "api_key", "password", "secret", "serviceRole", "service_role",
  "authorization", "apikey", "pat",
];

const PARECE_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Remove o proibido e REGISTRA a remoção. Devolve { record, redacted[] }.
 * Recursivo: um campo proibido aninhado vaza igual a um de topo.
 */
export function sanitize(value, path = "") {
  const redacted = [];
  function walk(v, p) {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (PROIBIDOS.some((b) => k.toLowerCase() === b.toLowerCase())) {
          redacted.push(`${p}${p ? "." : ""}${k}`);
          continue;
        }
        out[k] = walk(val, `${p}${p ? "." : ""}${k}`);
      }
      return out;
    }
    if (typeof v === "string" && PARECE_EMAIL.test(v)) {
      redacted.push(`${p} (valor com forma de e-mail)`);
      return "[REDACTED_EMAIL]";
    }
    return v;
  }
  return { record: walk(value, path), redacted };
}

export const EVENTS = Object.freeze([
  "round_reconcile_started", "round_reconcile_completed", "round_candidate_found",
  "job_created", "job_claimed", "job_lease_expired", "job_send_started",
  "recipient_accepted", "recipient_failed", "job_partial", "job_retry_scheduled",
  "job_sent", "job_failed", "job_manual_review_required",
  "gateway_degraded", "cache_invalid",
  "backup_started", "backup_verified", "restore_verified",
  "log_rotated", "log_archive_created", "log_archive_verified",
  "log_archive_backup_verified", "log_retention_delete", "log_retention_skipped_hold",
]);

function ensureDirs() {
  for (const d of [LOG_DIR, ARCHIVE_DIR, BACKUP_DIR]) mkdirSync(d, { recursive: true });
}

export function logFileFor(date = new Date()) {
  return join(LOG_DIR, `br2026-round-email-${date.toISOString().slice(0, 10)}.jsonl`);
}

/** Escreve um evento. Sanitiza SEMPRE, mesmo que o chamador jure que está limpo. */
export function writeEvent(event, { now = () => new Date(), dir = LOG_DIR } = {}) {
  mkdirSync(dir, { recursive: true });
  const ts = now();
  const { record, redacted } = sanitize(event);
  const linha = JSON.stringify({
    timestamp: ts.toISOString(),
    schemaVersion: RETENTION.SCHEMA_VERSION,
    environment: process.env.GITHUB_ACTIONS ? "ci" : "local",
    runId: process.env.GITHUB_RUN_ID || null,
    ...record,
    ...(redacted.length ? { _redactedFields: redacted } : {}),
  });
  appendFileSync(join(dir, basename(logFileFor(ts))), linha + "\n", "utf8");
  return { linha, redacted };
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function sha256Buf(b) {
  return createHash("sha256").update(b).digest("hex");
}

/** Rotação: fecha o arquivo do dia anterior, ou qualquer um acima do teto de tamanho. */
export function rotate({ dir = LOG_DIR, maxBytes = 25 * 1024 * 1024, now = () => new Date() } = {}) {
  ensureDirs();
  const hoje = basename(logFileFor(now()));
  const rotacionados = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    const full = join(dir, f);
    const grande = statSync(full).size >= maxBytes;
    if (f === hoje && !grande) continue;
    if (grande && f === hoje) {
      // Rotação por tamanho: renomeia com sufixo, nunca trunca o ativo.
      const alvo = full.replace(/\.jsonl$/, `.${Date.now()}.jsonl`);
      renameSync(full, alvo);
      rotacionados.push(basename(alvo));
      continue;
    }
    rotacionados.push(f);
  }
  return rotacionados;
}

/**
 * Arquiva um mês inteiro. Executa a sequência segura completa e devolve o relatório.
 * NÃO apaga nada — a elegibilidade para remoção é decidida por `retention()`.
 */
export function archiveMonth(mes, { dir = LOG_DIR, archiveDir = ARCHIVE_DIR, backupDir = BACKUP_DIR } = {}) {
  ensureDirs();
  const membros = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && f.includes(mes))
    .sort();
  if (!membros.length) return { ok: false, reason: "SEM_ARQUIVOS_NO_PERIODO", mes };

  // 1. hash do bruto ANTES de qualquer coisa
  const origem = membros.map((f) => {
    const full = join(dir, f);
    return { relativePath: f, bytes: statSync(full).size, sha256: sha256File(full) };
  });
  const registros = membros.reduce((n, f) =>
    n + readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).length, 0);

  // 2. ZIP DEFLATE nível 9. `-9` é o nível máximo do deflate; `-X` remove metadados extras que
  //    variariam entre máquinas e atrapalhariam a reprodutibilidade do hash.
  const zipPath = join(archiveDir, `br2026-round-email-logs-${mes}.zip`);
  if (existsSync(zipPath)) unlinkSync(zipPath);
  execFileSync("zip", ["-9", "-X", "-q", "-j", zipPath, ...membros.map((f) => join(dir, f))]);

  // 3-4. reabrir e conferir membros + método de compressão
  const listagem = execFileSync("unzip", ["-v", zipPath], { encoding: "utf8" });
  const membrosNoZip = listagem.split("\n")
    .map((l) => l.trim().split(/\s+/).pop())
    .filter((n) => n && n.endsWith(".jsonl"));
  const faltando = membros.filter((m) => !membrosNoZip.includes(m));
  if (faltando.length) return { ok: false, reason: "MEMBRO_AUSENTE", faltando, zipPath };
  const metodoOk = /Defl:N|Defl:X/.test(listagem);
  const semCompressao = /\bStored\b/.test(listagem);
  if (!metodoOk || semCompressao) {
    return { ok: false, reason: "COMPRESSAO_NAO_E_DEFLATE", listagem: listagem.slice(0, 400), zipPath };
  }

  // 5. integridade por membro: extrai e compara hash com o bruto
  const tmp = join(tmpdir(), `ferrarilabs-verify-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    execFileSync("unzip", ["-qq", "-o", zipPath, "-d", tmp]);
    for (const o of origem) {
      const h = sha256File(join(tmp, o.relativePath));
      if (h !== o.sha256) return { ok: false, reason: "HASH_DE_MEMBRO_DIVERGE", membro: o.relativePath, zipPath };
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 6-7. manifesto + SHA256 do arquivo
  const comprimido = statSync(zipPath).size;
  const bruto = origem.reduce((n, o) => n + o.bytes, 0);
  const manifesto = {
    schemaVersion: RETENTION.SCHEMA_VERSION,
    archiveName: basename(zipPath),
    createdAt: new Date().toISOString(),
    policyVersion: `hot${RETENTION.HOT_DAYS}d/arch${RETENTION.ARCHIVE_MONTHS}m/audit${RETENTION.AUDIT_MONTHS}m`,
    retentionClass: "OPERATIONAL_ARCHIVE",
    periodStart: `${mes}-01`,
    periodEnd: mes,
    dateRange: [membros[0], membros[membros.length - 1]],
    fileCount: origem.length,
    recordCount: registros,
    uncompressedBytes: bruto,
    compressedBytes: comprimido,
    compressionRatio: bruto ? +(comprimido / bruto).toFixed(4) : null,
    compressionMethod: "DEFLATE-9",
    holdStatus: "NONE",
    sourceFiles: origem,
    archiveSha256: sha256File(zipPath),
  };
  const manifestoPath = zipPath.replace(/\.zip$/, ".manifest.json");
  writeFileSync(manifestoPath, JSON.stringify(manifesto, null, 2) + "\n");

  // 8-9. backup + verificação do backup
  const backupZip = join(backupDir, basename(zipPath));
  writeFileSync(backupZip, readFileSync(zipPath));
  writeFileSync(backupZip.replace(/\.zip$/, ".manifest.json"), readFileSync(manifestoPath));
  const backupOk = sha256File(backupZip) === manifesto.archiveSha256;
  if (!backupOk) return { ok: false, reason: "BACKUP_HASH_DIVERGE", zipPath, backupZip };

  return { ok: true, zipPath, manifestoPath, backupZip, manifesto };
}

/** Teste de restauração. Um backup nunca restaurado não é um backup verificado. */
export function restoreTest(zipPath) {
  const manifestoPath = zipPath.replace(/\.zip$/, ".manifest.json");
  if (!existsSync(manifestoPath)) return { ok: false, reason: "MANIFESTO_AUSENTE" };
  const manifesto = JSON.parse(readFileSync(manifestoPath, "utf8"));

  if (sha256File(zipPath) !== manifesto.archiveSha256) {
    return { ok: false, reason: "ARCHIVE_SHA256_DIVERGE" };
  }

  const tmp = join(tmpdir(), `ferrarilabs-restore-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    execFileSync("unzip", ["-qq", "-o", zipPath, "-d", tmp]);
    const restaurados = readdirSync(tmp);
    if (restaurados.length !== manifesto.fileCount) {
      return { ok: false, reason: "CONTAGEM_DE_MEMBROS_DIVERGE",
               esperado: manifesto.fileCount, obtido: restaurados.length };
    }
    let registros = 0;
    for (const o of manifesto.sourceFiles) {
      const full = join(tmp, o.relativePath);
      if (!existsSync(full)) return { ok: false, reason: "MEMBRO_NAO_RESTAURADO", membro: o.relativePath };
      if (sha256File(full) !== o.sha256) {
        return { ok: false, reason: "HASH_RESTAURADO_DIVERGE", membro: o.relativePath };
      }
      // Prova que o conteúdo é LEGÍVEL, não só que os bytes batem.
      for (const linha of readFileSync(full, "utf8").split("\n").filter(Boolean)) {
        const evt = JSON.parse(linha);
        if (!evt.timestamp || !evt.eventType) {
          return { ok: false, reason: "REGISTRO_SEM_CAMPOS_CANONICOS", membro: o.relativePath };
        }
        registros++;
      }
    }
    return { ok: true, restoredFiles: restaurados.length, records: registros, manifesto };
  } finally {
    rmSync(tmp, { recursive: true, force: true });   // nunca deixa artefato de restauração para trás
  }
}

/** Marca um arquivo como retido por incidente/auditoria. Retenção nunca apaga o que está em HOLD. */
export function setHold(zipPath, motivo) {
  const manifestoPath = zipPath.replace(/\.zip$/, ".manifest.json");
  const m = JSON.parse(readFileSync(manifestoPath, "utf8"));
  m.holdStatus = "HOLD";
  m.holdReason = motivo;
  m.holdSetAt = new Date().toISOString();
  writeFileSync(manifestoPath, JSON.stringify(m, null, 2) + "\n");
  return m;
}

export function releaseHold(zipPath) {
  const manifestoPath = zipPath.replace(/\.zip$/, ".manifest.json");
  const m = JSON.parse(readFileSync(manifestoPath, "utf8"));
  m.holdStatus = "NONE";
  m.holdReleasedAt = new Date().toISOString();
  writeFileSync(manifestoPath, JSON.stringify(m, null, 2) + "\n");
  return m;
}

/**
 * Remoção conservadora. Um bruto só some se estiver arquivado, verificado, com backup verificado
 * e restauração comprovada — e o arquivo correspondente não estiver em HOLD.
 */
export function retention({ dir = LOG_DIR, archiveDir = ARCHIVE_DIR, backupDir = BACKUP_DIR,
                            now = () => new Date(), dryRun = true } = {}) {
  ensureDirs();
  const limite = new Date(now().getTime() - RETENTION.HOT_DAYS * 86400_000);
  const decisoes = [];

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    const m = f.match(/(\d{4}-\d{2})-\d{2}/);
    if (!m) { decisoes.push({ file: f, action: "MANTIDO", reason: "NOME_SEM_DATA" }); continue; }
    const dataArquivo = new Date(f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
    if (dataArquivo >= limite) { decisoes.push({ file: f, action: "MANTIDO", reason: "DENTRO_DO_HOT" }); continue; }

    const zip = join(archiveDir, `br2026-round-email-logs-${m[1]}.zip`);
    const manifestoPath = zip.replace(/\.zip$/, ".manifest.json");
    if (!existsSync(zip) || !existsSync(manifestoPath)) {
      decisoes.push({ file: f, action: "MANTIDO", reason: "NAO_ARQUIVADO" });
      continue;
    }
    const manifesto = JSON.parse(readFileSync(manifestoPath, "utf8"));
    if (manifesto.holdStatus === "HOLD") {
      decisoes.push({ file: f, action: "MANTIDO", reason: "INCIDENT_HOLD" });
      continue;
    }
    const backupZip = join(backupDir, basename(zip));
    if (!existsSync(backupZip) || sha256File(backupZip) !== manifesto.archiveSha256) {
      decisoes.push({ file: f, action: "MANTIDO", reason: "BACKUP_AUSENTE_OU_DIVERGENTE" });
      continue;
    }
    const restauracao = restoreTest(zip);
    if (!restauracao.ok) {
      decisoes.push({ file: f, action: "MANTIDO", reason: `RESTAURACAO_FALHOU:${restauracao.reason}` });
      continue;
    }
    if (!dryRun) unlinkSync(join(dir, f));
    decisoes.push({ file: f, action: dryRun ? "ELEGIVEL" : "REMOVIDO", reason: "VERIFICADO_PONTA_A_PONTA" });
  }
  return decisoes;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────
// `endsWith` seria verdadeiro para test_ops_logging.mjs tambem -- e o teste, ao importar este
// modulo, imprimiria o texto de uso e sairia com codigo 1 antes de rodar assercao nenhuma.
// Comparacao por basename exato.
const ehCli = process.argv[1] && basename(process.argv[1]) === "ops_logging.mjs";
if (ehCli) {
  const [cmd, ...args] = process.argv.slice(2);
  const mesArg = (args.find((a) => a.startsWith("--month=")) || "").split("=")[1];
  if (cmd === "rotate") console.log(JSON.stringify(rotate(), null, 2));
  else if (cmd === "archive") console.log(JSON.stringify(archiveMonth(mesArg || new Date().toISOString().slice(0, 7)), null, 2));
  else if (cmd === "retention") console.log(JSON.stringify(retention({ dryRun: !args.includes("--apply") }), null, 2));
  else if (cmd === "restore-test") console.log(JSON.stringify(restoreTest(args[0]), null, 2));
  else if (cmd === "hold") console.log(JSON.stringify(setHold(args[0], args[1] || "sem motivo"), null, 2));
  else {
    console.log("uso: rotate | archive [--month=YYYY-MM] | retention [--apply] | restore-test <zip> | hold <zip> <motivo>");
    process.exit(1);
  }
}
