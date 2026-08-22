#!/usr/bin/env node
/**
 * GERADOR DO ARTEFATO PUBLICO (Issue #303-A) — banco autoritativo -> projecao publica.
 *
 * ─── COMO ISTO SE ENCAIXA NUM SITE SEM BUILD ────────────────────────────────────────────────
 *
 * O GitHub Pages serve arquivos estaticos e este projeto nao tem passo de build. Nao da para
 * "gerar no deploy". A saida entao e um ARTEFATO COMMITADO
 * (`data/public_projection.generated.json`), produzido por quem tem credencial, e o `data.js`
 * publicado precisa concordar com ele.
 *
 * Isso divide o problema em duas metades que se verificam sozinhas:
 *
 *   --write   (precisa de credencial)  le o banco e regrava o artefato
 *   --check   (NAO precisa de nada)    compara `data.js` com o artefato commitado e reprova na
 *                                      divergencia -- e o que roda no CI
 *
 * O `--check` e o que impede uma edicao manual de virar verdade financeira: mexer no valor dentro
 * do `data.js` faz o CI reprovar, porque o artefato derivado do banco nao concorda.
 *
 * Uso:
 *   node generate_public_projection.mjs --check
 *   SUPABASE_SERVICE_ROLE_KEY=... node generate_public_projection.mjs --write
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { projetarSorteio, assertSemPII, CAMPOS_PUBLICOS, CAMPOS_DERIVADOS, CAMPOS_APRESENTACAO } from "./public_projection.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = resolve(AQUI, "..");
const ARTEFATO = join(RAIZ_APP, "data/public_projection.generated.json");
const DATA_JS = join(RAIZ_APP, "js/data.js");

const SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co";

/**
 * Extrai os arrays `participants:` de `data.js` sem executar o arquivo.
 *
 * `data.js` define funcoes (`parseResult`, `prizeTable`) e mexe em `window`. Avaliar o arquivo
 * inteiro so para ler dados seria dar a um artefato de dados o poder de rodar codigo no gate.
 * Um `Function` restrito a EXPRESSAO do array nao tem esse alcance.
 */
export function participantesDoDataJs(src) {
  const out = [];
  const re = /participants:\s*\[/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex - 1, prof = 0, fim = -1;
    for (; i < src.length; i++) {
      if (src[i] === "[") prof++;
      else if (src[i] === "]") { prof--; if (prof === 0) { fim = i; break; } }
    }
    if (fim === -1) throw new Error("array `participants` sem fechamento em data.js");
    const trecho = src.slice(re.lastIndex - 1, fim + 1);
    if (/\bfunction\b|=>|\brequire\b|\bimport\b/.test(trecho)) {
      throw new Error("array `participants` contem codigo executavel — recusado");
    }
    out.push(new Function(`return (${trecho});`)());
    re.lastIndex = fim;
  }
  return out;
}

/**
 * Normaliza para comparacao: SO os campos que o banco possui.
 *
 * Comparar `data`/`hora`/`status`/`state` seria comparar `data.js` contra uma ausencia — o banco
 * nao guarda nenhum dos quatro (ver CAMPOS_APRESENTACAO). Um gate que reprova por dado que a
 * autoridade nunca teve nao mede integridade, mede a lacuna do schema.
 */
export function canonizar(linhas) {
  return linhas.map((l) => {
    const o = {};
    for (const c of CAMPOS_DERIVADOS) o[c] = l[c] === undefined ? null : l[c];
    return o;
  });
}

/** Nome do participante mascarado. O log de CI e publico e nao precisa da lista de quem pagou. */
const mascarar = (n) => {
  const s = String(n ?? "");
  return s.length <= 2 ? "…" : `${s.slice(0, 2)}…${s.slice(-1)} (${s.length})`;
};

/**
 * Compara sorteio a sorteio, casando por NOME e nao por posicao.
 *
 * A ordem das linhas e apresentacao: o `data.js` lista na ordem em que as pessoas entraram, e o
 * banco devolve na ordem que o Postgres quiser. Comparar posicionalmente acusava dezenas de
 * "divergencias" que eram a mesma pessoa em indices diferentes — ruido que esconderia uma
 * divergencia de verdade no meio.
 */
export function divergencias(doDataJs, doArtefato) {
  const problemas = [];
  if (doDataJs.length !== doArtefato.length) {
    problemas.push(`numero de sorteios difere: data.js tem ${doDataJs.length}, artefato tem ${doArtefato.length}`);
    return problemas;
  }
  for (let s = 0; s < doDataJs.length; s++) {
    const a = canonizar(doDataJs[s]), b = canonizar(doArtefato[s]);

    const porNome = new Map(b.map((l) => [l.name, l]));
    const soNoDataJs = a.filter((l) => !porNome.has(l.name));
    const nomesDataJs = new Set(a.map((l) => l.name));
    const soNoArtefato = b.filter((l) => !nomesDataJs.has(l.name));

    for (const l of soNoDataJs) {
      problemas.push(`sorteio ${s}: participante ${mascarar(l.name)} existe em data.js e NAO no banco`);
    }
    for (const l of soNoArtefato) {
      problemas.push(`sorteio ${s}: participante ${mascarar(l.name)} existe no banco e NAO em data.js`);
    }

    for (const linha of a) {
      const par = porNome.get(linha.name);
      if (!par) continue;
      for (const c of CAMPOS_DERIVADOS) {
        if (c === "name") continue;   // ja casado por identidade
        if (JSON.stringify(linha[c]) !== JSON.stringify(par[c])) {
          problemas.push(`sorteio ${s}, ${mascarar(linha.name)}, campo \`${c}\`: ` +
            `data.js=${JSON.stringify(linha[c])} banco=${JSON.stringify(par[c])}`);
        }
      }
    }
  }
  return problemas;
}

