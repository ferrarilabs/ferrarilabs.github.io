/**
 * QUANDO vale a pena gastar uma requisição ao provedor — e QUAIS requisições fazer.
 *
 * Puro: sem relógio próprio, sem rede, sem arquivo. Decide a partir do CALENDÁRIO canônico de cada
 * competição (o snapshot commitado, servido como arquivo estático público) e do estado do cache.
 *
 * ─── FALHA PARA O LADO DE BUSCAR ────────────────────────────────────────────────────────────
 * Calendário ausente, ilegível ou velho demais NÃO significa "não há jogo": significa "não sei".
 * Nesse caso vale uma janela horária LARGA (12h–03h59 UTC, superconjunto da janela 14h–02h que o
 * produtor atual usa), nunca silêncio. Um jogo ao vivo dentro de uma janela plausível jamais pode
 * passar em branco por causa de um calendário desatualizado.
 * Uma partida que o calendário ainda mostra como não encerrada continua "possivelmente ao vivo" por
 * mais tempo (prorrogação, atraso, adiamento não refletido), e um jogo `in` já no cache mantém a
 * observação ligada qualquer que seja a hora.
 */
import { LEAGUES } from "./providers/api_football.js";

/** Mesma janela do produtor atual: [-3h, +1h] em torno do apito. Fonte única (produce_live_cache.mjs reexporta). */
export const WINDOW_LOOKBACK_MS = 3 * 60 * 60_000;
export const WINDOW_LOOKAHEAD_MS = 60 * 60_000;
/** Partida ainda não confirmada como encerrada: olha mais para trás (prorrogação, atraso). */
export const UNRESOLVED_LOOKBACK_MS = 5 * 60 * 60_000;
/** Calendário mais velho que isto = incerto. */
export const CALENDAR_MAX_AGE_MS = 7 * 24 * 3600_000;
/** Janela larga de fallback (UTC): 12:00 até 03:59. */
export const FALLBACK_FROM_UTC_HOUR = 12;
export const FALLBACK_TO_UTC_HOUR = 3;
/** Sincronização do dia inteiro (estado final dos jogos que saíram do `live`): a cada N minutos. */
export const DAY_SYNC_EVERY_MIN = 10;

/** `true` quando alguma data cai em [now-3h, now+1h]. Sem datas: `true` (não saber ≠ não haver jogo). */
export function isWithinWindow(dates, now = Date.now()) {
  if (!dates.length) return true;
  return dates.some((d) => {
    const t = Date.parse(d);
    if (Number.isNaN(t)) return false;
    return t >= now - WINDOW_LOOKBACK_MS && t <= now + WINDOW_LOOKAHEAD_MS;
  });
}

const isVoid = (m) => m?.statusName === "STATUS_POSTPONED" || m?.statusName === "STATUS_CANCELED" || m?.statusName === "STATUS_SUSPENDED";
const inFallbackHours = (now) => { const h = new Date(now).getUTCHours(); return h >= FALLBACK_FROM_UTC_HOUR || h <= FALLBACK_TO_UTC_HOUR; };

/**
 * @param {{calendar:{matches:object[],generatedAt?:string}|null, existingMatches?:object[], now?:number}} p
 * @returns {{poll:boolean, reason:string}}
 */
export function decideCompetition({ calendar, existingMatches = [], now = Date.now() }) {
  if (existingMatches.some((m) => m?.state === "in")) return { poll: true, reason: "cache_has_live_match" };
  const matches = calendar && Array.isArray(calendar.matches) ? calendar.matches : [];
  const age = calendar ? now - Date.parse(calendar.generatedAt ?? "") : NaN;
  if (!matches.length || !Number.isFinite(age) || age > CALENDAR_MAX_AGE_MS) {
    return inFallbackHours(now)
      ? { poll: true, reason: "calendar_uncertain_fallback_window" }
      : { poll: false, reason: "calendar_uncertain_outside_fallback_hours" };
  }
  const hit = matches.some((m) => {
    if (isVoid(m)) return false;
    const t = Date.parse(m.date);
    if (Number.isNaN(t)) return false;
    const back = m.state === "post" ? WINDOW_LOOKBACK_MS : UNRESOLVED_LOOKBACK_MS;
    return t >= now - back && t <= now + WINDOW_LOOKAHEAD_MS;
  });
  return hit ? { poll: true, reason: "match_in_window" } : { poll: false, reason: "no_match_in_window" };
}

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Requisições a fazer neste tick. UMA chamada `live` cobre todas as competições que estão em janela.
 * A sincronização do dia roda a cada DAY_SYNC_EVERY_MIN minutos (ou quando o cache ainda não tem
 * nenhuma partida do dia) e traz o estado FINAL dos jogos que deixaram de aparecer em `live`.
 */
export function planApiFootballRequests({ now, polling, existingByCompetition = {}, forceDaySync = [] }) {
  const comps = Object.keys(polling).filter((c) => polling[c]?.poll && LEAGUES[c]);
  if (!comps.length) return [];
  const requests = [{
    kind: "live", competitions: comps,
    path: `/fixtures?live=${comps.map((c) => LEAGUES[c].leagueId).join("-")}`,
  }];
  const from = utcDay(now - 6 * 3600_000), to = utcDay(now + 6 * 3600_000);
  const slotDue = Math.floor(now / 60_000) % DAY_SYNC_EVERY_MIN === 0;
  for (const c of comps) {
    const today = (existingByCompetition[c] ?? []).some((m) => utcDay(Date.parse(m.date)) === utcDay(now));
    if (slotDue || !today || forceDaySync.includes(c)) {
      requests.push({ kind: "day", competitions: [c], path: `/fixtures?league=${LEAGUES[c].leagueId}&season=${LEAGUES[c].season}&from=${from}&to=${to}` });
    }
  }
  return requests;
}

/** Caminho de requisição que o relay/Worker aceita seguir — forma fechada, sem host, sem `..`. */
export const SAFE_PATH = /^\/fixtures\?[A-Za-z0-9=&,_-]{1,200}$/;
