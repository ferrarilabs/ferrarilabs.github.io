/**
 * ferrarilabs-live-producer — o AGENDADOR do cache ao vivo (#246).
 *
 * ─── POR QUE ELE NÃO BUSCA A ESPN ───────────────────────────────────────────────────────────
 *
 * A primeira versão deste Worker buscava a ESPN direto. MEDIDO em produção (2026-08-28): 403 em
 * toda execução, com cabeçalho padrão E com identificação honesta do app
 * (`ferrarilabs-bolao/1.0`). A Akamai bloqueia o EGRESSO do Cloudflare do mesmo jeito que bloqueia
 * o do Supabase Edge Runtime — é por IP de datacenter, não por cabeçalho. Testar isso custou dois
 * deploys e valeu: a alternativa era pedir credencial nova baseada num palpite.
 *
 * Quem alcança a ESPN é o runner do GitHub Actions (medido: `WRITTEN (upstream 200)`).
 *
 * ─── ENTÃO CADA UM FAZ O QUE SABE ───────────────────────────────────────────────────────────
 *
 *     Cloudflare  →  cadência confiável (cron de 5 min, comprovado)  →  mas NÃO alcança a fonte
 *     GitHub      →  alcança a fonte                                 →  mas cadência de 15 a 642 min
 *
 * Cada runtime tem METADE do que o pipeline precisa. Este Worker compõe os dois: ele acorda no
 * horário e DISPARA o produtor que já existe e já funciona. É o que o keeper manual fazia — só
 * que agora como infraestrutura, e não como processo na máquina de alguém.
 *
 * ─── CREDENCIAL ─────────────────────────────────────────────────────────────────────────────
 *
 * O token do GitHub aqui é de escopo mínimo: `actions: write` num único repositório. Ele não lê
 * código, não escreve conteúdo, não acessa banco e não alcança participante, pagamento ou ledger.
 * Mesmo princípio do ADR-021 — a credencial sensível não existe neste runtime.
 */

const TIMEOUT_MS = 10_000;
const API_VERSION = "2026-03-10";

export type Resultado = {
  acao: "DISPARADO" | "SEM_CREDENCIAL" | "CONFIG_INVALIDA" | "RECUSADO";
  detalhe: string;
};

function configuracaoValida(env: Env): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GH_REPO)
    && /^[A-Za-z0-9_.-]+\.ya?ml$/.test(env.GH_WORKFLOW);
}

/**
 * Dispara o produtor. Puro o suficiente para teste: `fetchImpl` é injetável.
 *
 * Uma falha aqui NÃO apaga nada: o cache anterior permanece e o gateway continua servindo
 * último-bom-conhecido até o teto dele. Um tick perdido é um tick perdido, não corrupção.
 */
export async function dispararProdutor(
  env: Env,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<Resultado> {
  if (!env.GH_DISPATCH_TOKEN) {
    // FALHA FECHADA: sem credencial não se tenta, para não gerar 401 repetido.
    return { acao: "SEM_CREDENCIAL", detalhe: "GH_DISPATCH_TOKEN ausente" };
  }
  if (!configuracaoValida(env)) {
    // O token nunca e enviado se repo/workflow sairem da forma fechada versionada.
    return { acao: "CONFIG_INVALIDA", detalhe: "GH_REPO ou GH_WORKFLOW invalido" };
  }
  const [owner, repo] = env.GH_REPO.split("/");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    + `/actions/workflows/${encodeURIComponent(env.GH_WORKFLOW)}/dispatches`;
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: {
        // O token vai em cabeçalho, nunca em query: query aparece em log de proxy e em Referer.
        authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "ferrarilabs-live-producer",
        "x-github-api-version": API_VERSION,
      },
      body: JSON.stringify({ ref: "main", inputs: { dry_run: "false", force: "false" } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A API atual devolve 200 com a identidade do run; versoes anteriores devolviam 204.
    if (r.status !== 200 && r.status !== 204) {
      return { acao: "RECUSADO", detalhe: `dispatch http ${r.status}` };
    }
  } catch (e) {
    const nome = e instanceof Error ? e.name : "Error";
    return { acao: "RECUSADO", detalhe: `dispatch ${nome}` };
  }
  return { acao: "DISPARADO", detalhe: new Date().toISOString() };
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const r = await dispararProdutor(env);
    // Log estruturado, sem segredo e sem dado de participante.
    console.log(JSON.stringify({
      component: "live-producer",
      action: r.acao,
      detail: r.detalhe,
      cron: controller.cron,
      scheduledAt: new Date(controller.scheduledTime).toISOString(),
    }));
  },
} satisfies ExportedHandler<Env>;
