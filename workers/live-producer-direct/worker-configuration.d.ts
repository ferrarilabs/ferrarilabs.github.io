// Tipos do ambiente (escritos à mão: o arquivo é do mesmo formato que `wrangler types` gera, mas
// este Worker ainda não foi implantado nem tipado pelo wrangler). Regenerar com `wrangler types`.
interface Env {
	PRODUCER_MODE: "off" | "shadow" | "authoritative";
	INGEST_URL: string;
	OBSERVATIONS_PER_TICK: string;
	INTERVAL_MS: string;
	MIN_REMAINING_REQUESTS: string;
	API_FOOTBALL_KEY: string;
	LIVE_INGEST_TOKEN: string;
}
