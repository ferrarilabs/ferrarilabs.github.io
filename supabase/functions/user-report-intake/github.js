/**
 * github.js — GitHub App: token de instalacao e criacao do Issue PRIVADO (Issue #321).
 *
 * ─── POR QUE GitHub App, E NAO PAT ──────────────────────────────────────────────────────────
 *
 * Um PAT (classico ou fine-grained) pertence a uma PESSOA: herda o alcance dela, sobrevive a
 * rotacao de escopo por descuido, e some junto se a conta some. Um GitHub App tem identidade
 * propria, instalacao com escopo por repositorio, e emite token de instalacao que expira em ~1h.
 *
 * Aqui a instalacao e UM repositorio (`support-intake`) e UMA permissao (Issues: write) mais o
 * Metadata: read que o GitHub exige implicitamente. Nada de Contents, Actions, Workflows, Secrets,
 * Administration, Pages, Members.
 *
 * O token de instalacao vive em memoria, e usado e descartado. Nunca e gravado, nunca vai a log.
 *
 * ─── JWT SEM DEPENDENCIA ────────────────────────────────────────────────────────────────────
 *
 * O JWT do App e RS256 e e assinado com Web Crypto, que o runtime ja tem. Nao ha biblioteca nova:
 * a assinatura e uma chamada de `crypto.subtle.sign`, e trazer um pacote para isso adicionaria
 * superficie de supply-chain sem resolver nada. Isso NAO e criptografia artesanal -- o algoritmo e
 * inteiramente do runtime; aqui so se monta o cabecalho, o payload e o base64url.
 */

const enc = new TextEncoder();

export const GITHUB_API = "https://api.github.com";

/** Permissoes que o App DEVE ter, e as que ele NAO pode ter. Documentado e testado. */
export const PERMISSOES = Object.freeze({
  exigidas: { issues: "write", metadata: "read" },
  proibidas: [
    "contents", "actions", "administration", "pull_requests", "checks", "deployments",
    "secrets", "environments", "workflows", "members", "pages", "packages", "security_events",
  ],
});

function b64url(bytes) {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemParaDer(pem) {
  const corpo = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(corpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * JWT do App, RS256, valido por 9 minutos.
 *
 * O GitHub aceita ate 10; usar 9 deixa folga para desvio de relogio sem esticar a vida do token.
 * `iat` recua 60s pelo mesmo motivo -- relogio adiantado no runtime rejeita o token com 401, e um
 * 401 aqui falha fechado, entao a folga evita indisponibilidade por causa de segundos.
 */
export async function assinarJwtDoApp(appId, chavePrivadaPem, agoraSeg = Math.floor(Date.now() / 1000)) {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: agoraSeg - 60, exp: agoraSeg + 540, iss: String(appId) };
  const base = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8", pemParaDer(chavePrivadaPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(base));
  return `${base}.${b64url(sig)}`;
}

async function chamar(fetchImpl, url, opcoes, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...opcoes, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Token de instalacao. Curto, em memoria, nunca persistido, nunca logado. */
export async function obterTokenDeInstalacao({ appId, installationId, chavePrivadaPem, fetchImpl = globalThis.fetch }) {
  const jwt = await assinarJwtDoApp(appId, chavePrivadaPem);
  const r = await chamar(fetchImpl, `${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ferrarilabs-support-intake" },
  });
  if (!r.ok) {
    // NUNCA propagar o corpo: uma resposta de auth do GitHub pode ecoar fragmento de credencial.
    // Um codigo estavel diz o suficiente para operar, e nao vaza nada.
    throw new Error(`GITHUB_AUTH_${r.status}`);
  }
  const j = await r.json();
  return j.token;
}

/**
 * INVARIANTE CENTRAL: o repositorio de destino tem de ser PRIVADO.
 *
 * Esta e a ultima linha entre o relato de um participante e a internet. Uma variavel de ambiente
 * trocada, um repositorio tornado publico por engano, e o proximo reporte vira divulgacao publica.
 * Por isso a visibilidade e conferida NO RUNTIME, contra a API, antes de criar qualquer coisa --
 * nao assumida da configuracao.
 */
export async function verificarDestinoPrivado({ token, owner, repo, fetchImpl = globalThis.fetch }) {
  const r = await chamar(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ferrarilabs-support-intake" },
  });
  if (!r.ok) throw new Error(`GITHUB_REPO_${r.status}`);
  const j = await r.json();
  if (j.private !== true) throw new Error("TARGET_REPO_NOT_PRIVATE");
  return true;
}

/**
 * Reconciliacao: o `report_id` ja existe num Issue recente?
 *
 * Fecha a janela em que o Issue foi criado mas o estado de idempotencia nao chegou a ser gravado.
 * Sem isto, uma queda no instante errado transforma uma nova tentativa em Issue duplicada -- e a
 * duplicata carrega o mesmo relato pessoal outra vez.
 */
export async function encontrarPorReportId({ token, owner, repo, reportId, fetchImpl = globalThis.fetch }) {
  const q = encodeURIComponent(`repo:${owner}/${repo} in:body "${reportId}"`);
  const r = await chamar(fetchImpl, `${GITHUB_API}/search/issues?q=${q}&per_page=5`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ferrarilabs-support-intake" },
  });
  if (!r.ok) return null;                 // busca indisponivel nao pode derrubar o intake
  const j = await r.json();
  const item = (j.items || [])[0];
  return item ? item.number : null;
}

/**
 * Cria o Issue privado.
 *
 * Titulo e labels sao montados pelo SERVIDOR a partir de valores allowlisted. O participante nao
 * escolhe repositorio, titulo, label nem qualquer campo estrutural -- so o corpo do relato, que
 * chega aqui ja inerte e redigido.
 */
export async function criarIssuePrivado({ token, owner, repo, titulo, corpo, labels, fetchImpl = globalThis.fetch }) {
  const r = await chamar(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
               "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28",
               "User-Agent": "ferrarilabs-support-intake" },
    body: JSON.stringify({ title: titulo, body: corpo, labels }),
  });
  if (!r.ok) throw new Error(`GITHUB_CREATE_${r.status}`);
  const j = await r.json();
  return j.number;
}

/** Comentario tecnico numa duplicata. Sem relato novo -- so a contagem. */
export async function comentarOcorrencia({ token, owner, repo, numero, ocorrencia, fetchImpl = globalThis.fetch }) {
  const r = await chamar(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}/issues/${numero}/comments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
               "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28",
               "User-Agent": "ferrarilabs-support-intake" },
    body: JSON.stringify({ body: `Ocorrencia repetida da mesma impressao tecnica: **${ocorrencia}**.\n\n<sub>Comentario automatico. Nenhum relato novo foi anexado.</sub>` }),
  });
  return r.ok;
}
