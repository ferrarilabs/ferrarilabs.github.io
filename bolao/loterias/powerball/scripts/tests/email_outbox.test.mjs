// Powerball email outbox tests — Part 7 of the professionalization audit.
// Run: node --test bolao/loterias/powerball/scripts/tests/email_outbox.test.mjs
// No real email addresses, no network calls, no writes to production Supabase.

import test from "node:test";
import assert from "node:assert/strict";
import { EmailOutbox, DuplicateEmailJobError, JOB_STATUS } from "../lib/email_outbox.mjs";
import {
  loadDrawSnapshot,
  validateEmailEvent,
  buildEmailPayload,
  renderEmailSubject,
  renderEmailHtml,
  renderEmailText,
} from "../lib/email_pipeline.mjs";
import { FakeEmailProvider, runWorkerOnce } from "../lib/email_worker.mjs";

const GAME_TYPE = { label: "Powerball", specialBallLabel: "Powerball" };

function pastDraw(overrides = {}) {
  return {
    id: "2026-08-01",
    gameType: "powerball",
    drawing: {
      drawDateLabel: "01/08/2026 22:59 ET",
      drawDateIso: "2026-08-01T22:59:00-04:00", // in the past relative to test run time (2026-08+)
      jackpot: 707000000,
    },
    finance: { totalArrecadado: 280, valorUtilizado: 138, valorGuardadoProximoSorteio: 142 },
    ...overrides,
  };
}

function futureDraw() {
  return pastDraw({
    id: "2099-01-01",
    drawing: { drawDateLabel: "01/01/2099", drawDateIso: "2099-01-01T00:00:00-04:00", jackpot: 1 },
  });
}

function resultSnapshot() {
  return { numbers: [1, 2, 3, 4, 5], special: 6, multiplier: 2 };
}

// ── outbox: idempotency ────────────────────────────────────────────────────

test("não envia duas vezes o mesmo evento — enqueue is idempotent per key", () => {
  const outbox = new EmailOutbox();
  const args = {
    poolId: "powerball",
    drawId: "2026-08-01",
    eventType: "resultado_disponivel",
    recipient: "participante.alfa@example.invalid",
    templateId: "tpl-result",
    templateVersion: "v1",
    payloadSnapshot: { hello: "world" },
  };
  outbox.enqueue(args);
  assert.throws(() => outbox.enqueue(args), DuplicateEmailJobError);
  assert.equal(outbox.all().length, 1);
});

test("idempotency key format matches spec", () => {
  const outbox = new EmailOutbox();
  const job = outbox.enqueue({
    poolId: "powerball",
    drawId: "2026-08-01",
    eventType: "resultado_disponivel",
    recipient: "participante.alfa@example.invalid",
    templateId: "tpl-result",
    templateVersion: "v1",
    payloadSnapshot: {},
  });
  assert.equal(
    job.idempotency_key,
    "powerball:2026-08-01:resultado_disponivel:participante.alfa@example.invalid:v1"
  );
});

test("não envia sem destinatário — invalid recipient rejected", () => {
  const outbox = new EmailOutbox();
  assert.throws(() => outbox.enqueue({
    poolId: "powerball", drawId: "2026-08-01", eventType: "resultado_disponivel",
    recipient: "not-an-email", templateId: "t", templateVersion: "v1", payloadSnapshot: {},
  }), /invalid recipient/);
  assert.throws(() => outbox.enqueue({
    poolId: "powerball", drawId: "2026-08-01", eventType: "resultado_disponivel",
    recipient: "", templateId: "t", templateVersion: "v1", payloadSnapshot: {},
  }), /invalid recipient/);
});

test("não envia payload incompleto — missing payloadSnapshot rejected", () => {
  const outbox = new EmailOutbox();
  assert.throws(() => outbox.enqueue({
    poolId: "powerball", drawId: "2026-08-01", eventType: "resultado_disponivel",
    recipient: "participante.alfa@example.invalid", templateId: "t", templateVersion: "v1",
  }), /payloadSnapshot is required/);
});

// ── outbox: mutation isolation ─────────────────────────────────────────────

test("retry mantém o mesmo snapshot — payload is frozen at enqueue time", () => {
  const outbox = new EmailOutbox();
  const mutableInput = { numbers: [1, 2, 3] };
  const job = outbox.enqueue({
    poolId: "powerball", drawId: "2026-08-01", eventType: "resultado_disponivel",
    recipient: "participante.alfa@example.invalid", templateId: "t", templateVersion: "v1",
    payloadSnapshot: mutableInput,
  });
  mutableInput.numbers.push(999); // caller mutates their own copy after enqueue
  assert.deepEqual(outbox.get(job.email_job_id).payload_snapshot.numbers, [1, 2, 3]);

  outbox.claim(job.email_job_id);
  outbox.recordFailure(job.email_job_id, { error: new Error("simulated") });
  const retried = outbox.retry(job.email_job_id);
  assert.equal(retried.status, JOB_STATUS.PENDING);
  assert.deepEqual(retried.payload_snapshot.numbers, [1, 2, 3], "retry must not alter content");
});

