// render.mjs — subject/HTML/text renderers. Powerball visual identity preserved
// exactly: red #CE1141 / blue #003DA5 (from js/data.js LOTTERY_GAME_TYPES.powerball),
// inline CSS only, no JS in emails.

const RED = "#CE1141";
const BLUE = "#003DA5";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function usd(n) {
  if (n === null || n === undefined) return "—";
  return "US$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function shell({ title, accentBar, bodyHtml, testMode }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
${testMode ? `<div style="background:#fff3cd;color:#7a5b00;text-align:center;padding:8px;font-size:13px;font-weight:bold;">[TESTE ADMIN] — não é um envio de produção</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5ea;" cellpadding="0" cellspacing="0">
<tr><td style="background:linear-gradient(135deg, ${RED}, ${BLUE});padding:20px 24px;">
  <span style="color:#fff;font-size:20px;font-weight:bold;">🔴 Bolão Powerball</span>
</td></tr>
<tr><td style="padding:24px;">
${bodyHtml}
</td></tr>
<tr><td style="background:#fafafa;padding:16px 24px;font-size:12px;color:#777;border-top:1px solid #eee;">
  Ferrari Labs — Bolão Powerball · Este e-mail é informativo, não constitui aconselhamento fiscal ou financeiro.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ---------- participant-added ----------

export function renderParticipantConfirmationSubject(payload, testMode) {
  const prefix = testMode ? "[TESTE ADMIN] " : "";
  const dateSuffix = payload.nextDrawDateLabel ? ` — Sorteio ${payload.nextDrawDateLabel}` : "";
  return `${prefix}✅ Sua participação foi registrada — Bolão Powerball${dateSuffix}`;
}

export function renderParticipantConfirmationHtml(payload, testMode) {
  const e = payload.estimates || {};
  const body = `
<h2 style="color:${RED};margin:0 0 12px;">Participação confirmada, ${esc(payload.participantName)}!</h2>
<p style="font-size:14px;line-height:1.5;">Sua entrada no bolão foi registrada com sucesso. Resumo:</p>
<table role="presentation" width="100%" cellpadding="6" style="font-size:14px;border-collapse:collapse;">
<tr><td style="color:#666;">Pool</td><td><strong>${esc(payload.poolId)}</strong></td></tr>
<tr><td style="color:#666;">Data da entrada</td><td>${esc(payload.entryDate)} ${esc(payload.entryTime || "")}</td></tr>
<tr><td style="color:#666;">Próximo sorteio</td><td>${esc(payload.nextDrawDateLabel)}</td></tr>
<tr><td style="color:#666;">Cotas</td><td>${esc(payload.cotas)}</td></tr>
<tr><td style="color:#666;">Valor</td><td>${usd(payload.valor)}</td></tr>
<tr><td style="color:#666;">Status do pagamento</td><td>${esc(payload.paymentStatus)}</td></tr>
<tr><td style="color:#666;">% de participação no pool</td><td>${esc(payload.participationPct)}%</td></tr>
</table>
<h3 style="color:${BLUE};margin:20px 0 8px;">Estimativas do prêmio atual</h3>
<table role="presentation" width="100%" cellpadding="6" style="font-size:14px;border-collapse:collapse;background:#f8f9fc;border-radius:8px;">
<tr><td style="color:#666;">Jackpot</td><td>${usd(payload.jackpot)}</td></tr>
<tr><td style="color:#666;">Lump Sum bruto (sua cota)</td><td>${usd(e.lumpSumBruto)}</td></tr>
<tr><td style="color:#666;">Lump Sum líquido estimado</td><td><strong>${usd(e.lumpSumNet)}</strong></td></tr>
<tr><td style="color:#666;">Anuidade total líquida estimada</td><td><strong>${usd(e.annuityTotalNet)}</strong></td></tr>
</table>
<p style="font-size:12px;color:#999;margin-top:16px;">Estimativas calculadas pela mesma função usada na página pública do bolão (estado declarado: ${esc(payload.state)}). Valores sujeitos a alteração até o sorteio.</p>
<p style="font-size:14px;margin-top:16px;"><a href="${esc(payload.siteUrl)}" style="color:${BLUE};">Ver o bolão</a></p>`;
  return shell({ title: "Participação confirmada — Bolão Powerball", bodyHtml: body, testMode });
}

export function renderParticipantConfirmationText(payload, testMode) {
  const e = payload.estimates || {};
  const lines = [
    testMode ? "[TESTE ADMIN] — não é um envio de produção" : null,
    `Participação confirmada, ${payload.participantName}!`,
    "",
    `Pool: ${payload.poolId}`,
    `Data da entrada: ${payload.entryDate} ${payload.entryTime || ""}`,
    `Próximo sorteio: ${payload.nextDrawDateLabel}`,
    `Cotas: ${payload.cotas}`,
    `Valor: ${usd(payload.valor)}`,
    `Status do pagamento: ${payload.paymentStatus}`,
    `% de participação: ${payload.participationPct}%`,
    "",
    "Estimativas do prêmio atual:",
    `  Jackpot: ${usd(payload.jackpot)}`,
    `  Lump Sum líquido estimado: ${usd(e.lumpSumNet)}`,
    `  Anuidade total líquida estimada: ${usd(e.annuityTotalNet)}`,
    "",
    `Site: ${payload.siteUrl}`,
  ].filter((l) => l !== null);
  return lines.join("\n");
}

// ---------- tickets-published / tickets-corrected ----------

export function renderTicketPublicationSubject(payload, testMode) {
  const prefix = testMode ? "[TESTE ADMIN] " : "";
  if (payload.templateId === "tickets-corrected") {
    return `${prefix}⚠️ Correção dos bilhetes — Powerball de ${payload.drawDateLabel} — Versão ${payload.publicationVersion}`;
  }
  return `${prefix}🎟️ Bilhetes publicados — Powerball de ${payload.drawDateLabel}`;
}

export function renderTicketPublicationHtml(payload, testMode) {
  const f = payload.financialSummary;
  const isCorrection = payload.templateId === "tickets-corrected";
  const ticketsHtml = payload.tickets.map((t, i) =>
    `<tr><td style="padding:4px 6px;">#${i + 1}</td><td style="padding:4px 6px;font-family:monospace;">${t.numbers.join("-")} — PB ${t.special}</td></tr>`
  ).join("");
  const body = `
${isCorrection ? `<div style="background:#fff3cd;color:#7a5b00;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;"><strong>Correção de versão ${esc(payload.publicationVersion)}.</strong> ${esc(payload.correctionReason)}</div>` : ""}
<h2 style="color:${RED};margin:0 0 12px;">${isCorrection ? "Bilhetes corrigidos" : "Bilhetes publicados"} — ${esc(payload.drawDateLabel)}</h2>
<p style="font-size:14px;">Sua participação: <strong>${esc(payload.individualParticipation.cotas)}</strong> cota(s), ${usd(payload.individualParticipation.valor)}, status ${esc(payload.individualParticipation.status)}.</p>
<h3 style="color:${BLUE};margin:16px 0 8px;">Resumo financeiro</h3>
<table role="presentation" width="100%" cellpadding="5" style="font-size:13px;border-collapse:collapse;">
<tr><td style="color:#666;">Participantes</td><td>${f.participantCount}</td></tr>
<tr><td style="color:#666;">Total de cotas</td><td>${f.totalCotas}</td></tr>
<tr><td style="color:#666;">Valor por cota</td><td>${usd(f.valorPorCota)}</td></tr>
<tr><td style="color:#666;">Total arrecadado</td><td>${usd(f.totalArrecadado)}</td></tr>
<tr><td style="color:#666;">Valor usado</td><td>${usd(f.valorUsado)}</td></tr>
<tr><td style="color:#666;">Saldo reservado</td><td>${usd(f.saldoReservado)}</td></tr>
<tr><td style="color:#666;">Tickets</td><td>${f.ticketCount}</td></tr>
<tr><td style="color:#666;">Custo total</td><td>${usd(f.totalCost)}</td></tr>
<tr><td style="color:#666;">Power Play</td><td>${f.powerPlay != null ? usd(f.powerPlay) + "/ticket" : "—"}</td></tr>
</table>
<h3 style="color:${BLUE};margin:16px 0 8px;">Todos os números jogados</h3>
<table role="presentation" width="100%" cellpadding="0" style="font-size:13px;border-collapse:collapse;">${ticketsHtml}</table>
${payload.proofUrl ? `<p style="font-size:13px;margin-top:12px;"><a href="${esc(payload.proofUrl)}" style="color:${BLUE};">Ver comprovante de compra</a></p>` : ""}
<h3 style="color:${BLUE};margin:16px 0 8px;">Como conferir</h3>
<p style="font-size:13px;line-height:1.5;">O manifesto desta publicação (JSON) tem hash SHA-256 <code style="background:#f0f0f0;padding:2px 4px;border-radius:4px;">${esc(payload.manifestHash)}</code>. Compare esse hash com o anexo/PDF para confirmar que os números não foram alterados após a publicação.</p>
<p style="font-size:12px;color:#999;">Versão da publicação: ${esc(payload.publicationVersion)} · Publicado em ${esc(payload.generatedAtUtc)} (UTC)</p>`;
  return shell({ title: isCorrection ? "Correção dos bilhetes — Powerball" : "Bilhetes publicados — Powerball", bodyHtml: body, testMode });
}

