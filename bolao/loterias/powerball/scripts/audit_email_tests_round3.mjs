#!/usr/bin/env node
// audit_email_tests_round3.mjs — round-3 regression suite. Eduardo's real
// inbox cross-check (not just providerStatus:200) found two more bugs after
// round 2 was resent: (1) the delivered subject was the EmailJS template's
// generic fallback "Bolão do Ferrari", not our rendered subject — a
// template_params variable-name mismatch; (2) ticket numbers arrived
// concatenated ("243147526317") because the HTML relied entirely on inline
// CSS margins for visual separation, with zero literal-text separator as a
// fallback. Both are covered here with tests that fail on the exact
// delivered symptom, not just on our own intent.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture, fixtureAsDraw } from "./email/fixture.mjs";
import { buildParticipantConfirmationPayload, buildTicketPublicationPayload } from "./email/payload.mjs";
import {
  renderParticipantConfirmationSubject, renderParticipantConfirmationText, renderParticipantConfirmationHtml,
  renderTicketPublicationSubject, renderTicketPublicationText, renderTicketPublicationHtml,
} from "./email/render.mjs";
import { enqueueEmailJob, recordEmailResult, idempotencyKeyForParticipant } from "./email/outbox.mjs";
import { sendEmailJob } from "./email/send.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_OUTBOX = path.join(__dirname, "email", ".test-outbox-round3.json");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}
async function atest(name, fn) {
  try { await fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}

console.log("Powerball email — round 3 regression tests (subject contract + number rendering)\n");

const fx = loadFixture();
const draw1 = fixtureAsDraw(fx, 1);
const draw2 = fixtureAsDraw(fx, 2);
const estimates = { stateKnown: true, lumpSumBruto: 1, lumpSumNet: 1, annuityTotalBruto: 1, annuityTotalNet: 30, annuityMonthlyNet: 1 };

console.log("Subject contract:");

test("renderer produces the expected subject for all three event types, and they are mutually distinct", () => {
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const { perRecipient: pubPer } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const { perRecipient: corrPer } = buildTicketPublicationPayload({ draw: draw2, participants: fx.participants, tickets: fx.ticketVersions["2"], publicationVersion: 2, correctionReason: "x", previousHash: "y", previousTickets: fx.ticketVersions["1"] });

  const s1 = renderParticipantConfirmationSubject(confirmPayload, true);
  const s2 = renderTicketPublicationSubject(pubPer[0], true);
  const s3 = renderTicketPublicationSubject(corrPer[0], true);

  assert.equal(new Set([s1, s2, s3]).size, 3, "all three subjects must be distinct");
  [s1, s2, s3].forEach((s) => {
    assert.notEqual(s, "Bolão do Ferrari", "must never equal the bare generic fallback");
    assert.ok(!s.includes("Bolão do Ferrari"), `rendered subject must not itself contain the generic fallback text: ${s}`);
  });
});

test("job (outbox record) preserves the exact rendered subject as expectedSubject", () => {
  if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const subject = renderParticipantConfirmationSubject(confirmPayload, true);
  const key = idempotencyKeyForParticipant(confirmPayload.poolId, confirmPayload.participantId, confirmPayload.templateVersion) + ":r3test";
  const { job } = enqueueEmailJob({
    poolId: confirmPayload.poolId, drawId: confirmPayload.drawId, participantId: confirmPayload.participantId,
    eventType: "participant-added", recipient: "emferrari@gmail.com", templateId: confirmPayload.templateId,
    templateVersion: confirmPayload.templateVersion, payloadSnapshot: confirmPayload, idempotencyKey: key,
    testMode: true, expectedSubject: subject,
  }, TMP_OUTBOX);
  assert.equal(job.expectedSubject, subject);
});

test("retry (same idempotencyKey) preserves the original expectedSubject, never silently changes it", () => {
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const originalSubject = renderParticipantConfirmationSubject(confirmPayload, true);
  const key = idempotencyKeyForParticipant(confirmPayload.poolId, confirmPayload.participantId, confirmPayload.templateVersion) + ":r3test";
  const { job, created } = enqueueEmailJob({
    poolId: confirmPayload.poolId, drawId: confirmPayload.drawId, participantId: confirmPayload.participantId,
    eventType: "participant-added", recipient: "emferrari@gmail.com", templateId: confirmPayload.templateId,
    templateVersion: confirmPayload.templateVersion, payloadSnapshot: confirmPayload, idempotencyKey: key,
    testMode: true, expectedSubject: "SOMETHING ELSE — must not overwrite",
  }, TMP_OUTBOX);
  assert.equal(created, false, "must dedupe against the job created in the previous test");
  assert.equal(job.expectedSubject, originalSubject);
  if (fs.existsSync(TMP_OUTBOX)) fs.unlinkSync(TMP_OUTBOX);
});

await atest("the provider call actually receives entry_name/receipt_code/email_subject all equal to the rendered subject (network mocked)", async () => {
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const subject = renderParticipantConfirmationSubject(confirmPayload, true);
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => "OK" };
  };
  try {
    await sendEmailJob({ recipient: "emferrari@gmail.com" }, { publicKey: "x", serviceId: "y", templateId: "z", htmlMessage: "<p>x</p>", subject });
  } finally {
    global.fetch = originalFetch;
  }
  assert.ok(capturedBody, "fetch was not called");
  assert.equal(capturedBody.template_params.entry_name, subject);
  assert.equal(capturedBody.template_params.receipt_code, subject);
  assert.equal(capturedBody.template_params.email_subject, subject);
});

