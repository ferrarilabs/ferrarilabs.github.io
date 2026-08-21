#!/usr/bin/env node
/**
 * ACL EFETIVA DE EXECUTE POR FUNCAO — o que a funcao NASCE tendo, nao so o que a DDL escreve.
 *
 * ─── POR QUE ESTE MODULO EXISTE, TENDO `resolveDdl` ──────────────────────────────────────────
 *
 * `secdef_ddl_parse.mjs::resolveDdl` faz a intercalacao correta de create/drop/grant/revoke e foi
 * validada contra o catalogo de producao. Mas ela comeca toda funcao recem-criada com o conjunto
 * de papeis VAZIO. Isso modela o TEXTO dos GRANTs, nao a ACL EFETIVA: uma funcao criada em
 * `public` neste projeto nasce executavel por
 *
 *   - PUBLIC             -- padrao EMBUTIDO do `CREATE FUNCTION` (`acldefault('f', dono)`);
 *   - anon, authenticated, service_role -- pelo `pg_default_acl` de `public`, medido em producao.
 *
 * Nenhum dos dois aparece como GRANT em lugar nenhum da DDL. Um gate que so le GRANT conclui
 * "ninguem tem EXECUTE" para uma funcao que o navegador chama hoje. Esse e o defeito de classe
 * que a Issue #271 documenta e que este modulo corrige.
 *
 * ─── A CORRECAO DE 2026-08-21 SOBRE `ALTER DEFAULT PRIVILEGES` ───────────────────────────────
 *
 * O registro anterior deste projeto afirmava que o EXECUTE embutido para PUBLIC "NAO e suprimivel
 * por default privileges". **Isso esta errado e a correcao e load-bearing aqui.** O que nao
 * funciona e a forma POR SCHEMA; a forma GLOBAL funciona. Medido em cluster PostgreSQL 17.10
 * efemero (mesmo major que producao), papel criador nao-superusuario:
 *
 *   | forma                                                              | funcao nova em public |
 *   |--------------------------------------------------------------------|-----------------------|
 *   | (controle) sem default acl                                          | PUBLIC=X              |
 *   | IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,auth,service     | PUBLIC=X + os 3       |
 *   | + IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC           | PUBLIC=X  (SEM EFEITO)|
 *   | FOR ROLE <criador> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC  (GLOBAL) | PUBLIC ausente (OK)   |
 *
 * A razao esta em `SetDefaultACL`: uma entrada GLOBAL parte de `acldefault()` -- que ja contem o
 * EXECUTE de PUBLIC -- e SUBSTITUI o padrao embutido, entao ela consegue subtrair. Uma entrada
 * POR SCHEMA parte de uma ACL VAZIA e so consegue somar. Por isso `revoke ... from public`
 * dentro de `IN SCHEMA public` e um no-op silencioso: nao ha o que subtrair.
 *
 * O preco da forma global e o seu alcance: no mesmo experimento, uma funcao criada no schema
 * `other` pelo mesmo criador TAMBEM nasceu sem PUBLIC. Ela nao e "o default de public", e o
 * default do CRIADOR no banco inteiro. Por isso este modulo trata as duas formas como eventos
 * DIFERENTES e nunca deixa a forma por schema apagar PUBLIC.
 */

import { stripSqlComments, parseFunctions, parseDropsWithPos, splitArgs } from "./secdef_ddl_parse.mjs";

/** Pseudo-papel PUBLIC, para nao confundir com o schema `public`. */
export const PUBLIC = "PUBLIC";

/** Papeis de cliente do PostgREST. Alcance de navegador. */
export const CLIENT_ROLES = Object.freeze(["anon", "authenticated"]);

/**
 * O que uma funcao criada por `postgres` em `public` NASCE tendo hoje, medido em producao.
 *
 * A migracao 20260821030000 (#271) fechou os defaults de TABLES e SEQUENCES e deliberadamente NAO
 * fechou o de FUNCTIONS -- ela parou no portao humano, com a justificativa (agora corrigida) de
 * que nao seria suprimivel. Enquanto a entrada de FUNCTIONS de `pg_default_acl` continuar como
 * medida, toda funcao nova em `public` nasce assim.
 */
export const FUNCTION_BIRTH_ACL = Object.freeze({
  publicExecute: true,
  roles: Object.freeze(["anon", "authenticated", "service_role"]),
  measuredAt: "2026-08-21",
  source: "pg_default_acl, schema public, objtype FUNCTION, criadores postgres e supabase_admin",
  issue: 271,
});

