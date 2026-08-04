// Generates email HTML previews for review — Part 6 of the professionalization audit.
// Fictional data only. Writes to docs/bolao/loterias/evidence/email-previews/.
// Run: node bolao/loterias/powerball/scripts/tools/generate_email_previews.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDrawSnapshot, buildEmailPayload, renderEmailSubject, renderEmailHtml } from "../lib/email_pipeline.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "..", "..", "..", "..", "docs", "bolao", "loterias", "evidence", "email-previews");
mkdirSync(OUT_DIR, { recursive: true });

const GAME_TYPE = { label: "Powerball", specialBallLabel: "Powerball" };
const RECIPIENT = "participante.alfa@example.invalid";

function draw(overrides = {}) {
  return {
    id: "2026-08-01",
    gameType: "powerball",
    drawing: { drawDateLabel: "01/08/2026 22:59 ET", drawDateIso: "2026-08-01T22:59:00-04:00", jackpot: 707000000 },
    finance: { totalArrecadado: 280, valorUtilizado: 138, valorGuardadoProximoSorteio: 142 },
    ...overrides,
  };
}

const scenarios = [
  {
    name: "antes-do-sorteio",
    eventType: "lembrete_sorteio",
    drawSnapshot: loadDrawSnapshot(draw(), GAME_TYPE),
  },
  {
    name: "tickets-publicados",
    eventType: "tickets_publicados",
    drawSnapshot: loadDrawSnapshot(draw(), GAME_TYPE),
  },
  {
    name: "sem-premio",
    eventType: "sem_premio",
    drawSnapshot: loadDrawSnapshot(draw(), GAME_TYPE),
    resultSnapshot: { numbers: [6, 17, 27, 48, 50], special: 5, multiplier: 3 },
    prizeSnapshot: { total: 0, jackpotHit: false },
  },
  {
    name: "com-premio",
    eventType: "premio_identificado",
    drawSnapshot: loadDrawSnapshot(draw(), GAME_TYPE),
    resultSnapshot: { numbers: [6, 17, 27, 48, 50], special: 5, multiplier: 3 },
    prizeSnapshot: { total: 700, jackpotHit: false },
  },
  {
    name: "reenvio-manual-correcao",
    eventType: "correcao_administrativa",
    drawSnapshot: loadDrawSnapshot(draw({ id: "2026-08-01-corrigido" }), GAME_TYPE),
  },
];

const manifest = [];
for (const s of scenarios) {
  const payload = buildEmailPayload({
    eventType: s.eventType,
    drawSnapshot: s.drawSnapshot,
    recipient: RECIPIENT,
    resultSnapshot: s.resultSnapshot,
    prizeSnapshot: s.prizeSnapshot,
  });
  const subject = renderEmailSubject(payload);
  const html = renderEmailHtml(payload);
  const filename = `${s.name}.html`;
  writeFileSync(join(OUT_DIR, filename), `<!-- Subject: ${subject} -->\n${html}\n`);
  manifest.push({ scenario: s.name, eventType: s.eventType, subject, file: filename });
  console.log(`wrote ${filename} — ${subject}`);
}

writeFileSync(join(OUT_DIR, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n${manifest.length} previews written to ${OUT_DIR}`);