test("retry não duplica — job count stays 1 across claim/fail/retry/claim", () => {
  const outbox = new EmailOutbox();
  const job = outbox.enqueue({
    poolId: "powerball", drawId: "2026-08-01", eventType: "resultado_disponivel",
    recipient: "participante.beta@example.invalid", templateId: "t", templateVersion: "v1",
    payloadSnapshot: {},
  });
  outbox.claim(job.email_job_id);
  outbox.recordFailure(job.email_job_id, { error: new Error("x") });
  outbox.retry(job.email_job_id);
  outbox.claim(job.email_job_id);
  assert.equal(outbox.all().length, 1);
});

test("limite de tentativas — retry stops once maxAttempts is reached, job stays failed", () => {
  const outbox = new EmailOutbox();
  const job = outbox.enqueue({
    poolId: "powerball", drawId: "2026-08-01", eventType: "resultado_disponivel",
    recipient: "participante.gama@example.invalid", templateId: "t", templateVersion: "v1",
    payloadSnapshot: {},
  });
  for (let i = 0; i < 5; i++) {
    outbox.claim(job.email_job_id);
    outbox.recordFailure(job.email_job_id, { error: new Error("simulated") });
    outbox.retry(job.email_job_id, { maxAttempts: 5 });
  }
  const final = outbox.get(job.email_job_id);
  assert.equal(final.attempt_count, 5);
  // 5th retry() call above returned null once attempt_count hit 5 -- job never went back to
  // pending on that iteration, so it's still sitting in `failed`, not `pending`.
  assert.equal(final.status, JOB_STATUS.FAILED);
  assert.equal(outbox.retry(job.email_job_id, { maxAttempts: 5 }), null);
});

// ── event validation ────────────────────────────────────────────────────────

test("não envia antes da hora — result event rejected for a future draw", () => {
  const draw = loadDrawSnapshot(futureDraw(), GAME_TYPE);
  const { valid, errors } = validateEmailEvent({
    eventType: "resultado_disponivel",
    drawSnapshot: draw,
    recipient: "participante.alfa@example.invalid",
    resultSnapshot: resultSnapshot(),
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("has not happened yet")));
});

test("não envia template errado — unknown event_type rejected", () => {
  const draw = loadDrawSnapshot(pastDraw(), GAME_TYPE);
  const { valid, errors } = validateEmailEvent({
    eventType: "evento_inventado",
    drawSnapshot: draw,
    recipient: "participante.alfa@example.invalid",
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("unknown event_type")));
});

test("resultado_disponivel requires a well-shaped result", () => {
  const draw = loadDrawSnapshot(pastDraw(), GAME_TYPE);
  const { valid, errors } = validateEmailEvent({
    eventType: "resultado_disponivel",
    drawSnapshot: draw,
    recipient: "participante.alfa@example.invalid",
    resultSnapshot: { numbers: [1, 2], special: 6 }, // only 2 numbers, invalid
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("exactly 5 numbers")));
});

// ── preview == sent payload ─────────────────────────────────────────────────

test("preview é igual ao payload enviado", async () => {
  const outbox = new EmailOutbox();
  const provider = new FakeEmailProvider();
  const draw = loadDrawSnapshot(pastDraw(), GAME_TYPE);
  const payload = buildEmailPayload({
    eventType: "resultado_disponivel",
    drawSnapshot: draw,
    recipient: "participante.gama@example.invalid",
    resultSnapshot: resultSnapshot(),
    prizeSnapshot: { total: 700, jackpotHit: false },
  });

  const previewSubject = renderEmailSubject(payload);
  const previewHtml = renderEmailHtml(payload);

  outbox.enqueue({
    poolId: "powerball", drawId: draw.drawId, eventType: "resultado_disponivel",
    recipient: "participante.gama@example.invalid", templateId: "tpl-result", templateVersion: "v1",
    payloadSnapshot: payload,
  });
  await runWorkerOnce(outbox, provider);

  assert.equal(provider.sent.length, 1);
  assert.equal(provider.sent[0].subject, previewSubject);
  assert.equal(provider.sent[0].html, previewHtml);
});

// ── worker behavior ──────────────────────────────────────────────────────────

