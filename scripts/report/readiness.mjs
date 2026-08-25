#!/usr/bin/env node
/**
 * readiness.mjs — o unico lugar que responde "da para ligar o canal de reporte?" (Issue #321).
 *
 * ─── A REGRA QUE ORIGINA O ARQUIVO ──────────────────────────────────────────────────────────
 *
 * **UNKNOWN NUNCA e READY.** Um item que este processo nao consegue verificar sozinho -- porque
 * mora no painel do Supabase, na conta do GitHub ou no provedor de Redis -- vale `UNKNOWN`, e um
 * unico `UNKNOWN` derruba o veredito para `NOT_READY`. A alternativa seria um verde que significa
 * "nao achei problema", e num canal que abre uma superficie publica isso e pior que um vermelho.
 *
 * Cada item declara COMO e verificado:
 *
 *   REPO      — este processo le o repositorio e decide sozinho. Hermetico, sem rede.
 *   LIVE      — precisa falar com o mundo (endpoint publico, API do GitHub, API da Cloudflare).
 *               So com `--live`, porque um relatorio que exige rede nao pode ser o modo padrao.
 *   OWNER     — so o dono consegue confirmar (painel, criacao de GitHub App). Nunca vira PASS aqui.
 *
 * ─── POR QUE `OWNER` ENCOLHEU (2026-08-25) ──────────────────────────────────────────────────
 *
 * `OWNER` e o tipo mais caro que existe aqui: um item marcado assim NUNCA fica verde sozinho, entao
 * ele trava o veredito para sempre ate alguem olhar um painel e responder de cabeca. Isso e certo
 * quando a unica fonte de verdade e humana -- e e desperdicio quando existe uma API que responde a
 * mesma pergunta melhor do que a memoria de uma pessoa.
 *
 * Quatro itens que eram `OWNER` viraram `LIVE`, porque `gh` e `wrangler` respondem por eles com
 * evidencia. Dois sumiram por terem deixado de existir junto com a arquitetura que os criou
 * (o projeto Supabase de suporte e o Redis externo -- ver ADR-021). O que sobrou em `OWNER` e
 * genuinamente humano: acao de painel e criacao de GitHub App, que nao tem caminho de API.
 *
 * Uso:
 *   node scripts/report/readiness.mjs            # so REPO; OWNER/LIVE ficam UNKNOWN
 *   node scripts/report/readiness.mjs --live     # tambem verifica endpoint, GitHub e Cloudflare
 *   node scripts/report/readiness.mjs --json     # saida para maquina
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARGS = new Set(process.argv.slice(2));
const LIVE = ARGS.has("--live");
const JSON_OUT = ARGS.has("--json");

const ler = (p) => { try { return readFileSync(join(RAIZ, p), "utf-8"); } catch { return null; } };

/**
 * Onde o intake mora HOJE. Uma constante, e nao um caminho repetido em cada item, porque foi
 * exatamente a repeticao que deixou este arquivo apodrecer: quando o codigo migrou do Supabase para
 * o Cloudflare Worker (ADR-021, PR #331), doze itens continuaram lendo
 * `support-intake/supabase/functions/...`, um diretorio que tinha deixado de existir. `ler()`
 * devolve `null` para arquivo ausente, `null` vira `""`, e `""` nao casa com regex nenhuma -- entao
 * cada um deles virou FAIL silencioso que PARECIA um controle faltando.
 *
 * Um FAIL falso e pior que um erro: ele nao trava nada (o processo sai 0 de proposito) e ensina a
 * ignorar o relatorio inteiro. O gate que impede a reincidencia esta em `test_docs_drift.mjs`
 * ("todo caminho citado aqui existe").
 */
const WORKER = "workers/user-report-intake";
const SRC = `${WORKER}/src`;
const fonteDoWorker = () => ["index.ts", "policy.ts", "github.ts", "state.ts", "identidade.ts"]
  .map((f) => ler(`${SRC}/${f}`) || "").join("\n");

/** O endereco publico decidido em 2026-08-25 (ADR-021, "Endereco publico"). */
const WORKER_ORIGEM =
  "https://ferrarilabs-support-intake.automotive-dashboard-private-status.workers.dev";

