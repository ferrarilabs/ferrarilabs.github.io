/**
 * CONTRATO DE FRESCOR — a fonte unica dos limiares (Issue #296).
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────
 *
 * Medicao de 2026-08-22 sobre 60 execucoes agendadas reais: a cadencia NOMINAL do produtor e de
 * cinco em cinco minutos, mas o GitHub ENTREGA com mediana de 25,1 min (min 15,2 · max 99,5).
 * Fila 0s (mediana e maximo), execucao ~15s, zero cancelamentos — o atraso e da entrega do
 * agendador, nao de enfileiramento, nao de cancel-in-progress e nao de execucao longa.
 *
 * Consequencia: nenhum intervalo observado cabe no teto de 10 minutos. O dado ao vivo fica velho
 * com frequencia, inclusive durante jogo.
 *
 * A decisao do dono (2026-08-22) foi a que preserva a verdade: em vez de subir o teto e passar a
 * chamar de FRESCO um dado de meia hora, o sistema passa a ter TRES estados e a dizer qual e.
 *
 *     idade <= 10 min            FRESH
 *     10 min < idade <= 30 min   STALE_BUT_USABLE   (mostra, mas identifica como atrasado)
 *     idade > 30 min             UNAVAILABLE
 *     sem cache valido           UNAVAILABLE
 *
 * ─── O QUE ESTE ARQUIVO IMPEDE ──────────────────────────────────────────────────────────────
 *
 * Que o limiar vire numero magico repetido. Ele existe UMA vez; o gateway importa daqui, e o
 * `football_live_store.js` do navegador — que nao pode importar ESM, e script classico servido
 * pelo GitHub Pages sem build — e conferido contra estes valores por gate determinístico
 * (`test_freshness_contract.mjs`), que reprova se divergirem.
 *
 * ─── LEITURA NAO REJUVENESCE DADO ───────────────────────────────────────────────────────────
 *
 * `classifyFreshness` recebe uma IDADE e nada mais. Nao recebe o registro do cache, nao pode
 * escreve-lo, e nao existe caminho aqui que atualize `observedAt`/`storedAt`. Um consumidor lendo
 * o cache jamais torna o dado mais novo — so uma observacao nova do produtor faz isso.
 */

/** Ate aqui o dado e apresentado como ao vivo, sem ressalva. */
export const FRESH_MAX_AGE_MS = 10 * 60_000;

/**
 * Ate aqui o dado ainda e util, mas TEM de aparecer identificado como atrasado.
 *
 * 30 min foi escolhido contra a entrega medida (mediana 25,1 min): cobre o caso tipico sem
 * transformar "atrasado" em "qualquer coisa". Alem disso, o gateway prefere admitir que nao sabe.
 */
export const STALE_BUT_USABLE_MAX_AGE_MS = 30 * 60_000;

export const FRESHNESS = Object.freeze({
  FRESH: "FRESH",
  STALE_BUT_USABLE: "STALE_BUT_USABLE",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * Classifica por IDADE. Determinística, sem relogio proprio, sem efeito colateral.
 *
 * Idade nao finita (sem cache, timestamp ilegivel) e UNAVAILABLE — nunca FRESH por omissao.
 * Os limites sao INCLUSIVOS: exatamente 10 min e FRESH, exatamente 30 min e STALE_BUT_USABLE.
 */
export function classifyFreshness(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return FRESHNESS.UNAVAILABLE;
  if (ageMs <= FRESH_MAX_AGE_MS) return FRESHNESS.FRESH;
  if (ageMs <= STALE_BUT_USABLE_MAX_AGE_MS) return FRESHNESS.STALE_BUT_USABLE;
  return FRESHNESS.UNAVAILABLE;
}

/** O dado pode ser mostrado? UNAVAILABLE nunca e apresentado como verdade ao vivo. */
export function isServable(freshness) {
  return freshness === FRESHNESS.FRESH || freshness === FRESHNESS.STALE_BUT_USABLE;
}

/**
 * Idade REAL do dado: quando o provedor observou, nao quando nos gravamos.
 *
 * `observedAt` e a verdade sobre o dado; `storedAt` e sobre o nosso cache. Classificar por
 * `storedAt` faria uma regravacao parecer rejuvenescimento. Se `observedAt` nao for legivel,
 * cai-se para `storedAt` — e se nem isso existir, a idade e infinita (UNAVAILABLE).
 */
export function dataAgeMs(cached, now) {
  if (!cached) return Infinity;
  const observed = Date.parse(cached.observedAt);
  if (Number.isFinite(observed)) return now - observed;
  return Number.isFinite(cached.storedAt) ? now - cached.storedAt : Infinity;
}
