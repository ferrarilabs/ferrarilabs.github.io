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

test("HTML ticket row embeds a literal separator between every number cell AND an explicit 'Powerball:' label, not just CSS margin/color", () => {
  const { perRecipient } = buildTicketPublicationPayload({ draw: draw1, participants: fx.participants, tickets: fx.ticketVersions["1"], publicationVersion: 1 });
  const html = renderTicketPublicationHtml(perRecipient[0], true);
  // Strip all tags to simulate "client ignored every style AND every tag boundary,
  // rendered as raw text" — the worst case. Even then, digits must not run together,
  // and "Powerball" must appear as a real text label, not just a colored digit.
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // Scope the "no 6+ digit run" check to the ticket-list section only — the
  // manifest hash elsewhere in the email is hex/timestamp-derived and can
  // incidentally contain a 6+ digit run by chance, unrelated to ticket rendering.
  const ticketSection = textOnly.slice(textOnly.indexOf("Conjunto completo"), textOnly.indexOf("Comprovantes e auditoria"));
  assert.ok(!/\d{6,}/.test(ticketSection), `even with all markup stripped, no 6+ digit run should appear in the ticket list:\n${ticketSection}`);
  assert.ok(textOnly.includes("Powerball: 17"), `expects an explicit "Powerball: N" text label to survive stripped markup:\n${textOnly.slice(0, 400)}`);
  assert.ok(textOnly.includes("Power Play:"), "expects an explicit Power Play label to survive stripped markup");
  assert.ok(html.includes(">·<"), "expects a literal '·' separator cell between white-ball numbers in the markup");
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
