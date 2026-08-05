// send.mjs — the ONLY function that talks to EmailJS. Reuses the same REST
// endpoint/credentials pattern as scripts/send_result_email.py (existing
// precedent for server-side EmailJS sends in this app).
//
// SUBJECT CONTRACT — read before touching this file.
//
// The single canonical subject string is computed once, by the renderer
// (renderParticipantConfirmationSubject / renderTicketPublicationSubject),
// and passed into sendEmailJob as `subject`. We do NOT control the EmailJS
// dashboard template's own Subject field configuration from this codebase —
// there is no API/credential in this repo that can read or edit it, only
// the public key used for sending. So instead of guessing a single variable
// name, we transmit the same canonical value under every variable name we
// have evidence for:
//   - entry_name, receipt_code — CONFIRMED working: cross-checked via a real
//     Gmail search against a previously-sent, genuinely correct Powerball
//     result email ("Bolão do Ferrari - ⚽ Resultado Powerball — ...", sent
//     by scripts/send_result_email.py) AND against this round's own
//     participant-confirmation verification send (Gmail message id
//     19fd25b276715342: subject arrived as "Bolão do Ferrari - [TESTE ADMIN]
//     ✅ Participação confirmada...", i.e. exactly what was passed in, minus
//     an HTML-escaping issue on "/" that is fixed separately in render.mjs's
//     subjectSafeDate()). This is verified, not assumed.
//   - email_subject — added defensively in case the template ALSO/INSTEAD
//     references this name; harmless if unused (EmailJS ignores unrecognized
//     template_params keys).
// Unverified claim, stated honestly: we cannot inspect the EmailJS
// dashboard's Subject field text directly, so we cannot 100% rule out that
// it is fully static with no variable reference at all for some other
// template. If Eduardo still sees a generic subject after this fix, the next
// diagnostic step is opening the EmailJS dashboard for template_xq7yzzb and
// reading the Subject field directly — something only he can do (no
// dashboard credentials exist in this codebase or environment).
//
// A 200 response from this endpoint means EmailJS ACCEPTED the request. It
// does not confirm the delivered subject matched what was sent — that can
// only be confirmed by reading the actual delivered message (this session
// did so via Gmail search, see docs/bolao/loterias/POWERBALL_EMAIL_ARCHITECTURE.md).

const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";

export async function sendEmailJob(job, { publicKey, serviceId, templateId, htmlMessage, subject }) {
  const body = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: {
      to_email: job.recipient,
      entry_name: subject,
      receipt_code: subject,
      email_subject: subject,
      html_message: htmlMessage,
    },
  };
  try {
    const res = await fetch(EMAILJS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ferrarilabs.github.io",
        Referer: "https://ferrarilabs.github.io/bolao/loterias/powerball/",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      providerStatus: res.status,
      providerMessageId: res.ok ? `emailjs-${Date.now()}` : null,
      error: res.ok ? null : `EmailJS ${res.status}: ${text}`,
      expectedSubject: subject,
      providerSubjectParameters: ["entry_name", "receipt_code", "email_subject"],
    };
  } catch (err) {
    return { ok: false, providerStatus: null, providerMessageId: null, error: String(err && err.message || err), expectedSubject: subject };
  }
}
