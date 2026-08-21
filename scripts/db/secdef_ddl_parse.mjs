#!/usr/bin/env node
/**
 * LEITURA DA DDL PARA O DETECTOR #273. Funcoes puras: recebem texto, devolvem estrutura.
 *
 * O CI e hermetico e nao tem credencial de banco, entao o detector raciocina sobre as MIGRACOES,
 * na ordem em que uma reconstrucao as aplicaria (nome do arquivo = timestamp). Isso tem a
 * vantagem de tambem valer para o cenario de restauracao, que e onde os defaults do cluster podem
 * nao existir.
 */

/**
 * Neutraliza COMENTARIOS SQL antes de qualquer analise.
 *
 * Isto nao e cosmetico. `bolao/shared/sql/017_n22_narrow_mutations.sql` traz um bloco
 * `-- ROLLBACK:` com `-- drop function if exists submit_entry(...)` comentado. Lido literalmente,
 * o detector concluia que `submit_entry` e as seis `op_*` tinham sido removidas -- ou seja,
 * dezessete funcoes SECURITY DEFINER reais sumiam da analise, e o gate ficava verde por nao
 * enxergar nada. Comentario que apaga funcao da varredura e falso-verde, nao economia.
 *
 * No nivel superior a funcao PULA regioes dollar-quoted inteiras (o corpo de uma funcao nao e
 * comentario), entao `parseFunctions` aplica a mesma limpeza ao corpo que extraiu -- e assim um
 * `insert into lottery_payment_transactions` comentado dentro de um corpo tambem nao vira
 * capacidade.
 *
 * Substitui por ESPACO em vez de remover, preservando os indices -- a ordenacao entre create e
 * drop depende da posicao real no arquivo. Respeita literais e dollar-quotes: um `--` dentro de
 * `'texto--assim'` nao inicia comentario.
 */
export function stripSqlComments(text) {
  const out = text.split("");
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " "; };
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "--") { const e = text.indexOf("\n", i); const end = e === -1 ? text.length : e; blank(i, end); i = end; continue; }
    if (two === "/*") { const e = text.indexOf("*/", i + 2); const end = e === -1 ? text.length : e + 2; blank(i, end); i = end; continue; }
    if (text[i] === "'") { let j = i + 1; while (j < text.length) { if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; } if (text[j] === "'") break; j++; } i = j + 1; continue; }
    const dq = /^\$[a-z_]*\$/i.exec(text.slice(i, i + 40));
    if (dq) { const tag = dq[0]; const e = text.indexOf(tag, i + tag.length); i = e === -1 ? text.length : e + tag.length; continue; }
    i++;
  }
  return out.join("");
}