const itens = [];
function item(id, tipo, descricao, fn) {
  let estado = "UNKNOWN", nota = "";
  if (tipo === "OWNER") {
    nota = "so o dono confirma — ver o Human Gate da #321";
  } else if (tipo === "LIVE" && !LIVE) {
    nota = "precisa de --live";
  } else {
    try {
      const r = fn();
      estado = r.ok ? "PASS" : "FAIL";
      nota = r.nota || "";
    } catch (e) { estado = "FAIL"; nota = e.message; }
  }
  itens.push({ id, tipo, descricao, estado, nota });
}

// ── REPO ────────────────────────────────────────────────────────────────────────────────────

item("primary_intake_absent", "REPO",
  "o projeto financeiro nao entrega mais o intake", () => {
    const dirs = readdirSync(join(RAIZ, "supabase/functions"), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    const cfg = ler("supabase/config.toml") || "";
    return { ok: !dirs.includes("user-report-intake")
                 && !/^\s*\[functions\.user-report-intake\]/m.test(cfg) };
  });

item("worker_source_configured", "REPO",
  "o Worker isolado tem fonte e manifesto proprios, com o nome esperado", () => {
    const cfg = ler(`${WORKER}/wrangler.jsonc`);
    if (!cfg) return { ok: false, nota: "wrangler.jsonc ausente" };
    const nome = (cfg.match(/"name"\s*:\s*"([^"]+)"/) || [])[1];
    if (nome !== "ferrarilabs-support-intake") {
      return { ok: false, nota: `nome inesperado: ${nome}` };
    }
    if (!ler(`${SRC}/index.ts`)) return { ok: false, nota: "src/index.ts ausente" };
    return { ok: true, nota: nome };
  });

item("worker_bindings_minimos", "REPO",
  "o manifesto NAO declara nenhum caminho para o projeto do dinheiro", () => {
    const cfg = ler(`${WORKER}/wrangler.jsonc`) || "";
    // A propriedade que ADR-021 comprou nao e "o codigo nao usa a credencial" -- e "a credencial
    // nao existe no ambiente". Num Worker o ambiente E a lista de bindings, entao esta e a
    // verificacao literal da fronteira, e nao uma leitura de intencao do codigo.
    const PROIBIDOS = ["d1_databases", "hyperdrive", "services", "r2_buckets", "queues",
                       "kv_namespaces", "mtls_certificates", "vectorize", "browser",
                       "ai", "analytics_engine_datasets", "dispatch_namespaces"];
    const achados = PROIBIDOS.filter((b) => new RegExp(`"${b}"\\s*:`).test(cfg));
    return { ok: achados.length === 0, nota: achados.join(", ") };
  });

item("server_kill_switch_exists", "REPO",
  "o interruptor de servidor existe no codigo", () => {
    const h = ler(`${SRC}/index.ts`) || "";
    return { ok: /export function intakeHabilitado/.test(h)
                 && /if \(!intakeHabilitado\(env\)\)/.test(h) };
  });

item("server_default_off", "REPO",
  "o interruptor so liga com a string exata (default DESLIGADO)", () => {
    const h = ler(`${SRC}/index.ts`) || "";
    const cfg = ler(`${WORKER}/wrangler.jsonc`) || "";
    // Duas metades: o codigo so aceita a string exata, E o valor VERSIONADO e "false". Conferir so
    // o codigo deixaria passar um manifesto que ja nasce ligado.
    const versionadoDesligado = /"REPORT_INTAKE_ENABLED"\s*:\s*"false"/.test(cfg);
    return { ok: /HABILITADO_VALOR_EXATO = "true"/.test(h)
                 && /=== HABILITADO_VALOR_EXATO/.test(h)
                 && versionadoDesligado,
             nota: versionadoDesligado ? "" : "wrangler.jsonc nao versiona o interruptor DESLIGADO" };
  });

item("cors_exact", "REPO",
  "CORS por allowlist exata, sem curinga", () => {
    const h = ler(`${SRC}/index.ts`) || "";
    return { ok: /ORIGENS_PERMITIDAS/.test(h)
                 && !/Access-Control-Allow-Origin["'`]\s*\]?\s*:\s*["'`]\*/.test(h) };
  });

item("private_target_invariant", "REPO",
  "o destino e verificado como PRIVADO em runtime, antes de criar", () => {
    const g = ler(`${SRC}/github.ts`) || "";
    return { ok: /verificarDestinoPrivado/.test(g) && /TARGET_REPO_NOT_PRIVATE/.test(g) };
  });

item("no_high_value_db_credential", "REPO",
  "a funcao nao LE credencial ampla do Supabase", () => {
    const todo = readdirSync(join(RAIZ, SRC)).filter((f) => /\.(js|ts)$/.test(f))
      .map((f) => ler(`${SRC}/${f}`) || "").join("\n");
    const LEITURAS = [/Deno\.env\.get\(\s*["'`]SUPABASE_/, /\benv\.SUPABASE_[A-Z_]+/,
                      /process\.env\.SUPABASE_/];
    return { ok: !LEITURAS.some((r) => r.test(todo)) };
  });

item("browser_secrets_zero", "REPO",
  "nenhum segredo do intake no que vai ao navegador", () => {
    const servidos = execSync("git ls-files '*.js' '*.html' '*.css'", { cwd: RAIZ, encoding: "utf-8" })
      .split("\n").filter(Boolean)
      // O que o NAVEGADOR baixa. Codigo de servidor e de teste cita nome de segredo por
      // necessidade -- e mencao, nao exposicao. `workers/` entrou na lista quando o intake virou
      // Cloudflare Worker; `support-intake/` saiu porque o diretorio deixou de existir.
      .filter((p) => !p.startsWith("scripts/") && !p.startsWith("supabase/")
                  && !p.startsWith("workers/") && !/\/scripts\//.test(p));
    const PROIBIDOS = ["REPORT_GITHUB_PRIVATE_KEY", "REPORT_REDIS_REST_TOKEN",
                       "REPORT_ABUSE_HMAC_SECRET", "SUPABASE_SERVICE_ROLE_KEY"];
    const maus = servidos.filter((p) => {
      const s = ler(p); return s && PROIBIDOS.some((t) => s.includes(t));
    });
    return { ok: maus.length === 0, nota: maus.join(", ") };
  });

item("ui_flag_off", "REPO",
  "a UI esta desligada nos tres apps ativos", () => {
    const apps = ["bolao/cdb2026/js/config.js", "bolao/br2026/js/config.js",
                  "bolao/loterias/powerball/js/config.js"];
    const ligados = apps.filter((p) => {
      const s = ler(p) || "";
      const m = s.match(/reportProblem\s*:\s*\{[\s\S]*?enabled\s*:\s*(true|false)/);
      return !m || m[1] === "true";
    });
    return { ok: ligados.length === 0, nota: ligados.join(", ") };
  });

item("limit_parity", "REPO",
  "os limites do cliente e do servidor concordam (F-05)", () => {
    const cli = ler("bolao/shared/js/report_safe_context.js") || "";
    const srv = ler(`${SRC}/policy.ts`) || "";
    const bl = cli.match(/var LIMITES = \{([\s\S]*?)\n  \};/);
    if (!bl) return { ok: false, nota: "nao consegui ler LIMITES do cliente" };
    const pares = [...bl[1].matchAll(/(\w+):\s*\{([^}]*)\}/g)];
    const divergem = [];
    for (const m of pares) {
      for (const kv of m[2].matchAll(/(\w+):\s*(\d+)/g)) {
        const re = new RegExp(`${m[1]}:\\s*\\{[^}]*${kv[1]}:\\s*${kv[2]}\\b`);
        if (!re.test(srv)) divergem.push(`${m[1]}.${kv[1]}`);
      }
    }
    return { ok: divergem.length === 0, nota: divergem.join(", ") };
  });

item("deploy_manifest", "REPO",
  "toda resposta carrega a identidade da versao publicada (F-06)", () => {
    // O mecanismo MUDOU com ADR-021, e a mudanca e uma melhoria: era `x-deploy-sha`, escrito a mao
    // num manifesto que alguem tinha de manter sincronizado; agora e `x-deploy-id`, alimentado pelo
    // binding `version_metadata` que a propria Cloudflare preenche. Um valor que ninguem mantem e
    // um valor que nao pode divergir.
    const h = ler(`${SRC}/index.ts`) || "";
    const cfg = ler(`${WORKER}/wrangler.jsonc`) || "";
    const bind = /"version_metadata"\s*:\s*\{\s*"binding"\s*:\s*"VERSAO"\s*\}/.test(cfg);
    if (!bind) return { ok: false, nota: "binding version_metadata ausente no wrangler.jsonc" };
    // Precisa estar no caminho normal E no `catch` total -- uma resposta de excecao sem identidade
    // de versao e justamente a que mais custa correlacionar depois.
    const noNormal = /"x-deploy-id": versao/.test(h);
    const noCatch = /"x-deploy-id": String\(env\?\.VERSAO\?\.id/.test(h);
    return { ok: noNormal && noCatch,
             nota: noNormal && noCatch ? "" : "x-deploy-id ausente no caminho normal ou no catch" };
  });

item("metrics_privacy_safe", "REPO",
  "metricas agregadas existem e nao carregam conteudo (F-11)", () => {
    const h = ler(`${SRC}/index.ts`) || "";
    if (!/function metrica\(log: Log/.test(h)) return { ok: false, nota: "ausente" };
    if (!/metrica\(log, "aceito"/.test(h)) return { ok: false, nota: "nao chamada no caminho feliz" };
    // O contador nunca pode carregar relato, chave de rede, reportId nem impressao digital.
    const chamadas = [...h.matchAll(/metrica\(log,\s*([^;]*?)\);/g)].map((m) => m[1]);
    const maus = chamadas.filter((c) =>
      /description|chaveRede|chaveIdem|reportId|\bfp\b|cf-connecting-ip/.test(c));
    return { ok: maus.length === 0, nota: maus.join(" | ") };
  });

item("notice_version", "REPO",
  "a versao do aviso de privacidade viaja com o relato (F-12)", () => {
    const cli = ler("bolao/shared/js/report_safe_context.js") || "";
    const pol = ler(`${SRC}/policy.ts`) || "";
    const m = cli.match(/NOTICE_VERSION\s*=\s*"(v[0-9]{1,3})"/);
    return { ok: Boolean(m) && /SCHEMA_NOTICE_VERSION/.test(pol) && /notice_version/.test(pol),
             nota: m ? `cliente em ${m[1]}` : "cliente nao declara versao" };
  });

item("unhandled_exception_sanitized", "REPO",
  "excecao inesperada vira 503 generico, sem vazar (F-15)", () => {
    const h = ler(`${SRC}/index.ts`) || "";
    // A fronteira total mudou de forma com ADR-021: hoje e o `catch` do `export default fetch`,
    // que devolve SEMPRE o mesmo 503 generico e nunca usa `ctx.passThroughOnException()` -- que
    // mandaria a requisicao para a origem e esconderia o defeito em vez de trata-lo.
    return { ok: /evento: "report_excecao_nao_tratada"/.test(h)
                 && !/passThroughOnException\(\)/.test(h.replace(/\/\*[\s\S]*?\*\//g, "")) };
  });

item("no_guaranteed_reply_ux", "REPO",
  "a UI diz que nao e suporte e nao garante resposta (F-14)", () => {
    const ui = ler("bolao/shared/js/report_ui.js") || "";
    const faltando = [];
    for (const l of ["pt-BR", "en-US", "es", "ja"]) {
      const bloco = ui.split(`"${l}": {`)[1] || "";
      if (!/noReply:\s*"[^"]{20,}"/.test(bloco.slice(0, 2200))) faltando.push(l);
    }
    return { ok: faltando.length === 0, nota: faltando.join(", ") };
  });

item("security_tests_green", "REPO",
  "as suites do canal passam", () => {
    // Esta lista precisa bater com os ids do grupo `app` em `scripts/verify.mjs`. Ela apontava
    // para `test_report_isolation.mjs`, que nunca existiu sob esse nome depois de ADR-021 -- o
    // arquivo e `test_worker_isolation.mjs`. Faltavam ainda as duas suites nascidas na migracao.
    const suites = ["scripts/report/test_report_intake.mjs",
                    "scripts/report/test_report_security_ratchets.mjs",
                    "scripts/report/test_report_ui.mjs",
                    "scripts/report/test_worker_intake.mjs",
                    "scripts/report/test_worker_isolation.mjs",
                    "scripts/report/test_docs_drift.mjs"];
    const ausentes = suites.filter((s) => !existsSync(join(RAIZ, s)));
    if (ausentes.length) {
      // Suite exigida que nao existe e FAIL, nao "nada a fazer": a lista descreve o que precisa
      // proteger o canal antes de liga-lo, e um arquivo que sumiu significa que algo deixou de ser
      // protegido. Melhor essa frase que um stack trace de MODULE_NOT_FOUND.
      return { ok: false, nota: `suite ausente: ${ausentes.join(", ")}` };
    }
    const quebradas = [];
    for (const s of suites) {
      try { execSync(`node ${s}`, { cwd: RAIZ, stdio: "pipe" }); }
      catch { quebradas.push(s); }
    }
    return { ok: quebradas.length === 0, nota: quebradas.join(", ") };
  });

item("client_endpoint_configured", "REPO",
  "os tres apps apontam para o Worker, e a CSP permite EXATAMENTE essa origem", () => {
    const apps = { "bolao/br2026": "index.html", "bolao/cdb2026": "index.html",
                   "bolao/loterias/powerball": "index.html" };
    const problemas = [];
    for (const [dir, html] of Object.entries(apps)) {
      const cfg = ler(`${dir}/js/config.js`) || "";
      const m = cfg.match(/reportProblem\s*:\s*\{[\s\S]*?endpoint\s*:\s*"([^"]*)"/);
      if (!m) { problemas.push(`${dir}: sem endpoint`); continue; }
      if (!m[1].startsWith(WORKER_ORIGEM)) {
        problemas.push(`${dir}: endpoint nao e o Worker`);
      }
      const pagina = ler(`${dir}/${html}`) || "";
      const csp = (pagina.match(/connect-src([^;]*);/) || [])[1] || "";
      if (!csp.includes(WORKER_ORIGEM)) problemas.push(`${dir}: CSP nao permite o Worker`);
      // Curinga aqui autorizaria o Worker de QUALQUER conta Cloudflare do mundo a receber POST
      // desta pagina. `*.workers.dev` nao e "o nosso Worker", e o dominio compartilhado inteiro.
      if (/\*\.workers\.dev/.test(csp)) problemas.push(`${dir}: CSP usa curinga em workers.dev`);
    }
    return { ok: problemas.length === 0, nota: problemas.join(" | ") };
  });

// ── LIVE ────────────────────────────────────────────────────────────────────────────────────

const curl = (args) => execSync(`curl -s --max-time 20 ${args}`, { encoding: "utf-8" }).trim();

item("primary_endpoint_inert", "LIVE",
  "o endpoint no projeto financeiro continua recusando tudo", () => {
    const url = "https://cmhqkkfczotdnssupkni.supabase.co/functions/v1/user-report-intake";
    const out = curl(`-o /dev/null -w '%{http_code}' -X POST ${url} -H 'Content-Type: application/json' -d '{}'`);
    return { ok: out === "503" || out === "404", nota: `HTTP ${out}` };
  });

item("worker_deployed_and_disabled", "LIVE",
  "o Worker responde, e responde DESLIGADO", () => {
    // Tres perguntas de uma vez, porque separa-las esconderia o caso que importa: um Worker que
    // existe MAS esta ligado e pior que um Worker que nao existe.
    const cab = curl(`-D - -o /dev/null -X POST ${WORKER_ORIGEM}/ ` +
                     `-H 'Content-Type: application/json' -d '{}'`);
    const status = (cab.match(/HTTP\/[\d.]+ (\d{3})/) || [])[1];
    if (status === "404" || !status) return { ok: false, nota: "Worker nao implantado" };
    if (status !== "503") return { ok: false, nota: `POST devolveu ${status}, esperado 503 (LIGADO?)` };
    if (!/x-deploy-id:/i.test(cab)) return { ok: false, nota: "resposta sem x-deploy-id (F-06)" };
    const permitida = curl(`-o /dev/null -w '%{http_code}' -X OPTIONS ${WORKER_ORIGEM}/ ` +
                           `-H 'Origin: https://www.ferrarilabs.com'`);
    const proibida = curl(`-o /dev/null -w '%{http_code}' -X OPTIONS ${WORKER_ORIGEM}/ ` +
                          `-H 'Origin: https://evil.invalid'`);
    if (permitida !== "204") return { ok: false, nota: `preflight permitido devolveu ${permitida}` };
    if (proibida !== "403") return { ok: false, nota: `preflight proibido devolveu ${proibida}` };
    return { ok: true, nota: "POST 503 · preflight 204/403 · x-deploy-id presente" };
  });

item("private_repo_verified", "LIVE",
  "ferrarilabs/support-intake privado, Issues on, Pages off", () => {
    // Era OWNER. Nao precisava ser: a API do GitHub responde isto com mais confianca que a memoria
    // de qualquer pessoa, e o Worker ja reconfere `private` em runtime antes de criar cada Issue.
    let j;
    try {
      j = JSON.parse(execSync("gh api repos/ferrarilabs/support-intake", { encoding: "utf-8", stdio: ["pipe","pipe","pipe"] }));
    } catch { return { ok: false, nota: "gh indisponivel ou sem acesso ao repositorio" }; }
    const ruins = [];
    if (j.private !== true) ruins.push("NAO E PRIVADO");
    if (j.has_issues !== true) ruins.push("Issues desligadas");
    if (j.has_pages === true) ruins.push("Pages LIGADO");
    if (j.is_template === true) ruins.push("e template");
    if (j.archived === true) ruins.push("arquivado");
    return { ok: ruins.length === 0, nota: ruins.join(", ") || "private · issues · sem pages" };
  });

item("worker_secrets_provisioned", "LIVE",
  "os quatro segredos exigidos existem no Worker (NOMES, nunca valores)", () => {
    const exigidos = ["REPORT_GITHUB_APP_ID", "REPORT_GITHUB_INSTALLATION_ID",
                      "REPORT_GITHUB_PRIVATE_KEY", "REPORT_ABUSE_HMAC_SECRET"];
    let lista;
    try {
      lista = JSON.parse(execSync(
        "npx --yes wrangler@4 secret list --name ferrarilabs-support-intake",
        { encoding: "utf-8", cwd: join(RAIZ, WORKER), stdio: ["pipe","pipe","pipe"] }));
    } catch { return { ok: false, nota: "wrangler sem auth, ou Worker inexistente" }; }
    // `secret list` devolve NOME e tipo. Nunca valor -- nao existe API que devolva o valor de um
    // segredo de Worker, e e por isso que este item pode rodar em CI sem risco.
    const nomes = new Set((lista || []).map((x) => x.name));
    const faltando = exigidos.filter((n) => !nomes.has(n));
    return { ok: faltando.length === 0, nota: faltando.length ? `faltando: ${faltando.join(", ")}` : `${nomes.size} presentes` };
  });

// ── OWNER ───────────────────────────────────────────────────────────────────────────────────
//
// So o que NAO tem caminho de API. Criar GitHub App e acao de navegador (nem o fluxo de manifesto
// dispensa o redirect), e configuracao de integracao vive no painel do Supabase.

item("supabase_integration_directory_verified", "OWNER",
     "a integracao do GitHub do projeto financeiro observa SO `supabase/`");
item("primary_deployed_function_removed", "OWNER",
     "a funcao ja implantada no projeto financeiro foi deletada");
item("github_app_created_and_installed", "OWNER",
     "GitHub App criada e instalada SO em support-intake, com Issues:write + Metadata:read");
item("synthetic_acceptance_green", "OWNER",
     "reporte sintetico ponta a ponta confirma Issue unica, idempotencia e limite de taxa");

// ── veredito ────────────────────────────────────────────────────────────────────────────────

const falhas = itens.filter((i) => i.estado === "FAIL");
const desconhecidos = itens.filter((i) => i.estado === "UNKNOWN");
const veredito = falhas.length ? "NOT_READY" : (desconhecidos.length ? "NOT_READY" : "READY");

if (JSON_OUT) {
  console.log(JSON.stringify({ gerado: new Date().toISOString(), veredito, itens }, null, 2));
} else {
  console.log("\nProntidao do canal de reporte (#321)\n");
  const simbolo = { PASS: "✓", FAIL: "✗", UNKNOWN: "?" };
  for (const i of itens) {
    console.log(`  ${simbolo[i.estado]} [${i.tipo.padEnd(7)}] ${i.id}`);
    console.log(`      ${i.descricao}${i.nota ? "  — " + i.nota : ""}`);
  }
  console.log(`\n  PASS ${itens.filter((i) => i.estado === "PASS").length}` +
              ` · FAIL ${falhas.length} · UNKNOWN ${desconhecidos.length}`);
  console.log(`\n  VEREDITO: ${veredito}\n`);
  if (veredito !== "READY") {
    console.log("  UNKNOWN nao e READY: um item que ninguem verificou nao e um item que passou.\n");
  }
}

// Sai 0 de proposito: isto e um RELATORIO de prontidao, nao um gate de CI. Reprovar o `npm run
// check` porque o dono ainda nao criou um projeto Supabase tornaria o pipeline vermelho por algo
// que nenhum commit conserta -- e um vermelho permanente e um vermelho que se aprende a ignorar.
// Quem exige verde aqui e a decisao de LIGAR o canal, e essa e humana.
process.exit(0);
