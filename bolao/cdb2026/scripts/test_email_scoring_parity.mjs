#!/usr/bin/env node
/**
 * CDB2026 — o e-mail de resultado pontua EXATAMENTE como o site (2026-11-01).
 *
 * O DEFEITO QUE ISTO FECHA
 * ------------------------
 * O site pontua com scoreEntry()/explainScore() de bolao/cdb2026/js/app.js. Nas fases DERIVADAS
 * (semifinal/final) o palpite foi salvo sob o id de VAGA (sf-1/sf-2/final-1) antes do confronto
 * real existir, e o placar migra por VAGA (legacyDerivedTieIds()/pickByTieId()); o bonus de
 * classificado e pelo TIME previsto (virtualDerivedTies()); campeao/vice saem da final PREVISTA
 * (predictedPodium()). O e-mail (send_result_email.py -> audit_scoring.score_entry()) procurava o
 * palpite so pelo id REAL ("sem palpite" para todo mundo na semifinal), comparava o classificado
 * pela LETRA do lado, e lia campeao/vice de um campo que nenhuma entrada tem -- 30/20 nunca
 * entrariam, e o rateio da final (compute_final_payouts) sairia diferente do site.
 *
 * O QUE ESTE TESTE PROVA
 * ----------------------
 * Roda as funcoes REAIS de app.js (extraidas do fonte, com config.js/data.js/i18n.js reais) e o
 * Python do e-mail sobre o MESMO estado, e exige igualdade entrada por entrada:
 *   - total e `detail` completo (cada perna, cada classificado, campeao, vice);
 *   - explainScore() (a decomposicao item a item) == explain_score_site();
 *   - predictedPodium() e officialPodium();
 *   - rank (rankEntriesBy) e o rateio da final (compute_final_payouts);
 *   - a linha de CADA perna como "Ver palpites" mostra (renderPickDisplay() real, instrumentado):
 *     os times "Real (Previsto)", o palpite na orientacao nominal e os pontos -- contra a linha
 *     da tabela do e-mail (leg_breakdown_items()/leg_pick_view()), que nunca pode dizer
 *     "sem palpite" quando o site acha um palpite.
 * Estados: (a) snapshot publico de 2026-11-01 (nomes sinteticos) antes da correcao; (b) o mesmo
 * com o plano versionado bolao/cdb2026/data/corrections/2026-11-01-semifinal.json aplicado;
 * (c) futuros sinteticos -- semis decididas (uma nos penaltis), final materializada, final
 * decidida no tempo normal e nos penaltis, final materializada com orientacao invertida, entradas
 * que previram outros semifinalistas (Vitoria/Internacional/Cruzeiro/Santos), palpites salvos sob
 * id real, chave de classificado presente com null, e o fallback sem topologia.
 * E fixa os numeros de (b) auditados com app.js: totais e pontos da ida da semifinal.
 *
 * HERMETICO: sem rede, sem Supabase, sem e-mail (BOLAO_TEST_RUN=1 no Python).
 *
 * Uso: node bolao/cdb2026/scripts/test_email_scoring_parity.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CDB = join(AQUI, "..");
const APP = readFileSync(join(CDB, "js", "app.js"), "utf8");

let ok = 0, fail = 0;
const T = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; }
                      catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };
const clone = o => JSON.parse(JSON.stringify(o));
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x))
  ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);

// ── app.js real, extraido ─────────────────────────────────────────────────────────────────────
function extrairFuncao(src, nome) {
  const i = src.indexOf(`\nfunction ${nome}(`);
  A(i !== -1, `função ${nome}() não encontrada em app.js`);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function extrairConst(src, nome) {
  const m = src.match(new RegExp(`\\nconst ${nome} = [^\\n]*;`));
  A(m, `const ${nome} não encontrada em app.js`);
  return m[0];
}

const FUNCOES = [
  "matchPoints", "scoreEntry", "explainScore", "legsForFormat", "legTeams",
  "tieQualifiedTeam", "resolveParticipant", "resolveParticipantPredicted",
  "DERIVED_PHASES_PREDECESSOR_OF_TIE", "legacyDerivedTieIds", "pickByTieId", "virtualDerivedTies",
  "derivedPhaseView", "topologyProvenanceIsValid", "finalTieEntry", "officialPodium",
  "predictedPodium", "derivedTieDisplayLabels", "finalSideLabels", "renderPickDisplay",
  "flatLegsChronological", "legKickoffMs", "rankEntriesBy", "hitChampion", "hitRunnerUp",
  "countExactMatches",
];
let fontes = FUNCOES.map(n => extrairFuncao(APP, n)).join("\n");
// Instrumenta a linha de PERNA de "Ver palpites": grava o que a linha mostra, sem mudar nada.
const LINHA = "rows.push(`<tr><td>${esc(pHomeDisplay)}</td>";
A(fontes.split(LINHA).length === 2, "a linha de perna de renderPickDisplay() mudou -- atualize a instrumentação");
fontes = fontes.replace(LINHA,
  "__linhas[`${phase.id}|${tieId}|${leg}`] = { home: pHomeDisplay, away: pAwayDisplay, goalsHome: pick.goalsHome, goalsAway: pick.goalsAway, pts: d ? d.pts : null };\n        " + LINHA);

const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ["config.js", "data.js", "i18n.js"]) {
  vm.runInContext(readFileSync(join(CDB, "js", f), "utf8"), ctx, { filename: f });
}
A(ctx.window.CDB2026_CONFIG && ctx.window.CDB2026_DATA && ctx.window.CDB2026_I18N, "config/data/i18n não carregaram");
const I18N = ctx.window.CDB2026_I18N.pt || ctx.window.CDB2026_I18N["pt-BR"] || ctx.window.CDB2026_I18N;
const SITE = vm.runInContext(`(function () {
  const C = window.CDB2026_CONFIG, DATA = window.CDB2026_DATA;
  const esc = x => String(x ?? "");   // so apresentacao HTML; a instrumentacao le os valores crus
  ${extrairConst(APP, "TOPOLOGY_REQUIRED_FIELDS")}
  ${extrairConst(APP, "DERIVED_PHASES")}
  ${extrairConst(APP, "SCORING_RULE_VERSION")}
  let __S = null, __linhas = {};
  const state = () => __S;
  const isPastEntryCutoff = () => true;
  const t = k => (__I18N[k] ?? k);
  ${fontes}
  return {
    scoreEntry, explainScore, predictedPodium, officialPodium, derivedTieDisplayLabels, rankEntriesBy,
    linhasVerPalpites(entry, s) {
      __S = s; __linhas = {};
      renderPickDisplay(entry, scoreEntry(entry, s).detail);
      return __linhas;
    },
  };
})()`, Object.assign(ctx, { __I18N: I18N }));

// ── Estados ───────────────────────────────────────────────────────────────────────────────────
const FIX = JSON.parse(readFileSync(join(AQUI, "fixtures", "cdb_email_parity_state_2026-11-01.json"), "utf8"));
const PLANO = JSON.parse(readFileSync(join(CDB, "data", "corrections", "2026-11-01-semifinal.json"), "utf8"));
const base = () => { const s = clone(FIX); delete s._o_que_e; return s; };

function aplicaPlano(s, plano) {
  for (const op of plano.operations) {
    const m = s.phases[op.phaseId].ties[op.tieId].matches[op.leg];
    if (op.op === "clear-leg") {
      Object.assign(m, { goalsHome: null, goalsAway: null, status: "SCHEDULED" });
      s.phases[op.phaseId].ties[op.tieId].qualifiedTeamId = null;
    } else if (op.op === "save-leg") {
      Object.assign(m, { goalsHome: op.goalsHome, goalsAway: op.goalsAway, status: "FINAL" });
    } else if (op.op === "kickoff") {
      m.kickoff = op.kickoff;
    } else throw new Error(`op desconhecida no plano: ${op.op}`);
  }
  return s;
}

const SF_PV = "espn-palmeiras_vasco", SF_AG = "espn-atletico-mg_gremio";
const fin = (s, id, gh, ga) => Object.assign(s.phases.semifinal.ties[id].matches[gh[0]], { goalsHome: gh[1], goalsAway: gh[2], status: "FINAL" }) && s;

// Entradas sinteticas que previram OUTROS semifinalistas, e casos de borda de chave.
function entradasSinteticas(s) {
  const q = s.phases.quartas.ties;
  const A_ = (id, teamName) => (q[id].teamA === teamName ? "A" : "B");
  const quartasPrev = (gi, ac, vv, ps) => ({
    "espn-gremio_internacional": A_("espn-gremio_internacional", gi),
    "espn-atletico-mg_cruzeiro": A_("espn-atletico-mg_cruzeiro", ac),
    "espn-vasco_vitoria": A_("espn-vasco_vitoria", vv),
    "espn-palmeiras_santos": A_("espn-palmeiras_santos", ps),
  });
  const g = (h, a) => ({ goalsHome: h, goalsAway: a });
  return [
    { id: "s1", entryName: "Sintetica Vitoria-Inter-Cruzeiro", picks: {
      qualified: { ...quartasPrev("Internacional", "Cruzeiro", "Vitória", "Palmeiras"), "sf-1": "B", "sf-2": "A", "final-1": "A" },
      matches: { "sf-1": { first: g(1, 0), second: g(2, 2) }, "sf-2": { first: g(0, 1), second: g(2, 0) }, "final-1": { single: g(1, 1) } } } },
    { id: "s2", entryName: "Sintetica Santos-Gremio", picks: {
      qualified: { ...quartasPrev("Grêmio", "Atlético-MG", "Vasco", "Santos"), "sf-1": "B", "sf-2": "B", "final-1": "B" },
      matches: { "sf-1": { first: g(1, 1), second: g(1, 1) }, "sf-2": { first: g(0, 1), second: g(2, 0) }, "final-1": { single: g(2, 1) } } } },
    // Palpites salvos sob o id REAL (editados depois da materializacao) + chave real que
    // SOMBREIA a vaga mesmo com valor null (pickByTieId: chave presente vence).
    { id: "s3", entryName: "Sintetica Id Real", picks: {
      qualified: { ...quartasPrev("Grêmio", "Atlético-MG", "Vasco", "Palmeiras"), [SF_PV]: "B", [SF_AG]: null, "sf-1": "A", "final-1": "A" },
      matches: { [SF_PV]: { first: g(0, 1), second: g(3, 0) }, "sf-1": { first: g(2, 0) }, "final-1": { single: g(0, 0) } } } },
    // Sem nenhum palpite de semifinal/final.
    { id: "s4", entryName: "Sintetica Sem Semi", picks: { qualified: quartasPrev("Grêmio", "Cruzeiro", "Vasco", "Palmeiras"), matches: {} } },
    // Classificado que nao e "A" nem "B" (JS: qualquer outro valor verdadeiro conta como lado B).
    { id: "s5", entryName: "Sintetica Lado Estranho", picks: {
      qualified: { ...quartasPrev("Grêmio", "Atlético-MG", "Vasco", "Palmeiras"), "sf-1": "X", "sf-2": "B", "final-1": "B" },
      matches: { "sf-1": { first: g(1, 1) }, "sf-2": { first: g(0, 1) } } } },
  ];
}

function semisDecididas(s) {
  fin(s, SF_PV, ["second", 2, 0]);                              // Palmeiras 2x0 em casa: agregado 3x0
  s.phases.semifinal.ties[SF_PV].qualifiedTeamId = "B";        // Palmeiras
  fin(s, SF_AG, ["first", 1, 1]); fin(s, SF_AG, ["second", 1, 1]); // 2x2 no agregado
  Object.assign(s.phases.semifinal.ties[SF_AG], {
    qualifiedTeamId: "B", penaltiesHome: 3, penaltiesAway: 4, penaltiesWinnerTeamId: "B" }); // Atletico nos penaltis
  return s;
}
const FINAL_ID = "espn-atletico-mg_palmeiras";
function finalMaterializada(s, invertida = false) {
  const [a, b] = invertida ? ["Palmeiras", "Atlético-MG"] : ["Atlético-MG", "Palmeiras"];
  s.phases.final.ties = { [FINAL_ID]: { teamA: a, teamB: b, qualifiedTeamId: null, matches: {
    single: { homeTeam: a, awayTeam: b, kickoff: "2026-11-29T20:00:00Z", status: "SCHEDULED", goalsHome: null, goalsAway: null } } } };
  return s;
}
function finalDecidida(s, gh, ga, q, pen) {
  const t = s.phases.final.ties[FINAL_ID];
  Object.assign(t.matches.single, { goalsHome: gh, goalsAway: ga, status: "FINAL" });
  t.qualifiedTeamId = q;
  if (pen) Object.assign(t, { penaltiesHome: pen[0], penaltiesAway: pen[1], penaltiesWinnerTeamId: q });
  return s;
}
const comSinteticas = s => { s.entries.push(...entradasSinteticas(s)); return s; };
const corrigido = () => aplicaPlano(base(), PLANO);

const CENARIOS = {
  "a-snapshot-2026-11-01": base(),
  "b-corrigido": corrigido(),
  "b-corrigido+sinteticas": comSinteticas(corrigido()),
  "c1-semis-decididas": comSinteticas(semisDecididas(corrigido())),
  "c2-final-materializada": comSinteticas(finalMaterializada(semisDecididas(corrigido()))),
  "c3-final-decidida-normal": comSinteticas(finalDecidida(finalMaterializada(semisDecididas(corrigido())), 2, 1, "A")),
  "c4-final-decidida-penaltis": comSinteticas(finalDecidida(finalMaterializada(semisDecididas(corrigido())), 1, 1, "B", [2, 4])),
  "c5-final-invertida-decidida": comSinteticas(finalDecidida(finalMaterializada(semisDecididas(corrigido()), true), 0, 2, "B")),
  "c6-sem-topologia": (() => {
    const s = comSinteticas(finalDecidida(finalMaterializada(semisDecididas(corrigido())), 2, 1, "A"));
    delete s.phases.semifinal.topology; delete s.phases.final.topology;
    return s;
  })(),
};

// ── Lado do site ──────────────────────────────────────────────────────────────────────────────
const PHASES = ctx.window.CDB2026_DATA.phases;
function pernasComPlacar(s) {
  const out = [];
  for (const p of PHASES) {
    const legs = p.format === "TWO_LEG" ? ["first", "second"] : ["single"];
    for (const [tieId, tie] of Object.entries(s.phases?.[p.id]?.ties || {})) {
      for (const leg of legs) {
        const m = tie.matches?.[leg];
        if (m && m.goalsHome != null && m.goalsAway != null) out.push([p.id, tieId, leg]);
      }
    }
  }
  return out;
}
const PRIZES = ctx.window.CDB2026_CONFIG.prizes;
function sitePayouts(s, ranked) {
  // O site nao tem uma funcao de rateio: o rateio e 70/20/10 do pote sobre o rank de
  // rankEntriesBy(), dividido entre empatados -- o mesmo que compute_final_payouts() faz.
  const off = SITE.officialPodium(s);
  if (!off.champion) return null;
  const pot = s.entries.length * (ctx.window.CDB2026_CONFIG.entryFee || 5);
  const out = [];
  for (const [r, k] of [[1, "first"], [2, "second"], [3, "third"]]) {
    const grupo = ranked.filter(x => x.rank === r);
    for (const x of grupo) out.push({ entryName: x.e.entryName, rank: r, amount: (pot * PRIZES[k]) / grupo.length, tied: grupo.length > 1 });
  }
  return { pot, payouts: out, podium: off };
}
function lado_site(s) {
  const ranked = SITE.rankEntriesBy(s.entries, e => SITE.scoreEntry(e, s));
  const rank = Object.fromEntries(ranked.map(x => [x.e.id, x.rank]));
  const legs = pernasComPlacar(s);
  const entries = s.entries.map(e => {
    const { total, detail } = SITE.scoreEntry(e, s);
    const ex = SITE.explainScore(e, s);
    return { id: e.id, name: e.entryName, total, detail, rank: rank[e.id],
             explain: { total: ex.total, reconciles: ex.reconciles, breakdown: ex.breakdown },
             predicted: SITE.predictedPodium(e, s), linhas: SITE.linhasVerPalpites(e, s) };
  });
  return { entries, official: SITE.officialPodium(s), legs, payouts: sitePayouts(s, ranked) };
}

// ── Lado do e-mail (Python real) ──────────────────────────────────────────────────────────────
const PY = String.raw`
import json, sys
sys.path.insert(0, sys.argv[1])
import audit_scoring as AS
import send_result_email as S
def _no_send(*a, **k):
    raise SystemExit("send_email chamado num teste de paridade")
S.send_email = _no_send
S._send_to_all = _no_send
out = {}
for nome, s in json.load(sys.stdin).items():
    ph = s["phases"]
    all_ties = S._all_ties(s)
    podium = S.official_podium(ph)
    s["paid"] = {e["id"]: True for e in s["entries"]}
    ents = []
    for e in s["entries"]:
        ex = AS.explain_score_site(e, ph)
        linhas = {}
        for pid, fmt in AS.SITE_PHASES:
            for tid in (ph.get(pid, {}).get("ties") or {}):
                for leg in AS.legs_for_format(fmt):
                    v = AS.leg_pick_view(e, ph, pid, tid, leg)
                    if v is not None:
                        d = S.entry_detail(e, all_ties, podium, phases=ph)["matches"].get(tid + ":" + leg)
                        v["pts"] = d["pts"] if d else None
                        linhas[pid + "|" + tid + "|" + leg] = v
        ents.append({"id": e["id"], "name": e["entryName"],
                     "total": S.score_entry_total(e, all_ties, podium, phases=ph),
                     "detail": S.entry_detail(e, all_ties, podium, phases=ph),
                     "explain": {"total": ex["total"], "reconciles": ex["reconciles"], "breakdown": ex["breakdown"]},
                     "predicted": S.predicted_podium(e, ph), "linhas": linhas})
    rank = {x["e"]["id"]: x["rank"] for x in AS.rank_entries_site(s["entries"], ph)}
    for x in ents:
        x["rank"] = rank[x["id"]]
    emails = {}
    for pid, fmt in AS.SITE_PHASES:
        for tid, tie in (ph.get(pid, {}).get("ties") or {}).items():
            for leg in AS.legs_for_format(fmt):
                m = (tie.get("matches") or {}).get(leg) or {}
                if m.get("goalsHome") is None or m.get("goalsAway") is None:
                    continue
                legs = AS.legs_for_format(fmt)
                decided = bool(tie.get("qualifiedTeamId")) and leg == legs[-1]
                items = S.leg_breakdown_items(s, pid, tid, leg, decided)
                html = S.build_html(s, pid, tid, leg, tie_just_decided=decided)
                emails[pid + "|" + tid + "|" + leg] = {"decided": decided, "items": items, "html_len": len(html),
                                                       "sem_palpite": [i["name"] for i in items if i["pick_str"] == "—"]}
    out[nome] = {"entries": ents, "official": podium, "payouts": S.compute_final_payouts(s), "emails": emails}
print(json.dumps(out, ensure_ascii=False))
`;
const py = spawnSync("python3", ["-I", "-c", PY, AQUI], {
  input: JSON.stringify(CENARIOS), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  env: { PATH: process.env.PATH, BOLAO_TEST_RUN: "1", HOME: process.env.HOME || "" },
});
if (py.status !== 0) { console.log(py.stdout); console.log(py.stderr); process.exit(1); }
const PYR = JSON.parse(py.stdout);

// ── Comparacao ────────────────────────────────────────────────────────────────────────────────
console.log("CDB2026 — paridade de pontuação site (app.js) × e-mail (Python)\n");
for (const [nome, s] of Object.entries(CENARIOS)) {
  const site = lado_site(s), mail = PYR[nome];
  T(`${nome}: total, detail, rank, pódio previsto e explainScore iguais (${site.entries.length} entradas)`, () => {
    site.entries.forEach((se, i) => {
      const pe = mail.entries[i];
      A(pe.id === se.id, `ordem de entradas diferente em ${i}`);
      A(pe.total === se.total, `${se.name}: total site=${se.total} e-mail=${pe.total}`);
      A(canon(pe.detail) === canon(se.detail), `${se.name}: detail difere\n site=${canon(se.detail)}\n mail=${canon(pe.detail)}`);
      A(pe.rank === se.rank, `${se.name}: rank site=${se.rank} e-mail=${pe.rank}`);
      A(canon(pe.predicted) === canon(se.predicted), `${se.name}: pódio previsto site=${canon(se.predicted)} e-mail=${canon(pe.predicted)}`);
      A(se.explain.reconciles && pe.explain.reconciles, `${se.name}: explicação não reconcilia`);
      A(canon(pe.explain) === canon(se.explain), `${se.name}: explainScore difere\n site=${canon(se.explain)}\n mail=${canon(pe.explain)}`);
    });
    A(canon(mail.official) === canon(site.official), `pódio oficial site=${canon(site.official)} e-mail=${canon(mail.official)}`);
  });
  T(`${nome}: cada linha de perna de "Ver palpites" == a do e-mail (times, palpite, pontos)`, () => {
    site.entries.forEach((se, i) => {
      const pe = mail.entries[i];
      // O site so lista pernas de confrontos com os dois times; o e-mail so pergunta por pernas
      // que existem -- comparar nos dois sentidos.
      A(canon(pe.linhas) === canon(se.linhas), `${se.name}: linhas diferem\n site=${canon(se.linhas)}\n mail=${canon(pe.linhas)}`);
    });
  });
  T(`${nome}: tabela do e-mail de cada perna com placar == pontos do site, nunca "sem palpite" com palpite`, () => {
    for (const [pid, tid, leg] of site.legs) {
      const em = mail.emails[`${pid}|${tid}|${leg}`];
      A(em && em.html_len > 0, `e-mail de ${pid}|${tid}|${leg} não renderizou`);
      const porNome = Object.fromEntries(em.items.map(x => [x.name, x]));
      for (const se of site.entries) {
        const linha = se.linhas[`${pid}|${tid}|${leg}`];
        const tieBonus = em.decided ? (se.detail.ties?.[tid]?.pts || 0) : 0;
        const esperado = (se.detail.matches?.[`${tid}:${leg}`]?.pts || 0) + tieBonus;
        const item = porNome[se.name];
        A(item, `${se.name} ausente da tabela do e-mail de ${tid}:${leg}`);
        A(item.pts === esperado, `${se.name} ${tid}:${leg}: e-mail ${item.pts} pts, site ${esperado}`);
        if (linha) {
          A(item.pick_str === `${linha.goalsHome}–${linha.goalsAway}`, `${se.name} ${tid}:${leg}: e-mail mostra ${item.pick_str}, site ${linha.goalsHome}×${linha.goalsAway}`);
        } else {
          A(item.pick_str === "—", `${se.name} ${tid}:${leg}: e-mail inventou palpite ${item.pick_str}`);
        }
      }
    }
  });
  T(`${nome}: rateio da final (compute_final_payouts) == rank do site`, () => {
    A(canon(mail.payouts) === canon(site.payouts), `\n site=${canon(site.payouts)}\n mail=${canon(mail.payouts)}`);
  });
}

// ── Numeros auditados do estado corrigido (b) ─────────────────────────────────────────────────
// Entradas sinteticas do fixture na ordem do snapshot publico; o total e os pontos da ida da
// semifinal Vasco x Palmeiras (0x1) saem do app.js e foram conferidos por auditoria independente.
const ESPERADO_B = {
  "Entrada 01": [114, 5], "Entrada 02": [100, null], "Entrada 03": [114, 1], "Entrada 04": [131, 1],
  "Entrada 05": [95, 0], "Entrada 06": [86, 1], "Entrada 07": [120, 10], "Entrada 08": [111, 1],
  "Entrada 09": [100, 5], "Entrada 10": [101, 0], "Entrada 11": [143, 5], "Entrada 12": [110, 5],
};
T("(b) corrigido: totais e pontos da ida da semifinal == auditoria (site e e-mail)", () => {
  const s = CENARIOS["b-corrigido"];
  const site = lado_site(s), mail = PYR["b-corrigido"];
  for (const se of site.entries) {
    const [tot, ida] = ESPERADO_B[se.name];
    A(se.total === tot, `${se.name}: site total ${se.total}, auditado ${tot}`);
    const d = se.detail.matches[`${SF_PV}:first`];
    A((d ? d.pts : null) === ida, `${se.name}: site ida ${d ? d.pts : null}, auditado ${ida}`);
  }
  const em = mail.emails[`semifinal|${SF_PV}|first`];
  A(em.sem_palpite.length === 1 && em.sem_palpite[0] === "Entrada 02",
    `"sem palpite" só para quem não palpitou a semifinal; veio ${JSON.stringify(em.sem_palpite)}`);
});

T("(a) snapshot: a volta gravada errada também pontua igual nos dois lados (prova do estado de antes)", () => {
  const mail = PYR["a-snapshot-2026-11-01"];
  A(mail.emails[`semifinal|${SF_PV}|second`], "o snapshot de antes deveria ter a volta com placar");
});

T("o e-mail de resultado mostra o time PREVISTO entre parênteses quando difere do real", () => {
  const mail = PYR["b-corrigido+sinteticas"];
  const item = mail.emails[`semifinal|${SF_PV}|first`].items.find(x => x.name === "Sintetica Vitoria-Inter-Cruzeiro");
  A(item.pick_teams === "Vasco (Vitória) × Palmeiras", `pick_teams=${JSON.stringify(item.pick_teams)}`);
});

console.log(`\n${fail ? "✗" : "✓"} ${ok} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