test("dry-run sends nothing and leaves jobs pending", async () => {
  const outbox = new EmailOutbox();
  const provider = new FakeEmailProvider();
  outbox.enqueue({
    poolId: "powerball", drawId: "2026-08-01", eventType: "lembrete_sorteio",
    recipient: "participante.alfa@example.invalid", templateId: "t", templateVersion: "v1",
    payloadSnapshot: { draw: loadDrawSnapshot(pastDraw(), GAME_TYPE), recipient: "participante.alfa@example.invalid" },
  });
  const results = await runWorkerOnce(outbox, provider, { dryRun: true });
  assert.equal(results.skipped, 1);
  assert.equal(provider.sent.length, 0);
  assert.equal(outbox.pending().length, 1);
});

test("erro de um destinatário não bloqueia os demais", async () => {
  const outbox = new EmailOutbox();
  const provider = new FakeEmailProvider({ failFor: new Set(["participante.beta@example.invalid"]) });
  const draw = loadDrawSnapshot(pastDraw(), GAME_TYPE);
  for (const recipient of [
    "participante.alfa@example.invalid",
    "participante.beta@example.invalid",
    "participante.gama@example.invalid",
  ]) {
    const payload = buildEmailPayload({
      eventType: "lembrete_sorteio", drawSnapshot: draw, recipient,
    });
    outbox.enqueue({
      poolId: "powerball", drawId: draw.drawId, eventType: "lembrete_sorteio",
      recipient, templateId: "t", templateVersion: "v1", payloadSnapshot: payload,
    });
  }

  const results = await runWorkerOnce(outbox, provider);
  assert.equal(results.sent, 2);
  assert.equal(results.failed, 1);
  const jobs = outbox.all();
  assert.equal(jobs.filter((j) => j.status === JOB_STATUS.SENT).length, 2);
  assert.equal(jobs.filter((j) => j.status === JOB_STATUS.FAILED).length, 1);
});

test("não mistura participantes — payload for one recipient never contains another's data", () => {
  const draw = loadDrawSnapshot(pastDraw(), GAME_TYPE);
  const payloadAlfa = buildEmailPayload({
    eventType: "lembrete_sorteio", drawSnapshot: draw, recipient: "participante.alfa@example.invalid",
  });
  const payloadBeta = buildEmailPayload({
    eventType: "lembrete_sorteio", drawSnapshot: draw, recipient: "participante.beta@example.invalid",
  });
  assert.equal(payloadAlfa.recipient, "participante.alfa@example.invalid");
  assert.equal(payloadBeta.recipient, "participante.beta@example.invalid");
  assert.notEqual(payloadAlfa.recipient, payloadBeta.recipient);
});

test("não envia para sorteio errado — job's draw_id matches the snapshot it was built from", () => {
  const outbox = new EmailOutbox();
  const drawA = loadDrawSnapshot(pastDraw({ id: "2026-08-01" }), GAME_TYPE);
  const drawB = loadDrawSnapshot(pastDraw({ id: "2026-08-03" }), GAME_TYPE);
  const payload = buildEmailPayload({
    eventType: "lembrete_sorteio", drawSnapshot: drawA, recipient: "participante.alfa@example.invalid",
  });
  const job = outbox.enqueue({
    poolId: "powerball", drawId: drawA.drawId, eventType: "lembrete_sorteio",
    recipient: "participante.alfa@example.invalid", templateId: "t", templateVersion: "v1",
    payloadSnapshot: payload,
  });
  assert.equal(job.draw_id, "2026-08-01");
  assert.notEqual(job.draw_id, drawB.drawId);
  assert.equal(job.payload_snapshot.draw.drawId, "2026-08-01");
});

test("respeita rate limit — worker honors rateLimitMs between sends", async () => {
  const outbox = new EmailOutbox();
  const provider = new FakeEmailProvider();
  const draw = loadDrawSnapshot(pastDraw(), GAME_TYPE);
  for (const recipient of ["participante.alfa@example.invalid", "participante.beta@example.invalid"]) {
    const payload = buildEmailPayload({ eventType: "lembrete_sorteio", drawSnapshot: draw, recipient });
    outbox.enqueue({
      poolId: "powerball", drawId: draw.drawId, eventType: "lembrete_sorteio",
      recipient, templateId: "t", templateVersion: "v1", payloadSnapshot: payload,
    });
  }
  const start = Date.now();
  await runWorkerOnce(outbox, provider, { rateLimitMs: 50 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 100, `expected >=100ms with rate limiting, got ${elapsed}ms`);
});

test("text/html previews render without throwing for every implemented event type", () => {
  const draw = loadDrawSnapshot(pastDraw(), GAME_TYPE);
  for (const eventType of ["lembrete_sorteio", "confirmacao_pagamento", "tickets_publicados"]) {
    const payload = buildEmailPayload({ eventType, drawSnapshot: draw, recipient: "participante.alfa@example.invalid" });
    assert.equal(typeof renderEmailSubject(payload), "string");
    assert.equal(typeof renderEmailHtml(payload), "string");
    assert.equal(typeof renderEmailText(payload), "string");
  }
});
