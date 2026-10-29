/**
 * `sync_draw_participants.mjs`: o data.js gerado do banco precisa sair IDENTICO ao que era
 * escrito a mao, e so o sorteio alvo pode mudar.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_sync_draw_participants.mjs
 */
import { participantesDoSorteio, aplicarNoDataJs, aplicarNoPin } from "./sync_draw_participants.mjs";

const falhas = [];
function checa(nome, cond, detalhe = "") {
  console.log(`  [${cond ? "PASS" : "FALHA"}] ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!cond) falhas.push(nome);
}

const DATA_JS = `window.POWERBALL_DRAWS = [
  {
    id: "2026-10-28",
    participants: [
      { name: "Antigo", cotas: 1, valor: 10, metodo: "Zelle", data: "27/10/2026", hora: "1:01:51 PM", status: "verificado", state: "NC" }
    ],
    finance: {
      totalArrecadado: 10, // comentario antigo
    },
  },
  {
    id: "2026-10-31",
    // comentario que tem de sobreviver
    participants: [
      { name: "Ana", cotas: 1, valor: 10, metodo: "Zelle", data: "29/10/2026", hora: "7:03:23 AM", status: "verificado", state: "NC" }
    ],

    finance: {
      totalArrecadado: 10, // 1 participante
      creditoSorteioAnterior: 32,
    },
  }
];
`;

const linhas = {
  draws: [
    { draw_id: "uuid-a", draw_date: "2026-10-28" },
    { draw_id: "uuid-b", draw_date: "2026-10-31" },
  ],
  participantes: [
    { participant_id: "p1", display_name: "Ana", state: "NC" },
    { participant_id: "p2", display_name: "Bruno", state: "FL" },
    { participant_id: "p3", display_name: "Eduardo Ferrari", state: "NC" },
  ],
  participacoes: [
    { participation_id: "x3", participant_id: "p3", draw_id: "uuid-b", cotas: 1 },
    { participation_id: "x1", participant_id: "p1", draw_id: "uuid-b", cotas: 1 },
    { participation_id: "x2", participant_id: "p2", draw_id: "uuid-b", cotas: 1 },
    { participation_id: "y1", participant_id: "p1", draw_id: "uuid-a", cotas: 1 },
  ],
  transacoes: [
    { participation_id: "x1", type: "contribution", amount: "10.00", method: "Zelle", paid_at: "2026-10-29T11:03:23+00:00" },
    { participation_id: "x2", type: "contribution", amount: "10.00", method: "Cash App", paid_at: "2026-10-29T18:03:11+00:00" },
    { participation_id: "x3", type: "contribution", amount: "10.00", method: "Fundo próprio (organizador)", paid_at: "2026-10-29T11:15:08+00:00" },
    { participation_id: "y1", type: "contribution", amount: "10.00", method: "Zelle", paid_at: "2026-10-27T17:01:51+00:00" },
  ],
};

const rows = participantesDoSorteio(linhas, "2026-10-31");
checa("ordem de chegada", rows.map((r) => r.name).join(",") === "Ana,Eduardo Ferrari,Bruno",
      rows.map((r) => r.name).join(","));
checa("organizador marcado", rows[1].status === "organizador");

const { src, total } = aplicarNoDataJs(DATA_JS, "2026-10-31", rows);
checa("linha existente sai identica",
      src.includes(`{ name: "Ana", cotas: 1, valor: 10, metodo: "Zelle", data: "29/10/2026", hora: "7:03:23 AM", status: "verificado", state: "NC" }`));
checa("participante novo com hora ET",
      src.includes(`{ name: "Bruno", cotas: 1, valor: 10, metodo: "Cash App", data: "29/10/2026", hora: "2:03:11 PM", status: "verificado", state: "FL" }`));
checa("total recalculado", total === 30 && src.includes("totalArrecadado: 30, // 3 participante(s)"));
checa("outro sorteio intocado", src.slice(0, src.indexOf('id: "2026-10-31"')) ===
      DATA_JS.slice(0, DATA_JS.indexOf('id: "2026-10-31"')));
checa("comentario preservado", src.includes("// comentario que tem de sobreviver"));
checa("credito preservado", src.includes("creditoSorteioAnterior: 32,"));
const reaplicado = aplicarNoDataJs(src, "2026-10-31", rows).src;
checa("idempotente", reaplicado === src);
const avaliado = new Function(src.replace("window.POWERBALL_DRAWS =", "return"))();
checa("data.js continua JavaScript valido", avaliado[1].participants.length === 3);

let semLinhas = false;
try { participantesDoSorteio({ ...linhas, draws: [] }, "2026-10-31"); } catch { semLinhas = true; }
checa("sorteio fora de lottery_draws e recusado (nunca zera o data.js)", semLinhas);
let semParticipacao = false;
try { participantesDoSorteio({ ...linhas, participacoes: [] }, "2026-10-31"); } catch { semParticipacao = true; }
checa("sorteio sem participacao e recusado", semParticipacao);

let recusou = false;
try { aplicarNoDataJs(DATA_JS, "2026-11-02", rows); } catch { recusou = true; }
checa("sorteio inexistente e recusado", recusou);

const pin = aplicarNoPin({ draws: [{ id: "2026-10-31", participants: 1, cotas: 1, valor: 10, totalArrecadado: 10 }] },
                         "2026-10-31", rows, total);
checa("pin atualizado", JSON.stringify(pin.draws[0]) ===
      JSON.stringify({ id: "2026-10-31", participants: 3, cotas: 3, valor: 30, totalArrecadado: 30 }));

if (falhas.length) { console.log(`\nSYNC_DRAW_PARTICIPANTS = FALHOU (${falhas.length})`); process.exit(1); }
console.log("\nSYNC_DRAW_PARTICIPANTS = PASS");
