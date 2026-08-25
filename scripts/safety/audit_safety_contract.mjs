#!/usr/bin/env node
/**
 * audit_safety_contract.mjs — o meta-gate do contrato permanente de seguranca de mudanca.
 *
 * ─── AS DUAS PERGUNTAS ───────────────────────────────────────────────────────────────────────
 *
 * O contrato responde a duas perguntas INDEPENDENTES, e a segunda e a que costuma faltar:
 *
 *   A. Alguma superficie critica MUDOU?
 *   B. Mesmo que nao pareca ter mudado, os invariantes criticos dela ainda valem?
 *
 * Deteccao por diff de caminho responde so a A. Ela e cega para o caso em que o arquivo continua
 * la, o nome continua o mesmo, o gate continua "passando" — e a protecao ja nao existe. Foi
 * assim que 17 gates ficaram orfaos ate 2026-08-10, e foi assim que um deles esteve VERMELHO por
 * varios commits tendo pego uma regressao real que nenhuma suite reportou.
 *
 * ─── A REGRA QUE ESTE ARQUIVO IMPOE A SI MESMO ───────────────────────────────────────────────
 *
 * Uma mudanca nao pode enfraquecer o proprio portao que a julga. Por isso as comparacoes que
 * importam sao feitas contra uma BASE do git (origin/main, merge-base ou HEAD~1), nao contra o
 * estado atual: um gate modificado nao pode se auto-certificar usando o proprio comportamento
 * novo. Quando nao ha base disponivel, a checagem diz SKIPPED — nunca PASSED. Um check que nao
 * pode rodar precisa dizer isso; declarar verde o que nao foi medido e a fabrica de falso verde
 * que este repositorio ja pagou caro.
 *
 * Hermetico: le arquivos e chama `git`. Zero rede, zero Supabase, zero credencial, zero e-mail.
 *
 * Uso:
 *   node scripts/safety/audit_safety_contract.mjs
 *   node scripts/safety/audit_safety_contract.mjs --json
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, loadSurfaces, loadWorkflows, loadIntent, POLICIES,
  pathMatches, resolveBase, readAtRef, changedPaths,
  npmTestFiles, npmTestChain, verifyChecks, assertionCount, skipMarkers,
  LIFECYCLES, makeInvariantChecks, validateLifecycle, evaluateConditionalInvariants,
} from "./surfaces.mjs";

const JSON_OUT = process.argv.includes("--json");

let pass = 0, fail = 0, skip = 0;
const findings = [];
const log = (s) => { if (!JSON_OUT) console.log(s); };

function ok(id, name) { pass++; log(`  ✓ ${id} ${name}`); }
function bad(id, name, detail) {
  fail++; findings.push({ id, name, detail });
  log(`  ✗ ${id} ${name}\n      ${detail}`);
}
function skipped(id, name, why) {
  skip++; findings.push({ id, name, detail: why, skipped: true });
  log(`  ○ ${id} ${name}  (${why})`);
}
/** `cond` verdadeiro = passa. */
function check(id, name, cond, detail) { cond ? ok(id, name) : bad(id, name, detail); }

// ══════════════════════════════════════════════════════════════════════════════════════════════

const reg = loadSurfaces();
const wfs = loadWorkflows();
const intent = loadIntent();
const base = resolveBase();
const changed = changedPaths(base.sha);

const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);
const readBase = (p) => (base.sha ? readAtRef(base.sha, p) : null);

/** Uma superficie tem declaracao valida em CHANGE_INTENT.json? */
function declaredFor(surfaceId) {
  return intent.declarations.find((d) => d.surface_id === surfaceId);
}
const REQUIRED_INTENT_FIELDS = ["surface_id", "reason", "expected_behavior_change", "tests_required"];

// ══ 1. INTEGRIDADE DO REGISTRO ════════════════════════════════════════════════════════════════
log("\n1. Integridade do registro de superficies criticas");

const ids = reg.surfaces.map((s) => s.id);
check("R1", "ids de superficie unicos", new Set(ids).size === ids.length,
  `duplicados: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(", ")}`);

{
  const bad_ = reg.surfaces.filter((s) => !s.id || !s.category || !s.why || !POLICIES.has(s.change_policy));
  check("R2", "toda superficie tem id/categoria/motivo/politica valida", bad_.length === 0,
    `incompletas: ${bad_.map((s) => s.id || "<sem id>").join(", ")}`);
}

