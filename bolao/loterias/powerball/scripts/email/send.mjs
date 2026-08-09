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

// ─── TRAVA FAIL-CLOSED (2026-08-09) ─────────────────────────────────────────────────────────
//
// O lado Python já tinha isso (`_SEND_AUTHORIZED` + detecção de `PYTEST_CURRENT_TEST` em
// send_result_email.py). O lado JS não tinha NADA: `sendEmailJob` chamava `fetch` direto, e a
// única coisa que impedia uma suíte de alcançar a EmailJS era cada teste lembrar de trocar
// `global.fetch` por um mock.
//
// Verificado empiricamente em 2026-08-09 (guard de rede no `--import`): **nenhuma das quatro
// suítes faz chamada não mockada hoje.** Ou seja, isto não conserta um vazamento em curso — fecha
// a porta pela qual o próximo entraria. A convenção "lembre de mockar" é exatamente o tipo de
// disciplina sem mecanismo que já falhou neste repositório (o `drawSelectorLabel` "kept in sync
// manually" ficou dessincronizado e três testes passaram verde por meses).
//
// O risco não é hipotético: um envio real errado já saiu para 15 pessoas, e as credenciais reais
// ficam disponíveis no ambiente de CI onde as suítes rodam.
//
// DESENHO — injeção em vez de monkey-patch global:
//   - produção chama `sendEmailJob(job, opts)` sem `transport` e usa `fetch`, exatamente como antes;
//   - teste passa `transport` explicitamente e exercita todo o caminho, sem tocar em `global.fetch`;
//   - rodando sob um entrypoint de TESTE e SEM `transport`, a função **recusa** em vez de enviar.
//
// A recusa devolve o mesmo formato de resultado de uma falha de envio (`ok:false` + `error`), com
// status próprio e legível por máquina — nunca pode ser confundida com sucesso.
function isTestRuntime() {
  if (process.env.POWERBALL_TEST_RUN || process.env.NODE_TEST_CONTEXT) return true;
  const entry = String(process.argv[1] || "");
  const base = entry.slice(entry.lastIndexOf("/") + 1);
  return /^(audit|test)_/.test(base) || /\.test\.(mjs|js)$/.test(base);
}

export const SEND_BLOCKED_IN_TEST = "SEND_BLOCKED_IN_TEST_RUNTIME";

export async function sendEmailJob(job, { publicKey, serviceId, templateId, htmlMessage, subject, transport } = {}) {
  const fetchImpl = transport || globalThis.fetch;

  if (!transport && isTestRuntime()) {
    return {
      ok: false,
      status: SEND_BLOCKED_IN_TEST,
      providerStatus: null,
      providerMessageId: null,
      error:
        "Envio recusado: processo de teste sem transporte injetado. Passe `transport` para " +
        "exercitar o caminho de envio, ou use dryRun. O provedor real nunca é alcançável a " +
        "partir de teste, mesmo com credencial válida no ambiente.",
      expectedSubject: subject,
    };
  }

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
    const res = await fetchImpl(EMAILJS_URL, {
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
