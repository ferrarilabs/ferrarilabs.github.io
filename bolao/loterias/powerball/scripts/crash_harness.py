"""
crash_harness.py — banco e provedor falsos para exercitar a orquestracao REAL do Powerball.

O sujeito sob teste e `fetch_and_send_results.run_lifecycle()` -- a mesma funcao que o workflow
chama -- junto com o codigo REAL de `powerball_notification` (settle, retryable_recipients,
ensure_job, claim). Nada de logica de ledger e reimplementado aqui: uma reimplementacao provaria
o teste, nao o produto.

O que e falso, e por que:

  BANCO    : interpretador em memoria das ~6 formas de SQL que o ledger emite. Falso porque 13
             cenarios contra o Supabase real seriam lentos e mutariam producao. A atomicidade do
             `for update skip locked` NAO e presumida daqui -- ela e provada contra o Postgres
             real, separadamente, em test_claim_atomicity_real.py.
  PROVEDOR : efeito externo irreversivel. Um e-mail enviado nao volta.

Injecao de crash: `crash_at(marco)` levanta CrashPoint quando aquele marco e atingido, simulando
o runner morrendo naquele ponto exato. O estado durável ja gravado ate ali PERMANECE -- e disso
que a segunda execucao tem de se recuperar.
"""

import json
import re
import threading
from datetime import datetime, timedelta, timezone


class CrashPoint(Exception):
    """O processo morreu aqui. Nao e erro de aplicacao."""


