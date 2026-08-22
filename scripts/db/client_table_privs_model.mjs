#!/usr/bin/env node
/**
 * MODELO DE PRIVILEGIO DE TABELA PARA PAPEL DE CLIENTE — Issue #276. Funcoes puras, sem I/O.
 *
 * ─── O QUE ELE MODELA ────────────────────────────────────────────────────────────────────────
 *
 * O efeito LIQUIDO de todos os GRANT/REVOKE de tabela da DDL, na ordem em que uma reconstrucao os
 * aplicaria, para responder uma unica pergunta: `anon` ou `authenticated` terminam com TRUNCATE,
 * REFERENCES ou TRIGGER numa tabela de aplicacao de `public`?
 *
 * ─── POR QUE ESTES TRES, E NAO OS QUATRO DE SEMPRE ───────────────────────────────────────────
 *
 * Porque a RLS nao cobre estes. Ela aplica policies a SELECT, INSERT, UPDATE e DELETE; TRUNCATE e
 * operacao de tabela inteira, decidida so pelo privilegio. Uma tabela com RLS ligada e ZERO
 * policies -- o estado das doze -- continua truncando limpo para quem tiver TRUNCATE.
 *
 * Entao o argumento "a RLS esta segurando", que e valido para os quatro verbos de linha e e a
 * base da analise da #131, NAO vale para estes tres. Eles eram o unico privilegio destas tabelas
 * sem nenhuma rede embaixo, e e por isso que sao os unicos que este gate governa. SELECT, INSERT,
 * UPDATE e DELETE continuam com os contratos que ja tinham -- deliberadamente fora daqui.
 */

/** Os tres privilegios de administracao de tabela que este gate governa. */
export const STRUCTURAL_PRIVS = Object.freeze(["TRUNCATE", "REFERENCES", "TRIGGER"]);

/** Os papeis que uma requisicao de navegador assume. `service_role` NAO e governado aqui. */
export const CLIENT_ROLES = Object.freeze(["anon", "authenticated"]);

/** Todos os privilegios de tabela, para expandir `GRANT ALL`. */
const ALL_PRIVS = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]);

/**
 * Excecoes ratificadas pelo dono. VAZIA de proposito.
 *
 * Nao existe caminho de aplicacao neste repositorio que precise truncar uma tabela, criar um
 * gatilho ou declarar uma chave estrangeira em tempo de execucao COMO `anon` ou `authenticated`.
 * As RPCs que mutam sao SECURITY DEFINER e rodam como o DONO, entao o privilegio de quem chama
 * nem e consultado. Se um dia existir, a entrada precisa nomear tabela, papel, privilegio, motivo
 * e quem ratificou -- e o gate volta a reprovar tudo o que nao estiver aqui.
 */
export const RATIFIED_EXCEPTIONS = Object.freeze([]);

/**
 * A ACL COM QUE UMA TABELA NOVA NASCE neste cluster — medida, nao suposta.
 *
 * `pg_default_acl` de `public` concede `arwdDxtm` a `anon`, `authenticated` e `service_role` em
 * toda tabela nova, para os DOIS papeis criadores (`postgres` e `supabase_admin`). `D`, `x` e `t`
 * sao exatamente TRUNCATE, REFERENCES e TRIGGER. Medido em producao em 2026-08-21; e a Issue #271.
 *
 * Modelar isto nao e detalhe: `public.bolao_round_notif_jobs` nao tem UM UNICO `grant` em toda a
 * DDL deste repositorio, e mesmo assim `anon` tinha TRUNCATE nela em producao. Veio inteiramente
 * do default. Um modelo que so lesse GRANT concluiria que ela estava limpa e o gate ficaria verde
 * sobre uma tabela exposta.
 *
 * Consequencia deliberada: enquanto a #271 nao for resolvida, TODA tabela nova precisa de um
 * `revoke` explicito para passar neste gate. E a catraca certa -- foi assim que
 * `cdb_entry_access` ficou limpa (revoke explicito em 20260812070000), e e assim que a tabela
 * numero treze vai ter de ficar.
 *
 * Isto e estado do CLUSTER, nao do repositorio -- e mudou no meio da historia. A migracao
 * `20260821030000` (Issue #271) revogou os defaults de TABLES e SEQUENCES para o papel criador
 * `postgres`, entao uma tabela criada por ele DEPOIS dela nasce so do dono. Antes dela, nasce
 * exposta. Por isso `SECURE_DEFAULTS_FROM` existe: o modelo tem de tratar as duas eras, senao ou
 * reprova a historia real ou aprova o futuro errado.
 *
 * Continua valendo para `supabase_admin`: a alteracao dele foi RECUSADA por privilegio
 * (`ERROR: 42501: permission denied to change default privileges` -- o canal conecta como
 * `postgres`, que nao e superusuario nem membro de `supabase_admin`). Uma tabela criada por
 * `supabase_admin` em `public` ainda nasce exposta hoje.
 */