const verifyText = read("scripts/verify.mjs");
const vchecks = verifyChecks(verifyText);
{
  const missing = [];
  for (const s of reg.surfaces) for (const g of s.required_gates || []) if (!vchecks.ids.has(g)) missing.push(`${s.id} -> ${g}`);
  for (const w of wfs.workflows) for (const g of w.required_gates || []) if (!vchecks.ids.has(g)) missing.push(`${w.id} -> ${g}`);
  check("R3", "todo required_gate resolve para um check real do verify.mjs", missing.length === 0,
    `gates inexistentes: ${missing.join("; ")}`);
}

{
  // Um caminho declarado que nao existe mais e uma protecao apontando para o vazio — o registro
  // fica com aparencia de cobertura e nao cobre nada. E o defeito dos 17 orfaos, invertido.
  const dangling = [];
  for (const s of reg.surfaces) {
    for (const p of s.paths || []) {
      if (p.includes("*")) {
        const dir = p.split("*")[0].replace(/\/$/, "");
        if (!existsSync(join(ROOT, dir))) dangling.push(`${s.id}: ${p}`);
      } else if (!existsSync(join(ROOT, p))) dangling.push(`${s.id}: ${p}`);
    }
  }
  check("R4", "todo caminho declarado existe no disco", dangling.length === 0, `orfaos: ${dangling.join("; ")}`);
}

// ══ 2. AUTOPROTECAO DOS GATES ═════════════════════════════════════════════════════════════════
log("\n2. Autoprotecao dos gates (uma mudanca nao pode enfraquecer o proprio portao)");

const pkgText = read("package.json");
const pkgBase = readBase("package.json");
const verifyBase = readBase("scripts/verify.mjs");

{
  const surf = reg.surfaces.find((s) => s.id === "TEST_CHAIN");
  const required = surf.structural_invariants.required_subsuites;
  const testScript = JSON.parse(pkgText).scripts.test || "";
  const missing = required.filter((r) => !testScript.includes(r));
  check("G1", "npm test ainda encadeia todas as sub-suites", missing.length === 0,
    `sub-suites removidas de \`npm test\`: ${missing.join(", ")}`);
}

{
  // verify.mjs precisa DOMINAR a cadeia do npm test. Enquanto isso vale, rodar o verify implica
  // rodar tudo que o npm test roda — e o `npm run check` nao precisa pagar as suites de
  // navegador duas vezes. Se a dominancia quebrar, o contrato reprova e a suposicao acaba junto.
  const orphan = [...npmTestFiles(pkgText)].filter((f) => !vchecks.files.has(f));
  check("G2", "verify.mjs cobre todo gate da cadeia do npm test (sem excecao)", orphan.length === 0,
    `no npm test e ausentes do verify.mjs: ${orphan.join(", ")}`);
}

/**
 * APPEND_ONLY e sobre IDENTIDADE, nunca sobre contagem.
 *
 * Contar era a versao ingenua desta regra, e a suite de mutacao a derrubou na primeira execucao:
 * este mesmo patch acrescentou seis checks ao verify.mjs, entao apagar `scoring-copa` deixava o
 * total em 149 contra 144 da base — CRESCEU, e a regra de contagem aplaudiu. Um patch que
 * acrescenta ruido barato e remove um gate caro passa por qualquer regra de total, e e
 * exatamente o formato que um patch apressado tem.
 *
 * Comparar CONJUNTOS nao tem essa cegueira: o que existia na base e sumiu, sumiu — nao importa
 * quantas coisas entraram no lugar.
 */
function appendOnly(id, label, nowSet, wasSet, surfaceId, noun) {
  const removed = [...wasSet].filter((x) => !nowSet.has(x));

  /**
   * A declaracao precisa NOMEAR o que sumiu.
   *
   * Antes, bastava existir uma declaracao para a superficie e QUALQUER remocao nela passava. A
   * suite de mutacao derrubou isso na primeira execucao em que este patch declarou
   * `TEST_CHAIN`: cinco mutacoes que apagam gates diferentes passaram a nao ser pegas, porque a
   * declaracao -- escrita para uma migracao especifica -- virou um salvo-conduto para o arquivo
   * inteiro.
   *
   * Uma permissao que cobre mais do que foi pedido nao e uma permissao, e um buraco. Agora cada
   * item removido precisa aparecer no texto da declaracao; o que nao foi nomeado continua sendo
   * uma remocao silenciosa e continua reprovando.
   */
  const dec = declaredFor(surfaceId);
  const texto = dec ? `${dec.reason} ${dec.expected_behavior_change}` : "";
  const naoNomeados = removed.filter((x) => !texto.includes(x));

  check(id, `${label} (${wasSet.size} -> ${nowSet.size})`,
    removed.length === 0 || (!!dec && naoNomeados.length === 0),
    `${noun} que sumiram sem declaracao que os NOMEIE: ${naoNomeados.slice(0, 8).join(", ")}` +
    `${naoNomeados.length > 8 ? ` (+${naoNomeados.length - 8})` : ""}`);
}

