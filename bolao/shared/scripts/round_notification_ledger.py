"""
round_notification_ledger.py — ledger durável de notificação POR RODADA (F6), lado Python.

Espelha `round_notification_ledger.mjs`. As duas implementações existem porque o caminho de
produção do e-mail de rodada é Python (`bolao/br2026/scripts/send_round_email.py`) enquanto os
gates e o worker são Node — é o mesmo padrão já adotado por `notification_repository.py`/`.mjs`.

DERIVA É O RISCO REAL AQUI, e este repositório já foi mordido por ela: em julho de 2026 uma
auditoria achou `send_result_email.py` com lógica de pontuação silenciosamente divergente do
`app.js`. Por isso `test_round_ledger_interop.mjs` executa AS DUAS implementações sobre os mesmos
casos e falha se um único hash, chave ou transição de estado divergir. Não é um teste de
formalidade: é a única coisa que impede este arquivo de virar uma segunda verdade.

Ver a docstring do .mjs para a justificativa da semântica de entrega — ela é a mesma, e a string
`DELIVERY_SEMANTICS` é comparada byte a byte pelo interop.
"""

import json

ROUND_STATE = {
    "READY": "READY",
    "CLAIMED": "CLAIMED",
    "SENDING": "SENDING",
    "PARTIAL": "PARTIAL",
    "SENT": "SENT",
    "FAILED": "FAILED",
    "NEEDS_MANUAL_REVIEW": "NEEDS_MANUAL_REVIEW",
}

RECIPIENT_STATE = {
    "PENDING": "PENDING",
    "SENDING": "SENDING",
    "ACCEPTED": "ACCEPTED",
    "FAILED": "FAILED",
    "BLOCKED": "BLOCKED",
    "UNCERTAIN": "UNCERTAIN",
}

DELIVERY_SEMANTICS = "AT_MOST_ONCE_UNTIL_ACCEPT/UNCERTAIN_AFTER_PROVIDER_ACCEPT"

_U32 = 0xFFFFFFFF


def round_key(round_number):
    if not isinstance(round_number, int) or isinstance(round_number, bool) or round_number < 1:
        raise ValueError(f"rodada invalida: {round_number}")
    return f"br2026:round-results:{round_number}:v1"


def recipient_key(round_number, entry_ref):
    if not entry_ref or "@" in str(entry_ref):
        raise ValueError("entryRef precisa ser um id opaco, nunca um endereco de e-mail")
    return f"{round_key(round_number)}#{entry_ref}"


def _imul(a, b):
    """Multiplicação de 32 bits com wraparound, como o `Math.imul` do JS.

    Sem isto o Python promoveria para inteiro arbitrário e os hashes divergiriam do lado Node —
    que é exatamente o tipo de deriva que o interop existe para pegar.
    """
    return ((a * b) & _U32)


def stable_hash(value):
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, sort_keys=True, separators=(",", ":"))
    h1, h2 = 0x811C9DC5, 0x01000193
    for ch in text:
        c = ord(ch)
        h1 = _imul(h1 ^ c, 0x01000193) & _U32
        h2 = _imul(h2 + c, 0x85EBCA6B) & _U32
    return f"{h1:08x}{h2:08x}"


def recipient_set_hash(entry_refs):
    return stable_hash("|".join(sorted(str(r) for r in entry_refs)))


def fixture_set_hash(fixture_ids):
    return stable_hash("|".join(sorted(str(f) for f in fixture_ids)))


DEFAULT_LEASE_MS = 5 * 60 * 1000


class MemoryRoundLedgerRepo:
    """TESTE E DEV APENAS. Produção usa as RPCs de `bolao/shared/sql/010_notification_durability.sql`,
    cuja atomicidade vem de `for update skip locked` no banco — nunca deste código."""

    def __init__(self):
        self._store = {}

    def get(self, key):
        v = self._store.get(key)
        return json.loads(json.dumps(v)) if v is not None else None

    def put(self, key, record):
        self._store[key] = json.loads(json.dumps(record))

    def list_by_prefix(self, prefix):
        return [json.loads(json.dumps(v)) for k, v in self._store.items() if k.startswith(prefix)]

    def claim_atomic(self, key, owner, lease_until, now_ms):
        rec = self._store.get(key)
        if rec is None:
            return None
        if rec.get("leaseUntil") and rec["leaseUntil"] > now_ms:
            return None
        if rec.get("state") != "READY":
            return None
        nxt = dict(rec, state="CLAIMED", claimedBy=owner, leaseUntil=lease_until, updatedAt=now_ms)
        self._store[key] = nxt
        return json.loads(json.dumps(nxt))


