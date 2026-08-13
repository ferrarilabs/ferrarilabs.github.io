#!/usr/bin/env node
import { createHash } from "node:crypto";
/**
 * PII / secret detector engine.
 *
 * Extracted from audit_pii_repo_wide.mjs so it can be tested. The original was a single main()
 * with no exports, which is why it had no regression suite and why nobody noticed it had been
 * failing on its own test fixtures — a gate whose result is always RED is a gate that gets ignored,
 * which is the same vacuity problem as a gate that is always GREEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS FILE FIXES
 *
 * A detector cannot distinguish a leaked value from a fixture that deliberately looks like one.
 * The previous answer was SELF_EXCLUDE: a hand-maintained list of file paths that are skipped
 * ENTIRELY. That is the wrong shape twice over —
 *
 *   · it is a one-off exception that grows every time a new test file is written, and
 *   · skipping a file wholesale means a file excused for its PEM fixture is also excused for a
 *     real leaked email it acquires two years later.
 *
 * Three mechanisms replace it, in order of strength:
 *
 *   1. RESERVED_SYNTHETIC — a property of the VALUE, not the file. A value living in an
 *      RFC-reserved space or this repo's declared synthetic namespace is provably not real, so no
 *      file-level permission is involved and none can be forged by editing a header.
 *
 *   2. SCHEMA_DECLARATION — a structural parsing fix. `email: "text"` inside a table definition
 *      is a column TYPE, not an address. Fixed by recognising the shape, in the same way earlier
 *      false-positive scans were fixed structurally rather than by allowlisting the case.
 *
 *   3. DECLARED_FIXTURE — a per-DETECTOR declaration inside the file, with a reason. A file that
 *      declares it holds `private-key-material` fixtures still FAILS on a leaked email. And a
 *      declaration whose detector never fires is itself reported, so stale permissions are deleted
 *      rather than left to rot.
 *
 * Values are never printed. Only path, detector, count and a masked preview.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. RESERVED SYNTHETIC SPACE — provably-not-real values
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Domains reserved by RFC 2606 / RFC 6761 for documentation, examples and testing. A real person's
 * address cannot exist in these, so a match is never a leak. This is the whole basis for treating
 * the value as safe without trusting anything about the file it lives in.
 */
export const RESERVED_EMAIL_SUFFIXES = [
  ".invalid", ".test", ".example", ".localhost",
  "@example.com", "@example.net", "@example.org",
];

// `@email.com` ESTAVA nesta lista, descrito como "legacy placeholder". Foi REMOVIDO na integracao
// cross-workstream de 2026-08-12, porque email.com e um dominio de webmail VIVO: allowlista-lo
// suprimia silenciosamente 11 enderecos de dominio real. Ruido e irritante; silencio e perigoso.
//
// A remocao veio do gate equivalente que vivia em scripts/audit_pii_repo_wide.mjs em main — os dois
// workstreams editaram esta mesma superficie e so main tinha a correcao. Reintroduzir `@email.com`
// aqui reabre um FALSO NEGATIVO ja medido. `scripts/test_audit_pii_repo_wide.mjs` tranca isso com
// "someone@email.com" na lista REAL, e falhara se alguem devolver o sufixo.
//
// Regra: so nomes reservados por RFC 2606 / RFC 6761 pertencem a esta lista.

/**
 * This repo's declared synthetic namespace for reference-shaped identifiers. A fixture MUST use one
 * of these prefixes; a real payment reference never would. Enforcing a prefix is what lets the
 * scanner accept the value on its own merits.
 */
export const SYNTHETIC_REF_PREFIXES = ["SYNTH", "SYNTHETIC", "FIXTURE", "SAMPLE", "PLACEHOLDER", "REDACTED"];
const SYNTHETIC_REF_RE = new RegExp(`^(?:${SYNTHETIC_REF_PREFIXES.join("|")})[-_]`, "i");

/** Reserved stand-ins for a secret in a connection string. */
export const RESERVED_SECRET_TOKENS = new Set(["x", "xxx", "redacted", "synthetic", "placeholder", "secret-not-real"]);