if (!verifyBase) skipped("G3", "nenhum check do verify.mjs desapareceu", "sem base de comparacao no git");
else appendOnly("G3", "nenhum check do verify.mjs desapareceu", vchecks.ids, verifyChecks(verifyBase).ids, "VERIFY_RUNNER", "checks");

if (!pkgBase) skipped("G4", "nenhum comando da cadeia do npm test desapareceu", "sem base de comparacao no git");
else appendOnly("G4", "nenhum comando da cadeia do npm test desapareceu",
  new Set(npmTestChain(pkgText)), new Set(npmTestChain(pkgBase)), "TEST_CHAIN", "comandos");

{
  const p = "bolao/scripts/gate_registry.json";
  const b = readBase(p);
  if (!b) skipped("G5", "nenhuma entrada do registro de gates desapareceu", "sem base de comparacao no git");
  else appendOnly("G5", "nenhuma entrada do registro de gates desapareceu",
    new Set(Object.keys(JSON.parse(read(p)).entries)),
    new Set(Object.keys(JSON.parse(b).entries)), "GATE_REGISTRY", "entradas");
}

{
  // Um `skip` novo e um gate removido com outro nome: o arquivo continua la, o comando continua
  // na cadeia, a suite continua verde — e a afirmacao deixou de ser feita.
  if (!base.sha) skipped("G6", "nenhum skip novo em arquivo de gate", "sem base de comparacao no git");
  else {
    const offenders = [];
    for (const f of changed) {
      if (!/(test_|audit_|check_|\.test\.)/.test(f) || !/\.(mjs|js|py)$/.test(f)) continue;
      const now = skipMarkers(read(f)), was = skipMarkers(readBase(f));
      if (now > was) offenders.push(`${f} (${was} -> ${now})`);
    }
    check("G6", "nenhum marcador de skip novo em arquivo de gate", offenders.length === 0,
      `skips introduzidos: ${offenders.join("; ")}`);
  }
}

{
  // Reducao material de assercoes: o gate continua existindo e prova menos.
  if (!base.sha) skipped("G7", "nenhuma queda material de assercoes", "sem base de comparacao no git");
  else {
    const offenders = [];
    for (const f of changed) {
      if (!/(test_|audit_|check_|\.test\.)/.test(f) || !/\.(mjs|js|py)$/.test(f)) continue;
      const wasText = readBase(f);
      if (wasText === null) continue;                 // arquivo novo: nao ha o que encolher
      if (read(f) === null) { offenders.push(`${f} (apagado)`); continue; }
      const now = assertionCount(read(f)), was = assertionCount(wasText);
      if (was >= 10 && now < was * 0.9) offenders.push(`${f} (${was} -> ${now})`);
    }
    /**
     * G7 era o UNICO check de autoprotecao sem caminho de declaracao -- G3, G4 e G5 (que sao
     * baseados em IDENTIDADE, portanto mais fortes) sempre aceitaram uma declaracao explicita.
     *
     * Isso o tornava absoluto de um jeito insustentavel: nenhuma migracao legitima consegue MOVER
     * cobertura entre arquivos, porque o arquivo de origem sempre encolhe. O incentivo que isso
     * cria e o pior possivel -- manter arquivo morto so para o contador nao cair.
     *
     * A correcao NAO e afrouxar: e exigir declaracao E provar que o total nao caiu. Coberta pode
     * mudar de lugar; nao pode sumir. Sem `TEST_CHAIN` declarado, G7 continua absoluto como antes.
     */
    const dec = declaredFor("TEST_CHAIN");
    const textoDec = dec ? `${dec.reason} ${dec.expected_behavior_change}` : "";
    // Mesma regra do appendOnly, e pelo mesmo motivo: a declaracao precisa NOMEAR o arquivo que
    // encolheu. Sem isso, uma declaracao escrita para uma migracao vira salvo-conduto para
    // esvaziar qualquer gate -- foi a mutacao M12 que provou isso, e ela estava certa.
    const naoNomeados = offenders.filter((o) => !textoDec.includes(o.split(" ")[0]));
    let agregadoOk = true, agregado = "";
    if (offenders.length && dec && naoNomeados.length === 0) {
      let antes = 0, depois = 0;
      for (const f of changed) {
        if (!/(test_|audit_|check_|\.test\.)/.test(f) || !/\.(mjs|js|py)$/.test(f)) continue;
        const wasText = readBase(f);
        antes += wasText === null ? 0 : assertionCount(wasText);
        const nowText = read(f);
        depois += nowText === null ? 0 : assertionCount(nowText);
      }
      agregadoOk = depois >= antes;
      agregado = ` — agregado dos gates alterados: ${antes} -> ${depois}`;
    }
    check("G7", "nenhuma queda material de assercoes em gate alterado",
      offenders.length === 0 || (!!dec && naoNomeados.length === 0 && agregadoOk),
      `gates que passaram a afirmar menos sem declaracao que os NOMEIE: ` +
      `${(naoNomeados.length ? naoNomeados : offenders).join("; ")}${agregado}`);
  }
}

