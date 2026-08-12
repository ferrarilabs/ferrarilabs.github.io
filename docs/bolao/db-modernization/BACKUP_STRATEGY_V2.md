# BACKUP_STRATEGY_V2 — authenticated encryption, manifests and containment

> Named `BACKUP_STRATEGY_V2.md` because `ARCHITECTURE_DECISION_REVIEW.md` and `DOCUMENTATION_MAP.md`
> already reference that filename. Reconciling to the existing reference is better than creating a new
> name and leaving three dangling links.

**Workstream Q.** Supersedes nothing: v1 (the first logical backup, already taken and encrypted) stays
valid. This is the design for the *next* one.

Status: **DESIGN ONLY. NO NEW PRODUCTION BACKUP HAS BEEN CREATED BY THIS WORK.**

---

## 1. The problem with v1

v1 works and its archive is restorable. Three things about it are weaker than they should be:

| Issue | Consequence |
|---|---|
| Encryption is symmetric with a passphrase held out-of-band | key rotation means re-encrypting every archive; there is no way to add a second recipient |
| Integrity is a single digest of the final archive | a digest proves the file is intact; it does not prove *what is inside* is what was dumped |
| No recorded toolchain or server version | a future restore has to guess which `pg_restore` major version can read it — and an 18.x archive needs an 18.x client |

None of these are urgent. All three are cheap to fix before the archive count grows.

## 2. Cipher preference, in order

| Rank | Mechanism | Why this order |
|---|---|---|
| 1 | **`age`** (X25519 + ChaCha20-Poly1305) | authenticated by construction; multiple recipients without re-encryption; one small static binary; no key-server, no web of trust, no agent |
| 2 | **GPG** (`--cipher-algo AES256 --digest-algo SHA512`, public-key mode) | ubiquitous and auditable, but the CLI is easy to misuse and the default options have changed across versions |
| 3 | **AES-256-GCM** via OpenSSL, explicit IV and tag | acceptable only with the tag verified on decrypt |
| ✗ | `openssl enc -aes-256-cbc` | **not acceptable.** CBC without a MAC is unauthenticated: a corrupted or tampered archive decrypts to garbage rather than failing, and the failure surfaces as a confusing `pg_restore` error instead of "this file is wrong" |

**Requirement: authenticated encryption, always.** The property that matters is not secrecy alone — it is
that a modified archive *fails to decrypt* instead of producing plausible-looking rubbish.

## 3. Manifest

A sidecar JSON, unencrypted (it contains no data, only metadata), carrying:

```
{
  "archive":            { "name", "bytes", "sha256" },
  "plaintextDump":      { "sha256", "bytes" },        // digest BEFORE encryption
  "perObjectDigests":   { "<schema.table>": "sha256" },
  "tools":              { "pg_dump", "pg_restore", "age", "openssl" },
  "serverVersion":      "PostgreSQL 17.6 ...",
  "dumpFormat":         "custom",
  "dumpFlags":          ["--no-owner", "--no-privileges", ...],
  "restoreCompatibility": { "minClientMajor": 18, "note": "an 18.x archive requires an 18.x client" },
  "rowCounts":          { "<schema.table>": 123 },
  "takenAt":            "…Z",
  "retention":          { "class": "…", "deleteAfter": "…Z" },
  "keyRecipients":      ["age1…public…"],             // PUBLIC keys only
  "scope":              { "schemas": [...], "excluded": [...] }
}
```

Two properties make this worth the effort:

- **`plaintextDump.sha256` and `perObjectDigests`** answer "is the *content* what was dumped?", which the
  archive digest alone cannot. A restore can verify per-object without restoring everything.
- **`rowCounts`** is the source snapshot that Workstream P's row-count check needs. Without it, P8 can only
  SKIP — a restored count with nothing to compare against proves nothing.

The manifest holds **digests, versions and public keys only**. Never a private key, never a connection
string, never a row.

## 4. Retention metadata

Retention lives *in the manifest*, not in a wiki page, so an archive is self-describing about when it may
be destroyed:

