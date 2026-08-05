// render.mjs — subject/HTML/text renderers. Powerball visual identity preserved
// exactly: red #CE1141 / blue #003DA5 (from js/data.js LOTTERY_GAME_TYPES.powerball),
// inline CSS only, no JS in emails.
//
// Round-2 rewrite: friendly PT-BR content, whole-prize vs per-participant
// estimate sections clearly separated and labeled from the REAL function's
// actual return shape (never "anuidade total" for what would be an
// installment — the real calculatePrizePerParticipant genuinely returns a
// 30-year total, so that label is accurate; see docs), visual ball rendering,
// explicit reconciliation block, and correction content generated only from
// a real computeTicketDiff (never a typed description).

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
function pct(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + "%";
}
function friendlyDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/New_York" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${datePart} às ${timePart} ET`;
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

function ballsRow(ticket) {
  const white = ticket.numbers.slice().sort((a, b) => a - b).map((n) =>
    `<span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#f0f0f0;border:1px solid #ccc;text-align:center;font-size:13px;font-weight:bold;margin-right:4px;">${n}</span>`
  ).join("");
  const red = `<span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:${RED};color:#fff;text-align:center;font-size:13px;font-weight:bold;">${ticket.special}</span>`;
  return white + red;
}
function ballsText(ticket) {
  return ticket.numbers.slice().sort((a, b) => a - b).join("  ") + "     Powerball " + ticket.special;
}

// ---------- participant-added ----------

export function renderParticipantConfirmationSubject(payload, testMode) {
  const prefix = testMode ? "[TESTE ADMIN] " : "";
  return `${prefix}✅ Participação confirmada — Bolão Powerball — Sorteio de ${payload.drawDateLabel}`;
}

export function renderParticipantConfirmationHtml(payload, testMode) {
  const e = payload.estimates || {};
  const body = `
<h2 style="color:${RED};margin:0 0 12px;">Olá, ${esc(payload.participantName)}!</h2>
<p style="font-size:14px;line-height:1.5;">Sua participação no Bolão Powerball foi registrada com sucesso. Confira abaixo os dados considerados para este sorteio.</p>
<h3 style="color:${BLUE};margin:20px 0 8px;">Sua participação</h3>
<table role="presentation" width="100%" cellpadding="6" style="font-size:14px;border-collapse:collapse;">
<tr><td style="color:#666;">Sorteio</td><td>${esc(payload.drawDateLabel)}</td></tr>
<tr><td style="color:#666;">Data/horário da entrada</td><td>${esc(payload.entryDate)} ${esc(payload.entryTime || "")}</td></tr>
<tr><td style="color:#666;">Cotas</td><td>${esc(payload.participantShares)} cota${payload.participantShares === 1 ? "" : "s"} de ${esc(payload.totalShares)} cotas</td></tr>
<tr><td style="color:#666;">Valor registrado</td><td>${usd(payload.valor)}</td></tr>
<tr><td style="color:#666;">Participação no bolão</td><td><strong>${pct(payload.participantPercentage)}</strong></td></tr>
<tr><td style="color:#666;">Pagamento</td><td>${esc(payload.paymentStatus)}</td></tr>
<tr><td style="color:#666;">Estado considerado</td><td>${esc(payload.state)}</td></tr>
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
<tr><td style="color:#666;">Anuidade total bruta, 30 anos (sua participação)</td><td>${usd(e.annuityTotalBruto)}</td></tr>
<tr><td style="color:#666;">Anuidade total líquida, 30 anos (sua participação)</td><td><strong>${usd(e.annuityTotalNet)}</strong></td></tr>
<tr><td style="color:#666;">Média mensal estimada (didática, não é parcela real)</td><td>${usd(e.annuityMonthlyNet)}</td></tr>
`}
</table>
<p style="font-size:12px;color:#999;margin-top:12px;">Estimativas calculadas considerando o estado declarado: ${esc(payload.state)}. Os valores são estimativas e podem mudar. O pagamento final depende das regras oficiais, opção escolhida, residência e obrigações fiscais.</p>
<p style="font-size:14px;margin-top:16px;"><a href="${esc(payload.siteUrl)}" style="color:${BLUE};">Ver o bolão</a></p>`;
  return shell({ title: "Participação confirmada — Bolão Powerball", bodyHtml: body, testMode });
}

export function renderParticipantConfirmationText(payload, testMode) {
  const e = payload.estimates || {};
  const lines = [
    testMode ? "TESTE ADMINISTRATIVO — Esta mensagem não representa uma publicação ou envio de produção." : null,
    `Olá, ${payload.participantName}!`,
    "Sua participação no Bolão Powerball foi registrada com sucesso.",
    "",
    "Sua participação:",
    `  Sorteio: ${payload.drawDateLabel}`,
    `  Data/horário da entrada: ${payload.entryDate} ${payload.entryTime || ""}`,
    `  Cotas: ${payload.participantShares} cota(s) de ${payload.totalShares} cotas`,
    `  Valor registrado: ${usd(payload.valor)}`,
    `  Participação no bolão: ${pct(payload.participantPercentage)}`,
    `  Pagamento: ${payload.paymentStatus}`,
    `  Estado considerado: ${payload.state}`,
    "",
    "Estimativas do prêmio:",
    `  Jackpot anunciado: ${usd(payload.jackpot)}`,
    `  Cash option (total): ${usd(payload.cashValue)}`,
    "  Estimativa correspondente à sua participação:",
    e.stateKnown === false
      ? "    Estado não suportado pelo cálculo — estimativa indisponível."
      : [
          `    Lump Sum líquido: ${usd(e.lumpSumNet)}`,
          `    Anuidade total líquida (30 anos): ${usd(e.annuityTotalNet)}`,
        ].join("\n"),
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
  return `${prefix}🎟️ Bilhetes publicados — Powerball de ${payload.drawDateLabel} — ${payload.tickets.length} jogos`;
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
  const ticketsHtml = payload.tickets.map((t, i) =>
    `<tr><td style="padding:6px 8px;color:#666;font-size:12px;width:50px;">Jogo ${String(i + 1).padStart(2, "0")}</td><td style="padding:6px 8px;">${ballsRow(t)}</td></tr>`
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

  const body = `
