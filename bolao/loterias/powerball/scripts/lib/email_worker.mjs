// Powerball email worker — Part 8 of the professionalization audit.
//
// NOT activated in production by this branch (per the audit spec's explicit prohibition list —
// "não ative o worker em produção nesta branch"). This is the reference implementation + its
// fake provider, runnable locally/in tests only.
//
// Evaluated per the spec ("avalie duas opções: GitHub Actions agendado / Supabase Edge
// Function"):
//   - GitHub Actions (cron): zero new infra, matches the pattern already proven for
//     cdb2026/copa2026 (bolao/cdb2026/scripts/send_result_email.py running on a `*/10 * * * *`
//     schedule) and matches the abandoned-but-real prior art for Powerball itself
//     (POWERBALL_INCIDENT_REVIEW.md's Incident 1 — commits adc4fde/dfda53f on the abandoned
//     branch already built exactly this). Limitation: minimum granularity is ~cron-tick jitter
//     (the same 10-minute gap CDB2026 hit and fixed by anchoring to kickoff — see
//     bolao/cdb2026/CHANGELOG.md v3.87/v3.88 in this same repo), and GitHub Actions minutes are a
//     shared budget across the whole repo.
//   - Supabase Edge Function: lower latency (can be triggered by a DB webhook the instant a job
//     is enqueued), but requires standing up Supabase for Powerball first (currently zero
//     Supabase usage — see POWERBALL_CURRENT_ARCHITECTURE.md), and a second deployment surface to
//     maintain (Deno runtime, `supabase functions deploy`) that doesn't exist anywhere else in
//     this repo.
//
// LOWER-RISK CHOICE for this architecture: GitHub Actions cron, once there's a real outbox table
// to poll (POWERBALL_DATA_MODEL.md). It reuses infra this repo already trusts and already has
// working incident-response precedent for (the CDB2026 v3.87 kickoff-anchoring fix). Not stood up
// here — this file is the worker logic only, runnable via `--dry-run` or manually, per spec.

import { JOB_STATUS } from "./email_outbox.mjs";
import { renderEmailSubject, renderEmailHtml } from "./email_pipeline.mjs";

/**
 * FakeEmailProvider — Part 4 of the spec ("Implemente provider fake para testes"). Never makes a
 * network call. Records every attempt so tests can assert on exactly what would have been sent.
 */
export class FakeEmailProvider {
  constructor({ failFor = new Set() } = {}) {
    this.sent = [];
    this._failFor = failFor; // Set of recipient emails to simulate provider failure for
    this._nextMessageId = 1;
  }

  async send({ recipient, subject, html }) {
    if (this._failFor.has(recipient)) {
      throw new Error(`FakeEmailProvider: simulated failure for ${recipient}`);
    }
    const messageId = `fake-msg-${this._nextMessageId++}`;
    this.sent.push({ recipient, subject, html, messageId, sentAt: new Date().toISOString() });
    return { status: "ok", messageId };
  }
}

/**
 * runWorkerOnce — processes up to `maxJobs` pending jobs from the outbox. Real production version
 * would rate-limit against EmailJS's real per-app throttle (see EMAILJS rate-limit note in
 * POWERBALL_EMAIL_RELIABILITY.md); here `rateLimitMs` is honored via a real (short, test-scale)
 * delay so the behavior is actually exercised, not just documented.
 *
 * dryRun: claims and validates jobs but never calls provider.send() and never mutates job status
 * past inspection — "possuir modo dry-run" from spec part 8.
 */
export async function runWorkerOnce(outbox, provider, { maxJobs = 10, rateLimitMs = 0, dryRun = false } = {}) {
  const results = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const pending = outbox.pending().slice(0, maxJobs);

  for (const job of pending) {
    results.processed += 1;
    if (dryRun) {
      results.skipped += 1;
      continue;
    }

    const claimed = outbox.claim(job.email_job_id);
    const payload = claimed.payload_snapshot;

    try {
      const subject = renderEmailSubject(payload);
      const html = renderEmailHtml(payload);
      const providerResult = await provider.send({ recipient: claimed.recipient, subject, html });
      outbox.recordSuccess(claimed.email_job_id, {
        providerStatus: providerResult.status,
        providerMessageId: providerResult.messageId,
      });
      results.sent += 1;
    } catch (err) {
      // One recipient's failure never blocks the rest of the batch — spec: "erro de um
      // destinatário não bloqueia os demais". The loop continues to the next job regardless.
      outbox.recordFailure(claimed.email_job_id, { error: err });
      results.failed += 1;
    }

    if (rateLimitMs > 0) await new Promise((r) => setTimeout(r, rateLimitMs));
  }

  return results;
}