/** Bare SQL type keywords. `email: "text"` is a column declaration, not an address. */
const SQL_TYPE_KEYWORDS = new Set([
  "text", "uuid", "boolean", "bool", "int", "integer", "bigint", "smallint", "serial", "bigserial",
  "date", "time", "timestamp", "timestamptz", "interval", "json", "jsonb", "bytea", "inet",
  "citext", "money", "real", "float", "double precision", "char", "varchar", "numeric", "decimal",
]);

const isSqlType = (v) => {
  const s = String(v).trim().toLowerCase();
  return SQL_TYPE_KEYWORDS.has(s) || /^(?:numeric|decimal|varchar|char)\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\)$/.test(s);
};

/**
 * Addresses that are DELIBERATELY PUBLISHED. The site owner's contact address appears on the public
 * website, in the contact form and in operational runbooks by design — reporting it as a leak is
 * reporting a published fact.
 *
 * This is an allowlist, and allowlists are the thing this file exists to avoid, so it is bounded by
 * two rules the test suite enforces: an entry is a specific full address (never a domain, which
 * would excuse every future address at that provider), and the list is asserted to hold exactly the
 * addresses that are actually published. Growing it is a visible, reviewable change.
 */
export const PUBLISHED_CONTACTS = new Set([
  // The operator's own address. Deliberately allowlisted, and NOT a secret — but the reason
  // recorded here was wrong, so it is restated from measurement (FDC-20260813, decision D-A):
  //
  //   · it does NOT appear in any `.html`, and fetching www.ferrarilabs.com and
  //     ferrarilabs.github.io returns 0 occurrences. The site's contact path is the Formspree
  //     form, not a mailto. The previous comment claimed "on every language version of the site";
  //     that has not been true for as long as the current index pages have existed.
  //   · it DOES appear 55 times across 30 files in this public repository: `adminEmail` in four
  //     `config.js`, `ADMIN_EMAIL` in five operator send scripts, 19 recipient records in
  //     Powerball's `outbox.json`, and documentation.
  //   · it is never compared against anything. `adminEmail` is only ever an EmailJS `to_email`.
  //     The admin boundary is `adminPasswordHash`, which is a SHA-256 digest.
  //
  // Allowlisting it is still correct: it is the operator's own mailbox, published in the
  // operator's own repository, and treating it as a leak would make this detector cry wolf on
  // every run. Allowlisting it for an inaccurate reason is what this edit fixes.
  "emferrari@gmail.com",
]);

export function isReservedEmail(addr) {
  const a = String(addr).toLowerCase();
  if (PUBLISHED_CONTACTS.has(a)) return true;
  return RESERVED_EMAIL_SUFFIXES.some((suf) => a.endsWith(suf));
}

export function isSyntheticReference(value) { return SYNTHETIC_REF_RE.test(String(value).trim()); }

/**
 * Classify a candidate value independently of the file it came from.
 * Returns null when the value is NOT provably synthetic — the caller then decides.
 */
