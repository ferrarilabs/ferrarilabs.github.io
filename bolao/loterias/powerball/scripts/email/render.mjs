// render.mjs — subject/HTML/text renderers. Powerball visual identity preserved
// exactly: red #CE1141 / blue #003DA5 (from js/data.js LOTTERY_GAME_TYPES.powerball),
// inline CSS only, no JS in emails.
//
// Round-3 fixes (found via real Gmail cross-check of delivered test emails,
// not just providerStatus:200 — see docs/bolao/loterias/POWERBALL_EMAIL_ARCHITECTURE.md):
//   - Ticket numbers rendered as separate <span>s with only CSS margin for
//     spacing collapsed into "243147526317" wherever a client stripped inline
//     styles. Fixed: every number is now its own <td> in a real table row,
//     AND a literal " - " text separator sits between cells, so the numbers
//     stay legible even with zero CSS applied.
//   - Annuity section previously offered a "média mensal estimada" framed as
//     didactic — reworded per Eduardo's request to an annual illustrative
//     average with an explicit "payments are not necessarily equal" caveat,
//     no invented monthly installment.
//   - State codes now expand to full PT-BR names, payment status to friendly
//     text, currency unified to "$X.XX", dates friendly-first with the
//     compact/technical form secondary.

const RED = "#CE1141";
const BLUE = "#003DA5";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function usd(n) {
  if (n === null || n === undefined) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + "%";
}

// EmailJS HTML-escapes subject template variables server-side (confirmed by
// cross-checking an actual delivered test email: "05/08/2026" arrived as the
// literal text "05&#x2F;08&#x2F;2026" in the inbox). send_result_email.py's
// working precedent avoids this by using "." instead of "/" in subject dates
// ("Subject uses '.' instead of '/' to avoid HTML escaping in EmailJS
// template" — see its own comment). Subject lines must use this helper for
// any date; body HTML is unaffected (it goes through {{{html_message}}},
// triple-brace/unescaped, per CLAUDE.md's documented template convention).
function subjectSafeDate(label) {
  return String(label || "").replace(/\//g, ".");
}

const STATE_NAMES = { NC: "Carolina do Norte", FL: "Flórida" };
function stateName(code) {
  return STATE_NAMES[code] || code || "—";
}

const PAYMENT_STATUS_LABELS = {
  verificado: "Pagamento confirmado",
  organizador: "Organizador (fundo próprio)",
  recorrente: "Recorrente (aguardando confirmação)",
  cancelado: "Cancelado",
};
function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || status || "—";
}

// Never render a localhost/dev/placeholder URL as if it were a live,
// clickable link (found: a dev preview session used
// http://localhost:8099/... while iterating on these templates — must never
// leak into an actually-sent email). RFC 2606 reserved TLDs (.invalid,
// .example, .test) and .local are also treated as non-functional, since
// they are guaranteed-unreachable by design, same as this fixture's own
// proofUrl.
function isRealUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return false;
    if (/\.(invalid|example|test|local)$/.test(host)) return false;
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return true;
  } catch {
    return false;
  }
}

function friendlyDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/New_York" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${datePart} às ${timePart} ET`;
}

// participant.data is "DD/MM/YYYY" (pt-BR, no timezone) + a separate free-text
// hora string like "9:00 AM" — friendly-first display, compact form secondary.
const PT_MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function friendlyEntryDate(dataStr, horaStr) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dataStr || "");
  if (!m) return { friendly: dataStr || "—", compact: `${dataStr || "—"} ${horaStr || ""}`.trim() };
  const day = Number(m[1]);
  const month = PT_MONTHS[Number(m[2]) - 1] || m[2];
  const year = m[3];
  const friendly = `${day} de ${month} de ${year}${horaStr && horaStr !== "—" ? " às " + horaStr : ""}`;
  return { friendly, compact: `${dataStr} ${horaStr || ""}`.trim() };
}

