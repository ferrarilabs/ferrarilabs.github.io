#!/usr/bin/env node
/**
 * provisionar.mjs — o unico passo que fecha o provisionamento do canal de reporte (Issue #321).
 *
 * ─── O QUE ESTE ARQUIVO EXISTE PARA EVITAR ──────────────────────────────────────────────────
 *
 * Provisionar este canal a mao sao seis comandos, tres deles carregando segredo, numa ordem em que
 * errar e silencioso: uma App instalada em repositorio demais, um `installation_id` copiado da
 * instalacao errada, uma PEM que passou pelo terminal e ficou no historico. Nenhum desses erros
 * aparece no `wrangler deploy` -- todos aparecem depois, no primeiro relato de um participante.
 *
 * Entao o passo humano fica sendo UM: criar a GitHub App no navegador (nao existe API para isso,
 * nem o fluxo de manifesto dispensa o redirect) e baixar a chave. O resto e aqui, verificado.
 *
 * ─── DISCIPLINA DE SEGREDO ──────────────────────────────────────────────────────────────────
 *
 * Nenhum valor secreto e impresso, gravado em arquivo, passado por argumento de linha de comando
 * (argumento aparece em `ps` e no historico) nem interpolado numa string de shell. A PEM e LIDA do
 * caminho que voce indicar e escrita direto no stdin do `wrangler`. O HMAC nasce de
 * `crypto.randomBytes` e vai pelo mesmo caminho, sem nunca existir como texto fora da memoria.
 *
 * ─── O QUE ELE SE RECUSA A FAZER ────────────────────────────────────────────────────────────
 *
 * Ele NAO liga o canal. `REPORT_INTAKE_ENABLED` continua `"false"` -- versionado, auditavel, e
 * conferido no fim. Provisionar segredo e preparacao; ligar e outro ato, e e humano.
 *
 * Uso:
 *   node provisionar.mjs <APP_ID> <caminho/para/chave-privada.pem>
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createSign, randomBytes } from "node:crypto";

const WORKER = "ferrarilabs-support-intake";
const DONO = "ferrarilabs";
const REPO = "support-intake";
const ALVO = `${DONO}/${REPO}`;

const [appId, pemPath] = process.argv.slice(2);
if (!appId || !pemPath) {
  console.error("uso: node provisionar.mjs <APP_ID> <caminho/para/chave.pem>");
  process.exit(2);
}

const passo = (n, t) => console.log(`\n[${n}] ${t}`);
const ok = (t) => console.log(`  ✓ ${t}`);
const morrer = (t) => { console.error(`  ✗ ${t}`); process.exit(1); };

// ── 1. Pre-condicoes ────────────────────────────────────────────────────────────────────────
passo(1, "Pre-condicoes");

if (!existsSync(pemPath)) morrer(`chave privada nao encontrada: ${pemPath}`);
const pem = readFileSync(pemPath, "utf-8");
if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem)) {
  morrer("o arquivo indicado nao parece uma chave privada PEM");
}
ok("chave privada legivel (conteudo nunca e impresso)");

const wrangler = (args, entrada) => execFileSync("npx", ["--yes", "wrangler@4", ...args], {
  cwd: import.meta.dirname, encoding: "utf-8", input: entrada, stdio: ["pipe", "pipe", "pipe"],
});

try { wrangler(["whoami"]); ok("wrangler autenticado"); }
catch { morrer("wrangler sem autenticacao — rode `npx wrangler login`"); }

let repo;
try { repo = JSON.parse(execFileSync("gh", ["api", `repos/${ALVO}`], { encoding: "utf-8" })); }
catch { morrer(`nao consegui ler ${ALVO} pela API do GitHub`); }

// O Worker reconfere isto em runtime antes de CADA Issue. Conferir aqui tambem nao e redundancia
// inutil: e a diferenca entre descobrir agora e descobrir com um relato real na mao.
if (repo.private !== true) morrer(`${ALVO} NAO e privado — abortando`);
if (repo.has_issues !== true) morrer(`${ALVO} esta com Issues desligadas`);
ok(`${ALVO}: privado, Issues ligadas`);

// ── 2. Descobrir e VERIFICAR a instalacao ───────────────────────────────────────────────────
passo(2, "Instalacao da GitHub App");

const b64url = (b) => Buffer.from(b).toString("base64url");
const agora = Math.floor(Date.now() / 1000);
const cabecalho = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const carga = b64url(JSON.stringify({ iat: agora - 60, exp: agora + 540, iss: String(appId) }));
const assinador = createSign("RSA-SHA256");
assinador.update(`${cabecalho}.${carga}`);
const jwt = `${cabecalho}.${carga}.${assinador.sign(pem, "base64url")}`;

const gh = async (url, token, esquema = "Bearer") => {
  const r = await fetch(url, {
    headers: { Authorization: `${esquema} ${token}`, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": WORKER },
  });
  if (!r.ok) morrer(`GitHub respondeu ${r.status} em ${url.replace("https://api.github.com", "")}`);
  return r.json();
};

const instalacoes = await gh("https://api.github.com/app/installations", jwt);
if (instalacoes.length === 0) morrer("a App existe mas nao esta instalada em lugar nenhum");
if (instalacoes.length > 1) {
  morrer(`a App esta instalada em ${instalacoes.length} contas — esperado exatamente 1`);
}
const inst = instalacoes[0];
ok(`instalacao encontrada em ${inst.account?.login}`);

// Escopo por repositorio, e nao "todos". `all` significaria que a App alcanca ferrarilabs.github.io
// — o repositorio do site, com o codigo de scoring e de pagamento dentro.
if (inst.repository_selection !== "selected") {
  morrer(`repository_selection = "${inst.repository_selection}" — precisa ser "selected"`);
}

const P = inst.permissions ?? {};
if (P.issues !== "write") morrer(`permissao issues = "${P.issues}" — precisa ser "write"`);
const extras = Object.keys(P).filter((k) => k !== "issues" && k !== "metadata");
if (extras.length) morrer(`permissoes alem do minimo: ${extras.join(", ")}`);
ok(`permissoes minimas: issues=write, metadata=${P.metadata ?? "(implicito)"}`);

const tok = await (async () => {
  const r = await fetch(`https://api.github.com/app/installations/${inst.id}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": WORKER },
  });
  if (!r.ok) morrer(`nao consegui emitir token de instalacao (HTTP ${r.status})`);
  return (await r.json()).token;
})();

const alcance = await gh("https://api.github.com/installation/repositories", tok, "token");
const nomes = (alcance.repositories ?? []).map((r) => r.full_name);
if (nomes.length !== 1 || nomes[0] !== ALVO) {
  morrer(`a App alcanca ${nomes.length} repositorio(s): ${nomes.join(", ")} — esperado so ${ALVO}`);
}
ok(`alcance verificado: exatamente ${ALVO}`);

// ── 3. Segredos ─────────────────────────────────────────────────────────────────────────────
passo(3, "Segredos do Worker (nomes; valores nunca aparecem)");

const existentes = new Set(JSON.parse(wrangler(["secret", "list", "--name", WORKER]) || "[]")
  .map((s) => s.name));

const por = (nome, valor) => {
  wrangler(["secret", "put", nome, "--name", WORKER], valor);
  ok(`${nome} provisionado`);
};

por("REPORT_GITHUB_APP_ID", String(appId));            // identificador, nao segredo — mas o
por("REPORT_GITHUB_INSTALLATION_ID", String(inst.id)); // Worker os le do mesmo lugar
por("REPORT_GITHUB_PRIVATE_KEY", pem);

if (existentes.has("REPORT_ABUSE_HMAC_SECRET")) {
  ok("REPORT_ABUSE_HMAC_SECRET ja existe — preservado (rotacionar apaga as chaves de taxa em voo)");
} else {
  por("REPORT_ABUSE_HMAC_SECRET", randomBytes(48).toString("base64"));
}

// ── 4. Deploy ───────────────────────────────────────────────────────────────────────────────
passo(4, "Deploy (INERTE — o interruptor continua desligado)");
const saida = wrangler(["deploy"]);
ok(saida.split("\n").filter((l) => /Deployed|Current Version|workers\.dev/.test(l)).join(" | ")
   || "deploy concluido");

// ── 5. Aceitacao do estado desligado ────────────────────────────────────────────────────────
passo(5, "Verificacao: o canal responde, e responde DESLIGADO");

const base = `https://${WORKER}.automotive-dashboard-private-status.workers.dev/`;
const r1 = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
if (r1.status !== 503) morrer(`POST devolveu ${r1.status} — esperado 503 (o canal esta LIGADO?)`);
if (!r1.headers.get("x-deploy-id")) morrer("resposta sem x-deploy-id (F-06)");
ok(`POST -> 503 UNAVAILABLE · x-deploy-id: ${r1.headers.get("x-deploy-id")}`);

const r2 = await fetch(base, { method: "OPTIONS", headers: { Origin: "https://www.ferrarilabs.com" } });
if (r2.status !== 204) morrer(`preflight de origem PERMITIDA devolveu ${r2.status} — esperado 204`);
ok("preflight de origem permitida -> 204");

const r3 = await fetch(base, { method: "OPTIONS", headers: { Origin: "https://evil.invalid" } });
if (r3.status !== 403) morrer(`preflight de origem PROIBIDA devolveu ${r3.status} — esperado 403`);
if (r3.headers.get("access-control-allow-origin")) morrer("origem proibida recebeu cabecalho CORS");
ok("preflight de origem proibida -> 403, sem cabecalho CORS");

console.log(`
──────────────────────────────────────────────────────────────────────────────
  BACKEND_PROVISIONED_DISABLED

  O Worker esta implantado e INERTE. Ligar o canal sao duas chaves, nesta ordem:

    1. servidor:  npx wrangler deploy   (com "REPORT_INTAKE_ENABLED": "true" no wrangler.jsonc)
    2. cliente:   reportProblem.enabled = true nos apps

  Antes disso, rode a aceitacao sintetica:
    node scripts/report/readiness.mjs --live
──────────────────────────────────────────────────────────────────────────────
`);
