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
 *   REPO      — este processo le o repositorio e decide sozinho. Confiavel.
 *   RUNTIME   — precisa de uma resposta do endpoint. So com `--probe`.
 *   OWNER     — so o dono consegue confirmar (painel, conta, provedor). Nunca vira PASS aqui.
 *
 * Uso:
 *   node scripts/report/readiness.mjs            # so REPO; OWNER/RUNTIME ficam UNKNOWN
 *   node scripts/report/readiness.mjs --probe    # tambem sonda o endpoint publico
 *   node scripts/report/readiness.mjs --json     # saida para maquina
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARGS = new Set(process.argv.slice(2));
const PROBE = ARGS.has("--probe");
const JSON_OUT = ARGS.has("--json");

const ler = (p) => { try { return readFileSync(join(RAIZ, p), "utf-8"); } catch { return null; } };

const itens = [];
function item(id, tipo, descricao, fn) {
  let estado = "UNKNOWN", nota = "";
  if (tipo === "OWNER") {
    nota = "so o dono confirma — ver o Human Gate da #321";
  } else if (tipo === "RUNTIME" && !PROBE) {
    nota = "precisa de --probe";
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

item("support_target_configured", "REPO",
  "o projeto de suporte tem manifesto proprio e project_id distinto", () => {
    const a = ler("supabase/config.toml") || "";
    const b = ler("support-intake/supabase/config.toml");
    if (!b) return { ok: false, nota: "manifesto de suporte ausente" };
    const ref = (t) => (t.match(/^\s*project_id\s*=\s*"([^"]+)"/m) || [])[1];
    const rb = ref(b);
    if (!rb) return { ok: false, nota: "sem project_id" };
    if (rb.startsWith("REPLACE_WITH_")) {
      return { ok: false, nota: "project_id ainda e placeholder — o projeto nao existe" };
    }
    return { ok: ref(a) !== rb };
  });

item("server_kill_switch_exists", "REPO",
  "o interruptor de servidor existe no codigo", () => {
    const h = ler("support-intake/supabase/functions/user-report-intake/handler.js") || "";
    return { ok: /export function intakeHabilitado/.test(h)
                 && /if \(!intakeHabilitado\(env\)\)/.test(h) };
  });

item("server_default_off", "REPO",
  "o interruptor so liga com a string exata (default DESLIGADO)", () => {
    const h = ler("support-intake/supabase/functions/user-report-intake/handler.js") || "";
    return { ok: /HABILITADO_VALOR_EXATO = "true"/.test(h)
                 && /=== HABILITADO_VALOR_EXATO/.test(h) };
  });

item("cors_exact", "REPO",
  "CORS por allowlist exata, sem curinga", () => {
    const h = ler("support-intake/supabase/functions/user-report-intake/handler.js") || "";
    return { ok: /ORIGENS_PERMITIDAS/.test(h)
                 && !/Access-Control-Allow-Origin["'`]\s*\]?\s*:\s*["'`]\*/.test(h) };
  });

item("private_target_invariant", "REPO",
  "o destino e verificado como PRIVADO em runtime, antes de criar", () => {
    const g = ler("support-intake/supabase/functions/user-report-intake/github.js") || "";
    return { ok: /verificarDestinoPrivado/.test(g) && /TARGET_REPO_NOT_PRIVATE/.test(g) };
  });

item("no_high_value_db_credential", "REPO",
  "a funcao nao LE credencial ampla do Supabase", () => {
    const dir = "support-intake/supabase/functions/user-report-intake";
    const todo = readdirSync(join(RAIZ, dir)).filter((f) => /\.(js|ts)$/.test(f))
      .map((f) => ler(`${dir}/${f}`) || "").join("\n");
    const LEITURAS = [/Deno\.env\.get\(\s*["'`]SUPABASE_/, /\benv\.SUPABASE_[A-Z_]+/,
                      /process\.env\.SUPABASE_/];
    return { ok: !LEITURAS.some((r) => r.test(todo)) };
  });

item("browser_secrets_zero", "REPO",
  "nenhum segredo do intake no que vai ao navegador", () => {
    const servidos = execSync("git ls-files '*.js' '*.html' '*.css'", { cwd: RAIZ, encoding: "utf-8" })
      .split("\n").filter(Boolean)
      .filter((p) => !p.startsWith("scripts/") && !p.startsWith("supabase/")
                  && !p.startsWith("support-intake/") && !/\/scripts\//.test(p));
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
    const srv = ler("support-intake/supabase/functions/user-report-intake/policy.js") || "";
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
  "toda resposta carrega x-deploy-sha (F-06)", () => {
    const h = ler("support-intake/supabase/functions/user-report-intake/handler.js") || "";
    const m = ler("support-intake/supabase/functions/user-report-intake/deploy_manifest.js") || "";
    return { ok: /cabecalhoDeDeploy\(\)/.test(h) && /x-deploy-sha/.test(m) };
  });

item("metrics_privacy_safe", "REPO",
  "metricas agregadas existem e nao carregam conteudo (F-11)", () => {
    const a = ler("support-intake/supabase/functions/user-report-intake/abuse.js") || "";
    const h = ler("support-intake/supabase/functions/user-report-intake/handler.js") || "";
    if (!/export async function registrarMetrica/.test(a)) return { ok: false, nota: "ausente" };
    if (!/registrarMetrica\(redis, "aceito"\)/.test(h)) return { ok: false, nota: "nao chamada" };
    // O contador nunca pode carregar relato, chave de rede, reportId nem impressao digital.
    const chamadas = [...h.matchAll(/registrarMetrica\([^,]+,\s*([^)]+)\)/g)].map((m) => m[1]);
    const maus = chamadas.filter((c) => /description|chaveRede|chaveIdem|reportId|\bfp\b/.test(c));
    return { ok: maus.length === 0, nota: maus.join(", ") };
  });

item("notice_version", "REPO",
  "a versao do aviso de privacidade viaja com o relato (F-12)", () => {
    const cli = ler("bolao/shared/js/report_safe_context.js") || "";
    const pol = ler("support-intake/supabase/functions/user-report-intake/policy.js") || "";
    const m = cli.match(/NOTICE_VERSION\s*=\s*"(v[0-9]{1,3})"/);
    return { ok: Boolean(m) && /SCHEMA_NOTICE_VERSION/.test(pol) && /notice_version/.test(pol),
             nota: m ? `cliente em ${m[1]}` : "cliente nao declara versao" };
  });

item("unhandled_exception_sanitized", "REPO",
  "excecao inesperada vira 503 generico, sem vazar (F-15)", () => {
    const h = ler("support-intake/supabase/functions/user-report-intake/handler.js") || "";
    return { ok: /async function tratarRequisicaoInterno/.test(h)
                 && /evento: "report_unhandled"/.test(h) };
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
    const suites = ["scripts/report/test_report_intake.mjs",
                    "scripts/report/test_report_security_ratchets.mjs",
                    "scripts/report/test_report_ui.mjs",
                    "scripts/report/test_report_isolation.mjs"];
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

// ── RUNTIME ─────────────────────────────────────────────────────────────────────────────────

item("primary_endpoint_inert", "RUNTIME",
  "o endpoint no projeto financeiro continua recusando tudo", () => {
    const url = "https://cmhqkkfczotdnssupkni.supabase.co/functions/v1/user-report-intake";
    const out = execSync(
      `curl -s -o /dev/null -w '%{http_code}' -X POST ${url} -H 'Content-Type: application/json' -d '{}'`,
      { encoding: "utf-8" }).trim();
    return { ok: out === "503" || out === "404", nota: `HTTP ${out}` };
  });

// ── OWNER ───────────────────────────────────────────────────────────────────────────────────

item("support_supabase_project_created", "OWNER", "projeto Supabase de suporte existe e esta vazio");
item("supabase_integration_directory_verified", "OWNER",
     "a integracao do GitHub do projeto financeiro observa SO `supabase/`");
item("primary_deployed_function_removed", "OWNER",
     "a funcao ja implantada no projeto financeiro foi deletada");
item("private_repo_verified", "OWNER", "ferrarilabs/support-intake privado, Issues on, Pages off");
item("github_app_scope_verified", "OWNER",
     "GitHub App instalada SO em support-intake, com Issues:write + Metadata:read");
item("redis_configured", "OWNER", "Redis dedicado provisionado, sem dado de producao");
item("idempotency_green", "OWNER", "reporte sintetico ponta a ponta confirma idempotencia");
item("rate_limit_green", "OWNER", "reporte sintetico ponta a ponta confirma limite de taxa");

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