function shell({ title, bodyHtml, testMode }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
${testMode ? `<div style="background:#fff3cd;color:#7a5b00;text-align:center;padding:8px;font-size:13px;font-weight:bold;">TESTE ADMINISTRATIVO — Esta mensagem não representa uma publicação ou envio de produção.</div>` : ""}
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

// Canonical plain-text ticket line — the exact format Eduardo specified,
// survives any client/font/stripped styling because it is 100% literal text,
// no reliance on color or position to convey which number is the Powerball:
//   "24 · 31 · 47 · 52 · 64 | Powerball: 17 | Power Play: Sim"
function ticketPlainLine(ticket, powerPlay) {
  const nums = ticket.numbers.slice().sort((a, b) => a - b).join(" · ");
  return `${nums} | Powerball: ${ticket.special} | Power Play: ${powerPlay ? "Sim" : "Não"}`;
}

// HTML ball row. Two layers, both always present:
//  1. A literal text line matching ticketPlainLine EXACTLY (same string,
//     same "Powerball: N" label) — this is what remains if the client
//     strips every tag/style, so the Powerball number is NEVER a bare
//     unlabeled digit relying on red color or trailing position to be
//     understood.
//  2. On top of that, a table-cell + circle visual treatment (light cells
//     for the five white balls, red cell explicitly following a "Powerball:"
//     text label, not a loose number) for clients that do honor inline
//     styles.
function ballsRowHtml(ticket, powerPlay) {
  const nums = ticket.numbers.slice().sort((a, b) => a - b);
  const numCells = nums.map((n, i) => {
    const cell = `<td style="padding:0 2px;text-align:center;"><span style="display:inline-block;min-width:24px;padding:4px 6px;border-radius:50%;background:#f0f0f0;border:1px solid #ccc;font-size:13px;font-weight:bold;">${n}</span></td>`;
    return i < nums.length - 1 ? cell + `<td style="padding:0 4px;color:#999;font-size:13px;">·</td>` : cell;
  }).join("");
  const pbLabelCell = `<td style="padding:0 4px 0 10px;color:#666;font-size:12px;white-space:nowrap;">| Powerball:</td>`;
  const pbCell = `<td style="padding:0 2px;text-align:center;"><span style="display:inline-block;min-width:24px;padding:4px 6px;border-radius:50%;background:${RED};color:#fff;font-size:13px;font-weight:bold;">${ticket.special}</span></td>`;
  const ppCell = `<td style="padding:0 2px 0 10px;color:#666;font-size:12px;white-space:nowrap;">| Power Play: ${powerPlay ? "Sim" : "Não"}</td>`;
  const visualTable = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${numCells}${pbLabelCell}${pbCell}${ppCell}</tr></table>`;
  // Literal fallback line, identical text to ticketPlainLine — kept as real
  // text content (not a CSS ::before/content trick, which some clients also
  // strip), in a small muted line under the visual row for redundancy.
  const fallbackLine = `<div style="font-size:11px;color:#999;margin-top:2px;">${esc(ticketPlainLine(ticket, powerPlay))}</div>`;
  return visualTable + fallbackLine;
}

// ---------- participant-added ----------

export function renderParticipantConfirmationSubject(payload, testMode) {
  const prefix = testMode ? "[TESTE ADMIN] " : "";
  return `${prefix}✅ Participação confirmada — Bolão Powerball — Sorteio de ${subjectSafeDate(payload.drawDateLabel)}`;
}

export function renderParticipantConfirmationHtml(payload, testMode) {
  const e = payload.estimates || {};
  const entry = friendlyEntryDate(payload.entryDate, payload.entryTime);
  const body = `
<h2 style="color:${RED};margin:0 0 12px;">Olá, ${esc(payload.participantName)}!</h2>
<p style="font-size:14px;line-height:1.5;">Sua participação no Bolão Powerball foi registrada com sucesso. Confira abaixo os dados considerados para este sorteio.</p>
<h3 style="color:${BLUE};margin:20px 0 8px;">Sua participação</h3>
<table role="presentation" width="100%" cellpadding="6" style="font-size:14px;border-collapse:collapse;">
<tr><td style="color:#666;">Sorteio</td><td>${friendlyDate(payload.drawDateIso)}<br><span style="font-size:11px;color:#999;">${esc(payload.drawDateLabel)}</span></td></tr>
<tr><td style="color:#666;">Data/horário da entrada</td><td>${esc(entry.friendly)}<br><span style="font-size:11px;color:#999;">${esc(entry.compact)}</span></td></tr>
<tr><td style="color:#666;">Cotas</td><td>${esc(payload.participantShares)} cota${payload.participantShares === 1 ? "" : "s"} de ${esc(payload.totalShares)} cotas</td></tr>
<tr><td style="color:#666;">Valor registrado</td><td>${usd(payload.valor)}</td></tr>
<tr><td style="color:#666;">Participação no bolão</td><td><strong>${pct(payload.participantPercentage)}</strong></td></tr>
<tr><td style="color:#666;">Pagamento</td><td>${esc(paymentStatusLabel(payload.paymentStatus))}</td></tr>
<tr><td style="color:#666;">Estado considerado</td><td>${esc(stateName(payload.state))}</td></tr>
</table>
<h3 style="color:${BLUE};margin:20px 0 8px;">Estimativas do prêmio</h3>
<table role="presentation" width="100%" cellpadding="6" style="font-size:14px;border-collapse:collapse;background:#f8f9fc;border-radius:8px;">
<tr><td style="color:#666;">Jackpot anunciado</td><td>${usd(payload.jackpot)}</td></tr>
<tr><td style="color:#666;">Cash option (total)</td><td>${usd(payload.cashValue)}</td></tr>
</table>
<p style="font-size:13px;color:#444;margin:12px 0 4px;font-weight:bold;">Estimativa correspondente à sua participação</p>
<table role="presentation" width="100%" cellpadding="6" style="font-size:14px;border-collapse:collapse;background:#f8f9fc;border-radius:8px;">
${e.stateKnown === false ? `<tr><td colspan="2" style="color:#a00;">Estado não suportado pelo cálculo — estimativa indisponível.</td></tr>` : `
<tr><td style="color:#666;">Lump Sum bruto (sua participação)</td><td>${usd(e.lumpSumBruto)}</td></tr>
<tr><td style="color:#666;">Lump Sum líquido (sua participação)</td><td><strong>${usd(e.lumpSumNet)}</strong></td></tr>
<tr><td style="color:#666;">Anuidade total bruta estimada ao longo de 30 anos (sua participação)</td><td>${usd(e.annuityTotalBruto)}</td></tr>
<tr><td style="color:#666;">Anuidade total líquida estimada ao longo de 30 anos (sua participação)</td><td><strong>${usd(e.annuityTotalNet)}</strong></td></tr>
<tr><td style="color:#666;">Média anual líquida (meramente ilustrativa)</td><td>${usd(e.annuityTotalNet != null ? e.annuityTotalNet / 30 : null)}</td></tr>
`}
</table>
${e.stateKnown === false ? "" : `<p style="font-size:11px;color:#999;margin-top:4px;">Os pagamentos anuais oficiais não são necessariamente iguais entre si (a anuidade real cresce ano a ano). A média anual acima é apenas ilustrativa, não uma previsão de parcela.</p>`}
<p style="font-size:12px;color:#999;margin-top:12px;">Estimativas calculadas considerando o estado declarado: ${esc(stateName(payload.state))}. Os valores são estimativas e podem mudar. O pagamento final depende das regras oficiais, opção escolhida, residência e obrigações fiscais.</p>
<p style="font-size:14px;margin-top:16px;">${isRealUrl(payload.siteUrl) ? `<a href="${esc(payload.siteUrl)}" style="color:${BLUE};">Ver o bolão</a>` : `Site: <em>${esc(payload.siteUrl)}</em> (endereço não é um link real neste teste)`}</p>`;
  return shell({ title: "Participação confirmada — Bolão Powerball", bodyHtml: body, testMode });
}

export function renderParticipantConfirmationText(payload, testMode) {
  const e = payload.estimates || {};
  const entry = friendlyEntryDate(payload.entryDate, payload.entryTime);
  const lines = [
    testMode ? "TESTE ADMINISTRATIVO — Esta mensagem não representa uma publicação ou envio de produção." : null,
    `Olá, ${payload.participantName}!`,
    "Sua participação no Bolão Powerball foi registrada com sucesso.",
    "",
    "Sua participação:",
    `  Sorteio: ${friendlyDate(payload.drawDateIso)} (${payload.drawDateLabel})`,
    `  Data/horário da entrada: ${entry.friendly} (${entry.compact})`,
    `  Cotas: ${payload.participantShares} cota(s) de ${payload.totalShares} cotas`,
    `  Valor registrado: ${usd(payload.valor)}`,
    `  Participação no bolão: ${pct(payload.participantPercentage)}`,
    `  Pagamento: ${paymentStatusLabel(payload.paymentStatus)}`,
    `  Estado considerado: ${stateName(payload.state)}`,
    "",
    "Estimativas do prêmio:",
    `  Jackpot anunciado: ${usd(payload.jackpot)}`,
    `  Cash option (total): ${usd(payload.cashValue)}`,
    "  Estimativa correspondente à sua participação:",
    e.stateKnown === false
      ? "    Estado não suportado pelo cálculo — estimativa indisponível."
      : [
          `    Lump Sum líquido: ${usd(e.lumpSumNet)}`,
          `    Anuidade total líquida estimada ao longo de 30 anos: ${usd(e.annuityTotalNet)}`,
          `    Média anual líquida (meramente ilustrativa): ${usd(e.annuityTotalNet != null ? e.annuityTotalNet / 30 : null)}`,
          "    (Os pagamentos anuais oficiais não são necessariamente iguais entre si; a média acima é apenas ilustrativa.)",
        ].join("\n"),
    "",
    `Site: ${payload.siteUrl}`,
  ].filter((l) => l !== null);
  return lines.join("\n");
}

// ---------- tickets-published / tickets-corrected ----------

export function renderTicketPublicationSubject(payload, testMode) {
  const prefix = testMode ? "[TESTE ADMIN] " : "";
  const dateLabel = subjectSafeDate(payload.drawDateLabel);
  if (payload.templateId === "tickets-corrected") {
    return `${prefix}⚠️ Correção dos bilhetes — Powerball de ${dateLabel} — Versão ${payload.publicationVersion}`;
  }
  return `${prefix}🎟️ Bilhetes publicados — Powerball de ${dateLabel} — ${payload.tickets.length} jogos`;
}

function reconciliationHtml(f) {
  return `
<h3 style="color:${BLUE};margin:16px 0 8px;">Reconciliação</h3>
<table role="presentation" width="100%" cellpadding="5" style="font-size:13px;border-collapse:collapse;font-family:monospace;">
<tr><td>Total arrecadado</td><td style="text-align:right;">${usd(f.totalArrecadado)}</td></tr>
<tr><td>Valor utilizado</td><td style="text-align:right;">${usd(f.valorUsado)}</td></tr>
<tr><td>Saldo reservado</td><td style="text-align:right;">${usd(f.saldoReservado)}</td></tr>
${f.reembolso ? `<tr><td>Reembolso</td><td style="text-align:right;">${usd(f.reembolso)}</td></tr>` : ""}
${f.outrasDestinacoes ? `<tr><td>Outras destinações</td><td style="text-align:right;">${usd(f.outrasDestinacoes)}</td></tr>` : ""}
<tr><td style="font-weight:bold;">Diferença não conciliada</td><td style="text-align:right;font-weight:bold;color:${f.diferencaNaoConciliada === 0 ? "#2a7" : "#a00"};">${usd(f.diferencaNaoConciliada)}</td></tr>
</table>`;
}

export function renderTicketPublicationHtml(payload, testMode) {
  const f = payload.financialSummary;
  const isCorrection = payload.templateId === "tickets-corrected";
  const powerPlay = !!f.costPerTicket;
  const ticketsHtml = payload.tickets.map((t, i) =>
    `<tr><td style="padding:8px 8px;color:#666;font-size:12px;width:60px;vertical-align:middle;">Jogo ${String(i + 1).padStart(2, "0")}</td><td style="padding:8px 8px;">${ballsRowHtml(t, powerPlay)}</td></tr>`
  ).join("");

  let diffHtml = "";
  if (isCorrection && payload.diff) {
    diffHtml = `
<h3 style="color:${RED};margin:16px 0 8px;">O que foi alterado</h3>
${payload.diff.changed.map((c) => `
  <div style="background:#fff3cd;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:13px;">
    <strong>Jogo ${String(c.index + 1).padStart(2, "0")}</strong><br>
    Antes: ${c.beforeText ? esc(c.beforeText) : "<em>(não existia)</em>"}<br>
    Depois: ${c.afterText ? esc(c.afterText) : "<em>(removido)</em>"}<br>
    ${payload.correctionReason ? `Motivo: ${esc(payload.correctionReason)}` : ""}
  </div>`).join("")}
<p style="font-size:12px;color:#666;">Hash da versão anterior: <code>${esc(payload.previousHashShort)}</code> · Hash da nova versão: <code>${esc(payload.manifestHashShort)}</code></p>`;
  }

  const friendlyDrawDate = payload.drawDateIso ? friendlyDate(payload.drawDateIso) : payload.drawDateLabel;
  const body = `
<h2 style="color:${RED};margin:0 0 12px;">${isCorrection ? `Correção dos bilhetes — Versão ${esc(payload.publicationVersion)}` : "Bilhetes publicados"}</h2>
<p style="font-size:14px;">${isCorrection
    ? `Uma correção foi identificada nos bilhetes do Powerball de ${esc(friendlyDrawDate)}.`
    : `Os bilhetes do Powerball de ${esc(friendlyDrawDate)} foram registrados e publicados. Confira abaixo todas as informações usadas nesta publicação.`}</p>
${diffHtml}
<h3 style="color:${BLUE};margin:16px 0 8px;">Sua participação</h3>
<table role="presentation" width="100%" cellpadding="5" style="font-size:13px;border-collapse:collapse;">
<tr><td style="color:#666;">Sorteio</td><td>${esc(friendlyDrawDate)}<br><span style="font-size:11px;color:#999;">${esc(payload.drawDateLabel)}</span></td></tr>
<tr><td style="color:#666;">Nome</td><td>${esc(payload.participantName)}</td></tr>
<tr><td style="color:#666;">Cotas</td><td>${esc(payload.individualParticipation.shares)} de ${esc(payload.totalShares)}</td></tr>
<tr><td style="color:#666;">Valor contribuído</td><td>${usd(payload.individualParticipation.valor)}</td></tr>
<tr><td style="color:#666;">Participação</td><td>${pct(payload.individualParticipation.percentage)}</td></tr>
<tr><td style="color:#666;">Pagamento</td><td>${esc(paymentStatusLabel(payload.individualParticipation.status))}</td></tr>
</table>
<h3 style="color:${BLUE};margin:16px 0 8px;">Resumo geral do bolão</h3>
<table role="presentation" width="100%" cellpadding="5" style="font-size:13px;border-collapse:collapse;">
<tr><td style="color:#666;">Participantes ativos</td><td>${f.participantCount}</td></tr>
<tr><td style="color:#666;">Total de cotas</td><td>${f.totalShares}</td></tr>
<tr><td style="color:#666;">Valor por cota</td><td>${usd(f.valorPorCota)}</td></tr>
<tr><td style="color:#666;">Total arrecadado</td><td>${usd(f.totalArrecadado)}</td></tr>
<tr><td style="color:#666;">Valor usado</td><td>${usd(f.valorUsado)}</td></tr>
<tr><td style="color:#666;">Saldo reservado</td><td>${usd(f.saldoReservado)}</td></tr>
<tr><td style="color:#666;">Quantidade de jogos</td><td>${f.ticketCount}</td></tr>
<tr><td style="color:#666;">Custo por jogo</td><td>${usd(f.costPerTicket)}</td></tr>
<tr><td style="color:#666;">Custo total</td><td>${usd(f.ticketCostTotal)}</td></tr>
</table>
${reconciliationHtml(f)}
<h3 style="color:${BLUE};margin:16px 0 8px;">Conjunto completo ${isCorrection ? "revisado" : "de jogos"}</h3>
<table role="presentation" width="100%" cellpadding="0" style="font-size:13px;border-collapse:collapse;">${ticketsHtml}</table>
<h3 style="color:${BLUE};margin:16px 0 8px;">Comprovantes e auditoria</h3>
<p style="font-size:13px;line-height:1.8;">
${payload.proofUrl ? (isRealUrl(payload.proofUrl)
    ? `<a href="${esc(payload.proofUrl)}" style="color:${BLUE};">Ver comprovantes de compra</a><br>`
    : `Comprovante de compra: <em>${esc(payload.proofUrl)}</em> (endereço de exemplo, não é um link real neste teste)<br>`)
  : "Comprovante de compra: não informado nesta publicação.<br>"}
PDF, CSV e manifesto JSON desta publicação são gerados junto com este envio (ver <code>email-previews/</code> / anexos administrativos) — nenhum link de download é enviado dentro do corpo do e-mail nesta versão.
</p>
<h3 style="color:${BLUE};margin:16px 0 8px;">Como conferir</h3>
<p style="font-size:13px;line-height:1.5;">Este código identifica exatamente esta versão dos bilhetes. Caso qualquer número seja alterado, o código também mudará.<br>
Código (resumido): <code style="background:#f0f0f0;padding:2px 4px;border-radius:4px;">${esc(payload.manifestHashShort)}</code></p>
<p style="font-size:12px;color:#999;">Publicado em ${friendlyDate(payload.generatedAtUtc)}<br>Registro UTC: ${esc(payload.generatedAtUtc)}</p>`;
  return shell({ title: isCorrection ? "Correção dos bilhetes — Powerball" : "Bilhetes publicados — Powerball", bodyHtml: body, testMode });
}

export function renderTicketPublicationText(payload, testMode) {
  const f = payload.financialSummary;
  const isCorrection = payload.templateId === "tickets-corrected";
  const powerPlay = !!f.costPerTicket;
  const lines = [
    testMode ? "TESTE ADMINISTRATIVO — Esta mensagem não representa uma publicação ou envio de produção." : null,
    isCorrection ? `Correção dos bilhetes — Versão ${payload.publicationVersion}` : `Bilhetes publicados — Powerball ${payload.drawDateLabel} — ${payload.tickets.length} jogos`,
    "",
  ];
  if (isCorrection && payload.diff) {
    lines.push("O que foi alterado:");
    payload.diff.changed.forEach((c) => {
      lines.push(`  Jogo ${String(c.index + 1).padStart(2, "0")}`);
      lines.push(`    Antes: ${c.beforeText || "(não existia)"}`);
      lines.push(`    Depois: ${c.afterText || "(removido)"}`);
      if (payload.correctionReason) lines.push(`    Motivo: ${payload.correctionReason}`);
    });
    lines.push(`  Hash anterior: ${payload.previousHashShort} · Hash novo: ${payload.manifestHashShort}`);
    lines.push("");
  }
  lines.push(
    "Sua participação:",
    `  ${payload.individualParticipation.shares} de ${payload.totalShares} cotas, ${usd(payload.individualParticipation.valor)}, ${pct(payload.individualParticipation.percentage)}, ${paymentStatusLabel(payload.individualParticipation.status)}`,
    "",
    "Resumo geral:",
    `  Participantes: ${f.participantCount}`,
    `  Total de cotas: ${f.totalShares}`,
    `  Valor por cota: ${usd(f.valorPorCota)}`,
    `  Total arrecadado: ${usd(f.totalArrecadado)}`,
    `  Valor usado: ${usd(f.valorUsado)}`,
    `  Saldo reservado: ${usd(f.saldoReservado)}`,
    `  Diferença não conciliada: ${usd(f.diferencaNaoConciliada)}`,
    "",
    "Jogos:",
    ...payload.tickets.map((t, i) => `  Jogo ${String(i + 1).padStart(2, "0")}: ${ticketPlainLine(t, powerPlay)}`),
    "",
    `Hash (resumido): ${payload.manifestHashShort}`,
    `Publicado em ${friendlyDate(payload.generatedAtUtc)}`,
    `Registro UTC: ${payload.generatedAtUtc}`,
  );
  return lines.filter((l) => l !== null).join("\n");
}