class RoundLedger:
    def __init__(self, repo, now=None, lease_ms=DEFAULT_LEASE_MS, log=None):
        self.repo = repo
        self._now = now or (lambda: 0)
        self.lease_ms = lease_ms
        self._log = log or (lambda e: None)

    DELIVERY_SEMANTICS = DELIVERY_SEMANTICS

    def _emit(self, event_type, record, **extra):
        # Só id opaco, hash e transição. Nenhum e-mail, nome, pagador ou transação.
        self._log(dict({
            "eventType": event_type,
            "idempotencyKey": record.get("idempotencyKey"),
            "roundNumber": record.get("roundNumber"),
            "state": record.get("state"),
            "expectedRecipientCount": record.get("expectedRecipientCount"),
            "resolvedRecipientCount": record.get("resolvedRecipientCount"),
            "contentHash": record.get("contentHash"),
            "recipientSetHash": record.get("recipientSetHash"),
            "attemptCount": record.get("attemptCount"),
        }, **extra))

    def ensure_job(self, round_number, expected_recipient_count, entry_refs, content_hash, fixture_ids):
        key = round_key(round_number)
        rsh = recipient_set_hash(entry_refs)
        fsh = fixture_set_hash(fixture_ids)
        existing = self.repo.get(key)

        if existing:
            mudou = (existing.get("contentHash") != content_hash
                     or existing.get("recipientSetHash") != rsh
                     or existing.get("fixtureSetHash") != fsh)
            if mudou and existing.get("state") != ROUND_STATE["READY"]:
                raise RuntimeError(
                    f"CONTEUDO_MUDOU_EM_JOB_ATIVO: {key} esta em {existing.get('state')} com hashes "
                    f"diferentes. Superseda explicitamente em vez de mutar um job em andamento."
                )
            if mudou:
                atualizado = dict(existing, contentHash=content_hash, recipientSetHash=rsh,
                                  fixtureSetHash=fsh, expectedRecipientCount=expected_recipient_count,
                                  updatedAt=self._now())
                self.repo.put(key, atualizado)
                self._emit("job_created", atualizado, recreated=True)
                return atualizado
            return existing

        record = {
            "schemaVersion": 1,
            "idempotencyKey": key,
            "roundNumber": round_number,
            "state": ROUND_STATE["READY"],
            "expectedRecipientCount": expected_recipient_count,
            "resolvedRecipientCount": len(entry_refs),
            "contentHash": content_hash,
            "recipientSetHash": rsh,
            "fixtureSetHash": fsh,
            "recipients": [{"entryRef": r, "state": RECIPIENT_STATE["PENDING"],
                            "providerMessageId": None, "lastError": None} for r in entry_refs],
            "attemptCount": 0,
            "claimedBy": None, "leaseUntil": None,
            "createdAt": self._now(), "updatedAt": self._now(), "sentAt": None,
        }
        self.repo.put(key, record)
        self._emit("job_created", record)
        return record

    def assert_recipient_completeness(self, round_number):
        rec = self.repo.get(round_key(round_number))
        if rec is None:
            raise RuntimeError(f"job inexistente para a rodada {round_number}")
        if rec["expectedRecipientCount"] != rec["resolvedRecipientCount"]:
            self._emit("job_blocked", rec, reason="RECIPIENT_SET_INCOMPLETE")
            return {"ok": False, "reason": "RECIPIENT_SET_INCOMPLETE",
                    "expected": rec["expectedRecipientCount"],
                    "resolved": rec["resolvedRecipientCount"]}
        return {"ok": True}

    def claim(self, round_number, owner):
        key = round_key(round_number)
        claimed = self.repo.claim_atomic(key, owner, self._now() + self.lease_ms, self._now())
        if not claimed:
            return None
        self._emit("job_claimed", claimed, owner=owner)
        return claimed

    def mark_sending(self, round_number):
        key = round_key(round_number)
        rec = self.repo.get(key)
        nxt = dict(rec, state=ROUND_STATE["SENDING"],
                   attemptCount=rec["attemptCount"] + 1, updatedAt=self._now())
        self.repo.put(key, nxt)
        self._emit("job_send_started", nxt)
        return nxt

    def record_recipient(self, round_number, entry_ref, state, provider_message_id=None, error=None):
        key = round_key(round_number)
        rec = self.repo.get(key)
        recipients = [dict(r, state=state, providerMessageId=provider_message_id, lastError=error)
                      if r["entryRef"] == entry_ref else r
                      for r in rec["recipients"]]
        nxt = dict(rec, recipients=recipients, updatedAt=self._now())
        self.repo.put(key, nxt)
        self._emit("recipient_accepted" if state == RECIPIENT_STATE["ACCEPTED"] else "recipient_failed",
                   nxt, entryRef=entry_ref, recipientState=state)
        return nxt

    def settle(self, round_number):
        key = round_key(round_number)
        rec = self.repo.get(key)
        total = len(rec["recipients"])
        aceitos = sum(1 for r in rec["recipients"] if r["state"] == RECIPIENT_STATE["ACCEPTED"])
        incertos = sum(1 for r in rec["recipients"] if r["state"] == RECIPIENT_STATE["UNCERTAIN"])

        if incertos > 0:
            state = ROUND_STATE["NEEDS_MANUAL_REVIEW"]
        elif aceitos == total and total > 0:
            state = ROUND_STATE["SENT"]
        elif aceitos > 0:
            state = ROUND_STATE["PARTIAL"]
        else:
            state = ROUND_STATE["FAILED"]

        nxt = dict(rec, state=state, updatedAt=self._now(),
                   sentAt=self._now() if state == ROUND_STATE["SENT"] else rec.get("sentAt"),
                   claimedBy=None, leaseUntil=None)
        self.repo.put(key, nxt)
        self._emit("job_sent" if state == ROUND_STATE["SENT"]
                   else "job_partial" if state == ROUND_STATE["PARTIAL"] else "job_failed", nxt)
        return nxt

    def recover_expired_leases(self):
        """Um job que morreu em SENDING NÃO volta para a fila — ver a docstring do .mjs."""
        recuperados = []
        for rec in self.repo.list_by_prefix("br2026:round-results:"):
            if not rec.get("leaseUntil") or rec["leaseUntil"] > self._now():
                continue
            if rec.get("state") not in (ROUND_STATE["CLAIMED"], ROUND_STATE["SENDING"]):
                continue
            morreu_enviando = rec["state"] == ROUND_STATE["SENDING"]
            recipients = [dict(r, state=RECIPIENT_STATE["UNCERTAIN"])
                          if morreu_enviando and r["state"] == RECIPIENT_STATE["SENDING"] else r
                          for r in rec["recipients"]]
            nxt = dict(rec, recipients=recipients,
                       state=ROUND_STATE["NEEDS_MANUAL_REVIEW"] if morreu_enviando else ROUND_STATE["READY"],
                       claimedBy=None, leaseUntil=None, updatedAt=self._now())
            self.repo.put(rec["idempotencyKey"], nxt)
            self._emit("job_lease_expired", nxt, diedWhileSending=morreu_enviando)
            recuperados.append(nxt)
        return recuperados

    def pending_rounds(self):
        todos = self.repo.list_by_prefix("br2026:round-results:")
        pend = [r for r in todos
                if r["state"] not in (ROUND_STATE["SENT"], ROUND_STATE["NEEDS_MANUAL_REVIEW"])]
        return sorted(pend, key=lambda r: r["roundNumber"])

    def get(self, round_number):
        return self.repo.get(round_key(round_number))
