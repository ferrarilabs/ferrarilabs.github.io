/**
 * ferrarilabs-live-producer-direct — relógio + ponte de egresso do cache ao vivo, SEM GitHub Actions.
 *
 * Fluxo de UM disparo (cron de 1 min):
 *
 *   1. GET  {INGEST}?plan=1&provider=api_football   → a função decide (calendário + cache) se há algo a
 *      buscar e QUAIS requisições fazer. Fora de janela: resposta vazia e NENHUMA chamada ao provedor
 *      (cota preservada). Este Worker não conhece calendário nem regra de janela.
 *   2. GET  API-Football {path}                      → chave de provedor no cabeçalho; só status e
 *      cabeçalhos de cota são lidos além do corpo, que é repassado CRU.
 *   3. POST {INGEST}?provider=api_football&kind=…    → a função valida, resolve identidade, mescla,
 *      grava (ou só simula, em `shadow`). Respostas podem pedir `followUp` (ex.: estado final de um
 *      jogo que saiu do `live`): executado uma vez, com teto.
 *
 * O Worker NUNCA recebe credencial de banco (ADR-021). Falha do provedor (401/429/5xx, `errors`) nunca
 * chega à função como "observação": o último-bom-conhecido segura o gateway.
 */
import { SAFE_PATH } from "../../../supabase/functions/_shared/polling_plan.js";
import { API_FOOTBALL_BASE, classifyHttpFailure } from "../../../supabase/functions/_shared/providers/api_football.js";

const INGEST_FORM = /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/live-cache-ingest$/;
const TIMEOUT_MS = 8_000;
const MAX_REQUESTS_PER_OBSERVATION = 5;
const MAX_OBSERVATIONS = 20;

export type Resultado = {
  action: "OFF" | "CONFIG_INVALIDA" | "SEM_CREDENCIAL" | "SEM_JANELA" | "PLANO_RECUSADO" | "OBSERVADO" | "PARADO";
  mode: string;
  observations: number;
  providerCalls: number;
  ingestCalls: number;
  statuses: number[];
  stopReason?: string;
};

type Deps = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };
type Req = { kind: "live" | "day"; competitions: string[]; path: string };

const num = (v: unknown, dflt: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : dflt;
};

const defaultSleep = (ms: number): Promise<void> => {
  const sch = (globalThis as { scheduler?: { wait?: (ms: number) => Promise<void> } }).scheduler;
  return sch?.wait ? sch.wait(ms) : new Promise((r) => setTimeout(r, ms));
};

export async function tick(env: Env, { fetchImpl = fetch, sleep = defaultSleep }: Deps = {}): Promise<Resultado> {
  const mode = env.PRODUCER_MODE ?? "off";
  const out: Resultado = { action: "OFF", mode, observations: 0, providerCalls: 0, ingestCalls: 0, statuses: [] };
  if (mode !== "shadow" && mode !== "authoritative") return out;                       // off: não toca a rede
  if (!env.API_FOOTBALL_KEY || !env.LIVE_INGEST_TOKEN) return { ...out, action: "SEM_CREDENCIAL" };
  // O token só sai para a forma fechada da função de ingestão; qualquer outro endereço é recusado.
  if (!INGEST_FORM.test(env.INGEST_URL ?? "")) return { ...out, action: "CONFIG_INVALIDA" };

  const dry = mode === "shadow" ? "&dry_run=1" : "";
  const ingestAuth = { authorization: `Bearer ${env.LIVE_INGEST_TOKEN}` };
  const total = num(env.OBSERVATIONS_PER_TICK, 1, 1, MAX_OBSERVATIONS);
  const interval = num(env.INTERVAL_MS, 15_000, 1_000, 60_000);
  const minRemaining = num(env.MIN_REMAINING_REQUESTS, 200, 0, 1_000_000);

  for (let i = 0; i < total; i++) {
    if (i > 0) await sleep(interval);
    let plan: { requests?: Req[] };
    try {
      const p = await fetchImpl(`${env.INGEST_URL}?plan=1&provider=api_football`, { headers: ingestAuth, signal: AbortSignal.timeout(TIMEOUT_MS) });
      out.ingestCalls++; out.statuses.push(p.status);
      if (!p.ok) return { ...out, action: "PLANO_RECUSADO", stopReason: `plan http ${p.status}` };
      plan = await p.json();
    } catch (e) { return { ...out, action: "PLANO_RECUSADO", stopReason: `plan ${e instanceof Error ? e.name : "Error"}` }; }

    const queue: Req[] = Array.isArray(plan.requests) ? [...plan.requests] : [];
    if (!queue.length) { out.action = "SEM_JANELA"; break; }                           // nada pode estar ao vivo

    const seen = new Set<string>();
    let handled = 0;
    while (queue.length && handled < MAX_REQUESTS_PER_OBSERVATION) {
      const req = queue.shift()!;
      if (seen.has(req.path)) continue;
      seen.add(req.path); handled++;
      // O caminho vem de fora: só se segue forma fechada, nunca um endereço arbitrário.
      if (!SAFE_PATH.test(req.path) || !Array.isArray(req.competitions) || !["live", "day"].includes(req.kind)) continue;

      let provider: Response;
      try {
        provider = await fetchImpl(`${API_FOOTBALL_BASE}${req.path}`, {
          headers: { "x-apisports-key": env.API_FOOTBALL_KEY, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) { return { ...out, action: "PARADO", stopReason: `provider ${e instanceof Error ? e.name : "Error"}` }; }
      out.providerCalls++; out.statuses.push(provider.status);
      if (provider.status !== 200) {
        // 401/429/5xx NUNCA viram observação. Auth e limite de taxa encerram o disparo inteiro.
        const f = classifyHttpFailure(provider.status);
        return { ...out, action: "PARADO", stopReason: f.kind };
      }
      const remaining = Number(provider.headers.get("x-ratelimit-requests-remaining"));
      const body = await provider.text();

      let ingest: Response;
      try {
        ingest = await fetchImpl(`${env.INGEST_URL}?provider=api_football&kind=${req.kind}&competitions=${req.competitions.join(",")}${dry}`, {
          method: "POST", headers: { ...ingestAuth, "content-type": "application/json" }, body, signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) { return { ...out, action: "PARADO", stopReason: `ingest ${e instanceof Error ? e.name : "Error"}` }; }
      out.ingestCalls++; out.statuses.push(ingest.status);
      if (ingest.status === 401 || ingest.status === 503) return { ...out, action: "PARADO", stopReason: `ingest http ${ingest.status}` };
      const resp = await ingest.json().catch(() => ({})) as { followUp?: Req[] };
      for (const f of resp.followUp ?? []) if (!seen.has(f.path)) queue.push(f);
      // Guarda de cota: com o plano quase esgotado, para ANTES de queimar o que resta do dia.
      if (Number.isFinite(remaining) && remaining < minRemaining) return { ...out, observations: out.observations + 1, action: "PARADO", stopReason: "QUOTA_GUARD" };
    }
    out.observations++; out.action = "OBSERVADO";
  }
  return out;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const r = await tick(env);
    // Log estruturado: contagens e status HTTP. Nunca corpo, nunca chave, nunca token.
    console.log(JSON.stringify({ component: "live-producer-direct", cron: controller.cron, scheduledAt: new Date(controller.scheduledTime).toISOString(), ...r }));
  },
} satisfies ExportedHandler<Env>;