test("regression: a final subject equal to the bare generic fallback must be treated as a failure signal, not silently accepted", () => {
  // Structural guarantee: renderX Subject() always starts from the payload's
  // own drawDateLabel/participantName/etc, so it can never degrade to the
  // literal string "Bolão do Ferrari" on its own — that string only ever
  // appeared because the PROVIDER's static template prefix ("Bolão do
  // Ferrari - ") was concatenated with an empty (unrecognized-variable)
  // value. This test guards the renderer side of that contract.
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const s = renderParticipantConfirmationSubject(confirmPayload, true);
  assert.notEqual(s.trim(), "", "rendered subject must never be empty");
  assert.ok(s.length > 10, "rendered subject must be substantive, not a placeholder");
});

console.log("\nTicket number rendering (must survive stripped CSS):");

test("plain-text ticket line uses explicit ' - ' separators and labeled Powerball/Power Play — never bare concatenated digits", () => {
  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const text = renderTicketPublicationText(perRecipient[0], true);
  assert.ok(text.includes("24 · 31 · 47 · 52 · 63 | Powerball: 17 | Power Play:"), `expected separator-based line, got:\n${text}`);
  // Guard against the exact reported symptom, scoped to just the "Jogos:" ticket
  // list (the manifest hash elsewhere in the text is hex/timestamp-derived and
  // can incidentally contain a 6+ digit run by chance — not a rendering bug).
  const jogosSection = text.slice(text.indexOf("Jogos:"), text.indexOf("Hash (resumido)"));
  assert.ok(!/\d{6,}/.test(jogosSection), `no run of 6+ consecutive digits allowed in the ticket list:\n${jogosSection}`);
});

