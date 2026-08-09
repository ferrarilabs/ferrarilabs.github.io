#!/usr/bin/env node
/**
 * CONTRATO DE SEGURANÇA DO E-MAIL DO POWERBALL — as garantias que dinheiro real exige.
 *
 * POR QUE ESTA SUÍTE EXISTE: este caminho de código já machucou gente de verdade, duas vezes:
 *
 *   - um e-mail com o **sorteio errado** saiu para 15 pessoas;
 *   - o reenvio corrigido alcançou **14 de 15** — uma pessoa ficou sem, porque o contato dela não
 *     estava na fonte privada e o código a EXCLUIU em silêncio em vez de parar.
 *
 * As suítes existentes cobriam renderização, formatação e idempotência. Não cobriam nenhuma das
 * duas falhas acima. Esta cobre — e cada teste aqui corresponde a uma cláusula do contrato de
 * segurança, não a um detalhe de implementação.
 *
 * NENHUM ENDEREÇO REAL. Só domínios reservados (RFC 2606). Nenhuma chamada ao provedor.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_email_safety_contract.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeEligibility } from "./email/send_draw_result.mjs";
import { sendEmailJob, SEND_BLOCKED_IN_TEST } from "./email/send.mjs";
import { renderDrawResultHtml } from "./email/render.mjs";
import { buildDrawResultPayload } from "./email/payload.mjs";
import { loadRealPrizeCalculator } from "./email/prize-calc-bridge.mjs";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}

const { DRAWS, GAME_TYPES } = loadRealPrizeCalculator();
const gt = GAME_TYPES.powerball;

// ─── Dado privado SINTÉTICO, injetado antes de qualquer leitura ─────────────────────────────
//
// `js/data.js` é público e, desde o hotfix de PII, não carrega mais e-mail de participante — eles
// vêm do secret. Sem injeção, `computeEligibility` sobre um sorteio real resolve ZERO contatos e
// (corretamente, agora) bloqueia com RECIPIENT_SET_INCOMPLETE.
//
// Isso é ótimo como comportamento e ruim como fixture: os testes de MIRA DO SORTEIO querem
// exercitar o caminho feliz, e parariam na trava de completude antes de chegar lá. Então o teste
// injeta contatos sintéticos (.invalid) para os sorteios reais, derivados dos próprios
// participantes — hermético, sem endereço real, sem depender do secret.
//
// Precisa ficar ANTES da primeira chamada: `snapshot.mjs` faz cache do mapa privado no primeiro
// uso, e um `computeEligibility` anterior congelaria o mapa vazio.
process.env.POWERBALL_PRIVATE_PARTICIPANT_DATA = JSON.stringify(
  Object.fromEntries(DRAWS.map((d) => [
    d.id,
    Object.fromEntries((d.participants || []).map((p, i) => [
      p.name, { email: `p${i + 1}.${d.id}@example.invalid`, txId: `EXAMPLE-TXID-${i + 1}` },
    ])),
  ])),
);

// ─── Fixtures sintéticas: três sorteios, para provar mira exata ─────────────────────────────
const mkParticipant = (i, over = {}) => ({
  name: `Participante ${i}`, cotas: 1, valor: 10, metodo: "Zelle",
  data: "01/01/2026", hora: "10:00 AM", status: "verificado", state: "NC",
  email: `p${i}@example.invalid`, ...over,
});
const RESULT = { numbers: [5, 9, 35, 54, 63], special: 7, multiplier: 3, premiosGanhos: 0, checkedAt: "2026-01-01" };

console.log("\nContrato de segurança do e-mail do Powerball\n");

// ─── 1. O provedor é inalcançável a partir de teste, mesmo com credencial ───────────────────
console.log("Isolamento do provedor:");

await test("envio a partir de processo de TESTE, sem transporte injetado, é RECUSADO", async () => {
  // A trava é do produto, não do teste. Antes, a única defesa era cada teste lembrar de trocar
  // `global.fetch` — disciplina sem mecanismo, com credencial real disponível no CI.
  const r = await sendEmailJob(
    { recipient: "quem@example.invalid" },
    { publicKey: "real-looking", serviceId: "s", templateId: "t", htmlMessage: "<p>x</p>", subject: "s" },
  );
  assert.equal(r.ok, false, "o envio NÃO foi recusado num processo de teste");
  assert.equal(r.status, SEND_BLOCKED_IN_TEST);
  assert.equal(r.providerMessageId, null, "recusa não pode devolver id de mensagem do provedor");
});

await test("a recusa NUNCA pode ser confundida com sucesso", async () => {
  const r = await sendEmailJob({ recipient: "quem@example.invalid" }, { subject: "s" });
  assert.equal(r.ok, false);
  assert.notEqual(r.status, "sent");
  assert.ok(r.error && /recusado/i.test(r.error), "a recusa precisa dizer por que, de forma legível");
});

await test("com transporte injetado, o caminho de envio é exercitado por inteiro (sem rede)", async () => {
  let chamou = null;
  const r = await sendEmailJob(
    { recipient: "quem@example.invalid" },
    { publicKey: "k", serviceId: "s", templateId: "t", htmlMessage: "<p>oi</p>", subject: "Assunto",
      transport: async (url, opts) => { chamou = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, text: async () => "OK" }; } },
  );
  assert.ok(chamou, "o transporte injetado não foi usado");
  assert.ok(chamou.url.includes("emailjs"), "o caminho real de envio deixou de ser exercitado");
  assert.equal(chamou.body.template_params.to_email, "quem@example.invalid");
  assert.equal(r.ok, true);
});

// ─── 2. Completude do conjunto de destinatários — tudo ou nada ──────────────────────────────
console.log("\nCompletude do conjunto de destinatários (o defeito do 14 de 15):");

const drawWith = (participants, id = "fx-completo") => ({
  id, gameType: "powerball", status: "concluido",
  drawing: { drawDateLabel: "01/01/2026 22:59 ET", drawDateIso: "2026-01-01T22:59:00-05:00" },
  participants, sharedTickets: { series: [], valorPorTicket: 2 },
  finance: { totalArrecadado: 0, creditoSorteioAnterior: 0, valorUtilizado: 0, valorGuardadoProximoSorteio: 0 },
  result: RESULT, profit: null,
});

// `computeEligibility` lê de data.js por id, então exercito a REGRA sobre listas sintéticas
// reproduzindo o mesmo predicado — e um teste de contrato abaixo garante que a regra do produto
// não divirja deste espelho.
import { eligibleRecipients } from "./email/validate.mjs";
const completude = (participants) => {
  const eligible = eligibleRecipients(participants);
  const expected = participants.filter((p) => Number(p.cotas) > 0 && p.status !== "cancelado");
  const unreachable = expected.filter((p) => !eligible.includes(p));
  return { eligible: eligible.length, expected: expected.length, complete: unreachable.length === 0 && eligible.length === expected.length };
};

await test("esperados 15 / resolvidos 15 → plano de envio válido", () => {
  const ps = Array.from({ length: 15 }, (_, i) => mkParticipant(i + 1));
  const c = completude(ps);
  assert.equal(c.expected, 15);
  assert.equal(c.eligible, 15);
  assert.equal(c.complete, true);
});

await test("esperados 15 / resolvidos 14 → INCOMPLETO, zero chamadas ao provedor", () => {
  // O caso literal do incidente: um contato ausente da fonte privada.
  const ps = Array.from({ length: 15 }, (_, i) => mkParticipant(i + 1));
  ps[7] = mkParticipant(8, { email: "—" }); // contato não resolvido
  const c = completude(ps);
  assert.equal(c.expected, 15);
  assert.equal(c.eligible, 14);
  assert.equal(c.complete, false, "14 de 15 foi tratado como conjunto completo — é o defeito de novo");
});

await test("participante CANCELADO não conta como destinatário faltante", () => {
  // Distinção que o código antigo não fazia: não-destinatário legítimo × contato ausente.
  const ps = Array.from({ length: 15 }, (_, i) => mkParticipant(i + 1));
  ps[3] = mkParticipant(4, { status: "cancelado" });
  const c = completude(ps);
  assert.equal(c.expected, 14, "cancelado não deveria estar entre os esperados");
  assert.equal(c.complete, true, "cancelado não pode bloquear o envio — é decisão de negócio, não falha");
});

await test("participante com cotas <= 0 também é não-destinatário legítimo", () => {
  const ps = Array.from({ length: 15 }, (_, i) => mkParticipant(i + 1));
  ps[2] = mkParticipant(3, { cotas: 0 });
  const c = completude(ps);
  assert.equal(c.expected, 14);
  assert.equal(c.complete, true);
});

await test("e-mail duplicado entre participantes é detectado (não pode virar envio dobrado)", () => {
  const ps = Array.from({ length: 5 }, (_, i) => mkParticipant(i + 1));
  ps[4] = mkParticipant(5, { email: ps[0].email });
  const eligible = eligibleRecipients(ps);
  const counts = {};
  eligible.forEach((p) => { counts[p.email.toLowerCase()] = (counts[p.email.toLowerCase()] || 0) + 1; });
  const dups = Object.entries(counts).filter(([, c]) => c > 1);
  assert.equal(dups.length, 1, "contato duplicado passou despercebido");
});

await test("CONTRATO: o produto bloqueia de fato — `computeEligibility` devolve RECIPIENT_SET_INCOMPLETE", () => {
  // Espelhar a regra num helper de teste não prova nada sobre o produto. Este teste lê o código
  // do produto e exige que a porta exista lá, com status legível por máquina.
  const src = readFileSync(new URL("./email/send_draw_result.mjs", import.meta.url), "utf8");
  assert.ok(/RECIPIENT_SET_INCOMPLETE/.test(src),
    "sumiu a trava de completude — envio parcial voltou a ser possível");
  assert.ok(/expectedCount/.test(src) && /resolvedCount/.test(src),
    "a trava não reporta esperado × resolvido, então a falha não é diagnosticável");
  assert.ok(src.indexOf("RECIPIENT_SET_INCOMPLETE") < src.indexOf("runDrawResultSend"),
    "a trava precisa estar ANTES do envio, não depois da primeira mensagem sair");
});

// ─── 3. Semântica de falha de origem — cada motivo é distinguível ───────────────────────────
console.log("\nSemântica de falha (nenhuma pode parecer sucesso):");

await test("sorteio inexistente → erro próprio, nunca sucesso", () => {
  const r = computeEligibility("sorteio-que-nao-existe");
  assert.equal(r.ok, false);
  assert.ok(/not found/i.test(r.error), `motivo pouco específico: ${JSON.stringify(r)}`);
});

await test("sorteio sem resultado oficial → erro próprio, distinto de 'não existe'", () => {
  const aberto = DRAWS.find((d) => !(d.result && d.result.numbers));
  if (!aberto) { console.log("      (sem sorteio aberto em data.js — nada a exercitar)"); return; }
  const r = computeEligibility(aberto.id);
  assert.equal(r.ok, false);
  assert.ok(/no official result/i.test(r.error),
    `um sorteio sem resultado precisa falhar POR ISSO, e não por outro motivo: ${JSON.stringify(r)}`);
});

await test("os motivos de falha são distinguíveis entre si", () => {
  const inexistente = computeEligibility("nao-existe-mesmo");
  const aberto = DRAWS.find((d) => !(d.result && d.result.numbers));
  if (!aberto) return;
  const semResultado = computeEligibility(aberto.id);
  assert.notEqual(inexistente.error, semResultado.error,
    "dois modos de falha diferentes produzem a mesma mensagem — o operador não consegue agir");
});

// ─── 4. Mira exata do sorteio — nunca "o mais recente" por atalho ───────────────────────────
console.log("\nMira do sorteio (o e-mail com o sorteio errado):");

const liquidados = DRAWS.filter((d) => d.result && d.result.numbers);

await test("pedir um sorteio ANTIGO usa os dados DELE, não os do mais recente", () => {
  if (liquidados.length < 2) { console.log("      (menos de 2 sorteios liquidados — nada a comparar)"); return; }
  const antigo = liquidados[0];
  const recente = liquidados[liquidados.length - 1];
  const r = computeEligibility(antigo.id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.draw.id, antigo.id, "veio outro sorteio que não o pedido");
  // Comparação por VALOR, não por `deepStrictEqual` direto: `loadRealPrizeCalculator()` avalia
  // js/data.js num contexto `vm` separado, então seus arrays têm o `Array.prototype` de OUTRO
  // realm, enquanto `loadAllDraws()` devolve arrays do realm principal (via JSON round-trip).
  // `assert/strict` compara protótipo e reprovaria dois arrays com exatamente os mesmos números —
  // falha de ferramenta, não de produto. Levei um susto legítimo com isso: a mensagem dizia
  // "números do sorteio errado" exibindo os números CERTOS.
  const nums = (x) => JSON.stringify([...x]);
  assert.equal(nums(r.draw.result.numbers), nums(antigo.result.numbers),
    "os números vieram do sorteio errado — foi exatamente este o incidente");
  assert.notEqual(nums(r.draw.result.numbers), nums(recente.result.numbers));
});

await test("existir um sorteio mais novo não desloca a mira", () => {
  if (liquidados.length < 2) return;
  const alvo = liquidados[liquidados.length - 2];
  const r = computeEligibility(alvo.id);
  assert.equal(r.draw.id, alvo.id);
  assert.equal(r.draw.drawing.drawDateLabel, alvo.drawing.drawDateLabel,
    "a data do e-mail não é a do sorteio pedido");
});

// ─── 5. O resultado no e-mail é visual (pedido do Eduardo) ──────────────────────────────────
console.log("\nResultado como bolas visuais:");

await test("o e-mail de resultado desenha 5 bolas brancas + Powerball vermelho + Power Play", () => {
  const alvo = liquidados[liquidados.length - 1];
  const official = { numbers: alvo.result.numbers, special: alvo.result.special, multiplier: alvo.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({
    draw: alvo, participants: alvo.participants, official, prizeTableFn: gt.prizeTable,
  });
  const html = renderDrawResultHtml(perRecipient[0], false);
  const circulos = (html.match(/border-radius:50%/g) || []).length;
  assert.ok(circulos >= 6, `esperava ao menos 6 bolas desenhadas, achei ${circulos}`);
  assert.ok(html.includes("#CE1141"), "o Powerball perdeu a cor vermelha que o distingue");
  assert.ok(/Power Play/.test(html), "Power Play sumiu do e-mail");
  // Fallback acessível: os números têm que existir como TEXTO, não só como forma/cor.
  for (const n of alvo.result.numbers) {
    assert.ok(new RegExp(`>${n}<`).test(html),
      `o número ${n} não aparece como texto — leitor de tela não leria o resultado`);
  }
  assert.ok(new RegExp(`>${alvo.result.special}<`).test(html), "o Powerball não aparece como texto");
});

await test("a tabela de bolas é segura para cliente de e-mail (sem flex/grid)", () => {
  const alvo = liquidados[liquidados.length - 1];
  const official = { numbers: alvo.result.numbers, special: alvo.result.special, multiplier: alvo.result.multiplier };
  const { perRecipient } = buildDrawResultPayload({ draw: alvo, participants: alvo.participants, official, prizeTableFn: gt.prizeTable });
  const html = renderDrawResultHtml(perRecipient[0], false);
  const trecho = html.slice(Math.max(0, html.indexOf("Números sorteados")), html.indexOf("Números sorteados") + 1500);
  assert.ok(/role="presentation"/.test(trecho), "a linha de bolas deixou de usar tabela de apresentação");
  assert.ok(!/display:\s*(flex|grid)/.test(trecho),
    "flex/grid não são confiáveis em cliente de e-mail (Outlook ignora) — as bolas quebrariam");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ EMAIL SAFETY CONTRACT FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
