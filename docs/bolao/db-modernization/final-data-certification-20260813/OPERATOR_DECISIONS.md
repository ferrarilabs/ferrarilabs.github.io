<!-- FDC-20260813-140645Z · no raw PII -->

# OPERATOR DECISION PACKET

Two decisions. Both are semantic, neither can be resolved from the evidence, and nothing else in
this audit is waiting on a human.

---

## D-A — the operator's own address is published at HEAD

| | |
|---|---|
| DECISION_ID | **D-A** |
| SOURCE | `origin/main` @ `23baf6b1` — 30 files: three `config.js`, four `send_*_email.py`, Powerball scripts and docs |
| AFFECTED_RECORD_COUNT | **1** address, 30 file references |
| PII? | **yes** — it is a real mailbox, and it is **also one of the 24 production participant addresses** |
| BUSINESS_IMPACT | none today. The address is the operator's own and is functionally required by the operator tooling and admin notification routing |
| OPTIONS | **(a)** leave it — it is your address in your repository, and the scripts need it. **(b)** move it to a repository secret / environment variable and read it at runtime, which removes it from the public tree without changing behaviour. **(c)** leave it in code but note in `SECURITY.md` that it is deliberate, so the next PII scan does not re-raise it as a finding |
| RECOMMENDATION | **(c)** now, **(b)** whenever those scripts are next touched. It is a genuine exposure of a genuine address, but it is yours, it is already widely known as your public contact, and rotating 30 references today buys less than recording the decision does |
| WHY AUTOMATION CANNOT DECIDE | whether a person's own address should be public in their own repository is that person's call, not a data-quality rule. Automation can only observe that it is real, that it is yours, and that it is also a participant address |

---

## D-B — one participant address is malformed

| | |
|---|---|
| DECISION_ID | **D-B** |
| SOURCE | copa2026 entry (token `98356dcf…`) → `public.bolao_entry_private.participant_email` → `bolao.participants.email` |
| AFFECTED_RECORD_COUNT | **1** address, 3 storage locations, 1 participant |
| PII? | **yes** |
| BUSINESS_IMPACT | the stored domain ends in a **trailing comma** (`gmail.com,`), which no mail server will accept. copa2026 concluded 2026-07-19 and there is **no delivery ledger for copa**, so whether this participant ever received their result emails **cannot be determined from the data**. Their entry, picks, payment confirmation and score are unaffected and intact |
| OPTIONS | **(a)** confirm the address with the participant and correct all three locations in one transaction, keeping the raw original in `audit.legacy_entry_field`. **(b)** strip the trailing comma without asking — one character, almost certainly right. **(c)** leave it quarantined; copa is archived and nothing will be sent again |
| RECOMMENDATION | **(a)**. It costs one message and it is the only option that ends with a *known* correct address rather than a very likely one |
| WHY AUTOMATION CANNOT DECIDE | §34 puts email correction squarely in the unsafe class, with no "unless it looks obvious" exception — and the exception is exactly where that rule earns its keep. Automation also cannot tell you whether this person missed their tournament emails; only they can |

---

`OPERATOR_DECISIONS_REQUIRED = 2`. Neither blocks legacy-retirement readiness, which is blocked on
stabilization and R1 instead.
