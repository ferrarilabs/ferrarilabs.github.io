// pdf.mjs — minimal hand-rolled single/multi-page text PDF writer (no dependencies).
// Used only for the ticket-publication manifest PDF (numbers + hash + financial
// summary as plain text). Not a general-purpose PDF library.

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** lines: array of strings. Returns a Buffer with valid PDF bytes. */
export function buildTextPdf(lines, { title } = {}) {
  const pageWidth = 612, pageHeight = 792, margin = 50, lineHeight = 14, fontSize = 10;
  const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));
  if (pages.length === 0) pages.push([""]);

  const objects = [];
  const addObj = (body) => { objects.push(body); return objects.length; };

  const fontObjNum = objects.length + pages.length + pages.length + 2; // placeholder, fixed below
  // Build content streams + page objects after we know numbering; simpler: two-pass with fixed layout.

  // Layout: obj1 = Catalog, obj2 = Pages, then for each page: content obj, page obj; last obj = Font
  const catalogNum = 1, pagesNum = 2;
  let nextNum = 3;
  const pageNums = [];
  const contentNums = [];
  const bodies = [];

  pages.forEach((pageLines) => {
    const contentNum = nextNum++;
    const pageNum = nextNum++;
    contentNums.push(contentNum);
    pageNums.push(pageNum);
  });
  const fontNum = nextNum++;

  pages.forEach((pageLines, idx) => {
    let y = pageHeight - margin;
    let stream = `BT /F1 ${fontSize} Tf ${margin} ${y} Td ${lineHeight} TL\n`;
    pageLines.forEach((line, i) => {
      stream += `(${esc(line)}) Tj T*\n`;
    });
    stream += "ET";
    bodies[contentNums[idx]] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    bodies[pageNums[idx]] = `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNums[idx]} 0 R >>`;
  });
  bodies[catalogNum] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
  bodies[pagesNum] = `<< /Type /Pages /Kids [${pageNums.map((n) => n + " 0 R").join(" ")}] /Count ${pageNums.length} >>`;
  bodies[fontNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  const totalObjs = fontNum;
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
