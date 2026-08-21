#!/usr/bin/env node
/**
 * MODELO DE EXPOSICAO DE FUNCOES SECURITY DEFINER — Issue #273. Funcoes puras, sem I/O.
 *
 * Separado do gate para que a suite de contrato exercite o raciocinio sem ler o repositorio.
 *
 * ─── O QUE UMA FUNCAO SECURITY DEFINER E ─────────────────────────────────────────────────────
 *
 * Uma funcao SECURITY DEFINER roda com os privilegios do DONO, nao de quem chama. Em `public`,
 * o dono e `postgres`. Marcar uma delas como executavel por cliente as vezes esta exatamente
 * certo -- e assim que uma RPC estreita funciona -- e as vezes e acidente. A diferenca e se
 * alguem DECIDIU. Um detector nao pode decidir isso, entao ele nao tenta: exige ratificacao
 * explicita e reprova o que nao tiver.
 *
 * ─── POR QUE NOME NAO CLASSIFICA NADA ────────────────────────────────────────────────────────
 *
 * `op_*` sugere operador e `cdb_my_*` sugere participante, mas nome e convencao, nao contrato.
 * Uma funcao chamada `cdb_my_entry` poderia gravar pagamento sem que o nome mudasse. Entao a
 * classificacao aqui sai de CAPACIDADE: o que o CORPO da funcao toca. `capabilitiesOf()` le o
 * corpo e devolve o que ela faz; a ratificacao tem de DECLARAR essas capacidades; e se o corpo
 * ganhar uma capacidade que a ratificacao nao previa, isso e DERIVA e reprova. Assim, trocar o
 * corpo de uma RPC ja ratificada nao passa despercebido so porque o nome continua o mesmo.
 *
 * ─── A ARMADILHA DO DEFAULT EMBUTIDO ─────────────────────────────────────────────────────────
 *
 * `CREATE FUNCTION` concede EXECUTE a PUBLIC por padrao embutido do PostgreSQL -- sem nenhuma
 * linha de GRANT. Foi assim que `rls_auto_enable()` ficou executavel por todo mundo (Issue #270)
 * e e por isso que um detector que so procurasse GRANT teria passado batido.
 *
 * Hoje isso nao se repete porque `pg_default_acl` de `public` substitui o default embutido e NAO
 * inclui PUBLIC (medido em producao, os DOIS papeis criadores -- Issue #271). Mas isso e estado
 * do CLUSTER, nao do repositorio: restaurar estas migracoes num cluster sem esses defaults faz
 * TODA funcao nascer executavel por PUBLIC de novo. E restauracao e justamente o cenario que
 * `scripts/db/restore_acceptance.mjs` existe para levar a serio.
 *
 * Por isso o modelo tem dois niveis:
 *   · GRANT explicito a papel de cliente sem ratificacao  -> REPROVA (o gate duro);
 *   · funcao sem `revoke ... from public` explicito        -> depende de `pg_default_acl` para
 *     nao vazar. E uma CATRACA: as existentes ficam numa linha de base declarada e uma funcao
 *     NOVA que dependa disso reprova. O numero pode encolher, nunca crescer.
 */

/** Papeis que uma requisicao de navegador assume no PostgREST. */
export const CLIENT_ROLES = Object.freeze(["anon", "authenticated"]);
/** PUBLIC nao e um papel como os outros: TODO papel herda dele. */
export const PUBLIC_ROLE = "PUBLIC";
/** `service_role` NAO e automaticamente seguro -- ver `classify()`. */
export const SERVICE_ROLE = "service_role";