export function classifyValue(detector, value) {
  const v = String(value);
  if (v.includes("*")) return "ALREADY_MASKED";
  if (v.trim() === "" || v.trim() === "—" || v.trim() === "-") return "EMPTY";

  switch (detector) {
    case "email-address":
    case "email-field-literal":
      if (isSqlType(v)) return "SCHEMA_DECLARATION";
      // A value with no address shape cannot be a leaked address. `{ email: "x" }` in a test that
      // checks the KEY name is forbidden is not a leak, and reporting it teaches reviewers that this
      // detector cries wolf. Nothing is lost: a real address always has a local part, an @ and a
      // dotted TLD, so anything failing this test could not have been one.
      if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(v.trim())) return "NOT_ADDRESS_SHAPED";
      if (isReservedEmail(v)) return "RESERVED_SYNTHETIC";
      return null;
    case "txId-field-literal":
    case "confirmationId-field-literal":
    case "external-reference-field-literal":
      if (isSqlType(v)) return "SCHEMA_DECLARATION";
      if (isSyntheticReference(v)) return "RESERVED_SYNTHETIC";
      return null;
    case "url-with-embedded-credential": {
      const m = /:\/\/[^:\s/]+:([^@\s/]+)@/.exec(v);
      if (m && RESERVED_SECRET_TOKENS.has(m[1].toLowerCase())) return "RESERVED_SYNTHETIC";
      return null;
    }
    case "zelle-like-tx-id":
      if (/^(\d)\1+$/.test(v)) return "RESERVED_SYNTHETIC"; // a repeated digit is never a real ref
      return null;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. DETECTORS
// ─────────────────────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = () => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * `field: "literal"`. Anchored on an object-literal delimiter or line start so prose in a comment
 * ("test email: someone") does not match. `$`, backtick and `{` are excluded from the first value
 * character so template and variable references are not read as literals.
 */
const literalField = (names) =>
  new RegExp(`(?:^|[{,(\\[]\\s*|["']\\s*,\\s*)(${names})\\s*[:=]\\s*["']([^"'\`$\\{\\n][^"'\\n]*)["']`, "gim");

export const DETECTORS = [
  { name: "email-address", re: EMAIL_RE, group: 0 },
  { name: "email-field-literal", re: () => literalField("email|emailAddress|recipient"), group: 2 },
  { name: "txId-field-literal", re: () => literalField("txId|transactionId"), group: 2 },
  { name: "confirmationId-field-literal", re: () => literalField("confirmationId"), group: 2 },
  { name: "external-reference-field-literal", re: () => literalField("external_reference|externalReference"), group: 2 },
  { name: "zelle-like-tx-id", re: () => /\b\d{11}\b/g, group: 0, needsPaymentContext: true },
  { name: "cashapp-tx-id", re: () => /#D-[A-Z0-9]{6,}/g, group: 0, needsPaymentContext: true },
  { name: "venmo-tx-id", re: () => /\b[0-9]{1}[A-Z]{2}\d{5,}[A-Z]{2}\d{5,}[A-Z]\b/g, group: 0, needsPaymentContext: true },
  { name: "url-with-embedded-credential", re: () => /(?:https?|postgres(?:ql)?):\/\/[^:\s/]+:[^@\s/]+@[^\s"'<>]+/gi, group: 0 },
  // The bare word "service_role" appears throughout the docs as a policy term ("never use the
  // service_role key"), which is the opposite of a leak. Only a JWT-shaped value nearby matters.
  { name: "service-role-key-value", re: () => /service_role[^\n]{0,60}eyJ[A-Za-z0-9_-]{10,}/g, group: 0 },
  { name: "private-key-material", re: () => /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, group: 0 },
  // Identificador de bilhete de loteria. Ancorado deliberadamente no NOME DO CAMPO — 12 a 20 hex
  // soltos aparecem em hash, id e fingerprint por todo o repositorio, e um detector sem ancora
  // seria ruido puro. Ate 2026-08-08 esta era uma lacuna NAO declarada do scan.
  { name: "lottery-ticket-serial", re: () => /\bserial\s*[:=]\s*["'][0-9A-F]{12,20}["']/g, group: 0 },
];

/**
 * EXPOSICOES DECLARADAS POR CAMINHO — identificador real que HOJE vive num arquivo versionado, com
 * o motivo e o estado da decisao. Nao e uma desculpa: e o oposto de silencio. Sem esta tabela o
 * scan simplesmente nao veria os seriais, e uma rodada limpa daria a impressao errada.
 *
 * POR QUE ESTE MECANISMO EXISTE AO LADO DAS DECLARACOES INLINE (`@pii-fixture`): a declaracao inline
 * exige editar o arquivo exposto. O arquivo exposto aqui pertence a um workstream paralelo
 * (powerball) e a campanha de DB o marcou como deliberadamente intocado. Uma exposicao de outro
 * dono se declara AQUI, sem editar o arquivo dele. Este mecanismo veio de main
 * (scripts/audit_pii_repo_wide.mjs) na integracao cross-workstream de 2026-08-12.
 *
 * Regra: a entrada precisa nomear o arquivo EXATO. O mesmo serial em qualquer outro caminho dispara
 * normalmente.
 */
export const DECLARED_EXPOSURES = {
  "lottery-ticket-serial": {
    "bolao/loterias/powerball/js/data.js":
      "Seriais REAIS de bilhetes Powerball comprados com o fundo do bolao. Sao renderizados na " +
      "pagina de proposito: e a evidencia com que cada participante confere quais bilhetes o bolao " +
      "comprou — dinheiro real, transparencia deliberada. MAS o repositorio e PUBLICO e a propria " +
      "pagina se declara privada, entao publica-los e uma decisao de risco do operador, nao uma " +
      "escolha de implementacao. Apagar unilateralmente destruiria evidencia operacional que " +
      "participantes usam. Registrado como HA-4 para o Eduardo decidir. NAO remover esta entrada " +
      "sem que a decisao dele esteja registrada.",
  },
};

export const DETECTOR_NAMES = DETECTORS.map((d) => d.name);

const PAYMENT_CONTEXT_RE = /zelle|cash\s?app|venmo|txid|transa[çc][ãa]o|transaction|payment_ref/i;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. PER-DETECTOR FIXTURE DECLARATIONS
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A file declares deliberate leak-shaped fixtures with one line per detector:
 *
 *   (at)pii-fixture <detector-name> — <why this fixture must look like the real thing>
 *
 * The example above is written with "(at)" on purpose: a live example inside documentation parses as
 * a real declaration, and since the documented detector never fires in this file, it would be
 * reported as stale on every run. An illustration must not also be an instruction.
 *
 * Scoped to the named detector only. A file declaring `private-key-material` still fails on a
 * leaked email, which is the entire difference from the file-level skip it replaces. The reason is
 * mandatory: a declaration without one is a finding, because "why is this here" is the only
 * question a reviewer will have.
 */
const DECLARATION_RE = /@pii-fixture\s+([a-z0-9-]+)\s*(?:[—:-]\s*(.+))?/gi;

export function parseDeclarations(content) {
  const declared = new Map();
  const errors = [];
  DECLARATION_RE.lastIndex = 0;
  let m;
  while ((m = DECLARATION_RE.exec(content))) {
    const detector = m[1];
    const reason = (m[2] || "").trim();
    if (!DETECTOR_NAMES.includes(detector)) {
      errors.push(`declares unknown detector "${detector}" — a typo silently disables nothing, so it is reported`);
      continue;
    }
    if (reason.length < 12) {
      errors.push(`declares ${detector} with no usable reason — a permission without a reason cannot be reviewed`);
      continue;
    }
    declared.set(detector, reason);
  }
  return { declared, errors };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. SCANNING
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Mascara um valor para relatorio.
 *
 * ESTA FUNCAO JA REVELOU O PRIMEIRO E O ULTIMO CARACTERE mais o tamanho. Para um endereco curto ou
 * um ID de transacao isso e divulgacao parcial REAL — e esta saida vai parar em log de CI. A versao
 * de main substituiu aquilo por um digest curto: o suficiente para correlacionar dois achados ou
 * confirmar uma correcao, sem revelar nada do valor.
 *
 * Portado de main na integracao cross-workstream de 2026-08-12. Dos dois comportamentos, este e o
 * estritamente mais seguro, entao ele vence — `scripts/test_audit_pii_repo_wide.mjs` tranca o
 * invariante ("mask() never reveals any character of the value") e falhara se alguem voltar atras.
 */
export function mask(value) {
  if (!value) return "(empty)";
  const digest = createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
  return `<redacted sha256:${digest} len:${String(value).length}>`;
}

/**
 * Scan one file's content.
 * Returns { findings, declarationErrors, unusedDeclarations, suppressed }.
 *
 * `suppressed` records what was accepted and why, so a reviewer can audit the scanner's own
 * leniency instead of taking a green result on faith.
 */
export function scanContent(content, { path = "<memory>", isDetectorSource = false } = {}) {
  const { declared, errors: declarationErrors } = parseDeclarations(content);
  const findings = [];
  const suppressed = [];
  const firedDeclared = new Set();

  for (const det of DETECTORS) {
    const re = det.re();
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const raw = m[det.group] ?? m[0];
      if (raw === undefined || raw === null) continue;

      if (det.needsPaymentContext) {
        const from = Math.max(0, m.index - 80);
        const to = Math.min(content.length, m.index + String(m[0]).length + 80);
        if (!PAYMENT_CONTEXT_RE.test(content.slice(from, to))) continue;
      }

      const cls = classifyValue(det.name, raw);
      if (cls) { suppressed.push({ detector: det.name, reason: cls }); continue; }

      // A detector's own source contains its pattern by necessity. This is narrower than the old
      // file-level skip: it applies only to the detector-engine files themselves, which are the one
      // place where the pattern IS the subject matter.
      if (isDetectorSource) { suppressed.push({ detector: det.name, reason: "DETECTOR_SOURCE" }); continue; }

      if (declared.has(det.name)) {
        firedDeclared.add(det.name);
        suppressed.push({ detector: det.name, reason: "DECLARED_FIXTURE" });
        continue;
      }

      // Exposicao real, conhecida e registrada por caminho — ver DECLARED_EXPOSURES. Diferente de
      // DECLARED_FIXTURE: aquilo diz "este valor e sintetico"; isto diz "este valor e REAL e a
      // decisao de publica-lo esta registrada e pendente do operador".
      if (DECLARED_EXPOSURES[det.name]?.[path]) {
        suppressed.push({ detector: det.name, reason: "DECLARED_EXPOSURE" });
        continue;
      }

      findings.push({ file: path, detector: det.name, sample: mask(raw) });
    }
  }

  // A declaration that never fires is stale: the fixture it excused has been deleted or changed,
  // and the permission outlived it. Reported so permissions shrink instead of accumulating.
  const unusedDeclarations = [...declared.keys()].filter((d) => !firedDeclared.has(d))
    .map((d) => ({ detector: d, file: path }));

  return { findings, declarationErrors: declarationErrors.map((e) => ({ file: path, message: e })), unusedDeclarations, suppressed };
}

export function scanFiles(files, readFile, { detectorSources = [] } = {}) {
  const all = { findings: [], declarationErrors: [], unusedDeclarations: [], scanned: 0, suppressed: 0 };
  for (const file of files) {
    let content;
    try { content = readFile(file); } catch { continue; }
    if (content === null || content === undefined) continue;
    // Binary heuristic. The NUL is written as an ESCAPE, never as a literal byte: a literal NUL
    // in source makes the file binary to git, so it can no longer be diffed or reviewed.
    if (content.includes("\u0000")) continue;
    const r = scanContent(content, { path: file, isDetectorSource: detectorSources.includes(file) });
    all.findings.push(...r.findings);
    all.declarationErrors.push(...r.declarationErrors);
    all.unusedDeclarations.push(...r.unusedDeclarations);
    all.suppressed += r.suppressed.length;
    all.scanned++;
  }
  all.ok = all.findings.length === 0 && all.declarationErrors.length === 0 && all.unusedDeclarations.length === 0;
  return all;
}

export function formatReport(result) {
  const lines = [];
  if (result.ok) {
    lines.push(`✓ Repo-wide PII/secret audit passed — scanned ${result.scanned} tracked files, 0 findings ` +
      `(${result.suppressed} value(s) accepted as reserved-synthetic, schema declarations or declared fixtures).`);
    return lines.join("\n");
  }
  lines.push("❌ REPO-WIDE PII/SECRET AUDIT FAILED\n");
  const byPair = new Map();
  for (const f of result.findings) {
    const k = `${f.file} :: ${f.detector}`;
    if (!byPair.has(k)) byPair.set(k, { ...f, count: 0 });
    byPair.get(k).count++;
  }
  for (const { file, detector, count, sample } of byPair.values()) {
    lines.push(`  - ${file} | ${detector} | count=${count} | sample=${sample}`);
  }
  for (const e of result.declarationErrors) lines.push(`  - ${e.file} | BAD_DECLARATION | ${e.message}`);
  for (const u of result.unusedDeclarations) {
    lines.push(`  - ${u.file} | STALE_DECLARATION | declares ${u.detector} but nothing matched it; remove the declaration`);
  }
  lines.push(`\n${result.findings.length} finding(s), ${result.declarationErrors.length} bad declaration(s), ` +
    `${result.unusedDeclarations.length} stale declaration(s).`);
  return lines.join("\n");
}