class FakeDB:
    """Jobs em memoria. Serializa por lock, como o Postgres serializa por linha."""

    def __init__(self):
        self.jobs = {}
        self.lock = threading.Lock()
        self.provider_calls = []
        self.crash_marks = set()
        self.hits = []

    # ── injecao de crash ──────────────────────────────────────────────────
    def arm(self, *marcos):
        self.crash_marks = set(marcos)

    def arm_nth(self, marco, n):
        """Crasha na N-esima ocorrencia do marco.

        Necessario para distinguir "morreu antes do provedor" de "morreu depois do aceite":
        ambos passam por record_recipient, o primeiro escrevendo SENDING e o segundo ACCEPTED.
        Sem contagem, os dois cenarios seriam o mesmo teste.
        """
        self.nth = (marco, n)

    def _mark(self, nome):
        self.hits.append(nome)
        alvo, n = getattr(self, "nth", (None, 0))
        if nome == alvo:
            if sum(1 for h in self.hits if h == nome) == n:
                self.nth = (None, 0)
                raise CrashPoint(f"{nome}#{n}")
        if nome in self.crash_marks:
            self.crash_marks.discard(nome)   # crasha uma vez, nao em loop
            raise CrashPoint(nome)

    # ── interpretador de SQL ──────────────────────────────────────────────
    def sql(self, stmt):
        s = " ".join(stmt.split())

        m = re.search(r"select enqueue_bolao_notif\('([^']+)', '([^']+)', '([^']+)', \d+, "
                      r"'[^']+', '([^']+)', '(.*)'::jsonb", s, re.S)
        if m:
            self._mark("db:enqueue")
            pool, entidade, _tipo, chave, payload = m.groups()
            with self.lock:
                if chave not in self.jobs:          # idempotente por chave -- como o unique index
                    self.jobs[chave] = {
                        "pool_id": pool, "entity_id": entidade, "idempotency_key": chave,
                        "status": "pending", "claimed_by": None, "lease_expires_at": None,
                        "payload_snapshot": json.loads(payload.replace("''", "'")),
                        "sent_at": None, "last_error": None}
            return ""

        m = re.search(r"select payload_snapshot->'recipients' as r from bolao_notif_jobs "
                      r"where idempotency_key = '([^']+)'", s)
        if m:
            self._mark("db:read_recipients")
            j = self.jobs.get(m.group(1))
            return json.dumps({"rows": [{"r": (j or {}).get("payload_snapshot", {}).get("recipients", [])}]})

        m = re.search(r"select payload_snapshot->>'contentHash' as h .*?idempotency_key = '([^']+)'", s)
        if m:
            self._mark("db:read_hash")
            j = self.jobs.get(m.group(1))
            return json.dumps({"rows": [{"h": (j or {}).get("payload_snapshot", {}).get("contentHash")}]})

        m = re.search(r"update bolao_notif_jobs set status = '([^']+)'::bolao_notif_status.*?"
                      r"idempotency_key = '([^']+)'", s, re.S)
        if m:
            self._mark("db:settle")
            novo, chave = m.groups()
            with self.lock:
                j = self.jobs.get(chave)
                if j:
                    j["status"] = novo
                    j["claimed_by"] = None
                    j["lease_expires_at"] = None
                    if novo == "sent":
                        j["sent_at"] = datetime.now(timezone.utc).isoformat()
            return ""

        m = re.search(r"update bolao_notif_jobs set payload_snapshot = jsonb_set.*?"
                      r"r->>'entryRef' = '([^']*)' then r \|\| '(.*?)'::jsonb.*?"
                      r"idempotency_key = '([^']+)'", s, re.S)
        if m:
            self._mark("db:record_recipient")
            ref, patch, chave = m.groups()
            patch = json.loads(patch.replace("''", "'"))
            with self.lock:
                j = self.jobs.get(chave)
                if j:
                    for r in j["payload_snapshot"].get("recipients", []):
                        if r.get("entryRef") == ref:
                            r.update(patch)
            return ""

        raise AssertionError(f"SQL nao reconhecido pelo harness: {s[:160]}")

    # ── RPCs ──────────────────────────────────────────────────────────────
    def rpc(self, name, args):
        if name == "bolao_notif_health":
            self._mark("db:health")
            return {"ok": True}

        if name == "bolao_notif_status_by_pool":
            self._mark("db:status")
            return [{"idempotency_key": k, "status": j["status"]}
                    for k, j in self.jobs.items() if j["pool_id"] == args["p_pool_id"]]

        if name == "claim_bolao_notif":
            self._mark("db:claim")
            agora = datetime.now(timezone.utc)
            saida = []
            # O lock reproduz a serializacao do `for update skip locked`: dois chamadores
            # concorrentes nunca observam a mesma linha como reivindicavel.
            with self.lock:
                for k, j in self.jobs.items():
                    if j["pool_id"] != args["p_pool_id"]:
                        continue
                    lease = j.get("lease_expires_at")
                    ativo = lease and datetime.fromisoformat(lease) > agora
                    if j["status"] == "processing" and ativo:
                        continue                      # lease ativo nao se rouba
                    if j["status"] not in ("pending", "failed_retryable", "processing"):
                        continue
                    # Espelha a migracao 023: job que aguarda decisao humana nunca e
                    # reivindicado -- nem de passagem, ao processar outro sorteio.
                    if j.get("payload_snapshot", {}).get("requiresManualAction"):
                        continue
                    if j["status"] == "processing" and not ativo:
                        pass                          # lease vencido: reivindicavel
                    j["status"] = "processing"
                    j["claimed_by"] = args["p_worker"]
                    j["lease_expires_at"] = (
                        agora + timedelta(seconds=args["p_lease_seconds"])).isoformat()
                    saida.append({"idempotency_key": k, "status": "processing"})
                    if len(saida) >= args.get("p_limit", 10):
                        break
            return saida

        if name == "enqueue_bolao_notif":
            self._mark("db:enqueue")
            chave = args["p_idempotency_key"]
            with self.lock:
                if chave not in self.jobs:      # idempotente por chave, como o unique index
                    self.jobs[chave] = {
                        "pool_id": args["p_pool_id"], "entity_id": args["p_entity_id"],
                        "idempotency_key": chave, "status": "pending", "claimed_by": None,
                        "lease_expires_at": None, "payload_snapshot": args.get("p_payload") or {},
                        "sent_at": None, "last_error": None}
            return None

        if name == "get_bolao_notif_recipients":
            self._mark("db:read_recipients")
            j = self.jobs.get(args["p_idempotency_key"])
            return (j or {}).get("payload_snapshot", {}).get("recipients", [])

        if name == "get_bolao_notif_manual_flag":
            self._mark("db:manual_flag")
            j = self.jobs.get(args["p_idempotency_key"])
            return bool((j or {}).get("payload_snapshot", {}).get("requiresManualAction"))

        if name == "get_bolao_notif_content_hash":
            self._mark("db:read_hash")
            j = self.jobs.get(args["p_idempotency_key"])
            return (j or {}).get("payload_snapshot", {}).get("contentHash")

        if name == "set_bolao_notif_recipient":
            self._mark("db:record_recipient")
            chave = args["p_idempotency_key"]
            if "@" in str(args["p_entry_ref"]):
                raise AssertionError("entry_ref nao pode ser endereco")
            with self.lock:
                j = self.jobs.get(chave)
                if not j:
                    # Espelha a RPC real: 0 linhas LEVANTA, nao vira sucesso silencioso.
                    raise RuntimeError(f"nenhum job com a chave {chave}")
                for r in j["payload_snapshot"].get("recipients", []):
                    if r.get("entryRef") == args["p_entry_ref"]:
                        r.update({"state": args["p_state"],
                                  "providerMessageId": args.get("p_provider_message_id"),
                                  "lastError": (args.get("p_error") or "")[:120]})
            return 1

        if name == "settle_bolao_notif":
            self._mark("db:settle")
            chave = args["p_idempotency_key"]
            with self.lock:
                j = self.jobs.get(chave)
                if not j:
                    raise RuntimeError(f"nenhum job com a chave {chave}")
                recs = j["payload_snapshot"].get("recipients", [])
                total = len(recs)
                ok = sum(1 for r in recs if r.get("state") == "ACCEPTED")
                unc = sum(1 for r in recs if r.get("state") == "UNCERTAIN")
                if unc:
                    st, motivo = "failed_permanent", "NOTIFICATION_UNCERTAIN: requer revisao humana"
                elif total and ok == total:
                    st, motivo = "sent", None
                elif ok:
                    st, motivo = "failed_retryable", "PARTIAL: nem todos aceitos"
                else:
                    st, motivo = "failed_retryable", "nenhum destinatario aceito"
                j["status"] = st
                j["claimed_by"] = None
                j["lease_expires_at"] = None
                j["last_error"] = motivo
                if st == "sent":
                    j["sent_at"] = datetime.now(timezone.utc).isoformat()
            return [{"status": st, "accepted": ok, "total": total,
                     "uncertain": unc, "reason": motivo}]

        raise AssertionError(f"RPC nao reconhecida: {name}")

    # ── consultas de asserção ─────────────────────────────────────────────
    def job(self, chave):
        return self.jobs.get(chave)

    def recipients(self, chave):
        return (self.jobs.get(chave) or {}).get("payload_snapshot", {}).get("recipients", [])

    def counts(self, chave):
        r = self.recipients(chave)
        return {e: sum(1 for x in r if x.get("state") == e)
                for e in ("PENDING", "SENDING", "ACCEPTED", "FAILED", "UNCERTAIN")}

    def expire_lease(self, chave):
        j = self.jobs[chave]
        j["lease_expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