export const CLASSIFICATIONS = Object.freeze({
  EXPECTED_CLIENT_RPC: "EXPECTED_CLIENT_RPC",
  EXPECTED_SERVICE_RPC: "EXPECTED_SERVICE_RPC",
  INTERNAL_INFRASTRUCTURE: "INTERNAL_INFRASTRUCTURE",
  UNEXPECTED_EXPOSURE: "UNEXPECTED_EXPOSURE",
  UNKNOWN: "UNKNOWN",
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CAPACIDADES — derivadas do CORPO, nunca do nome
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Relacoes cujo toque muda o significado de uma funcao. Nao e lista de nomes "suspeitos": e o
 * inventario real de onde moram dinheiro, identidade e resultado neste banco.
 */
const SENSITIVE = Object.freeze([
  { re: /\bbolao_entry_private\b/i, read: "READS_PARTICIPANT_IDENTITY", write: "WRITES_PARTICIPANT_IDENTITY" },
  { re: /\blottery_participants\b/i, read: "READS_PARTICIPANT_IDENTITY", write: "WRITES_PARTICIPANT_IDENTITY" },
  { re: /\blottery_payment_transactions\b/i, read: "READS_PAYMENT", write: "WRITES_PAYMENT" },
  { re: /\blottery_participations\b/i, read: "READS_ENTRY", write: "WRITES_ENTRY" },
  { re: /\bcdb_entry_access\b/i, read: "READS_ENTRY_TOKEN", write: "WRITES_ENTRY_TOKEN" },
  { re: /\bbolao_notif_jobs\b|\bbolao\.deliveries\b|\boutbox_event/i, read: "READS_NOTIFICATION", write: "CONTROLS_NOTIFICATION" },
  { re: /\bcdb_confirmation_allowance\b/i, read: "READS_NOTIFICATION", write: "CONTROLS_NOTIFICATION" },
  { re: /\bbolao_state\b/i, read: "READS_POOL_STATE", write: "WRITES_POOL_STATE" },
]);

const DML = /\b(insert\s+into|update\s+|delete\s+from|merge\s+into)\b/i;

/**
 * O que esta funcao CONSEGUE fazer, lido do corpo.
 *
 * Aproximacao deliberadamente CONSERVADORA: se o corpo menciona uma relacao sensivel e contem
 * qualquer DML, marca a capacidade de escrita dela. Errar para o lado de "faz mais do que
 * parece" e o unico erro seguro num detector de privilegio -- um falso positivo vira uma linha
 * de ratificacao, um falso negativo vira um incidente.
 */
export function capabilitiesOf({ body = "", returns = "" } = {}) {
  const caps = new Set();
  const hasDml = DML.test(body);
  for (const s of SENSITIVE) {
    if (!s.re.test(body)) continue;
    caps.add(s.read);
    if (hasDml) caps.add(s.write);
  }
  // Executa DDL: isto e infraestrutura de banco, nao RPC de aplicacao.
  if (/\bexecute\s+format\s*\(\s*'(alter|create|drop)/i.test(body) || /\b(alter\s+table|create\s+table|drop\s+table)\b/i.test(body)) {
    caps.add("ADMINISTERS_SCHEMA");
  }
  // Gatilho de evento so pode ser invocado pelo sistema -- nunca por um cliente.
  if (/event_trigger/i.test(returns)) caps.add("EVENT_TRIGGER_ONLY");
  if (!caps.size) caps.add("NO_SENSITIVE_ACCESS");
  return [...caps].sort();
}

/** Capacidades que jamais deveriam estar ao alcance de um navegador sem ratificacao explicita. */
export const HIGH_RISK_FOR_CLIENT = Object.freeze([
  "WRITES_PAYMENT", "WRITES_PARTICIPANT_IDENTITY", "ADMINISTERS_SCHEMA", "EVENT_TRIGGER_ONLY",
]);

/** Capacidades que tornam uma funcao infraestrutura -- nem `service_role` deveria executa-la. */
export const INFRASTRUCTURE_CAPS = Object.freeze(["ADMINISTERS_SCHEMA", "EVENT_TRIGGER_ONLY"]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// EXPOSICAO EFETIVA
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Papeis que REALMENTE executam a funcao, ja contando a heranca de PUBLIC.
 *
 * Esta e a licao da #270 codificada: um papel esta exposto se tem grant proprio OU se PUBLIC tem.
 * Revogar `anon` e `authenticated` e deixar PUBLIC nao tira o acesso de ninguem.
 */
export function effectiveRoles({ explicitGrants = [], publicGranted = false } = {}) {
  const roles = new Set(explicitGrants);
  if (publicGranted) { roles.add(PUBLIC_ROLE); for (const r of [...CLIENT_ROLES, SERVICE_ROLE]) roles.add(r); }
  return [...roles].sort();
}

/** Um papel de cliente alcanca isto? (PUBLIC conta, porque todo mundo herda PUBLIC.) */
export const clientExposed = (roles) => roles.some((r) => r === PUBLIC_ROLE || CLIENT_ROLES.includes(r));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLASSIFICACAO
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Classifica UMA funcao. `ratified` e a entrada do manifesto, se houver.
 *
 * Falha FECHADO: sem ratificacao, exposicao a cliente e UNEXPECTED_EXPOSURE, e uma funcao que o
 * modelo nao consegue avaliar e UNKNOWN. Nenhum dos dois passa.
 */
export function classify(fn, { ratified = null, callerFound = null, now = new Date() } = {}) {
  const caps = fn.capabilities ?? capabilitiesOf(fn);
  const roles = fn.effectiveRoles ?? [];
  const findings = [];

  if (!fn.secdef) {
    // SECURITY INVOKER roda com o privilegio de quem chama -- a RLS ainda vale. Fora de escopo.
    return { classification: CLASSIFICATIONS.EXPECTED_CLIENT_RPC, caps, findings, inScope: false, fatal: false };
  }

  // ── Infraestrutura: nem service_role. `service_role` NAO e seguro so por ser privilegiado. ──
  const isInfra = caps.some((c) => INFRASTRUCTURE_CAPS.includes(c));
  if (isInfra) {
    const naoDono = roles.filter((r) => r !== "postgres");
    if (naoDono.length === 0) {
      return { classification: CLASSIFICATIONS.INTERNAL_INFRASTRUCTURE, caps, findings, inScope: true, fatal: false };
    }
    findings.push(`infraestrutura de banco (${caps.filter((c) => INFRASTRUCTURE_CAPS.includes(c)).join(", ")}) executavel por ${naoDono.join(", ")} — deveria ser so do dono`);
    return { classification: CLASSIFICATIONS.UNEXPECTED_EXPOSURE, caps, findings, inScope: true, fatal: true };
  }

  const exposedToClient = clientExposed(roles);

  if (!exposedToClient) {
    // Alcancavel so por service_role: legitimo para RPC de servico, mas NAO automaticamente.
    if (!roles.includes(SERVICE_ROLE)) {
      return { classification: CLASSIFICATIONS.INTERNAL_INFRASTRUCTURE, caps, findings, inScope: true, fatal: false };
    }
    return { classification: CLASSIFICATIONS.EXPECTED_SERVICE_RPC, caps, findings, inScope: true, fatal: false };
  }

  // ── Daqui para baixo: EXPOSTA A CLIENTE. Exige ratificacao. ────────────────────────────────
  if (!ratified) {
    findings.push(`SECURITY DEFINER executavel por ${roles.filter((r) => r === PUBLIC_ROLE || CLIENT_ROLES.includes(r)).join(", ")} sem entrada de ratificacao`);
    const alto = caps.filter((c) => HIGH_RISK_FOR_CLIENT.includes(c));
    if (alto.length) findings.push(`capacidades de alto risco ao alcance do navegador: ${alto.join(", ")}`);
    return { classification: CLASSIFICATIONS.UNEXPECTED_EXPOSURE, caps, findings, inScope: true, fatal: true };
  }

  // Ratificacao nao pode ser mais estreita que a realidade.
  const extras = roles.filter((r) => r !== "postgres" && !(ratified.allowedRoles ?? []).includes(r));
  if (extras.length) {
    findings.push(`executavel por ${extras.join(", ")}, que a ratificacao nao permite (allowedRoles: ${(ratified.allowedRoles ?? []).join(", ") || "nenhum"})`);
    return { classification: CLASSIFICATIONS.UNEXPECTED_EXPOSURE, caps, findings, inScope: true, fatal: true };
  }

  // DERIVA DE CAPACIDADE: o corpo passou a fazer algo que a ratificacao nao previa.
  const naoDeclaradas = caps.filter((c) => c !== "NO_SENSITIVE_ACCESS" && !(ratified.declaredCapabilities ?? []).includes(c));
  if (naoDeclaradas.length) {
    findings.push(`o corpo ganhou capacidade nao declarada na ratificacao: ${naoDeclaradas.join(", ")} — reratifique conscientemente`);
    return { classification: CLASSIFICATIONS.UNKNOWN, caps, findings, inScope: true, fatal: true };
  }

  // CHAMADOR SUMIU: nao vira "legitimo para sempre" em silencio.
  if (callerFound === false) {
    const q = ratified.quarantine;
    if (!q) {
      findings.push(`ratificada como chamada por \`${ratified.expectedCaller}\`, mas nenhuma chamada foi encontrada no repositorio — privilegio possivelmente morto`);
      return { classification: CLASSIFICATIONS.UNKNOWN, caps, findings, inScope: true, fatal: true };
    }
    const prazo = new Date(q.reviewByIso);
    const vencido = now > prazo;
    findings.push(`sem chamador no repositorio; em QUARENTENA sob a Issue #${q.reviewIssue} ate ${q.reviewByIso}${vencido ? " — PRAZO VENCIDO" : ""}`);
    return { classification: CLASSIFICATIONS.UNKNOWN, caps, findings, inScope: true, fatal: vencido, quarantined: true };
  }

  return { classification: CLASSIFICATIONS.EXPECTED_CLIENT_RPC, caps, findings, inScope: true, fatal: false };
}
