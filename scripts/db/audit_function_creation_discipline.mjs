#!/usr/bin/env node
/**
 * DISCIPLINA DE CRIACAO DE FUNCAO EM `public` — Issue #271, OPCAO B.
 *
 * ─── A CORRECAO QUE ORIGINOU ESTE GATE ───────────────────────────────────────────────────────
 *
 * O registro anterior deste projeto (migracao 20260821030000 e
 * `default_privileges_state.json`) afirmava:
 *
 *     "CREATE FUNCTION concede EXECUTE a PUBLIC por padrao EMBUTIDO e isso NAO e suprimivel por
 *      ALTER DEFAULT PRIVILEGES"
 *
 * **Isso esta errado.** O enunciado correto e:
 *
 *     nao da para suprimir com um REVOKE por schema; um default GLOBAL do papel criador SUPRIME,
 *     mas o seu alcance e o banco inteiro, nao so `public`.
 *
 * Medido em cluster PostgreSQL 17.10 efemero (mesmo major que producao), criador nao-superusuario
 * -- ver `function_birth_acl.mjs` para a tabela completa e a razao em `SetDefaultACL`: entrada
 * GLOBAL parte de `acldefault()` e SUBSTITUI o padrao embutido (consegue subtrair); entrada POR
 * SCHEMA parte de ACL vazia e so SOMA (nao consegue subtrair).
 *
 * A medicao anterior nao estava inventada -- ela testou a forma por schema, que de fato nao faz
 * nada. A conclusao e que foi longe demais, e virou verdade de projeto.
 *
 * ─── O QUE ESTE GATE FAZ, E POR QUE NAO E O `audit_default_privileges.mjs` ───────────────────
 *
 * Aquele gate confere uma LISTA DECLARADA (as tres views e as tres RPCs de cliente). Este parte
 * do outro lado: DESCOBRE toda funcao de aplicacao que a DDL cria em `public` e exige que exista
 * uma DECISAO DE ACESSO para cada uma. Sem descoberta, o que ninguem lembrou de declarar nunca e
 * conferido -- e foi exatamente assim que 14 funcoes de servico ficaram alcancaveis por cliente.
 *
 * E nao e o `audit_security_definer_exposure.mjs` (#273) porque aquele so olha SECURITY DEFINER,
 * e calcula a exposicao a partir do TEXTO dos GRANTs. `_bolao_audit` e SECURITY INVOKER e nao tem
 * GRANT nenhum para `authenticated` -- e producao mede `authenticated=X` nela (Issue #282). O
 * privilegio veio do NASCIMENTO. Modelar ACL efetiva, e nao GRANT textual, e a diferenca entre
 * ver isso e nao ver.
 *
 * ─── REGRA POR CLASSE ────────────────────────────────────────────────────────────────────────
 *
 *   CLIENT_RPC         PUBLIC revogado; so os papeis ratificados em `ratifiedClientExecutors`.
 *   SERVICE_RPC        PUBLIC/anon/authenticated nao executam.
 *   INTERNAL_FUNCTION  PUBLIC/anon/authenticated nao executam.
 *   EVENT_TRIGGER      idem.
 *   EXTENSION_FUNCTION nao classificada aqui -- extensao nao tem CREATE FUNCTION nesta DDL.
 *   UNKNOWN            REPROVA. Fail closed.
 *
 * Sem rede e sem banco. Uso: node scripts/db/audit_function_creation_discipline.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { effectiveExecuteAcl, effectiveExecutors, CLIENT_ROLES } from "./function_birth_acl.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL_PATH = "bolao/shared/safety/function_access_model.json";

/** Classes que NUNCA podem ser alcancadas por papel de cliente. */
export const NON_CLIENT_CLASSES = Object.freeze(["SERVICE_RPC", "INTERNAL_FUNCTION", "EVENT_TRIGGER"]);
export const KNOWN_CLASSES = Object.freeze([...NON_CLIENT_CLASSES, "CLIENT_RPC", "EXTENSION_FUNCTION"]);

/**
 * Piso de descoberta.
 *
 * Se alguem quebrar o parser -- ou apontar o gate para uma arvore vazia -- a descoberta cai para
 * zero e TODA assercao "nenhuma funcao viola a regra" fica trivialmente verdadeira. Um gate que
 * fica verde por nao ter achado nada e pior que gate nenhum, porque ninguem desconfia dele.
 * Este piso e deliberadamente bem abaixo das 61 atuais: ele existe para pegar colapso, nao para
 * exigir que o numero nunca caia.
 */
export const MIN_DISCOVERED_FUNCTIONS = 40;

export function ddlSources({ root = ROOT } = {}) {
  const load = (rel, filt) => {
    const dir = join(root, rel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".sql") && filt(f)).sort()
      .map((f) => ({ file: `${rel}/${f}`, text: readFileSync(join(dir, f), "utf8") }));
  };
  return [...load("bolao/shared/sql", () => true), ...load("supabase/migrations", (f) => !f.includes(".reference."))];
}