export function renderTicketPublicationText(payload, testMode) {
  const f = payload.financialSummary;
  const lines = [
    testMode ? "[TESTE ADMIN] — não é um envio de produção" : null,
    payload.templateId === "tickets-corrected"
      ? `CORREÇÃO — Powerball ${payload.drawDateLabel} — Versão ${payload.publicationVersion}`
      : `Bilhetes publicados — Powerball ${payload.drawDateLabel}`,
    payload.correctionReason ? `Motivo: ${payload.correctionReason}` : null,
    "",
    `Sua participação: ${payload.individualParticipation.cotas} cota(s), ${usd(payload.individualParticipation.valor)}, status ${payload.individualParticipation.status}`,
    "",
    "Resumo financeiro:",
    `  Participantes: ${f.participantCount}`,
    `  Total de cotas: ${f.totalCotas}`,
    `  Valor por cota: ${usd(f.valorPorCota)}`,
    `  Total arrecadado: ${usd(f.totalArrecadado)}`,
    `  Valor usado: ${usd(f.valorUsado)}`,
    `  Saldo reservado: ${usd(f.saldoReservado)}`,
    `  Tickets: ${f.ticketCount}`,
    `  Custo total: ${usd(f.totalCost)}`,
    "",
    "Números jogados:",
    ...payload.tickets.map((t, i) => `  #${i + 1}: ${t.numbers.join("-")} — PB ${t.special}`),
    "",
    `Hash SHA-256 do manifesto: ${payload.manifestHash}`,
    `Versão: ${payload.publicationVersion} · Publicado em ${payload.generatedAtUtc} UTC`,
  ].filter((l) => l !== null);
  return lines.join("\n");
}
