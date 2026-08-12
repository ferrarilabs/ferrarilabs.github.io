# DATA_GOVERNANCE — classification, retention, and privacy readiness

**STATUS:** COMPLETE as a governance *model*. Not a compliance certification.
**EVIDENCE BASIS:** `PHASE0_PII_MAP.md` (field inventory — **not restated here**),
`JSON_CLASSIFICATION.md` (document fields), `LOGICAL_DATA_MODEL_ASIS.md` §5 (PII columns),
`RLS_ASSUMPTIONS_REVIEW.md` (who can reach what), `HARDCODED_DATA_AUDIT.md` (PII at rest in Git),
Phase 1/1B catalog evidence.
**KNOWN GAPS:** no data-subject request has ever been received or exercised, so every process below
is **untested**. No DPA/processor agreement inventory exists. Retention periods are *proposals* —
none is currently enforced anywhere.
**ASSUMPTIONS:** participants are private individuals, majority Brazil/US; pools are private and
invite-only; there is no commercial data processing.

> **Deliberate scope split.** `PHASE0_PII_MAP.md` answers *where PII is*. This document answers
> *how it must be governed*. Field inventories are referenced, never copied.

---

## 1. Classification taxonomy applied

| Class | Definition | Where it lives |
|---|---|---|
| **PUBLIC** | Intentionally world-readable | Published ranking/audit pages; competition fixtures; `espn-normalized.json` |
| **INTERNAL** | Operational, non-personal | Schema metadata, sync cursors, cache-bust versions, changelogs |
| **CONFIDENTIAL** | Business-sensitive, non-personal | Scoring rules, admin password *hash*, migration ledger |
| **PII** | Identifies a natural person | `entryName`, `participantEmail`, `payerName` (JSON); `lottery_participants.{display_name,email,phone}`; `lottery_admin_audit.actor_email_snapshot` |
| **FINANCIAL_REFERENCE** | Links a person to a money movement | Zelle/Venmo/CashApp/PIX references; `external_reference`; amounts tied to a participant |
| **SECRET** | Compromise causes direct harm | DB password, `service_role` key, EmailJS keys, Turnstile secret |
| **AUDIT_RESTRICTED** | Integrity matters more than confidentiality; must not be alterable | `audit_events`, `lottery_admin_audit`, `auditLog` |

### 1.1 Classification by domain

| Domain | Class | Governance note |
|---|---|---|
| Participants (identity) | **PII** | Currently duplicated per entry per competition — the central governance defect. Target: stored **once** in `participants`. |
| Emails | **PII** | Also the de-facto identity key; nullable today, which blocks both dedup *and* subject-access resolution |
| Phone numbers | **PII** | Column exists (`lottery_participants.phone`); production shows no evidence of population |
| Payment references | **FINANCIAL_REFERENCE** | Governance rule already enforced and **verified holding**: refs live only in the private secret, never in public `data.js` (`HARDCODED_DATA_AUDIT.md` §3 — 0 leaks by 3 independent methods) |
| Transaction metadata (amount, method, provider, `paid_at`) | **FINANCIAL_REFERENCE** | Modelled correctly in `lottery_payment_transactions`; modelled as a bare boolean in `bolao_state` (J-03) |
| Predictions | **CONFIDENTIAL** before cutoff, **PUBLIC** after | A genuine time-varying classification. Pre-cutoff disclosure is a fairness breach; post-cutoff publication is the product. |
| Ranking | **PUBLIC** | Derived; never a source of truth |
| IP / device metadata | **not collected** | `client_metadata jsonb` exists on the audit table and could become PII if populated. **Governance decision needed before it is used.** |
| Audit logs | **AUDIT_RESTRICTED** + contains PII (`actor_email_snapshot`) | Dual class: cannot be freely deleted (integrity) *and* contains erasable personal data (§4.2 tension) |
| Admin activity | **AUDIT_RESTRICTED** | Today client-side and capped at 200 entries |
| Outbox | **PII** (recipient addresses) | Currently a **Git-tracked file** with 19 real addresses — `HARDCODED_DATA_AUDIT.md` H-03 |
| Backups | **PII + FINANCIAL_REFERENCE** | `backup-*.json` carry 44 names + 23 emails each; untracked but unencrypted on disk |

