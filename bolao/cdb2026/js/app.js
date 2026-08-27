/* Bolão Copa do Brasil 2026 — app.js v3.0
   Vanilla JS IIFE, no framework, no build step.
   Modelo de fases dinâmicas — ver docs/bolao/CDB2026_RULES_AND_MODEL.md (fonte oficial do
   modelo, aprovada por Eduardo em 2026-07-13). Diferente do bracket fixo da Copa do Mundo:
   confrontos e partidas nascem do admin cadastrando o sorteio real de cada fase, não de um
   chaveamento pré-definido no código-fonte. Pontuação é por partida (nunca por um "agregado"
   digitado direto pelo participante — isso era o modelo antigo v2.x, incorreto para o formato
   real da Copa do Brasil). */
(function () {
"use strict";

// ─── Aliases ────────────────────────────────────────────────────────────────
const C    = window.CDB2026_CONFIG;
const DATA = window.CDB2026_DATA;
const $    = id => document.getElementById(id);
const $$   = sel => [...document.querySelectorAll(sel)];
const esc  = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// CSV/formula injection: a cell starting with =, +, -, @ (or tab/CR) can be read as a formula
// by Excel/Sheets when the exported file is opened — prefix with an apostrophe so it's always
// literal text. Real risk here: entryName/payerName are free text fully controlled by whoever
// submits the entry form.
const csvEscape = v => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

// ─── Toast ──────────────────────────────────────────────────────────────────
// Mesma implementação da Copa (bolao/js/app.js) — não-bloqueante, substitui alert() em toda
// confirmação/erro que não seja validação de formulário (essas continuam alert(), de propósito
// — ver DESIGN_SYSTEM.md "Alert").
function showToast(msg, type = "info", durationMs = 3500) {
  let container = document.querySelector(".bolao-toasts");
  if (!container) {
    container = document.createElement("div");
    container.className = "bolao-toasts";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = `bolao-toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 320);
  }, durationMs);
}

// ─── i18n ───────────────────────────────────────────────────────────────────
const t = key => window.CDB2026_I18N?.["pt-BR"]?.[key] ?? key;
function applyI18n() {
  $$("[data-i18n]").forEach(el => { const v = t(el.dataset.i18n); if (v) el.textContent = v; });
}

// ─── State ──────────────────────────────────────────────────────────────────
let _editingEntry = null;
// IDs de entrada com o detalhe de palpites expandido no ranking — sobrevive a re-renders (sync,
// troca de idioma) até o usuário fechar. Mesmo padrão da Copa (bolao/js/app.js).
const _openRankDetails = new Set();

// Estado de uma fase dentro do estado dinâmico: cutoffAt (definido pelo admin ao cadastrar os
// confrontos da fase) + ties (confrontos reais, cadastrados conforme cada sorteio acontece —
// nunca inventados no código-fonte, ver data.js).
function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
function emptyState() {
  const phases = {};
  DATA.phases.forEach(p => { phases[p.id] = emptyPhaseState(); });
  // espnSync.activePhaseId: a única decisão que fica com o admin na sincronização automática —
  // qual fase é "a atual" agora. Ver autoSyncEspn() — não dá para inferir isso com segurança a
  // partir dos dados da ESPN sem verificação ao vivo (ambiente sem acesso de rede externo).
  // espnSync.seededKnownConfrontos: true depois que seedKnownConfrontos() rodar uma vez — nunca
  // reaplica a população inicial, mesmo que o admin remova um confronto semeado.
  return { entries: [], deletedIds: [], paid: {}, phases, espnSync: { activePhaseId: null, seededKnownConfrontos: false }, auditLog: [], meta: { updatedAt: null, version: C.siteVersion } };
}
// ─── INVARIANTE DE CICLO DE VIDA DO SORTEIO (hotfix 2026-08-07) ─────────────
// PROBLEMA REAL (não hipotético): depois do reparo manual da produção, o navegador do Eduardo
// continuava mostrando "próxima partida Bahia × Santos". A produção estava limpa (quartas com 0
// ties, cutoffAt null) e esse par é IMPOSSÍVEL no bracket real — o Bahia foi eliminado na fase-5
// (Bahia × Remo, qualified=B) e não está entre os 16 times das oitavas. O confronto era sintético,
// sobrevivendo no localStorage do dispositivo dele.
//
// Por que o reparo do banco não o apagava — três causas somadas:
//   1. `mergeStates` faz UNIÃO de ties nas duas direções (`{...localP.ties, ...remoteP.ties}`) e
//      ties não têm tombstone (entradas têm, via `deletedIds`). O remoto NUNCA consegue apagar um
//      tie que só existe local.
//   2. `healPhantomTies()` é one-shot (`if (s.espnSync?.healedPhantomTies) return false`): a flag
//      já estava true naquele navegador, então nunca rodava de novo.
//   3. Mesmo se rodasse, ele PULA quartas (`const known = DATA.knownConfrontos?.[phaseId]; if
//      (!known) return;`) — não existe lista curada para quartas porque o sorteio não aconteceu.
//      A fase mais vulnerável a confronto fabricado é justamente a que o healer se recusa a tocar.
//
// E o risco não era cosmético: o caminho de save também faz união, então salvar qualquer coisa
// como admin naquele navegador empurraria os ties sintéticos DE VOLTA para a produção.
//
// INVARIANTE: enquanto uma fase com sorteio (hoje só quartas) não tiver sorteio oficial, ela não
// pode ter confronto NENHUM. Qualquer tie ali é fantasma por definição — é a tradução direta da
// regra "nunca fabricar confrontos". Aplicado nos QUATRO pontos de passagem (leitura/render,
// merge, gravação local e payload remoto), não só na UI.
//
// Semifinal/Final NÃO entram aqui: elas não têm sorteio, resolvem deterministicamente a partir dos
// vencedores (Batch 4). Gate próprio, trabalho separado — não generalizar este por conveniência.
const DRAW_GATED_PHASES = new Set(["quartas"]);

// Duas formas de o sorteio ser oficial, nesta ordem de preferência:
//   1. `phase.officialDraw.validatedAt` — proveniência explícita (Batch 2/3: ingestão validada da
//      fonte oficial da CBF). Campo novo, aditivo; nenhum estado existente tem isto ainda.
//   2. `phase.cutoffAt !== null` — o admin registrou a fase deliberadamente (é o que ele já faz
//      hoje para abrir os palpites). Mantido para NÃO quebrar o fluxo manual que existe: sem isto
//      o sanitizador apagaria o sorteio real assim que o Eduardo o cadastrasse.
function phaseDrawIsOfficial(phase) {
  if (!phase) return false;
  if (phase.officialDraw && phase.officialDraw.validatedAt) return true;
  return phase.cutoffAt !== null && phase.cutoffAt !== undefined;
}

// ─── ESTADO EXPLÍCITO DO CICLO DE VIDA DO SORTEIO (Batch 2) ─────────────────
// Antes disto o "estado" do sorteio das quartas só existia implicitamente, espalhado em condições
// de UI (`ties` vazio? `cutoffAt` nulo? countdown some?). Isso é frágil de duas formas: não dá para
// TESTAR o estado, e duas telas podem discordar entre si sobre em que ponto do torneio estamos.
// Agora existe uma derivação única, pura e testável — a UI consome, nunca decide.
//
// A Copa do Brasil tem UM sorteio a partir daqui: o das quartas. Semifinal e final NÃO têm sorteio
// (resolvem por vencedores — Batch 4), por isso este ciclo de vida é específico das quartas.
const DRAW_LIFECYCLE = Object.freeze({
  WAITING: "WAITING_FOR_QUARTERFINAL_DRAW",       // não há nem data oficial marcada
  SCHEDULED: "QUARTERFINAL_DRAW_SCHEDULED",       // data marcada, ainda no futuro -> countdown
  AWAITING_PUBLICATION: "QUARTERFINAL_DRAW_AWAITING_PUBLICATION", // data passou, CBF não publicou
  INGESTED: "QUARTERFINAL_DRAW_INGESTED",         // chegou, mas proveniência ainda não validada
  LOCKED: "QUARTERFINAL_BRACKET_LOCKED",          // validado -> bracket autoritativo
});

// Proveniência mínima e AUDITÁVEL. Só campos que servem para provar de onde veio o bracket:
//   authority   — quem tem autoridade (sempre "CBF" para este torneio)
//   source      — como chegou ("cbf-publication" | "manual-admin")
//   sourceUrl   — onde verificar (publicação oficial)
//   scheduledAt — quando o sorteio acontece/aconteceu (dirige o countdown)
//   publishedAt — quando a CBF publicou o resultado do sorteio
//   ingestedAt  — quando entrou neste sistema
//   validatedAt — quando a proveniência foi conferida (é isto que torna o bracket oficial)
//   validatedBy — quem/o quê conferiu
//   bracketHash — impressão digital do conjunto de confrontos no momento da validação; permite
//                 detectar depois que o bracket mudou sem passar por uma correção controlada
// Nada além disso. Campo sem uso probatório não entra.
const OFFICIAL_DRAW_REQUIRED_FIELDS = ["authority", "source", "scheduledAt", "ingestedAt", "validatedAt"];

// Hash estável do conjunto de confrontos. Ordena os pares para que a MESMA chave de bracket seja
// produzida independentemente da ordem de inserção — dois ingests do mesmo sorteio oficial têm de
// dar o mesmo hash (exigência de idempotência do Batch 3).
function bracketFingerprint(ties) {
  const pairs = Object.values(ties || {})
    .filter(t => t && t.teamA && t.teamB)
    .map(t => [t.teamA, t.teamB].sort().join("~"))
    .sort();
  return pairs.length ? `${pairs.length}:${hashString(pairs.join("|"))}` : "";
}

// Proveniência é VÁLIDA só se todos os campos probatórios existirem e forem datas plausíveis.
// Malformada = tratada como NÃO validada (fail closed): um objeto `officialDraw` pela metade nunca
// pode destravar o bracket.
function officialDrawProvenanceIsValid(od) {
  if (!od || typeof od !== "object") return false;
  for (const f of OFFICIAL_DRAW_REQUIRED_FIELDS) {
    if (!od[f]) return false;
  }
  if (od.authority !== "CBF") return false;          // só a CBF tem autoridade sobre este sorteio
  for (const f of ["scheduledAt", "ingestedAt", "validatedAt"]) {
    if (Number.isNaN(new Date(od[f]).getTime())) return false;
  }
  return true;
}

/**
 * Deriva o estado do ciclo de vida do sorteio. PURA: não muta nada, não lê relógio global além de
 * `now` (injetável para teste).
 * Devolve { state, scheduledAt, countdownMs, ties, provenance, reason }.
 */
function drawLifecycle(s, phaseId = "quartas", now = Date.now()) {
  const phase = (s && s.phases && s.phases[phaseId]) || null;
  const od = phase && phase.officialDraw;
  const tieCount = phase && phase.ties ? Object.keys(phase.ties).length : 0;
  const scheduledMs = od && od.scheduledAt ? new Date(od.scheduledAt).getTime() : NaN;
  const hasSchedule = Number.isFinite(scheduledMs);

  // Validado + proveniência íntegra = bracket oficial e travado. Só aqui o bracket é autoritativo.
  if (officialDrawProvenanceIsValid(od)) {
    return { state: DRAW_LIFECYCLE.LOCKED, scheduledAt: od.scheduledAt, countdownMs: null,
             ties: tieCount, provenance: od, reason: "proveniência oficial validada" };
  }
  // Chegou algo (ingestedAt) mas a proveniência não fecha -> NÃO é oficial. Fica explícito em vez
  // de silenciosamente parecer "esperando sorteio".
  if (od && od.ingestedAt) {
    return { state: DRAW_LIFECYCLE.INGESTED, scheduledAt: od.scheduledAt || null, countdownMs: null,
             ties: tieCount, provenance: od,
             reason: "sorteio ingerido, proveniência incompleta ou não validada" };
  }
  if (hasSchedule && scheduledMs > now) {
    return { state: DRAW_LIFECYCLE.SCHEDULED, scheduledAt: od.scheduledAt,
             countdownMs: scheduledMs - now, ties: tieCount, provenance: od,
             reason: "sorteio oficial marcado" };
  }
  if (hasSchedule) {
    // A data passou e a CBF ainda não publicou. Estado próprio: nem "sem data", nem "oficial".
    return { state: DRAW_LIFECYCLE.AWAITING_PUBLICATION, scheduledAt: od.scheduledAt,
             countdownMs: 0, ties: tieCount, provenance: od,
             reason: "data do sorteio passou, publicação oficial ainda não registrada" };
  }
  return { state: DRAW_LIFECYCLE.WAITING, scheduledAt: null, countdownMs: null,
           ties: tieCount, provenance: od || null, reason: "nenhum sorteio oficial marcado" };
}

// ─── BATCH 4: PROGRESSÃO DETERMINÍSTICA DO BRACKET ──────────────────────────
// A Copa do Brasil tem UM sorteio a partir das quartas. NÃO existe sorteio de semifinal nem de
// final: os participantes das fases seguintes são DERIVADOS dos vencedores.
//
// Mas "derivado" não é o mesmo que "convencional". O mapeamento vencedor-de-QF -> vaga-de-SF é DADO
// OFICIAL DA COMPETIÇÃO, não convenção de implementação. A CBF ainda não publicou nem o sorteio nem
// esse mapeamento, então ele é registrado como TOPOLOGIA AUTORITATIVA quando publicado, e fica
// explicitamente NÃO RESOLVIDO até lá. Assumir qf-1×qf-2 / qf-3×qf-4 seria inventar topologia
// oficial — a mesma classe de erro que fabricar confrontos.
//
// CINCO PREOCUPAÇÕES SEPARADAS de propósito (era a exigência):
//   1. topologia      — quem enfrenta quem nas fases seguintes (dado oficial, registrado)
//   2. resolução      — de que time é a vaga AGORA (derivado, nunca copiado)
//   3. resultado      — placar/agregado/pênaltis (modelo canônico existente, intocado)
//   4. qualificação   — quem avançou (`tie.qualifiedTeamId`, modelo canônico existente)
//   5. renderização   — como mostrar vaga não resolvida (honestamente)
// Misturar 3 com 4 seria equiparar placar a classificação, o que o regulamento não faz (agregado,
// pênaltis, jogo adiado). Este módulo NUNCA calcula resultado nem toca em scoring.

const TOPOLOGY_REQUIRED_FIELDS = ["authority", "source", "ingestedAt", "validatedAt"];

// Fases cuja composição é DERIVADA (sem sorteio próprio) e a fase de onde cada uma deriva.
const DERIVED_PHASES = Object.freeze({ semifinal: "quartas", final: "semifinal" });

function topologyProvenanceIsValid(prov) {
  if (!prov || typeof prov !== "object") return false;
  for (const f of TOPOLOGY_REQUIRED_FIELDS) if (!prov[f]) return false;
  if (prov.authority !== "CBF") return false;
  for (const f of ["ingestedAt", "validatedAt"]) {
    if (Number.isNaN(new Date(prov[f]).getTime())) return false;
  }
  return true;
}

// Hash determinístico da topologia: ordena as vagas e normaliza cada lado, para que a MESMA
// topologia registrada em ordem diferente produza o mesmo hash (idempotência de re-registro).
function topologyFingerprint(slots) {
  const rows = Object.entries(slots || {})
    .map(([slotId, slot]) => `${slotId}=${[slot?.sideA?.winnerOf, slot?.sideB?.winnerOf].join("+")}`)
    .sort();
  return rows.length ? `${rows.length}:${hashString(rows.join("|"))}` : "";
}

/**
 * Valida uma topologia contra os confrontos que REALMENTE existem na fase predecessora.
 * Recusa (nunca conserta): vaga malformada, confronto predecessor desconhecido, predecessor
 * duplicado (dois lados esperando o mesmo vencedor), auto-referência/ciclo, contagem errada de vagas.
 */
function validateTopology(slots, { predecessorTieIds, expectedSlots, foreignTieIds }) {
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
    throw drawIngestError("TOPOLOGY_MALFORMED", "slots ausente ou não é objeto");
  }
  const entries = Object.entries(slots);
  if (expectedSlots != null && entries.length !== expectedSlots) {
    throw drawIngestError("TOPOLOGY_SLOT_COUNT", `esperava ${expectedSlots} vagas, veio ${entries.length}`);
  }
  const known = new Set(predecessorTieIds || []);
  // Confrontos que EXISTEM, mas em outra fase. Apontar a semifinal para um confronto da final (ou
  // vice-versa) não é "confronto desconhecido" — é dependência na fase errada, e merece código
  // próprio: o diagnóstico é diferente (topologia registrada na fase errada vs. id inventado).
  const foreign = new Set(foreignTieIds || []);
  const used = new Set();
  for (const [slotId, slot] of entries) {
    if (!slotId) throw drawIngestError("TOPOLOGY_MALFORMED", "id de vaga vazio");
    for (const side of ["sideA", "sideB"]) {
      const ref = slot && slot[side];
      const from = ref && ref.winnerOf;
      if (!from || typeof from !== "string") {
        throw drawIngestError("TOPOLOGY_MALFORMED", `${slotId}.${side} sem winnerOf`);
      }
      if (from === slotId) throw drawIngestError("TOPOLOGY_CIRCULAR", `${slotId} depende de si mesmo`);
      if (!known.has(from)) {
        throw drawIngestError(foreign.has(from) ? "TOPOLOGY_WRONG_PHASE" : "TOPOLOGY_UNKNOWN_TIE",
                              `${slotId}.${side} -> ${from}`);
      }
      if (used.has(from)) throw drawIngestError("TOPOLOGY_DUPLICATE_PREDECESSOR", from);
      used.add(from);
    }
    if (slot.sideA.winnerOf === slot.sideB.winnerOf) {
      throw drawIngestError("TOPOLOGY_DUPLICATE_PREDECESSOR", slot.sideA.winnerOf);
    }
  }
  // Normaliza: ordena as vagas por id e mantém só os campos com significado.
  const out = {};
  for (const [slotId, slot] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
    out[slotId] = { sideA: { winnerOf: slot.sideA.winnerOf }, sideB: { winnerOf: slot.sideB.winnerOf } };
  }
  return out;
}

/**
 * Decide o que fazer quando uma topologia é registrada sobre uma que já existe. Mesmo contrato do
 * `officialDrawReingestDecision()` do Batch 3, e pelo mesmo motivo: registro idêntico é no-op
 * (idempotente), registro DIFERENTE sobre topologia já validada é recusado, e só uma correção
 * explícita — com motivo E autorizador — pode substituí-la, ficando registrada na proveniência.
 * Sem isto, um segundo registro sobrescreveria em silêncio um mapeamento oficial já publicado.
 */
function topologyReregisterDecision(phase, incomingSlots, correction = null) {
  const current = phase && phase.topology;
  const locked = !!(current && topologyProvenanceIsValid(current.provenance) && current.slots);
  if (!locked) return { action: "register" };
  const currentFp = current.provenance.topologyFingerprint || topologyFingerprint(current.slots);
  if (topologyFingerprint(incomingSlots) === currentFp) return { action: "noop" };
  if (correction && correction.reason && correction.authorizedBy) return { action: "correct" };
  return { action: "reject", code: "TOPOLOGY_LOCKED_DIFFERENT" };
}

// ── 4. QUALIFICAÇÃO (modelo canônico existente, só LIDO aqui) ───────────────
// Placar NÃO é qualificação. Quem avançou é `tie.qualifiedTeamId` ("A"/"B"), que o admin grava ao
// travar o confronto — depois de agregado/pênaltis, e nunca para jogo adiado/incompleto. Este módulo
// só lê; não recalcula nem infere vencedor a partir de gols.
function tieQualifiedTeam(s, tieId) {
  for (const phase of Object.values(s?.phases || {})) {
    const tie = phase?.ties?.[tieId];
    if (!tie) continue;
    if (!tie.qualifiedTeamId) return null;                       // sem resultado autoritativo
    return tie.qualifiedTeamId === "A" ? (tie.teamA || null) : (tie.teamB || null);
  }
  return null;                                                    // confronto inexistente
}

// ── 2. RESOLUÇÃO DE PARTICIPANTE ────────────────────────────────────────────
// SEMPRE derivada do estado canônico, NUNCA de nome copiado. É isto que faz uma correção de
// resultado autorizada propagar sozinha: se `qualifiedTeamId` muda de A para B, toda vaga a jusante
// passa a resolver para B na próxima leitura, sem limpeza manual e sem identidade duplicada velha.
function resolveParticipant(s, ref) {
  const from = ref && ref.winnerOf;
  if (!from) return { resolved: false, team: null, winnerOf: null, reason: "sem referência" };
  const team = tieQualifiedTeam(s, from);
  return team
    ? { resolved: true, team, winnerOf: from, reason: null }
    : { resolved: false, team: null, winnerOf: from, reason: "predecessor sem qualificação" };
}

/**
 * Visão derivada de uma fase (semifinal/final). PURA.
 * Devolve { phaseId, topologyKnown, slots: [{ slotId, sideA, sideB, bothResolved }] }.
 * Sem topologia registrada => `topologyKnown: false` e NENHUMA vaga inventada.
 */
// Resolve uma vaga de fase derivada usando os palpites que o participante tem NA TELA agora --
// nao os salvos. E isto que faz a semifinal reagir a um palpite de quartas sem passar pelo banco.
//
// `livePicks.qualified[tieId]` e "A"|"B": o lado que o participante acha que avanca. O nome do
// clube vem do confronto REAL daquela fase, nunca de texto digitado.
//
// Sem palpite para o confronto de origem, devolve NAO RESOLVIDO -- e a tela mostra "Vencedor de
// X", que e a verdade: ainda depende de uma escolha que a pessoa nao fez.
function resolveParticipantPredicted(s, side, livePicks) {
  const tieId = side && side.winnerOf;
  if (tieId) {
    const predecessorId = DERIVED_PHASES_PREDECESSOR_OF_TIE(s, tieId);
    const tie = predecessorId && s?.phases?.[predecessorId]?.ties?.[tieId];
    const escolhido = livePicks?.qualified?.[tieId];
    if (tie && (escolhido === "A" || escolhido === "B")) {
      const nome = escolhido === "A" ? tie.teamA : tie.teamB;
      // O campo TEM de se chamar `team`: e o que `participantLabel()` le
      // (`if (part.resolved) return part.team`). Eu devolvia `teamName`, entao toda vaga
      // RESOLVIDA renderizava `undefined` -- e so as resolvidas, porque as pendentes caem no
      // ramo `winnerOf` e nunca tocam o campo. Na tela: "undefined × Vencedor de Cruzeiro × ...".
      //
      // Meu gate afirmava `r.teamName`, isto e, o MEU nome de campo, e nao o que o renderizador
      // consome. Teste que espelha a implementacao concorda com ela ate quando ela esta errada.
      if (nome) return { resolved: true, team: nome, winnerOf: tieId, fromPrediction: true };
    }
  }
  return resolveParticipant(s, side);
}

// Em que fase vive um confronto. Usado para achar o clube por tras de "vencedor de <tieId>".
function DERIVED_PHASES_PREDECESSOR_OF_TIE(s, tieId) {
  for (const [phaseId, phase] of Object.entries(s?.phases || {})) {
    if (phase?.ties && Object.prototype.hasOwnProperty.call(phase.ties, tieId)) return phaseId;
  }
  return null;
}

// ── CONFRONTOS VIRTUAIS DE PREVISAO ─────────────────────────────────────────────────────────
//
// A semifinal e a final do bolao NAO dependem de a CBF ter materializado aqueles jogos. Elas sao
// PREVISAO: nascem dos vencedores que o participante escolheu, aqui, agora, sem salvar.
//
// Exigir jogo futuro real no banco para deixar alguem palpitar a semifinal confundia duas coisas
// diferentes -- o calendario oficial e o palpite de quem joga o bolao. O primeiro governa
// resultado e pontuacao; o segundo e do participante e existe antes de qualquer jogo acontecer.
//
// A FINAL nao precisa de topologia publicada. Com duas semifinais existe UMA final, e seus dois
// lados sao os vencedores previstos delas. Isso e definicao de mata-mata, nao chaveamento
// inventado -- diferente da semifinal, onde QUAL vencedor de quartas encontra QUAL exigia o
// sorteio oficial (e por isso ela usa a topologia registrada).
//
// Devolve entradas com a MESMA forma de um confronto real, para atravessarem o mesmo
// renderizador de palpite. Vaga sem os dois lados resolvidos nao vira confronto: fica de fora e a
// tela mostra a dependencia ("Vencedor de X"), nunca um clube inventado.
function virtualDerivedTies(s, phaseId, livePicks) {
  if (phaseId === "semifinal") {
    const view = derivedPhaseView(s, phaseId);
    if (!view.topologyKnown) return { topologyKnown: false, ties: [], pendentes: [] };
    const ties = [], pendentes = [];
    for (const slot of view.slots) {
      const a = resolveParticipantPredicted(s, slot.sideA, livePicks);
      const b = resolveParticipantPredicted(s, slot.sideB, livePicks);
      if (a.resolved && b.resolved) {
        ties.push([slot.slotId, { teamA: a.team, teamB: b.team, matches: {}, __virtual: true }]);
      } else {
        pendentes.push({ slotId: slot.slotId, a, b, sideA: slot.sideA, sideB: slot.sideB });
      }
    }
    return { topologyKnown: true, ties, pendentes };
  }

  if (phaseId === "final") {
    // Os predecessores da final sao os confrontos VIRTUAIS da semifinal -- nao ties gravados.
    const semi = virtualDerivedTies(s, "semifinal", livePicks);
    if (!semi.topologyKnown) return { topologyKnown: false, ties: [], pendentes: [] };
    const slots = [...semi.ties.map(([id]) => id), ...semi.pendentes.map(p => p.slotId)].sort();
    if (slots.length !== 2) return { topologyKnown: true, ties: [], pendentes: [] };
    const lados = slots.map(id => {
      const escolhido = livePicks?.qualified?.[id];
      const tie = (semi.ties.find(([tid]) => tid === id) || [])[1];
      if (tie && (escolhido === "A" || escolhido === "B")) {
        return { resolved: true, team: escolhido === "A" ? tie.teamA : tie.teamB, winnerOf: id };
      }
      return { resolved: false, team: null, winnerOf: id };
    });
    if (lados[0].resolved && lados[1].resolved) {
      return { topologyKnown: true,
               ties: [["final-1", { teamA: lados[0].team, teamB: lados[1].team,
                                    matches: {}, __virtual: true }]],
               pendentes: [] };
    }
    return { topologyKnown: true, ties: [],
             pendentes: [{ slotId: "final-1", a: lados[0], b: lados[1],
                           sideA: { winnerOf: slots[0] }, sideB: { winnerOf: slots[1] } }] };
  }

  return { topologyKnown: false, ties: [], pendentes: [] };
}

// Rotulo de um predecessor que pode ser confronto REAL (quartas) ou VIRTUAL (semifinal).
function predecessorLabel(s, tieId, livePicks) {
  const real = tieDisplayName(s, tieId);
  if (real) return real;
  const semi = virtualDerivedTies(s, "semifinal", livePicks);
  const v = semi.ties.find(([id]) => id === tieId);
  if (v) return `${v[1].teamA} × ${v[1].teamB}`;
  const p = semi.pendentes.find(x => x.slotId === tieId);
  if (p) {
    // A semifinal ainda nao fechou: descreve a vaga pelos confrontos de quartas que a alimentam,
    // em cadeia. "Vencedor de <id>" nao diz nada a quem esta palpitando; "Vasco × Vitória /
    // Palmeiras × Santos" diz de onde aquele lado vai sair.
    const de = [p.sideA.winnerOf, p.sideB.winnerOf]
      .map(id => tieDisplayName(s, id))
      .filter(Boolean);
    if (de.length === 2) return `${de[0]} / ${de[1]}`;
  }
  return null;
}

function derivedPhaseView(s, phaseId) {
  const phase = s?.phases?.[phaseId];
  const topo = phase && phase.topology;
  const valid = !!(topo && topologyProvenanceIsValid(topo.provenance) && topo.slots);
  if (!valid) {
    return { phaseId, topologyKnown: false, slots: [],
             reason: topo ? "topologia registrada sem proveniência validada" : "topologia oficial não publicada" };
  }
  const slots = Object.entries(topo.slots).map(([slotId, slot]) => {
    const sideA = resolveParticipant(s, slot.sideA);
    const sideB = resolveParticipant(s, slot.sideB);
    return { slotId, sideA, sideB, bothResolved: sideA.resolved && sideB.resolved };
  });
  return { phaseId, topologyKnown: true, slots, reason: null };
}

// ── 5. RENDERIZAÇÃO (rótulo honesto) ────────────────────────────────────────
// Vaga não resolvida mostra a DEPENDÊNCIA, nunca um clube. "Vencedor de <confronto>" quando se sabe
// de quem depende; "A definir" quando nem isso.
// `tieLabel` é só APRESENTAÇÃO da dependência ("Santos × Grêmio" em vez de "qf-1"); a identidade
// continua vindo de `part`, nunca de texto. Ausente, cai no id do confronto — nunca em um clube.
function participantLabel(part, tieLabel) {
  if (part && part.resolved) return part.team;
  if (part && part.winnerOf) return `${t("winnerOfPrefix")} ${tieLabel || part.winnerOf}`;
  return t("toBeDefined");
}

// Nome legível de um confronto predecessor, lido do estado canônico. Nunca inventa clube: se o
// confronto ainda não tem os dois lados, devolve null e o rótulo cai de volta no id.
function tieDisplayName(s, tieId) {
  for (const phase of Object.values(s?.phases || {})) {
    const tie = phase?.ties?.[tieId];
    if (tie) return tie.teamA && tie.teamB ? `${tie.teamA} × ${tie.teamB}` : null;
  }
  return null;
}

// ─── BATCH 3: INGESTÃO DO SORTEIO OFICIAL DA CBF ────────────────────────────
// CARACTERIZAÇÃO DA FONTE (feita em 2026-08-07, e é o motivo do desenho abaixo):
//   - `cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/2026` responde 200, mas o HTML é uma
//     casca: 82 KB SEM nenhum dado estruturado (zero JSON-LD, zero __NEXT_DATA__), sem nome de time
//     e sem a palavra "quartas". O conteúdo é renderizado no cliente.
//   - A CBF tem um CMS Strapi em `cms.cbf.com.br/api/` que responde de verdade (menus, logo), mas
//     NENHUMA coleção de competição/partida/chave está exposta — `campeonatos`, `partidas`, `jogos`,
//     `tabelas`, `confrontos`, `chaves` todas devolvem 404.
//   - E, hoje, o sorteio das quartas ainda não aconteceu, então não existe nem um exemplar real de
//     resposta para escrever parser contra.
//
// Escrever um scraper contra uma superfície que não dá para observar seria fragilidade especulativa
// só para poder chamar o batch de "automatizado". A instrução é o contrário: autoridade oficial +
// auditabilidade + ingestão segura. Então o caminho é o 3 da ordem de preferência: INGESTÃO
// CONTROLADA a partir da fonte oficial, com validação estrita e proveniência.
//
// SEAM DELIBERADO: `normalizeCbfDraw()` é PURO e não sabe de onde os pares vieram. No dia em que uma
// superfície estruturada estável da CBF for identificada, o fetcher automático entrega os pares para
// ESTA MESMA função e todo o contrato de validação/normalização/hash continua valendo — sem tocar em
// nada abaixo. É por isso que a validação não vive dentro de um parser.

// Os 8 clubes classificados vêm do RESULTADO das oitavas, nunca de uma lista digitada. Se as oitavas
// não estiverem completas, não há classificados — e sem classificados não há sorteio a validar.
function qualifiedTeamsForQuartas(s) {
  const ties = Object.values(s?.phases?.oitavas?.ties || {});
  const out = [];
  for (const t of ties) {
    if (!t || !t.qualifiedTeamId || !t.teamA || !t.teamB) continue;
    out.push(t.qualifiedTeamId === "A" ? t.teamA : t.teamB);
  }
  return out;
}

// Erro de ingestão com código estável, para o teste (e o admin) distinguirem o MOTIVO da recusa.
function drawIngestError(code, detail) {
  const err = new Error(detail ? `${code}: ${detail}` : code);
  err.code = code;
  return err;
}

/**
 * Normaliza um sorteio oficial em UMA forma canônica. PURA e determinística.
 *
 * Aceita os pares em formatos diferentes de propósito (array de arrays, array de objetos, mapa) —
 * a MESMA chave de bracket sai de qualquer um deles, porque a identidade do bracket é o conjunto de
 * confrontos, não a formatação da fonte.
 *
 * Recusa (nunca "conserta") : quantidade errada de confrontos, clube desconhecido, clube repetido,
 * confronto incompleto, autoridade que não seja a CBF. Falha = torneio continua esperando.
 */
function normalizeCbfDraw({ pairs, qualified, expectedTies = 4 }) {
  if (!Array.isArray(qualified) || qualified.length !== expectedTies * 2) {
    throw drawIngestError("QUALIFIED_SET_INVALID",
      `esperava ${expectedTies * 2} classificados, veio ${Array.isArray(qualified) ? qualified.length : typeof qualified}`);
  }
  const known = new Set(qualified);
  if (known.size !== qualified.length) throw drawIngestError("QUALIFIED_SET_DUPLICATE");

  // Aceita as três formas de entrada e reduz a uma lista de [a, b].
  let list;
  if (Array.isArray(pairs)) {
    list = pairs.map(p => Array.isArray(p) ? p : [p?.teamA, p?.teamB]);
  } else if (pairs && typeof pairs === "object") {
    list = Object.values(pairs).map(p => [p?.teamA, p?.teamB]);
  } else {
    throw drawIngestError("SOURCE_MALFORMED", "pares ausentes ou em formato irreconhecível");
  }

  if (list.length !== expectedTies) {
    throw drawIngestError(list.length < expectedTies ? "DRAW_PARTIAL" : "DRAW_EXTRA_TIES",
      `esperava ${expectedTies} confrontos, veio ${list.length}`);
  }

  const seen = new Set();
  const normalized = list.map(([a, b]) => {
    const teamA = typeof a === "string" ? a.trim() : "";
    const teamB = typeof b === "string" ? b.trim() : "";
    if (!teamA || !teamB) throw drawIngestError("TIE_INCOMPLETE");
    if (teamA === teamB) throw drawIngestError("TIE_SELF_PAIR", teamA);
    for (const team of [teamA, teamB]) {
      if (!known.has(team)) throw drawIngestError("TEAM_UNKNOWN", team);
      if (seen.has(team)) throw drawIngestError("TEAM_DUPLICATE", team);
      seen.add(team);
    }
    return { teamA, teamB };
  });
  if (seen.size !== qualified.length) {
    throw drawIngestError("DRAW_INCOMPLETE_COVERAGE",
      `${seen.size} clubes usados de ${qualified.length} classificados`);
  }

  // Ordenação canônica: ordena os confrontos por par normalizado para que a MESMA lista chegando em
  // ordem diferente produza os MESMOS ids e o MESMO bracketHash. Sem isto, "mesmo bracket, fonte
  // formatada diferente" daria hash diferente e a idempotência do Batch 3 seria falsa.
  const ordered = normalized
    .map(t => ({ ...t, _key: [t.teamA, t.teamB].slice().sort().join("~") }))
    .sort((x, y) => x._key.localeCompare(y._key));

  const ties = {};
  ordered.forEach((t, i) => {
    // Ids deterministicos e derivados só do bracket — nunca da ordem da fonte.
    ties[`qf-${i + 1}`] = { teamA: t.teamA, teamB: t.teamB };
  });
  return ties;
}

// Uma re-ingestão é "idêntica" quando o CONJUNTO de confrontos bate — comparado por bracketHash, não
// por ordem nem por ids. Um bracket travado que recebe o mesmo sorteio de novo é no-op; se veio
// diferente, é recusado, e só uma correção explícita e autorizada pode substituir.
function officialDrawReingestDecision(phase, incomingTies, correction = null) {
  const locked = !!(phase && officialDrawProvenanceIsValid(phase.officialDraw));
  if (!locked) return { action: "ingest" };
  const currentHash = phase.officialDraw.bracketHash || bracketFingerprint(phase.ties);
  if (bracketFingerprint(incomingTies) === currentHash) return { action: "noop" };
  if (correction && correction.reason && correction.authorizedBy) {
    return { action: "correct" };
  }
  return { action: "reject", code: "BRACKET_LOCKED_DIFFERENT" };
}

// O bracket é autoritativo só no estado LOCKED. `phaseDrawIsOfficial()` (acima) continua sendo o
// gate do SANITIZADOR e aceita também `cutoffAt` — de propósito, para não apagar o cadastro manual
// que o admin já fazia antes deste modelo existir. As duas perguntas são diferentes:
//   phaseDrawIsOfficial  -> "posso ter confrontos aqui?"      (permissivo, protege trabalho do admin)
//   drawBracketIsLocked  -> "este bracket é oficial e provado?" (estrito, exige proveniência)
function drawBracketIsLocked(s, phaseId = "quartas", now = Date.now()) {
  return drawLifecycle(s, phaseId, now).state === DRAW_LIFECYCLE.LOCKED;
}

// Remove ties fantasma das fases com sorteio pendente. Muta `s` e devolve true se mudou algo.
// Toca EXCLUSIVAMENTE `phases[<fase com gate>].ties`: entradas, `paid`, `deletedIds`, auditLog,
// espnSync e as outras fases (inclusive oitavas) ficam intactos — garantido por teste.
// Não apaga palpite de participante: palpites moram em `entry.picks`, não em `phase.ties`.
function enforceDrawLifecycle(s) {
  if (!s || !s.phases) return false;
  let changed = false;
  for (const phaseId of DRAW_GATED_PHASES) {
    const phase = s.phases[phaseId];
    if (!phase || !phase.ties) continue;
    if (phaseDrawIsOfficial(phase)) continue;
    if (Object.keys(phase.ties).length === 0) continue;
    phase.ties = {};
    changed = true;
  }
  return changed;
}

function state() {
  try {
    const r = localStorage.getItem(C.storeKey);
    const s = r ? Object.assign(emptyState(), JSON.parse(r)) : emptyState();
    s.phases = s.phases && typeof s.phases === "object" ? s.phases : {};
    DATA.phases.forEach(p => {
      s.phases[p.id] = s.phases[p.id] && typeof s.phases[p.id] === "object" ? s.phases[p.id] : emptyPhaseState();
      s.phases[p.id].ties = s.phases[p.id].ties || {};
    });
    s.espnSync = s.espnSync && typeof s.espnSync === "object" ? s.espnSync : { activePhaseId: null };
    // CHOKEPOINT 1/4 (leitura + render): sanea o que sai do localStorage, então um cache
    // contaminado deixa de renderizar confronto fabricado já no primeiro reload — sem depender de
    // um save acontecer antes. Só em memória; a limpeza é persistida no primeiro saveState().
    enforceDrawLifecycle(s);
    return s;
  } catch { return emptyState(); }
}
// `opts.mutation` (Fase 2.1 §2): quando o CHAMADOR sabe exatamente qual mudança administrativa
// está fazendo (marcar pagamento, travar/destravar confronto, trocar fase ativa da ESPN, etc.),
// passa um descritor `{type, ...payload}` aqui -- ver applyAdminMutation() para os tipos
// suportados. Sem `opts.mutation`, o caminho antigo (mergeStates com preferRemoteResults) é
// usado -- correto para o fluxo de PARTICIPANTE (saveEntry), onde "remoto vence" é a proteção
// certa contra cache velho, não uma mutação dirigida.
function saveState(s, opts = {}) {
  // CHOKEPOINT 2/4 (gravação local): impede que um tie fantasma seja regravado no localStorage —
  // e, como o payload remoto deriva deste objeto, é a primeira barreira contra re-contaminar a
  // produção a partir de um navegador com cache sujo.
  enforceDrawLifecycle(s);
  s.meta = s.meta || {};
  s.meta.updatedAt = new Date().toISOString();
  s.meta.version = C.siteVersion;
  localStorage.setItem(C.storeKey, JSON.stringify(s));
  // PLATFORM-CDB-BROWSER-WRITER: `saveState()` NAO grava mais no remoto.
  //
  // O que estava aqui chamava `saveRemoteState()`, que gravava o DOCUMENTO INTEIRO com a chave
  // anon publica. Estava morto por TRES motivos independentes, todos medidos:
  //
  //   1. o interlock `__sanitized` levantava antes de gravar, e em producao ele SEMPRE dispara
  //      porque `readTable` ("bolao_state_public") difere de `table` ("bolao_state");
  //   2. desde o Q38 o `anon` nao tem INSERT nem UPDATE em `public.bolao_state`;
  //   3. a tabela ficou com ZERO policies.
  //
  // Codigo morto que reescreve um bolao inteiro nao e codigo seguro: bastava uma policy
  // restaurada por engano para voltar a alcancar. O palpite do participante continua indo por
  // `cdb_save_my_picks`; a mutacao de operador, pelo runtime confiavel (operator_cli.py).
  renderAll();
}

// AbortController timeout wrapper — item 50 do CONSISTENCY_MATRIX.md (2026-07-15): as chamadas
// ao Supabase abaixo eram feitas com fetch() cru, sem timeout, diferente de
// fetchEspnCandidates() (que já usava AbortController) — uma resposta pendurada travaria
// load/save indefinidamente. Mesmo padrão/nome de bolao/br2026/js/app.js.
async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 10000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// ─── ACESSO SEGURO DO PARTICIPANTE ──────────────────────────────────────────
//
// O caminho antigo era: e-mail digitado + `receiptCode`, casados NO NAVEGADOR contra o estado
// inteiro. Duas coisas erradas de uma vez -- o navegador precisava do e-mail de todos os
// participantes para achar um, e o `receiptCode` e derivado de `entryName + createdAt`, ambos
// publicos. O "segredo" podia ser recalculado por qualquer pessoa.
//
// Agora o participante chega por um link com token aleatorio de 32 bytes. O servidor resolve o
// token e devolve SO a propria entrada; o token nunca identifica outra pessoa porque a RPC de
// escrita nao aceita id de entrada nenhum.
//
// O token vive no FRAGMENTO (#t=...), que o navegador nao envia no cabecalho Referer -- entao
// ele nao vaza para terceiros se a pagina carregar qualquer recurso externo.
/**
 * Motivo legível da recusa, lido do corpo de erro do PostgREST (`{message, code, details}`).
 * `raise exception 'ACESSO_NEGADO'` chega em `message`. Nada disso é dado de participante: são
 * constantes do próprio contrato da RPC. Corpo ausente ou não-JSON degrada para string vazia --
 * o status sozinho ainda é melhor que nada, e nunca estoura dentro do tratamento de erro.
 */
async function motivoDaRecusa(r) {
  try {
    const corpo = await r.json();
    const motivo = [corpo?.message, corpo?.code, corpo?.details].filter(Boolean).join(" | ");
    return motivo ? ` — ${motivo}` : "";
  } catch { return ""; }
}

/**
 * Publica um CODIGO de diagnostico para o "Reportar problema" (Issue #321), a partir da recusa do
 * servidor no save (a classe de evento da Issue #258).
 *
 * O que sai daqui e SO um codigo de uma lista fechada. `err.message` NUNCA entra num reporte: ele
 * carrega `RPC cdb_save_my_picks respondeu 400 ...` com o motivo do servidor, e motivo de servidor
 * neste app ja foi -- por desenho -- coisa que nao se mostra ao participante, muito menos se manda
 * para uma fila de triagem.
 *
 * Nao altera o save, nao altera a mensagem na tela, nao altera o console. E estritamente aditivo:
 * se o coletor nao estiver carregado, isto nao faz nada.
 */
function publicaDiagnosticoDeSave(err) {
  const ctx = window.BOLAO_REPORT_CONTEXT;
  if (!ctx || typeof ctx.publicarDiagnostico !== "function") return;
  const m = String((err && err.message) || "");
  let codigo = "UNKNOWN_SAFE_ERROR";
  if (/ACESSO_NEGADO/.test(m)) codigo = "SAVE_ACCESS_DENIED";
  else if (/FASE_FECHADA/.test(m)) codigo = "SAVE_PHASE_CLOSED";
  else if (/CUTOFF_(PASSADO|ILEGIVEL)/.test(m)) codigo = "SAVE_CUTOFF";
  else if (/NetworkError|Failed to fetch|timeout/i.test(m)) codigo = "SAVE_NETWORK_FAILURE";
  ctx.publicarDiagnostico(codigo);
}

async function cdbRpc(fn, args) {
  const { url, anonKey } = C.database;
  const r = await fetchJson(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  // ── O MOTIVO DO SERVIDOR NÃO PODE SER JOGADO FORA (Issue #258) ────────────────────────────
  //
  // Antes, a mensagem era só `RPC ... respondeu 400`: o corpo da resposta era descartado e com ele
  // o ÚNICO dado que explica a recusa. `cdb_save_my_picks` recusa por motivos bem diferentes --
  // ACESSO_NEGADO, FASE_FECHADA, CUTOFF_PASSADO, CUTOFF_ILEGIVEL, payload inválido -- e todos
  // chegavam na tela como o mesmo toast genérico e no console como o mesmo "respondeu 400".
  //
  // Um usuário reportou exatamente esse erro em 2026-08-20. A investigação conseguiu EXCLUIR
  // cutoff (a fase ativa fecha só em 2026-08-25T23:00Z), fase fechada e deploy velho (v3.129 no ar
  // == repositório), mas não a causa real: o motivo já tinha sido descartado aqui.
  //
  // A MENSAGEM MOSTRADA AO PARTICIPANTE NÃO MUDA -- quem lê isto é o `console.error` de quem
  // chama. Expor o motivo na tela seria um oráculo de enumeração, e é por isso que a própria RPC
  // devolve falha genérica quando o token não resolve.
  //
  // A FORMA da linha abaixo é deliberada: `audit_remote_write_visibility.mjs` exige literalmente
  // `if (!r.ok) throw new Error(\`RPC` para provar que 4xx/5xx vira erro propagável. O motivo entra
  // pela interpolação, sem quebrar esse invariante -- adaptar o gate para aceitar outra forma
  // seria afrouxar a asserção em vez de satisfazê-la.
  if (!r.ok) throw new Error(`RPC ${fn} respondeu ${r.status}${await motivoDaRecusa(r)}`);
  return r.json();
}

// ── identidade da entrada: visivel para o participante, editavel por ninguem ──────────────────
//
// Pedido do Alan Rech: ao abrir o link personalizado, o participante precisa VER de imediato qual
// entrada esta editando. O campo ja era preenchido a partir da entrada autenticada, mas continuava
// editavel -- e um campo editavel convida a editar, o que aqui nao significa nada: o salvamento do
// participante vai por `cdb_save_my_picks(p_token, p_client_ref, p_picks)`, uma RPC que NAO ACEITA
// nome nenhum. Renomear pelo formulario era estruturalmente impossivel e mesmo assim parecia
// possivel. Isto alinha o que a tela promete com o que o servidor faz.
//
// `readonly`, nao `disabled`: `disabled` tira o campo da ordem de foco e do envio do formulario, e
// deixa a cor de texto apagada demais para servir de CONFIRMACAO -- que e a unica funcao dele aqui.
// `input[readonly]` ja tem estilo proprio no design system (bolao/shared/css/forms.css).
function preencheNomeDaEntradaConfiavel(entrada) {
  const el = $("entryName");
  if (!el) return;
  const nome = (entrada && entrada.entryName) || "";
  el.value = nome;
  // Sem nome resolvido nao se inventa nada e nao se tranca: falha fechada pelo caminho que ja
  // existe (entrada nao encontrada volta antes daqui).
  if (!nome) return;
  el.readOnly = true;
  el.setAttribute("aria-readonly", "true");
  // Placeholder num campo so-de-leitura ja preenchido nunca aparece, e se o valor sumisse ele
  // faria o campo parecer um formulario esperando digitacao — o oposto de "esta e a sua entrada".
  el.removeAttribute("placeholder");
}

/** Devolve o campo ao estado editavel (criacao de entrada nova). */
function destrancaNomeDaEntrada() {
  const el = $("entryName");
  if (!el) return;
  el.readOnly = false;
  el.removeAttribute("aria-readonly");
}

async function autoLoadFromSecureLink() {
  const token = participantTokenFromUrl();
  if (!token) return false;
  try {
    const entrada = await loadOwnEntryByToken(token);
    if (!entrada) { showToast(t("findEntryNotFound"), "error"); return false; }
    _editingEntry = entrada;
    _picksEmMemoria = null;   // o overlay pertence a UMA edição
    renderPickForm();
    preencheNomeDaEntradaConfiavel(entrada);
    renderNewEntryCard();
    showToast(t("findEntryLoaded"), "success");
    return true;
  } catch (err) {
    console.warn("[CDB2026] link seguro falhou", err);
    return false;
  }
}

function participantTokenFromUrl() {
  const frag = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  return (frag.get("t") || "").trim();
}

let _accessToken = null;

async function loadOwnEntryByToken(token) {
  const entrada = await cdbRpc("cdb_my_entry", { p_token: token });
  // Falha GENERICA: token invalido, revogado e entrada removida devolvem todos `null`. A UI nao
  // pode distinguir os casos -- distinguir seria um oraculo de enumeracao.
  if (!entrada || !entrada.id) return null;
  _accessToken = token;
  return entrada;
}

// ─── Supabase ───────────────────────────────────────────────────────────────
async function loadRemoteState() {
  if (!C.database.enabled) return;
  try {
    const { url, anonKey, stateId } = C.database;
    // `readTable` e a projecao sanitizada; `table` (bruta) e so para escrita. Sem esta
    // separacao, o navegador de qualquer visitante recebia o e-mail, o pagador e o metodo de
    // pagamento dos 12 participantes -- para desenhar uma lista e achar UMA entrada.
    const readTable = C.database.readTable || C.database.table;
    const sanitizado = readTable !== C.database.table;
    const r = await fetchJson(`${url}/rest/v1/${readTable}?id=eq.${stateId}&select=state`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    });
    if (!r.ok) return;
    const data = await r.json();
    if (!data?.[0]?.state) return;
    // `remoteAuthoritative: true` só aqui: este é o único ponto onde um estado remoto foi
    // efetivamente lido do Supabase. Ver mergeStates() para o que isso torna autoritativo.
    const merged = mergeStates(state(), data[0].state, { preferRemoteResults: true, remoteAuthoritative: true });
    // MARCA DE SANITIZACAO. O estado que veio da projecao NAO tem participantEmail, payerName
    // nem paymentMethod -- eles foram removidos de proposito. Gravar este documento de volta em
    // `bolao_state` APAGARIA esses campos para os 12 participantes, de forma permanente e
    // silenciosa. A marca existe para que o caminho de gravacao possa recusar.
    if (sanitizado) merged.__sanitized = true; else delete merged.__sanitized;
    localStorage.setItem(C.storeKey, JSON.stringify(merged));
  } catch (err) { console.warn("[CDB2026] Supabase load failed", err); }
}

// Same pattern as the Copa (bolao/js/app.js reloadRemoteIfVisible/debouncedReload) — a single,
// debounced entry point for "resync from Supabase now" so visibilitychange/focus/pageshow firing
// close together (which they do) can't trigger overlapping fetches.
async function reloadRemoteIfVisible() {
  if (document.hidden || !C.database.enabled || _editingEntry) return;
  await loadRemoteState();
  renderAll();
}
let _reloadTimer = null;
function debouncedReload() {
  clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(() => reloadRemoteIfVisible().catch(err => console.warn("[CDB2026] Reload failed", err)), 60);
}
// Lê o estado remoto atual e mescla ANTES de gravar (read-merge-write). Sem isto, cada gravação
// substituía a coluna `state` inteira pelo snapshot local de quem gravou -- `Prefer:
// resolution=merge-duplicates` resolve conflito de LINHA no upsert, não mescla o JSON. Achado na
// auditoria de 2026-08 (AUDIT-03, perda de dados confirmada): admin marca X como pago; um
// participante que carregou a página antes disso salva uma entrada nova; o POST dele reescrevia a
// linha toda com o cache velho e X voltava a "não pago". Mesmo mecanismo apagava entradas novas
// simultâneas de dois participantes (lost update) -- justamente no pico de envios perto do prazo.
// `preferRemoteResults: true` mantém a regra já usada no load: resultado/tie oficial do admin
// (remoto) vence o cache local; entradas continuam união por mais recente e `paid` é any-true-wins.
//
// Fase 2.1 §2: `opts.mutation` desvia deste merge campo-a-campo para applyMutationOverRemote() —
// ver esse comentário para o porquê. Sem `opts.mutation`, comportamento idêntico a antes.
// ─── TEST ISOLATION (P0, 2026-08-07) ────────────────────────────────────────
// O incidente de produção do CDB2026 foi causado por uma fixture de harness que carregou esta
// aplicação com a configuração REAL do Supabase (url/anonKey/stateId estão hardcoded em
// config.js) e gravou entradas sintéticas na tabela de produção. Nenhuma flag de teste impedia
// isso, porque não existia nenhuma.
//
// Este guard é a fronteira permanente e FAIL CLOSED: a gravação remota é NEGADA por padrão
// sempre que o contexto não é produção. Ele fica dentro de saveRemoteState() de propósito —
// o único ponto por onde toda escrita remota passa — e não em cada chamador, porque um guard
// que depende do teste lembrar de chamá-lo não é uma fronteira, é uma convenção.
//
// Contexto não-produção = origem não é o host de produção (localhost, 127.0.0.1, file://,
// qualquer preview) OU o navegador está sob automação (`navigator.webdriver`, que Playwright/
// Puppeteer/Selenium setam). Participantes reais nunca satisfazem nenhum dos dois.
//
// Escape hatch DELIBERADO e não-acidental, para quando o Eduardo precisa mesmo administrar a
// produção a partir de um preview local — tem de ser digitado no console, nunca é o default, e
// não sobrevive ao fechamento da aba:
//
//     sessionStorage.setItem("cdb2026_allow_production_writes", "I UNDERSTAND");
//
// Deliberadamente NÃO é uma fronteira de banco. Enforcement real (RLS por origem/role) fica
// para a modernização do banco. Isto fecha o vetor que causou o incidente, não todos.
// A origem CANÔNICA de produção é o domínio customizado do arquivo CNAME na raiz do repo
// (www.ferrarilabs.com) — NÃO ferrarilabs.github.io, que responde 301 para ele. Errar isto
// bloqueia a produção inteira em silêncio (foi o que aconteceu na primeira versão deste guard,
// pega na verificação ao vivo). O apex e o github.io estão na lista porque são hosts nossos: hoje
// os dois redirecionam, então nenhuma página executa neles, mas se o CNAME for removido a
// produção passa a servir do github.io e o guard não pode virar um bloqueio total.
// audit_test_isolation.mjs lê o CNAME e falha se ele não estiver nesta lista — a lista não pode
// mais divergir do domínio real sem a suíte acusar.
const PRODUCTION_ORIGINS = [
  "https://www.ferrarilabs.com",
  "https://ferrarilabs.com",
  "https://ferrarilabs.github.io",
];
const ALLOW_PROD_WRITES_KEY = "cdb2026_allow_production_writes";
function productionWriteBlockReason() {
  if (typeof location !== "undefined" && !PRODUCTION_ORIGINS.includes(location.origin)) {
    return `origem não-produção (${location.origin})`;
  }
  if (typeof navigator !== "undefined" && navigator.webdriver) {
    return "navegador sob automação (navigator.webdriver)";
  }
  return null;
}
function productionWritesAllowed() {
  const reason = productionWriteBlockReason();
  if (!reason) return { allowed: true };
  let override = null;
  // sessionStorage pode lançar (modo restrito//file://) — tratar como ausente é o lado seguro.
  try { override = sessionStorage.getItem(ALLOW_PROD_WRITES_KEY); } catch { override = null; }
  if (override === "I UNDERSTAND") return { allowed: true, overridden: true, reason };
  return { allowed: false, reason };
}
// ─── AUD-01 (auditoria 2026-08-09): ENVIO DE E-MAIL TAMBÉM FALHA FECHADO ────────────────────
//
// A escrita no Supabase já era protegida por `productionWritesAllowed()` — fail-closed em origem
// não-produção E quando `navigator.webdriver` é verdadeiro. O envio de e-mail não tinha nada.
//
// A assimetria é o problema: um harness automatizado abrindo a página de produção e submetendo
// uma entrada tinha o ESTADO bloqueado e o E-MAIL enviado. Ou seja, a proteção existia para o
// efeito reversível (gravação, que dá para desfazer) e faltava para o irreversível (mensagem que
// já chegou na caixa de entrada de uma pessoa real). Neste repositório isso não é hipótese: um
// envio errado já saiu para 15 pessoas.
//
// Mesmas condições do guard de gravação, nunca mais permissivas — delega à MESMA função, então
// não há como as duas divergirem depois.
function emailSendAllowed() {
  var gate = productionWritesAllowed();
  return gate.allowed
    ? { allowed: true, overridden: !!gate.overridden }
    : { allowed: false, reason: gate.reason };
}


/**
 * FAIL-CLOSED. O cdb2026 nao grava mais o documento a partir do navegador.
 *
 * Isto era um POST do documento INTEIRO com `Prefer: resolution=merge-duplicates`. O stub existe
 * em vez de a funcao sumir para que qualquer chamador esquecido FALHE ALTO, aqui, com esta
 * mensagem -- e nao com um ReferenceError sem explicacao no meio de uma acao de operador.
 */
async function saveRemoteState() {
  throw new Error(
    "CDB2026: gravacao remota de documento inteiro pelo navegador foi removida " +
    "(PLATFORM-CDB-BROWSER-WRITER). Palpite: cdb_save_my_picks. Operador: operator_cli.py");
}
// Instante de um registro de auditoria. Duas formas legítimas convivem no documento:
// `{ts, action, admin, detail}` (appendAudit no navegador e `public._bolao_audit()`) e
// `{type, actor, at, clientRef, payload, source}` (`cdb_apply_operator_mutation()`). É o MESMO
// instante ISO do evento sob nomes diferentes — nenhum registro traz os dois (medido em produção
// 2026-08-13: cdb2026 tem 42 registros, 28 da primeira forma e 14 da segunda; br2026 e copa2026,
// 7 e 19, só da primeira). Ler apenas `.ts` fazia `undefined` virar UMA chave do Map, colapsando
// os 14 do servidor em 1, e estourava o sort em `.localeCompare`. Retorna "" quando não há
// instante: um registro sem data nunca é o mais novo, e não se inventa um para ele.
const auditStamp = (entry) => (entry && (entry.ts || entry.at)) || "";
// Chave de deduplicação — a união quer "um registro por EVENTO", e o instante sozinho não entrega
// isso na segunda forma: o servidor grava `at` em segundos inteiros e, em produção, dez dos
// catorze registros dividem apenas DOIS instantes (um `set-cutoff` e um `set-schedule-provenance`
// estavam sendo descartados junto com seis `backfill-kickoff`). `(instante, clientRef)` é único
// nos 14/14. A primeira forma não tem `clientRef`, então para ela a chave continua sendo
// exatamente o instante — o comportamento de hoje, inalterado.
const auditKey = (entry) => {
  const k = `${auditStamp(entry)}|${entry.clientRef || ""}`;
  // Sem instante e sem clientRef não há identidade nenhuma: a própria entrada vira a chave, para
  // que dois registros assim não colapsem num só — que era justamente o efeito de `undefined`.
  return k === "|" ? entry : k;
};

// Peças de merge compartilhadas entre mergeStates() (participante/ESPN, snapshot inteiro) e
// applyMutationOverRemote() (mutação administrativa dirigida, Fase 2.1 §2) — entries, tombstones
// e audit log seguem a MESMA regra de reconciliação nos dois caminhos; só phases/paid/espnSync
// divergem (mergeStates funde os dois lados campo a campo; a mutação começa 100% do remoto e
// aplica só a mudança pedida por cima, ver applyAdminMutation).
function mergeEntriesTombstonesAuditLog(local, remote, opts = {}) {
  const deleted = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  // REMOTO AUTORITATIVO NO LOAD + ROSTER CONGELADO (2026-08-07).
  // Com `entryRosterFrozen` nenhuma entrada nova é legítima (ver isEntryCreationAllowed): uma
  // entrada que existe só no navegador é resíduo, não trabalho offline por sincronizar. Era assim
  // que "Participante A"/"Participante D" e um pote de $65 (13 x $5, quando a produção tem 12
  // entradas) continuavam aparecendo num navegador mesmo com a produção comprovadamente limpa.
  // Deliberadamente NÃO vale quando o roster está aberto: aí uma entrada local ainda não
  // sincronizada é legítima e não pode ser descartada. E só no LOAD, onde o remoto foi lido de
  // fato.
  const remoteAuthoritativeEntries = !!opts.remoteAuthoritative && !!C.entryRosterFrozen;
  const remoteIds = new Set((remote.entries || []).map(e => e.id));
  // Achado 2026-07-16 (mesmo achado do BR2026, propagado aqui por ter a mesma estrutura de
  // merge): "local sempre vence" escondia edição de admin pra sempre em qualquer navegador que
  // já tivesse a entrada em cache. Preferir sempre o registro mais RECENTE por entrada
  // (updatedAt/createdAt), mesmo padrão que a Copa já usa (bolao/js/app.js mergeStates()).
  const byId = {};
  for (const e of (local.entries || [])) {
    if (deleted.has(e.id)) continue;
    if (remoteAuthoritativeEntries && !remoteIds.has(e.id)) continue; // resíduo local: descarta
    byId[e.id] = e;
  }
  for (const e of (remote.entries || [])) {
    if (deleted.has(e.id)) continue;
    const existing = byId[e.id];
    if (!existing) { byId[e.id] = e; continue; }
    const remoteTs = e.updatedAt || e.createdAt || "";
    const localTs  = existing.updatedAt || existing.createdAt || "";
    if (remoteTs > localTs) byId[e.id] = e;
  }
  // Merge audit logs: união por instante (único por evento), mais novo primeiro, teto de 200 —
  // mesmo padrão da Copa (copa2026/js/app.js mergeStates()).
  const auditMap = new Map();
  for (const entry of [...(remote.auditLog || []), ...(local.auditLog || [])]) {
    if (!entry) continue;
    auditMap.set(auditKey(entry), entry);
  }
  const mergedAuditLog = [...auditMap.values()]
    .sort((a, b) => auditStamp(b).localeCompare(auditStamp(a))).slice(0, 200);
  return { entries: Object.values(byId), deletedIds: [...deleted], auditLog: mergedAuditLog };
}

// Merge de fases: para cada fase, cutoffAt e ties são mesclados independentemente — união de
// ties por id (nunca perde um confronto cadastrado em qualquer lado), remote-wins em cutoffAt e
// no conteúdo de cada tie já existente por padrão (mesma regra dos resultados oficiais na
// Copa/BR2026 — o admin/Supabase é fonte de verdade para resultado real).
//
// USADO POR: sincronização de participante (saveEntry -> saveState sem `opts.mutation`) e carga
// inicial (loadRemoteState). NÃO é mais usado por mutação administrativa explícita — ver
// applyMutationOverRemote()/applyAdminMutation() e a nota da Fase 2.1 abaixo: rodar este merge
// para uma ação de admin é exatamente o bug que causava `paid: true->false` e outras mutações
// intencionais não persistirem (o merge campo-a-campo "ganha" com regras pensadas para proteger
// resultado oficial contra cache velho de PARTICIPANTE, não para representar uma decisão explícita
// do admin sobre um registro específico).
function mergeStates(local, remote, opts = {}) {
  const { entries, deletedIds, auditLog } = mergeEntriesTombstonesAuditLog(local, remote, opts);
  // any-true-wins por chave (união das chaves dos dois lados), NUNCA spread — um spread
  // (`{...remote.paid, ...local.paid}`) faz "local sempre vence", então um `false` local velho
  // sobrescrevia um `true` remoto mais novo do admin. Achado na auditoria de 2026-08 (AUDIT-02):
  // `docs/bolao/PROJECT_MEMORY.md` já DESCREVIA este merge como any-true-wins e a Copa
  // (`bolao/copa2026/js/app.js` mergedPaid) já implementava assim de verdade — só CDB2026/BR2026
  // tinham o spread. LIMITAÇÃO CONHECIDA (Fase 2.1): any-true-wins protege contra reversão
  // acidental de cache velho, mas por isso mesmo NUNCA permite `true -> false` por este caminho
  // — pagamento desmarcado pelo admin precisa passar por applyAdminMutation() (set-payment), que
  // aplica o valor explicitamente, não por aqui.
  const paid = {};
  for (const k of new Set([...Object.keys(remote.paid || {}), ...Object.keys(local.paid || {})])) {
    paid[k] = !!(local.paid?.[k] || remote.paid?.[k]);
  }
  // Chave de `paid` de entrada que não existe mais é lixo que aparece no total do pote. Removida
  // DEPOIS do merge de entradas, e só no load autoritativo — nunca perde pagamento de entrada viva.
  if (opts.remoteAuthoritative) {
    const liveIds = new Set(entries.map(e => e.id));
    for (const k of Object.keys(paid)) if (!liveIds.has(k)) delete paid[k];
  }
  const phases = {};
  DATA.phases.forEach(p => {
    const localP  = local.phases?.[p.id]  || emptyPhaseState();
    const remoteP = remote.phases?.[p.id] || emptyPhaseState();
    // REMOTO AUTORITATIVO NO LOAD (2026-08-07, incidente reportado pelo Eduardo).
    //
    // O problema: `ties` era UNIÃO nas duas direções e não existe tombstone de tie. Um confronto
    // que só existia LOCAL sobrevivia para sempre — o reparo do banco nunca alcançava o navegador.
    // O invariante de sorteio (enforceDrawLifecycle) fechou o caso das QUARTAS, mas um fantasma
    // numa fase JÁ oficial (ex.: "Bahia × Santos" nas Oitavas, que o Eduardo viu depois de a
    // produção estar comprovadamente limpa) não era alcançado por ele — e o caminho de save
    // reenviaria esse fantasma para a produção.
    //
    // No LOAD (`opts.remoteAuthoritative`) o remoto É a verdade: a tabela do Supabase é o estado
    // curado pelo admin. Se o remoto tem a fase, o CONJUNTO de confrontos dela é o do remoto —
    // confronto que existe só local não é legítimo, é resíduo. Isto só roda quando um estado remoto
    // foi REALMENTE lido (ver loadRemoteState); falha de rede não chega aqui e portanto nunca apaga
    // nada.
    //
    // Fora do load segue UNIÃO de propósito: no save, um confronto que o admin acabou de cadastrar
    // ainda não está no remoto e não pode ser descartado.
    const remoteHasPhase = !!(remote.phases && remote.phases[p.id]);
    const ties = (opts.remoteAuthoritative && remoteHasPhase)
      ? { ...remoteP.ties }
      : opts.preferRemoteResults
        ? { ...localP.ties, ...remoteP.ties }
        : { ...remoteP.ties, ...localP.ties };
    const cutoffAt = opts.preferRemoteResults
      ? (remoteP.cutoffAt ?? localP.cutoffAt)
      : (localP.cutoffAt ?? remoteP.cutoffAt);
    // 2026-08-01, EMERGENCY_HOTFIX: cutoffOffsetMs (override pontual de janela cutoff->kickoff,
    // ver effectivePhaseCutoffMs) estava sendo silenciosamente descartado aqui -- phases[p.id]
    // só reconstruía {cutoffAt, ties}, igual ao bug do AUDIT-01 (espnSync flags), só que desta
    // vez no campo que tinha acabado de reabrir a entrada da Oitavas: qualquer sync de qualquer
    // dispositivo apagava o override de volta para o padrão de 1h. Mesma precedência de cutoffAt.
    const cutoffOffsetMs = opts.preferRemoteResults
      ? (remoteP.cutoffOffsetMs ?? localP.cutoffOffsetMs)
      : (localP.cutoffOffsetMs ?? remoteP.cutoffOffsetMs);
    // `officialDraw` (Batch 2) TEM de ser carregado adiante. `phases[p.id]` é reconstruído campo a
    // campo, não por spread, então um campo esquecido é DESCARTADO a cada merge — mesmo bug do
    // AUDIT-01 (flags de espnSync) e do cutoffOffsetMs. Aqui a consequência seria pior: o bracket
    // oficial das quartas perderia a proveniência no próximo sync e voltaria a parecer NÃO oficial,
    // destravando o sanitizador contra confrontos legítimos. Pego pelo teste 9 de
    // audit_draw_provenance.mjs.
    //
    // Precedência: no LOAD o remoto é a verdade (é o estado curado pelo admin); fora do load
    // preserva o local, que pode conter um registro oficial ainda não sincronizado.
    // ─── MELHORIA ESTRUTURAL (Batch 4): fim da classe de regressão "campo novo somiu no merge" ───
    // Este objeto era montado ENUMERANDO campos à mão. Três vezes um campo novo foi silenciosamente
    // descartado a cada merge por não estar na lista: os flags de espnSync (AUDIT-01), o
    // `cutoffOffsetMs` (hotfix de 2026-08-01) e o `officialDraw` (Batch 2, pego pelo teste 9). Cada
    // vez o sintoma foi diferente e caro de achar.
    //
    // Agora a base é um SPREAD, então qualquer campo de fase — incluindo `topology` do Batch 4 e
    // qualquer coisa futura — é carregado adiante automaticamente. Só os três campos que precisam de
    // precedência ESPECÍFICA são resolvidos explicitamente e sobrescrevem o spread.
    //
    // A ordem do spread já dá a precedência certa para todo o resto: no load o remoto vence (é o
    // estado curado pelo admin), fora do load o local vence (pode ter trabalho ainda não
    // sincronizado) — exatamente a regra que `officialDraw` tinha escrita à mão antes.
    const carried = opts.preferRemoteResults ? { ...localP, ...remoteP } : { ...remoteP, ...localP };
    phases[p.id] = { ...carried, cutoffAt, cutoffOffsetMs, ties };
  });
  // TODOS os flags de migração "roda uma vez" precisam estar listados aqui. Este objeto é
  // reconstruído do zero (não é spread), então qualquer flag esquecido é DESCARTADO a cada
  // merge -- e como loadRemoteState() substitui o localStorage pelo resultado do merge, o flag
  // sumia em todo sync remoto, fazendo as rotinas "roda uma vez" rodarem de novo em toda carga.
  // Achado na auditoria de 2026-08 (AUDIT-01): 5 flags eram escritos, só 2 sobreviviam ao merge.
  // Risco concreto do que voltava a rodar: healPhantomTies() apaga ties fora da lista curada de
  // DATA.knownConfrontos -- um confronto adicionado à mão pelo admin numa fase curada, antes de
  // qualquer palpite referenciá-lo, era silenciosamente removido na carga seguinte.
  // Ao adicionar um flag novo de migração, adicione também nesta lista.
  const ESPN_SYNC_ONCE_FLAGS = [
    "seededKnownConfrontos",
    "backfilledOitavasKickoffs",
    "healedFalseAutoResults",
    "healedPhantomTies",
  ];
  const espnSync = {
    activePhaseId: opts.preferRemoteResults
      ? (remote.espnSync?.activePhaseId ?? local.espnSync?.activePhaseId ?? null)
      : (local.espnSync?.activePhaseId ?? remote.espnSync?.activePhaseId ?? null),
  };
  // OR, não remote-wins/local-wins — uma vez executada a migração em QUALQUER dispositivo, o
  // flag deve permanecer true depois do merge em todos, para a rotina nunca reaplicar.
  for (const f of ESPN_SYNC_ONCE_FLAGS) {
    espnSync[f] = !!(local.espnSync?.[f] || remote.espnSync?.[f]);
  }
  // ─── BASE POR SPREAD (auditoria de invariantes de estado, 2026-08-08) ───────────────────────
  // Este objeto era montado ENUMERANDO campos à mão. Foi assim que a MESMA classe de defeito
  // apareceu quatro vezes no CDB2026: um campo novo, ausente da lista, era DESCARTADO em silêncio a
  // cada merge — flags de espnSync (AUDIT-01), cutoffOffsetMs, e officialDraw duas vezes. Nada
  // falhava; o dado simplesmente evaporava.
  //
  // A base agora é um spread das DUAS entradas, então qualquer campo de topo futuro é carregado
  // adiante automaticamente. Todos os campos abaixo continuam sendo resolvidos EXPLICITAMENTE e
  // sobrescrevem o spread, portanto o comportamento de todo campo hoje conhecido é IDÊNTICO ao de
  // antes — o spread só decide o destino de campo que ninguém enumerou.
  //
  // Ordem: fora do load o local vence (pode ter trabalho ainda não sincronizado); no load o remoto
  // vence (é o estado curado pelo admin). Mesma precedência que os campos explícitos já usam.
  const carriedForward = opts.preferRemoteResults
    ? { ...(local || {}), ...(remote || {}) }
    : { ...(remote || {}), ...(local || {}) };

  const merged = {
    ...carriedForward,
    entries, deletedIds, paid, phases, espnSync, auditLog,
    meta: (local.meta?.updatedAt || "") > (remote.meta?.updatedAt || "") ? local.meta : remote.meta,
  };
  // CHOKEPOINT 3/4 (merge): o ponto onde a contaminação sobrevivia. `ties` é UNIÃO nas duas
  // direções e não tem tombstone, então um tie que só existe local passava por aqui intacto —
  // tanto ao CARREGAR (o reparo do banco nunca chegava ao navegador) quanto ao SALVAR (o tie
  // fantasma era reenviado para a produção). Saneando a saída do merge, as duas direções ficam
  // cobertas de uma vez, sem precisar inventar semântica de tombstone para ties agora.
  enforceDrawLifecycle(merged);
  return merged;
}

// ─── Mutação administrativa dirigida (Fase 2.1 §2) ───────────────────────────────────────────
// Por que este caminho existe, separado de mergeStates(): mergeStates() com
// `preferRemoteResults: true` foi desenhado para proteger RESULTADO OFICIAL contra o cache velho
// de um PARTICIPANTE que salva sua entrada -- "remoto vence" é a regra certa nesse caso (o
// participante nunca deveria conseguir reverter um resultado já lançado só porque carregou a
// página antes). Mas essa MESMA regra, aplicada a uma ação do PRÓPRIO ADMIN, trava exatamente o
// oposto do que ele está tentando fazer: `paid: true -> false` nunca persiste (any-true-wins
// sempre resgata o `true` antigo do remoto); destravar um confronto, limpar um placar errado, ou
// trocar a fase ativa da ESPN sofrem do mesmo problema -- o merge não distingue "essa mudança é
// uma correção intencional" de "esse é só um cache desatualizado".
//
// applyMutationOverRemote() resolve isso separando as DUAS coisas que precisam acontecer numa
// gravação de admin: (1) preservar qualquer mudança remota não relacionada (nova entrada de
// participante, outro pagamento, eventos de audit log de outro dispositivo) -- conseguido
// começando a reconstrução a partir do PRÓPRIO remoto, não de um merge campo-a-campo; (2) aplicar
// a mutação pedida de forma explícita e determinística por cima desse remoto, via
// applyAdminMutation() -- nunca por comparação implícita de snapshots.
function applyMutationOverRemote(local, remote, mutation) {
  const { entries, deletedIds, auditLog } = mergeEntriesTombstonesAuditLog(local, remote);
  const phases = {};
  DATA.phases.forEach(p => {
    const remoteP = remote.phases?.[p.id] || emptyPhaseState();
    // cutoffOffsetMs (hotfix pontual, ver effectivePhaseCutoffMs) precisa sobreviver aqui igual
    // sobrevive em mergeStates() -- sem isto, QUALQUER mutação administrativa (marcar pagamento,
    // travar um confronto, etc., em qualquer fase) apagaria silenciosamente o override de
    // reabertura de cutoff de toda fase que o tivesse, reintroduzindo exatamente o bug que
    // f2f8512 corrigiu, só que pelo caminho de mutação dirigida em vez do merge de snapshot.
    //
    // ─── MELHORIA ESTRUTURAL (Batch 4): mesmo spread de mergeStates() ────────────────────────
    // Este objeto também era montado ENUMERANDO campos, e é a MESMA classe de regressão: como a
    // base aqui é o remoto e a lista não incluía `officialDraw`, qualquer mutação administrativa
    // (marcar um pagamento, travar um confronto — em QUALQUER fase) apagava a proveniência do
    // sorteio oficial das quartas, fazendo o bracket legítimo voltar a parecer não-oficial e
    // liberando o sanitizador contra ele. O spread carrega adiante `officialDraw`, a `topology` do
    // Batch 4 e qualquer campo de fase futuro; `ties` é copiado à parte só para não compartilhar
    // referência com o remoto.
    phases[p.id] = { ...remoteP, cutoffAt: remoteP.cutoffAt ?? null, ties: { ...(remoteP.ties || {}) } };
  });
  const base = {
    entries, deletedIds, auditLog,
    paid: { ...(remote.paid || {}) },
    phases,
    espnSync: { ...(remote.espnSync || {}) },
    meta: remote.meta,
  };
  return applyAdminMutation(base, mutation);
}

// Único ponto que sabe como aplicar cada TIPO de mutação administrativa — puro (nunca modifica
// `state` recebido), determinístico, sem depender de comparação entre snapshots inteiros. Cobre
// as 12 operações listadas na Fase 2.1 §2. `type: "batch"` aplica uma lista em sequência (usada
// por autoSyncEspn()/autoSyncEspnResults(), que legitimamente mudam vários confrontos numa só
// gravação -- uma chamada de rede por ciclo, não uma por confronto).
function applyAdminMutation(state, mutation) {
  if (mutation.type === "batch") {
    return mutation.mutations.reduce((acc, m) => applyAdminMutation(acc, m), state);
  }
  const s = {
    ...state,
    paid: { ...(state.paid || {}) },
    phases: Object.fromEntries(Object.entries(state.phases || {}).map(([k, v]) => [k, { ...v, ties: { ...(v.ties || {}) } }])),
    espnSync: { ...(state.espnSync || {}) },
  };
  const phaseOf = phaseId => s.phases[phaseId] || (s.phases[phaseId] = emptyPhaseState());
  switch (mutation.type) {
    case "upsert-entry": {
      const idx = (s.entries || []).findIndex(e => e.id === mutation.entry.id);
      // ENTRY ROSTER FREEZE: o ramo de APPEND (id desconhecido) é criação de entrada e fica
      // proibido enquanto CONFIG.entryRosterFrozen. O ramo de UPDATE (id já existente) continua
      // liberado — o admin ainda precisa corrigir nome/pagamento de quem já está no roster.
      // Rejeição determinística e sem escrita parcial: nada é alocado antes deste ponto.
      if (idx < 0 && !isEntryCreationAllowed()) {
        throw new Error("ENTRY_ROSTER_FROZEN");
      }
      s.entries = idx >= 0 ? s.entries.map((e, i) => i === idx ? mutation.entry : e) : [...(s.entries || []), mutation.entry];
      break;
    }
    case "delete-entry": {
      s.deletedIds = [...new Set([...(s.deletedIds || []), mutation.entryId])];
      break;
    }
    case "set-payment": {
      s.paid[mutation.entryId] = !!mutation.value;
      break;
    }
    // ─── Batch 2: agendar o sorteio oficial ────────────────────────────────
    // Só marca a DATA. NÃO cria confronto nenhum e NÃO torna o bracket oficial — é exatamente o
    // estado QUARTERFINAL_DRAW_SCHEDULED (countdown). Fabricar par a partir de uma data seria
    // inventar sorteio.
    case "set-draw-schedule": {
      const ph = phaseOf(mutation.phaseId);
      const prev = ph.officialDraw && typeof ph.officialDraw === "object" ? ph.officialDraw : {};
      s.phases[mutation.phaseId] = { ...ph, officialDraw: {
        ...prev,
        authority: "CBF",
        source: mutation.source || prev.source || "cbf-publication",
        sourceUrl: mutation.sourceUrl || prev.sourceUrl || null,
        scheduledAt: mutation.scheduledAt || null,
      } };
      break;
    }
    // ─── Batch 2/3: registrar o sorteio oficial (ingestão validada) ─────────
    // ÚNICO caminho que torna o bracket das quartas autoritativo. Exige o conjunto de confrontos E
    // a proveniência completa; grava `bracketHash` para que uma alteração posterior do bracket seja
    // detectável. Fail closed: proveniência incompleta é REJEITADA aqui em vez de virar um
    // `officialDraw` pela metade que o ciclo de vida teria de adivinhar.
    case "register-official-draw": {
      const ph = phaseOf(mutation.phaseId);
      // BATCH 3: os confrontos passam OBRIGATORIAMENTE pelo normalizador/validador. `mutation.pairs`
      // é o caminho canônico (qualquer formato de fonte); `mutation.ties` continua aceito para o
      // fluxo manual já existente, mas é validado do mesmo jeito — ingestão não pode contornar a
      // validação, que é exatamente o que "não deixe o ingest burlar a validação" exige.
      const qualified = Array.isArray(mutation.qualified) && mutation.qualified.length
        ? mutation.qualified
        : qualifiedTeamsForQuartas(s);
      let ties;
      if (mutation.pairs || mutation.validateAgainstQualified !== false) {
        ties = normalizeCbfDraw({ pairs: mutation.pairs || mutation.ties, qualified });
      } else {
        ties = mutation.ties && typeof mutation.ties === "object" ? mutation.ties : null;
      }
      if (!ties || Object.keys(ties).length === 0) {
        throw new Error("OFFICIAL_DRAW_NO_TIES");
      }
      for (const t of Object.values(ties)) {
        if (!t || !t.teamA || !t.teamB) throw new Error("OFFICIAL_DRAW_INCOMPLETE_TIE");
      }
      // Re-ingestão sobre bracket já travado: idêntica = no-op; diferente = recusada, salvo correção
      // explícita e autorizada. Nunca sobrescreve um bracket oficial em silêncio.
      const decision = officialDrawReingestDecision(ph, ties, mutation.correction);
      if (decision.action === "reject") throw drawIngestError(decision.code);
      if (decision.action === "noop") break;
      const prev = ph.officialDraw && typeof ph.officialDraw === "object" ? ph.officialDraw : {};
      const nowIso = new Date().toISOString();
      const od = {
        authority: "CBF",
        source: mutation.source || "manual-admin",
        sourceUrl: mutation.sourceUrl || prev.sourceUrl || null,
        scheduledAt: mutation.scheduledAt || prev.scheduledAt || nowIso,
        publishedAt: mutation.publishedAt || null,
        ingestedAt: nowIso,
        validatedAt: nowIso,
        validatedBy: mutation.validatedBy || "admin",
        bracketHash: bracketFingerprint(ties),
        // Correção controlada fica REGISTRADA na proveniência — substituir um bracket oficial não
        // pode ser indistinguível de registrá-lo pela primeira vez.
        ...(decision.action === "correct" ? { correction: {
          reason: String(mutation.correction.reason),
          authorizedBy: String(mutation.correction.authorizedBy),
          correctedAt: nowIso,
          previousBracketHash: ph.officialDraw?.bracketHash || null,
        } } : {}),
      };
      if (!officialDrawProvenanceIsValid(od)) throw new Error("OFFICIAL_DRAW_INVALID_PROVENANCE");
      s.phases[mutation.phaseId] = { ...ph, ties: { ...ties }, officialDraw: od };
      break;
    }
    // ─── Batch 4: registrar a TOPOLOGIA oficial de uma fase derivada ────────
    // A composição da semifinal/final é DERIVADA (não há sorteio próprio), mas o MAPEAMENTO
    // vencedor-de-QF → vaga-de-SF é DADO OFICIAL da competição, não convenção de implementação.
    // Por isso `mutation.slots` é OBRIGATÓRIO: esta mutação nunca deriva qf-1×qf-2 / qf-3×qf-4 nem
    // qualquer outra convenção. Enquanto a CBF não publicar o mapeamento, não existe topologia — e
    // a fase permanece honestamente sem confronto, igual às quartas sem sorteio.
    case "register-bracket-topology": {
      const phaseId = mutation.phaseId;
      const predecessorId = DERIVED_PHASES[phaseId];
      if (!predecessorId) throw drawIngestError("TOPOLOGY_PHASE_NOT_DERIVED", String(phaseId));
      if (!mutation.slots) throw drawIngestError("TOPOLOGY_REQUIRED", "topologia oficial não fornecida");
      const ph = phaseOf(phaseId);
      const predecessorTieIds = Object.keys(s.phases?.[predecessorId]?.ties || {});
      if (!predecessorTieIds.length) {
        throw drawIngestError("TOPOLOGY_PREDECESSOR_EMPTY", predecessorId);
      }
      if (predecessorTieIds.length % 2 !== 0) {
        throw drawIngestError("TOPOLOGY_PREDECESSOR_ODD", `${predecessorId}: ${predecessorTieIds.length}`);
      }
      // Ids de confronto de QUALQUER outra fase, para distinguir "id inventado" de "dependência na
      // fase errada" (ver validateTopology).
      const foreignTieIds = [];
      for (const [pid, p] of Object.entries(s.phases || {})) {
        if (pid === predecessorId) continue;
        foreignTieIds.push(...Object.keys(p?.ties || {}));
      }
      // COMPLETUDE: exigir exatamente metade das vagas E proibir predecessor repetido (validateTopology)
      // faz com que toda topologia aceita consuma cada confronto predecessor exatamente uma vez.
      // Topologia parcial nunca fica registrada pela metade.
      const slots = validateTopology(mutation.slots, {
        predecessorTieIds, foreignTieIds, expectedSlots: predecessorTieIds.length / 2,
      });
      const decision = topologyReregisterDecision(ph, slots, mutation.correction);
      if (decision.action === "reject") throw drawIngestError(decision.code);
      if (decision.action === "noop") break;
      const nowIso = new Date().toISOString();
      const provenance = {
        authority: "CBF",
        source: mutation.source || "manual-admin",
        sourceUrl: mutation.sourceUrl || ph.topology?.provenance?.sourceUrl || null,
        publishedAt: mutation.publishedAt || null,
        ingestedAt: nowIso,
        validatedAt: nowIso,
        validatedBy: mutation.validatedBy || "admin",
        topologyFingerprint: topologyFingerprint(slots),
        ...(decision.action === "correct" ? { correction: {
          reason: String(mutation.correction.reason),
          authorizedBy: String(mutation.correction.authorizedBy),
          correctedAt: nowIso,
          previousTopologyFingerprint: ph.topology?.provenance?.topologyFingerprint || null,
        } } : {}),
      };
      if (!topologyProvenanceIsValid(provenance)) throw drawIngestError("TOPOLOGY_INVALID_PROVENANCE");
      s.phases[phaseId] = { ...ph, topology: { slots, provenance } };
      break;
    }
    case "set-cutoff": {
      const ph = phaseOf(mutation.phaseId);
      s.phases[mutation.phaseId] = { ...ph, cutoffAt: mutation.cutoffAt ?? null };
      break;
    }
    case "add-tie":
    case "espn-add-tie": {
      const ph = phaseOf(mutation.phaseId);
      // INVARIANTE DE SORTEIO: numa fase com gate (quartas), não aceitar confronto enquanto o
      // sorteio não for oficial. FALHA EXPLÍCITA de propósito, em vez de aceitar e deixar o
      // sanitizador apagar depois: silenciosamente descartar o cadastro do admin seria pior que
      // recusar — ele acharia que salvou. A mensagem diz o que fazer (registrar o cutoff da fase
      // ou a proveniência oficial do sorteio) antes de cadastrar os confrontos.
      if (DRAW_GATED_PHASES.has(mutation.phaseId) && !phaseDrawIsOfficial(ph)) {
        throw new Error("QF_DRAW_NOT_OFFICIAL");
      }
      s.phases[mutation.phaseId] = { ...ph, ties: { ...ph.ties, [mutation.tieId]: mutation.tie } };
      break;
    }
    case "remove-tie": {
      const ph = phaseOf(mutation.phaseId);
      const ties = { ...ph.ties };
      delete ties[mutation.tieId];
      s.phases[mutation.phaseId] = { ...ph, ties };
      break;
    }
    case "save-leg":
    case "espn-save-result": {
      const ph = phaseOf(mutation.phaseId);
      const tie = ph.ties[mutation.tieId] || {};
      const newTie = { ...tie, matches: { ...(tie.matches || {}), [mutation.leg]: mutation.match } };
      s.phases[mutation.phaseId] = { ...ph, ties: { ...ph.ties, [mutation.tieId]: newTie } };
      break;
    }
    case "clear-leg": {
      const ph = phaseOf(mutation.phaseId);
      const tie = ph.ties[mutation.tieId] || {};
      const prevMatch = tie.matches?.[mutation.leg] || {};
      const clearedMatch = { ...prevMatch, goalsHome: null, goalsAway: null, status: "SCHEDULED" };
      const newTie = { ...tie, matches: { ...(tie.matches || {}), [mutation.leg]: clearedMatch } };
      s.phases[mutation.phaseId] = { ...ph, ties: { ...ph.ties, [mutation.tieId]: newTie } };
      break;
    }
    case "lock-tie": {
      const ph = phaseOf(mutation.phaseId);
      const tie = ph.ties[mutation.tieId] || {};
      // Football-hardening checkpoint E: penaltiesHome/penaltiesAway/penaltiesWinnerTeamId are
      // purely additive — only set when the mutation actually carries them (a tied-aggregate
      // lock with penalty scores entered). Old mutations/replays with none of these keys behave
      // exactly as before: qualifiedTeamId/lockedAt/lockedBy only, no penalty fields at all.
      const newTie = {
        ...tie,
        qualifiedTeamId: mutation.qualifiedTeamId, lockedAt: mutation.lockedAt, lockedBy: mutation.lockedBy,
        ...(mutation.penaltiesHome != null && mutation.penaltiesAway != null ? {
          penaltiesHome: mutation.penaltiesHome,
          penaltiesAway: mutation.penaltiesAway,
          penaltiesWinnerTeamId: mutation.penaltiesWinnerTeamId || mutation.qualifiedTeamId,
        } : {}),
      };
      s.phases[mutation.phaseId] = { ...ph, ties: { ...ph.ties, [mutation.tieId]: newTie } };
      break;
    }
    case "unlock-tie": {
      const ph = phaseOf(mutation.phaseId);
      const tie = { ...(ph.ties[mutation.tieId] || {}) };
      delete tie.qualifiedTeamId; delete tie.lockedAt; delete tie.lockedBy;
      s.phases[mutation.phaseId] = { ...ph, ties: { ...ph.ties, [mutation.tieId]: tie } };
      break;
    }
    case "set-active-phase": {
      s.espnSync.activePhaseId = mutation.phaseId;
      break;
    }
    default:
      throw new Error(`applyAdminMutation: tipo de mutação desconhecido: ${mutation.type}`);
  }
  return s;
}

// ─── Admin auth ─────────────────────────────────────────────────────────────
async function sha256hex(msg) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
let _loginAttempts  = Number(sessionStorage.getItem("cdb2026_loginAttempts") || 0);
let _loginLockUntil = Number(sessionStorage.getItem("cdb2026_loginLockUntil") || 0);

function isAdminActive() { return Number(sessionStorage.getItem("cdb2026_adminUntil") || 0) > Date.now(); }
function guardAdmin() { if (isAdminActive()) return true; showSection("admin"); return false; }

// ─── Admin action safety: triple confirmation + audit journal ───────────────────────────────
// Eduardo, 2026-07-16: "make sure there's triple confirmation if I click incorrectly it can be
// rolled back easily... what I want to avoid is to fat finger something... we need to have a way
// to journal this so it can be rolled back if needed". ESPN auto-sync covers normal operation —
// this only matters when Eduardo intervenes manually (delete confronto, enter/edit a leg score,
// lock/unlock a tie's official result). Two confirm() dialogs alone can be blitzed through with
// fast taps on mobile; the third step requires typing a fixed word, which an accidental tap
// sequence cannot produce.
const ADMIN_CONFIRM_WORD = "CONFIRMAR";
function tripleConfirm(summaryMsg, detailMsg) {
  if (!confirm(summaryMsg)) return false;
  if (!confirm(detailMsg)) return false;
  const typed = prompt(t("tripleConfirmType").replace("{word}", ADMIN_CONFIRM_WORD));
  return typed === ADMIN_CONFIRM_WORD;
}
function appendAdminAuditLog(s, action, detail) {
  if (!Array.isArray(s.auditLog)) s.auditLog = [];
  s.auditLog.unshift({ ts: new Date().toISOString(), action, admin: true, detail });
  if (s.auditLog.length > 200) s.auditLog.length = 200;
}

// ─── Sections ───────────────────────────────────────────────────────────────
function showSection(id) {
  $$(".page").forEach(p => p.classList.toggle("active", p.id === id));
  $$(".nav button[data-section]").forEach(b => {
    const active = b.dataset.section === id;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  const h = document.querySelector(`#${id} h2, #${id} h3`);
  if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: false }); }
  if (id === "admin") renderAdmin();
  if (id === "games") {
    renderGamesSection();
    // Rola pra próxima perna automaticamente ao abrir a aba -- mesmo comportamento da Copa
    // (.game-card[data-state="pre"], showSection() em bolao/js/app.js) e do BR2026
    // (.game-card.pre, showSection() em bolao/br2026/js/app.js). Eduardo, 2026-08-02: "por
    // default deve ir automaticamente para o próximo jogo." data-next-leg é calculado em
    // renderGamesSection() via nextUpcomingLegKey() -- ordem cronológica real por perna, não por
    // confronto (a mesma perna que "Ver palpites"/comprovante/CSV já usam desde a v3.67).
    setTimeout(() => {
      document.querySelector('[data-next-leg="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }
  if (id === "probs") renderProbsSection();
}

// ─── Cutoff ─────────────────────────────────────────────────────────────────
// Não existe mais um cutoff único global (era um resquício do modelo antigo de bracket fixo —
// ver CDB2026_RULES_AND_MODEL.md). Cada FASE tem seu próprio cutoffAt. O único uso "global" que
// resta é bloquear a CRIAÇÃO de entradas novas e alimentar o contador regressivo do topo — os
// dois usam o cutoff da fase que está realmente aberta para palpite AGORA
// (`espnSync.activePhaseId`, hoje "oitavas").
//
// Regra confirmada por Eduardo (2026-07-14): "the cutoff should be until 1 hour before the first
// game" — igual à Copa/BR2026 (ver rulesCutoffText no i18n). Antes disso dependia do admin
// CALCULAR e digitar esse valor manualmente em "Fases e confrontos" — passo que nunca tinha sido
// feito em produção, então o contador ficava preso em "aguardando sorteio" para sempre mesmo com
// o mecanismo (v3.10) já corrigido para ler a fase certa. Agora é calculado automaticamente: 1h
// antes do kickoff mais cedo já conhecido entre os confrontos da fase ativa (capturado pela
// sincronização com a ESPN — ver autoSyncEspn()). `cutoffAt` definido manualmente pelo admin
// ainda tem prioridade quando existir, para os casos em que ele queira um prazo diferente do
// automático (ex.: fechar mais cedo por algum motivo).
function firstKnownKickoffMs(s, phaseId) {
  let earliest = null;
  Object.values(s.phases?.[phaseId]?.ties || {}).forEach(tie => {
    Object.values(tie.matches || {}).forEach(m => {
      if (!m?.kickoff) return;
      const ms = new Date(m.kickoff).getTime();
      if (Number.isFinite(ms) && (earliest === null || ms < earliest)) earliest = ms;
    });
  });
  return earliest;
}
// Mesmo cálculo reaproveitado nos dois pontos que precisam saber se UMA fase específica já travou
// — a criação/edição de entradas (isPhaseLocked, abaixo) e o contador/bloqueio global da fase
// ativa (entryCutoffMs). Bug real encontrado em auditoria (2026-07-14): antes desta correção,
// isPhaseLocked() só olhava o cutoffAt MANUAL — como a fase nunca teve esse campo preenchido em
// produção (é opcional, o auto-cálculo existe justamente para não depender disso), uma entrada
// podia continuar sendo editada para um confronto cujo jogo real já tinha começado ou terminado.
//
// v3.18 (2026-07-14, EMERGENCY_HOTFIX, Eduardo: "esse negócio de resultado manual não funciona,
// implemente igual a Copa do Mundo, urgente, ninguém está conseguindo entrar palpites"): até aqui,
// um `cutoffAt` MANUAL tinha prioridade incondicional sobre o auto-calculado, para sempre, sem
// nenhuma checagem de validade -- foi a causa raiz de PELO MENOS três incidentes de produção no
// mesmo dia (um valor manual esquecido de testes anteriores ao mecanismo de auto-cálculo travava a
// fase inteira). A Copa não tem esse problema porque não existe ambiguidade manual-vs-auto: o
// cutoff é um valor único, direto, sem um toggle que pode ficar esquecido/desatualizado.
// Replicando essa simplicidade aqui: quando existe kickoff conhecido para a fase, o auto-calculado
// (kickoff mais cedo conhecido menos 1h) SEMPRE vence -- elimina essa classe inteira de bug de
// vez. O campo manual (`cutoffAt`) continua existindo só como fallback para quando NENHUM kickoff é
// conhecido ainda (ex.: antes do sorteio real de uma fase), igual sempre foi seu propósito original
// antes do auto-cálculo existir.
// `cutoffOffsetMs` (2026-08-01, hotfix pontual): janela entre o cutoff e o 1º kickoff, opcional
// por fase. Default 3600000 (1h, o valor fixo original) preserva o comportamento de sempre em
// toda fase que não definir o campo -- Eduardo pediu para reabrir entrada nas Oitavas até 15min
// antes do jogo (não 1h), então só `s.phases.oitavas.cutoffOffsetMs = 900000` foi setado, direto
// no estado, sem mexer em nenhuma outra fase.
function effectivePhaseCutoffMs(s, phaseId) {
  const firstKickoff = firstKnownKickoffMs(s, phaseId);
  if (firstKickoff !== null) {
    const offsetMs = s.phases?.[phaseId]?.cutoffOffsetMs ?? 3600000;
    return firstKickoff - offsetMs;
  }
  const manual = s.phases?.[phaseId]?.cutoffAt;
  return manual ? new Date(manual).getTime() : null;
}
function entryCutoffMs() {
  const s = state();
  const phaseId = s.espnSync?.activePhaseId || "fase-1";
  return effectivePhaseCutoffMs(s, phaseId);
}

// ─── CICLO DE VIDA DA FASE DE PALPITE ────────────────────────────────────────────────────────
//
// O DEFEITO QUE ISTO FECHA (2026-08-11):
//
// `cutoffAt === null` carregava DOIS significados opostos e o código não conseguia distingui-los:
//
//   a) "a fase ainda nem foi sorteada"          -> palpites têm de ficar FECHADOS
//   b) "a fase foi sorteada, mas a CBF ainda    -> palpites têm de ficar ABERTOS
//       não publicou a tabela detalhada"
//
// Com o sorteio oficial das quartas aplicado e sem kickoff publicado, a página continuou dizendo
// "Aguardando sorteio oficial" — o caso (b) sendo tratado como (a). Os quatro confrontos estavam
// em produção, o formulário existia no DOM, e nenhum participante conseguia ver nada.
//
// A correção não é "null significa aberto". Isso abriria fases FUTURAS, que também têm cutoff
// null e cujo sorteio nem aconteceu. O estado é DERIVADO de fatos independentes: existe sorteio
// oficial validado? é a fase corrente? o prazo é conhecido? já passou?
const PHASE_LIFECYCLE = Object.freeze({
  WAITING_FOR_OFFICIAL_DRAW: "WAITING_FOR_OFFICIAL_DRAW",
  DRAW_LOCKED_CUTOFF_PENDING: "DRAW_LOCKED_CUTOFF_PENDING",
  PICKS_OPEN: "PICKS_OPEN",
  PICKS_CLOSED: "PICKS_CLOSED",
});

/**
 * Estado de palpite de UMA fase. PURA: não lê relógio global além de `now` (injetável).
 * @returns {{state:string, cutoffMs:number|null, cutoffKnown:boolean, ties:number, open:boolean}}
 */
function phaseLifecycle(s, phaseId, now = Date.now()) {
  const phase = s?.phases?.[phaseId] || null;
  const ties = phase?.ties ? Object.keys(phase.ties).length : 0;
  const drawLocked = officialDrawProvenanceIsValid(phase?.officialDraw) && ties > 0;
  const cutoffMs = phase ? effectivePhaseCutoffMs(s, phaseId) : null;
  const cutoffKnown = cutoffMs !== null;
  const isCurrent = (s?.espnSync?.activePhaseId || null) === phaseId;

  // Sem sorteio oficial validado não há o que palpitar — vale para as fases futuras, que também
  // têm cutoff null. É esta condição, e não o cutoff, que impede abrir uma fase não sorteada.
  if (!drawLocked) {
    return { state: PHASE_LIFECYCLE.WAITING_FOR_OFFICIAL_DRAW, cutoffMs: null,
             cutoffKnown: false, ties, open: false };
  }
  if (cutoffKnown && now >= cutoffMs) {
    return { state: PHASE_LIFECYCLE.PICKS_CLOSED, cutoffMs, cutoffKnown: true, ties, open: false };
  }
  // Fase sorteada mas que NÃO é a corrente: histórica ou ainda não liberada pelo operador.
  // Não abre por conta própria.
  if (!isCurrent) {
    return { state: PHASE_LIFECYCLE.PICKS_CLOSED, cutoffMs, cutoffKnown, ties, open: false };
  }
  if (!cutoffKnown) {
    // O caso (b): sorteio validado, fase corrente, tabela detalhada da CBF ainda não publicada.
    //
    // REGRA DE NEGÓCIO (Eduardo, 2026-08-11, override explícito): palpite NÃO abre sem data E
    // horário oficiais confirmados. `open: false`.
    //
    // A versão anterior abria aqui, e estava errada por um motivo concreto: sem `cutoffMs` não
    // existe prazo para fechar. Um formulário aberto sem prazo aceita palpite depois de o jogo
    // ter começado — e o único momento em que alguém descobriria isso é depois de valer dinheiro.
    // "Aberto sem prazo" não é um estado intermediário simpático; é um bolão sem regra.
    //
    // Os confrontos oficiais CONTINUAM visíveis: o sorteio aconteceu e esconder isso seria tão
    // falso quanto abrir sem prazo. O que a tela diz é o que é verdade: já há confronto, ainda
    // não há data.
    return { state: PHASE_LIFECYCLE.DRAW_LOCKED_CUTOFF_PENDING, cutoffMs: null,
             cutoffKnown: false, ties, open: false };
  }
  return { state: PHASE_LIFECYCLE.PICKS_OPEN, cutoffMs, cutoffKnown: true, ties, open: true };
}

/** Ciclo de vida da fase CORRENTE — o que a UI e o portão de submissão consultam. */
function activePhaseLifecycle(now = Date.now()) {
  const s = state();
  return phaseLifecycle(s, s.espnSync?.activePhaseId || "fase-1", now);
}
// "A entrada está FECHADA agora?" — fonte única, derivada do ciclo de vida da fase.
//
// Era `ms !== null && Date.now() > ms`: só o prazo. Isso tratava "fase sem sorteio" e "fase
// sorteada com prazo pendente" como a MESMA coisa (ambas cutoff null => não passou => aberto),
// e dependia de `activePhaseId` apontar sempre para uma fase legítima para não abrir uma fase
// não sorteada. O ciclo de vida decide com os dois fatos, não com um.
//
// O nome fica: dezenas de chamadas dependem dele, e renomear tudo num patch de produção que abre
// palpite para 12 pessoas é risco sem retorno.
function isPastEntryCutoff() {
  return !activePhaseLifecycle().open;
}
// ENTRY ROSTER FREEZE — ver CONFIG.entryRosterFrozen em js/config.js.
// Fonte de verdade única para "pode criar UMA ENTRADA NOVA?". Deliberadamente NÃO consulta
// cutoff/fase/palpites: o congelamento é permanente e independente de PICKS_OPEN. Editar uma
// entrada JÁ existente não passa por aqui — continua governado pelo cutoff da fase.
function isEntryCreationAllowed() {
  return !C.entryRosterFrozen;
}
// ENTRY ROSTER FREEZE — "estou editando uma entrada que REALMENTE existe?".
// Não basta `_editingEntry` ser truthy: o id precisa continuar no roster e não estar tombstoned
// (a entrada pode ter sido removida pelo admin em outro dispositivo entre o lookup e o save).
// É por isto que o formulário de palpites volta a aparecer com o roster congelado — e SÓ por
// isto: um `_editingEntry` obsoleto não revela formulário nenhum.
function editingEntryIsValid(s) {
  const st = s || state();
  if (!_editingEntry || !_editingEntry.id) return false;
  if (new Set(st.deletedIds || []).has(_editingEntry.id)) return false;
  return (st.entries || []).some(e => e.id === _editingEntry.id);
}
function isPhaseLocked(s, phaseId) {
  const ms = effectivePhaseCutoffMs(s, phaseId);
  return ms !== null && Date.now() > ms;
}
// "Editar minha entrada" só faz sentido depois que a Oitavas (primeira fase que o participante de
// fato palpita -- fase-1 a fase-4 são histórico já concluído antes do bolão existir, ver
// DATA.phasesConcludedNoData) termina: antes disso não há nada de novo pra editar, e o card só
// confunde quem está enviando a entrada pela primeira vez -- mesma intenção original de
// oitavasComplete() no modelo antigo de bracket fixo (pré-rewrite v3.0, ver git history).
//
// v3.20 (2026-07-14, EMERGENCY_HOTFIX, mesmo dia): a v3.9 "corrigiu" um bug real (o card ficava
// travado PARA SEMPRE porque a checagem antiga usava fase-1, que nunca tem confronto cadastrado
// no modelo novo) mas checando a fase ERRADA -- fase1Complete() checava fase-1 (sempre
// "concluída" via DATA.phasesConcludedNoData desde a v3.8), não Oitavas. O efeito colateral nunca
// percebido: o gate virou um no-op permanente, "editar minha entrada" ficou disponível o tempo
// todo desde a v3.9, quando devia continuar fechado até a Oitavas terminar de verdade. Renomeado
// e re-targetado para checar a fase certa.
function oitavasComplete(s) {
  return phaseFullyResolved(s, "oitavas");
}
// Verdadeiro quando a fase tem confrontos cadastrados e todos já têm resultado (qualifiedTeamId)
// — usado para tirar fases já decididas do formulário de palpites (nada a apostar) sem depender
// de cutoffAt, que é opcional e só o admin define manualmente.
function phaseFullyResolved(s, phaseId) {
  const ties = Object.values(s.phases?.[phaseId]?.ties || {});
  return ties.length > 0 && ties.every(tie => tie.qualifiedTeamId);
}

// ─── Receipt code ───────────────────────────────────────────────────────────
// Mesmo algoritmo (FNV-32, não criptográfico, só identificação) e formato usado na Copa do
// Mundo (hashString/receiptCode em bolao/js/app.js) — padrão compartilhado da plataforma.
function hashString(str) {
  let h = 2166136261;
  for (const cp of str) { h ^= cp.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
// The EmailJS template's Subject field interpolates entry_name/receipt_code with plain {{}}
// (HTML-escaped) rather than {{{}}} like the body -- "/" comes out as the literal "&#x2F;" in
// the subject header, which is plain text and never HTML-decodes it back (Eduardo, 2026-07-24,
// saw this on BR2026's round-email date ranges -- same platform-wide gap, hardened here for
// free-typed entry names too). Same helper as Copa/BR2026, kept local per app per platform
// convention (no shared imports between the three apps).
function emailSubjectSafe(s) {
  return String(s ?? "").replace(/\//g, "-");
}
function receiptCode(e) {
  return `CDB2026-${hashString(JSON.stringify({ n: e.entryName, t: e.createdAt }))}-${String(e.createdAt || "").slice(0, 10).replace(/-/g, "")}`;
}
// Edição própria da entrada exige e-mail + código do comprovante (não só o e-mail) — o
// comprovante só é conhecido por quem criou a entrada, o e-mail sozinho não é um segredo real.
function findEntryByEmailAndCode(email, code) {
  const s = state();
  const deleted = new Set(s.deletedIds || []);
  const norm = v => String(v || "").trim().toLowerCase();
  return (s.entries || []).find(e =>
    !deleted.has(e.id) &&
    norm(e.participantEmail) === norm(email) &&
    receiptCode(e).toUpperCase() === norm(code).toUpperCase()
  ) || null;
}

// ─── UUID ───────────────────────────────────────────────────────────────────
function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

// ─── Team logo ──────────────────────────────────────────────────────────────
// Escudo real do time (ESPN CDN, DATA.teamLogos). Cobre os clubes mais prováveis de chegar às
// fases finais — um time cadastrado pelo admin que não estiver no dicionário simplesmente não
// mostra escudo (fallback gracioso, não é erro — a Copa do Brasil tem 126 clubes, muitos de
// divisões sem CDN de escudo conhecida).
function teamLogoImg(team, cls, visualRole) {
  const url = DATA.teamLogos?.[team];
  if (!url) return "";
  return `<img src="${esc(url)}" class="${cls || "team-logo"}" alt="" aria-hidden="true"${visualRole ? ` data-visual-role="${visualRole}"` : ""}>`;
}

// ─── Payment icon ───────────────────────────────────────────────────────────
const PAY_ICON_SVG = { CashApp: "assets/cashapp.svg", Zelle: "assets/zelle.svg", Venmo: "assets/venmo.svg" };
function payIcon(method) {
  const src = PAY_ICON_SVG[method];
  return src ? `<img src="${esc(src)}" alt="${esc(method)}" class="pay-method-icon">` : "💳";
}
// Consolidado Fase 2 §5 -- markup idêntico duplicado em renderPayment()/renderPaymentBox().
function zelleQrHtml(method) {
  return method === "Zelle" && C.zelle?.qrImage
    ? `<img src="${esc(C.zelle.qrImage)}" alt="QR Zelle" class="pay-qr">` : "";
}

// ─── Phase / tie / match helpers ────────────────────────────────────────────
function getPhaseDef(phaseId) { return DATA.phases.find(p => p.id === phaseId); }
function legsForFormat(format) { return format === "TWO_LEG" ? ["first", "second"] : ["single"]; }
function emptyMatch() { return { homeTeam: null, awayTeam: null, kickoff: null, venue: null, city: null, goalsHome: null, goalsAway: null, status: "SCHEDULED" }; }

// Fonte única de "quem é mandante nesta perna". No mata-mata de ida e volta o mandante se
// inverte na volta, e `goalsHome`/`goalsAway` (tanto de palpite quanto de resultado) são SEMPRE
// relativos ao mandante REAL daquela perna -- é assim que o formulário coleta (renderPickForm) e
// como a aba Jogos/o admin já exibiam. Achado na auditoria de 2026-08 (AUDIT-05): o comprovante,
// o detalhe "Ver palpites" do ranking e o CSV imprimiam `teamA × teamB` fixo com
// `goalsHome × goalsAway`, invertendo o placar da VOLTA -- um palpite "Fluminense 3 × 0 Vasco"
// aparecia como "Vasco 3 × 0 Fluminense" nesses três documentos. Não afetava pontuação
// (matchPoints compara palpite e resultado na mesma orientação), só os documentos que provam o
// que o participante apostou. Use SEMPRE esta função ao exibir uma perna.
function legTeams(tie, leg, match) {
  return {
    home: match?.homeTeam || (leg === "second" ? tie.teamB : tie.teamA),
    away: match?.awayTeam || (leg === "second" ? tie.teamA : tie.teamB),
  };
}

// Timestamp BRT (America/Sao_Paulo) para exibições administrativas/comprovante que usam
// SOMENTE horário do Brasil (recibo, rodapé de sync, rótulo de cutoff, CSV). Não usar para
// horário de partida/cutoff mostrado ao participante -- esse é dual ET+BRT, ver fmtDate().
function formatBrtTimestamp(dateStr, opts = {}) {
  return new Date(dateStr).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", ...opts });
}

// Agregado de um confronto de ida+volta a partir das duas partidas — null se alguma ainda não
// tem placar. O mandante se inverte na volta (regra real do mata-mata): teamA soma seus gols
// como mandante da ida + visitante da volta; teamB o inverso.
function aggregateFromMatches(matches) {
  const first = matches?.first, second = matches?.second;
  if (!first || first.goalsHome == null || first.goalsAway == null) return null;
  if (!second || second.goalsHome == null || second.goalsAway == null) return null;
  return { totalA: first.goalsHome + second.goalsAway, totalB: first.goalsAway + second.goalsHome };
}

// Phase 7-FIX aggregate-hero feature: SINGLE source of truth for "what's the tie's progress/
// aggregate right now", reused by BOTH the confronto-card's static result line (resultLine,
// renderGamesSection() below) and the live-hero widget (renderLiveTieCard()) — Eduardo's
// explicit requirement was "reuse existing qualification logic rather than recomputing in the
// presentation layer". Returns null for single-match ties (Final) — no aggregate concept there.
//
// Team-order note: leg 2 swaps home/away (legTeams(): leg2 home=teamB, away=teamA) — the SAME
// convention aggregateFromMatches() already uses for the "final" stage is applied here for the
// "second-leg-live" stage too, so the aggregate never flips when home/away swaps between legs.
//
// Penalties: football-hardening checkpoint E (2026-08, Eduardo explicitly authorized) added
// additive, backward-compatible penalty fields — tie.penaltiesHome, tie.penaltiesAway,
// tie.penaltiesWinnerTeamId — alongside the existing tie.qualifiedTeamId. These are ALWAYS
// keyed by TEAM (teamA/teamB), never by leg-2 home/away, specifically so a reversed home/away
// between legs can never flip which team's penalty count is which (the same orientation bug
// class aggregateFromMatches()/this function already guard against for the regulation
// aggregate). Old fixtures/tie objects with none of these three keys are unaffected: `penalties`
// stays null exactly as before (backward compatible, not a breaking schema change) — see
// docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md and bolao/cdb2026/scripts/test_penalty_fields.mjs.
// HARD RULE, never violate: penalties are NEVER added into `aggregate` anywhere below — the
// aggregate is always the pure regulation-goals sum from aggregateFromMatches(), and `penalties`
// is always a separate, sibling field. This is the exact "6x5 instead of aggregate 1x1 +
// penalties 5x4" bug class this checkpoint exists to prevent.
function tieProgressDisplay(tie, phaseFormat, liveLeg2Goals) {
  if (phaseFormat !== "TWO_LEG") return null;
  const matches = tie.matches || {};
  const first = matches.first, second = matches.second;
  const firstDone = first && first.goalsHome != null && first.goalsAway != null;
  if (!firstDone) {
    return { stage: "first-leg", aggregate: null, penalties: null, advancingTeamId: null };
  }
  const secondDone = second && second.goalsHome != null && second.goalsAway != null;
  if (secondDone) {
    const agg = aggregateFromMatches(matches);
    const hasPenalties = tie.penaltiesHome != null && tie.penaltiesAway != null;
    return {
      stage: "final",
      aggregate: agg ? { teamA: agg.totalA, teamB: agg.totalB } : null,
      // Team-keyed, never leg/home-away-keyed — see comment above.
      penalties: hasPenalties ? { teamA: tie.penaltiesHome, teamB: tie.penaltiesAway } : null,
      advancingTeamId: tie.penaltiesWinnerTeamId || tie.qualifiedTeamId || null,
    };
  }
  if (liveLeg2Goals && liveLeg2Goals.goalsHome != null && liveLeg2Goals.goalsAway != null) {
    // Leg 2: home=teamB, away=teamA — same orientation aggregateFromMatches() uses for "final".
    return {
      stage: "second-leg-live",
      aggregate: { teamA: first.goalsHome + liveLeg2Goals.goalsAway, teamB: first.goalsAway + liveLeg2Goals.goalsHome },
      penalties: null, // penalties are never relevant before the tie is actually decided
      advancingTeamId: null,
    };
  }
  return {
    stage: "second-leg-pending",
    aggregate: { teamA: first.goalsHome, teamB: first.goalsAway },
    penalties: null,
    advancingTeamId: null,
  };
}
// Mesmo cálculo, mas a partir de um palpite (goalsHome/goalsAway "crus", ainda não gravados como
// Match) — usado tanto na pré-visualização ao vivo do formulário de palpite quanto na validação.
function predictedAggFromPicks(format, matchPicks) {
  if (format !== "TWO_LEG") {
    const m = matchPicks.single;
    return m ? { totalA: m.goalsHome, totalB: m.goalsAway } : null;
  }
  const first = matchPicks.first, second = matchPicks.second;
  if (!first || !second) return null;
  return { totalA: first.goalsHome + second.goalsAway, totalB: first.goalsAway + second.goalsHome };
}

// ─── Podium (campeão/vice) a partir da Final ────────────────────────────────
// A Final é sempre partida única com exatamente 1 confronto — campeão é o time classificado
// oficialmente, vice é o outro. Diferente da Copa do Mundo, não existe cascata de fases
// anteriores aqui: cada fase é palpitada e resolvida de forma independente, porque a Copa do
// Brasil sorteia os confrontos reais a cada fase (não é um chaveamento fixo e previsível).
function finalTieEntry(s) {
  const finalTies = s.phases?.final?.ties || {};
  const tieId = Object.keys(finalTies)[0];
  return tieId ? { tieId, tie: finalTies[tieId] } : null;
}
function officialPodium(s) {
  const f = finalTieEntry(s);
  if (!f || !f.tie.qualifiedTeamId) return { champion: null, runnerUp: null };
  const { tie } = f;
  return {
    champion: tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB,
    runnerUp: tie.qualifiedTeamId === "A" ? tie.teamB : tie.teamA,
  };
}
function predictedPodium(entry, s) {
  // A final pode ser REAL (a CBF materializou o jogo) ou VIRTUAL (o participante previu o
  // caminho ate la). O podio sai igual nos dois casos: campeao e vice sao os dois lados da
  // final, decididos pelo palpite. Sem terceiro lugar -- a Copa do Brasil nao tem disputa de 3o,
  // e inventar um transformaria o palpite em outra competicao.
  const picks = entry?.picks || {};
  const f = finalTieEntry(s);
  if (f) {
    const pick = picks.qualified?.[f.tieId];
    if (!pick) return { champion: null, runnerUp: null };
    const { tie } = f;
    return { champion: pick === "A" ? tie.teamA : tie.teamB,
             runnerUp: pick === "A" ? tie.teamB : tie.teamA };
  }
  const virt = virtualDerivedTies(s, "final", picks);
  const entrada = virt.ties[0];
  if (!entrada) return { champion: null, runnerUp: null };
  const [tieId, tie] = entrada;
  const pick = picks.qualified?.[tieId];
  if (!pick) return { champion: null, runnerUp: null };
  return { champion: pick === "A" ? tie.teamA : tie.teamB,
           runnerUp: pick === "A" ? tie.teamB : tie.teamA };
}

// ─── Per-tie picks (palpite por partida) ────────────────────────────────────
function getPickValues() {
  const base = picksAtuais();
  const picks = {
    matches:   { ...(base.matches   || {}) },
    qualified: { ...(base.qualified || {}) },
  };
  $$(".tie-pick-block.open").forEach(block => {
    const tieId  = block.dataset.tieId;
    const format = block.dataset.format;
    const legs   = legsForFormat(format);
    const matchPicks = {};
    let anyFilled = false;
    legs.forEach(leg => {
      const a = block.querySelector(`.pk-goals-home[data-leg="${leg}"]`)?.value;
      const b = block.querySelector(`.pk-goals-away[data-leg="${leg}"]`)?.value;
      if (a === "" && b === "") return;
      anyFilled = true;
      matchPicks[leg] = { goalsHome: parseInt(a, 10), goalsAway: parseInt(b, 10) };
    });
    const qual = block.querySelector(".pk-qualified")?.value || "";
    if (!anyFilled && !qual) { delete picks.matches[tieId]; delete picks.qualified[tieId]; return; }
    picks.matches[tieId] = matchPicks;
    if (qual) picks.qualified[tieId] = qual; else delete picks.qualified[tieId];
  });
  return picks;
}

// Confrontos REAIS presentes no estado canonico (phase.ties) que renderPickForm() pula por
// faltar teamA/teamB local (ver o `if (!tie.teamA || !tie.teamB) return;` la) -- e por isso
// nunca ganham `.tie-pick-block`, ficando invisiveis para getPickValues()/validatePicks() se
// elas so olharem o DOM. Mesmos criterios de fase que renderPickForm usa (fase com sorteio
// registrado, ainda nao totalmente resolvida) -- ties.length>0 exclui fases derivadas/sem
// sorteio, que nunca tem esse problema (seus times vem de virtualDerivedTies(), sempre
// completos quando a topologia e conhecida).
function tiesInvisibleForIncompleteTeams(s) {
  const found = [];
  DATA.phases.forEach(phase => {
    const phaseState = s.phases?.[phase.id] || emptyPhaseState();
    const ties = Object.entries(phaseState.ties || {});
    if (!ties.length || phaseFullyResolved(s, phase.id)) return;
    ties.forEach(([tieId, tie]) => {
      if (tie.qualifiedTeamId) return;   // ja decidido -- nada a apostar, faltar time nao importa
      if (!tie.teamA || !tie.teamB) found.push(tieId);
    });
  });
  return found;
}

// ─── Validation ──────────────────────────────────────────────────────────────
function validatePicks(picks) {
  const errors = [];
  if (tiesInvisibleForIncompleteTeams(state()).length) {
    errors.push(t("errorPicksIncomplete"));
  }
  $$(".tie-pick-block.open").forEach(block => {
    const tieId  = block.dataset.tieId;
    const format = block.dataset.format;
    const legs   = legsForFormat(format);
    const matchPicks = picks.matches[tieId] || {};
    legs.forEach(leg => {
      const m = matchPicks[leg];
      if (!m || !Number.isFinite(m.goalsHome) || !Number.isFinite(m.goalsAway) ||
          m.goalsHome < 0 || m.goalsHome > 20 || m.goalsAway < 0 || m.goalsAway > 20) {
        errors.push(t("errorPicksIncomplete"));
      }
    });
    const agg = predictedAggFromPicks(format, matchPicks);
    if (agg && agg.totalA === agg.totalB && !picks.qualified[tieId]) {
      errors.push(t("errorAdvanceRequired"));
    }
  });
  return [...new Set(errors)];
}

// ─── Render: pick form ───────────────────────────────────────────────────────
// Reescreve os rotulos das vagas derivadas a partir dos palpites que estao na tela.
// So texto: nao recria o formulario, para nao perder foco nem valores digitados.
// Base atual de cada confronto virtual: os dois clubes que o ocupam AGORA. Guardada em memoria
// (nao no palpite salvo) porque descreve o estado da tela, nao uma escolha do participante.
let _baseVirtual = {};

// Palpites que estao na TELA e ainda nao foram salvos.
//
// `renderPickForm()` reconstroi cada campo a partir de `_editingEntry.picks`. Numa entrada nova
// isso e vazio -- entao qualquer re-render APAGAVA o que a pessoa acabou de preencher, inclusive
// o vencedor que o proprio app deduziu do agregado. A propagacao destruia o insumo de que ela
// depende: preenchia as quartas, redesenhava, e a semifinal voltava a "Vencedor de ...".
//
// Este overlay e a memoria da edicao em curso. Nao vai para o banco: `saveEntry()` continua
// lendo `getPickValues()` do DOM no momento de salvar.
let _picksEmMemoria = null;
let _assinaturaPodio = "";

function picksAtuais() {
  return _picksEmMemoria || _editingEntry?.picks || { matches: {}, qualified: {} };
}

function _baseAtual(s, livePicks) {
  const out = {};
  for (const fase of Object.keys(DERIVED_PHASES)) {
    for (const [tieId, tie] of virtualDerivedTies(s, fase, livePicks).ties) {
      out[tieId] = `${tie.teamA}|${tie.teamB}`;
    }
  }
  return out;
}

// Propagacao AO VIVO com INVALIDACAO A JUSANTE.
//
// Trocar o vencedor de um confronto de quartas troca quem ocupa a vaga da semifinal. O palpite
// que estava ali foi feito contra OUTROS dois times: `qualified: "A"` deixa de significar o que
// significava, e o placar idem. Manter aquilo seria transformar um palpite em outro sem a pessoa
// pedir -- pior que apaga-lo, porque parece intencional.
//
// Entao: quando a base de um confronto virtual muda, o palpite dele e o de tudo que depende dele
// sao descartados, e o formulario e redesenhado. So redesenha quando a base MUDA -- digitar
// placar sem alterar o vencedor nao mexe em nada e nao rouba o foco de quem esta digitando.
function atualizaFasesDerivadas() {
  const s = state();
  const live = getPickValues();
  const base = _baseAtual(s, live);

  const mudou = [];
  for (const [tieId, assinatura] of Object.entries(base)) {
    if (_baseVirtual[tieId] && _baseVirtual[tieId] !== assinatura) mudou.push(tieId);
  }
  // Vaga que DEIXOU de estar resolvida tambem invalida: o palpite ficaria orfao.
  for (const tieId of Object.keys(_baseVirtual)) {
    if (!(tieId in base)) mudou.push(tieId);
  }

  // O overlay guarda o que esta na tela AGORA -- inclusive o vencedor deduzido do agregado, que
  // so existe no DOM. Sem isto o re-render abaixo apagaria tudo.
  _picksEmMemoria = live;

  if (mudou.length) {
    const alcance = new Set(mudou);
    // A final depende das duas semifinais: mexeu em qualquer uma, o palpite da final cai junto.
    if (mudou.some(id => id.startsWith("sf-"))) alcance.add("final-1");
    for (const tieId of alcance) {
      delete _picksEmMemoria.matches[tieId];
      delete _picksEmMemoria.qualified[tieId];
      if (_editingEntry?.picks?.matches) delete _editingEntry.picks.matches[tieId];
      if (_editingEntry?.picks?.qualified) delete _editingEntry.picks.qualified[tieId];
    }
  }

  // O PODIO tambem entra na decisao de redesenhar.
  //
  // Escolher o vencedor da final nao muda participante nenhum -- os dois finalistas continuam os
  // mesmos --, entao a comparacao de base acima nao detecta nada e o campeao nunca aparecia.
  // Campeao e vice sao saida derivada como qualquer outra: mudaram, a tela tem de mudar.
  const podio = predictedPodium({ picks: live }, s);
  const assinaturaPodio = `${podio.champion || ""}|${podio.runnerUp || ""}`;

  const precisaRedesenhar = mudou.length > 0 ||
    JSON.stringify(Object.keys(base).sort()) !== JSON.stringify(Object.keys(_baseVirtual).sort()) ||
    assinaturaPodio !== _assinaturaPodio;
  _baseVirtual = base;
  _assinaturaPodio = assinaturaPodio;
  if (precisaRedesenhar) renderPickForm();
}

function renderPickForm() {
  const s    = state();
  const form = $("pickForm");
  if (!form) return;

  let html = "";
  DATA.phases.forEach(phase => {
    const phaseState = s.phases?.[phase.id] || emptyPhaseState();
    let ties = Object.entries(phaseState.ties || {});
    // Mesma ordenação cronológica da aba "Jogos" (ver firstLegKickoffMs()) -- achado por Eduardo
    // (2026-07-14): o fix anterior só cobria "Jogos" (fora deliberadamente do escopo pedido na
    // hora), mas o formulário de Palpites é o que participantes de fato usam, e continuava na
    // ordem crua de inserção. Confrontos sem kickoff conhecido ainda ficam no fim.
    ties.sort(([, tieA], [, tieB]) => {
      const msA = firstLegKickoffMs(tieA, phase.format);
      const msB = firstLegKickoffMs(tieB, phase.format);
      if (msA === null && msB === null) return 0;
      if (msA === null) return 1;
      if (msB === null) return -1;
      return msA - msB;
    });
    // Fases já decididas (todo confronto com qualifiedTeamId) ou já concluídas antes do bolão
    // existir (ver DATA.phasesConcludedNoData) não têm nada a apostar — tiradas do formulário de
    // palpites em vez de mostrar N linhas travadas ou um "aguardando sorteio" enganoso. Ainda
    // aparecem normalmente em "Jogos" para referência.
    if (phaseFullyResolved(s, phase.id)) return;
    if (!ties.length && (DATA.phasesConcludedNoData || []).includes(phase.id)) return;
    html += `<div class="pick-group">
      <div class="pick-group-header champion-header">${esc(phase.name)}</div>`;
    // ── FASE DERIVADA: confrontos VIRTUAIS, palpitaveis como qualquer outro ─────────────────
    //
    // A semifinal e a final do bolao sao PREVISAO. Nao dependem de a CBF ter materializado
    // aqueles jogos: nascem dos vencedores que a pessoa escolheu na tela, agora, sem salvar.
    //
    // Os confrontos virtuais entram na MESMA lista `ties` e atravessam o MESMO renderizador dos
    // confrontos reais -- e por isso ganham bloco de palpite de verdade, e nao um paragrafo
    // decorativo. A versao anterior desenhava so texto: dava para VER a semifinal e nao dava para
    // palpitar nela, que e metade do defeito relatado.
    let pendentesDerivadas = [];
    if (DERIVED_PHASES[phase.id] && !ties.length) {
      // MODELO, nao DOM.
      //
      // `getPickValues()` LE o formulario. Numa renderizacao ele descreve a tela que esta prestes
      // a ser substituida -- e no primeiro render depois de carregar uma entrada essa tela ainda
      // esta VAZIA. Pior: `getPickValues()` APAGA da base todo confronto cujo bloco esta em
      // branco no DOM, entao os palpites recem-carregados eram descartados aqui.
      //
      // O efeito era exatamente o relatado: as quartas voltavam (os blocos leem `picksAtuais()`
      // direto) e semifinal/final/campeao nao (dependiam desta copia ja esvaziada). Salvar
      // funcionava; recarregar perdia o bracket de baixo.
      //
      // `picksAtuais()` e o modelo: overlay da edicao em curso, ou o que veio do servidor. O
      // handler de propagacao grava o overlay ANTES de redesenhar, entao aqui ele tambem esta
      // atualizado -- sem depender de ler um DOM que ja nao vale.
      const virt = virtualDerivedTies(s, phase.id, picksAtuais());
      if (!virt.topologyKnown) {
        // O grupo e o cabecalho JA foram emitidos acima. Abrir outro aqui rendia duas secoes
        // "SEMIFINAL" na tela -- uma do renderizador de fase, outra deste ramo. Cada fase logica
        // tem UM dono de secao, e o dono e o laco de fases.
        html += `<p class="muted small-text">${esc(t("topologyUnpublished"))}</p></div>`;
        return;
      }
      ties = virt.ties;
      pendentesDerivadas = virt.pendentes;
    }

    if (!ties.length && pendentesDerivadas.length) {
      // Nenhum confronto fechado ainda: mostra de QUEM cada vaga depende. Nunca um clube.
      // (Sem reabrir grupo: a secao desta fase ja esta aberta.)
      html += pendentesDerivadas.map(pd => `<p class="muted small-text" data-derived-slot="${esc(pd.slotId)}">
        ${esc(participantLabel(pd.a, predecessorLabel(s, pd.sideA.winnerOf, picksAtuais())))}
        × ${esc(participantLabel(pd.b, predecessorLabel(s, pd.sideB.winnerOf, picksAtuais())))}
      </p>`).join("");
      html += `</div>`;
      return;
    }

    if (!ties.length) {
      // FASE DERIVADA x FASE SORTEADA sao causas DIFERENTES, e o formulario dizia a mesma coisa
      // para as duas: "Aguardando sorteio oficial".
      //
      // Semifinal e final nao tem sorteio proprio -- a composicao vem dos vencedores das quartas.
      // O que falta nelas nao e um sorteio, e o MAPEAMENTO oficial da CBF dizendo qual vencedor
      // ocupa qual vaga. Dizer "aguardando sorteio" ali manda o participante esperar uma coisa
      // que nao vai acontecer, e faz parecer defeito de tela o que e ausencia de dado.
      //
      // Com o mapeamento registrado, as vagas aparecem e sao palpitaveis -- alimentadas pelos
      // palpites de quartas que a pessoa tem na tela, sem salvar. Sem ele, NADA e desenhado: supor
      // qf-1xqf-2 seria fabricar chaveamento oficial.
      html += `<p class="muted small-text">${esc(t("waitingDraw"))}</p></div>`;
      return;
    }
    // Na FINAL ninguem avanca para lugar nenhum: quem vence e CAMPEAO. Rotular a escolha como
    // "quem se classifica" descrevia uma fase seguinte que nao existe -- e o bonus tambem e
    // outro (pódio, nao classificacao).
    const ehFinal = phase.id === "final";
    ties.forEach(([tieId, tie]) => {
      if (!tie.teamA || !tie.teamB) return;
      const savedMatches = picksAtuais().matches?.[tieId] || {};
      const savedQual    = picksAtuais().qualified?.[tieId] || "";

      if (tie.qualifiedTeamId) {
        const winner = tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB;
        html += `<div class="pick-row tie-row locked" id="tie-${esc(tieId)}">
          <div class="tie-locked-note"><span class="tie-locked-score">${esc(tie.teamA)} ${teamLogoImg(tie.teamA)} × ${teamLogoImg(tie.teamB)} ${esc(tie.teamB)} — ${esc(t("gamesAdvances"))}: <b>${esc(winner)}</b></span></div>
        </div>`;
        return;
      }
      if (isPhaseLocked(s, phase.id)) {
        html += `<div class="pick-row tie-row locked" id="tie-${esc(tieId)}">
          <div class="tie-locked-note"><span class="tie-locked-score">${esc(tie.teamA)} ${teamLogoImg(tie.teamA)} <span class="muted">${esc(t("pickNotSubmitted"))}</span> ${teamLogoImg(tie.teamB)} ${esc(tie.teamB)}</span></div>
        </div>`;
        return;
      }

      const legs = legsForFormat(phase.format);
      const legInputs = legs.map(leg => {
        const home = leg === "second" ? tie.teamB : tie.teamA;
        const away = leg === "second" ? tie.teamA : tie.teamB;
        const label = leg === "single" ? "" : leg === "first" ? t("gamesLeg1") : t("gamesLeg2");
        const saved = savedMatches[leg];
        const gA = saved?.goalsHome ?? "", gB = saved?.goalsAway ?? "";
        return `<div class="tie-leg-pick">
          ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
          <div class="tie-inputs">
            <span class="tie-team-name">${esc(home)}</span>
            ${teamLogoImg(home)}
            <input type="number" min="0" max="20" class="pk-goals-home" data-leg="${leg}" value="${esc(gA)}" aria-label="${esc(t("pickAggScoreA"))} ${esc(home)}">
            <span class="tie-x">×</span>
            <input type="number" min="0" max="20" class="pk-goals-away" data-leg="${leg}" value="${esc(gB)}" aria-label="${esc(t("pickAggScoreB"))} ${esc(away)}">
            ${teamLogoImg(away)}
            <span class="tie-team-name">${esc(away)}</span>
          </div>
        </div>`;
      }).join("");
      const aggBlock = phase.format === "TWO_LEG"
        ? `<div class="pick-pts-hint">${esc(t("aggregatePreview"))}: <b class="pk-agg-value">—</b></div>`
        : "";

      html += `<div class="pick-row tie-row open tie-pick-block open" id="tie-${esc(tieId)}" data-tie-id="${esc(tieId)}" data-format="${esc(phase.format)}">
        ${legInputs}
        ${aggBlock}
        <select class="pk-qualified" aria-label="${esc(t(ehFinal ? "pickChampionLabel" : "pickAdvanceLabel"))}">
          <option value="">${esc(t(ehFinal ? "pickSelectChampion" : "pickSelectAdvance"))}</option>
          <option value="A" ${savedQual === "A" ? "selected" : ""}>${esc(tie.teamA)}</option>
          <option value="B" ${savedQual === "B" ? "selected" : ""}>${esc(tie.teamB)}</option>
        </select>
        <span class="pick-pts-hint">${esc(t(ehFinal ? "pickHintFinal" : "pickHintTie"))}</span>
      </div>`;
    });
    html += `</div>`;
  });

  // ── CAMPEAO E VICE ──────────────────────────────────────────────────────────────────────
  //
  // Sai do palpite da final -- real ou virtual, tanto faz. Atualiza sozinho porque o formulario e
  // redesenhado quando a base de um confronto virtual muda; e some sozinho quando um palpite de
  // quartas/semi invalida a final, porque ai `predictedPodium` deixa de resolver.
  //
  // NAO ha terceiro nem quarto lugar: a Copa do Brasil nao tem disputa de 3o. A final resolve
  // exatamente dois lugares, e inventar um terceiro seria pontuar uma competicao que nao existe.
  //
  // Usa as classes que a pagina ja tem (`pick-group`, `champion-header`). Nenhum componente novo.
  if (html) {
    const podio = predictedPodium({ picks: picksAtuais() }, s);
    html += `<div class="pick-group">
      <div class="pick-group-header champion-header">${esc(t("finalOutcomeHeader"))}</div>`;
    if (podio.champion) {
      // AS DUAS POSICOES SAO ROTULADAS. Antes so o vice tinha rotulo, e o campeao aparecia como
      // nome solto: "Palmeiras — VICE-CAMPEÃO: Cruzeiro". Quem le nao tem como saber se o
      // primeiro nome e o campeao ou so o mandante -- a posicao ficava implicita na ordem, e
      // ordem nao e rotulo. Agora cada lado diz o que e.
      //
      // Os emojis sao `aria-hidden`: quem usa leitor de tela ouve "CAMPEÃO: Palmeiras", nao o
      // nome do emoji. O significado esta no texto, o emoji so acompanha.
      html += `<div class="pick-row tie-row locked" id="podio-previsto">
        <div class="tie-locked-note"><span class="tie-locked-score">
          <span class="podio-slot">
            <span class="podio-medal" aria-hidden="true">🏆</span>
            <span class="podio-label">${esc(t("predictedChampion"))}:</span>
            ${teamLogoImg(podio.champion)} <b>${esc(podio.champion)}</b>
          </span>
          <span class="podio-sep" aria-hidden="true">·</span>
          <span class="podio-slot">
            <span class="podio-medal" aria-hidden="true">🥈</span>
            <span class="podio-label">${esc(t("predictedRunnerUp"))}:</span>
            ${teamLogoImg(podio.runnerUp)} <b>${esc(podio.runnerUp)}</b>
          </span>
        </span></div>
      </div>`;
    } else {
      html += `<p class="muted small-text" id="podio-previsto">${esc(t("podiumPending"))}</p>`;
    }
    html += `</div>`;
  }

  form.innerHTML = html || `<p class="muted">${esc(t("pickNoOpenTies"))}</p>`;

  // Base consistente com o que acabou de ser desenhado (o DOM novo ja esta no lugar).
  //
  // Antes a base so era atualizada no handler. Um render vindo de outro caminho -- abrir a
  // entrada, trocar de aba -- deixava base e tela divergentes, e o handler seguinte via "mudou"
  // sem nada ter mudado: redesenhava, o que redisparava, e a interacao oscilava.
  try {
    const liveAgora = getPickValues();
    _baseVirtual = _baseAtual(s, liveAgora);
    const pd = predictedPodium({ picks: liveAgora }, s);
    _assinaturaPodio = `${pd.champion || ""}|${pd.runnerUp || ""}`;
  } catch { /* formulário ainda não montado; a próxima renderização semeia */ }

  // Agregado previsto recalcula ao vivo enquanto o participante digita; "quem se classifica"
  // trava automaticamente quando o agregado previsto não empata (mesma regra da CBF real: só
  // faz sentido escolher manualmente quando o resultado seria decidido nos pênaltis).
  form.querySelectorAll(".tie-pick-block.open").forEach(block => {
    const format    = block.dataset.format;
    const qualSel    = block.querySelector(".pk-qualified");
    const aggValueEl = block.querySelector(".pk-agg-value");
    const update = () => {
      const legs = legsForFormat(format);
      const matchPicks = {};
      let complete = true;
      legs.forEach(leg => {
        const a = block.querySelector(`.pk-goals-home[data-leg="${leg}"]`)?.value;
        const b = block.querySelector(`.pk-goals-away[data-leg="${leg}"]`)?.value;
        if (a === "" || b === "") { complete = false; return; }
        matchPicks[leg] = { goalsHome: parseInt(a, 10), goalsAway: parseInt(b, 10) };
      });
      const agg = complete ? predictedAggFromPicks(format, matchPicks) : null;
      if (aggValueEl) aggValueEl.textContent = agg ? `${agg.totalA} × ${agg.totalB}` : "—";
      if (!agg) { qualSel.disabled = false; return; }
      if (agg.totalA === agg.totalB) {
        qualSel.disabled = false;
      } else {
        qualSel.value = agg.totalA > agg.totalB ? "A" : "B";
        qualSel.disabled = true;
      }
    };
    // Propagacao AO VIVO. Mudar um palpite de quartas tem de mexer na semifinal na hora -- sem
    // salvar, sem recarregar, sem ida ao banco. `Salvar entrada` e persistencia, nao "avancar
    // fase"; quem trata o botao como avanco obriga a gravar bracket pela metade.
    const propagar = () => {
      update();
      atualizaFasesDerivadas();
    };
    block.querySelectorAll(".pk-goals-home, .pk-goals-away").forEach(el => el.addEventListener("input", propagar));
    qualSel?.addEventListener("change", propagar);
    update(); // sincroniza travado/destravado ao carregar (inclusive editando entrada já salva)
  });
}

// ENTRY ROSTER FREEZE: update de uma entrada JÁ existente, fail closed. Se o id sumiu do roster
// ou foi tombstoned, REJEITA — nunca converte uma edição obsoleta em criação (era exatamente o
// que o antigo `else s.entries.push(entry)` fazia: criação disfarçada de edição, furando o
// congelamento). Função pura: devolve o novo array de entries, não muta o estado recebido.
function updateExistingEntry(s, entry) {
  if (new Set(s.deletedIds || []).has(entry.id)) throw new Error("ENTRY_NOT_FOUND_OR_REMOVED");
  const idx = (s.entries || []).findIndex(e => e.id === entry.id);
  if (idx < 0) throw new Error("ENTRY_NOT_FOUND_OR_REMOVED");
  return (s.entries || []).map((e, i) => (i === idx ? entry : e));
}

// ─── Save entry ──────────────────────────────────────────────────────────────
async function saveEntry() {
  // ENTRY ROSTER FREEZE: barra a criação ANTES de qualquer leitura de formulário, alocação de
  // id ou escrita de estado. Editar uma entrada existente (_editingEntry) segue permitido.
  if (!_editingEntry && !isEntryCreationAllowed()) { showToast(t("closed"), "warn"); return; }
  if (isPastEntryCutoff() && !_editingEntry) { showToast(t("closed"), "warn"); return; }
  const entryName     = $("entryName")?.value.trim() || "";
  const payerName     = $("payerName")?.value.trim() || "";
  const email         = $("participantEmail")?.value.trim() || "";
  const paymentMethod = $("paymentMethod")?.value || "";

  // ENTRY ROSTER FREEZE: no self-service congelado a identidade NÃO vem destes inputs — vem de
  // `_editingEntry` (ver a construção de `entry` abaixo). Validar os inputs aqui seria validar
  // valores que o save descarta, e pior: BLOQUEARIA o participante. Os campos ficam readOnly e o
  // select disabled em renderNewEntryCard(), preenchidos a partir da entrada armazenada; se o
  // paymentMethod guardado não casar exatamente com uma das <option> ("CashApp"/"Zelle"/"Venmo"),
  // `select.value` resolve para "" e o alerta abaixo trancaria essa pessoa para fora dos palpites
  // de quartas/semi/final PARA SEMPRE, sem nenhum campo editável para consertar. Como este card é
  // o único caminho restante até a Final, valida-se aqui somente o que o save realmente usa: os
  // palpites. Correção de identidade continua sendo pelo admin.
  const frozenSelfServiceEdit = !!_editingEntry && !isEntryCreationAllowed();
  if (!frozenSelfServiceEdit) {
    if (!entryName) { alert(t("errorEntryName")); return; }
    if (!payerName) { alert(t("requiredPayerName")); return; }
    if (!email || !email.includes("@")) { alert(t("errorEmail")); return; }
    if (!paymentMethod) { alert(t("requiredPaymentMethod")); return; }
  }

  const picks  = getPickValues();
  const errors = validatePicks(picks);
  if (errors.length) { alert(errors.join("\n")); return; }

  const btn = $("saveEntryBtn");
  if (btn) { btn.disabled = true; btn.textContent = t("saving"); }

  // ── CAMINHO SEGURO (2026-08-12) ───────────────────────────────────────────────────────────
  //
  // Com um token de acesso carregado, o palpite vai por `cdb_save_my_picks`: uma RPC estreita
  // que resolve a entrada a partir do TOKEN e nao aceita id de entrada nenhum. O navegador
  // deixa de gravar o documento inteiro -- que era o caminho pelo qual qualquer portador da
  // chave publica podia reescrever palpites, pagamentos, resultados e o sorteio oficial.
  //
  // O servidor tambem e quem decide o prazo: fase sem `cutoffAt` publicado RECUSA, e prazo
  // vencido RECUSA. O relogio do cliente nao participa da decisao.
  if (_accessToken) {
    try {
      const r = await cdbRpc("cdb_save_my_picks", {
        p_token: _accessToken,
        p_client_ref: `${_editingEntry?.id || "x"}:${Date.now()}`,
        p_picks: picks,
      });
      if (btn) { btn.disabled = false; btn.textContent = t("saveEntry"); }
      showToast(t("savedSuccess"), "success");
      await loadRemoteState();
      renderAll();
      return r;
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = t("saveEntry"); }
      console.error("[CDB2026] gravacao segura recusada", err);
      publicaDiagnosticoDeSave(err);
      showToast(t("saveError"), "error");
      return;
    }
  }

  try {
    const wasNew = !_editingEntry;
    const s   = state();
    const now = new Date().toISOString();
    // ENTRY ROSTER FREEZE: no self-service com o roster congelado a IDENTIDADE da entrada é
    // imutável — id, createdAt, entryName, participantEmail, payerName e paymentMethod vêm da
    // entrada armazenada, nunca dos inputs. Trocar entryName mudaria o receiptCode() (que é o
    // código de recuperação do participante) e semanticamente transformaria uma entrada em
    // outra pessoa. Correção administrativa de identidade continua sendo pelo admin
    // (applyAdminMutation "upsert-entry", ramo de update) — não abrimos um bypass público aqui.
    const entry = _editingEntry
      ? (frozenSelfServiceEdit
          ? { ..._editingEntry, picks, updatedAt: now }
          : { ..._editingEntry, entryName, payerName, participantEmail: email, paymentMethod, picks, updatedAt: now })
      : { id: uuid(), entryName, payerName, participantEmail: email, paymentMethod, picks, createdAt: now };

    if (_editingEntry) {
      s.entries = updateExistingEntry(s, entry); // lança ENTRY_NOT_FOUND_OR_REMOVED, sem escrita parcial
    } else {
      s.entries.push(entry);
    }

    saveState(s);

    if (C.emailjs.enabled && window.emailjs) {
      queueReceipt(entry);
    }

    _editingEntry = null;

    _picksEmMemoria = null;   // o overlay pertence a UMA edição
    renderPickForm();
    ["entryName", "payerName", "participantEmail"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    $("paymentMethod") && ($("paymentMethod").value = "");
    renderNewEntryCard(); // edição terminou: com o roster congelado o card volta a ficar oculto

    renderReceiptBox(entry);
    showToast(t("savedSuccess"), "success");
    if (!wasNew) showSection("ranking");
  } catch (err) {
    console.error("[CDB2026] Save error", err);
    if (err && err.message === "ENTRY_NOT_FOUND_OR_REMOVED") {
      // Edição obsoleta: a entrada não existe mais. Nada foi salvo. Devolve o participante ao
      // fluxo de busca em vez de reportar como falha genérica de save.
      _editingEntry = null;
      _picksEmMemoria = null;   // o overlay pertence a UMA edição
      renderNewEntryCard();
      showToast(t("entryGoneOnSave"), "error");
    } else {
      showToast(t("saveError"), "error");
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t("saveEntry"); }
  }
}

// ─── Receipt box ────────────────────────────────────────────────────────────
// Botões "Abrir comprovante"/"Baixar HTML" -- item 9 do CONSISTENCY_MATRIX.md (2026-07-15),
// mesmo padrão da Copa (.receipt-actions, renderLatestReceipt() em bolao/js/app.js). Botões
// recriados a cada render, então os listeners são anexados diretamente aqui (sem delegação
// global) -- mesmo padrão já usado em renderRanking() para data-rank-toggle.
function renderReceiptBox(entry) {
  const box = $("receiptBox");
  if (!box) return;
  const code = receiptCode(entry);
  box.classList.remove("hidden");
  box.innerHTML = `
    <h3>${esc(t("receiptTitle"))}</h3>
    <p>${esc(t("receiptCodeLabel"))}: <code class="receipt-code">${esc(code)}</code></p>
    <p class="muted" style="font-size:12px">${esc(t("receiptSaveHint"))}</p>
    <div class="receipt-actions">
      <button type="button" data-receipt-action="open">${esc(t("openReceipt"))}</button>
      <button type="button" class="secondary" data-receipt-action="download">${esc(t("downloadHtml"))}</button>
    </div>`;
  box.querySelector('[data-receipt-action="open"]')?.addEventListener("click", () => openReceipt(entry.id));
  box.querySelector('[data-receipt-action="download"]')?.addEventListener("click", () => downloadReceipt(entry.id));
}

// ─── Scoring ────────────────────────────────────────────────────────────────
// Versão da REGRA de pontuação (não do site). Serve para uma auditoria conseguir dizer "esta
// entrada foi pontuada sob qual regra" -- ver docs/bolao/adr/ADR-005 e a matriz de
// rastreabilidade. Só muda quando a REGRA muda (valores em config.scoring, critério de
// desempate, ou o que conta como acerto), nunca em refactor. Ao mudar: registre motivo,
// aprovação, impacto e recálculo no CHANGELOG, e atualize o golden master conscientemente.
//   rules-2026-07-13 — modelo por PARTIDA aprovado por Eduardo (10/5/1, tie 5, pódio 30/20),
//                      vigente desde a v3.0 e inalterado por toda a auditoria de 2026-08.
const SCORING_RULE_VERSION = "rules-2026-07-13";

// Pontuação por partida, mutuamente exclusiva (nunca soma exact+result+side na mesma partida) —
// mesmo espírito da Copa do Mundo (matchPoints/scoreEntry em bolao/js/app.js), aplicada aqui a
// cada partida individual (não a um agregado digitado direto — ver CDB2026_RULES_AND_MODEL.md).
function matchPoints(pick, result) {
  if (!pick || !result || result.goalsHome == null || result.goalsAway == null) return null;
  const sc = C.scoring.match;
  if (pick.goalsHome === result.goalsHome && pick.goalsAway === result.goalsAway) {
    return { pts: sc.exact, type: "exact" };
  }
  const pickSign = Math.sign(pick.goalsHome - pick.goalsAway);
  const realSign = Math.sign(result.goalsHome - result.goalsAway);
  if (pickSign === realSign) return { pts: sc.result, type: "result" };
  let pts = 0;
  if (pick.goalsHome === result.goalsHome) pts += sc.side;
  if (pick.goalsAway === result.goalsAway) pts += sc.side;
  return { pts, type: pts > 0 ? "side" : "miss" };
}

function scoreEntry(entry, s) {
  const sc = C.scoring;
  let total = 0;
  const detail = { matches: {}, ties: {} };

  DATA.phases.forEach(phase => {
    const ties = s.phases?.[phase.id]?.ties || {};
    Object.entries(ties).forEach(([tieId, tie]) => {
      const legs = legsForFormat(phase.format);
      const pickMatches = entry.picks?.matches?.[tieId] || {};
      legs.forEach(leg => {
        const r = matchPoints(pickMatches[leg], tie.matches?.[leg]);
        if (!r) return;
        detail.matches[`${tieId}:${leg}`] = r;
        total += r.pts;
      });
      if (tie.qualifiedTeamId) {
        const pickQual = entry.picks?.qualified?.[tieId];
        if (pickQual) {
          const hit = pickQual === tie.qualifiedTeamId;
          detail.ties[tieId] = { pts: hit ? sc.tieBonus : 0, type: hit ? "hit" : "miss" };
          total += detail.ties[tieId].pts;
        }
      }
    });
  });

  const official  = officialPodium(s);
  const predicted = predictedPodium(entry, s);
  if (official.champion && predicted.champion) {
    const hit = predicted.champion === official.champion;
    detail.champion = { pts: hit ? sc.bonus.champion : 0, type: hit ? "exact" : "miss" };
    total += detail.champion.pts;
  }
  if (official.runnerUp && predicted.runnerUp) {
    const hit = predicted.runnerUp === official.runnerUp;
    detail.runnerUp = { pts: hit ? sc.bonus.runnerUp : 0, type: hit ? "exact" : "miss" };
    total += detail.runnerUp.pts;
  }

  return { total, detail };
}
function getActiveScore(entry, s) { return scoreEntry(entry, s); }

/**
 * Explicabilidade da pontuação (auditoria 2026-08, fase 2 §19).
 *
 * Produz a decomposição auditável de UMA entrada: por que cada ponto foi dado, item a item.
 * Um revisor independente precisa conseguir reproduzir um total sem ler o código do motor.
 *
 * REGRA DE OURO: esta função NÃO recalcula nada. Ela consome o `detail` que o próprio
 * `scoreEntry()` já devolve e apenas o traduz para uma forma legível. Uma segunda implementação
 * do cálculo — mesmo "equivalente" — poderia divergir com o tempo, que é exatamente o incidente
 * histórico que originou o `audit_scoring.py` da Copa. Por construção, `total` aqui é o total
 * oficial e a soma de `breakdown[].points` reconcilia com ele (garantido por `reconciles`).
 *
 * @param {object} entry  entrada do participante
 * @param {object} s      estado da competição
 * @returns {{total:number, reconciles:boolean, ruleVersion:string, breakdown:Array<{
 *            ruleId:string, entityType:string, entityId:string, label:string,
 *            expected:(string|null), actual:(string|null), points:number, explanation:string}>}}
 */
function explainScore(entry, s) {
  const { total, detail } = scoreEntry(entry, s);
  const sc = C.scoring;
  const breakdown = [];
  const fmt = m => (m && m.goalsHome != null ? `${m.goalsHome}–${m.goalsAway}` : null);

  DATA.phases.forEach(phase => {
    Object.entries(s.phases?.[phase.id]?.ties || {}).forEach(([tieId, tie]) => {
      legsForFormat(phase.format).forEach(leg => {
        const d = detail.matches?.[`${tieId}:${leg}`];
        if (!d) return; // sem palpite ou sem resultado -> não pontua e não entra na explicação
        const { home, away } = legTeams(tie, leg, tie.matches?.[leg]);
        const legName = leg === "single" ? "" : leg === "first" ? " (ida)" : " (volta)";
        breakdown.push({
          ruleId: `match.${d.type}`,
          entityType: "match",
          entityId: `${tieId}:${leg}`,
          label: `${home} × ${away}${legName}`,
          expected: fmt(entry.picks?.matches?.[tieId]?.[leg]),
          actual: fmt(tie.matches?.[leg]),
          points: d.pts,
          explanation: {
            exact:  `Placar exato — ${sc.match.exact} pts`,
            result: `Resultado certo (vitória/empate/derrota), placar não exato — ${sc.match.result} pts`,
            side:   `Gols de um dos times certos — ${sc.match.side} pt por time acertado`,
            miss:   "Nenhum critério atingido — 0 pt",
          }[d.type] || d.type,
        });
      });
      const dt = detail.ties?.[tieId];
      if (dt) {
        const pick = entry.picks?.qualified?.[tieId];
        const nameOf = side => (side === "A" ? tie.teamA : tie.teamB);
        breakdown.push({
          ruleId: `tie.qualified.${dt.type}`,
          entityType: "tie",
          entityId: tieId,
          label: `Classificado — ${tie.teamA} × ${tie.teamB}`,
          expected: pick ? nameOf(pick) : null,
          actual: nameOf(tie.qualifiedTeamId),
          points: dt.pts,
          explanation: dt.type === "hit"
            ? `Acertou quem se classificou — ${sc.tieBonus} pts`
            : "Errou quem se classificou — 0 pt",
        });
      }
    });
  });

  const official = officialPodium(s);
  const predicted = predictedPodium(entry, s);
  [["champion", "Campeão", sc.bonus.champion], ["runnerUp", "Vice-campeão", sc.bonus.runnerUp]]
    .forEach(([k, label, pts]) => {
      const d = detail[k];
      if (!d) return;
      breakdown.push({
        ruleId: `podium.${k}.${d.type}`,
        entityType: "podium",
        entityId: k,
        label,
        expected: predicted[k],
        actual: official[k],
        points: d.pts,
        explanation: d.type === "exact" ? `Acertou o ${label.toLowerCase()} — ${pts} pts`
                                        : `Errou o ${label.toLowerCase()} — 0 pt`,
      });
    });

  const sum = breakdown.reduce((a, b) => a + b.points, 0);
  // Se isto ficar false, a explicação e o total oficial divergiram -- sinal de bug, não de
  // arredondamento. O chamador deve tratar como erro de integridade, nunca "quase certo".
  return { total, reconciles: sum === total, ruleVersion: SCORING_RULE_VERSION, breakdown };
}

function renderFindEntryCard() {
  const card = $("findEntryCard");
  if (!card) return;
  // ENTRY ROSTER FREEZE: com o roster congelado, "editar entrada" é o ÚNICO caminho de entrada
  // que ainda faz sentido — precisa ficar visível quando há algo a editar.
  //
  // MAS (2026-08-12): a busca casava `participantEmail` no NAVEGADOR, e a projeção sanitizada
  // não traz mais esse campo — corretamente, porque baixar o e-mail dos 12 para localizar 1 era
  // a própria exposição. Com a fase FECHADA não há palpite a editar, então o card só ofereceria
  // um formulário que nunca encontra ninguém: pior que ausente, porque parece quebrado.
  //
  // Enquanto a fase não abre, o card fica oculto. Quando o prazo oficial materializar e a fase
  // abrir, o participante chega pelo link seguro do convite (token → `cdb_my_entry`), não por
  // e-mail digitado — que nunca foi um segredo.
  const faseAberta = activePhaseLifecycle().open;
  card.classList.toggle("hidden",
    !faseAberta || (isEntryCreationAllowed() && !oitavasComplete(state())));
}

// ENTRY ROSTER FREEZE: este card não é só "Nova entrada" — ele contém #paymentBox e #pickForm,
// ou seja, é TAMBÉM o formulário que o participante já cadastrado usa para mandar os palpites de
// quartas/semi/final. Esconder por "roster congelado" sozinho quebrava a continuidade até a
// Final. Regra: aparece se a criação está liberada OU se há uma entrada existente e válida
// carregada para edição. Camada de UI apenas — a garantia real está em saveEntry(),
// updateExistingEntry() e na mutação `upsert-entry`.
function renderNewEntryCard() {
  const card = $("newEntryCard");
  if (!card) return;
  const creating = isEntryCreationAllowed();
  const editing  = !creating && editingEntryIsValid();
  card.classList.toggle("hidden", !(creating || editing));
  // Com o roster congelado o card nunca é "Nova entrada" — é edição dos próprios palpites.
  // renderAll() chama applyI18n() ANTES daqui, então este textContent é o que prevalece.
  const title = $("newEntryTitle");
  if (title) title.textContent = t(creating ? "entryTitle" : "entryTitleEditing");
  // Identidade é imutável no self-service congelado (ver saveEntry) — travar os campos para a
  // UI não aceitar uma edição que seria descartada em silêncio no save.
  ["entryName", "payerName", "participantEmail"].forEach(id => {
    const el = $(id); if (el) el.readOnly = !creating;
  });
  const pm = $("paymentMethod");
  if (pm) pm.disabled = !creating;
}

// ─── Tiebreaker helpers ──────────────────────────────────────────────────────
function hitChampion(detail) { return detail?.champion?.type === "exact" ? 1 : 0; }
function hitRunnerUp(detail) { return detail?.runnerUp?.type === "exact" ? 1 : 0; }
function countExactMatches(detail) { return Object.values(detail?.matches || {}).filter(d => d.type === "exact").length; }

// ─── Email receipt ───────────────────────────────────────────────────────────
let _lastEmailTs = 0;
// Mesma estrutura/CSS visual do comprovante da Copa (receiptHtml() em bolao/js/app.js) e do
// BR2026 -- achado em auditoria (2026-07-14): os três apps tinham um e-mail de comprovante
// visualmente diferente entre si (tabela `border="1"` sem estilo nenhum aqui, tema escuro/Inter
// no BR2026, tema claro/Arial na Copa). Alinhado ao padrão canônico da Copa (tema claro, cartão
// branco, grade `.meta`, código em monospace, tabela com cabeçalho escuro, bloco de destaque
// estilo pódio) -- só o CONTEÚDO muda por torneio (campeão/vice em 2 cartões em vez de 4, placar
// por confronto em vez de partidas do bracket), como previsto em PLATFORM_GOVERNANCE.md
// ("diferenças específicas de torneio devem ser preservadas").
function receiptHtml(entry, s) {
  const rows = [];
  DATA.phases.forEach(phase => {
    // Ordem cronológica real POR PERNA -- ver flatLegsChronological() (achado por Eduardo,
    // 2026-08-02: agrupar ida+volta de um confronto sempre juntas descola da ordem real quando a
    // volta de um confronto acontece antes da ida de outro).
    flatLegsChronological(s, phase).forEach(({ tieId, tie, leg }) => {
      const pickMatches = entry.picks?.matches?.[tieId];
      if (!pickMatches) return;
      const pick = pickMatches[leg];
      if (!pick) return;
      const { home: rHome, away: rAway } = legTeams(tie, leg, tie.matches?.[leg]);
      rows.push(`<tr><td>${esc(rHome)} × ${esc(rAway)}</td><td><b>${pick.goalsHome} × ${pick.goalsAway}</b></td></tr>`);
    });
  });
  const predicted = predictedPodium(entry, s);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(t("receiptTitle"))}</title>
<style>body{font-family:Arial,sans-serif;background:#f4f7fb;margin:0;color:#111}
.doc{max-width:900px;margin:24px auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 8px 40px #0002}
h1{margin:0 0 4px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f1f5f9;border-radius:14px;padding:14px;margin:18px 0}
.code{font-family:monospace;color:#087a35;font-weight:bold}.pod{background:linear-gradient(135deg,#07151c,#0f3b22);color:#fff;border-radius:18px;padding:18px;margin:22px 0}
.pod h2{text-align:center;margin:0 0 14px}.podgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.podcard{border-radius:14px;padding:14px;text-align:center;background:#ffffff18}
.champ{background:#ffd35a;color:#111}.team-name{font-size:22px;font-weight:900;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:10px}td,th{padding:8px 10px;border-bottom:1px solid #dde}
th{background:#07151c;color:#fff;text-align:left}
.notice{background:#fff4cc;border:1px solid #e8c65b;border-radius:12px;padding:12px;margin-top:16px;font-size:13px}
@media print{body{background:#fff}.doc{box-shadow:none;margin:0;border-radius:0;padding:10px}}</style></head>
<body><div class="doc">
<h1>${esc(t("receiptTitle"))}</h1>
<p>${esc(t("receiptIntro"))}</p>
<div class="meta">
<div><b>${esc(t("receiptEntry"))}:</b> ${esc(entry.entryName)}<br>
<b>${esc(t("receiptResponsible"))}:</b> ${esc(entry.payerName || "")}<br>
<b>${esc(t("receiptEmail"))}:</b> ${esc(entry.participantEmail)}</div>
<div><b>${esc(t("receiptPayment"))}:</b> ${esc(entry.paymentMethod || "")}<br>
<b>${esc(t("receiptSentAt"))}:</b> ${formatBrtTimestamp(entry.createdAt)} (BRT)<br>
<b>${esc(t("receiptCodeLabel"))}:</b> <span class="code">${esc(receiptCode(entry))}</span></div></div>
<div class="pod"><h2>${esc(t("pickHintTie") ? "🏆 Palpite final do participante" : "")}</h2><div class="podgrid">
<div class="podcard champ"><div>🥇 ${esc(t("pickLabelChampion"))}</div><div class="team-name">${esc(predicted.champion || "—")}</div></div>
<div class="podcard"><div>🥈 ${esc(t("pickLabelRunnerUp"))}</div><div class="team-name" style="color:#fff">${esc(predicted.runnerUp || "—")}</div></div>
</div></div>
<table><thead><tr><th scope="col">${esc(t("receiptColMatch"))}</th><th scope="col">${esc(t("receiptColScore"))}</th></tr></thead>
<tbody>${rows.join("") || `<tr><td colspan="2">—</td></tr>`}</tbody></table>
<div class="notice">${esc(t("receiptFooterNote"))}</div>
</div></body></html>`;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Abrir comprovante / baixar HTML — item 9 do CONSISTENCY_MATRIX.md (2026-07-15): a Copa sempre
// teve esse fluxo (openReceipt()/downloadReceipt(), bolao/js/app.js) via Blob URL, nunca
// document.write (ver SECURITY.md); CDB2026 só mostrava o código do comprovante em texto, sem
// jeito de abrir/imprimir/baixar. Reaproveita o mesmo receiptHtml() já usado no e-mail.
function openReceipt(id) {
  const e = state().entries.find(x => x.id === id);
  if (!e) return;
  const blob = new Blob([receiptHtml(e, state())], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) { URL.revokeObjectURL(url); alert(t("receiptPopupBlocked")); return; }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

function downloadReceipt(id) {
  const e = state().entries.find(x => x.id === id);
  if (!e) return;
  downloadBlob(`comprovante-${receiptCode(e)}.html`, receiptHtml(e, state()), "text/html");
}

// Fila serial com espaçamento mínimo entre envios. Antes: `if (now - _lastEmailTs <
// limitRateMs) return;` DESCARTAVA o e-mail em silêncio -- e como `_lastEmailTs` é global (não
// por participante), a 2ª entrada salva dentro de 30s (mesmo de outra pessoa) nunca recebia
// comprovante, nem o admin recebia a cópia, enquanto o participante via
// "Palpite salvo! Verifique seu e-mail para o comprovante." Achado na auditoria de 2026-08
// (AUDIT-07). O rate limit continua existindo (proteção de cota do EmailJS, exigida) -- só que
// agora ele ESPERA a janela em vez de jogar o e-mail fora, então a mensagem ao participante
// passa a ser verdadeira. Serial: cada envio só começa quando o anterior terminou.
let _emailQueue = Promise.resolve();
function queueReceipt(entry) {
  _emailQueue = _emailQueue.then(async () => {
    const wait = C.emailjs.limitRateMs - (Date.now() - _lastEmailTs);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    return sendReceipt(entry);
  }).catch(err => console.warn("[CDB2026] queued receipt failed", err));
  return _emailQueue;
}

async function sendReceipt(entry) {
  if (!C.emailjs.enabled || !window.emailjs) return;
  // AUD-01: portão ANTES de qualquer chamada ao provedor. Zero chamadas quando bloqueado.
  var _mail = emailSendAllowed();
  if (!_mail.allowed) {
    console.warn(`[CDB2026] EMAIL_SEND_BLOCKED — ${_mail.reason}. Nenhuma mensagem enviada.`);
    return { status: "EMAIL_SEND_BLOCKED", reason: _mail.reason };
  }

  const s = state();
  const html = receiptHtml(entry, s);
  const code = receiptCode(entry);
  const params = {
    to_email:     entry.participantEmail,
    entry_name:   `Copa do Brasil 2026 — ${emailSubjectSafe(entry.entryName)}`,
    receipt_code: code,
    html_message: html,
  };

  try {
    await window.emailjs.send(C.emailjs.serviceId, C.emailjs.participantTemplateId, params, { publicKey: C.emailjs.publicKey });
    _lastEmailTs = Date.now();
    if (C.adminEmail) {
      await window.emailjs.send(C.emailjs.serviceId, C.emailjs.adminTemplateId, {
        ...params,
        to_email: C.adminEmail,
        entry_name: `Nova entrada — ${emailSubjectSafe(entry.entryName)}`,
      }, { publicKey: C.emailjs.publicKey });
    }
  } catch (err) {
    console.error("[CDB2026] sendReceipt failed:", err);
  }
}

// ─── Countdown ───────────────────────────────────────────────────────────────
function renderCountdown() {
  const box  = $("cutoffCountdown");
  if (!box) return;
  const card = box.closest(".count-card");
  const ms   = entryCutoffMs();
  // Batch 2 — PRECEDÊNCIA EXPLÍCITA. O que importa é: existe prazo de palpite ABERTO agora?
  //   1. Sim (cutoff no futuro)            -> contagem do prazo de palpite (comportamento antigo).
  //   2. Não (sem cutoff OU cutoff vencido) -> o que interessa é o ESTADO DO SORTEIO.
  //
  // Antes daqui o caso 2 só cobria `ms === null`. Com o cutoff da fase ativa JÁ VENCIDO (oitavas
  // encerradas, que é exatamente a situação real ao esperar o sorteio das quartas) o código caía no
  // ramo `diff <= 0` e ESCONDIA a caixa inteira — então a contagem regressiva do sorteio e as
  // mensagens de estado nunca apareciam justamente quando eram úteis. Achado por verificação em
  // browser, não pelos testes unitários: os dois primeiros passavam porque exercitavam a derivação,
  // não a renderização.
  // PRAZO PENDENTE ≠ SORTEIO PENDENTE (2026-08-11).
  //
  // Com o sorteio das quartas já aplicado e a tabela detalhada da CBF ainda não publicada, este
  // bloco caía no ramo "sem cutoff" e exibia "Aguardando sorteio oficial" — afirmando ao
  // participante que o sorteio não tinha acontecido, com os quatro confrontos já em produção e o
  // formulário aberto logo abaixo. Contradição na mesma tela.
  //
  // O estado é derivado, não inferido do cutoff: sorteio validado + fase corrente + prazo ainda
  // desconhecido é ABERTO, e a mensagem tem de dizer a REGRA do prazo, já que a hora exata
  // legitimamente ainda não existe.
  const lcFase = activePhaseLifecycle();
  if (lcFase.state === PHASE_LIFECYCLE.DRAW_LOCKED_CUTOFF_PENDING) {
    // Sorteio feito, tabela detalhada pendente. Nem "aguardando sorteio" (falso: o sorteio
    // aconteceu) nem "palpites abertos" (falso: nao ha prazo, entao nao ha o que abrir).
    card?.classList.remove("hidden");
    box.innerHTML =
      `<div class="count-label">${esc(t("schedulePendingTitle"))}</div>` +
      `<span class="count-pending">${esc(t("schedulePendingRule"))}</span>` +
      `<span class="count-pending-note">${esc(t("schedulePendingNote"))}</span>`;
    return;
  }

  const entryDeadlineOpen = ms !== null && ms - Date.now() > 0;
  if (!entryDeadlineOpen) {
    // A mensagem vem do ESTADO DERIVADO. Antes daqui mostrava sempre o mesmo "waitingDraw" genérico,
    // mesmo quando já existia data oficial marcada
    // — o participante não tinha como saber se faltava a CBF marcar, se o sorteio ia acontecer em 3
    // dias, ou se já ocorreu e faltava publicação. Agora a mensagem vem do estado derivado, e um
    // sorteio AGENDADO ganha contagem regressiva de verdade (mesmo componente .count-grid).
    card?.classList.remove("hidden");
    const lc = drawLifecycle(state());
    if (lc.state === DRAW_LIFECYCLE.SCHEDULED && lc.countdownMs > 0) {
      box.innerHTML = `<div class="count-label">${esc(t("drawCountdownTitle"))}</div>` +
                      countdownTimerHtml(lc.countdownMs);
      return;
    }
    const msgKey = lc.state === DRAW_LIFECYCLE.AWAITING_PUBLICATION ? "drawAwaitingPublication"
                 : lc.state === DRAW_LIFECYCLE.INGESTED ? "drawIngestedPending"
                 : lc.state === DRAW_LIFECYCLE.WAITING ? "drawWaiting"
                 : "waitingDraw";
    box.innerHTML = `<div class="count-label">${esc(t("countdownTitle"))}</div><span class="count-closed">${esc(t(msgKey))}</span>`;
    return;
  }
  // Aqui `entryDeadlineOpen` é true, então `diff > 0` por construção.
  const diff = ms - Date.now();
  // Mesmo padrão da Copa (updateCountdown(), bolao/js/app.js) e do BR2026 (v1.56): esconde a
  // caixa inteira depois do prazo em vez de deixar "Encerrado" solto ocupando o mesmo espaço
  // vazio da contagem regressiva. Eduardo, screenshot do hero pós-prazo: "Pode esconder isso"
  // (2026-07-16, mesmo achado do BR2026 propagado aqui).
  if (diff <= 0) { card?.classList.add("hidden"); return; }
  card?.classList.remove("hidden");
  const d  = Math.floor(diff / 86400000);
  const h  = Math.floor((diff % 86400000) / 3600000);
  const m  = Math.floor((diff % 3600000) / 60000);
  const s  = Math.floor((diff % 60000) / 1000);
  const p2 = n => String(n).padStart(2, "0");
  box.innerHTML = `
    <div class="count-label">${esc(t("countdownTitle"))}</div>
    <div class="count-grid">
      ${d > 0 ? `<div><b>${d}</b><span>${esc(t("countdownDays"))}</span></div>` : ""}
      <div><b>${p2(h)}</b><span>${esc(t("countdownHours"))}</span></div>
      <div><b>${p2(m)}</b><span>${esc(t("countdownMin"))}</span></div>
      <div><b>${p2(s)}</b><span>${esc(t("countdownSec"))}</span></div>
    </div>`;
}

// ─── Render: ranking ─────────────────────────────────────────────────────────
// Rank deve avançar sempre que QUALQUER nível do desempate mudar, não só o total — mesmo padrão
// da Copa (bolao/js/app.js renderRanking(), chave composta `${total}:${exact}:${podiumHits}`).
// Bug real encontrado em auditoria (2026-07-14): comparar só `item.total` deixava duas entradas
// com o mesmo total mas desempate diferente mostrando o MESMO rank/medalha, mesmo com o array
// já ordenado corretamente — afeta diretamente quem aparece como 2º lugar (não há 3º na Copa do
// Brasil, prêmio é só campeão/vice), base do rateio de prêmio.
// Única implementação do desempate — usada tanto pelo Ranking exibido quanto por
// calculateRankingMovement() abaixo, pra baseline-rank e live-rank nunca poderem divergir do que
// a tela realmente mostra (mesma classe de bug do CHANGELOG v4.57 da Copa, evitada aqui por só
// ter UM lugar que sabe ordenar entradas).
function rankEntriesBy(entries, scoreFn) {
  // Sem tiebreak por nome (Z→A) -- Eduardo, 2026-08-01: "O sort z-a não é critério de desempate
  // favor remover, é só cosmético". Nunca afetava o RANK em si (a chave de rank abaixo já só usa
  // total/campeão/vice/placares exatos) -- só decidia qual das entradas genuinamente empatadas
  // aparecia primeiro na lista. Sem esse comparador, Array.sort (estável em JS moderno) preserva
  // a ordem relativa original entre empatados.
  const scored = entries.map(e => ({ e, ...(scoreFn(e) || { total: 0, detail: null }) }))
    .sort((a, b) =>
      b.total - a.total ||
      hitChampion(b.detail) - hitChampion(a.detail) ||
      hitRunnerUp(b.detail) - hitRunnerUp(a.detail) ||
      countExactMatches(b.detail) - countExactMatches(a.detail)
    );
  let rank = 0, prevKey = null;
  return scored.map((item, i) => {
    const key = `${item.total}:${hitChampion(item.detail)}:${hitRunnerUp(item.detail)}:${countExactMatches(item.detail)}`;
    if (key !== prevKey) { rank = i + 1; prevKey = key; }
    return { ...item, rank };
  });
}

function renderRanking() {
  const box = $("rankingList");
  if (!box) return;
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));

  // Mesmo lugar/cálculo da Copa (renderRanking(), bolao/js/app.js) -- achado em auditoria
  // (2026-07-15): o Pot só aparecia na barra de estatísticas de Participantes, sem equivalente
  // na Copa, que mostra no cabeçalho do Ranking.
  const paidCount = entries.filter(e => (s.paid || {})[e.id]).length;
  const potEl = $("potValue");
  // BATCH 5: era `$65` (dólar nu, sem centavos) — agora o formato canônico `US$ 65.00`.
  if (potEl) potEl.textContent = window.BOLAO_MONEY.usd(paidCount * (C.entryFee || 5));

  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }

  // Durante uma janela ao vivo, o total exibido já soma os pontos da(s) partida(s) em
  // andamento (liveScoreEntry()) -- mesmo padrão do BR2026 (currentResultSet(), v1.54): antes
  // disso o Ranking só reagia ao placar DEPOIS que a ESPN marcava o jogo como encerrado, tarde
  // demais pra ser uma "projeção ao vivo" de verdade. A seta de movimento (rankMovementHtml)
  // compara contra a posição oficial (sem o placar ao vivo) -- ver calculateRankingMovement().
  const movement = calculateRankingMovement(entries, s);
  const scored   = rankEntriesBy(entries, e => (_liveTies.length ? liveScoreEntry(e, s) : getActiveScore(e, s)));

  // "Resultado não travado — pontuação provisória" removido (Eduardo, 2026-08-06: "Essa parte
  // não é necessário") -- ao contrário do BR2026 (nota central ao modelo de projeção de liga,
  // ver BR2026_PROJECTION_MODEL.md) e da Copa (só aparece DURANTE uma partida ao vivo), esta
  // nota aqui ficava visível o torneio inteiro sempre que qualquer confronto de qualquer fase
  // ainda não tivesse sido decidido -- ou seja, quase sempre, até a Final terminar. Removida só
  // aqui (contexto diferente, TOURNAMENT_SPECIFIC); resultsProgress() (só existia pra isso)
  // removida junto, sem chamador restante. Padrão do BR2026/Copa não foi tocado.

  // Pago/Pendente é informação de administração do bolão, não do ranking público -- mesmo
  // padrão da Copa (renderRanking(), bolao/js/app.js), que nunca mostrou esse badge na linha do
  // ranking (só existe na aba Participantes). Achado real (2026-07-16, Eduardo: "nao precisa
  // pago e pendente, so para o admin"). "Ver palpites" só faz sentido depois do prazo da fase
  // ativa -- antes disso o botão só levava a uma mensagem "escondido até o prazo"
  // (renderPickDisplay() já protegia o dado, mas o botão continuava visível e clicável sem
  // fazer nada útil).
  const canViewPicks = isPastEntryCutoff();
  box.innerHTML = "";
  scored.forEach(item => {
    const medal   = { 1: "🥇", 2: "🥈", 3: "🥉" }[item.rank] || `${item.rank}`;
    const mv      = movement.get(item.e.id);
    const viewBtn = canViewPicks
      ? `<button type="button" class="secondary small-btn" data-rank-toggle="${esc(item.e.id)}" aria-label="${esc(t("viewPicks"))} — ${esc(item.e.entryName || "")}">${esc(t("viewPicks"))}</button>`
      : "";
    const row = document.createElement("div");
    row.className = "rank-row ranking-row";
    row.dataset.visualRole = "ranking-row";
    // Número puro, sem sufixo " pts" -- mesmo padrão da Copa. A coluna de pontos no mobile tem
    // largura FIXA de 40px (pra o botão "Ver palpites" nunca deslocar conforme o placar tem
    // 1-3 dígitos, ver CSS), dimensionada só pros dígitos. Com "170 pts" a linha quebrava --
    // Eduardo: "Deixe tudo da entrada em uma linha e sem crlf" (2026-07-16, mesmo ajuste no BR2026).
    // Phase 7-FIX: .ranking-row__position/__participant/__name/__score/__actions BEM labels
    // added on the same elements/values — .rank-row/.rank-pos/.points and the existing
    // data-visual-role attributes kept unchanged.
    row.innerHTML = `
      <div class="rank-pos ranking-row__position" data-visual-role="ranking-position">${medal}${rankMovementHtml(mv)}</div>
      <div class="ranking-row__participant"><span class="ranking-row__name"><b data-visual-role="ranking-name">${esc(item.e.entryName)}</b></span></div>
      <div class="points ranking-row__score" data-visual-role="ranking-points">${item.total}</div>
      ${viewBtn.replace('class="secondary small-btn"', 'class="secondary small-btn ranking-row__actions"')}`;
    box.appendChild(row);
    if (canViewPicks) {
      const detail = document.createElement("div");
      detail.className = `card picks-detail${_openRankDetails.has(item.e.id) ? "" : " hidden"}`;
      detail.dataset.visualRole = "ranking-detail";
      detail.dataset.rankDetail = item.e.id;
      detail.innerHTML = renderPickDisplay(item.e, item.detail);
      box.appendChild(detail);
    }
  });

  box.querySelectorAll("[data-rank-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const id  = btn.dataset.rankToggle;
    const det = box.querySelector(`[data-rank-detail="${id}"]`);
    if (!det) return;
    det.classList.toggle("hidden");
    if (det.classList.contains("hidden")) _openRankDetails.delete(id);
    else _openRankDetails.add(id);
  }));
}

function renderPickDisplay(entry, detail) {
  // Achado real (2026-07-14, Eduardo: "ver palpites nao pode estar aberto ate a CDB e o
  // brasileirao iniciarem, senao as pessoas podem copiar") -- mesma proteção que a Copa já tem
  // (hideFuturePicks() em bolao/js/app.js), nunca implementada aqui: nada impedia expandir "Ver
  // palpites" de qualquer entrada a qualquer momento, mesmo antes do prazo da fase ativa --
  // outro participante podia copiar o palpite de alguém antes de enviar o seu. Gate simples e
  // seguro por enquanto: esconde TUDO até o prazo da fase ativa passar (mais restritivo que o
  // necessário quando a fase ativa já avançou além de uma fase antiga já decidida, mas nunca
  // expõe cedo demais -- refino por fase específica fica para uma iteração futura se precisar).
  if (!isPastEntryCutoff()) return `<p class="muted">${esc(t("picksHiddenUntilCutoff"))}</p>`;
  // Achado real (2026-07-14, Eduardo: "a visualizacao de ver palpites da CDB tambem esta
  // inconsistente com a da copa"): esta função usava um card flex-column
  // (.picks-display.cdb-picks/.pick-item/.pick-cell), estrutura totalmente diferente da Copa,
  // que usa <table> dentro de .picks-detail (mesmas classes de CSS: .picks-detail table/th/td,
  // ver bolao/css/styles.css). Reconstruído para usar a MESMA estrutura de tabela -- só o
  // conteúdo muda por torneio (confronto/placar em vez de partida/placar/vencedor do bracket).
  const s = state();
  const ptsCell = d => d
    ? `<b class="pick-pts${d.pts > 0 ? " pos" : ""}">${d.pts > 0 ? "+" + d.pts : "—"}</b>`
    : `<span class="muted">—</span>`;
  const rows = [];
  DATA.phases.forEach(phase => {
    // Ordem cronológica real POR PERNA, não por confronto -- ver flatLegsChronological() (achado
    // por Eduardo, 2026-08-02: agrupar ida+volta de um confronto sempre juntas descolava da ordem
    // real quando a volta de um confronto acontece antes da ida de outro).
    const legs = legsForFormat(phase.format);
    const lastLeg = legs[legs.length - 1];
    const qualifiedTiesEmitted = new Set();
    flatLegsChronological(s, phase).forEach(({ tieId, tie, leg }) => {
      const pickMatches = entry.picks?.matches?.[tieId];
      if (!pickMatches) return;
      const pick = pickMatches[leg];
      if (pick) {
        const d = detail?.matches?.[`${tieId}:${leg}`];
        const { home: pHome, away: pAway } = legTeams(tie, leg, tie.matches?.[leg]);
        const rm = tie.matches?.[leg];
        const realScore = (rm && rm.goalsHome != null && rm.goalsAway != null) ? `${rm.goalsHome} × ${rm.goalsAway}` : "—";
        rows.push(`<tr><td>${esc(pHome)} × ${esc(pAway)}</td><td><b>${pick.goalsHome} × ${pick.goalsAway}</b></td><td>${esc(realScore)}</td><td style="text-align:center">${ptsCell(d)}</td></tr>`);
      }
      if (leg === lastLeg && !qualifiedTiesEmitted.has(tieId)) {
        const pickQual = entry.picks?.qualified?.[tieId];
        if (tie.qualifiedTeamId && pickQual) {
          qualifiedTiesEmitted.add(tieId);
          const d = detail?.ties?.[tieId];
          const teamName = pickQual === "A" ? tie.teamA : tie.teamB;
          const realQualified = tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB;
          rows.push(`<tr><td>${esc(t("pickQualifiedLabel"))}: ${esc(tie.teamA)} × ${esc(tie.teamB)}</td><td>${esc(teamName)}</td><td>${esc(realQualified)}</td><td style="text-align:center">${ptsCell(d)}</td></tr>`);
        }
      }
    });
  });

  const predicted = predictedPodium(entry, s);
  const bonusRow = (label, team, d) => team
    ? `<tr><td>${esc(label)}</td><td>${esc(team)}</td><td>—</td><td style="text-align:center">${ptsCell(d)}</td></tr>`
    : "";

  return `<table><thead><tr><th scope="col">${esc(t("receiptColMatch"))}</th><th scope="col">${esc(t("receiptColScore"))}</th><th scope="col">${esc(t("receiptColReal"))}</th><th scope="col" style="text-align:center">Pts</th></tr></thead>
    <tbody>
      ${bonusRow("🏆 " + t("pickLabelChampion"), predicted.champion, detail?.champion)}
      ${bonusRow("🥈 " + t("pickLabelRunnerUp"), predicted.runnerUp, detail?.runnerUp)}
      ${rows.join("") || `<tr><td colspan="4">${esc(t("pickNoOpenTies"))}</td></tr>`}
    </tbody></table>`;
}

// ─── Render: participants ─────────────────────────────────────────────────────
// Estrutura idêntica à Copa (.rank-row, ícone + nome/pagador/método + chip de status —
// bolao/js/app.js renderParticipants()) -- achado em auditoria (2026-07-15, Eduardo: "as telas
// de participantes e ranking tem formatos... diferentes da Copa" / "tudo precisa permanecer
// 100% igual a nao ser que nao se aplique"). Antes usava .participant-row (componente próprio,
// sem ícone, sem método de pagamento) e uma barra de estatísticas (total/pagas/pot) sem
// equivalente NENHUM na Copa -- removida; o Pot agora vive só no cabeçalho do Ranking
// (#potValue), igual à Copa.
function renderParticipants() {
  const box = $("participantsList");
  if (!box) return;
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }
  box.innerHTML = entries.map(e => {
    const isPaid = (s.paid || {})[e.id];
    return `<div class="rank-row participant-row">
      <div>👤</div>
      <!-- PRIVACIDADE (2026-08-12): a linha mostrava "pagador · metodo de pagamento" para
           qualquer visitante. Quem pagou pela cota de quem, e por qual rail, e informacao
           privada -- e nao ajuda participante nenhum. O status de pagamento ja aparece no
           badge ao lado, que e a unica parte publica util. -->
      <div><b>${esc(e.entryName)}</b></div>
      <span class="${isPaid ? "paid-badge" : "unpaid-badge"}">${esc(isPaid ? t("paid") : t("unpaid"))}</span>
    </div>`;
  }).join("");
}

// ─── Render: payment ─────────────────────────────────────────────────────────
function renderPayment() {
  const box = $("paymentMethods");
  if (!box) return;
  box.innerHTML = Object.entries(C.paymentMethods).map(([method, handle]) => {
    const link = C.paymentLinks?.[method];
    const qr   = zelleQrHtml(method);
    return `<div class="card pay-card">
      <div class="pay-icon">${payIcon(method)}</div>
      <div>
        <strong>${esc(method)}</strong><br>
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(handle)}</a>` : `<span>${esc(handle)}</span>`}
        ${qr}
      </div>
    </div>`;
  }).join("");
}

// Prévia do método de pagamento dentro do formulário de entrada (mostra handle/QR assim que o
// participante seleciona, sem precisar navegar até a aba Pagamento) -- item novo encontrado em
// auditoria (2026-07-15): a Copa tem esse recurso (renderPaymentBox()/#paymentBox,
// bolao/js/app.js) desde sempre, nenhum dos outros dois apps tinha. Portado exatamente.
function renderPaymentBox() {
  const method = $("paymentMethod")?.value;
  const box = $("paymentBox");
  if (!box) return;
  if (!method) { box.innerHTML = ""; return; }
  const handle = esc(C.paymentMethods[method] || "");
  const link = C.paymentLinks?.[method] || "";
  const qr = zelleQrHtml(method);
  box.innerHTML = `<div class="pay-card">
    <div class="pay-icon">${payIcon(method)}</div>
    <div><b>${esc(method)}</b><br><span class="muted">${handle}</span>
    ${link ? `<br><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(t("paymentOpenLink"))}</a>` : ""}${qr}</div></div>`;
}

// ─── Render: rules ───────────────────────────────────────────────────────────
function renderRules() {
  const box = $("rulesContent");
  if (!box) return;
  const sc = C.scoring;
  const pr = C.prizes;
  // data-visual-audit="card-base"/"rules-heading" (PR120-final review item 3): stable,
  // unambiguous selectors for bolao/scripts/audit_visual_consistency.mjs — see the matching
  // comment in bolao/copa2026/js/app.js's renderRules(). Purely additive, no CSS/behavior change.
  box.innerHTML = `
    <div class="card" data-visual-audit="card-base">
      <h3 data-visual-audit="rules-heading">${esc(t("rulesScoring"))}</h3>
      <table class="rules-table">
        <tbody>
          <tr><td>${esc(t("rulesMatchExact"))}</td><td><b>${sc.match.exact}</b></td></tr>
          <tr><td>${esc(t("rulesMatchResult"))}</td><td><b>${sc.match.result}</b></td></tr>
          <tr><td>${esc(t("rulesMatchSide"))}</td><td><b>${sc.match.side}</b> por lado</td></tr>
          <tr><td>${esc(t("rulesTieBonus"))}</td><td><b>${sc.tieBonus}</b></td></tr>
          <tr><td>🏆 Campeão</td><td><b>${sc.bonus.champion}</b></td></tr>
          <tr><td>🥈 Vice-campeão</td><td><b>${sc.bonus.runnerUp}</b></td></tr>
        </tbody>
      </table>
      <p class="muted small-text">${esc(t("rulesScoreNote"))}</p>
      <h3>${esc(t("tbTitle"))}</h3>
      <ol style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.8">
        <li>${esc(t("tbChampion"))}</li>
        <li>${esc(t("tbRunnerUp"))}</li>
        <li>${esc(t("tbExactTies"))}</li>
      </ol>
    </div>
    <div class="card">
      <h3>${esc(t("rulesFormat"))}</h3>
      <p style="font-size:13px">${esc(t("rulesFormatText"))}</p>
      <p style="font-size:13px">${esc(t("rulesPenaltyText"))}</p>
      <p style="font-size:13px">${esc(t("rulesNoAwayGoalsText"))}</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesExampleTwoLegTitle"))}</h3>
      <p style="font-size:13px">${esc(t("rulesExampleTwoLegText"))}</p>
      <h3>${esc(t("rulesExampleSingleTitle"))}</h3>
      <p style="font-size:13px">${esc(t("rulesExampleSingleText"))}</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesPrizes"))}</h3>
      <table class="rules-table">
        <tbody>
          <tr><td>🥇 1º</td><td>${Math.round(pr.first * 100)}%</td></tr>
          <tr><td>🥈 2º</td><td>${Math.round(pr.second * 100)}%</td></tr>
          <tr><td>🥉 3º</td><td>${Math.round(pr.third * 100)}%</td></tr>
        </tbody>
      </table>
      <p class="muted" style="font-size:12px">Entrada: US$ ${C.entryFee}. Pot proporcional ao número de participantes.</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesCutoff"))}</h3>
      <p style="font-size:13px">${esc(t("rulesCutoffText"))}</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesTransparency"))}</h3>
      <p class="muted" style="font-size:12px">${esc(C.transparency.disclaimer)}</p>
    </div>`;
}

// ─── Probabilidades — estimativa por confronto já sorteado ──────────────────
// Mesma matemática (Poisson bivariado + correção Dixon-Coles) usada em bolao/js/app.js (Copa)
// e bolao/br2026/js/app.js (Brasileirão). Diferente do modelo antigo: itera os confrontos
// DINÂMICOS já cadastrados pelo admin (não um bracket fixo) e cobre tanto partida única quanto
// ida+volta, já que a Copa do Brasil tem os dois formatos dependendo da fase.
function poisson(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}
function tauDC(x, y, lA, lB, rho) {
  if (x === 0 && y === 0) return 1 - lA * lB * rho;
  if (x === 0 && y === 1) return 1 + lA * rho;
  if (x === 1 && y === 0) return 1 + lB * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
function matchProb(lambdaHome, lambdaAway) {
  const MAX = 8, RHO = -0.13;
  const grid = [];
  let pA = 0, pD = 0, pB = 0;
  for (let i = 0; i <= MAX; i++) {
    grid[i] = [];
    for (let j = 0; j <= MAX; j++) {
      const p = poisson(lambdaHome, i) * poisson(lambdaAway, j) * tauDC(i, j, lambdaHome, lambdaAway, RHO);
      grid[i][j] = p;
      if (i > j) pA += p; else if (i === j) pD += p; else pB += p;
    }
  }
  const sum = pA + pD + pB || 1;
  return { pA: pA / sum, pD: pD / sum, pB: pB / sum, grid, sum };
}
const HOME_ADV_ELO = 65;
const DEFAULT_STRENGTH = 60;
function teamStrength(name) { return DATA.strength?.[name] ?? DEFAULT_STRENGTH; }
function eloFromStrength(strength) { return 1500 + ((strength ?? 65) - 70) * 10; }
function legLambdas(strengthHome, strengthAway) {
  const TOTAL = 2.5;
  const eloHome = eloFromStrength(strengthHome) + HOME_ADV_ELO;
  const eloAway = eloFromStrength(strengthAway);
  const pWinHome = 1 / (1 + Math.pow(10, (eloAway - eloHome) / 400));
  let lo = 0.1, hi = TOTAL - 0.1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (matchProb(mid, TOTAL - mid).pA < pWinHome) lo = mid; else hi = mid;
  }
  const lambdaHome = (lo + hi) / 2;
  return { lambdaHome, lambdaAway: TOTAL - lambdaHome };
}
// Combina os placares das duas pernas (ou usa a partida única direto) e aplica a regra real
// da CBF: sem gol fora de casa, empate vai para os pênaltis (50/50, imprevisível por modelo
// de gols).
function tieAdvanceProb(nameA, nameB, format) {
  if (format !== "TWO_LEG") {
    const { lambdaHome, lambdaAway } = legLambdas(teamStrength(nameA), teamStrength(nameB));
    const { pA, pD, pB } = matchProb(lambdaHome, lambdaAway);
    return { pHome: pA + pD * 0.5, pAway: pB + pD * 0.5 };
  }
  const leg1 = legLambdas(teamStrength(nameA), teamStrength(nameB));
  const leg2 = legLambdas(teamStrength(nameB), teamStrength(nameA));
  const grid1 = matchProb(leg1.lambdaHome, leg1.lambdaAway).grid;
  const grid2 = matchProb(leg2.lambdaHome, leg2.lambdaAway).grid;
  const MAX = 8;
  let pHome = 0, pDrawAgg = 0, pAway = 0, total = 0;
  for (let a1 = 0; a1 <= MAX; a1++) for (let b1 = 0; b1 <= MAX; b1++) {
    const p1 = grid1[a1][b1];
    if (!p1) continue;
    for (let a2 = 0; a2 <= MAX; a2++) for (let b2 = 0; b2 <= MAX; b2++) {
      const p2 = grid2[a2][b2];
      if (!p2) continue;
      const aggHome = a1 + b2, aggAway = b1 + a2;
      const p = p1 * p2;
      total += p;
      if (aggHome > aggAway) pHome += p;
      else if (aggHome === aggAway) pDrawAgg += p;
      else pAway += p;
    }
  }
  if (total > 0) { pHome /= total; pDrawAgg /= total; pAway /= total; }
  return { pHome: pHome + pDrawAgg * 0.5, pAway: pAway + pDrawAgg * 0.5 };
}
function tieProbBarsHtml(nameA, nameB, format) {
  const { pHome, pAway } = tieAdvanceProb(nameA, nameB, format);
  const hPct = Math.round(pHome * 100), aPct = Math.round(pAway * 100);
  const sA = esc(nameA.length > 14 ? nameA.slice(0, 14) + "…" : nameA);
  const sB = esc(nameB.length > 14 ? nameB.slice(0, 14) + "…" : nameB);
  const label = (pct, name) => `<span class="prob-bar__name">${name} </span><span class="prob-bar__pct">${pct}%</span>`;
  return `<div class="prob-bars" role="group" aria-label="${esc(t("probBarsLabel"))}">
    <div class="prob-bar home" style="width:${hPct}%" title="${esc(nameA)}: ${hPct}%">${label(hPct, sA)}</div>
    <div class="prob-bar away" style="width:${aPct}%" title="${esc(nameB)}: ${aPct}%">${label(aPct, sB)}</div>
  </div>`;
}
function renderProbsSection() {
  const box = $("probsContent");
  if (!box) return;
  // Perf: recomputava a grade de Poisson/Dixon-Coles inteira (busca binária + grade 81 células,
  // por confronto TWO_LEG aberto) a cada renderAll() -- todo resync de 30s, todo save -- mesmo com
  // a aba fora de tela. Achado em auditoria (2026-07-14). showSection() já chama esta função
  // explicitamente ao abrir a aba (linha ~194), então pular aqui não perde nenhuma atualização.
  if (!document.getElementById("probs")?.classList.contains("active")) return;
  const s = state();
  let html = "";
  DATA.phases.forEach(phase => {
    const ties = Object.entries(s.phases?.[phase.id]?.ties || {}).filter(([, tie]) => tie.teamA && tie.teamB);
    if (!ties.length) return;
    const rows = ties.map(([tieId, tie]) => {
      if (tie.qualifiedTeamId) {
        const winner = tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB;
        return `<div class="confronto-card card">
          <div class="confronto-header">${esc(tie.teamA)} ${teamLogoImg(tie.teamA, "match-logo")} × ${teamLogoImg(tie.teamB, "match-logo")} ${esc(tie.teamB)}</div>
          <p class="muted" style="font-size:12px">${esc(t("gamesAdvances"))}: <b>${esc(winner)}</b></p>
        </div>`;
      }
      return `<div class="confronto-card card">
        <div class="confronto-header">${esc(tie.teamA)} ${teamLogoImg(tie.teamA, "match-logo")} × ${teamLogoImg(tie.teamB, "match-logo")} ${esc(tie.teamB)}</div>
        ${tieProbBarsHtml(tie.teamA, tie.teamB, phase.format)}
      </div>`;
    }).join("");
    html += `<h3 class="games-round-header">${esc(phase.name)}</h3>${rows}`;
  });
  box.innerHTML = html || `<p class="muted">${esc(t("waitingDraw"))}</p>`;
}

// ─── Render: games (fases dinâmicas) ─────────────────────────────────────────
// Mesmo formato usado pelo BR2026 (brtLongDate em bolao/br2026/js/app.js) — dia da semana
// abreviado + data + hora, fuso America/Sao_Paulo. Compartilhado entre a aba "Jogos" e o card
// "Próxima partida" (renderNextTieCard()) para o mesmo confronto aparecer com a mesma data nos
// dois lugares.
// Eduardo: "Seria ideal botar o horário brt e est sendo est primeiro para não confundir o
// pessoal" (2026-07-17) — mesmo ajuste do BR2026 (estTimeStr, bolao/br2026/js/app.js): público
// inclui brasileiros morando nos EUA. Usa Intl (America/New_York) em vez de offset fixo -- a
// Copa do Brasil roda o ano inteiro e cruza a virada EDT/EST (novembro).
function estTimeStr(dateStr) {
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })
    .formatToParts(d).find(p => p.type === "timeZoneName")?.value || "ET";
  return `${time} (${tz})`;
}

function fmtDate(dateStr) {
  if (!dateStr) return t("gamesTbd");
  try {
    const brt = new Date(dateStr).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    }) + " BRT";
    return `${estTimeStr(dateStr)} · ${brt}`;
  } catch { return dateStr; }
}

// Caixa de dígitos ao vivo (dias/horas/min/seg) para o card "Próxima partida" -- mesmo algoritmo
// e mesma marcação (.count-grid + variante .four quando há dias) do contador da Copa
// (renderNextMatch() em bolao/js/app.js) e do BR2026 (countdownTimerHtml(), mesmo nome/mesma
// implementação lá). Ver DESIGN_SYSTEM.md -- antes o card só tinha texto estático de data, sem
// contador nenhum, divergência real encontrada por Eduardo.
function countdownTimerHtml(diffMs) {
  if (diffMs <= 0) return `<span class="next-game-live">${esc(t("matchStarted"))}</span>`;
  const totalS = Math.floor(diffMs / 1000);
  const d   = Math.floor(totalS / 86400);
  const h   = Math.floor((totalS % 86400) / 3600);
  const min = Math.floor((totalS % 3600) / 60);
  const sec = totalS % 60;
  const p2  = n => String(n).padStart(2, "0");
  const cells = d > 0
    ? [[d, t("countdownDays")], [p2(h), t("countdownHours")], [p2(min), t("countdownMin")], [p2(sec), t("countdownSec")]]
    : [[p2(h), t("countdownHours")], [p2(min), t("countdownMin")], [p2(sec), t("countdownSec")]];
  return `<div class="count-grid next-game-timer${d > 0 ? " four" : ""}">${
    cells.map(([v, l]) => `<div><b>${v}</b><span>${esc(l)}</span></div>`).join("")
  }</div>`;
}

// Kickoff da perna de ida (ou da partida única em SINGLE_MATCH) -- sempre o primeiro item de
// legsForFormat(format), nunca a volta -- usado só para ORDENAR a aba "Jogos" em ordem
// cronológica (pedido do Eduardo, 2026-07-14), nunca para decidir nada de pontuação/cutoff.
function firstLegKickoffMs(tie, format) {
  const firstLeg = legsForFormat(format)[0];
  const ms = tie.matches?.[firstLeg]?.kickoff ? new Date(tie.matches[firstLeg].kickoff).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// Kickoff de UMA perna específica (não sempre a ida, ao contrário de firstLegKickoffMs acima).
function legKickoffMs(tie, leg) {
  const ms = tie.matches?.[leg]?.kickoff ? new Date(tie.matches[leg].kickoff).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// Lista achatada de {tieId, tie, leg} de todos os confrontos de uma fase, em ordem cronológica
// real POR PERNA (não por confronto) -- achado por Eduardo (2026-08-02, print do "Ver palpites"):
// agrupar ida+volta de um mesmo confronto sempre juntas (como firstLegKickoffMs() faz) descola da
// ordem real sempre que a volta de um confronto acontece antes da ida de outro -- comum em
// mata-mata, onde todas as idas de uma rodada costumam sair antes de qualquer volta começar.
// Usada pelas 3 telas que listam pernas individuais como uma tabela linear (Ver palpites do
// Ranking, comprovante por e-mail, exportação CSV do admin). `renderPickForm()` e
// `renderGamesSection()` continuam agrupadas por confronto de propósito (cada uma é um cartão do
// confronto inteiro, ida e volta juntas por design) -- não têm esse bug, não usam esta função.
function flatLegsChronological(s, phase) {
  const ties = Object.entries(s.phases?.[phase.id]?.ties || {});
  const legs = legsForFormat(phase.format);
  const flat = [];
  ties.forEach(([tieId, tie]) => {
    if (!tie.teamA || !tie.teamB) return;
    legs.forEach(leg => flat.push({ tieId, tie, leg, ms: legKickoffMs(tie, leg) }));
  });
  flat.sort((a, b) => {
    if (a.ms === null && b.ms === null) return 0;
    if (a.ms === null) return 1;
    if (b.ms === null) return -1;
    return a.ms - b.ms;
  });
  return flat;
}

// Chave "tieId:leg" da PRÓXIMA perna ainda não iniciada, em ordem cronológica real (não por
// confronto) -- mesma lógica de flatLegsChronological() (usada por "Ver palpites"/comprovante/
// CSV): sem isso, a primeira perna com classe "pre" em ordem de DOM poderia ser a volta de um
// confronto já iniciado (ida jogada, volta ainda sem data) aparecendo ANTES da ida de outro
// confronto que já tem data mais próxima -- mesmo bug de agrupar por confronto em vez de por
// jogo já corrigido em flatLegsChronological(). Exclui pernas já AO VIVO (_liveTies) mesmo que
// `m.goalsHome` ainda esteja null no estado persistido (só é preenchido quando o jogo termina) --
// igual à Copa (`.game-card[data-state="pre"]` nunca inclui `"in"`) e ao BR2026
// (`.game-card.pre`): o jogo ao vivo já tem destaque próprio no card #liveTieCard do topo, "o
// próximo jogo" aqui é sobre o que ainda não começou. Retorna null se não houver nenhuma perna
// futura conhecida (torneio esperando sorteio, ou todas as fases já decididas).
function nextUpcomingLegKey(s) {
  for (const phase of DATA.phases) {
    const upcoming = flatLegsChronological(s, phase).find(({ tieId, tie, leg }) => {
      const m = tie.matches?.[leg];
      if (!m || !m.kickoff || m.goalsHome != null || isLegPostponed(tieId, leg)) return false;
      return !_liveTies.some(l => l.tieId === tieId && l.leg === leg);
    });
    if (upcoming) return `${upcoming.tieId}:${upcoming.leg}`;
  }
  return null;
}

// Aba "Jogos" -- estrutura de card por CONFRONTO (ida+volta juntas) é intencional e
// TOURNAMENT_SPECIFIC (mata-mata de duas pernas, ao contrário do bracket de partida única da
// Copa/liga do BR2026) — preservada. O que faltava pra bater "look and feel" com a Copa/BR2026
// (Eduardo, 2026-08-02: "devem funcionar da mesma maneira que copa do mundo e ter o mesmo look
// and feel... por default deve ir automaticamente para o próximo jogo"), sem tirar nenhuma
// informação já existente (venue, placar, agregado, "quem avança", chip de adiado):
// 1. Chip de status (.game-status pre/live/post/postponed) em TODA perna, não só nas adiadas --
//    Copa/BR2026 sempre mostram um chip; aqui só o placar/data aparecia, sem rótulo.
// 2. Placar AO VIVO (via _liveTies, populado por pollLiveTies()) refletido aqui também -- antes
//    só a data ficava visível numa perna em andamento, igual a Copa/BR2026 mostram no card do
//    jogo, não só no card "ao vivo" isolado do topo.
// 3. showSection() rola pra próxima perna automaticamente ao abrir a aba (ver nextUpcomingLegKey
//    acima e o `data-next-leg` abaixo) -- mesmo comportamento de "próximo jogo" que Copa
//    (.game-card[data-state="pre"]) e BR2026 (.game-card.pre) já têm.
function renderGamesSection() {
  const box = $("gamesList");
  if (!box) return;
  const s = state();
  const nextKey = nextUpcomingLegKey(s);

  let html = "";
  DATA.phases.forEach(phase => {
    const ties = Object.entries(s.phases?.[phase.id]?.ties || {});
    // Ordem cronológica pela data da ida (ou única) -- confrontos sem kickoff conhecido ainda
    // (aguardando sorteio/data) ficam no fim, na ordem em que já estavam, em vez de embaralhar.
    ties.sort(([, tieA], [, tieB]) => {
      const msA = firstLegKickoffMs(tieA, phase.format);
      const msB = firstLegKickoffMs(tieB, phase.format);
      if (msA === null && msB === null) return 0;
      if (msA === null) return 1;
      if (msB === null) return -1;
      return msA - msB;
    });
    html += `<h3 class="games-round-header" data-visual-role="game-stage">${esc(phase.name)}</h3>`;
    if (!ties.length) {
      // ── Batch 4: fase DERIVADA sem confronto cadastrado ──────────────────────────────────
      // Com topologia oficial registrada, a vaga já EXISTE mesmo sem clube definido — mostrá-la
      // como "Vencedor de X × Y" é informação verdadeira e derivada do estado canônico. SEM
      // topologia registrada nada é desenhado: a alternativa seria supor qf-1×qf-2, que é
      // fabricar chaveamento oficial (mesma classe de erro que inventar confronto).
      if (DERIVED_PHASES[phase.id]) {
        const view = derivedPhaseView(s, phase.id);
        if (!view.topologyKnown) {
          html += `<p class="muted" style="margin-bottom:14px">${esc(t("topologyUnpublished"))}</p>`;
          return;
        }
        html += view.slots.map(slot => `<p class="muted" style="margin-bottom:14px">
          ${esc(participantLabel(slot.sideA, tieDisplayName(s, slot.sideA.winnerOf)))} × ${esc(participantLabel(slot.sideB, tieDisplayName(s, slot.sideB.winnerOf)))}
        </p>`).join("");
        return;
      }
      const msg = (DATA.phasesConcludedNoData || []).includes(phase.id) ? "phaseAlreadyConcluded" : "waitingDraw";
      html += `<p class="muted" style="margin-bottom:14px">${esc(t(msg))}</p>`;
      return;
    }
    // Phase 7-FIX (docs/bolao/CANONICAL_GAME_CARD_SKELETON.md): each leg now renders as its own
    // canonical .game-card (game-card--first-leg / game-card--second-leg for the two-leg case,
    // unmodified single game-card for the Final's single match) — same
    // __header/__metadata/__match/__extension skeleton Copa/BR2026 use, not CDB's own compressed
    // single-line .leg-teams/.leg-info. .tie-group/.tie-group__header wrap the two legs as a PURE
    // grouping container (round name + team names + aggregate/classificado), never restructuring
    // the game-card itself. IND/VOLTA labels now live in each leg's own .game-card__competition
    // (the header slot), not a prefix outside the card.
    html += ties.map(([tieId, tie]) => {
      if (!tie.teamA || !tie.teamB) return "";
      const legs = legsForFormat(phase.format);
      // Computed once, reused by both the second-leg card's __extension (scheduled-state
      // aggregate note) and the tie-group__result line below — same tieProgressDisplay() call,
      // never duplicated.
      const progress = tieProgressDisplay(tie, phase.format);
      const legCardHtml = leg => {
        const m = tie.matches?.[leg];
        if (!m) return "";
        const home = leg === "second" ? tie.teamB : tie.teamA;
        const away = leg === "second" ? tie.teamA : tie.teamB;
        const label = leg === "single" ? "" : leg === "first" ? t("gamesLeg1") : t("gamesLeg2");
        const live = _liveTies.find(l => l.tieId === tieId && l.leg === leg);
        // Item 25 do CONSISTENCY_MATRIX.md (2026-07-15) -- chip de "Adiado" quando a ESPN
        // sinaliza a partida como adiada/cancelada (ver isLegPostponed()/fetchLiveTies()).
        const postponed = m.goalsHome == null && isLegPostponed(tieId, leg);
        const state = postponed ? "postponed" : live ? "live" : m.goalsHome != null ? "post" : "pre";
        const hasScore = live ? true : m.goalsHome != null;
        // PR120-final forensic review: CDB shows either a score OR a date in the same slot
        // (never both) -- same convention as Copa's .game-card__score/.muted placeholder.
        const scoreContent = live
          ? `${live.goalsHome ?? 0} × ${live.goalsAway ?? 0}`
          : m.goalsHome != null
            ? `${m.goalsHome} × ${m.goalsAway}`
            : esc(fmtDate(m.kickoff));
        const statusLabel = state === "postponed" ? t("gamePostponed")
          : state === "live" ? `${t("gameLive")}${live ? " · " + liveClockDisplay(live) : ""}`
          : window.BOLAO_FOOTBALL_LIVE.isFinalMatch({ state }) ? t("gameFinal")
          : t("gamePending");
        const isNext = `${tieId}:${leg}` === nextKey;
        const legVariant = leg === "second" ? " game-card--second-leg" : leg === "first" ? " game-card--first-leg" : "";
        // home-team/away-team/team-name/team-logo data-visual-role kept for the structural
        // auditor — same forensic-review convention as before, just on the new canonical classes.
        return `<div class="game-card${legVariant}${live ? " is-live" : ""}" data-state="${esc(state)}"${isNext ? ' data-next-leg="true"' : ""} data-visual-role="game-card">
          <div class="game-card__header">
            <span class="game-card__competition">${label ? esc(label) : ""}</span>
            <span class="game-card__status"><span class="game-status ${state}" data-visual-role="game-status">${esc(statusLabel)}</span></span>
          </div>
          <div class="game-card__metadata">
            ${m.venue ? `<span class="game-card__venue pill">📍 ${esc(m.venue)}${m.city ? `, ${esc(m.city)}` : ""}</span>` : ""}
          </div>
          <div class="game-card__match">
            <div class="game-card__team game-card__team--home" data-visual-role="home-team"><span class="game-card__team-name team-name" data-visual-role="team-name">${esc(home)}</span><span class="game-card__logo">${teamLogoImg(home, "team-logo", "team-logo")}</span></div>
            <div class="game-card__center"><span class="game-card__score${hasScore ? (live ? " is-live" : "") : " muted"}" data-visual-role="game-score">${scoreContent}</span></div>
            <div class="game-card__team game-card__team--away" data-visual-role="away-team"><span class="game-card__logo">${teamLogoImg(away, "team-logo", "team-logo")}</span><span class="game-card__team-name team-name" data-visual-role="team-name">${esc(away)}</span></div>
          </div>
          <div class="game-card__extension">${
            // "Second leg scheduled" state (Eduardo's aggregate-hero spec item 1): once leg 1 is
            // done and leg 2 hasn't started, show "Agregado após a ida: X–Y" here — the static
            // (non-live) equivalent of the live-hero's "Agregado ao vivo" line, same
            // tieProgressDisplay() data, never a duplicate calculation.
            // Same side-swap bug as the live-hero's "Agregado ao vivo" line (fixed 2026-08-05,
            // see renderLiveTieCard() above) -- this card's own team row (line ~2020) shows
            // home=teamB (left) / away=teamA (right) for leg 2, so the aggregate must print in
            // that same order, not the fixed teamA–teamB order.
            leg === "second" && state === "pre" && progress?.stage === "second-leg-pending" && progress.aggregate
              ? `<span class="game-card__aggregate">${esc(t("gamesAggregate"))} após a ida: <b>${progress.aggregate.teamB} – ${progress.aggregate.teamA}</b></span>`
              : ""
          }</div>
        </div>`;
      };
      // Football-hardening checkpoint E: match score (in legCardHtml above), aggregate,
      // penalties, and advancing team are rendered as STRUCTURALLY SEPARATE elements — each its
      // own <span data-visual-role="..."> — never concatenated into one combined number. This is
      // the exact bug class ("6x5" instead of "aggregate 1x1 + penalties 5x4") this checkpoint
      // exists to prevent; see docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md.
      const resultLine = progress && progress.stage === "final" && progress.advancingTeamId
        ? `<div class="tie-group__result">${
            progress.aggregate
              ? `<span class="tie-group__aggregate" data-visual-role="tie-aggregate">${esc(t("gamesAggregate"))}: <b>${progress.aggregate.teamA} × ${progress.aggregate.teamB}</b></span>`
              : ""
          }${
            progress.penalties
              ? ` <span class="tie-group__penalties" data-visual-role="tie-penalties">${esc(t("gamesPenalties"))}: <b>${progress.penalties.teamA} × ${progress.penalties.teamB}</b></span>`
              : ""
          } — <span class="tie-group__advances" data-visual-role="tie-advances">${esc(t("gamesAdvances"))}: ${esc(progress.advancingTeamId === "A" ? tie.teamA : tie.teamB)}</span></div>`
        : "";
      return `<div class="tie-group" data-visual-role="tie-group">
        <div class="tie-group__header">${esc(tie.teamA)} ${teamLogoImg(tie.teamA, "match-logo")} × ${teamLogoImg(tie.teamB, "match-logo")} ${esc(tie.teamB)}</div>
        ${legs.map(legCardHtml).join("")}
        ${resultLine}
      </div>`;
    }).join("");
  });
  box.innerHTML = html;
}

// ─── Render: próxima partida ───────────────────────────────────────────────────
// Card equivalente ao #nextGameCard do BR2026 (mesmas classes CSS, mesmo formato de data —
// fmtDate() acima) — não existia nenhum aqui antes (achado por Eduardo, 2026-07-14, ver
// DESIGN_SYSTEM.md). Depende de matches[leg].kickoff estar preenchido; hoje isso só acontece via
// sincronização com a ESPN (autoSyncEspn() grava kickoff/venue/city na primeira perna de um
// confronto novo) — não existe ainda um jeito do admin cadastrar kickoff manualmente para um
// confronto adicionado à mão. Fica escondido normalmente até isso acontecer, mesmo comportamento
// de "sem próximo jogo" que a Copa/BR2026 já têm.
function findNextUpcomingMatch(s) {
  let best = null;
  DATA.phases.forEach(phase => {
    Object.values(s.phases?.[phase.id]?.ties || {}).forEach(tie => {
      if (!tie.teamA || !tie.teamB) return;
      legsForFormat(phase.format).forEach(leg => {
        const m = tie.matches?.[leg];
        if (!m || !m.kickoff || m.status === "FINAL") return;
        const kickoffMs = new Date(m.kickoff).getTime();
        if (!Number.isFinite(kickoffMs) || kickoffMs <= Date.now()) return;
        if (!best || kickoffMs < best.kickoffMs) {
          const home = m.homeTeam || (leg === "second" ? tie.teamB : tie.teamA);
          const away = m.awayTeam || (leg === "second" ? tie.teamA : tie.teamB);
          best = { kickoffMs, m, home, away };
        }
      });
    });
  });
  return best;
}

// "YYYY-MM-DD" em BRT, mesmo formato do BR2026 (brtDateKey, bolao/br2026/js/app.js) -- usado só
// pra agrupar partidas por dia, nunca pra exibir direto (fmtDate() já cuida disso).
function brtDateKey(isoStr) {
  const s = new Date(isoStr).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const [dd, mm, yyyy] = s.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

// Todas as partidas futuras que caem no mesmo dia (BRT) da mais próxima -- achado real
// (2026-07-16, Eduardo: "proximo jogo mostra somente um, mas amanha tem mais, mostre proximos
// jogos quando ha mais de um no mesmo dia"). findNextUpcomingMatch() em si não muda (é só "a
// mais próxima"); esta função agrupa por dia em cima do resultado dela.
function findAllUpcomingMatchesOnNextDay(s) {
  const first = findNextUpcomingMatch(s);
  if (!first) return [];
  const dayKey = brtDateKey(new Date(first.kickoffMs).toISOString());
  const all = [];
  DATA.phases.forEach(phase => {
    Object.values(s.phases?.[phase.id]?.ties || {}).forEach(tie => {
      if (!tie.teamA || !tie.teamB) return;
      legsForFormat(phase.format).forEach(leg => {
        const m = tie.matches?.[leg];
        if (!m || !m.kickoff || m.status === "FINAL") return;
        const kickoffMs = new Date(m.kickoff).getTime();
        if (!Number.isFinite(kickoffMs) || kickoffMs <= Date.now()) return;
        if (brtDateKey(m.kickoff) !== dayKey) return;
        const home = m.homeTeam || (leg === "second" ? tie.teamB : tie.teamA);
        const away = m.awayTeam || (leg === "second" ? tie.teamA : tie.teamB);
        all.push({ kickoffMs, m, home, away, phaseName: phase.name });
      });
    });
  });
  return all.sort((a, b) => a.kickoffMs - b.kickoffMs);
}

function renderNextTieCard() {
  const card = $("nextTieCard");
  if (!card) return;
  const s     = state();
  const group = findAllUpcomingMatchesOnNextDay(s);
  if (!group.length) { card.classList.add("hidden"); return; }

  if (group.length > 1) {
    // Contador em dígitos, mesmo componente exato da Copa (countdownTimerHtml() -> .count-grid)
    // -- não texto solto. Eduardo: "A contagem regressiva tem que ser igual copa meu!"
    // (2026-07-17), mesmo ajuste do BR2026.
    const items = group.map(({ m, home, away, kickoffMs, phaseName }) => {
      const diffMs   = kickoffMs - Date.now();
      const timerHtml = countdownTimerHtml(diffMs);
      return `<div class="today-game">
      <div class="next-game-row">
        <div class="next-game-info-block">
          <div class="today-game-teams">${esc(home)} ${teamLogoImg(home, "team-logo")} <span class="next-game-vs">×</span> ${teamLogoImg(away, "team-logo")} ${esc(away)}</div>
          <div class="today-game-time muted">${phaseName ? esc(phaseName) + " · " : ""}${esc(fmtDate(m.kickoff))}</div>
          ${m.venue ? `<div class="next-game-venue">📍 ${esc(m.venue)}${m.city ? `, ${esc(m.city)}` : ""}</div>` : ""}
        </div>
        ${timerHtml}
      </div>
    </div>`;
    }).join("");
    card.innerHTML = `<div class="next-game-card">
      <div class="today-games-header">${esc(t("nextGamesLabel"))}</div>
      ${items}
    </div>`;
    card.classList.remove("hidden");
    return;
  }

  const next = group[0];
  const { m, home, away, phaseName } = next;
  const diffMs    = next.kickoffMs - Date.now();
  const timerHtml = countdownTimerHtml(diffMs);

  card.innerHTML = `<div class="next-game-card">
    <div class="next-game-label">${esc(t("nextGameLabel"))}</div>
    <div class="next-game-row">
      <div class="next-game-info-block">
        <div class="next-game-teams">${esc(home)} ${teamLogoImg(home, "team-logo")} <span class="next-game-vs">×</span> ${teamLogoImg(away, "team-logo")} ${esc(away)}</div>
        ${phaseName ? `<div class="next-game-info">${esc(phaseName)}</div>` : ""}
        <div class="next-game-info">${esc(fmtDate(m.kickoff))}</div>
        ${m.venue ? `<div class="next-game-venue">${esc(m.venue)}${m.city ? `, ${esc(m.city)}` : ""}</div>` : ""}
      </div>
      ${timerHtml}
    </div>
  </div>`;
  card.classList.remove("hidden");
}

// ─── Render: footer ───────────────────────────────────────────────────────────
function renderFooter() {
  const el = $("siteFooterBar");
  if (!el) return;
  const s  = state();
  const ts = s.meta?.updatedAt
    ? formatBrtTimestamp(s.meta.updatedAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  el.textContent = ts ? `${C.siteVersion} · sync ${ts} BRT` : C.siteVersion;
}

// ─── Render: admin ───────────────────────────────────────────────────────────
// Bug real encontrado em auditoria (2026-07-14), classificado CRÍTICO: nem "Fases e confrontos"
// nem "Resultados" tinham qualquer proteção contra o resync de 30s em segundo plano -- diferente
// do formulário de palpite do participante (pickFormIsDirty(), já corrigido). Um admin digitando
// o nome de um time novo, ou lançando o placar real logo após um jogo (sob pressão de tempo, a
// pior hora pra isso acontecer), podia ter o campo apagado por um resync que não tem nada a ver
// com essa ação. Os campos de "adicionar confronto"/placar não têm valor salvo pra comparar (ficam
// sempre em branco depois de salvos com sucesso) -- então "sujo" aqui é simplesmente "tem algo
// digitado, ainda não enviado".
function adminPhasesFormIsDirty() {
  const box = document.getElementById("adminPhases");
  if (!box) return false;
  if ([...box.querySelectorAll(".adm-team-a, .adm-team-b")].some(el => el.value.trim() !== "")) return true;
  const s = state();
  return [...box.querySelectorAll(".admin-phase-block")].some(block => {
    const phaseId = block.dataset.phase;
    const input = block.querySelector(".adm-phase-cutoff");
    if (!input) return false;
    const saved = s.phases?.[phaseId]?.cutoffAt ? toLocalDatetimeValue(s.phases[phaseId].cutoffAt) : "";
    return input.value !== saved;
  });
}
function adminResultsFormIsDirty() {
  const box = document.getElementById("adminResults");
  if (!box) return false;
  return [...box.querySelectorAll(".adm-leg-a, .adm-leg-b")].some(el => el.value.trim() !== "");
}
function renderAdmin() {
  if (!isAdminActive()) return;
  const s = state();
  renderAdminEspnSync(s);
  if (!adminPhasesFormIsDirty()) renderAdminPhases(s);
  if (!adminResultsFormIsDirty()) renderAdminResults(s);
  renderAdminPayments(s);
  renderAdminEntries(s);
  renderAdminAuditLog(s);
}

function renderAdminAuditLog(s) {
  const box = $("adminAuditLog");
  if (!box) return;
  const log = Array.isArray(s.auditLog) ? s.auditLog : [];
  box.innerHTML = `<h3>${esc(t("auditLogTitle"))}</h3>`;
  if (!log.length) { box.innerHTML += `<p class="muted">${esc(t("auditLogEmpty"))}</p>`; return; }
  const rows = log.slice(0, 100).map(entry => {
    // Mesmas duas formas de registro que auditStamp() reconcilia: a do navegador/`_bolao_audit()`
    // traz `action`+`detail`, a de `cdb_apply_operator_mutation()` traz `type`+`payload`. Antes
    // desta linha os 14 registros do servidor nunca chegavam aqui (o merge estourava ou os
    // colapsava); agora chegam, e `entry.action.replace()` estouraria em todos eles.
    const stamp = auditStamp(entry);
    const ts = stamp
      ? new Date(stamp).toLocaleString("pt-BR", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" })
      : "—";
    const d = entry.detail || entry.payload || {};
    const kind = entry.action || entry.type || "?";
    const teams = d.teamA && d.teamB ? `${esc(d.teamA)} × ${esc(d.teamB)}` : "";
    return `<div class="audit-row">
      <div class="audit-meta">
        <span class="muted" style="font-size:11px">${esc(ts)} ET</span>
        <b>${esc(t(`auditAction_${kind.replace(/-/g, "_")}`) || kind)}</b>
        ${teams ? `<span class="muted" style="font-size:12px">${teams}</span>` : ""}
      </div>
      <div style="font-size:11px;color:#667;margin-top:2px;word-break:break-all">${esc(JSON.stringify(d))}</div>
    </div>`;
  }).join("");
  box.innerHTML += rows;
}

// ─── Sincronização com ESPN (automática, sem clique por confronto) ───────────────────────────
// v3.3: a v3.1 exigia um clique de confirmação por confronto — Eduardo pediu para automatizar.
// A única decisão que continua manual é qual fase é "a atual" (s.espnSync.activePhaseId): não
// dá para inferir isso com segurança a partir dos dados da ESPN sem verificação ao vivo (ver
// docs/bolao/CDB2026_RULES_AND_MODEL.md "Sincronização com ESPN"). Com a fase ativa definida,
// confrontos novos são detectados e adicionados sozinhos — sem clique por linha. O que
// continua manual e nunca é automatizado: TRAVAR um resultado (isso decide o pagamento) — essa
// etapa continua exigindo o fluxo existente em "Resultados".
const ESPN_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
let _espnLastAutoSyncAt = 0;
let _espnLastRunSummary = null; // { addedCount, added, lockedCount, locked, filledLegsCount, error, at } | null — só para exibir no admin

// ─── Live match card (2026-07-15) ────────────────────────────────────────────────────────────
// Achado em auditoria comparativa Copa/BR2026/CDB2026 (Eduardo, 2026-07-15): CDB2026 nunca teve
// NENHUMA experiência de "jogo ao vivo" para o participante -- só a sincronização de resultado
// FINAL a cada 5 min (autoSyncEspnFull, acima), que roda em segundo plano e não mostra nada na
// tela enquanto o jogo está em andamento. Como as Oitavas são mata-mata real (jogo dia 1º de
// agosto, com prorrogação/pênaltis genuinamente possíveis), essa era a maior divergência real da
// plataforma vs. a Copa. Eduardo pediu explicitamente "tem que bater exatamente com o da Copa" --
// portado quase literalmente (mesmos nomes de função, mesma lógica de relógio/intervalo/pênaltis)
// de bolao/js/app.js (pollLiveScores/mapEspnToLiveScores/mergeLiveClock/formatMatchClock), ao
// contrário do BR2026 (liga, sem prorrogação/pênaltis reais), aqui o period 3/4/5 IMPORTA de
// verdade -- mantido completo, não simplificado.
const CDB_HALF_BOUNDARIES_MIN = [120, 105, 90, 45];
const CDB_PERIOD_BOUNDARY_MIN = { 1: 45, 2: 90, 3: 105, 4: 120 };
const CDB_MAX_STOPPAGE_SECONDS = 8 * 60;

function cdbFmtClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatMatchClock(totalSeconds, period = null, skipBoundariesUpTo = 0) {
  const totalMinutes = totalSeconds / 60;
  if (period === 5) return cdbFmtClock(totalSeconds); // pênaltis — sem conceito de acréscimo
  const knownBoundary = period != null ? CDB_PERIOD_BOUNDARY_MIN[period] : undefined;
  if (knownBoundary !== undefined) {
    if (totalMinutes <= knownBoundary) return cdbFmtClock(totalSeconds);
    const secsPastBoundary = totalSeconds - knownBoundary * 60;
    // Sem estado de relógio real pra crescer indefinidamente depois do próprio limite do período
    // -- sempre segue direto pro fim do período (intervalo/fim de jogo/pênaltis). Cap real
    // encontrado ao vivo (2026-08-01, Vasco×Fluminense, Oitavas): este teto só existia pra
    // period===4 (prorrogação, bug que a Copa já tinha pegado antes: "120:07 (+1)…" sem fim).
    // O MESMO bug existia sem teto nenhum pros períodos 1/2/3 (tempo normal) -- o relógio ao
    // vivo do CDB2026 mostrou "58:11 (+14)" e continuava subindo DURANTE o intervalo real do
    // jogo, porque nada limitava period===1 do mesmo jeito. Corrigido igual pra qualquer period
    // conhecido, não só o 4.
    if (secsPastBoundary > CDB_MAX_STOPPAGE_SECONDS) {
      return `${cdbFmtClock(knownBoundary * 60 + CDB_MAX_STOPPAGE_SECONDS)} (+${CDB_MAX_STOPPAGE_SECONDS / 60})`;
    }
    const stoppageMin = Math.max(1, Math.ceil(secsPastBoundary / 60));
    return `${cdbFmtClock(totalSeconds)} (+${stoppageMin})`;
  }
  const boundary = CDB_HALF_BOUNDARIES_MIN.find(b => b > skipBoundariesUpTo && totalMinutes > b);
  if (!boundary) return cdbFmtClock(totalSeconds);
  const secsPastBoundary = totalSeconds - boundary * 60;
  if (secsPastBoundary > CDB_MAX_STOPPAGE_SECONDS) return cdbFmtClock(totalSeconds);
  const stoppageMin = Math.max(1, Math.ceil(secsPastBoundary / 60));
  return `${cdbFmtClock(totalSeconds)} (+${stoppageMin})`;
}

// Monotônico: o relógio nunca anda pra trás, a não ser que a ESPN sinalize um reset de período
// legítimo (period mudou, ou o clock caiu perto de 0 vindo de perto de um boundary conhecido).
function mergeLiveClock(fresh, prev) {
  if (fresh.clockPaused) return fresh;
  if (!prev || prev.clockSeconds == null || fresh.clockSeconds == null) return fresh;
  const elapsed = (fresh.pollTime - prev.pollTime) / 1000;
  if (elapsed <= 0) return fresh;
  const extrapolated = prev.clockSeconds + elapsed;
  const behindBy = extrapolated - fresh.clockSeconds;
  if (behindBy <= 0) return fresh;
  if (fresh.period != null && prev.period != null) {
    if (fresh.period !== prev.period) return fresh;
  } else {
    const BOUNDARY_S = [45, 90, 105].map(m => m * 60);
    const nearBoundary = BOUNDARY_S.some(b => prev.clockSeconds >= b - 120);
    const looksLikePeriodReset = fresh.clockSeconds < 120 && nearBoundary;
    if (looksLikePeriodReset) return fresh;
  }
  return { ...fresh, clockSeconds: extrapolated };
}

// Detecta um relógio genuinamente pausado (intervalo, pausa longa, VAR, ou o INTERVALO ENTRE
// PRORROGAÇÃO E PÊNALTIS) a partir de dois polls CRUS -- funciona mesmo quando o texto de status
// da ESPN não bate com nenhuma das regras de reconhecimento de isHalftime/isPenalties.
function detectClockPaused(freshRaw, prevRaw) {
  if (!prevRaw || prevRaw.clockSeconds == null || freshRaw.clockSeconds == null) return false;
  const realElapsed = (freshRaw.pollTime - prevRaw.pollTime) / 1000;
  if (realElapsed < 30) return false;
  const clockDelta = freshRaw.clockSeconds - prevRaw.clockSeconds;
  return clockDelta < realElapsed * 0.3;
}

// Consolidado Fase 2 §5 -- os dois pares de cache abaixo (live clock / raw clock history)
// repetiam o mesmo "try JSON.parse(localStorage.getItem(key)||'{}') catch {}" / "try
// localStorage.setItem(...) catch {}"; só a chave e o valor mudavam entre os dois.
function safeLocalStorageGetJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}"); }
  catch { return {}; }
}
function safeLocalStorageSetJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* storage full/unavailable */ }
}

const CDB_LIVE_CLOCK_CACHE_KEY = "cdb2026_live_clock_cache";
function loadLiveClockCache() { return safeLocalStorageGetJson(CDB_LIVE_CLOCK_CACHE_KEY); }
function saveLiveClockCache(scores) {
  const cache = {};
  for (const [id, ls] of Object.entries(scores)) {
    if (ls.clockSeconds != null) cache[id] = { clockSeconds: ls.clockSeconds, pollTime: ls.pollTime, period: ls.period ?? null };
  }
  safeLocalStorageSetJson(CDB_LIVE_CLOCK_CACHE_KEY, cache);
}

const CDB_LIVE_CLOCK_RAW_CACHE_KEY = "cdb2026_live_clock_raw_cache";
let _cdbRawClockHistory = {};
function loadRawClockCache() { return safeLocalStorageGetJson(CDB_LIVE_CLOCK_RAW_CACHE_KEY); }
function saveRawClockCache(history) { safeLocalStorageSetJson(CDB_LIVE_CLOCK_RAW_CACHE_KEY, history); }

let _liveTies = []; // [{ tieId, tie, phaseId, leg, homeTeam, awayTeam, goalsHome, goalsAway, clockSeconds, pollTime, period, isHalftime, isPenalties, clockPaused, clockStr }]
const LIVE_TIE_POLL_INTERVAL_MS = 60 * 1000; // mesma cadência da Copa/BR2026 -- rápida o bastante pro relógio parecer "ao vivo"

// Pernas (ida/volta) atualmente sinalizadas como adiadas/canceladas pela ESPN -- item 25 do
// CONSISTENCY_MATRIX.md (2026-07-15), portado do BR2026 (fetchSchedule()/`postponed`). Chave
// "tieId:leg", populada/atualizada no mesmo poll de 60s do card ao vivo (pollLiveTies).
let _postponedLegKeys = new Set();
function isLegPostponed(tieId, leg) { return _postponedLegKeys.has(`${tieId}:${leg}`); }

// Casa cada perna (ida/volta) de cada confronto da fase ATIVA com um evento da ESPN, pela mesma
// identidade de mandante já usada em autoSyncEspnResults() (nunca por ordem de data). Roda só
// sobre a fase ativa (s.espnSync.activePhaseId) -- as demais fases não têm jogo "agora". Retorna
// tanto as pernas "in" (ao vivo) quanto as sinalizadas como adiadas/canceladas.
async function fetchLiveTies(s) {
  const phaseId = s.espnSync?.activePhaseId;
  if (!phaseId) return { live: [], postponedKeys: new Set() };
  const candidates = await fetchEspnCandidates();
  if (!candidates) return null;
  const format = getPhaseDef(phaseId)?.format;
  const legs = legsForFormat(format);
  const ties = s.phases?.[phaseId]?.ties || {};
  const found = [];
  const postponedKeys = new Set();
  Object.entries(ties).forEach(([tieId, tie]) => {
    if (!tie.teamA || !tie.teamB || tie.qualifiedTeamId) return;
    legs.forEach(leg => {
      const m = tie.matches?.[leg];
      if (!m || m.goalsHome != null) return; // já tem placar (manual ou auto) — não é "ao vivo"
      const home = leg === "second" ? tie.teamB : tie.teamA;
      const away = leg === "second" ? tie.teamA : tie.teamB;
      const ev = candidates.find(c => c.homeTeam === home && c.awayTeam === away);
      if (!ev) return;
      if (window.BOLAO_FOOTBALL_LIVE.isPostponedMatch(ev)) { postponedKeys.add(`${tieId}:${leg}`); return; }
      if (ev.state !== "in") return;
      found.push({ tieId, tie, phaseId, leg, homeTeam: home, awayTeam: away, ev });
    });
  });
  return { live: found, postponedKeys };
}

async function pollLiveTies() {
  const s = state();
  const result = await fetchLiveTies(s);
  if (result === null) return; // fetch falhou — mantém o último estado conhecido na tela
  const { live: found, postponedKeys } = result;
  _postponedLegKeys = postponedKeys;
  const now = Date.now();
  const prevById = new Map(_liveTies.map(l => [`${l.tieId}:${l.leg}`, l]));
  const clockCache = loadLiveClockCache();
  if (!Object.keys(_cdbRawClockHistory).length) _cdbRawClockHistory = loadRawClockCache();
  const nextRawHistory = {};
  const nextLive = found.map(({ tieId, tie, phaseId, leg, homeTeam, awayTeam, ev }) => {
    const key = `${tieId}:${leg}`;
    // `pollTime` é a hora da OBSERVAÇÃO, não a do fetch. Com snapshot as duas divergem, e é essa
    // divergência que quebra o relógio: buscando o mesmo snapshot duas vezes, `clockSeconds` não
    // muda, e com `pollTime = now` o `detectClockPaused()` via tempo real passando contra relógio
    // parado e declarava PAUSADO — congelando o relógio na tela. Ancorado em `observedAt`
    // (`generatedAt` do snapshot), dois polls do mesmo snapshot dão o mesmo instante, nada é
    // declarado pausado, e o relógio corre a partir da observação real.
    const observedAt = ev.observedAt || now;
    const rawFresh = { clockSeconds: ev.clockSec, pollTime: observedAt, period: ev.period };
    const clockPaused = detectClockPaused(rawFresh, _cdbRawClockHistory[key]);
    if (ev.clockSec != null) nextRawHistory[key] = { clockSeconds: ev.clockSec, pollTime: observedAt };
    const prevMerged = prevById.get(key) || clockCache[key];
    const merged = mergeLiveClock({ clockSeconds: ev.clockSec, pollTime: observedAt, period: ev.period, clockPaused }, prevMerged);
    // Achado por Eduardo (2026-08-02, print): relógio mostrava "90:11 (+1)" com um evento já
    // listado logo abaixo em "90'+5'" -- a ESPN às vezes devolve `status.clock` (usado pro
    // relógio) atrasado em relação ao `clock.value` de cada evento em `details`/`keyEvents`
    // (usado pela lista de lances, extractMatchPlays() acima), mesmo dentro da MESMA resposta —
    // não é um bug de polling/interpolação daqui, é a própria ESPN reportando os dois campos
    // fora de sincronia perto do fim do tempo normal/acréscimos. Sem isso, o relógio dava a
    // entender que um lance "ainda não tinha acontecido" quando ele já estava listado abaixo.
    // Reconciliado: o relógio nunca mostra menos tempo decorrido do que o lance mais recente já
    // confirmado -- só ajusta o número exibido, não mexe em clockPaused/isHalftime/isPenalties.
    const latestPlaySec = (ev.plays && ev.plays.length) ? Math.max(...ev.plays.map(p => p.order || 0)) : null;
    const clockSeconds = (latestPlaySec != null && merged.clockSeconds != null)
      ? Math.max(merged.clockSeconds, latestPlaySec)
      : merged.clockSeconds;
    return {
      tieId, tie, phaseId, leg, homeTeam, awayTeam,
      goalsHome: ev.liveHomeScore, goalsAway: ev.liveAwayScore,
      clockSeconds, pollTime: now, period: ev.period,
      isHalftime: ev.isHalftime, isPenalties: ev.isPenalties, clockPaused,
      clockStr: ev.clockStr || "", plays: ev.plays || [],
    };
  });
  _cdbRawClockHistory = nextRawHistory;
  saveRawClockCache(_cdbRawClockHistory);
  saveLiveClockCache(Object.fromEntries(nextLive.map(l => [`${l.tieId}:${l.leg}`, l])));
  _liveTies = nextLive;
  renderLiveTieCard();
  renderLiveRankingHero();
  renderRanking();
  // Re-renderiza Jogos/Palpites pra refletir uma mudança de status de adiado/cancelado -- barato
  // o bastante (só recomputa HTML a partir do estado já em memória) pra rodar a cada poll de 60s.
  renderGamesSection();
  if (!pickFormIsDirty()) renderPickForm();
  nudgeScrollReflow();
}

// Vários cards (ao vivo, ranking ao vivo, próxima partida, contagem regressiva) aparecem/somem
// dinamicamente a cada poll de 60s -- mesmo achado do BR2026 (Eduardo, screenshot, 2026-07-17:
// "Ainda tem bastante areas em branco ao final da pagina, isso tinha sido corrigido"): quando o
// conteúdo ENCOLHE enquanto a página está rolada perto do final, o Safari no iOS é conhecido por
// não recalcular a área rolável até uma interação nova. `scrollBy(0, 0)` não move a página, só
// força o WebKit a recalcular os limites de rolagem.
function nudgeScrollReflow() {
  requestAnimationFrame(() => { if (window.scrollY > 0) window.scrollBy(0, 0); });
}

// Mesmo padrão de "runningClock" da Copa/BR2026 (ver liveClockDisplay em bolao/br2026/js/app.js):
// num intervalo/pênaltis/pausa real, mostra o rótulo fixo em vez de deixar a interpolação local
// somar segundos através da pausa.
// Mesmo bug corrigido no BR2026 (screenshot de Eduardo, 2026-07-16): "um cronometro mostra só
// minutos e outro mostra minutos e segundos" -- pausado caía pro `l.clockStr` cru da ESPN ("51'",
// só minuto), rodando usava formatMatchClock() ("MM:SS"). Sempre passa por formatMatchClock()
// agora quando `clockSeconds` existe -- pausado só significa não somar o tempo decorrido desde o
// último poll, nunca trocar de formato.
// Teto pra interpolação local em segundos decorridos desde o último poll bem-sucedido -- 3x o
// intervalo normal de poll (60s), folga suficiente pra jitter de rede normal. Sem isso, se UM
// poll de 60s falhar/atrasar silenciosamente (rede, aba em segundo plano, o próprio backend da
// ESPN engasgar) bem no instante em que o jogo entra no intervalo real, `l.isHalftime` fica
// desatualizado (false) indefinidamente e o tick de 1s deste relógio (que só interpola em
// memória, nunca faz rede -- ver o setInterval em init()) soma o tempo decorrido sem limite,
// mesmo com o jogo genuinamente parado. Visto ao vivo (2026-08-01, Vasco×Fluminense): relógio
// "58:11 (+14)" e crescendo, jogo já no intervalo real havia minutos.
const CDB_MAX_INTERPOLATION_MS = 3 * LIVE_TIE_POLL_INTERVAL_MS;
function liveClockDisplay(l) {
  // Mesma semântica compartilhada do BR2026 — ver bolao/shared/js/live_clock.js. Este app tinha
  // o MESMO defeito, por cópia: passado o teto de interpolação, o relógio inteiro virava a
  // mensagem de atraso e o minuto confirmado pela fonte desaparecia da tela.
  const r = window.BOLAO_LIVE_CLOCK.resolveLiveClock(l, {
    maxInterpolationMs: CDB_MAX_INTERPOLATION_MS,
  });
  const S = window.BOLAO_LIVE_CLOCK.STATE;
  if (r.state === S.HALFTIME) return t("liveHalftime");
  if (r.state === S.PENALTIES) return t("livePenalties");
  if (r.state === S.UNKNOWN) return t("liveClockStale");
  return r.seconds != null ? formatMatchClock(r.seconds, l.period ?? null, 0) : l.clockStr;
}

// ─── Live ranking movement ───────────────────────────────────────────────────
// "up and down for the user ranking, yes" (Eduardo, 2026-07-16, depois de confirmar que
// posição de TIME ao vivo não se aplica ao CDB2026 -- mata-mata, sem classificação de liga).
// Reaproveita rankEntriesBy() -- única fonte de desempate, usada tanto pelo Ranking exibido
// quanto por este cálculo, mesmo princípio do BR2026 (calculateRankingMovement() lá).
//
// liveScoreEntry() soma os pontos de partidas AO VIVO (ainda sem placar salvo em
// s.phases[...].matches[leg], por isso scoreEntry() sozinho não os vê) por cima do total
// oficial -- só pontuação por partida (matchPoints()), nunca tenta prever quem se classifica
// ao vivo (isso depende do agregado das duas pernas + prorrogação/pênaltis, especulativo demais
// pra uma perna ainda em andamento). O `detail.matches` injetado mantém countExactMatches()
// consistente mesmo quando a partida ao vivo bate um placar exato do palpite.
function liveScoreEntry(entry, s) {
  const official = scoreEntry(entry, s);
  if (!_liveTies.length) return official;
  let extra = 0;
  const matches = { ...official.detail.matches };
  _liveTies.forEach(l => {
    const pick = entry.picks?.matches?.[l.tieId]?.[l.leg];
    const r = matchPoints(pick, { goalsHome: l.goalsHome, goalsAway: l.goalsAway });
    if (!r) return;
    matches[`${l.tieId}:${l.leg}`] = r;
    extra += r.pts;
  });
  return { total: official.total + extra, detail: { ...official.detail, matches } };
}

function calculateRankingMovement(entries, s) {
  if (!entries.length) return new Map();
  const liveRanked = rankEntriesBy(entries, e => (_liveTies.length ? liveScoreEntry(e, s) : getActiveScore(e, s)));
  if (!_liveTies.length) {
    return new Map(liveRanked.map(x => [x.e.id, { rank: x.rank, total: x.total, previousRank: null, movement: null, status: "unavailable" }]));
  }
  const baseRanked   = rankEntriesBy(entries, e => getActiveScore(e, s));
  const baseRankById = new Map(baseRanked.map(x => [x.e.id, x.rank]));
  return new Map(liveRanked.map(x => {
    const previousRank = baseRankById.has(x.e.id) ? baseRankById.get(x.e.id) : null;
    const movement = previousRank != null ? previousRank - x.rank : null;
    const status = movement == null ? "unavailable" : movement > 0 ? "up" : movement < 0 ? "down" : "same";
    return [x.e.id, { rank: x.rank, total: x.total, previousRank, movement, status }];
  }));
}

// Mesmo glifo/classes/i18n do BR2026 (rankMovementHtml, bolao/br2026/js/app.js) -- nunca
// misturar com o movimento de posição de time (não existe aqui, ver nota acima).
function rankMovementHtml(mv) {
  if (!mv || mv.status === "unavailable") {
    return ` <span class="movement movement-unavailable" title="${esc(t("rankMovementUnavailable"))}"><span class="visually-hidden">${esc(t("rankMovementUnavailable"))}</span>–</span>`;
  }
  if (mv.status === "same") {
    return ` <span class="movement movement-same" title="${esc(t("rankMovementSame"))}"><span class="visually-hidden">${esc(t("rankMovementSame"))}</span>•</span>`;
  }
  const n     = Math.abs(mv.movement);
  const label = (mv.status === "up" ? t("rankMovementUp") : t("rankMovementDown")).replace("{n}", n);
  const glyph = mv.status === "up" ? "▲" : "▼";
  return ` <span class="movement movement-${mv.status}" title="${esc(label)}"><span class="visually-hidden">${esc(label)}</span>${glyph}<span class="movement-n" aria-hidden="true">${n}</span></span>`;
}

// Hero "Ranking ao vivo" -- mesmo padrão visual/UX do BR2026 (#liveRankingHero,
// renderLiveRankingHero() em bolao/br2026/js/app.js v1.55): mostra TODO MUNDO ordenado por
// posição (não só quem se move -- v1.54 do BR2026 filtrava e escondia o topo da lista, corrigido
// depois), dentro de uma caixa com scroll e cabeçalho fixo.
//
// Antes só aparecia com tie(s) ao vivo E pelo menos alguém realmente subindo/descendo. Removido
// em 2026-07-17 (mesmo ajuste do BR2026 v1.65, ver changelog dele — Eduardo, durante um jogo real
// ao vivo do BR2026: "onde está o ranking provisório? Você remove funcionalidades"): a caixa
// sumir bem na hora que tem jogo rolando, só porque ainda ninguém cruzou fronteira nenhuma, era
// pior que mostrar a lista com setas neutras ("–"). Propagado aqui mesmo sem CDB2026 ter tie(s)
// ao vivo agora (Oitavas só começa 1º/ago) -- mesmo padrão de código, mesma decisão de produto.
function renderLiveRankingHero() {
  const card = $("liveRankingHero");
  if (!card) return;
  if (!_liveTies.length) { card.classList.add("hidden"); return; }

  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  if (!entries.length) { card.classList.add("hidden"); return; }

  const movement = calculateRankingMovement(entries, s);
  const scored   = rankEntriesBy(entries, e => liveScoreEntry(e, s));

  const rows = scored.map(item => {
    const mv = movement.get(item.e.id);
    return `<tr>
    <td style="text-align:center">${item.rank}${rankMovementHtml(mv)}</td>
    <td>${esc(item.e.entryName)}</td>
    <td style="text-align:center"><b class="pick-pts pos">${item.total}</b></td>
  </tr>`;
  }).join("");

  card.innerHTML = `
    <div class="live-header">🏆 ${esc(t("liveRankingHeroTitle"))}</div>
    <div class="live-ranking-scroll">
      <table class="live-ranking-table">
        <thead><tr>
          <th scope="col" style="text-align:center">${esc(t("liveRankingHeroPosCol"))}</th>
          <th scope="col">${esc(t("liveRankingHeroEntryCol"))}</th>
          <th scope="col" style="text-align:center">${esc(t("liveRankingHeroPtsCol"))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="footer-note" style="margin-top:8px">${esc(t("liveRankingHeroNote"))}</p>`;
  card.classList.remove("hidden");
}

// Mesma estrutura horizontal da Copa/BR2026 (hero-live-card/.live-top, ver
// bolao/br2026/js/app.js renderLiveCard()) -- Eduardo: "aplicou as mesmas alteracoes na
// CDB2026? PRECISAMOS SER CONSISTENTES!" (2026-07-16). Antes desta mudança o card ao vivo do
// CDB2026 usava a mesma pilha vertical que o BR2026 tinha antes de ser corrigida (achado de
// consistência real, não só um pedido -- ver CONSISTENCY_MATRIX.md). Sem posição de tabela (não
// existe classificação de liga na Copa do Brasil -- mata-mata), sem barras de probabilidade ao
// vivo (CDB2026 não tem um modelo in-play minuto a minuto, só o pré-jogo em matchProb(); não
// inventado aqui pra não misturar feature nova com paridade visual).
const teamColHtml = (teamName) => `<div class="live-team">
  <div class="live-team-logo-box">${teamLogoImg(teamName)}</div>
  <span class="live-team-name">${esc(teamName)}</span>
</div>`;

/**
 * Conteudo do hero quando nao ha perna ao vivo (#246).
 *
 * Compacto e secundario: a degradacao do provedor NAO pode dominar a pagina. A hierarquia continua
 * sendo a partida -- proxima, quando conhecida -- e o aviso de fonte fora vem depois, pequeno.
 */
function renderHeroSemAoVivo(heroEstado, proximo) {
  const HP = (typeof window !== "undefined" && window.BOLAO_FOOTBALL_HERO) || null;
  const S = HP ? HP.HERO : {};
  const estado = heroEstado ? heroEstado.state : "SCHEDULE_UNKNOWN";
  const aviso = heroEstado && heroEstado.degraded
    ? `<div class="live-hero-note">${esc(t("liveDataUnavailable"))}</div>` : "";

  if (estado === S.UPCOMING && proximo) {
    return `<div class="live-hero-idle">
      <div class="live-hero-label">${esc(t("nextMatchLabel"))}</div>
      <div class="live-hero-teams">${esc(proximo.home)} × ${esc(proximo.away)}</div>
      ${proximo.m && proximo.m.kickoff ? `<div class="live-hero-when">${esc(fmtDate(proximo.m.kickoff))}</div>` : ""}
      ${aviso}</div>`;
  }
  return `<div class="live-hero-idle">
    <div class="live-hero-label">${esc(t("nextMatchUnknown"))}</div>
    ${aviso}</div>`;
}

function renderLiveTieCard() {
  const card = $("liveTieCard");
  if (!card) return;

  // ─── #246: o hero EXISTE, sempre ────────────────────────────────────────────────────────────
  //
  // Aqui havia `if (!_liveTies.length) { card.classList.add("hidden"); return; }`. Era um dos seis
  // caminhos independentes que faziam o hero sumir, todos disparados por ausencia de dado do
  // provedor -- gateway fora, cache vencido, cron atrasado, ESPN bloqueando o egresso -- e todos
  // terminando em `hidden`. Nao eram quatro defeitos: um sintoma com quatro gatilhos.
  //
  // O provedor enriquece o hero; nao e dono dele. A politica compartilhada decide o ESTADO, nunca
  // a EXISTENCIA -- existencia nao e decisao. O fallback vem do estado AUTORITATIVO do torneio,
  // que e local e nao depende de rede nenhuma.
  const HP = (typeof window !== "undefined" && window.BOLAO_FOOTBALL_HERO) || null;
  const _s = state();
  const proximo = typeof findNextUpcomingMatch === "function" ? findNextUpcomingMatch(_s) : null;
  const heroEstado = HP ? HP.deriveFootballHeroState({
    liveState: _liveTies.length ? "LIVE_FRESH" : "NO_LIVE_MATCH",
    liveMatches: _liveTies,
    nextMatch: proximo ? { id: `${proximo.home}|${proximo.away}`, homeTeam: proximo.home,
                           awayTeam: proximo.away, kickoff: proximo.m && proximo.m.kickoff } : null,
    recentResult: null,
    // Saude da fonte lida do STORE, que e a autoridade de ciclo de vida do live -- nao de uma
    // variavel paralela. Store ausente (ainda nao iniciado) NAO e fonte fora: e ausencia de
    // informacao, e o hero nao deve anunciar degradacao que nao pode provar.
    sourceOk: (function () {
      if (!_liveStore) return true;
      const st = _liveStore.getState();
      return !st || st.state !== "SOURCE_UNAVAILABLE";
    })(),
  }) : null;
  if (heroEstado) {
    card.dataset.heroPresentation = heroEstado.state;
    card.dataset.heroDegraded = String(heroEstado.degraded);
  }
  card.classList.remove("hidden");

  if (!_liveTies.length) {
    // Sem perna ao vivo o hero continua montado e diz a VERDADE. Nunca inventa confronto, placar
    // ou minuto -- um numero velho apresentado como atual e pior que a ausencia.
    //
    // O try existe porque a versao equivalente do BR2026 quebrou EM PRODUCAO: um helper que so
    // existia no outro app lancou, a atribuicao nunca aconteceu e o hero ficou montado e VAZIO.
    // Aqui o helper esta certo -- mas "hero presente" nao pode depender de nenhuma funcao de
    // formatacao dar certo, entao a protecao vale nos dois lados.
    let html;
    try { html = renderHeroSemAoVivo(heroEstado, proximo); } catch (_) { html = ""; }
    card.innerHTML = html && html.trim()
      ? html
      : `<div class="live-hero-idle"><div class="live-hero-label">${esc(t("nextMatchUnknown"))}</div></div>`;
    return;
  }
  const rows = _liveTies.map(l => {
    const clock = liveClockDisplay(l);
    const playsHtml = livePlaysHtml(l.plays, l.homeTeam, l.awayTeam, `${l.tieId}:${l.leg}`);
    // Local do jogo (venue) removido do modo ao vivo -- Eduardo: "Não precisa mostrar a
    // localização no live mode" (2026-07-17). Fase continua (útil pra saber "que confronto é
    // esse" durante o jogo) -- venue continua aparecendo normalmente no card pré-live.
    const phaseDef = getPhaseDef(l.phaseId);
    const phaseName = phaseDef?.name || "";
    const metaHtml = phaseName ? `<div class="live-match-meta"><span>${esc(phaseName)}</span></div>` : "";
    // Phase 7-FIX aggregate-hero feature: only meaningful once leg 2 is live (leg 1 in progress
    // would just duplicate the live score, per spec — "Jogo de ida" label stays as-is, no
    // aggregate shown). Reuses tieProgressDisplay() — the SAME resolver renderGamesSection()'s
    // confronto result line uses — never recomputed here. .game-card__aggregate uses the shared
    // canonical class/tokens (bolao/shared/css/components.css) even though this specific widget
    // predates the full game-card skeleton migration — Eduardo's instruction was "same canonical
    // card model, don't create a separate CDB variant", not "migrate this whole widget".
    let aggregateHtml = "";
    if (l.leg === "second" && phaseDef?.format === "TWO_LEG" && l.tie) {
      const progress = tieProgressDisplay(l.tie, phaseDef.format, { goalsHome: l.goalsHome, goalsAway: l.goalsAway });
      if (progress?.aggregate) {
        // Bug found by Eduardo (2026-08-05, screenshot): live score row above shows
        // l.homeTeam (left) / l.awayTeam (right), and leg 2 always swaps home=teamB/away=teamA
        // (see tieProgressDisplay()'s "Team-order note" above) -- but this line printed the
        // aggregate as fixed "teamA – teamB", which for a leg-2 live match reads left-to-right
        // as teamA first even though teamB (home) is the one actually shown on the left. Numbers
        // were correct, side was swapped (e.g. Grêmio 1–0 Mirassol live, aggregate showed
        // "1 – 2" under it instead of "2 – 1" -- Grêmio's own 2 total landed under Mirassol).
        // Print in the SAME home(teamB)/away(teamA) order as the score row it sits under.
        aggregateHtml = `<div class="game-card__aggregate" aria-live="polite">${esc(t("gamesAggregate"))} ao vivo: <b>${progress.aggregate.teamB} – ${progress.aggregate.teamA}</b></div>`;
      }
    }
    // BARRAS DE PROBABILIDADE NO CARD AO VIVO (2026-08-07, achado do Eduardo: "quando tem jogo ao
    // vivo ... não mostra as probabilidades igual da copa do mundo mostrava").
    // `tieProbBarsHtml()` já existia neste arquivo, mas era chamada SÓ em renderProbsSection() —
    // renderLiveTieCard() nunca a chamava, então durante um jogo ao vivo as barras simplesmente não
    // existiam aqui, ao contrário da Copa (que chama liveProbBarsHtml(m, live) no card dela).
    //
    // Reusa a MESMA função da aba Probabilidades: um único resolvedor, nenhum cálculo novo e nenhuma
    // segunda fonte de verdade para probabilidade. As barras são de AVANÇO NO CONFRONTO (é o modelo
    // deste torneio: mata-mata), não de resultado da partida isolada — por isso não dependem do
    // placar ao vivo e não piscam a cada tick de relógio.
    const probBarsHtml = (l.tie && l.tie.teamA && l.tie.teamB && phaseDef?.format)
      ? tieProbBarsHtml(l.tie.teamA, l.tie.teamB, phaseDef.format)
      : "";
    return `<div class="live-match">
      <div class="live-top">
        ${teamColHtml(l.homeTeam)}
        <div class="live-score">${l.goalsHome ?? 0}</div>
        <div class="live-center">
          <span class="live-badge">${esc(t("liveNow"))}</span>
          <span class="live-clock">${esc(clock)}</span>
          ${aggregateHtml}
        </div>
        <div class="live-score">${l.goalsAway ?? 0}</div>
        ${teamColHtml(l.awayTeam)}
      </div>
      ${metaHtml}
      ${probBarsHtml}
      ${playsHtml ? `<div class="live-match-detail">${playsHtml}</div>` : ""}
    </div>`;
  }).join("");
  const savedPlaysScroll = captureLivePlaysScroll(card);
  card.innerHTML = `<div class="live-match-grid">${rows}</div>`;
  restoreLivePlaysScroll(card, savedPlaysScroll);
  card.classList.remove("hidden");
}

// Minuto a minuto (gols/cartões/substituições) -- ported from Copa/BR2026 (extractMatchPlays,
// ver bolao/br2026/js/app.js), mesmo comp.details já buscado a cada poll do card ao vivo, com
// fallback para o endpoint de summary por evento (keyEvents, inclui substituições -- ver
// fetchEspnEventSummary) em partidas ao vivo, já que comp.details nunca traz substituições
// (confirmado ao vivo, Final da Copa do Mundo, 2026-07-19, propagado aqui no mesmo dia -- Eduardo:
// "aplicou as mesmas alteracoes na CDB2026? PRECISAMOS SER CONSISTENTES!", 2026-07-16).
// side é "home"/"away" (não "c0"/"c1" da Copa nem A/B) -- mesma convenção já usada pelo resto do
// live-tie code deste arquivo (homeTeam/awayTeam sempre nomes reais, sem resolução de slot de
// bracket como a Copa precisa). Mesmo contrato "falha silenciosa": formato inesperado da ESPN
// degrada pra lista vazia, nunca quebra o placar/relógio ao vivo.
const PLAY_ICON = { goal: "⚽", yellow: "🟨", red: "🟥", sub: "🔄" };
function extractMatchPlays(comp, keyEvents) {
  try {
    const details = Array.isArray(keyEvents) && keyEvents.length
      ? keyEvents
      : (Array.isArray(comp.details) ? comp.details : []);
    const comps = comp.competitors || [];
    const home = comps.find(c => c.homeAway === "home") || comps[0];
    const away = comps.find(c => c.homeAway === "away") || comps[1];
    const plays = [];
    for (const d of details) {
      if (!d) continue;
      const typeText = `${d.type?.text || ""} ${d.type?.name || ""}`;
      const isGoal = d.scoringPlay === true || /goal/i.test(typeText);
      const isRedCard = /red card|second yellow/i.test(typeText);
      const isYellowCard = !isRedCard && /yellow card/i.test(typeText);
      const isSub = /substitution/i.test(typeText);
      let kind = null;
      if (isGoal) kind = "goal";
      else if (isRedCard) kind = "red";
      else if (isYellowCard) kind = "yellow";
      else if (isSub) kind = "sub";
      if (!kind) continue;
      const teamId = d.team?.id;
      let side = null;
      if (teamId != null && home?.team?.id != null && String(teamId) === String(home.team.id)) side = "home";
      else if (teamId != null && away?.team?.id != null && String(teamId) === String(away.team.id)) side = "away";
      if (!side) continue;
      const clockVal = typeof d.clock?.value === "number" ? d.clock.value : null;
      const minute = d.clock?.displayValue || (clockVal != null ? `${Math.floor(clockVal / 60)}'` : "");
      // comp.details lista atletas em athletesInvolved[]; o endpoint de summary usa
      // participants[].athlete -- suporta os dois formatos (mesmo padrão da Copa/BR2026).
      const names = (d.athletesInvolved || (d.participants || []).map(p => p?.athlete))
        .map(a => a?.displayName || a?.shortName)
        .filter(Boolean);
      const text = kind === "sub" ? names.slice(0, 2).join(" ↔ ") : (names[0] || "");
      if (!text && !minute) continue;
      plays.push({ kind, side, minute, text, order: clockVal ?? 0 });
    }
    return plays.sort((a, b) => a.order - b.order);
  } catch (err) {
    console.warn("[CDB2026] extractMatchPlays failed, skipping plays feed for this match", err);
    return [];
  }
}

// A full innerHTML rebuild (o tick de 1s do relógio ao vivo em renderLiveTieCard()) recria cada
// caixa .live-plays do zero, zerando o scrollTop dela -- no meio de uma rolagem isso lê como a
// caixa "puxando pra cima" sozinha, a cada segundo. Mesmo bug e mesmo fix da Copa do Mundo
// (captureLivePlaysScroll/restoreLivePlaysScroll em bolao/copa2026/js/app.js) -- portado aqui
// (Eduardo, 2026-08-02: "Isso foi corrigido na copa do mundo"). A CSS scrollável (.live-plays,
// max-height:100px, overflow-y:auto) já tinha sido portada antes; só faltava isto.
function captureLivePlaysScroll(root) {
  const saved = {};
  root?.querySelectorAll?.(".live-plays[data-plays-match]").forEach(el => {
    if (el.scrollTop > 0) saved[el.dataset.playsMatch] = el.scrollTop;
  });
  return saved;
}
function restoreLivePlaysScroll(root, saved) {
  if (!saved || !Object.keys(saved).length) return;
  root?.querySelectorAll?.(".live-plays[data-plays-match]").forEach(el => {
    const s = saved[el.dataset.playsMatch];
    if (s) el.scrollTop = s;
  });
}

function livePlaysHtml(plays, homeTeam, awayTeam, mid) {
  if (!Array.isArray(plays) || !plays.length) return "";
  const rows = [...plays].reverse().map(p => `<div class="live-plays-row">
    <span class="live-plays-minute">${esc(p.minute || "")}</span>
    <span class="live-plays-icon" aria-hidden="true">${PLAY_ICON[p.kind] || "•"}</span>
    ${teamLogoImg(p.side === "home" ? homeTeam : awayTeam, "team-logo")}
    <span class="live-plays-text">${esc(p.text || "")}</span>
  </div>`).join("");
  return `<div class="live-plays" data-plays-match="${esc(String(mid ?? ""))}">${rows}</div>`;
}

// Supplements comp.details with ESPN's richer per-event summary endpoint (keyEvents, includes
// substitutions — see extractMatchPlays). Same fix as Copa/BR2026, propagated here same day
// (Eduardo: "PRECISAMOS SER CONSISTENTES"). Only called for matches currently live, so a normal
// poll with nothing in progress never adds extra network calls. Fails soft: any error just means
// this cycle falls back to comp.details alone.
// fetchJson() (acima) já generaliza AbortController+timeout — os dois fetches ESPN abaixo
// usavam sua própria cópia manual (mesmo timeout de 10000ms) antes de fetchJson() existir.
// Consolidado Fase 2 §5: mesmo comportamento (mesmo timeout, mesmo catch-e-retorna-null), só a
// duplicação de scaffolding removida.
// APOSENTADA na migração para o snapshot (2026-08-07). Buscava os `keyEvents` por partida no
// endpoint summary da ESPN (o único lugar que traz SUBSTITUIÇÕES; `comp.details` só traz gols e
// cartões). Era chamada só para partidas AO VIVO.
//
// Por que virar no-op em vez de continuar tentando: esta é uma chamada de NAVEGADOR para a ESPN —
// exatamente a dependência que a migração remove, e que a produção já não conseguia completar
// (CORS). Continuar chamando só produziria uma falha por partida ao vivo, por ciclo de poll.
//
// Consequência aceita e registrada: durante um jogo ao vivo o feed de lances mostra gols e cartões
// (de `comp.details`, que o snapshot fornece) e NÃO mostra substituições. `extractMatchPlays()` já
// cai para `comp.details` quando não recebe keyEvents — mesmo comportamento que qualquer falha de
// rede sempre produziu aqui. Restaurar as substituições exige que o provider server-side busque o
// summary por evento (fan-out N+1, hoje deliberadamente fora de escopo — ver o cabeçalho de
// bolao/shared/scripts/espn_provider.py).
async function fetchEspnEventSummary(_eventId) {
  return null;
}

// A ESPN às vezes nomeia um time diferente do nome curado usado em DATA.knownConfrontos/data.js
// -- sem normalizar, TODO casamento por nome (fetchLiveTies, autoSyncEspn, autoSyncEspnResults)
// falha silenciosamente para esse time: nunca aparece "ao vivo", nunca trava resultado
// automaticamente. Achado em produção (2026-08-01, jogo real Vasco×Fluminense ao vivo não
// aparecendo): ESPN devolve "Vasco da Gama", nosso confronto usa "Vasco". Mesmo padrão da
// BR2026 (ESPN_SCOREBOARD_NAME_ALIASES/normalizeEspnTeamName, bolao/br2026/js/app.js) --
// mantido em sincronia à mão se a ESPN mudar/adicionar outro apelido.
const CDB_ESPN_NAME_ALIASES = { "Vasco da Gama": "Vasco" };
function normalizeEspnTeamName(name) { return CDB_ESPN_NAME_ALIASES[name] || name; }

// ─── MIGRAÇÃO PARA O SNAPSHOT SERVER-SIDE (2026-08-07) ──────────────────────
// `C.espn.scoreboardUrl` agora aponta para `data/espn-normalized.json` (mesma origem da página),
// gerado server-side por bolao/shared/scripts/espn_provider.py. O navegador não chama mais
// site.api.espn.com: a ESPN não garante CORS e já nos bloqueou duas vezes (403 por user-agent e,
// depois, TLS nos runners do GitHub).
//
// ADAPTADOR de propósito: o snapshot é achatado (homeTeam/homeScore/state/...), mas TODO o código a
// jusante — autoSyncEspn(), autoSyncEspnResults(), o card ao vivo, extractMatchPlays() — já esperava
// a forma crua da ESPN (`ev.competitions[0].competitors[]`). Reconstruir a forma aqui troca a FONTE
// sem tocar em scoring, em resultado armazenado, nem no invariante de sorteio das quartas.
function snapshotEventsToEspnShape(matches) {
  return matches.map(m => ({
    id: m.id,
    date: m.date,
    competitions: [{
      date: m.date,
      status: {
        clock: m.clockSec, period: m.period, displayClock: m.clockStr,
        type: {
          state: m.state, name: m.statusName, description: m.statusDescription,
          shortDetail: m.statusShortDetail, detail: m.statusDetail, completed: m.completed,
        },
      },
      venue: { fullName: m.venue, address: { city: m.city } },
      competitors: [
        { homeAway: "home", team: { id: m.homeTeamId, displayName: m.homeTeam }, score: m.homeScore, winner: m.homeWinner },
        { homeAway: "away", team: { id: m.awayTeamId, displayName: m.awayTeam }, score: m.awayScore, winner: m.awayWinner },
      ],
      details: m.details || [],
    }],
  }));
}

// ─── HIERARQUIA DE FONTES (LIVE DATA PLANE V2) ──────────────────────────────────────────────
// 1. gateway Ferrari Labs (segundos)  2. snapshot commitado (bootstrap/emergência)
// Mesma implementação do BR2026. O navegador NUNCA fala com a ESPN.
// `_liveObservedAt` descarta resposta atrasada: ordem de chegada não é verdade.
// Carimbo de observacao e fonte vivem no store compartilhado desde F13 -- havia duas verdades
// sobre a mesma coisa, e elas divergiam.
let _liveHealth = { gatewayStatus: "UNKNOWN", lastGatewayOkAt: null, consecutiveFailures: 0, lastError: null };

function publishLiveHealth() {
  try {
    const _st = _liveStore ? _liveStore.getState() : null;
    window.__BOLAO_LIVE_HEALTH__ = {
      version: 1, competition: C.liveGateway?.competition || "cdb2026",
      gateway: { enabled: !!C.liveGateway?.enabled, status: _liveHealth.gatewayStatus,
                 lastOkAt: _liveHealth.lastGatewayOkAt, consecutiveFailures: _liveHealth.consecutiveFailures,
                 lastError: _liveHealth.lastError },
      source: _st ? _st.source : "none",
      observedAt: _st ? _st.observedAt : null,
      ageSeconds: _st && _st.ageMs != null ? Math.round(_st.ageMs / 1000) : null,
    };
  } catch { /* diagnóstico nunca derruba o app */ }
}

// ─── AQUISICAO AO VIVO: DELEGADA AO STORE COMPARTILHADO (F13, 2026-08-10) ───────────────────
//
// O CDB2026 mantinha sua propria hierarquia de fontes e seu proprio carimbo de observacao --
// copia paralela do que football_live_store.js ja fazia. A biblioteca canonica era carregada e
// nunca instanciada, entao os defeitos corrigidos nela nao protegiam este app.
//
// Estado de torneio (chaveamento, sorteio oficial, entradas, palpites, pagamentos) NAO passa por
// aqui e nao foi tocado: o store so conhece observacao de partida.
let _liveStore = null;

function initLiveStore() {
  const g = C.liveGateway || {};
  const F = window.BOLAO_FOOTBALL_LIVE;
  if (!F || typeof F.createStore !== "function") {
    console.warn("[CDB2026] FootballLiveStore indisponivel — sem dado ao vivo nesta sessao.");
    return null;
  }
  _liveStore = F.createStore({
    competition: g.competition || "cdb2026",
    gatewayUrl: g.enabled ? g.url : null,
    snapshotUrl: C.espn?.scoreboardUrl || null,
  });
  _liveStore.subscribe(() => { pollLiveTies(); });
  _liveStore.start();
  return _liveStore;
}

/** Projeta a saude publicada do estado do store. Deixou de ser mantida a mao. */
function liveHealthFromStore() {
  if (!_liveStore) {
    return { gatewayStatus: "UNKNOWN", lastGatewayOkAt: null, consecutiveFailures: 0, lastError: null };
  }
  const st = _liveStore.getState();
  const h = st.health || {};
  let status = "OK";
  if (h.lastError) status = /NETWORK|HTTP_/.test(String(h.lastError)) ? "UNREACHABLE" : "DEGRADED";
  else if (st.stale) status = "STALE";
  return {
    gatewayStatus: status,
    lastGatewayOkAt: h.gatewayLastOkAt || null,
    consecutiveFailures: h.consecutiveFailures || 0,
    lastError: h.lastError || null,
  };
}

async function fetchEspnCandidates() {
  const url = C.espn?.scoreboardUrl;
  if (!url) return null;
  try {
    // `cache: "no-cache"` — REVALIDA sempre. Sem isto o navegador servia a cópia em cache por até
    // 10 minutos (`cache-control: max-age=600` do GitHub Pages), então o poll relia o MESMO arquivo
    // e o placar/relógio ao vivo congelavam. Revalidar devolve 304 barato quando nada mudou.
    // FONTE UNICA DE OBSERVACAO: o store compartilhado, que ja resolveu a hierarquia
    // (gateway -> snapshot commitado), a monotonicidade e a protecao de estado terminal.
    const st = _liveStore ? _liveStore.getState() : null;
    _liveHealth = liveHealthFromStore();
    publishLiveHealth();
    const snap = st && Array.isArray(st.matches)
      ? { matches: st.matches, generatedAt: st.observedAt, stale: st.stale }
      : null;
    if (!snap || !Array.isArray(snap.matches)) return null; // sem observacao: melhor nada que lixo
    if (snap.stale) console.warn(`[CDB2026] snapshot ESPN marcado stale (${snap.staleReason || "?"}) — usando último dado bom conhecido`);
    // QUANDO o dado foi observado. Antes da migração da ESPN "buscar" e "observar" eram o mesmo
    // instante; com snapshot, não são — e tratar a hora do fetch como hora da observação congela o
    // relógio ao vivo (ver o comentário em pollLiveTies).
    const observedAt = Date.parse(snap.generatedAt || "") || Date.now();
    const events = snapshotEventsToEspnShape(snap.matches).map(ev => ({ ...ev, observedAt }));
    const liveEventIds = events
      .filter(ev => window.BOLAO_FOOTBALL_LIVE.isLiveEvent(ev))
      .map(ev => ev.id)
      .filter(Boolean);
    const keyEventsById = {};
    if (liveEventIds.length) {
      const summaries = await Promise.all(liveEventIds.map(id => fetchEspnEventSummary(id)));
      liveEventIds.forEach((id, i) => { if (summaries[i]) keyEventsById[id] = summaries[i]; });
    }
    return events.map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const comps = comp.competitors || [];
      const home  = comps.find(c => c.homeAway === "home") || comps[0];
      const away  = comps.find(c => c.homeAway === "away") || comps[1];
      const evState = comp.status?.type?.state || "pre";
      // Campos de jogo AO VIVO (2026-07-15, ver CDB2026: recurso de partida ao vivo) --
      // adicionados sem tocar homeScore/awayScore/homeWinner/awayWinner acima, que
      // autoSyncEspn()/autoSyncEspnResults() já dependem para decidir "confronto acabou" (só
      // `state === "post"`). Mesma detecção de intervalo/pênaltis da Copa/BR2026
      // (mapEspnToLiveScores/fetchScoreboard) -- `state` da ESPN fica "in" durante o intervalo
      // também, só `type.name`/texto do status muda.
      const clockSec = typeof comp.status?.clock === "number" ? comp.status.clock : null;
      const period   = typeof comp.status?.period === "number" ? comp.status.period : null;
      const statusName = (comp.status?.type?.name || "").toUpperCase();
      const statusText = `${comp.status?.type?.description || ""} ${comp.status?.type?.shortDetail || ""} ${comp.status?.type?.detail || ""}`.toLowerCase();
      const isHalftime = statusName.includes("HALFTIME") || /half.?time|intervalo|entretiempo/.test(statusText);
      const isPenalties = period === 5
        || statusName.includes("SHOOTOUT")
        || statusName.includes("PENALT")
        || statusName.includes("END_OF_EXTRATIME")
        || /penalt|pênalti|penales|\bpens\b|shootout|end of extra ?time/.test(statusText);
      // Item 25 do CONSISTENCY_MATRIX.md (2026-07-15) -- CDB2026 não tinha nenhuma forma de
      // sinalizar jogo adiado/cancelado; portado do BR2026 (fetchSchedule(), mesma checagem) --
      // só que o BR2026 original tinha um bug real nessa checagem, herdado aqui junto: o `name`
      // da ESPN para um jogo adiado é a constante "STATUS_POSTPONED"/"STATUS_CANCELED", nunca o
      // texto "POSTPONED"/"CANCELED" comparado aqui, então essa comparação nunca batia. Corrigido
      // junto com o BR2026 (Eduardo, 2026-07-26, achado auditando dados da tabela do BR2026:
      // "outros sites mostra pontuacao diferentes") -- usa state==="post" + completed===false,
      // que é o sinal real e confiável (verificado contra dados reais da ESPN).
      const postponed = evState === "post" && comp.status?.type?.completed === false;
      return {
        id: ev.id,
        dateISO: comp.date || ev.date || "",
        homeTeam: normalizeEspnTeamName(home?.team?.displayName || ""),
        awayTeam: normalizeEspnTeamName(away?.team?.displayName || ""),
        // `!postponed` é obrigatório aqui, não só no chip de "Adiado": a ESPN devolve um jogo
        // adiado como state:"post" COM score "0" (verificado em dados reais de 2026-07-29 na
        // bra.1) -- sem esta guarda, `homeScore` virava 0 (não null) e autoSyncEspn()/
        // autoSyncEspnResults() gravavam a perna como FINAL 0-0 de um jogo nunca disputado.
        // Pior: `if (m.goalsHome != null) return` mais abaixo faz o placar falso BLOQUEAR para
        // sempre o preenchimento automático do resultado real. Achado na auditoria de 2026-08
        // (AUDIT-06) -- latente hoje (nenhum jogo da Copa do Brasil está adiado), mas a Copa do
        // Brasil adia jogos com frequência e o bolão paga dinheiro real.
        homeScore: evState === "post" && !postponed && home?.score != null ? parseInt(home.score, 10) : null,
        awayScore: evState === "post" && !postponed && away?.score != null ? parseInt(away.score, 10) : null,
        // `winner` é o campo que a própria ESPN usa pra indicar quem passou de fase depois de
        // pênaltis (o placar normal por si só empata em caso de disputa) -- só confiável quando o
        // jogo já terminou (evState === "post"); usado em autoSyncEspnResults() para travar um
        // confronto empatado no agregado sem precisar do admin escolher manualmente.
        // Mesma guarda `!postponed` (ver homeScore acima): um jogo adiado nunca tem vencedor.
        homeWinner: evState === "post" && !postponed ? home?.winner === true : null,
        awayWinner: evState === "post" && !postponed ? away?.winner === true : null,
        venue: comp.venue?.fullName || "",
        city: comp.venue?.address?.city || "",
        state: evState,
        liveHomeScore: evState === "in" && home?.score != null ? parseInt(home.score, 10) : null,
        liveAwayScore: evState === "in" && away?.score != null ? parseInt(away.score, 10) : null,
        clockSec, period, isHalftime, isPenalties, postponed, observedAt: ev.observedAt,
        clockStr: comp.status?.displayClock || "",
        plays: extractMatchPlays(comp, keyEventsById[ev.id]),
      };
    }).filter(ev => ev && ev.homeTeam && ev.awayTeam)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  } catch (err) {
    console.warn("[CDB2026] ESPN fetch failed", err);
    return null;
  }
}

function existingPairsAcrossPhases(s) {
  const pairs = new Set();
  Object.values(s.phases || {}).forEach(ph => Object.values(ph.ties || {}).forEach(tie => {
    if (tie.teamA && tie.teamB) pairs.add([tie.teamA, tie.teamB].sort().join("|"));
  }));
  return pairs;
}

// Slug determinístico (não um uuid aleatório) para confrontos adicionados pela sincronização
// automática — se dois dispositivos rodarem a auto-sync de forma independente antes de se
// sincronizarem entre si (Supabase), os dois geram o MESMO id para o mesmo confronto real, e o
// merge por chave (mergeStates) naturalmente colapsa em uma única entrada em vez de duplicar.
// Ties adicionados manualmente continuam usando uuid() — sem esse risco de corrida.
function espnTieId(teamA, teamB) {
  const slug = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "espn-" + [slug(teamA), slug(teamB)].sort().join("_");
}

// Popula os confrontos JÁ SORTEADOS conhecidos (DATA.knownConfrontos, ver data.js) — roda
// exatamente uma vez por estado (marcado em s.espnSync.seededKnownConfrontos), nunca de novo
// depois disso. Isso é o que garante que o admin possa remover um confronto errado pela UI
// existente sem que ele volte sozinho no próximo carregamento. Chamado em init(), depois do
// merge com o Supabase, para nunca semear por cima do que outro dispositivo já salvou.
function seedKnownConfrontos(s) {
  if (s.espnSync?.seededKnownConfrontos) return false;
  s.espnSync = s.espnSync || {};
  s.espnSync.seededKnownConfrontos = true;
  const existingPairs = existingPairsAcrossPhases(s);
  let added = false;
  Object.entries(DATA.knownConfrontos || {}).forEach(([phaseId, ties]) => {
    if (!s.phases[phaseId]) return;
    const format = getPhaseDef(phaseId).format;
    // Dois formatos de entrada em DATA.knownConfrontos[phaseId]: confronto FUTURO (só
    // teamA/teamB — ex. Oitavas, sorteado mas ainda não jogado, matches ficam vazios) e
    // confronto JÁ DECIDIDO (com winner + legs — ex. 5ª Fase, já concluída em maio/2026,
    // populada aqui só para referência em "Jogos", ver DATA.phasesConcludedNoData e
    // docs/bolao/CDB2026_RULES_AND_MODEL.md seção 7.2). legs[leg] pode ser null/incompleto
    // quando o placar de uma perna específica não pôde ser confirmado por fonte — nesse caso a
    // perna fica sem resultado (mesmo estado de "ainda não jogada"), mas quem avançou
    // (qualifiedTeamId) já é conhecido com confiança e é setado de qualquer forma.
    ties.forEach(({ teamA, teamB, winner, legs, kickoff, venue, city }) => {
      const pairKey = [teamA, teamB].sort().join("|");
      if (existingPairs.has(pairKey)) return;
      const tie = { teamA, teamB, matches: {}, qualifiedTeamId: winner || null };
      legsForFormat(format).forEach(leg => {
        const home  = leg === "second" ? teamB : teamA;
        const away  = leg === "second" ? teamA : teamB;
        const score = legs?.[leg];
        tie.matches[leg] = (score && score.goalsHome != null && score.goalsAway != null)
          ? { ...emptyMatch(), homeTeam: home, awayTeam: away, goalsHome: score.goalsHome, goalsAway: score.goalsAway, status: "FINAL" }
          : emptyMatch();
      });
      // kickoff/venue/city de um confronto FUTURO (ex. Oitavas) vão sempre na primeira perna
      // (ida, ou única em SINGLE_MATCH) -- é o mesmo dado usado pelo card "Próxima partida" e
      // pelo cutoff automático (ver entryCutoffMs()/firstKnownKickoffMs() em app.js).
      if (kickoff) {
        const firstLeg = format === "SINGLE_MATCH" ? "single" : "first";
        tie.matches[firstLeg] = { ...tie.matches[firstLeg], kickoff, venue: venue || null, city: city || null };
      }
      s.phases[phaseId].ties[espnTieId(teamA, teamB)] = tie;
      existingPairs.add(pairKey);
      added = true;
    });
    // Só promove a fase a "ativa" (usada pela sincronização ESPN) se ela não vier inteira já
    // decidida — senão a 5ª Fase (histórico, ver acima) tomaria o lugar da Oitavas como fase
    // ativa dependendo da ordem de DATA.knownConfrontos, quebrando a sincronização automática.
    const allResolved = ties.length > 0 && ties.every(tie => tie.winner);
    if (!allResolved && !s.espnSync.activePhaseId) s.espnSync.activePhaseId = phaseId;
  });
  return added;
}

// Preenche kickoff/venue/city em confrontos JÁ SEMEADOS que ainda não tinham essa informação —
// diferente de seedKnownConfrontos() (que só CRIA confronto novo, nunca toca um que já existe),
// esta função só ATUALIZA metadado que ainda estava vazio, sem tocar em placar/qualifiedTeamId/
// nada que o admin já tenha lançado. Necessário porque a Oitavas já tinha sido semeada (v3.6,
// antes da CBF divulgar data/hora de cada jogo) — sem isso, DATA.knownConfrontos ganhar kickoff
// nunca chegaria a quem já tem o app rodando: seedKnownConfrontos() está travada por
// seededKnownConfrontos (true desde a v3.6) e nunca mais roda. Bug real encontrado por Eduardo
// (2026-07-14): mesmo com o cutoff automático (kickoff - 1h, ver entryCutoffMs()) corrigido, o
// contador continuava preso em "aguardando sorteio" em produção porque não havia kickoff nenhum
// gravado em nenhum confronto da Oitavas. Roda uma única vez (flag própria, separada da de
// seedKnownConfrontos), nunca reaplica — o admin pode corrigir kickoff/venue depois (quando isso
// tiver uma UI) sem risco de essa função sobrescrever de volta.
function backfillOitavasKickoffs(s) {
  if (s.espnSync?.backfilledOitavasKickoffs) return false;
  s.espnSync = s.espnSync || {};
  s.espnSync.backfilledOitavasKickoffs = true;
  const knownTies = DATA.knownConfrontos?.oitavas || [];
  let changed = false;
  Object.values(s.phases?.oitavas?.ties || {}).forEach(tie => {
    if (!tie.teamA || !tie.teamB) return;
    const pairKey = [tie.teamA, tie.teamB].sort().join("|");
    const known = knownTies.find(k => [k.teamA, k.teamB].sort().join("|") === pairKey);
    if (!known?.kickoff) return;
    const m = tie.matches?.first;
    if (!m || m.kickoff) return; // já tem kickoff (ESPN sync ou admin) -- nunca sobrescreve
    tie.matches.first = { ...m, kickoff: known.kickoff, venue: known.venue || m.venue || null, city: known.city || m.city || null };
    changed = true;
  });
  return changed;
}

// Auto-cura de dado corrompido pela v3.16 (2026-07-14, EMERGENCY_HOTFIX v3.18, Eduardo: "os jogos
// das oitavas também estão errados e não deixam entrar resultado" / "não faça limpeza manual, faça
// automático"). v3.16 podia casar um evento antigo/errado da ESPN (mesmo par de nomes de time, ver
// autoSyncEspnResults) e preencher placar/travar um confronto que ainda nem começou de verdade.
// Prova definitiva de corrupção, sem ambiguidade nenhuma: um resultado "espn-auto" numa fase cujo
// kickoff conhecido ainda não passou é logicamente impossível (o jogo não pode ter terminado antes
// de começar). Reverte automaticamente -- roda uma única vez por estado (flag própria), na
// inicialização, depois do merge com o Supabase. NUNCA mexe num confronto onde pelo menos um
// kickoff conhecido já passou (esse pode legitimamente já ter sido jogado de verdade) -- só reverte
// o que é matematicamente impossível de ser real agora.
function healFalseEspnAutoResults(s) {
  if (s.espnSync?.healedFalseAutoResults) return false;
  s.espnSync = s.espnSync || {};
  s.espnSync.healedFalseAutoResults = true;
  const now = Date.now();
  let changed = false;
  Object.values(s.phases || {}).forEach(phase => {
    Object.values(phase.ties || {}).forEach(tie => {
      const matches = Object.values(tie.matches || {});
      const anyKnownKickoffAlreadyPast = matches.some(m => {
        const ms = m?.kickoff ? new Date(m.kickoff).getTime() : NaN;
        return Number.isFinite(ms) && ms <= now;
      });
      if (anyKnownKickoffAlreadyPast) return; // pelo menos um jogo pode já ter sido jogado de verdade -- não mexe
      const hadEspnAutoData = matches.some(m => m?.resultSource === "espn-auto") || tie.lockedBy === "espn-auto";
      if (!hadEspnAutoData) return;
      Object.values(tie.matches || {}).forEach(m => {
        if (m?.resultSource === "espn-auto") {
          m.goalsHome = null; m.goalsAway = null; m.status = "SCHEDULED"; delete m.resultSource;
        }
      });
      if (tie.lockedBy === "espn-auto") { delete tie.qualifiedTeamId; delete tie.lockedAt; delete tie.lockedBy; }
      changed = true;
    });
  });
  return changed;
}

// Auto-cura de confrontos-fantasma criados pela falta de guarda em autoSyncEspn() -- v3.19,
// EMERGENCY_HOTFIX, 2026-07-14, mesmo dia do incidente v3.17/v3.18. Achado em produção: dos 112
// ties gravados na fase Oitavas, só 8 eram os confrontos reais (DATA.knownConfrontos.oitavas); os
// outros 104 eram jogos de fases anteriores da Copa do Brasil real (fetchEspnCandidates cobre o
// ano inteiro) confundidos com Oitavas porque o par de nomes de time nunca tinha aparecido em
// outra fase rastreada por este app. Nove desses fantasmas chegaram a ser travados
// (lockedBy:"espn-auto") com um kickoff antigo real anexado, o que arrastava
// firstKnownKickoffMs()/o cutoff automático para o passado -- exatamente os sintomas relatados
// ("fechado para palpites", "sem contador regressivo", "jogos das oitavas errados"). Roda uma
// única vez (flag própria), na inicialização, depois do merge com o Supabase e depois de
// seedKnownConfrontos(). Só remove um tie quando a fase tem uma lista curada de confrontos reais
// (DATA.knownConfrontos[phaseId]) e o par do tie não está nela -- nunca mexe em fase sem lista
// curada (nada a validar). Nunca remove um tie que tenha pelo menos um palpite real de
// participante referenciando-o, mesmo que não devesse acontecer (defesa extra).
function healPhantomTies(s) {
  if (s.espnSync?.healedPhantomTies) return false;
  s.espnSync = s.espnSync || {};
  s.espnSync.healedPhantomTies = true;
  let changed = false;
  const pickedTieIds = new Set();
  (s.entries || []).forEach(e => {
    Object.keys(e.picks?.matches || {}).forEach(id => pickedTieIds.add(id));
    Object.keys(e.picks?.qualified || {}).forEach(id => pickedTieIds.add(id));
  });
  Object.entries(s.phases || {}).forEach(([phaseId, phase]) => {
    const known = DATA.knownConfrontos?.[phaseId];
    if (!known) return; // sem lista curada para esta fase -- nada a validar, não mexe
    const knownPairs = new Set(known.map(k => [k.teamA, k.teamB].sort().join("|")));
    Object.entries(phase.ties || {}).forEach(([tieId, tie]) => {
      const pairKey = [tie.teamA, tie.teamB].sort().join("|");
      if (knownPairs.has(pairKey)) return;
      if (pickedTieIds.has(tieId)) return; // palpite real de participante -- não apaga
      delete phase.ties[tieId];
      changed = true;
    });
  });
  return changed;
}

// Faz o trabalho de fato: busca, filtra o que já existe, cria os confrontos novos na fase ativa,
// salva uma vez (não uma vez por confronto). Retorna um resumo para o admin ver o que aconteceu.
//
// v3.19 (2026-07-14, EMERGENCY_HOTFIX): antes desta correção, QUALQUER par de nomes de time visto
// no ano inteiro de dados da ESPN (fetchEspnCandidates, dates=20260101-20261231, ~500 jogos de
// todas as fases) que ainda não existisse em nenhuma fase rastreada virava confronto novo na fase
// ativa -- sem checar se aquele par É de fato um confronto real desta fase. Restrição: só cria um
// confronto novo se o par já é um dos confrontos REALMENTE sorteados e conhecidos para esta fase
// (DATA.knownConfrontos[phaseId], curado manualmente -- ver data.js). Sem essa curadoria para a
// fase (ex.: Quartas/Semifinal antes do sorteio real acontecer), não cria nada -- confrontos
// dessas fases continuam exigindo cadastro manual do admin (tela "Fases e confrontos"), que já
// era o modelo documentado em CDB2026_RULES_AND_MODEL.md antes da automação de ESPN existir.
async function autoSyncEspn(s) {
  const phaseId = s.espnSync?.activePhaseId;
  if (!phaseId) return { addedCount: 0, added: [], error: false, needsPhase: true };

  const candidates = await fetchEspnCandidates();
  if (candidates === null) return { addedCount: 0, added: [], error: true, needsPhase: false };

  const knownPairs = new Set((DATA.knownConfrontos?.[phaseId] || []).map(k => [k.teamA, k.teamB].sort().join("|")));
  const existingPairs = existingPairsAcrossPhases(s);
  const format = getPhaseDef(phaseId).format;
  const added = [];
  const mutations = [];
  const s2 = state(); // relê o estado mais recente antes de escrever — outra aba pode ter mudado algo

  candidates.forEach(ev => {
    const pairKey = [ev.homeTeam, ev.awayTeam].sort().join("|");
    if (existingPairs.has(pairKey)) return;
    if (!knownPairs.has(pairKey)) return; // não é um confronto real conhecido desta fase -- ignora
    existingPairs.add(pairKey); // evita adicionar o mesmo par duas vezes nesta mesma leva
    const tie = { teamA: ev.homeTeam, teamB: ev.awayTeam, matches: {}, qualifiedTeamId: null };
    legsForFormat(format).forEach(leg => { tie.matches[leg] = emptyMatch(); });
    // O evento da ESPN corresponde à primeira perna do confronto (a ida, ou a única partida em
    // SINGLE_MATCH) — kickoff/local vêm do evento mesmo se ainda não jogado (alimenta o card
    // "próxima partida", ver renderNextTieCard()). Placar é preenchido se o jogo já terminou na
    // ESPN (autoSyncEspnResults(), chamada logo depois desta função no mesmo ciclo, cuida do
    // avanço/travamento do confronto — aqui só entra o placar bruto da perna, igual ao que já
    // acontecia antes de v3.16).
    const firstLeg = format === "SINGLE_MATCH" ? "single" : "first";
    tie.matches[firstLeg] = {
      ...tie.matches[firstLeg],
      homeTeam: ev.homeTeam, awayTeam: ev.awayTeam,
      kickoff: ev.dateISO || null, venue: ev.venue || null, city: ev.city || null,
      ...(ev.homeScore != null ? { goalsHome: ev.homeScore, goalsAway: ev.awayScore, status: "FINAL", resultSource: "espn-auto" } : {}),
    };
    const tieId = espnTieId(ev.homeTeam, ev.awayTeam);
    s2.phases[phaseId].ties[tieId] = tie;
    added.push(`${ev.homeTeam} × ${ev.awayTeam}`);
    mutations.push({ type: "espn-add-tie", phaseId, tieId, tie });
  });

  // Achado real em produção (2026-08-04, Eduardo: "Próximo jogo e contador não aparece mais"):
  // a perna da IDA recebe kickoff/venue só na criação do confronto (bloco acima), mas a VOLTA
  // nunca recebia -- nem este bloco (só toca a perna nova, "first"/"single"), nem
  // autoSyncEspnResults() (só toca uma perna quando ela JÁ tem placar, ver `homeScore != null`
  // ali). O resultado: assim que a ida de todo confronto aberto termina, `findNextUpcomingMatch()`
  // não encontra mais nenhuma perna com `kickoff` preenchido em lugar nenhum -- mesmo a ESPN já
  // tendo publicado a data da volta -- e o card "Próximo jogo"/contador some. Preenche aqui o
  // kickoff/venue/city de qualquer perna já conhecida (tie existente) que ainda não tem essas
  // duas coisas, com a MESMA proteção de janela de data (withinResultMatchWindow) que
  // autoSyncEspnResults() já usa -- nunca toca goalsHome/goalsAway/status/qualifiedTeamId, só
  // informação de agenda, então o pior caso de um casamento errado aqui é uma data/local
  // cosmeticamente errados no card, não um resultado ou pagamento.
  Object.entries(s2.phases[phaseId].ties).forEach(([tieId, tie]) => {
    if (!tie.teamA || !tie.teamB) return;
    const tieKickoffAnchor = legs.map(l => tie.matches?.[l]?.kickoff).find(Boolean);
    legs.forEach(leg => {
      const m = tie.matches?.[leg];
      if (!m || m.kickoff || m.goalsHome != null) return; // já tem data, ou já foi jogada -- nada a preencher
      const home = leg === "second" ? tie.teamB : tie.teamA;
      const away = leg === "second" ? tie.teamA : tie.teamB;
      const ev = candidates.find(c => c.homeTeam === home && c.awayTeam === away
        && withinResultMatchWindow(c.dateISO, m.kickoff || tieKickoffAnchor));
      if (!ev || !ev.dateISO) return;
      const patchedMatch = { ...m, kickoff: ev.dateISO, venue: ev.venue || m.venue || null, city: ev.city || m.city || null };
      tie.matches[leg] = patchedMatch;
      // Reuses the already-registered "save-leg" mutation type (applyAdminMutation() below) --
      // same {phaseId, tieId, leg, match} shape as espn-save-result, just with schedule fields
      // instead of a score. A brand-new mutation "type" string here would hit that function's
      // `default: throw new Error(...)` on any Supabase remote-conflict merge, since
      // applyMutationOverRemote() only recognizes the types explicitly listed there.
      mutations.push({ type: "save-leg", phaseId, tieId, leg, match: patchedMatch });
    });
  });

  // Fase 2.1 §2: cada confronto novo vira uma mutação `espn-add-tie` dirigida, aplicada como um
  // `batch` numa gravação só (uma chamada de rede por ciclo, não uma por confronto) -- não mais
  // um merge de snapshot inteiro, que arriscava conflitar com uma mutação administrativa feita
  // por outro dispositivo entre a leitura e a gravação deste ciclo.
  if (mutations.length) saveState(s2, { mutation: { type: "batch", mutations } });
  return { addedCount: added.length, added, error: false, needsPhase: false };
}

// ─── Automação de RESULTADO (não só emparelhamento) — v3.16 ─────────────────────────────────
// Eduardo autorizou explicitamente em 2026-07-14, depois de eu apresentar o risco documentado em
// docs/bolao/CDB2026_RULES_AND_MODEL.md §7 (travar resultado decide pagamento; casar a perna
// errada num confronto de ida/volta seria grave). Decisão registrada em
// docs/bolao/CONSISTENCY_MATRIX.md e no CHANGELOG desta versão.
//
// Como o risco de "casar a perna errada" é mitigado: NÃO se usa ordem de data para decidir se um
// evento da ESPN é ida ou volta -- usa-se a identidade do time mandante, que é o mesmo sinal que a
// UI manual já usa (`home = leg === "second" ? tie.teamB : tie.teamA`, ver renderAdminResultsForTie
// e o handler de data-save-leg). Ida e volta têm mandantes sempre invertidos entre si por definição
// de mata-mata -- não há ambiguidade nesse sinal.
//
// Como o risco de "travar um confronto errado" é mitigado:
//  1. Nunca sobrescreve uma perna que já tem placar -- nem uma lançada manualmente, nem uma já
//     preenchida por uma rodada anterior desta mesma função (mesmo guard que a UI manual usa:
//     `m.goalsHome == null`).
//  2. Nunca sobrescreve um confronto que já tem `qualifiedTeamId` -- travar de novo por cima de um
//     resultado já travado (manual ou automático) nunca acontece; corrigir exige "Destravar" na UI
//     como sempre exigiu.
//  3. Quando o agregado bate diferente, o vencedor é inequívoco pelo placar (mesma regra que o botão
//     manual já usava: `totalA > totalB ? "A" : "B"` -- nenhuma regra nova).
//  4. Quando o agregado empata (só decide nos pênaltis -- a Copa do Brasil não usa gols fora de
//     casa como critério de desempate), só trava automaticamente se a ESPN reportar um vencedor
//     explícito (campo `winner` da API, que já reflete o resultado da disputa de pênaltis). Se esse
//     dado não vier, a função NÃO adivinha -- o confronto fica exatamente como ficava antes:
//     esperando o admin escolher manualmente no select + "Salvar resultado".
function aggregateOrSingleTotals(format, matches) {
  if (format === "TWO_LEG") { const agg = aggregateFromMatches(matches); return [agg.totalA, agg.totalB]; }
  return [matches.single.goalsHome, matches.single.goalsAway];
}

// Achado real em produção (2026-07-14, Eduardo: "CDB2026 continua dizendo fechado, sem o contador
// regressivo, sem possibilidade de entrada para palpites das oitavas"): o casamento de evento por
// nome de time sozinho (ver autoSyncEspnResults abaixo) busca em `candidates`, que cobre o ANO
// INTEIRO da competição (fetchEspnCandidates usa dates=20260101-20261231) -- sem checar proximidade
// de data, um evento antigo/não relacionado com o mesmo par de nomes de time (temporada inteira,
// múltiplas rodadas) podia em tese ser casado com uma perna que ainda nem começou, preenchendo
// placar/travando o confronto errado. Guarda mínima: só aceita o evento se a data dele estiver
// razoavelmente perto do kickoff já conhecido da perna (quando existe um -- Oitavas já vem com
// kickoff semeado via DATA.knownConfrontos, ver seedKnownConfrontos). Sem kickoff conhecido ainda,
// mantém o comportamento permissivo anterior (nada pra comparar).
const RESULT_MATCH_WINDOW_DAYS = 21;
function withinResultMatchWindow(candidateDateISO, knownKickoffISO) {
  if (!knownKickoffISO) return true;
  const c = new Date(candidateDateISO).getTime();
  const k = new Date(knownKickoffISO).getTime();
  if (!Number.isFinite(c) || !Number.isFinite(k)) return true;
  return Math.abs(c - k) <= RESULT_MATCH_WINDOW_DAYS * 86400000;
}

async function autoSyncEspnResults(s) {
  const phaseId = s.espnSync?.activePhaseId;
  if (!phaseId) return { lockedCount: 0, locked: [], filledLegsCount: 0, error: false };

  const candidates = await fetchEspnCandidates();
  if (candidates === null) return { lockedCount: 0, locked: [], filledLegsCount: 0, error: true };

  const format = getPhaseDef(phaseId).format;
  const legs = legsForFormat(format);
  const s2 = state(); // relê o estado mais recente antes de escrever — outra aba pode ter mudado algo
  const ties = s2.phases[phaseId]?.ties || {};
  let filledLegsCount = 0;
  const locked = [];
  const mutations = [];

  Object.entries(ties).forEach(([tieId, tie]) => {
    if (!tie.teamA || !tie.teamB) return;

    // Âncora de data pro tie inteiro: a perna sendo checada pode ainda não ter kickoff conhecido
    // (ex.: volta, antes da ida ser jogada) -- nesse caso usa o kickoff de QUALQUER outra perna já
    // conhecida do mesmo confronto como referência (ida e volta acontecem sempre a poucos dias uma
    // da outra), em vez de ficar sem checagem nenhuma nessa perna.
    const tieKickoffAnchor = legs.map(l => tie.matches?.[l]?.kickoff).find(Boolean);

    legs.forEach(leg => {
      const m = tie.matches?.[leg];
      if (!m || m.goalsHome != null) return; // já preenchido (manual ou auto) — nunca sobrescreve
      const home = leg === "second" ? tie.teamB : tie.teamA;
      const away = leg === "second" ? tie.teamA : tie.teamB;
      const ev = candidates.find(c => c.homeTeam === home && c.awayTeam === away && c.homeScore != null
        && withinResultMatchWindow(c.dateISO, m.kickoff || tieKickoffAnchor));
      if (!ev) return;
      const match = { ...m, homeTeam: home, awayTeam: away, goalsHome: ev.homeScore, goalsAway: ev.awayScore, status: "FINAL", resultSource: "espn-auto" };
      tie.matches[leg] = match;
      filledLegsCount++;
      mutations.push({ type: "espn-save-result", phaseId, tieId, leg, match });
    });

    if (tie.qualifiedTeamId) return; // já travado (manual ou auto) — nunca sobrescreve
    if (!legs.every(leg => tie.matches?.[leg]?.goalsHome != null)) return; // ainda falta perna

    const [totalA, totalB] = aggregateOrSingleTotals(format, tie.matches);
    let qualified = null;
    if (totalA !== totalB) {
      qualified = totalA > totalB ? "A" : "B";
    } else {
      const decisiveLeg  = format === "TWO_LEG" ? "second" : "single";
      const decisiveHome = decisiveLeg === "second" ? tie.teamB : tie.teamA;
      const decisiveAway = decisiveLeg === "second" ? tie.teamA : tie.teamB;
      const ev = candidates.find(c => c.homeTeam === decisiveHome && c.awayTeam === decisiveAway
        && withinResultMatchWindow(c.dateISO, tie.matches?.[decisiveLeg]?.kickoff || legs.map(l => tie.matches?.[l]?.kickoff).find(Boolean)));
      if (ev?.homeWinner === true) qualified = decisiveHome === tie.teamA ? "A" : "B";
      else if (ev?.awayWinner === true) qualified = decisiveAway === tie.teamA ? "A" : "B";
      // Sem sinal de vencedor da ESPN: fica sem travar, cai pro fluxo manual existente.
    }

    if (!qualified) return;
    const lockedAt = new Date().toISOString();
    tie.qualifiedTeamId = qualified;
    tie.lockedAt = lockedAt;
    tie.lockedBy = "espn-auto";
    locked.push(`${tie.teamA} × ${tie.teamB}`);
    mutations.push({ type: "lock-tie", phaseId, tieId, qualifiedTeamId: qualified, lockedAt, lockedBy: "espn-auto" });
  });

  // Fase 2.1 §2: mesmo raciocínio de autoSyncEspn() acima -- cada perna preenchida/confronto
  // travado vira sua própria mutação dirigida, todas aplicadas como um `batch` numa gravação só.
  if (mutations.length) saveState(s2, { mutation: { type: "batch", mutations } });
  return { lockedCount: locked.length, locked, filledLegsCount, error: false };
}

// Roda os dois ciclos em sequência (emparelhamento, depois resultado) e funde num resumo único
// para a UI do admin. autoSyncEspnResults() relê o estado internamente, então já enxerga
// qualquer confronto novo que autoSyncEspn() acabou de adicionar no mesmo ciclo.
async function autoSyncEspnFull(s) {
  const pairSummary = await autoSyncEspn(s);
  const resultSummary = await autoSyncEspnResults(state());
  return {
    addedCount: pairSummary.addedCount, added: pairSummary.added,
    lockedCount: resultSummary.lockedCount, locked: resultSummary.locked,
    filledLegsCount: resultSummary.filledLegsCount,
    error: pairSummary.error || resultSummary.error,
    needsPhase: pairSummary.needsPhase,
  };
}

function renderAdminEspnSync(s) {
  const box = $("adminEspnSync");
  if (!box) return;

  const phaseOptions = `<option value="">${esc(t("espnSyncPickPhase"))}</option>`
    + DATA.phases.map(p => `<option value="${esc(p.id)}" ${s.espnSync?.activePhaseId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");

  let statusHtml;
  if (!s.espnSync?.activePhaseId) {
    statusHtml = `<p class="muted small-text">${esc(t("espnSyncNeedsPhase"))}</p>`;
  } else if (_espnLastRunSummary?.error) {
    statusHtml = `<p class="muted small-text">${esc(t("espnSyncError"))}</p>`;
  } else if (_espnLastRunSummary) {
    const when = new Date(_espnLastRunSummary.at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    const lines = [];
    if (_espnLastRunSummary.addedCount) {
      lines.push(`<p class="small-text">✓ ${_espnLastRunSummary.addedCount} ${esc(t("espnSyncAddedCount"))}: ${esc(_espnLastRunSummary.added.join(", "))}</p>`);
    }
    if (_espnLastRunSummary.lockedCount) {
      lines.push(`<p class="small-text">✓ ${_espnLastRunSummary.lockedCount} ${esc(t("espnSyncLockedCount"))}: ${esc(_espnLastRunSummary.locked.join(", "))}</p>`);
    }
    if (!lines.length) lines.push(`<p class="muted small-text">${esc(t("espnSyncNothingNew"))}</p>`);
    lines.push(`<p class="muted small-text">${esc(when)}</p>`);
    statusHtml = lines.join("");
  } else {
    statusHtml = `<p class="muted small-text">${esc(t("espnSyncChecking"))}</p>`;
  }

  box.innerHTML = `
    <h3>${esc(t("espnSyncTitle"))}</h3>
    <p class="muted small-text">${esc(t("espnSyncAutoDisclaimer"))}</p>
    <div class="admin-row">
      <span class="small-text muted">${esc(t("espnSyncActivePhase"))}</span>
      <select id="espnSyncPhaseSelect">${phaseOptions}</select>
      <button type="button" id="espnSyncNowBtn" class="secondary small-btn">${esc(t("espnSyncRefresh"))}</button>
    </div>
    ${statusHtml}`;

  $("espnSyncPhaseSelect")?.addEventListener("change", (e) => {
    if (!guardAdmin()) return;
    // Zera o guard ANTES de saveState() — saveState() re-renderiza de forma síncrona (via
    // renderAll()), então se isso rodasse depois, a re-renderização em cascata leria o valor
    // antigo do guard e poderia pular a sincronização da fase recém-selecionada.
    _espnLastRunSummary = null;
    _espnLastAutoSyncAt = 0; // força a próxima renderização a sincronizar de novo com a fase nova
    const s2 = state();
    s2.espnSync = s2.espnSync || {};
    const phaseId = e.target.value || null;
    s2.espnSync.activePhaseId = phaseId;
    saveState(s2, { mutation: { type: "set-active-phase", phaseId } });
  });

  $("espnSyncNowBtn")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    _espnLastAutoSyncAt = Date.now();
    const btn = $("espnSyncNowBtn");
    btn.disabled = true; btn.textContent = t("espnSyncFetching");
    _espnLastRunSummary = { ...(await autoSyncEspnFull(state())), at: Date.now() };
    if (_espnLastRunSummary.addedCount) showToast(t("espnSyncAddedToast"), "success");
    if (_espnLastRunSummary.lockedCount) showToast(t("espnSyncLockedToast"), "success");
    renderAdmin();
  });

  // Auto-sync: roda sozinho quando o painel admin abre (ou a cada 5 min se ele continuar aberto)
  // — sem exigir clique. Guarda por timestamp para não rodar de novo a cada re-render (ex.: depois
  // de marcar um pagamento como pago, o que também dispara renderAdmin()). Desde v3.16 também
  // captura e trava resultado automaticamente (autoSyncEspnFull) -- ver autoSyncEspnResults() para
  // o racional completo e as salvaguardas.
  if (s.espnSync?.activePhaseId && Date.now() - _espnLastAutoSyncAt > ESPN_AUTO_SYNC_INTERVAL_MS) {
    _espnLastAutoSyncAt = Date.now();
    autoSyncEspnFull(s).then(summary => {
      _espnLastRunSummary = { ...summary, at: Date.now() };
      if (summary.addedCount) showToast(t("espnSyncAddedToast"), "success");
      if (summary.lockedCount) showToast(t("espnSyncLockedToast"), "success");
      if (summary.addedCount || summary.lockedCount || summary.filledLegsCount) renderAdmin();
      else renderAdminEspnSync(state());
    });
  }
}

function toLocalDatetimeValue(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Admin: cadastro de confrontos por fase. Nenhuma fase vem com confrontos pré-cadastrados no
// código — o admin adiciona o confronto real assim que o sorteio de cada fase acontece (ver
// CDB2026_RULES_AND_MODEL.md, "não inventar confrontos futuros").
function renderAdminPhases(s) {
  const box = $("adminPhases");
  if (!box) return;
  const teamOptions = Object.keys(DATA.teamLogos || {}).sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(name => `<option value="${esc(name)}">`).join("");
  let html = `<h3>${esc(t("adminPhasesTitle"))}</h3><datalist id="cdbTeamList">${teamOptions}</datalist>`;
  DATA.phases.forEach(phase => {
    const phaseState = s.phases?.[phase.id] || emptyPhaseState();
    const tieCount = Object.keys(phaseState.ties || {}).length;
    // Fase já concluída ANTES deste bolão existir (DATA.phasesConcludedNoData, v3.8) -- achado em
    // auditoria (2026-07-14): o formulário de "Adicionar confronto" aparecia normal mesmo assim.
    // Nada impedia o admin de cadastrar um confronto ali por engano, quebrando silenciosamente o
    // contrato documentado em data.js ("essas fases não têm o que apostar, de propósito") -- esse
    // confronto passaria a aparecer no formulário de palpite e em Jogos, contradizendo o design.
    const concludedNoData = (DATA.phasesConcludedNoData || []).includes(phase.id) && !tieCount;
    if (concludedNoData) {
      html += `<div class="admin-phase-block" data-phase="${esc(phase.id)}">
        <div class="admin-phase-header">
          <b>${esc(phase.name)}</b>
          <span class="muted small-text">${esc(t("phaseAlreadyConcluded"))}</span>
        </div>
      </div>`;
      return;
    }
    html += `<div class="admin-phase-block" data-phase="${esc(phase.id)}">
      <div class="admin-phase-header">
        <b>${esc(phase.name)}</b>
        <span class="muted small-text">${phase.format === "TWO_LEG" ? esc(t("formatTwoLeg")) : esc(t("formatSingleMatch"))} · ${tieCount} ${esc(t("adminTiesCount"))}</span>
      </div>
      <div class="admin-row">
        <span class="small-text muted">${esc(t("adminPhaseCutoff"))}</span>
        <input type="datetime-local" class="adm-phase-cutoff" aria-label="${esc(t("adminPhaseCutoff"))}" value="${phaseState.cutoffAt ? esc(toLocalDatetimeValue(phaseState.cutoffAt)) : ""}">
        <button type="button" class="secondary small-btn" data-save-cutoff="${esc(phase.id)}">${esc(t("adminSaveCutoff"))}</button>
      </div>
      ${(() => {
        // Diagnóstico de fonte do cutoff -- achado real (2026-07-14, Eduardo: "o bolao da CDB
        // fala encerrado, quando não deveria" / "ninguém está conseguindo entrar palpites").
        // v3.18: desde que o auto-cálculo SEMPRE vence quando existe kickoff conhecido (ver
        // effectivePhaseCutoffMs), um cutoffAt manual preenchido pode estar simplesmente sendo
        // IGNORADO -- mostra os dois estados sem ambiguidade: "manual ativo" só quando não há
        // kickoff conhecido nenhum (é o único caso em que o manual pesa de verdade); "manual
        // preenchido mas ignorado" quando há kickoff conhecido (o auto está mandando, o manual é
        // só um resquício sem efeito -- o botão deixa limpar por clareza, mas não muda o cutoff
        // efetivo, que já é o automático).
        const effMs = effectivePhaseCutoffMs(s, phase.id);
        const hasManual = !!phaseState.cutoffAt;
        const hasKnownKickoff = firstKnownKickoffMs(s, phase.id) !== null;
        const manualInEffect = hasManual && !hasKnownKickoff;
        let label;
        if (effMs === null) label = t("cutoffSourceNone");
        else {
          const dateStr = formatBrtTimestamp(effMs);
          if (manualInEffect) label = `${t("cutoffSourceManual")}: ${dateStr} BRT`;
          else if (hasManual) label = `${t("cutoffSourceAuto")}: ${dateStr} BRT — ${t("cutoffSourceManualIgnored")}`;
          else label = `${t("cutoffSourceAuto")}: ${dateStr} BRT`;
        }
        const resetBtn = hasManual
          ? `<button type="button" class="secondary small-btn" data-clear-cutoff="${esc(phase.id)}">${esc(t("adminUseAutoCutoff"))}</button>`
          : "";
        return `<div class="admin-row cutoff-source-diag"><span class="small-text muted">${esc(label)}</span>${resetBtn}</div>`;
      })()}
      <div class="admin-row cdb-add-tie">
        <input type="text" class="adm-team-a" placeholder="${esc(t("adminTeamA"))}" aria-label="${esc(t("adminTeamA"))}" list="cdbTeamList">
        <input type="text" class="adm-team-b" placeholder="${esc(t("adminTeamB"))}" aria-label="${esc(t("adminTeamB"))}" list="cdbTeamList">
        <button type="button" class="small-btn" data-add-tie="${esc(phase.id)}">${esc(t("adminAddTie"))}</button>
      </div>
      ${Object.entries(phaseState.ties || {}).map(([tieId, tie]) => {
        const hasResults = tie.qualifiedTeamId || Object.values(tie.matches || {}).some(m => m?.goalsHome != null);
        return `<div class="admin-row">
          <span class="tie-teams-admin">${esc(tie.teamA)} × ${esc(tie.teamB)}</span>
          ${hasResults
            ? `<span class="muted small-text">${esc(t("adminTieHasResults"))}</span>`
            : `<button type="button" class="danger small-btn" data-remove-tie="${esc(tieId)}" data-phase="${esc(phase.id)}">${esc(t("delete"))}</button>`}
        </div>`;
      }).join("")}
    </div>`;
  });
  box.innerHTML = html;

  box.querySelectorAll("[data-save-cutoff]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const phaseId = btn.dataset.saveCutoff;
    const input = box.querySelector(`.admin-phase-block[data-phase="${phaseId}"] .adm-phase-cutoff`);
    const val = input.value;
    const s2 = state();
    const cutoffAt = val ? new Date(val).toISOString() : null;
    s2.phases[phaseId].cutoffAt = cutoffAt;
    saveState(s2, { mutation: { type: "set-cutoff", phaseId, cutoffAt } });
    showToast(t("adminCutoffSaved"), "success");
  }));

  box.querySelectorAll("[data-clear-cutoff]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const phaseId = btn.dataset.clearCutoff;
    const s2 = state();
    s2.phases[phaseId].cutoffAt = null;
    saveState(s2, { mutation: { type: "set-cutoff", phaseId, cutoffAt: null } });
    showToast(t("adminCutoffSaved"), "success");
  }));

  box.querySelectorAll("[data-add-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const phaseId = btn.dataset.addTie;
    const block = box.querySelector(`.admin-phase-block[data-phase="${phaseId}"]`);
    // Normalização contra a lista conhecida de times (mesma usada no <datalist>) -- achado em
    // auditoria (2026-07-14): "corinthians" e "Corinthians" eram tratados como times diferentes
    // em tudo (escudo, força, checagem de duplicata abaixo), só por causa de caixa/acento.
    const normalize = raw => {
      const v = raw.trim();
      const known = Object.keys(DATA.teamLogos || {});
      const hit = known.find(name => name.localeCompare(v, "pt-BR", { sensitivity: "base" }) === 0);
      return hit || v;
    };
    const teamA = normalize(block.querySelector(".adm-team-a").value);
    const teamB = normalize(block.querySelector(".adm-team-b").value);
    if (!teamA || !teamB || teamA === teamB) { alert(t("errorTieTeams")); return; }
    // Checagem de par duplicado -- achado em auditoria (2026-07-14): só a sincronização automática
    // com a ESPN usava existingPairsAcrossPhases(); o cadastro manual (typo, clique duplo, admin
    // esquecendo que já adicionou) podia criar dois confrontos independentes pro mesmo jogo real.
    const s2 = state();
    const pairKey = [teamA, teamB].sort().join("|");
    if (existingPairsAcrossPhases(s2).has(pairKey)) { alert(t("errorTieDuplicate")); return; }
    const format = getPhaseDef(phaseId).format;
    const tie = { teamA, teamB, matches: {}, qualifiedTeamId: null };
    legsForFormat(format).forEach(leg => { tie.matches[leg] = emptyMatch(); });
    const newTieId = uuid();
    s2.phases[phaseId].ties[newTieId] = tie;
    // Limpa os campos ANTES de salvar -- mesmo motivo do data-save-leg logo abaixo:
    // adminPhasesFormIsDirty() leria esses inputs ainda preenchidos no DOM antigo e bloquearia a
    // própria atualização que deveria mostrar o confronto recém-adicionado.
    block.querySelector(".adm-team-a").value = "";
    block.querySelector(".adm-team-b").value = "";
    saveState(s2, { mutation: { type: "add-tie", phaseId, tieId: newTieId, tie } });
    showToast(t("adminTieAdded"), "success");
  }));

  box.querySelectorAll("[data-remove-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const tieId = btn.dataset.removeTie;
    // Excluir um confronto SEM resultado ainda é permitido (hasResults já bloqueia o botão nesse
    // caso), mas participantes podem já ter salvo palpite pra ele -- achado em auditoria
    // (2026-07-14): o palpite ficava órfão sem nenhum aviso, o participante só via o confronto
    // sumir do formulário na próxima vez que abrisse, sem explicação. Conta quantas entradas
    // referenciam esse tieId e avisa no próprio confirm().
    const s = state();
    const deleted = new Set(s.deletedIds || []);
    const affected = (s.entries || []).filter(e =>
      !deleted.has(e.id) && (e.picks?.matches?.[tieId] || e.picks?.qualified?.[tieId])
    ).length;
    const msg = affected > 0 ? t("confirmRemoveTieWithPicks").replace("{n}", affected) : t("confirmRemoveTie");
    if (!tripleConfirm(msg, t("tripleConfirmDetail"))) return;
    const s2 = state();
    const phaseId = btn.dataset.phase;
    const removedTie = s2.phases[phaseId]?.ties?.[tieId];
    appendAdminAuditLog(s2, "remove-tie", { phase: phaseId, tieId, teamA: removedTie?.teamA, teamB: removedTie?.teamB, removedTie });
    delete s2.phases[phaseId]?.ties?.[tieId];
    saveState(s2, { mutation: { type: "remove-tie", phaseId, tieId } });
  }));
}

// Linha(s) de resultado de UM confronto — 1 partida (SINGLE_MATCH) ou 2 (TWO_LEG, ida/volta).
// Cada partida é salva independentemente; assim que todas as partidas do confronto têm placar,
// o agregado (ou o próprio placar, se for partida única) é calculado e um botão travar o
// resultado oficial aparece — quem se classifica é automático quando não empata, manual (igual
// à escolha de pênaltis) quando empata.
function renderAdminResultsForTie(phase, tieId, tie) {
  if (tie.qualifiedTeamId) {
    const agg = phase.format === "TWO_LEG" ? aggregateFromMatches(tie.matches) : null;
    const summary = agg ? `${esc(t("gamesAggregate"))}: ${agg.totalA} × ${agg.totalB} — ` : "";
    const autoTag = tie.lockedBy === "espn-auto" ? ` <span class="espn-auto-tag">${esc(t("espnAutoTag"))}</span>` : "";
    return `<div class="admin-row cdb-admin-tie" data-tie-id="${esc(tieId)}">
      <span class="tie-teams-admin">${esc(tie.teamA)} × ${esc(tie.teamB)}</span>
      <span class="leg-result-saved">✓ ${summary}${esc(t("gamesAdvances"))}: ${esc(tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB)}${autoTag}</span>
      <button type="button" class="secondary small-btn" data-unlock-tie="${esc(tieId)}" data-phase="${esc(phase.id)}">${esc(t("unlockResults"))}</button>
    </div>`;
  }

  const legs = legsForFormat(phase.format);
  const legRows = legs.map(leg => {
    const m = tie.matches?.[leg] || emptyMatch();
    const label = leg === "single" ? "" : leg === "first" ? t("gamesLeg1") : t("gamesLeg2");
    const home = leg === "second" ? tie.teamB : tie.teamA;
    const away = leg === "second" ? tie.teamA : tie.teamB;
    if (m.goalsHome != null) {
      const autoTag = m.resultSource === "espn-auto" ? ` <span class="espn-auto-tag">${esc(t("espnAutoTag"))}</span>` : "";
      return `<div class="admin-leg-row" data-tie-id="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">
        ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
        <span class="leg-teams-admin">${esc(home)} × ${esc(away)}</span>
        <span class="leg-result-saved">✓ ${m.goalsHome} × ${m.goalsAway}${autoTag}</span>
        <button type="button" class="secondary small-btn" data-edit-leg="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">${esc(t("edit"))}</button>
      </div>`;
    }
    return `<div class="admin-leg-row" data-tie-id="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">
      ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
      <span class="leg-teams-admin">${esc(home)} × ${esc(away)}</span>
      <input type="number" min="0" max="20" class="adm-leg-a" aria-label="${esc(home)}">
      <span class="tie-x">×</span>
      <input type="number" min="0" max="20" class="adm-leg-b" aria-label="${esc(away)}">
      <button type="button" class="small-btn" data-save-leg="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">${esc(t("saveLegResult"))}</button>
    </div>`;
  }).join("");

  const allSaved = legs.every(leg => tie.matches?.[leg]?.goalsHome != null);
  let aggregateBlock = "";
  if (allSaved) {
    let totalA, totalB;
    if (phase.format === "TWO_LEG") {
      const agg = aggregateFromMatches(tie.matches);
      totalA = agg.totalA; totalB = agg.totalB;
    } else {
      totalA = tie.matches.single.goalsHome; totalB = tie.matches.single.goalsAway;
    }
    const tied = totalA === totalB;
    aggregateBlock = `<div class="admin-tie-aggregate">
      <span class="leg-label">${esc(t("aggregatePreview"))}</span>
      <span class="leg-teams-admin">${totalA} × ${totalB}</span>
      ${tied
        ? `<span class="admin-tie-penalties-inputs" data-visual-role="admin-penalties-input">
             <label>${esc(t("gamesPenalties"))} ${esc(tie.teamA)}: <input type="number" min="0" class="adm-penalties-home" style="width:3.5em"></label>
             <label>${esc(t("gamesPenalties"))} ${esc(tie.teamB)}: <input type="number" min="0" class="adm-penalties-away" style="width:3.5em"></label>
           </span>
           <select class="adm-qualified" aria-label="${esc(t("pickQualifiedLabel"))}">
             <option value="">${esc(t("pickSelectAdvance"))}</option>
             <option value="A">${esc(tie.teamA)}</option>
             <option value="B">${esc(tie.teamB)}</option>
           </select>`
        : `<span class="leg-teams-admin">${esc(t("gamesAdvances"))}: ${esc(totalA > totalB ? tie.teamA : tie.teamB)}</span>`}
      <button type="button" class="small-btn" data-lock-tie="${esc(tieId)}" data-phase="${esc(phase.id)}" data-total-a="${totalA}" data-total-b="${totalB}">${esc(t("saveResults"))}</button>
    </div>`;
  }

  return `<div class="admin-tie-block" data-tie-block="${esc(tieId)}">
    <div class="tie-teams-admin">${esc(tie.teamA)} × ${esc(tie.teamB)}</div>
    ${legRows}
    ${aggregateBlock}
  </div>`;
}

function renderAdminResults(s) {
  const box = $("adminResults");
  if (!box) return;

  let html = `<h3>${esc(t("adminResults"))}</h3>`;
  let anyTies = false;
  DATA.phases.forEach(phase => {
    const ties = Object.entries(s.phases?.[phase.id]?.ties || {}).filter(([, tie]) => tie.teamA && tie.teamB);
    if (!ties.length) return;
    anyTies = true;
    html += `<div class="admin-round-header">${esc(phase.name)}</div>`;
    ties.forEach(([tieId, tie]) => { html += renderAdminResultsForTie(phase, tieId, tie); });
  });
  box.innerHTML = anyTies ? html : `<h3>${esc(t("adminResults"))}</h3><p class="muted">${esc(t("waitingDraw"))}</p>`;

  box.querySelectorAll("[data-save-leg]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const tieId = btn.dataset.saveLeg, phaseId = btn.dataset.phase, leg = btn.dataset.leg;
    const row = box.querySelector(`.admin-leg-row[data-tie-id="${tieId}"][data-phase="${phaseId}"][data-leg="${leg}"]`);
    const a = parseInt(row.querySelector(".adm-leg-a").value, 10);
    const b = parseInt(row.querySelector(".adm-leg-b").value, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) { alert(t("errorLegIncomplete")); return; }
    // Achado em auditoria (2026-07-14): o atributo HTML max="20" não bloqueia envio via JS, e ao
    // contrário de excluir/travar/destravar confronto (que já pedem confirm()), lançar um placar
    // real não pedia nada -- um typo mudava o ranking público na hora, sem nenhuma barreira.
    if (a > 20 || b > 20) { alert(t("errorLegScoreRange")); return; }
    // Sempre triple-confirm ao lançar um placar manual — publica na hora, sem passar pelo ESPN
    // auto-sync (que já é confiável e não passa por aqui). Ver tripleConfirm() acima.
    if (!tripleConfirm(t("confirmSaveLeg").replace("{a}", a).replace("{b}", b), t("tripleConfirmDetail"))) return;
    const s2 = state();
    const tie = s2.phases[phaseId].ties[tieId];
    const home = leg === "second" ? tie.teamB : tie.teamA;
    const away = leg === "second" ? tie.teamA : tie.teamB;
    const match = { ...(tie.matches[leg] || emptyMatch()), homeTeam: home, awayTeam: away, goalsHome: a, goalsAway: b, status: "FINAL", resultSource: "admin" };
    tie.matches[leg] = match;
    appendAdminAuditLog(s2, "save-leg", { phase: phaseId, tieId, leg, teamA: home, teamB: away, goalsHome: a, goalsAway: b });
    // Limpa os campos ANTES de salvar -- saveState() chama renderAll() de forma síncrona, e
    // adminResultsFormIsDirty() (novo, ver renderAdmin()) leria esses mesmos inputs ainda com "a"/
    // "b" digitados no DOM antigo (a reconstrução ainda não rodou) e bloquearia a própria
    // atualização que deveria mostrar o placar recém-salvo. Bug pego pelo teste automatizado
    // (test_round2_fixes.js) antes de chegar em produção.
    row.querySelector(".adm-leg-a").value = "";
    row.querySelector(".adm-leg-b").value = "";
    saveState(s2, { mutation: { type: "save-leg", phaseId, tieId, leg, match } });
    showToast(t("legResultSaved"), "success");
  }));
  box.querySelectorAll("[data-edit-leg]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    // Achado em auditoria (2026-07-14): "Editar" apagava um placar já lançado imediatamente, sem
    // confirmação -- um mis-click descartava um resultado oficial sem nenhum jeito de desfazer.
    if (!tripleConfirm(t("confirmEditLeg"), t("tripleConfirmDetail"))) return;
    const s2 = state();
    const phaseId = btn.dataset.phase, tieId = btn.dataset.editLeg, leg = btn.dataset.leg;
    const tie = s2.phases[phaseId]?.ties?.[tieId];
    const m = tie?.matches?.[leg];
    if (m) {
      appendAdminAuditLog(s2, "edit-leg", { phase: phaseId, tieId, leg, previousGoalsHome: m.goalsHome, previousGoalsAway: m.goalsAway });
      m.goalsHome = null;
      m.goalsAway = null;
      m.status = "SCHEDULED";
      saveState(s2, { mutation: { type: "clear-leg", phaseId, tieId, leg } });
    } else {
      saveState(s2);
    }
  }));
  box.querySelectorAll("[data-lock-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const tieId = btn.dataset.lockTie, phaseId = btn.dataset.phase;
    const totalA = parseInt(btn.dataset.totalA, 10), totalB = parseInt(btn.dataset.totalB, 10);
    const block = box.querySelector(`[data-tie-block="${tieId}"]`);
    let qualified;
    // Football-hardening checkpoint E: optional penalty-score entry, ONLY shown/read when the
    // aggregate is tied (totalA === totalB). Purely additive — if left blank, behavior is
    // byte-for-byte identical to before (qualified from the dropdown, no penalty fields at all).
    let penaltiesHome = null, penaltiesAway = null, penaltiesWinnerTeamId = null;
    if (totalA === totalB) {
      qualified = block.querySelector(".adm-qualified")?.value;
      if (!qualified) { alert(t("errorAdminAdvanceRequired")); return; }
      const penHomeRaw = block.querySelector(".adm-penalties-home")?.value;
      const penAwayRaw = block.querySelector(".adm-penalties-away")?.value;
      if (penHomeRaw !== "" && penAwayRaw !== "" && penHomeRaw != null && penAwayRaw != null) {
        const ph = parseInt(penHomeRaw, 10), pa = parseInt(penAwayRaw, 10);
        if (!Number.isNaN(ph) && !Number.isNaN(pa) && ph !== pa) {
          penaltiesHome = ph; penaltiesAway = pa;
          // Team-keyed (A/B), never leg-home/away-keyed — same guarantee as tieProgressDisplay().
          penaltiesWinnerTeamId = ph > pa ? "A" : "B";
          if (penaltiesWinnerTeamId !== qualified) {
            // The dropdown and the penalty scores disagree on who advances — refuse to save
            // silently-inconsistent data; the admin must reconcile which one is right.
            alert(t("errorAdminAdvanceRequired"));
            return;
          }
        }
      }
    } else {
      qualified = totalA > totalB ? "A" : "B";
    }
    if (!tripleConfirm(t("confirmLockResults"), t("tripleConfirmDetail"))) return;
    const s2 = state();
    const lockedAt = new Date().toISOString();
    s2.phases[phaseId].ties[tieId].qualifiedTeamId = qualified;
    s2.phases[phaseId].ties[tieId].lockedAt = lockedAt;
    s2.phases[phaseId].ties[tieId].lockedBy = "admin";
    if (penaltiesHome != null) {
      s2.phases[phaseId].ties[tieId].penaltiesHome = penaltiesHome;
      s2.phases[phaseId].ties[tieId].penaltiesAway = penaltiesAway;
      s2.phases[phaseId].ties[tieId].penaltiesWinnerTeamId = penaltiesWinnerTeamId;
    }
    appendAdminAuditLog(s2, "lock-tie", { phase: phaseId, tieId, qualifiedTeamId: qualified, totalA, totalB, penaltiesHome, penaltiesAway });
    saveState(s2, { mutation: { type: "lock-tie", phaseId, tieId, qualifiedTeamId: qualified, lockedAt, lockedBy: "admin", penaltiesHome, penaltiesAway, penaltiesWinnerTeamId } });
    showToast(t("resultsSaved"), "success");
  }));
  box.querySelectorAll("[data-unlock-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!tripleConfirm(t("confirmUnlockResults"), t("tripleConfirmDetail"))) return;
    const s2 = state();
    const phaseId = btn.dataset.phase, tieId = btn.dataset.unlockTie;
    const tie = s2.phases[phaseId]?.ties?.[tieId];
    if (tie) {
      appendAdminAuditLog(s2, "unlock-tie", { phase: phaseId, tieId, previousQualifiedTeamId: tie.qualifiedTeamId, previousLockedAt: tie.lockedAt, previousLockedBy: tie.lockedBy });
      delete tie.qualifiedTeamId; delete tie.lockedAt; delete tie.lockedBy;
    }
    saveState(s2, { mutation: { type: "unlock-tie", phaseId, tieId } });
  }));
}

function renderAdminPayments(s) {
  const box = $("adminPayments");
  if (!box) return;
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  box.innerHTML = `<h3>${esc(t("adminPayments"))}</h3>` + entries.map(e => {
    const isPaid = (s.paid || {})[e.id];
    return `<div class="admin-row">
      <span>${esc(e.entryName)}</span>
      <span class="muted small-text">${esc(e.paymentMethod || "")}</span>
      <button type="button" class="small-btn ${isPaid ? "secondary" : ""}" data-toggle-paid="${esc(e.id)}">${esc(isPaid ? t("markUnpaid") : t("markPaid"))}</button>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-toggle-paid]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const id = btn.dataset.togglePaid;
    const s2 = state();
    s2.paid = s2.paid || {};
    const before = !!s2.paid[id];
    s2.paid[id] = !before;
    // Pagamento é dinheiro real e era a única ação de admin que mexia em dinheiro sem deixar
    // rastro nenhum no audit log (achado da auditoria de 2026-08, AUDIT-08). Guarda antes/depois
    // para reconstruir quem estava pago em qualquer momento.
    appendAdminAuditLog(s2, "toggle-paid", {
      entryId: id,
      entryName: (s2.entries || []).find(e => e.id === id)?.entryName || null,
      from: before, to: !before,
    });
    saveState(s2, { localOnly: false, mutation: { type: "set-payment", entryId: id, value: !before } });
  }));
}

function renderAdminEntries(s) {
  const box = $("adminEntries");
  if (!box) return;
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  box.innerHTML = `<h3>${esc(t("adminEntries"))}</h3>` + (entries.length ? entries.map(e => `
    <div class="admin-row">
      <span>${esc(e.entryName)}</span>
      <span class="muted small-text">${esc(e.participantEmail || "")}</span>
      <button type="button" class="danger small-btn" data-delete-entry="${esc(e.id)}">${esc(t("delete"))}</button>
    </div>`).join("") : `<p class="muted">${esc(t("noEntries"))}</p>`);

  box.querySelectorAll("[data-delete-entry]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!confirm(t("confirmDelete"))) return;
    const s2 = state();
    s2.deletedIds = s2.deletedIds || [];
    const delId = btn.dataset.deleteEntry;
    s2.deletedIds.push(delId);
    // Exclusão de entrada é soft-delete (o objeto continua em `entries`, só entra na tombstone
    // list), mas não deixava NENHUM rastro de quem/quando -- numa disputa por dinheiro real esse
    // é exatamente o registro que faz falta. Achado da auditoria de 2026-08 (AUDIT-08).
    const delEntry = (s2.entries || []).find(e => e.id === delId);
    appendAdminAuditLog(s2, "delete-entry", {
      entryId: delId,
      entryName: delEntry?.entryName || null,
      participantEmail: delEntry?.participantEmail || null,
      wasPaid: !!s2.paid?.[delId],
    });
    saveState(s2, { mutation: { type: "delete-entry", entryId: delId } });
  }));
}

// ─── Export CSV ──────────────────────────────────────────────────────────────
function exportCsv() {
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  const header  = ["Nome", "Pagador", "Email", "Pagamento", "Campeão", "Vice", "Pago", "Criado", "Palpites"];
  const rows    = [header];
  entries.forEach(e => {
    const predicted = predictedPodium(e, s);
    const lines = [];
    DATA.phases.forEach(phase => {
      // Ordem cronológica real POR PERNA -- ver flatLegsChronological() (achado por Eduardo,
      // 2026-08-02: agrupar ida+volta de um confronto sempre juntas descola da ordem real quando
      // a volta de um confronto acontece antes da ida de outro).
      flatLegsChronological(s, phase).forEach(({ tieId, tie, leg }) => {
        const pickMatches = e.picks?.matches?.[tieId];
        if (!pickMatches) return;
        const pick = pickMatches[leg];
        if (!pick) return;
        const legLabel = leg === "single" ? "" : leg === "first" ? " (ida)" : " (volta)";
        const { home: cHome, away: cAway } = legTeams(tie, leg, tie.matches?.[leg]);
        lines.push(`${cHome} ${pick.goalsHome}x${pick.goalsAway} ${cAway}${legLabel}`);
      });
    });
    rows.push([
      e.entryName, e.payerName || "", e.participantEmail || "", e.paymentMethod || "",
      predicted.champion || "", predicted.runnerUp || "",
      (s.paid || {})[e.id] ? "Sim" : "Não",
      e.createdAt ? formatBrtTimestamp(e.createdAt) : "",
      lines.join(" | ")
    ]);
  });
  const csv  = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `cdb2026_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Export JSON backup ───────────────────────────────────────────────────────
function exportJsonBackup() {
  const s    = state();
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `cdb2026_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Clear all data (admin) ───────────────────────────────────────────────────
async function clearAllData() {
  if (!confirm(t("clearDataConfirm"))) return;
  localStorage.removeItem(C.storeKey);
  // REMOVIDO — PLATFORM-WHOLE-DOC-WRITERS.
  //
  // Aqui havia um DELETE CRU da linha inteira do bolao, com a chave anon publica que este arquivo
  // ja carrega. Medido hoje como DENIED: as policies de escrita sairam no Q38. Mas codigo morto
  // que apaga um bolao inteiro nao e codigo seguro -- basta uma policy restaurada por engano para
  // que volte a alcancar, e o `catch` logo abaixo engolia o erro em silencio, entao ninguem
  // notaria a diferenca entre "negado" e "apagou".
  //
  // A limpeza local continua acontecendo (saveLocalState acima); a remota, se algum dia for
  // necessaria, passa pelo runtime confiavel de operador.
  renderAll();
}

// Real bug found by Eduardo (2026-07-14): renderPickForm() rebuilds #pickForm's entire innerHTML
// from scratch every time renderAll() runs. renderAll() also runs from a BACKGROUND resync
// (reloadRemoteIfVisible(), gated by _editingEntry) — but _editingEntry is only set when the user
// loaded an EXISTING saved entry; a brand-new, never-saved entry leaves it null the entire time
// it's being filled out. Opening the "quem se classifica" <select> triggers a window blur/focus
// cycle on many browsers/mobile (the native picker takes and returns focus), which fires the
// `focus` listener -> debouncedReload() -> renderAll() -> renderPickForm() mid-typing, wiping
// every score/pick the participant hadn't saved yet. Reproduced and confirmed with Playwright
// (dispatch a focus event mid-fill -> the just-typed goal is gone ~1s later, once the background
// fetch settles). Same code pattern exists in BR2026 (also fixed) — Copa doesn't have this bug,
// its renderBracket() (builds the form) and updateDynamic() (called every renderAll()) are
// already separate functions, so a resync there never touches the live input elements.
// Fix: never blow away a form the user is actively typing into, regardless of why renderAll() ran.
function pickFormIsDirty() {
  const form = $("pickForm");
  if (!form) return false;
  return [...form.querySelectorAll(".pk-goals-home, .pk-goals-away")].some(el => el.value !== "") ||
         [...form.querySelectorAll(".pk-qualified")].some(el => el.value !== "");
}

// ─── Render all ──────────────────────────────────────────────────────────────
function renderAll() {
  applyI18n();
  renderFindEntryCard();
  renderNewEntryCard();
  if (!pickFormIsDirty()) renderPickForm();
  renderRanking();
  renderNextTieCard();
  renderLiveTieCard();
  renderLiveRankingHero();
  renderGamesSection();
  renderProbsSection();
  renderParticipants();
  renderPayment();
  renderRules();
  renderFooter();
  if (isAdminActive()) renderAdmin();
  nudgeScrollReflow();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const wa = $("supportWhatsappBtn");
  if (wa) wa.href = C.whatsappGroup?.link || "#";

  $$("[data-section]").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.section)));
  // Disable "Palpites" nav button only after the active phase's cutoff; default landing depends
  // on it — same pattern as Copa (bolao/js/app.js init()), propagated here alongside BR2026.
  const navEntryBtn = document.querySelector('.nav button[data-section="entry"]');
  if (navEntryBtn) navEntryBtn.disabled = isPastEntryCutoff();
  showSection(isPastEntryCutoff() ? "ranking" : "entry");

  $("bolaoSelect")?.addEventListener("change", e => {
    const allowed = ["/bolao/copa2026/", "/bolao/br2026/", "/bolao/cdb2026/"];
    if (allowed.includes(e.target.value)) location.href = e.target.value;
  });

  renderCountdown();
  // Mesmo tick de 1s do BR2026/Copa -- antes renderNextTieCard() só re-renderizava via renderAll()
  // (save, resync a cada 30s), então o contador do card "Próxima partida" nunca atualizava ao
  // vivo entre um re-render e outro. Divergência real encontrada por Eduardo (2026-07-14).
  // renderLiveTieCard() no mesmo tick: só re-renderiza o relógio já interpolado em memória
  // (liveClockDisplay), sem rede — o poll de rede real é o setInterval de 60s logo abaixo.
  // navEntryBtn.disabled (linha ~3555/~3671) só era decidido no load -- uma sessão aberta desde
  // antes do cutoff continuava mostrando "Palpites" habilitado depois do prazo passar de verdade,
  // até um F5. Reavalia no mesmo tick de 1s (mesmo timer do countdown, que já teria zerado nesse
  // momento) -- direção fechado->aberto já tratada em showSection() logo abaixo; aqui só o botão.
  setInterval(() => {
    if (document.hidden) return;
    renderCountdown(); renderNextTieCard(); renderLiveTieCard();
    if (navEntryBtn) navEntryBtn.disabled = isPastEntryCutoff();
  }, 1000);

  // Poll de partida ao vivo (2026-07-15) -- mesma cadência de 60s da Copa/BR2026
  // (pollLiveScores/pollAll), separado do sync de resultado FINAL a cada 5 min
  // (autoSyncEspnFull, acima) -- concerns diferentes: este é só pra exibição em tempo real
  // enquanto o jogo está rolando, nunca grava nada no estado/Supabase.
  // O laco ao vivo passou a ser do store compartilhado (F13): ele tem singleton de timer,
  // cadencia adaptativa, backoff limitado e guarda contra reagendamento apos stop().
  initLiveStore();
  pollLiveTies();

  $("saveEntryBtn")?.addEventListener("click", saveEntry);
  $("paymentMethod")?.addEventListener("change", renderPaymentBox);

  $("findEntryBtn")?.addEventListener("click", async () => {
    if (!oitavasComplete(state())) { showToast(t("findEntryLockedMsg"), "warn"); return; }
    const code  = $("findEntryCode")?.value.trim() || "";
    if (!code) { alert(t("findEntryMissing")); return; }
    // O campo passou a aceitar o CODIGO DE ACESSO do link. A busca acontece no SERVIDOR: o
    // navegador nao tem mais o e-mail de ninguem para comparar, e e exatamente esse o ponto.
    let found = null;
    try { found = await loadOwnEntryByToken(code); }
    catch (err) { console.warn("[CDB2026] lookup seguro falhou", err); }
    if (!found) { showToast(t("findEntryNotFound"), "error"); return; }
    _editingEntry = found;
    _picksEmMemoria = null;   // o overlay pertence a UMA edição
    renderPickForm();
    preencheNomeDaEntradaConfiavel(found);
    // payerName/participantEmail/paymentMethod NAO vem mais: a leitura segura devolve so o que
    // o formulario de palpite precisa. O participante nao edita dado de pagamento por aqui.
    renderPaymentBox();
    // ENTRY ROSTER FREEZE: revela o formulário de palpites agora que há uma entrada existente
    // carregada — com o roster congelado este é o único caminho até as próximas fases.
    renderNewEntryCard();
    showToast(t("findEntryLoaded"), "success");
  });

  $("adminPassword")?.addEventListener("keydown", e => { if (e.key === "Enter") $("adminLoginBtn")?.click(); });
  $("adminLoginBtn")?.addEventListener("click", async () => {
    const now = Date.now();
    if (now < _loginLockUntil) {
      showToast(t("adminLocked").replace("{min}", Math.ceil((_loginLockUntil - now) / 60000)), "warn"); return;
    }
    const pw   = $("adminPassword")?.value || "";
    const hash = await sha256hex(pw);
    if (hash === C.adminPasswordHash) {
      _loginAttempts = 0;
      sessionStorage.removeItem("cdb2026_loginAttempts");
      sessionStorage.setItem("cdb2026_adminUntil", String(Date.now() + C.adminSessionMinutes * 60000));
      $("adminLogin")?.classList.add("hidden");
      $("adminArea")?.classList.remove("hidden");
      renderAdmin();
    } else {
      _loginAttempts++;
      sessionStorage.setItem("cdb2026_loginAttempts", _loginAttempts);
      if (_loginAttempts >= C.adminMaxAttempts) {
        _loginLockUntil = Date.now() + C.adminLockMinutes * 60000;
        sessionStorage.setItem("cdb2026_loginLockUntil", _loginLockUntil);
        showToast(t("adminLockedNow").replace("{min}", C.adminLockMinutes), "warn");
      } else {
        showToast(t("adminWrongPassword").replace("{n}", C.adminMaxAttempts - _loginAttempts), "error");
      }
    }
  });

  $("adminLogoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("cdb2026_adminUntil");
    $("adminLogin")?.classList.remove("hidden");
    $("adminArea")?.classList.add("hidden");
  });

  $("exportCsvBtn")?.addEventListener("click", () => { if (guardAdmin()) exportCsv(); });
  $("exportJsonBtn")?.addEventListener("click", () => { if (guardAdmin()) exportJsonBackup(); });
  $("clearDataBtn")?.addEventListener("click", () => { if (guardAdmin()) clearAllData(); });
  $("forceSyncBtn")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    await loadRemoteState();
    renderAll();
    showToast(t("syncDone"), "success");
  });

  if (isAdminActive()) {
    $("adminLogin")?.classList.add("hidden");
    $("adminArea")?.classList.remove("hidden");
  }

  await loadRemoteState();
  // Roda depois do merge com o Supabase (nunca antes) — nunca semeia por cima do que outro
  // dispositivo já salvou. Persiste na primeira vez que o flag vira true, mesmo se nada novo foi
  // de fato adicionado (ex.: outro dispositivo já semeou e isso só chegou agora via merge) — ver
  // seedKnownConfrontos() e docs/bolao/CDB2026_RULES_AND_MODEL.md seção 7 "Confrontos já sorteados".
  const seedState  = state();
  const wasSeeded   = !!seedState.espnSync.seededKnownConfrontos;
  const wasBackfilled = !!seedState.espnSync.backfilledOitavasKickoffs;
  const wasHealed = !!seedState.espnSync.healedFalseAutoResults;
  const wasHealedPhantoms = !!seedState.espnSync.healedPhantomTies;
  seedKnownConfrontos(seedState);
  backfillOitavasKickoffs(seedState);
  healFalseEspnAutoResults(seedState);
  healPhantomTies(seedState);
  if (!wasSeeded || !wasBackfilled || !wasHealed || !wasHealedPhantoms) saveState(seedState, { localOnly: false });
  renderAll();

  // LINK SEGURO DO CONVITE. Roda DEPOIS do merge remoto: o formulario de palpite so faz sentido
  // com os confrontos e o prazo ja carregados. O token vem no fragmento (#t=...), que o
  // navegador nao manda no Referer -- entao ele nao vaza para terceiros se a pagina carregar
  // qualquer recurso externo.
  if (await autoLoadFromSecureLink()) renderAll();

  // 2026-08-01, hotfix: navEntryBtn.disabled/showSection acima (linha ~3382) decidem uma vez só,
  // a partir do localStorage local, ANTES do merge com o Supabase. Um participante que já tinha a
  // Oitavas em cache local como "cutoff passado" continuava vendo o botão "Palpites" desabilitado
  // mesmo depois do merge trazer um cutoffOffsetMs novo que reabre a entrada -- nada reavaliava
  // essa decisão depois do loadRemoteState() acima. Reavalia aqui, e só força a aba de volta para
  // "entry" na direção fechado→aberto (a direção aberto→fechado não precisa: saveEntry() já
  // rejeita o envio se o cutoff passar enquanto o formulário está aberto).
  if (navEntryBtn) {
    const stillPastCutoff = isPastEntryCutoff();
    if (navEntryBtn.disabled && !stillPastCutoff) showSection("entry");
    navEntryBtn.disabled = stillPastCutoff;
  }

  // Resume live-tie polling right away on focus/visible/bfcache-restore instead of waiting out
  // whatever's left of the current 60s cycle -- unconditional (not gated on C.database.enabled),
  // since ESPN live scores/clock work independently of Supabase. Same class of gap as the
  // Supabase resync below (see its comment): Copa already re-triggers its own live-score poll
  // from focus/pageshow (startLiveScorePolling()) after a real past incident; this app's
  // handlers only resynced Supabase, leaving the live-tie card free to go stale until a manual
  // reload -- found auditing BR2026's identical gap (Eduardo, 2026-07-25: "have to refresh to
  // get an updated score and clocks are not in sync with the actual game time").
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLiveTies(); });
  window.addEventListener("focus", pollLiveTies);
  window.addEventListener("pageshow", e => { if (e.persisted) pollLiveTies(); });

  if (C.database.enabled) {
    setInterval(() => { if (!document.hidden && !_editingEntry) debouncedReload(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) debouncedReload(); });
    window.addEventListener("focus", debouncedReload);
    // iOS Safari can restore a backgrounded tab from bfcache without reliably firing
    // visibilitychange, leaving the page stuck on whatever state was in memory at the last real
    // load — force a resync whenever that happens. Same fix already applied to the Copa
    // (bolao/js/app.js) after a real incident where a stale local browser state won a merge
    // against fresher Supabase data; see docs/bolao/LESSONS_LEARNED.md "Safari" / "Supabase —
    // merge/sync". mergeStates() here already applies preferRemoteResults:true on every load, so
    // the missing piece was purely "reliably trigger that reload", not the merge rule itself.
    window.addEventListener("pageshow", e => { if (e.persisted) debouncedReload(); });
  }
}

document.addEventListener("DOMContentLoaded", init);

// Read-only test hooks — pure functions only, no state mutation exposed. Mesmo padrão do BR2026
// (window.__BR2026_TESTHOOKS__, bolao/br2026/js/app.js).
window.__CDB2026_TESTHOOKS__ = { rankEntriesBy, calculateRankingMovement, liveScoreEntry, scoreEntry, matchPoints, extractMatchPlays, explainScore, legTeams, formatBrtTimestamp, SCORING_RULE_VERSION, tieProgressDisplay, aggregateFromMatches };
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/bolao/sw.js').catch(() => {});
}

// Reload when a new deploy is detected — on tab focus and every 10 min
(function startVersionPolling() {
  // Bug real encontrado em auditoria (2026-07-14): sem essa checagem, um deploy no meio do
  // preenchimento do formulário de palpites apagava tudo sem aviso (location.reload() forçado).
  // Mesma checagem de pickFormIsDirty() lá em cima, duplicada aqui porque esta IIFE roda fora do
  // escopo do módulo principal (não tem acesso às funções internas).
  function formIsDirty() {
    const form = document.getElementById("pickForm");
    if (!form) return false;
    return [...form.querySelectorAll(".pk-goals-home, .pk-goals-away")].some(el => el.value !== "") ||
           [...form.querySelectorAll(".pk-qualified")].some(el => el.value !== "");
  }
  async function checkVersion() {
    if (document.hidden || formIsDirty()) return;
    try {
      // Escopo isolado desta IIFE não enxerga o fetchJson() do módulo principal -- timeout
      // inline equivalente (item 50 do CONSISTENCY_MATRIX.md, 2026-07-15).
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let r;
      try { r = await fetch(`js/config.js?nc=${Date.now()}`, { signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      const text = await r.text();
      const m = text.match(/siteVersion:\s*"([^"]+)"/);
      if (m && m[1] !== window.CDB2026_CONFIG?.siteVersion) location.reload();
    } catch (e) { /* network hiccup — next poll retries, nothing to recover here */ }
  }
  setInterval(checkVersion, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
}());