export const BORN_WITH = Object.freeze({
  roles: Object.freeze(["anon", "authenticated", "service_role"]),
  privileges: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]),
  measuredAt: "2026-08-21",
  issue: 271,
});

/**
 * Arquivos que sao CAPTURA DE ACL, nao mudanca incremental.
 *
 * `20260811160000_baseline_adopted_grants_and_rls.sql` e um `pg_dump` da ACL de producao: ele
 * DESCREVE o estado, nao o modifica. Tratar as suas linhas como incrementais da o resultado
 * errado -- a tabela nasce com o default `arwdDxtm` e o dump nunca revoga TRUNCATE explicitamente,
 * entao o modelo concluiria que `anon` tem TRUNCATE em nove tabelas quando producao mede duas.
 *
 * A prova de que e captura esta no proprio texto: para `lottery_participants` ele emite
 * `GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE TO anon` -- enumerado, sem
 * TRUNCATE. Isso e a ACL de depois da remediacao de 2026-08-07 escrita por extenso.
 *
 * Entao, ao chegar num arquivo destes, a ACL das tabelas que ele menciona e ZERADA antes de
 * aplicar o que ele diz. Tabela que ele NAO menciona -- `bolao_round_notif_jobs`, criada depois em
 * `030_*` -- mantem o que tinha, que e o default. E exatamente o que producao mostra.
 */
export const ACL_SNAPSHOT_FILES = Object.freeze(["20260811160000_baseline_adopted_grants_and_rls"]);

/**
 * A migracao a partir da qual uma tabela criada por `postgres` deixa de nascer exposta.
 *
 * Antes dela, `seed()` aplica `BORN_WITH`; a partir dela, tabela nova comeca vazia. E o que
 * permite o teste que reproduz a medicao de producao de 2026-08-21 continuar valido enquanto o
 * gate passa a exigir menos das tabelas futuras.
 */
export const SECURE_DEFAULTS_FROM = "20260821030000_secure_default_privileges_public";

/**
 * `create table` E `create view` em `public`, com a posicao, para intercalar com os grants na
 * ordem certa.
 *
 * ─── POR QUE VIEW ENTRA AQUI (Issue #282) ────────────────────────────────────────────────────
 *
 * Ate 2026-08-22 este parser so casava `create table`, entao NENHUMA view era semeada com a ACL
 * de nascimento -- e o modelo concluia que `bolao_state_normalized_public` estava limpa enquanto
 * producao media `anon` com os sete privilegios nela. Ou seja: o achado da #282 era invisivel
 * para o proprio modelo que deveria pega-lo.
 *
 * A causa e que o `pg_default_acl` de `public` nao distingue tabela de view -- as duas sao
 * `relacl`, e as duas nascem concedidas. Um modelo que so semeia tabela ve metade da superficie.
 *
 * `create materialized view` entra pelo mesmo motivo. `create or replace view` tambem casa, e
 * `seed()` ja ignora re-criacao de objeto existente (nao reinicia a ACL), que e exatamente a
 * semantica de `CREATE OR REPLACE`.
 */
export function parseCreateTables(text) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?(?:table|(?:materialized\s+)?view)\s+(?:if\s+not\s+exists\s+)?(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*[\(a-z]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, schema, name] = m;
    if ((schema || "public") !== "public") continue;
    out.push({ at: m.index, table: name });
  }
  return out;
}

