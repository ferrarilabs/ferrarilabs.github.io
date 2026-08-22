// audit_pii_tests.mjs — P0.1 PII regression guard (2026-08 hotfix)
//
// Fails (exit 1) if any file that gets published to GitHub Pages (i.e. not
// gitignored, not a log/backup dir) contains:
//   1. an "email:" or "txId:" field inside bolao/loterias/powerball/js/data.js
//   2. any email address that is not on the small allowlist (the site owner's
//      own public contact address, or a synthetic *@example.invalid / *@example.com
//      fixture address)
//   3. any of the known real transaction IDs that were previously public in data.js
//
// This does not scan git history — see the P0.1 summary for the HISTORY_EXPOSURE
// note (history scrub is out of scope for this hotfix, tracked separately).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

// Um placeholder com domínio `email.com` foi REMOVIDO desta allowlist em 2026-08-09. Ele se
// justificava por exemplos de query no AUDIT_LOGGING.md que não existem mais (verificado), e
// `email.com` é domínio REAL — a suíte do gate repo-wide inclusive tem uma regressão afirmando que
// ele nunca pode entrar em allowlist. Entrada obsoleta afrouxa o detector em troca de nada.
// (O endereço em si não é citado aqui de propósito: escrevê-lo no comentário o reintroduziria no
// arquivo, que é exatamente o que o teste de privacidade de fixture procura.)
const ALLOWED_EMAILS = new Set([
  "emferrari@gmail.com", // site owner — already the public admin contact everywhere
]);

const ALLOWED_EMAIL_SUFFIXES = [
  "@example.invalid",
  "@example.com",
];

// txIds that were confirmed present in data.js before the P0.1 strip — if any of
// these show up again in a scanned file, something re-introduced real PII.
const KNOWN_REAL_TX_IDS = [
  "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE",
  "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE",
  "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE",
  "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE",
];

const IGNORE_FILES = new Set([
  "audit_pii_tests.mjs", // this file — its own allowlist source (KNOWN_REAL_TX_IDS) would self-flag
]);

