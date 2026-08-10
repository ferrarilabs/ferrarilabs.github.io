// pdf.mjs — minimal hand-rolled multi-page PDF writer (no dependencies).
// Used for the ticket-publication manifest PDF. Not a general-purpose PDF
// library — just enough structure (title/heading/body/mono/rule styles,
// 3 standard fonts, absolute positioning) to produce something readable,
// not a wall of monospace text at one size.

// PT-BR text has both accented Latin-1 characters (ã, ç, é — code points 0x00E0-0x00FF,
// same numeric value in WinAnsiEncoding as in Latin-1) AND typographic punctuation outside
// Latin-1 (em dash U+2014, ellipsis U+2026) that Buffer.from(str, "latin1") would silently
// truncate to garbage low bytes. Two real bugs found by actually opening a rendered PDF
// (2026-08-10): "Bolao" with a tilde-a rendered as a completely different glyph
// (StandardEncoding — the Type1 default when no /Encoding is declared — maps byte 0xE3 to a
// different character than Latin-1/WinAnsi does), and the em dash vanished entirely. Fixed by
// (a) remapping the handful of typographic punctuation marks this file actually uses into
// their WinAnsiEncoding code points before the latin1 buffer conversion, and (b) declaring
// /Encoding /WinAnsiEncoding on every font object so byte 0xE3 is interpreted the way the
// source string intended.
const EM_DASH = "—", EN_DASH = "–", LSQUO = "‘", RSQUO = "’", LDQUO = "“", RDQUO = "”", ELLIPSIS = "…";
const PUNCT_TO_WINANSI = {
  [EM_DASH]: String.fromCharCode(0x97),
  [EN_DASH]: String.fromCharCode(0x96),
  [LSQUO]: String.fromCharCode(0x91),
  [RSQUO]: String.fromCharCode(0x92),
  [LDQUO]: String.fromCharCode(0x93),
  [RDQUO]: String.fromCharCode(0x94),
  [ELLIPSIS]: String.fromCharCode(0x85),
};
const PUNCT_RE = new RegExp(`[${EM_DASH}${EN_DASH}${LSQUO}${RSQUO}${LDQUO}${RDQUO}${ELLIPSIS}]`, "g");
function toWinAnsi(s) {
  return String(s).replace(PUNCT_RE, (c) => PUNCT_TO_WINANSI[c]);
}
function esc(s) {
  return toWinAnsi(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const FONT_REF = { regular: "F1", bold: "F2", mono: "F3" };
const FONT_BASENAME = { regular: "Helvetica", bold: "Helvetica-Bold", mono: "Courier" };

// Powerball brand colors (same values used in render.mjs's HTML), as PDF `rg` RGB triples.
const RED = "0.808 0.067 0.255"; // #CE1141
const BLUE = "0 0.239 0.647"; // #003DA5
const STYLE = {
  title: { font: "bold", size: 18, color: RED, lead: 24, before: 0 },
  meta: { font: "regular", size: 9, color: "0.4 0.4 0.4", lead: 13, before: 2 },
  h2: { font: "bold", size: 12, color: BLUE, lead: 17, before: 10 },
  h3: { font: "bold", size: 9, color: "0.3 0.3 0.3", lead: 13, before: 6 },
  text: { font: "regular", size: 10, color: "0.1 0.1 0.1", lead: 14, before: 0 },
  mono: { font: "mono", size: 9, color: "0.15 0.15 0.15", lead: 12, before: 0 },
  monoHeader: { font: "mono", size: 9, color: "0.35 0.35 0.35", lead: 12, before: 2 },
  small: { font: "regular", size: 8, color: "0.55 0.55 0.55", lead: 11, before: 0 },
  rule: { rule: true, lead: 9, before: 6 },
  space: { space: true, lead: 8, before: 0 },
};

/**
 * blocks: array of either plain strings (back-compat — rendered as "text" style)
 * or { text, style } objects, style one of the STYLE keys above.
 * Returns a Buffer with valid PDF bytes.
 */
export function buildTextPdf(blocks, { title } = {}) {
  const items = blocks.map((b) => (typeof b === "string" ? { text: b, style: "text" } : b));

  const pageWidth = 612, pageHeight = 792, marginX = 54, marginTop = 56, marginBottom = 50;
  const contentWidth = pageWidth - marginX * 2;

  // Pass 1: paginate. Each placed line/rule gets an absolute Y (PDF origin bottom-left).
  const pages = [[]];
  let y = pageHeight - marginTop;
  items.forEach((item) => {
    const st = STYLE[item.style] || STYLE.text;
    const need = (st.before || 0) + (st.lead || 14);
    if (y - need < marginBottom) { pages.push([]); y = pageHeight - marginTop; }
    y -= st.before || 0;
    pages[pages.length - 1].push({ text: item.text || "", style: item.style || "text", yAt: y, st });
    y -= st.lead;
  });

  // Pass 2: build content streams + page objects.
  const catalogNum = 1, pagesNum = 2;
  let nextNum = 3;
  const pageNums = [];
  const contentNums = [];
  const bodies = [];

  pages.forEach(() => { contentNums.push(nextNum++); pageNums.push(nextNum++); });
  const fontNums = { regular: nextNum++, bold: nextNum++, mono: nextNum++ };

  pages.forEach((lines, idx) => {
    let stream = "";
    lines.forEach((ln) => {
      if (ln.st.rule) {
        stream += `${ln.st.color || "0.85 0.85 0.85"} rg ${marginX} ${(ln.yAt - 3).toFixed(1)} ${contentWidth} 1 re f\n`;
        return;
      }
      if (ln.st.space || !ln.text) return;
      const ref = FONT_REF[ln.st.font] || FONT_REF.regular;
      stream += `BT /${ref} ${ln.st.size} Tf ${ln.st.color} rg 1 0 0 1 ${marginX} ${ln.yAt.toFixed(1)} Tm (${esc(ln.text)}) Tj ET\n`;
    });
    bodies[contentNums[idx]] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    bodies[pageNums[idx]] =
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 ${fontNums.regular} 0 R /F2 ${fontNums.bold} 0 R /F3 ${fontNums.mono} 0 R >> >> ` +
      `/Contents ${contentNums[idx]} 0 R >>`;
  });
  bodies[catalogNum] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
  bodies[pagesNum] = `<< /Type /Pages /Kids [${pageNums.map((n) => n + " 0 R").join(" ")}] /Count ${pageNums.length} >>`;
  // /Encoding /WinAnsiEncoding is what makes byte 0xE3 (etc.) map to the accented glyph a
  // Latin-1-encoded source string intended — without it Type1 base-14 fonts default to
  // StandardEncoding, which assigns a different character to the same byte value.
  bodies[fontNums.regular] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASENAME.regular} /Encoding /WinAnsiEncoding >>`;
  bodies[fontNums.bold] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASENAME.bold} /Encoding /WinAnsiEncoding >>`;
  bodies[fontNums.mono] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASENAME.mono} /Encoding /WinAnsiEncoding >>`;

  const totalObjs = fontNums.mono;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let n = 1; n <= totalObjs; n++) {
    offsets.push(pdf.length);
    pdf += `${n} 0 obj\n${bodies[n]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjs; n++) {
    pdf += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size ${totalObjs + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/**
 * Builds the styled block list for a ticket-publication PDF from a payload's
 * `shared` object (same shape buildTicketPublicationPayload returns) — the single
 * place both the real-send script and the fixture/test path build this content,
 * so the two never drift into two different layouts.
 */
export function ticketPublicationPdfBlocks({ drawId, publicationVersion, isCorrection, drawDateLabel, manifestHash, financialSummary, tickets, generatedAtUtc }) {
  const usd = (n) => (n == null ? String.fromCharCode(0x97) : `US$ ${Number(n).toFixed(2)}`);
  const FIN_LABELS = {
    participantCount: "Participantes",
    totalShares: "Total de cotas",
    valorPorCota: "Valor por cota",
    totalArrecadado: "Total arrecadado",
    creditoSorteioAnterior: "Crédito do sorteio anterior",
    valorUsado: "Valor usado",
    saldoReservado: "Saldo reservado",
    reembolso: "Reembolso",
    outrasDestinacoes: "Outras destinações",
    diferencaNaoConciliada: "Diferença não conciliada",
    ticketCount: "Quantidade de jogos",
    costPerTicket: "Custo por jogo",
    ticketCostTotal: "Custo total",
  };
  const MONEY_KEYS = new Set(["valorPorCota", "totalArrecadado", "creditoSorteioAnterior", "valorUsado", "saldoReservado", "reembolso", "outrasDestinacoes", "diferencaNaoConciliada", "costPerTicket"]);
  // ticketCostTotal deliberately excluded — same number as valorUsado (when reconciled), just
  // under a different label. Two rows for one fact reads as clutter, not extra transparency
  // (Eduardo, reviewing the HTML email as a participant — same simplification applied there).
  const SKIP_IF_ZERO = new Set(["diferencaNaoConciliada"]);

  const blocks = [
    { text: `Bolão Powerball ${EM_DASH} ${isCorrection ? "Correção de bilhetes" : "Bilhetes publicados"}`, style: "title" },
    { text: `Sorteio: ${drawDateLabel || drawId}   ${EM_DASH}   Publicação v${publicationVersion}`, style: "meta" },
    { text: "", style: "rule" },
    { text: "Resumo financeiro", style: "h2" },
  ];
  Object.entries(financialSummary || {}).forEach(([k, v]) => {
    if (!(k in FIN_LABELS)) return;
    if (k === "ticketCostTotal") return;
    if (SKIP_IF_ZERO.has(k) && !v) return;
    const label = FIN_LABELS[k];
    const value = MONEY_KEYS.has(k) ? usd(v) : String(v);
    blocks.push({ text: `${label.padEnd(30, ".")} ${value}`, style: "mono" });
  });
  blocks.push({ text: "", style: "rule" });
  blocks.push({ text: `Jogos (${(tickets || []).length})`, style: "h2" });

  // Grouped by serial (matches how the tickets were actually purchased/printed) instead of
  // repeating the same serial on every one of up to 50 rows — a real reader can't tell at a
  // glance that 50 consecutive rows share one receipt when the serial repeats unchanged.
  let currentSerial = undefined;
  let n = 0;
  (tickets || []).forEach((t) => {
    if (t.serial !== currentSerial) {
      currentSerial = t.serial;
      blocks.push({ text: `Série ${currentSerial || "(sem serial)"}`, style: "h3" });
      blocks.push({ text: "  #    Números                 PB", style: "monoHeader" });
    }
    n += 1;
    const numbers = t.numbers.map((v) => String(v).padStart(2, "0")).join("-");
    const pb = String(t.special).padStart(2, "0");
    blocks.push({ text: `  ${String(n).padStart(3, "0")}  ${numbers.padEnd(24, " ")} ${pb}`, style: "mono" });
  });
  blocks.push({ text: "", style: "rule" });
  blocks.push({ text: `Código de verificação (SHA-256): ${manifestHash}`, style: "small" });
  if (generatedAtUtc) blocks.push({ text: `Gerado em (UTC): ${generatedAtUtc}`, style: "small" });
  return blocks;
}