export function report({ root = ROOT, files, model } = {}) {
  const src = files ?? ddlSources({ root });
  const man = model ?? JSON.parse(readFileSync(join(root, MODEL_PATH), "utf8"));

  const estado = effectiveExecuteAcl(src);
  const publicas = [...estado.entries()].filter(([k]) => k.startsWith("public.")).sort();

  const ratificado = man.ratifiedClientExecutors ?? {};
  const herdadas = new Map((man.inheritedExposure ?? []).map((e) => [e.signature, e]));

  const achados = [];
  for (const [key, entry] of publicas) {
    const decl = (man.classifications ?? {})[key];
    const clazz = decl?.class;

    if (!decl || !KNOWN_CLASSES.includes(clazz)) {
      achados.push({ key, kind: "UNCLASSIFIED",
        detail: `sem entrada valida em ${MODEL_PATH} (classe=${clazz ?? "ausente"}) — fail closed` });
      continue;
    }

    const alcance = effectiveExecutors(entry);

    if (clazz === "CLIENT_RPC") {
      const permitido = ratificado[key] ?? [];
      // PUBLIC nunca: numa RPC de cliente ele concede a TODO papel, inclusive os que a
      // ratificacao deliberadamente deixou de fora.
      if (entry.publicExecute) achados.push({ key, kind: "CLIENT_RPC_PUBLIC", detail: "PUBLIC executa; a DDL precisa revogar PUBLIC na propria migracao que cria a funcao" });
      const extra = alcance.filter((r) => !permitido.includes(r));
      if (extra.length) achados.push({ key, kind: "CLIENT_RPC_UNRATIFIED", detail: `executavel por ${extra.join(", ")} sem ratificacao` });
      continue;
    }

    if (!alcance.length && !entry.publicExecute) continue;

    const h = herdadas.get(key);
    if (h) {
      // Catraca: a heranca declarada nao pode PIORAR.
      const novos = alcance.filter((r) => !(h.reachableBy ?? []).includes(r));
      if (novos.length) achados.push({ key, kind: "INHERITED_WIDENED", detail: `a exposicao herdada cresceu para ${novos.join(", ")}` });
      if (entry.publicExecute) achados.push({ key, kind: "INHERITED_PUBLIC", detail: "PUBLIC executa — heranca declarada cobre papel nominal, nunca PUBLIC" });
      continue;
    }

    achados.push({ key, kind: "NON_CLIENT_REACHABLE",
      detail: `${clazz} alcancavel por ${[...(entry.publicExecute ? ["PUBLIC"] : []), ...alcance].join(", ")} — revogue na DDL ou declare em inheritedExposure com Issue` });
  }

  // A catraca so aperta se o que saiu dela nao puder voltar em silencio: uma assinatura declarada
  // como herdada que hoje esta limpa e divida QUITADA e tem de sair do arquivo.
  const obsoletas = [...herdadas.keys()].filter((k) => {
    const e = estado.get(k);
    if (!e) return true;
    return !effectiveExecutors(e).length && !e.publicExecute;
  });

  return { total: publicas.length, achados, obsoletas, model: man, estado };
}

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); pass++; } else { console.log(`  ✗ ${n}\n      ${d}`); fail++; } };

function main() {
  console.log("\nDisciplina de criacao de funcao em `public` (Issue #271, opcao B)\n");
  const r = report();

  check("a descoberta encontrou funcoes de aplicacao", r.total >= MIN_DISCOVERED_FUNCTIONS,
    r.total >= MIN_DISCOVERED_FUNCTIONS ? `${r.total} funcoes em public` : `so ${r.total} — piso e ${MIN_DISCOVERED_FUNCTIONS}; parser quebrado ou arvore errada`);

  const semClasse = r.achados.filter((a) => a.kind === "UNCLASSIFIED");
  check("toda funcao descoberta tem decisao de acesso declarada", semClasse.length === 0,
    semClasse.length ? semClasse.map((a) => `${a.key}: ${a.detail}`).join("\n      ") : `${r.total} classificadas`);

  const clientes = r.achados.filter((a) => a.kind.startsWith("CLIENT_RPC"));
  check("toda CLIENT_RPC revoga PUBLIC e so expoe papel ratificado", clientes.length === 0,
    clientes.length ? clientes.map((a) => `${a.key}: ${a.detail}`).join("\n      ") : "as tres RPCs de cliente estao dentro da ratificacao");

  const vazadas = r.achados.filter((a) => a.kind === "NON_CLIENT_REACHABLE");
  check("nenhuma funcao de servico/interna nova alcancavel por cliente", vazadas.length === 0,
    vazadas.length ? vazadas.map((a) => `${a.key}: ${a.detail}`).join("\n      ") : "nenhuma fora da catraca declarada");

  const piorou = r.achados.filter((a) => a.kind.startsWith("INHERITED_"));
  check("a exposicao herdada declarada nao aumentou", piorou.length === 0,
    piorou.length ? piorou.map((a) => `${a.key}: ${a.detail}`).join("\n      ") : `${(r.model.inheritedExposure ?? []).length} itens de divida, nenhum pior`);

  check("nenhuma divida ja quitada continua declarada", r.obsoletas.length === 0,
    r.obsoletas.length ? `saiu da exposicao e tem de sair do arquivo: ${r.obsoletas.join(", ")}` : "a catraca esta apertada");

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passaram, ${fail} falharam\n`);
  return fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
