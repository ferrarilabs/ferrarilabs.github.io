/**
 * test_epg_broadcasts.mjs — "Onde assistir" corroborado pela grade de TV (Issue #431).
 *
 * Prova as regras de evidência de epg_broadcasts.mjs, a fusão com a curadoria, o last-known-good, as
 * regras novas do validador e o CLI de ponta a ponta (sem rede: a grade vem de disco). Também roda
 * como autoteste no workflow `br2026_broadcast_epg.yml` ANTES de qualquer publicação — corroborador
 * vermelho não grava nada.
 *
 * Os títulos de programa usados aqui são os formatos REAIS observados na grade EPGShare de
 * 2026-09-12 ("Palmeiras x São Paulo - Ao Vivo" no BR2; título + subtítulo "Ao Vivo" no BR1 de São
 * Paulo; "VT - ..."; "Pré-Hora: ..."; "Flamengo x São Paulo" com categoria "Futebol Feminino").
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SOURCE_MODEL, AUTO_PRUNE_AFTER_MS, parseXmltv, parseXmltvTime, resolveChannel, clubsMentioned,
  corroborateFixture, corroborateFixtures, mergeBroadcasts, serializeDoc, isAutoChannelLabel,
} from "./epg_broadcasts.mjs";
import { validate } from "./validate_broadcasts.mjs";
import { fixturesInScope } from "./sync_epg_broadcasts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };
const J = (x) => JSON.stringify(x);

const T = (iso) => Date.parse(iso);
function prog(channelId, startIso, stopIso, title, { sub = null, cats = [], source = "epgshare-br2" } = {}) {
  return { source, channelId, start: T(startIso), stop: T(stopIso), title, subTitle: sub, categories: cats };
}
function fixture(id, kickoffIso, home, away) {
  return { id, kickoffMs: T(kickoffIso), kickoffUtc: kickoffIso.replace(/:00(\.000)?Z$/, "Z"), home, away };
}
const SANTOS_CRUZEIRO = fixture("401841233", "2026-09-13T00:00:00Z", "Santos", "Cruzeiro");
const LIVE_SC = prog("SporTV.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Santos x Cruzeiro - Ao Vivo");
const NOW = new Date("2026-09-12T18:00:00Z");
const BOTH = new Set(["epgshare-br1", "epgshare-br2"]);

function curated(over = {}) {
  return { espnId: "401909114", kickoffUtc: "2026-09-03T23:00Z", home: "Grêmio", away: "Internacional",
    channels: ["Amazon Prime Video"], confirmedAt: "2026-09-03", source: "fonte-humana.example", ...over };
}
function runMerge(doc, fixtures, programmes, { now = NOW, okSources = BOTH } = {}) {
  return mergeBroadcasts(doc, fixtures, corroborateFixtures(fixtures, programmes), { now, okSources, programmes });
}

console.log("\nOnde assistir — EPG corroborado com override curado (#431)\n");

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("A. XMLTV e normalização de canal");

test("horário XMLTV com offset -0300 vira UTC correto", () => {
  A(parseXmltvTime("20260912210000 -0300") === T("2026-09-13T00:00:00Z"), "offset mal aplicado");
  A(parseXmltvTime("20260912050000 +0000") === T("2026-09-12T05:00:00Z"), "UTC mal lido");
  A(Number.isNaN(parseXmltvTime("amanhã")), "data ilegível deveria ser NaN");
});

test("parser lê atributos em qualquer ordem, entidades, subtítulo e categorias; descarta horário ilegível", () => {
  const xml = `<?xml version="1.0"?><tv><channel id="SporTV.br"><display-name>SporTV</display-name></channel>
    <programme channel="SporTV.br" start="20260912210000 -0300" stop="20260912230000 -0300">
      <title lang="pt">Santos x Cruzeiro &amp; Cia</title><sub-title>Ao Vivo</sub-title>
      <category lang="pt">Esporte</category><category lang="pt">Futebol</category></programme>
    <programme start="20260912230000 -0300" stop="20260913000000 -0300" channel="SporTV.br"><title>VT</title></programme>
    <programme start="lixo" stop="20260913000000 -0300" channel="SporTV.br"><title>X</title></programme></tv>`;
  const g = parseXmltv(xml, "epgshare-br2");
  A(g.channelCount === 1 && g.programmes.length === 2, J(g));
  const p = g.programmes[0];
  A(p.title === "Santos x Cruzeiro & Cia" && p.subTitle === "Ao Vivo" && J(p.categories) === J(["Esporte", "Futebol"]), J(p));
  A(p.start === T("2026-09-13T00:00:00Z"), "start");
});

test("canais da allowlist resolvem para o nome apresentado; o resto é null", () => {
  const cases = {
    "SporTV.br": "SporTV", "São.Paulo/SP..SporTV.HD.³.br": "SporTV", "São.Paulo/SP..SporTV.3..br": "SporTV 3",
    "SporTV.2.br": "SporTV 2", "Premiere.Clubes.br": "Premiere", "São.Paulo/SP..Premiere.Clubes.HD.br": "Premiere",
    "São.Paulo/SP..PREMIERE.HD.3.³.br": "Premiere 3", "Belo.Horizonte/MG..Premiere.7.br": "Premiere 7",
    "Globo.br": "Globo (TV aberta — consulte sua região)", "São.Paulo/SP..Globo.HD.br": "Globo (TV aberta — consulte sua região)",
    "Record.TV.br": "Record (TV aberta — consulte sua região)", "Band.Sports.br": "BandSports",
    "São.Paulo/SP..Band.Sports.HD.³.br": "BandSports", "ESPN.br": "ESPN", "ESPN.4.br": "ESPN 4",
    "São.Paulo/SP..Espn.4.br": "ESPN 4", "CazeTV.br": "CazéTV",
    "Globo.News.br": null, "São.Paulo/SP..GloboNews.br": null, "Record.News.br": null, "Band.News.br": null,
    "TNT.br": null, "Combate.br": null, "Paramount.Channel.br": null,
  };
  for (const [id, want] of Object.entries(cases)) {
    const got = resolveChannel(id);
    A((got ? got.label : null) === want, `${id}: esperado ${want}, veio ${got && got.label}`);
  }
});

test("rótulos publicáveis pelo pipeline: canais de grade sim, streaming sem grade não", () => {
  for (const l of ["SporTV", "SporTV 2", "Premiere", "Premiere 5", "ESPN 4", "BandSports", "CazéTV",
    "Globo (TV aberta — consulte sua região)"]) A(isAutoChannelLabel(l), l);
  for (const l of ["Amazon Prime Video", "Prime Video", "sportv", "Globo", "TNT", "Premiere FC"]) A(!isAutoChannelLabel(l), l);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nB. Corroboração — só evidência forte publica");

test("os DOIS clubes + horário do kickoff ⇒ casa, com proveniência", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [LIVE_SC]);
  A(r.channels.length === 1 && r.channels[0].label === "SporTV", J(r));
  const e = r.channels[0].evidence[0];
  A(e.programmeTitle === "Santos x Cruzeiro - Ao Vivo" && e.source === "epgshare-br2" && e.epgChannelId === "SporTV.br", J(e));
  A(e.programmeStart === "2026-09-13T00:00:00Z" && J(e.matchedTeams) === J(["santos", "cruzeiro"]), J(e));
});

test("formato BR1 (título = confronto, subtítulo = 'Ao Vivo') também casa", () => {
  const p = prog("São.Paulo/SP..SporTV.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Santos x Cruzeiro", { sub: "Ao Vivo", source: "epgshare-br1" });
  A(corroborateFixture(SANTOS_CRUZEIRO, [p]).channels.length === 1, "BR1 deveria casar");
});

test("apenas UM clube ⇒ rejeita (caso real: 'Flamengo x São Paulo' não é Palmeiras × São Paulo)", () => {
  const f = fixture("401841234", "2026-09-12T21:30:00Z", "Palmeiras", "São Paulo");
  const r = corroborateFixture(f, [prog("SporTV.br", "2026-09-12T21:30:00Z", "2026-09-12T23:30:00Z", "Flamengo x São Paulo - Ao Vivo")]);
  A(r.channels.length === 0, J(r.channels));
  A(r.rejections.some((x) => x.reason === "ONE_TEAM_ONLY"), J(r.rejections));
});

test("título genérico ('Futebol', 'Brasileirão', 'Programação Globo') ⇒ rejeita", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [
    prog("Globo.br", "2026-09-12T23:45:00Z", "2026-09-13T02:00:00Z", "Programação Globo"),
    prog("SporTV.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Futebol", { cats: ["Esporte", "Futebol"] }),
    prog("Premiere.Clubes.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Brasileirão Série A - Ao Vivo"),
  ]);
  A(r.channels.length === 0, J(r.channels));
});

test("homônimo com sufixo de estado NÃO é o clube curto (Botafogo-SP, Atlético-GO, Botafogo-PB)", () => {
  const bota = fixture("1", "2026-09-16T22:30:00Z", "Botafogo", "Grêmio");
  const at = (title, ch = "ESPN.4.br") => [prog(ch, "2026-09-16T22:30:00Z", "2026-09-17T00:30:00Z", title)];
  A(corroborateFixture(bota, at("Botafogo-SP x Grêmio - Ao Vivo")).channels.length === 0, "Botafogo-SP virou Botafogo");
  A(corroborateFixture(bota, at("Botafogo-PB x Grêmio - Ao Vivo")).channels.length === 0, "Botafogo-PB (fora da tabela) virou Botafogo");
  const galo = fixture("2", "2026-09-12T19:00:00Z", "Atlético-MG", "Fluminense");
  const atG = (title) => [prog("SporTV.br", "2026-09-12T19:00:00Z", "2026-09-12T21:00:00Z", title)];
  A(corroborateFixture(galo, atG("Atlético-GO x Fluminense - Ao Vivo")).channels.length === 0, "Atlético-GO virou Atlético-MG");
  A(corroborateFixture(galo, atG("Atlético x Fluminense - Ao Vivo")).channels.length === 0, "'Atlético' sem estado é ambíguo");
  A(corroborateFixture(galo, atG("Athletico-PR x Fluminense - Ao Vivo")).channels.length === 0, "Athletico-PR virou Atlético-MG");
});

test("alias legítimo casa (Vasco da Gama ↔ Vasco, Red Bull Bragantino ↔ Bragantino, Athletico Paranaense ↔ Athletico-PR, Atlético-MG ↔ Atlético Mineiro)", () => {
  const f = fixture("3", "2026-09-19T23:30:00Z", "Vasco da Gama", "Red Bull Bragantino");
  A(corroborateFixture(f, [prog("Premiere.Clubes.br", "2026-09-19T23:00:00Z", "2026-09-20T01:40:00Z", "Vasco x Bragantino - Ao Vivo")]).channels.length === 1, "Vasco/Bragantino");
  const g = fixture("4", "2026-09-20T22:30:00Z", "Athletico Paranaense", "Atlético-MG");
  A(corroborateFixture(g, [prog("SporTV.br", "2026-09-20T22:30:00Z", "2026-09-21T00:30:00Z", "Athletico-PR x Atlético Mineiro - Ao Vivo")]).channels.length === 1, "Athletico/Atlético Mineiro");
  const keys = clubsMentioned("São Paulo x Atlético-MG").keys;
  A(keys.has("sao-paulo") && keys.has("atletico-mg") && keys.size === 2, J([...keys]));
});

test("programa fora da janela do kickoff ⇒ rejeita (VT de madrugada, bloco que acaba antes, início atrasado demais)", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [
    prog("SporTV.br", "2026-09-12T21:30:00Z", "2026-09-12T23:30:00Z", "Santos x Cruzeiro - Ao Vivo"),
    prog("SporTV.br", "2026-09-13T00:30:00Z", "2026-09-13T02:30:00Z", "Santos x Cruzeiro - Ao Vivo"),
    prog("Premiere.Clubes.br", "2026-09-13T02:30:00Z", "2026-09-13T03:00:00Z", "Santos x Cruzeiro"),
    prog("SporTV.br", "2026-09-13T23:00:00Z", "2026-09-14T01:00:00Z", "Santos x Cruzeiro - Ao Vivo"),
  ]);
  A(r.channels.length === 0, J(r.channels));
  A(r.rejections.filter((x) => x.reason === "OUT_OF_KICKOFF_WINDOW").length === 3, J(r.rejections));
});

test("múltiplos canais legítimos para o mesmo jogo (caso real Bahia × Remo: SporTV em duas fontes + Premiere)", () => {
  const f = fixture("401841230", "2026-09-14T23:00:00Z", "Bahia", "Remo");
  const r = corroborateFixture(f, [
    prog("São.Paulo/SP..SporTV.br", "2026-09-14T23:00:00Z", "2026-09-15T01:00:00Z", "Bahia x Remo", { sub: "Ao Vivo", source: "epgshare-br1" }),
    prog("São.Paulo/SP..SporTV.HD.³.br", "2026-09-14T23:00:00Z", "2026-09-15T01:00:00Z", "Bahia x Remo", { sub: "Ao Vivo", source: "epgshare-br1" }),
    prog("SporTV.br", "2026-09-14T23:00:00Z", "2026-09-15T01:00:00Z", "Bahia x Remo - Ao Vivo"),
    prog("Premiere.Clubes.br", "2026-09-14T22:30:00Z", "2026-09-15T01:10:00Z", "Bahia x Remo - Ao Vivo"),
  ]);
  A(J(r.channels.map((c) => c.label)) === J(["SporTV", "Premiere"]), J(r.channels.map((c) => c.label)));
  const sportv = r.channels[0].evidence;
  A(sportv.length === 2 && new Set(sportv.map((e) => e.source)).size === 2, `HD/SD duplicado ou fonte perdida: ${J(sportv)}`);
});

test("canal Premiere específico é preservado quando a grade o distingue", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [prog("São.Paulo/SP..Premiere.3.br", "2026-09-12T23:30:00Z", "2026-09-13T02:10:00Z", "Santos x Cruzeiro", { sub: "Ao Vivo", source: "epgshare-br1" })]);
  A(r.channels.length === 1 && r.channels[0].label === "Premiere 3", J(r.channels));
});

test("replay e pré-jogo no horário ⇒ rejeitados; a transmissão ao vivo continua casando", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [
    prog("SporTV.2.br", "2026-09-12T23:30:00Z", "2026-09-13T01:00:00Z", "VT - Santos x Cruzeiro"),
    prog("Premiere.Clubes.br", "2026-09-12T23:00:00Z", "2026-09-13T01:00:00Z", "Pré-Hora: Santos x Cruzeiro - Ao Vivo"),
    LIVE_SC,
  ]);
  A(J(r.channels.map((c) => c.label)) === J(["SporTV"]), J(r.channels.map((c) => c.label)));
  A(r.rejections.filter((x) => x.reason === "REJECTED_MARKER").length === 2, J(r.rejections));
});

test("categoria 'Futebol Feminino' numa fonte VETA o mesmo canal/horário listado sem categoria na outra (caso real 2026-09-12)", () => {
  const f = fixture("9", "2026-09-12T19:00:00Z", "Flamengo", "São Paulo");
  const r = corroborateFixture(f, [
    prog("São.Paulo/SP..SporTV.br", "2026-09-12T19:00:00Z", "2026-09-12T21:30:00Z", "Flamengo x São Paulo", { sub: "Ao Vivo", source: "epgshare-br1" }),
    prog("SporTV.br", "2026-09-12T19:00:00Z", "2026-09-12T21:30:00Z", "Flamengo x São Paulo - Ao Vivo", { cats: ["Esporte", "Futebol Feminino"] }),
  ]);
  A(r.channels.length === 0, J(r.channels));
  A(r.rejections.some((x) => x.reason === "VETOED_BY_MARKER_IN_OTHER_SOURCE"), J(r.rejections));
});

test("fontes DIVERGEM no mesmo canal (caso real ESPN.br: BR1 um jogo, BR2 outro programa) ⇒ rejeita", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [
    prog("ESPN.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Santos x Cruzeiro - Ao Vivo", { source: "epgshare-br1" }),
    prog("ESPN.br", "2026-09-12T23:30:00Z", "2026-09-13T01:00:00Z", "Mundo F - Ao Vivo"),
  ]);
  A(r.channels.length === 0 && r.rejections.some((x) => x.reason === "SOURCE_DISAGREEMENT"), J(r));
});

test("pré-programa que acaba logo depois do kickoff na outra fonte NÃO é divergência", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [
    prog("São.Paulo/SP..SporTV.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Santos x Cruzeiro", { sub: "Ao Vivo", source: "epgshare-br1" }),
    prog("SporTV.br", "2026-09-12T23:00:00Z", "2026-09-13T00:10:00Z", "Aquecimento sportv - Ao Vivo"),
  ]);
  A(J(r.channels.map((c) => c.label)) === J(["SporTV"]), J(r));
});

test("programa com mais de dois clubes (rodada dupla) é ambíguo ⇒ rejeita", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [prog("SporTV.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Santos x Cruzeiro / Palmeiras x São Paulo")]);
  A(r.channels.length === 0 && r.rejections.some((x) => x.reason === "MORE_THAN_TWO_CLUBS"), J(r));
});

test("um mesmo programa que corrobora duas partidas é ambíguo ⇒ nenhuma das duas publica", () => {
  const dup = fixture("999", "2026-09-13T00:00:00Z", "Santos", "Cruzeiro");
  const res = corroborateFixtures([SANTOS_CRUZEIRO, dup], [LIVE_SC]);
  A(res.get("401841233").channels.length === 0 && res.get("999").channels.length === 0, J([...res]));
});

test("canal fora da allowlist (TNT, GloboNews) nunca vira transmissão", () => {
  const r = corroborateFixture(SANTOS_CRUZEIRO, [
    prog("TNT.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Santos x Cruzeiro - Ao Vivo"),
    prog("Globo.News.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Santos x Cruzeiro - Ao Vivo"),
  ]);
  A(r.channels.length === 0 && r.rejections.filter((x) => x.reason === "CHANNEL_NOT_ALLOWLISTED").length === 2, J(r));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nC. Fusão com broadcasts.json — curadoria vence, last-known-good preserva");

const BASE = { schemaVersion: 1, _comment: "teste", entries: [curated()] };

test("jogo corroborado entra como origin=epg, curadoria fica byte-idêntica e o documento valida", () => {
  const { doc, changed, report } = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]);
  A(changed && doc.sourceModel === SOURCE_MODEL, "deveria mudar e declarar o modelo");
  A(J(doc.entries[0]) === J(BASE.entries[0]), "curadoria alterada");
  const auto = doc.entries[1];
  A(auto.origin === "epg" && auto.espnId === "401841233" && J(auto.channels) === J(["SporTV"]), J(auto));
  A(auto.collectedAt === "2026-09-12T18:00:00Z" && auto.evidence[0].collectedAt === auto.collectedAt, J(auto));
  A(report[0].status === "ADDED", J(report));
  const v = validate(doc);
  A(v.ok, J(v.errors));
});

test("EPG indisponível preserva o last-known-good: nada muda, nada some", () => {
  const first = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc;
  const { doc, changed, report } = runMerge(first, [SANTOS_CRUZEIRO], [], { okSources: new Set(), now: new Date("2026-09-12T21:00:00Z") });
  A(!changed && J(doc) === J(first), `mudou sem fonte: ${J(doc)}`);
  A(report[0].status === "KEPT_LAST_KNOWN_GOOD", J(report));
});

test("fonte PARCIAL: a fonte que deu a evidência caiu ⇒ canal mantido, mesmo com a outra fonte mostrando outra coisa", () => {
  const first = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc; // evidência veio do br2
  const other = prog("São.Paulo/SP..SporTV.br", "2026-09-12T23:00:00Z", "2026-09-13T03:00:00Z", "Sportv Repórter", { source: "epgshare-br1" });
  const { doc, changed } = runMerge(first, [SANTOS_CRUZEIRO], [other], { okSources: new Set(["epgshare-br1"]) });
  A(!changed && doc.entries.length === 2, J(doc.entries));
});

test("grade positivamente CONTRADITÓRIA na mesma fonte (outro programa no ar no kickoff) ⇒ canal removido", () => {
  const first = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc;
  const moved = prog("SporTV.br", "2026-09-12T23:30:00Z", "2026-09-13T02:00:00Z", "Grêmio x Vasco - Ao Vivo");
  const { doc, changed, report } = runMerge(first, [SANTOS_CRUZEIRO], [moved]);
  A(changed && doc.entries.length === 1 && report[0].status === "REMOVED_CONTRADICTED", J(report));
});

test("canal simplesmente AUSENTE da grade (sem programa no kickoff) não é contradição ⇒ mantido", () => {
  const first = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc;
  const unrelated = prog("Premiere.Clubes.br", "2026-09-13T00:00:00Z", "2026-09-13T02:00:00Z", "Giro da Rodada");
  const { doc, changed } = runMerge(first, [SANTOS_CRUZEIRO], [unrelated]);
  A(!changed && doc.entries.length === 2, J(doc.entries));
});

test("curadoria humana vence a evidência automática (por espnId) — e o relatório mostra o que o EPG viu", () => {
  const human = curated({ espnId: "401841233", kickoffUtc: "2026-09-13T00:00Z", home: "Santos", away: "Cruzeiro", channels: ["Amazon Prime Video"] });
  const docIn = { ...BASE, entries: [human] };
  const { doc, report } = runMerge(docIn, [SANTOS_CRUZEIRO], [LIVE_SC]);
  A(doc.entries.length === 1 && J(doc.entries[0]) === J(human), J(doc.entries));
  A(report[0].status === "CURATED_OVERRIDE" && J(report[0].epgAlsoSaw) === J(["SporTV"]), J(report));
});

test("curadoria SEM espnId também vence, casada por minuto + clubes via alias (Vasco ↔ Vasco da Gama)", () => {
  const f = fixture("401841236", "2026-09-12T19:00:00Z", "Grêmio", "Vasco da Gama");
  const human = curated({ espnId: undefined, kickoffUtc: "2026-09-12T19:00Z", home: "Grêmio", away: "Vasco", channels: ["Premiere"] });
  const p = prog("SporTV.br", "2026-09-12T19:00:00Z", "2026-09-12T21:00:00Z", "Grêmio x Vasco - Ao Vivo");
  const { doc, report } = runMerge({ ...BASE, entries: [human] }, [f], [p]);
  A(doc.entries.length === 1 && report[0].status === "CURATED_OVERRIDE", J(report));
});

test("curadoria adicionada DEPOIS de uma entrada automática a substitui (sem duplicata)", () => {
  const first = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc;
  const human = curated({ espnId: "401841233", kickoffUtc: "2026-09-13T00:00Z", home: "Santos", away: "Cruzeiro", channels: ["Premiere"] });
  const withHuman = { ...first, entries: [...first.entries, human] };
  const { doc } = runMerge(withHuman, [SANTOS_CRUZEIRO], [LIVE_SC]);
  A(doc.entries.filter((e) => e.espnId === "401841233").length === 1 && !doc.entries.some((e) => e.origin === "epg"), J(doc.entries));
  A(validate(doc).ok, J(validate(doc).errors));
});

test("idempotente: mesma grade num run posterior não muda nada (collectedAt preservado ⇒ sem commit)", () => {
  const first = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc;
  const second = runMerge(first, [SANTOS_CRUZEIRO], [LIVE_SC], { now: new Date("2026-09-12T21:00:00Z") });
  A(!second.changed && J(second.doc) === J(first), "run repetido gerou mudança");
  A(second.report[0].status === "UNCHANGED", J(second.report));
});

test("canal novo na grade ⇒ UPDATED, evidência antiga mantém o collectedAt original", () => {
  const first = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc;
  const prem = prog("Premiere.Clubes.br", "2026-09-12T23:30:00Z", "2026-09-13T02:10:00Z", "Santos x Cruzeiro - Ao Vivo");
  const { doc, report } = runMerge(first, [SANTOS_CRUZEIRO], [LIVE_SC, prem], { now: new Date("2026-09-12T21:00:00Z") });
  const auto = doc.entries.find((e) => e.origin === "epg");
  A(report[0].status === "UPDATED" && J(auto.channels) === J(["SporTV", "Premiere"]), J(auto));
  A(auto.evidence.find((e) => e.channel === "SporTV").collectedAt === "2026-09-12T18:00:00Z", J(auto.evidence));
  A(auto.evidence.find((e) => e.channel === "Premiere").collectedAt === "2026-09-12T21:00:00Z", J(auto.evidence));
});

test("entrada automática de jogo passado há mais de 7 dias sai; jogo recente fora do escopo fica", () => {
  const first = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc;
  const later = new Date(T("2026-09-13T00:00:00Z") + AUTO_PRUNE_AFTER_MS + 60000);
  A(runMerge(first, [], [], { now: later }).doc.entries.length === 1, "não podou");
  A(runMerge(first, [], [], { now: new Date("2026-09-15T00:00:00Z") }).doc.entries.length === 2, "podou cedo demais");
});

test("serialização mantém arrays curtos em uma linha e faz round-trip exato", () => {
  const { doc } = runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]);
  const text = serializeDoc(doc);
  A(J(JSON.parse(text)) === J(doc), "round-trip");
  A(text.includes('"channels": ["SporTV"]'), text);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nD. Validador — registro automático é revalidado contra a própria evidência");

const goodAuto = () => runMerge(BASE, [SANTOS_CRUZEIRO], [LIVE_SC]).doc.entries[1];
const withAuto = (over) => ({ entries: [curated(), { ...goodAuto(), ...over }] });

test("o broadcasts.json real do repositório continua válido", () => {
  const v = validate(JSON.parse(readFileSync(join(ROOT, "bolao/shared/data/broadcasts.json"), "utf8")));
  A(v.ok, J(v.errors));
});

test("origin=epg sem evidence ⇒ erro", () => A(!validate(withAuto({ evidence: [] })).ok, "aceitou sem evidência"));

test("origin=epg com streaming sem grade (Amazon Prime Video) ⇒ erro — nunca inventado", () => {
  const e = goodAuto();
  const v = validate(withAuto({ channels: ["Amazon Prime Video"], evidence: e.evidence.map((x) => ({ ...x, channel: "Amazon Prime Video" })) }));
  A(!v.ok && v.errors.some((m) => m.includes("Amazon Prime Video")), J(v.errors));
});

test("origin=epg com canal sem evidência própria ⇒ erro", () => {
  const v = validate(withAuto({ channels: ["SporTV", "Premiere"] }));
  A(!v.ok && v.errors.some((m) => m.includes("sem evidência própria")), J(v.errors));
});

test("origin=epg com evidência fora da janela do kickoff ⇒ erro", () => {
  const e = goodAuto();
  const v = validate(withAuto({ evidence: [{ ...e.evidence[0], programmeStart: "2026-09-13T03:30:00Z", programmeStop: "2026-09-13T04:00:00Z" }] }));
  A(!v.ok && v.errors.some((m) => m.includes("fora da janela")), J(v.errors));
});

test("origin=epg com um clube só em matchedTeams ⇒ erro", () => {
  const e = goodAuto();
  const v = validate(withAuto({ evidence: [{ ...e.evidence[0], matchedTeams: ["santos"] }] }));
  A(!v.ok, J(v.errors));
});

test("origin desconhecido ⇒ erro", () => A(!validate({ entries: [curated({ origin: "scraper" })] }).ok, "aceitou origin desconhecido"));

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nE. CLI de ponta a ponta (grade de disco, sem rede)");

const CLI = join(HERE, "sync_epg_broadcasts.mjs");
function xmltv(programmes) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const ts = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
  const ids = ["SporTV.br", "Premiere.Clubes.br", "Globo.br", "Record.TV.br", "ESPN.br", "TNT.br"];
  const filler = [];
  for (let h = 0; h < 60; h++) {
    const s = T("2026-09-12T00:00:00Z") + h * 3600000;
    filler.push({ channelId: "TNT.br", start: s, stop: s + 3600000, title: `Filme ${h}` });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n` +
    ids.map((id) => `<channel id="${id}"><display-name>${id}</display-name></channel>`).join("\n") + "\n" +
    [...programmes, ...filler].map((p) => `<programme start="${ts(p.start)}" stop="${ts(p.stop)}" channel="${p.channelId}"><title>${esc(p.title)}</title>${p.subTitle ? `<sub-title>${esc(p.subTitle)}</sub-title>` : ""}</programme>`).join("\n") +
    "\n</tv>\n";
}
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "epg431-"));
  const file = join(dir, "broadcasts.json");
  writeFileSync(file, serializeDoc(BASE));
  const snapshot = join(dir, "espn.json");
  writeFileSync(snapshot, J({ matches: [
    { id: "401841233", date: "2026-09-13T00:00Z", state: "pre", completed: false, homeTeam: "Santos", awayTeam: "Cruzeiro" },
    { id: "401841231", date: "2026-09-12T19:00Z", state: "pre", completed: false, homeTeam: "Atlético-MG", awayTeam: "Fluminense" },
    { id: "401840808", date: "2026-01-28T22:00Z", state: "post", completed: true, homeTeam: "Atlético-MG", awayTeam: "Palmeiras" },
  ] }));
  const epg = join(dir, "epg");
  mkdirSync(epg);
  return { dir, file, snapshot, epg };
}
const cli = (s, extra = []) => spawnSync(process.execPath, [CLI, `--file=${s.file}`, `--snapshot=${s.snapshot}`, "--now=2026-09-12T18:00:00Z", ...extra], { encoding: "utf8" });

test("fixturesInScope ignora jogo encerrado e fora da janela", () => {
  const s = sandbox();
  try {
    const fx = fixturesInScope(JSON.parse(readFileSync(s.snapshot, "utf8")), NOW, 7);
    A(J(fx.map((f) => f.id)) === J(["401841231", "401841233"]), J(fx));
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("--write com grade válida grava origin=epg só para o jogo corroborado; curadoria intacta", () => {
  const s = sandbox();
  try {
    writeFileSync(join(s.epg, "BR2.xml.gz"), gzipSync(xmltv([LIVE_SC])));
    writeFileSync(join(s.epg, "BR1.xml"), xmltv([]));
    const r = cli(s, [`--epg-dir=${s.epg}`, "--write"]);
    A(r.status === 0, r.stdout + r.stderr);
    const doc = JSON.parse(readFileSync(s.file, "utf8"));
    A(J(doc.entries[0]) === J(BASE.entries[0]), "curadoria mudou");
    A(doc.entries.length === 2 && doc.entries[1].espnId === "401841233", J(doc.entries));
    A(/Atlético-MG × Fluminense\s+— MISSING/.test(r.stdout) && /NO_PROGRAMME_NAMING_BOTH_CLUBS/.test(r.stdout), r.stdout);
    A(/sem grade no horário: Globo \(TV aberta — consulte sua região\), Record/.test(r.stdout), `motivo não diz quais canais estão sem grade:\n${r.stdout}`);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("EPG indisponível (nenhum arquivo) ⇒ exit 0 e broadcasts.json BYTE-idêntico", () => {
  const s = sandbox();
  try {
    const before = readFileSync(s.file, "utf8");
    const r = cli(s, [`--epg-dir=${s.epg}`, "--write"]);
    A(r.status === 0 && readFileSync(s.file, "utf8") === before, r.stdout + r.stderr);
    A(/EPG indisponível/.test(r.stdout), r.stdout);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("grade corrompida/trocada por HTML conta como fonte fora do ar ⇒ arquivo intocado", () => {
  const s = sandbox();
  try {
    writeFileSync(join(s.epg, "BR1.xml"), "<html><body>502 Bad Gateway</body></html>");
    writeFileSync(join(s.epg, "BR2.xml"), `<?xml version="1.0"?><tv></tv>`);
    const before = readFileSync(s.file, "utf8");
    const r = cli(s, [`--epg-dir=${s.epg}`, "--write"]);
    A(r.status === 0 && readFileSync(s.file, "utf8") === before, r.stdout + r.stderr);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("broadcasts.json atual inválido ⇒ exit 1 e nada é gravado", () => {
  const s = sandbox();
  try {
    writeFileSync(s.file, J({ entries: [curated({ channels: [] })] }));
    const before = readFileSync(s.file, "utf8");
    writeFileSync(join(s.epg, "BR2.xml"), xmltv([LIVE_SC]));
    const r = cli(s, [`--epg-dir=${s.epg}`, "--write"]);
    A(r.status === 1 && readFileSync(s.file, "utf8") === before, r.stdout + r.stderr);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("sem --write é dry-run: relata, não grava", () => {
  const s = sandbox();
  try {
    writeFileSync(join(s.epg, "BR2.xml"), xmltv([LIVE_SC]));
    const before = readFileSync(s.file, "utf8");
    const r = cli(s, [`--epg-dir=${s.epg}`]);
    A(r.status === 0 && readFileSync(s.file, "utf8") === before && /dry-run/.test(r.stdout), r.stdout + r.stderr);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nF. Isolamento — scoring, apps e navegador intocados");

test("o navegador nunca busca XMLTV: where_to_watch.js só conhece broadcasts.json", () => {
  const src = readFileSync(join(ROOT, "bolao/shared/js/where_to_watch.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  A(!/epgshare|\.xml|xmltv/i.test(code), "where_to_watch.js passou a referenciar a grade");
  A(/"\.\.\/shared\/data\/broadcasts\.json"/.test(code), "URL do JSON mudou");
});

test("o pipeline não importa nem escreve nada de app, scoring, entries ou pagamento", () => {
  for (const f of ["epg_broadcasts.mjs", "sync_epg_broadcasts.mjs"]) {
    const src = readFileSync(join(HERE, f), "utf8");
    const imports = [...src.matchAll(/^import[\s\S]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    const allowed = new Set(["node:fs", "node:zlib", "node:url", "node:path", "./epg_broadcasts.mjs", "./validate_broadcasts.mjs"]);
    A(imports.every((i) => allowed.has(i)), `${f} importa ${J(imports)}`);
    A(!/app\.js|config\.js|audit_scoring|supabase|entries_|payment/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), `${f} referencia superfície proibida`);
  }
  const cliSrc = readFileSync(CLI, "utf8");
  const writes = [...cliSrc.matchAll(/(writeFileSync|renameSync|appendFileSync)\(([^,]+)/g)].map((m) => m[2].trim());
  A(J(writes) === J(["tmp", "tmp", "opts.summary", "opts.jsonReport"]), `alvos de escrita inesperados: ${J(writes)}`);
});

test("auditorias de scoring dos três apps continuam passando", () => {
  for (const app of ["copa2026", "br2026", "cdb2026"]) {
    const r = spawnSync("python3", [join(ROOT, `bolao/${app}/scripts/audit_scoring.py`)], { encoding: "utf8", cwd: ROOT });
    A(r.status === 0 && /ALL CHECKS PASSED/.test(r.stdout), `${app}: exit ${r.status}\n${(r.stdout + r.stderr).slice(-800)}`);
  }
});

console.log(`\n${ok} ok, ${fail} falha(s)\n`);
process.exit(fail ? 1 : 0);