async function lerBanco() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente — `--write` le o banco autoritativo");
  const get = async (path) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path}`);
    return r.json();
  };
  // SELECT explicito por coluna: nem o transporte carrega `email`/`phone`/`external_reference`.
  // Se a allowlist um dia errar, o dado sensivel nem chegou ao processo para poder vazar.
  return {
    draws: await get("lottery_draws?select=draw_id,draw_date&order=draw_date"),
    participantes: await get("lottery_participants?select=participant_id,display_name,state"),
    participacoes: await get("lottery_participations?select=participation_id,participant_id,draw_id,cotas"),
    transacoes: await get("lottery_payment_transactions?select=participation_id,type,amount,method,paid_at"),
  };
}

/**
 * Linhas vindas de um arquivo, para quem tem acesso ao banco pelo CLI mas nao pela service key.
 *
 * O CAMINHO DE PROJECAO E O MESMO — muda so de onde as linhas chegam. Fosse um segundo caminho,
 * o artefato poderia ser gerado por uma logica que nenhum teste cobre.
 */
function lerArquivo(caminho) {
  const d = JSON.parse(readFileSync(caminho, "utf-8"));
  for (const k of ["draws", "participantes", "participacoes", "transacoes"]) {
    if (!Array.isArray(d[k])) throw new Error(`arquivo de linhas sem \`${k}\``);
  }
  return d;
}

async function escrever(deArquivo) {
  const { draws, participantes, participacoes, transacoes } =
    deArquivo ? lerArquivo(deArquivo) : await lerBanco();
  // O artefato guarda SO os campos que o banco possui. Gravar `data`/`hora`/`status`/`state` como
  // `null` daria a impressao de que a autoridade os conhece e eles estao vazios — quando na verdade
  // ela nao os guarda. Ausencia declarada e diferente de valor ausente.
  const sorteios = draws.map((d) => canonizar(projetarSorteio({
    participantes,
    participacoes: participacoes.filter((p) => p.draw_id === d.draw_id),
    transacoes,
  })).sort((x, y) => String(x.name).localeCompare(String(y.name), "pt-BR")));
  assertSemPII(sorteios);
  const doc = {
    _gerado_por: "bolao/loterias/powerball/scripts/generate_public_projection.mjs",
    _fonte: "PostgreSQL/Supabase — sistema de registro autoritativo (Issue #303-A)",
    _aviso: "ARTEFATO DERIVADO. Nao edite a mao: `--check` compara `js/data.js` com este arquivo e reprova na divergencia.",
    campos_derivados_do_banco: [...CAMPOS_DERIVADOS],
    campos_de_apresentacao_nao_derivados: [...CAMPOS_APRESENTACAO],
    sorteios,
  };
  writeFileSync(ARTEFATO, JSON.stringify(doc, null, 2) + "\n");
  console.log(`✓ artefato regravado: ${sorteios.length} sorteio(s), ` +
              `${sorteios.reduce((a, s) => a + s.length, 0)} linha(s)`);
}

function conferir() {
  let doc;
  try { doc = JSON.parse(readFileSync(ARTEFATO, "utf-8")); }
  catch { console.log(`\n✗ artefato ausente ou ilegivel: ${ARTEFATO}`); process.exit(1); }

  assertSemPII(doc.sorteios);
  const problemas = divergencias(participantesDoDataJs(readFileSync(DATA_JS, "utf-8")), doc.sorteios);

  console.log("\nProjecao publica: data.js contra o artefato derivado do banco\n");
  if (problemas.length) {
    console.log("✗ DIVERGENCIA — o banco e a autoridade, `data.js` e derivado:\n");
    for (const p of problemas.slice(0, 30)) console.log("  - " + p);
    if (problemas.length > 30) console.log(`  ... e mais ${problemas.length - 30}`);
    console.log("\n  Se o BANCO mudou: rode `--write` e commite o artefato junto.");
    console.log("  Se alguem editou `data.js` a mao: essa edicao NAO e verdade financeira. Reverta.\n");
    process.exit(1);
  }
  const linhas = doc.sorteios.reduce((a, s) => a + s.length, 0);
  console.log(`✓ data.js concorda com o banco — ${doc.sorteios.length} sorteio(s), ${linhas} linha(s)`);
  console.log("  (e o artefato nao contem nenhum campo privado)\n");
}

// So executa quando chamado DIRETAMENTE. Importar este modulo (o gate faz isso para reusar
// `divergencias`) nao pode disparar o CLI nem chamar process.exit() — foi o que aconteceu na
// primeira versao: a suite de testes morria imprimindo "uso: --check | --write".
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const modo = process.argv[2];
  const iFrom = process.argv.indexOf("--from");
  if (modo === "--write") await escrever(iFrom > 0 ? process.argv[iFrom + 1] : null);
  else if (modo === "--check") conferir();
  else { console.log("uso: --check | --write"); process.exit(2); }
}