{
  const p = "docs/bolao/evidence/visual-comparison/ALLOWLIST.json";
  const b = readBase(p);
  if (!b) skipped("G8", "allowlist visual nao foi alargada", "sem base de comparacao no git");
  else {
    const now = JSON.parse(read(p)).entries.length, was = JSON.parse(b).entries.length;
    check("G8", `allowlist visual nao foi alargada (${was} -> ${now})`, now <= was || !!declaredFor("VISUAL_ALLOWLIST"),
      `a allowlist ganhou ${now - was} entrada(s) sem declaracao — alargar a allowlist e a forma silenciosa de um gate visual parar de morder`);
  }
}

// ══ 3. WORKFLOWS DE NOTIFICACAO ═══════════════════════════════════════════════════════════════
log("\n3. Workflows de notificacao (a ausencia de disparo e a falha, e nenhum sinal a reporta)");

/**
 * Remove comentarios YAML antes de perguntar o que o workflow FAZ.
 *
 * Nao e cosmetico. `cdb2026_confirmation_fake_transport_test.yml` explica num comentario que
 * `BOLAO_ALLOW_REAL_SEND` NAO e definida ali de proposito — e uma busca ingenua por substring
 * lia esse comentario como "o guard existe". O erro anda nas duas direcoes: do mesmo jeito, um
 * guard REMOVIDO de verdade continuaria "presente" enquanto sobrasse um comentario citando o
 * nome dele. Um gate que confunde falar sobre o guard com ter o guard nao protege nada.
 */
function stripYamlComments(text) {
  return text.split("\n").map((line) => {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) { if (c === quote) quote = null; }
      else if (c === "'" || c === '"') quote = c;
      else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }).join("\n");
}

for (const w of wfs.workflows) {
  const raw = read(w.file);
  if (raw === null) { bad(`N:${w.id}`, "workflow existe", `arquivo ausente: ${w.file}`); continue; }
  const text = stripYamlComments(raw);

  const problems = [];

  for (const t of w.triggers) {
    const re = t === "schedule" ? /^\s{2}schedule:/m
             : t === "pull_request" ? /^\s{2}pull_request:/m
             : t === "push" ? /^\s{2}push:/m
             : /^\s{2}workflow_dispatch:?/m;
    if (!re.test(text)) problems.push(`gatilho declarado ausente do arquivo: ${t}`);
  }

  const fileCrons = [...text.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1].trim());
  const declCrons = (w.cron || []).map((c) => c.trim());
  const missing = declCrons.filter((c) => !fileCrons.includes(c));
  const extra = fileCrons.filter((c) => !declCrons.includes(c));
  if (missing.length) problems.push(`cron declarado e ausente do arquivo: ${missing.join(" | ")}`);
  if (extra.length) problems.push(`cron no arquivo e ausente do manifesto: ${extra.join(" | ")}`);

  if (w.real_send_guard === "NONE_STRUCTURALLY_INCAPABLE") {
    // A AUSENCIA do guard e a propriedade protegida. Um workflow de teste que ganhasse o guard
    // passaria a mandar e-mail de verdade a cada exercicio.
    if (/BOLAO_ALLOW_REAL_SEND|POWERBALL_EMAIL_MODE:\s*production/.test(text))
      problems.push("declarado estruturalmente incapaz de enviar, mas ganhou um guard de envio real");
  } else if (!text.includes(w.real_send_guard)) {
    problems.push(`guard de envio real ausente: ${w.real_send_guard} — o cron continuaria disparando e o envio falharia fechado em silencio`);
  }

  if (/^\s*if:\s*false\s*$/m.test(text)) problems.push("workflow desativado com `if: false`");

  // A declaracao tem de nomear ESTE workflow, nao a superficie inteira.
  //
  // Uma declaracao de nivel de superficie autorizaria, com uma linha, qualquer violacao em
  // QUALQUER workflow: bastaria tocar num arquivo de CI para ganhar permissao de apagar o cron
  // do Powerball no mesmo commit. Uma autorizacao ampla concedida por um motivo estreito e
  // exatamente como uma excecao de seguranca envelhece virando porta dos fundos.
  const declared = intent.declarations.find(
    (d) => d.surface_id === "NOTIFICATION_WORKFLOWS" && (d.affected_workflows || []).includes(w.id));
  if (problems.length && !declared) bad(`N:${w.id}`, "contrato do workflow", problems.join(" ; "));
  else if (problems.length) ok(`N:${w.id}`, `contrato do workflow (divergencia DECLARADA: ${problems.length})`);
  else ok(`N:${w.id}`, "contrato do workflow");
}

