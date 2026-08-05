// send.mjs — the ONLY function that talks to EmailJS. Reuses the same REST
// endpoint/credentials pattern as scripts/send_result_email.py (existing
// precedent for server-side EmailJS sends in this app).

const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";

export async function sendEmailJob(job, { publicKey, serviceId, templateId, htmlMessage, subject }) {
  const body = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: {
      to_email: job.recipient,
      subject,
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
    };
  } catch (err) {
    return { ok: false, providerStatus: null, providerMessageId: null, error: String(err && err.message || err) };
  }
}
