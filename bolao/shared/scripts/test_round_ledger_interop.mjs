#!/usr/bin/env node
/**
 * test_round_ledger_interop.mjs — as duas implementações do ledger de rodada precisam concordar.
 *
 * O caminho de produção do e-mail de rodada é Python; os gates e o worker são Node. Duas
 * implementações da mesma regra é uma decisão consciente (mesmo padrão de
 * `notification_repository.py`/`.mjs`), mas o risco é DERIVA — e este repositório já foi mordido
 * por ela: em julho de 2026 uma auditoria encontrou `send_result_email.py` com lógica de
 * pontuação silenciosamente divergente do `app.js`, e o dano seria pagar prêmio errado.
 *
 * Este teste executa AS DUAS implementações sobre os mesmos casos e compara hash por hash, chave
 * por chave, transição por transição. Não compara descrições — compara saídas.
 *
 * Uso: node bolao/shared/scripts/test_round_ledger_interop.mjs
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  roundKey, recipientKey, stableHash, recipientSetHash, fixtureSetHash,
  createRoundLedger, createMemoryRoundLedgerRepo, RECIPIENT_STATE, DELIVERY_SEMANTICS,
} from "./round_notification_ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let passed = 0;
const failures = [];
/** Serializa com chaves ordenadas: `json.dumps(sort_keys=True)` do Python e a ordem de inserção
 *  do Node produzem o MESMO objeto com bytes diferentes. Comparar bytes acusaria deriva onde não
 *  há nenhuma — e um teste que grita sem motivo acaba sendo ignorado quando gritar com motivo. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function eq(name, a, b) {
  const ok = canonical(a) === canonical(b);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failures.push(name);
    console.log(`  ✗ ${name}\n      node=${canonical(a)}\n      py  =${canonical(b)}`);
  }
}

// ─── Lado Python: roda o cenário inteiro e devolve JSON ──────────────────────────────────────
const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(HERE)})
from round_notification_ledger import (
    round_key, recipient_key, stable_hash, recipient_set_hash, fixture_set_hash,
    RoundLedger, MemoryRoundLedgerRepo, RECIPIENT_STATE, DELIVERY_SEMANTICS,
)

out = {}
out["deliverySemantics"] = DELIVERY_SEMANTICS
out["roundKey"] = round_key(22)
out["recipientKey"] = recipient_key(22, "e1")
out["stableHash"] = [stable_hash("abc"), stable_hash(""), stable_hash("rodada 22 — acentuação")]
out["recipientSetHash"] = recipient_set_hash(["e3", "e1", "e2"])
out["fixtureSetHash"] = fixture_set_hash(["401841179", "401841178"])

clock = {"t": 1000000}
repo = MemoryRoundLedgerRepo()
led = RoundLedger(repo, now=lambda: clock["t"], lease_ms=60000)

led.ensure_job(22, 3, ["e1", "e2", "e3"], "conteudo-r22", ["401841178", "401841179"])
out["afterEnsure"] = led.get(22)["state"]
out["claimA"] = bool(led.claim(22, "w1"))
out["claimB"] = bool(led.claim(22, "w2"))
led.mark_sending(22)
led.record_recipient(22, "e1", RECIPIENT_STATE["ACCEPTED"], provider_message_id="pm-1")
led.record_recipient(22, "e2", RECIPIENT_STATE["FAILED"], error="429")
out["settlePartial"] = led.settle(22)["state"]

repo2 = MemoryRoundLedgerRepo()
led2 = RoundLedger(repo2, now=lambda: clock["t"], lease_ms=60000)
led2.ensure_job(23, 2, ["a", "b"], "c23", ["1", "2"])
led2.claim(23, "w1")
led2.mark_sending(23)
led2.record_recipient(23, "a", RECIPIENT_STATE["SENDING"])
clock["t"] += 120000
rec = led2.recover_expired_leases()
out["crashSendingState"] = rec[0]["state"]
out["crashRecipientState"] = [r["state"] for r in rec[0]["recipients"] if r["entryRef"] == "a"][0]

repo3 = MemoryRoundLedgerRepo()
led3 = RoundLedger(repo3, now=lambda: clock["t"], lease_ms=60000)
led3.ensure_job(24, 3, ["x", "y"], "c24", ["1"])
out["completeness"] = led3.assert_recipient_completeness(24)

print(json.dumps(out, sort_keys=True))
`;

const py = JSON.parse(execFileSync("python3", ["-c", PY], { encoding: "utf8" }));

// ─── Lado Node: o MESMO cenário ──────────────────────────────────────────────────────────────
const node = {};
node.deliverySemantics = DELIVERY_SEMANTICS;
node.roundKey = roundKey(22);
node.recipientKey = recipientKey(22, "e1");
node.stableHash = [stableHash("abc"), stableHash(""), stableHash("rodada 22 — acentuação")];
node.recipientSetHash = recipientSetHash(["e3", "e1", "e2"]);
node.fixtureSetHash = fixtureSetHash(["401841179", "401841178"]);

let clock = 1_000_000;
{
  const repo = createMemoryRoundLedgerRepo();
  const led = createRoundLedger({ repo, now: () => clock, leaseMs: 60_000 });
  await led.ensureJob({ roundNumber: 22, expectedRecipientCount: 3, entryRefs: ["e1", "e2", "e3"],
                        contentHash: "conteudo-r22", fixtureIds: ["401841178", "401841179"] });
  node.afterEnsure = (await led.get(22)).state;
  node.claimA = !!(await led.claim(22, "w1"));
  node.claimB = !!(await led.claim(22, "w2"));
  await led.markSending(22);
  await led.recordRecipient(22, "e1", RECIPIENT_STATE.ACCEPTED, { providerMessageId: "pm-1" });
  await led.recordRecipient(22, "e2", RECIPIENT_STATE.FAILED, { error: "429" });
  node.settlePartial = (await led.settle(22)).state;
}
{
  const repo = createMemoryRoundLedgerRepo();
  const led = createRoundLedger({ repo, now: () => clock, leaseMs: 60_000 });
  await led.ensureJob({ roundNumber: 23, expectedRecipientCount: 2, entryRefs: ["a", "b"],
                        contentHash: "c23", fixtureIds: ["1", "2"] });
  await led.claim(23, "w1");
  await led.markSending(23);
  await led.recordRecipient(23, "a", RECIPIENT_STATE.SENDING);
  clock += 120_000;
  const rec = await led.recoverExpiredLeases();
  node.crashSendingState = rec[0].state;
  node.crashRecipientState = rec[0].recipients.find((r) => r.entryRef === "a").state;
}
{
  const repo = createMemoryRoundLedgerRepo();
  const led = createRoundLedger({ repo, now: () => clock, leaseMs: 60_000 });
  await led.ensureJob({ roundNumber: 24, expectedRecipientCount: 3, entryRefs: ["x", "y"],
                        contentHash: "c24", fixtureIds: ["1"] });
  node.completeness = await led.assertRecipientCompleteness(24);
}

console.log("INTEROP — ledger de rodada Node ≡ Python\n");

for (const campo of Object.keys(node).sort()) {
  eq(campo, node[campo], py[campo]);
}

// Guarda extra: um campo novo de um lado só sem o outro é deriva silenciosa.
eq("mesmo conjunto de campos nos dois lados",
   Object.keys(node).sort(), Object.keys(py).sort());

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 ROUND_LEDGER_INTEROP FAILED — as duas implementações divergiram");
  process.exit(1);
}
console.log("\n✓ ROUND_LEDGER_INTEROP PASSED");