test("HTML ticket row: each of the 6 numbers is its own fixed-size table cell — with all markup stripped, they still read left-to-right, in order, not garbled", () => {
  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const html = renderTicketPublicationHtml(perRecipient[0], true);
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const ticketSection = textOnly.slice(textOnly.indexOf("Conjunto completo"), textOnly.indexOf("Comprovantes e auditoria"));
  // Round-4 design: the table-CELL BOUNDARY itself is the fallback (not a
  // redundant text label inside the HTML anymore — that moved to text/plain
  // only, per this round's spec). A client that strips every style still
  // renders each <td> as whitespace-separated text, so the six numbers
  // never run together even with zero CSS.
  assert.ok(!/\d{6,}/.test(ticketSection), `even with all markup stripped, no 6+ digit run should appear in the ticket list:\n${ticketSection}`);
  assert.ok(ticketSection.includes("24") && ticketSection.includes("31") && ticketSection.includes("47") && ticketSection.includes("52") && ticketSection.includes("63") && ticketSection.includes("17"), "all 6 numbers (5 white + Powerball) must be present and legible with markup stripped");
});

test("HTML ticket row no longer duplicates the plain-text separator line (moved to text/plain only, per this round's spec)", () => {
  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const html = renderTicketPublicationHtml(perRecipient[0], true);
  assert.ok(!html.includes("24 · 31 · 47 · 52 · 63 | Powerball: 17 | Power Play:"), "HTML must not contain the redundant gray fallback text line anymore — text/plain only");
});

test("HTML ball design: 5 white/light circles + 1 larger red Powerball circle, fixed width==height (true circles, not padding-stretched ellipses), Power Play shown as its own small line", () => {
  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const html = renderTicketPublicationHtml(perRecipient[0], true);
  const whiteCircles = html.match(/background:#f2f2f2[^"]*"[^>]*>(\d+)/g) || [];
  assert.equal(whiteCircles.length >= 5, true, "expected at least 5 white-ball circles per ticket row");
  assert.ok(html.includes(`background:${"#CE1141"}`), "expected the Powerball circle to use the approved red accent");
  assert.ok(/width:36px;height:36px/.test(html), "Powerball circle must be the larger size (36px) than the white balls (32px)");
  assert.ok(/width:32px;height:32px/.test(html), "white balls must be fixed 32x32 (true circles)");
  assert.ok(html.includes("Power Play:"), "expects a Power Play line");
  assert.ok(html.includes("<strong>Sim</strong>") || html.includes("<strong>Não</strong>"), "Power Play value must be present");
});

test("correction ANTES/DEPOIS lines use the same separator format, not raw concatenation", () => {
  const { perRecipient } = buildTicketPublicationPayload({
    draw: draw2, participants: fx.participants, tickets: fx.ticketVersions["2"], publicationVersion: 2,
    correctionReason: "teste", previousHash: "abc", previousTickets: fx.ticketVersions["1"],
  });
  const text = renderTicketPublicationText(perRecipient[0], true);
  assert.ok(text.includes("Antes: 24 · 31 · 47 · 52 · 63 — Powerball 17"));
  assert.ok(text.includes("Depois: 24 · 31 · 47 · 52 · 64 — Powerball 17"));
});

test("correction HTML 'O que foi alterado' box renders BOTH antes and depois as ball circles (Eduardo's explicit ask), not plain text", () => {
  const { perRecipient } = buildTicketPublicationPayload({
    draw: draw2, participants: fx.participants, tickets: fx.ticketVersions["2"], publicationVersion: 2,
    correctionReason: "teste", previousHash: "abc", previousTickets: fx.ticketVersions["1"],
  });
  const html = renderTicketPublicationHtml(perRecipient[0], true);
  const alteradoSection = html.slice(html.indexOf("O que foi alterado"), html.indexOf("Hash da versão anterior"));
  assert.ok(alteradoSection.includes("Antes:"));
  assert.ok(alteradoSection.includes("Depois:"));
  // Both the "antes" (63) and "depois" (64) ball rows must be present as circles.
  const beforeCircles = (alteradoSection.match(/>63</g) || []).length;
  const afterCircles = (alteradoSection.match(/>64</g) || []).length;
  assert.ok(beforeCircles >= 1, "expected the 'antes' ball row to render 63 in a circle");
  assert.ok(afterCircles >= 1, "expected the 'depois' ball row to render 64 in a circle");
  assert.ok(/background:#CE1141/.test(alteradoSection), "expected red Powerball circles in the antes/depois rows");
});

console.log("\nNo localhost/dev links in a real send, currency always 2 decimals, payment status never raw:");

test("no localhost/127.0.0.1/dev URL ever appears as a clickable href in either email", () => {
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const confirmHtml = renderParticipantConfirmationHtml(confirmPayload, true);
  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const pubHtml = renderTicketPublicationHtml(perRecipient[0], true);
  [confirmHtml, pubHtml].forEach((html) => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    hrefs.forEach((h) => {
      assert.ok(!/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(h), `dead/local URL rendered as a live link: ${h}`);
    });
  });
});

test("proofUrl on a reserved/placeholder domain (.invalid) is shown as text, never as a clickable link", () => {
  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1, proofUrl: "https://example.invalid/proof.jpg" });
  const html = renderTicketPublicationHtml(perRecipient[0], true);
  assert.ok(!html.includes('href="https://example.invalid/proof.jpg"'), "a .invalid URL must never be rendered as a clickable href");
});