// ══ 4. MIGRACOES ══════════════════════════════════════════════════════════════════════════════
log("\n4. Migracoes do Supabase");

const MIG_DIR = join(ROOT, "supabase/migrations");
if (!existsSync(MIG_DIR)) skipped("M0", "diretorio de migracoes", "supabase/migrations nao existe");
else {
  const migSurf = reg.surfaces.find((s) => s.id === "SUPABASE_MIGRATIONS");
  const nonForward = new Set(migSurf.structural_invariants.non_forward_artifacts || []);
  const allSql = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
  const files = allSql.filter((f) => !nonForward.has(f));

  // Verificado ANTES de qualquer isencao: um rollback nao escapa por estar na lista de artefatos
  // nao-aplicaveis. A lista isenta do padrao de NOME, nunca da regra de seguranca.
  const rollbacks = allSql.filter((f) => /\.rollback\.sql$/.test(f) || /(^|_)rollback_/.test(f));
  check("M1", "nenhum .rollback.sql na historia de avanco", rollbacks.length === 0,
    `um rollback aqui e aplicado COMO SE FOSSE avanco e desfaz o schema em producao: ${rollbacks.join(", ")}`);

  const bad_ = files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
  check("M2", "nomes de migracao validos (14 digitos + snake_case)", bad_.length === 0, `invalidos: ${bad_.join(", ")}`);

  const stamps = files.map((f) => f.slice(0, 14));
  const dup = stamps.filter((s, i) => stamps.indexOf(s) !== i);
  check("M3", "timestamps de migracao unicos", dup.length === 0,
    `timestamp duplicado torna a ordem de aplicacao indefinida entre ambientes: ${[...new Set(dup)].join(", ")}`);

  if (!base.sha) skipped("M4", "nenhuma migracao aplicada foi removida", "sem base de comparacao no git");
  else {
    const wasList = (readAtRef(base.sha, "supabase/migrations") || "").split("\n")
      .map((l) => l.trim()).filter((l) => l.endsWith(".sql"));
    const removed = wasList.filter((f) => !allSql.includes(f));
    check("M4", "nenhuma migracao ja aplicada foi removida da historia", removed.length === 0 || !!declaredFor("SUPABASE_MIGRATIONS"),
      `migracoes que sumiram: ${removed.join(", ")} — o ambiente que ja as aplicou diverge para sempre do que reconstroi do zero`);
  }
}

// ══ 5. HEROES ═════════════════════════════════════════════════════════════════════════════════
log("\n5. Heroes de jogo ao vivo (invariante estrutural, verificado sempre)");

{
  const surf = reg.surfaces.find((s) => s.id === "LIVE_MATCH_HEROES");
  for (const [file, anchors] of Object.entries(surf.structural_invariants.anchors)) {
    const text = read(file);
    if (text === null) { bad(`H:${file}`, "hero presente", `arquivo ausente: ${file}`); continue; }
    const missing = anchors.filter((a) => !text.includes(a));
    check(`H:${file.split("/")[1]}`, `ancoras do hero (${anchors.length})`, missing.length === 0,
      `ancoras perdidas em ${file}: ${missing.join(", ")} — o hero ja sumiu da tela quatro vezes, e numa rodada com jogos simultaneos chegou a mostrar so o primeiro`);
  }
}

// ══ 6. LOOK & FEEL ════════════════════════════════════════════════════════════════════════════
log("\n6. Contrato de aparencia padrao");

