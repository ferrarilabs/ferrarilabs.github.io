/**
 * supabase_migrations_api.mjs — leitura das migracoes APLICADAS via Management API (Issue #310-B).
 *
 * ─── POR QUE ESTA ROTA, E NAO A PROPOSTA DO ADR-019 ─────────────────────────────────────────
 *
 * O ADR-019 propunha expor `supabase_migrations` como schema do PostgREST e criar um papel
 * dedicado com SELECT numa tabela. Funcionaria — e custava caro: DDL em producao, um schema
 * interno virando superficie de API, e um papel novo para manter.
 *
 * A Management API resolve o mesmo problema sem nada disso:
 *
 *     GET https://api.supabase.com/v1/projects/{ref}/database/migrations
 *
 * Rota confirmada como existente (responde 401 sem credencial, nao 404), e a credencial pode ser um
 * token de granularidade fina restrito a `database_migrations_read`. Nenhum DDL, nenhum schema
 * exposto, nenhum papel novo, e alcance MENOR que o do papel proposto.
 *
 * ─── O QUE ESTE MODULO DELIBERADAMENTE NAO FAZ ──────────────────────────────────────────────
 *
 * Nao guarda a resposta inteira. A API devolve o SQL de cada migracao; o detector precisa apenas de
 * `version`. Reduzir na porta de entrada e o que garante que statements de schema nao circulem pelo
 * Sentinel, nao entrem em finding e nao acabem num log de Actions.
 *
 * Nenhum dado de participante, pagamento ou scoring existe nesta rota.
 */

export const PROJECT_REF = "cmhqkkfczotdnssupkni";
export const MIGRATIONS_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/migrations`;

/** A variavel que carrega o token de granularidade fina. Ausente => UNKNOWN, nunca "saudavel". */
export const TOKEN_ENV = "SENTINEL_SUPABASE_MGMT_TOKEN";

/**
 * Reduz a resposta a APENAS a lista de versoes. PURA, para ser testada sem rede.
 *
 * Devolve `null` (=> UNKNOWN) para qualquer forma que nao seja reconhecivel. Inventar uma lista
 * vazia a partir de uma resposta estranha seria afirmar "producao nao aplicou nada" — a afirmacao
 * mais forte possivel, a partir de zero informacao.
 */
export function reduzirVersoes(corpo) {
  if (!Array.isArray(corpo)) return null;
  const versoes = [];
  for (const linha of corpo) {
    if (!linha || typeof linha !== "object") return null;
    const v = linha.version ?? linha.Version;
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!/^\d{14}$/.test(s)) return null;   // forma inesperada => nao da para comparar com confianca
    versoes.push(s);
  }
  return versoes.sort();
}

/**
 * Classifica a resposta HTTP. Toda falha vira UNKNOWN — nunca MATCH, nunca DRIFT.
 *
 * 401/403 sao os casos que mais importam: um token errado ou sem escopo produz uma resposta
 * PERFEITAMENTE bem formada que nao contem migracao nenhuma. Trata-la como lista vazia diria
 * "producao nao aplicou nada" e abriria um alarme de deriva falso sobre TODAS as migracoes.
 */
export function classificarResposta(status) {
  if (status === 200) return "OK";
  if (status === 401 || status === 403) return "UNKNOWN_AUTH";
  if (status === 429) return "UNKNOWN_RATE_LIMIT";
  if (status >= 500) return "UNKNOWN_SERVER";
  return "UNKNOWN_OTHER";
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Le as versoes aplicadas. Devolve `string[]` ou `null` (=> UNKNOWN).
 *
 * `fetchImpl` e injetavel para que o teste exercite 401/403/429/malformado sem rede.
 */
export async function lerVersoesAplicadas({
  token = process.env[TOKEN_ENV],
  fetchImpl = globalThis.fetch,
  tentativas = 3,
  timeoutMs = 20_000,
  esperar = dormir,
} = {}) {
  if (!token) return null;   // sem credencial nao ha medicao — UNKNOWN

  for (let i = 1; i <= tentativas; i++) {
    let resposta;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      resposta = await fetchImpl(MIGRATIONS_URL, {
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      clearTimeout(t);
    } catch {
      return null;   // rede/timeout => UNKNOWN
    }

    const cls = classificarResposta(resposta.status);
    if (cls === "OK") {
      try {
        return reduzirVersoes(await resposta.json());
      } catch {
        return null;   // corpo ilegivel => UNKNOWN
      }
    }
    // Rate limit e a UNICA condicao que merece nova tentativa: as demais nao melhoram repetindo.
    if (cls === "UNKNOWN_RATE_LIMIT" && i < tentativas) {
      await esperar(i * 1000);
      continue;
    }
    return null;
  }
  return null;
}