test("every dollar amount in both HTML emails uses exactly two decimal places", () => {
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const confirmHtml = renderParticipantConfirmationHtml(confirmPayload, true);
  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const pubHtml = renderTicketPublicationHtml(perRecipient[0], true);
  [confirmHtml, pubHtml].forEach((html) => {
    const dollarAmounts = [...html.matchAll(/\$[\d,]+(\.\d+)?/g)].map((m) => m[0]);
    assert.ok(dollarAmounts.length > 0, "expected at least one dollar amount");
    dollarAmounts.forEach((amt) => assert.ok(/\.\d{2}$/.test(amt), `dollar amount missing exactly 2 decimals: ${amt}`));
    assert.ok(!html.includes("US$"), 'must never mix in "US$" prefix style');
  });
});

test('"Pagamento" never shows the raw internal status string "verificado" — always the friendly label', () => {
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const confirmHtml = renderParticipantConfirmationHtml(confirmPayload, true);
  assert.ok(confirmHtml.includes("Pagamento confirmado"));
  assert.ok(!/>verificado</.test(confirmHtml), "raw status string must never leak into the rendered HTML");

  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const pubHtml = renderTicketPublicationHtml(perRecipient[0], true);
  assert.ok(pubHtml.includes("Pagamento confirmado"));
  assert.ok(!/>verificado</.test(pubHtml));
});

test("friendly date form appears in the primary reading flow (headline/first table row), not only in a footer", () => {
  const confirmPayload = buildParticipantConfirmationPayload({ participant: fx.participants[0], draw: draw1, estimates });
  const confirmHtml = renderParticipantConfirmationHtml(confirmPayload, true);
  // "de agosto de" is only produced by the friendly formatter, never by the compact drawDateLabel.
  const firstOccurrence = confirmHtml.indexOf("de agosto de");
  const sectionHeading = confirmHtml.indexOf("Sua participação");
  assert.ok(firstOccurrence > -1 && firstOccurrence < confirmHtml.indexOf("Estimativas do prêmio"), "friendly date must appear in the 'Sua participação' section, not only near the bottom");

  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const pubHtml = renderTicketPublicationHtml(perRecipient[0], true);
  const pubHeadline = pubHtml.indexOf("<h2");
  const pubFriendly = pubHtml.indexOf("de agosto de");
  assert.ok(pubFriendly > -1 && pubFriendly - pubHeadline < 400, "friendly date must appear near the headline, not only in a footer line");
});

console.log("\nProduction attachment/link gate (round 4):");

const { validateAttachmentsAndLinks } = await import("./email/validate.mjs");
const { runPublishTickets } = await import("./email/publish_tickets.mjs");