{
  const surf = reg.surfaces.find((s) => s.id === "SHARED_DESIGN_TOKENS");
  const text = read("bolao/shared/css/tokens.css");
  const missing = (surf.structural_invariants.required_tokens || []).filter((t) => !new RegExp(`^\\s*${t}\\s*:`, "m").test(text || ""));
  check("L1", `familias de token presentes (${surf.structural_invariants.required_tokens.length})`, missing.length === 0,
    `tokens apagados: ${missing.join(", ")} — apagar um token quebra os quatro apps de um jeito que nenhum gate de VALOR pegaria, porque nao ha valor novo para comparar`);
}

{
  const framework = reg.surfaces.find((s) => s.id === "SHARED_VISUAL_FRAMEWORK");
  const missing = framework.paths.filter((p) => !existsSync(join(ROOT, p)));
  check("L2", `arquivos do framework visual compartilhado (${framework.paths.length})`, missing.length === 0,
    `ausentes: ${missing.join(", ")}`);
}

// ══ 7. FINGERPRINT DE SCORING ═════════════════════════════════════════════════════════════════
log("\n7. Fingerprint das constantes de scoring (dinheiro real por entrada)");

/**
 * Extrai as chaves de scoring do config.js por varredura de chaves balanceadas, ignorando
 * `siteVersion`. Comparar o arquivo INTEIRO daria vermelho em todo release — e uma declaracao
 * exigida em todo release vira carimbo, que e como uma protecao morre.
 */
function scoringFingerprint(text, keys) {
  if (!text) return null;
  const out = {};
  for (const k of keys) {
    const m = new RegExp(`^\\s*${k}\\s*:`, "m").exec(text);
    if (!m) { out[k] = null; continue; }
    let i = text.indexOf(":", m.index) + 1;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "{") {
      let depth = 0, start = i;
      for (; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") { depth--; if (depth === 0) { i++; break; } }
      }
      out[k] = text.slice(start, i).replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "");
    } else {
      out[k] = text.slice(i, text.indexOf("\n", i)).replace(/\/\/[^\n]*/g, "").replace(/[,\s]+$/, "").trim();
    }
  }
  return out;
}

/**
 * `true` quando alguma CHAVE OBSERVADA do fingerprint driftou entre a base e agora — Issue #261.
 *
 * Deliberadamente a MESMA leitura que o S1 faz (`scoringFingerprint(text, keys)`), para que as duas
 * perguntas do contrato sobre a mesma superficie nunca possam divergir de novo: "a constante mudou?"
 * (S1) e "a declaracao ainda descreve uma mudanca real?" (D3) passam a olhar exatamente os mesmos
 * bytes. Arquivo ausente na base (`was` nulo) e tratado como "nao da para afirmar drift", igual ao S1.
 */
function fingerprintDriftou(fp) {
  if (!fp || !Array.isArray(fp.files) || !Array.isArray(fp.keys)) return false;
  for (const f of fp.files) {
    const now = scoringFingerprint(read(f), fp.keys);
    const was = scoringFingerprint(readBase(f), fp.keys);
    if (!was) continue;
    for (const k of fp.keys) if (JSON.stringify(now?.[k]) !== JSON.stringify(was[k])) return true;
  }
  return false;
}

{
  const surf = reg.surfaces.find((s) => s.id === "SCORING_CONSTANTS");
  const { files, keys } = surf.fingerprint;
  if (!base.sha) skipped("S1", "constantes de scoring inalteradas", "sem base de comparacao no git");
  else {
    const drift = [];
    for (const f of files) {
      const now = scoringFingerprint(read(f), keys);
      const was = scoringFingerprint(readBase(f), keys);
      if (!was) continue;
      for (const k of keys) if (JSON.stringify(now?.[k]) !== JSON.stringify(was[k])) drift.push(`${f}:${k}`);
    }
    const declared = declaredFor("SCORING_CONSTANTS");
    check("S1", "constantes de scoring inalteradas (entryFee/cutoffIso/prizes/scoring)", drift.length === 0 || !!declared,
      `constante de scoring alterada sem declaracao: ${drift.join(", ")} — isso redistribui premio entre pessoas que ja pagaram, e o site nao tem como saber que errou`);
  }
}

// ══ 8. CI ═════════════════════════════════════════════════════════════════════════════════════
log("\n8. Integracao continua");