---

## 2. Retention (proposed — nothing enforced today)

| Data | Proposed retention | Basis |
|---|---|---|
| Participant identity | Active + **24 months** after last participation | Supports year-over-year reporting; bounded |
| Predictions | Retain with the competition edition | Historical performance is a product feature |
| Payment references | **5 years** | Financial-dispute window; the money is real |
| Audit events | **5 years**, append-only | Must outlive the disputes they evidence |
| Outbox / delivery records | **90 days** for payload; retain delivery *outcome* metadata longer | Payload contains PII; outcome does not need it |
| Backups | **35 days** rolling | Matches a realistic PITR window; see `PHASE0_BACKUP_GATES.md` G7 |
| `deletedIds` tombstones | Until server-mediated writes land, then delete | Pure merge artefact; **grows unbounded today** |
| Phone numbers | **Do not retain** unless a use case is stated | Column exists with no identified purpose |
| Debug/preview artefacts | **0 days** — should not be versioned | `debug.html`, `email-previews/` |

**Finding G-01 — HIGH.** **No retention period is enforced anywhere in the system.** No TTL, no
purge job, no archival. Every dataset grows forever, and two grow pathologically (`deletedIds`
unbounded; backups accumulating PII on disk). The one place data *is* deleted is the audit log —
which is exactly the one place it must not be (J-04, 200-entry cap). **Retention is currently
inverted: the system discards its evidence and keeps everything else forever.**

## 3. Deletion and redaction

| Operation | Today | Target |
|---|---|---|
| Delete an entry | Tombstone in `deletedIds`; data remains in the JSON document | Soft-delete column + hard-delete job after retention |
| Delete a participant | **No mechanism** | Redact PII in `participants`, keep the surrogate key so FKs and history survive |
| Erase from audit | Impossible by design (correct) | **Redact PII fields inside the audit row**, never delete the row |
| Erase from backups | **No mechanism** | Documented backup-expiry window as the erasure horizon |
| Erase from Git history | **No mechanism** | Requires history rewrite — treat as a distinct, authorised operation |

**Finding G-02 — HIGH (right-to-erasure vs. audit integrity).** These two requirements conflict
directly, and the conflict is currently **unresolved and undocumented**. The resolution that
satisfies both: **redaction-in-place, not deletion** — replace PII fields with a tombstone marker,
preserve the row, the hash chain, and the surrogate key. This requires the audit hash chain to cover
*non-PII* fields only, or redaction breaks the chain. **That is a design constraint on `audit_events`
that must be decided before the audit table is built** — retrofitting it later means rewriting
history, which an append-only log cannot do.

**Finding G-03 — MEDIUM.** PII exists in Git-tracked files (`HARDCODED_DATA_AUDIT.md` H-03, H-09).
Git history is effectively immutable, so **an erasure request cannot currently be honoured for
those records** without a history rewrite. Every day this remains true, the number of commits
requiring rewrite grows.

## 4. Access control

| Principal | Should reach | Reaches today |
|---|---|---|
| Public / `anon` | PUBLIC only | **All 7 tables, all DML** (`RLS_ASSUMPTIONS_REVIEW.md` O-1/O-2) |
| Participant | Own PII + PUBLIC | No participant authentication exists |
| Admin | PII + FINANCIAL_REFERENCE, audited | Client-side gate only; DB sees `anon` |
| Server jobs | As needed, `service_role` | Correct |
| Operator | Everything, human-gated | Correct |

**Finding G-04 — HIGH.** There is **no principal separation at the data layer**. Admin and public
are the same database principal (`anon`); the admin distinction exists only in browser JavaScript.
Consequently *no access to PII is attributable to an actor* at the database level, which defeats
both access control and audit. This is the governance consequence of `DEPENDENCY_GRAPH.md` §3.1.

## 5. Encryption, logging, and artefact rules

- **In transit:** TLS via Supabase REST — satisfied.
- **At rest (database):** provider-managed — satisfied, unverified by us.
- **At rest (backups):** ⚠️ `backup-*.json` are **plaintext JSON on a developer laptop** containing
  names + emails. `PHASE0_BACKUP_GATES.md` G3 already requires encryption; it is **not implemented**.
