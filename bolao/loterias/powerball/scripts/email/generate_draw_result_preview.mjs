#!/usr/bin/env node
// Generates a draw-result preview using the REAL 2026-08-05 draw data (54
// tickets, 2 winners) so the preview matches exactly what was/would be sent
// — full ticket list intentionally NOT included per the 2026-08-06 format
// simplification; only available via the site link.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllDraws } from "./snapshot.mjs";
import { loadRealPrizeCalculator } from "./prize-calc-bridge.mjs";
import { buildDrawResultPayload } from "./payload.mjs";
import { renderDrawResultHtml, renderDrawResultText } from "./render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "..", "email-previews");
fs.mkdirSync(OUT, { recursive: true });

const draws = loadAllDraws();
const draw = draws.find((d) => d.id === "2026-08-05");
const { GAME_TYPES } = loadRealPrizeCalculator();
const gt = GAME_TYPES.powerball;
const official = { numbers: draw.result.numbers, special: draw.result.special, multiplier: draw.result.multiplier };
const { perRecipient } = buildDrawResultPayload({ draw, participants: draw.participants, official, prizeTableFn: gt.prizeTable });
const payload = perRecipient.find((p) => p.participantId === "Gustavo Bossle");

fs.writeFileSync(path.join(OUT, "draw-result-desktop.html"), renderDrawResultHtml(payload, true));
fs.writeFileSync(path.join(OUT, "draw-result-text.txt"), renderDrawResultText(payload, true));
console.log("Draw-result preview (simplified format) written to", OUT);