// ─── PII_SCAN_SCOPE (reescrito 2026-08-09) ──────────────────────────────────────────────────
//
// ANTES: `walk()` percorria o filesystem, pulando só uma lista fixa de nomes (`logs`,
// `node_modules`, um sidecar específico). Isso confundia duas perguntas MUITO diferentes:
//
//     "existe PII em algum lugar do meu disco?"          ← o que ele media
//     "PII pode entrar no artefato público?"             ← o que ele deveria medir
//
// Consequência prática, reproduzida em 2026-08-09: um artefato de e-mail em
// `scripts/email/generated/` — diretório coberto pelo .gitignore, não rastreado, nunca
// publicado, evidência operacional legítima de um envio real — fazia o gate falhar. Um gate que
// falha por evidência privada correta acaba sendo desligado ou contornado, e aí para de proteger
// o que importa.
//
// AGORA o conjunto é o mesmo que o Git considera publicável:
//
//     rastreados            (git ls-files --cached)
//   + não rastreados        (--others)
//   − ignorados             (--exclude-standard)
//
// Os "não rastreados e não ignorados" são essenciais e é por isso que NÃO basta olhar só os
// rastreados: um arquivo novo com PII, ainda sem `git add`, é exatamente o que um gate de
// pré-commit precisa pegar — e olhar só o índice o deixaria passar.
//
// Nada de exceção fixa para `scripts/email/generated/`: a política segue a intenção declarada no
// .gitignore, então qualquer futuro diretório de evidência privada já nasce coberto, sem editar
// este arquivo. E se alguém remover a entrada do .gitignore, o conteúdo volta a ser escaneado
// automaticamente — que é o comportamento correto, porque aí ele passou a ser publicável.
export function publishableFiles(root) {
  const out = execFileSync(
    "git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split("\0")
    .filter(Boolean)
    .filter((rel) => !IGNORE_FILES.has(path.basename(rel)))
    // Um caminho pode constar do índice e já ter sido apagado do disco (`git rm` ainda não
    // commitado). Ler isso lançaria; e um arquivo que não existe não publica nada.
    .filter((rel) => fs.existsSync(path.join(root, rel)))
    .map((rel) => path.join(root, rel));
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function isAllowedEmail(addr) {
  if (ALLOWED_EMAILS.has(addr)) return true;
  return ALLOWED_EMAIL_SUFFIXES.some((suf) => addr.endsWith(suf));
}

export function main() {
  const files = publishableFiles(ROOT);
  const failures = [];

  const dataJsPath = path.join(ROOT, "js", "data.js");
  if (fs.existsSync(dataJsPath)) {
    const dataJs = fs.readFileSync(dataJsPath, "utf8");
    if (/\bemail\s*:/.test(dataJs)) {
      failures.push("js/data.js contains an 'email:' field — this file is public and must never carry participant emails.");
    }
    if (/\btxId\s*:/.test(dataJs)) {
      failures.push("js/data.js contains a 'txId:' field — this file is public and must never carry transaction IDs.");
    }
  } else {
    failures.push("js/data.js not found — cannot verify PII was removed.");
  }

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue; // binary or unreadable — skip
    }
    const rel = path.relative(ROOT, file);

    const emails = content.match(EMAIL_RE) || [];
    for (const addr of emails) {
      if (!isAllowedEmail(addr)) {
        failures.push(`${rel}: contains non-allowlisted email address (masked: ${addr[0]}***@${addr.split("@")[1] || "?"})`);
      }
    }

    for (const txId of KNOWN_REAL_TX_IDS) {
      if (content.includes(txId)) {
        failures.push(`${rel}: contains a known real transaction ID (masked: ${txId.slice(0, 3)}***)`);
      }
    }
  }

  // ── O secret legado nao volta a ser banco de pagamentos (Issue #303-B) ───────────────────────
  //
  // Os dois escritores do sidecar privado gravavam `{email, txId}`. O `txId` saiu: um GitHub secret
  // nao tem transacao, constraint, trilha de auditoria nem estorno, e corrigir uma entrada errada
  // significava reescrever o blob a mao. A autoridade e `lottery_payment_transactions`.
  //
  // Sem este gate, a linha volta na primeira vez que alguem quiser "so guardar a referencia junto".
  // O alvo e a ATRIBUICAO ao sidecar, nao a palavra `txId` no arquivo — os dois scripts ainda
  // aceitam `--tx-id` do operador de forma legitima, e proibir a palavra reprovaria o proprio
  // aviso que manda registrar no banco.
  const ESCRITORES_DO_SIDECAR = [
    // A linha inteira da atribuicao. Indexar por `[p['name']]` tem colchete DENTRO de colchete,
    // entao um `[^\]]+` por nivel para de casar na primeira chave aninhada — e um gate que nao
    // acha o alvo fica verde igual a um gate satisfeito. Por isso o alvo e a linha, nao a estrutura.
    { rel: "scripts/add_participants.py", re: /^[ \t]*sidecar\[.*?=\s*\{[^}]*\}/gm },
    { rel: "scripts/add-participant.js",  re: /^[ \t]*privateSidecar\[.*?=\s*\{[^}]*\}/gm },
  ];

  for (const { rel, re } of ESCRITORES_DO_SIDECAR) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { failures.push(`${rel}: escritor do sidecar sumiu — este gate ficaria cego`); continue; }
    const src = fs.readFileSync(abs, "utf-8");
    const atribuicoes = src.match(re) || [];
    if (atribuicoes.length === 0) {
      failures.push(`${rel}: nenhuma atribuicao ao sidecar reconhecida — o gate parou de encontrar seu alvo, ` +
                    `o que e indistinguivel de um gate satisfeito`);
      continue;
    }
    for (const a of atribuicoes) {
      if (/txId/.test(a)) {
        failures.push(`${rel}: o sidecar privado voltou a gravar txId — o secret nao e banco de ` +
                      `pagamentos (Issue #303-B). Registre em lottery_payment_transactions.`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("❌ PII AUDIT FAILED\n");
    for (const f of failures) console.error("  - " + f);
    console.error(`\n${failures.length} failure(s).`);
    process.exit(1);
  }

  console.log(`✓ PII audit passed — scanned ${files.length} files under ${path.relative(process.cwd(), ROOT)}, no public PII found.`);
}

// Só executa quando chamado diretamente — importar este módulo (o meta-teste faz isso para
// exercitar `publishableFiles`) não pode disparar o gate nem chamar process.exit().
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