{
  const p = ".github/workflows/safety_check.yml";
  const text = read(p);
  if (text === null) bad("C1", "workflow do contrato existe", `ausente: ${p}`);
  else {
    const problems = [];
    if (!/^\s{2}pull_request:/m.test(text)) problems.push("sem gatilho pull_request");
    if (!/^\s{2}push:/m.test(text)) problems.push("sem gatilho push");
    if (!/branches:\s*\[?\s*\n?\s*-?\s*['"]?main/m.test(text)) problems.push("push nao restrito/declarado para main");
    // Precisa ser uma linha `run:` de verdade. Procurar a substring solta em qualquer lugar do
    // arquivo daria verde com o nome do job ("name: npm run check") ou com um comentario — e a
    // mutacao que troca `run: npm run check` por `run: echo skip` passaria despercebida, que e
    // precisamente o jeito mais barato de desligar o contrato inteiro sem tocar em gate nenhum.
    if (!/^\s*run:\s*npm run check\s*$/m.test(stripYamlComments(text)))
      problems.push("nenhum passo `run:` invoca o comando canonico `npm run check`");
    check("C1", "o workflow do contrato dispara e roda o comando canonico", problems.length === 0,
      `${problems.join(" ; ")} — estreitar o gatilho desliga a protecao inteira sem alterar um unico gate`);
  }
}

// ══ 9. DECLARACOES ════════════════════════════════════════════════════════════════════════════
log("\n9. Declaracoes de mudanca critica");

const invariantChecks = makeInvariantChecks(read);

{
  const problems = [];
  const seenConditionIds = new Set();
  for (const d of intent.declarations) {
    const miss = REQUIRED_INTENT_FIELDS.filter((f) => !d[f] || (Array.isArray(d[f]) && d[f].length === 0));
    if (miss.length) problems.push(`${d.surface_id || "<sem surface_id>"}: campos faltando ${miss.join(",")}`);
    else if (!ids.includes(d.surface_id)) problems.push(`${d.surface_id}: nao e uma superficie do registro`);
    else {
      const lifecycleProblems = validateLifecycle(d, invariantChecks, seenConditionIds);
      if (lifecycleProblems.length) problems.push(`${d.surface_id}: ${lifecycleProblems.join(" ; ")}`);
    }
  }
  check("D1", `declaracoes bem formadas (${intent.declarations.length})`, problems.length === 0, problems.join(" ; "));
}

{
  // O caso central: superficie DECLARE_TO_CHANGE tocada sem declaracao.
  const undeclared = [];
  for (const s of reg.surfaces) {
    if (s.change_policy !== "DECLARE_TO_CHANGE") continue;
    const hits = changed.filter((p) => pathMatches(p, s.paths));
    if (hits.length && !declaredFor(s.id)) undeclared.push(`${s.id} <- ${hits.slice(0, 4).join(", ")}${hits.length > 4 ? ` (+${hits.length - 4})` : ""}`);
  }
  check("D2", "nenhuma superficie DECLARE_TO_CHANGE mudou em silencio", undeclared.length === 0,
    `mudou sem entrada em CHANGE_INTENT.json:\n      ${undeclared.join("\n      ")}`);
}

{
  // Declaracao obsoleta e ruido, e ruido ensina a ignorar o arquivo — um arquivo que se aprende
  // a ignorar nao protege nada. E a mesma regra que o ALLOWLIST.json ja aplica a si mesmo:
  // entrada que nao suprimiu nada nesta rodada e lixo acumulado, e o gate fica vermelho ate
  // alguem remover.
  //
  // O efeito pratico e que uma declaracao ONE_SHOT se AUTOLIMPA: depois que a mudanca declarada
  // entra em main, a base anda, os caminhos deixam de aparecer no diff e a declaracao vira
  // obsoleta — precisa ser removida. Sem isso o arquivo viraria um deposito de autorizacoes
  // permanentes, que e exatamente a porta dos fundos que ele existe para nao ser.
  //
  // Uma declaracao CONDITIONAL (ADR-018) e categoricamente diferente: ela nao descreve "eu mudei
  // X", descreve "X precisa continuar em tal estado ate a condicao Y" — um commit nao relacionado
  // avancando a base NAO prova que a obrigacao acabou. Por isso ela e ISENTA da staleness por
  // diff — mas nunca isenta de verificacao: cada exit_condition MACHINE_VERIFIABLE dela e
  // ativamente avaliada contra o estado ATUAL a cada execucao, e uma violacao reprova D3 tao alto
  // quanto uma declaracao one_shot obsoleta reprovaria. "Isento de staleness por idade" nunca
  // significa "isento de verificacao".
  const staleOneShot = [];
  const violatedConditional = [];
  for (const d of intent.declarations) {
    const s = reg.surfaces.find((x) => x.id === d.surface_id);
    if (!s) continue;                                       // ja reprovado por D1
    if (s.change_policy === "STRUCTURALLY_ENFORCED") continue;
    const lifecycle = d.lifecycle === undefined ? "one_shot" : d.lifecycle;
    if (!LIFECYCLES.has(lifecycle)) continue;                // lifecycle desconhecido — ja reprovado por D1

    if (lifecycle === "conditional") {
      if (!Array.isArray(d.exit_conditions)) continue;       // forma invalida — ja reprovado por D1
      const results = evaluateConditionalInvariants(d, invariantChecks);
      const broken = results.filter((r) => !r.ok);
      if (broken.length) {
        violatedConditional.push(`${d.surface_id} (${d.condition_id}): ${broken.map((b) => `${b.id} — ${b.detail}`).join("; ")}`);
      }
      continue;
    }

    // one_shot (explicito ou por ausencia de `lifecycle`): staleness por diff.
    //
    // ─── SUPERFICIE COM FINGERPRINT: A PERGUNTA E A CHAVE, NAO O ARQUIVO (Issue #261) ──────
    //
    // Antes, esta linha resolvia os caminhos como `s.paths || s.fingerprint?.files` e perguntava
    // se algum deles aparecia no diff. Para uma superficie definida por FINGERPRINT isso e a
    // pergunta errada: SCORING_CONSTANTS nao tem `paths`, e seus `fingerprint.files` sao os tres
    // `js/config.js`. Qualquer toque nesses arquivos passava a contar como "a superficie mudou".
    //
    // O proprio fingerprint ja diz que isso e falso: ele lista `siteVersion` em `ignored_keys`,
    // com o motivo escrito ali do lado — "sobe em TODO release por politica do repo". Ou seja, o
    // repositorio ja tinha decidido que mexer em siteVersion NAO e mexer em scoring; so o S1
    // respeitava essa decisao, porque so ele olhava CHAVES. O D3 olhava ARQUIVOS.
    //
    // Consequencia medida (Issue #261): num branch que fazia um bump normal de release, uma
    // declaracao SCORING_CONSTANTS obsoleta deixava de parecer obsoleta, D3 ficava verde onde as
    // mutacoes M27/M28 esperam vermelho, e a suite reprovava por um motivo sem relacao com a
    // mudanca. Um portao que grita em trabalho rotineiro e um portao que se aprende a ignorar.
    //
    // Agora a pergunta e a mesma que o S1 faz: alguma CHAVE OBSERVADA driftou entre a base e
    // agora? Isso deixa o D3 MAIS estrito, nunca menos — um bump que so mexe em chave ignorada
    // continua deixando a declaracao obsoleta, e obsoleta continua reprovando.
    const tocouSuperficie = s.fingerprint
      ? fingerprintDriftou(s.fingerprint)
      : changed.some((p) => pathMatches(p, s.paths || []));
    if (!tocouSuperficie) staleOneShot.push(d.surface_id);
  }
  check("D3", "nenhuma declaracao obsoleta ou invariante condicional violado",
    staleOneShot.length === 0 && violatedConditional.length === 0,
    [
      staleOneShot.length ? `declaram mudanca que nao aconteceu — remova de CHANGE_INTENT.json: ${staleOneShot.join(", ")}` : null,
      violatedConditional.length ? `invariante condicional violado: ${violatedConditional.join(" | ")}` : null,
    ].filter(Boolean).join(" ; "));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════

if (JSON_OUT) {
  console.log(JSON.stringify({
    schemaVersion: 1, base, totals: { pass, fail, skip },
    changedPathCount: changed.length,
    findings: findings.filter((f) => !f.skipped),
    skipped: findings.filter((f) => f.skipped),
  }, null, 2));
} else {
  log(`\n  base: ${base.sha ? base.sha.slice(0, 12) : "<nenhuma>"} (${base.how})`);
  log(`  ${changed.length} caminho(s) alterado(s) desde a base`);
  log(`\n  ${pass} passed, ${fail} failed, ${skip} skipped\n`);
  if (skip) log("  NOTA: check SKIPPED nao foi executado e NAO esta passando.\n");
  log(fail === 0 ? "✓ SAFETY CONTRACT PASSED\n" : "✗ SAFETY CONTRACT FAILED\n");
}

process.exit(fail === 0 ? 0 : 1);