| Class | Keep | Rationale |
|---|---|---|
| `PRE_MIGRATION` | indefinitely until the migration is declared complete + 1 year | this is the only copy of the pre-migration world |
| `ROUTINE` | 90 days | enough to cover an unnoticed corruption |
| `PRE_DESTRUCTIVE` | 1 year | taken immediately before any destructive phase (M16, contract steps) |
| `LEGAL_HOLD` | until released | set manually; never expires automatically |

## 5. Verification gates (before an archive is considered valid)

| Gate | Check | Failure class (Workstream P) |
|---|---|---|
| Q1 | archive decrypts with the intended key | `F2_DECRYPT_FAILED` |
| Q2 | archive digest matches the manifest | `F3_INTEGRITY_MISMATCH` |
| Q3 | plaintext digest matches after decryption | `F3_INTEGRITY_MISMATCH` |
| Q4 | `pg_restore --list` parses and lists the expected objects | `F1`/`F6` |
| Q5 | tool and server versions recorded and mutually compatible | `F4_TOOLCHAIN_INCOMPATIBLE` |
| Q6 | **plaintext cleanup verified** — the intermediate dump is gone | see §6 |
| Q7 | key separation verified — see §7 | — |
| Q8 | PII containment — see §8 | — |

Q1–Q5 are the same checks Workstream P consumes; the manifest exists so it *can*.

## 6. Plaintext cleanup verification

The dump exists unencrypted for the seconds between `pg_dump` and encryption. That file is the most
sensitive artefact the whole process produces.

- It is written to a path **outside the repository and outside any synced folder**.
- After encryption succeeds, it is deleted, and the deletion is **verified by stat**, not assumed.
- The script fails loudly if the plaintext still exists at exit, including on the error path — a failed
  encryption is exactly when the plaintext gets left behind.
- Deletion is not treated as secure erasure. On a copy-on-write filesystem or SSD, `rm` does not
  overwrite. The claim made is "removed from the namespace", not "unrecoverable from the device", and the
  difference is stated rather than glossed.

## 7. Key separation checks

| Rule | Why |
|---|---|
| The private key is **never** in the repo, the backup directory, or any script | one compromised directory must not yield both ciphertext and key |
| The private key is **never** in an environment variable read by the backup script | the backup script encrypts with a *public* key; it has no need for the private one |
| The manifest records **public** recipients only | a public key in the manifest is a feature; a private one is a breach |
| Archive storage and key storage are **different systems** | co-locating them makes the encryption decorative |
| A repo-wide scan for private-key material runs before every commit | this is the gate that catches the mistake, since intent does not |

The backup path needs only a public key. If a script ever needs the private key, it is a *restore* script,
and restore is a deliberate, separately-authorised act.

## 8. PII containment

The archive contains participant names, emails and payment references — it is the highest-PII artefact the
platform produces. Therefore:

- **Never** committed to Git, and never placed in a directory Git tracks. `.gitignore` is a convenience,
  not the control; the control is that the output path is outside the working tree.
- **Never** attached to an issue, a PR, or a chat message.
- The manifest may be shared (digests and versions only); the archive may not.
- A restore target holding real participant data is subject to the same isolation checks as production
  (Workstream P, `F12_ISOLATION_BREACH`): no email sending, no webhooks, no scheduled jobs, not publicly
  reachable. A rehearsal that can email real participants is worse than no rehearsal.

## 9. What is deliberately not done here

- **No new production backup was taken.** This is design only.
- **No key was generated, rotated or moved.** Key custody is out-of-band and stays there.
- **No claim that `age` is installed.** Adopting it is an operator decision with a tooling dependency.
- **No secure-erasure claim** for the plaintext intermediate — see §6.

## 10. Open operator decisions

| Id | Decision |
|---|---|
| **Q-OP-1** | Adopt `age` (preferred) or stay with the current symmetric scheme? Adopting it adds a binary dependency and requires generating a recipient keypair. |
| **Q-OP-2** | Who holds the second recipient key? A single-recipient archive is unrecoverable if that key is lost. |
| **Q-OP-3** | Where do archives live, and is it a different system from where the key lives (§7)? |
| **Q-OP-4** | Confirm the retention classes in §4 against any real legal or tax requirement — the table is engineering judgement, not legal advice. |