/** `create function` com corpo entre dollar-quotes. Retorna todas as definicoes do arquivo. */
export function parseFunctions(text, file = "") {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    let i = m.index + m[0].length;
    // Nome qualificado, com ou sem aspas.
    const nm = /^("?[a-z0-9_]+"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(/i.exec(text.slice(i, i + 200));
    if (!nm) continue;
    const schema = (nm[1] || "public").replace(/["\s.]/g, "") || "public";
    const name = nm[2];
    i += nm[0].length; // ja consumiu o '('
    // Lista de argumentos com parenteses balanceados.
    let depth = 1, start = i;
    while (i < text.length && depth > 0) { const c = text[i]; if (c === "(") depth++; else if (c === ")") depth--; i++; }
    const argsRaw = text.slice(start, i - 1).trim();
    // Cabecalho ate o inicio do corpo.
    const bodyStart = /\bas\s+(\$[a-z_]*\$)/i.exec(text.slice(i, i + 4000));
    const header = text.slice(i, i + (bodyStart ? bodyStart.index : 400));
    let body = "";
    if (bodyStart) {
      const tag = bodyStart[1];
      const b0 = i + bodyStart.index + bodyStart[0].length;
      const b1 = text.indexOf(tag, b0);
      body = b1 === -1 ? text.slice(b0) : text.slice(b0, b1);
    }
    out.push({
      // Posicao REAL do `create` -- e nao a primeira aparicao do nome no arquivo, que costuma
      // estar num comentario. Sem isto a intercalacao com os drops sai fora de ordem.
      at: m.index,
      file, schema, name, argsRaw,
      arity: argsRaw.trim() === "" ? 0 : splitArgs(argsRaw).length,
      signature: `${schema}.${name}(${argsRaw.replace(/\s+/g, " ").trim()})`,
      key: `${schema}.${name}/${argsRaw.trim() === "" ? 0 : splitArgs(argsRaw).length}`,
      secdef: /\bsecurity\s+definer\b/i.test(header),
      // O baseline escreve `SET "search_path" TO 'pg_catalog'` (identificador entre aspas) e as
      // migracoes escrevem `set search_path = public`. As duas formas tem de ser lidas.
      searchPath: (/\bset\s+"?search_path"?\s*(?:=|to)\s*([^\n;]+)/i.exec(header)?.[1] || "").replace(/["']/g, "").trim() || null,
      returns: (/\breturns\s+(?:table\s*\([^)]*\)|setof\s+[a-z0-9_."]+|[a-z0-9_."]+)/i.exec(header)?.[0] || "").trim(),
      // Comentarios dentro do corpo tambem saem: um `insert into lottery_payment_transactions`
      // comentado nao e uma capacidade e nao pode virar uma.
      body: stripSqlComments(body),
    });
  }
  return out;
}

/**
 * `drop function` na ordem de aplicacao. Sem isto o detector avaliaria funcoes que producao ja
 * nao tem -- `submit_cdb_entry` e criada em 024 e removida em 025, e apareceria como fantasma.
 */
export function parseDrops(text) {
  const out = [];
  const re = /drop\s+function\s+(?:if\s+exists\s+)?(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, schema, name, args] = m;
    out.push(`${schema || "public"}.${name}/${args.trim() === "" ? 0 : splitArgs(args).length}`);
  }
  return out;
}

/** Divide a lista de argumentos no nivel superior (ignora virgulas dentro de parenteses). */
export function splitArgs(argsRaw) {
  const parts = []; let depth = 0, cur = "";
  for (const c of argsRaw) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Um papel citado num GRANT/REVOKE; `public` sem aspas e o pseudo-papel PUBLIC. */
const roleList = (s) => s.split(",").map((r) => r.trim().replace(/["';]/g, "")).filter(Boolean)
  .map((r) => (r.toLowerCase() === "public" ? "PUBLIC" : r));

/**
 * Efeito liquido de GRANT/REVOKE de EXECUTE por funcao, na ordem de aplicacao.
 *
 * Chave por `nome/aridade`: o GRANT do baseline escreve os argumentos com nome e aspas
 * (`"p_a" "text"`) e as migracoes escrevem so os tipos (`text`), entao comparar o texto cru nao
 * casaria nunca.
 */
export function netExecuteByFunction(files) {
  const state = new Map(); // key -> Set(roles)
  const grantRe = /(grant|revoke)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(([^)]*)\)\s*(?:to|from)\s+([^;]+);/gi;
  for (const f of files) {
    let m;
    const texto = stripSqlComments(f.text);
    while ((m = grantRe.exec(texto)) !== null) {
      const [, verb, schema, name, args, roles] = m;
      const key = `${schema || "public"}.${name}/${args.trim() === "" ? 0 : splitArgs(args).length}`;
      if (!state.has(key)) state.set(key, new Set());
      const set = state.get(key);
      for (const r of roleList(roles)) {
        if (verb.toLowerCase() === "grant") set.add(r);
        else {
          set.delete(r);
          // Revogar de PUBLIC nao apaga grant nominal, e vice-versa. Sao independentes.
        }
      }
    }
  }
  return state;
}

/**
 * Estado FINAL das funcoes depois de aplicar toda a DDL na ordem.
 *
 * Create e drop tem de ser intercalados por POSICAO dentro de cada arquivo, nao coletados em
 * conjuntos separados: `cdb_update_entry_picks` e removida em 025 e recriada depois, e producao
 * a tem. Processar todos os drops no fim a apagaria; processar todos os creates no fim
 * ressuscitaria `submit_cdb_entry`, que producao nao tem. So a ordem acerta os dois casos.
 */
export function buildFunctionState(files) {
  const alive = new Map();
  for (const f of files) {
    const texto = stripSqlComments(f.text);
    const eventos = [
      ...parseFunctions(texto, f.file).map((fn) => ({ at: fn.at, kind: "create", fn })),
      ...parseDropsWithPos(texto).map((d) => ({ at: d.at, kind: "drop", key: d.key })),
    ].sort((a, b) => a.at - b.at);
    for (const e of eventos) {
      if (e.kind === "create") alive.set(e.fn.key, e.fn);
      else alive.delete(e.key);
    }
  }
  return alive;
}

/** Como `parseDrops`, mas guardando a posicao para permitir a intercalacao acima. */
export function parseDropsWithPos(text) {
  const out = [];
  const re = /drop\s+function\s+(?:if\s+exists\s+)?(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, schema, name, args] = m;
    out.push({ at: m.index, key: `${schema || "public"}.${name}/${args.trim() === "" ? 0 : splitArgs(args).length}` });
  }
  return out;
}

/**
 * UMA passada ordenada sobre toda a DDL, resolvendo create / drop / grant / revoke juntos.
 *
 * Precisa ser uma passada so porque os quatro eventos interagem. O caso que obriga a isso:
 * `cdb_update_entry_picks` recebe GRANT para anon/authenticated, e removida em
 * `025_cdb2026_participant_picks.sql` e recriada depois. `DROP FUNCTION` DESTROI a ACL -- em
 * producao ela nao tem grant nenhum. Um modelo que somasse grants separadamente concluiria que
 * ela continua exposta a anon, e erraria para o lado errado: alarme falso num detector de
 * seguranca gasta confianca ate ninguem mais ler a saida.
 *
 * (Este e o mesmo vetor documentado na #270 ao contrario: DROP+CREATE reaplica os default
 * privileges e limpa os grants explicitos.)
 */
export function resolveDdl(files) {
  const state = new Map(); // key -> { fn, roles:Set<string> }
  const grantRe = /(grant|revoke)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(([^)]*)\)\s*(?:to|from)\s+([^;]+);/gi;
  for (const f of files) {
    const texto = stripSqlComments(f.text);
    const eventos = [];
    for (const fn of parseFunctions(texto, f.file)) eventos.push({ at: fn.at, kind: "create", fn });
    for (const d of parseDropsWithPos(texto)) eventos.push({ at: d.at, kind: "drop", key: d.key });
    let m;
    grantRe.lastIndex = 0;
    while ((m = grantRe.exec(texto)) !== null) {
      const [, verb, schema, name, args, roles] = m;
      eventos.push({
        at: m.index, kind: verb.toLowerCase(),
        key: `${schema || "public"}.${name}/${args.trim() === "" ? 0 : splitArgs(args).length}`,
        roles: roles.split(",").map((r) => r.trim().replace(/["';]/g, "")).filter(Boolean)
          .map((r) => (r.toLowerCase() === "public" ? "PUBLIC" : r)),
      });
    }
    eventos.sort((a, b) => a.at - b.at);
    for (const e of eventos) {
      if (e.kind === "create") {
        // CREATE OR REPLACE preserva a ACL; um CREATE depois de DROP comeca limpo. Como o drop
        // ja apagou a entrada, basta preservar o que houver.
        const anterior = state.get(e.fn.key);
        state.set(e.fn.key, { fn: e.fn, roles: anterior ? anterior.roles : new Set() });
      } else if (e.kind === "drop") {
        state.delete(e.key); // leva a ACL junto
      } else if (state.has(e.key)) {
        const set = state.get(e.key).roles;
        for (const r of e.roles) { if (e.kind === "grant") set.add(r); else set.delete(r); }
      }
    }
  }
  return state;
}