<h2 style="color:${RED};margin:0 0 12px;">${isCorrection ? `Correção dos bilhetes — Versão ${esc(payload.publicationVersion)}` : "Bilhetes publicados"}</h2>
<p style="font-size:14px;">${isCorrection
    ? `Uma correção foi identificada nos bilhetes do Powerball de ${esc(payload.drawDateLabel)}.`
    : `Os bilhetes do Powerball de ${esc(payload.drawDateLabel)} foram registrados e publicados. Confira abaixo todas as informações usadas nesta publicação.`}</p>
${diffHtml}
<h3 style="color:${BLUE};margin:16px 0 8px;">Sua participação</h3>
<table role="presentation" width="100%" cellpadding="5" style="font-size:13px;border-collapse:collapse;">
<tr><td style="color:#666;">Nome</td><td>${esc(payload.participantName)}</td></tr>
<tr><td style="color:#666;">Cotas</td><td>${esc(payload.individualParticipation.shares)} de ${esc(payload.totalShares)}</td></tr>
<tr><td style="color:#666;">Valor contribuído</td><td>${usd(payload.individualParticipation.valor)}</td></tr>
<tr><td style="color:#666;">Participação</td><td>${pct(payload.individualParticipation.percentage)}</td></tr>
<tr><td style="color:#666;">Pagamento</td><td>${esc(payload.individualParticipation.status)}</td></tr>
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
${payload.proofUrl ? `<a href="${esc(payload.proofUrl)}" style="color:${BLUE};">Ver comprovantes de compra</a><br>` : ""}
<a href="#" style="color:${BLUE};">Baixar PDF para auditoria</a><br>
<a href="#" style="color:${BLUE};">Baixar CSV</a><br>
<a href="#" style="color:${BLUE};">Baixar manifesto JSON</a>
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
    `  ${payload.individualParticipation.shares} de ${payload.totalShares} cotas, ${usd(payload.individualParticipation.valor)}, ${pct(payload.individualParticipation.percentage)}, status ${payload.individualParticipation.status}`,
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
    ...payload.tickets.map((t, i) => `  Jogo ${String(i + 1).padStart(2, "0")}: ${ballsText(t)}`),
    "",
    `Hash (resumido): ${payload.manifestHashShort}`,
    `Publicado em ${friendlyDate(payload.generatedAtUtc)}`,
    `Registro UTC: ${payload.generatedAtUtc}`,
  );
  return lines.filter((l) => l !== null).join("\n");
}