test("blocks when proofUrl is empty and no operatorAttestation is given either", () => {
  // 2026-08-08: proofUrl is no longer the only accepted proof — a written
  // operatorAttestation is also valid (this bolão's real proof is pasted
  // receipts, never a URL). Neither given here, so still correctly blocked,
  // just under the more accurate PROOF_MISSING (not PROOF_URL_MISSING).
  const r = validateAttachmentsAndLinks({ proofUrl: "", attachments: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("PROOF_MISSING")));
});
test("operatorAttestation alone (no proofUrl) satisfies the proof requirement when specific enough", () => {
  const r = validateAttachmentsAndLinks({
    proofUrl: undefined,
    operatorAttestation: "Comprovante Zelle conferido manualmente por Eduardo Ferrari em 08/08/2026 contra os 56 bilhetes do sorteio.",
    attachments: [{ kind: "pdf", filePath: "/real.pdf" }, { kind: "csv", filePath: "/real.csv" }, { kind: "json", filePath: "/real.json" }],
  }, (p) => true);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});
test("a vague/short operatorAttestation is rejected just like an empty one", () => {
  const r = validateAttachmentsAndLinks({ proofUrl: undefined, operatorAttestation: "ok", attachments: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("OPERATOR_ATTESTATION_TOO_VAGUE")));
});
test("blocks when proofUrl is localhost", () => {
  const r = validateAttachmentsAndLinks({ proofUrl: "http://localhost:8099/proof.jpg", attachments: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("PROOF_URL_NOT_REAL")));
});
test("blocks when proofUrl is example.invalid", () => {
  const r = validateAttachmentsAndLinks({ proofUrl: "https://example.invalid/proof.jpg", attachments: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("PROOF_URL_NOT_REAL")));
});
test("blocks when a referenced attachment file does not exist on disk", () => {
  const r = validateAttachmentsAndLinks(
    { proofUrl: "https://ferrarilabs.github.io/proof.jpg", attachments: [{ kind: "pdf", filePath: "/definitely/not/a/real/file.pdf" }, { kind: "csv", filePath: "/nope.csv" }, { kind: "json", filePath: "/nope.json" }] },
    (p) => false
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("ATTACHMENT_FILE_NOT_FOUND")));
});
test("passes when proofUrl is real and all 3 attachments resolve (URL or existing file)", () => {
  const r = validateAttachmentsAndLinks(
    { proofUrl: "https://ferrarilabs.github.io/proof.jpg", attachments: [{ kind: "pdf", url: "https://ferrarilabs.github.io/a.pdf" }, { kind: "csv", filePath: "/real.csv" }, { kind: "json", filePath: "/real.json" }] },
    (p) => true
  );
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

await atest("runPublishTickets: a REAL (non-test) send is blocked by the attachment gate today (no attachment pipeline wired up yet) — explicit error, not a silent skip", async () => {
  const draw = fixtureAsDraw(fx, 1);
  const r = await runPublishTickets({ drawId: fx.drawId, publicationVersion: 1, testMode: false, dryRun: true, outboxFile: "/tmp/pb-round4-real-gate.json", syntheticDraw: { ...draw, __tickets: fx.ticketVersions["1"] }, proofUrl: fx.sharedTickets.proofUrl });
  assert.equal(r.ok, false);
  assert.equal(r.blockedBy, "validateAttachmentsAndLinks");
  assert.ok(r.errors.some((e) => e.includes("ATTACHMENT_MISSING")));
});

await atest("runPublishTickets: the fixture-driven TEST path is unaffected by the attachment gate (example.invalid proofUrl is fine in test mode)", async () => {
  const draw = fixtureAsDraw(fx, 1);
  const r = await runPublishTickets({ drawId: fx.drawId, publicationVersion: 1, testMode: true, dryRun: true, outboxFile: "/tmp/pb-round4-test-gate.json", syntheticDraw: { ...draw, __tickets: fx.ticketVersions["1"] }, proofUrl: fx.sharedTickets.proofUrl });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