- **Column-level encryption:** not used. `supabase_vault` exists and is unused for participant data.
  Probably correct — vault is for secrets, not bulk PII.
- **Production logging:** must never log `state` contents, email addresses, or payment references.
  No log pipeline exists to violate this yet — write the rule before the pipeline.
- **Debug artefacts:** `debug.html` and `email-previews/` contain real data and are versioned.
  Prohibit versioned debug artefacts containing production values.
- **Review artefacts (this programme's own rule, already enforced):** raw discovery output stays
  outside Git; private term lists never committed; project ref masked; documents scanned before
  sharing. **This is the strongest working control in the system and should be generalised.**

## 6. GDPR / LGPD / US readiness — honest assessment

**No formal compliance programme exists, no DPO is appointed, no DPIA has been conducted, and no
certification of any kind is claimed.** The following is a readiness gap analysis only.

| Requirement | GDPR | LGPD | Status |
|---|---|---|---|
| Lawful basis / *base legal* | Art. 6 | Art. 7 | ⚠️ Implicit consent by joining a private pool. Never documented. |
| Transparency notice | Art. 13–14 | Art. 9 | ❌ No privacy notice on any app |
| Right of access | Art. 15 | Art. 18 | ⚠️ Technically possible but **manual and unreliable** — identity is duplicated across 3 apps with no linking key, so "all data about me" is not answerable today |
| Right to erasure | Art. 17 | Art. 18 | ❌ No mechanism; blocked by G-02 and G-03 |
| Rectification | Art. 16 | Art. 18 | ⚠️ Admin can edit entries; no participant self-service |
| Data minimisation | Art. 5(1)(c) | Art. 6 | ❌ `phone` collected with no purpose; PII duplicated per entry |
| Storage limitation | Art. 5(1)(e) | Art. 15–16 | ❌ **G-01** — no retention enforced |
| Integrity/confidentiality | Art. 5(1)(f) | Art. 46 | ⚠️ **G-04** — no principal separation; unencrypted backups |
| Records of processing | Art. 30 | Art. 37 | ⚠️ `PHASE0_PII_MAP.md` is the closest artefact and is a reasonable foundation |
| Breach notification | Art. 33 | Art. 48 | ❌ No detection capability ⇒ no notification capability |
| **US** (state laws, e.g. CCPA/CPA) | — | — | ⚠️ Likely below applicability thresholds (private, non-commercial, small scale). Do not assume exemption; do not claim compliance. |

**Pragmatic verdict.** For a private, invite-only pool among known individuals, the realistic
exposure is low and the correct posture is *proportionate hygiene*, not a compliance programme. The
three items that genuinely matter and are cheap:

1. **A one-paragraph privacy notice** in each app (closes transparency, documents lawful basis).
2. **The participant-master model** — makes right-of-access answerable *as a side effect* of the
   architecture that is already wanted for reporting.
3. **Encrypt or stop retaining local `backup-*.json`** — the single largest concentration of
   unprotected PII in the system.

Items 2 and 3 are already independently justified. Item 1 costs an afternoon.

## 7. RISKS

- **G-02 is a build-order risk, not a policy risk.** Deciding redaction-vs-deletion *after* the
  hash-chained audit table exists means an append-only log must be rewritten. Decide first.
- Enforcing retention on `audit_events` would be *wrong*; enforcing it everywhere else is right.
  A blanket retention policy would delete the evidence.
- Backups are the erasure blind spot: erasing from the live database while 35 days of plaintext
  backups persist means erasure is only eventual, and that must be stated to a data subject rather
  than glossed.

## 8. NEXT DECISION (operator)

1. **Redaction vs. deletion for PII inside audit rows** (G-02) — blocks the `audit_events` design.
2. **Is `phone` retained?** If no purpose, drop the column in the target model (minimisation).
3. **Encrypt local backups, or stop producing them on a laptop?** (G-01, `PHASE0_BACKUP_GATES.md` G3)
4. **Publish a privacy notice?** Cheapest compliance-readiness gain available.