const roleList = (s) => s.split(",").map((r) => r.trim().replace(/["';]/g, "")).filter(Boolean)
  .map((r) => (r.toLowerCase() === "public" ? PUBLIC : r));

const keyOf = (schema, name, args) =>
  `${schema || "public"}.${name}/${args.trim() === "" ? 0 : splitArgs(args).length}`;

/**
 * `ALTER DEFAULT PRIVILEGES` que mexe em FUNCTIONS, separando GLOBAL de POR SCHEMA.
 *
 * A distincao NAO e cosmetica -- ver o cabecalho. `scope: "global"` pode remover PUBLIC;
 * `scope: "schema"` nunca pode, e uma tentativa de faze-lo e registrada como no-op para que o
 * gate possa reprovar quem escrever isso achando que protegeu alguma coisa.
 */
export function parseAlterDefaultFunctions(text) {
  const out = [];
  const re = /alter\s+default\s+privileges\s+for\s+role\s+"?([a-z0-9_]+)"?\s*(in\s+schema\s+"?([a-z0-9_]+)"?\s*)?(grant|revoke)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+functions\s+(?:to|from)\s+([^;]+);/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, creator, inSchema, schema, verb, roles] = m;
    out.push({
      at: m.index,
      creator,
      scope: inSchema ? "schema" : "global",
      schema: inSchema ? schema : null,
      verb: verb.toLowerCase(),
      roles: roleList(roles),
    });
  }
  return out;
}

/**
 * Laco dinamico: `do $$ ... execute format('revoke all on function %s from public', f) ... $$`.
 *
 * `20260812090000_m8m9_trusted_producer_bridge.sql` usa exatamente essa forma sobre uma lista
 * literal de sete assinaturas, e nao revoga so de PUBLIC -- revoga tambem de `anon` e de
 * `authenticated`, e CONCEDE a `service_role`, tudo dentro do mesmo laco.
 *
 * Ler so o `from public` produziria DOIS erros de sinal opostos no mesmo arquivo: acusaria de
 * expostas a `anon` sete funcoes que a DDL protege (alarme falso), e perderia o grant a
 * `service_role` que a DDL de fato faz. Por isso o parser extrai o CONJUNTO de operacoes do bloco
 * e aplica cada uma a cada assinatura da lista, que e a semantica real do laco.
 *
 * As assinaturas sao QUALIFICADAS (`'public.emit_audit_event(text,...)'`). Um parser que exigisse
 * o nome logo apos a aspa nao casaria nenhuma delas -- foi o defeito da primeira versao deste
 * modulo, achado ao conferir a saida contra a DDL antes de confiar nela.
 */
export function dynamicLoopEffects(text) {
  const out = [];
  const doRe = /\bdo\s+\$\$([\s\S]*?)\$\$/gi;
  let m;
  while ((m = doRe.exec(text)) !== null) {
    const bloco = m[1];
    if (!/execute\s+format\s*\(/i.test(bloco)) continue;

    const keys = new Set();
    const sigRe = /'(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(([^)]*)\)'/gi;
    let s2;
    while ((s2 = sigRe.exec(bloco)) !== null) {
      const [, schema, name, args] = s2;
      keys.add(keyOf(schema, name, args));
    }
    if (!keys.size) continue;

    const ops = [];
    const opRe = /execute\s+format\s*\(\s*'(grant|revoke)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+%s\s+(?:to|from)\s+([a-z0-9_]+)'/gi;
    let o;
    while ((o = opRe.exec(bloco)) !== null) {
      ops.push({ verb: o[1].toLowerCase(), role: o[2].toLowerCase() === "public" ? PUBLIC : o[2] });
    }
    if (ops.length) out.push({ at: m.index, keys, ops });
  }
  return out;
}

/**
 * ACL de EXECUTE efetiva por funcao, depois de aplicar toda a DDL na ordem.
 *
 * Retorna `Map<key, { fn, publicExecute, roles:Set, bornAt, events:[] }>`.
 *
 * `roles` NAO inclui PUBLIC -- ele e um campo separado, porque a diferenca importa: revogar de
 * `anon` nao remove o acesso que `anon` tem POR HERANCA de PUBLIC. Achatar os dois num conjunto
 * so e como se produz um "revogado" que nao revoga nada (Issue #270).
 */
export function effectiveExecuteAcl(files, { birth = FUNCTION_BIRTH_ACL } = {}) {
  const state = new Map();
  // Default privileges vigentes, por papel criador. Comeca no estado medido em producao.
  const schemaDefaultRoles = new Set(birth.roles);
  let globalPublicSuppressed = false;

  const grantRe = /(grant|revoke)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(([^)]*)\)\s*(?:to|from)\s+([^;]+);/gi;

  for (const f of files) {
    const texto = stripSqlComments(f.text);
    const eventos = [];

    for (const fn of parseFunctions(texto, f.file)) eventos.push({ at: fn.at, kind: "create", fn });
    for (const d of parseDropsWithPos(texto)) eventos.push({ at: d.at, kind: "drop", key: d.key });
    for (const a of parseAlterDefaultFunctions(texto)) eventos.push({ ...a, kind: "alterdefault" });
    for (const d of dynamicLoopEffects(texto)) eventos.push({ at: d.at, kind: "dynloop", keys: d.keys, ops: d.ops });

    grantRe.lastIndex = 0;
    let m;
    while ((m = grantRe.exec(texto)) !== null) {
      const [, verb, schema, name, args, roles] = m;
      eventos.push({ at: m.index, kind: verb.toLowerCase(), key: keyOf(schema, name, args), roles: roleList(roles) });
    }

    eventos.sort((a, b) => a.at - b.at);

    for (const e of eventos) {
      if (e.kind === "alterdefault") {
        // Ver o cabecalho: so a forma GLOBAL alcanca o padrao embutido de PUBLIC.
        for (const r of e.roles) {
          if (r === PUBLIC) {
            if (e.scope === "global") globalPublicSuppressed = e.verb === "revoke";
            // scope === "schema" -> NO-OP deliberado. Nao mexe em nada.
            continue;
          }
          if (e.verb === "grant") schemaDefaultRoles.add(r); else schemaDefaultRoles.delete(r);
        }
        continue;
      }
      if (e.kind === "create") {
        const anterior = state.get(e.fn.key);
        if (anterior) {
          // CREATE OR REPLACE preserva a ACL existente. Medido em 17.10: apos um
          // `revoke execute ... from public`, o replace devolveu a MESMA acl, sem PUBLIC.
          // (Um DROP anterior ja teria apagado a entrada, e o CREATE seguinte cai no ramo de
          //  nascimento -- que e como a exposicao volta. Ver `parseDropsWithPos`.)
          anterior.fn = e.fn;
          continue;
        }
        state.set(e.fn.key, {
          fn: e.fn,
          // Nascimento: PUBLIC embutido + os papeis do default de schema.
          publicExecute: !globalPublicSuppressed,
          roles: new Set(schemaDefaultRoles),
          // `explicit` guarda so o que alguem ESCREVEU um GRANT para. Sem esta separacao,
          // `service_role` herdado por default e indistinguivel de `service_role` concedido de
          // proposito -- e a classificacao passaria a chamar de "RPC de servico" qualquer funcao
          // que ninguem decidiu nada sobre. A decisao explicita e exatamente o que este gate cobra.
          explicit: new Set(),
          inheritedAtBirth: new Set(schemaDefaultRoles),
          publicInheritedAtBirth: !globalPublicSuppressed,
          bornAt: e.fn.file,
        });
        continue;
      }
      if (e.kind === "drop") { state.delete(e.key); continue; }

      if (e.kind === "dynloop") {
        for (const k of e.keys) {
          const alvo = state.get(k);
          if (!alvo) continue;
          for (const op of e.ops) {
            if (op.role === PUBLIC) { alvo.publicExecute = op.verb === "grant"; continue; }
            if (op.verb === "grant") { alvo.roles.add(op.role); alvo.explicit.add(op.role); }
            else { alvo.roles.delete(op.role); alvo.explicit.delete(op.role); }
          }
        }
        continue;
      }

      const alvo = state.get(e.key);
      if (!alvo) continue;
      for (const r of e.roles) {
        if (r === PUBLIC) { alvo.publicExecute = e.kind === "grant"; continue; }
        if (e.kind === "grant") { alvo.roles.add(r); alvo.explicit.add(r); }
        else { alvo.roles.delete(r); alvo.explicit.delete(r); }
      }
    }
  }
  return state;
}

/** Quem consegue EXECUTAR de fato, contando a heranca de PUBLIC. */
export function effectiveExecutors(entry, roles = CLIENT_ROLES) {
  if (entry.publicExecute) return [...roles];
  return roles.filter((r) => entry.roles.has(r));
}