const norm = (s) => s.replace(/["';]/g, "").trim();

/** `grant`/`revoke` de tabela, com ou sem a palavra TABLE, com ou sem schema e aspas. */
const STMT = /(grant|revoke)\s+([a-z, \t\r\n]+?)\s+on\s+(?:table\s+)?((?:"?[a-z0-9_]+"?\s*\.\s*)?"?[a-z0-9_]+"?(?:\s*,\s*(?:"?[a-z0-9_]+"?\s*\.\s*)?"?[a-z0-9_]+"?)*)\s+(?:to|from)\s+([^;]+);/gi;

/** Expande a lista de privilegios citada; `all` vira os sete. */
export function privsOf(raw) {
  const t = raw.toLowerCase();
  if (/\ball\b/.test(t)) return [...ALL_PRIVS];
  return ALL_PRIVS.filter((p) => new RegExp(`\\b${p.toLowerCase()}\\b`).test(t));
}

/**
 * Estado liquido: Map<tabela, Map<papel, Set<privilegio>>>.
 *
 * Comeca VAZIO para toda tabela. Uma tabela que nunca recebeu GRANT termina limpa sem precisar de
 * REVOKE nenhum -- que e como `public.cdb_entry_access` tem de aparecer: limpa por historia real,
 * nao por uma remediacao sintetica que nunca aconteceu.
 */
export function tablePrivState(files, { stripComments = (s) => s, bornWith = BORN_WITH } = {}) {
  const state = new Map();
  let defaultsSegurosRef = { valor: false };
  const seed = (tbl) => {
    if (state.has(tbl)) return; // `if not exists` re-executado nao reinicia a ACL
    const byRole = new Map();
    if (!defaultsSegurosRef.valor) for (const r of bornWith.roles) byRole.set(r, new Set(bornWith.privileges));
    state.set(tbl, byRole);
  };
  let defaultsSeguros = false;
  for (const f of files) {
    const texto = stripComments(f.text);
    const ehCaptura = ACL_SNAPSHOT_FILES.some((n) => f.file.includes(n));
    // A partir desta migracao, tabela nova nao nasce mais concedida ao cliente.
    if (f.file.includes(SECURE_DEFAULTS_FROM)) { defaultsSeguros = true; defaultsSegurosRef.valor = true; }
    const eventos = parseCreateTables(texto).map((c) => ({ at: c.at, kind: "create", table: c.table }));
    STMT.lastIndex = 0;
    let m;
    while ((m = STMT.exec(texto)) !== null) {
      const [, verb, privRaw, targetsRaw, rolesRaw] = m;
      const privs = privsOf(privRaw);
      if (!privs.length) continue;
      eventos.push({
        at: m.index, kind: verb.toLowerCase(), privs,
        targets: targetsRaw.split(",").map((t) => norm(t).split(".").pop()),
        roles: rolesRaw.split(",").map((r) => norm(r)).filter(Boolean)
          .map((r) => (r.toLowerCase() === "public" ? "PUBLIC" : r)),
      });
    }
    // Ordem por posicao no arquivo: um `revoke` so limpa o que ja nasceu antes dele.
    eventos.sort((a, b) => a.at - b.at);
    // Captura de ACL: zera as tabelas que o arquivo descreve, porque ele descreve o estado FINAL
    // delas, nao um delta sobre o que veio antes.
    if (ehCaptura) {
      for (const e of eventos) {
        if (e.kind === "create") continue;
        for (const tbl of e.targets) state.set(tbl, new Map());
      }
    }
    for (const e of eventos) {
      if (e.kind === "create") { seed(e.table); continue; }
      for (const tbl of e.targets) {
        if (!state.has(tbl)) state.set(tbl, new Map());
        const byRole = state.get(tbl);
        for (const role of e.roles) {
          if (!byRole.has(role)) byRole.set(role, new Set());
          const set = byRole.get(role);
          for (const p of e.privs) { if (e.kind === "grant") set.add(p); else set.delete(p); }
        }
      }
    }
  }
  return state;
}

/**
 * Exposicao estrutural que sobra, ja contando a heranca de PUBLIC.
 *
 * PUBLIC entra porque todo papel herda dele -- a mesma licao da #270, aqui aplicada a tabela: um
 * papel esta exposto se tem o privilegio proprio OU se PUBLIC tem.
 */
export function structuralExposure(state, appTables) {
  const out = [];
  for (const tbl of appTables) {
    const byRole = state.get(tbl) ?? new Map();
    const pub = byRole.get("PUBLIC") ?? new Set();
    for (const role of CLIENT_ROLES) {
      const own = byRole.get(role) ?? new Set();
      for (const priv of STRUCTURAL_PRIVS) {
        const viaOwn = own.has(priv);
        const viaPublic = pub.has(priv);
        if (!viaOwn && !viaPublic) continue;
        if (RATIFIED_EXCEPTIONS.some((e) => e.table === tbl && e.role === role && e.privilege === priv)) continue;
        out.push({ table: tbl, role, privilege: priv, via: viaOwn && viaPublic ? "grant proprio + PUBLIC" : viaOwn ? "grant proprio" : "heranca de PUBLIC" });
      }
    }
  }
  return out;
}
